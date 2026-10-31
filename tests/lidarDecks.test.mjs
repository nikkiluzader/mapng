import test from 'node:test';
import assert from 'node:assert/strict';
import { datasetsAt, pointGrid, fitDatum, deckProfile, toMercator, fromMercator, nodesAlong } from '../services/lidarDecks.js';

// a synthetic survey in feet with a +30 ft datum shift: ground at 10 m (ours), a deck along x at 18 m
// (a ramp at 24 m over it from x 40 on), trees over the deck's edge, noise
const FT = 0.3048;
const toSurvey = (zOurs) => (zOurs - 2) / FT;   // ours = survey * 0.3048 + 2
const cloud = () => {
  const x = []; const y = []; const z = []; const cls = [];
  const add = (px, py, pz, c) => { x.push(px); y.push(py); z.push(toSurvey(pz)); cls.push(c); };
  let seed = 1; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let px = -60; px <= 60; px += 0.7) for (let py = -30; py <= 30; py += 0.7) add(px + rnd() * 0.3, py, 10 + rnd() * 0.1, 2);
  for (let px = -50; px <= 50; px += 0.5) for (let py = -4; py <= 4; py += 0.5) add(px, py, 18 + rnd() * 0.05, 17);
  for (let px = 40; px <= 60; px += 0.5) for (let py = -3; py <= 3; py += 0.5) add(px, py, 24 + rnd() * 0.05, 1);
  for (let k = 0; k < 40; k++) add(-10 + rnd() * 4, 4 + rnd(), 27 + rnd() * 3, 5);   // a tree over the edge
  return { x: Float64Array.from(x), y: Float64Array.from(y), z: Float64Array.from(z), cls: Uint8Array.from(cls) };
};

test('mercator round trip', () => {
  const [lat, lng] = fromMercator(...toMercator(30.31, -81.65));
  assert.ok(Math.abs(lat - 30.31) < 1e-9 && Math.abs(lng + 81.65) < 1e-9);
});

test('datasets at a point: newest first', () => {
  const idx = [{ name: 'FL_DuvalCo_2007', bbox: [-82, 30, -81, 31] }, { name: 'FL_Peninsular_FDEM_Duval_2018', bbox: [-82, 30, -81, 31] }, { name: 'X_2020', bbox: [0, 0, 1, 1] }];
  assert.deepEqual(datasetsAt(idx, 30.3, -81.6).map((d) => d.name), ['FL_Peninsular_FDEM_Duval_2018', 'FL_DuvalCo_2007']);
});

test('the datum: feet and an offset found from the ground points', () => {
  const grid = pointGrid([cloud()], (x, y) => [x, y]);
  const samples = []; for (let x = -55; x <= 55; x += 5) for (const y of [-20, 20]) samples.push([x, y]);
  const d = fitDatum(grid, samples, () => 10);
  assert.equal(d.scale, FT);
  assert.ok(Math.abs(d.offset - 2) < 0.1, `offset ${d.offset}`);
  assert.ok(d.spread < 0.1);
});

test('the deck surface per station: the deck, not the ground, the tree or the ramp over it', () => {
  const grid = pointGrid([cloud()], (x, y) => [x, y]);
  const datum = { scale: FT, offset: 2 };
  const line = []; for (let x = -48; x <= 48; x += 4) line.push([x, 0]);
  const z = deckProfile(grid, line, 4, datum, () => 10);
  const ok = [...z].filter(Number.isFinite);
  assert.ok(ok.length >= line.length - 2, `measured ${ok.length} of ${line.length}`);
  for (const v of ok) assert.ok(Math.abs(v - 18) < 0.3, `a station at ${v}`);
  // the ramp over it: rank 1 over the ground takes the upper level where both are
  const up = deckProfile(grid, [[44, 0], [48, 0], [52, 0], [56, 0]], 3, datum, () => 10, { rank: 1 });
  assert.ok([...up].filter(Number.isFinite).every((v) => Math.abs(v - 24) < 0.3), JSON.stringify([...up]));
});

