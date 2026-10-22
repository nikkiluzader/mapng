// Raised sidewalks with curbs (plan R5), the way West Coast USA and
// BeamNG.Earth build them: no MeshRoads, but a curb-and-slab profile swept
// along each sidewalk run into one mesh per batch, textured from the shared
// `curbs` trim sheet (light band = curb top/nose, dark = face) and the
// `sidewalk1` slab sheet, colliding with its visible geometry.
//
// Runs follow the drawn carriageway's edge (generateDecalRoads exposes the
// carriageways) and are cut where they would cross another road or a
// crosswalk. A street's sidewalks are decided along the whole street, not per
// OSM way (an untagged piece takes them from the tagged pieces it continues).
// Where two sidewalks meet at a junction corner they are joined by a curb
// return (BeamNG.Earth's server/junctions.py: an arc tangent to both curb
// lines, a slab out to where the sidewalks' outer edges meet); every other
// end comes down to the road in a curb ramp. Profile numbers are
// BeamNG.Earth's (server/sidewalks.py), measured on official US curbs.

import * as THREE from 'three';
import { buildCarriagewayIndex, cutNodes, isInZone, isOnOtherCarriageway } from './roadMarkingCuts.js';
import { isOneWayRoad } from './roadWidth.js';

const CURB_H = 0.15;          // m above the road
const SINK = 0.10;            // m the faces reach below the road
const BATTER = 0.02;          // m the face leans back over its height
const NOSE = 0.025;           // bevelled nose: down from the top ...
const NOSE_W = 0.045;         // ... and in from the face
const CURB_W = 0.15;          // m of curb top band
const CROSS_SLOPE = 0.015;    // slab rises away from the road
const BACK_SLOPE_RUN = 2.0;   // back falls to the ground at 1:2, no wheel-catching ledge
const CURB_REPEAT_M = 9.0;    // m of curb per texture width
const SLAB_REPEAT_M = 45.0;   // m of sidewalk per texture width
const DEFAULT_WIDTH_M = 2.0;
const MAX_WIDTH_M = 6.0;
const CUT_MARGIN_M = 0.5;     // runs stop this far outside other carriageways
const MIN_RUN_M = 8;
const RAMP_M = 1.8;           // a loose end's curb ramp: down to the road over this (1:12)
// Curb return radius by the larger road's class (BeamNG.Earth's survey of
// city corners), tried smaller until the corner clears every carriageway.
const CORNER_RADII = { residential: 3, living_street: 3, unclassified: 3, service: 3, tertiary: 4.5, secondary: 6, primary: 6, trunk: 8 };
const CORNER_RADIUS = 5;
const CORNER_TRIES = [1, 0.5, 0.25];
const CORNER_REACH_M = 15;    // how far past a run's end its corner may lie
const CORNER_ANGLES = [30, 150];  // degrees between the two curb lines for a corner
const RUNS_PER_MESH = 300;

// Divided roads' medians (BeamNG.Earth server/roads.py dual_carriageways,
// median_width, extras): two one-way carriageways of one street (name or
// ref) and class, side by side DUAL_GAP_M apart (centre lines) and parallel
// within DUAL_ANGLE_DEG. The ground between them is a median when it is
// MEDIAN_MIN_M..MEDIAN_MAX_M wide; up to MEDIAN_SLAB_M each carriageway builds
// a curbed slab out to the middle (one raised island between them), wider a
// MEDIAN_CURB_W curb along each with the ground between. Decided point by
// point, so a median starts and ends where the carriageways part and meet.
const DUAL_CLASSES = new Set(['motorway', 'trunk', 'primary', 'secondary', 'tertiary']);
const DUAL_GAP_M = [4, 45];
const DUAL_ANGLE_COS = Math.cos((25 * Math.PI) / 180);
const MEDIAN_MIN_M = 0.8;
const MEDIAN_MAX_M = 16;
const MEDIAN_SLAB_M = 6;
const MEDIAN_CURB_W = 0.6;
const MEDIAN_MIN_RUN_M = 20;
const MEDIAN_SIDE_SHARE = 0.3;   // a carriageway whose side faces a median this much of its length: no sidewalk there

// curbs sheet (1024 × 512, 8 bands of 64 px, v up): band 0, light rows 0–40.
const V_BAND_TOP = 1 - 1 / 512;
const V_LIGHT_LOW = 1 - 40 / 512;
const V_BAND_LOW = 1 - 63 / 512;
// sidewalk1 sheet: its top strip across the slab.
const V_SLAB_IN = 1 - 0.195;
const V_SLAB_OUT = 1 - 0.005;

export const SIDEWALK_MATERIALS = { curb: 'mapng_curbs', slab: 'mapng_sidewalk' };

