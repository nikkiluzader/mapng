// Railways through the structure solver on synthetic scenes (generated
// geometry only: no scene is, or is tuned to, a real place): grade limits per
// kind, clearances over and under a line, level crossings at one height, the
// track built on the solved profile.
import test from 'node:test';
import assert from 'node:assert/strict';

import { sceneTerrain, sceneWay } from './helpers/structureScenes.mjs';
import { generateDecalRoads } from '../services/exportBeamNGLevel.js';
import { buildTrackGeometry, crossingDecals, railwayStats, RAIL_MATERIALS } from '../services/railTrack.js';
import { RAIL_DEPTH_M } from '../services/railways.js';

const SQ = 1000 / 511;
const rail = (id, pts, tags) => ({ ...sceneWay(id, pts, tags), type: 'railway' });
const quiet = (fn) => { const log = console.log; const warn = console.warn; console.log = () => {}; console.warn = () => {}; try { return fn(); } finally { console.log = log; console.warn = warn; } };
const solve = (td) => quiet(() => generateDecalRoads(td, SQ, { structureSolver: 'v2' })).structureGraph;
const railEdges = (sg) => sg.edges.map((e, k) => [e, k]).filter(([e]) => e.rail);
const zAt = (sg, k, x, y) => {
  const e = sg.edges[k]; let best = Infinity; let z = null;
  for (let i = 0; i < e.s.length; i++) { const d = Math.hypot(e.x[i] - x, e.y[i] - y); if (d < best) { best = d; z = sg.profile.z[k][i]; } }
  return { z, d: best };
};
const steepest = (sg, k) => {
  const e = sg.edges[k]; const z = sg.profile.z[k]; let g = 0;
  for (let i = 0; i + 1 < e.s.length; i++) if (e.s[i + 1] - e.s[i] > 1) g = Math.max(g, Math.abs(z[i + 1] - z[i]) / (e.s[i + 1] - e.s[i]));
  return g;
};

test('a main line runs straight over a hollow its grade cannot follow (no sag into it)', () => {
  // flat at 20 m with a 14 m deep, 80 m wide hollow across x = 0
  const td = sceneTerrain((x) => 20 - 14 * Math.exp(-((x / 40) ** 4)), [
    rail(1, [[-450, 0], [450, 0]], { railway: 'rail', usage: 'main' }),
  ]);
  const sg = solve(td);
  const [[e, k]] = railEdges(sg);
  const z = sg.profile.z[k];
  const lo = Math.min(...z.slice(10, -10)); const hi = Math.max(...z.slice(10, -10));
  assert.ok(hi - lo < 1.5, `profile within 1.5 m across the hollow (${lo.toFixed(2)}..${hi.toFixed(2)})`);
  assert.ok(steepest(sg, k) <= 0.031, `grade ${steepest(sg, k)}`);
  // what stands over the hollow: a deck or a fill, never the ground
  const mid = e.s.findIndex((s, i) => Math.abs(e.x[i]) < 2);
  const kind = sg.classes.segments.find((sg2) => sg2.edge === k && sg2.i0 <= mid && sg2.i1 >= mid).kind;
  assert.ok(['deck', 'embankment'].includes(kind), kind);
});

test('rail grade limits: a main line holds 3 % up a 6 % hillside, a tram follows its street, a funicular its slope', () => {
  const slope = (y) => 30 + 0.06 * Math.max(-300, Math.min(300, y));
  const td = sceneTerrain((x, y) => slope(y), [
    rail(1, [[-200, -450], [-200, 450]], { railway: 'rail' }),
    rail(2, [[0, -450], [0, 450]], { railway: 'tram' }),
  ]);
  const sg = solve(td);
  const byKind = Object.fromEntries(railEdges(sg).map(([e, k]) => [e.rail, k]));
  assert.ok(steepest(sg, byKind.rail) <= 0.032, `main line ${steepest(sg, byKind.rail)}`);
  assert.ok(steepest(sg, byKind.tram) > 0.05 && steepest(sg, byKind.tram) <= 0.095, `tram ${steepest(sg, byKind.tram)}`);
  // the main line's cuttings and fills where it can't follow
  const kinds = new Set(sg.classes.segments.filter((s) => s.edge === byKind.rail).map((s) => s.kind));
  assert.ok(kinds.has('cutting') || kinds.has('embankment'), [...kinds].join(','));

  const steep = sceneTerrain((x, y) => 30 + 0.45 * Math.max(-200, Math.min(200, y)), [
    rail(3, [[0, -150], [0, 150]], { railway: 'funicular' }),
  ]);
  const sg2 = solve(steep);
  const [[, kf]] = railEdges(sg2);
  assert.ok(steepest(sg2, kf) > 0.35, `funicular climbs its slope (${steepest(sg2, kf)})`);
});

