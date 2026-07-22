import test from 'node:test';
import assert from 'node:assert/strict';
import {
  FPV_FAST_MULTIPLIER,
  clampFpvPitch,
  getFpvMovement,
  isFpvControlKey,
} from './cesiumFpvControls.js';

test('maps WASD to deterministic forward and lateral movement', () => {
  const movement = getFpvMovement(new Set(['w', 'a']), 0.05);
  assert.ok(Math.abs(movement.forward - 0.6) < 1e-12);
  assert.ok(Math.abs(movement.right + 0.6) < 1e-12);
  assert.deepEqual(getFpvMovement(new Set(['w', 's', 'a', 'd']), 0.05), { forward: 0, right: 0 });
});

test('applies shift boost and caps long frame deltas', () => {
  const normal = getFpvMovement(new Set(['w']), 10).forward;
  const fast = getFpvMovement(new Set(['w', 'shift']), 10).forward;
  assert.equal(fast, normal * FPV_FAST_MULTIPLIER);
  assert.ok(Math.abs(normal - 1.2) < 1e-12);
});

test('clamps pitch before the camera can flip', () => {
  assert.ok(clampFpvPitch(100) < Math.PI / 2);
  assert.ok(clampFpvPitch(-100) > -Math.PI / 2);
  assert.equal(clampFpvPitch(0.25), 0.25);
});

test('recognizes only FPV movement keys', () => {
  assert.equal(isFpvControlKey('W'), true);
  assert.equal(isFpvControlKey('Shift'), true);
  assert.equal(isFpvControlKey('Escape'), false);
});
