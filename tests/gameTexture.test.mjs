import test from 'node:test';
import assert from 'node:assert/strict';

import { classifyGround, GROUND_CLASSES, GAME_COLORS } from '../services/osmTexture.js';
import { isVegetationColor } from '../services/osmTerrainMaterials.js';

const cls = (r, g, b) => GROUND_CLASSES[classifyGround(r, g, b)];
const hex = (h) => [1, 3, 5].map((i) => Number.parseInt(h.slice(i, i + 2), 16));

test('satellite pixels sort into ground classes', () => {
  assert.equal(cls(38, 52, 30), 'trees', 'dark green canopy');
  assert.equal(cls(98, 122, 70), 'grass', 'lawn');
  assert.equal(cls(150, 150, 148), 'paved', 'concrete / roof grey');
  assert.equal(cls(210, 190, 150), 'sand', 'light sand');
  assert.equal(cls(140, 110, 80), 'soil', 'bare soil');
  assert.equal(cls(30, 50, 80), 'water', 'dark blue water');
  assert.equal(cls(20, 20, 22), 'shadow', 'shadows are filled from their neighbours');
});

test('game map colours: greens read as vegetation to the grass mask, paving and water do not', () => {
  for (const k of ['forest', 'grass', 'park', 'scrub', 'cemetery', 'sport', 'defaultLanduse']) {
    assert.ok(isVegetationColor(...hex(GAME_COLORS[k])), `${k} counts as vegetation`);
  }
  for (const k of ['commercial', 'industrial', 'retail', 'parking', 'building', 'buildingFill', 'water', 'sand', 'farmland', 'apron', 'runway']) {
    assert.ok(!isVegetationColor(...hex(GAME_COLORS[k])), `${k} does not grow grass`);
  }
});
