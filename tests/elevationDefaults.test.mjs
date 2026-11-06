import test from 'node:test';
import assert from 'node:assert/strict';

import { initialElevationSource, DEFAULT_ELEVATION_SOURCE } from '../services/elevationDefaults.js';

const store = (init = {}) => { const m = new Map(Object.entries(init)); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), m }; };

test('new users get Mapterhorn', () => {
  assert.equal(DEFAULT_ELEVATION_SOURCE, 'mapterhorn');
  assert.equal(initialElevationSource('mapng_elevationSource', store()), 'mapterhorn');
});

test('a saved Standard (the old default) moves to Mapterhorn once; switching back afterwards is kept', () => {
  const s = store({ mapng_elevationSource: 'default' });
  assert.equal(initialElevationSource('mapng_elevationSource', s), 'mapterhorn');
  assert.equal(s.m.get('mapng_elevationSource'), 'mapterhorn');
  s.setItem('mapng_elevationSource', 'default');                 // the user picks Standard again
  assert.equal(initialElevationSource('mapng_elevationSource', s), 'default');
});

test('other saved choices are kept, and marked so a later Standard is never moved', () => {
  const s = store({ mapng_batch_elevation: 'gpxz' });
  assert.equal(initialElevationSource('mapng_batch_elevation', s), 'gpxz');
  s.setItem('mapng_batch_elevation', 'default');
  assert.equal(initialElevationSource('mapng_batch_elevation', s), 'default');
});

test('storage that throws (private mode) still gives a source', () => {
  assert.equal(initialElevationSource('k', { getItem: () => { throw new Error('denied'); } }), 'mapterhorn');
});
