import test from 'node:test';
import assert from 'node:assert/strict';

import { buildMedianRuns, buildSidewalkMeshes, buildSidewalkRuns, findMedians, sidewalkSides } from '../services/beamngSidewalks.js';

const street = (overrides = {}) => ({
  owner: 1, half: 4, highway: 'residential', urban: true, tags: { sidewalk: 'both' }, continuations: [],
  nodes: Array.from({ length: 21 }, (_, i) => [-100 + i * 10, 0, 5, 8]),
  ...overrides,
});

test('sidewalk tags decide the sides; an untagged town street gets its curb', () => {
  assert.deepEqual(sidewalkSides({ tags: { sidewalk: 'both' } }), { left: 2, right: 2 });
  assert.deepEqual(sidewalkSides({ tags: { sidewalk: 'left', 'sidewalk:width': '3' } }), { left: 3, right: 0 });
  assert.deepEqual(sidewalkSides({ tags: { sidewalk: 'separate' }, highway: 'residential', urban: true }), { left: 0.15, right: 0.15 }, 'its curb stays');
  assert.deepEqual(sidewalkSides({ tags: { 'sidewalk:right': 'yes', 'sidewalk:left': 'no' } }), { left: 0, right: 2 });
  assert.deepEqual(sidewalkSides({ tags: {}, highway: 'primary', urban: true }), { left: 0.15, right: 0.15 }, 'no tag: a curb, no guessed sidewalk');
  assert.deepEqual(sidewalkSides({ tags: {}, highway: 'residential', urban: false }), { left: 0, right: 0 });
});

