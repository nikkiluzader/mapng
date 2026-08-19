import test from 'node:test';
import assert from 'node:assert/strict';

const TILE = 256;

// ── Minimal canvas/Image stubs ─────────────────────────────────────────────
// Enough of the 2D API for repairTerrariumNoDataTiles: RGBA pixel buffers,
// getImageData, and the 9-argument nearest-neighbour drawImage it uses to blow
// an ancestor tile's sub-rect back up to full tile size.
class FakeImage {
  constructor(width, height, data) {
    this.width = width;
    this.height = height;
    this.data = data;          // Uint8ClampedArray, RGBA
  }
}

class FakeCanvasCtx {
  constructor(width, height) {
    this.width = width;
    this.height = height;
    this.data = new Uint8ClampedArray(width * height * 4);
    this.imageSmoothingEnabled = true;
  }

  clearRect() {}

  drawImage(img, sx, sy, sw, sh, dx, dy, dw, dh) {
    if (arguments.length === 3) { sx = 0; sy = 0; sw = img.width; sh = img.height; dx = arguments[1]; dy = arguments[2]; dw = sw; dh = sh; }
    for (let y = 0; y < dh; y++) {
      for (let x = 0; x < dw; x++) {
        const srcX = sx + Math.floor((x * sw) / dw);
        const srcY = sy + Math.floor((y * sh) / dh);
        const s = (srcY * img.width + srcX) * 4;
        const d = ((dy + y) * this.width + (dx + x)) * 4;
        this.data[d] = img.data[s];
        this.data[d + 1] = img.data[s + 1];
        this.data[d + 2] = img.data[s + 2];
        this.data[d + 3] = 255;
      }
    }
  }

  getImageData(x, y, w, h) {
    const out = new Uint8ClampedArray(w * h * 4);
    for (let row = 0; row < h; row++) {
      const src = ((y + row) * this.width + x) * 4;
      out.set(this.data.subarray(src, src + w * 4), row * w * 4);
    }
    return { data: out, width: w, height: h };
  }
}

const encodeTile = (heightAt) => {
  const data = new Uint8ClampedArray(TILE * TILE * 4);
  for (let y = 0; y < TILE; y++) {
    for (let x = 0; x < TILE; x++) {
      const h = heightAt(x, y);
      const v = Math.round((h + 32768) * 256);
      const i = (y * TILE + x) * 4;
      data[i] = (v >> 16) & 0xff;
      data[i + 1] = (v >> 8) & 0xff;
      data[i + 2] = v & 0xff;
      data[i + 3] = 255;
    }
  }
  return new FakeImage(TILE, TILE, data);
};

const BLANK_TILE = encodeTile(() => -32768);
const decodeAt = (ctx, x, y) => {
  const i = (y * ctx.width + x) * 4;
  return ctx.data[i] * 256 + ctx.data[i + 1] + ctx.data[i + 2] / 256 - 32768;
};

function installStubs(serveTile) {
  const requested = [];
  const originalDocument = globalThis.document;
  const originalImage = globalThis.Image;

  globalThis.document = {
    createElement() {
      const ctx = new FakeCanvasCtx(TILE, TILE);
      return { width: TILE, height: TILE, getContext: () => ctx };
    },
  };
  globalThis.Image = class {
    set src(url) {
      const [, z, x, y] = url.match(/\/(\d+)\/(\d+)\/(\d+)\.png$/).map(Number);
      requested.push(`${z}/${x}/${y}`);
      const img = serveTile(z, x, y);
      queueMicrotask(() => {
        if (img) { this.width = img.width; this.height = img.height; this.data = img.data; this.onload?.(); }
        else this.onerror?.();
      });
    }
    addEventListener() {}
    removeEventListener() {}
  };
  // The loader resolves the <img> element itself, so it must carry pixel data.
  return { requested, restore() { globalThis.document = originalDocument; globalThis.Image = originalImage; } };
}

const { repairTerrariumNoDataTiles } = await import('../services/terrain.js');

test('repairTerrariumNoDataTiles refills blank tiles from the nearest ancestor with data', async () => {
  // z15 tile 16383/12568 is blank (as AWS actually serves it near the prime
  // meridian); so is its z14 parent. The z13 grandparent carries real heights.
  const zoom = 15;
  const minTileX = 16382;
  const minTileY = 12568;
  const grandparent = encodeTile((x, y) => 100 + x + y);   // z13/4095/3142

  const stubs = installStubs((z, x, y) => {
    if (z === 13 && x === 16383 >> 2 && y === 12568 >> 2) return grandparent;
    return BLANK_TILE;
  });

  try {
    const ctx = new FakeCanvasCtx(TILE * 2, TILE);
    // Tile 0 (16382) has real data already; tile 1 (16383) came back blank.
    ctx.drawImage(encodeTile(() => 42), 0, 0);
    ctx.drawImage(BLANK_TILE, TILE, 0);

    const result = await repairTerrariumNoDataTiles({
      ctx, zoom, minTileX, minTileY, tileCountX: 2, tileCountY: 1,
    });

    assert.deepEqual(result, { repaired: 1, blank: 1 });
    assert.equal(decodeAt(ctx, 10, 10), 42, 'the tile that had data must be left untouched');

    // The blank tile now carries its quadrant of the z13 tile, upscaled 4×.
    // 16383 & 0b11 = 3 and 12568 & 0b11 = 0, so the source rect starts at
    // (3 × 64, 0 × 64) = (192, 0) and each source pixel covers 4 output pixels.
    assert.equal(decodeAt(ctx, TILE + 0, 0), 100 + 192 + 0);
    assert.equal(decodeAt(ctx, TILE + 4, 8), 100 + 193 + 2);
    assert.equal(decodeAt(ctx, TILE + 255, 255), 100 + 255 + 63);

    // It must not have settled for the equally blank z14 parent.
    assert.ok(stubs.requested.includes('14/8191/6284'), 'should try z14 first');
    assert.ok(stubs.requested.includes('13/4095/3142'), 'should fall through to z13');
  } finally {
    stubs.restore();
  }
});

test('repairTerrariumNoDataTiles leaves a fully populated mosaic alone', async () => {
  const stubs = installStubs(() => { throw new Error('should not fetch anything'); });
  try {
    const ctx = new FakeCanvasCtx(TILE, TILE);
    ctx.drawImage(encodeTile((x) => x), 0, 0);
    const result = await repairTerrariumNoDataTiles({
      ctx, zoom: 15, minTileX: 0, minTileY: 0, tileCountX: 1, tileCountY: 1,
    });
    assert.deepEqual(result, { repaired: 0, blank: 0 });
    assert.equal(stubs.requested.length, 0);
  } finally {
    stubs.restore();
  }
});

test('repairTerrariumNoDataTiles gives up when no ancestor has data', async () => {
  const stubs = installStubs(() => BLANK_TILE);
  try {
    const ctx = new FakeCanvasCtx(TILE, TILE);
    ctx.drawImage(BLANK_TILE, 0, 0);
    const result = await repairTerrariumNoDataTiles({
      ctx, zoom: 15, minTileX: 16383, minTileY: 12568, tileCountX: 1, tileCountY: 1, maxZoomOut: 3,
    });
    assert.deepEqual(result, { repaired: 0, blank: 1 });
    assert.equal(decodeAt(ctx, 4, 4), -32768, 'still no-data, so downstream fill still applies');
  } finally {
    stubs.restore();
  }
});