/** Material definitions (shared /assets textures; West Coast USA's settings). */
export function getSidewalkMaterialDefs() {
  const CURBS = '/assets/materials/trim/concrete/curbs';
  const SLAB = '/assets/materials/tileable/concrete/sidewalk1';
  const def = (name, stage) => ({
    name, mapTo: name, class: 'Material', version: 1.5, annotation: 'SIDEWALK',
    groundType: 'CONCRETE', Stages: [stage, {}, {}, {}], translucentBlendOp: 'None',
  });
  return {
    [SIDEWALK_MATERIALS.curb]: def(SIDEWALK_MATERIALS.curb, {
      ambientOcclusionMap: `${CURBS}/t_curbs_ao.data.png`,
      baseColorMap: `${CURBS}/t_curbs_b.color.png`,
      normalMap: `${CURBS}/t_curbs_nm.normal.png`,
      roughnessMap: `${CURBS}/t_curbs_r.data.png`,
      pixelSpecular: true,
    }),
    [SIDEWALK_MATERIALS.slab]: def(SIDEWALK_MATERIALS.slab, {
      ambientOcclusionMap: `${SLAB}/t_sidewalk1_ao.data.png`,
      baseColorFactor: [0.745, 0.745, 0.745, 1],
      baseColorMap: `${SLAB}/t_sidewalk1_b.color.png`,
      metallicFactor: 0.7,
      metallicMap: `${SLAB}/t_sidewalk1_m.data.png`,
      normalMap: `${SLAB}/t_sidewalk1_nm.normal.png`,
      normalMapStrength: 1.2,
      roughnessMap: `${SLAB}/t_sidewalk1_r.data.png`,
      pixelSpecular: true,
    }),
  };
}

const norm = (value) => String(value ?? '').trim().toLowerCase();
const SIDEWALK_CLASSES = new Set(['residential', 'tertiary', 'secondary', 'primary', 'unclassified', 'living_street']);
const PRESENT = new Set(['yes', 'both', 'left', 'right']);
const ABSENT = new Set(['no', 'none', 'separate']);

const parseWidth = (value) => {
  const w = Number.parseFloat(value);
  return Number.isFinite(w) && w > 0.5 ? Math.min(w, MAX_WIDTH_M) : null;
};

/**
 * Sidewalk width on each side of a carriageway (left/right of node order),
 * 0 for none. OSM sidewalk tags first; untagged urban streets of the usual
 * classes get both sides (BeamNG.Earth). `separate` means it is mapped as its
 * own footway (drawn on the terrain), so no raised sidewalk here.
 */
export function sidewalkSides({ tags = {}, highway, urban }) {
  const width = (side) => parseWidth(tags[`sidewalk:${side}:width`]) ?? parseWidth(tags['sidewalk:both:width'])
    ?? parseWidth(tags['sidewalk:width']) ?? DEFAULT_WIDTH_M;
  const general = norm(tags.sidewalk);
  const both = norm(tags['sidewalk:both']);
  const sideTag = (side) => norm(tags[`sidewalk:${side}`]);
  const has = (side) => {
    const own = sideTag(side);
    if (PRESENT.has(own)) return true;
    if (ABSENT.has(own)) return false;
    if (PRESENT.has(both)) return true;
    if (ABSENT.has(both)) return false;
    if (general === 'both' || general === 'yes') return true;
    if (general === side) return true;
    if (general === 'left' || general === 'right' || ABSENT.has(general)) return false;
    return !!urban && SIDEWALK_CLASSES.has(String(highway ?? ''));
  };
  return { left: has('left') ? width('left') : 0, right: has('right') ? width('right') : 0 };
}

// Curb line `offset` m to the left of the centreline (mitred, z kept).
function offsetLine(nodes, offset) {
  const out = [];
  for (let i = 0; i < nodes.length; i++) {
    const a = nodes[Math.max(0, i - 1)];
    const b = nodes[Math.min(nodes.length - 1, i + 1)];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
    out.push([nodes[i][0] - ((b[1] - a[1]) / len) * offset, nodes[i][1] + ((b[0] - a[0]) / len) * offset, nodes[i][2], 0]);
  }
  return out;
}

const hasSidewalkTags = (tags = {}) => Object.keys(tags).some((k) => k === 'sidewalk' || k.startsWith('sidewalk:'));

/**
 * Each carriageway's sidewalk sides, decided along the street: a carriageway
 * with no sidewalk tags of its own takes them from the tagged carriageways it
 * plainly continues (same name; left and right swapped where it runs the
 * other way), carried on along the street. OSM often tags only some ways of
 * a street, which left sidewalks stopping mid-block and short stubs.
 */
export function streetSides(carriageways) {
  const sides = new Map(carriageways.map((cw) => [cw, sidewalkSides(cw)]));
  const known = new Set(carriageways.filter((cw) => hasSidewalkTags(cw.tags)));
  const near = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]) < 1;
  const ends = (cw) => [cw.nodes[0], cw.nodes[cw.nodes.length - 1]];
  const sameStreet = (a, b) => (a.owner === b.owner || (a.continuations || []).includes(b.owner) || (b.continuations || []).includes(a.owner))
    && String(a.tags?.name ?? '') === String(b.tags?.name ?? '');
  let queue = [...known];
  while (queue.length) {
    const next = [];
    for (const from of queue) {
      const [fs, fe] = ends(from);
      for (const cw of carriageways) {
        if (known.has(cw) || !cw.nodes?.length || !sameStreet(from, cw)) continue;
        const [cs, ce] = ends(cw);
        const along = near(fe, cs) || near(ce, fs);
        const against = near(fs, cs) || near(fe, ce);
        if (!along && !against) continue;
        const s = sides.get(from);
        sides.set(cw, along ? { ...s } : { left: s.right, right: s.left });
        known.add(cw);
        next.push(cw);
      }
    }
    queue = next;
  }
  return sides;
}

// +1 when a one-way carriageway is driven along its node order, -1 against it
const travelSign = (cw) => (['-1', 'reverse'].includes(String(cw.tags?.oneway ?? '').trim().toLowerCase()) ? -1 : 1);

const streetKey = (cw) => {
  const name = String(cw.tags?.name || cw.tags?.ref || '').trim();
  const cls = String(cw.highway || '').replace(/_link$/, '');
  return name && DUAL_CLASSES.has(cls) && isOneWayRoad(cw.tags || {}) ? `${cls}|${name}` : null;
};

