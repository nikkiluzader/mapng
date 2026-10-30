import test from 'node:test';
import assert from 'node:assert/strict';
import { gradeSidewalkGround, checkSidewalkGround } from '../services/beamngSidewalks.js';

// a 200 m grid at 1 m, flat at 10 m; a road along y = 0 standing 3 m up on
// an embankment, a 2 m sidewalk on its left (north) edge
const N = 201; const SIZE = 200;
const grid = () => ({ heightMap: new Float32Array(N * N).fill(10), width: N, height: N, worldSize: SIZE, minHeight: 0 });
const groundAt = (g) => (x, y) => {
  const c = Math.round((x / SIZE + 0.5) * (N - 1)); const r = Math.round((0.5 - y / SIZE) * (N - 1));
  return g.heightMap[r * N + c] - g.minHeight;
};
const road = { nodes: [[-80, 0, 13], [80, 0, 13]], half: 3.5, owner: 1, highway: 'residential' };
const run = { points: [[-60, 3.5, 13], [60, 3.5, 13]], side: 1, width: 2, highway: 'residential' };

test('sidewalk ground: a slab beside a raised road floats until graded, then sits on the terrain', () => {
  const g = grid();
  const before = checkSidewalkGround([run], groundAt(g));
  assert.ok(before.floating > 0, 'floating before');
  gradeSidewalkGround([run], [road], g).apply((idx, v) => { g.heightMap[idx] = v; });
  const after = checkSidewalkGround([run], groundAt(g));
  assert.equal(after.floating, 0, `floating after: ${JSON.stringify(after.worst)}`);
  assert.equal(after.buried, 0, 'none buried');
  // the road's own surface is untouched, the ground far out too
  assert.equal(groundAt(g)(0, 0), 10);
  assert.equal(groundAt(g)(0, 40), 10);
});

test('sidewalk ground: never raised into a deck over it', () => {
  const g = grid();
  gradeSidewalkGround([run], [road], g, { overhead: (x) => x > 0 }).apply((idx, v) => { g.heightMap[idx] = v; });
  assert.ok(groundAt(g)(-30, 4.5) > 12, 'graded where open');
  assert.equal(groundAt(g)(30, 4.5), 10, 'left under the deck');
});

test('sidewalk runs stop where they would run into a building', async () => {
  const { buildSidewalkRuns } = await import('../services/beamngSidewalks.js');
  const cw = { nodes: [[-100, 0, 10], [100, 0, 10]], half: 3.5, owner: 1, highway: 'residential', tags: { sidewalk: 'both' }, oneWay: false };
  const open = buildSidewalkRuns([cw]);
  // a building on the north side from x 0 to 30, its wall 1 m off the curb
  const building = [[0, 4.5], [30, 4.5], [30, 30], [0, 30]];
  const cut = buildSidewalkRuns([cw], { buildings: [building] });
  const north = (runs) => runs.filter((r) => r.points[0][1] > 0);
  assert.equal(north(open).length, 1);
  assert.equal(north(cut).length, 2, 'split around the building');
  for (const r of north(cut)) for (const p of r.points) assert.ok(p[0] <= 0.5 || p[0] >= 29.5, `slab at x ${p[0]} inside the building`);
  assert.equal(cut.filter((r) => r.points[0][1] < 0).length, 1, 'the other side is untouched');
});
