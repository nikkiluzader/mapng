import test from 'node:test';
import assert from 'node:assert/strict';

import { buildMedianRuns, buildSidewalkMeshes, buildSidewalkRuns, findMedians, sidewalkSides } from '../services/beamngSidewalks.js';

const street = (overrides = {}) => ({
  owner: 1, half: 4, highway: 'residential', urban: true, tags: { sidewalk: 'both' }, continuations: [],
  nodes: Array.from({ length: 21 }, (_, i) => [-100 + i * 10, 0, 5, 8]),
  ...overrides,
});

test('sidewalk tags decide the sides; untagged urban streets get both', () => {
  assert.deepEqual(sidewalkSides({ tags: { sidewalk: 'both' } }), { left: 2, right: 2 });
  assert.deepEqual(sidewalkSides({ tags: { sidewalk: 'left', 'sidewalk:width': '3' } }), { left: 3, right: 0 });
  assert.deepEqual(sidewalkSides({ tags: { sidewalk: 'separate' }, highway: 'residential', urban: true }), { left: 0, right: 0 });
  assert.deepEqual(sidewalkSides({ tags: { 'sidewalk:right': 'yes', 'sidewalk:left': 'no' } }), { left: 0, right: 2 });
  assert.deepEqual(sidewalkSides({ tags: {}, highway: 'residential', urban: true }), { left: 2, right: 2 });
  assert.deepEqual(sidewalkSides({ tags: {}, highway: 'residential', urban: false }), { left: 0, right: 0 });
});

test('runs follow the carriageway edge and stop short of a crossing road', () => {
  const cross = { owner: 2, half: 5, highway: 'secondary', urban: true, tags: { sidewalk: 'no' }, continuations: [],
    nodes: [[0, -100, 5, 10], [0, 100, 5, 10]] };
  const runs = buildSidewalkRuns([street(), cross]);
  assert.equal(runs.length, 4, 'two sides, split by the cross street');
  for (const run of runs) {
    assert.ok(run.points.every((p) => Math.abs(Math.abs(p[1]) - 4) < 1e-6), 'curb line at the carriageway edge');
    assert.ok(run.points.every((p) => Math.abs(p[0]) >= 5.5 - 1e-6), 'clear of the cross street + 0.5 m');
  }
});

test('the swept mesh has curb and slab parts, all above-ground faces pointing up or at the road', () => {
  const { meshes, triangles } = buildSidewalkMeshes([street()]);
  assert.equal(meshes.length, 1);
  assert.ok(triangles > 0);
  const geo = meshes[0].geometry;
  assert.deepEqual(meshes[0].material.map((m) => m.name), ['mapng_curbs', 'mapng_sidewalk']);
  const pos = geo.getAttribute('position').array;
  const zs = [];
  for (let i = 2; i < pos.length; i += 3) zs.push(pos[i]);
  assert.ok(Math.max(...zs) <= 5 + 0.15 + 2 * 0.015 + 1e-6, 'top of slab = road + curb + cross slope');
  assert.ok(Math.min(...zs) >= 5 - 0.1 - 1e-6, 'faces sink 10 cm below the road');
  // Slab triangles face up.
  const slab = geo.groups[1];
  for (let t = slab.start; t < slab.start + slab.count; t += 3) {
    const p = (k) => [pos[(t + k) * 3], pos[(t + k) * 3 + 1], pos[(t + k) * 3 + 2]];
    const [a, b, c] = [p(0), p(1), p(2)];
    const nz = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
    assert.ok(nz > 0, 'slab faces up');
  }
});

test('a street keeps its sidewalks across OSM way boundaries', async () => {
  const { streetSides } = await import('../services/beamngSidewalks.js');
  // three ways of one street, the middle one untagged and rural, the last drawn the other way
  const a = street({ owner: 1, tags: { name: 'Main', sidewalk: 'right' }, nodes: [[-100, 0, 5, 8], [0, 0, 5, 8]], continuations: [2] });
  const b = street({ owner: 2, urban: false, tags: { name: 'Main' }, nodes: [[0, 0, 5, 8], [100, 0, 5, 8]], continuations: [1, 3] });
  const c = street({ owner: 3, urban: false, tags: { name: 'Main' }, nodes: [[200, 0, 5, 8], [100, 0, 5, 8]], continuations: [2] });
  const sides = streetSides([a, b, c]);
  assert.deepEqual(sides.get(b), { left: 0, right: 2 }, 'the untagged way takes the tagged one');
  assert.deepEqual(sides.get(c), { left: 2, right: 0 }, 'swapped where the way runs the other way');
  const runs = buildSidewalkRuns([a, b, c]);
  assert.equal(runs.length, 1, 'one run along the whole street, not one per way');
  const xs = runs[0].points.map((p) => p[0]);
  assert.ok(Math.min(...xs) <= -99 && Math.max(...xs) >= 199);
});

