import test from 'node:test';
import assert from 'node:assert/strict';

import {
  OVERTURE_RELEASE, buildElements, collectFeatures, decodeMvt, segmentTags, setOvertureArchiveFactory,
} from '../services/overtureTiles.js';

// ── Minimal Mapbox Vector Tile encoder (test fixtures only) ──────────────────
const varint = (n, out) => { while (n >= 0x80) { out.push((n % 0x80) | 0x80); n = Math.floor(n / 0x80); } out.push(n); };
const key = (field, wire, out) => varint(field * 8 + wire, out);
const zz = (n) => (n < 0 ? -2 * n - 1 : 2 * n);
const bytesField = (field, bytes, out) => { key(field, 2, out); varint(bytes.length, out); out.push(...bytes); };
const str = (s) => [...new TextEncoder().encode(s)];
const packedField = (field, nums, out) => { const b = []; for (const n of nums) varint(n, b); bytesField(field, b, out); };

const encodeGeometry = (type, parts) => {
  const cmds = [];
  let cx = 0;
  let cy = 0;
  for (const part of parts) {
    const ring = type === 3 ? part.slice(0, -1) : part;   // closed rings drop the repeat
    const [first, ...rest] = ring;
    cmds.push(1 + 8 * 1, zz(first[0] - cx), zz(first[1] - cy));
    [cx, cy] = first;
    if (rest.length) {
      cmds.push(2 + 8 * rest.length);
      for (const [x, y] of rest) { cmds.push(zz(x - cx), zz(y - cy)); cx = x; cy = y; }
    }
    if (type === 3) cmds.push(7 + 8);
  }
  return cmds;
};

/** layers: {name: [{type: 1|2|3, props, parts}]} → MVT bytes. */
const encodeMvt = (layers, extent = 4096) => {
  const tile = [];
  for (const [name, features] of Object.entries(layers)) {
    const keys = [];
    const values = [];
    const layer = [];
    bytesField(1, str(name), layer);
    for (const f of features) {
      const tags = [];
      for (const [k, v] of Object.entries(f.props || {})) {
        let ki = keys.indexOf(k); if (ki < 0) { ki = keys.push(k) - 1; }
        let vi = values.findIndex((x) => x === v); if (vi < 0) { vi = values.push(v) - 1; }
        tags.push(ki, vi);
      }
      const feat = [];
      packedField(2, tags, feat);
      key(3, 0, feat); varint(f.type, feat);
      packedField(4, encodeGeometry(f.type, f.parts), feat);
      bytesField(2, feat, layer);
    }
    for (const k of keys) bytesField(3, str(k), layer);
    for (const v of values) {
      const val = [];
      if (typeof v === 'string') bytesField(1, str(v), val);
      else if (typeof v === 'boolean') { key(7, 0, val); varint(v ? 1 : 0, val); }
      else if (Number.isInteger(v) && v >= 0) { key(5, 0, val); varint(v, val); }
      else { key(3, 1, val); const b = new Uint8Array(8); new DataView(b.buffer).setFloat64(0, v, true); val.push(...b); }
      bytesField(4, val, layer);
    }
    key(5, 0, layer); varint(extent, layer);
    bytesField(3, layer, tile);
  }
  return new Uint8Array(tile);
};

// Flagstaff's z14 tile and its east neighbour.
const Z = 14;
const X = 3110;
const Y = 6478;

