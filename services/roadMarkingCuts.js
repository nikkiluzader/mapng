// Geometric cuts for road paint (BeamNG.Earth's approach, roads.py
// `cut_outside`): every painted line stops where it would run onto ANOTHER
// road's carriageway, plus a margin, instead of a fixed distance from the
// junction node. Junctions of any size come out clean, slip lanes and
// crossing roads never get paint across them, and edge blends stop at the
// asphalt of the road they meet.
//
// Works on DecalRoad nodes in world space: [x, y, z, width].

const CELL_M = 16;
const SAMPLE_STEP_M = 0.5;

/**
 * Spatial index of carriageways: [{ owner, nodes: [[x,y,z,w]...], half }].
 * `half` is the half width of the paved surface.
 */
export function buildCarriagewayIndex(carriageways) {
  const segments = [];
  const grid = new Map();
  const add = (idx, x0, y0, x1, y1) => {
    for (let gx = Math.floor(x0 / CELL_M); gx <= Math.floor(x1 / CELL_M); gx++) {
      for (let gy = Math.floor(y0 / CELL_M); gy <= Math.floor(y1 / CELL_M); gy++) {
        const key = `${gx},${gy}`;
        if (!grid.has(key)) grid.set(key, []);
        grid.get(key).push(idx);
      }
    }
  };
  for (const cw of carriageways) {
    for (let i = 0; i + 1 < cw.nodes.length; i++) {
      const a = cw.nodes[i];
      const b = cw.nodes[i + 1];
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
      const idx = segments.push({
        ax: a[0], ay: a[1], bx: b[0], by: b[1], half: cw.half, owner: cw.owner,
        ux: (b[0] - a[0]) / len, uy: (b[1] - a[1]) / len,
      }) - 1;
      const pad = cw.half + 4;
      add(idx, Math.min(a[0], b[0]) - pad, Math.min(a[1], b[1]) - pad, Math.max(a[0], b[0]) + pad, Math.max(a[1], b[1]) + pad);
    }
  }
  return { segments, grid };
}

/**
 * Is (x, y) on another road's carriageway, widened by `margin`?
 * `ignore(owner)` skips the road itself and its plain continuations.
 */
export function isOnOtherCarriageway(index, x, y, margin, ignore) {
  const cell = index.grid.get(`${Math.floor(x / CELL_M)},${Math.floor(y / CELL_M)}`);
  if (!cell) return false;
  for (const idx of cell) {
    const s = index.segments[idx];
    if (ignore(s.owner)) continue;
    const dx = s.bx - s.ax;
    const dy = s.by - s.ay;
    const len = dx * dx + dy * dy;
    const t = len > 0 ? Math.max(0, Math.min(1, ((x - s.ax) * dx + (y - s.ay) * dy) / len)) : 0;
    const ex = s.ax + t * dx - x;
    const ey = s.ay + t * dy - y;
    const reach = s.half + margin;
    if (ex * ex + ey * ey < reach * reach) return true;
  }
  return false;
}

const lerpNode = (a, b, t) => [
  a[0] + (b[0] - a[0]) * t,
  a[1] + (b[1] - a[1]) * t,
  a[2] + (b[2] - a[2]) * t,
  a[3] + (b[3] - a[3]) * t,
];
const roundNode = (n) => n.map((v) => Math.round(v * 1000) / 1000);

/**
 * Split a node list into the runs where `blocked(x, y)` is false. Samples
 * every SAMPLE_STEP_M; a run keeps its first and last sample plus the
 * original vertices between them. Runs shorter than `minPieceM` are dropped
 * (BeamNG.Earth: 3 m).
 */
export function cutNodes(nodes, blocked, { minPieceM = 3 } = {}) {
  const samples = [];
  for (let i = 0; i + 1 < nodes.length; i++) {
    const a = nodes[i];
    const b = nodes[i + 1];
    const steps = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / SAMPLE_STEP_M));
    for (let k = i === 0 ? 0 : 1; k <= steps; k++) {
      const p = lerpNode(a, b, k / steps);
      samples.push({ p, vertex: k === 0 || k === steps, free: !blocked(p[0], p[1]) });
    }
  }
  const runs = [];
  let i = 0;
  while (i < samples.length) {
    if (!samples[i].free) { i++; continue; }
    let j = i;
    while (j + 1 < samples.length && samples[j + 1].free) j++;
    const run = [samples[i].p];
    for (let k = i + 1; k < j; k++) if (samples[k].vertex) run.push(samples[k].p);
    if (j > i) run.push(samples[j].p);
    let length = 0;
    for (let k = 1; k < run.length; k++) length += Math.hypot(run[k][0] - run[k - 1][0], run[k][1] - run[k - 1][1]);
    if (run.length >= 2 && length >= minPieceM) runs.push(run.map(roundNode));
    i = j + 1;
  }
  return runs;
}

