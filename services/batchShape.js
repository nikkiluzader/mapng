// A shaped level (tiles in step 1, ground as models): the tiles where the user put them, as one
// level whose area is exactly their footprint. The export still works on one square grid (its many map-wide steps
// assume it), the smallest power-of-two square holding every tile; the ground models, the map data, the trees and the
// spawn keep to the footprint (exportBeamNGLevel.js groundShape).
//
// Rules:
// - every tile sits on the shared grid of processing pixels: offsets are snapped to whole pixels when the job is made
//   (snapTileOffsets), so each tile's terrain and its map data land exactly where they belong;
// - where tiles overlap, each pixel comes from one tile only, the one whose centre is nearest (the pixel lies deepest
//   inside it, away from that tile's edge effects; a tie goes to the lower index);
// - the footprint is the union of the tile squares, nothing more.
//
// Pixel space: x east, y south (rows from the north), the square N pixels a side.

/**
 * The bounds { north, south, east, west } of a grid of `gridCols` x `gridRows` squares centred on `center`, each
 * `tileSpanMeters` a side (the output size in metres; `resolution` when not given). One by one: the selected square.
 */
export function computeGridBounds(center, resolution, gridCols, gridRows, tileSpanMeters = resolution) {
  const metersPerDegLat = 111320;
  const metersPerDegLng = 111320 * Math.cos(center.lat * Math.PI / 180);
  const spanMeters = Number.isFinite(Number(tileSpanMeters)) && Number(tileSpanMeters) > 0
    ? Number(tileSpanMeters)
    : Number(resolution);

  const totalWidth = gridCols * spanMeters;
  const totalHeight = gridRows * spanMeters;

  return {
    north: center.lat + totalHeight / 2 / metersPerDegLat,
    south: center.lat - totalHeight / 2 / metersPerDegLat,
    east: center.lng + totalWidth / 2 / metersPerDegLng,
    west: center.lng - totalWidth / 2 / metersPerDegLng,
  };
}

/** The tile offsets (metres) snapped to whole pixels of `mpp` metres. */
export function snapTileOffsets(offsets, mpp) {
  const m = Number(mpp) > 0 ? Number(mpp) : 1;
  return (offsets || []).map((o) => ({ ...o, offsetX: Math.round(Number(o.offsetX || 0) / m) * m, offsetY: Math.round(Number(o.offsetY || 0) / m) * m }));
}

/**
 * The layout: { size: N, tilePx: R, mpp, tiles: [{ key, index, x, y, cx, cy }], rects: [[x, y, R, R]...],
 * centerOffsetM: { x, y } (the square's centre from the job's centre, metres, north +), extent: { w, h } }.
 * tiles: the job's tiles ({ row, col, index, offsetX?, offsetY? } in metres from their grid spot); cols, rows: the grid.
 */
export function shapedLayout(tiles, { cols, rows, tilePx, mpp }) {
  const R = Math.max(1, Math.round(tilePx)); const m = Number(mpp) > 0 ? Number(mpp) : 1;
  const placed = tiles.map((t) => {
    // the tile's centre from the job's centre, in pixels (east, south)
    const ex = (t.col - (cols - 1) / 2) * R + Math.round(Number(t.offsetX || 0) / m);
    const sy = (t.row - (rows - 1) / 2) * R - Math.round(Number(t.offsetY || 0) / m);
    return { key: `${t.row}:${t.col}`, index: t.index, ex, sy };
  });
  // the footprint's box (tile corners at centre ∓ R/2; R is even in practice, a power of two)
  let x0 = Infinity; let y0 = Infinity; let x1 = -Infinity; let y1 = -Infinity;
  for (const p of placed) { x0 = Math.min(x0, p.ex - R / 2); y0 = Math.min(y0, p.sy - R / 2); x1 = Math.max(x1, p.ex + R / 2); y1 = Math.max(y1, p.sy + R / 2); }
  const w = x1 - x0; const h = y1 - y0;
  let N = 1; while (N < Math.max(w, h)) N *= 2;
  // the footprint centred in the square (whole pixels)
  const ox = x0 - Math.floor((N - w) / 2); const oy = y0 - Math.floor((N - h) / 2);
  const out = placed.map((p) => ({ key: p.key, index: p.index, x: p.ex - R / 2 - ox, y: p.sy - R / 2 - oy, cx: p.ex - ox, cy: p.sy - oy }));
  return {
    size: N, tilePx: R, mpp: m, tiles: out,
    rects: out.map((t) => [t.x, t.y, R, R]),
    // the square's centre (pixel N/2) from the job's centre
    centerOffsetM: { x: (ox + N / 2) * m, y: -(oy + N / 2) * m },
    extent: { w, h },
  };
}

/**
 * Which tile each of a tile's pixels comes from: a function (x, y) -> true when tile `t` owns pixel (x, y) of the
 * square (it covers it and no covering tile has a nearer centre). Only the tiles overlapping `t` are looked at.
 */
