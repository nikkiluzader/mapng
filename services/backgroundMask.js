// Background areas: parts of the export square the player won't drive. They keep their
// terrain shape but get no objects, and are fetched at lower detail (Location step,
// Advanced mode; components/controls/BackgroundAreas.vue draws them on the 2D map).
//
// The mask is stored in lat/lng so it survives a reload and goes into a desktop
// project's generate inputs:
//   { version: 1, bounds: { north, south, east, west },     // the box it was drawn for
//     lines: [[[lat, lng], ...], ...],                       // drawn lines (snapped)
//     shade: [[lat, lng], ...],                              // bucket clicks: areas made background
//     unshade: [[lat, lng], ...],                            // areas made drivable again inside the corridor
//     roads: [{ id, name, lines: [[[lat, lng], ...], ...] }], // roads kept to drive (one name, many ways)
//     widthM: 300,                                           // corridor half-width
//     paint: [{ keep, kind: 'brush'|'poly', r, pts: [[lat, lng]] }] }  // Unmask tool strokes, in order
//
// Rules: the square's edge is part of every outline, so a line from edge to edge or a
// loop closes areas; a line that closes nothing is "open" (shown with an X); the bucket
// shades a closed area, and never the whole square. With roads kept, everything farther
// than widthM from them is background unless unshaded. Last, the Unmask tool's strokes
// (brush strokes r metres wide each side, or filled shapes) make ground kept (keep) or
// background (!keep), each over what came before. Pure: no DOM, no Vue.

export const MASK_VERSION = 1;
const SLIVER = 12; // cells: areas this small (in line corners) don't count

export function emptyMask() {
  return { version: MASK_VERSION, bounds: null, lines: [], shade: [], unshade: [], roads: [], widthM: 300, paint: [] };
}

/** A kept road's polylines (lines, or one pts list). */
export const roadLines = (r) => (Array.isArray(r?.lines) ? r.lines : Array.isArray(r?.pts) ? [r.pts] : []);

export function maskHasAreas(mask) {
  return !!mask && ((mask.shade?.length || 0) > 0 || (mask.roads?.length || 0) > 0 || (mask.paint || []).some((p) => !p.keep));
}

/** lat/lng ↔ cell coordinates of an n×n grid over bounds (x east, y south, both 0..n). */
export function makeProjector(bounds, n) {
  const { north, south, east, west } = bounds;
  return {
    toCell: ([lat, lng]) => [((lng - west) / (east - west)) * n, ((north - lat) / (north - south)) * n],
    toLatLng: ([x, y]) => [north - (y / n) * (north - south), west + (x / n) * (east - west)],
  };
}

function stamp(arr, n, a, b, rad) {
  const d = Math.hypot(b[0] - a[0], b[1] - a[1]);
  const steps = Math.max(1, Math.ceil(d * 2));
  const r = Math.ceil(rad), r2 = rad * rad;
  for (let s = 0; s <= steps; s++) {
    const x = a[0] + ((b[0] - a[0]) * s) / steps, y = a[1] + ((b[1] - a[1]) * s) / steps;
    const cx0 = Math.round(x), cy0 = Math.round(y);
    for (let oy = -r; oy <= r; oy++) {
      const cy = cy0 + oy; if (cy < 0 || cy >= n) continue;
      for (let ox = -r; ox <= r; ox++) {
        if (ox * ox + oy * oy > r2) continue;
        const cx = cx0 + ox; if (cx >= 0 && cx < n) arr[cy * n + cx] = 1;
      }
    }
  }
}

/** Lines (cell coords) as walls on an n×n grid. */
export function rasterLines(cellLines, n, rad = 1.2) {
  const w = new Uint8Array(n * n);
  for (const pts of cellLines) {
    if (pts.length === 1) stamp(w, n, pts[0], pts[0], rad);
    for (let i = 1; i < pts.length; i++) stamp(w, n, pts[i - 1], pts[i], rad);
  }
  return w;
}

