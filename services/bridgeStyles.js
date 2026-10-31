// Bridge styles (refs/output/earth-detail-plan.md, phase B): what a bridge IS, on top of the solved deck.
//
// The structure solver builds every bridge as a deck on piers. OSM often says more: bridge:structure on
// the road (rarely) or on the bridge's outline (man_made=bridge: arches in Prague, suspension spans in
// Sydney, trusses on the St. Johns), colour=* its paint. A corridor of decks running side by side over the
// same crossing (twin spans, BeamNG.Earth's #516 #519) shares one type and paint. No type, no style: a
// plain deck stays one (their size rule turned Tokyo's girders into trusses).
//
// Drawn on a deck's spans (stretches clear of the ground by SPAN_CLEAR_M, at least MIN_RUN_M long), in
// MapNG's own look:
//   truss       steel Warren trusses each side with verticals, inclined end posts and portal bracing
//               over the lanes (through truss, 7.5 m), or a low pony truss on short spans
//   arch        twin steel box ribs over the deck (a tied arch, rise span / 5.5), hangers to the deck
//               edges, wind bracing between the ribs high over the lanes
//   deckArch    a concrete rib under the deck from the span's ends to its crown, spandrel columns
//   stoneArch   (humpback, masonry) a stone barrel vault under the deck with solid spandrel walls
// Every member stands outside the drawn lanes (the deck edge + the parapet + SIDE_GAP_M) or above the
// headroom: nothing in a car's way. The deck's piers inside a styled span are left out (it spans them).
// Pure geometry: in world metres, Z up; nothing here knows about any place.

const SPAN_CLEAR_M = 2.5;     // a span: the deck this far over its ground ...
const MIN_RUN_M = 24;         // ... for at least this long (a truss's; arches spring lower and shorter)
const SPAN_RULES = { arch: { clear: 1.5, minRun: 10 }, stoneArch: { clear: 0.8, minRun: 6 } };
const PARAPET_W_M = 0.4;
const SIDE_GAP_M = 0.8;       // from the parapet's outside to a truss's or rib's plane
const PANEL_M = 11;           // a truss's panel (verticals this far apart)
const THROUGH_H_M = 7.5;      // a through truss: 6.5 m of headroom over the lanes + its top chord
const PONY_SPAN_M = 35;       // shorter than this: a pony truss
const PONY_H_M = 3;
const CHORD = [0.6, 0.8];     // (width, height) of members
const POST = [0.38, 0.38];
const DIAG = [0.32, 0.32];
const STRUT = [0.3, 0.45];
const BRACE = [0.18, 0.18];
const RIB = [0.9, 1.15];
const HANGER = [0.12, 0.12];
const ARCH_RISE = 1 / 5.5;
const ARCH_HEADROOM_M = 6.5;
const HANGER_M = 6;
const COLUMN_M = 5;
const STONE_CROWN_M = 0.45;   // a stone arch's crown under the road surface

const TYPES = {
  truss: 'truss', cantilever: 'truss', arch: 'arch', 'tied-arch': 'arch', 'tied_arch': 'arch',
  humpback: 'stoneArch', masonry: 'stoneArch', viaduct: null,
  suspension: 'suspension', 'simple-suspension': 'suspension', 'cable-stayed': 'cable', cable_stayed: 'cable',
};
// steel paints (the tagged colour snapped to the nearest; grey untagged)
export const PAINTS = {
  grey: [0.55, 0.57, 0.56], green: [0.2, 0.36, 0.26], red: [0.5, 0.1, 0.08], orange: [0.86, 0.3, 0.06], blue: [0.18, 0.3, 0.48],
  black: [0.1, 0.1, 0.1], white: [0.86, 0.86, 0.84], yellow: [0.8, 0.62, 0.15], brown: [0.36, 0.24, 0.17],
};
const NAMED = { gray: 'grey', silver: 'grey', darkgreen: 'green', navy: 'blue', gold: 'yellow', maroon: 'red', darkred: 'red', orangered: 'orange', rust: 'brown', beige: 'white', cream: 'white' };

/** The paint (a PAINTS key) of a tagged colour (a name or #rrggbb), grey without one. */
export function paintOf(value) {
  const v = String(value || '').trim().toLowerCase();
  if (!v) return 'grey';
  if (PAINTS[v]) return v;
  if (NAMED[v]) return NAMED[v];
  const m = /^#?([0-9a-f]{6})$/.exec(v);
  if (!m) return 'grey';
  const rgb = [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16) / 255);
  let best = 'grey'; let bd = Infinity;
  for (const [k, c] of Object.entries(PAINTS)) {
    const d = c.reduce((n, cv, i) => n + (cv - rgb[i]) ** 2, 0);
    if (d < bd) { bd = d; best = k; }
  }
  return best;
}

/** A style type from OSM tags ({ structure, bridgeKind }), or null. */
export function typeOfTags({ structure, bridgeKind } = {}) {
  const s = String(structure || '').toLowerCase();
  if (TYPES[s] !== undefined) return TYPES[s];
  const b = String(bridgeKind || '').toLowerCase();
  if (b === 'cantilever') return 'truss';
  return null;
}

// ── geometry helpers ──────────────────────────────────────────────────────────

const arcs = (xy) => { const s = [0]; for (let i = 1; i < xy.length; i++) s.push(s[i - 1] + Math.hypot(xy[i][0] - xy[i - 1][0], xy[i][1] - xy[i - 1][1])); return s; };

/** A part's point at arc length s, offset `off` to the left (negative: right): [x, y, z]. */
function along(part, s, off = 0, sArr = arcs(part.xy)) {
  const { xy, z } = part;
  let j = 0;
  while (j < sArr.length - 2 && sArr[j + 1] < s) j++;
  const L = Math.max(1e-9, sArr[j + 1] - sArr[j]);
  const f = Math.max(0, Math.min(1, (s - sArr[j]) / L));
  const ux = (xy[j + 1][0] - xy[j][0]) / L; const uy = (xy[j + 1][1] - xy[j][1]) / L;
  return [xy[j][0] + (xy[j + 1][0] - xy[j][0]) * f - uy * off, xy[j][1] + (xy[j + 1][1] - xy[j][1]) * f + ux * off, z[j] + (z[j + 1] - z[j]) * f];
}

