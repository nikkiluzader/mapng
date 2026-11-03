// Where a filling station's pump islands stand. The game's own island (East
// Coast USA's eca_gastation_pumps: pumps under a canopy) is placed:
//  - under the station's canopy, when OSM maps one: the station way itself as
//    building=roof/canopy, or a roof/canopy outline within the station's
//    grounds (or near its point). Islands run along the canopy's long side,
//    as many as it holds; the drawn canopy is left out (the island has its own).
//  - at the station's fuel_pump nodes, when mapped (rare);
//  - else beside the nearest road, moved along it and out from it until it is
//    clear of buildings and the carriageway.
// More than half the stations in our test areas map a canopy; two map pumps.

// the island in its model frame (measured in game: getObjBox): 17.6 m along
// local x, 7.1 m across, its middle 1.3 m along x and 6.75 m to -y of the origin
export const ISLAND = { length: 17.6, width: 7.1, cx: 1.3, cy: -6.75 };
const SCALE_RANGE = [0.7, 1.4];
const MAX_PER_ROW = 8;             // (a truck stop's canopy: a hundred pumps)
const ROW_W_M = 9;                 // a canopy holds a row of islands per this much width (from 13 m)
const ROW_MIN_W_M = 13;
const MAX_ROWS = 3;
const CANOPY_MIN_M2 = 30;
const CANOPY_MAX_M2 = 4000;
// a station mapped as an area with no building in it and the shape of a box
// is its canopy (a big station maps each canopy as an outer of its relation)
const AREA_CANOPY_FILL = 0.8;
const CANOPY_NEAR_M = 40;          // a canopy this near a station mapped as a point
const CANOPY_TYPES = new Set(['roof', 'canopy']);

const clamp = (v, [lo, hi]) => Math.max(lo, Math.min(hi, v));

function ringArea(r) { let s = 0; for (let i = 0; i < r.length; i++) { const a = r[i]; const b = r[(i + 1) % r.length]; s += a[0] * b[1] - b[0] * a[1]; } return Math.abs(s) / 2; }
function centroid(r) { return [r.reduce((s, p) => s + p[0], 0) / r.length, r.reduce((s, p) => s + p[1], 0) / r.length]; }
export function inRing(r, x, y) { let k = false; for (let i = 0, j = r.length - 1; i < r.length; j = i++) if (((r[i][1] > y) !== (r[j][1] > y)) && (x < ((r[j][0] - r[i][0]) * (y - r[i][1])) / (r[j][1] - r[i][1]) + r[i][0])) k = !k; return k; }
const openRing = (r) => (r.length > 1 && r[0][0] === r[r.length - 1][0] && r[0][1] === r[r.length - 1][1] ? r.slice(0, -1) : r);

/** The smallest box round a ring, along one of its edges: { c, u (long axis), L, W }. */
export function boxOf(ring) {
  const r = openRing(ring);
  let best = null;
  for (let i = 0; i < r.length; i++) {
    const a = r[i]; const b = r[(i + 1) % r.length]; const l = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (l < 0.3) continue;
    const u = [(b[0] - a[0]) / l, (b[1] - a[1]) / l]; const v = [-u[1], u[0]];
    const s = r.map((p) => p[0] * u[0] + p[1] * u[1]); const t = r.map((p) => p[0] * v[0] + p[1] * v[1]);
    const w = Math.max(...s) - Math.min(...s); const h = Math.max(...t) - Math.min(...t);
    if (!best || w * h < best.w * best.h) best = { u, v, w, h, s0: Math.min(...s), t0: Math.min(...t) };
  }
  if (!best) return null;
  const { u, v, w, h, s0, t0 } = best;
  const sm = s0 + w / 2; const tm = t0 + h / 2;
  const c = [u[0] * sm + v[0] * tm, u[1] * sm + v[1] * tm];
  return w >= h ? { c, u, L: w, W: h } : { c, u: v, L: h, W: w };
}

