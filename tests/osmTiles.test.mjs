import test from 'node:test';
import assert from 'node:assert/strict';
import { gzipSync } from 'node:zlib';

import { mergeTileElements, tilesCovering } from '../services/osmTiles.js';
import { OSM_FILTER, buildOverpassQuery } from '../services/overpassQuery.js';

test('tilesCovering matches the XYZ scheme the builder writes', () => {
  // Flagstaff test box spans two z13 tiles vertically (checked against the Python builder).
  const tiles = tilesCovering({ north: 35.2158, south: 35.2065, east: -111.4075, west: -111.4188 }, 13);
  assert.deepEqual(tiles, [{ x: 1560, y: 3238 }, { x: 1560, y: 3239 }]);
});

test('merge: whole elements de-duplicate; split relations union their members', () => {
  const way = { type: 'way', id: 7, tags: { highway: 'residential' }, geometry: [] };
  const relA = { type: 'relation', id: 9, tags: { waterway: 'river' }, members: [{ type: 'way', ref: 1, role: '' }] };
  const relB = { type: 'relation', id: 9, tags: { waterway: 'river' }, members: [{ type: 'way', ref: 1, role: '' }, { type: 'way', ref: 2, role: '' }] };
  const piece1 = { type: 'relation', id: -1, tags: { landuse: 'forest' }, members: [] };
  const piece2 = { type: 'relation', id: -2, tags: { landuse: 'forest' }, members: [] };
  const merged = mergeTileElements([{ elements: [way, relA, piece1] }, { elements: [way, relB, piece2] }]);
  assert.equal(merged.elements.filter((e) => e.type === 'way').length, 1);
  const river = merged.elements.find((e) => e.id === 9);
  assert.deepEqual(river.members.map((m) => m.ref), [1, 2]);
  assert.equal(relA.members.length, 1, 'inputs are not mutated');
  assert.equal(merged.elements.filter((e) => e.id < 0).length, 2, 'area pieces kept');
});

test('the live query is generated from OSM_FILTER (one spec for tiles and Overpass)', () => {
  const q = buildOverpassQuery({ south: 1, west: 2, north: 3, east: 4 });
  for (const k of OSM_FILTER.wayKeys) assert.ok(q.includes(`way["${k}"](1,2,3,4);`), k);
  for (const [k, v] of OSM_FILTER.nodeTags) assert.ok(q.includes(`node["${k}"="${v}"](1,2,3,4);`), `${k}=${v}`);
  assert.match(q, /out body geom;/);
});

test('fetchOSMData reads from a configured tile archive before Overpass', async () => {
  // A one-tile in-memory PMTiles archive written by hand is overkill here;
  // stub the archive through the pmtiles Source interface instead.
  const { setOsmTileSource, fetchOSMData, getLastOSMRequestInfo } = await import('../services/osm.js');
  const { PMTiles } = await import('pmtiles');
  const origGetHeader = PMTiles.prototype.getHeader;
  const origGetZxy = PMTiles.prototype.getZxy;
  const payload = { elements: [{ type: 'way', id: 1, tags: { highway: 'residential' },
    geometry: [{ lat: 35.21, lon: -111.415 }, { lat: 35.211, lon: -111.41 }] }] };
  PMTiles.prototype.getHeader = async () => ({ minLon: -115, maxLon: -109, minLat: 31, maxLat: 37, maxZoom: 13 });
  PMTiles.prototype.getZxy = async () => ({ data: new TextEncoder().encode(JSON.stringify(payload)).buffer });
  const origFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error('Overpass must not be called'); };
  try {
    setOsmTileSource({ getKey: () => 'stub', getBytes: async () => ({ data: gzipSync(Buffer.alloc(1)).buffer }) });
    const features = await fetchOSMData({ north: 35.2158, south: 35.2065, east: -111.4075, west: -111.4188 });
    assert.equal(getLastOSMRequestInfo().endpointUsed, 'mapng-osm-tiles');
    assert.ok(features.some((f) => f.type === 'road'));
  } finally {
    setOsmTileSource(null);
    PMTiles.prototype.getHeader = origGetHeader;
    PMTiles.prototype.getZxy = origGetZxy;
    globalThis.fetch = origFetch;
  }
});

test('archiveCovers uses the coverage outline, not just the bbox', async () => {
  const { archiveCovers } = await import('../services/osmTiles.js');
  const { readFileSync } = await import('node:fs');
  const manifest = JSON.parse(readFileSync(new URL('./helpers/osm-manifest-arizona.json', import.meta.url), 'utf8'));
  const az = manifest.archives.find((a) => a.region === 'arizona');
  const box = (lat, lng, d = 0.005) => ({ south: lat - d, north: lat + d, west: lng - d, east: lng + d });
  assert.equal(archiveCovers(az, box(35.21, -111.41)), true, 'Flagstaff');
  assert.equal(archiveCovers(az, box(31.5, -113.5)), false, 'Sonora: inside the bbox, outside Arizona');
  assert.equal(archiveCovers(az, box(36.1, -115.15)), false, 'Las Vegas');
  assert.equal(archiveCovers(az, box(37.0, -111.0, 0.02)), false, 'straddling the Utah line');
});

