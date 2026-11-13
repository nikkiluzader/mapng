// The elevation sources' quality report: how well each source's ground holds
// the roads of one small square, as numbers, one score and a few drawings, in
// a page of its own that opens anywhere (no script libraries, no network).
//
// What is measured, along every drivable road of the square, every STEP_M:
//   bench   on a hillside (the ground falling across the road), is there a
//           level strip a road's width under the mapped line? A road is cut
//           into its hill as a bench; a source that holds it gives a road
//           that sits right with no shaping (benchWidths.js reads the same).
//   tilt    how far the ground leans across the lanes (a road is level across).
//   bumps   what is left of the heights along the centre line once the
//           road's own run is taken out (a moving average): ripple a car feels.
//   detail  the source's own resolution.
// A score out of 100 weighs them (bench most, where the square has hillside
// roads at all). Pure but for nothing: heights and roads in, numbers and one
// HTML string out; the hillshade pictures come from the caller (a canvas).

const STEP_M = 2;
const DRIVABLE = new Set(['motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'unclassified', 'residential', 'living_street', 'service', 'track',
  'motorway_link', 'trunk_link', 'primary_link', 'secondary_link', 'tertiary_link', 'road', 'busway']);
const TILT_HALF_M = 2.5;
const HILL_REACH_M = 16;
const HILL_MIN_SLOPE = 0.08;
const BENCH_SEARCH_M = 6;
const BENCH_REACH_M = 10;
const BENCH_LEVEL_M = 0.25;
const BENCH_CROSSFALL = 0.03;
const BENCH_MIN_M = 3;           // a level strip at least a lane wide ...
const BENCH_MAX_M = 16;          // ... and not simply flat ground
const BENCH_FLATTER = 2.5;        // ... and leaning at least this many times less than its hillside
const BUMP_WINDOW_M = 12;
const MIN_HILL_STATIONS = 15;
const MIN_HILL_SHARE = 0.1;
const SECTION_HALF_M = 15;

const clamp01 = (v) => Math.max(0, Math.min(1, v));
const median = (a) => { if (!a.length) return NaN; const s = [...a].sort((p, q) => p - q); return s[s.length >> 1]; };
const quantile = (a, q) => { if (!a.length) return NaN; const s = [...a].sort((p, r) => p - r); return s[Math.min(s.length - 1, Math.floor(s.length * q))]; };

/** Bilinear height at x (east), y (south) metres from the patch's north-west corner; NaN off it or on no-data. */
export function heightSampler(heights, px, cellM) {
  return (x, y) => {
    const gx = x / cellM - 0.5; const gy = y / cellM - 0.5;
    if (!(gx >= 0 && gy >= 0 && gx <= px - 1 && gy <= px - 1)) return NaN;
    const x0 = Math.min(px - 2, Math.floor(gx)); const y0 = Math.min(px - 2, Math.floor(gy));
    const u = gx - x0; const v = gy - y0; const i = y0 * px + x0;
    const a = heights[i]; const b = heights[i + 1]; const c = heights[i + px]; const d = heights[i + px + 1];
    if (!Number.isFinite(a) || !Number.isFinite(b) || !Number.isFinite(c) || !Number.isFinite(d)) return NaN;
    return (a * (1 - u) + b * u) * (1 - v) + (c * (1 - u) + d * u) * v;
  };
}

/** OSM road features (lat/lng) as lines in the patch's metres: [{ name, highway, pts: [[x, y]...] }]. */
export function roadsInPatch(features, center, sideM) {
  const dLat = sideM / 2 / 111320; const dLng = dLat / Math.cos((center.lat * Math.PI) / 180);
  const out = [];
  for (const f of features || []) {
    const t = f?.tags || {};
    if (f?.type !== 'road' || !DRIVABLE.has(t.highway) || !(f.geometry?.length >= 2)) continue;
    if ((t.bridge && t.bridge !== 'no') || (t.tunnel && t.tunnel !== 'no') || t.area === 'yes') continue;
    const pts = f.geometry.map((p) => [((p.lng - (center.lng - dLng)) / (2 * dLng)) * sideM, (((center.lat + dLat) - p.lat) / (2 * dLat)) * sideM]);
    if (!pts.some(([x, y]) => x >= 0 && y >= 0 && x <= sideM && y <= sideM)) continue;
    out.push({ name: t.name || t.ref || t.highway, highway: t.highway, pts });
  }
  return out;
}

// stations every STEP_M along a line: [{ x, y, nx, ny, s }]
function stationsOf(pts) {
  const out = []; let run = 0; let next = 0;
  for (let i = 1; i < pts.length; i++) {
    const [ax, ay] = pts[i - 1]; const [bx, by] = pts[i];
    const L = Math.hypot(bx - ax, by - ay);
    if (!(L > 1e-6)) continue;
    const tx = (bx - ax) / L; const ty = (by - ay) / L;
    for (; next <= run + L; next += STEP_M) out.push({ x: ax + tx * (next - run), y: ay + ty * (next - run), nx: -ty, ny: tx, s: next });
    run += L;
  }
  return out;
}

/**
 * One source's ground under the square's roads.
 * heights: px x px (row 0 north), cellM metres a cell; roads from roadsInPatch.
 * Returns the measures and, per road, its stations with their readings.
 */
