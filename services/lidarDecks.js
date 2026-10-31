// Measured bridge heights from US lidar (USGS 3DEP point clouds as Entwine
// Point Tiles on AWS: CORS *, laszip, Web Mercator). Plan: refs/output/
// earth-detail-plan.md, phase C.
//
// The deck heights the solver infers from the ground and the crossings are a
// guess; the survey measured them. Along every bridge way the octree nodes
// holding its line at road height are read (the two deepest levels: a few
// points per m²), the points brought into the level's frame, and per station
// the surfaces within the deck's half width found: the drivable one taken by
// its rank over the ground (a ramp over a ramp takes its own level: OSM's
// layer order), cleaned of jumps the road can't make, and handed to the
// solver as pins (the mechanism tunnels and simple spans use). The survey's
// vertical datum against our elevation data comes from its ground points
// beside the bridges (offset; metres or feet by the fit). Nothing here knows
// about any place; fetch and the laz decoder are passed in.

const R_MERC = 6378137;
export const toMercator = (lat, lng) => [(lng * Math.PI / 180) * R_MERC, Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI / 180) / 2)) * R_MERC];
export const fromMercator = (x, y) => [(2 * Math.atan(Math.exp(y / R_MERC)) - Math.PI / 2) * 180 / Math.PI, (x / R_MERC) * 180 / Math.PI];

const EPT_BASE = 'https://s3-us-west-2.amazonaws.com/usgs-lidar-public';
const CLS_GROUND = 2;
const CLS_NOISE = new Set([7, 18]);   // low / high noise; class 17 (bridge deck) is kept but never trusted alone
const FEET = 0.3048;

/**
 * The datasets covering a point, newest first (the year in the name, else
 * last). index: [{ name, bbox: [w, s, e, n] }] (lng/lat).
 */
export function datasetsAt(index, lat, lng) {
  const year = (n) => Number((String(n).match(/(19|20)\d\d/g) || []).map(Number).sort().at(-1) || 0);
  return index
    .filter((d) => lng >= d.bbox[0] && lng <= d.bbox[2] && lat >= d.bbox[1] && lat <= d.bbox[3])
    .sort((a, b) => year(b.name) - year(a.name));
}

/** A LAZ (EPT node) buffer decoded with a laz-perf instance: { x, y, z: Float64Array, cls: Uint8Array }. */
export function decodeLaz(bytes, lp) {
  const buf = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const fmt = buf[104] & 0x3f;
  const sx = dv.getFloat64(131, true); const sy = dv.getFloat64(139, true); const sz = dv.getFloat64(147, true);
  const ox = dv.getFloat64(155, true); const oy = dv.getFloat64(163, true); const oz = dv.getFloat64(171, true);
  const clsOff = fmt >= 6 ? 16 : 15;
  const fp = lp._malloc(buf.length);
  lp.HEAPU8.set(buf, fp);
  const dec = new lp.LASZip();
  try {
    dec.open(fp, buf.length);
    const n = dec.getCount();
    const pp = lp._malloc(dec.getPointLength());
    const x = new Float64Array(n); const y = new Float64Array(n); const z = new Float64Array(n); const cls = new Uint8Array(n);
    for (let i = 0; i < n; i++) {
      dec.getPoint(pp);
      const h32 = lp.HEAP32; const h8 = lp.HEAPU8;
      x[i] = h32[pp >> 2] * sx + ox; y[i] = h32[(pp >> 2) + 1] * sy + oy; z[i] = h32[(pp >> 2) + 2] * sz + oz;
      cls[i] = (fmt >= 6 ? h8[pp + clsOff] : h8[pp + clsOff] & 0x1f);
    }
    lp._free(pp);
    return { x, y, z, cls };
  } finally {
    dec.delete();
    lp._free(fp);
  }
}

/**
 * The octree nodes holding the given Mercator points at heights zRange
 * ([lo, hi], the survey's units), the deepest `levels` levels on each path.
 * ept: the dataset's ept.json; getJson(path), relative to the dataset.
 * Returns node keys.
 */
