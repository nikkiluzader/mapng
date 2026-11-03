// Racetracks for BeamNG exports: the fittings along the drawn raceways
// (highway=raceway carriageways, after the road system has laid them out),
// built into the building tiles (beamngBuildings.js).
//
//   circuit, kart   a kerb to a corner (a radius under KERB_RADIUS_M, turning
//                   25 degrees or more): the inside from turn-in to exit, the
//                   outside at the exit; a kart track's tyre walls round the
//                   outside of its corners
//   dirt            a dirt oval's concrete wall round its outside with a catch
//                   fence on it; a line of tyres round its infield
//   drag            the light tree on the centre line at the start (the end
//                   nearer the grandstands, else the other raceways),
//                   concrete walls along both sides
//   area=yes        a raceway's surface outline (dirt or asphalt) lying on
//                   the ground
//
// The kind of each raceway: roadWidth.js racewayKind (tags, and the exporter
// marks a long dead-straight raceway a drag strip). Everything lies on the
// terrain's own triangles (drape) or stands on it. Pure geometry.

import { wallOpenings, clearOf } from './gates.js';
import { box, cylinder } from './buildingDetails.js';
import { cleanRing, signedArea, inRing } from './fountains.js';
import { bar } from './pools.js';
import { racewayKind, racewayHalfWidth } from './roadWidth.js';
import { orientedBox } from './waterCover.js';

const KERB_RADIUS_M = { circuit: 150, kart: 30 };
const KERB_EXIT_M = 15;
const KERB_W = { circuit: 1.0, kart: 0.6 };
const KERB_STRIPE = { circuit: 1.0, kart: 0.5 };
const RED = [0.8, 0.1, 0.08];
const WHITE = [0.95, 0.95, 0.93];
const CONCRETE = [0.78, 0.78, 0.76];
const STEEL = [0.72, 0.74, 0.76];
const TYRE = [0.08, 0.08, 0.09];
// the game's own pieces (beamngPropLibrary PROP_SHAPES): Automation Test
// Track's tyre wall and concrete barrier, laid end to end
const TYRE_WALL_M = 4.16;
const CONCRETE_WALL_M = 4.0;
const OVAL_WALL_H = 1.0;          // (the barrier piece's height: the catch fence on it)

const SURFACE_LINE_SHARE = 0.4;
const OVAL_RING_RUN_M = 30;
const UNPAVED = new Set(['dirt', 'clay', 'ground', 'earth', 'unpaved', 'gravel', 'sand', 'mud', 'compacted', 'grass']);

// per node: the unit tangent and the turn's radius over a few metres either side
function bends(nodes, window = 6) {
  const n = nodes.length;
  const s = [0];
  for (let i = 1; i < n; i++) s.push(s[i - 1] + Math.hypot(nodes[i][0] - nodes[i - 1][0], nodes[i][1] - nodes[i - 1][1]));
  const at = (target) => { let j = 0; while (j < n - 1 && s[j + 1] < target) j++; const f = (target - s[j]) / ((s[j + 1] - s[j]) || 1); const a = nodes[j]; const b = nodes[Math.min(n - 1, j + 1)]; return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f]; };
  return nodes.map((q, i) => {
    const a = at(Math.max(0, s[i] - window)); const b = at(Math.min(s[n - 1], s[i] + window));
    const u = [b[0] - a[0], b[1] - a[1]]; const L = Math.hypot(...u) || 1;
    const p0 = [q[0] - a[0], q[1] - a[1]]; const p1 = [b[0] - q[0], b[1] - q[1]];
    const turn = Math.atan2(p0[0] * p1[1] - p0[1] * p1[0], p0[0] * p1[0] + p0[1] * p1[1]);
    const radius = Math.abs(turn) > 1e-4 ? (Math.hypot(...p0) + Math.hypot(...p1)) / 2 / Math.abs(turn) : Infinity;
    return { t: [u[0] / L, u[1] / L], radius, turn, s: s[i] };
  });
}

// an offset line along the carriageway: d to the left (negative: right)
const offsetAt = (q, t, d) => [q[0] - t[1] * d, q[1] + t[0] * d];

