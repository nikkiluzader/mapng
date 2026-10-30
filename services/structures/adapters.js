// Structure solver, stage G: the solver's results in the shapes the level
// builders already take (refs/output/bridge-tunnel-plan.md).
//
//   decksFromSolver: deck stretches -> bridge decks ({ parts: [{ xy, z, half,
//     layer, structure, osm }] }) for buildDeckGeometry / generateBridgeDAEs
//   applySolvedHeights: every road decal's node heights from the solved
//     profile; decals over a deck project onto objects
// Nothing here knows about any place.

/**
 * Bridge decks from the classified graph: every deck stretch is a part;
 * parts meeting at a node (deck end to deck end) form one deck.
 */
export function decksFromSolver(graph) {
  const { edges } = graph;
  const z = graph.profile?.z;
  const segs = (graph.classes?.segments || []).filter((s) => s.kind === 'deck' && s.i1 > s.i0);
  if (!z || !segs.length) return [];
  // union-find over deck stretches joined at nodes
  const parent = segs.map((_, i) => i);
  const find = (i) => { while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; } return i; };
  const atNode = new Map();
  segs.forEach((s, idx) => {
    const e = edges[s.edge];
    if (s.i0 === 0 && e.from !== undefined) (atNode.get(e.from) || atNode.set(e.from, []).get(e.from)).push(idx);
    if (s.i1 === e.s.length - 1 && e.to !== undefined) (atNode.get(e.to) || atNode.set(e.to, []).get(e.to)).push(idx);
  });
  for (const list of atNode.values()) for (let i = 1; i < list.length; i++) parent[find(list[i])] = find(list[0]);
  const decks = new Map();
  segs.forEach((s, idx) => {
    const e = edges[s.edge];
    const xy = []; const zz = [];
    for (let i = s.i0; i <= s.i1; i++) { xy.push([e.x[i], e.y[i]]); zz.push(z[s.edge][i]); }
    const part = {
      xy, z: zz, half: e.half, layer: Math.max(1, e.layer || 0), structure: e.structure || undefined,
      osm: { id: e.wayId ?? null, name: null, highway: e.highway || null },
      edge: s.edge, s0: s.s0, s1: s.s1,
    };
    const root = find(idx);
    if (!decks.has(root)) decks.set(root, { parts: [] });
    decks.get(root).parts.push(part);
  });
  const out = [...decks.values()];
  let index = 0;
  for (const deck of out) for (const part of deck.parts) part.index = index++;
  return out;
}

/**
 * The roads a deck's piers must keep off: every stretch of the solved graph
 * that is not a deck, as [[x, y, z]...] lines carrying their half width.
 */
export function roadLinesFromSolver(graph) {
  const { edges } = graph;
  const z = graph.profile?.z;
  if (!z) return [];
  const kindOf = edges.map((e) => new Array(e.s.length).fill('ground'));
  for (const seg of graph.classes?.segments || []) for (let i = seg.i0; i <= seg.i1; i++) kindOf[seg.edge][i] = seg.kind;
  const lines = [];
  edges.forEach((e, k) => {
    let line = null;
    for (let i = 0; i < e.s.length; i++) {
      if (kindOf[k][i] === 'deck') { line = null; continue; }
      if (!line) { line = []; line.half = e.half; lines.push(line); }
      line.push([e.x[i], e.y[i], z[k][i]]);
    }
  });
  return lines.filter((l) => l.length >= 2);
}

/**
 * Set every road decal's node heights from the solved profile: each node to
 * the nearest station of its road's graph edges. A decal with any node on a
 * deck stretch projects onto objects (the deck). Decals carry their road
 * as the non-serialized __owner (the drivable segment index); skipOwners:
 * owners another builder places (today's tunnels until stage G covers them).
 * Returns { decals, nodes } changed.
 */
