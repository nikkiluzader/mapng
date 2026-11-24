// Level-crossing barriers: at each crossing of a road over a railway, a barrier on each road approach, its arm standing
// raised (the user, 2026-11-24: the arms "always be raised", so no car is ever shut in or stopped by one). The game has
// no railway crossing equipment of its own (Italy's car-park boom gates are the nearest, data/osm-tag-library.json), so
// it is built: a grey cabinet post on the verge, on the right of the traffic coming to the crossing (left in left-hand
// traffic), with its red and white striped arm upright beside it, as long as the approach's half of the road. Footways
// and paths over the line get none. Nothing here knows about any place.

import * as THREE from 'three';
import { SIDEWALK_MATERIALS } from './beamngSidewalks.js';
import { TRACK_SPACING_M, tracksOf } from './railways.js';
import { fastHypot } from './fastMath.js';

export const BARRIER_MATERIALS = { white: SIDEWALK_MATERIALS.barrierWhite, red: SIDEWALK_MATERIALS.barrierRed };
const SETBACK_M = 3.5;            // the barrier this far from the nearest track's centre, along the road
const VERGE_GAP_M = 0.9;          // the post's centre this far past the road's edge
const POST_HALF_M = 0.18; const POST_TOP_M = 1.15; const POST_BURY_M = 0.5;
const ARM_HALF_M = [0.05, 0.03];  // the arm's section (across the road, along it)
const ARM_PIVOT_OFF_M = 0.3;      // the upright arm stands this far from the post's centre, on the road's side
const STRIPE_M = 0.5;
const ARM_MIN_M = 2.5; const ARM_MAX_M = 9;

/**
 * Where the barriers stand: graph a solved structure graph (edges with x, y, s, half, rail, from, to; profile.z),
 * crossings its level crossings (railTrack.js prepareRailEdges). Returns [{ x, y, z, ux, uy, sx, sy, arm }]: the post's
 * foot, the road's direction away from the crossing (u), the side towards the road (s), the arm's length.
 */
// crossing:barrier values that mean none stands there
const NO_BARRIER = new Set(['no', 'none']);

/** The mapped crossing node's tags nearest (x, y), within NODE_MATCH_M: nodes [{ x, y, tags }]. */
const NODE_MATCH_M = 4;
function mappedTags(nodes, x, y) {
  let best = null; let bd = NODE_MATCH_M;
  for (const n of nodes) { const d = fastHypot(n.x - x, n.y - y); if (d <= bd) { bd = d; best = n.tags; } }
  return best;
}

