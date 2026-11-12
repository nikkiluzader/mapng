// Street props along the drawn roads: fire hydrants, trash bins, benches and
// wooden utility poles with their wires (after BeamNG.Earth server/furniture.py).
// Hydrants and bins only where OSM maps them (placed with the mapped street
// furniture, not here: generated every hundred metres along every sidewalk
// they were far too many); benches and distribution poles, which OSM maps
// few of, at real-world spacings, the mapped ones keeping generated ones of
// the same kind away.
//
// Works in world space on generateDecalRoads' carriageways (nodes [x, y, z, w],
// `half` = half the paved width) and buildSidewalkRuns' curb runs (points on the
// curb line, `side` the sidewalk's side, `width`). Deterministic: every spacing
// phase is hashed from the way id, so re-exports put props in the same places.

import { curbHeight } from './beamngSidewalks.js';
import { buildCarriagewayIndex, isOnCrossingCarriageway, isOnOtherCarriageway } from './roadMarkingCuts.js';
import { isLitRoad } from './streetLamps.js';

// Spacings (m) and offsets, BeamNG.Earth's (US practice).
const BENCH_SPACING_M = 140;
const BENCH_BACK_M = 0.45;         // from the back of the sidewalk
const END_CLEAR_M = 4;             // kept clear of a run's ends (corners, ramps)
const MAPPED_CLEAR_M = { hydrant: 60, bin: 45, bench: 70 };
// (sidewalk top over the road: beamngSidewalks.js curbHeight(), the Curb height choice)

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

// Utility poles: a variety of the game's own, by region and by what OSM says
// (material=steel|metal|concrete: the steel pole; height=*: the nearest),
// one model along a run so its wires meet the same fittings pole to pole.
// Each: its shape (beamngPropLibrary PROP_SHAPES), its top, where its wires
// hang ([x, y, z] in the model, its cross-arm along local x once turned by
// yawOffset) and where the cobra-head lamp goes (lampZ, or none).
// (Automation Test Track's s_powerpole_3wire, used before, names its
// collision mesh Collmesh_… which the game doesn't take: cars drove through
// it; each of these has a Colmesh)
export const POLE_TYPES = {
  // a classic wooden distribution pole, a wide cross-arm (Automation Test Track)
  wood_wide: { shape: 'poleWoodWide', top: 11.2, wires: [[-1.45, 0, 11.1], [0.55, 0, 11.1], [1.45, 0, 11.1]], lampZ: 8.6 },
  // a plain wooden town pole, one wire at the top (East Coast USA)
  wood_town: { shape: 'poleWoodTown', top: 10.1, wires: [[0, 0, 9.9]], lampZ: 8.4 },
  // a short wooden pole with a cross-arm and a pin on top (Johnson Valley)
  wood_short: { shape: 'poleWoodShort', top: 7.9, wires: [[-0.7, 0, 7.2], [0, 0, 7.8], [0.7, 0, 7.2]], lampZ: 6.0 },
  // a wooden pole with its arm low and a pin above (Johnson Valley; the arm's
  // wires from the foot of its hanging insulators)
  wood_arm: { shape: 'poleWoodArm', top: 10, wires: [[-0.72, 0, 7.5], [0.72, 0, 7.5], [-0.4, 0, 9.2]], lampZ: 6.4 },
  // a tall wooden pole, three insulators stacked up one side (West Coast USA)
  wood_tall: { shape: 'poleWoodTall', top: 13.5, wires: [[0, 0.75, 13.3], [0, 0.75, 12.57], [0, 0.75, 11.85]], yawOffset: Math.PI / 2, lampZ: 9.5 },
  // a steel mast, brackets stepping down one side (Johnson Valley)
  steel: { shape: 'poleSteel', top: 8.1, wires: [[0.25, 0.2, 6.7], [0.25, 0.2, 6.35], [0.25, 0.2, 6.0]], lampZ: 5.2 },
};
// [type, weight] by region
const POLE_SETS = {
  na_east: [['wood_wide', 0.5], ['wood_town', 0.3], ['wood_short', 0.2]],
  na_west: [['wood_arm', 0.35], ['wood_short', 0.25], ['wood_tall', 0.25], ['wood_wide', 0.15]],
  world: [['wood_short', 0.6], ['steel', 0.4]],
};
const STEEL_MATERIALS = new Set(['steel', 'metal', 'concrete', 'reinforced_concrete', 'iron']);