// pieces of a circuit or kart track running on from each other become one
// line: end to start (either way round where it isn't one-way), the straightest
// continuation at a fork (the lap, not the pit entry)
const JOIN_HEADING_COS = Math.cos((25 * Math.PI) / 180);
function joinCircuitPieces(rws) {
  const dirAt = (nodes, atEnd) => { const n = nodes.length; const a = atEnd ? nodes[n - 2] : nodes[0]; const b = atEnd ? nodes[n - 1] : nodes[1]; const L = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1; return [(b[0] - a[0]) / L, (b[1] - a[1]) / L]; };
  const lines = rws.filter((r) => r.kind === 'circuit' || r.kind === 'kart' || r.kind === 'dirt');
  // (lit= by length: one lit piece, a pit entry, doesn't light the whole lap)
  for (const r of lines) {
    const L = r.nodes.slice(1).reduce((s, q, i) => s + Math.hypot(q[0] - r.nodes[i][0], q[1] - r.nodes[i][1]), 0);
    const lit = String(r.tags.lit || '').toLowerCase();
    r.lengths = { all: L, yes: lit === 'yes' ? L : 0, no: lit === 'no' ? L : 0 };
  }
  for (let merged = true; merged;) {
    merged = false;
    for (const a of lines) {
      if (a.gone) continue;
      const e = a.nodes[a.nodes.length - 1]; const da = dirAt(a.nodes, true);
      let best = null;
      for (const b of lines) {
        if (b === a || b.gone || b.kind !== a.kind || Math.abs(b.half - a.half) > 1) continue;
        for (const nb of b.oneWay ? [b.nodes] : [b.nodes, b.nodes.slice().reverse()]) {
          if (Math.hypot(nb[0][0] - e[0], nb[0][1] - e[1]) > 1) continue;
          const db = dirAt(nb, false); const c = da[0] * db[0] + da[1] * db[1];
          if (c >= JOIN_HEADING_COS && (!best || c > best.c)) best = { c, b, nb };
        }
      }
      if (!best) continue;
      a.nodes = [...a.nodes, ...best.nb.slice(1)];
      a.tags = { ...best.b.tags, ...a.tags }; a.oneWay = a.oneWay && best.b.oneWay; best.b.gone = true; merged = true;
      for (const k of ['all', 'yes', 'no']) a.lengths[k] += best.b.lengths[k];
    }
  }
  for (const r of lines) {
    if (r.gone) continue;
    const { all, yes, no } = r.lengths;
    const { lit: _, ...tags } = r.tags;
    r.tags = yes >= all / 2 ? { ...tags, lit: 'yes' } : no >= all / 2 ? { ...tags, lit: 'no' } : tags;
  }
  for (let i = rws.length - 1; i >= 0; i--) if (rws[i].gone) rws.splice(i, 1);
}

// A circuit's unnamed, untagged pieces are as known as the named ones they
// touch (at a fork they don't join them as a line)
function markKnownCircuits(rws) {
  const lines = rws.filter((r) => r.kind === 'circuit' || r.kind === 'kart');
  const cell = (q) => `${Math.round(q[0] / 2)},${Math.round(q[1] / 2)}`;
  const at = new Map();
  for (const r of lines) for (const q of r.nodes) { const k = cell(q); if (!at.has(k)) at.set(k, []); if (!at.get(k).includes(r)) at.get(k).push(r); }
  const stack = lines.filter((r) => r.tags.surface || r.tags.name);
  for (const r of stack) r.known = true;
  while (stack.length) {
    const r = stack.pop();
    for (const q of r.nodes) for (const o of at.get(cell(q)) || []) if (!o.known && o.kind === r.kind) { o.known = true; stack.push(o); }
  }
}

// The corners of a line: [{ i, j, side }] (nodes i..j, side +1 turning left).
// Measured over KERB_WINDOW_M, the same way round closes a gap under
// KERB_GAP_M (one corner, whatever the mapped points do), and a bend turning
// less than KERB_MIN_TURN is a kink, no corner.
const KERB_WINDOW_M = 12;
const KERB_GAP_M = 25;
const KERB_MIN_TURN = (25 * Math.PI) / 180;
function cornersOf(info, lim) {
  const n = info.length; const runs = [];
  for (let k = 0; k < n; k++) {
    if (info[k].radius >= lim) continue;
    const side = info[k].turn > 0 ? 1 : -1;
    const last = runs[runs.length - 1];
    if (last && last.side === side && info[k].s - info[last.j].s < KERB_GAP_M) last.j = k;
    else runs.push({ i: k, j: k, side });
  }
  return runs.filter((r) => {
    let turn = 0;
    for (let k = r.i + 1; k <= r.j; k++) { let d = Math.atan2(info[k].t[1], info[k].t[0]) - Math.atan2(info[k - 1].t[1], info[k - 1].t[0]); d = Math.atan2(Math.sin(d), Math.cos(d)); turn += d; }
    return Math.abs(turn) >= KERB_MIN_TURN;
  });
}

/**
 * The raceways to fit: [{ kind, nodes, half, closed, tags }] from the drawn
 * carriageways (nodes [x, y, z, w]).
 */
