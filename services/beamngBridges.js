// Bridge decks for BeamNG exports, after BeamNG.Earth (MIT; server/roads.py
// deck_heights / deck_profile_once / pier_sites, server/roadmesh.py deck).
//
// A bridge is a chain of OSM bridge parts joined end to end; its ends are the
// abutments, at the ground. The deck runs straight between them, lifted to
// clear what it crosses (a road under it, water), no steeper than MAX_GRADE
// from an abutment, never sagging between two higher points, then smoothed.
// MapNG solves every chain once in world space (BeamNG.Earth solves per
// streamed tile, the source of its seams) and lower decks before the ones
// above them, so a deck over a deck clears the solved one.
//
// Pure: callers pass world-space geometry and ground / water lookups.

export const DECK_STEP_M = 4;          // m between deck profile points
export const DECK_CLEAR_M = 0.05;      // a deck stays this far above the ground under it
export const DECK_ROAD_CLEAR_M = 6.5;  // its top over a road crossing under it (5 m headroom + the structure)
export const DECK_GRADE = 0.05;        // that requirement falls 5 % along the deck from the crossing
export const DECK_MAX_GRADE = 0.06;    // a deck climbs no steeper than this from an abutment
const AT_GRADE_M = 3;                  // a crossing within AT_GRADE_REACH_M of an abutment the deck cannot
const AT_GRADE_REACH_M = 12;           // get this far over is a junction at grade (a ramp starting in it)
const SIGMA_M = 12;                    // smoothing: at least ...
const SIGMA_SHARE = 25;                // ... a 25th of the chain ...
const SIGMA_MAX_M = 40;                // ... at most
const JOIN_M = 0.5;                    // part ends this close are one joint
const VERTICAL_CURVE_M = 40;           // grade changes ease in over this far (a vertical curve)

// A grade `slope` reached over `d` m, easing in over VERTICAL_CURVE_M (a
// parabola, then straight): the caps and clearance requirements have no
// corners, so a deck held to them has no kinks (BeamNG.Earth's straight caps
// put a 6 % grade break at every abutment, and a peak over every crossing).
const eased = (d, slope) => (d < VERTICAL_CURVE_M
  ? (slope * d * d) / (2 * VERTICAL_CURVE_M)
  : slope * (d - VERTICAL_CURVE_M / 2));

// Water: a deck clears a wet run by a share of its length (a river channel
// wants a ship's room); a very long run is a causeway, low over the water.
const WATER_CLEAR_SHARE = 0.15;
const WATER_CLEAR_MIN_M = 2.5;
// BeamNG.Earth allows 40 m; MapNG finds ship channels from OSM (NAV_CLEAR_M),
// so other water (Mill Cove beside the St. Johns) is crossed lower.
const WATER_CLEAR_MAX_M = 20;
const WATER_CAUSEWAY_M = 1500;
const WATER_CAUSEWAY_CLEAR_M = 5;
const WATER_STEP_M = 16;
// Ship channels: a long wet run that OSM marks as one (deep_draft / ship on
// the water), or under a cable-stayed or suspension bridge, takes a
// navigation clearance (Dames Point, Jacksonville: 53 m over the St. Johns,
// tagged deep_draft=yes; BeamNG.Earth reads it from the National Bridge
// Inventory).
export const NAV_CLEAR_M = 50;
const NAV_RUN_M = 100;
const NAV_STRUCTURES = new Set(['cable-stayed', 'suspension']);
export const navClearance = (structure) => (NAV_STRUCTURES.has(String(structure || '').toLowerCase()) ? NAV_CLEAR_M : 0);

export function waterClear(runM) {
  if (runM > WATER_CAUSEWAY_M) return WATER_CAUSEWAY_CLEAR_M;
  return Math.min(WATER_CLEAR_MAX_M, Math.max(WATER_CLEAR_MIN_M, WATER_CLEAR_SHARE * runM));
}

const arcLengths = (xy) => {
  const s = [0];
  for (let i = 1; i < xy.length; i++) s.push(s[i - 1] + Math.hypot(xy[i][0] - xy[i - 1][0], xy[i][1] - xy[i - 1][1]));
  return s;
};

/** A polyline resampled every `step` m (ends kept). */
export function resample(xy, step = DECK_STEP_M) {
  const s = arcLengths(xy);
  const L = s[s.length - 1];
  if (L < 1e-6) return [xy[0].slice()];
  const n = Math.max(1, Math.round(L / step));
  const out = [];
  let j = 0;
  for (let k = 0; k <= n; k++) {
    const t = (L * k) / n;
    while (j < s.length - 2 && s[j + 1] < t) j++;
    const f = (t - s[j]) / Math.max(1e-9, s[j + 1] - s[j]);
    out.push([xy[j][0] + (xy[j + 1][0] - xy[j][0]) * f, xy[j][1] + (xy[j + 1][1] - xy[j][1]) * f]);
  }
  return out;
}

// Upper concave hull: every dip between two higher points filled with the
// straight grade between them (no sag mid-bridge).
function noSag(s, z) {
  const hull = [];
  for (let i = 0; i < s.length; i++) {
    const p = [s[i], z[i]];
    while (hull.length >= 2) {
      const [x1, y1] = hull[hull.length - 2];
      const [x2, y2] = hull[hull.length - 1];
      if ((x2 - x1) * (p[1] - y1) - (y2 - y1) * (p[0] - x1) >= 0) hull.pop();
      else break;
    }
    hull.push(p);
  }
  const out = new Array(s.length);
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    while (h < hull.length - 2 && hull[h + 1][0] < s[i]) h++;
    const [x1, y1] = hull[h];
    const [x2, y2] = hull[Math.min(h + 1, hull.length - 1)];
    out[i] = x2 > x1 ? y1 + ((y2 - y1) * (s[i] - x1)) / (x2 - x1) : y1;
  }
  return out;
}

// Gaussian smoothing with both ends pinned: smooth the deviation from the
// straight line between the ends, extended oddly past them so they stay put.
function smoothPinned(z, step, sigmaM) {
  const n = z.length;
  if (n < 3) return z.slice();
  const line = (i) => z[0] + ((z[n - 1] - z[0]) * i) / (n - 1);
  const d = z.map((v, i) => v - line(i));
  const r = Math.max(1, Math.round((3 * sigmaM) / step));
  const sig = sigmaM / step;
  // odd extension past both ends, reflected as often as the window needs
  // (a short part can be narrower than the smoothing window)
  const at = (i) => {
    let sign = 1;
    for (;;) {
      if (i < 0) { i = -i; sign = -sign; } else if (i > n - 1) { i = 2 * (n - 1) - i; sign = -sign; } else return sign * d[i];
    }
  };
  const out = new Array(n);
  for (let i = 0; i < n; i++) {
    let num = 0;
    let den = 0;
    for (let k = -r; k <= r; k++) {
      const w = Math.exp(-(k * k) / (2 * sig * sig));
      num += w * at(i + k);
      den += w;
    }
    out[i] = num / den + line(i);
  }
  out[0] = z[0];
  out[n - 1] = z[n - 1];
  return out;
}