test('clearances: a rail bridge over a road and a road bridge over a line', () => {
  const flat = () => 10;
  const td = sceneTerrain(flat, [
    // a road under a rail bridge
    sceneWay(1, [[-450, -200], [450, -200]], { highway: 'primary' }),
    rail(2, [[0, -450], [0, -260]], { railway: 'rail' }),
    rail(3, [[0, -260], [0, -140]], { railway: 'rail', bridge: 'yes', layer: '1' }),
    rail(4, [[0, -140], [0, 50]], { railway: 'rail' }),
    // a road bridge over an electrified line
    rail(5, [[-450, 200], [450, 200]], { railway: 'rail', electrified: 'contact_line' }),
    sceneWay(6, [[200, 50], [200, 140]], { highway: 'secondary' }),
    sceneWay(7, [[200, 140], [200, 260]], { highway: 'secondary', bridge: 'yes', layer: '1' }),
    sceneWay(8, [[200, 260], [200, 450]], { highway: 'secondary' }),
  ]);
  const sg = solve(td);
  const edgeOf = (way) => sg.edges.findIndex((e) => String(e.wayId).startsWith(String(way)) && (way === 1 || way >= 6 ? !e.rail : !!e.rail));
  const railOver = zAt(sg, edgeOf(3), 0, -200).z; const roadUnder = zAt(sg, edgeOf(1), 0, -200).z;
  // 5 m of headroom under a rail deck 2.9 m deep from the top of its rail
  assert.ok(railOver - roadUnder >= 7.9 - 0.05, `rail over road: ${(railOver - roadUnder).toFixed(2)} m`);
  const roadOver = zAt(sg, edgeOf(7), 200, 200).z; const lineUnder = zAt(sg, edgeOf(5), 200, 200).z;
  // a contact wire's headroom (6.8 m) under a 1.5 m road deck
  assert.ok(roadOver - lineUnder >= 8.3 - 0.05, `road over rail: ${(roadOver - lineUnder).toFixed(2)} m`);
  const decks = sg.classes.segments.filter((s) => s.kind === 'deck');
  assert.ok(decks.some((s) => sg.edges[s.edge].rail), 'a rail deck');
  assert.ok(decks.some((s) => !sg.edges[s.edge].rail), 'a road deck');
});

