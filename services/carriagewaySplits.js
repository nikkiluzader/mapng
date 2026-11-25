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
export const SPLIT_BLEND_M = 0.25;  // the shift's blend onto the branch's own line, each side of its place (wider, the
                                     // run lasted while the branch got a metre past its place: 28 -> 60 m at gt_chevril)
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
    const { trunk, on, branches } = found;
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
    // (each branch's side of the trunk's axis, looking along the way on: by where its line stands once apart)
    const sideOf = (b) => {
      const pts = b.atStart ? ways[b.k].xy : [...ways[b.k].xy].reverse();
      let s = 0; let best = 0;
      for (let i = 1; i < pts.length && s < SPLIT_RUN_M[1]; i++) {
        s += fastHypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
        const rx = pts[i][0] - trunk.p[0]; const ry = pts[i][1] - trunk.p[1];
        const lat = on[0] * ry - on[1] * rx;
        if (Math.abs(lat) > Math.abs(best)) best = lat;
      }
      if (Math.abs(best) > 1e-6) return Math.sign(best);
      const c = on[0] * b.out[1] - on[1] * b.out[0];
      return c >= 0 ? 1 : -1;
    };
    const sides = branches.map(sideOf);
    if (sides[0] === sides[1]) { sides[0] = -sides[1] || 1; }
    // (the trunk as wide as it is drawn at the split: its own half, or the branches' together where it is narrowed to them)
    const H = tapers.has(trunk.k) ? target : tw.half;
    // (each branch's share of it at the split: its lanes at the trunk's lane width, plus the trunk's edge strip on its
    // side, where the lanes add up; else in proportion to the branches' widths. The branches meet in one seam there and
    // the trunk's lane lines carry on. Each started at its own full width, the road stepped out at the split, its edge
    // strips on the median side too, and every lane line jumped (roads test level, splits 6 to 3+3 and 3 to 2+1, in game
    // 2026-11-25))
    const hb = branches.map((bb) => ways[bb.k].half);
    let share = hb.slice();
    if (hb[0] + hb[1] > H + 1e-6) {
      const nt = tw.lanes; const nb = branches.map((bb) => ways[bb.k].lanes);
      if (nt && nb[0] && nb[1] && nb[0] + nb[1] === nt && Number.isFinite(tw.drive) && tw.drive > 0) {
        const wt = (2 * Math.min(tw.drive, H)) / nt; const e = Math.max(0, H - Math.min(tw.drive, H));
        share = nb.map((n) => (e + n * wt) / 2);
      } else share = hb.map((h) => (H * h) / (hb[0] + hb[1]));
    }
    // (the trunk's lane width, where the branches' lanes add up to its own: their lanes on its lanes at the split)
    const ntl = tw.lanes; const nbl = branches.map((bb) => ways[bb.k].lanes);
    const wtl = ntl && nbl[0] && nbl[1] && nbl[0] + nbl[1] === ntl && Number.isFinite(tw.drive) && tw.drive > 0 ? (2 * Math.min(tw.drive, H)) / ntl : null;
    branches.forEach((b, j) => {
      const w = ways[b.k]; const h = w.half; const s0 = share[j];
      // (its lanes against the seam at the split, at the trunk's lane width: its lines moved that far toward the seam
      // from the middle of its width, splitLaneShiftAt)
      const laneHalf = wtl ? (nbl[j] * wtl) / 2 : null;
      const laneIn = wtl ? Math.max(0, s0 - laneHalf) : 0;
      // (the branch's middle off the trunk's axis at the split, and where its full width clears the seam)
      const off0 = H - s0;
      const seam = H - 2 * s0;
      const need = seam + h;
      if (need <= SPLIT_TAPER_MIN_M && Math.abs(h - s0) < 1e-3) return;
      // (a fork's branch about as wide as the trunk, already in its place: left as drawn, as before. Given its share it
      // was narrowed and moved on a hillside where the fork's branches part 5 m apart in height, and the trunk's end rose a
      // metre off the ground (gt_chevril, 30 m, untouched))
      if (found.fork && tw.half - h <= SPLIT_TAPER_MIN_M) return;
      // (the run: until the branch's own line stands past that by the blend's half width, where the shift is nil;
      // a branch that never gets there within SPLIT_RUN_M fades out instead, stuck)
      let L = SPLIT_RUN_M[1]; let s = 0; let stuck = true;
      const pts = b.atStart ? w.xy : [...w.xy].reverse();
      for (let i = 1; i < pts.length; i++) {
        const seg = fastHypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
        const ra = [pts[i - 1][0] - trunk.p[0], pts[i - 1][1] - trunk.p[1]]; const rb = [pts[i][0] - trunk.p[0], pts[i][1] - trunk.p[1]];
        const la = Math.abs(ra[0] * on[1] - ra[1] * on[0]); const lb = Math.abs(rb[0] * on[1] - rb[1] * on[0]);
        const goal = need + SPLIT_BLEND_M;
        if (lb >= goal) { L = s + seg * Math.max(0, Math.min(1, (goal - la) / ((lb - la) || 1))); stuck = false; break; }
        s += seg;
      }
      if (L > SPLIT_RUN_M[1]) { L = SPLIT_RUN_M[1]; stuck = true; }
      L = Math.max(SPLIT_RUN_M[0], L);
      // (sign: left of the branch's node order positive; drawn away from the split it runs with the way on)
      plans.set(b.k, { atStart: b.atStart, p: trunk.p, on, L, off0, need, s0, h, stuck, laneIn, laneHalf, sign: sides[j] * (b.atStart ? 1 : -1), fork: !!found.fork });
    });
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
  // (where the branch's middle stands off the axis here: its share's middle at the split, out as its width grows, the
  // seam between the branches held; older plans carry h alone)
  const off0 = plan.off0 ?? plan.h; const need1 = plan.need ?? plan.h;
  const need = off0 + (need1 - off0) * smooth(d / plan.L);
  // (what the branch's own line lacks of that, blended over SPLIT_ROUND_M where its own line takes over: exactly the
  // lack while it is more than a half blend short, nil once it is a half blend past, a parabola between (no corner).
  // The smooth maximum used first never reached nil: a branch on its own line stood 0.65 m off it, and fading that out
  // over the run's end pinched the lanes in and out (roads test level, 2026-11-25))
  const r = SPLIT_BLEND_M; const g = need - lat;
  const lack = g >= r ? g : g <= -r ? 0 : ((g + r) * (g + r)) / (4 * r);
  // (a branch that never gets apart within the run: faded out over its last part)
  const fade = plan.stuck ? 1 - smooth((d - 0.7 * plan.L) / (0.3 * plan.L)) : 1;
  return plan.sign * lack * fade;
}

