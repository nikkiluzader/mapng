// How an export job's values sit on disk. Plain JSON stays in job.json; big
// or binary values are files beside it, referenced as { $file, as, type }:
//   as: 'json'                       a JSON file (the OSM features)
//   as: 'Float32Array' | 'Uint8Array' | ...   a typed array's bytes
//   as: 'blob'                       a Blob (type: its MIME type)
//   as: 'blobUrl'                    a Blob behind a blob: URL (image URLs)
//   as: 'canvas'                     a canvas, as its PNG
// The app writes them (services/platform/desktop.js packs them in the
// page); the export runner revives them here.
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
