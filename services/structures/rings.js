// Structure solver: an elevated ring (a rotary on a deck, with ramps and flyovers joining it).
//
// A ring is one slab: level, or tilted a little as a whole. Solved like any other road, each
// short piece between two ramps takes its ends' heights from the ramps, and the ring comes out
// rising and falling round its loop. Measured in game on a rotary flyover with eight ramps: its
// surface 18.3 to 21.7 m round one loop of 250 m, and a step of 0.3 to 0.5 m across a lane where
// a ramp's deck meets the ring's. Here rings are found and, after a first solve, every station
// of a ring is pinned to one plane; the roads joining it are then solved again to meet it.
//
// Only rings wholly on bridges: a roundabout on the ground follows its ground (junction rings
// have their own care in the road smoother), and a plane through a hillside would be fill.

const RING_MAX_M = 450;          // round the loop
const RING_MIN_M = 50;
const RING_MAX_EDGES = 40;
const RING_ROUNDNESS = 0.5;      // its area against a circle's of the same length round
export const RING_MAX_TILT = 0.03;   // the slab's slope as a whole
const RING_JOIN_REACH_M = 25;    // how far along a joining road its stations may be within the ring's slab
const RING_SLAB_MARGIN_M = 1;    // beyond the ring's half width

const headingOut = (e, end) => {   // leaving node at `end` of e, along e
  const n = e.x.length; const a = end === 0 ? 0 : n - 1; const b = end === 0 ? Math.min(n - 1, 2) : Math.max(0, n - 3);
  return Math.atan2(e.y[b] - e.y[a], e.x[b] - e.x[a]);
};
const wrap = (d) => { let v = d; while (v > Math.PI) v -= 2 * Math.PI; while (v < -Math.PI) v += 2 * Math.PI; return v; };

/**
 * The elevated rings of a graph: [{ edges: [k...] }]. A ring is a closed walk along one-way
 * bridge edges, each in its own direction, always taking the tightest turn to one side, that
 * comes back to its start within RING_MAX_M and encloses a round area.
 */
export function findElevatedRings(graph) {
  const { edges, nodes } = graph;
  const usable = (e) => e && e.bridge && e.oneway && !e.rail && !e.external && e.s.length >= 2;
  const outFrom = (nodeId) => (nodes.get(nodeId)?.edges || []).filter(({ edge, end }) => end === 0 && usable(edges[edge])).map(({ edge }) => edge);
  const inRing = new Set(); const rings = [];
  edges.forEach((e0, k0) => {
    if (!usable(e0) || inRing.has(k0)) return;
    for (const sense of [1, -1]) {
      const walk = [k0]; let length = e0.length; let k = k0; let ok = false;
      for (let step = 0; step < RING_MAX_EDGES; step++) {
        const e = edges[k];
        if (e.to === e0.from) { ok = true; break; }
        const inHeading = headingOut(e, 1) + Math.PI;
        let best = -1; let bestTurn = -Infinity;
        for (const k2 of outFrom(e.to)) {
          if (k2 === k || walk.includes(k2)) continue;
          const turn = wrap(headingOut(edges[k2], 0) - inHeading) * sense;
          if (turn > bestTurn) { bestTurn = turn; best = k2; }
        }
        if (best < 0) break;
        length += edges[best].length; walk.push(best); k = best;
        if (length > RING_MAX_M) break;
      }
      // round enough to be a ring (a circle encloses L² / 4π; two carriageways joined at both
      // ends close a loop too, long and thin)
      let area = 0;
      if (ok) {
        const loop = walk.flatMap((q) => Array.from(edges[q].x, (x, i) => [x, edges[q].y[i]]));
        for (let i = 0; i < loop.length; i++) { const p = loop[i]; const q = loop[(i + 1) % loop.length]; area += p[0] * q[1] - q[0] * p[1]; }
        area = Math.abs(area) / 2;
      }
      if (ok && length >= RING_MIN_M && length <= RING_MAX_M && area >= RING_ROUNDNESS * (length * length) / (4 * Math.PI) && walk.length >= 3) {
        walk.forEach((q) => inRing.add(q)); rings.push({ edges: walk, length: Math.round(length) });
        break;
      }
    }
  });
  return rings;
}

