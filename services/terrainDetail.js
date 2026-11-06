// Fine ground detail for levels built from the global 30 m.
//
// 30 m elevation holds nothing smaller than a few tens of metres, so up close its ground looks melted: every field,
// wood and hillside equally smooth. Real ground has small relief that depends on what covers it: tussocks and
// hollows in scrub and woodland, gentler undulation in grass, almost none in ploughed or mown fields, broken rock
// on steep bare slopes. This adds that, in the BeamNG level only (never in the Generate data or GeoTIFF/heightmap
// downloads, which stay the real data), only on ground nothing is built on: roads, buildings, water, car parks,
// pitches and plazas get none, and it fades out towards them.
//
// The relief is value noise in world coordinates (Web Mercator metres), so neighbouring tiles of a batch match, and
// it is deterministic: the same place gets the same ground every export. Amplitudes are small (decimetres; about a
// metre on steep rock) and the shortest wavelength is 4 m, so driving off road gets texture, not obstacles.
//
// Cliffs first: 30 m data smears a cliff into a ramp a few cells wide. Where OSM maps a cliff as a line (its top
// edge, the face on the right of the way), and the data agrees there is a drop that way, the ramp is turned back
// into a step: the top held level up to the line, the face steep just past it, the foot level below; the data's
// own variation is kept, and nothing changes more than CLIFF_W_M from the line or past its ends.
import { createGridProjector } from './geoUtils.js';

// amplitude (m, before the slope factor) by land cover; unmapped ground gets DEFAULT
const COVER = [
  [(t) => ['bare_rock', 'scree', 'shingle', 'cliff'].includes(t.natural), 0.9],
  [(t) => ['wood', 'forest'].includes(t.natural) || ['forest', 'wood'].includes(t.landuse), 0.45],
  [(t) => ['scrub', 'heath', 'fell', 'tundra'].includes(t.natural), 0.5],
  [(t) => ['sand', 'beach', 'dune'].includes(t.natural), 0.3],
  [(t) => ['grassland', 'meadow'].includes(t.natural) || ['meadow', 'grass', 'village_green'].includes(t.landuse), 0.18],
  [(t) => ['park', 'nature_reserve'].includes(t.leisure) || t.landuse === 'recreation_ground', 0.15],
  [(t) => ['farmland', 'orchard', 'vineyard', 'allotments', 'plant_nursery'].includes(t.landuse), 0.06],
  [(t) => ['residential', 'commercial', 'retail', 'industrial', 'railway', 'garages', 'construction', 'cemetery'].includes(t.landuse), 0.05],
];
const NONE = (t) => !!t.building || ['parking', 'pitch', 'track', 'playground', 'swimming_pool', 'marina', 'golf_course', 'stadium'].includes(t.amenity) || ['pitch', 'track', 'playground', 'swimming_pool', 'marina', 'golf_course', 'stadium'].includes(t.leisure) || t.place === 'square' || t.highway === 'pedestrian' || t.area === 'yes' && !!t.highway;
const DEFAULT_AMP = 0.22;
const ROAD_CLEAR_M = { motorway: 14, trunk: 12, primary: 11, secondary: 10, tertiary: 9, residential: 8, unclassified: 7, service: 6, track: 4, path: 2.5, footway: 2.5, cycleway: 3 };
const FEATHER_M = 8;
const WAVELENGTHS_M = [48, 24, 12, 6, 4];
const WEIGHTS = [0.45, 0.28, 0.15, 0.08, 0.04];
const R = 6378137;
const CLIFF_W_M = 30;          // reach either side of a cliff line (about one 30 m cell)
const CLIFF_MIN_DROP_M = 3;    // the data must show at least this drop across the line, the mapped way
const CLIFF_AMP = 0.9;         // rough relief on a cliff face, like bare rock

/** Bilinear sample of a row-major grid at pixel-centre coordinates (x, y), clamped. */
function sample(a, w, h, x, y) {
  const fx = Math.min(w - 1, Math.max(0, x - 0.5)), fy = Math.min(h - 1, Math.max(0, y - 0.5));
  const x0 = Math.floor(fx), y0 = Math.floor(fy), x1 = Math.min(w - 1, x0 + 1), y1 = Math.min(h - 1, y0 + 1), u = fx - x0, v = fy - y0;
  return (a[y0 * w + x0] * (1 - u) + a[y0 * w + x1] * u) * (1 - v) + (a[y1 * w + x0] * (1 - u) + a[y1 * w + x1] * u) * v;
}

/**
 * Turns the ramps the 30 m data makes of OSM cliff lines back into steps. Returns { heightMap, face, cliffs }:
 * face marks the pixels on a sharpened cliff face (for rougher relief there).
 */
