// Compressed OSM files, opened before they are read: .osm.gz, .osm.bz2 and .osm.xz (and an .o5m, .geojson or even
// .osm.pbf inside any of them). Asked for by SPLATPLAYS (Discord #general 2026-11-21): planet.openstreetmap.org and
// Geofabrik serve .osm.bz2, BBBike .osm.gz and .xz.
//
// gzip uses the browser's own DecompressionStream. bzip2 and xz have no browser decoder, so they are decoded here,
// from their specifications (bzip2: Julian Seward's format as documented in bzip2's source and "The bzip2 file
// format" notes; xz: the .xz file format 1.2.0 and LZMA2 as in xz-embedded). Both check the file's own checksums
// (bzip2's block CRCs, xz's CRC32 or CRC64), so a damaged file, or a mistake here, is refused rather than read wrong.
// Decoding is in memory: the result is the uncompressed file, which the importer reads whole anyway.

/** Which compression the bytes start with: 'gzip', 'bzip2', 'xz' or null. */
export function compressionOf(bytes) {
  if (!bytes || bytes.length < 6) return null;
  if (bytes[0] === 0x1f && bytes[1] === 0x8b) return 'gzip';
  if (bytes[0] === 0x42 && bytes[1] === 0x5a && bytes[2] === 0x68 && bytes[3] >= 0x31 && bytes[3] <= 0x39) return 'bzip2';
  if (bytes[0] === 0xfd && bytes[1] === 0x37 && bytes[2] === 0x7a && bytes[3] === 0x58 && bytes[4] === 0x5a && bytes[5] === 0x00) return 'xz';
  return null;
}

/** The bytes decompressed (gzip, bzip2 or xz), or the same bytes when they are not compressed. */
export async function decompress(bytes) {
  const kind = compressionOf(bytes);
  if (kind === 'gzip') return gunzip(bytes);
  if (kind === 'bzip2') return bunzip2(bytes);
  if (kind === 'xz') return unxz(bytes);
  return bytes;
}

export async function gunzip(bytes) {
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
  try {
    return new Uint8Array(await new Response(stream).arrayBuffer());
  } catch (e) {
    throw new Error(`This .gz file could not be opened (${e?.message || e}): it may be cut short or damaged.`);
  }
}

// A growable byte buffer for output of unknown size.
function growable(initial = 1 << 20) {
  let buf = new Uint8Array(initial); let n = 0;
  return {
    get length() { return n; },
    get buf() { return buf; },
    ensure(extra) {
      if (n + extra <= buf.length) return;
      let size = buf.length * 2; while (size < n + extra) size *= 2;
      const next = new Uint8Array(size); next.set(buf.subarray(0, n)); buf = next;
    },
    push(b) { if (n >= buf.length) this.ensure(1); buf[n++] = b; },
    set length(v) { n = v; },
    result() { return buf.slice(0, n); },
  };
}

// ── bzip2 ───────────────────────────────────────────────────────────────────

const BZ_CRC = (() => {
  const t = new Uint32Array(256);
  for (let i = 0; i < 256; i++) { let c = i << 24; for (let k = 0; k < 8; k++) c = c & 0x80000000 ? (c << 1) ^ 0x04c11db7 : c << 1; t[i] = c >>> 0; }
  return t;
})();

function bitReader(bytes, start = 0) {
  let pos = start; let bit = 0; let cur = 0;
  return {
    bits(n) {
      let v = 0;
      while (n > 0) {
        if (bit === 0) { if (pos >= bytes.length) throw new Error('This .bz2 file is cut short.'); cur = bytes[pos++]; bit = 8; }
        const take = Math.min(n, bit);
        v = (v * (1 << take)) + ((cur >>> (bit - take)) & ((1 << take) - 1));
        bit -= take; n -= take;
      }
      return v;
    },
    bit() { return this.bits(1); },
    align() { bit = 0; },
    get done() { return pos >= bytes.length && bit === 0; },
  };
}

