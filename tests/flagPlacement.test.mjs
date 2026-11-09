import test from 'node:test';
import assert from 'node:assert/strict';
import { pickFlagCell } from '../services/flagPlacement.js';

const grid = (w, h, f) => { const a = new Float32Array(w * h); for (let r = 0; r < h; r++) for (let c = 0; c < w; c++) a[r * w + c] = f(c, r); return { heightMap: a, width: w, height: h }; };

test('flag: the summit, not a one- or two-sample spike', () => {
  // a hill peaking at (60, 40); a 2x1 spike of +80 m at (20, 70)
  const t = grid(100, 100, (c, r) => 100 - Math.hypot(c - 60, r - 40) * 0.5 + ((r === 70 && (c === 20 || c === 21)) ? 80 : 0));
  const p = pickFlagCell(t);
  assert.ok(Math.abs(p.col - 60) <= 1 && Math.abs(p.row - 40) <= 1, JSON.stringify(p));
});

test('flag: land rising off the map: kept in from the edge', () => {
  const t = grid(200, 200, (c) => c * 2);   // highest along the east edge
  const p = pickFlagCell(t);
  assert.ok(p.col <= 200 - 16 && p.col >= 180 && !p.peak, JSON.stringify(p));
});

test('flag: no-data samples never win; big maps refined to the exact summit', () => {
  const t = grid(5000, 5000, (c, r) => (c === 2500 && r === 2500 ? -32768 : 500 - Math.hypot(c - 3111, r - 1777) * 0.01));
  const p = pickFlagCell(t);
  assert.ok(Math.abs(p.col - 3111) <= 1 && Math.abs(p.row - 1777) <= 1, JSON.stringify(p));
});

test('flag: a hilltop inside the map beats higher ground rising off its edge', () => {
  // the land climbs to the north-west corner; a hill stands at (140, 120)
  const t = grid(200, 200, (c, r) => (400 - c - r) * 0.2 + Math.max(0, 40 - Math.hypot(c - 140, r - 120)) * 1.5);
  const p = pickFlagCell(t);
  assert.ok(p.peak && Math.abs(p.col - 140) <= 2 && Math.abs(p.row - 120) <= 2, JSON.stringify(p));
});
