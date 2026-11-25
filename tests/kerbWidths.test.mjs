import test from 'node:test';
import assert from 'node:assert/strict';
import { measureKerbWidths, kerbMeasurable } from '../services/kerbWidths.js';
import { measureStreetWidths } from '../services/streetWidths.js';
import { estimateRoadCrossSection } from '../services/roadWidth.js';

// metres -> lat/lng near the equator
const K = 1 / 111320;
const P = (x, y) => ({ lat: y * K, lng: x * K });
const line = (pts) => pts.map(([x, y]) => P(x, y));
const street = (tags = {}, y = 0) => ({ id: 'way_s', type: 'road', tags: { highway: 'tertiary', ...tags }, geometry: line([[-100, y], [100, y]]) });
const kerb = (y, x0 = -100, x1 = 100, tags = {}) => ({ type: 'barrier', tags: { barrier: 'kerb', ...tags }, geometry: line([[x0, y], [x1, y]]) });

test('kerb widths: a street between kerbs mapped both sides takes their distance, kerb to kerb', () => {
  const out = measureKerbWidths([street(), kerb(3.7), kerb(-3.7)]);
  const s = out.features[0];
  assert.equal(s.tags['mapng:carriageway_width'], '7.4');
  assert.equal(s.tags['mapng:width_source'], 'kerb');
  assert.equal(out.measured.length, 1);
  // (off-centre: the mapped line nearer one kerb, the width still kerb to kerb)
  const off = measureKerbWidths([street({}, 1), kerb(3.7), kerb(-3.7)]).features[0];
  assert.equal(off.tags['mapng:carriageway_width'], '7.4');
  // roadWidth builds the street that wide
  const cs = estimateRoadCrossSection(s.tags, 'tertiary', false, { urban: true });
  assert.ok(Math.abs(2 * cs.carriagewayHalfWidth - 7.4) < 0.05, `drawn ${2 * cs.carriagewayHalfWidth}`);
});

test('kerb widths: one side only, a kerb across the street, a tagged width, a bridge: left alone', () => {
  assert.equal(measureKerbWidths([street(), kerb(3.7)]).features[0].tags['mapng:carriageway_width'], undefined, 'one side');
  // kerbs across the street (side streets' mouths, driveways) are no edge of it
  const across = [];
  for (let x = -90; x <= 90; x += 10) across.push({ type: 'barrier', tags: { barrier: 'kerb' }, geometry: line([[x, -6], [x, 6]]) });
  assert.equal(measureKerbWidths([street(), ...across]).features[0].tags['mapng:carriageway_width'], undefined, 'across');
  assert.equal(measureKerbWidths([street({ width: '6' }), kerb(3.7), kerb(-3.7)]).features[0].tags['mapng:carriageway_width'], undefined, 'width tagged');
  assert.ok(!kerbMeasurable({ highway: 'tertiary', bridge: 'yes' }));
  assert.ok(!kerbMeasurable({ highway: 'footway' }));
  assert.ok(!kerbMeasurable({ highway: 'service', service: 'parking_aisle' }));
});

test('kerb widths: a road area (area:highway) is a kerb too; a traffic island bounds a one-way carriageway only', () => {
  const area = { type: 'landuse', tags: { 'area:highway': 'tertiary' }, geometry: line([[-100, -4], [100, -4], [100, 4], [-100, 4], [-100, -4]]) };
  assert.equal(measureKerbWidths([street(), area]).features[0].tags['mapng:carriageway_width'], '8.0');
  // a one-way carriageway at y = 0 between a kerb at -3.5 and an island at +3 .. +5 (its twin beyond, kerb at +11)
  const island = { type: 'landuse', tags: { 'area:highway': 'traffic_island' }, geometry: line([[-100, 3], [100, 3], [100, 5], [-100, 5], [-100, 3]]) };
  const one = measureKerbWidths([street({ oneway: 'yes' }), kerb(-3.5), kerb(11), island]).features[0];
  assert.equal(one.tags['mapng:carriageway_width'], '6.5');
  // a two-way road's line runs through its islands: they are not its kerbs
  const two = measureKerbWidths([street(), kerb(-3.5), kerb(3.5), { ...island, geometry: line([[-100, -1], [100, -1], [100, 1], [-100, 1], [-100, -1]]) }]).features[0];
  assert.equal(two.tags['mapng:carriageway_width'], '7.0');
});

test('kerb widths come before the buildings: a street measured between its kerbs is not measured again between walls', () => {
  const feats = [street({ highway: 'residential' }), kerb(3.6), kerb(-3.6)];
  for (let x = -100; x < 100; x += 12) {
    feats.push({ type: 'building', tags: { building: 'house' }, geometry: line([[x, 9], [x + 11, 9], [x + 11, 19], [x, 19]]) });
    feats.push({ type: 'building', tags: { building: 'house' }, geometry: line([[x, -19], [x + 11, -19], [x + 11, -9], [x, -9]]) });
  }
  const out = measureStreetWidths(measureKerbWidths(feats).features).features[0];
  assert.equal(out.tags['mapng:carriageway_width'], '7.2');
  assert.equal(out.tags['mapng:width_source'], 'kerb');
});
