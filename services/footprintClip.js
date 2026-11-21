// A shaped level's map data, kept to its footprint (services/batchShape.js; exportBeamNGLevel.js groundShape). Outside
// the footprint there is no ground, so nothing may be built there:
// - lines (roads, railways, paths, fences, power lines) are cut at the footprint's edge: each stretch inside becomes its
//   own feature (`id` + `~k`), with a point added where it crosses the edge;
// - buildings are kept when their centre is inside;
// - areas (water, forests, land use, parks) are kept when their bounding box touches the footprint (the trees and the
//   ground they paint are kept inside it later);
// - point features are kept when inside.
// Pixel space as batchShape.js: the export grid's N x N pixels over `bounds`, x east, y south.
import { footprintRows, inFootprint } from './batchShape.js';

const LINE_TYPES = new Set(['road', 'railway', 'barrier', 'power_line', 'waterway', 'path', 'cliff', 'wall', 'pier']);

/**
 * The clipper for one footprint: { inside(lat, lng), clip(features) -> { features, stats } }. shape: { size, rects } on
 * a square grid, or { width, height, rects } on a rectangle (Generate's grid).
 */
export function footprintClipper(bounds, shape) {
  const W = shape.width ?? shape.size; const H = shape.height ?? shape.size;
  const rows = footprintRows(shape.rects, H, W);
  const sx = W / (bounds.east - bounds.west); const sy = H / (bounds.north - bounds.south);
  const inside = (lat, lng) => {
    const x = Math.floor((lng - bounds.west) * sx); const y = Math.floor((bounds.north - lat) * sy);
    return x >= 0 && y >= 0 && x < W && y < H && inFootprint(rows, x, y);
  };
  // the footprint's own box per rect (lat/lng), for the areas' overlap test
  const rectBoxes = shape.rects.map(([x, y, w, h]) => ({
    west: bounds.west + x / sx, east: bounds.west + (x + w) / sx, north: bounds.north - y / sy, south: bounds.north - (y + h) / sy,
  }));
  const boxTouches = (pts) => {
    let w = Infinity; let e = -Infinity; let s = Infinity; let n = -Infinity;
    for (const p of pts) { if (p.lng < w) w = p.lng; if (p.lng > e) e = p.lng; if (p.lat < s) s = p.lat; if (p.lat > n) n = p.lat; }
    return rectBoxes.some((r) => w <= r.east && e >= r.west && s <= r.north && n >= r.south);
  };
  // the crossing between an inside and an outside point: bisected to well under a pixel
  const crossing = (a, b) => {
    let lo = a; let hi = b;   // lo inside, hi outside
    for (let k = 0; k < 24; k++) {
      const m = { ...lo, lat: (lo.lat + hi.lat) / 2, lng: (lo.lng + hi.lng) / 2 };
      if (inside(m.lat, m.lng)) lo = m; else hi = m;
    }
    return lo;
  };
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
        let la = 0; let ln = 0; for (const p of g) { la += p.lat; ln += p.lng; }
        if (inside(la / g.length, ln / g.length)) { out.push(f); stats.kept++; } else stats.dropped++;
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
      // a line: its stretches inside
      const ins = g.map((p) => inside(p.lat, p.lng));
      if (ins.every(Boolean)) { out.push(f); stats.kept++; continue; }
      if (!ins.some(Boolean)) { stats.dropped++; continue; }
      const pieces = []; let cur = null;
      for (let i = 0; i < g.length; i++) {
        if (ins[i]) {
          if (!cur) { cur = []; if (i > 0) cur.push(crossing(g[i], g[i - 1])); }
          cur.push(g[i]);
        } else if (cur) { cur.push(crossing(g[i - 1], g[i])); pieces.push(cur); cur = null; }
      }
      if (cur) pieces.push(cur);
      const kept = pieces.filter((p) => p.length >= 2);
      kept.forEach((p, k) => out.push({ ...f, id: kept.length > 1 ? `${f.id}~${k}` : f.id, geometry: p }));
      stats.cut++; stats.pieces += kept.length;
    }
    return { features: out, stats };
  };
  return { inside, clip };
}
