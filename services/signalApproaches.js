// Junction approaches for traffic signals and stop signs.
//
// BeamNG ties a signal instance to ONE approach edge: its `pos` is the stop
// point (resolved to the closest navgraph edge) and `dir` the travel
// direction (core/trafficSignals.lua). So a junction needs one instance per
// incoming road, placed on that road's centreline a few metres before the
// junction node — not one per OSM signal point at the point itself, which
// leaves cross streets uncontrolled when the signal is mapped on the junction
// node. Engine facts used here are from BeamNG.Earth's navgraph research
// (refs/BeamNG.Earth-main/docs/research/2026-10-10-navgraph-traffic-signals.md).
//
// Everything works in a local metric frame (x east, y north, metres).

import { makeRoadNodeKey } from './roadNetwork.js';

// An OSM signal on an approach belongs to the junction it leads to.
export const SIGNAL_TO_JUNCTION_MAX_M = 40;
// Signal junction nodes this close and connected form one intersection
// (dual carriageways, offset T's).
export const JUNCTION_CLUSTER_M = 25;
// BeamNG puts the stop point 6–10 m before the junction node.
export const STOP_POINT_DEFAULT_M = 8;
// The AI's 4-way-stop logic looks for the junction within 20 m of a stop sign.
export const STOP_TO_JUNCTION_MAX_M = 20;
// Mid-block (crossing) signals: stop just before the crossing.
export const MIDBLOCK_STOP_M = 3;
const SNAP_MAX_M = 20;
const LANE_WIDTH_M = 3.25;

const ROAD_RANK = {
  motorway: 9, trunk: 8, primary: 7, secondary: 6, tertiary: 5,
  unclassified: 4, residential: 3, road: 3, living_street: 2, service: 1, track: 0,
};
export const roadRank = (highway) => ROAD_RANK[String(highway ?? '').replace(/_link$/, '')] ?? 3;

const norm = (value) => String(value ?? '').trim().toLowerCase();
const parseLanes = (value) => {
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) && n > 0 ? n : 0;
};

// +1: travel along node order only, -1: against it only, 0: both ways.
export function onewayDirection(tags = {}) {
  const oneway = norm(tags.oneway);
  if (oneway === '-1' || oneway === 'reverse') return -1;
  if (oneway === 'yes' || oneway === '1' || oneway === 'true') return 1;
  if (oneway === 'no') return 0;
  if (norm(tags.junction) === 'roundabout') return 1;
  if (tags.highway === 'motorway' || tags.highway === 'motorway_link') return 1;
  return 0;
}

const defaultLaneCount = (highway, oneWay) => {
  const base = String(highway ?? '').replace(/_link$/, '');
  if (String(highway).endsWith('_link')) return 1;
  if (base === 'motorway' || base === 'trunk') return oneWay ? 2 : 4;
  if (base === 'service' || base === 'track') return oneWay ? 1 : 2;
  return oneWay ? 1 : 2;
};

// Half the paved carriageway, from width / lanes / class defaults.
export function roadHalfWidth(tags = {}) {
  const width = Number.parseFloat(tags.width);
  if (Number.isFinite(width) && width > 1) return width / 2;
  const oneWay = onewayDirection(tags) !== 0;
  const lanes = parseLanes(tags.lanes)
    || (parseLanes(tags['lanes:forward']) + parseLanes(tags['lanes:backward']))
    || defaultLaneCount(tags.highway, oneWay);
  return Math.max(2.5, (lanes * LANE_WIDTH_M) / 2);
}

// Lanes carrying traffic in one travel direction (+1 along node order).
function lanesInDirection(tags, travelSign) {
  const way = onewayDirection(tags);
  const total = parseLanes(tags.lanes);
  if (way !== 0) return Math.max(1, total || defaultLaneCount(tags.highway, true));
  const tagged = parseLanes(travelSign > 0 ? tags['lanes:forward'] : tags['lanes:backward']);
  if (tagged) return tagged;
  return Math.max(1, Math.ceil((total || defaultLaneCount(tags.highway, false)) / 2));
}

