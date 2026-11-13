// Inland water for BeamNG exports: Rivers along waterway centrelines and
// WaterBlock tiles inside lakes, after BeamNG.Earth (MIT; server/riverlines.py,
// server/seatiles.py lake tiles, mod sea.lua's river look).
//
// What is water: rivers, streams and canals that run all year (no dry
// washes: intermittent / seasonal ones are left out, the desert's arroyos),
// never where they pass under a road (culverts), and lakes, ponds and
// reservoirs that hold water. Riverbank outlines (natural=water +
// water=river) give the river its width; a wide or tidal one whose ground is
// flat is area water instead, as tiles like a lake (see WIDE_RIVER_M).
//
// Rivers: ways that continue one another are chained (OSM draws waterways in
// the direction of flow), resampled, and each node's surface is the lowest
// ground in the channel, median-smoothed, never above the lowest ground
// across its width and never rising downstream, a hand above it; the width is measured across the riverbank outline where there
// is one, else by kind; a River never reaches within ROAD_MARGIN_M of a road
// and is cut where a road crosses it at grade.
//
// Lakes: WaterBlock rectangles covering the outline (big ones inside, small
// ones along the shore reaching just past it), at the lake's level (the median ground inside: elevation models
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
// Without a riverbank outline the OSM line often runs a few metres up the
// slope beside the bed; nodes slide across to the lowest ground within this.
const BED_SNAP_M = 6;
const MID_FLOAT_M = 0.5;
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
// A river outline drawn as area water (WaterBlock tiles, like a lake) and no
// River ribbon, after BeamNG.Earth (seacarve.py): a tidal one, or one at
// least WIDE_RIVER_M across somewhere (a ribbon that wide folds over itself
// at bends and islands), whose ground the elevation data flattened (its
// middle 80 % within AREA_FLAT_M). A sloping one stays a ribbon.
const WIDE_RIVER_M = 120;
const AREA_FLAT_M = 1;
export const LAKE_TILE_OVERLAP_M = 0.5;
// a bank this far over a lake's water hides a WaterBlock reaching under it
const BANK_HIDES_M = 0.1;
// Lake tile cells (m): a quarter of the old coarse cell within these, and
// coarser where the outline is so big the grid would pass SHORE_GRID_MAX.
const SHORE_CELL_M = [2, 4];
const SHORE_GRID_MAX = 2048;

const norm = (v) => String(v ?? '').trim().toLowerCase();
const isDry = (tags = {}) => ['yes', 'true', 'dry'].includes(norm(tags.intermittent)) || ['yes', 'true'].includes(norm(tags.seasonal))
  || norm(tags.water) === 'dry' || ['dry', 'intermittent'].includes(norm(tags.natural === 'water' ? tags.water_regime : ''));
const isUnderground = (tags = {}) => ['culvert', 'yes', 'flooded', 'building_passage'].includes(norm(tags.tunnel))
  || norm(tags.culvert) === 'yes' || norm(tags.location) === 'underground' || Number.parseInt(tags.layer ?? '0', 10) < 0;
const isClosed = (g) => g.length > 3 && g[0].lat === g[g.length - 1].lat && g[0].lng === g[g.length - 1].lng;

// Even-odd point test. A long outline (a river bank of thousands of points, asked about every pixel of its
// box) is sorted once into bands by height: only the edges whose span reaches the point's band can cross its
// row, so only they are tested, with the same arithmetic as before (carving lake beds was 14 s of an 8 km
// export, nearly all of it here).
const RING_BANDS_FROM = 24;
const ringBands = new WeakMap();
function bandsOf(ring) {
  let ix = ringBands.get(ring);
  if (ix && ix.n === ring.length) return ix;
  const n = ring.length;
  const xs = new Float64Array(n); const ys = new Float64Array(n);
  let y0 = Infinity; let y1 = -Infinity;
  for (let i = 0; i < n; i++) { xs[i] = ring[i][0]; ys[i] = ring[i][1]; if (ys[i] < y0) y0 = ys[i]; if (ys[i] > y1) y1 = ys[i]; }
  const count = Math.min(1024, Math.max(1, n >> 2));
  const h = (y1 - y0) / count || 1;
  const band = (y) => Math.min(count - 1, Math.max(0, Math.floor((y - y0) / h)));
  const lists = Array.from({ length: count }, () => []);
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const lo = band(Math.min(ys[i], ys[j])); const hi = band(Math.max(ys[i], ys[j]));
    for (let b = lo; b <= hi; b++) lists[b].push(i);
  }
  ix = { n, xs, ys, y0, y1, h, count, edges: lists.map((l) => Int32Array.from(l)) };
  ringBands.set(ring, ix);
  return ix;
}
function pointInRing(x, y, ring) {
  let inside = false;
  const n = ring.length;
  if (n < RING_BANDS_FROM) {
    for (let i = 0, j = n - 1; i < n; j = i++) {
      const xi = ring[i][0]; const yi = ring[i][1]; const xj = ring[j][0]; const yj = ring[j][1];
      if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
  }
  const ix = bandsOf(ring);
  if (!(y >= ix.y0 && y <= ix.y1)) return false;   // (no edge crosses a row outside the outline's own span)
  const edges = ix.edges[Math.min(ix.count - 1, Math.max(0, Math.floor((y - ix.y0) / ix.h)))];
  const { xs, ys } = ix;
  for (let e = 0; e < edges.length; e++) {
    const i = edges[e]; const j = i === 0 ? n - 1 : i - 1;
    const xi = xs[i]; const yi = ys[i]; const xj = xs[j]; const yj = ys[j];
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
export const makePolygon = (outer, holes = []) => {
  const box = bboxOf(outer);
  return {
    outer, holes, box,
    contains: (x, y) => x >= box[0] && x <= box[2] && y >= box[1] && y <= box[3]
      && pointInRing(x, y, outer) && !holes.some((h) => pointInRing(x, y, h)),
  };
};

// Ground samples inside a polygon, sorted (its outline's when it is too thin).
function groundInside(poly, heightAt) {
  const [x0, y0, x1, y1] = poly.box;
  const step = Math.max(1, Math.max(x1 - x0, y1 - y0, 1) / 24);
  const inside = [];
  for (let x = x0 + step / 2; x < x1; x += step) for (let y = y0 + step / 2; y < y1; y += step) if (poly.contains(x, y)) inside.push(heightAt(x, y));
  if (!inside.length) for (const [x, y] of poly.outer) inside.push(heightAt(x, y));
  return inside.sort((a, b) => a - b);
}
const isRiverbank = (t = {}) => RIVERBANK_WATER.has(norm(t.water)) || norm(t.waterway) === 'riverbank';
// a lake, pond or reservoir outline planLakes tiles (a fountain's basin or a
// pool is built with it: services/fountains.js, pools.js; the sea, docks and
// marinas are the sea's)
const isLakeWater = (t = {}) => {
  if (t.waterway) return false;
  if (norm(t.amenity) === 'fountain' || norm(t.leisure) === 'swimming_pool') return false;
  if (['sea', 'ocean'].includes(norm(t.place)) || norm(t.natural) === 'bay' || ['dock', 'harbour'].includes(norm(t.water)) || norm(t.leisure) === 'marina') return false;
  return norm(t.natural) === 'water' ? (!t.water || LAKE_WATER.has(norm(t.water))) : ['reservoir', 'basin'].includes(norm(t.landuse));
};
const isStandingWater = (t = {}) => isLakeWater(t) && !isDry(t);
// Some point inside at least r from every shore (holes included).
function hasRoom(poly, r) {
  const [x0, y0, x1, y1] = poly.box;
  if (x1 - x0 < 2 * r || y1 - y0 < 2 * r) return false;
  const step = Math.max(4, r / 3);
  const rings = [poly.outer, ...poly.holes];
  for (let x = x0 + r; x <= x1 - r; x += step) {
    for (let y = y0 + r; y <= y1 - r; y += step) {
      if (poly.contains(x, y) && rings.every((ring) => distToRing(x, y, ring) >= r)) return true;
    }
  }
  return false;
}
/** A riverbank outline drawn as area water: tidal or wide, and flat (see WIDE_RIVER_M). */
function isRiverArea(tags, poly, heightAt) {
  const g = groundInside(poly, heightAt);
  const flat = g[Math.floor(g.length * 0.9)] - g[Math.floor(g.length * 0.1)] <= AREA_FLAT_M;
  return flat && (norm(tags.tidal) === 'yes' || hasRoom(poly, WIDE_RIVER_M / 2));
}

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
  const stats = { dry: 0, underground: 0, otherKinds: 0, chains: 0, pieces: 0, cutAtRoads: 0, widthFromOutline: 0, nodesInAreaWater: 0 };
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
  // (and the wide or tidal ones, area water: no ribbon in them)
  const outlines = [];
  const areas = [];
  for (const f of features) {
    if (f.type !== 'water' || !(f.geometry?.length > 3) || !isClosed(f.geometry)) continue;
    const t = f.tags || {};
    // (standing water, drawn as blocks: no ribbon over it either; the Ohio's
    // centreline lay its length over the Emsworth Pool's outline, a second
    // surface 0.2 m over the pool's in a band down the river)
    if (!isRiverbank(t)) {
      if (isStandingWater(t)) areas.push(makePolygon(f.geometry.map((p) => toWorld(p.lat, p.lng)), (f.holes || []).map((h) => h.map((p) => toWorld(p.lat, p.lng)))));
      continue;
    }
    const poly = makePolygon(f.geometry.map((p) => toWorld(p.lat, p.lng)), (f.holes || []).map((h) => h.map((p) => toWorld(p.lat, p.lng))));
    outlines.push(poly);
    if (!isDry(t) && isRiverArea(t, poly, heightAt)) areas.push(poly);
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
    const fromOutline = pts.map(() => false);
    let widths = pts.map((p, i) => {
      const n = [-tangents[i][1], tangents[i][0]];
      const poly = outlines.find((o) => o.contains(p[0], p[1]));
      if (!poly) return Number.isFinite(tagged) && tagged > 0 ? tagged : spec.width;
      let dl = 0; let dr = 0;
      while (dl < WIDTH_MAX_M && poly.contains(p[0] + n[0] * (dl + WIDTH_STEP_M), p[1] + n[1] * (dl + WIDTH_STEP_M))) dl += WIDTH_STEP_M;
      while (dr < WIDTH_MAX_M && poly.contains(p[0] - n[0] * (dr + WIDTH_STEP_M), p[1] - n[1] * (dr + WIDTH_STEP_M))) dr += WIDTH_STEP_M;
      centres[i] = [p[0] + (n[0] * (dl - dr)) / 2, p[1] + (n[1] * (dl - dr)) / 2];
      stats.widthFromOutline++;
      fromOutline[i] = true;
      return Math.max(spec.width * 0.5, (dl + dr + WIDTH_STEP_M) * WIDTH_PAD);
    });
    const xs = movingAverage(centres.map((c) => c[0]), SMOOTH_N);
    const ys = movingAverage(centres.map((c) => c[1]), SMOOTH_N);
    centres = xs.map((x, i) => [x, ys[i]]);
    widths = movingAverage(widths, SMOOTH_N);
    // onto the bed: a mountain stream drawn on the gully's side otherwise
    // sits underground at bed level (half the Salt Lake County streams)
    const offsets = centres.map(([x, y], i) => {
      if (fromOutline[i]) return 0;
      const n = [-tangents[i][1], tangents[i][0]];
      let best = 0; let low = heightAt(x, y);
      for (let d = -BED_SNAP_M; d <= BED_SNAP_M; d += 1) {
        const z = heightAt(x + n[0] * d, y + n[1] * d);
        if (z < low - 0.05) { low = z; best = d; }
      }
      return best;
    });
    const eased = movingAverage(offsets, 3);
    centres = centres.map(([x, y], i) => [x - tangents[i][1] * eased[i], y + tangents[i][0] * eased[i]]);
    // surface: the lowest ground across the channel (not along it: on a steep
    // stream that sank the water by grade × probe), never rising downstream
    const ground = centres.map(([x, y], i) => {
      const t = tangents[i]; const n = [-t[1], t[0]]; const r = CHANNEL_PROBE_M;
      return Math.min(heightAt(x, y), heightAt(x + n[0] * r, y + n[1] * r), heightAt(x - n[0] * r, y - n[1] * r));
    });
    const med = runningMedian(ground, MEDIAN_N);
    // The median ignores a node's own low ground, and the ±3 m probe misses
    // the ribbon's edges: a surface kept at its neighbours' level over a dip
    // in the bed, or across a side slope, hangs metres above the ground (the
    // floating rivers of the 16k Salt Lake County report). Never above the
    // lowest ground across the full width at that node; this only lowers.
    for (let i = 0; i < med.length; i++) {
      const [x, y] = centres[i]; const t = tangents[i]; const n = [-t[1], t[0]];
      let across = ground[i];
      for (let s = -1; s <= 1; s += 0.25) across = Math.min(across, heightAt(x + n[0] * s * widths[i] / 2, y + n[1] * s * widths[i] / 2));
      med[i] = Math.min(med[i], across);
    }
    // the water runs straight between nodes: where the ground halfway along
    // is far lower (a bend cutting across a bank), bring both ends down so it
    // clears by at most MID_FLOAT_M. Lowering more buries the streams below.
    for (let i = 1; i < med.length; i++) {
      const cap = heightAt((centres[i][0] + centres[i - 1][0]) / 2, (centres[i][1] + centres[i - 1][1]) / 2) + MID_FLOAT_M;
      if ((med[i] + med[i - 1]) / 2 > cap) { med[i] = Math.min(med[i], cap); med[i - 1] = Math.min(med[i - 1], cap); }
    }
    for (let i = 1; i < med.length; i++) med[i] = Math.min(med[i], med[i - 1]);
    // keep off the roads; cut where one crosses at grade
    let piece = []; let pieceOutline = [];
    const flush = () => {
      let L = 0;
      for (let k = 1; k < piece.length; k++) L += Math.hypot(piece[k][0] - piece[k - 1][0], piece[k][1] - piece[k - 1][1]);
      if (piece.length >= 2 && L >= MIN_PIECE_M) {
        // (outline: per node, its width measured across a mapped water outline)
        rivers.push({ kind: chain.kind, name: chain.tags.name || null, flow: spec.flow, nodes: piece, outline: pieceOutline });
        stats.pieces++;
      }
      piece = []; pieceOutline = [];
    };
    centres.forEach(([x, y], i) => {
      if (areas.some((a) => a.contains(x, y))) { stats.nodesInAreaWater++; flush(); return; }
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
      pieceOutline.push(fromOutline[i]);
    });
    flush();
  }
  return { rivers, stats };
}

// x ranges inside the polygon along the line at y (even-odd over every ring).
function spansAt(poly, y) {
  const xs = [];
  for (const ring of [poly.outer, ...poly.holes]) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = ring[i]; const [xj, yj] = ring[j];
      if ((yi > y) !== (yj > y)) xs.push(xi + ((y - yi) * (xj - xi)) / (yj - yi));
    }
  }
  xs.sort((a, b) => a - b);
  const spans = [];
  for (let k = 0; k + 1 < xs.length; k += 2) spans.push([xs[k], xs[k + 1]]);
  return spans;
}
// Greedy rectangles over a mask (row-major, widest first, then as tall as rows allow).
function mergeMask(wet, nx, ny, x0, y0, cell, out) {
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
    out.push({ cx: x0 + (i + w / 2) * cell, cy: y0 + (j + h / 2) * cell, sx: w * cell, sy: h * cell });
  }
  return out;
}
/**
 * Rectangles covering a polygon: a grid of cells (a quarter of `cell` within
 * SHORE_CELL_M, coarser where the grid would pass SHORE_GRID_MAX across);
 * every cell the outline touches is covered. A rectangle grows on over any
 * cell where hidden(x, y) holds at its corners and centre (the bank stands
 * over the water there and hides it), so a lake is a few big blocks reaching
 * under its banks, not hundreds hugging the shore: each WaterBlock is drawn
 * on its own, and 11,477 of them (an 8 km St. Augustine) took 20 ms a frame.
 * Never past the shore where the ground is lower (a step of water over a
 * plaza, the fountain basins); rectangles never overlap (two surfaces at one
 * height flicker). Exported for tests.
 */
