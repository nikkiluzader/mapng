// Inland water for BeamNG exports: Rivers along waterway centrelines and
// WaterBlock tiles inside lakes, after BeamNG.Earth (MIT; server/riverlines.py,
// server/seatiles.py lake tiles, mod sea.lua's river look).
//
// What is water: rivers, streams and canals that run all year (no dry
// washes: intermittent / seasonal ones are left out, the desert's arroyos),
// never where they pass under a road (culverts), and lakes, ponds and
// reservoirs that hold water. Riverbank outlines (natural=water +
// water=river) are no water body of their own: they give the river its width.
//
// Rivers: ways that continue one another are chained (OSM draws waterways in
// the direction of flow), resampled, and each node's surface is the lowest
// ground in the channel, median-smoothed and never rising downstream, a hand
// above it; the width is measured across the riverbank outline where there
// is one, else by kind; a River never reaches within ROAD_MARGIN_M of a road
// and is cut where a road crosses it at grade.
//
// Lakes: WaterBlock rectangles covering a grid over the outline (cells mostly
// inside it), at the lake's level (the median ground inside: elevation models
// flatten water to its surface).
// Pure: callers pass world-space lookups.

export const RIVER_KINDS = {
  river: { spacing: 20, width: 12, flow: 2.0 },
  stream: { spacing: 10, width: 4, flow: 1.2 },
  canal: { spacing: 15, width: 8, flow: 0.5 },
};
const WIDTH_MAX_M = 600;
const WIDTH_STEP_M = 2;
const WIDTH_PAD = 1.05;
const CHANNEL_PROBE_M = 3;
const MEDIAN_N = 5;
const SMOOTH_N = 7;
const SURFACE_ABOVE_M = 0.25;
const DEPTH_M = [1, 8];
const ROAD_MARGIN_M = 1;
const RIVER_MIN_HALF_M = 1.5;
const MIN_PIECE_M = 15;
const LAKE_WATER = new Set(['lake', 'pond', 'reservoir', 'oxbow', 'lagoon', 'basin', 'stream_pool', 'moat', 'pool', 'yes']);
const RIVERBANK_WATER = new Set(['river', 'stream', 'canal', 'riverbank']);
const LAKE_CELL_M = [2, 32];
const LAKE_TILE_OVERLAP_M = 0.5;

const norm = (v) => String(v ?? '').trim().toLowerCase();
const isDry = (tags = {}) => ['yes', 'true', 'dry'].includes(norm(tags.intermittent)) || ['yes', 'true'].includes(norm(tags.seasonal))
  || norm(tags.water) === 'dry' || ['dry', 'intermittent'].includes(norm(tags.natural === 'water' ? tags.water_regime : ''));
const isUnderground = (tags = {}) => ['culvert', 'yes', 'flooded', 'building_passage'].includes(norm(tags.tunnel))
  || norm(tags.culvert) === 'yes' || norm(tags.location) === 'underground' || Number.parseInt(tags.layer ?? '0', 10) < 0;
const isClosed = (g) => g.length > 3 && g[0].lat === g[g.length - 1].lat && g[0].lng === g[g.length - 1].lng;

function pointInRing(x, y, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]; const [xj, yj] = ring[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
const bboxOf = (ring) => {
  let x0 = Infinity; let y0 = Infinity; let x1 = -Infinity; let y1 = -Infinity;
  for (const [x, y] of ring) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
  return [x0, y0, x1, y1];
};
// A polygon with holes as a point test.
const makePolygon = (outer, holes = []) => {
  const box = bboxOf(outer);
  return {
    outer, holes, box,
    contains: (x, y) => x >= box[0] && x <= box[2] && y >= box[1] && y <= box[3]
      && pointInRing(x, y, outer) && !holes.some((h) => pointInRing(x, y, h)),
  };
};

// Windows shrink symmetrically at the ends, so a line's ends stay put.
const windowAt = (v, i, n) => { const h = Math.min(n >> 1, i, v.length - 1 - i); return v.slice(i - h, i + h + 1); };
const runningMedian = (v, n) => v.map((_, i) => { const w = windowAt(v, i, n).sort((a, b) => a - b); return w[w.length >> 1]; });
const movingAverage = (v, n) => v.map((_, i) => { const w = windowAt(v, i, n); return w.reduce((a, b) => a + b, 0) / w.length; });

function resample(pts, step) {
  const out = [pts[0]];
  let carry = 0;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1]; const b = pts[i];
    const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
    let d = step - carry;
    while (d <= L) { out.push([a[0] + ((b[0] - a[0]) * d) / L, a[1] + ((b[1] - a[1]) * d) / L]); d += step; }
    carry = L - (d - step);
  }
  const last = pts[pts.length - 1];
  const tail = out[out.length - 1];
  if (Math.hypot(last[0] - tail[0], last[1] - tail[1]) > step * 0.3) out.push(last);
  else out[out.length - 1] = last;
  return out;
}

