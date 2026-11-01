// Sports fields for BeamNG exports: OSM leisure=pitch (by sport=*),
// leisure=track and the seating beside them (building=grandstand,
// leisure=bleachers), built into the building tiles (beamngBuildings.js).
//
// The surface (surface=*, else the sport's usual one): grass, artificial
// turf, sand or dirt lie on the ground (a fine grid of its heights, a hand
// over its bumps; grass mown in stripes); hard courts, clay, tartan and
// skateparks are a slab, flat at the highest ground with its edge down to
// the ground. Markings: each sport's regulation layout in the field's own
// frame (its best oriented box, the long side along s), scaled to the mapped
// size (lengths along and across by their own scale, circles by the smaller).
// Fittings by sport: goals with nets, American football and rugby posts,
// basketball hoops, tennis / volleyball / pickleball nets, netball rings,
// a baseball diamond (home plate at the outline's square corner farthest
// from its middle) with a backstop, chain-link fences round tennis courts
// and baseball outfields, skatepark ramps. Seating: tiered aluminium
// bleachers facing the nearest field.
//
// Stonework (slabs, posts, frames, seats) goes to both detail levels (the
// lite one is the collision), lines, nets and turf to the full one.
// Deterministic; no place-specific rules. Pure geometry.

import * as THREE from 'three';
import { box, cylinder } from './buildingDetails.js';
import { hash01, signedArea, cleanRing, inRing, lathe } from './fountains.js';
import { orientedBox, frameAt } from './waterCover.js';
import { smoothRing, poolShape, bar } from './pools.js';
import { footballIsGridiron } from './beamngRegion.js';

// ── What a field is ──────────────────────────────────────────────────────────

const SPORT_ALIASES = {
  soccer: 'soccer', 'five-a-side': 'futsal', futsal: 'futsal', american_football: 'american_football', canadian_football: 'american_football',
  rugby: 'rugby', rugby_union: 'rugby', rugby_league: 'rugby', gaelic_games: 'rugby', australian_football: 'cricket',
  baseball: 'baseball', softball: 'softball', cricket: 'cricket', field_hockey: 'field_hockey', hockey: 'field_hockey', lacrosse: 'soccer',
  basketball: 'basketball', tennis: 'tennis', padel: 'padel', pickleball: 'pickleball', badminton: 'pickleball', platform_tennis: 'pickleball',
  volleyball: 'volleyball', beachvolleyball: 'beach_volleyball', beach_volleyball: 'beach_volleyball', netball: 'netball', korfball: 'netball',
  handball: 'handball', american_handball: 'handball', skateboard: 'skateboard', bmx: 'skateboard', athletics: 'track', running: 'track',
  multi: 'multi', bowls: 'bowls', boules: 'boules', petanque: 'boules', croquet: 'bowls', equestrian: 'equestrian', four_square: 'multi',
};
// the usual surface of each
const USUAL_SURFACE = {
  soccer: 'grass', futsal: 'hard', american_football: 'grass', rugby: 'grass', baseball: 'grass', softball: 'grass', cricket: 'grass',
  field_hockey: 'artificial_turf', basketball: 'concrete', tennis: 'hard', padel: 'artificial_turf', pickleball: 'hard', volleyball: 'sand',
  beach_volleyball: 'sand', netball: 'hard', handball: 'hard', skateboard: 'concrete', track: 'tartan', multi: 'hard', bowls: 'grass',
  boules: 'gravel', equestrian: 'sand',
};
const SURFACE_OF = {
  grass: 'grass', artificial_turf: 'turf', 'artificial_grass': 'turf', astroturf: 'turf', clay: 'clay', sand: 'sand', dirt: 'dirt', earth: 'dirt',
  ground: 'dirt', gravel: 'gravel', fine_gravel: 'gravel', compacted: 'gravel', asphalt: 'asphalt', concrete: 'concrete', paved: 'concrete',
  hard: 'hard', acrylic: 'hard', tartan: 'tartan', rubber: 'tartan', 'paving_stones': 'concrete', wood: 'hard', synthetic: 'hard',
};
// surfaces that lie on the ground (the rest are a flat slab)
const ON_GROUND = new Set(['grass', 'turf', 'sand', 'dirt', 'gravel', 'tartan']);   // (a track is graded to the ground's lie, not a raised slab)
const LOOK = {
  grass: ['turf', [0.52, 0.72, 0.42]], turf: ['turf', [0.44, 0.68, 0.38]], clay: ['dirt', [0.95, 0.55, 0.38]], sand: ['sand', [1, 0.96, 0.88]],
  dirt: ['dirt', [0.85, 0.66, 0.5]], gravel: ['dirt', [0.82, 0.78, 0.72]], asphalt: ['roofFlat', [0.55, 0.55, 0.56]],
  concrete: ['smoothConcrete', [0.82, 0.82, 0.8]], hard: ['smoothConcrete', [0.36, 0.55, 0.42]], tartan: ['smoothConcrete', [0.66, 0.24, 0.18]],
};
// hard courts by sport: the court and the run-off round it
const COURT_COLOURS = [[[0.3, 0.5, 0.36], [0.22, 0.4, 0.28]], [[0.25, 0.4, 0.62], [0.32, 0.5, 0.36]], [[0.24, 0.36, 0.56], [0.2, 0.3, 0.46]]];
const PAINT = [1, 1, 1];
const PAINT_MAT = 'linePaint';   // (plain white: polished concrete and stucco greyed the lines)
const STEEL = [0.72, 0.74, 0.76];
const NET = [0.92, 0.92, 0.9];
const DARK_NET = [0.18, 0.2, 0.2];
const POST_YELLOW = [1, 0.82, 0.12];
const LINE_W = 0.08;
const SLAB_H = 0.12;
const ON_GROUND_H = 0.06;     // a lying surface over the ground's bumps (sampled finely)
const MIN_AREA_M2 = 30;
const MAX_AREA_M2 = 40000;

/** The field's sport (one of the layouts), from sport=* (the first one known) and where it is. */
export function pitchSport(tags = {}, { lat = 0, lon = 0 } = {}) {
  if (tags.leisure === 'track') return 'track';
  // (the first one known; a named sport before 'multi')
  const known = String(tags.sport || '').toLowerCase().split(/[;,]/).map((x) => x.trim())
    .map((raw) => (raw === 'football' ? (footballIsGridiron(lat, lon) ? 'american_football' : 'soccer') : SPORT_ALIASES[raw])).filter(Boolean);
  return known.find((k) => k !== 'multi') || 'multi';
}

/**
 * Fields to build: [{ id, sport, surface, ring (counter-clockwise), hole,
 * box, slab (its top, or null: lying on the ground), fieldZ(x, y), seed,
 * tags }]. project(lat, lng) -> [x, y, ground]; groundAt(x, y) -> ground.
 */
// courts mapped as their lines alone: the slab widened by the run-off round
// them (behind the ends, beside the sides; up to halfway to the next court)
const RUNOFF = {
  tennis: { court: [23.77, 10.97], add: [6.4, 3.66] }, pickleball: { court: [13.41, 6.1], add: [3, 1.5] }, padel: { court: [20, 10], add: [0, 0] },
  basketball: { court: [28, 15], add: [2, 2] }, volleyball: { court: [18, 9], add: [3, 3] }, netball: { court: [30.5, 15.25], add: [3, 3] },
  handball: { court: [40, 20], add: [2, 1] }, futsal: { court: [40, 20], add: [2, 1] },
};
function runOff(list) {
  // (against the courts' own outlines, not the ones already widened)
  const rings = new Map(list.map((q) => [q, q.ring]));
  for (const q of list) {
    const r = RUNOFF[q.sport];
    if (!r || q.hole) continue;
    const bx = q.box; const L = bx.s1 - bx.s0; const W = bx.t1 - bx.t0;
    if (L > r.court[0] * 1.15 || W > r.court[1] * 1.3) continue;
    if (q.area / (L * W) < 0.9) continue;
    // each side out by the run-off, but no further than halfway to another court in front of it
    const room = { s0: r.add[0], s1: r.add[0], t0: r.add[1], t1: r.add[1] };
    for (let k = 0; k < list.length; k++) {
      const o = list[k]; if (o === q || !RUNOFF[o.sport]) continue;
      for (const c of rings.get(o)) {
        const s = c[0] * bx.u[0] + c[1] * bx.u[1]; const t = -c[0] * bx.u[1] + c[1] * bx.u[0];
        const inS = s > bx.s0 - r.add[0] && s < bx.s1 + r.add[0]; const inT = t > bx.t0 - r.add[1] && t < bx.t1 + r.add[1];
        if (inS && t >= bx.t1 - 0.5 && t < bx.t1 + 2 * r.add[1]) room.t1 = Math.min(room.t1, Math.max(0, (t - bx.t1) / 2));
        if (inS && t <= bx.t0 + 0.5 && t > bx.t0 - 2 * r.add[1]) room.t0 = Math.min(room.t0, Math.max(0, (bx.t0 - t) / 2));
        if (inT && s >= bx.s1 - 0.5 && s < bx.s1 + 2 * r.add[0]) room.s1 = Math.min(room.s1, Math.max(0, (s - bx.s1) / 2));
        if (inT && s <= bx.s0 + 0.5 && s > bx.s0 - 2 * r.add[0]) room.s0 = Math.min(room.s0, Math.max(0, (bx.s0 - s) / 2));
      }
    }
    const nb = { ...bx, s0: bx.s0 - room.s0, s1: bx.s1 + room.s1, t0: bx.t0 - room.t0, t1: bx.t1 + room.t1 };
    q.ring = [frameAt(nb, nb.s0, nb.t0), frameAt(nb, nb.s1, nb.t0), frameAt(nb, nb.s1, nb.t1), frameAt(nb, nb.s0, nb.t1)];
    q.box = nb; q.area = (nb.s1 - nb.s0) * (nb.t1 - nb.t0); q.court = r.court;
  }
}

