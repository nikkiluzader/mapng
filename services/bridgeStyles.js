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

/** A beam (box) between points p and q, `w` wide (horizontal, across) and `h` tall. */
export function beam(b, p, q, w, h) {
  const d = [q[0] - p[0], q[1] - p[1], q[2] - p[2]];
  const L = Math.hypot(...d);
  if (L < 1e-6) return;
  const u = d.map((v) => v / L);
  // across: horizontal, perpendicular to the beam (a vertical beam: along x)
  let a = [-u[1], u[0], 0];
  const al = Math.hypot(a[0], a[1]);
  a = al < 1e-6 ? [1, 0, 0] : [a[0] / al, a[1] / al, 0];
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
export function linkCrossings(decks) {
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
    for (const d of g) d.style.crossing = { decks: g, lead };
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
 * At station s of the lead's span: the crossing's two outer deck edges, [{ deck span, s on it, off (its
 * outer edge's offset on its own part: + left / - right) }, ...] (left, right), and the legs' points.
 */
function crossingEdges(crossing, lead, s) {
  const P = along(lead.part, s, 0, lead.sArr);
  const Q = along(lead.part, Math.min(lead.sArr.at(-1), s + 1), 0, lead.sArr);
  const ul = Math.hypot(Q[0] - P[0], Q[1] - P[1]) || 1;
  const n = [-(Q[1] - P[1]) / ul, (Q[0] - P[0]) / ul];
  let left = null; let right = null;
  for (const d of crossing.decks) {
    const m = d === lead.deck ? lead : { ...mainSpan(d), deck: d };
    const sd = nearestS(m.part, m.sArr, P[0], P[1]);
    const c = along(m.part, sd, 0, m.sArr);
    const lat = (c[0] - P[0]) * n[0] + (c[1] - P[1]) * n[1];
    // which of this deck's edges faces out (its own left may be the crossing's right)
    const c2 = along(m.part, Math.min(m.sArr.at(-1), sd + 1), 0, m.sArr);
    const same = ((c2[0] - c[0]) * (Q[0] - P[0]) + (c2[1] - c[1]) * (Q[1] - P[1])) >= 0 ? 1 : -1;
    const edge = m.part.half + PARAPET_W_M + SIDE_GAP_M;
    if (!left || lat + edge > left.lat) left = { m, sd, off: same * edge, lat: lat + edge, dirSign: same };
    if (!right || lat - edge < right.lat) right = { m, sd, off: -same * edge, lat: lat - edge, dirSign: same };
  }
  const leg = (lat) => [P[0] + n[0] * (lat + Math.sign(lat || 1) * 0.8), P[1] + n[1] * (lat + Math.sign(lat || 1) * 0.8), P[2]];
  return { left, right, legs: [leg(left.lat), leg(right.lat)], zDeck: P[2] };
}

/** A tower at a crossing station: two legs from the ground to `top` outside the outer decks, cross beams. */
function crossingTower(b, legs, zDeck, top, groundAt) {
  const mid = [(legs[0][0] + legs[1][0]) / 2, (legs[0][1] + legs[1][1]) / 2];
  const tops = legs.map((p) => {
    const g = groundAt(p[0], p[1]);
    const L = Math.hypot(mid[0] - p[0], mid[1] - p[1]) || 1;
    const lean = Math.min(1.5, L * 0.12);
    const t = [p[0] + ((mid[0] - p[0]) / L) * lean, p[1] + ((mid[1] - p[1]) / L) * lean, top];
    beam(b, [p[0], p[1], g - 1], t, LEG[0], LEG[1]);
    return t;
  });
  for (const z of [Math.max(zDeck + ARCH_HEADROOM_M + 2.5, zDeck + (top - zDeck) * 0.55), top - 1.5]) {
    const f = (z - (groundAt(legs[0][0], legs[0][1]) - 1)) / (top - (groundAt(legs[0][0], legs[0][1]) - 1));
    const at = (k) => [legs[k][0] + (tops[k][0] - legs[k][0]) * f, legs[k][1] + (tops[k][1] - legs[k][1]) * f, z];
    beam(b, at(0), at(1), XBEAM[0], XBEAM[1]);
  }
  return tops;
}

function suspensionCrossing(towerB, cableB, deck, groundAt) {
  const crossing = deck.style.crossing || { decks: [deck], lead: deck };
  const lead = { ...mainSpan(deck), deck };
  const { sp, L } = lead;
  const side = L >= 300 ? 0.18 : 0.02;
  const t0 = sp.s0 + L * side; const t1 = sp.s1 - L * side;
  const main = t1 - t0;
  const A = crossingEdges(crossing, lead, t0); const B = crossingEdges(crossing, lead, t1);
  const H = Math.max(22, main / 8.5);
  const topsA = crossingTower(towerB, A.legs, A.zDeck, A.zDeck + H, groundAt);
  const topsB = crossingTower(towerB, B.legs, B.zDeck, B.zDeck + H, groundAt);
  // each side: the main cable from tower top to tower top over the outer deck's edge, hangers down to it
  for (const k of [0, 1]) {
    const edgeA = k === 0 ? A.left : A.right;
    const m = edgeA.m;
    const sA = edgeA.sd; const sB = nearestS(m.part, m.sArr, B.legs[k][0], B.legs[k][1]);
    const n = Math.max(16, Math.round(main / 10));
    const pts = [];
    for (let i = 0; i <= n; i++) {
      const t = i / n; const sd = sA + (sB - sA) * t;
      const d = along(m.part, sd, edgeA.off, m.sArr);
      const chord = topsA[k][2] + (topsB[k][2] - topsA[k][2]) * t; const low = d[2] + 2;
      pts.push([topsA[k][0] + (topsB[k][0] - topsA[k][0]) * t, topsA[k][1] + (topsB[k][1] - topsA[k][1]) * t, chord - (chord - low) * 4 * t * (1 - t)]);
      if (i > 0 && i < n && pts[i][2] - d[2] > 1.2) beam(cableB, [d[0], d[1], d[2] + 0.2], pts[i], STAY[0], STAY[1]);
    }
    for (let i = 0; i < n; i++) beam(cableB, pts[i], pts[i + 1], CABLE[0], CABLE[1]);
    // side spans down to the anchorages at the run's ends
    for (const [top, sEnd] of [[topsA[k], sp.s0], [topsB[k], sp.s1]]) {
      const e = along(lead.part, sEnd, k === 0 ? lead.part.half + PARAPET_W_M + SIDE_GAP_M : -(lead.part.half + PARAPET_W_M + SIDE_GAP_M), lead.sArr);
      if (Math.hypot(e[0] - top[0], e[1] - top[1]) > 6) beam(cableB, top, [e[0], e[1], e[2] + 0.5], CABLE[0], CABLE[1]);
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
    const C = crossingEdges(crossing, lead, ps);
    const H = Math.max(25, reach * 0.42);
    const tops = crossingTower(pylonB, C.legs, C.zDeck, C.zDeck + H, groundAt);
    const nStay = Math.max(4, Math.round(reach / 12));
    // each leg's stays to the outer deck on its side only (none across another deck's lanes)
    for (const k of [0, 1]) {
      const edge = k === 0 ? C.left : C.right;
      const m = edge.m;
      for (const dir of [-1, 1]) {
        for (let j = 1; j <= nStay; j++) {
          const sd = edge.sd + dir * edge.dirSign * (reach * j) / nStay;
          if (sd < m.sp.s0 || sd > m.sp.s1) continue;
          const d = along(m.part, sd, edge.off, m.sArr);
          const zHead = tops[k][2] - 1 - (H * 0.3) * (1 - j / nStay);
          beam(cableB, [d[0], d[1], d[2] + 0.3], [tops[k][0], tops[k][1], zHead], STAY[0], STAY[1]);
        }
      }
    }
  }
}