export function makeProjector(originLat, originLng) {
  const mLat = 111320;
  const mLng = 111320 * Math.cos((originLat * Math.PI) / 180);
  return {
    project: (pt) => [(pt.lng - originLng) * mLng, (pt.lat - originLat) * mLat],
    unproject: (x, y) => ({ lat: originLat + y / mLat, lng: originLng + x / mLng }),
  };
}

/**
 * Road graph keyed by shared OSM vertices. Each undirected edge records which
 * travel directions it allows (`fwd`: from→to, `back`: to→from).
 */
export function buildRoadGraph(roads, projector) {
  const nodes = new Map();
  const edges = [];
  const nodeFor = (pt) => {
    const key = makeRoadNodeKey(pt);
    let node = nodes.get(key);
    if (!node) {
      const [x, y] = projector.project(pt);
      node = { key, lat: pt.lat, lng: pt.lng, x, y, edges: [] };
      nodes.set(key, node);
    }
    return node;
  };
  roads.forEach((road, roadIndex) => {
    const geom = road.geometry;
    const way = onewayDirection(road.tags);
    const halfWidth = roadHalfWidth(road.tags);
    for (let i = 0; i + 1 < geom.length; i++) {
      const a = nodeFor(geom[i]);
      const b = nodeFor(geom[i + 1]);
      if (a === b) continue;
      const edge = {
        from: a, to: b, road, roadIndex, halfWidth,
        length: Math.hypot(b.x - a.x, b.y - a.y),
        fwd: way >= 0, back: way <= 0,
      };
      edges.push(edge);
      a.edges.push(edge);
      b.edges.push(edge);
    }
  });
  return { nodes, edges };
}

const isJunction = (node) => node.edges.length >= 3;
const otherEnd = (edge, node) => (edge.from === node ? edge.to : edge.from);
// Travel allowed from `node` along `edge` (leaving node).
const canLeave = (edge, node) => (edge.from === node ? edge.fwd : edge.back);
// Travel allowed along `edge` arriving at `node`.
const canArrive = (edge, node) => (edge.to === node ? edge.fwd : edge.back);

/**
 * Follow a road outward from `start` along `edge` through plain (degree-2)
 * vertices until a junction / dead end / `maxM`. Returns the path as oriented
 * steps {edge, from, to, startM}.
 */
function walk(start, edge, maxM, stopAt = isJunction) {
  const steps = [];
  let node = start;
  let current = edge;
  let travelled = 0;
  while (current && travelled <= maxM) {
    const next = otherEnd(current, node);
    steps.push({ edge: current, from: node, to: next, startM: travelled });
    travelled += current.length;
    if (stopAt(next) || next.edges.length !== 2) return { steps, end: next, length: travelled };
    node = next;
    current = next.edges.find((e) => e !== current);
  }
  return { steps, end: null, length: travelled };
}

// Point and travel direction `distM` outward along a walked path.
function pointAlong(path, distM) {
  for (const step of path.steps) {
    if (distM <= step.startM + step.edge.length || step === path.steps[path.steps.length - 1]) {
      const t = step.edge.length > 0 ? Math.min(1, Math.max(0, (distM - step.startM) / step.edge.length)) : 0;
      const dx = step.to.x - step.from.x;
      const dy = step.to.y - step.from.y;
      const len = Math.hypot(dx, dy) || 1;
      return { x: step.from.x + dx * t, y: step.from.y + dy * t, outward: [dx / len, dy / len], edge: step.edge };
    }
  }
  return null;
}

function snapToGraph(graph, pt, projector) {
  const exact = graph.nodes.get(makeRoadNodeKey(pt));
  if (exact) return exact;
  const [x, y] = projector.project(pt);
  let best = null;
  let bestD = SNAP_MAX_M;
  for (const node of graph.nodes.values()) {
    const d = Math.hypot(node.x - x, node.y - y);
    if (d < bestD) {
      bestD = d;
      best = node;
    }
  }
  return best;
}

