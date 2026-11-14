// A side road's first metres lie in the through road's width: pinned to its height (services/structures/junctionMouths.js).
import test from 'node:test';
import assert from 'node:assert/strict';
import { junctionMouthPins } from '../services/structures/junctionMouths.js';

// an edge along a straight line, a station every 2 m
const edge = (x0, y0, x1, y1, half, extra = {}) => { const L = Math.hypot(x1 - x0, y1 - y0); const n = Math.round(L / 2) + 1; const s = Array.from({ length: n }, (_, i) => (L * i) / (n - 1)); return { x: s.map((d) => x0 + ((x1 - x0) * d) / L), y: s.map((d) => y0 + ((y1 - y0) * d) / L), s, length: L, half, ...extra }; };
const graphOf = (edges, joins) => { const nodes = new Map(); joins.forEach((list, id) => nodes.set(id, { id, edges: list })); return { edges, nodes }; };

test('a side road falling away from a through road is held at the through road\'s height while inside its width', () => {
  // the through road runs east-west, level at 10 and 4 m to each side; the side road leaves north, falling 10 %
  const edges = [edge(-40, 0, 0, 0, 4), edge(0, 0, 40, 0, 4), edge(0, 0, 0, 40, 3)];
  const z = [edges[0].s.map(() => 10), edges[1].s.map(() => 10), edges[2].s.map((d) => 10 - 0.1 * d)];
  const g = graphOf(edges, [[{ edge: 0, end: 1 }, { edge: 1, end: 0 }, { edge: 2, end: 0 }]]);
  const { pins, mouths } = junctionMouthPins(g, z);
  assert.equal(mouths, 1);
  assert.ok(pins.length >= 2 && pins.every(([k]) => k === 2), JSON.stringify(pins));
  for (const [, i, h] of pins) { assert.ok(edges[2].s[i] <= 4.5 + 1e-9, `station ${edges[2].s[i]} m out`); assert.ok(Math.abs(h - 10) < 1e-9); }
  // (the station 6 m out is its own again)
  assert.ok(!pins.some(([, i]) => edges[2].s[i] > 4.6));
});

test('the through road climbing: the side road\'s mouth follows the climb beside it', () => {
  const up = (x) => 10 + 0.08 * x;
  const edges = [edge(-40, 0, 0, 0, 4), edge(0, 0, 40, 0, 4), edge(0, 0, 30, 30, 3)];   // the side road leaves at 45 degrees
  const z = [edges[0].x.map(up), edges[1].x.map(up), edges[2].s.map(() => 10)];
  const { pins } = junctionMouthPins(graphOf(edges, [[{ edge: 0, end: 1 }, { edge: 1, end: 0 }, { edge: 2, end: 0 }]]), z);
  assert.ok(pins.length >= 2);
  for (const [, i, h] of pins) assert.ok(Math.abs(h - up(edges[2].x[i])) < 1e-6, `${h} against ${up(edges[2].x[i])}`);
});

test('nothing is pinned where no road runs through, or where a bridge is at the junction', () => {
  // three roads at 120 degrees: none runs through
  const star = [edge(0, 0, 40, 0, 3), edge(0, 0, -20, 34.6, 3), edge(0, 0, -20, -34.6, 3)];
  const flat = star.map((e) => e.s.map(() => 10));
  assert.equal(junctionMouthPins(graphOf(star, [[{ edge: 0, end: 0 }, { edge: 1, end: 0 }, { edge: 2, end: 0 }]]), flat).pins.length, 0);
  const withBridge = [edge(-40, 0, 0, 0, 4), edge(0, 0, 40, 0, 4, { bridge: true }), edge(0, 0, 0, 40, 3)];
  assert.equal(junctionMouthPins(graphOf(withBridge, [[{ edge: 0, end: 1 }, { edge: 1, end: 0 }, { edge: 2, end: 0 }]]), withBridge.map((e) => e.s.map(() => 10))).pins.length, 0);
});