export function measureSource(heights, px, cellM, roads, { hillAt = null } = {}) {
  const at = heightSampler(heights, px, cellM);
  // (which stations are on a hillside: by the reference source's ground where one is given, so every source is asked
  // for a bench at the same places)
  const hillSampler = hillAt || at;
  const tilts = []; const benches = []; const residuals = [];
  let stations = 0; let hill = 0; let benchFound = 0;
  const perRoad = [];
  for (const road of roads) {
    const st = stationsOf(road.pts).map((p) => ({ ...p, z: at(p.x, p.y) })).filter((p) => Number.isFinite(p.z));
    if (st.length < 4) continue;
    // bumps: the centre line less its own moving average
    const w = Math.max(1, Math.round(BUMP_WINDOW_M / STEP_M / 2));
    st.forEach((p, i) => {
      // (only where the stations run on unbroken: a gap in the data is no bump)
      let sum = 0; let n = 0;
      for (let k = Math.max(0, i - w); k <= Math.min(st.length - 1, i + w); k++) { if (Math.abs(st[k].s - p.s) <= w * STEP_M + 1e-6) { sum += st[k].z; n++; } }
      p.res = i >= w && i < st.length - w && n === 2 * w + 1 ? p.z - sum / n : NaN;
      if (Number.isFinite(p.res)) residuals.push(p.res);
      const zl = at(p.x + p.nx * TILT_HALF_M, p.y + p.ny * TILT_HALF_M); const zr = at(p.x - p.nx * TILT_HALF_M, p.y - p.ny * TILT_HALF_M);
      p.tilt = Number.isFinite(zl) && Number.isFinite(zr) ? Math.abs(zl - zr) / (2 * TILT_HALF_M) : NaN;
      if (Number.isFinite(p.tilt)) tilts.push(p.tilt);
      stations++;
      const hl = hillSampler(p.x + p.nx * HILL_REACH_M, p.y + p.ny * HILL_REACH_M); const hr = hillSampler(p.x - p.nx * HILL_REACH_M, p.y - p.ny * HILL_REACH_M);
      p.cross = Number.isFinite(hl) && Number.isFinite(hr) ? Math.abs(hl - hr) / (2 * HILL_REACH_M) : NaN;
      if (!(p.cross >= HILL_MIN_SLOPE)) return;
      hill++;
      let best = 0;
      for (let o = -BENCH_SEARCH_M; o <= BENCH_SEARCH_M + 1e-9; o += 1) {
        const z0 = at(p.x + p.nx * o, p.y + p.ny * o);
        if (!Number.isFinite(z0)) continue;
        let half = 0;
        for (let u = 0.5; u <= BENCH_REACH_M; u += 0.5) {
          const tol = BENCH_LEVEL_M + BENCH_CROSSFALL * u;
          const zp = at(p.x + p.nx * (o + u), p.y + p.ny * (o + u)); const zm = at(p.x + p.nx * (o - u), p.y + p.ny * (o - u));
          if (!(Math.abs(zp - z0) < tol) || !(Math.abs(zm - z0) < tol)) break;
          half = u;
        }
        if (2 * half <= best) continue;
        // (a bench is flatter than its hill: on a gentle, even slope every strip is "level" within
        // the tolerance, and a 30 m source with no road in it at all scored half its hillside as benches)
        const zp = at(p.x + p.nx * (o + half), p.y + p.ny * (o + half)); const zm = at(p.x + p.nx * (o - half), p.y + p.ny * (o - half));
        if (half > 0 && Math.abs(zp - zm) / (2 * half) > p.cross / BENCH_FLATTER) continue;
        best = 2 * half;
      }
      p.bench = best;
      if (best >= BENCH_MIN_M && best <= BENCH_MAX_M) { benchFound++; benches.push(best); }
    });
    perRoad.push({ name: road.name, highway: road.highway, stations: st });
  }
  let nodata = 0; for (let i = 0; i < heights.length; i++) if (!Number.isFinite(heights[i])) nodata++;
  // (the usual ripple, robustly: 1.4826 x the median of the residuals' sizes, a
  // normal spread's sigma. A plain root mean square is one wall or one seam
  // crossed: 27 cm on a road whose ripple is 2 cm everywhere else)
  const rms = residuals.length ? 1.4826 * median(residuals.map(Math.abs)) : NaN;
  const worst = residuals.length ? quantile(residuals.map(Math.abs), 0.98) : NaN;
  return {
    stations, hillStations: hill,
    tiltMedian: median(tilts), tiltP90: quantile(tilts, 0.9),
    bumpRmsM: rms, bumpWorstM: worst,
    benchShare: hill ? benchFound / hill : NaN, benchMedianM: median(benches),
    coverage: 1 - nodata / heights.length,
    roads: perRoad,
  };
}

// ── The ground itself ───────────────────────────────────────────────────────
// What a source's heights are like with no road in the picture: how fine the
// detail in them really is (a source can hand out coarse data on a fine grid:
// GPXZ's 1 m grid over Sint Eustatius is 30 m data in flat blocks, and scored
// 100 for detail and 99 overall), and their flaws: terraces, straight seam
// lines where pieces of a survey meet (alxti: "GPXZ has a bunch of weird grid
// lines"), spikes and pits, noise on flat ground.
const CURVE_EPS_M = 0.003;        // a second difference under this: the ground runs straight on
const FLAT_EPS_M = 0.002;         // a step under this to a neighbour: level
const WATER_SHARE = 0.15;         // one height over this share of the square: water, left out of the run lengths
const TERRACE_FLAT_SHARE = 0.4;   // this much dead-level ground with steps between: terraces
const TERRACE_STEP_M = 0.15;
const SEAM_RATIO = 5;             // a row or column whose crease is this many times the usual one ...
const SEAM_MIN_M = 0.02;          // ... and at least this much: a seam
const SEAM_ALONG_SHARE = 0.8;     // ... at this share of its points, all the way across
const SPIKE_M = 0.5;              // a point this far over or under all eight neighbours: a spike or a pit
const NOISE_SLOPE = 0.08;         // noise is read on ground gentler than this

/**
 * The ground's own measures: { effectiveResM, flatShare, terraced, seams: { rows, cols, count },
 * spikesPerHa, noiseM, coverage }. effectiveResM: the usual length over which the ground runs
 * straight (no curvature), in metres: the grid's own step for a real fine survey, the coarse
 * step for coarse data resampled onto a fine grid, the block's width for terraces.
 */