test('decodeMvt reads points, lines, polygons with holes and every value type', () => {
  const bytes = encodeMvt({ l: [
    { type: 1, props: { s: 'a', n: 7, f: 2.5, b: true }, parts: [[[10, 20]]] },
    { type: 2, props: {}, parts: [[[0, 0], [100, 0], [100, 50]]] },
    { type: 3, props: {}, parts: [[[0, 0], [100, 0], [100, 100], [0, 100], [0, 0]], [[20, 20], [20, 80], [80, 80], [80, 20], [20, 20]]] },
  ] });
  const { l } = decodeMvt(bytes);
  assert.equal(l.extent, 4096);
  assert.deepEqual(l.features[0].props, { s: 'a', n: 7, f: 2.5, b: true });
  assert.deepEqual(l.features[0].parts, [[[10, 20]]]);
  assert.deepEqual(l.features[1].parts, [[[0, 0], [100, 0], [100, 50]]]);
  assert.equal(l.features[2].parts.length, 2);
  assert.deepEqual(l.features[2].parts[0].at(-1), [0, 0], 'ClosePath repeats the first vertex');
});

const ROAD_PROPS = {
  id: 'seg-1', subtype: 'road', class: 'primary', '@name': 'Route 66',
  access_restrictions: JSON.stringify([{ access_type: 'denied', when: { heading: 'backward' } }]),
  speed_limits: JSON.stringify([{ max_speed: { value: 25, unit: 'mph' } }]),
  road_surface: JSON.stringify([{ value: 'paved' }]),
};

test('a road cut at the tile edge is rejoined into one way with mapped tags', () => {
  // Drawn 3000 → 5000 px in tile X, i.e. -1096 → 904 in tile X+1; both copies end at the buffer.
  const a = { z: Z, x: X, y: Y, layers: decodeMvt(encodeMvt({ segment: [{ type: 2, props: ROAD_PROPS, parts: [[[3000, 2000], [5000, 2000]]] }] })) };
  const b = { z: Z, x: X + 1, y: Y, layers: decodeMvt(encodeMvt({ segment: [{ type: 2, props: ROAD_PROPS, parts: [[[-1096, 2000], [904, 2000]]] }] })) };
  const { elements } = buildElements({ transportation: collectFeatures([a, b]) });
  const ways = elements.filter((e) => e.type === 'way');
  assert.equal(ways.length, 1, 'one joined way, no duplicated buffer overlap');
  assert.deepEqual(ways[0].tags, { highway: 'primary', name: 'Route 66', surface: 'paved', maxspeed: '25 mph', oneway: 'yes' });
  const lons = ways[0].geometry.map((p) => p.lon);
  assert.ok(Math.max(...lons) - Math.min(...lons) > 0.0001, 'spans both tiles');
});

test('a segment held whole is split where a bridge starts and ends', () => {
  const props = { ...ROAD_PROPS, id: 'seg-2', road_flags: JSON.stringify([{ values: ['is_bridge'], between: [0.4, 0.6] }]) };
  // A long neighbour reaches the buffer, so the tile's clip edge is known; the segment stays clear of it.
  const layers = decodeMvt(encodeMvt({ segment: [
    { type: 2, props: { id: 'edge', subtype: 'road', class: 'service' }, parts: [[[-200, 100], [4296, 100]]] },
    { type: 2, props, parts: [[[1000, 2000], [2000, 2000]]] },
  ] }));
  const { elements } = buildElements({ transportation: collectFeatures([{ z: Z, x: X, y: Y, layers }]) });
  const route = elements.filter((e) => e.tags?.name === 'Route 66');
  assert.equal(route.length, 3);
  assert.deepEqual(route.map((w) => w.tags.bridge ?? null), [null, 'yes', null]);
  assert.equal(route[1].tags.layer, '1');
});

test('segment tags: links, sidewalks, partial rules only for whole segments', () => {
  assert.equal(segmentTags({ subtype: 'road', class: 'primary', subclass: 'link' }).highway, 'primary_link');
  assert.deepEqual(segmentTags({ subtype: 'road', class: 'footway', subclass: 'sidewalk' }), { footway: 'sidewalk', highway: 'footway' });
  const partial = { subtype: 'road', class: 'residential', road_flags: JSON.stringify([{ values: ['is_bridge'], between: [0.2, 0.3] }]) };
  assert.equal(segmentTags(partial, NaN).bridge, undefined, 'a piece of an unknown-length segment');
  assert.equal(segmentTags(partial, 0.25).bridge, 'yes');
  assert.equal(segmentTags({ subtype: 'rail', class: 'standard_gauge' }), null);
});

