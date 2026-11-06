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
