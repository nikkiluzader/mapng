import test from 'node:test';
import assert from 'node:assert/strict';
import { composeTerrain } from '../services/structures/terrainCompose.js';
import { shapingSwitches, shapingPlan } from '../services/structures/shaping.js';
import { gradeLimit } from '../services/structures/profileSolve.js';
import { generateDecalRoads, tunnelGroundMisfit } from '../services/exportBeamNGLevel.js';
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
