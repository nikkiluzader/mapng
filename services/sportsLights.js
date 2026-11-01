// Floodlights for sports fields and racetracks, as real venues are lit.
//
//   stadium fields   6 poles of 27 m along the sidelines (4 on a smaller field),
//                    outside any running track
//   baseball         6 poles: two behind home, two down each foul line
//   courts           4 poles of 9-12 m along the long sides, outside the fence;
//                    neighbouring courts share them
//   grandstands      downlights along a roof
//   ovals            24 m poles round the outside of the wall every 45 m,
//                    behind a grandstand where one stands against it
//   drag strips      14 m poles down both sides of the first 700 m
//   kart tracks      10 m poles every 35 m beside the track
//   anything else    (road courses, motocross, BMX) only where OSM says lit=yes
//
// OSM's lit=no always wins. A field that usually has no lights (a cricket or
// rugby ground, a bowling green, an unmarked multi-use field) needs lit=yes or
// a grandstand beside it. Each pole is one engine light aimed into the venue.
// Pure geometry: returns plans the exporter turns into objects.

import { frameAt } from './waterCover.js';
import { inRing } from './fountains.js';
import { homePlate } from './sportsFields.js';

export const POLE_SHAPE = '/levels/driver_training/art/shapes/buildings/hr_stadium_lights.dae';
export const POLE_SHAPE_HEIGHT_M = 30.36;

// height (m), side poles per long side, setback from the outline (m), brightness (cd)
const STADIUM = { h: 27, cd: 650000 };
const COURT = { h: 11, cd: 70000 };
const LOW_COURT = { h: 9, cd: 45000 };
const FIELD_LIGHTS = {
  american_football: STADIUM, soccer: STADIUM, track: STADIUM, rugby: STADIUM, field_hockey: STADIUM, cricket: STADIUM,
  tennis: COURT, padel: LOW_COURT, pickleball: LOW_COURT, basketball: LOW_COURT, volleyball: LOW_COURT, netball: LOW_COURT,
  handball: LOW_COURT, wallball: LOW_COURT, futsal: LOW_COURT, skateboard: LOW_COURT, bowls: LOW_COURT,
};
const USUALLY_LIT = new Set(['american_football', 'soccer', 'track', 'baseball', 'softball', 'tennis', 'padel', 'pickleball', 'basketball', 'volleyball', 'netball', 'handball', 'wallball', 'futsal', 'skateboard']);
const SEATED_M = 90;
const MERGE_M = 7;          // poles this close are one (courts side by side)
const SETBACK_STEP_M = 2;
const SETBACK_MAX_M = 20;

const OVAL = { h: 24, cd: 190000, every: 45, beam: 105 };
const DRAG = { h: 14, cd: 140000, every: 50, reach: 700, beam: 85 };
const KART = { h: 10, cd: 68000, every: 35 };
const LIT_TRACK = { h: 14, cd: 140000, every: 60 };

const midOf = (p) => frameAt(p.box, (p.box.s0 + p.box.s1) / 2, (p.box.t0 + p.box.t1) / 2);

/** A place free of the rings and of what blocked(x, y) says: from (x, y) out along dir, or null. */
function clearSpot(x, y, dir, free, reach = SETBACK_MAX_M) {
  for (let d = 0; d <= reach; d += SETBACK_STEP_M) {
    const q = [x + dir[0] * d, y + dir[1] * d];
    if (free(q[0], q[1])) return q;
  }
  return null;
}

