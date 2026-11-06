// The ground under buildings, woods and viaduct decks in the global 30 m elevation.
//
// The global 30 m (AWS Terrain Tiles) is a radar surface model in most of the world (SRTM): it measures rooftops
// and treetops, so dense districts stand 5-25 m above their streets as blobs and plateaus. This step takes them
// out, using what the map knows (OSM buildings with heights, woods, bridge decks) and GEDTM30, a global bare-earth
// model (gedtm.js). Built against national and city lidar in 25 cities (scratch/dsmprobe; refs/output/
// terrain-roadmap.html): road error 7.6 -> 5.0 m on average, 10.7 -> 6.1 m in radar-data cities, and data that is
// already bare earth (London, Vancouver: national models inside the 30 m) left unchanged. Nothing is place-specific.
//
// On a working grid of >= 4 m cells:
//  1. Is our data a surface model here? Fit (ours - GEDTM30) = offset + c * building volume + g * woods over the
//     map. The offset is the datum between the two; c > 0 means our data rises with buildings (radar), c < 0 that
//     it is the cleaner surface (a bare-earth model): then nothing is done.
//  2. Per neighbourhood, where (ours - GEDTM30) correlates with buildings, GEDTM30 becomes the base (wG).
//  3. GEDTM30 itself keeps part of the buildings in places (a CBD plateau): its own street-vs-block contrast,
//     against building volume blurred by the radar's ~100 m sharpness, measures what is left, and that is cut.
//  4. Where buildings stand and the data is radar, the lowest surface a 400 m window can reach (a morphological
//     opening, as BeamNG.Earth's dsmground) is blended in when lower: in flat dense cities it finds street level.
//     Never deeper than the buildings there explain, and faded out at the map's edge.
//  5. Never more than 1 m above our data (a surface model is an upper bound of the ground, up to its noise).
//  6. Copernicus GLO-30 (copernicus.js) goes through the same steps and is averaged in where the data is radar.
// The correction is applied to the full grid bilinearly. Runs before road smoothing, so roads level onto ground.
import { createGridProjector } from './geoUtils.js';

const P = {
  CELL_MIN_M: 4, MAX_CELLS: 2048,
  PSF_M: 100, APSF_M: 60, HP_M: 250, FIT_M: 700, D_SMOOTH_M: 30,
  DEFAULT_H: 9, DECK_H: 8, WOOD_H: 14,
  R_LO: 0.08, R_HI: 0.25, C_MAX: 1.6, G_MAX: 1.2, D_LO: -0.05, D_HI: 0.2, RAISE_M: 1.0,
  K_G: 0.8, K_OPEN: 0.7, SLOPE_LO: -0.15, SLOPE_HI: 0.10, OPEN_EXPLAIN_K: 1.5, OPEN_EXPLAIN_ADD: 2,
  // the opening (BeamNG.Earth's parameters, server/dsmground.py)
  WINDOW_M: 400, THRESHOLD_M: 2, SLOPE_K: 0.35, MAX_CUT_M: 45, RELIEF_M: 600, RELIEF_FLAT_M: 40, RELIEF_HILLS_M: 90,
  RELIEF_OPEN_M: 150, CUT_LO: 35, CUT_HI: 55,
};