test('sidewalks meeting at a corner are joined by a curb return; loose ends ramp down', () => {
  const ew = street({ owner: 1, nodes: [[-100, 0, 5, 8], [0, 0, 5, 8], [100, 0, 5, 8]] });
  const ns = street({ owner: 2, tags: { sidewalk: 'both', name: 'Cross' }, nodes: [[0, -100, 5, 8], [0, 0, 5, 8], [0, 100, 5, 8]] });
  const { corners, runs } = buildSidewalkMeshes([ew, ns]);
  assert.equal(corners.length, 4, 'all four corners of the crossing');
  for (const c of corners) {
    const r = Math.hypot(c.arc[0][0] - c.centre[0], c.arc[0][1] - c.centre[1]);
    assert.ok(Math.abs(r - 3) < 1e-6, `a residential corner's radius: ${r}`);
    // the curb return stays off both carriageways (half 4)
    for (const [x, y] of c.arc) assert.ok(Math.abs(x) >= 4 - 1e-6 && Math.abs(y) >= 4 - 1e-6);
  }
  // the outer ends (at the map edge here) are loose: curb ramps, no corner
  const loose = runs.filter((r) => r.ramps?.some(Boolean));
  assert.ok(loose.length >= 4);
});

test('a driveway lowers the curb across it instead of cutting the sidewalk', () => {
  const driveway = [[20, 0], [20, 30]];
  const { meshes, runs } = buildSidewalkMeshes([street()], { driveways: [driveway] });
  const left = runs.filter((r) => r.side === 1);
  assert.equal(left.length, 1, 'not cut');
  assert.equal(left[0].dips.length, 1);
  const [s0, s1] = left[0].dips[0];
  assert.ok(s1 - s0 > 4 && s1 - s0 < 6.5, `about the driveway's width: ${(s1 - s0).toFixed(1)} m`);
  // somewhere over the driveway the top of the sidewalk is down at the road
  const pos = meshes[0].geometry.getAttribute('position').array;
  let lowest = Infinity;
  for (let i = 0; i < pos.length; i += 3) {
    if (Math.abs(pos[i] - 20) < 0.5 && pos[i + 1] > 4.1 && pos[i + 1] < 4.3) lowest = Math.min(lowest, pos[i + 2]);
  }
  assert.ok(lowest <= 5 + 1e-6, `curb top over the driveway at the road: ${lowest}`);
});

test('a divided road: a raised median island between its carriageways, no sidewalk on the median side', () => {
  // eastbound at y = -9, westbound at y = +9 (driven along their node order),
  // each 4 m half: 10 m of median ground; a same-direction turn lane beside
  // the eastbound one is no median
  const line = (y, x0, x1) => Array.from({ length: 21 }, (_, i) => [x0 + ((x1 - x0) * i) / 20, y, 5, 0]);
  const cw = (owner, y, x0, x1, extra = {}) => ({
    owner, half: 4, highway: 'primary', urban: true, continuations: [],
    tags: { name: 'Central Avenue', oneway: 'yes' }, nodes: line(y, x0, x1), ...extra,
  });
  const east = cw(1, -9, -100, 100);
  const west = cw(2, 9, 100, -100);
  const lane = cw(3, -18, -100, 100);   // same direction as `east`
  const all = [east, west, lane];
  const medians = findMedians(all);
  const em = medians.get(east);
  assert.ok(em && em.side.every((v) => v === 1), 'eastbound: median on its left all along');
  assert.ok(Array.from(em.width).every((w) => Math.abs(w - 10) < 1e-6), 'median ground 18 m - 2 × 4 m');
  assert.ok(medians.get(west)?.side.every((v) => v === 1), 'westbound: median on its left too');
  assert.ok(!medians.get(lane)?.side.some((v) => v !== 0), 'the turn lane pairs with nothing');

  const sidewalks = buildSidewalkRuns(all, { medians });
  for (const run of sidewalks.filter((r) => r.owner !== 3)) {
    assert.ok(run.points.every((p) => Math.abs(p[1]) > 9), `no sidewalk on the median side (owner ${run.owner})`);
  }
  const islands = buildMedianRuns(all, medians);
  assert.equal(islands.length, 2, 'one half island per carriageway');
  for (const run of islands) {
    assert.ok(run.points.every((p) => Math.abs(Math.abs(p[1]) - 5) < 1e-6), 'curb at the carriageway edge');
    assert.ok(run.points.every((p) => Math.abs(p[3] - 0.6) < 1e-6), 'a 10 m median: a 0.6 m curb each side');
  }
  // a narrow median: each half reaches the middle
  const narrow = [cw(1, -6, -100, 100), cw(2, 6, 100, -100)];
  const halves = buildMedianRuns(narrow, findMedians(narrow));
  assert.ok(halves.every((run) => run.points.every((p) => Math.abs(p[3] - 2) < 1e-6)), '4 m median: 2 m slab from each side');
  assert.ok(buildSidewalkMeshes(narrow).medianRuns.length === 2);
});
