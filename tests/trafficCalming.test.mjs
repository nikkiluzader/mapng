import test from 'node:test';
import assert from 'node:assert/strict';

import { placeTrafficCalming, calmingProfileAt, HUMP_SIGN_SHAPES } from '../services/trafficCalming.js';
import { CALMING_SHAPES } from '../services/beamngPropLibrary.js';

// A two-way street along +x at y = 0, 8 m wide; toWorld maps lng -> x, lat -> y.
const street = {
  owner: 1, half: 4, highway: 'residential', tags: { name: 'Elm Street' }, continuations: [],
  nodes: Array.from({ length: 101 }, (_, i) => [-200 + i * 4, 0, 0]),
};
const node = (kind, x, y, tags = {}) => ({ id: `n${x}`, type: 'traffic_calming', geometry: [{ lat: y, lng: x }], tags: { traffic_calming: kind, ...tags } });
const place = (features, extra = {}) => placeTrafficCalming({
  features, carriageways: [street], toWorld: (lat, lng) => [lng, lat], heightAt: () => 0, ...extra,
});

test('a speed bump: Driver Training modules wall to wall, a cap at each end', () => {
  const { statics, counts } = place([node('bump', 0, 0.5)]);
  assert.equal(counts.bump, 1);
  const modules = statics.filter((s) => s.shape === CALMING_SHAPES.bumpModule.shapeFile);
  assert.equal(modules.length, 7, '8 m road less 0.15 m gutters: 7 one-metre modules');
  assert.equal(statics.filter((s) => s.shape === CALMING_SHAPES.bumpCapStart.shapeFile).length, 1);
  assert.equal(statics.filter((s) => s.shape === CALMING_SHAPES.bumpCapEnd.shapeFile).length, 1);
  for (const s of statics) {
    assert.ok(Math.abs(s.yaw) < 1e-9, 'module depth (local x) along the road');
    assert.ok(Math.abs(s.position[0]) < 1e-9, 'snapped onto the centre line');
  }
  const ys = modules.map((s) => s.position[1]).sort((a, b) => a - b);
  assert.deepEqual(ys, [-3, -2, -1, 0, 1, 2, 3], 'spread across the road, centred');
});

test('a speed hump: Gridmap pieces squeezed to the width, chevrons and a sign each way', () => {
  const { statics, chevrons, signs, counts } = place([node('hump', 50, 0)]);
  assert.equal(counts.hump, 1);
  assert.equal(statics.length, 2, '7.7 m of road: two 4.2 m pieces');
  for (const s of statics) {
    assert.equal(s.shape, CALMING_SHAPES.hump.shapeFile);
    assert.ok(Math.abs(s.yaw + Math.PI / 2) < 1e-9, 'piece local y along the road');
    assert.ok(Math.abs(s.scale[0] - 7.7 / 8.4) < 1e-9, 'squeezed across to the road');
  }
  assert.equal(chevrons.length, 2, 'two-way: chevrons for each direction');
  const east = chevrons.find((c) => c.nodes[2][0] > c.nodes[0][0]);
  assert.ok(east.nodes.every((p) => p[1] < 0), 'eastbound paint on the right (south) half');
  assert.ok(east.nodes[1][2] > 0.08, 'the paint rides over the hump');
  assert.equal(signs.length, 2);
  const eastSign = signs.find((s) => s.position[0] < 50);
  assert.ok(Math.abs(eastSign.position[0] - 20) < 1e-9 && Math.abs(eastSign.position[1] + 5.5) < 1e-9, '30 m ahead, on the right kerb');
  assert.equal(eastSign.shape, HUMP_SIGN_SHAPES.americas);
});

test('humps in a row share their signs; tables use the flat-topped piece', () => {
  const { signs, statics, counts } = place([node('hump', 50, 0), node('table', 90, 0)], { style: 'white' });
  assert.equal(counts.hump + counts.table, 2);
  assert.equal(signs.length, 2, 'one sign per direction for the run');
  assert.ok(signs.every((s) => s.shape === HUMP_SIGN_SHAPES.white));
  assert.ok(statics.some((s) => s.shape === CALMING_SHAPES.table.shapeFile));
  assert.ok(Math.abs(calmingProfileAt('table', 0.5) - 0.107) < 1e-9 && calmingProfileAt('hump', 0) > calmingProfileAt('hump', 1.5));
});

test('a parking-lot bump sits on its service road; other kinds and stray nodes are skipped', () => {
  const aisle = { id: 'w1', type: 'road', tags: { highway: 'service', service: 'parking_aisle' }, geometry: [{ lat: 40, lng: -50 }, { lat: 40, lng: 50 }] };
  const { statics, counts, skipped } = place([aisle, node('bump', 0, 40.4), node('dip', 10, 0), node('bump', 0, 20)]);
  assert.equal(counts.bump, 1);
  assert.equal(statics.filter((s) => s.shape === CALMING_SHAPES.bumpModule.shapeFile).length, 5, 'a 6 m aisle: five modules');
  assert.equal(skipped.unsupported, 1, 'the dip');
  assert.equal(skipped.offRoad, 1, 'the bump 20 m from any road');
});

test('a cushion: one pad per lane', () => {
  const { statics, counts } = place([node('cushion', -50, 0)]);
  assert.equal(counts.cushion, 1);
  const modules = statics.filter((s) => s.shape === CALMING_SHAPES.bumpModule.shapeFile);
  assert.equal(modules.length, 4, 'two lanes, two-module pads');
  assert.ok(modules.some((s) => s.position[1] > 0) && modules.some((s) => s.position[1] < 0), 'one pad in each lane');
});