/**
 * Where each carriageway runs beside its divided road's other carriageway:
 * Map(cw -> { side: ±1 per node (0 = none; +1 left of the node order),
 * width: median ground width per node }).
 */
export function findMedians(carriageways) {
  const groups = new Map();
  for (const cw of carriageways) {
    const key = cw.nodes?.length > 1 ? streetKey(cw) : null;
    if (!key) continue;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(cw);
  }
  const out = new Map();
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    // segments of the group in a coarse grid
    const CELL = DUAL_GAP_M[1];
    const grid = new Map();
    group.forEach((cw, ci) => {
      for (let i = 0; i + 1 < cw.nodes.length; i++) {
        const a = cw.nodes[i]; const b = cw.nodes[i + 1];
        const k = `${Math.floor((a[0] + b[0]) / 2 / CELL)},${Math.floor((a[1] + b[1]) / 2 / CELL)}`;
        if (!grid.has(k)) grid.set(k, []);
        grid.get(k).push([ci, i]);
      }
    });
    group.forEach((cw, ci) => {
      const n = cw.nodes.length;
      const side = new Int8Array(n);
      const width = new Float32Array(n);
      let any = false;
      for (let i = 0; i < n; i++) {
        const p = cw.nodes[i];
        const a = cw.nodes[Math.max(0, i - 1)]; const b = cw.nodes[Math.min(n - 1, i + 1)];
        const t = unit([b[0] - a[0], b[1] - a[1]]);
        let best = null;
        const gx = Math.floor(p[0] / CELL); const gy = Math.floor(p[1] / CELL);
        for (let dx = -1; dx <= 1; dx++) {
          for (let dy = -1; dy <= 1; dy++) {
            for (const [cj, j] of grid.get(`${gx + dx},${gy + dy}`) || []) {
              if (cj === ci) continue;
              const other = group[cj];
              const q0 = other.nodes[j]; const q1 = other.nodes[j + 1];
              const sx = q1[0] - q0[0]; const sy = q1[1] - q0[1];
              const L2 = sx * sx + sy * sy || 1e-9;
              const f = Math.max(0, Math.min(1, ((p[0] - q0[0]) * sx + (p[1] - q0[1]) * sy) / L2));
              const vx = q0[0] + sx * f - p[0]; const vy = q0[1] + sy * f - p[1];
              const d = Math.hypot(vx, vy);
              if (d < DUAL_GAP_M[0] || d > DUAL_GAP_M[1] || (best && d >= best.d)) continue;
              const u = unit([sx, sy]);
              // the other carriageway of a divided road is driven the other
              // way (a turn lane or slip road beside it, the same way, is not)
              if ((t[0] * u[0] + t[1] * u[1]) * travelSign(cw) * travelSign(other) > -DUAL_ANGLE_COS) continue;
              best = { d, s: Math.sign(t[0] * vy - t[1] * vx), half: other.half };
            }
          }
        }
        if (!best) continue;
        const mw = best.d - cw.half - best.half;
        if (mw < MEDIAN_MIN_M || mw > MEDIAN_MAX_M) continue;
        side[i] = best.s;
        width[i] = mw;
        any = true;
      }
      if (any) out.set(cw, { side, width });
    });
  }
  return out;
}

// The share of a carriageway's nodes whose `side` (±1) faces a median.
const medianShare = (median, side) => {
  if (!median) return 0;
  let k = 0;
  for (const v of median.side) if (v === side) k++;
  return k / median.side.length;
};

/**
 * Median islands along each divided carriageway: runs like the sidewalks'
 * (curb at the carriageway's edge, slab toward the median) whose points carry
 * their slab width as a 4th value. Cut where they would cross another road
 * or a crosswalk.
 */
export function buildMedianRuns(carriageways, medians, { zones = [] } = {}) {
  const index = buildCarriagewayIndex(carriageways);
  const pieces = [];
  for (const cw of carriageways) {
    const median = medians.get(cw);
    if (!median) continue;
    for (const side of [1, -1]) {
      // contiguous stretches facing a median on this side
      let i = 0;
      const n = cw.nodes.length;
      while (i < n) {
        if (median.side[i] !== side) { i++; continue; }
        let j = i;
        while (j + 1 < n && median.side[j + 1] === side) j++;
        const widths = Array.from(median.width.slice(i, j + 1));
        const sorted = [...widths].sort((x, y) => x - y);
        // one island (slab to the middle) or two curbs, by the stretch's typical width
        const slab = sorted[sorted.length >> 1] <= MEDIAN_SLAB_M;
        const nodes = offsetLine(cw.nodes.slice(i, j + 1), side * cw.half)
          .map((pt, k) => [pt[0], pt[1], pt[2], slab ? Math.max(0.3, widths[k] / 2) : MEDIAN_CURB_W]);
        const ignore = new Set([cw.owner, ...(cw.continuations || [])]);
        const blocked = (x, y) => isOnOtherCarriageway(index, x, y, CUT_MARGIN_M, (o) => ignore.has(o)) || isInZone(zones, x, y);
        for (const piece of cutNodes(nodes, blocked, { minPieceM: 0.5 })) {
          pieces.push({ points: piece, side, width: 0, owner: cw.owner, highway: cw.highway, median: true });
        }
        i = j + 1;
      }
    }
  }
  // OSM splits a carriageway into many short ways: join their pieces end to
  // end first (each point keeps its own width), then drop the short ones
  return mergeRuns(pieces, { matchWidth: false })
    .filter((run) => runLength(run.points) >= MEDIAN_MIN_RUN_M)
    .map((run) => ({ ...run, width: Math.max(...run.points.map((pt) => pt[3])) }));
}

