import test from 'node:test';
import assert from 'node:assert/strict';
import { ensureTexture, hasTexture, texturesToGenerate, textureKindOf } from '../services/textureOnDemand.js';

test('Generate paints only the chosen ground texture', () => {
  assert.deepEqual(texturesToGenerate('game'), { generateOSMTextureAsset: false, generateHybridTextureAsset: false, generateGameTextureAsset: true });
  assert.deepEqual(texturesToGenerate('osm'), { generateOSMTextureAsset: true, generateHybridTextureAsset: false, generateGameTextureAsset: false });
  // (the touched-up texture starts from the hybrid; the satellite picture and "none" need no painting)
  assert.equal(texturesToGenerate('painted').generateHybridTextureAsset, true);
  for (const none of ['satellite', 'none', undefined]) assert.deepEqual(Object.values(texturesToGenerate(none)), [false, false, false]);
  assert.equal(textureKindOf('painted'), 'hybrid'); assert.equal(textureKindOf('satellite'), null);
});

test('a missing texture is painted once when asked for, and written to both copies of the terrain', async () => {
  let calls = 0;
  const generators = { game: async (td, o) => { calls++; assert.equal(o.Roads, true); await new Promise((r) => setTimeout(r, 5)); return { url: 'blob:game', canvas: { w: td.width }, blob: { size: 9 } }; } };
  const td = { width: 512, osmFeatures: [{ type: 'road' }], osmTextureUrl: 'blob:osm' };
  const page = {};
  assert.equal(hasTexture(td, 'game'), false); assert.equal(hasTexture(td, 'osm'), true);
  // two askers at once (the preview and the export): one painting
  const [a, b] = await Promise.all([ensureTexture(td, 'game', { generators, assignTo: page }), ensureTexture(td, 'game', { generators, assignTo: page })]);
  assert.equal(a, true); assert.equal(b, true); assert.equal(calls, 1);
  assert.equal(td.gameTextureUrl, 'blob:game'); assert.equal(page.gameTextureUrl, 'blob:game'); assert.equal(page.gameTextureCanvas.w, 512);
  // already there: nothing painted
  assert.equal(await ensureTexture(td, 'game', { generators }), true); assert.equal(await ensureTexture(td, 'osm', { generators }), true); assert.equal(calls, 1);
});

test('nothing is painted without map data, or for a choice that needs no painting', async () => {
  const generators = { game: async () => { throw new Error('must not run'); } };
  assert.equal(await ensureTexture({ width: 512, osmFeatures: [] }, 'game', { generators }), false);
  assert.equal(await ensureTexture({ width: 512, osmFeatures: [{}] }, 'satellite', { generators }), false);
  assert.equal(await ensureTexture(null, 'game', { generators }), false);
  // a failed painting is not remembered: the next ask tries again
  let n = 0; const flaky = { game: async () => { if (n++ === 0) throw new Error('out of memory'); return { url: 'u', canvas: {}, blob: null }; } };
  const td = { width: 8, osmFeatures: [{}] };
  await assert.rejects(() => ensureTexture(td, 'game', { generators: flaky }), /out of memory/);
  assert.equal(await ensureTexture(td, 'game', { generators: flaky }), true);
});