export function planPitches(features, project, { groundAt = null, drape = null } = {}) {
  const out = [];
  const pending = [];
  for (const f of features || []) {
    const t = f?.tags || {};
    if (!(t.leisure === 'pitch' || t.leisure === 'track') || !Array.isArray(f.geometry) || f.geometry.length < 4) continue;
    if (t.indoor === 'yes' || t.covered === 'yes' || (Number.parseFloat(t.level) || 0) > 0 || t.building) continue;
    const g0 = f.geometry[0];
    const sport = pitchSport(t, { lat: g0.lat, lon: g0.lng });
    const pts = f.geometry.map((p) => project(p.lat, p.lng));
    let ring = cleanRing(pts);
    if (ring.length < 3) continue;
    let area = signedArea(ring);
    if (area < 0) { ring = ring.reverse(); area = -area; }
    if (area < MIN_AREA_M2 || area > MAX_AREA_M2) continue;
    // an oval drawn with a few points (a track, a cricket ground): smoothed
    if (poolShape(ring) === 'freeform' && ['track', 'cricket'].includes(sport)) ring = smoothRing(ring);
    let hole = null;
    if (f.holes?.length) {
      const h = cleanRing(f.holes[0].map((q) => project(q.lat, q.lng)));
      if (h.length >= 3) hole = poolShape(h) === 'freeform' ? smoothRing(h) : h;
    }
    let bx = orientedBox(ring);
    if (!bx) continue;
    // a track shaped like the usual oval (straights and semicircles): drawn as
    // that exact oval, its lanes exact offsets of it (offsetting the mapped
    // outline crossed lane lines where it was noisy)
    let stadium = false;
    if (sport === 'track') {
      const ideal = stadiumRing(bx, 0);
      const now = Math.abs(signedArea(ring));
      if (Math.abs(signedArea(ideal) - now) / now < 0.08 && (bx.s1 - bx.s0) > (bx.t1 - bx.t0)) { ring = ideal; stadium = true; area = signedArea(ideal); }
    }
    // a track's infield: its mapped inner ring, else the lanes' width in from its edge
    if (sport === 'track' && (!hole || stadium)) {
      const lanes = Math.max(4, Math.min(10, Number.parseInt(t.lanes, 10) || 6));
      hole = stadium ? stadiumRing(bx, lanes * 1.22 + 0.3) : insetPts(ring, lanes * 1.22 + 0.3);
    }
    // (an untagged field: a hard court when small, else a grass field)
    const usual = sport === 'multi' && area > 1000 ? 'grass' : USUAL_SURFACE[sport];
    const surface = SURFACE_OF[String(t.surface || '').toLowerCase()] || SURFACE_OF[usual] || 'grass';
    const grounds = pts.map((p) => p[2]).filter(Number.isFinite);
    pending.push({ id: f.id, sport, surface, ring, hole, box: bx, area, stadium, seed: String(f.id), tags: t, z0: Math.min(...grounds), z1: Math.max(...grounds) });
  }
  runOff(pending);
  // each field's neighbours (their outlines after the run-off): its fences keep out of them
  for (const p of pending) {
    const [x0, y0, x1, y1] = ringBox(p.ring);
    p.neighbours = pending.filter((o) => o !== p).map((o) => o.ring).filter((r) => { const [a, b, c, d] = ringBox(r); return a < x1 + 10 && c > x0 - 10 && b < y1 + 10 && d > y0 - 10; });
  }
  for (const p of pending) {
    const { box: bx, area, surface, sport } = p;
    const ground = groundAt || (() => p.z1);
    // the surface's heights: a grid in the field's frame, each point the
    // highest ground round it (a raw survey's bumps stay under the surface)
    const L = bx.s1 - bx.s0; const W = bx.t1 - bx.t0;
    const step = Math.min(1, Math.max(0.5, Math.sqrt(area) / 200));
    const ns = Math.ceil(L / step) + 1; const nt = Math.ceil(W / step) + 1;
    const grid = new Float32Array(ns * nt);
    let top = -Infinity;
    for (let i = 0; i < ns; i++) for (let j = 0; j < nt; j++) {
      const s = bx.s0 + Math.min(L, i * step); const tt = bx.t0 + Math.min(W, j * step);
      let z = -Infinity;
      // (the highest within a metre: a raw survey's sharp bumps between
      // samples poked through)
      for (let a = -2; a <= 2; a++) for (let b = -2; b <= 2; b++) z = Math.max(z, ground(...frameAt(bx, s + a * 0.5, tt + b * 0.5)));
      grid[i * nt + j] = z;
      top = Math.max(top, z);
    }
    p.slab = ON_GROUND.has(surface) ? null : top + SLAB_H;
    // (a track lies a little lower: a field mapped into its lanes lies over it, not through it)
    const lie = sport === 'track' ? ON_GROUND_H - 0.02 : ON_GROUND_H;
    p.fieldZ = p.slab !== null ? () => p.slab : (x, y) => {
      const s = (x * bx.u[0] + y * bx.u[1] - bx.s0) / step; const tt = (-x * bx.u[1] + y * bx.u[0] - bx.t0) / step;
      const i = Math.max(0, Math.min(ns - 2, Math.floor(s))); const j = Math.max(0, Math.min(nt - 2, Math.floor(tt)));
      const fs = Math.max(0, Math.min(1, s - i)); const ft = Math.max(0, Math.min(1, tt - j));
      const g = (a, b) => grid[(i + a) * nt + j + b];
      return (g(0, 0) * (1 - fs) + g(1, 0) * fs) * (1 - ft) + (g(0, 1) * (1 - fs) + g(1, 1) * fs) * ft + lie;
    };
    // lying on the ground with the terrain at hand: draped on its own triangles, a hair over them
    if (p.slab === null && drape) {
      // (a hair: under 1 cm the ground won the depth test a few dozen metres off)
      const hair = sport === 'track' ? 0.025 : 0.035;
      p.drape = drape;
      p.fieldZ = (x, y) => drape.drapeAt(x, y) + hair;
    }
    p.ground = ground;
    out.push(p);
  }
  // fences round tennis courts: an edge shared with the next court has none
  for (const p of out) {
    if (!['tennis', 'padel', 'pickleball', 'baseball', 'softball'].includes(p.sport)) continue;
    p.fenceEdges = p.ring.map((a, i) => {
      const b = p.ring[(i + 1) % p.ring.length];
      const L = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
      const mid = [(a[0] + b[0]) / 2 + ((b[1] - a[1]) / L) * 1.5, (a[1] + b[1]) / 2 - ((b[0] - a[0]) / L) * 1.5];
      return !out.some((q) => q !== p && ['tennis', 'padel', 'pickleball'].includes(q.sport) && inRing(mid[0], mid[1], q.ring));
    });
  }
  return out;
}

const ringBox = (r) => [Math.min(...r.map((q) => q[0])), Math.min(...r.map((q) => q[1])), Math.max(...r.map((q) => q[0])), Math.max(...r.map((q) => q[1]))];
// (a point inside a neighbouring field: no fence there)
const inNeighbour = (p, x, y) => (p.neighbours || []).some((r) => inRing(x, y, r));

/** Ground each field covers (no ground cover grows through it). */
export function pitchFootprints(pitches) {
  return pitches.map((p) => p.ring);
}

// ── Drawing helpers ──────────────────────────────────────────────────────────

// a flat quad strip from a to b (world xy), w wide, at the surface z (+ lift), split every metre
// (a surface lying on the ground is straight between its points, the heights
// a curve: paint over it lifted a hand's breadth, over a flat slab a few mm)
const lifted = (p, lift) => (p.slab !== null ? lift : lift + (p.drape ? 0.012 : 0.035));
function strip(m, mat, p, a, b, w, col, lift = 0.012) {
  lift = lifted(p, lift);
  const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
  if (L < 1e-3) return;
  const u = [(b[0] - a[0]) / L, (b[1] - a[1]) / L]; const n = [-u[1] * w / 2, u[0] * w / 2];
  const k = Math.max(1, Math.ceil(L / (p.drape ? 0.5 : 1.5)));
  for (let i = 0; i < k; i++) {
    const q0 = [a[0] + (b[0] - a[0]) * (i / k), a[1] + (b[1] - a[1]) * (i / k)];
    const q1 = [a[0] + (b[0] - a[0]) * ((i + 1) / k), a[1] + (b[1] - a[1]) * ((i + 1) / k)];
    const z0 = p.fieldZ(...q0) + lift; const z1 = p.fieldZ(...q1) + lift;
    m.quad(mat, [q0[0] - n[0], q0[1] - n[1], z0], [q1[0] - n[0], q1[1] - n[1], z1], [q1[0] + n[0], q1[1] + n[1], z1], [q0[0] + n[0], q0[1] + n[1], z0],
      [0, 0], [1, 0], [1, 1], [0, 1], col);
  }
}
// lines in the field's frame: (s, t) points
const F = (p, s, t) => frameAt(p.box, s, t);
function lineST(m, p, s0, t0, s1, t1, w = LINE_W, col = PAINT, lift) { strip(m, PAINT_MAT, p, F(p, s0, t0), F(p, s1, t1), w, col, lift); }
function dashedST(m, p, s0, t0, s1, t1, dash = 1, gap = 1, w = LINE_W) {
  const L = Math.hypot(s1 - s0, t1 - t0);
  for (let d = 0; d < L; d += dash + gap) {
    const e = Math.min(L, d + dash);
    lineST(m, p, s0 + ((s1 - s0) * d) / L, t0 + ((t1 - t0) * d) / L, s0 + ((s1 - s0) * e) / L, t0 + ((t1 - t0) * e) / L, w);
  }
}
function rectST(m, p, s0, t0, s1, t1, w = LINE_W) {
  lineST(m, p, s0, t0, s1, t0, w); lineST(m, p, s1, t0, s1, t1, w); lineST(m, p, s1, t1, s0, t1, w); lineST(m, p, s0, t1, s0, t0, w);
}
// an arc round (sc, tc), radius r, angles a0..a1 (radians; 0 along +s)
function arcST(m, p, sc, tc, r, a0, a1, w = LINE_W, col = PAINT) {
  const n = Math.max(6, Math.ceil((Math.abs(a1 - a0) * r) / 0.6));
  for (let i = 0; i < n; i++) {
    const b0 = a0 + ((a1 - a0) * i) / n; const b1 = a0 + ((a1 - a0) * (i + 1)) / n;
    lineST(m, p, sc + r * Math.cos(b0), tc + r * Math.sin(b0), sc + r * Math.cos(b1), tc + r * Math.sin(b1), w, col);
  }
}
function spotST(m, p, s, t, r = 0.12, col = PAINT) {
  const c = F(p, s, t); const z = p.fieldZ(...c) + lifted(p, 0.013);
  for (let i = 0; i < 8; i++) {
    const a0 = (Math.PI * i) / 4; const a1 = (Math.PI * (i + 1)) / 4;
    m.tri(PAINT_MAT, [c[0], c[1], z], [c[0] + r * Math.cos(a0), c[1] + r * Math.sin(a0), z], [c[0] + r * Math.cos(a1), c[1] + r * Math.sin(a1), z], [0, 0], [1, 0], [0, 1], col);
  }
}
// a painted area (filled rectangle in the frame)
function fillST(m, p, s0, t0, s1, t1, col, lift = 0.008) {
  lift = lifted(p, lift);
  const n = Math.max(1, Math.ceil(Math.abs(s1 - s0) / 2));
  for (let i = 0; i < n; i++) {
    const a = s0 + ((s1 - s0) * i) / n; const b = s0 + ((s1 - s0) * (i + 1)) / n;
    const k = Math.max(1, Math.ceil(Math.abs(t1 - t0) / 2));
    for (let j = 0; j < k; j++) {
      const c = t0 + ((t1 - t0) * j) / k; const d = t0 + ((t1 - t0) * (j + 1)) / k;
      const q = [F(p, a, c), F(p, b, c), F(p, b, d), F(p, a, d)].map(([x, y]) => [x, y, p.fieldZ(x, y) + lift]);
      const [q0, q1, q2, q3] = (b - a) * (d - c) > 0 ? q : [q[0], q[3], q[2], q[1]];
      m.quad('smoothConcrete', q0, q1, q2, q3, [0, 0], [1, 0], [1, 1], [0, 1], col);
    }
  }
}
// a world point on the surface, lifted
const onField = (p, s, t, dz = 0) => { const [x, y] = F(p, s, t); return [x, y, p.fieldZ(x, y) + dz]; };
// a post (a cylinder standing on the surface at (s, t))
function post(m, p, s, t, r, h, col, mat = 'metalWhite') {
  const [x, y] = F(p, s, t); const z = p.fieldZ(x, y);
  cylinder(m, mat, x, y, r, z - 0.3, z + h, col, { n: 8 });
}
// a net panel between two (s, t, z) points along its bottom edge, h tall (double-sided material)
function netPanel(m, p, a, b, z0, z1, col = NET, uv = 0.12) {
  const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
  m.quad('netting', [a[0], a[1], z0], [b[0], b[1], z0], [b[0], b[1], z1], [a[0], a[1], z1], [0, z0 / uv], [L / uv, z0 / uv], [L / uv, z1 / uv], [0, z1 / uv], col);
}

// colour=* on a field's surface: named or #rrggbb, toned to read as a painted surface
const NAMED_COLOURS = { red: [0.66, 0.24, 0.18], blue: [0.22, 0.42, 0.68], green: [0.3, 0.5, 0.36], grey: [0.5, 0.5, 0.5], gray: [0.5, 0.5, 0.5],
  black: [0.2, 0.2, 0.22], orange: [0.85, 0.45, 0.2], yellow: [0.85, 0.75, 0.3], purple: [0.4, 0.3, 0.55], brown: [0.5, 0.35, 0.25], white: [0.9, 0.9, 0.88] };
function surfaceColour(v) {
  const c = String(v || '').trim().toLowerCase();
  if (NAMED_COLOURS[c]) return NAMED_COLOURS[c];
  const m = c.match(/^#?([0-9a-f]{6})$/);
  return m ? [0, 2, 4].map((i) => Number.parseInt(m[1].slice(i, i + 2), 16) / 255) : null;
}

// ── Draping ──────────────────────────────────────────────────────────────────

// a convex polygon split by the line n.(x, y) = c: [the part below, the part above]
function splitByLine(poly, n, c) {
  const lo = []; const hi = [];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i]; const b = poly[(i + 1) % poly.length];
    const da = n[0] * a[0] + n[1] * a[1] - c; const db = n[0] * b[0] + n[1] * b[1] - c;
    if (da <= 0) lo.push(a); if (da >= 0) hi.push(a);
    if ((da < 0 && db > 0) || (da > 0 && db < 0)) { const t = da / (da - db); const q = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]; lo.push(q); hi.push(q); }
  }
  return [lo, hi];
}
// cut convex pieces along lines n.(x, y) = c0 + k * step (all of them crossing the pieces)
function cutAlong(pieces, n, c0, step) {
  const out = [];
  for (const poly of pieces) {
    const vals = poly.map((q) => n[0] * q[0] + n[1] * q[1]);
    const k0 = Math.ceil((Math.min(...vals) - c0) / step); const k1 = Math.floor((Math.max(...vals) - c0) / step);
    let rest = poly;
    for (let k = k0; k <= k1 && rest.length >= 3; k++) {
      const [lo, hi] = splitByLine(rest, n, c0 + k * step);
      if (lo.length >= 3) out.push(lo);
      rest = hi;
    }
    if (rest.length >= 3) out.push(rest);
  }
  return out;
}
/**
 * A surface lying on the terrain: the outline (holes allowed) triangulated,
 * cut along the terrain's squares (and any extra lines: mown stripes), each
 * piece fanned from its middle at z(x, y) (the drape: on the ground's own
 * triangles). colOf(x, y) colours a piece by its middle.
 */