/**
 * A part's drawn half width on side k (0: its left, 1: its right) at arc length s: part.halfL / halfR per
 * point when set (deckEdges: decks widen where they join and fork), else part.half.
 */
function sideHalf(part, sArr, s, k) {
  const arr = k === 0 ? part.halfL : part.halfR;
  if (!arr) return part.half;
  let j = 0;
  while (j < sArr.length - 2 && sArr[j + 1] < s) j++;
  const f = Math.max(0, Math.min(1, (s - sArr[j]) / Math.max(1e-9, sArr[j + 1] - sArr[j])));
  return arr[j] + (arr[j + 1] - arr[j]) * f;
}

/** A beam (box) between points p and q, `w` wide (horizontal, across) and `h` tall. */
export function beam(b, p, q, w, h, across = null) {
  if (b.segments) b.segments.push([p, q, w, h]);   // (for checks: members as segments)
  const d = [q[0] - p[0], q[1] - p[1], q[2] - p[2]];
  const L = Math.hypot(...d);
  if (L < 1e-6) return;
  const u = d.map((v) => v / L);
  // across: horizontal, perpendicular to the beam (a vertical beam: along x)
  let a = [-u[1], u[0], 0];
  const al = Math.hypot(a[0], a[1]);
  // (a vertical beam faces `across` when given, else x: a leg turned like the leaning leg it meets)
  a = al < 1e-6 ? (across ? [across[0], across[1], 0] : [1, 0, 0]) : [a[0] / al, a[1] / al, 0];
  // up: perpendicular to both
  const v = [u[1] * a[2] - u[2] * a[1], u[2] * a[0] - u[0] * a[2], u[0] * a[1] - u[1] * a[0]];
  const c = (pt, sa, sv) => [pt[0] + a[0] * sa * w / 2 + v[0] * sv * h / 2, pt[1] + a[1] * sa * w / 2 + v[1] * sv * h / 2, pt[2] + a[2] * sa * w / 2 + v[2] * sv * h / 2];
  const P = [c(p, -1, -1), c(p, 1, -1), c(p, 1, 1), c(p, -1, 1)];
  const Q = [c(q, -1, -1), c(q, 1, -1), c(q, 1, 1), c(q, -1, 1)];
  const faces = [[0, 1, [-v[0], -v[1], -v[2]]], [1, 2, a], [2, 3, v], [3, 0, [-a[0], -a[1], -a[2]]]];
  for (const [i, j, want] of faces) b.quad(P[i], P[j], Q[j], Q[i], want);
  b.quad(P[0], P[1], P[2], P[3], [-u[0], -u[1], -u[2]]);
  b.quad(Q[0], Q[1], Q[2], Q[3], u);
}

// ── spans ───────────────────────────────────────────────────────────────────

/** The stretches of a part clear of the ground by SPAN_CLEAR_M for MIN_RUN_M or more: [{ s0, s1 }]. */
export function spansOf(part, groundAt, { clear = SPAN_CLEAR_M, minRun = MIN_RUN_M } = {}) {
  const s = arcs(part.xy);
  const out = [];
  let start = null;
  for (let k = 0; k < part.xy.length; k++) {
    const ok = part.z[k] - groundAt(part.xy[k][0], part.xy[k][1]) >= clear;
    if (ok && start === null) start = k;
    if ((!ok || k === part.xy.length - 1) && start !== null) {
      const end = ok ? k : k - 1;
      if (s[end] - s[start] >= minRun) out.push({ s0: s[start], s1: s[end] });
      start = null;
    }
  }
  return out;
}

// ── corridors and types ──────────────────────────────────────────────────────

const inRing = (x, y, ring) => {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]; const [xj, yj] = ring[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
};
const PART_IN_OUTLINE = 0.5;   // this share of a part's points inside a tagged outline (or near a typed twin): that bridge's
const CORRIDOR_COS = 0.94;     // decks this parallel ...
const CORRIDOR_M = 30;         // ... and this close side by side share one style

/**
 * Each deck's style: deck.style = { type, paint, material, source, corridor, spans: [{ part, s0, s1 }] }.
 * A type belongs to a part, not the whole deck (a bridge is often one deck with its approach ramps: Naldo's
 * Main Street Bridge and 1.1 km of ramps): from the part's road tags, else from a tagged outline holding
 * half of its points; a part side by side with a typed one (a twin span, a corridor) takes its type and
 * paint. Spans are drawn on typed parts only. outlines: [{ ring: [[x, y]...], tags }].
 */
export function styleDecks(decks, { outlines = [], groundAt }) {
  const parts = [];
  decks.forEach((deck, di) => deck.parts.forEach((part, pi) => parts.push({ deck, di, pi, part })));
  for (const p of parts) {
    let type = typeOfTags(p.part); let source = type ? 'road tags' : null;
    let paint = p.part.paint || ''; let material = '';
    for (const o of outlines) {
      const inside = p.part.xy.filter(([x, y]) => inRing(x, y, o.ring)).length;
      if (inside < PART_IN_OUTLINE * p.part.xy.length) continue;
      const t = typeOfTags({ structure: o.tags['bridge:structure'], bridgeKind: o.tags.bridge });
      if (t && !type) { type = t; source = 'bridge outline'; }
      if (!paint && (o.tags.colour || o.tags['bridge:colour'])) paint = o.tags.colour || o.tags['bridge:colour'];
      if (!material && o.tags.material) material = String(o.tags.material).toLowerCase();
    }
    Object.assign(p, { type, source, paint, material });
  }
  // twins: an untyped part running alongside a typed one takes its type
  const dirOf = (xy) => { const a = xy[0]; const b = xy[xy.length - 1]; const L = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1; return [(b[0] - a[0]) / L, (b[1] - a[1]) / L]; };
  const typed = parts.filter((p) => p.type);
  for (const p of parts) {
    if (p.type) continue;
    const d = dirOf(p.part.xy);
    const plen = arcs(p.part.xy).at(-1);
    for (const q of typed) {
      // (a twin is a deck of its own of about its length: not a ramp of the same deck alongside)
      if (q.deck === p.deck) continue;
      const qlen = arcs(q.part.xy).at(-1);
      if (plen < 0.5 * qlen || plen > 2 * qlen) continue;
      const e = dirOf(q.part.xy);
      if (Math.abs(d[0] * e[0] + d[1] * e[1]) < CORRIDOR_COS) continue;
      let near = 0;
      for (const [x, y] of p.part.xy) {
        let best = Infinity;
        for (const [u, v] of q.part.xy) best = Math.min(best, Math.hypot(u - x, v - y));
        if (best <= CORRIDOR_M) near++;
      }
      if (near < PART_IN_OUTLINE * p.part.xy.length) continue;
      Object.assign(p, { type: q.type, source: 'twin', paint: p.paint || q.paint, material: p.material || q.material, twin: true });
      break;
    }
  }
  let styled = 0;
  for (const deck of decks) {
    const mine = parts.filter((p) => p.deck === deck && p.type);
    if (!mine.length) continue;
    const spans = [];
    for (const p of mine) for (const sp of spansOf(p.part, groundAt, SPAN_RULES[p.type] || {})) spans.push({ part: p.pi, ...sp });
    if (!spans.length) continue;
    const main = mine[0];
    deck.style = { type: main.type, paint: paintOf(mine.find((p) => p.paint)?.paint), material: main.material, source: main.source, corridor: mine.some((p) => p.twin) ? 2 : 1, spans };
    styled++;
  }
  return styled;
}

