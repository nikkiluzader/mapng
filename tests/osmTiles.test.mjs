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