// ── grey morphology (van Herk / Gil-Werman, O(1) per sample) and box means; grids row-major n x n ──
function run(a, n, w, alongRows, isMax) {
  if (w <= 1) return Float32Array.from(a);
  const h = w >> 1; const m = n + 2 * h + ((w - ((n + 2 * h) % w)) % w);
  const p = new Float32Array(m), g = new Float32Array(m), s = new Float32Array(m), out = new Float32Array(a.length);
  for (let line = 0; line < n; line++) {
    for (let j = 0; j < m; j++) { const i = Math.min(n - 1, Math.max(0, j - h)); p[j] = alongRows ? a[line * n + i] : a[i * n + line]; }
    for (let b = 0; b < m; b += w) {
      g[b] = p[b]; for (let j = b + 1; j < b + w; j++) g[j] = isMax ? Math.max(g[j - 1], p[j]) : Math.min(g[j - 1], p[j]);
      s[b + w - 1] = p[b + w - 1]; for (let j = b + w - 2; j >= b; j--) s[j] = isMax ? Math.max(s[j + 1], p[j]) : Math.min(s[j + 1], p[j]);
    }
    for (let i = 0; i < n; i++) { const v = isMax ? Math.max(s[i], g[i + w - 1]) : Math.min(s[i], g[i + w - 1]); if (alongRows) out[line * n + i] = v; else out[i * n + line] = v; }
  }
  return out;
}
const erode = (a, n, w) => run(run(a, n, w, false, false), n, w, true, false);
const dilate = (a, n, w) => run(run(a, n, w, false, true), n, w, true, true);
const opening = (a, n, w) => dilate(erode(a, n, w), n, w);
function boxMean(a, n, w) {
  if (w <= 1) return Float32Array.from(a);
  const h = w >> 1;
  const pass = (src, alongRows) => {
    const out = new Float32Array(src.length);
    const at = (line, i) => { const c = Math.min(n - 1, Math.max(0, i)); return alongRows ? src[line * n + c] : src[c * n + line]; };
    for (let line = 0; line < n; line++) {
      let acc = 0; for (let i = -h; i <= h; i++) acc += at(line, i);
      for (let i = 0; i < n; i++) { const v = acc / w; if (alongRows) out[line * n + i] = v; else out[i * n + line] = v; acc += at(line, i + h + 1) - at(line, i - h); }
    }
    return out;
  };
  return pass(pass(a, false), true);
}
const gauss = (a, n, sigmaCells) => { const w = Math.max(1, Math.round(Math.sqrt(4 * sigmaCells * sigmaCells + 1)) | 1); return boxMean(boxMean(boxMean(a, n, w), n, w), n, w); };
const odd = (v) => Math.max(3, Math.round(v) | 1);
const clip01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

// local weighted least squares y ~ b1 x1 + b2 x2 and the signed correlation of y with x1
function localFit(y, x1, x2, w, n, sigma) {
  const N = n * n; const G = (f) => { const t = new Float32Array(N); for (let k = 0; k < N; k++) t[k] = w[k] ? f(k) : 0; return gauss(t, n, sigma); };
  const s11 = G((k) => x1[k] * x1[k]), s22 = G((k) => x2[k] * x2[k]), s12 = G((k) => x1[k] * x2[k]);
  const s1y = G((k) => x1[k] * y[k]), s2y = G((k) => x2[k] * y[k]), syy = G((k) => y[k] * y[k]);
  const b1 = new Float32Array(N), b2 = new Float32Array(N), r = new Float32Array(N);
  for (let k = 0; k < N; k++) {
    const ridge = 1e-4 + 0.02 * (s11[k] + s22[k]);
    const a11 = s11[k] + ridge, a22 = s22[k] + ridge, a12 = s12[k], det = a11 * a22 - a12 * a12;
    b1[k] = (a22 * s1y[k] - a12 * s2y[k]) / det; b2[k] = (a11 * s2y[k] - a12 * s1y[k]) / det;
    r[k] = s1y[k] / Math.sqrt(Math.max(s11[k] * syy[k], 1e-9));
  }
  return { b1, b2, r };
}

