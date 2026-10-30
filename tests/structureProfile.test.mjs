import test from 'node:test';
import assert from 'node:assert/strict';
import { gradeLimit } from '../services/structures/profileSolve.js';
import { STRUCTURE_SCENES, runStructureScene } from './helpers/structureScenes.mjs';

const solved = async (name) => {
  const log = console.log; console.log = () => {};
  try { return (await runStructureScene(STRUCTURE_SCENES.find((s) => s.name === name))).groups.structureGraph; } finally { console.log = log; }
};

// scenes where every constraint can be met: the solve meets them all
for (const name of [
  'overpass on flat ground', 'three-level stack', 'bridge over a river between banks',
  'tunnel tagged on flat ground', 'mountain tunnel through a ridge', 'deck running off the map edge',
  'ramp joint between decks of different layers', 'urban cut-and-cover under a street grid',
]) {
  test(`profile solve meets every constraint: ${name}`, async () => {
    const g = await solved(name);
    const { residual } = g.profile;
    assert.ok(residual.joint < 0.02, `joints ${residual.joint}`);
    assert.ok(residual.crossing < 0.05, `crossings ${residual.crossing}`);
    assert.ok(residual.grade < 0.005, `grade ${residual.grade}`);
    assert.ok(residual.water < 0.05, `water ${residual.water}`);
    assert.ok(residual.cover < 0.05, `cover ${residual.cover}`);
    assert.equal(g.previewChecks.joints.steps, 0, 'no steps');
    assert.equal(g.previewChecks.crossings.short, 0, 'no short crossings');
  });
}

test('profile: ground roads stay on the ground away from structures', async () => {
  const g = await solved('overpass on flat ground');
  const k = g.edges.findIndex((e) => e.highway === 'motorway');
  const z = g.profile.z[k]; const e = g.edges[k];
  for (let i = 0; i < z.length; i++) if (Math.abs(e.y[i]) > 120) assert.ok(Math.abs(z[i] - e.g[i]) < 0.05, `motorway off the ground at y ${e.y[i].toFixed(0)}`);
  assert.equal(gradeLimit('motorway'), 0.05);
});

test('profile: a bridge over a ship channel never lifts the streets beyond it', async () => {
  const g = await solved('short bridge over a ship channel in a town');
  const run = g.crossings.water[0];
  assert.ok(run, 'a water run');
  assert.ok(run.channel && run.wanted >= 50, 'a ship channel was found');
  assert.ok(run.need < 10, `clearance capped by the bridge's own length (${run.need})`);
  g.edges.forEach((e, k) => {
    if (e.bridge) return;
    const z = g.profile.z[k];
    for (let i = 0; i < z.length; i++) {
      if (Math.abs(e.x[i]) < 190) continue;
      assert.ok(Math.abs(z[i] - e.g[i]) < 0.3, `${e.highway} lifted ${(z[i] - e.g[i]).toFixed(1)} m at x ${e.x[i].toFixed(0)}`);
    }
  });
});

test('profile: an untagged track goes down through a gully, never a tall deck over it', async () => {
  const g = await solved('track down through a steep gully');
  const k = g.edges.findIndex((e) => e.highway === 'track');
  const z = g.profile.z[k]; const e = g.edges[k];
  let worst = 0;
  for (let i = 0; i < z.length; i++) worst = Math.max(worst, Math.abs(z[i] - e.g[i]));
  assert.ok(worst <= 6.05, `track ${worst.toFixed(1)} m off its ground`);
  assert.equal(g.classes.segments.filter((s) => s.kind === 'deck').length, 0, 'no deck');
});

test('profile: a hillside stream bridge never lifts the roads down the hill', async () => {
  const g = await solved('hillside road with a stream bridge');
  g.edges.forEach((e, k) => {
    if (e.bridge) return;
    const z = g.profile.z[k];
    for (let i = 0; i < z.length; i++) {
      if (Math.abs(e.y[i] - 110) < 150) continue;   // (its approach ramps)
      assert.ok(Math.abs(z[i] - e.g[i]) < 0.5, `${e.highway} ${(z[i] - e.g[i]).toFixed(1)} m off its ground at y ${e.y[i].toFixed(0)}`);
    }
  });
});

test('profile: a bridge with a drawbridge span stays low over the channel', async () => {
  const g = await solved('drawbridge over a ship channel');
  let worst = 0;
  g.edges.forEach((e, k) => { if (e.bridge) for (let i = 0; i < e.s.length; i++) worst = Math.max(worst, g.profile.z[k][i] - e.g[i]); });
  assert.ok(worst < 6 + 2.2 + 1.5, `deck ${worst.toFixed(1)} m over the water`);
});

test('profile: a road under the deck it joins never lifts the deck round after round', async () => {
  const g = await solved('service road under the deck it joins');
  const k = g.edges.findIndex((e) => e.bridge);
  const top = Math.max(...g.profile.z[k].map((z, i) => z - g.edges[k].g[i]));
  assert.ok(top < 6.5 + 3 + 1, `deck ${top.toFixed(1)} m over the ground`);
});

test('profile: twin carriageways over a strait both take the named structure clearance', async () => {
  const g = await solved('twin suspension bridge over a strait');
  const tops = g.edges.map((e, k) => Math.max(...g.profile.z[k].map((z, i) => z - e.g[i])));
  assert.equal(g.crossings.water.length, 2, 'the strait is water under both');
  for (const t of tops) assert.ok(t > 15, `deck only ${t.toFixed(1)} m over the strait`);
  assert.ok(Math.abs(tops[0] - tops[1]) < 1, `carriageways ${tops.map((t) => t.toFixed(1)).join(' / ')}`);
});
