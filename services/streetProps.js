// Street props along the drawn roads: fire hydrants, trash bins, benches and
// wooden utility poles with their wires (after BeamNG.Earth server/furniture.py).
// OSM maps few hydrants, bins or distribution poles, so the streets get them at
// real-world spacings; mapped ones are used where they exist and keep the
// generated ones of the same kind away.
//
// Works in world space on generateDecalRoads' carriageways (nodes [x, y, z, w],
// `half` = half the paved width) and buildSidewalkRuns' curb runs (points on the
// curb line, `side` the sidewalk's side, `width`). Deterministic: every spacing
// phase is hashed from the way id, so re-exports put props in the same places.

import { buildCarriagewayIndex, isOnCrossingCarriageway, isOnOtherCarriageway } from './roadMarkingCuts.js';
import { isLitRoad } from './streetLamps.js';

// Spacings (m) and offsets, BeamNG.Earth's (US practice).
const HYDRANT_SPACING_M = 120;
const BIN_SPACING_M = 90;
const BENCH_SPACING_M = 140;
const HYDRANT_CURB_M = 0.45;       // from the curb onto the sidewalk
const BIN_CURB_M = 0.7;
const BENCH_BACK_M = 0.45;         // from the back of the sidewalk
const END_CLEAR_M = 4;             // kept clear of a run's ends (corners, ramps)
const MAPPED_CLEAR_M = { hydrant: 60, bin: 45, bench: 70 };
const CURB_H = 0.15;               // sidewalk top over the road (beamngSidewalks.js)

const POLE_SPACING_M = 45;         // country roads
const TOWN_POLE_SPACING_M = 40;
const POLE_OFFSET_M = 2.4;         // beyond the carriageway edge in the country
const TOWN_POLE_OFFSET_M = 0.8;    // beyond the curb in town (the sidewalk's edge)
const POLE_CLASSES = new Set(['secondary', 'tertiary', 'residential', 'unclassified']);
const TOWN_POLE_CLASSES = new Set(['residential', 'tertiary', 'unclassified', 'secondary', 'living_street', 'primary', 'trunk']);
const MAJOR = new Set(['trunk', 'primary', 'secondary', 'tertiary']);
const JUNCTION_CLEAR_M = 10;
const ROAD_CLEAR_M = 1.5;
const MAPPED_LINE_CLEAR_M = 12;    // a mapped power line this close: no generated poles

// s_powerpole_3wire: cross-arm along its local x, wires at these x offsets and
// this height above the pole's base (the model's top is 8.2 m).
export const WIRE_ARMS = [-0.8, 0, 0.8];
export const WIRE_Z = 7.9;
const WIRE_SAG = 0.012;            // per metre of span
const WIRE_MIN_SPAN_M = 5;
const WIRE_MAX_SPAN_M = 120;
// electrical_pole_lamp: its arm reaches 2.9 m along local -x, mounted this high.
export const POLE_LAMP_Z = 7.0;
export const POLE_LAMP_REACH_M = 2.8;

const MAX_POLES = 8000;

const BUCKET_M = 8;

export function hash01(...parts) {
  let h = 2166136261;
  const s = parts.join('|');
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  h ^= h >>> 13;
  h = Math.imul(h, 0x5bd1e995);
  h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
}

// Points kept apart per kind: a grid of what is already placed.
const TAKEN_CELL_M = 16;
class Taken {
  constructor() { this.cells = new Map(); }
  add(x, y) {
    const k = `${Math.floor(x / TAKEN_CELL_M)},${Math.floor(y / TAKEN_CELL_M)}`;
    if (!this.cells.has(k)) this.cells.set(k, []);
    this.cells.get(k).push([x, y]);
  }
  near(x, y, r) {
    const cx = Math.floor(x / TAKEN_CELL_M);
    const cy = Math.floor(y / TAKEN_CELL_M);
    const reach = Math.ceil(r / TAKEN_CELL_M);
    for (let dx = -reach; dx <= reach; dx++) {
      for (let dy = -reach; dy <= reach; dy++) {
        for (const [px, py] of this.cells.get(`${cx + dx},${cy + dy}`) || []) {
          if (Math.hypot(px - x, py - y) < r) return true;
        }
      }
    }
    return false;
  }
}

