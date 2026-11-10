// Structure solver: side roads at their through roads.
//
// At a junction where two roads carry on in line through the node (within
// THROUGH_COS of straight), every other road meeting there is a side arm: it
// ends on the through road's centre line, so its first metres lie under the
// through road's lanes. Those metres are the through road's surface, not the
// side road's own: solved and composed as the side road's, its level strip
// (and, on a hill, its descent from the centre line) cut a wedge out of the
// through road's near lane, a step across it at every junction. Nothing here
// knows about any place.

const THROUGH_COS = -0.7;
const FORK_COS = 0.7;      // an arm within this of a through arm's direction forks from it (a slip road): no side arm
const DIR_M = 8;          // a road's direction at the node: to its station this far out
const LOOK_M = 80;        // the through road's stations searched this far from the node

const stationAt = (e, end, j) => (end === 0 ? j : e.s.length - 1 - j);
const fromEnd = (e, end, i) => Math.abs(e.s[i] - e.s[end === 0 ? 0 : e.s.length - 1]);

function dirOf(e, end) {
  const n = e.s.length; const i0 = end === 0 ? 0 : n - 1;
  let j = 0;
  while (j + 1 < n && fromEnd(e, end, stationAt(e, end, j)) < DIR_M) j++;
  const i = stationAt(e, end, j);
  const dx = e.x[i] - e.x[i0]; const dy = e.y[i] - e.y[i0]; const l = Math.hypot(dx, dy);
  return l > 1e-6 ? [dx / l, dy / l] : null;
}

/**
 * The through road's surface under (x, y): { d: distance from its centre
 * line, z, half } from the nearest piece of the main arms, their heights
 * from zOf(edge, station).
 */
export function throughSurface(graph, mains, zOf, x, y) {
  let best = null;
  for (const m of mains) {
    const e = graph.edges[m.edge]; const n = e.s.length;
    for (let j = 0; j + 1 < n; j++) {
      const a = stationAt(e, m.end, j); const b = stationAt(e, m.end, j + 1);
      if (fromEnd(e, m.end, a) > LOOK_M) break;
      const vx = e.x[b] - e.x[a]; const vy = e.y[b] - e.y[a]; const L2 = vx * vx + vy * vy;
      const u = L2 > 1e-12 ? Math.max(0, Math.min(1, ((x - e.x[a]) * vx + (y - e.y[a]) * vy) / L2)) : 0;
      const d = Math.hypot(e.x[a] + vx * u - x, e.y[a] + vy * u - y);
      if (!best || d < best.d) { const za = zOf(m.edge, a); const zb = zOf(m.edge, b); best = { d, z: za + (zb - za) * u, half: e.half }; }
    }
  }
  return best;
}

/**
 * The side arms of a graph: [{ edge, end, mains: [{ edge, end }], under }],
 * `under` the count of the arm's stations from its end that lie under the
 * through road's lanes (the node included; station `under` from the end is
 * the first clear of them). plain(k): edge k is a road on the ground that
 * may be seated (no structure, nothing held).
 */
export function findSideArms(graph, plain = () => true) {
  const out = [];
  // (a graph given without its nodes, a hand-built one: no junctions known)
  if (!graph.nodes?.values) return out;
  for (const node of graph.nodes.values()) {
    if (node.edges.length < 3) continue;
    const arms = node.edges.map((a) => ({ ...a, dir: graph.edges[a.edge].s.length >= 2 ? dirOf(graph.edges[a.edge], a.end) : null }));
    // (an edge from the node back to it: left alone)
    if (new Set(arms.map((a) => a.edge)).size !== arms.length || arms.some((a) => !a.dir)) continue;
    const through = new Set();
    for (let a = 0; a < arms.length; a++) {
      for (let b = a + 1; b < arms.length; b++) {
        if (arms[a].dir[0] * arms[b].dir[0] + arms[a].dir[1] * arms[b].dir[1] <= THROUGH_COS) { through.add(a); through.add(b); }
      }
    }
    if (!through.size || through.size === arms.length) continue;
    const mains = [...through].map((a) => ({ edge: arms[a].edge, end: arms[a].end }));
    if (!mains.every((m) => plain(m.edge))) continue;
    arms.forEach((arm, a) => {
      if (through.has(a) || !plain(arm.edge)) return;
      // (a slip road runs under the through road's lanes for a long way, climbing or dropping from it)
      if ([...through].some((t) => arm.dir[0] * arms[t].dir[0] + arm.dir[1] * arms[t].dir[1] >= FORK_COS)) return;
      const e = graph.edges[arm.edge]; const n = e.s.length; const total = e.s[n - 1] - e.s[0];
      let under = 0;
      for (let j = 1; j < n; j++) {
        const i = stationAt(e, arm.end, j);
        // (never past the arm's middle: its other end may be a side arm too)
        if (fromEnd(e, arm.end, i) > total / 2) break;
        const s = throughSurface(graph, mains, () => 0, e.x[i], e.y[i]);
        if (!s || s.d >= s.half) { under = j; break; }
      }
      if (under > 0) out.push({ edge: arm.edge, end: arm.end, mains, under });
    });
  }
  return out;
}

/**
 * The junctions with a road going on through: [{ a, b, others }], a and b the
 * two arms most nearly in line ({ edge, end }; of several such pairs the
 * widest road's), others the rest of the arms there. Every arm a road on the
 * ground (plain).
 */
export function findThroughJunctions(graph, plain = () => true) {
  const out = [];
  if (!graph.nodes?.values) return out;
  for (const node of graph.nodes.values()) {
    if (node.edges.length < 3) continue;
    const arms = node.edges.map((a) => ({ edge: a.edge, end: a.end, dir: graph.edges[a.edge].s.length >= 2 ? dirOf(graph.edges[a.edge], a.end) : null }));
    if (new Set(arms.map((a) => a.edge)).size !== arms.length || arms.some((a) => !a.dir || !plain(a.edge))) continue;
    let best = null;
    for (let a = 0; a < arms.length; a++) {
      for (let b = a + 1; b < arms.length; b++) {
        const dot = arms[a].dir[0] * arms[b].dir[0] + arms[a].dir[1] * arms[b].dir[1];
        if (dot > THROUGH_COS) continue;
        const width = graph.edges[arms[a].edge].half + graph.edges[arms[b].edge].half;
        if (!best || width > best.width + 1e-6 || (Math.abs(width - best.width) <= 1e-6 && dot < best.dot)) best = { a, b, dot, width };
      }
    }
    if (!best) continue;
    out.push({ a: arms[best.a], b: arms[best.b], others: arms.filter((_, i) => i !== best.a && i !== best.b) });
  }
  return out;
}

export const sideArmStation = stationAt;
export const sideArmFromEnd = fromEnd;
