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

test('no roads in the square: says so, scores nothing', () => {
  const r = compareSources([{ key: 'standard', label: 'Global 30 m', nativeResM: 30, heights: grid(() => 1), px: PX, cellM: 1 }], [], PX);
  assert.equal(r.best, null);
  assert.match(r.verdict, /No roads/);
});
