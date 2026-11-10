import test from 'node:test';
import assert from 'node:assert/strict';
import { composeTerrain } from '../services/structures/terrainCompose.js';
import { shapingSwitches, shapingPlan } from '../services/structures/shaping.js';
import { gradeLimit } from '../services/structures/profileSolve.js';
import { generateDecalRoads, tunnelGroundMisfit, cutCoverDig } from '../services/exportBeamNGLevel.js';
import { STRUCTURE_SCENES, SCENE_SQUARE_SIZE as SQ } from './helpers/structureScenes.mjs';

// a scene through the road and structure passes with the given export
// switches (the structure solver building the level, as the export does)
const run = (name, opts = {}) => {
  const log = console.log; console.log = () => {};
  try {
    const td = STRUCTURE_SCENES.find((s) => s.name === name).build();
    const before = Float32Array.from(td.heightMap);
    const groups = generateDecalRoads(td, SQ, { structureSolver: 'v2', ...opts });
    const g = groups.structureGraph;
    const composed = composeTerrain(g, {
      heightMap: td.heightMap, width: td.width, height: td.height, worldSize: td.width * SQ, minHeight: td.minHeight,
      skip: g.shaping?.skip || null,
    });
    return { td, before, groups, g, composed };
  } finally { console.log = log; }
};
const offOnGround = (g, k, i) => Math.abs(g.profile.z[k][i] - g.edges[k].g[i]);

test('shaping switches: each on by default, the master switch turns them all off', () => {
  assert.deepEqual(shapingSwitches(), { roads: true, bridges: true, overpasses: true, tunnels: true });
  assert.deepEqual(shapingSwitches({ overpasses: false }), { roads: true, bridges: true, overpasses: false, tunnels: true });
  assert.deepEqual(shapingSwitches({ terrain: false, roads: true }), { roads: false, bridges: false, overpasses: false, tunnels: false });
});

test('terrain shaping off everywhere: the composer changes no grid point, every ordinary road on its ground', () => {
  const { g, composed } = run('overpass on flat ground', { shaping: { terrain: false } });
  assert.equal(composed.stats.pixels, 0);
  g.edges.forEach((e, k) => {
    if (e.bridge || e.tunnel) return;
    for (let i = 0; i < e.s.length; i++) assert.ok(offOnGround(g, k, i) < 1e-6, `edge ${k} station ${i} ${offOnGround(g, k, i).toFixed(3)} m off its ground`);
  });
});

test('overpass shaping off: approaches on the ground, the bridge a deck from ground to ground over the road', () => {
  const { g, composed } = run('overpass on flat ground', { shaping: { overpasses: false } });
  const plan = g.shaping;
  assert.ok(plan.rawDeck.size >= 1, 'the overpass is built as a plain deck');
  assert.ok(plan.stats.byRole.overpass > 0, 'its approaches are held');
  for (const k of plan.rawDeck) {
    const e = g.edges[k]; const z = g.profile.z[k];
    // never dug below its ground; its ends meet the held approaches
    for (let i = 0; i < e.s.length; i++) assert.ok(z[i] >= e.g[i] - 1e-6);
    assert.ok(offOnGround(g, k, 0) < 0.05 && offOnGround(g, k, e.s.length - 1) < 0.05, 'deck ends on the ground');
    // and it rose over the road it crosses: a deck stretch in its classes
    assert.ok(g.classes.segments.some((s) => s.edge === k && s.kind === 'deck' && s.raw));
  }
  // nothing composed for the overpass or its approaches; the road under it still shaped
  assert.ok(composed.stats.skipped > 0);
});

test('plain decks ramp smoothly: never steeper than twice their class grade, no step at a held end', () => {
  for (const name of ['overpass on flat ground', 'three-level stack', 'two crossings closer than a ramp', 'short bridge over a ship channel in a town']) {
    const { g } = run(name, { shaping: { terrain: false } });
    for (const k of g.shaping.rawDeck) {
      const e = g.edges[k]; const z = g.profile.z[k]; const lim = 2 * gradeLimit(e.highway) + 0.005;
      for (let i = 0; i + 1 < e.s.length; i++) {
        const gr = Math.abs(z[i + 1] - z[i]) / (e.s[i + 1] - e.s[i]);
        assert.ok(gr <= lim, `${name}: edge ${k} ${(gr * 100).toFixed(1)}% at s ${e.s[i].toFixed(0)}`);
      }
    }
  }
});