/** Field and court poles: [{ x, y, h, cd, aim: [x, y], kind }]. */
export function planFieldPoles(pitches, seating, free) {
  const poles = [];
  const add = (q, spec, aim, kind) => {
    if (!q) return;
    if (poles.some((o) => Math.hypot(o.x - q[0], o.y - q[1]) < MERGE_M && o.kind === kind)) return;
    poles.push({ x: q[0], y: q[1], h: spec.h, cd: spec.cd, aim, kind });
  };
  const tracks = pitches.filter((p) => p.sport === 'track');
  for (const p of pitches) {
    const lit = String(p.tags?.lit || '').toLowerCase();
    if (lit === 'no') continue;
    const c = midOf(p);
    const seated = (seating || []).some((st) => { const b = frameAt(st.box, (st.box.s0 + st.box.s1) / 2, (st.box.t0 + st.box.t1) / 2); return Math.hypot(b[0] - c[0], b[1] - c[1]) < SEATED_M; });
    if (lit !== 'yes' && !seated && !USUALLY_LIT.has(p.sport)) continue;
    // a field inside a running track: the track's poles light it
    if (p.sport !== 'track' && tracks.some((t) => inRing(c[0], c[1], t.ring))) continue;
    if (p.sport === 'baseball' || p.sport === 'softball') {
      const hp = homePlate(p);
      if (!hp) continue;
      const reach = Math.max(...p.ring.map((q) => (q[0] - hp.home[0]) * hp.dir[0] + (q[1] - hp.home[1]) * hp.dir[1]));
      const big = reach > 85;
      const spec = { h: big ? 24 : 20, cd: big ? 440000 : 300000 };
      const v = [-hp.dir[1], hp.dir[0]];
      const inf = [hp.home[0] + hp.dir[0] * reach * 0.42, hp.home[1] + hp.dir[1] * reach * 0.42];
      const out = [hp.home[0] + hp.dir[0] * reach * 0.8, hp.home[1] + hp.dir[1] * reach * 0.8];
      for (const sg of [-1, 1]) {
        // behind home, either side of the backstop
        add(clearSpot(hp.home[0] - hp.dir[0] * 6 + v[0] * sg * 16, hp.home[1] - hp.dir[1] * 6 + v[1] * sg * 16, [-hp.dir[0] + v[0] * sg, -hp.dir[1] + v[1] * sg], free), spec, inf, 'field');
        // and down each foul line, outside it
        for (const f of [0.5, 0.95]) {
          const a = hp.half * sg;
          const ld = [hp.dir[0] * Math.cos(a) - hp.dir[1] * Math.sin(a), hp.dir[0] * Math.sin(a) + hp.dir[1] * Math.cos(a)];
          const on = [hp.home[0] + ld[0] * reach * f, hp.home[1] + ld[1] * reach * f];
          const away = [-ld[1] * -sg, ld[0] * -sg];
          add(clearSpot(on[0] + away[0] * 6, on[1] + away[1] * 6, away, free), spec, f < 0.7 ? inf : out, 'field');
        }
      }
      continue;
    }
    const spec = FIELD_LIGHTS[p.sport];
    if (!spec) continue;
    const { s0, s1, t0, t1 } = p.box; const L = s1 - s0; const sm = (s0 + s1) / 2;
    const stadium = spec === STADIUM;
    const along = stadium ? (L >= 100 ? [-0.36, 0, 0.36] : [-0.3, 0.3]) : [-0.32, 0.32];
    const away = [-p.box.u[1], p.box.u[0]];
    for (const [t, sg] of [[t1, 1], [t0, -1]]) {
      for (const f of along) {
        const [x, y] = frameAt(p.box, sm + f * L, t);
        const dir = [away[0] * sg, away[1] * sg];
        add(clearSpot(x + dir[0] * (stadium ? 5 : 1.5), y + dir[1] * (stadium ? 5 : 1.5), dir, free), spec, frameAt(p.box, sm + f * L * 0.6, (t0 + t1) / 2), stadium ? 'field' : 'court');
      }
    }
  }
  return poles;
}

/** Downlights along the roofs of grandstands: [{ x, y, z }]. */
export function planStandLights(seating) {
  const out = [];
  for (const st of seating || []) {
    if (!st.roof || String(st.tags?.lit || '').toLowerCase() === 'no') continue;
    const bx = st.box; const L = bx.s1 - bx.s0; const D = bx.t1 - bx.t0;
    const rows = Math.max(2, Math.min(20, Math.floor(D / 0.75)));
    const z = st.z1 + 0.45 + (rows - 1) * 0.4 + 2.9;
    const n = Math.max(2, Math.round(L / 14));
    for (let i = 0; i < n; i++) {
      const [x, y] = frameAt(bx, bx.s0 + (L * (i + 0.5)) / n, (bx.t0 + bx.t1) / 2);
      out.push({ x, y, z });
    }
  }
  return out;
}

