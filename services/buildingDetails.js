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
    if (!STREET_CLASSES.has(hw) || (t.tunnel && t.tunnel !== 'no') || t.service === 'parking_aisle' || t.service === 'driveway') continue;
    for (let i = 0; i + 1 < line.length; i++) {
      const k = segs.length; const a = line[i]; const b = line[i + 1];
      segs.push([a, b]);
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
  return { facing, passages };
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

/** Shop by shop along the street wall a-b at the ground floor's top zTop: an awning or a fascia. */
export function shopfronts(m, a, b, zTop, rnd) {
  const e = v2(a, b); const L = len2(e);
  if (L < 3) return 0;
  const d = [e[0] / L, e[1] / L]; const out = [d[1], -d[0]];
  let s = 0.3; let k = 0; let n = 0;
  while (s < L - 1.5) {
    let w = SHOP_BAY_M[0] + (SHOP_BAY_M[1] - SHOP_BAY_M[0]) * rnd('w', k);
    if (L - 0.3 - (s + w) < 2.5) w = L - 0.3 - s;
    const p = [a[0] + d[0] * (s + 0.15), a[1] + d[1] * (s + 0.15)];
    const q = [a[0] + d[0] * (s + w - 0.15), a[1] + d[1] * (s + w - 0.15)];
    if (rnd('awn', k) < AWNING_SHARE) awning(m, p, q, out, zTop - 0.35, AWNING_COLOURS[Math.floor(rnd('ac', k) * AWNING_COLOURS.length)]);
    else {
      const c = [(p[0] + q[0]) / 2 + out[0] * 0.08, (p[1] + q[1]) / 2 + out[1] * 0.08];
      box(m, 'metalWhite', c, d, len2(v2(p, q)) / 2, 0.08, zTop - 1.05, zTop - 0.3, FASCIA_COLOURS[Math.floor(rnd('fc', k) * FASCIA_COLOURS.length)]);
    }
    s += w; k++; n++;
  }
  return n;
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
const DOOR_W = 1.0;
const DOOR_H = 2.1;

/** A front door on the wall at c (plan point on the wall), facing out: a painted leaf in a white frame. */
function frontDoor(m, c, along, out, base, col) {
  const f = (k, w, z0, z1, tint) => box(m, 'metalWhite', [c[0] + out[0] * k, c[1] + out[1] * k], along, w / 2, k, z0, z1, tint);
  f(0.06, DOOR_W + 0.24, base, base + DOOR_H + 0.14, TRIM_WHITE);       // frame
  f(0.09, DOOR_W, base, base + DOOR_H, col);                           // leaf
}

/**
 * The entrance on wall a-b (its middle third): 'veranda' (posts and a shed roof in the house's roofing),
 * 'hood' (a small gabled canopy on brackets), with steps from the street's ground gDoor up to the floor
 * at base. Returns what was built.
 */
export function entrance(m, a, b, base, gDoor, style, roofMat, roofTint, rnd) {
  const e = v2(a, b); const L = len2(e);
  if (L < 3.5) return null;
  const d = [e[0] / L, e[1] / L]; const out = [d[1], -d[0]];
  const at = (t, k, z) => [a[0] + d[0] * t + out[0] * k, a[1] + d[1] * t + out[1] * k, z];
  // (the wall's middle: where the house's laid-over windows leave the door's
  // bay free, beamngBuildings.js houseWindows)
  const mid = L / 2;
  const rise = Math.max(0, base - gDoor);
  const doorAt = at(mid, 0, 0);
  frontDoor(m, [doorAt[0], doorAt[1]], d, out, base, DOOR_COLOURS[Math.floor(rnd('doorCol') * DOOR_COLOURS.length)]);
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
    if (rise > 0.2) steps(m, at(mid, depth + 0.1, 0), d, out, gDoor, base, 1.6);
    return 'veranda';
  }
  if (style === 'hood') {
    const w = 1.7; const top = base + 2.35; const depth = 0.85; const ridge = 0.45;
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
    if (rise > 0.2) steps(m, P(0, 0.05, 0), d, out, gDoor, base, 1.3);
    return 'hood';
  }
  if (rise > 0.2) { steps(m, at(mid, 0.05, 0), d, out, gDoor, base, 1.4); return 'steps'; }
  return null;
}

const STEP_RISE = 0.18;
const STEP_TREAD = 0.3;

/** Concrete steps from the ground g up to the floor at `top`, out from the wall at p (front edge). */
export function steps(m, p, along, out, g, top, width) {
  const rise = top - g;
  if (rise < 0.15) return 0;
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
export function roofPlant(m, ring, boxInfo, z, area, wallMat, wallTint, { tanks = false } = {}, rnd) {
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
    if (inRing(c, ring)) { waterTank(m, c, z); built++; }
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
export function passageCrossings(ring, passages) {
  const out = [];
  for (const { line, half } of passages || []) {
    const hits = [];
    let s0 = 0;
    for (let i = 0; i + 1 < line.length; i++) {
      const p = line[i]; const q = line[i + 1]; const s = v2(p, q); const sl = len2(s);
      for (let j = 0; j < ring.length; j++) {
        const a = ring[j]; const b = ring[(j + 1) % ring.length]; const e = v2(a, b);
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
