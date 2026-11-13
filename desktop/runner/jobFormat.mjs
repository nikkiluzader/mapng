// How an export job's values sit on disk. Plain JSON stays in job.json; big
// or binary values are files beside it, referenced as { $file, as, type }:
//   as: 'json'                       a JSON file (the OSM features)
//   as: 'Float32Array' | 'Uint8Array' | ...   a typed array's bytes
//   as: 'blob'                       a Blob (type: its MIME type)
//   as: 'blobUrl'                    a Blob behind a blob: URL (image URLs)
//   as: 'canvas'                     a canvas, as its PNG
// The app writes them (services/platform/desktop.js packs them in the
// page); the export runner revives them here.
import { canvasToPng } from './fastPng.mjs';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { createCanvas, loadImage } from '@napi-rs/canvas';
import { withBrowserMethods } from './browserShims.mjs';

const TYPED = {
  Float32Array, Float64Array, Int8Array, Uint8Array, Uint8ClampedArray,
  Int16Array, Uint16Array, Int32Array, Uint32Array,
};

async function revive(ref, dir) {
  const file = path.join(dir, path.basename(ref.$file));
  if (ref.as === 'json') return JSON.parse(fs.readFileSync(file, 'utf8'));
  const buf = fs.readFileSync(file);
  if (ref.as === 'canvas') {
    const img = await loadImage(buf);
    const canvas = withBrowserMethods(createCanvas(img.width, img.height));
    canvas.getContext('2d').drawImage(img, 0, 0);
    return canvas;
  }
  if (ref.as === 'blob' || ref.as === 'blobUrl') {
    const blob = new Blob([buf], { type: ref.type || '' });
    return ref.as === 'blob' ? blob : URL.createObjectURL(blob);
  }
  const Typed = TYPED[ref.as];
  if (!Typed) throw new Error(`unknown job value kind ${ref.as}`);
  const bytes = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  return new Typed(bytes);
}

/** A value from job.json with its file references read back. */
export async function reviveJobValue(value, dir) {
  if (Array.isArray(value)) return Promise.all(value.map((v) => reviveJobValue(v, dir)));
  if (value && typeof value === 'object') {
    if (typeof value.$file === 'string') return revive(value, dir);
    const entries = await Promise.all(Object.entries(value).map(async ([k, v]) => [k, await reviveJobValue(v, dir)]));
    return Object.fromEntries(entries);
  }
  return value;
}

// ---- the other way: values made in this process written as job files ----

// (the same bytes twice — an image as its Blob and behind its URL — one file)
function writeOnce(dir, state, file, bytes) {
  const hash = crypto.createHash('sha1').update(bytes).digest('hex');
  state.byHash ??= new Map();
  const known = state.byHash.get(hash);
  if (known) return known;
  fs.writeFileSync(path.join(dir, file), bytes);
  state.byHash.set(hash, file);
  return file;
}

const isNapiCanvas = (v) => v && typeof v.getContext === 'function' && typeof v.encode === 'function';

/**
 * A value made ready for a JSON file in dir, its big and binary parts
 * written beside it in the same { $file, as } form (the page reads them
 * back through the app:// protocol: services/platform/desktop.js).
 * Canvases are left out where the value also carries the same image as a
 * Blob or URL (the page takes either); others go as PNG.
 */
export async function writeJobValue(value, key, dir, state = { files: 0 }) {
  if (value == null || typeof value === 'boolean' || typeof value === 'number') return value;
  if (typeof value === 'function' || typeof value === 'symbol') return undefined;
  const name = (ext = '') => `${String(key).replace(/[^\w-]+/g, '_')}_${++state.files}${ext}`;
  const extOf = (type) => ({ 'image/png': '.png', 'image/jpeg': '.jpg', 'image/webp': '.webp', 'application/json': '.json' }[type] || '');
  if (typeof value === 'string') {
    if (value.startsWith('blob:')) {
      const blob = await (await fetch(value)).blob();
      const file = writeOnce(dir, state, name(extOf(blob.type)), Buffer.from(await blob.arrayBuffer()));
      return { $file: file, as: 'blobUrl', type: blob.type };
    }
    return value;
  }
  if (ArrayBuffer.isView(value)) {
    const file = name('.bin');
    fs.writeFileSync(path.join(dir, file), new Uint8Array(value.buffer, value.byteOffset, value.byteLength));
    return { $file: file, as: value.constructor.name };
  }
  if (value instanceof ArrayBuffer) {
    const file = name('.bin');
    fs.writeFileSync(path.join(dir, file), new Uint8Array(value));
    return { $file: file, as: 'Uint8Array' };
  }
  if (value instanceof Blob) {
    const file = writeOnce(dir, state, name(extOf(value.type)), Buffer.from(await value.arrayBuffer()));
    return { $file: file, as: 'blob', type: value.type };
  }
  if (isNapiCanvas(value)) {
    const file = name('.png');
    fs.writeFileSync(path.join(dir, file), await canvasToPng(value));
    return { $file: file, as: 'canvas' };
  }
  if (Array.isArray(value)) {
    const out = [];
    for (let i = 0; i < value.length; i++) out.push(await writeJobValue(value[i], key, dir, state));
    return out;
  }
  if (value instanceof Map || value instanceof Set) return undefined;
  const out = {};
  for (const [k, v] of Object.entries(value)) {
    // (a canvas twin of a Blob or URL alongside it: the page uses either)
    if (/Canvas$/.test(k) && isNapiCanvas(v)) {
      const base = k.slice(0, -'Canvas'.length);
      if (value[`${base}Blob`] || value[`${base}Url`]) continue;
    }
    const written = await writeJobValue(v, k, dir, state);
    if (written !== undefined) out[k] = written;
  }
  return out;
}
