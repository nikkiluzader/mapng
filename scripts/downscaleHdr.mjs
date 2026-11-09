// Downscale an equirectangular Radiance .hdr by an integer factor (box filter),
// written back RLE-compressed: the 3D preview's sky. Usage:
//   node scripts/downscaleHdr.mjs in.hdr out.hdr [factor=2]
import fs from 'node:fs';
import * as THREE from 'three';
import { RGBELoader } from 'three/examples/jsm/loaders/RGBELoader.js';

const [inp, out, f = '2'] = process.argv.slice(2);
const k = Number(f);
const buf = fs.readFileSync(inp);
const loader = new RGBELoader().setDataType(THREE.FloatType);
const { width: W, height: H, data } = loader.parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
const ch = data.length / (W * H);
const w = Math.floor(W / k); const h = Math.floor(H / k);
const rgbe = new Uint8Array(w * h * 4);
for (let y = 0; y < h; y++) {
  for (let x = 0; x < w; x++) {
    let r = 0; let g = 0; let b = 0;
    for (let dy = 0; dy < k; dy++) for (let dx = 0; dx < k; dx++) {
      const i = ((y * k + dy) * W + (x * k + dx)) * ch;
      r += data[i]; g += data[i + 1]; b += data[i + 2];
    }
    r /= k * k; g /= k * k; b /= k * k;
    const m = Math.max(r, g, b); const o = (y * w + x) * 4;
    if (m < 1e-32) { rgbe[o] = rgbe[o + 1] = rgbe[o + 2] = rgbe[o + 3] = 0; continue; }
    const e = Math.ceil(Math.log2(m) + 1e-9); const sc = 256 / 2 ** e;
    rgbe[o] = Math.min(255, Math.floor(r * sc)); rgbe[o + 1] = Math.min(255, Math.floor(g * sc)); rgbe[o + 2] = Math.min(255, Math.floor(b * sc)); rgbe[o + 3] = e + 128;
  }
}
// new-style RLE scanlines
const parts = [Buffer.from(`#?RADIANCE\nFORMAT=32-bit_rle_rgbe\n\n-Y ${h} +X ${w}\n`, 'ascii')];
for (let y = 0; y < h; y++) {
  parts.push(Buffer.from([2, 2, (w >> 8) & 0xff, w & 0xff]));
  for (let c = 0; c < 4; c++) {
    const row = new Uint8Array(w); for (let x = 0; x < w; x++) row[x] = rgbe[(y * w + x) * 4 + c];
    const bytes = []; let x = 0;
    while (x < w) {
      let run = 1; while (x + run < w && run < 127 && row[x + run] === row[x]) run++;
      if (run >= 3) { bytes.push(128 + run, row[x]); x += run; continue; }
      let n = 0; const start = x;
      while (x < w && n < 128) { let r2 = 1; while (x + r2 < w && r2 < 3 && row[x + r2] === row[x]) r2++; if (r2 >= 3) break; x++; n++; }
      bytes.push(n, ...row.subarray(start, start + n));
    }
    parts.push(Buffer.from(bytes));
  }
}
fs.writeFileSync(out, Buffer.concat(parts));
console.log(`${W}x${H} -> ${w}x${h}, ${(fs.statSync(out).size / 1e6).toFixed(1)} MB`);
