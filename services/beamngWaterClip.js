// Water kept out of tunnels. BeamNG water is volume: a WaterPlane is water
// everywhere under its surface (infinitely deep), a WaterBlock or River down
// to its depth. A tunnel under a river or the sea, or a cut-and-cover box and
// its trenches in a low coastal city (Norfolk's Downtown Tunnel: the road 6 m
// under sea level), would be flooded: cars in it float, the camera is
// underwater. So the water over a tube stops above its roof, and none stands
// in an open trench; where any of that is below sea level the sea plane is
// replaced by WaterBlocks over the ground below it (the trench left dry).
//
// Pure: tunnels as services/beamngTunnels.js solves them, world space.

import { LINING_M, WALKWAY_M, extraAt } from './beamngTunnels.js';

const ROOF_CLEAR_M = 0.3;      // water stops this far over a tube's roof
const TUBE_PAD_M = 1.5;        // past the lining
const OPEN_PAD_M = 2;          // past a trench's walls
const MIN_DEPTH_M = 0.2;       // water shallower than this is left out
const SEA_CELL_M = 64;         // the sea's blocks away from tunnels ...
const NEAR_CELL_M = 8;         // ... and near them
const NEAR_PAD_M = 24;         // "near": within this of a dry zone
const FRAME_M = 4000;          // the sea runs on past the map's edge this far

/**
 * Dry zones of solved tunnels: strips along their lines, [{ a, b, half, top }]
 * (top: the water may reach no lower; Infinity for an open trench: none).
 */
export function tunnelDryZones(tunnels = []) {
  const zones = [];
  for (const t of tunnels) {
    for (let i = 0; i + 1 < t.line.length; i++) {
      const p = t.line[i]; const q = t.line[i + 1];
      const inTube = i >= t.iS && i < t.iN;
      const extra = Math.max(extraAt(t, p, 1), extraAt(t, p, -1), extraAt(t, q, 1), extraAt(t, q, -1));
      if (inTube) {
        zones.push({ a: [p.x, p.y], b: [q.x, q.y], half: t.W + extra + LINING_M + TUBE_PAD_M, top: Math.max(p.z, q.z) + t.crown + LINING_M + ROOF_CLEAR_M });
      } else if (p.kind === 'cut' || q.kind === 'cut') {
        zones.push({ a: [p.x, p.y], b: [q.x, q.y], half: (t.wingD ?? t.W) + extra + (t.wingT ?? 1.5) + OPEN_PAD_M, top: Infinity });
      }
    }
    // the headwalls: open in front, the tube behind; a square around each
    for (const [i, on] of [[t.iS, t.portals?.[0]], [t.iN, t.portals?.[1]]]) {
      if (!on) continue;
      const p = t.line[i];
      const r = (t.headHalf ?? t.W) + Math.max(extraAt(t, p, 1), extraAt(t, p, -1)) + OPEN_PAD_M;
      zones.push({ a: [p.x - p.tx * r, p.y - p.ty * r], b: [p.x + p.tx * r, p.y + p.ty * r], half: r, top: Infinity });
    }
    for (const cut of t.cuts || []) {
      for (let i = 0; i + 1 < cut.line.length; i++) {
        const p = cut.line[i]; const q = cut.line[i + 1];
        zones.push({ a: [p.x, p.y], b: [q.x, q.y], half: cut.half + WALKWAY_M + 1.5 + OPEN_PAD_M, top: Infinity });
      }
    }
  }
  for (const z of zones) {
    z.box = [Math.min(z.a[0], z.b[0]) - z.half, Math.min(z.a[1], z.b[1]) - z.half, Math.max(z.a[0], z.b[0]) + z.half, Math.max(z.a[1], z.b[1]) + z.half];
  }
  // a grid of the zones by their boxes, for the lookups below
  const grid = new Map();
  zones.forEach((z, k) => {
    for (let i = Math.floor(z.box[0] / GRID_M); i <= Math.floor(z.box[2] / GRID_M); i++) {
      for (let j = Math.floor(z.box[1] / GRID_M); j <= Math.floor(z.box[3] / GRID_M); j++) {
        const key = `${i},${j}`;
        if (!grid.has(key)) grid.set(key, []);
        grid.get(key).push(k);
      }
    }
  });
  Object.defineProperty(zones, 'grid', { value: grid, enumerable: false });
  return zones;
}

const GRID_M = 32;
// the zones whose boxes may meet x0..x1, y0..y1
function zonesIn(zones, x0, y0, x1, y1) {
  if (!zones.grid) return zones;
  const out = new Set();
  for (let i = Math.floor(x0 / GRID_M); i <= Math.floor(x1 / GRID_M); i++) {
    for (let j = Math.floor(y0 / GRID_M); j <= Math.floor(y1 / GRID_M); j++) {
      for (const k of zones.grid.get(`${i},${j}`) || []) out.add(zones[k]);
    }
  }
  return out;
}