test('road shaping off alone: a bridge with its shaping on still lifts its approaches', () => {
  const { g } = run('overpass on flat ground', { shaping: { roads: false } });
  assert.equal(g.shaping.rawDeck.size, 0);
  // some approach station is off the ground (an embankment toward the deck)
  const lifted = g.edges.some((e, k) => !e.bridge && Array.from(e.s, (_, i) => offOnGround(g, k, i)).some((d) => d > 0.5));
  assert.ok(lifted, 'an approach embankment');
});

test('no bridges: no deck anywhere, the bridge road on its ground', () => {
  const { g } = run('overpass on flat ground', { includeBridges: false });
  assert.ok(!g.classes.segments.some((s) => s.kind === 'deck'));
  assert.ok(g.edges.every((e) => !e.bridge));
});

test('no tunnels: no tunnel built and none of its ground graded', () => {
  const { groups, before, td } = run('mountain tunnel through a ridge', { includeTunnels: false });
  assert.equal(groups.tunnels.tunnels.length, 0);
  assert.ok(td.heightMap.every((v, i) => v === before[i]), 'the heightmap is untouched by the road stage');
});

test('tunnel shaping off: a tunnel is built ungraded or left on the ground, never dug in', () => {
  for (const name of ['mountain tunnel through a ridge', 'urban cut-and-cover under a street grid']) {
    const { groups, before, td } = run(name, { shaping: { tunnels: false } });
    const t = groups.tunnels;
    for (const tt of t.tunnels) assert.equal(tt.gradedPixels, 0, `${name}: tunnel graded`);
    assert.ok(td.heightMap.every((v, i) => v === before[i]), `${name}: heightmap changed`);
    if (name.includes('cut-and-cover')) assert.ok(t.skipped.some((s) => s.shaping && /cut-and-cover/.test(s.reason)), 'the box left on the ground, with the reason');
  }
});

test('tunnelGroundMisfit: a box never fits, a bore fits when its approaches meet the ground', () => {
  const line = (dz) => Array.from({ length: 10 }, (_, k) => ({ z: k >= 3 && k <= 6 ? -8 : dz, g: 0 }));
  assert.equal(tunnelGroundMisfit({ kind: 'cutcover', line: line(0), iS: 3, iN: 6 }).ok, false);
  assert.equal(tunnelGroundMisfit({ kind: 'bored', line: line(0.4), iS: 3, iN: 6 }).ok, true);
  const deep = tunnelGroundMisfit({ kind: 'bored', line: line(-3), iS: 3, iN: 6 });
  assert.equal(deep.ok, false);
  assert.match(deep.reason, /3\.0 m of cutting/);
});

test('cutCoverDig: how deep a box\'s approaches cut under the ground', () => {
  // approaches 7 m under the ground (a trench), the box itself not counted
  const line = Array.from({ length: 10 }, (_, k) => ({ z: k >= 3 && k <= 6 ? -12 : (k === 2 || k === 7 ? -7 : -1), g: 0 }));
  assert.equal(cutCoverDig({ kind: 'cutcover', line, iS: 3, iN: 6 }), 7);
  assert.equal(cutCoverDig({ kind: 'cutcover', line: line.map((p) => ({ ...p, z: Math.max(p.z, -2) })), iS: 3, iN: 6 }), 2);
});

test('shapingPlan on a hand-made graph: approaches belong to the structure they lead to', () => {
  const edge = (from, to, x0, extra = {}) => ({ from, to, s: Float64Array.from([0, 100, 250, 300]), x: Float64Array.from([x0, x0 + 100, x0 + 250, x0 + 300]), y: new Float64Array(4), g: new Float64Array(4), half: 4, layer: 0, ...extra });
  const graph = { edges: [edge('a', 'b', 0), edge('b', 'c', 300, { bridge: true, layer: 1 }), edge('c', 'd', 600)], crossings: { crossings: [] } };
  const plan = shapingPlan(graph, { roads: true, bridges: false, overpasses: true, tunnels: true });
  // edge 0 ends at the bridge (node b): its last 200 m held, its first station free
  assert.deepEqual(Array.from(plan.fixed[0]), [0, 1, 1, 1]);
  assert.deepEqual(Array.from(plan.fixed[2]), [1, 1, 0, 0]);
  assert.equal(plan.noCut[1], true);
  assert.ok(plan.rawDeck.has(1));
  assert.equal(plan.skip(1, 0), true);
  assert.equal(plan.skip(0, 0), false);
});