/** Whether a pier at (x, y) of part pi stands inside one of the deck's styled spans (it spans it). */
export function inStyledSpan(deck, pi, x, y) {
  if (!deck.style || !['truss', 'arch', 'stoneArch', 'suspension', 'cable'].includes(deck.style.type)) return false;
  const part = deck.parts[pi];
  const s = arcs(part.xy);
  let best = Infinity; let at = 0;
  for (let i = 0; i + 1 < part.xy.length; i++) {
    const [ax, ay] = part.xy[i]; const [bx, by] = part.xy[i + 1];
    const vx = bx - ax; const vy = by - ay; const L2 = vx * vx + vy * vy || 1;
    const t = Math.max(0, Math.min(1, ((x - ax) * vx + (y - ay) * vy) / L2));
    const d = Math.hypot(ax + vx * t - x, ay + vy * t - y);
    if (d < best) { best = d; at = s[i] + t * Math.sqrt(L2); }
  }
  return deck.style.spans.some((sp) => sp.part === pi && at > sp.s0 + 1 && at < sp.s1 - 1);
}

// ── the structures ───────────────────────────────────────────────────────────

/**
 * The style's geometry for a deck: { steel, concrete, stone } builders (the bridge Builder's quad(a, b,
 * c, d, want)) filled. depthOf(part): the deck's depth under its road surface.
 */
export function buildStyleGeometry(deck, { groundAt, newBuilder, depthOf = () => 1.2 }) {
  const out = { steel: newBuilder(), concrete: newBuilder(), stone: newBuilder(), cable: newBuilder() };
  const st = deck.style;
  if (!st) return out;
  for (const sp of st.spans) {
    const part = deck.parts[sp.part];
    const sArr = arcs(part.xy);
    const off = part.half + PARAPET_W_M + SIDE_GAP_M;
    const L = sp.s1 - sp.s0;
    if (st.type === 'truss') {
      // spans of TRUSS_MAX_M at most, a pier between them
      const n = Math.max(1, Math.ceil(L / TRUSS_MAX_M));
      for (let k = 0; k < n; k++) {
        const sub = { s0: sp.s0 + (L * k) / n, s1: sp.s0 + (L * (k + 1)) / n };
        truss(out.steel, part, sArr, sub, off, sub.s1 - sub.s0);
        if (k > 0) archPier(out.concrete, part, sArr, sub.s0, groundAt, depthOf(part), false);
      }
    }
    else if (st.type === 'arch' && L >= THROUGH_ARCH_M) arch(out.steel, part, sArr, sp, off, L);
    else if (st.type === 'suspension' || st.type === 'cable') {
      // one set of towers per crossing, drawn by its lead deck (once, on its main span)
      if ((st.crossing?.lead ?? deck) !== deck || sp !== mainSpan(deck).sp) continue;
      if (st.type === 'suspension') suspensionCrossing(st.paint !== 'grey' ? out.steel : out.concrete, out.cable, deck, groundAt);
      else cableStayedCrossing(out.concrete, out.cable, deck, groundAt);
    }
    else if (st.type === 'arch' || st.type === 'stoneArch') {
      // a row of deck arches, each about as wide as the deck stands high (x 2.2), piers between them
      // (stone where tagged so, and short arches: canal and river arches under 30 m are nearly all masonry)
      const stone = st.type === 'stoneArch' || STONE_MATERIALS.has(st.material) || (!st.material && L < SHORT_ARCH_M);
      const clears = [];
      for (let k = 0; k <= 8; k++) { const p = along(part, sp.s0 + (L * k) / 8, 0, sArr); clears.push(p[2] - groundAt(p[0], p[1])); }
      clears.sort((a, c) => a - c);
      const target = Math.max(18, Math.min(60, clears[4] * 2.2));
      const n = Math.max(1, Math.round(L / target));
      const b = stone ? out.stone : out.concrete;
      for (let k = 0; k < n; k++) {
        const sub = { s0: sp.s0 + (L * k) / n, s1: sp.s0 + (L * (k + 1)) / n };
        deckArch(b, part, sArr, sub, sub.s1 - sub.s0, groundAt, depthOf(part), stone);
        if (k > 0) archPier(b, part, sArr, sub.s0, groundAt, depthOf(part), stone);
      }
    }
  }
  return out;
}

const TRUSS_MAX_M = 120;      // a truss spans at most this; longer runs are several, a pier between
const THROUGH_ARCH_M = 250;   // an arch spanning this far in one: steel over the deck (Sydney Harbour), else deck arches
const SHORT_ARCH_M = 30;
const STONE_MATERIALS = new Set(['stone', 'masonry', 'brick', 'granite', 'sandstone', 'limestone']);

