import test from 'node:test';
import assert from 'node:assert/strict';

import { gradeGarageFootprints } from '../services/buildingFoundations.js';

test('a garage on a slope gets a flat pad blended back into the hillside', async () => {
  // 256 px over ~256 m, rising 0.1 m per px to the east
  const size = 256;
  const heightMap = new Float32Array(size * size);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) heightMap[y * size + x] = 10 + 0.1 * x;
  const bounds = { north: 0.0023, south: 0, east: 0.0023, west: 0 };
  const lng = (px) => (px / size) * 0.0023; const lat = (py) => 0.0023 - (py / size) * 0.0023;
  const ring = [[100, 100], [160, 100], [160, 140], [100, 140], [100, 100]].map(([x, y]) => ({ lat: lat(y), lng: lng(x) }));
  const garage = { type: 'building', tags: { building: 'parking' }, geometry: ring };
  const td = { width: size, height: size, bounds, heightMap, minHeight: 10, maxHeight: 10 + 0.1 * size, osmFeatures: [garage] };
  const out = await gradeGarageFootprints(td, (f) => f.tags.building === 'parking');
  const h = (x, y) => out.heightMap[y * size + x];
  // flat inside, at about the footprint's median ground
  assert.ok(Math.abs(h(110, 120) - h(150, 120)) < 1e-3, 'pad is flat');
  assert.ok(Math.abs(h(130, 120) - (10 + 0.1 * 130)) < 0.6, 'at the median ground');
  // far away untouched; the blend in between has no cliff
  assert.equal(h(10, 10), heightMap[10 * size + 10]);
  for (let x = 160; x < 200; x++) assert.ok(Math.abs(h(x + 1, 120) - h(x, 120)) < 0.6, `no step at x=${x}`);
  assert.notEqual(out.heightMap, heightMap, 'the input height map is not changed');
});
