import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { stepHash, memoryStepCache, cachedStep } from '../services/stepCache.js';
import { diskStepCache } from '../desktop/runner/diskStepCache.mjs';

test('step keys change with any input, bytes included', () => {
  const a = stepHash('backdrop', { n: 1 }, new Uint16Array([1, 2, 3]));
  assert.equal(a, stepHash('backdrop', { n: 1 }, new Uint16Array([1, 2, 3])));
  assert.notEqual(a, stepHash('backdrop', { n: 1 }, new Uint16Array([1, 2, 4])));
  assert.notEqual(a, stepHash('backdrop', { n: 2 }, new Uint16Array([1, 2, 3])));
});

test('a cached step is built once, then reused; the memory store drops the least recently used', async () => {
  const store = memoryStepCache({ maxBytes: 100 });
  let builds = 0;
  const build = async () => { builds++; return { data: new Uint8Array(40) }; };
  assert.equal((await cachedStep(store, 'a', build)).reused, false);
  assert.equal((await cachedStep(store, 'a', build)).reused, true);
  assert.equal(builds, 1);
  await cachedStep(store, 'b', build);
  await store.get('a');                 // (a used: b is the oldest)
  await cachedStep(store, 'c', build);  // over 100 bytes: b goes
  assert.equal(await store.get('b'), null);
  assert.ok(await store.get('a') && await store.get('c'));
  // no store, or no key: just built
  assert.equal((await cachedStep(null, 'a', build)).reused, false);
});

test('the desktop runner\'s disk store keeps Blobs and byte arrays across processes', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mapng-steps-'));
  try {
    const store = diskStepCache(dir);
    const value = { daeBlob: new Blob(['<COLLADA/>'], { type: 'model/vnd.collada+xml' }), textureFiles: [{ name: 't0', ext: 'png', data: new Uint8Array([1, 2, 3]) }], materialNames: ['m0'], diagnostics: { tiles: 8 } };
    await store.set('k1', value);
    const back = await diskStepCache(dir).get('k1');
    assert.equal(await back.daeBlob.text(), '<COLLADA/>');
    assert.equal(back.daeBlob.type, 'model/vnd.collada+xml');
    assert.deepEqual([...back.textureFiles[0].data], [1, 2, 3]);
    assert.ok(back.textureFiles[0].data instanceof Uint8Array);
    assert.deepEqual(back.materialNames, ['m0']);
    assert.deepEqual(back.diagnostics, { tiles: 8 });
    assert.equal(await store.get('missing'), null);
    assert.equal(await store.get('../escape'), null);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('already-compressed entries are stored, not deflated again; the rest still deflates', async () => {
  const JSZip = (await import('jszip')).default;
  const { storeCompressedEntries } = await import('../services/zipCompress.js');
  const zip = new JSZip();
  zip.file('levels/x/preview.png', new Uint8Array(5000).map((_, i) => (i * 7919) % 251));
  zip.file('levels/x/sky.dds', new Uint8Array(100));
  zip.file('levels/x/info.json', '{"a":1}'.repeat(500));
  assert.equal(storeCompressedEntries(zip), 2);
  const back = await JSZip.loadAsync(await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' }));
  assert.equal(back.file('levels/x/preview.png')._data.compression.magic, '\x00\x00', 'stored');
  assert.equal(back.file('levels/x/info.json')._data.compression.magic, '\x08\x00', 'deflated');
  assert.equal((await back.file('levels/x/preview.png').async('uint8array')).length, 5000);
});
