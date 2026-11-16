import test from 'node:test';
import assert from 'node:assert/strict';
import { assetPageKey, assetPageOn, handleAssetPage } from '../worker/assetPage.js';

const bucket = (files) => ({ get: async (k) => (k in files ? { body: files[k], httpEtag: '"e"' } : null) });
const ask = (path, env, method = 'GET') => handleAssetPage(new Request(`https://x${path}`, { method }), new URL(`https://x${path}`), env);

test('only the data file and photo names map to storage keys', () => {
  assert.equal(assetPageKey('/api/asset-page/data.json'), 'asset-page/data.json');
  assert.equal(assetPageKey('/api/asset-page/t/00012_bench.jpg'), 'asset-page/t/00012_bench.jpg');
  for (const bad of ['/api/asset-page/', '/api/asset-page/t/../data.json', '/api/asset-page/t/a/b.jpg', '/api/asset-page/other.json', '/api/asset-page/t/x.png', '/api/asset-page/t/%2e%2e.jpg']) assert.equal(assetPageKey(bad), null, bad);
});

test('served only where ASSET_PAGE is 1: the public site answers 404', async () => {
  const files = { 'asset-page/data.json': '{}', 'asset-page/t/a.jpg': 'x' };
  assert.equal(assetPageOn({}), false); assert.equal(assetPageOn({ ASSET_PAGE: '1' }), true);
  assert.equal((await ask('/api/asset-page/data.json', { OSM_TILES: bucket(files) })).status, 404);
  const on = { ASSET_PAGE: '1', OSM_TILES: bucket(files) };
  const r = await ask('/api/asset-page/data.json', on);
  assert.equal(r.status, 200); assert.match(r.headers.get('Content-Type'), /json/); assert.match(r.headers.get('Cache-Control'), /private/);
  assert.equal((await ask('/api/asset-page/t/a.jpg', on)).headers.get('Content-Type'), 'image/jpeg');
  assert.equal((await ask('/api/asset-page/t/missing.jpg', on)).status, 404);
  assert.equal((await ask('/api/asset-page/data.json', on, 'POST')).status, 405);
});
