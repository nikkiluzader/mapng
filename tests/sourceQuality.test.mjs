import test from 'node:test';
import assert from 'node:assert/strict';
import { compareSources, measureSource, qualityReportHtml, roadsInPatch, scoreSource } from '../services/sourceQuality.js';

// a 256 m square, 1 m cells: a hillside falling 30 % to the east, a road running north along x = 128
const PX = 256;
const grid = (f) => { const h = new Float32Array(PX * PX); for (let j = 0; j < PX; j++) for (let i = 0; i < PX; i++) h[j * PX + i] = f(i + 0.5, j + 0.5); return h; };
const slope = (x) => 500 - 0.3 * x;
// the road cut into it as a bench 8 m wide, level, the hill meeting it over 3 m each side
const benched = (x) => { const d = Math.abs(x - 128); const z0 = slope(128); if (d <= 4) return z0; if (d >= 7) return slope(x); const t = (d - 4) / 3; return z0 * (1 - t) + slope(x) * t; };
const road = [{ name: 'Hill Road', highway: 'tertiary', pts: [[128, 10], [128, 246]] }];

test('a source that holds the road bench scores far over one that shows a plain slope', () => {
  const fine = measureSource(grid((x) => benched(x)), PX, 1, road);
  const coarse = measureSource(grid((x) => slope(x)), PX, 1, road);
  assert.ok(fine.hillStations > 80 && coarse.hillStations > 80);
  assert.ok(fine.benchShare > 0.95, `bench on ${Math.round(100 * fine.benchShare)} % of the fine source's hillside points`);
  assert.ok(Math.abs(fine.benchMedianM - 8) <= 1.5, `bench ${fine.benchMedianM} m wide`);
  assert.equal(coarse.benchShare, 0, 'an even slope is no bench, however gentle the tolerance');
  assert.ok(fine.tiltMedian < 0.01 && coarse.tiltMedian > 0.25);
  const a = scoreSource(fine, 1); const b = scoreSource(coarse, 30);
  assert.ok(a.total >= 90 && b.total <= 30, `scores ${a.total} and ${b.total}`);
});

