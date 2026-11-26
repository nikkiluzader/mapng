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
import polyClip from './polyClip.js';

export const PAVED_RES_M = 0.25;
export const SIDEWALK_GAP_M = 12;
export const PLAIN_GAP_M = 1;
export const CLOSE_M = 5;
export const LAWN_REACH_M = 35;     // houses this near: the street's verge between curb and sidewalk is a lawn
export const LAWN_MIN_GAP_M = 1.5;  // ... unless the walk is this near the curb (mapped against it)
export const WIDE_VERGE_M = 6;      // a mapped sidewalk standing further than this off the road edge: the strip between is a verge (nearer, the strip is mostly a parking lane the road is drawn without: paved)
export const POCKET_M2 = 20;      // an unpaved pocket this small between road and pavement is paved (crossing landings)
export const SPECK_M2 = 0.5;      // a traced ring this small is dropped
export const CURB_TOP_LIFT_M = 0.003;
export const SKIRT_PAST_M = 0.1;       // a skirt runs this far past the ground it meets  // the curb's top band this far over the slab (no flicker between the two)

// layer bits
export const ROAD = 1; export const WALK = 2; export const GAP = 4; export const VERGE = 8;

/**
 * Exact squared Euclidean distance (in cells) to the nearest seed, and that seed's cell index (Felzenszwalb and
 * Huttenlocher, two 1-D passes, carrying the nearest seed through both). -1 where there is no seed.
 */
