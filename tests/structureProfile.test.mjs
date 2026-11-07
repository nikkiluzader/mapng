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

test('profile: a viaduct cut by the map edge stays up to the edge', async () => {
  const g = await solved('viaduct cut by the map edge at both ends');
  const k = g.edges.findIndex((e) => e.highway === 'trunk');
  const z = g.profile.z[k]; const e = g.edges[k];
  const over = (i) => z[i] - e.g[i];
  assert.ok(over(0) > 5 && over(z.length - 1) > 5, `ends ${over(0).toFixed(1)} / ${over(z.length - 1).toFixed(1)} m over the ground`);
  for (let i = 0; i < z.length; i++) assert.ok(over(i) > 5, `deck ${over(i).toFixed(1)} m over the ground at x ${e.x[i].toFixed(0)}`);
});

test('profile: a street stacked over a covered lower road clears it along the overlap', async () => {
  const g = await solved('street stacked over a covered lower road');
  const lo = g.edges.findIndex((e) => e.highway === 'trunk');
  const zl = g.profile.z[lo];
  const lowAt = (x) => { const e = g.edges[lo]; let b = 0; for (let i = 0; i < e.x.length; i++) if (Math.abs(e.x[i] - x) < Math.abs(e.x[b] - x)) b = i; return zl[b]; };
  g.edges.forEach((e, k) => {
    if (e.highway !== 'secondary') return;
    for (let i = 0; i < e.s.length; i++) {
      if (Math.abs(e.x[i]) > 100) continue;
      const gap = g.profile.z[k][i] - lowAt(e.x[i]);
      assert.ok(gap > 5.5, `upper street ${gap.toFixed(1)} m over the lower road at x ${e.x[i].toFixed(0)}`);
    }
  });
});

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
  // the ramp follows the main deck, never the main deck the ramp: the main
  // deck stays one straight grade, the ramp within its class limit after
  // parting (split both ways, both kinked where the lanes part)
  const worst = (k) => { let w = 0; for (let i = 0; i + 1 < 41; i++) { const e = k ? ramp : main; w = Math.max(w, Math.abs(z[k][i + 1] - z[k][i]) / (e.s[i + 1] - e.s[i])); } return w; };
  assert.ok(worst(0) <= 0.03, `main deck grade ${(worst(0) * 100).toFixed(1)}%`);
  assert.ok(worst(1) <= 0.075, `ramp grade ${(worst(1) * 100).toFixed(1)}%`);
});

test('profile: a tunnel road the tunnel builder left out stays on its ground', async () => {
  const { solveProfiles } = await import('../services/structures/profileSolve.js');
  // a tunnel-tagged road over a 10 m hill, not built (today's tunnels
  // pinned, this one not among them): a road on the ground, not a straight
  // line under the hill with no tube round it
  const n = 61; const x = []; const g = [];
  for (let i = 0; i < n; i++) { x.push(i * 4); g.push(10 * Math.exp(-(((i - 30) / 25) ** 2))); }
  const e = { x: Float64Array.from(x), y: new Float64Array(n), s: Float64Array.from(x), g: Float64Array.from(g), from: 'A', to: 'B', highway: 'secondary', layer: -1, half: 4, bridge: false, tunnel: true };
  const nodes = new Map([['A', { edges: [{ edge: 0, end: 0 }] }], ['B', { edges: [{ edge: 0, end: 1 }] }]]);
  const { z } = solveProfiles({ edges: [e], nodes, pins: [], tunnelsPinned: true, crossings: { crossings: [], water: [] } });
  let worst = 0;
  for (let i = 0; i < n; i++) worst = Math.max(worst, Math.abs(z[0][i] - g[i]));
  assert.ok(worst < 1, `${worst.toFixed(1)} m off its ground`);
});

