// Wing walls: the walls a road's fill stands behind beside a bridge's end.
//
// terrainCompose gives a road's fill near a deck's end steep sides and no spreading slope ("stands behind
// wingwalls": spread at 1 in 2 it dammed the stream every small bridge crosses). The steep side, 2 to 5 m of drop
// in two terrain squares, shows as a row of teeth wherever it runs off the grid's axes; between the raised
// carriageways of one approach the ground is left as trenches. The walls are built here: along each side of a
// road within WING_FILL_M of a deck's end where the road stands WALL_MIN_DROP_M or more over the ground beside
// its fill (and on along the approach, to APPROACH_M, where that side is still steep or a trench to another
// carriageway), a concrete block from the road's shoulder out over the steep strip, its top at the road's height,
// a parapet on its outer edge, its outer face down into the ground. Nothing here knows about any place.

import * as THREE from 'three';

export const WING_FILL_M = 15;          // a road's fill this near a deck's end has walled sides, not slopes
const WALL_MIN_DROP_M = 0.8;            // the road this far over the ground beside its fill: a wall
const APPROACH_M = 120;                 // further along the approach a wall stands only where the side is steep ...
const STEEP_DROP_M = 1.2;               // ... this much of drop ...
const STEEP_WITHIN_M = 1.5;             // ... within this of the shoulder's edge (a 1 in 2 slope drops 0.75 m there)
const WALL_IN_M = 0.3;                  // the block starts this far inside the shoulder's edge
const WALL_PAST_M = 0.3;                // ... and ends this far past the steep strip
const WALL_TOP_M = 0.03;                // its top over the road's height
const WALL_BURY_M = 2;                  // the built faces end this far under the lowest ground near them
const FOOT_REACH = 3;
const WALL_FOOT_M = 0.6;                // its faces go this far into the ground
const WALL_THIN_M = 0.3;                // against another road's pavement the wall is this thin, on the shoulder's edge
const MEDIAN_GAP_M = 1.5;                // a gap this wide between the block and another road's pavement is filled too
const MEDIAN_LEVEL_M = 0.5;             // the ground past the wall within this of the road: a median, no parapet
const PARAPET_H_M = 0.9;
const PARAPET_W_M = 0.45;

/** Per edge: each station's kind, and how far a station on the ground is from a deck's end along its road. */
export function deckDistances(graph) {
  const segments = graph.classes?.segments || [];
  const kindOf = graph.edges.map((e) => new Array(e.s.length).fill('ground'));
  for (const seg of segments) for (let i = seg.i0; i <= seg.i1; i++) kindOf[seg.edge][i] = seg.kind;
  const nodeKinds = new Map();
  graph.edges.forEach((e, k) => {
    for (const [id, i] of [[e.from, 0], [e.to, e.s.length - 1]]) {
      if (id === undefined) continue;
      if (!nodeKinds.has(id)) nodeKinds.set(id, []);
      nodeKinds.get(id).push(kindOf[k][i]);
    }
  });
  const toDeck = graph.edges.map((e, k) => {
    const out = new Float64Array(e.s.length).fill(Infinity);
    const kinds = kindOf[k];
    const deckAt = (id) => (nodeKinds.get(id) || []).some((kk) => kk === 'deck');
    let last = deckAt(e.from) ? 0 : -Infinity;
    for (let i = 0; i < kinds.length; i++) { if (kinds[i] === 'deck') { last = e.s[i]; continue; } out[i] = Math.min(out[i], e.s[i] - last); }
    let next = deckAt(e.to) ? e.s[e.s.length - 1] : Infinity;
    for (let i = kinds.length - 1; i >= 0; i--) { if (kinds[i] === 'deck') { next = e.s[i]; continue; } out[i] = Math.min(out[i], next - e.s[i]); }
    return out;
  });
  return { kindOf, nodeKinds, toDeck };
}

/**
 * The same distance carried on through the graph's nodes: a road's approach is often several edges (a short one
 * at the deck, then the street), and a distance kept to the deck's own edge stopped the walls after its few
 * metres. Out to `reach` metres; deck stations stay Infinity.
 */
