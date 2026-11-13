// Export > Surroundings: which elevation sources the backdrop can use for a map (services/backdropSources.js).
import test from 'node:test';
import assert from 'node:assert/strict';
import { BACKDROP_SOURCES, backdropSourceCovers, effectiveBackdropSource } from '../services/backdropSources.js';
import { EXPORT_FIELDS } from '../services/sessionConfig.js';

const box = (lat, lng) => ({ south: lat - 0.02, north: lat + 0.02, west: lng - 0.03, east: lng + 0.03 });
const poland = box(49.6, 19.9); const utah = box(40.6, -111.8); const alps = box(45.47, 6.9);

test('Mapterhorn and the Poland model are backdrop sources, and can be saved and shared', () => {
  assert.ok(BACKDROP_SOURCES.includes('mapterhorn') && BACKDROP_SOURCES.includes('kron86'));
  const field = EXPORT_FIELDS.find((f) => f[1] === 'mapng_beamNGBackdropSource');
  assert.deepEqual([...field[2]].sort(), [...BACKDROP_SOURCES].sort());
});

test('USGS 1 m covers the United States only; the Poland model, Poland only', () => {
  assert.equal(backdropSourceCovers('usgs1m', utah), true);
  assert.equal(backdropSourceCovers('usgs1m', poland), false);
  assert.equal(backdropSourceCovers('usgs1m', alps), false);
  assert.equal(backdropSourceCovers('kron86', poland), true);
  assert.equal(backdropSourceCovers('kron86', utah), false);
  for (const b of [utah, poland, alps]) { assert.equal(backdropSourceCovers('mapterhorn', b), true); assert.equal(backdropSourceCovers('global30m', b), true); }
});

test('a source with nothing for the map gives the 30 m backdrop, never none', () => {
  assert.equal(effectiveBackdropSource('usgs1m', poland), 'global30m');
  assert.equal(effectiveBackdropSource('kron86', poland), 'kron86');
  assert.equal(effectiveBackdropSource('gpxz', utah), 'global30m');
  assert.equal(effectiveBackdropSource('gpxz', utah, { gpxzOk: true }), 'gpxz');
  assert.equal(effectiveBackdropSource('off', poland), 'off');
  assert.equal(effectiveBackdropSource('something-old', poland), 'global30m');
});
