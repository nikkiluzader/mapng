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
const HEAD_TOP_M = 10.5;               // headwall top over the road (bored)
const HEAD_BOTTOM_M = -1.5;
const HEAD_SIDE_M = 5;                 // headwall reaches this far past the lining
const BACKFILL_M = 8;                  // ground behind the headwall raised to its top this far in
const FACE_SLOPE = 4;                  // the rock cut back over / beside a headwall: 4 up per 1 back,
const FACE_REACH_M = 60;               // to the natural ground (a cliff over a portal)
const WING_GAP_M = 1.5;                // trench floor past the lining before the wingwall
const WING_BOTTOM_M = -1;
const WING_MIN_M = 0.4;                // a wingwall lower than this ends
const TRENCH_MAX_M = 400;              // the cutting / fill runs out at most this far (bored)
const APPROACH_LAND_GRADE = 0.12;      // an approach still off the ground there lands at this grade
const UNDER_BRIDGE_M = 6.5;            // an approach under a bridge stays this far under the ground there ...
const UNDER_BRIDGE_FLAT_M = 10;        // ... this far either side of it

// Gallery windows: where a bore runs this close behind a cliff face (the
// open air at the window's sill this far past the lining), openings in its
// wall look out through a short passage to the face (Zion–Mount Carmel's
// galleries onto Pine Creek canyon). OSM does not map them; the elevation
// shows where the rock is thin enough.
const WINDOW_ROCK_M = 12;              // rock between the lining and the open air, at most
const WINDOW_SPACING_M = 70;           // windows at least this far apart
const WINDOW_END_CLEAR_M = 40;         // ... and this far inside the portals
const WINDOW_VIEW_M = 6;               // the ground stays under the sill this far past the face
const WINDOW_PLATE_SIDE_M = 1.5;       // face plate past the opening each side ...
const WINDOW_PLATE_OVER_M = 1.5;       // ... and over it
const WINDOW_PLATE_UNDER_M = 1.5;      // ... and under its sill
const WINDOW_LEDGE_M = 3;              // the ground in front kept under the sill this far out (lowered only)
const WINDOW_CURB_M = 0.2;             // a gallery's step up from the road
// Two kinds: small windows (an opening in the wall, its sill over the
// parapet height, a short passage out), and one walk-in gallery, the one
// nearest a portal: floor at the road, an arched opening, a low wall at the
// face (Zion–Mount Carmel's big gallery near its west portal).
const WINDOW_KINDS = {
  window: { segments: 2, floor: 1.2, sill: 1.2, spring: 3, rise: 0 },
  gallery: { segments: 4, floor: 0, sill: 1, rise: 1.8 },   // spring: the tube's wall height
};
// the point at arc length u along stations
const stationXY = (st, u) => {
  let best = st[0];
  for (const q of st) if (Math.abs(q.s - u) < Math.abs(best.s - u)) best = q;
  return [best.x, best.y];
};

// Cut-and-cover: a tunnel OSM maps under flat ground (a city deck park, an
// underpass) is a box sunk below the street, its approaches in a trench.
// Elevation data shows no trench (Deck Park, Phoenix: flat at street level).
const CC_WALL_M = 5;                   // box walls ...
const CC_ARCH_M = 0.8;                 // ... and a shallow vault
const CC_COVER_M = 0.8;                // ground over the roof
const CC_HEAD_OVER_M = 0.3;            // headwall top over the street
const CC_STREET_BEHIND_M = 16;         // the street behind a box's portal: its ground this far in
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
  return t === 'yes' || t === 'avalanche_protector';
}

/** An avalanche gallery: a roofed road on the hillside, open on the valley side. */
export const isGalleryTag = (tags = {}) => String(tags.tunnel ?? '').toLowerCase() === 'avalanche_protector';

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
  const trees = [];
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
    if (keys.some((k) => degree(k) > 2)) {
      const tree = splitBranches(parts, group, ends, key);
      if (tree) trees.push(tree); else branched.push(group);
      continue;
    }
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
  return { paths, branched, trees };
}

/**
 * A branching group of tunnel parts as its longest path (the main tunnel)
 * and the chains hanging off it: { main: path, branches: [path, its xy
 * starting at the junction] }, or null (a loop, or a branch off a branch).
 */
