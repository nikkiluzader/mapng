// The planet tiles: their manifest, and the filter applied on reading them
import test from 'node:test';
import assert from 'node:assert/strict';
import { matchesOsmFilter, OSM_FILTER } from '../services/overpassQuery.js';
import { planetManifest, z3Bounds } from '../scripts/planet/planetManifest.mjs';
import { planTileSources, fetchOsmFromManifest, setOsmTileManifest } from '../services/osmTiles.js';

test('the filter on reading keeps what the Overpass query asks for, and nothing else', () => {
  for (const k of OSM_FILTER.wayKeys) assert.equal(matchesOsmFilter({ type: 'way', tags: { [k]: 'x' } }), true, k);
  for (const [k, v] of OSM_FILTER.wayTags) assert.equal(matchesOsmFilter({ type: 'way', tags: { [k]: v } }), true, `${k}=${v}`);
  for (const k of OSM_FILTER.relationKeys) assert.equal(matchesOsmFilter({ type: 'relation', tags: { [k]: 'x' } }), true, k);
  for (const [k, v] of OSM_FILTER.nodeTags) assert.equal(matchesOsmFilter({ type: 'node', tags: { [k]: v } }), true, `${k}=${v}`);
  // what a planet tile also holds
  assert.equal(matchesOsmFilter({ type: 'way', tags: { boundary: 'administrative' } }), false);
  assert.equal(matchesOsmFilter({ type: 'way', tags: { railway: 'abandoned' } }), false);
  assert.equal(matchesOsmFilter({ type: 'relation', tags: { type: 'route', route: 'bus' } }), false);
  assert.equal(matchesOsmFilter({ type: 'relation', tags: { highway: 'pedestrian', type: 'multipolygon' } }), false);   // (the query asks for no relation by highway)
  assert.equal(matchesOsmFilter({ type: 'node', tags: { amenity: 'school' } }), false);
  assert.equal(matchesOsmFilter({ type: 'node', tags: { highway: 'crossing' } }), false);
  assert.equal(matchesOsmFilter({ type: 'node' }), false);
});

test('the manifest: one archive per zoom-3 tile, each covering its tile, marked as holding everything', () => {
  const m = planetManifest(['planet-3-4-2-2026-11-12.pmtiles', 'planet-3-3-2-2026-11-12.pmtiles', 'notes.txt'], { snapshot: '2026-11-02' });
  assert.equal(m.archives.length, 2);
  const east = m.archives.find((a) => a.region === 'planet-3-4-2');
  assert.deepEqual(east.bounds.map((v) => Math.round(v * 100) / 100), [0, 40.98, 45, 66.51]);
  assert.equal(east.key, 'osm-all/planet-3-4-2-2026-11-12.pmtiles'); assert.equal(east.all, true); assert.equal(east.snapshot, '2026-11-02');
  assert.deepEqual(z3Bounds(0, 0).slice(0, 1), [-180]);
  // a map across the Greenwich meridian reads from both
  const plan = planTileSources(m.archives, { north: 51.49, south: 51.47, west: -0.02, east: 0.02 });
  assert.equal(plan.length, 2);
  // one outside both is not covered (the caller goes to the live servers)
  assert.equal(planTileSources(m.archives, { north: 10, south: 9.99, west: 100, east: 100.01 }), null);
});

test('a planet archive is filtered on reading; the snapshot day comes back with the data', async () => {
  const m = planetManifest(['planet-3-4-2-2026-11-12.pmtiles'], { snapshot: '2026-11-02' });
  const tile = { v: 2, e: [['w', 1, { highway: 'residential' }, [515000000, 100000, 100, 100]], ['w', 2, { boundary: 'administrative' }, [515000000, 100000, 100, 100]], ['n', 3, 515000000, 100000, { amenity: 'school' }], ['n', 4, 515000000, 100000, { natural: 'tree' }]] };
  const bytes = new TextEncoder().encode(JSON.stringify(tile));
  // (a stand-in archive: every tile asked for answers with the one above)
  const { PMTiles } = await import('pmtiles');
  const real = PMTiles.prototype.getZxy; PMTiles.prototype.getZxy = async () => ({ data: bytes.buffer });
  try {
    setOsmTileManifest(m, (key) => ({ getKey: () => key, getBytes: async () => ({ data: new ArrayBuffer(0) }) }));
    const out = await fetchOsmFromManifest({ north: 51.5005, south: 51.5, west: 0.01, east: 0.0105 });
    assert.deepEqual(out.elements.map((e) => `${e.type}/${e.id}`).sort(), ['node/4', 'way/1']);
    assert.equal(out.osmSnapshot, '2026-11-02');
  } finally { PMTiles.prototype.getZxy = real; setOsmTileManifest(null); }
});