// walk a raceway every `every` m: (node index, unit tangent) of each stop up to `reach`
function stops(nodes, every, reach = Infinity) {
  const out = []; let next = 0; let s = 0;
  for (let i = 0; i + 1 < nodes.length && s <= reach; i++) {
    const a = nodes[i]; const b = nodes[i + 1]; const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
    while (L > 1e-6 && next <= s + L && next <= reach) {
      const f = (next - s) / L;
      out.push({ i, x: a[0] + (b[0] - a[0]) * f, y: a[1] + (b[1] - a[1]) * f, t: [(b[0] - a[0]) / L, (b[1] - a[1]) / L] });
      next += every;
    }
    s += L;
  }
  return out;
}

/** Racetrack poles: [{ x, y, h, cd, aim, kind }]. `free(x, y)`: nothing stands there. `startFirst(rw)`: a drag strip's nodes, start first. */
export function planTrackPoles(raceways, free, { startFirst = (rw) => rw.nodes } = {}) {
  const poles = [];
  const put = (x, y, spec, aim, kind) => {
    if (!free(x, y)) return;
    if (poles.some((o) => Math.hypot(o.x - x, o.y - y) < MERGE_M)) return;
    poles.push({ x, y, h: spec.h, cd: spec.cd, aim, kind, beam: spec.beam });
  };
  for (const rw of raceways || []) {
    const lit = String(rw.tags?.lit || '').toLowerCase();
    if (lit === 'no') continue;
    if (rw.oval) {
      for (const st of stops(rw.nodes, OVAL.every)) {
        if (!rw.oval.outer[st.i]) continue;
        // the side away from the oval's middle
        let n = [-st.t[1], st.t[0]];
        if ((rw.oval.c[0] - st.x) * n[0] + (rw.oval.c[1] - st.y) * n[1] > 0) n = [-n[0], -n[1]];
        // (behind a grandstand where one stands against the wall)
        const q = clearSpot(st.x + n[0] * (rw.half + 4), st.y + n[1] * (rw.half + 4), n, free, 60);
        if (q) put(q[0], q[1], OVAL, [st.x - n[0] * rw.half * 0.5, st.y - n[1] * rw.half * 0.5], 'oval');
      }
    } else if (rw.kind === 'drag') {
      for (const st of stops(startFirst(rw), DRAG.every, DRAG.reach)) {
        const n = [-st.t[1], st.t[0]];
        for (const sg of [-1, 1]) put(st.x + n[0] * sg * (rw.half + 3), st.y + n[1] * sg * (rw.half + 3), DRAG, [st.x + st.t[0] * 10, st.y + st.t[1] * 10], 'drag');
      }
    } else if (rw.kind === 'kart' || lit === 'yes') {
      const spec = rw.kind === 'kart' ? KART : LIT_TRACK;
      let flip = 1;
      for (const st of stops(rw.nodes, spec.every)) {
        const n = [-st.t[1] * flip, st.t[0] * flip]; flip = -flip;
        const d = rw.half + 2.5;
        put(st.x + n[0] * d, st.y + n[1] * d, spec, [st.x, st.y], rw.kind === 'kart' ? 'kart' : 'track');
      }
    }
  }
  return poles;
}

/** The engine's rotation for a beam along unit vector b (columns: right, beam, up; rows as stored). */
export function beamRotation(b) {
  const L = Math.hypot(...b) || 1; const y = b.map((v) => v / L);
  let x = [y[1], -y[0], 0]; const X = Math.hypot(...x);
  x = X > 1e-6 ? x.map((v) => v / X) : [1, 0, 0];
  const z = [x[1] * y[2] - x[2] * y[1], x[2] * y[0] - x[0] * y[2], x[0] * y[1] - x[1] * y[0]];
  return [...x, ...y, ...z].map((v) => Math.round(v * 1e6) / 1e6);
}