export function sharpenCliffs({ heightMap, width, height, bounds, metersPerPixel, osmFeatures }) {
  const mpp = Number(metersPerPixel) > 0 ? Number(metersPerPixel) : 1;
  const proj = createGridProjector(bounds, width, height);
  const W = CLIFF_W_M / mpp;                                   // in pixels
  const out = Float32Array.from(heightMap);
  const face = new Uint8Array(width * height);
  // per pixel, the nearest cliff's correction and its top/foot heights: stacked cliff bands never add up, and a
  // pixel never ends above that cliff's top or below its foot (the data's own curvature would overshoot)
  const near = new Float32Array(width * height).fill(Infinity);
  const corr = new Float32Array(width * height), lo = new Float32Array(width * height), hi = new Float32Array(width * height);
  let cliffs = 0;
  for (const f of osmFeatures || []) {
    if (f?.type !== 'cliff' || !(f.geometry?.length > 1)) continue;
    const pts = f.geometry.map((p) => { const q = proj(p.lat, p.lng); return { x: q.x + 0.5, y: q.y + 0.5 }; });
    // does the data show a drop to the right of the line? (sampled along it, on the original heights)
    let drop = 0, cnt = 0;
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1], b = pts[i], l = Math.hypot(b.x - a.x, b.y - a.y); if (l < 1e-6) continue;
      const nx = -(b.y - a.y) / l, ny = (b.x - a.x) / l;          // right of travel (image y down)
      for (let t = 0.5 / Math.max(1, Math.ceil(l / 4)); t < 1; t += 1 / Math.max(1, Math.ceil(l / 4))) {
        const x = a.x + (b.x - a.x) * t, y = a.y + (b.y - a.y) * t;
        if (x < 0 || y < 0 || x >= width || y >= height) continue;
        drop += sample(heightMap, width, height, x - nx * W, y - ny * W) - sample(heightMap, width, height, x + nx * W, y + ny * W); cnt++;
      }
    }
    if (!cnt || drop / cnt < CLIFF_MIN_DROP_M) continue;
    cliffs++;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const p of pts) { x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y); x1 = Math.max(x1, p.x); y1 = Math.max(y1, p.y); }
    const total = pts.reduce((acc, p, i) => acc + (i ? Math.hypot(p.x - pts[i - 1].x, p.y - pts[i - 1].y) : 0), 0);
    for (let py = Math.max(0, Math.floor(y0 - W)); py <= Math.min(height - 1, Math.ceil(y1 + W)); py++) {
      for (let px = Math.max(0, Math.floor(x0 - W)); px <= Math.min(width - 1, Math.ceil(x1 + W)); px++) {
        const cx = px + 0.5, cy = py + 0.5;
        // nearest point on the line: signed offset s (+ = right, the face side) and distance along it
        let best = Infinity, s = 0, along = 0, nX = 0, nY = 0, run = 0, qx = 0, qy = 0;
        for (let i = 1; i < pts.length; i++) {
          const a = pts[i - 1], b = pts[i], dx = b.x - a.x, dy = b.y - a.y, l2 = dx * dx + dy * dy, l = Math.sqrt(l2);
          if (l2 < 1e-9) continue;
          const t = Math.min(1, Math.max(0, ((cx - a.x) * dx + (cy - a.y) * dy) / l2));
          const ex = a.x + dx * t, ey = a.y + dy * t, d = Math.hypot(cx - ex, cy - ey);
          if (d < best) { best = d; nX = -dy / l; nY = dx / l; s = (cx - ex) * nX + (cy - ey) * nY; along = run + t * l; qx = ex; qy = ey; }
          run += l;
        }
        if (best > W) continue;
        const hTop = sample(heightMap, width, height, qx - nX * W, qy - nY * W);
        const hBot = sample(heightMap, width, height, qx + nX * W, qy + nY * W);
        const d = hTop - hBot; if (d < 1) continue;
        const fw = Math.min(W / 2, Math.max(1.5 / mpp, (0.3 * d) / mpp));     // face width (px): steep, not vertical
        const ends = Math.min(1, Math.min(along, total - along) / W);          // fade out past the line's ends
        const sm = Math.min(1, Math.max(0, s / fw));
        const target = hTop - d * sm * sm * (3 - 2 * sm);
        const ramp = hTop - d * (s + W) / (2 * W);
        const k = py * width + px;
        if (best >= near[k]) continue;
        near[k] = best; corr[k] = ends * ends * (3 - 2 * ends) * (target - ramp); lo[k] = hBot; hi[k] = hTop;
        face[k] = s > -1 && s < fw + 1 ? 1 : 0;
      }
    }
  }
  for (let k = 0; k < out.length; k++) {
    if (near[k] === Infinity) continue;
    const h = heightMap[k], v = h + corr[k];
    out[k] = Math.min(Math.max(hi[k], h), Math.max(Math.min(lo[k], h), v));
  }
  return { heightMap: out, face, cliffs };
}

