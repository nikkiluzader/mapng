import test from 'node:test';
import assert from 'node:assert/strict';
import { reachesShakeDistance } from '../services/levelLimits.js';

test('the shaking distance', () => {
  assert.equal(reachesShakeDistance(32.8), false);   // 32768 px at 1 m: 16 km out
  assert.equal(reachesShakeDistance(65.5), true);    // 8192 px at 8 m: 33 km out
});
