// Structure checks: numbers for how well the roads, bridges and tunnels of an
// export fit together and the terrain around them. They measure the result
// (whatever produced it), so the same checks grade today's passes and the
// structure solver that replaces them (refs/output/bridge-tunnel-plan.md).
//
// Nothing here knows about any place: every check is geometry.

import { DECK_ROAD_CLEAR_M } from '../beamngBridges.js';

// Where two carriageway ends count as one joint (horizontal, m).
const JOINT_REACH_M = 0.3;
// A joint whose two sides differ by more than this is a step (m).
const JOINT_STEP_M = 0.1;
// Steepest grade a road of each class should carry; anything steeper is
// counted (ground roads too: the terrain under them is part of the result).
const GRADE_MAX = {
  motorway: 0.06, motorway_link: 0.08, trunk: 0.07, trunk_link: 0.08,
  primary: 0.1, primary_link: 0.1, secondary: 0.12, secondary_link: 0.12,
  tertiary: 0.15, tertiary_link: 0.15,
};
const GRADE_DEFAULT = 0.18;
const GRADE_RUN_M = 4;            // grade over the shortest run of nodes at least this long
// Vertical space a road passing over another needs: the bridge design value
// (deck top over the road under it: headroom + structure), less a tolerance
// for DecalRoad offsets.
const CROSSING_SEPARATION_M = DECK_ROAD_CLEAR_M;
const CROSSING_TOLERANCE_M = 0.1;
// Ground road nodes further than this from the terrain are floating or buried.
const GROUND_GAP_M = 0.5;
// Terrain sample over a deck's underside by more than this pokes through.
const THROUGH_DECK_M = 0.1;
const DECK_SAMPLE_M = 2;
const DECK_UNDERSIDE_M = 2.2;     // DECK_DEPTH_M + GIRDER_D_M (beamngBridges)
// A pixel this far from the median of its 3×3 neighbourhood is a spike or pit
// (a step, like a retaining wall, keeps the median on one side: not counted).
const SPIKE_M = 2;
const SPIKE_REACH_M = 25;         // around decks and tunnel lines
const CELL_M = 32;

const round = (v, d = 2) => Math.round(v * 10 ** d) / 10 ** d;
const roadName = (cw) => cw?.tags?.name || cw?.tags?.ref || cw?.highway || 'road';
const layerOf = (cw) => Number.parseInt(cw?.tags?.layer, 10) || 0;
// (carried: an approach road a deck is carried on along, a walled ramp)
const isStructure = (cw) => !!(cw?.bridge || cw?.carried || cw?.tunnel);

function worst(list, key) {
  let best = null;
  for (const item of list) if (!best || item[key] > best[key]) best = item;
  return best;
}

// The TOP_N worst of a list, as { value, at: [x, y], ...labels }, for the
// report's list of places to look.
const TOP_N = 10;
function top(list, key, label) {
  return [...list].sort((a, b) => b[key] - a[key]).slice(0, TOP_N)
    .map((it) => ({ value: round(it[key], key === 'grade' ? 3 : 2), at: [round(it.x, 1), round(it.y, 1)], what: label(it) }));
}

/**
 * The roads as they ship: every road piece's base surface DecalRoad (its
 * centreline; every drivable road has one, not every one an AI path; named
 * ..._b whatever its surface) with
 * its carriageway's class and structure flags. Later passes
 * move DecalRoad nodes after the carriageways are recorded (a pit sunk into a
 * deck road went unseen when the checks read the carriageways), so the checks
 * measure these. Falls back to the carriageways when no decal is tagged.
 */
export function roadLinesFromDecals(groups) {
  const carriageways = groups?.carriageways || [];
  const byOwner = new Map();
  for (const cw of carriageways) if (!byOwner.has(cw.owner)) byOwner.set(cw.owner, cw);
  const lines = [];
  for (const g of groups || []) {
    for (const d of g.__items || []) {
      // (the base layer is named after its surface: asphalt, dirt, gravel...;
      // its decal name ends in _b)
      if (!/_b$/.test(d.name || '') || d.__owner === undefined || !(d.nodes?.length >= 2)) continue;
      const cw = byOwner.get(d.__owner);
      // (a decal drawn onto a deck projects onto objects: on a structure,
      // whatever its road's tags say)
      if (cw) lines.push({ ...cw, nodes: d.nodes, ...(d.overObjects ? { carried: true } : {}) });
    }
  }
  return lines.length ? lines : carriageways;
}

