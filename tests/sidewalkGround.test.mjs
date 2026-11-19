import test from 'node:test';
import assert from 'node:assert/strict';

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