/**
 * Sidewalk runs: [{ points: [[x,y,z]...], side: ±1, width, owner }] where side +1
 * is left of the run's direction (the sidewalk lies on that side of the curb)
 * and owner is the carriageway's.
 */
export function buildSidewalkRuns(carriageways, { zones = [], driveways = [], medians = new Map() } = {}) {
  const index = buildCarriagewayIndex(carriageways);
  const sidesOf = streetSides(carriageways);
  // Driveways and parking aisles (OSM service roads, not carriageways of
  // their own) cross a sidewalk with its curb lowered: a dip, not a cut.
  const nearDriveway = buildLineIndex(driveways);
  const pieces = [];
  for (const cw of carriageways) {
    const sides = sidesOf.get(cw);
    const ignore = new Set([cw.owner, ...(cw.continuations || [])]);
    const blocked = (x, y) => isOnOtherCarriageway(index, x, y, CUT_MARGIN_M, (o) => ignore.has(o)) || isInZone(zones, x, y);
    for (const [side, width] of [[1, sides.left], [-1, sides.right]]) {
      // a divided road's median side has the median, not a sidewalk
      if (!width || medianShare(medians.get(cw), side) >= MEDIAN_SIDE_SHARE) continue;
      for (const piece of cutNodes(offsetLine(cw.nodes, side * cw.half), blocked, { minPieceM: 0.5 })) {
        pieces.push({ points: piece.map((n) => [n[0], n[1], n[2]]), side, width, owner: cw.owner, highway: cw.highway });
      }
    }
  }
  const runs = mergeRuns(pieces).filter((run) => runLength(run.points) >= MIN_RUN_M);
  if (nearDriveway) for (const run of runs) run.dips = dipsAlong(run.points, (x, y) => nearDriveway(x, y, DRIVEWAY_HALF_M));
  return runs;
}

const DRIVEWAY_HALF_M = 2.5;
const LINE_CELL_M = 16;
// near(x, y, r): within r of any of the polylines [[x, y]...] (null for none).
function buildLineIndex(lines) {
  if (!lines.length) return null;
  const grid = new Map();
  for (const line of lines) {
    for (let i = 0; i + 1 < line.length; i++) {
      const [ax, ay] = line[i];
      const [bx, by] = line[i + 1];
      for (let gx = Math.floor(Math.min(ax, bx) / LINE_CELL_M) - 1; gx <= Math.floor(Math.max(ax, bx) / LINE_CELL_M) + 1; gx++) {
        for (let gy = Math.floor(Math.min(ay, by) / LINE_CELL_M) - 1; gy <= Math.floor(Math.max(ay, by) / LINE_CELL_M) + 1; gy++) {
          const k = `${gx},${gy}`;
          if (!grid.has(k)) grid.set(k, []);
          grid.get(k).push([ax, ay, bx, by]);
        }
      }
    }
  }
  return (x, y, r) => (grid.get(`${Math.floor(x / LINE_CELL_M)},${Math.floor(y / LINE_CELL_M)}`) || []).some(([ax, ay, bx, by]) => {
    const dx = bx - ax; const dy = by - ay;
    const len = dx * dx + dy * dy;
    const t = len > 0 ? Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / len)) : 0;
    return Math.hypot(ax + t * dx - x, ay + t * dy - y) < r;
  });
}

/**
 * Pieces joined end to end where one street's sidewalk goes on across a way
 * boundary (OSM splits streets into many ways): same side, near-straight,
 * same width. Without this every way boundary ended the sidewalk.
 */
// Join pieces end to end into runs (same side, similar width, turning less
// than 35°). Run ends are kept in a grid, so a city's thousands of pieces
// join in one pass (re-scanning every pair after each join took 222 s for a
// 4 km Phoenix export).
function mergeRuns(pieces, { matchWidth = true } = {}) {
  const NEAR = 0.75;
  const runs = pieces.map((r) => ({ ...r, points: [...r.points], alive: true }));
  const near = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]) < NEAR;
  const dir = (a, b) => unit([b[0] - a[0], b[1] - a[1]]);
  const cellOf = (p) => `${Math.floor(p[0] / NEAR)},${Math.floor(p[1] / NEAR)}`;
  const grid = new Map();   // cell -> runs with an end there (checked again on use)
  const addEnds = (run) => {
    for (const p of [run.points[0], run.points[run.points.length - 1]]) {
      const k = cellOf(p);
      if (!grid.has(k)) grid.set(k, []);
      grid.get(k).push(run);
    }
  };
  const nearby = (p) => {
    const cx = Math.floor(p[0] / NEAR); const cy = Math.floor(p[1] / NEAR);
    const out = [];
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (const r of grid.get(`${cx + dx},${cy + dy}`) || []) out.push(r);
    return out;
  };
  runs.forEach(addEnds);
  for (const A of runs) {
    if (!A.alive || A.points.length < 2) continue;
    let extended = true;
    while (extended) {
      extended = false;
      const aEnd = A.points[A.points.length - 1];
      const da = dir(A.points[A.points.length - 2], aEnd);
      for (const cand of nearby(aEnd)) {
        if (cand === A || !cand.alive || cand.points.length < 2 || (matchWidth && Math.abs(A.width - cand.width) > 0.3)) continue;
        let B = null;
        if (near(aEnd, cand.points[0]) && A.side === cand.side) B = cand.points;
        else if (near(aEnd, cand.points[cand.points.length - 1]) && A.side === -cand.side) B = [...cand.points].reverse();
        if (!B) continue;
        const db = dir(B[0], B[1]);
        if (da[0] * db[0] + da[1] * db[1] < Math.cos((35 * Math.PI) / 180)) continue;
        A.points = [...A.points, ...B.slice(1)];
        cand.alive = false;
        addEnds(A);
        extended = true;
        break;
      }
    }
  }
  return runs.filter((r) => r.alive).map(({ alive, ...r }) => r);
}

