// Structure solver, stage B: crossings and their order
// (refs/output/bridge-tunnel-plan.md).
//
// Every place two graph edges cross without meeting at a node, which one
// goes on top and the vertical separation they need, and every run of a
// bridge over water with the clearance it needs. The profile solve turns
// these into hard constraints. Pure geometry and tags: nothing here knows
// about any place.

import { DECK_ROAD_CLEAR_M, NAV_CLEAR_M, NAV_RUN_M, navClearance, waterClear } from '../beamngBridges.js';
import { gradeLimit } from './profileSolve.js';

const MOVABLE_CLEAR_M = 6;      // a drawbridge sits low and opens for ships
const REACH_SHARE = 0.8;        // of the climb its length allows (room for vertical curves)
const WATER_CLEAR_FLOOR_M = 2.5; // over water a deck always keeps this much
import { cellsAlong } from './metrics.js';

const CELL_M = 32;
// A hit this close to a node both edges share is their junction, not a
// crossing.
const SHARED_NODE_M = 2;
// Decks of different layers this much closer than their half widths' sum
// overlap; not counted this near a junction they share.
const OVERLAP_SHARE = 0.85;
const OVERLAP_NODE_M = 30;
const OVERLAP_CELL_M = 16;
const OVERLAP_ALIGN = 0.8;      // |cos| of the angle between them
const OVERLAP_RUN_M = 20;
// Classes that are paths, not roads: what they need over or under them.
const PATH_CLASSES = new Set(['footway', 'cycleway', 'path', 'pedestrian', 'steps', 'bridleway', 'track']);
const PATH_UNDER_M = 2.5 + 2.2;       // headroom over a path + a road deck
const ROAD_UNDER_PATH_DECK_M = 4.5 + 0.6;  // headroom over a road + a footbridge deck

/** Vertical separation an `upper` edge needs over a `lower` one (deck top over road surface). */
export function requiredSeparation(upper, lower) {
  if (PATH_CLASSES.has(lower.highway)) return PATH_UNDER_M;
  if (PATH_CLASSES.has(upper.highway)) return ROAD_UNDER_PATH_DECK_M;
  return DECK_ROAD_CLEAR_M;
}

/**
 * Which of two crossing edges goes on top, from their tags: { upper, rule }
 * (upper 'a' | 'b'), or null when nothing says (same layer, same structure:
 * two ground roads crossing that OSM did not join, not a grade separation).
 */
export function crossingOrder(a, b) {
  if (a.layer !== b.layer) return { upper: a.layer > b.layer ? 'a' : 'b', rule: 'layer' };
  if (a.bridge !== b.bridge) return { upper: a.bridge ? 'a' : 'b', rule: 'bridge' };
  if (a.tunnel !== b.tunnel) return { upper: a.tunnel ? 'b' : 'a', rule: 'tunnel' };
  return null;
}

function cross(ax, ay, bx, by, cx, cy, dx, dy) {
  const rx = bx - ax; const ry = by - ay; const sx = dx - cx; const sy = dy - cy;
  const den = rx * sy - ry * sx;
  if (Math.abs(den) < 1e-9) return null;
  const qx = cx - ax; const qy = cy - ay;
  const t = (qx * sy - qy * sx) / den;
  const u = (qx * ry - qy * rx) / den;
  return t > 0 && t <= 1 && u > 0 && u <= 1 ? { t, u } : null;
}

/**
 * Crossings and water runs of a structure graph (graph.js).
 *   waterAt(x, y) -> 0 land, 1 water, 2 ship channel (buildWaterLookup)
 * Returns { crossings, overlaps, unjoined, water, stats } (overlaps: as
 * crossings, decks of different layers alongside with their lanes overlapping):
 *   crossing { a: { edge, i, f, s }, b: { ... }, x, y, upper: 'a'|'b', rule, sep }
 *     (i + f: the station interval and fraction along it)
 *   water { edge, i0, i1, s0, s1, run, channel, need }  (bridge edges only)
 */
