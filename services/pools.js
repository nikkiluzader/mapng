// Swimming pools for BeamNG exports: OSM leisure=swimming_pool outlines,
// built into the building tiles (beamngBuildings.js) with their materials.
//
//   inground   sunk into the ground: tiled walls and a floor falling from a
//              shallow end to a deep one, clear water, a stone coping and a
//              paved deck round it; the terrain squares under it are opened
//              (holes, as at tunnel portals) and the deck covers their edges.
//              Private pools: a ladder, corner steps at the shallow end and,
//              on a longer one, sometimes a diving board. A big rectangular
//              pool open to the public: lane lines, floating lane ropes and
//              starting blocks, one depth throughout.
//   wading     the same, half a metre deep, no ladder (swimming_pool=wading /
//              kids / paddling / splash)
//   above      a raised vinyl wall on the ground with the water in it, no deck
//              and no hole (swimming_pool=above_ground)
//
// Left out: indoor, covered and roof pools (indoor=yes, covered=yes,
// location=indoor / roof / rooftop / underground, level above 0) and any
// inside a building footprint (a hotel's, a leisure centre's: under its roof).
// Stonework goes to both detail levels (the lite one is the collision: a car
// falls in onto the floor), fittings to the full one only. The water is
// WaterBlocks (poolWaterBlocks: clear, pale blue, slow ripples), one per
// rectangular pool, small rectangles over a curved one reaching under the
// coping and deck, which stand over the water and hide the overhang.
// Deterministic: choices hash the pool's id. Pure geometry.

import { box, cylinder, insetRing } from './buildingDetails.js';
import { hash01, signedArea, cleanRing, inRing, flat, buildingTest } from './fountains.js';
import { orientedBox, frameAt, coverRing } from './waterCover.js';

const DECK_MIN_M = 1.2;          // the paved deck round a sunk pool
const DECK_PER_SQUARE = 1.45;    // ... at least this many terrain squares wide (every opened square under it)
const COPING_M = 0.35;
// The deck: a rectangle round the pool (its own frame), DECK_SIZE * sqrt(the
// pool's area) past it within DECK_MARGIN_M, pulled back from roads (their
// half width and a sidewalk, ROAD_CLEAR_M), never under the deck width the
// opened terrain needs. On a slope it stands at the highest ground under it,
// its sides walls down to the ground; a side standing more than RAISED_M
// over the ground on average: a fence along it, stairs down from the highest.
const SMOOTH_STEP_M = 0.4;
const DECK_SIZE = 0.45;
const DECK_MARGIN_M = [1.8, 4];
const ROAD_CLEAR_M = 1.5;
const RAISED_M = 0.75;   // (a side's mean height over the ground: about where pool codes ask for a guard)
const STEP_RISE = 0.18;
const STEP_RUN = 0.28;
const ROAD_HALF = { motorway: 7, trunk: 6, primary: 5.5, secondary: 5, tertiary: 4.5, residential: 4, unclassified: 3.5, service: 3, living_street: 3 };
const WATER_BELOW_M = 0.12;      // under the deck
const DEPTH = { shallow: 1.0, deep: 1.9, lanes: 2.0, wading: 0.45 };
const LANE_W = 2.5;
const LANES_MIN = { long: 22, short: 10 };
const ABOVE_H = 1.2;
const MAX_AREA_M2 = 4000;
export const MAX_POOL_SQUARE_M = 2;   // coarser terrain: no pools (an opened square would be half the pool)
const TILE = [0.45, 0.72, 0.88];
const LANE_PAINT = [0.08, 0.12, 0.32];
const STEEL = [0.82, 0.84, 0.86];
const COPING = [1, 0.98, 0.94];
const DECK = [1, 1, 0.97];
const FENCE = [0.96, 0.96, 0.95];
const ROPES = [[0.75, 0.12, 0.1], [0.95, 0.95, 0.95], [0.1, 0.25, 0.7]];
const OUT_OF_DOORS = new Set(['indoor', 'roof', 'rooftop', 'underground', 'basement']);
const WADING = new Set(['wading', 'kids', 'paddling', 'paddling_pool', 'splash', 'toddler']);

const at = frameAt;

