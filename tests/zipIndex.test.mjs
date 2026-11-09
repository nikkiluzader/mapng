import test from 'node:test';
import assert from 'node:assert/strict';
import JSZip from 'jszip';
import { zipIndex, levelZipProblems } from '../services/zipIndex.js';

const reader = (buf) => async (o, n) => buf.subarray(o, o + n);

test('a level zip\'s table of contents, read from its end; a whole level passes, a broken one says why', async () => {
  const zip = new JSZip();
  const base = 'levels/demo';
  zip.file(`${base}/info.json`, '{}');
  zip.file(`${base}/mapng.json`, '{}');
  zip.file(`${base}/main/MissionGroup/items.level.json`, '');
  zip.file(`${base}/art/terrains/terrain.ter`, new Uint8Array(100));
  const buf = await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
  const entries = await zipIndex(reader(buf), buf.length);
  assert.ok(entries.some((e) => e.name === `${base}/art/terrains/terrain.ter` && e.size === 100));
  assert.deepEqual(levelZipProblems(entries), []);
  assert.deepEqual(levelZipProblems(entries, 'demo'), []);
  // a missing file, a truncated zip, not a zip
  zip.remove(`${base}/mapng.json`);
  const buf2 = await zip.generateAsync({ type: 'uint8array' });
  assert.deepEqual(levelZipProblems(await zipIndex(reader(buf2), buf2.length)), ['levels/demo/mapng.json is missing']);
  const cut = buf.subarray(0, buf.length - 30);
  assert.deepEqual(levelZipProblems(await zipIndex(reader(cut), cut.length)), ['the file is not a readable zip']);
  const junk = new Uint8Array(500).fill(7);
  assert.equal(await zipIndex(reader(junk), junk.length), null);
});
