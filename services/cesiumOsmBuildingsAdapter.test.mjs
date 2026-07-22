import test from 'node:test';
import assert from 'node:assert/strict';
import {
  applyTerrainHeightsToBuildingGeoJson,
  getBuildingTerrainSamplePoints,
  osmBuildingFeaturesToGeoJson,
  resolveCesiumBuildingHeight,
} from './cesiumOsmBuildingsAdapter.js';

test('uses height before levels and preserves polygon holes', () => {
  const result = osmBuildingFeaturesToGeoJson([{
    id: 'rel_42',
    type: 'building',
    geometry: [{ lat: 48, lng: 18 }, { lat: 48, lng: 18.1 }, { lat: 48.1, lng: 18.1 }],
    holes: [[{ lat: 48.01, lng: 18.01 }, { lat: 48.01, lng: 18.02 }, { lat: 48.02, lng: 18.02 }]],
    tags: { building: 'apartments', height: '12 m', 'building:levels': '8', name: 'Block A' },
  }]);

  assert.equal(result.features.length, 1);
  assert.equal(result.features[0].geometry.coordinates.length, 2);
  assert.deepEqual(result.features[0].geometry.coordinates[0][0], result.features[0].geometry.coordinates[0].at(-1));
  assert.equal(result.features[0].properties.osmId, 'relation/42');
  assert.equal(result.features[0].properties.previewHeightMeters, 12);
  assert.equal(result.features[0].properties.previewHeightSource, 'height');
  assert.equal(result.features[0].properties.previewHeightEstimated, false);
});

test('anchors building vertices and roofs to sampled absolute terrain heights', () => {
  const source = osmBuildingFeaturesToGeoJson([{
    id: '5',
    type: 'building',
    geometry: [{ lat: 48, lng: 18 }, { lat: 48, lng: 18.1 }, { lat: 48.1, lng: 18.1 }],
    tags: { building: 'yes', height: '10', min_height: '1' },
  }]);
  assert.deepEqual(getBuildingTerrainSamplePoints(source), [{ lng: 18.066666666666666, lat: 48.03333333333333 }]);

  const grounded = applyTerrainHeightsToBuildingGeoJson(source, [512]);
  assert.equal(grounded.features[0].geometry.coordinates[0][0][2], 513);
  assert.equal(grounded.features[0].properties.previewAbsoluteBaseMeters, 513);
  assert.equal(grounded.features[0].properties.previewAbsoluteRoofMeters, 522);
  assert.equal(source.features[0].geometry.coordinates[0][0].length, 2);
});

test('omits buildings without a finite terrain sample instead of letting them float', () => {
  const source = { type: 'FeatureCollection', features: [{ geometry: { coordinates: [] }, properties: {} }] };
  assert.deepEqual(applyTerrainHeightsToBuildingGeoJson(source, [undefined]).features, []);
});

test('derives estimated height from levels and roof height', () => {
  assert.deepEqual(resolveCesiumBuildingHeight({
    'building:levels': '3',
    'roof:height': '2',
    min_height: '1',
  }), {
    height: 11,
    minHeight: 1,
    roofHeight: 2,
    levels: 3,
    source: 'building:levels',
    estimated: true,
    clamped: false,
  });
});

test('uses a marked fallback and clamps unsafe heights', () => {
  assert.equal(resolveCesiumBuildingHeight({}).height, 6);
  assert.equal(resolveCesiumBuildingHeight({}).source, 'fallback');
  assert.equal(resolveCesiumBuildingHeight({}).estimated, true);
  assert.equal(resolveCesiumBuildingHeight({ height: '999' }).height, 150);
  assert.equal(resolveCesiumBuildingHeight({ height: '999' }).clamped, true);
  assert.equal(resolveCesiumBuildingHeight({ height: "30 ft" }).height, 9.144);
});

test('rejects malformed footprints and leaves input unchanged', () => {
  const input = [
    { id: '1', type: 'building', geometry: [{ lat: 48, lng: 18 }, { lat: 48, lng: 18.1 }] },
    { id: '2', type: 'road', geometry: [{ lat: 48, lng: 18 }, { lat: 48, lng: 18.1 }, { lat: 48.1, lng: 18.1 }] },
  ];
  const snapshot = structuredClone(input);
  assert.deepEqual(osmBuildingFeaturesToGeoJson(input).features, []);
  assert.deepEqual(input, snapshot);
});