const DIP_STEP_M = 0.5;
// Arc-length spans [s0, s1] of a run where `on(x, y)` (a driveway crossing).
function dipsAlong(points, on) {
  const spans = [];
  let s = 0;
  let open = null;
  for (let i = 0; i + 1 < points.length; i++) {
    const [ax, ay] = points[i];
    const [bx, by] = points[i + 1];
    const len = Math.hypot(bx - ax, by - ay);
    for (let d = 0; d < len; d += DIP_STEP_M) {
      const hit = on(ax + ((bx - ax) * d) / len, ay + ((by - ay) * d) / len);
      if (hit && open === null) open = s + d;
      if (!hit && open !== null) { spans.push([open, s + d]); open = null; }
    }
    s += len;
  }
  if (open !== null) spans.push([open, s]);
  return spans;
}

// Profile across from the curb line: [outward offset, height] and material.
function profileFor(width) {
  const slabOut = CURB_H + width * CROSS_SLOPE;
  const back = width + BACK_SLOPE_RUN * (slabOut + SINK);
  return {
    points: [[0, -SINK], [BATTER, CURB_H - NOSE], [NOSE_W, CURB_H], [CURB_W, CURB_H], [width, slabOut], [back, -SINK]],
    // segment k joins points k and k+1
    segments: [
      { mat: 'curb', v: [V_BAND_LOW, V_LIGHT_LOW] },   // face
      { mat: 'curb', v: [V_LIGHT_LOW, V_BAND_TOP] },   // nose
      { mat: 'curb', v: [V_LIGHT_LOW, V_BAND_TOP] },   // top
      { mat: 'slab', v: [V_SLAB_IN, V_SLAB_OUT] },     // slab
      { mat: 'curb', v: [V_BAND_LOW, V_LIGHT_LOW] },   // back
    ],
  };
}

class PartBuilder {
  constructor() { this.parts = { curb: { pos: [], uv: [] }, slab: { pos: [], uv: [] } }; this.triangles = 0; }

  // Triangle a-b-c turned so its normal points along `want`.
  tri(mat, a, b, c, ua, ub, uc, want) {
    const n = [
      (b[1] - a[1]) * (c[2] - a[2]) - (b[2] - a[2]) * (c[1] - a[1]),
      (b[2] - a[2]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[2] - a[2]),
      (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]),
    ];
    const flip = n[0] * want[0] + n[1] * want[1] + n[2] * want[2] < 0;
    const p = this.parts[mat];
    for (const [v, u] of flip ? [[a, ua], [c, uc], [b, ub]] : [[a, ua], [b, ub], [c, uc]]) {
      p.pos.push(v[0], v[1], v[2]);
      p.uv.push(u[0], u[1]);
    }
    this.triangles++;
  }

  toMesh(name) {
    let total = 0;
    for (const p of Object.values(this.parts)) total += p.pos.length / 3;
    if (total === 0) return null;
    const geo = new THREE.BufferGeometry();
    const pos = new Float32Array(total * 3);
    const uv = new Float32Array(total * 2);
    const materials = [];
    let start = 0;
    for (const [key, p] of Object.entries(this.parts)) {
      const count = p.pos.length / 3;
      if (count === 0) continue;
      pos.set(p.pos, start * 3);
      uv.set(p.uv, start * 2);
      geo.addGroup(start, count, materials.length);
      materials.push(new THREE.MeshStandardMaterial({ name: SIDEWALK_MATERIALS[key] }));
      start += count;
    }
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    geo.computeVertexNormals();
    const mesh = new THREE.Mesh(geo, materials);
    mesh.name = name;
    return mesh;
  }
}

const DIP_RAMP_M = 1.0;        // the curb's slope down into a driveway dip

// A run's stations (its points, with more where the curb height changes) and
// each one's curb-height share: 0 at a ramped end and across a driveway dip,
// back to 1 over RAMP_M / DIP_RAMP_M.
function rampStations(points, ramps, dips = []) {
  const s = [0];
  for (let i = 1; i < points.length; i++) s.push(s[i - 1] + Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1]));
  const total = s[s.length - 1];
  const ramp = Math.min(RAMP_M, total / 2.5);
  const shareAt = (d) => {
    let f = Math.min(1, ramps[0] ? d / ramp : 1, ramps[1] ? (total - d) / ramp : 1);
    for (const [a, b] of dips) f = Math.min(f, Math.max(0, Math.max(a - d, d - b) / DIP_RAMP_M));
    return Math.max(0, f);
  };
  const cuts = [];
  if (ramps[0]) cuts.push(ramp);
  if (ramps[1]) cuts.push(total - ramp);
  for (const [a, b] of dips) cuts.push(a - DIP_RAMP_M, a, b, b + DIP_RAMP_M);
  const inner = cuts.filter((c) => c > 1e-6 && c < total - 1e-6).sort((x, y) => x - y);
  const out = [];
  const at = [];
  let c = 0;
  for (let i = 0; i < points.length; i++) {
    while (i > 0 && c < inner.length && inner[c] < s[i] - 1e-6) {
      if (inner[c] > s[i - 1] + 1e-6) {
        const f = (inner[c] - s[i - 1]) / (s[i] - s[i - 1]);
        out.push(points[i - 1].map((v, k) => v + (points[i][k] - v) * f));
        at.push(inner[c]);
      }
      c++;
    }
    out.push(points[i]);
    at.push(s[i]);
  }
  return { points: out, share: at.map(shareAt) };
}