test('compact tiles expand to the exact Overpass JSON; old tiles pass through', async () => {
  const { expandCompactTile } = await import('../services/osmTiles.js');
  const compact = { v: 2, e: [
    ['n', 5, 352100000, -1114150000, { amenity: 'fuel' }],
    ['w', 7, { highway: 'residential' }, [352100000, -1114150000, 10000, 50000]],
    ['r', -3, { landuse: 'forest', 'mapng:relation': '42' }, [
      ['w', -1, 'outer', [352000001, -1114000001, 1, -2]],
      ['n', 11, 'label', 352000000, -1114000000],
    ]],
  ] };
  const overpass = { elements: [
    { type: 'node', id: 5, lat: 35.21, lon: -111.415, tags: { amenity: 'fuel' } },
    { type: 'way', id: 7, tags: { highway: 'residential' }, geometry: [{ lat: 35.21, lon: -111.415 }, { lat: 35.211, lon: -111.41 }] },
    { type: 'relation', id: -3, tags: { landuse: 'forest', 'mapng:relation': '42' }, members: [
      { type: 'way', ref: -1, role: 'outer', geometry: [{ lat: 35.2000001, lon: -111.4000001 }, { lat: 35.2000002, lon: -111.4000003 }] },
      { type: 'node', ref: 11, role: 'label', lat: 35.2, lon: -111.4 },
    ] },
  ] };
  assert.equal(JSON.stringify(expandCompactTile(compact)), JSON.stringify(overpass));
  assert.equal(expandCompactTile(overpass), overpass);
});

test('a covered area reads MapNG tiles even with the user\'s own Overpass server set', async () => {
  // A paid Tracestrack / Overspan key is only spent where MapNG has no tiles.
  const { setOsmTileSource, fetchOSMData, getLastOSMRequestInfo, CUSTOM_OVERPASS_STORAGE_KEY } = await import('../services/osm.js');
  const { PMTiles } = await import('pmtiles');
  const origGetHeader = PMTiles.prototype.getHeader;
  const origGetZxy = PMTiles.prototype.getZxy;
  const payload = { elements: [{ type: 'way', id: 1, tags: { highway: 'residential' },
    geometry: [{ lat: 35.21, lon: -111.415 }, { lat: 35.211, lon: -111.41 }] }] };
  PMTiles.prototype.getHeader = async () => ({ minLon: -115, maxLon: -109, minLat: 31, maxLat: 37, maxZoom: 13 });
  PMTiles.prototype.getZxy = async () => ({ data: new TextEncoder().encode(JSON.stringify(payload)).buffer });
  const origStorage = globalThis.localStorage;
  const store = new Map([[CUSTOM_OVERPASS_STORAGE_KEY, 'https://api.tracestrack.com/overpass/SECRET/interpreter']]);
  globalThis.localStorage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v), removeItem: (k) => store.delete(k) };
  const origFetch = globalThis.fetch;
  const called = [];
  globalThis.fetch = async (url) => { called.push(String(url)); throw new Error('no Overpass call expected'); };
  try {
    setOsmTileSource({ getKey: () => 'stub', getBytes: async () => ({ data: gzipSync(Buffer.alloc(1)).buffer }) });
    const features = await fetchOSMData({ north: 35.2158, south: 35.2065, east: -111.4075, west: -111.4188 });
    assert.equal(getLastOSMRequestInfo().endpointUsed, 'mapng-osm-tiles');
    assert.ok(features.some((f) => f.type === 'road'));
    assert.deepEqual(called, [], 'the custom server (and every mirror) stays unused');
  } finally {
    setOsmTileSource(null);
    PMTiles.prototype.getHeader = origGetHeader;
    PMTiles.prototype.getZxy = origGetZxy;
    globalThis.fetch = origFetch;
    globalThis.localStorage = origStorage;
  }
});

test('a tile whose read fails is asked again; an abort is not', async () => {
  const { readTile } = await import('../services/osmTiles.js');
  let calls = 0;
  const flaky = { getZxy: async () => { calls++; if (calls < 3) throw new TypeError('fetch failed'); return { data: new Uint8Array([1]) }; } };
  assert.deepEqual([...(await readTile(flaky, 1, 2)).data], [1]);
  assert.equal(calls, 3);
  // (never working: the error comes out after the third try)
  let dead = 0;
  await assert.rejects(readTile({ getZxy: async () => { dead++; throw new TypeError('fetch failed'); } }, 1, 2), /fetch failed/);
  assert.equal(dead, 3);
  let aborted = 0;
  const abort = Object.assign(new Error('stop'), { name: 'AbortError' });
  await assert.rejects(readTile({ getZxy: async () => { aborted++; throw abort; } }, 1, 2), /stop/);
  assert.equal(aborted, 1);
});

test('an area in the last row of tiles under an archive edge given to six decimals is covered', async () => {
  const { planTileSources } = await import('../services/osmTiles.js');
  // the planet archives meet at 40.97989806962013 N (a zoom 3 tile edge); the manifest says 40.979898
  const archives = [
    { key: 'south', bounds: [0, 0, 45, 40.979898], built_at: '2026-11-12T00:00:00Z' },
    { key: 'north', bounds: [0, 40.979898, 45, 66.513260], built_at: '2026-11-12T00:00:00Z' },
  ];
  const box = (lat, lng, km) => { const dLat = (km * 500) / 111320; const dLng = dLat / Math.cos((lat * Math.PI) / 180); return { north: lat + dLat, south: lat - dLat, east: lng + dLng, west: lng - dLng }; };
  // north of Naples, 4 km: its top row of tiles ends on the edge
  const plan = planTileSources(archives, box(40.93024, 14.3684, 4));
  assert.ok(plan, 'covered');
  assert.deepEqual(plan.map((p) => p.key), ['south']);
  // 16 km: across the edge, from both
  const both = planTileSources(archives, box(40.93024, 14.3684, 16));
  assert.deepEqual(both.map((p) => p.key).sort(), ['north', 'south']);
  // and an area outside every archive is still not covered
  assert.equal(planTileSources(archives, box(40.9, -3, 4)), null);
});
