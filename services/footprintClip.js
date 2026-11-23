// A shaped level's map data, kept to its footprint (services/batchShape.js; exportBeamNGLevel.js groundShape). Outside
// the footprint there is no ground, so nothing may be built there:
// - lines (roads, railways, paths, fences, power lines) are cut at the edge of the ground, exactly: every segment is
//   walked square by square, so a line crossing the footprint between two of its points keeps its crossing, and one
//   passing over a gap is cut at the gap. Each stretch becomes its own feature (`id` + `~k`), with a point added where
//   it crosses the edge; a ring split only at its first point is joined back;
// - buildings are kept when they stand wholly over ground (every side of the outline);
// - areas (water, forests, land use, parks) are kept when their bounding box touches the footprint (the trees and the
//   ground they paint are kept inside it later);
// - point features are kept when inside.
// Pixel space as batchShape.js: the export grid's N x N pixels over `bounds`, x east, y south.
import { shapeRows, shapeBoxes, inFootprint } from './batchShape.js';

const LINE_TYPES = new Set(['road', 'railway', 'barrier', 'power_line', 'waterway', 'path', 'cliff', 'wall', 'pier']);

/**
 * The clipper for one footprint: { inside(lat, lng), clip(features) -> { features, stats } }. shape: { size, rects } on
 * a square grid, or { width, height, rects } on a rectangle (Generate's grid).
 */