test('buildings: a footprint inside two tiles\' buffers comes out once, with heights', () => {
  const ring = [[4000, 1000], [4060, 1000], [4060, 1050], [4000, 1050], [4000, 1000]];
  const props = { id: 'bld-1', class: 'house', height: 6.25, num_floors: 2, roof_shape: 'gabled', facade_color: '#ffffff' };
  const edge = { type: 3, props: { id: 'big' }, parts: [[[-100, -100], [4196, -100], [4196, 0], [-100, 0], [-100, -100]]] };
  const shift = (r) => r.map(([x, y]) => [x - 4096, y]);
  const a = { z: Z, x: X, y: Y, layers: decodeMvt(encodeMvt({ building: [edge, { type: 3, props, parts: [ring] }] })) };
  const b = { z: Z, x: X + 1, y: Y, layers: decodeMvt(encodeMvt({ building: [edge, { type: 3, props, parts: [shift(ring)] }] })) };
  const under = { type: 3, props: { id: 'bld-2', class: 'parking', is_underground: true }, parts: [[[100, 100], [200, 100], [200, 200], [100, 200], [100, 100]]] };
  a.layers.building.features.push(...decodeMvt(encodeMvt({ building: [under] })).building.features);
  const { elements } = buildElements({ buildings: collectFeatures([a, b]) });
  const houses = elements.filter((e) => e.tags?.building === 'house');
  assert.equal(houses.length, 1);
  assert.deepEqual(houses[0].tags, { building: 'house', height: '6.3', 'building:levels': '2', 'roof:shape': 'gabled', 'building:colour': '#ffffff' });
  assert.ok(!elements.some((e) => e.tags?.building === 'parking'), 'underground buildings are left out');
});

test('base: OSM source_tags pass through, filtered like the live Overpass query', () => {
  const layers = decodeMvt(encodeMvt({
    land: [{ type: 1, props: { id: 't1', source_tags: JSON.stringify({ natural: 'tree', leaf_type: 'needleleaved' }) }, parts: [[[100, 100]]] }],
    infrastructure: [
      { type: 1, props: { id: 'a1', source_tags: JSON.stringify({ tourism: 'artwork' }) }, parts: [[[200, 200]]] },
      { type: 1, props: { id: 's1', source_tags: JSON.stringify({ highway: 'traffic_signals' }) }, parts: [[[300, 300]]] },
    ],
    land_use: [{ type: 3, props: { id: 'p1', source_tags: JSON.stringify({ leisure: 'park', name: 'Arroyo Park' }) }, parts: [[[0, 0], [500, 0], [500, 500], [0, 500], [0, 0]]] }],
    land_cover: [{ type: 3, props: { id: 'c1', subtype: 'forest' }, parts: [[[0, 0], [900, 0], [900, 900], [0, 900], [0, 0]]] }],
  }));
  const { elements } = buildElements({ base: collectFeatures([{ z: Z, x: X, y: Y, layers }]) });
  const nodes = elements.filter((e) => e.type === 'node');
  assert.deepEqual(nodes.map((n) => n.tags), [{ natural: 'tree', leaf_type: 'needleleaved' }, { highway: 'traffic_signals' }]);
  const ways = elements.filter((e) => e.type === 'way');
  assert.deepEqual(ways.map((w) => w.tags), [{ leisure: 'park', name: 'Arroyo Park' }], 'ESA land cover is too coarse to use');
});