// Pool shapes drawn as mapped (smoothing would only round off corners the
// pool really has); anything else is free-form, its outline smoothed:
//   rectilinear  every corner square: rectangles, L and T shapes, lap pools
//   geometric    every corner a clean 45, 60 or 90 degree turn: octagonal
//                and hexagonal pools, Grecian (clipped-corner) rectangles
//   simple       convex with three or four corners: triangles, trapezoids
//   detailed     already drawn finely (no edge over DETAILED_EDGE_M): circles,
//                carefully mapped curves
const SHAPE_TOL_DEG = 5;
const DETAILED_EDGE_M = 1.2;
export function poolShape(ring) {
  const n = ring.length;
  const turns = ring.map((b, i) => {
    const a = ring[(i - 1 + n) % n]; const c = ring[(i + 1) % n];
    const u = [b[0] - a[0], b[1] - a[1]]; const v = [c[0] - b[0], c[1] - b[1]];
    return (Math.atan2(u[0] * v[1] - u[1] * v[0], u[0] * v[0] + u[1] * v[1]) * 180) / Math.PI;
  }).filter((t) => Math.abs(t) > SHAPE_TOL_DEG);   // (straight-through points are no corners)
  const near = (t, steps) => steps.some((d) => Math.abs(Math.abs(t) - d) <= SHAPE_TOL_DEG);
  if (turns.every((t) => near(t, [90]))) return 'rectilinear';
  if (turns.every((t) => near(t, [45, 60, 90, 120, 135]))) return 'geometric';
  if (turns.length <= 4 && turns.every((t) => t > 0)) return 'simple';
  const longest = Math.max(...ring.map((p, i) => { const q = ring[(i + 1) % n]; return Math.hypot(q[0] - p[0], q[1] - p[1]); }));
  if (longest <= DETAILED_EDGE_M) return 'detailed';
  return 'freeform';
}

/**
 * A curved pool's outline smoothed: a centripetal Catmull-Rom curve through
 * its mapped corners (OSM draws a kidney or a free-form pool with a handful
 * of points: blocky), a point every SMOOTH_STEP_M. Through every mapped
 * point, so the pool keeps its size and place; centripetal: no loops or
 * overshoot where the points are unevenly spaced.
 */
export function smoothRing(ring) {
  const n = ring.length;
  const out = [];
  const knot = (a, b) => Math.sqrt(Math.hypot(b[0] - a[0], b[1] - a[1])) || 1e-6;
  for (let i = 0; i < n; i++) {
    const p0 = ring[(i - 1 + n) % n]; const p1 = ring[i]; const p2 = ring[(i + 1) % n]; const p3 = ring[(i + 2) % n];
    const t1 = knot(p0, p1); const t2 = t1 + knot(p1, p2); const t3 = t2 + knot(p2, p3);
    const steps = Math.max(1, Math.ceil(Math.hypot(p2[0] - p1[0], p2[1] - p1[1]) / SMOOTH_STEP_M));
    for (let k = 0; k < steps; k++) {
      const t = t1 + ((t2 - t1) * k) / steps;
      const lerp = (a, b, ta, tb) => [((tb - t) * a[0] + (t - ta) * b[0]) / (tb - ta), ((tb - t) * a[1] + (t - ta) * b[1]) / (tb - ta)];
      const A1 = lerp(p0, p1, 0, t1); const A2 = lerp(p1, p2, t1, t2); const A3 = lerp(p2, p3, t2, t3);
      const B1 = lerp(A1, A2, 0, t2); const B2 = lerp(A2, A3, t1, t3);
      out.push(lerp(B1, B2, t1, t2));
    }
  }
  return out;
}

/** The deck's width for terrain squares of this size (every opened square lies under the pool or its deck). */
export const deckWidth = (squareSize = 1) => Math.max(DECK_MIN_M, DECK_PER_SQUARE * squareSize);

/**
 * Pools to build: [{ id, kind, ring (counter-clockwise), z0, z1, box, lanes,
 * private, deck, seed }]. project(lat, lng) -> [x, y, ground].
 */