// BeamNG.Earth's opening (server/dsmground.py + native dsm.rs, MIT): surface objects narrower than the window cut
// down to the ground around them, where the ground is flat enough to tell them from hills.
export function openingGround(a, n, cell) {
  const w = odd(P.WINDOW_M / cell), wHalf = Math.max(3, (w >> 1) | 1), wr = odd(P.RELIEF_M / cell), wSmall = odd(P.RELIEF_OPEN_M / cell);
  const o = opening(a, n, w); const cut = new Float32Array(a.length); for (let k = 0; k < a.length; k++) cut[k] = a[k] - o[k];
  const bm = boxMean(o, n, wHalf), oSmall = opening(a, n, wSmall), dil = dilate(oSmall, n, wr), ero = erode(oSmall, n, wr), deep = dilate(cut, n, w);
  const out = new Float32Array(a.length); const half = P.WINDOW_M / 2;
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
    const k = i * n + j;
    const gy = i === 0 ? (bm[k + n] - bm[k]) / cell : i === n - 1 ? (bm[k] - bm[k - n]) / cell : (bm[k + n] - bm[k - n]) / (2 * cell);
    const gx = j === 0 ? (bm[k + 1] - bm[k]) / cell : j === n - 1 ? (bm[k] - bm[k - 1]) / cell : (bm[k + 1] - bm[k - 1]) / (2 * cell);
    let kk = clip01((cut[k] - (P.THRESHOLD_M + P.SLOPE_K * Math.hypot(gx, gy) * half)) / P.THRESHOLD_M);
    kk *= clip01((P.RELIEF_HILLS_M - (dil[k] - ero[k])) / (P.RELIEF_HILLS_M - P.RELIEF_FLAT_M));
    kk *= clip01((P.CUT_HI - deep[k]) / (P.CUT_HI - P.CUT_LO));
    out[k] = a[k] - Math.min(cut[k] * kk, P.MAX_CUT_M);
  }
  return out;
}

// ── what the map knows, on the working grid ──
const num = (v) => { const m = /^\s*([\d.]+)/.exec(String(v ?? '')); return m ? parseFloat(m[1]) : NaN; };
const buildingHeight = (t) => { const h = num(t?.height); if (h > 0) return h; const l = num(t?.['building:levels']); return l > 0 ? l * 3.2 + 2 : NaN; };
const isBridge = (t) => (!!t.bridge && t.bridge !== 'no') || (Number.parseInt(t.layer, 10) || 0) > 0 || t.location === 'elevated';
const isTunnel = (t) => (!!t.tunnel && t.tunnel !== 'no') || t.covered === 'yes';
const WOOD = new Set(['wood', 'forest', 'scrub']);
const FOOT = new Set(['footway', 'path', 'steps', 'cycleway', 'pedestrian', 'track', 'corridor', 'bridleway']);

export function rasterizeMapEvidence(osmFeatures, bounds, n, cell) {
  const proj = createGridProjector(bounds, n, n);
  const P2 = (g) => g.map((p) => { const q = proj(p.lat, p.lng); return { x: q.x + 0.5, y: q.y + 0.5 }; });
  const bld = new Float32Array(n * n), bridge = new Uint8Array(n * n), water = new Uint8Array(n * n), wood = new Uint8Array(n * n);
  const fill = (mask, rings, val) => {
    let y0 = n, y1 = -1; for (const r of rings) for (const p of r) { y0 = Math.min(y0, Math.floor(p.y)); y1 = Math.max(y1, Math.ceil(p.y)); }
    for (let y = Math.max(0, y0); y <= Math.min(n - 1, y1); y++) {
      const yc = y + 0.5, xs = [];
      for (const r of rings) for (let i = 0, j = r.length - 1; i < r.length; j = i++) { const a = r[i], b = r[j]; if ((a.y > yc) !== (b.y > yc)) xs.push(a.x + ((yc - a.y) / (b.y - a.y)) * (b.x - a.x)); }
      xs.sort((p, q) => p - q);
      for (let k = 0; k + 1 < xs.length; k += 2) for (let x = Math.max(0, Math.ceil(xs[k] - 0.5)); x <= Math.min(n - 1, Math.floor(xs[k + 1] - 0.5)); x++) mask[y * n + x] = Math.max(mask[y * n + x], val);
    }
  };
  const stroke = (mask, pts, halfW) => {
    const r = Math.max(0.5, halfW);
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1], b = pts[i]; const steps = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) * 2));
      for (let s = 0; s <= steps; s++) {
        const px = a.x + ((b.x - a.x) * s) / steps, py = a.y + ((b.y - a.y) * s) / steps;
        for (let y = Math.floor(py - r); y <= Math.ceil(py + r); y++) for (let x = Math.floor(px - r); x <= Math.ceil(px + r); x++) {
          if (x >= 0 && y >= 0 && x < n && y < n && (x + 0.5 - px) ** 2 + (y + 0.5 - py) ** 2 <= r * r) mask[y * n + x] = 1;
        }
      }
    }
  };
  for (const f of osmFeatures || []) {
    const t = f?.tags || {}; const g = f?.geometry;
    if (!Array.isArray(g) || g.length < 1 || g[0]?.lat == null) continue;
    const closed = g.length > 3 && g[0].lat === g[g.length - 1].lat && g[0].lng === g[g.length - 1].lng;
    const rings = () => [P2(g), ...((f.holes || []).filter(Array.isArray).map(P2))];
    if (f.type === 'building') { const h = buildingHeight(t); fill(bld, rings(), Number.isFinite(h) ? Math.max(h, 1.01) : 1); }
    else if (t.highway && g.length > 1 && !closed) { if (!isTunnel(t) && !FOOT.has(t.highway) && isBridge(t)) stroke(bridge, P2(g), 5 / cell); }
    else if (f.type === 'water' || t.natural === 'water' || t.waterway) { if (closed) fill(water, rings(), 1); else stroke(water, P2(g), 3 / cell); }
    else if (closed && (WOOD.has(t.natural) || WOOD.has(t.landuse))) fill(wood, rings(), 1);
  }
  return { bld, bridge, water, wood };
}