/**
 * Each station's canopy: stations [{ tags, canopy?: ring, area?: ring, pt }]
 * (world xy), buildings [{ id, tags, ring }]. Returns { canopies: [ring|null]
 * per station, used: Set of building ids taken as a canopy }.
 */
export function stationCanopies(stations, buildings, { buildingAt = () => false } = {}) {
  const used = new Set();
  const candidates = buildings.filter((b) => CANOPY_TYPES.has(b.tags?.building) && b.ring?.length >= 3)
    .map((b) => ({ ...b, c: centroid(openRing(b.ring)), a: ringArea(openRing(b.ring)) }))
    .filter((b) => b.a >= CANOPY_MIN_M2 && b.a <= CANOPY_MAX_M2);
  const canopies = stations.map((st) => {
    if (st.canopy?.length >= 3) return st.canopy;
    const brand = String(st.tags?.brand || st.tags?.name || '').toLowerCase();
    let best = null;
    for (const b of candidates) {
      if (used.has(b.id)) continue;
      // (a named roof is the station's only if it carries its name: not a gazebo or a market hall)
      const name = String(b.tags?.name || b.tags?.brand || '').toLowerCase();
      if (name && name !== brand) continue;
      const within = st.area?.length >= 3 ? inRing(openRing(st.area), b.c[0], b.c[1]) : true;
      const d = Math.hypot(b.c[0] - st.pt[0], b.c[1] - st.pt[1]);
      if (!within || (!(st.area?.length >= 3) && d > CANOPY_NEAR_M)) continue;
      if (!best || d < best.d) best = { b, d };
    }
    if (best) { used.add(best.b.id); return best.b.ring; }
    if (st.area?.length >= 3 && areaIsCanopy(openRing(st.area), buildingAt)) return st.area;
    return null;
  });
  return { canopies, used };
}

function areaIsCanopy(r, buildingAt) {
  const a = ringArea(r);
  if (a < CANOPY_MIN_M2 || a > CANOPY_MAX_M2) return false;
  const box = boxOf(r);
  if (!box || a < AREA_CANOPY_FILL * box.L * box.W) return false;
  // (no building inside: grounds round a shop are not a canopy)
  for (let i = 1; i < 6; i++) for (let j = 1; j < 4; j++) {
    const v = [-box.u[1], box.u[0]]; const s = (i / 6 - 0.5) * box.L; const t = (j / 4 - 0.5) * box.W;
    if (buildingAt(box.c[0] + box.u[0] * s + v[0] * t, box.c[1] + box.u[1] * s + v[1] * t)) return false;
  }
  return true;
}

// drive lanes mapped under a canopy (service ways through it): the islands
// run along them, in the gaps between them (cars stand on the lanes beside)
const LANE_MIN_IN_M = 3;           // a way this long under the canopy is a lane through it
const LANE_ALIGN_COS = Math.cos((25 * Math.PI) / 180);
const LANE_CLUSTER_M = 2;
const STRIP_MIN_M = 4;             // a gap this wide holds an island
const LANE_GAP_FULL_M = 8;         // (the island at its own width in a gap this wide)

