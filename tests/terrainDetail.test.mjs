import test from 'node:test';
import assert from 'node:assert/strict';

import { addFineGroundDetail, reliefAt } from '../services/terrainDetail.js';

const W = 200, H = 200;            // 200 m at 1 m
const B = { north: 0.0009, south: -0.0009, west: 0.0, east: 0.0018 };
const flat = () => new Float32Array(W * H).fill(100);
const lng = (x) => B.west + (x / W) * (B.east - B.west);
const lat = (y) => B.north - (y / H) * (B.north - B.south);
const sq = (x0, y0, x1, y1, tags, type) => ({ type, tags, geometry: [{ lat: lat(y0), lng: lng(x0) }, { lat: lat(y0), lng: lng(x1) }, { lat: lat(y1), lng: lng(x1) }, { lat: lat(y1), lng: lng(x0) }, { lat: lat(y0), lng: lng(x0) }] });
const std = (h, x0, y0, x1, y1) => { let s = 0, s2 = 0, c = 0; for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) { const v = h[y * W + x] - 100; s += v; s2 += v * v; c++; } return Math.sqrt(s2 / c - (s / c) ** 2); };

test('deterministic, and the input heightmap is left as it was', () => {
  const h = flat();
  const a = addFineGroundDetail({ heightMap: h, width: W, height: H, bounds: B, metersPerPixel: 1, osmFeatures: [] });
  const b = addFineGroundDetail({ heightMap: h, width: W, height: H, bounds: B, metersPerPixel: 1, osmFeatures: [] });
  assert.deepEqual(a.heightMap, b.heightMap);
  assert.ok(h.every((v) => v === 100));
  assert.ok(a.stats.maxAdd > 0.05 && a.stats.maxAdd < 1.5, `max ${a.stats.maxAdd}`);
});

test('nothing on roads, buildings or water; woods rougher than fields', () => {
  const features = [
    sq(0, 0, 100, 100, { natural: 'wood' }, 'vegetation'),
    sq(100, 0, 200, 100, { landuse: 'farmland' }, 'landuse'),
    sq(20, 120, 60, 160, { building: 'yes' }, 'building'),
    sq(120, 120, 180, 180, { natural: 'water' }, 'water'),
    { type: 'road', tags: { highway: 'residential' }, geometry: [{ lat: lat(190), lng: lng(0) }, { lat: lat(190), lng: lng(200) }] },
  ];
  const { heightMap: h } = addFineGroundDetail({ heightMap: flat(), width: W, height: H, bounds: B, metersPerPixel: 1, osmFeatures: features });
  for (const [x, y] of [[40, 140], [150, 150], [100, 190]]) assert.equal(h[y * W + x], 100, `touched at ${x},${y}`);
  assert.ok(std(h, 10, 10, 90, 90) > 3 * std(h, 110, 10, 190, 90), 'woods rougher than farmland');
});

test('neighbouring tiles match along their shared edge (world-coordinate relief)', () => {
  const span = B.east - B.west;
  const right = { ...B, west: B.east, east: B.east + span };
  const a = addFineGroundDetail({ heightMap: flat(), width: W, height: H, bounds: B, metersPerPixel: 1, osmFeatures: [] }).heightMap;
  const b = addFineGroundDetail({ heightMap: flat(), width: W, height: H, bounds: right, metersPerPixel: 1, osmFeatures: [] }).heightMap;
  let maxJump = 0; for (let y = 0; y < H; y++) maxJump = Math.max(maxJump, Math.abs(a[y * W + W - 1] - b[y * W]));
  assert.ok(maxJump < 0.15, `jump across the seam ${maxJump.toFixed(3)} m`);
  assert.ok(Math.abs(reliefAt(1234.5, 678.9) - reliefAt(1234.5, 678.9)) === 0);
});