export function planPools(features, project, { squareSize = 1, groundAt = null } = {}) {
  if (squareSize > MAX_POOL_SQUARE_M) return [];
  const indoors = buildingTest(features, project);
  // road centre lines, for the decks to keep off
  const roads = [];
  for (const f of features || []) {
    const hw = f?.tags?.highway;
    if (f?.type !== 'road' || !ROAD_HALF[hw] || !(f.geometry?.length > 1)) continue;
    if (f.tags.tunnel && f.tags.tunnel !== 'no') continue;
    const line = f.geometry.map((q) => project(q.lat, q.lng));
    const half = (Number.parseFloat(f.tags.width) / 2) || ROAD_HALF[hw];
    for (let i = 0; i + 1 < line.length; i++) roads.push({ a: line[i], b: line[i + 1], half });
  }
  const out = [];
  for (const f of features || []) {
    const t = f?.tags || {};
    if (t.leisure !== 'swimming_pool' || !Array.isArray(f.geometry) || f.geometry.length < 4) continue;
    if (t.indoor === 'yes' || t.covered === 'yes' || OUT_OF_DOORS.has(String(t.location || '').toLowerCase())) continue;
    if ((Number.parseFloat(t.level) || 0) > 0 || t.building) continue;
    const pts = f.geometry.map((p) => project(p.lat, p.lng));
    let ring = cleanRing(pts);
    if (ring.length < 3) continue;
    let area = signedArea(ring);
    if (area < 0) { ring = ring.reverse(); area = -area; }
    if (area < 5 || area > MAX_AREA_M2) continue;
    // a free-form pool drawn with a few points: smoothed (poolShape: the shapes drawn as mapped)
    const shape = poolShape(ring);
    if (shape === 'freeform') ring = smoothRing(ring);
    const cx = ring.reduce((a, p) => a + p[0], 0) / ring.length; const cy = ring.reduce((a, p) => a + p[1], 0) / ring.length;
    if (t.location !== 'outdoor' && t.indoor !== 'no' && indoors(cx, cy)) continue;
    const grounds = pts.map((p) => p[2]).filter(Number.isFinite);
    if (!grounds.length) continue;
    const bx = orientedBox(ring);
    if (!bx) continue;
    const type = String(t.swimming_pool || '').toLowerCase();
    const kind = type === 'above_ground' ? 'above' : (WADING.has(type) ? 'wading' : 'inground');
    const priv = ['private', 'customers', 'residents', 'no'].includes(String(t.access || '').toLowerCase());
    const long = bx.s1 - bx.s0; const short = bx.t1 - bx.t0;
    const rect = area / Math.max(1, long * short);
    const lanes = kind === 'inground' && !priv && rect > 0.92 && long >= LANES_MIN.long && short >= LANES_MIN.short ? Math.min(10, Math.floor(short / LANE_W)) : 0;
    const p = { id: f.id, kind, shape, ring, z0: Math.min(...grounds), z1: Math.max(...grounds), box: bx, lanes, private: priv, deck: deckWidth(squareSize), seed: String(f.id), tags: t };
    if (kind !== 'above') planDeck(p, area, roads, groundAt);
    out.push(p);
  }
  return out;
}