function sweepRun(builder, run) {
  const { side, width } = run;
  const caps = run.caps ?? [true, true];
  const { points, share } = rampStations(run.points, run.ramps ?? [false, false], run.dips);
  // a median island's points carry their own slab width (4th value)
  const profiles = run.median ? points.map((p) => profileFor(p[3] || width)) : null;
  const profile = profileFor(width);
  // Outward unit normal at each station (mitred, the sidewalk's side).
  const outward = points.map((p, i) => {
    const a = points[Math.max(0, i - 1)];
    const b = points[Math.min(points.length - 1, i + 1)];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
    return [-((b[1] - a[1]) / len) * side, ((b[0] - a[0]) / len) * side];
  });
  const stations = points.map((p, i) => (profiles ? profiles[i] : profile).points.map(([o, h]) => [p[0] + outward[i][0] * o, p[1] + outward[i][1] * o, p[2] + (h > 0 ? h * share[i] : h)]));
  let along = 0;
  for (let i = 0; i + 1 < points.length; i++) {
    const step = Math.hypot(points[i + 1][0] - points[i][0], points[i + 1][1] - points[i][1]);
    const s0 = along;
    const s1 = along + step;
    along = s1;
    const out = [(outward[i][0] + outward[i + 1][0]) / 2, (outward[i][1] + outward[i + 1][1]) / 2];
    profile.segments.forEach((seg, k) => {
      const [o0, h0] = (profiles ? profiles[i] : profile).points[k];
      const [o1, h1] = (profiles ? profiles[i] : profile).points[k + 1];
      // Front of this profile segment: (−dh)·outward + (do)·up.
      const want = [-(h1 - h0) * out[0], -(h1 - h0) * out[1], o1 - o0];
      const repeat = seg.mat === 'slab' ? SLAB_REPEAT_M : CURB_REPEAT_M;
      const u0 = s0 / repeat;
      const u1 = s1 / repeat;
      const a0 = stations[i][k]; const b0 = stations[i][k + 1];
      const a1 = stations[i + 1][k]; const b1 = stations[i + 1][k + 1];
      const [va, vb] = seg.v;
      builder.tri(seg.mat, a0, a1, b1, [u0, va], [u1, va], [u1, vb], want);
      builder.tri(seg.mat, a0, b1, b0, [u0, va], [u1, vb], [u0, vb], want);
    });
  }
  // End caps: fan over the profile, facing away from the run (not where a
  // corner piece goes on from it).
  for (const [i, j, cap] of [[0, 1, caps[0]], [points.length - 1, points.length - 2, caps[1]]]) {
    if (!cap) continue;
    const dir = [points[i][0] - points[j][0], points[i][1] - points[j][1], 0];
    const ring = stations[i];
    for (let k = 1; k + 1 < ring.length; k++) {
      builder.tri('curb', ring[0], ring[k], ring[k + 1], [0, V_BAND_LOW], [0.02, V_LIGHT_LOW], [0.04, V_LIGHT_LOW], dir);
    }
  }
}

const unit = (v) => { const l = Math.hypot(v[0], v[1]) || 1; return [v[0] / l, v[1] / l]; };
const lineX = (p, d, q, e) => {
  const den = d[0] * e[1] - d[1] * e[0];
  if (Math.abs(den) < 1e-9) return null;
  const t = ((q[0] - p[0]) * e[1] - (q[1] - p[1]) * e[0]) / den;
  return [p[0] + t * d[0], p[1] + t * d[1]];
};
const runLength = (pts) => pts.reduce((n, p, i) => (i ? n + Math.hypot(p[0] - pts[i - 1][0], p[1] - pts[i - 1][1]) : 0), 0);

// A run's end: its point, the way on past it, the sidewalk's side (outward
// from the road), its height.
function runEnd(run, atStart) {
  const pts = run.points;
  const p = atStart ? pts[0] : pts[pts.length - 1];
  const q = atStart ? pts[1] : pts[pts.length - 2];
  const d = unit([p[0] - q[0], p[1] - q[1]]);
  // outward = left normal of the run's direction times its side
  const fwd = atStart ? [-d[0], -d[1]] : d;
  return { run, atStart, p, d, n: [-fwd[1] * run.side, fwd[0] * run.side], z: p[2] };
}

// The run cut (t < 0) or carried on (t > 0) to t m past this end.
function moveEnd(end, t) {
  const { run, atStart } = end;
  const pts = atStart ? [...run.points].reverse() : [...run.points];
  if (t >= 0) {
    if (t > 0.01) pts.push([end.p[0] + end.d[0] * t, end.p[1] + end.d[1] * t, end.z]);
  } else {
    let cut = -t;
    while (pts.length > 1) {
      const a = pts[pts.length - 1];
      const b = pts[pts.length - 2];
      const seg = Math.hypot(a[0] - b[0], a[1] - b[1]);
      if (seg > cut + 1e-6) {
        const f = cut / seg;
        pts[pts.length - 1] = a.map((v, k) => v + (b[k] - v) * f);
        break;
      }
      cut -= seg;
      pts.pop();
    }
  }
  run.points = atStart ? pts.reverse() : pts;
  // driveway dips are arc lengths from the start
  if (atStart && run.dips) run.dips = run.dips.map(([a, b]) => [a + t, b + t]).filter(([, b]) => b > 0);
}

