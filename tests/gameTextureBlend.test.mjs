// The Game texture's "Satellite detail" setting (services/gameTextureBlend.js).
import test from 'node:test';
import assert from 'node:assert/strict';

const store = new Map();
globalThis.localStorage = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)) };
const { readGameTextureBlend, writeGameTextureBlend, gameTextureBlendStrength, DEFAULT_GAME_TEXTURE_BLEND } = await import('../services/gameTextureBlend.js');

test('the default is the look the texture has had: 50 %, strength 1', () => {
  assert.equal(readGameTextureBlend(), DEFAULT_GAME_TEXTURE_BLEND);
  assert.equal(gameTextureBlendStrength(50), 1);
  assert.equal(gameTextureBlendStrength(0), 0);
  assert.equal(gameTextureBlendStrength(100), 2);
});

test('the setting is remembered, kept within 0..100; junk falls back to the default', () => {
  writeGameTextureBlend(20); assert.equal(readGameTextureBlend(), 20);
  writeGameTextureBlend(0); assert.equal(readGameTextureBlend(), 0, '0 is a choice, not "unset"');
  writeGameTextureBlend(250); assert.equal(readGameTextureBlend(), 100);
  store.set('mapng_gameTextureBlend', 'lots'); assert.equal(readGameTextureBlend(), DEFAULT_GAME_TEXTURE_BLEND);
  assert.equal(gameTextureBlendStrength('junk'), 1);
});

test('at 0 the painter blends nothing in', async () => {
  const { addSatelliteDetail } = await import('../services/osmTexture.js');
  // (returns before touching the canvas)
  assert.equal(await addSatelliteDetail(null, null, null, { strength: 0 }), null);
});
