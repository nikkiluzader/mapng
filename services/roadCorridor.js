// Road mode (refs/output/road-mode-plan.md): a stretch of road widened by a distance either side, as one map's grid and
// footprint. The footprint is row runs (services/batchShape.js shapes): a pixel is in when its centre is within the half
// width of the road's line (exact; overlapping bends counted once).
//
// The grid matches Generate's: a local transverse Mercator frame centred on the map (services/geoUtils.js), pixels laid
// linearly across the fetch box, which is the map's metric extent plus FETCH_PAD_M each side (terrain.js
// computeMetricFetchBounds and the resampler's targetBounds mapping): pixel x's centre at
// -spanX/2 + x * spanX / (W - 1) metres, spanX = W * mpp + 2 * FETCH_PAD_M.
import { createWGS84ToLocal, createLocalToWGS84 } from './geoUtils.js';

export const CORRIDOR_MIN_M = 50;
export const CORRIDOR_MAX_M = 2000;
export const CORRIDOR_DEFAULT_M = 250;
const FETCH_PAD_M = 4;
const GRID_MARGIN_PX = 4;

/** Row y's x-interval [a, b] (metres) within h of segment AB, or null. The capsule is convex: the union of the two end
 * discs and the band beside the segment is one interval. */
function capsuleRow(ax, ay, bx, by, h, Y) {
  let lo = Infinity; let hi = -Infinity;
  for (const [px, py] of [[ax, ay], [bx, by]]) {
    const dy = Y - py; if (Math.abs(dy) > h) continue;
    const r = Math.sqrt(h * h - dy * dy); lo = Math.min(lo, px - r); hi = Math.max(hi, px + r);
  }
  const dx = bx - ax; const dyy = by - ay; const L = Math.sqrt(dx * dx + dyy * dyy);
  if (L > 1e-9) {
    // the band: |n . (P - A)| <= h and 0 <= d . (P - A) <= L^2, P = (X, Y): each linear in X
    const nx = -dyy / L; const ny = dx / L;
    let a = -Infinity; let b = Infinity;
    const lin = (k, c, min, max) => {   // min <= k X + c <= max
      if (Math.abs(k) < 1e-12) { if (c < min || c > max) { a = Infinity; b = -Infinity; } return; }
      const x1 = (min - c) / k; const x2 = (max - c) / k;
      a = Math.max(a, Math.min(x1, x2)); b = Math.min(b, Math.max(x1, x2));
    };
    lin(nx, ny * (Y - ay) - nx * ax, -h, h);
    lin(dx, dyy * (Y - ay) - dx * ax, 0, L * L);
    if (a <= b) { lo = Math.min(lo, a); hi = Math.max(hi, b); }
  }
  return lo <= hi ? [lo, hi] : null;
}

/**
 * The corridor's grid: { center: { lat, lng }, width, height, runs: [[y, x0, x1]...], lengthM, areaPx }.
 * points: the stretch [{ lat, lng }...] (at least two); halfWidthM: the distance either side; mpp: metres per pixel.
 */
export function corridorGrid(points, halfWidthM, mpp) {
  const m = Number(mpp) > 0 ? Number(mpp) : 1;
  const h = Math.max(CORRIDOR_MIN_M, Math.min(CORRIDOR_MAX_M, Number(halfWidthM) || CORRIDOR_DEFAULT_M));
  // a first frame at the points' box middle, then the grid's own centre at the corridor's middle
  const lats = points.map((p) => p.lat); const lngs = points.map((p) => p.lng);
  const c0 = { lat: (Math.min(...lats) + Math.max(...lats)) / 2, lng: (Math.min(...lngs) + Math.max(...lngs)) / 2 };
  const to0 = createWGS84ToLocal(c0.lat, c0.lng);
  const p0 = points.map((p) => to0.forward([p.lng, p.lat]));
  const minX = Math.min(...p0.map((p) => p[0])) - h; const maxX = Math.max(...p0.map((p) => p[0])) + h;
  const minY = Math.min(...p0.map((p) => p[1])) - h; const maxY = Math.max(...p0.map((p) => p[1])) + h;
  const [clng, clat] = createLocalToWGS84(c0.lat, c0.lng).forward([(minX + maxX) / 2, (minY + maxY) / 2]);
  const center = { lat: clat, lng: clng };
  const width = Math.ceil((maxX - minX) / m) + 2 * GRID_MARGIN_PX; const height = Math.ceil((maxY - minY) / m) + 2 * GRID_MARGIN_PX;
  // the points in the grid's own frame (metres, x east, y north, origin at the centre)
  const to = createWGS84ToLocal(center.lat, center.lng);
  const P = points.map((p) => to.forward([p.lng, p.lat]));
  const spanX = width * m + 2 * FETCH_PAD_M; const spanY = height * m + 2 * FETCH_PAD_M;
  const sx = spanX / (width - 1); const sy = spanY / (height - 1);
  const xOf = (X) => (X + spanX / 2) / sx;   // metres -> pixel (fractional)
  const runs = []; let areaPx = 0; let lengthM = 0;
  for (let k = 1; k < P.length; k++) lengthM += Math.hypot(P[k][0] - P[k - 1][0], P[k][1] - P[k - 1][1]);
  for (let y = 0; y < height; y++) {
    const Y = spanY / 2 - y * sy;
    const ivs = [];
    for (let k = 1; k < P.length; k++) {
      const [ax, ay] = P[k - 1]; const [bx, by] = P[k];
      if (Math.min(ay, by) - h > Y || Math.max(ay, by) + h < Y) continue;
      const iv = capsuleRow(ax, ay, bx, by, h, Y); if (iv) ivs.push(iv);
    }
    if (!ivs.length) continue;
    ivs.sort((a, b) => a[0] - b[0]);
    const merged = []; for (const [a, b] of ivs) { const last = merged[merged.length - 1]; if (last && a <= last[1]) last[1] = Math.max(last[1], b); else merged.push([a, b]); }
    for (const [a, b] of merged) {
      // pixels whose centres lie in [a, b]
      const x0 = Math.max(0, Math.ceil(xOf(a))); const x1 = Math.min(width, Math.floor(xOf(b)) + 1);
      if (x1 > x0) { runs.push([y, x0, x1]); areaPx += x1 - x0; }
    }
  }
  return { center, width, height, runs, lengthM, areaPx, halfWidthM: h };
}