function splitBranches(parts, group, ends, key) {
  // (a ramp counts for half its length: the carriageway is the main tunnel)
  const len = (i) => {
    const xy = parts[i].xy;
    let L = 0;
    for (let k = 1; k < xy.length; k++) L += Math.hypot(xy[k][0] - xy[k - 1][0], xy[k][1] - xy[k - 1][1]);
    return String(parts[i].osm?.highway ?? '').endsWith('_link') ? L / 2 : L;
  };
  const inGroup = new Set(group);
  const nextAt = (k, used) => (ends.get(k) || []).filter(({ i }) => inGroup.has(i) && !used.has(i));
  const far = (i, at) => key(at === 0 ? parts[i].xy[parts[i].xy.length - 1] : parts[i].xy[0]);
  // the longest simple path between two group ends (groups are small)
  let best = null;
  const walk = (k, used, path, L) => {
    const options = nextAt(k, used);
    if (!options.length && path.length && (!best || L > best.L)) best = { path: [...path], L };
    for (const o of options) {
      used.add(o.i);
      path.push(o);
      walk(far(o.i, o.at), used, path, L + len(o.i));
      path.pop();
      used.delete(o.i);
    }
  };
  const groupKeys = [...new Set(group.flatMap((j) => [key(parts[j].xy[0]), key(parts[j].xy[parts[j].xy.length - 1])]))];
  for (const k of groupKeys) if ((ends.get(k) || []).filter(({ i }) => inGroup.has(i)).length === 1) walk(k, new Set(), [], 0);
  if (!best) return null;
  const asPath = (steps) => {
    const xy = [];
    for (const { i, at } of steps) {
      const pts = at === 0 ? parts[i].xy : [...parts[i].xy].reverse();
      xy.push(...(xy.length ? pts.slice(1) : pts));
    }
    return { idx: steps.map((o) => o.i), flip: steps.map((o) => o.at === 1), xy };
  };
  const main = asPath(best.path);
  const used = new Set(main.idx);
  const mainKeys = new Set(main.idx.flatMap((j) => [key(parts[j].xy[0]), key(parts[j].xy[parts[j].xy.length - 1])]));
  const branches = [];
  for (const k of mainKeys) {
    for (const o of nextAt(k, used)) {
      // a chain from the junction outwards, one part after the next
      const steps = [o];
      used.add(o.i);
      let at = far(o.i, o.at);
      for (;;) {
        const nx = nextAt(at, used);
        if (nx.length !== 1) { if (nx.length > 1) return null; break; }
        steps.push(nx[0]);
        used.add(nx[0].i);
        at = far(nx[0].i, nx[0].at);
      }
      branches.push(asPath(steps));
    }
  }
  if (group.some((i) => !used.has(i))) return null;
  return { main, branches };
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
export function solveTunnel(path, opts) {
  if (path.gallery) return solveGallery(path, opts);
  const bored = solveTunnelAs(path, opts, false);
  if (bored.ok || !/not under ground|bore only/.test(bored.reason)) return bored;
  // mapped as a tunnel, but too little ground over it: on a hillside (the
  // 30 m elevation smooths a cliff road's rock away) a gallery; under flat
  // ground (a city) cut and cover
  if (crossSlope(path, opts.groundAt) > HILLSIDE_SLOPE) {
    const gal = solveGallery(path, opts);
    return gal.ok ? gal : bored;
  }
  const cc = solveTunnelAs(path, opts, true);
  return cc.ok ? cc : bored;
}

// Galleries: a roof on a wall on the uphill side and columns on the valley
// side, over the road where it is (on the surface); the hillside cut back
// behind the wall and over the roof.
const HILLSIDE_SLOPE = 0.12;           // ground across the road steeper than this: a hillside
const GAL_H = 5.2;                     // clear height under the roof
const GAL_ROOF_M = 0.7;
const GAL_WALL_T = 0.6;
const GAL_COLUMN_EVERY_M = 5;
const GAL_COLUMN_M = 0.6;
const GAL_VALLEY_CLEAR_M = 3;          // the valley side's ground kept down to the road this far past the columns

/** The ground's slope across a path (median over its stations, rise per metre). */
function crossSlope(path, groundAt) {
  const st = stations(path.xy, 4);
  const D = path.half + WALKWAY_M + 12;
  const v = st.map((p) => {
    const [xr, yr] = lateral(p, D); const [xl, yl] = lateral(p, -D);
    return Math.abs(groundAt(xr, yr) - groundAt(xl, yl)) / (2 * D);
  }).sort((a, b) => a - b);
  return v[v.length >> 1] ?? 0;
}

/** A gallery over a path (the road on the ground, smoothed): a tunnel of kind 'gallery'. */
export function solveGallery(path, { groundAt, squareSize = 1 }) {
  const st = stations(path.xy);
  const n = st.length;
  const L = st[n - 1].s;
  if (L < 10) return { ok: false, reason: `short (${Math.round(L)} m)`, length: L };
  const W = path.half + WALKWAY_M;
  const g = st.map((p) => groundAt(p.x, p.y));
  // the road where it is, smoothed; its ends on the ground (it runs on
  // over the terrain beyond them)
  const z = smoothPinned(g, STEP_M, SMOOTH_SIGMA_M);
  // the uphill side (+1 right of travel, -1 left): where the ground is higher
  const D = W + 12;
  let rise = 0;
  for (const p of st) {
    const [xr, yr] = lateral(p, D); const [xl, yl] = lateral(p, -D);
    rise += groundAt(xr, yr) - groundAt(xl, yl);
  }
  const line = st.map((p, i) => ({ ...p, z: z[i], g: g[i], kind: 'tube', wl: W, wr: W }));
  return {
    ok: true, kind: 'gallery', line, iS: 0, iN: n - 1,
    portals: [false, false], portalKind: ['edge', 'edge'],
    W, wall: GAL_H, arch: 0, crown: GAL_H, need: GAL_H + GAL_ROOF_M, headTop: GAL_H + GAL_ROOF_M,
    uphill: rise >= 0 ? 1 : -1,
    length: L, tubeLength: L, fill: 0, short: 0, dips: [], exposed: [], squareSize,
    headDepth: 0, stepAt: 0, wingT: GAL_WALL_T, wingD: W, headHalf: W + GAL_WALL_T + 1,
    wings: { [-1]: new Map(), [1]: new Map() }, maxExtra: 0, cuts: [],
  };
}

// The ground a gallery wants: its floor under the roof and the wall, the
// rock cut back over the roof on the uphill side, the valley side only cut
// down (1:1) where it stands over the road.
function galleryGroundAt(t, x, y, h) {
  const n = nearestOnTunnel(t, x, y, t.W + GAL_WALL_T + 60);
  if (!n || n.beyond) return h;
  const ad = Math.abs(n.d);
  const edge = t.W + 0.5 + GAL_WALL_T;
  if (ad <= edge) return n.z;
  if ((Math.sign(n.d) || 1) === t.uphill) return Math.min(h, n.z + t.headTop + FACE_SLOPE * (ad - edge));
  // valley side: no ground over the road showing between the columns
  return Math.min(h, n.z + Math.max(0, ad - edge - GAL_VALLEY_CLEAR_M));
}

/** A gallery as triangles: roof slab, uphill wall, valley-side columns and beam; pieces like a tube's. */
function buildGalleryGeometry(t) {
  const T = makeTris();
  const inner = t.W + 0.5;
  const up = t.uphill;
  const at = (p, u, v) => { const [x, y] = lateral(p, u); return [x, y, p.z + v]; };
  // a box-section strip along the line between offsets u0..u1 (right of
  // travel) and heights v0..v1: its four long faces, and end caps
  const strip = (u0, u1, v0, v1) => {
    const corners = [[u0, v0], [u1, v0], [u1, v1], [u0, v1]];
    const mid = [(u0 + u1) / 2, (v0 + v1) / 2];
    for (let i = 0; i + 1 < t.line.length; i++) {
      const p = t.line[i]; const q = t.line[i + 1];
      const c = at(p, mid[0], mid[1]);
      const want = (cc) => [cc[0] - c[0], cc[1] - c[1], cc[2] - c[2]];
      for (let k = 0; k < 4; k++) {
        const [ua, va] = corners[k]; const [ub, vb] = corners[(k + 1) % 4];
        const a = at(p, ua, va); const b = at(p, ub, vb); const cq = at(q, ua, va); const d = at(q, ub, vb);
        const U = [p.s / 4, q.s / 4];
        T.tri(a, b, cq, [[U[0], 0], [U[0], 1], [U[1], 0]], want);
        T.tri(b, d, cq, [[U[0], 1], [U[1], 1], [U[1], 0]], want);
      }
    }
    for (const [i, sgn] of [[0, -1], [t.line.length - 1, 1]]) {
      const p = t.line[i];
      const [a, b, c, d] = corners.map(([u, v]) => at(p, u, v));
      const want = () => [sgn * p.tx, sgn * p.ty, 0];
      T.tri(a, b, c, [[0, 0], [1, 0], [1, 1]], want);
      T.tri(a, c, d, [[0, 0], [1, 1], [0, 1]], want);
    }
  };
  const wallU = up * (inner + GAL_WALL_T / 2);
  strip(-inner - GAL_WALL_T, inner + GAL_WALL_T, GAL_H, GAL_H + GAL_ROOF_M);             // roof
  strip(wallU - GAL_WALL_T / 2, wallU + GAL_WALL_T / 2, -0.5, GAL_H);                    // uphill wall
  const beamU = -up * (inner + GAL_WALL_T / 2);
  strip(beamU - GAL_WALL_T / 2, beamU + GAL_WALL_T / 2, GAL_H - 0.8, GAL_H);             // valley beam
  // columns under the beam
  let next = 0;
  for (const p of t.line) {
    if (p.s < next) continue;
    next = p.s + GAL_COLUMN_EVERY_M;
    const [cx, cy] = lateral(p, beamU);
    const h = GAL_COLUMN_M / 2;
    const ux = [p.tx * h, p.ty * h]; const vx = [p.ty * h, -p.tx * h];
    const c = (a, b, v) => [cx + ux[0] * a + vx[0] * b, cy + ux[1] * a + vx[1] * b, p.z + v];
    const o = [cx, cy, p.z + GAL_H / 2];
    const want = (cc) => [cc[0] - o[0], cc[1] - o[1], 0];
    for (const [a0, b0, a1, b1] of [[-1, -1, 1, -1], [1, -1, 1, 1], [1, 1, -1, 1], [-1, 1, -1, -1]]) {
      const A = c(a0, b0, -0.5); const B = c(a1, b1, -0.5); const C = c(a1, b1, GAL_H - 0.8); const D = c(a0, b0, GAL_H - 0.8);
      T.tri(A, B, C, [[0, 0], [1, 0], [1, 1]], want);
      T.tri(A, C, D, [[0, 0], [1, 1], [0, 1]], want);
    }
  }
  return [{ pos: T.pos, uv: T.uv, from: t.line[0].s, to: t.line[t.line.length - 1].s }];
}

function solveTunnelAs(path, { groundAt, approaches = [null, null], isFreeEnd = () => false, squareSize = 1 }, cutCover) {
  const st = stations(path.xy);
  const n = st.length;
  const L = st[n - 1].s;
  if (L < MIN_TUBE_M) return { ok: false, reason: `short (${Math.round(L)} m)`, length: L };
  const W = path.half + WALKWAY_M;
  const wall = cutCover ? CC_WALL_M : WALL_M;
  const arch = cutCover ? CC_ARCH_M : archRise(W);
  const crown = wall + arch;                   // inner crown over the road
  const need = crown + LINING_M + (cutCover ? CC_COVER_M : MIN_COVER_M); // ground over the road
  const g = st.map((p) => groundAt(p.x, p.y));
  const free = [isFreeEnd(st[0].x, st[0].y), isFreeEnd(st[n - 1].x, st[n - 1].y)];
  const bridged = [0, 1].map((e) => Number.isFinite(approaches[e]?.deckZ));
  // a box sunk below a bridge's deck: no way down to it
  if (cutCover && (bridged[0] || bridged[1])) return { ok: false, reason: 'a bridge meets a cut-and-cover tunnel', length: L };
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
  if (!cutCover && rise > MAX_GRADE * 1.5 * L + 5) return { ok: false, reason: `ends ${Math.round(rise)} m apart in height over ${Math.round(L)} m`, length: L };
  let z;
  if (cutCover) {
    // the box under the street all along, no steeper than MAX_GRADE (the
    // highest such line: as shallow as it can be)
    const u = g.map((v) => v - need);
    z = u.slice();
    for (let i = 1; i < n; i++) z[i] = Math.min(z[i], z[i - 1] + MAX_GRADE * (st[i].s - st[i - 1].s));
    for (let i = n - 2; i >= 0; i--) z[i] = Math.min(z[i], z[i + 1] + MAX_GRADE * (st[i + 1].s - st[i].s));
    z = smoothPinned(z, STEP_M, SMOOTH_SIGMA_M).map((v, i) => Math.min(v, u[i]));
  } else {
    // The straight grade between the portals, lowered under the hill where it
    // would come too close to the surface, as far as the grade allows.
    z = st.map((p) => endZ[0] + ((endZ[1] - endZ[0]) * p.s) / (L || 1));
    z = z.map((v, i) => Math.min(v, g[i] - need));
    z[0] = endZ[0];
    z[n - 1] = endZ[1];
    for (let i = 1; i < n; i++) z[i] = Math.max(z[i], z[i - 1] - MAX_GRADE * (st[i].s - st[i - 1].s));
    for (let i = n - 2; i >= 0; i--) z[i] = Math.max(z[i], z[i + 1] - MAX_GRADE * (st[i + 1].s - st[i].s));
    z = smoothPinned(z, STEP_M, SMOOTH_SIGMA_M);
  }

  // Portals: where the ground is first over the bore by the cover, from each
  // end (OSM ends often sit a little out on the approach); at a free end the
  // tube runs on to the map's edge. Where a bridge meets the tunnel the bore
  // runs out to it (out of a cliff face onto the bridge): the stretch with
  // thin cover there is left exposed, never filled.
  const covered = (i) => g[i] - z[i] >= need - 1e-6;
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
  // a cut-and-cover trench runs out until the road is back at the street
  const trenchMax = cutCover ? need / MAX_GRADE + 60 : TRENCH_MAX_M;
  const extend = (e) => {
    const a = approaches[e];
    if (!a?.xy || a.xy.length < 2 || Number.isFinite(a.deckZ) || free[e]) return [];
    const ap = stations(a.xy).slice(1);
    const z0 = e === 0 ? z[0] : z[n - 1];
    const out = [];
    let calm = 0;
    // a bridge over the approach: the road stays a deck's clearance under the
    // ground there, then climbs (a depressed freeway goes on under the
    // ramps crossing it before it rises)
    const unders = (a.under || []).map((u) => ({ s: u, cap: groundAt(...stationXY(ap, u)) - UNDER_BRIDGE_M }));
    for (const p of ap) {
      if (p.s > trenchMax) break;
      const gr = groundAt(p.x, p.y);
      let zz = clamp(gr, z0 - MAX_GRADE * p.s, z0 + MAX_GRADE * p.s);
      for (const u of unders) zz = Math.min(zz, Math.max(u.cap + MAX_GRADE * Math.max(0, Math.abs(p.s - u.s) - UNDER_BRIDGE_FLAT_M), z0 - MAX_GRADE * p.s));
      out.push({ x: p.x, y: p.y, s: p.s, tx: p.tx, ty: p.ty, z: zz, g: gr, kind: 'cut' });
      calm = Math.abs(gr - zz) < TRENCH_DONE_M ? calm + 1 : 0;
      if (calm * STEP_M >= 10) break;
    }
    // Still off the ground at the end (a gully the road crosses on a fill,
    // a hillside it cuts into): the last stretch steepens to a road's grade
    // to land on it, rather than ending at a wall (Queen Creek: 33 m up)
    // (eased in along the whole approach: clamped near the end only, a
    // ground falling faster than that grade cut the road off at the portal)
    const last = out[out.length - 1];
    if (last && Math.abs(last.g - last.z) > TRENCH_DONE_M) {
      const miss = last.g - last.z;
      const from = Math.max(0, last.s - Math.abs(miss) / APPROACH_LAND_GRADE * 2);
      for (const q of out) {
        const f = clamp((q.s - from) / Math.max(1e-6, last.s - from), 0, 1);
        q.z += miss * f * f * (3 - 2 * f);
      }
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
    kind: cutCover ? 'cutcover' : 'bored',
    W, wall, arch, crown, need,
    // headwall top over the road: a bore's tall face, a box's to the street
    headTop: cutCover ? need + CC_HEAD_OVER_M : HEAD_TOP_M,
    // per portal [start, end]: a box's headwall up to the street behind it
    // (Deck Park's east portals: the street 10.3 m over the road where the
    // freeway is sunk deeper; at the cover height the street behind was cut
    // down to a ragged wall of ground over the headwall)
    headTops: [0, 1].map((e) => {
      if (!cutCover) return HEAD_TOP_M;
      const i0 = e === 0 ? iS : iN; const step = e === 0 ? 1 : -1;
      const behind = [];
      for (let k = 1; k * STEP_M <= CC_STREET_BEHIND_M; k++) {
        const i = i0 + step * k;
        if (i < 0 || i >= n) break;
        behind.push(g[i] - z[i]);
      }
      // (the highest: OSM ends a tunnel a few metres out in front of the
      // street's edge, where the ground still steps up to it)
      const street = behind.length ? Math.max(...behind) : need;
      return Math.max(need, street) + CC_HEAD_OVER_M;
    }),
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
  for (const q of tunnel.line) { q.wl = W; q.wr = W; }
  tunnel.maxExtra = 0;
  tunnel.cuts = [];
  tunnel.wings = wingTops(tunnel, groundAt);
  tunnel.windows = cutCover ? [] : findWindows(tunnel, groundAt);
  return tunnel;
}

/**
 * Gallery windows along a bored tunnel: stations where the open air at the
 * sill (and on past the face, a view, not a dimple) comes within
 * WINDOW_ROCK_M of the lining on one side, thinnest first, spaced out.
 * Each: { s, i (first station of the opening), j (last), side (+1 right of
 * travel), face (offset of the cliff face from the road's centre line),
 * z (road height at the opening's centre), grade, x, y, tx, ty }.
 */
function findWindows(t, groundAt) {
  const outer = t.W + LINING_M;
  const sS = t.line[t.iS].s; const sN = t.line[t.iN].s;
  const faceAt = (p, side, sill) => {
    for (let o = outer; o <= outer + WINDOW_ROCK_M; o += 0.5) {
      const [x, y] = lateral(p, side * o);
      if (groundAt(x, y) >= p.z + sill) continue;
      // the view: the ground stays under the sill on past the face
      for (let v = 1; v <= WINDOW_VIEW_M; v += 1) {
        const [vx, vy] = lateral(p, side * (o + v));
        if (groundAt(vx, vy) >= p.z + sill) return null;
      }
      return o;
    }
    return null;
  };
  // an opening of `segments` stations from i0, on a side: its face offset, or null
  const fits = (i0, side, kind) => {
    const { segments, sill } = WINDOW_KINDS[kind];
    const i1 = i0 + segments;
    if (i0 < t.iS || i1 > t.iN) return null;
    const run = t.line.slice(i0, i1 + 1);
    if (run.some((q) => q.s - sS < WINDOW_END_CLEAR_M || sN - q.s < WINDOW_END_CLEAR_M || inExposed(t, q.s))) return null;
    // the opening's stations all at the road's own width (no ramp joining)
    if (run.some((q) => (q.wl ?? t.W) !== t.W || (q.wr ?? t.W) !== t.W)) return null;
    const faces = run.map((q) => faceAt(q, side, sill));
    return faces.some((f) => f == null) ? null : Math.max(...faces);
  };
  const make = (i0, side, kind, face) => {
    const k = WINDOW_KINDS[kind];
    const a = t.line[i0]; const b = t.line[i0 + k.segments];
    const L = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    return {
      kind, i: i0, j: i0 + k.segments, side, face, s: (a.s + b.s) / 2,
      x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, z: (a.z + b.z) / 2,
      tx: (b.x - a.x) / L, ty: (b.y - a.y) / L, grade: (b.z - a.z) / (b.s - a.s || 1), halfLen: L / 2,
      floor: k.floor, sill: k.sill, spring: k.spring ?? t.wall, rise: k.rise,
    };
  };
  const candidates = [];
  for (let i = t.iS; i < t.iN; i++) {
    for (const side of [-1, 1]) {
      const face = fits(i, side, 'window');
      if (face != null) candidates.push({ i, side, face });
    }
  }
  candidates.sort((a, b) => a.face - b.face);
  const picked = [];
  for (const c of candidates) {
    const w = make(c.i, c.side, 'window', c.face);
    if (picked.some((q) => Math.abs(q.s - w.s) < WINDOW_SPACING_M)) continue;
    picked.push(w);
  }
  // the one nearest a portal opens up into the walk-in gallery (where it fits)
  const byPortal = [...picked].sort((a, b) => Math.min(a.s - sS, sN - a.s) - Math.min(b.s - sS, sN - b.s));
  for (const w of byPortal) {
    const shift = (WINDOW_KINDS.gallery.segments - WINDOW_KINDS.window.segments) / 2;
    const face = fits(w.i - shift, w.side, 'gallery');
    if (face == null) continue;
    picked[picked.indexOf(w)] = make(w.i - shift, w.side, 'gallery', face);
    break;
  }
  return picked.sort((a, b) => a.s - b.s);
}

// A point in a window's frame: a along the road from its centre, r out
// through it (from the road's centre line), the road height there.
const windowFrame = (w, x, y) => {
  const dx = x - w.x; const dy = y - w.y;
  const a = dx * w.tx + dy * w.ty;
  return { a, r: w.side * (dx * w.ty - dy * w.tx), z: w.z + w.grade * a };
};
// A window's sizes across: the plate's front at the face (at least 2 m out
// of the lining: its terrain band between, never over the tube), its back
// up to the plate's depth inside, the opening's top.
const windowDims = (t, w) => {
  const outer = t.W + LINING_M;
  const rF = Math.max(w.face, outer + 2);
  const top = w.spring + w.rise;
  return {
    outer, rF, rP: Math.max(outer, rF - t.headDepth), top,
    // (up to the cover made up over the bore, which runs on beside it)
    plateHalf: w.halfLen + WINDOW_PLATE_SIDE_M, plateTop: Math.max(top + LINING_M + WINDOW_PLATE_OVER_M, t.need), plateBottom: w.sill - WINDOW_PLATE_UNDER_M,
  };
};

/**
 * Metres a station is wider than the tunnel's own road on one side (side
 * +1 right of travel, -1 left): a ramp joining inside the tube or cutting
 * widens it (absorbBranch).
 */
export const extraAt = (t, p, side) => Math.max(0, (side > 0 ? p.wr ?? t.W : p.wl ?? t.W) - t.W);
// |d| from the road's own edge outward on that side (as if no extra width)
const across = (t, n) => Math.max(0, Math.abs(n.d) - extraAt(t, t.line[n.i], Math.sign(n.d) || 1));

// Ramps joining inside a tunnel (Deck Park, Phoenix: each I-10 on-ramp
// splits off its carriageway 85 m inside and leaves by its own mouth 16 m
// away) share one wide bore: the main tunnel widens on the ramp's side from
// the junction out, through the portal and the cutting, while the ramp stays
// within ABSORB_MAX_M of its walls; past that the ramp climbs out in a trench
// of its own.
const ABSORB_MAX_M = 24;
const BRANCH_TRENCH_MAX_M = 400;

/**
 * Take a branch into a solved tunnel: branch { xy (from the junction
 * outwards: its tunnel part, then its approach road), half, tunnelLength }.
 * Widens t's stations (wl / wr), adds the branch's own trench to t.cuts.
 * Returns { ok, reason?, absorbed (m), trench (m) }.
 */
export function absorbBranch(t, branch, { groundAt }) {
  const st = stations(branch.xy);
  let last = -1;
  let lastZ = 0;
  let lastAt = null;
  const touched = [];
  for (let k = 0; k < st.length; k++) {
    const b = st[k];
    const n = nearestOnTunnel(t, b.x, b.y, t.W + ABSORB_MAX_M + 10);
    if (!n || n.beyond) break;
    const side = Math.sign(n.d) || 1;
    const need = Math.abs(n.d) + branch.half + WALKWAY_M;
    if (need - t.W > ABSORB_MAX_M) {
      if (n.into > 0 && b.s < branch.tunnelLength) return { ok: false, reason: 'a ramp leaves the tube in a bore of its own' };
      break;
    }
    for (const i of [n.i - 1, n.i, n.i + 1]) {
      const p = t.line[i];
      if (!p) continue;
      if (side > 0) p.wr = Math.max(p.wr ?? t.W, need); else p.wl = Math.max(p.wl ?? t.W, need);
      touched.push(i);
    }
    last = k;
    lastZ = n.z;
    lastAt = { i: n.i, side };
  }
  if (last < 0) return { ok: false, reason: 'a ramp not alongside its tunnel' };
  if (st[last].s < branch.tunnelLength - 2 * STEP_M) return { ok: false, reason: 'a ramp leaves the tunnel line inside it' };
  // the widening without steps: each side a little smoothed (a max over its neighbours)
  for (const key of ['wl', 'wr']) {
    const v = t.line.map((p) => p[key] ?? t.W);
    t.line.forEach((p, i) => { p[key] = Math.max(...v.slice(Math.max(0, i - 2), i + 3)); });
  }
  t.maxExtra = Math.max(0, ...t.line.map((p) => Math.max(p.wl, p.wr) - t.W));
  // then on its own: rising from the road's height to the ground
  const line = [];
  let calm = 0;
  for (let k = last; k < st.length; k++) {
    const b = st[k];
    const ds = b.s - st[last].s;
    if (ds > BRANCH_TRENCH_MAX_M) break;
    const gr = groundAt(b.x, b.y);
    const z = clamp(gr, lastZ - MAX_GRADE * ds, lastZ + MAX_GRADE * ds);
    line.push({ x: b.x, y: b.y, s: b.s, z });
    calm = Math.abs(gr - z) < TRENCH_DONE_M ? calm + 1 : 0;
    if (calm * STEP_M >= 10) break;
  }
  if (line.length >= 2 && line.some((q) => groundAt(q.x, q.y) - q.z > TRENCH_DONE_M)) t.cuts.push({ line, half: branch.half });
  // where it leaves the main cutting, an opening in that side's wall
  if (lastAt) {
    const g = Math.ceil((branch.half + WALKWAY_M + 4) / STEP_M);
    t.wingGaps = [...(t.wingGaps || []), { side: lastAt.side, i0: lastAt.i - g, i1: lastAt.i + g }];
  }
  t.wings = wingTops(t, groundAt);
  return { ok: true, absorbed: st[last].s, trench: line.length >= 2 ? line[line.length - 1].s - line[0].s : 0 };
}

// Other drawn roads beside a tunnel's portals and cuttings (Deck Park's HOV
// ramps climbing out of the I-10 median between its two bores): the ground
// under them is never graded, and the headwall and wingwalls pull in to
// clear them (a retaining wall between the trench and the ramp).
const BESIDE_GAP_M = 0.2;              // headwall / wingwall kept this far off another road's edge
const BESIDE_REACH_M = 40;             // roads this far off the line count

/**
 * Note the other drawn roads ([{ xy: [[x, y]...], half }]) beside tunnel t:
 * t.foreign (the ones near it) and t.clear[side] (per line index, the gap
 * from the line to the nearest one's edge that side, or Infinity); the
 * wingwalls are refitted to it.
 */
export function fitBesideRoads(t, roads, groundAt) {
  const box = tunnelReach(t);
  t.foreign = roads.filter((r) => r.xy.some(([x, y]) => x > box[0] - BESIDE_REACH_M && x < box[2] + BESIDE_REACH_M && y > box[1] - BESIDE_REACH_M && y < box[3] + BESIDE_REACH_M));
  t.clear = { [-1]: t.line.map(() => Infinity), [1]: t.line.map(() => Infinity) };
  if (!t.foreign.length) return t;
  const reach = t.headHalf + (t.maxExtra || 0) + 2;
  t.line.forEach((p, i) => {
    // only round the portals and along the cuttings
    if (p.kind !== 'cut' && Math.min(Math.abs(i - t.iS), Math.abs(i - t.iN)) * STEP_M > t.headDepth + BACKFILL_M) return;
    for (const side of [-1, 1]) {
      // (the last step short of it: the edge is somewhere in the step)
      for (let o = 0; o <= reach; o += 0.25) {
        const [x, y] = lateral(p, side * o);
        if (onForeignRoad(t, x, y, 0)) { t.clear[side][i] = Math.max(0, o - 0.25); break; }
      }
    }
  });
  t.wings = wingTops(t, groundAt);
  return t;
}

// is (x, y) on one of the tunnel's other roads (within `margin` of its edge)?
function onForeignRoad(t, x, y, margin) {
  for (const r of t.foreign || []) {
    for (let i = 0; i + 1 < r.xy.length; i++) {
      const [ax, ay] = r.xy[i]; const [bx, by] = r.xy[i + 1];
      const vx = bx - ax; const vy = by - ay; const L2 = vx * vx + vy * vy || 1e-9;
      const f = clamp(((x - ax) * vx + (y - ay) * vy) / L2, 0, 1);
      if (Math.hypot(ax + vx * f - x, ay + vy * f - y) <= r.half + margin) return true;
    }
  }
  return false;
}

// a wingwall's inner face offset at line index i, side (pulled in off another road)
const wingDAt = (t, i, side) => {
  const c = t.clear?.[side]?.[i] ?? Infinity;
  return Number.isFinite(c) ? clamp(c - t.wingT - BESIDE_GAP_M, t.W, t.wingD) : t.wingD;
};
// a headwall's reach past the line at portal index i, side
const headHalfAt = (t, i, side) => {
  const c = t.clear?.[side]?.[i] ?? Infinity;
  return Number.isFinite(c) ? clamp(c - BESIDE_GAP_M, t.W + LINING_M + 0.3, t.headHalf) : t.headHalf;
};

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
      let cap = t.headTops ? t.headTops[step < 0 ? 0 : 1] : t.headTop;
      // from one station inside the headwall outwards
      for (let i = i0 - step; i >= 0 && i < t.line.length; i += step) {
        const p = t.line[i];
        const [x, y] = lateral(p, side * (wingDAt(t, i, side) + extraAt(t, p, side) + t.wingT + 1));
        cap = Math.min(cap, groundAt(x, y) - p.z);
        if (cap < WING_MIN_M) break;
        wings[side].set(i, cap);
      }
    }
  }
  // gaps where a ramp leaves the cutting through its wall
  for (const gap of t.wingGaps || []) for (let i = gap.i0; i <= gap.i1; i++) wings[gap.side].delete(i);
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
  // integer cell keys (cx, cy offset well clear of any level's extent)
  const key = (cx, cy) => (cx + 32768) * 65536 + (cy + 32768);
  const cells = new Map();
  for (let i = 0; i + 1 < line.length; i++) {
    const x0 = Math.min(line[i].x, line[i + 1].x); const x1 = Math.max(line[i].x, line[i + 1].x);
    const y0 = Math.min(line[i].y, line[i + 1].y); const y1 = Math.max(line[i].y, line[i + 1].y);
    for (let cx = Math.floor(x0 / cell); cx <= Math.floor(x1 / cell); cx++) {
      for (let cy = Math.floor(y0 / cell); cy <= Math.floor(y1 / cell); cy++) {
        const k = key(cx, cy);
        if (!cells.has(k)) cells.set(k, []);
        cells.get(k).push(i);
      }
    }
  }
  const all = line.slice(0, -1).map((_, i) => i);
  return {
    // segment indices near (x, y) (a segment in two cells may come twice)
    near(x, y, reach) {
      const r = Number.isFinite(reach) ? Math.ceil(reach / cell) : 1e9;
      if (r > 64) return all;
      const out = [];
      const fx = Math.floor(x / cell); const fy = Math.floor(y / cell);
      for (let cx = fx - r; cx <= fx + r; cx++) {
        for (let cy = fy - r; cy <= fy + r; cy++) {
          const list = cells.get(key(cx, cy));
          if (list) for (const i of list) out.push(i);
        }
      }
      return out;
    },
  };
}

