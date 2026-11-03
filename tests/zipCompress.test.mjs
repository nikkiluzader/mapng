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