export function distanceWithNearest(seed, w, h) {
  const INF = 1e20;
  // (squared distances in cells are whole numbers far under 2^24: exact in 32 bits, half the memory traffic; the
  // intersections below stay in 64)
  const g = new Float32Array(w * h); const near = new Int32Array(w * h);
  for (let i = 0; i < w * h; i++) { if (seed[i]) { g[i] = 0; near[i] = i; } else { g[i] = INF; near[i] = -1; } }
  const n = Math.max(w, h);
  const f = new Float64Array(n); const fi = new Int32Array(n); const v = new Int32Array(n); const z = new Float64Array(n + 1);
  // (one 1-D pass over g / near along a line: start, stride, length; plain loops, no callbacks per cell: with them
  // this was 85 % of the paved grid's time)
  const pass = (start, stride, len) => {
    for (let q = 0, i = start; q < len; q++, i += stride) { f[q] = g[i]; fi[q] = near[i]; }
    let k = 0; v[0] = 0; z[0] = -INF; z[1] = INF;
    for (let q = 1; q < len; q++) {
      const fq = f[q] + q * q;
      let p = v[k];
      let s = (fq - (f[p] + p * p)) / (2 * q - 2 * p);
      while (s <= z[k]) { k--; p = v[k]; s = (fq - (f[p] + p * p)) / (2 * q - 2 * p); }
      k++; v[k] = q; z[k] = s; z[k + 1] = INF;
    }
    k = 0;
    for (let q = 0, i = start; q < len; q++, i += stride) {
      while (z[k + 1] < q) k++;
      const p = v[k]; const d = (q - p) * (q - p) + f[p];
      g[i] = d; near[i] = d >= INF ? -1 : fi[p];
    }
  };
  // rows: on a yes/no seed the first pass is only the nearest seed to the left or right, two plain scans (the
  // parabola pass is kept for the columns, whose input is no longer yes/no)
  for (let y = 0; y < h; y++) {
    const o = y * w;
    let last = -1;
    for (let x = 0; x < w; x++) { if (seed[o + x]) last = x; if (last >= 0) { const d = x - last; g[o + x] = d * d; near[o + x] = o + last; } }
    last = -1;
    for (let x = w - 1; x >= 0; x--) {
      if (seed[o + x]) last = x;
      if (last >= 0) { const d = last - x; const d2 = d * d; if (d2 < g[o + x]) { g[o + x] = d2; near[o + x] = o + last; } }
    }
  }
  for (let x = 0; x < w; x++) pass(x, w, h);
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
// houses: rings of houses (a residential street: the strip from curb to sidewalk is a lawn, not paving)
export function buildPavedGrid(g, { roads = [], cornerArcs = [], cornerSlabs = [], cornerSquares = [], walks = [], streetWalks = [], greenery = [], houses = [] } = {}) {
  const N = g.w * g.h;
  const cells = new Uint8Array(N);
  for (const r of roads) if (r.pts.length > 1) markLine(cells, g, r.pts, r.half, ROAD);
  // (a corner paved square lies wholly behind both curb lines, out to where they meet: the road raster's round ends and
  // junction overlap reaching into it are no road surface, and left as road they cut a triangle of bare ground out of the
  // corner's tip (the sidewalk test level's two-width T))
  if (cornerSquares.length) {
    const sq = new Uint8Array(N);
    for (const poly of cornerSquares) if (poly.length > 2) markPolygon(sq, g, poly, 1);
    for (let i = 0; i < N; i++) if (sq[i]) cells[i] &= ~ROAD;
  }
  for (const arc of cornerArcs) { const q = cornerApex(arc); if (q) markPolygon(cells, g, [...arc, q], ROAD); }
  // (marked straight into their layers, the road taken out once after: a scratch layer cleared per walk was a
  // pass over the whole grid for every walk)
  const sw = new Uint8Array(N); const plain = new Uint8Array(N);
  // (near a plain walk and near the road, each drawn PLAIN_GAP_M wider: the strip between them, marked directly
  // instead of through two more distance transforms over the tile)
  const plainNear = new Uint8Array(N); const roadBand = new Uint8Array(N);
  for (const wk of walks) {
    if (wk.crossing || wk.pts.length < 2) continue;
    markLine(wk.sidewalk ? sw : plain, g, wk.pts, wk.half, 1);
    if (!wk.sidewalk) markLine(plainNear, g, wk.pts, wk.half + PLAIN_GAP_M + 0.3, 1);
  }
  for (const s of streetWalks) if (s.pts.length > 1) { markLine(plain, g, s.pts, s.half, 1); markLine(plainNear, g, s.pts, s.half + PLAIN_GAP_M + 0.3, 1); }
  // (a corner's piece of sidewalk, from its rounded curb out to the two sidewalks' outer corner: paved as theirs)
  for (const poly of cornerSlabs) if (poly.length > 2) markPolygon(plain, g, poly, 1);
  for (const poly of cornerSquares) if (poly.length > 2) markPolygon(plain, g, poly, 1);
  for (const r of roads) if (r.pts.length > 1) markLine(roadBand, g, r.pts, r.half + PLAIN_GAP_M, 1);
  const road = new Uint8Array(N); const walk = new Uint8Array(N);
  for (let i = 0; i < N; i++) {
    road[i] = cells[i] & ROAD ? 1 : 0;
    if (road[i]) { sw[i] = 0; plain[i] = 0; }
    walk[i] = sw[i] | plain[i]; if (walk[i]) cells[i] |= WALK;
  }
  const res = g.res;
  const { d2: dRoad2, near: roadNear } = distanceWithNearest(road, g.w, g.h);
  const { d2: dSw2, near: swNear } = distanceWithNearest(sw, g.w, g.h);
  const swMax = SIDEWALK_GAP_M / res;
  // (a residential street, houses within LAWN_REACH_M: its verge from the curb to the sidewalk is grass. Paved to
  // the curb, a suburb's tree lawns and cul-de-sac bulbs came out solid concrete. Downtown, with no houses, paved)
  let lawn = null;
  if (houses.length) {
    const hm = new Uint8Array(N);
    for (const ring of houses) if (ring.length > 2) markPolygon(hm, g, ring, 1);
    const { d2: dh } = distanceWithNearest(hm, g.w, g.h);
    const reach2 = (LAWN_REACH_M / res) * (LAWN_REACH_M / res);
    lawn = new Uint8Array(N);
    for (let i = 0; i < N; i++) if (dh[i] <= reach2) lawn[i] = 1;
  }
  const lawnGap = LAWN_MIN_GAP_M / res; const wideGap = WIDE_VERGE_M / res;
  // (lawn by the street, not cell by cell: a cell is lawn where it, its nearest road or the sidewalk it lies toward is within reach of houses. Judged
  // by the cell alone, the strip switched between lawn and paving where the houses' reach ran through it, in ragged
  // edges, and a residential street's far side, its houses a little further back, was paved solid (Naperville))
  const lawnAt = (i) => !!lawn && (lawn[i] === 1 || (roadNear[i] >= 0 && lawn[roadNear[i]] === 1) || (swNear[i] >= 0 && lawn[swNear[i]] === 1));
  for (let i = 0; i < N; i++) {
    if (road[i] || walk[i]) continue;
    const dr = Math.sqrt(dRoad2[i]);
    let take = false;
    if (plainNear[i] && roadBand[i]) take = true;
    else if (swNear[i] >= 0) {
      const D = Math.sqrt(dRoad2[swNear[i]]);
      if (D <= swMax && dr + Math.sqrt(dSw2[i]) <= D + 0.5 / res) {
        if (lawnAt(i) && D > lawnGap) { cells[i] |= VERGE; continue; }
        // (nor anywhere, houses or not, where the sidewalk stands well back from the road: the strip between is a verge
        // of grass, trees and lamps, as a sidewalk mapped on its own downtown lies against the curb. Paved up to the
        // gap limit, St. Augustine's bayfront sidewalk, 8.5 m off the drawn road along the seawall, came out a paved strip with a
        // ragged sawtooth edge where the fill's test broke up along the diagonal (the user's camera, 2026-11-26;
        // Mapillary: grass with palms between the curb and the seawall))
        if (D > wideGap) { cells[i] |= VERGE; continue; }
        take = true;
      }
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
  // (at full resolution: on a 1 m copy the partly paved blocks along every edge either spread the paving a metre
  // past the walks or left specks unpaved inside it)
  const closed = closeMask(any, g.w, g.h, Math.round(CLOSE_M / 2 / res));
  // (only near a sidewalk footway: the closing rounds the sidewalk paving at corners; let loose, it paved the strip
  // beside a plain footway 4.5 m off the curb too)
  const closeReach2 = (CLOSE_M / res) * (CLOSE_M / res);
  for (let i = 0; i < N; i++) if (closed[i] && !(cells[i] & (ROAD | WALK | GAP | VERGE)) && dSw2[i] <= closeReach2 && !lawnAt(i)) cells[i] |= GAP;
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
        // (the four neighbours checked in place: an array of them per cell was most of this fill's time)
        for (let nb = 0; nb < 4; nb++) {
          const j = nb === 0 ? (c > 0 ? i - 1 : -1) : nb === 1 ? (c < g.w - 1 ? i + 1 : -1) : nb === 2 ? (r > 0 ? i - g.w : -1) : (r < g.h - 1 ? i + g.w : -1);
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
 * Peucker; within one cell: the midpoints' zigzag on a diagonal is about 0.15 m, and at half a cell it stayed, ten
 * times the edges, every one a curb or skirt face). Outer rings run counter-clockwise, holes clockwise.
 */
export function traceOutlines(cells, g, bits, tol = PAVED_RES_M) {
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

/**
 * Meshes for the paved outlines (step 3c). rings: traceOutlines' (outer counter-clockwise, holes clockwise);
 * cells / g: the grid they came from (an edge with road outside it is a curb); heightAt(x, y): the slab top's z.
 * The slab is cut into cellM squares (each ring clipped to the square: a square is convex, the clip cannot fail)
 * and triangulated per square with its holes, so it follows the road's grade. Returns flat Float32Array
 * triangles (x, y, z per corner): slab, curb (vertical faces from the top down curbH, road outside), skirt
 * (faces skirtM into the ground, ground outside).
 */
// core: [x0, y0, x1, y1], only the slab squares and edges inside it (a tile's own part, its margin left to its neighbours)
// bottomAt(x, y): the road surface a curb face comes down to (default: curbH under the top; a dropped curb at a
// driveway then has next to no face)
// fineAt(x, y): true where the slab must follow quick changes (a driveway's dip): there the squares are fineM.
// Edges are split to at most edgeM so a curb's height can change along a straight run.
// curbW: the curb's top band, drawn in the curb's material just inside each curb edge, CURB_TOP_LIFT_M over the slab
// groundAt(x, y): where an edge facing the ground must reach (its skirt runs down past the ground there)
export function buildPavedMesh(rings0, cells, g, { heightAt = () => 0, bottomAt = null, groundAt = null, cellM = 4, fineM = 1, fineAt = null, bendTol = null, bendWhere = null, edgeM = 1, curbH = 0.15, curbW = 0.15, skirtM = 0.3, THREE, core = null } = {}) {
  if (!THREE) throw new Error('buildPavedMesh needs THREE (ShapeUtils.triangulateShape)');
  const rings = rings0.map((ring) => {
    const out = [];
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i]; const b = ring[(i + 1) % ring.length]; out.push(a);
      // (to the slab's squares, then finely where the height changes quickly, a driveway's dip, each piece by its own
      // middle: a long edge's middle could lie far from a driveway the edge passes)
      const n = Math.ceil(fastHypot(b[0] - a[0], b[1] - a[1]) / cellM);
      for (let k = 0; k < n; k++) {
        const p0 = [a[0] + ((b[0] - a[0]) * k) / n, a[1] + ((b[1] - a[1]) * k) / n];
        const p1 = [a[0] + ((b[0] - a[0]) * (k + 1)) / n, a[1] + ((b[1] - a[1]) * (k + 1)) / n];
        if (k > 0) out.push(p0);
        if (fineAt && fineAt((p0[0] + p1[0]) / 2, (p0[1] + p1[1]) / 2)) {
          const m = Math.ceil(fastHypot(p1[0] - p0[0], p1[1] - p0[1]) / edgeM);
          for (let j = 1; j < m; j++) out.push([p0[0] + ((p1[0] - p0[0]) * j) / m, p0[1] + ((p1[1] - p0[1]) * j) / m]);
        }
      }
    }
    return out;
  });
  const slab = []; const curb = []; const skirt = []; const curbTop = [];
  const stats = { holeSquares: 0, holeClipFailed: 0 };
  // polygons: each outer ring with the holes inside it
  const outers = rings.filter((r) => ringSignedArea(r) > 0); const holes = rings.filter((r) => ringSignedArea(r) < 0);
  const inside = (p, ring) => { let s = false; for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) { const a = ring[i]; const b = ring[j]; if ((a[1] > p[1]) !== (b[1] > p[1]) && p[0] < a[0] + ((p[1] - a[1]) * (b[0] - a[0])) / (b[1] - a[1])) s = !s; } return s; };
  const polys = outers.map((o) => ({ outer: o, holes: [] }));
  for (const hr of holes) {
    const owner = polys.filter((p) => inside(hr[0], p.outer)).sort((a, b) => ringSignedArea(a.outer) - ringSignedArea(b.outer))[0];
    if (owner) owner.holes.push(hr);
  }
  const box = (ring) => { let x0 = Infinity; let y0 = Infinity; let x1 = -Infinity; let y1 = -Infinity; for (const [x, y] of ring) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; } return [x0, y0, x1, y1]; };
  // Sutherland-Hodgman against one axis's band lo..hi (axis 0: x, 1: y), no functions made per call
  const clipAxis = (ring, axis, lo, hi) => {
    let inp = ring;
    for (let side = 0; side < 2; side++) {
      const out = [];
      const bound = side === 0 ? lo : hi;
      const n = inp.length;
      for (let i = 0; i < n; i++) {
        const a = inp[(i + n - 1) % n]; const b = inp[i];
        const ina = side === 0 ? a[axis] >= bound : a[axis] <= bound; const inb = side === 0 ? b[axis] >= bound : b[axis] <= bound;
        if (inb) {
          if (!ina) { const t = (bound - a[axis]) / (b[axis] - a[axis]); out.push(axis === 0 ? [bound, a[1] + t * (b[1] - a[1])] : [a[0] + t * (b[0] - a[0]), bound]); }
          out.push(b);
        } else if (ina) { const t = (bound - a[axis]) / (b[axis] - a[axis]); out.push(axis === 0 ? [bound, a[1] + t * (b[1] - a[1])] : [a[0] + t * (b[0] - a[0]), bound]); }
      }
      inp = out;
      if (!inp.length) return inp;
    }
    return inp;
  };
  const push3 = (arr, p) => arr.push(p[0], p[1], heightAt(p[0], p[1]));
  // (each ring clipped to a row strip once, then the strip's ring to each square in the row: clipping the whole ring
  // per square was quadratic, 13 s of a dense 4 km city's 34)
  const valid = (r) => r.length >= 3 && Math.abs(ringSignedArea(r)) > 1e-4;
  const triOne = (o, hs) => {
    const contour = o.map(([x, y]) => new THREE.Vector2(x, y)); const hv = hs.map((h) => h.map(([x, y]) => new THREE.Vector2(x, y)));
    const all = [...o, ...hs.flat()];
    for (const [a, b, c] of THREE.ShapeUtils.triangulateShape(contour, hv)) { push3(slab, all[a]); push3(slab, all[b]); push3(slab, all[c]); }
  };
  // (a square holding a hole: the outline clipped to it is often the whole square with seams along its edges, the
  // ring's other passes through the square joined along the cut, and the clipped hole lies on those same edges; handed
  // to the triangulation as they are, 11 squares of a courtyard whose lawns were holes came out wrong, up to three
  // times their paving, spikes over the lawn and gaps in the paths (St. Augustine's Flagler College, 2026-11-26). There
  // the square's paving is worked out first, the outline less its holes, and each clean piece triangulated)
  const tri = (o, hs) => {
    if (!hs.length) { triOne(o, hs); return; }
    let pieces = null;
    try { pieces = polyClip.difference([o], ...hs.map((h) => [h])); } catch { pieces = null; stats.holeClipFailed++; }
    if (!pieces) { triOne(o, hs); return; }
    stats.holeSquares++;
    const open = (r) => (r.length > 1 && r[0][0] === r[r.length - 1][0] && r[0][1] === r[r.length - 1][1] ? r.slice(0, -1) : r);
    for (const poly of pieces) { const [outer, ...inner] = poly.map(open); if (valid(outer)) triOne(outer, inner.filter(valid)); }
  };
  for (const p of polys) {
    const [x0, y0, x1, y1] = box(p.outer);
    // (bendTol: a square whose slab height bends more than this off the plane through its corners, measured at its
    // middle and its sides' midpoints, is cut finely. For a slab that follows unshaped ground: flat across 4 m squares
    // it cut into the bumps of lidar ground and stood over its hollows. Where the ground is graded to the slab it is
    // left off: there it doubled the triangles and the time for nothing (NYC 4 km 22 -> 54 s). bendWhere(x, y): only the
    // squares whose middle it passes are tested (the ground under a deck, which is never graded up))
    const bent = (sx, sy) => {
      const z00 = heightAt(sx, sy); const z10 = heightAt(sx + cellM, sy); const z01 = heightAt(sx, sy + cellM); const z11 = heightAt(sx + cellM, sy + cellM);
      const h = cellM / 2;
      return Math.abs(heightAt(sx + h, sy + h) - (z00 + z10 + z01 + z11) / 4) > bendTol
        || Math.abs(heightAt(sx + h, sy) - (z00 + z10) / 2) > bendTol || Math.abs(heightAt(sx + h, sy + cellM) - (z01 + z11) / 2) > bendTol
        || Math.abs(heightAt(sx, sy + h) - (z00 + z01) / 2) > bendTol || Math.abs(heightAt(sx + cellM, sy + h) - (z10 + z11) / 2) > bendTol;
    };
    for (let sy = Math.floor(y0 / cellM) * cellM; sy < y1; sy += cellM) {
      if (core && (sy + cellM <= core[1] || sy >= core[3])) continue;
      const rowO = clipAxis(p.outer, 1, sy, sy + cellM);
      if (!valid(rowO)) continue;
      const rowH = p.holes.map((h) => clipAxis(h, 1, sy, sy + cellM)).filter(valid);
      for (let sx = Math.floor(x0 / cellM) * cellM; sx < x1; sx += cellM) {
        if (core && (sx + cellM <= core[0] || sx >= core[2])) continue;
        const fine = (fineAt && fineAt(sx + cellM / 2, sy + cellM / 2)) || (bendTol != null && (!bendWhere || bendWhere(sx + cellM / 2, sy + cellM / 2)) && bent(sx, sy));
        if (!fine) {
          const o = clipAxis(rowO, 0, sx, sx + cellM);
          if (valid(o)) tri(o, rowH.map((h) => clipAxis(h, 0, sx, sx + cellM)).filter(valid));
          continue;
        }
        for (let fy = sy; fy < sy + cellM - 1e-9; fy += fineM) {
          const fo = clipAxis(rowO, 1, fy, fy + fineM); if (!valid(fo)) continue;
          const fh = rowH.map((h) => clipAxis(h, 1, fy, fy + fineM)).filter(valid);
          for (let fx = sx; fx < sx + cellM - 1e-9; fx += fineM) {
            const o = clipAxis(fo, 0, fx, fx + fineM);
            if (valid(o)) tri(o, fh.map((h) => clipAxis(h, 0, fx, fx + fineM)).filter(valid));
          }
        }
      }
    }
  }
  // edge faces: road just outside the edge (on its right, the outside of a counter-clockwise outer / clockwise hole) -> curb
  const roadAt = (x, y) => { const c = Math.floor((x - g.x0) / g.res); const r = Math.floor((g.y1 - y) / g.res); return c >= 0 && r >= 0 && c < g.w && r < g.h && (cells[r * g.w + c] & ROAD) !== 0; };
  for (const ring of rings) {
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i]; const b = ring[(i + 1) % ring.length];
      const dx = b[0] - a[0]; const dy = b[1] - a[1]; const L = fastHypot(dx, dy); if (L < 1e-6) continue;
      const ox = dy / L; const oy = -dx / L;   // the outside (right of the direction of travel)
      const mx = (a[0] + b[0]) / 2; const my = (a[1] + b[1]) / 2;
      if (core && (mx < core[0] || mx >= core[2] || my < core[1] || my >= core[3])) continue;
      const isCurb = roadAt(mx + ox * 0.4, my + oy * 0.4) || roadAt(mx + ox * 0.75, my + oy * 0.75);
      const into = isCurb ? curb : skirt;
      const za = heightAt(a[0], a[1]); const zb = heightAt(b[0], b[1]);
      // (a skirt reaches at least skirtM down, and past the ground where it falls further: on a steep hillside the ground
      // beside a curb strip dropped more than the skirt reached, a gap under its edge)
      const skirtTo = (p, z) => (groundAt ? Math.max(skirtM, z - groundAt(p[0], p[1]) + SKIRT_PAST_M) : skirtM);
      const da = isCurb && bottomAt ? Math.max(0, za - bottomAt(a[0], a[1])) : isCurb ? curbH : skirtTo(a, za);
      const db = isCurb && bottomAt ? Math.max(0, zb - bottomAt(b[0], b[1])) : isCurb ? curbH : skirtTo(b, zb);
      if (isCurb && da < 0.005 && db < 0.005) continue;   // (flush: no face)
      into.push(a[0], a[1], za, b[0], b[1], zb, b[0], b[1], zb - db, a[0], a[1], za, b[0], b[1], zb - db, a[0], a[1], za - da);
      if (isCurb && curbW > 0) {
        // the top band: inward (the left of the direction of travel) by curbW
        const ix = -ox * curbW; const iy = -oy * curbW; const lift = CURB_TOP_LIFT_M;
        curbTop.push(a[0], a[1], za + lift, b[0], b[1], zb + lift, b[0] + ix, b[1] + iy, zb + lift, a[0], a[1], za + lift, b[0] + ix, b[1] + iy, zb + lift, a[0] + ix, a[1] + iy, za + lift);
      }
    }
  }
  return { slab: Float32Array.from(slab), curb: Float32Array.from(curb), skirt: Float32Array.from(skirt), curbTop: Float32Array.from(curbTop), polygons: polys.length, holeSquares: stats.holeSquares, holeClipFailed: stats.holeClipFailed };
}