const inExposed = (t, s) => (t.exposed || []).some(([a, b]) => s >= a - 1e-6 && s <= b + 1e-6);
// the headwall top (over the road) at the portal nearer station s
const headTopAt = (t, s) => (t.headTops ? (Math.abs(s - t.line[t.iS].s) <= Math.abs(t.line[t.iN].s - s) ? t.headTops[0] : t.headTops[1]) : t.headTop);
const nearerPortalKind = (t, s) => (Math.abs(s - t.line[t.iS].s) <= Math.abs(t.line[t.iN].s - s) ? t.portalKind[0] : t.portalKind[1]);

/** Road height on a solved tunnel at (x, y). */
export function tunnelRoadZ(t, x, y) {
  return nearestOnTunnel(t, x, y)?.z ?? t.line[0].z;
}

/** The world box a tunnel's terrain edits can reach. */
export function tunnelReach(t) {
  const pad = t.headHalf + (t.maxExtra || 0) + FACE_REACH_M + 4;
  let x0 = Infinity; let y0 = Infinity; let x1 = -Infinity; let y1 = -Infinity;
  for (const p of t.line) { x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y); x1 = Math.max(x1, p.x); y1 = Math.max(y1, p.y); }
  return [x0 - pad, y0 - pad, x1 + pad, y1 + pad];
}

