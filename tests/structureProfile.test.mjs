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

test('a lift up a tunnel approach gives way to the pinned portal: steeper, not a wall', async () => {
  const { solveProfiles } = await import('../services/structures/profileSolve.js');
  // approach (motorway) from a junction at x = -110 over another tunnel
  // (needs the road 6.3 m over that tube's -0.1 m) down to a portal at x = 0
  // pinned at -4.1; ground falls 6.2 -> 0.7 along it
  const n = 31; const x = []; const s = []; const g = [];
  for (let i = 0; i < n; i++) { x.push(-110 + i * 110 / (n - 1)); s.push(i * 110 / (n - 1)); g.push(6.2 - 5.5 * i / (n - 1)); }
  const approach = { id: 0, x: Float64Array.from(x), y: new Float64Array(n), s: Float64Array.from(s), g: Float64Array.from(g), from: 'J', to: 'P', highway: 'motorway', layer: 0, half: 5, bridge: false, tunnel: false };
  const tubeX = Float64Array.from({ length: 11 }, (_, i) => i * 10);
  const tube = { id: 1, x: tubeX, y: new Float64Array(11), s: tubeX.slice(), g: new Float64Array(11).fill(8), from: 'P', to: 'Q', highway: 'motorway', layer: -1, half: 5, bridge: false, tunnel: true, external: true };
  const crossX = Float64Array.from({ length: 11 }, (_, i) => -20 + i * 4);
  const other = { id: 2, x: new Float64Array(11).fill(-110), y: crossX, s: Float64Array.from({ length: 11 }, (_, i) => i * 4), g: new Float64Array(11).fill(6.2), from: 'U', to: 'V', highway: 'motorway', layer: -1, half: 5, bridge: false, tunnel: true, external: true };
  const nodes = new Map([
    ['J', { edges: [{ edge: 0, end: 0 }] }], ['P', { edges: [{ edge: 0, end: 1 }, { edge: 1, end: 0 }] }],
    ['Q', { edges: [{ edge: 1, end: 1 }] }], ['U', { edges: [{ edge: 2, end: 0 }] }], ['V', { edges: [{ edge: 2, end: 1 }] }],
  ]);
  const pins = [];
  for (let i = 0; i < 11; i++) pins.push([1, i, -4.1 + i * 0.05], [2, i, -0.1]);
  const graph = {
    edges: [approach, tube, other], nodes, pins, tunnelsPinned: true,
    crossings: { crossings: [{ a: { edge: 0, i: 0, f: 0, s: 0 }, b: { edge: 2, i: 5, f: 0, s: 20 }, upper: 'a', rule: 'layer', sep: 6.3 }], water: [] },
  };
  const { z } = solveProfiles(graph);
  assert.ok(Math.abs(z[0][n - 1] + 4.1) < 0.1, `meets the portal: ${z[0][n - 1].toFixed(2)}`);
  assert.ok(Math.abs(z[1][0] + 4.1) < 0.1, 'the pinned tube stays');
  assert.ok(z[0][0] > 6, `over the other tube at the junction: ${z[0][0].toFixed(2)}`);
  let steep = 0; for (let i = 1; i < n; i++) steep = Math.max(steep, Math.abs(z[0][i] - z[0][i - 1]) / (s[i] - s[i - 1]));
  assert.ok(steep < 0.15, `drivable all the way: ${(steep * 100).toFixed(1)} %`);
});

test('decks forking at a node stay one surface while their lanes overlap', async () => {
  const { solveProfiles } = await import('../services/structures/profileSolve.js');
  // a motorway deck and a ramp deck leave node F side by side, parting
  // slowly; the ramp's far end is pinned 4 m lower than the motorway's
  const line = (dy, n, step = 4) => {
    const x = []; const y = []; const s = [];
    for (let i = 0; i < n; i++) { x.push(i * step); y.push(i * step * dy); s.push(Math.hypot(i * step, i * step * dy)); }
    return { x: Float64Array.from(x), y: Float64Array.from(y), s: Float64Array.from(s), g: new Float64Array(n).fill(0) };
  };
  const main = { ...line(0, 41), from: 'F', to: 'M', highway: 'motorway', layer: 1, half: 5, bridge: true, tunnel: false };
  const ramp = { ...line(0.12, 41), from: 'F', to: 'R', highway: 'motorway_link', layer: 1, half: 4, bridge: true, tunnel: false };
  const nodes = new Map([['F', { edges: [{ edge: 0, end: 0 }, { edge: 1, end: 0 }] }], ['M', { edges: [{ edge: 0, end: 1 }] }], ['R', { edges: [{ edge: 1, end: 1 }] }]]);
  const pins = [[0, 0, 12], [0, 40, 16], [1, 40, 8]];
  const { z } = solveProfiles({ edges: [main, ramp], nodes, pins, crossings: { crossings: [], water: [] } });
  // overlapping while 0.12 * x < 0.9 * 9: about the first 65 m
  for (let i = 1; i <= 14; i++) {
    let best = 0; let bd = Infinity;
    for (let k = 0; k < 41; k++) { const d = Math.hypot(ramp.x[k] - main.x[i], ramp.y[k] - main.y[i]); if (d < bd) { bd = d; best = k; } }
    assert.ok(Math.abs(z[0][i] - z[1][best]) <= 0.03 * bd + 0.05, `step ${(z[0][i] - z[1][best]).toFixed(2)} m at ${main.x[i]} m`);
  }
});