export async function nodesAlong(ept, getJson, points, zRange, { levels = 1 } = {}) {
  const [x0, y0, z0, x1] = ept.bounds; const size = x1 - x0;
  const hier = new Map();
  const loaded = new Set();
  const page = async (key) => {
    if (loaded.has(key)) return;
    loaded.add(key);
    const h = await getJson(`ept-hierarchy/${key}.json`);
    for (const [k, v] of Object.entries(h || {})) hier.set(k, v);
  };
  const count = async (key) => {
    let v = hier.get(key);
    if (v === -1) { await page(key); v = hier.get(key); }
    return v || 0;
  };
  await page('0-0-0-0');
  const keys = new Set();
  for (const [mx, my] of points) {
    // down the octree: every child cube holding (mx, my) within the height band
    const byDepth = [];
    let frontier = (await count('0-0-0-0')) ? ['0-0-0-0'] : [];
    while (frontier.length) {
      byDepth.push(frontier);
      const next = [];
      for (const key of frontier) {
        const [d, x, y, z] = key.split('-').map(Number);
        const c = size / 2 ** (d + 1);
        const cx = Math.floor((mx - x0) / c) - 2 * x; const cy = Math.floor((my - y0) / c) - 2 * y;
        if (cx < 0 || cx > 1 || cy < 0 || cy > 1) continue;
        for (const dz of [0, 1]) {
          const zz0 = z0 + (2 * z + dz) * c;
          if (zz0 > zRange[1] || zz0 + c < zRange[0]) continue;
          const k = `${d + 1}-${2 * x + cx}-${2 * y + cy}-${2 * z + dz}`;
          if (await count(k)) next.push(k);
        }
      }
      frontier = next;
    }
    for (const level of byDepth.slice(-levels)) for (const k of level) keys.add(k);
  }
  return [...keys];
}

/**
 * Points in a grid of `cell` m for lookups by position, in the level's frame
 * (x, y local metres; z the survey's, raw). toLocal(mx, my) -> [x, y].
 */
export function pointGrid(clouds, toLocal, cell = 2) {
  const grid = new Map();
  let count = 0;
  for (const c of clouds) {
    for (let i = 0; i < c.x.length; i++) {
      if (CLS_NOISE.has(c.cls[i])) continue;
      const [x, y] = toLocal(c.x[i], c.y[i]);
      const key = `${Math.floor(x / cell)},${Math.floor(y / cell)}`;
      let b = grid.get(key);
      if (!b) { b = []; grid.set(key, b); }
      b.push(x, y, c.z[i], c.cls[i]);
      count++;
    }
  }
  const near = (x, y, r, fn) => {
    for (let gx = Math.floor((x - r) / cell); gx <= Math.floor((x + r) / cell); gx++) {
      for (let gy = Math.floor((y - r) / cell); gy <= Math.floor((y + r) / cell); gy++) {
        const b = grid.get(`${gx},${gy}`);
        if (!b) continue;
        for (let j = 0; j < b.length; j += 4) if (Math.hypot(b[j] - x, b[j + 1] - y) <= r) fn(b[j], b[j + 1], b[j + 2], b[j + 3]);
      }
    }
  };
  return { count, near, grid, cell };
}

/**
 * The survey's vertical frame against our elevation data from its ground
 * points (class 2) at `samples` ([[x, y]] local, off any bridge): z_ours =
 * z_survey * scale + offset, the scale metres (1) or feet (0.3048), whichever
 * leaves the smaller spread. demAt(x, y): our ground (world z). Returns
 * { scale, offset, spread, n } or null with too few points.
 */
export function fitDatum(grid, samples, demAt, { radius = 3, minPoints = 20 } = {}) {
  const pairs = [];
  for (const [x, y] of samples) {
    const zs = [];
    grid.near(x, y, radius, (px, py, pz, c) => { if (c === CLS_GROUND) zs.push(pz); });
    if (zs.length < 3) continue;
    zs.sort((a, b) => a - b);
    const d = demAt(x, y);
    if (Number.isFinite(d)) pairs.push([zs[zs.length >> 1], d]);
  }
  if (pairs.length < minPoints) return null;
  const fit = (scale) => {
    const off = pairs.map(([s, d]) => d - s * scale).sort((a, b) => a - b);
    const med = off[off.length >> 1];
    const dev = off.map((o) => Math.abs(o - med)).sort((a, b) => a - b);
    return { scale, offset: med, spread: dev[dev.length >> 1] * 1.4826, n: pairs.length };
  };
  const m = fit(1); const f = fit(FEET);
  return f.spread < m.spread * 0.7 ? f : m;
}

