// Gates in a fence, a wall or across a road. This is a driving game: every gate
// stands open, and the fence has a real opening for what passes through it.
//
//   vehicle gates   as wide as the drawn road and a little: two leaves swung
//                   back beside it (tube farm gate, or mesh in chain link and
//                   walls), a sliding gate parked behind the fence, a raised boom
//   walking gates   OSM's wicket, kissing gate or stile, a gate on a footway or
//                   on a fence with no road: 1.2 m and one small leaf
//   openings        OSM's entrance, cattle grid and turnstile: no leaf
//
// A road through a fence with no gate mapped has an opening too (few mappers
// tag them, and OSM's tiles carry none): a gate on a service road or a track, a
// gap on a through road, where the fence met the road only in the mapping.
// Pure geometry: returns plans the exporter turns into objects.

import { GATE_BARRIERS } from './overpassQuery.js';

const TILE_GATES = new Set(GATE_BARRIERS);
const WALK_ONLY = new Set(['wicket_gate', 'kissing_gate', 'stile', 'turnstile', 'full-height_turnstile', 'bump_gate']);
const NO_LEAF = new Set(['entrance', 'cattle_grid', 'turnstile', 'full-height_turnstile']);
const WALK_HIGHWAYS = new Set(['footway', 'path', 'pedestrian', 'steps', 'cycleway', 'bridleway', 'corridor']);
const GATED_HIGHWAYS = new Set(['service', 'track', 'unclassified', 'driveway']);
// lines a road or a path opens: others (a guard rail, a retaining wall) just
// stop short of a drawn road
const ENCLOSING = new Set(['fence', 'wall', 'wire_fence', 'chain_link', 'city_wall', 'hedge', 'chain', 'handrail', 'railing']);
const LEAFED = new Set(['fence', 'wall', 'wire_fence', 'chain_link', 'city_wall', 'hedge']);

const NODE_LINE_M = 2.5;      // a gate node this near a line stands in it
const NODE_WAY_M = 1.5;       // ... this far past a road's edge, on that road
const ROAD_CLEAR_M = 0.6;     // beside the road each side
const WALK_W_M = 1.2;
const DRIVE_MIN_M = 3.2;
const NO_ROAD_DRIVE_W_M = 4;  // a gate OSM opens to cars, no road mapped through it
const SAME_GATE_M = 3;
const OPEN_ANGLE = (98 * Math.PI) / 180;   // swung back a little past square

export const GATE_SHAPES = {
  farm: { shapeName: '/levels/hirochi_raceway/art/shapes/objects/farm_gate_metal1.dae', length: 3.67, origin: 'middle', z: 0 },
  wood: { shapeName: '/levels/hirochi_raceway/art/shapes/objects/farm_gate_wood1.dae', length: 1.58, origin: 'end', z: 0 },
  mesh: { shapeName: '/levels/Industrial/art/shapes/buildings/ind_mesh_fence_gate_3m.dae', length: 3, origin: 'end', z: 1.23 },
  sliding: { shapeName: '/levels/Industrial/art/shapes/buildings/metal_gate.dae', length: 10.5, origin: 'far', z: 0.14 },
  boom: { shapeName: '/levels/italy/art/shapes/buildings/italy_bld_boomgate_4.5m.dae', z: 0.31 },
  boomLong: { shapeName: '/levels/italy/art/shapes/buildings/italy_bld_boomgate_6.5m.dae', z: 0.31 },
};

const num = (v) => { const n = Number.parseFloat(v); return Number.isFinite(n) && n > 0 ? n : null; };

/** Is this OSM barrier a gate (node, or way drawn along the gate itself)? */
export const isGateBarrier = (tags) => TILE_GATES.has(String(tags?.barrier || '').toLowerCase());