export function tileOutline(poly, cell, hidden = () => false, { minCell = 0 } = {}) {
  const [x0, y0, x1, y1] = poly.box;
  // (minCell: no finer than this, for water seen only from far off: the backdrop's)
  const c = Math.max(minCell, Math.min(cell, Math.max(SHORE_CELL_M[0], Math.min(SHORE_CELL_M[1], cell / 4), Math.max(x1 - x0, y1 - y0) / SHORE_GRID_MAX)));
  const nx = Math.max(1, Math.ceil((x1 - x0) / c)); const ny = Math.max(1, Math.ceil((y1 - y0) / c));
  // a cell is touched when a span at its bottom, middle or top crosses it
  const wet = new Uint8Array(nx * ny);
  const eps = 1e-6;
  for (let j = 0; j < ny; j++) {
    for (const f of [eps, 0.5, 1 - eps]) {
      for (const [a, b] of spansAt(poly, y0 + (j + f) * c)) {
        const i0 = Math.max(0, Math.floor((a - x0) / c + eps)); const i1 = Math.min(nx - 1, Math.ceil((b - x0) / c - eps) - 1);
        for (let i = i0; i <= i1; i++) wet[j * nx + i] = 1;
      }
    }
  }
  // a touched cell whose centre lies past the shore on low ground: left dry
  // (only the mask's edge cells can)
  const edge = (i, j) => i === 0 || j === 0 || i === nx - 1 || j === ny - 1
    || !wet[j * nx + i - 1] || !wet[j * nx + i + 1] || !wet[(j - 1) * nx + i] || !wet[(j + 1) * nx + i];
  const drop = [];
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    if (!wet[j * nx + i] || !edge(i, j)) continue;
    const x = x0 + (i + 0.5) * c; const y = y0 + (j + 0.5) * c;
    if (!poly.contains(x, y) && !hidden(x, y)) drop.push(j * nx + i);
  }
  for (const k of drop) wet[k] = 0;
  // may a rectangle cover cell k? the lake's own cells, and banks that hide it
  // (worked out only for the cells a rectangle grows into)
  const okMemo = new Int8Array(nx * ny).fill(-1);
  const ok = (i, j) => {
    const k = j * nx + i;
    if (wet[k]) return true;
    if (okMemo[k] < 0) {
      const xa = x0 + i * c; const ya = y0 + j * c;
      okMemo[k] = [[xa, ya], [xa + c, ya], [xa, ya + c], [xa + c, ya + c], [xa + c / 2, ya + c / 2]].every(([x, y]) => hidden(x, y)) ? 1 : 0;
    }
    return okMemo[k] === 1;
  };
  const used = new Uint8Array(nx * ny);
  const free = (i, j) => !used[j * nx + i] && ok(i, j);
  const out = [];
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    if (!wet[j * nx + i] || used[j * nx + i]) continue;
    // widest run along the row from here, then as tall as every row allows
    // (and back up the rows above it, over hidden cells)
    let iL = i; while (iL > 0 && free(iL - 1, j)) iL--;
    let iR = i + 1; while (iR < nx && free(iR, j)) iR++;
    const rowFree = (jj) => { for (let k = iL; k < iR; k++) if (!free(k, jj)) return false; return true; };
    let jT = j + 1; while (jT < ny && rowFree(jT)) jT++;
    let jB = j; while (jB > 0 && rowFree(jB - 1)) jB--;
    for (let jj = jB; jj < jT; jj++) for (let k = iL; k < iR; k++) used[jj * nx + k] = 1;
    out.push({ cx: x0 + ((iL + iR) / 2) * c, cy: y0 + ((jB + jT) / 2) * c, sx: (iR - iL) * c, sy: (jT - jB) * c });
  }
  return out;
}

