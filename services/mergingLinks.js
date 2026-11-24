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
const WIDE_AS_M = 1;                     // another carriageway within this of the road's half width: as wide
const END_NODE_M = 1.5;                  // a link ending this near a road's own end point meets it at its end
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

/**
 * Each merge as { link, road, end, atRoadEnd }: link and road are carriageway owners, end is 0 (the link's first
 * point) or 1 (its last) lying on the road; atRoadEnd when that is the road's own end point. The same test as
 * mergingLinks.
 */
export function mergingLinkEnds(carriageways, { maxAngleDeg = MERGE_MAX_ANGLE_DEG } = {}) {
  const out = [];
  const cosMax = Math.cos((maxAngleDeg * Math.PI) / 180);
  const links = carriageways.filter((cw) => isLink(cw) && cw.nodes?.length >= 2);
  const roads = carriageways.filter((cw) => !isLink(cw) && cw.nodes?.length >= 2);
  for (const link of links) {
    for (const end of [0, 1]) {
      const p = end ? link.nodes[link.nodes.length - 1] : link.nodes[0];
      const dir = endDirection(link.nodes, end, END_LOOK_M);
      if (!dir) continue;
      // (the widest road the end lies on: where two ways of the street meet at the node, either will do)
      let best = null;
      for (const road of roads) {
        if (!(road.half > link.half)) continue;
        const near = nearestOn(road.nodes, p[0], p[1]);
        if (!near || near.d > road.half) continue;
        if (Math.abs(dir[0] * near.tx + dir[1] * near.ty) < cosMax) continue;
        if (!best || road.half > best.half) best = road;
      }
      // (atRoadEnd: the link meets the road at the road's own first or last point, where roads fan in to a wide
      // street's end, not part-way along it. Ending the link's surface early does nothing there: see the callers)
      if (best) {
        const a = best.nodes[0]; const z = best.nodes[best.nodes.length - 1];
        // (... and no other carriageway as wide carries on from that point: a street mapped as several ways end to
        // end has an end point at every junction along it, and is no end of the street)
        const endsAt = (cw) => { const q0 = cw.nodes[0]; const q1 = cw.nodes[cw.nodes.length - 1]; return Math.min(fastHypot(q0[0] - p[0], q0[1] - p[1]), fastHypot(q1[0] - p[0], q1[1] - p[1])) <= END_NODE_M; };
        const carriesOn = roads.some((cw) => cw !== best && cw.half >= best.half - WIDE_AS_M && endsAt(cw));
        const atRoadEnd = Math.min(fastHypot(a[0] - p[0], a[1] - p[1]), fastHypot(z[0] - p[0], z[1] - p[1])) <= END_NODE_M && !carriesOn;
        out.push({ link: link.owner, road: best.owner, end, atRoadEnd });
      }
    }
  }
  return out;
}

/**
 * Where a merging link's own surface ends: its centre line has reached the centre of the road's outer lane, that is
 * (road half - link half) from the road's centre line, measured along the link from its end on the road.
 * nodes: the link's surface decal's nodes [[x, y, z, w]...]; end: 0 or 1, the end on the road; roadLines: the centre
 * lines ([[x, y, ...]...]) of the road's carriageways at the merge; offsetM: that distance.
 * Returns { visible, hidden } node lists (the hidden one from the cut to the road's centre line, in the decal's own
 * direction), or null when the link never gets that far out (it runs along inside the road) or the cut would leave
 * less than two points on either side.
 */
export function cutAtOuterLane(nodes, end, roadLines, offsetM, { stepM = 0.5 } = {}) {
  if (!(nodes?.length >= 2) || !(offsetM > 0.2)) return null;
  const seq = end ? [...nodes].reverse() : nodes;   // from the end on the road, outward
  const off = (x, y) => { let d = Infinity; for (const line of roadLines) { const n = nearestOn(line, x, y); if (n && n.d < d) d = n.d; } return d; };
  let acc = 0;
  for (let i = 0; i + 1 < seq.length; i++) {
    const a = seq[i]; const b = seq[i + 1];
    const L = fastHypot(b[0] - a[0], b[1] - a[1]); if (L < 1e-6) continue;
    const n = Math.max(1, Math.ceil(L / stepM));
    for (let k = 1; k <= n; k++) {
      const t = k / n;
      const p = a.map((v, j) => (Number.isFinite(v) && Number.isFinite(b[j]) ? v + (b[j] - v) * t : v));
      if (off(p[0], p[1]) < offsetM) continue;
      // the cut point P = p: hidden is seq[0..i] + P, visible is P + seq[i+1..]
      if (acc + L * t < 1) return null;                       // (it leaves the road at once: nothing worth hiding)
      const hiddenOut = [...seq.slice(0, i + 1), p];
      const visibleOut = t >= 1 - 1e-9 ? seq.slice(i + 1) : [p, ...seq.slice(i + 1)];
      if (hiddenOut.length < 2 || visibleOut.length < 2) return null;
      return end ? { visible: visibleOut.reverse(), hidden: hiddenOut.reverse() } : { visible: visibleOut, hidden: hiddenOut };
    }
    acc += L;
  }
  return null;
}

/** The paint a merging link leaves alone on the road it joins: the lines between lanes, not the road's edges. */
export const keptThroughMerge = (layerName) => typeof layerName === 'string' && (layerName.startsWith('line_sep_') || layerName === 'line_center');