test('runs follow the carriageway edge and stop short of a crossing road', () => {
  const cross = { owner: 2, half: 5, highway: 'secondary', urban: false, tags: { sidewalk: 'no' }, continuations: [],
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
  const a = street({ owner: 1, urban: false, tags: { name: 'Main', sidewalk: 'right' }, nodes: [[-100, 0, 5, 8], [0, 0, 5, 8]], continuations: [2] });
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
  assert.ok(halves.every((run) => run.points.every((p) => Math.abs(p[3] - 0.6) < 1e-6)), '4 m median: curbs, the ground between');
  const slim = [cw(1, -4.6, -100, 100), cw(2, 4.6, 100, -100)];
  assert.ok(buildMedianRuns(slim, findMedians(slim)).every((run) => run.points.every((p) => Math.abs(p[3] - 0.6) < 1e-6)), '1.2 m median: each half reaches the middle');
  const fast = [cw(1, -5.5, -100, 100), cw(2, 5.5, 100, -100)].map((c) => ({ ...c, highway: 'trunk' }));
  const f = buildMedianRuns(fast, findMedians(fast));
  assert.equal(f.length, 0, 'a fast road has no curbs in its median');
  assert.ok(f.jersey.length >= 1 && f.jersey[0].length > 20, 'but a barrier');
  const open = narrow.map((c) => ({ ...c, urban: false }));
  assert.equal(buildMedianRuns(open, findMedians(open)).length, 0, 'a country road\'s median is open ground');
  assert.ok(buildSidewalkMeshes(narrow).medianRuns.length === 2);
});

test('a side with a mapped footway keeps only its curb, whatever its tags', async () => {
  const { streetSides, sidewalkFootways } = await import('../services/beamngSidewalks.js');
  const s = street({ tags: {}, nodes: Array.from({ length: 11 }, (_, i) => [i * 10, 0, 5, 8]), half: 4, highway: 'residential', urban: true, owner: 1 });
  const line = (y, x0 = 0, x1 = 100) => ({ tags: { highway: 'footway', footway: 'sidewalk', width: '3' }, geometry: [{ x: x0, y }, { x: x1, y }] });
  const fw = (...f) => sidewalkFootways(f, (p) => [p.x, p.y, 5]);
  const curbs = { left: 0.15, right: 0.15 };
  assert.deepEqual(streetSides([s], fw(line(6))).get(s), curbs, 'the slab goes along the footway: a curb here');
  assert.deepEqual(streetSides([s], fw(line(10))).get(s), curbs);
  const both = street({ ...s, tags: { sidewalk: 'both' } });
  assert.deepEqual(streetSides([both], fw(line(6))).get(both), { left: 0.15, right: 2 }, 'never a slab at the curb and one along the footway');
  assert.deepEqual(streetSides([both], fw(line(-30))).get(both), { left: 2, right: 2 }, 'too far off: another path');
  assert.deepEqual(streetSides([both], fw(line(6, 0, 15))).get(both), { left: 2, right: 2 }, 'a stub is not its sidewalk');
  const rural = { ...s, urban: false };
  assert.deepEqual(streetSides([rural], fw(line(6))).get(rural), { left: 0, right: 0 });
});

test('a bare curb has no slab and still dips at a driveway', () => {
  const s = street({ tags: {}, highway: 'residential', urban: true, nodes: Array.from({ length: 11 }, (_, i) => [i * 10, 0, 5, 8]), half: 4, owner: 1 });
  const driveway = [[50, 0, 5], [50, 30, 5]];
  const { meshes, runs } = buildSidewalkMeshes([s], { driveways: [driveway] });
  assert.equal(runs.length, 2);
  assert.ok(runs.every((r) => r.width === 0.15));
  assert.ok(runs.some((r) => r.dips?.length), 'the curb lowers at the driveway');
  assert.deepEqual(meshes[0].material.map((m) => m.name), ['mapng_curbs']);
});

test('the ground behind a bare curb is filled to its top', async () => {
  const { gradeSidewalkGround } = await import('../services/beamngSidewalks.js');
  const s = street({ tags: {}, nodes: Array.from({ length: 21 }, (_, i) => [-40 + i * 4, 0, 5, 8]) });
  const runs = buildSidewalkRuns([s]);
  const n = 129; const heightMap = new Float32Array(n * n).fill(4.5);
  const { apply } = gradeSidewalkGround(runs, [s], { heightMap, width: n, height: n, worldSize: 128 });
  apply((i, v) => { heightMap[i] = v; });
  const at = (x, y) => heightMap[Math.round(64 - y) * n + Math.round(64 + x)];
  assert.ok(Math.abs(at(0, 5) - 5.11) < 0.05, `1 m behind the curb: ${at(0, 5)}`);
  assert.ok(at(0, 16) === 4.5, 'and back to the ground further out');
});

test('the ground goes down with the curb at a driveway', async () => {
  const { gradeSidewalkGround } = await import('../services/beamngSidewalks.js');
  const s = street({ tags: {}, nodes: Array.from({ length: 21 }, (_, i) => [-40 + i * 4, 0, 5, 8]) });
  const { runs } = buildSidewalkMeshes([s], { driveways: [[[0, 0, 5], [0, 30, 5]]] });
  const n = 129; const heightMap = new Float32Array(n * n).fill(5);
  gradeSidewalkGround(runs, [s], { heightMap, width: n, height: n, worldSize: 128 }).apply((i, v) => { heightMap[i] = v; });
  const at = (x, y) => heightMap[Math.round(64 - y) * n + Math.round(64 + x)];
  assert.ok(at(0, 5) < 5.0, `no ground over the dipped curb: ${at(0, 5)}`);
  assert.ok(at(-20, 5) > 5.08, `filled along the rest: ${at(-20, 5)}`);
});

test('a footway away from the curb is a raised slab; a park walk stays flat', async () => {
  const { buildWalkRuns } = await import('../services/beamngSidewalks.js');
  const s = street({ tags: {}, nodes: Array.from({ length: 21 }, (_, i) => [-100 + i * 10, 0, 5, 8]) });
  const line = (y, x0, x1) => Array.from({ length: 11 }, (_, i) => [x0 + ((x1 - x0) * i) / 10, y, 0]);
  const groundAt = () => 5;
  const paths = [
    { nodes: line(10, -50, 50), half: 1, sidewalk: true },     // tagged, set back
    { nodes: line(12, -80, -60), half: 1, sidewalk: false },   // untagged, along the street
    { nodes: line(80, -50, 50), half: 1, sidewalk: false },    // far from any street
  ];
  const runs = buildWalkRuns(paths, [s], { groundAt });
  assert.equal(runs.length, 2);
  assert.ok(runs.every((r) => r.walk && r.width === 2 && !r.ramps[0] && !r.ramps[1]), 'loose ends stay level');
  assert.equal(buildWalkRuns([{ nodes: line(0, -50, 50), half: 1, sidewalk: true }], [s], { groundAt }).length, 0, 'never on the road');
  const { meshes, walkRuns } = buildSidewalkMeshes([street({ urban: false, tags: {} })], { walks: paths, groundAt });
  assert.equal(walkRuns.length, 2);
  assert.ok(meshes.length === 1 && meshes[0].material.some((m) => m.name === 'mapng_sidewalk'));
});

test('a walk mapped partly over a road\'s drawn edge is pushed clear, not cut and ramped', async () => {
  const { buildWalkRuns } = await import('../services/beamngSidewalks.js');
  const s = street({ tags: {}, nodes: Array.from({ length: 21 }, (_, i) => [-100 + i * 10, 0, 5, 8]) });
  const half = s.half;
  // a walk along the street that swings in to just outside its edge (its slab over it) and back out
  const nodes = Array.from({ length: 21 }, (_, i) => { const x = -50 + i * 5; return [x, half + 0.1 + Math.abs(x) * 0.06, 0]; });
  const runs = buildWalkRuns([{ nodes, half: 1, sidewalk: false }], [s], { groundAt: () => 5 });
  assert.equal(runs.length, 1, 'one walk, not two cut at the curb');
  assert.ok(!runs[0].ramps[0] && !runs[0].ramps[1]);
  assert.ok(runs[0].centre.every((q) => q[1] > half + 0.75), 'its slab clear of the road (to the 0.25 m search step)');
});

test('a bare curb opens along a car park at the street, not one behind a verge', () => {
  const s = street({ tags: {}, nodes: Array.from({ length: 21 }, (_, i) => [-100 + i * 10, 0, 5, 8]) });
  const lot = (y0) => [[-30, y0], [30, y0], [30, y0 + 40], [-30, y0 + 40]];
  const at = buildSidewalkRuns([s], { parking: [lot(4.5)] }).find((r) => r.side === 1);
  assert.ok(at.dips?.length === 1 && at.dips[0][1] - at.dips[0][0] > 50, 'open along the lot');
  const off = buildSidewalkRuns([s], { parking: [lot(12)] }).find((r) => r.side === 1);
  assert.equal(off.dips.length, 0);
});

test('bare curbs turn a corner closed, with the ground filled behind', () => {
  const ew = street({ owner: 1, tags: {}, nodes: Array.from({ length: 11 }, (_, i) => [i * 10, 0, 5, 8]) });
  const ns = street({ owner: 2, tags: {}, nodes: Array.from({ length: 11 }, (_, i) => [0, i * 10, 5, 8]) });
  const { corners, cornerRuns, meshes } = buildSidewalkMeshes([ew, ns]);
  assert.ok(corners.length >= 1);
  assert.equal(cornerRuns.length, corners.length);
  assert.deepEqual(meshes[0].material.map((m) => m.name), ['mapng_curbs'], 'no slab in a corner of bare curbs, nothing on the road side of the curve');
});

test('a walkway reaches the street at road height with the curb lowered to meet it, and stays up where it meets another', async () => {
  const { buildWalkRuns } = await import('../services/beamngSidewalks.js');
  const s = street({ tags: {}, nodes: Array.from({ length: 21 }, (_, i) => [-100 + i * 10, 0, 5, 8]) });
  const line = (x0, y0, x1, y1, n = 16) => Array.from({ length: n }, (_, i) => [x0 + ((x1 - x0) * i) / (n - 1), y0 + ((y1 - y0) * i) / (n - 1), 0]);
  const out = { nodes: line(0, 30, 0, 0), half: 1, sidewalk: true };          // out to the street
  const along = { nodes: line(-30, 30, 30, 30, 31), half: 1, sidewalk: true };   // the one it leaves
  const groundAt = () => 5.6;
  const runs = buildWalkRuns([out, along], [s], { groundAt });
  const r = runs.find((o) => o.points.some((q) => Math.abs(q[1]) < 10));
  assert.ok(r, 'the walkway comes out');
  assert.ok(Math.min(...r.points.map((q) => Math.abs(q[1]))) < 4.6, 'to the road\'s edge');
  assert.deepEqual(r.ramps, [false, true], 'level at the other walkway, down at the street');
  const last = r.points[r.points.length - 1];
  assert.ok(Math.abs(last[2] - 5) < 0.05, `at the road's height: ${last[2]}`);
  const { runs: curbs } = buildSidewalkMeshes([s], { walks: [out, along], groundAt });
  const near = curbs.find((c) => c.side === 1);
  assert.ok(near.dips?.length, 'the curb dips there');
  assert.ok(near.dips.every(([a, b]) => b - a < 6), 'about as wide as the walkway');
});

test('a walkway stays continuous past a driveway, closes up to the curb, and sits at curb height', async () => {
  const { buildWalkRuns } = await import('../services/beamngSidewalks.js');
  const s = street({ tags: {}, nodes: Array.from({ length: 21 }, (_, i) => [-100 + i * 10, 0, 5, 8]) });
  // 0.7 m off the curb for the first half, set back 6 m for the rest
  const nodes = [...Array.from({ length: 21 }, (_, i) => [-60 + i * 2, 5.7, 0]), ...Array.from({ length: 11 }, (_, i) => [-20 + i * 4, 5.7 + (i / 10) * 5, 0]), ...Array.from({ length: 16 }, (_, i) => [20 + i * 2, 10.7, 0])];
  const driveway = [[0, 0, 5], [0, 30, 5]];
  const runs = buildWalkRuns([{ nodes, half: 1, sidewalk: true }], [s], { groundAt: () => 4.7, driveways: [driveway] });
  assert.equal(runs.length, 1, 'one slab along the whole footway');
  const r = runs[0];
  assert.ok(r.dips?.length, 'dipped at the driveway');
  const start = r.points[5];
  assert.ok(Math.abs(Math.min(start[1], start[1] - (r.side * 2)) - 4.15) < 0.2 || start[1] < 7, `against the curb: ${start[1]}`);
  assert.ok(Math.abs(start[2] - 5.05) < 0.02, `level with the curb: ${start[2]}`);
  assert.ok(Math.abs(r.points[r.points.length - 3][2] - 4.7) < 0.02, 'on the ground once it has left the street');
});

test('walkways that meet are one surface, and a stub reaches both the walkway and the road', async () => {
  const s = street({ urban: false, tags: {}, nodes: Array.from({ length: 21 }, (_, i) => [-100 + i * 10, 0, 5, 8]) });
  const line = (x0, y0, x1, y1, n = 16) => Array.from({ length: n }, (_, i) => [x0 + ((x1 - x0) * i) / (n - 1), y0 + ((y1 - y0) * i) / (n - 1), 0]);
  const along = { nodes: line(-30, 10, 30, 10, 31), half: 1, sidewalk: true };
  const across = { nodes: line(0, 10, 0, 40), half: 1, sidewalk: true };
  const stub = { nodes: line(0, 8.5, 0, 6, 4), half: 1, sidewalk: true };   // short of both by a little
  const { meshes, walkRuns } = buildSidewalkMeshes([s], { walks: [along, across, stub], groundAt: () => 5 });
  const r = walkRuns.find((o) => Math.max(...o.centre.map((q) => q[1])) < 11 && Math.max(...o.centre.map((q) => Math.abs(q[0]))) < 3);
  assert.ok(r, 'the stub');
  assert.ok(Math.max(...r.centre.map((q) => q[1])) > 9.9, 'on to the walkway');
  assert.ok(Math.min(...r.centre.map((q) => q[1])) < 4.5, 'on to the road');
  const pos = meshes[0].geometry.getAttribute('position').array;
  const feet = []; for (let i = 0; i < pos.length; i += 3) if (pos[i + 2] < 4.8) feet.push([pos[i], pos[i + 1]]);
  assert.ok(feet.length > 0);
  assert.ok(!feet.some((p) => Math.abs(p[0]) < 0.7 && Math.abs(p[1] - 10) < 0.7), 'no wall inside the junction');
});

test('a crossing\'s landing joins the sidewalk to the road, the curb lowered at it', () => {
  const s = street({ tags: {}, nodes: Array.from({ length: 21 }, (_, i) => [-100 + i * 10, 0, 5, 8]) });
  const line = (x0, y0, x1, y1, n) => Array.from({ length: n }, (_, i) => [x0 + ((x1 - x0) * i) / (n - 1), y0 + ((y1 - y0) * i) / (n - 1), 0]);
  const walk = { nodes: line(-40, 6, 40, 6, 41), half: 1, sidewalk: true };
  const crossing = { nodes: line(0, 6, 0, -6, 13), half: 1, sidewalk: true, crossing: true };
  const { walkRuns, runs } = buildSidewalkMeshes([s], { walks: [walk, crossing], groundAt: () => 5 });
  const landing = walkRuns.filter((r) => Math.max(...r.centre.map((q) => Math.abs(q[0]))) < 2);
  assert.equal(landing.length, 2, 'a landing each side, nothing on the road');
  assert.ok(runs.every((r) => r.dips?.length), 'the curb dips on both sides');
});

test('a promenade is decked out to a seawall further off, not over higher ground', async () => {
  const { buildWalkRuns } = await import('../services/beamngSidewalks.js');
  const s = street({ urban: false, tags: {}, nodes: [[-100, -50, 5, 8], [100, -50, 5, 8]] });
  const nodes = Array.from({ length: 21 }, (_, i) => [-20 + i * 2, 0, 0]);
  const wall = [[[-20, 8], [20, 8]]];
  const sea = (x, y) => (y > 8 ? -1 : 5);
  const [r] = buildWalkRuns([{ nodes, half: 1, sidewalk: true }], [s], { groundAt: sea, seaZ: 0, walls: wall });
  assert.equal(r.aprons.length, 1, 'water behind the wall');
  assert.ok(Math.abs(r.aprons[0].out[3][1] - 8) < 0.01, 'to the wall');
  const [dry] = buildWalkRuns([{ nodes, half: 1, sidewalk: true }], [s], { groundAt: () => 5, seaZ: 0, walls: wall });
  assert.equal(dry.aprons.length, 0, 'a dry wall that far off is not');
  const [bank] = buildWalkRuns([{ nodes, half: 1, sidewalk: true }], [s], { groundAt: (x, y) => (y > 8 ? -1 : y > 4 ? 6 : 5), seaZ: 0, walls: wall });
  assert.equal(bank.aprons.length, 0, 'nor over ground above the walk');
  const river = [[-30, 9], [30, 9], [30, 40], [-30, 40]];
  const [tidal] = buildWalkRuns([{ nodes, half: 1, sidewalk: true }], [s], { groundAt: (x, y) => (y > 8 ? 2 : 5), seaZ: 0, walls: wall, water: [river] });
  assert.equal(tidal.aprons.length, 1, 'mapped water behind the wall, above the sea');
  const [slant] = buildWalkRuns([{ nodes, half: 1, sidewalk: true }], [s], { groundAt: sea, seaZ: 0, walls: [[[-20, -12], [20, 28]]] });
  assert.equal(slant.aprons.length, 0, 'not out to a wall at an angle');
  const [rise] = buildWalkRuns([{ nodes, half: 1, sidewalk: true }], [s], { groundAt: (x, y) => (y > 8 ? -1 : y > 4 ? 5.4 : 5), seaZ: 0, walls: wall });
  assert.equal(rise.aprons.length, 0, 'nor up over a rise to the seawall');
  const short = Array.from({ length: 6 }, (_, i) => [-5 + i * 2, 0, 0]);
  const [jog] = buildWalkRuns([{ nodes: short, half: 1, sidewalk: true }], [s], { groundAt: sea, seaZ: 0, walls: wall });
  assert.equal(jog.aprons.length, 0, 'nor along a short stretch of wall');
});

test('land shut in by a walk and a jog in a seawall is paved level with the walk', async () => {
  const s = street({ urban: false, tags: {}, nodes: [[-100, -50, 5, 8], [100, -50, 5, 8]] });
  const nodes = Array.from({ length: 31 }, (_, i) => [-30 + i * 2, 8, 0]);
  const wall = [[-30, 10], [-5, 10], [-5, 20], [5, 20], [5, 10], [30, 10]];
  const jog = (x, y) => Math.abs(x) < 5 && y < 20;
  const groundAt = (x, y) => (y > 10 && !jog(x, y) ? -1 : 5);
  const { pockets, meshes } = buildSidewalkMeshes([s], { walks: [{ nodes, half: 1, sidewalk: true }], groundAt, seaZ: 0, walls: [wall] });
  assert.equal(pockets.length, 1, 'one pocket');
  const ring = pockets[0][0];
  const xs = ring.map((q) => q[0]); const ys = ring.map((q) => q[1]);
  assert.ok(Math.min(...xs) < -4.5 && Math.max(...xs) > 4.5 && Math.max(...ys) > 19.5, 'out to the jog\'s walls');
  let found = false;
  for (const m of meshes) {
    const pos = m.geometry.getAttribute('position').array;
    for (let i = 0; i < pos.length; i += 3) if (Math.abs(pos[i]) < 2 && Math.abs(pos[i + 1] - 15) < 2 && Math.abs(pos[i + 2] - 5.1) < 0.05) found = true;
  }
  assert.ok(found, 'its top at the walk\'s height in the middle');
  const dry = buildSidewalkMeshes([s], { walks: [{ nodes, half: 1, sidewalk: true }], groundAt: () => 5, seaZ: 0, walls: [wall] });
  assert.equal(dry.pockets.length, 0, 'not by a dry wall');
});

test('a walkway beside a wall is decked out to it', async () => {
  const { buildWalkRuns } = await import('../services/beamngSidewalks.js');
  const s = street({ urban: false, tags: {}, nodes: [[-100, -50, 5, 8], [100, -50, 5, 8]] });
  const nodes = Array.from({ length: 21 }, (_, i) => [-20 + i * 2, 0, 0]);
  const wall = [[-20, 3], [20, 3]];
  const [r] = buildWalkRuns([{ nodes, half: 1, sidewalk: true }], [s], { groundAt: () => 5, walls: [wall] });
  assert.equal(r.aprons.length, 1);
  assert.ok(Math.abs(r.aprons[0].out[3][1] - 3) < 0.01, 'to the wall');
  const [far] = buildWalkRuns([{ nodes, half: 1, sidewalk: true }], [s], { groundAt: () => 5, walls: [[[-20, 8], [20, 8]]] });
  assert.equal(far.aprons.length, 0, 'not one further off');
  const { meshes } = buildSidewalkMeshes([s], { walks: [{ nodes, half: 1, sidewalk: true }], groundAt: () => 5, walls: [wall] });
  const pos = meshes[0].geometry.getAttribute('position').array;
  let top = 0; for (let i = 1; i < pos.length; i += 3) top = Math.max(top, pos[i]);
  assert.ok(top > 2.9, `the deck reaches the wall: ${top}`);
});

test('a pier stands over the water on posts, a bridge sidewalk at its deck', async () => {
  const { buildDeckRuns } = await import('../services/beamngSidewalks.js');
  const ground = (x) => (x < 0 ? 3 : -2);
  const pier = { nodes: Array.from({ length: 26 }, (_, i) => [-10 + i * 2, 0, 0]), half: 1.2, wood: true };
  const [r] = buildDeckRuns([pier], [], { groundAt: (x) => ground(x), seaZ: 0 });
  assert.ok(Math.abs(r.centre[0][2] - 3) < 0.01, 'level with the shore');
  assert.ok(Math.abs(r.centre[25][2] - 1.2) < 0.01, 'and over the water at the far end');
  const bumpy = (x) => (x > 0 ? (Math.floor(x / 4) % 2 ? 1.4 : -1) : 3);
  const [level] = buildDeckRuns([pier], [], { groundAt: (x) => bumpy(x), seaZ: 0 });
  assert.ok(level.centre.slice(9).every((q) => Math.abs(q[2] - 1.2) < 0.01), 'a shallow bed does not bend it');
  const road = street({ owner: 9, bridge: true, tags: {}, nodes: [[-50, 0, 12, 8], [50, 0, 12, 8]] });
  const [walk] = buildDeckRuns([{ nodes: [[-20, 5, 0], [0, 5, 0], [20, 5, 0]], half: 1 }], [road], { groundAt: () => 0, seaZ: 0 });
  assert.ok(Math.abs(walk.centre[1][2] - 12.05) < 0.01, `at the bridge's height: ${walk.centre[1][2]}`);
  const s = street({ urban: false, tags: {}, nodes: [[-100, -60, 5, 8], [100, -60, 5, 8]] });
  const { meshes, deckAt } = buildSidewalkMeshes([s], { decks: [pier], groundAt: (x) => ground(x), seaZ: 0 });
  assert.ok(meshes.some((m) => m.material.some((q) => q.name === 'mapng_pier_wood')));
  assert.ok(deckAt(20, 0) > 1, 'something on it stands on it');
  assert.equal(deckAt(20, 30), null);
});

test('a deck below the shore gets a gangway: a ramp with room, stairs without', () => {
  const s = street({ urban: false, tags: {}, nodes: [[-100, -60, 5, 8], [100, -60, 5, 8]] });
  const ground = (h) => (x) => (x < -1 ? h : -2);
  const deck = (len) => ({ nodes: Array.from({ length: Math.round(len / 2) + 1 }, (_, i) => [i * 2, 0, 0]), half: 1.2, wood: true });
  const low = buildSidewalkMeshes([s], { decks: [deck(30)], groundAt: ground(3), seaZ: 0 });
  assert.deepEqual(low.gangways, { ramp: 1, stairs: 0 });
  assert.ok(low.meshes.some((m) => m.material.some((q) => q.name === 'mapng_gangway_aluminium')));
  assert.deepEqual(buildSidewalkMeshes([s], { decks: [deck(8)], groundAt: ground(6), seaZ: 0 }).gangways, { ramp: 0, stairs: 1 }, 'a short deck');
  assert.deepEqual(buildSidewalkMeshes([s], { decks: [deck(30)], groundAt: ground(1.5), seaZ: 0 }).gangways, { ramp: 0, stairs: 0 }, 'a deck level with the shore');
});

test('a pier ending on a seawall\'s face stays level to its foot', async () => {
  const { buildDeckRuns } = await import('../services/beamngSidewalks.js');
  const nodes = Array.from({ length: 16 }, (_, i) => [i * 2, 0, 0]);
  const wall = (x) => (x < 1 ? 2.5 : -2);
  const [r] = buildDeckRuns([{ nodes, half: 1.2, wood: true }], [], { groundAt: (x) => wall(x), seaZ: 0 });
  assert.ok(Math.abs(r.centre[0][2] - 1.2) < 0.01, `not climbing the wall: ${r.centre[0][2]}`);
});

test('a walkway stops at the water and rides over a dip at a seawall', async () => {
  const { buildWalkRuns } = await import('../services/beamngSidewalks.js');
  const s = street({ urban: false, tags: {}, nodes: [[-100, -60, 5, 8], [100, -60, 5, 8]] });
  const nodes = Array.from({ length: 31 }, (_, i) => [i * 2, 0, 0]);
  const ground = (x) => (x > 50 ? -3 : Math.abs(x - 20) < 2 ? 1 : 3);
  const [r] = buildWalkRuns([{ nodes, half: 1, sidewalk: true }], [s], { groundAt: (x) => ground(x), seaZ: 0 });
  assert.ok(Math.max(...r.centre.map((q) => q[0])) <= 50.5, 'it ends at the shore');
  assert.ok(r.centre.every((q) => q[2] > 2.5), `no dip: ${Math.min(...r.centre.map((q) => q[2]))}`);
});

test('a median too thin for an island is paved across', () => {
  const a = street({ owner: 1, tags: { name: 'Dual', oneway: 'yes' }, highway: 'secondary', half: 3.5, nodes: Array.from({ length: 21 }, (_, i) => [i * 5, 0, 5, 7]) });
  const b = street({ owner: 2, tags: { name: 'Dual', oneway: 'yes' }, highway: 'secondary', half: 3.5, nodes: Array.from({ length: 21 }, (_, i) => [(20 - i) * 5, 7.4, 5, 7]) });
  const { medianRuns, meshes } = buildSidewalkMeshes([a, b]);
  assert.equal(medianRuns.length, 0, 'no island');
  assert.ok(medianRuns.gaps.length >= 2);
  assert.ok(meshes[0].material.some((m) => m.name === 'mapng_corner_asphalt'));
});

test('a wall mapped as an area: its deck sits on the walls\' tops, with no faces of its own', async () => {
  const { buildWallDeckMesh, lowerUnderWallDecks } = await import('../services/beamngSidewalks.js');
  const s = street({ urban: false, tags: {}, nodes: [[-100, -60, 5, 8], [100, -60, 5, 8]] });
  const ring = [[0, 0], [60, 0], [60, 4], [0, 4], [0, 0]];
  const ground = (x, y) => (y > 2 ? -1 : 3);
  const { wallDecks } = buildSidewalkMeshes([s], { wallAreas: [ring], groundAt: ground, seaZ: 0 });
  const tops = [];
  for (let x = 0; x <= 60; x += 3) { tops.push({ x, y: 0, z: 3.7 }); tops.push({ x, y: 4, z: 3.3 }); }
  const mesh = buildWallDeckMesh(wallDecks, tops);
  assert.deepEqual(mesh.material.map((m) => m.name), ['mapng_sidewalk'], 'no filler faces');
  const pos = mesh.geometry.getAttribute('position').array;
  const at = (y) => { const z = []; for (let i = 0; i < pos.length; i += 3) if (pos[i] > 10 && pos[i] < 50 && Math.abs(pos[i + 1] - y) < 0.01) z.push(pos[i + 2]); return z; };
  assert.ok(at(0).every((z) => Math.abs(z - 3.7) < 0.01), 'on the inner wall');
  assert.ok(at(4).every((z) => Math.abs(z - 3.3) < 0.01), 'on the outer wall');
  assert.deepEqual(buildWallDeckMesh(wallDecks, []).material.map((m) => m.name), ['mapng_curbs', 'mapng_sidewalk'], 'with no walls it closes itself');
  const n = 129; const heightMap = new Float32Array(n * n).fill(1);
  const put = (x, y) => (64 - y) * n + 64 + x;
  heightMap[put(30, 2)] = 4; heightMap[put(30, 6)] = 1;
  lowerUnderWallDecks(wallDecks, { heightMap, width: n, height: n, worldSize: 128 }, (i, v) => { heightMap[i] = v; });
  assert.ok(Math.abs(heightMap[put(30, 2)] - 2.25) < 0.01, 'under the deck');
  assert.equal(heightMap[put(30, 6)], 1, 'land against the wall stays');
  assert.equal(heightMap[put(30, 30)], 1, 'and only there');
});

test('a street split at a T-junction keeps its far curb whole', () => {
  const a = street({ owner: 1, tags: { name: 'Main' }, nodes: Array.from({ length: 11 }, (_, i) => [-100 + i * 10, 0, 5, 8]) });
  const b = street({ owner: 2, tags: { name: 'Main' }, nodes: Array.from({ length: 11 }, (_, i) => [i * 10, 0, 5, 8]) });
  const stem = street({ owner: 3, tags: { name: 'Side' }, nodes: Array.from({ length: 11 }, (_, i) => [0, -i * 10, 5, 8]) });
  const runs = buildSidewalkRuns([a, b, stem]);
  const far = runs.filter((r) => r.points.some((q) => Math.abs(q[1] - 4) < 0.01));
  assert.equal(far.length, 1, 'one curb across the top of the T');
  assert.ok(Math.abs(far[0].points[0][0] - far[0].points.at(-1)[0]) > 195);
});

test('a curb merged along a street survives past its first piece', () => {
  const pieces = [0, 1, 2].map((k) => street({ owner: k + 1, tags: { name: 'Long' }, nodes: Array.from({ length: 11 }, (_, i) => [k * 100 + i * 10, 0, 5, 8]) }));
  const cross = [50, 150].map((x, k) => street({ owner: 10 + k, tags: { name: `Side ${k}` }, nodes: Array.from({ length: 11 }, (_, i) => [x, -i * 10, 5, 8]) }));
  const top = buildSidewalkRuns([...pieces, ...cross]).filter((r) => r.points.some((q) => Math.abs(q[1] - 4) < 0.01));
  assert.equal(top.length, 1);
  assert.ok(Math.abs(top[0].points[0][0] - top[0].points.at(-1)[0]) > 290, 'all the way along');
});

test('a walkway stops at a car park: nothing raised across the lot', async () => {
  const { buildWalkRuns } = await import('../services/beamngSidewalks.js');
  const s = street({ urban: false, tags: {}, nodes: [[-100, -60, 5, 8], [100, -60, 5, 8]] });
  const nodes = Array.from({ length: 31 }, (_, i) => [-30 + i * 2, 0, 0]);
  const lot = [[-10, -20], [10, -20], [10, 20], [-10, 20]];
  const runs = buildWalkRuns([{ nodes, half: 1, sidewalk: true }], [s], { groundAt: () => 5, parking: [lot] });
  assert.equal(runs.length, 2);
  assert.ok(runs.every((r) => r.centre.every((q) => Math.abs(q[0]) >= 9.4)));
});

test('a bare curb with building fronts close behind it is paved up to the walls', () => {
  // an untagged town street along x, 4 m half width: its curbs only; a row of
  // buildings 3 m behind the left curb over x = -40..10, a car park in front
  // of one further on, unmapped ground behind the right curb
  const s = street({ tags: {}, nodes: Array.from({ length: 21 }, (_, i) => [-100 + i * 10, 0, 5, 8]) });
  const shop = [[-40, 7], [10, 7], [10, 20], [-40, 20], [-40, 7]];
  const lot = [[30, 4.5], [60, 4.5], [60, 9], [30, 9], [30, 4.5]];
  const behindLot = [[30, 9], [60, 9], [60, 20], [30, 20], [30, 9]];
  const runs = buildSidewalkRuns([s], { buildings: [shop, behindLot], parking: [lot] });
  const front = runs.filter((r) => r.front && r.side === 1 && r.width > 2.5);
  assert.equal(front.length, 1, 'one stretch paved to the walls');
  const xs = front[0].points.map((p) => p[0]);
  assert.ok(Math.min(...xs) <= -38 && Math.max(...xs) >= 8, `along the buildings (${Math.min(...xs)}..${Math.max(...xs)})`);
  assert.ok(Math.abs(front[0].width - 2.95) < 0.06, `curb to wall (${front[0].width})`);
  assert.ok(runs.filter((r) => r.side === -1).every((r) => Math.abs(r.width - 2) < 0.01), 'unmapped ground on the right: the usual sidewalk');
  assert.ok(!runs.some((r) => r.side === 1 && r.width > 0.2 && r.points.some((p) => p[0] > 32 && p[0] < 58)), 'none across the car park');
});

test('unmapped ground behind a town curb gets a sidewalk; a park or a house\'s lawn does not', () => {
  const s = street({ tags: {}, nodes: Array.from({ length: 21 }, (_, i) => [-100 + i * 10, 0, 5, 8]) });
  const park = [[-100, 4], [-40, 4], [-40, 40], [-100, 40], [-100, 4]];
  const house = [[20, 14], [32, 14], [32, 24], [20, 24], [20, 14]];
  const runs = buildSidewalkRuns([s], { openGround: [park], houses: [house], buildings: [house] });
  const paved = runs.filter((r) => r.front && r.side === 1);
  const xs = paved.flatMap((r) => r.points.map((p) => p[0]));
  assert.ok(paved.length >= 1 && paved.every((r) => Math.abs(r.width - 2) < 0.01), 'the usual width');
  assert.ok(Math.min(...xs) >= -42, 'none along the park');
  assert.ok(!paved.some((r) => r.points.some((p) => p[0] > 22 && p[0] < 30)), 'none before the house');
  assert.ok(xs.some((x) => x < 0 && x > -30), 'paved over the unmapped ground');
});

test('gutters run along the curbs, an eighth of a metre out, broken where a curb is lowered', async () => {
  const { gutterLines } = await import('../services/beamngSidewalks.js');
  const s = street({ nodes: Array.from({ length: 21 }, (_, i) => [-100 + i * 10, 0, 5, 8]) });
  const runs = buildSidewalkRuns([s], { driveways: [[[0, 3], [0, 20]]] });
  const lines = gutterLines({ runs, corners: [] });
  const left = lines.filter((l) => l[0][1] > 0);
  assert.ok(left.length >= 2, `broken at the driveway (${left.length} pieces)`);
  for (const l of left) for (const q of l) assert.ok(Math.abs(q[1] - 3.875) < 0.01, `0.125 m out from the curb (y ${q[1]})`);
});

test('a street whose sidewalks OSM tags or maps apart keeps its curb: no sidewalk laid over them', () => {
  const shop = [[-40, 7], [10, 7], [10, 20], [-40, 20], [-40, 7]];
  const tagged = street({ tags: { 'sidewalk:both': 'separate' }, nodes: Array.from({ length: 21 }, (_, i) => [-100 + i * 10, 0, 5, 8]) });
  assert.ok(!buildSidewalkRuns([tagged], { buildings: [shop] }).some((r) => r.front), 'tagged separate: as mapped');
  const plain = street({ tags: {}, nodes: Array.from({ length: 21 }, (_, i) => [-100 + i * 10, 0, 5, 8]) });
  const walk = { nodes: Array.from({ length: 11 }, (_, i) => [-50 + i * 10, 5.2, 5]), width: 1.8 };
  const runs = buildSidewalkRuns([plain], { buildings: [shop], footways: [walk] });
  assert.ok(!runs.some((r) => r.front && r.side === 1 && r.points.some((p) => p[0] > -45 && p[0] < 45)), 'a mapped sidewalk behind the curb: none laid over it');
});

test('a rounded curb\'s corner is paved by bands of one width along the curve, out to the curbs\' corner, none past the curve', async () => {
  const { cornerPatches } = await import('../services/beamngSidewalks.js');
  const ew = street({ owner: 1, tags: { surface: 'asphalt' }, nodes: Array.from({ length: 11 }, (_, i) => [i * 10, 0, 5, 8]) });
  const ns = street({ owner: 2, tags: {}, nodes: Array.from({ length: 11 }, (_, i) => [0, i * 10, 5, 8]) });
  const { corners } = buildSidewalkMeshes([ew, ns]);
  const all = cornerPatches(corners);
  assert.ok(all.length >= corners.length && all.every((p) => p.band));
  for (const c of corners) {
    const r = Math.hypot(c.arc[0][0] - c.centre[0], c.arc[0][1] - c.centre[1]);
    const near = (q) => Math.hypot(q[0] - c.centre[0], q[1] - c.centre[1]) < r + 8;
    const bands = all.filter((p) => p.nodes.every(near));
    assert.ok(bands.length >= 2, 'more than the one band at the curb');
    let reach = 0;
    for (const band of bands) {
      for (const q of band.nodes) {
        assert.equal(q[3], bands[0].nodes[0][3], 'no taper: the texture is never squeezed');
        const k = band.nodes.indexOf(q);
        if (k) assert.ok(Math.hypot(q[0] - band.nodes[k - 1][0], q[1] - band.nodes[k - 1][1]) > 0.3, 'no two nodes on top of each other (the spline spikes)');
        const d = Math.hypot(q[0] - c.centre[0], q[1] - c.centre[1]);
        assert.ok(d - q[3] / 2 > r - 0.15, 'nothing past the curb face');
        reach = Math.max(reach, d + q[3] / 2);
      }
    }
    // a 90-degree corner of radius r: its square corner lies r(sqrt 2 - 1) out
    assert.ok(reach > r * Math.SQRT2 - 0.2, `out to the curbs' corner (${reach.toFixed(2)} vs ${(r * Math.SQRT2).toFixed(2)})`);
    assert.ok(reach < r * Math.SQRT2 + 1.5, 'and not far out over the road');
  }
});

test('a mapped walk is cut at a straight curb\'s face: none of its slab out on the road', () => {
  const s = street({ tags: {}, nodes: Array.from({ length: 21 }, (_, i) => [-100 + i * 10, 0, 5, 8]) });
  const line = (x0, y0, x1, y1, n) => Array.from({ length: n }, (_, i) => [x0 + ((x1 - x0) * i) / (n - 1), y0 + ((y1 - y0) * i) / (n - 1), 0]);
  // along behind the curb, then slanting out across the road to the far side
  const walk = { nodes: [...line(-40, 7, -10, 7, 31), ...line(-9, 6.6, 10, -7, 20).slice(1)], half: 1, sidewalk: true };
  const { meshes } = buildSidewalkMeshes([s], { walks: [walk], groundAt: () => 5 });
  let onRoad = 0;
  for (const mesh of meshes) {
    const pos = mesh.geometry.getAttribute('position').array;
    for (let v = 0; v + 8 < pos.length; v += 9) {
      const p = [0, 3, 6].map((k) => [pos[v + k], pos[v + k + 1], pos[v + k + 2]]);
      const area = Math.abs((p[1][0] - p[0][0]) * (p[2][1] - p[0][1]) - (p[2][0] - p[0][0]) * (p[1][1] - p[0][1])) / 2;
      const cy = (p[0][1] + p[1][1] + p[2][1]) / 3; const cz = (p[0][2] + p[1][2] + p[2][2]) / 3;
      if (area > 0.02 && Math.abs(cy) < 3.7 && cz > 5.05) onRoad += area;
    }
  }
  assert.ok(onRoad < 0.05, `raised slab on the road: ${onRoad.toFixed(2)} m2`);
});

test('a walk carried across a side street\'s mouth is cut off its carriageway', () => {
  const main = street({ tags: {}, nodes: Array.from({ length: 21 }, (_, i) => [-100 + i * 10, 0, 5, 8]) });
  const side = street({ owner: 2, tags: {}, nodes: Array.from({ length: 11 }, (_, i) => [0, -i * 10, 5, 8]) });
  const line = (x0, y0, x1, y1, n) => Array.from({ length: n }, (_, i) => [x0 + ((x1 - x0) * i) / (n - 1), y0 + ((y1 - y0) * i) / (n - 1), 0]);
  // a mapped sidewalk along the main street, carried straight over the side street
  const walk = { nodes: line(-40, -9, 40, -9, 81), half: 1, sidewalk: true };
  const { meshes } = buildSidewalkMeshes([main, side], { walks: [walk], groundAt: () => 5 });
  let onRoad = 0;
  for (const mesh of meshes) {
    const pos = mesh.geometry.getAttribute('position').array;
    for (let v = 0; v + 8 < pos.length; v += 9) {
      const p = [0, 3, 6].map((k) => [pos[v + k], pos[v + k + 1], pos[v + k + 2]]);
      const area = Math.abs((p[1][0] - p[0][0]) * (p[2][1] - p[0][1]) - (p[2][0] - p[0][0]) * (p[1][1] - p[0][1])) / 2;
      const cx = (p[0][0] + p[1][0] + p[2][0]) / 3; const cy = (p[0][1] + p[1][1] + p[2][1]) / 3; const cz = (p[0][2] + p[1][2] + p[2][2]) / 3;
      if (area > 0.02 && Math.abs(cx) < 3.7 && cy < -6 && cy > -12 && cz > 5.05) onRoad += area;
    }
  }
  assert.ok(onRoad < 0.05, `raised walk on the side street: ${onRoad.toFixed(2)} m2`);
});

test('a walk cut in pieces draws each piece once: no triangle twice', () => {
  const main = street({ tags: {}, nodes: Array.from({ length: 21 }, (_, i) => [-100 + i * 10, 0, 5, 8]) });
  const side = street({ owner: 2, tags: {}, nodes: Array.from({ length: 11 }, (_, i) => [0, -i * 10, 5, 8]) });
  const line = (x0, y0, x1, y1, n) => Array.from({ length: n }, (_, i) => [x0 + ((x1 - x0) * i) / (n - 1), y0 + ((y1 - y0) * i) / (n - 1), 0]);
  const walk = { nodes: line(-40, -9, 40, -9, 81), half: 1, sidewalk: true };
  const { meshes } = buildSidewalkMeshes([main, side], { walks: [walk], groundAt: () => 5 });
  const seen = new Set();
  let twice = 0;
  for (const mesh of meshes) {
    const pos = mesh.geometry.getAttribute('position').array;
    for (let v = 0; v + 8 < pos.length; v += 9) {
      const key = [0, 3, 6].map((k) => `${pos[v + k].toFixed(3)},${pos[v + k + 1].toFixed(3)},${pos[v + k + 2].toFixed(3)}`).sort().join('|');
      if (seen.has(key)) twice++; else seen.add(key);
    }
  }
  assert.equal(twice, 0, `${twice} triangles drawn twice`);
});

test('a ring walk mapped as two ways is one closed line; a spur at its seam stays its own', async () => {
  const { chainWalks } = await import('../services/beamngSidewalks.js');
  const at = (deg) => [10 * Math.cos((deg * Math.PI) / 180), 10 * Math.sin((deg * Math.PI) / 180), 0];
  const arc = (a0, a1) => Array.from({ length: 7 }, (_, i) => at(a0 + ((a1 - a0) * i) / 6));
  const spur = { nodes: [[-30, 0, 0], [-20, 0, 0], at(180)], half: 1 };
  const out = chainWalks([{ nodes: arc(180, 360), half: 1 }, { nodes: arc(0, 180), half: 1 }, spur]);
  assert.equal(out.length, 2);
  const ring = out.find((p) => p.nodes.length > 3);
  const [f, l] = [ring.nodes[0], ring.nodes[ring.nodes.length - 1]];
  assert.ok(Math.hypot(f[0] - l[0], f[1] - l[1]) < 1e-9, 'closed');
  assert.ok(out.includes(spur) || out.some((p) => p.nodes.length === 3), 'the spur alone');
  // different widths stay apart
  assert.equal(chainWalks([{ nodes: arc(180, 360), half: 1 }, { nodes: arc(0, 180), half: 2 }]).length, 2);
});

test('walks crossing on uneven ground meet at one height', async () => {
  const { buildWalkRuns } = await import('../services/beamngSidewalks.js');
  const line = (x0, y0, x1, y1, n = 21) => Array.from({ length: n }, (_, i) => [x0 + ((x1 - x0) * i) / (n - 1), y0 + ((y1 - y0) * i) / (n - 1), 0]);
  // a ridge along y = 0 and a dip along x = 0: each walk's own height disagrees where they cross
  const groundAt = (x, y) => 5 + 0.3 * Math.exp(-(y * y) / 8) - 0.3 * Math.exp(-(x * x) / 8);
  const runs = buildWalkRuns([{ nodes: line(-40, 0, 40, 0), half: 1, sidewalk: true }, { nodes: line(0, -40, 0, 40), half: 1, sidewalk: true }], [], { groundAt });
  assert.equal(runs.length, 2);
  const zNear = (r) => r.centre.reduce((best, q) => (Math.hypot(q[0], q[1]) < best.d ? { d: Math.hypot(q[0], q[1]), z: q[2] } : best), { d: Infinity }).z;
  assert.ok(Math.abs(zNear(runs[0]) - zNear(runs[1])) < 0.01, `level where they cross: ${zNear(runs[0])} vs ${zNear(runs[1])}`);
});

test('a walk clipping a road\'s corner is joined again across it, one crossing the road is not', async () => {
  const { buildWalkRuns } = await import('../services/beamngSidewalks.js');
  const s = street({ tags: {}, nodes: Array.from({ length: 21 }, (_, i) => [-100 + i * 10, 0, 5, 8]) });
  // its corner node mapped deep in the road (past the 3 m push), then back out on the same side
  const clip = { nodes: [[-20, 7, 0], [-6, 7, 0], [-1, 0.5, 0], [1, 0.5, 0], [6, 7, 0], [20, 7, 0]], half: 1, sidewalk: true };
  assert.equal(buildWalkRuns([clip], [s], { groundAt: () => 5 }).length, 1, 'one walk');
  const across = { nodes: [[0, -20, 0], [0, 20, 0]], half: 1, sidewalk: true };
  assert.equal(buildWalkRuns([across], [s], { groundAt: () => 5 }).length, 2, 'cut at the road');
});

test('two branches of one street leaving a fork side by side: neither sidewalk over the other branch', () => {
  const line = (x0, y0, x1, y1, n = 11) => Array.from({ length: n }, (_, i) => [x0 + ((x1 - x0) * i) / (n - 1), y0 + ((y1 - y0) * i) / (n - 1), 5, 8]);
  const tags = { name: 'Fork Street', sidewalk: 'both' };
  const cws = [
    street({ owner: 1, tags, nodes: line(-60, 0, 0, 0) }),
    street({ owner: 2, tags, nodes: line(0, 0, 60, 24) }),   // about 22° off
    street({ owner: 3, tags, nodes: line(0, 0, 60, 0) }),
  ];
  const runs = buildSidewalkRuns(cws);
  const distTo = (cw, x, y) => Math.min(...cw.nodes.slice(1).map((b, i) => {
    const a = cw.nodes[i]; const ex = b[0] - a[0]; const ey = b[1] - a[1];
    const t = Math.max(0, Math.min(1, ((x - a[0]) * ex + (y - a[1]) * ey) / (ex * ex + ey * ey)));
    return Math.hypot(x - a[0] - t * ex, y - a[1] - t * ey);
  }));
  for (const run of runs) {
    const p = run.points;
    for (let i = 0; i + 1 < p.length; i++) {
      const L = Math.hypot(p[i + 1][0] - p[i][0], p[i + 1][1] - p[i][1]) || 1;
      const nx = (-(p[i + 1][1] - p[i][1]) / L) * run.side; const ny = ((p[i + 1][0] - p[i][0]) / L) * run.side;
      const bx = p[i][0] + nx * (run.width + 0.15); const by = p[i][1] + ny * (run.width + 0.15);
      for (const cw of [cws[1], cws[2]]) {
        if (cw.owner === run.owner) continue;
        assert.ok(distTo(cw, bx, by) > cw.half - 0.05, `run of ${run.owner} at (${bx.toFixed(1)}, ${by.toFixed(1)}) over ${cw.owner}`);
      }
    }
  }
});

test('no unmapped-ground sidewalk on the strip between two roads close side by side (a median missed)', () => {
  // two one-way streets of different classes 3 m apart: not found as a divided road
  const a = street({ owner: 1, tags: {}, highway: 'residential', nodes: Array.from({ length: 21 }, (_, i) => [-100 + i * 10, 0, 5, 8]) });
  const b = street({ owner: 2, tags: {}, highway: 'primary', half: 3, nodes: Array.from({ length: 21 }, (_, i) => [-100 + i * 10, 10, 5, 6]) });
  const runs = buildSidewalkRuns([a, b], { openGround: [] , buildings: [[[500, 500], [501, 500], [501, 501], [500, 500]]] });
  assert.ok(!runs.some((r) => r.front && ((r.owner === 1 && r.side === 1) || (r.owner === 2 && r.side === -1))), 'the strip between stays bare');
  assert.ok(runs.some((r) => r.front && r.owner === 1 && r.side === -1), 'the outer side still paved');
});

test('a closed walk whose last points nearly repeat stays a closed, round ring', async () => {
  const { buildWalkRuns } = await import('../services/beamngSidewalks.js');
  const ring = Array.from({ length: 9 }, (_, i) => [10 * Math.cos((i * Math.PI) / 4), 10 * Math.sin((i * Math.PI) / 4), 0]);
  // (as resampled: one point 5 cm short of the start, then the start again)
  ring.splice(8, 0, [ring[0][0] - 0.03, ring[0][1] - 0.04, 0]);
  const runs = buildWalkRuns([{ nodes: ring, half: 1, sidewalk: true }], [], { groundAt: () => 5 });
  assert.equal(runs.length, 1);
  const r = Math.max(...runs[0].centre.map((q) => Math.abs(Math.hypot(q[0], q[1]) - 9.4)));
  assert.ok(r < 0.7, `no straight chord across it (off the circle by ${r.toFixed(2)} m)`);
});

test('a sidewalk along the curb carries on past a crosswalk\'s zone', async () => {
  const { buildWalkRuns } = await import('../services/beamngSidewalks.js');
  const s = street({ tags: {}, nodes: Array.from({ length: 21 }, (_, i) => [-100 + i * 10, 0, 5, 8]) });
  const zone = { x: 0, y: 0, ux: 1, uy: 0, halfLength: 1.5, halfWidth: s.half + 1 };
  const walk = { nodes: Array.from({ length: 21 }, (_, i) => [-20 + i * 2, 4.8, 0]), half: 0.5, sidewalk: true };
  assert.equal(buildWalkRuns([walk], [s], { groundAt: () => 5, zones: [zone] }).length, 1, 'not cut at the crossing');
});

test('walks meeting at a point at slight angles leave no gap between their ends', () => {
  const line = (x0, y0, x1, y1, n = 11) => Array.from({ length: n }, (_, i) => [x0 + ((x1 - x0) * i) / (n - 1), y0 + ((y1 - y0) * i) / (n - 1), 0]);
  // from the south bending in at 14°, from the north straight, out to the east: one meeting
  const walks = [
    { nodes: [...line(2.5, -20, 0.25, -1, 10), [0, 0, 0]], half: 0.9, sidewalk: true },
    { nodes: line(0, 20, 0, 0), half: 0.9, sidewalk: true, surface: 'asphalt' },   // (another kind of way: not chained on)
    { nodes: line(0, 0, 20, 0), half: 0.9, sidewalk: true },
  ];
  const { meshes } = buildSidewalkMeshes([], { walks, groundAt: () => 5 });
  const tris = [];
  for (const mesh of meshes) {
    const pos = mesh.geometry.getAttribute('position').array;
    for (let v = 0; v + 8 < pos.length; v += 9) {
      const t = [[pos[v], pos[v + 1]], [pos[v + 3], pos[v + 4]], [pos[v + 6], pos[v + 7]]];
      if (Math.abs((t[1][0] - t[0][0]) * (t[2][1] - t[0][1]) - (t[2][0] - t[0][0]) * (t[1][1] - t[0][1])) > 1e-4) tris.push(t);
    }
  }
  const covered = (x, y) => tris.some(([a, b, c]) => {
    const s = (p, q) => (q[0] - p[0]) * (y - p[1]) - (q[1] - p[1]) * (x - p[0]);
    const d1 = s(a, b); const d2 = s(b, c); const d3 = s(c, a);
    return (d1 >= 0 && d2 >= 0 && d3 >= 0) || (d1 <= 0 && d2 <= 0 && d3 <= 0);
  });
  const holes = [];
  // (inside a walk's own width: the corners between them are ground)
  const onWalk = (x, y) => walks.some((w) => w.nodes.slice(1).some((b, i) => {
    const a = w.nodes[i]; const ex = b[0] - a[0]; const ey = b[1] - a[1];
    const t = Math.max(0, Math.min(1, ((x - a[0]) * ex + (y - a[1]) * ey) / (ex * ex + ey * ey)));
    return Math.hypot(x - a[0] - t * ex, y - a[1] - t * ey) < w.half - 0.05;
  }));
  for (let x = -1.2; x <= 1.2; x += 0.05) for (let y = -1.2; y <= 1.2; y += 0.05) if (onWalk(x, y) && !covered(x, y)) holes.push([x.toFixed(2), y.toFixed(2)]);
  assert.equal(holes.length, 0, `holes at ${holes.slice(0, 5).join(' ')}`);
});

test('a spur mapped just past the walk it meets ends on it without doubling back', async () => {
  const { buildWalkRuns } = await import('../services/beamngSidewalks.js');
  const along = { nodes: Array.from({ length: 21 }, (_, i) => [-20 + i * 2, 0, 0]), half: 0.9, sidewalk: true };
  const spur = { nodes: [...Array.from({ length: 10 }, (_, i) => [0, -20 + i * 2, 0]), [0, -1, 0], [0, 0.6, 0]], half: 0.9, sidewalk: true };
  const runs = buildWalkRuns([along, spur], [], { groundAt: () => 5 });
  const s = runs.find((r) => r.centre.some((q) => q[1] < -5));
  const c = s.centre;
  for (let i = 1; i + 1 < c.length; i++) {
    const u = [c[i][0] - c[i - 1][0], c[i][1] - c[i - 1][1]]; const v = [c[i + 1][0] - c[i][0], c[i + 1][1] - c[i][1]];
    assert.ok(u[0] * v[0] + u[1] * v[1] > 0, `turns back at (${c[i][0].toFixed(2)}, ${c[i][1].toFixed(2)})`);
  }
});

test('each sidewalk look sets the slab material and tiles its sheet at its own repeat', async () => {
  const { getSidewalkMaterialDefs, SIDEWALK_LOOKS } = await import('../services/beamngSidewalks.js');
  for (const [name, look] of Object.entries(SIDEWALK_LOOKS)) {
    const slab = getSidewalkMaterialDefs({ look: name }).mapng_sidewalk;
    assert.equal(slab.Stages[0].baseColorMap, look.stage.baseColorMap, name);
    assert.ok(look.repeat[0] > 0 && look.repeat[1] > 0);
  }
  assert.match(getSidewalkMaterialDefs().mapng_sidewalk.Stages[0].baseColorMap, /sidewalk1/, 'the default');
  // a 10 m walk's texture runs along it by 10 / repeat[0]
  const walk = { nodes: [[0, 0, 0], [5, 0, 0], [10, 0, 0]], half: 1, sidewalk: true };
  const uvSpan = (look) => {
    const { meshes } = buildSidewalkMeshes([], { walks: [walk], groundAt: () => 5, sidewalkLook: look });
    const g = meshes[0].geometry; const uv = g.getAttribute('uv').array;
    const grp = g.groups[meshes[0].material.findIndex((m) => m.name === 'mapng_sidewalk')];
    const us = []; for (let v = grp.start; v < grp.start + grp.count; v++) us.push(uv[v * 2]);
    return Math.max(...us) - Math.min(...us);
  };
  assert.ok(Math.abs(uvSpan('eastcoast') / uvSpan('sidewalk1') - 30 / 6) < 0.3, 'five times as many repeats at a 6 m repeat as at 30 m');
});

test('a walk mapped across a rounded corner\'s slab is cut away there, not laid over it', async () => {
  const { cornerSlabRings } = await import('../services/beamngSidewalks.js');
  // secondary streets meeting square: a 6 m curb round (10, 10)
  const tags = { sidewalk: 'both' };
  const ew = street({ owner: 1, highway: 'secondary', tags, nodes: Array.from({ length: 11 }, (_, i) => [i * 10, 0, 5, 8]) });
  const ns = street({ owner: 2, highway: 'secondary', tags, nodes: Array.from({ length: 11 }, (_, i) => [0, i * 10, 5, 8]) });
  const bare = buildSidewalkMeshes([ew, ns]);
  assert.ok(cornerSlabRings(bare.corners).some((r) => r.every((q) => q[0] > 0 && q[1] > 0)), 'a slab in the corner');
  // a short walk on the slant behind the curve, 1.4 m in from its middle
  const walk = { nodes: [[5.5, 7.99, 0], [6.75, 6.75, 0], [7.99, 5.5, 0]], half: 0.4, sidewalk: true, surface: 'asphalt' };
  const built = buildSidewalkMeshes([ew, ns], { walks: [walk], groundAt: () => 5 });
  const tops = (meshes) => {
    const out = [];
    for (const mesh of meshes) {
      const pos = mesh.geometry.getAttribute('position').array;
      for (let v = 0; v + 8 < pos.length; v += 9) {
        const t = [[pos[v], pos[v + 1]], [pos[v + 3], pos[v + 4]], [pos[v + 6], pos[v + 7]]];
        if (Math.abs((t[1][0] - t[0][0]) * (t[2][1] - t[0][1]) - (t[2][0] - t[0][0]) * (t[1][1] - t[0][1])) > 1e-3) out.push(t);
      }
    }
    return out;
  };
  const count = (list, x, y) => list.filter(([a, b, c]) => {
    const s = (p, q) => (q[0] - p[0]) * (y - p[1]) - (q[1] - p[1]) * (x - p[0]);
    const d1 = s(a, b); const d2 = s(b, c); const d3 = s(c, a);
    return (d1 > 0 && d2 > 0 && d3 > 0) || (d1 < 0 && d2 < 0 && d3 < 0);
  }).length;
  // (where the walk's line crosses the corner's slab)
  const ring = cornerSlabRings(bare.corners).find((r) => r.every((q) => q[0] > 0 && q[1] > 0));
  const inRing = (x, y) => { let k = false; for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) if (((ring[i][1] > y) !== (ring[j][1] > y)) && (x < ((ring[j][0] - ring[i][0]) * (y - ring[i][1])) / (ring[j][1] - ring[i][1]) + ring[i][0])) k = !k; return k; };
  // (along its built line: pushed off the curb, it isn't where it was mapped)
  const c = built.walkRuns[0].centre; const probes = [];
  for (let i = 0; i + 1 < c.length; i++) for (let t = 0; t < 1; t += 0.1) { const x = c[i][0] + (c[i + 1][0] - c[i][0]) * t; const y = c[i][1] + (c[i + 1][1] - c[i][1]) * t; if (inRing(x, y)) probes.push([x, y]); }
  assert.ok(probes.length, 'the walk crosses the corner');
  const builtTops = tops(built.meshes); const bareTops = tops(bare.meshes);
  for (const [x, y] of probes) assert.equal(count(builtTops, x, y), count(bareTops, x, y), `nothing more over the corner at (${x.toFixed(1)}, ${y.toFixed(1)})`);
});

