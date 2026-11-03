// Building details for BeamNG exports (refs/output/earth-detail-plan.md, A1 + A3): the parts that make a
// footprint read as a building of its place and use. MapNG's own look (the plan: BeamNG.Earth's
// details are the reference for WHICH things matter, not how they look):
//
//   - a parapet in the building's own wall, a pale coping and a string course under it on flat-roofed
//     blocks (the facade carried up, not a moulding stuck on);
//   - shopfronts with awnings in a short palette of strong colours, or a dark fascia, shop by shop along
//     the walls that face a street only;
//   - houses: their entrance by region (a veranda in North America and Oceania, a gabled door hood in
//     Europe), steps where the floor stands over the street, a chimney on pitched roofs where winters
//     ask for one;
//   - flat roofs: plant boxes and a stair bulkhead, round water tanks on legs on US mid-rises;
//   - places of worship: a bell tower and spire for churches, a dome and minaret for mosques;
//   - silos and tanks as cylinders;
//   - an arch through a building where a road passes it (tunnel=building_passage).
//
// Every helper takes a mesh builder (quad / tri, beamngBuildings.js MeshBuilder) and world-space metres;
// walls face out (a ring counter-clockwise, its outside on each edge's right). Deterministic: choices
// hash the building's seed. Pure geometry, no place-specific rules.

const v2 = (a, b) => [b[0] - a[0], b[1] - a[1]];
const len2 = (v) => Math.hypot(v[0], v[1]);

/** A vertical quad from a to b (plan points) between z0 and z1, facing the edge's right (outside). */
export function wallQuad(m, mat, a, b, z0, z1, col, uvM = 3, outward = true) {
  const L = len2(v2(a, b));
  const P = [[a[0], a[1], z0], [b[0], b[1], z0], [b[0], b[1], z1], [a[0], a[1], z1]];
  const U = [[0, z0 / uvM], [L / uvM, z0 / uvM], [L / uvM, z1 / uvM], [0, z1 / uvM]];
  if (outward) m.quad(mat, P[0], P[1], P[2], P[3], U[0], U[1], U[2], U[3], col);
  else m.quad(mat, P[1], P[0], P[3], P[2], U[1], U[0], U[3], U[2], col);
}

/** A box: centre c (plan), unit axis u, half sizes hx (along u) / hy, z0..z1; top always, bottom if asked. */
export function box(m, mat, c, u, hx, hy, z0, z1, col, { uvM = 1, bottom = false } = {}) {
  const v = [-u[1], u[0]];
  const k = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([sx, sy]) => [c[0] + u[0] * sx * hx + v[0] * sy * hy, c[1] + u[1] * sx * hx + v[1] * sy * hy]);
  for (let i = 0; i < 4; i++) wallQuad(m, mat, k[i], k[(i + 1) % 4], z0, z1, col, uvM);
  m.quad(mat, [...k[0], z1], [...k[1], z1], [...k[2], z1], [...k[3], z1],
    [k[0][0] / uvM, k[0][1] / uvM], [k[1][0] / uvM, k[1][1] / uvM], [k[2][0] / uvM, k[2][1] / uvM], [k[3][0] / uvM, k[3][1] / uvM], col);
  if (bottom) m.quad(mat, [...k[3], z0], [...k[2], z0], [...k[1], z0], [...k[0], z0], [0, 1], [1, 1], [1, 0], [0, 0], col);
}

const circle = (cx, cy, r, n) => Array.from({ length: n }, (_, i) => [cx + r * Math.cos((2 * Math.PI * i) / n), cy + r * Math.sin((2 * Math.PI * i) / n)]);

/** A cylinder's side (and its top, unless capped by something else). */
export function cylinder(m, mat, cx, cy, r, z0, z1, col, { n = 16, uvM = 3, top = true } = {}) {
  const p = circle(cx, cy, r, n);
  const per = (2 * Math.PI * r) / n;
  for (let i = 0; i < n; i++) {
    const a = p[i]; const b = p[(i + 1) % n];
    m.quad(mat, [...a, z0], [...b, z0], [...b, z1], [...a, z1],
      [(i * per) / uvM, z0 / uvM], [((i + 1) * per) / uvM, z0 / uvM], [((i + 1) * per) / uvM, z1 / uvM], [(i * per) / uvM, z1 / uvM], col);
  }
  if (top) for (let i = 1; i + 1 < n; i++) m.tri(mat, [...p[0], z1], [...p[i], z1], [...p[i + 1], z1], [0, 0], [1, 0], [1, 1], col);
}

/** A cone (spire, silo roof) from a circle of radius r at z0 to its apex. */
export function cone(m, mat, cx, cy, r, z0, zTop, col, { n = 16 } = {}) {
  const p = circle(cx, cy, r, n);
  const s = Math.hypot(r, zTop - z0);
  for (let i = 0; i < n; i++) {
    const a = p[i]; const b = p[(i + 1) % n];
    m.tri(mat, [...a, z0], [...b, z0], [cx, cy, zTop], [0, 0], [(2 * Math.PI * r) / n / 3, 0], [0.5, s / 3], col);
  }
}

/** A hemispherical dome of radius r sitting on z0 (squashed by `rise`: 1 a half sphere). */
export function dome(m, mat, cx, cy, r, z0, col, { n = 20, rings = 6, rise = 1 } = {}) {
  let prev = circle(cx, cy, r, n).map((q) => [...q, z0]);
  for (let k = 1; k <= rings; k++) {
    const t = (k / rings) * (Math.PI / 2);
    const rr = r * Math.cos(t); const z = z0 + r * rise * Math.sin(t);
    const cur = k === rings ? null : circle(cx, cy, rr, n).map((q) => [...q, z]);
    for (let i = 0; i < n; i++) {
      const a = prev[i]; const b = prev[(i + 1) % n];
      if (cur) m.quad(mat, a, b, cur[(i + 1) % n], cur[i], [i / n, k - 1], [(i + 1) / n, k - 1], [(i + 1) / n, k], [i / n, k], col);
      else m.tri(mat, a, b, [cx, cy, z], [i / n, k - 1], [(i + 1) / n, k - 1], [(i + 0.5) / n, k], col);
    }
    prev = cur;
  }
}

// ── Streets: which walls face one ─────────────────────────────────────────────

const STREET_CLASSES = new Set(['motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'unclassified', 'residential', 'living_street', 'pedestrian', 'service',
  'motorway_link', 'trunk_link', 'primary_link', 'secondary_link', 'tertiary_link']);
const FACE_REACH_M = 30;
const CELL = 32;
// a street's drawn half width for the ground in front of a wall (its width=*
// or lanes, else its class's usual): a canopy or veranda stops short of it
const CLASS_HALF_M = { motorway: 7, trunk: 6, primary: 5, secondary: 4.5, tertiary: 4, unclassified: 3.2, residential: 3.2,
  living_street: 3, pedestrian: 3, service: 2.5 };
function streetHalf(t = {}, hw = '') {
  const w = Number.parseFloat(t.width);
  if (Number.isFinite(w) && w > 1) return w / 2;
  const lanes = Number.parseInt(t.lanes, 10);
  if (lanes > 0) return lanes * 1.7;
  return CLASS_HALF_M[String(hw).replace(/_link$/, '')] ?? 3;
}

const RACE_PASSAGE_HALF_M = 8.5;   // (a raceway is drawn 14 m wide unless tagged)

/**
 * An index of the street centre lines (and the passage roads, apart) for the buildings: facing(a, b)
 * -> the distance from wall a-b's middle to the nearest street in front of it (within FACE_REACH_M), or
 * null; passages: [{ line: [[x, y]...], half }] of roads through buildings.
 */