test('profile: a deck mapped as two ways meeting mid-span is one line from rim to rim', async () => {
  const { solveProfiles } = await import('../services/structures/profileSolve.js');
  // a canyon 100 m deep and 240 m wide; the bridge is two ways joined over
  // the river (the second drawn the other way round), rims at 100 m
  const half = (dir, from, to) => {
    const n = 31; const x = []; const g = [];
    for (let i = 0; i < n; i++) { const xx = dir > 0 ? -120 + i * 4 : 120 - i * 4; x.push(xx); g.push(Math.abs(xx) > 110 ? 100 : 0); }
    return { x: Float64Array.from(x), y: new Float64Array(n), s: Float64Array.from(x.map((_, i) => i * 4)), g: Float64Array.from(g), from, to, highway: 'motorway', layer: 1, half: 6, bridge: true, tunnel: false };
  };
  const west = half(1, 'W', 'M'); const east = half(-1, 'E', 'M');
  const road = (x0, from, to) => { const n = 11; const x = Array.from({ length: n }, (_, i) => x0 + (x0 < 0 ? -1 : 1) * i * 4); return { x: Float64Array.from(x), y: new Float64Array(n), s: Float64Array.from(x.map((_, i) => i * 4)), g: new Float64Array(n).fill(100), from, to, highway: 'motorway', layer: 0, half: 6, bridge: false, tunnel: false }; };
  const wr = road(-120, 'W', 'w'); const er = road(120, 'E', 'e');
  const nodes = new Map([
    ['W', { edges: [{ edge: 0, end: 0 }, { edge: 2, end: 0 }] }], ['E', { edges: [{ edge: 1, end: 0 }, { edge: 3, end: 0 }] }],
    ['M', { edges: [{ edge: 0, end: 1 }, { edge: 1, end: 1 }] }], ['w', { edges: [{ edge: 2, end: 1 }] }], ['e', { edges: [{ edge: 3, end: 1 }] }],
  ]);
  const water = [{ edge: 0, i0: 3, i1: 30, need: 10 }, { edge: 1, i0: 3, i1: 30, need: 10 }];
  const { z } = solveProfiles({ edges: [west, east, wr, er], nodes, pins: [], crossings: { crossings: [], water } });
  const low = Math.min(...z[0], ...z[1]);
  assert.ok(low > 98, `deck sags to ${low.toFixed(1)} m (rims at 100 m)`);
});

test('profile: two decks of one layer crossing: the higher one is over the other by the clearance', async () => {
  const { solveProfiles } = await import('../services/structures/profileSolve.js');
  const line = (x0, y0, dx, dy, n, opts) => {
    const x = []; const y = []; const s = [];
    for (let i = 0; i < n; i++) { x.push(x0 + i * dx); y.push(y0 + i * dy); s.push(i * Math.hypot(dx, dy)); }
    return { x: Float64Array.from(x), y: Float64Array.from(y), s: Float64Array.from(s), g: new Float64Array(n), layer: 2, half: 4, bridge: true, tunnel: false, highway: 'motorway_link', ...opts };
  };
  // A climbs to a deck pinned 16 m up at its far end; B, low, crosses it mid-way
  const A = line(-200, 0, 4, 0, 101, { from: 'A0', to: 'A1' });
  const B = line(0, -100, 0, 4, 51, { from: 'B0', to: 'B1' });
  const nodes = new Map([['A0', { edges: [{ edge: 0, end: 0 }] }], ['A1', { edges: [{ edge: 0, end: 1 }] }], ['B0', { edges: [{ edge: 1, end: 0 }] }], ['B1', { edges: [{ edge: 1, end: 1 }] }]]);
  const pins = [[0, 100, 16], [0, 0, 0], [1, 0, 1], [1, 50, 1]];
  const crossings = [{ a: { edge: 1, i: 25, f: 0, s: 100 }, b: { edge: 0, i: 50, f: 0, s: 200 }, x: 0, y: 0, upper: 'a', rule: 'stacked', dynamic: true, sep: 6.5 }];
  const { z } = solveProfiles({ edges: [A, B], nodes, pins, crossings: { crossings, water: [] } });
  const gap = z[0][50] - z[1][25];
  assert.ok(gap >= 6.4, `A over B by ${gap.toFixed(2)} m`);
});

