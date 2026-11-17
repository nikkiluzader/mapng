import test from 'node:test';
import assert from 'node:assert/strict';
import { planQuayWalls, quayWallTriangles } from '../services/quayWalls.js';

// a straight bank along y = 0: water (y < 0) surveyed at 10, its bed dug to 8.5; land behind at `top`, reached over `slope` metres
const scene = (top, slope) => ({
  surveyAt: (x, y) => (y < 0 ? 10 : Math.min(top, 10 + ((top - 10) * y) / slope)),
  groundAt: (x, y) => (y < 0 ? 8.5 : Math.min(top, 10 + ((top - 10) * y) / slope)),
});
const line = [{ xy: [[0, 0], [60, 0]] }];

test('quay walls: a block over a steep bank at the water, its top level with the ground behind and its face in the water', () => {
  const runs = planQuayWalls(line, scene(12, 2));
  assert.equal(runs.length, 1);
  const st = runs[0].stations;
  assert.ok(st.length >= 25, `stations along 60 m: ${st.length}`);
  for (const q of st) {
    assert.ok(Math.abs(q.z - 12.02) < 0.05, `top at the ground behind: ${q.z}`);
    assert.ok(q.ny > 0.99, 'the land is on +y');
    assert.ok(q.outer < 0.1 && q.inner > 1.9 && q.inner < 3.5, `the block covers the bank: ${q.outer} to ${q.inner}`);
    assert.ok(q.foot <= 8.5 - 1.9, `its foot under the bed: ${q.foot}`);
  }
  // every face triangle that looks at the water has its normal pointing to -y
  const tris = quayWallTriangles(runs);
  let faces = 0;
  for (const [A, B, C] of tris) {
    const ny = (B[2] - A[2]) * (C[0] - A[0]) - (B[0] - A[0]) * (C[2] - A[2]);
    const flat = Math.abs(A[1] - B[1]) < 1e-6 && Math.abs(A[1] - C[1]) < 1e-6;
    if (flat && A[1] < 1) { faces++; assert.ok(ny < 0, 'the face looks at the water'); }
  }
  assert.ok(faces > 20);
});

test('quay walls: none on a low shore, a wide sloping bank, open country, or where no water was dug', () => {
  assert.equal(planQuayWalls(line, scene(10.5, 1)).length, 0, 'a shore half a metre over the water');
  assert.equal(planQuayWalls(line, scene(13, 12)).length, 0, 'a bank sloping over 12 m');
  assert.equal(planQuayWalls(line, { ...scene(12, 2), hardAt: () => false }).length, 0, 'no town behind it');
  const dry = scene(12, 2);
  assert.equal(planQuayWalls(line, { ...dry, groundAt: dry.surveyAt }).length, 0, 'the ground as surveyed: no water there');
});

test('quay walls: a second outline of the same water adds no second wall', () => {
  const runs = planQuayWalls([line[0], { xy: [[0, 0.4], [60, 0.4]] }], scene(12, 2));
  assert.equal(runs.length, 1);
});