export function streetIndex(features, project) {
  const grid = new Map();
  const segs = [];
  const passages = [];
  for (const f of features || []) {
    if (f?.type !== 'road' || !Array.isArray(f.geometry) || f.geometry.length < 2) continue;
    const t = f.tags || {};
    const hw = t.highway;
    const line = f.geometry.map((p) => project(p.lat, p.lng));
    if (t.tunnel === 'building_passage' || (t.covered === 'yes' && t.tunnel !== 'yes')) {
      const half = STREET_CLASSES.has(hw) && hw !== 'pedestrian' ? Math.max(1.8, (Number.parseFloat(t.width) || 0) / 2 || 2.2) : 1.4;
      passages.push({ line, half });
      continue;
    }
    // a racing line never stops at a building: one mapped across a track
    // (hospitality over the straight, level=1 and the like) has it pass under
    if (hw === 'raceway' && t.area !== 'yes' && (!t.tunnel || t.tunnel === 'no') && (!t.bridge || t.bridge === 'no')) {
      passages.push({ line, half: Math.max(RACE_PASSAGE_HALF_M, (Number.parseFloat(t.width) || 0) / 2) });
      continue;
    }
    if (!STREET_CLASSES.has(hw) || (t.tunnel && t.tunnel !== 'no') || t.service === 'parking_aisle' || t.service === 'driveway') continue;
    const half = streetHalf(t, hw);
    for (let i = 0; i + 1 < line.length; i++) {
      const k = segs.length; const a = line[i]; const b = line[i + 1];
      segs.push([a, b, half]);
      for (let gx = Math.floor(Math.min(a[0], b[0]) / CELL); gx <= Math.floor(Math.max(a[0], b[0]) / CELL); gx++) {
        for (let gy = Math.floor(Math.min(a[1], b[1]) / CELL); gy <= Math.floor(Math.max(a[1], b[1]) / CELL); gy++) {
          const key = `${gx},${gy}`;
          if (!grid.has(key)) grid.set(key, []);
          grid.get(key).push(k);
        }
      }
    }
  }
  const facing = (a, b) => {
    const e = v2(a, b); const L = len2(e);
    if (L < 0.5) return null;
    const mid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    const n = [e[1] / L, -e[0] / L];
    let best = null;
    const seen = new Set();
    for (let gx = Math.floor((mid[0] - FACE_REACH_M) / CELL); gx <= Math.floor((mid[0] + FACE_REACH_M) / CELL); gx++) {
      for (let gy = Math.floor((mid[1] - FACE_REACH_M) / CELL); gy <= Math.floor((mid[1] + FACE_REACH_M) / CELL); gy++) {
        for (const k of grid.get(`${gx},${gy}`) || []) {
          if (seen.has(k)) continue;
          seen.add(k);
          const [p, q] = segs[k];
          const s = v2(p, q); const S2 = s[0] * s[0] + s[1] * s[1];
          const t = S2 > 1e-9 ? Math.max(0, Math.min(1, ((mid[0] - p[0]) * s[0] + (mid[1] - p[1]) * s[1]) / S2)) : 0;
          const c = [p[0] + s[0] * t, p[1] + s[1] * t];
          const d = v2(mid, c); const D = len2(d);
          if (D > FACE_REACH_M || D < 0.5) continue;
          // in front of the wall, and the wall roughly along the street
          if ((d[0] * n[0] + d[1] * n[1]) / D < 0.7) continue;
          if (best === null || D < best) best = D;
        }
      }
    }
    return best;
  };
  // the ground in front of wall a-b's stretch t0..t1 (metres along it) before
  // any street's drawn edge, sampled along it: Infinity with none near (a
  // hotel's canopy reached its posts into the middle of a narrow street)
  const clearance = (a, b, t0 = null, t1 = null) => {
    const e = v2(a, b); const L = len2(e);
    if (L < 0.5) return Infinity;
    const d = [e[0] / L, e[1] / L]; const n = [d[1], -d[0]];
    const from = t0 ?? 0; const to = t1 ?? L;
    let best = Infinity;
    for (let t = from; t <= to + 1e-6; t += Math.max(0.5, (to - from) / 8)) {
      const o = [a[0] + d[0] * t, a[1] + d[1] * t];
      for (let gx = Math.floor((o[0] - CLEAR_REACH_M) / CELL); gx <= Math.floor((o[0] + CLEAR_REACH_M) / CELL); gx++) {
        for (let gy = Math.floor((o[1] - CLEAR_REACH_M) / CELL); gy <= Math.floor((o[1] + CLEAR_REACH_M) / CELL); gy++) {
          for (const k of grid.get(`${gx},${gy}`) || []) {
            const [p, q, half] = segs[k];
            // straight out from the wall at o: where it meets the street's edge
            for (let k2 = 0; k2 <= CLEAR_REACH_M * 4; k2++) {
              const r = k2 / 4;
              if (r >= best) break;
              const x = o[0] + n[0] * r; const y = o[1] + n[1] * r;
              const s = v2(p, q); const S2 = s[0] * s[0] + s[1] * s[1];
              const u = S2 > 1e-9 ? Math.max(0, Math.min(1, ((x - p[0]) * s[0] + (y - p[1]) * s[1]) / S2)) : 0;
              if (Math.hypot(p[0] + s[0] * u - x, p[1] + s[1] * u - y) < half) { best = Math.min(best, r); break; }
            }
          }
        }
      }
    }
    return best;
  };
  passages.push(...courtyardPassages(features, project, passages, facing));
  return { facing, clearance, passages };
}
const CLEAR_REACH_M = 6;

// An enclosed courtyard (a building's inner ring) is reached through an
// archway: OSM rarely maps the passage itself, only the paths inside and the
// walk or square outside. The arch goes where a way outside ends at the wall
// (or a square meets it) nearest the courtyard, else through the wall facing
// the nearest street; straight to the courtyard's wall the shortest way, or
// to a courtyard path's end there if that is little further.
const COURTYARD_MIN_M2 = 40;
const ARCH_HALF_M = 1.5;
const ARCH_MAX_DEPTH_M = 30;     // the deepest wing an arch is cut through
const ARCH_REACH_M = 4;          // a way's end this near a wall: it leads there
const ARCH_PAST_M = 1;           // the passage's line runs on past each wall
const ARCH_SKEW_SIN = Math.sin((15 * Math.PI) / 180);   // to a courtyard path's end: at most this far off square

const ringArea = (r) => { let a = 0; for (let i = 0; i < r.length; i++) { const p = r[i]; const q = r[(i + 1) % r.length]; a += p[0] * q[1] - q[0] * p[1]; } return Math.abs(a) / 2; };
// the nearest point on a ring's edges to p: [x, y, distance]
// a ring's box grown by pad: [x0, y0, x1, y1]
function ringBox(ring, pad) {
  let x0 = Infinity; let y0 = Infinity; let x1 = -Infinity; let y1 = -Infinity;
  for (const q of ring) { if (q[0] < x0) x0 = q[0]; if (q[0] > x1) x1 = q[0]; if (q[1] < y0) y0 = q[1]; if (q[1] > y1) y1 = q[1]; }
  return [x0 - pad, y0 - pad, x1 + pad, y1 + pad];
}
const segBox = (a, b) => [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[0], b[0]), Math.max(a[1], b[1])];
const boxesMeet = (a, b) => a[0] <= b[2] && a[2] >= b[0] && a[1] <= b[3] && a[3] >= b[1];
const inBox = (p, b) => p[0] >= b[0] && p[0] <= b[2] && p[1] >= b[1] && p[1] <= b[3];

function nearestOnRing(p, ring) {
  let best = null;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i]; const b = ring[(i + 1) % ring.length]; const e = v2(a, b); const L2 = e[0] * e[0] + e[1] * e[1];
    const t = L2 > 1e-9 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * e[0] + (p[1] - a[1]) * e[1]) / L2)) : 0;
    const c = [a[0] + e[0] * t, a[1] + e[1] * t]; const d = Math.hypot(c[0] - p[0], c[1] - p[1]);
    if (!best || d < best[2]) best = [c[0], c[1], d];
  }
  return best;
}
// the unit direction of a ring's edge nearest p
function wallDirAt(p, ring) {
  let best = null; let bd = Infinity;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i]; const b = ring[(i + 1) % ring.length]; const e = v2(a, b); const L = len2(e);
    if (L < 1e-6) continue;
    const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * e[0] + (p[1] - a[1]) * e[1]) / (L * L)));
    const d = Math.hypot(a[0] + e[0] * t - p[0], a[1] + e[1] * t - p[1]);
    if (d < bd) { bd = d; best = [e[0] / L, e[1] / L]; }
  }
  return best;
}
// where a ray from p along unit d first meets a ring (within ARCH_MAX_DEPTH_M), or null
function rayToRing(p, d, ring) {
  let best = null;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i]; const b = ring[(i + 1) % ring.length]; const e = v2(a, b);
    const den = e[0] * d[1] - e[1] * d[0];
    if (Math.abs(den) < 1e-9) continue;
    const t = ((p[0] - a[0]) * d[1] - (p[1] - a[1]) * d[0]) / den;     // along the edge
    const u = ((p[0] - a[0]) * e[1] - (p[1] - a[1]) * e[0]) / den;     // along the ray
    if (t < 0 || t > 1 || u <= 0.1 || u > ARCH_MAX_DEPTH_M) continue;
    if (best === null || u < best) best = u;
  }
  return best === null ? null : [p[0] + d[0] * best, p[1] + d[1] * best];
}
// how many times segment p-q crosses a ring's edges
function crossingsOf(p, q, ring) {
  let n = 0; const s = v2(p, q);
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i]; const b = ring[(i + 1) % ring.length]; const e = v2(a, b);
    const den = e[0] * s[1] - e[1] * s[0];
    if (Math.abs(den) < 1e-9) continue;
    const t = ((p[0] - a[0]) * s[1] - (p[1] - a[1]) * s[0]) / den;
    const u = ((p[0] - a[0]) * e[1] - (p[1] - a[1]) * e[0]) / den;
    if (t >= 0 && t <= 1 && u >= 0 && u <= 1) n++;
  }
  return n;
}

// The middle of where a square meets a building's outer wall (its edge
// sampled every half metre; the longest run of samples on the wall, or else
// within reach of it, halfway along it), or null.
function squareFront(sq, outer) {
  // (where it lies along the wall itself; failing that, where it comes near)
  return squareFrontWithin(sq, outer, 0.15) ?? squareFrontWithin(sq, outer, ARCH_REACH_M);
}
function squareFrontWithin(sq, outer, reach) {
  const runs = [];
  let run = null;
  for (let i = 0; i + 1 < sq.length; i++) {
    const a = sq[i]; const b = sq[i + 1]; const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const n = Math.max(1, Math.ceil(L / 0.5));
    for (let k = 0; k < n; k++) {
      const p = [a[0] + ((b[0] - a[0]) * k) / n, a[1] + ((b[1] - a[1]) * k) / n];
      const near = nearestOnRing(p, outer)[2] < reach && (reach < 1 || !inRing(p, outer));
      if (near) { if (!run) runs.push(run = { pts: [], len: 0 }); else run.len += Math.hypot(p[0] - run.pts[run.pts.length - 1][0], p[1] - run.pts[run.pts.length - 1][1]); run.pts.push(p); } else run = null;
    }
  }
  // (a ring's run may wrap round its first vertex)
  if (runs.length > 1 && runs[0].pts[0] && sq.length > 2) {
    const first = runs[0]; const last = runs[runs.length - 1];
    const lp = last.pts[last.pts.length - 1]; const fp = first.pts[0];
    if (Math.hypot(lp[0] - fp[0], lp[1] - fp[1]) < 0.75) { last.len += first.len + Math.hypot(lp[0] - fp[0], lp[1] - fp[1]); last.pts.push(...first.pts); runs.shift(); }
  }
  const best = runs.sort((x, y) => y.len - x.len)[0];
  if (!best || best.len < ARCH_HALF_M * 2) return null;
  let walked = 0;
  for (let i = 1; i < best.pts.length; i++) {
    walked += Math.hypot(best.pts[i][0] - best.pts[i - 1][0], best.pts[i][1] - best.pts[i - 1][1]);
    if (walked >= best.len / 2) return best.pts[i];
  }
  return best.pts[best.pts.length - 1];
}

