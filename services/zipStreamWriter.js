// A ZIP written as it is built, with ZIP64 when the archive needs it.
//
// JSZip cannot write ZIP64. A level built in hundreds of pieces passes 65,535 files (the plain format's limit) and can
// pass 4 GB: JSZip then writes an end record whose file count has wrapped (70,000 files came out as "4,466 entries")
// and offsets that wrap past 4 GB. MapNG's own reader (desktop/levelLibrary.js, services/zipIndex.js) trusts that end
// record, so such a level was missing from the level list and its report "could not be read" (a tester's 442-piece
// road level, 2026-11-24). This writer adds each file as it comes (the pieces need not be held until the end) and
// writes the ZIP64 records whenever a count, a size or an offset does not fit in the plain fields.
//
// Each file's bytes are given whole (they are already in memory when the merge has them), so its local header carries
// its CRC and sizes (no data descriptor). Deflate comes from CompressionStream('deflate-raw'), in browsers and Node
// alike; files that are compressed already (PNG, JPG, a zip) are stored.
//
// sink.write(Uint8Array) -> Promise | void is called in order; nothing is buffered beyond the file being added.

const SIG_LOCAL = 0x04034b50;
const SIG_CENTRAL = 0x02014b50;
const SIG_END = 0x06054b50;
const SIG_END64 = 0x06064b50;
const SIG_LOCATOR64 = 0x07064b50;
const U16_MAX = 0xffff;
const U32_MAX = 0xffffffff;
const STORED_EXT = /\.(png|jpe?g|zip|gz|webp|ogg|mp3|mp4)$/i;

let crcTable = null;
function crc32(bytes) {
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; crcTable[n] = c >>> 0; }
  }
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = crcTable[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

async function deflateRaw(bytes) {
  const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

// little-endian field writer over a fixed-size buffer
function fields(size) {
  const buf = new Uint8Array(size); const dv = new DataView(buf.buffer); let o = 0;
  const w = {
    u16: (v) => { dv.setUint16(o, v, true); o += 2; return w; },
    u32: (v) => { dv.setUint32(o, v >>> 0, true); o += 4; return w; },
    u64: (v) => { dv.setUint32(o, v % 2 ** 32, true); dv.setUint32(o + 4, Math.floor(v / 2 ** 32), true); o += 8; return w; },
    bytes: (b) => { buf.set(b, o); o += b.length; return w; },
    buf,
  };
  return w;
}

const DOS_TIME = 0; const DOS_DATE = (1 << 5) | 1;   // 1980-01-01: a fixed time keeps exports byte-identical

/**
 * A writer: { add(name, data), has(name), finish() -> { files, bytes, zip64 } }. data: a string (UTF-8) or bytes.
 * Names are added once each (a second add of the same name is refused).
 */
export function createZipStreamWriter(sink, { compress = true } = {}) {
  const enc = new TextEncoder();
  const entries = [];
  const names = new Set();
  let offset = 0;
  let chain = Promise.resolve();
  const write = async (bytes) => { await sink.write(bytes); offset += bytes.length; };

  async function addNow(name, data) {
    const raw = typeof data === 'string' ? enc.encode(data) : data instanceof Uint8Array ? data : new Uint8Array(data);
    const nameBytes = enc.encode(name);
    const crc = crc32(raw);
    let method = 0; let body = raw;
    if (compress && raw.length > 64 && !STORED_EXT.test(name)) {
      const d = await deflateRaw(raw);
      if (d.length < raw.length) { method = 8; body = d; }
    }
    const big = raw.length >= U32_MAX || body.length >= U32_MAX;
    const at = offset;
    // local header (ZIP64 extra with both sizes when either does not fit)
    const extra = big ? fields(20).u16(0x0001).u16(16).u64(raw.length).u64(body.length).buf : new Uint8Array(0);
    const head = fields(30 + nameBytes.length + extra.length)
      .u32(SIG_LOCAL).u16(big ? 45 : 20).u16(0x0800).u16(method).u16(DOS_TIME).u16(DOS_DATE)
      .u32(crc).u32(big ? U32_MAX : body.length).u32(big ? U32_MAX : raw.length)
      .u16(nameBytes.length).u16(extra.length).bytes(nameBytes).bytes(extra).buf;
    await write(head);
    await write(body);
    entries.push({ nameBytes, crc, method, size: raw.length, comp: body.length, at });
  }

  return {
    has: (name) => names.has(name),
    /** Add one file; adds run in the order they are called. */
    add(name, data) {
      if (names.has(name)) return chain;
      names.add(name);
      chain = chain.then(() => addNow(name, data));
      return chain;
    },
    /** The central directory and the end records (ZIP64 ones when needed). */
    async finish() {
      await chain;
      const cdStart = offset;
      for (const e of entries) {
        const needSize = e.size >= U32_MAX || e.comp >= U32_MAX; const needAt = e.at >= U32_MAX;
        const parts = []; if (needSize) parts.push(e.size, e.comp); if (needAt) parts.push(e.at);
        const extra = parts.length ? (() => { const f = fields(4 + 8 * parts.length).u16(0x0001).u16(8 * parts.length); for (const p of parts) f.u64(p); return f.buf; })() : new Uint8Array(0);
        const rec = fields(46 + e.nameBytes.length + extra.length)
          .u32(SIG_CENTRAL).u16(parts.length ? 45 : 20).u16(parts.length ? 45 : 20).u16(0x0800).u16(e.method).u16(DOS_TIME).u16(DOS_DATE)
          .u32(e.crc).u32(needSize ? U32_MAX : e.comp).u32(needSize ? U32_MAX : e.size)
          .u16(e.nameBytes.length).u16(extra.length).u16(0).u16(0).u16(0).u32(0).u32(needAt ? U32_MAX : e.at)
          .bytes(e.nameBytes).bytes(extra).buf;
        await write(rec);
      }
      const cdSize = offset - cdStart;
      const zip64 = entries.length >= U16_MAX || cdStart >= U32_MAX || cdSize >= U32_MAX || entries.some((e) => e.at >= U32_MAX || e.size >= U32_MAX || e.comp >= U32_MAX);
      if (zip64) {
        const end64At = offset;
        await write(fields(56).u32(SIG_END64).u64(44).u16(45).u16(45).u32(0).u32(0).u64(entries.length).u64(entries.length).u64(cdSize).u64(cdStart).buf);
        await write(fields(20).u32(SIG_LOCATOR64).u32(0).u64(end64At).u32(1).buf);
      }
      await write(fields(22).u32(SIG_END).u16(0).u16(0)
        .u16(zip64 ? U16_MAX : entries.length).u16(zip64 ? U16_MAX : entries.length)
        .u32(zip64 ? U32_MAX : cdSize).u32(zip64 ? U32_MAX : cdStart).u16(0).buf);
      return { files: entries.length, bytes: offset, zip64 };
    },
  };
}

/** A sink that keeps the bytes, and makes a Blob of them at the end (the browser's in-memory export). */
export function memorySink() {
  const parts = [];
  return { write: (b) => { parts.push(b); }, blob: (type = 'application/zip') => new Blob(parts, { type }) };
}