/**
 * The ground under surface objects, on the working grid. a: our heights (n x n), gedtm: GEDTM30 on the same grid,
 * m: rasterizeMapEvidence. Returns { out, stats } or null when our data reads as bare earth already.
 */
export function groundFromSurface(a, gedtm, m, n, cell) {
  const N = n * n;
  const land = new Uint8Array(N); for (let k = 0; k < N; k++) land[k] = a[k] > 0.5 && !m.water[k] && Number.isFinite(gedtm[k]) ? 1 : 0;
  const H = new Float32Array(N), C = new Float32Array(N);
  for (let k = 0; k < N; k++) { const b = m.bld[k]; H[k] = b > 1 ? b : b > 0 ? P.DEFAULT_H : (m.bridge[k] ? P.DECK_H : 0); C[k] = !b && m.wood[k] ? P.WOOD_H : 0; }
  const B = gauss(H, n, P.PSF_M / cell), T = gauss(C, n, P.PSF_M / cell);
  const Ba = gauss(H, n, P.APSF_M / cell), Ta = gauss(C, n, P.APSF_M / cell);
  const hp = (x) => { const lo = gauss(x, n, P.HP_M / cell); const o = new Float32Array(N); for (let k = 0; k < N; k++) o[k] = x[k] - lo[k]; return o; };
  // 1. map-wide fit (ours - GEDTM30) ~ offset + c B + g T, one robust reweighting pass
  const solve = (wts) => {
    const M = [[0, 0, 0], [0, 0, 0], [0, 0, 0]], v = [0, 0, 0];
    for (let k = 0; k < N; k += 3) { if (!land[k]) continue; const x = [1, B[k], T[k]], y = a[k] - gedtm[k], w = wts ? wts(y, x) : 1;
      for (let i = 0; i < 3; i++) { v[i] += w * x[i] * y; for (let j = 0; j < 3; j++) M[i][j] += w * x[i] * x[j]; } }
    for (let i = 1; i < 3; i++) M[i][i] += 1e-3 * (M[i][i] + 1);
    const det3 = (A) => A[0][0] * (A[1][1] * A[2][2] - A[1][2] * A[2][1]) - A[0][1] * (A[1][0] * A[2][2] - A[1][2] * A[2][0]) + A[0][2] * (A[1][0] * A[2][1] - A[1][1] * A[2][0]);
    const d = det3(M); if (!Number.isFinite(d) || Math.abs(d) < 1e-9) return null;
    return [0, 1, 2].map((c) => det3(M.map((row, i) => row.map((val, j) => (j === c ? v[i] : val)))) / d);
  };
  let sol = solve(null); if (!sol) return null;
  const s0 = sol; sol = solve((y, x) => { const r = Math.abs(y - s0[0] - s0[1] * x[1] - s0[2] * x[2]); return r < 3 ? 1 : 3 / r; }) || s0;
  const [off, dsmSlope] = sol;
  const dsmGate = clip01((dsmSlope - P.SLOPE_LO) / (P.SLOPE_HI - P.SLOPE_LO));
  if (dsmGate <= 0) return { out: null, stats: { dsmSlope, dsmGate, applied: false } };
  // 2. where GEDTM30 becomes the base
  const Dr = new Float32Array(N); for (let k = 0; k < N; k++) Dr[k] = land[k] ? a[k] - gedtm[k] - off : 0;
  const D = gauss(Dr, n, P.D_SMOOTH_M / cell);
  const mw = gauss(Float32Array.from(land), n, P.FIT_M / cell);
  const cen = (x) => { const t = new Float32Array(N); for (let k = 0; k < N; k++) t[k] = land[k] ? x[k] : 0; const mx = gauss(t, n, P.FIT_M / cell); const o = new Float32Array(N); for (let k = 0; k < N; k++) o[k] = x[k] - mx[k] / Math.max(mw[k], 1e-6); return o; };
  const fd = localFit(cen(D), cen(B), cen(T), land, n, P.FIT_M / cell);
  // 3. what GEDTM30 still holds of the buildings and woods
  const gFilled = new Float32Array(N); for (let k = 0; k < N; k++) gFilled[k] = Number.isFinite(gedtm[k]) ? gedtm[k] : a[k] - off;
  const fg = localFit(hp(gFilled), hp(B), hp(T), land, n, P.FIT_M / cell);
  const out = new Float32Array(N); let maxCut = 0, sumCut = 0, cut = 0;
  for (let k = 0; k < N; k++) {
    if (!(a[k] > 0.5) || !Number.isFinite(gedtm[k])) { out[k] = a[k]; continue; }
    const wG = clip01((fd.r[k] - P.D_LO) / (P.D_HI - P.D_LO));
    const base = a[k] + wG * (gedtm[k] + off - a[k]);
    const confG = clip01((fg.r[k] - P.R_LO) / (P.R_HI - P.R_LO));
    const cg = Math.min(P.C_MAX, Math.max(0, fg.b1[k])) * confG * P.K_G, gg = Math.min(P.G_MAX, Math.max(0, fg.b2[k])) * confG * P.K_G;
    out[k] = Math.min(a[k] + P.RAISE_M, base - wG * (cg * Ba[k] + gg * Ta[k]));
  }
  // 4. the opening where buildings stand: faded out within half a window of the map edge (no data past it: a
  // slope's edge rows would be cut), and never deeper than the buildings there explain (a hill beside a district
  // is not a block)
  const op = openingGround(a, n, cell);
  const bw = gauss(Float32Array.from(H, (h) => (h > 0 ? 1 : 0)), n, 120 / cell);
  const edgeCells = Math.max(1, P.WINDOW_M / 2 / cell);
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const k = y * n + x;
    if (op[k] < out[k] && a[k] > 0.5) {
      const edge = clip01(Math.min(x, y, n - 1 - x, n - 1 - y) / edgeCells);
      const drop = Math.min(out[k] - op[k], P.OPEN_EXPLAIN_K * Ba[k] + P.OPEN_EXPLAIN_ADD);
      out[k] -= Math.min(1, bw[k] / 0.25) * P.K_OPEN * dsmGate * edge * Math.max(0, drop);
    }
    const d = a[k] - out[k]; if (d > 0.5) { cut++; sumCut += d; if (d > maxCut) maxCut = d; }
  }
  return { out, stats: { dsmSlope, dsmGate, applied: true, cellsLowered: cut, share: cut / N, meanCut: cut ? sumCut / cut : 0, maxCut } };
}

