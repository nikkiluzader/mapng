// The paved area beside the roads on one grid (the sidewalk rework, docs/open-items.md section 5): road surfaces,
// walks, the strips closed between a curb and a footway that is the street's sidewalk, and verges where mapped
// greenery says the strip is not paved. Step 3a of the rework: the grid only; outlines and meshes come after.
//
// Why a grid: the old builders cut and merged polygons (polygon-clipping), which failed on near-touching edges and
// once hung; on a grid every union and cut is a cell test, nothing can fail, and tiles are independent.
// Flat typed arrays throughout (docs/optimization-rules.md): one byte per cell per layer, no object per cell.
//
// Rules (the prototype scratch/swaudit/proto.py, checked against street photos):
// - a footway tagged footway=sidewalk is the street's own sidewalk: the strip between the curb and it is paved,
//   up to SIDEWALK_GAP_M (downtown walks run 6-8 m from the curb, paved all the way);
// - a plain footway is closed up to the curb only within PLAIN_GAP_M (the old WALK_SNAP_M);
// - only between road and walk: a cell's way to the road and to its nearest walk add up to that walk's own
//   distance from the road, and its straight way to the road crosses no walk;
// - notches narrower than CLOSE_M round the corners closed (never onto the road);
// - a strip inside mapped greenery at ground level stays a verge.

import { fastHypot } from './fastMath.js';

export const PAVED_RES_M = 0.25;
export const SIDEWALK_GAP_M = 12;
export const PLAIN_GAP_M = 1;
export const CLOSE_M = 5;
export const POCKET_M2 = 20;      // an unpaved pocket this small between road and pavement is paved (crossing landings)
export const SPECK_M2 = 0.5;      // a traced ring this small is dropped

// layer bits
export const ROAD = 1; export const WALK = 2; export const GAP = 4; export const VERGE = 8;

/**
 * Exact squared Euclidean distance (in cells) to the nearest seed, and that seed's cell index (Felzenszwalb and
 * Huttenlocher, two 1-D passes, carrying the nearest seed through both). -1 where there is no seed.
 */
export function distanceWithNearest(seed, w, h) {
  const INF = 1e20;
  const g = new Float64Array(w * h); const near = new Int32Array(w * h).fill(-1);
  // pass 1: along each row, to the nearest seed in that row
  const n = Math.max(w, h);
  const f = new Float64Array(n); const fi = new Int32Array(n); const v = new Int32Array(n); const z = new Float64Array(n + 1);
  const run = (len, getF, getI, put) => {
    for (let q = 0; q < len; q++) { f[q] = getF(q); fi[q] = getI(q); }
    let k = 0; v[0] = 0; z[0] = -INF; z[1] = INF;
    for (let q = 1; q < len; q++) {
      let s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
      while (s <= z[k]) { k--; s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]); }
      k++; v[k] = q; z[k] = s; z[k + 1] = INF;
    }
    k = 0;
    for (let q = 0; q < len; q++) { while (z[k + 1] < q) k++; const p = v[k]; put(q, (q - p) * (q - p) + f[p], fi[p]); }
  };
  for (let y = 0; y < h; y++) {
    const o = y * w;
    run(w, (x) => (seed[o + x] ? 0 : INF), (x) => (seed[o + x] ? o + x : -1), (x, d, i) => { g[o + x] = d; near[o + x] = d >= INF ? -1 : i; });
  }
  for (let x = 0; x < w; x++) {
    run(h, (y) => g[y * w + x], (y) => near[y * w + x], (y, d, i) => { g[y * w + x] = d; near[y * w + x] = d >= INF ? -1 : i; });
  }
  return { d2: g, near };
}

/** A grid over a box: { x0, y1 (top edge), res, w, h } and its world <-> cell helpers. */
export function makeGrid(x0, y0, x1, y1, res = PAVED_RES_M) {
  const w = Math.max(1, Math.ceil((x1 - x0) / res)); const h = Math.max(1, Math.ceil((y1 - y0) / res));
  return { x0, y0, y1, res, w, h };
}