test('a mapped cliff the data smeared into a ramp becomes a step; the wrong way round, nothing', async () => {
  const { sharpenCliffs } = await import('../services/terrainDetail.js');
  const ramp = new Float32Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) ramp[y * W + x] = x < 85 ? 100 : x > 115 ? 80 : 100 - (20 * (x - 85)) / 30;
  const line = (ys) => ({ type: 'cliff', tags: { natural: 'cliff' }, geometry: ys.map((y) => ({ lat: lat(y), lng: lng(100) })) });
  // drawn northwards: its right is east, the low side
  const r = sharpenCliffs({ heightMap: ramp, width: W, height: H, bounds: B, metersPerPixel: 1, osmFeatures: [line([190, 10])] });
  assert.equal(r.cliffs, 1);
  const at = (x) => r.heightMap[100 * W + x];
  assert.ok(at(95) > 99, `top held: ${at(95).toFixed(2)}`);
  assert.ok(at(110) < 81, `foot level: ${at(110).toFixed(2)}`);
  assert.ok(Math.abs(at(60) - 100) < 1e-4 && Math.abs(at(140) - 80) < 1e-4, 'nothing changes past the reach');
  // drawn southwards, its right is the high side: the data disagrees, left alone
  const w = sharpenCliffs({ heightMap: ramp, width: W, height: H, bounds: B, metersPerPixel: 1, osmFeatures: [line([10, 190])] });
  assert.equal(w.cliffs, 0);
  assert.deepEqual(w.heightMap, ramp);
});

test('a cliff on a curved slope, or two close together, never overshoots its own top', async () => {
  const { sharpenCliffs } = await import('../services/terrainDetail.js');
  const hill = new Float32Array(W * H);   // concave rise 0 -> 100 m over x 60..140, flat top after
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const t = Math.min(1, Math.max(0, (x - 60) / 80)); hill[y * W + x] = 100 * Math.sin(t * Math.PI / 2); }
  // drawn southwards, the right is west: the low side
  const line = (x) => ({ type: 'cliff', tags: { natural: 'cliff' }, geometry: [{ lat: lat(10), lng: lng(x) }, { lat: lat(190), lng: lng(x) }] });
  const r = sharpenCliffs({ heightMap: hill, width: W, height: H, bounds: B, metersPerPixel: 1, osmFeatures: [line(110), line(120)] });
  assert.ok(r.cliffs >= 1);
  let max = -Infinity; for (let x = 0; x < W; x++) max = Math.max(max, r.heightMap[100 * W + x]);
  assert.ok(max <= 100 + 1e-3, `peak ${max.toFixed(2)} m above a 100 m top`);
  for (let x = 1; x < W; x++) assert.ok(r.heightMap[100 * W + x] >= r.heightMap[100 * W + x - 1] - 1e-3, `not monotonic at ${x}`);
});

test('no cliff step where a road crosses the cliff; in place gives the same heights as a copy', async () => {
  const { sharpenCliffs } = await import('../services/terrainDetail.js');
  const ramp = new Float32Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) ramp[y * W + x] = x < 85 ? 100 : x > 115 ? 80 : 100 - (20 * (x - 85)) / 30;
  const cliff = { type: 'cliff', tags: { natural: 'cliff' }, geometry: [{ lat: lat(190), lng: lng(100) }, { lat: lat(10), lng: lng(100) }] };
  const road = { type: 'road', tags: { highway: 'track' }, geometry: [{ lat: lat(100), lng: lng(0) }, { lat: lat(100), lng: lng(200) }] };
  const a = addFineGroundDetail({ heightMap: ramp, width: W, height: H, bounds: B, metersPerPixel: 1, osmFeatures: [cliff, road] });
  assert.equal(a.stats.cliffs, 1);
  // on the road the ground is the data's ramp; 60 m along the cliff, the step
  assert.ok(Math.abs(a.heightMap[100 * W + 95] - ramp[100 * W + 95]) < 0.05, `on the road ${a.heightMap[100 * W + 95].toFixed(2)}`);
  assert.ok(a.heightMap[40 * W + 95] > 98.5, `away from it ${a.heightMap[40 * W + 95].toFixed(2)}`);
  const copy = Float32Array.from(ramp);
  const b = addFineGroundDetail({ heightMap: copy, width: W, height: H, bounds: B, metersPerPixel: 1, osmFeatures: [cliff, road], inPlace: true });
  assert.equal(b.heightMap, copy);
  assert.deepEqual(b.heightMap, a.heightMap);
  assert.ok(sharpenCliffs);
});
