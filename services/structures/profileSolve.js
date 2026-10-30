// Structure solver, stage C: the vertical profile of every road at once
// (refs/output/bridge-tunnel-plan.md).
//
// Unknown: z at every station of every graph edge. Hard requirements become
// height envelopes spread through the whole network at each road's grade
// limit: a deck that must clear a road below lifts its approaches as far out
// as the grade needs (embankments), a tunnel that must stay under cover
// drops its approaches into a cutting before the portal. Inside the
// envelopes the profile stays on the ground where it may (ground roads pull
// hard, tagged bridges and tunnels hardly at all) and smooth, with one height
// at every joint and junction. Crossing requirements are refreshed from the
// road below a few times. Deterministic; nothing here knows about any place.

// Steepest grade the solve allows per class (a little under the checks'
// limits, so a solved profile passes them).
const GRADE_LIMIT = {
  motorway: 0.05, motorway_link: 0.07, trunk: 0.06, trunk_link: 0.07,
  primary: 0.08, primary_link: 0.08, secondary: 0.1, secondary_link: 0.1,
  tertiary: 0.12, tertiary_link: 0.12,
};
const GRADE_DEFAULT = 0.15;
export const gradeLimit = (highway) => GRADE_LIMIT[highway] ?? GRADE_DEFAULT;
// The steepest a road of each class follows its terrain where the terrain is
// steeper than its limit (a mountain street climbs with its hillside; a
// motorway ramp never climbs a 34% wall that bare-earth elevation shows
// where a ramp structure was taken out: it is built on fill or a deck).
// (the structure checks' limits per class, so a solved road never fails
// them by following its terrain; minor roads climb steeper hillsides)
const GRADE_CEILING = {
  motorway: 0.06, motorway_link: 0.08, trunk: 0.07, trunk_link: 0.08,
  primary: 0.1, primary_link: 0.1, secondary: 0.12, secondary_link: 0.12,
  tertiary: 0.15, tertiary_link: 0.15,
};
const GRADE_CEILING_DEFAULT = 0.25;

const W_GROUND = 1;           // pull of a ground road's station to its ground
// A tagged bridge / tunnel station: no pull to the ground at all (even a
// tiny one summed over a long deck sagged it toward the ground below, a
// crest at each end); held only by smoothing, joints and envelopes.
const W_STRUCTURE = 0;
const SMOOTH = 0.35;          // pull toward the neighbours' average
const TUNNEL_COVER_M = 7;     // road surface this far under the ground in a tunnel (tube + roof)
const DECK_UNDER_M = 2.2;     // deck depth under its road surface
const OUTER_ROUNDS = 6;       // crossing requirements refreshed this often
const SWEEPS = 120;           // smoothing sweeps per round (or until settled)
const SETTLED_M = 0.005;
const LONG_GRADE_M = 30;      // the terrain's own slope, over this far either side
const HILLSIDE_M = 100;       // ... and over this far: as steep there, a real hillside
const HILLSIDE_FACTOR = 1.5;  // a road on a hillside may run this much steeper (back down to it)
const HILLSIDE_MAX = 0.35;
const GROUND_BAND_M = 6;      // an untagged road's free fill / cut for grades
const UNDER_FREE_M = 3;       // a road under a deck is cleared from at most this over its ground