// integer hash -> [-1, 1)
const hash = (x, y, s) => {
  let h = (x * 374761393 + y * 668265263 + s * 2147483647) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177); h ^= h >>> 16;
  return (h & 0xffff) / 32768 - 1;
};
const fade = (t) => t * t * (3 - 2 * t);
function valueNoise(x, y, s) {
  const x0 = Math.floor(x), y0 = Math.floor(y), u = fade(x - x0), v = fade(y - y0);
  const a = hash(x0, y0, s), b = hash(x0 + 1, y0, s), c = hash(x0, y0 + 1, s), d = hash(x0 + 1, y0 + 1, s);
  return (a * (1 - u) + b * u) * (1 - v) + (c * (1 - u) + d * u) * v;
}
/** Fractal relief at world position (mercator metres), about -1..1. */
export function reliefAt(mx, my) {
  let z = 0; for (let o = 0; o < WAVELENGTHS_M.length; o++) z += WEIGHTS[o] * valueNoise(mx / WAVELENGTHS_M[o], my / WAVELENGTHS_M[o], o + 1);
  return z / 0.5;
}

/**
 * Adds fine detail to heightMap (absolute heights, row 0 north, width x height over bounds, metersPerPixel). Returns
 * a new Float32Array (the input is left as it is) and stats.
 */