// cell (c, r) centre in world
const cx = (g, c) => g.x0 + (c + 0.5) * g.res;
const cy = (g, r) => g.y1 - (r + 0.5) * g.res;

/** Marks every cell whose centre is within half of the polyline pts ([[x, y]...]) with bit. */
export function markLine(cells, g, pts, half, bit) {
  for (let i = 0; i + 1 < pts.length; i++) {
    const ax = pts[i][0]; const ay = pts[i][1]; const bx = pts[i + 1][0]; const by = pts[i + 1][1];
    const dx = bx - ax; const dy = by - ay; const L2 = dx * dx + dy * dy;
    const c0 = Math.max(0, Math.floor((Math.min(ax, bx) - half - g.x0) / g.res)); const c1 = Math.min(g.w - 1, Math.ceil((Math.max(ax, bx) + half - g.x0) / g.res));
    const r0 = Math.max(0, Math.floor((g.y1 - Math.max(ay, by) - half) / g.res)); const r1 = Math.min(g.h - 1, Math.ceil((g.y1 - Math.min(ay, by) + half) / g.res));
    const h2 = half * half;
    for (let r = r0; r <= r1; r++) {
      const y = cy(g, r);
      for (let c = c0; c <= c1; c++) {
        const x = cx(g, c);
        let t = L2 > 0 ? ((x - ax) * dx + (y - ay) * dy) / L2 : 0;
        t = t < 0 ? 0 : t > 1 ? 1 : t;
        const ex = ax + dx * t - x; const ey = ay + dy * t - y;
        if (ex * ex + ey * ey <= h2) cells[r * g.w + c] |= bit;
      }
    }
  }
}

/** Marks every cell whose centre is inside the ring ([[x, y]...], even-odd) with bit: one row's crossings at a time. */
export function markPolygon(cells, g, ring, bit) {
  let ya = Infinity; let yb = -Infinity;
  for (const p of ring) { if (p[1] < ya) ya = p[1]; if (p[1] > yb) yb = p[1]; }
  const r0 = Math.max(0, Math.floor((g.y1 - yb) / g.res)); const r1 = Math.min(g.h - 1, Math.ceil((g.y1 - ya) / g.res));
  const xs = [];
  for (let r = r0; r <= r1; r++) {
    const y = cy(g, r); xs.length = 0;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const yi = ring[i][1]; const yj = ring[j][1];
      if ((yi > y) !== (yj > y)) xs.push(ring[i][0] + ((y - yi) * (ring[j][0] - ring[i][0])) / (yj - yi));
    }
    xs.sort((a, b) => a - b);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const c0 = Math.max(0, Math.ceil((xs[k] - g.x0) / g.res - 0.5)); const c1 = Math.min(g.w - 1, Math.floor((xs[k + 1] - g.x0) / g.res - 0.5));
      for (let c = c0; c <= c1; c++) cells[r * g.w + c] |= bit;
    }
  }
}

// dilation then erosion of a mask by a disc, through squared distances: dilate = within r of the mask, erode =
// within r of nothing outside it (the same exact distance transform, no per-cell disc loops)
function closeMask(mask, w, h, rCells) {
  const { d2: toMask } = distanceWithNearest(mask, w, h);
  const dil = new Uint8Array(w * h);
  const r2 = rCells * rCells;
  for (let i = 0; i < w * h; i++) dil[i] = toMask[i] <= r2 ? 1 : 0;
  const outside = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) outside[i] = dil[i] ? 0 : 1;
  const { d2: toOut } = distanceWithNearest(outside, w, h);
  const closed = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) closed[i] = toOut[i] > r2 ? 1 : 0;
  return closed;
}

/**
 * The paved grid over box g. roads: [{ pts, half }] carriageways; cornerArcs: [[[x, y]...]] rounded corner curbs (the
 * road takes the fillet up to where the edges meet); walks: [{ pts, half, sidewalk, crossing }]; streetWalks:
 * [{ pts, half }] street-side sidewalk bands (already offset to their middle); greenery: [[[x, y]...]] rings.
 * Returns { cells: Uint8Array (ROAD | WALK | GAP | VERGE bits), grid }.
 */
