// Which model a mapped barrier line gets (services/exportBeamNGLevel.js resolveNativeBarrierAsset).
import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveNativeBarrierAsset } from '../services/exportBeamNGLevel.js';

const shape = (tags) => resolveNativeBarrierAsset(tags)?.shapeName || null;

test('a barrier kind nobody named is not built: it is never a guard rail by default', () => {
  const rail = shape({ barrier: 'guard_rail' });
  assert.ok(rail, 'a guard rail has a model');
  for (const kind of ['yes', 'ditch', 'log', 'planter', 'bollard', 'cycle_barrier', 'debris', 'rope', 'something_new']) {
    assert.equal(resolveNativeBarrierAsset({ barrier: kind }), null, kind);
  }
  assert.equal(resolveNativeBarrierAsset({ barrier: 'kerb' }), null);
  assert.equal(resolveNativeBarrierAsset({}), null);
});

test('the kinds that are named keep their models', () => {
  const rail = shape({ barrier: 'guard_rail' });
  assert.equal(shape({ barrier: 'cable_barrier' }), rail);                         // a wire-rope safety barrier along a road
  assert.equal(shape({ barrier: 'block' }), shape({ barrier: 'jersey_barrier' }));   // concrete, not a fence
  assert.notEqual(shape({ barrier: 'block' }), shape({ barrier: 'fence' }));
  for (const kind of ['fence', 'wall', 'retaining_wall', 'city_wall', 'hedge', 'handrail', 'chain', 'jersey_barrier', 'guard_rail']) {
    assert.ok(shape({ barrier: kind }), kind);
  }
  assert.notEqual(shape({ barrier: 'wall' }), rail);
  assert.notEqual(shape({ barrier: 'fence' }), rail);
});

test('a concrete retaining wall holds the ground; a concrete wall stands free', () => {
  assert.ok(resolveNativeBarrierAsset({ barrier: 'retaining_wall', material: 'concrete' })?.retaining, 'concrete retaining wall');
  assert.ok(!resolveNativeBarrierAsset({ barrier: 'wall', material: 'concrete' })?.retaining, 'a concrete wall stands free');
});