export function levelCrossingBarriers(graph, crossings = [], { tagsOf = () => ({}), leftHand = false, pathClasses = new Set(), nodes = [], log = () => {} } = {}) {
  const out = [];
  const skipped = { path: 0, short: 0, none: 0 };
  const z = graph?.profile?.z;
  let roadCrossings = 0;
  for (const c of crossings || []) {
    // the approaches: { k (road edge), s0 (the crossing's arc length on it), dir (+1 along the edge, away) }.
    // A crossing at a node of both: each road edge leaving the node. One with no node (railTrack.js
    // unjoinedRailCrossings): both ways along the one road edge from where it meets the line.
    const rails = Array.isArray(c.rail) ? c.rail : [c.rail];
    const roads = Array.isArray(c.road) ? c.road : [c.road];
    const path = c.path ?? roads.every((k) => pathClasses.has(graph.edges[k]?.highway));
    if (path) { skipped.path++; continue; }
    // (mapped crossing:barrier=no: none; untagged or any barrier: one, raised)
    const tags = mappedTags(nodes, c.x, c.y);
    if (tags && NO_BARRIER.has(String(tags['crossing:barrier'] ?? '').toLowerCase())) { skipped.none++; continue; }
    roadCrossings++;
    const approaches = [];
    for (const k of roads) {
      const e = graph.edges[k]; const n = e.s.length; const len = e.s[n - 1];
      if (c.node !== undefined) { approaches.push({ k, s0: e.from === c.node ? 0 : len, dir: e.from === c.node ? 1 : -1 }); continue; }
      // (nearest station's arc length to the meeting point)
      let best = 0; let bd = Infinity;
      for (let i = 0; i + 1 < n; i++) {
        const dx = e.x[i + 1] - e.x[i]; const dy = e.y[i + 1] - e.y[i]; const L2 = dx * dx + dy * dy || 1e-9;
        const f = Math.max(0, Math.min(1, ((c.x - e.x[i]) * dx + (c.y - e.y[i]) * dy) / L2));
        const d = fastHypot(e.x[i] + dx * f - c.x, e.y[i] + dy * f - c.y);
        if (d < bd) { bd = d; best = e.s[i] + (e.s[i + 1] - e.s[i]) * f; }
      }
      approaches.push({ k, s0: best, dir: 1 }, { k, s0: best, dir: -1 });
    }
    const tracks = Math.max(1, ...rails.map((k) => tracksOf(tagsOf(graph.edges[k]) || {})));
    const setback = SETBACK_M + ((tracks - 1) * TRACK_SPACING_M) / 2;
    for (const { k, s0, dir } of approaches) {
      const e = graph.edges[k];
      const n = e.s.length; const len = e.s[n - 1];
      const room = dir > 0 ? len - s0 : s0;
      if (room < setback + 1) { skipped.short++; continue; }
      // a point at distance d from the crossing along this edge, and the edge's height there
      const at = (d) => {
        const sv = s0 + dir * d;
        let i = 0; while (i + 2 < n && e.s[i + 1] < sv) i++;
        const f = Math.max(0, Math.min(1, (sv - e.s[i]) / ((e.s[i + 1] - e.s[i]) || 1)));
        const zi = z?.[k] ? z[k][i] + (z[k][i + 1] - z[k][i]) * f : 0;
        return [e.x[i] + (e.x[i + 1] - e.x[i]) * f, e.y[i] + (e.y[i + 1] - e.y[i]) * f, zi];
      };
      const p = at(setback); const q = at(setback + 1);
      const L = fastHypot(q[0] - p[0], q[1] - p[1]) || 1;
      const ux = (q[0] - p[0]) / L; const uy = (q[1] - p[1]) / L;
      // traffic coming in travels -u; its right is (-uy, ux)
      const side = leftHand ? -1 : 1;
      const sx = -uy * side; const sy = ux * side;
      const half = e.half || 3;
      // (the post on the verge; the arm towards the road, over the approach's half of it)
      const off = half + VERGE_GAP_M;
      const arm = Math.max(ARM_MIN_M, Math.min(ARM_MAX_M, half + VERGE_GAP_M - ARM_PIVOT_OFF_M));
      out.push({ x: p[0] + sx * off, y: p[1] + sy * off, z: p[2], ux, uy, sx: -sx, sy: -sy, arm });
    }
  }
  log(`Level crossings: ${out.length} barrier(s) built with the arm raised at ${roadCrossings} road crossing(s)`
    + `${skipped.path ? `; ${skipped.path} path crossing(s) without` : ''}${skipped.none ? `; ${skipped.none} mapped crossing:barrier=no` : ''}${skipped.short ? `; ${skipped.short} approach(es) too short for one` : ''}.`);
  return out;
}

/** The meshes for all of them: the posts (metal), the arms' white and red stripes. */
export function buildLevelCrossingMeshes(items = []) {
  const sets = { metal: [], white: [], red: [] };
  const box = (set, c, ax, ay, ha, hb, z0, z1) => {
    // a box round centre c (x, y), its sides along a (ax, ay) and b (-ay, ax), half sizes ha, hb, from z0 to z1
    const bx = -ay; const by = ax;
    const P = (sa, sb, zz) => [c[0] + ax * ha * sa + bx * hb * sb, c[1] + ay * ha * sa + by * hb * sb, zz];
    const quad = (A, B, C, D) => set.push(A, B, C, A, C, D);
    const r = [[1, 1], [-1, 1], [-1, -1], [1, -1]];
    for (let i = 0; i < 4; i++) {
      const [a0, b0] = r[i]; const [a1, b1] = r[(i + 1) % 4];
      quad(P(a0, b0, z0), P(a1, b1, z0), P(a1, b1, z1), P(a0, b0, z1));
    }
    quad(P(1, 1, z1), P(-1, 1, z1), P(-1, -1, z1), P(1, -1, z1));
  };
  for (const it of items) {
    box(sets.metal, [it.x, it.y], it.sx, it.sy, POST_HALF_M, POST_HALF_M, it.z - POST_BURY_M, it.z + POST_TOP_M);
    const c = [it.x + it.sx * ARM_PIVOT_OFF_M, it.y + it.sy * ARM_PIVOT_OFF_M];
    const z0 = it.z + POST_TOP_M - 0.15;
    const n = Math.max(1, Math.round(it.arm / STRIPE_M));
    for (let k = 0; k < n; k++) box(k % 2 ? sets.white : sets.red, c, it.sx, it.sy, ARM_HALF_M[0], ARM_HALF_M[1], z0 + (it.arm * k) / n, z0 + (it.arm * (k + 1)) / n);
  }
  const meshes = [];
  let triangles = 0;
  for (const [key, pts] of Object.entries(sets)) {
    if (!pts.length) continue;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pts.flat()), 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(pts.flatMap((v) => [v[0] + v[1], v[2]])), 2));
    geo.computeVertexNormals();
    const name = key === 'metal' ? SIDEWALK_MATERIALS.metal : BARRIER_MATERIALS[key];
    const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ name }));
    mesh.name = `level_crossing_${key}`;
    meshes.push(mesh);
    triangles += pts.length / 3;
  }
  return { meshes, count: items.length, triangles };
}
