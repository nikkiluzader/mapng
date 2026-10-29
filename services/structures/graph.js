// Structure solver, stage A: the road graph (refs/output/bridge-tunnel-plan.md).
//
// Roads become edges between nodes joined by POSITION. The road network the
// DecalRoads use keys its nodes by position and layer, so a bridge (layer 1)
// and its approach road (layer 0) sharing a vertex never meet there. Here
// they do, and every point where a road's structure changes (onto a bridge,
// into a tunnel, up or down a layer) is an explicit joint that the profile
// solve must keep level.
//
// Each edge carries stations (every STATION_M plus every OSM vertex) with the
// original ground under them, in typed arrays: the solve's unknowns live
// there. Pure geometry and tags; nothing here knows about any place.

import { makeRoadNodeKey } from '../roadNetwork.js';

export const STATION_M = 4;

/** Structure flags of a road from its OSM tags. */
export function structureOf(tags = {}) {
  const bridge = (!!tags.bridge && tags.bridge !== 'no')
    || tags.man_made === 'bridge' || tags.location === 'elevated' || tags.location === 'overground';
  const tunnel = (!!tags.tunnel && tags.tunnel !== 'no')
    || tags.location === 'underground' || tags.location === 'underwater';
  return {
    bridge,
    tunnel,
    covered: tags.covered === 'yes',
    cutting: !!tags.cutting && tags.cutting !== 'no',
    embankment: !!tags.embankment && tags.embankment !== 'no',
  };
}

const structureKey = (e) => `${e.bridge ? 'b' : ''}${e.tunnel ? 't' : ''}|${e.layer}`;

// Stations along projected points [[x, y]...]: every stationM and at every
// vertex. Returns { x, y, s, vertex } typed arrays.
function stationsAlong(xy, stationM) {
  const xs = []; const ys = []; const ss = []; const vs = [];
  let s = 0;
  xs.push(xy[0][0]); ys.push(xy[0][1]); ss.push(0); vs.push(1);
  for (let i = 0; i + 1 < xy.length; i++) {
    const [ax, ay] = xy[i]; const [bx, by] = xy[i + 1];
    const L = Math.hypot(bx - ax, by - ay);
    if (L < 1e-6) continue;
    const n = Math.max(1, Math.ceil(L / stationM));
    for (let k = 1; k <= n; k++) {
      const f = k / n;
      xs.push(ax + (bx - ax) * f); ys.push(ay + (by - ay) * f); ss.push(s + L * f); vs.push(k === n ? 1 : 0);
    }
    s += L;
  }
  return { x: Float64Array.from(xs), y: Float64Array.from(ys), s: Float64Array.from(ss), vertex: Uint8Array.from(vs) };
}

/**
 * Build the structure graph.
 *   segments: road segments ({ geometry: [{lat, lng}...], tags, highway,
 *             layer, sourceFeature }), as roadNetwork builds them
 *   project(lat, lng) -> [x, y, ground]: world metres and original ground
 *   groundAt(x, y) -> original ground (optional: else interpolated from the
 *             projected vertices' ground)
 *   halfOf(segment) -> half width of its paved surface (m)
 *   isFreeEnd(x, y) -> true at the map edge (a road leaving the map)
 * Returns { nodes, edges, stats }:
 *   node { id, x, y, edges: [{ edge, end: 0 | 1 }], kind, layers, joint }
 *     kind: 'end' | 'edgeOfMap' | 'through' | 'joint' | 'junction'
 *   edge { id, seg, wayId, highway, layer, half, bridge, tunnel, covered,
 *          cutting, embankment, from, to, length, x, y, s, g, vertex }
 */
