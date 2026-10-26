// Road tunnels for BeamNG exports (refs/output/tunnel-plan.md): a bridge
// turned upside down. Where the bridge solver keeps a deck over the ground,
// this keeps the road under it: a profile between the two portals, held
// under the hill by the tube's height and some cover, no steeper than
// MAX_GRADE. The structure is what BeamNG's own levels and Road Architect
// (editor/roadArchitect/tunnelMesh.lua) do, as checked in game with the
// scratch/tunnelspike level:
//   - a tube (horseshoe lining, floor slab at road level) the road's
//     DecalRoads project onto (overObjects), sky light cut by Zone volumes
//   - terrain holes (layer 255) only at the portals, inside a deep headwall
//     that hides the jagged hole edge; the hill stays solid over the tube
//   - an approach cutting between wingwalls whose tops follow the hillside
//   - ceiling lights on all day (dayIntensity / nightIntensity, no `child`
//     link: a linked light is a night light, off all day)
//
// Pure: callers pass world-space geometry and ground lookups.

import * as THREE from 'three';
import { resample } from './beamngBridges.js';

export const STEP_M = 2;               // m between profile stations
export const MAX_GRADE = 0.06;         // tunnel road grade
export const MIN_COVER_M = 1.5;        // ground over the lining's crown for it to count as under ground
const MAX_FILL_M = 4;                  // cover made up with fill over the tube, at most ...
const NOTCH_M = 60;                    // ... but a dip this short (a gully the line crosses,
const NOTCH_FILL_M = 40;               // often just OSM a few m off a cliff face) is plugged this deep
const MAX_SHORT_SHARE = 0.4;           // more of the tube than this short of cover: not a tunnel here
export const MIN_TUBE_M = 20;          // a shorter bore is left on the ground
const SMOOTH_SIGMA_M = 15;             // vertical curves on the profile
const JOIN_M = 0.5;

// Cross-section (m): the road's carriageway + a walkway each side, walls,
// then an elliptical arch; the lining is LINING_M thick.
export const WALKWAY_M = 1;
export const WALL_M = 3.5;
export const LINING_M = 0.6;
const archRise = (W) => Math.min(5, Math.max(3.5, 0.7 * W));

// Portals
const HEAD_TOP_M = 10.5;               // headwall top over the road
const HEAD_BOTTOM_M = -1.5;
const HEAD_SIDE_M = 5;                 // headwall reaches this far past the lining
const BACKFILL_M = 8;                  // ground behind the headwall raised to its top this far in
const FACE_SLOPE = 4;                  // the rock cut back over / beside a headwall: 4 up per 1 back,
const FACE_REACH_M = 60;               // to the natural ground (a cliff over a portal)
const WING_GAP_M = 1.5;                // trench floor past the lining before the wingwall
const WING_BOTTOM_M = -1;
const WING_MIN_M = 0.4;                // a wingwall lower than this ends
const TRENCH_MAX_M = 160;              // the cutting is looked for this far out
const TRENCH_DONE_M = 0.25;            // the approach meets the ground again within this
const APPROACH_FIT_M = [4, 40];        // approach road samples a portal's height is fitted to
const APPROACH_MAX_GRADE = 0.25;

// Lights (wcusa ligtemitters_tunnels, castShadows off) and Zones
export const LIGHT_SPACING_M = 8;
export const LIGHT_THRESHOLD_SPACING_M = 4;
const THRESHOLD_M = 30;
export const TUNNEL_LIGHT_SHAPE = '/levels/west_coast_usa/art/shapes/objects/ceiling_light_tunnel.dae';
const ZONE_CHUNK_M = 40;
export const TUNNEL_AMBIENCE = 'Level_Tunnel_Closed_Dynamic';

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const r3 = (v) => Math.round(v * 1000) / 1000;

/** OSM tunnel ways that get a bored tunnel (the rest stay on the ground). */
export function isBoredTunnelTag(tags = {}) {
  const t = String(tags.tunnel ?? '').toLowerCase();
  return t === 'yes';
}

/**
 * Tunnel parts joined end to end into simple paths: [{ idx: [part index in
 * path order], flip: [bool], xy }] and the chains that branch (skipped).
 */
export function chainTunnelParts(parts) {
  const key = (p) => `${Math.round(p[0] / JOIN_M)},${Math.round(p[1] / JOIN_M)}`;
  const ends = new Map();
  parts.forEach((p, i) => {
    for (const [e, at] of [[p.xy[0], 0], [p.xy[p.xy.length - 1], 1]]) {
      const k = key(e);
      if (!ends.has(k)) ends.set(k, []);
      ends.get(k).push({ i, at });
    }
  });
  const used = new Set();
  const paths = [];
  const branched = [];
  const degree = (k) => ends.get(k)?.length ?? 0;
  for (let i = 0; i < parts.length; i++) {
    if (used.has(i)) continue;
    // the parts connected to i
    const group = [];
    const stack = [i];
    used.add(i);
    while (stack.length) {
      const j = stack.pop();
      group.push(j);
      for (const e of [parts[j].xy[0], parts[j].xy[parts[j].xy.length - 1]]) {
        for (const { i: n } of ends.get(key(e)) || []) if (!used.has(n)) { used.add(n); stack.push(n); }
      }
    }
    const keys = group.flatMap((j) => [key(parts[j].xy[0]), key(parts[j].xy[parts[j].xy.length - 1])]);
    if (keys.some((k) => degree(k) > 2)) { branched.push(group); continue; }
    // walk from an end of degree 1 (or anywhere on a loop)
    let startKey = keys.find((k) => degree(k) === 1) ?? keys[0];
    const idx = [];
    const flip = [];
    const xy = [];
    const left = new Set(group);
    let k = startKey;
    while (left.size) {
      const next = (ends.get(k) || []).find(({ i: n }) => left.has(n));
      if (!next) break;
      left.delete(next.i);
      const pts = next.at === 0 ? parts[next.i].xy : [...parts[next.i].xy].reverse();
      idx.push(next.i);
      flip.push(next.at === 1);
      xy.push(...(xy.length ? pts.slice(1) : pts));
      k = key(pts[pts.length - 1]);
    }
    if (left.size) { branched.push(group); continue; }
    paths.push({ idx, flip, xy });
  }
  return { paths, branched };
}