export function buildPavedGrid(g, { roads = [], cornerArcs = [], walks = [], streetWalks = [], greenery = [] } = {}) {
  const N = g.w * g.h;
  const cells = new Uint8Array(N);
  for (const r of roads) if (r.pts.length > 1) markLine(cells, g, r.pts, r.half, ROAD);
  for (const arc of cornerArcs) { const q = cornerApex(arc); if (q) markPolygon(cells, g, [...arc, q], ROAD); }
  // (marked straight into their layers, the road taken out once after: a scratch layer cleared per walk was a
  // pass over the whole grid for every walk)
  const sw = new Uint8Array(N); const plain = new Uint8Array(N);
  for (const wk of walks) if (!wk.crossing && wk.pts.length > 1) markLine(wk.sidewalk ? sw : plain, g, wk.pts, wk.half, 1);
  for (const s of streetWalks) if (s.pts.length > 1) markLine(plain, g, s.pts, s.half, 1);
  const road = new Uint8Array(N); const walk = new Uint8Array(N);
  for (let i = 0; i < N; i++) {
    road[i] = cells[i] & ROAD ? 1 : 0;
    if (road[i]) { sw[i] = 0; plain[i] = 0; }
    walk[i] = sw[i] | plain[i]; if (walk[i]) cells[i] |= WALK;
  }
  const res = g.res;
  const { d2: dRoad2, near: roadNear } = distanceWithNearest(road, g.w, g.h);
  const { d2: dPlain2 } = distanceWithNearest(plain, g.w, g.h);
  const { d2: dSw2, near: swNear } = distanceWithNearest(sw, g.w, g.h);
  const plainMax = PLAIN_GAP_M / res; const swMax = SIDEWALK_GAP_M / res;
  for (let i = 0; i < N; i++) {
    if (road[i] || walk[i]) continue;
    const dr = Math.sqrt(dRoad2[i]);
    let take = false;
    if (dr <= plainMax && dr + Math.sqrt(dPlain2[i]) <= plainMax + 0.3 / res) take = true;
    else if (swNear[i] >= 0) {
      const D = Math.sqrt(dRoad2[swNear[i]]);
      if (D <= swMax && dr + Math.sqrt(dSw2[i]) <= D + 0.5 / res) take = true;
    }
    if (!take) continue;
    // (no filling past a walk: the straight way to the nearest road cell crosses no walk cell)
    const rn = roadNear[i];
    if (rn >= 0) {
      const r0 = (i / g.w) | 0; const c0 = i - r0 * g.w; const r1 = (rn / g.w) | 0; const c1 = rn - r1 * g.w;
      let blocked = false;
      for (let s = 1; s <= 7 && !blocked; s++) {
        const f = 0.15 + (0.7 * (s - 1)) / 6;
        const rr = Math.round(r0 + (r1 - r0) * f); const cc = Math.round(c0 + (c1 - c0) * f);
        if (walk[rr * g.w + cc]) blocked = true;
      }
      if (blocked) continue;
    }
    cells[i] |= GAP;
  }
  // corners: notches narrower than CLOSE_M closed, never onto the road
  const any = new Uint8Array(N);
  for (let i = 0; i < N; i++) any[i] = cells[i] & (ROAD | WALK | GAP) ? 1 : 0;
  const closed = closeMask(any, g.w, g.h, Math.round(CLOSE_M / 2 / res));
  // (only near a sidewalk footway: the closing rounds the sidewalk paving at corners; let loose, it paved the strip
  // beside a plain footway 4.5 m off the curb too)
  const closeReach2 = (CLOSE_M / res) * (CLOSE_M / res);
  for (let i = 0; i < N; i++) if (closed[i] && !(cells[i] & (ROAD | WALK | GAP)) && dSw2[i] <= closeReach2) cells[i] |= GAP;
  // pockets: small unpaved areas wedged between road and pavement (a crossing's landing, a kerb ramp's sides) paved
  {
    const label = new Int32Array(N).fill(-1); const stack = []; const maxCells = POCKET_M2 / (res * res);
    for (let s0 = 0; s0 < N; s0++) {
      if (label[s0] >= 0 || cells[s0]) continue;
      const comp = []; let road1 = false; let paved1 = false; let edge = false;
      label[s0] = s0; stack.push(s0);
      while (stack.length) {
        const i = stack.pop(); comp.push(i);
        const r = (i / g.w) | 0; const c = i - r * g.w;
        if (r === 0 || c === 0 || r === g.h - 1 || c === g.w - 1) edge = true;
        for (const j of [c > 0 ? i - 1 : -1, c < g.w - 1 ? i + 1 : -1, r > 0 ? i - g.w : -1, r < g.h - 1 ? i + g.w : -1]) {
          if (j < 0) continue;
          const v = cells[j];
          if (v & ROAD) road1 = true; else if (v & (WALK | GAP)) paved1 = true;
          else if (!v && label[j] < 0 && comp.length <= maxCells) { label[j] = s0; stack.push(j); }
        }
      }
      if (!edge && road1 && paved1 && comp.length <= maxCells) for (const i of comp) cells[i] |= GAP;
    }
  }
  // verges: a closed strip inside mapped greenery stays unpaved
  if (greenery.length) {
    const green = new Uint8Array(N);
    for (const ring of greenery) if (ring.length > 2) markPolygon(green, g, ring, 1);
    for (let i = 0; i < N; i++) if (green[i] && cells[i] & GAP) cells[i] = (cells[i] & ~GAP) | VERGE;
  }
  return { cells, grid: g };
}