/** The pier between two deck arches: as wide as the deck, a cutwater each end. */
function archPier(b, part, sArr, s, groundAt, depth, stone) {
  const p = along(part, s, 0, sArr);
  const g = groundAt(p[0], p[1]);
  const top = p[2] - depth - 0.1;
  if (top - g < 1) return;
  const half = part.half + PARAPET_W_M;
  const a = along(part, s - 0.01, 0, sArr); const c = along(part, s + 0.01, 0, sArr);
  const ul = Math.hypot(c[0] - a[0], c[1] - a[1]) || 1; const u = [(c[0] - a[0]) / ul, (c[1] - a[1]) / ul];
  const t = stone ? 1.4 : 1.1;
  // along the road: the pier's thickness; across: the deck's width, pointed at both faces
  const n = [-u[1], u[0]];
  const P = (sa, sc, z) => [p[0] + u[0] * sa * t + n[0] * sc * half, p[1] + u[1] * sa * t + n[1] * sc * half, z];
  const ring = [P(-1, -1, 0), P(1, -1, 0), P(0, -1.25, 0), P(1, 1, 0), P(0, 1.25, 0), P(-1, 1, 0)];
  const order = [ring[0], ring[2], ring[1], ring[3], ring[4], ring[5]];
  for (let i = 0; i < order.length; i++) {
    const A = order[i]; const B = order[(i + 1) % order.length];
    const mid = [(A[0] + B[0]) / 2 - p[0], (A[1] + B[1]) / 2 - p[1], 0];
    b.quad([A[0], A[1], g - 0.5], [B[0], B[1], g - 0.5], [B[0], B[1], top], [A[0], A[1], top], mid);
  }
}

function truss(b, part, sArr, sp, off, L) {
  const through = L >= PONY_SPAN_M;
  // deeper with its span (a 290 m span 7.5 m deep read as a fence)
  const H = through ? Math.max(THROUGH_H_M, Math.min(18, L / 10)) : PONY_H_M;
  const n = Math.max(3, Math.round(L / PANEL_M));
  const sides = [off, -off];
  const B = sides.map((o) => Array.from({ length: n + 1 }, (_, i) => { const p = along(part, sp.s0 + (L * i) / n, o, sArr); return [p[0], p[1], p[2] - 0.45]; }));
  const T = B.map((row) => row.map((p) => [p[0], p[1], p[2] + H]));
  for (let k = 0; k < 2; k++) {
    for (let i = 0; i < n; i++) beam(b, B[k][i], B[k][i + 1], CHORD[0], CHORD[1]);                 // bottom chord
    for (let i = 1; i < n - 1; i++) beam(b, T[k][i], T[k][i + 1], CHORD[0], CHORD[1]);             // top chord
    beam(b, B[k][0], T[k][1], CHORD[0], CHORD[1]);                                                  // inclined end posts
    beam(b, B[k][n], T[k][n - 1], CHORD[0], CHORD[1]);
    for (let i = 1; i < n; i++) beam(b, B[k][i], T[k][i], POST[0], POST[1]);                       // verticals
    for (let i = 1; i < n - 1; i++) {                                                              // Warren diagonals
      if (i % 2) beam(b, T[k][i], B[k][i + 1], DIAG[0], DIAG[1]); else beam(b, B[k][i], T[k][i + 1], DIAG[0], DIAG[1]);
    }
  }
  if (!through) return;
  // over the lanes (H over the road: clear of any truck): struts at each panel point, X bracing between,
  // and a portal frame over each end
  for (let i = 1; i < n; i++) beam(b, T[0][i], T[1][i], STRUT[0], STRUT[1]);
  for (let i = 1; i < n - 1; i++) { beam(b, T[0][i], T[1][i + 1], BRACE[0], BRACE[1]); beam(b, T[1][i], T[0][i + 1], BRACE[0], BRACE[1]); }
  for (const i of [1, n - 1]) {
    const drop = 1.3;
    const a = T[0][i].map((v, k) => (k === 2 ? v - drop : v)); const c = T[1][i].map((v, k) => (k === 2 ? v - drop : v));
    beam(b, a, c, STRUT[0], STRUT[1] * 1.6);
  }
}

function arch(b, part, sArr, sp, off, L) {
  const rise = Math.min(40, Math.max(8, L * ARCH_RISE));
  const m = Math.max(12, Math.round(L / 5));
  const sides = [off, -off];
  const z0 = along(part, sp.s0, 0, sArr)[2]; const z1 = along(part, sp.s1, 0, sArr)[2];
  const rib = sides.map((o) => Array.from({ length: m + 1 }, (_, i) => {
    const t = i / m; const p = along(part, sp.s0 + L * t, o, sArr);
    return [p[0], p[1], z0 + (z1 - z0) * t + rise * 4 * t * (1 - t)];
  }));
  for (let k = 0; k < 2; k++) {
    for (let i = 0; i < m; i++) beam(b, rib[k][i], rib[k][i + 1], RIB[0], RIB[1]);
    // the tie along the deck edge
    beam(b, along(part, sp.s0, sides[k], sArr), along(part, sp.s1, sides[k], sArr), CHORD[0], CHORD[1]);
    // hangers from the rib down to the deck edge
    const nh = Math.max(2, Math.round(L / HANGER_M));
    for (let h = 1; h < nh; h++) {
      const t = h / nh; const deckP = along(part, sp.s0 + L * t, sides[k], sArr);
      const top = [deckP[0], deckP[1], z0 + (z1 - z0) * t + rise * 4 * t * (1 - t) - RIB[1] / 2];
      beam(b, deckP, top, HANGER[0], HANGER[1]);
    }
  }
  // wind bracing between the ribs where they stand high over the lanes
  for (let i = 1; i < m; i++) {
    const t = i / m;
    if (rise * 4 * t * (1 - t) < ARCH_HEADROOM_M + 0.5) continue;
    beam(b, rib[0][i], rib[1][i], STRUT[0], STRUT[1]);
    if (i + 1 < m && rise * 4 * ((i + 1) / m) * (1 - (i + 1) / m) >= ARCH_HEADROOM_M + 0.5) {
      beam(b, rib[0][i], rib[1][i + 1], BRACE[0], BRACE[1]); beam(b, rib[1][i], rib[0][i + 1], BRACE[0], BRACE[1]);
    }
  }
}