// Distance from (x, y) to the nearest road's edge (negative inside it).
function buildRoadEdgeDistance(roads, cell = 32) {
  const segs = [];
  const grid = new Map();
  for (const r of roads) {
    for (let i = 0; i + 1 < r.points.length; i++) {
      const a = r.points[i]; const b = r.points[i + 1];
      const k = segs.length;
      segs.push([a[0], a[1], b[0], b[1], r.half]);
      const reach = r.half + 40;
      for (let gx = Math.floor((Math.min(a[0], b[0]) - reach) / cell); gx <= Math.floor((Math.max(a[0], b[0]) + reach) / cell); gx++) {
        for (let gy = Math.floor((Math.min(a[1], b[1]) - reach) / cell); gy <= Math.floor((Math.max(a[1], b[1]) + reach) / cell); gy++) {
          const key = `${gx},${gy}`;
          if (!grid.has(key)) grid.set(key, []);
          grid.get(key).push(k);
        }
      }
    }
  }
  return (x, y) => {
    let best = Infinity;
    for (const k of grid.get(`${Math.floor(x / cell)},${Math.floor(y / cell)}`) || []) {
      const [ax, ay, bx, by, half] = segs[k];
      const sx = bx - ax; const sy = by - ay;
      const L2 = sx * sx + sy * sy || 1e-9;
      const f = Math.max(0, Math.min(1, ((x - ax) * sx + (y - ay) * sy) / L2));
      best = Math.min(best, Math.hypot(ax + sx * f - x, ay + sy * f - y) - half);
    }
    return best;
  };
}

/**
 * Rivers to draw: [{ kind, name, flow, nodes: [[x, y, z, width, depth]] }]
 * downstream, plus stats.
 *
 * @param {object} p
 * @param {Array} p.features     OSM features
 * @param {Function} p.toWorld   (lat, lng) -> [x, y]
 * @param {Function} p.heightAt  (x, y) -> ground height (relative to the terrain's minimum)
 * @param {Array} [p.roads]      ground roads [{ points: [[x, y]...], half }]
 */