/** The point where a corner arc's two road edges meet (its tangents at both ends, followed into the arc), or null. */
export function cornerApex(arc) {
  if (arc.length < 2) return null;
  const a0 = arc[0]; const b0 = arc[arc.length - 1];
  // (the tangent at an end: the first chord turned back by half the turn between the first two chords; the chord
  // alone put a 5 m corner's apex 0.45 m inside the true one)
  const tangent = (p0, p1, p2) => {
    const ax = p1[0] - p0[0]; const ay = p1[1] - p0[1];
    if (!p2) return [ax, ay];
    const turn = Math.atan2(ax * (p2[1] - p1[1]) - ay * (p2[0] - p1[0]), ax * (p2[0] - p1[0]) + ay * (p2[1] - p1[1]));
    const c = Math.cos(-turn / 2); const sn = Math.sin(-turn / 2);
    return [ax * c - ay * sn, ax * sn + ay * c];
  };
  const [ux, uy] = tangent(a0, arc[1], arc[2]);
  const [vx, vy] = tangent(b0, arc[arc.length - 2], arc[arc.length - 3]);
  const det = ux * -vy - -vx * uy;
  if (Math.abs(det) < 1e-9) return null;
  const rx = b0[0] - a0[0]; const ry = b0[1] - a0[1];
  const t = (rx * -vy - -vx * ry) / det;
  const px = a0[0] + ux * t; const py = a0[1] + uy * t;
  return t > 0 && fastHypot(px - a0[0], py - a0[1]) < 20 ? [px, py] : null;
}


/**
 * The outlines of the cells with any of bits set (step 3b): closed rings in world metres, traced along the
 * cell-edge midpoints (marching squares: stair-steps become diagonals), then simplified within tol (Douglas-
 * Peucker). Outer rings run counter-clockwise, holes clockwise (signed area > 0 outer).
 */
