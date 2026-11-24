// Slip roads that merge into a wider road.
//
// In OSM a slip road (highway=*_link, one way) ends on a node of the road it joins, and that road is one line down
// its middle however many lanes it has. Drawn to its node, the slip road's ribbon lies across the wider road's lanes
// from its edge to its centre line. Every road's paint is cut where another road's carriageway lies on it
// (cutPaintAtOtherRoads), so the wider road lost its lane lines along that whole diagonal: a four-lane street with a
// bare wedge at each slip road (Kaunas, Pramonės pr. / Elektrėnų g., a tester's report, 2026-11-24). A road that
// merges at a shallow angle crosses no lanes: it joins the outer one. The wider road keeps its lane lines there.

import { fastHypot } from './fastMath.js';

export const MERGE_MAX_ANGLE_DEG = 40;   // a link meeting the road at more than this crosses it: a junction, paint cut as ever
const END_LOOK_M = 12;                   // the link's direction over its last metres

const isLink = (cw) => /_link$/.test(String(cw?.highway || '')) && !!cw.oneWay;

/** The unit direction of a polyline over its last (end = 1) or first (end = 0) `look` metres. */
function endDirection(nodes, end, look) {
  const n = nodes.length;
  const a = end ? nodes[n - 1] : nodes[0];
  let acc = 0; let b = a;
  for (let k = 1; k < n; k++) {
    const p = end ? nodes[n - 1 - k] : nodes[k];
    acc += fastHypot(p[0] - b[0], p[1] - b[1]); b = p;
    if (acc >= look) break;
  }
  const L = fastHypot(a[0] - b[0], a[1] - b[1]);
  return L > 1e-6 ? [(a[0] - b[0]) / L, (a[1] - b[1]) / L] : null;
}

/** The nearest point of a polyline to (x, y): { d, tx, ty } (distance, the segment's unit direction). */
function nearestOn(nodes, x, y) {
  let best = null;
  for (let i = 0; i + 1 < nodes.length; i++) {
    const ax = nodes[i][0]; const ay = nodes[i][1]; const vx = nodes[i + 1][0] - ax; const vy = nodes[i + 1][1] - ay;
    const L2 = vx * vx + vy * vy; if (L2 < 1e-9) continue;
    const t = Math.max(0, Math.min(1, ((x - ax) * vx + (y - ay) * vy) / L2));
    const d = fastHypot(ax + vx * t - x, ay + vy * t - y);
    if (!best || d < best.d) { const L = Math.sqrt(L2); best = { d, tx: vx / L, ty: vy / L }; }
  }
  return best;
}

/**
 * Which links merge into which roads: Map(road owner -> Set(link owner)). carriageways: [{ owner, nodes: [[x, y, ...]],
 * half, highway, oneWay }]. A link merges into a road when one of its ends lies on that road's carriageway, the road
 * is wider than the link and no link itself, and the link's direction there is within MERGE_MAX_ANGLE_DEG of the road's.
 */
export function mergingLinks(carriageways, { maxAngleDeg = MERGE_MAX_ANGLE_DEG } = {}) {
  const out = new Map();
  const cosMax = Math.cos((maxAngleDeg * Math.PI) / 180);
  const links = carriageways.filter((cw) => isLink(cw) && cw.nodes?.length >= 2);
  if (!links.length) return out;
  const roads = carriageways.filter((cw) => !isLink(cw) && cw.nodes?.length >= 2);
  for (const link of links) {
    for (const end of [0, 1]) {
      const p = end ? link.nodes[link.nodes.length - 1] : link.nodes[0];
      const dir = endDirection(link.nodes, end, END_LOOK_M);
      if (!dir) continue;
      for (const road of roads) {
        if (!(road.half > link.half)) continue;
        const near = nearestOn(road.nodes, p[0], p[1]);
        if (!near || near.d > road.half) continue;
        if (Math.abs(dir[0] * near.tx + dir[1] * near.ty) < cosMax) continue;
        if (!out.has(road.owner)) out.set(road.owner, new Set());
        out.get(road.owner).add(link.owner);
      }
    }
  }
  return out;
}

/** The paint a merging link leaves alone on the road it joins: the lines between lanes, not the road's edges. */
export const keptThroughMerge = (layerName) => typeof layerName === 'string' && (layerName.startsWith('line_sep_') || layerName === 'line_center');