export function applySolvedHeights(groups, graph, { deckLift = 0.02, skipOwners = null } = {}) {
  const { edges } = graph;
  const z = graph.profile?.z;
  if (!z) return { decals: 0, nodes: 0 };
  const kindOf = edges.map((e) => new Array(e.s.length).fill('ground'));
  for (const seg of graph.classes?.segments || []) for (let i = seg.i0; i <= seg.i1; i++) kindOf[seg.edge][i] = seg.kind;
  const bySeg = new Map();
  edges.forEach((e, k) => { if (!bySeg.has(e.seg)) bySeg.set(e.seg, []); bySeg.get(e.seg).push(k); });
  let decals = 0; let nodes = 0;
  for (const g of groups || []) {
    for (const d of g.__items || []) {
      if (d.__owner === undefined || !Array.isArray(d.nodes)) continue;
      // (roads another builder owns, today's tunnels, keep their heights)
      if (skipOwners?.has(d.__owner)) continue;
      const pieces = bySeg.get(d.__owner);
      if (!pieces) continue;
      let onDeck = false;
      // nodes run along the stations: search near the last match first
      let lastK = -1; let lastI = 0;
      const scan = (k, from, to, acc, node) => {
        const e = edges[k];
        for (let i = Math.max(0, from); i <= Math.min(e.s.length - 1, to); i++) {
          const dd = (e.x[i] - node[0]) ** 2 + (e.y[i] - node[1]) ** 2;
          if (dd < acc.best) { acc.best = dd; acc.k = k; acc.i = i; }
        }
      };
      for (const node of d.nodes) {
        const acc = { best: Infinity, k: -1, i: 0 };
        if (lastK >= 0) {
          // track along the road: widen the window only while the best match
          // sits on its edge (layers offset sideways never match closely, so
          // a distance test would rescan the whole road at every node)
          let w = 8;
          for (;;) {
            acc.best = Infinity; scan(lastK, lastI - w, lastI + w, acc, node);
            const n = edges[lastK].s.length;
            const atEdge = (acc.i === Math.max(0, lastI - w) && acc.i > 0) || (acc.i === Math.min(n - 1, lastI + w) && acc.i < n - 1);
            if (!atEdge || w > n) break;
            w *= 2;
          }
          // the end of this piece: the next piece may be nearer
          const n = edges[lastK].s.length;
          if (pieces.length > 1 && (acc.i === 0 || acc.i === n - 1)) for (const k of pieces) if (k !== lastK) scan(k, 0, edges[k].s.length - 1, acc, node);
        } else {
          for (const k of pieces) scan(k, 0, edges[k].s.length - 1, acc, node);
        }
        if (acc.best === Infinity) continue;
        lastK = acc.k; lastI = acc.i;
        // interpolate along the station line (snapping 2 m nodes to 4 m
        // stations made stair steps that measured steeper than the profile)
        const e = edges[acc.k]; const zk = z[acc.k];
        let bz = zk[acc.i]; let bk = kindOf[acc.k][acc.i]; let bestD = Infinity;
        for (const j of [acc.i - 1, acc.i]) {
          if (j < 0 || j + 1 >= e.s.length) continue;
          const vx = e.x[j + 1] - e.x[j]; const vy = e.y[j + 1] - e.y[j]; const L2 = vx * vx + vy * vy || 1e-9;
          const t = Math.max(0, Math.min(1, ((node[0] - e.x[j]) * vx + (node[1] - e.y[j]) * vy) / L2));
          const dd = (e.x[j] + vx * t - node[0]) ** 2 + (e.y[j] + vy * t - node[1]) ** 2;
          if (dd < bestD) { bestD = dd; bz = zk[j] + (zk[j + 1] - zk[j]) * t; bk = t < 0.5 ? kindOf[acc.k][j] : kindOf[acc.k][j + 1]; }
        }
        node[2] = Math.round((bz + (bk === 'deck' ? deckLift : 0)) * 1000) / 1000;
        if (bk === 'deck') onDeck = true;
        nodes++;
      }
      if (onDeck) d.overObjects = true;
      decals++;
    }
  }
  return { decals, nodes };
}
