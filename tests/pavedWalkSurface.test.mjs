import test from 'node:test';
import assert from 'node:assert/strict';
import { pavedWalkSurface } from '../services/plazas.js';

test('a walk is laid in its surface: asphalt as asphalt, concrete and untagged as the plain slab', () => {
  assert.equal(pavedWalkSurface('asphalt'), 'asphalt');
  assert.equal(pavedWalkSurface('concrete'), null);
  assert.equal(pavedWalkSurface(''), null);
  assert.equal(pavedWalkSurface('sett'), 'sett');
  assert.equal(pavedWalkSurface('paving_stones', { americas: true }), 'bricks');
});