// A branch's own trench (absorbBranch): its floor at the road, 1:1 slopes up
// to the ground beside it; only ever cut.
function cutsGroundAt(t, x, y, h) {
  for (const cut of t.cuts || []) {
    if (!cut.index) cut.index = indexLine(cut.line);
    const floor = cut.half + WALKWAY_M + WING_GAP_M;
    let best = null;
    for (const i of cut.index.near(x, y, floor + 40)) {
      const a = cut.line[i]; const b = cut.line[i + 1];
      const ex = b.x - a.x; const ey = b.y - a.y;
      const L2 = ex * ex + ey * ey || 1e-9;
      const raw = ((x - a.x) * ex + (y - a.y) * ey) / L2;
      const f = clamp(raw, 0, 1);
      const d = Math.hypot(a.x + ex * f - x, a.y + ey * f - y);
      if (best && d >= best.d) continue;
      best = { d, z: a.z + (b.z - a.z) * f, beyond: (i === 0 && raw < 0) || (i === cut.line.length - 2 && raw > 1) };
    }
    if (!best || best.beyond) continue;
    h = Math.min(h, best.z + Math.max(0, best.d - floor));
  }
  return h;
}

/**
 * The terrain a tunnel wants at a grid point (world x, y, current height h):
 * the new height, or h. Cutting floor at road level between the wingwalls,
 * the hillside behind a wall down to its top then 1:1 slopes; behind a
 * headwall raised to its top; over the bore made up to the cover.
 */