export function deckDistancesThrough(graph, reach) {
  const base = deckDistances(graph);
  const toDeck = base.toDeck.map((a) => Float64Array.from(a));
  const node = new Map();
  const relax = (id, d) => { if (id !== undefined && d < (node.get(id) ?? Infinity)) { node.set(id, d); return true; } return false; };
  for (let round = 0; round < 8; round++) {
    let changed = false;
    graph.edges.forEach((e, k) => {
      const out = toDeck[k]; const kinds = base.kindOf[k]; const n = e.s.length; const len = e.s[n - 1];
      const d0 = node.get(e.from) ?? Infinity; const d1 = node.get(e.to) ?? Infinity;
      // (forwards from the edge's start, backwards from its end; never across the edge's own deck stations)
      let run = d0;
      for (let i = 0; i < n; i++) { if (kinds[i] === 'deck') { run = Infinity; continue; } const d = run + e.s[i]; if (d < out[i] && d < reach) { out[i] = d; changed = true; } }
      run = d1;
      for (let i = n - 1; i >= 0; i--) { if (kinds[i] === 'deck') { run = Infinity; continue; } const d = run + (len - e.s[i]); if (d < out[i] && d < reach) { out[i] = d; changed = true; } }
      if (kinds[0] !== 'deck' && relax(e.from, out[0])) changed = true;
      if (kinds[n - 1] !== 'deck' && relax(e.to, out[n - 1])) changed = true;
    });
    if (!changed) break;
  }
  return { ...base, toDeck };
}

/**
 * The runs of wall: [{ side, stations: [{ x, y, z, nx, ny, inner, outer, foot }] }] (x, y on the road's line, z its
 * height, n the unit normal to the wall's side, inner/outer the block's offsets from the line, foot its faces'
 * bottom). graph: the solved structure graph; opts: groundAt(x, y) the finished ground, onOtherRoad(x, y, edge)
 * true on another road's pavement (the block stops short of it), shoulderM / slopeM as terrainCompose used them.
 */
export function wingWallRuns(graph, { groundAt, onOtherRoad = () => false, shoulderM = 1, slopeM = 2 } = {}) {
  const z = graph.profile?.z;
  if (!z || !groundAt) return [];
  const { kindOf, toDeck } = deckDistancesThrough(graph, APPROACH_M);
  const runs = [];
  graph.edges.forEach((e, k) => {
    if (e.rail || !z[k]) return;   // (a railway's fill near its bridge: left, the track bed has its own ballast shoulders)
    const n = e.s.length;
    for (const side of [1, -1]) {
      let run = null;
      const close = () => { if (run && run.stations.length >= 2) runs.push(run); run = null; };
      for (let i = 0; i < n; i++) {
        if (kindOf[k][i] === 'deck' || !(toDeck[k][i] < APPROACH_M)) { close(); continue; }
        const a = Math.max(0, i - 1); const b = Math.min(n - 1, i + 1);
        const tx = e.x[b] - e.x[a]; const ty = e.y[b] - e.y[a]; const L = Math.hypot(tx, ty);
        if (L < 1e-6) { close(); continue; }
        const nx = (-ty / L) * side; const ny = (tx / L) * side;
        const core = e.half + shoulderM;
        const inner = core - WALL_IN_M; let outer = core + slopeM + WALL_PAST_M;
        // (not over another road's pavement: stopped short of it)
        // (not over another road's pavement: stopped just short of it, and never thinner than WALL_THIN_M: a
        // street right against the raised road's edge gets a thin retaining wall on the shoulder's edge)
        // (looked for a little past the block too: a gap of up to MEDIAN_GAP_M to the other pavement is filled)
        let inner0 = inner; let beside = false;
        for (let d = inner + 0.25; d <= outer + MEDIAN_GAP_M + 1e-6; d += 0.25) {
          if (onOtherRoad(e.x[i] + nx * d, e.y[i] + ny * d, k)) { outer = d - 0.05; beside = true; break; }
        }
        if (outer - inner0 < WALL_THIN_M) inner0 = outer - WALL_THIN_M;
        if (inner0 < e.half) { close(); continue; }   // (the other road is on this one's own pavement: a junction, no wall)
        const zr = z[k][i];
        let gOut = groundAt(e.x[i] + nx * (outer + 0.5), e.y[i] + ny * (outer + 0.5));
        const gPast = groundAt(e.x[i] + nx * (outer + 1.5), e.y[i] + ny * (outer + 1.5));
        const median = beside && Number.isFinite(gPast) && Math.abs(zr - gPast) < MEDIAN_LEVEL_M;
        let gMid = groundAt(e.x[i] + nx * outer, e.y[i] + ny * outer);
        // (against another road the ground past the block is that road: the drop is the gap's own, read inside it)
        if (beside) { const m = (inner0 + outer) / 2; gMid = Math.min(groundAt(e.x[i] + nx * m, e.y[i] + ny * m), groundAt(e.x[i] + nx * (outer - 0.4), e.y[i] + ny * (outer - 0.4))); }
        if (beside) gOut = gMid;
        if (!Number.isFinite(zr) || !Number.isFinite(gOut) || zr - Math.min(gOut, gMid) < WALL_MIN_DROP_M) { close(); continue; }
        // (past the wing itself, only where the fill's side has no slope: the terrain could not spread it, a
        // raised carriageway beside a quay street or beside its own other carriageway. Copenhagen's Torvegade:
        // two strips 2.5 m over the ground, vertical sides and a 2.3 m trench between them, 60 m long)
        if (!(toDeck[k][i] < WING_FILL_M)) {
          const gNear = groundAt(e.x[i] + nx * (core + STEEP_WITHIN_M), e.y[i] + ny * (core + STEEP_WITHIN_M));
          if (!(zr - gNear >= STEEP_DROP_M) && !(beside && zr - gMid >= WALL_MIN_DROP_M)) { close(); continue; }
        }
        run ||= { edge: k, side, stations: [] };
        // (no parapet where the block fills the gap to another road's pavement: a median, not an edge)
        run.stations.push({ x: e.x[i], y: e.y[i], z: zr, nx, ny, inner: inner0, outer, foot: Math.min(gOut, gMid) - WALL_FOOT_M, parapet: median ? 0 : PARAPET_H_M });
      }
      close();
    }
  });
  return runs;
}