export function planRaceways(carriageways = []) {
  const rws = carriageways.filter((cw) => cw.highway === 'raceway' && cw.nodes?.length >= 2).map((cw) => {
    const a = cw.nodes[0]; const b = cw.nodes[cw.nodes.length - 1];
    return { kind: racewayKind(cw.tags || {}), nodes: cw.nodes, half: cw.half, closed: Math.hypot(b[0] - a[0], b[1] - a[1]) < 1, tags: cw.tags || {}, id: cw.wayId, oneWay: !!cw.oneWay };
  });
  // a circuit or oval in pieces (its ways, the road system's chunks) is one
  // line: a corner cut at a piece's end lost its kerb there, a wall its join
  joinCircuitPieces(rws);
  markKnownCircuits(rws);
  // a drag strip in pieces (split at the timing lights, the shut-down area):
  // the pieces that meet end to end in line are one strip, one start
  const drags = rws.filter((r) => r.kind === 'drag');
  const dirOf = (nodes, atEnd) => { const n = nodes.length; const a = atEnd ? nodes[n - 2] : nodes[1]; const b = atEnd ? nodes[n - 1] : nodes[0]; const L = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1; return [(b[0] - a[0]) / L, (b[1] - a[1]) / L]; };
  for (let merged = true; merged;) {
    merged = false;
    outer: for (const a of drags) for (const b of drags) {
      if (a === b || a.gone || b.gone) continue;
      for (const [na, nb] of [[a.nodes, b.nodes], [a.nodes, b.nodes.slice().reverse()]]) {
        const e = na[na.length - 1]; const f = nb[0];
        if (Math.hypot(e[0] - f[0], e[1] - f[1]) > 3) continue;
        const da = dirOf(na, true); const db = dirOf(nb, false);
        // (the end's heading going on into the next piece's)
        if (-(da[0] * db[0] + da[1] * db[1]) < 0.95) continue;
        a.nodes = [...na, ...nb.slice(1)]; a.half = Math.max(a.half, b.half); b.gone = true; merged = true;
        break outer;
      }
    }
  }
  for (let i = rws.length - 1; i >= 0; i--) if (rws[i].gone) rws.splice(i, 1);
  // dirt ovals come in pieces (split where the infield crossings meet them):
  // the pieces that touch form one track; its outer ring is where a node lies
  // (nearly) as far from the track's middle as anything in that direction
  // (paved ovals too: a loop that only ever bends round its own middle)
  const dirt = rws.filter((r) => r.kind === 'dirt' || r.kind === 'circuit');
  const ends = (r) => [r.nodes[0], r.nodes[r.nodes.length - 1]];
  const touch = (r, o) => ends(r).some((p) => o.nodes.some((q) => Math.hypot(p[0] - q[0], p[1] - q[1]) < 3));
  const seen = new Set();
  for (const r of dirt) {
    if (seen.has(r)) continue;
    const group = [r]; seen.add(r);
    for (let k = 0; k < group.length; k++) for (const o of dirt) if (!seen.has(o) && (touch(group[k], o) || touch(o, group[k]))) { seen.add(o); group.push(o); }
    const pts = group.flatMap((g) => g.nodes);
    const c = [pts.reduce((a, q) => a + q[0], 0) / pts.length, pts.reduce((a, q) => a + q[1], 0) / pts.length];
    const BINS = 48; const far = new Array(BINS).fill(0);
    const bin = (q) => Math.floor(((Math.atan2(q[1] - c[1], q[0] - c[0]) + Math.PI) / (2 * Math.PI)) * BINS) % BINS;
    for (const q of pts) { const b = bin(q); far[b] = Math.max(far[b], Math.hypot(q[0] - c[0], q[1] - c[1])); }
    let loop = far.every((v) => v > 0);   // the pieces go all the way round
    // on the outer ring: a line straight out from it, away from the middle,
    // meets no other piece of the track (a crossing has the ring beyond it)
    const segs = group.flatMap((g) => g.nodes.filter((_, i) => i % 3 === 0 || i === g.nodes.length - 1).map((q, i, a) => (i ? [a[i - 1], q] : null)).filter(Boolean));
    const outerOf = (g, q, i) => {
      const a = g.nodes[Math.max(0, i - 1)]; const b = g.nodes[Math.min(g.nodes.length - 1, i + 1)];
      const L = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1; let nx = -(b[1] - a[1]) / L; let ny = (b[0] - a[0]) / L;
      if ((c[0] - q[0]) * nx + (c[1] - q[1]) * ny > 0) { nx = -nx; ny = -ny; }
      for (const [p0, p1] of segs) {
        const dx = p1[0] - p0[0]; const dy = p1[1] - p0[1]; const den = nx * dy - ny * dx;
        if (Math.abs(den) < 1e-9) continue;
        const t = ((p0[0] - q[0]) * dy - (p0[1] - q[1]) * dx) / den; const u = ((p0[0] - q[0]) * ny - (p0[1] - q[1]) * nx) / den;
        if (t > 4 && u >= 0 && u <= 1) return false;
      }
      return true;
    };
    if (loop && group.some((g) => g.kind === 'circuit') && !group.some((g) => g.tags.name || g.tags.surface)) loop = false;
    if (loop && group.some((g) => g.kind === 'circuit')) {
      // an oval: its outer ring bends round the middle all the way (a road
      // course turns both ways: its kerbs, not an oval's wall)
      let inward = 0; let outward = 0;
      for (const g of group) {
        const inf = bends(g.nodes, 15);
        g.nodes.forEach((q, i) => {
          if (!outerOf(g, q, i) || !Number.isFinite(inf[i].radius)) return;
          const nL = [-inf[i].t[1], inf[i].t[0]];
          const left = (c[0] - q[0]) * nL[0] + (c[1] - q[1]) * nL[1] > 0;
          if ((inf[i].turn > 0) === left) inward += Math.abs(inf[i].turn); else outward += Math.abs(inf[i].turn);
        });
      }
      // (known to be a racetrack: named or surfaced; an untagged loop may be a
      // rally school's stage, no place for a wall and catch fence)
      const known = group.some((g) => g.tags.name || g.tags.surface);
      loop = known && inward > 0 && outward / (inward + outward) < 0.1;
    }
    for (const g of group) {
      g.oval = loop ? { c, outer: g.nodes.map((q, i) => outerOf(g, q, i)) } : null;
    }
  }
  return rws;
}

