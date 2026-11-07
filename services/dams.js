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
  if (d.axis?.length > 1) return buildArchDam(m, d, groundAt);
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
export function damTopGeometry(d, uvM = 4, groundAt = null) {
  if (d.axis?.length > 1) return archTopGeometry(d, groundAt, uvM);
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

// ── Arch dams ────────────────────────────────────────────────────────────────
// A dam with a road along its crest is shaped round that road: the crest
// the road's width and a kerb each side, curving with it; the water side a
// wall straight down; the air side flaring out the deeper it goes (a bowl
// seen from below the dam), BASE_FRAC of its height thick at the foot.
const CREST_KERB_M = 1.5;
const BASE_FRAC = 0.25;
const FACE_STEP_M = 3;
const AXIS_STEP_M = 2;

/** Each dam with a road on it (structure solver class 'dam') takes that road's line as its axis. */
export function assignDamAxes(graph) {
  for (const d of graph?.dams || []) { delete d.axis; delete d.half; }
  for (const seg of graph?.classes?.segments || []) {
    if (seg.kind !== 'dam' || seg.i1 <= seg.i0) continue;
    const e = graph.edges[seg.edge];
    const pts = [];
    for (let i = seg.i0; i <= seg.i1; i++) pts.push([e.x[i], e.y[i]]);
    const mid = pts[pts.length >> 1];
    const d = damAt(graph.dams, mid[0], mid[1]);
    if (!d) continue;
    const len = seg.s1 - seg.s0;
    if (!d.axis || len > d.axisLen) { d.axis = pts; d.axisLen = len; d.half = e.half || 3.5; }
  }
}

function resampleLine(pts, step) {
  const out = [pts[0]];
  for (let i = 1; i < pts.length; i++) {
    const [ax, ay] = pts[i - 1]; const [bx, by] = pts[i];
    const n = Math.max(1, Math.round(Math.hypot(bx - ax, by - ay) / step));
    for (let k = 1; k <= n; k++) out.push([ax + ((bx - ax) * k) / n, ay + ((by - ay) * k) / n]);
  }
  return out;
}

/** The arch's frame: points along the axis, their normals, the air side's sign and the crest half width. */
function archFrame(d, groundAt) {
  const p = resampleLine(d.axis, AXIS_STEP_M);
  const n = p.map((_, i) => {
    const a = p[Math.max(0, i - 1)]; const b = p[Math.min(p.length - 1, i + 1)];
    const L = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
    return [-(b[1] - a[1]) / L, (b[0] - a[0]) / L];
  });
  // the air side: lower ground beside the dam (the lake bed is higher than the gorge)
  let lean = 0;
  p.forEach(([x, y], i) => {
    for (const r of [15, 30, 60]) {
      const gp = groundAt(x + n[i][0] * r, y + n[i][1] * r); const gm = groundAt(x - n[i][0] * r, y - n[i][1] * r);
      if (Number.isFinite(gp) && Number.isFinite(gm)) lean += gp - gm;
    }
  });
  const side = lean < 0 ? 1 : -1;
  return { p, n, side, hc: (d.half || 3.5) + CREST_KERB_M };
}

// a triangle facing dir (flipped if it faces away)
function facing(m, mat, a, b, c, ua, ub, uc, col, dir) {
  const ux = b[0] - a[0]; const uy = b[1] - a[1]; const uz = b[2] - a[2];
  const vx = c[0] - a[0]; const vy = c[1] - a[1]; const vz = c[2] - a[2];
  const nx = uy * vz - uz * vy; const ny = uz * vx - ux * vz; const nz = ux * vy - uy * vx;
  if (Math.abs(nx) + Math.abs(ny) + Math.abs(nz) < 1e-9) return;
  if (nx * dir[0] + ny * dir[1] + nz * dir[2] >= 0) m.tri(mat, a, b, c, ua, ub, uc, col);
  else m.tri(mat, a, c, b, ua, uc, ub, col);
}

/** The arch's walls (water side, air side, ends) into a mesh builder. Returns 'arch dam' or null. */
function buildArchDam(m, d, groundAt) {
  const { p, n, side, hc } = archFrame(d, groundAt);
  const { crest } = d;
  const gap = Math.max(d.gap || 0, 1);
  const g = (x, y) => { const v = groundAt(x, y); return Number.isFinite(v) ? v : crest; };
  const thick = (depth) => BASE_FRAC * depth * (0.4 + 0.6 * Math.min(1, depth / gap));
  const levels = [];
  for (let dd = 0; dd <= gap + FACE_STEP_M; dd += FACE_STEP_M) levels.push(dd);
  const along = [0];
  for (let i = 1; i < p.length; i++) along.push(along[i - 1] + Math.hypot(p[i][0] - p[i - 1][0], p[i][1] - p[i - 1][1]));
  // the water side: straight down from the crest's edge
  const up = p.map(([x, y], i) => [x - side * n[i][0] * hc, y - side * n[i][1] * hc]);
  const upFoot = up.map(([x, y]) => Math.min(crest, g(x, y) - FOOT_M));
  // the air side: a column per axis point, flaring out level by level to where it meets the ground
  const cols = p.map(([x, y], i) => {
    const col = [];
    let landed = false;
    for (const dd of levels) {
      if (landed) { col.push(col[col.length - 1]); continue; }
      const o = hc + thick(dd);
      const px = x + side * n[i][0] * o; const py = y + side * n[i][1] * o;
      const z = crest - dd; const gz = g(px, py);
      if (z <= gz) { col.push([px, py, Math.min(crest, gz - FOOT_M)]); landed = true; } else col.push([px, py, z]);
    }
    return col;
  });
  let tris = 0;
  for (let i = 0; i + 1 < p.length; i++) {
    const out = [side * n[i][0], side * n[i][1], 0];
    // water side
    if (upFoot[i] < crest || upFoot[i + 1] < crest) {
      const a = [up[i][0], up[i][1], upFoot[i]]; const b = [up[i + 1][0], up[i + 1][1], upFoot[i + 1]];
      const c = [up[i + 1][0], up[i + 1][1], crest]; const e = [up[i][0], up[i][1], crest];
      const inw = [-out[0], -out[1], 0];
      facing(m, 'concrete', a, b, c, [along[i] / 4, a[2] / 4], [along[i + 1] / 4, b[2] / 4], [along[i + 1] / 4, crest / 4], CONCRETE, inw);
      facing(m, 'concrete', a, c, e, [along[i] / 4, a[2] / 4], [along[i + 1] / 4, crest / 4], [along[i] / 4, crest / 4], CONCRETE, inw);
      tris += 2;
    }
    // air side (facing out and down the valley)
    const A = cols[i]; const B = cols[i + 1];
    for (let k = 0; k + 1 < levels.length; k++) {
      const a = A[k]; const b = B[k]; const c = B[k + 1]; const e = A[k + 1];
      if (a === e && b === c) break;
      const uv = (q, s) => [s / 4, q[2] / 4];
      facing(m, 'concrete', a, b, c, uv(a, along[i]), uv(b, along[i + 1]), uv(c, along[i + 1]), CONCRETE, out);
      facing(m, 'concrete', a, c, e, uv(a, along[i]), uv(c, along[i + 1]), uv(e, along[i]), CONCRETE, out);
      tris += 2;
    }
  }
  // the ends: closed where the arch stops short of the rock
  for (const i of [0, p.length - 1]) {
    const col = cols[i]; const dir = i === 0 ? [-(p[1][0] - p[0][0]), -(p[1][1] - p[0][1]), 0] : [p[i][0] - p[i - 1][0], p[i][1] - p[i - 1][1], 0];
    const top = [up[i][0], up[i][1], crest]; const foot = [up[i][0], up[i][1], upFoot[i]];
    const ring = [foot, ...col.slice().reverse()];
    for (let k = 0; k + 1 < ring.length; k++) {
      if (ring[k] === ring[k + 1]) continue;
      facing(m, 'concrete', top, ring[k], ring[k + 1], [0, crest / 4], [1, ring[k][2] / 4], [1, ring[k + 1][2] / 4], CONCRETE, dir);
      tris++;
    }
  }
  return tris ? 'arch dam' : null;
}

/** The arch's crest top (road surface, its own object): the strip over the axis, small triangles and a skirt. */
function archTopGeometry(d, groundAt, uvM) {
  const { p, n, hc } = archFrame(d, groundAt || (() => NaN));
  const positions = []; const uvs = [];
  const z = d.crest;
  const pt = (i, t) => [p[i][0] + n[i][0] * t, p[i][1] + n[i][1] * t];
  const across = Math.max(1, Math.ceil((2 * hc) / TOP_EDGE_M));
  const emitUp = (a, b, c) => {
    // (counter-clockwise from above: facing up)
    const cr = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
    const tri = cr >= 0 ? [a, b, c] : [a, c, b];
    for (const q of tri) { positions.push(q[0], q[1], q[2]); uvs.push(q[0] / uvM, q[1] / uvM); }
  };
  for (let i = 0; i + 1 < p.length; i++) {
    for (let k = 0; k < across; k++) {
      const t0 = -hc + (2 * hc * k) / across; const t1 = -hc + (2 * hc * (k + 1)) / across;
      const a = [...pt(i, t0), z]; const b = [...pt(i + 1, t0), z]; const c = [...pt(i + 1, t1), z]; const e = [...pt(i, t1), z];
      emitUp(a, b, c); emitUp(a, c, e);
    }
    // skirts along both edges (the object's box gets a height)
    for (const t of [-hc, hc]) {
      const a = pt(i, t); const b = pt(i + 1, t);
      for (const q of [[a, z - SKIRT_M], [b, z - SKIRT_M], [b, z], [a, z - SKIRT_M], [b, z], [a, z]]) { positions.push(q[0][0], q[0][1], q[1]); uvs.push(0, q[1] / uvM); }
    }
  }
  return { positions, uvs };
}