// Water outlines that meet: within JOIN_TOUCH_M of each other at some vertex,
// their levels within JOIN_LEVEL_M (a dam between a reservoir and the river
// under it is a real step: not joined), and not overlapping deeper than the
// touch (one inside another is a lake on an island, or a mapping overlap:
// tiled apart as before). Returns groups of lake indices.
const JOIN_TOUCH_M = 3;
const JOIN_LEVEL_M = 1;
export function joinTouchingWater(lakes) {
  const parent = lakes.map((_, i) => i);
  const find = (i) => { while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; } return i; };
  const near = (a, b) => a.box[0] <= b.box[2] + JOIN_TOUCH_M && b.box[0] <= a.box[2] + JOIN_TOUCH_M
    && a.box[1] <= b.box[3] + JOIN_TOUCH_M && b.box[1] <= a.box[3] + JOIN_TOUCH_M;
  // (a vertex of a on b's shore, or one deep inside it)
  const relation = (a, b) => {
    let touch = false;
    const rings = [b.outer, ...b.holes];
    for (const [x, y] of a.outer) {
      if (x < b.box[0] - JOIN_TOUCH_M || x > b.box[2] + JOIN_TOUCH_M || y < b.box[1] - JOIN_TOUCH_M || y > b.box[3] + JOIN_TOUCH_M) continue;
      const d = Math.min(...rings.map((r) => distToRing(x, y, r)));
      if (d <= JOIN_TOUCH_M) touch = true;
      else if (b.contains(x, y)) return 'overlap';
    }
    return touch ? 'touch' : null;
  };
  for (let i = 0; i < lakes.length; i++) {
    for (let j = i + 1; j < lakes.length; j++) {
      const a = lakes[i]; const b = lakes[j];
      if (Math.abs(a.level - b.level) > JOIN_LEVEL_M || !near(a.poly, b.poly)) continue;
      const ab = relation(a.poly, b.poly); const ba = relation(b.poly, a.poly);
      if (ab === 'overlap' || ba === 'overlap' || (!ab && !ba)) continue;
      parent[find(i)] = find(j);
    }
  }
  const groups = new Map();
  lakes.forEach((_, i) => { const r = find(i); if (!groups.has(r)) groups.set(r, []); groups.get(r).push(i); });
  return [...groups.values()];
}
// Outlines that meet edge to edge as one tiling outline: every ring is
// crossed even-odd by tileOutline's scan lines (a shared edge is crossed
// twice, so its two sides join), contains() is any member's.
export function unionOutline(polys) {
  const box = [Math.min(...polys.map((p) => p.box[0])), Math.min(...polys.map((p) => p.box[1])), Math.max(...polys.map((p) => p.box[2])), Math.max(...polys.map((p) => p.box[3]))];
  return { outer: [], holes: polys.flatMap((p) => [p.outer, ...p.holes]), box, contains: (x, y) => polys.some((p) => p.contains(x, y)) };
}

/**
 * Lake tiles: [{ cx, cy, sx, sy, z, lake }] (WaterBlock rectangles, z the
 * water surface), plus stats and lakes [{ poly, level }] (carveLakeBeds).
 */
export function planLakes({ features = [], toWorld, heightAt, seaZ = null, minCell = 0 }) {
  const tiles = [];
  const lakes = [];   // { poly, level } for carveLakeBeds
  const stats = { lakes: 0, dry: 0, tiles: 0, riverAreas: 0 };
  for (const f of features) {
    if (f.type !== 'water' || !(f.geometry?.length > 3) || !isClosed(f.geometry)) continue;
    const t = f.tags || {};
    const river = isRiverbank(t);
    if (!river && !isLakeWater(t)) continue;
    if (river && isDry(t)) continue;
    if (isDry(t)) { stats.dry++; continue; }
    const poly = makePolygon(f.geometry.map((p) => toWorld(p.lat, p.lng)), (f.holes || []).map((h) => h.map((p) => toWorld(p.lat, p.lng))));
    // (a river's outline only where it is area water; the rest are Rivers)
    if (river && !isRiverArea(t, poly, heightAt)) continue;
    if (river) stats.riverAreas++;
    // the lake's level: the median ground inside it
    const inside = groundInside(poly, heightAt);
    const level = inside[inside.length >> 1] + 0.05;
    // at or under the sea plane: the sea is drawn there already (St. Augustine's
    // tidal water: 1,978 blocks under it)
    if (Number.isFinite(seaZ) && level <= seaZ + 0.02) { stats.underSea = (stats.underSea || 0) + 1; continue; }
    const area = Math.abs(poly.outer.reduce((a, p, i) => { const q = poly.outer[(i + 1) % poly.outer.length]; return a + p[0] * q[1] - q[0] * p[1]; }, 0)) / 2;
    lakes.push({ poly, level, tags: t, river, area });
  }
  // Water bodies that meet (the Allegheny, the Monongahela and the Ohio's
  // Emsworth Pool at Pittsburgh's Point: three outlines, one pool) stand at
  // one level, the lowest of theirs, and are tiled as one outline: each
  // planned alone, the Ohio came out 0.16 m under the other two and their
  // blocks overlapped along the seam in a stair-stepped line
  const groups = joinTouchingWater(lakes);
  for (const members of groups) {
    const level = Math.min(...members.map((k) => lakes[k].level));
    for (const k of members) lakes[k].level = level;
    const poly = members.length === 1 ? lakes[members[0]].poly : unionOutline(members.map((k) => lakes[k].poly));
    // tiles: every small cell the outline touches, merged (the water reaches
    // the shore; past it by at most one cell, and only where the bank stands
    // over the water and hides it)
    const area = members.reduce((n, k) => n + lakes[k].area, 0);
    const lakeTiles = tileOutline(poly, Math.min(LAKE_CELL_M[1], Math.max(LAKE_CELL_M[0], Math.sqrt(area) / 16)), (x, y) => heightAt(x, y) > level + BANK_HIDES_M, { minCell });
    if (!lakeTiles.length) continue;
    stats.lakes += members.length;
    if (members.length > 1) stats.joined = (stats.joined || 0) + members.length;
    // (each tile is the lake's whose outline holds its centre: the backdrop's
    // hand-over at the map's edge trims a lake's own tiles)
    const owner = (tile) => members.find((k) => lakes[k].poly.contains(tile.cx, tile.cy)) ?? members[0];
    for (const tile of lakeTiles) {
      const k = owner(tile);
      tiles.push({ ...tile, sx: tile.sx + LAKE_TILE_OVERLAP_M, sy: tile.sy + LAKE_TILE_OVERLAP_M, z: level, lake: k, name: lakes[k].tags.name || null });
    }
  }
  stats.tiles = tiles.length;
  return { tiles, stats, lakes };
}

// A bed under standing water. Elevation data records a lake's surface as its
// ground (lidar, the global 30 m), so the terrain stood level with the water,
// which then never showed, and every lake was a puddle. The bed follows
// GLOBathy (Khazaei et al. 2022, the global lakes bathymetry): depth grows
// with the distance from the shore, to the lake's greatest depth at the point
// farthest from any shore; rounded here (t(2 - t) of the distance share, not
// a straight cone) so the middle is a basin, not a spike. The greatest depth:
// the lake's own OSM depth tag (depth / maxdepth / depth:max) when mapped,
// else from the land round it (Hollister & Milstead 2010, the method GLOBathy
// built on): the hillside's median slope at the shore carried on under the
// water, LAKE_SLOPE_SHARE of it at the deepest point. Capped by the lake's
// size (LAKE_SIZE_DEPTH of the square root of its area: a pond stays a pond)
// and, for rivers drawn as area water, at RIVER_AREA_MAX_M.
//
// At the shore the bed starts LAKE_BED_EDGE_M under the water, LAKE_BED_M by
// LAKE_BANK_M out at least. Ground already deeper is left; nothing is raised.
// Only the water is cut: ground inside the outline standing LAKE_CUT_FULL_M
// or more over the level (a reservoir's bank, its drawdown ring, a beach, an
// island's slope) is shore, left exactly as surveyed, and the bed deepens from
// the survey's own waterline. Cut to the bed regardless, it stood as a wall
// all along the shore wherever the outline climbed the bank (Lac du Chevril,
// Tignes); cut back into a slope afterwards, the bank became one uniform ramp
// and the real shoreline was lost. A thin low strip of ground in the water
// (under LAKE_CUT_TOP_M, narrower than LAKE_THIN_M) is the survey's flaw and
// is cut with the water. The map's
// edge is no shore: a lake running off the map deepens towards it.
//
// A reservoir is a flooded valley, deepest against its dam: a dam (OSM
// waterway=dam / man_made=dam) along the outline is no shore either, its
// depth there the dam's height tag less DAM_FREEBOARD_M, or where untagged
// how far the valley falls below it on the air side; and the floor rises
// away from the dam, to DAM_FAR_SHARE of that depth at the lake's far end.
const LAKE_BED_M = 1.5;
const LAKE_BED_EDGE_M = 0.3;
const LAKE_BANK_M = 3;
const LAKE_CUT_FULL_M = 0.5;
const LAKE_CUT_TOP_M = 2.5;
const LAKE_SLOPE_SHARE = 0.5;   // with the rounded profile: the bed leaves the shore at the hillside's own slope
const LAKE_SLOPE_READ_M = [8, 40];  // the hillside read this far out from the shore
const LAKE_SLOPE_MAX = 1.2;
const LAKE_SLOPE_QUANTILE = 0.75;
const LAKE_SIZE_DEPTH = 0.15;
const LAKE_DEPTH_MAX_M = 400;
const RIVER_AREA_MAX_M = 4;
const LAKE_FLAT_M = 0.25;        // a lake's surface within this (10th to 90th percentile): recorded flat, its waterline known
const LAKE_THIN_M = 6;          // dry ground inside a lake narrower than this, and low: the survey's flaw, not a bank
const LAKE_SMOOTH_SHARE = 0.1;  // the bed's distance to the shore smoothed over this share of the lake's reach
const LAKE_SMOOTH_MAX_CELLS = 80;
const LAKE_NEAR_SMOOTH_M = 5;   // near the shore the distance smoothed over this much only
const LAKE_GRID_CELLS = 4e6;    // the distance grid at most this many cells (a big lake on a coarser one)
const DAM_REACH_M = 25;         // a dam this close to a lake's outline holds it
const DAM_FREEBOARD_M = 4;      // the crest over the water
const DAM_FAR_SHARE = 0.25;     // the floor at the far end: this share of the depth at the dam
const DAM_AIR_READ_M = [30, 120]; // the valley below a dam read this far out on its air side
const distToRing = (x, y, ring) => {
  let best = Infinity;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [ax, ay] = ring[j]; const [bx, by] = ring[i];
    const dx = bx - ax; const dy = by - ay; const L2 = dx * dx + dy * dy || 1e-9;
    const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / L2));
    best = Math.min(best, Math.hypot(ax + dx * t - x, ay + dy * t - y));
  }
  return best;
};