// Stations every `spacing` m along a polyline from `phase`, `clear` m off its
// ends: [{ x, y, z, dir: [dx, dy], k, i }] (i: the point the station follows).
function stations(points, spacing, phase, clear) {
  const out = [];
  let travelled = 0;
  let total = 0;
  for (let i = 0; i + 1 < points.length; i++) total += Math.hypot(points[i + 1][0] - points[i][0], points[i + 1][1] - points[i][1]);
  let next = phase;
  let k = 0;
  for (let i = 0; i + 1 < points.length; i++) {
    const a = points[i];
    const b = points[i + 1];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (len < 1e-6) continue;
    while (next <= travelled + len) {
      const t = (next - travelled) / len;
      if (next >= clear && next <= total - clear) {
        out.push({
          x: a[0] + (b[0] - a[0]) * t,
          y: a[1] + (b[1] - a[1]) * t,
          z: (a[2] ?? 0) + ((b[2] ?? 0) - (a[2] ?? 0)) * t,
          dir: [(b[0] - a[0]) / len, (b[1] - a[1]) / len],
          k,
          i,
        });
      }
      next += spacing;
      k++;
    }
    travelled += len;
  }
  return out;
}

// Distance from (x, y) to the nearest mapped power-line segment, bucketed.
function lineIndex(lines) {
  const cells = new Map();
  const R = 32;
  for (const line of lines) {
    for (let i = 0; i + 1 < line.length; i++) {
      const [ax, ay] = line[i];
      const [bx, by] = line[i + 1];
      const minX = Math.floor(Math.min(ax, bx) / R); const maxX = Math.floor(Math.max(ax, bx) / R);
      const minY = Math.floor(Math.min(ay, by) / R); const maxY = Math.floor(Math.max(ay, by) / R);
      for (let cx = minX; cx <= maxX; cx++) {
        for (let cy = minY; cy <= maxY; cy++) {
          const key = `${cx},${cy}`;
          if (!cells.has(key)) cells.set(key, []);
          cells.get(key).push([ax, ay, bx, by]);
        }
      }
    }
  }
  return (x, y, r) => {
    const cx = Math.floor(x / R);
    const cy = Math.floor(y / R);
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        for (const [ax, ay, bx, by] of cells.get(`${cx + dx},${cy + dy}`) || []) {
          const vx = bx - ax; const vy = by - ay;
          const L2 = vx * vx + vy * vy || 1e-9;
          const t = Math.max(0, Math.min(1, ((x - ax) * vx + (y - ay) * vy) / L2));
          if (Math.hypot(ax + vx * t - x, ay + vy * t - y) < r) return true;
        }
      }
    }
    return false;
  };
}

// Sidewalk-top height near (x, y) from the curb runs, or null off the sidewalks.
export function sidewalkHeightLookup(runs) {
  const cells = new Map();
  for (const run of runs) {
    for (const p of run.points) {
      const key = `${Math.floor(p[0] / BUCKET_M)},${Math.floor(p[1] / BUCKET_M)}`;
      if (!cells.has(key)) cells.set(key, []);
      cells.get(key).push([p[0], p[1], p[2], run.width]);
    }
  }
  return (x, y) => {
    let best = null;
    let bestD = Infinity;
    const cx = Math.floor(x / BUCKET_M);
    const cy = Math.floor(y / BUCKET_M);
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        for (const [px, py, pz, w] of cells.get(`${cx + dx},${cy + dy}`) || []) {
          const d = Math.hypot(px - x, py - y);
          if (d < bestD && d <= w + 0.5) { bestD = d; best = pz + CURB_H; }
        }
      }
    }
    return best;
  };
}

/**
 * Wire polylines (each [[x, y, z]...]) for consecutive poles of one run
 * [{ x, y, z, yaw }]: three wires per span from the cross-arm, sagging.
 */
