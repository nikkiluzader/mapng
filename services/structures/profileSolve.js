import { findSideArms, sideArmFromEnd, sideArmStation, throughSurface } from './sideArms.js';
import { RAIL_GRADE_CEILING, RAIL_GRADE_LIMIT, RAIL_GROUND_BAND_M, railKindOfClass } from '../railways.js';

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
// (a railway's class is 'railway:<kind>': its own limits, services/railways.js)
export const gradeLimit = (highway) => GRADE_LIMIT[highway] ?? RAIL_GRADE_LIMIT[railKindOfClass(highway)] ?? GRADE_DEFAULT;
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
const WATER_OVER_GROUND_M = 0.5;   // over water, the deck's underside at least this over the ground at each station
const MINOR_CROWN_M = 0.3;    // a deck over a stream: this far over the line between its banks at most
const OUTER_ROUNDS = 6;       // crossing requirements refreshed this often
const SWEEPS = 120;           // smoothing sweeps per round (or until settled)
const SETTLED_M = 0.005;
const LONG_GRADE_M = 30;      // the terrain's own slope, over this far either side
const HILLSIDE_M = 100;       // ... and over this far: as steep there, a real hillside
const HILLSIDE_FACTOR = 1.5;  // a road on a hillside may run this much steeper (back down to it)
const HILLSIDE_MAX = 0.35;
const HILLSIDE_LONG = 1.1;    // a hillside is no steeper than this times the slope over +-HILLSIDE_M
const HILLSIDE_GAIN = 1.5;    // grade allowed per grade the hillside is over the class ceiling
const GROUND_BAND_M = 6;      // an untagged road's free fill / cut for grades
const UNDER_FREE_M = 3;       // a road under a deck is cleared from at most this over its ground
const PIN_REACH_FACTOR = 2.5; // a lift reaches no higher than this many times the grade limit climbs from a pinned road
const FORK_SHARE = 0.9;       // forking decks overlap: closer than this share of their half widths' sum
const FORK_FALL = 0.03;       // cross fall across a fork's one surface
const RAW_DECK_RAMP_FACTOR = 2; // a deck that may not shape its approaches ramps up to this many times its class limit

// The straightest profile along one edge between its two end heights that
// stays inside the envelopes [L, U] (a taut string): straight lines between
// the ends, bent only at the stations an envelope holds. What smoothing with
// no pull to the ground converges to, but at once: smoothing sweeps spread a
// change by about one station each, so a long deck that started on its
// ground was still sagging toward it when the sweeps ran out (a 1.5 km
// viaduct dipped to 2.6 m over the ground between abutments at 10 m).
const TAUT_ANCHORS_MAX = 48;
function tautProfile(Z, L, U, idx, s, freeA = false, freeB = false, G = null) {
  const n = idx.length;
  if (n < 3) return 0;
  const anchors = [0, n - 1];
  const zA = new Map([[0, Z[idx[0]]], [n - 1, Z[idx[n - 1]]]]);
  // a free end (the road leaves the map there): nothing holds it, it is
  // carried level from the nearest anchor inside (a viaduct cut by the map
  // edge came down to the ground there, its deck through the terrain)
  // (only from an anchor a clearance put there: with none yet, the lowest
  // the envelopes allow at the end; a far junction's height carried flat
  // stood a deck 3 m over the deck it forks from)
  // (never under the ground at the map edge: a deck dived 6 m into a hillside there)
  const clampAt = (i, z) => { const v = idx[i]; const lo = Math.max(L[v], G ? G[v] : -Infinity); return Math.min(Math.max(lo, U[v]), Math.max(lo, z)); };
  const lowest = (i) => (Number.isFinite(L[idx[i]]) ? clampAt(i, L[idx[i]]) : Z[idx[i]]);
  // (both ends free and nothing inside holding it: level at the highest of
  // the ground and the envelope under it, not a line between the grounds
  // where it leaves the map: a plateau-to-plateau viaduct followed the
  // valley side at 5 %, its two carriageways 16 m apart)
  let level = -Infinity;
  if (freeA && freeB) for (let i = 0; i < n; i++) level = Math.max(level, L[idx[i]], G ? G[idx[i]] : -Infinity);
  const carry = () => {
    const inner = anchors.length >= 3;
    if (freeA && freeB && !inner && Number.isFinite(level)) { zA.set(0, clampAt(0, level)); zA.set(n - 1, clampAt(n - 1, level)); return; }
    if (freeA) zA.set(0, inner ? clampAt(0, zA.get(anchors[1])) : lowest(0));
    if (freeB) zA.set(n - 1, inner ? clampAt(n - 1, zA.get(anchors[anchors.length - 2])) : lowest(n - 1));
  };
  let moved = 0;
  for (let round = 0; ; round++) {
    carry();
    // straight lines between consecutive anchors; the worst violation of an envelope
    let worst = 1e-4; let at = -1; let to = 0;
    for (let k = 0; k + 1 < anchors.length; k++) {
      const a = anchors[k]; const b = anchors[k + 1]; const za = zA.get(a); const zb = zA.get(b);
      const span = s[b] - s[a] || 1;
      for (let i = a + 1; i < b; i++) {
        const v = idx[i]; const z = za + (zb - za) * ((s[i] - s[a]) / span);
        const lo = L[v]; const hi = Math.max(lo, U[v]);
        if (lo - z > worst) { worst = lo - z; at = i; to = lo; }
        else if (z - hi > worst) { worst = z - hi; at = i; to = hi; }
      }
    }
    if (at < 0 || round >= TAUT_ANCHORS_MAX) break;
    let k = 0; while (anchors[k] < at) k++;
    anchors.splice(k, 0, at); zA.set(at, to);
  }
  for (const i of [0, n - 1]) if ((i === 0 ? freeA : freeB) && anchors.length >= 2) { const v = idx[i]; moved = Math.max(moved, Math.abs(zA.get(i) - Z[v])); Z[v] = zA.get(i); }
  for (let k = 0; k + 1 < anchors.length; k++) {
    const a = anchors[k]; const b = anchors[k + 1]; const za = zA.get(a); const zb = zA.get(b);
    const span = s[b] - s[a] || 1;
    for (let i = a + 1; i < b; i++) {
      const v = idx[i];
      const z = Math.min(Math.max(L[v], U[v]), Math.max(L[v], za + (zb - za) * ((s[i] - s[a]) / span)));
      moved = Math.max(moved, Math.abs(z - Z[v])); Z[v] = z;
    }
  }
  return moved;
}

