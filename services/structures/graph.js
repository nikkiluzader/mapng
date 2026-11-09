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
import { isBoredTunnelTag } from '../beamngTunnels.js';

export const STATION_M = 4;
const JOIN_M = 0.5;

/** Structure flags of a road from its OSM tags. */
export function structureOf(tags = {}) {
  const bridge = (!!tags.bridge && tags.bridge !== 'no')
    || tags.man_made === 'bridge' || tags.location === 'elevated' || tags.location === 'overground';
  // (as the tunnel builder: a building passage or culvert stays on the ground)
  const tunnel = isBoredTunnelTag(tags)
    || tags.location === 'underground' || tags.location === 'underwater';
  return {
    bridge,
    tunnel,
    // a drawbridge opens for ships: no navigation clearance under it
    // (its kind where mapped: bascule, lift, swing; 'yes' for a movable span of no kind given)
    movable: (tags['bridge:movable'] && tags['bridge:movable'] !== 'no') ? String(tags['bridge:movable']).toLowerCase() : (tags.bridge === 'movable' ? 'yes' : false),
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
 *   clip(geometry) -> the parts of a road's geometry inside the map
 *             (optional): points it adds on the map's edge carry cut: true.
 *             Without it a road running on past the edge has its outside
 *             vertices squashed onto the edge by project(), where unrelated
 *             roads (both decks of a double-deck bridge, a street under it)
 *             fell within JOIN_M of each other and became one junction.
 * Returns { nodes, edges, stats }:
 *   node { id, x, y, edges: [{ edge, end: 0 | 1 }], kind, layers, joint }
 *     kind: 'end' | 'edgeOfMap' | 'through' | 'joint' | 'junction'
 *   edge { id, seg, wayId, highway, layer, half, bridge, tunnel, covered,
 *          cutting, embankment, from, to, length, x, y, s, g, vertex }
 */
export function buildStructureGraph(segments, { project, groundAt = null, halfOf = () => 3.5, isFreeEnd = () => false, clip = null, stationM = STATION_M } = {}) {
  const nodes = new Map();
  const edges = [];
  // each road's geometry inside the map, in one or more parts
  const partsOf = segments.map((seg) => {
    const g = seg.geometry || [];
    return clip ? clip(g).filter((part) => part.length >= 2) : [g];
  });
  // a point clip() put on the map's edge belongs to its road alone (never
  // joined by position: two roads leaving the map side by side would meet)
  const rawKey = (p, segIndex) => (p.cut ? `cut:${segIndex}:${p.lat}:${p.lng}` : makeRoadNodeKey(p));
  // vertices of different roads within JOIN_M are one point (a shared OSM
  // vertex nudged a few cm by curve fitting or snapping on one road only:
  // by exact position a bridge and its approach never met)
  const canon = new Map();     // key -> canonical key
  const cells = new Map();     // 1 m cell -> [{ key, x, y, seg }]
  // (across layers only where one of the two is a road's end: a bridge's end
  // on its approach, a ramp onto a deck mid-way. Two interior vertices of
  // roads passing over each other that happened to fall that close were one
  // junction: the road under a kart track's bridge levelled up into the deck)
  const layerOf = (seg) => (Number.isFinite(seg.layer) ? seg.layer : (Number.parseInt((seg.tags || seg.sourceFeature?.tags || {}).layer, 10) || 0));
  // one OSM node shared by roads passing through it on different layers is
  // a crossing someone joined, not a junction (a frontage road and a
  // level-4 ramp over it: the frontage network rode up 20 m): one node per
  // layer of the roads passing through; a road ending there joins the
  // nearest of them
  const through = new Map();   // raw key -> Set of layers of roads passing through it
  const usedBy = new Map();    // raw key -> Set of roads with a vertex there
  partsOf.forEach((parts, segIndex) => {
    const layer = layerOf(segments[segIndex]);
    for (const g of parts) g.forEach((p, i) => {
      if (p.cut) return;
      const rk = rawKey(p, segIndex);
      if (!usedBy.has(rk)) usedBy.set(rk, new Set());
      usedBy.get(rk).add(segIndex);
      if (i === 0 || i === g.length - 1) return;
      const k = rawKey(p, segIndex);
      if (!through.has(k)) through.set(k, new Set());
      through.get(k).add(layer);
    });
  });
  const layered = (p, segIndex, end) => {
    const k = rawKey(p, segIndex);
    const ls = through.get(k);
    if (!ls || ls.size < 2) return k;
    const own = layerOf(segments[segIndex]);
    if (!end && ls.has(own)) return `${k}|L${own}`;
    let best = null;
    for (const l of ls) if (best === null || Math.abs(l - own) < Math.abs(best - own) || (Math.abs(l - own) === Math.abs(best - own) && l < best)) best = l;
    return `${k}|L${best}`;
  };
  const keyOf = (p, segIndex, end) => {
    const key = layered(p, segIndex, end);
    const known = canon.get(key);
    if (known) return known;
    if (p.cut) { canon.set(key, key); return key; }
    const [x, y] = project(p.lat, p.lng);
    const cx = Math.floor(x); const cy = Math.floor(y);
    const layer = layerOf(segments[segIndex]);
    // (an end that already meets another road at this very vertex is a
    // junction of its own: not joined across layers to a vertex near it, a
    // frontage links' meeting 0.45 m from a level-4 ramp's vertex over it)
    const own = (usedBy.get(rawKey(p, segIndex))?.size || 0) >= 2;
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        for (const c of cells.get(`${cx + dx},${cy + dy}`) || []) {
          if (c.seg !== segIndex && Math.hypot(c.x - x, c.y - y) <= JOIN_M && (c.layer === layer || ((c.end || end) && !(own || c.own)))) { canon.set(key, c.key); return c.key; }
        }
      }
    }
    canon.set(key, key);
    const cell = `${cx},${cy}`;
    if (!cells.has(cell)) cells.set(cell, []);
    cells.get(cell).push({ key, x, y, seg: segIndex, layer, end, own });
    return key;
  };
  partsOf.forEach((parts, segIndex) => { for (const g of parts) g.forEach((p, i) => keyOf(p, segIndex, i === 0 || i === g.length - 1)); });
  const nodeAt = (pt, x, y, segIndex, end) => {
    const key = canon.get(layered(pt, segIndex, end)) || layered(pt, segIndex, end);
    let node = nodes.get(key);
    if (!node) { node = { id: key, x, y, edges: [] }; nodes.set(key, node); }
    return node;
  };
  // split every segment at interior vertices another segment shares by
  // position, whatever its layer (a ramp joining a deck mid-way)
  const shared = new Map();
  partsOf.forEach((parts, segIndex) => {
    for (const key of new Set(parts.flatMap((g) => g.map((p, i) => canon.get(layered(p, segIndex, i === 0 || i === g.length - 1)))))) shared.set(key, (shared.get(key) || 0) + 1);
  });
  const pieces = [];
  segments.forEach((seg, segIndex) => {
    for (const geom of partsOf[segIndex]) {
      let start = 0;
      for (let i = 1; i < geom.length; i++) {
        if (i === geom.length - 1 || (shared.get(canon.get(layered(geom[i], segIndex, false))) || 0) >= 2) {
          pieces.push({ seg, segIndex, geom: geom.slice(start, i + 1), ends: [start === 0, i === geom.length - 1] });
          start = i;
        }
      }
    }
  });
  pieces.forEach(({ seg, segIndex, geom, ends }) => {
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
      // a railway (services/railways.js): its kind, its class above is 'railway:<kind>'
      rail: seg.rail || null,
      electrified: !!seg.rail && !!tags.electrified && tags.electrified !== 'no',
      layer: Number.isFinite(seg.layer) ? seg.layer : (Number.parseInt(tags.layer, 10) || 0),
      half: halfOf(seg),
      ...structureOf(tags),
      structure: tags['bridge:structure'] || '',
      // (the bridge's look, bridgeStyles.js: its paint, OSM bridge=* kind and wikidata)
      paint: tags.colour || tags['bridge:colour'] || '',
      bridgeKind: tags.bridge || '',
      wikidata: tags.wikidata || tags['bridge:wikidata'] || '',
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
    const from = nodeAt(geom[0], st.x[0], st.y[0], segIndex, ends[0]);
    const to = nodeAt(geom[geom.length - 1], st.x[st.x.length - 1], st.y[st.y.length - 1], segIndex, ends[1]);
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
