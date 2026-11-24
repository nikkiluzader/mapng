import test from 'node:test';
import assert from 'node:assert/strict';

import { unpavedLook, UNPAVED_ROAD_MATERIALS, pedestrianSurfaceLayers } from '../services/exportBeamNGLevel.js';

test('unpaved surfaces look different: gravel with its stones, compacted pale, mud rutted, sand and grass their own', () => {
  const looks = ['dirt', 'gravel', 'fine_gravel', 'compacted', 'mud', 'woodchips', 'sand', 'grass'].map((s) => unpavedLook(s));
  assert.equal(unpavedLook('gravel').overlay, 'm_dirt_road_gravels', 'gravel: the game\'s stone overlay');
  assert.equal(unpavedLook('dirt').material, 'm_dirt_road');
  assert.equal(unpavedLook('sand').material, UNPAVED_ROAD_MATERIALS.sand.name);
  assert.equal(unpavedLook('grass').material, UNPAVED_ROAD_MATERIALS.grass.name);
  assert.ok(new Set(looks.map((l) => l.material)).size >= 6, 'at least six different materials');
  // an unpaved pedestrian street takes the same look, its overlay too
  const layers = pedestrianSurfaceLayers('gravel', 6);
  assert.deepEqual(layers.map((l) => l.material), ['m_dirt_variation_01', 'm_dirt_road_gravels']);
});