function deckArch(b, part, sArr, sp, L, groundAt, depth, stone) {
  const half = part.half + PARAPET_W_M;
  const m = Math.max(10, Math.round(L / 4));
  // (a masonry arch's crown is thin: up to just under the road, not the deck slab's depth)
  const under = (s) => along(part, s, 0, sArr)[2] - (stone ? STONE_CROWN_M : depth + 0.15);
  const g0 = groundAt(...along(part, sp.s0, 0, sArr).slice(0, 2)); const g1 = groundAt(...along(part, sp.s1, 0, sArr).slice(0, 2));
  const springs = [Math.min(g0 + 0.3, under(sp.s0) - 0.5), Math.min(g1 + 0.3, under(sp.s1) - 0.5)];
  const crownAt = under(sp.s0 + L / 2);
  const zOf = (t) => {
    const base = springs[0] + (springs[1] - springs[0]) * t;
    const lift = Math.max(0, crownAt - (springs[0] + springs[1]) / 2);
    return base + lift * 4 * t * (1 - t);
  };
  if (crownAt - Math.max(...springs) < (stone ? 0.6 : 1.2)) return;
  if (stone) {
    // a barrel vault across the deck's whole width, solid spandrel walls to the deck on both faces
    // (the spandrel faces a hair outside the deck's own sides: they cover them, no flicker)
    const face = half + 0.06;
    const rows = [face, -face].map((o) => Array.from({ length: m + 1 }, (_, i) => { const t = i / m; const p = along(part, sp.s0 + L * t, o, sArr); return [p[0], p[1], zOf(t)]; }));
    for (let i = 0; i < m; i++) b.quad(rows[0][i], rows[0][i + 1], rows[1][i + 1], rows[1][i], [0, 0, -1]);     // soffit
    for (const [k, o] of [[0, face], [1, -face]]) {
      for (let i = 0; i < m; i++) {
        const t0 = i / m; const t1 = (i + 1) / m;
        const a = rows[k][i]; const c = rows[k][i + 1];
        const ta = along(part, sp.s0 + L * t0, o, sArr); const tc = along(part, sp.s0 + L * t1, o, sArr);
        const want = (() => { const p = along(part, sp.s0 + L * t0, 0, sArr); const d = [a[0] - p[0], a[1] - p[1], 0]; const l = Math.hypot(d[0], d[1]) || 1; return [d[0] / l, d[1] / l, 0]; })();
        b.quad(a, c, [tc[0], tc[1], tc[2] - 0.05], [ta[0], ta[1], ta[2] - 0.05], want);
      }
    }
    return;
  }
  // a concrete rib (0.7 of the deck's width) and spandrel columns up to the deck
  const ribW = Math.max(3, half * 1.4);
  const pts = Array.from({ length: m + 1 }, (_, i) => { const t = i / m; const p = along(part, sp.s0 + L * t, 0, sArr); return [p[0], p[1], zOf(t)]; });
  for (let i = 0; i < m; i++) beam(b, pts[i], pts[i + 1], ribW, 1.2);
  const nc = Math.max(2, Math.round(L / COLUMN_M));
  for (let c = 1; c < nc; c++) {
    const t = c / nc; const zr = zOf(t) + 0.6; const zd = under(sp.s0 + L * t);
    if (zd - zr < 0.8) continue;
    for (const o of [half * 0.55, -half * 0.55]) {
      const p = along(part, sp.s0 + L * t, o, sArr);
      beam(b, [p[0], p[1], zr], [p[0], p[1], zd], 0.7, 0.7);
    }
  }
}

// ── suspension and cable-stayed ──────────────────────────────────────────────

const LEG = [2.4, 3.0];       // a tower's / pylon's leg
const CABLE = [0.55, 0.55];   // a suspension's main cable
const STAY = [0.18, 0.18];    // stays and hangers
const XBEAM = [2, 2.4];       // a tower's cross beams

/** A tower's two legs either side of the deck at s, from the ground (or water) to `top`, cross beams. */
function tower(b, part, sArr, s, off, top, groundAt, depth = 2) {
  const legs = [off + 0.6, -(off + 0.6)].map((o) => along(part, s, o, sArr));
  for (const p of legs) {
    const g = groundAt(p[0], p[1]);
    // (legs lean in a little toward the top)
    const inward = [(legs[0][0] + legs[1][0]) / 2 - p[0], (legs[0][1] + legs[1][1]) / 2 - p[1]];
    const L = Math.hypot(...inward) || 1;
    const lean = Math.min(1.2, L * 0.15);
    beam(b, [p[0], p[1], g - 1], [p[0] + (inward[0] / L) * lean, p[1] + (inward[1] / L) * lean, top], LEG[0], LEG[1]);
  }
  const zDeck = along(part, s, 0, sArr)[2];
  // cross beams: under the deck, high over the lanes, at the top
  for (const z of [zDeck - depth - 0.6, Math.max(zDeck + ARCH_HEADROOM_M + 2, (zDeck + top) / 2), top - 1.5]) {
    if (z <= zDeck - depth - 0.6 && z - groundAt(legs[0][0], legs[0][1]) < 3) continue;
    beam(b, [legs[0][0], legs[0][1], z], [legs[1][0], legs[1][1], z], XBEAM[0], XBEAM[1]);
  }
  return legs;
}

// ── crossings of cable-stayed and suspension decks ──────────────────────────

const CROSSING_M = 45;        // cable / suspension decks this close side by side: one crossing, one set of towers

/**
 * Group the cable-stayed and suspension decks side by side into crossings: the deck with the longest span
 * leads (deck.style.crossing = { decks, lead }); the others draw nothing of their own (their piers still
 * left out). Call after styleDecks.
 */
export function linkCrossings(decks, { roads = [] } = {}) {
  const cs = decks.filter((d) => d.style && (d.style.type === 'cable' || d.style.type === 'suspension'));
  const longest = (d) => Math.max(...d.style.spans.map((sp) => sp.s1 - sp.s0));
  const near = (a, b) => a.parts.some((p) => p.xy.some(([x, y]) => b.parts.some((q) => q.xy.some(([u, v]) => Math.hypot(u - x, v - y) < CROSSING_M))));
  const groups = [];
  for (const d of cs) {
    const g = groups.find((gr) => gr[0].style.type === d.style.type && gr.some((o) => near(o, d)));
    if (g) g.push(d); else groups.push([d]);
  }
  for (const g of groups) {
    const lead = g.reduce((a, b) => (longest(b) > longest(a) ? b : a));
    // what a tower's legs must keep out of: every deck's lanes (styled or not: a ramp alongside) and the
    // ground roads under the crossing
    const obstacles = [
      ...decks.filter((d) => d !== lead).flatMap((d) => d.parts.map((p) => ({
        xy: p.xy, z: p.z, half: p.half,
        halfs: p.halfL ? p.xy.map((_, i) => Math.max(p.halfL[i], p.halfR[i])) : null,
      }))),
      ...roads.map((r) => ({ xy: r.xy, z: null, half: r.half, halfs: null })),
    ];
    for (const d of g) d.style.crossing = { decks: g, lead, obstacles };
  }
  return groups.length;
}