export function pixelOwner(layout, t) {
  const R = layout.tilePx;
  const others = layout.tiles.filter((o) => o !== t && o.x < t.x + R && o.x + R > t.x && o.y < t.y + R && o.y + R > t.y);
  if (!others.length) return () => true;
  return (x, y) => {
    const px = x + 0.5; const py = y + 0.5;
    const d = (px - t.cx) ** 2 + (py - t.cy) ** 2;
    for (const o of others) {
      if (x < o.x || x >= o.x + R || y < o.y || y >= o.y + R) continue;
      const e = (px - o.cx) ** 2 + (py - o.cy) ** 2;
      if (e < d || (e === d && o.index < t.index)) return false;
    }
    return true;
  };
}

/**
 * The footprint as row intervals: for row y, sorted merged [x0, x1) pixel runs covered by a tile. A fast test for
 * every pixel without a full-grid mask (a 16k square's mask would be 256 MB).
 */
export function footprintRows(rects, N, W = N) {
  // (N rows of W pixels: a square by default)
  const rows = new Array(N);
  for (let y = 0; y < N; y++) rows[y] = null;
  const byRow = new Map();
  for (const [x, y, w, h] of rects) {
    for (let r = Math.max(0, y); r < Math.min(N, y + h); r++) { let l = byRow.get(r); if (!l) byRow.set(r, (l = [])); l.push([Math.max(0, x), Math.min(W, x + w)]); }
  }
  for (const [r, l] of byRow) {
    l.sort((a, b) => a[0] - b[0]);
    const merged = [];
    for (const [a, b] of l) { const last = merged[merged.length - 1]; if (last && a <= last[1]) last[1] = Math.max(last[1], b); else merged.push([a, b]); }
    rows[r] = merged;
  }
  return rows;
}

/** Pixel (x, y) inside the footprint (rows from footprintRows). */
export function inFootprint(rows, x, y) {
  const l = rows[y];
  if (!l) return false;
  for (let k = 0; k < l.length; k++) { if (x < l[k][0]) return false; if (x < l[k][1]) return true; }
  return false;
}

/**
 * The ground models' test for a terrain square (exportBeamNGLevel.js groundShape): square (i, j) in terrain space
 * (j from the south) is kept when all four of its corner points are in the footprint (a square between two touching
 * tiles is kept; one past the footprint's edge is not). shape: { size: N, rects }.
 */
export function keepSquareFor(shape) {
  const N = shape.size; const rows = shapeRows(shape, N);
  return (i, j) => {
    const y1 = N - 1 - j; const y0 = y1 - 1;   // the square's two rows (north y0, south y1)
    if (y0 < 0) return false;
    return inFootprint(rows, i, y0) && inFootprint(rows, i + 1, y0) && inFootprint(rows, i, y1) && inFootprint(rows, i + 1, y1);
  };
}

/**
 * Fill the pixels outside the footprint (Float32Array N·N, rows from the north) by stretching the footprint's edge
 * outward: along each row from its nearest covered pixel, then rows with none from the nearest row that has some. They
 * are never drawn (no ground there); the export's smoothing and grading near the edge then see the edge's own heights,
 * not a cliff to nothing.
 */
export function fillOutsideFootprint(heights, rows, N, W = N) {
  // (N rows of W pixels: a square by default)
  let firstRow = -1;
  for (let y = 0; y < N; y++) {
    const l = rows[y];
    if (!l || !l.length) continue;
    if (firstRow < 0) firstRow = y;
    const o = y * W;
    // before the first run, between runs (each half from its nearer side), after the last
    let prevEnd = 0; let prevVal = heights[o + l[0][0]];
    for (let k = 0; k < l.length; k++) {
      const [a, b] = l[k];
      const left = heights[o + a];
      if (k === 0) { for (let x = 0; x < a; x++) heights[o + x] = left; } else {
        const mid = (prevEnd + a) >> 1;
        for (let x = prevEnd; x < a; x++) heights[o + x] = x < mid ? prevVal : left;
      }
      prevEnd = b; prevVal = heights[o + b - 1];
    }
    for (let x = prevEnd; x < W; x++) heights[o + x] = prevVal;
  }
  if (firstRow < 0) return;
  // rows with no run: copied from the nearest row that has one
  let lastFull = -1;
  for (let y = 0; y < N; y++) {
    if (rows[y] && rows[y].length) { lastFull = y; continue; }
    let next = y + 1; while (next < N && !(rows[next] && rows[next].length)) next++;
    const src = lastFull < 0 ? next : next >= N ? lastFull : (y - lastFull <= next - y ? lastFull : next);
    heights.copyWithin(y * W, src * W, src * W + W);
  }
}

// ── Footprints of any shape ───────────────────────────────────────────────────────────────────────────────────────────
// A footprint is tile rects [[x, y, w, h]...] (a plain array, or { rects }), or row runs { runs: [[y, x0, x1]...] } (a
// road corridor, services/roadCorridor.js: [x0, x1) pixels of row y). Everything that reads a footprint goes through
// these, so both forms work everywhere.