// Allowed rise per station step of an edge: the class limit, or the
// terrain's real slope over +-LONG_GRADE_M where steeper (a mountain road
// keeps its slope; a short hollow or spike in the elevation data, steeper
// than the slope around it, is bridged by fill or cut). A deck or tunnel
// does not follow the ground: its class limit only.
function allowedRise(e, structure = !!(e.bridge || e.tunnel)) {
  const lim = gradeLimit(e.highway);
  const n = e.s.length; const out = new Float64Array(Math.max(0, n - 1));
  const g = (i) => (Number.isFinite(e.g[i]) ? e.g[i] : 0);
  // (a slope over less road than asked for, a short edge's, says nothing)
  const slope = (p, q, need) => { const span = e.s[q] - e.s[p]; return span >= need ? Math.abs(g(q) - g(p)) / span : 0; };
  const rail = railKindOfClass(e.highway);
  const ceiling = (GRADE_CEILING[e.highway] ?? RAIL_GRADE_CEILING[rail] ?? GRADE_CEILING_DEFAULT) * 0.97;   // (a margin under the checks)
  let a = 0; let b = 0; let a2 = 0; let b2 = 0;
  for (let i = 0; i + 1 < n; i++) {
    const ds = e.s[i + 1] - e.s[i];
    if (structure) { out[i] = lim * ds; continue; }
    const mid = (e.s[i] + e.s[i + 1]) / 2;
    while (a + 1 < n && e.s[a + 1] <= mid - LONG_GRADE_M) a++;
    while (b + 1 < n && e.s[b] < mid + LONG_GRADE_M) b++;
    while (a2 + 1 < n && e.s[a2 + 1] <= mid - HILLSIDE_M) a2++;
    while (b2 + 1 < n && e.s[b2] < mid + HILLSIDE_M) b2++;
    const terrain = slope(a, b, LONG_GRADE_M);
    // a hillside steeper than the class ceiling, as steep over +-HILLSIDE_M:
    // the road may run steeper than it, so a lift or cut near a structure
    // fades back to the ground (at the ceiling alone it never could)
    // (never a railway: it runs on a shelf at its own grade, in cuttings and
    // on fills, where a mountain road follows its hillside)
    // (growing with how far the hillside is over the ceiling, never switched
    // on at a threshold: a trunk road down a 14% hill was held to 7% along
    // 230 m and let go at 21% over the last 24 m, a ramp across its junction)
    const hillside = Math.min(terrain, slope(a2, b2, HILLSIDE_M) * HILLSIDE_LONG);
    const hill = !rail && hillside > ceiling ? Math.min(HILLSIDE_MAX, hillside * HILLSIDE_FACTOR, ceiling + (hillside - ceiling) * HILLSIDE_GAIN) : 0;
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
// A structure for the solve: a bridge, or a tunnel someone builds (with
// today's tunnels pinned, one the tunnel builder left out is a road on the
// ground: solved as a structure, a straight line between its ends, it ran
// 24 m under a Monaco hill with no tube round it)
const structureFor = (graph) => (e) => !!(e.bridge || (e.tunnel && (e.external || !graph.tunnelsPinned)));

export function* solveProfilesSteps(graph) {
  const { edges, nodes } = graph;
  const asStructure = structureFor(graph);
  // (roads of different layers alongside, overlapping: held apart as crossings are)
  const crossings = [...(graph.crossings?.crossings || []), ...(graph.crossings?.overlaps || [])];
  const water = graph.crossings?.water || [];
  // one index space over all stations
  const off = []; let N = 0;
  for (const e of edges) { off.push(N); N += e.s.length; }
  const G = new Float64Array(N); const W = new Float64Array(N); const edgeOf = new Int32Array(N);
  // what each station is pulled to: its ground, or an edge's own target (a
  // railway's ground with the dips it runs straight over filled: railTrack.js)
  const P = new Float64Array(N);
  edges.forEach((e, k) => {
    for (let i = 0; i < e.s.length; i++) {
      const v = off[k] + i;
      G[v] = Number.isFinite(e.g[i]) ? e.g[i] : 0;
      P[v] = e.target && Number.isFinite(e.target[i]) ? e.target[i] : G[v];
      // (an edge may carry its own pull per station: a railway's, weaker than a
      // street's so its profile runs smoother, full at a level crossing:
      // railTrack.js)
      W[v] = asStructure(e) ? W_STRUCTURE : e.weight ? e.weight[i] : W_GROUND;
      edgeOf[v] = k;
    }
  });
  // stations held exactly on their ground (terrain shaping switched off:
  // structures/shaping.js) and stations that may not go below it
  const held = new Uint8Array(N); const noCut = new Uint8Array(N);
  edges.forEach((e, k) => {
    const f = graph.fixed?.[k];
    if (f) for (let i = 0; i < e.s.length; i++) if (f[i]) held[off[k] + i] = 1;
    if (graph.noCut?.[k]) noCut.fill(1, off[k], off[k] + e.s.length);
  });
  // (a plain deck between held approaches, terrain shaping off, may ramp
  // this much steeper than its class: it must rise within its own length)
  const stepRise = edges.map((e, k) => (graph.noCut?.[k] ? allowedRise(e, asStructure(e)).map((r) => r * RAW_DECK_RAMP_FACTOR) : allowedRise(e, asStructure(e))));
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
  // seed + allowed rise), spread over the network (never on through a held
  // station: it stays on its ground, and so does what lies beyond it)
  const spread = (seeds, sign, scale = 1, blockHeld = true) => {
    const env = new Float64Array(N).fill(sign > 0 ? -Infinity : Infinity);
    const heap = makeHeap(env, sign);
    for (const [v, h] of seeds) if (sign * (h - env[v]) > 0) { env[v] = h; heap.push(v); }
    while (heap.size()) {
      const v = heap.pop(); const list = nbr[v];
      if (blockHeld && held[v]) continue;
      for (let j = 0; j < list.length; j += 2) {
        const u = list[j]; const cand = env[v] - sign * scale * list[j + 1];
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
  const pinned = new Uint8Array(N);
  for (const [v] of pins) pinned[v] = 1;
  // roads with no structure tag: held near their ground (below)
  const banded = new Uint8Array(N);
  {
    // (not a structure's approach: a road meeting one at a node ramps to it)
    const structNode = new Set();
    for (const e of edges) if (asStructure(e) || e.external) { structNode.add(e.from); structNode.add(e.to); }
    edges.forEach((e, k) => {
      if (asStructure(e) || e.external || structNode.has(e.from) || structNode.has(e.to)) return;
      banded.fill(1, off[k], off[k] + e.s.length);
    });
  }
  const bandOf = edges.map((e) => (railKindOfClass(e.highway) ? RAIL_GROUND_BAND_M : GROUND_BAND_M));
  const U = spread(capSeeds, -1);
  // the highest a road can be and still reach the pinned roads at a steep
  // but drivable grade: a lift (a crossing far up a tunnel's approach) gives
  // way there, the approach runs steeper into the portal instead of
  // arriving metres over the pinned road (a wall across the lanes)
  const pinReach = pins.length ? spread(pins, -1, PIN_REACH_FACTOR) : null;
  // likewise from the held stations, for the roads that may not dig (a
  // plain deck between held approaches: a clearance it can't reach at a
  // drivable grade from its ends gives way, never a wall at each end)
  let heldReach = null;
  if (noCut.some((x) => x)) {
    const seeds = [];
    for (let v = 0; v < N; v++) if (held[v]) seeds.push([v, G[v]]);
    if (seeds.length) heldReach = spread(seeds, -1, 1, false);
  }
  // fixed lower seeds: bridge runs over water
  // (over a stream, drain or ditch only: no higher than the line between its
  // banks, a small crown over it: a mountain road's short bridge over a gully
  // stood 3.5 m over its grade for a 2.5 m clearance over a 1 m ditch)
  const minorCap = (run, i) => {
    if (!run.minor) return Infinity;
    const e = edges[run.edge]; const n = e.s.length;
    const a = Math.max(0, run.i0 - 1); const b = Math.min(n - 1, run.i1 + 1);
    const t = b > a ? (e.s[i] - e.s[a]) / ((e.s[b] - e.s[a]) || 1) : 0;
    return G[off[run.edge] + a] + (G[off[run.edge] + b] - G[off[run.edge] + a]) * t + MINOR_CROWN_M;
  };
  const waterSeeds = pins.slice();
  // (a run's clearance over its water: from the lowest ground along it, the
  // water's surface, not each station's own ground: a run over an island
  // stood the deck its clearance over the island, a 21 m peak mid-river)
  for (const run of water) {
    let surface = Infinity;
    for (let i = run.i0; i <= run.i1; i++) surface = Math.min(surface, G[off[run.edge] + i]);
    // (and its underside over each station's own ground: a river mapped with its banks in it had the
    // deck through the banks, Clear Creek under I-70, the Tame Valley Canal)
    for (let i = run.i0; i <= run.i1; i++) {
      const k = off[run.edge] + i;
      waterSeeds.push([k, Math.min(Math.max(surface + (run.needs?.[i - run.i0] ?? run.need), G[k] + WATER_OVER_GROUND_M) + DECK_UNDER_M, minorCap(run, i))]);
    }
  }

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
  // (fork links where one deck leads: link index -> 1 a leads (b moves), -1 b leads)
  const linkLead = new Map();
  const forkRank = (e) => (/_link$/.test(e.highway || '') ? 0 : 1) * 10 + (e.half || 0) / 10;
  edges.forEach((e, k) => { for (let i = 0; i + 1 < e.s.length; i++) links.push(off[k] + i, off[k] + i + 1, stepRise[k][i]); });
  for (const ends of meets) for (let a = 1; a < ends.length; a++) links.push(ends[0], ends[a], 0);
  // decks forking at a node are one surface until their lanes part: from
  // the node out, each station of one held to the other's nearest within
  // a cross fall, as long as they overlap (a ramp left the motorway's deck
  // 2 m under it 15 m on; a car drove into its underside). Grade links
  // only: never spread as a lift.
  for (const node of nodes.values()) {
    const decks = node.edges.filter(({ edge }) => edges[edge].bridge && !edges[edge].external);
    for (let a = 0; a < decks.length; a++) {
      for (let b = a + 1; b < decks.length; b++) {
        const A = edges[decks[a].edge]; const B = edges[decks[b].edge];
        if (A.layer !== B.layer) continue;
        const reach = (A.half + B.half) * FORK_SHARE;
        const nA = A.s.length; const nB = B.s.length;
        const iA = (k) => (decks[a].end === 0 ? k : nA - 1 - k);
        const iB = (k) => (decks[b].end === 0 ? k : nB - 1 - k);
        let kb = 0;
        for (let ka = 1; ka < nA; ka++) {
          const xa = A.x[iA(ka)]; const ya = A.y[iA(ka)];
          // (B's nearest station, walking out with A)
          while (kb + 1 < nB && Math.hypot(B.x[iB(kb + 1)] - xa, B.y[iB(kb + 1)] - ya) <= Math.hypot(B.x[iB(kb)] - xa, B.y[iB(kb)] - ya)) kb++;
          const d = Math.hypot(B.x[iB(kb)] - xa, B.y[iB(kb)] - ya);
          if (d >= reach || kb === 0) { if (d >= reach) break; continue; }
          links.push(off[decks[a].edge] + iA(ka), off[decks[b].edge] + iB(kb), FORK_FALL * d + 0.02);
          // the minor road (a ramp) follows the main one, never the main
          // one the ramp: split both ways, the main deck kinked where the
          // ramp parted from it (a 1 m drop in 3 m over the Han)
          const ra = forkRank(A); const rb = forkRank(B);
          if (ra !== rb) linkLead.set(links.length - 3, ra > rb ? 1 : -1);
        }
      }
    }
  }
  const freedomOf = (v) => 1 / (W[v] + 0.01);
  // (a node where a road leaves the map: nothing beyond it holds a deck
  // down; a tunnel road nobody bores stays to the ground there)
  const freeEnd = (id) => nodes.get(id)?.kind === 'edgeOfMap';
  // structure edges joined end to end at a node of their own (a deck mapped
  // as two ways meeting mid-span) are one taut line from abutment to
  // abutment: solved apart, their shared node started at the river's level
  // and the sweeps never lifted it back (an arch bridge sagged 85 m)
  const taut = edges.map((e, k) => asStructure(e) && W[off[k]] === 0);
  const chains = [];
  {
    const seen = new Uint8Array(edges.length);
    // the one other taut edge through a node with exactly two ends, or null
    const across = (id, k) => {
      const node = nodes.get(id);
      if (!node || node.edges.length !== 2) return null;
      const o = node.edges.find((x) => x.edge !== k);
      return o && taut[o.edge] && !seen[o.edge] ? o : null;
    };
    edges.forEach((e, k) => {
      if (!taut[k] || seen[k]) return;
      seen[k] = 1;
      // walk back to the chain's start, then forward
      const back = []; let cur = { edge: k, rev: false };
      for (;;) {
        const ce = edges[cur.edge]; const startNode = cur.rev ? ce.to : ce.from;
        const o = across(startNode, cur.edge);
        if (!o) break;
        seen[o.edge] = 1;
        cur = { edge: o.edge, rev: o.end === 0 };   // entering it at its end 0 means we walk it backwards
        back.push(cur);
      }
      const list = [...back.reverse(), { edge: k, rev: false }];
      cur = list[list.length - 1];
      for (;;) {
        const ce = edges[cur.edge]; const endNode = cur.rev ? ce.from : ce.to;
        const o = across(endNode, cur.edge);
        if (!o) break;
        seen[o.edge] = 1;
        cur = { edge: o.edge, rev: o.end !== 0 };
        list.push(cur);
      }
      const idx = []; const ss = []; let acc = 0;
      for (const { edge, rev } of list) {
        const ce = edges[edge]; const n = ce.s.length;
        for (let j = 0; j < n; j++) {
          const i = rev ? n - 1 - j : j;
          if (j > 0) acc += Math.abs(ce.s[i] - ce.s[rev ? i + 1 : i - 1]);
          idx.push(off[edge] + i); ss.push(acc);
        }
      }
      const first = list[0]; const last = list[list.length - 1];
      const fe = edges[first.edge]; const le = edges[last.edge];
      chains.push({
        idx: Int32Array.from(idx), s: Float64Array.from(ss),
        freeA: !!fe.bridge && freeEnd(first.rev ? fe.to : fe.from),
        freeB: !!le.bridge && freeEnd(last.rev ? le.from : le.to),
      });
    });
  }
  const projectNetwork = () => {
    let moved = 0;
    for (let pass = 0; pass < 4; pass++) {
      const fwd = pass % 2 === 0;
      for (let j = fwd ? 0 : links.length - 3; fwd ? j < links.length : j >= 0; j += fwd ? 3 : -3) {
        const a = links[j]; const b = links[j + 1]; const rise = links[j + 2];
        const d = Z[b] - Z[a];
        const excess = Math.abs(d) - rise;
        if (excess <= 1e-6) continue;
        const lead = linkLead.get(j);
        const fa = lead === 1 ? 0 : freedomOf(a); const fb = lead === -1 ? 0 : freedomOf(b); const sign = Math.sign(d);
        const za = Math.min(U[a], Math.max(L[a], Z[a] + sign * excess * fa / (fa + fb)));
        const zb = Math.min(U[b], Math.max(L[b], Z[b] - sign * excess * fb / (fa + fb)));
        moved = Math.max(moved, Math.abs(za - Z[a]), Math.abs(zb - Z[b]));
        Z[a] = za; Z[b] = zb;
      }
    }
    return moved;
  };
  const Z = Float64Array.from(P, (g, v) => Math.min(g, U[v]));
  let L = new Float64Array(N).fill(-Infinity);
  let rounds = 0;
  for (; rounds < OUTER_ROUNDS; rounds++) {
    // crossing requirements from the road below as it now is
    const seeds = waterSeeds.slice();
    // (a crossing of two decks of one layer: after the first round the one
    // standing higher there is over the other, fixed from then on; in the
    // first round neither lifts)
    for (const c of crossings) {
      if (!c.dynamic || c.decided) continue;
      if (rounds === 0) continue;
      c.upper = at(c.a, Z) >= at(c.b, Z) ? 'a' : 'b';
      c.decided = true;
    }
    for (const c of crossings) {
      if (c.dynamic && !c.decided) continue;
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
    if (pinReach) for (let v = 0; v < N; v++) if (L[v] > pinReach[v]) L[v] = pinReach[v];
    if (heldReach) for (let v = 0; v < N; v++) if (noCut[v] && L[v] > heldReach[v]) L[v] = Math.max(G[v], heldReach[v]);
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
      // (a railway's cuttings and fills reach further: a 2 % line across a
      // valley stands on its embankment, not down in the valley)
      const band = bandOf[edgeOf[v]];
      // (a road a lift or cap reaches, a ramp toward a crossing or a portal,
      // keeps its freedom: capped at the band it kinked)
      // (round what it is pulled to: a railway's band is round its ground
      // with the dips it runs over filled, so a hollow deeper than the band
      // is crossed level, a viaduct over the data's gap, not dipped into)
      if (L[v] > P[v] - band || U[v] < P[v] + band) continue;
      L[v] = Math.max(L[v], P[v] - band);
      U[v] = Math.min(U[v], P[v] + band);
    }
    // terrain shaping off: held stations on their ground, no-cut ones over it
    for (let v = 0; v < N; v++) {
      if (held[v]) { L[v] = G[v]; U[v] = G[v]; } else if (noCut[v] && L[v] < G[v]) { L[v] = G[v]; if (U[v] < L[v]) U[v] = L[v]; }
    }
    // (a junction with a held road is at that road's ground: every end
    // meeting there too, so a bridge lifted over a road comes down to it)
    for (const ends of meets) {
      const h = ends.find((v) => held[v]);
      if (h === undefined || ends.some((v) => pinned[v])) continue;
      for (const v of ends) { L[v] = G[h]; U[v] = G[h]; }
    }
    for (let v = 0; v < N; v++) Z[v] = Math.min(U[v], Math.max(L[v], Z[v]));
    // smooth inside the envelopes; one height where ends meet
    // a ramp's stations tied to the main deck it forks from (a lead link)
    // as envelopes for its taut line: tied as a link alone, each sweep's
    // straight line undid it and the ramp jumped 3 m where it parted
    const followers = [];
    for (const [j, lead] of linkLead) followers.push(lead === 1 ? [links[j + 1], links[j], links[j + 2]] : [links[j], links[j + 1], links[j + 2]]);
    const FL = followers.length ? Float64Array.from(L) : L; const FU = followers.length ? Float64Array.from(U) : U;
    for (let sweep = 0; sweep < SWEEPS; sweep++) {
      let moved = 0;
      for (const [f] of followers) { FL[f] = L[f]; FU[f] = U[f]; }
      for (const [f, ld, rise] of followers) {
        FL[f] = Math.max(FL[f], Z[ld] - rise); FU[f] = Math.max(FL[f], Math.min(FU[f], Z[ld] + rise));
      }
      edges.forEach((e, k) => {
        const base = off[k];
        // (a structure with no pull to its ground anywhere: straight between its ends, inside the envelopes)
        if (taut[k]) return;   // (solved as chains below)
        for (let i = 1; i + 1 < e.s.length; i++) {
          const v = base + i;
          const next = Math.min(U[v], Math.max(L[v], (W[v] * P[v] + SMOOTH * (Z[v - 1] + Z[v + 1])) / (W[v] + 2 * SMOOTH)));
          moved = Math.max(moved, Math.abs(next - Z[v])); Z[v] = next;
        }
      });
      // (a structure with no pull to its ground anywhere: straight between its ends, inside the envelopes)
      for (const c of chains) moved = Math.max(moved, tautProfile(Z, FL, FU, c.idx, c.s, c.freeA, c.freeB, G));
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
  verticalCurves(graph, Z, L, U, off, pinned, held);
  seatSideArms(graph, Z, L, U, off, pinned, held, asStructure);
  tieTwinDecks(edges, Z, off, pinned, held, L, U, crossings);
  const z = edges.map((e, k) => Z.slice(off[k], off[k] + e.s.length));
  const result = { z, rounds, residual: profileResidual(graph, z) };
  // (debug: the envelopes, for tools)
  if (globalThis.__MAPNG_STRUCT_DEBUG) Object.defineProperty(result, 'debug', { value: { L, U, off }, enumerable: false });
  return result;
}

// A divided road's two carriageways side by side on one bridge (two OSM lines, two decks of one layer,
// flush and parallel): one surface, at one height where they run alongside (solved apart they stood
// 0.2-0.3 m apart: a step between the Golden Gate's carriageways). Each takes the mean of the two, eased
// out over TWIN_EASE_M before either's end (their joints with their own roads kept); pinned and held
// stations kept.
const TWIN_GAP_M = 1.2;        // edge to edge at most this apart (beyond: a median, decks of their own)
const TWIN_COS = 0.95;
const TWIN_EASE_M = 30;
const TWIN_EASE_GRADE = 0.005; // the ease adds at most this much grade
const TWIN_MAX_DZ_M = 1.5;     // more apart than this: not one surface (a ramp alongside at another level)
function tieTwinDecks(edges, Z, off, pinned, held, L, U, crossings = []) {
  const decks = edges.map((e, k) => k).filter((k) => edges[k].bridge && !edges[k].tunnel && edges[k].s.length > 1);
  if (decks.length < 2) return;
  const fixed = (v) => !!(pinned?.[v] || held?.[v]);
  // a road under another never lifted here (the one over it was solved for its height as it was: the
  // upper deck's envelope knows nothing of a later lift under it)
  const under = new Set();
  for (const c of crossings) {
    if (!c.upper) continue;
    const dn = c[c.upper === 'a' ? 'b' : 'a'];
    if (!dn || off[dn.edge] == null) continue;
    under.add(off[dn.edge] + dn.i); under.add(off[dn.edge] + dn.i + 1);
  }
  const moves = [];
  for (const a of decks) {
    const ea = edges[a];
    const n = ea.s.length;
    const sum = new Float64Array(n); const cnt = new Uint16Array(n);
    for (let i = 0; i < n; i++) {
      const ia = Math.min(i, n - 2);
      const ux = ea.x[ia + 1] - ea.x[ia]; const uy = ea.y[ia + 1] - ea.y[ia]; const ul = Math.hypot(ux, uy) || 1;
      for (const b of decks) {
        if (b === a) continue;
        const eb = edges[b];
        if ((eb.layer || 0) !== (ea.layer || 0)) continue;
        // (not a fork's branches: they share a node, and the ramp follows the main deck, never the other
        // way; nor a ramp beside its main line)
        if (ea.from === eb.from || ea.from === eb.to || ea.to === eb.from || ea.to === eb.to) continue;
        if (/_link$/.test(ea.highway || '') !== /_link$/.test(eb.highway || '')) continue;
        let best = null;
        for (let j = 0; j + 1 < eb.s.length; j++) {
          const vx = eb.x[j + 1] - eb.x[j]; const vy = eb.y[j + 1] - eb.y[j]; const L2 = vx * vx + vy * vy || 1e-9;
          const t = ((ea.x[i] - eb.x[j]) * vx + (ea.y[i] - eb.y[j]) * vy) / L2;
          if (t < 0 || t > 1) continue;
          const d = Math.hypot(eb.x[j] + vx * t - ea.x[i], eb.y[j] + vy * t - ea.y[i]);
          if (!best || d < best.d) best = { d, j, t, cos: Math.abs((ux * vx + uy * vy) / (ul * Math.sqrt(L2))) };
        }
        if (!best || best.cos < TWIN_COS || best.d > ea.half + eb.half + TWIN_GAP_M || best.d < 0.5 * (ea.half + eb.half)) continue;
        const zb = Z[off[b] + best.j] + (Z[off[b] + best.j + 1] - Z[off[b] + best.j]) * best.t;
        if (Math.abs(zb - Z[off[a] + i]) > TWIN_MAX_DZ_M) continue;
        sum[i] += zb; cnt[i]++;
      }
    }
    // eased in and out over TWIN_EASE_M wherever the pairing starts or stops (a deck's ends, or partway
    // along where the two part): never a step at the edge of the paired stretch
    let lastOff = -Infinity;
    const toOff = new Float64Array(n).fill(Infinity);
    for (let i = 0; i < n; i++) { if (!cnt[i]) lastOff = ea.s[i]; toOff[i] = ea.s[i] - lastOff; }
    lastOff = Infinity;
    for (let i = n - 1; i >= 0; i--) { if (!cnt[i]) lastOff = ea.s[i]; toOff[i] = Math.min(toOff[i], lastOff - ea.s[i]); }
    for (let i = 0; i < n; i++) {
      const v = off[a] + i;
      if (!cnt[i] || fixed(v)) continue;
      const mean = (Z[v] + sum[i] / cnt[i]) / 2;
      // (eased over a length the step asks for: at most TWIN_EASE_GRADE of grade added)
      const easeM = Math.max(TWIN_EASE_M, Math.abs(mean - Z[v]) / TWIN_EASE_GRADE);
      const w = Math.min(1, Math.min(ea.s[i], ea.s[n - 1] - ea.s[i], toOff[i]) / easeM);
      if (w <= 0) continue;
      let z = Z[v] + (mean - Z[v]) * w;
      if (under.has(v)) z = Math.min(z, Z[v]);
      // (inside the envelopes: never under another road's clearance or over its own limits)
      if (L && U) z = Math.min(Math.max(z, L[v]), Math.max(L[v], U[v]));
      moves.push([v, z]);
    }
  }
  for (const [v, z] of moves) Z[v] = z;
}

// Vertical curves where a deck meets a road on the ground: the deck's grade
// and the road's met at the joint in a corner (a crest or a sag of 10-15 %
// change at a motorway's abutment, felt as a jolt); a parabola between the
// two grades instead, as long as the change asks for (VC_M_PER_PCT per % of
// it, VC_MIN_M..VC_MAX_M), as far as both roads reach, inside the envelopes.
const VC_M_PER_PCT = 3;
const VC_AT_JUNCTIONS = true;    // (curves at a junction too: the node kept, each side curved into it)
const VC_MIN_M = 10;
const VC_MAX_M = 60;
const VC_GRADE_M = [6, 20];    // each side's grade read this far from the joint
function verticalCurves(graph, Z, L, U, off, pinned, held) {
  // (a pinned or held station is where another rule put it: never moved)
  const fixedAt = (v) => pinned[v] || held[v];
  const { edges, nodes } = graph;
  const heldEdge = (k) => graph.fixed?.[k]?.some?.((x) => x);
  // each side's stations from the node outwards: [v, s]
  const side = ({ edge, end }) => {
    const e = edges[edge]; const n = e.s.length; const out = [];
    for (let j = 0; j < n; j++) { const i = end === 0 ? j : n - 1 - j; out.push([off[edge] + i, Math.abs(e.s[i] - e.s[end === 0 ? 0 : n - 1])]); }
    return out;
  };
  const at = (S, d) => {
    for (let k = 0; k + 1 < S.length; k++) {
      if (S[k + 1][1] >= d) { const f = (d - S[k][1]) / ((S[k + 1][1] - S[k][1]) || 1); return Z[S[k][0]] + (Z[S[k + 1][0]] - Z[S[k][0]]) * f; }
    }
    return Z[S[S.length - 1][0]];
  };
  const slopeAt = (S, d) => { const d1 = Math.min(d + 4, S[S.length - 1][1]); const d0 = Math.max(0, d - 4); return (at(S, d1) - at(S, d0)) / ((d1 - d0) || 1); };
  const gradeOf = (S) => {
    const z0 = Z[S[0][0]];
    const far = S.filter(([, d]) => d >= VC_GRADE_M[0] && d <= VC_GRADE_M[1]);
    if (far.length < 2) return null;
    let sdd = 0; let sdz = 0;
    for (const [v, d] of far) { sdd += d * d; sdz += d * (Z[v] - z0); }
    return sdz / (sdd || 1);
  };
  // the direction a road leaves the node in (to its station ~8 m out)
  const dirOf = ({ edge, end }) => {
    const e = edges[edge]; const n = e.s.length; const i0 = end === 0 ? 0 : n - 1;
    let i = i0; while (i >= 0 && i < n && Math.abs(e.s[i] - e.s[i0]) < 8) i += end === 0 ? 1 : -1;
    i = Math.max(0, Math.min(n - 1, i));
    const dx = e.x[i] - e.x[i0]; const dy = e.y[i] - e.y[i0]; const l = Math.hypot(dx, dy) || 1;
    return [dx / l, dy / l];
  };
  const hermite = (z0, m0, z1, m1, len, d) => {
    const u = d / len; const u2 = u * u; const u3 = u2 * u;
    return (2 * u3 - 3 * u2 + 1) * z0 + (u3 - 2 * u2 + u) * len * m0 + (-2 * u3 + 3 * u2) * z1 + (u3 - u2) * len * m1;
  };
  for (const node of nodes.values()) {
    if (node.edges.length < 2) continue;
    for (const p of node.edges) {
      const ep = edges[p.edge];
      if (!ep.bridge || ep.tunnel || ep.external || heldEdge(p.edge)) continue;
      // its road: the ground road at the node most in line with it (going on through)
      const dp = dirOf(p);
      let q = null; let best = Infinity;
      for (const o of node.edges) {
        const eo = edges[o.edge];
        if (o === p || eo.bridge || eo.tunnel || eo.external || heldEdge(o.edge)) continue;
        const d = dirOf(o); const dot = dp[0] * d[0] + dp[1] * d[1];
        if (dot < best) { best = dot; q = o; }
      }
      if (!q || best > -0.5) continue;   // (none going on: a side road meeting the deck's end)
      const A = side(p); const B = side(q);
      if (fixedAt(A[0][0]) || fixedAt(B[0][0])) continue;
      const gA = gradeOf(A); const gB = gradeOf(B);
      if (gA === null || gB === null) continue;
      const change = Math.abs(gA + gB);   // (each measured away from the node: a straight line sums to 0)
      if (change < 0.02) continue;
      const h = Math.min(VC_MAX_M, Math.max(VC_MIN_M, change * 100 * VC_M_PER_PCT), 2 * A[A.length - 1][1], 2 * B[B.length - 1][1]) / 2;
      const za = at(A, h); const zb = at(B, h); const sa = slopeAt(A, h); const sb = slopeAt(B, h);
      if (node.edges.length === 2) {
        // a plain joint: one cubic from h on the deck to h on the road, the
        // node moving with it; along t (deck side negative) grades -sa, sb
        for (const [S, sign] of [[A, -1], [B, 1]]) {
          for (const [v, d] of S) {
            if (d >= h) break;
            if (fixedAt(v)) continue;
            const t = sign * d + h;
            const z = hermite(za, -sa, zb, sb, 2 * h, t);
            Z[v] = Math.min(Math.max(L[v], U[v]), Math.max(L[v], z));
          }
        }
      } else if (VC_AT_JUNCTIONS) {
        // a junction: the node stays (the other roads meet it there), each
        // side curves from it, leaving at the mean of the two grades
        // (each side the curve's whole length: from a fixed node half of it turned too sharply)
        const hj = Math.min(2 * h, A[A.length - 1][1], B[B.length - 1][1]);
        const ja = slopeAt(A, hj); const jb = slopeAt(B, hj);
        const z0 = Z[A[0][0]]; const m = (gA - gB) / 2;   // grade along the deck side, away from the node
        for (const [S, m0, s1] of [[A, m, ja], [B, -m, jb]]) {
          const z1 = at(S, hj);
          for (const [v, d] of S) {
            if (d === 0) continue;
            if (d >= hj) break;
            if (fixedAt(v)) continue;
            const z = hermite(z0, m0, z1, s1, hj, d);
            Z[v] = Math.min(Math.max(L[v], U[v]), Math.max(L[v], z));
          }
        }
      }
    }
  }
}

// A side road's stations under its through road's lanes (sideArms.js) take
// the through road's surface; the change where it leaves the lanes fades out
// along it at SEAT_FADE_GRADE (within SEAT_FADE_M).
const SEAT_FADE_GRADE = 0.03;
const SEAT_FADE_M = [8, 60];
/** Which edges may be seated: roads on the ground, nothing held on them. */
export const seatable = (graph, asStructure = structureFor(graph)) => (k) => {
  const e = graph.edges[k];
  return !asStructure(e) && !e.bridge && !e.tunnel && !e.external && !railKindOfClass(e.highway) && e.highway !== 'raceway'
    && !graph.fixed?.[k]?.some?.((x) => x) && !graph.noCut?.[k];
};
function seatSideArms(graph, Z, L, U, off, pinned, held, asStructure) {
  const { edges } = graph;
  const fixedAt = (v) => pinned[v] || held[v];
  const zOf = (k, i) => Z[off[k] + i];
  const put = (v, z) => { if (!fixedAt(v)) Z[v] = Math.min(Math.max(L[v], U[v]), Math.max(L[v], z)); };
  for (const arm of findSideArms(graph, seatable(graph, asStructure))) {
    const e = edges[arm.edge]; const n = e.s.length; const base = off[arm.edge];
    const at = (j) => sideArmStation(e, arm.end, j);
    // (read before any is written: the through road's own stations are never moved here)
    const targets = [];
    for (let j = 1; j <= arm.under; j++) { const i = at(j); targets.push(throughSurface(graph, arm.mains, zOf, e.x[i], e.y[i])?.z); }
    if (targets.some((t) => !Number.isFinite(t))) continue;
    const edge = at(arm.under); const delta = targets[arm.under - 1] - Z[base + edge];
    const reach = sideArmFromEnd(e, arm.end, edge);
    const fade = Math.min(SEAT_FADE_M[1], Math.max(SEAT_FADE_M[0], Math.abs(delta) / SEAT_FADE_GRADE), Math.max(0, (e.s[n - 1] - e.s[0]) - reach));
    for (let j = arm.under; j < n; j++) {
      const i = at(j); const f = fade > 0 ? 1 - (sideArmFromEnd(e, arm.end, i) - reach) / fade : (j === arm.under ? 1 : 0);
      if (f <= 0) break;
      // (its far end is another junction's: never moved)
      if (j === n - 1) break;
      put(base + i, Z[base + i] + delta * f);
    }
    for (let j = 1; j < arm.under; j++) put(base + at(j), targets[j - 1]);
  }
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
  const asStructure = structureFor(graph);
  let joint = 0; let crossing = 0; let grade = 0; let water = 0; let cover = 0;
  for (const node of nodes.values()) {
    if (node.edges.length < 2) continue;
    const hs = node.edges.map(({ edge, end }) => z[edge][end === 0 ? 0 : edges[edge].s.length - 1]);
    joint = Math.max(joint, Math.max(...hs) - Math.min(...hs));
  }
  for (const c of graph.crossings?.crossings || []) {
    const up = c[c.upper]; const dn = c[c.upper === 'a' ? 'b' : 'a'];
    // (over a tunnel road nobody built: crossed level by design, as in the solve)
    if (graph.tunnelsPinned && edges[dn.edge].tunnel && !edges[dn.edge].external) continue;
    const zu = z[up.edge][up.i] * (1 - up.f) + z[up.edge][up.i + 1] * up.f;
    const zd = z[dn.edge][dn.i] * (1 - dn.f) + z[dn.edge][dn.i + 1] * dn.f;
    crossing = Math.max(crossing, c.sep - (zu - zd));
  }
  edges.forEach((e, k) => {
    const rise = allowedRise(e, asStructure(e));
    for (let i = 0; i + 1 < e.s.length; i++) {
      const moved = Math.abs(z[k][i] - e.g[i]) > 0.05 || Math.abs(z[k][i + 1] - e.g[i + 1]) > 0.05;
      if (!(asStructure(e) || moved)) continue;
      const ds = (e.s[i + 1] - e.s[i]) || 1;
      // (no steeper than the solve allows, or than the ground already was)
      grade = Math.max(grade, (Math.abs(z[k][i + 1] - z[k][i]) - Math.max(rise[i], Math.abs(e.g[i + 1] - e.g[i]))) / ds);
    }
    if (e.tunnel && asStructure(e)) for (let i = 1; i + 1 < e.s.length; i++) cover = Math.max(cover, z[k][i] - (e.g[i] - TUNNEL_COVER_M));
  });
  for (const run of graph.crossings?.water || []) {
    // (from the water's surface: the lowest ground along the run, as the solve)
    let surface = Infinity;
    for (let i = run.i0; i <= run.i1; i++) surface = Math.min(surface, edges[run.edge].g[i]);
    if (run.minor) continue;   // (a stream: no clearance asked, the solve's cap)
    for (let i = run.i0; i <= run.i1; i++) water = Math.max(water, Math.max(surface + (run.needs?.[i - run.i0] ?? run.need), edges[run.edge].g[i] + WATER_OVER_GROUND_M) + DECK_UNDER_M - z[run.edge][i]);
  }
  const r = (v) => Math.round(Math.max(0, v) * 1000) / 1000;
  return { joint: r(joint), crossing: r(crossing), grade: r(grade), water: r(water), cover: r(cover) };
}
