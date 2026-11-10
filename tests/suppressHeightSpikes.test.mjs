// The backdrop's spike filter (services/surroundingTiles.js): the fast version
// gives exactly what the one it replaced gave.
import test from 'node:test';
import assert from 'node:assert/strict';

const NO_DATA_VALUE = -99999;
// (the filter as it was: a fresh array sorted twice for every sample)
const reference = (heightMap, width, height) => {
  const out = new Float32Array(heightMap); const neighbors = new Float32Array(8); let replaced = 0;
  for (let y = 1; y < height - 1; y++) for (let x = 1; x < width - 1; x++) {
    const idx = y * width + x; const value = heightMap[idx];
    if (!Number.isFinite(value) || value === NO_DATA_VALUE) continue;
    let count = 0;
    for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) {
      if (ox === 0 && oy === 0) continue;
      const n = heightMap[(y + oy) * width + (x + ox)];
      if (!Number.isFinite(n) || n === NO_DATA_VALUE) continue;
      neighbors[count++] = n;
    }
    if (count < 5) continue;
    const sorted = Array.from(neighbors.subarray(0, count)).sort((a, b) => a - b);
    const median = sorted[Math.floor(count / 2)];
    const deviations = sorted.map((n) => Math.abs(n - median)).sort((a, b) => a - b);
    const mad = deviations[Math.floor(deviations.length / 2)] || 0;
    const robustDelta = Math.max(8, mad * 6);
    if (value > 12000 || value < -12000 || Math.abs(value - median) > robustDelta) { out[idx] = median; replaced++; }
  }
  if (replaced > 0) heightMap.set(out);
  return replaced;
};

test('same result as the old filter: smooth ground, rough ground, speckles, nodata, absurd values', async () => {
  globalThis.localStorage ??= { getItem: () => null, setItem: () => {} };
  const { suppressHeightSpikes } = await import('../services/surroundingTiles.js');
  let seed = 12345; const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
  for (const [name, w, f] of [
    ['smooth', 96, (x, y) => 500 + x * 0.7 + y * 0.3],
    ['rough', 96, () => 800 + rnd() * 60],
    ['speckled', 128, (x, y) => 300 + Math.sin(x / 9) * 40 + Math.cos(y / 7) * 30 + (rnd() < 0.02 ? (rnd() - 0.5) * 900 : 0)],
    ['holes', 96, (x, y) => (rnd() < 0.08 ? NO_DATA_VALUE : 100 + x + (rnd() < 0.03 ? 20000 : 0) + (rnd() < 0.02 ? NaN : 0))],
  ]) {
    const a = new Float32Array(w * w); for (let y = 0; y < w; y++) for (let x = 0; x < w; x++) a[y * w + x] = f(x, y);
    const b = new Float32Array(a);
    const ra = reference(a, w, w); const rb = suppressHeightSpikes(b, w, w);
    assert.equal(rb, ra, `${name}: ${rb} replaced, the old filter ${ra}`);
    for (let i = 0; i < a.length; i++) assert.ok(Object.is(a[i], b[i]), `${name}: sample ${i} is ${b[i]}, the old filter gave ${a[i]}`);
    if (name === 'speckled') assert.ok(ra > 50, `${ra} speckles removed`);
  }
});

test('fast: a 1024 tile in well under a second', async () => {
  const { suppressHeightSpikes } = await import('../services/surroundingTiles.js');
  const w = 1024; const a = new Float32Array(w * w); for (let i = 0; i < a.length; i++) a[i] = 1000 + Math.sin(i / 5000) * 200 + ((i * 7919) % 13);
  const t0 = performance.now(); suppressHeightSpikes(a, w, w); const ms = performance.now() - t0;
  assert.ok(ms < 600, `${ms.toFixed(0)} ms`);
});
