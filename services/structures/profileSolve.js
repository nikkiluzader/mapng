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

const W_GROUND = 1;           // pull of a ground road's station to its ground
const W_STRUCTURE = 0.002;    // a tagged bridge / tunnel station: nearly free
const SMOOTH = 0.35;          // pull toward the neighbours' average
const TUNNEL_COVER_M = 7;     // road surface this far under the ground in a tunnel (tube + roof)
const DECK_UNDER_M = 2.2;     // deck depth under its road surface
const OUTER_ROUNDS = 6;       // crossing requirements refreshed this often
const SWEEPS = 120;           // smoothing sweeps per round (or until settled)
const SETTLED_M = 0.005;

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
  // neighbours: along each edge (with the step's allowed rise) and between
  // the ends meeting at a node (no rise)
  const nbr = Array.from({ length: N }, () => []);
  edges.forEach((e, k) => {
    const g = gradeLimit(e.highway);
    for (let i = 0; i + 1 < e.s.length; i++) {
      const a = off[k] + i; const b = a + 1; const rise = g * (e.s[i + 1] - e.s[i]);
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
  edges.forEach((e, k) => { if (e.tunnel) for (let i = 1; i + 1 < e.s.length; i++) capSeeds.push([off[k] + i, G[off[k] + i] - TUNNEL_COVER_M]); });
  const U = spread(capSeeds, -1);
  // fixed lower seeds: bridge runs over water
  const waterSeeds = [];
  for (const run of water) for (let i = run.i0; i <= run.i1; i++) waterSeeds.push([off[run.edge] + i, G[off[run.edge] + i] + run.need + DECK_UNDER_M]);

  const Z = Float64Array.from(G, (g, v) => Math.min(g, U[v]));
  let L = new Float64Array(N).fill(-Infinity);
  let rounds = 0;
  for (; rounds < OUTER_ROUNDS; rounds++) {
    // crossing requirements from the road below as it now is
    const seeds = waterSeeds.slice();
    for (const c of crossings) {
      const up = c[c.upper]; const dn = c[c.upper === 'a' ? 'b' : 'a'];
      const need = at(dn, Z) + c.sep;
      seeds.push([off[up.edge] + up.i, need], [off[up.edge] + up.i + 1, need]);
    }
    L = spread(seeds, 1);
    // where a lift and a cap collide, the lift wins (clearance over cover)
    for (let v = 0; v < N; v++) if (L[v] > U[v]) U[v] = L[v];
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
        const mean = Math.min(Math.max(sz / sw, lo), Math.max(lo, hi));
        for (const v of ends) { moved = Math.max(moved, Math.abs(Z[v] - mean)); Z[v] = mean; }
      }
      if (sweep % 30 === 29) yield;
      if (moved < SETTLED_M) break;
    }
    yield;
  }
  const z = edges.map((e, k) => Z.slice(off[k], off[k] + e.s.length));
  return { z, rounds, residual: profileResidual(graph, z) };
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
    const lim = gradeLimit(e.highway);
    for (let i = 0; i + 1 < e.s.length; i++) {
      const moved = Math.abs(z[k][i] - e.g[i]) > 0.05 || Math.abs(z[k][i + 1] - e.g[i + 1]) > 0.05;
      if (!(e.bridge || e.tunnel || moved)) continue;
      const ds = (e.s[i + 1] - e.s[i]) || 1;
      // (no steeper than the class allows, or than the ground already was)
      grade = Math.max(grade, Math.abs(z[k][i + 1] - z[k][i]) / ds - Math.max(lim, Math.abs(e.g[i + 1] - e.g[i]) / ds));
    }
    if (e.tunnel) for (let i = 1; i + 1 < e.s.length; i++) cover = Math.max(cover, z[k][i] - (e.g[i] - TUNNEL_COVER_M));
  });
  for (const run of graph.crossings?.water || []) {
    for (let i = run.i0; i <= run.i1; i++) water = Math.max(water, edges[run.edge].g[i] + run.need + DECK_UNDER_M - z[run.edge][i]);
  }
  const r = (v) => Math.round(Math.max(0, v) * 1000) / 1000;
  return { joint: r(joint), crossing: r(crossing), grade: r(grade), water: r(water), cover: r(cover) };
}
