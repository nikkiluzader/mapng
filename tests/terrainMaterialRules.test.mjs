import test from 'node:test';
import assert from 'node:assert/strict';

import { areaMatIndex, MATERIAL_NAMES } from '../services/osmTerrainMaterials.js';

const mat = (tags) => MATERIAL_NAMES[areaMatIndex({ type: 'landuse', tags, geometry: [] })];

test('a railway platform area is paving, not the grass ground cover grows on (coverage level, 2026-11-24)', () => {
  assert.equal(mat({ railway: 'platform' }), 'Concrete');
  assert.equal(mat({ public_transport: 'platform' }), 'Concrete');
  assert.notEqual(mat({ railway: 'platform', surface: 'grass' }), 'Concrete', 'a tagged surface still decides');
});
