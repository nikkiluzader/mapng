import test from 'node:test';
import assert from 'node:assert/strict';
import { crossingOrder, requiredSeparation } from '../services/structures/crossings.js';
import { STRUCTURE_SCENES, runStructureScene } from './helpers/structureScenes.mjs';

const scene = async (name) => {
  const log = console.log; console.log = () => {};
  try { return (await runStructureScene(STRUCTURE_SCENES.find((s) => s.name === name))).groups.structureGraph; } finally { console.log = log; }
};

test('order: layer, then bridge tag, then tunnel tag; nothing says for two plain roads', () => {
  const road = (o) => ({ layer: 0, bridge: false, tunnel: false, highway: 'secondary', ...o });
  assert.deepEqual(crossingOrder(road({ layer: 2 }), road({ layer: 1 })), { upper: 'a', rule: 'layer' });
  assert.deepEqual(crossingOrder(road({}), road({ bridge: true })), { upper: 'b', rule: 'bridge' });
  assert.deepEqual(crossingOrder(road({ tunnel: true }), road({})), { upper: 'b', rule: 'tunnel' });
  assert.equal(crossingOrder(road({}), road({})), null);
  assert.equal(requiredSeparation(road({}), road({ highway: 'footway' })) < requiredSeparation(road({}), road({})), true);
});

test('overpass: one crossing, the bridge on top, 6.5 m', async () => {
  const g = await scene('overpass on flat ground');
  const { crossings, stats } = g.crossings;
  assert.equal(stats.crossings, 1);
  const c = crossings[0];
  const upper = g.edges[c[c.upper].edge];
  assert.equal(upper.bridge, true);
  assert.equal(c.sep, 6.5);
  assert.ok(Math.abs(c.x) < 1 && Math.abs(c.y) < 1, 'at the centre');
});

test('stack: the layer-2 link over both the trunk deck and the motorway', async () => {
  const g = await scene('three-level stack');
  const { crossings } = g.crossings;
  assert.equal(crossings.length, 3);
  const pairs = crossings.map((c) => [g.edges[c[c.upper].edge].layer, g.edges[c[c.upper === 'a' ? 'b' : 'a'].edge].layer].join('>')).sort();
  assert.deepEqual(pairs, ['1>0', '2>0', '2>1']);
});

test('cut-and-cover: five streets over the tunnel; two crossings of one bridge', async () => {
  const cc = await scene('urban cut-and-cover under a street grid');
  assert.equal(cc.crossings.stats.crossings, 5);
  assert.ok(cc.crossings.crossings.every((c) => !cc.edges[c[c.upper].edge].tunnel), 'the streets on top');
  const two = await scene('two crossings closer than a ramp');
  assert.equal(two.crossings.stats.crossings, 2);
});

test('river: the bridge has one wet run with a clearance', async () => {
  const g = await scene('bridge over a river between banks');
  const { water } = g.crossings;
  assert.equal(water.length, 1);
  assert.ok(water[0].run > 5 && water[0].need >= 2.5);
});

test('roads of different layers alongside, lanes overlapping: held apart; across each other: a crossing only', async () => {
  const { findCrossings } = await import('../services/structures/crossings.js');
  const edge = (id, pts, o) => {
    const x = []; const y = []; const s = []; let acc = 0;
    for (let k = 0; k + 1 < pts.length; k++) {
      const [ax, ay] = pts[k]; const [bx, by] = pts[k + 1]; const L = Math.hypot(bx - ax, by - ay); const n = Math.ceil(L / 4);
      for (let i = k ? 1 : 0; i <= n; i++) { x.push(ax + (bx - ax) * i / n); y.push(ay + (by - ay) * i / n); s.push(acc + L * i / n); }
      acc += L;
    }
    const vertex = new Uint8Array(x.length); vertex[0] = 1; vertex[x.length - 1] = 1;
    return { id, x: Float64Array.from(x), y: Float64Array.from(y), s: Float64Array.from(s), g: new Float64Array(x.length), vertex, length: acc, from: `${id}a`, to: `${id}b`, bridge: true, tunnel: false, highway: 'motorway', ...o };
  };
  const nodes = new Map();
  const alongside = { edges: [edge(0, [[-100, 0], [100, 0]], { layer: 3, half: 5.8 }), edge(1, [[-100, 6], [100, 6]], { layer: 2, half: 3.5, highway: 'motorway_link' })], nodes };
  const a = findCrossings(alongside);
  assert.equal(a.crossings.length, 0);
  assert.ok(a.overlaps.length > 20, `overlap stations: ${a.overlaps.length}`);
  assert.ok(a.overlaps.every((c) => alongside.edges[c.a.edge].layer === 3 && c.upper === 'a' && c.sep > 5));
  const across = { edges: [edge(0, [[-100, 0], [100, 0]], { layer: 3, half: 5.8 }), edge(1, [[0, -100], [0, 100]], { layer: 2, half: 3.5 })], nodes };
  const b = findCrossings(across);
  assert.equal(b.crossings.length, 1);
  assert.equal(b.overlaps.length, 0);
});