// The deck rectangle (p.deckRect, counter-clockwise), its height (p.zDeck)
// and its sides' drop to the ground (p.deckSides).
function planDeck(p, area, roads, groundAt) {
  const bx = p.box;
  const M = Math.max(p.deck, Math.min(DECK_MARGIN_M[1], Math.max(DECK_MARGIN_M[0], DECK_SIZE * Math.sqrt(area))));
  const m = { s0: M, s1: M, t0: M, t1: M };
  // each side pulled back from the roads in front of it
  for (const r of roads) {
    const L = Math.hypot(r.b[0] - r.a[0], r.b[1] - r.a[1]);
    for (let k = 0; k <= Math.ceil(L); k++) {
      const f = L > 0 ? Math.min(1, k / L) : 0;
      const x = r.a[0] + (r.b[0] - r.a[0]) * f; const y = r.a[1] + (r.b[1] - r.a[1]) * f;
      const s = x * bx.u[0] + y * bx.u[1]; const t = -x * bx.u[1] + y * bx.u[0];
      const clear = r.half + ROAD_CLEAR_M;
      const ds = s < bx.s0 ? bx.s0 - s : s > bx.s1 ? s - bx.s1 : 0;
      const dt = t < bx.t0 ? bx.t0 - t : t > bx.t1 ? t - bx.t1 : 0;
      if (ds > M + clear || dt > M + clear) continue;
      if (ds >= dt) { const k2 = s < bx.s0 ? 's0' : 's1'; m[k2] = Math.max(p.deck, Math.min(m[k2], ds - clear)); }
      else { const k2 = t < bx.t0 ? 't0' : 't1'; m[k2] = Math.max(p.deck, Math.min(m[k2], dt - clear)); }
    }
  }
  const S0 = bx.s0 - m.s0; const S1 = bx.s1 + m.s1; const T0 = bx.t0 - m.t0; const T1 = bx.t1 + m.t1;
  p.deckRect = [frameAt(bx, S0, T0), frameAt(bx, S1, T0), frameAt(bx, S1, T1), frameAt(bx, S0, T1)];
  // at the highest ground under it (never buried on a slope)
  let top = p.z1;
  if (groundAt) {
    const ns = Math.max(2, Math.min(24, Math.ceil((S1 - S0) / 0.5))); const nt = Math.max(2, Math.min(24, Math.ceil((T1 - T0) / 0.5)));
    for (let i = 0; i <= ns; i++) for (let j = 0; j <= nt; j++) top = Math.max(top, groundAt(...frameAt(bx, S0 + ((S1 - S0) * i) / ns, T0 + ((T1 - T0) * j) / nt)));
  }
  // (over the sampled ground by a hand: the drawn terrain is not the samples'
  // straight lines, and a raw survey's bumps poked through the deck)
  p.zDeck = top + 0.08;
  p.groundAt = groundAt;
  // each side's ground, sampled along it
  p.deckSides = p.deckRect.map((a, i) => {
    const b = p.deckRect[(i + 1) % 4];
    const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const n = Math.max(2, Math.ceil(L / 0.75));
    const pts = Array.from({ length: n + 1 }, (_, k) => {
      const x = a[0] + ((b[0] - a[0]) * k) / n; const y = a[1] + ((b[1] - a[1]) * k) / n;
      return [x, y, groundAt ? groundAt(x, y) : p.z0];
    });
    return { a, b, pts, drop: p.zDeck - pts.reduce((acc, q) => acc + q[2], 0) / pts.length };
  });
}

/** The pool's water surface. */
export const poolWaterLevel = (p) => (p.kind === 'above' ? p.z0 + ABOVE_H - 0.15 : (p.zDeck ?? p.z1 + 0.03) - WATER_BELOW_M);

/**
 * The pool's water as WaterBlock rectangles: [{ cx, cy, sx, sy, u (the
 * rectangle's x axis), z (surface), depth }]; one for a rectangular pool,
 * strips over a curved one reaching under its coping (waterCover.js).
 */
export function poolWaterBlocks(p) {
  const ring = p.kind === 'above' ? insetRing(p.ring, 0.12) : p.ring;
  const z = poolWaterLevel(p);
  const depth = p.kind === 'above' ? ABOVE_H : (p.lanes ? DEPTH.lanes : p.kind === 'wading' ? DEPTH.wading : DEPTH.deep) + 0.2;
  return coverRing(ring, p.kind === 'above' ? { cap: 0.1, h: 0.25 } : { cap: COPING_M - 0.05, h: 0.4 }).map((b) => ({ ...b, z, depth }));
}

/** Rings to open in the terrain (all of a square inside one: a hole) and rings to keep bare of ground cover. */
export function poolFootprints(pools) {
  const holes = []; const paved = [];
  for (const p of pools) {
    if (p.kind === 'above') { paved.push(p.ring); continue; }
    holes.push(insetRing(p.ring, -(p.deck - 0.05)));
    paved.push(p.deckRect || insetRing(p.ring, -p.deck));
  }
  return { holes, paved };
}

// the nearest point of the pool's wall to q: { p, w (along the wall), n (into the pool) }
function nearestWall(ring, q) {
  let best = null;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i]; const b = ring[(i + 1) % ring.length];
    const dx = b[0] - a[0]; const dy = b[1] - a[1]; const L = Math.hypot(dx, dy);
    if (L < 1e-6) continue;
    const f = Math.max(0, Math.min(1, ((q[0] - a[0]) * dx + (q[1] - a[1]) * dy) / (L * L)));
    const p = [a[0] + dx * f, a[1] + dy * f];
    const d = Math.hypot(p[0] - q[0], p[1] - q[1]);
    if (!best || d < best.d) best = { d, p, w: [dx / L, dy / L], n: [-dy / L, dx / L] };
  }
  return best;
}

