import test from 'node:test';
import assert from 'node:assert/strict';
import { lowerRaisedWater, isRiverWater } from '../services/waterBanks.js';

// a 400 m square at 1 m/px with a north-south creek down the middle
const N = 400; const bounds = { north: 0.0036, south: 0, west: 0, east: 0.0036 };
const lngAt = (x) => (x / (N - 1)) * 0.0036;
const creek = { type: 'water', tags: { waterway: 'stream' }, geometry: [{ lat: 0.0036, lng: lngAt(200) }, { lat: 0, lng: lngAt(200) }] };
const grid = (fn) => { const h = new Float32Array(N * N); for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) h[y * N + x] = fn(x, y); return h; };

test('a creek on a tree-top ridge comes down to its banks', () => {
  // fields at 1 m, the wooded corridor (±30 m) at 10 m
  const h = grid((x) => (Math.abs(x - 200) < 30 ? 10 : 1));
  const r = lowerRaisedWater(h, N, N, bounds, [creek], 1);
  assert.ok(r.cells > 0);
  assert.ok(h[200 * N + 200] < 2, `creek at ${h[200 * N + 200]}`);
  assert.ok(Math.abs(h[200 * N + 20] - 1) < 1e-6, 'far fields untouched');
});

test('a creek in a real valley is left alone', () => {
  const h = grid((x) => 5 + Math.abs(x - 200) * 0.1);   // V valley, creek at the bottom
  const before = h.slice();
  const r = lowerRaisedWater(h, N, N, bounds, [creek], 1);
  assert.equal(r.cells, 0);
  assert.deepEqual(h, before);
});

test('lakes and ponds are not river water', () => {
  assert.equal(isRiverWater({ type: 'water', tags: { natural: 'water', water: 'pond' } }), false);
  assert.equal(isRiverWater({ type: 'water', tags: { natural: 'water', water: 'river' } }), true);
  assert.equal(isRiverWater({ type: 'water', tags: { waterway: 'stream' } }), true);
});