function drapedMesh(m, mat, outer, holes, z, colOf, grid, extra = []) {
  const tri = THREE.ShapeUtils.triangulateShape(outer.map(([x, y]) => new THREE.Vector2(x, y)), holes.map((h) => h.map(([x, y]) => new THREE.Vector2(x, y))));
  const all = [...outer, ...holes.flat()];
  const uv = (q) => [q[0] / 4, q[1] / 4];
  for (const [ia, ib, ic] of tri) {
    let pieces = [[all[ia], all[ib], all[ic]]];
    pieces = cutAlong(pieces, [1, 0], grid.ox, grid.sq);
    pieces = cutAlong(pieces, [0, 1], grid.oy, grid.sq);
    for (const e of extra) pieces = cutAlong(pieces, e.n, e.c0, e.step);
    for (const poly of pieces) {
      let a2 = 0; let cx = 0; let cy = 0;
      for (let i = 0; i < poly.length; i++) { const a = poly[i]; const b = poly[(i + 1) % poly.length]; const cr = a[0] * b[1] - b[0] * a[1]; a2 += cr; cx += (a[0] + b[0]) * cr; cy += (a[1] + b[1]) * cr; }
      if (Math.abs(a2) < 1e-6) continue;
      cx /= 3 * a2; cy /= 3 * a2;
      const ccw = a2 > 0;
      const col = colOf(cx, cy);
      const c = [cx, cy, z(cx, cy)];
      for (let i = 0; i < poly.length; i++) {
        const a = poly[ccw ? i : (i + 1) % poly.length]; const b = poly[ccw ? (i + 1) % poly.length : i];
        const A = [a[0], a[1], z(a[0], a[1])]; const B = [b[0], b[1], z(b[0], b[1])];
        m.tri(mat, c, A, B, uv(c), uv(A), uv(B), col);
      }
    }
  }
}

// ── Surfaces ─────────────────────────────────────────────────────────────────

function surfaceMesh(stone, full, p) {
  const [mat, tint] = LOOK[p.surface] || LOOK.grass;
  const rnd = (...k) => hash01(p.seed, ...k);
  const bx = p.box;
  const L = bx.s1 - bx.s0; const W = bx.t1 - bx.t0;
  const rect = p.area / Math.max(1, L * W) > 0.93 && !p.hole;
  let col = tint;
  if (p.surface === 'hard') col = COURT_COLOURS[Math.floor(rnd('court') * COURT_COLOURS.length)][1];
  // a colour tagged (colour=blue: a blue track, a green court)
  const tagged = surfaceColour(p.tags.colour || p.tags['surface:colour']);
  if (tagged) col = tagged;
  const target = p.slab !== null ? stone : full;
  if (p.slab === null && p.drape) {
    // on the terrain's own triangles; grass mown in stripes across the length
    const stripes = (p.surface === 'grass' || p.surface === 'turf') && rect;
    const sw = Math.max(4, L / 20);
    const colOf = stripes ? (x, y) => { const s2 = x * bx.u[0] + y * bx.u[1]; return Math.floor((s2 - bx.s0) / sw) % 2 ? col : col.map((v) => v * 0.86); } : () => col;
    drapedMesh(target, mat, p.ring, p.hole ? [p.hole] : [], p.fieldZ, colOf, p.drape.grid, stripes ? [{ n: bx.u, c0: bx.s0, step: sw }] : []);
  } else if (rect) {
    // a grid in the frame: mown stripes across the length on grass
    const stripes = p.surface === 'grass' || p.surface === 'turf';
    const ns = Math.max(1, Math.round(L / (stripes ? Math.max(4, L / 20) : 4)));
    const nt = Math.max(1, Math.ceil(W / 4));
    for (let i = 0; i < ns; i++) for (let j = 0; j < nt; j++) {
      const s0 = bx.s0 + (L * i) / ns; const s1 = bx.s0 + (L * (i + 1)) / ns; const t0 = bx.t0 + (W * j) / nt; const t1 = bx.t0 + (W * (j + 1)) / nt;
      const c = stripes ? (i % 2 ? col : col.map((v) => v * 0.86)) : col;
      const q = [F(p, s0, t0), F(p, s1, t0), F(p, s1, t1), F(p, s0, t1)].map(([x, y]) => [x, y, p.fieldZ(x, y)]);
      target.quad(mat, q[0], q[1], q[2], q[3], [q[0][0] / 4, q[0][1] / 4], [q[1][0] / 4, q[1][1] / 4], [q[2][0] / 4, q[2][1] / 4], [q[3][0] / 4, q[3][1] / 4], c);
    }
  } else {
    // the outline triangulated, each triangle cut to about 2 m (the ground's heights)
    const holes = p.hole ? [p.hole] : [];
    const tri = THREE.ShapeUtils.triangulateShape(p.ring.map(([x, y]) => new THREE.Vector2(x, y)), holes.map((h) => h.map(([x, y]) => new THREE.Vector2(x, y))));
    const all = [...p.ring, ...holes.flat()];
    for (const [ia, ib, ic] of tri) {
      let [a, b, c] = [all[ia], all[ib], all[ic]];
      if ((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]) < 0) [b, c] = [c, b];
      const e = Math.max(Math.hypot(b[0] - a[0], b[1] - a[1]), Math.hypot(c[0] - b[0], c[1] - b[1]), Math.hypot(a[0] - c[0], a[1] - c[1]));
      const n = Math.max(1, Math.ceil(e / 2.5));
      const P = (i, j) => { const x = a[0] + ((b[0] - a[0]) * i + (c[0] - a[0]) * j) / n; const y = a[1] + ((b[1] - a[1]) * i + (c[1] - a[1]) * j) / n; return [x, y, p.fieldZ(x, y)]; };
      const uv = (q) => [q[0] / 4, q[1] / 4];
      for (let i = 0; i < n; i++) for (let j = 0; j < n - i; j++) {
        const q0 = P(i, j); const q1 = P(i + 1, j); const q2 = P(i, j + 1);
        target.tri(mat, q0, q1, q2, uv(q0), uv(q1), uv(q2), col);
        if (i + j < n - 1) { const q3 = P(i + 1, j + 1); target.tri(mat, q1, q3, q2, uv(q1), uv(q3), uv(q2), col); }
      }
    }
  }
  // a slab's edges down to the ground (round its hole too)
  if (p.slab !== null) {
    const edges = [...p.ring.map((a, i) => [a, p.ring[(i + 1) % p.ring.length]]), ...(p.hole || []).map((a, i, h) => [h[(i + 1) % h.length], a])];
    for (const [a, b] of edges) {
      const L2 = Math.hypot(b[0] - a[0], b[1] - a[1]);
      const k = Math.max(1, Math.ceil(L2 / 2));
      for (let j = 0; j < k; j++) {
        const q0 = [a[0] + ((b[0] - a[0]) * j) / k, a[1] + ((b[1] - a[1]) * j) / k];
        const q1 = [a[0] + ((b[0] - a[0]) * (j + 1)) / k, a[1] + ((b[1] - a[1]) * (j + 1)) / k];
        const g0 = p.ground(...q0) - 0.25; const g1 = p.ground(...q1) - 0.25;
        stone.quad('smoothConcrete', [q0[0], q0[1], g0], [q1[0], q1[1], g1], [q1[0], q1[1], p.slab], [q0[0], q0[1], p.slab], [0, 0], [L2 / k, 0], [L2 / k, 0.4], [0, 0.4], [0.7, 0.7, 0.68]);
      }
    }
  }
  return col;
}

// ── Fittings ─────────────────────────────────────────────────────────────────

// a goal on the line at s (the field to +dir), mouth w wide, h tall, its net d deep
function goal(stone, full, p, s, dir, w, h, d, col = [0.97, 0.97, 0.97]) {
  const tc = (p.box.t0 + p.box.t1) / 2;
  const r = Math.max(0.04, w * 0.008);
  for (const sg of [-1, 1]) post(stone, p, s, tc + (sg * w) / 2, r, h, col);
  bar(stone, 'metalWhite', onField(p, s, tc - w / 2, h), onField(p, s, tc + w / 2, h), r, col);
  // the net: back, sides and roof, falling from the crossbar to the ground behind
  const back = s - dir * d; const topBack = s - dir * d * 0.45;
  const pt = (ss, t, dz) => onField(p, ss, t, dz);
  const A = pt(back, tc - w / 2, 0); const B = pt(back, tc + w / 2, 0);
  const At = pt(topBack, tc - w / 2, h); const Bt = pt(topBack, tc + w / 2, h);
  const nq = (q0, q1, q2, q3) => full.quad('netting', q0, q1, q2, q3, [0, 0], [w / 0.12, 0], [w / 0.12, h / 0.12], [0, h / 0.12], NET);
  nq(A, B, Bt, At);
  nq(pt(s, tc - w / 2, 0), A, At, pt(s, tc - w / 2, h));
  nq(B, pt(s, tc + w / 2, 0), pt(s, tc + w / 2, h), Bt);
  nq(At, Bt, pt(s, tc + w / 2, h), pt(s, tc - w / 2, h));
  // the frame behind
  bar(stone, 'metalWhite', A, At, r * 0.6, col); bar(stone, 'metalWhite', B, Bt, r * 0.6, col);
  bar(stone, 'metalWhite', A, B, r * 0.6, col); bar(stone, 'metalWhite', At, Bt, r * 0.6, col);
}

