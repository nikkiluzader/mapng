// The MapNG levels in BeamNG's mods folder: each zip's index read (not the
// whole zip: a big level is gigabytes) for its levels/<name>/mapng.json, or,
// from before that file, an info.json whose authors is "mapng". Other mods
// are left out.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const EOCD = 0x06054b50;
const ZIP64_LOCATOR = 0x07064b50;
const ZIP64_EOCD = 0x06064b50;
const CENTRAL = 0x02014b50;
const LOCAL = 0x04034b50;

function readAt(fd, offset, length) {
  const buf = Buffer.alloc(length);
  let done = 0;
  while (done < length) {
    const n = fs.readSync(fd, buf, done, length - done, offset + done);
    if (n === 0) break;
    done += n;
  }
  return buf.subarray(0, done);
}

/** The zip's entries { name, method, compSize, size, offset } (ZIP64 too). */
export function zipEntries(fd, fileSize) {
  const tailLen = Math.min(fileSize, 65557 + 20);
  const tail = readAt(fd, fileSize - tailLen, tailLen);
  let e = -1;
  for (let i = tail.length - 22; i >= 0; i--) if (tail.readUInt32LE(i) === EOCD) { e = i; break; }
  if (e < 0) throw new Error('not a zip');
  let count = tail.readUInt16LE(e + 10);
  let cdSize = tail.readUInt32LE(e + 12);
  let cdOffset = tail.readUInt32LE(e + 16);
  if (count === 0xffff || cdSize === 0xffffffff || cdOffset === 0xffffffff) {
    const loc = e - 20;
    if (loc < 0 || tail.readUInt32LE(loc) !== ZIP64_LOCATOR) throw new Error('zip64 locator missing');
    const recOffset = Number(tail.readBigUInt64LE(loc + 8));
    const rec = readAt(fd, recOffset, 56);
    if (rec.readUInt32LE(0) !== ZIP64_EOCD) throw new Error('zip64 record missing');
    count = Number(rec.readBigUInt64LE(32));
    cdSize = Number(rec.readBigUInt64LE(40));
    cdOffset = Number(rec.readBigUInt64LE(48));
  }
  const cd = readAt(fd, cdOffset, cdSize);
  const out = [];
  let p = 0;
  for (let k = 0; k < count && p + 46 <= cd.length; k++) {
    if (cd.readUInt32LE(p) !== CENTRAL) break;
    const method = cd.readUInt16LE(p + 10);
    let compSize = cd.readUInt32LE(p + 20);
    let size = cd.readUInt32LE(p + 24);
    const nameLen = cd.readUInt16LE(p + 28);
    const extraLen = cd.readUInt16LE(p + 30);
    const commentLen = cd.readUInt16LE(p + 32);
    let offset = cd.readUInt32LE(p + 42);
    const name = cd.toString('utf8', p + 46, p + 46 + nameLen);
    // (ZIP64 extra field: the sizes and offset that did not fit, in order)
    let x = p + 46 + nameLen;
    const xEnd = x + extraLen;
    while (x + 4 <= xEnd) {
      const id = cd.readUInt16LE(x); const len = cd.readUInt16LE(x + 2);
      if (id === 0x0001) {
        let q = x + 4;
        if (size === 0xffffffff) { size = Number(cd.readBigUInt64LE(q)); q += 8; }
        if (compSize === 0xffffffff) { compSize = Number(cd.readBigUInt64LE(q)); q += 8; }
        if (offset === 0xffffffff) { offset = Number(cd.readBigUInt64LE(q)); q += 8; }
      }
      x += 4 + len;
    }
    out.push({ name, method, compSize, size, offset });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

/** One entry's bytes (stored or deflated). */
export function zipRead(fd, entry) {
  const head = readAt(fd, entry.offset, 30);
  if (head.readUInt32LE(0) !== LOCAL) throw new Error(`bad local header: ${entry.name}`);
  const start = entry.offset + 30 + head.readUInt16LE(26) + head.readUInt16LE(28);
  const data = readAt(fd, start, entry.compSize);
  if (entry.method === 0) return data;
  if (entry.method === 8) return zlib.inflateRawSync(data);
  throw new Error(`unsupported zip method ${entry.method}: ${entry.name}`);
}

const json = (buf) => { try { return JSON.parse(buf.toString('utf8')); } catch { return null; } };

/**
 * The MapNG levels in one zip: [{ levelName, title, kind ('mapng' | 'older'),
 * stamp (mapng.json or null), center, sizeMeters, resolution, previewEntry }].
 */
export function mapngLevelsInZip(file) {
  const fd = fs.openSync(file, 'r');
  try {
    const entries = zipEntries(fd, fs.fstatSync(fd).size);
    const byName = new Map(entries.map((en) => [en.name, en]));
    const levels = new Set();
    for (const en of entries) {
      const m = en.name.match(/^levels\/([^/]+)\/info\.json$/);
      if (m) levels.add(m[1]);
    }
    const out = [];
    for (const name of levels) {
      const base = `levels/${name}`;
      const info = json(zipRead(fd, byName.get(`${base}/info.json`))) || {};
      const stampEntry = byName.get(`${base}/mapng.json`);
      const stamp = stampEntry ? json(zipRead(fd, stampEntry)) : null;
      const isMapng = stamp?.generator === 'MapNG' || String(info.authors || '').toLowerCase() === 'mapng';
      if (!isMapng) continue;
      let center = stamp?.center || null;
      if (!center) {
        const at = String(info.description || '').match(/at (-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)/);
        if (at) center = { lat: Number(at[1]), lng: Number(at[2]) };
      }
      let resolution = stamp?.resolution || null;
      if (!resolution) {
        const terrain = byName.get(`${base}/terrain.terrain.json`);
        const tj = terrain ? json(zipRead(fd, terrain)) : null;
        resolution = Number(tj?.size) || null;
      }
      out.push({
        levelName: name,
        title: info.title || name,
        kind: stamp ? 'mapng' : 'older',
        stamp,
        center,
        sizeMeters: stamp?.sizeMeters || (Array.isArray(info.size) ? Number(info.size[0]) : null),
        resolution,
        previewEntry: byName.has(`${base}/preview.png`) ? `${base}/preview.png` : null,
      });
    }
    return out;
  } finally {
    fs.closeSync(fd);
  }
}

/** One file out of a zip (a level's preview), or null. */
export function readZipFile(file, entryName) {
  const fd = fs.openSync(file, 'r');
  try {
    const en = zipEntries(fd, fs.fstatSync(fd).size).find((e) => e.name === entryName);
    return en ? zipRead(fd, en) : null;
  } finally {
    fs.closeSync(fd);
  }
}

const cache = new Map();   // zip path → { mtimeMs, size, levels }

/** Every MapNG level in the folder's zips (cached by each zip's size and time). */
export function listMapngLevels(folder) {
  let names = [];
  try { names = fs.readdirSync(folder).filter((n) => n.toLowerCase().endsWith('.zip')); } catch { return []; }
  const out = [];
  for (const n of names) {
    const file = path.join(folder, n);
    let st;
    try { st = fs.statSync(file); } catch { continue; }
    let hit = cache.get(file);
    if (!hit || hit.mtimeMs !== st.mtimeMs || hit.size !== st.size) {
      let levels = [];
      try { levels = mapngLevelsInZip(file); } catch { levels = []; }
      hit = { mtimeMs: st.mtimeMs, size: st.size, levels };
      cache.set(file, hit);
    }
    for (const lv of hit.levels) out.push({ ...lv, zip: file, zipName: n, zipBytes: st.size, modifiedAt: new Date(st.mtimeMs).toISOString() });
  }
  return out.sort((a, b) => b.modifiedAt.localeCompare(a.modifiedAt));
}
