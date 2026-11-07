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
const LAKE_TILE_OVERLAP_M = 0.5;
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
    if (!isRiverbank(t)) continue;
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
export function tileOutline(poly, cell, hidden = () => false) {
  const [x0, y0, x1, y1] = poly.box;
  const c = Math.min(cell, Math.max(SHORE_CELL_M[0], Math.min(SHORE_CELL_M[1], cell / 4), Math.max(x1 - x0, y1 - y0) / SHORE_GRID_MAX));
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

/**
 * Lake tiles: [{ cx, cy, sx, sy, z, lake }] (WaterBlock rectangles, z the
 * water surface), plus stats and lakes [{ poly, level }] (carveLakeBeds).
 */
export function planLakes({ features = [], toWorld, heightAt, seaZ = null }) {
  const tiles = [];
  const lakes = [];   // { poly, level } for carveLakeBeds
  const stats = { lakes: 0, dry: 0, tiles: 0, riverAreas: 0 };
  let lakeIndex = 0;
  for (const f of features) {
    if (f.type !== 'water' || !(f.geometry?.length > 3) || !isClosed(f.geometry)) continue;
    const t = f.tags || {};
    const river = isRiverbank(t);
    if (t.waterway && !river) continue;
    // (a fountain's basin or a pool is built with it: services/fountains.js, pools.js)
    if (norm(t.amenity) === 'fountain' || norm(t.leisure) === 'swimming_pool') continue;
    if (['sea', 'ocean'].includes(norm(t.place)) || norm(t.natural) === 'bay' || ['dock', 'harbour'].includes(norm(t.water)) || norm(t.leisure) === 'marina') continue;
    const isLake = river || (norm(t.natural) === 'water' ? (!t.water || LAKE_WATER.has(norm(t.water))) : ['reservoir', 'basin'].includes(norm(t.landuse)));
    if (!isLake) continue;
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
    // tiles: every small cell the outline touches, merged (the water reaches
    // the shore; past it by at most one cell, and only where the bank stands
    // over the water and hides it)
    const area = Math.abs(poly.outer.reduce((a, p, i) => { const q = poly.outer[(i + 1) % poly.outer.length]; return a + p[0] * q[1] - q[0] * p[1]; }, 0)) / 2;
    const lakeTiles = tileOutline(poly, Math.min(LAKE_CELL_M[1], Math.max(LAKE_CELL_M[0], Math.sqrt(area) / 16)), (x, y) => heightAt(x, y) > level + BANK_HIDES_M);
    if (!lakeTiles.length) continue;
    stats.lakes++;
    for (const tile of lakeTiles) tiles.push({ ...tile, sx: tile.sx + LAKE_TILE_OVERLAP_M, sy: tile.sy + LAKE_TILE_OVERLAP_M, z: level, lake: lakeIndex, name: t.name || null });
    lakes.push({ poly, level });
    lakeIndex++;
  }
  stats.tiles = tiles.length;
  return { tiles, stats, lakes };
}

// A bed under standing water: elevation data that records a water body's
// surface as its ground (lidar off canals, harbours, ponds) left the terrain
// level with the water, which then never showed (Amsterdam's canals: water
// 5 cm over the ground). Inside each lake the ground near its level is
// lowered to LAKE_BED_M under it, sloping up to LAKE_BED_EDGE_M under it over
// LAKE_BANK_M from the shore. Ground already deeper is left; nothing raised.
// Only ground near the water is cut: up to LAKE_CUT_FULL_M over the level
// fully, the cut fading out by LAKE_CUT_TOP_M; higher ground inside the
// outline (a reservoir's bank, its drawdown ring, an island's slope) is left
// as it is. Cut to the bed regardless, it stood as a wall all along the shore
// wherever the outline climbed the bank (Lac du Chevril, Tignes).
const LAKE_BED_M = 1.5;
const LAKE_BED_EDGE_M = 0.3;
const LAKE_BANK_M = 3;
const LAKE_CUT_FULL_M = 0.5;
const LAKE_CUT_TOP_M = 2.5;
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
/**
 * Terrain edits for lake beds. grid: { heightMap, width, height, worldSize,
 * minHeight } (raw heights; world z = raw - minHeight; world x, y centred,
 * y north). keep(x, y): ground left as it is (a road and its sidewalks: a
 * canal's outline often reaches the quay, and a bed under it left the
 * sidewalks floating). Returns { pixels, apply(set) }: set(idx, raw).
 */
export function carveLakeBeds(lakes, grid, { keep = () => false } = {}) {
  const { heightMap, width, height, worldSize, minHeight = 0 } = grid;
  const toPixel = (x, y) => [(x / worldSize + 0.5) * (width - 1), (0.5 - y / worldSize) * (height - 1)];
  const toWorld = (c, r) => [((c / (width - 1)) - 0.5) * worldSize, (0.5 - r / (height - 1)) * worldSize];
  const edits = new Map();
  for (const { poly, level } of lakes || []) {
    const [x0, y0, x1, y1] = poly.box;
    const [c0, r0] = toPixel(x0, y1); const [c1, r1] = toPixel(x1, y0);
    for (let r = Math.max(0, Math.floor(r0)); r <= Math.min(height - 1, Math.ceil(r1)); r++) {
      for (let c = Math.max(0, Math.floor(c0)); c <= Math.min(width - 1, Math.ceil(c1)); c++) {
        const [x, y] = toWorld(c, r);
        if (!poly.contains(x, y) || keep(x, y)) continue;
        const idx = r * width + c;
        const ground = heightMap[idx] - minHeight;
        if (ground < level - LAKE_BED_M) continue;
        const above = ground - level;
        if (above >= LAKE_CUT_TOP_M) continue;
        const d = Math.min(distToRing(x, y, poly.outer), ...poly.holes.map((h) => distToRing(x, y, h)));
        const depth = LAKE_BED_EDGE_M + (LAKE_BED_M - LAKE_BED_EDGE_M) * Math.min(1, d / LAKE_BANK_M);
        let target = level - depth;
        // (ground a little over the water: cut less and less, so the bank meets the bed without a step)
        if (above > LAKE_CUT_FULL_M) {
          const k = (above - LAKE_CUT_FULL_M) / (LAKE_CUT_TOP_M - LAKE_CUT_FULL_M);
          target += (ground - target) * k * k * (3 - 2 * k);
        }
        if (target < ground) edits.set(idx, Math.min(edits.get(idx) ?? Infinity, target + minHeight));
      }
    }
  }
  return { pixels: edits.size, indices: () => edits.keys(), apply(set) { for (const [idx, v] of edits) set(idx, v); } };
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
  const toPixel = (x, y) => [(x / worldSize + 0.5) * (width - 1), (0.5 - y / worldSize) * (height - 1)];
  const toWorld = (c, r) => [((c / (width - 1)) - 0.5) * worldSize, (0.5 - r / (height - 1)) * worldSize];
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
  const px = worldSize / (width - 1);
  const toPixel = (x, y) => [(x / worldSize + 0.5) * (width - 1), (0.5 - y / worldSize) * (height - 1)];
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

/**
 * Edits that put the sea floor under the sea: grid { heightMap, width,
 * height, minHeight } (raw heights, rows from the north as the export's
 * heightmap), landCover { grid, n } (north-up), seaZ the sea surface in world
 * z (raw - minHeight). Returns { pixels, apply(set) }.
 */
export function lowerSeabed(grid, landCover, seaZ) {
  const { heightMap, width, height, minHeight = 0 } = grid;
  const none = { pixels: 0, apply() {} };
  if (!landCover?.grid || landCover.grid.length !== landCover.n * landCover.n || !Number.isFinite(seaZ)) return none;
  const { grid: lc, n } = landCover;
  // distance (in cells) from the nearest non-water cell, two chamfer passes
  const D = new Float32Array(n * n);
  const BIG = 1e9;
  for (let i = 0; i < n * n; i++) D[i] = lc[i] === 80 ? BIG : 0;
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
  const edits = new Map();
  const top = seaZ + SEA_SURFACE_BAND_M;
  for (let r = 0; r < height; r++) {
    const lr = Math.min(n - 1, Math.floor((r / height) * n)) * n;
    for (let c = 0; c < width; c++) {
      const d = D[lr + Math.min(n - 1, Math.floor((c / width) * n))];
      if (!d) continue;
      const idx = r * width + c;
      const z = heightMap[idx] - minHeight;
      if (z > top) continue;
      const target = seaZ - SEABED_DEPTH_M * Math.min(1, d / SEABED_RAMP_CELLS);
      if (target < z) edits.set(idx, target + minHeight);
    }
  }
  return { pixels: edits.size, apply(set) { for (const [idx, v] of edits) set(idx, v); } };
}