/** A portal's height from the approach road's ground (Theil-Sen, as the bridges do). */
export function fitApproachHeight(approach, groundAt) {
  if (!approach || approach.length < 2) return null;
  const samples = [];
  let s0 = 0;
  for (let i = 0; i + 1 < approach.length && s0 < APPROACH_FIT_M[1]; i++) {
    const L = Math.hypot(approach[i + 1][0] - approach[i][0], approach[i + 1][1] - approach[i][1]);
    for (let s = Math.ceil(Math.max(s0, APPROACH_FIT_M[0]) / 2) * 2; s <= Math.min(s0 + L, APPROACH_FIT_M[1]); s += 2) {
      const t = (s - s0) / (L || 1);
      samples.push([s, groundAt(approach[i][0] + (approach[i + 1][0] - approach[i][0]) * t, approach[i][1] + (approach[i + 1][1] - approach[i][1]) * t)]);
    }
    s0 += L;
  }
  if (samples.length < 4) return null;
  const slopes = [];
  for (let i = 0; i < samples.length; i++) {
    for (let j = i + 1; j < samples.length; j++) slopes.push((samples[j][1] - samples[i][1]) / (samples[j][0] - samples[i][0]));
  }
  const median = (v) => { const q = [...v].sort((m, n) => m - n); return q[q.length >> 1]; };
  const slope = clamp(median(slopes), -APPROACH_MAX_GRADE, APPROACH_MAX_GRADE);
  return median(samples.map(([d, z]) => z - slope * d));
}

// Gaussian smoothing of the deviation from the straight line between the
// ends (both ends stay put), odd-reflected past them.
function smoothPinned(z, step, sigmaM) {
  const n = z.length;
  if (n < 3) return z.slice();
  const line = (i) => z[0] + ((z[n - 1] - z[0]) * i) / (n - 1);
  const d = z.map((v, i) => v - line(i));
  const sig = sigmaM / step;
  const r = Math.max(1, Math.round(3 * sig));
  const at = (i) => {
    let sign = 1;
    while (i < 0 || i > n - 1) {
      if (i < 0) { i = -i; sign = -sign; }
      if (i > n - 1) { i = 2 * (n - 1) - i; sign = -sign; }
    }
    return sign * d[i];
  };
  const out = new Array(n);
  for (let i = 0; i < n; i++) {
    let acc = 0;
    let w = 0;
    for (let k = -r; k <= r; k++) {
      const g = Math.exp(-(k * k) / (2 * sig * sig));
      acc += g * at(i + k);
      w += g;
    }
    out[i] = line(i) + acc / w;
  }
  out[0] = z[0];
  out[n - 1] = z[n - 1];
  return out;
}

/** Stations along a polyline every `step` m: [{ x, y, s, tx, ty }]. */
function stations(xy, step = STEP_M) {
  const pts = resample(xy, step);
  let s = 0;
  return pts.map(([x, y], i) => {
    if (i) s += Math.hypot(x - pts[i - 1][0], y - pts[i - 1][1]);
    const a = pts[Math.max(0, i - 1)];
    const b = pts[Math.min(pts.length - 1, i + 1)];
    const L = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
    return { x, y, s, tx: (b[0] - a[0]) / L, ty: (b[1] - a[1]) / L };
  });
}

/**
 * Solve one tunnel path.
 *   path: { xy: [[x, y]...], half } (half: the drawn carriageway's half width)
 *   groundAt(x, y): ground height (before any tunnel edits)
 *   approaches: [startApproach, endApproach], each null or { xy: [[x, y]...]
 *     from the tunnel's end outwards, deckZ? (a bridge meets the portal: its
 *     height, and no cutting) }
 *   isFreeEnd(x, y): the path runs on past the map's edge there (no portal)
 * Returns a tunnel ({ ok: true, line, iS, iN, W, wall, arch, ... }) or
 * { ok: false, reason }.
 */
