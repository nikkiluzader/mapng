// Steps (highway=steps): a concrete flight along the way, following the ground. Until 2026-11-24 a mapped flight of
// steps was not built at all: only the ground painting showed, a dirt line up the slope (sidewalk test level).
//
// The ground along the way (sampled every SAMPLE_M, smoothed over SMOOTH_M) is rounded up to whole risers of at most
// RISE_MAX_M, so each tread stands level, on or just over the ground; a flight with less than FLAT_RISE_M of rise is a
// raised paved strip. Every tread is a solid block of the flight's width, run BURY_M under the lowest ground beneath
// it (generated structures keep a clean shape and run into the ground; nothing is fitted to the terrain).
//
// planStepFlights(ways, groundAt) -> flights; buildStepFlightMeshes(flights) -> { meshes, count, triangles, treads }.
import * as THREE from 'three';
import { SIDEWALK_MATERIALS } from './beamngSidewalks.js';
import { fastHypot } from './fastMath.js';

export const SAMPLE_M = 0.1;
export const SMOOTH_M = 2;
export const RISE_MAX_M = 0.17;
export const FLAT_RISE_M = 0.12;
export const FLAT_LIFT_M = 0.12;
export const BURY_M = 0.3;
export const DEFAULT_WIDTH_M = 1.5;
export const WIDTH_RANGE_M = [1, 8];
const MIN_LENGTH_M = 1;

/** The flight's width: width=, else DEFAULT_WIDTH_M, held to WIDTH_RANGE_M. */
export function stepWidth(tags = {}) {
  const w = Number.parseFloat(tags.width);
  return Number.isFinite(w) && w > 0 ? Math.min(WIDTH_RANGE_M[1], Math.max(WIDTH_RANGE_M[0], w)) : DEFAULT_WIDTH_M;
}

// points every SAMPLE_M along a polyline [[x, y], ...]: { x, y, s, ux, uy }
function sampleAlong(nodes) {
  const out = [];
  let s0 = 0;
  for (let i = 0; i + 1 < nodes.length; i++) {
    const [ax, ay] = nodes[i]; const [bx, by] = nodes[i + 1];
    const L = fastHypot(bx - ax, by - ay);
    if (L < 1e-6) continue;
    const ux = (bx - ax) / L; const uy = (by - ay) / L;
    const n = Math.max(1, Math.ceil(L / SAMPLE_M));
    for (let k = out.length ? 1 : 0; k <= n; k++) {
      const t = (k / n) * L;
      out.push({ x: ax + ux * t, y: ay + uy * t, s: s0 + t, ux, uy });
    }
    s0 += L;
  }
  return out;
}

/**
 * ways: [{ nodes: [[x, y], ...], width }]; groundAt(x, y) -> the finished ground. Returns one flight per way long
 * enough: { width, treads: [{ pts: [{x, y, ux, uy}], top, bottom }], rise, flat }.
 */
export function planStepFlights(ways = [], groundAt) {
  const flights = [];
  for (const w of ways) {
    const pts = sampleAlong(w.nodes || []);
    if (pts.length < 2 || pts[pts.length - 1].s < MIN_LENGTH_M) continue;
    const g = pts.map((p) => groundAt(p.x, p.y));
    if (g.some((v) => !Number.isFinite(v))) continue;
    // (the ground smoothed along the way: no step for every bump of the terrain's grid)
    const half = Math.max(1, Math.round(SMOOTH_M / 2 / SAMPLE_M));
    const sm = g.map((_, i) => { let a = 0; let n = 0; for (let k = Math.max(0, i - half); k <= Math.min(g.length - 1, i + half); k++) { a += g[k]; n++; } return a / n; });
    const lo = Math.min(...sm); const hi = Math.max(...sm);
    const rise = hi - lo;
    const width = w.width || DEFAULT_WIDTH_M;
    const flat = rise < FLAT_RISE_M;
    // the level of each sample: a whole number of risers over the lowest point, rounded up (on or over the ground)
    const riser = flat ? 0 : rise / Math.max(1, Math.ceil(rise / RISE_MAX_M));
    const level = sm.map((v) => (flat ? hi + FLAT_LIFT_M : lo + riser * Math.ceil((v - lo) / riser - 1e-6)));
    const treads = [];
    let start = 0;
    for (let i = 1; i <= pts.length; i++) {
      if (i < pts.length && Math.abs(level[i] - level[start]) < 1e-6) continue;
      const piece = pts.slice(start, Math.min(pts.length, i + 1));
      if (piece.length >= 2) {
        let ground = Infinity;
        for (let k = start; k < Math.min(pts.length, i + 1); k++) ground = Math.min(ground, g[k]);
        treads.push({ pts: piece, top: level[start], bottom: ground - BURY_M });
      }
      start = i;
    }
    flights.push({ width, treads, rise, flat, length: pts[pts.length - 1].s });
  }
  return flights;
}