test('simple bridge spans its dip rim to rim, not only the OSM bridge stretch (Wasatch Blvd shape)', async () => {
  const { simpleSpans } = await import('../services/structures/shaping.js');
  // a road heading north: flat at 72 m, the OSM bridge from y 30 to 57 down
  // the near slope to the floor (66.5), the floor (65.9 at y 63) and the far
  // wall up to 71 m at y 80 all on the next road, then flat (measured in game)
  const ground = (y) => {
    if (y <= 32) return 72;
    if (y <= 57) return 72 - (y - 32) * (5.5 / 25);
    if (y <= 63) return 66.5 - (y - 57) * 0.1;
    if (y <= 80) return 65.9 + (y - 63) * (5.1 / 17);
    return 71 - (y - 80) * 0.004;
  };
  const edge = (from, to, y0, y1, extra = {}) => {
    const ys = []; for (let y = y0; y <= y1 + 1e-9; y += 2.5) ys.push(y);
    return { from, to, s: Float64Array.from(ys, (y) => y - y0), x: new Float64Array(ys.length), y: Float64Array.from(ys), g: Float64Array.from(ys, ground), half: 7, layer: 0, highway: 'secondary', ...extra };
  };
  const graph = { edges: [edge('a', 'b', -100, 30), edge('b', 'c', 30, 57.5, { bridge: true, layer: 1 }), edge('c', 'd', 57.5, 200)] };
  const { list, pins } = simpleSpans(graph, new Set([1]));
  assert.equal(list.length, 1);
  const [sp] = list;
  // A at the near rim (~72 m, y 30-32), B at the far rim (~71 m, y ~80)
  assert.ok(Math.abs(sp.from[2] - 72) < 0.2 && sp.from[1] <= 32.5 && sp.from[1] >= 20, `A at y ${sp.from[1]} z ${sp.from[2]}`);
  assert.ok(Math.abs(sp.to[2] - 71) < 0.2 && Math.abs(sp.to[1] - 80) <= 5, `B at y ${sp.to[1]} z ${sp.to[2]}`);
  // the deck straight between them, never under the ground
  for (const [k, i, z] of pins) {
    const y = graph.edges[k].y[i];
    const line = sp.from[2] + (sp.to[2] - sp.from[2]) * (y - sp.from[1]) / (sp.to[1] - sp.from[1]);
    assert.ok(z >= graph.edges[k].g[i] - 1e-9 && Math.abs(z - line) < 0.05, `y ${y}: ${z.toFixed(2)} vs line ${line.toFixed(2)}`);
  }
  // and it reaches onto the far approach (where OSM's bridge had stopped)
  assert.ok(pins.some(([k]) => k === 2));
});