// a wall from a to b (inside on its left) between the floor's z at each end and zTop
function innerWall(m, mat, a, b, za, zb, zTop, col) {
  const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
  m.quad(mat, [b[0], b[1], zb], [a[0], a[1], za], [a[0], a[1], zTop], [b[0], b[1], zTop], [L / 1.5, zb / 1.5], [0, za / 1.5], [0, zTop / 1.5], [L / 1.5, zTop / 1.5], col);
}
function outerWall(m, mat, ring, z0, z1, col) {
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i]; const b = ring[(i + 1) % ring.length];
    const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
    m.quad(mat, [a[0], a[1], z0], [b[0], b[1], z0], [b[0], b[1], z1], [a[0], a[1], z1], [0, z0], [L, z0], [L, z1], [0, z1], col);
  }
}

// a pool ladder: two rails rising out of the water by the wall at p (wall direction w, n into the pool), over the coping
function ladder(m, p, w, n, zWater, zDeck) {
  for (const side of [-0.25, 0.25]) {
    const x = p[0] + w[0] * side + n[0] * 0.15; const y = p[1] + w[1] * side + n[1] * 0.15;
    cylinder(m, 'metalWhite', x, y, 0.025, zWater - 0.9, zDeck + 0.75, STEEL, { n: 6 });
    const ox = p[0] + w[0] * side - n[0] * 0.35; const oy = p[1] + w[1] * side - n[1] * 0.35;
    cylinder(m, 'metalWhite', ox, oy, 0.025, zDeck, zDeck + 0.75, STEEL, { n: 6 });
    box(m, 'metalWhite', [(x + ox) / 2, (y + oy) / 2], n, 0.27, 0.025, zDeck + 0.72, zDeck + 0.77, STEEL);
  }
  for (const dz of [0.3, 0.6, 0.9]) box(m, 'metalWhite', [p[0] + n[0] * 0.15, p[1] + n[1] * 0.15], w, 0.25, 0.04, zWater - dz - 0.02, zWater - dz + 0.02, STEEL);
}