/** A depth in metres from an OSM tag ("12", "12 m", "40 ft"), or null. */
export function tagDepthM(tags = {}) {
  for (const k of ['maxdepth', 'depth:max', 'depth']) {
    const v = String(tags[k] ?? '').trim().toLowerCase();
    const m = /^([0-9]+(?:[.,][0-9]+)?)\s*(m|ft|')?$/.exec(v);
    if (!m) continue;
    const n = Number(m[1].replace(',', '.')) * (m[2] === 'ft' || m[2] === "'" ? 0.3048 : 1);
    if (n > 0 && n < 2000) return n;
  }
  return null;
}

// Squared distance (cells) from every cell to the nearest seed: Felzenszwalb
// & Huttenlocher's exact transform, rows then columns.
/** A grid smoothed about a Gaussian of sigma cells (three box passes, edges held). */
function blurGrid(src, w, h, sigma) {
  const rad = Math.max(1, Math.round(Math.sqrt(4 * sigma * sigma + 1) / 2 - 0.5));
  let a = Float32Array.from(src); let b = new Float32Array(w * h);
  const pass = (from, to, len, lines, at) => {
    for (let q = 0; q < lines; q++) {
      let sum = 0;
      for (let i = -rad; i <= rad; i++) sum += from[at(q, Math.min(len - 1, Math.max(0, i)))];
      for (let i = 0; i < len; i++) {
        to[at(q, i)] = sum / (2 * rad + 1);
        sum += from[at(q, Math.min(len - 1, i + rad + 1))] - from[at(q, Math.max(0, i - rad))];
      }
    }
  };
  for (let n = 0; n < 3; n++) {
    pass(a, b, w, h, (row, i) => row * w + i);
    pass(b, a, h, w, (col, i) => i * w + col);
  }
  return a;
}

function squaredDistanceGrid(seed, w, h) {
  const INF = 1e20;
  const g = new Float64Array(w * h);
  for (let i = 0; i < w * h; i++) g[i] = seed[i] ? 0 : INF;
  const n = Math.max(w, h);
  const f = new Float64Array(n); const d = new Float64Array(n); const v = new Int32Array(n); const z = new Float64Array(n + 1);
  const pass = (len, get, put) => {
    for (let q = 0; q < len; q++) f[q] = get(q);
    let k = 0; v[0] = 0; z[0] = -INF; z[1] = INF;
    for (let q = 1; q < len; q++) {
      let sq = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
      while (sq <= z[k]) { k--; sq = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]); }
      k++; v[k] = q; z[k] = sq; z[k + 1] = INF;
    }
    k = 0;
    for (let q = 0; q < len; q++) { while (z[k + 1] < q) k++; d[q] = (q - v[k]) * (q - v[k]) + f[v[k]]; }
    for (let q = 0; q < len; q++) put(q, d[q]);
  };
  for (let y = 0; y < h; y++) pass(w, (x) => g[y * w + x], (x, val) => { g[y * w + x] = val; });
  for (let x = 0; x < w; x++) pass(h, (y) => g[y * w + x], (y, val) => { g[y * w + x] = val; });
  return g;
}

/**
 * The lake's greatest depth from the land round it: the median slope of the
 * ground rising from the water's level, LAKE_SLOPE_READ_M out from the shore,
 * read along the outline. groundAt(x, y) → world z, or NaN off the map.
 */
export function shoreSlope(poly, level, groundAt) {
  const ring = poly.outer;
  let per = 0;
  for (let i = 0; i < ring.length; i++) { const a = ring[i]; const b = ring[(i + 1) % ring.length]; per += Math.hypot(b[0] - a[0], b[1] - a[1]); }
  const step = Math.max(5, per / 400);
  const slopes = [];
  let carry = 0;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i]; const b = ring[(i + 1) % ring.length];
    const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (L < 1e-6) continue;
    const tx = (b[0] - a[0]) / L; const ty = (b[1] - a[1]) / L;
    for (let s = carry; s < L; s += step) {
      const x = a[0] + tx * s; const y = a[1] + ty * s;
      // (the outward side: the normal whose first step leaves the outline)
      let nx = ty; let ny = -tx;
      if (poly.contains(x + nx * 2, y + ny * 2)) { nx = -nx; ny = -ny; }
      const [r0, r1] = LAKE_SLOPE_READ_M;
      const g0 = groundAt(x + nx * r0, y + ny * r0); const g1 = groundAt(x + nx * r1, y + ny * r1);
      if (!Number.isFinite(g0) || !Number.isFinite(g1)) continue;
      slopes.push(Math.max(0, (Math.max(g0, g1) - level) / r1));
    }
    carry = ((carry - L) % step + step) % step;
  }
  if (!slopes.length) return null;
  slopes.sort((p, q) => p - q);
  // (the steeper shores tell the basin's shape: the upper quartile, not the
  // median. Half of a lake's shore is often a beach, a promenade or a delta,
  // and Lac de Tignes, 40 m deep, came out at 13 m from its gentle resort side)
  return Math.min(LAKE_SLOPE_MAX, slopes[Math.min(slopes.length - 1, Math.floor(slopes.length * LAKE_SLOPE_QUANTILE))]);
}

/**
 * Terrain edits for lake beds. grid: { heightMap, width, height, worldSize,
 * minHeight } (raw heights; world z = raw - minHeight; world x, y centred,
 * y north). lakes: planLakes' [{ poly, level, tags, river, area }].
 * keep(x, y): ground left as it is (a road and its sidewalks: a canal's
 * outline often reaches the quay, and a bed under it left the sidewalks
 * floating; kept ground counts as shore). Returns { pixels, lakes: [{ name,
 * depth, source, reach, slope }], apply(set) }: set(idx, raw).
 */
const segDistXY = (x, y, a, b) => {
  const dx = b[0] - a[0]; const dy = b[1] - a[1]; const L2 = dx * dx + dy * dy || 1e-9;
  const t = Math.max(0, Math.min(1, ((x - a[0]) * dx + (y - a[1]) * dy) / L2));
  return Math.hypot(a[0] + dx * t - x, a[1] + dy * t - y);
};
const lineDist = (x, y, line) => { let d = Infinity; for (let i = 0; i + 1 < line.length; i++) d = Math.min(d, segDistXY(x, y, line[i], line[i + 1])); return d; };

/**
 * A dam's depth against its lake: its height tag less the freeboard, else
 * how far the valley falls below the lake's level on the dam's air side (the
 * lowest ground DAM_AIR_READ_M out from it, away from the lake).
 */
export function damDepth(dam, poly, level, groundAt) {
  const tagged = Number(String(dam.height ?? '').replace(',', '.').replace(/\s*m$/i, ''));
  if (tagged > DAM_FREEBOARD_M + 1 && tagged < 400) return tagged - DAM_FREEBOARD_M;
  let low = Infinity;
  const line = dam.line;
  for (let i = 0; i + 1 < line.length; i++) {
    const a = line[i]; const b = line[i + 1];
    const L = Math.hypot(b[0] - a[0], b[1] - a[1]); if (L < 1e-6) continue;
    const nx = -(b[1] - a[1]) / L; const ny = (b[0] - a[0]) / L;
    for (let s = 0; s <= L; s += 10) {
      const x = a[0] + ((b[0] - a[0]) * s) / L; const y = a[1] + ((b[1] - a[1]) * s) / L;
      // (the air side: the one whose first step leaves the lake)
      const sgn = poly.contains(x + nx * 8, y + ny * 8) ? -1 : 1;
      for (const r of DAM_AIR_READ_M) {
        const g = groundAt(x + sgn * nx * r, y + sgn * ny * r);
        if (Number.isFinite(g)) low = Math.min(low, g);
      }
    }
  }
  return Number.isFinite(low) && level - low > 2 ? level - low : null;
}