test('a plain deck with measured heights: rim to rim through them, no dip to the line', async () => {
  const { simpleSpans } = await import('../services/structures/shaping.js');
  // water at 0 from y 0 to 95, an abutment up to 4.6 m by y 100, then the island falling gently;
  // the bridge y -50..96 measured at 6 m out to y 90 (the survey's last points short of its end)
  const ground = (y) => (y <= 95 ? (y < -50 ? 5 : 0) : y <= 100 ? (y - 95) * 0.92 : 4.6 - (y - 100) * 0.03);
  const edge = (from, to, y0, y1, extra = {}) => {
    const ys = []; for (let y = y0; y <= y1 + 1e-9; y += 2) ys.push(y);
    return { from, to, s: Float64Array.from(ys, (y) => y - y0), x: new Float64Array(ys.length), y: Float64Array.from(ys), g: Float64Array.from(ys, ground), half: 5, layer: 0, highway: 'primary', ...extra };
  };
  const graph = { edges: [edge('a', 'b', -120, -50), edge('b', 'c', -50, 96, { bridge: true, layer: 1 }), edge('c', 'd', 96, 200)] };
  const measured = [];
  graph.edges[1].y.forEach((y, i) => { if (y <= 90) measured.push([1, i, 6]); });
  const { pins } = simpleSpans(graph, new Set([1]), measured);
  const zAt = new Map(pins.map(([k, i, z]) => [`${k}:${i}`, z]));
  for (const [k, i, z] of measured) assert.equal(zAt.get(`${k}:${i}`) ?? z, z, 'measured stations keep their height');
  // from the last measured station (6 m at y 90) down to the abutment's top: never under 4.6 before the rim, no dip
  const tail = pins.filter(([k, i]) => graph.edges[k].y[i] > 90).sort((p, q) => graph.edges[p[0]].y[p[1]] - graph.edges[q[0]].y[q[1]]);
  assert.ok(tail.length >= 3);
  for (let j = 1; j < tail.length; j++) assert.ok(tail[j][2] <= tail[j - 1][2] + 1e-9, 'falls steadily onto the abutment');
  assert.ok(tail.every(([, , z]) => z >= 4.5), `stays on the abutment top: ${tail.map((p) => p[2].toFixed(2)).join(' ')}`);
});

test('a plain deck over a road: a ditch beside the road does not hold it down on the road', async () => {
  const { simpleSpans } = await import('../services/structures/shaping.js');
  // flat at 10 m with a 1 m dip from y -22 to 22; a road crosses under at y 0
  const ground = (y) => (Math.abs(y) < 22 ? 9 : 10);
  const edge = (from, to, y0, y1, extra = {}) => {
    const ys = []; for (let y = y0; y <= y1 + 1e-9; y += 2) ys.push(y);
    return { from, to, s: Float64Array.from(ys, (y) => y - y0), x: new Float64Array(ys.length), y: Float64Array.from(ys), g: Float64Array.from(ys, ground), highway: 'service', ...extra };
  };
  const bridge = edge('b', 'c', -24, 24, { bridge: true, layer: 1 });
  const under = { from: 'x', to: 'y', s: Float64Array.from([0, 100]), x: Float64Array.from([-50, 50]), y: new Float64Array(2), g: Float64Array.from([9, 9]), highway: 'raceway' };
  const graph = { edges: [edge('a', 'b', -100, -24), bridge, edge('c', 'd', 24, 100), under] };
  graph.crossings = { crossings: [{ a: { edge: 1, i: 12, f: 0, s: 24 }, b: { edge: 3, i: 0, f: 0.5, s: 50 }, x: 0, y: 0, upper: 'a', rule: 'layer', sep: 6.5 }] };
  const { pins } = simpleSpans(graph, new Set([1]));
  const atRoad = pins.find(([k, i]) => k === 1 && i === 12);
  assert.ok(atRoad[2] - 9 >= 3.8, `over the road: ${(atRoad[2] - 9).toFixed(2)} m`);
  const noCross = simpleSpans({ edges: graph.edges }, new Set([1])).pins.find(([k, i]) => k === 1 && i === 12);
  assert.ok(noCross[2] - 9 < 1.5, 'with nothing under it, the straight line from rim to rim');
});

test('cut and cover on fine data: built where its ramps are in the survey, left on the ground where the data shows the road at grade', async () => {
  const { runStructureScene, sceneTerrain, sceneWay } = await import('./helpers/structureScenes.mjs');
  const roads = [
    sceneWay(1, [[-450, 0], [-150, 0]], { highway: 'trunk' }),
    sceneWay(2, [[-150, 0], [150, 0]], { highway: 'trunk', tunnel: 'yes', layer: '-1' }),
    sceneWay(3, [[150, 0], [450, 0]], { highway: 'trunk' }),
    sceneWay(10, [[0, -300], [0, 300]], { highway: 'residential' }),
  ];
  // the ramps in the survey: the road's trench dropping 7 m over 120 m to each portal, 12 m wide
  const ramps = (x, y) => {
    if (Math.abs(y) > 6) return 10;
    const d = Math.abs(x);
    return d >= 270 ? 10 : d > 150 ? 10 - 7 * (270 - d) / 120 : 10;
  };
  const quiet = console.log; console.log = () => {};
  let withRamps; let atGrade;
  try {
    withRamps = await runStructureScene({ name: 'fine cut-and-cover with ramps', build: () => sceneTerrain(ramps, roads) });
    atGrade = await runStructureScene({ name: 'fine cut-and-cover at grade', build: () => sceneTerrain(() => 10, roads) });
  } finally { console.log = quiet; }
  assert.ok(withRamps.summary.tunnels > 0, 'with its ramps in the survey: built');
  assert.equal(atGrade.summary.tunnels, 0, 'the data shows the road at grade: left on the ground');
});