export function measureGround(heights, px, cellM) {
  const z = (r, c) => heights[r * px + c];
  const ok = (v) => Number.isFinite(v);
  let valid = 0;
  // the commonest height (to the centimetre): open water when it covers much of the square
  const counts = new Map();
  for (let i = 0; i < px * px; i++) { const v = heights[i]; if (!ok(v)) continue; valid++; const k = Math.round(v * 100); counts.set(k, (counts.get(k) || 0) + 1); }
  let waterK = null; let top = 0;
  for (const [k, n] of counts) if (n > top) { top = n; waterK = k; }
  if (!(valid > 0 && top / valid > WATER_SHARE)) waterK = null;
  const isWater = (v) => waterK !== null && Math.round(v * 100) === waterK;
  // run lengths of "no curvature", along rows and along columns, weighted by length
  const runHist = new Float64Array(px + 1);
  const addRuns = (get) => {
    for (let a = 0; a < px; a++) {
      let run = 0;
      for (let b = 1; b < px - 1; b++) {
        const p0 = get(a, b - 1); const p1 = get(a, b); const p2 = get(a, b + 1);
        const straight = ok(p0) && ok(p1) && ok(p2) && !isWater(p1) && Math.abs(p0 - 2 * p1 + p2) < CURVE_EPS_M;
        if (straight) run++;
        else { if (run > 0) runHist[Math.min(px, run + 2)] += run + 2; else if (ok(p1) && !isWater(p1)) runHist[1] += 1; run = 0; }
      }
      if (run > 0) runHist[Math.min(px, run + 2)] += run + 2;
    }
  };
  addRuns((a, b) => z(a, b)); addRuns((a, b) => z(b, a));
  let total = 0; for (let k = 1; k <= px; k++) total += runHist[k];
  let acc = 0; let runCells = 1;
  for (let k = 1; k <= px && total > 0; k++) { acc += runHist[k]; if (acc >= total / 2) { runCells = k; break; } }
  const effectiveResM = Math.max(cellM, runCells * cellM);
  // level ground, steps, spikes and noise
  let land = 0; let flat = 0; let spikes = 0; const steps = []; const resid = [];
  for (let r = 1; r < px - 1; r++) for (let c = 1; c < px - 1; c++) {
    const v = z(r, c); if (!ok(v) || isWater(v)) continue;
    const e = z(r, c + 1); const w = z(r, c - 1); const n = z(r - 1, c); const s2 = z(r + 1, c);
    if (!ok(e) || !ok(w) || !ok(n) || !ok(s2)) continue;
    land++;
    const dx = Math.abs(e - v); const dy = Math.abs(s2 - v);
    if (dx < FLAT_EPS_M && dy < FLAT_EPS_M && Math.abs(v - w) < FLAT_EPS_M && Math.abs(v - n) < FLAT_EPS_M) flat++;
    else if ((land & 7) === 0) steps.push(Math.max(dx, dy));
    let hi = -Infinity; let lo = Infinity;
    for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) { if (!dr && !dc) continue; const q = z(r + dr, c + dc); if (ok(q)) { if (q > hi) hi = q; if (q < lo) lo = q; } }
    if (v > hi + SPIKE_M || v < lo - SPIKE_M) spikes++;
    if (Math.abs(e - w) / (2 * cellM) < NOISE_SLOPE && Math.abs(s2 - n) / (2 * cellM) < NOISE_SLOPE && (land & 3) === 0) resid.push(Math.abs(v - (e + w + n + s2) / 4));
  }
  const flatShare = land ? flat / land : 0;
  const terraced = flatShare > TERRACE_FLAT_SHARE && steps.length > 20 && quantile(steps, 0.95) > TERRACE_STEP_M;
  const noiseM = resid.length > 50 ? 1.4826 * median(resid) : NaN;
  // seams: a whole row (or column) creased far more than the others. Not read on terraces: steps are everywhere there.
  const seamsOf = (get) => {
    const crease = new Float64Array(px);
    for (let a = 1; a < px - 1; a++) {
      let sum = 0; let n = 0;
      for (let b = 0; b < px; b += 2) { const p0 = get(a - 1, b); const p1 = get(a, b); const p2 = get(a + 1, b); if (ok(p0) && ok(p1) && ok(p2) && !isWater(p1)) { sum += Math.abs(p0 - 2 * p1 + p2); n++; } }
      crease[a] = n > px / 8 ? sum / n : NaN;
    }
    const usual = median([...crease].filter(Number.isFinite));
    const found = [];
    const mark = Math.max(SEAM_MIN_M / 2, 3 * Math.max(usual, 1e-4));
    for (let a = 1; a < px - 1; a++) {
      if (!(crease[a] > SEAM_MIN_M && crease[a] > SEAM_RATIO * Math.max(usual, 1e-4))) continue;
      // (a seam runs the whole way across, creased at nearly every point of it, and is a line, not a band:
      // a street or a wall along the grid's own direction is creased here and there, and is metres wide)
      let hit = 0; let n = 0;
      for (let b = 0; b < px; b++) { const p0 = get(a - 1, b); const p1 = get(a, b); const p2 = get(a + 1, b); if (ok(p0) && ok(p1) && ok(p2)) { n++; if (Math.abs(p0 - 2 * p1 + p2) > mark) hit++; } }
      if (!(n > px / 2 && hit / n >= SEAM_ALONG_SHARE)) continue;
      const wide = (k) => k >= 1 && k < px - 1 && crease[k] > SEAM_RATIO * Math.max(usual, 1e-4);
      if (wide(a - 3) || wide(a + 3)) continue;
      // (one seam, not each of the two rows it shows in)
      if (found.length && a - found[found.length - 1] <= 2) continue;
      found.push(a);
    }
    return found;
  };
  const rows = terraced ? [] : seamsOf((a, b) => z(a, b));
  const cols = terraced ? [] : seamsOf((a, b) => z(b, a));
  const ha = (land * cellM * cellM) / 10000;
  return {
    effectiveResM, flatShare, terraced, seams: { rows: rows.map((a) => a * cellM), cols: cols.map((a) => a * cellM), count: rows.length + cols.length },
    spikesPerHa: ha > 0 ? spikes / ha : 0, noiseM, coverage: valid / (px * px), water: waterK !== null,
  };
}

/** What is wrong with a source's ground, in words: [] when nothing is. */
export function flawsOf(g) {
  if (!g) return [];
  const out = [];
  if (g.terraced) out.push(`Terraced: flat blocks about ${Math.round(g.effectiveResM)} m wide with steps between them (${Math.round(g.flatShare * 100)} % of the ground is dead level). Coarse data on a fine grid.`);
  if (g.seams.count) out.push(`${g.seams.count} straight seam line${g.seams.count === 1 ? '' : 's'} across the square (where pieces of the survey meet).`);
  if (g.spikesPerHa >= 1) out.push(`Spikes and pits: about ${Math.round(g.spikesPerHa)} per hectare.`);
  if (g.noiseM > 0.08) out.push(`Noisy on gentle ground: about ${Math.round(g.noiseM * 100)} cm of grain.`);
  return out;
}