test('a rounded corner is paved the sidewalk\'s width in from the curve, not to a point', () => {
  // secondary streets (6 m curbs) meeting square, 2 m sidewalks
  const tags = { sidewalk: 'both' };
  const ew = street({ owner: 1, highway: 'secondary', tags, nodes: Array.from({ length: 11 }, (_, i) => [i * 10, 0, 5, 8]) });
  const ns = street({ owner: 2, highway: 'secondary', tags, nodes: Array.from({ length: 11 }, (_, i) => [0, i * 10, 5, 8]) });
  const { corners, meshes } = buildSidewalkMeshes([ew, ns]);
  const c = corners.find((k) => k.arc.every((q) => q[0] > 0 && q[1] > 0));
  assert.ok(c);
  const mid = c.arc[Math.floor(c.arc.length / 2)];
  const inward = [c.centre[0] - mid[0], c.centre[1] - mid[1]]; const L = Math.hypot(...inward);
  const [px, py] = [mid[0] + (inward[0] / L) * 1.5, mid[1] + (inward[1] / L) * 1.5];
  let covered = false;
  for (const mesh of meshes) {
    const pos = mesh.geometry.getAttribute('position').array;
    for (let v = 0; v + 8 < pos.length && !covered; v += 9) {
      const a = [pos[v], pos[v + 1]]; const b = [pos[v + 3], pos[v + 4]]; const d = [pos[v + 6], pos[v + 7]];
      const s = (p, q) => (q[0] - p[0]) * (py - p[1]) - (q[1] - p[1]) * (px - p[0]);
      const d1 = s(a, b); const d2 = s(b, d); const d3 = s(d, a);
      if ((d1 > 0 && d2 > 0 && d3 > 0) || (d1 < 0 && d2 < 0 && d3 < 0)) covered = true;
    }
  }
  assert.ok(covered, `slab 1.5 m in from the middle of the curve (${px.toFixed(1)}, ${py.toFixed(1)})`);
});