/**
 * The pole type for a run (or a lone pole): its tags first (a steel or
 * concrete one: the steel pole; a height: the regional pole nearest it), else
 * one of the region's own, by seed.
 */
export function choosePoleType({ lat = 0, lon = 0, tags = {}, seed = '' } = {}) {
  const set = lat > 24 && lon > -170 && lon < -50 ? (lon < -100 ? POLE_SETS.na_west : POLE_SETS.na_east) : POLE_SETS.world;
  if (STEEL_MATERIALS.has(String(tags.material || '').toLowerCase())) return 'steel';
  const height = Number.parseFloat(tags.height);
  if (Number.isFinite(height) && height > 3) {
    let best = set[0][0];
    for (const [type] of set) if (Math.abs(POLE_TYPES[type].top - height) < Math.abs(POLE_TYPES[best].top - height)) best = type;
    return best;
  }
  let u = hash01(seed, 'poletype');
  for (const [type, w] of set) { if (u < w) return type; u -= w; }
  return set[set.length - 1][0];
}

// a fitting's place in the world on pole p (its type's fittings, turned by its yaw)
function fittingAt(p, [fx, fy, fz]) {
  const t = POLE_TYPES[p.type] || POLE_TYPES.wood_wide;
  const yaw = p.yaw + (t.yawOffset || 0);
  return [p.x + Math.cos(yaw) * fx - Math.sin(yaw) * fy, p.y + Math.sin(yaw) * fx + Math.cos(yaw) * fy, p.z + fz];
}
const WIRE_SAG = 0.012;            // per metre of span
const WIRE_MIN_SPAN_M = 5;
const WIRE_MAX_SPAN_M = 120;
// electrical_pole_lamp: its arm reaches 2.9 m along local -x (mounted at its
// pole type's lampZ).
export const POLE_LAMP_REACH_M = 2.8;

const MAX_POLES = 8000;   // the default; exportBeamNGLevel passes its caps' (SAFE_CAPS.poles)

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
          if (d < bestD && d <= w + 0.5) { bestD = d; best = pz + curbHeight(); }
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
    // (one type along a run: fitting k of one pole to fitting k of the next)
    const fits = (POLE_TYPES[a.type] || POLE_TYPES.wood_wide).wires;
    const fitsB = (POLE_TYPES[b.type] || POLE_TYPES.wood_wide).wires;
    for (let k = 0; k < Math.min(fits.length, fitsB.length); k++) {
      const [ax, ay, az] = fittingAt(a, fits[k]);
      const [bx, by, bz] = fittingAt(b, fitsB[k]);
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
 *   countryPoles: pole lines added along country roads (roadsidePolesRegion; mapped ones always)
 *   isBlocked(x, y, z, zTop): no pole there (under a bridge deck)
 *   lat, lon: the export's place (the region's poles, choosePoleType)
 * Returns { hydrants, bins, benches: [{ x, y, z, yaw }], poles: [{ x, y, z, yaw, lamp, type }], wires }.
 */
/**
 * Whether pole lines along country roads are the norm here (wooden poles and
 * wires beside most rural roads): North America, Japan, Australia and New
 * Zealand. Elsewhere, Europe above all, distribution lines are buried or
 * cross the fields, and a pole line added along every country road is wrong
 * far more often than right (Normandy: 48 poles on a kilometre of lanes that
 * have none). Poles and lines OSM maps are built everywhere.
 */
