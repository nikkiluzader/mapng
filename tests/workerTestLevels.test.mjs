import test from 'node:test';
import assert from 'node:assert/strict';
import { testLevelKey, handleTestLevels } from '../worker/testLevels.js';

test('test levels: the manifest and level zips only, nothing else from the bucket', async () => {
  assert.equal(testLevelKey('/api/test-levels'), 'test-levels/manifest.json');
  assert.equal(testLevelKey('/api/test-levels/mapng_test_roads_na_east.zip'), 'test-levels/mapng_test_roads_na_east.zip');
  for (const bad of ['/api/test-levels/../osm/x.zip', '/api/test-levels/manifest.json.zip', '/api/test-levels/x.zip', '/api/test-levels/mapng_A.zip', '/api/test-levels/mapng_a.pmtiles']) assert.equal(testLevelKey(bad), null, bad);
  const store = { 'test-levels/mapng_x.zip': { body: 'zipbytes', size: 8, httpEtag: '"e"' } };
  const env = { OSM_TILES: { get: async (k) => store[k] || null } };
  const r = await handleTestLevels(new Request('https://x/api/test-levels/mapng_x.zip'), new URL('https://x/api/test-levels/mapng_x.zip'), env);
  assert.equal(r.status, 200); assert.equal(r.headers.get('Content-Type'), 'application/zip'); assert.match(r.headers.get('Content-Disposition'), /mapng_x\.zip/);
  assert.equal((await handleTestLevels(new Request('https://x/api/test-levels/mapng_y.zip'), new URL('https://x/api/test-levels/mapng_y.zip'), env)).status, 404);
  assert.equal((await handleTestLevels(new Request('https://x/api/test-levels/mapng_x.zip', { method: 'POST' }), new URL('https://x/api/test-levels/mapng_x.zip'), env)).status, 405);
});
