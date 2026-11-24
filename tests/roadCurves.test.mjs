import test from 'node:test';
import assert from 'node:assert/strict';

import { roundRoadCorners } from '../services/roadCurves.js';
import { makeRoadNodeKey } from '../services/roadNetwork.js';

// Local metres ↔ lat/lng around (45, 8).
const M_LAT = 111320;
const M_LNG = 111320 * Math.cos((45 * Math.PI) / 180);
const ll = (x, y) => ({ lat: 45 + y / M_LAT, lng: 8 + x / M_LNG });
const xy = (p) => [(p.lng - 8) * M_LNG, (p.lat - 45) * M_LAT];
const road = (id, pts, highway = 'residential') => ({ id, type: 'road', tags: { highway }, geometry: pts.map(([x, y]) => ll(x, y)) });

function maxTurnDeg(geometry) {
  const P = geometry.map(xy);
  let max = 0;
  for (let i = 1; i + 1 < P.length; i++) {
    const a = [P[i][0] - P[i - 1][0], P[i][1] - P[i - 1][1]];
    const b = [P[i + 1][0] - P[i][0], P[i + 1][1] - P[i][1]];
    const c = (a[0] * b[0] + a[1] * b[1]) / (Math.hypot(...a) * Math.hypot(...b));
    max = Math.max(max, (Math.acos(Math.max(-1, Math.min(1, c))) * 180) / Math.PI);
  }
  return max;
}

test('a single-vertex 90° bend becomes a tangent arc; ends stay put', () => {
  const r = road('r', [[0, 0], [100, 0], [100, 100]]);
  const { features, stats } = roundRoadCorners([r]);
  const g = features[0].geometry;
  assert.equal(stats.roundedVertices, 1);
  assert.deepEqual(g[0], r.geometry[0]);
  assert.deepEqual(g[g.length - 1], r.geometry[2]);
  assert.ok(maxTurnDeg(g) <= 6, `max turn ${maxTurnDeg(g)}`);
  // A sharp mapped corner stays tight: the arc's middle passes 3 m inside it.
  const mid = xy(g[g.length >> 1]);
  assert.ok(Math.abs(Math.hypot(mid[0] - 100, mid[1]) - 3) < 0.2, `cut ${Math.hypot(mid[0] - 100, mid[1])}`);
});

test('a gentle bend on a sparsely mapped road becomes a long sweeping curve', () => {
  const r = road('r', [[0, 0], [200, 0], [400, 60]], 'tertiary');
  const g = roundRoadCorners([r]).features[0].geometry.map(xy);
  const curved = g.filter(([x, y]) => y > 0.01 && x < 200);
  // Tertiary radius 200 m over a ~17° turn: the curve starts ~30 m before the vertex.
  assert.ok(curved.length > 0 && Math.min(...curved.map(([x]) => x)) < 190, 'curve starts well before the vertex');
});

test('short segments shrink the radius so neighbouring arcs never overlap', () => {
  const pts = [[0, 0], [10, 0], [14, 3], [16, 8], [16, 30]];
  const g = roundRoadCorners([road('r', pts)]).features[0].geometry;
  assert.ok(maxTurnDeg(g) < 30, `max turn ${maxTurnDeg(g)}`);
  // Arcs stay inside their half-segments: every point within 2 m of the mapped line.
  const dist = ([x, y]) => Math.min(...pts.slice(1).map((b, i) => {
    const a = pts[i]; const dx = b[0] - a[0]; const dy = b[1] - a[1];
    const t = Math.max(0, Math.min(1, ((x - a[0]) * dx + (y - a[1]) * dy) / (dx * dx + dy * dy)));
    return Math.hypot(x - a[0] - t * dx, y - a[1] - t * dy);
  }));
  for (const p of g) assert.ok(dist(xy(p)) < 2, `point ${xy(p)} strays ${dist(xy(p))}`);
});

// (since 2026-11-24 a node one line passes through and others only end at is carried to the curve: pinned, the curve
// through it swung out and back with all its turning near the node)
test('a road vertex another road ends at stays exactly, and the road still bends smoothly through it', () => {
  const r = road('r', [[0, 0], [100, 0], [100, 100]]);
  const drive = { id: 'd', type: 'road', tags: { highway: 'service' }, geometry: [r.geometry[1], ll(140, -40)] };
  const { features } = roundRoadCorners([r, drive]);
  const g = features[0].geometry;
  assert.ok(g.some((p) => makeRoadNodeKey(p) === makeRoadNodeKey(r.geometry[1])), 'shared vertex kept');
  assert.ok(maxTurnDeg(g) < 30, `max turn ${maxTurnDeg(g)}`);
  assert.deepEqual(features[1].geometry[0], r.geometry[1], 'driveway still attached');
});