test('a level crossing: road and rails at one height, no ballast bed dug across the road, its surface a decal', () => {
  // gently rolling ground; the road and the line share a node at (0, 0)
  const td = sceneTerrain((x, y) => 15 + 1.5 * Math.sin(x / 90) + Math.cos(y / 120), [
    sceneWay(1, [[0, -450], [0, 0], [0, 450]], { highway: 'secondary' }),
    rail(2, [[-450, 0], [0, 0], [450, 0]], { railway: 'rail', tracks: '2' }),
  ]);
  const sg = solve(td);
  assert.equal(sg.railCrossings.length, 1);
  const node = sg.nodes.get(sg.railCrossings[0].node);
  const zs = node.edges.map(({ edge, end }) => sg.profile.z[edge][end === 0 ? 0 : sg.edges[edge].s.length - 1]);
  assert.ok(Math.max(...zs) - Math.min(...zs) < 0.01, `one height at the crossing: ${zs.map((v) => v.toFixed(3)).join(', ')}`);
  for (const [e] of railEdges(sg)) {
    const end = e.from === node.id ? 0 : e.s.length - 1;
    assert.equal(e.drop[end], 0, 'the formation at the rails\' top in the road');
    assert.equal(e.crossingAt[end], 1);
    const far = end === 0 ? e.s.length - 1 : 0;
    assert.ok(Math.abs(e.drop[far] - RAIL_DEPTH_M) < 1e-6, 'the track\'s depth away from it');
  }
  const decals = crossingDecals(sg, { tagsOf: () => ({ tracks: '2' }) });
  assert.equal(decals.length, 4, 'a decal per track either side of the node');
  // no sleeper inside the crossing
  const { tiles } = buildTrackGeometry(sg, { tagsOf: () => ({ tracks: '2' }) });
  const half = sg.railCrossings[0].half;
  for (const t of tiles) {
    const p = t.parts[RAIL_MATERIALS.concrete]?.pos || [];
    for (let q = 0; q < p.length; q += 3) assert.ok(Math.abs(p[q]) > half + 0.5 - 0.15, `sleeper at x ${p[q].toFixed(2)} inside the road`);
  }
  const stats = railwayStats(sg, sg.railSegments);
  assert.equal(stats.roadCrossings, 1);
  assert.equal(stats.byKind.rail.lines, 1);
});

test('track geometry: rails at the top of the rail, sleepers and ballast under them, a monorail a beam', () => {
  const td = sceneTerrain(() => 10, [
    rail(1, [[-300, -100], [300, -100]], { railway: 'rail' }),
    rail(2, [[-300, 100], [300, 100]], { railway: 'monorail', bridge: 'yes', layer: '1' }),
  ]);
  const sg = solve(td);
  const { tiles, stats } = buildTrackGeometry(sg, { tagsOf: (e) => sg.railSegments[e.seg].tags });
  assert.ok(stats.trackKm > 1.1 && stats.trackKm < 1.3, `${stats.trackKm} km`);
  // ~one sleeper per 0.6 m of the main line
  assert.ok(Math.abs(stats.sleepers - 600 / 0.6) < 20, `${stats.sleepers} sleepers`);
  const zr = sg.profile.z[sg.edges.findIndex((e) => e.rail === 'rail')][50];
  let railTop = -Infinity; let ballastLow = Infinity; let beam = 0;
  for (const t of tiles) {
    const steel = t.parts[RAIL_MATERIALS.steel]?.pos || [];
    for (let q = 2; q < steel.length; q += 3) railTop = Math.max(railTop, steel[q]);
    const b = t.parts[RAIL_MATERIALS.ballast]?.pos || [];
    for (let q = 2; q < b.length; q += 3) ballastLow = Math.min(ballastLow, b[q]);
    beam += (t.parts[RAIL_MATERIALS.beam]?.pos || []).length;
    assert.ok(t.collision.pos.length > 0, 'the tile collides');
    for (const p of Object.values(t.parts)) assert.ok(p.pos.every(Number.isFinite) && p.uv.length / 2 === p.pos.length / 3);
  }
  assert.ok(Math.abs(railTop - zr) < 0.05, `rails on the profile (${railTop} vs ${zr})`);
  assert.ok(ballastLow < zr - RAIL_DEPTH_M, 'ballast down into the formation');
  assert.ok(beam > 0, 'the monorail\'s beam');
});

test('a tram down the middle of a street is drawn on it, not built as a line of its own', () => {
  const td = sceneTerrain(() => 10, [
    sceneWay(1, [[-450, 0], [450, 0]], { highway: 'tertiary' }),
    rail(2, [[-440, 0.5], [440, 0.5]], { railway: 'tram' }),
    rail(3, [[-440, 200], [440, 200]], { railway: 'tram' }),
  ]);
  const sg = solve(td);
  const ways = new Set(railEdges(sg).map(([e]) => String(e.wayId)));
  assert.ok(ways.has('3'), 'the tram on its own right of way is a line');
  assert.ok(!ways.has('2'), 'the street tram is not');
});
