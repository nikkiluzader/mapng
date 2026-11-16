import test from 'node:test';
import assert from 'node:assert/strict';
import { wingWallRuns, wingWallTriangles, deckDistances, deckDistancesThrough, WING_FILL_M } from '../services/structures/wingWalls.js';

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
    // (the test's fill has vertical sides all along: walled the whole way, and never on the deck)
    assert.ok(Math.min(...xs) === 0 && Math.max(...xs) < 60, `stations ${Math.min(...xs)}..${Math.max(...xs)}`);
    assert.ok(r.stations.every((q) => q.foot < 0 && q.outer > q.inner + 2));
  }
  // a 1 in 2 slope beside the road instead of a step: walls at the wing only (15 m), none further out
  const slope = (x, y) => Math.max(0, 4 - Math.max(0, Math.abs(y) - 5) / 2);
  for (const r of wingWallRuns(graph(), { groundAt: slope })) assert.ok(Math.min(...r.stations.map((q) => q.x)) > 60 - WING_FILL_M - 2.01);
  // a road at the ground's own height: no wall
  assert.equal(wingWallRuns(graph(0.3), { groundAt: () => 0 }).length, 0);
  // another road's pavement right beside it: the block stops short, or is left out
  const tight = wingWallRuns(graph(), { groundAt: ground, onOtherRoad: (x, y) => y > 5.2 });
  // (a lower street right against the shoulder: a thin wall on the shoulder's edge, with its parapet)
  const thin = tight.find((r) => r.side === 1);
  assert.ok(thin && thin.stations.every((q) => q.outer < 5.5 && q.outer - q.inner >= 0.3 - 1e-9 && q.inner >= 4 && q.parapet > 0), 'a thin wall beside the lower street');
  // (the other carriageway of the same road at the same height, a 3 m trench between: filled to its pavement, no parapet)
  const dual = (x, y) => (Math.abs(y) <= 5.01 || (y > 8 && y < 18) ? 4 : 0);
  const median = wingWallRuns(graph(), { groundAt: dual, onOtherRoad: (x, y) => y > 8.5 && y < 17.5 }).find((r) => r.side === 1);
  assert.ok(median && median.stations.every((q) => q.parapet === 0 && q.outer < 8.7 && q.outer > 7.5), 'a block to the other pavement, no parapet');
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

test('the distance to a deck carries on through a junction to the next edge of the road', () => {
  // edge 0: 6 m of road then the deck; edge 1: the street on from edge 0's start, 100 m
  const g = {
    edges: [
      { s: [0, 3, 6, 9, 12], x: Float64Array.from([0, 3, 6, 9, 12]), y: new Float64Array(5), half: 3, from: 1, to: 2 },
      { s: [0, 50, 100], x: Float64Array.from([0, -50, -100]), y: new Float64Array(3), half: 3, from: 1, to: 3 },
    ],
    profile: { z: [new Float64Array(5), new Float64Array(3)] },
    classes: { segments: [{ edge: 0, i0: 2, i1: 4, kind: 'deck' }] },
  };
  assert.equal(deckDistances(g).toDeck[1][1], Infinity);
  const through = deckDistancesThrough(g, 120).toDeck;
  assert.equal(through[0][0], 6); assert.equal(through[1][0], 6); assert.equal(through[1][1], 56); assert.equal(through[1][2], 106);
  assert.equal(deckDistancesThrough(g, 60).toDeck[1][2], Infinity);
});

test('a wing wall\'s faces run into the ground on a clean foot, not fitted station by station', async () => {
  const { wingWallTriangles } = await import('../services/structures/wingWalls.js');
  // six stations 4 m apart; the ground (so each station's own foot) dips 1.5 m at the third
  const own = [9.4, 9.4, 7.9, 9.4, 9.4, 9.4];
  const run = { side: 1, stations: own.map((foot, i) => ({ x: i * 4, y: 0, z: 12, nx: 0, ny: 1, inner: 3, outer: 3.4, foot, parapet: 0 })) };
  const zs = wingWallTriangles([run]).flat().filter((p) => p[2] < 11).map((p) => p[2]);
  assert.ok(zs.length > 0);
  // every foot under the dip's ground (7.9 + 0.6 = 8.5) by more than a metre: none can show at the dip
  assert.ok(Math.max(...zs) <= 7.9 - 1.3, `feet at ${[...new Set(zs.map((v) => v.toFixed(1)))]}`);
});