export function buildStructureGraph(segments, { project, groundAt = null, halfOf = () => 3.5, isFreeEnd = () => false, stationM = STATION_M } = {}) {
  const nodes = new Map();
  const edges = [];
  const nodeAt = (pt, x, y) => {
    const key = makeRoadNodeKey(pt);
    let node = nodes.get(key);
    if (!node) { node = { id: key, x, y, edges: [] }; nodes.set(key, node); }
    return node;
  };
  // split every segment at interior vertices another segment shares by
  // position, whatever its layer (a ramp joining a deck mid-way)
  const shared = new Map();
  for (const seg of segments) {
    for (const key of new Set((seg.geometry || []).map((p) => makeRoadNodeKey(p)))) shared.set(key, (shared.get(key) || 0) + 1);
  }
  const pieces = [];
  segments.forEach((seg, segIndex) => {
    const geom = seg.geometry || [];
    let start = 0;
    for (let i = 1; i < geom.length; i++) {
      if (i === geom.length - 1 || (shared.get(makeRoadNodeKey(geom[i])) || 0) >= 2) {
        pieces.push({ seg, segIndex, geom: geom.slice(start, i + 1) });
        start = i;
      }
    }
  });
  pieces.forEach(({ seg, segIndex, geom }) => {
    if (geom.length < 2) return;
    const pts = geom.map((p) => project(p.lat, p.lng));
    if (pts.some((p) => !Number.isFinite(p[0]) || !Number.isFinite(p[1]))) return;
    const st = stationsAlong(pts.map((p) => [p[0], p[1]]), stationM);
    if (st.s.length < 2 || st.s[st.s.length - 1] < 1e-3) return;
    const g = new Float64Array(st.s.length).fill(NaN);
    if (groundAt) for (let i = 0; i < g.length; i++) g[i] = groundAt(st.x[i], st.y[i]);
    const tags = seg.tags || seg.sourceFeature?.tags || {};
    const edge = {
      id: edges.length,
      seg: segIndex,
      wayId: seg.sourceFeature?.id ?? null,
      highway: seg.highway || tags.highway || '',
      layer: Number.isFinite(seg.layer) ? seg.layer : (Number.parseInt(tags.layer, 10) || 0),
      half: halfOf(seg),
      ...structureOf(tags),
      structure: tags['bridge:structure'] || '',
      length: st.s[st.s.length - 1],
      ...st,
      g,
    };
    // without groundAt: the projected vertices' ground, interpolated between
    if (!groundAt) {
      let vi = 0;
      for (let i = 0; i < g.length; i++) if (st.vertex[i]) g[i] = pts[Math.min(vi++, pts.length - 1)][2];
      for (let i = 0; i < g.length; i++) {
        if (Number.isFinite(g[i])) continue;
        let a = i - 1; while (a >= 0 && !Number.isFinite(g[a])) a--;
        let b = i + 1; while (b < g.length && !Number.isFinite(g[b])) b++;
        g[i] = a >= 0 && b < g.length ? g[a] + (g[b] - g[a]) * ((st.s[i] - st.s[a]) / (st.s[b] - st.s[a] || 1)) : (a >= 0 ? g[a] : g[b]);
      }
    }
    const from = nodeAt(geom[0], st.x[0], st.y[0]);
    const to = nodeAt(geom[geom.length - 1], st.x[st.x.length - 1], st.y[st.y.length - 1]);
    edge.from = from.id; edge.to = to.id;
    from.edges.push({ edge: edge.id, end: 0 });
    to.edges.push({ edge: edge.id, end: 1 });
    edges.push(edge);
  });

  const stats = { nodes: nodes.size, edges: edges.length, stations: 0, ends: 0, edgeOfMap: 0, through: 0, joints: 0, junctions: 0, multiLevelJunctions: 0, bridgeEdges: 0, tunnelEdges: 0 };
  for (const e of edges) {
    stats.stations += e.s.length;
    if (e.bridge) stats.bridgeEdges++;
    if (e.tunnel) stats.tunnelEdges++;
  }
  for (const node of nodes.values()) {
    const incident = node.edges.map(({ edge }) => edges[edge]);
    node.layers = [...new Set(incident.map((e) => e.layer))].sort((a, b) => a - b);
    const kinds = new Set(incident.map(structureKey));
    node.joint = kinds.size > 1;
    if (node.edges.length === 1) node.kind = isFreeEnd(node.x, node.y) ? 'edgeOfMap' : 'end';
    else if (node.edges.length === 2) node.kind = node.joint ? 'joint' : 'through';
    else node.kind = 'junction';
    if (node.kind === 'end') stats.ends++;
    else if (node.kind === 'edgeOfMap') stats.edgeOfMap++;
    else if (node.kind === 'through') stats.through++;
    else if (node.kind === 'joint') stats.joints++;
    else {
      stats.junctions++;
      if (node.layers.length > 1) stats.multiLevelJunctions++;
    }
  }
  return { nodes, edges, stats };
}