/**
 * Archways into enclosed courtyards: [{ line: [[x, y], [x, y]], half, courtyard: true }],
 * one per courtyard no mapped passage reaches. facing(a, b): the street in front of a wall (streetIndex).
 */
export function courtyardPassages(features, project, mapped = [], facing = () => null) {
  const out = [];
  const ways = [];
  const squares = [];
  for (const f of features || []) {
    const t = f?.tags || {};
    if (f?.type !== 'road' || !t.highway || !(f.geometry?.length >= 2)) continue;
    if (t.area === 'yes' && t.highway === 'pedestrian') { squares.push(f.geometry.map((p) => project(p.lat, p.lng))); continue; }
    if ((t.tunnel && t.tunnel !== 'no') || (t.bridge && t.bridge !== 'no') || t.indoor === 'yes') continue;
    const line = f.geometry.map((p) => project(p.lat, p.lng));
    ways.push([line[0], line[line.length - 1]]);
  }
  for (const f of features || []) {
    if (f?.type !== 'building' || !f.holes?.length || !(f.geometry?.length >= 4)) continue;
    const t = f.tags || {};
    // (a fort's or castle's gate is its own: buildingDetails fortGate)
    if (t.historic === 'fort' || t.historic === 'castle' || t.building === 'castle' || t.military) continue;
    const outer = f.geometry.map((p) => project(p.lat, p.lng)).map(([x, y]) => [x, y]);
    // (boxes first: every path end and square in the map was measured
    // against every courtyard building's walls)
    const ob = ringBox(outer, ARCH_REACH_M);
    for (const h of f.holes) {
      const hole = h.map((p) => project(p.lat, p.lng)).map(([x, y]) => [x, y]);
      if (hole.length < 3 || ringArea(hole) < COURTYARD_MIN_M2) continue;
      const hb = ringBox(hole, 0);
      // a mapped passage already into it
      if (mapped.some(({ line }) => line.some((q, i) => i > 0 && boxesMeet(segBox(line[i - 1], q), hb) && crossingsOf(line[i - 1], q, hole) > 0))) continue;
      // where the courtyard's paths end at its wall
      const inner = [];
      for (const [a, b] of ways) for (const e of [a, b]) if (inBox(e, hb) && inRing(e, hole) && nearestOnRing(e, hole)[2] < ARCH_REACH_M) inner.push(e);
      // where the walks outside end at the building, and where squares meet it
      const doors = [];
      for (const [a, b] of ways) for (const e of [a, b]) if (inBox(e, ob) && !inRing(e, outer) && nearestOnRing(e, outer)[2] < ARCH_REACH_M) doors.push(e);
      // (a square fronting the building: the arch in the middle of its frontage,
      // the main entrance, before any side walk's end)
      const fronts = squares.map((sq) => (boxesMeet(ringBox(sq, 0), ob) ? squareFront(sq, outer) : null)).filter(Boolean);
      if (fronts.length) doors.splice(0, doors.length, ...fronts);
      if (!doors.length) {
        // no way to the building: through the wall facing the nearest street
        let best = null;
        for (let i = 0; i < outer.length; i++) {
          const a = outer[i]; const b = outer[(i + 1) % outer.length];
          const d = facing(a, b) ?? facing(b, a);
          if (d === null || len2(v2(a, b)) < ARCH_HALF_M * 3) continue;
          if (!best || d < best.d) best = { d, mid: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], a, b };
        }
        if (best) {
          // a step out from the wall's middle (outward: away from the hole's side)
          const e = v2(best.a, best.b); const L = len2(e); const n = [-e[1] / L, e[0] / L];
          const o = [best.mid[0] + n[0] * 0.5, best.mid[1] + n[1] * 0.5];
          doors.push(inRing(o, outer) ? [best.mid[0] - n[0] * 0.5, best.mid[1] - n[1] * 0.5] : o);
        }
      }
      let pick = null;
      for (const o of doors) {
        const w = nearestOnRing(o, outer);
        // the outer wall's direction there (an arch cuts square through it)
        const wall = wallDirAt(w, outer);
        // straight in, square to the wall, first; the courtyard's nearest point
        const ahead = wall ? rayToRing(w, [-wall[1], wall[0]], hole) ?? rayToRing(w, [wall[1], -wall[0]], hole) : null;
        const targets = [ahead ?? nearestOnRing(w, hole).slice(0, 2), ...inner];
        targets.forEach((c, k) => {
          const L = Math.hypot(c[0] - w[0], c[1] - w[1]);
          if (L > ARCH_MAX_DEPTH_M || L < 0.5) return;
          // a courtyard path's end only if little further than the shortest way
          const score = k === 0 ? L : L * 0.8 + 2;
          // the line straight through the wing: past the outer wall once, the courtyard's once
          const d = [(c[0] - w[0]) / L, (c[1] - w[1]) / L];
          if (k > 0 && wall && Math.abs(d[0] * wall[0] + d[1] * wall[1]) > ARCH_SKEW_SIN) return;
          const p = [w[0] - d[0] * ARCH_PAST_M, w[1] - d[1] * ARCH_PAST_M];
          const q = [c[0] + d[0] * ARCH_PAST_M, c[1] + d[1] * ARCH_PAST_M];
          if (crossingsOf(p, q, outer) !== 1 || crossingsOf(p, q, hole) !== 1) return;
          if (f.holes.length > 1 && crossingsOf(p, q, outer) + crossingsOf(p, q, hole) !== 2) return;
          if (!pick || score < pick.score) pick = { score, line: [p, q] };
        });
      }
      if (pick) out.push({ line: pick.line, half: ARCH_HALF_M, courtyard: true });
    }
  }
  return out;
}

// ── Flat-roofed blocks: parapet, coping, string course ────────────────────────

export const PARAPET = { h: 0.75, t: 0.25, cope: 0.07, coping: [0.86, 0.85, 0.82], course: 0.22, courseOut: 0.12 };

/** A parapet in the wall's material on the roof's edge, its inside plain, a pale coping over both faces. */
export function parapet(m, ring, zRoof, wallMat, wallTint, { h = PARAPET.h, t = PARAPET.t } = {}) {
  const n = ring.length;
  const inner = insetRing(ring, t);
  for (let i = 0; i < n; i++) {
    const a = ring[i]; const b = ring[(i + 1) % n];
    if (len2(v2(a, b)) < 0.05) continue;
    wallQuad(m, wallMat, a, b, zRoof, zRoof + h, wallTint);
    wallQuad(m, 'concrete', inner[i], inner[(i + 1) % n], zRoof, zRoof + h, PARAPET.coping, 3, false);
  }
  coping(m, ring, inner, zRoof + h);
}

function coping(m, ring, inner, z) {
  const n = ring.length;
  const out = insetRing(ring, -PARAPET.cope);
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    // the cap's top over the parapet, and its lip round the outside
    m.quad('concrete', [...out[i], z + 0.08], [...out[j], z + 0.08], [...inner[j], z + 0.08], [...inner[i], z + 0.08], [0, 0], [1, 0], [1, 0.1], [0, 0.1], PARAPET.coping);
    wallQuad(m, 'concrete', out[i], out[j], z - 0.04, z + 0.08, PARAPET.coping);
  }
}

/** A slim projecting band round the walls at z (the top floor's line). */
export function stringCourse(m, ring, z, mat, tint) {
  const out = insetRing(ring, -PARAPET.courseOut);
  const n = ring.length; const h = PARAPET.course;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    if (len2(v2(ring[i], ring[j])) < 0.3) continue;
    wallQuad(m, mat, out[i], out[j], z - h, z, tint, 1);
    m.quad(mat, [...ring[i], z], [...out[i], z], [...out[j], z], [...ring[j], z], [0, 0], [0, 0.1], [1, 0.1], [1, 0], tint);
    m.quad(mat, [...out[i], z - h], [...ring[i], z - h], [...ring[j], z - h], [...out[j], z - h], [0, 0], [0, 0.1], [1, 0.1], [1, 0], tint);
  }
}

/** The ring moved d metres inward (negative: outward), mitred, mitres capped at 3 d. */
export function insetRing(ring, d) {
  const n = ring.length;
  return ring.map((p, i) => {
    const a = ring[(i - 1 + n) % n]; const b = ring[(i + 1) % n];
    const e1 = v2(a, p); const e2 = v2(p, b);
    const l1 = len2(e1) || 1; const l2 = len2(e2) || 1;
    // inward normals (left of each edge for a counter-clockwise ring)
    const n1 = [-e1[1] / l1, e1[0] / l1]; const n2 = [-e2[1] / l2, e2[0] / l2];
    let bx = n1[0] + n2[0]; let by = n1[1] + n2[1];
    const bl = Math.hypot(bx, by) || 1; bx /= bl; by /= bl;
    const cos = bx * n2[0] + by * n2[1];
    const k = Math.min(3, 1 / Math.max(0.33, cos)) * d;
    return [p[0] + bx * k, p[1] + by * k];
  });
}

// ── Shopfronts ───────────────────────────────────────────────────────────────

// awning canvas (the white metal sheet tinted): deep red, forest green, navy, cream, charcoal, terracotta,
// teal, slate blue (a mustard read as wood planks over the sheet's seams)
export const AWNING_COLOURS = [[0.55, 0.1, 0.09], [0.13, 0.3, 0.18], [0.1, 0.15, 0.32], [0.93, 0.88, 0.76], [0.2, 0.2, 0.21], [0.72, 0.33, 0.2], [0.08, 0.36, 0.38], [0.26, 0.36, 0.5]];
const FASCIA_COLOURS = [[0.12, 0.12, 0.13], [0.18, 0.12, 0.08], [0.1, 0.16, 0.12], [0.85, 0.83, 0.78]];
const SHOP_BAY_M = [4.5, 9];
const AWNING_SHARE = 0.65;

