// A PNG written on many cores. @napi-rs/canvas encodes a picture on one thread: 10 to 13 s for an 8 km map's
// texture, three of them a Generate, and the process sat idle waiting for them. A PNG's pixel data is one
// zlib stream, but a zlib stream may be made of pieces compressed apart: each strip of rows is deflated on its
// own (Node's zlib, on the libuv thread pool, so as many at once as it has threads), ended on a byte boundary
// without closing the stream, and the pieces are joined under one header and one checksum. The picture decodes
// to exactly the pixels given (tests/fastPng.test.mjs).
import zlib from 'node:zlib';

const STRIP_BYTES = 4 << 20;   // about 4 MB of pixel rows a piece
const LEVEL = 3;               // fast; the Up filter below does most of the squeezing on a painted map

const CRC_TABLE = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
const crc32 = (bufs) => {
  if (typeof zlib.crc32 === 'function') { let c = 0; for (const b of bufs) c = zlib.crc32(b, c); return c >>> 0; }
  let c = 0xffffffff;
  for (const b of bufs) for (let i = 0; i < b.length; i++) c = CRC_TABLE[(c ^ b[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
// (Adler-32 of two pieces from each one's own: zlib's adler32_combine)
const ADLER = 65521;
const adlerOf = (buf) => { let a = 1, b = 0; for (let i = 0; i < buf.length;) { const end = Math.min(buf.length, i + 3800); for (; i < end; i++) { a += buf[i]; b += a; } a %= ADLER; b %= ADLER; } return [a, b]; };
const adlerJoin = ([a1, b1], [a2, b2], len2) => {
  const rem = len2 % ADLER;
  let a = (a1 + a2 + ADLER - 1) % ADLER;
  let b = (((rem * a1) % ADLER) + b1 + b2 + ADLER - rem) % ADLER;
  return [a, b];
};
const chunk = (type, datas) => {
  const len = datas.reduce((n, d) => n + d.length, 0);
  const head = Buffer.alloc(8); head.writeUInt32BE(len, 0); head.write(type, 4, 'latin1');
  const tail = Buffer.alloc(4); tail.writeUInt32BE(crc32([head.subarray(4), ...datas]), 0);
  return [head, ...datas, tail];
};
const deflateRaw = (buf, last) => new Promise((resolve, reject) => zlib.deflateRaw(buf, { level: LEVEL, finishFlush: last ? zlib.constants.Z_FINISH : zlib.constants.Z_SYNC_FLUSH }, (e, out) => (e ? reject(e) : resolve(out))));

/**
 * RGBA pixels (Uint8Array / Uint8ClampedArray, width * height * 4, not premultiplied) -> a PNG Buffer.
 * opaque: true drops the alpha channel (a map texture has none), a quarter less to write.
 */
export async function encodePng(rgba, width, height, { opaque = false } = {}) {
  const src = rgba instanceof Uint8Array ? rgba : new Uint8Array(rgba.buffer, rgba.byteOffset, rgba.byteLength);
  if (src.length !== width * height * 4) throw new Error(`encodePng: ${src.length} bytes are not ${width} x ${height} RGBA`);
  const bpp = opaque ? 3 : 4; const row = width * bpp + 1;
  const rowsPerStrip = Math.max(1, Math.floor(STRIP_BYTES / row));
  const jobs = [];
  for (let y0 = 0; y0 < height; y0 += rowsPerStrip) {
    const rows = Math.min(rowsPerStrip, height - y0);
    // (filter 2, "Up": each byte less the one above it; the strip's first row takes the row over the strip)
    const out = Buffer.allocUnsafe(rows * row);
    for (let r = 0; r < rows; r++) {
      const y = y0 + r; let o = r * row; out[o++] = y === 0 ? 0 : 2;
      let s = y * width * 4; let up = s - width * 4;
      if (y === 0) { for (let x = 0; x < width; x++, s += 4) { out[o++] = src[s]; out[o++] = src[s + 1]; out[o++] = src[s + 2]; if (!opaque) out[o++] = src[s + 3]; } }
      else for (let x = 0; x < width; x++, s += 4, up += 4) { out[o++] = src[s] - src[up]; out[o++] = src[s + 1] - src[up + 1]; out[o++] = src[s + 2] - src[up + 2]; if (!opaque) out[o++] = src[s + 3] - src[up + 3]; }
    }
    const last = y0 + rows >= height;
    jobs.push(deflateRaw(out, last).then((deflated) => ({ deflated, adler: adlerOf(out), len: out.length })));
  }
  const parts = await Promise.all(jobs);
  let adler = [1, 0]; let first = true;
  for (const p of parts) { adler = first ? p.adler : adlerJoin(adler, p.adler, p.len); first = false; }
  const sum = Buffer.alloc(4); sum.writeUInt32BE((((adler[1] << 16) | adler[0]) >>> 0), 0);
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4); ihdr[8] = 8; ihdr[9] = opaque ? 2 : 6;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    ...chunk('IHDR', [ihdr]),
    ...chunk('IDAT', [Buffer.from([0x78, 0x01]), ...parts.map((p) => p.deflated), sum]),
    ...chunk('IEND', []),
  ]);
}

const BIG_PIXELS = 512 * 512;   // (a small picture: the canvas's own encoder is quick enough)

/** A canvas (@napi-rs/canvas) as a PNG Buffer: on many cores when it is big, the canvas's own encoder when small. */
export async function canvasToPng(canvas) {
  const { width, height } = canvas;
  if (!(width * height >= BIG_PIXELS)) return canvas.encode('png');
  const data = canvas.getContext('2d').getImageData(0, 0, width, height).data;
  // (no alpha channel written where every pixel is solid, as a painted map is)
  let opaque = true;
  for (let i = 3; i < data.length; i += 4) if (data[i] !== 255) { opaque = false; break; }
  return encodePng(data, width, height, { opaque });
}
