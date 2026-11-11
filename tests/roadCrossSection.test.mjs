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
  // World x = 0 at lng 0.005; driving width = lanes × 3.5 m (a counted lane is never squeezed
  // by the class maximum: that is for roads with no count).
  assert.equal(widthAt(-3 * m), 7, '2-lane way stays 2 lanes wide');
  assert.equal(widthAt(1 * m), 14, '4-lane way is four lanes wide');
  assert.equal(widthAt(3 * m), 7, 'untagged way takes the corridor\'s usual width');
});

test('a passing lane ends where its way ends, with no side road there', async () => {
  const { generateDecalRoads } = await import('../services/exportBeamNGLevel.js');
  // A canyon road as OSM cuts it at a lane change: 2 lanes, 3 lanes for a
  // stretch, 2 lanes again, the ways meeting at plain nodes. Joined into one
  // run and painted from its first way, the third lane ran the whole road
  // (or was lost), by the order the ways came in.
  const way = (id, lanes, a, b) => ({
    id, type: 'road', geometry: [{ lat: 0.005, lng: a }, { lat: 0.005, lng: b }],
    tags: { highway: 'secondary', name: 'Canyon Road', lanes },
  });
  const size = 64;
  const m = 111320 * 0.001;
  for (const order of [[0, 1, 2], [1, 0, 2], [2, 1, 0]]) {
    const ways = [way('a', '2', 0.001, 0.004), way('b', '3', 0.004, 0.006), way('c', '2', 0.006, 0.009)];
    const td = {
      width: size, height: size, minHeight: 0, maxHeight: 50,
      heightMap: new Float32Array(size * size).fill(10),
      bounds: { north: 0.01, south: 0, west: 0, east: 0.01 },
      metersPerPixel: (0.01 * 111320) / size,
      osmFeatures: order.map((i) => ways[i]),
    };
    const decals = [];
    const walk = (items) => items.forEach((it) => { if (it.class === 'DecalRoad') decals.push(it); if (it.__items) walk(it.__items); });
    walk(generateDecalRoads(td, td.metersPerPixel));
    const lane = decals.filter((d) => d.material === 'm_line_white_discontinue');
    assert.ok(lane.length > 0, `the 3-lane way has its lane line (order ${order})`);
    // (world x = 0 at lng 0.005: the 3-lane way runs from -1 m to +1 m)
    for (const d of lane) for (const [x] of d.nodes) assert.ok(Math.abs(x) < 1 * m + 2, `lane line at x ${x.toFixed(0)} is on the 3-lane way (order ${order})`);
    const paths = decals.filter((d) => d.material === 'road_invisible' && /Canyon/.test(d.name));
    const widthAt = (x) => paths.find((d) => d.nodes.some(([nx]) => Math.abs(nx - x) < 20))?.nodes.find(([nx]) => Math.abs(nx - x) < 20)?.[3];
    assert.equal(widthAt(-2.5 * m), 7, `2 lanes before (order ${order})`);
    assert.equal(widthAt(0), 10.5, `3 lanes on the stretch (order ${order})`);
    assert.equal(widthAt(2.5 * m), 7, `2 lanes after (order ${order})`);
  }
});

test('a short bridge carries no assumed parking lanes; a long one and a tagged one stay as they are', async () => {
  const { markShortSpans } = await import('../services/roadWidth.js');
  const m = 1 / 111320;
  const way = (id, len, tags) => ({ id, type: 'road', tags: { highway: 'residential', ...tags }, geometry: [{ lat: 0, lng: 0 }, { lat: 0, lng: len * m }] });
  const project = (p) => [p.lng * 111320, p.lat * 111320];
  const out = markShortSpans([
    way('stream', 12.5, { bridge: 'yes' }), way('canal', 28, { bridge: 'yes' }), way('street', 12.5, {}),
    way('tagged', 9, { bridge: 'yes', 'parking:both': 'lane' }), way('wide', 9, { bridge: 'yes', width: '11' }),
  ], project);
  const by = Object.fromEntries(out.map((f) => [f.id, f.tags]));
  assert.equal(by.stream['parking:both'], 'no');
  assert.equal(by.canal['parking:both'], undefined, 'a longer bridge is as wide as its street');
  assert.equal(by.street['parking:both'], undefined, 'not a bridge');
  assert.equal(by.tagged['parking:both'], 'lane', 'the mapper said so');
  assert.equal(by.wide['parking:both'], undefined, 'its width is mapped');
  // and so it is drawn at its lanes' width in a town
  const half = (t) => estimateRoadCrossSection(t, 'residential', false, { urban: true }).carriagewayHalfWidth;
  assert.ok(half(by.stream) < half(by.street) - 1.5, `bridge ${2 * half(by.stream)} m, street ${2 * half(by.street)} m`);
});