// (x, y, rw, i) -> true where a point lies on a raceway's carriageway: another
// one, or this one's own other side of a hairpin (more than SELF_GAP_M along it)
const SELF_GAP_M = 12;
export function carriagewayTest(rws, cell = 20) {
  const grid = new Map();
  const key = (cx, cy) => `${cx},${cy}`;
  for (const r of rws) {
    const inf = bends(r.nodes, 1);
    for (let i = 0; i < r.nodes.length - 1; i++) {
      const a = r.nodes[i]; const b = r.nodes[i + 1];
      const pad = r.half + 1;
      const x0 = Math.floor((Math.min(a[0], b[0]) - pad) / cell); const x1 = Math.floor((Math.max(a[0], b[0]) + pad) / cell);
      const y0 = Math.floor((Math.min(a[1], b[1]) - pad) / cell); const y1 = Math.floor((Math.max(a[1], b[1]) + pad) / cell);
      const seg = { r, a, b, s: inf[i].s };
      for (let cx = x0; cx <= x1; cx++) for (let cy = y0; cy <= y1; cy++) { const k = key(cx, cy); if (!grid.has(k)) grid.set(k, []); grid.get(k).push(seg); }
    }
  }
  return (x, y, rw, s) => {
    for (const g of grid.get(key(Math.floor(x / cell), Math.floor(y / cell))) || []) {
      if (g.r.nodes === rw.nodes && Math.abs(g.s - s) < SELF_GAP_M) continue;
      const dx = g.b[0] - g.a[0]; const dy = g.b[1] - g.a[1]; const L2 = dx * dx + dy * dy || 1;
      const t = Math.max(0, Math.min(1, ((x - g.a[0]) * dx + (y - g.a[1]) * dy) / L2));
      if (Math.hypot(x - g.a[0] - dx * t, y - g.a[1] - dy * t) < g.r.half + 0.3) return true;
    }
    return false;
  };
}

// a strip between two offset lines along the nodes i0..i1, coloured in stripes along it
function edgeStrip(m, mat, rw, info, i0, i1, d0, d1, z, stripe, colours, lift) {
  let acc = 0;
  for (let i = i0; i < i1; i++) {
    if (rw.lifted?.[i] || rw.lifted?.[i + 1]) continue;
    const qa = rw.nodes[i]; const qb = rw.nodes[i + 1];
    const a0 = offsetAt(qa, info[i].t, d0); const a1 = offsetAt(qa, info[i].t, d1);
    const b0 = offsetAt(qb, info[i + 1].t, d0); const b1 = offsetAt(qb, info[i + 1].t, d1);
    if (rw.blocked && [a1, b1].some((q, k) => rw.blocked(q[0], q[1], rw, info[i + k].s))) continue;
    const L = Math.hypot(qb[0] - qa[0], qb[1] - qa[1]);
    const P = (xy, dz) => [xy[0], xy[1], z(xy[0], xy[1]) + dz];
    const lerp = (p, q, f) => [p[0] + (q[0] - p[0]) * f, p[1] + (q[1] - p[1]) * f];
    // (in pieces no longer than a stripe, each its own colour: a kerb's red and white)
    const k = Math.max(1, Math.ceil(L / Math.min(stripe, 2)));
    for (let h = 0; h < k; h++) {
      const f0 = h / k; const f1 = (h + 1) / k;
      const col = colours[Math.floor((acc + L * (f0 + f1) / 2) / stripe) % colours.length];
      const q = [P(lerp(a0, b0, f0), lift[0]), P(lerp(a0, b0, f1), lift[0]), P(lerp(a1, b1, f1), lift[1]), P(lerp(a1, b1, f0), lift[1])];
      const ccw = (q[1][0] - q[0][0]) * (q[2][1] - q[0][1]) - (q[1][1] - q[0][1]) * (q[2][0] - q[0][0]) > 0;
      const [qa2, qb2, qc2, qd2] = ccw ? q : [q[0], q[3], q[2], q[1]];
      const l = L / k;
      m.quad(mat, qa2, qb2, qc2, qd2, [0, 0], [l, 0], [l, 1], [0, 1], col);
    }
    acc += L;
  }
}

