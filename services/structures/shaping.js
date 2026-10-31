// Structure solver: what the export may do to the terrain, per road station
// (refs/output/bridge-tunnel-plan.md). The user can switch the terrain
// shaping off for ordinary roads, bridges, overpasses and tunnels apart.
//
// A station whose shaping is off is held exactly on its ground (the profile
// solve may not lift or lower it, and no lift spreads through it) and its
// corridor is never composed. A bridge or overpass whose shaping is off keeps
// its freedom above the ground but may not dig below it, and is built as a
// deck wherever it leaves the ground (no embankments, no abutment fill): on
// bare-earth elevation the valley or road under it is real and the
// approaches' embankments are already in the data. Nothing here knows about
// any place.

import { gradeLimit as gradeLimitOf } from './profileSolve.js';

// a road meeting a structure at a node is its approach this far out (its
// ramp or cutting, shaped with the structure)
export const APPROACH_M = 200;
// a plain deck reaches this far out along its approaches for the rims of
// the dip it spans
export const SPAN_SEARCH_M = 150;
const DIP_REACH_M = 15;   // the dip's floor: the lowest ground within this of the bridge
const DIP_MIN_M = 0.5;    // shallower than this under the rims: no dip, the bridge's own ends
const RIM_FLAT_M = 8;     // the ground flatter than the class grade this far: the rim
const RIM_DROP_M = 0.5;   // ... or fallen this far from its best: over the crest

/**
 * Normalised shaping switches: { roads, bridges, overpasses, tunnels } from
 * the export options (each on unless switched off; all off with the master
 * switch `terrain: false`).
 */
export function shapingSwitches({ terrain = true, roads = true, bridges = true, overpasses = true, tunnels = true } = {}) {
  const on = terrain !== false;
  return {
    roads: on && roads !== false,
    bridges: on && bridges !== false,
    overpasses: on && overpasses !== false,
    tunnels: on && tunnels !== false,
  };
}

/** True when every switch is on (the plan then changes nothing). */
export const allShaping = (sw) => sw.roads && sw.bridges && sw.overpasses && sw.tunnels;

/**
 * The structure each edge is: 'tunnel' (a tunnel road, built or not),
 * 'overpass' (a bridge over another road), 'bridge' (over water or ground)
 * or null (an ordinary road).
 */
export function edgeRoles(graph) {
  const { edges } = graph;
  const overRoad = new Uint8Array(edges.length);
  for (const c of graph.crossings?.crossings || []) {
    const up = c[c.upper]; const dn = c[c.upper === 'a' ? 'b' : 'a'];
    if (edges[dn.edge]?.tunnel || edges[dn.edge]?.external) continue;
    overRoad[up.edge] = 1;
  }
  return edges.map((e, k) => {
    if (e.tunnel || e.external) return 'tunnel';
    if (e.bridge) return overRoad[k] ? 'overpass' : 'bridge';
    return null;
  });
}

/**
 * The plan for switches `sw` (shapingSwitches): per edge, the stations held
 * on the ground (`fixed`, Uint8Array or null) and whether it may not dig
 * below its ground (`noCut`), plus `skip(k, i)`: the composer leaves the
 * piece i..i+1 of edge k alone. `rawDeck`: edges built as decks wherever
 * they leave the ground. `stats` for the report.
 */
