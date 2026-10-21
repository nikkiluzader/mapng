import test from 'node:test';
import assert from 'node:assert/strict';
import { decode } from 'fast-png';

import { getBaseTextureSize, chooseBaseTextureSize } from '../services/baseTextureSize.js';
import { sampleSatelliteTexture } from '../services/satelliteImageSampler.js';
import { solidColorPngBlob } from '../services/osmTerrainMaterials.js';

test('base texture is 2× the grid up to 4096 grids, capped at 8192', () => {
  assert.equal(getBaseTextureSize(1024), 2048);
  assert.equal(getBaseTextureSize(2048), 4096);
  assert.equal(getBaseTextureSize(4096), 8192);
  assert.equal(getBaseTextureSize(8192), 8192);
  assert.equal(getBaseTextureSize(16384), 8192);
});

test('export base texture size follows the detail the texture carries', () => {
  assert.equal(chooseBaseTextureSize(2048, 1024), 2048);
  assert.equal(chooseBaseTextureSize(4096, 1024), 2048, 'never above the 2× size');
  assert.equal(chooseBaseTextureSize(1024, 1024), 1024, '1× texture (OSM, older levels) stays 1×');
  assert.equal(chooseBaseTextureSize(64, 1024), 1024, 'placeholder is resized to the grid');
  assert.equal(chooseBaseTextureSize(8192, 8192), 8192);
});

function mosaicFrom(w, h, fn) {
  const pixels = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const [r, g, b] = fn(x, y);
      const i = (y * w + x) * 4;
      pixels[i] = r; pixels[i + 1] = g; pixels[i + 2] = b; pixels[i + 3] = 255;
    }
  }
  return { pixels, width: w, height: h };
}

test('2× texture over a mosaic of the same pixel size reproduces it exactly', () => {
  // grid point i spans mosaic pixels [2i, 2i + 2); output pixel ix lands on
  // mosaic pixel centre ix + 0.5. 40 px exercises several lattice cells.
  const grid = 20;
  const mosaic = mosaicFrom(40, 40, (x, y) => [x * 6, y * 6, (x * 7 + y * 3) % 256]);
  const out = sampleSatelliteTexture({
    width: grid,
    height: grid,
    outWidth: 40,
    outHeight: 40,
    mosaic,
    gridToMosaic: (gx, gy) => [(gx + 0.5) * 2, (gy + 0.5) * 2],
  });
  for (let i = 0; i < out.length; i++) {
    assert.ok(Math.abs(out[i] - mosaic.pixels[i]) <= 1, `pixel byte ${i}: ${out[i]} vs ${mosaic.pixels[i]}`);
  }
});

test('downsampling averages the footprint instead of point-sampling', () => {
  // 4 mosaic pixels per output pixel over a one-pixel checkerboard: a point
  // sample gives 0 or 255, the area average ~128.
  const mosaic = mosaicFrom(16, 16, (x, y) => ((x + y) % 2 ? [255, 255, 255] : [0, 0, 0]));
  const out = sampleSatelliteTexture({
    width: 4,
    height: 4,
    outWidth: 4,
    outHeight: 4,
    mosaic,
    gridToMosaic: (gx, gy) => [(gx + 0.5) * 4, (gy + 0.5) * 4],
  });
  for (let i = 0; i < out.length; i += 4) {
    assert.ok(out[i] > 110 && out[i] < 145, `expected a grey average, got ${out[i]}`);
    assert.equal(out[i + 3], 255);
  }
});

test('solid-colour PNG decodes to the full size in the given colour', async () => {
  const blob = await solidColorPngBlob(300, [128, 128, 255]);
  const img = decode(new Uint8Array(await blob.arrayBuffer()));
  assert.equal(img.width, 300);
  assert.equal(img.height, 300);
  assert.equal(img.channels, 3);
  for (let i = 0; i < img.data.length; i += 3) {
    assert.deepEqual([img.data[i], img.data[i + 1], img.data[i + 2]], [128, 128, 255]);
  }
});
