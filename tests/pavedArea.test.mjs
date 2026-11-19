import test from 'node:test';
import assert from 'node:assert/strict';
import { distanceWithNearest, makeGrid, buildPavedGrid, cornerApex, ROAD, WALK, GAP, VERGE } from '../services/pavedArea.js';

test('distanceWithNearest: exact squared distance and a nearest seed, as brute force', () => {
  let seed = 3; const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
  for (const [w, h] of [[17, 11], [40, 40], [1, 9]]) {
    const s = new Uint8Array(w * h); for (let i = 0; i < w * h; i++) s[i] = rnd() < 0.05 ? 1 : 0;
    const { d2, near } = distanceWithNearest(s, w, h);
    for (let i = 0; i < w * h; i++) {
      let best = Infinity;
      for (let j = 0; j < w * h; j++) if (s[j]) { const dx = (i % w) - (j % w); const dy = ((i / w) | 0) - ((j / w) | 0); best = Math.min(best, dx * dx + dy * dy); }
      if (best === Infinity) { assert.equal(near[i], -1); continue; }
      assert.equal(d2[i], best);
      const j = near[i]; const dx = (i % w) - (j % w); const dy = ((i / w) | 0) - ((j / w) | 0);
      assert.ok(s[j] && dx * dx + dy * dy === best);
    }
  }
});

// A synthetic street: an east-west road 8 m wide (y from -4 to 4), a sidewalk footway 5 m north of the curb
// (y = 9.5, 2 m wide), a plain footway 5 m south (y = -9.5), and a second sidewalk 10 m behind the first.
const scene = (extra = {}) => {
  const g = makeGrid(-30, -30, 30, 30);
  const { cells } = buildPavedGrid(g, {
    roads: [{ pts: [[-40, 0], [40, 0]], half: 4 }],
    walks: [
      { pts: [[-40, 9.5], [40, 9.5]], half: 1, sidewalk: true },
      { pts: [[-40, -9.5], [40, -9.5]], half: 1, sidewalk: false },
      { pts: [[-40, 20.5], [40, 20.5]], half: 1, sidewalk: true },
    ],
    ...extra,
  });
  const at = (x, y) => cells[Math.floor((30 - y) / g.res) * g.w + Math.floor((x + 30) / g.res)];
  return at;
};

test('a sidewalk footway is paved from the curb; a plain one 5 m off is not; nothing past a walk', () => {
  const at = scene();
  assert.ok(at(0, 0) & ROAD);
  assert.ok(at(0, 9.5) & WALK);
  for (const y of [4.5, 6, 8]) assert.ok(at(0, y) & GAP, `strip at y ${y} paved`);
  for (const y of [-5, -7]) assert.equal(at(0, y), 0, `plain footway's strip at y ${y} left`);
  for (const y of [11.5, 14, 18]) assert.ok(!(at(0, y) & GAP), `past the first walk at y ${y} not filled`);
});

test('mapped greenery keeps the strip as a verge', () => {
  const at = scene({ greenery: [[[-10, 4.2], [10, 4.2], [10, 8.4], [-10, 8.4]]] });
  assert.ok(at(0, 6) & VERGE && !(at(0, 6) & GAP));
  assert.ok(at(20, 6) & GAP, 'outside the greenery still paved');
});

test('cornerApex: where a rounded corner\'s two road edges meet', () => {
  // a quarter circle from (5, 0) round (5, 5) to (0, 5), its tangents along y = 0 and x = 0: they meet at (0, 0)
  const arc = Array.from({ length: 9 }, (_, i) => { const a = -Math.PI / 2 - (i / 8) * (Math.PI / 2); return [5 + 5 * Math.cos(a), 5 + 5 * Math.sin(a)]; });
  const q = cornerApex(arc);
  assert.ok(q && Math.abs(q[0]) < 0.1 && Math.abs(q[1]) < 0.1, JSON.stringify(q));
});
