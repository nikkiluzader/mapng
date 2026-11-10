// The 2D preview's terrain views, drawn from the heightmap (the 3D preview
// does the same in its terrain shader, components/three/terrainView.js: the
// same bands and ramp):
//   relief:    plain clay under a north-west sun: the shape alone;
//   slope:     coloured by steepness, flat green to cliff purple;
//   elevation: coloured by height, valley green to summit white;
// and contour lines every `interval` metres, each fifth bold.
// Pure functions over typed arrays (rows north to south, as the heightmap).
import { SLOPE_BANDS, ELEVATION_RAMP } from '../components/three/terrainView.js';

const rgb = (hex) => { const n = parseInt(hex.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
const CLAY = rgb('#b3a999');
const INK = rgb('#2b2118');
const PAPER = rgb('#fff4d6');
const SLOPES = SLOPE_BANDS.map((b) => ({ deg: b.deg, c: rgb(b.color) }));
const RAMP = ELEVATION_RAMP.map(rgb);
const smooth = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

/** The colour of a slope in degrees (the bands blended over ±1.5°, as the 3D view). */
export function slopeColour(deg) {
  let c = SLOPES[0].c;
  for (let i = 1; i < SLOPES.length; i++) {
    const t = smooth(SLOPES[i].deg - 1.5, SLOPES[i].deg + 1.5, deg);
    if (t > 0) c = [c[0] + (SLOPES[i].c[0] - c[0]) * t, c[1] + (SLOPES[i].c[1] - c[1]) * t, c[2] + (SLOPES[i].c[2] - c[2]) * t];
  }
  return c;
}

/** The colour of a height, t in 0..1 from the lowest to the highest ground. */
export function elevationColour(t) {
  const x = Math.max(0, Math.min(1, t)) * (RAMP.length - 1);
  const i = Math.min(RAMP.length - 2, Math.floor(x)); const f = x - i;
  return [RAMP[i][0] + (RAMP[i + 1][0] - RAMP[i][0]) * f, RAMP[i][1] + (RAMP[i + 1][1] - RAMP[i][1]) * f, RAMP[i][2] + (RAMP[i + 1][2] - RAMP[i][2]) * f];
}

/**
 * The heightmap sampled down to at most `max` a side: { h: Float32Array, w, hgt, cell }
 * (cell: metres a sample; the mean of each block, so a small view of a large
 * terrain shows its shape, not one row in every few).
 */
export function sampleHeights(heightMap, width, height, metersPerPixel = 1, max = 2048) {
  const step = Math.max(1, Math.ceil(Math.max(width, height) / max));
  const w = Math.floor(width / step); const hgt = Math.floor(height / step);
  if (step === 1) return { h: heightMap, w: width, hgt: height, cell: metersPerPixel };
  const h = new Float32Array(w * hgt);
  for (let r = 0; r < hgt; r++) {
    for (let c = 0; c < w; c++) {
      let sum = 0;
      for (let dr = 0; dr < step; dr++) { const row = (r * step + dr) * width + c * step; for (let dc = 0; dc < step; dc++) sum += heightMap[row + dc]; }
      h[r * w + c] = sum / (step * step);
    }
  }
  return { h, w, hgt, cell: metersPerPixel * step };
}

/**
 * A view as RGBA pixels (Uint8ClampedArray, w × hgt). view: 'relief' | 'slope'
 * | 'elevation'. The sun stands in the north-west, 45° up (the map-maker's
 * convention: hills read as hills, not as pits).
 */
export function shadeTerrain({ h, w, hgt, cell }, view, { minHeight = 0, maxHeight = 1 } = {}) {
  const out = new Uint8ClampedArray(w * hgt * 4);
  const span = Math.max(1, maxHeight - minHeight);
  const lx = -0.5; const ly = 0.5; const lz = Math.SQRT1_2;   // (toward the sun: west, north, up)
  for (let r = 0; r < hgt; r++) {
    const rn = r > 0 ? r - 1 : r; const rs = r < hgt - 1 ? r + 1 : r;
    for (let c = 0; c < w; c++) {
      const cw = c > 0 ? c - 1 : c; const ce = c < w - 1 ? c + 1 : c;
      // (the ground's rise eastward and northward, metres a metre)
      const dzdx = (h[r * w + ce] - h[r * w + cw]) / ((ce - cw || 1) * cell);
      const dzdy = (h[rn * w + c] - h[rs * w + c]) / ((rs - rn || 1) * cell);
      const inv = 1 / Math.sqrt(dzdx * dzdx + dzdy * dzdy + 1);
      const shade = Math.max(0, (-dzdx * lx - dzdy * ly + lz) * inv);   // (0..1, 0.707 on the flat)
      let col; let k;
      if (view === 'slope') {
        col = slopeColour((Math.atan(Math.sqrt(dzdx * dzdx + dzdy * dzdy)) * 180) / Math.PI);
        k = 0.72 + 0.4 * shade;      // (a light shade: the colour is the message)
      } else if (view === 'elevation') {
        col = elevationColour((h[r * w + c] - minHeight) / span);
        k = 0.55 + 0.64 * shade;
      } else {
        col = CLAY; k = 0.3 + 1.0 * shade;
      }
      const o = (r * w + c) * 4;
      out[o] = col[0] * k; out[o + 1] = col[1] * k; out[o + 2] = col[2] * k; out[o + 3] = 255;
    }
  }
  return out;
}

/**
 * Contour lines as RGBA pixels on a clear ground: a pixel is on a line where
 * the ground crosses a multiple of `interval` to its east or south neighbour;
 * every fifth line darker and two pixels wide.
 */
export function contourPixels({ h, w, hgt }, interval, { light = false } = {}) {
  // (light: pale lines, for over a dark photo; dark ink over the shape views)
  const ink = light ? PAPER : INK;
  const out = new Uint8ClampedArray(w * hgt * 4);
  const iv = Math.max(1e-6, interval);
  const mark = (r, c, major) => {
    const o = (r * w + c) * 4; const a = major ? (light ? 235 : 220) : (light ? 150 : 130);
    if (out[o + 3] >= a) return;
    out[o] = ink[0]; out[o + 1] = ink[1]; out[o + 2] = ink[2]; out[o + 3] = a;
  };
  for (let r = 0; r < hgt; r++) {
    for (let c = 0; c < w; c++) {
      const a = Math.floor(h[r * w + c] / iv);
      for (const [nr, nc] of [[r, c + 1], [r + 1, c]]) {
        if (nr >= hgt || nc >= w) continue;
        const b = Math.floor(h[nr * w + nc] / iv);
        if (a === b) continue;
        const level = Math.max(a, b);            // (the line crossed, the lower of several on a cliff)
        const major = level % 5 === 0;
        mark(r, c, major);
        if (major) mark(nr, nc, true);
      }
    }
  }
  return out;
}