/**
 * Shop by shop along the street wall a-b at the ground floor's top zTop: an awning or a fascia.
 * look: { awningShare, awnings, fascias, bay: [min, max] m, one: one colour along the wall } (a
 * restaurant's own awnings, a pub's painted fascia).
 */
export function shopfronts(m, a, b, zTop, rnd, look = {}) {
  const e = v2(a, b); const L = len2(e);
  if (L < 3) return 0;
  const d = [e[0] / L, e[1] / L]; const out = [d[1], -d[0]];
  const share = look.awningShare ?? AWNING_SHARE;
  const awnings = look.awnings || AWNING_COLOURS; const fascias = look.fascias || FASCIA_COLOURS;
  const bay = look.bay || SHOP_BAY_M;
  let s = 0.3; let k = 0; let n = 0;
  while (s < L - 1.5) {
    let w = bay[0] + (bay[1] - bay[0]) * rnd('w', k);
    if (L - 0.3 - (s + w) < 2.5) w = L - 0.3 - s;
    const p = [a[0] + d[0] * (s + 0.15), a[1] + d[1] * (s + 0.15)];
    const q = [a[0] + d[0] * (s + w - 0.15), a[1] + d[1] * (s + w - 0.15)];
    const kk = look.one ? 0 : k;
    if (rnd('awn', k) < share) awning(m, p, q, out, zTop - 0.35, awnings[Math.floor(rnd('ac', kk) * awnings.length)]);
    else {
      const c = [(p[0] + q[0]) / 2 + out[0] * 0.08, (p[1] + q[1]) / 2 + out[1] * 0.08];
      box(m, 'metalWhite', c, d, len2(v2(p, q)) / 2, 0.08, zTop - 1.05, zTop - 0.3, fascias[Math.floor(rnd('fc', kk) * fascias.length)]);
    }
    s += w; k++; n++;
  }
  return n;
}

// ── Hotels and pubs ──────────────────────────────────────────────────────────

// a hotel's entrance canopy: burgundy, navy, forest green, bronze, black
export const CANOPY_COLOURS = [[0.42, 0.08, 0.1], [0.08, 0.12, 0.26], [0.1, 0.24, 0.15], [0.42, 0.3, 0.16], [0.1, 0.1, 0.11]];
const BRASS = [0.72, 0.58, 0.3];
const HOTEL_DOOR_TINT = [0.92, 0.89, 0.82];
const CANOPY_OUT_M = 3.2;
const CANOPY_ROAD_CLEAR_M = 0.5;   // short of the street's edge
const CANOPY_MIN_M = 0.8;          // shallower: no canopy, the doors alone
const CANOPY_POSTS_M = 2.2;        // shallower: held from the wall, no posts

/**
 * A hotel's entrance on wall a-b (at its middle): glass doors under a flat canopy reaching
 * CANOPY_OUT_M out over the sidewalk on two brass posts, its deep edge in the hotel's colour.
 * Returns the canopy's middle front point (for a sign or flags), or null on a short wall.
 */
export function hotelCanopy(m, a, b, base, col, { room = Infinity } = {}) {
  const e = v2(a, b); const L = len2(e);
  if (L < 6) return null;
  const d = [e[0] / L, e[1] / L]; const out = [d[1], -d[0]];
  const half = Math.min(4.5, L * 0.3);
  const mid = [a[0] + d[0] * L / 2, a[1] + d[1] * L / 2];
  const at = (k) => [mid[0] + out[0] * k, mid[1] + out[1] * k];
  const zc = base + 3.3;
  // (no further out than the ground before the street, CANOPY_ROAD_CLEAR_M
  // short of it; its posts only on a deep one, else held from the wall)
  const depth = Math.min(CANOPY_OUT_M, room - CANOPY_ROAD_CLEAR_M);
  const built = depth >= CANOPY_MIN_M;
  if (built) {
    // the canopy slab and its deep fascia
    box(m, 'metalWhite', at(depth / 2), d, half, depth / 2, zc, zc + 0.18, col.map((c) => c * 0.8), { bottom: true });
    box(m, 'metalWhite', at(depth - 0.06), d, half + 0.05, 0.08, zc - 0.25, zc + 0.45, col);
    for (const sgn of [-1, 1]) {
      box(m, 'metalWhite', at(depth / 2).map((v, i) => v + d[i] * sgn * (half + 0.0)), out, depth / 2, 0.06, zc - 0.25, zc + 0.45, col);   // sides
      if (depth < CANOPY_POSTS_M) continue;
      const post = [mid[0] + out[0] * (depth - 0.25) + d[0] * sgn * (half - 0.25), mid[1] + out[1] * (depth - 0.25) + d[1] * sgn * (half - 0.25)];
      cylinder(m, 'metalWhite', post[0], post[1], 0.09, base - 0.2, zc, BRASS, { n: 10 });
    }
  }
  // the entrance: the sheet's shopfront glass doors, warm white
  const dw = 2 * Math.min(1.8, half - 0.5) + 0.24;
  doorQuad(m, mid, d, out, base, dw, Math.min(2.9, dw / 1.46), DOOR_UV.shopfront, HOTEL_DOOR_TINT);
  return built ? { front: at(depth), mid, d, out, half, zTop: zc + 0.45 } : null;
}

// a pub's sign board: oxblood, bottle green, black, navy, cream
export const PUB_SIGN_COLOURS = [[0.38, 0.08, 0.07], [0.08, 0.22, 0.12], [0.08, 0.08, 0.09], [0.08, 0.12, 0.24], [0.88, 0.84, 0.72]];
// a pub's painted front: the same, darker
export const PUB_FASCIAS = [[0.3, 0.06, 0.05], [0.06, 0.17, 0.09], [0.06, 0.06, 0.07], [0.06, 0.09, 0.19]];

/** A pub's sign hanging from an iron bracket at wall point c (out: away from the wall), its top at z. */
export function hangingSign(m, c, along, out, z, col) {
  const iron = [0.08, 0.08, 0.08];
  box(m, 'metalWhite', [c[0] + out[0] * 0.55, c[1] + out[1] * 0.55], out, 0.6, 0.03, z - 0.05, z + 0.03, iron);   // the arm
  box(m, 'metalWhite', [c[0] + out[0] * 0.04, c[1] + out[1] * 0.04], along, 0.08, 0.04, z - 0.35, z + 0.1, iron);   // its wall plate
  // the board, across the arm, in a gold frame
  const bc = [c[0] + out[0] * 0.7, c[1] + out[1] * 0.7];
  box(m, 'metalWhite', bc, out, 0.42, 0.035, z - 1.05, z - 0.12, BRASS);
  box(m, 'metalWhite', bc, out, 0.37, 0.045, z - 1.0, z - 0.17, col);
}

const AWNING_OUT_M = 1.3;
const AWNING_DROP_M = 0.55;
const VALANCE_M = 0.22;

/** A sloped canvas from the wall (p..q at z) out and down, with a valance hanging from its front edge. */
function awning(m, p, q, out, z, col) {
  const o = (pt, k, dz) => [pt[0] + out[0] * k, pt[1] + out[1] * k, z + dz];
  const p0 = o(p, 0, 0); const q0 = o(q, 0, 0);
  const p1 = o(p, AWNING_OUT_M, -AWNING_DROP_M); const q1 = o(q, AWNING_OUT_M, -AWNING_DROP_M);
  m.quad('metalWhite', p1, q1, q0, p0, [0, 1], [1, 1], [1, 0], [0, 0], col);           // top
  m.quad('metalWhite', p0, q0, q1, p1, [0, 0], [1, 0], [1, 1], [0, 1], col.map((c) => c * 0.7));   // underside
  const pv = [p1[0], p1[1], p1[2] - VALANCE_M]; const qv = [q1[0], q1[1], q1[2] - VALANCE_M];
  m.quad('metalWhite', pv, qv, q1, p1, [0, 0], [1, 0], [1, 1], [0, 1], col);          // valance front
  m.quad('metalWhite', qv, pv, p1, q1, [0, 0], [1, 0], [1, 1], [0, 1], col.map((c) => c * 0.7));
  // the cheeks at each end
  for (const [e0, e1, flip] of [[p0, p1, true], [q0, q1, false]]) {
    const t = [e1[0], e1[1], e1[2] - VALANCE_M];
    if (flip) m.tri('metalWhite', e0, t, e1, [0, 0], [1, 1], [1, 0], col); else m.tri('metalWhite', e0, e1, t, [0, 0], [1, 0], [1, 1], col);
  }
}

// ── Houses: entrance, steps, chimney ──────────────────────────────────────────

const TRIM_WHITE = [0.94, 0.93, 0.9];
// front doors: black, dark green, red, navy, off-white (a hood or a veranda with no door under it read as
// a shelf on a blank wall)
const DOOR_COLOURS = [[0.07, 0.07, 0.08], [0.09, 0.2, 0.13], [0.5, 0.09, 0.08], [0.09, 0.12, 0.25], [0.88, 0.87, 0.82]];
const DOOR_W = 1.05;
const DOOR_H = 2.45;     // (the sheet's door with its frame and top rail)

// The game's own doors: where each sits on East Coast USA's door and window
// sheet ('doors' material; [u0, v0, u1, v1], v up), its frame included.
export const DOOR_UV = {
  glazed: [0.503, 0.507, 0.654, 0.888],
  halfGlass: [0.659, 0.507, 0.825, 0.888],
  panel: [0.830, 0.507, 0.996, 0.888],
  steel: [0.503, 0.009, 0.737, 0.497],
  shopfront: [0.005, 0.009, 0.498, 0.346],    // two glass doors and a glass panel between
};
const HOUSE_DOORS = ['glazed', 'halfGlass', 'panel'];
const DOOR_OUT_M = 0.05;      // proud of the wall

