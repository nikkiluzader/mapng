// MapNG's lakes and rivers ask the game for no occlusion query (services/exportBeamNGLevel.js water templates).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

test('lake tiles and rivers switch the per-object occlusion query off; they have no planar reflection', () => {
  const src = fs.readFileSync(new URL('../services/exportBeamNGLevel.js', import.meta.url), 'utf8');
  for (const name of ['WATER_BLOCK_TEMPLATE', 'RIVER_TEMPLATE']) {
    const at = src.indexOf(`const ${name} = {`); assert.ok(at > 0, name);
    const body = src.slice(at, src.indexOf('\n};', at));
    assert.match(body, /fullReflect: false/);
    assert.match(body, /useOcclusionQuery: false/);
  }
});
