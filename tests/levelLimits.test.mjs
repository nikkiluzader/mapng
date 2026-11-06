import test from 'node:test';
import assert from 'node:assert/strict';
import { combinedLevelTier, terrainFileGB, reachesShakeDistance } from '../services/levelLimits.js';

test('combined levels: tested size, experimental on desktop, blocked in a browser', () => {
  assert.equal(combinedLevelTier(16384), 'ok');
  assert.equal(combinedLevelTier(32768, { desktop: true }), 'experimental');
  assert.equal(combinedLevelTier(32768), 'disabled');
});

test('terrain file size and the shaking distance', () => {
  assert.ok(Math.abs(terrainFileGB(32768) - 3.22) < 0.01);
  assert.equal(reachesShakeDistance(32.8), false);   // 32768 px at 1 m: 16 km out
  assert.equal(reachesShakeDistance(65.5), true);    // 8192 px at 8 m: 33 km out
});