const STATION_M = 4;
const SURFACE_GAP_M = 1.2;     // points further apart in z than this are two surfaces
const MIN_SURFACE_PTS = 4;
const GROUND_BAND_M = 1.5;     // a surface this near our ground is the ground (a road under the deck, the water)

/**
 * The deck's measured profile along a line: per station of `line`
 * ([[x, y]...], local), the drivable surface within `half` m of it, in world
 * z (datum applied). rank: which surface over the ground (0 the lowest deck
 * surface: OSM layer order). groundAt(x, y): our ground. Returns per point
 * z or NaN, after removing jumps steeper than maxGrade between neighbours.
 */
export function deckProfile(grid, line, half, datum, groundAt, { rank = 0, maxGrade = 0.12, prior = null } = {}) {
  const out = new Float64Array(line.length).fill(NaN);
  for (let i = 0; i < line.length; i++) {
    const [x, y] = line[i];
    const zs = [];
    grid.near(x, y, Math.max(1.5, Math.min(half, 6)), (px, py, pz, c) => {
      if (c === CLS_GROUND) return;   // (the ground under the deck, never the deck)
      zs.push(pz * datum.scale + datum.offset);
    });
    if (zs.length < MIN_SURFACE_PTS) continue;
    zs.sort((a, b) => a - b);
    // surfaces: runs of points no further apart than SURFACE_GAP_M
    const surfaces = [];
    let run = [zs[0]];
    for (let j = 1; j < zs.length; j++) {
      if (zs[j] - zs[j - 1] > SURFACE_GAP_M) { surfaces.push(run); run = []; }
      run.push(zs[j]);
    }
    surfaces.push(run);
    const g = groundAt(x, y);
    // the top of each surface's points: a deck is the highest return of its slab (rails, cars under ~2 m
    // stand on it, not over it: their points sit in the same run when close, the run's lower quartile is
    // the road)
    const decks = surfaces
      .filter((s) => s.length >= MIN_SURFACE_PTS)
      .map((s) => s[Math.floor(s.length * 0.25)])
      .filter((z) => !(Number.isFinite(g) && z < g + GROUND_BAND_M));
    if (!decks.length) continue;
    let z;
    if (prior && Number.isFinite(prior[i])) z = decks.reduce((a, b) => (Math.abs(b - prior[i]) < Math.abs(a - prior[i]) ? b : a));
    else z = decks[Math.min(rank, decks.length - 1)];
    out[i] = z;
  }
  // continuity: a station off the median of its neighbours by more than the grade allows is dropped
  const s = [0]; for (let i = 1; i < line.length; i++) s.push(s[i - 1] + Math.hypot(line[i][0] - line[i - 1][0], line[i][1] - line[i - 1][1]));
  const clean = Float64Array.from(out);
  for (let i = 0; i < line.length; i++) {
    if (!Number.isFinite(out[i])) continue;
    const nb = [];
    for (let j = i - 1; j >= 0 && s[i] - s[j] <= 3 * STATION_M; j--) if (Number.isFinite(out[j])) nb.push([out[j], s[i] - s[j]]);
    for (let j = i + 1; j < line.length && s[j] - s[i] <= 3 * STATION_M; j++) if (Number.isFinite(out[j])) nb.push([out[j], s[j] - s[i]]);
    if (nb.length < 2) { clean[i] = NaN; continue; }
    const ok = nb.filter(([z, d]) => Math.abs(z - out[i]) <= maxGrade * d + 0.3).length;
    if (ok < nb.length / 2) clean[i] = NaN;
  }
  return longestDeck(clean, s, maxGrade);
}