export function planRivers({ features = [], toWorld, heightAt, roads = [] }) {
  const stats = { dry: 0, underground: 0, otherKinds: 0, chains: 0, pieces: 0, cutAtRoads: 0, widthFromOutline: 0 };
  const ways = [];
  for (const f of features) {
    if (f.type !== 'water' || !(f.geometry?.length > 1) || isClosed(f.geometry)) continue;
    const kind = norm(f.tags?.waterway);
    if (!kind) continue;
    if (!RIVER_KINDS[kind]) { stats.otherKinds++; continue; }
    if (isDry(f.tags)) { stats.dry++; continue; }
    if (isUnderground(f.tags)) { stats.underground++; continue; }
    ways.push({ kind, tags: f.tags || {}, pts: f.geometry.map((p) => toWorld(p.lat, p.lng)) });
  }
  // riverbank outlines for the widths
  const outlines = [];
  for (const f of features) {
    if (f.type !== 'water' || !(f.geometry?.length > 3) || !isClosed(f.geometry)) continue;
    const t = f.tags || {};
    if (!(RIVERBANK_WATER.has(norm(t.water)) || norm(t.waterway) === 'riverbank')) continue;
    outlines.push(makePolygon(f.geometry.map((p) => toWorld(p.lat, p.lng)), (f.holes || []).map((h) => h.map((p) => toWorld(p.lat, p.lng)))));
  }

  // chain: a way's end is the next one's start, and only those two meet there
  const key = (p) => `${Math.round(p[0] * 2)},${Math.round(p[1] * 2)}`;
  const touching = new Map();
  for (const w of ways) for (const p of [w.pts[0], w.pts[w.pts.length - 1]]) touching.set(key(p), (touching.get(key(p)) || 0) + 1);
  const byStart = new Map();
  for (const w of ways) {
    const k = key(w.pts[0]);
    if (!byStart.has(k)) byStart.set(k, []);
    byStart.get(k).push(w);
  }
  const used = new Set();
  const nextOf = (w) => {
    const k = key(w.pts[w.pts.length - 1]);
    const c = (byStart.get(k) || []).filter((o) => o !== w && o.kind === w.kind && !used.has(o));
    return touching.get(k) === 2 && c.length === 1 ? c[0] : null;
  };
  const hasPrev = new Set();
  for (const w of ways) { const n = nextOf(w); if (n) hasPrev.add(n); }
  const chains = [];
  for (const start of [...ways.filter((w) => !hasPrev.has(w)), ...ways]) {
    if (used.has(start)) continue;
    let w = start; const pts = [...start.pts]; used.add(start);
    for (let n = nextOf(w); n; n = nextOf(w)) { used.add(n); pts.push(...n.pts.slice(1)); w = n; }
    chains.push({ kind: start.kind, tags: start.tags, pts });
  }
  stats.chains = chains.length;

  const edgeDistance = buildRoadEdgeDistance(roads);
  const rivers = [];
  for (const chain of chains) {
    const spec = RIVER_KINDS[chain.kind];
    const pts = resample(chain.pts, spec.spacing);
    if (pts.length < 2) continue;
    const tangents = pts.map((_, i) => {
      const a = pts[Math.max(0, i - 1)]; const b = pts[Math.min(pts.length - 1, i + 1)];
      const L = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
      return [(b[0] - a[0]) / L, (b[1] - a[1]) / L];
    });
    // width across the outline, the node moved midway between its banks
    const tagged = Number.parseFloat(String(chain.tags.width ?? '').replace(',', '.'));
    let centres = pts.map((p) => [...p]);
    let widths = pts.map((p, i) => {
      const n = [-tangents[i][1], tangents[i][0]];
      const poly = outlines.find((o) => o.contains(p[0], p[1]));
      if (!poly) return Number.isFinite(tagged) && tagged > 0 ? tagged : spec.width;
      let dl = 0; let dr = 0;
      while (dl < WIDTH_MAX_M && poly.contains(p[0] + n[0] * (dl + WIDTH_STEP_M), p[1] + n[1] * (dl + WIDTH_STEP_M))) dl += WIDTH_STEP_M;
      while (dr < WIDTH_MAX_M && poly.contains(p[0] - n[0] * (dr + WIDTH_STEP_M), p[1] - n[1] * (dr + WIDTH_STEP_M))) dr += WIDTH_STEP_M;
      centres[i] = [p[0] + (n[0] * (dl - dr)) / 2, p[1] + (n[1] * (dl - dr)) / 2];
      stats.widthFromOutline++;
      return Math.max(spec.width * 0.5, (dl + dr + WIDTH_STEP_M) * WIDTH_PAD);
    });
    const xs = movingAverage(centres.map((c) => c[0]), SMOOTH_N);
    const ys = movingAverage(centres.map((c) => c[1]), SMOOTH_N);
    centres = xs.map((x, i) => [x, ys[i]]);
    widths = movingAverage(widths, SMOOTH_N);
    // surface: the lowest ground in the channel, never rising downstream
    const ground = centres.map(([x, y], i) => {
      const t = tangents[i]; const n = [-t[1], t[0]]; const r = CHANNEL_PROBE_M;
      return Math.min(heightAt(x, y), heightAt(x + n[0] * r, y + n[1] * r), heightAt(x - n[0] * r, y - n[1] * r),
        heightAt(x + t[0] * r, y + t[1] * r), heightAt(x - t[0] * r, y - t[1] * r));
    });
    const med = runningMedian(ground, MEDIAN_N);
    for (let i = 1; i < med.length; i++) med[i] = Math.min(med[i], med[i - 1]);
    // keep off the roads; cut where one crosses at grade
    let piece = [];
    const flush = () => {
      let L = 0;
      for (let k = 1; k < piece.length; k++) L += Math.hypot(piece[k][0] - piece[k - 1][0], piece[k][1] - piece[k - 1][1]);
      if (piece.length >= 2 && L >= MIN_PIECE_M) {
        rivers.push({ kind: chain.kind, name: chain.tags.name || null, flow: spec.flow, nodes: piece });
        stats.pieces++;
      }
      piece = [];
    };
    centres.forEach(([x, y], i) => {
      let edge = edgeDistance(x, y);
      if (i > 0) { // a road crossing between this node and the last
        const [px, py] = centres[i - 1];
        const steps = Math.ceil(Math.hypot(x - px, y - py) / 2);
        for (let k = 1; k < steps && edge >= ROAD_MARGIN_M; k++) edge = Math.min(edge, edgeDistance(px + ((x - px) * k) / steps, py + ((y - py) * k) / steps) + 0.5);
      }
      if (edge < ROAD_MARGIN_M) { if (piece.length) stats.cutAtRoads++; flush(); return; }
      const half = Math.max(RIVER_MIN_HALF_M, Math.min(widths[i] / 2, edge - ROAD_MARGIN_M));
      const width = 2 * half;
      piece.push([x, y, med[i] + SURFACE_ABOVE_M, width, Math.min(DEPTH_M[1], Math.max(DEPTH_M[0], width / 8))]);
    });
    flush();
  }
  return { rivers, stats };
}

