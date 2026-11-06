#!/usr/bin/env node
// Mapterhorn lidar coverage index for the 2D map's "Free lidar coverage" layer.
//
// Mapterhorn serves z13+ tiles only over national lidar models. Each of its z13+ archives (download_urls.json)
// is a PMTiles file whose directory lists its tiles; the z13 tile ids are one contiguous range, so only the
// directory pages covering that range are read (HTTP ranges, no tile data). Every z13 tile that exists is recorded
// (no resolution class: an archive's deepest zoom holds for part of its ~600 km block only; the source hint
// measures the resolution at the selection). Output: row runs of the z13 grid,
//   { v: 2, z: 13, generated, archives, tiles, rows: { "<y>": [[x0, length], ...] } }
// written to public/data/mapterhorn-coverage.json (served with the app, gzip on the wire).
//
//   node scripts/mapterhorn/buildCoverage.mjs [out]
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { bytesToHeader, zxyToTileId, tileIdToZxy } from 'pmtiles';

const OUT = process.argv[2] || path.join(path.dirname(new URL(import.meta.url).pathname), '../../public/data/mapterhorn-coverage.json');
const LIST = 'https://download.mapterhorn.com/download_urls.json';
const Z = 13;
const START = zxyToTileId(Z, 0, 0), END = zxyToTileId(Z + 1, 0, 0);   // z13 ids: [START, END)

const range = async (url, offset, length) => {
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const r = await fetch(url, { headers: { Range: `bytes=${offset}-${offset + length - 1}`, 'User-Agent': 'MapNG coverage index (https://mapng.com)' } });
      if (r.status === 206 || r.status === 200) return new Uint8Array(await r.arrayBuffer());
      throw new Error(`HTTP ${r.status}`);
    } catch (e) { if (attempt === 3) throw e; await new Promise((res) => setTimeout(res, 1000 * (attempt + 1))); }
  }
};
const decompress = (buf, c) => (c === 2 ? new Uint8Array(zlib.gunzipSync(buf)) : buf);   // 2 = gzip, 1 = none
function readVarint(b, p) { let v = 0, s = 1, x; do { x = b[p.i++]; v += (x & 0x7f) * s; s *= 128; } while (x & 0x80); return v; }
function parseDir(b) {
  const p = { i: 0 }; const n = readVarint(b, p); const e = Array.from({ length: n }, () => ({}));
  let last = 0;
  for (const x of e) { last += readVarint(b, p); x.tileId = last; }
  for (const x of e) x.runLength = readVarint(b, p);
  for (const x of e) x.length = readVarint(b, p);
  for (let k = 0; k < n; k++) { const v = readVarint(b, p); e[k].offset = v === 0 && k > 0 ? e[k - 1].offset + e[k - 1].length : v - 1; }
  return e;
}

async function z13Tiles(url) {
  const head = await range(url, 0, 16384);
  const h = bytesToHeader(head.buffer.slice(0, 127));
  const out = [];
  const walk = async (entries, depth) => {
    for (let k = 0; k < entries.length; k++) {
      const x = entries[k];
      const next = k + 1 < entries.length ? entries[k + 1].tileId : Infinity;
      if (x.runLength === 0) {
        // leaf directory covering [x.tileId, next)
        if (next <= START || x.tileId >= END || depth > 4) continue;
        const leaf = decompress(await range(url, h.leafDirectoryOffset + x.offset, x.length), h.internalCompression);
        await walk(parseDir(leaf), depth + 1);
      } else {
        for (let t = x.tileId; t < x.tileId + x.runLength; t++) if (t >= START && t < END) out.push(t);
      }
    }
  };
  const rootBytes = h.rootDirectoryOffset + h.rootDirectoryLength <= head.length
    ? head.slice(h.rootDirectoryOffset, h.rootDirectoryOffset + h.rootDirectoryLength)
    : await range(url, h.rootDirectoryOffset, h.rootDirectoryLength);
  await walk(parseDir(decompress(rootBytes, h.internalCompression)), 0);
  return { tiles: out, maxZoom: h.maxZoom };
}

const items = (await (await fetch(LIST)).json()).items.filter((a) => a.min_zoom === Z && a.size > 1024);
console.log(`${items.length} lidar archives`);
const best = new Map();   // "x,y" -> maxZoom
let done = 0;
const pool = 6; let i = 0;
await Promise.all(Array.from({ length: pool }, async () => {
  while (i < items.length) {
    const a = items[i++];
    try {
      const { tiles, maxZoom } = await z13Tiles(a.url);
      for (const t of tiles) { const [, x, y] = tileIdToZxy(t); const k = `${x},${y}`; if ((best.get(k) || 0) < maxZoom) best.set(k, maxZoom); }
    } catch (e) { console.warn('skip', a.name, e.message); }
    if (++done % 25 === 0) console.log(`${done}/${items.length} archives, ${best.size} z13 tiles`);
  }
}));
// row runs
const rows = {};
const byRow = new Map();
for (const k of best.keys()) { const [x, y] = k.split(',').map(Number); if (!byRow.has(y)) byRow.set(y, []); byRow.get(y).push(x); }
for (const [y, cells] of [...byRow].sort((p, q) => p[0] - q[0])) {
  cells.sort((p, q) => p - q);
  const runs = [];
  for (const x of cells) { const r = runs[runs.length - 1]; if (r && r[0] + r[1] === x) r[1]++; else runs.push([x, 1]); }
  rows[y] = runs;
}
fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify({ v: 2, z: Z, generated: new Date().toISOString().slice(0, 10), source: 'mapterhorn.com', archives: items.length, tiles: best.size, rows }));
console.log(`wrote ${OUT}: ${best.size} z13 tiles, ${(fs.statSync(OUT).size / 1e6).toFixed(2)} MB (gzip ${(zlib.gzipSync(fs.readFileSync(OUT)).length / 1e6).toFixed(2)} MB)`);
