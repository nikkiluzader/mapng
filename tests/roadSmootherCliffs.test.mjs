import test from 'node:test';
import assert from 'node:assert/strict';
import { smoothRoadsInHeightmap } from '../services/roadSmoother.js';

// a 512 m square at 1 m, one road along y = 0 from x = -200 to x = 200
const N = 513; const SIZE = 512; const DEG = SIZE / 111320;
const bounds = { south: -DEG / 2, north: DEG / 2, west: -DEG / 2, east: DEG / 2 };
const ll = (x, y) => ({ lat: (y / SIZE) * DEG, lng: (x / SIZE) * DEG });
const road = (tags = { highway: 'unclassified' }) => [{ id: 'r', type: 'road', tags, geometry: [-200, -100, 0, 100, 200].map((x) => ll(x, 0)) }];
const grid = (h) => {
  const hm = new Float32Array(N * N);
  for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) hm[r * N + c] = h((c / (N - 1) - 0.5) * SIZE, (0.5 - r / (N - 1)) * SIZE);
  return hm;
};
const at = (hm, x, y) => hm[Math.round((0.5 - y / SIZE) * (N - 1)) * N + Math.round((x / SIZE + 0.5) * (N - 1))];

test('an isolated step in flat ground under a road (a structure bare earth took out) is lifted on a fill', () => {
  const h = (x) => (x < 0 ? 10 : 18);           // flat, an 8 m wall at x = 0, flat
  const hm = grid(h);
  smoothRoadsInHeightmap(hm, N, N, bounds, road(), 1, { fine: true });
  assert.ok(at(hm, -20, 0) > 13, `low side lifted near the step: ${at(hm, -20, 0).toFixed(2)}`);
});

test('a road climbing a steep hillside gets no fake embankment', () => {
  const h = (x) => 100 + 0.4 * x;               // a 40% slope the whole way
  const raw = grid(h); const hm = raw.slice();
  smoothRoadsInHeightmap(hm, N, N, bounds, road(), 1, { fine: true });
  let worst = 0;
  for (let x = -180; x <= 180; x += 5) worst = Math.max(worst, at(hm, x, 0) - at(raw, x, 0));
  assert.ok(worst < 3, `raised ${worst.toFixed(2)} m above the hillside`);
});

test('fine mode reshapes less terrain than coarse mode on a rolling road', () => {
  const h = (x) => 50 + 3 * Math.sin(x / 25);    // real 25 m rolls a 30 m smoothing would shave
  const raw = grid(h);
  const changed = (fine) => {
    const hm = raw.slice();
    smoothRoadsInHeightmap(hm, N, N, bounds, road(), 1, { fine });
    let sum = 0; for (let i = 0; i < hm.length; i++) sum += Math.abs(hm[i] - raw[i]);
    return sum;
  };
  assert.ok(changed(true) < changed(false), 'fine moves less ground');
});