export function solveTunnel(path, { groundAt, approaches = [null, null], isFreeEnd = () => false, squareSize = 1 }) {
  const st = stations(path.xy);
  const n = st.length;
  const L = st[n - 1].s;
  if (L < MIN_TUBE_M) return { ok: false, reason: `short (${Math.round(L)} m)`, length: L };
  const W = path.half + WALKWAY_M;
  const arch = archRise(W);
  const crown = WALL_M + arch;                 // inner crown over the road
  const need = crown + LINING_M + MIN_COVER_M; // ground over the road for a bore
  const g = st.map((p) => groundAt(p.x, p.y));
  const free = [isFreeEnd(st[0].x, st[0].y), isFreeEnd(st[n - 1].x, st[n - 1].y)];
  const bridged = [0, 1].map((e) => Number.isFinite(approaches[e]?.deckZ));
  const endZ = [0, n - 1].map((i, e) => {
    const a = approaches[e];
    if (a && Number.isFinite(a.deckZ)) return a.deckZ;
    return fitApproachHeight(a?.xy, groundAt) ?? g[i];
  });

  // At a free end (the map's edge cuts the tunnel) the road's height is not
  // known: under the ground there, no steeper than MAX_GRADE from the other
  // end (the ground at the edge can be a cliff top over the bore).
  const fromOther = (e) => {
    const zo = endZ[1 - e];
    return clamp(g[e ? n - 1 : 0] - need, zo - MAX_GRADE * L, zo + MAX_GRADE * L);
  };
  if (free[0] && free[1]) { endZ[0] = g[0] - need; endZ[1] = g[n - 1] - need; }
  else if (free[0]) endZ[0] = fromOther(0);
  else if (free[1]) endZ[1] = fromOther(1);
  // No road climbs from one end to the other (mismatched OSM ends, or the
  // elevation data): left on the ground rather than a ramp inside the hill.
  const rise = Math.abs(endZ[1] - endZ[0]);
  if (rise > MAX_GRADE * 1.5 * L + 5) return { ok: false, reason: `ends ${Math.round(rise)} m apart in height over ${Math.round(L)} m`, length: L };
  // The straight grade between the portals, lowered under the hill where it
  // would come too close to the surface, as far as the grade allows.
  let z = st.map((p) => endZ[0] + ((endZ[1] - endZ[0]) * p.s) / (L || 1));
  z = z.map((v, i) => Math.min(v, g[i] - need));
  z[0] = endZ[0];
  z[n - 1] = endZ[1];
  for (let i = 1; i < n; i++) z[i] = Math.max(z[i], z[i - 1] - MAX_GRADE * (st[i].s - st[i - 1].s));
  for (let i = n - 2; i >= 0; i--) z[i] = Math.max(z[i], z[i + 1] - MAX_GRADE * (st[i + 1].s - st[i].s));
  z = smoothPinned(z, STEP_M, SMOOTH_SIGMA_M);

  // Portals: where the ground is first over the bore by the cover, from each
  // end (OSM ends often sit a little out on the approach); at a free end the
  // tube runs on to the map's edge. Where a bridge meets the tunnel the bore
  // runs out to it (out of a cliff face onto the bridge): the stretch with
  // thin cover there is left exposed, never filled.
  const covered = (i) => g[i] - z[i] >= need;
  const c0 = z.findIndex((_, i) => covered(i));
  const c1 = n - 1 - [...z].reverse().findIndex((_, k) => covered(n - 1 - k));
  if (c0 < 0 || c1 <= c0) return { ok: false, reason: 'not under ground in the elevation data', length: L };
  const iS = free[0] || bridged[0] ? 0 : c0;
  const iN = free[1] || bridged[1] ? n - 1 : c1;
  const tubeLength = st[iN].s - st[iS].s;
  if (st[c1].s - st[c0].s < MIN_TUBE_M) return { ok: false, reason: `bore only ${Math.round(st[c1].s - st[c0].s)} m under ground`, length: L };
  const exposed = [];
  if (bridged[0] && c0 > 0) exposed.push([st[0].s, st[c0].s]);
  if (bridged[1] && c1 < n - 1) exposed.push([st[c1].s, st[n - 1].s]);
  // dips: runs of the bore short of cover between its covered ends, each
  // filled over the tube
  let short = 0;
  let maxFill = 0;
  const dips = [];
  for (let i = c0; i <= c1; i++) {
    const lack = need - (g[i] - z[i]);
    if (lack <= 0) continue;
    short++;
    maxFill = Math.max(maxFill, lack);
    const last = dips[dips.length - 1];
    if (last && last.to === i - 1) { last.to = i; last.depth = Math.max(last.depth, lack); }
    else dips.push({ from: i, to: i, depth: lack });
  }
  for (const dip of dips) dip.length = st[dip.to].s - st[dip.from].s + STEP_M;
  const tooDeep = dips.find((dip) => dip.depth > MAX_FILL_M && (dip.length > NOTCH_M || dip.depth > NOTCH_FILL_M));
  // the profile, for diagnosing a tunnel left on the ground
  const profile = () => st.map((p, i) => ({ s: p.s, x: p.x, y: p.y, z: z[i], g: g[i] }));
  if (short / (c1 - c0 + 1) > MAX_SHORT_SHARE) return { ok: false, reason: 'mostly not under ground in the elevation data', length: L, profile: profile() };
  if (tooDeep) return { ok: false, reason: `needs ${tooDeep.depth.toFixed(1)} m of fill over it for ${Math.round(tooDeep.length)} m`, length: L, profile: profile() };

  // The line: approach cutting (from the outside in) + the path + the other
  // approach; z on the approaches eases from the portal height back to the
  // ground (cut or fill), no steeper than MAX_GRADE away from it.
  const line = st.map((p, i) => ({ ...p, z: z[i], g: g[i], kind: i < iS || i > iN ? 'cut' : 'tube' }));
  const extend = (e) => {
    const a = approaches[e];
    if (!a?.xy || a.xy.length < 2 || Number.isFinite(a.deckZ) || free[e]) return [];
    const ap = stations(a.xy).slice(1);
    const z0 = e === 0 ? z[0] : z[n - 1];
    const out = [];
    let calm = 0;
    for (const p of ap) {
      if (p.s > TRENCH_MAX_M) break;
      const gr = groundAt(p.x, p.y);
      const zz = clamp(gr, z0 - MAX_GRADE * p.s, z0 + MAX_GRADE * p.s);
      out.push({ x: p.x, y: p.y, s: p.s, tx: p.tx, ty: p.ty, z: zz, g: gr, kind: 'cut' });
      calm = Math.abs(gr - zz) < TRENCH_DONE_M ? calm + 1 : 0;
      if (calm * STEP_M >= 10) break;
    }
    return out;
  };
  const before = extend(0).reverse().map((p) => ({ ...p, tx: -p.tx, ty: -p.ty }));
  const after = extend(1);
  const all = [...before, ...line, ...after];
  // stations along the whole line, from the start of the first approach
  const s0 = before.length ? before[0].s : 0;
  all.forEach((p, k) => {
    if (k < before.length) p.s = s0 - p.s;
    else if (k < before.length + line.length) p.s = s0 + p.s;
    else p.s = s0 + L + p.s;
  });
  const off = before.length;
  const tunnel = {
    ok: true,
    line: all,
    iS: off + iS,
    iN: off + iN,
    // a portal (headwall) at each end but a free one; 'cut' portals have a
    // cutting, wingwalls and backfill, 'bridge' ones only the headwall
    portals: [!free[0], !free[1]],
    portalKind: [0, 1].map((e) => (free[e] ? 'edge' : bridged[e] ? 'bridge' : 'cut')),
    W, wall: WALL_M, arch, crown, need,
    length: L, tubeLength, fill: maxFill, short,
    dips: dips.map((dip) => ({ s: st[dip.from].s + s0, length: dip.length, depth: dip.depth })),
    exposed: exposed.map(([a, b]) => [a + s0, b + s0]),
    squareSize,
  };
  // headwall / wingwall / hole sizes follow the terrain grid: the step from
  // the cutting floor to the hillside sits inside a wall's thickness
  tunnel.headDepth = Math.max(3, 2.5 * squareSize);
  tunnel.stepAt = tunnel.headDepth / 2;
  tunnel.wingT = Math.max(1.5, 1.5 * squareSize);
  tunnel.wingD = W + LINING_M + WING_GAP_M;
  tunnel.headHalf = Math.max(W + LINING_M + HEAD_SIDE_M, tunnel.wingD + tunnel.wingT + 1);
  tunnel.wings = wingTops(tunnel, groundAt);
  return tunnel;
}