/** The lanes under a canopy: { u, offsets: [t...] (across, from c0), c0 } or null. */
export function lanesUnder(ring, lanes = []) {
  const r = openRing(ring);
  const c0 = centroid(r);
  const segs = [];
  for (const pts of lanes) {
    for (let i = 0; i + 1 < pts.length; i++) {
      const a = pts[i]; const b = pts[i + 1]; const l = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (l < 0.1) continue;
      const n = Math.ceil(l);
      for (let k = 0; k < n; k++) {
        const t = (k + 0.5) / n; const p = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
        if (inRing(r, p[0], p[1])) segs.push({ p, d: [(b[0] - a[0]) / l, (b[1] - a[1]) / l], w: l / n });
      }
    }
  }
  if (segs.reduce((s2, q) => s2 + q.w, 0) < LANE_MIN_IN_M) return null;
  // the main direction (doubled angles: a way drawn either way round counts the same)
  let cx = 0; let cy = 0;
  for (const q of segs) { const a2 = 2 * Math.atan2(q.d[1], q.d[0]); cx += q.w * Math.cos(a2); cy += q.w * Math.sin(a2); }
  const ang = Math.atan2(cy, cx) / 2; const u = [Math.cos(ang), Math.sin(ang)]; const v = [-u[1], u[0]];
  const ts = segs.filter((q) => Math.abs(q.d[0] * u[0] + q.d[1] * u[1]) >= LANE_ALIGN_COS)
    .map((q) => ({ t: (q.p[0] - c0[0]) * v[0] + (q.p[1] - c0[1]) * v[1], w: q.w })).sort((a, b) => a.t - b.t);
  const offsets = [];
  let group = [];
  const flush = () => { const w = group.reduce((s2, q) => s2 + q.w, 0); if (w >= LANE_MIN_IN_M) offsets.push(group.reduce((s2, q) => s2 + q.t * q.w, 0) / w); group = []; };
  for (const q of ts) { if (group.length && q.t - group[group.length - 1].t > LANE_CLUSTER_M) flush(); group.push(q); }
  if (group.length) flush();
  return offsets.length ? { u, v, offsets, c0 } : null;
}

/**
 * The islands filling a canopy: [{ c, yaw, sx, sy }]. With lanes mapped
 * through it, along them in the gaps between (or beside a lone one); else
 * rows along its long side.
 */
export function islandsUnder(ring, lanes = []) {
  const lane = lanesUnder(ring, lanes);
  if (lane) {
    const r = openRing(ring); const { u, v, offsets, c0 } = lane;
    const s = r.map((p) => (p[0] - c0[0]) * u[0] + (p[1] - c0[1]) * u[1]);
    const t = r.map((p) => (p[0] - c0[0]) * v[0] + (p[1] - c0[1]) * v[1]);
    const s0 = Math.min(...s); const L = Math.max(...s) - s0;
    const t0 = Math.min(...t); const t1 = Math.max(...t);
    const between = [];
    for (let i = 0; i + 1 < offsets.length; i++) between.push([offsets[i], offsets[i + 1]]);
    let strips = between.filter(([a, b]) => b - a >= STRIP_MIN_M);
    if (!strips.length) strips = [[t0, offsets[0]], [offsets[offsets.length - 1], t1]].filter(([a, b]) => b - a >= STRIP_MIN_M);
    if (strips.length) {
      const n = Math.max(1, Math.min(MAX_PER_ROW, Math.round(L / ISLAND.length)));
      const sx = clamp(L / n / ISLAND.length, SCALE_RANGE);
      const yaw = Math.atan2(u[1], u[0]);
      const out = [];
      for (const [a, b] of strips) {
        const sy = clamp((b - a) / LANE_GAP_FULL_M, [0.6, 1.2]);
        const tm = (a + b) / 2;
        for (let k = 0; k < n; k++) {
          const sm = s0 + (k + 0.5) * (L / n);
          out.push({ c: [c0[0] + u[0] * sm + v[0] * tm, c0[1] + u[1] * sm + v[1] * tm], yaw, sx, sy });
        }
      }
      return out;
    }
  }
  const box = boxOf(ring);
  if (!box) return [];
  const rows = box.W >= ROW_MIN_W_M ? Math.max(2, Math.min(MAX_ROWS, Math.round(box.W / ROW_W_M))) : 1;
  const n = Math.max(1, Math.min(MAX_PER_ROW, Math.round(box.L / ISLAND.length)));
  const sx = clamp(box.L / n / ISLAND.length, SCALE_RANGE);
  const sy = clamp(box.W / rows / ISLAND.width, SCALE_RANGE);
  const v = [-box.u[1], box.u[0]]; const yaw = Math.atan2(box.u[1], box.u[0]);
  const out = [];
  for (let r = 0; r < rows; r++) {
    for (let k = 0; k < n; k++) {
      const s = (k + 0.5) * (box.L / n) - box.L / 2; const t = (r + 0.5) * (box.W / rows) - box.W / 2;
      out.push({ c: [box.c[0] + box.u[0] * s + v[0] * t, box.c[1] + box.u[1] * s + v[1] * t], yaw, sx, sy });
    }
  }
  return out;
}