/** The footprint as { rects } or { runs }, or null for none. */
export const shapeOf = (fp) => (Array.isArray(fp) ? { rects: fp } : fp && (Array.isArray(fp.rects) || Array.isArray(fp.runs)) ? fp : null);

/** Whether there is a footprint at all. */
export const hasShape = (fp) => { const s = shapeOf(fp); return !!s && ((s.rects?.length || 0) + (s.runs?.length || 0)) > 0; };

/** The footprint's row intervals (as footprintRows) for either form: N rows of W pixels. */
export function shapeRows(fp, N, W = N) {
  const s = shapeOf(fp);
  if (!s) { const r = new Array(N); for (let y = 0; y < N; y++) r[y] = null; return r; }
  if (!s.runs) return footprintRows(s.rects || [], N, W);
  const rows = new Array(N); for (let y = 0; y < N; y++) rows[y] = null;
  for (const [y, a, b] of s.runs) {
    if (y < 0 || y >= N) continue;
    const x0 = Math.max(0, a); const x1 = Math.min(W, b); if (x1 <= x0) continue;
    (rows[y] || (rows[y] = [])).push([x0, x1]);
  }
  for (let y = 0; y < N; y++) {
    const l = rows[y]; if (!l || l.length < 2) continue;
    l.sort((p, q) => p[0] - q[0]);
    const m = []; for (const [a, b] of l) { const last = m[m.length - 1]; if (last && a <= last[1]) last[1] = Math.max(last[1], b); else m.push([a, b]); }
    rows[y] = m;
  }
  return rows;
}

/** Boxes [[x, y, w, h]...] covering the footprint: its rects, or its runs gathered into bands of `band` rows. */
export function shapeBoxes(fp, band = 32) {
  const s = shapeOf(fp); if (!s) return [];
  if (!s.runs) return s.rects || [];
  const bands = new Map();
  for (const [y, a, b] of s.runs) {
    const k = Math.floor(y / band); const bx = bands.get(k);
    if (!bx) bands.set(k, { x0: a, x1: b, y0: y, y1: y + 1 });
    else { bx.x0 = Math.min(bx.x0, a); bx.x1 = Math.max(bx.x1, b); bx.y0 = Math.min(bx.y0, y); bx.y1 = Math.max(bx.y1, y + 1); }
  }
  return [...bands.values()].map((b) => [b.x0, b.y0, b.x1 - b.x0, b.y1 - b.y0]);
}

/** The footprint moved by (ox, oy) pixels, in its own form. */
export function shiftShape(fp, ox, oy) {
  const s = shapeOf(fp); if (!s) return null;
  if (s.runs) return { runs: s.runs.map(([y, a, b]) => [y + oy, a + ox, b + ox]) };
  return { rects: (s.rects || []).map(([x, y, w, h]) => [x + ox, y + oy, w, h]) };
}

/** The footprint's pixel count (overlaps once). */
export function shapeArea(fp, N, W = N) {
  let px = 0; for (const r of shapeRows(fp, N, W)) if (r) for (const [a, b] of r) px += b - a;
  return px;
}

// ── The footprint for the previews ─────────────────────────────────────────────
/**
 * A map's footprint and the grid it is given on: { fp, W, H }, or null for a map that is all ground (one square, a
 * full rectangle). A chunked level's overview is smaller than its grid: its footprint is on the level's own grid
 * (terrainData.chunked), which the fractions below take care of.
 */
export function previewShape(td) {
  if (hasShape(td?.footprint)) return { fp: td.footprint, W: td.width, H: td.height };
  if (hasShape(td?.chunked?.footprint)) return { fp: td.chunked.footprint, W: td.chunked.W, H: td.chunked.H };
  return null;
}

/**
 * A test for the previews: inside(u, v) for a place given as fractions of the map (u from the west, v from the
 * north, 0..1), or null when the map has no footprint. One row lookup and a short scan of that row's runs.
 */
export function footprintTest(td) {
  const s = previewShape(td); if (!s) return null;
  const rows = shapeRows(s.fp, s.H, s.W);
  return (u, v) => {
    const y = Math.min(s.H - 1, Math.max(0, Math.floor(v * s.H))); const x = u * s.W;
    const l = rows[y]; if (!l) return false;
    for (const [a, b] of l) if (x >= a && x < b) return true;
    return false;
  };
}

/**
 * The picture that dims what is outside the footprint: RGBA pixels mw x mh (Uint8ClampedArray), clear inside, `rgba`
 * outside; null when the map has no footprint. Each pixel is judged at its middle.
 */
export function footprintMaskPixels(td, mw, mh, rgba = [17, 24, 39, 150]) {
  const inside = footprintTest(td); if (!inside) return null;
  const px = new Uint8ClampedArray(mw * mh * 4);
  for (let j = 0; j < mh; j++) {
    const v = (j + 0.5) / mh;
    for (let i = 0; i < mw; i++) {
      if (inside((i + 0.5) / mw, v)) continue;
      const k = (j * mw + i) * 4; px[k] = rgba[0]; px[k + 1] = rgba[1]; px[k + 2] = rgba[2]; px[k + 3] = rgba[3];
    }
  }
  return px;
}