// grading (step 3d): today's values (beamngSidewalks.js gradeSidewalkGround)
export const GRADE_UNDER_M = 0.14;      // the ground this far under the slab's top (a 1 m grid can't follow it closer)
export const BACK_EDGE_UNDER_M = 0.05;  // ... except along its back edge, beside open ground: flush with the lawn there
export const RING_UNDER_M = 0.03;       // the first ring of ground out from that edge this far under the slab's top
export const FLUSH_DROP_MAX_M = 0.3;    // ... unless the ground beside lies more than this under or over the slab (a bank)
export const RING_LEVEL_FAR_M = 3;      // ... there and this far further out (a hillside)
export const BLEND_MIN_M = 1;
export const BLEND_MAX_M = 10;
export const BLEND_RUN = 2;
export const ROAD_MARGIN_M = 0.3;      // terrain this near a road is the road's (today's GROUND_ROAD_MARGIN_M)             // 1 m of height difference blends over 2 m
const smooth01 = (t) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));

/**
 * Terrain edits under and round the paved area (step 3d). terrain: { heightMap, width, height, worldSize, minHeight }
 * (world z = raw - minHeight); heightAt(x, y): the slab top. Under the pavement the ground goes GRADE_UNDER_M under the
 * slab; round it, it blends back to the natural ground over BLEND_RUN per metre of difference (BLEND_MIN_M to
 * BLEND_MAX_M); road pixels are left to the roads' own grading. Returns { idx: Int32Array, z: Float64Array } (raw).
 */