/**
 * Curb returns where two sidewalks meet at a junction corner: each pair of
 * run ends whose curb lines meet just ahead of both, at a corner angle, with
 * each sidewalk on the outside of the other. Both runs are cut (or carried
 * on) to the arc's tangent points; returns the corner pieces
 * [{ arc: [[x, y, z]...], centre, outer: [x, y], a: end, b: end }]. Ends
 * left over get curb ramps.
 */
function joinCorners(runs, index) {
  const ends = runs.flatMap((run) => [runEnd(run, true), runEnd(run, false)]);
  const pairs = [];
  for (let i = 0; i < ends.length; i++) {
    for (let j = i + 1; j < ends.length; j++) {
      const A = ends[i];
      const B = ends[j];
      if (A.run === B.run || Math.hypot(A.p[0] - B.p[0], A.p[1] - B.p[1]) > 2 * CORNER_REACH_M) continue;
      const angle = Math.acos(Math.max(-1, Math.min(1, A.d[0] * B.d[0] + A.d[1] * B.d[1]))) * 180 / Math.PI;
      if (angle < CORNER_ANGLES[0] || angle > CORNER_ANGLES[1]) continue;
      // each sidewalk lies on the outside of the other's road
      if (A.n[0] * -B.d[0] + A.n[1] * -B.d[1] < 0.3 || B.n[0] * -A.d[0] + B.n[1] * -A.d[1] < 0.3) continue;
      const C = lineX(A.p, A.d, B.p, B.d);
      if (!C) continue;
      const tA = (C[0] - A.p[0]) * A.d[0] + (C[1] - A.p[1]) * A.d[1];
      const tB = (C[0] - B.p[0]) * B.d[0] + (C[1] - B.p[1]) * B.d[1];
      if (tA < -2 || tB < -2 || tA > CORNER_REACH_M || tB > CORNER_REACH_M) continue;
      pairs.push({ A, B, cost: tA + tB });
    }
  }
  pairs.sort((x, y) => x.cost - y.cost);
  const used = new Set();
  const corners = [];
  for (const { A, B } of pairs) {
    if (used.has(A) || used.has(B)) continue;
    const r0 = Math.max(CORNER_RADII[A.run.highway] ?? CORNER_RADIUS, CORNER_RADII[B.run.highway] ?? CORNER_RADIUS);
    for (const share of CORNER_TRIES) {
      const r = r0 * share;
      const Z = lineX([A.p[0] + A.n[0] * r, A.p[1] + A.n[1] * r], A.d, [B.p[0] + B.n[0] * r, B.p[1] + B.n[1] * r], B.d);
      if (!Z) break;
      const T1 = [Z[0] - A.n[0] * r, Z[1] - A.n[1] * r];
      const T2 = [Z[0] - B.n[0] * r, Z[1] - B.n[1] * r];
      const t1 = (T1[0] - A.p[0]) * A.d[0] + (T1[1] - A.p[1]) * A.d[1];
      const t2 = (T2[0] - B.p[0]) * B.d[0] + (T2[1] - B.p[1]) * B.d[1];
      // keep enough of each run, and reach no further than the corner search
      if (t1 > CORNER_REACH_M || t2 > CORNER_REACH_M) continue;
      if (runLength(A.run.points) + t1 < MIN_RUN_M / 2 || runLength(B.run.points) + t2 < MIN_RUN_M / 2) continue;
      const a0 = Math.atan2(T1[1] - Z[1], T1[0] - Z[0]);
      const a1 = Math.atan2(T2[1] - Z[1], T2[0] - Z[0]);
      const da = ((a1 - a0 + 3 * Math.PI) % (2 * Math.PI)) - Math.PI;
      const k = Math.max(3, Math.ceil((Math.abs(da) * r) / 0.75) + 1);
      const arc = Array.from({ length: k }, (_, i) => {
        const a = a0 + (da * i) / (k - 1);
        return [Z[0] + r * Math.cos(a), Z[1] + r * Math.sin(a), A.z + ((B.z - A.z) * i) / (k - 1)];
      });
      // the corner (the curb and the slab behind it) clear of every carriageway
      const outer = lineX([T1[0] + A.n[0] * A.run.width, T1[1] + A.n[1] * A.run.width], A.d,
        [T2[0] + B.n[0] * B.run.width, T2[1] + B.n[1] * B.run.width], B.d);
      if (!outer) break;
      const probes = [...arc, outer, [(outer[0] + Z[0]) / 2, (outer[1] + Z[1]) / 2]];
      if (probes.some(([x, y]) => isOnOtherCarriageway(index, x, y, -0.2, () => false))) continue;
      moveEnd(A, t1);
      moveEnd(B, t2);
      corners.push({ arc, centre: Z, outer, a: A, b: B });
      used.add(A);
      used.add(B);
      break;
    }
  }
  for (const end of ends) {
    const { run } = end;
    run.caps ??= [true, true];
    run.ramps ??= [false, false];
    const k = end.atStart ? 0 : 1;
    if (used.has(end)) run.caps[k] = false;
    else run.ramps[k] = true;
  }
  return corners;
}

