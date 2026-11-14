// A road over a tunnel road that comes out an open cutting (too little ground for a roof): a deck over it where
// there is room for one, as over any road; none over a tunnel that keeps its roof, or with too little room.
import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyStructures } from '../services/structures/structureRules.js';

const lineOf = (x0, y0, x1, y1, extra) => {
  const L = Math.hypot(x1 - x0, y1 - y0); const n = Math.round(L / 2) + 1; const x = []; const y = []; const s = [];
  for (let i = 0; i < n; i++) { x.push(x0 + (x1 - x0) * i / (n - 1)); y.push(y0 + (y1 - y0) * i / (n - 1)); s.push(L * i / (n - 1)); }
  return { x: Float64Array.from(x), y: Float64Array.from(y), s: Float64Array.from(s), g: new Float64Array(n).fill(10), half: 2.8, highway: 'primary', length: L, ...extra };
};
const scene = (under, angle = 90) => {
  const a = angle * Math.PI / 180;
  const up = lineOf(-60, 0, 60, 0, {});
  const dn = lineOf(-40 * Math.cos(a), -40 * Math.sin(a), 40 * Math.cos(a), 40 * Math.sin(a), { tunnel: true, highway: 'secondary' });
  const mid = (e) => (e.s.length - 1) / 2;
  const graph = {
    edges: [up, dn],
    profile: { z: [new Float64Array(up.s.length).fill(10), new Float64Array(dn.s.length).fill(10 - under)] },
    crossings: { crossings: [{ a: { edge: 0, i: mid(up), s: up.s[mid(up)], f: 0 }, b: { edge: 1, i: mid(dn), s: dn.s[mid(dn)], f: 0 }, upper: 'a', rule: 'tunnel' }], overlaps: [], water: [] },
  };
  return classifyStructures(graph).segments;
};
const deckOf = (segs) => segs.find((s) => s.edge === 0 && s.kind === 'deck');

test('a road 4 m over an open tunnel road is a bridge over it', () => {
  const deck = deckOf(scene(4));
  assert.ok(deck, 'a deck on the upper road');
  assert.ok(deck.s1 - deck.s0 >= 10 && deck.s1 - deck.s0 < 30, `deck of ${deck.s1 - deck.s0} m`);
});

test('crossing at a slant the deck is as long as the cutting runs under the road', () => {
  const square = deckOf(scene(4)); const slant = deckOf(scene(4, 30));
  assert.ok(slant.s1 - slant.s0 > (square.s1 - square.s0) * 1.6, `${slant.s1 - slant.s0} m against ${square.s1 - square.s0} m`);
});

test('no deck over a tunnel deep enough for its roof, or with too little room under the road', () => {
  assert.equal(deckOf(scene(8)), undefined, 'a roofed tunnel: the road stands on its roof');
  assert.equal(deckOf(scene(2)), undefined, '2 m: no room for a deck and a car under it');
});