// `traffic_signals:direction` / `direction` = forward|backward relative to
// the way the node sits on: which travel direction the signal faces.
function nodeDirectionTag(tags = {}) {
  const value = norm(tags['traffic_signals:direction'] ?? tags['stop:direction'] ?? tags.direction);
  if (value === 'forward') return 1;
  if (value === 'backward') return -1;
  return 0;
}

/**
 * Nearest junction reachable from a non-junction node, travelling TOWARD it.
 * Returns { junction, path (from junction outward to the node), distance }.
 */
function junctionAhead(node, maxM, dirTag) {
  let best = null;
  for (const edge of node.edges) {
    const path = walk(node, edge, maxM);
    if (!path.end || !isJunction(path.end) || path.length > maxM) continue;
    // Travel node → junction runs along `edge` leaving node.
    if (!canLeave(edge, node)) continue;
    if (dirTag !== 0) {
      const alongOrder = edge.from === node; // leaving along node order
      if ((dirTag > 0) !== alongOrder) continue;
    }
    if (!best || path.length < best.distance) best = { junction: path.end, distance: path.length, firstEdge: edge };
  }
  return best;
}

/** Inbound arms of one junction node, excluding arms inside `clusterKeys`. */
function junctionArms(junction, clusterKeys) {
  const arms = [];
  for (const edge of junction.edges) {
    const path = walk(junction, edge, 200, (n) => isJunction(n) || clusterKeys.has(n.key));
    if (path.end && clusterKeys.has(path.end.key) && path.length <= JUNCTION_CLUSTER_M + 15) continue; // internal link
    if (!canArrive(edge, junction)) continue; // one-way leaving the junction
    arms.push({ junction, edge, path, armId: `${junction.key}|${otherEnd(edge, junction).key}` });
  }
  return arms;
}

function approachFromArm(arm, stopDistM, hint = null) {
  const at = hint
    ? { x: hint.node.x, y: hint.node.y, outward: pointAlong(arm.path, Math.max(0.5, hint.distance - 0.5))?.outward }
    : pointAlong(arm.path, Math.min(stopDistM, Math.max(1, arm.path.length * 0.6)));
  if (!at?.outward) return null;
  const road = arm.edge.road;
  const travelAlongOrder = arm.edge.to === arm.junction; // arriving along node order
  return {
    armId: arm.armId,
    junctionKey: arm.junction.key,
    x: at.x,
    y: at.y,
    dir: [-at.outward[0], -at.outward[1]],
    road,
    highway: road.tags?.highway,
    halfWidth: arm.edge.halfWidth,
    oneWay: onewayDirection(road.tags) !== 0,
    lanesIn: lanesInDirection(road.tags || {}, travelAlongOrder ? 1 : -1),
    hintTags: hint?.tags || null,
  };
}

// Union-find over junction nodes close enough to be one intersection.
function clusterJunctions(junctions) {
  const parent = new Map(junctions.map((j) => [j.key, j.key]));
  const find = (k) => (parent.get(k) === k ? k : (parent.set(k, find(parent.get(k))), parent.get(k)));
  for (let i = 0; i < junctions.length; i++) {
    for (let j = i + 1; j < junctions.length; j++) {
      if (Math.hypot(junctions[i].x - junctions[j].x, junctions[i].y - junctions[j].y) <= JUNCTION_CLUSTER_M) {
        parent.set(find(junctions[i].key), find(junctions[j].key));
      }
    }
  }
  const groups = new Map();
  for (const j of junctions) {
    const root = find(j.key);
    if (!groups.has(root)) groups.set(root, []);
    groups.get(root).push(j);
  }
  return [...groups.values()];
}