/**
 * Where a split branch's lane lines go at (x, y), as a shift of their offsets (left of node order positive): at the split
 * its lanes are the trunk's slice (the trunk's edge strip on its outer side, none on the inner), so its lines move half
 * that strip toward the seam, back to its own layout over its run. Centred in the branch's share they stood half the
 * trunk's strip off the trunk's lines (1.2 m on a rural road's wide shoulder).
 */
export function splitLaneShiftAt(plan, x, y) {
  if (!plan || !(plan.laneIn > 0)) return 0;
  const d = fastHypot(x - plan.p[0], y - plan.p[1]);
  if (d >= plan.L) return 0;
  return -plan.sign * plan.laneIn * (1 - smooth(d / plan.L));
}

/**
 * A split branch's edge line offset at (x, y) (left of node order positive), from its normal one: at the split the inner
 * line on the seam and the outer on the outer edge of its slice of the trunk's lanes, blended back over its run.
 * Placed from its full width the edge lines started outside a narrower share (or a lane off the trunk's).
 */
export function splitEdgeLineAt(plan, x, y, offset) {
  if (!plan || !Number.isFinite(plan.laneHalf) || !Number.isFinite(plan.s0)) return offset;
  const d = fastHypot(x - plan.p[0], y - plan.p[1]);
  if (d >= plan.L) return offset;
  const inner = Math.sign(offset) === -plan.sign;
  const want = inner ? -plan.sign * plan.s0 : plan.sign * (2 * plan.laneHalf - plan.s0);
  return offset + (want - offset) * (1 - smooth(d / plan.L));
}

/** A split branch's half width at (x, y): its share of the trunk at the split, widened to its own over its run. */
export function splitHalfAt(plan, x, y, half) {
  if (!plan || !Number.isFinite(plan.s0) || plan.s0 >= half - 1e-6) return half;
  const d = fastHypot(x - plan.p[0], y - plan.p[1]);
  if (d >= plan.L) return half;
  return plan.s0 + (half - plan.s0) * smooth(d / plan.L);
}

/** A split trunk's half width at (x, y): its own, narrowed to its branches' together over its last stretch. */
export function splitTaperAt(taper, x, y, half) {
  if (!taper) return half;
  const d = fastHypot(x - taper.p[0], y - taper.p[1]);
  if (d >= taper.run) return half;
  return taper.target + (half - taper.target) * smooth(d / taper.run);
}