export function traceOutlines(cells, g, bits, tol = PAVED_RES_M / 2) {
  const { w, h } = g;
  const on = (c, r) => c >= 0 && r >= 0 && c < w && r < h && (cells[r * w + c] & bits) !== 0;
  // corner samples are cell centres; a square (c, r) .. (c + 1, r + 1) of samples, edges midway between them.
  // segments keyed by integer half-cell coordinates, chained into loops
  const next = new Map();
  const key = (x2, y2) => x2 * 1048576 + y2;   // doubled coordinates, offset
  const add = (ax, ay, bx, by) => { next.set(key(ax, ay), [bx, by]); };
  for (let r = -1; r < h; r++) {
    for (let c = -1; c < w; c++) {
      const a = on(c, r); const b = on(c + 1, r); const d = on(c, r + 1); const e = on(c + 1, r + 1);
      const k = (a ? 8 : 0) | (b ? 4 : 0) | (e ? 2 : 0) | (d ? 1 : 0);
      if (k === 0 || k === 15) continue;
      // edge midpoints (doubled, +2 so -1 rows stay non-negative): top, right, bottom, left of the sample square
      const X = 2 * c + 2; const Y = 2 * r + 2;
      const T = [X + 1, Y]; const R = [X + 2, Y + 1]; const B = [X + 1, Y + 2]; const L = [X, Y + 1];
      // filled on the left of each segment's direction (in row-down cell space)
      const seg = (p, q) => add(p[0], p[1], q[0], q[1]);
      switch (k) {
        case 1: seg(B, L); break; case 2: seg(R, B); break; case 3: seg(R, L); break; case 4: seg(T, R); break;
        case 5: seg(T, L); seg(B, R); break; case 6: seg(T, B); break; case 7: seg(T, L); break; case 8: seg(L, T); break;
        case 9: seg(B, T); break; case 10: seg(L, B); seg(R, T); break; case 11: seg(R, T); break; case 12: seg(L, R); break;
        case 13: seg(B, R); break; case 14: seg(L, B); break; default: break;
      }
    }
  }
  const rings = [];
  const seen = new Set();
  for (const [k0] of next) {
    if (seen.has(k0)) continue;
    const loop = [];
    let k = k0;
    while (!seen.has(k)) {
      seen.add(k);
      const x2 = Math.floor(k / 1048576); const y2 = k - x2 * 1048576;
      loop.push([g.x0 + ((x2 - 2) / 2 + 0.5) * g.res, g.y1 - ((y2 - 2) / 2 + 0.5) * g.res]);
      const n = next.get(k); if (!n) break;
      k = key(n[0], n[1]);
    }
    if (loop.length >= 3) rings.push(simplifyRing(loop, tol));
  }
  return rings.filter((r) => r.length >= 3 && Math.abs(ringSignedArea(r)) >= SPECK_M2);
}

/** Signed area of a ring (counter-clockwise > 0). */
export function ringSignedArea(ring) {
  let a = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) a += (ring[j][0] - ring[i][0]) * (ring[j][1] + ring[i][1]);
  return a / 2;
}

// Douglas-Peucker on a closed ring: split at the two farthest-apart points, simplify both halves
function simplifyRing(ring, tol) {
  if (ring.length < 8) return ring;
  let far = 0; let best = -1;
  for (let i = 1; i < ring.length; i++) { const d = (ring[i][0] - ring[0][0]) ** 2 + (ring[i][1] - ring[0][1]) ** 2; if (d > best) { best = d; far = i; } }
  const a = simplifyLine(ring.slice(0, far + 1), tol); const b = simplifyLine([...ring.slice(far), ring[0]], tol);
  return [...a.slice(0, -1), ...b.slice(0, -1)];
}
function simplifyLine(pts, tol) {
  const keep = new Uint8Array(pts.length); keep[0] = 1; keep[pts.length - 1] = 1;
  const stack = [[0, pts.length - 1]]; const t2 = tol * tol;
  while (stack.length) {
    const [i0, i1] = stack.pop();
    const ax = pts[i0][0]; const ay = pts[i0][1]; const dx = pts[i1][0] - ax; const dy = pts[i1][1] - ay; const L2 = dx * dx + dy * dy || 1e-12;
    let worst = -1; let wi = -1;
    for (let i = i0 + 1; i < i1; i++) {
      const t = Math.max(0, Math.min(1, ((pts[i][0] - ax) * dx + (pts[i][1] - ay) * dy) / L2));
      const ex = ax + dx * t - pts[i][0]; const ey = ay + dy * t - pts[i][1]; const e = ex * ex + ey * ey;
      if (e > worst) { worst = e; wi = i; }
    }
    if (worst > t2) { keep[wi] = 1; stack.push([i0, wi], [wi, i1]); }
  }
  return pts.filter((_, i) => keep[i]);
}
