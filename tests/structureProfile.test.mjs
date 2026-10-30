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
