// Curve warning signs from the road's own geometry (no OSM tags needed): an
// advance warning before sharp curves on rural roads, and chevron boards
// along the outside of the sharpest, after the MUTCD's horizontal alignment
// signs (W1-2 curve, W1-4 reverse curve, W1-5 winding road, W1-8 chevrons).
//
// North America uses Utah's ut_roadsigns (beamngPropLibrary.js
// US_SIGN_SHAPES), everywhere else the Vienna-convention bend / double bend
// signs and arrow boards that load in any level.
// Pure: callers pass world-space carriageways and lookups.

import { US_SIGN_SHAPES } from './beamngPropLibrary.js';
import { parseSignedSpeed } from './roadSigns.js';

const IT = '/art/shapes/garage_and_dealership/Clutter/italy_traf_sign_';
export const CURVE_SIGN_SETS = {
  americas: {
    curveLeft: US_SIGN_SHAPES.curveLeft.shapeFile, curveRight: US_SIGN_SHAPES.curveRight.shapeFile,
    reverseLeft: US_SIGN_SHAPES.reverseCurveLeft.shapeFile, reverseRight: US_SIGN_SHAPES.reverseCurveRight.shapeFile,
    windingLeft: US_SIGN_SHAPES.windingLeft.shapeFile, windingRight: US_SIGN_SHAPES.windingRight.shapeFile,
    chevronLeft: US_SIGN_SHAPES.chevronLeft.shapeFile, chevronRight: US_SIGN_SHAPES.chevronRight.shapeFile,
  },
  white: {
    curveLeft: `${IT}warn_bend_l.dae`, curveRight: `${IT}warn_bend_r.dae`,
    reverseLeft: `${IT}warn_doublebend_l.dae`, reverseRight: `${IT}warn_doublebend_r.dae`,
    windingLeft: `${IT}warn_doublebend_l.dae`, windingRight: `${IT}warn_doublebend_r.dae`,
    chevronLeft: `${IT}arrow_left.dae`, chevronRight: `${IT}arrow_right.dae`,
  },
};

// Rural roads: residential streets and the like curve gently at low speeds.
const CURVE_CLASSES = new Set(['trunk', 'primary', 'secondary', 'tertiary', 'unclassified']);
const SLOW_LIMIT = { mph: 25, 'km/h': 40 };   // at or under this mapped limit: no warnings
const HEADING_SMOOTH_M = 6;      // heading averaged over ± this
const CURVATURE_SPAN_M = 10;     // curvature over ± this
const IN_CURVE_RADIUS_M = 250;   // tighter than this: part of a curve
const WARN_RADIUS_M = 150;       // a curve this tight (at its tightest) ...
const WARN_TURN_DEG = 35;        // ... turning this much gets a warning
const CHEVRON_RADIUS_M = 60;     // tighter than this: chevrons along its outside
const MERGE_GAP_M = 8;           // same-way curve pieces this close are one curve
const REVERSE_GAP_M = 183;       // the next opposite curve within 600 ft: reverse curve
const ADVANCE_M = 50;            // warning this far before the first curve
const MIN_ADVANCE_M = 15;
const KERB_M = 1.5;
const MAX_CHEVRONS = 8;

const norm = (v) => String(v ?? '').trim().toLowerCase();
const isOneWay = (tags = {}) => ['yes', '1', 'true', '-1', 'reverse'].includes(norm(tags.oneway)) || tags.junction === 'roundabout';
const travelSign = (tags = {}) => (['-1', 'reverse'].includes(norm(tags.oneway)) ? -1 : 1);