// terrain shaping off (shallow): only the survey's flat water surface is cut,
// to at most this under the water (the water showed nowhere over it: water
// and ground at one height flickered in stripes the length of Pittsburgh's
// rivers); no bank is cut
export const SHALLOW_BED_M = 1.5;
export function carveLakeBeds(lakes, grid, { keep = () => false, dams = [], shallow = false } = {}) {
  const { heightMap, width, height, worldSize, minHeight = 0 } = grid;
  const sq = worldSize / Math.max(1, width - 1);
  const toPixel = (x, y) => [(x / worldSize + 0.5) * width, ((0.5 - y / worldSize) * height - 1)];
  const toWorld = (c, r) => [((c / width) - 0.5) * worldSize, (0.5 - (r + 1) / height) * worldSize];
  const groundAt = (x, y) => {
    const [c, r] = toPixel(x, y);
    if (!(c >= 0 && r >= 0 && c <= width - 1 && r <= height - 1)) return NaN;
    const c0 = Math.min(width - 2, Math.floor(c)); const r0 = Math.min(height - 2, Math.floor(r));
    const fc = c - c0; const fr = r - r0; const at = (cc, rr) => heightMap[rr * width + cc] - minHeight;
    return (at(c0, r0) * (1 - fc) + at(c0 + 1, r0) * fc) * (1 - fr) + (at(c0, r0 + 1) * (1 - fc) + at(c0 + 1, r0 + 1) * fc) * fr;
  };
  const edits = new Map();
  const report = [];
  // Outlines that meet edge to edge are one body of water (a big lake from
  // map tiles arrives cut along the tiles' edges; a reservoir mapped in two
  // parts): dug as one. Each piece dug alone took its neighbour for shore, and
  // the bed climbed to the surface along every seam, a ridge straight across
  // the lake (Lac du Chevril from Overture's tiles, two of them).
  const list = (lakes || []).filter((lk) => lk?.poly);
  const bodies = joinTouchingWater(list).map((members) => {
    if (members.length === 1) return { ...list[members[0]], pieces: [list[members[0]].poly] };
    const parts = members.map((i) => list[i]);
    const biggest = parts.reduce((a, b) => ((b.area || 0) > (a.area || 0) ? b : a));
    return {
      poly: unionOutline(parts.map((m) => m.poly)), pieces: parts.map((m) => m.poly),
      level: Math.min(...parts.map((m) => m.level)), tags: biggest.tags, river: parts.every((m) => m.river),
      area: parts.reduce((n, m) => n + (m.area || 0), 0),
    };
  });
  for (const lake of bodies) {
    const { poly, level, pieces } = lake;
    const [x0, y0, x1, y1] = poly.box;
    const [pc0, pr0] = toPixel(x0, y1); const [pc1, pr1] = toPixel(x1, y0);
    // the lake's box, padded so the shore round it is in it, on a grid of
    // k pixels a cell (1 unless the lake is very big)
    const pad = 2;
    const c0 = Math.floor(pc0) - pad; const r0 = Math.floor(pr0) - pad; const c1 = Math.ceil(pc1) + pad; const r1 = Math.ceil(pr1) + pad;
    const k = Math.max(1, Math.ceil(Math.sqrt(((c1 - c0 + 1) * (r1 - r0 + 1)) / LAKE_GRID_CELLS)));
    const gw = Math.ceil((c1 - c0 + 1) / k); const gh = Math.ceil((r1 - r0 + 1) / k);
    const cell = k * sq;
    // the dams holding this lake (near its outline), and their depth
    const lakeDams = (dams || []).filter((d) => d.line?.length > 1 && d.line.some(([x, y]) => poly.contains(x, y) || Math.min(...pieces.map((pp) => distToRing(x, y, pp.outer))) < DAM_REACH_M));
    const nearDam = (x, y) => lakeDams.some((d) => lineDist(x, y, d.line) < DAM_REACH_M);
    // The water is where the survey recorded it: inside the outline AND at
    // the surface (under LAKE_CUT_FULL_M over it). Ground the outline
    // overlaps (a bank, a beach, an islet the map does not draw) is shore:
    // it is left exactly as surveyed, and the bed deepens from the survey's
    // own waterline, so no wall is made and none has to be cut back.
    // That needs a survey that recorded the water flat (lidar does, to the
    // centimetre). Where its surface is rough (the global 30 m: a metre or
    // two of noise) or falls along its length (a river drawn as area water),
    // no one level says where the water is: the whole outline is water, and
    // ground up to LAKE_CUT_TOP_M over the level is cut less and less.
    let loose = !!lake.river;
    if (!loose) {
      const low = [];
      const step = Math.max(1, Math.floor(Math.sqrt((gw * gh) / 40000)));
      for (let gy = 0; gy < gh; gy += step) for (let gx = 0; gx < gw; gx += step) {
        const c = Math.round(c0 + gx * k + (k - 1) / 2); const r = Math.round(r0 + gy * k + (k - 1) / 2);
        if (c < 0 || r < 0 || c > width - 1 || r > height - 1) continue;
        const [x, y] = toWorld(c, r);
        if (!poly.contains(x, y)) continue;
        const above = heightMap[r * width + c] - minHeight - level;
        if (above < LAKE_CUT_TOP_M) low.push(above);
      }
      low.sort((p, q) => p - q);
      if (low.length >= 8) loose = low[Math.floor(low.length * 0.9)] - low[Math.floor(low.length * 0.1)] > LAKE_FLAT_M;
    }
    const seed = new Uint8Array(gw * gh);
    const damSeed = new Uint8Array(gw * gh);
    const wet = new Uint8Array(gw * gh);
    const lowDry = new Uint8Array(gw * gh);   // inside, dry, but under LAKE_CUT_TOP_M over the water
    const flaw = new Uint8Array(gw * gh);     // dry cells taken for water (the thin low strips below)
    for (let gy = 0; gy < gh; gy++) {
      for (let gx = 0; gx < gw; gx++) {
        const c = c0 + gx * k + (k - 1) / 2; const r = r0 + gy * k + (k - 1) / 2;
        const onMap = c >= 0 && r >= 0 && c <= width - 1 && r <= height - 1;
        const [x, y] = toWorld(c, r);
        const i = gy * gw + gx;
        if (poly.contains(x, y) && !keep(x, y)) {
          const above = onMap ? heightMap[Math.round(r) * width + Math.round(c)] - minHeight - level : 0;
          if (above < LAKE_CUT_FULL_M || loose) wet[i] = 1;
          else { seed[i] = 1; if (above < LAKE_CUT_TOP_M) lowDry[i] = 1; }
        } else if (lakeDams.length && nearDam(x, y)) damSeed[i] = 1;   // a dam: no shore
        else if (onMap) seed[i] = 1;   // the shore (off the map: none)
      }
    }
    // (a thin low strip of "ground" in the water is the survey's own flaw: a
    // seam between two flights, a boat, a ripple. Under LAKE_THIN_M wide and
    // low, it is water)
    if (cell <= LAKE_THIN_M) {
      const toWet = squaredDistanceGrid(wet, gw, gh);
      const half = LAKE_THIN_M / 2 / cell;
      const core = new Uint8Array(gw * gh);
      for (let i = 0; i < gw * gh; i++) if (seed[i] && toWet[i] > half * half) core[i] = 1;
      const toCore = squaredDistanceGrid(core, gw, gh);
      for (let i = 0; i < gw * gh; i++) if (lowDry[i] && toCore[i] > (half + 1) * (half + 1)) { seed[i] = 0; wet[i] = 1; flaw[i] = 1; }
    }
    const d2 = squaredDistanceGrid(seed, gw, gh);
    let reach = 0;
    for (let i = 0; i < gw * gh; i++) if (wet[i] && d2[i] < 1e19) reach = Math.max(reach, Math.sqrt(d2[i]));
    const reachCells = reach;
    reach *= cell;
    const area = lake.area || 0;
    const tagged = tagDepthM(lake.tags);
    // (each piece's shore read on its own: a seam between two pieces is no shore, and flat)
    const slopes = tagged ? [] : pieces.map((pp) => shoreSlope(pp, level, groundAt)).filter((v) => v != null);
    const slope = slopes.length ? Math.max(...slopes) : null;
    let depth = tagged ?? (slope != null ? LAKE_SLOPE_SHARE * slope * reach : LAKE_BED_M);
    if (!tagged) depth = Math.min(depth, Math.max(LAKE_BED_M, LAKE_SIZE_DEPTH * Math.sqrt(area)), LAKE_DEPTH_MAX_M);
    // a reservoir: its depth at the dam, the floor rising away from it
    let damD = null; let damDist = null; let damFar = 0;
    if (lakeDams.length && !lake.river) {
      const ds = lakeDams.map((d) => damDepth(d, poly, level, groundAt)).filter((v) => v != null);
      if (ds.length) {
        damD = Math.min(LAKE_DEPTH_MAX_M, Math.max(...ds));
        damDist = squaredDistanceGrid(damSeed, gw, gh);
        for (let i = 0; i < gw * gh; i++) if (wet[i] && damDist[i] < 1e19) damFar = Math.max(damFar, Math.sqrt(damDist[i]));
        if (!tagged) depth = Math.max(depth, damD);
      }
    }
    if (lake.river) depth = Math.min(depth, RIVER_AREA_MAX_M);
    depth = Math.max(LAKE_BED_M, depth);
    if (shallow) depth = Math.min(depth, SHALLOW_BED_M);
    report.push({ name: lake.tags?.name || null, depth, source: tagged ? 'osm' : damD != null ? 'dam' : slope != null ? 'slope' : 'none', reach, slope, damDepth: damD });
    // The distance to the shore has a crease wherever two shores are equally
    // far (down the middle of every bay), and the bed took it: flat facets
    // meeting in ridges. Away from the shore the distance is smoothed over
    // LAKE_SMOOTH_SHARE of the lake's reach; at the shore it stays exact.
    const dist = new Float32Array(gw * gh);
    for (let i = 0; i < gw * gh; i++) dist[i] = d2[i] >= 1e19 ? reachCells : Math.sqrt(d2[i]);
    const sigma = Math.min(LAKE_SMOOTH_MAX_CELLS, LAKE_SMOOTH_SHARE * reachCells);
    const soft = sigma >= 1 ? blurGrid(dist, gw, gh, sigma) : dist;
    // (and lightly near the shore: every jag of the waterline drew a streak down the bed)
    const nearSigma = Math.min(sigma, LAKE_NEAR_SMOOTH_M / cell);
    const near = nearSigma >= 1 ? blurGrid(dist, gw, gh, nearSigma) : dist;
    const nearOver = Math.max(LAKE_BANK_M, 3 * nearSigma * cell);
    let damSoft = null;
    if (damDist && damFar > 0) {
      const raw = new Float32Array(gw * gh);
      for (let i = 0; i < gw * gh; i++) raw[i] = damDist[i] >= 1e19 ? damFar : Math.sqrt(damDist[i]);
      damSoft = sigma >= 1 ? blurGrid(raw, gw, gh, sigma) : raw;
    }
    // (read between the cells' centres: a big lake's cells are several pixels wide)
    const sample = (g, c, r) => {
      const fx = Math.min(gw - 1, Math.max(0, (c - c0 - (k - 1) / 2) / k)); const fy = Math.min(gh - 1, Math.max(0, (r - r0 - (k - 1) / 2) / k));
      const x0 = Math.min(gw - 2, Math.floor(fx)); const y0 = Math.min(gh - 2, Math.floor(fy));
      if (x0 < 0 || y0 < 0) return g[0];
      const tx = fx - x0; const ty = fy - y0;
      return (g[y0 * gw + x0] * (1 - tx) + g[y0 * gw + x0 + 1] * tx) * (1 - ty) + (g[(y0 + 1) * gw + x0] * (1 - tx) + g[(y0 + 1) * gw + x0 + 1] * tx) * ty;
    };
    const cellOf = (c, r) => Math.min(gh - 1, Math.max(0, Math.floor((r - r0) / k))) * gw + Math.min(gw - 1, Math.max(0, Math.floor((c - c0) / k)));
    // (the floor's share of the depth at a spot: 1 at the dam, DAM_FAR_SHARE at the far end)
    const floorShare = (c, r) => (damSoft ? 1 - (1 - DAM_FAR_SHARE) * Math.min(1, sample(damSoft, c, r) / damFar) : 1);
    const blendOver = Math.max(LAKE_BANK_M, 2.5 * sigma * cell);
    for (let r = Math.max(0, Math.floor(pr0)); r <= Math.min(height - 1, Math.ceil(pr1)); r++) {
      for (let c = Math.max(0, Math.floor(pc0)); c <= Math.min(width - 1, Math.ceil(pc1)); c++) {
        const idx = r * width + c;
        const ground = heightMap[idx] - minHeight;
        // (the pixel's own height says whether it is water: a big lake's
        // cells are several pixels wide; a flaw's cell is cut whole)
        const gi = cellOf(c, r);
        const above = ground - level;
        if (loose ? above >= (shallow ? LAKE_CUT_FULL_M : LAKE_CUT_TOP_M)
          : above >= LAKE_CUT_FULL_M && !(flaw[gi] && above < LAKE_CUT_TOP_M)) continue;
        const [x, y] = toWorld(c, r);
        if (!poly.contains(x, y) || keep(x, y)) continue;
        const exact = sample(dist, c, r) * cell;
        const wn = Math.min(1, exact / nearOver);
        const ln = exact + (sample(near, c, r) * cell - exact) * wn * wn * (3 - 2 * wn);
        const w = Math.min(1, exact / blendOver);
        const l = ln + (sample(soft, c, r) * cell - ln) * w * w * (3 - 2 * w);
        const t = reach > 0 ? Math.min(1, Math.max(0, l) / reach) : 0;
        const edge = LAKE_BED_EDGE_M + (LAKE_BED_M - LAKE_BED_EDGE_M) * Math.min(1, exact / LAKE_BANK_M);
        let target = level - Math.max(edge, depth * t * (2 - t) * floorShare(c, r));
        // (ground a little over a rough or falling water surface: cut less and less, so the bank meets the bed without a step)
        if (loose && !shallow && above > LAKE_CUT_FULL_M) {
          const q = (above - LAKE_CUT_FULL_M) / (LAKE_CUT_TOP_M - LAKE_CUT_FULL_M);
          target += (ground - target) * q * q * (3 - 2 * q);
        }
        if (target < ground) edits.set(idx, Math.min(edits.get(idx) ?? Infinity, target + minHeight));
      }
    }
  }
  return { pixels: edits.size, lakes: report, indices: () => edits.keys(), apply(set) { for (const [idx, v] of edits) set(idx, v); } };
}