test('fetchOSMData falls back to Overture when every Overpass server fails', async () => {
  const { fetchOSMData, getLastOSMRequestInfo } = await import('../services/osm.js');
  const tiles = {
    transportation: encodeMvt({ segment: [{ type: 2, props: ROAD_PROPS, parts: [[[1000, 2000], [3000, 2000]]] }] }),
    buildings: encodeMvt({ building: [{ type: 3, props: { id: 'b', class: 'house', height: 5 }, parts: [[[1500, 1500], [1600, 1500], [1600, 1600], [1500, 1600], [1500, 1500]]] }] }),
  };
  setOvertureArchiveFactory((theme) => ({
    getHeader: async () => ({ maxZoom: Z }),
    getZxy: async (z, x, y) => (tiles[theme] && x === X && y === Y ? { data: tiles[theme].buffer } : undefined),
  }));
  const origFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new TypeError('fetch failed'); };
  // Inside tile X/Y: lon -111.665..-111.643, lat 35.191..35.209.
  const bounds = { west: -111.66, east: -111.645, south: 35.195, north: 35.205 };
  try {
    const features = await fetchOSMData(bounds);
    const info = getLastOSMRequestInfo();
    assert.equal(info.endpointUsed, 'overture-maps');
    assert.equal(info.overtureRelease, OVERTURE_RELEASE);
    assert.match(info.attribution, /Overture Maps Foundation/);
    assert.ok(features.some((f) => f.type === 'road' && f.tags.name === 'Route 66'));
    assert.ok(features.some((f) => f.type === 'building' && f.tags.height === '5'));
  } finally {
    globalThis.fetch = origFetch;
    setOvertureArchiveFactory(null);
  }
});

// ── Hybrid: live OSM buildings + Overture heights and missing footprints ─────
const osmSource = (wayId) => JSON.stringify([{ dataset: 'OpenStreetMap', provider: 'osm', record_id: `w${wayId}@3` }]);
const square = (x, y, s = 60) => [[x, y], [x + s, y], [x + s, y + s], [x, y + s], [x, y]];

test('hybrid: heights by OSM id, missing footprints added, overlaps and tagged heights left alone', async () => {
  const { mergeOvertureBuildings } = await import('../services/overtureTiles.js');
  const layers = decodeMvt(encodeMvt({ building: [
    { type: 3, props: { id: 'o1', class: 'house', height: 5.5, sources: osmSource(101) }, parts: [square(100, 100)] },
    { type: 3, props: { id: 'o2', class: 'house', height: 9, sources: osmSource(102) }, parts: [square(300, 100)] },
    { type: 3, props: { id: 'ml1', subtype: 'residential', height: 4, sources: JSON.stringify([{ dataset: 'Microsoft ML Buildings' }]) }, parts: [square(600, 600)] },
    { type: 3, props: { id: 'ml2', subtype: 'residential', sources: JSON.stringify([{ dataset: 'Google Open Buildings' }]) }, parts: [square(1000, 1000)] },
  ] }));
  const records = collectFeatures([{ z: Z, x: X, y: Y, layers }]);
  const lonlat = ([px, py]) => {
    const n = 2 ** Z;
    return { lat: (Math.atan(Math.sinh(Math.PI * (1 - (2 * (Y + py / 4096)) / n))) * 180) / Math.PI, lon: ((X + px / 4096) / n) * 360 - 180 };
  };
  const osm = { elements: [
    { type: 'way', id: 101, tags: { building: 'house' }, geometry: square(100, 100).map(lonlat) },
    { type: 'way', id: 102, tags: { building: 'house', 'building:levels': '1' }, geometry: square(300, 100).map(lonlat) },
    // A building mapped in OSM after Overture's snapshot, where Google has one too.
    { type: 'way', id: 103, tags: { building: 'yes' }, geometry: square(1005, 1005, 50).map(lonlat) },
    { type: 'way', id: 104, tags: { highway: 'residential' }, geometry: [lonlat([0, 0]), lonlat([50, 50])] },
  ] };
  const { data, heightsAdded, footprintsAdded } = mergeOvertureBuildings(osm, records);
  const byId = new Map(data.elements.map((e) => [e.id, e]));
  assert.equal(byId.get(101).tags.height, '5.5');
  assert.equal(byId.get(101).tags['mapng:height_source'], 'overture');
  assert.equal(byId.get(102).tags.height, undefined, 'OSM levels win over an Overture height');
  assert.equal(osm.elements[0].tags.height, undefined, 'input is not mutated');
  assert.equal(heightsAdded, 1);
  const added = data.elements.filter((e) => e.tags?.['mapng:source'] === 'overture');
  assert.equal(footprintsAdded, 1);
  assert.equal(added.length, 1, 'the Google footprint under OSM way 103 is skipped');
  assert.deepEqual({ ...added[0].tags }, { building: 'residential', height: '4', 'mapng:source': 'overture' });
  assert.ok(added[0].id < -1e11, 'ids clear of OSM and R2 piece ids');
});