/** Bridge parts joined end to end: [[part index]...] per chain. */
export function chainBridgeParts(parts) {
  const key = (p) => `${Math.round(p[0] / JOIN_M)},${Math.round(p[1] / JOIN_M)}`;
  const parent = parts.map((_, i) => i);
  const find = (i) => { while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; } return i; };
  const byKey = new Map();
  parts.forEach((p, i) => {
    for (const end of [p.xy[0], p.xy[p.xy.length - 1]]) {
      const k = key(end);
      if (byKey.has(k)) parent[find(i)] = find(byKey.get(k));
      else byKey.set(k, i);
    }
  });
  const chains = new Map();
  parts.forEach((_, i) => {
    const r = find(i);
    if (!chains.has(r)) chains.set(r, []);
    chains.get(r).push(i);
  });
  return [...chains.values()];
}

/**
 * Deck heights of one chain of parts.
 *   parts: [{ xy: [[x, y]...] }] (resampled), joined at shared ends
 *   groundAt(x, y): ground height
 *   crossings: [{ part, s, z, clear? }]: something under the deck at arc s of
 *     part (z its height; clear its own clearance, default the road's)
 *   endHeight(x, y): the height an abutment at (x, y) meets the road at
 *     (default the ground there)
 *   isFreeEnd(x, y): a chain end that is not an abutment (the bridge runs on
 *     past the map's edge): neither pinned to the ground nor capping the grade
 * Returns [z array per part] with .shortfall (m the deck stays under what it
 * should clear) and .abutments ([[x, y]] of its ground ends).
 */
export function solveChain(parts, { groundAt, endHeight = groundAt, crossings = [], isFreeEnd = () => false, isAbutment = () => false }) {
  const key = (p) => `${Math.round(p[0] / JOIN_M)},${Math.round(p[1] / JOIN_M)}`;
  const nodeIds = new Map();
  const node = (p) => {
    const k = key(p);
    if (!nodeIds.has(k)) nodeIds.set(k, nodeIds.size);
    return nodeIds.get(k);
  };
  const edges = parts.map((p) => {
    const s = arcLengths(p.xy);
    return { a: node(p.xy[0]), b: node(p.xy[p.xy.length - 1]), s, L: s[s.length - 1] };
  });
  const nNodes = nodeIds.size;
  const deg = new Array(nNodes).fill(0);
  const adj = Array.from({ length: nNodes }, () => []);
  for (const e of edges) {
    deg[e.a]++;
    deg[e.b]++;
    adj[e.a].push([e.b, e.L]);
    adj[e.b].push([e.a, e.L]);
  }
  const dijkstra = (seeds) => {
    const d = new Array(nNodes).fill(Infinity);
    const q = [];
    for (const [n, v] of seeds) { if (v < d[n]) { d[n] = v; q.push([v, n]); } }
    while (q.length) {
      q.sort((x, y) => x[0] - y[0]);
      const [dd, u] = q.shift();
      if (dd > d[u]) continue;
      for (const [v, w] of adj[u]) {
        if (dd + w < d[v]) { d[v] = dd + w; q.push([dd + w, v]); }
      }
    }
    return d;
  };
  // Distance along the chain from a node-distance field to every point.
  const along = (d, e, k) => (k === undefined ? null : Math.min(d[e.a] + e.s[k], d[e.b] + (e.L - e.s[k])));

  const ground = parts.map((p) => p.xy.map(([x, y]) => groundAt(x, y)));
  const endXY = new Map();
  parts.forEach((p, i) => {
    endXY.set(edges[i].a, p.xy[0]);
    endXY.set(edges[i].b, p.xy[p.xy.length - 1]);
  });
  const ends = [];
  const free = new Set();
  for (let n = 0; n < nNodes; n++) {
    // a deck's ends; and a joint a ground road starts from (two carriageways
    // carried on to where they meet the street they become: the deck is down
    // at the street there, not a joint in mid-air)
    if (deg[n] !== 1) {
      if (isAbutment(...endXY.get(n))) ends.push(n);
      continue;
    }
    if (isFreeEnd(...endXY.get(n))) free.add(n);
    else ends.push(n);
  }
  const endZ = ends.map((n) => endHeight(...endXY.get(n)));
  const endDist = ends.map((n) => dijkstra([[n, 0]]));

  // Base: abutment heights weighted by 1 / distance along the chain (a
  // straight grade between two abutments); caps: MAX_GRADE from each, but
  // never below the base: abutments further apart in height than MAX_GRADE
  // allows (a bridge on a hillside road) are joined by the straight grade,
  // never by dragging the high end down to the low one's cap, metres under
  // the road arriving at it.
  const base = [];
  const cap = [];
  const toAbut = [];
  edges.forEach((e, i) => {
    const b = [];
    const c = [];
    const t = [];
    for (let k = 0; k < e.s.length; k++) {
      let num = 0;
      let den = 0;
      let cp = Infinity;
      let ta = Infinity;
      endDist.forEach((d, j) => {
        const dk = along(d, e, k);
        if (!Number.isFinite(dk)) return;
        const w = 1 / Math.max(dk, 1e-6);
        num += w * endZ[j];
        den += w;
        cp = Math.min(cp, endZ[j] + eased(dk, DECK_MAX_GRADE));
        ta = Math.min(ta, dk);
      });
      b.push(den > 0 ? num / den : ground[i][k]);
      c.push(den > 0 ? Math.max(cp, num / den) : cp);
      t.push(ta);
    }
    base.push(b);
    cap.push(c);
    toAbut.push(t);
  });

  const interp = (arr, s, sv) => {
    let j = 0;
    while (j < s.length - 2 && s[j + 1] < sv) j++;
    const f = Math.min(1, Math.max(0, (sv - s[j]) / Math.max(1e-9, s[j + 1] - s[j])));
    return arr[j] + (arr[j + 1] - arr[j]) * f;
  };

  // Requirements: each crossing's height + clearance, falling along the chain.
  const req = edges.map((e) => new Array(e.s.length).fill(-Infinity));
  for (const cr of crossings) {
    const e = edges[cr.part];
    const d = dijkstra([[e.a, cr.s], [e.b, e.L - cr.s]]);
    const clear = cr.clear ?? DECK_ROAD_CLEAR_M;
    // A road the deck meets right by an abutment and cannot clear is a
    // junction at grade: the deck comes down to it instead.
    const atGrade = cr.clear == null && !cr.major
      && interp(toAbut[cr.part], e.s, cr.s) <= AT_GRADE_REACH_M
      && interp(cap[cr.part], e.s, cr.s) < cr.z + AT_GRADE_M;
    edges.forEach((e2, i) => {
      for (let k = 0; k < e2.s.length; k++) {
        let dk = along(d, e2, k);
        if (i === cr.part) dk = Math.min(dk, Math.abs(e2.s[k] - cr.s));
        if (atGrade) { cap[i][k] = Math.min(cap[i][k], cr.z + eased(dk, DECK_MAX_GRADE)); cr.atGrade = true; }
        else req[i][k] = Math.max(req[i][k], cr.z + clear - eased(dk, DECK_GRADE));
      }
    });
  }

  // Where both abutments' grade caps meet they form a peak; a deck squeezed up
  // against it (a short overpass that cannot quite clear) would crest at it.
  // Round the caps off: smoothing a peak only lowers it.
  edges.forEach((e, i) => {
    if (e.s.length < 3 || !cap[i].every(Number.isFinite)) return;
    const sigma = Math.min(SIGMA_MAX_M, Math.max(SIGMA_M, e.L / SIGMA_SHARE));
    const rounded = smoothPinned(cap[i], e.L / (e.s.length - 1), sigma);
    cap[i] = cap[i].map((v, k) => Math.min(v, rounded[k]));
  });

  const result = edges.map((e, i) => {
    const n = e.s.length;
    let z = base[i].map((v, k) => Math.max(Math.min(Math.max(v, req[i][k]), cap[i][k]), ground[i][k] + DECK_CLEAR_M));
    if (deg[e.a] === 1 && !free.has(e.a)) z[0] = base[i][0];
    if (deg[e.b] === 1 && !free.has(e.b)) z[n - 1] = base[i][n - 1];
    if (n > 3) {
      const filled = noSag(e.s, z);
      z = z.map((v, k) => Math.max(Math.min(filled[k], Math.max(cap[i][k], v)), v));
      const step = e.L / (n - 1);
      const sigma = Math.min(SIGMA_MAX_M, Math.max(SIGMA_M, e.L / SIGMA_SHARE));
      // Smoothing rounds a crest off below the clearance it was lifted for
      // (BeamNG.Earth loses ~0.4 m over a road this way), and clamping it back
      // point by point leaves a ridge. Instead lift the deck by the smoothed
      // shortfall (and lower it by the smoothed overshoot of its caps) until
      // both are under a centimetre: a broad swell, no ridge.
      const floor = z.map((v, k) => Math.min(Math.max(req[i][k], ground[i][k] + DECK_CLEAR_M), cap[i][k]));
      let sm = smoothPinned(z, step, sigma);
      for (let pass = 0; pass < 12; pass++) {
        const short = sm.map((v, k) => Math.max(0, floor[k] - v));
        const over = sm.map((v, k) => Math.max(0, v - cap[i][k]));
        const worst = Math.max(...short, ...over);
        if (worst < 0.01) break;
        const lift = smoothPinned(short, step, sigma / 2);
        const drop = smoothPinned(over, step, sigma / 2);
        // a smoothed peak is lower than the one it came from: scale it back up
        const gain = (arr, src) => { const m = Math.max(...arr); return m > 1e-9 ? Math.max(...src) / m : 0; };
        const gl = gain(lift, short);
        const gd = gain(drop, over);
        sm = sm.map((v, k) => v + lift[k] * gl - drop[k] * gd);
      }
      z = sm.map((v, k) => Math.max(Math.min(v, cap[i][k]), floor[k], ground[i][k] + DECK_CLEAR_M));
      z[0] = sm[0];
      z[n - 1] = sm[n - 1];
    }
    return z;
  });
  let shortfall = 0;
  result.forEach((z, i) => z.forEach((v, k) => { if (Number.isFinite(req[i][k])) shortfall = Math.max(shortfall, req[i][k] - v); }));
  result.shortfall = shortfall;
  // Lowest road-to-road gap over the roads each part crosses (not water).
  result.minGap = edges.map(() => Infinity);
  for (const cr of crossings) {
    if (cr.clear != null) continue;
    const z = interp(result[cr.part], edges[cr.part].s, cr.s);
    result.minGap[cr.part] = Math.min(result.minGap[cr.part], z - cr.z);
  }
  // How far under its clearance over the roads it crosses (water aside).
  result.roadShortfall = 0;
  for (const cr of crossings) {
    if (cr.clear != null || cr.atGrade) continue;   // (a junction at grade by an abutment: not cleared)
    const z = interp(result[cr.part], edges[cr.part].s, cr.s);
    result.roadShortfall = Math.max(result.roadShortfall, cr.z + DECK_ROAD_CLEAR_M - z);
  }
  result.abutments = ends.map((n) => endXY.get(n));
  return result;
}

