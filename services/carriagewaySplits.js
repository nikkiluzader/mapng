// Carriageway splits: where a two-way road divides into two one-way carriageways (a median opening before a
// roundabout, a divided stretch beginning) or two carriageways join back into one road. Not a junction.
//
// OSM maps it as three ways sharing one node: the two-way road ends there and both one-way branches start (or end)
// on its centre line. Drawn as three roads meeting, each branch started centred on the two-way road's centre line,
// as narrow as itself: the wide road's square end showed its corners past both branches, and the paint stopped as at
// a junction (thecoachtoma's Kaunas junctions, 2026-11-24). Here each branch is drawn starting on its own half of the
// two-way road (the driving side: right in right-hand traffic) and eases onto its own line as it separates.
//
// findCarriagewaySplits(ways, { leftHand }) -> Map(k -> { atStart, p, L, h, sign }): k a branch way's index; p the
// split point; h the branch's half width; L the run its shift eases out over; sign +1 to its node order's left.
// splitShiftAt(plan, x, y) -> the shift (m, left of node order positive) of a branch's drawn line at (x, y).
// Pure: no level, no I/O.
import { fastHypot } from './fastMath.js';

export const SPLIT_MEET_M = 1.5;      // ends this close are one meeting point
export const SPLIT_ON_COS = Math.cos((35 * Math.PI) / 180);   // a branch carries on within 35 degrees of the road
export const SPLIT_SIDE_COS = Math.cos((45 * Math.PI) / 180); // any other road at the point at least 45 degrees off it
const FORK_SKIP = new Set(['motorway', 'trunk']);   // one-way forks of these are exits and entries, not lane shares
export const SPLIT_RUN_M = [12, 60];
export const SPLIT_ROUND_M = 2;      // the bend where a branch's own line takes over its shifted one
export const SPLIT_TAPER_MIN_M = 0.3; // a trunk this much wider than its branches together is narrowed to them
export const SPLIT_TAPER_PER_M = 8;   // ... over 8 m for every metre of half width it loses
export const SPLIT_TAPER_RUN_M = [15, 0.4];   // ... at least 15 m, at most 40 % of its length  // the shift eases out over this run, as far as the branch takes to separate

const smooth = (t) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));

/**
 * ways: [{ xy: [[x, y]...], oneway: 0 | 1 | -1 (against node order), half, cls (highway class) }] (null: not drawn).
 * Returns the plans for the branches of every split, and the split points (for the junction code to leave alone).
 */