// American football posts: a gooseneck behind the end line at s (field to +dir)
function footballPosts(stone, p, s, dir) {
  const tc = (p.box.t0 + p.box.t1) / 2;
  const base = s - dir * 1.8;
  post(stone, p, base, tc, 0.17, 3.05, POST_YELLOW);
  box(stone, 'metalWhite', F(p, base, tc), p.box.u, 0.3, 0.3, p.fieldZ(...F(p, base, tc)), p.fieldZ(...F(p, base, tc)) + 1.8, [0.15, 0.2, 0.45]);
  bar(stone, 'metalWhite', onField(p, base, tc, 3.05), onField(p, s, tc, 3.05), 0.11, POST_YELLOW);
  bar(stone, 'metalWhite', onField(p, s, tc - 2.82, 3.05), onField(p, s, tc + 2.82, 3.05), 0.08, POST_YELLOW);
  for (const sg of [-1, 1]) bar(stone, 'metalWhite', onField(p, s, tc + sg * 2.82, 3.05), onField(p, s, tc + sg * 2.82, 12), 0.06, POST_YELLOW);
}
// rugby H posts on the try line at s
function rugbyPosts(stone, p, s) {
  const tc = (p.box.t0 + p.box.t1) / 2;
  for (const sg of [-1, 1]) {
    post(stone, p, s, tc + sg * 2.8, 0.09, 11, [0.97, 0.97, 0.97]);
    const [x, y] = F(p, s, tc + sg * 2.8); const z = p.fieldZ(x, y);
    cylinder(stone, 'smoothConcrete', x, y, 0.3, z, z + 1.8, [0.2, 0.3, 0.6], { n: 10 });
  }
  bar(stone, 'metalWhite', onField(p, s, tc - 2.8, 3), onField(p, s, tc + 2.8, 3), 0.07, [0.97, 0.97, 0.97]);
}
// a basketball hoop facing +dir, its backboard over s (the baseline + 1.2 m)
function hoop(stone, full, p, sBoard, dir) {
  const tc = (p.box.t0 + p.box.t1) / 2;
  // (the pole behind the baseline, the board 1.2 m inside it on a long arm)
  const sPole = sBoard - dir * 2.1;
  const [px, py] = F(p, sPole, tc); const z = p.fieldZ(px, py);
  box(stone, 'metalWhite', [px, py], p.box.u, 0.09, 0.09, z - 0.3, z + 3.45, [0.25, 0.27, 0.3]);
  bar(stone, 'metalWhite', onField(p, sPole, tc, 3.35), onField(p, sBoard - dir * 0.05, tc, 3.35), 0.06, [0.25, 0.27, 0.3]);
  // the board
  const bc = F(p, sBoard, tc);
  box(stone, 'metalWhite', bc, [-p.box.u[1], p.box.u[0]], 0.9, 0.03, z + 2.9, z + 3.95, [0.95, 0.95, 0.95]);
  // the target square and border on the board's face
  const face = F(p, sBoard + dir * 0.035, tc);
  const v = [-p.box.u[1], p.box.u[0]];
  const sq = (t0, t1, z0, z1) => {
    const a = [face[0] + v[0] * t0, face[1] + v[1] * t0]; const b = [face[0] + v[0] * t1, face[1] + v[1] * t1];
    const q = [[a[0], a[1], z0], [b[0], b[1], z0], [b[0], b[1], z1], [a[0], a[1], z1]];
    const [q0, q1, q2, q3] = dir > 0 ? q : [q[1], q[0], q[3], q[2]];
    full.quad('smoothConcrete', q0, q1, q2, q3, [0, 0], [1, 0], [1, 1], [0, 1], [0.85, 0.15, 0.1]);
  };
  sq(-0.3, -0.27, z + 3.05, z + 3.5); sq(0.27, 0.3, z + 3.05, z + 3.5); sq(-0.3, 0.3, z + 3.47, z + 3.5); sq(-0.3, 0.3, z + 3.05, z + 3.08);
  // the rim and its net
  const rc = F(p, sBoard + dir * 0.38, tc);
  const ring = Array.from({ length: 12 }, (_, i) => [rc[0] + 0.23 * Math.cos((Math.PI * i) / 6), rc[1] + 0.23 * Math.sin((Math.PI * i) / 6), z + 3.05]);
  for (let i = 0; i < 12; i++) bar(full, 'metalWhite', ring[i], ring[(i + 1) % 12], 0.012, [0.95, 0.38, 0.08]);
  bar(full, 'metalWhite', onField(p, sBoard + dir * 0.03, tc, 3.05), onField(p, sBoard + dir * 0.16, tc, 3.05), 0.02, [0.95, 0.38, 0.08]);
  lathe(full, 'netting', rc[0], rc[1], [[0.23, z + 3.05], [0.17, z + 2.62]], NET, { n: 12, uvM: 0.08 });
}
// a court net across the middle (posts beyond the sidelines, top at hTop)
function courtNet(stone, full, p, halfW, hPost, hMid, depth = 0.9, col = DARK_NET) {
  const sm = (p.box.s0 + p.box.s1) / 2; const tc = (p.box.t0 + p.box.t1) / 2;
  for (const sg of [-1, 1]) post(stone, p, sm, tc + sg * halfW, 0.04, hPost, [0.2, 0.32, 0.25]);
  const a = F(p, sm, tc - halfW); const b = F(p, sm, tc + halfW); const c = F(p, sm, tc);
  const z = p.fieldZ(...c);
  netPanel(full, p, a, c, z + hMid - depth, z + hMid, col);
  netPanel(full, p, c, b, z + hMid - depth, z + hMid, col);
  // the white band along its top
  bar(full, 'metalWhite', [a[0], a[1], z + hPost - 0.03], [c[0], c[1], z + hMid - 0.03], 0.03, [0.97, 0.97, 0.97]);
  bar(full, 'metalWhite', [c[0], c[1], z + hMid - 0.03], [b[0], b[1], z + hPost - 0.03], 0.03, [0.97, 0.97, 0.97]);
}
// a chain-link fence along the ring's edges where `edges` says, h tall
function fence(stone, full, p, h, edges = null) {
  const ring = p.ring;
  for (let i = 0; i < ring.length; i++) {
    if (edges && !edges[i]) continue;
    const a = ring[i]; const b = ring[(i + 1) % ring.length];
    const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const n = Math.max(1, Math.ceil(L / 3));
    for (let k = 0; k <= n; k++) {
      const q = [a[0] + ((b[0] - a[0]) * k) / n, a[1] + ((b[1] - a[1]) * k) / n];
      const g = p.ground(...q);
      if (!inNeighbour(p, q[0], q[1])) cylinder(stone, 'metalWhite', q[0], q[1], 0.04, g - 0.3, g + h, STEEL, { n: 6 });
      if (k < n) {
        const q2 = [a[0] + ((b[0] - a[0]) * (k + 1)) / n, a[1] + ((b[1] - a[1]) * (k + 1)) / n];
        if (inNeighbour(p, (q[0] + q2[0]) / 2, (q[1] + q2[1]) / 2)) continue;
        const g2 = p.ground(...q2);
        const seg = Math.hypot(q2[0] - q[0], q2[1] - q[1]);
        full.quad('chainlink', [q[0], q[1], g], [q2[0], q2[1], g2], [q2[0], q2[1], g2 + h], [q[0], q[1], g + h], [0, 0], [seg / 1.5, 0], [seg / 1.5, h / 1.5], [0, h / 1.5], STEEL);
        bar(stone, 'metalWhite', [q[0], q[1], g + h], [q2[0], q2[1], g2 + h], 0.025, STEEL);
      }
    }
  }
}

// ── Layouts ──────────────────────────────────────────────────────────────────

function soccer(stone, full, p, { goalW = 7.32, goalH = 2.44, std = [105, 68], small = false } = {}) {
  const { s0, s1, t0, t1 } = p.box; const L = s1 - s0; const W = t1 - t0;
  const sx = Math.min(1.1, L / std[0]); const sy = Math.min(1.1, W / std[1]); const k = Math.min(sx, sy);
  const sm = (s0 + s1) / 2; const tc = (t0 + t1) / 2;
  const m = 1;   // (the lines a metre in from the mapped edge: the run-off)
  rectST(full, p, s0 + m, t0 + m, s1 - m, t1 - m, 0.12);
  lineST(full, p, sm, t0 + m, sm, t1 - m, 0.12);
  arcST(full, p, sm, tc, 9.15 * k, 0, 2 * Math.PI, 0.12);
  spotST(full, p, sm, tc);
  for (const [e, dir] of [[s0 + m, 1], [s1 - m, -1]]) {
    const pa = 16.5 * sx; const pw = Math.min(W - 2 * m, 40.32 * sy) / 2;
    lineST(full, p, e, tc - pw, e + dir * pa, tc - pw, 0.12); lineST(full, p, e + dir * pa, tc - pw, e + dir * pa, tc + pw, 0.12); lineST(full, p, e + dir * pa, tc + pw, e, tc + pw, 0.12);
    const ga = 5.5 * sx; const gw = Math.min(pw, 9.16 * sy);
    lineST(full, p, e, tc - gw, e + dir * ga, tc - gw, 0.12); lineST(full, p, e + dir * ga, tc - gw, e + dir * ga, tc + gw, 0.12); lineST(full, p, e + dir * ga, tc + gw, e, tc + gw, 0.12);
    spotST(full, p, e + dir * 11 * sx, tc);
    // the penalty arc outside the box
    const r = 9.15 * k; const dx = pa - 11 * sx;
    if (r > dx) { const a = Math.acos(dx / r); arcST(full, p, e + dir * 11 * sx, tc, r, dir > 0 ? -a : Math.PI - a, dir > 0 ? a : Math.PI + a, 0.12); }
    for (const tt of [t0 + m, t1 - m]) arcST(full, p, e, tt, k * 1, dir > 0 ? (tt < tc ? 0 : -Math.PI / 2) : (tt < tc ? Math.PI / 2 : Math.PI), dir > 0 ? (tt < tc ? Math.PI / 2 : 0) : (tt < tc ? Math.PI : 1.5 * Math.PI), 0.12);
    goal(stone, full, p, e, dir, Math.min(goalW, W * 0.3), goalH * (small ? 0.82 : 1), small ? 1 : 2);
  }
  // corner flags
  for (const ss of [s0 + m, s1 - m]) for (const tt of [t0 + m, t1 - m]) {
    post(stone, p, ss, tt, 0.02, 1.5, [0.95, 0.95, 0.95]);
    const top = onField(p, ss, tt, 1.5); const f2 = onField(p, ss, tt + (tt < tc ? 0.4 : -0.4), 1.3);
    full.tri('smoothConcrete', top, onField(p, ss, tt, 1.15), f2, [0, 0], [1, 0], [0, 1], [1, 0.85, 0.1]);
    full.tri('smoothConcrete', top, f2, onField(p, ss, tt, 1.15), [0, 0], [1, 0], [0, 1], [1, 0.85, 0.1]);
  }
}

function americanFootball(stone, full, p) {
  const { s0, s1, t0, t1 } = p.box; const L = s1 - s0; const W = t1 - t0;
  const yd = Math.min(1, (L - 2) / 120) * 0.9144;            // a yard, scaled to the mapped length
  const sm = (s0 + s1) / 2; const tc = (t0 + t1) / 2;
  const half = 60 * yd; const hw = Math.min(W - 2, 53.33 * yd) / 2;
  const a = sm - half; const b = sm + half;
  // end zones tinted, the lines round the field
  const zoneCol = [0.2, 0.32, 0.62];
  fillST(full, p, a, tc - hw, a + 10 * yd, tc + hw, zoneCol);
  fillST(full, p, b - 10 * yd, tc - hw, b, tc + hw, zoneCol);
  rectST(full, p, a, tc - hw, b, tc + hw, 0.15);
  for (let y = 10; y <= 110; y += 5) {
    const s = a + y * yd;
    lineST(full, p, s, tc - hw, s, tc + hw, y === 60 ? 0.15 : 0.1);
  }
  // hash marks every yard (high-school spacing) and on the sidelines
  for (let y = 11; y < 110; y++) {
    if (y % 5 === 0) continue;
    const s = a + y * yd;
    for (const tt of [tc - hw + 0.3, tc - 6.1 * (yd / 0.9144), tc + 6.1 * (yd / 0.9144), tc + hw - 0.3]) lineST(full, p, s, tt - 0.3, s, tt + 0.3, 0.1);
  }
  footballPosts(stone, p, a, 1);
  footballPosts(stone, p, b, -1);
}

function rugby(stone, full, p) {
  const { s0, s1, t0, t1 } = p.box; const L = s1 - s0; const W = t1 - t0;
  const sx = Math.min(1, (L - 2) / 120);
  const sm = (s0 + s1) / 2; const tc = (t0 + t1) / 2; const hw = (W - 2) / 2;
  const tryA = sm - 50 * sx; const tryB = sm + 50 * sx;
  rectST(full, p, sm - 60 * sx, tc - hw, sm + 60 * sx, tc + hw, 0.12);
  for (const s of [tryA, tryB, sm - 28 * sx, sm + 28 * sx, sm]) lineST(full, p, s, tc - hw, s, tc + hw, 0.12);
  for (const s of [sm - 10 * sx, sm + 10 * sx]) dashedST(full, p, s, tc - hw, s, tc + hw, 1.5, 1.5);
  for (const tt of [tc - hw + 5, tc + hw - 5, tc - hw + 15, tc + hw - 15]) dashedST(full, p, tryA + 2, tt, tryB - 2, tt, 1, 4);
  rugbyPosts(stone, p, tryA);
  rugbyPosts(stone, p, tryB);
}

function fieldHockey(stone, full, p) {
  const { s0, s1, t0, t1 } = p.box; const L = s1 - s0; const W = t1 - t0;
  const sx = Math.min(1, (L - 2) / 91.4); const sy = Math.min(1, (W - 2) / 55); const k = Math.min(sx, sy);
  const sm = (s0 + s1) / 2; const tc = (t0 + t1) / 2;
  const a = sm - 45.7 * sx; const b = sm + 45.7 * sx; const hw = 27.5 * sy;
  rectST(full, p, a, tc - hw, b, tc + hw);
  for (const s of [sm, sm - 22.9 * sx, sm + 22.9 * sx]) lineST(full, p, s, tc - hw, s, tc + hw);
  for (const [e, dir] of [[a, 1], [b, -1]]) {
    const r = 14.63 * k;
    arcST(full, p, e, tc - 1.83, r, dir > 0 ? -Math.PI / 2 : Math.PI, dir > 0 ? 0 : 1.5 * Math.PI);
    arcST(full, p, e, tc + 1.83, r, dir > 0 ? 0 : Math.PI / 2, dir > 0 ? Math.PI / 2 : Math.PI);
    lineST(full, p, e + dir * r, tc - 1.83, e + dir * r, tc + 1.83);
    spotST(full, p, e + dir * 6.4 * sx, tc);
    goal(stone, full, p, e, dir, 3.66, 2.14, 1.2);
  }
}

