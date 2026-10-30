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
  assert.equal(north(cut).length, 2, 'split around the building (1 m from the curb: no slab fits)');
  for (const r of north(cut)) for (const p of r.points) assert.ok(p[0] <= 0.5 || p[0] >= 29.5, `slab at x ${p[0]} inside the building`);
  assert.equal(cut.filter((r) => r.points[0][1] < 0).length, 1, 'the other side is untouched');
});

test('sidewalk runs stop where their slab would lie on another carriageway', async () => {
  const { buildSidewalkRuns } = await import('../services/beamngSidewalks.js');
  const side = { nodes: [[-100, 0, 14], [100, 0, 14]], half: 3, owner: 1, highway: 'residential', tags: { sidewalk: 'left' }, oneWay: true };
  // a sunken centre road beside it from x 0 on, its edge 4.5 m off the side road's centre
  const centre = { nodes: [[0, 8.5], [100, 8.5]].map(([x, y]) => [x, y, 10]), half: 4, owner: 2, highway: 'primary', tags: { sidewalk: 'no' }, oneWay: true };
  const runs = buildSidewalkRuns([side, centre]).filter((r) => r.owner === 1);
  assert.ok(runs.length >= 1);
  // beside the centre road the slab narrows to fit (its back edge clear of
  // the other road's edge, 4.5 m out) or stops; full width elsewhere
  for (const r of runs) {
    if (r.points.some((p) => p[0] > 0.5)) assert.ok(3 + r.width + 0.15 <= 4.5 - 0.3 + 1e-6, `slab ${r.width} m wide reaches the centre road`);
  }
  assert.ok(runs.some((r) => r.width === 2 && r.points.every((p) => p[0] <= 0.5)), 'full width where nothing is beside it');
});

test('a sidewalk narrows to fit between the curb and a building front', async () => {
  const { buildSidewalkRuns } = await import('../services/beamngSidewalks.js');
  const cw = { nodes: [[-100, 0, 10], [100, 0, 10]], half: 3.5, owner: 1, highway: 'residential', tags: { sidewalk: 'both' }, oneWay: false };
  // house fronts 1.6 m from the north curb from x 0 to 60: a 2 m slab does not fit, 1.5 m does
  const runs = buildSidewalkRuns([cw], { buildings: [[[0, 5.1], [60, 5.1], [60, 30], [0, 30]]] }).filter((r) => r.points[0][1] > 0);
  const narrow = runs.find((r) => r.points[0][0] <= 10 && r.points[r.points.length - 1][0] >= 50);
  assert.ok(narrow, 'kept along the houses');
  assert.ok(narrow.width < 2 && narrow.width >= 1, `width ${narrow.width}`);
  assert.ok(runs.some((r) => r.width === 2), 'full width past them');
});