// The curves along one polyline: [{ s0, s1, turn (rad, + = left along node order), radius }].
export function findCurves(nodes) {
  const n = nodes.length;
  if (n < 5) return [];
  const s = [0];
  for (let i = 1; i < n; i++) s.push(s[i - 1] + Math.hypot(nodes[i][0] - nodes[i - 1][0], nodes[i][1] - nodes[i - 1][1]));
  // segment headings, unwrapped, at the segment midpoints
  const h = []; const hs = [];
  for (let i = 0; i + 1 < n; i++) {
    let a = Math.atan2(nodes[i + 1][1] - nodes[i][1], nodes[i + 1][0] - nodes[i][0]);
    if (h.length) { while (a - h[h.length - 1] > Math.PI) a -= 2 * Math.PI; while (a - h[h.length - 1] < -Math.PI) a += 2 * Math.PI; }
    h.push(a); hs.push((s[i] + s[i + 1]) / 2);
  }
  const window = (arr, at, span) => {
    let lo = at; let hi = at;
    while (lo > 0 && hs[at] - hs[lo - 1] <= span) lo--;
    while (hi + 1 < arr.length && hs[hi + 1] - hs[at] <= span) hi++;
    return [lo, hi];
  };
  const smooth = h.map((_, i) => { const [lo, hi] = window(h, i, HEADING_SMOOTH_M); let t = 0; for (let k = lo; k <= hi; k++) t += h[k]; return t / (hi - lo + 1); });
  const kappa = smooth.map((_, i) => { const [lo, hi] = window(smooth, i, CURVATURE_SPAN_M); return hi > lo ? (smooth[hi] - smooth[lo]) / (hs[hi] - hs[lo]) : 0; });
  // runs of one turning direction tighter than IN_CURVE_RADIUS_M
  const runs = [];
  for (let i = 0; i < kappa.length; i++) {
    const sign = Math.abs(kappa[i]) >= 1 / IN_CURVE_RADIUS_M ? Math.sign(kappa[i]) : 0;
    if (!sign) continue;
    const last = runs[runs.length - 1];
    if (last && last.sign === sign && hs[i] - last.s1 <= MERGE_GAP_M) { last.i1 = i; last.s1 = hs[i]; } else runs.push({ sign, i0: i, i1: i, s0: hs[i], s1: hs[i] });
  }
  return runs.map((r) => {
    let kmax = 0;
    for (let i = r.i0; i <= r.i1; i++) kmax = Math.max(kmax, Math.abs(kappa[i]));
    return { s0: r.s0, s1: r.s1, turn: smooth[r.i1] - smooth[r.i0], radius: kmax > 0 ? 1 / kmax : Infinity };
  }).filter((c) => c.radius <= WARN_RADIUS_M && Math.abs(c.turn) >= (WARN_TURN_DEG * Math.PI) / 180);
}

// Point and unit tangent (along node order) at arc length `at`.
function pointAt(nodes, at) {
  let s = 0;
  for (let i = 0; i + 1 < nodes.length; i++) {
    const a = nodes[i]; const b = nodes[i + 1];
    const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (s + L >= at || i + 2 === nodes.length) {
      const f = L > 0 ? Math.max(0, Math.min(1, (at - s) / L)) : 0;
      return { x: a[0] + (b[0] - a[0]) * f, y: a[1] + (b[1] - a[1]) * f, t: L > 0 ? [(b[0] - a[0]) / L, (b[1] - a[1]) / L] : [1, 0] };
    }
    s += L;
  }
  return null;
}

// Join a road's drawn pieces back into whole runs, so a curve across a piece
// boundary is seen whole: the 250-node pieces of one OSM way (same owner), and
// ways that plainly continue each other (two meeting end to end with nothing
// else there: cw.continuations), a two-way one turned round if need be.
function joinPieces(carriageways) {
  const NEAR = 0.5;
  const runs = carriageways.filter((cw) => cw.nodes?.length > 1).map((cw) => ({
    ...cw, nodes: [...cw.nodes], owners: new Set([cw.owner]), continuations: new Set(cw.continuations || []), alive: true,
  }));
  const key = (p) => `${Math.round(p[0] / NEAR)},${Math.round(p[1] / NEAR)}`;
  const ends = new Map();   // endpoint cell -> runs ending or starting there (checked on use)
  const index = (r) => {
    for (const p of [r.nodes[0], r.nodes[r.nodes.length - 1]]) {
      const k = key(p);
      if (!ends.has(k)) ends.set(k, []);
      ends.get(k).push(r);
    }
  };
  runs.forEach(index);
  const near = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]) < NEAR;
  const continues = (a, b) => [...b.owners].some((o) => a.owners.has(o) || a.continuations.has(o));
  for (const a of runs) {
    let grown = true;
    while (a.alive && grown) {
      grown = false;
      const tail = a.nodes[a.nodes.length - 1];
      const cands = (ends.get(key(tail)) || []).filter((b) => b !== a && b.alive && b.highway === a.highway && continues(a, b));
      const onward = cands.filter((b) => near(b.nodes[0], tail) || (!isOneWay(a.tags) && !isOneWay(b.tags) && near(b.nodes[b.nodes.length - 1], tail)));
      if (onward.length !== 1) continue;
      const b = onward[0];
      const nodes = near(b.nodes[0], tail) ? b.nodes : [...b.nodes].reverse();
      a.nodes = [...a.nodes, ...nodes.slice(1)];
      for (const o of b.owners) a.owners.add(o);
      for (const o of b.continuations) a.continuations.add(o);
      b.alive = false;
      index(a);
      grown = true;
    }
  }
  return runs.filter((r) => r.alive);
}