/** The model origin that puts an island's middle at c, turned to yaw, scaled sx, sy. */
export function islandOrigin({ c, yaw, sx = 1, sy = 1 }) {
  const ox = ISLAND.cx * sx; const oy = ISLAND.cy * sy;
  const cs = Math.cos(yaw); const sn = Math.sin(yaw);
  return [c[0] - (ox * cs - oy * sn), c[1] - (ox * sn + oy * cs)];
}

/** The island's footprint corners (grown by pad). */
export function islandCorners({ c, yaw, sx = 1, sy = 1 }, pad = 0) {
  const hl = (ISLAND.length * sx) / 2 + pad; const hw = (ISLAND.width * sy) / 2 + pad;
  const u = [Math.cos(yaw), Math.sin(yaw)]; const v = [-u[1], u[0]];
  return [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([a, b]) => [c[0] + u[0] * hl * a + v[0] * hw * b, c[1] + u[1] * hl * a + v[1] * hw * b]);
}

/** The two refuelling bays beside an island (a car's length along it, either side). */
export function islandBays(isl) {
  const u = [Math.cos(isl.yaw), Math.sin(isl.yaw)]; const v = [-u[1], u[0]];
  const off = (ISLAND.width * (isl.sy ?? 1)) / 2 - 1;
  return [-1, 1].map((sg) => ({ c: [isl.c[0] + v[0] * off * sg, isl.c[1] + v[1] * off * sg], yaw: isl.yaw, scale: [12 * (isl.sx ?? 1), 4.5, 4] }));
}

const ROAD_GAP_M = 6;              // apron between the road's edge and the island's side
const OUT_STEPS = [0, 2, 4, -1.5, 7];
const ALONG_STEPS = [0, 6, -6, 12, -12, 18, -18, 24, -24];

/**
 * An island beside the nearest road, clear of buildings and the carriageway:
 * near { cx, cy, tx, ty, halfWidth } (the road point nearest the station),
 * side: the station's side of it (unit normal), blocked(x, y): a building or
 * carriageway there. Returns { c, yaw } or the first try when nothing is clear.
 */
export function islandBesideRoad(near, side, blocked) {
  const yaw = Math.atan2(near.ty, near.tx);
  const base = near.halfWidth + ROAD_GAP_M + ISLAND.width / 2;
  let first = null;
  for (const o of OUT_STEPS) {
    for (const a of ALONG_STEPS) {
      const c = [near.cx + side[0] * (base + o) + near.tx * a, near.cy + side[1] * (base + o) + near.ty * a];
      const isl = { c, yaw };
      first ||= isl;
      if (!footprintBlocked(isl, blocked)) return isl;
    }
  }
  return first;
}

function footprintBlocked(isl, blocked) {
  const [p0, p1, , p3] = islandCorners(isl, 1);
  const eu = [p1[0] - p0[0], p1[1] - p0[1]]; const ev = [p3[0] - p0[0], p3[1] - p0[1]];
  for (let i = 0; i <= 8; i++) for (let j = 0; j <= 3; j++) {
    const x = p0[0] + (eu[0] * i) / 8 + (ev[0] * j) / 3; const y = p0[1] + (eu[1] * i) / 8 + (ev[1] * j) / 3;
    if (blocked(x, y)) return true;
  }
  return false;
}