function lengths(pts) {
  const s = [0];
  for (let i = 1; i < pts.length; i++) s.push(s[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
  return s;
}

/** The nearest point of a line: { d, s, q, t } (distance, station, point, unit tangent). */
function nearest(pts, x, y, s = lengths(pts)) {
  let best = null;
  for (let i = 0; i + 1 < pts.length; i++) {
    const a = pts[i]; const b = pts[i + 1]; const dx = b[0] - a[0]; const dy = b[1] - a[1]; const L2 = dx * dx + dy * dy;
    if (L2 < 1e-9) continue;
    const u = Math.max(0, Math.min(1, ((x - a[0]) * dx + (y - a[1]) * dy) / L2));
    const q = [a[0] + dx * u, a[1] + dy * u]; const d = Math.hypot(x - q[0], y - q[1]);
    if (!best || d < best.d) { const L = Math.sqrt(L2); best = { d, s: s[i] + L * u, q, t: [dx / L, dy / L] }; }
  }
  return best;
}

function boxOf(pts) {
  let x0 = Infinity; let y0 = Infinity; let x1 = -Infinity; let y1 = -Infinity;
  for (const q of pts) { if (q[0] < x0) x0 = q[0]; if (q[0] > x1) x1 = q[0]; if (q[1] < y0) y0 = q[1]; if (q[1] > y1) y1 = q[1]; }
  return [x0, y0, x1, y1];
}

// Boxes in a grid of cells: the indices of those overlapping a query box, in
// order (callers keep the order a plain loop gave).
const GRID_CELL_M = 64;
function boxGrid(boxes) {
  const cells = new Map();
  const key = (gx, gy) => gx * 1048576 + gy;
  const span = (b, fn) => {
    for (let gx = Math.floor(b[0] / GRID_CELL_M); gx <= Math.floor(b[2] / GRID_CELL_M); gx++) {
      for (let gy = Math.floor(b[1] / GRID_CELL_M); gy <= Math.floor(b[3] / GRID_CELL_M); gy++) fn(key(gx, gy));
    }
  };
  boxes.forEach((b, k) => { if (b[0] <= b[2]) span(b, (c) => { if (!cells.has(c)) cells.set(c, []); cells.get(c).push(k); }); });
  return {
    overlapping: (q) => {
      if (!(q[0] <= q[2])) return [];
      const found = new Set();
      span(q, (c) => { for (const k of cells.get(c) || []) { const b = boxes[k]; if (b[0] <= q[2] && b[2] >= q[0] && b[1] <= q[3] && b[3] >= q[1]) found.add(k); } });
      return [...found].sort((a, b) => a - b);
    },
  };
}

/** Where two lines cross: [{ x, y, sa, ta, tb }] (sa a's station, ta/tb unit tangents). */
export function crossings(a, b) {
  const out = []; const s = lengths(a);
  for (let i = 0; i + 1 < a.length; i++) {
    const p = a[i]; const r = [a[i + 1][0] - p[0], a[i + 1][1] - p[1]]; const La = Math.hypot(...r);
    if (La < 1e-6) continue;
    for (let j = 0; j + 1 < b.length; j++) {
      const q = b[j]; const w = [b[j + 1][0] - q[0], b[j + 1][1] - q[1]];
      const den = r[0] * w[1] - r[1] * w[0];
      if (Math.abs(den) < 1e-9) continue;
      const u = ((q[0] - p[0]) * w[1] - (q[1] - p[1]) * w[0]) / den;
      const v = ((q[0] - p[0]) * r[1] - (q[1] - p[1]) * r[0]) / den;
      if (u < 0 || u > 1 || v < 0 || v > 1) continue;
      const Lb = Math.hypot(...w) || 1;
      out.push({ x: p[0] + r[0] * u, y: p[1] + r[1] * u, sa: s[i] + La * u, ta: [r[0] / La, r[1] / La], tb: [w[0] / Lb, w[1] / Lb] });
    }
  }
  return out;
}

const drivenWidth = (way) => Math.max(DRIVE_MIN_M, way.half * 2 + ROAD_CLEAR_M * 2);
const walkedWidth = (way) => Math.max(WALK_W_M, Math.min(3, way.half * 2 + 0.4));

function styleOf(type, { walk, chainLink, wall }) {
  if (NO_LEAF.has(type)) return 'gap';
  if (type === 'lift_gate') return 'boom';
  if (walk) return chainLink ? 'smallMesh' : 'wood';
  if (type === 'sliding_gate') return 'sliding';
  return chainLink || wall ? 'mesh' : 'farm';
}

/**
 * The gates and the cuts they make.
 *
 * @param {object} p
 * @param {Array<{ pts, tags, chainLink? }>} p.barriers  world-space lines
 * @param {Array<{ pts, half, highway }>} p.ways         drawn roads and paths on the ground
 * @param {Array<{ x, y, tags }>} p.nodes                OSM gate nodes
 * @returns {{ cuts: Array<Array<[number, number]>>, gates: Array, lines: Set<number> }}
 *   cuts: per barrier, stations to leave open; gates: { x, y, along, width, walk, style };
 *   lines: barriers that are themselves a gate, drawn as one and not as a fence
 */
export function planGates({ barriers = [], ways = [], nodes = [] }) {
  const cuts = barriers.map(() => []); const gates = []; const lines = new Set();
  const stations = barriers.map((b) => lengths(b.pts));
  const roadWays = ways.map((w) => ({ ...w, walk: WALK_HIGHWAYS.has(w.highway) }));
  const gateNear = (x, y) => gates.some((g) => Math.hypot(g.x - x, g.y - y) < SAME_GATE_M + g.width / 2);
  const waysAt = (x, y) => {
    let best = null;
    for (const w of roadWays) {
      const h = nearest(w.pts, x, y);
      if (!h || h.d > w.half + NODE_WAY_M) continue;
      // (a road beats a pavement beside it)
      const gap = h.d - w.half - (w.walk ? 0 : 1);
      if (!best || gap < best.gap) best = { ...h, way: w, gap };
    }
    return best;
  };
  const cutAt = (i, c, width) => cuts[i].push([c - width / 2, c + width / 2]);
  const seats = (x, y) => {
    const out = [];
    barriers.forEach((b, i) => {
      if (lines.has(i)) return;
      const h = nearest(b.pts, x, y, stations[i]);
      if (h && h.d <= NODE_LINE_M) out.push({ i, b, ...h });
    });
    return out.sort((p, q) => p.d - q.d);
  };
  const place = (x, y, tags, { width: known = null, tangent = null } = {}) => {
    const type = String(tags.barrier || '').toLowerCase();
    const on = waysAt(x, y);
    // (a line that is itself the gate: the fences stop at its ends already)
    const seat = tangent ? [] : seats(x, y);
    const given = num(tags.maxwidth) ?? num(tags.width);
    const walk = WALK_ONLY.has(type) || (on ? on.way.walk : !(tags.motor_vehicle === 'yes' || tags.vehicle === 'yes' || (known ?? given ?? 0) >= 2.5));
    let width;
    if (on) width = Math.max(walk && !on.way.walk ? WALK_W_M : walk ? walkedWidth(on.way) : drivenWidth(on.way), known ?? 0, walk ? 0 : given ?? 0);
    else width = known ?? given ?? (walk ? WALK_W_M : NO_ROAD_DRIVE_W_M);
    if (!on && !seat.length && !tangent) return false;
    const along = tangent ?? (seat.length ? seat[0].t : [-on.t[1], on.t[0]]);
    const c = on && !seat.length ? on.q : [x, y];
    for (const h of seat) cutAt(h.i, h.s, width);
    const b = seat[0]?.b;
    gates.push({ x: c[0], y: c[1], along, width, walk, type, style: styleOf(type, { walk, chainLink: b?.chainLink, wall: /wall/.test(b?.tags?.barrier || '') }) });
    return true;
  };

  barriers.forEach((b, i) => {
    if (!isGateBarrier(b.tags) || b.pts.length < 2) return;
    lines.add(i);
    const s = stations[i]; const L = s[s.length - 1];
    if (L < 0.5) return;
    let mid = b.pts[0]; let t = [1, 0];
    for (let k = 0; k + 1 < b.pts.length; k++) {
      if (s[k + 1] >= L / 2) {
        const u = (L / 2 - s[k]) / (s[k + 1] - s[k] || 1); const p = b.pts[k]; const q = b.pts[k + 1];
        mid = [p[0] + (q[0] - p[0]) * u, p[1] + (q[1] - p[1]) * u];
        const d = Math.hypot(q[0] - p[0], q[1] - p[1]) || 1; t = [(q[0] - p[0]) / d, (q[1] - p[1]) / d];
        break;
      }
    }
    place(mid[0], mid[1], b.tags, { width: L, tangent: t });
  });
  for (const n of nodes) {
    if (!gateNear(n.x, n.y)) place(n.x, n.y, n.tags || {});
  }

  // a way through a line no gate was mapped on
  // (the ways sorted once and found by their boxes: every way's every segment
  // tried against every fence grew with the square of the map)
  const sortedWays = [...roadWays].sort((p, q) => p.walk - q.walk);
  const wayGrid = boxGrid(sortedWays.map((w) => boxOf(w.pts)));
  barriers.forEach((b, i) => {
    if (lines.has(i) || !ENCLOSING.has(String(b.tags?.barrier || '').toLowerCase())) return;
    const leafed = LEAFED.has(String(b.tags?.barrier || '').toLowerCase());
    for (const k of wayGrid.overlapping(boxOf(b.pts))) {
      const w = sortedWays[k];
      for (const c of crossings(b.pts, w.pts)) {
        if (gateNear(c.x, c.y)) continue;
        const width = w.walk ? walkedWidth(w) : drivenWidth(w) / Math.max(0.35, Math.abs(c.ta[0] * c.tb[1] - c.ta[1] * c.tb[0]));
        cutAt(i, c.sa, width);
        const gated = leafed && (w.walk || GATED_HIGHWAYS.has(w.highway));
        const wall = /wall/.test(b.tags?.barrier || '');
        gates.push({ x: c.x, y: c.y, along: c.ta, width, walk: w.walk, type: 'mapng:crossing', style: gated ? styleOf('gate', { walk: w.walk, chainLink: b.chainLink, wall }) : 'gap' });
      }
    }
  });
  return { cuts: cuts.map(mergeCuts), gates, lines };
}

function mergeCuts(list) {
  const sorted = list.slice().sort((a, b) => a[0] - b[0]); const out = [];
  for (const c of sorted) {
    const last = out[out.length - 1];
    if (last && c[0] <= last[1]) last[1] = Math.max(last[1], c[1]); else out.push(c.slice());
  }
  return out;
}

/** The stretches of `geometry` (any per-point records) left by cuts in stations along `pts`. lerp(a, b, u) makes a point between two. */
export function splitAtCuts(geometry, pts, cuts, lerp) {
  if (!cuts.length) return [geometry];
  const s = lengths(pts); const L = s[s.length - 1];
  const at = (d) => {
    for (let i = 0; i + 1 < s.length; i++) if (d <= s[i + 1]) return lerp(geometry[i], geometry[i + 1], (d - s[i]) / (s[i + 1] - s[i] || 1));
    return geometry[geometry.length - 1];
  };
  const out = []; let from = 0;
  const piece = (a, b) => {
    if (b - a < 0.5) return;
    const mid = []; for (let i = 0; i < s.length; i++) if (s[i] > a + 1e-3 && s[i] < b - 1e-3) mid.push(geometry[i]);
    out.push([at(a), ...mid, at(b)]);
  };
  for (const [c0, c1] of cuts) { if (c1 <= 0 || c0 >= L) continue; piece(from, c0); from = Math.max(from, c1); }
  piece(from, L);
  return out;
}

/**
 * Openings a generated wall leaves for the roads through it: gates (as planGates's)
 * on `line`. Roads reach a little past their ends: one stopping at the wall still
 * comes through it.
 */
export function wallOpenings(line, roads, { reach = 2, style = 'mesh' } = {}) {
  const out = [];
  const lb = boxOf(line);
  for (const w of roads || []) {
    if (!(w.pts?.length >= 2) || WALK_HIGHWAYS.has(w.highway)) continue;
    // (a road whose box, reach and all, misses the wall's crosses nothing)
    const wb = boxOf(w.pts);
    if (wb[0] - reach > lb[2] || wb[2] + reach < lb[0] || wb[1] - reach > lb[3] || wb[3] + reach < lb[1]) continue;
    const p = w.pts; const n = p.length;
    const past = (a, b) => { const L = Math.hypot(a[0] - b[0], a[1] - b[1]) || 1; return [a[0] + (a[0] - b[0]) / L * reach, a[1] + (a[1] - b[1]) / L * reach]; };
    for (const c of crossings(line, [past(p[0], p[1]), ...p, past(p[n - 1], p[n - 2])])) {
      if (out.some((g) => Math.hypot(g.x - c.x, g.y - c.y) < g.width / 2 + SAME_GATE_M)) continue;
      const width = drivenWidth(w) / Math.max(0.35, Math.abs(c.ta[0] * c.tb[1] - c.ta[1] * c.tb[0]));
      out.push({ x: c.x, y: c.y, along: c.ta, width, walk: false, type: 'mapng:crossing', style });
    }
  }
  return out;
}

/** What's left of the segment a-b outside the openings, as [u0, u1] fractions of it. */
export function clearOf(a, b, openings) {
  let spans = [[0, 1]];
  const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
  if (L < 1e-6) return spans;
  const u = [(b[0] - a[0]) / L, (b[1] - a[1]) / L];
  for (const g of openings) {
    const r = g.width / 2; const dx = g.x - a[0]; const dy = g.y - a[1];
    const m = dx * u[0] + dy * u[1]; const h2 = r * r - (dx * dx + dy * dy - m * m);
    if (h2 <= 0) continue;
    const h = Math.sqrt(h2); const c0 = (m - h) / L; const c1 = (m + h) / L;
    spans = spans.flatMap(([s0, s1]) => (c1 <= s0 || c0 >= s1 ? [[s0, s1]] : [...(c0 > s0 ? [[s0, c0]] : []), ...(c1 < s1 ? [[c1, s1]] : [])]));
  }
  return spans;
}

/**
 * What stands in one gate, swung clear of the way: [{ shapeName, x, y, yaw, scale, tip, z, level? }].
 * tip is the free end, so the leaf can follow the ground to it (level: it stays upright). free(x, y): nothing
 * stands there. prefer: the side (+1 / -1 of `along` turned left) to swing to first.
 */
export function gateLeaves(gate, free = () => true, { prefer = 1 } = {}) {
  const { along, width, style } = gate;
  if (style === 'gap') return [];
  const n = [-along[1], along[0]];
  const hinge = (sg) => [gate.x + along[0] * sg * width / 2, gate.y + along[1] * sg * width / 2];
  const at = (shape, h, dir, scaleX) => {
    const yaw = Math.atan2(dir[1], dir[0]); const len = shape.length * scaleX;
    const mid = shape.origin === 'middle';
    return { shapeName: shape.shapeName, x: h[0] + (mid ? dir[0] * len / 2 : 0), y: h[1] + (mid ? dir[1] * len / 2 : 0), yaw, scale: scaleX, tip: [h[0] + dir[0] * len, h[1] + dir[1] * len], z: shape.z };
  };
  if (style === 'boom' || style === 'boomLong') {
    const shape = width > 6 ? GATE_SHAPES.boomLong : GATE_SHAPES.boom;
    const h = hinge(-1);
    return [{ shapeName: shape.shapeName, x: h[0], y: h[1], yaw: Math.atan2(along[1], along[0]), scale: 1, tip: h, z: shape.z }];
  }
  if (style === 'sliding') {
    // parked behind the fence, past the opening (its origin is at its end)
    const shape = GATE_SHAPES.sliding; const scale = Math.max(0.6, Math.min(1, width / shape.length));
    const h = hinge(-1); const p = [h[0] + n[0] * 0.3 * prefer, h[1] + n[1] * 0.3 * prefer];
    return [{ shapeName: shape.shapeName, x: p[0], y: p[1], yaw: Math.atan2(along[1], along[0]), scale, tip: p, level: true, z: shape.z }];
  }
  const shape = style === 'wood' ? GATE_SHAPES.wood : style === 'farm' ? GATE_SHAPES.farm : GATE_SHAPES.mesh;
  const single = gate.walk || width <= shape.length * 1.25;
  const each = (single ? width : width / 2);
  const scale = style === 'smallMesh' ? Math.max(0.3, width / shape.length) : Math.max(0.6, Math.min(1.25, each / shape.length));
  const swing = (sg, side) => {
    // from the jamb at sg, back past square, away from the opening
    const c = Math.cos(OPEN_ANGLE); const a = Math.sin(OPEN_ANGLE);
    return [n[0] * side * a - along[0] * sg * c, n[1] * side * a - along[1] * sg * c];
  };
  const clear = (h, d, len) => [0.35, 0.7, 1].every((u) => free(h[0] + d[0] * len * u, h[1] + d[1] * len * u));
  const out = [];
  for (const sg of single ? [-1] : [-1, 1]) {
    const h = hinge(sg); const len = shape.length * scale;
    const dir = [swing(sg, prefer), swing(sg, -prefer), [along[0] * sg, along[1] * sg]].find((d) => clear(h, d, len));
    if (dir) out.push(at(shape, h, dir, scale));
  }
  return out;
}