// Wingwall tops per line index and side (-1 left, +1 right): the hillside
// just behind the wall over the road, at most the headwall top, never rising
// away from the portal; a wall ends where it would be under WING_MIN_M.
function wingTops(t, groundAt) {
  const wings = { [-1]: new Map(), [1]: new Map() };
  const ends = [];
  if (t.portalKind[0] === 'cut') ends.push([t.iS, -1]);
  if (t.portalKind[1] === 'cut') ends.push([t.iN, 1]);
  for (const [i0, step] of ends) {
    for (const side of [-1, 1]) {
      let cap = HEAD_TOP_M;
      // from one station inside the headwall outwards
      for (let i = i0 - step; i >= 0 && i < t.line.length; i += step) {
        const p = t.line[i];
        const [x, y] = lateral(p, side * (t.wingD + t.wingT + 1));
        cap = Math.min(cap, groundAt(x, y) - p.z);
        if (cap < WING_MIN_M) break;
        wings[side].set(i, cap);
      }
    }
  }
  return wings;
}

/** A point `d` m to the right of travel (d < 0: left) of station p. */
export const lateral = (p, d) => [p.x + d * p.ty, p.y - d * p.tx];

/**
 * Nearest station on a tunnel's line: { i, s, d (+ right of travel), z, into }
 * (into: m past the nearer portal into the tube, < 0 outside), or null when
 * further than `reach`.
 */
export function nearestOnTunnel(t, x, y, reach = Infinity) {
  if (!t.index) t.index = indexLine(t.line);
  let best = null;
  for (const i of t.index.near(x, y, reach)) {
    const a = t.line[i];
    const b = t.line[i + 1];
    const ex = b.x - a.x;
    const ey = b.y - a.y;
    const L2 = ex * ex + ey * ey || 1e-9;
    const f = clamp(((x - a.x) * ex + (y - a.y) * ey) / L2, 0, 1);
    const px = a.x + ex * f;
    const py = a.y + ey * f;
    const d2 = (x - px) ** 2 + (y - py) ** 2;
    if (d2 > reach * reach || (best && d2 >= best.d2)) continue;
    const Ls = Math.sqrt(L2);
    const side = Math.sign((x - a.x) * (ey / Ls) - (y - a.y) * (ex / Ls)) || 1;
    // past either end of the line (not beside it)
    const along = ((x - a.x) * ex + (y - a.y) * ey) / Ls;
    const beyond = (i === 0 && along < -1e-6) || (i === t.line.length - 2 && along > Ls + 1e-6);
    best = { d2, i: f < 0.5 ? i : i + 1, s: a.s + (b.s - a.s) * f, d: side * Math.sqrt(d2), z: a.z + (b.z - a.z) * f, beyond };
  }
  if (!best) return null;
  const sS = t.portals[0] ? t.line[t.iS].s : -Infinity;
  const sN = t.portals[1] ? t.line[t.iN].s : Infinity;
  best.into = Math.min(best.s - sS, sN - best.s);
  if (best.s < t.line[t.iS].s - 1e-6 || best.s > t.line[t.iN].s + 1e-6) best.into = Math.min(best.into, -1e-6);
  return best;
}