// overhead(x, y, z0, z1): something built over that span (a deck, a tunnel's roof): the ground is never raised into it
// verge(x, y) -> { top, f } or null: the ground behind a bare curb raised toward its top (pavedSidewalks.js makeVergeAt),
// never lowered, never by more than VERGE_RAISE_MAX_M (a bank stays as it is)
export const VERGE_RAISE_MAX_M = 0.25;
export const VERGE_ROAD_M = 3;
export const VERGE_FAR_M = 2.5;
// keep(x, y): ground left as it is (a level crossing's pad: the track's own shaping, at the rails' top)
export function gradePaved(cells, g, terrain, { heightAt = () => 0, core = null, overhead = null, verge = null, keep = null } = {}) {
  const { heightMap, width, height, worldSize, minHeight = 0 } = terrain;
  const N = width * height; const sq = worldSize / width;
  // (the terrain grid's convention: pixel (c, r) at ((c / W) - 0.5) * size, (0.5 - (r + 1) / H) * size)
  const wx = (c) => ((c / width) - 0.5) * worldSize; const wy = (r) => (0.5 - (r + 1) / height) * worldSize;
  const at = (x, y) => { const c = Math.floor((x - g.x0) / g.res); const r = Math.floor((g.y1 - y) / g.res); return c >= 0 && r >= 0 && c < g.w && r < g.h ? cells[r * g.w + c] : 0; };
  // only the terrain pixels the grid covers
  const c0 = Math.max(0, Math.floor((g.x0 / worldSize + 0.5) * width)); const c1 = Math.min(width - 1, Math.ceil(((g.x0 + g.w * g.res) / worldSize + 0.5) * width));
  const r0 = Math.max(0, Math.floor((0.5 - g.y1 / worldSize) * height - 1)); const r1 = Math.min(height - 1, Math.ceil((0.5 - (g.y1 - g.h * g.res) / worldSize) * height));
  const sw = c1 - c0 + 1; const sh = r1 - r0 + 1;
  if (sw <= 0 || sh <= 0) return { idx: new Int32Array(0), z: new Float64Array(0) };
  const paved = new Uint8Array(sw * sh); const road = new Uint8Array(sw * sh); const top = new Float64Array(sw * sh);
  for (let r = 0; r < sh; r++) {
    for (let c = 0; c < sw; c++) {
      const x = wx(c + c0); const y = wy(r + r0); const v = at(x, y); const k = r * sw + c;
      // (road within ROAD_MARGIN_M of the pixel: the road's own; the old grading's margin, without it the paving's
      // grading tilted the edges of the road surfaces)
      const m = ROAD_MARGIN_M;
      if ((v | at(x + m, y) | at(x - m, y) | at(x, y + m) | at(x, y - m)) & ROAD) road[k] = 1;
      else if (v & (WALK | GAP)) { paved[k] = 1; top[k] = heightAt(x, y) - GRADE_UNDER_M; }
    }
  }
  // (the paving's back edge: a paved pixel beside open ground (not road) carries the ground BACK_EDGE_UNDER_M under the
  // slab's top, and the ring of ground pixels just outside it the slab's top, so the terrain meets the edge flush. With
  // the ground GRADE_UNDER_M under all of it and the blend starting at the first pixel out (1 m on a 1 m grid, where the
  // shortest blend ends), every sidewalk stood 14 cm proud of its lawn; 72 % of them on a St. Augustine level (the
  // user, 2026-11-26: "odd shapes"))
  const backEdge = new Uint8Array(sw * sh);
  for (let r = 0; r < sh; r++) {
    for (let c = 0; c < sw; c++) {
      const k = r * sw + c; if (!paved[k]) continue;
      // (open ground beside it within FLUSH_DROP_MAX_M of the slab's top: a lawn at its level, not a bank or a hillside,
      // where raised the edge only made creases, w_sf_russian 315 -> 356 on the sweep)
      const slabTop = top[k] + GRADE_UNDER_M;
      const open = (rr, cc) => rr >= 0 && cc >= 0 && rr < sh && cc < sw && !paved[rr * sw + cc] && !road[rr * sw + cc]
        && Math.abs(heightMap[(rr + r0) * width + (cc + c0)] - minHeight - slabTop) <= FLUSH_DROP_MAX_M;
      if (open(r - 1, c) || open(r + 1, c) || open(r, c - 1) || open(r, c + 1)) { backEdge[k] = 1; top[k] += GRADE_UNDER_M - BACK_EDGE_UNDER_M; }
    }
  }
  const { d2, near } = distanceWithNearest(paved, sw, sh);
  const idx = []; const z = []; let verges = 0;
  const reach = BLEND_MAX_M / sq;
  for (let r = 0; r < sh; r++) {
    for (let c = 0; c < sw; c++) {
      const k = r * sw + c; const gi = (r + r0) * width + (c + c0);
      if (gi < 0 || gi >= N || road[k]) continue;
      if (core) { const x = wx(c + c0); const y = wy(r + r0); if (x < core[0] || x >= core[2] || y < core[1] || y >= core[3]) continue; }
      if (keep && keep(wx(c + c0), wy(r + r0))) continue;
      if (paved[k]) {
        // (never raised up into a deck or a tunnel over it: the old grading's guard, missing at first: terrain stood
        // through a bridge deck over a paved strip)
        const ground = heightMap[gi] - minHeight;
        if (overhead && top[k] > ground && overhead(wx(c + c0), wy(r + r0), top[k], top[k] + 6)) continue;
        idx.push(gi); z.push(top[k] + minHeight); continue;
      }
      const ground = heightMap[gi] - minHeight;
      // (behind a bare curb: the verge up to its top)
      let zv = null;
      if (verge) {
        const x = wx(c + c0); const y = wy(r + r0);
        const v = verge(x, y);
        // (another road within VERGE_ROAD_M behind the curb: the strip between two roads, often a bank between levels,
        // is no verge; raised, it grew a lip on Passeig de Gràcia's side carriageway, the sweep's creases 16 -> 32)
        let roadBehind = false;
        if (v?.dir) for (let d = 0.5; d <= VERGE_ROAD_M && !roadBehind; d += 0.5) if (at(x + v.dir[0] * d, y + v.dir[1] * d) & ROAD) roadBehind = true;
        // (and the ground falling away behind it, more than the cap under the curb's top VERGE_FAR_M out: a slope, no level
        // verge to give back; raised, its top grew a lip, the same sweep)
        let falling = false;
        if (v?.dir) {
          const fc = Math.round(((x + v.dir[0] * VERGE_FAR_M) / worldSize + 0.5) * width); const fr = Math.round((0.5 - (y + v.dir[1] * VERGE_FAR_M) / worldSize) * height - 1);
          if (fc >= 0 && fr >= 0 && fc < width && fr < height && v.top - (heightMap[fr * width + fc] - minHeight) > VERGE_RAISE_MAX_M) falling = true;
        }
        if (v && !roadBehind && !falling && v.top > ground && v.top - ground <= VERGE_RAISE_MAX_M) zv = ground + (v.top - ground) * v.f;
      }
      let zb = null;
      if (near[k] >= 0 && d2[k] <= reach * reach) {
        const nk = near[k];
        // (the blend from under the slab, the edge pixels' ground set back to GRADE_UNDER_M for it)
        const t = top[nk] - (backEdge[nk] ? GRADE_UNDER_M - BACK_EDGE_UNDER_M : 0);
        const blend = Math.min(BLEND_MAX_M, Math.max(BLEND_MIN_M, Math.abs(ground - t) * BLEND_RUN));
        const f = (Math.sqrt(d2[k]) * sq) / blend;
        if (f < 1) zb = t + (ground - t) * smooth01(f);
        // (the ring of ground pixels next to a back edge at the slab's top, RING_UNDER_M under it, where the lawn there is
        // within FLUSH_DROP_MAX_M of it: the ground meets the edge flush, as a sidewalk sits in its lawn. From under the
        // slab, every sidewalk stood 10 to 20 cm proud of the grass along its back edge, 71 % of them on a St. Augustine
        // level (the user, 2026-11-26: "odd shapes"). The ring only: switching the blend beyond it between the two
        // grew creases on a hill city (w_sf_russian 315 -> 356, the sweep). Not by a deck: a deck's low end counts,
        // checked from well under the ground, as the deck test sees only what reaches a deck's underside; raised there
        // the ground came 0.2 m through a little bridge a driveway runs onto (val_disere b008))
        if (backEdge[nk] && d2[k] <= 2.25) {
          const ring = top[nk] + BACK_EDGE_UNDER_M - RING_UNDER_M;
          // (and the ground RING_LEVEL_FAR_M further out too: on a smooth hillside the lawn next to the edge came within
          // reach while the slope carried on past it, and the held ring made a crease (w_sf_russian, 30 m))
          const nr = (nk / sw) | 0; const nc = nk - nr * sw;
          const dr = r - nr; const dc = c - nc; const dl = Math.hypot(dr, dc) || 1;
          const fr = Math.round(r + r0 + (dr / dl) * (RING_LEVEL_FAR_M / sq)); const fc = Math.round(c + c0 + (dc / dl) * (RING_LEVEL_FAR_M / sq));
          const farOk = fr < 0 || fc < 0 || fr >= height || fc >= width || Math.abs(heightMap[fr * width + fc] - minHeight - ring) <= FLUSH_DROP_MAX_M;
          if (farOk && Math.abs(ground - ring) <= FLUSH_DROP_MAX_M && !(overhead && overhead(wx(c + c0), wy(r + r0), ground - 3, ring + 6))) zb = Math.max(zb ?? -Infinity, ring);
        }
      }
      const zf = zv !== null && (zb === null || zv > zb) ? zv : zb;
      if (zf === null) continue;
      if (overhead && zf > ground && overhead(wx(c + c0), wy(r + r0), zf, zf + 6)) continue;
      if (zf === zv) verges++;
      idx.push(gi); z.push(zf + minHeight);
    }
  }
  return { idx: Int32Array.from(idx), z: Float64Array.from(z), verges };
}
