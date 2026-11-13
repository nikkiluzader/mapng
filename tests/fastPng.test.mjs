import test from 'node:test';
import assert from 'node:assert/strict';
import zlib from 'node:zlib';
import { decode } from 'fast-png';
import { encodePng } from '../desktop/runner/fastPng.mjs';

let seed = 99; const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
const picture = (w, h) => { const d = new Uint8ClampedArray(w * h * 4); for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const i = (y * w + x) * 4; d[i] = (x * 3 + y) & 255; d[i + 1] = (y * 5) & 255; d[i + 2] = rnd() * 255; d[i + 3] = (x + y) % 7 ? 255 : 128; } return d; };

test('a PNG written in pieces decodes to exactly the pixels given', async () => {
  // (1500 rows of 1024: several pieces, so their joins, the row above a piece and the joined checksum are all used)
  for (const [w, h] of [[1, 1], [3, 2], [1024, 1500], [257, 4099]]) {
    const src = picture(w, h);
    const png = await encodePng(src, w, h);
    const back = decode(png);
    assert.equal(back.width, w); assert.equal(back.height, h); assert.equal(back.channels, 4);
    assert.ok(Buffer.from(back.data.buffer, back.data.byteOffset, back.data.byteLength).equals(Buffer.from(src.buffer)), `${w} x ${h}`);
  }
});

test('opaque: three channels, the colours kept', async () => {
  const w = 640, h = 900; const src = picture(w, h);
  const back = decode(await encodePng(src, w, h, { opaque: true }));
  assert.equal(back.channels, 3);
  for (let p = 0; p < w * h; p += 97) for (let c = 0; c < 3; c++) assert.equal(back.data[p * 3 + c], src[p * 4 + c]);
});

test('the file is one valid zlib stream with the right checksum (a strict reader takes it)', async () => {
  const w = 800, h = 2100; const src = picture(w, h); const png = await encodePng(src, w, h);
  // the IDAT payload, inflated by zlib itself (which checks the Adler-32 at the end)
  let o = 8; let idat = null;
  while (o < png.length) { const len = png.readUInt32BE(o); const type = png.toString('latin1', o + 4, o + 8); if (type === 'IDAT') idat = png.subarray(o + 8, o + 8 + len); o += 12 + len; }
  const raw = zlib.inflateSync(idat);
  assert.equal(raw.length, h * (w * 4 + 1));
  await assert.rejects(() => encodePng(src, w + 1, h), /are not/);
});
