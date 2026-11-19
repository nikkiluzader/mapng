// ASPRS LAS classification codes MapNG names (locale keys under upload.layerClass) and the colours the 2D preview's
// Classes view paints them in. Codes not listed show as "class N" in grey.
export const POINT_CLASS_KEYS = {
  0: 'never', 1: 'unclassified', 2: 'ground', 3: 'lowVeg', 4: 'mediumVeg', 5: 'highVeg', 6: 'building', 7: 'noise',
  9: 'water', 10: 'rail', 11: 'road', 12: 'overlap', 13: 'wireGuard', 14: 'wire', 15: 'tower', 17: 'bridge', 18: 'highNoise',
};
export const POINT_CLASS_COLOURS = {
  0: '#b8b8b8', 1: '#b8b8b8', 2: '#c9b48a', 3: '#b7e07a', 4: '#6cc24a', 5: '#1f7a3a', 6: '#d9534f',
  9: '#3b8fd9', 10: '#7a4a1f', 11: '#5b5b66', 13: '#f2c14e', 14: '#f2c14e', 15: '#e07b39', 17: '#e8a0c0',
};
export const POINT_CLASS_OTHER = '#9a9a9a';
// (left out of the aerial Classes view: noise and flight-strip overlap carry no surface of their own)
export const POINT_CLASS_HIDDEN = new Set([7, 12, 18]);

/** RGBA pixels for a preview grid of class codes (255 = empty: transparent). */
export function classPixels(classes, w, h) {
  const lut = new Uint8Array(256 * 4);
  for (let c = 0; c < 255; c++) {
    const hex = POINT_CLASS_COLOURS[c] || POINT_CLASS_OTHER;
    lut[c * 4] = parseInt(hex.slice(1, 3), 16); lut[c * 4 + 1] = parseInt(hex.slice(3, 5), 16); lut[c * 4 + 2] = parseInt(hex.slice(5, 7), 16); lut[c * 4 + 3] = 255;
  }
  const out = new Uint8ClampedArray(w * h * 4);
  for (let i = 0, o = 0; i < w * h; i++, o += 4) {
    const c = classes[i] * 4; out[o] = lut[c]; out[o + 1] = lut[c + 1]; out[o + 2] = lut[c + 2]; out[o + 3] = lut[c + 3];
  }
  return out;
}

/** RGBA pixels for a preview grid of brightness (1-255, 0 = empty: transparent): bright returns white on black. */
export function intensityPixels(intensity, w, h) {
  const out = new Uint8ClampedArray(w * h * 4);
  for (let i = 0, o = 0; i < w * h; i++, o += 4) {
    const v = intensity[i]; if (!v) continue;
    out[o] = v; out[o + 1] = v; out[o + 2] = v; out[o + 3] = 255;
  }
  return out;
}