test('flat ground: no bench is asked for, and a coarse source is not ahead for being smooth', () => {
  const flat = grid(() => 100);
  const rippled = grid((x, y) => 100 + 0.01 * Math.sin(y / 1.5));
  const r = compareSources([
    { key: 'standard', label: 'Global 30 m', nativeResM: 30, heights: flat, px: PX, cellM: 1 },
    { key: 'mapterhorn', label: 'Mapterhorn', nativeResM: 1, heights: rippled, px: PX, cellM: 1 },
    { key: 'gpxz', label: 'GPXZ', nativeResM: NaN, heights: null, px: PX, cellM: 1, note: 'needs a GPXZ key' },
  ], road, PX);
  const by = Object.fromEntries(r.sources.map((s) => [s.key, s]));
  assert.equal(by.standard.score.weights.bench, 0);
  assert.ok(by.mapterhorn.score.total > by.standard.score.total, `${by.mapterhorn.score.total} > ${by.standard.score.total}`);
  assert.equal(r.best, 'mapterhorn');
  assert.equal(by.gpxz.score, null);
  // the page: self-contained, every source named, nothing loaded from elsewhere
  const html = qualityReportHtml(r, { center: { lat: 45.5, lng: 6.9 }, sideM: PX, roadCount: 1, generatedAt: '2026-11-11', appVersion: 'test' });
  assert.match(html, /^<!doctype html>/);
  for (const name of ['Global 30 m', 'Mapterhorn', 'GPXZ', 'needs a GPXZ key', 'Hill Road']) assert.ok(html.includes(name), name);
  assert.equal(/(src|href)="https?:/.test(html), false, 'no outside resource');
});

test('roads of the square: drivable ways in metres from its north-west corner; bridges, tunnels and paths left out', () => {
  const center = { lat: 45, lng: 7 }; const side = 512;
  const dLat = side / 2 / 111320; const dLng = dLat / Math.cos((45 * Math.PI) / 180);
  const way = (id, tags, pts) => ({ id, type: 'road', tags, geometry: pts.map(([lat, lng]) => ({ lat, lng })) });
  const roads = roadsInPatch([
    way('a', { highway: 'residential', name: 'A' }, [[45 + dLat, 7 - dLng], [45 - dLat, 7 + dLng]]),
    way('b', { highway: 'primary', bridge: 'yes' }, [[45, 7 - dLng], [45, 7 + dLng]]),
    way('c', { highway: 'footway' }, [[45, 7 - dLng], [45, 7 + dLng]]),
    way('d', { highway: 'tertiary' }, [[46, 7], [46.001, 7]]),
  ], center, side);
  assert.deepEqual(roads.map((r) => r.name), ['A']);
  const [[x0, y0], [x1, y1]] = roads[0].pts;
  assert.ok(Math.abs(x0) < 1e-6 && Math.abs(y0) < 1e-6 && Math.abs(x1 - side) < 1e-6 && Math.abs(y1 - side) < 1e-6);
});

test('no roads in the square: says so, and compares the sources on their ground alone', () => {
  const rough = (x, y) => 100 + 6 * Math.sin(x / 9) * Math.cos(y / 7) + 0.3 * Math.sin(x / 2.3 + y / 3.1);
  const coarseOf = (x, y) => { const X = Math.floor(x / 30) * 30 + 15; const Y = Math.floor(y / 30) * 30 + 15; return 100 + 6 * Math.sin(X / 9) * Math.cos(Y / 7); };
  const r = compareSources([
    { key: 'standard', label: 'Global 30 m', nativeResM: 30, heights: grid(rough), px: PX, cellM: 1 },
    { key: 'mapterhorn', label: 'Mapterhorn', nativeResM: 1, heights: grid(rough), px: PX, cellM: 1 },
    { key: 'gpxz', label: 'GPXZ', nativeResM: 1, heights: grid(coarseOf), px: PX, cellM: 1 },
  ], [], PX);
  assert.match(r.verdict, /No roads in this square/);
  assert.equal(r.best, 'mapterhorn');
  const by = Object.fromEntries(r.sources.map((s) => [s.key, s]));
  assert.ok(by.mapterhorn.score.total >= 90, `fine ground ${by.mapterhorn.score.total}`);
  // the user's island: a 1 m grid filled with 30 m blocks is not fine data, and it is flawed
  assert.ok(by.gpxz.g.terraced && by.gpxz.g.effectiveResM >= 25, JSON.stringify(by.gpxz.g));
  assert.ok(by.gpxz.score.detail <= 10 && by.gpxz.score.total <= 30, `blocks score ${by.gpxz.score.total}`);
  assert.match(by.gpxz.flaws.join(' '), /Terraced/);
  assert.deepEqual(by.mapterhorn.flaws, []);
  const html = qualityReportHtml(r, { center: { lat: 1, lng: 2 }, sideM: PX, roadCount: 0, generatedAt: '2026-11-13', appVersion: 'test' });
  assert.match(html, /Flaws in the ground/);
  assert.match(html, /coarse data on a 1 m grid/);
  assert.ok(!/call used/.test(html));
});

test('the ground\'s own measures: real detail, spikes, noise; a fine survey is clean', async () => {
  const { measureGround, cleanScore, flawsOf } = await import('../services/sourceQuality.js');
  const fine = (x, y) => 50 + 4 * Math.sin(x / 11) + 3 * Math.cos(y / 13) + 0.3 * Math.sin(x / 2.3 + y / 3.1);
  const g = measureGround(grid(fine), PX, 1);
  assert.ok(g.effectiveResM <= 2 && !g.terraced && g.seams.count === 0 && cleanScore(g) >= 95, JSON.stringify(g));
  // 30 m data resampled smoothly onto the 1 m grid: no flaw, but its detail is 30 m
  const knots = (x) => { const k = Math.floor(x / 30); const t = x / 30 - k; const f = (q) => 50 + 5 * Math.sin(q * 1.9); return f(k) * (1 - t) + f(k + 1) * t; };
  const smooth = measureGround(grid((x, y) => knots(x) + 0.5 * knots(y)), PX, 1);
  assert.ok(smooth.effectiveResM >= 20 && !smooth.terraced, JSON.stringify(smooth));
  // spikes
  const spiky = grid(fine); for (let k = 0; k < 60; k++) spiky[(20 + k * 3) * PX + 30 + k * 3] += 4;
  const sp = measureGround(spiky, PX, 1);
  assert.ok(sp.spikesPerHa > 5 && cleanScore(sp) < 85 && /Spikes/.test(flawsOf(sp).join(' ')), JSON.stringify(sp.spikesPerHa));
  // noise on gentle ground
  let seed = 7; const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647 - 0.5; };
  const noisy = measureGround(grid((x, y) => 50 + 0.01 * x + rnd() * 0.6), PX, 1);
  assert.ok(noisy.noiseM > 0.1 && /Noisy/.test(flawsOf(noisy).join(' ')), `grain ${noisy.noiseM}`);
  // a lake in the square is not a terrace
  const lake = measureGround(grid((x, y) => (Math.hypot(x - 128, y - 128) < 90 ? 40 : fine(x, y))), PX, 1);
  assert.ok(!lake.terraced && lake.water, JSON.stringify({ t: lake.terraced, w: lake.water, f: lake.flatShare }));
});