test('No smoothing areas: the ordinary roads there stay on their ground, the rest are still shaped', () => {
  // the south half of the scene marked No smoothing
  const rawAt = (x, y) => y < 0;
  const { g } = run('track down through a steep gully', { rawAt });
  const plan = g.shaping;
  assert.ok(plan, 'a plan even with every switch on');
  assert.ok(plan.stats.rawAreaStations > 0);
  let west = 0;
  g.edges.forEach((e, k) => {
    if (e.bridge || e.tunnel) return;
    for (let i = 0; i < e.s.length; i++) {
      if (e.y[i] < 0) assert.ok(plan.fixed[k]?.[i], 'in the area: held');
      if (e.y[i] < 0 && plan.fixed[k]?.[i]) { west++; assert.ok(offOnGround(g, k, i) < 1e-6, `edge ${k} station ${i} ${offOnGround(g, k, i).toFixed(3)} m off its ground`); }
      if (e.y[i] >= 0) assert.ok(!plan.fixed[k]?.[i], 'north of the line: free to be shaped');
    }
  });
  assert.ok(west > 0);
});

test('restoreRawAreas: the heights from before smoothing come back by the weight', async () => {
  const { restoreRawAreas } = await import('../services/terrain.js');
  const W = 5; const H = 3;
  const smoothed = new Float32Array(W * H).fill(10);
  const before = new Float32Array(W * H).fill(20);
  const bounds = { north: 1, south: 0, west: 0, east: 1 };
  // full on the west column, half at the middle, none to the east
  const r = restoreRawAreas(smoothed, before, W, H, bounds, bounds, (u) => (u < 0.1 ? 1 : u < 0.6 ? 0.5 : 0));
  assert.equal(smoothed[0], 20); assert.equal(smoothed[2], 15); assert.equal(smoothed[4], 10);
  assert.deepEqual(r, { cells: 3, eased: 6 });
});

test('a ramp\'s bridge beside a wide bridge over the same dip takes its deck height (no span of its own from the dip)', async () => {
  const { simpleSpans } = await import('../services/structures/shaping.js');
  // the main road north over a dip (floor 65 m at y 45, rims 72 and 71); 12 m east of it a
  // one-lane ramp whose bridge OSM ends at y 50, over a flat bench in the dip (66 m, the ground
  // a survey leaves under a wide bridge): on its own it would set down on the bench
  const ground = (y) => (y <= 30 ? 72 : y <= 45 ? 72 - (y - 30) * (7 / 15) : y <= 60 ? 65 + (y - 45) * (6 / 15) : 71);
  const bench = (y) => (y <= 30 ? 72 : y <= 42 ? 72 - (y - 30) * (6.6 / 12) : y <= 45 ? 65.4 + (y - 42) * 0.2 : y <= 75 ? 66 : y <= 90 ? 66 + (y - 75) * (5 / 15) : 71);
  const edge = (from, to, x, y0, y1, extra = {}, gr = ground) => {
    const ys = []; for (let y = y0; y <= y1 + 1e-9; y += 2.5) ys.push(y);
    return { from, to, s: Float64Array.from(ys, (y) => y - y0), x: new Float64Array(ys.length).fill(x), y: Float64Array.from(ys), g: Float64Array.from(ys, gr), half: 10, layer: 1, highway: 'primary', ...extra };
  };
  const link = { half: 2.8, highway: 'primary_link' };
  const build = () => ({ edges: [
    edge('a', 'b', 0, -100, 30, { layer: 0 }), edge('b', 'c', 0, 30, 60, { bridge: true }), edge('c', 'd', 0, 60, 200, { layer: 0 }),
    edge('p', 'q', 12, -100, 30, { layer: 0, ...link }, bench), edge('q', 'r', 12, 30, 50, { bridge: true, ...link }, bench), edge('r', 't', 12, 50, 200, { layer: 0, ...link }, bench),
  ] });
  const zAt = (graph, pins, k, y) => pins.find(([kk, i]) => kk === k && Math.abs(graph.edges[k].y[i] - y) < 1e-6)?.[2];
  const graph = build();
  const { pins } = simpleSpans(graph, new Set([1, 4]));
  // over the dip the ramp is level with the main deck, on its bridge and on past OSM's end of it
  for (const [k, y] of [[4, 35], [4, 45], [4, 50], [5, 55]]) {
    const main = zAt(graph, pins, 1, y);
    assert.ok(Math.abs(zAt(graph, pins, k, y) - main) < 0.05, `ramp at y ${y}: ${zAt(graph, pins, k, y)?.toFixed(2)} vs the main deck ${main?.toFixed(2)}`);
  }
  // a bridge on another layer beside it keeps its own span (down onto the bench)
  const stacked = build(); stacked.edges[4].layer = 2;
  const other = simpleSpans(stacked, new Set([1, 4]));
  assert.ok(zAt(stacked, other.pins, 1, 50) - zAt(stacked, other.pins, 4, 50) > 2, 'another layer: not tied to the deck beside it');
});

