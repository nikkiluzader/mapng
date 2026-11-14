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
  const { pins: all, mouths } = junctionMouthPins(g, z);
  assert.equal(mouths, 1);
  const pins = all.filter(([k]) => k === 2);
  assert.ok(pins.length >= 2, JSON.stringify(all));
  // (the through road by the junction is held where it was: within 12 m, at its own heights)
  const held = all.filter(([k]) => k !== 2);
  assert.ok(held.length >= 8 && held.every(([k, i, h]) => h === z[k][i] && Math.min(edges[k].s[i], 40 - edges[k].s[i]) <= 12));
  for (const [, i, h] of pins) { assert.ok(edges[2].s[i] <= 4.5 + 1e-9, `station ${edges[2].s[i]} m out`); assert.ok(Math.abs(h - 10) < 1e-9); }
});

test('the through road climbing: the side road\'s mouth follows the climb beside it', () => {
  const up = (x) => 10 + 0.08 * x;
  const edges = [edge(-40, 0, 0, 0, 4), edge(0, 0, 40, 0, 4), edge(0, 0, 30, 30, 3)];   // the side road leaves at 45 degrees
  const z = [edges[0].x.map(up), edges[1].x.map(up), edges[2].s.map(() => 10)];
  const pins = junctionMouthPins(graphOf(edges, [[{ edge: 0, end: 1 }, { edge: 1, end: 0 }, { edge: 2, end: 0 }]]), z).pins.filter(([k]) => k === 2);
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

test('a slip road merging at a shallow angle is not pinned', () => {
  const edges = [edge(-40, 0, 0, 0, 4), edge(0, 0, 40, 0, 4), edge(0, 0, -38, 8, 3)];   // leaves 12 degrees off the through line
  const z = [edges[0].s.map(() => 10), edges[1].s.map(() => 10), edges[2].s.map((d) => 10 + 0.05 * d)];
  assert.equal(junctionMouthPins(graphOf(edges, [[{ edge: 0, end: 1 }, { edge: 1, end: 0 }, { edge: 2, end: 0 }]]), z).pins.length, 0);
});

test('beyond the through road\'s edge the side road turns to its own grade over a curve, not at a corner', () => {
  // level through road at 10; the side road falls 10 % from the junction
  const edges = [edge(-40, 0, 0, 0, 4), edge(0, 0, 40, 0, 4), edge(0, 0, 0, 60, 3, { highway: 'residential' })];
  const z = [edges[0].s.map(() => 10), edges[1].s.map(() => 10), edges[2].s.map((d) => 10 - 0.1 * d)];
  const { pins: every, eased } = junctionMouthPins(graphOf(edges, [[{ edge: 0, end: 1 }, { edge: 1, end: 0 }, { edge: 2, end: 0 }]]), z, { limitOf: () => 0.25 });
  assert.equal(eased, 1);
  const pins = every.filter(([k]) => k === 2);
  const h = new Map(pins.map(([, i, v]) => [edges[2].s[i], v]));
  const out = [...h.keys()].filter((s) => s > 4.6).sort((a, b) => a - b);
  assert.ok(out.length >= 2 && out[out.length - 1] <= 4 + 12 + 1e-9, `curve stations ${out}`);
  // level at the edge, the grade growing steadily: no change of grade over 2 % a metre
  const ss = [...h.keys()].sort((a, b) => a - b); let prev = 0;
  for (let i = 1; i < ss.length; i++) { const g = (h.get(ss[i]) - h.get(ss[i - 1])) / (ss[i] - ss[i - 1]); assert.ok(Math.abs(g - prev) <= 0.04, `grade ${prev} to ${g} at ${ss[i]}`); prev = g; }
  // ... and heading for the road's first line 30 m out: its end grade a little steeper than 10 %
  assert.ok(prev < -0.08 && prev > -0.16, `end grade ${prev}`);
});

test('a side road at its grade limit all the way has no room for a landing: left as it was', () => {
  const edges = [edge(-40, 0, 0, 0, 6), edge(0, 0, 40, 0, 6), edge(0, 0, 0, -60, 3, { highway: 'primary' })];
  const z = [edges[0].s.map(() => 14), edges[1].s.map(() => 14), edges[2].s.map((d) => 14 - 0.1 * d)];
  const { pins, mouths, noRoom } = junctionMouthPins(graphOf(edges, [[{ edge: 0, end: 1 }, { edge: 1, end: 0 }, { edge: 2, end: 0 }]]), z, { limitOf: () => 0.1 });
  assert.equal(pins.length, 0); assert.equal(mouths, 0); assert.equal(noRoom, 1);
  // ... but with a flatter stretch further out it reaches the through road's height over its whole length
  const z2 = [z[0], z[1], edges[2].s.map((d) => 14 - 0.1 * Math.min(d, 30) - 0.01 * Math.max(0, d - 30))];
  const b = junctionMouthPins(graphOf(edges, [[{ edge: 0, end: 1 }, { edge: 1, end: 0 }, { edge: 2, end: 0 }]]), z2, { limitOf: () => 0.1 });
  assert.equal(b.mouths, 1); assert.equal(b.eased, 1);
  assert.ok(b.pins.filter(([k, i]) => k === 2 && edges[2].s[i] <= 6.5).every(([, , v]) => Math.abs(v - 14) < 1e-9));
});