/** A .bz2 file's bytes -> the uncompressed bytes (concatenated streams too, as pbzip2 writes). */
export function bunzip2(bytes) {
  const out = growable(Math.max(1 << 20, bytes.length * 4));
  const br = bitReader(bytes);
  let streams = 0;
  while (true) {
    // stream header "BZh1".."BZh9"
    if (br.done) break;
    const b = br.bits(8);
    if (b === 0 && streams > 0) { br.align(); continue; }   // (padding between streams)
    if (b !== 0x42 || br.bits(8) !== 0x5a || br.bits(8) !== 0x68) {
      if (streams > 0) break;
      throw new Error('This is not a .bz2 file.');
    }
    const level = br.bits(8) - 0x30;
    if (level < 1 || level > 9) throw new Error('This .bz2 file has a bad header.');
    const blockMax = level * 100000;
    const tt = new Uint32Array(blockMax);
    let streamCrc = 0;
    while (true) {
      const m1 = br.bits(24); const m2 = br.bits(24);
      if (m1 === 0x177245 && m2 === 0x385090) {
        const want = br.bits(32) >>> 0;
        if ((want >>> 0) !== (streamCrc >>> 0)) throw new Error('This .bz2 file is damaged (its checksum does not match).');
        br.align();
        break;
      }
      if (m1 !== 0x314159 || m2 !== 0x265359) throw new Error('This .bz2 file is damaged (a block does not start where it should).');
      const blockCrc = bzBlock(br, tt, blockMax, out);
      streamCrc = (((streamCrc << 1) | (streamCrc >>> 31)) ^ blockCrc) >>> 0;
    }
    streams++;
  }
  return out.result();
}