function cricket(stone, full, p) {
  const { s0, s1, t0, t1 } = p.box; const sm = (s0 + s1) / 2; const tc = (t0 + t1) / 2;
  // the pitch: a strip of rolled clay with its creases and stumps
  fillST(full, p, sm - 10.06, tc - 1.52, sm + 10.06, tc + 1.52, [0.78, 0.68, 0.48], 0.006);
  for (const dir of [-1, 1]) {
    const e = sm + dir * 10.06;
    lineST(full, p, e, tc - 1.32, e, tc + 1.32, 0.05);
    lineST(full, p, e - dir * 1.22, tc - 1.83, e - dir * 1.22, tc + 1.83, 0.05);
    for (const tt of [-0.11, 0, 0.11]) post(stone, p, e, tc + tt, 0.018, 0.71, [0.9, 0.85, 0.7], 'metalWhite');
  }
  // the boundary rope round the oval, a few metres in
  const ring = p.ring;
  const cx = ring.reduce((a, q) => a + q[0], 0) / ring.length; const cy = ring.reduce((a, q) => a + q[1], 0) / ring.length;
  for (let i = 0; i < ring.length; i++) {
    const q0 = ring[i]; const q1 = ring[(i + 1) % ring.length];
    const pull = (q) => { const d = Math.hypot(q[0] - cx, q[1] - cy) || 1; const f = Math.max(0, (d - 4) / d); return [cx + (q[0] - cx) * f, cy + (q[1] - cy) * f]; };
    strip(full, PAINT_MAT, p, pull(q0), pull(q1), 0.1, [0.95, 0.95, 0.95], 0.05);
  }
}

// Home plate: where the outline's two foul lines meet. They are its two
// longest straight runs (edges turning under 12 degrees each, 20 in all; the
// outfield's curve turns far more), at 60-120 degrees to each other; home is
// where their lines cross (a rounded corner of a few short edges between
// them is no matter). The field opens toward the outline's middle. (The
// sharpest corner instead: a foul pole, the field drawn backward.)
export function homePlate(p) {
  const r = p.ring; const n = r.length;
  const cx = r.reduce((a, q) => a + q[0], 0) / n; const cy = r.reduce((a, q) => a + q[1], 0) / n;
  const turn = (i) => {
    const a = r[(i - 1 + n) % n]; const b = r[i]; const c = r[(i + 1) % n];
    const u = [b[0] - a[0], b[1] - a[1]]; const v = [c[0] - b[0], c[1] - b[1]];
    return Math.abs(Math.atan2(u[0] * v[1] - u[1] * v[0], u[0] * v[0] + u[1] * v[1]));
  };
  // straight runs: from each corner, edges while they keep straight
  const runs = [];
  const sharp = [];
  for (let i = 0; i < n; i++) if (turn(i) >= (12 * Math.PI) / 180) sharp.push(i);
  if (sharp.length >= 2) {
    for (let k = 0; k < sharp.length; k++) {
      const i0 = sharp[k]; const i1 = sharp[(k + 1) % sharp.length];
      let total = 0; let len = 0;
      for (let i = i0; i !== i1; i = (i + 1) % n) {
        const q = r[i]; const q2 = r[(i + 1) % n];
        len += Math.hypot(q2[0] - q[0], q2[1] - q[1]);
        if (i !== i0) total += turn(i);
      }
      if (total < (20 * Math.PI) / 180) runs.push({ a: r[i0], b: r[i1], len });
    }
  }
  runs.sort((x, y) => y.len - x.len);
  for (let i = 0; i < Math.min(4, runs.length); i++) for (let j = i + 1; j < Math.min(4, runs.length); j++) {
    const A = runs[i]; const B = runs[j];
    const u = [A.b[0] - A.a[0], A.b[1] - A.a[1]]; const v = [B.b[0] - B.a[0], B.b[1] - B.a[1]];
    const den = u[0] * v[1] - u[1] * v[0];
    const ang = Math.acos(Math.abs(u[0] * v[0] + u[1] * v[1]) / (Math.hypot(...u) * Math.hypot(...v))) * 180 / Math.PI;
    if (Math.abs(den) < 1e-9 || ang < 60 || ang > 120 || B.len < 0.35 * A.len) continue;
    const t = ((B.a[0] - A.a[0]) * v[1] - (B.a[1] - A.a[1]) * v[0]) / den;
    const h = [A.a[0] + u[0] * t, A.a[1] + u[1] * t];
    // (the crossing near the outline: a corner of it, not far outside)
    const near = Math.min(...r.map((q) => Math.hypot(q[0] - h[0], q[1] - h[1])));
    if (near > 0.15 * Math.sqrt(p.area)) continue;
    const L = Math.hypot(cx - h[0], cy - h[1]) || 1;
    return { home: h, dir: [(cx - h[0]) / L, (cy - h[1]) / L], half: (ang * Math.PI) / 360 };   // (half the angle between the foul lines)
  }
  // else: the square-ish corner farthest from the middle
  let best = null;
  for (let i = 0; i < n; i++) {
    const a = r[(i - 1 + n) % n]; const b = r[i]; const c = r[(i + 1) % n];
    const u = [a[0] - b[0], a[1] - b[1]]; const v = [c[0] - b[0], c[1] - b[1]];
    const ang = Math.acos(Math.max(-1, Math.min(1, (u[0] * v[0] + u[1] * v[1]) / ((Math.hypot(...u) * Math.hypot(...v)) || 1)))) * 180 / Math.PI;
    const d = Math.hypot(b[0] - cx, b[1] - cy);
    const score = d - Math.abs(ang - 90) * 0.4;
    if (ang < 125 && (!best || score > best.score)) best = { score, p: b };
  }
  const h = best ? best.p : r[0];
  const L = Math.hypot(cx - h[0], cy - h[1]) || 1;
  return { home: h, dir: [(cx - h[0]) / L, (cy - h[1]) / L], half: Math.PI / 4 };
}