/** A deck's main span: { part, sArr, sp, L }. */
const mainSpan = (deck) => {
  const sp = deck.style.spans.reduce((a, b) => (b.s1 - b.s0 > a.s1 - a.s0 ? b : a));
  const part = deck.parts[sp.part];
  return { part, sArr: arcs(part.xy), sp, L: sp.s1 - sp.s0 };
};

/** The arc length on a part nearest (x, y). */
function nearestS(part, sArr, x, y) {
  let best = Infinity; let at = 0;
  for (let i = 0; i + 1 < part.xy.length; i++) {
    const [ax, ay] = part.xy[i]; const [bx, by] = part.xy[i + 1];
    const vx = bx - ax; const vy = by - ay; const L2 = vx * vx + vy * vy || 1;
    const t = Math.max(0, Math.min(1, ((x - ax) * vx + (y - ay) * vy) / L2));
    const d = Math.hypot(ax + vx * t - x, ay + vy * t - y);
    if (d < best) { best = d; at = sArr[i] + t * Math.sqrt(L2); }
  }
  return at;
}

/**
 * The lead deck's two edges at station s of its span, with the legs' feet just outside them, stepped out
 * past any other deck of the crossing right beside (a leg never stands in a lane). Returns { P, n, feet:
 * [left, right] ground points, edges: [left, right] offsets on the lead's part, zDeck }.
 */
function leadEdges(crossing, lead, s) {
  const P = along(lead.part, s, 0, lead.sArr);
  const Q = along(lead.part, Math.min(lead.sArr.at(-1), s + 1), 0, lead.sArr);
  const ul = Math.hypot(Q[0] - P[0], Q[1] - P[1]) || 1;
  const n = [-(Q[1] - P[1]) / ul, (Q[0] - P[0]) / ul];
  const edgeOf = (side) => sideHalf(lead.part, lead.sArr, s, side > 0 ? 0 : 1) + PARAPET_W_M;
  // along the line across the lead deck here: where another deck or a ground road lies (with its height,
  // null for the ground's), sampled every half metre out to REACH_M each side
  const REACH_M = 70; const STEP = 0.5;
  const blockedAt = (lat) => obstacleAt(crossing.obstacles || [], P[0] + n[0] * lat, P[1] + n[1] * lat);
  const feet = []; const knees = [];
  for (const side of [1, -1]) {
    // the foot: the first spot out from the deck's edge where a whole leg stands clear of everything
    const edge = edgeOf(side);
    const first = edge + LEG[0] / 2 + 0.4;
    let lat = first; let zOver = P[2];
    const clear = (l) => [-1, 0, 1].every((k) => !blockedAt(side * (l + (k * LEG[0]) / 2)));
    while (lat < edge + REACH_M && !clear(lat)) lat += STEP;
    if (lat >= edge + REACH_M) lat = first;   // (nowhere clear: at the edge, as a single deck's)
    // the decks the leaning leg passes over on its way in: its knee over the highest one's headroom
    for (let l = edge; l < lat; l += STEP) { const h = blockedAt(side * l); if (h?.z != null) zOver = Math.max(zOver, h.z); }
    feet.push([P[0] + n[0] * side * lat, P[1] + n[1] * side * lat]);
    knees.push(zOver + ARCH_HEADROOM_M + 0.5);
  }
  // whether a strut between the feet at height z leaves headroom over everything under it (a ramp or a
  // street beneath the deck)
  const strutClear = (z, groundAt) => {
    const lats = feet.map((f) => (f[0] - P[0]) * n[0] + (f[1] - P[1]) * n[1]);
    for (let l = Math.min(...lats); l <= Math.max(...lats); l += STEP) {
      if (Math.abs(l) < edgeOf(l)) continue;   // (under the lead deck itself)
      const h = blockedAt(l);
      if (!h) continue;
      const zr = h.z ?? groundAt(P[0] + n[0] * l, P[1] + n[1] * l);
      if (zr > z - 1 - ARCH_HEADROOM_M) return false;
    }
    return true;
  };
  return { P, n, feet, knees, strutClear, edges: [edgeOf(1), -edgeOf(-1)], zDeck: P[2] };
}

const EDGE_STRIP_M = 1;       // a stay may pass low over a lane's outermost metre (the edge line's strip), no further in

/**
 * The lowest height over the deck a stay from the deck's edge (edgeLat out from the centre) may leave the
 * pylon at its centre line and still pass over the lanes (half wide) only above their headroom or over
 * their outermost metre.
 */
export const stayAnchorMin = (half, edgeLat) => ARCH_HEADROOM_M * edgeLat / Math.max(0.3, edgeLat - (half - EDGE_STRIP_M));

/**
 * An inverted-Y pylon (the Zakim's): each leg rises plumb from the ground outside the deck's edge past the
 * lanes' headroom (never over a lane below it), then leans in to a junction high over the lanes; one
 * column on to the top. Returns { anchor(k, z): where leg k's plane of stays meets the pylon at height z
 * (its upper leg under the junction, beside the column over it), zJ, top }.
 */
