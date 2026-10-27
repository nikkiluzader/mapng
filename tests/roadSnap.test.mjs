import test from 'node:test';
import assert from 'node:assert/strict';

import { snapRoadsToTerrain } from '../services/roadSnap.js';
import { isGroundLevelRoad } from '../services/roadSmoother.js';

// 400 m square at 1 m/px: a hillside rising to the east (20 %) with a flat
// 10 m road bench cut into it, centred on column X_BENCH.
const N = 400;
const X_BENCH = 200;
const bounds = (() => {
  const dLat = 200 / 111320;
  const dLng = 200 / (111320 * Math.cos((45 * Math.PI) / 180));
  return { north: 45 + dLat, south: 45 - dLat, east: 8 + dLng, west: 8 - dLng };
})();
const lngAt = (x) => bounds.west + (x / (N - 1)) * (bounds.east - bounds.west);
const latAt = (y) => bounds.north - (y / (N - 1)) * (bounds.north - bounds.south);
const xAt = (lng) => ((lng - bounds.west) / (bounds.east - bounds.west)) * (N - 1);

function hillWithBench() {
  const hm = new Float32Array(N * N);
  const benchZ = 0.2 * X_BENCH;
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    hm[y * N + x] = Math.abs(x - X_BENCH) <= 5 ? benchZ : 0.2 * x;
  }
  return hm;
}

// A two-lane rural road drawn 4 m west of the bench, running north–south.
const road = (id, x, y0 = 20, y1 = 380, extra = {}) => ({
  id, type: 'road', tags: { highway: 'tertiary', lanes: '2', ...extra },
  geometry: Array.from({ length: 10 }, (_, i) => ({ lat: latAt(y0 + ((y1 - y0) * i) / 9), lng: lngAt(x) })),
});

test('a road drawn beside its cut moves onto it', () => {
  const r = road('r', X_BENCH - 4);
  const { features, stats } = snapRoadsToTerrain(hillWithBench(), N, N, bounds, [r], 1, isGroundLevelRoad);
  assert.equal(stats.movedRoads, 1);
  const mid = features[0].geometry.filter((p) => Math.abs((p.lat - latAt(200)) * 111320) < 100);
  assert.ok(mid.length > 0);
  for (const p of mid) assert.ok(Math.abs(xAt(p.lng) - X_BENCH) < 1, `node at x=${xAt(p.lng).toFixed(2)}`);
});

test('a road already on its cut stays put', () => {
  const r = road('r', X_BENCH);
  const { features, stats } = snapRoadsToTerrain(hillWithBench(), N, N, bounds, [r], 1, isGroundLevelRoad);
  assert.equal(stats.movedRoads, 0);
  assert.equal(features[0], r);
});

test('shared nodes stay; a signal on a moved node moves with it', () => {
  const r = road('r', X_BENCH - 4);
  // A side road joins at the north end; a signal sits on a mid node.
  const side = { id: 's', type: 'road', tags: { highway: 'residential' }, geometry: [r.geometry[0], { lat: r.geometry[0].lat, lng: lngAt(50) }] };
  const signal = { id: 'sig', type: 'street_furniture', tags: { highway: 'traffic_signals' }, geometry: [{ ...r.geometry[5] }] };
  const { features } = snapRoadsToTerrain(hillWithBench(), N, N, bounds, [r, side, signal], 1, isGroundLevelRoad);
  const moved = features[0];
  assert.deepEqual(moved.geometry[0], r.geometry[0], 'junction node unchanged');
  assert.equal(features[1], side, 'side road untouched');
  const sig = features[2].geometry[0];
  assert.ok(moved.geometry.some((p) => p.lat === sig.lat && p.lng === sig.lng), 'signal follows its node');
  assert.ok(Math.abs(xAt(sig.lng) - X_BENCH) < 1);
});

test('coarse rasters and bridges are left alone', () => {
  const hm = hillWithBench();
  const r = road('r', X_BENCH - 4);
  assert.equal(snapRoadsToTerrain(hm, N, N, bounds, [r], 10, isGroundLevelRoad).features[0], r);
  const bridge = road('b', X_BENCH - 4, 20, 380, { bridge: 'yes', layer: '1' });
  assert.equal(snapRoadsToTerrain(hm, N, N, bounds, [bridge], 1, isGroundLevelRoad).features[0], bridge);
});

test('a ramp on a narrow embankment stays on it, not on the field beside', () => {
  // a fill standing 4 m over flat ground, 12 m wide at its foot, its top
  // rounded off as 1 m lidar shows it: the field beside is the flatter
  // cross-section, 4 m down
  const hm = new Float32Array(N * N);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) hm[y * N + x] = Math.max(0, 4 - (4 / 6) * Math.abs(x - X_BENCH));
  const r = road('ramp', X_BENCH, 20, 380, { highway: 'motorway_link', lanes: '2', oneway: 'yes' });
  const { features } = snapRoadsToTerrain(hm, N, N, bounds, [r], 1, isGroundLevelRoad);
  for (const p of features[0].geometry) assert.ok(Math.abs(xAt(p.lng) - X_BENCH) < 1, `node at x=${xAt(p.lng).toFixed(2)}`);
});

test('a carriageway never slides onto the one beside it', () => {
  // flat ground east of a gentle bank: the road drawn on the bank would move
  // onto the flat, where the other carriageway already runs
  const hm = new Float32Array(N * N);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) hm[y * N + x] = x < X_BENCH + 3 ? 0.15 * (X_BENCH + 3 - x) : 0;
  const a = road('sb', X_BENCH, 20, 380, { highway: 'motorway', lanes: '2', oneway: 'yes' });
  const b = road('nb', X_BENCH + 10, 20, 380, { highway: 'motorway', lanes: '2', oneway: 'yes' });
  const alone = snapRoadsToTerrain(hm, N, N, bounds, [a], 1, isGroundLevelRoad).features[0];
  assert.ok(alone.geometry.some((p) => xAt(p.lng) > X_BENCH + 4), 'alone it moves onto the flat');
  const { features } = snapRoadsToTerrain(hm, N, N, bounds, [a, b], 1, isGroundLevelRoad);
  for (const p of features[0].geometry) assert.ok(xAt(p.lng) < X_BENCH + 2.5, `node at x=${xAt(p.lng).toFixed(2)}`);
});
