// Roads where the export builds them: a way whose mapped line is off its carriageway's middle (placement tags,
// lanePlacement.js) moved by its shift, and a placement=transition way joined to its neighbours.
//
// placement=transition (https://wiki.openstreetmap.org/wiki/Tag:placement%3Dtransition): the short bit of way between
// two ways whose placements do not line up (a fork, a lane gained or dropped); its line runs across the lanes only to
// link the two, so its own angle and attributes no longer matter. Drawn on its line it was a diagonal stub across
// the lanes (thecoachtoma, Discord 2026-11-27). Here each end is carried to where its neighbour's drawn road is at that
// node, and its width to the neighbour's: the drawn piece runs on the carriageway from one neighbour into the other.
//
// The plain-geometry part (transitionPlans, transitionMoveAt) works in any metric x/y frame: the export calls it with
// world x/y, the painters (osmTexture, osmTerrainMaterials) through placeRoadFeatures with lat/lng.
import { placementShift, placementShiftAt } from './lanePlacement.js';

const fastHypot = (x, y) => Math.sqrt(x * x + y * y);

/** True when a way is tagged as a transition (placement, or either direction's placement). */
export const isTransition = (tags = {}) => ['placement', 'placement:forward', 'placement:backward'].some((k) => String(tags[k] ?? '').trim() === 'transition');

const cumOf = (xy) => { const c = [0]; for (let i = 1; i < xy.length; i++) c.push(c[i - 1] + fastHypot(xy[i][0] - xy[i - 1][0], xy[i][1] - xy[i - 1][1])); return c; };
const tangentAt = (xy, i) => {
  const a = xy[Math.max(0, i - 1)]; const b = xy[Math.min(xy.length - 1, i + 1)];
  const L = fastHypot(b[0] - a[0], b[1] - a[1]) || 1; return [(b[0] - a[0]) / L, (b[1] - a[1]) / L];
};

/**
 * ways: [{ xy: [[x, y], ...], shift (placementShift result or null), transition: bool, half }].
 * Returns Map(index -> plan) for each transition way: { xy, cum, d: [[dx, dy] at the start, at the end], h: [half at
 * the start, at the end], from: [neighbour index or -1, ...] }. tol: how close a neighbour's node must be to an end.
 */
export function transitionPlans(ways, { tol = 0.05 } = {}) {
  const plans = new Map();
  // (each way's nodes on a coarse grid, to find the ways through an end without a scan of every way)
  const cell = Math.max(1, tol * 20); const grid = new Map();
  const keyOf = (x, y) => `${Math.floor(x / cell)},${Math.floor(y / cell)}`;
  ways.forEach((w, j) => { if (!w?.xy) return; w.xy.forEach((p, v) => { const k = keyOf(p[0], p[1]); if (!grid.has(k)) grid.set(k, []); grid.get(k).push([j, v]); }); });
  const near = (x, y) => {
    const out = []; const cx = Math.floor(x / cell); const cy = Math.floor(y / cell);
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (const e of grid.get(`${cx + dx},${cy + dy}`) || []) out.push(e);
    return out;
  };
  ways.forEach((w, i) => {
    if (!w?.transition || !(w.xy?.length > 1)) return;
    const n = w.xy.length; const d = []; const h = []; const from = [];
    for (const atStart of [true, false]) {
      const p = atStart ? w.xy[0] : w.xy[n - 1]; const q = atStart ? w.xy[1] : w.xy[n - 2];
      const L = fastHypot(p[0] - q[0], p[1] - q[1]) || 1; const dir = [(p[0] - q[0]) / L, (p[1] - q[1]) / L];
      // (the neighbour the transition carries on: the way through this node running most nearly along it)
      let best = null;
      for (const [j, v] of near(p[0], p[1])) {
        if (j === i || ways[j]?.transition) continue;
        const o = ways[j].xy[v]; if (fastHypot(o[0] - p[0], o[1] - p[1]) > tol) continue;
        const t = tangentAt(ways[j].xy, v); const score = Math.abs(t[0] * dir[0] + t[1] * dir[1]);
        if (!best || score > best.score) best = { j, v, t, score };
      }
      if (!best) { d.push([0, 0]); h.push(w.half); from.push(-1); continue; }
      const nb = ways[best.j]; const c = cumOf(nb.xy);
      const m = nb.shift ? placementShiftAt(nb.shift, c[best.v] / (c[c.length - 1] || 1)) : 0;
      // (left of the neighbour's own direction, as the shift is measured)
      d.push([-best.t[1] * m, best.t[0] * m]); h.push(Number.isFinite(nb.half) ? nb.half : w.half); from.push(best.j);
    }
    plans.set(i, { xy: w.xy, cum: cumOf(w.xy), d, h, from });
  });
  return plans;
}