// Water hidden in the ground: under a bridge deck the elevation data often
// holds the deck itself (lidar: the canal under Amsterdam's bridges came out
// 3 m over the water, a dam with the river hidden in it, the bridge's arches
// springing from its top), and the deck's terrain cap only lowers it to just
// under the deck; between two bridges, or where the data smoothed over a
// narrow canal, a strip stood up the same way. A bed is carved to
// HIDDEN_BED_M under the water's surface: under decks wherever a river or a
// lake passes, and along a river whose width comes from its mapped outline
// wherever the ground stands at most HIDDEN_BANK_MAX_M over its water (higher
// is a bank the outline overlaps, left alone); sloping up to the edge over
// HIDDEN_SLOPE_M. Ground roads are kept (keep(x, y)): their quays and
// approaches stay on their ground.
const HIDDEN_BED_M = 1.5;
const HIDDEN_SLOPE_M = 2;
const HIDDEN_BANK_MAX_M = 4;

/**
 * Terrain edits for hidden water beds. rivers: planRivers' [{ nodes: [[x, y,
 * surface, width, depth]], outline }]; lakes: planLakes' [{ poly, level }];
 * grid as carveLakeBeds; covered(idx): a pixel under a deck; keep(x, y):
 * ground left as it is. Returns { pixels, apply(set) } (set(idx, raw)); only
 * ever lowers.
 */
export function carveWaterUnderDecks({ rivers = [], lakes = [] }, grid, covered, keep = () => false, keepUnder = keep) {
  const { heightMap, width, height, worldSize, minHeight = 0 } = grid;
  const toPixel = (x, y) => [(x / worldSize + 0.5) * width, ((0.5 - y / worldSize) * height - 1)];
  const toWorld = (c, r) => [((c / width) - 0.5) * worldSize, (0.5 - (r + 1) / height) * worldSize];
  const edits = new Map();
  const lower = (idx, target) => {
    if (target < heightMap[idx] - minHeight) edits.set(idx, Math.min(edits.get(idx) ?? Infinity, target + minHeight));
  };
  for (const { nodes, outline } of rivers) {
    for (let i = 0; i + 1 < nodes.length; i++) {
      const [ax, ay, az, aw] = nodes[i]; const [bx, by, bz, bw] = nodes[i + 1];
      const outlined = !!(outline?.[i] && outline?.[i + 1]);
      const reach = Math.max(aw, bw) / 2;
      const [c0, r0] = toPixel(Math.min(ax, bx) - reach, Math.max(ay, by) + reach);
      const [c1, r1] = toPixel(Math.max(ax, bx) + reach, Math.min(ay, by) - reach);
      const vx = bx - ax; const vy = by - ay; const L2 = vx * vx + vy * vy || 1e-9;
      for (let r = Math.max(0, Math.floor(r0)); r <= Math.min(height - 1, Math.ceil(r1)); r++) {
        for (let c = Math.max(0, Math.floor(c0)); c <= Math.min(width - 1, Math.ceil(c1)); c++) {
          const idx = r * width + c;
          const under = covered(idx);
          if (!under && !outlined) continue;
          const [x, y] = toWorld(c, r);
          const t = Math.max(0, Math.min(1, ((x - ax) * vx + (y - ay) * vy) / L2));
          const half = (aw + (bw - aw) * t) / 2;
          const d = Math.hypot(ax + vx * t - x, ay + vy * t - y);
          if (d > half) continue;
          const surface = az + (bz - az) * t;
          const ground = heightMap[idx] - minHeight;
          if (!under && ground > surface + HIDDEN_BANK_MAX_M) continue;
          if (ground <= surface - HIDDEN_BED_M || (under ? keepUnder(x, y) : keep(x, y))) continue;
          lower(idx, surface - HIDDEN_BED_M * Math.min(1, (half - d) / HIDDEN_SLOPE_M + 0.2));
        }
      }
    }
  }
  for (const { poly, level } of lakes) {
    const [x0, y0, x1, y1] = poly.box;
    const [c0, r0] = toPixel(x0, y1); const [c1, r1] = toPixel(x1, y0);
    for (let r = Math.max(0, Math.floor(r0)); r <= Math.min(height - 1, Math.ceil(r1)); r++) {
      for (let c = Math.max(0, Math.floor(c0)); c <= Math.min(width - 1, Math.ceil(c1)); c++) {
        const idx = r * width + c;
        if (!covered(idx)) continue;
        const [x, y] = toWorld(c, r);
        if (!poly.contains(x, y) || keepUnder(x, y)) continue;
        const d = Math.min(distToRing(x, y, poly.outer), ...poly.holes.map((h) => distToRing(x, y, h)));
        lower(idx, level - HIDDEN_BED_M * Math.min(1, d / HIDDEN_SLOPE_M + 0.2));
      }
    }
  }
  return { pixels: edits.size, indices: () => edits.keys(), apply(set) { for (const [idx, v] of edits) set(idx, v); } };
}

// A deck's own shape in the elevation data: under it the ground is held no
// higher than the line between the ground just outside its two sides (across
// the deck, station by station), where water lies beside it (wet(x, y): over
// roads and valleys the solver's corridors shape the ground), so the dam the
// deck left in the data goes. A deck's last LEVEL_END_M rest on their
// abutments' fill and are left unless water lies on both sides there; ground
// roads are kept (keep).
const LEVEL_END_M = 6;
const LEVEL_READ_M = [1, 5];  // the ground beside a deck: the lowest this far past its side (the data's dam is wider than the deck)
const LEVEL_PAST_M = 2;       // levelled this far past its sides (the dam's edges)

/**
 * Terrain edits levelling the ground under decks. decks: [{ parts: [{ xy, half,
 * halfL?, halfR? }] }]; grid as carveLakeBeds. Returns { pixels, apply(set) };
 * only ever lowers.
 */