function indexLine(line, cell = 16) {
  const cells = new Map();
  for (let i = 0; i + 1 < line.length; i++) {
    const x0 = Math.min(line[i].x, line[i + 1].x); const x1 = Math.max(line[i].x, line[i + 1].x);
    const y0 = Math.min(line[i].y, line[i + 1].y); const y1 = Math.max(line[i].y, line[i + 1].y);
    for (let cx = Math.floor(x0 / cell); cx <= Math.floor(x1 / cell); cx++) {
      for (let cy = Math.floor(y0 / cell); cy <= Math.floor(y1 / cell); cy++) {
        const k = `${cx},${cy}`;
        if (!cells.has(k)) cells.set(k, []);
        cells.get(k).push(i);
      }
    }
  }
  return {
    near(x, y, reach) {
      const r = Number.isFinite(reach) ? Math.ceil(reach / cell) : 1e9;
      if (r > 64) return line.slice(0, -1).map((_, i) => i);
      const out = new Set();
      for (let cx = Math.floor(x / cell) - r; cx <= Math.floor(x / cell) + r; cx++) {
        for (let cy = Math.floor(y / cell) - r; cy <= Math.floor(y / cell) + r; cy++) {
          for (const i of cells.get(`${cx},${cy}`) || []) out.add(i);
        }
      }
      return out;
    },
  };
}

const inExposed = (t, s) => (t.exposed || []).some(([a, b]) => s >= a - 1e-6 && s <= b + 1e-6);
const nearerPortalKind = (t, s) => (Math.abs(s - t.line[t.iS].s) <= Math.abs(t.line[t.iN].s - s) ? t.portalKind[0] : t.portalKind[1]);

/** Road height on a solved tunnel at (x, y). */
export function tunnelRoadZ(t, x, y) {
  return nearestOnTunnel(t, x, y)?.z ?? t.line[0].z;
}

/** The world box a tunnel's terrain edits can reach. */
export function tunnelReach(t) {
  const pad = t.headHalf + FACE_REACH_M + 4;
  let x0 = Infinity; let y0 = Infinity; let x1 = -Infinity; let y1 = -Infinity;
  for (const p of t.line) { x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y); x1 = Math.max(x1, p.x); y1 = Math.max(y1, p.y); }
  return [x0 - pad, y0 - pad, x1 + pad, y1 + pad];
}

/**
 * The terrain a tunnel wants at a grid point (world x, y, current height h):
 * the new height, or h. Cutting floor at road level between the wingwalls,
 * the hillside behind a wall down to its top then 1:1 slopes; behind a
 * headwall raised to its top; over the bore made up to the cover.
 */
export function tunnelGroundAt(t, x, y, h) {
  const n = nearestOnTunnel(t, x, y, t.headHalf + FACE_REACH_M);
  if (!n || n.beyond) return h;
  const ad = Math.abs(n.d);
  const p = t.line[n.i];
  if (n.into < t.stepAt) {
    // the cutting: its own stations, and the first metres inside a cutting's
    // portal (to the step in the headwall); inside a bridge's portal the
    // rock is cut back to the headwall's top
    if (n.into >= 0 && nearerPortalKind(t, n.s) === 'bridge') {
      return Math.min(h, n.z + HEAD_TOP_M + FACE_SLOPE * Math.max(0, ad - t.headHalf));
    }
    // (in front of a cutting's face even where the nearest station is the
    // portal's own)
    if (n.into < 0 ? p.kind !== 'cut' && nearerPortalKind(t, n.s) !== 'cut' : nearerPortalKind(t, n.s) !== 'cut') return h;
    const top = t.wings[Math.sign(n.d) || 1].get(n.i) ?? 0;
    if (ad <= t.wingD + t.wingT / 2) return n.z;
    const r = Math.max(0, ad - t.wingD - t.wingT);
    return clamp(h, n.z - r, n.z + top + r);
  }
  // Behind a headwall the ground meets its top: raised to it behind a
  // cutting's, and a cliff cut back to it, then rising FACE_SLOPE to 1 above
  // and beside it. (A cliff left standing at the face is a near-vertical
  // terrain square from the road to the cliff top: kept, it cuts through the
  // opening; opened, it is a slot up the cliff.)
  let out = h;
  const kind = nearerPortalKind(t, n.s);
  if (kind !== 'edge' && n.into <= FACE_REACH_M) {
    if (kind === 'cut' && n.into < t.headDepth + BACKFILL_M && ad <= t.headHalf + 1) out = Math.max(out, n.z + HEAD_TOP_M);
    out = Math.min(out, n.z + HEAD_TOP_M + FACE_SLOPE * (Math.max(0, n.into - t.headDepth) + Math.max(0, ad - t.headHalf)));
  }
  // over the bore: made up to the cover where the ground falls short (cut and
  // cover), 1:1 slopes down beside it; never over an exposed stretch
  if (inExposed(t, n.s)) return out;
  const outer = t.W + LINING_M;
  if (ad > outer + 2 + t.need) return out;
  return Math.max(out, n.z + t.need - Math.max(0, ad - outer - 2));
}

/**
 * Should the terrain square centred at (x, y) open (layer 255)? Only behind a
 * portal's face, inside the bore's outline, where the ground (lowest corner
 * `lo`) dips into the lining's envelope (Road Architect's rule), and never a
 * square rising over the headwall's top (highest corner `hi`): that would
 * open a slot in the hillside over it.
 */