// the deck along a profile: its measured stations split where they jump
// more steeply than maxGrade allows (a stretch seen through an open grating,
// or the machinery under it), the longest piece kept with every other piece
// in line with the kept ones; the rest NaN
function longestDeck(z, s, maxGrade) {
  const fits = (i, j) => Math.abs(z[j] - z[i]) <= maxGrade * Math.abs(s[j] - s[i]) + 0.3;
  const pieces = []; let prev = -1;
  for (let i = 0; i < z.length; i++) {
    if (!Number.isFinite(z[i])) continue;
    if (prev < 0 || !fits(prev, i)) pieces.push({ a: i, b: i });
    else pieces[pieces.length - 1].b = i;
    prev = i;
  }
  if (pieces.length < 2) return z;
  const len = (p) => s[p.b] - s[p.a];
  const main = pieces.reduce((a, b) => (len(b) > len(a) ? b : a));
  const keep = new Set([main]);
  // outward from the longest: a piece joins when it lines up with the nearest kept station
  const at = pieces.indexOf(main);
  for (let j = at + 1, last = main.b; j < pieces.length; j++) if (fits(last, pieces[j].a)) { keep.add(pieces[j]); last = pieces[j].b; }
  for (let j = at - 1, first = main.a; j >= 0; j--) if (fits(pieces[j].b, first)) { keep.add(pieces[j]); first = pieces[j].a; }
  const out = new Float64Array(z.length).fill(NaN);
  for (const p of keep) for (let i = p.a; i <= p.b; i++) out[i] = z[i];
  return out;
}

/**
 * Fetch and decode the survey along bridge lines. lines: [{ pts: [[x, y]],
 * half }] local; toGeo(x, y) -> [lat, lng]; zAbs: [lo, hi] world heights
 * (our frame plus minHeight, ~ the survey's metres) to look in; index: the
 * compact dataset list; fetchImpl, lp (laz-perf instance). Returns
 * { dataset, grid, nodes, bytes } or null.
 */
export async function fetchSurvey({ lines, toGeo, toLocal, zAbs, index, fetchImpl = fetch, lp, maxNodes = 400, onProgress = () => {}, exclude = [] }) {
  if (!lines.length) return null;
  const mid = lines[0].pts[Math.floor(lines[0].pts.length / 2)];
  const [lat, lng] = toGeo(mid[0], mid[1]);
  const candidates = datasetsAt(index, lat, lng);
  // (the index holds bounding boxes: several surveys may claim a place only one covers; one with no octree
  // nodes along the bridges costs a couple of small reads)
  for (const ds of candidates.filter((d) => !exclude.includes(d.name)).slice(0, 12)) {
    const base = `${EPT_BASE}/${ds.name}`;
    const getJson = async (p) => { const r = await fetchImpl(`${base}/${p}`); return r.ok ? r.json() : null; };
    const ept = await getJson('ept.json');
    if (!ept || ept.dataType !== 'laszip' || String(ept.srs?.horizontal) !== '3857') continue;
    const merc = [];
    for (const { pts } of lines) for (let i = 0; i < pts.length; i += 3) merc.push(toMercator(...toGeo(pts[i][0], pts[i][1])));
    // (heights in the survey's units unknown before the fit: a band wide enough for metres or feet)
    const band = [Math.min(zAbs[0], zAbs[0] / FEET) - 30, Math.max(zAbs[1], zAbs[1] / FEET) + 30];
    const keys = (await nodesAlong(ept, getJson, merc, band)).slice(0, maxNodes);
    if (!keys.length) continue;
    const clouds = []; let bytes = 0;
    for (let k = 0; k < keys.length; k++) {
      onProgress(k, keys.length);
      const r = await fetchImpl(`${base}/ept-data/${keys[k]}.laz`);
      if (!r.ok) continue;
      const buf = new Uint8Array(await r.arrayBuffer());
      bytes += buf.length;
      try { clouds.push(decodeLaz(buf, lp)); } catch { /* a node that fails to decode: skipped */ }
    }
    if (!clouds.length) continue;
    const grid = pointGrid(clouds, (mx, my) => toLocal(...fromMercator(mx, my)));
    if (grid.count < 1000) continue;
    return { dataset: ds.name, grid, nodes: keys.length, bytes };
  }
  return null;
}