// Allowed rise per station step of an edge: the class limit, or the
// terrain's real slope over +-LONG_GRADE_M where steeper (a mountain road
// keeps its slope; a short hollow or spike in the elevation data, steeper
// than the slope around it, is bridged by fill or cut). A deck or tunnel
// does not follow the ground: its class limit only.
function allowedRise(e) {
  const lim = gradeLimit(e.highway);
  const n = e.s.length; const out = new Float64Array(Math.max(0, n - 1));
  const g = (i) => (Number.isFinite(e.g[i]) ? e.g[i] : 0);
  // (a slope over less road than asked for, a short edge's, says nothing)
  const slope = (p, q, need) => { const span = e.s[q] - e.s[p]; return span >= need ? Math.abs(g(q) - g(p)) / span : 0; };
  const ceiling = (GRADE_CEILING[e.highway] ?? GRADE_CEILING_DEFAULT) * 0.97;   // (a margin under the checks)
  let a = 0; let b = 0; let a2 = 0; let b2 = 0;
  for (let i = 0; i + 1 < n; i++) {
    const ds = e.s[i + 1] - e.s[i];
    if (e.bridge || e.tunnel) { out[i] = lim * ds; continue; }
    const mid = (e.s[i] + e.s[i + 1]) / 2;
    while (a + 1 < n && e.s[a + 1] <= mid - LONG_GRADE_M) a++;
    while (b + 1 < n && e.s[b] < mid + LONG_GRADE_M) b++;
    while (a2 + 1 < n && e.s[a2 + 1] <= mid - HILLSIDE_M) a2++;
    while (b2 + 1 < n && e.s[b2] < mid + HILLSIDE_M) b2++;
    const terrain = slope(a, b, LONG_GRADE_M);
    // a hillside steeper than the class ceiling, as steep over +-HILLSIDE_M:
    // the road may run steeper than it, so a lift or cut near a structure
    // fades back to the ground (at the ceiling alone it never could)
    const hill = terrain > ceiling && slope(a2, b2, HILLSIDE_M) >= 0.8 * terrain ? Math.min(HILLSIDE_MAX, terrain * HILLSIDE_FACTOR) : 0;
    out[i] = Math.max(lim, Math.min(terrain, ceiling), hill) * ds;
  }
  return out;
}

// binary heap of station indices ordered by key (max-heap when sign = 1)
function makeHeap(key, sign) {
  const a = [];
  const better = (i, j) => sign * (key[a[i]] - key[a[j]]) > 0;
  return {
    size: () => a.length,
    push(v) { a.push(v); let i = a.length - 1; while (i > 0) { const p = (i - 1) >> 1; if (!better(i, p)) break; [a[i], a[p]] = [a[p], a[i]]; i = p; } },
    pop() {
      const top = a[0]; const last = a.pop();
      if (a.length) {
        a[0] = last; let i = 0;
        for (;;) { const l = 2 * i + 1; const r = l + 1; let b = i; if (l < a.length && better(l, b)) b = l; if (r < a.length && better(r, b)) b = r; if (b === i) break; [a[i], a[b]] = [a[b], a[i]]; i = b; }
      }
      return top;
    },
  };
}

/**
 * Solve the profiles. `graph` from graph.js with `graph.crossings` from
 * crossings.js. Returns { z: Float64Array per edge, rounds, residual }.
 * A generator (yields between rounds and sweep blocks, for the browser);
 * solveProfiles() for a plain call.
 */