test('a path ending at another path\'s bend follows the node onto the rounded curve (at most 0.75 m)', () => {
  const p = road('p', [[0, 0], [40, 0], [40, 40]], 'footway');
  const q = { id: 'q', type: 'road', tags: { highway: 'footway' }, geometry: [p.geometry[1], ll(70, -30)] };
  const { features, stats } = roundRoadCorners([p, q]);
  const g = features[0].geometry;
  assert.ok(maxTurnDeg(g) <= 6, `max turn ${maxTurnDeg(g)}`);
  const start = features[1].geometry[0];
  assert.ok(g.some((pt) => makeRoadNodeKey(pt) === makeRoadNodeKey(start)), 'the joining path still meets it');
  const moved = Math.hypot(...xy(start).map((v, i) => v - [40, 0][i]));
  assert.ok(moved > 0.3 && moved <= 0.7501, `node moved ${moved} m`);
  assert.equal(stats.carriedNodes, 1);
});

test('a node two lines pass through stays exactly; so does a bridge\'s end', () => {
  const a = road('a', [[0, 0], [100, 0], [100, 100]]);
  const b = road('b', [[50, -50], [100, 0], [150, 30]], 'footway');
  const { features } = roundRoadCorners([a, b]);
  for (const f of features) assert.ok(f.geometry.some((p) => makeRoadNodeKey(p) === makeRoadNodeKey(a.geometry[1])), `${f.id} keeps the crossing node`);
  const deck = { ...road('br', [[100, 0], [100, -60]]), tags: { highway: 'residential', bridge: 'yes' } };
  const r2 = road('r2', [[0, 0], [100, 0], [100, 100]]);
  const out = roundRoadCorners([r2, deck]).features;
  assert.deepEqual(out[1].geometry[0], r2.geometry[1], 'the bridge end stays put');
});

test('two ways meeting mid-bend are rounded across the join and still meet; a signal there follows', () => {
  const a = road('a', [[0, 0], [100, 0]]);
  const b = road('b', [[100, 0], [100, 100]]);
  const signal = { id: 's', type: 'street_furniture', tags: { highway: 'traffic_signals' }, geometry: [ll(100, 0)] };
  const { features, stats } = roundRoadCorners([a, b, signal]);
  assert.equal(stats.roundedJoins, 1);
  const endA = features[0].geometry.at(-1);
  const startB = features[1].geometry[0];
  assert.equal(makeRoadNodeKey(endA), makeRoadNodeKey(startB), 'ways still share their join node');
  assert.ok(Math.hypot(...xy(endA).map((v, i) => v - [100, 0][i])) > 1, 'join moved onto the arc');
  assert.equal(makeRoadNodeKey(features[2].geometry[0]), makeRoadNodeKey(endA), 'signal follows');
  assert.ok(maxTurnDeg([...features[0].geometry, ...features[1].geometry.slice(1)]) <= 6);
});

test('real junctions are left alone; a footpath is rounded within its own, tighter limit (since 2026-11-24)', () => {
  const ways = [road('a', [[0, 0], [100, 0]]), road('b', [[100, 0], [100, 100]]), road('c', [[100, 0], [200, 0]])];
  const { features } = roundRoadCorners(ways);
  features.forEach((f, i) => assert.equal(f, ways[i]));
  const path = road('p', [[0, 0], [100, 0], [100, 100]], 'footway');
  const g = roundRoadCorners([path]).features[0].geometry;
  const mid = xy(g[g.length >> 1]);
  assert.ok(Math.abs(Math.hypot(mid[0] - 100, mid[1]) - 0.75) < 0.1, `cut ${Math.hypot(mid[0] - 100, mid[1])}`);
});

// ── railways and paths (thecoachtoma, SPLATPLAYS 2026-11-24): rounded too, each within its own limit ──
const rail = (id, pts, tags = {}) => ({ id, type: 'railway', tags: { railway: 'rail', ...tags }, geometry: pts.map(([x, y]) => ll(x, y)) });
// how far a built line strays from the mapped polyline
function strayM(built, mapped) {
  const Q = mapped.map(xy);
  let worst = 0;
  for (const p of built.map(xy)) {
    let best = Infinity;
    for (let i = 0; i + 1 < Q.length; i++) {
      const [ax, ay] = Q[i]; const [bx, by] = Q[i + 1]; const dx = bx - ax; const dy = by - ay;
      const t = Math.max(0, Math.min(1, ((p[0] - ax) * dx + (p[1] - ay) * dy) / (dx * dx + dy * dy || 1)));
      best = Math.min(best, Math.hypot(ax + dx * t - p[0], ay + dy * t - p[1]));
    }
    worst = Math.max(worst, best);
  }
  return worst;
}

