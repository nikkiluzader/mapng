// services/roadNetwork.js getEffectiveRoadLayer: which roads pass over or under others
import test from 'node:test';
import assert from 'node:assert/strict';
import { getEffectiveRoadLayer } from '../services/roadNetwork.js';

test('a bridge is a layer up, a tunnel or cutting a layer down, a tagged layer wins', () => {
  assert.equal(getEffectiveRoadLayer({ highway: 'primary' }), 0);
  assert.equal(getEffectiveRoadLayer({ highway: 'primary', bridge: 'yes' }), 1);
  assert.equal(getEffectiveRoadLayer({ highway: 'primary', tunnel: 'yes' }), -1);
  assert.equal(getEffectiveRoadLayer({ highway: 'primary', cutting: 'yes' }), -1);
  assert.equal(getEffectiveRoadLayer({ highway: 'primary', bridge: 'yes', layer: '2' }), 2);
});

test('a road on an embankment is on the ground\'s layer: it meets other roads at grade', () => {
  // (half a layer for it made the junction on an embankment between two Rhine bridges at Arnhem
  // a flyover: the road lifted 9 m over ground it lies on, a 10 m tent in 180 m)
  assert.equal(getEffectiveRoadLayer({ highway: 'primary', embankment: 'yes' }), 0);
  assert.equal(getEffectiveRoadLayer({ highway: 'primary', embankment: 'yes', layer: '1' }), 1);
  assert.equal(getEffectiveRoadLayer({ highway: 'primary', embankment: 'yes', bridge: 'yes' }), 1);
});
