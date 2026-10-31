import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveBuildingRoadConflicts, roadCountsAgainstBuildings, buildingMayOverhang } from '../services/buildingRoadConflicts.js';

// a flat metric frame: lat/lng are metres / 1e5 (y, x)
const project = (lat, lng) => [lng * 1e5, lat * 1e5];
const unproject = (x, y) => ({ lat: y / 1e5, lng: x / 1e5 });
const P = (x, y) => ({ lat: y / 1e5, lng: x / 1e5 });
const rect = (x0, y0, x1, y1) => [P(x0, y0), P(x1, y0), P(x1, y1), P(x0, y1)];
// a two-lane residential street along y = 0, x from -100 to 100 (driving half ~3 m)
const street = (tags = {}) => ({ id: 'way_road', type: 'road', tags: { highway: 'residential', ...tags }, geometry: [P(-100, 0), P(100, 0)] });
const run = (features) => resolveBuildingRoadConflicts(features, { project, unproject });

test('roads that legitimately pass buildings never count', () => {
  assert.equal(roadCountsAgainstBuildings({ highway: 'primary' }), true);
  for (const t of [{ tunnel: 'building_passage' }, { tunnel: 'yes' }, { covered: 'yes' }, { bridge: 'yes' }, { layer: '-1' }, { service: 'driveway' }, { service: 'parking_aisle' }]) {
    assert.equal(roadCountsAgainstBuildings({ highway: t.service ? 'service' : 'residential', ...t }), false, JSON.stringify(t));
  }
  assert.equal(roadCountsAgainstBuildings({ highway: 'footway' }), false);
  assert.equal(buildingMayOverhang({ building: 'roof' }), true);
  assert.equal(buildingMayOverhang({ building: 'yes', layer: '1' }), true);
  assert.equal(buildingMayOverhang({ building: 'house' }), false);
});

test('an ML outline across the street is left out; one beside it stays', () => {
  const ml = { id: 'ml_on', type: 'building', tags: { building: 'yes', 'mapng:source': 'overture' }, geometry: rect(-5, -4, 5, 6) };
  const mlBeside = { id: 'ml_off', type: 'building', tags: { building: 'yes', 'mapng:source': 'overture' }, geometry: rect(-5, 8, 5, 18) };
  const r = run([street(), ml, mlBeside]);
  assert.deepEqual(r.dropped.map((d) => d.id), ['ml_on']);
  assert.ok(r.features.some((f) => f.id === 'ml_off'));
});

test('an OSM building reaching into the lanes is cut back to the lanes edge, not deleted', () => {
  // 10 x 12 m house whose front 2 m stand in the lanes (y from 1 to 13; lanes reach y ~3.3)
  const house = { id: 'way_house', type: 'building', tags: { building: 'house' }, geometry: rect(-5, 1, 5, 13) };
  const r = run([street(), house]);
  assert.equal(r.dropped.length, 0);
  assert.equal(r.clipped.length, 1);
  const cut = r.features.find((f) => f.id === 'way_house');
  const ys = cut.geometry.map((p) => project(p.lat, p.lng)[1]);
  assert.ok(Math.min(...ys) > 2.5 && Math.min(...ys) < 4.5, `front wall at y ${Math.min(...ys).toFixed(2)}`);
  assert.ok(Math.abs(Math.max(...ys) - 13) < 1e-6, 'the back wall stays');
  assert.equal(cut.tags['mapng:clipped_from_road'], 'yes');
});

test('an OSM building mostly on the road is kept as mapped and flagged; a passage road does not even flag it', () => {
  const onRoad = { id: 'way_bad', type: 'building', tags: { building: 'yes' }, geometry: rect(-10, -3, 10, 3) };
  const r0 = run([street(), onRoad]);
  assert.equal(r0.dropped.length, 0);
  assert.deepEqual(r0.flagged.map((d) => d.id), ['way_bad']);
  assert.ok(r0.features.includes(onRoad));
  // the same building over a road that passes through it
  const r = run([street({ tunnel: 'building_passage' }), onRoad]);
  assert.equal(r.dropped.length + r.clipped.length + r.flagged.length, 0);
});

test('an OSM building at a bend is left as mapped rather than sliced past the road', () => {
  // an L-shaped street: along y = 0 to x = 0, then north along x = 0; a house
  // in the inside corner reaching 1 m into the north arm's lanes
  const bend = { id: 'way_bend', type: 'road', tags: { highway: 'residential' }, geometry: [P(-100, 0), P(0, 0), P(0, 100)] };
  const house = { id: 'way_corner', type: 'building', tags: { building: 'house' }, geometry: [P(-20, 5), P(2, 5), P(2, 9), P(-2, 9), P(-2, 25), P(-20, 25)] };
  const r = run([bend, house]);
  assert.equal(r.dropped.length, 0);
  const out = r.features.find((f) => f.id === 'way_corner');
  // either cut locally (the far wall at x -20 stays) or kept as mapped
  const xs = out.geometry.map((p) => project(p.lat, p.lng)[0]);
  assert.ok(Math.abs(Math.min(...xs) + 20) < 1e-6, 'the wall far from the road stays');
});

test('a building flush with the kerb, outside the lanes, is untouched', () => {
  const flush = { id: 'way_flush', type: 'building', tags: { building: 'yes' }, geometry: rect(-5, 3.5, 5, 13) };
  const r = run([street(), flush]);
  assert.equal(r.dropped.length + r.clipped.length, 0);
  assert.equal(r.features.find((f) => f.id === 'way_flush'), flush);
});