export function shapingPlan(graph, sw) {
  const { edges } = graph;
  const roles = edgeRoles(graph);
  const shapes = (role) => (role === 'tunnel' ? sw.tunnels : role === 'overpass' ? sw.overpasses : role === 'bridge' ? sw.bridges : sw.roads);
  // structures meeting each node
  const atNode = new Map();
  edges.forEach((e, k) => {
    if (!roles[k]) return;
    for (const id of [e.from, e.to]) {
      if (id === undefined) continue;
      if (!atNode.has(id)) atNode.set(id, new Set());
      atNode.get(id).add(roles[k]);
    }
  });
  const fixed = edges.map(() => null);
  const noCut = edges.map(() => false);
  const rawDeck = new Set();
  const stats = { fixedStations: 0, stations: 0, rawDecks: 0, byRole: { road: 0, bridge: 0, overpass: 0, tunnel: 0 } };
  edges.forEach((e, k) => {
    const n = e.s.length;
    stats.stations += n;
    const role = roles[k];
    if (role === 'bridge' || role === 'overpass') {
      if (!shapes(role)) { noCut[k] = true; rawDeck.add(k); stats.rawDecks++; }
      return;
    }
    if (role === 'tunnel') {
      // a tunnel road nobody built is a road on the ground (its cutting is
      // the tunnel's shaping); a built one is the tunnel builder's
      if (!e.external && !sw.tunnels) { fixed[k] = new Uint8Array(n).fill(1); stats.fixedStations += n; stats.byRole.tunnel += n; }
      return;
    }
    // an ordinary road: its approach stretches belong to the structure they
    // lead to, the rest to the roads
    const startRoles = atNode.get(e.from) || null;
    const endRoles = atNode.get(e.to) || null;
    const L = e.s[n - 1];
    let out = null;
    for (let i = 0; i < n; i++) {
      const near = [];
      if (startRoles && e.s[i] <= APPROACH_M) near.push(...startRoles);
      if (endRoles && L - e.s[i] <= APPROACH_M) near.push(...endRoles);
      // (an approach to several structures is shaped if any of them is)
      const hold = near.length ? !near.some((r) => shapes(r)) : !sw.roads;
      if (!hold) continue;
      if (!out) out = new Uint8Array(n);
      out[i] = 1;
      stats.fixedStations++;
      stats.byRole[near.length ? near[0] : 'road']++;
    }
    fixed[k] = out;
  });
  // each plain deck spans its dip from rim to rim (not only the stretch OSM
  // tags as the bridge): its stations pinned on the straight line between
  // the rims, freed from the ground
  const spans = rawDeck.size ? simpleSpans(graph, rawDeck) : { pins: [], span: edges.map(() => null), list: [] };
  spans.pins.forEach(([k, i]) => {
    if (fixed[k]?.[i]) { fixed[k][i] = 0; stats.fixedStations--; }
  });
  stats.spans = spans.list;
  const inSpan = (k, i) => !!spans.span[k]?.[i];
  const skip = (k, i) => rawDeck.has(k) || inSpan(k, i) || inSpan(k, i + 1)
    || !!(fixed[k] && fixed[k][i] && fixed[k][Math.min(i + 1, fixed[k].length - 1)]);
  return { roles, fixed, noCut, rawDeck, skip, stats, pins: spans.pins, span: spans.span };
}

/**
 * The span of each plain deck: the bridge's roads chained, carried on along
 * the approach most in line at each end (up to SPAN_SEARCH_M), then from the
 * floor of the dip (the lowest ground within DIP_REACH_M of the bridge)
 * climbed out on each side to its rim: where the ground stops rising
 * steeper than the class grade, or passes a crest. The deck runs straight
 * from rim to rim (never under the ground between); a bridge with no dip
 * under it is left to the profile solve. OSM often ends a
 * bridge short of the far wall, or on a slope; the rims are where the road
 * really leaves the ground. Returns { pins: [[k, i, z]], span: per edge
 * Uint8Array | null, list: [{ edges, length, from, to }] }.
 */
