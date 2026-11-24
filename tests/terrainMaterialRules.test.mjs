import test from 'node:test';
import assert from 'node:assert/strict';

import { areaMatIndex, MATERIAL_NAMES } from '../services/osmTerrainMaterials.js';

const mat = (tags) => MATERIAL_NAMES[areaMatIndex({ type: 'landuse', tags, geometry: [] })];

test('a railway platform area is paving, not the grass ground cover grows on (coverage level, 2026-11-24)', () => {
  assert.equal(mat({ railway: 'platform' }), 'Concrete');
  assert.equal(mat({ public_transport: 'platform' }), 'Concrete');
  assert.notEqual(mat({ railway: 'platform', surface: 'grass' }), 'Concrete', 'a tagged surface still decides');
});

import { roadGroundMat } from '../services/osmTerrainMaterials.js';
test('the ground under a road follows its surface, not only its class (coverage level, 2026-11-24)', () => {
  const name = (t, cls = 5) => MATERIAL_NAMES[roadGroundMat(t, cls)];
  assert.equal(roadGroundMat({ surface: 'grass' }), 9, 'a grass track: lawn, short mown grass only');
  assert.equal(name({ surface: 'sand' }), 'BeachSand');
  assert.equal(name({ surface: 'gravel' }), 'GRAVEL');
  assert.equal(name({ surface: 'dirt' }), 'Dirt');
  assert.equal(name({ surface: 'concrete' }), 'Concrete');
  assert.equal(name({}), 'asphalt', 'untagged: the class\'s');
  assert.equal(name({}, 6), 'GRAVEL', 'a track untagged: gravel as before');
});