const segDist = (x, y, a, b) => {
  const vx = b[0] - a[0]; const vy = b[1] - a[1];
  const L2 = vx * vx + vy * vy || 1e-9;
  const t = Math.max(0, Math.min(1, ((x - a[0]) * vx + (y - a[1]) * vy) / L2));
  return Math.hypot(a[0] + vx * t - x, a[1] + vy * t - y);
};

/**
 * The lowest the water may reach over the box x0..x1, y0..y1: -Infinity
 * (anywhere), a height (a tube under it), or Infinity (a trench: none).
 */
export function waterFloorIn(zones, x0, y0, x1, y1) {
  let floor = -Infinity;
  const cx = (x0 + x1) / 2; const cy = (y0 + y1) / 2;
  const r = Math.hypot(x1 - x0, y1 - y0) / 2;
  for (const z of zonesIn(zones, x0, y0, x1, y1)) {
    if (z.box[0] > x1 || z.box[2] < x0 || z.box[1] > y1 || z.box[3] < y0) continue;
    if (segDist(cx, cy, z.a, z.b) > z.half + r) continue;
    floor = Math.max(floor, z.top);
    if (floor === Infinity) return floor;
  }
  return floor;
}

/** Whether any tunnel reaches below `level` (its road: in the tube or a trench). */
export function tunnelsBelow(tunnels, level) {
  return tunnels.some((t) => t.line.some((p) => p.z < level));
}

// Cells merged greedily into rectangles, per value (cells a Map of
// "i,j" → value): [{ i, j, w, h, value }]
function mergeCells(cells) {
  const out = [];
  const taken = new Set();
  const keys = [...cells.keys()].map((k) => k.split(',').map(Number)).sort((a, b) => a[1] - b[1] || a[0] - b[0]);
  for (const [i, j] of keys) {
    const k = `${i},${j}`;
    if (taken.has(k)) continue;
    const v = cells.get(k);
    const same = (ii, jj) => !taken.has(`${ii},${jj}`) && cells.get(`${ii},${jj}`) === v;
    let w = 1;
    while (same(i + w, j)) w++;
    let h = 1;
    while ([...Array(w).keys()].every((d) => same(i + d, j + h))) h++;
    for (let dj = 0; dj < h; dj++) for (let di = 0; di < w; di++) taken.add(`${i + di},${j + dj}`);
    out.push({ i, j, w, h, value: v });
  }
  return out;
}

/**
 * The sea as WaterBlocks in place of the plane: over the ground below
 * `seaZ` in the square level (side `size`, centred on 0), clipped by the dry
 * zones, plus a frame past the map's edges where it meets the sea there.
 * heightAt(x, y): the exported ground. Returns [{ cx, cy, sx, sy, z, depth }].
 */