// A corner piece: the curb along the arc, the slab from the curb's top out to
// the corner of the two sidewalks' outer edges, and the back faces along them.
function sweepCorner(builder, corner) {
  const { arc, centre, outer, a, b } = corner;
  const prof = profileFor(Math.min(a.run.width, b.run.width));
  const curbPts = prof.points.slice(0, 4);     // face, nose, top
  const inward = arc.map(([x, y]) => unit([centre[0] - x, centre[1] - y]));   // away from the road
  const stations = arc.map((p, i) => curbPts.map(([o, h]) => [p[0] + inward[i][0] * o, p[1] + inward[i][1] * o, p[2] + h]));
  let along = 0;
  for (let i = 0; i + 1 < arc.length; i++) {
    const step = Math.hypot(arc[i + 1][0] - arc[i][0], arc[i + 1][1] - arc[i][1]);
    const u0 = along / CURB_REPEAT_M;
    along += step;
    const u1 = along / CURB_REPEAT_M;
    const out = [(inward[i][0] + inward[i + 1][0]) / 2, (inward[i][1] + inward[i + 1][1]) / 2];
    for (let k = 0; k < 3; k++) {
      const [o0, h0] = curbPts[k];
      const [o1, h1] = curbPts[k + 1];
      const want = [-(h1 - h0) * out[0], -(h1 - h0) * out[1], o1 - o0];
      const [va, vb] = prof.segments[k].v;
      const a0 = stations[i][k]; const b0 = stations[i][k + 1];
      const a1 = stations[i + 1][k]; const b1 = stations[i + 1][k + 1];
      builder.tri('curb', a0, a1, b1, [u0, va], [u1, va], [u1, vb], want);
      builder.tri('curb', a0, b1, b0, [u0, va], [u1, vb], [u0, vb], want);
    }
  }
  // slab: a fan from the outer corner over the curb top's back edge, closed
  // by the two sidewalks' end sections
  const zMid = (a.z + b.z) / 2;
  const slabZ = (z, w) => z + CURB_H + w * CROSS_SLOPE;
  const aOut = [arc[0][0] + a.n[0] * a.run.width, arc[0][1] + a.n[1] * a.run.width, slabZ(a.z, a.run.width)];
  const bOut = [arc[arc.length - 1][0] + b.n[0] * b.run.width, arc[arc.length - 1][1] + b.n[1] * b.run.width, slabZ(b.z, b.run.width)];
  const O = [outer[0], outer[1], slabZ(zMid, (a.run.width + b.run.width) / 2)];
  const rim = [aOut, ...stations.map((st) => st[3]), bOut];
  const uvOf = (p, v) => [p[0] / SLAB_REPEAT_M, v];
  for (let i = 0; i + 1 < rim.length; i++) {
    const vi = i === 0 ? V_SLAB_OUT : V_SLAB_IN;
    const vj = i + 1 === rim.length - 1 ? V_SLAB_OUT : V_SLAB_IN;
    builder.tri('slab', O, rim[i], rim[i + 1], uvOf(O, V_SLAB_OUT), uvOf(rim[i], vi), uvOf(rim[i + 1], vj), [0, 0, 1]);
  }
  // back faces: from the slab's outer edge down to the ground behind it
  for (const [p, q] of [[aOut, O], [O, bOut]]) {
    const mid = [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2];
    const away = unit([mid[0] - centre[0], mid[1] - centre[1]]);
    const drop = (v) => [v[0] + away[0] * BACK_SLOPE_RUN * (v[2] - zMid + SINK), v[1] + away[1] * BACK_SLOPE_RUN * (v[2] - zMid + SINK), zMid - SINK];
    const want = [away[0], away[1], 0.5];
    builder.tri('curb', p, q, drop(q), [0, V_LIGHT_LOW], [0.2, V_LIGHT_LOW], [0.2, V_BAND_LOW], want);
    builder.tri('curb', p, drop(q), drop(p), [0, V_LIGHT_LOW], [0.2, V_BAND_LOW], [0, V_BAND_LOW], want);
  }
}

/**
 * Sidewalk meshes for the drawn carriageways: { meshes (THREE, world space),
 * runs, triangles }. Batches of RUNS_PER_MESH runs; names use letters (BeamNG
 * reads trailing digits of a Collada node name as a detail level).
 */
export function buildSidewalkMeshes(carriageways, options = {}) {
  const medians = findMedians(carriageways);
  const runs = buildSidewalkRuns(carriageways, { ...options, medians });
  const medianRuns = buildMedianRuns(carriageways, medians, options);
  const corners = joinCorners(runs, buildCarriagewayIndex(carriageways));
  const meshes = [];
  let builder = new PartBuilder();
  let inBatch = 0;
  let triangles = 0;
  const letters = (n) => { let s = ''; let k = n; do { s = String.fromCharCode(97 + (k % 26)) + s; k = Math.floor(k / 26) - 1; } while (k >= 0); return s; };
  const flush = () => {
    triangles += builder.triangles;
    const mesh = builder.toMesh(`sidewalks_${letters(meshes.length)}`);
    if (mesh) meshes.push(mesh);
    builder = new PartBuilder();
    inBatch = 0;
  };
  for (const run of runs) {
    if (run.points.length < 2) continue;
    sweepRun(builder, run);
    if (++inBatch >= RUNS_PER_MESH) flush();
  }
  for (const corner of corners) {
    sweepCorner(builder, corner);
    if (++inBatch >= RUNS_PER_MESH) flush();
  }
  for (const run of medianRuns) {
    sweepRun(builder, run);
    if (++inBatch >= RUNS_PER_MESH) flush();
  }
  flush();
  return { meshes, runs, corners, medianRuns, triangles };
}