/** A door from the sheet on the wall at c (plan), w wide and h tall from z0, facing out. */
export function doorQuad(m, c, along, out, z0, w, h, uv, col, mat = 'doors') {
  const k = DOOR_OUT_M;
  const a = [c[0] - along[0] * w / 2 + out[0] * k, c[1] - along[1] * w / 2 + out[1] * k];
  const b = [c[0] + along[0] * w / 2 + out[0] * k, c[1] + along[1] * w / 2 + out[1] * k];
  const [u0, v0, u1, v1] = uv;
  m.quad(mat, [a[0], a[1], z0], [b[0], b[1], z0], [b[0], b[1], z0 + h], [a[0], a[1], z0 + h], [u0, v0], [u1, v0], [u1, v1], [u0, v1], col);
}

/** A front door on the wall at c (plan point on the wall), facing out: one of the sheet's wooden doors, in its colour. */
function frontDoor(m, c, along, out, base, col, style = 'panel') {
  doorQuad(m, c, along, out, base, DOOR_W, DOOR_H, DOOR_UV[style] || DOOR_UV.panel, col);
}

/**
 * The entrance on wall a-b (its middle third): 'veranda' (posts and a shed roof in the house's roofing),
 * 'hood' (a small gabled canopy on brackets), with steps from the street's ground gDoor up to the floor
 * at base. Returns what was built.
 */
export function entrance(m, a, b, base, gDoor, style, roofMat, roofTint, rnd, { room = Infinity, props = null } = {}) {
  const e = v2(a, b); const L = len2(e);
  if (L < 3.5) return null;
  // (the ground in front before the street, ENTRANCE_ROAD_CLEAR_M short of
  // it: a veranda only if it and its steps fit, else a hood; steps only if
  // they fit: verandas stood out in the road where a house is close to it)
  const free = room - ENTRANCE_ROAD_CLEAR_M;
  const stepsOut = (r) => Math.max(1, Math.min(10, Math.round(r / STEP_RISE))) * STEP_TREAD;
  const d = [e[0] / L, e[1] / L]; const out = [d[1], -d[0]];
  const at = (t, k, z) => [a[0] + d[0] * t + out[0] * k, a[1] + d[1] * t + out[1] * k, z];
  // (the wall's middle: where the house's laid-over windows leave the door's
  // bay free, beamngBuildings.js houseWindows)
  const mid = L / 2;
  const rise = Math.max(0, base - gDoor);
  const doorAt = at(mid, 0, 0);
  frontDoor(m, [doorAt[0], doorAt[1]], d, out, base, DOOR_COLOURS[Math.floor(rnd('doorCol') * DOOR_COLOURS.length)], HOUSE_DOORS[Math.floor(rnd('doorStyle') * HOUSE_DOORS.length)]);
  if (style === 'veranda' && free < 2.1 + (rise > 0.2 ? stepsOut(rise) : 0)) style = 'hood';
  const stepsFit = (from) => rise > 0.2 && free >= from + stepsOut(rise);
  if (style === 'veranda' && L >= 6) {
    const w = Math.min(L - 1, Math.max(4.5, L * 0.6));
    const t0 = Math.max(0.5, Math.min(L - 0.5 - w, mid - w / 2));
    const depth = 2.1; const top = base + 2.6;
    // deck
    box(m, 'panel', [at(t0 + w / 2, depth / 2, 0)[0], at(t0 + w / 2, depth / 2, 0)[1]], d, w / 2, depth / 2, Math.min(gDoor, base) - 0.3, base, [0.62, 0.6, 0.57]);
    // posts
    for (const t of [t0 + 0.15, t0 + w / 3, t0 + (2 * w) / 3, t0 + w - 0.15]) {
      const c = at(t, depth - 0.15, 0);
      box(m, 'metalWhite', [c[0], c[1]], d, 0.08, 0.08, base, top, TRIM_WHITE);
    }
    // a shed roof falling from the wall, in the house's roofing
    const p0 = at(t0 - 0.2, 0, top + 0.45); const q0 = at(t0 + w + 0.2, 0, top + 0.45);
    const p1 = at(t0 - 0.2, depth + 0.3, top); const q1 = at(t0 + w + 0.2, depth + 0.3, top);
    m.quad(roofMat, p1, q1, q0, p0, [0, 0], [w / 3, 0], [w / 3, 1], [0, 1], roofTint);
    m.quad('metalWhite', p0, q0, q1, p1, [0, 0], [1, 0], [1, 1], [0, 1], TRIM_WHITE);
    wallQuad(m, 'metalWhite', [p1[0], p1[1]], [q1[0], q1[1]], top - 0.18, top, TRIM_WHITE, 1);
    if (stepsFit(depth + 0.1)) steps(m, at(mid, depth + 0.1, 0), d, out, gDoor, base, 1.6, props);
    return 'veranda';
  }
  if (style === 'hood') {
    const w = 1.7; const top = base + 2.6; const depth = 0.85; const ridge = 0.45;   // (over the 2.45 m door)
    const c = at(mid, 0, 0);
    const P = (t, k, z) => [c[0] + d[0] * t + out[0] * k, c[1] + d[1] * t + out[1] * k, z];
    // two slopes meeting over the door, and their gable
    m.quad(roofMat, P(-w / 2, depth, top), P(0, depth, top + ridge), P(0, 0, top + ridge), P(-w / 2, 0, top), [0, 0], [1, 0], [1, 1], [0, 1], roofTint);
    m.quad(roofMat, P(0, depth, top + ridge), P(w / 2, depth, top), P(w / 2, 0, top), P(0, 0, top + ridge), [0, 0], [1, 0], [1, 1], [0, 1], roofTint);
    m.tri('metalWhite', P(-w / 2, depth, top), P(w / 2, depth, top), P(0, depth, top + ridge), [0, 0], [1, 0], [0.5, 1], TRIM_WHITE);
    m.quad('metalWhite', P(-w / 2, 0, top), P(w / 2, 0, top), P(w / 2, depth, top), P(-w / 2, depth, top), [0, 0], [1, 0], [1, 1], [0, 1], TRIM_WHITE);
    // brackets
    for (const s of [-1, 1]) {
      const bc = P((s * w) / 2 - s * 0.12, depth / 2, 0);
      box(m, 'metalWhite', [bc[0], bc[1]], out, depth / 2, 0.05, top - 0.35, top, TRIM_WHITE);
    }
    if (stepsFit(0.05)) steps(m, P(0, 0.05, 0), d, out, gDoor, base, 1.3, props);
    return 'hood';
  }
  if (stepsFit(0.05)) { steps(m, at(mid, 0.05, 0), d, out, gDoor, base, 1.4, props); return 'steps'; }
  return null;
}

// A garage's roll-up doors (Italy's shutter): on the wall facing the
// street (else its longest), one per GARAGE_BAY_M of it, a lone garage two
// at most.
const GARAGE_BAY_M = 3.2;
const GARAGE_DOOR_W = 2.5;
const GARAGE_DOOR_H = 2.2;
const SHUTTER_TILE_M = 2.5;
export function garageDoors(m, a, b, base, { row = false } = {}) {
  const e = v2(a, b); const L = len2(e);
  if (L < GARAGE_DOOR_W + 0.4) return 0;
  const d = [e[0] / L, e[1] / L]; const out = [d[1], -d[0]];
  const n = Math.max(1, Math.min(row ? 40 : 2, Math.floor(L / GARAGE_BAY_M)));
  const step = L / n;
  for (let i = 0; i < n; i++) {
    const c = [a[0] + d[0] * step * (i + 0.5), a[1] + d[1] * step * (i + 0.5)];
    doorQuad(m, c, d, out, base, GARAGE_DOOR_W, GARAGE_DOOR_H, [0, 0, GARAGE_DOOR_W / SHUTTER_TILE_M, GARAGE_DOOR_H / SHUTTER_TILE_M], [0.82, 0.82, 0.8], 'rollupDoor');
  }
  return n;
}

const STEP_RISE = 0.18;
const STEP_TREAD = 0.3;
const ENTRANCE_ROAD_CLEAR_M = 0.4;

// the game's own flight of steps (/assets R_HS_A_ST_01: four steps, 1.3 m
// wide, 0.69 m down over 1.27 m along its local -x from the top edge at its
// origin): for a rise it fits, scaled to it (treads in proportion), in
// place of the drawn blocks; one or two steps, or a tall flight, stay drawn
const NATIVE_STEPS = { shape: 'frontSteps', rise: 0.69, width: 1.3 };
const NATIVE_STEPS_RISE = [0.55, 1.0];   // (steps 14 to 25 cm high)

/**
 * Concrete steps from the ground g up to the floor at `top`, out from the
 * wall at p (front edge). props: the game's own flight is placed there when
 * the rise suits it. Returns the number of steps.
 */
export function steps(m, p, along, out, g, top, width, props = null) {
  const rise = top - g;
  if (rise < 0.15) return 0;
  if (props && rise >= NATIVE_STEPS_RISE[0] && rise <= NATIVE_STEPS_RISE[1]) {
    const k = rise / NATIVE_STEPS.rise;
    props.push({ shape: NATIVE_STEPS.shape, x: p[0], y: p[1], z: top, yaw: Math.atan2(-out[1], -out[0]), scale: [k, width / NATIVE_STEPS.width, k] });
    return 4;
  }
  const n = Math.max(1, Math.min(10, Math.round(rise / STEP_RISE)));
  const h = rise / n;
  for (let k = 0; k < n; k++) {
    // step k: its top at top - k h, reaching (k + 1) treads out (each block down to the ground)
    const depth = (k + 1) * STEP_TREAD;
    const c = [p[0] + out[0] * depth / 2, p[1] + out[1] * depth / 2];
    box(m, 'concrete', c, along, width / 2, depth / 2, g - 0.3, top - k * h, [0.78, 0.77, 0.74]);
  }
  return n;
}

