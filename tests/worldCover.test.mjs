import test from 'node:test';
import assert from 'node:assert/strict';
import { worldCoverTileName, plantAllowed, WC } from '../services/worldCover.js';

test('WorldCover tiles are named by their 3° south-west corner', () => {
  assert.equal(worldCoverTileName(45.5, 6.94), 'ESA_WorldCover_10m_2021_v200_N45E006_Map.tif');
  assert.equal(worldCoverTileName(-33.9, 18.4), 'ESA_WorldCover_10m_2021_v200_S36E018_Map.tif');
  assert.equal(worldCoverTileName(40.7, -74.0), 'ESA_WorldCover_10m_2021_v200_N39W075_Map.tif');
});

test('what may grow where: wood trees on tree cover, never on rock or snow; mapped bushes mostly anywhere but snow', () => {
  assert.equal(plantAllowed(WC.TREES, 'wood', 0.99), true);
  assert.equal(plantAllowed(WC.BARE, 'wood', 0), false);
  assert.equal(plantAllowed(WC.SNOW, 'wood', 0), false);
  assert.equal(plantAllowed(WC.GRASS, 'wood', 0.5), false);
  assert.equal(plantAllowed(WC.GRASS, 'wood', 0.01), true);
  assert.equal(plantAllowed(WC.SNOW, 'bush', 0), false);
  assert.equal(plantAllowed(WC.GRASS, 'bush', 0.99), true);
  assert.equal(plantAllowed(WC.BARE, 'scatter', 0), false);
  assert.equal(plantAllowed(0, 'wood', 0.99), true, 'no data (open sea, or WorldCover unreachable): as before');
});

test('a server answering with a web page (a dev server) is no land cover, and never a hang', async () => {
  const { fetchWorldCoverGrid } = await import('../services/worldCover.js');
  const real = globalThis.fetch;
  globalThis.fetch = async () => new Response('<!doctype html><html></html>', { status: 200, headers: { 'content-type': 'text/html' } });
  try {
    const t = Date.now();
    await assert.rejects(fetchWorldCoverGrid({ north: 45.6, south: 45.5, west: 6.9, east: 7.0 }, 8, 8, { base: 'https://example.invalid/' }), /not a GeoTIFF/);
    assert.ok(Date.now() - t < 2000);
    // and one that never answers gives up at the time limit
    globalThis.fetch = () => new Promise(() => {});
    await assert.rejects(fetchWorldCoverGrid({ north: 45.6, south: 45.5, west: 6.9, east: 7.0 }, 8, 8, { base: 'https://example.invalid/x/', timeoutMs: 200 }), /no answer/);
  } finally {
    globalThis.fetch = real;
  }
});

test('OSM trees with exact positions are never left out by the land cover; trees filling a mapped wood are', async () => {
  const { __buildForestPlacements } = await import('../services/exportBeamNGLevel.js');
  const { getBeamNGBiomeById } = await import('../services/beamngBiomeCatalog.js');
  const N = 257;
  const D = 0.004;   // ~445 m
  const td = {
    width: N, height: N, heightMap: new Float32Array(N * N).fill(100), minHeight: 100, maxHeight: 100,
    bounds: { south: 45 - D / 2, north: 45 + D / 2, west: 7 - D / 2, east: 7 + D / 2 },
    // all bare rock: no tree cover anywhere
    landCover: { grid: new Uint8Array(64 * 64).fill(60), n: 64 },
    osmFeatures: [
      { id: 'n1', type: 'vegetation', tags: { natural: 'tree' }, geometry: [{ lat: 45.0005, lng: 7.0005 }] },
      { id: 'n2', type: 'vegetation', tags: { natural: 'tree' }, geometry: [{ lat: 44.9995, lng: 6.9995 }] },
      { id: 'w1', type: 'landuse', tags: { natural: 'wood' }, geometry: [
        { lat: 44.9988, lng: 6.9988 }, { lat: 44.9988, lng: 7.0012 }, { lat: 45.0012, lng: 7.0012 }, { lat: 45.0012, lng: 6.9988 }, { lat: 44.9988, lng: 6.9988 }] },
    ],
  };
  const quiet = console.log; console.log = () => {};
  let out;
  try { out = await __buildForestPlacements(td, 1.7, { includeTrees: true, includeRocks: false }, getBeamNGBiomeById('east_coast_usa')); } finally { console.log = quiet; }
  const all = [...out.values()].flat();
  assert.ok(out.landCover?.used, 'the land cover was used');
  assert.ok(out.landCover.dropped.wood > 0, 'the wood\'s fill trees were left out on bare rock');
  // each mapped tree at its exact spot (and its neighbour copy within 6 m); no wood fill
  const { geoToWorldPoint } = await import('../services/terrainLookup.js');
  for (const f of td.osmFeatures.slice(0, 2)) {
    const [x, y] = geoToWorldPoint(f.geometry[0].lat, f.geometry[0].lng, td, 1.7, 0);
    assert.ok(all.some((p) => Math.hypot(p.pos[0] - x, p.pos[1] - y) < 0.05), `mapped tree ${f.id} at its spot`);
  }
  assert.ok(all.every((p) => td.osmFeatures.slice(0, 2).some((f) => { const [x, y] = geoToWorldPoint(f.geometry[0].lat, f.geometry[0].lng, td, 1.7, 0); return Math.hypot(p.pos[0] - x, p.pos[1] - y) < 6; })), 'nothing but the mapped trees and their neighbours');
});