/** Connected areas between walls (4-neighbour): { labels (−1 on walls), areas, count (non-sliver) }. */
export function labelAreas(walls, n) {
  const labels = new Int32Array(n * n).fill(-1);
  const areas = [];
  const q = new Int32Array(n * n);
  let id = 0;
  for (let i = 0; i < n * n; i++) {
    if (walls[i] || labels[i] >= 0) continue;
    let h = 0, t = 0, a = 0;
    q[t++] = i; labels[i] = id;
    while (h < t) {
      const c = q[h++]; a++;
      const x = c % n;
      if (x > 0 && !walls[c - 1] && labels[c - 1] < 0) { labels[c - 1] = id; q[t++] = c - 1; }
      if (x < n - 1 && !walls[c + 1] && labels[c + 1] < 0) { labels[c + 1] = id; q[t++] = c + 1; }
      if (c >= n && !walls[c - n] && labels[c - n] < 0) { labels[c - n] = id; q[t++] = c - n; }
      if (c < n * n - n && !walls[c + n] && labels[c + n] < 0) { labels[c + n] = id; q[t++] = c + n; }
    }
    areas.push(a); id++;
  }
  return { labels, areas, count: areas.filter((a) => a > SLIVER).length };
}

/** Which lines close nothing: removing one doesn't change how many areas there are. */
export function openLines(cellLines, n) {
  const all = labelAreas(rasterLines(cellLines, n), n).count;
  return cellLines.map((_, i) => labelAreas(rasterLines(cellLines.filter((__, j) => j !== i), n), n).count === all);
}

/**
 * Snap a freshly drawn line's ends (cell coords) shut: to the square's edge, another line, or
 * its own far part, when within `snap` cells. Returns the new point list.
 */
export function snapLineEnds(pts, otherLines, n, snap) {
  if (pts.length < 2) return pts;
  const snapOne = (line, atStart) => {
    const p = atStart ? line[0] : line[line.length - 1];
    const edges = [[p[0], 0], [p[0], n], [0, p[1]], [n, p[1]]]
      .map((q) => ({ q, d: Math.hypot(q[0] - p[0], q[1] - p[1]) }))
      .sort((a, b) => a.d - b.d);
    let best = null, bd = snap;
    for (const l of otherLines) for (const q of l) { const d = Math.hypot(q[0] - p[0], q[1] - p[1]); if (d < bd) { bd = d; best = q; } }
    const far = atStart ? line.slice(12) : line.slice(0, -12);
    for (const q of far) { const d = Math.hypot(q[0] - p[0], q[1] - p[1]); if (d < bd) { bd = d; best = q; } }
    // a little past the edge so the wall meets the border cells
    const edge = edges[0].d < snap && edges[0].d <= bd
      ? edges[0].q.map((v) => (v <= 0 ? -1 : v >= n ? n + 1 : v))
      : null;
    const target = edge || best;
    if (!target) return line;
    return atStart ? [target, ...line] : [...line, target];
  };
  return snapOne(snapOne(pts.map((p) => [...p]), true), false);
}

/**
 * The mask as an n×n background raster (1 = background), plus what the editor needs to
 * draw it. `n` sets the precision (the editor uses ~512; generate/export use 1024+).
 */
