import test from 'node:test';
import assert from 'node:assert/strict';

import { parseOverpassResponse } from '../services/osm.js';
import { OSM_FILTER, buildOverpassQuery } from '../services/overpassQuery.js';
import { railKindOf, railHalfWidth, gaugeOf, tracksOf, railSegmentsFrom, streetRunningTest } from '../services/railways.js';

const line = (id, tags, pts) => ({ type: 'way', id, tags, geometry: pts.map(([lng, lat]) => ({ lat, lon: lng })) });
const bounds = { north: 1, south: 0, east: 1, west: 0 };

test('the Overpass query and the tile filter ask for the active railway kinds only', () => {
  const asked = OSM_FILTER.wayTags.filter(([k]) => k === 'railway').map(([, v]) => v).sort();
  assert.deepEqual(asked, ['funicular', 'light_rail', 'monorail', 'narrow_gauge', 'rail', 'subway', 'tram']);
  const q = buildOverpassQuery({ south: 0, west: 0, north: 1, east: 1 });
  assert.match(q, /way\["railway"="rail"\]\(0,0,1,1\);/);
  assert.doesNotMatch(q, /abandoned|disused/);
});

test('railKindOf: active lines in, lifecycle and underground subways out', () => {
  assert.equal(railKindOf({ railway: 'rail' }), 'rail');
  assert.equal(railKindOf({ railway: 'tram' }), 'tram');
  assert.equal(railKindOf({ railway: 'abandoned' }), null);
  assert.equal(railKindOf({ railway: 'construction', construction: 'rail' }), null);
  assert.equal(railKindOf({ railway: 'rail', disused: 'yes' }), null);
  assert.equal(railKindOf({ railway: 'platform' }), null);
  assert.equal(railKindOf({ railway: 'rail', area: 'yes' }), null);
  // a subway: only where it is above ground
  assert.equal(railKindOf({ railway: 'subway', tunnel: 'yes', layer: '-1' }), null);
  assert.equal(railKindOf({ railway: 'subway', layer: '-2' }), null);
  assert.equal(railKindOf({ railway: 'subway', bridge: 'viaduct', layer: '1' }), 'subway');
  // a tunnel on a main line is built
  assert.equal(railKindOf({ railway: 'rail', tunnel: 'yes' }), 'rail');
});

test('a railway way becomes a railway feature with its tags, clipped as a line', () => {
  const tags = { railway: 'rail', bridge: 'yes', layer: '1', gauge: '1435', electrified: 'contact_line', tracks: '2', usage: 'main', name: 'Main Line', 'bridge:structure': 'truss' };
  const features = parseOverpassResponse({ elements: [
    line(1, tags, [[-0.5, 0.5], [0.5, 0.5], [1.5, 0.5]]),
    line(2, { railway: 'disused' }, [[0.1, 0.1], [0.9, 0.1]]),
    line(3, { railway: 'subway', tunnel: 'yes', layer: '-1' }, [[0.1, 0.2], [0.9, 0.2]]),
  ] }, bounds);
  const rail = features.filter((f) => f.type === 'railway');
  assert.equal(rail.length, 1);
  assert.deepEqual(rail[0].tags, tags);
  assert.ok(rail[0].geometry.every((p) => p.lng >= 0 && p.lng <= 1), 'clipped to the map');
  assert.equal(rail[0].geometry.length, 3);
  assert.ok(!features.some((f) => f.type === 'road'), 'no road made of it');
});

test('a street way carrying a tram is both a road and a railway', () => {
  const features = parseOverpassResponse({ elements: [
    line(5, { highway: 'residential', railway: 'tram', name: 'High Street' }, [[0.1, 0.5], [0.9, 0.5]]),
  ] }, bounds);
  assert.equal(features.filter((f) => f.type === 'road').length, 1);
  const tram = features.filter((f) => f.type === 'railway');
  assert.equal(tram.length, 1);
  assert.notEqual(tram[0].id.replace(/_seg_\d+$/, ''), '5', 'its own id');
});

test('track widths, gauges and counts from the tags, with fallbacks', () => {
  assert.equal(gaugeOf({}), 1.435);
  assert.equal(gaugeOf({ gauge: '1000' }), 1);
  assert.equal(gaugeOf({ gauge: '1435;1668' }), 1.435);
  assert.equal(gaugeOf({ railway: 'narrow_gauge' }), 1);
  assert.equal(gaugeOf({ gauge: 'standard' }), 1.435);
  assert.equal(tracksOf({}), 1);
  assert.equal(tracksOf({ tracks: '2' }), 2);
  assert.equal(tracksOf({ tracks: 'lots' }), 1);
  const one = railHalfWidth({ railway: 'rail' });
  const two = railHalfWidth({ railway: 'rail', tracks: '2' });
  assert.ok(one > 1.5 && one < 2.5, `single track half width ${one}`);
  assert.ok(Math.abs(two - one - 2) < 1e-9, 'a second track 4 m over');
});

test('rail segments for the structure graph; street-running trams left to the street', () => {
  const ll = (x, y) => ({ lat: y / 111320, lng: x / 111320 });
  const f = (id, tags, pts) => ({ id: String(id), type: 'railway', tags, geometry: pts.map(([x, y]) => ll(x, y)) });
  const features = [
    f(1, { railway: 'rail', bridge: 'yes', layer: '1' }, [[0, 0], [100, 0]]),
    f(2, { railway: 'tram' }, [[0, 50], [200, 50]]),          // down the middle of a street
    f(3, { railway: 'tram' }, [[0, -80], [200, -80]]),        // on its own right of way
    { id: '9', type: 'road', tags: { highway: 'primary' }, geometry: [ll(-10, 50), ll(210, 50)] },
  ];
  const project = (lat, lng) => [lng * 111320, lat * 111320];
  const streetRunning = streetRunningTest([{ xy: [[-10, 50], [210, 50]], half: 7 }], project);
  const segs = railSegmentsFrom(features, { streetRunning });
  assert.deepEqual(segs.map((s) => s.sourceFeature.id), ['1', '3']);
  assert.equal(segs[0].highway, 'railway:rail');
  assert.equal(segs[0].rail, 'rail');
  assert.equal(segs[0].layer, 1);
});