export function roadsidePolesRegion(lat, lon) {
  if (lat > 24 && lon > -170 && lon < -50) return true;            // North America
  if (lat > 24 && lat < 46 && lon > 123 && lon < 146) return true;  // Japan
  if (lat < -10 && lat > -48 && lon > 112) return true;             // Australia, New Zealand
  return false;
}

export function placeStreetProps({ carriageways = [], runs = [], mapped = {}, heightAt = () => 0, townPoles = false, countryPoles = true, isBlocked = () => false, lat = 0, lon = 0, maxPoles = MAX_POLES } = {}) {
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

  // ── On the sidewalks: benches (major streets)
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
        list.push({ x, y, z: st.z + curbHeight(), yaw: yawFn(out, x, y) });
      }
    };
    // (benches stand on a sidewalk, not behind a bare curb)
    if (run.width > 0.5 && MAJOR.has(String(cw.highway ?? '').replace(/_link$/, ''))) {
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
    const type = choosePoleType({ lat, lon, tags: line.tags || {}, seed: `line:${line.id ?? line[0]?.join(',')}` });
    for (let i = 0; i < line.length && poles.length < maxPoles; i++) {
      const a = line[Math.max(0, i - 1)];
      const b = line[Math.min(line.length - 1, i + 1)];
      const along = Math.atan2(b[1] - a[1], b[0] - a[0]);
      const [x, y, z] = line[i];
      const pole = { x, y, z: z ?? heightAt(x, y), yaw: along + Math.PI / 2, lamp: false, type };
      poles.push(pole);
      run.push(pole);
    }
    wires.push(...wireLines(run));
  }
  const poleTaken = new Taken();
  for (const p of poles) poleTaken.add(p.x, p.y);
  for (const mp of mapped.poles || []) {
    const [x, y, z] = mp;
    if (poleTaken.near(x, y, 1.5) || poles.length >= maxPoles) continue;
    const type = choosePoleType({ lat, lon, tags: mp.tags || {}, seed: `pole:${mp.id ?? `${x},${y}`}` });
    if (isBlocked(x, y, z ?? heightAt(x, y), (z ?? heightAt(x, y)) + POLE_TYPES[type].top)) continue;
    poles.push({ x, y, z: z ?? heightAt(x, y), yaw: 0, lamp: false, type });
    poleTaken.add(x, y);
  }

  // Generated poles follow a street through its junctions (a chain of the
  // segments it is drawn as), so the wires run along it; a station on a
  // junction or another road is skipped and the wire spans over it.
  const eligible = (cw) => {
    const cls = String(cw.highway ?? '').replace(/_link$/, '');
    // Town: unlit streets only (lit ones have street lamps), and only where
    // wooden poles with cobra heads are the look (North America).
    return cw.urban ? townPoles && TOWN_POLE_CLASSES.has(cls) && !isLitRoad(cw) : countryPoles && POLE_CLASSES.has(cls);
  };
  for (const chain of buildChains(carriageways.filter(eligible))) {
    if (poles.length >= maxPoles) break;
    const town = chain.segments[0].urban;
    const id = chain.id;
    const side = hash01(id, 'pside') < 0.5 ? 1 : -1;
    const spacing = town ? TOWN_POLE_SPACING_M : POLE_SPACING_M;
    const type = choosePoleType({ lat, lon, seed: `chain:${id}` });
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
      if (isBlocked(x, y, z, z + POLE_TYPES[type].top)) continue;
      // Cross-arm (local x) across the road, pointing away from it: the lamp's
      // arm (local -x) then reaches over the road.
      const pole = { x, y, z, yaw: Math.atan2(out[1], out[0]), lamp: cw.urban && st.k % 2 === 0 && POLE_TYPES[type].lampZ != null, type };
      poles.push(pole);
      poleTaken.add(x, y);
      run.push(pole);
      if (poles.length >= maxPoles) break;
    }
    // wireLines leaves out spans too long to be one (a stretch with no poles).
    wires.push(...wireLines(run));
  }

  return { hydrants, bins, benches, poles, wires };
}
