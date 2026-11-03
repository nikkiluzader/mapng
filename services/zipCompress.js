// The level ZIP's big entries compressed by the platform's own deflate
// (CompressionStream: native zlib in the browser and in Node, several entries
// at once) before JSZip writes the archive. JSZip's own deflate is pako, plain
// JavaScript on one thread: a dense city's 1-4 GB of DAE text took 30-100 s
// there. JSZip copies an entry it holds already compressed as it is (its path
// for entries read from an existing ZIP), so only the compression moves.
// Unzipped, every entry is byte for byte what it was.

// (already compressed or nearly so: left to JSZip, where it costs little)
const SKIP = /\.(png|jpe?g|webp|dds|zip|ogg|mp3|7z)$/i;
const MIN_BYTES = 64 * 1024;
// (raw bytes being compressed at once: a browser tab has 4 GB in all, and 32
// lanes of building tiles at once held 4-5 GB more at the peak)
const IN_FLIGHT_BYTES = typeof process !== 'undefined' && process.versions?.node ? 2 * 2 ** 30 : 256 * 2 ** 20;

function sizeOf(data) {
  if (typeof data === 'string') return data.length;
  return data?.byteLength ?? data?.size ?? 0;
}

/**
 * JSZip's CompressedObject and DEFLATE method (not exported: taken off a tiny
 * archive read back). Its prototype is replaced wholesale, so instances are
 * made from the prototype, which is what JSZip's instanceof checks.
 */
async function jszipInternals(JSZip) {
  const tiny = new JSZip();
  tiny.file('a', 'aaaa', { compression: 'DEFLATE' });
  const back = await JSZip.loadAsync(await tiny.generateAsync({ type: 'uint8array', compression: 'DEFLATE' }));
  const data = back.file('a')?._data;
  const fields = ['compressedSize', 'uncompressedSize', 'crc32', 'compression', 'compressedContent'];
  if (!data || data.compression?.magic !== '\x08\x00' || typeof data.getCompressedWorker !== 'function'
    || !fields.every((k) => Object.prototype.hasOwnProperty.call(data, k))) return null;
  const proto = Object.getPrototypeOf(data);
  return {
    proto,
    DEFLATE: data.compression,
    make: (compressedSize, uncompressedSize, crc32, compression, compressedContent) => Object.assign(
      Object.create(proto), { compressedSize, uncompressedSize, crc32, compression, compressedContent }),
  };
}

let crcTable = null;
function crc32js(bytes) {
  if (!crcTable) {
    crcTable = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
      crcTable[n] = c;
    }
  }
  let crc = -1;
  for (let i = 0; i < bytes.length; i++) crc = crcTable[(crc ^ bytes[i]) & 0xFF] ^ (crc >>> 8);
  return (crc ^ -1) | 0;
}

// Node's zlib, where there is one (the desktop app's export runs in Node)
let nodeZlib;
async function zlibOf() {
  if (nodeZlib === undefined) {
    nodeZlib = null;
    if (typeof process !== 'undefined' && process.versions?.node) {
      try { nodeZlib = await import(/* @vite-ignore */ ['node', 'zlib'].join(':')); } catch { /* none */ }
    }
  }
  return nodeZlib;
}

// (zlib.crc32, native, where there is one; JavaScript otherwise)
async function crc32Of(bytes) {
  const zlib = await zlibOf();
  return typeof zlib?.crc32 === 'function' ? zlib.crc32(bytes) | 0 : crc32js(bytes);
}

// A big entry in Node deflated in pieces on several threads at once, as pigz
// does: each piece ends on a sync flush (byte-aligned, not final) and the
// last finishes the stream, so joined they are one valid deflate stream. One
// 1-3 GB sidewalk mesh on one thread held the whole zip up 20-60 s.
const PARALLEL_FROM_BYTES = 32 * 2 ** 20;
const PIECE_BYTES = 16 * 2 ** 20;
async function deflateRawInPieces(zlib, bytes) {
  const pieces = [];
  for (let o = 0; o < bytes.length; o += PIECE_BYTES) {
    const last = o + PIECE_BYTES >= bytes.length;
    pieces.push(new Promise((resolve, reject) => zlib.deflateRaw(bytes.subarray(o, Math.min(o + PIECE_BYTES, bytes.length)),
      { finishFlush: last ? zlib.constants.Z_FINISH : zlib.constants.Z_SYNC_FLUSH },
      (err, out) => (err ? reject(err) : resolve(out)))));
  }
  const parts = await Promise.all(pieces);
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) { out.set(p, at); at += p.length; }
  return out;
}

