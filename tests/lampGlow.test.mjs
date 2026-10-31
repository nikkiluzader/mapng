import test from 'node:test';
import assert from 'node:assert/strict';
import './../scripts/sweep/polyfill.mjs';
import { glowDetailSizes, buildLampGlowDAE, lampGlowMaterialDef } from '../services/lampGlow.js';

test('lamp glow: detail sizes fall from the speck to the last ball; one mesh per level; black by day', async () => {
  const sizes = glowDetailSizes();
  for (let i = 1; i < sizes.length; i++) assert.ok(sizes[i] < sizes[i - 1], JSON.stringify(sizes));
  const dae = buildLampGlowDAE();
  const text = typeof dae === 'string' ? dae : await dae.text();
  const names = [...new Set(text.match(/name="glow[a-z]\d+"/g))];
  assert.equal(names.length, sizes.length);
  const m = lampGlowMaterialDef();
  assert.deepEqual(m.Stages[0].baseColorFactor, [0, 0, 0, 1]);
  assert.equal(m.translucentBlendOp, 'Add');
  assert.equal(m.Stages[0].instanceEmissive, true, 'lit only by the night emissive');
});