export function footprintClipper(bounds, shape) {
  const W = shape.width ?? shape.size; const H = shape.height ?? shape.size;
  const rows = shapeRows(shape, H, W);
  const sx = W / (bounds.east - bounds.west); const sy = H / (bounds.north - bounds.south);
  // Where there is ground. The footprint's pixels are the map's height samples (services/mapFrame.js: sample (x, y) is
  // the vertex x squares from the west edge and y + 1 from the north), and a ground square is built when all four of
  // its corner samples are in the footprint (batchShape.js keepSquareFor). The square holding a position (gx, gy) has
  // the corner samples (cx, cy - 1), (cx + 1, cy - 1), (cx, cy), (cx + 1, cy), cx = floor(gx), cy = floor(gy).
  const ground = (cx, cy) => cx >= 0 && cy >= 1 && cx + 1 < W && cy < H
    && inFootprint(rows, cx, cy - 1) && inFootprint(rows, cx + 1, cy - 1) && inFootprint(rows, cx, cy) && inFootprint(rows, cx + 1, cy);
  const inside = (lat, lng) => ground(Math.floor((lng - bounds.west) * sx), Math.floor((bounds.north - lat) * sy));
  // the footprint's own box per rect (lat/lng), for the areas' overlap test
  const rectBoxes = shapeBoxes(shape).map(([x, y, w, h]) => ({
    west: bounds.west + x / sx, east: bounds.west + (x + w) / sx, north: bounds.north - y / sy, south: bounds.north - (y + h) / sy,
  }));
  const boxTouches = (pts) => {
    let w = Infinity; let e = -Infinity; let s = Infinity; let n = -Infinity;
    for (const p of pts) { if (p.lng < w) w = p.lng; if (p.lng > e) e = p.lng; if (p.lat < s) s = p.lat; if (p.lat > n) n = p.lat; }
    return rectBoxes.some((r) => w <= r.east && e >= r.west && s <= r.north && n >= r.south);
  };
  // A segment's stretches over ground, exactly: it is walked square by square (each square entered through an edge
  // it crosses), so a segment with both ends on ground and a gap between them is cut at the gap, and one with neither
  // end on ground that crosses the footprint keeps its crossing. Returns [t0, t1, ...] pairs along the segment (0 at
  // a, 1 at b), or null when all of it is over ground (the common case: no allocation).
  const EPS = 1e-9;
  const segmentOnGround = (ax, ay, bx, by) => {
    const dx = bx - ax; const dy = by - ay;
    let cx = Math.floor(ax); let cy = Math.floor(ay);
    const ex = Math.floor(bx); const ey = Math.floor(by);
    if (cx === ex && cy === ey) return ground(cx, cy) ? null : [];
    const stepX = dx > 0 ? 1 : -1; const stepY = dy > 0 ? 1 : -1;
    const tDeltaX = dx !== 0 ? Math.abs(1 / dx) : Infinity; const tDeltaY = dy !== 0 ? Math.abs(1 / dy) : Infinity;
    let tMaxX = dx !== 0 ? ((dx > 0 ? cx + 1 - ax : ax - cx) * tDeltaX) : Infinity;
    let tMaxY = dy !== 0 ? ((dy > 0 ? cy + 1 - ay : ay - cy) * tDeltaY) : Infinity;
    let out = null; let on = ground(cx, cy); let from = 0; let allOn = on; let t = 0;
    // (at most one step per square the segment passes through)
    for (let guard = Math.abs(ex - cx) + Math.abs(ey - cy) + 2; guard > 0 && (cx !== ex || cy !== ey); guard--) {
      if (tMaxX < tMaxY) { t = tMaxX; tMaxX += tDeltaX; cx += stepX; } else { t = tMaxY; tMaxY += tDeltaY; cy += stepY; }
      if (t >= 1) break;
      const now = ground(cx, cy);
      if (now !== on) {
        if (!out) out = [];
        if (on) out.push(from, t); else from = t;
        on = now; allOn = false;
      }
    }
    if (allOn) return null;
    if (!out) out = [];
    if (on) out.push(from, 1);
    // (stretches that only touch a corner of the footprint are not kept)
    const kept = []; for (let k = 0; k < out.length; k += 2) if (out[k + 1] - out[k] > EPS) kept.push(out[k], out[k + 1]);
    return kept;
  };
  const between = (a, b, t) => (t <= 0 ? a : t >= 1 ? b : { ...a, lat: a.lat + (b.lat - a.lat) * t, lng: a.lng + (b.lng - a.lng) * t });
  const clip = (features) => {
    const out = []; const stats = { kept: 0, cut: 0, pieces: 0, dropped: 0 };
    for (const f of features || []) {
      const g = f?.geometry;
      if (!Array.isArray(g) || !g.length || !Number.isFinite(g[0]?.lat)) {
        // (a point feature, or one without a geometry list)
        const p = Number.isFinite(f?.lat) ? f : (f?.center || null);
        if (!p || inside(p.lat, p.lng)) { out.push(f); stats.kept++; } else stats.dropped++;
        continue;
      }
      if (f.type === 'building') {
        // (wholly over ground: every side of its outline. By its centre, as it was, a building stood half over the
        // level's edge, with nothing under it.)
        let whole = true;
        for (let i = 0; i < g.length && whole; i++) {
          const a = g[i]; const b = g[(i + 1) % g.length];
          const on = segmentOnGround((a.lng - bounds.west) * sx, (bounds.north - a.lat) * sy, (b.lng - bounds.west) * sx, (bounds.north - b.lat) * sy);
          if (on !== null) whole = false;
        }
        if (whole) { out.push(f); stats.kept++; } else { stats.dropped++; stats.buildingsOverEdge = (stats.buildingsOverEdge || 0) + 1; }
        continue;
      }
      const closed = g.length > 3 && g[0].lat === g[g.length - 1].lat && g[0].lng === g[g.length - 1].lng;
      // (roads and the other line types always as lines, a roundabout's closed ring too; an unclosed water line is a
      // river's)
      const asLine = LINE_TYPES.has(f.type) || (f.type === 'water' && !closed);
      if (!asLine) {
        if (boxTouches(g)) { out.push(f); stats.kept++; } else stats.dropped++;
        continue;
      }
      // a line: its stretches over ground, segment by segment
      const px = new Float64Array(g.length); const py = new Float64Array(g.length);
      for (let i = 0; i < g.length; i++) { px[i] = (g[i].lng - bounds.west) * sx; py[i] = (bounds.north - g[i].lat) * sy; }
      const pieces = []; let cur = null; let whole = true;
      for (let i = 1; i < g.length; i++) {
        const iv = segmentOnGround(px[i - 1], py[i - 1], px[i], py[i]);
        if (iv === null) {   // all of it
          if (!cur) cur = [g[i - 1]];
          cur.push(g[i]);
          continue;
        }
        whole = false;
        for (let k = 0; k < iv.length; k += 2) {
          const startsHere = iv[k] <= 0; const endsHere = iv[k + 1] >= 1;
          if (!(startsHere && cur)) { if (cur) { if (cur.length >= 2) pieces.push(cur); } cur = [between(g[i - 1], g[i], iv[k])]; }
          cur.push(between(g[i - 1], g[i], iv[k + 1]));
          if (!endsHere) { if (cur.length >= 2) pieces.push(cur); cur = null; }
        }
        if (!iv.length || iv[iv.length - 1] < 1) { if (cur) { if (cur.length >= 2) pieces.push(cur); cur = null; } }
      }
      if (cur && cur.length >= 2) pieces.push(cur);
      if (whole && pieces.length === 1) { out.push(f); stats.kept++; continue; }
      if (!pieces.length) { stats.dropped++; continue; }
      // (a ring, a roundabout say, cut where it was only split at its first point: its last and first stretch are one)
      if (closed && pieces.length > 1 && pieces[0][0] === g[0] && pieces[pieces.length - 1][pieces[pieces.length - 1].length - 1] === g[g.length - 1]) {
        const last = pieces.pop(); pieces[0] = last.concat(pieces[0].slice(1));
      }
      pieces.forEach((p, k) => out.push({ ...f, id: pieces.length > 1 ? `${f.id}~${k}` : f.id, geometry: p }));
      stats.cut++; stats.pieces += pieces.length;
    }
    return { features: out, stats };
  };
  return { inside, clip };
}