export function addFineGroundDetail({ heightMap, width, height, bounds, metersPerPixel, osmFeatures }) {
  const mpp = Number(metersPerPixel) > 0 ? Number(metersPerPixel) : 1;
  const sharp = sharpenCliffs({ heightMap, width, height, bounds, metersPerPixel: mpp, osmFeatures });
  heightMap = sharp.heightMap;
  const cell = Math.max(2, mpp);                                   // amplitude grid
  const cw = Math.ceil((width * mpp) / cell), ch = Math.ceil((height * mpp) / cell);
  const proj = createGridProjector(bounds, cw, ch);
  const amp = new Float32Array(cw * ch).fill(DEFAULT_AMP);
  const clear = new Uint8Array(cw * ch);                           // no detail here
  const P = (g) => g.map((p) => { const q = proj(p.lat, p.lng); return { x: q.x + 0.5, y: q.y + 0.5 }; });
  const fill = (rings, fn) => {
    let y0 = ch, y1 = -1; for (const r of rings) for (const p of r) { y0 = Math.min(y0, Math.floor(p.y)); y1 = Math.max(y1, Math.ceil(p.y)); }
    for (let y = Math.max(0, y0); y <= Math.min(ch - 1, y1); y++) {
      const yc = y + 0.5, xs = [];
      for (const r of rings) for (let i = 0, j = r.length - 1; i < r.length; j = i++) { const a = r[i], b = r[j]; if ((a.y > yc) !== (b.y > yc)) xs.push(a.x + ((yc - a.y) / (b.y - a.y)) * (b.x - a.x)); }
      xs.sort((p, q) => p - q);
      for (let k = 0; k + 1 < xs.length; k += 2) for (let x = Math.max(0, Math.ceil(xs[k] - 0.5)); x <= Math.min(cw - 1, Math.floor(xs[k + 1] - 0.5)); x++) fn(y * cw + x);
    }
  };
  const stroke = (pts, halfCells) => {
    const r = Math.max(0.5, halfCells);
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1], b = pts[i]; const steps = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) * 2));
      for (let s = 0; s <= steps; s++) {
        const px = a.x + ((b.x - a.x) * s) / steps, py = a.y + ((b.y - a.y) * s) / steps;
        for (let y = Math.floor(py - r); y <= Math.ceil(py + r); y++) for (let x = Math.floor(px - r); x <= Math.ceil(px + r); x++) {
          if (x >= 0 && y >= 0 && x < cw && y < ch && (x + 0.5 - px) ** 2 + (y + 0.5 - py) ** 2 <= r * r) clear[y * cw + x] = 1;
        }
      }
    }
  };
  const areas = [], clears = [], lines = [];
  for (const f of osmFeatures || []) {
    const t = f?.tags || {}; const g = f?.geometry;
    if (!Array.isArray(g) || g.length < 2 || g[0]?.lat == null) continue;
    const closed = g.length > 3 && g[0].lat === g[g.length - 1].lat && g[0].lng === g[g.length - 1].lng;
    if (f.type === 'building' || (closed && NONE(t)) || f.type === 'water' || t.natural === 'water' || t.waterway === 'riverbank') { if (closed) clears.push(f); else if (t.waterway) lines.push([f, 4]); continue; }
    if (t.highway && !closed) { lines.push([f, ROAD_CLEAR_M[t.highway] ?? 6]); continue; }
    if (t.railway && !closed) { lines.push([f, 5]); continue; }
    if (t.waterway && !closed) { lines.push([f, 4]); continue; }
    if (closed) { const c = COVER.find(([test]) => test(t)); if (c) areas.push([f, c[1]]); }
  }
  // larger areas first, so smaller ones inside them (a copse in a field) win
  const areaOf = (g) => { let s = 0; for (let i = 0, j = g.length - 1; i < g.length; j = i++) s += (g[j].lng - g[i].lng) * (g[j].lat + g[i].lat); return Math.abs(s); };
  areas.sort((a, b) => areaOf(b[0].geometry) - areaOf(a[0].geometry));
  for (const [f, a] of areas) fill([P(f.geometry), ...((f.holes || []).filter(Array.isArray).map(P))], (k) => { amp[k] = a; });
  for (const f of clears) fill([P(f.geometry), ...((f.holes || []).filter(Array.isArray).map(P))], (k) => { clear[k] = 1; });
  for (const [f, half] of lines) stroke(P(f.geometry), half / cell);
  // feather: distance (in cells) to the nearest cleared cell, by two-pass chamfer
  const dist = new Float32Array(cw * ch); const INF = 1e9;
  for (let k = 0; k < dist.length; k++) dist[k] = clear[k] ? 0 : INF;
  for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) { const k = y * cw + x; if (x) dist[k] = Math.min(dist[k], dist[k - 1] + 1); if (y) dist[k] = Math.min(dist[k], dist[k - cw] + 1); if (x && y) dist[k] = Math.min(dist[k], dist[k - cw - 1] + 1.414); if (y && x < cw - 1) dist[k] = Math.min(dist[k], dist[k - cw + 1] + 1.414); }
  for (let y = ch - 1; y >= 0; y--) for (let x = cw - 1; x >= 0; x--) { const k = y * cw + x; if (x < cw - 1) dist[k] = Math.min(dist[k], dist[k + 1] + 1); if (y < ch - 1) dist[k] = Math.min(dist[k], dist[k + cw] + 1); if (x < cw - 1 && y < ch - 1) dist[k] = Math.min(dist[k], dist[k + cw + 1] + 1.414); if (y < ch - 1 && x) dist[k] = Math.min(dist[k], dist[k + cw - 1] + 1.414); }
  const featherCells = FEATHER_M / cell;
  // world coordinates of each pixel (mercator metres), and the slope from the heightmap itself
  const out = heightMap;   // (sharpenCliffs already made the copy)
  const base = Float32Array.from(heightMap);
  let touched = 0, maxAdd = 0;
  const westM = (bounds.west * Math.PI / 180) * R, eastM = (bounds.east * Math.PI / 180) * R;
  const yM = (lat) => R * Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360));
  const northM = yM(bounds.north), southM = yM(bounds.south);
  for (let py = 0; py < height; py++) {
    const my = northM + ((py + 0.5) / height) * (southM - northM);
    const cy = Math.min(ch - 1, Math.floor(((py + 0.5) / height) * ch));
    for (let px = 0; px < width; px++) {
      const k = py * width + px; const h = base[k]; if (!(h > -1000)) continue;
      const cx = Math.min(cw - 1, Math.floor(((px + 0.5) / width) * cw)); const c = cy * cw + cx;
      const f = Math.min(1, dist[c] / featherCells); if (f <= 0) continue;
      const gx = (base[py * width + Math.min(width - 1, px + 1)] - base[py * width + Math.max(0, px - 1)]) / (2 * mpp);
      const gy = (base[Math.min(height - 1, py + 1) * width + px] - base[Math.max(0, py - 1) * width + px]) / (2 * mpp);
      const slope = Math.min(1.5, Math.hypot(gx, gy));
      const a = (sharp.face[k] ? Math.max(amp[c], CLIFF_AMP) : amp[c]) * (1 + 1.2 * slope) * fade(f);
      const mx = westM + ((px + 0.5) / width) * (eastM - westM);
      const d = a * reliefAt(mx, my);
      out[k] = h + d; touched++; if (Math.abs(d) > maxAdd) maxAdd = Math.abs(d);
    }
  }
  return { heightMap: out, stats: { pixels: touched, share: touched / (width * height), maxAdd, cliffs: sharp.cliffs } };
}