function baseball(stone, full, p, softball) {
  // a long thin outline (a bullpen, a warning track): no room for a diamond
  if ((p.box.s1 - p.box.s0) > 2.2 * (p.box.t1 - p.box.t0)) return;
  const hp = homePlate(p);
  let home = hp.home; const { dir } = hp;
  // the distance to the outfield edge along centre field sets baseball or softball
  let reach = 10;
  while (reach < 200 && inRing(home[0] + dir[0] * reach, home[1] + dir[1] * reach, p.ring)) reach += 2;
  // the size by how far the outfield reaches: Little League (fences ~60 m),
  // softball, baseball (90-ft bases from 85 m)
  const little = !softball && reach < 70;
  const soft = softball || reach < 85;
  const base = soft ? 18.29 : 27.43; const mound = little ? 14.02 : soft ? 13.1 : 18.44; const skin = little ? 15.24 : soft ? 18.3 : 29;
  // home plate in from the outline's corner, far enough that the home circle
  // and the infield's arc fit inside (an outline drawn along the foul lines
  // put first and third base on its edges, the infield hanging out of it)
  const sinH = Math.sin(hp.half || Math.PI / 4);
  const inset = Math.max(3.96 + 1, skin - mound * sinH + 1) / Math.max(0.3, sinH);
  home = [home[0] + dir[0] * inset, home[1] + dir[1] * inset];
  // (the dirt kept within a metre past the outline, never in a neighbour)
  const room = insetPts(p.ring, -1);
  const side = [-dir[1], dir[0]];
  const at = (f, sd) => [home[0] + dir[0] * f + side[0] * sd, home[1] + dir[1] * f + side[1] * sd];
  const fz = (q) => p.fieldZ(...q) + lifted(p, 0) ;
  const dirtCol = [0.82, 0.55, 0.38];
  // the infield skin: a fan round the mound, the grass square inside the base paths
  // (in rings 2 m deep and slices 1.5 m wide: the pieces follow the ground)
  const fan = (cxf, r, a0, a1, _z0, col, lift) => {
    const c = at(cxf, 0);
    const pnt = (rr, b) => [c[0] + (dir[0] * Math.cos(b) - dir[1] * Math.sin(b)) * rr, c[1] + (dir[1] * Math.cos(b) + dir[0] * Math.sin(b)) * rr];
    const nr = Math.max(1, Math.ceil(r / (p.drape ? 1 : 2)));
    // (the same slices in every ring: rings sliced differently met at
    // T-junctions, hairline cracks with the ground showing through)
    const n = Math.max(6, Math.ceil(((a1 - a0) * r) / (p.drape ? 1 : 1.5)));
    for (let k = 0; k < nr; k++) {
      const ra = (r * k) / nr; const rb = (r * (k + 1)) / nr;
      for (let i = 0; i < n; i++) {
        const b0 = a0 + ((a1 - a0) * i) / n; const b1 = a0 + ((a1 - a0) * (i + 1)) / n;
        const q = [pnt(ra, b0), pnt(rb, b0), pnt(rb, b1), pnt(ra, b1)].map((xy) => [xy[0], xy[1], fz(xy) + lift]);
        // (within a few metres of the field, never in a neighbour: on a small field the skin's arc ran past its edge)
        const mid = pnt((ra + rb) / 2, (b0 + b1) / 2);
        if (!inRing(mid[0], mid[1], room) || inNeighbour(p, mid[0], mid[1])) continue;
        full.quad('dirt', q[0], q[1], q[2], q[3], [q[0][0] / 4, q[0][1] / 4], [q[1][0] / 4, q[1][1] / 4], [q[2][0] / 4, q[2][1] / 4], [q[3][0] / 4, q[3][1] / 4], col);
      }
    }
  };
  // (the skin's arc round the mound from foul line to foul line, about 110 degrees each way)
  fan(mound, skin, -1.92, 1.92, 0, dirtCol, 0.006);
  // the base paths from home to first and third: dirt strips along the base
  // lines (the infield's arc lies round the mound; without these the grass
  // ran from home to the bases)
  const d = base / Math.SQRT2;
  for (const sg of [-1, 1]) {
    const b0 = at(0, 0); const b1 = at(d, sg * d);
    const L = Math.hypot(b1[0] - b0[0], b1[1] - b0[1]);
    const uB = [(b1[0] - b0[0]) / L, (b1[1] - b0[1]) / L];
    // (out of the field by 0.9 m, in under the grass diamond's edge)
    const nIn = [dir[0] - uB[0] * (dir[0] * uB[0] + dir[1] * uB[1]), dir[1] - uB[1] * (dir[0] * uB[0] + dir[1] * uB[1])];
    const nl = Math.hypot(...nIn) || 1; nIn[0] /= nl; nIn[1] /= nl;
    const k = Math.max(1, Math.ceil((L + 1) / (p.drape ? 1 : 2)));
    for (let i = 0; i < k; i++) {
      const sA = -0.5 + ((L + 1) * i) / k; const sB = -0.5 + ((L + 1) * (i + 1)) / k;
      const P = (sAl, off) => { const xy = [b0[0] + uB[0] * sAl + nIn[0] * off, b0[1] + uB[1] * sAl + nIn[1] * off]; return [xy[0], xy[1], fz(xy) + 0.006]; };
      const q = [P(sA, -0.9), P(sB, -0.9), P(sB, 1.4), P(sA, 1.4)];
      const ccw = (q[1][0] - q[0][0]) * (q[2][1] - q[0][1]) - (q[1][1] - q[0][1]) * (q[2][0] - q[0][0]) > 0;
      const [qa, qb, qc, qd] = ccw ? q : [q[0], q[3], q[2], q[1]];
      full.quad('dirt', qa, qb, qc, qd, [qa[0] / 4, qa[1] / 4], [qb[0] / 4, qb[1] / 4], [qc[0] / 4, qc[1] / 4], [qd[0] / 4, qd[1] / 4], dirtCol);
    }
  }
  // the grass inside the diamond over it, on a grid following the ground
  const corner = [at(1.5, 0), at(d, -d + 1.5), at(2 * d - 1.5, 0), at(d, d - 1.5)];
  const ng = Math.max(1, Math.ceil(base / (p.drape ? 1 : 2)));
  const lerp2 = (a, b, f) => [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f];
  for (let i = 0; i < ng; i++) for (let j = 0; j < ng; j++) {
    const P = (u, v) => { const xy = lerp2(lerp2(corner[0], corner[1], u), lerp2(corner[3], corner[2], u), v); return [xy[0], xy[1], fz(xy) + 0.02]; };
    const q = [P(i / ng, j / ng), P((i + 1) / ng, j / ng), P((i + 1) / ng, (j + 1) / ng), P(i / ng, (j + 1) / ng)];
    full.quad('turf', q[0], q[1], q[2], q[3], [q[0][0] / 4, q[0][1] / 4], [q[1][0] / 4, q[1][1] / 4], [q[2][0] / 4, q[2][1] / 4], [q[3][0] / 4, q[3][1] / 4], LOOK.grass[1]);
  }
  // the mound, home's circle, the bases, the plate
  fan(mound, 2.74, -Math.PI, Math.PI, 0, dirtCol, 0.034);
  fan(0, 3.96, -Math.PI, Math.PI, 0, dirtCol, 0.034);
  const pad = (f, sd, w, col, lift = 0.02) => {
    const c = at(f, sd); const q = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([a, b]) => { const x = c[0] + (dir[0] * a - dir[1] * b) * w; const y = c[1] + (dir[1] * a + dir[0] * b) * w; return [x, y, fz([x, y]) + lift]; });
    full.quad('smoothConcrete', q[0], q[1], q[2], q[3], [0, 0], [1, 0], [1, 1], [0, 1], col);
  };
  // the bases: low cushions standing on the dirt (a flat tile hovered over its shadow)
  for (const [f, sd] of [[d, -d], [2 * d, 0], [d, d]]) {
    const c = at(f, sd); const g0 = p.fieldZ(...c);
    box(stone, 'smoothConcrete', c, [(dir[0] - dir[1]) * Math.SQRT1_2, (dir[1] + dir[0]) * Math.SQRT1_2], 0.19, 0.19, g0 - 0.02, g0 + 0.08, PAINT);
  }
  pad(0, 0, 0.22, PAINT, 0.04);
  pad(mound, 0, 0.3, PAINT, 0.042);
  // foul lines to the outfield's edge, the batter's boxes
  for (const sg of [-1, 1]) {
    let far = 5; const u = [dir[0] * Math.SQRT1_2 - sg * dir[1] * Math.SQRT1_2, dir[1] * Math.SQRT1_2 + sg * dir[0] * Math.SQRT1_2];
    while (far < 160 && inRing(home[0] + u[0] * (far + 1), home[1] + u[1] * (far + 1), p.ring)) far += 1;
    strip(full, PAINT_MAT, p, home, [home[0] + u[0] * far, home[1] + u[1] * far], 0.08, PAINT, 0.03);
    const bc = at(0.3, sg * 0.95);
    for (const [a, b] of [[[-0.9, -0.6], [0.9, -0.6]], [[0.9, -0.6], [0.9, 0.6]], [[0.9, 0.6], [-0.9, 0.6]], [[-0.9, 0.6], [-0.9, -0.6]]]) {
      const P = (q) => [bc[0] + dir[0] * q[0] + side[0] * q[1], bc[1] + dir[1] * q[0] + side[1] * q[1]];
      strip(full, PAINT_MAT, p, P(a), P(b), 0.06, PAINT, 0.03);
    }
    // a dugout beside each foul line, in foul territory: along the line, a few metres out from it
    const nOut = [-u[1] * sg, u[0] * sg];      // (away from fair territory: u is the centre line turned by sg * 45 degrees)
    const along = soft ? 11 : 16; const off = soft ? 6.5 : 8.5;
    const bpos = [home[0] + u[0] * along + nOut[0] * off, home[1] + u[1] * along + nOut[1] * off];
    const g = p.ground(...bpos);
    const foot = [-6.2, 6.2].flatMap((e) => [-1.5, 1.5].map((w) => [bpos[0] + u[0] * e + nOut[0] * w, bpos[1] + u[1] * e + nOut[1] * w]));
    // (only where there is room: the outline's edge, or a neighbour's court)
    if (foot.every((q) => inRing(q[0], q[1], insetPts(p.ring, -2)) && !inNeighbour(p, q[0], q[1]))) {
      box(stone, 'blockwall', bpos, u, 6, 1.2, g - 0.2, g + 0.9, [0.85, 0.85, 0.82]);
      box(stone, 'metalWhite', bpos, u, 6.2, 1.5, g + 2.3, g + 2.4, [0.3, 0.33, 0.36]);
      for (const e of [-6, 6]) cylinder(stone, 'metalWhite', bpos[0] + u[0] * e + nOut[0] * 1.3, bpos[1] + u[1] * e + nOut[1] * 1.3, 0.05, g, g + 2.35, STEEL, { n: 6 });
    }
  }
  // the backstop behind home: a curved chain-link screen
  const back = little ? 6 : 7; const hB = soft ? 4 : 6;
  const pts = Array.from({ length: 9 }, (_, i) => { const a = Math.PI + (i - 4) * (Math.PI / 10); return [home[0] + (dir[0] * Math.cos(a) - dir[1] * Math.sin(a)) * back, home[1] + (dir[1] * Math.cos(a) + dir[0] * Math.sin(a)) * back]; });
  for (let i = 0; i < pts.length; i++) {
    const q = pts[i]; const g = p.ground(...q);
    if (inNeighbour(p, q[0], q[1])) continue;
    cylinder(stone, 'metalWhite', q[0], q[1], 0.05, g - 0.3, g + hB, STEEL, { n: 6 });
    if (i + 1 < pts.length) {
      const q2 = pts[i + 1]; const g2 = p.ground(...q2); const L = Math.hypot(q2[0] - q[0], q2[1] - q[1]);
      if (inNeighbour(p, q2[0], q2[1])) continue;
      full.quad('chainlink', [q[0], q[1], g], [q2[0], q2[1], g2], [q2[0], q2[1], g2 + hB], [q[0], q[1], g + hB], [0, 0], [L / 1.5, 0], [L / 1.5, hB / 1.5], [0, hB / 1.5], STEEL);
      bar(stone, 'metalWhite', [q[0], q[1], g + hB], [q2[0], q2[1], g2 + hB], 0.03, STEEL);
    }
  }
  // the outfield fence: the outline's edges well beyond the infield
  // (the arc only: within 40 degrees of centre field; not down the foul lines)
  const edges = p.ring.map((a, i) => {
    const b = p.ring[(i + 1) % p.ring.length]; const m2 = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    const v = [m2[0] - home[0], m2[1] - home[1]]; const d = Math.hypot(...v) || 1;
    return d > base * 1.9 && (v[0] * dir[0] + v[1] * dir[1]) / d > Math.cos((40 * Math.PI) / 180);
  });
  fence(stone, full, p, soft ? 1.5 : 2.4, edges);
}

function basketball(stone, full, p) {
  const { s0, s1, t0, t1 } = p.box; const L = s1 - s0; const W = t1 - t0;
  const sm = (s0 + s1) / 2; const tc = (t0 + t1) / 2;
  const rnd = (...k) => hash01(p.seed, ...k);
  const keyCol = COURT_COLOURS[Math.floor(rnd('key') * COURT_COLOURS.length)][0];
  const halfCourt = L < 20;
  const cl = Math.min(28, L - 1.5); const cw = Math.min(15, W - 1);
  const a = halfCourt ? s0 + 0.8 : sm - cl / 2; const b = halfCourt ? Math.min(s1 - 0.5, a + Math.min(14, L - 1.3)) : sm + cl / 2;
  const hw = cw / 2;
  rectST(full, p, a, tc - hw, b, tc + hw);
  const ends = halfCourt ? [[a, 1]] : [[a, 1], [b, -1]];
  if (!halfCourt) { lineST(full, p, sm, tc - hw, sm, tc + hw); arcST(full, p, sm, tc, 1.8, 0, 2 * Math.PI); }
  const k = Math.min(1, cw / 15);
  for (const [e, dir] of ends) {
    const kl = 5.8 * k; const kw = 2.45 * k;
    fillST(full, p, e, tc - kw, e + dir * kl, tc + kw, keyCol);
    rectST(full, p, e, tc - kw, e + dir * kl, tc + kw);
    arcST(full, p, e + dir * kl, tc, 1.8 * k, dir > 0 ? -Math.PI / 2 : Math.PI / 2, dir > 0 ? Math.PI / 2 : 1.5 * Math.PI);
    // the three-point line: straight in the corners, then the arc
    const r3 = 6.75 * k; const hoopS = e + dir * 1.575 * k; const tCorner = Math.min(hw - 0.3, 6.6 * k);
    const dsC = Math.sqrt(Math.max(0, r3 * r3 - tCorner * tCorner));
    for (const sg of [-1, 1]) lineST(full, p, e, tc + sg * tCorner, hoopS + dir * dsC, tc + sg * tCorner);
    const aC = Math.atan2(tCorner, dsC);
    arcST(full, p, hoopS, tc, r3, dir > 0 ? -aC : Math.PI - aC, dir > 0 ? aC : Math.PI + aC);
    hoop(stone, full, p, e + dir * 1.2 * k, dir);
  }
}

function tennis(stone, full, p, kind) {
  const { s0, s1, t0, t1 } = p.box; const L = s1 - s0; const W = t1 - t0;
  const sm = (s0 + s1) / 2; const tc = (t0 + t1) / 2;
  const dims = kind === 'pickleball' ? { l: 13.41, w: 6.1, sw: 6.1, svc: 2.13, net: [0.91, 0.86] } : kind === 'padel' ? { l: 20, w: 10, sw: 10, svc: 6.95, net: [0.92, 0.88] }
    : { l: 23.77, w: 10.97, sw: 8.23, svc: 6.4, net: [1.07, 0.914] };
  const kx = Math.min(1, (L - 1) / dims.l); const ky = Math.min(1, (W - 1) / dims.w);
  const hl = (dims.l * kx) / 2; const hw = (dims.w * ky) / 2; const hs = (dims.sw * ky) / 2;
  // the court itself in the darker colour over the run-off
  if (p.surface === 'hard') {
    const rnd = (...k) => hash01(p.seed, ...k);
    fillST(full, p, sm - hl, tc - hw, sm + hl, tc + hw, COURT_COLOURS[Math.floor(rnd('court') * COURT_COLOURS.length)][0], 0.006);
  }
  const lw = 0.05;
  rectST(full, p, sm - hl, tc - hw, sm + hl, tc + hw, lw);
  if (hs < hw - 0.1) { lineST(full, p, sm - hl, tc - hs, sm + hl, tc - hs, lw); lineST(full, p, sm - hl, tc + hs, sm + hl, tc + hs, lw); }
  const sv = dims.svc * kx;
  if (kind === 'pickleball') {
    for (const sg of [-1, 1]) lineST(full, p, sm + sg * sv, tc - hw, sm + sg * sv, tc + hw, lw);
    for (const sg of [-1, 1]) lineST(full, p, sm + sg * sv, tc, sm + sg * hl, tc, lw);
  } else {
    for (const sg of [-1, 1]) lineST(full, p, sm + sg * sv, tc - hs, sm + sg * sv, tc + hs, lw);
    lineST(full, p, sm - sv, tc, sm + sv, tc, lw);
    for (const sg of [-1, 1]) lineST(full, p, sm + sg * hl, tc, sm + sg * (hl - 0.1), tc, lw);
  }
  courtNet(stone, full, p, hw + (kind === 'tennis' ? 0.914 : 0.3), dims.net[0], dims.net[1]);
  // the fence round the court (none between courts side by side)
  const clay = p.surface === 'clay';
  fence(stone, full, p, kind === 'padel' ? 3 : clay ? 3 : 3, p.fenceEdges);
}

function volleyball(stone, full, p) {
  const { s0, s1, t0, t1 } = p.box; const L = s1 - s0; const W = t1 - t0;
  const sm = (s0 + s1) / 2; const tc = (t0 + t1) / 2;
  const hl = Math.min(9, (L - 1) / 2); const hw = Math.min(4.5, (W - 1) / 2);
  const beach = p.sport === 'beach_volleyball' || p.surface === 'sand';
  const col = beach ? [0.15, 0.35, 0.85] : PAINT;
  for (const [a0, b0, a1, b1] of [[-hl, -hw, hl, -hw], [hl, -hw, hl, hw], [hl, hw, -hl, hw], [-hl, hw, -hl, -hw]]) lineST(full, p, sm + a0, tc + b0, sm + a1, tc + b1, 0.05, col, 0.03);
  if (!beach) for (const sg of [-1, 1]) lineST(full, p, sm + sg * 3, tc - hw, sm + sg * 3, tc + hw);
  courtNet(stone, full, p, hw + 1, 2.55, 2.43, 1, DARK_NET);
}

