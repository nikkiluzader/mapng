// Structure solver, stage D: what each stretch of road becomes
// (refs/output/bridge-tunnel-plan.md).
//
// From the solved profile (height over or under the untouched ground), what
// a stretch passes over, and its OSM tags (priors, not commands), a rule
// table picks a kind per station; runs shorter than their kind's minimum
// merge into a neighbour. The table is data: change a rule here, not in code
// paths. Nothing here knows about any place.

const ROOF_M = 6;            // road surface to the outside of a cut-and-cover roof (5 m headroom + slab)
const OVER_ROAD_MARGIN_M = 3; // a deck reaches this far past a crossed road's edge

/**
 * The rules, first match wins. Conditions (all must hold):
 *   tag: 'bridge' | 'tunnel' (the OSM tag on the edge)
 *   overWater / overRoad: true
 *   hMin / hMax: height of the road over the untouched ground (m)
 *   coverMin / coverMax: ground over a tunnel's roof (m)
 */
export const STRUCTURE_RULES = [
  { kind: 'deck', overWater: true },
  { kind: 'deck', overRoad: true },
  { kind: 'deck', hMin: 8 },
  { kind: 'deck', tag: 'bridge', hMin: 1.5 },
  { kind: 'embankment', hMin: 0.5 },
  { kind: 'boredTunnel', tag: 'tunnel', coverMin: 8 },
  { kind: 'cutAndCover', tag: 'tunnel', coverMin: 0 },
  { kind: 'cutting', tag: 'tunnel' },
  { kind: 'cutting', hMax: -0.5 },
  { kind: 'ground' },
];

// Shortest run of each kind; a shorter one merges into a neighbour.
export const MIN_RUN_M = { deck: 10, embankment: 8, boredTunnel: 40, cutAndCover: 10, cutting: 8, ground: 6 };
// Which neighbour a short run joins: the higher ranked one.
const RANK = { deck: 6, boredTunnel: 5, cutAndCover: 4, embankment: 3, cutting: 2, ground: 1 };

function matches(rule, st) {
  if (rule.tag && !st.tags[rule.tag]) return false;
  if (rule.overWater && !st.overWater) return false;
  if (rule.overRoad && !st.overRoad) return false;
  if (rule.hMin !== undefined && !(st.h >= rule.hMin)) return false;
  if (rule.hMax !== undefined && !(st.h <= rule.hMax)) return false;
  if (rule.coverMin !== undefined && !(st.cover >= rule.coverMin)) return false;
  if (rule.coverMax !== undefined && !(st.cover <= rule.coverMax)) return false;
  return true;
}

/**
 * Classify every edge of a solved graph (graph.profile.z from
 * profileSolve.js). Returns { segments, stats }:
 *   segment { edge, i0, i1, s0, s1, kind, culvert? }
 * Tags overridden are counted: bridge-tagged stretches that come out as no
 * deck (culverts), tunnel-tagged ones that come out open.
 */