test('a railway kink is rounded, never more than 1 m off the mapped track', () => {
  const r = rail('t', [[0, 0], [60, 0], [120, 12], [180, 30]]);
  const { features, stats } = roundRoadCorners([r]);
  const g = features[0].geometry;
  assert.equal(stats.byFamily.rail.vertices, 2);
  assert.equal(stats.roundedVertices, 0, 'railway corners are not counted as road corners');
  assert.ok(maxTurnDeg(g) <= 5.5, `max turn ${maxTurnDeg(g)}`);
  assert.ok(strayM(g, r.geometry) <= 1.0001, `stray ${strayM(g, r.geometry)}`);
  assert.deepEqual(g[0], r.geometry[0]); assert.deepEqual(g[g.length - 1], r.geometry[3]);
});

test('a switch: the siding follows the main line\'s curve (at most 1 m); a level crossing stays exactly', () => {
  const main = rail('m', [[0, 0], [100, 0], [200, 8], [300, 30]]);
  const siding = rail('s', [[100, 0], [180, 20]], { service: 'siding' });
  const street = road('x', [[200, -50], [200, 8], [210, 60]]);
  const { features } = roundRoadCorners([main, siding, street]);
  const keys = (f) => new Set(f.geometry.map((p) => makeRoadNodeKey(p)));
  const sw = features[1].geometry[0];
  assert.ok(keys(features[0]).has(makeRoadNodeKey(sw)), 'the siding still leaves from the main line');
  assert.ok(Math.hypot(...xy(sw).map((v, i) => v - [100, 0][i])) <= 1.0001, 'the switch moved at most 1 m');
  assert.ok(keys(features[0]).has(makeRoadNodeKey(main.geometry[2])), 'the level crossing kept on the track');
  assert.ok(keys(features[2]).has(makeRoadNodeKey(main.geometry[2])), 'and on the street');
});

test('a footpath corner is rounded within 0.75 m; steps stay as drawn', () => {
  const walk = road('w', [[0, 0], [30, 0], [30, 30]], 'footway');
  const steps = road('st', [[0, 50], [10, 50], [10, 60]], 'steps');
  const { features, stats } = roundRoadCorners([walk, steps]);
  assert.equal(stats.byFamily.path.vertices, 1);
  assert.ok(strayM(features[0].geometry, walk.geometry) <= 0.76, `stray ${strayM(features[0].geometry, walk.geometry)}`);
  assert.equal(features[1], steps);
});

test('a tram laid in a street follows its road\'s rounded curve', () => {
  const street = { ...road('42_seg_0', [[0, 0], [100, 0], [100, 100]]), tags: { highway: 'residential', railway: 'tram' } };
  const tram = { id: '42_rail_seg_0', type: 'railway', tags: { railway: 'tram', highway: 'residential' }, geometry: street.geometry };
  const { features, stats } = roundRoadCorners([street, tram]);
  assert.equal(stats.streetTracks, 1);
  assert.deepEqual(features[1].geometry, features[0].geometry);
  assert.ok(features[0].geometry.length > 3);
});

test('a railway and a road ending at the same node are not rounded as one line', () => {
  const r = rail('r', [[0, 0], [50, 0]]);
  const s = road('s', [[50, 0], [100, 30]]);
  const { stats } = roundRoadCorners([r, s]);
  assert.equal(stats.roundedJoins, 0);
});

test('a river bend is rounded within 2 m; a dam and a power line stay as drawn', () => {
  const river = { id: 'rv', type: 'water', tags: { waterway: 'river' }, geometry: [[0, 0], [80, 0], [140, 50]].map(([x, y]) => ll(x, y)) };
  const dam = { id: 'dm', type: 'water', tags: { waterway: 'dam' }, geometry: [[0, 100], [50, 100], [60, 140]].map(([x, y]) => ll(x, y)) };
  const power = { id: 'pw', type: 'power_line', tags: { power: 'line' }, geometry: [[0, 200], [80, 200], [140, 250]].map(([x, y]) => ll(x, y)) };
  const { features, stats } = roundRoadCorners([river, dam, power]);
  assert.equal(stats.byFamily.water.vertices, 1);
  assert.ok(maxTurnDeg(features[0].geometry) <= 5.5);
  assert.ok(strayM(features[0].geometry, river.geometry) <= 2.0001, `stray ${strayM(features[0].geometry, river.geometry)}`);
  assert.equal(features[1], dam); assert.equal(features[2], power);
});