/** How free of flaws a ground is, out of 100. */
export function cleanScore(g) {
  if (!g) return NaN;
  let v = 100;
  if (g.terraced) v -= 70;
  v -= Math.min(40, g.seams.count * 8);
  v -= Math.min(30, g.spikesPerHa * 3);
  if (g.noiseM > 0.05) v -= 30 * clamp01((g.noiseM - 0.05) / 0.25);
  return Math.max(0, Math.round(v));
}

/** Scores out of 100 for one source's measures: { bench, tilt, bumps, detail, clean, total, weights }. */
export function scoreSource(m, nativeResM, g = null) {
  const tilt = Number.isFinite(m.tiltMedian) ? 100 * clamp01(1 - (m.tiltMedian - 0.02) / 0.18) : NaN;
  const bumps = Number.isFinite(m.bumpRmsM) ? 100 * clamp01(1 - (m.bumpRmsM - 0.01) / 0.11) : NaN;
  // (the detail that is in the data: a fine grid of coarse data counts as coarse)
  // (measured up to 30 m: past that a flat town reads as coarse as the square is wide)
  const stated = Number.isFinite(nativeResM) ? nativeResM : 0;
  const res = g && Number.isFinite(g.effectiveResM) ? Math.max(stated, Math.min(g.effectiveResM, Math.max(30, stated))) : nativeResM;
  const detail = Number.isFinite(res) ? 100 * clamp01(1 - Math.log(Math.max(1, res)) / Math.log(30)) : NaN;
  const clean = cleanScore(g);
  // (benches count where a fair part of the square's roads is on hillsides: a few embankment points in a flat town are no hillside roads)
  const hasBench = m.hillStations >= Math.max(MIN_HILL_STATIONS, MIN_HILL_SHARE * m.stations) && Number.isFinite(m.benchShare);
  const bench = hasBench ? 100 * m.benchShare : NaN;
  // (no roads in the square: the ground alone, its detail and its flaws)
  const roads = m.stations > 0;
  const weights = !roads ? { bench: 0, tilt: 0, bumps: 0, detail: 0.5, clean: 0.5 }
    : hasBench ? { bench: 0.35, tilt: 0.2, bumps: 0.15, detail: 0.15, clean: 0.15 } : { bench: 0, tilt: 0.3, bumps: 0.25, detail: 0.2, clean: 0.25 };
  const parts = { bench, tilt, bumps, detail, clean };
  let sum = 0; let wsum = 0;
  for (const k of Object.keys(weights)) if (Number.isFinite(parts[k]) && weights[k] > 0) { sum += parts[k] * weights[k]; wsum += weights[k]; }
  return { ...parts, total: wsum > 0 && (roads || g) ? Math.round(sum / wsum) : NaN, weights, roads, resM: res };
}

// The cross-section to draw: the station where the ground falls most across a
// road (read on the finest source), each source's ground from one side to the other.
function pickSection(sources, sideM) {
  const fine = sources.filter((s) => s.m).sort((a, b) => a.nativeResM - b.nativeResM)[0];
  if (!fine) return null;
  let best = null;
  for (const road of fine.m.roads) {
    for (const p of road.stations) {
      const margin = SECTION_HALF_M + 2;
      if (!(p.x > margin && p.y > margin && p.x < sideM - margin && p.y < sideM - margin)) continue;
      if (!best || (p.cross || 0) > (best.p.cross || 0)) best = { p, road };
    }
  }
  if (!best) return null;
  const { p, road } = best;
  const series = sources.filter((s) => s.heights).map((s) => {
    const at = heightSampler(s.heights, s.px, s.cellM);
    const pts = [];
    // (each source from its own height at the centre line: the sources' datums differ by metres, the shape is what is compared)
    const z0 = at(p.x, p.y);
    for (let o = -SECTION_HALF_M; o <= SECTION_HALF_M + 1e-9; o += 0.5) { const z = at(p.x + p.nx * o, p.y + p.ny * o); if (Number.isFinite(z) && Number.isFinite(z0)) pts.push([o, z - z0]); }
    return { key: s.key, label: s.label, pts };
  });
  return { road: road.name, x: p.x, y: p.y, nx: p.nx, ny: p.ny, series };
}

// The long section: the longest road of the square, each source's heights along it.
function pickLongSection(sources, roads) {
  const withLength = roads.map((r) => ({ r, st: stationsOf(r.pts) })).sort((a, b) => b.st.length - a.st.length)[0];
  if (!withLength || withLength.st.length < 10) return null;
  const series = sources.filter((s) => s.heights).map((s) => {
    const at = heightSampler(s.heights, s.px, s.cellM);
    return { key: s.key, label: s.label, pts: withLength.st.map((p) => [p.s, at(p.x, p.y)]).filter(([, z]) => Number.isFinite(z)) };
  });
  return { road: withLength.r.name, series };
}

/**
 * The whole comparison: sources [{ key, label, detail, nativeResM, heights, px, cellM, image, note }]
 * (heights null: not available here), roads from roadsInPatch.
 * Returns { sources: [... + m, score], best, verdict, section, long }.
 */