export function levelUnderDecks(decks, grid, keep = () => false, extra = 0.4, wet = () => true) {
  const { heightMap, width, height, worldSize, minHeight = 0 } = grid;
  const px = worldSize / width;
  const toPixel = (x, y) => [(x / worldSize + 0.5) * width, ((0.5 - y / worldSize) * height - 1)];
  const at = (x, y) => {
    const [c, r] = toPixel(x, y);
    const ci = Math.round(c); const ri = Math.round(r);
    if (ci < 0 || ri < 0 || ci >= width || ri >= height) return null;
    return { idx: ri * width + ci, z: heightMap[ri * width + ci] - minHeight };
  };
  const edits = new Map();
  for (const deck of decks) {
    for (const p of deck.parts) {
      const xy = p.xy;
      const s = [0]; for (let i = 1; i < xy.length; i++) s.push(s[i - 1] + Math.hypot(xy[i][0] - xy[i - 1][0], xy[i][1] - xy[i - 1][1]));
      const L = s.at(-1);
      for (let i = 0; i + 1 < xy.length; i++) {
        const [ax, ay] = xy[i]; const [bx, by] = xy[i + 1];
        const segL = s[i + 1] - s[i]; if (segL < 1e-6) continue;
        const ux = (bx - ax) / segL; const uy = (by - ay) / segL; const nx = -uy; const ny = ux;
        for (let d = 0; d < segL; d += px * 0.7) {
          const sd = s[i] + d;
          const atEnd = sd < LEVEL_END_M || sd > L - LEVEL_END_M;
          const f = d / segL;
          const hl = (p.halfL ? p.halfL[i] + (p.halfL[i + 1] - p.halfL[i]) * f : p.half) + extra;
          const hr = (p.halfR ? p.halfR[i] + (p.halfR[i + 1] - p.halfR[i]) * f : p.half) + extra;
          const cx = ax + ux * d; const cy = ay + uy * d;
          const beside = (sign, h) => {
            let best = null;
            for (let o = h + LEVEL_READ_M[0]; o <= h + LEVEL_READ_M[1]; o += px * 0.7) {
              const q = at(cx + sign * nx * o, cy + sign * ny * o);
              if (q && (!best || q.z < best.z)) best = { z: q.z, o };
            }
            return best;
          };
          const gl = beside(1, hl); const gr = beside(-1, hr);
          if (!gl || !gr) continue;
          // (over water only: over roads and valleys the solver's corridors shape the ground)
          const wetL = wet(cx + nx * gl.o, cy + ny * gl.o); const wetR = wet(cx - nx * gr.o, cy - ny * gr.o);
          if (!wetL && !wetR) continue;
          // (an end with water on both sides is over the water, not on its abutment's fill)
          if (atEnd && !(wetL && wetR)) continue;
          for (let o = -(hr + LEVEL_PAST_M); o <= hl + LEVEL_PAST_M; o += px * 0.7) {
            const x = cx + nx * o; const y = cy + ny * o;
            const q = at(x, y);
            if (!q || keep(x, y)) continue;
            const t = Math.max(0, Math.min(1, (o + gr.o) / (gl.o + gr.o)));
            const target = gr.z + (gl.z - gr.z) * t;
            if (target < q.z - 0.05) edits.set(q.idx, Math.min(edits.get(q.idx) ?? Infinity, target + minHeight));
          }
        }
      }
    }
  }
  return { pixels: edits.size, indices: () => edits.keys(), apply(set) { for (const [idx, v] of edits) set(idx, v); } };
}

/**
 * The pixels the beds and the levelling skipped standing alone among lowered
 * ones (a river's edge or a deck's side through the grid left single pixels
 * standing metres proud: shards along the banks): a pixel with at least five
 * of its eight neighbours lowered takes their median, if lower, `rounds`
 * times. lowered: Set of indices already lowered. Returns { pixels,
 * apply(set) }; heightMap is read as it now stands.
 */
export function fillRemnants(heightMap, width, height, lowered, { rounds = 2, keep = () => false } = {}) {
  const edits = new Map();
  const z = (i) => edits.get(i) ?? heightMap[i];
  const low = new Set(lowered);
  for (let k = 0; k < rounds; k++) {
    const cand = new Set();
    for (const i of low) {
      const c = i % width; const r = (i - c) / width;
      for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
        const cc = c + dc; const rr = r + dr;
        if ((dr || dc) && cc >= 0 && rr >= 0 && cc < width && rr < height && !low.has(rr * width + cc)) cand.add(rr * width + cc);
      }
    }
    const next = [];
    for (const i of cand) {
      const c = i % width; const r = (i - c) / width;
      if (keep(c, r)) continue;
      const ns = [];
      for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
        if (!dr && !dc) continue;
        const j = (r + dr) * width + (c + dc);
        if (r + dr >= 0 && c + dc >= 0 && r + dr < height && c + dc < width && low.has(j)) ns.push(z(j));
      }
      if (ns.length < 5) continue;
      ns.sort((a, b) => a - b);
      const m = ns[ns.length >> 1];
      if (m < z(i) - 0.05) next.push([i, m]);
    }
    for (const [i, m] of next) { edits.set(i, m); low.add(i); }
    if (!next.length) break;
  }
  return { pixels: edits.size, indices: () => edits.keys(), apply(set) { for (const [idx, v] of edits) set(idx, v); } };
}

// ── The sea floor ────────────────────────────────────────────────────────────
// Lidar measures the water's surface, not the bed: the open sea came out as
// ground at sea level, 2 cm under the sea plane, a flat grassy "landmass"
// out in the ocean (St. Augustine). Where the land cover (ESA WorldCover)
// says water and the ground is within SEA_SURFACE_BAND_M of the sea, the
// ground goes down under it, SEABED_DEPTH_M deep, deepening over
// SEABED_RAMP_CELLS land cover cells (10 m each) from the shore. Lowered only.
const SEA_SURFACE_BAND_M = 0.3;
const SEABED_DEPTH_M = 2;
const SEABED_RAMP_CELLS = 3;
const SEA_SHOAL_MAX_M = 6;     // in water joined to the sea, ground up to this far over it is still the sea's floor
const COAST_REACH_M = 150;          // a cell is judged by a mapped coastline this near
const COAST_MARGIN_M = 2.5;         // the sea begins this far out from the mapped line
const COAST_FINE_M = 25;            // within this of the line a grid point is judged by itself, not by its 10 m land cover cell
const PIER_AREA_MAX_M = 2.5;         // ... and on coarse elevation no more than this
const PIER_AREA_TOP_M = 1.5;         // a pier mapped as an area stands this far over the sea
const COAST_VOTE_CELLS = 50;          // the land cover's water beside the coastline must agree on the sea's side: this many cells ...
const COAST_VOTE_SHARE = 0.8;         // ... and this share of them
const COAST_SEA_MAX_M = 40;         // ground on the coastline's sea side up to this far over the sea is the data's smear
const SEA_SEED_CELLS = 50;     // ... when at least this many cells of water lie at the sea's level (half a hectare at 10 m)

/**
 * Edits that put the sea floor under the sea: grid { heightMap, width,
 * height, minHeight } (raw heights, rows from the north as the export's
 * heightmap), landCover { grid, n } (north-up), seaZ the sea surface in world
 * z (raw - minHeight); coarse: the elevation is the global 30 m data; coast: mapped coastlines as world [x, y]
 * lines in the way's own order (land on the left); keep(x, y): ground that stays
 * (roads and their quays; needs grid.worldSize). Returns { pixels, apply(set) }.
 */
