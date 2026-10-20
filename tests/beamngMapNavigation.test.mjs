import test from 'node:test';
import assert from 'node:assert/strict';

import {
  collectGiveWayNodeKeys,
  geometryHasGiveWay,
  inferManualLaneData,
  inferRoadDrivability,
  parseMaxspeedMps,
} from '../services/beamngMapNavigation.js';

// Mirror of BeamNG's ge/map.lua lane decoding (0.40): lanesLeft/lanesRight
// become a '-'/'+' string by driving side, and a one-way whose lanes all
// decode as '-' (backward) is flipped. Returns travel along node order?
const decodeLikeBeamNG = ({ lanesLeft, lanesRight }, rightHandDrive, flipDirection = false) => {
  const lanes = rightHandDrive
    ? '+'.repeat(lanesLeft) + '-'.repeat(lanesRight)
    : '-'.repeat(lanesLeft) + '+'.repeat(lanesRight);
  const oneWay = !lanes.includes('-') || !lanes.includes('+');
  let flip = flipDirection;
  if (oneWay && lanes.startsWith('-')) flip = !flip;
  return { forward: (lanes.match(/\+/g) || []).length, backward: (lanes.match(/-/g) || []).length, flip };
};

test('one-way lanes decode as forward travel in both driving sides (BeamNG map.lua)', () => {
  for (const leftHandTraffic of [false, true]) {
    const lanes = inferManualLaneData('primary', { oneway: 'yes', lanes: '2' }, true, leftHandTraffic);
    const decoded = decodeLikeBeamNG(lanes, leftHandTraffic);
    assert.equal(decoded.forward, 2);
    assert.equal(decoded.flip, false, `oneway=yes must not be flipped (leftHandTraffic=${leftHandTraffic})`);
    // oneway=-1 sets flipDirection itself; BeamNG must keep it.
    assert.equal(decodeLikeBeamNG(lanes, leftHandTraffic, true).flip, true);
  }
});

test('asymmetric two-way lanes keep forward/backward counts in both driving sides', () => {
  for (const leftHandTraffic of [false, true]) {
    const lanes = inferManualLaneData('primary', { 'lanes:forward': '2', 'lanes:backward': '1' }, false, leftHandTraffic);
    const decoded = decodeLikeBeamNG(lanes, leftHandTraffic);
    assert.deepEqual([decoded.forward, decoded.backward, decoded.flip], [2, 1, false]);
  }
});

test('inferRoadDrivability ranks road classes for junction priority', () => {
  const order = ['motorway', 'primary', 'secondary', 'tertiary', 'unclassified', 'residential', 'living_street', 'service', 'track'];
  const values = order.map((h) => inferRoadDrivability(h));
  for (let i = 1; i < values.length; i++) assert.ok(values[i] < values[i - 1], `${order[i]} below ${order[i - 1]}`);
  assert.equal(inferRoadDrivability('primary_link'), inferRoadDrivability('primary'));
  assert.equal(inferRoadDrivability('primary', { access: 'private' }), 0.6);
});

test('parseMaxspeedMps reads numbers, units, zones and specials; skips implicit defaults', () => {
  assert.equal(parseMaxspeedMps({ maxspeed: '50' }), 13.889);
  assert.equal(parseMaxspeedMps({ maxspeed: '30 mph' }), 13.411);
  assert.equal(parseMaxspeedMps({ maxspeed: 'DE:zone30' }), 8.333);
  assert.equal(parseMaxspeedMps({ maxspeed: 'DE:zone:30' }), 8.333);
  assert.equal(parseMaxspeedMps({ maxspeed: 'walk' }), 1.944);
  assert.equal(parseMaxspeedMps({ maxspeed: 'none' }), 36.111);
  assert.equal(parseMaxspeedMps({ maxspeed: 'DE:urban' }), null);
  assert.equal(parseMaxspeedMps({ maxspeed: 'signals' }), null);
  assert.equal(parseMaxspeedMps({}), null);
});

test('give-way points lower the drivability of the way they sit on', () => {
  const road = { id: 'minor', type: 'road', tags: { highway: 'residential' }, geometry: [{ lat: 0.9, lng: 0.5 }, { lat: 0.55, lng: 0.5 }, { lat: 0.1, lng: 0.5 }] };
  const sign = { id: 'gw', type: 'street_furniture', tags: { highway: 'give_way' }, geometry: [{ lat: 0.55, lng: 0.5 }] };
  const keys = collectGiveWayNodeKeys([road, sign]);
  assert.equal(geometryHasGiveWay(road.geometry, keys), true);
  assert.equal(geometryHasGiveWay([{ lat: 0.2, lng: 0.2 }, { lat: 0.3, lng: 0.3 }], keys), false);
});
