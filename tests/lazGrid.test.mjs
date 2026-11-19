import test from 'node:test';
import assert from 'node:assert/strict';
import { poolFineCells, relaxFilled } from '../services/lazGrid.js';

// Cells finer than the points: each takes its neighbours' points (1-2-1 each way); a lone point's cell keeps its
// height, and the empty cells beside it get the same measured height, not a filled one.
test('pooling fine cells: means of measured points, gaps between scan lines get measured heights', () => {
  const w = 5, h = 5; const sum = new Float64Array(w * h); const cnt = new Uint32Array(w * h);
  sum[12] = 10; cnt[12] = 1;                       // one point of height 10 in the middle
  poolFineCells(sum, cnt, w, h);
  assert.equal(sum[12] / cnt[12], 10); assert.equal(sum[11] / cnt[11], 10); assert.equal(cnt[0], 0);
  assert.equal(cnt[12], 4); assert.equal(cnt[11], 2); assert.equal(cnt[6], 1);
});

// The filled cells relax toward a smooth surface between the measured ones, which never change.
test('smoothing filled cells: measured cells unchanged, a hole becomes the plane between them', () => {
  const w = 9, h = 3; const z = new Float32Array(w * h); const holes = [];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x;
    if (x === 0 || x === w - 1) z[i] = x;          // measured: a slope of 1 per cell at both ends
    else { z[i] = x % 2 ? 0 : 8; holes.push(i); }   // a blotchy fill between them
  }
  relaxFilled(z, w, h, Int32Array.from(holes));
  for (let y = 0; y < h; y++) { assert.equal(z[y * w], 0); assert.equal(z[y * w + w - 1], 8); for (let x = 1; x < w - 1; x++) assert.ok(Math.abs(z[y * w + x] - x) < 0.05, `${x}: ${z[y * w + x]}`); }
});