export function lowerSeabed(grid, landCover, seaZ, { coarse = false, keep = null, coast = null, piers = null } = {}) {
  const { heightMap, width, height, minHeight = 0, worldSize = 0 } = grid;
  const none = { pixels: 0, pierPixels: 0, apply() {}, under: () => false, has: () => false };
  if (!landCover?.grid || landCover.grid.length !== landCover.n * landCover.n || !Number.isFinite(seaZ)) return none;
  const { grid: lc, n } = landCover;
  // (water, or no land cover at all: the open sea beyond WorldCover's tiles)
  const wet = (k) => k === 80 || k === 0;
  // Coarse elevation, and the coastline is mapped: what lies on its sea side is sea, whatever the land cover's
  // 10 m cells make of the wet sand and the surf. (Sint Eustatius: the land cover's shore runs 30 to 80 m
  // seaward of the mapped one in places, and under the cliffs the 30 m data holds the water 5 to 18 m up, 100 m
  // out: a white shelf along the whole town.) OpenStreetMap draws a coastline with the land on its left; a cell is judged by the stretch of
  // coastline nearest to it, within COAST_REACH_M.
  const byCoast = new Uint8Array(n * n);
  const landByCoast = new Uint8Array(n * n);
  // (the stretches of coastline near each land cover cell beside the line: there the side is judged per grid
  // point, not per 10 m cell, or the shore comes out in 10 m blocks and a pier the line is drawn round in pieces)
  const nearSegs = new Map(); const segs = [];
  if (coarse && coast?.length && worldSize > 0) {
    const cellM = worldSize / n; const best = new Float32Array(n * n).fill(Infinity); const side = new Int8Array(n * n);
    for (const line of coast) {
      // (a line that stops, at the map's edge or where the data has a gap, says nothing past its end: Naples,
      // Florida, where the coastline in the data ended at a beach and the square of town beyond the end, to the
      // right of the last stretch drawn on, went under)
      const open = !(line.length > 2 && Math.hypot(line[0][0] - line[line.length - 1][0], line[0][1] - line[line.length - 1][1]) < 0.5);
      for (let k = 1; k < line.length; k++) {
        const [ax, ay] = line[k - 1]; const [bx, by] = line[k]; const dx = bx - ax; const dy = by - ay; const len2 = dx * dx + dy * dy;
        if (!(len2 > 1e-6)) continue;
        const freeStart = open && k === 1; const freeEnd = open && k === line.length - 1;
        const segId = segs.length; segs.push([ax, ay, dx, dy, len2, freeStart, freeEnd]);
        const c0 = Math.max(0, Math.floor((Math.min(ax, bx) - COAST_REACH_M) / cellM + n / 2)); const c1 = Math.min(n - 1, Math.ceil((Math.max(ax, bx) + COAST_REACH_M) / cellM + n / 2));
        const r0 = Math.max(0, Math.floor(n / 2 - (Math.max(ay, by) + COAST_REACH_M) / cellM)); const r1 = Math.min(n - 1, Math.ceil(n / 2 - (Math.min(ay, by) - COAST_REACH_M) / cellM));
        for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) {
          const px = (c + 0.5 - n / 2) * cellM; const py = (n / 2 - r - 0.5) * cellM;
          const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2));
          const d = Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
          if (d > COAST_REACH_M) continue;
          if (d <= COAST_FINE_M) { const list = nearSegs.get(r * n + c); if (list) list.push(segId); else nearSegs.set(r * n + c, [segId]); }
          // (right of the way's direction: the sea)
          const past = (freeStart && t <= 0) || (freeEnd && t >= 1);
          const sea = past ? 0 : dx * (py - ay) - dy * (px - ax) < 0 ? 1 : -1; const i = r * n + c;
          if (d < best[i] - 0.01) { best[i] = d; side[i] = sea; }
          // (nearest at a corner shared by two stretches: sea only if both say so)
          else if (d <= best[i] + 0.01 && sea < 0) side[i] = -1;
        }
      }
    }
    // The land cover's own water votes on the coastline first: where the two disagree about which side the
    // sea is on (a coastline drawn the wrong way round, a source that lost the ways' order), the coastline
    // is not believed and nothing is added.
    let agree = 0; let against = 0;
    for (let i = 0; i < n * n; i++) { if (!side[i]) continue; if (wet(lc[i])) { if (side[i] > 0) agree++; else against++; } }
    if (agree >= COAST_VOTE_CELLS && agree >= COAST_VOTE_SHARE * (agree + against)) {
      // (the land cover's own water there too: under a cliff the data holds it 5 to 18 m up, past the flood's 6 m)
      for (let i = 0; i < n * n; i++) if (side[i] > 0) byCoast[i] = 1;
      // (and its land side is land: a breakwater the coastline is drawn round stays, though the land cover's
      // 10 m cells call most of it water)
      for (let i = 0; i < n * n; i++) if (side[i] < 0) landByCoast[i] = 1;
    } else nearSegs.clear();
  }
  // distance (in cells) from the nearest non-water cell, two chamfer passes
  const D = new Float32Array(n * n);
  const BIG = 1e9;
  for (let i = 0; i < n * n; i++) D[i] = wet(lc[i]) || byCoast[i] ? BIG : 0;
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) {
    const i = r * n + c; if (!D[i]) continue;
    if (c > 0) D[i] = Math.min(D[i], D[i - 1] + 1);
    if (r > 0) D[i] = Math.min(D[i], D[i - n] + 1);
  }
  for (let r = n - 1; r >= 0; r--) for (let c = n - 1; c >= 0; c--) {
    const i = r * n + c; if (!D[i]) continue;
    if (c < n - 1) D[i] = Math.min(D[i], D[i + 1] + 1);
    if (r < n - 1) D[i] = Math.min(D[i], D[i + n] + 1);
  }
  const top = seaZ + SEA_SURFACE_BAND_M;
  // The sea itself, by the land cover: water joined to water that lies at the sea's level (or to the open
  // sea beyond the tiles), through water whose ground is no more than SEA_SHOAL_MAX_M over it. Coarse
  // elevation carries the land's height out over the water: off Visakhapatnam's beach the global 30 m data
  // has the "sea floor" 3.3 m over the sea at the shore, 1.2 m at 30 to 100 m out, and level only from 100 m
  // (glitter_shitter: "the water doesn't reach the shore", and raising the sea drowned the low town). All of
  // that is under the sea. A lake up in the hills is not joined to it; a river is, as far up as its bed in
  // the data stays within the band: its tidal mouth.
  const cellZ = new Float32Array(n * n);
  for (let r = 0; r < n; r++) {
    const hr = Math.min(height - 1, Math.floor(((r + 0.5) / n) * height)) * width;
    for (let c = 0; c < n; c++) cellZ[r * n + c] = heightMap[hr + Math.min(width - 1, Math.floor(((c + 0.5) / n) * width))] - minHeight;
  }
  const sea = new Uint8Array(n * n);
  const queue = new Int32Array(n * n); let qh = 0; let qt = 0;
  for (let i = 0; i < n * n; i++) if (D[i] && (lc[i] === 0 || cellZ[i] <= top)) { sea[i] = 1; queue[qt++] = i; }
  // (coarse elevation only: a fine survey has a breakwater or a sandbar where it stands, and the land cover's
  // 10 m cells may call it water)
  if (coarse && qt >= SEA_SEED_CELLS) {
    const reach = seaZ + SEA_SHOAL_MAX_M;
    while (qh < qt) {
      const i = queue[qh++]; const c = i % n;
      for (const k of [c > 0 ? i - 1 : -1, c < n - 1 ? i + 1 : -1, i - n, i + n]) {
        if (k < 0 || k >= n * n || sea[k] || !D[k] || cellZ[k] > reach || landByCoast[k]) continue;
        sea[k] = 1; queue[qt++] = k;
      }
    }
  } else sea.fill(0);
  // (the coastline's own sea: no flood needed, the map says so; not ground far over the sea, which is a
  // coastline drawn the wrong way round or a cliff the data did resolve)
  if (coarse) for (let i = 0; i < n * n; i++) if (byCoast[i] && cellZ[i] <= seaZ + COAST_SEA_MAX_M) sea[i] = 2;
  const edits = new Map();
  const shoal = seaZ + SEA_SHOAL_MAX_M;
  for (let r = 0; r < height; r++) {
    const lr = Math.min(n - 1, Math.floor((r / height) * n)) * n;
    for (let c = 0; c < width; c++) {
      const cell = lr + Math.min(n - 1, Math.floor((c / width) * n));
      let d = D[cell];
      const idx = r * width + c;
      const z = heightMap[idx] - minHeight;
      // beside the mapped coastline: this grid point's own side of it
      let seaHere = sea[cell]; let landHere = landByCoast[cell];
      const list = nearSegs.get(cell);
      if (list) {
        const px = ((c + 0.5) / width - 0.5) * worldSize; const py = (0.5 - (r + 0.5) / height) * worldSize;
        let best = Infinity; let sd = 0;
        for (const k of list) {
          const [ax, ay, dx, dy, len2, freeStart, freeEnd] = segs[k];
          const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2));
          const dist = Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
          const sgn = (freeStart && t <= 0) || (freeEnd && t >= 1) ? 0 : dx * (py - ay) - dy * (px - ax) < 0 ? 1 : -1;
          if (dist < best - 0.01) { best = dist; sd = sgn; } else if (dist <= best + 0.01 && sgn < 0) sd = -1;
        }
        // (not the last couple of metres before the line: a promenade or a quay's kerb is mapped a little to
        // either side of it, and its ground went from under it: Naples's seafront walks floated)
        if (sd > 0 && best < COAST_MARGIN_M) { landHere = 1; }
        else if (sd > 0) { landHere = 0; if (z <= seaZ + COAST_SEA_MAX_M) { seaHere = 2; if (!d) d = 1; } }
        else if (sd < 0) { landHere = 1; }
      }
      if (!d) continue;
      if (z > top) {
        if (landHere) continue;
        if (!(seaHere && z <= (seaHere === 2 ? seaZ + COAST_SEA_MAX_M : shoal))) continue;
        // (a road along the shore, and its quay, stay on their ground: the land cover's 10 m cells run a
        // little under a seafront street, and its ground went 2 m down from under it)
        if (keep && worldSize > 0 && keep(((c / width) - 0.5) * worldSize, (0.5 - (r + 1) / height) * worldSize)) continue;
      }
      const target = seaZ - SEABED_DEPTH_M * Math.min(1, d / SEABED_RAMP_CELLS);
      if (target < z) edits.set(idx, target + minHeight);
    }
  }
  // A pier, breakwater, groyne or quay mapped as an area is a platform over the water. Where the ground under
  // it is at the sea or under it (the data has none: the 30 m data never does, a bare-earth survey took it
  // out; or has half of one, and a breakwater came out as a row of separate blocks), it is stood up as one,
  // PIER_AREA_TOP_M over the sea.
  let pierPixels = 0;
  // (coarse elevation only: a fine survey has what stands there, and a platform added beside its quays and
  // bridges stood up as steps: Amsterdam)
  if (coarse && piers?.length && worldSize > 0) {
    const sq = worldSize / width; const topZ = seaZ + PIER_AREA_TOP_M;
    for (const ring of piers) {
      if (!(ring?.length >= 3)) continue;
      let x0 = Infinity; let x1 = -Infinity; let y0 = Infinity; let y1 = -Infinity;
      for (const [x, y] of ring) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
      const c0 = Math.max(0, Math.floor(x0 / sq + width / 2)); const c1 = Math.min(width - 1, Math.ceil(x1 / sq + width / 2));
      const r0 = Math.max(0, Math.floor(height / 2 - y1 / sq) - 1); const r1 = Math.min(height - 1, Math.ceil(height / 2 - y0 / sq));
      const inside = [];
      for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) {
        const x = (c / width - 0.5) * worldSize; const y = (0.5 - (r + 1) / height) * worldSize;
        let hit = false;
        for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) if (((ring[i][1] > y) !== (ring[j][1] > y)) && (x < ((ring[j][0] - ring[i][0]) * (y - ring[i][1])) / (ring[j][1] - ring[i][1]) + ring[i][0])) hit = !hit;
        if (!hit) continue;
        inside.push(r * width + c);
      }
      // (only what is under that height: a pier or a mole the data has standing higher is left as the data has it)
      for (const idx of inside) {
        const now = edits.has(idx) ? edits.get(idx) - minHeight : heightMap[idx] - minHeight;
        if (now < topZ || edits.has(idx)) { edits.set(idx, topZ + minHeight); pierPixels++; }
        // (coarse elevation: the land's height carried out along it made the harbour pier of Sint Eustatius a
        // wall 6 to 8 m over the water; such a structure stands a couple of metres over the sea)
        else if (coarse && now > seaZ + PIER_AREA_MAX_M) { edits.set(idx, seaZ + PIER_AREA_MAX_M + minHeight); pierPixels++; }
      }
    }
  }
  return {
    pierPixels,
    pixels: edits.size,
    apply(set) { for (const [idx, v] of edits) set(idx, v); },
    /** Whether the heightmap cell idx is sea floor that goes under. */
    has(idx) { return edits.has(idx); },
    /** Whether the ground at world (x, y) is sea floor that goes under (needs grid.worldSize). */
    under(x, y) {
      if (!(worldSize > 0)) return false;
      const c = Math.round((x / worldSize + 0.5) * width); const r = Math.round((0.5 - y / worldSize) * height) - 1;
      return c >= 0 && r >= 0 && c < width && r < height && edits.has(r * width + c);
    },
  };
}