test('profile: a viaduct off the map at both ends with nothing under it holding it is level, not along the slope', async () => {
  const { solveProfiles } = await import('../services/structures/profileSolve.js');
  // ground falling 60 m across 400 m under a deck leaving the map both ways
  const n = 101; const x = []; const g = [];
  for (let i = 0; i < n; i++) { x.push(-200 + i * 4); g.push(100 - 0.15 * i * 4 * (i < 50 ? 1 : 0.0) - (i >= 50 ? 30 : 0)); }
  const e = { x: Float64Array.from(x), y: new Float64Array(n), s: Float64Array.from(x.map((_, i) => i * 4)), g: Float64Array.from(g), from: 'A', to: 'B', highway: 'motorway', layer: 1, half: 6, bridge: true, tunnel: false };
  const nodes = new Map([['A', { kind: 'edgeOfMap', edges: [{ edge: 0, end: 0 }] }], ['B', { kind: 'edgeOfMap', edges: [{ edge: 0, end: 1 }] }]]);
  const { z } = solveProfiles({ edges: [e], nodes, pins: [], crossings: { crossings: [], water: [] } });
  const top = Math.max(...g);
  assert.ok(Math.abs(z[0][0] - z[0][n - 1]) < 0.5, `ends ${z[0][0].toFixed(1)} / ${z[0][n - 1].toFixed(1)}`);
  assert.ok(Math.min(...z[0]) >= top - 0.5, 'never under the highest ground along it');
});

test('profile: where a deck meets the road the grade turns over a vertical curve, not in a corner', async () => {
  const { solveProfiles } = await import('../services/structures/profileSolve.js');
  // the road on the ground rises 4 % away from the joint J; the deck rises
  // 6 % from J the other way to a pin: a 10 % sag, felt as a jolt if it is a corner
  const n = 41;
  const road = { x: Float64Array.from({ length: n }, (_, i) => -i * 4), y: new Float64Array(n), s: Float64Array.from({ length: n }, (_, i) => i * 4), g: Float64Array.from({ length: n }, (_, i) => 10 + 0.04 * i * 4), from: 'J', to: 'R', highway: 'secondary', layer: 0, half: 4, bridge: false, tunnel: false };
  const deck = { x: Float64Array.from({ length: n }, (_, i) => i * 4), y: new Float64Array(n), s: Float64Array.from({ length: n }, (_, i) => i * 4), g: new Float64Array(n).fill(0), from: 'J', to: 'D', highway: 'secondary', layer: 1, half: 4, bridge: true, tunnel: false };
  const nodes = new Map([['J', { edges: [{ edge: 0, end: 0 }, { edge: 1, end: 0 }] }], ['R', { edges: [{ edge: 0, end: 1 }] }], ['D', { edges: [{ edge: 1, end: 1 }] }]]);
  const { z } = solveProfiles({ edges: [road, deck], nodes, pins: [[1, 40, 10 + 0.06 * 160]], crossings: { crossings: [], water: [] } });
  // the profile along road (reversed) then deck: grades per 4 m step, and their changes
  const prof = [...Array.from(z[0]).reverse(), ...Array.from(z[1]).slice(1)];
  let worst = 0;
  for (let i = 1; i + 1 < prof.length; i++) worst = Math.max(worst, Math.abs((prof[i + 1] - prof[i]) - (prof[i] - prof[i - 1])) / 4);
  assert.ok(worst <= 0.03, `grade turns ${(worst * 100).toFixed(1)} % in one 4 m step`);
});