export function classifyStructures(graph, { rules = STRUCTURE_RULES } = {}) {
  const { edges } = graph;
  const z = graph.profile?.z;
  if (!z) return { segments: [], stats: {} };
  // stations over a road: around every crossing this edge is the upper of
  const overRoad = edges.map((e) => new Uint8Array(e.s.length));
  for (const c of graph.crossings?.crossings || []) {
    const up = c[c.upper]; const dn = c[c.upper === 'a' ? 'b' : 'a'];
    const e = edges[up.edge];
    const reach = (edges[dn.edge].half || 4) + OVER_ROAD_MARGIN_M;
    for (let i = 0; i < e.s.length; i++) if (Math.abs(e.s[i] - up.s) <= reach) overRoad[up.edge][i] = 1;
  }
  const overWater = edges.map((e) => new Uint8Array(e.s.length));
  for (const run of graph.crossings?.water || []) for (let i = run.i0; i <= run.i1; i++) overWater[run.edge][i] = 1;

  // stations where a fill could not stand: a lifted road whose embankment
  // (its half width + a 1:2 slope down to the ground) would spill onto
  // another road lower down nearby, not one it meets at a node. Carried on
  // as a deck there (today's walled ramps), so the road below keeps its edge.
  const CELL = 16;
  const grid = new Map();
  edges.forEach((e, k) => {
    for (let i = 0; i < e.s.length; i++) {
      const key = `${Math.floor(e.x[i] / CELL)},${Math.floor(e.y[i] / CELL)}`;
      if (!grid.has(key)) grid.set(key, []);
      grid.get(key).push(k, i);
    }
  });
  const crowded = edges.map((e, k) => {
    const out = new Uint8Array(e.s.length);
    for (let i = 0; i < e.s.length; i++) {
      const h = z[k][i] - e.g[i];
      if (!(h >= 0.5)) continue;
      const reach = e.half + 1 + 2 * h;
      const cx = Math.floor(e.x[i] / CELL); const cy = Math.floor(e.y[i] / CELL); const cr = Math.ceil(reach / CELL);
      search: for (let gx = cx - cr; gx <= cx + cr; gx++) {
        for (let gy = cy - cr; gy <= cy + cr; gy++) {
          const list = grid.get(`${gx},${gy}`);
          if (!list) continue;
          for (let j = 0; j < list.length; j += 2) {
            const k2 = list[j]; const i2 = list[j + 1];
            if (k2 === k) continue;
            const o = edges[k2];
            if (o.from === e.from || o.from === e.to || o.to === e.from || o.to === e.to) continue;   // meets it
            if (z[k][i] - z[k2][i2] < 1.5) continue;
            const d = Math.hypot(o.x[i2] - e.x[i], o.y[i2] - e.y[i]) - o.half;
            if (d < reach) { out[i] = 1; break search; }
          }
        }
      }
    }
    return out;
  });

  const segments = [];
  const stats = { byKind: {}, lengthByKind: {}, culverts: 0, openTunnels: 0, untaggedDecks: 0, carried: 0 };
  edges.forEach((e, k) => {
    const tags = { bridge: e.bridge, tunnel: e.tunnel };
    const kinds = new Array(e.s.length);
    for (let i = 0; i < e.s.length; i++) {
      const h = z[k][i] - e.g[i];
      const st = { tags, h, cover: -h - ROOF_M, overRoad: !!overRoad[k][i], overWater: !!overWater[k][i] };
      kinds[i] = (rules.find((r) => matches(r, st)) || { kind: 'ground' }).kind;
      if (kinds[i] === 'embankment' && crowded[k][i]) { kinds[i] = 'deck'; stats.carried++; }
    }
    // runs, then merge the short ones into their higher-ranked neighbour
    let runs = [];
    for (let i = 0; i < kinds.length;) {
      let j = i; while (j + 1 < kinds.length && kinds[j + 1] === kinds[i]) j++;
      runs.push({ kind: kinds[i], i0: i, i1: j });
      i = j + 1;
    }
    const len = (r) => e.s[r.i1] - e.s[r.i0];
    for (let pass = 0; pass < 4 && runs.length > 1; pass++) {
      let changed = false;
      for (let r = 0; r < runs.length; r++) {
        const run = runs[r];
        if (len(run) >= (MIN_RUN_M[run.kind] ?? 0) || runs.length === 1) continue;
        const prev = runs[r - 1]; const next = runs[r + 1];
        const into = !prev ? next : !next ? prev : (RANK[prev.kind] >= RANK[next.kind] ? prev : next);
        run.kind = into.kind;
        changed = true;
      }
      // join neighbours of one kind
      const joined = [];
      for (const run of runs) {
        const last = joined[joined.length - 1];
        if (last && last.kind === run.kind) last.i1 = run.i1; else joined.push({ ...run });
      }
      runs = joined;
      if (!changed) break;
    }
    for (const run of runs) {
      const seg = { edge: k, i0: run.i0, i1: run.i1, s0: e.s[run.i0], s1: e.s[run.i1], kind: run.kind };
      segments.push(seg);
      stats.byKind[run.kind] = (stats.byKind[run.kind] || 0) + 1;
      stats.lengthByKind[run.kind] = (stats.lengthByKind[run.kind] || 0) + (seg.s1 - seg.s0);
      if (run.kind === 'deck' && !e.bridge) stats.untaggedDecks++;
    }
    if (e.bridge && !runs.some((r) => r.kind === 'deck')) {
      stats.culverts++;
      for (const seg of segments) if (seg.edge === k) seg.culvert = true;
    }
    if (e.tunnel && !runs.some((r) => r.kind === 'boredTunnel' || r.kind === 'cutAndCover')) stats.openTunnels++;
  });
  for (const k of Object.keys(stats.lengthByKind)) stats.lengthByKind[k] = Math.round(stats.lengthByKind[k]);
  return { segments, stats };
}