/** A chimney through a pitched roof, near the ridge at one end: brick or the wall's render, with a cap. */
export function chimney(m, boxInfo, eave, rise, wallMat, wallTint, rnd) {
  const { cx, cy, ux, uy, length } = boxInfo;
  const end = rnd('chimEnd') < 0.5 ? -1 : 1;
  const along = end * length * (0.3 + 0.12 * rnd('chimAt'));
  const side = (rnd('chimSide') - 0.5) * 0.6;
  const c = [cx + ux * along - uy * side, cy + uy * along + ux * side];
  const top = eave + rise + 0.9 + 0.4 * rnd('chimH');
  const brick = wallMat === 'brick' || rnd('chimBrick') < 0.55;
  const mat = brick ? 'brick' : wallMat; const tint = brick ? [0.9, 0.82, 0.78] : wallTint;
  box(m, mat, c, [ux, uy], 0.35, 0.3, eave, top, tint);
  box(m, 'concrete', c, [ux, uy], 0.42, 0.37, top, top + 0.1, [0.6, 0.6, 0.6]);
}

// ── Flat roofs: plant, bulkhead, water tanks ─────────────────────────────────

const PLANT_GREY = [0.66, 0.67, 0.68];

/** Roof plant on a flat roof of `area` m2 inside ring (box: its oriented box), clear of the edge. */
export function roofPlant(m, ring, boxInfo, z, area, wallMat, wallTint, { tanks = false, onTank = null } = {}, rnd) {
  const { cx, cy, ux, uy, length, width } = boxInfo;
  const hl = length / 2 - 2; const hw = width / 2 - 2;
  if (hl < 1.5 || hw < 1.5) return 0;
  const u = [ux, uy]; const v = [-uy, ux];
  const at = (s, t) => [cx + u[0] * s + v[0] * t, cy + u[1] * s + v[1] * t];
  let built = 0;
  // a stair bulkhead in the wall's material
  const bh = at((rnd('bhS') * 2 - 1) * hl * 0.6, (rnd('bhT') * 2 - 1) * hw * 0.6);
  if (inRing(bh, ring)) { box(m, wallMat, bh, u, 1.4, 1.1, z, z + 2.6, wallTint, { uvM: 3 }); box(m, 'concrete', bh, u, 1.5, 1.2, z + 2.6, z + 2.72, PARAPET.coping); built++; }
  const units = Math.min(6, 1 + Math.floor(area / 500));
  for (let k = 0; k < units; k++) {
    const c = at((rnd('pu', k) * 2 - 1) * hl, (rnd('pv', k) * 2 - 1) * hw);
    if (!inRing(c, ring)) continue;
    const big = rnd('pb', k) < 0.3;
    box(m, 'metalWhite', c, u, big ? 1.6 : 0.9, big ? 1.1 : 0.6, z, z + (big ? 1.5 : 0.9), PLANT_GREY);
    built++;
  }
  if (tanks) {
    const c = at((rnd('tkS') * 2 - 1) * hl * 0.5, (rnd('tkT') * 2 - 1) * hw * 0.5);
    // (the game's own tank where one is given: onTank(c, z, yaw))
    if (inRing(c, ring)) { if (onTank) onTank(c, z, Math.atan2(boxInfo.uy, boxInfo.ux)); else waterTank(m, c, z); built++; }
  }
  return built;
}

/** A timber water tank on a steel frame (US mid-rise roofs): legs, a staved drum and a conical lid. */
function waterTank(m, c, z) {
  const r = 2.1; const legs = 3.6; const drum = 4.2;
  for (const [sx, sy] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) box(m, 'metalWhite', [c[0] + sx * 1.4, c[1] + sy * 1.4], [1, 0], 0.12, 0.12, z, z + legs, [0.25, 0.25, 0.26]);
  cylinder(m, 'siding', c[0], c[1], r, z + legs, z + legs + drum, [0.62, 0.5, 0.4], { n: 14, uvM: 2, top: false });
  cone(m, 'roofMetal', c[0], c[1], r + 0.15, z + legs + drum, z + legs + drum + 1.3, [0.35, 0.35, 0.36], { n: 14 });
}

// ── Places of worship ────────────────────────────────────────────────────────

/**
 * A bell tower with a dark belfry band and a spire at one end of the nave: on the footprint's corner nearest
 * that end (set in by half the tower, inside the walls: on an irregular church the box's end was a thin
 * arm's tip). Returns the tower's top.
 */
export function churchTower(m, boxInfo, eave, rise, wallMat, wallTint, roofMat, roofTint, rnd, ring = null, { atBoxEnd = false } = {}) {
  const { cx, cy, ux, uy, length, width } = boxInfo;
  const end = rnd('tower') < 0.5 ? -1 : 1;
  const side = Math.max(3.5, Math.min(atBoxEnd ? 5 : 6, width * (atBoxEnd ? 0.4 : 0.45)));
  let c = [cx + ux * end * (length / 2 - side / 2), cy + uy * end * (length / 2 - side / 2)];
  // (a nave's own end: the tower stands against its gable, inside the walls)
  if (ring && !(atBoxEnd && inRing(c, ring))) {
    let best = -Infinity; let pick = null;
    for (const p of insetRing(ring, side / 2 + 0.3)) {
      if (!inRing(p, ring)) continue;
      const score = ((p[0] - cx) * ux + (p[1] - cy) * uy) * end;
      if (score > best) { best = score; pick = p; }
    }
    if (pick) c = pick;
  }
  const shaftTop = eave + rise + Math.max(6, side * 1.6);
  box(m, wallMat, c, [ux, uy], side / 2, side / 2, eave - 0.5, shaftTop, wallTint, { uvM: 3 });
  // the belfry: a darker band near the top, and a slim cornice
  box(m, wallMat, c, [ux, uy], side / 2 + 0.02, side / 2 + 0.02, shaftTop - 2.4, shaftTop - 0.6, wallTint.map((v) => v * 0.45), { uvM: 3 });
  box(m, 'concrete', c, [ux, uy], side / 2 + 0.18, side / 2 + 0.18, shaftTop, shaftTop + 0.3, PARAPET.coping);
  // a four-sided spire, about as tall as the shaft over the roof (not a needle)
  const s = side / 2 + 0.05; const top = shaftTop + 0.3 + side * 1.7;
  const v = [-uy, ux];
  const k = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([a, b]) => [c[0] + ux * a * s + v[0] * b * s, c[1] + uy * a * s + v[1] * b * s, shaftTop + 0.3]);
  for (let i = 0; i < 4; i++) m.tri(roofMat, k[i], k[(i + 1) % 4], [c[0], c[1], top], [0, 0], [1, 0], [0.5, 2], roofTint);
  return top;
}

// domes: pale stone (most), verdigris, gold, blue
const DOME_COLOURS = [[0.86, 0.86, 0.84], [0.86, 0.86, 0.84], [0.45, 0.62, 0.55], [0.8, 0.66, 0.34], [0.36, 0.5, 0.7]];

/** A dome over the prayer hall's middle and a minaret at a corner of the footprint (inside it). */
export function mosque(m, ring, boxInfo, eave, wallMat, wallTint, rnd) {
  const { cx, cy, ux, uy, length, width } = boxInfo;
  const r = Math.max(2.5, Math.min(width, length) * 0.32);
  cylinder(m, wallMat, cx, cy, r * 0.92, eave, eave + 0.9, wallTint, { n: 20, top: false });
  dome(m, 'metalWhite', cx, cy, r, eave + 0.9, DOME_COLOURS[Math.floor(rnd('domeCol') * DOME_COLOURS.length)], { n: 20, rings: 6, rise: 1.05 });
  // the footprint's corner (1.6 m in) furthest out toward a hashed corner of its box
  const sx = rnd('minaret') < 0.5 ? 1 : -1; const sy = rnd('minaretSide') < 0.5 ? 1 : -1;
  const want = [ux * sx * length - uy * sy * width, uy * sx * length + ux * sy * width];
  let mc = null; let best = -Infinity;
  for (const p of insetRing(ring, 1.6)) {
    const score = (p[0] - cx) * want[0] + (p[1] - cy) * want[1];
    if (score > best && inRing(p, ring)) { best = score; mc = p; }
  }
  if (!mc || Math.hypot(mc[0] - cx, mc[1] - cy) < r + 1.5) return;
  const h = eave + Math.max(14, length * 0.9);
  cylinder(m, wallMat, mc[0], mc[1], 1.1, eave - 0.5, h, wallTint, { n: 12, top: false });
  cylinder(m, 'concrete', mc[0], mc[1], 1.45, h - 2.6, h - 2.3, PARAPET.coping, { n: 12 });
  cone(m, 'roofMetal', mc[0], mc[1], 1.15, h, h + 3.2, [0.3, 0.42, 0.36], { n: 12 });
}

// ── Silos and tanks ──────────────────────────────────────────────────────────

/** A silo or tank as a cylinder on its footprint's circle: a cone (silo) or a shallow dome (tank) on top. */
export function silo(m, ring, z0, h, kind, tint) {
  let cx = 0; let cy = 0;
  for (const [x, y] of ring) { cx += x; cy += y; }
  cx /= ring.length; cy /= ring.length;
  let r = 0;
  for (const [x, y] of ring) r += Math.hypot(x - cx, y - cy);
  r /= ring.length;
  const mat = kind === 'tank' ? 'metalWhite' : 'concrete';
  cylinder(m, mat, cx, cy, r, z0, z0 + h, tint, { n: 20, top: false });
  if (kind === 'tank') dome(m, mat, cx, cy, r, z0 + h, tint, { n: 20, rings: 4, rise: 0.18 });
  else cone(m, 'roofMetal', cx, cy, r + 0.1, z0 + h, z0 + h + r * 0.45, [0.62, 0.63, 0.65], { n: 20 });
  return r;
}