function netball(stone, full, p) {
  const { s0, s1, t0, t1 } = p.box; const L = s1 - s0; const W = t1 - t0;
  const sx = Math.min(1, (L - 1) / 30.5); const sy = Math.min(1, (W - 1) / 15.25); const k = Math.min(sx, sy);
  const sm = (s0 + s1) / 2; const tc = (t0 + t1) / 2; const hl = 15.25 * sx; const hw = 7.62 * sy;
  rectST(full, p, sm - hl, tc - hw, sm + hl, tc + hw, 0.05);
  for (const sg of [-1, 1]) lineST(full, p, sm + sg * hl / 3, tc - hw, sm + sg * hl / 3, tc + hw, 0.05);
  arcST(full, p, sm, tc, 0.45, 0, 2 * Math.PI, 0.05);
  for (const [e, dir] of [[sm - hl, 1], [sm + hl, -1]]) {
    arcST(full, p, e, tc, 4.9 * k, dir > 0 ? -Math.PI / 2 : Math.PI / 2, dir > 0 ? Math.PI / 2 : 1.5 * Math.PI, 0.05);
    const ps = e + dir * 0.05;
    post(stone, p, ps, tc, 0.05, 3.05, STEEL);
    const rc = onField(p, ps + dir * 0.4, tc, 3.05);
    const ring = Array.from({ length: 10 }, (_, i) => [rc[0] + 0.19 * Math.cos((Math.PI * i) / 5), rc[1] + 0.19 * Math.sin((Math.PI * i) / 5), rc[2]]);
    for (let i = 0; i < 10; i++) bar(full, 'metalWhite', ring[i], ring[(i + 1) % 10], 0.01, [0.95, 0.38, 0.08]);
    bar(full, 'metalWhite', onField(p, ps, tc, 3.05), onField(p, ps + dir * 0.21, tc, 3.05), 0.015, STEEL);
    lathe(full, 'netting', rc[0], rc[1], [[0.19, rc[2]], [0.15, rc[2] - 0.4]], NET, { n: 10, uvM: 0.08 });
  }
}

function handball(stone, full, p, futsal) {
  const { s0, s1, t0, t1 } = p.box; const L = s1 - s0; const W = t1 - t0;
  const sx = Math.min(1, (L - 1) / 40); const sy = Math.min(1, (W - 1) / 20); const k = Math.min(sx, sy);
  const sm = (s0 + s1) / 2; const tc = (t0 + t1) / 2; const hl = 20 * sx; const hw = 10 * sy;
  rectST(full, p, sm - hl, tc - hw, sm + hl, tc + hw);
  lineST(full, p, sm, tc - hw, sm, tc + hw);
  arcST(full, p, sm, tc, 3 * k, 0, 2 * Math.PI);
  for (const [e, dir] of [[sm - hl, 1], [sm + hl, -1]]) {
    const r = 6 * k;
    arcST(full, p, e, tc - 1.5, r, dir > 0 ? -Math.PI / 2 : Math.PI, dir > 0 ? 0 : 1.5 * Math.PI);
    arcST(full, p, e, tc + 1.5, r, dir > 0 ? 0 : Math.PI / 2, dir > 0 ? Math.PI / 2 : Math.PI);
    lineST(full, p, e + dir * r, tc - 1.5, e + dir * r, tc + 1.5);
    if (!futsal) {
      const r9 = 9 * k;
      for (let a = -1.2; a < 1.2; a += 0.16) arcST(full, p, e, tc + (a < 0 ? -1.5 : 1.5), r9, dir > 0 ? a : Math.PI - a - 0.08, dir > 0 ? a + 0.08 : Math.PI - a);
    }
    spotST(full, p, e + dir * (futsal ? 6 : 7) * sx, tc);
    goal(stone, full, p, e, dir, 3, 2, 1, futsal ? [0.97, 0.97, 0.97] : [0.85, 0.12, 0.1]);
  }
}

// the usual track oval in a box: straights along s, semicircles at the ends, d in from its edge (counter-clockwise)
function stadiumRing(bx, d) {
  const W = bx.t1 - bx.t0; const tc = (bx.t0 + bx.t1) / 2;
  const r = W / 2 - d; const a = bx.s0 + W / 2; const b = bx.s1 - W / 2;
  const out = [];
  const n = 16;
  for (let i = 0; i <= n; i++) { const ang = -Math.PI / 2 + (Math.PI * i) / n; out.push(frameAt(bx, b + r * Math.cos(ang), tc + r * Math.sin(ang))); }
  for (let i = 0; i <= n; i++) { const ang = Math.PI / 2 + (Math.PI * i) / n; out.push(frameAt(bx, a + r * Math.cos(ang), tc + r * Math.sin(ang))); }
  return out;
}

function track(stone, full, p) {
  // the infield grassed (a field inside it lies over this, a few cm higher)
  if (p.hole && p.slab === null && p.drape) {
    drapedMesh(full, 'turf', p.hole, [], (x, y) => p.fieldZ(x, y) - 0.004, () => LOOK.grass[1], p.drape.grid);
  } else if (p.hole && p.slab === null) {
    const inner = p.hole;
    const tri = THREE.ShapeUtils.triangulateShape(inner.map(([x, y]) => new THREE.Vector2(x, y)), []);
    for (const [ia, ib, ic] of tri) {
      let [a, b, c] = [inner[ia], inner[ib], inner[ic]];
      if ((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]) < 0) [b, c] = [c, b];
      const e = Math.max(Math.hypot(b[0] - a[0], b[1] - a[1]), Math.hypot(c[0] - b[0], c[1] - b[1]), Math.hypot(a[0] - c[0], a[1] - c[1]));
      const n = Math.max(1, Math.ceil(e / 2.5));
      const P = (i, j) => { const x = a[0] + ((b[0] - a[0]) * i + (c[0] - a[0]) * j) / n; const y = a[1] + ((b[1] - a[1]) * i + (c[1] - a[1]) * j) / n; return [x, y, p.fieldZ(x, y) - 0.015]; };
      const uv = (q) => [q[0] / 4, q[1] / 4];
      for (let i = 0; i < n; i++) for (let j = 0; j < n - i; j++) {
        const q0 = P(i, j); const q1 = P(i + 1, j); const q2 = P(i, j + 1);
        full.tri('turf', q0, q1, q2, uv(q0), uv(q1), uv(q2), LOOK.grass[1]);
        if (i + j < n - 1) { const q3 = P(i + 1, j + 1); full.tri('turf', q1, q3, q2, uv(q1), uv(q3), uv(q2), LOOK.grass[1]); }
      }
    }
  }
  // lanes: 1.22 m, the inside edge the outline's hole (the infield), else the lanes tagged in
  const lanes = Math.max(4, Math.min(10, Number.parseInt(p.tags.lanes, 10) || 6));
  const ring = p.ring;
  for (let k = 1; k < lanes; k++) {
    const r = p.stadium ? stadiumRing(p.box, k * 1.22) : insetPts(ring, k * 1.22);
    for (let i = 0; i < r.length; i++) strip(full, PAINT_MAT, p, r[i], r[(i + 1) % r.length], 0.05, PAINT);
  }
  const inner = p.hole || insetPts(ring, lanes * 1.22);
  for (let i = 0; i < inner.length; i++) strip(full, PAINT_MAT, p, inner[i], inner[(i + 1) % inner.length], 0.08, PAINT);
}
function insetPts(ring, d) {
  const n = ring.length;
  return ring.map((q, i) => {
    const a = ring[(i - 1 + n) % n]; const b = ring[(i + 1) % n];
    const e1 = [q[0] - a[0], q[1] - a[1]]; const e2 = [b[0] - q[0], b[1] - q[1]];
    const l1 = Math.hypot(...e1) || 1; const l2 = Math.hypot(...e2) || 1;
    const nn = [-(e1[1] / l1 + e2[1] / l2), e1[0] / l1 + e2[0] / l2]; const nl = Math.hypot(...nn) || 1;
    const cos = (nn[0] / nl) * (-e2[1] / l2) + (nn[1] / nl) * (e2[0] / l2);
    const k = Math.min(3, 1 / Math.max(0.33, cos)) * d;
    return [q[0] + (nn[0] / nl) * k, q[1] + (nn[1] / nl) * k];
  });
}

function skatepark(stone, full, p) {
  const { s0, s1, t0, t1 } = p.box; const L = s1 - s0; const W = t1 - t0;
  const rnd = (...k) => hash01(p.seed, ...k);
  const z = p.slab;
  const C = [0.78, 0.78, 0.76];
  // quarter pipes at the ends, a funbox and a rail in the middle
  for (const [e, dir] of [[s0 + 0.5, 1], [s1 - 0.5, -1]]) {
    if (L < 14) break;
    const r = Math.min(2.2, L * 0.1); const w = Math.min(W - 2, 8);
    const tc = (t0 + t1) / 2;
    for (let i = 0; i < 6; i++) {
      const [d0, h0] = [r * (1 - Math.sin((Math.PI / 2) * (i / 6))), r * (1 - Math.cos((Math.PI / 2) * (i / 6)))];
      const [d1, h1] = [r * (1 - Math.sin((Math.PI / 2) * ((i + 1) / 6))), r * (1 - Math.cos((Math.PI / 2) * ((i + 1) / 6)))];
      const q = [onField(p, e + dir * d0, tc - w / 2, h0), onField(p, e + dir * d0, tc + w / 2, h0), onField(p, e + dir * d1, tc + w / 2, h1), onField(p, e + dir * d1, tc - w / 2, h1)];
      // (facing into the park: the right of +t is +s)
      const [a, b, c, d] = dir > 0 ? q : [q[1], q[0], q[3], q[2]];
      stone.quad('smoothConcrete', a, b, c, d, [0, 0], [1, 0], [1, 1], [0, 1], C);
    }
    // its sides closed: the curve's profile down to the slab
    for (const sg of [-1, 1]) {
      const tt = tc + (sg * w) / 2;
      const prof = Array.from({ length: 7 }, (_, i) => [r * (1 - Math.sin((Math.PI / 2) * (i / 6))), r * (1 - Math.cos((Math.PI / 2) * (i / 6)))]);
      const o = onField(p, e, tt, 0);
      for (let i = 0; i < 6; i++) {
        const a = onField(p, e + dir * prof[i][0], tt, prof[i][1]); const b = onField(p, e + dir * prof[i + 1][0], tt, prof[i + 1][1]);
        // (facing out of the ramp's side: away from its middle)
        if ((sg > 0) === (dir > 0)) stone.tri('smoothConcrete', o, b, a, [0, 0], [1, 0], [0, 1], C);
        else stone.tri('smoothConcrete', o, a, b, [0, 0], [1, 0], [0, 1], C);
      }
    }
    box(stone, 'smoothConcrete', F(p, e - dir * 0.0, (t0 + t1) / 2), p.box.u, 0.25, w / 2, z, z + r, C);
    bar(stone, 'metalWhite', onField(p, e + dir * 0.02, tc - w / 2, r + 0.02), onField(p, e + dir * 0.02, tc + w / 2, r + 0.02), 0.03, STEEL);
  }
  const sm = (s0 + s1) / 2; const tc = (t0 + t1) / 2;
  if (L > 10 && W > 6) {
    box(stone, 'smoothConcrete', F(p, sm, tc), p.box.u, 1.2, 1.5, z, z + 0.5, C);
    for (const sg of [-1, 1]) {
      const q = [onField(p, sm + sg * 1.2, tc - 1.5, 0.5), onField(p, sm + sg * 1.2, tc + 1.5, 0.5), onField(p, sm + sg * 3, tc + 1.5, 0), onField(p, sm + sg * 3, tc - 1.5, 0)];
      const [a, b, c, d] = sg > 0 ? q : [q[1], q[0], q[3], q[2]];
      stone.quad('smoothConcrete', a, b, c, d, [0, 0], [1, 0], [1, 1], [0, 1], C);
    }
    const tr = tc + Math.min(W / 2 - 1, 3) * (rnd('rail') < 0.5 ? 1 : -1);
    for (const s of [sm - 3, sm + 3]) post(stone, p, s, tr, 0.03, 0.4, STEEL);
    bar(stone, 'metalWhite', onField(p, sm - 3.3, tr, 0.4), onField(p, sm + 3.3, tr, 0.4), 0.025, STEEL);
  }
}