export function tunnelHoleAt(t, x, y, lo, hi = lo) {
  const n = nearestOnTunnel(t, x, y, t.W + LINING_M + t.squareSize * 2);
  // in front of the face nothing opens (the road runs on the ground there),
  // but for a grid square at a bridge's portal (the deck carries the road)
  const front = nearerPortalKind(t, n?.s ?? 0) === 'bridge' ? -1.5 * t.squareSize : 0.3;
  if (!n || n.into < front || (n.into > t.headDepth + BACKFILL_M && !inExposed(t, n.s))) return false;
  if (Math.abs(n.d) > t.W + LINING_M + 0.5 * t.squareSize) return false;
  if (hi > n.z + HEAD_TOP_M + 0.5) return false;
  return lo < n.z + t.crown + LINING_M + 1;
}

/** Is (x, y, z..zTop) inside a tunnel's structure (tube, headwalls, wingwalls)? */
export function hitsTunnel(tunnels, x, y, z, zTop = z) {
  for (const t of tunnels) {
    if (!t.box) t.box = tunnelReach(t);
    if (x < t.box[0] || x > t.box[2] || y < t.box[1] || y > t.box[3]) continue;
    const n = nearestOnTunnel(t, x, y, t.headHalf + 1);
    if (!n) continue;
    const ad = Math.abs(n.d);
    const inTube = n.into >= -0.5 && ad <= t.W + LINING_M + 0.5;
    const inCut = n.into < 0 && t.line[n.i].kind === 'cut' && ad <= t.wingD + t.wingT + 0.5 && t.wings[Math.sign(n.d) || 1].has(n.i);
    const inHead = n.into >= -0.5 && n.into <= t.headDepth + 0.5 && ad <= t.headHalf + 0.5;
    if (!(inTube || inCut || inHead)) continue;
    if (zTop >= n.z - 1 && z <= n.z + (inHead ? HEAD_TOP_M : t.crown + LINING_M) + 0.5) return true;
  }
  return false;
}

// ── Geometry ────────────────────────────────────────────────────────────────

// One ring of the section, [u (right of travel), v (up)], closed by its
// floor / bottom edge.
function ring(a, b0, wall, rise, K = 16) {
  const out = [[-a, b0], [-a, wall]];
  for (let k = 1; k < K; k++) {
    const th = Math.PI - (Math.PI * k) / K;
    out.push([a * Math.cos(th), wall + rise * Math.sin(th)]);
  }
  out.push([a, wall], [a, b0]);
  return out;
}

// Triangles oriented toward want(centroid) (front faces, three.js winding).
function makeTris() {
  const pos = [];
  const uv = [];
  const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  return {
    pos,
    uv,
    tri(p, q, r, uvs, want) {
      const nrm = cross(sub(q, p), sub(r, p));
      const c = [(p[0] + q[0] + r[0]) / 3, (p[1] + q[1] + r[1]) / 3, (p[2] + q[2] + r[2]) / 3];
      const w = want(c);
      const flip = nrm[0] * w[0] + nrm[1] * w[1] + nrm[2] * w[2] < 0;
      (flip ? [p, r, q] : [p, q, r]).forEach((v) => pos.push(v[0], v[1], v[2]));
      (flip ? [uvs[0], uvs[2], uvs[1]] : uvs).forEach((v) => uv.push(v[0], v[1]));
    },
  };
}

export const TUBE_PIECE_M = 250;

/**
 * The tube in pieces of at most TUBE_PIECE_M (each its own object, culled on
 * its own): [{ pos, uv }] in world space. The lining's inner face, outer
 * skin, and end caps; the floor slab is the inner ring's bottom edge, at road
 * level, for the road decals to land on.
 */
export function buildTubeGeometry(t) {
  const inner = ring(t.W, 0, t.wall, t.arch);
  const outer = ring(t.W + LINING_M, -LINING_M, t.wall, t.arch + LINING_M);
  const at = (p, [u, v]) => [p.x + u * p.ty, p.y - u * p.tx, p.z + v];
  const arc = (loop) => {
    const a = [0];
    for (let k = 1; k <= loop.length; k++) {
      const q = loop[k % loop.length];
      const o = loop[k - 1];
      a.push(a[k - 1] + Math.hypot(q[0] - o[0], q[1] - o[1]));
    }
    return a;
  };
  const pieces = [];
  let i0 = t.iS;
  while (i0 < t.iN) {
    let i1 = i0;
    while (i1 < t.iN && t.line[i1 + 1].s - t.line[i0].s <= TUBE_PIECE_M) i1++;
    if (i1 === i0) i1 = i0 + 1;
    // a short last piece joins this one
    if (t.line[t.iN].s - t.line[i1].s < TUBE_PIECE_M / 4) i1 = t.iN;
    const T = makeTris();
    for (const [loop, outward] of [[inner, false], [outer, true]]) {
      const al = arc(loop);
      for (let i = i0; i < i1; i++) {
        const p = t.line[i];
        const q = t.line[i + 1];
        const o = [p.x, p.y, p.z + t.wall / 2];
        const want = (c) => {
          const w = [c[0] - o[0], c[1] - o[1], c[2] - o[2]];
          return outward ? w : w.map((v) => -v);
        };
        for (let k = 0; k < loop.length; k++) {
          const k2 = (k + 1) % loop.length;
          const a = at(p, loop[k]); const b = at(p, loop[k2]); const c = at(q, loop[k]); const d = at(q, loop[k2]);
          const U = [al[k] / 4, al[k + 1] / 4];
          const V = [p.s / 4, q.s / 4];
          T.tri(a, b, c, [[U[0], V[0]], [U[1], V[0]], [U[0], V[1]]], want);
          T.tri(b, d, c, [[U[1], V[0]], [U[1], V[1]], [U[0], V[1]]], want);
        }
      }
    }
    // caps only at the tunnel's own ends (pieces meet flush)
    for (const [i, sgn] of [[i0, -1], [i1, 1]]) {
      if (i !== t.iS && i !== t.iN) continue;
      const p = t.line[i];
      const want = () => [sgn * p.tx, sgn * p.ty, 0];
      for (let k = 0; k < inner.length; k++) {
        const k2 = (k + 1) % inner.length;
        const a = at(p, inner[k]); const b = at(p, inner[k2]); const c = at(p, outer[k]); const d = at(p, outer[k2]);
        T.tri(a, b, c, [[0, 0], [1, 0], [0, 1]], want);
        T.tri(b, d, c, [[1, 0], [1, 1], [0, 1]], want);
      }
    }
    pieces.push({ pos: T.pos, uv: T.uv, from: t.line[i0].s, to: t.line[i1].s });
    i0 = i1;
  }
  return pieces;
}