export function rasterizeMask(mask, n = 512, { metersAcross = 0 } = {}) {
  const out = { n, bg: new Uint8Array(n * n), labels: null, areas: [], count: 1, walls: null, open: [], cellLines: [] };
  if (!mask?.bounds) return out;
  const proj = makeProjector(mask.bounds, n);
  out.cellLines = (mask.lines || []).map((l) => l.map(proj.toCell));
  out.walls = rasterLines(out.cellLines, n);
  const L = labelAreas(out.walls, n);
  out.labels = L.labels; out.areas = L.areas; out.count = L.count;
  out.open = out.cellLines.length ? openLines(out.cellLines, n) : [];

  const regionAt = ([lat, lng]) => {
    const [x, y] = proj.toCell([lat, lng]);
    const xi = Math.floor(x), yi = Math.floor(y);
    if (xi < 0 || yi < 0 || xi >= n || yi >= n) return -1;
    return nearestLabel(out.labels, out.walls, n, xi, yi);
  };
  const free = n * n - out.walls.reduce((s, v) => s + v, 0);
  const shaded = new Set();
  for (const s of mask.shade || []) {
    const l = regionAt(s);
    if (l >= 0 && out.areas[l] < free - SLIVER) shaded.add(l); // never the whole square
  }
  const unshaded = new Set();
  for (const s of mask.unshade || []) { const l = regionAt(s); if (l >= 0) unshaded.add(l); }

  // (the square's size from its own box when not given: a metric square, north–south)
  if (!(metersAcross > 0)) metersAcross = (mask.bounds.north - mask.bounds.south) * 111320;
  let corridor = null;
  if ((mask.roads || []).length && metersAcross > 0) {
    // (within widthM of a kept road: a distance transform, any width at any size)
    const rad = (Number(mask.widthM) || 300) / (metersAcross / n);
    const seeds = rasterLines(mask.roads.flatMap(roadLines).map((l) => l.map(proj.toCell)), n, 0.75);
    const d2 = squaredDistance(seeds, n);
    corridor = new Uint8Array(n * n);
    const r2 = rad * rad;
    for (let i = 0; i < n * n; i++) corridor[i] = d2[i] <= r2 ? 1 : 0;
  }
  for (let i = 0; i < n * n; i++) {
    let l = out.labels[i];
    if (l < 0) l = nearestLabel(out.labels, out.walls, n, i % n, (i / n) | 0);
    const outside = corridor ? !corridor[i] && !unshaded.has(l) : false;
    out.bg[i] = outside || shaded.has(l) ? 1 : 0;
  }
  for (const p of mask.paint || []) {
    const pts = (p.pts || []).map(proj.toCell);
    const val = p.keep ? 0 : 1;
    if (p.kind === 'poly') fillPolygon(out.bg, n, pts, val);
    else brushStroke(out.bg, n, pts, (Number(p.r) || 0) / (metersAcross / n), val);
  }
  return out;
}

// Set every cell whose centre is inside the polygon (cell coords, even-odd) to val.
function fillPolygon(arr, n, pts, val) {
  if (pts.length < 3) return;
  let y0 = Infinity, y1 = -Infinity;
  for (const p of pts) { y0 = Math.min(y0, p[1]); y1 = Math.max(y1, p[1]); }
  const xs = [];
  for (let y = Math.max(0, Math.floor(y0)); y <= Math.min(n - 1, Math.ceil(y1)); y++) {
    const cy = y + 0.5;
    xs.length = 0;
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      const a = pts[i], b = pts[j];
      if ((a[1] > cy) !== (b[1] > cy)) xs.push(a[0] + ((cy - a[1]) / (b[1] - a[1])) * (b[0] - a[0]));
    }
    xs.sort((p, q) => p - q);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const xa = Math.max(0, Math.ceil(xs[k] - 0.5)), xb = Math.min(n - 1, Math.floor(xs[k + 1] - 0.5));
      for (let x = xa; x <= xb; x++) arr[y * n + x] = val;
    }
  }
}

// Set every cell within rad cells of the stroke (cell coords) to val: segment distance
// over each segment's box, so any brush size at any n stays cheap.
function brushStroke(arr, n, pts, rad, val) {
  if (!pts.length || !(rad > 0)) return;
  const r2 = rad * rad;
  const segs = pts.length === 1 ? [[pts[0], pts[0]]] : pts.slice(1).map((b, i) => [pts[i], b]);
  for (const [a, b] of segs) {
    const dx = b[0] - a[0], dy = b[1] - a[1], len2 = dx * dx + dy * dy;
    const xa = Math.max(0, Math.floor(Math.min(a[0], b[0]) - rad)), xb = Math.min(n - 1, Math.ceil(Math.max(a[0], b[0]) + rad));
    const ya = Math.max(0, Math.floor(Math.min(a[1], b[1]) - rad)), yb = Math.min(n - 1, Math.ceil(Math.max(a[1], b[1]) + rad));
    for (let y = ya; y <= yb; y++) {
      const cy = y + 0.5;
      for (let x = xa; x <= xb; x++) {
        const cx = x + 0.5;
        let t = len2 ? ((cx - a[0]) * dx + (cy - a[1]) * dy) / len2 : 0;
        t = t < 0 ? 0 : t > 1 ? 1 : t;
        const ex = cx - (a[0] + t * dx), ey = cy - (a[1] + t * dy);
        if (ex * ex + ey * ey <= r2) arr[y * n + x] = val;
      }
    }
  }
}