/** Build one field: its surface, markings and fittings. stone: both levels (collision), full: the full one. */
export function buildPitch(stone, full, p) {
  surfaceMesh(stone, full, p);
  switch (p.sport) {
    case 'soccer': soccer(stone, full, p); break;
    case 'futsal': handball(stone, full, p, true); break;
    case 'american_football': americanFootball(stone, full, p); break;
    case 'rugby': rugby(stone, full, p); break;
    case 'field_hockey': fieldHockey(stone, full, p); break;
    case 'cricket': cricket(stone, full, p); break;
    case 'baseball': case 'softball': baseball(stone, full, p, p.sport === 'softball'); break;
    case 'basketball': basketball(stone, full, p); break;
    case 'tennis': case 'pickleball': case 'padel': tennis(stone, full, p, p.sport); break;
    case 'volleyball': case 'beach_volleyball': volleyball(stone, full, p); break;
    case 'netball': netball(stone, full, p); break;
    case 'handball': handball(stone, full, p, false); break;
    case 'track': track(stone, full, p); break;
    case 'skateboard': if (p.slab !== null) skatepark(stone, full, p); break;
    default: {
      // a plain field: its edge marked
      const r = insetPts(p.ring, 0.5);
      if (p.area < 3000) for (let i = 0; i < r.length; i++) strip(full, PAINT_MAT, p, r[i], r[(i + 1) % r.length], 0.06, PAINT);
    }
  }
  return p.sport;
}

// ── Seating ──────────────────────────────────────────────────────────────────

/** Bleachers and grandstands: [{ id, ring, box, face (unit, toward the field), z0, z1, roof }]. */
export function planSeating(features, project, pitches = [], { groundAt = null } = {}) {
  const out = [];
  for (const f of features || []) {
    const t = f?.tags || {};
    if (!(t.building === 'grandstand' || t.leisure === 'bleachers' || t.building === 'bleachers' || t['building:part'] === 'grandstand')) continue;
    if (!Array.isArray(f.geometry) || f.geometry.length < 4) continue;
    const pts = f.geometry.map((q) => project(q.lat, q.lng));
    let ring = cleanRing(pts);
    if (ring.length < 3) continue;
    let area = signedArea(ring);
    if (area < 0) { ring = ring.reverse(); area = -area; }
    if (area < 6 || area > 20000) continue;
    const bx = orientedBox(ring);
    if (!bx) continue;
    const c = frameAt(bx, (bx.s0 + bx.s1) / 2, (bx.t0 + bx.t1) / 2);
    // toward the nearest field's middle (else one long side)
    let near = null;
    for (const p of pitches) {
      const pc = frameAt(p.box, (p.box.s0 + p.box.s1) / 2, (p.box.t0 + p.box.t1) / 2);
      const d = Math.hypot(pc[0] - c[0], pc[1] - c[1]);
      if (d < 250 && (!near || d < near.d)) near = { d, pc };
    }
    const v = [-bx.u[1], bx.u[0]];
    const toward = near ? [near.pc[0] - c[0], near.pc[1] - c[1]] : v;
    const face = toward[0] * v[0] + toward[1] * v[1] >= 0 ? v : [-v[0], -v[1]];
    const grounds = pts.map((q) => q[2]).filter(Number.isFinite);
    out.push({ id: f.id, ring, box: bx, face, z0: Math.min(...grounds), z1: Math.max(...grounds), area, ground: groundAt,
      roof: t.building === 'grandstand' && (area > 250 || Number.parseFloat(t['building:levels']) >= 2 || /roof|covered/.test(String(t.covered || t['roof:shape'] || ''))), tags: t, seed: String(f.id) });
  }
  return out;
}

/** Tiered seating stepping up away from the field; a grandstand's roof over it on posts. */
export function buildSeating(stone, full, st) {
  const bx = st.box; const f = st.face;
  const along = bx.u;
  const L = bx.s1 - bx.s0; const D = bx.t1 - bx.t0;
  // depth runs across the box, from the field side back
  const front = (f[0] * -bx.u[1] + f[1] * bx.u[0]) > 0 ? bx.t1 : bx.t0;
  const back = front === bx.t1 ? bx.t0 : bx.t1;
  const dirT = back > front ? 1 : -1;
  // rows a fixed depth and rise from the front (a deep outline: more rows, up to 20)
  const rowD = 0.75; const rise = 0.4;
  const rows = Math.max(2, Math.min(20, Math.floor(D / rowD)));
  const g = st.z1;
  const at = (s, t) => frameAt(bx, s, t);
  const seat = [0.78, 0.8, 0.82];
  const frame = [0.5, 0.52, 0.55];
  const concrete = st.tags.building === 'grandstand';
  const sMid = (bx.s0 + bx.s1) / 2;
  for (let k = 0; k < rows; k++) {
    const t0 = front + dirT * k * rowD; const t1 = t0 + dirT * rowD;
    const z = g + 0.45 + k * rise;          // the seat's top
    const zf = z - 0.42;                     // the footboard's
    if (concrete) box(stone, 'smoothConcrete', at(sMid, (t0 + t1) / 2), along, L / 2, rowD / 2, st.z0 - 0.3, zf, [0.8, 0.8, 0.78]);
    else {
      // footboard, the closed riser up to the next row's footboard
      box(stone, 'metalWhite', at(sMid, t0 + dirT * rowD * 0.5), along, L / 2, rowD * 0.5, zf - 0.04, zf, seat);
      const r0 = at(bx.s0, t1); const r1 = at(bx.s1, t1);
      const q = [[...r0, zf], [...r1, zf], [...r1, zf + rise], [...r0, zf + rise]];
      // (facing the field: the right of s0 -> s1 is -t)
      const [a, b, c, d] = dirT > 0 ? q : [q[1], q[0], q[3], q[2]];
      stone.quad('metalWhite', a, b, c, d, [0, 0], [L, 0], [L, rise], [0, rise], [0.66, 0.68, 0.7]);
    }
    // the seat plank toward the back of the row
    box(stone, 'metalWhite', at(sMid, t0 + dirT * rowD * 0.72), along, L / 2 - 0.05, rowD * 0.18, z - 0.05, z, concrete ? [0.15, 0.3, 0.6] : seat);
  }
  const top = g + 0.45 + (rows - 1) * rise;
  // the front closed down to the ground (on a slope the first row stood on stilts)
  {
    const n = Math.max(1, Math.ceil(L / 2));
    for (let i = 0; i < n; i++) {
      const sa = bx.s0 + (L * i) / n; const sb = bx.s0 + (L * (i + 1)) / n;
      const a = at(sa, front); const b = at(sb, front);
      const ga = st.ground ? st.ground(...a) : st.z0; const gb = st.ground ? st.ground(...b) : st.z0;
      const q = [[...a, ga - 0.2], [...b, gb - 0.2], [...b, g + 0.03], [...a, g + 0.03]];
      const [qa, qb, qc, qd] = dirT > 0 ? q : [q[1], q[0], q[3], q[2]];
      stone.quad(concrete ? 'smoothConcrete' : 'metalWhite', qa, qb, qc, qd, [0, 0], [1, 0], [1, 1], [0, 1], concrete ? [0.8, 0.8, 0.78] : [0.66, 0.68, 0.7]);
    }
  }
  // the frame under aluminium bleachers, a rail along the back
  if (!concrete) {
    for (let s = bx.s0 + 0.2; s <= bx.s1 - 0.1; s += Math.max(1.8, L / Math.ceil(L / 2.4))) {
      for (let k = 0; k < rows; k += Math.max(1, Math.floor(rows / 3))) {
        const t = front + dirT * (k + 0.5) * rowD; const [x, y] = at(s, t);
        cylinder(stone, 'metalWhite', x, y, 0.04, st.z0 - 0.2, g + 0.45 + k * rise - 0.42, frame, { n: 6 });
      }
      bar(stone, 'metalWhite', [...at(s, front + dirT * 0.3), g + 0.03], [...at(s, back - dirT * 0.1), top - 0.4], 0.04, frame);
    }
  } else {
    // the back wall of a grandstand
    box(stone, 'smoothConcrete', at((bx.s0 + bx.s1) / 2, back - dirT * 0.15), along, L / 2, 0.15, st.z0 - 0.3, top + 1.2, [0.82, 0.82, 0.8]);
  }
  for (const s of [bx.s0 + 0.05, bx.s1 - 0.05]) bar(stone, 'metalWhite', [...at(s, front), g + 1.2], [...at(s, back), top + 1], 0.03, STEEL);
  bar(stone, 'metalWhite', [...at(bx.s0, back - dirT * 0.05), top + 1], [...at(bx.s1, back - dirT * 0.05), top + 1], 0.03, STEEL);
  if (st.roof) {
    // a cantilevered roof from posts at the back, sloping down toward the field
    const zr = top + 3.2;
    const n = Math.max(2, Math.ceil(L / 8));
    for (let i = 0; i <= n; i++) {
      const s = bx.s0 + (L * i) / n; const [x, y] = at(s, back - dirT * 0.3);
      cylinder(stone, 'metalWhite', x, y, 0.15, st.z0 - 0.3, zr + 0.4, frame, { n: 8 });
      bar(stone, 'metalWhite', [x, y, zr + 0.4], [...at(s, front - dirT * 1), zr - 0.4], 0.1, frame);
    }
    const q = [[bx.s0 - 0.3, back + dirT * 0.3, zr + 0.5], [bx.s1 + 0.3, back + dirT * 0.3, zr + 0.5], [bx.s1 + 0.3, front - dirT * 1.2, zr - 0.3], [bx.s0 - 0.3, front - dirT * 1.2, zr - 0.3]]
      .map(([s, t, z]) => [...at(s, t), z]);
    const [a, b, c, d] = dirT > 0 ? [q[1], q[0], q[3], q[2]] : q;
    stone.quad('roofMetal', a, b, c, d, [0, 0], [L / 3, 0], [L / 3, D / 3], [0, D / 3], [0.85, 0.86, 0.88]);
    stone.quad('roofMetal', b, a, d, c, [0, 0], [L / 3, 0], [L / 3, D / 3], [0, D / 3], [0.6, 0.62, 0.65]);
  }
  return st.roof ? 'grandstand' : 'bleachers';
}

/** The fields' and stands' BeamNG material stages (grass, dirt, sand, chain link, netting). */
const TILE = '/assets/materials/tileable';
export const SPORTS_MATERIAL_STAGES = {
  linePaint: { baseColorFactor: [0.92, 0.92, 0.9, 1], roughnessFactor: 0.85, metallicFactor: 0 },
  turf: { baseColorMap: `${TILE}/soil/grass_garden/grass_garden_d.dds`, roughnessFactor: 0.95 },
  dirt: { baseColorMap: `${TILE}/soil/m_dirt/t_gm_dirt_d.dds`, normalMap: `${TILE}/soil/m_dirt/t_gm_dirt_n.dds`, roughnessFactor: 0.95 },
  sand: { baseColorMap: `${TILE}/road/terrain_sand/t_beachsand_b.color.png`, normalMap: `${TILE}/road/terrain_sand/t_beachsand_nm.normal.png`, roughnessFactor: 0.95 },
  chainlink: {
    baseColorMap: `${TILE}/metal/chainlink/t_chainlink_fence_b.color.png`, normalMap: `${TILE}/metal/chainlink/t_chainlink_fence_nm.normal.png`,
    opacityMap: `${TILE}/metal/chainlink/t_chainlink_fence_o.data.png`, roughnessFactor: 0.5, metallicFactor: 0.8,
  },
  // (a net as a see-through mesh tinted by sport: a fine mesh texture faded out entirely beyond a few metres)
  netting: { baseColorFactor: [1, 1, 1, 1], opacityFactor: 0.55, roughnessFactor: 0.9, metallicFactor: 0 },
};
/** Material flags beyond the stages: the see-through ones cut out by their opacity, both sides drawn. */
export const SPORTS_MATERIAL_FLAGS = {
  // (surfaces lying on the ground: their edges threw shadows on it, as if floating)
  turf: { castShadows: false }, dirt: { castShadows: false }, sand: { castShadows: false }, linePaint: { castShadows: false },
  // (as the game's own chain link: translucent with no blending, cut at 40)
  chainlink: { alphaTest: true, alphaRef: 40, translucent: true, translucentBlendOp: 'None', doubleSided: true, castShadows: false },
  netting: { translucent: true, translucentBlendOp: 'LerpAlpha', translucentZWrite: false, doubleSided: true, castShadows: false },
};