test('a raster is read between its pixels, not at the nearest one', async () => {
  const { bilinearAt } = await import('../services/sourceCompare.js');
  const ras = new Float32Array([0, 10, 20, 30]);   // 2 x 2
  assert.equal(bilinearAt(ras, 2, 2, 0, 0), 0);
  assert.equal(bilinearAt(ras, 2, 2, 0.5, 0), 5);
  assert.equal(bilinearAt(ras, 2, 2, 0.5, 0.5), 15);
  assert.equal(bilinearAt(ras, 2, 2, 1, 1), 30);
  assert.ok(Number.isNaN(bilinearAt(ras, 2, 2, 3, 0)), 'off the raster');
  assert.ok(Number.isNaN(bilinearAt(new Float32Array([0, -9999, 20, 30]), 2, 2, 0.5, 0.5, -9999)), 'beside no-data');
  // a coarse raster read onto a fine grid has no repeated rows
  const W = 8; const coarse = new Float32Array(W * W).map((_, i) => Math.sin(i % W) + Math.floor(i / W));
  const rows = []; for (let j = 0; j < 64; j++) rows.push(bilinearAt(coarse, W, W, 3.3, (j + 0.5) / 8 - 0.5));
  let repeats = 0; for (let j = 1; j < rows.length; j++) if (rows[j] === rows[j - 1]) repeats++;
  assert.ok(repeats <= 8, `${repeats} repeated rows`);
});

test('the flaws are marked where they are: spikes, a seam, terraced blocks, noisy patches', async () => {
  const { measureGround } = await import('../services/sourceQuality.js');
  const fine = (x, y) => 50 + 4 * Math.sin(x / 11) + 3 * Math.cos(y / 13) + 0.3 * Math.sin(x / 2.3 + y / 3.1);
  // a spike at (100.5, 60.5) and a seam: everything south of row 150 stands 0.4 m higher
  const h = grid((x, y) => fine(x, y) + (y > 150 ? 0.4 : 0)); h[60 * PX + 100] += 5;
  const g = measureGround(h, PX, 1);
  assert.ok(g.marks.spikes.some(([x, y]) => Math.abs(x - 100.5) < 1 && Math.abs(y - 60.5) < 1), JSON.stringify(g.marks.spikes.slice(0, 3)));
  assert.ok(g.seams.rows.some((y) => Math.abs(y - 150) <= 2) && g.seams.cols.length === 0, JSON.stringify(g.seams));
  // noise in the east half only
  let seed = 3; const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647 - 0.5; };
  const n = measureGround(grid((x, y) => 50 + 0.01 * y + (x > 128 ? rnd() * 0.8 : 0)), PX, 1);
  assert.ok(n.marks.noisy.length > 50 && n.marks.noisy.every(([x]) => x >= 112), `${n.marks.noisy.length} noisy blocks`);
  // terraces
  const t = measureGround(grid((x, y) => 20 + 3 * Math.sin(Math.floor(x / 30) * 0.7) + 2 * Math.cos(Math.floor(y / 30) * 0.9)), PX, 1);
  assert.ok(t.terraced && t.marks.terraces.length > 100, `${t.marks.terraces.length} terraced blocks`);
  const r = compareSources([{ key: 'gpxz', label: 'GPXZ', nativeResM: 1, heights: h, px: PX, cellM: 1 }], [], PX);
  const html = qualityReportHtml(r, { center: { lat: 1, lng: 2 }, sideM: PX, roadCount: 0, generatedAt: '2026-11-13', appVersion: 'test' });
  assert.match(html, /class="f-spike"/); assert.match(html, /class="f-seam"/);
});