/**
 * In place on the full heightmap (row 0 north, width x height at mpp metres). fetchGedtm(bounds, n) -> Float32Array.
 * Returns stats ({ applied, reason?, ... }).
 */
export async function removeSurfaceObjects({ heightMap, width, height, bounds, metersPerPixel, osmFeatures, fetchGedtm, fetchCopernicus = null, signal }) {
  const sizeM = Math.max(width, height) * metersPerPixel;
  const cell = Math.max(P.CELL_MIN_M, sizeM / P.MAX_CELLS);
  const n = Math.max(16, Math.round(sizeM / cell));
  let gedtm;
  try { gedtm = await fetchGedtm(bounds, n, { signal }); } catch (e) { if (signal?.aborted) throw e; return { applied: false, reason: 'gedtm_unavailable' }; }
  // our heights on the working grid (block means)
  const a = new Float32Array(n * n);
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const px0 = Math.floor((x / n) * width), px1 = Math.max(px0 + 1, Math.floor(((x + 1) / n) * width));
    const py0 = Math.floor((y / n) * height), py1 = Math.max(py0 + 1, Math.floor(((y + 1) / n) * height));
    let s = 0, c = 0;
    for (let py = py0; py < py1; py++) for (let px = px0; px < px1; px++) { const v = heightMap[py * width + px]; if (v > -1000) { s += v; c++; } }
    a[y * n + x] = c ? s / c : NaN;
  }
  const m = rasterizeMapEvidence(osmFeatures, bounds, n, cell);
  const res = groundFromSurface(a, gedtm, m, n, cell);
  if (!res) return { applied: false, reason: 'no_fit' };
  if (!res.out) return { ...res.stats, applied: false, reason: 'bare_earth_already' };
  // Copernicus GLO-30 through the same filter, averaged in by the rooftop gate (two radar models with partly
  // independent errors; measured: roads 4.97 -> 4.78 m, bare ground 3.56 -> 3.11 m, under bridges 4.65 -> 4.24 m)
  let copMixed = false;
  if (fetchCopernicus) {
    let cop = null;
    try { cop = await fetchCopernicus(bounds, n, { signal }); } catch (e) { if (signal?.aborted) throw e; }
    if (cop) {
      const c = new Float32Array(n * n); for (let k = 0; k < n * n; k++) c[k] = Number.isFinite(cop[k]) ? cop[k] : a[k];
      const rc = groundFromSurface(c, gedtm, m, n, cell);
      const co = rc?.out || c;
      const d = []; for (let k = 0; k < n * n; k += 7) if (Number.isFinite(co[k]) && Number.isFinite(res.out[k])) d.push(res.out[k] - co[k]);
      d.sort((p, q) => p - q); const off = d.length ? d[d.length >> 1] : 0;
      const w = 0.5 * res.stats.dsmGate;
      for (let k = 0; k < n * n; k++) if (Number.isFinite(co[k]) && Number.isFinite(res.out[k])) res.out[k] = res.out[k] * (1 - w) + (co[k] + off) * w;
      copMixed = true;
    }
  }
  // the correction, bilinear onto the full grid
  const c = new Float32Array(n * n); for (let k = 0; k < n * n; k++) c[k] = Number.isFinite(res.out[k]) && Number.isFinite(a[k]) ? res.out[k] - a[k] : 0;
  for (let py = 0; py < height; py++) {
    const fy = Math.min(n - 1, Math.max(0, ((py + 0.5) / height) * n - 0.5)); const j = Math.min(n - 2, Math.floor(fy)), v = fy - j;
    for (let px = 0; px < width; px++) {
      const i0 = heightMap[py * width + px]; if (!(i0 > -1000)) continue;
      const fx = Math.min(n - 1, Math.max(0, ((px + 0.5) / width) * n - 0.5)); const i = Math.min(n - 2, Math.floor(fx)), u = fx - i;
      const d = (c[j * n + i] * (1 - u) + c[j * n + i + 1] * u) * (1 - v) + (c[(j + 1) * n + i] * (1 - u) + c[(j + 1) * n + i + 1] * u) * v;
      heightMap[py * width + px] = i0 + d;
    }
  }
  return { ...res.stats, copMixed, cell, n };
}
