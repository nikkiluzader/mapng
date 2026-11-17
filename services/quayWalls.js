// Quay walls: the wall a town's ground stands behind at the water's edge.
//
// A river wall, a canal's quay or a dock's side is a vertical wall. In the terrain it is a drop of a metre or
// more within a few squares, and a heightmap can only show that as a steep bank of ground: smeared earth and
// rock down to the water, toothed wherever the quay runs off the grid's axes (the Tower of London's wharf,
// Hamburg's Speicherstadt, Utrecht's Oudegracht). Here the bank is found along each mapped water's edge and a
// plain block is stood over it: its top level with the ground behind, its face straight down into the water.
//
// The block follows the rule for generated structures: it keeps a clean shape and runs into the ground under the
// water (QUAY_BURY_M); nothing is fitted to the bank it hides.
//
// planQuayWalls(lines, opts) -> runs; quayWallTriangles(runs) -> triangles; buildQuayWallMesh(...) -> a mesh.
import * as THREE from 'three';

const STEP_M = 2;                 // stations along the water's edge
const WATER_IN_M = 6;              // the water looked for this far out from the mapped edge (a narrow canal: no further)
const SCAN_M = 15;                // ... and the bank this far in from it (a tidal river's edge is mapped at low water, off its wall)
const SAME_M = 1.5;               // a wall within this of one already planned (two mapped outlines of one water) is left out
const SCAN_STEP_M = 0.5;
const WATER_UNDER_M = 0.3;        // the export's ground this far under the surveyed surface: water stands there
const QUAY_MIN_M = 0.8;           // the ground behind this far over the water: a quay (lower: a beach, a slip)
const QUAY_MAX_W_M = 4.5;         // ... reached within this of the water's edge (wider: a sloping bank)
const TOP_FLAT_M = 0.25;          // the top of the bank: where the ground rises less than this in TOP_AHEAD_M
const TOP_AHEAD_M = 1.5;
const BLOCK_IN_M = 0.4;           // the block starts this far behind the top of the bank ...
const BLOCK_OUT_M = 0.4;          // ... and its face stands this far out past the bank's wet foot
const BLOCK_TOP_M = 0.02;         // its top over the ground behind
const QUAY_BURY_M = 2;            // its face ends this far under the lowest bed along the run
const RUN_MIN_M = 8;              // shorter runs are left out
const GAP_STATIONS = 1;           // a run carries on over this many stations without a bank
const SMOOTH = 2;                 // stations either way a run's lines are evened over

const median = (a) => { const s = [...a].sort((p, q) => p - q); return s[s.length >> 1]; };

/**
 * lines: [{ xy: [[x, y]...], closed }] the mapped waters' edges (areas' outlines, coastlines), world metres.
 * opts.groundAt(x, y): the level's ground; opts.surveyAt(x, y): the ground as surveyed, before the water's bed
 * was dug (the water's surface on a fine survey); opts.hardAt(x, y): true where the land is a town's (paved or
 * built on): a bank in the open country is left as ground; opts.skipAt(x, y): true where no wall may stand.
 * Returns runs: [{ stations: [{ x, y, nx, ny, inner, outer, z, foot }] }]: (nx, ny) points from the water to the
 * land, inner/outer are offsets along it from the mapped edge (outer < inner), z the block's top.
 */
export function planQuayWalls(lines, { groundAt, surveyAt, hardAt = () => true, skipAt = () => false } = {}) {
  const runs = [];
  const taken = new Set();   // where a wall's top stands already
  for (const line of lines || []) {
    const xy = line.xy;
    if (!xy || xy.length < 2) continue;
    // stations every STEP_M along the line
    const st = [];
    let carry = 0;
    for (let i = 0; i + 1 < xy.length; i++) {
      const [ax, ay] = xy[i]; const [bx, by] = xy[i + 1];
      const L = Math.hypot(bx - ax, by - ay);
      if (L < 1e-6) continue;
      const tx = (bx - ax) / L; const ty = (by - ay) / L;
      for (let d = carry; d < L; d += STEP_M) st.push({ x: ax + tx * d, y: ay + ty * d, tx, ty });
      carry = (carry - L) % STEP_M; if (carry < 0) carry += STEP_M;
    }
    // each station: which side is water, where the bank's wet foot and its top are
    const found = st.map((q) => {
      for (const side of [1, -1]) {
        // (nx, ny): from the water to the land, when the water is on this side
        const nx = -q.ty * side; const ny = q.tx * side;
        const at = (t) => [q.x + nx * t, q.y + ny * t];
        // (water: the level's ground under the surveyed surface, somewhere just off the mapped edge)
        let from = null; let surf = 0;
        for (let t0 = -WATER_IN_M; t0 <= -1; t0 += 1) {
          const [wx, wy] = at(t0); const sv = surveyAt(wx, wy);
          if (Number.isFinite(sv) && groundAt(wx, wy) < sv - WATER_UNDER_M) { from = t0; surf = sv; break; }
        }
        if (from === null) continue;
        // from the water in: the last point still under the surface, then the top of the bank
        let wet = null; let top = null; let zTop = 0; let bed = Infinity;
        for (let t = from; t <= SCAN_M; t += SCAN_STEP_M) {
          const z = groundAt(...at(t));
          if (top === null && z < surf + 0.15) { wet = t; bed = Math.min(bed, z); continue; }
          if (wet === null) break;
          if (z - surf >= QUAY_MIN_M && groundAt(...at(t + TOP_AHEAD_M)) - z < TOP_FLAT_M) { top = t; zTop = z; break; }
          if (t - wet > QUAY_MAX_W_M) break;
        }
        if (top === null || wet === null || top - wet > QUAY_MAX_W_M) continue;
        const land = at(top + 3);
        if (!hardAt(land[0], land[1]) || skipAt(q.x + nx * top, q.y + ny * top)) continue;
        const [kx, ky] = at(top);
        if (taken.has(`${Math.round(kx / SAME_M)},${Math.round(ky / SAME_M)}`)) continue;
        return { x: q.x, y: q.y, nx, ny, side, inner: top + BLOCK_IN_M, outer: wet - BLOCK_OUT_M, z: zTop + BLOCK_TOP_M, foot: bed, key: [kx, ky] };
      }
      return null;
    });
    // runs of stations on one side, carried over short gaps
    let cur = [];
    const close = () => {
      if (cur.length * STEP_M >= RUN_MIN_M) runs.push({ stations: evened(cur) });
      cur = [];
    };
    let gap = 0;
    for (const f of found) {
      if (f && (!cur.length || cur[cur.length - 1].side === f.side)) { cur.push(f); gap = 0; continue; }
      if (!f && cur.length && gap < GAP_STATIONS) { gap++; continue; }
      close(); gap = 0;
      if (f) cur.push(f);
    }
    close();
    for (const f of found) {
      if (!f) continue;
      const cx = Math.round(f.key[0] / SAME_M); const cy = Math.round(f.key[1] / SAME_M);
      for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) taken.add(`${cx + dx},${cy + dy}`);
    }
  }
  return runs;
}