function bzBlock(br, tt, blockMax, out) {
  const wantCrc = br.bits(32) >>> 0;
  if (br.bit()) throw new Error('This .bz2 file uses the old randomised blocks MapNG cannot read.');
  const origPtr = br.bits(24);
  // symbols in use
  const used16 = br.bits(16); const seqToUnseq = [];
  for (let i = 0; i < 16; i++) if (used16 & (0x8000 >> i)) {
    const bits = br.bits(16);
    for (let j = 0; j < 16; j++) if (bits & (0x8000 >> j)) seqToUnseq.push(i * 16 + j);
  }
  if (!seqToUnseq.length) throw new Error('This .bz2 file is damaged (an empty block).');
  const alphaSize = seqToUnseq.length + 2;
  const nGroups = br.bits(3);
  if (nGroups < 2 || nGroups > 6) throw new Error('This .bz2 file is damaged (bad table count).');
  const nSelectors = br.bits(15);
  if (!nSelectors) throw new Error('This .bz2 file is damaged (no selectors).');
  const mtfGroups = [0, 1, 2, 3, 4, 5].slice(0, nGroups);
  const selectors = new Uint8Array(nSelectors);
  for (let i = 0; i < nSelectors; i++) {
    let j = 0; while (br.bit()) { j++; if (j >= nGroups) throw new Error('This .bz2 file is damaged (bad selector).'); }
    const v = mtfGroups[j]; mtfGroups.splice(j, 1); mtfGroups.unshift(v); selectors[i] = v;
  }
  // the Huffman tables: limit / base / perm per group (as bzip2's hbCreateDecodeTables)
  const tables = [];
  for (let g = 0; g < nGroups; g++) {
    const len = new Uint8Array(alphaSize); let cur = br.bits(5);
    for (let s = 0; s < alphaSize; s++) {
      while (true) {
        if (cur < 1 || cur > 20) throw new Error('This .bz2 file is damaged (bad code length).');
        if (!br.bit()) break;
        cur += br.bit() ? -1 : 1;
      }
      len[s] = cur;
    }
    let minLen = 32; let maxLen = 0;
    for (const l of len) { if (l > maxLen) maxLen = l; if (l < minLen) minLen = l; }
    const perm = []; for (let l = minLen; l <= maxLen; l++) for (let s = 0; s < alphaSize; s++) if (len[s] === l) perm.push(s);
    const base = new Int32Array(23); const limit = new Int32Array(23);
    for (let s = 0; s < alphaSize; s++) base[len[s] + 1]++;
    for (let i = 1; i < 23; i++) base[i] += base[i - 1];
    let vec = 0;
    for (let i = minLen; i <= maxLen; i++) { vec += base[i + 1] - base[i]; limit[i] = vec - 1; vec <<= 1; }
    for (let i = minLen + 1; i <= maxLen; i++) base[i] = ((limit[i - 1] + 1) << 1) - base[i];
    tables.push({ minLen, maxLen, perm, base, limit });
  }
  // the MTF / RLE2 symbols -> the BWT block (tt), as bzip2's decompress loop
  const unzftab = new Int32Array(256);
  const mtf = seqToUnseq.slice();
  const EOB = alphaSize - 1;
  let n = 0; let groupPos = 0; let selIdx = 0; let t = null;
  let runPos = 0; let run = 0;
  const flushRun = () => {
    if (!run) return;
    const byte = mtf[0];
    if (n + run > blockMax) throw new Error('This .bz2 file is damaged (block too long).');
    unzftab[byte] += run;
    for (let k = 0; k < run; k++) tt[n++] = byte;
    run = 0; runPos = 0;
  };
  while (true) {
    if (groupPos === 0) {
      if (selIdx >= nSelectors) throw new Error('This .bz2 file is damaged (selectors ran out).');
      t = tables[selectors[selIdx++]]; groupPos = 50;
    }
    groupPos--;
    let len = t.minLen; let code = br.bits(len);
    while (len <= t.maxLen && code > t.limit[len]) { code = (code << 1) | br.bit(); len++; }
    if (len > t.maxLen) throw new Error('This .bz2 file is damaged (bad code).');
    const sym = t.perm[code - t.base[len]];
    if (sym <= 1) {           // RUNA / RUNB
      run += (sym + 1) << runPos; runPos++;
      if (run > blockMax) throw new Error('This .bz2 file is damaged (run too long).');
      continue;
    }
    flushRun();
    if (sym === EOB) break;
    const idx = sym - 1;
    const v = mtf[idx]; mtf.splice(idx, 1); mtf.unshift(v);
    if (n >= blockMax) throw new Error('This .bz2 file is damaged (block too long).');
    unzftab[v]++; tt[n++] = v;
  }
  if (origPtr >= n) throw new Error('This .bz2 file is damaged (bad origin pointer).');
  // inverse BWT: tt[i] holds (next index << 8) | byte
  const cftab = new Int32Array(257);
  for (let i = 0; i < 256; i++) cftab[i + 1] = cftab[i] + unzftab[i];
  for (let i = 0; i < n; i++) { const byte = tt[i] & 0xff; tt[cftab[byte]++] |= (i << 8); }
  // out, undoing the first run-length step (4 equal bytes, then a count) and with the block CRC
  let crc = 0xffffffff; let pos = tt[origPtr] >>> 8; let last = -1; let same = 0;
  out.ensure(n * 2);
  for (let i = 0; i < n; i++) {
    const e = tt[pos]; const byte = e & 0xff; pos = e >>> 8;
    if (same === 4) {
      out.ensure(byte);
      for (let k = 0; k < byte; k++) { out.push(last); crc = ((crc << 8) ^ BZ_CRC[((crc >>> 24) ^ last) & 0xff]) >>> 0; }
      same = 0; last = -1; continue;
    }
    if (byte === last) same++; else { same = 1; last = byte; }
    out.push(byte); crc = ((crc << 8) ^ BZ_CRC[((crc >>> 24) ^ byte) & 0xff]) >>> 0;
  }
  crc = ~crc >>> 0;
  if (crc !== wantCrc) throw new Error('This .bz2 file is damaged (a block checksum does not match).');
  return crc;
}

// ── xz (LZMA2) ──────────────────────────────────────────────────────────────