export function inRing(p, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]; const [xj, yj] = ring[j];
    if ((yi > p[1]) !== (yj > p[1]) && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

// ── Passages through buildings ───────────────────────────────────────────────

/**
 * Where passage roads cross wall a-b: [[t0, t1]...] fractions of the wall left open (the road's width +
 * 0.5 m), merged and sorted.
 */
export function passageOpenings(a, b, passages) {
  const e = v2(a, b); const L = len2(e);
  if (L < 0.5 || !passages?.length) return [];
  const out = [];
  for (const { line, half } of passages) {
    for (let i = 0; i + 1 < line.length; i++) {
      const p = line[i]; const q = line[i + 1]; const s = v2(p, q);
      const den = e[0] * s[1] - e[1] * s[0];
      if (Math.abs(den) < 1e-9) continue;
      const t = ((p[0] - a[0]) * s[1] - (p[1] - a[1]) * s[0]) / den;     // along the wall
      const u = ((p[0] - a[0]) * e[1] - (p[1] - a[1]) * e[0]) / den;     // along the road
      if (t < 0 || t > 1 || u < 0 || u > 1) continue;
      // the opening's half width along the wall (wider where the road crosses at a slant)
      const sin = Math.abs(den) / (L * len2(s));
      const hw = (half + 0.25) / Math.max(0.3, sin) / L;
      out.push([Math.max(0, t - hw), Math.min(1, t + hw)]);
    }
  }
  out.sort((x, y) => x[0] - y[0]);
  const merged = [];
  for (const o of out) {
    const last = merged[merged.length - 1];
    if (last && o[0] <= last[1]) last[1] = Math.max(last[1], o[1]); else merged.push([...o]);
  }
  return merged;
}

/** The passage's inside: its two side walls and ceiling along the road from one opening to the next. */
export function passageInside(m, p, q, half, zFloor, zTop, mat, tint) {
  const e = v2(p, q); const L = len2(e);
  if (L < 0.3) return;
  const d = [e[0] / L, e[1] / L]; const n = [-d[1], d[0]];
  const side = (s) => [[p[0] + n[0] * s * half, p[1] + n[1] * s * half], [q[0] + n[0] * s * half, q[1] + n[1] * s * half]];
  const [l0, l1] = side(1); const [r0, r1] = side(-1);
  wallQuad(m, mat, l0, l1, zFloor - 0.3, zTop, tint, 3, true);     // facing into the passage
  wallQuad(m, mat, r1, r0, zFloor - 0.3, zTop, tint, 3, true);
  m.quad(mat, [...l0, zTop], [...l1, zTop], [...r1, zTop], [...r0, zTop], [0, 0], [L / 3, 0], [L / 3, 1], [0, 1], tint.map((c) => c * 0.8));
}

/** Each passage road's stretch through the footprint: [{ p, q, half }] between its crossings of the ring. */
export function passageCrossings(ring, passages, holes = []) {
  const out = [];
  const rings = [ring, ...holes];
  for (const { line, half } of passages || []) {
    const hits = [];
    let s0 = 0;
    for (let i = 0; i + 1 < line.length; i++) {
      const p = line[i]; const q = line[i + 1]; const s = v2(p, q); const sl = len2(s);
      for (const r of rings) for (let j = 0; j < r.length; j++) {
        const a = r[j]; const b = r[(j + 1) % r.length]; const e = v2(a, b);
        const den = e[0] * s[1] - e[1] * s[0];
        if (Math.abs(den) < 1e-9) continue;
        const t = ((p[0] - a[0]) * s[1] - (p[1] - a[1]) * s[0]) / den;
        const u = ((p[0] - a[0]) * e[1] - (p[1] - a[1]) * e[0]) / den;
        if (t < 0 || t > 1 || u < 0 || u > 1) continue;
        hits.push({ at: s0 + u * sl, pt: [p[0] + s[0] * u, p[1] + s[1] * u] });
      }
      s0 += sl;
    }
    hits.sort((x, y) => x.at - y.at);
    for (let k = 0; k + 1 < hits.length; k += 2) out.push({ p: hits[k].pt, q: hits[k + 1].pt, half });
  }
  return out;
}

/**
 * A church's nave on an irregular footprint: the largest rectangle along its box's long axis that the
 * footprint holds (at each metre along the axis, the footprint's span across it through the middle line;
 * the longest run's common span, by area). As orientedBox: { cx, cy, ux, uy, length, width, area }, or
 * null when nothing of a nave's size (8 x 5 m) fits.
 */
export function naveRect(ring, boxInfo) {
  const { cx, cy, ux, uy, length } = boxInfo;
  const vx = -uy; const vy = ux;
  // the footprint in the box's frame (s along, t across)
  const loc = ring.map(([x, y]) => [(x - cx) * ux + (y - cy) * uy, (x - cx) * vx + (y - cy) * vy]);
  const n = Math.max(2, Math.floor(length));
  const spans = [];
  for (let k = 0; k <= n; k++) {
    const s = -length / 2 + (k / n) * length;
    const ts = [];
    for (let i = 0; i < loc.length; i++) {
      const a = loc[i]; const b = loc[(i + 1) % loc.length];
      if ((a[0] > s) === (b[0] > s)) continue;
      ts.push(a[1] + ((s - a[0]) / (b[0] - a[0])) * (b[1] - a[1]));
    }
    ts.sort((p, q) => p - q);
    let span = null;
    for (let i = 0; i + 1 < ts.length; i += 2) if (ts[i] <= 0 && ts[i + 1] >= 0) span = [ts[i], ts[i + 1]];
    spans.push({ s, span });
  }
  let best = null;
  for (let i = 0; i < spans.length; i++) {
    let lo = -Infinity; let hi = Infinity;
    for (let j = i; j < spans.length; j++) {
      if (!spans[j].span) break;
      lo = Math.max(lo, spans[j].span[0]); hi = Math.min(hi, spans[j].span[1]);
      const w = hi - lo; const L = spans[j].s - spans[i].s;
      if (w < 5) break;
      if (L >= 8 && (!best || L * w > best.L * best.w)) best = { s0: spans[i].s, s1: spans[j].s, lo, hi, L, w };
    }
  }
  if (!best) return null;
  const sm = (best.s0 + best.s1) / 2; const tm = (best.lo + best.hi) / 2;
  return { cx: cx + ux * sm + vx * tm, cy: cy + uy * sm + vy * tm, ux, uy, length: best.L, width: best.w, area: best.L * best.w };
}

// ── Castles and forts ────────────────────────────────────────────────────────

const GATE_WOOD = [0.4, 0.27, 0.17];
// a castle's crenellations (tall merlons, narrow gaps) and a fort's parapet
// (long stretches of wall, narrow embrasures for its guns)
export const BATTLEMENTS = {
  castle: { base: 0.9, merlon: 1.0, w: 1.5, gap: 0.8, t: 0.7 },
  fortress: { base: 0.6, merlon: 0.9, w: 5.5, gap: 1.0, t: 1.2 },
};

/**
 * Battlements on the wall top at zRoof: a parapet `base` high in the wall's
 * stone, then merlons `merlon` high with gaps between them along each edge
 * (each edge laid out from its middle, so its corners stand solid). Returns
 * the merlons built.
 */
export function battlements(m, ring, zRoof, wallMat, wallTint, { base, merlon, w, gap, t }) {
  const n = ring.length;
  const inner = insetRing(ring, t);
  const top = zRoof + base;
  let count = 0;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const a = ring[i]; const b = ring[j];
    const L = len2(v2(a, b));
    if (L < 0.05) continue;
    wallQuad(m, wallMat, a, b, zRoof, top, wallTint);
    wallQuad(m, wallMat, inner[i], inner[j], zRoof, top, wallTint, 3, false);
    m.quad(wallMat, [...a, top], [...b, top], [...inner[j], top], [...inner[i], top], [0, 0], [L / 3, 0], [L / 3, t / 3], [0, t / 3], wallTint);
    // merlons: whole ones, centred on the edge, a solid one at each end
    const d = [(b[0] - a[0]) / L, (b[1] - a[1]) / L]; const inw = [-d[1], d[0]];
    const k = Math.max(1, Math.floor((L + gap) / (w + gap)));
    const span = k * w + (k - 1) * gap;
    const ww = k === 1 ? Math.min(w, L) : w + (L - span) / k;   // stretched to fill the edge end to end
    for (let q = 0; q < k; q++) {
      const t0 = q * (ww + gap);
      const mid = t0 + ww / 2;
      if (mid > L) break;
      const c = [a[0] + d[0] * mid + inw[0] * (t / 2), a[1] + d[1] * mid + inw[1] * (t / 2)];
      box(m, wallMat, c, d, ww / 2, t / 2, top, top + merlon, wallTint, { uvM: 3 });
      count++;
    }
  }
  return count;
}

/** The salient corners of a ring (counter-clockwise): convex, sharper than maxAngle degrees inside. */
export function salientCorners(ring, maxAngle) {
  const n = ring.length; const out = [];
  for (let i = 0; i < n; i++) {
    const p = ring[i]; const a = ring[(i - 1 + n) % n]; const b = ring[(i + 1) % n];
    const e1 = v2(a, p); const e2 = v2(p, b);
    const l1 = len2(e1); const l2 = len2(e2);
    if (l1 < 1.5 || l2 < 1.5) continue;
    const cross = e1[0] * e2[1] - e1[1] * e2[0];
    if (cross <= 0) continue;   // a re-entrant corner
    const inside = 180 - (Math.acos(Math.max(-1, Math.min(1, (e1[0] * e2[0] + e1[1] * e2[1]) / (l1 * l2)))) * 180) / Math.PI;
    if (inside > maxAngle) continue;
    // the outward bisector
    const o = [e1[0] / l1 - e2[0] / l2, e1[1] / l1 - e2[1] / l2]; const ol = len2(o) || 1;
    out.push({ i, p, out: [o[0] / ol, o[1] / ol], inside, arms: Math.min(l1, l2) });
  }
  return out;
}

/**
 * A castle's corners: the salient corners of its outline's convex hull,
 * simplified to tol metres (a corner tower mapped into the outline is a
 * cluster of short edges; its hull's corner is where the tower stands).
 */
export function castleCorners(ring, maxAngle, tol) {
  return salientCorners(simplifyRing(convexHull(ring), tol), maxAngle);
}