/**
 * One portal ('S' at the line's start side, 'N' at its end): a deep headwall
 * across the opening (the lining's outer section cut out) and a wingwall each
 * side of the cutting, its top following t.wings. { pos, uv } in world space.
 */
export function buildPortalGeometry(t, end) {
  const i = end === 'S' ? t.iS : t.iN;
  const p = t.line[i];
  const tin = end === 'S' ? [p.tx, p.ty] : [-p.tx, -p.ty];   // into the tunnel
  const Lv = [-tin[1], tin[0]];                              // left of "into": a proper rotation
  const outer = ring(t.W + LINING_M, -LINING_M, t.wall, t.arch + LINING_M);
  const shape = new THREE.Shape();
  shape.moveTo(-t.headHalf, HEAD_BOTTOM_M);
  shape.lineTo(t.headHalf, HEAD_BOTTOM_M);
  shape.lineTo(t.headHalf, HEAD_TOP_M);
  shape.lineTo(-t.headHalf, HEAD_TOP_M);
  shape.closePath();
  const hole = new THREE.Path();
  outer.forEach(([u, v], k) => (k ? hole.lineTo(u, Math.max(v, 0)) : hole.moveTo(u, Math.max(v, 0))));
  hole.closePath();
  shape.holes.push(hole);
  const g = new THREE.ExtrudeGeometry(shape, { depth: t.headDepth, bevelEnabled: false });
  const P = g.getAttribute('position');
  const pos = [];
  const uv = [];
  for (let k = 0; k < P.count; k++) {
    const u = P.getX(k); const v = P.getY(k); const w = P.getZ(k);
    pos.push(p.x + u * Lv[0] + w * tin[0], p.y + u * Lv[1] + w * tin[1], p.z + v);
    uv.push(u / 4, v / 4);
  }
  g.dispose();
  const T = makeTris();
  const step = end === 'S' ? -1 : 1;   // line index step away from the portal
  for (const side of t.portalKind[end === 'S' ? 0 : 1] === 'cut' ? [-1, 1] : []) {
    const run = [i - step];
    for (let k = i; t.wings[side].has(k) || k === i; k += step) {
      if (k < 0 || k >= t.line.length) break;
      run.push(k);
    }
    if (run.length < 2) continue;
    const top = (k) => t.wings[side].get(k) ?? t.wings[side].get(i - step) ?? HEAD_TOP_M;
    const corner = (k, d, v) => { const q = t.line[k]; const [x, y] = lateral(q, side * d); return [x, y, q.z + v]; };
    const sec = (k) => [corner(k, t.wingD, WING_BOTTOM_M), corner(k, t.wingD, top(k)), corner(k, t.wingD + t.wingT, top(k)), corner(k, t.wingD + t.wingT, WING_BOTTOM_M)];
    const centre = (k) => { const q = t.line[k]; const [x, y] = lateral(q, side * (t.wingD + t.wingT / 2)); return [x, y, q.z + top(k) / 2]; };
    for (let r = 0; r + 1 < run.length; r++) {
      const A = sec(run[r]); const B = sec(run[r + 1]); const o = centre(run[r]);
      const want = (c) => [c[0] - o[0], c[1] - o[1], c[2] - o[2]];
      for (let f = 0; f < 3; f++) {   // inner face, top, outer face
        const a = A[f]; const b = A[f + 1]; const c = B[f]; const d = B[f + 1];
        const Lu = Math.hypot(c[0] - a[0], c[1] - a[1]) / 4;
        const Hv = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]) / 4;
        T.tri(a, b, c, [[0, 0], [0, Hv], [Lu, 0]], want);
        T.tri(b, d, c, [[0, Hv], [Lu, Hv], [Lu, 0]], want);
      }
    }
    const Z = sec(run[run.length - 1]);
    const q = t.line[run[run.length - 1]];
    const out = [step * q.tx, step * q.ty, 0];
    T.tri(Z[0], Z[1], Z[2], [[0, 0], [0, 1], [1, 1]], () => out);
    T.tri(Z[0], Z[2], Z[3], [[0, 0], [1, 1], [1, 0]], () => out);
  }
  return { pos: pos.concat(T.pos), uv: uv.concat(T.uv) };
}

// ── Scene objects ───────────────────────────────────────────────────────────

