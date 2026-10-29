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