test('solved heights on a switchback: a decal keeps to its own arm past a knot of stations at the hairpin', async () => {
  const { applySolvedHeights } = await import('../services/structures/adapters.js');
  // one road: east 200 m, a hairpin whose tip the map draws with 30 points on one spot, back west
  // 12 m north; it climbs 0.1 m per metre. Stations every 4 m.
  const xs = []; const ys = [];
  for (let x = 0; x <= 200; x += 4) { xs.push(x); ys.push(0); }
  for (let j = 0; j < 30; j++) { xs.push(206); ys.push(6); }
  for (let x = 200; x >= 0; x -= 4) { xs.push(x); ys.push(12); }
  const s = [0]; for (let i = 1; i < xs.length; i++) s.push(s[i - 1] + Math.hypot(xs[i] - xs[i - 1], ys[i] - ys[i - 1]));
  const graph = { edges: [{ seg: 7, s: Float64Array.from(s), x: Float64Array.from(xs), y: Float64Array.from(ys), g: Float64Array.from(s, (v) => v * 0.1) }], profile: { z: [Float64Array.from(s, (v) => v * 0.1)] }, classes: { segments: [] } };
  // the decal: the same line, a node every 2 m
  const nodes = [];
  for (let x = 100; x <= 200; x += 2) nodes.push([x, 0, 0, 7]);
  nodes.push([206, 6, 0, 7]);
  for (let x = 200; x >= 100; x -= 2) nodes.push([x, 12, 0, 7]);
  applySolvedHeights([{ __items: [{ __owner: 7, name: 'dr', nodes }] }], graph);
  const sTip = s[51 + 29];
  nodes.forEach(([x, y, z]) => {
    const want = (y === 0 ? x : y === 6 ? sTip : sTip + Math.hypot(6, 6) + (200 - x)) * 0.1;
    assert.ok(Math.abs(z - want) < 1.2, `node (${x}, ${y}): ${z.toFixed(1)} m, its road is at ${want.toFixed(1)} m`);
  });
});

