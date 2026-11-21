// services/padToSquare.js: a rectangular map made square for the export, its shape kept.
import test from 'node:test';
import assert from 'node:assert/strict';
import { padTerrainToSquare, squareSideFor } from '../services/padToSquare.js';

const rect = (W, H) => {
  const hm = new Float32Array(W * H); for (let r = 0; r < H; r++) for (let c = 0; c < W; c++) hm[r * W + c] = c + r * 1000;
  return { width: W, height: H, heightMap: hm, minHeight: 0, maxHeight: 1e6, bounds: { north: 1, south: 0, west: 0, east: 2 },
    landCover: { grid: Uint8Array.from({ length: 4 * 4 }, (_, i) => i + 1), n: 4 } };
};

test('the square side is the power of two holding the long side', () => {
  assert.equal(squareSideFor(1024, 512), 1024); assert.equal(squareSideFor(1536, 512), 2048); assert.equal(squareSideFor(300, 900), 1024);
});

test('a 2:1 map: centred, its heights exact, the padding stretched from its edge, the bounds at its own scale', async () => {
  const { terrainData: t, shape, offset, padded } = await padTerrainToSquare(rect(8, 4));
  assert.equal(padded, true); assert.equal(t.width, 8); assert.equal(t.height, 8);
  assert.deepEqual(offset, { x: 0, y: 2 });
  assert.deepEqual(shape, { size: 8, rects: [[0, 2, 8, 4]] });
  for (let r = 0; r < 4; r++) for (let c = 0; c < 8; c++) assert.equal(t.heightMap[(r + 2) * 8 + c], c + r * 1000);
  assert.deepEqual([...t.heightMap.subarray(0, 8)], [...t.heightMap.subarray(16, 24)], 'rows above copy the first row');
  // degrees per pixel unchanged: 1/4 lat and 2/8 lng a pixel; the rectangle's own edges where they were
  assert.ok(Math.abs((t.bounds.north - t.bounds.south) / 8 - 0.25) < 1e-12 && Math.abs((t.bounds.east - t.bounds.west) / 8 - 0.25) < 1e-12);
  assert.ok(Math.abs(t.bounds.north - 1.5) < 1e-12 && Math.abs(t.bounds.south + 0.5) < 1e-12);
  // land cover: the rectangle's cells where it is, none in the padding
  assert.equal(t.landCover.n, 64); assert.equal(t.landCover.grid[0], 0);
  const mid = t.landCover.grid[32 * 64 + 0]; assert.ok(mid > 0);
});

test('a square map with a footprint is left as it is, the footprint its shape', async () => {
  const td = rect(4, 4);
  const r = await padTerrainToSquare(td, { footprint: [[0, 0, 2, 4]] });
  assert.equal(r.padded, false); assert.equal(r.terrainData, td); assert.deepEqual(r.shape, { size: 4, rects: [[0, 0, 2, 4]] });
});
