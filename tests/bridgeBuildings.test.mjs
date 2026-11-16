import test from 'node:test';
import assert from 'node:assert/strict';
import { leaveBridgeBuildings } from '../services/bridgeBuildings.js';

// a small world in metres round (0, 0), as lat/lng
const KY = 110574; const KX = 111320;
const P = (x, y) => ({ lat: y / KY, lng: x / KX });
const ring = (x0, y0, x1, y1) => [P(x0, y0), P(x1, y0), P(x1, y1), P(x0, y1), P(x0, y0)];
const building = (id, r, tags = {}) => ({ id, type: 'building', tags: { building: 'yes', ...tags }, geometry: r });
const road = (pts, tags) => ({ type: 'road', tags, geometry: pts.map(([x, y]) => P(x, y)) });
const ids = (res) => res.features.filter((f) => f.type === 'building').map((f) => f.id);

test('a building a raised passage road runs through is left to the bridge; one at ground level stays', () => {
  const tower = building('tower', ring(-6, 40, 6, 60));
  const arcade = building('arcade', ring(100, -5, 120, 5));
  const res = leaveBridgeBuildings([
    tower, arcade,
    road([[0, 0], [0, 38]], { highway: 'trunk', bridge: 'yes', layer: '1' }),
    road([[0, 38], [0, 62]], { highway: 'trunk', tunnel: 'building_passage', layer: '1' }),
    road([[90, 0], [130, 0]], { highway: 'residential', tunnel: 'building_passage' }),
  ]);
  assert.deepEqual(ids(res), ['arcade']);
  assert.equal(res.passage, 1);
});

test('a short passage with no vertex inside the building still counts (its middle)', () => {
  const res = leaveBridgeBuildings([
    building('tower', ring(-6, 40, 6, 60)),
    road([[0, 30], [0, 70]], { highway: 'primary', tunnel: 'building_passage', layer: '2' }),
  ]);
  assert.deepEqual(ids(res), []);
});

test('buildings in a bridge outline beside its road are its towers; others stay', () => {
  const outline = { type: 'bridge_infra', tags: { man_made: 'bridge' }, geometry: ring(-12, 0, 12, 300) };
  const res = leaveBridgeBuildings([
    outline,
    road([[0, -20], [0, 320]], { highway: 'secondary', bridge: 'yes', layer: '1' }),
    building('towerWest', ring(-10, 50, -5, 58)),     // 5 m from the road, in the outline
    building('towerEast', ring(5, 50, 10, 58)),
    building('works', ring(5, 80, 10, 88), { building: 'industrial' }),   // in the outline, 5 m from the road, but a building with a use
    building('beside', ring(20, 50, 30, 60)),          // outside the outline
    building('under', ring(-60, 100, -40, 120)),       // far off, outside
  ]);
  assert.deepEqual(ids(res), ['works', 'beside', 'under']);
  assert.equal(res.towers, 2);
});

test('shops on a bridge for walking stay, and a building in a wide outline far from the road stays', () => {
  const shops = leaveBridgeBuildings([
    { type: 'bridge_infra', tags: { man_made: 'bridge' }, geometry: ring(-10, 0, 10, 100) },
    road([[0, 0], [0, 100]], { highway: 'pedestrian', bridge: 'yes', layer: '1' }),
    building('shop', ring(-9, 20, -4, 40)),
  ]);
  assert.deepEqual(ids(shops), ['shop']);
  const wide = leaveBridgeBuildings([
    { type: 'bridge_infra', tags: { man_made: 'bridge' }, geometry: ring(-40, 0, 40, 100) },
    road([[0, 0], [0, 100]], { highway: 'primary', bridge: 'yes' }),
    building('kiosk', ring(25, 20, 32, 30)),           // 25 m from the road
  ]);
  assert.deepEqual(ids(wide), ['kiosk']);
});

test('with no bridge outline and no raised passage nothing changes', () => {
  const feats = [building('a', ring(0, 0, 10, 10)), road([[20, 0], [20, 50]], { highway: 'primary', bridge: 'yes' })];
  const res = leaveBridgeBuildings(feats);
  assert.equal(res.features.length, 2); assert.equal(res.passage + res.towers, 0);
});
