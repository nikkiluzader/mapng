import test from 'node:test';
import assert from 'node:assert/strict';
import { PixelEdits } from '../services/pixelEdits.js';

// The terrain passes' per-pixel edits (lake beds, sea floors, levelling under decks) moved off Map, which stops
// at 2^24 entries (a great lake at 8 km: "Map maximum size exceeded", the lake beds skipped). PixelEdits must
// answer as the Map did: the same values, the same order, the same size.
test('PixelEdits answers as a Map for the same operations', () => {
  const m = new Map(); const p = new PixelEdits();
  let seed = 7; const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
  for (let k = 0; k < 20000; k++) {
    const idx = Math.floor(rnd() * 300000);   // (spans several tiles)
    const v = rnd() < 0.01 ? NaN : (rnd() - 0.5) * 1e3;
    if (rnd() < 0.7) { m.set(idx, Math.min(m.get(idx) ?? Infinity, v)); p.set(idx, Math.min(p.get(idx) ?? Infinity, v)); }
    assert.equal(p.has(idx), m.has(idx));
    assert.ok(Object.is(p.get(idx), m.get(idx)));
  }
  assert.equal(p.size, m.size);
  assert.deepEqual([...p.keys()], [...m.keys()]);
  assert.deepEqual([...p].map(([i, v]) => [i, Number.isNaN(v) ? 'NaN' : v]), [...m].map(([i, v]) => [i, Number.isNaN(v) ? 'NaN' : v]));
  assert.equal(p.get(299999999), undefined);
});

test('an entry added while iterating is met, as in a Map', () => {
  const p = new PixelEdits(); p.set(5, 1);
  const seen = [];
  for (const [i] of p) { seen.push(i); if (i < 8) p.set(i + 1, 0); }
  assert.deepEqual(seen, [5, 6, 7, 8]);
});

test('more pixels than a Map can hold', () => {
  const p = new PixelEdits();
  const n = 2 ** 24 + 10;
  for (let i = 0; i < n; i++) p.set(i, i & 255);
  assert.equal(p.size, n);
  assert.equal(p.get(n - 1), (n - 1) & 255);
});