/**
 * A tower already drawn into a castle's outline at a hull corner: the ring's
 * points within reach of it, when they curve round (five or more) — their
 * centre and mean radius — or null.
 */
export function mappedTower(ring, corner, reach) {
  const near = ring.filter((q) => len2(v2(q, corner.p)) <= reach);
  if (near.length < 5) return null;
  // (the arc's centre: the circle through its ends and middle point)
  const [a, b, c] = [near[0], near[Math.floor(near.length / 2)], near.at(-1)];
  const d = 2 * (a[0] * (b[1] - c[1]) + b[0] * (c[1] - a[1]) + c[0] * (a[1] - b[1]));
  if (Math.abs(d) < 1e-6) return null;
  const s2 = (q) => q[0] * q[0] + q[1] * q[1];
  const centre = [(s2(a) * (b[1] - c[1]) + s2(b) * (c[1] - a[1]) + s2(c) * (a[1] - b[1])) / d, (s2(a) * (c[0] - b[0]) + s2(b) * (a[0] - c[0]) + s2(c) * (b[0] - a[0])) / d];
  const r = near.reduce((t, q) => t + len2(v2(q, centre)), 0) / near.length;
  return Number.isFinite(r) && r < reach ? { centre, r } : null;
}

/** The convex hull of plan points, counter-clockwise. */
export function convexHull(pts) {
  const p = pts.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower = []; const upper = [];
  for (const q of p) { while (lower.length >= 2 && cross(lower.at(-2), lower.at(-1), q) <= 0) lower.pop(); lower.push(q); }
  for (const q of p.slice().reverse()) { while (upper.length >= 2 && cross(upper.at(-2), upper.at(-1), q) <= 0) upper.pop(); upper.push(q); }
  return lower.slice(0, -1).concat(upper.slice(0, -1));
}

/** A closed ring simplified (Douglas-Peucker) to tol metres, from its point farthest from its centre (a corner). */
export function simplifyRing(ring0, tol) {
  if (ring0.length < 4) return ring0;
  const cx = ring0.reduce((t, q) => t + q[0], 0) / ring0.length; const cy = ring0.reduce((t, q) => t + q[1], 0) / ring0.length;
  let s0 = 0; let sd = -1;
  ring0.forEach((q, i) => { const d = Math.hypot(q[0] - cx, q[1] - cy); if (d > sd) { sd = d; s0 = i; } });
  const ring = [...ring0.slice(s0), ...ring0.slice(0, s0)];
  // (split at the point farthest from the first: a closed ring in two open runs)
  let far = 0; let fd = -1;
  ring.forEach((q, i) => { const d = len2(v2(ring[0], q)); if (d > fd) { fd = d; far = i; } });
  const dp = (pts) => {
    if (pts.length < 3) return pts;
    const a = pts[0]; const b = pts.at(-1); const ab = v2(a, b); const L = len2(ab) || 1;
    let k = -1; let dm = 0;
    for (let i = 1; i < pts.length - 1; i++) { const d = Math.abs(ab[0] * (pts[i][1] - a[1]) - ab[1] * (pts[i][0] - a[0])) / L; if (d > dm) { dm = d; k = i; } }
    if (dm <= tol) return [a, b];
    return [...dp(pts.slice(0, k + 1)).slice(0, -1), ...dp(pts.slice(k))];
  };
  const one = dp(ring.slice(0, far + 1)); const two = dp([...ring.slice(far), ring[0]]);
  return [...one.slice(0, -1), ...two.slice(0, -1)];
}

/**
 * A sentry box (garita) cantilevered off a fort's salient corner: a round
 * stone turret on a corbel below the parapet, a dark slit all round, a
 * domed cap.
 */
export function sentryBox(m, corner, zRoof, wallMat, wallTint, { r = 1.0, top = 2.6 } = {}) {
  const c = [corner.p[0] + corner.out[0] * r * 0.55, corner.p[1] + corner.out[1] * r * 0.55];
  // the corbel: stepped rings under the turret
  cylinder(m, wallMat, c[0], c[1], r * 0.55, zRoof - 1.6, zRoof - 0.9, wallTint, { n: 10, top: false });
  cylinder(m, wallMat, c[0], c[1], r * 0.8, zRoof - 0.9, zRoof - 0.3, wallTint, { n: 12, top: false });
  cylinder(m, wallMat, c[0], c[1], r, zRoof - 0.3, zRoof + top - 0.9, wallTint, { n: 14, top: false });
  // the lookout slit, then the drum and cap
  cylinder(m, wallMat, c[0], c[1], r - 0.04, zRoof + top - 0.9, zRoof + top - 0.6, wallTint.map((v) => v * 0.25), { n: 14, top: false });
  cylinder(m, wallMat, c[0], c[1], r, zRoof + top - 0.6, zRoof + top, wallTint, { n: 14, top: false });
  dome(m, wallMat, c[0], c[1], r * 1.04, zRoof + top, wallTint, { n: 14, rings: 4, rise: 0.8 });
  // (its underside: the corbel's foot closed)
  const p = circle(c[0], c[1], r * 0.55, 10);
  for (let i = 1; i + 1 < 10; i++) m.tri(wallMat, [...p[0], zRoof - 1.6], [...p[i + 1], zRoof - 1.6], [...p[i], zRoof - 1.6], [0, 0], [1, 0], [1, 1], wallTint);
}

/**
 * A castle's round corner tower from the ground (z0) to over the wall top:
 * crenellated, or (cone) a conical slate roof. Returns its top.
 */
export function cornerTower(m, corner, z0, zRoof, wallMat, wallTint, roofMat, roofTint, { r = 3, cone: conical = false, centre = null } = {}) {
  const c = centre || [corner.p[0] + corner.out[0] * r * 0.35, corner.p[1] + corner.out[1] * r * 0.35];
  const top = zRoof + Math.max(3, r * 1.2);
  const n = 18;
  cylinder(m, wallMat, c[0], c[1], r, z0, top, wallTint, { n });
  // a dark arrow slit or two up its outer face
  for (const f of [0.35, 0.65]) {
    const z = z0 + (top - z0) * f;
    const p = [c[0] + corner.out[0] * (r + 0.03), c[1] + corner.out[1] * (r + 0.03)];
    box(m, wallMat, p, [-corner.out[1], corner.out[0]], 0.15, 0.05, z, z + 1.4, wallTint.map((v) => v * 0.2));
  }
  if (conical) {
    cylinder(m, wallMat, c[0], c[1], r + 0.3, top - 0.5, top, wallTint, { n, top: false });
    cone(m, roofMat, c[0], c[1], r + 0.45, top, top + r * 1.9, roofTint, { n });
    return top + r * 1.9;
  }
  // a corbelled ring over the shaft, merlons round its rim
  cylinder(m, wallMat, c[0], c[1], r + 0.35, top - 0.6, top + 0.9, wallTint, { n });
  const k = Math.max(6, Math.round((2 * Math.PI * (r + 0.35)) / 2.2));
  for (let q = 0; q < k; q++) {
    const a = (2 * Math.PI * q) / k;
    const u = [Math.cos(a), Math.sin(a)]; const along = [-u[1], u[0]];
    const pc = [c[0] + u[0] * (r + 0.05), c[1] + u[1] * (r + 0.05)];
    box(m, wallMat, pc, along, Math.PI * (r + 0.35) / k * 0.62, 0.3, top + 0.9, top + 1.9, wallTint, { uvM: 3 });
  }
  return top + 1.9;
}

/**
 * A gate in the middle of wall a-b (counter-clockwise ring: outside on the
 * right): a round-arched portal in a stone surround, its wooden doors set
 * back. Returns false where the wall is too short.
 */
export function fortGate(m, a, b, base, wallMat, wallTint, { w = 3.6, h = 4.2 } = {}) {
  const e = v2(a, b); const L = len2(e);
  if (L < w + 3) return false;
  const d = [e[0] / L, e[1] / L]; const out = [d[1], -d[0]];
  const mid = [a[0] + e[0] / 2, a[1] + e[1] / 2];
  const at = (s, k) => [mid[0] + d[0] * s + out[0] * k, mid[1] + d[1] * s + out[1] * k];
  // the surround, standing proud of the wall
  const sw = w / 2 + 0.7; const sh = h + w / 2 + 0.8;
  box(m, wallMat, at(0, 0.2), d, sw, 0.2, base - 0.3, base + sh, wallTint.map((v) => Math.min(1, v * 1.08)), { uvM: 3 });
  // the doors: a rectangle and its round head, just in front of the surround
  // (weatherboards turned upright: the planks of a gate; uv u runs up the door)
  const k = 0.45; const col = GATE_WOOD;
  const P = (s, z) => [...at(s, k), z];
  const U = (s, z) => [(z - base) / 2, (s + w / 2) / 2];
  m.quad('siding', P(-w / 2, base), P(w / 2, base), P(w / 2, base + h), P(-w / 2, base + h), U(-w / 2, base), U(w / 2, base), U(w / 2, base + h), U(-w / 2, base + h), col);
  const segs = 10;
  for (let q = 0; q < segs; q++) {
    const t0 = Math.PI * (q / segs); const t1 = Math.PI * ((q + 1) / segs);
    const p0 = P((w / 2) * Math.cos(t0), base + h + (w / 2) * Math.sin(t0));
    const p1 = P((w / 2) * Math.cos(t1), base + h + (w / 2) * Math.sin(t1));
    m.tri('siding', P(0, base + h), p0, p1, U(0, base + h), U((w / 2) * Math.cos(t0), base + h + (w / 2) * Math.sin(t0)), U((w / 2) * Math.cos(t1), base + h + (w / 2) * Math.sin(t1)), col);
  }
  // iron straps across the doors
  for (const z of [base + 0.8, base + h * 0.55]) box(m, 'concrete', at(0, k + 0.03), d, w / 2, 0.03, z, z + 0.12, [0.12, 0.12, 0.13]);
  return true;
}