const MIN_COVER = 0.6;         // a bridge measured at fewer of its stations keeps the inferred profile

/**
 * Pins for the structure solver from a survey: every bridge edge of the
 * graph (not a movable span: its survey caught it raised, or saw through its
 * grating) measured at MIN_COVER of its stations or more is pinned where it
 * was measured. A run of bridge edges left unpinned (a movable span, one the
 * survey barely saw) between two pinned ones is pinned on the straight line
 * between their ends: a closed bascule or lift span lies level with its
 * approaches, and the inferred profile would sag between measured
 * neighbours metres higher. survey: { grid, datum }; groundAtAbs(x, y): our
 * ground plus minHeight. Returns { pins: [[k, i, z]] (world z), bridges:
 * [{ k, wayId, stations, measured, pinned, meanLift, bridged }] }.
 */
export function lidarPins(graph, survey, groundAtAbs, minHeight) {
  const pins = []; const bridges = [];
  const measuredZ = new Map();   // edge -> its stations' measured z (NaN where not), pinned edges only
  graph.edges.forEach((e, k) => {
    if (!e.bridge || e.tunnel || e.external || e.s.length < 2) return;
    if (e.movable) { bridges.push({ k, wayId: e.wayId ?? null, stations: e.s.length, measured: 0, pinned: false, meanLift: null }); return; }
    const line = Array.from(e.s, (_, i) => [e.x[i], e.y[i]]);
    const z = deckProfile(survey.grid, line, e.half || 4, survey.datum, groundAtAbs, { rank: Math.max(0, (Number(e.layer) || 1) - 1) });
    let measured = 0; let lift = 0;
    for (let i = 0; i < z.length; i++) if (Number.isFinite(z[i])) { measured++; lift += z[i] - groundAtAbs(line[i][0], line[i][1]); }
    const pinned = measured >= MIN_COVER * z.length;
    if (pinned) {
      for (let i = 0; i < z.length; i++) if (Number.isFinite(z[i])) pins.push([k, i, z[i] - minHeight]);
      measuredZ.set(k, z);
    }
    bridges.push({ k, wayId: e.wayId ?? null, stations: z.length, measured, pinned, meanLift: measured ? lift / measured : null });
  });
  for (const b of bridgeUnpinnedRuns(graph, bridges, measuredZ)) pins.push(...b.map(([k, i, z]) => [k, i, z - minHeight]));
  return { pins, bridges };
}

// a pinned edge walked in from the end touching a node to its first
// measured station: { z, tail: [[k, i]] the unmeasured stations before it,
// in order from the node }, or null
function endZ(graph, k, end, measuredZ) {
  const z = measuredZ.get(k); const n = z.length; const tail = [];
  for (let j = 0; j < n; j++) {
    const i = end === 0 ? j : n - 1 - j;
    if (Number.isFinite(z[i])) return { z: z[i], tail };
    tail.push([k, i]);
  }
  return null;
}