/** A run's lines evened along it: the top by its median, the block as wide as its neighbours need, one foot. */
function evened(st) {
  const low = Math.min(...st.map((q) => q.foot)) - QUAY_BURY_M;
  return st.map((q, i) => {
    const near = st.slice(Math.max(0, i - SMOOTH), i + SMOOTH + 1);
    return {
      x: q.x, y: q.y, nx: q.nx, ny: q.ny,
      inner: Math.max(...near.map((p) => p.inner)),
      outer: Math.min(...near.map((p) => p.outer)),
      // (never under the ground behind it here: the highest of the median and this station's own top)
      z: Math.max(median(near.map((p) => p.z)), q.z),
      foot: low,
    };
  });
}

/** The blocks as triangles [[x, y, z] x 3], outward faces counter-clockwise. */
export function quayWallTriangles(runs) {
  const tris = [];
  const quad = (a, b, c, d) => { tris.push([a, b, c], [a, c, d]); };
  const P = (q, off, z) => [q.x + q.nx * off, q.y + q.ny * off, z];
  for (const run of runs) {
    const st = run.stations;
    // (which way the stations run relative to the water decides the winding: the face must look at the water)
    const a0 = st[0]; const b0 = st[1];
    const along = [b0.x - a0.x, b0.y - a0.y];
    const left = along[0] * a0.ny - along[1] * a0.nx > 0;   // the land is on the left of travel
    const put = (q0, q1, q2, q3) => (left ? quad(q0, q1, q2, q3) : quad(q3, q2, q1, q0));
    for (let i = 0; i + 1 < st.length; i++) {
      const a = st[i]; const b = st[i + 1];
      put(P(a, a.outer, a.z), P(b, b.outer, b.z), P(b, b.inner, b.z), P(a, a.inner, a.z));           // top
      put(P(a, a.outer, a.foot), P(b, b.outer, b.foot), P(b, b.outer, b.z), P(a, a.outer, a.z));     // the face to the water
      put(P(a, a.inner, a.z), P(b, b.inner, b.z), P(b, b.inner, b.foot), P(a, a.inner, a.foot));     // the back, in the ground
    }
    for (const [q, first] of [[st[0], true], [st[st.length - 1], false]]) {
      const r = [P(q, q.outer, q.foot), P(q, q.inner, q.foot), P(q, q.inner, q.z), P(q, q.outer, q.z)];
      if (first === left) quad(r[3], r[2], r[1], r[0]); else quad(r[0], r[1], r[2], r[3]);
    }
  }
  return tris;
}

/** One mesh of the quay walls (material name given by the caller). Returns null when there is none. */
export function buildQuayWallMesh(runs, materialName, tileM = 2) {
  const tris = quayWallTriangles(runs);
  if (!tris.length) return null;
  const pos = []; const uv = [];
  for (const [A, B, C] of tris) {
    const nx = (B[1] - A[1]) * (C[2] - A[2]) - (B[2] - A[2]) * (C[1] - A[1]);
    const ny = (B[2] - A[2]) * (C[0] - A[0]) - (B[0] - A[0]) * (C[2] - A[2]);
    const nz = (B[0] - A[0]) * (C[1] - A[1]) - (B[1] - A[1]) * (C[0] - A[0]);
    const ax = Math.abs(nx); const ay = Math.abs(ny); const az = Math.abs(nz);
    for (const v of [A, B, C]) {
      pos.push(v[0], v[1], v[2]);
      if (az >= ax && az >= ay) uv.push(v[0] / tileM, v[1] / tileM);
      else if (ax >= ay) uv.push(v[1] / tileM, v[2] / tileM);
      else uv.push(v[0] / tileM, v[2] / tileM);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pos), 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(uv), 2));
  geo.computeVertexNormals();
  const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ name: materialName }));
  mesh.name = 'quay_walls';
  return mesh;
}