// a wall (a box per segment) along an offset line
// (native: { shape, length, props }: the game's own wall pieces laid end to
// end along it, each turned along its stretch, in place of drawn boxes)
function wallAlong(m, mat, rw, info, i0, i1, d, thick, h, ground, col, colours = null, stripe = 1.2, native = null) {
  let acc = 0;
  let next = native ? native.length / 2 : 0;   // the next piece's middle, along the wall
  const openings = openWall(rw, rw.nodes.slice(i0, i1 + 1).map((q, k) => offsetAt(q, info[i0 + k].t, d)), d, colours ? 'gap' : 'mesh');
  for (let i = i0; i < i1; i++) {
    if (rw.lifted?.[i] || rw.lifted?.[i + 1]) continue;
    const a0 = offsetAt(rw.nodes[i], info[i].t, d); const b0 = offsetAt(rw.nodes[i + 1], info[i + 1].t, d);
    for (const [u0, u1] of clearOf(a0, b0, openings)) {
    const a = lerpXY(a0, b0, u0); const b = lerpXY(a0, b0, u1);
    if (rw.blocked) {
      const off = thick / 2 + 0.2; const sg = Math.sign(d) || 1;
      const near = (q, t, k) => [offsetAt(q, t, -sg * off), offsetAt(q, t, sg * off)].some((p) => rw.blocked(p[0], p[1], rw, info[i + k].s));
      if (near(a, info[i].t, 0) || near(b, info[i + 1].t, 1)) continue;
    }
    const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (L < 0.05) continue;
    const c = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]; const u = [(b[0] - a[0]) / L, (b[1] - a[1]) / L];
    if (native) {
      // (a gap or a blocked stretch starts the pieces afresh past it)
      if (u0 > 0 || native.broke) { next = acc + native.length / 2; native.broke = false; }
      while (next <= acc + L) {
        const t = next - acc; const p = [a[0] + u[0] * t, a[1] + u[1] * t];
        native.props.push({ shape: native.shape, x: p[0], y: p[1], z: ground(...p) - 0.03, yaw: Math.atan2(u[1], u[0]) });
        next += native.length;
      }
      acc += L;
      if (u1 < 1) native.broke = true;
      continue;
    }
    const g = Math.min(ground(...a), ground(...b));
    box(m, mat, c, u, L / 2 + 0.02, thick / 2, g - 0.3, g + h, colours ? colours[Math.floor(acc / stripe) % colours.length] : col);
    acc += L;
    }
  }
}

const lerpXY = (a, b, u) => [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u];

// the openings a wall along `line`, d off the track, leaves for the roads through it
function openWall(rw, line, d, style) {
  const openings = wallOpenings(line, rw.roads, { style });
  for (const g of openings) rw.gates?.push({ ...g, prefer: Math.sign(d) || 1 });
  return openings;
}

/** A drag strip's nodes, start first: the end nearer the grandstands' middle (they line the quarter mile), without any the end nearer the rest of the raceways. */
export function dragStartFirst(rw, others = [], spectators = []) {
  const n = rw.nodes.length;
  const d = (q, p) => Math.hypot(p[0] - q[0], p[1] - q[1]);
  const near = (q) => others.reduce((c, o) => c + o.nodes.filter((p) => d(q, p) < 80).length, 0);
  const toStands = (q) => Math.min(...spectators.map((p) => d(q, p)));
  const a0 = rw.nodes[0]; const a1 = rw.nodes[n - 1];
  const fwd = spectators.length ? toStands(a0) <= toStands(a1) : near(a0) >= near(a1);
  return fwd ? rw.nodes : rw.nodes.slice().reverse();
}