function invertedY(b, feet, kneeZ, P, n, zDeck, H, groundAt, strutClear = () => true) {
  const top = zDeck + H;
  const zJ = Math.max(Math.max(...kneeZ) + 10, zDeck + H * 0.6);
  const J = [P[0], P[1], zJ];
  const knees = feet.map((f, k) => [f[0], f[1], kneeZ[k]]);
  const ac = [-n[1], n[0]];   // across a leg: along the bridge
  feet.forEach((f, k) => beam(b, [f[0], f[1], groundAt(f[0], f[1]) - 1], [f[0], f[1], kneeZ[k] + 0.8], LEG[0], LEG[1], ac));
  for (const k of knees) {
    // the leaning leg starts inside a collar at the knee (two beams meeting at an angle leave a step)
    const d = [J[0] - k[0], J[1] - k[1], J[2] - k[2]]; const L = Math.hypot(...d);
    beam(b, [k[0] - (d[0] / L) * 0.8, k[1] - (d[1] / L) * 0.8, k[2] - (d[2] / L) * 0.8], J, LEG[0], LEG[1]);
    beam(b, [k[0], k[1], k[2] - 1.4], [k[0], k[1], k[2] + 1.6], LEG[0] * 1.35, LEG[1] * 1.25, ac);
  }
  beam(b, J, [P[0], P[1], top], LEG[0] * 1.1, LEG[1] * 1.1, ac);
  // a pointed cap (a flat-cut column top looked unfinished)
  {
    const hw = (LEG[0] * 1.1) / 2; const hh = (LEG[1] * 1.1) / 2;
    const c = (sa, sv) => [P[0] + ac[0] * sa * hw + n[0] * sv * hh, P[1] + ac[1] * sa * hw + n[1] * sv * hh, top];
    const apex = [P[0], P[1], top + 5];
    const ring = [c(-1, -1), c(1, -1), c(1, 1), c(-1, 1)];
    for (let i = 0; i < 4; i++) {
      const p0 = ring[i]; const p1 = ring[(i + 1) % 4];
      const mx = (p0[0] + p1[0]) / 2 - P[0]; const my = (p0[1] + p1[1]) / 2 - P[1]; const ml = Math.hypot(mx, my) || 1;
      b.tri(p0, p1, apex, [mx / ml, my / ml, 0.5]);
    }
  }
  // a strut under the deck between the plumb legs, where the ground leaves room
  const fz = zDeck - 2.6;
  if (fz - Math.max(...feet.map((f) => groundAt(f[0], f[1]))) > 3 && strutClear(fz, groundAt)) beam(b, [feet[0][0], feet[0][1], fz], [feet[1][0], feet[1][1], fz], XBEAM[0], XBEAM[1]);
  const anchor = (k, z) => {
    if (z < zJ) { const f = Math.max(0, (z - kneeZ[k]) / (zJ - kneeZ[k])); return [knees[k][0] + (J[0] - knees[k][0]) * f, knees[k][1] + (J[1] - knees[k][1]) * f, z]; }
    const o = k === 0 ? 0.6 : -0.6;
    return [P[0] + n[0] * o, P[1] + n[1] * o, z];
  };
  // the height where leg k has come in over a lateral `lat` from the centre (its stays leave it no lower:
  // further out, over a neighbouring deck, they would cross its lanes)
  const overLat = (k, lat) => {
    const footLat = Math.hypot(feet[k][0] - P[0], feet[k][1] - P[1]);
    return footLat <= lat ? kneeZ[k] : kneeZ[k] + (1 - lat / footLat) * (zJ - kneeZ[k]);
  };
  return { anchor, overLat, zJ, top };
}

/** The highest obstacle (deck: its height; ground road: z null) at (x, y), or null. */
function obstacleAt(obstacles, x, y) {
  let hit = null;
  for (const o of obstacles) {
    if (!o.box) {
      o.box = [Infinity, Infinity, -Infinity, -Infinity];
      for (const [px, py] of o.xy) { o.box[0] = Math.min(o.box[0], px); o.box[1] = Math.min(o.box[1], py); o.box[2] = Math.max(o.box[2], px); o.box[3] = Math.max(o.box[3], py); }
    }
    if (o.maxHalf === undefined) o.maxHalf = o.halfs ? Math.max(...o.halfs) : o.half;
    const rMax = o.maxHalf + PARAPET_W_M + 0.3;
    if (x < o.box[0] - rMax || x > o.box[2] + rMax || y < o.box[1] - rMax || y > o.box[3] + rMax) continue;
    for (let i = 0; i + 1 < o.xy.length; i++) {
      const [ax, ay] = o.xy[i]; const [bx, by] = o.xy[i + 1];
      const vx = bx - ax; const vy = by - ay; const L2 = vx * vx + vy * vy || 1;
      const t = Math.max(0, Math.min(1, ((x - ax) * vx + (y - ay) * vy) / L2));
      const r = (o.halfs ? o.halfs[i] + (o.halfs[i + 1] - o.halfs[i]) * t : o.half) + PARAPET_W_M + 0.3;
      if (Math.hypot(ax + vx * t - x, ay + vy * t - y) > r) continue;
      const z = o.z ? o.z[i] + (o.z[i + 1] - o.z[i]) * t : null;
      if (!hit || (z ?? -Infinity) > (hit.z ?? -Infinity)) hit = { z };
    }
  }
  return hit;
}

const ANCHOR_BARRIER = [0.45, 1.1];   // a concrete barrier on the deck's edge for the stays (width, height)

/**
 * Edge k of the lead deck over [a0, a1]: where another deck is flush against it (the decks one surface: a
 * stay or hanger would land between lanes) a concrete barrier along it, as on the real thing. Returns
 * foot(sd): where a stay or hanger lands at sd (on the barrier's top, else the edge).
 */
function edgeFeet(b, crossing, lead, E, k, a0, a1) {
  const side = k === 0 ? 1 : -1;
  const obstacles = crossing.obstacles || [];
  // the edge as it stands at sd: the lead's own edge, or where another deck overlapping it (two OSM lines
  // closer than their widths: the higher one covers the lower's edge) leaves its surface open (a foot
  // under it would bring the stay up through that deck's lanes)
  const edgeAt = (sd) => {
    let lat = side * (sideHalf(lead.part, lead.sArr, sd, k) + PARAPET_W_M);
    for (let guard = 0; guard < 80; guard++) {
      const p = along(lead.part, sd, lat, lead.sArr);
      const h = obstacleAt(obstacles, p[0], p[1]);
      if (!h || h.z == null || h.z < p[2] - 0.5 || Math.abs(lat) < lead.part.half * 0.4) break;
      lat -= side * 0.25;
    }
    return lat;
  };
  const flushAt = (sd, lat) => {
    const d = along(lead.part, sd, lat, lead.sArr);
    const o = along(lead.part, sd, lat + side * 1.0, lead.sArr);
    const h = obstacleAt(obstacles, o[0], o[1]);
    return h?.z != null && Math.abs(h.z - d[2]) < 1.5;
  };
  // where another deck is flush against the edge (the decks one surface: a stay or hanger would land
  // between lanes) a concrete barrier along it, as on the real thing
  for (let sd = a0; sd + 2 <= a1; sd += 2) {
    const l0 = edgeAt(sd); const l1 = edgeAt(sd + 2);
    if (!flushAt(sd, l0) && !flushAt(sd + 2, l1)) continue;
    beam(b, along(lead.part, sd, l0 - side * 0.05, lead.sArr), along(lead.part, sd + 2, l1 - side * 0.05, lead.sArr), ANCHOR_BARRIER[0], ANCHOR_BARRIER[1] * 2);
  }
  return (sd) => {
    const lat = edgeAt(sd);
    const flush = flushAt(sd, lat);
    // (on the very edge: a main cable over it clears the lanes)
    const d = along(lead.part, sd, flush ? lat - side * 0.05 : lat, lead.sArr);
    return [d[0], d[1], d[2] + (flush ? ANCHOR_BARRIER[1] : 0.3)];
  };
}