test('profile: a deck ending at a junction curves into the road going on, the junction kept where it is', async () => {
  const { solveProfiles } = await import('../services/structures/profileSolve.js');
  const n = 41;
  const mk = (dx, dy, g, opts) => ({ x: Float64Array.from({ length: n }, (_, i) => i * 4 * dx), y: Float64Array.from({ length: n }, (_, i) => i * 4 * dy), s: Float64Array.from({ length: n }, (_, i) => i * 4), g: Float64Array.from({ length: n }, (_, i) => g(i * 4)), layer: 0, half: 4, bridge: false, tunnel: false, highway: 'secondary', ...opts });
  const road = mk(-1, 0, (d) => 10 + 0.04 * d, { from: 'J', to: 'R' });
  const deck = mk(1, 0, () => 0, { from: 'J', to: 'D', bridge: true, layer: 1 });
  const sideRoad = mk(0, 1, () => 10, { from: 'J', to: 'S' });
  const nodes = new Map([['J', { edges: [{ edge: 0, end: 0 }, { edge: 1, end: 0 }, { edge: 2, end: 0 }] }], ['R', { edges: [{ edge: 0, end: 1 }] }], ['D', { edges: [{ edge: 1, end: 1 }] }], ['S', { edges: [{ edge: 2, end: 1 }] }]]);
  const { z } = solveProfiles({ edges: [road, deck, sideRoad], nodes, pins: [[1, 40, 10 + 0.06 * 160]], crossings: { crossings: [], water: [] } });
  const prof = [...Array.from(z[0]).reverse(), ...Array.from(z[1]).slice(1)];
  let worst = 0;
  for (let i = 1; i + 1 < prof.length; i++) worst = Math.max(worst, Math.abs((prof[i + 1] - prof[i]) - (prof[i] - prof[i - 1])) / 4);
  assert.ok(worst <= 0.035, `grade turns ${(worst * 100).toFixed(1)} % in one 4 m step`);
  assert.ok(Math.abs(z[0][0] - z[2][0]) < 0.01 && Math.abs(z[1][0] - z[2][0]) < 0.01, 'the three roads still meet at one height');
});

test('profile: a bridge over a river with an island keeps its clearance over the water, not over the island', async () => {
  const { solveProfiles } = await import('../services/structures/profileSolve.js');
  // banks at 10 m, water at 0, an island 9 m high mid-river; clearance 7 m
  const n = 61;
  const g = Array.from({ length: n }, (_, i) => (i < 5 || i > 55 ? 10 : i >= 27 && i <= 33 ? 9 : 0));
  const deck = { x: Float64Array.from({ length: n }, (_, i) => i * 4), y: new Float64Array(n), s: Float64Array.from({ length: n }, (_, i) => i * 4), g: Float64Array.from(g), from: 'A', to: 'B', highway: 'secondary', layer: 1, half: 4, bridge: true, tunnel: false };
  const nodes = new Map([['A', { edges: [{ edge: 0, end: 0 }] }], ['B', { edges: [{ edge: 0, end: 1 }] }]]);
  const water = [{ edge: 0, i0: 5, i1: 55, need: 7 }];
  const { z } = solveProfiles({ edges: [deck], nodes, pins: [[0, 0, 10], [0, 60, 10]], crossings: { crossings: [], water } });
  const top = Math.max(...z[0]);
  assert.ok(top < 9 + 7, `deck ${top.toFixed(1)} m: its water clearance stood on the island`);
  for (let i = 5; i <= 55; i++) if (g[i] === 0) assert.ok(z[0][i] >= 7 - 0.05, `under its clearance over the water at ${i * 4} m`);
});

test('profile: a short bridge over a stream stays on its road line, no clearance hump', async () => {
  const { solveProfiles } = await import('../services/structures/profileSolve.js');
  // a road at 100 m crossing a 1 m deep ditch on a 16 m bridge
  const n = 9;
  const g = [100, 100, 99.4, 99.0, 99.0, 99.0, 99.4, 100, 100];
  const deck = { x: Float64Array.from({ length: n }, (_, i) => i * 2), y: new Float64Array(n), s: Float64Array.from({ length: n }, (_, i) => i * 2), g: Float64Array.from(g), from: 'A', to: 'B', highway: 'track', layer: 1, half: 2, bridge: true, tunnel: false };
  const nodes = new Map([['A', { edges: [{ edge: 0, end: 0 }] }], ['B', { edges: [{ edge: 0, end: 1 }] }]]);
  const minor = { edge: 0, i0: 2, i1: 6, need: 2.5, minor: true };
  const { z } = solveProfiles({ edges: [deck], nodes, pins: [[0, 0, 100], [0, 8, 100]], crossings: { crossings: [], water: [minor] } });
  assert.ok(Math.max(...z[0]) <= 100.31, `stream bridge humped to ${Math.max(...z[0]).toFixed(2)} m`);
  // the same run over a river keeps its clearance
  const { z: zr } = solveProfiles({ edges: [deck], nodes, pins: [[0, 0, 100], [0, 8, 100]], crossings: { crossings: [], water: [{ ...minor, minor: false }] } });
  assert.ok(Math.max(...zr[0]) > 102, 'a river run lost its clearance');
});
