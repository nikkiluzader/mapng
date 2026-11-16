import test from 'node:test';
import assert from 'node:assert/strict';
import { wingWallRuns, wingWallTriangles, deckDistances, WING_FILL_M } from '../services/structures/wingWalls.js';

// a straight road along +x, 60 m on the ground then 40 m of deck; the road 4 m over the ground beside it
const graph = (zRoad = 4) => {
  const n = 51; const s = Array.from({ length: n }, (_, i) => i * 2);
  return {
    edges: [{ s, x: Float64Array.from(s), y: new Float64Array(n), half: 4, from: 1, to: 2 }],
    profile: { z: [new Float64Array(n).fill(zRoad)] },
    classes: { segments: [{ edge: 0, i0: 30, i1: 50, kind: 'deck' }] },
  };
};
const ground = (x, y) => (Math.abs(y) <= 5.01 ? 4 : 0);   // the fill: flat to the shoulder, the ground at 0 beside it

test('distance to the deck along the road, and none on the deck itself', () => {
  const { toDeck, kindOf } = deckDistances(graph());
  assert.equal(kindOf[0][30], 'deck'); assert.equal(toDeck[0][30], Infinity);
  assert.equal(toDeck[0][29], 2); assert.equal(toDeck[0][20], 20);
});

test('walls run both sides within the wing length where the road stands over the ground, not beyond', () => {
  const runs = wingWallRuns(graph(), { groundAt: ground });
  assert.equal(runs.length, 2);
  for (const r of runs) {
    const xs = r.stations.map((q) => q.x);
    assert.ok(Math.min(...xs) > 60 - WING_FILL_M - 2.01 && Math.max(...xs) < 60, `stations ${Math.min(...xs)}..${Math.max(...xs)}`);
    assert.ok(r.stations.every((q) => q.foot < 0 && q.outer > q.inner + 2));
  }
  // a road at the ground's own height: no wall
  assert.equal(wingWallRuns(graph(0.3), { groundAt: () => 0 }).length, 0);
  // another road's pavement right beside it: the block stops short, or is left out
  const tight = wingWallRuns(graph(), { groundAt: ground, onOtherRoad: (x, y) => y > 5.2 });
  assert.equal(tight.filter((r) => r.side === 1).length, 0);
  assert.equal(tight.filter((r) => r.side === -1).length, 1);
});

test('every face of a wall points out of it', () => {
  const runs = wingWallRuns(graph(), { groundAt: ground });
  for (const run of runs) {
    const tris = wingWallTriangles([run]);
    assert.ok(tris.length > 20);
    const q = run.stations[Math.floor(run.stations.length / 2)];
    // a point well inside the block: under its top, between its faces
    const c = [q.x, q.y + q.ny * (q.inner + q.outer) / 2, (q.z + q.foot) / 2];
    for (const [A, B, C] of tris) {
      const n = [(B[1] - A[1]) * (C[2] - A[2]) - (B[2] - A[2]) * (C[1] - A[1]), (B[2] - A[2]) * (C[0] - A[0]) - (B[0] - A[0]) * (C[2] - A[2]), (B[0] - A[0]) * (C[1] - A[1]) - (B[1] - A[1]) * (C[0] - A[0])];
      const m = [(A[0] + B[0] + C[0]) / 3 - c[0], (A[1] + B[1] + C[1]) / 3 - c[1], (A[2] + B[2] + C[2]) / 3 - c[2]];
      // (the parapet's inner face looks back over the block's top, towards the road: it faces away from the
      // parapet's own middle, which the dot with the block's middle does not show; checked apart)
      const onParapetInner = Math.abs(n[2]) < 1e-9 && Math.abs(n[0]) < 1e-9 && Math.min(A[2], B[2], C[2]) > q.z && Math.max(Math.abs(A[1]), Math.abs(B[1]), Math.abs(C[1])) < q.outer - 0.2;
      if (onParapetInner) { assert.ok(n[1] * q.ny < 0, 'the parapet inner face looks at the road'); continue; }
      assert.ok(n[0] * m[0] + n[1] * m[1] + n[2] * m[2] > 0, `side ${run.side}: a face looks into the wall`);
    }
  }
});