test('hybrid: fetchOSMData merges Overture buildings into live OSM; toggle off skips it', async () => {
  const { fetchOSMData, getLastOSMRequestInfo, OVERTURE_BUILDINGS_STORAGE_KEY, setOsmTileSource } = await import('../services/osm.js');
  const { PMTiles } = await import('pmtiles');
  const { gzipSync } = await import('node:zlib');
  // Live OSM from a stubbed MapNG tile archive: one road, no buildings.
  const payload = { elements: [{ type: 'way', id: 1, tags: { highway: 'residential' },
    geometry: [{ lat: 35.196, lon: -111.655 }, { lat: 35.2, lon: -111.65 }] }] };
  const orig = { getHeader: PMTiles.prototype.getHeader, getZxy: PMTiles.prototype.getZxy, storage: globalThis.localStorage };
  PMTiles.prototype.getHeader = async () => ({ minLon: -115, maxLon: -109, minLat: 31, maxLat: 37, maxZoom: 13 });
  PMTiles.prototype.getZxy = async () => ({ data: new TextEncoder().encode(JSON.stringify(payload)).buffer });
  const ml = encodeMvt({ building: [{ type: 3, props: { id: 'ml', subtype: 'residential', height: 4.2, sources: JSON.stringify([{ dataset: 'Microsoft ML Buildings' }]) }, parts: [square(1500, 1500)] }] });
  let overtureReads = 0;
  setOvertureArchiveFactory(() => ({
    getHeader: async () => ({ maxZoom: Z }),
    getZxy: async (z, x, y) => { overtureReads++; return x === X && y === Y ? { data: ml.buffer } : undefined; },
  }));
  const store = new Map();
  globalThis.localStorage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v), removeItem: (k) => store.delete(k) };
  const bounds = { west: -111.66, east: -111.645, south: 35.195, north: 35.205 };
  try {
    setOsmTileSource({ getKey: () => 'stub', getBytes: async () => ({ data: gzipSync(Buffer.alloc(1)).buffer }) });
    const features = await fetchOSMData(bounds);
    const info = getLastOSMRequestInfo();
    assert.equal(info.endpointUsed, 'mapng-osm-tiles');
    assert.deepEqual(info.overtureBuildings, { release: OVERTURE_RELEASE, heightsAdded: 0, footprintsAdded: 1 });
    assert.ok(features.some((f) => f.type === 'building' && f.tags.height === '4.2'));

    store.set(OVERTURE_BUILDINGS_STORAGE_KEY, 'false');
    overtureReads = 0;
    const plain = await fetchOSMData(bounds);
    assert.equal(overtureReads, 0, 'no Overture reads with the toggle off');
    assert.ok(!plain.some((f) => f.type === 'building'));
    assert.equal(getLastOSMRequestInfo().overtureBuildings, undefined);
  } finally {
    setOsmTileSource(null);
    setOvertureArchiveFactory(null);
    PMTiles.prototype.getHeader = orig.getHeader;
    PMTiles.prototype.getZxy = orig.getZxy;
    globalThis.localStorage = orig.storage;
  }
});