/**
 * Signalled intersections and stop-controlled approaches.
 *
 *   signalPoints: [{ point: {lat,lng}, tags }]  (highway=traffic_signals)
 *   stopPoints:   [{ point: {lat,lng}, tags }]  (highway=stop)
 *
 * Returns { intersections: [{ center:[x,y], midblock, approaches }], stopApproaches }
 * where each approach is { x, y, dir, halfWidth, lanesIn, oneWay, highway, ... }.
 */
export function findSignalApproaches({ roads, signalPoints = [], stopPoints = [], projector }) {
  const graph = buildRoadGraph(roads, projector);
  const intersections = [];

  // ── Traffic signals ────────────────────────────────────────────────────
  const signalJunctions = new Map();
  const hintsByArm = new Map();
  const midblock = [];
  for (const signal of signalPoints) {
    const node = snapToGraph(graph, signal.point, projector);
    if (!node) continue;
    if (isJunction(node)) {
      signalJunctions.set(node.key, node);
      continue;
    }
    const ahead = junctionAhead(node, SIGNAL_TO_JUNCTION_MAX_M, nodeDirectionTag(signal.tags));
    if (!ahead) {
      midblock.push({ node, tags: signal.tags || {} });
      continue;
    }
    signalJunctions.set(ahead.junction.key, ahead.junction);
    // The mapped signal marks this arm's stop line.
    const armPath = walk(node, ahead.firstEdge, SIGNAL_TO_JUNCTION_MAX_M);
    const lastStep = armPath.steps[armPath.steps.length - 1];
    const armId = `${ahead.junction.key}|${lastStep.from.key}`;
    if (!hintsByArm.has(armId)) hintsByArm.set(armId, { node, distance: ahead.distance, tags: signal.tags || {} });
  }

  for (const cluster of clusterJunctions([...signalJunctions.values()])) {
    const keys = new Set(cluster.map((j) => j.key));
    const approaches = [];
    for (const junction of cluster) {
      for (const arm of junctionArms(junction, keys)) {
        const approach = approachFromArm(arm, STOP_POINT_DEFAULT_M, hintsByArm.get(arm.armId));
        if (approach) approaches.push(approach);
      }
    }
    if (approaches.length === 0) continue;
    const cx = cluster.reduce((s, j) => s + j.x, 0) / cluster.length;
    const cy = cluster.reduce((s, j) => s + j.y, 0) / cluster.length;
    intersections.push({ center: [cx, cy], midblock: false, approaches });
  }

  // Signals with no junction nearby: pedestrian crossings and similar.
  const midblockGroups = [];
  for (const item of midblock) {
    const group = midblockGroups.find((g) => Math.hypot(g.x - item.node.x, g.y - item.node.y) <= 30);
    if (group) group.items.push(item);
    else midblockGroups.push({ x: item.node.x, y: item.node.y, items: [item] });
  }
  for (const group of midblockGroups) {
    const approaches = [];
    for (const { node, tags } of group.items) {
      const dirTag = nodeDirectionTag(tags);
      for (const edge of node.edges) {
        if (!canArrive(edge, node)) continue;
        if (dirTag !== 0 && (dirTag > 0) !== (edge.to === node)) continue;
        const path = walk(node, edge, 60);
        const at = pointAlong(path, MIDBLOCK_STOP_M);
        if (!at) continue;
        const dir = [-at.outward[0], -at.outward[1]];
        // One instance per travel direction for the whole crossing.
        if (approaches.some((a) => a.dir[0] * dir[0] + a.dir[1] * dir[1] > 0.85)) continue;
        approaches.push({
          armId: `${node.key}|${otherEnd(edge, node).key}`,
          junctionKey: node.key,
          x: at.x,
          y: at.y,
          dir,
          road: edge.road,
          highway: edge.road.tags?.highway,
          halfWidth: edge.halfWidth,
          oneWay: onewayDirection(edge.road.tags) !== 0,
          lanesIn: lanesInDirection(edge.road.tags || {}, edge.to === node ? 1 : -1),
          hintTags: tags,
        });
      }
    }
    if (approaches.length > 0) intersections.push({ center: [group.x, group.y], midblock: true, approaches });
  }

  // ── Stop signs ─────────────────────────────────────────────────────────
  const stopByArm = new Map();
  const addStop = (approach) => {
    if (approach && !stopByArm.has(approach.armId)) stopByArm.set(approach.armId, approach);
  };
  for (const stop of stopPoints) {
    const tags = stop.tags || {};
    const node = snapToGraph(graph, stop.point, projector);
    if (!node) continue;
    const allWay = norm(tags.stop) === 'all';
    let junction = isJunction(node) ? node : null;
    let ahead = null;
    if (!junction) {
      ahead = junctionAhead(node, SIGNAL_TO_JUNCTION_MAX_M, nodeDirectionTag(tags));
      junction = ahead?.junction ?? null;
    }
    if (!junction) continue;
    const arms = junctionArms(junction, new Set([junction.key]));
    if (allWay) {
      // stop=all: every approach stops (BeamNG's 4-way-stop logic).
      for (const arm of arms) addStop(approachFromArm(arm, STOP_POINT_DEFAULT_M));
      continue;
    }
    if (node === junction) {
      // Stop mapped on the junction node: the minor approaches stop.
      const minRank = Math.min(...arms.map((arm) => roadRank(arm.edge.road.tags?.highway)));
      for (const arm of arms) {
        if (roadRank(arm.edge.road.tags?.highway) === minRank) addStop(approachFromArm(arm, STOP_POINT_DEFAULT_M));
      }
      continue;
    }
    // Stop mapped on its approach: keep the mapped spot unless it is too far
    // from the junction for the AI to link it to the intersection.
    const armPath = walk(node, ahead.firstEdge, SIGNAL_TO_JUNCTION_MAX_M);
    const lastStep = armPath.steps[armPath.steps.length - 1];
    const arm = arms.find((a) => a.armId === `${junction.key}|${lastStep.from.key}`);
    if (!arm) continue;
    const hint = ahead.distance <= STOP_TO_JUNCTION_MAX_M ? { node, distance: ahead.distance, tags } : null;
    addStop(approachFromArm(arm, STOP_POINT_DEFAULT_M, hint));
  }

  return { intersections, stopApproaches: [...stopByArm.values()] };
}