export function tunnelGroundAt(t, x, y, h) {
  if (t.kind === 'gallery') return galleryGroundAt(t, x, y, h);
  // another road's ground beside the tunnel stays as it is (one crossing
  // over the tube still gets the cover over it: Deck Park's west streets,
  // their ground low behind the headwalls, had squares opened down to the box)
  if (t.foreign?.length && onForeignRoad(t, x, y, 0.5)) {
    const m = nearestOnTunnel(t, x, y, t.W + (t.maxExtra || 0) + LINING_M + 1);
    if (!m || m.into < 0 || across(t, m) > t.W + LINING_M + 1) return h;
  }
  h = cutsGroundAt(t, x, y, h);
  const n = nearestOnTunnel(t, x, y, t.headHalf + (t.maxExtra || 0) + FACE_REACH_M);
  if (!n) return h;
  if (n.beyond) {
    // past the outer end of an approach's cutting or fill: its slopes run on
    // round the end (no wall across the road where the earthwork stops)
    const end = n.i <= 1 ? t.line[0] : t.line[t.line.length - 1];
    if (end.kind !== 'cut') return h;
    const past = Math.hypot(x - end.x, y - end.y);
    return clamp(h, end.z - past, end.z + past);
  }
  const ad = across(t, n);
  const p = t.line[n.i];
  if (n.into < t.stepAt) {
    // the cutting: its own stations, and the first metres inside a cutting's
    // portal (to the step in the headwall); inside a bridge's portal the
    // rock is cut back to the headwall's top
    if (n.into >= 0 && nearerPortalKind(t, n.s) === 'bridge') {
      return Math.min(h, n.z + headTopAt(t, n.s) + FACE_SLOPE * Math.max(0, ad - t.headHalf));
    }
    // (in front of a cutting's face even where the nearest station is the
    // portal's own)
    if (n.into < 0 ? p.kind !== 'cut' && nearerPortalKind(t, n.s) !== 'cut' : nearerPortalKind(t, n.s) !== 'cut') return h;
    const top = t.wings[Math.sign(n.d) || 1].get(n.i) ?? 0;
    const wd = wingDAt(t, n.i, Math.sign(n.d) || 1);
    if (ad <= wd + t.wingT / 2) return n.z;
    const r = Math.max(0, ad - wd - t.wingT);
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
    const headTop = headTopAt(t, n.s);
    if (kind === 'cut' && n.into < t.headDepth + BACKFILL_M && ad <= t.headHalf + 1) out = Math.max(out, n.z + headTop);
    out = Math.min(out, n.z + headTop + FACE_SLOPE * (Math.max(0, n.into - t.headDepth) + Math.max(0, ad - t.headHalf)));
  }
  // gallery windows: the ground in front kept under the sill, the rock over
  // the face plate down to its top, and no fill made up in front of it
  for (const w of t.windows || []) {
    const f = windowFrame(w, x, y);
    const D = windowDims(t, w);
    // (over the tube itself the hill is left to the cover rules below)
    if (Math.abs(f.a) > D.plateHalf + 2 || f.r < Math.max(D.outer, D.rP - 0.5)) continue;
    // the face's line at the sill (raised or cut to it): the squares opened
    // across the face end there, and the cliff goes on down under it
    // (1.5 squares deep: a grid point in it wherever the grid runs)
    if (f.r >= D.rF - 0.5 && f.r <= D.rF + t.squareSize && Math.abs(f.a) <= w.halfLen + 1) return f.z + w.sill - 0.3;
    if (f.r > D.rF + t.squareSize && f.r <= D.rF + WINDOW_LEDGE_M && Math.abs(f.a) <= w.halfLen + 1) return Math.min(out, f.z + w.sill - 0.3);
    if (f.r < D.rF - 0.5 && Math.abs(f.a) <= D.plateHalf) return Math.min(Math.max(out, f.z + D.plateTop - 0.2), f.z + D.plateTop);
    // no cover made up in front of the plate (beside it, it hugs its sides)
    if (Math.abs(f.a) <= D.plateHalf) return out;
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
  if (t.kind === 'gallery') return false;   // on the surface: nothing opens
  // a gallery window: through the rock from the lining to the face (never a
  // square standing over the face plate's top)
  for (const w of t.windows || []) {
    const f = windowFrame(w, x, y);
    const D = windowDims(t, w);
    if (Math.abs(f.a) > w.halfLen + 0.5 * t.squareSize || f.r < D.rP - 0.5 || f.r > D.rF + 1.5 * t.squareSize) continue;
    if (hi > f.z + D.plateTop + 0.5 || lo < f.z + D.plateBottom) return false;
    return lo < f.z + D.top + LINING_M + 1;
  }
  const n = nearestOnTunnel(t, x, y, t.W + (t.maxExtra || 0) + LINING_M + t.squareSize * 2);
  // in front of the face nothing opens (the road runs on the ground there),
  // but for a grid square at a bridge's portal (the deck carries the road)
  const front = nearerPortalKind(t, n?.s ?? 0) === 'bridge' ? -1.5 * t.squareSize : 0.3;
  if (!n || n.into < front || (n.into > t.headDepth + BACKFILL_M && !inExposed(t, n.s))) return false;
  if (across(t, n) > t.W + LINING_M + 0.5 * t.squareSize) return false;
  if (hi > n.z + headTopAt(t, n.s) + 0.5) return false;
  return lo < n.z + t.crown + LINING_M + 1;
}

/** Is (x, y, z..zTop) inside a tunnel's structure (tube, headwalls, wingwalls)? */
export function hitsTunnel(tunnels, x, y, z, zTop = z) {
  for (const t of tunnels) {
    if (!t.box) t.box = tunnelReach(t);
    if (x < t.box[0] || x > t.box[2] || y < t.box[1] || y > t.box[3]) continue;
    const n = nearestOnTunnel(t, x, y, t.headHalf + (t.maxExtra || 0) + 1);
    if (!n) continue;
    const ad = across(t, n);
    const inTube = n.into >= -0.5 && ad <= t.W + LINING_M + 0.5;
    const inCut = n.into < 0 && t.line[n.i].kind === 'cut' && ad <= wingDAt(t, n.i, Math.sign(n.d) || 1) + t.wingT + 0.5 && t.wings[Math.sign(n.d) || 1].has(n.i);
    const inHead = n.into >= -0.5 && n.into <= t.headDepth + 0.5 && ad <= t.headHalf + 0.5;
    if (!(inTube || inCut || inHead)) continue;
    if (zTop >= n.z - 1 && z <= n.z + (inHead ? headTopAt(t, n.s) : t.crown + LINING_M) + 0.5) return true;
  }
  // gallery windows: the passage and its face plate
  for (const t of tunnels) {
    for (const w of t.windows || []) {
      const f = windowFrame(w, x, y);
      const D = windowDims(t, w);
      if (Math.abs(f.a) <= D.plateHalf + 0.5 && f.r >= t.W && f.r <= D.rF + 0.5 && zTop >= f.z + D.plateBottom && z <= f.z + D.plateTop + 0.5) return true;
    }
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
  if (t.kind === 'gallery') return buildGalleryGeometry(t);
  // the section at a station: as wide as its road on each side (a ramp
  // joining widens it), centred between its walls
  const sections = new Map();
  const section = (p) => {
    if (!sections.has(p)) {
      const wl = p.wl ?? t.W; const wr = p.wr ?? t.W;
      const a = (wl + wr) / 2;
      sections.set(p, { c: (wr - wl) / 2, loops: [ring(a, 0, t.wall, t.arch), ring(a + LINING_M, -LINING_M, t.wall, t.arch + LINING_M)] });
    }
    return sections.get(p);
  };
  const at = (p, [u, v]) => { const c = section(p).c; return [p.x + (u + c) * p.ty, p.y - (u + c) * p.tx, p.z + v]; };
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
    for (const [which, outward] of [[0, false], [1, true]]) {
      for (let i = i0; i < i1; i++) {
        const p = t.line[i];
        const q = t.line[i + 1];
        const loop = section(p).loops[which];
        const loopQ = section(q).loops[which];
        const al = arc(loop);
        const o = [p.x, p.y, p.z + t.wall / 2];
        const want = (c) => {
          const w = [c[0] - o[0], c[1] - o[1], c[2] - o[2]];
          return outward ? w : w.map((v) => -v);
        };
        // a window: the wall on its side open from its sill to its top over
        // the segment (the wall drawn under and over the opening)
        const open = new Map((t.windows || []).filter((w) => i >= w.i && i < w.j)
          .map((w) => [w.side > 0 ? loop.length - 2 : 0, w.kind === 'gallery' ? [WINDOW_CURB_M, t.wall] : [w.sill, Math.min(t.wall, w.spring)]]));
        for (let k = 0; k < loop.length; k++) {
          if (open.has(k)) {
            const [lo, hi] = open.get(k);
            const k2 = (k + 1) % loop.length;
            const v0 = Math.min(loop[k][1], loop[k2][1]); const v1 = Math.max(loop[k][1], loop[k2][1]);
            const u = loop[k][0];
            for (const [b0, b1] of [[v0, lo], [hi, v1]]) {
              if (b1 - b0 < 1e-3) continue;
              const a = at(p, [u, b0]); const b = at(p, [u, b1]); const c = at(q, [u, b0]); const d = at(q, [u, b1]);
              T.tri(a, b, c, [[0, b0 / 4], [0, b1 / 4], [1, b0 / 4]], want);
              T.tri(b, d, c, [[0, b1 / 4], [1, b1 / 4], [1, b0 / 4]], want);
            }
            continue;
          }
          const k2 = (k + 1) % loop.length;
          const a = at(p, loop[k]); const b = at(p, loop[k2]); const c = at(q, loopQ[k]); const d = at(q, loopQ[k2]);
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
      const [inner, outer] = section(p).loops;
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
  const headTop = t.headTops ? t.headTops[end === 'S' ? 0 : 1] : t.headTop;
  const p = t.line[i];
  const tin = end === 'S' ? [p.tx, p.ty] : [-p.tx, -p.ty];   // into the tunnel
  const Lv = [-tin[1], tin[0]];                              // left of "into": a proper rotation
  // widths left / right of "into" (a ramp joining widens one side)
  const wl = end === 'S' ? p.wl ?? t.W : p.wr ?? t.W;
  const wr = end === 'S' ? p.wr ?? t.W : p.wl ?? t.W;
  const outer = ring((wl + wr) / 2 + LINING_M, -LINING_M, t.wall, t.arch + LINING_M);
  const c = (wl - wr) / 2;
  // (left of "into" is the line's left at its start, its right at its end)
  const sideL = end === 'S' ? -1 : 1;
  const hl = headHalfAt(t, i, sideL) + wl - t.W; const hr = headHalfAt(t, i, -sideL) + wr - t.W;
  const shape = new THREE.Shape();
  shape.moveTo(-hr, HEAD_BOTTOM_M);
  shape.lineTo(hl, HEAD_BOTTOM_M);
  shape.lineTo(hl, headTop);
  shape.lineTo(-hr, headTop);
  shape.closePath();
  const hole = new THREE.Path();
  outer.forEach(([u, v], k) => (k ? hole.lineTo(u + c, Math.max(v, 0)) : hole.moveTo(u + c, Math.max(v, 0))));
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
    const top = (k) => t.wings[side].get(k) ?? t.wings[side].get(i - step) ?? headTop;
    const corner = (k, d, v) => { const q = t.line[k]; const [x, y] = lateral(q, side * (d + extraAt(t, q, side))); return [x, y, q.z + v]; };
    const sec = (k) => { const d = wingDAt(t, k, side); return [corner(k, d, WING_BOTTOM_M), corner(k, d, top(k)), corner(k, d + t.wingT, top(k)), corner(k, d + t.wingT, WING_BOTTOM_M)]; };
    const centre = (k) => { const q = t.line[k]; const [x, y] = lateral(q, side * (wingDAt(t, k, side) + extraAt(t, q, side) + t.wingT / 2)); return [x, y, q.z + top(k) / 2]; };
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

/**
 * The gallery windows' structure, one { pos, uv } for all of them (null
 * without any): per window a parapet across the opening, a passage (floor,
 * walls, roof slabs) out to the face, and the face plate round the opening.
 */
export function buildWindowGeometry(t) {
  if (!t.windows?.length) return null;
  const T = makeTris();
  for (const w of t.windows) {
    const D = windowDims(t, w);
    const P = (a, r, v) => [w.x + a * w.tx + w.side * r * w.ty, w.y + a * w.ty - w.side * r * w.tx, w.z + w.grade * a + v];
    const quad = (A, B, C, Dd, uvs, want) => { T.tri(A, B, C, [uvs[0], uvs[1], uvs[2]], want); T.tri(A, C, Dd, [uvs[0], uvs[2], uvs[3]], want); };
    // a box in the window's frame, its faces outward
    const box = (a0, a1, r0, r1, v0, v1) => {
      const o = P((a0 + a1) / 2, (r0 + r1) / 2, (v0 + v1) / 2);
      const want = (c) => [c[0] - o[0], c[1] - o[1], c[2] - o[2]];
      const ua = (a1 - a0) / 4; const ur = (r1 - r0) / 4; const uv = (v1 - v0) / 4;
      const f = (A, B, C, Dd, du, dv) => quad(A, B, C, Dd, [[0, 0], [du, 0], [du, dv], [0, dv]], want);
      f(P(a0, r0, v0), P(a1, r0, v0), P(a1, r1, v0), P(a0, r1, v0), ua, ur);
      f(P(a0, r0, v1), P(a1, r0, v1), P(a1, r1, v1), P(a0, r1, v1), ua, ur);
      f(P(a0, r0, v0), P(a1, r0, v0), P(a1, r0, v1), P(a0, r0, v1), ua, uv);
      f(P(a0, r1, v0), P(a1, r1, v0), P(a1, r1, v1), P(a0, r1, v1), ua, uv);
      f(P(a0, r0, v0), P(a0, r1, v0), P(a0, r1, v1), P(a0, r0, v1), ur, uv);
      f(P(a1, r0, v0), P(a1, r1, v0), P(a1, r1, v1), P(a1, r0, v1), ur, uv);
    };
    const h = w.halfLen;
    // the opening's outline [a, v], grown by `inset` (the lining's outer
    // skin): floor, the far jamb, an arch over a gallery or the flat head of
    // a window, the near jamb
    const outline = (inset) => {
      const pts = [[-h - inset, w.floor - inset], [h + inset, w.floor - inset]];
      if (w.rise > 0) {
        const K = 10;
        for (let k = 0; k <= K; k++) {
          const th = (Math.PI * k) / K;
          pts.push([(h + inset) * Math.cos(th), w.spring + (w.rise + inset) * Math.sin(th)]);
        }
      } else {
        pts.push([h + inset, w.spring + inset], [-h - inset, w.spring + inset]);
      }
      return pts;
    };
    // the passage: its section swept from the tube's wall to the plate
    // (floor, walls, roof; the inner skin faces in, the outer out)
    for (const [inset, inward] of [[0, true], [LINING_M, false]]) {
      const loop = outline(inset);
      const centre = (r) => P(0, r, (w.floor + D.top) / 2);
      for (let k = 0; k < loop.length; k++) {
        const k2 = (k + 1) % loop.length;
        const [a0, v0] = loop[k]; const [a1, v1] = loop[k2];
        const want = (c) => { const o = centre((D.rP + t.W) / 2); const d = [c[0] - o[0], c[1] - o[1], c[2] - o[2]]; return inward ? d.map((v) => -v) : d; };
        const L = Math.hypot(a1 - a0, v1 - v0) / 4;
        quad(P(a0, t.W, v0), P(a1, t.W, v1), P(a1, D.rP, v1), P(a0, D.rP, v0), [[0, 0], [L, 0], [L, (D.rP - t.W) / 4], [0, (D.rP - t.W) / 4]], want);
      }
    }
    if (w.kind === 'gallery') {
      box(-h, h, t.W, t.W + LINING_M, w.floor - LINING_M, WINDOW_CURB_M);       // the step up from the road
      box(-h, h, D.rF - 0.5, D.rF, w.floor, w.sill);                            // the low wall at the face
    }
    // the face plate round the opening: the outline cut out of a slab
    const shape = new THREE.Shape();
    shape.moveTo(-D.plateHalf, D.plateBottom); shape.lineTo(D.plateHalf, D.plateBottom);
    shape.lineTo(D.plateHalf, D.plateTop); shape.lineTo(-D.plateHalf, D.plateTop); shape.closePath();
    const hole = new THREE.Path();
    outline(0).forEach(([a, v], k) => (k ? hole.lineTo(a, v) : hole.moveTo(a, v)));
    hole.closePath();
    shape.holes.push(hole);
    const g = new THREE.ExtrudeGeometry(shape, { depth: D.rF - D.rP, bevelEnabled: false, curveSegments: 1 }).toNonIndexed();
    const Pg = g.getAttribute('position');
    const sub = (m, n) => [m[0] - n[0], m[1] - n[1], m[2] - n[2]];
    const cross = (m, n) => [m[1] * n[2] - m[2] * n[1], m[2] * n[0] - m[0] * n[2], m[0] * n[1] - m[1] * n[0]];
    for (let k = 0; k < Pg.count; k += 3) {
      const loc = [0, 1, 2].map((j) => [Pg.getX(k + j), Pg.getY(k + j), Pg.getZ(k + j)]);
      // the extrusion's own facing, carried into the window's frame
      const nl = cross(sub(loc[1], loc[0]), sub(loc[2], loc[0]));
      const wv = P(nl[0], nl[2], nl[1]); const w0 = P(0, 0, 0);
      const want = () => sub(wv, w0);
      const world = loc.map(([a, v, d]) => P(a, D.rP + d, v));
      T.tri(world[0], world[1], world[2], loc.map(([a, v, d]) => [(a + d) / 4, v / 4]), want);
    }
    g.dispose();
  }
  return { pos: T.pos, uv: T.uv };
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
  // a gallery is open to the daylight on its valley side: no lights, no zones
  if (t.kind === 'gallery') return { lights: [], zones: [], lightCount: 0, zoneCount: 0, portalCount: 0 };
  const lights = [];
  lightStations(t, lightSpacing).forEach((i, k) => {
    const q = t.line[i];
    // over the middle of the section (off the road's centre where widened)
    const [cx, cy] = lateral(q, ((q.wr ?? t.W) - (q.wl ?? t.W)) / 2);
    const p = { ...q, x: cx, y: cy };
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
    let wide = t.W;
    for (let i = cuts[c]; i <= cuts[c + 1]; i++) {
      const q = t.line[i];
      sag = Math.max(sag, Math.abs((q.x - a.x) * (dy / Lc) - (q.y - a.y) * (dx / Lc)));
      wide = Math.max(wide, q.wl ?? t.W, q.wr ?? t.W);
    }
    const box = {
      position: [r3((a.x + b.x) / 2), r3((a.y + b.y) / 2), r3((a.z + b.z) / 2 + height / 2)],
      rotationMatrix: rot(yawTo(dx / Lc, dy / Lc)),
      scale: [r3(2 * wide + 3 + 2 * sag), r3(Lc + 1), r3(height + Math.abs(b.z - a.z) + 1.5)],
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
      scale: [r3(2 * Math.max(t.W, p.wl ?? t.W, p.wr ?? t.W) + 2), 6, r3(height + 1)],
    });
  });
  // a Portal through each window too: the zones render the world outside
  // only through their portals (from inside, the canyon past a window was
  // culled, sky only). Across the passage from inside the tube to the face,
  // so it spans the zone's wall wherever the chord puts it on a bend.
  (t.windows || []).forEach((w, k) => {
    const D = windowDims(t, w);
    const nx = w.side * w.ty; const ny = -w.side * w.tx;
    const r0 = t.W - 1; const r1 = Math.max(D.rF, t.W + 6) + 0.5;
    const rc = (r0 + r1) / 2;
    zones.push({
      class: 'Portal', name: `${group}_window_portal_${k + 1}`, persistentId: id(), __parent: `${group}_zones`,
      position: [r3(w.x + nx * rc), r3(w.y + ny * rc), r3(w.z + (w.floor + D.top) / 2)], rotationMatrix: rot(yawTo(nx, ny)),
      scale: [r3(2 * w.halfLen + 1), r3(r1 - r0), r3(D.top - w.floor + 1)],
    });
  });
  return { lights, zones, lightCount: lights.length / 2, zoneCount: cuts.length - 1, portalCount: cuts.length + (t.windows || []).length };
}