export function simpleSpans(graph, rawDeck) {
  const { edges } = graph;
  const pins = []; const span = edges.map(() => null); const list = [];
  const ends = new Map();   // node -> [{ k, end }]
  edges.forEach((e, k) => {
    for (const [id, end] of [[e.from, 0], [e.to, 1]]) {
      if (id === undefined) continue;
      if (!ends.has(id)) ends.set(id, []);
      ends.get(id).push({ k, end });
    }
  });
  // stations of edge k walked away from its end `end` (0: from the start)
  const walk = (k, end) => {
    const n = edges[k].s.length; const out = [];
    for (let j = 0; j < n; j++) out.push([k, end === 0 ? j : n - 1 - j]);
    return out;
  };
  const dirAt = (k, i, j) => { const e = edges[k]; const dx = e.x[j] - e.x[i]; const dy = e.y[j] - e.y[i]; const L = Math.hypot(dx, dy) || 1; return [dx / L, dy / L]; };
  const done = new Set();
  for (const k0 of rawDeck) {
    if (done.has(k0)) continue;
    // the chain of plain-deck edges through k0, in order
    let chain = [{ k: k0, end: 0 }];
    done.add(k0);
    for (const side of [1, 0]) {
      for (;;) {
        const tip = side === 1 ? chain[chain.length - 1] : chain[0];
        const e = edges[tip.k];
        const node = side === 1 ? (tip.end === 0 ? e.to : e.from) : (tip.end === 0 ? e.from : e.to);
        const next = (ends.get(node) || []).find((o) => rawDeck.has(o.k) && !done.has(o.k));
        if (!next) break;
        done.add(next.k);
        // walking away from the node into `next`
        if (side === 1) chain.push({ k: next.k, end: next.end });
        else chain.unshift({ k: next.k, end: next.end === 0 ? 1 : 0 });
      }
    }
    // stations along the chain
    let path = [];
    for (const { k, end } of chain) {
      const st = walk(k, end);
      path.push(...(path.length ? st.slice(1) : st));
    }
    const k0First = path[0]; const kLast = path[path.length - 1];
    // carried on along the approach most in line at each end
    const extend = (at, from, firstStep) => {
      const out = [];
      let [k, i] = at; let [dx, dy] = firstStep; let walked = 0; let guard = 0;
      const seen = new Set(chain.map((c) => c.k));
      while (walked < SPAN_SEARCH_M && guard++ < 20) {
        const e = edges[k];
        const node = i === 0 ? e.from : i === e.s.length - 1 ? e.to : undefined;
        if (node === undefined) break;
        let best = null; let bestDot = 0.5;
        for (const o of ends.get(node) || []) {
          if (seen.has(o.k)) continue;
          const oe = edges[o.k]; if (oe.s.length < 2) continue;
          const a = o.end === 0 ? 0 : oe.s.length - 1; const b = o.end === 0 ? 1 : oe.s.length - 2;
          const [ux, uy] = dirAt(o.k, a, b);
          const dot = ux * dx + uy * dy;
          if (dot > bestDot) { bestDot = dot; best = o; }
        }
        if (!best) break;
        seen.add(best.k);
        const st = walk(best.k, best.end).slice(1);
        for (const [kk, ii] of st) {
          const [pk, pi] = out.length ? out[out.length - 1] : [k, i];
          walked += Math.hypot(edges[kk].x[ii] - edges[pk].x[pi], edges[kk].y[ii] - edges[pk].y[pi]);
          out.push([kk, ii]);
          if (walked >= SPAN_SEARCH_M) break;
        }
        const last = out[out.length - 1];
        const prev = out.length > 1 ? out[out.length - 2] : [k, i];
        [dx, dy] = (() => { const ex = edges[last[0]].x[last[1]] - edges[prev[0]].x[prev[1]]; const ey = edges[last[0]].y[last[1]] - edges[prev[0]].y[prev[1]]; const L = Math.hypot(ex, ey) || 1; return [ex / L, ey / L]; })();
        [k, i] = last;
      }
      return out;
    };
    if (path.length < 2) continue;
    const step = (p, q) => { const ex = edges[q[0]].x[q[1]] - edges[p[0]].x[p[1]]; const ey = edges[q[0]].y[q[1]] - edges[p[0]].y[p[1]]; const L = Math.hypot(ex, ey) || 1; return [ex / L, ey / L]; };
    const before = extend(k0First, null, step(path[1], path[0])).reverse();
    const after = extend(kLast, null, step(path[path.length - 2], path[path.length - 1]));
    const b0 = before.length; const b1 = b0 + path.length - 1;
    path = [...before, ...path, ...after];
    // arc length and ground along the path
    const s = [0]; const g = [];
    path.forEach(([k, i], j) => {
      g.push(Number.isFinite(edges[k].g[i]) ? edges[k].g[i] : 0);
      if (j) s.push(s[j - 1] + Math.hypot(edges[k].x[i] - edges[path[j - 1][0]].x[path[j - 1][1]], edges[k].y[i] - edges[path[j - 1][0]].y[path[j - 1][1]]));
    });
    const lim = Math.max(...chain.map(({ k }) => gradeLimitOf(edges[k].highway)));
    // the floor of the dip
    let m = b0;
    for (let j = 0; j < path.length; j++) {
      if (s[j] < s[b0] - DIP_REACH_M || s[j] > s[b1] + DIP_REACH_M) continue;
      if (g[j] < g[m]) m = j;
    }
    // climbed out to the rim, one way (dir -1 / +1)
    const rim = (dir) => {
      let best = m; let flatFrom = null;
      for (let j = m + dir; j >= 0 && j < path.length; j += dir) {
        if (g[j] < g[best] - RIM_DROP_M) break;                // over the crest
        const rise = (g[j] - g[j - dir]) / Math.max(1e-6, Math.abs(s[j] - s[j - dir]));
        if (g[j] > g[best]) best = j;
        if (rise < lim) { if (flatFrom === null) flatFrom = j; if (Math.abs(s[j] - s[flatFrom]) >= RIM_FLAT_M) break; } else flatFrom = null;
      }
      return best;
    };
    let A = rim(-1); let B = rim(1);
    // no real dip under it (flat ground, an overpass whose embankments the
    // elevation doesn't hold): left to the solve, which ramps it up over
    // what it crosses within its own length
    if (Math.min(g[A], g[B]) - g[m] < DIP_MIN_M) continue;
    A = Math.min(A, b0); B = Math.max(B, b1);
    const zA = g[A]; const zB = g[B]; const L = s[B] - s[A] || 1;
    const pinAt = (k, i, z) => {
      if (span[k]?.[i]) return;
      pins.push([k, i, z]);
      if (!span[k]) span[k] = new Uint8Array(edges[k].s.length);
      span[k][i] = 1;
    };
    for (let j = A; j <= B; j++) {
      const [k, i] = path[j];
      const z = Math.max(zA + (zB - zA) * (s[j] - s[A]) / L, g[j]);
      pinAt(k, i, z);
      // every road end meeting at a junction on the span at the deck's height
      // (one held on its ground there pulled the junction, and the deck, down)
      const e = edges[k];
      const node = i === 0 ? e.from : i === e.s.length - 1 ? e.to : undefined;
      if (node !== undefined) for (const o of ends.get(node) || []) pinAt(o.k, o.end === 0 ? 0 : edges[o.k].s.length - 1, z);
    }
    list.push({ edges: chain.map((c) => c.k), length: Math.round(L), from: [edges[path[A][0]].x[path[A][1]], edges[path[A][0]].y[path[A][1]], zA], to: [edges[path[B][0]].x[path[B][1]], edges[path[B][0]].y[path[B][1]], zB], osmLength: Math.round(s[b1] - s[b0]) });
  }
  return { pins, span, list };
}

