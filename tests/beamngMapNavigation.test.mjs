import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildManualMapNavigationData,
  collectGiveWayNodeKeys,
  geometryHasGiveWay,
  inferManualLaneData,
  inferRoadDrivability,
  parseMaxspeedMps,
} from '../services/beamngMapNavigation.js';

function makeTerrainData(osmFeatures = []) {
  const width = 8;
  const height = 8;
  return {
    width,
    height,
    minHeight: 0,
    maxHeight: 100,
    heightMap: new Float32Array(width * height).fill(10),
    bounds: {
      north: 1,
      south: 0,
      west: 0,
      east: 1,
    },
    osmFeatures,
  };
}

test('buildManualMapNavigationData returns empty data for non-manual road modes', () => {
  const terrainData = makeTerrainData([
    {
      id: 'r1',
      type: 'road',
      tags: { highway: 'primary' },
      geometry: [
        { lat: 0.8, lng: 0.2 },
        { lat: 0.2, lng: 0.8 },
      ],
    },
  ]);

  const navData = buildManualMapNavigationData(terrainData, 1, 'decal');
  assert.deepEqual(navData, { segments: {}, waypoints: [] });
});

test('buildManualMapNavigationData creates segments and BeamNGWaypoint nodes for architect mode', () => {
  const terrainData = makeTerrainData([
    {
      id: 'r1',
      type: 'road',
      tags: { highway: 'primary', oneway: 'yes' },
      geometry: [
        { lat: 0.75, lng: 0.25 },
        { lat: 0.5, lng: 0.5 },
        { lat: 0.25, lng: 0.75 },
      ],
    },
  ]);

  const navData = buildManualMapNavigationData(terrainData, 1, 'architect');
  const segmentKeys = Object.keys(navData.segments);

  assert.ok(segmentKeys.length >= 1);
  assert.ok(navData.waypoints.length >= 2);

  const firstSegment = navData.segments[segmentKeys[0]];
  assert.equal(firstSegment.oneWay, true);
  assert.ok(Array.isArray(firstSegment.nodes));
  assert.ok(firstSegment.nodes.length >= 2);

  const firstWaypoint = navData.waypoints[0];
  assert.equal(firstWaypoint.class, 'BeamNGWaypoint');
  assert.equal(firstWaypoint.__parent, 'AIWaypointsGroup');
});

test('buildManualMapNavigationData marks reverse one-way segments with flipDirection', () => {
  const terrainData = makeTerrainData([
    {
      id: 'r1',
      type: 'road',
      tags: { highway: 'secondary', oneway: '-1' },
      geometry: [
        { lat: 0.7, lng: 0.2 },
        { lat: 0.3, lng: 0.8 },
      ],
    },
  ]);

  const navData = buildManualMapNavigationData(terrainData, 1, 'mesh');
  const segment = navData.segments[Object.keys(navData.segments)[0]];

  assert.equal(segment.oneWay, true);
  assert.equal(segment.flipDirection, true);
});

test('buildManualMapNavigationData emits manual lane counts for two-way roads', () => {
  const terrainData = makeTerrainData([
    {
      id: 'r1',
      type: 'road',
      tags: {
        highway: 'primary',
        lanes: '4',
      },
      geometry: [
        { lat: 0.75, lng: 0.25 },
        { lat: 0.25, lng: 0.75 },
      ],
    },
  ]);

  const navData = buildManualMapNavigationData(terrainData, 1, 'architect');
  const segment = navData.segments[Object.keys(navData.segments)[0]];

  assert.equal(segment.autoLanes, false);
  assert.equal(segment.lanesLeft, 2);
  assert.equal(segment.lanesRight, 2);
});