/** Steps where two carriageways meet: their end nodes at different heights. */
export function checkJoints(carriageways) {
  const cells = new Map();
  const ends = [];
  carriageways.forEach((cw, ci) => {
    const n = cw.nodes || [];
    if (n.length < 2) return;
    for (const node of [n[0], n[n.length - 1]]) {
      const e = { ci, x: node[0], y: node[1], z: node[2] };
      ends.push(e);
      const key = `${Math.floor(e.x / 1)},${Math.floor(e.y / 1)}`;
      if (!cells.has(key)) cells.set(key, []);
      cells.get(key).push(e);
    }
  });
  const steps = [];
  let joints = 0;
  for (const e of ends) {
    const cx = Math.floor(e.x); const cy = Math.floor(e.y);
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        for (const o of cells.get(`${cx + dx},${cy + dy}`) || []) {
          if (o.ci <= e.ci) continue;     // each pair once
          if (Math.hypot(o.x - e.x, o.y - e.y) > JOINT_REACH_M) continue;
          joints++;
          const dz = Math.abs(o.z - e.z);
          if (dz > JOINT_STEP_M) {
            steps.push({ dz, x: e.x, y: e.y, a: roadName(carriageways[e.ci]), b: roadName(carriageways[o.ci]) });
          }
        }
      }
    }
  }
  const w = worst(steps, 'dz');
  return { joints, steps: steps.length, worst: w && { dz: round(w.dz), at: [round(w.x, 1), round(w.y, 1)], roads: [w.a, w.b] }, top: top(steps, 'dz', (it) => `${it.a} / ${it.b}`) };
}

/** Stretches steeper than their road class should be. */
export function checkGrades(carriageways) {
  const over = { structure: [], ground: [] };
  let pairs = 0;
  for (const cw of carriageways) {
    const n = cw.nodes || [];
    const max = GRADE_MAX[cw.highway] ?? GRADE_DEFAULT;
    // (nodes are ~2 m apart: each grade spans the shortest run of nodes at
    // least GRADE_RUN_M long, so a pit a few nodes wide still shows)
    let j = 0;
    let ds = 0;
    for (let i = 0; i + 1 < n.length; i++) {
      if (j <= i) { j = i; ds = 0; }
      while (j + 1 < n.length && ds < GRADE_RUN_M) { ds += Math.hypot(n[j + 1][0] - n[j][0], n[j + 1][1] - n[j][1]); j++; }
      if (ds < GRADE_RUN_M) break;
      pairs++;
      const grade = Math.abs(n[j][2] - n[i][2]) / ds;
      if (grade > max) {
        (isStructure(cw) ? over.structure : over.ground).push({
          grade, max, x: (n[i][0] + n[j][0]) / 2, y: (n[i][1] + n[j][1]) / 2, road: roadName(cw),
        });
      }
      ds -= Math.hypot(n[i + 1][0] - n[i][0], n[i + 1][1] - n[i][1]);
    }
  }
  const pack = (list) => {
    const w = worst(list, 'grade');
    return { count: list.length, worst: w && { grade: round(w.grade, 3), limit: w.max, at: [round(w.x, 1), round(w.y, 1)], road: w.road }, top: top(list, 'grade', (it) => `${it.road} (limit ${Math.round(it.max * 100)}%)`) };
  };
  return { pairs, structure: pack(over.structure), ground: pack(over.ground) };
}