// Torque matrices are written column by column (local X, Y, Z); a yaw puts
// local Y at (-sin yaw, cos yaw), as rotationMatrixFromYaw.
const yawTo = (dx, dy) => Math.atan2(-dx, dy);
const rot = (yaw) => { const c = r3(Math.cos(yaw)); const s = r3(Math.sin(yaw)); return [c, s, 0, -s, c, 0, 0, 0, 1]; };
const DOWN = [1, 0, 0, 0, 0, -1, 0, 1, 0];   // local Y down (wcusa tunnel lights)

const TUNNEL_LIGHT = {
  class: 'SpotLight',
  color: [0.996, 0.792, 0.639, 1],
  intensity: 45000,
  intensityUnit: 'cd',
  dayIntensity: '45000',
  nightIntensity: '1500',
  innerAngle: 25,
  outerAngle: 170,
  range: 15,
  castShadows: false,
  flareScale: 0,
};

/** Ceiling light stations: every LIGHT_SPACING_M, denser near the portals. */
export function lightStations(t, spacing = LIGHT_SPACING_M) {
  const out = [];
  let next = t.line[t.iS].s + 3;
  for (let i = t.iS; i <= t.iN; i++) {
    const p = t.line[i];
    if (p.s < next) continue;
    const sS = t.portals[0] ? t.line[t.iS].s : -Infinity;
    const sN = t.portals[1] ? t.line[t.iN].s : Infinity;
    const into = Math.min(p.s - sS, sN - p.s);
    next = p.s + (into < THRESHOLD_M ? Math.min(spacing, LIGHT_THRESHOLD_SPACING_M) : spacing);
    out.push(i);
  }
  return out;
}

/**
 * Lights, fixtures, Zones / Portals and the ambience for one tunnel, as level
 * objects under `group` (SimGroup name); `id()` makes persistentIds.
 */
export function buildTunnelObjects(t, group, id, { lightSpacing = LIGHT_SPACING_M } = {}) {
  const lights = [];
  lightStations(t, lightSpacing).forEach((i, k) => {
    const p = t.line[i];
    const z = p.z + t.crown - 0.05;
    const name = `${group}_light_${String(k + 1).padStart(3, '0')}`;
    lights.push(
      { ...TUNNEL_LIGHT, name, persistentId: id(), __parent: `${group}_lights`, position: [r3(p.x), r3(p.y), r3(z - 0.25)], rotationMatrix: DOWN },
      {
        class: 'TSStatic', name: `${name}_fixture`, persistentId: id(), __parent: `${group}_lights`,
        position: [r3(p.x), r3(p.y), r3(z)], rotationMatrix: rot(yawTo(p.tx, p.ty)),
        shapeName: TUNNEL_LIGHT_SHAPE, collisionType: 'None', decalType: 'None', useInstanceRenderData: true,
      },
    );
  });
  // Zones: chord boxes about ZONE_CHUNK_M long; a Portal at each opening and
  // every joint (Portal local Y along the tunnel, as wcusa's)
  const zones = [];
  const cuts = [t.iS];
  for (let i = t.iS; i <= t.iN; i++) if (t.line[i].s - t.line[cuts[cuts.length - 1]].s >= ZONE_CHUNK_M) cuts.push(i);
  if (cuts.length > 1 && t.line[t.iN].s - t.line[cuts[cuts.length - 1]].s < ZONE_CHUNK_M / 3) cuts.pop();
  if (cuts[cuts.length - 1] !== t.iN) cuts.push(t.iN);
  const height = t.crown + LINING_M;
  for (let c = 0; c + 1 < cuts.length; c++) {
    const a = t.line[cuts[c]];
    const b = t.line[cuts[c + 1]];
    const dx = b.x - a.x; const dy = b.y - a.y; const Lc = Math.hypot(dx, dy) || 1;
    // the chord misses the bend's outside by its sagitta
    let sag = 0;
    for (let i = cuts[c]; i <= cuts[c + 1]; i++) {
      const q = t.line[i];
      sag = Math.max(sag, Math.abs((q.x - a.x) * (dy / Lc) - (q.y - a.y) * (dx / Lc)));
    }
    const box = {
      position: [r3((a.x + b.x) / 2), r3((a.y + b.y) / 2), r3((a.z + b.z) / 2 + height / 2)],
      rotationMatrix: rot(yawTo(dx / Lc, dy / Lc)),
      scale: [r3(2 * t.W + 3 + 2 * sag), r3(Lc + 1), r3(height + Math.abs(b.z - a.z) + 1.5)],
    };
    zones.push(
      { class: 'Zone', name: `${group}_zone_${c + 1}`, persistentId: id(), __parent: `${group}_zones`, ...box, ambientLightColor: [0, 0, 0, 1], skyLightFactor: 0.05, useAmbientLightColor: true },
      { class: 'SFXSpace', name: `${group}_audio_${c + 1}`, persistentId: id(), __parent: `${group}_zones`, ...box, soundAmbience: TUNNEL_AMBIENCE },
    );
  }
  cuts.forEach((ci, c) => {
    const p = t.line[ci];
    zones.push({
      class: 'Portal', name: `${group}_portal_${c + 1}`, persistentId: id(), __parent: `${group}_zones`,
      position: [r3(p.x), r3(p.y), r3(p.z + height / 2)], rotationMatrix: rot(yawTo(p.tx, p.ty)),
      scale: [r3(2 * t.W + 2), 6, r3(height + 1)],
    });
  });
  return { lights, zones, lightCount: lights.length / 2, zoneCount: cuts.length - 1, portalCount: cuts.length };
}
