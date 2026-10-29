// Structure checks: numbers for how well the roads, bridges and tunnels of an
// export fit together and the terrain around them. They measure the result
// (whatever produced it), so the same checks grade today's passes and the
// structure solver that replaces them (refs/output/bridge-tunnel-plan.md).
//
// Nothing here knows about any place: every check is geometry.

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
const GRADE_MIN_RUN_M = 2;        // node pairs closer than this are skipped
// Vertical space a road passing over another needs: clearance + deck.
const CROSSING_SEPARATION_M = 4.5 + 2.2;
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
  return { joints, steps: steps.length, worst: w && { dz: round(w.dz), at: [round(w.x, 1), round(w.y, 1)], roads: [w.a, w.b] } };
}

/** Stretches steeper than their road class should be. */
export function checkGrades(carriageways) {
  const over = { structure: [], ground: [] };
  let pairs = 0;
  for (const cw of carriageways) {
    const n = cw.nodes || [];
    const max = GRADE_MAX[cw.highway] ?? GRADE_DEFAULT;
    for (let i = 0; i + 1 < n.length; i++) {
      const ds = Math.hypot(n[i + 1][0] - n[i][0], n[i + 1][1] - n[i][1]);
      if (ds < GRADE_MIN_RUN_M) continue;
      pairs++;
      const grade = Math.abs(n[i + 1][2] - n[i][2]) / ds;
      if (grade > max) {
        (isStructure(cw) ? over.structure : over.ground).push({
          grade, max, x: (n[i][0] + n[i + 1][0]) / 2, y: (n[i][1] + n[i + 1][1]) / 2, road: roadName(cw),
        });
      }
    }
  }
  const pack = (list) => {
    const w = worst(list, 'grade');
    return { count: list.length, worst: w && { grade: round(w.grade, 3), limit: w.max, at: [round(w.x, 1), round(w.y, 1)], road: w.road } };
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
        if (gap < CROSSING_SEPARATION_M) {
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
  return { crossings, short: short.length, worst: w && { gap: round(w.gap), need: CROSSING_SEPARATION_M, at: [round(w.x, 1), round(w.y, 1)], roads: w.roads } };
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
  return { nodes, off: gaps.length, worst: w && { dz: round(w.dz), at: [round(w.x, 1), round(w.y, 1)], road: w.road } };
}

/** Terrain standing up through a deck's underside. */
export function checkThroughDecks(decks, groundAt) {
  const hits = [];
  let samples = 0;
  (decks || []).forEach((deck, di) => {
    const name = `b${String(di + 1).padStart(3, '0')}`;
    for (const part of deck.parts || []) {
      const { xy, z } = part;
      if (!xy || !z) continue;
      const under = part.depth ?? DECK_UNDERSIDE_M;
      for (let i = 0; i + 1 < xy.length; i++) {
        const [ax, ay] = xy[i]; const [bx, by] = xy[i + 1];
        const L = Math.hypot(bx - ax, by - ay);
        if (L < 1e-6) continue;
        const nx = -(by - ay) / L; const ny = (bx - ax) / L;
        const steps = Math.max(1, Math.ceil(L / DECK_SAMPLE_M));
        for (let k = 0; k <= steps; k++) {
          const f = k / steps;
          const cx = ax + (bx - ax) * f; const cy = ay + (by - ay) * f;
          const bottom = z[i] + (z[i + 1] - z[i]) * f - under;
          for (const o of [-part.half, 0, part.half]) {
            const g = groundAt(cx + nx * o, cy + ny * o);
            if (!Number.isFinite(g)) continue;
            samples++;
            if (g > bottom + THROUGH_DECK_M) hits.push({ by: g - bottom, x: cx + nx * o, y: cy + ny * o, deck: name });
          }
        }
      }
    }
  });
  const w = worst(hits, 'by');
  return { samples, through: hits.length, worst: w && { by: round(w.by), at: [round(w.x, 1), round(w.y, 1)], deck: w.deck } };
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
  return { pixels, spikes: spikes.length, worst: w && { off: round(w.off), at: [round(w.x, 1), round(w.y, 1)] } };
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
  };
  result.ms = Math.round((typeof performance !== 'undefined' ? performance.now() : Date.now()) - t0);
  return result;
}
