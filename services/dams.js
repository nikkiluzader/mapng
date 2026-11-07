// Dams for BeamNG exports: OSM waterway=dam built as concrete structures in
// the building tiles (beamngBuildings.js, the 'water' extras with pools and
// fountains). The terrain is left exactly as the elevation data has it: a
// lidar ground model removes a dam like a bridge (the Barrage du Chevril at
// Tignes came out as its gorge), and the structure stands in that gap.
//
//   outline  waterway=dam drawn as an area: walls round it from the ground
//            at each corner up to the crest, the crest a flat concrete top
//            (in the collision: a road along the crest drives on it)
//   line     a dam drawn as a line: the same, its width (width=, else
//            LINE_WIDTH_M) round the line
//
// The crest: where the dam meets the rock at its ends, the high part of the
// ground along its outline (CREST_PERCENTILE), never past the highest; at
// most height= over its lowest ground when tagged. A dam the data already
// shows (no gap under its crest over GAP_MIN_M) is left: the ground is it,
// as is a low weir across a river.
// Pure geometry.

import { signedArea, cleanRing, flat, inRing } from './fountains.js';

const LINE_WIDTH_M = 8;
const CREST_PERCENTILE = 0.85;
const GAP_MIN_M = 2;           // the deepest ground under the crest must be at least this far below it
const FOOT_M = 1.5;            // the walls reach this far into the ground
const MAX_AREA_M2 = 400000;
const SAMPLE_M = 2;
const CONCRETE = [0.82, 0.81, 0.78];
const CREST = [0.7, 0.7, 0.68];

const num = (v) => { const x = Number.parseFloat(String(v ?? '').replace(',', '.')); return Number.isFinite(x) && x > 0 ? x : null; };
const isClosed = (pts) => pts.length > 3 && Math.hypot(pts[0][0] - pts.at(-1)[0], pts[0][1] - pts.at(-1)[1]) < 0.5;

// a line as a ring its width wide (both sides joined at the ends)
export function bufferLine(pts, half) {
  const left = []; const right = [];
  for (let i = 0; i < pts.length; i++) {
    const a = pts[Math.max(0, i - 1)]; const b = pts[Math.min(pts.length - 1, i + 1)];
    const L = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
    const nx = -(b[1] - a[1]) / L; const ny = (b[0] - a[0]) / L;
    left.push([pts[i][0] + nx * half, pts[i][1] + ny * half]);
    right.push([pts[i][0] - nx * half, pts[i][1] - ny * half]);
  }
  return [...left, ...right.reverse()];
}

// points every step metres round a closed ring
function alongRing(ring, step) {
  const out = [];
  for (let i = 0; i < ring.length; i++) {
    const [ax, ay] = ring[i]; const [bx, by] = ring[(i + 1) % ring.length];
    const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) / step));
    for (let k = 0; k < n; k++) out.push([ax + ((bx - ax) * k) / n, ay + ((by - ay) * k) / n]);
  }
  return out;
}

/**
 * The dams to build: [{ ring (counter-clockwise), crest, name, gap }].
 * project(lat, lng) -> [x, y]; groundAt(x, y) the terrain.
 */
export function planDams(features, project, { groundAt } = {}) {
  if (typeof groundAt !== 'function') return [];
  const out = [];
  for (const f of features || []) {
    const t = f?.tags || {};
    if (String(t.waterway ?? '').trim().toLowerCase() !== 'dam' || !(f.geometry?.length > 1)) continue;
    const pts = f.geometry.map((p) => project(p.lat, p.lng));
    let ring = cleanRing(isClosed(pts) ? pts : bufferLine(pts, (num(t.width) || LINE_WIDTH_M) / 2));
    if (ring.length < 3) continue;
    let area = signedArea(ring);
    if (area < 0) { ring = ring.reverse(); area = -area; }
    if (area > MAX_AREA_M2) continue;
    const ground = alongRing(ring, SAMPLE_M).map(([x, y]) => groundAt(x, y)).filter(Number.isFinite).sort((a, b) => a - b);
    if (!ground.length) continue;
    const low = ground[0]; const high = ground.at(-1);
    let crest = Math.min(high, ground[Math.min(ground.length - 1, Math.floor(ground.length * CREST_PERCENTILE))]);
    const tagged = num(t.height);
    if (tagged) crest = Math.min(crest, low + tagged);
    if (crest - low < GAP_MIN_M) continue;   // the data shows it already (or a low weir)
    out.push({ ring, crest, name: t.name || null, gap: crest - low, id: f.id });
  }
  return out;
}

/** Concrete walls round the dam from the ground to the crest, and its top. Returns 'dam' or null. */
export function buildDam(m, d, groundAt) {
  const { ring, crest } = d;
  // (the walls follow the ground every SAMPLE_M, down into the gorge)
  const pts = alongRing(ring, SAMPLE_M);
  const foot = pts.map(([x, y]) => { const g = groundAt(x, y); return Math.min(crest, (Number.isFinite(g) ? g : crest) - FOOT_M); });
  let walls = 0;
  for (let i = 0; i < pts.length; i++) {
    const j = (i + 1) % pts.length;
    const a = pts[i]; const b = pts[j];
    const za = foot[i]; const zb = foot[j];
    if (za >= crest && zb >= crest) continue;   // inside the rock
    const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
    // (counter-clockwise ring: the face looks out)
    m.quad('concrete', [a[0], a[1], za], [b[0], b[1], zb], [b[0], b[1], crest], [a[0], a[1], crest],
      [0, za / 4], [L / 4, zb / 4], [L / 4, crest / 4], [0, crest / 4], CONCRETE);
    walls++;
  }
  if (!walls) return null;
  // (the crest's top is its own object, damTopGeometry: road decals clip
  // onto it as onto a bridge deck's surface, not onto the building tiles)
  return 'dam';
}

