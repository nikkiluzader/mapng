// Structure solver: where a side road meets a through road.
//
// Every road's height is solved along its own line, and roads that meet share a height at the point where they
// meet. But a road is as wide as it is: the first metres of a side road lie inside the through road's width,
// and there the pavement is the through road's. Solved on its own line, a side road that climbs or falls away
// from the junction is already centimetres to most of a metre off the through road's surface before it has
// left it (measured in game with a deck under each road: ledges of 0.15 to 0.45 m across the side road's mouth
// at hill junctions, 0.84 m where a road rising to a bridge met a ground-level one).
//
// After a first solve the side road's stations inside the through road's width are pinned to the through
// road's height beside them (level across it, as a road is), and the roads are solved once more: the side
// road's own grade starts at the through road's edge. Ground roads only: decks and tunnels have their own care.

const THROUGH_COS = Math.cos((35 * Math.PI) / 180);   // two roads within 35 degrees of straight on: one road through
const MERGE_COS = Math.cos((30 * Math.PI) / 180);     // a road within 30 degrees of the through road's line is merging, not crossing
const MOUTH_MARGIN_M = 0.5;                            // beyond the through road's half width
const MOUTH_REACH_M = 25;                              // how far along a side road its mouth is looked for
// The landing beyond the through road's edge (road design practice: the minor road meets the major road's
// surface and takes up its own grade over a vertical curve, not at a corner; a design manual gives 3 % as the
// grade break to aim for and 8 % as the most on a minor approach. A hill street has more than that to turn
// through, so the turn is spread: CURVE_RATE of grade a metre).
const CURVE_RATE = 0.015;                              // grade taken up per metre of the landing's curve
const CURVE_MIN_M = 3; const CURVE_MAX_M = 12;
const REJOIN_M = 30;                                   // the side road is back on its own first line this far out
const THROUGH_HOLD_M = 12;                             // the through road is held as first solved this far from the junction
const REJOIN_MIN_M = 8;                                // a side road shorter than this beyond the edge: no curve

const outward = (e, end) => {   // the unit direction leaving the node at `end` of e
  const n = e.x.length; const a = end === 0 ? 0 : n - 1; const b = end === 0 ? Math.min(n - 1, 2) : Math.max(0, n - 3);
  const dx = e.x[b] - e.x[a]; const dy = e.y[b] - e.y[a]; const L = Math.hypot(dx, dy) || 1;
  return [dx / L, dy / L];
};
const plain = (e) => e && !e.bridge && !e.tunnel && !e.rail && !e.external && e.s?.length >= 2;

/**
 * Pins [[edge, station, height]] for the side roads' mouths, from a first solve's heights z (z[k][i]).
 * Returns { pins, mouths }: mouths, the count of side-road ends pinned.
 */
