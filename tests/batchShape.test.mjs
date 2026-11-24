// services/batchShape.js: a shaped level's footprint, its row runs, and the selected square's bounds.
import test from 'node:test';
import assert from 'node:assert/strict';
import { computeGridBounds, footprintRows, inFootprint, keepSquareFor, fillOutsideFootprint } from '../services/batchShape.js';

test('the footprint: squares inside and between touching tiles kept, past the edge not', () => {
  // two 64 px tiles side by side, centred in a 128 square
  const L = { size: 128, rects: [[0, 32, 64, 64], [64, 32, 64, 64]], tiles: [{ x: 0, y: 32 }, { x: 64, y: 32 }] };
  const keep = keepSquareFor({ size: L.size, rects: L.rects });
  const N = L.size; const t0 = L.tiles[0];
  const j = (y) => N - 1 - y;   // terrain j of the square whose south row is y
  assert.equal(keep(t0.x + 5, j(t0.y + 5)), true);
  assert.equal(keep(t0.x + 63, j(t0.y + 5)), true, 'the square between the two tiles');
  assert.equal(keep(t0.x - 1, j(t0.y + 5)), false, 'west of the footprint');
  assert.equal(keep(t0.x + 5, j(t0.y)), false, 'its north row half outside');
  const rows = footprintRows(L.rects, N);
  assert.equal(inFootprint(rows, t0.x, t0.y), true); assert.equal(inFootprint(rows, t0.x + 128, t0.y), false);
});

test('outside the footprint the heights stretch out from its edge', () => {
  const N = 8; const h = new Float32Array(N * N).fill(-1);
  const rows = footprintRows([[2, 2, 2, 2], [6, 2, 2, 2]], N);
  for (let y = 2; y < 4; y++) for (let x = 0; x < N; x++) if (inFootprint(rows, x, y)) h[y * N + x] = x * 10 + y;
  fillOutsideFootprint(h, rows, N);
  assert.equal(h[2 * N + 0], 22); assert.equal(h[2 * N + 7], 72);
  assert.equal(h[2 * N + 4], 32, 'the gap: its west half from the west run');
  assert.equal(h[2 * N + 5], 62, 'its east half from the east run');
  assert.deepEqual([...h.subarray(0, N)], [...h.subarray(2 * N, 3 * N)], 'rows above copy the nearest row');
  assert.deepEqual([...h.subarray(7 * N, 8 * N)], [...h.subarray(3 * N, 4 * N)]);
  assert.ok(!h.includes(-1));
});

test('the previews’ footprint test and mask: rects, a road’s runs, a chunked level’s overview, none', async () => {
  const { footprintTest, footprintMaskPixels, previewShape } = await import('../services/batchShape.js');
  // an L of two 4 x 4 tiles on an 8 x 8 grid: the top-left and bottom-left quarters
  const td = { width: 8, height: 8, footprint: [[0, 0, 4, 4], [0, 4, 4, 4]] };
  const inside = footprintTest(td);
  assert.equal(inside(0.25, 0.25), true); assert.equal(inside(0.25, 0.75), true); assert.equal(inside(0.75, 0.25), false); assert.equal(inside(0.5, 0.5), false);
  const px = footprintMaskPixels(td, 4, 4, [1, 2, 3, 200]);
  const alpha = Array.from({ length: 16 }, (_, k) => px[k * 4 + 3]);
  assert.deepEqual(alpha, [0, 0, 200, 200, 0, 0, 200, 200, 0, 0, 200, 200, 0, 0, 200, 200]);
  // a road's corridor as row runs
  const road = footprintTest({ width: 10, height: 2, footprint: { runs: [[0, 2, 5], [1, 4, 9]] } });
  assert.equal(road(0.3, 0.25), true); assert.equal(road(0.3, 0.75), false); assert.equal(road(0.6, 0.75), true);
  // a chunked level's overview is smaller than its grid: the footprint is on the level's grid
  const ov = { width: 100, height: 50, chunked: { W: 8000, H: 4000, footprint: [[0, 0, 4000, 4000]] } };
  assert.deepEqual([previewShape(ov).W, previewShape(ov).H], [8000, 4000]);
  assert.equal(footprintTest(ov)(0.25, 0.5), true); assert.equal(footprintTest(ov)(0.75, 0.5), false);
  // a plain map: no test, no mask
  assert.equal(footprintTest({ width: 8, height: 8 }), null); assert.equal(footprintMaskPixels({ width: 8, height: 8 }, 4, 4), null);
});

test('grid bounds: the square around the centre, in metres on the ground', () => {
  const b = computeGridBounds({ lat: 0, lng: 10 }, 1024, 1, 1, 2048);
  const half = 1024 / 111320;
  assert.ok(Math.abs(b.north - half) < 1e-12 && Math.abs(b.south + half) < 1e-12);
  assert.ok(Math.abs(b.east - (10 + half)) < 1e-12 && Math.abs(b.west - (10 - half)) < 1e-12);
  // no span given: the output size in metres; a grid is cols x rows of them; longitude widens with latitude
  const g = computeGridBounds({ lat: 60, lng: 0 }, 1000, 3, 2);
  assert.ok(Math.abs((g.north - g.south) * 111320 - 2000) < 1e-6);
  assert.ok(Math.abs((g.east - g.west) * 111320 * Math.cos(60 * Math.PI / 180) - 3000) < 1e-6);
});
