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