export function findCrossings(graph, { waterAt = null } = {}) {
  const { edges, nodes } = graph;
  // intersect OSM vertex-to-vertex segments (far fewer than 4 m stations),
  // then place each hit on the stations
  const verts = edges.map((e) => {
    const v = [];
    for (let i = 0; i < e.vertex.length; i++) if (e.vertex[i]) v.push(i);
    return v;
  });
  const grid = new Map();
  edges.forEach((e, ei) => {
    const v = verts[ei];
    for (let k = 0; k + 1 < v.length; k++) {
      const i0 = v[k]; const i1 = v[k + 1];
      cellsAlong(e.x[i0], e.y[i0], e.x[i1], e.y[i1], CELL_M, (gx, gy) => {
        const key = `${gx},${gy}`;
        let list = grid.get(key);
        if (!list) grid.set(key, (list = []));
        list.push(ei, k);
      });
    }
  });
  // station interval i and fraction f at arc length s along an edge
  const placeOn = (e, s) => {
    let lo = 0; let hi = e.s.length - 1;
    while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (e.s[mid] <= s) lo = mid; else hi = mid; }
    return { i: lo, f: (s - e.s[lo]) / ((e.s[lo + 1] - e.s[lo]) || 1), s };
  };
  const sharedNodes = (a, b) => [a.from, a.to].filter((n) => n === b.from || n === b.to).map((id) => nodes.get(id));
  const seen = new Set();
  const crossings = [];
  let unjoined = 0;
  for (const list of grid.values()) {
    for (let p = 0; p < list.length; p += 2) {
      for (let q = p + 2; q < list.length; q += 2) {
        const ea = list[p]; const eb = list[q];
        if (ea === eb) continue;
        const A = edges[ea]; const B = edges[eb];
        const a0 = verts[ea][list[p + 1]]; const a1 = verts[ea][list[p + 1] + 1];
        const b0 = verts[eb][list[q + 1]]; const b1 = verts[eb][list[q + 1] + 1];
        const hit = cross(A.x[a0], A.y[a0], A.x[a1], A.y[a1], B.x[b0], B.y[b0], B.x[b1], B.y[b1]);
        if (!hit) continue;
        const key = ea < eb ? `${ea}:${a0}:${eb}:${b0}` : `${eb}:${b0}:${ea}:${a0}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const x = A.x[a0] + (A.x[a1] - A.x[a0]) * hit.t; const y = A.y[a0] + (A.y[a1] - A.y[a0]) * hit.t;
        if (sharedNodes(A, B).some((n) => n && Math.hypot(n.x - x, n.y - y) < SHARED_NODE_M)) continue;
        const order = crossingOrder(A, B);
        if (!order) { unjoined++; continue; }
        const [upper, lower] = order.upper === 'a' ? [A, B] : [B, A];
        crossings.push({
          a: { edge: ea, ...placeOn(A, A.s[a0] + (A.s[a1] - A.s[a0]) * hit.t) },
          b: { edge: eb, ...placeOn(B, B.s[b0] + (B.s[b1] - B.s[b0]) * hit.u) },
          x, y, upper: order.upper, rule: order.rule, sep: requiredSeparation(upper, lower),
        });
      }
    }
  }

  const overlaps = [];
  // Decks of different layers side by side whose lanes overlap (a ramp
  // running alongside, partly under, the motorway a layer up) never cross,
  // yet need the same clearance where they overlap: 0.9 m apart, a car on
  // the lower deck drove into the upper one's edge. Not round a junction
  // the two share (a ramp changing layer where it joins).
  {
    const cells = new Map();
    // (decks both: a bridge beside a street on the ground, a canal bridge by
    // the quay, is the composer's step, not a lift)
    const road = (e) => e.bridge && !PATH_CLASSES.has(e.highway);
    edges.forEach((e, k) => {
      if (!road(e)) return;
      for (let i = 0; i < e.s.length; i++) {
        const key = `${Math.floor(e.x[i] / OVERLAP_CELL_M)},${Math.floor(e.y[i] / OVERLAP_CELL_M)}`;
        if (!cells.has(key)) cells.set(key, []);
        cells.get(key).push(k, i);
      }
    });
    const found = [];
    const nearShared = (A, B, x, y) => sharedNodes(A, B).some((n) => n && Math.hypot(n.x - x, n.y - y) < OVERLAP_NODE_M);
    // (running alongside: across each other is a crossing, found above)
    const dir = (e, i) => { const a = Math.max(0, i - 1); const b = Math.min(e.s.length - 1, i + 1); const dx = e.x[b] - e.x[a]; const dy = e.y[b] - e.y[a]; const L = Math.hypot(dx, dy) || 1; return [dx / L, dy / L]; };
    edges.forEach((A, ka) => {
      if (!road(A)) return;
      for (let i = 0; i < A.s.length; i++) {
        const cx = Math.floor(A.x[i] / OVERLAP_CELL_M); const cy = Math.floor(A.y[i] / OVERLAP_CELL_M);
        const best = new Map();
        for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
          const list = cells.get(`${cx + dx},${cy + dy}`) || [];
          for (let j = 0; j < list.length; j += 2) {
            const kb = list[j]; const B = edges[kb];
            // (each pair once, from the upper road's stations)
            if (kb === ka || !(A.layer > B.layer)) continue;
            const ib = list[j + 1];
            const d = Math.hypot(B.x[ib] - A.x[i], B.y[ib] - A.y[i]);
            if (d >= (A.half + B.half) * OVERLAP_SHARE) continue;
            if (!best.has(kb) || d < best.get(kb)[1]) best.set(kb, [ib, d]);
          }
        }
        for (const [kb, [ib]] of best) {
          const B = edges[kb];
          if (nearShared(A, B, A.x[i], A.y[i])) continue;
          const [ax, ay] = dir(A, i); const [bx, by] = dir(B, ib);
          if (Math.abs(ax * bx + ay * by) < OVERLAP_ALIGN) continue;
          found.push({
            a: { edge: ka, ...placeOn(A, A.s[i]) }, b: { edge: kb, ...placeOn(B, B.s[ib]) },
            x: A.x[i], y: A.y[i], upper: 'a', rule: 'overlap', sep: requiredSeparation(A, B),
          });
        }
      }
    });
    // (alongside for a stretch, OVERLAP_RUN_M at least: not two decks
    // brushing past each other)
    const runs = new Map();
    for (const c of found) { const key = `${c.a.edge}:${c.b.edge}`; if (!runs.has(key)) runs.set(key, []); runs.get(key).push(c); }
    for (const list of runs.values()) {
      const ss = list.map((c) => c.a.s);
      if (Math.max(...ss) - Math.min(...ss) >= OVERLAP_RUN_M) overlaps.push(...list);
    }
  }

  // How far each node is from the ground along bridge-tagged edges: a
  // bridge's clearance over water is a wish its own length must reach (at
  // its class grade, down to both ends); it never lifts the streets beyond.
  const bridgeReach = new Map();
  {
    const touch = new Map();   // node -> touches a non-bridge edge or the map's edge
    const deg = new Map();
    for (const e of edges) for (const n of [e.from, e.to]) {
      if (n === undefined) continue;
      deg.set(n, (deg.get(n) || 0) + 1);
      if (!e.bridge) touch.set(n, true);
    }
    const dist = new Map();
    const queue = [];
    for (const [n, d] of deg) if (touch.get(n) || d === 1) { dist.set(n, 0); queue.push(n); }
    const adj = new Map();
    for (const e of edges) {
      if (!e.bridge || e.from === undefined || e.to === undefined) continue;
      (adj.get(e.from) || adj.set(e.from, []).get(e.from)).push([e.to, e.length]);
      (adj.get(e.to) || adj.set(e.to, []).get(e.to)).push([e.from, e.length]);
    }
    // (few nodes: a simple label-correcting pass)
    while (queue.length) {
      const n = queue.shift();
      for (const [m, L] of adj.get(n) || []) {
        const d = dist.get(n) + L;
        if (!(dist.get(m) <= d)) { dist.set(m, d); queue.push(m); }
      }
    }
    for (const [n, d] of dist) bridgeReach.set(n, d);
  }
  // bridges with a movable span: the whole bridge is low (its fixed spans
  // either side of a drawbridge do not hump up over the channel)
  const movableBridge = new Set();
  {
    const parent = new Map();
    const find = (n) => { while (parent.get(n) !== n) { parent.set(n, parent.get(parent.get(n))); n = parent.get(n); } return n; };
    const add = (n) => { if (!parent.has(n)) parent.set(n, n); };
    for (const e of edges) {
      if (!e.bridge || e.from === undefined || e.to === undefined) continue;
      add(e.from); add(e.to); parent.set(find(e.from), find(e.to));
    }
    const lowRoots = new Set();
    for (const e of edges) if (e.bridge && e.movable && parent.has(e.from)) lowRoots.add(find(e.from));
    for (const e of edges) if (e.bridge && parent.has(e.from) && lowRoots.has(find(e.from))) movableBridge.add(e.id);
  }
  const reachOf = (n) => (n === undefined ? 0 : bridgeReach.get(n) ?? 0);

  // twin carriageways of one bridge: an edge alongside a bridge edge that
  // names its structure (suspension, cable-stayed) takes it (OSM often tags
  // one carriageway only: the other stood 40 m lower beside it)
  const structureOf = new Map();
  {
    const TWIN_M = 30;
    const tagged = edges.filter((e) => e.bridge && e.structure);
    const cells = new Map();
    for (const e of tagged) for (let i = 0; i < e.s.length; i++) {
      const k = `${Math.floor(e.x[i] / TWIN_M)},${Math.floor(e.y[i] / TWIN_M)}`;
      if (!cells.has(k)) cells.set(k, []);
      cells.get(k).push(e, i);
    }
    for (const e of edges) {
      if (!e.bridge || e.structure || !tagged.length) continue;
      const votes = new Map(); let near = 0;
      for (let i = 0; i < e.s.length; i++) {
        const cx = Math.floor(e.x[i] / TWIN_M); const cy = Math.floor(e.y[i] / TWIN_M);
        let hit = null;
        for (let dx = -1; dx <= 1 && !hit; dx++) for (let dy = -1; dy <= 1 && !hit; dy++) {
          const list = cells.get(`${cx + dx},${cy + dy}`) || [];
          for (let j = 0; j < list.length; j += 2) if (Math.hypot(list[j].x[list[j + 1]] - e.x[i], list[j].y[list[j + 1]] - e.y[i]) <= TWIN_M) { hit = list[j]; break; }
        }
        if (hit) { near++; votes.set(hit.structure, (votes.get(hit.structure) || 0) + 1); }
      }
      if (near >= 0.5 * e.s.length) structureOf.set(e.id, [...votes].sort((a, b) => b[1] - a[1])[0][0]);
    }
  }

  // bridge edges over water: the wet runs and the clearance each needs
  const water = [];
  if (waterAt) {
    for (const e of edges) {
      if (!e.bridge) continue;
      let i0 = -1; let channel = false;
      for (let i = 0; i <= e.s.length; i++) {
        const w = i < e.s.length ? waterAt(e.x[i], e.y[i]) : 0;
        if (w > 0) { if (i0 < 0) { i0 = i; channel = false; } if (w >= 2) channel = true; continue; }
        if (i0 >= 0) {
          const i1 = i - 1;
          const run = e.s[i1] - e.s[i0];
          // (a ship's clearance over a long wet run only, as the bridge pass:
          // a bridge near a harbour's channel line is not over the channel)
          const nav = navClearance(e.structure || structureOf.get(e.id));
          let need = Math.max(waterClear(run), run >= NAV_RUN_M ? (channel ? NAV_CLEAR_M : nav) : 0);
          if (e.movable || movableBridge.has(e.id)) need = Math.min(waterClear(run), MOVABLE_CLEAR_M);
          // what the bridge can climb to at each station between its ends
          // (the lower side): it rises toward its middle, never beyond
          const wanted = need;
          const needs = [];
          for (let k = i0; k <= i1; k++) {
            const toStart = e.s[k] + reachOf(e.from);
            const toEnd = e.s[e.s.length - 1] - e.s[k] + reachOf(e.to);
            const reach = gradeLimit(e.highway) * Math.min(toStart, toEnd) * REACH_SHARE;
            needs.push(Math.max(Math.min(need, reach), Math.min(need, WATER_CLEAR_FLOOR_M)));
          }
          need = Math.max(...needs);
          water.push({ edge: e.id, i0, i1, s0: e.s[i0], s1: e.s[i1], run, channel, need, needs, wanted });
          i0 = -1;
        }
      }
    }
  }

  const stats = { crossings: crossings.length, byLayer: 0, byBridge: 0, byTunnel: 0, overlaps: overlaps.length, unjoined, waterRuns: water.length, channels: water.filter((w) => w.channel).length };
  for (const c of crossings) {
    if (c.rule === 'layer') stats.byLayer++;
    else if (c.rule === 'bridge') stats.byBridge++;
    else stats.byTunnel++;
  }
  return { crossings, overlaps, unjoined, water, stats };
}