export function findCarriagewaySplits(ways = [], { leftHand = false } = {}) {
  const joints = []; const grid = new Map();
  ways.forEach((w, k) => {
    if (!w || !(w.xy?.length >= 2)) return;
    const n = w.xy.length;
    for (const [p, q, atStart] of [[w.xy[0], w.xy[1], true], [w.xy[n - 1], w.xy[n - 2], false]]) {
      const L = fastHypot(q[0] - p[0], q[1] - p[1]) || 1;
      const end = { k, atStart, p, out: [(q[0] - p[0]) / L, (q[1] - p[1]) / L] };
      const cx = Math.floor(p[0] / SPLIT_MEET_M); const cy = Math.floor(p[1] / SPLIT_MEET_M);
      let joint = null;
      for (let dx = -1; dx <= 1 && !joint; dx++) for (let dy = -1; dy <= 1 && !joint; dy++) {
        joint = (grid.get(`${cx + dx},${cy + dy}`) || []).find((j) => fastHypot(j[0].p[0] - p[0], j[0].p[1] - p[1]) < SPLIT_MEET_M) || null;
      }
      if (joint) { joint.push(end); continue; }
      joint = [end]; joints.push(joint);
      const key = `${cx},${cy}`; if (!grid.has(key)) grid.set(key, []); grid.get(key).push(joint);
    }
  });
  const plans = new Map(); const points = []; const tapers = new Map();
  const leaves = (b) => (ways[b.k].oneway === 1) === b.atStart;
  for (const j of joints) {
    if (j.length < 3) continue;
    // a two-way road whose way on (away from it) holds exactly two one-way branches, one leaving and one coming:
    // any other road at the point stands clearly off to the side (a side road joining at the split, as at
    // thecoachtoma's Pramones pr.: that one keeps its junction)
    let found = null;
    for (const trunk of j.filter((e) => !ways[e.k].oneway)) {
      const on = [-trunk.out[0], -trunk.out[1]];
      const dot = (e) => e.out[0] * on[0] + e.out[1] * on[1];
      const branches = j.filter((e) => e !== trunk && ways[e.k].oneway && dot(e) >= SPLIT_ON_COS);
      if (branches.length !== 2 || branches[0].k === branches[1].k || leaves(branches[0]) === leaves(branches[1])) continue;
      if (j.some((e) => e !== trunk && !branches.includes(e) && dot(e) > SPLIT_SIDE_COS)) continue;
      found = { trunk, on, branches }; break;
    }
    // or a one-way road forking into two one-way roads (both leaving it), or two joining into one (both coming to
    // it): the lanes shared out, the left branch taking the left lanes (thecoachtoma: "4 lanes to 4 lanes total")
    if (!found) {
      for (const trunk of j.filter((e) => ways[e.k].oneway)) {
        const on = [-trunk.out[0], -trunk.out[1]];
        const dot = (e) => e.out[0] * on[0] + e.out[1] * on[1];
        const branches = j.filter((e) => e !== trunk && ways[e.k].oneway && dot(e) >= SPLIT_ON_COS);
        if (branches.length !== 2 || branches[0].k === branches[1].k) continue;
        // (a road dividing into two roads: a slip road leaving or joining a motorway or trunk is not that,
        // it has its own merge and diverge (mergingLinks.js), and moving its line by its bridges cut their clearances
        // (the sweep's naldo and deckpark_g, 2026-11-25))
        const cls = (e) => String(ways[e.k].cls || '');
        if ([trunk, ...branches].some((e) => /_link$/.test(cls(e)) || FORK_SKIP.has(cls(e)))) continue;
        // (the trunk comes to the point and both branches leave it, or the trunk leaves and both come)
        const trunkLeaves = leaves(trunk);
        if (branches.some((b) => leaves(b) === trunkLeaves)) continue;
        if (j.some((e) => e !== trunk && !branches.includes(e) && dot(e) > SPLIT_SIDE_COS)) continue;
        found = { trunk, on, branches, fork: true }; break;
      }
    }
    if (!found) continue;
    const { trunk, on, branches, fork } = found;
    points.push({ p: trunk.p, trunk: trunk.k, trunkAtStart: trunk.atStart, branches: branches.map((b) => ({ k: b.k, atStart: b.atStart })) });
    // (a trunk wider than its two branches together, its extra lanes ending there (thecoachtoma: "6 lanes turn to
    // 2x2"): narrowed to their width over its last stretch, or its square end showed its corners past them)
    const target = ways[branches[0].k].half + ways[branches[1].k].half;
    const tw = ways[trunk.k];
    if (tw.half > target + SPLIT_TAPER_MIN_M) {
      let len = 0; for (let i = 1; i < tw.xy.length; i++) len += fastHypot(tw.xy[i][0] - tw.xy[i - 1][0], tw.xy[i][1] - tw.xy[i - 1][1]);
      const run = Math.min(Math.max(SPLIT_TAPER_RUN_M[0], SPLIT_TAPER_PER_M * (tw.half - target)), SPLIT_TAPER_RUN_M[1] * len);
      tapers.set(trunk.k, { p: trunk.p, target, run });
    }
    for (const b of branches) {
      const w = ways[b.k]; const h = w.half;
      // (the run: how far along the branch its line stands h off the trunk's axis, held to SPLIT_RUN_M)
      // (how far the branch's line must stand off the trunk's axis: its half width, or for a fork its lanes' place)
      const need = fork ? ways[trunk.k].half - h : h;
      let L = SPLIT_RUN_M[1]; let s = 0;
      const pts = b.atStart ? w.xy : [...w.xy].reverse();
      for (let i = 1; i < pts.length; i++) {
        s += fastHypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
        const rx = pts[i][0] - trunk.p[0]; const ry = pts[i][1] - trunk.p[1];
        if (Math.abs(rx * on[1] - ry * on[0]) >= need) { L = s; break; }
      }
      L = Math.max(SPLIT_RUN_M[0], Math.min(SPLIT_RUN_M[1], L));
      if (fork) {
        // (a fork: the branch to the left of the way on takes the trunk's left lanes, its centre (H - h) left of the
        // trunk's axis; the other the right lanes. Its side in its own node order's frame: a branch drawn away from
        // the point runs with the way on, one drawn toward it against it)
        const other = branches.find((o) => o !== b);
        const cross = (e) => on[0] * e.out[1] - on[1] * e.out[0];
        const isLeft = cross(b) > cross(other);
        const t = ways[trunk.k].half - h;
        if (t <= SPLIT_TAPER_MIN_M) continue;
        const along = b.atStart ? 1 : -1;
        plans.set(b.k, { atStart: b.atStart, p: trunk.p, on, L, h: t, sign: (isLeft ? 1 : -1) * along, fork: true });
        continue;
      }
      // (the driving side of its own direction of travel: right in right-hand traffic. Left of node order is +;
      // a branch drawn against its node order (oneway=-1) travels the other way)
      const right = w.oneway === 1 ? -1 : 1;
      plans.set(b.k, { atStart: b.atStart, p: trunk.p, on, L, h, sign: leftHand ? -right : right });
    }
  }
  return { plans, points, tapers };
}

/**
 * A branch's drawn line shifted at (x, y): by what it still lacks of its half width off the two-way road's axis, so
 * it runs straight on beside its twin until its own line takes over (faded over the last part of its run, for a
 * branch that stays close). Eased by distance instead, the branches pinched in after the split and widened again.
 */
export function splitShiftAt(plan, x, y) {
  if (!plan) return 0;
  const rx = x - plan.p[0]; const ry = y - plan.p[1];
  const d = fastHypot(rx, ry);
  if (d >= plan.L) return 0;
  const lat = plan.on ? Math.abs(rx * plan.on[1] - ry * plan.on[0]) : 0;
  // (a smooth maximum, SPLIT_ROUND_M wide: where the branch's own line takes over, a bend, not a corner)
  // (less its own overshoot at the split, so a branch starts exactly on its half: no lip past the road's edge)
  const sm = (g) => (g + Math.sqrt(g * g + SPLIT_ROUND_M * SPLIT_ROUND_M)) / 2;
  const lack = Math.max(0, sm(plan.h - lat) - (sm(plan.h) - plan.h));
  return plan.sign * lack * (1 - smooth((d - 0.7 * plan.L) / (0.3 * plan.L)));
}

/** A split trunk's half width at (x, y): its own, narrowed to its branches' together over its last stretch. */
export function splitTaperAt(taper, x, y, half) {
  if (!taper) return half;
  const d = fastHypot(x - taper.p[0], y - taper.p[1]);
  if (d >= taper.run) return half;
  return taper.target + (half - taper.target) * smooth(d / taper.run);
}

