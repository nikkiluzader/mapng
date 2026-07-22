import test from 'node:test';
import assert from 'node:assert/strict';
import {
  deriveCoordinateJunctionsGeoJson,
  osmRoadWidthsToGeoJson,
  resolveRoadDiagnosticWidth,
} from './cesiumRoadDiagnosticsAdapter.js';

const road = (id, geometry, tags = {}) => ({
  id,
  type: 'road',
  geometry: geometry.map(([lng, lat]) => ({ lng, lat })),
  tags: { highway: 'residential', ...tags },
});

test('resolves width using explicit, lanes, class and fallback priority', () => {
  assert.deepEqual(resolveRoadDiagnosticWidth({ highway: 'primary', width: '8 m', lanes: '9' }), {
    width: 8, source: 'explicit', confidence: 'declared', lanes: 9, invalidExplicitWidth: false,
  });
  assert.equal(resolveRoadDiagnosticWidth({ highway: 'primary', lanes: '2' }).width, 7);
  assert.equal(resolveRoadDiagnosticWidth({ highway: 'primary', lanes: '2' }).source, 'lanes-derived');
  assert.equal(resolveRoadDiagnosticWidth({ highway: 'secondary' }).width, 7);
  assert.equal(resolveRoadDiagnosticWidth({ highway: 'secondary' }).source, 'class-default');
  assert.equal(resolveRoadDiagnosticWidth({ highway: 'unclassified' }).source, 'fallback');
});

test('rejects an invalid explicit width and supports directional lane totals', () => {
  const width = resolveRoadDiagnosticWidth({
    highway: 'primary', width: '80', 'lanes:forward': '2', 'lanes:backward': '1',
  });
  assert.equal(width.width, 10.5);
  assert.equal(width.source, 'lanes-derived');
  assert.equal(width.invalidExplicitWidth, true);
});

test('creates read-only width diagnostics with source metadata', () => {
  const input = [road('12', [[18, 48], [18.1, 48.1]], { highway: 'service', width: '4.2' })];
  const snapshot = structuredClone(input);
  const result = osmRoadWidthsToGeoJson(input);
  assert.equal(result.features[0].properties.previewWidthMeters, 4.2);
  assert.equal(result.features[0].properties.previewWidthSource, 'explicit');
  assert.deepEqual(input, snapshot);
});

test('creates width previews for every highway class but keeps pedestrian ways out of motor junctions', () => {
  const allWidths = osmRoadWidthsToGeoJson([
    road('1', [[18, 48], [18.1, 48]], { highway: 'primary_link' }),
    road('2', [[18, 48.1], [18.1, 48.1]], { highway: 'track' }),
    road('3', [[18, 48.2], [18.1, 48.2]], { highway: 'footway' }),
    road('4', [[18, 48.3], [18.1, 48.3]], { highway: 'mystery_road' }),
  ]);
  assert.equal(allWidths.features.length, 4);
  assert.equal(allWidths.features.find((feature) => feature.properties.highway === 'footway').properties.highwayCategory, 'non-motorized');

  const junctions = deriveCoordinateJunctionsGeoJson([
    road('10', [[18, 48], [18.1, 48], [18.2, 48]]),
    road('11', [[18.1, 47.9], [18.1, 48]], { highway: 'footway' }),
  ]);
  assert.equal(junctions.features.length, 0);
});

test('detects a shared-vertex T-junction but ignores degree-2 continuation', () => {
  const tJunction = deriveCoordinateJunctionsGeoJson([
    road('1', [[18, 48], [18.1, 48], [18.2, 48]]),
    road('2', [[18.1, 47.9], [18.1, 48]]),
  ]);
  assert.equal(tJunction.features.length, 1);
  assert.equal(tJunction.features[0].properties.classification, 'T-junction');
  assert.equal(tJunction.features[0].properties.osmNodeId, null);
  assert.equal(tJunction.features[0].properties.identitySource, 'coordinate-derived');

  const continuation = deriveCoordinateJunctionsGeoJson([
    road('1', [[18, 48], [18.1, 48]]),
    road('2', [[18.1, 48], [18.2, 48]]),
  ]);
  assert.equal(continuation.features.length, 0);
});

test('does not create a marker for geometric crossings without a shared vertex', () => {
  const result = deriveCoordinateJunctionsGeoJson([
    road('1', [[18, 48], [18.2, 48.2]]),
    road('2', [[18, 48.2], [18.2, 48]]),
  ]);
  assert.equal(result.features.length, 0);
});

test('separates bridge, tunnel and layer contexts at identical coordinates', () => {
  const result = deriveCoordinateJunctionsGeoJson([
    road('1', [[18, 48], [18.1, 48], [18.2, 48]], { bridge: 'viaduct', layer: '1.0' }),
    road('2', [[18.1, 47.9], [18.1, 48]], { tunnel: 'culvert', layer: '-1' }),
  ]);
  assert.equal(result.features.length, 0);
});