/** The move and half width at (x, y) on a transition: the two ends' blended by the share along the way. */
export function transitionMoveAt(plan, x, y) {
  let best = Infinity; let at = 0;
  for (let i = 0; i + 1 < plan.xy.length; i++) {
    const [ax, ay] = plan.xy[i]; const [bx, by] = plan.xy[i + 1]; const ex = bx - ax; const ey = by - ay; const L2 = ex * ex + ey * ey || 1;
    const t = Math.max(0, Math.min(1, ((x - ax) * ex + (y - ay) * ey) / L2)); const dd = fastHypot(ax + ex * t - x, ay + ey * t - y);
    if (dd < best) { best = dd; at = plan.cum[i] + t * Math.sqrt(L2); }
  }
  const s = at / (plan.cum[plan.cum.length - 1] || 1);
  return { dx: plan.d[0][0] + (plan.d[1][0] - plan.d[0][0]) * s, dy: plan.d[0][1] + (plan.d[1][1] - plan.d[0][1]) * s, half: plan.h[0] + (plan.h[1] - plan.h[0]) * s };
}

/**
 * Road features moved to where the export builds them (lat/lng in, lat/lng out; other features untouched).
 * crossSectionOf(feature) -> { drivingHalfWidth, carriagewayHalfWidth, leftExtra, rightExtra }. Moved transition
 * features carry builtHalfWidth: [start, end] (the neighbours' carriageway half widths).
 */
export function placeRoadFeatures(features, { crossSectionOf, leftHand = false } = {}) {
  const list = features || [];
  const roadIdx = []; const ways = [];
  let lat0 = null;
  for (const f of list) if (f?.type === 'road' && f.geometry?.length > 1) { lat0 = f.geometry[0].lat; break; }
  if (lat0 === null) return list;
  const ky = 111320; const kx = ky * Math.cos((lat0 * Math.PI) / 180);
  let any = false;
  list.forEach((f, i) => {
    if (f?.type !== 'road' || !(f.geometry?.length > 1)) return;
    const tags = f.tags || {};
    const placed = Object.keys(tags).some((k) => /^placement(:|$)/.test(k));
    const transition = placed && isTransition(tags);
    // (only roads near a placed one need their cross-section: a transition's neighbours; the rest are left as they are)
    roadIdx.push(i);
    ways.push({ f, xy: f.geometry.map((q) => [q.lng * kx, q.lat * ky]), placed, transition, shift: null, half: NaN });
    if (placed) any = true;
  });
  if (!any) return list;
  const csCache = new Map();
  const cs = (w) => { if (!csCache.has(w)) csCache.set(w, crossSectionOf(w.f)); return csCache.get(w); };
  for (const w of ways) {
    if (!w.placed || w.transition) continue;
    const c = cs(w);
    w.shift = placementShift(w.f.tags, { half: c.drivingHalfWidth, extraShift: (c.leftExtra - c.rightExtra) / 2, leftHand });
  }
  const anyTransition = ways.some((w) => w.transition);
  // (half widths: only needed for the ways a transition joins)
  const plans = anyTransition ? transitionPlans(ways.map((w) => ({ ...w, half: NaN })), { tol: 0.05 }) : new Map();
  for (const [i, p] of plans) {
    p.h = p.from.map((j) => (j >= 0 ? cs(ways[j]).carriagewayHalfWidth : cs(ways[i]).carriagewayHalfWidth));
  }
  const out = list.slice();
  ways.forEach((w, n) => {
    const i = roadIdx[n];
    const plan = plans.get(n);
    if (plan) {
      const c = cumOf(w.xy); const total = c[c.length - 1] || 1;
      const geometry = w.f.geometry.map((q, k) => {
        const s = c[k] / total; const dx = plan.d[0][0] + (plan.d[1][0] - plan.d[0][0]) * s; const dy = plan.d[0][1] + (plan.d[1][1] - plan.d[0][1]) * s;
        return { ...q, lat: q.lat + dy / ky, lng: q.lng + dx / kx };
      });
      out[i] = { ...w.f, geometry, builtHalfWidth: [plan.h[0], plan.h[1]] };
      return;
    }
    if (!w.shift) return;
    const xy = w.xy; const c = cumOf(xy); const total = c[c.length - 1] || 1;
    const geometry = w.f.geometry.map((q, k) => {
      const a = xy[Math.max(0, k - 1)]; const b = xy[Math.min(xy.length - 1, k + 1)]; const L = fastHypot(b[0] - a[0], b[1] - a[1]) || 1;
      const m = placementShiftAt(w.shift, c[k] / total);
      return { ...q, lat: q.lat + (((b[0] - a[0]) / L) * m) / ky, lng: q.lng - (((b[1] - a[1]) / L) * m) / kx };
    });
    out[i] = { ...w.f, geometry };
  });
  return out;
}
