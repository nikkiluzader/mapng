import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildCompilerOsmGeoJson,
  getLocalMetricCrs,
  makeCompilerProjectId,
} from './geocrashCompiler.js';

test('chooses the local metric UTM CRS deterministically', () => {
  assert.equal(getLocalMetricCrs({ lat: 48.72, lng: 18.26 }), 'EPSG:32634');
  assert.equal(getLocalMetricCrs({ lat: -33.9, lng: 151.2 }), 'EPSG:32756');
});

test('converts only finite MapNG roads to compiler GeoJSON', () => {
  const result = buildCompilerOsmGeoJson([
    { id: 12, type: 'road', tags: { highway: 'secondary' }, geometry: [{ lng: 18, lat: 48 }, { lng: 18.1, lat: 48.1 }] },
    { id: 13, type: 'building', geometry: [{ lng: 18, lat: 48 }, { lng: 18.1, lat: 48.1 }] },
    { id: 14, type: 'road', geometry: [{ lng: Number.NaN, lat: 48 }, { lng: 18.1, lat: 48.1 }] },
  ]);
  assert.equal(result.features.length, 1);
  assert.equal(result.features[0].properties.highway, 'secondary');
});

test('creates a path-safe stable project identifier', () => {
  assert.equal(makeCompilerProjectId({ lat: 48.72, lng: 18.26 }), 'mapng_48_72000_18_26000');
});