// Segments within reach of (x, y): [{ s, distance }].
function nearbySegments(index, x, y, extra) {
  const out = [];
  for (const idx of index.grid.get(`${Math.floor(x / CELL_M)},${Math.floor(y / CELL_M)}`) || []) {
    const s = index.segments[idx];
    const dx = s.bx - s.ax;
    const dy = s.by - s.ay;
    const len = dx * dx + dy * dy;
    const t = len > 0 ? Math.max(0, Math.min(1, ((x - s.ax) * dx + (y - s.ay) * dy) / len)) : 0;
    const distance = Math.hypot(s.ax + t * dx - x, s.ay + t * dy - y);
    if (distance < s.half + extra) out.push({ s, distance });
  }
  return out;
}

// Roads running across `dir` (not along it): crossing streets at a junction.
const PARALLEL_COS = 0.85;
const isParallel = (s, dir) => Math.abs(s.ux * dir[0] + s.uy * dir[1]) > PARALLEL_COS;

/** Is (x, y) on a carriageway that runs ACROSS `dir`, widened by `margin`? */
export function isOnCrossingCarriageway(index, x, y, margin, dir) {
  return nearbySegments(index, x, y, margin).some(({ s }) => !isParallel(s, dir));
}

/**
 * The drawn road running along `dir` at (x, y): { half, dir } with `dir`
 * its segment direction (sign matched to the input), or null.
 */
export function parallelRoadAt(index, x, y, dir) {
  let best = null;
  for (const { s, distance } of nearbySegments(index, x, y, 1)) {
    if (!isParallel(s, dir)) continue;
    if (!best || distance < best.distance) best = { distance, s };
  }
  if (!best) return null;
  const sign = best.s.ux * dir[0] + best.s.uy * dir[1] >= 0 ? 1 : -1;
  return { half: best.s.half, dir: [best.s.ux * sign, best.s.uy * sign] };
}

/** Half width of the road running along `dir` at (x, y), or null. */
export function parallelHalfWidthAt(index, x, y, dir) {
  return parallelRoadAt(index, x, y, dir)?.half ?? null;
}

// Zones binned on the carriageway grid, built once per zone list: scanning
// every crosswalk for every 0.5 m paint sample was most of Manhattan's
// road layout.
const zoneGrids = new WeakMap();
function zoneGridFor(zones) {
  let grid = zoneGrids.get(zones);
  if (grid) return grid;
  grid = new Map();
  for (const z of zones) {
    const r = Math.hypot(z.halfLength, z.halfWidth);
    for (let gx = Math.floor((z.x - r) / CELL_M); gx <= Math.floor((z.x + r) / CELL_M); gx++) {
      for (let gy = Math.floor((z.y - r) / CELL_M); gy <= Math.floor((z.y + r) / CELL_M); gy++) {
        const key = `${gx},${gy}`;
        if (!grid.has(key)) grid.set(key, []);
        grid.get(key).push(z);
      }
    }
  }
  zoneGrids.set(zones, grid);
  return grid;
}

/**
 * Crosswalk bands as cut zones: { x, y, ux, uy (along the road), halfLength,
 * halfWidth }. Lines along the road stop at them.
 */
export function isInZone(zones, x, y) {
  if (!zones?.length) return false;
  const cell = zoneGridFor(zones).get(`${Math.floor(x / CELL_M)},${Math.floor(y / CELL_M)}`);
  if (!cell) return false;
  for (const z of cell) {
    const dx = x - z.x;
    const dy = y - z.y;
    const along = dx * z.ux + dy * z.uy;
    const across = -dx * z.uy + dy * z.ux;
    if (Math.abs(along) <= z.halfLength && Math.abs(across) <= z.halfWidth) return true;
  }
  return false;
}