// a square bar from p to q (3D points), r its half thickness
function bar(m, mat, p, q, r, col) {
  const d = [q[0] - p[0], q[1] - p[1], q[2] - p[2]];
  const L = Math.hypot(...d) || 1;
  const f = d.map((v) => v / L);
  const ref = Math.abs(f[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0];
  const a = [f[1] * ref[2] - f[2] * ref[1], f[2] * ref[0] - f[0] * ref[2], f[0] * ref[1] - f[1] * ref[0]];
  const al = Math.hypot(...a); a.forEach((_, i) => { a[i] /= al; });
  const b = [f[1] * a[2] - f[2] * a[1], f[2] * a[0] - f[0] * a[2], f[0] * a[1] - f[1] * a[0]];
  const corner = (o, sa, sb) => [o[0] + (a[0] * sa + b[0] * sb) * r, o[1] + (a[1] * sa + b[1] * sb) * r, o[2] + (a[2] * sa + b[2] * sb) * r];
  const sq = [[1, 1], [-1, 1], [-1, -1], [1, -1]];
  for (let i = 0; i < 4; i++) {
    const [s0, t0] = sq[i]; const [s1, t1] = sq[(i + 1) % 4];
    m.quad(mat, corner(p, s0, t0), corner(p, s1, t1), corner(q, s1, t1), corner(q, s0, t0), [0, 0], [1, 0], [1, L], [0, L], col);
  }
}

// The deck: the rectangle round the coping at zDeck, its sides down to the
// ground; raised: a fence on the raised sides and stairs down from the
// highest, with handrails.
function deckAround(stone, full, p, cope, zDeck) {
  const rect = p.deckRect || insetRing(p.ring, -p.deck);
  flat(stone, 'poolDeck', rect, [cope.slice().reverse()], zDeck, DECK, 2);
  const sides = p.deckSides || rect.map((a, i) => ({ a, b: rect[(i + 1) % rect.length], pts: [[...a, p.z0], [...rect[(i + 1) % rect.length], p.z0]], drop: zDeck - p.z0 }));
  // the sides: walls down to the ground under them
  for (const sd of sides) {
    for (let k = 0; k + 1 < sd.pts.length; k++) {
      const q0 = sd.pts[k]; const q1 = sd.pts[k + 1];
      const L = Math.hypot(q1[0] - q0[0], q1[1] - q0[1]);
      stone.quad('poolDeck', [q0[0], q0[1], q0[2] - 0.3], [q1[0], q1[1], q1[2] - 0.3], [q1[0], q1[1], zDeck], [q0[0], q0[1], zDeck],
        [0, q0[2]], [L / 2, q1[2]], [L / 2, zDeck], [0, zDeck], DECK);
    }
  }
  if (!sides.some((sd) => sd.drop > RAISED_M)) return;
  // stairs from the side that stands highest, at its middle
  const hi = sides.reduce((a, b) => (b.drop > a.drop ? b : a));
  const ux = (hi.b[0] - hi.a[0]); const uy = (hi.b[1] - hi.a[1]); const UL = Math.hypot(ux, uy);
  const w = [ux / UL, uy / UL]; const out = [w[1], -w[0]];
  const mid = [(hi.a[0] + hi.b[0]) / 2, (hi.a[1] + hi.b[1]) / 2];
  const stairW = Math.min(1.2, UL * 0.4);
  let k = 0;
  const lowest = Math.min(...hi.pts.map((q) => q[2]));
  const groundAt = p.groundAt || (() => lowest);
  for (; k < 40; k++) {
    const d = (k + 0.5) * STEP_RUN;
    const c = [mid[0] + out[0] * d, mid[1] + out[1] * d];
    const g = groundAt(...c);
    const topZ = zDeck - (k + 1) * STEP_RISE;
    if (topZ <= g + 0.02) break;
    box(stone, 'poolDeck', c, out, STEP_RUN / 2, stairW / 2, g - 0.3, topZ, DECK);
  }
  const run = (k + 0.5) * STEP_RUN;
  const end = [mid[0] + out[0] * run, mid[1] + out[1] * run];
  const gEnd = groundAt(...end);
  for (const sgn of [-1, 1]) {
    const o = [w[0] * sgn * (stairW / 2 - 0.04), w[1] * sgn * (stairW / 2 - 0.04)];
    const top = [mid[0] + o[0], mid[1] + o[1], zDeck + 0.9]; const bot = [end[0] + o[0], end[1] + o[1], gEnd + 0.9];
    bar(stone, 'metalWhite', top, bot, 0.025, FENCE);
    bar(stone, 'metalWhite', [top[0], top[1], zDeck], top, 0.03, FENCE);
    bar(stone, 'metalWhite', [bot[0], bot[1], gEnd], bot, 0.03, FENCE);
  }
  // the fence round the raised sides, open at the stairs
  for (const sd of sides) {
    if (sd.drop <= RAISED_M) continue;
    const dx = sd.b[0] - sd.a[0]; const dy = sd.b[1] - sd.a[1]; const L = Math.hypot(dx, dy);
    const along = [dx / L, dy / L]; const inward = [-along[1], along[0]];
    const at2 = (s) => [sd.a[0] + along[0] * s + inward[0] * 0.08, sd.a[1] + along[1] * s + inward[1] * 0.08];
    const gaps = sd === hi ? [[L / 2 - stairW / 2, L / 2 + stairW / 2]] : [];
    let pieces = [[0, L]];
    for (const [g0, g1] of gaps) pieces = pieces.flatMap(([a, b]) => [[a, Math.min(b, g0)], [Math.max(a, g1), b]]).filter(([a, b]) => b - a > 0.2);
    for (const [a, b] of pieces) {
      const n = Math.max(1, Math.ceil((b - a) / 1.8));
      for (let i = 0; i <= n; i++) { const c = at2(a + ((b - a) * i) / n); box(stone, 'metalWhite', c, along, 0.035, 0.035, zDeck, zDeck + 1.15, FENCE); }
      for (const h of [0.12, 1.08]) bar(stone, 'metalWhite', [...at2(a), zDeck + h], [...at2(b), zDeck + h], 0.022, FENCE);
      for (let s2 = a + 0.12; s2 < b - 0.06; s2 += 0.12) { const c = at2(s2); box(full, 'metalWhite', c, along, 0.012, 0.012, zDeck + 0.12, zDeck + 1.08, FENCE); }
    }
  }
}

/** Build one pool. stone: both detail levels (the collision), full: the full one only. */
export function buildPool(stone, full, p) {
  const rnd = (...k) => hash01(p.seed, ...k);
  const { ring, box: bx } = p;
  if (p.kind === 'above') {
    const z = p.z0; const top = z + ABOVE_H;
    const vinyl = [[0.36, 0.55, 0.74], [0.55, 0.57, 0.6], [0.85, 0.85, 0.82]][Math.floor(rnd('vinyl') * 3)];
    outerWall(stone, 'metalWhite', ring, z - 0.1, top, vinyl);
    const rim = insetRing(ring, 0.12);
    flat(stone, 'metalWhite', ring, [rim.slice().reverse()], top, [0.9, 0.9, 0.9], 1);
    for (let i = 0; i < rim.length; i++) innerWall(stone, 'poolTile', rim[i], rim[(i + 1) % rim.length], z, z, top, TILE);
    flat(full, 'poolTile', rim, [], z + 0.02, TILE, 1.5);
    return 'above';
  }
  const zDeck = p.zDeck ?? p.z1 + 0.03;
  const zWater = poolWaterLevel(p);
  // the floor: one depth for lanes and wading, else shallow to deep along the pool
  const deepAtEnd = rnd('deep') < 0.5;
  const sMid = (s) => (s - bx.s0) / Math.max(0.1, bx.s1 - bx.s0);
  const depthAt = (x, y) => {
    if (p.kind === 'wading') return DEPTH.wading;
    if (p.lanes) return DEPTH.lanes;
    // (linear along the pool: exact on any outline's triangles)
    const f = Math.max(0, Math.min(1, sMid(x * bx.u[0] + y * bx.u[1])));
    return DEPTH.shallow + (DEPTH.deep - DEPTH.shallow) * (deepAtEnd ? f : 1 - f);
  };
  const floorZ = (x, y) => zWater - depthAt(x, y);
  // walls and floor (the deck's own level carried down: no gap at its edge)
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i]; const b = ring[(i + 1) % ring.length];
    innerWall(stone, 'poolTile', a, b, floorZ(...a), floorZ(...b), zDeck, TILE);
  }
  flat(stone, 'poolTile', ring, [], floorZ, TILE, 1.5);
  // coping and deck
  const cope = insetRing(ring, -COPING_M);
  flat(stone, 'stoneClean', cope, [ring.slice().reverse()], zDeck + 0.02, COPING, 1);
  outerWall(stone, 'stoneClean', cope, zDeck, zDeck + 0.02, COPING);
  deckAround(stone, full, p, cope, zDeck);
  const L = bx.s1 - bx.s0;
  const W = bx.t1 - bx.t0;
  if (p.lanes) {
    const laneW = W / p.lanes;
    const zf = zWater - DEPTH.lanes + 0.01;
    for (let k = 0; k < p.lanes; k++) {
      const t = bx.t0 + (k + 0.5) * laneW;
      // the black line down each lane with its T at both ends
      box(full, 'poolTile', at(bx, (bx.s0 + bx.s1) / 2, t), bx.u, L / 2 - 2, 0.13, zf - 0.01, zf, LANE_PAINT);
      for (const s of [bx.s0 + 2, bx.s1 - 2]) box(full, 'poolTile', at(bx, s, t), bx.u, 0.13, 0.5, zf - 0.01, zf, LANE_PAINT);
      // a starting block on the deck at one end
      const sb = at(bx, bx.s0 - 0.55, t);
      box(full, 'concrete', sb, bx.u, 0.25, 0.25, zDeck, zDeck + 0.72, [0.95, 0.95, 0.95]);
    }
    // floating ropes between the lanes, in coloured stretches
    for (let k = 1; k < p.lanes; k++) {
      const t = bx.t0 + k * laneW;
      const n = Math.max(1, Math.round(L / 2.5));
      for (let i = 0; i < n; i++) {
        const s = bx.s0 + ((i + 0.5) * L) / n;
        const col = (i < 2 || i >= n - 2) ? ROPES[0] : ROPES[1 + (i % 2)];
        box(full, 'metalWhite', at(bx, s, t), bx.u, L / n / 2, 0.06, zWater - 0.04, zWater + 0.06, col);
      }
    }
    // ladders at both ends of both long sides
    for (const s of [bx.s0 + 1.5, bx.s1 - 1.5]) {
      for (const t of [bx.t0, bx.t1]) { const w = nearestWall(ring, at(bx, s, t)); ladder(full, w.p, w.w, w.n, zWater, zDeck); }
    }
    return 'lanes';
  }
  if (p.kind === 'inground') {
    // a ladder by the deep end on one long side, steps in the shallow end's corner
    const sDeep = deepAtEnd ? bx.s1 - 1.2 : bx.s0 + 1.2;
    const sShallow = deepAtEnd ? bx.s0 : bx.s1;
    const side = rnd('side') < 0.5 ? [bx.t0, 1] : [bx.t1, -1];
    if (L > 4 && W > 2.5) { const w = nearestWall(ring, at(bx, sDeep, side[0])); ladder(full, w.p, w.w, w.n, zWater, zDeck); }
    if (L > 5 && W > 2.5) {
      // three steps down from the shallow end's wall, each a block from the floor
      const sw = Math.min(1.8, W * 0.45);
      const w = nearestWall(ring, at(bx, sShallow, rnd('steps') < 0.5 ? bx.t0 + sw / 2 : bx.t1 - sw / 2));
      for (let k = 0; k < 3; k++) {
        const d = 0.15 * (k + 1);
        box(stone, 'poolTile', [w.p[0] + w.n[0] * d, w.p[1] + w.n[1] * d], w.w, sw / 2, d, zWater - DEPTH.shallow - 0.1, zWater - 0.25 * (k + 1), [0.92, 0.96, 1]);
      }
    }
    // a diving board over the deep end of a longer private pool
    if (p.private && L >= 9 && W >= 3.5 && rnd('board') < 0.4) {
      const sEdge = deepAtEnd ? bx.s1 : bx.s0;
      const dir = deepAtEnd ? -1 : 1;
      const tc = (bx.t0 + bx.t1) / 2;
      box(full, 'metalWhite', at(bx, sEdge + dir * 0.55, tc), bx.u, 1.25, 0.25, zDeck + 0.32, zDeck + 0.38, [0.92, 0.94, 0.95]);
      box(stone, 'concrete', at(bx, sEdge - dir * 0.45, tc), bx.u, 0.3, 0.28, zDeck, zDeck + 0.32, [0.85, 0.85, 0.85]);
    }
  }
  return p.kind;
}