test('the octree walk: the deepest nodes on the path at road height', async () => {
  const ept = { bounds: [0, 0, 0, 1024, 1024, 1024] };
  const hier = { '0-0-0-0': 10, '1-0-0-0': 5, '2-0-0-0': 4, '2-1-0-0': -1 };
  const pages = { 'ept-hierarchy/0-0-0-0.json': hier, 'ept-hierarchy/2-1-0-0.json': { '2-1-0-0': 7, '3-2-0-0': 3 } };
  const getJson = async (p) => pages[p] || null;
  assert.deepEqual(await nodesAlong(ept, getJson, [[300, 10]], [0, 100]), ['3-2-0-0'], 'the deepest level');
  const two = await nodesAlong(ept, getJson, [[300, 10]], [0, 100], { levels: 2 });
  assert.deepEqual(two.sort(), ['2-1-0-0', '3-2-0-0']);
});

test('pins: a bridge measured along most of it pinned, a movable span never', async () => {
  const { lidarPins } = await import('../services/lidarDecks.js');
  const grid = pointGrid([cloud()], (x, y) => [x, y]);
  const xs = []; for (let x = -40; x <= 36; x += 4) xs.push(x);
  const edge = (extra) => ({ bridge: true, layer: 1, half: 4, s: Float64Array.from(xs.map((_, i) => i * 4)), x: Float64Array.from(xs), y: Float64Array.from(xs.map(() => 0)), ...extra });
  const graph = { edges: [edge({ wayId: 1 }), edge({ wayId: 2, movable: 'bascule' }), { bridge: false, s: [0, 1], x: [0, 1], y: [0, 0] }] };
  const { pins, bridges } = lidarPins(graph, { grid, datum: { scale: FT, offset: 2 } }, () => 10, 5);
  assert.equal(bridges.length, 2);
  assert.ok(bridges[0].pinned && !bridges[1].pinned && pins.length >= xs.length - 2);
  assert.ok(pins.every(([k, , z]) => k === 0 && Math.abs(z - 13) < 0.3), 'world z (minus minHeight 5)');
});

test('pins: an unpinned span between two measured ones laid straight between their ends', async () => {
  const { lidarPins } = await import('../services/lidarDecks.js');
  const grid = pointGrid([cloud()], (x, y) => [x, y]);
  // a bridge along x: fixed -48..-12, a bascule in two leaves -12..0..12, fixed 12..48; a stub off the far end unmeasured
  const edge = (x0, x1, from, to, extra) => {
    const xs = []; for (let x = x0; x <= x1 + 1e-9; x += 2) xs.push(x);
    return { bridge: true, layer: 1, half: 4, from, to, s: Float64Array.from(xs.map((x) => x - x0)), x: Float64Array.from(xs), y: Float64Array.from(xs.map(() => 0)), ...extra };
  };
  // (the first leaf drawn from the middle out, c to b: walked backwards)
  const leaf = edge(-12, 0, 'c', 'b', { movable: 'bascule' }); leaf.x = leaf.x.slice().reverse();
  const edges = [edge(-48, -12, 'a', 'b'), leaf, edge(0, 12, 'c', 'd', { movable: 'bascule' }), edge(12, 48, 'd', 'e'), edge(48, 58, 'e', 'f', { movable: 'lift' })];
  const nodes = new Map();
  edges.forEach((e, k) => { for (const [id, end] of [[e.from, 0], [e.to, 1]]) { if (!nodes.has(id)) nodes.set(id, { id, edges: [] }); nodes.get(id).edges.push({ edge: k, end }); } });
  const { pins, bridges } = lidarPins({ edges, nodes }, { grid, datum: { scale: FT, offset: 2 } }, () => 10, 5);
  for (const k of [1, 2]) {
    const mine = pins.filter((p) => p[0] === k);
    assert.equal(mine.length, edges[k].s.length, `leaf ${k} pinned at every station`);
    assert.ok(mine.every(([, , z]) => Math.abs(z - 13) < 0.3), `leaf ${k} level with the fixed spans`);
  }
  assert.ok(!pins.some((p) => p[0] === 4), 'a span with one measured neighbour keeps its inferred profile');
  assert.deepEqual(bridges.filter((b) => b.bridged).map((b) => b.k).sort(), [1, 2]);
});
