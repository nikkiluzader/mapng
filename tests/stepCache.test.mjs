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

test('a terrain\'s fingerprint never turns all its map features into one text', async () => {
  const { terrainFingerprint, featuresHash } = await import('../services/stepCache.js');
  const feats = Array.from({ length: 1700 }, (_, i) => ({ id: i, type: 'building', geometry: [{ lat: i, lng: -i }], tags: { name: `b${i}` } }));
  // (a list that refuses to be written out whole, as a 33 km city's did: past the longest string there is)
  const guarded = feats.slice(); guarded.toJSON = () => { throw new RangeError('Invalid string length'); };
  const td = (osmFeatures) => ({ width: 4, height: 4, heightMap: new Float32Array(16), osmFeatures });
  const a = terrainFingerprint(td(guarded));
  assert.equal(a, terrainFingerprint(td(feats)), 'the same features, the same fingerprint');
  // one feature changed, anywhere in the list: another fingerprint
  for (const at of [0, 499, 500, 1699]) {
    const other = feats.slice(); other[at] = { ...other[at], tags: { name: 'changed' } };
    assert.notEqual(terrainFingerprint(td(other)), a, `feature ${at}`);
  }
  assert.notEqual(featuresHash(feats.slice(0, 1699)), featuresHash(feats));
  assert.equal(featuresHash(null), featuresHash([]));
});

test('a building task whose features come in several strings reads back as one list', async () => {
  const { taskItem } = await import('../services/buildingWorker.js');
  const features = Array.from({ length: 7 }, (_, i) => ({ id: i, type: 'building' }));
  const task = { head: JSON.stringify({ extras: 'water', maxBuildings: 5 }), featureChunks: [JSON.stringify(features.slice(0, 3)), JSON.stringify(features.slice(3))] };
  const item = taskItem(task);
  assert.equal(item.extras, 'water'); assert.equal(item.maxBuildings, 5);
  assert.deepEqual(item.features, features);
  assert.deepEqual(taskItem(JSON.stringify({ features: [1] })), { features: [1] }, 'one string, as before');
});

test('the elevation tile relay serves tile addresses only', async () => {
  const { parseTerrariumPath, handleTerrariumTiles } = await import('../worker/terrariumRelay.js');
  assert.deepEqual(parseTerrariumPath('/api/terrarium/14/9857/5304.png'), { z: 14, x: 9857, y: 5304 });
  for (const bad of ['/api/terrarium/16/1/1.png', '/api/terrarium/3/9/1.png', '/api/terrarium/3/1/1.jpg', '/api/terrarium/../secret', '/api/terrarium/3/1/1.png/extra']) assert.equal(parseTerrariumPath(bad), null, bad);
  const asked = [];
  const ok = await handleTerrariumTiles(new Request('https://mapng.com/api/terrarium/14/9857/5304.png'), new URL('https://mapng.com/api/terrarium/14/9857/5304.png'), { fetchImpl: async (u) => { asked.push(u); return new Response('png', { status: 200 }); } });
  assert.equal(ok.status, 200); assert.equal(ok.headers.get('content-type'), 'image/png');
  assert.deepEqual(asked, ['https://s3.amazonaws.com/elevation-tiles-prod/terrarium/14/9857/5304.png']);
  const no = await handleTerrariumTiles(new Request('https://mapng.com/api/terrarium/20/1/1.png'), new URL('https://mapng.com/api/terrarium/20/1/1.png'), { fetchImpl: async () => { throw new Error('not asked'); } });
  assert.equal(no.status, 404);
  const post = await handleTerrariumTiles(new Request('https://mapng.com/api/terrarium/3/1/1.png', { method: 'POST' }), new URL('https://mapng.com/api/terrarium/3/1/1.png'));
  assert.equal(post.status, 405);
});

test('a global elevation tile made from a Mapterhorn tile: the same heights, in the same encoding', async () => {
  // a small stand-in for the canvas this runs on
  const made = [];
  const prev = globalThis.document;
  globalThis.document = { createElement: () => { const c = { width: 0, height: 0, getContext: () => ({ createImageData: (w, h) => ({ data: new Uint8ClampedArray(w * h * 4), width: w, height: h }), putImageData: (img) => { c.image = img; } }) }; made.push(c); return c; } };
  try {
    const { terrariumTileFromMapterhorn } = await import('../services/terrain.js');
    // Mapterhorn tile 13/10/20 (512 px): height = 100 + column, no data in its last row
    const heights = new Float32Array(512 * 512);
    for (let r = 0; r < 512; r++) for (let c = 0; c < 512; c++) heights[r * 512 + c] = r === 511 ? -99999 : 100 + c;
    const asked = [];
    const load = async (z, x, y) => { asked.push(`${z}/${x}/${y}`); return z === 13 && x === 10 && y === 20 ? heights : null; };
    // the 256 px tile 14/21/40 is the top right quarter of it
    const tile = await terrariumTileFromMapterhorn({ z: 14, x: 21, y: 40 }, null, load);
    assert.deepEqual(asked, ['13/10/20']);
    const d = tile.image.data; const heightAt = (c, r) => d[(r * 256 + c) * 4] * 256 + d[(r * 256 + c) * 4 + 1] + d[(r * 256 + c) * 4 + 2] / 256 - 32768;
    assert.ok(Math.abs(heightAt(0, 0) - (100 + 256)) < 0.01, String(heightAt(0, 0)));
    assert.ok(Math.abs(heightAt(255, 10) - (100 + 511)) < 0.01);
    // a zoom deeper with no Mapterhorn tile at that depth: its ancestor's heights, stretched (a quarter pixel a step)
    const deep = await terrariumTileFromMapterhorn({ z: 15, x: 42, y: 80 }, null, load);
    const e = deep.image.data; const h2 = (c) => e[c * 4] * 256 + e[c * 4 + 1] + e[c * 4 + 2] / 256 - 32768;
    assert.ok(Math.abs(h2(100) - h2(99) - 0.5) < 0.02, `step ${h2(100) - h2(99)}`);
    // no data stays no data (the tile's last row), and a tile too coarse for Mapterhorn's cache is left to the next way
    const low = await terrariumTileFromMapterhorn({ z: 14, x: 20, y: 41 }, null, load);
    const l = low.image.data; assert.equal(l[(255 * 256 + 5) * 4] + l[(255 * 256 + 5) * 4 + 1] + l[(255 * 256 + 5) * 4 + 2], 0);
    assert.equal(await terrariumTileFromMapterhorn({ z: 12, x: 5, y: 5 }, null, load), null);
  } finally { globalThis.document = prev; }
});