export function compareSources(sources, roads, sideM) {
  // the hillsides as the finest source has them, for every source alike
  const ref = sources.filter((s) => s.heights && Number.isFinite(s.nativeResM)).sort((a, b) => a.nativeResM - b.nativeResM)[0];
  const hillAt = ref ? heightSampler(ref.heights, ref.px, ref.cellM) : null;
  const rows = sources.map((s) => {
    if (!s.heights) return { ...s, m: null, score: null };
    const m = measureSource(s.heights, s.px, s.cellM, roads, { hillAt });
    const g = measureGround(s.heights, s.px, s.cellM);
    return { ...s, m, g, flaws: flawsOf(g), score: scoreSource(m, s.nativeResM, g) };
  });
  const scored = rows.filter((r) => Number.isFinite(r.score?.total)).sort((a, b) => b.score.total - a.score.total);
  const best = scored[0] || null;
  let verdict = 'Nothing to measure in this square.';
  const noRoads = best && !best.score.roads;
  if (noRoads) {
    const second = scored[1];
    const lead = 'No roads in this square, so the sources are compared on their ground alone (detail and flaws).';
    verdict = !second ? `${lead} ${best.label} is the only one measured.`
      : best.score.total - second.score.total < 5 ? `${lead} ${best.label} and ${second.label} are about equal.`
        : `${lead} ${best.label} has the best ground here (${best.score.total} of 100, against ${second.score.total} for ${second.label}).`;
  } else if (best) {
    const second = scored[1];
    const word = best.score.total >= 80 ? 'Roads sit well on this ground with little shaping.'
      : best.score.total >= 55 ? 'Roads will need some shaping (Ready terrain) to sit right.'
        : 'Roads will lean and bump unless the terrain is shaped for them (Ready terrain).';
    if (!second) verdict = `${best.label} is the only source measured here. ${word}`;
    else if (best.score.total - second.score.total < 5) verdict = `${best.label} and ${second.label} are about equal for roads here. ${word}`;
    else verdict = `${best.label} holds the roads best here (${best.score.total} of 100, against ${second.score.total} for ${second.label}). ${word}`;
  }
  // (a flaw worth saying of the one that came out on top)
  if (best?.flaws?.length) verdict += ` Note: ${best.label} has flaws here (see below).`;
  // (best: every source within 5 points of the top one)
  const bestKeys = best ? scored.filter((r) => best.score.total - r.score.total < 5).map((r) => r.key) : [];
  return { sources: rows, best: best?.key || null, bestKeys, verdict, section: pickSection(rows, sideM), long: pickLongSection(rows, roads) };
}

// ── the page ────────────────────────────────────────────────────────────────

