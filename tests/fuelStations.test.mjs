import test from 'node:test';
import assert from 'node:assert/strict';

import { ISLAND, boxOf, stationCanopies, islandsUnder, islandOrigin, islandCorners, islandBays, islandBesideRoad, inRing } from '../services/fuelStations.js';

const rect = (x, y, w, h) => [[x, y], [x + w, y], [x + w, y + h], [x, y + h]];

test('a canopy holds islands along its long side, as many as fit', () => {
  // 18 x 8 canopy turned 30 degrees: one island, along it
  const a = Math.PI / 6; const rot = ([x, y]) => [x * Math.cos(a) - y * Math.sin(a) + 100, x * Math.sin(a) + y * Math.cos(a) + 50];
  const one = islandsUnder(rect(-9, -4, 18, 8).map(rot));
  assert.equal(one.length, 1);
  assert.ok(Math.hypot(one[0].c[0] - 100, one[0].c[1] - 50) < 1e-6, 'at its middle');
  assert.ok(Math.abs(Math.sin(one[0].yaw - a)) < 1e-6, 'along it');
  // a truck stop's long canopy: islands all along it, two rows
  const long = islandsUnder(rect(0, 0, 120, 16));
  assert.equal(long.length, 14);
  // 36 x 16: two along, two rows
  const four = islandsUnder(rect(0, 0, 36, 16));
  assert.equal(four.length, 4);
  assert.ok(four.every((i) => inRing(rect(0, 0, 36, 16), ...i.c)));
  assert.ok(four.every((i) => Math.abs(i.sx - 18 / ISLAND.length) < 1e-9 && Math.abs(i.sy - 8 / ISLAND.width) < 1e-9));
  assert.deepEqual(boxOf(rect(0, 0, 4, 10)).L, 10);
});

test("the island's origin is set so its middle lands on the spot", () => {
  for (const yaw of [0, 1, -2.5]) {
    const isl = { c: [10, 20], yaw, sx: 1.2, sy: 0.9 };
    const [ox, oy] = islandOrigin(isl);
    // the model's middle (1.3, -6.75), scaled, turned, from the origin
    const mx = ISLAND.cx * 1.2; const my = ISLAND.cy * 0.9;
    const wx = ox + mx * Math.cos(yaw) - my * Math.sin(yaw); const wy = oy + mx * Math.sin(yaw) + my * Math.cos(yaw);
    assert.ok(Math.hypot(wx - 10, wy - 20) < 1e-9);
  }
  const bays = islandBays({ c: [0, 0], yaw: 0 });
  assert.equal(bays.length, 2); assert.ok(bays[0].c[1] < 0 && bays[1].c[1] > 0);
});

test("a station's canopy: its own outline, else an unnamed roof in its grounds or near its point; not a named gazebo", () => {
  const buildings = [
    { id: 'gazebo', tags: { building: 'roof', name: 'Gazebo' }, ring: rect(0, 0, 10, 8) },
    { id: 'far', tags: { building: 'roof' }, ring: rect(200, 0, 20, 10) },
    { id: 'canopy', tags: { building: 'roof' }, ring: rect(20, 0, 20, 10) },
  ];
  const own = rect(500, 500, 18, 8);
  const { canopies, used } = stationCanopies([
    { tags: { amenity: 'fuel' }, pt: [509, 504], canopy: own },
    { tags: { amenity: 'fuel', brand: 'Shell' }, pt: [10, 4] },
    { tags: { amenity: 'fuel' }, pt: [300, 300] },
  ], buildings);
  assert.equal(canopies[0], own);
  assert.equal(canopies[1], buildings[2].ring);
  assert.equal(canopies[2], null);
  assert.deepEqual([...used], ['canopy']);
  // grounds mapped: the roof must stand inside them
  const r2 = stationCanopies([{ tags: {}, pt: [100, 100], area: rect(150, -20, 100, 60) }], buildings);
  assert.equal(r2.canopies[0], buildings[1].ring, 'the roof in the grounds, though farther');
});

test('beside the road: off its edge, moved along and out until clear of a building', () => {
  const near = { cx: 0, cy: 0, tx: 1, ty: 0, halfWidth: 4 };
  const free = islandBesideRoad(near, [0, 1], () => false);
  assert.ok(Math.abs(free.c[1] - (4 + 6 + ISLAND.width / 2)) < 1e-9 && free.c[0] === 0);
  // a shop right where it would go
  const shop = rect(-6, 8, 12, 20);
  const isl = islandBesideRoad(near, [0, 1], (x, y) => inRing(shop, x, y) || Math.abs(y) < 4.5);
  assert.ok(islandCorners(isl, 1).every(([x, y]) => !inRing(shop, x, y)), JSON.stringify(isl.c));
  assert.ok(islandCorners(isl, 0).every(([, y]) => y > 4), 'off the carriageway');
});

test('a station mapped as boxes with nothing built in them (each canopy an outer of its relation) is its canopies; grounds round a shop are not', () => {
  const shop = rect(0, 30, 40, 25);
  const buildingAt = (x, y) => inRing(shop, x, y);
  const canopyArea = rect(0, 0, 90, 14);
  const grounds = rect(-10, -10, 70, 80);
  const { canopies } = stationCanopies([
    { tags: { amenity: 'fuel', brand: "Buc-ee's" }, pt: [45, 7], area: canopyArea },
    { tags: { amenity: 'fuel' }, pt: [25, 30], area: grounds },
  ], [], { buildingAt });
  assert.equal(canopies[0], canopyArea);
  assert.equal(canopies[1], null);
  assert.equal(islandsUnder(canopyArea).length, 10, "two rows of five");
});

test('drive lanes mapped under a canopy: islands along them, in the gap between (not across them)', () => {
  // a 13 x 20 canopy, long north-south; two lanes cross it east-west, 8 m apart
  const canopy = rect(0, 0, 13, 20);
  const lanes = [[[-10, 6], [25, 6]], [[25, 14], [-10, 14]]];
  const isl = islandsUnder(canopy, lanes);
  assert.equal(isl.length, 1);
  assert.ok(Math.abs(Math.sin(isl[0].yaw)) < 1e-6, 'along the lanes');
  assert.ok(Math.abs(isl[0].c[1] - 10) < 1e-6 && Math.abs(isl[0].c[0] - 6.5) < 1e-6, JSON.stringify(isl[0].c));
  assert.ok(Math.abs(isl[0].sy - 1) < 1e-9);
  // its pad (4.7 m wide) clear of both lanes' cars
  assert.ok(isl[0].c[1] - 2.35 * isl[0].sy > 6 + 1 && isl[0].c[1] + 2.35 * isl[0].sy < 14 - 1);
  // a lone lane down the middle: an island either side of it
  const two = islandsUnder(rect(0, 0, 18, 16), [[[-5, 8], [25, 8]]]);
  assert.equal(two.length, 2);
  assert.ok(two.some((i) => i.c[1] < 8) && two.some((i) => i.c[1] > 8));
});
