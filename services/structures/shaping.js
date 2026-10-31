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

// a road meeting a structure at a node is its approach this far out (its
// ramp or cutting, shaped with the structure)
export const APPROACH_M = 200;

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
  const skip = (k, i) => rawDeck.has(k) || !!(fixed[k] && fixed[k][i] && fixed[k][Math.min(i + 1, fixed[k].length - 1)]);
  return { roles, fixed, noCut, rawDeck, skip, stats };
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
export function rawDeckClasses(graph, classes, rawDeck) {
  if (!rawDeck?.size || !classes) return classes;
  const { edges } = graph;
  const z = graph.profile.z;
  const segments = classes.segments.filter((s) => !rawDeck.has(s.edge));
  for (const k of rawDeck) {
    const e = edges[k];
    let runs = [];
    for (let i = 0; i < e.s.length;) {
      const kind = z[k][i] - e.g[i] >= RAW_DECK_MIN_H ? 'deck' : 'ground';
      let j = i;
      while (j + 1 < e.s.length && (z[k][j + 1] - e.g[j + 1] >= RAW_DECK_MIN_H ? 'deck' : 'ground') === kind) j++;
      runs.push({ kind, i0: i, i1: j });
      i = j + 1;
    }
    // short runs into their neighbours (a deck's run wins a tie)
    for (let r = 0; r < runs.length && runs.length > 1; r++) {
      const run = runs[r];
      if (e.s[run.i1] - e.s[run.i0] >= RAW_DECK_MIN_RUN_M) continue;
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