const TILEABLE = '/assets/materials/tileable';
/** The pool's tiles and its deck (BeamNG material stages). */
export const POOL_MATERIAL_STAGES = {
  poolTile: {
    baseColorMap: `${TILEABLE}/marble/tiles_marble_square/t_tiles_marble_square_b.color.png`,
    normalMap: `${TILEABLE}/marble/tiles_marble_square/t_tiles_marble_square_nm.normal.png`,
    roughnessMap: `${TILEABLE}/marble/tiles_marble_square/t_tiles_marble_square_r.data.png`,
    ambientOcclusionMap: `${TILEABLE}/marble/tiles_marble_square/t_tiles_marble_square_ao.data.png`,
  },
  poolDeck: {
    baseColorMap: `${TILEABLE}/concrete/m_gm_concrete_tiles_ground/t_gm_concrete_tiles_ground_d.color.png`,
    normalMap: `${TILEABLE}/concrete/m_gm_concrete_tiles_ground/t_gm_concrete_tiles_ground_nm.normal.png`,
    roughnessMap: `${TILEABLE}/concrete/m_gm_concrete_tiles_ground/t_gm_concrete_tiles_ground_r.data.png`,
    ambientOcclusionMap: `${TILEABLE}/concrete/m_gm_concrete_tiles_ground/t_gm_concrete_tiles_ground_ao.data.png`,
  },
};

/** The pools' WaterBlock look (tuned in game: clear, pale blue, slow ripples). */
export const POOL_WATER_BLOCK = {
  clarity: 0.9,
  waterFogDensity: 0.05,
  waterFogDensityOffset: 0,
  baseColor: [70, 160, 175, 255],
  underwaterColor: [90, 180, 195, 80],
  depthGradientTex: '/assets/materials/tileable/water/depthcolor_ramp/depthcolor_ramp_tropical_b.png',
  depthGradientMax: 6,
  wetDarkening: 0.2,
  rippleSpeeds: [0.008, 0.02, 0.003],
};