export function wireLines(poles) {
  const out = [];
  for (let i = 0; i + 1 < poles.length; i++) {
    const a = poles[i];
    const b = poles[i + 1];
    const span = Math.hypot(b.x - a.x, b.y - a.y);
    if (span < WIRE_MIN_SPAN_M || span > WIRE_MAX_SPAN_M) continue;
    const segs = Math.max(2, Math.ceil(span / 12));
    for (const off of WIRE_ARMS) {
      const ax = a.x + Math.cos(a.yaw) * off; const ay = a.y + Math.sin(a.yaw) * off; const az = a.z + WIRE_Z;
      const bx = b.x + Math.cos(b.yaw) * off; const by = b.y + Math.sin(b.yaw) * off; const bz = b.z + WIRE_Z;
      const line = [];
      for (let s = 0; s <= segs; s++) {
        const t = s / segs;
        line.push([ax + (bx - ax) * t, ay + (by - ay) * t, az + (bz - az) * t - 4 * WIRE_SAG * span * t * (1 - t)]);
      }
      out.push(line);
    }
  }
  return out;
}

const CHAIN_GAP_M = 30;     // a street picks up again this close across a junction
const STRAIGHT_COS = Math.cos((25 * Math.PI) / 180);

/**
 * Streets as chains of carriageway segments: a segment joins the one it plainly
 * continues into, the same OSM way picking up again across a junction, or the
 * segment carrying straight on across one.
 * Returns [{ id, segments, points: [[x, y, z, segment index]...] }] in order.
 */
export function buildChains(carriageways) {
  const parent = new Map(carriageways.map((cw) => [cw.owner, cw.owner]));
  const find = (o) => { while (parent.get(o) !== o) { parent.set(o, parent.get(parent.get(o))); o = parent.get(o); } return o; };
  const join = (a, b) => { if (parent.has(a) && parent.has(b)) parent.set(find(a), find(b)); };
  const ends = (cw) => [cw.nodes[0], cw.nodes[cw.nodes.length - 1]];
  const gap = (p, q) => Math.hypot(p[0] - q[0], p[1] - q[1]);
  for (const cw of carriageways) for (const o of cw.continuations || []) join(cw.owner, o);
  const byWay = new Map();
  for (const cw of carriageways) {
    if (cw.wayId == null) continue;
    if (!byWay.has(cw.wayId)) byWay.set(cw.wayId, []);
    byWay.get(cw.wayId).push(cw);
  }
  for (const group of byWay.values()) {
    for (let i = 0; i < group.length; i++) {
      for (let j = i + 1; j < group.length; j++) {
        if (ends(group[i]).some((p) => ends(group[j]).some((q) => gap(p, q) < CHAIN_GAP_M))) join(group[i].owner, group[j].owner);
      }
    }
  }
  // OSM often splits a street into separate ways at junctions: a segment also
  // joins the one carrying straight on across one (ends close, heading within
  // STRAIGHT_COS, the same name when both are named). Side streets meet at an
  // angle and stay apart.
  const tip = (cw, atEnd) => {
    const n = cw.nodes;
    const [a, b] = atEnd ? [n[Math.max(0, n.length - 4)], n[n.length - 1]] : [n[Math.min(n.length - 1, 3)], n[0]];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
    return { p: b, out: [(b[0] - a[0]) / len, (b[1] - a[1]) / len], cw };
  };
  const cells = new Map();
  const cellOf = (p) => `${Math.floor(p[0] / CHAIN_GAP_M)},${Math.floor(p[1] / CHAIN_GAP_M)}`;
  const tips = carriageways.flatMap((cw) => [tip(cw, false), tip(cw, true)]);
  for (const t of tips) {
    const k = cellOf(t.p);
    if (!cells.has(k)) cells.set(k, []);
    cells.get(k).push(t);
  }
  for (const t of tips) {
    const [cx, cy] = cellOf(t.p).split(',').map(Number);
    let best = null;
    let bestScore = Infinity;
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        for (const u of cells.get(`${cx + dx},${cy + dy}`) || []) {
          if (u.cw === t.cw) continue;
          const d = gap(t.p, u.p);
          // tips face each other: one leaves where the other arrives
          const straight = -(t.out[0] * u.out[0] + t.out[1] * u.out[1]);
          if (d >= CHAIN_GAP_M || straight < STRAIGHT_COS) continue;
          const [na, nb] = [t.cw.tags?.name, u.cw.tags?.name];
          if (na && nb && na !== nb) continue;
          const score = d + (1 - straight) * 100;
          if (score < bestScore) { bestScore = score; best = u; }
        }
      }
    }
    if (best) join(t.cw.owner, best.cw.owner);
  }
  const groups = new Map();
  for (const cw of carriageways) {
    const r = find(cw.owner);
    if (!groups.has(r)) groups.set(r, []);
    groups.get(r).push(cw);
  }
  const chains = [];
  for (const members of groups.values()) {
    const left = new Set(members);
    while (left.size) {
      // Start at a segment whose start nothing else leads into.
      const first = [...left].find((cw) => ![...left].some((o) => o !== cw && ends(o).some((q) => gap(cw.nodes[0], q) < CHAIN_GAP_M)))
        ?? [...left][0];
      const segments = [];
      const points = [];
      let cur = first;
      let nodes = cur.nodes;
      while (cur) {
        left.delete(cur);
        const si = segments.push(cur) - 1;
        for (const n of nodes) points.push([n[0], n[1], n[2], si]);
        const tail = nodes[nodes.length - 1];
        let next = null;
        let best = CHAIN_GAP_M;
        for (const o of left) {
          const [s0, s1] = ends(o);
          if (gap(tail, s0) < best) { best = gap(tail, s0); next = { cw: o, nodes: o.nodes }; }
          if (gap(tail, s1) < best) { best = gap(tail, s1); next = { cw: o, nodes: [...o.nodes].reverse() }; }
        }
        cur = next?.cw ?? null;
        nodes = next?.nodes;
      }
      const ids = segments.map((cw) => String(cw.wayId ?? cw.owner)).sort();
      chains.push({ id: ids[0], segments, points });
    }
  }
  return chains;
}

