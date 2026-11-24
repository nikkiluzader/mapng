// Canvas / image / fetch stand-ins so the exporter runs headless in Node
// (images become 4-byte stubs; scripts/sweep/fixStubs.mjs replaces them).
import { readFileSync } from 'node:fs';
import sharp from 'sharp';
export function installCanvasPolyfill() {
  const originalDocument = globalThis.document;
  const originalCreateImageBitmap = globalThis.createImageBitmap;
  const originalFetch = globalThis.fetch;
  const emptyZipEOCD = new Uint8Array([
    0x50, 0x4b, 0x05, 0x06,
    0x00, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00,
    0x00, 0x00,
  ]);

  class FakeCanvas {
    constructor() {
      this.width = 0;
      this.height = 0;
      this._ctx = null;
    }

    getContext() {
      if (this._ctx) return this._ctx;
      this._ctx = {
        fillStyle: '#000000',
        // (a real image drawn over the whole canvas: kept, resized by toBlob)
        drawImage: (bmp, ...a) => {
          if (bmp?._buf) this._src = bmp._buf;
          // (a decoded bitmap drawn as a window, drawImage(bmp, sx, sy, sw, sh, dx, dy, dw, dh) at 1:1: kept for
          // getImageData, so the export's pixel reads (the vegetation mask) see the real picture)
          if (bmp?._raw) this._win = { bmp, sx: a.length >= 8 ? a[0] : 0, sy: a.length >= 8 ? a[1] : 0, dx: a.length >= 8 ? a[4] : (a[0] || 0), dy: a.length >= 8 ? a[5] : (a[1] || 0) };
        },
        clearRect: () => { this._win = null; },
        getImageData: (x, y, w, h) => {
          const data = new Uint8ClampedArray(w * h * 4); const win = this._win;
          if (win) {
            const { bmp } = win;
            for (let r = 0; r < h; r++) {
              const syy = win.sy + (y + r - win.dy); if (syy < 0 || syy >= bmp.height) continue;
              for (let c = 0; c < w; c++) {
                const sxx = win.sx + (x + c - win.dx); if (sxx < 0 || sxx >= bmp.width) continue;
                const si = (syy * bmp.width + sxx) * 4; const di = (r * w + c) * 4;
                data[di] = bmp._raw[si]; data[di + 1] = bmp._raw[si + 1]; data[di + 2] = bmp._raw[si + 2]; data[di + 3] = bmp._raw[si + 3];
              }
            }
          }
          return { width: w, height: h, data };
        },
        fillRect() {},
        putImageData() {},
        createImageData(w, h) {
          return {
            width: w,
            height: h,
            data: new Uint8ClampedArray(w * h * 4),
          };
        },
      };
      return this._ctx;
    }

    toBlob(callback, type = 'image/png') {
      if (this._src) {
        sharp(this._src).resize(this.width, this.height, { fit: 'fill' }).png().toBuffer()
          .then((b) => callback(new Blob([b], { type: 'image/png' })));
        return;
      }
      const bytes = new Uint8Array([137, 80, 78, 71]);
      bytes.__type = type;
      bytes.__width = this.width;
      bytes.__height = this.height;
      callback(bytes);
    }
  }

  globalThis.document = {
    createElement(tag) {
      if (tag !== 'canvas') {
        throw new Error(`Unsupported element in test polyfill: ${tag}`);
      }
      return new FakeCanvas();
    },
  };

  // real images (the base texture handed in) decoded for their size, kept for
  // drawImage; the exporter's own stubs as before
  globalThis.createImageBitmap = async (blob, opts) => {
    if (typeof Blob !== 'undefined' && blob instanceof Blob) {
      const buf = Buffer.from(await blob.arrayBuffer());
      try {
        const m = await sharp(buf).metadata();
        // (asked at a size: decoded to pixels at that size as well, for getImageData)
        if (opts?.resizeWidth && opts?.resizeHeight) {
          const raw = await sharp(buf).resize(opts.resizeWidth, opts.resizeHeight, { fit: 'fill' }).ensureAlpha().raw().toBuffer();
          return { width: opts.resizeWidth, height: opts.resizeHeight, _buf: buf, _raw: raw, close() {} };
        }
        return { width: m.width, height: m.height, _buf: buf, close() {} };
      } catch { /* not an image */ }
    }
    return { width: Number(blob?.__width) || 64, height: Number(blob?.__height) || 64, close() {} };
  };

  globalThis.fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : String(input?.url || '');
    if (url === '/mapng_flag_static.zip') {
      return {
        ok: true,
        status: 200,
        arrayBuffer: async () => emptyZipEOCD.buffer.slice(0),
      };
    }
    if (/^\/cubemap\/skybox[0-5]\.hdr\.dds$/.test(url)) {
      // 'DDS ' magic bytes; content is irrelevant to the export wiring.
      return {
        ok: true,
        status: 200,
        arrayBuffer: async () => new Uint8Array([0x44, 0x44, 0x53, 0x20]).buffer,
      };
    }
    // (the country outlines: without them every area got no country, so the
    // Americas' yellow centre lines and right-hand rules wherever it was)
    if (url === '/country_rules.json') {
      const raw = readFileSync(new URL('../../public/country_rules.json', import.meta.url), 'utf8');
      return { ok: true, status: 200, json: async () => JSON.parse(raw), text: async () => raw };
    }
    if (url === '/beamng_shape_materials.json') {
      const raw = readFileSync(new URL('../../public/beamng_shape_materials.json', import.meta.url), 'utf8');
      return { ok: true, status: 200, json: async () => JSON.parse(raw) };
    }
    if (typeof originalFetch === 'function') {
      return originalFetch(input, init);
    }
    throw new Error(`Unexpected fetch in test: ${url}`);
  };

  return () => {
    if (originalDocument === undefined) {
      delete globalThis.document;
    } else {
      globalThis.document = originalDocument;
    }
    if (originalCreateImageBitmap === undefined) {
      delete globalThis.createImageBitmap;
    } else {
      globalThis.createImageBitmap = originalCreateImageBitmap;
    }
    if (originalFetch === undefined) {
      delete globalThis.fetch;
    } else {
      globalThis.fetch = originalFetch;
    }
  };
}

