// The source tried when the chosen elevation source has nothing for a place, before the global 30 m.
import test from 'node:test';
import assert from 'node:assert/strict';
import { elevationTryOrder, normalizeFallbackSource, sourceTakesFallback } from '../services/elevationFallback.js';

test('the chosen source first, the fallback second, each once', () => {
  assert.deepEqual(elevationTryOrder({ useKRON86: true, fallbackSource: 'mapterhorn' }), ['kron86', 'mapterhorn']);
  assert.deepEqual(elevationTryOrder({ useMapterhorn: true, fallbackSource: 'usgs' }), ['mapterhorn', 'usgs']);
  // (no fallback, or the global 30 m named as one: as it always was)
  assert.deepEqual(elevationTryOrder({ useKRON86: true }), ['kron86']);
  assert.deepEqual(elevationTryOrder({ useKRON86: true, fallbackSource: 'standard' }), ['kron86']);
  // (the chosen source is never its own fallback)
  assert.deepEqual(elevationTryOrder({ useMapterhorn: true, fallbackSource: 'mapterhorn' }), ['mapterhorn']);
  // (the global 30 m or flat ground chosen: nothing to fall back from)
  assert.deepEqual(elevationTryOrder({ fallbackSource: 'mapterhorn' }), []);
  // (several switched on, as a batch can: their old order, then the fallback)
  assert.deepEqual(elevationTryOrder({ useUSGS: true, useGPXZ: true, fallbackSource: 'mapterhorn' }), ['gpxz', 'usgs', 'mapterhorn']);
});

test('a stored fallback is a known source and never the chosen one', () => {
  assert.equal(normalizeFallbackSource('mapterhorn', 'kron86'), 'mapterhorn');
  assert.equal(normalizeFallbackSource('MAPTERHORN', 'kron86'), 'mapterhorn');
  assert.equal(normalizeFallbackSource('kron86', 'kron86'), 'standard');
  assert.equal(normalizeFallbackSource('nonsense', 'kron86'), 'standard');
  assert.equal(normalizeFallbackSource(null, 'kron86'), 'standard');
  // (sources with no fallback: the global 30 m itself, flat ground)
  assert.equal(normalizeFallbackSource('mapterhorn', 'default'), 'standard');
  assert.equal(normalizeFallbackSource('mapterhorn', 'none'), 'standard');
  assert.ok(sourceTakesFallback('kron86') && sourceTakesFallback('usgs') && !sourceTakesFallback('default') && !sourceTakesFallback('none'));
});
