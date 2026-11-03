// The browser APIs the level export draws with, in Node: a real canvas
// (@napi-rs/canvas) behind document.createElement('canvas'), OffscreenCanvas,
// Image, ImageData and createImageBitmap, and blob: URLs kept in memory so
// images and fetch() can read them back. (scripts/sweep/polyfill.mjs stubs
// the images instead; the desktop app needs the real ones.)
import fs from 'node:fs';
import path from 'node:path';
import { createCanvas, Image, ImageData, loadImage } from '@napi-rs/canvas';

const blobs = new Map();
let blobSeq = 0;

const imageSrc = Object.getOwnPropertyDescriptor(Image.prototype, 'src');

/** The bytes behind a blob:, data: or file URL, or a Buffer as given. */
async function bytesOf(src) {
  if (typeof src !== 'string') return src;
  if (src.startsWith('blob:')) {
    const blob = blobs.get(src);
    if (!blob) throw new Error(`unknown blob URL ${src}`);
    return Buffer.from(await blob.arrayBuffer());
  }
  return Buffer.from(await (await fetch(src)).arrayBuffer());
}

function mimeOf(type) {
  return type === 'image/jpeg' || type === 'image/webp' ? type : 'image/png';
}

// the canvas methods the browser has and @napi-rs/canvas names differently
export function withBrowserMethods(canvas) {
  canvas.toBlob = function toBlob(callback, type, quality) {
    const mime = mimeOf(type);
    const q = Number.isFinite(quality) ? Math.round(quality * 100) : undefined;
    this.encode(mime === 'image/png' ? 'png' : mime.slice(6), q)
      .then((buf) => callback(new Blob([buf], { type: mime })), () => callback(null));
  };
  canvas.convertToBlob = function convertToBlob({ type, quality } = {}) {
    return new Promise((resolve) => this.toBlob(resolve, type, quality));
  };
  return canvas;
}

class ShimImage extends Image {
  constructor(width, height) {
    super(width, height);
    this.crossOrigin = null;
  }

  get src() { return this._src ?? ''; }

  set src(value) {
    this._src = value;
    bytesOf(value).then(
      (bytes) => imageSrc.set.call(this, bytes),
      (error) => this.onerror?.(error),
    );
  }

  decode() {
    return new Promise((resolve, reject) => {
      if (this.complete && this.width) { resolve(); return; }
      const { onload, onerror } = this;
      this.onload = (...a) => { onload?.(...a); resolve(); };
      this.onerror = (e) => { onerror?.(e); reject(e); };
    });
  }
}

const MIME = { '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.zip': 'application/zip', '.dds': 'image/vnd-ms.dds' };

/**
 * assetsDir: the app's own files (public/ in development, the built dist/
 * when packaged), which the page reads by path (/beamng_shape_materials.json);
 * apiOrigin: where /api/* goes, as on mapng.com.
 */
export function installBrowserShims({ assetsDir, apiOrigin = 'https://mapng.com' } = {}) {
  globalThis.document = {
    createElement(tag) {
      if (tag === 'canvas') return withBrowserMethods(createCanvas(300, 150));
      // (download anchors and the like: inert)
      return { style: {}, setAttribute() {}, click() {}, remove() {}, appendChild() {} };
    },
    body: { appendChild() {}, removeChild() {} },
  };
  globalThis.OffscreenCanvas = class OffscreenCanvas {
    constructor(width, height) { return withBrowserMethods(createCanvas(width, height)); }
  };
  globalThis.Image = ShimImage;
  globalThis.ImageData = ImageData;
  globalThis.createImageBitmap = async (source, ...rest) => {
    if (rest.length >= 4) {
      // (sx, sy, sw, sh: a crop)
      const [sx, sy, sw, sh] = rest;
      const img = await globalThis.createImageBitmap(source);
      const c = createCanvas(sw, sh);
      c.getContext('2d').drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh);
      return bitmapOf(c);
    }
    if (source instanceof Blob) return bitmapOf(await loadImage(Buffer.from(await source.arrayBuffer())));
    if (source instanceof ImageData) {
      const c = createCanvas(source.width, source.height);
      c.getContext('2d').putImageData(source, 0, 0);
      return bitmapOf(c);
    }
    return bitmapOf(source);
  };

  const originalCreate = URL.createObjectURL;
  URL.createObjectURL = (blob) => {
    if (!(blob instanceof Blob)) return originalCreate(blob);
    const url = `blob:mapng-desktop/${++blobSeq}`;
    blobs.set(url, blob);
    return url;
  };
  URL.revokeObjectURL = (url) => { blobs.delete(url); };

  const originalFetch = globalThis.fetch;
  globalThis.fetch = (input, init) => {
    const url = typeof input === 'string' ? input : input?.url;
    if (url?.startsWith('blob:')) {
      const blob = blobs.get(url);
      return Promise.resolve(blob ? new Response(blob) : new Response(null, { status: 404 }));
    }
    if (url?.startsWith('/api/')) return originalFetch(apiOrigin + url, init);
    if (url?.startsWith('/') && !url.startsWith('//') && assetsDir) {
      const rel = decodeURIComponent(url.split(/[?#]/)[0]);
      const file = path.join(assetsDir, path.normalize(rel).replace(/^([/\\])+/, ''));
      if (!file.startsWith(path.resolve(assetsDir) + path.sep) || !fs.existsSync(file)) {
        return Promise.resolve(new Response(null, { status: 404 }));
      }
      return fs.promises.readFile(file).then((buf) => new Response(buf, {
        headers: { 'content-type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream' },
      }));
    }
    return originalFetch(input, init);
  };
}

// an ImageBitmap: anything drawImage takes, with close()
function bitmapOf(drawable) {
  if (typeof drawable.close !== 'function') drawable.close = () => {};
  return drawable;
}