/**
 * Lake tiles: [{ cx, cy, sx, sy, z, lake }] (WaterBlock rectangles, z the
 * water surface), plus stats.
 */
export function planLakes({ features = [], toWorld, heightAt }) {
  const tiles = [];
  const stats = { lakes: 0, dry: 0, tiles: 0 };
  let lakeIndex = 0;
  for (const f of features) {
    if (f.type !== 'water' || !(f.geometry?.length > 3) || !isClosed(f.geometry)) continue;
    const t = f.tags || {};
    if (t.waterway || RIVERBANK_WATER.has(norm(t.water))) continue;
    if (['sea', 'ocean'].includes(norm(t.place)) || norm(t.natural) === 'bay' || ['dock', 'harbour'].includes(norm(t.water)) || norm(t.leisure) === 'marina') continue;
    const isLake = norm(t.natural) === 'water' ? (!t.water || LAKE_WATER.has(norm(t.water))) : ['reservoir', 'basin'].includes(norm(t.landuse));
    if (!isLake) continue;
    if (isDry(t)) { stats.dry++; continue; }
    const poly = makePolygon(f.geometry.map((p) => toWorld(p.lat, p.lng)), (f.holes || []).map((h) => h.map((p) => toWorld(p.lat, p.lng))));
    const [x0, y0, x1, y1] = poly.box;
    const side = Math.max(x1 - x0, y1 - y0, 1);
    // the lake's level: the median ground inside it
    const inside = [];
    const step = Math.max(1, side / 24);
    for (let x = x0 + step / 2; x < x1; x += step) for (let y = y0 + step / 2; y < y1; y += step) if (poly.contains(x, y)) inside.push(heightAt(x, y));
    if (!inside.length) for (const [x, y] of poly.outer) inside.push(heightAt(x, y));
    inside.sort((a, b) => a - b);
    const level = inside[inside.length >> 1] + 0.05;
    // a grid over the outline, cells mostly inside it kept, merged greedily
    // into as few rectangles as possible
    const area = Math.abs(poly.outer.reduce((a, p, i) => { const q = poly.outer[(i + 1) % poly.outer.length]; return a + p[0] * q[1] - q[0] * p[1]; }, 0)) / 2;
    const cell = Math.min(LAKE_CELL_M[1], Math.max(LAKE_CELL_M[0], Math.sqrt(area) / 16));
    const nx = Math.max(1, Math.ceil((x1 - x0) / cell)); const ny = Math.max(1, Math.ceil((y1 - y0) / cell));
    const wet = new Uint8Array(nx * ny);
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
      let hits = 0;
      for (const fx of [0.2, 0.5, 0.8]) for (const fy of [0.2, 0.5, 0.8]) if (poly.contains(x0 + (i + fx) * cell, y0 + (j + fy) * cell)) hits++;
      wet[j * nx + i] = hits >= 5 ? 1 : 0;
    }
    const lakeTiles = [];
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
      if (!wet[j * nx + i]) continue;
      let w = 1;
      while (i + w < nx && wet[j * nx + i + w]) w++;
      let h = 1;
      while (j + h < ny) {
        let full = true;
        for (let k = 0; k < w && full; k++) full = wet[(j + h) * nx + i + k] === 1;
        if (!full) break;
        h++;
      }
      for (let jj = j; jj < j + h; jj++) for (let k = 0; k < w; k++) wet[jj * nx + i + k] = 0;
      lakeTiles.push({ cx: x0 + (i + w / 2) * cell, cy: y0 + (j + h / 2) * cell, sx: w * cell, sy: h * cell });
    }
    if (!lakeTiles.length) continue;
    stats.lakes++;
    for (const tile of lakeTiles) tiles.push({ ...tile, sx: tile.sx + LAKE_TILE_OVERLAP_M, sy: tile.sy + LAKE_TILE_OVERLAP_M, z: level, lake: lakeIndex, name: t.name || null });
    lakeIndex++;
  }
  stats.tiles = tiles.length;
  return { tiles, stats };
}