/**
 * Wet runs along a part (wetAt(x, y) → bool) as crossings with their own
 * clearance over the water surface (the ground there).
 */
export function waterCrossings(partIndex, xy, { wetAt, groundAt, nav = 0 }) {
  const s = arcLengths(xy);
  const wetness = xy.map(([x, y]) => Number(wetAt(x, y)) || 0);   // 0 dry, 1 water, 2 ship channel
  const wet = wetness.map((w) => w > 0);
  const out = [];
  let i = 0;
  while (i < wet.length) {
    if (!wet[i]) { i++; continue; }
    let j = i;
    while (j + 1 < wet.length && wet[j + 1]) j++;
    const run = s[j] - s[i] + (s[1] ?? 0);
    // a ship channel under it (or a cable-stayed / suspension bridge over it)
    const channel = wetness.slice(i, j + 1).some((w) => w >= 2) ? NAV_CLEAR_M : nav;
    const clear = Math.max(waterClear(run), run >= NAV_RUN_M ? channel : 0);
    for (let sc = s[i]; sc <= s[j] + 1e-6; sc += WATER_STEP_M) {
      let k = 0;
      while (k < s.length - 2 && s[k + 1] < sc) k++;
      const f = (sc - s[k]) / Math.max(1e-9, s[k + 1] - s[k]);
      const x = xy[k][0] + (xy[k + 1][0] - xy[k][0]) * f;
      const y = xy[k][1] + (xy[k + 1][1] - xy[k][1]) * f;
      out.push({ part: partIndex, s: sc, z: groundAt(x, y), clear });
    }
    i = j + 1;
  }
  return out;
}

/**
 * Solve every bridge: parts [{ xy (world, any spacing), half, layer }];
 * lowerLines(part) → [{ xy: [[x, y, z]...] }] things under it that are not
 * bridges (roads, with their ground heights); decks of lower layers are
 * solved first and crossed like roads.
 * Returns [{ parts: [{ index, xy, z, half }] }] per chain.
 */
export function solveBridgeDecks(parts, {
  groundAt, endHeight = groundAt, wetAt = () => false, lowerRoads = [], isFreeEnd = () => false,
  isAbutment = () => false,
} = {}) {
  const resampled = parts.map((p) => ({ ...p, xy: resample(p.xy) }));
  const bbox = (xy, pad = 0) => {
    let minX = Infinity; let minY = Infinity; let maxX = -Infinity; let maxY = -Infinity;
    for (const [x, y] of xy) { minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y); }
    return [minX - pad, minY - pad, maxX + pad, maxY + pad];
  };
  const overlaps = (a, b) => a[0] <= b[2] && b[0] <= a[2] && a[1] <= b[3] && b[1] <= a[3];
  const roads = lowerRoads.map((r) => ({ ...r, box: bbox(r.xy) }));
  const chains = chainBridgeParts(resampled)
    .map((idx) => ({ idx, layer: Math.min(...idx.map((i) => resampled[i].layer ?? 1)) }))
    .sort((a, b) => a.layer - b.layer);
  const solvedLines = [];
  const decks = [];
  for (const { idx, layer } of chains) {
    const chainParts = idx.map((i) => resampled[i]);
    const crossings = [];
    const nav = Math.max(0, ...chainParts.map((p) => navClearance(p.structure)));
    chainParts.forEach((p, pi) => {
      const box = bbox(p.xy, 1);
      const under = [
        ...roads.filter((r) => (r.layer ?? 0) < (p.layer ?? 1) && overlaps(box, r.box)),
        ...solvedLines.filter((r) => r.layer < (p.layer ?? 1) && overlaps(box, r.box)),
      ];
      crossings.push(...planCrossings(pi, p.xy, under, groundAt));
      crossings.push(...waterCrossings(pi, p.xy, { wetAt, groundAt, nav }));
    });
    const zs = solveChain(chainParts, { groundAt, endHeight, crossings, isFreeEnd, isAbutment });
    mergeOverlaps(chainParts.map((p, k) => ({ xy: p.xy, half: p.half, z: zs[k] })));
    const deck = {
      layer,
      parts: chainParts.map((p, k) => ({
        index: idx[k], xy: p.xy, z: zs[k], half: p.half, minGap: zs.minGap[k], depth: structureDepth(zs.minGap[k]),
      })),
      shortfall: zs.shortfall,
      roadShortfall: zs.roadShortfall,
      abutments: zs.abutments,
      // for the export report: what it was lifted over
      crossed: { roads: crossings.filter((c) => c.clear == null).length, water: crossings.filter((c) => c.clear != null).length, nav },
    };
    decks.push(deck);
    for (const p of deck.parts) solvedLines.push({ layer, deck: true, xy: p.xy.map(([x, y], k) => [x, y, p.z[k]]), box: bbox(p.xy) });
  }
  return decks;
}

