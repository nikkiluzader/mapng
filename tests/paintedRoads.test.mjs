// The base picture paints only roads that are there, on the ground (services/osmTexture.js).
import test from 'node:test';
import assert from 'node:assert/strict';
import { isPaintedRoad } from '../services/osmTexture.js';

test('planned roads and roads in tunnels are left out of the base picture', () => {
  assert.equal(isPaintedRoad({ highway: 'residential' }), true);
  assert.equal(isPaintedRoad({ highway: 'proposed', proposed: 'cycleway' }), false);
  assert.equal(isPaintedRoad({ highway: 'path', proposed: 'yes' }), false);
  assert.equal(isPaintedRoad({ highway: 'primary', tunnel: 'yes', layer: '-1' }), false);
  assert.equal(isPaintedRoad({ highway: 'service', tunnel: 'culvert' }), false);
  // on the ground all the same: a gallery, a passage through a building, tunnel=no; a road being built is there
  assert.equal(isPaintedRoad({ highway: 'secondary', tunnel: 'avalanche_protector' }), true);
  assert.equal(isPaintedRoad({ highway: 'service', tunnel: 'building_passage' }), true);
  assert.equal(isPaintedRoad({ highway: 'tertiary', tunnel: 'no' }), true);
  assert.equal(isPaintedRoad({ highway: 'construction' }), true);
  assert.equal(isPaintedRoad(undefined), true);
});
