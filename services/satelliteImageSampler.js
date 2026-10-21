// Satellite mosaic → output texture resampling (resamplerWorker.js).
//
// The output texture may be finer than the terrain grid (baseTextureSize.js).
// Output pixel (ix, iy) sits at grid coordinate (i + 0.5) · grid / out − 0.5,
// so at 1× pixel i is grid point i as before.
//
// Mosaic positions come from the caller's gridToMosaic(gx, gy) on a coarse
// lattice and are interpolated in between: the projection chain (local
// transverse Mercator → WGS84 → Web Mercator) is smooth over a few metres, and
// one proj4 call per output pixel dominated the cost at 8192².
//
// Each sample is bilinear; where one output pixel spans more than about one
// mosaic pixel, an n×n grid of bilinear taps averages its footprint, so
// downsampling no longer aliases (the old path took the nearest mosaic pixel).

export const IMAGE_LATTICE_STEP = 16;
const MAX_TAPS = 4;

/**
 * @param {object} p
 * @param {number} p.width        terrain grid width
 * @param {number} p.height       terrain grid height
 * @param {number} p.outWidth     output texture width
 * @param {number} p.outHeight    output texture height
 * @param {{pixels: ArrayLike<number>, width: number, height: number}} p.mosaic  RGBA mosaic
 * @param {(gx: number, gy: number) => [number, number]} p.gridToMosaic  mosaic pixel position (pixel i spans [i, i+1))
 * @param {Uint8ClampedArray} [p.out]  RGBA output buffer (allocated when omitted)
 * @returns {Uint8ClampedArray}
 */
export function sampleSatelliteTexture({ width, height, outWidth, outHeight, mosaic, gridToMosaic, out }) {
  const outW = Math.max(1, Math.floor(outWidth));
  const outH = Math.max(1, Math.floor(outHeight));
  const rgba = out ?? new Uint8ClampedArray(outW * outH * 4);
  const sx = width / outW;
  const sy = height / outH;
  const at = (ix, iy) => gridToMosaic((ix + 0.5) * sx - 0.5, (iy + 0.5) * sy - 0.5);

  // Lattice nodes at multiples of the step, plus the last row/column.
  const step = IMAGE_LATTICE_STEP;
  const nodesX = [];
  for (let x = 0; x < outW - 1; x += step) nodesX.push(x);
  nodesX.push(outW - 1);
  const nodesY = [];
  for (let y = 0; y < outH - 1; y += step) nodesY.push(y);
  nodesY.push(outH - 1);
  const lx = new Float64Array(nodesX.length * nodesY.length);
  const ly = new Float64Array(nodesX.length * nodesY.length);
  for (let j = 0; j < nodesY.length; j++) {
    for (let i = 0; i < nodesX.length; i++) {
      const [mx, my] = at(nodesX[i], nodesY[j]);
      lx[j * nodesX.length + i] = mx;
      ly[j * nodesX.length + i] = my;
    }
  }

  // Footprint of one output pixel in mosaic pixels, measured at the centre.
  const cx = Math.floor(outW / 2);
  const cy = Math.floor(outH / 2);
  const [ax, ay] = at(cx, cy);
  const [bx, by] = at(cx + 1, cy);
  const [dx, dy] = at(cx, cy + 1);
  const footX = Math.hypot(bx - ax, by - ay);
  const footY = Math.hypot(dx - ax, dy - ay);
  const taps = Math.max(1, Math.min(MAX_TAPS, Math.round(Math.max(footX, footY))));

  const src = mosaic.pixels;
  const mw = mosaic.width;
  const mh = mosaic.height;
  const acc = [0, 0, 0];
  const bilinearAdd = (px, py) => {
    // Pixel centres are at i + 0.5; clamp to the mosaic edge.
    let fx = px - 0.5;
    let fy = py - 0.5;
    if (fx < 0) fx = 0; else if (fx > mw - 1) fx = mw - 1;
    if (fy < 0) fy = 0; else if (fy > mh - 1) fy = mh - 1;
    const x0 = Math.floor(fx);
    const y0 = Math.floor(fy);
    const x1 = x0 + 1 < mw ? x0 + 1 : x0;
    const y1 = y0 + 1 < mh ? y0 + 1 : y0;
    const tx = fx - x0;
    const ty = fy - y0;
    const i00 = (y0 * mw + x0) * 4;
    const i10 = (y0 * mw + x1) * 4;
    const i01 = (y1 * mw + x0) * 4;
    const i11 = (y1 * mw + x1) * 4;
    const w00 = (1 - tx) * (1 - ty);
    const w10 = tx * (1 - ty);
    const w01 = (1 - tx) * ty;
    const w11 = tx * ty;
    for (let c = 0; c < 3; c++) {
      acc[c] += src[i00 + c] * w00 + src[i10 + c] * w10 + src[i01 + c] * w01 + src[i11 + c] * w11;
    }
  };

  const tapOffsets = [];
  for (let k = 0; k < taps; k++) tapOffsets.push(((k + 0.5) / taps - 0.5));
  const norm = 1 / (taps * taps);

  for (let j = 0; j + 1 < nodesY.length; j++) {
    const y0 = nodesY[j];
    const y1 = nodesY[j + 1];
    const yEnd = j + 2 === nodesY.length ? y1 : y1 - 1;
    for (let i = 0; i + 1 < nodesX.length; i++) {
      const x0 = nodesX[i];
      const x1 = nodesX[i + 1];
      const xEnd = i + 2 === nodesX.length ? x1 : x1 - 1;
      const n00 = j * nodesX.length + i;
      const n10 = n00 + 1;
      const n01 = n00 + nodesX.length;
      const n11 = n01 + 1;
      for (let y = y0; y <= yEnd; y++) {
        const v = y1 > y0 ? (y - y0) / (y1 - y0) : 0;
        for (let x = x0; x <= xEnd; x++) {
          const u = x1 > x0 ? (x - x0) / (x1 - x0) : 0;
          const w00 = (1 - u) * (1 - v);
          const w10 = u * (1 - v);
          const w01 = (1 - u) * v;
          const w11 = u * v;
          const mx = lx[n00] * w00 + lx[n10] * w10 + lx[n01] * w01 + lx[n11] * w11;
          const my = ly[n00] * w00 + ly[n10] * w10 + ly[n01] * w01 + ly[n11] * w11;
          acc[0] = 0; acc[1] = 0; acc[2] = 0;
          if (taps === 1) {
            bilinearAdd(mx, my);
          } else {
            for (const oy of tapOffsets) {
              for (const ox of tapOffsets) bilinearAdd(mx + ox * footX, my + oy * footY);
            }
          }
          const o = (y * outW + x) * 4;
          rgba[o] = acc[0] * norm;
          rgba[o + 1] = acc[1] * norm;
          rgba[o + 2] = acc[2] * norm;
          rgba[o + 3] = 255;
        }
      }
    }
  }
  // A 1-pixel-wide/high output has a single lattice node per axis.
  if (nodesX.length === 1 || nodesY.length === 1) {
    for (let y = 0; y < outH; y++) {
      for (let x = 0; x < outW; x++) {
        const [mx, my] = at(x, y);
        acc[0] = 0; acc[1] = 0; acc[2] = 0;
        bilinearAdd(mx, my);
        const o = (y * outW + x) * 4;
        rgba[o] = acc[0]; rgba[o + 1] = acc[1]; rgba[o + 2] = acc[2]; rgba[o + 3] = 255;
      }
    }
  }
  return rgba;
}