/**
 * Split an intersection's approaches into two phases by travel axis
 * (direction mod 180°), seeded by the most different pair. Approaches within
 * 30° of one axis share a phase. Returns [primary, secondary]; primary holds
 * the highest-ranked road so the main road leads the cycle.
 */
export function splitApproachesByAxis(approaches) {
  if (approaches.length <= 1) return [approaches, []];
  const doubled = approaches.map((a) => 2 * Math.atan2(a.dir[1], a.dir[0]));
  const gap = (p, q) => {
    const d = Math.abs(((p - q) % (2 * Math.PI) + 3 * Math.PI) % (2 * Math.PI) - Math.PI);
    return d;
  };
  let seeds = null;
  let widest = 0;
  for (let i = 0; i < doubled.length; i++) {
    for (let j = i + 1; j < doubled.length; j++) {
      const g = gap(doubled[i], doubled[j]);
      if (g > widest) {
        widest = g;
        seeds = [i, j];
      }
    }
  }
  if (!seeds || widest < Math.PI / 3) return [approaches, []];
  const a = [];
  const b = [];
  approaches.forEach((approach, i) => {
    (gap(doubled[i], doubled[seeds[0]]) <= gap(doubled[i], doubled[seeds[1]]) ? a : b).push(approach);
  });
  const rank = (group) => Math.max(...group.map((x) => roadRank(x.highway)));
  return rank(a) >= rank(b) ? [a, b] : [b, a];
}