// Where a ramp forks off a deck (or two merge), the branches overlap in
// plan for tens of metres after the shared node, each solved to its own
// heights: two surfaces a step apart, undrivable. Walking out from the fork,
// each branch takes the height the two share while it overlaps the other,
// fading back to its own as they separate. (Only overlap running on from the
// fork: a ramp crossing over its own deck elsewhere is one over the other.)
const MERGE_FADE_M = 10;     // lateral room past touching over which the merge fades

/** The nearest interior point of a polyline part to (x, y): { d, z } or null at its ends. */
function nearestInterior(part, x, y) {
  const { xy, z } = part;
  let best = null;
  for (let i = 0; i + 1 < xy.length; i++) {
    const vx = xy[i + 1][0] - xy[i][0]; const vy = xy[i + 1][1] - xy[i][1];
    const L2 = vx * vx + vy * vy || 1e-9;
    const raw = ((x - xy[i][0]) * vx + (y - xy[i][1]) * vy) / L2;
    const t = Math.max(0, Math.min(1, raw));
    const d = Math.hypot(xy[i][0] + vx * t - x, xy[i][1] + vy * t - y);
    if (!best || d < best.d) best = { d, z: z[i] + (z[i + 1] - z[i]) * t, end: (i === 0 && raw < 0) || (i === xy.length - 2 && raw > 1) };
  }
  return best && !best.end ? best : null;
}

/** Merge the heights of a chain's branches where they overlap off a fork (edits z in place). */
export function mergeOverlaps(parts) {
  const key = (p) => `${Math.round(p[0] / JOIN_M)},${Math.round(p[1] / JOIN_M)}`;
  const joints = new Map();
  parts.forEach((p, i) => {
    if (p.xy.length < 2) return;
    for (const k of [0, p.xy.length - 1]) {
      const j = key(p.xy[k]);
      if (!joints.has(j)) joints.set(j, []);
      joints.get(j).push({ i, k });
    }
  });
  const delta = parts.map((p) => p.z.map(() => 0));
  const weight = parts.map((p) => p.z.map(() => 0));
  for (const ends of joints.values()) {
    if (ends.length < 3) continue;   // a fork (or merge) only
    for (const ea of ends) {
      for (const eb of ends) {
        if (ea.i === eb.i) continue;
        const a = parts[ea.i]; const b = parts[eb.i];
        const reach = a.half + b.half;
        const order = ea.k === 0 ? a.xy.map((_, k) => k) : a.xy.map((_, k) => a.xy.length - 1 - k);
        let started = false;
        for (const k of order) {
          const n = nearestInterior(b, a.xy[k][0], a.xy[k][1]);
          if (!n) { if (started) break; continue; }
          started = true;
          const w = n.d <= reach ? 1 : 1 - (n.d - reach) / MERGE_FADE_M;
          if (w <= 0) break;
          delta[ea.i][k] += w * ((a.z[k] + n.z) / 2 - a.z[k]);
          weight[ea.i][k] += w;
        }
      }
    }
  }
  parts.forEach((p, i) => {
    for (let k = 0; k < p.z.length; k++) if (weight[i][k] > 0) p.z[k] += delta[i][k] / Math.max(1, weight[i][k]);
  });
}

// Where a part crosses lines under it in plan: [{ part, s, z }]. Ground roads
// (no `deck`) take the ground's height right there: their OSM vertices can be
// hundreds of metres apart, and the ground between them is not a straight line.
function planCrossings(partIndex, xy, lines, groundAt) {
  const s = arcLengths(xy);
  const out = [];
  for (const line of lines) {
    const q = line.xy;
    for (let i = 0; i + 1 < xy.length; i++) {
      const [ax, ay] = xy[i];
      const [bx, by] = xy[i + 1];
      for (let j = 0; j + 1 < q.length; j++) {
        const [cx, cy, cz] = q[j];
        const [dx, dy, dz] = q[j + 1];
        const den = (bx - ax) * (dy - cy) - (by - ay) * (dx - cx);
        if (Math.abs(den) < 1e-9) continue;
        const t = ((cx - ax) * (dy - cy) - (cy - ay) * (dx - cx)) / den;
        const u = ((cx - ax) * (by - ay) - (cy - ay) * (bx - ax)) / den;
        if (t < 0 || t > 1 || u < 0 || u > 1) continue;
        // a road that starts where the bridge does (its approach) only
        // touches it: no crossing
        const px = ax + (bx - ax) * t;
        const py = ay + (by - ay) * t;
        const near = (p) => Math.hypot(p[0] - px, p[1] - py) < 1;
        if ((near(xy[0]) || near(xy[xy.length - 1])) && (near(q[0]) || near(q[q.length - 1]))) continue;
        // (a major road under it is no ramp starting at the abutment: it is
        // always cleared, never met at grade; nor is a road with no node
        // anywhere near the crossing, which joins nothing there: Norfolk's
        // loop ramps under 26 m I-264 decks)
        const through = q.every((v) => Math.hypot(v[0] - px, v[1] - py) > AT_GRADE_REACH_M + AT_GRADE_M);
        out.push({ part: partIndex, s: s[i] + t * (s[i + 1] - s[i]), z: line.deck ? cz + (dz - cz) * u : groundAt(px, py), major: !!line.major || through });
      }
    }
  }
  return out;
}

/** Deck height at (x, y) on a solved part (nearest point of its centreline). */
export function deckHeightAt(part, x, y) {
  let best = Infinity;
  let z = part.z[0];
  for (let i = 0; i + 1 < part.xy.length; i++) {
    const [ax, ay] = part.xy[i];
    const [bx, by] = part.xy[i + 1];
    const vx = bx - ax;
    const vy = by - ay;
    const L2 = vx * vx + vy * vy || 1e-9;
    const t = Math.max(0, Math.min(1, ((x - ax) * vx + (y - ay) * vy) / L2));
    const d = Math.hypot(ax + vx * t - x, ay + vy * t - y);
    if (d < best) { best = d; z = part.z[i] + (part.z[i + 1] - part.z[i]) * t; }
  }
  return z;
}

// ── Geometry (BeamNG.Earth roadmesh.deck proportions) ──────────────────────

