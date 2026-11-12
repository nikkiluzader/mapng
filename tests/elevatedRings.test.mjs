// services/structures/rings.js: an elevated ring is one slab
import test from 'node:test';
import assert from 'node:assert/strict';
import { findElevatedRings, ringPlanePins, RING_MAX_TILT } from '../services/structures/rings.js';

// a ring of `n` one-way bridge edges of radius R round (0, 0), and one ramp joining it from the east
function scene({ n = 8, R = 35, bridge = true, oneway = true } = {}) {
  const nodes = new Map(); const edges = [];
  const node = (id) => { if (!nodes.has(id)) nodes.set(id, { id, edges: [] }); return nodes.get(id); };
  const add = (from, to, pts, extra = {}) => {
    const x = pts.map((p) => p[0]); const y = pts.map((p) => p[1]);
    const s = [0]; for (let i = 1; i < pts.length; i++) s.push(s[i - 1] + Math.hypot(x[i] - x[i - 1], y[i] - y[i - 1]));
    const e = { id: edges.length, from, to, x, y, s, length: s[s.length - 1], half: 4, bridge, oneway, ...extra };
    node(from).edges.push({ edge: e.id, end: 0 }); node(to).edges.push({ edge: e.id, end: 1 }); edges.push(e);
    return e.id;
  };
  const at = (a) => [R * Math.cos(a), R * Math.sin(a)];
  for (let k = 0; k < n; k++) {
    const a0 = (k / n) * 2 * Math.PI; const a1 = ((k + 1) / n) * 2 * Math.PI;
    add(`r${k}`, `r${(k + 1) % n}`, [0, 0.25, 0.5, 0.75, 1].map((t) => at(a0 + (a1 - a0) * t)));
  }
  // the ramp: 80 m straight in from the east, ending on the ring's node r0 at (R, 0)
  const ramp = add('far', 'r0', Array.from({ length: 41 }, (_, i) => [R + 80 - i * 2, 0]));
  return { graph: { nodes, edges }, ramp };
}

test('a closed loop of one-way bridge edges is a ring; the ramp is no part of it', () => {
  const { graph, ramp } = scene();
  const rings = findElevatedRings(graph);
  assert.equal(rings.length, 1);
  assert.equal(rings[0].edges.length, 8);
  assert.ok(!rings[0].edges.includes(ramp));
  assert.ok(Math.abs(rings[0].length - 2 * Math.PI * 35) < 6);
});

test('no ring on the ground, of two-way roads, or in two carriageways joined at both ends', () => {
  assert.equal(findElevatedRings(scene({ bridge: false }).graph).length, 0);
  assert.equal(findElevatedRings(scene({ oneway: false }).graph).length, 0);
  // a long thin loop: 200 m out, 200 m back, 8 m apart
  const nodes = new Map(); const edges = [];
  const node = (id) => { if (!nodes.has(id)) nodes.set(id, { id, edges: [] }); return nodes.get(id); };
  const add = (from, to, pts) => { const x = pts.map((p) => p[0]); const y = pts.map((p) => p[1]); const s = [0]; for (let i = 1; i < pts.length; i++) s.push(s[i - 1] + Math.hypot(x[i] - x[i - 1], y[i] - y[i - 1])); const e = { id: edges.length, from, to, x, y, s, length: s[s.length - 1], half: 4, bridge: true, oneway: true }; node(from).edges.push({ edge: e.id, end: 0 }); node(to).edges.push({ edge: e.id, end: 1 }); edges.push(e); };
  add('a', 'b', [[0, 0], [100, 4], [200, 0]]); add('b', 'a', [[200, 0], [100, -4], [0, 0]]); add('b', 'c', [[200, 0], [300, 0]]);
  assert.equal(findElevatedRings({ nodes, edges }).length, 0);
});

test('the ring is pinned to one plane, never under what was solved, and the ramp\'s last metres with it', () => {
  const { graph, ramp } = scene();
  // solved as today: each piece takes its ends from the ramps, up and down round the loop
  const z = graph.edges.map((e, k) => Array.from(e.x, (x, i) => (k === ramp ? 14 + (e.s[i] / e.length) * 6 : 20 + Math.sin(Math.atan2(e.y[i], x) * 3) * 0.8)));
  const { pins, rings } = ringPlanePins(graph, z);
  assert.equal(rings.length, 1);
  assert.ok(rings[0].spread > 1.4, `the solved ring was ${rings[0].spread.toFixed(2)} m off a plane`);
  assert.ok(rings[0].tilt <= RING_MAX_TILT + 1e-9);
  const ringPins = pins.filter(([k]) => k !== ramp);
  // one plane: the residual of every pin against a plane fitted through them is nothing
  const mean = ringPins.reduce((a, p) => a + p[2], 0) / ringPins.length;
  assert.ok(ringPins.every(([k, i, h]) => Math.abs(h - mean) < 35 * RING_MAX_TILT + 1e-6));
  assert.ok(ringPins.every(([k, i, h]) => h >= z[k][i] - 1e-9), 'no station lower than it was solved');
  // the ramp: pinned only where it is within the slab (the ring's half width and a metre), on the plane
  const rampPins = pins.filter(([k]) => k === ramp);
  assert.ok(rampPins.length >= 2 && rampPins.length <= 6, `${rampPins.length} ramp stations pinned`);
  const e = graph.edges[ramp];
  assert.ok(rampPins.every(([, i]) => e.x[i] - 35 <= 5 + 1e-6));
});