async function deflateRaw(bytes) {
  // (Node: zlib straight from the buffer, on its thread pool; through
  // Blob.stream() and CompressionStream, Node's web streams spent a minute
  // of an 8 km export shuffling small chunks in JavaScript)
  const zlib = await zlibOf();
  if (zlib?.deflateRaw && zlib.constants) {
    if (bytes.length >= PARALLEL_FROM_BYTES) return deflateRawInPieces(zlib, bytes);
    return new Promise((resolve, reject) => zlib.deflateRaw(bytes, (err, out) => (err ? reject(err) : resolve(out))));
  }
  const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/**
 * A compressor for a zip's entries: add(entry) queues one (each compressed
 * as lanes and the byte budget allow, in place), drain() resolves when all
 * queued are done. Resolves null when the platform has no CompressionStream
 * or JSZip's internals are not as expected (JSZip then compresses them all,
 * as before).
 */
export async function createZipCompressor(JSZip, { concurrency, inFlightBytes = IN_FLIGHT_BYTES, onDone } = {}) {
  if (typeof CompressionStream === 'undefined') return null;
  try { new CompressionStream('deflate-raw'); } catch { return null; }
  const internals = await jszipInternals(JSZip).catch(() => null);
  if (!internals) return null;
  const { proto, DEFLATE, make } = internals;
  const isCompressed = (d) => d !== null && typeof d === 'object' && Object.getPrototypeOf(d) === proto;
  const lanes = Math.max(1, concurrency || globalThis.navigator?.hardwareConcurrency || 4);
  const queue = [];
  const queued = new Set();
  let running = 0; let inFlight = 0; let count = 0;
  let idle = null; let wakeIdle = null;
  let hook = onDone;
  const eligible = (entry) => entry && !entry.dir && !SKIP.test(entry.name) && !isCompressed(entry._data) && !queued.has(entry);
  const compress = async (entry) => {
    const raw = await entry.async('uint8array');
    if (raw.length < MIN_BYTES) return;
    const [packed, crc] = await Promise.all([deflateRaw(raw), crc32Of(raw)]);
    entry._data = make(packed.length, raw.length, crc, DEFLATE, packed);
    entry._dataBinary = true;
    count++;
  };
  // (past the byte budget nothing more starts until a lane finishes, unless none is running)
  const pump = () => {
    while (queue.length && running < lanes && (running === 0 || inFlight + sizeOf(queue[0]._data) <= inFlightBytes)) {
      const entry = queue.shift();
      const size = sizeOf(entry._data);
      running++; inFlight += size;
      compress(entry).catch(() => { /* left to JSZip */ }).finally(() => {
        running--; inFlight -= size;
        hook?.(entry);
        pump();
      });
    }
    if (!queue.length && running === 0 && wakeIdle) { const w = wakeIdle; idle = null; wakeIdle = null; w(); }
  };
  return {
    isCompressed,
    eligible,
    add(entry) {
      if (!eligible(entry)) return;
      queued.add(entry);
      queue.push(entry);
      pump();
    },
    drain() {
      if (!queue.length && running === 0) return Promise.resolve();
      idle ??= new Promise((resolve) => { wakeIdle = resolve; });
      return idle;
    },
    get count() { return count; },
    // (called with each entry as it finishes, done or left to JSZip)
    get onDoneHook() { return hook; },
    set onDoneHook(fn) { hook = fn; },
  };
}

/**
 * Compress the zip's big entries natively, in parallel, in place (those an
 * eager compressor, if given, has not done already). Resolves the number of
 * entries compressed natively in all (0: JSZip compresses them, as before).
 * onProgress(fraction, name) as entries finish.
 */
export async function precompressZipEntries(zip, JSZip, { onProgress, concurrency, inFlightBytes, compressor = null } = {}) {
  const c = compressor || await createZipCompressor(JSZip, { concurrency, inFlightBytes });
  if (!c) return 0;
  await c.drain();
  const entries = Object.values(zip.files).filter((f) => c.eligible(f));
  let done = 0;
  const finished = new Promise((resolve) => {
    if (!entries.length) { resolve(); return; }
    const total = entries.length;
    const prev = c.onDoneHook;
    c.onDoneHook = (entry) => {
      prev?.(entry);
      done++;
      onProgress?.(done / total, entry.name);
      if (done === total) resolve();
    };
  });
  entries.forEach((entry) => c.add(entry));
  await finished;
  await c.drain();
  return c.count;
}