export const DECK_DEPTH_M = 1.2;       // slab under the road surface
const GIRDER_D_M = 1.0;                // girders under the slab
const MIN_SLAB_M = 0.4;
const HEADROOM_KEEP_M = 3.2;           // headroom a thinner structure keeps for the road below
const GIRDER_W_M = 0.6;
const GIRDER_EVERY_M = 3;
export const PARAPET_W_M = 0.45;       // slab past the road's edge, a parapet on it
const PARAPET_H_M = 0.9;
const FOOTING_M = 2;                   // a pier reaches this far into the ground
const PIER_T_M = 1.8;                  // a wall pier's thickness along the deck
const PIER_CAP_H_M = 1.2;
const PIER_BENT_W_M = 16;              // a deck wider than this stands on columns
const PIER_COLUMN_M = 1.6;
const PIER_SPAN_M = 32;                // between piers, longer under a high deck
const PIER_SPAN_PER_M = 0.6;
const PIER_SPAN_MAX_M = 60;
const PIER_MIN_CLEAR_M = 1.5;          // lower than this under the girders: the deck rests on the ground
const PIER_ROAD_M = 7;                 // a pier keeps this far from a road's centreline under the deck
const UV_M = 4;                        // concrete texture repeat
const WALL_GAP_M = 2.5;                // under the structure less than this to the ground: walls down into it

class Builder {
  constructor() { this.pos = []; this.uv = []; }
  // Triangle a-b-c turned to face `want`; uv from the face's orientation.
  tri(a, b, c, want) {
    const n = [
      (b[1] - a[1]) * (c[2] - a[2]) - (b[2] - a[2]) * (c[1] - a[1]),
      (b[2] - a[2]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[2] - a[2]),
      (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]),
    ];
    const pts = n[0] * want[0] + n[1] * want[1] + n[2] * want[2] < 0 ? [a, c, b] : [a, b, c];
    const flat = Math.abs(want[2]) > 0.7;
    for (const p of pts) {
      this.pos.push(p[0], p[1], p[2]);
      if (flat) this.uv.push(p[0] / UV_M, p[1] / UV_M);
      else this.uv.push((p[0] * -want[1] + p[1] * want[0]) / UV_M, p[2] / UV_M);
    }
  }
  quad(a, b, c, d, want) { this.tri(a, b, c, want); this.tri(a, c, d, want); }
  // A strip between point rows A and B, each face looking to want(i).
  strip(A, B, want) {
    for (let i = 0; i + 1 < A.length; i++) this.quad(A[i], A[i + 1], B[i + 1], B[i], want(i));
  }
  // A box: centre (x, y), along unit u, half sizes along / across, from zb to zt.
  box(x, y, u, ha, hc, zb, zt) {
    const nrm = [-u[1], u[0]];
    const c = (sa, sc, z) => [x + u[0] * ha * sa + nrm[0] * hc * sc, y + u[1] * ha * sa + nrm[1] * hc * sc, z];
    const faces = [
      [[1, -1], [1, 1], [u[0], u[1], 0]],
      [[-1, 1], [-1, -1], [-u[0], -u[1], 0]],
      [[1, 1], [-1, 1], [nrm[0], nrm[1], 0]],
      [[-1, -1], [1, -1], [-nrm[0], -nrm[1], 0]],
    ];
    for (const [[sa0, sc0], [sa1, sc1], want] of faces) {
      this.quad(c(sa0, sc0, zb), c(sa1, sc1, zb), c(sa1, sc1, zt), c(sa0, sc0, zt), want);
    }
    this.quad(c(-1, -1, zt), c(1, -1, zt), c(1, 1, zt), c(-1, 1, zt), [0, 0, 1]);
  }
}

// Unit left normals of a polyline (mitred at the joints).
function leftNormals(xy) {
  return xy.map((p, i) => {
    const a = xy[Math.max(0, i - 1)];
    const b = xy[Math.min(xy.length - 1, i + 1)];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
    return [-(b[1] - a[1]) / len, (b[0] - a[0]) / len];
  });
}

const nearAnySegment = (p, lines, r) => lines.some((line) => {
  for (let j = 0; j + 1 < line.length; j++) {
    const [ax, ay] = line[j];
    const [bx, by] = line[j + 1];
    const vx = bx - ax; const vy = by - ay;
    const L2 = vx * vx + vy * vy || 1e-9;
    const t = Math.max(0, Math.min(1, ((p[0] - ax) * vx + (p[1] - ay) * vy) / L2));
    if (Math.hypot(ax + vx * t - p[0], ay + vy * t - p[1]) < r) return true;
  }
  return false;
});

/**
 * Piers under one solved part: [{ x, y, u, width, zTop, zBottom }], evenly
 * spaced, none where the deck nearly rests on the ground, moved off (or left
 * out next to) the roads under it.
 */
export function pierSites(part, { groundAt, roadLines = [] }) {
  const { xy, z, half } = part;
  const s = arcLengths(xy);
  const L = s[s.length - 1];
  const heights = xy.map(([x, y], k) => z[k] - groundAt(x, y)).sort((a, b) => a - b);
  const h = heights[Math.floor(heights.length / 2)];
  const span = Math.min(PIER_SPAN_MAX_M, Math.max(PIER_SPAN_M, PIER_SPAN_M + PIER_SPAN_PER_M * Math.max(h, 0)));
  const n = Math.round(L / span);
  if (n < 2) return [];
  const width = 2 * (half + PARAPET_W_M);
  const pw = Math.min(14, Math.max(2.5, 0.7 * width));
  const under = part.depth ?? DECK_DEPTH_M + GIRDER_D_M;
  const out = [];
  for (let i = 1; i < n; i++) {
    for (const off of [0, 0.25, -0.25, 0.4, -0.4]) {
      const sc = (L * i) / n + off * span;
      if (sc < 0.5 * span || sc > L - 0.5 * span) continue;
      let j = 0;
      while (j < s.length - 2 && s[j + 1] < sc) j++;
      const f = (sc - s[j]) / Math.max(1e-9, s[j + 1] - s[j]);
      const x = xy[j][0] + (xy[j + 1][0] - xy[j][0]) * f;
      const y = xy[j][1] + (xy[j + 1][1] - xy[j][1]) * f;
      const len = Math.hypot(xy[j + 1][0] - xy[j][0], xy[j + 1][1] - xy[j][1]) || 1;
      const u = [(xy[j + 1][0] - xy[j][0]) / len, (xy[j + 1][1] - xy[j][1]) / len];
      const nrm = [-u[1], u[0]];
      const foot = [[x, y], [x + nrm[0] * pw / 2, y + nrm[1] * pw / 2], [x - nrm[0] * pw / 2, y - nrm[1] * pw / 2]];
      if (foot.some((p) => nearAnySegment(p, roadLines, PIER_ROAD_M))) continue;
      const zTop = z[j] + (z[j + 1] - z[j]) * f - under;
      const g = groundAt(x, y);
      if (zTop - g < PIER_MIN_CLEAR_M) break;
      out.push({ x, y, u, width, pierWidth: pw, zTop, zBottom: g - FOOTING_M });
      break;
    }
  }
  return out;
}

