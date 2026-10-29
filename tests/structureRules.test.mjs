import test from 'node:test';
import assert from 'node:assert/strict';
import { STRUCTURE_SCENES, runStructureScene } from './helpers/structureScenes.mjs';

const classes = async (name) => {
  const log = console.log; console.log = () => {};
  try {
    const g = (await runStructureScene(STRUCTURE_SCENES.find((s) => s.name === name))).groups.structureGraph;
    return { g, ...g.classes };
  } finally { console.log = log; }
};
const kindsOn = (g, segments, pred) => new Set(segments.filter((s) => pred(g.edges[s.edge])).map((s) => s.kind));

test('overpass: a deck over the motorway, embankments up to it, the motorway on the ground', async () => {
  const { g, segments } = await classes('overpass on flat ground');
  const bridge = kindsOn(g, segments, (e) => e.bridge);
  assert.ok(bridge.has('deck'));
  const approaches = kindsOn(g, segments, (e) => !e.bridge && e.highway === 'secondary');
  assert.ok(approaches.has('embankment'), 'approaches climb on embankments');
  assert.deepEqual([...kindsOn(g, segments, (e) => e.highway === 'motorway')], ['ground']);
});

test('river: the bridge decks over the water', async () => {
  const { g, segments } = await classes('bridge over a river between banks');
  assert.ok(kindsOn(g, segments, (e) => e.bridge).has('deck'));
});

test('mountain tunnel: bored through the ridge', async () => {
  const { g, segments, stats } = await classes('mountain tunnel through a ridge');
  assert.ok(kindsOn(g, segments, (e) => e.tunnel).has('boredTunnel'));
  assert.equal(stats.openTunnels, 0);
});

test('tunnel tagged on flat ground: cut-and-cover, never bored', async () => {
  const { g, segments } = await classes('tunnel tagged on flat ground');
  const k = kindsOn(g, segments, (e) => e.tunnel);
  assert.ok(k.has('cutAndCover'));
  assert.ok(!k.has('boredTunnel'));
});

test('bridge tagged over nothing: a culvert, not a deck', async () => {
  const { g, segments, stats } = await classes('bridge tagged over nothing (culvert)');
  assert.ok(!kindsOn(g, segments, (e) => e.bridge).has('deck'));
  assert.equal(stats.culverts, 1);
});

test('stack: decks on both levels', async () => {
  const { g, segments } = await classes('three-level stack');
  assert.ok(kindsOn(g, segments, (e) => e.layer === 2).has('deck'));
  assert.ok(kindsOn(g, segments, (e) => e.layer === 1).has('deck'));
});

test('no run shorter than its kind allows (except a whole short edge)', async () => {
  const { MIN_RUN_M } = await import('../services/structures/structureRules.js');
  for (const name of ['overpass on flat ground', 'three-level stack', 'urban cut-and-cover under a street grid']) {
    const { g, segments } = await classes(name);
    for (const s of segments) {
      const whole = s.i0 === 0 && s.i1 === g.edges[s.edge].s.length - 1;
      assert.ok(whole || s.s1 - s.s0 >= MIN_RUN_M[s.kind] - 1e-6, `${name}: ${s.kind} ${(s.s1 - s.s0).toFixed(1)} m`);
    }
  }
});