function suspensionCrossing(towerB, cableB, deck, groundAt) {
  const crossing = deck.style.crossing || { decks: [deck], lead: deck };
  const lead = { ...mainSpan(deck), deck };
  const { sp, L } = lead;
  const sideFrac = L >= 300 ? 0.18 : 0.02;
  const t0 = sp.s0 + L * sideFrac; const t1 = sp.s1 - L * sideFrac;
  const main = t1 - t0;
  const H = Math.max(22, main / 8.5);
  // the towers: two plumb legs where they stand clear of every deck and road (leadEdges), cross beams
  // over the highest deck's headroom between them and at the top; the main cables' saddles on the top
  // beam over the lead deck's edges
  const towers = [t0, t1].map((ts) => {
    const E = leadEdges(crossing, lead, ts);
    const top = Math.max(E.zDeck + H, Math.max(...E.knees) + 12);
    const ac = [-E.n[1], E.n[0]];
    E.feet.forEach((f) => beam(towerB, [f[0], f[1], groundAt(f[0], f[1]) - 1], [f[0], f[1], top], LEG[0], LEG[1], ac));
    for (const z of [Math.max(...E.knees) + 1, top - 1.5]) beam(towerB, [E.feet[0][0], E.feet[0][1], z], [E.feet[1][0], E.feet[1][1], z], XBEAM[0], XBEAM[1]);
    const fz = E.zDeck - 2.6;
    if (fz - Math.max(...E.feet.map((f) => groundAt(f[0], f[1]))) > 3 && E.strutClear(fz, groundAt)) beam(towerB, [E.feet[0][0], E.feet[0][1], fz], [E.feet[1][0], E.feet[1][1], fz], XBEAM[0], XBEAM[1]);
    return { E, saddles: E.edges.map((e) => { const p = along(lead.part, ts, e, lead.sArr); return [p[0], p[1], top - 0.3]; }) };
  });
  // each side: the main cable from saddle to saddle in the plane over the lead deck's edge, 2 m over it at
  // its lowest, hangers down to the edge (or the barrier on it); side spans down to the run's ends
  for (const k of [0, 1]) {
    const foot = edgeFeet(towerB, crossing, lead, towers[0].E, k, sp.s0, sp.s1);
    const [A, B] = [towers[0].saddles[k], towers[1].saddles[k]];
    const n = Math.max(16, Math.round(main / 10));
    const pts = [];
    for (let i = 0; i <= n; i++) {
      const t = i / n; const d = foot(t0 + main * t);
      const chord = A[2] + (B[2] - A[2]) * t; const low = d[2] + 2;
      pts.push([d[0], d[1], chord - (chord - low) * 4 * t * (1 - t)]);
      if (i > 0 && i < n && pts[i][2] - d[2] > 1.2) beam(cableB, d, pts[i], STAY[0], STAY[1]);
    }
    pts[0] = A; pts[n] = B;
    for (let i = 0; i < n; i++) beam(cableB, pts[i], pts[i + 1], CABLE[0], CABLE[1]);
    for (const [top, sEnd] of [[A, sp.s0], [B, sp.s1]]) {
      const e = foot(sEnd);
      if (Math.hypot(e[0] - top[0], e[1] - top[1]) > 6) beam(cableB, top, e, CABLE[0], CABLE[1]);
    }
  }
}

function cableStayedCrossing(pylonB, cableB, deck, groundAt) {
  const crossing = deck.style.crossing || { decks: [deck], lead: deck };
  const lead = { ...mainSpan(deck), deck };
  const { sp, L } = lead;
  const stations = L >= 220 ? [sp.s0 + L * 0.27, sp.s1 - L * 0.27] : [sp.s0 + L / 2];
  const reach = stations.length === 2 ? L * 0.26 : L * 0.48;
  for (const ps of stations) {
    const E = leadEdges(crossing, lead, ps);
    const edgeMax = Math.max(E.edges[0], -E.edges[1]);
    const zMin = stayAnchorMin(edgeMax - PARAPET_W_M, edgeMax);
    const H = Math.max(35, reach * 0.45, zMin + 12);
    const py = invertedY(pylonB, E.feet, E.knees, E.P, E.n, E.zDeck, Math.max(H, Math.max(...E.knees) - E.zDeck + 22), groundAt, E.strutClear);
    const lo = E.zDeck + zMin + 0.5; const hi = py.top - 1.5;
    const nStay = Math.max(4, Math.round(reach / 12));
    // two planes of stays: each leg's upper part to the lead deck's own edge on that side (the farther the
    // anchorage, the higher on the leg); none to other decks: they would cross their lanes
    for (const k of [0, 1]) {
      const loK = Math.min(hi - 2, Math.max(lo, py.overLat(k, Math.abs(E.edges[k]))));
      const foot = edgeFeet(pylonB, crossing, lead, E, k, Math.max(sp.s0, ps - reach - 4), Math.min(sp.s1, ps + reach + 4));
      for (const dir of [-1, 1]) {
        for (let j = 1; j <= nStay; j++) {
          const sd = ps + dir * (reach * j) / nStay;
          if (sd < sp.s0 || sd > sp.s1) continue;
          const zHead = loK + (hi - loK) * (j / nStay);
          beam(cableB, foot(sd), py.anchor(k, zHead), STAY[0], STAY[1]);
        }
      }
    }
  }
}