/** The flights as meshes: the treads, their sides and risers in the sidewalk's concrete. */
export function buildStepFlightMeshes(flights = []) {
  const sets = { top: [], side: [] };
  let treads = 0;
  for (const f of flights) {
    const hw = f.width / 2;
    for (const t of f.treads) {
      treads++;
      const L = t.pts.map((p) => [p.x - p.uy * hw, p.y + p.ux * hw]);
      const R = t.pts.map((p) => [p.x + p.uy * hw, p.y - p.ux * hw]);
      // (each face wound to look the way it should, out: the game draws one side of a face only, and the flights' sides
      // came out missing where they were wound inwards; the user, 2026-11-24)
      const quad = (set, out, a, b, c, d) => {
        const n = [(b[1] - a[1]) * (c[2] - a[2]) - (b[2] - a[2]) * (c[1] - a[1]), (b[2] - a[2]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[2] - a[2]), (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])];
        if (n[0] * out[0] + n[1] * out[1] + n[2] * out[2] < 0) set.push(a, c, b, a, d, c); else set.push(a, b, c, a, c, d);
      };
      for (let i = 0; i + 1 < t.pts.length; i++) {
        const p = t.pts[i];
        quad(sets.top, [0, 0, 1], [...L[i], t.top], [...R[i], t.top], [...R[i + 1], t.top], [...L[i + 1], t.top]);
        quad(sets.side, [-p.uy, p.ux, 0], [...L[i + 1], t.bottom], [...L[i + 1], t.top], [...L[i], t.top], [...L[i], t.bottom]);
        quad(sets.side, [p.uy, -p.ux, 0], [...R[i], t.bottom], [...R[i], t.top], [...R[i + 1], t.top], [...R[i + 1], t.bottom]);
      }
      // the risers at both ends, facing back and forward along the flight
      const n = t.pts.length - 1;
      const u0 = t.pts[0]; const un = t.pts[n];
      quad(sets.side, [-u0.ux, -u0.uy, 0], [...R[0], t.bottom], [...L[0], t.bottom], [...L[0], t.top], [...R[0], t.top]);
      quad(sets.side, [un.ux, un.uy, 0], [...L[n], t.bottom], [...R[n], t.bottom], [...R[n], t.top], [...L[n], t.top]);
    }
  }
  const meshes = [];
  let triangles = 0;
  for (const [key, pts] of Object.entries(sets)) {
    if (!pts.length) continue;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pts.flat()), 3));
    // (tops tiled in plan; sides along their run and up)
    geo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(pts.flatMap((v) => (key === 'top' ? [v[0] / 2, v[1] / 2] : [(v[0] + v[1]) / 2, v[2] / 2]))), 2));
    geo.computeVertexNormals();
    // (the sides in the slab's concrete too: the curbs' material is an atlas of painted curb bands, and the risers showed
    // red, yellow and green stripes; in game 2026-11-24)
    const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ name: SIDEWALK_MATERIALS.slab }));
    mesh.name = `steps_${key}`;
    meshes.push(mesh);
    triangles += pts.length / 3;
  }
  return { meshes, count: flights.length, triangles, treads };
}