export function junctionMouthPins(graph, z, { limitOf = null } = {}) {
  const { edges, nodes } = graph; const pins = []; let mouths = 0; let eased = 0; let noRoom = 0;
  for (const node of nodes.values()) {
    const at = (node.edges || []).filter(({ edge }) => plain(edges[edge]) && z[edge]);
    if (at.length < 3 || at.length !== (node.edges || []).length) continue;   // (a structure or a railway at the node: left alone)
    // the through road: the pair leaving in most nearly opposite directions; the wider pair where two are as straight
    let pair = null; let best = -Infinity;
    for (let i = 0; i < at.length; i++) for (let j = i + 1; j < at.length; j++) {
      const u = outward(edges[at[i].edge], at[i].end); const v = outward(edges[at[j].edge], at[j].end);
      const straight = -(u[0] * v[0] + u[1] * v[1]);
      if (straight < THROUGH_COS) continue;
      const score = straight + 0.02 * ((edges[at[i].edge].half || 3) + (edges[at[j].edge].half || 3));
      if (score > best) { best = score; pair = [at[i], at[j]]; }
    }
    if (!pair) continue;
    // the through road's line near the node, with its heights: out along one piece, back along the other
    const line = [];
    for (const [idx, { edge, end }] of pair.entries()) {
      const e = edges[edge]; const n = e.s.length; const pts = [];
      for (let i = 0; i < n; i++) { const k = end === 0 ? i : n - 1 - i; const d = end === 0 ? e.s[k] : e.length - e.s[k]; if (d > MOUTH_REACH_M + 10) break; pts.push([e.x[k], e.y[k], z[edge][k], e.half || 3]); }
      if (idx === 0) line.push(...pts.reverse()); else line.push(...pts.slice(1));
    }
    if (line.length < 2) continue;
    const through = new Set(pair.map((p) => p.edge));
    const along = outward(edges[pair[0].edge], pair[0].end);
    const before = pins.length; const mouthsBefore = mouths;
    for (const { edge, end } of at) {
      if (through.has(edge)) continue;
      // (a road that joins at a shallow angle, a slip road merging, runs inside the through road's width for
      // tens of metres and is no side road: a frontage road was pinned 0.6 m up to a ramp merging into it,
      // a hump with a 25 % slope, plain in its long section)
      const out = outward(edges[edge], end);
      if (Math.abs(out[0] * along[0] + out[1] * along[1]) > MERGE_COS) continue;
      const e = edges[edge]; const n = e.s.length; let any = false;
      const first = pins.length; let edgeAt = -1; let edgeZ = NaN; let edgeI = -1;
      for (let i = 0; i < n; i++) {
        const fromNode = end === 0 ? e.s[i] : e.length - e.s[i];
        if (fromNode > MOUTH_REACH_M) continue;
        // the nearest point of the through road's line, and its height and half width there
        let bd = Infinity; let bz = NaN; let bh = 0;
        for (let q = 1; q < line.length; q++) {
          const a = line[q - 1]; const b = line[q]; const dx = b[0] - a[0]; const dy = b[1] - a[1];
          const t = Math.max(0, Math.min(1, ((e.x[i] - a[0]) * dx + (e.y[i] - a[1]) * dy) / (dx * dx + dy * dy || 1)));
          const d = Math.hypot(e.x[i] - (a[0] + dx * t), e.y[i] - (a[1] + dy * t));
          if (d < bd) { bd = d; bz = a[2] + (b[2] - a[2]) * t; bh = a[3] + (b[3] - a[3]) * t; }
        }
        if (bd <= bh + MOUTH_MARGIN_M && Number.isFinite(bz)) { pins.push([edge, i, bz]); any = true; if (fromNode > edgeAt) { edgeAt = fromNode; edgeZ = bz; edgeI = i; } }
      }
      if (any) mouths++;
      // The landing. From the through road's edge the side road is level with it (a road is level across) and
      // turns to its own grade over a curve; its own grade is the one that brings it back to its first line
      // REJOIN_M out. Left as a corner at the edge, a hill grid had a sharp break either side of every
      // crossing (a sweep's bumps 12 to 35 on one).
      if (any && limitOf && edgeI >= 0) {
        const fromNodeOf = (i) => (end === 0 ? e.s[i] : e.length - e.s[i]);
        const room = e.length - edgeAt; const limit = limitOf(e.highway);
        // (first with the rejoin REJOIN_M out; over the limit, with all the length the road has)
        let done = false;
        for (const Lr of [Math.min(REJOIN_M, room - 2), room - 2]) {
          if (done || Lr < REJOIN_MIN_M) continue;
          let ir = edgeI; for (let i = 0; i < n; i++) if (Math.abs(fromNodeOf(i) - (edgeAt + Lr)) < Math.abs(fromNodeOf(ir) - (edgeAt + Lr))) ir = i;
          const span = fromNodeOf(ir) - edgeAt; const zR = z[edge][ir];
          const Lc = Math.max(CURVE_MIN_M, Math.min(CURVE_MAX_M, span * 0.6, Math.abs((zR - edgeZ) / span) / CURVE_RATE));
          const g1 = (zR - edgeZ) / (span - Lc / 2);
          if (Math.abs(g1) > limit) continue;
          for (let i = 0; i < n; i++) {
            const d = fromNodeOf(i) - edgeAt;
            if (d > 1e-6 && d <= Lc) pins.push([edge, i, edgeZ + (g1 * d * d) / (2 * Lc)]);
          }
          eased++; done = true;
        }
        // (no room at all: the road is at its limit all the way, a ramp climbing to a road on a bridge
        // approach. Its mouth is left as the first solve had it)
        if (!done && room - 2 >= REJOIN_MIN_M) { pins.length = first; mouths--; noRoom++; }
      }
    }
    // The through road keeps the heights the side roads were set against: its stations by the junction are
    // pinned where the first solve had them. Left free, it moved in the second solve while the side roads'
    // ends (and with them the junction's own point) stayed: on a hilltop crossing the through road came out
    // 0.8 m higher 6 m either side of a junction held at its first height, a dip across the crossing.
    if (mouths > mouthsBefore && pins.length > before) {
      for (const { edge, end } of pair) {
        const e = edges[edge]; const n = e.s.length;
        for (let i = 0; i < n; i++) { const d = end === 0 ? e.s[i] : e.length - e.s[i]; if (d <= THROUGH_HOLD_M) pins.push([edge, i, z[edge][i]]); }
      }
    }
  }
  return { pins, mouths, eased, noRoom };
}

/**
 * The side roads a mouth pin made worse: steeper somewhere than their class allows and than they were before it
 * (a road with no room to reach the through road's height in the length it has: under a ramp it must clear, it
 * came out with a 25 % kick). Their pins are taken back and the roads solved once more without them.
 * zBefore, zAfter: the heights of the first solve and of the solve with the pins. limitOf(highway) -> grade.
 */
export function mouthsToRefuse(graph, zBefore, zAfter, pins, limitOf) {
  const refused = new Set();
  const steepest = (e, z) => { let m = 0; for (let i = 1; i < e.s.length; i++) { const d = e.s[i] - e.s[i - 1]; if (d > 0.2) m = Math.max(m, Math.abs(z[i] - z[i - 1]) / d); } return m; };
  for (const k of new Set(pins.map(([edge]) => edge))) {
    const e = graph.edges[k]; if (!e || !zBefore[k] || !zAfter[k]) continue;
    const after = steepest(e, zAfter[k]); const before = steepest(e, zBefore[k]);
    if (after > Math.max(before, limitOf(e.highway)) + REFUSE_OVER) refused.add(k);
  }
  return refused;
}
const REFUSE_OVER = 0.02;   // steeper by more than two points of grade than both: refused
