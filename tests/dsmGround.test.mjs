import test from 'node:test';
import assert from 'node:assert/strict';

import { groundFromSurface, openingGround } from '../services/dsmGround.js';

const n = 256, cell = 4;   // 1 km at 4 m

// box blur (radius in cells), clamped edges: a stand-in for the radar's footprint
function blur(a, r) {
  const pass = (src, rows) => {
    const out = new Float32Array(src.length);
    for (let l = 0; l < n; l++) for (let i = 0; i < n; i++) {
      let s = 0; for (let t = -r; t <= r; t++) { const c = Math.min(n - 1, Math.max(0, i + t)); s += rows ? src[l * n + c] : src[c * n + l]; }
      out[rows ? l * n + i : i * n + l] = s / (2 * r + 1);
    }
    return out;
  };
  return pass(pass(a, true), false);
}
// a city: 40 m blocks of 30 m buildings on a 60 m street grid, over gently sloping ground
function city({ hill = false } = {}) {
  const ground = new Float32Array(n * n), bld = new Float32Array(n * n), H = new Float32Array(n * n);
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const k = y * n + x;
    ground[k] = 100 + x * 0.02 + (hill ? 40 * Math.exp(-((x - 200) ** 2 + (y - 60) ** 2) / (2 * 15 ** 2)) : 0);
    const inDistrict = x > 40 && x < 170 && y > 60 && y < 200;
    const inBlock = (x % 15) < 10 && (y % 15) < 10;
    if (inDistrict && inBlock) { bld[k] = 30; H[k] = 30; }
  }
  return { ground, bld, H };
}
const noise = (seed) => { let s = seed; return () => { s = (s * 16807) % 2147483647; return (s / 2147483647 - 0.5); }; };
const evidence = (bld) => ({ bld, bridge: new Uint8Array(n * n), water: new Uint8Array(n * n), wood: new Uint8Array(n * n) });
const rmseOn = (a, b, mask) => { let s = 0, c = 0; for (let k = 0; k < a.length; k++) if (mask[k]) { s += (a[k] - b[k]) ** 2; c++; } return Math.sqrt(s / c); };

test('radar data over a district: the ground under it comes out much closer', () => {
  const { ground, bld, H } = city();
  const rnd = noise(7);
  const bump = blur(H, 12);                                        // the radar's footprint
  const dsm = ground.map((g, k) => g + 0.6 * bump[k] + rnd() * 2);  // a surface model: 60% of the volume, speckle
  const gedtm = ground.map((g, k) => g + 3 + 0.15 * bump[k] + rnd() * 0.5);   // bare earth, its own datum, less bias
  const streets = bld.map((b, k) => (b === 0 && bump[k] > 5 ? 1 : 0));
  const before = rmseOn(dsm.map((v) => v - 0), ground, streets);
  const r = groundFromSurface(dsm, gedtm, evidence(bld), n, cell);
  assert.ok(r.out, 'applied');
  assert.ok(r.stats.dsmSlope > 0.1, `rooftop signal ${r.stats.dsmSlope}`);
  // compare shapes: remove each surface's own constant (a level-wide shift is invisible in game)
  const mean = (a, m) => { let s = 0, c = 0; for (let k = 0; k < a.length; k++) if (m[k]) { s += a[k]; c++; } return s / c; };
  const all = new Uint8Array(n * n).fill(1);
  const aligned = (a) => { const d = mean(a, all) - mean(ground, all); return a.map((v) => v - d); };
  const after = rmseOn(aligned(r.out), ground, streets), was = rmseOn(aligned(dsm), ground, streets);
  assert.ok(after < was * 0.6, `streets: ${was.toFixed(2)} -> ${after.toFixed(2)} m`);
  assert.ok(Number.isFinite(before));
});

test('data that is already bare earth is left alone', () => {
  const { ground, bld, H } = city();
  const rnd = noise(3);
  const bump = blur(H, 12);
  const dtm = ground.map((g) => g + rnd() * 0.3);                    // clean
  const gedtm = ground.map((g, k) => g + 0.6 * bump[k] + rnd());     // the other model is the biased one
  const r = groundFromSurface(dtm, gedtm, evidence(bld), n, cell);
  assert.equal(r.out, null);
  assert.ok(r.stats.dsmSlope < 0, `slope ${r.stats.dsmSlope}`);
});

test('a hill with no buildings on it stays a hill', () => {
  const { ground, bld, H } = city({ hill: true });
  const rnd = noise(11);
  const bump = blur(H, 12);
  const dsm = ground.map((g, k) => g + 0.6 * bump[k] + rnd() * 2);
  const gedtm = ground.map((g, k) => g + 0.15 * bump[k] + rnd() * 0.5);
  const r = groundFromSurface(dsm, gedtm, evidence(bld), n, cell);
  const top = 60 * n + 200;
  assert.ok(Math.abs(r.out[top] - dsm[top]) < 2, `hilltop moved ${(dsm[top] - r.out[top]).toFixed(2)} m`);
});

test('the opening leaves a plain slope as it is, away from the map edge', () => {
  const a = new Float32Array(n * n); for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) a[y * n + x] = 50 + x * 0.05 + y * 0.03;
  const o = openingGround(a, n, cell);
  const e = 52;   // half the 400 m window (50 cells) plus a margin: no data past the edge
  let maxd = 0; for (let y = e; y < n - e; y++) for (let x = e; x < n - e; x++) maxd = Math.max(maxd, Math.abs(o[y * n + x] - a[y * n + x]));
  assert.ok(maxd < 0.01, `moved ${maxd}`);
});

test('a sloping map without buildings is not cut along its edges', () => {
  const a = new Float32Array(n * n); for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) a[y * n + x] = 50 + x * 0.05 + y * 0.03;
  const rnd = noise(5); const gedtm = a.map((v) => v + rnd() * 0.5);
  const r = groundFromSurface(a, gedtm, evidence(new Float32Array(n * n)), n, cell);
  if (r?.out) { let maxd = 0; for (let k = 0; k < a.length; k++) maxd = Math.max(maxd, a[k] - r.out[k]); assert.ok(maxd < 1, `cut ${maxd}`); }
});
