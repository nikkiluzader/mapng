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

// (Node's zlib.crc32, native, where there is one; JavaScript otherwise)
let nativeCrc32;
async function crc32Of(bytes) {
  if (nativeCrc32 === undefined) {
    nativeCrc32 = null;
    if (typeof process !== 'undefined' && process.versions?.node) {
      try {
        const zlib = await import(/* @vite-ignore */ ['node', 'zlib'].join(':'));
        if (typeof zlib.crc32 === 'function') nativeCrc32 = (b) => zlib.crc32(b) | 0;
      } catch { /* the JavaScript one */ }
    }
  }
  return nativeCrc32 ? nativeCrc32(bytes) : crc32js(bytes);
}

async function deflateRaw(bytes) {
  const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/**
 * Compress the zip's big entries natively, in parallel, in place. Resolves
 * the number of entries done (0 when the platform has no CompressionStream or
 * JSZip's internals are not as expected: JSZip then compresses them all, as
 * before). onProgress(fraction, name) as entries finish.
 */
export async function precompressZipEntries(zip, JSZip, { onProgress, concurrency, inFlightBytes = IN_FLIGHT_BYTES } = {}) {
  if (typeof CompressionStream === 'undefined') return 0;
  try { new CompressionStream('deflate-raw'); } catch { return 0; }
  const internals = await jszipInternals(JSZip).catch(() => null);
  if (!internals) return 0;
  const { proto, DEFLATE, make } = internals;
  const isCompressed = (d) => d !== null && typeof d === 'object' && Object.getPrototypeOf(d) === proto;
  const entries = Object.values(zip.files).filter((f) => !f.dir && !SKIP.test(f.name) && !isCompressed(f._data));
  const lanes = Math.max(1, concurrency || globalThis.navigator?.hardwareConcurrency || 4);
  let next = 0; let done = 0; let count = 0;
  let inFlight = 0; let waiting = [];
  const release = () => { const w = waiting; waiting = []; w.forEach((resolve) => resolve()); };
  const compress = async (entry) => {
    const raw = await entry.async('uint8array');
    if (raw.length < MIN_BYTES) return;
    const [packed, crc] = await Promise.all([deflateRaw(raw), crc32Of(raw)]);
    entry._data = make(packed.length, raw.length, crc, DEFLATE, packed);
    entry._dataBinary = true;
    count++;
  };
  const lane = async () => {
    while (next < entries.length) {
      // (past the byte budget: wait for a lane to finish, unless none is running)
      while (inFlight > 0 && next < entries.length && inFlight + sizeOf(entries[next]._data) > inFlightBytes) {
        await new Promise((resolve) => waiting.push(resolve));
      }
      if (next >= entries.length) break;
      const entry = entries[next++];
      const size = sizeOf(entry._data);
      inFlight += size;
      try { await compress(entry); } finally { inFlight -= size; release(); }
      onProgress?.(++done / entries.length, entry.name);
    }
  };
  await Promise.all(Array.from({ length: Math.min(lanes, entries.length) }, lane));
  return count;
}
