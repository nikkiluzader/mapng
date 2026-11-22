import test from 'node:test';
import assert from 'node:assert/strict';
import JSZip from 'jszip';
import { precompressZipEntries } from '../services/zipCompress.js';

// The level ZIP's big entries compressed natively before JSZip writes it:
// unzipped, each must be byte for byte what was added, with a good CRC.
test('precompressed entries unzip to exactly what was added', async () => {
  const zip = new JSZip();
  const text = Array.from({ length: 40000 }, (_, i) => `<p>${i} ${Math.sin(i)}</p>`).join('\n');
  const bytes = new Uint8Array(300000).map((_, i) => (i * 7919) % 251);
  zip.file('levels/x/a.dae', text);
  zip.file('levels/x/b.ter', bytes);
  zip.file('levels/x/small.json', '{"a":1}');
  zip.file('levels/x/t.png', new Uint8Array(100000));
  const n = await precompressZipEntries(zip, JSZip);
  assert.equal(n, 2, 'the two big, compressible entries');
  const out = await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
  const back = await JSZip.loadAsync(out, { checkCRC32: true });
  assert.equal(await back.file('levels/x/a.dae').async('string'), text);
  assert.deepEqual(await back.file('levels/x/b.ter').async('uint8array'), bytes);
  assert.equal(await back.file('levels/x/small.json').async('string'), '{"a":1}');
  assert.equal((await back.file('levels/x/t.png').async('uint8array')).length, 100000);
  const dae = back.file('levels/x/a.dae')._data;
  assert.ok(dae.compressedSize < dae.uncompressedSize / 2, 'compressed');
});

// Entries compressed as they are added (the export's eager path), the rest at
// the end: all unzip to what was added.
test('eager and final compression together', async () => {
  const { createZipCompressor } = await import('../services/zipCompress.js');
  const zip = new JSZip();
  const c = await createZipCompressor(JSZip, { inFlightBytes: 200000 });
  const texts = Array.from({ length: 8 }, (_, i) => `entry ${i} `.repeat(30000));
  texts.forEach((s, i) => { zip.file(`e${i}.dae`, s); c.add(zip.files[`e${i}.dae`]); });
  zip.file('late.json', 'late '.repeat(30000));
  const n = await precompressZipEntries(zip, JSZip, { compressor: c });
  assert.equal(n, 9);
  const back = await JSZip.loadAsync(await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' }), { checkCRC32: true });
  for (let i = 0; i < 8; i++) assert.equal(await back.file(`e${i}.dae`).async('string'), texts[i]);
  assert.equal(await back.file('late.json').async('string'), 'late '.repeat(30000));
});

// A big entry (deflated in pieces on several threads in Node) unzips whole.
test('a big entry deflated in pieces unzips to exactly what was added', async () => {
  const zip = new JSZip();
  const line = (i) => `<v>${i} ${(i * 0.001).toFixed(3)} ${i % 97}</v>\n`;
  let text = ''; for (let i = 0; text.length < 40 * 2 ** 20; i++) text += line(i);
  zip.file('big.dae', text);
  assert.equal(await precompressZipEntries(zip, JSZip), 1);
  const back = await JSZip.loadAsync(await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' }), { checkCRC32: true });
  assert.equal(await back.file('big.dae').async('string'), text);
});

// A building tile is compressed as it is made, its compressed bytes kept in the step cache, and put into the next
// export's zip as they are (packedOf / putPacked): unzipped, byte for byte what it was.
test('an entry kept compressed and put back unzips as it was', async () => {
  const { createZipCompressor } = await import('../services/zipCompress.js');
  const text = 'bld '.repeat(40000);
  const a = new JSZip();
  const c = await createZipCompressor(JSZip);
  assert.ok(c, 'compressor');
  a.file('t.dae', text);
  c.add(a.files['t.dae']);
  await c.drain();
  const kept = c.packedOf(a.files['t.dae']);
  assert.ok(kept && kept.packed.length < text.length / 10, 'compressed');
  assert.equal(kept.size, text.length);
  const b = new JSZip();
  c.putPacked(b, 'levels/x/t.dae', kept);
  const back = await JSZip.loadAsync(await b.generateAsync({ type: 'uint8array' }));
  assert.equal(await back.file('levels/x/t.dae').async('string'), text);
  assert.equal(c.packedOf({ _data: 'small' }), null);
});

// A level's building tiles kept by the step cache (desktop: on disk) and put into the next export's zip: small
// tiles are never compressed and handed over as a promise, and must come back as their bytes (report MR-H5AWFT:
// kept as JSZip's own object, they came back {} and the second export failed).
test('entries kept for the disk step cache go into the next zip intact', async () => {
  const fs = await import('node:fs');
  const os = await import('node:os');
  const path = await import('node:path');
  const { createZipCompressor } = await import('../services/zipCompress.js');
  const { diskStepCache } = await import('../desktop/runner/diskStepCache.mjs');
  const big = 'big tile '.repeat(40000);
  const small = '<COLLADA>small</COLLADA>';
  const zip = new JSZip();
  const c = await createZipCompressor(JSZip);
  // (as the export hands a tile over: its text as a promise of bytes)
  for (const [name, text] of [['big.dae', big], ['small.dae', small]]) {
    zip.file(name, Promise.resolve(new TextEncoder().encode(text)));
    c.add(zip.files[name]);
  }
  await c.drain();
  const kept = { tiles: [await c.keepableOf(zip.files['big.dae']), await c.keepableOf(zip.files['small.dae'])] };
  assert.ok(kept.tiles[0].packed, 'the big tile kept compressed');
  assert.ok(kept.tiles[1].data instanceof Uint8Array, 'the small tile kept as bytes');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mapng-stepcache-'));
  try {
    const store = diskStepCache(dir);
    await store.set('k', kept);
    const back = await store.get('k');
    const zip2 = new JSZip();
    const c2 = await createZipCompressor(JSZip);
    c2.putPacked(zip2, 'big.dae', back.tiles[0].packed);
    zip2.file('small.dae', back.tiles[1].data);
    const out = await JSZip.loadAsync(await zip2.generateAsync({ type: 'uint8array', compression: 'DEFLATE' }), { checkCRC32: true });
    assert.equal(await out.file('big.dae').async('string'), big);
    assert.equal(await out.file('small.dae').async('string'), small);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