/** The runs' triangles: [[A, B, C]...] in world coordinates, facing out of the wall. */
export function wingWallTriangles(runs) {
  const tris = [];
  const quad = (a, b, c, d) => { tris.push([a, b, c], [a, c, d]); };   // (a, b, c, d counter-clockwise seen from outside)
  for (const run of runs) {
    const s = run.side;
    // (the faces are not fitted to the ground station by station: each runs to the lowest ground within
    // FOOT_REACH stations either way, WALL_BURY_M under it. A foot 0.6 m under each station's own ground, straight
    // between stations 4 m apart, came out of the ground where it dipped between them: a saw edge along a fill)
    const st = run.stations.map((q, i, all) => {
      let low = q.foot;
      for (let j = Math.max(0, i - FOOT_REACH); j <= Math.min(all.length - 1, i + FOOT_REACH); j++) low = Math.min(low, all[j].foot);
      return { ...q, foot: low - (WALL_BURY_M - WALL_FOOT_M) };
    });
    const P = (q, off, zz) => [q.x + q.nx * off, q.y + q.ny * off, zz];
    for (let i = 0; i + 1 < st.length; i++) {
      const a = st[i]; const b = st[i + 1];
      const za = a.z + WALL_TOP_M; const zb = b.z + WALL_TOP_M;
      const ha = a.parapet ?? PARAPET_H_M; const hb = b.parapet ?? PARAPET_H_M;
      const pa = a.outer - (ha ? Math.min(PARAPET_W_M, a.outer - a.inner) : 0); const pb = b.outer - (hb ? Math.min(PARAPET_W_M, b.outer - b.inner) : 0);
      // (side 1: the wall is on the left of travel, so "outside" is to the left; the windings below are for
      // side 1 and are turned round for side -1)
      const put = (q0, q1, q2, q3) => (s === 1 ? quad(q0, q1, q2, q3) : quad(q3, q2, q1, q0));
      put(P(a, a.inner, za), P(b, b.inner, zb), P(b, pb, zb), P(a, pa, za));                                   // top, inside the parapet
      if (ha || hb) put(P(a, pa, za), P(b, pb, zb), P(b, pb, zb + hb), P(a, pa, za + ha));               // parapet's inner face
      put(P(a, pa, za + ha), P(b, pb, zb + hb), P(b, b.outer, zb + hb), P(a, a.outer, za + ha));   // parapet's top (the block's own top where there is none)
      put(P(a, a.outer, za + ha), P(b, b.outer, zb + hb), P(b, b.outer, b.foot), P(a, a.outer, a.foot));             // outer face
      put(P(a, a.inner, a.foot), P(b, b.inner, b.foot), P(b, b.inner, zb), P(a, a.inner, za));               // inner face (under the shoulder)
    }
    // the two ends, closed: the block's rectangle and the parapet's (the L is not convex: no fan)
    for (const [q, flip] of [[st[0], false], [st[st.length - 1], true]]) {
      const hq = q.parapet ?? PARAPET_H_M;
      const zt = q.z + WALL_TOP_M; const p = q.outer - Math.min(PARAPET_W_M, q.outer - q.inner);
      const rects = [
        [P(q, q.inner, q.foot), P(q, q.outer, q.foot), P(q, q.outer, zt), P(q, q.inner, zt)],
        ...(hq ? [[P(q, p, zt), P(q, q.outer, zt), P(q, q.outer, zt + hq), P(q, p, zt + hq)]] : []),
      ];
      // (seen from before the run's first station the ring above runs clockwise for side 1)
      const out = (s === 1) !== flip;
      for (const [a, b, c, d] of rects) { if (out) tris.push([a, c, b], [a, d, c]); else tris.push([a, b, c], [a, c, d]); }
    }
  }
  return tris;
}

/** One mesh of the walls (material name given by the caller). Returns null when there is none. */
export function buildWingWallMesh(runs, materialName, tileM = 2) {
  const tris = wingWallTriangles(runs);
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
  mesh.name = 'wing_walls';
  return mesh;
}