/** Fit one raceway: kerbs, walls, fences, tyres, a drag strip's start. drape: { drapeAt }. */
export function buildRaceway(stone, full, rw, { drapeAt, others = [], blocked = null, spectators = [], roads = [] } = {}) {
  // (stretches on a bridge, a ramp or in a tunnel: the fittings stand on the
  // terrain, so none there)
  const gates = [];
  rw = { ...rw, blocked, roads, gates, lifted: rw.nodes.map((q) => !Number.isFinite(q[2]) ? false : Math.abs(q[2] - drapeAt(q[0], q[1])) > 1) };
  const info = bends(rw.nodes);
  const n = rw.nodes.length;
  // a closed lap: one direction where its ends meet, so its walls meet too
  {
    const a = rw.nodes[0]; const b = rw.nodes[n - 1];
    if (n > 3 && Math.hypot(b[0] - a[0], b[1] - a[1]) < 1) {
      const t = [info[0].t[0] + info[n - 1].t[0], info[0].t[1] + info[n - 1].t[1]]; const L = Math.hypot(...t) || 1;
      info[0].t = [t[0] / L, t[1] / L]; info[n - 1].t = info[0].t;
    }
  }
  const z = drapeAt;
  const stats = { kerbs: 0, walls: 0, tyres: 0, trees: 0 };
  const props = [];
  const paved = !UNPAVED.has(String(rw.tags.surface || '').toLowerCase());
  // (kerbs on a racing circuit or kart track only: an untagged raceway, a
  // training course or a test track, has none)
  // (and known to be paved: a surface tag, or a track someone named; an
  // unnamed untagged raceway may be gravel, a rally school's stage)
  const known = rw.known || !!rw.tags.surface || !!rw.tags.name;
  const racing = known && (rw.kind === 'kart' || /motor|racing|kart|circuit|gp|formula|touring|endurance/.test(String(rw.tags.sport || '').toLowerCase()));
  if ((rw.kind === 'circuit' || rw.kind === 'kart') && paved && racing && !rw.oval) {
    // a kerb to a corner, unbroken: on the inside from turn-in through the
    // apex to the exit; on the outside only where a car runs wide, the
    // corner's exit and on past it (known only where the direction is)
    const lim = KERB_RADIUS_M[rw.kind]; const w = KERB_W[rw.kind];
    const inf2 = bends(rw.nodes, KERB_WINDOW_M);
    const strip = (i, j, sg) => edgeStrip(full, 'smoothConcrete', rw, info, i, j, sg * (rw.half - 0.15), sg * (rw.half + w - 0.15), z, KERB_STRIPE[rw.kind], [RED, WHITE], [0.025, 0.06]);
    for (const c of cornersOf(inf2, lim)) {
      strip(c.i, c.j, c.side);
      if (rw.oneWay) {
        const len = info[c.j].s - info[c.i].s;
        const from = info[c.i].s + len * 0.6; const to = info[c.j].s + KERB_EXIT_M;
        let i0 = c.i; while (i0 < n - 1 && info[i0].s < from) i0++;
        let j0 = c.j; while (j0 < n - 1 && info[j0].s < to) j0++;
        strip(i0, j0, -c.side);
      }
      stats.kerbs++;
      // a kart track: a tyre wall round the outside of the bend
      if (rw.kind === 'kart') {
        wallAlong(stone, 'smoothConcrete', rw, info, c.i, c.j, -c.side * (rw.half + w + 1.2), 0.7, 0.75, z, TYRE, null, 0.7, { shape: 'raceTyreWall', length: TYRE_WALL_M, props });
        stats.tyres++;
      }
    }
  }
  if ((rw.kind === 'dirt' || rw.kind === 'circuit') && rw.oval) {
    // a concrete wall round the outside of the oval (away from its middle), a
    // catch fence on it: posts, chain link, a top rail; none along the infield
    // crossings
    const { c, outer } = rw.oval;
    const side = (i) => { const q = rw.nodes[i]; const t = info[i].t; return ((c[0] - q[0]) * -t[1] + (c[1] - q[1]) * t[0]) > 0 ? -1 : 1; };
    // (an unbroken stretch of the outer ring: a crossing only touches it)
    const onRing = new Array(n).fill(false);
    for (let i = 0; i < n;) {
      if (!outer[i] || rw.lifted[i]) { i++; continue; }
      let j = i; while (j + 1 < n && outer[j + 1] && !rw.lifted[j + 1]) j++;
      if (info[j].s - info[i].s >= OVAL_RING_RUN_M) for (let k = i; k <= j; k++) onRing[k] = true;
      i = j + 1;
    }
    let runs = 0;
    // (a road through the wall: an open gate, the track's crossing to the infield)
    const openings = [];
    for (let i = 0; i < n - 1; i++) {
      if (!onRing[i] || !onRing[i + 1]) continue;
      const d = side(i) * (rw.half + 1.2);
      for (const g of wallOpenings([offsetAt(rw.nodes[i], info[i].t, d), offsetAt(rw.nodes[i + 1], info[i + 1].t, d)], rw.roads)) {
        if (openings.some((o) => Math.hypot(o.x - g.x, o.y - g.y) < g.width)) continue;
        openings.push(g);
        rw.gates.push({ ...g, prefer: Math.sign(d) || 1 });
      }
    }
    let ovalAcc = 0; let ovalNext = CONCRETE_WALL_M / 2; let ovalBroke = false;
    for (let i = 0; i < n - 1; i++) {
      if (!onRing[i] || !onRing[i + 1]) { ovalBroke = true; continue; }
      const sg = side(i);
      const d = sg * (rw.half + 1.2);
      const a0 = offsetAt(rw.nodes[i], info[i].t, d); const b0 = offsetAt(rw.nodes[i + 1], info[i + 1].t, d);
      for (const [u0, u1] of clearOf(a0, b0, openings)) {
        const a = lerpXY(a0, b0, u0); const b = lerpXY(a0, b0, u1);
        const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
        if (L < 0.05) continue;
        const ga = z(...a); const gb = z(...b);
        // the game's barrier pieces end to end (a gap starts them afresh)
        const u = [(b[0] - a[0]) / L, (b[1] - a[1]) / L];
        if (u0 > 0 || ovalBroke) { ovalNext = ovalAcc + CONCRETE_WALL_M / 2; ovalBroke = false; }
        while (ovalNext <= ovalAcc + L) {
          const t = ovalNext - ovalAcc; const p = [a[0] + u[0] * t, a[1] + u[1] * t];
          props.push({ shape: 'raceConcreteWall', x: p[0], y: p[1], z: z(...p) - 0.03, yaw: Math.atan2(u[1], u[0]) });
          ovalNext += CONCRETE_WALL_M;
        }
        ovalAcc += L;
        if (u1 < 1) ovalBroke = true;
        const fa = ga + OVAL_WALL_H; const fb = gb + OVAL_WALL_H;
        // (a post every few nodes, and one each side of an opening)
        if (i % 3 === 0 && u0 === 0) cylinder(stone, 'metalWhite', a[0], a[1], 0.06, fa, fa + 4, STEEL, { n: 6 });
        if (u0 > 0) cylinder(stone, 'metalWhite', a[0], a[1], 0.08, ga - 0.3, fa + 4, STEEL, { n: 6 });
        if (u1 < 1) cylinder(stone, 'metalWhite', b[0], b[1], 0.08, gb - 0.3, fb + 4, STEEL, { n: 6 });
        full.quad('chainlink', [a[0], a[1], fa], [b[0], b[1], fb], [b[0], b[1], fb + 4], [a[0], a[1], fa + 4], [0, 0], [L / 1.5, 0], [L / 1.5, 4 / 1.5], [0, 4 / 1.5], STEEL);
        bar(stone, 'metalWhite', [a[0], a[1], fa + 4], [b[0], b[1], fb + 4], 0.04, STEEL);
        runs++;
      }
    }
    if (runs) stats.walls++;
  }
  if (rw.kind === 'drag') {
    const nodes = dragStartFirst(rw, others, spectators);
    const inf = bends(nodes);
    // (walked from the far end: what the track's own nodes know, turned round,
    // or every wall stood on "another" track, this one)
    const turned = nodes !== rw.nodes;
    const total = inf[inf.length - 1].s;
    const r2 = { ...rw, nodes, lifted: turned ? [...rw.lifted].reverse() : rw.lifted, blocked: turned && rw.blocked ? (x, y, _, s) => rw.blocked(x, y, rw, total - s) : rw.blocked };
    // (no launch pad or start line meshes: the strip's DecalRoad projects
    // over anything under it, a pad showed through it in patches)
    const s0 = nodes[0]; const t0 = inf[0].t;
    const st = [s0[0] + t0[0] * 10, s0[1] + t0[1] * 10];
    // the light tree on the centre line just past the start (the game's own,
    // its lights facing the start line)
    const tp = [st[0] + t0[0] * 5, st[1] + t0[1] * 5]; const g = z(...tp);
    // (its lights face its local -y: that along the track toward the start)
    props.push({ shape: 'dragTree', x: tp[0], y: tp[1], z: g, yaw: Math.atan2(t0[1], t0[0]) - Math.PI / 2 });
    stats.trees++;
    // concrete walls along both sides, the whole strip (the game's barrier pieces)
    for (const sg of [-1, 1]) wallAlong(stone, 'smoothConcrete', r2, inf, 0, n - 1, sg * (rw.half + 0.6), 0.6, 0.9, z, CONCRETE, null, 1.2, { shape: 'raceConcreteWall', length: CONCRETE_WALL_M, props });
    stats.walls += 2;
  }
  return { ...stats, gates, props };
}