const esc = (v) => String(v ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const SERIES = { standard: 1, mapterhorn: 2, gpxz: 3, usgs: 4, kron86: 4 };
const fmt = (v, d = 0) => (Number.isFinite(v) ? v.toFixed(d) : 'n/a');

// a line chart of series [{ key, label, pts: [[x, y]...] }], one y axis, direct labels at the line ends
function lineChart(series, { width = 720, height = 260, xLabel, yLabel, band = null, id }) {
  const all = series.flatMap((s) => s.pts);
  if (!all.length) return '<p class="muted">Nothing to draw here.</p>';
  const x0 = Math.min(...all.map((p) => p[0])); const x1 = Math.max(...all.map((p) => p[0]));
  let y0 = Math.min(...all.map((p) => p[1])); let y1 = Math.max(...all.map((p) => p[1]));
  const pad = Math.max(0.5, (y1 - y0) * 0.08); y0 -= pad; y1 += pad;
  const L = 52; const R = 96; const T = 12; const B = 36;
  const X = (x) => L + ((x - x0) / (x1 - x0 || 1)) * (width - L - R); const Y = (y) => T + (1 - (y - y0) / (y1 - y0 || 1)) * (height - T - B);
  const ticks = (a, b, n) => { const step = (b - a) / n; const mag = 10 ** Math.floor(Math.log10(step)); const nice = [1, 2, 5, 10].map((k) => k * mag).find((k) => k >= step) || step; const out = []; for (let v = Math.ceil(a / nice) * nice; v <= b + 1e-9; v += nice) out.push(v); return out; };
  let g = '';
  for (const v of ticks(y0, y1, 4)) g += `<line class="grid" x1="${L}" x2="${width - R}" y1="${Y(v).toFixed(1)}" y2="${Y(v).toFixed(1)}"/><text class="tick" x="${L - 6}" y="${(Y(v) + 4).toFixed(1)}" text-anchor="end">${+v.toFixed(2)}</text>`;
  for (const v of ticks(x0, x1, 6)) g += `<text class="tick" x="${X(v).toFixed(1)}" y="${height - B + 16}" text-anchor="middle">${+v.toFixed(1)}</text>`;
  if (band) g += `<rect class="band" x="${X(band[0]).toFixed(1)}" y="${T}" width="${(X(band[1]) - X(band[0])).toFixed(1)}" height="${height - T - B}"/><text class="tick" x="${X((band[0] + band[1]) / 2).toFixed(1)}" y="${T + 12}" text-anchor="middle">${esc(band[2])}</text>`;
  // direct labels, kept apart where the lines end close together
  const ends = series.filter((s) => s.pts.length).map((s) => ({ s, y: Y(s.pts[s.pts.length - 1][1]) })).sort((a, b) => a.y - b.y);
  for (let i = 1; i < ends.length; i++) if (ends[i].y - ends[i - 1].y < 14) ends[i].y = ends[i - 1].y + 14;
  for (const s of series) {
    if (!s.pts.length) continue;
    g += `<polyline class="line s${SERIES[s.key] || 1}" points="${s.pts.map((p) => `${X(p[0]).toFixed(1)},${Y(p[1]).toFixed(1)}`).join(' ')}"/>`;
  }
  for (const e of ends) g += `<circle class="dot s${SERIES[e.s.key] || 1}" cx="${width - R + 8}" cy="${(e.y).toFixed(1)}" r="4"/><text class="label" x="${width - R + 16}" y="${(e.y + 4).toFixed(1)}">${esc(e.s.label)}</text>`;
  g += `<text class="axis" x="${(L + width - R) / 2}" y="${height - 4}" text-anchor="middle">${esc(xLabel)}</text><text class="axis" transform="translate(12 ${(T + height - B) / 2}) rotate(-90)" text-anchor="middle">${esc(yLabel)}</text>`;
  g += `<line class="cross" x1="0" x2="0" y1="${T}" y2="${height - B}" visibility="hidden"/>`;
  const data = { x0, x1, L, R, width, series: series.map((s) => ({ label: s.label, pts: s.pts.map((p) => [+p[0].toFixed(1), +p[1].toFixed(2)]) })) };
  return `<div class="chart" id="${id}"><svg viewBox="0 0 ${width} ${height}" role="img" aria-label="${esc(yLabel)} against ${esc(xLabel)}">${g}</svg><div class="tip" hidden></div><script type="application/json">${JSON.stringify(data)}</script></div>`;
}

const bar = (value, cls) => (Number.isFinite(value)
  ? `<span class="bar"><span class="fill ${cls}" style="width:${Math.max(2, Math.round(value))}%"></span></span><span class="num">${Math.round(value)}</span>`
  : '<span class="muted">not measured</span>');

// the square with its roads over a source's hillshade, each road stretch coloured by how far the ground leans across it
function roadMap(src, sideM) {
  const img = src.image ? `<image href="${src.image}" x="0" y="0" width="${sideM}" height="${sideM}" preserveAspectRatio="none"/>` : `<rect width="${sideM}" height="${sideM}" class="nodata"/>`;
  let lines = '';
  for (const road of src.m?.roads || []) {
    for (let i = 1; i < road.stations.length; i++) {
      const a = road.stations[i - 1]; const b = road.stations[i];
      if (b.s - a.s > 2 * STEP_M) continue;
      const cls = !Number.isFinite(b.tilt) ? 'q0' : b.tilt <= 0.05 ? 'q1' : b.tilt <= 0.12 ? 'q2' : 'q3';
      lines += `<line class="${cls}" x1="${a.x.toFixed(1)}" y1="${a.y.toFixed(1)}" x2="${b.x.toFixed(1)}" y2="${b.y.toFixed(1)}"/>`;
    }
  }
  return `<svg class="map" viewBox="0 0 ${sideM} ${sideM}" role="img" aria-label="${esc(src.label)}: hillshade with the roads">${img}${lines}</svg>`;
}

/**
 * The report page (one self-contained HTML string).
 * result from compareSources; meta { center, sideM, appVersion, generatedAt, roadCount, osmSource }.
 */
// The line under a source's name: the detail measured in its data ("~1 m", "~30 m: coarse data on a 1 m grid"),
// then what the source's own line added (free; a count of calls is left to the table).
function cardLine(s) {
  const res = s.score?.resM;
  if (!Number.isFinite(res)) return s.detail || '';
  const shown = res < 10 ? res.toFixed(1).replace(/\.0$/, '') : String(Math.round(res));
  const coarse = Number.isFinite(s.nativeResM) && res > Math.max(3, s.nativeResM * 3) ? `: coarse data on a ${s.nativeResM < 10 ? s.nativeResM.toFixed(1).replace(/\.0$/, '') : Math.round(s.nativeResM)} m grid` : '';
  const tail = String(s.detail || '').replace(/^~[\d.,]+\s*m\s*(·\s*)?/, '').trim();
  const extra = tail && !/call/i.test(tail) ? ` · ${tail}` : '';
  return `~${shown} m${coarse}${extra}`;
}

export function qualityReportHtml(result, meta) {
  const { sources, verdict, section, long } = result;
  const measured = sources.filter((s) => s.m);
  const hero = sources.map((s) => `
    <div class="tile${result.bestKeys.includes(s.key) ? ' best' : ''}">
      <div class="name"><span class="sw s${SERIES[s.key] || 1}"></span>${esc(s.label)}${result.bestKeys.includes(s.key) ? ` <span class="badge">${result.bestKeys.length > 1 ? 'equal best' : 'best here'}</span>` : ''}</div>
      <div class="score">${Number.isFinite(s.score?.total) ? s.score.total : '–'}<small>${Number.isFinite(s.score?.total) ? ' / 100' : ''}</small></div>
      <div class="muted">${esc(s.m ? cardLine(s) : s.note || 'not available here')}</div>
    </div>`).join('');
  const maps = sources.map((s) => `<figure>${roadMap(s, meta.sideM)}<figcaption><b>${esc(s.label)}</b> ${esc(s.m ? cardLine(s) : s.note || '')}</figcaption></figure>`).join('');
  const parts = [
    ['bench', 'Road bench', 'On hillsides: is there a level strip a road wide where the map says the road is? This matters most.'],
    ['tilt', 'Level across', 'How little the ground leans across the lanes.'],
    ['bumps', 'Smooth along', 'How little the ground ripples along the road.'],
    ['detail', 'Detail', 'How fine the detail in the data really is, measured in the heights themselves: a fine grid filled with coarse data counts as coarse.'],
    ['clean', 'Free of flaws', 'Terraces, straight seam lines, spikes and pits, noise: see the list below.'],
  ];
  const partRows = parts.map(([k, name, what]) => `<tr><th scope="row">${name}<div class="muted">${what}</div></th>${sources.map((s) => `<td>${s.score ? bar(s.score[k], `s${SERIES[s.key] || 1}`) : '<span class="muted">–</span>'}</td>`).join('')}</tr>`).join('');
  const row = (name, f) => `<tr><th scope="row">${name}</th>${sources.map((s) => `<td>${s.m ? f(s) : '–'}</td>`).join('')}</tr>`;
  const anyBench = measured.some((s) => s.score?.weights.bench > 0);
  const noRoadsHere = measured.length > 0 && measured.every((s) => !s.score?.roads);
  const flawList = measured.map((s) => `<li><b><span class="sw s${SERIES[s.key] || 1}"></span> ${esc(s.label)}:</b> ${s.flaws?.length ? s.flaws.map(esc).join(' ') : 'none found.'}</li>`).join('');
  const details = [
    row('Resolution the source states', (s) => `${fmt(s.nativeResM, s.nativeResM < 10 ? 1 : 0)} m`),
    row('Detail measured in the data', (s) => (!s.g ? 'n/a' : s.g.effectiveResM > 30 ? '30 m or coarser (or the ground is simply even)' : `${fmt(s.g.effectiveResM, s.g.effectiveResM < 10 ? 1 : 0)} m`)),
    row('Ground that is dead level', (s) => (s.g ? `${fmt(100 * s.g.flatShare)} %${s.g.water ? ' (water left out)' : ''}` : 'n/a')),
    row('Straight seam lines', (s) => (s.g ? String(s.g.seams.count) : 'n/a')),
    row('Spikes and pits per hectare', (s) => (s.g ? fmt(s.g.spikesPerHa, 1) : 'n/a')),
    row('Grain on gentle ground', (s) => (s.g && Number.isFinite(s.g.noiseM) ? `${fmt(100 * s.g.noiseM, 1)} cm` : 'n/a')),
    row('Road points measured (every 2 m)', (s) => String(s.m.stations)),
    row('… of them on a hillside', (s) => String(s.m.hillStations)),
    row('Hillside points with a road bench', (s) => (s.m.hillStations ? `${fmt(100 * s.m.benchShare)} %` : 'n/a')),
    row('Usual bench width', (s) => (Number.isFinite(s.m.benchMedianM) ? `${fmt(s.m.benchMedianM, 1)} m` : 'n/a')),
    row('Lean across the lanes, usual', (s) => `${fmt(100 * s.m.tiltMedian, 1)} %`),
    row('Lean across the lanes, worst tenth', (s) => `${fmt(100 * s.m.tiltP90, 1)} %`),
    row('Ripple along the road, usual', (s) => `${fmt(100 * s.m.bumpRmsM, 1)} cm`),
    row('Ripple along the road, worst places', (s) => `${fmt(100 * s.m.bumpWorstM, 1)} cm`),
    row('Square covered by the source', (s) => `${fmt(100 * s.m.coverage)} %`),
  ].join('');
  const km = (meta.sideM / 1000).toFixed(meta.sideM % 1000 ? 2 : 0);
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Elevation source quality: ${esc(meta.center.lat.toFixed(4))}, ${esc(meta.center.lng.toFixed(4))}</title>
<style>
:root{--bg:#f7f6f2;--card:#fff;--ink:#1c1c1a;--ink2:#55544e;--line:#dedcd3;--s1:#2a78d6;--s2:#eb6834;--s3:#1baf7a;--s4:#8a56c8;--good:#008300;--warn:#b97700;--bad:#c9302c}
@media (prefers-color-scheme:dark){:root{--bg:#1a1a19;--card:#242422;--ink:#f0efec;--ink2:#c3c2b7;--line:#3a3a36;--s1:#3987e5;--s2:#d95926;--s3:#199e70;--s4:#a37be0;--good:#3fae3f;--warn:#e0a020;--bad:#e66767}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.5 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
main{max-width:980px;margin:0 auto;padding:24px 16px 48px}h1{font-size:24px;margin:0 0 4px}h2{font-size:18px;margin:32px 0 8px}
.muted{color:var(--ink2);font-size:13px;font-weight:400}.verdict{font-size:17px;margin:16px 0;padding:14px 16px;background:var(--card);border:1px solid var(--line);border-left:4px solid var(--ink);border-radius:8px}
.tiles{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:12px}.tile{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:14px}
.tile.best{border-color:var(--ink)}.tile .name{font-weight:600;display:flex;align-items:center;gap:6px;flex-wrap:wrap}.tile .score{font-size:44px;font-weight:700;line-height:1.1;margin:6px 0 2px}.tile .score small{font-size:15px;font-weight:400;color:var(--ink2)}
.badge{font-size:11px;font-weight:600;border:1px solid var(--ink);border-radius:99px;padding:0 7px}.sw{display:inline-block;width:10px;height:10px;border-radius:2px}
.sw.s1,.fill.s1{background:var(--s1)}.sw.s2,.fill.s2{background:var(--s2)}.sw.s3,.fill.s3{background:var(--s3)}.sw.s4,.fill.s4{background:var(--s4)}
.maps{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:12px}figure{margin:0}figcaption{font-size:13px;color:var(--ink2);margin-top:4px}figcaption b{color:var(--ink)}
svg.map{width:100%;height:auto;border-radius:8px;border:1px solid var(--line);display:block;background:#888}svg.map line{stroke-width:5;stroke-linecap:round}
.q0{stroke:#9a9a94}.q1{stroke:#1e9e3c}.q2{stroke:#f0b000}.q3{stroke:#e23b36}.nodata{fill:var(--line)}
.key{display:flex;gap:14px;flex-wrap:wrap;font-size:13px;color:var(--ink2);margin:8px 0}.key i{display:inline-block;width:18px;height:5px;border-radius:3px;vertical-align:middle;margin-right:5px}
ul.flaws{list-style:none;padding:0;margin:8px 0;display:grid;gap:8px}ul.flaws li{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:10px 12px}
.wrap{overflow-x:auto;background:var(--card);border:1px solid var(--line);border-radius:10px}table{border-collapse:collapse;width:100%;min-width:560px}th,td{padding:9px 12px;text-align:left;border-top:1px solid var(--line);vertical-align:middle;font-variant-numeric:tabular-nums}
thead th{border-top:0;font-size:13px}tbody th{font-weight:600;width:34%}.bar{display:inline-block;width:110px;height:10px;background:var(--line);border-radius:5px;vertical-align:middle;margin-right:8px;overflow:hidden}.fill{display:block;height:100%;border-radius:5px}.num{font-weight:600}
.chart{position:relative;background:var(--card);border:1px solid var(--line);border-radius:10px;padding:8px}.chart svg{width:100%;height:auto;display:block}
.grid{stroke:var(--line);stroke-width:1}.tick,.axis{fill:var(--ink2);font-size:11px}.label{fill:var(--ink);font-size:12px}.line{fill:none;stroke-width:2;stroke-linejoin:round}
.line.s1{stroke:var(--s1)}.line.s2{stroke:var(--s2)}.line.s3{stroke:var(--s3)}.line.s4{stroke:var(--s4)}.dot.s1{fill:var(--s1)}.dot.s2{fill:var(--s2)}.dot.s3{fill:var(--s3)}.dot.s4{fill:var(--s4)}.band{fill:var(--ink);opacity:.07}.cross{stroke:var(--ink2);stroke-width:1}
.tip{position:absolute;top:8px;pointer-events:none;background:var(--card);border:1px solid var(--line);border-radius:6px;padding:6px 8px;font-size:12px;box-shadow:0 2px 8px #0003;white-space:nowrap}
details{margin-top:12px}summary{cursor:pointer;font-weight:600}footer{margin-top:32px;font-size:12px;color:var(--ink2)}
</style></head><body><main>
<h1>Elevation source quality report</h1>
<div class="muted">A ${km} km square at ${esc(meta.center.lat.toFixed(5))}, ${esc(meta.center.lng.toFixed(5))} · ${esc(String(meta.roadCount))} road${meta.roadCount === 1 ? '' : 's'} measured · made ${esc(meta.generatedAt)} with MapNG ${esc(meta.appVersion || '')}</div>
<p class="verdict">${esc(verdict)}</p>
<div class="tiles">${hero}</div>
<p class="muted">The score has three parts: how well each source's ground already holds the roads of this square before MapNG shapes anything, how fine the detail in its data really is, and how free of flaws it is. A low roads part is not bad terrain, it is terrain that needs shaping under roads.</p>

<h2>The ground, with the roads on it</h2>
<div class="maps">${maps}</div>
<div class="key"><span><i style="background:#1e9e3c"></i>road lies level across (under 5 %)</span><span><i style="background:#f0b000"></i>leans (5 to 12 %)</span><span><i style="background:#e23b36"></i>leans a lot (over 12 %)</span><span><i style="background:#9a9a94"></i>no data</span></div>

<h2>What the score is made of</h2>
<div class="wrap"><table><thead><tr><th></th>${sources.map((s) => `<th><span class="sw s${SERIES[s.key] || 1}"></span> ${esc(s.label)}</th>`).join('')}</tr></thead><tbody>${partRows}</tbody></table></div>
<p class="muted">${noRoadsHere ? 'No roads were measured in this square: the score is detail 50 %, free of flaws 50 %.' : anyBench ? 'Weights: road bench 35 %, level across 20 %, smooth along 15 %, detail 15 %, free of flaws 15 %.' : 'This square has too few hillside roads to look for benches, so the score is level across 30 %, smooth along 25 %, detail 20 %, free of flaws 25 %.'} A coarse source is smooth along a road because it holds no detail at all, so read "smooth along" together with "level across".</p>

<h2>Flaws in the ground</h2>
<ul class="flaws">${flawList}</ul>
<p class="muted">Read from the heights alone, roads or not. Terraces and seam lines show in the pictures above as flat blocks and straight lines.</p>

${section ? `<h2>Across one road: ${esc(section.road)}</h2>
<p class="muted">The ground from one side of the road to the other, where it crosses the steepest hillside in the square. A source that holds the road shows a flat step at the middle; one that does not shows a plain slope.</p>
${lineChart(section.series, { xLabel: 'metres across the road (0 = the mapped centre line)', yLabel: 'height from the centre line, m', band: [-3.5, 3.5, 'road'], id: 'c1' })}` : ''}

${long ? `<h2>Along one road: ${esc(long.road)}</h2>
<p class="muted">Heights along the longest road in the square. Lines that agree mean the sources agree; a jagged line is ripple a car would feel on unshaped terrain.</p>
${lineChart(long.series, { xLabel: 'metres along the road', yLabel: 'height, m', id: 'c2' })}` : ''}

<h2>The numbers</h2>
<div class="wrap"><table><thead><tr><th></th>${sources.map((s) => `<th>${esc(s.label)}</th>`).join('')}</tr></thead><tbody>${details}</tbody></table></div>
<details><summary>How this is measured</summary>
<p class="muted">Every drivable road in the square (bridges and tunnels left out) is walked in 2 m steps on each source's heights, resampled to 1 m. <b>Road bench</b>: where the ground falls more than 8 % across the road (read on the finest source, so every source is asked at the same places), the widest strip within 6 m of the mapped line that stays level (25 cm, plus 3 % crossfall) is found; a strip 3 to 16 m wide counts as a bench. <b>Level across</b>: the height difference 2.5 m either side of the line, as a slope; 2 % or less scores 100, 20 % scores 0. <b>Smooth along</b>: what is left of the centre line's heights after a 12 m moving average, as its usual size (a robust spread, so one wall or seam does not decide it); 1 cm scores 100, 12 cm scores 0. <b>Detail</b>: the source's own resolution on a log scale, 1 m scores 100, 30 m scores 0. The total is the weighted mean of the parts that could be measured. The map data's position is taken as true: where a mapped road is drawn a few metres off, a real bench is missed on every source alike.</p></details>
<footer>Map data © OpenStreetMap contributors${meta.osmSource ? ` (${esc(meta.osmSource)})` : ''}. Elevation: global 30 m from AWS Terrain Tiles (Mapzen, with its sources); lidar from Mapterhorn and its open-data sources (mapterhorn.com/attribution); GPXZ where shown. This page holds no script from elsewhere and loads nothing.</footer>
</main>
<script>
for (const el of document.querySelectorAll('.chart')) {
  const d = JSON.parse(el.querySelector('script').textContent); const svg = el.querySelector('svg'); const tip = el.querySelector('.tip'); const cross = el.querySelector('.cross');
  const move = (ev) => {
    const r = svg.getBoundingClientRect(); const vx = ((ev.clientX - r.left) / r.width) * d.width;
    if (vx < d.L || vx > d.width - d.R) { tip.hidden = true; cross.setAttribute('visibility', 'hidden'); return; }
    const x = d.x0 + ((vx - d.L) / (d.width - d.L - d.R)) * (d.x1 - d.x0);
    const rows = d.series.map((s) => { let b = null; for (const p of s.pts) if (!b || Math.abs(p[0] - x) < Math.abs(b[0] - x)) b = p; return b ? s.label + ': ' + b[1].toFixed(2) + ' m' : ''; }).filter(Boolean);
    tip.innerHTML = '<b>' + x.toFixed(1) + ' m</b><br>' + rows.join('<br>'); tip.hidden = false;
    tip.style.left = Math.min(r.width - 170, Math.max(8, ev.clientX - r.left + 12)) + 'px';
    cross.setAttribute('x1', vx); cross.setAttribute('x2', vx); cross.setAttribute('visibility', 'visible');
  };
  svg.addEventListener('pointermove', move); svg.addEventListener('pointerleave', () => { tip.hidden = true; cross.setAttribute('visibility', 'hidden'); });
}
</script></body></html>`;
}
