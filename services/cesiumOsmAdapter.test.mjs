import test from 'node:test';
import assert from 'node:assert/strict';
import {
  getCesiumRoadStyle,
  osmRoadFeaturesToGeoJson,
} from './cesiumOsmAdapter.js';

test('creates read-only GeoJSON for drivable OSM roads with diagnostics', () => {
  const input = [
    {
      id: '20_seg_1',
      type: 'road',
      geometry: [{ lat: 48.7, lng: 18.7 }, { lat: 48.8, lng: 18.8 }],
      tags: { highway: 'secondary', name: 'Main', lanes: 2, bridge: 'yes' },
    },
    {
      id: '10',
      type: 'road',
      geometry: [{ lat: 48.7, lng: 18.7 }, { lat: 48.71, lng: 18.71 }],
      tags: { highway: 'footway' },
    },
  ];
  const snapshot = structuredClone(input);

  const result = osmRoadFeaturesToGeoJson(input);

  assert.equal(result.type, 'FeatureCollection');
  assert.equal(result.features.length, 2);
  assert.deepEqual(result.features[1].geometry.coordinates, [[18.7, 48.7], [18.8, 48.8]]);
  assert.deepEqual(result.features[1].properties, {
    osmId: 'way/20',
    featureId: '20_seg_1',
    highway: 'secondary',
    highwayCategory: 'motorized',
    name: 'Main',
    lanes: '2',
    width: null,
    oneway: 'no',
    bridge: 'yes',
    tunnel: null,
    layer: '0',
  });
  assert.equal(result.features[0].properties.highway, 'footway');
  assert.equal(result.features[0].properties.highwayCategory, 'non-motorized');
  assert.deepEqual(input, snapshot);
});

test('rejects malformed geometry and non-road features', () => {
  const result = osmRoadFeaturesToGeoJson([
    { id: '1', type: 'building', geometry: [{ lat: 48, lng: 18 }, { lat: 49, lng: 19 }], tags: { highway: 'primary' } },
    { id: '2', type: 'road', geometry: [{ lat: 48, lng: 18 }], tags: { highway: 'primary' } },
    { id: '3', type: 'road', geometry: [{ lat: 48, lng: 18 }, { lat: NaN, lng: 19 }], tags: { highway: 'primary' } },
  ]);

  assert.deepEqual(result, { type: 'FeatureCollection', features: [] });
});

test('provides stable visual styles for each road class', () => {
  assert.deepEqual(getCesiumRoadStyle('motorway'), { color: '#E11D48', width: 6 });
  assert.deepEqual(getCesiumRoadStyle('service'), { color: '#94A3B8', width: 2.5 });
  assert.deepEqual(getCesiumRoadStyle('unknown'), { color: '#FFFFFF', width: 3 });
});

test('keeps link, track, pedestrian and unknown highway classes visible', () => {
  const classes = ['primary_link', 'track', 'cycleway', 'steps', 'mystery_road'];
  const result = osmRoadFeaturesToGeoJson(classes.map((highway, index) => ({
    id: String(index),
    type: 'road',
    geometry: [{ lat: 48, lng: 18 }, { lat: 48.1, lng: 18.1 }],
    tags: { highway },
  })));
  assert.deepEqual(result.features.map((feature) => feature.properties.highway).sort(), [...classes].sort());
});
