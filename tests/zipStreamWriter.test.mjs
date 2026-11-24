import test from 'node:test';
import assert from 'node:assert/strict';
import JSZip from 'jszip';
import { createZipStreamWriter, memorySink } from '../services/zipStreamWriter.js';
import { zipIndex } from '../services/zipIndex.js';

const collect = () => { const parts = []; return { write: (b) => { parts.push(b); }, bytes: () => Buffer.concat(parts.map((p) => Buffer.from(p))) }; };

test('a small zip: every file back, text deflated, pictures stored, read by JSZip and MapNG\'s reader', async () => {
  const sink = collect(); const w = createZipStreamWriter(sink);
  await w.add('levels/x/info.json', JSON.stringify({ title: 'Ünïcode name', pad: 'x'.repeat(500) }));
  await w.add('levels/x/pic.png', new Uint8Array(300).fill(9));
  await w.add('levels/x/info.json', 'second add of a name is ignored');
  const r = await w.finish();
  assert.equal(r.files, 2); assert.equal(r.zip64, false);
  const buf = sink.bytes();
  const z = await JSZip.loadAsync(buf);
  assert.equal(JSON.parse(await z.file('levels/x/info.json').async('string')).title, 'Ünïcode name');
  assert.deepEqual([...(await z.file('levels/x/pic.png').async('uint8array'))].slice(0, 3), [9, 9, 9]);
  const idx = await zipIndex(async (o, n) => new Uint8Array(buf.subarray(o, o + n)), buf.length);
  assert.deepEqual(idx.map((e) => e.name).sort(), ['levels/x/info.json', 'levels/x/pic.png']);
});

// JSZip writes a wrapped count past 65,535 files (70,000 came out as 4,466) and no ZIP64 record: MapNG's own reader then
// missed a big level's files. This writer adds the ZIP64 records.
test('past 65,535 files the ZIP64 records are written and the count reads back whole', async () => {
  const sink = collect(); const w = createZipStreamWriter(sink, { compress: false });
  for (let i = 0; i < 66000; i++) w.add(`f${i}`, 'x');
  const r = await w.finish();
  assert.equal(r.zip64, true);
  const buf = sink.bytes();
  const idx = await zipIndex(async (o, n) => new Uint8Array(buf.subarray(o, o + n)), buf.length);
  assert.equal(idx.length, 66000);
});

test('the memory sink makes a Blob of what was written', async () => {
  const m = memorySink(); const w = createZipStreamWriter(m);
  await w.add('a.txt', 'hello'); await w.finish();
  const z = await JSZip.loadAsync(await m.blob().arrayBuffer());
  assert.equal(await z.file('a.txt').async('string'), 'hello');
});