export function* solveProfilesSteps(graph) {
  const { edges, nodes } = graph;
  const crossings = graph.crossings?.crossings || [];
  const water = graph.crossings?.water || [];
  // one index space over all stations
  const off = []; let N = 0;
  for (const e of edges) { off.push(N); N += e.s.length; }
  const G = new Float64Array(N); const W = new Float64Array(N); const edgeOf = new Int32Array(N);
  edges.forEach((e, k) => {
    for (let i = 0; i < e.s.length; i++) {
      const v = off[k] + i;
      G[v] = Number.isFinite(e.g[i]) ? e.g[i] : 0;
      W[v] = e.bridge || e.tunnel ? W_STRUCTURE : W_GROUND;
      edgeOf[v] = k;
    }
  });
  const stepRise = edges.map((e) => allowedRise(e));
  // neighbours: along each edge (with the step's allowed rise) and between
  // the ends meeting at a node (no rise)
  const nbr = Array.from({ length: N }, () => []);
  // (the same allowance the grades are held to: a lift carried down a
  // mountain road at the class limit alone stood it far over its ground)
  edges.forEach((e, k) => {
    for (let i = 0; i + 1 < e.s.length; i++) {
      const a = off[k] + i; const b = a + 1; const rise = stepRise[k][i];
      nbr[a].push(b, rise); nbr[b].push(a, rise);
    }
  });
  const meets = [];
  for (const node of nodes.values()) {
    if (node.edges.length < 2) continue;
    const ends = node.edges.map(({ edge, end }) => off[edge] + (end === 0 ? 0 : edges[edge].s.length - 1));
    meets.push(ends);
    for (const a of ends) for (const b of ends) if (a !== b) nbr[a].push(b, 0);
  }

  // envelope from seeds: lower (max of seed - allowed fall) or upper (min of
  // seed + allowed rise), spread over the network
  const spread = (seeds, sign) => {
    const env = new Float64Array(N).fill(sign > 0 ? -Infinity : Infinity);
    const heap = makeHeap(env, sign);
    for (const [v, h] of seeds) if (sign * (h - env[v]) > 0) { env[v] = h; heap.push(v); }
    while (heap.size()) {
      const v = heap.pop(); const list = nbr[v];
      for (let j = 0; j < list.length; j += 2) {
        const u = list[j]; const cand = env[v] - sign * list[j + 1];
        if (sign * (cand - env[u]) > 1e-9) { env[u] = cand; heap.push(u); }
      }
    }
    return env;
  };
  const at = (side, Z) => Z[off[side.edge] + side.i] * (1 - side.f) + Z[off[side.edge] + side.i + 1] * side.f;

  // fixed upper seeds: tunnel interiors under cover
  const capSeeds = [];
  // (with another builder's tunnels pinned, a tunnel road it did not build,
  // a garage entrance too short to bore, stays a road: no cover over it)
  edges.forEach((e, k) => {
    if (!e.tunnel || e.external || graph.tunnelsPinned) return;
    for (let i = 1; i + 1 < e.s.length; i++) capSeeds.push([off[k] + i, G[off[k] + i] - TUNNEL_COVER_M]);
  });
  // pinned stations (roads another builder places: today's tunnels) are
  // held at their height from above and below
  const pins = (graph.pins || []).filter(([k, i, h]) => edges[k] && i < edges[k].s.length && Number.isFinite(h)).map(([k, i, h]) => [off[k] + i, h]);
  capSeeds.push(...pins);
  // roads with no structure tag: held near their ground (below)
  const banded = new Uint8Array(N);
  {
    // (not a structure's approach: a road meeting one at a node ramps to it)
    const structNode = new Set();
    for (const e of edges) if (e.bridge || e.tunnel || e.external) { structNode.add(e.from); structNode.add(e.to); }
    edges.forEach((e, k) => {
      if (e.bridge || e.tunnel || e.external || structNode.has(e.from) || structNode.has(e.to)) return;
      banded.fill(1, off[k], off[k] + e.s.length);
    });
  }
  const U = spread(capSeeds, -1);
  // fixed lower seeds: bridge runs over water
  const waterSeeds = pins.slice();
  for (const run of water) for (let i = run.i0; i <= run.i1; i++) waterSeeds.push([off[run.edge] + i, G[off[run.edge] + i] + (run.needs?.[i - run.i0] ?? run.need) + DECK_UNDER_M]);

  // station indices that are an edge's end at a node: held by the junction
  // value while grades are clamped (the clamp works inward from them)
  const nodeEnd = new Uint8Array(N);
  for (const node of nodes.values()) {
    if (node.edges.length < 2) continue;
    for (const { edge, end } of node.edges) nodeEnd[off[edge] + (end === 0 ? 0 : edges[edge].s.length - 1)] = 1;
  }
  const clampGrades = () => {
    let moved = 0;
    edges.forEach((e, k) => {
      const base = off[k]; const rise = stepRise[k]; const n = e.s.length;
      for (let i = 0; i + 1 < n; i++) {
        const v = base + i + 1;
        if (nodeEnd[v]) continue;
        const next = Math.min(U[v], Math.max(L[v], Math.min(Z[v - 1] + rise[i], Math.max(Z[v - 1] - rise[i], Z[v]))));
        moved = Math.max(moved, Math.abs(next - Z[v])); Z[v] = next;
      }
      for (let i = n - 2; i >= 0; i--) {
        const v = base + i;
        if (nodeEnd[v]) continue;
        const next = Math.min(U[v], Math.max(L[v], Math.min(Z[v + 1] + rise[i], Math.max(Z[v + 1] - rise[i], Z[v]))));
        moved = Math.max(moved, Math.abs(next - Z[v])); Z[v] = next;
      }
    });
    return moved;
  };
  // grade links over the whole network: along every edge (its allowed rise
  // per step) and between the ends meeting at a node (none); each excess is
  // split by how freely its two stations may move (a deck freely, a ground
  // road held by its ground), then held inside the envelopes
  const links = [];
  edges.forEach((e, k) => { for (let i = 0; i + 1 < e.s.length; i++) links.push(off[k] + i, off[k] + i + 1, stepRise[k][i]); });
  for (const ends of meets) for (let a = 1; a < ends.length; a++) links.push(ends[0], ends[a], 0);
  const freedomOf = (v) => 1 / (W[v] + 0.01);
  const projectNetwork = () => {
    let moved = 0;
    for (let pass = 0; pass < 4; pass++) {
      const fwd = pass % 2 === 0;
      for (let j = fwd ? 0 : links.length - 3; fwd ? j < links.length : j >= 0; j += fwd ? 3 : -3) {
        const a = links[j]; const b = links[j + 1]; const rise = links[j + 2];
        const d = Z[b] - Z[a];
        const excess = Math.abs(d) - rise;
        if (excess <= 1e-6) continue;
        const fa = freedomOf(a); const fb = freedomOf(b); const sign = Math.sign(d);
        const za = Math.min(U[a], Math.max(L[a], Z[a] + sign * excess * fa / (fa + fb)));
        const zb = Math.min(U[b], Math.max(L[b], Z[b] - sign * excess * fb / (fa + fb)));
        moved = Math.max(moved, Math.abs(za - Z[a]), Math.abs(zb - Z[b]));
        Z[a] = za; Z[b] = zb;
      }
    }
    return moved;
  };
  const Z = Float64Array.from(G, (g, v) => Math.min(g, U[v]));
  let L = new Float64Array(N).fill(-Infinity);
  let rounds = 0;
  for (; rounds < OUTER_ROUNDS; rounds++) {
    // crossing requirements from the road below as it now is
    const seeds = waterSeeds.slice();
    for (const c of crossings) {
      const up = c[c.upper]; const dn = c[c.upper === 'a' ? 'b' : 'a'];
      // (over a tunnel road nobody built: it is on the ground, crossed level)
      if (graph.tunnelsPinned && edges[dn.edge].tunnel && !edges[dn.edge].external) continue;
      // a road under with no structure of its own is cleared from near its
      // ground: one lifted with the deck (a ramp up to it) must not lift the
      // deck in turn, round after round (a deck climbed 35 m so)
      let under = at(dn, Z);
      if (!edges[dn.edge].bridge && !edges[dn.edge].external) under = Math.min(under, at(dn, G) + UNDER_FREE_M);
      const need = under + c.sep;
      seeds.push([off[up.edge] + up.i, need], [off[up.edge] + up.i + 1, need]);
    }
    L = spread(seeds, 1);
    // where a lift and a cap collide, the lift wins (clearance over cover)
    for (let v = 0; v < N; v++) if (L[v] > U[v]) U[v] = L[v];
    // a road with no structure tag stays near its ground where nothing asks
    // it up (a crossing, water, a pinned road) or down (cover): grades it
    // can't meet within the band, it follows the terrain (never a tall deck
    // over a gully); a bridge meeting it follows it
    // (a lift spread far over the network is finite everywhere, far under
    // the ground: it does not free a road from the band)
    for (let v = 0; v < N; v++) {
      if (!banded[v]) continue;
      // (a road a lift or cap reaches, a ramp toward a crossing or a portal,
      // keeps its freedom: capped at the band it kinked)
      if (L[v] > G[v] - GROUND_BAND_M || U[v] < G[v] + GROUND_BAND_M) continue;
      L[v] = Math.max(L[v], G[v] - GROUND_BAND_M);
      U[v] = Math.min(U[v], G[v] + GROUND_BAND_M);
    }
    for (let v = 0; v < N; v++) Z[v] = Math.min(U[v], Math.max(L[v], Z[v]));
    // smooth inside the envelopes; one height where ends meet
    for (let sweep = 0; sweep < SWEEPS; sweep++) {
      let moved = 0;
      edges.forEach((e, k) => {
        const base = off[k];
        for (let i = 1; i + 1 < e.s.length; i++) {
          const v = base + i;
          const next = Math.min(U[v], Math.max(L[v], (W[v] * G[v] + SMOOTH * (Z[v - 1] + Z[v + 1])) / (W[v] + 2 * SMOOTH)));
          moved = Math.max(moved, Math.abs(next - Z[v])); Z[v] = next;
        }
      });
      for (const ends of meets) {
        let sw = 0; let sz = 0; let lo = -Infinity; let hi = Infinity;
        for (const v of ends) { sw += W[v]; sz += W[v] * Z[v]; lo = Math.max(lo, L[v]); hi = Math.min(hi, U[v]); }
        // (all structure ends: no ground pull anywhere, a plain average)
        const avg = sw > 0 ? sz / sw : ends.reduce((a, v) => a + Z[v], 0) / ends.length;
        const mean = Math.min(Math.max(avg, lo), Math.max(lo, hi));
        for (const v of ends) { moved = Math.max(moved, Math.abs(Z[v] - mean)); Z[v] = mean; }
      }
      // grades last, inward from the junction values (so a junction
      // averaged toward one road never leaves a jump on another), then over
      // the whole network: junction heights must also be reachable along the
      // roads between them
      moved = Math.max(moved, clampGrades());
      moved = Math.max(moved, projectNetwork());
      if (sweep % 30 === 29) yield;
      if (moved < SETTLED_M) break;
    }
    yield;
  }
  // where grades can't all be met (a steep junction held near its ground)
  // the ends must still meet: one height, grades clamped inward from it
  let split = false;
  for (const ends of meets) {
    let lo = -Infinity; let hi = Infinity; let sz = 0; let zmin = Infinity; let zmax = -Infinity;
    for (const v of ends) { lo = Math.max(lo, L[v]); hi = Math.min(hi, U[v]); sz += Z[v]; zmin = Math.min(zmin, Z[v]); zmax = Math.max(zmax, Z[v]); }
    if (zmax - zmin < 0.01) continue;
    const mean = Math.min(Math.max(sz / ends.length, lo), Math.max(lo, hi));
    for (const v of ends) Z[v] = mean;
    split = true;
  }
  if (split) clampGrades();
  const z = edges.map((e, k) => Z.slice(off[k], off[k] + e.s.length));
  const result = { z, rounds, residual: profileResidual(graph, z) };
  // (debug: the envelopes, for tools)
  if (globalThis.__MAPNG_STRUCT_DEBUG) Object.defineProperty(result, 'debug', { value: { L, U, off }, enumerable: false });
  return result;
}

