import test from 'node:test';
import assert from 'node:assert/strict';

import { fetchCopernicusGrid } from '../services/copernicus.js';

const B = { north: -23.563, south: -23.582, west: -46.700, east: -46.680 };   // a 2 km box
const tile = (v) => new Float32Array(512 * 512).fill(v);

test('outside lidar: GLO-30 from the z12 tiles on the requested grid', async () => {
  const asked = [];
  const loadTile = async (z, x, y) => { asked.push(z); return z === 13 ? null : tile(740); };
  const g = await fetchCopernicusGrid(B, 64, { loadTile });
  assert.equal(g.length, 64 * 64);
  assert.ok(Math.abs(g[100] - 740) < 1e-3);
  assert.ok(asked.includes(12));
});

test('in a lidar region nothing is returned (z12 there is downsampled lidar, not GLO-30)', async () => {
  const loadTile = async (z) => (z === 13 ? tile(0) : tile(740));
  assert.equal(await fetchCopernicusGrid(B, 64, { loadTile }), null);
});

test('no tiles at all: null', async () => {
  assert.equal(await fetchCopernicusGrid(B, 64, { loadTile: async () => null }), null);
});