/** Raceway surfaces mapped as outlines (highway=raceway + area=yes): [{ ring, surface }]. */
export function planRacewayAreas(features, project) {
  const out = [];
  // the racing lines: an outline they fill little of is the venue's boundary,
  // not a surface (RedBud's whole property mapped as a raceway: a sea of dirt,
  // the track lost in it); under SURFACE_LINE_SHARE of it, the lines are the track
  const lines = [];
  for (const f of features || []) {
    const t = f?.tags || {};
    if (t.highway !== 'raceway' || t.area === 'yes' || !(f.geometry?.length >= 2)) continue;
    const w = 2 * racewayHalfWidth(t); const p = f.geometry.map((q) => project(q.lat, q.lng));
    for (let i = 0; i + 1 < p.length; i++) lines.push({ x: (p[i][0] + p[i + 1][0]) / 2, y: (p[i][1] + p[i + 1][1]) / 2, area: w * Math.hypot(p[i + 1][0] - p[i][0], p[i + 1][1] - p[i][1]) });
  }
  for (const f of features || []) {
    const t = f?.tags || {};
    // (a raceway's own outline; a motorsport track mapped as an area:
    // motocross, BMX, a tractor pull, a speedway: its dirt unless paved)
    const g = f.geometry || [];
    const closed = g.length >= 4 && Math.hypot(g[0].lat - g[g.length - 1].lat, g[0].lng - g[g.length - 1].lng) < 1e-7;
    const motor = t.leisure === 'track' && t.area !== 'no' && closed && /motor|kart|cross|speedway|bmx|tractor|dirt|stock|drag/.test(String(t.sport || '').toLowerCase());
    if (!motor && (t.highway !== 'raceway' || t.area !== 'yes' || g.length < 4)) continue;
    let ring = cleanRing(f.geometry.map((q) => project(q.lat, q.lng)));
    if (ring.length < 3) continue;
    if (signedArea(ring) < 0) ring = ring.reverse();
    const inside = lines.reduce((sum, l) => sum + (inRing(l.x, l.y, ring) ? l.area : 0), 0);
    if (inside > 0 && inside < SURFACE_LINE_SHARE * signedArea(ring)) continue;
    const surf = String(t.surface || '').toLowerCase();
    out.push({ ring, surface: UNPAVED.has(surf) || (motor && !surf) ? 'dirt' : 'asphalt', id: f.id });
  }
  return out;
}

