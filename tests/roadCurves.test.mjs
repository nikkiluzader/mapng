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

test('a vertex another way is attached to stays exactly, and the road still bends smoothly through it', () => {
  const r = road('r', [[0, 0], [100, 0], [100, 100]]);
  const drive = { id: 'd', type: 'road', tags: { highway: 'service' }, geometry: [r.geometry[1], ll(140, -40)] };
  const { features } = roundRoadCorners([r, drive]);
  const g = features[0].geometry;
  assert.ok(g.some((p) => makeRoadNodeKey(p) === makeRoadNodeKey(r.geometry[1])), 'shared vertex kept');
  assert.ok(maxTurnDeg(g) < 30, `max turn ${maxTurnDeg(g)}`);
  assert.deepEqual(features[1].geometry[0], r.geometry[1], 'driveway still attached');
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

test('real junctions and footpaths are left alone', () => {
  const ways = [road('a', [[0, 0], [100, 0]]), road('b', [[100, 0], [100, 100]]), road('c', [[100, 0], [200, 0]])];
  const { features } = roundRoadCorners(ways);
  features.forEach((f, i) => assert.equal(f, ways[i]));
  const path = road('p', [[0, 0], [100, 0], [100, 100]], 'footway');
  assert.equal(roundRoadCorners([path]).features[0], path);
});
