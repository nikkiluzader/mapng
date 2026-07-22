import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildCompilerTerrainTriangleIndices,
  applyTerrainHeightsToCompilerPreview,
  countCompilerPreviewSurfaces,
  getCompilerPreviewTerrainSamplePoints,
  getCompilerTerrainGrid,
  normalizeCompilerJobId,
  offsetCompilerPreviewHeights,
  validateCompilerPreview,
} from './cesiumCompilerPreview.js';

test('normalizes only safe compiler job identifiers', () => {
  assert.equal(normalizeCompilerJobId(' job_abcdef123456 '), 'job_abcdef123456');
  assert.equal(normalizeCompilerJobId('../artifact.zip'), '');
});

test('applies one uniform display offset without deforming compiler surfaces', () => {
  const preview = {
    features: [{
      geometry: {
        type: 'MultiPolygon',
        coordinates: [[[[18, 48, 100], [18.1, 48, 101], [18, 48, 100]]]],
      },
    }],
  };
  const display = offsetCompilerPreviewHeights(preview, 0.15);
  assert.deepEqual(
    display.features[0].geometry.coordinates[0][0].map((position) => position[2]),
    [100.15, 101.15, 100.15],
  );
  assert.equal(preview.features[0].geometry.coordinates[0][0][0][2], 100);
});

test('drapes compiler surface positions onto sampled Cesium terrain', () => {
  const preview = {
    features: [{
      properties: { kind: 'road_surface' },
      geometry: {
        type: 'MultiPolygon',
        coordinates: [[[[18, 48, 100], [18.1, 48, 101], [18, 48, 100]]]],
      },
    }],
  };
  assert.deepEqual(getCompilerPreviewTerrainSamplePoints(preview), [
    { lng: 18, lat: 48 },
    { lng: 18.1, lat: 48 },
    { lng: 18, lat: 48 },
  ]);
  const display = applyTerrainHeightsToCompilerPreview(preview, [200, 201, 200], 0.15);
  assert.deepEqual(
    display.features[0].geometry.coordinates[0][0].map((position) => position[2]),
    [200.15, 201.15, 200.15],
  );
  assert.equal(display.features[0].properties.displayHeightMode, 'cesium-terrain-draped');
  assert.equal(preview.features[0].geometry.coordinates[0][0][0][2], 100);
  assert.equal(applyTerrainHeightsToCompilerPreview(preview, [200], 0.15), null);
});

test('validates a regular compiler terrain grid and triangulates it deterministically', () => {
  const terrain = {
    source: 'deformed_compiler_grid',
    width: 2,
    height: 2,
    vertices: [
      [18, 48, 100, 0],
      [18.1, 48, 101, 1],
      [18, 48.1, 99, -1],
      [18.1, 48.1, 100, 0],
    ],
  };
  assert.equal(getCompilerTerrainGrid({ terrain }), terrain);
  assert.deepEqual(buildCompilerTerrainTriangleIndices(2, 2), [0, 2, 1, 1, 2, 3]);
  assert.equal(getCompilerTerrainGrid({ terrain: { ...terrain, vertices: terrain.vertices.slice(1) } }), null);
  assert.equal(getCompilerTerrainGrid({ terrain: { ...terrain, sampleStride: 4 } }), null);
});

test('accepts only previews derived from compiled surface meshes', () => {
  const preview = validateCompilerPreview({
    type: 'FeatureCollection',
    features: [],
    preview: {
      geometrySource: 'compiled_surface_mesh',
      roadSurfaceCount: 3,
      junctionSurfaceCount: 2,
    },
  });
  assert.deepEqual(countCompilerPreviewSurfaces(preview), { roads: 3, junctions: 2, total: 5 });
  assert.throws(
    () => validateCompilerPreview({ type: 'FeatureCollection', features: [], preview: { geometrySource: 'osm' } }),
    /COMPILER_PREVIEW_NOT_COMPILED/,
  );
});
