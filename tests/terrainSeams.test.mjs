// services/terrainSeams.js: the seams of the export's own edits relaxed, roads and the surveyed ground beyond left.
import test from 'node:test';
import assert from 'node:assert/strict';
import { relaxSeams } from '../services/terrainSeams.js';

// a 40 x 40 grid of ground at 10 m; the export cut the east half (c >= 20) to 8 m, a hard 2 m step; a road runs
// north-south across the cut at c 24..26, held
const W = 40; const H = 40;
const scene = () => {
  const source = new Float32Array(W * H).fill(10);
  const hm = Float32Array.from(source);
  for (let r = 0; r < H; r++) for (let c = 20; c < W; c++) hm[r * W + c] = 9;
  return { source, hm };
};

test('the step an edit leaves is relaxed into a slope from the edit\'s side; the survey and the edit\'s inside stay', () => {
  const { source, hm } = scene();
  const s = relaxSeams({ heightMap: hm, source, width: W, height: H });
  const at = (c) => hm[20 * W + c];
  assert.ok(s.seam > 0 && s.moved > 0, JSON.stringify(s));
  // the edit's edge comes up toward the surveyed ground: no longer a 2 m step
  assert.ok(at(20) > 9.25, `the edit's edge ${at(20)}`);
  assert.ok(at(19) - at(20) < 0.75, `the step is softened: ${at(19) - at(20)}`);
  // never past the survey nor below the edit
  for (let c = 0; c < W; c++) assert.ok(at(c) <= 10 + 1e-6 && at(c) >= 9 - 1e-6);
  // the surveyed ground is exactly as measured, on the seam too; the edit's inside past the band as well
  assert.equal(at(19), 10); assert.equal(at(18), 10);
  assert.equal(at(30), 9);
});

test('held points (a road) are never moved, even on the seam', () => {
  const { source, hm } = scene();
  // the road along the seam itself: c 19..21
  const held = (i) => { const c = i % W; return c >= 19 && c <= 21; };
  const before = Float32Array.from(hm);
  const s = relaxSeams({ heightMap: hm, source, width: W, height: H, held });
  for (let r = 0; r < H; r++) for (const c of [19, 20, 21]) assert.equal(hm[r * W + c], before[r * W + c]);
  assert.ok(s.held > 0);
});

test('no edits, nothing to do', () => {
  const source = new Float32Array(W * H).fill(5);
  const s = relaxSeams({ heightMap: Float32Array.from(source), source, width: W, height: H });
  assert.equal(s.seam, 0); assert.equal(s.moved, 0);
});

test('a deep edit (a cutting between its walls) keeps its shape', () => {
  const source = new Float32Array(W * H).fill(10);
  const hm = Float32Array.from(source);
  for (let r = 0; r < H; r++) for (let c = 20; c < W; c++) hm[r * W + c] = 4;   // 6 m down
  const s = relaxSeams({ heightMap: hm, source, width: W, height: H });
  assert.equal(s.moved, 0); assert.ok(s.deep > 0);
  assert.equal(hm[20 * W + 20], 4);
});

test('the sea floor is smoothed however deep: deepOk', () => {
  const source = new Float32Array(W * H).fill(10);
  const hm = Float32Array.from(source);
  for (let r = 0; r < H; r++) for (let c = 20; c < W; c++) hm[r * W + c] = 7;   // 3 m down, but sea floor
  const s = relaxSeams({ heightMap: hm, source, width: W, height: H, deepOk: () => true });
  assert.ok(s.moved > 0 && s.deep === 0);
  assert.ok(hm[20 * W + 20] > 7 && hm[20 * W + 20] <= 10);
});