/**
 * Pins that hold each ring on one plane: fitted to its stations' solved heights (z[k][i]),
 * its slope held to RING_MAX_TILT, and lifted so no station comes out lower than it was solved
 * (what it had to clear, it still clears). Returns { pins: [[k, i, h]...], rings: [{ edges,
 * length, tilt, spread: how far the solved heights were from one plane, lift }] }.
 */
export function ringPlanePins(graph, z, rings = findElevatedRings(graph)) {
  const { edges } = graph; const pins = []; const out = [];
  for (const ring of rings) {
    const pts = [];
    for (const k of ring.edges) for (let i = 0; i < edges[k].s.length; i++) if (Number.isFinite(z[k]?.[i])) pts.push([edges[k].x[i], edges[k].y[i], z[k][i], k, i]);
    if (pts.length < 6) continue;
    const mx = pts.reduce((a, p) => a + p[0], 0) / pts.length; const my = pts.reduce((a, p) => a + p[1], 0) / pts.length; const mz = pts.reduce((a, p) => a + p[2], 0) / pts.length;
    let sxx = 0; let sxy = 0; let syy = 0; let sxz = 0; let syz = 0;
    for (const [x, y, h] of pts) { const dx = x - mx; const dy = y - my; const dz = h - mz; sxx += dx * dx; sxy += dx * dy; syy += dy * dy; sxz += dx * dz; syz += dy * dz; }
    const det = sxx * syy - sxy * sxy;
    let a = Math.abs(det) > 1e-6 ? (sxz * syy - syz * sxy) / det : 0; let b = Math.abs(det) > 1e-6 ? (syz * sxx - sxz * sxy) / det : 0;
    const tilt = Math.hypot(a, b);
    if (tilt > RING_MAX_TILT) { a *= RING_MAX_TILT / tilt; b *= RING_MAX_TILT / tilt; }
    const at = (x, y) => mz + a * (x - mx) + b * (y - my);
    let lift = 0; let lo = Infinity; let hi = -Infinity;
    for (const [x, y, h] of pts) { const r = h - at(x, y); lift = Math.max(lift, r); lo = Math.min(lo, r); hi = Math.max(hi, r); }
    for (const [x, y, , k, i] of pts) pins.push([k, i, at(x, y) + lift]);
    // ... and the last metres of every road joining it, where its deck lies within the ring's
    // slab: on the same plane (a ramp arriving at its own grade met the slab's edge a hand or two
    // lower than the slab: a step across the lane, 0.2 m measured)
    const inRing = new Set(ring.edges);
    const ringPts = pts.map(([x, y, , k]) => [x, y, (edges[k].half || 4)]);
    const nodeIds = new Set(ring.edges.flatMap((k) => [edges[k].from, edges[k].to]));
    let joined = 0;
    edges.forEach((e, k) => {
      if (inRing.has(k) || !(nodeIds.has(e.from) || nodeIds.has(e.to)) || e.external) return;
      for (let i = 0; i < e.s.length; i++) {
        // (only near the end that is on the ring)
        const fromEnd = Math.min(nodeIds.has(e.from) ? e.s[i] : Infinity, nodeIds.has(e.to) ? e.length - e.s[i] : Infinity);
        if (fromEnd > RING_JOIN_REACH_M) continue;
        let inside = false;
        for (const [x, y, half] of ringPts) if (Math.hypot(e.x[i] - x, e.y[i] - y) <= half + RING_SLAB_MARGIN_M) { inside = true; break; }
        if (inside) { pins.push([k, i, at(e.x[i], e.y[i]) + lift]); joined++; }
      }
    });
    out.push({ edges: ring.edges, length: ring.length, tilt: Math.min(tilt, RING_MAX_TILT), spread: hi - lo, lift, joined });
  }
  return { pins, rings: out };
}
