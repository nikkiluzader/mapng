// One strip of the game texture's satellite detail: the painted colours taken towards the image's fine light
// and shade, and its colour at about 30 m (services/osmTexture.js addSatelliteDetail, which draws the strips
// and puts them back). Plain arithmetic on three pixel buffers, so several strips are worked at once on
// worker threads in the desktop app (services/parallel.js); in a browser it runs in the page as before.
const SHADE_DARK = [40, 85];   // the image's brightness (0-255, at ~30 m): no trust under the first, full over the second
const SHADE_CAST = 0.2;
const BARE_TINT = { tint: [0.3, 0.3, 0.7, 0.7, 0.6, 0, 0, 0.5, 0.7], light: [0, 0, 0.4, 0.4, 0.3, 0, 0, 0.3, 0.45] };
const lumOf = (d, i) => 0.3 * d[i] + 0.59 * d[i + 1] + 0.11 * d[i + 2];

/** item { d, fine, broad (RGBA of the strip: painted, image, image at ~30 m), W, rows, y0, H, detail, tint, strength }; shared { classes } -> d. */
export function blendStrip(item, shared) {
  const { d, fine, broad, W, rows, y0, H, detail, tint, strength } = item;
  const classes = shared?.classes || null;
    for (let i = 0; i < W * rows * 4; i += 4) {
      const lb = lumOf(broad, i);
      const ratio = Math.min(1.35, Math.max(0.7, (lumOf(fine, i) + 8) / (lb + 8)));
      const f = 1 + detail * (ratio - 1);
      // (the image's colour at ~30 m, at the painted brightness)
      // (not over neutral greys: roads and buildings keep their grey, which the grass mask needs)
      let pl = lumOf(d, i);
      let tk = tint;
      if (classes) {
        const px = (i >> 2) % W; const py = y0 + (((i >> 2) / W) | 0);
        const k = classes.cls[Math.min(classes.h - 1, (py * classes.h / H) | 0) * classes.w + Math.min(classes.w - 1, (px * classes.w / W) | 0)];
        // (in shadow the image has the sky's colour, not the ground's: dark and
        // blue there, its tint scaled up to the painted brightness turned shaded
        // rock and scree teal. The darker and the bluer the image, the less of
        // its colour and brightness is taken: none under SHADE_DARK[0] or with
        // blue over red by SHADE_CAST of its brightness)
        const dark = Math.min(1, Math.max(0, (lb - SHADE_DARK[0]) / (SHADE_DARK[1] - SHADE_DARK[0])));
        const cast = Math.min(1, Math.max(0, 1 - (broad[i + 2] - broad[i]) / (SHADE_CAST * (lb + 8))));
        const trust = dark * cast;
        tk = (BARE_TINT.tint[k] != null ? Math.min(0.95, BARE_TINT.tint[k] * strength) : tint) * trust;
        // (bare ground: part of its brightness from the image too)
        const lt = Math.min(0.9, (BARE_TINT.light[k] || 0) * strength) * trust;
        if (lt > 0 && pl > 1) { const m = (pl + (lb - pl) * lt) / pl; d[i] *= m; d[i + 1] *= m; d[i + 2] *= m; pl = lumOf(d, i); }
      }
      const sc = lb > 4 ? pl / lb : 0;
      const t = Math.abs(d[i] - d[i + 1]) < 6 && Math.abs(d[i + 1] - d[i + 2]) < 6 ? 0 : tk;
      for (let c = 0; c < 3; c++) {
        const v = d[i + c] * (1 - t) + broad[i + c] * sc * t;
        d[i + c] = Math.max(0, Math.min(255, v * f));
      }
    }
    return d;
}