// Squared distance (cells) from every cell to the nearest set cell: Felzenszwalb &
// Huttenlocher's exact transform, a 1-D pass along rows then columns.
function squaredDistance(set, n) {
  const INF = 1e20;
  const g = new Float64Array(n * n);
  for (let i = 0; i < n * n; i++) g[i] = set[i] ? 0 : INF;
  const f = new Float64Array(n), d = new Float64Array(n), v = new Int32Array(n), z = new Float64Array(n + 1);
  const pass = (get, put) => {
    for (let q = 0; q < n; q++) f[q] = get(q);
    let k = 0; v[0] = 0; z[0] = -INF; z[1] = INF;
    for (let q = 1; q < n; q++) {
      let sq = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
      while (sq <= z[k]) { k--; sq = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]); }
      k++; v[k] = q; z[k] = sq; z[k + 1] = INF;
    }
    k = 0;
    for (let q = 0; q < n; q++) { while (z[k + 1] < q) k++; d[q] = (q - v[k]) * (q - v[k]) + f[v[k]]; }
    for (let q = 0; q < n; q++) put(q, d[q]);
  };
  for (let y = 0; y < n; y++) pass((x) => g[y * n + x], (x, val) => { g[y * n + x] = val; });
  for (let x = 0; x < n; x++) pass((y) => g[y * n + x], (y, val) => { g[y * n + x] = val; });
  return g;
}

// the label at a cell, or (on a wall) the first neighbouring area's
function nearestLabel(labels, walls, n, x, y) {
  const i = y * n + x;
  if (labels[i] >= 0) return labels[i];
  for (let r = 1; r <= 3; r++) {
    for (let oy = -r; oy <= r; oy++) for (let ox = -r; ox <= r; ox++) {
      const cx = x + ox, cy = y + oy;
      if (cx < 0 || cy < 0 || cx >= n || cy >= n) continue;
      const l = labels[cy * n + cx];
      if (l >= 0) return l;
    }
  }
  return -1;
}

/** Share of the square that is background (0..1). */
export function backgroundFraction(raster) {
  if (!raster?.bg?.length) return 0;
  let s = 0; for (let i = 0; i < raster.bg.length; i++) s += raster.bg[i];
  return s / raster.bg.length;
}

/**
 * A lookup for generate/export: (u, v) in 0..1 across the square (u east, v south) →
 * true where background. Null when the mask has no areas.
 */
export function backgroundLookup(mask, { n = 1024, metersAcross = 0 } = {}) {
  if (!maskHasAreas(mask) || !mask.bounds) return null;
  const r = rasterizeMask(mask, n, { metersAcross });
  const bg = r.bg;
  const at = (u, v) => {
    if (!(u >= 0 && u <= 1 && v >= 0 && v <= 1)) return false;
    const x = Math.min(n - 1, Math.floor(u * n)), y = Math.min(n - 1, Math.floor(v * n));
    return bg[y * n + x] === 1;
  };
  at.raster = r;
  at.fraction = backgroundFraction(r);
  return at;
}

/** True when every corner and the middle of a (u0..u1, v0..v1) box is background, sampled on a grid. */
export function boxAllBackground(at, u0, v0, u1, v1, steps = 8) {
  if (!at) return false;
  for (let j = 0; j <= steps; j++) for (let i = 0; i <= steps; i++) {
    if (!at(u0 + ((u1 - u0) * i) / steps, v0 + ((v1 - v0) * j) / steps)) return false;
  }
  return true;
}

/** Same bounds (to ~1 cm): a mask is only valid for the box it was drawn on. */
export function sameBounds(a, b) {
  if (!a || !b) return false;
  const e = 1e-7;
  return Math.abs(a.north - b.north) < e && Math.abs(a.south - b.south) < e && Math.abs(a.east - b.east) < e && Math.abs(a.west - b.west) < e;
}