/** A dam's flat crest top as triangles: { positions: [x, y, z...], uvs: [u, v...] }. */
// (the top in small triangles: a decal road captures the triangles under its
// strip, and the outline's own triangulation, slivers hundreds of metres
// long, took no road; a bridge deck's surface is in metre-scale pieces)
const TOP_EDGE_M = 4;
export function damTopGeometry(d, uvM = 4) {
  const positions = []; const uvs = [];
  const emit = (a, b, c) => {
    for (const p of [a, b, c]) { positions.push(p[0], p[1], p[2]); uvs.push(p[0] / uvM, p[1] / uvM); }
  };
  const split = (a, b, c, depth = 0) => {
    const ab = Math.hypot(b[0] - a[0], b[1] - a[1]); const bc = Math.hypot(c[0] - b[0], c[1] - b[1]); const ca = Math.hypot(a[0] - c[0], a[1] - c[1]);
    const longest = Math.max(ab, bc, ca);
    if (longest <= TOP_EDGE_M || depth > 24) { emit(a, b, c); return; }
    const mid = (p, q) => [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2, (p[2] + q[2]) / 2];
    // (halving the longest edge keeps the triangles' winding)
    if (longest === ab) { const m = mid(a, b); split(a, m, c, depth + 1); split(m, b, c, depth + 1); }
    else if (longest === bc) { const m = mid(b, c); split(a, b, m, depth + 1); split(a, m, c, depth + 1); }
    else { const m = mid(c, a); split(a, b, m, depth + 1); split(m, b, c, depth + 1); }
  };
  const m = { tri: (mat, a, b, c) => split(a, b, c) };
  flat(m, 'top', d.ring, [], d.crest, CREST, uvM);
  // a skirt round its edge, SKIRT_M deep: a perfectly flat top made an object
  // with a box of no height, and the road decals over it drew nothing
  const z0 = d.crest - SKIRT_M; const z1 = d.crest;
  for (let i = 0; i < d.ring.length; i++) {
    const a = d.ring[i]; const b = d.ring[(i + 1) % d.ring.length];
    const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const quad = [[a[0], a[1], z0, 0, z0], [b[0], b[1], z0, L, z0], [b[0], b[1], z1, L, z1], [a[0], a[1], z0, 0, z0], [b[0], b[1], z1, L, z1], [a[0], a[1], z1, 0, z1]];
    for (const [x, y, z, u, v] of quad) { positions.push(x, y, z); uvs.push(u / uvM, v / uvM); }
  }
  return { positions, uvs };
}
const SKIRT_M = 1;

/** The dam (from planDams) whose outline holds (x, y), or null. */
export function damAt(dams, x, y) {
  for (const d of dams || []) {
    let box = d.box;
    if (!box) {
      box = [Infinity, Infinity, -Infinity, -Infinity];
      for (const [px, py] of d.ring) { box[0] = Math.min(box[0], px); box[1] = Math.min(box[1], py); box[2] = Math.max(box[2], px); box[3] = Math.max(box[3], py); }
      Object.defineProperty(d, 'box', { value: box, enumerable: false });
    }
    if (x < box[0] || x > box[2] || y < box[1] || y > box[3]) continue;
    if (inRing(x, y, d.ring)) return d;
  }
  return null;
}

const RAIL_OUT_M = 0.6;       // a guardrail this far past the road's drawn edge
const RAIL_MIN_M = 8;         // shorter stretches on a dam get none

/**
 * Guardrails along both sides of every road stretch on a dam (structure
 * solver classes 'dam'): [{ pts: [[x, y]...], z: [..] }], each line its
 * road's edge + RAIL_OUT_M out, at the road's solved height.
 */
export function damGuardrails(graph) {
  const z = graph?.profile?.z;
  const out = [];
  if (!z) return out;
  for (const seg of graph.classes?.segments || []) {
    if (seg.kind !== 'dam' || seg.s1 - seg.s0 < RAIL_MIN_M) continue;
    const e = graph.edges[seg.edge];
    const off = (e.half || 3.5) + RAIL_OUT_M;
    for (const side of [1, -1]) {
      const pts = []; const zz = [];
      for (let i = seg.i0; i <= seg.i1; i++) {
        const a = Math.max(seg.i0, i - 1); const b = Math.min(seg.i1, i + 1);
        const dx = e.x[b] - e.x[a]; const dy = e.y[b] - e.y[a]; const L = Math.hypot(dx, dy) || 1;
        pts.push([e.x[i] - (dy / L) * off * side, e.y[i] + (dx / L) * off * side]);
        zz.push(z[seg.edge][i]);
      }
      out.push({ pts, z: zz });
    }
  }
  return out;
}