test('a merged curb run keeps its keep-out on the road side all along, far from its first piece', async () => {
  const { curbKeepOuts } = await import('../services/beamngSidewalks.js');
  // the street's first piece lies to the north-west; its next bends down and runs east
  const tags = { name: 'Long Street', sidewalk: 'both' };
  const a = street({ owner: 1, tags, nodes: Array.from({ length: 6 }, (_, i) => [-200 + i * 10, 20, 5, 8]) });
  const b = street({ owner: 2, tags, nodes: [[-150, 20, 5, 8], [-140, 19, 5, 8], [-130, 17, 5, 8], [-120, 14, 5, 8], [-110, 10, 5, 8], [-100, 6, 5, 8], [-90, 3, 5, 8], [-80, 1, 5, 8], ...Array.from({ length: 9 }, (_, i) => [-70 + i * 10, 0, 5, 8])] });
  const runs = buildSidewalkRuns([a, b]);
  assert.ok(runs.some((r) => (r.owners || []).length > 1), 'one run along both pieces');
  const quads = curbKeepOuts(runs, [a, b]);
  const inQuad = (x, y, qd) => { let k = false; for (let i = 0, j = qd.length - 1; i < qd.length; j = i++) if (((qd[i][1] > y) !== (qd[j][1] > y)) && (x < ((qd[j][0] - qd[i][0]) * (y - qd[i][1])) / (qd[j][1] - qd[i][1]) + qd[i][0])) k = !k; return k; };
  // the sidewalk's middle along the east end, either side
  for (const x of [-40, -20, 0]) for (const y of [5.2, -5.2]) assert.ok(!quads.some((qd) => inQuad(x, y, qd)), `no keep-out over the sidewalk at (${x}, ${y})`);
});
