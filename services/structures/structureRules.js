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
const OPEN_UNDER_M = 3.5;     // a road this far over a tunnel road left open gets a deck over it
const OPEN_UNDER_MARGIN_M = 2.5; // ... reaching this much further past its edge than over another road
const DECK_MIN_H = 1.5;       // lowest a deck stands over the ground (its structure under it)

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
export const MIN_RUN_M = { external: 0, dam: 0, deck: 10, embankment: 8, boredTunnel: 40, cutAndCover: 10, cutting: 8, ground: 6 };
// Which neighbour a short run joins: the higher ranked one.
const RANK = { external: 9, dam: 8, deck: 6, boredTunnel: 5, cutAndCover: 4, embankment: 3, cutting: 2, ground: 1 };

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
  // (and along a road it is stacked over, graph.crossings.overlaps, where
  // it was lifted over it: held on its ground, Untouched, it stays a road)
  const zAt = (side) => { const zz = z[side.edge]; return zz[side.i] + (zz[Math.min(side.i + 1, zz.length - 1)] - zz[side.i]) * (side.f || 0); };
  for (const c of [...(graph.crossings?.crossings || []), ...(graph.crossings?.overlaps || [])]) {
    const up = c[c.upper]; const dn = c[c.upper === 'a' ? 'b' : 'a'];
    // (over a tunnel the road stands on the ground or its roof: no deck)
    if (edges[dn.edge].external) continue;
    if (edges[dn.edge].tunnel) {
      // ... but a tunnel road with too little ground over it for a roof comes out an open cutting (the rules
      // below): a road far enough over that is a bridge over it, as over any road. Without a deck one of
      // the two was cut through the other: a short underpass 4.3 m under a main road dug a trench across it.
      const g = edges[dn.edge].g; const open = g && g[dn.i] - (zAt(dn) + ROOF_M) < 0;
      if (!open || zAt(up) - zAt(dn) < OPEN_UNDER_M) continue;
    }
    if (c.rule === 'overlap' && zAt(up) - zAt(dn) < DECK_MIN_H) continue;
    const e = edges[up.edge];
    // (over an open tunnel road a little further: its cutting's sides, and a deck long enough to stay one)
    let reach = (edges[dn.edge].half || 4) + OVER_ROAD_MARGIN_M;
    if (edges[dn.edge].tunnel) {
      // (and as far along this road as the cutting runs under it where the two cross at a slant: at 30
      // degrees a 5.6 m road is under the other for twice its width, and a hump of the upper road's ground
      // was left standing in the underpass beyond a deck measured square)
      const d = edges[dn.edge]; const dir = (q, i) => { const a = Math.max(0, i - 1); const b = Math.min(q.s.length - 1, i + 1); const L = Math.hypot(q.x[b] - q.x[a], q.y[b] - q.y[a]) || 1; return [(q.x[b] - q.x[a]) / L, (q.y[b] - q.y[a]) / L]; };
      const u = dir(e, up.i); const v = dir(d, dn.i);
      const sin = Math.abs(u[0] * v[1] - u[1] * v[0]);
      reach = (reach + OPEN_UNDER_MARGIN_M + (e.half || 4) * Math.sqrt(Math.max(0, 1 - sin * sin))) / Math.max(0.35, sin);
    }
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
  // (untaggedBy: why each untagged deck run is one, by its strongest reason: over water, over a
  // road, a fill that would reach a road below, or only its height over plain ground)
  const stats = { byKind: {}, lengthByKind: {}, culverts: 0, openTunnels: 0, untaggedDecks: 0, carried: 0, untaggedBy: { water: 0, road: 0, carried: 0, height: 0 }, untaggedLengthBy: { water: 0, road: 0, carried: 0, height: 0 } };
  edges.forEach((e, k) => {
    const tags = { bridge: e.bridge, tunnel: e.tunnel };
    const kinds = new Array(e.s.length);
    const why = new Uint8Array(e.s.length);   // 3 water, 2 road, 1 carried, 0 height / tag
    for (let i = 0; i < e.s.length; i++) {
      const h = z[k][i] - e.g[i];
      const st = { tags, h, cover: -h - ROOF_M, overRoad: !!overRoad[k][i], overWater: !!overWater[k][i] };
      kinds[i] = (rules.find((r) => matches(r, st)) || { kind: 'ground' }).kind;
      why[i] = st.overWater ? 3 : st.overRoad ? 2 : 0;
      if (kinds[i] === 'embankment' && crowded[k][i] && h >= DECK_MIN_H) { kinds[i] = 'deck'; stats.carried++; why[i] = 1; }
      // a deck has its underside below the ground lower than this (a ramp's
      // first metres off a junction): fill there, unless over a road or water
      if (kinds[i] === 'deck' && h < DECK_MIN_H && !st.overRoad && !st.overWater) kinds[i] = h >= 0.5 ? 'embankment' : 'ground';
      if (e.external) kinds[i] = 'external';   // placed by another builder (today's tunnels)
      else if (e.damAt?.[i]) kinds[i] = 'dam';   // on a dam's crest (services/dams.js): the dam is its structure
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
      if (run.kind === 'deck' && !e.bridge) {
        stats.untaggedDecks++;
        let top = 0;
        for (let i = run.i0; i <= run.i1; i++) if (kinds[i] === 'deck' && why[i] > top) top = why[i];
        const key = ['height', 'carried', 'road', 'water'][top];
        stats.untaggedBy[key]++; stats.untaggedLengthBy[key] += seg.s1 - seg.s0;
      }
    }
    if (e.bridge && !runs.some((r) => r.kind === 'deck')) {
      stats.culverts++;
      for (const seg of segments) if (seg.edge === k) seg.culvert = true;
    }
    if (e.tunnel && !runs.some((r) => r.kind === 'boredTunnel' || r.kind === 'cutAndCover')) stats.openTunnels++;
  });
  for (const k of Object.keys(stats.lengthByKind)) stats.lengthByKind[k] = Math.round(stats.lengthByKind[k]);
  for (const k of Object.keys(stats.untaggedLengthBy)) stats.untaggedLengthBy[k] = Math.round(stats.untaggedLengthBy[k]);
  return { segments, stats };
}