// Deck widths at joins. Parts are as wide as their own road, so where a
// wide road forks into narrower ramps the branches (both starting on its
// centreline) left its edges hanging, and a narrow part joining a wide one
// met it with a step. At a fork the outermost branches widen on their outer
// side to the incoming deck's edge, tapering back over their overlap; at a
// plain join the narrower part tapers up to the wider one.
const TAPER_MIN_M = 25;
const TAPER_MAX_M = 90;

/**
 * Per-point half widths of a deck's parts: [{ hl, hr }] (left / right of
 * each part's own direction), from part.half widened at joins as above.
 */
export function deckEdges(deck) {
  const parts = deck.parts;
  const edges = parts.map((p) => ({ hl: p.xy.map(() => p.half), hr: p.xy.map(() => p.half) }));
  // fork joints: the incoming deck's direction of travel into the branches
  edges.forks = new Map();
  const key = (p) => `${Math.round(p[0] / JOIN_M)},${Math.round(p[1] / JOIN_M)}`;
  const joints = new Map();
  parts.forEach((p, pi) => {
    if (p.xy.length < 2) return;
    for (const k of [0, p.xy.length - 1]) {
      const j = key(p.xy[k]);
      if (!joints.has(j)) joints.set(j, []);
      joints.get(j).push({ pi, k });
    }
  });
  // points from an end inward, with their distance from it
  const fromEnd = ({ pi, k }) => {
    const xy = parts[pi].xy;
    const order = k === 0 ? xy.map((_, i) => i) : xy.map((_, i) => xy.length - 1 - i);
    let d = 0;
    return order.map((i, n) => {
      if (n > 0) d += Math.hypot(xy[i][0] - xy[order[n - 1]][0], xy[i][1] - xy[order[n - 1]][1]);
      return { i, d };
    });
  };
  // the direction an end leaves its joint (over its first ~10 m)
  const outward = (end) => {
    const pts = fromEnd(end);
    const far = pts.find((q) => q.d >= 10) || pts[pts.length - 1];
    const xy = parts[end.pi].xy; const a = xy[pts[0].i]; const b = xy[far.i];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
    return [(b[0] - a[0]) / len, (b[1] - a[1]) / len];
  };
  const smooth = (t) => t * t * (3 - 2 * t);
  // widen one side ('l' / 'r' of the part's own direction) from an end
  const widen = (end, side, target, L) => {
    const e = edges[end.pi][side === 'l' ? 'hl' : 'hr'];
    const own = parts[end.pi].half;
    if (target <= own) return;
    for (const { i, d } of fromEnd(end)) {
      if (d >= L) break;
      e[i] = Math.max(e[i], own + (target - own) * smooth(1 - d / L));
    }
  };
  // outward-left of an end, as the part's own side
  const leftOf = (end) => (end.k === 0 ? 'l' : 'r');
  const rightOf = (end) => (end.k === 0 ? 'r' : 'l');
  for (const ends of joints.values()) {
    if (ends.length === 2) {
      const [a, b] = ends;
      const [n, w] = parts[a.pi].half < parts[b.pi].half ? [a, b] : [b, a];
      for (const side of ['l', 'r']) widen(n, side, parts[w.pi].half, TAPER_MIN_M);
      continue;
    }
    if (ends.length < 3) continue;
    const dirs = ends.map(outward);
    // the incoming deck: leaving the joint against all the others
    const ti = ends.findIndex((_, i) => ends.every((__, j) => j === i || dirs[i][0] * dirs[j][0] + dirs[i][1] * dirs[j][1] < 0));
    if (ti < 0) continue;
    const trunk = ends[ti];
    const fwd = [-dirs[ti][0], -dirs[ti][1]];
    // a fork only where every branch runs on ahead (not a crossroads' side
    // streets, which square to nothing)
    if (ends.some((_, i) => i !== ti && dirs[i][0] * fwd[0] + dirs[i][1] * fwd[1] < 0.5)) continue;
    edges.forks.set(key(parts[trunk.pi].xy[trunk.k]), { fwd, trunk: trunk.pi });
    const branches = ends.map((e, i) => ({ e, ang: Math.atan2(fwd[0] * dirs[i][1] - fwd[1] * dirs[i][0], fwd[0] * dirs[i][0] + fwd[1] * dirs[i][1]) }))
      .filter((_, i) => i !== ti).sort((a, b) => b.ang - a.ang);
    const H = parts[trunk.pi].half;
    // over how long the outermost branches overlap each other
    const lb = branches[0].e; const rb = branches[branches.length - 1].e;
    const reach = parts[lb.pi].half + parts[rb.pi].half;
    let overlap = 0;
    for (const { i, d } of fromEnd(lb)) {
      const q = parts[lb.pi].xy[i];
      const n = nearestInterior(parts[rb.pi], q[0], q[1]);
      if (n && n.d > reach) break;
      overlap = d;
    }
    const L = Math.min(TAPER_MAX_M, Math.max(TAPER_MIN_M, overlap));
    widen(lb, leftOf(lb), H, L);
    widen(rb, rightOf(rb), H, L);
    // an incoming deck narrower than a branch meets it widened instead
    const widest = Math.max(...branches.map((x) => parts[x.e.pi].half));
    for (const side of ['l', 'r']) widen(trunk, side, widest, TAPER_MIN_M);
  }
  return edges;
}

/**
 * The concrete of one solved deck as triangle soup: { positions, uvs }
 * (world space): slab with girders under it, a parapet along each edge,
 * piers.
 */