/**
 * Untagged buildings that are a racetrack's stands: long and narrow (over
 * STAND_ASPECT : 1, under STAND_DEPTH_M deep), lying along a raceway (its
 * long side parallel to it within STAND_REACH_M), no height or levels mapped.
 * Returns the set of those features (to be built as grandstands).
 */
const STAND_ASPECT = 4; const STAND_DEPTH_M = 35; const STAND_REACH_M = 40;
export function tracksideStands(features, project, carriageways = []) {
  const out = new Set();
  const rws = carriageways.filter((c) => c.highway === 'raceway' && c.nodes?.length >= 2);
  if (!rws.length) return out;
  for (const f of features || []) {
    const t = f?.tags || {};
    // (a height Overture's outlines guessed says nothing: a mapped one does)
    const mappedHeight = t['mapng:height_source'] !== 'overture' && (t['building:levels'] || t.height);
    if (t.building !== 'yes' || mappedHeight || t.name && /\b(garage|shop|office|tower|hall)\b/i.test(t.name)) continue;
    if (!(f.geometry?.length >= 4)) continue;
    const ring = f.geometry.map((q) => project(q.lat, q.lng));
    const bx = orientedBox(ring);
    if (!bx) continue;
    const L = bx.s1 - bx.s0; const D = bx.t1 - bx.t0;
    if (D > STAND_DEPTH_M || L < STAND_ASPECT * D || L < 30) continue;
    const c = [ring.reduce((a, q) => a + q[0], 0) / ring.length, ring.reduce((a, q) => a + q[1], 0) / ring.length];
    const along = rws.some((r) => r.nodes.some((q, i) => {
      if (i + 1 >= r.nodes.length) return false;
      const b = r.nodes[i + 1]; const dx = b[0] - q[0]; const dy = b[1] - q[1]; const sl = Math.hypot(dx, dy) || 1;
      const u = Math.max(0, Math.min(1, ((c[0] - q[0]) * dx + (c[1] - q[1]) * dy) / (sl * sl)));
      if (Math.hypot(q[0] + dx * u - c[0], q[1] + dy * u - c[1]) > STAND_REACH_M + D / 2) return false;
      return Math.abs((dx * bx.u[0] + dy * bx.u[1]) / sl) > 0.9;   // parallel
    }));
    if (along) out.add(f);
  }
  return out;
}
