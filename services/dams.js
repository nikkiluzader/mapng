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
    // (area: mapped as its footprint, which then shapes its faces; line: mapped along its crest, the axis itself)
    const mappedArea = isClosed(pts);
    out.push({ ring, crest, name: t.name || null, gap: crest - low, id: f.id, area: mappedArea, line: mappedArea ? null : pts, lineHalf: mappedArea ? null : (num(t.width) || LINE_WIDTH_M) / 2, tags: t });
  }
  return out;
}

/** Concrete walls round the dam from the ground to the crest, and its top. Returns 'dam' or null. */
export function buildDam(m, d, groundAt) {
  if (d.axis?.length > 1) return buildAxisDam(m, d, groundAt);
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
export function assignDamAxes(graph, ways = []) {
  for (const d of graph?.dams || []) { delete d.axis; delete d.half; delete d.axisFrom; }
  for (const seg of graph?.classes?.segments || []) {
    if (seg.kind !== 'dam' || seg.i1 <= seg.i0) continue;
    const e = graph.edges[seg.edge];
    const pts = [];
    for (let i = seg.i0; i <= seg.i1; i++) pts.push([e.x[i], e.y[i]]);
    const mid = pts[pts.length >> 1];
    const d = damAt(graph.dams, mid[0], mid[1]);
    if (!d) continue;
    const len = seg.s1 - seg.s0;
    if (!d.axis || len > d.axisLen) { d.axis = pts; d.axisLen = len; d.half = e.half || 3.5; d.axisFrom = 'road'; }
  }
  for (const d of graph?.dams || []) {
    if (d.axis) continue;
    // a path, a track or a service road over the crest (ways: [{ nodes: [[x, y]...], half }], not in the graph):
    // the one with the longest run on the dam, where it covers WAY_SHARE of the dam's length
    const long = damLength(d);
    let best = null;
    for (const w of ways || []) {
      let run = []; let top = [];
      for (const nd of w.nodes || []) { if (inRing(nd[0], nd[1], d.ring)) run.push([nd[0], nd[1]]); else { if (run.length > top.length) top = run; run = []; } }
      if (run.length > top.length) top = run;
      if (top.length < 2) continue;
      let len = 0; for (let i = 1; i < top.length; i++) len += Math.hypot(top[i][0] - top[i - 1][0], top[i][1] - top[i - 1][1]);
      if (len >= WAY_SHARE * long && (!best || len > best.len)) best = { pts: top, len, half: w.half || 1.5 };
    }
    if (best) { d.axis = best.pts; d.axisLen = best.len; d.half = best.half; d.axisFrom = 'way'; continue; }
    // nothing crosses it: a dam mapped along its crest has that line; one mapped as its footprint, the footprint's
    // middle line. The crest as wide as a dam of its height has (a walkway, CREST_BARE_M at least).
    const own = d.line?.length > 1 ? d.line : d.area ? ringCentreline(d.ring) : null;
    if (own?.length > 1) {
      d.axis = own; d.axisFrom = d.line ? 'line' : 'outline';
      d.half = Math.max(0.5, (d.line ? Math.max(d.lineHalf, CREST_BARE_M / 2) : Math.min(CREST_BARE_MAX_M, Math.max(CREST_BARE_M, (d.gap || 0) / 8)) / 2) - CREST_KERB_M);
    }
  }
}

const WAY_SHARE = 0.5;
const CREST_BARE_M = 4;
const CREST_BARE_MAX_M = 8;

/** A dam's length: the longer side of its outline's box along its main direction. */
function damLength(d) {
  const { u, c } = mainDirection(d.ring);
  let lo = Infinity; let hi = -Infinity;
  for (const [x, y] of d.ring) { const s = (x - c[0]) * u[0] + (y - c[1]) * u[1]; lo = Math.min(lo, s); hi = Math.max(hi, s); }
  return hi - lo;
}

// the direction a ring is longest in (its points' principal axis) and their centre
function mainDirection(ring) {
  const c = [0, 0]; for (const [x, y] of ring) { c[0] += x / ring.length; c[1] += y / ring.length; }
  let sxx = 0; let sxy = 0; let syy = 0;
  for (const [x, y] of ring) { const dx = x - c[0]; const dy = y - c[1]; sxx += dx * dx; sxy += dx * dy; syy += dy * dy; }
  const ang = 0.5 * Math.atan2(2 * sxy, sxx - syy);
  return { u: [Math.cos(ang), Math.sin(ang)], c };
}

/**
 * The middle line of a long outline: across its main direction every CENTRE_STEP_M, the midpoint of where the
 * outline is cut. A dam curved in plan gives a curved line.
 */
export function ringCentreline(ring, step = CENTRE_STEP_M) {
  if (!(ring?.length > 2)) return null;
  const { u, c } = mainDirection(ring); const v = [-u[1], u[0]];
  const st = ring.map(([x, y]) => [(x - c[0]) * u[0] + (y - c[1]) * u[1], (x - c[0]) * v[0] + (y - c[1]) * v[1]]);
  let lo = Infinity; let hi = -Infinity; for (const [s] of st) { lo = Math.min(lo, s); hi = Math.max(hi, s); }
  const out = [];
  for (let s = lo + step / 2; s < hi; s += step) {
    let a = Infinity; let b = -Infinity;
    for (let i = 0; i < st.length; i++) {
      const [s0, t0] = st[i]; const [s1, t1] = st[(i + 1) % st.length];
      if ((s0 - s) * (s1 - s) > 0 || s0 === s1) continue;
      const tt = t0 + ((t1 - t0) * (s - s0)) / (s1 - s0); a = Math.min(a, tt); b = Math.max(b, tt);
    }
    if (b - a < 0.5) continue;
    const m = (a + b) / 2; out.push([c[0] + u[0] * s + v[0] * m, c[1] + u[1] * s + v[1] * m]);
  }
  return out.length > 1 ? out : null;
}
const CENTRE_STEP_M = 6;

function resampleLine(pts, step) {
  const out = [pts[0]];
  for (let i = 1; i < pts.length; i++) {
    const [ax, ay] = pts[i - 1]; const [bx, by] = pts[i];
    const n = Math.max(1, Math.round(Math.hypot(bx - ax, by - ay) / step));
    for (let k = 1; k <= n; k++) out.push([ax + ((bx - ax) * k) / n, ay + ((by - ay) * k) / n]);
  }
  return out;
}

// Where a crest meets its banks, the
// crest's top comes down (or up) to the bank's ground: a flat slab at the crest's one height stood 15 cm and more
// proud of the ground at its end, a kerb across the road a car broke on (Zapora Pilchowice). The ends' ground from
// settleDamEnds; the top blends to the crest over END_RAMP_MIN_M at least, no steeper than END_RAMP_SLOPE.
const END_MAX_M = 1.5;        // an end further than this from the crest is no bank (left at the crest)
const END_SINK_M = 0.04;      // the end this far under the ground: no lip
const END_RAMP_MIN_M = 8;
const END_RAMP_SLOPE = 0.05;

/** Sets each dam's endZ [start, end]: the ground at its axis' two ends, where that is near its crest. */
export function settleDamEnds(dams, groundAt) {
  for (const d of dams || []) {
    delete d.endZ;
    // (a road of the graph too: it is pinned to the crest on the dam, and the bank beside it keeps its own ground)
    if (!(d.axis?.length > 1) || !groundAt) continue;
    d.endZ = [d.axis[0], d.axis.at(-1)].map(([x, y]) => { const g = groundAt(x, y); return Number.isFinite(g) && Math.abs(g - d.crest) <= END_MAX_M ? g - END_SINK_M : d.crest; });
  }
}

/** The crest top's height s metres along a dam's axis of length total. */
export function crestZAlong(d, s, total) {
  if (!d.endZ) return d.crest;
  let z = d.crest;
  [[s, d.endZ[0]], [total - s, d.endZ[1]]].forEach(([from, ez]) => {
    const ramp = Math.min(total * 0.3, Math.max(END_RAMP_MIN_M, Math.abs(ez - d.crest) / END_RAMP_SLOPE));
    if (from < ramp && ramp > 0) { const k = Math.max(0, from) / ramp; const e = k * k * (3 - 2 * k); z = ez + (d.crest - ez) * e; }
  });
  return z;
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
  const hc = (d.half || 3.5) + CREST_KERB_M;
  // (a dam mapped as its footprint: how far that reaches from the crest's middle on the air side and on the water
  // side, at each point along it, smoothed along the dam. These are the feet of its two faces)
  let air = null; let water = null;
  if (d.area) {
    const reach = (sgn) => smooth(p.map(([x, y], i) => { let r = 0; while (r < REACH_MAX_M && inRing(x + sgn * n[i][0] * (r + 1), y + sgn * n[i][1] * (r + 1), d.ring)) r += 1; return r; }), 3);
    air = reach(side); water = reach(-side);
  }
  return { p, n, side, hc, air, water };
}
const REACH_MAX_M = 400;
const smooth = (v, w) => v.map((_, i) => { let s = 0; let k = 0; for (let j = Math.max(0, i - w); j <= Math.min(v.length - 1, i + w); j++) { s += v[j]; k++; } return s / k; });

// What the dam is made of, as far as the map says: masonry where it is old (start_date before MASONRY_BEFORE)
// or protected as a monument, an earth or rock fill where it says so or where its footprint is several times as
// wide as it is high (FILL_RATIO: a fill dam's two slopes), else concrete. A face's [material, tint].
const MASONRY_BEFORE = 1935;
const FILL_RATIO = 2.2;
const WEATHERED = [0.62, 0.61, 0.59];
const MASONRY = [0.72, 0.7, 0.66];
const FILL = [0.5, 0.52, 0.44];
export function damKind(d, frame = null) {
  const t = d.tags || {};
  const said = `${t.material || ''} ${t['dam:type'] || ''} ${t.embankment || ''} ${t.man_made || ''} ${t.description || ''}`.toLowerCase();
  if (/earth|rock.?fill|embank|dyke|soil|gravel/.test(said)) return 'fill';
  if (frame?.air && d.gap > 3) {
    const wide = frame.air.map((a, i) => a + frame.water[i]).sort((a, b) => a - b);
    if (wide[wide.length >> 1] / d.gap >= FILL_RATIO) return 'fill';
  }
  const year = Number.parseInt(String(t.start_date || t.opening_date || '').slice(0, 4), 10);
  if (/concrete/.test(said)) return 'concrete';   // (said outright: a listed concrete dam is still concrete)
  if (/masonry|stone/.test(said) || (Number.isFinite(year) && year < MASONRY_BEFORE) || t.heritage || t.historic) return 'masonry';
  return 'concrete';
}
const FACE = { fill: ['stone', FILL], masonry: ['stone', MASONRY], concrete: ['concrete', WEATHERED] };

// a triangle facing dir (flipped if it faces away)
function facing(m, mat, a, b, c, ua, ub, uc, col, dir) {
  const ux = b[0] - a[0]; const uy = b[1] - a[1]; const uz = b[2] - a[2];
  const vx = c[0] - a[0]; const vy = c[1] - a[1]; const vz = c[2] - a[2];
  const nx = uy * vz - uz * vy; const ny = uz * vx - ux * vz; const nz = ux * vy - uy * vx;
  if (Math.abs(nx) + Math.abs(ny) + Math.abs(nz) < 1e-9) return;
  if (nx * dir[0] + ny * dir[1] + nz * dir[2] >= 0) m.tri(mat, a, b, c, ua, ub, uc, col);
  else m.tri(mat, a, c, b, ua, uc, ub, col);
}

// A dam's two faces. Each runs from the crest's edge down to its foot:
//   - a dam mapped as its footprint: to the footprint's edge on that side, in a straight batter (a gravity dam's
//     thick triangle, an arch dam's thin wall, a fill dam's two long slopes all come out as mapped). The bowl a
//     dam makes seen from below is then the mapped one, not one flare for every dam: Zapora Pilchowice, 50 m thick
//     at its foot and 7 m at its crest, was built 15 m thick with a hollow curve;
//   - a dam mapped as a line, or one whose footprint is no wider than its crest: the water side straight down, the
//     air side out by BATTER of its depth (a gravity wall), or the thin flare of an arch where the line is bent
//     like one (ARCH_SAG of its chord) and high.
const BATTER = 0.7;
const ARCH_SAG = 0.12;
const ARCH_MIN_M = 25;
const BATTER_SMOOTH = 0.25;
const SURVEYED_M = 3;
const SKIN_M = 0.6;
const SKIN_STEP_M = 0.5;
const SKIN_REACH_M = 20;
const PROFILE_PCT = 0.75;
const PROFILE_MIN_SHARE = 0.08;
const BURY_M = 3;              // a face runs this far into the ground
const SLOPE_MIN_M = 3;        // a side reaching less than this past the crest's edge is a wall straight down

/** The dam's walls (water side, air side, ends) into a mesh builder. Returns its kind or null. */
function buildAxisDam(m, d, groundAt) {
  const frame = archFrame(d, groundAt);
  const { p, n, side, hc } = frame;
  // (a footprint that reaches no further than the crest's own edge says nothing about the faces)
  const mid = (v) => v.slice().sort((a, b) => a - b)[v.length >> 1];
  const shaped = !!frame.air && Math.max(mid(frame.air), mid(frame.water)) - hc >= SLOPE_MIN_M;
  const air = shaped ? frame.air : null; const water = shaped ? frame.water : null;
  const { crest } = d;
  const gap = Math.max(d.gap || 0, 1);
  const kind = damKind(d, shaped ? frame : null);
  const [mat, tint] = FACE[kind];
  const g = (x, y) => { const v = groundAt(x, y); return Number.isFinite(v) ? v : crest; };
  // (bent like an arch: how far its middle stands off the line between its ends)
  const chord = Math.hypot(p.at(-1)[0] - p[0][0], p.at(-1)[1] - p[0][1]) || 1;
  const sag = Math.max(...p.map(([x, y]) => Math.abs((p.at(-1)[0] - p[0][0]) * (p[0][1] - y) - (p[0][0] - x) * (p.at(-1)[1] - p[0][1])) / chord));
  const arch = !air && sag / chord >= ARCH_SAG && gap >= ARCH_MIN_M;
  // (the survey holds the dam: most of the crest line's ground within SURVEYED_M of the crest)
  const under = p.map(([x, y]) => crest - g(x, y)).sort((a, b) => a - b);
  const surveyed = under[Math.floor(under.length * 0.7)] <= SURVEYED_M;
  // How far a face stands out past the crest's edge at a depth under the crest, at axis point i. A mapped footprint
  // gives the face's batter (how far out per metre down), not its foot line: each slice run to the outline's own
  // corners made a face of creased wedges (Zapora Pilchowice from above). The batter read at every slice, then
  // smoothed along the dam over BATTER_SMOOTH of its length, the deep slices weighing most; the face lands where
  // it meets the ground, which draws the foot line a real dam has.
  const outAt = (reach, sgn) => {
    if (!reach) return (i, depth) => (sgn !== side ? 0 : arch ? BASE_FRAC * depth * (0.4 + 0.6 * Math.min(1, depth / gap)) : BATTER * depth);
    const r = reach.map((v) => Math.max(0, v - hc));
    if (!surveyed && mid(r) < SLOPE_MIN_M) return () => 0;
    // A survey that holds the dam itself (the ground along the crest at the crest's height): the face is that
    // surveyed shape with a skin over it, SKIN_M out, from the crest edge to the mapped footprint's edge. One
    // batter stood in front of a hollow face in the middle and behind it at the sides, the model showing in a
    // strip (Hoover Dam). Read level by level outwards, then evened along the dam.
    if (surveyed) {
      // (slice by slice the skin carried every bit of the survey's noise, each tower and every half-metre step of
      // the reading: a face of dents and facets. One profile for the whole face instead: at each depth, how far out
      // the surveyed face stands, taken over all the slices that reach that depth (PROFILE_PCT of them: the skin
      // stays in front of nearly all of the face), then evened down the face and never stepping back in. Swept
      // along the crest, whose own line already carries the dam's curve in plan.)
      const nLev = Math.floor((gap + FACE_STEP_M) / FACE_STEP_M) + 1;
      const seen = Array.from({ length: nLev }, () => []);
      p.forEach(([x, y], i) => {
        const cap = Math.max(r[i], SKIN_REACH_M); let o = 0;
        for (let k = 0; k < nLev; k++) {
          const z = crest - k * FACE_STEP_M;
          while (o < cap && g(x + sgn * n[i][0] * (hc + o), y + sgn * n[i][1] * (hc + o)) > z - SKIN_M) o += SKIN_STEP_M;
          if (o >= cap) break;   // (into the hillside or past the footprint: this slice says nothing deeper)
          seen[k].push(o);
        }
      });
      const prof = [];
      for (let k = 0; k < nLev; k++) {
        const v = seen[k].sort((a, b) => a - b);
        if (v.length >= Math.max(3, p.length * PROFILE_MIN_SHARE)) prof.push(v[Math.min(v.length - 1, Math.floor(v.length * PROFILE_PCT))]);
        else prof.push(k < 2 ? 0 : prof[k - 1] + (prof[k - 1] - prof[k - 2]));   // (deeper than the survey shows: on at the last slope)
      }
      for (let pass = 0; pass < 2; pass++) for (let k = 1; k + 1 < nLev; k++) prof[k] = (prof[k - 1] + 2 * prof[k] + prof[k + 1]) / 4;
      for (let k = 1; k < nLev; k++) prof[k] = Math.max(prof[k], prof[k - 1]);
      return (i, depth) => {
        if (depth <= 0) return 0;
        const f = Math.min(nLev - 1, depth / FACE_STEP_M); const k = Math.floor(f); const k1 = Math.min(nLev - 1, k + 1);
        return prof[k] + (prof[k1] - prof[k]) * (f - k) + SKIN_M;
      };
    }
    const deep = reach.map((v, i) => Math.max(0, crest - g(p[i][0] + sgn * n[i][0] * v, p[i][1] + sgn * n[i][1] * v)));
    const w = Math.max(4, Math.round(p.length * BATTER_SMOOTH));
    const all = r.reduce((s, v) => s + v, 0) / Math.max(1, deep.reduce((s, v) => s + v, 0));
    const slope = p.map((_, i) => {
      let num = 0; let den = 0;
      for (let j = Math.max(0, i - w); j <= Math.min(p.length - 1, i + w); j++) { num += r[j]; den += deep[j]; }
      return den > 1 ? num / den : all;
    });
    return (i, depth) => slope[i] * depth;
  };
  const levels = [];
  for (let dd = 0; dd <= gap + FACE_STEP_M; dd += FACE_STEP_M) levels.push(dd);
  const along = [0];
  for (let i = 1; i < p.length; i++) along.push(along[i - 1] + Math.hypot(p[i][0] - p[i - 1][0], p[i][1] - p[i - 1][1]));
  // a column per axis point and side: out level by level to where it meets the ground
  const columns = (sgn, out) => p.map(([x, y], i) => {
    const col = []; let landed = false;
    for (const dd of levels) {
      if (landed) { col.push(col[col.length - 1]); continue; }
      const o = hc + out(i, dd);
      const px = x + sgn * n[i][0] * o; const py = y + sgn * n[i][1] * o;
      const z = Math.min(crest - dd, crestZAlong(d, along[i], along.at(-1))); const gz = g(px, py);
      // (the face is not fitted to the hill it stands in: it keeps its batter and stops BURY_M under the ground,
      // its foot out of sight. Snapped to the ground's own height at each slice, the foot row was a ragged fan)
      col.push([px, py, z]);
      if (z <= gz - BURY_M) landed = true;
    }
    // (a wall straight down that the levels did not land: its foot in the ground)
    if (!landed) { const q = col[col.length - 1]; col[col.length - 1] = [q[0], q[1], Math.min(q[2], g(q[0], q[1]) - FOOT_M)]; }
    return col;
  });
  const sides = [[side, columns(side, outAt(air, side))], [-side, columns(-side, outAt(water, -side))]];
  let tris = 0;
  const uv = (q, s) => [s / 4, q[2] / 4];
  for (const [sgn, cols] of sides) {
    for (let i = 0; i + 1 < p.length; i++) {
      const out = [sgn * n[i][0], sgn * n[i][1], 0];
      const A = cols[i]; const B = cols[i + 1];
      for (let k = 0; k + 1 < levels.length; k++) {
        const a = A[k]; const b = B[k]; const c = B[k + 1]; const e = A[k + 1];
        if (a === e && b === c) break;
        facing(m, mat, a, b, c, uv(a, along[i]), uv(b, along[i + 1]), uv(c, along[i + 1]), tint, out);
        facing(m, mat, a, c, e, uv(a, along[i]), uv(c, along[i + 1]), uv(e, along[i]), tint, out);
        tris += 2;
      }
    }
  }
  // the ends: closed where the dam stops short of the rock
  for (const i of [0, p.length - 1]) {
    const dir = i === 0 ? [-(p[1][0] - p[0][0]), -(p[1][1] - p[0][1]), 0] : [p[i][0] - p[i - 1][0], p[i][1] - p[i - 1][1], 0];
    const top = [p[i][0], p[i][1], crest];
    const ring = [...sides[1][1][i], ...sides[0][1][i].slice().reverse()];
    for (let k = 0; k + 1 < ring.length; k++) {
      if (ring[k] === ring[k + 1]) continue;
      facing(m, mat, top, ring[k], ring[k + 1], [0, crest / 4], [1, ring[k][2] / 4], [1, ring[k + 1][2] / 4], tint, dir);
      tris++;
    }
  }
  return tris ? `${arch ? 'arch' : kind} dam` : null;
}

/** The arch's crest top (road surface, its own object): the strip over the axis, small triangles and a skirt. */
function archTopGeometry(d, groundAt, uvM) {
  const { p, n, hc } = archFrame(d, groundAt || (() => NaN));
  const positions = []; const uvs = [];
  const along = [0];
  for (let i = 1; i < p.length; i++) along.push(along[i - 1] + Math.hypot(p[i][0] - p[i - 1][0], p[i][1] - p[i - 1][1]));
  const zAt = (i) => crestZAlong(d, along[i], along.at(-1));
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
      const z0 = zAt(i); const z1 = zAt(i + 1);
      const a = [...pt(i, t0), z0]; const b = [...pt(i + 1, t0), z1]; const c = [...pt(i + 1, t1), z1]; const e = [...pt(i, t1), z0];
      emitUp(a, b, c); emitUp(a, c, e);
    }
    // skirts along both edges (the object's box gets a height)
    for (const t of [-hc, hc]) {
      const a = pt(i, t); const b = pt(i + 1, t);
      const za = zAt(i); const zb = zAt(i + 1);
      for (const q of [[a, za - SKIRT_M], [b, zb - SKIRT_M], [b, zb], [a, za - SKIRT_M], [b, zb], [a, za]]) { positions.push(q[0][0], q[0][1], q[1]); uvs.push(0, q[1] / uvM); }
    }
  }
  return { positions, uvs };
}