export function buildDeckGeometry(deck, { groundAt, roadLines = [], neighbours: allNeighbours = [] } = {}) {
  const b = new Builder();
  // other decks' parts near this one (their edges can stand on its parts)
  const box = [Infinity, Infinity, -Infinity, -Infinity];
  for (const p of deck.parts) for (const [x, y] of p.xy) { box[0] = Math.min(box[0], x); box[1] = Math.min(box[1], y); box[2] = Math.max(box[2], x); box[3] = Math.max(box[3], y); }
  const neighbours = allNeighbours.filter((q) => q.xy.some(([x, y]) => x > box[0] - 40 && x < box[2] + 40 && y > box[1] - 40 && y < box[3] + 40));
  // part ends by joint: one end is the deck's end (an end cap), two a plain
  // join (mitred flush, no cap), more a fork (no cap)
  const key = (p) => `${Math.round(p[0] / JOIN_M)},${Math.round(p[1] / JOIN_M)}`;
  const atJoint = new Map();
  deck.parts.forEach((part, pi) => {
    if (part.xy.length < 2) return;
    for (const k of [0, part.xy.length - 1]) {
      const j = key(part.xy[k]);
      if (!atJoint.has(j)) atJoint.set(j, []);
      atJoint.get(j).push({ pi, k });
    }
  });
  const edges = deckEdges(deck);
  for (const [pi, part] of deck.parts.entries()) {
    const { xy, z } = part;
    if (xy.length < 2) continue;
    const { hl, hr } = edges[pi];
    const depth = part.depth ?? DECK_DEPTH_M + GIRDER_D_M;
    const slab = Math.min(DECK_DEPTH_M, depth);
    const girders = depth >= DECK_DEPTH_M + GIRDER_D_M - 1e-6;
    const nrm = leftNormals(xy);
    // across a plain join, the normal of both parts together; at a fork,
    // the incoming deck's (all ends square to it: edges meeting flush)
    for (const k of [0, xy.length - 1]) {
      const fork = edges.forks.get(key(xy[k]));
      if (fork) {
        // leaving the joint: the branches along fwd, the incoming deck against it
        const out = fork.trunk === pi ? [-fork.fwd[0], -fork.fwd[1]] : fork.fwd;
        const t = k === 0 ? out : [-out[0], -out[1]];
        nrm[k] = [-t[1], t[0]];
        continue;
      }
      const here = atJoint.get(key(xy[k])) || [];
      if (here.length !== 2) continue;
      const other = here.find((e) => e.pi !== pi);
      const o = deck.parts[other.pi].xy;
      const beyond = other.k === 0 ? o[1] : o[o.length - 2];
      const before = k === 0 ? beyond : xy[k - 1];
      const after = k === 0 ? xy[1] : beyond;
      const len = Math.hypot(after[0] - before[0], after[1] - before[1]) || 1;
      nrm[k] = [-(after[1] - before[1]) / len, (after[0] - before[0]) / len];
    }
    // offsets: metres left of the centreline, or a function of the point
    const at = (k, off, dz) => {
      const o = typeof off === 'function' ? off(k) : off;
      return [xy[k][0] + nrm[k][0] * o, xy[k][1] + nrm[k][1] * o, z[k] + dz];
    };
    const row = (off, dz) => xy.map((_, k) => at(k, off, dz));
    const outL = (k) => hl[k] + PARAPET_W_M; const outR = (k) => -(hr[k] + PARAPET_W_M);
    // where an edge stands on another part of this deck (or of a neighbouring
    // deck: two bridges' ramps forking apart) at about its height (a fork's
    // branches overlapping, a crossroads' corners): no parapet, no side
    // there; alongside the other part, not past its end (the part a join
    // continues into)
    const onPart = (q, x, y, zk) => {
      if (q.xy.length < 2) return false;
      const n = nearestInterior(q, x, y);
      return !!n && n.d < q.half + PARAPET_W_M - 0.05 && Math.abs(n.z - zk) < 2;
    };
    const hiddenAt = (x, y, zk) => deck.parts.some((q, qi) => qi !== pi && onPart(q, x, y, zk))
      || neighbours.some((q) => onPart(q, x, y, zk));
    // each side's visible stretches: [i, t0, t1] of segment i (from point i
    // to i + 1), the edge between hidden and shown found along the segment
    // (points are metres apart: a parapet cut at the nearer point runs on
    // across a crossroads' corner)
    const visible = (off) => {
      const pt = (i, t) => {
        const a = at(i, off, 0); const c = at(i + 1, off, 0);
        return [a[0] + (c[0] - a[0]) * t, a[1] + (c[1] - a[1]) * t, a[2] + (c[2] - a[2]) * t];
      };
      const hid = xy.map((_, k) => (k + 1 < xy.length ? hiddenAt(...pt(k, 0)) : hiddenAt(...pt(k - 1, 1))));
      const out = [];
      for (let i = 0; i + 1 < xy.length; i++) {
        if (!hid[i] && !hid[i + 1]) { out.push([i, 0, 1]); continue; }
        if (hid[i] && hid[i + 1]) continue;
        let lo = 0; let hi = 1;   // hid at lo side ... shown at the other
        for (let it = 0; it < 8; it++) {
          const m = (lo + hi) / 2;
          if (hiddenAt(...pt(i, m)) === hid[i]) lo = m; else hi = m;
        }
        out.push(hid[i] ? [i, hi, 1] : [i, 0, lo]);
      }
      return out;
    };
    const sides = [{ inner: (k) => hl[k], outer: outL, faceOut: (k) => [nrm[k][0], nrm[k][1], 0] }, { inner: (k) => -hr[k], outer: outR, faceOut: (k) => [-nrm[k][0], -nrm[k][1], 0] }]
      .map((side) => ({ ...side, shown: visible(side.inner) }));
    // strips between point rows A and B over the stretches [i, t0, t1]
    const lerp3 = (p, q, t) => [p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t, p[2] + (q[2] - p[2]) * t];
    const runs = (A, B, stretches, want) => {
      for (const [i, t0, t1] of stretches) {
        b.quad(lerp3(A[i], A[i + 1], t0), lerp3(A[i], A[i + 1], t1), lerp3(B[i], B[i + 1], t1), lerp3(B[i], B[i + 1], t0), want(i));
      }
    };
    const L = row(outL, 0); const R = row(outR, 0);
    const Lb = row(outL, -slab); const Rb = row(outR, -slab);
    const left = (k) => [nrm[k][0], nrm[k][1], 0];
    const right = (k) => [-nrm[k][0], -nrm[k][1], 0];
    // slab: top (under the road decal), sides, underside
    b.strip(L, R, () => [0, 0, 1]);
    runs(L, Lb, sides[0].shown, left);
    runs(R, Rb, sides[1].shown, right);
    b.strip(Lb, Rb, () => [0, 0, -1]);
    // Near the ground the sides go down into it, a retaining wall: no slab
    // floating over the ground by an abutment or along a walled ramp
    for (const side of sides) {
      const ground = xy.map((_, k) => {
        const [x, y] = at(k, side.outer, 0);
        return groundAt ? groundAt(x, y) : -Infinity;
      });
      const low = (k) => z[k] - depth - ground[k] < WALL_GAP_M && z[k] - slab > ground[k];
      const top = row(side.outer, -slab);
      const foot = xy.map((_, k) => at(k, side.outer, ground[k] - FOOTING_M / 2 - z[k]));
      runs(top, foot, side.shown.filter(([i]) => low(i) && low(i + 1)), side.faceOut);
    }
    // girders (none on a thinned structure)
    const ng = girders ? Math.max(2, Math.round((2 * part.half) / GIRDER_EVERY_M)) : 0;
    for (let g = 0; g < ng; g++) {
      const off = (k) => -(hr[k] - 0.6) + ((hl[k] + hr[k] - 1.2) * g) / Math.max(1, ng - 1);
      const GL = row((k) => off(k) + GIRDER_W_M / 2, -DECK_DEPTH_M); const GR = row((k) => off(k) - GIRDER_W_M / 2, -DECK_DEPTH_M);
      const GLb = row((k) => off(k) + GIRDER_W_M / 2, -DECK_DEPTH_M - GIRDER_D_M);
      const GRb = row((k) => off(k) - GIRDER_W_M / 2, -DECK_DEPTH_M - GIRDER_D_M);
      b.strip(GL, GLb, left);
      b.strip(GR, GRb, right);
      b.strip(GLb, GRb, () => [0, 0, -1]);
    }
    // parapets: inner face at the road's edge, top, outer face down to the
    // slab; none where the edge stands on another part of the deck
    for (const side of sides) {
      const faceIn = (k) => [-side.faceOut(k)[0], -side.faceOut(k)[1], 0];
      const I0 = row(side.inner, 0); const I1 = row(side.inner, PARAPET_H_M);
      const O0 = row(side.outer, 0); const O1 = row(side.outer, PARAPET_H_M);
      runs(I0, I1, side.shown, faceIn);
      runs(I1, O1, side.shown, () => [0, 0, 1]);
      runs(O1, O0, side.shown, side.faceOut);
      // a parapet's open ends, where it stops at another part
      for (const [i, t0, t1] of side.shown) {
        for (const [t, sgn] of [[t0, -1], [t1, 1]]) {
          if (t <= 1e-6 || t >= 1 - 1e-6) continue;
          const d = [(xy[i + 1][0] - xy[i][0]) * sgn, (xy[i + 1][1] - xy[i][1]) * sgn];
          const len = Math.hypot(d[0], d[1]) || 1;
          b.quad(lerp3(I0[i], I0[i + 1], t), lerp3(O0[i], O0[i + 1], t), lerp3(O1[i], O1[i + 1], t), lerp3(I1[i], I1[i + 1], t), [d[0] / len, d[1] / len, 0]);
        }
      }
    }
    // end caps at the deck's own ends only (not at joins or forks), down to
    // the ground where it is close
    for (const k of [0, xy.length - 1]) {
      if ((atJoint.get(key(xy[k])) || []).length !== 1) continue;
      const j = k === 0 ? 1 : xy.length - 2;
      const d = [(xy[k][0] - xy[j][0]), (xy[k][1] - xy[j][1]), 0];
      const len = Math.hypot(d[0], d[1]) || 1;
      const want = [d[0] / len, d[1] / len, 0];
      const g = groundAt ? groundAt(xy[k][0], xy[k][1]) : -Infinity;
      const bottom = z[k] - depth - g < WALL_GAP_M && z[k] - slab > g ? g - FOOTING_M / 2 - z[k] : -slab;
      b.quad(at(k, outL, 0), at(k, outR, 0), at(k, outR, bottom), at(k, outL, bottom), want);
      sides.forEach((side) => {
        // (a parapet shown up to this end)
        if (!side.shown.some(([i, t0, t1]) => (k === 0 ? i === 0 && t0 < 1e-6 : i === xy.length - 2 && t1 > 1 - 1e-6))) return;
        b.quad(at(k, side.inner, 0), at(k, side.outer, 0), at(k, side.outer, PARAPET_H_M), at(k, side.inner, PARAPET_H_M), want);
      });
    }
    // piers
    for (const p of pierSites(part, { groundAt, roadLines })) {
      const deckW = p.width;
      if (deckW > PIER_BENT_W_M) {
        const cols = Math.max(2, Math.round(deckW / 8));
        const span = deckW - 2 * PIER_COLUMN_M;
        for (let c = 0; c < cols; c++) {
          const off = -span / 2 + (span * c) / (cols - 1);
          b.box(p.x - p.u[1] * off, p.y + p.u[0] * off, p.u, PIER_COLUMN_M / 2, PIER_COLUMN_M / 2, p.zBottom, p.zTop - PIER_CAP_H_M);
        }
        b.box(p.x, p.y, p.u, PIER_T_M / 2, deckW / 2 - 0.5, p.zTop - PIER_CAP_H_M, p.zTop);
      } else {
        b.box(p.x, p.y, p.u, PIER_T_M / 2, p.pierWidth / 2, p.zBottom, p.zTop - PIER_CAP_H_M);
        b.box(p.x, p.y, p.u, PIER_T_M / 2 + 0.3, deckW / 2 - 0.5, p.zTop - PIER_CAP_H_M, p.zTop);
      }
    }
  }
  return { positions: b.pos, uvs: b.uv };
}

