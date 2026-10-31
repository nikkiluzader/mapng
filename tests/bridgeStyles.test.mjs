import test from 'node:test';
import assert from 'node:assert/strict';
import { paintOf, typeOfTags, styleDecks, spansOf, inStyledSpan, buildStyleGeometry } from '../services/bridgeStyles.js';

// a straight part along x from x0 to x1 at road height z over flat ground at 0
const part = (x0, x1, y, z, extra = {}) => {
  const xy = []; for (let x = x0; x <= x1 + 1e-9; x += 2) xy.push([x, y]);
  return { xy, z: xy.map(() => z), half: 4, ...extra };
};
const flat = () => 0;
const builder = () => ({ pos: [], uv: [], quad(a, b, c, d) { this.pos.push(...a, ...b, ...c, ...a, ...c, ...d); this.uv.push(0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0); } });

test('paint and type from tags', () => {
  assert.equal(paintOf(''), 'grey');
  assert.equal(paintOf('Navy'), 'blue');
  assert.equal(paintOf('#f04a00'), 'orange', 'the Golden Gate');
  assert.equal(typeOfTags({ structure: 'truss' }), 'truss');
  assert.equal(typeOfTags({ structure: 'humpback' }), 'stoneArch');
  assert.equal(typeOfTags({ structure: 'beam' }), null, 'a beam bridge stays a plain deck');
  assert.equal(typeOfTags({}), null);
});

test('spans: the stretches clear of the ground, long enough', () => {
  const p = part(0, 100, 0, 10);
  p.z = p.xy.map(([x]) => (x < 20 || x > 80 ? 1 : 10));
  const sp = spansOf(p, flat);
  assert.equal(sp.length, 1);
  assert.ok(sp[0].s0 >= 18 && sp[0].s1 <= 82);
});

test('a type belongs to the parts in the tagged outline, not the whole deck with its ramps', () => {
  const bridge = part(0, 100, 0, 12);
  const ramp = part(100, 400, 0, 6);          // a long approach in the same deck
  const deck = { parts: [bridge, ramp] };
  const outline = { ring: [[-5, -20], [105, -20], [105, 20], [-5, 20]], tags: { man_made: 'bridge', 'bridge:structure': 'truss' } };
  assert.equal(styleDecks([deck], { outlines: [outline], groundAt: flat }), 1);
  assert.equal(deck.style.type, 'truss');
  assert.ok(deck.style.spans.every((sp) => sp.part === 0), 'spans on the bridge part only');
  assert.equal(deck.style.source, 'bridge outline');
});

test('a twin span (its own deck, side by side, about as long) shares the type; a ramp beside does not', () => {
  const a = { parts: [part(0, 100, 0, 12, { structure: 'arch' })] };
  const twin = { parts: [part(0, 100, 20, 12)] };
  const longRamp = { parts: [part(-200, 300, -15, 8)] };
  styleDecks([a, twin, longRamp], { groundAt: flat });
  assert.equal(twin.style?.type, 'arch');
  assert.equal(twin.style.source, 'twin');
  assert.equal(longRamp.style, undefined);
});

test('no piers inside a styled span; steel members stay outside the drawn lanes', () => {
  const p = part(0, 100, 0, 12, { structure: 'truss' });
  const deck = { parts: [p] };
  styleDecks([deck], { groundAt: flat });
  assert.equal(inStyledSpan(deck, 0, 50, 0), true);
  assert.equal(inStyledSpan({ parts: [p] }, 0, 50, 0), false, 'an unstyled deck keeps its piers');
  const g = buildStyleGeometry(deck, { groundAt: flat, newBuilder: builder });
  assert.ok(g.steel.pos.length > 0);
  // every steel vertex lower than 6.5 m over the road stands outside the lanes (|y| > half)
  for (let i = 0; i < g.steel.pos.length; i += 3) {
    const y = g.steel.pos[i + 1]; const z = g.steel.pos[i + 2];
    if (z < 12 + 6.4) assert.ok(Math.abs(y) > 4, `a member in the lanes at y ${y.toFixed(2)}, z ${z.toFixed(2)}`);
  }
});

test('stone arches under a low canal bridge: built, from the water up to just under the road', () => {
  const p = part(0, 14, 0, 2.6, { structure: 'humpback' });
  const deck = { parts: [p] };
  styleDecks([deck], { groundAt: flat });
  assert.equal(deck.style.type, 'stoneArch');
  const g = buildStyleGeometry(deck, { groundAt: flat, newBuilder: builder });
  assert.ok(g.stone.pos.length > 0, 'the vault and its spandrels');
  for (let i = 2; i < g.stone.pos.length; i += 3) assert.ok(g.stone.pos[i] <= 2.6 + 1e-6, 'nothing over the road');
});