// runs of unpinned bridge edges through nodes they pass straight through,
// each closed at both ends by a pinned bridge edge: [[k, i, zWorld]] per
// run, its stations on the straight line between the measured stations
// nearest it (the pinned edges' unmeasured ends included)
function bridgeUnpinnedRuns(graph, bridges, measuredZ) {
  const unpinned = new Set(bridges.filter((b) => !b.pinned).map((b) => b.k));
  if (!unpinned.size || !measuredZ.size || !graph.nodes) return [];
  const nodeOf = (id) => (graph.nodes.get ? graph.nodes.get(id) : graph.nodes[id]);
  const isBridge = (k) => { const e = graph.edges[k]; return e.bridge && !e.tunnel && !e.external; };
  const seen = new Set(); const out = [];
  for (const k0 of unpinned) {
    if (seen.has(k0)) continue;
    // walk both ways from k0: [k, forward] in order, and what closes each end
    const run = [[k0, true]]; seen.add(k0);
    const ends = [null, null];
    for (const dir of [0, 1]) {
      let k = k0; let node = dir === 0 ? graph.edges[k0].from : graph.edges[k0].to;
      for (;;) {
        const others = (nodeOf(node)?.edges || []).filter((r) => r.edge !== k && isBridge(r.edge));
        if (others.length !== 1) break;
        const { edge: next, end } = others[0];
        if (measuredZ.has(next)) { ends[dir] = endZ(graph, next, end, measuredZ); break; }
        if (!unpinned.has(next) || seen.has(next)) break;
        seen.add(next);
        const forward = dir === 0 ? end === 1 : end === 0;
        if (dir === 0) run.unshift([next, forward]); else run.push([next, forward]);
        k = next; node = end === 0 ? graph.edges[next].to : graph.edges[next].from;
      }
    }
    if (!ends[0] || !ends[1]) continue;
    // the stations in order, start to end: the first end's tail (walked back
    // toward its measured station), the run, the second end's tail
    const order = [...ends[0].tail.slice().reverse()];
    for (const [k, fwd] of run) { const n = graph.edges[k].s.length; for (let j = 0; j < n; j++) order.push([k, fwd ? j : n - 1 - j]); }
    order.push(...ends[1].tail);
    const dist = [0];
    for (let j = 1; j < order.length; j++) {
      const [k1, i1] = order[j - 1]; const [k2, i2] = order[j];
      dist.push(dist[j - 1] + Math.hypot(graph.edges[k2].x[i2] - graph.edges[k1].x[i1], graph.edges[k2].y[i2] - graph.edges[k1].y[i1]));
    }
    // (the measured stations sit one station step beyond each end)
    const step = (j) => (order.length > 1 ? dist[1] - dist[0] : 0) * j;
    const total = dist[dist.length - 1] + 2 * step(1);
    out.push(order.map(([k, i], j) => [k, i, ends[0].z + (ends[1].z - ends[0].z) * ((dist[j] + step(1)) / total)]));
    for (const [k] of run) { const b = bridges.find((x) => x.k === k); if (b) b.bridged = true; }
  }
  return out;
}

/**
 * Read the survey along the export's bridge ways and fit its datum: the
 * lookups lidarPins needs, or { skipped: reason }. bridgeLines: [{ pts }]
 * local; demAtAbs(x, y): our ground plus minHeight; zAbs: [lo, hi].
 * provider: { index (datasets), lp, fetchImpl }.
 */
export async function prepareSurvey({ bridgeLines, toGeo, toLocal, demAtAbs, zAbs, provider, onProgress }) {
  if (!bridgeLines.length) return { skipped: 'no bridges' };
  const mid = bridgeLines[0].pts[0];
  const [lat, lng] = toGeo(mid[0], mid[1]);
  if (!datasetsAt(provider.index, lat, lng).length) return { skipped: 'no survey here (USGS 3DEP covers the US)' };
  // (a dataset's index entry is its bounding box: one that doesn't reach the bridges, or can't be tied to the
  // terrain, gives way to the next)
  const samples = [];
  // (every station, 10 / 18 / 26 m off each way: a short bridge still finds its ground)
  for (const { pts } of bridgeLines) for (const [x, y] of pts) for (const r of [10, 18, 26]) for (const [dx, dy] of [[r, 0], [-r, 0], [0, r], [0, -r]]) samples.push([x + dx, y + dy]);
  const tried = []; let last = 'no survey points along the bridges';
  for (let attempt = 0; attempt < 4; attempt++) {
    const sv = await fetchSurvey({ lines: bridgeLines, toGeo, toLocal, zAbs, index: provider.index, fetchImpl: provider.fetchImpl, lp: provider.lp, onProgress, exclude: tried });
    if (!sv) break;
    tried.push(sv.dataset);
    const datum = fitDatum(sv.grid, samples, demAtAbs);
    if (!datum) { last = `too few ground points to tie the survey to the terrain (${tried.join(', ')})`; continue; }
    if (datum.spread > 0.5) { last = `the survey disagrees with the terrain by ${datum.spread.toFixed(2)} m (${sv.dataset})`; continue; }
    return { grid: sv.grid, datum, dataset: sv.dataset, nodes: sv.nodes, bytes: sv.bytes, points: sv.grid.count, tried };
  }
  return { skipped: last };
}