/**
 * Whether something standing at (x, y) from z up to zTop would reach into a
 * deck above it (a lamp or pole under an overpass).
 */
export function hitsDeck(decks, x, y, z, zTop, margin = 1) {
  for (const deck of decks) {
    for (const part of deck.parts) {
      const { xy } = part;
      for (let i = 0; i + 1 < xy.length; i++) {
        const [ax, ay] = xy[i];
        const [bx, by] = xy[i + 1];
        const vx = bx - ax; const vy = by - ay;
        const L2 = vx * vx + vy * vy || 1e-9;
        const t = Math.max(0, Math.min(1, ((x - ax) * vx + (y - ay) * vy) / L2));
        if (Math.hypot(ax + vx * t - x, ay + vy * t - y) > part.half + PARAPET_W_M + margin) continue;
        const deckBottom = part.z[i] + (part.z[i + 1] - part.z[i]) * t - (part.depth ?? DECK_DEPTH_M + GIRDER_D_M);
        if (zTop > deckBottom - 0.5 && z < deckBottom) return true;
      }
    }
  }
  return false;
}

/**
 * Whether a line at (x, y, z) heading `yaw` (radians, world) runs along a deck
 * standing over it: a railing OSM maps along a bridge, placed on the ground
 * under it (the deck has its own parapets).
 */
export function alongDeck(decks, x, y, z, yaw, margin = 1.5) {
  const ux = Math.cos(yaw); const uy = Math.sin(yaw);
  for (const deck of decks) {
    for (const part of deck.parts) {
      const { xy } = part;
      for (let i = 0; i + 1 < xy.length; i++) {
        const [ax, ay] = xy[i];
        const [bx, by] = xy[i + 1];
        const vx = bx - ax; const vy = by - ay;
        const L = Math.hypot(vx, vy) || 1e-9;
        const t = Math.max(0, Math.min(1, ((x - ax) * vx + (y - ay) * vy) / (L * L)));
        if (Math.hypot(ax + vx * t - x, ay + vy * t - y) > part.half + PARAPET_W_M + margin) continue;
        if (Math.abs((vx * ux + vy * uy) / L) < 0.85) continue;
        const top = part.z[i] + (part.z[i + 1] - part.z[i]) * t;
        if (top > z + 1) return true;
      }
    }
  }
  return false;
}

// ── Approach embankments (MapNG; BeamNG.Earth streams its terrain and cannot) ─
// A deck that cannot clear what it crosses within its grade limits gets its
// abutments raised, and the approach road climbs to them on an embankment
// built into the terrain.

export const RAMP_GRADE = 0.05;
export const MAX_RAMP_LIFT_M = 8;
export const RAMP_SHOULDER_M = 1.5;    // flat beyond the road's edge
export const RAMP_SIDE_SLOPE = 0.5;    // then down 1:2 to the ground

/** Ramp length for a lift (a cosine climb, no steeper than RAMP_GRADE). */
export const rampLength = (lift) => (lift * Math.PI) / (2 * RAMP_GRADE);

/** Height of the ramp above the original ground at d m from the abutment. */
export const rampLift = (d, lift, length) => (d >= length ? 0 : lift * 0.5 * (1 + Math.cos((Math.PI * Math.max(0, d)) / length)));

/** The lift an approach of `available` m can carry (some room left at its far end). */
export function liftFor(shortfall, available) {
  const want = Math.min(MAX_RAMP_LIFT_M, shortfall + 0.3);
  const fits = Math.max(0, ((available - 10) * 2 * RAMP_GRADE) / Math.PI);
  return Math.min(want, fits);
}

/**
 * Structure depth under the road surface for a part whose lowest gap over a
 * road under it is `minGap` m: the full slab and girders where there is room,
 * else thinner (no girders, the slab down to MIN_SLAB_M) so it never hangs
 * into the road below more than it must.
 */
export function structureDepth(minGap) {
  if (!Number.isFinite(minGap)) return DECK_DEPTH_M + GIRDER_D_M;
  return Math.min(DECK_DEPTH_M + GIRDER_D_M, Math.max(MIN_SLAB_M, minGap - HEADROOM_KEEP_M));
}