test('a T-junction on a steepening hill: no jump in the through road\'s grade, its lanes its own, the side road leaving at its grade', async () => {
  const { sceneTerrain, sceneWay } = await import('./helpers/structureScenes.mjs');
  // going east the ground falls at 4%, steepening to 14% over 200 m, then 14% on: steeper than a
  // trunk road's limit. A side street joins from the south where it is 14%.
  const h = (x) => { const t = x + 250; return 200 - (t <= 0 ? 0.04 * t : t <= 200 ? 0.04 * t + 0.1 * t * t / 400 : 18 + 0.14 * (t - 200)); };
  const td = sceneTerrain((x) => h(x), [
    sceneWay(1, [[-450, 0], [100, 0]], { highway: 'trunk' }),
    sceneWay(2, [[100, 0], [450, 0]], { highway: 'trunk' }),
    sceneWay(3, [[100, 0], [100, -300]], { highway: 'residential' }),
  ], { coarse: true });
  const log = console.log; console.log = () => {};
  let g; let composed;
  try {
    g = generateDecalRoads(td, SQ, { structureSolver: 'v2' }).structureGraph;
    composed = composeTerrain(g, { heightMap: td.heightMap, width: td.width, height: td.height, worldSize: td.width * SQ, minHeight: td.minHeight, skip: g.shaping?.skip || null });
  } finally { console.log = log; }
  // along each trunk edge: the grade over 10 m never changes by more than 4% from one 10 m to the next
  const zAt = (e, z, s) => { let i = 0; while (i + 2 < e.s.length && e.s[i + 1] < s) i++; return z[i] + (z[i + 1] - z[i]) * ((s - e.s[i]) / ((e.s[i + 1] - e.s[i]) || 1)); };
  let trunks = 0;
  g.edges.forEach((e, k) => {
    if (e.highway !== 'trunk') return;
    trunks++;
    const z = g.profile.z[k]; const total = e.s[e.s.length - 1]; let last = null;
    for (let s = 0; s + 10 <= total; s += 10) {
      const grade = (zAt(e, z, s + 10) - zAt(e, z, s)) / 10;
      if (last !== null) assert.ok(Math.abs(grade - last) < 0.04, `grade ${(last * 100).toFixed(1)}% then ${(grade * 100).toFixed(1)}% at ${s.toFixed(0)} m of a trunk edge`);
      last = grade;
    }
  });
  assert.ok(trunks >= 2);
  // the trunk road's south lane beside the junction: its own surface, level across (the ground falls along x only)
  for (const x of [92, 96, 100, 104, 108]) {
    const centre = composed.heightAt(x, 0); const lane = composed.heightAt(x, -5);
    assert.ok(Math.abs(lane - centre) < 0.1, `at x ${x}: the lane ${lane.toFixed(2)} m, the centre line ${centre.toFixed(2)} m`);
  }
  // 3 m past the trunk road's edge the side street's surface still falls with it, edge to edge
  const edgeY = -(g.edges.find((e) => e.highway === 'trunk').half + 3);
  const fall = composed.heightAt(98, edgeY) - composed.heightAt(102, edgeY);
  assert.ok(fall > 0.25, `the side street 3 m off the lanes is level across (${fall.toFixed(2)} m over 4 m) where the trunk road falls 0.56 m`);
});

test('a road down a hill steeper than its class allows: one even grade down it, no sawtooth', async () => {
  const { sceneTerrain, sceneWay } = await import('./helpers/structureScenes.mjs');
  // going east: 4%, then 160 m at 14% (twice a trunk road's limit), then 5%
  const h = (x) => 200 - (x <= -250 ? 0.04 * (x + 250) : x <= -90 ? 0.14 * (x + 250) : 22.4 + 0.05 * (x + 90));
  const td = sceneTerrain((x) => h(x), [sceneWay(1, [[-450, 0], [450, 0]], { highway: 'trunk' })], { coarse: true });
  const log = console.log; console.log = () => {};
  let g;
  try { g = generateDecalRoads(td, SQ, { structureSolver: 'v2' }).structureGraph; } finally { console.log = log; }
  const e = g.edges[0]; const z = g.profile.z[0];
  const zAt = (s) => { let i = 0; while (i + 2 < e.s.length && e.s[i + 1] < s) i++; return z[i] + (z[i + 1] - z[i]) * ((s - e.s[i]) / ((e.s[i + 1] - e.s[i]) || 1)); };
  // (held to its 7% limit along part of the hill and let go at 21% beside it, the road ran 14, 11, 7, 16, 21, 15%)
  let steepest = 0;
  for (let s = 0; s + 10 <= e.s[e.s.length - 1]; s += 10) {
    const grade = (zAt(s + 10) - zAt(s)) / 10;
    steepest = Math.max(steepest, Math.abs(grade));
    if (s >= 230 && s <= 330) assert.ok(Math.abs(grade + 0.14) < 0.03, `${(grade * 100).toFixed(1)}% at ${s} m, on the hill's even 14%`);
  }
  assert.ok(steepest < 0.2, `steepest ${(steepest * 100).toFixed(1)}% on a 14% hill`);
});
