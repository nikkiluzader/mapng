import test from 'node:test';
import assert from 'node:assert/strict';
import { __filterOSMFeaturesToBounds as filter } from '../services/exportBeamNGLevel.js';

test('a bridge spanning the area with its vertices on both banks outside it is kept', () => {
  const bounds = { north: 1, south: -1, west: -1, east: 1 };
  const span = { type: 'road', geometry: [{ lat: 0, lng: -5 }, { lat: 0.2, lng: 5 }] };
  const away = { type: 'road', geometry: [{ lat: 3, lng: -5 }, { lat: 3, lng: 5 }] };
  const inside = { type: 'road', geometry: [{ lat: 0, lng: 0 }, { lat: 0.5, lng: 0.5 }] };
  assert.deepEqual(filter([span, away, inside], bounds), [span, inside]);
});
