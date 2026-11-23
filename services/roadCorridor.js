// Road mode (refs/output/road-mode-plan.md): a stretch of road widened by a distance either side, as one map's grid and
// footprint. The footprint is row runs (services/batchShape.js shapes) of the map's height samples: a sample is in when
// its place in the world is within the half width of the road's line (overlapping bends counted once).
//
// The grid is Generate's own (services/mapFrame.js): the map's bounds are exactly its size through its centre, positions
// linear in latitude and longitude across them, sample (x, y) the vertex x squares from the west edge and y + 1 from
// the north. Distances to the road are measured on the ground, in metres at the latitude where they are measured, so
// the corridor is the same width at the top of a long map as at its centre. (Until 2026-11-23 it was rasterised in a
// transverse Mercator frame Generate does not use: 20 m off at latitude 45 on a 16 km map, 122 m at latitude 60 on
// 30 km, where the road left its own corridor.)
import { metresPerDegree, frameBounds } from './mapFrame.js';

export const CORRIDOR_MIN_M = 50;
export const CORRIDOR_MAX_M = 2000;
export const CORRIDOR_DEFAULT_M = 250;
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
 * The corridor's grid: { center: { lat, lng }, width, height, runs: [[y, x0, x1]...], lengthM, areaPx, halfWidthM }.
 * points: the stretch [{ lat, lng }...] (at least two); halfWidthM: the distance either side; mpp: metres per pixel.
 */
export function corridorGrid(points, halfWidthM, mpp) {
  const m = Number(mpp) > 0 ? Number(mpp) : 1;
  const h = Math.max(CORRIDOR_MIN_M, Math.min(CORRIDOR_MAX_M, Number(halfWidthM) || CORRIDOR_DEFAULT_M));
  const n = points.length;
  // the box the corridor needs, in degrees: every point with the half width round it, at its own latitude
  let latMin = Infinity; let latMax = -Infinity; let lngMin = Infinity; let lngMax = -Infinity;
  for (let i = 0; i < n; i++) {
    const p = points[i]; const k = metresPerDegree(p.lat); const dLat = h / k.lat;
    // (the disc is widest, in degrees of longitude, at its edge nearer the pole)
    const dLng = h / Math.min(metresPerDegree(p.lat + dLat).lng, metresPerDegree(p.lat - dLat).lng);
    if (p.lat - dLat < latMin) latMin = p.lat - dLat; if (p.lat + dLat > latMax) latMax = p.lat + dLat;
    if (p.lng - dLng < lngMin) lngMin = p.lng - dLng; if (p.lng + dLng > lngMax) lngMax = p.lng + dLng;
  }
  // the map: centred on that box, its size the box's in metres at the centre, a few squares to spare
  const center = { lat: (latMin + latMax) / 2, lng: (lngMin + lngMax) / 2 };
  const kc = metresPerDegree(center.lat);
  const width = Math.ceil(((lngMax - lngMin) * kc.lng) / m) + 2 * GRID_MARGIN_PX; const height = Math.ceil(((latMax - latMin) * kc.lat) / m) + 2 * GRID_MARGIN_PX;
  const bounds = frameBounds(center, width * m, height * m);
  const latSpan = bounds.north - bounds.south; const lngSpan = bounds.east - bounds.west;
  const rowLat = (y) => bounds.north - ((y + 1) / height) * latSpan;        // sample row y
  const colOf = (lng) => ((lng - bounds.west) / lngSpan) * width;            // a longitude, in squares from the west edge
  // metres per degree at every row, once (the inner loop below takes no sine or cosine)
  const rowKx = new Float64Array(height); const rowKy = new Float64Array(height);
  for (let y = 0; y < height; y++) { const k = metresPerDegree(rowLat(y)); rowKx[y] = k.lng; rowKy[y] = k.lat; }
  // each segment's reach, row by row: only the rows within the half width of it (no pass over every row per segment)
  const perRow = new Array(height); let lengthM = 0;
  for (let i = 1; i < n; i++) {
    const A = points[i - 1]; const B = points[i];
    const ks = metresPerDegree((A.lat + B.lat) / 2);
    lengthM += Math.sqrt(((B.lng - A.lng) * ks.lng) ** 2 + ((B.lat - A.lat) * ks.lat) ** 2);
    const reach = h / Math.min(metresPerDegree(A.lat).lat, metresPerDegree(B.lat).lat);
    const top = Math.max(A.lat, B.lat) + reach; const bottom = Math.min(A.lat, B.lat) - reach;
    const y0 = Math.max(0, Math.floor(((bounds.north - top) / latSpan) * height) - 2); const y1 = Math.min(height - 1, Math.ceil(((bounds.north - bottom) / latSpan) * height) + 1);
    for (let y = y0; y <= y1; y++) {
      // the segment in metres round this row: x from A's meridian, y from the row; the scale between the row's and the
      // segment's latitudes (their mean: exact to the second order over a half width)
      const lat = rowLat(y); const kx = (rowKx[y] + ks.lng) / 2; const ky = (rowKy[y] + ks.lat) / 2;
      const iv = capsuleRow(0, (A.lat - lat) * ky, (B.lng - A.lng) * kx, (B.lat - lat) * ky, h, 0);
      if (!iv) continue;
      const a = colOf(A.lng + iv[0] / kx); const b = colOf(A.lng + iv[1] / kx);
      (perRow[y] || (perRow[y] = [])).push(a, b);
    }
  }
  const runs = []; let areaPx = 0;
  for (let y = 0; y < height; y++) {
    const flat = perRow[y]; if (!flat) continue;
    const ivs = []; for (let k = 0; k < flat.length; k += 2) ivs.push([flat[k], flat[k + 1]]);
    ivs.sort((p, q) => p[0] - q[0]);
    let lo = ivs[0][0]; let hi = ivs[0][1];
    const emit = () => {
      // the samples whose own place lies in [lo, hi]: sample x is exactly x squares from the west edge
      const x0 = Math.max(0, Math.ceil(lo)); const x1 = Math.min(width, Math.floor(hi) + 1);
      if (x1 > x0) { runs.push([y, x0, x1]); areaPx += x1 - x0; }
    };
    for (let k = 1; k < ivs.length; k++) {
      // (runs that touch or overlap, or leave no sample between them, are one)
      if (Math.ceil(ivs[k][0]) <= Math.floor(hi) + 1) { if (ivs[k][1] > hi) hi = ivs[k][1]; } else { emit(); lo = ivs[k][0]; hi = ivs[k][1]; }
    }
    emit();
  }
  return { center, width, height, runs, lengthM, areaPx, halfWidthM: h };
}