/** Solve without yielding. */
export function solveProfiles(graph) {
  const steps = solveProfilesSteps(graph);
  for (;;) { const { done, value } = steps.next(); if (done) return value; }
}

/**
 * The worst remaining violation of each constraint kind for profiles z.
 * Grades count only on structures and where the solve moved a road off its
 * ground, and only past the steeper of the class limit and the ground's own
 * grade (a ground road on steep terrain is the terrain's matter).
 */
export function profileResidual(graph, z) {
  const { edges, nodes } = graph;
  let joint = 0; let crossing = 0; let grade = 0; let water = 0; let cover = 0;
  for (const node of nodes.values()) {
    if (node.edges.length < 2) continue;
    const hs = node.edges.map(({ edge, end }) => z[edge][end === 0 ? 0 : edges[edge].s.length - 1]);
    joint = Math.max(joint, Math.max(...hs) - Math.min(...hs));
  }
  for (const c of graph.crossings?.crossings || []) {
    const up = c[c.upper]; const dn = c[c.upper === 'a' ? 'b' : 'a'];
    const zu = z[up.edge][up.i] * (1 - up.f) + z[up.edge][up.i + 1] * up.f;
    const zd = z[dn.edge][dn.i] * (1 - dn.f) + z[dn.edge][dn.i + 1] * dn.f;
    crossing = Math.max(crossing, c.sep - (zu - zd));
  }
  edges.forEach((e, k) => {
    const rise = allowedRise(e);
    for (let i = 0; i + 1 < e.s.length; i++) {
      const moved = Math.abs(z[k][i] - e.g[i]) > 0.05 || Math.abs(z[k][i + 1] - e.g[i + 1]) > 0.05;
      if (!(e.bridge || e.tunnel || moved)) continue;
      const ds = (e.s[i + 1] - e.s[i]) || 1;
      // (no steeper than the solve allows, or than the ground already was)
      grade = Math.max(grade, (Math.abs(z[k][i + 1] - z[k][i]) - Math.max(rise[i], Math.abs(e.g[i + 1] - e.g[i]))) / ds);
    }
    if (e.tunnel) for (let i = 1; i + 1 < e.s.length; i++) cover = Math.max(cover, z[k][i] - (e.g[i] - TUNNEL_COVER_M));
  });
  for (const run of graph.crossings?.water || []) {
    for (let i = run.i0; i <= run.i1; i++) water = Math.max(water, edges[run.edge].g[i] + (run.needs?.[i - run.i0] ?? run.need) + DECK_UNDER_M - z[run.edge][i]);
  }
  const r = (v) => Math.round(Math.max(0, v) * 1000) / 1000;
  return { joint: r(joint), crossing: r(crossing), grade: r(grade), water: r(water), cover: r(cover) };
}