export function planSeaBlocks({ size, seaZ, heightAt, zones, minZ }) {
  const half = size / 2;
  const floorDepth = Math.max(10, seaZ - minZ + 5);
  // near a dry zone: fine cells
  const near = (x0, y0, x1, y1) => [...zonesIn(zones, x0 - NEAR_PAD_M, y0 - NEAR_PAD_M, x1 + NEAR_PAD_M, y1 + NEAR_PAD_M)]
    .some((z) => z.box[0] - NEAR_PAD_M <= x1 && z.box[2] + NEAR_PAD_M >= x0 && z.box[1] - NEAR_PAD_M <= y1 && z.box[3] + NEAR_PAD_M >= y0);
  const wet = (x0, y0, cell) => {
    const n = Math.max(2, Math.round(cell / 8));
    for (let a = 0; a < n; a++) for (let b = 0; b < n; b++) {
      if (heightAt(x0 + ((a + 0.5) * cell) / n, y0 + ((b + 0.5) * cell) / n) < seaZ) return true;
    }
    return false;
  };
  // the sea is what the open water reaches: wet SEA_CELL_M cells joined to
  // the map's edge (the coarse test the sea has always used: the DEM shows a
  // river under sea level only here and there). A road cutting or a basin
  // inland under sea level is no sea: Norfolk's sunk loop ramp filled with it.
  const nR = Math.ceil(size / SEA_CELL_M);
  const reached = new Uint8Array(nR * nR);
  {
    const wetR = new Uint8Array(nR * nR);
    for (let j = 0; j < nR; j++) for (let i = 0; i < nR; i++) {
      if (wet(-half + i * SEA_CELL_M, -half + j * SEA_CELL_M, SEA_CELL_M)) wetR[j * nR + i] = 1;
    }
    const stack = [];
    for (let k = 0; k < nR; k++) for (const idx of [k, (nR - 1) * nR + k, k * nR, k * nR + nR - 1]) {
      if (wetR[idx] && !reached[idx]) { reached[idx] = 1; stack.push(idx); }
    }
    while (stack.length) {
      const idx = stack.pop();
      const i = idx % nR; const j = (idx - i) / nR;
      for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const ii = i + di; const jj = j + dj;
        if (ii < 0 || jj < 0 || ii >= nR || jj >= nR) continue;
        const n2 = jj * nR + ii;
        if (wetR[n2] && !reached[n2]) { reached[n2] = 1; stack.push(n2); }
      }
    }
  }
  const reachedIn = (x0, y0) => {
    const i = Math.floor((x0 + half) / SEA_CELL_M); const j = Math.floor((y0 + half) / SEA_CELL_M);
    return i >= 0 && j >= 0 && i < nR && j < nR && reached[j * nR + i] === 1;
  };
  // a cell's depth: the full sea, clipped over a tube, 0 over a trench
  const depthIn = (x0, y0, cell) => {
    const floor = waterFloorIn(zones, x0, y0, x0 + cell, y0 + cell);
    const d = floor === -Infinity ? floorDepth : seaZ - floor;
    return d < MIN_DEPTH_M ? 0 : Math.round(Math.min(floorDepth, d) * 10) / 10;
  };
  const coarse = new Map();
  const fine = new Map();
  const nC = Math.ceil(size / SEA_CELL_M);
  const sub = SEA_CELL_M / NEAR_CELL_M;
  const edgeWet = { w: 0, e: 0, s: 0, n: 0 };
  for (let j = 0; j < nC; j++) {
    for (let i = 0; i < nC; i++) {
      const x0 = -half + i * SEA_CELL_M; const y0 = -half + j * SEA_CELL_M;
      if (near(x0, y0, x0 + SEA_CELL_M, y0 + SEA_CELL_M)) {
        for (let b = 0; b < sub; b++) for (let a = 0; a < sub; a++) {
          const fx = x0 + a * NEAR_CELL_M; const fy = y0 + b * NEAR_CELL_M;
          if (!reachedIn(fx, fy) || !wet(fx, fy, NEAR_CELL_M)) continue;
          const d = depthIn(fx, fy, NEAR_CELL_M);
          if (d > 0) fine.set(`${i * sub + a},${j * sub + b}`, d);
        }
      } else if (reachedIn(x0, y0)) {
        coarse.set(`${i},${j}`, floorDepth);
        if (i === 0) edgeWet.w++; if (i === nC - 1) edgeWet.e++;
        if (j === 0) edgeWet.s++; if (j === nC - 1) edgeWet.n++;
      }
    }
  }
  const blocks = [];
  const add = (x0, y0, sx, sy, depth) => blocks.push({ cx: x0 + sx / 2, cy: y0 + sy / 2, sx, sy, z: seaZ, depth });
  for (const r of mergeCells(coarse)) add(-half + r.i * SEA_CELL_M, -half + r.j * SEA_CELL_M, r.w * SEA_CELL_M, r.h * SEA_CELL_M, r.value);
  for (const r of mergeCells(fine)) add(-half + r.i * NEAR_CELL_M, -half + r.j * NEAR_CELL_M, r.w * NEAR_CELL_M, r.h * NEAR_CELL_M, r.value);
  // past the edges (the plane ran to the horizon): a strip where a side is
  // mostly sea, the corners where both sides are
  const sea = (k) => edgeWet[k] > nC * 0.3;
  if (sea('w')) add(-half - FRAME_M, -half, FRAME_M, size, floorDepth);
  if (sea('e')) add(half, -half, FRAME_M, size, floorDepth);
  if (sea('s')) add(-half - (sea('w') ? FRAME_M : 0), -half - FRAME_M, size + (sea('w') ? FRAME_M : 0) + (sea('e') ? FRAME_M : 0), FRAME_M, floorDepth);
  if (sea('n')) add(-half - (sea('w') ? FRAME_M : 0), half, size + (sea('w') ? FRAME_M : 0) + (sea('e') ? FRAME_M : 0), FRAME_M, floorDepth);
  return blocks;
}

/**
 * River nodes [x, y, z, width, depth] with the depth held over the tubes
 * under them and the water left out (depth MIN) over open trenches.
 * Returns { nodes, clipped }.
 */
export function clipRiverNodes(nodes, zones) {
  let clipped = 0;
  const out = nodes.map((n) => {
    const [x, y, z, width, depth] = n;
    const r = width / 2;
    const floor = waterFloorIn(zones, x - r, y - r, x + r, y + r);
    if (floor === -Infinity) return n;
    const d = floor === Infinity ? MIN_DEPTH_M : Math.max(MIN_DEPTH_M, Math.min(depth, z - floor));
    if (d < depth) clipped++;
    return [x, y, z, width, d, ...n.slice(5)];
  });
  return { nodes: out, clipped };
}

/**
 * A lake tile ({ cx, cy, sx, sy, z }, full depth `depth`) over the dry
 * zones: its depth there, 0 to leave it out.
 */
export function clipLakeTile(tile, depth, zones) {
  const floor = waterFloorIn(zones, tile.cx - tile.sx / 2, tile.cy - tile.sy / 2, tile.cx + tile.sx / 2, tile.cy + tile.sy / 2);
  if (floor === -Infinity) return depth;
  if (floor === Infinity) return 0;
  const d = Math.min(depth, tile.z - floor);
  return d < MIN_DEPTH_M ? 0 : d;
}