test('buildManualMapNavigationData converts maxspeed mph to m/s', () => {
  const terrainData = makeTerrainData([
    {
      id: 'r1',
      type: 'road',
      tags: {
        highway: 'secondary',
        maxspeed: '35 mph',
      },
      geometry: [
        { lat: 0.8, lng: 0.2 },
        { lat: 0.2, lng: 0.8 },
      ],
    },
  ]);

  const navData = buildManualMapNavigationData(terrainData, 1, 'mesh');
  const segment = navData.segments[Object.keys(navData.segments)[0]];

  assert.equal(segment.speedLimit, 15.646);
});

test('buildManualMapNavigationData disables autoJunction for bridge and tunnel links', () => {
  const terrainData = makeTerrainData([
    {
      id: 'bridge_way',
      type: 'road',
      tags: {
        highway: 'primary',
        bridge: 'yes',
      },
      geometry: [
        { lat: 0.85, lng: 0.15 },
        { lat: 0.65, lng: 0.35 },
      ],
    },
    {
      id: 'tunnel_way',
      type: 'road',
      tags: {
        highway: 'secondary',
        tunnel: 'yes',
      },
      geometry: [
        { lat: 0.35, lng: 0.65 },
        { lat: 0.15, lng: 0.85 },
      ],
    },
  ]);

  const navData = buildManualMapNavigationData(terrainData, 1, 'architect');
  const segments = Object.values(navData.segments);

  assert.equal(segments.length, 2);
  assert.ok(segments.every((segment) => segment.autoJunction === false));
});

test('buildManualMapNavigationData marks private roads hidden in navigation', () => {
  const terrainData = makeTerrainData([
    {
      id: 'private_road',
      type: 'road',
      tags: {
        highway: 'service',
        access: 'private',
      },
      geometry: [
        { lat: 0.78, lng: 0.22 },
        { lat: 0.22, lng: 0.78 },
      ],
    },
  ]);

  const navData = buildManualMapNavigationData(terrainData, 1, 'mesh');
  const segment = navData.segments[Object.keys(navData.segments)[0]];

  assert.equal(segment.type, 'private');
  assert.equal(segment.gatedRoad, true);
  assert.equal(segment.hiddenInNavi, true);
});

test('buildManualMapNavigationData preserves link road granularity instead of over-merging', () => {
  const terrainData = makeTerrainData([
    {
      id: 'link_a',
      type: 'road',
      tags: {
        highway: 'motorway_link',
        oneway: 'yes',
      },
      geometry: [
        { lat: 0.85, lng: 0.15 },
        { lat: 0.65, lng: 0.35 },
      ],
    },
    {
      id: 'link_b',
      type: 'road',
      tags: {
        highway: 'motorway_link',
        oneway: 'yes',
      },
      geometry: [
        { lat: 0.65, lng: 0.35 },
        { lat: 0.45, lng: 0.55 },
      ],
    },
  ]);

  const navData = buildManualMapNavigationData(terrainData, 1, 'mesh');
  const segments = Object.values(navData.segments);

  assert.equal(segments.length, 2);
  assert.ok(segments.every((segment) => segment.oneWay === true));
});

test('buildManualMapNavigationData disables autoJunction at dense same-grade intersections', () => {
  const terrainData = makeTerrainData([
    {
      id: 'north_south',
      type: 'road',
      tags: { highway: 'primary' },
      geometry: [
        { lat: 0.85, lng: 0.5 },
        { lat: 0.5, lng: 0.5 },
        { lat: 0.15, lng: 0.5 },
      ],
    },
    {
      id: 'west_east',
      type: 'road',
      tags: { highway: 'primary' },
      geometry: [
        { lat: 0.5, lng: 0.15 },
        { lat: 0.5, lng: 0.5 },
        { lat: 0.5, lng: 0.85 },
      ],
    },
  ]);

  const navData = buildManualMapNavigationData(terrainData, 1, 'architect');
  const segments = Object.values(navData.segments);

  assert.ok(segments.length >= 4);
  assert.ok(segments.every((segment) => segment.autoJunction === false));
});

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