// What background areas drop from the OSM features. Water, coastline, land use and
// cliffs stay (they shape and colour the hills seen from the road). Lines (roads,
// barriers, power lines, piers) go only when they lie wholly in background, so a road
// leaving the kept area isn't cut at the boundary; everything else goes when its
// middle is in background.
const KEEP_TYPES = new Set(['water', 'coastline', 'landuse', 'cliff']);
const LINE_TYPES = new Set(['road', 'barrier', 'power_line', 'pier', 'bridge_infra']);

/** Drop the features background areas don't get. at: backgroundLookup(); bounds: the square's lat/lng box. */
export function filterFeaturesByBackground(features, at, bounds) {
  if (!at || !Array.isArray(features) || !bounds) return features;
  const { north, south, east, west } = bounds;
  const uv = (p) => [(p.lng - west) / (east - west), (north - p.lat) / (north - south)];
  const inBg = (p) => { const [u, v] = uv(p); return at(u, v); };
  return features.filter((f) => {
    if (!f || KEEP_TYPES.has(f.type)) return true;
    const g = Array.isArray(f.geometry) ? f.geometry : [];
    if (!g.length) return true;
    if (LINE_TYPES.has(f.type)) {
      // (every point, and the middle of long segments)
      for (let i = 0; i < g.length; i++) {
        if (!inBg(g[i])) return true;
        if (i > 0 && !inBg({ lat: (g[i].lat + g[i - 1].lat) / 2, lng: (g[i].lng + g[i - 1].lng) / 2 })) return true;
      }
      return false;
    }
    let lat = 0, lng = 0;
    for (const p of g) { lat += p.lat; lng += p.lng; }
    return !inBg({ lat: lat / g.length, lng: lng / g.length });
  });
}

// --- fetching less where it's background ---

/** A lat/lng box → true when its part inside the square is all background (a tile not worth fetching). */
export function makeSkipBox(at, maskBounds, steps = 8) {
  if (!at || !maskBounds) return null;
  const { north, south, east, west } = maskBounds;
  return (box) => {
    const u0 = Math.max(0, (box.west - west) / (east - west)), u1 = Math.min(1, (box.east - west) / (east - west));
    const v0 = Math.max(0, (north - box.north) / (north - south)), v1 = Math.min(1, (north - box.south) / (north - south));
    if (u1 <= u0 || v1 <= v0) return false;
    return boxAllBackground(at, u0, v0, u1, v1, steps);
  };
}

/**
 * The square as lat/lng boxes that hold something to keep (a k×k grid, kept cells
 * merged along each row), for one Overpass query over just those; null when every
 * cell holds something (ask for the whole box).
 */
export function keptBoxes(at, maskBounds, k = 8) {
  const skip = makeSkipBox(at, maskBounds, 6);
  if (!skip) return null;
  const { north, south, east, west } = maskBounds;
  const dLat = (north - south) / k, dLng = (east - west) / k;
  const boxes = [];
  let skipped = 0;
  for (let j = 0; j < k; j++) {
    const n = north - j * dLat, s = n - dLat;
    let start = -1;
    for (let i = 0; i <= k; i++) {
      const bg = i < k && skip({ north: n, south: s, west: west + i * dLng, east: west + (i + 1) * dLng });
      if (i < k && bg) skipped++;
      if (i < k && !bg) { if (start < 0) start = i; continue; }
      if (start >= 0) { boxes.push({ north: n, south: s, west: west + start * dLng, east: west + i * dLng }); start = -1; }
    }
  }
  return skipped ? boxes : null;
}

/** Web-mercator tile → its lat/lng box. */
export function tileLatLngBox(z, x, y) {
  const n = 2 ** z;
  const lat = (yy) => (Math.atan(Math.sinh(Math.PI * (1 - (2 * yy) / n))) * 180) / Math.PI;
  return { west: (x / n) * 360 - 180, east: ((x + 1) / n) * 360 - 180, north: lat(y), south: lat(y + 1) };
}