// Where segments p0-p1 and q0-q1 cross: { t, u } along each, or null.
function cross(p0, p1, q0, q1) {
  const rx = p1[0] - p0[0]; const ry = p1[1] - p0[1];
  const sx = q1[0] - q0[0]; const sy = q1[1] - q0[1];
  const den = rx * sy - ry * sx;
  if (Math.abs(den) < 1e-9) return null;
  const qpx = q0[0] - p0[0]; const qpy = q0[1] - p0[1];
  const t = (qpx * sy - qpy * sx) / den;
  const u = (qpx * ry - qpy * rx) / den;
  // (t, u > 0: a crossing exactly on a vertex counts once, not on both of
  // the segments meeting there)
  return t > 0 && t <= 1 && u > 0 && u <= 1 ? { t, u } : null;
}

/**
 * Roads passing over one another without the room to: where two carriageways
 * cross away from their ends and at least one is a structure (or their OSM
 * layers differ), the vertical gap between them.
 */
export function checkCrossings(carriageways) {
  const grid = new Map();
  carriageways.forEach((cw, ci) => {
    const n = cw.nodes || [];
    for (let i = 0; i + 1 < n.length; i++) {
      const x0 = Math.floor(Math.min(n[i][0], n[i + 1][0]) / CELL_M); const x1 = Math.floor(Math.max(n[i][0], n[i + 1][0]) / CELL_M);
      const y0 = Math.floor(Math.min(n[i][1], n[i + 1][1]) / CELL_M); const y1 = Math.floor(Math.max(n[i][1], n[i + 1][1]) / CELL_M);
      for (let gx = x0; gx <= x1; gx++) {
        for (let gy = y0; gy <= y1; gy++) {
          const key = `${gx},${gy}`;
          if (!grid.has(key)) grid.set(key, []);
          grid.get(key).push(ci, i);
        }
      }
    }
  });
  const seen = new Set();
  const short = [];
  let crossings = 0;
  const atEnd = (n, i, t) => (i === 0 && t * Math.hypot(n[1][0] - n[0][0], n[1][1] - n[0][1]) < 1)
    || (i === n.length - 2 && (1 - t) * Math.hypot(n[i + 1][0] - n[i][0], n[i + 1][1] - n[i][1]) < 1);
  for (const list of grid.values()) {
    for (let a = 0; a < list.length; a += 2) {
      for (let b = a + 2; b < list.length; b += 2) {
        const ca = list[a]; const cb = list[b];
        if (ca === cb) continue;
        const A = carriageways[ca]; const B = carriageways[cb];
        const na = A.nodes; const nb = B.nodes; const i = list[a + 1]; const j = list[b + 1];
        const hit = cross(na[i], na[i + 1], nb[j], nb[j + 1]);
        if (!hit || atEnd(na, i, hit.t) || atEnd(nb, j, hit.u)) continue;
        // (a pair of segments spanning several cells meets in each: once)
        const key = ca < cb ? `${ca}:${i}:${cb}:${j}` : `${cb}:${j}:${ca}:${i}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const za = na[i][2] + (na[i + 1][2] - na[i][2]) * hit.t;
        const zb = nb[j][2] + (nb[j + 1][2] - nb[j][2]) * hit.u;
        const gap = Math.abs(za - zb);
        // two ground roads crossing level on one layer: a junction OSM did not
        // join (not a grade separation)
        if (!isStructure(A) && !isStructure(B) && layerOf(A) === layerOf(B) && gap < 1) continue;
        crossings++;
        if (gap < CROSSING_SEPARATION_M - CROSSING_TOLERANCE_M) {
          short.push({
            shortfall: CROSSING_SEPARATION_M - gap, gap,
            x: na[i][0] + (na[i + 1][0] - na[i][0]) * hit.t, y: na[i][1] + (na[i + 1][1] - na[i][1]) * hit.t,
            roads: [roadName(A), roadName(B)],
          });
        }
      }
    }
  }
  const w = worst(short, 'shortfall');
  return { crossings, short: short.length, worst: w && { gap: round(w.gap), need: CROSSING_SEPARATION_M, at: [round(w.x, 1), round(w.y, 1)], roads: w.roads }, top: top(short, 'shortfall', (it) => `${it.roads.join(' / ')} (gap ${round(it.gap)} m)`) };
}

/** Ground roads floating over or buried in the terrain. */
export function checkGroundGaps(carriageways, groundAt) {
  const gaps = [];
  let nodes = 0;
  for (const cw of carriageways) {
    if (isStructure(cw)) continue;
    for (const [x, y, z] of cw.nodes || []) {
      const g = groundAt(x, y);
      if (!Number.isFinite(g)) continue;
      nodes++;
      const dz = z - g;
      if (Math.abs(dz) > GROUND_GAP_M) gaps.push({ gap: Math.abs(dz), dz, x, y, road: roadName(cw) });
    }
  }
  const w = worst(gaps, 'gap');
  return { nodes, off: gaps.length, worst: w && { dz: round(w.dz), at: [round(w.x, 1), round(w.y, 1)], road: w.road }, top: top(gaps, 'gap', (it) => `${it.road} (${it.dz > 0 ? 'over' : 'under'} the ground)`) };
}

/**
 * Terrain through a deck: standing over its road surface, or poking up into
 * its underside where the ground before and after is clear of it. A low deck
 * resting on its fill and a deck landing on its abutment are by design (the
 * bridge code lets a deck rest where it runs within 1.5 m of the ground), so
 * they are not counted.
 */
export function checkThroughDecks(decks, groundAt) {
  const hits = [];
  let samples = 0;
  (decks || []).forEach((deck, di) => {
    const name = `b${String(di + 1).padStart(3, '0')}`;
    for (const part of deck.parts || []) {
      const { xy, z } = part;
      if (!xy || !z) continue;
      const under = part.depth ?? DECK_UNDERSIDE_M;
      // samples along the part: per lane offset, ground, underside and top
      const rows = [];
      for (let i = 0; i + 1 < xy.length; i++) {
        const [ax, ay] = xy[i]; const [bx, by] = xy[i + 1];
        const L = Math.hypot(bx - ax, by - ay);
        if (L < 1e-6) continue;
        const nx = -(by - ay) / L; const ny = (bx - ax) / L;
        const steps = Math.max(1, Math.ceil(L / DECK_SAMPLE_M));
        for (let k = (rows.length ? 1 : 0); k <= steps; k++) {
          const f = k / steps;
          const cx = ax + (bx - ax) * f; const cy = ay + (by - ay) * f;
          const top = z[i] + (z[i + 1] - z[i]) * f;
          rows.push([-part.half, 0, part.half].map((o) => ({ x: cx + nx * o, y: cy + ny * o, g: groundAt(cx + nx * o, cy + ny * o), top, bottom: top - under })));
        }
      }
      const NEAR = 3;   // samples (6 m) before and after for "clear around it"
      for (let k = 0; k < rows.length; k++) {
        for (let lane = 0; lane < 3; lane++) {
          const s0 = rows[k][lane];
          if (!Number.isFinite(s0.g)) continue;
          samples++;
          let by = 0;
          if (s0.g > s0.top + THROUGH_DECK_M) by = s0.g - s0.top;          // over the road surface
          else if (s0.g > s0.bottom + THROUGH_DECK_M && k >= NEAR && k + NEAR < rows.length) {
            const before = rows[k - NEAR][lane]; const after = rows[k + NEAR][lane];
            if (before.g < before.bottom - 1 && after.g < after.bottom - 1) by = s0.g - s0.bottom;   // into a clear underside
          }
          if (by > 0) hits.push({ by, x: s0.x, y: s0.y, deck: name });
        }
      }
    }
  });
  const w = worst(hits, 'by');
  return { samples, through: hits.length, worst: w && { by: round(w.by), at: [round(w.x, 1), round(w.y, 1)], deck: w.deck }, top: top(hits, 'by', (it) => it.deck) };
}

/**
 * Isolated spikes and pits in the terrain around structures: pixels far from
 * the median of their 3×3 neighbourhood. `grid` = { heightMap, width, height,
 * worldSize } (world x, y centred on the map, y north).
 */
export function checkSpikes(decks, tunnels, grid) {
  const { heightMap, width, height, worldSize } = grid || {};
  if (!heightMap || !width || !height || !worldSize) return { pixels: 0, spikes: 0, worst: null };
  const toPixel = (x, y) => [(x / worldSize + 0.5) * (width - 1), (0.5 - y / worldSize) * (height - 1)];
  const toWorld = (c, r) => [((c / (width - 1)) - 0.5) * worldSize, (0.5 - r / (height - 1)) * worldSize];
  const pxPerM = (width - 1) / worldSize;
  const lines = [];
  for (const deck of decks || []) for (const part of deck.parts || []) if (part.xy?.length) lines.push({ pts: part.xy, reach: (part.half || 0) + SPIKE_REACH_M });
  for (const t of tunnels || []) if (t.line?.length) lines.push({ pts: t.line.map((p) => [p.x, p.y]), reach: (t.headHalf || t.W || 0) + SPIKE_REACH_M });
  // pixel blocks near any structure (16 px), each scanned once
  const BLOCK = 16;
  const blocks = new Set();
  for (const { pts, reach } of lines) {
    const rpx = reach * pxPerM;
    for (let i = 0; i < pts.length; i++) {
      const a = toPixel(pts[i][0], pts[i][1]);
      const b = i + 1 < pts.length ? toPixel(pts[i + 1][0], pts[i + 1][1]) : a;
      const steps = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / BLOCK));
      for (let k = 0; k <= steps; k++) {
        const c = a[0] + (b[0] - a[0]) * (k / steps); const r = a[1] + (b[1] - a[1]) * (k / steps);
        for (let bc = Math.floor((c - rpx) / BLOCK); bc <= Math.floor((c + rpx) / BLOCK); bc++) {
          for (let br = Math.floor((r - rpx) / BLOCK); br <= Math.floor((r + rpx) / BLOCK); br++) if (bc >= 0 && br >= 0) blocks.add(bc * 65536 + br);
        }
      }
    }
  }
  const spikes = [];
  let pixels = 0;
  const win = new Float64Array(9);
  for (const key of blocks) {
    const bc = Math.floor(key / 65536); const br = key - bc * 65536;
    for (let r = Math.max(1, br * BLOCK); r < Math.min(height - 1, (br + 1) * BLOCK); r++) {
      for (let c = Math.max(1, bc * BLOCK); c < Math.min(width - 1, (bc + 1) * BLOCK); c++) {
        let k = 0;
        for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) win[k++] = heightMap[(r + dr) * width + c + dc];
        const h = win[4];
        if (!Number.isFinite(h) || h < -10000) continue;
        pixels++;
        win.sort();
        const off = Math.abs(h - win[4]);
        if (off > SPIKE_M) {
          const [x, y] = toWorld(c, r);
          spikes.push({ off, x, y });
        }
      }
    }
  }
  const w = worst(spikes, 'off');
  return { pixels, spikes: spikes.length, worst: w && { off: round(w.off), at: [round(w.x, 1), round(w.y, 1)] }, top: top(spikes, 'off', () => 'terrain') };
}

// ── Road surface: what the road smoothing left under ground roads ─────────
// Grade change over a few metres (a bump or dip), by road class.
const KINK_MAX = {
  motorway: 0.04, motorway_link: 0.05, trunk: 0.04, trunk_link: 0.05,
  primary: 0.06, primary_link: 0.06, secondary: 0.06, secondary_link: 0.06,
};
const KINK_DEFAULT = 0.1;
const KINK_RUN_M = 6;             // grade before and after a point, over this far
const CROSS_STEP_M = 6;           // cross-section samples along a road
const CROSS_SLOPE_MAX = 0.08;     // tilt across the road
const CROSS_HUMP_M = 0.2;         // centre off the line between the two edges
const JUNCTION_RING_M = 12;       // compare a junction's centre with this far out
const JUNCTION_BUMP_M = 0.25;
// A crease just outside a road's edge: the ground's slope changing sharply
// between 1-4 m and 4-8 m out (a smoothed corridor sunk into a crest or
// raised over a sag meets the untouched terrain in a line).
const CREASE_SLOPE_CHANGE = 0.3;

// height and position along a node list at arc length s (clamped)
function along(n, s) {
  let acc = 0;
  for (let i = 0; i + 1 < n.length; i++) {
    const L = Math.hypot(n[i + 1][0] - n[i][0], n[i + 1][1] - n[i][1]);
    if (acc + L >= s || i + 2 === n.length) {
      const f = L > 0 ? Math.min(1, Math.max(0, (s - acc) / L)) : 0;
      return [n[i][0] + (n[i + 1][0] - n[i][0]) * f, n[i][1] + (n[i + 1][1] - n[i][1]) * f, n[i][2] + (n[i + 1][2] - n[i][2]) * f];
    }
    acc += L;
  }
  return n[n.length - 1];
}

/**
 * The terrain under ground roads (the road smoothing's result): bumps and
 * dips along them, tilt or a hump across them, and bumps or dips at the
 * centre of junctions. `lines` as roadLinesFromDecals gives them.
 */
export function checkRoadSurface(lines, groundAt) {
  const kinks = []; const cross = []; const bumps = []; const creases = [];
  let kinkPts = 0; let crossPts = 0; let creasePts = 0;
  const ground = lines.filter((cw) => !isStructure(cw) && (cw.nodes || []).length >= 2);
  for (const cw of ground) {
    const n = cw.nodes;
    const s = [0];
    for (let i = 1; i < n.length; i++) s.push(s[i - 1] + Math.hypot(n[i][0] - n[i - 1][0], n[i][1] - n[i - 1][1]));
    const total = s[s.length - 1];
    const max = KINK_MAX[cw.highway] ?? KINK_DEFAULT;
    // along: grade over the KINK_RUN_M before and after each point; one hit
    // per bump (skip on past it)
    for (let at = KINK_RUN_M; at + KINK_RUN_M <= total; at += 2) {
      kinkPts++;
      const a = along(n, at - KINK_RUN_M); const b = along(n, at); const c = along(n, at + KINK_RUN_M);
      const kink = Math.abs((c[2] - b[2]) - (b[2] - a[2])) / KINK_RUN_M;
      if (kink > max) { kinks.push({ kink, max, x: b[0], y: b[1], road: roadName(cw) }); at += KINK_RUN_M; }
    }
    // across: the ground at both edges and the centre
    const half = cw.half || 3;
    for (let at = 0; at <= total; at += CROSS_STEP_M) {
      const p = along(n, at); const q = along(n, Math.min(total, at + 1));
      const dx = q[0] - p[0]; const dy = q[1] - p[1]; const L = Math.hypot(dx, dy);
      if (L < 1e-6) continue;
      const nx = -dy / L; const ny = dx / L;
      const gl = groundAt(p[0] + nx * half, p[1] + ny * half); const gr = groundAt(p[0] - nx * half, p[1] - ny * half); const gc = groundAt(p[0], p[1]);
      if (![gl, gr, gc].every(Number.isFinite)) continue;
      crossPts++;
      const tilt = Math.abs(gl - gr) / (2 * half);
      const hump = gc - (gl + gr) / 2;
      for (const side of [1, -1]) {
        const at = (o) => groundAt(p[0] + side * nx * (half + o), p[1] + side * ny * (half + o));
        const h1 = at(1); const h4 = at(4); const h8 = at(8);
        if (![h1, h4, h8].every(Number.isFinite)) continue;
        creasePts++;
        const change = Math.abs((h8 - h4) / 4 - (h4 - h1) / 3);
        if (change > CREASE_SLOPE_CHANGE) creases.push({ change, x: p[0] + side * nx * (half + 4), y: p[1] + side * ny * (half + 4), road: roadName(cw) });
      }
      if (tilt > CROSS_SLOPE_MAX || Math.abs(hump) > CROSS_HUMP_M) {
        cross.push({ bad: Math.max(tilt / CROSS_SLOPE_MAX, Math.abs(hump) / CROSS_HUMP_M), tilt, hump, x: p[0], y: p[1], road: roadName(cw) });
      }
    }
  }
  // junctions: ground-road ends meeting three or more at a point
  const ends = new Map();
  ground.forEach((cw, li) => {
    const n = cw.nodes;
    for (const [node, fromStart] of [[n[0], true], [n[n.length - 1], false]]) {
      const key = `${Math.round(node[0])},${Math.round(node[1])}`;
      if (!ends.has(key)) ends.set(key, []);
      ends.get(key).push({ li, fromStart, x: node[0], y: node[1] });
    }
  });
  let junctions = 0;
  for (const list of ends.values()) {
    if (new Set(list.map((e) => e.li)).size < 3) continue;
    junctions++;
    const cx = list.reduce((a, e) => a + e.x, 0) / list.length; const cy = list.reduce((a, e) => a + e.y, 0) / list.length;
    const gc = groundAt(cx, cy);
    const ring = [];
    for (const e of list) {
      const n = ground[e.li].nodes;
      let total = 0;
      for (let i = 1; i < n.length; i++) total += Math.hypot(n[i][0] - n[i - 1][0], n[i][1] - n[i - 1][1]);
      if (total < JUNCTION_RING_M) continue;
      const p = along(n, e.fromStart ? JUNCTION_RING_M : total - JUNCTION_RING_M);
      const g = groundAt(p[0], p[1]);
      if (Number.isFinite(g)) ring.push(g);
    }
    if (ring.length < 3 || !Number.isFinite(gc)) continue;
    const bump = gc - ring.reduce((a, v) => a + v, 0) / ring.length;
    if (Math.abs(bump) > JUNCTION_BUMP_M) {
      const names = [...new Set(list.map((e) => roadName(ground[e.li])))].slice(0, 3).join(' / ');
      bumps.push({ size: Math.abs(bump), bump, x: cx, y: cy, roads: names });
    }
  }
  const wk = worst(kinks, 'kink'); const wc = worst(cross, 'bad'); const wb = worst(bumps, 'size'); const wr = worst(creases, 'change');
  return {
    creases: { points: creasePts, count: creases.length, worst: wr && { change: round(wr.change, 2), at: [round(wr.x, 1), round(wr.y, 1)], road: wr.road }, top: top(creases, 'change', (it) => it.road) },
    kinks: { points: kinkPts, count: kinks.length, worst: wk && { kink: round(wk.kink, 3), limit: wk.max, at: [round(wk.x, 1), round(wk.y, 1)], road: wk.road }, top: top(kinks, 'kink', (it) => `${it.road} (limit ${Math.round(it.max * 100)}%)`) },
    cross: { points: crossPts, count: cross.length, worst: wc && { tilt: round(wc.tilt, 3), hump: round(wc.hump), at: [round(wc.x, 1), round(wc.y, 1)], road: wc.road }, top: top(cross, 'bad', (it) => `${it.road} (tilt ${Math.round(it.tilt * 100)}%, hump ${round(it.hump)} m)`) },
    junctions: { checked: junctions, count: bumps.length, worst: wb && { bump: round(wb.bump), at: [round(wb.x, 1), round(wb.y, 1)], roads: wb.roads }, top: top(bumps, 'size', (it) => `${it.roads} (${it.bump > 0 ? 'bump' : 'dip'})`) },
  };
}

/**
 * All structure checks for one export. `carriageways` as generateDecalRoads
 * returns them ({ nodes: [[x, y, z, w]...], bridge, tunnel, highway, tags }),
 * `decks` / `tunnels` from the bridge and tunnel results, `groundAt(x, y)` the
 * final terrain height in world z, `grid` for the spike scan.
 */
export function measureStructures({ carriageways = [], decks = [], tunnels = [], groundAt, grid }) {
  const t0 = typeof performance !== 'undefined' ? performance.now() : Date.now();
  const result = {
    joints: checkJoints(carriageways),
    grades: checkGrades(carriageways),
    crossings: checkCrossings(carriageways),
    groundGaps: groundAt ? checkGroundGaps(carriageways, groundAt) : null,
    throughDecks: groundAt ? checkThroughDecks(decks, groundAt) : null,
    spikes: checkSpikes(decks, tunnels, grid),
    surface: groundAt ? checkRoadSurface(carriageways, groundAt) : null,
  };
  result.ms = Math.round((typeof performance !== 'undefined' ? performance.now() : Date.now()) - t0);
  return result;
}