// a bridge built as a deck wherever it is this far over its ground
export const RAW_DECK_MIN_H = 0.1;
const RAW_DECK_MIN_RUN_M = 4;

/**
 * Rebuild the class segments of the raw-deck edges (shapingPlan.rawDeck):
 * 'deck' wherever the solved road is RAW_DECK_MIN_H over its ground, else
 * 'ground'; runs shorter than RAW_DECK_MIN_RUN_M join their neighbours.
 * Returns the classes with recounted stats.
 */
export function rawDeckClasses(graph, classes, rawDeck, span = null) {
  if (!rawDeck?.size || !classes) return classes;
  const { edges } = graph;
  const z = graph.profile.z;
  // the plain decks' edges and the approaches their spans reach onto
  const touched = new Set(rawDeck);
  (span || []).forEach((sp, k) => { if (sp) touched.add(k); });
  const was = new Map();
  for (const seg of classes.segments) {
    if (!touched.has(seg.edge)) continue;
    if (!was.has(seg.edge)) was.set(seg.edge, new Array(edges[seg.edge].s.length).fill('ground'));
    for (let i = seg.i0; i <= seg.i1; i++) was.get(seg.edge)[i] = seg.kind;
  }
  const segments = classes.segments.filter((s) => !touched.has(s.edge));
  for (const k of touched) {
    const e = edges[k];
    // a deck wherever a plain deck's stretch is over the ground; elsewhere on
    // an approach what it was
    const deckHere = (i) => rawDeck.has(k) || !!span?.[k]?.[i];
    const over = (i) => i >= 0 && i < e.s.length && deckHere(i) && z[k][i] - e.g[i] >= RAW_DECK_MIN_H;
    const kindAt = (i) => {
      // (and the first station on the ground at each end: the deck sets down
      // there, no lip a station short of the rim)
      if (over(i) || (deckHere(i) && (over(i - 1) || over(i + 1)))) return 'deck';
      return rawDeck.has(k) ? 'ground' : (was.get(k)?.[i] ?? 'ground');
    };
    let runs = [];
    for (let i = 0; i < e.s.length;) {
      const kind = kindAt(i);
      let j = i;
      while (j + 1 < e.s.length && kindAt(j + 1) === kind) j++;
      runs.push({ kind, i0: i, i1: j });
      i = j + 1;
    }
    // short runs into their neighbours (a deck's run wins a tie)
    for (let r = 0; r < runs.length && runs.length > 1; r++) {
      const run = runs[r];
      if (e.s[run.i1] - e.s[run.i0] >= RAW_DECK_MIN_RUN_M || run.kind !== 'deck' && run.kind !== 'ground') continue;
      const into = runs[r - 1] && runs[r + 1] ? (runs[r - 1].kind === 'deck' ? runs[r - 1] : runs[r + 1]) : (runs[r - 1] || runs[r + 1]);
      run.kind = into.kind;
    }
    const joined = [];
    for (const run of runs) {
      const last = joined[joined.length - 1];
      if (last && last.kind === run.kind) last.i1 = run.i1; else joined.push({ ...run });
    }
    runs = joined;
    for (const run of runs) segments.push({ edge: k, i0: run.i0, i1: run.i1, s0: e.s[run.i0], s1: e.s[run.i1], kind: run.kind, raw: true });
  }
  const stats = { ...classes.stats, byKind: {}, lengthByKind: {} };
  for (const seg of segments) {
    stats.byKind[seg.kind] = (stats.byKind[seg.kind] || 0) + 1;
    stats.lengthByKind[seg.kind] = (stats.lengthByKind[seg.kind] || 0) + Math.round(seg.s1 - seg.s0);
  }
  return { ...classes, segments, stats };
}
