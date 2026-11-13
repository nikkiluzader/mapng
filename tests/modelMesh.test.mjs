import test from 'node:test';
import assert from 'node:assert/strict';
import { meshPlan, autoStride, strideOf, maxMeshResolutionFor, MESH_STRIDES } from '../services/modelMesh.js';

test('a spacing, its points and its size', () => {
  const p = meshPlan(2048, 1, 2);
  assert.equal(p.spacingM, 2); assert.equal(p.side, 1024); assert.equal(p.points, 1024 * 1024); assert.equal(p.tooBig, false);
  assert.ok(p.bytes > 45e6 && p.bytes < 65e6);
  // a 16 km map: every height is 268 million points, refused; every 16th is a mesh of a million
  assert.equal(meshPlan(16384, 1, 1).tooBig, true);
  assert.equal(meshPlan(16384, 1, 16).side, 1024);
  // 2 m a pixel: the spacing is in metres, not heights
  assert.equal(meshPlan(4096, 2, 4).spacingM, 8);
});

test('Auto is the finest spacing a mesh of about four million points allows', () => {
  assert.equal(autoStride(512), 1); assert.equal(autoStride(2048), 1); assert.equal(autoStride(4096), 2); assert.equal(autoStride(8192), 4); assert.equal(autoStride(16384), 8);
  assert.equal(strideOf('auto', 8192), 4); assert.equal(strideOf('2', 8192), 2); assert.equal(strideOf('3', 8192), 4, 'not an offered spacing: auto');
});

test('the export thins by exactly the stride asked for', () => {
  // (export3d.js: stride = ceil(size / maxMeshResolution))
  for (const size of [512, 1024, 2048, 4096, 8192, 16384]) for (const s of MESH_STRIDES) {
    assert.equal(Math.max(1, Math.ceil(size / maxMeshResolutionFor(size, s))), s, `${size} px, every ${s}`);
  }
});