const CRC32_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let i = 0; i < 256; i++) { let c = i; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[i] = c >>> 0; }
  return t;
})();
function crc32(bytes, start = 0, end = bytes.length) {
  let c = 0xffffffff;
  for (let i = start; i < end; i++) c = CRC32_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
// CRC64 (ECMA-182, reflected, as xz uses) in two 32-bit halves
const CRC64_TABLE = (() => {
  const lo = new Uint32Array(256); const hi = new Uint32Array(256);
  const PL = 0xd7870f42; const PH = 0xc96c5795;   // 0xC96C5795D7870F42
  for (let i = 0; i < 256; i++) {
    let l = i; let h = 0;
    for (let k = 0; k < 8; k++) {
      const bit = l & 1;
      l = ((l >>> 1) | ((h & 1) << 31)) >>> 0; h >>>= 1;
      if (bit) { l = (l ^ PL) >>> 0; h = (h ^ PH) >>> 0; }
    }
    lo[i] = l; hi[i] = h;
  }
  return { lo, hi };
})();
function crc64(bytes, start = 0, end = bytes.length) {
  let l = 0xffffffff; let h = 0xffffffff;
  for (let i = start; i < end; i++) {
    const idx = (l ^ bytes[i]) & 0xff;
    const nl = ((l >>> 8) | ((h & 0xff) << 24)) >>> 0; const nh = h >>> 8;
    l = (nl ^ CRC64_TABLE.lo[idx]) >>> 0; h = (nh ^ CRC64_TABLE.hi[idx]) >>> 0;
  }
  return [(l ^ 0xffffffff) >>> 0, (h ^ 0xffffffff) >>> 0];
}

const XZ_CHECK_SIZE = [0, 4, 4, 4, 8, 8, 8, 16, 16, 16, 32, 32, 32, 64, 64, 64];

function readVli(bytes, p) {
  let v = 0; let mul = 1;
  for (let i = 0; i < 9; i++) {
    const b = bytes[p.pos++];
    if (b === undefined) throw new Error('This .xz file is cut short.');
    v += (b & 0x7f) * mul; mul *= 128;
    if (!(b & 0x80)) return v;
  }
  throw new Error('This .xz file is damaged (bad number).');
}

/** An .xz file's bytes -> the uncompressed bytes (LZMA2 only, as `xz` writes by default; several streams too). */
export function unxz(bytes) {
  const out = growable(Math.max(1 << 20, bytes.length * 6));
  const p = { pos: 0 };
  let streams = 0;
  while (p.pos < bytes.length) {
    // (stream padding: zero bytes in fours between streams)
    if (streams > 0 && bytes[p.pos] === 0) { p.pos += 4; continue; }
    if (compressionOf(bytes.subarray(p.pos, p.pos + 6)) !== 'xz') {
      if (streams > 0) break;
      throw new Error('This is not an .xz file.');
    }
    const flags = bytes[p.pos + 7]; const checkType = flags & 0x0f;
    if (bytes[p.pos + 6] !== 0 || (flags & 0xf0)) throw new Error('This .xz file has flags MapNG cannot read.');
    const want = (bytes[p.pos + 8] | (bytes[p.pos + 9] << 8) | (bytes[p.pos + 10] << 16) | (bytes[p.pos + 11] << 24)) >>> 0;
    if (crc32(bytes, p.pos + 6, p.pos + 8) !== want) throw new Error('This .xz file is damaged (its header checksum does not match).');
    p.pos += 12;
    // blocks until the index (a header-size byte of 0)
    while (true) {
      if (p.pos >= bytes.length) throw new Error('This .xz file is cut short.');
      const hs = bytes[p.pos];
      if (hs === 0) break;
      const headerStart = p.pos; const headerSize = (hs + 1) * 4;
      const hwant = (bytes[headerStart + headerSize - 4] | (bytes[headerStart + headerSize - 3] << 8) | (bytes[headerStart + headerSize - 2] << 16) | (bytes[headerStart + headerSize - 1] << 24)) >>> 0;
      if (crc32(bytes, headerStart, headerStart + headerSize - 4) !== hwant) throw new Error('This .xz file is damaged (a block header checksum does not match).');
      const bflags = bytes[headerStart + 1]; p.pos = headerStart + 2;
      const nFilters = (bflags & 3) + 1;
      if (bflags & 0x40) readVli(bytes, p);   // compressed size
      if (bflags & 0x80) readVli(bytes, p);   // uncompressed size
      let dictSize = 0;
      for (let f = 0; f < nFilters; f++) {
        const id = readVli(bytes, p); const psize = readVli(bytes, p);
        if (id !== 0x21 || f !== nFilters - 1) throw new Error('This .xz file uses a filter MapNG cannot read (only plain LZMA2, as `xz` writes by default).');
        const d = bytes[p.pos]; if (psize !== 1 || d > 40) throw new Error('This .xz file is damaged (bad LZMA2 settings).');
        dictSize = d === 40 ? 0xffffffff : (2 | (d & 1)) * 2 ** ((d >> 1) + 11);
        p.pos += psize;
      }
      p.pos = headerStart + headerSize;
      const startOut = out.length;
      p.pos = lzma2(bytes, p.pos, out, dictSize);
      while (p.pos % 4) { if (bytes[p.pos] !== 0) throw new Error('This .xz file is damaged (bad block padding).'); p.pos++; }
      const cs = XZ_CHECK_SIZE[checkType];
      if (checkType === 1) {
        const c = (bytes[p.pos] | (bytes[p.pos + 1] << 8) | (bytes[p.pos + 2] << 16) | (bytes[p.pos + 3] << 24)) >>> 0;
        if (crc32(out.buf, startOut, out.length) !== c) throw new Error('This .xz file is damaged (a block checksum does not match).');
      } else if (checkType === 4) {
        const [l, h] = crc64(out.buf, startOut, out.length);
        const cl = (bytes[p.pos] | (bytes[p.pos + 1] << 8) | (bytes[p.pos + 2] << 16) | (bytes[p.pos + 3] << 24)) >>> 0;
        const ch = (bytes[p.pos + 4] | (bytes[p.pos + 5] << 8) | (bytes[p.pos + 6] << 16) | (bytes[p.pos + 7] << 24)) >>> 0;
        if (l !== cl || h !== ch) throw new Error('This .xz file is damaged (a block checksum does not match).');
      }
      p.pos += cs;
    }
    // the index: 0x00, record count, (unpadded size, uncompressed size) per record, padding, CRC32
    const indexStart = p.pos; p.pos++;
    const records = readVli(bytes, p);
    for (let r = 0; r < records; r++) { readVli(bytes, p); readVli(bytes, p); }
    while ((p.pos - indexStart) % 4) p.pos++;
    p.pos += 4;
    p.pos += 12;   // stream footer
    streams++;
  }
  return out.result();
}

// LZMA2 chunks into out (the output is the dictionary: everything is decoded in memory). Returns the position after
// the end marker.
function lzma2(bytes, pos, out, dictSize) {
  const lz = lzmaState();
  // (positions count from the last dictionary reset: every xz block starts one, and recent `xz` cuts even a
  // single-threaded file into blocks. Counted from the start of the file, the literal context read the previous
  // block's last byte and matches could reach into it)
  lz.dictStart = out.length;
  let needProps = true; let needDictReset = true;
  while (true) {
    const ctrl = bytes[pos++];
    if (ctrl === undefined) throw new Error('This .xz file is cut short.');
    if (ctrl === 0x00) return pos;
    if (ctrl === 0x01 || ctrl === 0x02) {
      if (ctrl === 0x01) { needDictReset = false; lz.dictStart = out.length; } else if (needDictReset) throw new Error('This .xz file is damaged (no dictionary reset).');
      const size = ((bytes[pos] << 8) | bytes[pos + 1]) + 1; pos += 2;
      if (pos + size > bytes.length) throw new Error('This .xz file is cut short.');
      out.ensure(size); out.buf.set(bytes.subarray(pos, pos + size), out.length); out.length = out.length + size; pos += size;
      continue;
    }
    if (ctrl < 0x80) throw new Error('This .xz file is damaged (bad LZMA2 chunk).');
    const reset = (ctrl >> 5) & 3;
    const unpacked = ((ctrl & 0x1f) << 16) + (bytes[pos] << 8) + bytes[pos + 1] + 1; pos += 2;
    const packed = (bytes[pos] << 8) + bytes[pos + 1] + 1; pos += 2;
    if (reset === 3) { needDictReset = false; lz.dictStart = out.length; } else if (needDictReset) throw new Error('This .xz file is damaged (no dictionary reset).');
    if (reset >= 2) {
      const d = bytes[pos++];
      if (d >= 9 * 5 * 5) throw new Error('This .xz file is damaged (bad LZMA settings).');
      lz.setProps(d % 9, Math.floor(d / 9) % 5, Math.floor(d / 45));
      if (lz.lc + lz.lp > 4) throw new Error('This .xz file is damaged (bad LZMA settings).');
      needProps = false;
    } else if (needProps) throw new Error('This .xz file is damaged (no LZMA settings).');
    if (reset >= 1) lz.reset();
    if (pos + packed > bytes.length) throw new Error('This .xz file is cut short.');
    lz.decode(bytes, pos, pos + packed, out, unpacked);
    pos += packed;
  }
}

function lzmaState() {
  const S = { lc: 0, lp: 0, pb: 0, state: 0, reps: [0, 0, 0, 0], dictStart: 0 };
  let probs = null;
  // probability layout
  const P_ISMATCH = 0; const P_ISREP = 192; const P_ISREPG0 = 204; const P_ISREPG1 = 216; const P_ISREPG2 = 228;
  const P_ISREP0LONG = 240; const P_POSSLOT = 432; const P_SPECPOS = 688; const P_ALIGN = 802; const P_LENCODER = 818;
  const P_REPLENCODER = 1332; const P_LITERAL = 1846;
  const LEN_CHOICE = 0; const LEN_CHOICE2 = 1; const LEN_LOW = 2; const LEN_MID = 130; const LEN_HIGH = 258;
  S.setProps = (lc, lp, pb) => { S.lc = lc; S.lp = lp; S.pb = pb; };
  S.reset = () => {
    probs = new Uint16Array(P_LITERAL + 0x300 * (1 << (S.lc + S.lp))).fill(1024);
    S.state = 0; S.reps = [0, 0, 0, 0];
  };
  S.decode = (bytes, start, end, out, unpacked) => {
    // range decoder
    let pos = start;
    if (bytes[pos] !== 0) throw new Error('This .xz file is damaged (bad range coder start).');
    let range = 0xffffffff; let code = 0;
    for (let i = 1; i < 5; i++) code = ((code << 8) | bytes[start + i]) >>> 0;
    pos = start + 5;
    const norm = () => { if (range < 0x1000000) { range = (range << 8) >>> 0; code = ((code << 8) | (pos < end ? bytes[pos++] : 0)) >>> 0; } };
    const bit = (i) => {
      norm();
      const p = probs[i]; const bound = (range >>> 11) * p;
      if (code < bound) { range = bound; probs[i] = p + ((2048 - p) >>> 5); return 0; }
      range = (range - bound) >>> 0; code = (code - bound) >>> 0; probs[i] = p - (p >>> 5); return 1;
    };
    const tree = (base, nbits) => { let m = 1; for (let i = 0; i < nbits; i++) m = (m << 1) | bit(base + m); return m - (1 << nbits); };
    const rtree = (base, nbits) => { let m = 1; let sym = 0; for (let i = 0; i < nbits; i++) { const b = bit(base + m); m = (m << 1) | b; sym |= b << i; } return sym; };
    const direct = (n) => { let v = 0; for (let i = 0; i < n; i++) { norm(); range >>>= 1; const t = code >= range ? 1 : 0; if (t) code = (code - range) >>> 0; v = (v * 2) + t; } return v; };
    const len = (base, posState) => {
      if (!bit(base + LEN_CHOICE)) return tree(base + LEN_LOW + (posState << 3), 3);
      if (!bit(base + LEN_CHOICE2)) return 8 + tree(base + LEN_MID + (posState << 3), 3);
      return 16 + tree(base + LEN_HIGH, 8);
    };
    const target = out.length + unpacked;
    out.ensure(unpacked);
    const buf = () => out.buf;
    const pbMask = (1 << S.pb) - 1; const lpMask = (1 << S.lp) - 1;
    const d0 = S.dictStart;
    let n = out.length;
    while (n < target) {
      const at = n - d0;
      const posState = at & pbMask; const st = S.state;
      if (!bit(P_ISMATCH + (st << 4) + posState)) {
        // literal
        const prev = at > 0 ? buf()[n - 1] : 0;
        const base = P_LITERAL + 0x300 * (((at & lpMask) << S.lc) + (prev >> (8 - S.lc)));
        let sym = 1;
        if (st >= 7) {
          let match = buf()[n - S.reps[0] - 1];
          while (sym < 0x100) {
            const mb = (match >> 7) & 1; match <<= 1;
            const b = bit(base + ((1 + mb) << 8) + sym); sym = (sym << 1) | b;
            if (mb !== b) break;
          }
        }
        while (sym < 0x100) sym = (sym << 1) | bit(base + sym);
        buf()[n++] = sym & 0xff;
        S.state = st < 4 ? 0 : st < 10 ? st - 3 : st - 6;
        continue;
      }
      let l;
      if (bit(P_ISREP + st)) {
        if (n === d0) throw new Error('This .xz file is damaged (repeat before any data).');
        if (!bit(P_ISREPG0 + st)) {
          if (!bit(P_ISREP0LONG + (st << 4) + posState)) {
            // short rep: one byte at rep0
            buf()[n] = buf()[n - S.reps[0] - 1]; n++;
            S.state = st < 7 ? 9 : 11;
            continue;
          }
        } else {
          let d;
          if (!bit(P_ISREPG1 + st)) { d = S.reps[1]; } else if (!bit(P_ISREPG2 + st)) { d = S.reps[2]; S.reps[2] = S.reps[1]; } else { d = S.reps[3]; S.reps[3] = S.reps[2]; S.reps[2] = S.reps[1]; }
          S.reps[1] = S.reps[0]; S.reps[0] = d;
        }
        l = len(P_REPLENCODER, posState);
        S.state = st < 7 ? 8 : 11;
      } else {
        S.reps[3] = S.reps[2]; S.reps[2] = S.reps[1]; S.reps[1] = S.reps[0];
        l = len(P_LENCODER, posState);
        S.state = st < 7 ? 7 : 10;
        const lenState = Math.min(l, 3);
        const slot = tree(P_POSSLOT + (lenState << 6), 6);
        let dist;
        if (slot < 4) dist = slot;
        else {
          const nd = (slot >> 1) - 1; dist = (2 | (slot & 1)) * (2 ** nd);
          if (slot < 14) dist += rtree(P_SPECPOS + dist - slot - 1, nd);
          else {
            dist += direct(nd - 4) * 16;
            dist += rtree(P_ALIGN, 4);
          }
          if (dist === 0xffffffff) break;   // end marker (LZMA2 chunks have none, but allow it)
        }
        S.reps[0] = dist;
      }
      l += 2;
      const d = S.reps[0] + 1;
      if (d > n - d0) throw new Error('This .xz file is damaged (a match reaches before the start).');
      if (n + l > target) throw new Error('This .xz file is damaged (a match runs past its chunk).');
      const b = buf();
      for (let k = 0; k < l; k++) { b[n] = b[n - d]; n++; }
    }
    out.length = n;
  };
  return S;
}