/**
 * Warning signs and chevrons for every carriageway: { props: [{ kind, shape,
 * position, yaw }], counts }. A prop's yaw faces its sign at the traffic
 * it warns (rotationMatrixFromYaw, sign face local -Y).
 */
export function placeCurveWarnings({ carriageways = [], heightAt, isBlocked = () => false, style = 'americas', leftHandTraffic = false }) {
  const set = CURVE_SIGN_SETS[style] ?? CURVE_SIGN_SETS.white;
  const props = [];
  const counts = {};
  const taken = new Set();
  const put = (kind, x, y, d, sideVec, offset) => {
    for (let shift = 0; shift <= 2; shift += 0.5) {
      const px = x + sideVec[0] * (offset + shift);
      const py = y + sideVec[1] * (offset + shift);
      const key = `${Math.round(px / 3)},${Math.round(py / 3)}`;
      if (taken.has(key) || isBlocked(px, py)) continue;
      taken.add(key);
      props.push({ kind, shape: set[kind], position: [px, py, heightAt(px, py)], yaw: Math.atan2(-d[0], d[1]) });
      counts[kind] = (counts[kind] || 0) + 1;
      return true;
    }
    return false;
  };

  for (const cw of joinPieces(carriageways)) {
    if (!CURVE_CLASSES.has(String(cw.highway ?? cw.tags?.highway ?? '')) || !(cw.nodes?.length > 4)) continue;
    const limit = parseSignedSpeed(cw.tags?.maxspeed);
    if (limit && limit.value <= (SLOW_LIMIT[limit.unit] ?? 0)) continue;
    const curves = findCurves(cw.nodes);
    if (!curves.length) continue;
    const length = curves.length ? cw.nodes.reduce((L, p, i) => (i ? L + Math.hypot(p[0] - cw.nodes[i - 1][0], p[1] - cw.nodes[i - 1][1]) : 0), 0) : 0;
    const dirs = isOneWay(cw.tags) ? [travelSign(cw.tags)] : [1, -1];
    for (const dir of dirs) {
      // curves in travel order, in travel coordinates (u from the start of travel)
      const seq = (dir > 0 ? curves : [...curves].reverse()).map((c) => ({
        u0: dir > 0 ? c.s0 : length - c.s1, u1: dir > 0 ? c.s1 : length - c.s0,
        left: c.turn * dir > 0, radius: c.radius,
      }));
      const toS = (u) => (dir > 0 ? u : length - u);
      for (let g = 0; g < seq.length;) {
        // a group: opposite curves, each within REVERSE_GAP_M of the last
        let e = g;
        while (e + 1 < seq.length && seq[e + 1].left !== seq[e].left && seq[e + 1].u0 - seq[e].u1 <= REVERSE_GAP_M) e++;
        const first = seq[g];
        const n = e - g + 1;
        const kind = `${n === 1 ? 'curve' : n === 2 ? 'reverse' : 'winding'}${first.left ? 'Left' : 'Right'}`;
        const u = first.u0 - ADVANCE_M;
        const uSign = u >= 3 ? u : (first.u0 - 3 >= MIN_ADVANCE_M ? 3 : null);
        if (uSign !== null) {
          const at = pointAt(cw.nodes, toS(uSign));
          if (at) {
            const d = [at.t[0] * dir, at.t[1] * dir];
            const right = [d[1], -d[0]];
            const kerb = leftHandTraffic ? [-right[0], -right[1]] : right;
            put(kind, at.x, at.y, d, kerb, cw.half + KERB_M);
          }
        }
        // chevrons along the outside of each sharp curve of the group
        for (let k = g; k <= e; k++) {
          const c = seq[k];
          if (c.radius > CHEVRON_RADIUS_M) continue;
          const step = Math.max(12, c.radius * 0.5);
          const count = Math.min(MAX_CHEVRONS, Math.max(3, Math.floor((c.u1 - c.u0) / step) + 1));
          for (let j = 0; j < count; j++) {
            const uc = c.u0 + ((c.u1 - c.u0) * (j + 0.5)) / count + (dir > 0 ? 0 : 1);
            const at = pointAt(cw.nodes, toS(uc));
            if (!at) continue;
            const d = [at.t[0] * dir, at.t[1] * dir];
            const right = [d[1], -d[0]];
            // outside of a left curve is on the right of travel, and vice versa
            const outside = c.left ? right : [-right[0], -right[1]];
            put(c.left ? 'chevronLeft' : 'chevronRight', at.x, at.y, d, outside, cw.half + KERB_M);
          }
        }
        g = e + 1;
      }
    }
  }
  return { props, counts };
}