/**
 * Props for the drawn roads.
 *   carriageways: generateDecalRoads' carriageways
 *   runs: buildSidewalkRuns' curb runs (with owner / highway / urban / wayId)
 *   mapped: { hydrants, bins, benches: [[x, y]], powerLines: [[[x, y, z]...]], poles: [[x, y, z]] }
 *   heightAt(x, y): terrain height
 *   townPoles: wooden poles with cobra-head lamps along unlit town streets (North America)
 * Returns { hydrants, bins, benches: [{ x, y, z, yaw }], poles: [{ x, y, z, yaw, lamp }], wires }.
 */
export function placeStreetProps({ carriageways = [], runs = [], mapped = {}, heightAt = () => 0, townPoles = false } = {}) {
  const index = buildCarriagewayIndex(carriageways);
  const byOwner = new Map(carriageways.map((cw) => [cw.owner, cw]));
  const swZ = sidewalkHeightLookup(runs);
  const hydrants = [];
  const bins = [];
  const benches = [];
  const taken = { hydrant: new Taken(), bin: new Taken(), bench: new Taken() };
  for (const [x, y] of mapped.hydrants || []) taken.hydrant.add(x, y);
  for (const [x, y] of mapped.bins || []) taken.bin.add(x, y);
  for (const [x, y] of mapped.benches || []) taken.bench.add(x, y);

  // ── On the sidewalks: hydrants (all town streets), bins and benches (major ones)
  for (const run of runs) {
    const cw = byOwner.get(run.owner);
    if (!cw?.urban) continue;
    const id = cw.wayId ?? cw.owner;
    const put = (list, kind, spacing, phase, offset, yawFn) => {
      for (const st of stations(run.points, spacing, phase, END_CLEAR_M)) {
        const out = [-st.dir[1] * run.side, st.dir[0] * run.side];   // toward the sidewalk
        const x = st.x + out[0] * offset;
        const y = st.y + out[1] * offset;
        if (taken[kind].near(x, y, MAPPED_CLEAR_M[kind])) continue;
        list.push({ x, y, z: st.z + CURB_H, yaw: yawFn(out, x, y) });
      }
    };
    put(hydrants, 'hydrant', HYDRANT_SPACING_M,
      hash01(id, 'hyd') * HYDRANT_SPACING_M + (run.side < 0 ? HYDRANT_SPACING_M / 2 : 0),
      HYDRANT_CURB_M, (o, x, y) => hash01(x.toFixed(1), y.toFixed(1)) * Math.PI * 2);
    if (MAJOR.has(String(cw.highway ?? '').replace(/_link$/, ''))) {
      put(bins, 'bin', BIN_SPACING_M, hash01(id, run.side, 'bin') * BIN_SPACING_M, BIN_CURB_M,
        (o) => Math.atan2(-o[1], -o[0]));
      // Benches at the back of the sidewalk, facing the street.
      put(benches, 'bench', BENCH_SPACING_M, hash01(id, run.side, 'bench') * BENCH_SPACING_M,
        Math.max(0.6, run.width - BENCH_BACK_M), (o) => Math.atan2(-o[1], -o[0]));
    }
  }

  // ── Utility poles
  const poles = [];
  const wires = [];
  const nearMappedLine = lineIndex(mapped.powerLines || []);
  // Mapped low-voltage lines: a pole at every vertex, cross-arm across the line.
  for (const line of mapped.powerLines || []) {
    const run = [];
    for (let i = 0; i < line.length && poles.length < MAX_POLES; i++) {
      const a = line[Math.max(0, i - 1)];
      const b = line[Math.min(line.length - 1, i + 1)];
      const along = Math.atan2(b[1] - a[1], b[0] - a[0]);
      const [x, y, z] = line[i];
      const pole = { x, y, z: z ?? heightAt(x, y), yaw: along + Math.PI / 2, lamp: false };
      poles.push(pole);
      run.push(pole);
    }
    wires.push(...wireLines(run));
  }
  const poleTaken = new Taken();
  for (const p of poles) poleTaken.add(p.x, p.y);
  for (const [x, y, z] of mapped.poles || []) {
    if (poleTaken.near(x, y, 1.5) || poles.length >= MAX_POLES) continue;
    poles.push({ x, y, z: z ?? heightAt(x, y), yaw: 0, lamp: false });
    poleTaken.add(x, y);
  }

  // Generated poles follow a street through its junctions (a chain of the
  // segments it is drawn as), so the wires run along it; a station on a
  // junction or another road is skipped and the wire spans over it.
  const eligible = (cw) => {
    const cls = String(cw.highway ?? '').replace(/_link$/, '');
    // Town: unlit streets only (lit ones have street lamps), and only where
    // wooden poles with cobra heads are the look (North America).
    return cw.urban ? townPoles && TOWN_POLE_CLASSES.has(cls) && !isLitRoad(cw) : POLE_CLASSES.has(cls);
  };
  for (const chain of buildChains(carriageways.filter(eligible))) {
    if (poles.length >= MAX_POLES) break;
    const town = chain.segments[0].urban;
    const id = chain.id;
    const side = hash01(id, 'pside') < 0.5 ? 1 : -1;
    const spacing = town ? TOWN_POLE_SPACING_M : POLE_SPACING_M;
    const ignore = new Set(chain.segments.map((cw) => cw.owner));
    const run = [];
    for (const st of stations(chain.points, spacing, hash01(id, 'pphase') * spacing, END_CLEAR_M)) {
      const cw = chain.segments[chain.points[st.i][3]];
      const out = [-st.dir[1] * side, st.dir[0] * side];
      const offset = cw.half + (cw.urban ? TOWN_POLE_OFFSET_M : POLE_OFFSET_M);
      const x = st.x + out[0] * offset;
      const y = st.y + out[1] * offset;
      if (isOnCrossingCarriageway(index, st.x, st.y, JUNCTION_CLEAR_M, st.dir)
        || isOnOtherCarriageway(index, x, y, ROAD_CLEAR_M, (o) => ignore.has(o))
        || nearMappedLine(x, y, MAPPED_LINE_CLEAR_M)
        || poleTaken.near(x, y, spacing * 0.5)) continue;
      const z = (cw.urban ? swZ(x, y) : null) ?? heightAt(x, y);
      // Cross-arm (local x) across the road, pointing away from it: the lamp's
      // arm (local -x) then reaches over the road.
      const pole = { x, y, z, yaw: Math.atan2(out[1], out[0]), lamp: cw.urban && st.k % 2 === 0 };
      poles.push(pole);
      poleTaken.add(x, y);
      run.push(pole);
      if (poles.length >= MAX_POLES) break;
    }
    // wireLines leaves out spans too long to be one (a stretch with no poles).
    wires.push(...wireLines(run));
  }

  return { hydrants, bins, benches, poles, wires };
}
