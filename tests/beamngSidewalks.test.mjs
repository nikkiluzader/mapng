import test from 'node:test';
import assert from 'node:assert/strict';

import { buildSidewalkMeshes, buildSidewalkRuns, sidewalkSides } from '../services/beamngSidewalks.js';

const street = (overrides = {}) => ({
  owner: 1, half: 4, highway: 'residential', urban: true, tags: { sidewalk: 'both' }, continuations: [],
  nodes: Array.from({ length: 21 }, (_, i) => [-100 + i * 10, 0, 5, 8]),
  ...overrides,
});

test('sidewalk tags decide the sides; untagged urban streets get both', () => {
  assert.deepEqual(sidewalkSides({ tags: { sidewalk: 'both' } }), { left: 2, right: 2 });
  assert.deepEqual(sidewalkSides({ tags: { sidewalk: 'left', 'sidewalk:width': '3' } }), { left: 3, right: 0 });
  assert.deepEqual(sidewalkSides({ tags: { sidewalk: 'separate' }, highway: 'residential', urban: true }), { left: 0, right: 0 });
  assert.deepEqual(sidewalkSides({ tags: { 'sidewalk:right': 'yes', 'sidewalk:left': 'no' } }), { left: 0, right: 2 });
  assert.deepEqual(sidewalkSides({ tags: {}, highway: 'residential', urban: true }), { left: 2, right: 2 });
  assert.deepEqual(sidewalkSides({ tags: {}, highway: 'residential', urban: false }), { left: 0, right: 0 });
});

test('runs follow the carriageway edge and stop short of a crossing road', () => {
  const cross = { owner: 2, half: 5, highway: 'secondary', urban: true, tags: { sidewalk: 'no' }, continuations: [],
    nodes: [[0, -100, 5, 10], [0, 100, 5, 10]] };
  const runs = buildSidewalkRuns([street(), cross]);
  assert.equal(runs.length, 4, 'two sides, split by the cross street');
  for (const run of runs) {
    assert.ok(run.points.every((p) => Math.abs(Math.abs(p[1]) - 4) < 1e-6), 'curb line at the carriageway edge');
    assert.ok(run.points.every((p) => Math.abs(p[0]) >= 5.5 - 1e-6), 'clear of the cross street + 0.5 m');
  }
});

test('the swept mesh has curb and slab parts, all above-ground faces pointing up or at the road', () => {
  const { meshes, triangles } = buildSidewalkMeshes([street()]);
  assert.equal(meshes.length, 1);
  assert.ok(triangles > 0);
  const geo = meshes[0].geometry;
  assert.deepEqual(meshes[0].material.map((m) => m.name), ['mapng_curbs', 'mapng_sidewalk']);
  const pos = geo.getAttribute('position').array;
  const zs = [];
  for (let i = 2; i < pos.length; i += 3) zs.push(pos[i]);
  assert.ok(Math.max(...zs) <= 5 + 0.15 + 2 * 0.015 + 1e-6, 'top of slab = road + curb + cross slope');
  assert.ok(Math.min(...zs) >= 5 - 0.1 - 1e-6, 'faces sink 10 cm below the road');
  // Slab triangles face up.
  const slab = geo.groups[1];
  for (let t = slab.start; t < slab.start + slab.count; t += 3) {
    const p = (k) => [pos[(t + k) * 3], pos[(t + k) * 3 + 1], pos[(t + k) * 3 + 2]];
    const [a, b, c] = [p(0), p(1), p(2)];
    const nz = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
    assert.ok(nz > 0, 'slab faces up');
  }
});
