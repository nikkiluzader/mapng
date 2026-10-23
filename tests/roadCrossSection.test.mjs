import test from 'node:test';
import assert from 'node:assert/strict';

import {
  EDGE_STRIP_M,
  PARKING_LANE_M,
  buildUrbanRoadClassifier,
  estimateRoadCrossSection,
  estimateRoadHalfWidth,
} from '../services/roadWidth.js';

const close = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-9, `${msg}: ${a} vs ${b}`);

test('urban two-way residential gets a parking lane each side', () => {
  const x = estimateRoadCrossSection({}, 'residential', false, { urban: true });
  close(x.drivingHalfWidth, estimateRoadHalfWidth({}, 'residential', false), 'driving width unchanged');
  close(x.leftExtra, PARKING_LANE_M, 'left parking');
  close(x.rightExtra, PARKING_LANE_M, 'right parking');
  close(x.carriagewayHalfWidth, x.drivingHalfWidth + PARKING_LANE_M, 'carriageway');
  close(x.laneShift, 0, 'symmetric');
});

test('rural paved roads get an edge strip; service roads, links and dirt do not', () => {
  const rural = estimateRoadCrossSection({}, 'primary', false, { urban: false });
  close(rural.leftExtra, EDGE_STRIP_M, 'primary strip');
  for (const [tags, hw] of [[{}, 'service'], [{}, 'motorway_link'], [{ surface: 'gravel' }, 'unclassified'], [{}, 'track']]) {
    const x = estimateRoadCrossSection(tags, hw, false, { urban: false });
    close(x.leftExtra + x.rightExtra, 0, `${hw} ${JSON.stringify(tags)}`);
  }
});

test('urban one-way streets get no default parking (side is unknown)', () => {
  const x = estimateRoadCrossSection({ oneway: 'yes' }, 'residential', true, { urban: true });
  close(x.leftExtra + x.rightExtra, 0, 'no default parking');
});

test('parking tags win over defaults, per side, and shift the lanes', () => {
  // Parking on the right only: lanes sit left of the way (positive shift).
  const x = estimateRoadCrossSection({ 'parking:right': 'lane', 'parking:left': 'no' }, 'residential', false, { urban: true });
  close(x.leftExtra, 0, 'tagged no parking left');
  close(x.rightExtra, PARKING_LANE_M, 'tagged parking right');
  close(x.laneShift, PARKING_LANE_M / 2, 'lanes shift left');

  const legacy = estimateRoadCrossSection({ 'parking:lane:both': 'diagonal' }, 'tertiary', false, { urban: false });
  close(legacy.leftExtra, 4.5, 'legacy diagonal');
  const onKerb = estimateRoadCrossSection({ 'parking:both': 'on_kerb' }, 'residential', false, { urban: true });
  close(onKerb.leftExtra, 0, 'on_kerb parking takes no carriageway');
  const orientation = estimateRoadCrossSection({ 'parking:both': 'lane', 'parking:both:orientation': 'perpendicular' }, 'residential', false, {});
  close(orientation.rightExtra, 5.0, 'orientation width');
});

test('shoulder tags', () => {
  const none = estimateRoadCrossSection({ shoulder: 'no' }, 'primary', false, { urban: false });
  close(none.leftExtra + none.rightExtra, 0, 'shoulder=no');
  const right = estimateRoadCrossSection({ shoulder: 'right', 'shoulder:width': '2.5' }, 'primary', false, { urban: true });
  close(right.rightExtra, 2.5, 'tagged right shoulder');
  close(right.leftExtra, 0, 'not on the left');
});

test('width= is the whole carriageway, with tagged parking carved out of it', () => {
  const plain = estimateRoadCrossSection({ width: '12' }, 'residential', false, { urban: true });
  close(plain.carriagewayHalfWidth, 6, 'width is carriageway; no invented parking');
  close(plain.leftExtra + plain.rightExtra, 0, 'defaults ignored under width=');
  const parked = estimateRoadCrossSection({ width: '12', 'parking:both': 'lane' }, 'residential', false, {});
  close(parked.carriagewayHalfWidth, 6, 'carriageway still 12 m');
  close(parked.drivingHalfWidth, 6 - PARKING_LANE_M, 'driving = width - parking');
});

// ~1 m in degrees at the equator, for building a small synthetic street.
const M = 1 / 111320;
const box = (lat, lng) => ({
  type: 'building',
  geometry: [
    { lat, lng }, { lat: lat + 8 * M, lng }, { lat: lat + 8 * M, lng: lng + 8 * M }, { lat, lng: lng + 8 * M },
  ],
});

test('a street lined by buildings is urban; an empty road is not', () => {
  const buildings = [];
  for (let i = 0; i <= 200; i += 15) {
    buildings.push(box(12 * M, i * M), box(-20 * M, i * M));
  }
  const street = { id: 'street', type: 'road', geometry: [{ lat: 0, lng: 0 }, { lat: 0, lng: 200 * M }] };
  const country = { id: 'country', type: 'road', geometry: [{ lat: 1000 * M, lng: 0 }, { lat: 1000 * M, lng: 200 * M }] };
  const isUrban = buildUrbanRoadClassifier(buildings);
  assert.equal(isUrban(street), true);
  assert.equal(isUrban(country), false);
  assert.equal(buildUrbanRoadClassifier([])(street), false, 'no buildings → rural');
});

test('one road name, mixed lane counts: tagged ways keep their own width', async () => {
  const { generateDecalRoads } = await import('../services/exportBeamNGLevel.js');
  // A canyon road: two 2-lane ways, a 4-lane way, an untagged way — split
  // where they meet a side road so each stays its own decal.
  const way = (id, lanes, a, b) => ({
    id, type: 'road', geometry: [{ lat: 0.005, lng: a }, { lat: 0.005, lng: b }],
    tags: { highway: 'secondary', name: 'Canyon Road', ...(lanes ? { lanes } : {}) },
  });
  const side = (id, lng) => ({
    id, type: 'road', tags: { highway: 'residential', name: id },
    geometry: [{ lat: 0.005, lng }, { lat: 0.008, lng }],
  });
  const size = 64;
  const td = {
    width: size, height: size, minHeight: 0, maxHeight: 50,
    heightMap: new Float32Array(size * size).fill(10),
    bounds: { north: 0.01, south: 0, west: 0, east: 0.01 },
    metersPerPixel: (0.01 * 111320) / size,
    osmFeatures: [
      way('a', '2', 0.001, 0.003), way('b', '2', 0.003, 0.005), way('c', '4', 0.005, 0.007), way('d', null, 0.007, 0.009),
      side('s1', 0.003), side('s2', 0.005), side('s3', 0.007),
    ],
  };
  const decals = [];
  const walk = (items) => items.forEach((it) => { if (it.class === 'DecalRoad') decals.push(it); if (it.__items) walk(it.__items); });
  walk(generateDecalRoads(td, td.metersPerPixel));
  const paths = decals.filter((d) => d.material === 'road_invisible' && /Canyon/.test(d.name));
  const widthAt = (x) => paths.find((d) => d.nodes.some(([nx]) => Math.abs(nx - x) < 60))?.nodes[0][3];
  const m = 111320 * 0.001;
  // World x = 0 at lng 0.005; driving width = lanes × 3.5 m, capped at 12 m.
  assert.equal(widthAt(-3 * m), 7, '2-lane way stays 2 lanes wide');
  assert.equal(widthAt(1 * m), 12, '4-lane way is wide (secondary cap: 12 m)');
  assert.equal(widthAt(3 * m), 7, 'untagged way takes the corridor\'s usual width');
});
