import test from 'node:test';
import assert from 'node:assert/strict';
import { measureStreetWidths, splitRightOfWay, measurable, buildWalls, measureRightOfWay } from '../services/streetWidths.js';
import { estimateRoadCrossSection } from '../services/roadWidth.js';

// metres -> lat/lng near the equator (1e-5 deg ~ 1.11 m: scale so 1 unit = 1 m)
const K = 1 / 111320;
const P = (x, y) => ({ lat: y * K, lng: x * K });
const rect = (x0, y0, x1, y1) => [P(x0, y0), P(x1, y0), P(x1, y1), P(x0, y1)];
// a row of houses each side of a street along y = 0, their fronts `half` m from the centre
const walledStreet = (half, tags = {}) => {
  const feats = [{ id: 'way_s', type: 'road', tags: { highway: 'residential', ...tags }, geometry: [P(-100, 0), P(100, 0)] }];
  for (let x = -100; x < 100; x += 12) {
    feats.push({ type: "building", tags: { building: "house" }, geometry: rect(x, half, x + 11, half + 10) });
    feats.push({ type: "building", tags: { building: "house" }, geometry: rect(x, -half - 10, x + 11, -half) });
  }
  return feats;
};

test('split: sidewalks a fifth each within their limits, never a carriageway under 3 m', () => {
  assert.deepEqual(splitRightOfWay(20), { carriageway: 12, sidewalk: 4 });
  const narrow = splitRightOfWay(5);
  assert.ok(Math.abs(narrow.carriageway - 3) < 1e-9 && Math.abs(narrow.sidewalk - 1) < 1e-9);
  assert.equal(splitRightOfWay(3.5), null);
});

test('a street between building rows takes their face-to-face width; its sidewalks keep their own width', () => {
  const { features, measured } = measureStreetWidths(walledStreet(9));   // 18 m wall to wall
  assert.equal(measured.length, 1);
  const road = features.find((f) => f.id === 'way_s');
  assert.equal(road.tags['mapng:carriageway_width'], '10.8');            // 18 - 2 x 3.6
  assert.equal(road.tags['sidewalk:both:width'], undefined, 'room for sidewalks: their default width');
  assert.equal(road.tags.sidewalk, undefined);
  // drawn: the default 6 m of lanes kept, the parking a side grown to fill the rest
  const cs = estimateRoadCrossSection(road.tags, 'residential', false, { urban: true });
  assert.ok(Math.abs(2 * cs.carriagewayHalfWidth - 10.8) < 1e-9 && Math.abs(cs.drivingHalfWidth - 3) < 1e-9);
});

test('a Tokyo lane: 5 m between the houses gives a 3 m road, no sidewalks, under the class minimum', () => {
  const { features } = measureStreetWidths(walledStreet(2.5));
  const road = features.find((f) => f.id === 'way_s');
  assert.equal(road.tags['mapng:carriageway_width'], '3.0');
  assert.equal(road.tags.sidewalk, 'no');
  // the parking gone first, then the lanes down to the measured 3 m (under the class minimum)
  const cs = estimateRoadCrossSection(road.tags, 'residential', false, { urban: true });
  assert.ok(Math.abs(2 * cs.carriagewayHalfWidth - 3) < 1e-9 && cs.leftExtra === 0, `drawn ${2 * cs.carriagewayHalfWidth} m`);
});

test('open ground, one-sided rows and tagged widths are left to the defaults', () => {
  const open = [{ id: 'way_o', type: 'road', tags: { highway: 'residential' }, geometry: [P(-100, 0), P(100, 0)] }];
  assert.equal(measureStreetWidths(open).measured.length, 0);
  const oneSide = walledStreet(9).filter((f) => f.type === 'road' || f.geometry[0].lat > 0);
  assert.equal(measureStreetWidths(oneSide).measured.length, 0);
  assert.equal(measureStreetWidths(walledStreet(9, { width: '7' })).measured.length, 0);
  assert.equal(measureStreetWidths(walledStreet(9, { lanes: '4' })).measured.length, 0);
  assert.equal(measurable({ highway: 'primary', oneway: 'yes' }), false, 'one carriageway of a divided road');
  assert.equal(measurable({ highway: 'service' }), true, 'a plain service road (Tokyo maps lanes so)');
  assert.equal(measurable({ highway: 'service', service: 'parking_aisle' }), false);
  assert.equal(measurable({ highway: 'service', service: 'driveway' }), false);
  assert.equal(measurable({ highway: 'residential', junction: 'roundabout' }), false);
});

test('walls disagreeing along the street (front yards) are not a width, but its pinches cap the drawn road', () => {
  // houses alternately 5 m and 15 m back from the street: 10 m wall to wall at the pinches
  const feats = [{ id: 'way_y', type: 'road', tags: { highway: 'residential' }, geometry: [P(-100, 0), P(100, 0)] }];
  let k = 0;
  for (let x = -100; x < 100; x += 12, k++) {
    const h = k % 2 ? 5 : 15;
    feats.push({ type: 'building', tags: { building: 'house' }, geometry: rect(x, h, x + 11, h + 10) });
    feats.push({ type: 'building', tags: { building: 'house' }, geometry: rect(x, -h - 10, x + 11, -h) });
  }
  const { measured, features } = measureStreetWidths(feats);
  assert.equal(measured.length, 1);
  assert.equal(measured[0].capped, true);
  const road = features.find((f) => f.id === 'way_y');
  assert.equal(road.tags['mapng:carriageway_width'], '9.4');     // 10 - 2 x 0.3
  assert.equal(road.tags.sidewalk, undefined, 'a cap leaves the sidewalks alone');
  const cs = estimateRoadCrossSection(road.tags, 'residential', false, { urban: true });
  assert.ok(Math.abs(cs.drivingHalfWidth - 3) < 1e-9, 'the lanes keep their width; the parking gives way');
});

test('walls: a ray stops at the first wall', () => {
  const walls = buildWalls([[[5, -5], [6, -5], [6, 5], [5, 5]], [[9, -5], [10, -5], [10, 5], [9, 5]]]);
  assert.equal(walls.ray([0, 0], [1, 0]), 5);
  assert.equal(walls.ray([0, 0], [-1, 0]), null);
  assert.equal(measureRightOfWay([[0, -200], [0, 200]], walls), null, 'nothing on the other side');
});
