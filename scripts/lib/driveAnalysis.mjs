// Drive tests, pure parts: routes across a level's structures from its drawn
// lines (mapng_probes.json v3), and what a recorded drive along one says.
// Used by scripts/ingame/driveTest.mjs and tests/driveAnalysis.test.mjs.

// AI target speeds (m/s) by road class: brisk, so a step or a hump shows
const SPEED = { motorway: 25, motorway_link: 18, trunk: 22, trunk_link: 16, primary: 16, primary_link: 14, secondary: 14, secondary_link: 12, tertiary: 12, tertiary_link: 11 };
const SPEED_DEFAULT = 10;
const APPROACH_M = 70;      // road driven before and after a structure
const JOIN_M = 4;           // line ends this close continue each other
const EDGE_CLEAR_M = 60;    // routes stay this far inside the map's edge

const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const len = (p) => p.reduce((s, q, i) => (i ? s + dist(q, p[i - 1]) : 0), 0);

// up to `m` metres of a line's points walking from one end
function take(points, m) {
  const out = [points[0]];
  let s = 0;
  for (let i = 1; i < points.length && s < m; i++) { s += dist(points[i], points[i - 1]); out.push(points[i]); }
  return out;
}

/**
 * Routes over the level's structures: each deck, tunnel and steep stretch
 * with APPROACH_M of the road that continues it at either end.
 * lines: [{ k: road|deck|tunnel|sidewalk, hw, road, p: [[x, y, z]...] }].
 * offset: start each kind's list at its Nth longest (other routes);
 * worldSize: the map's width, routes kept EDGE_CLEAR_M inside its edge.
 * Returns [{ kind, road, points: [[x, y, z]...], speed, half }].
 */
export function buildRoutes(lines, { max = 12, steepGrade = 0.08, offset = 0, worldSize = 0 } = {}) {
  const drivable = lines.filter((l) => l.k !== 'sidewalk' && l.p.length >= 2 && !['footway', 'path', 'steps', 'cycleway', 'pedestrian', 'bridleway', 'track'].includes(l.road));
  // the line continuing a point (an end of another line there), best aligned
  const continuation = (pt, dir, self) => {
    let best = null;
    for (const l of drivable) {
      if (l === self) continue;
      for (const [end, pts] of [[l.p[0], l.p], [l.p[l.p.length - 1], [...l.p].reverse()]]) {
        if (dist(end, pt) > JOIN_M || pts.length < 2) continue;
        const d2 = [pts[1][0] - pts[0][0], pts[1][1] - pts[0][1]]; const n2 = Math.hypot(...d2) || 1;
        const align = (dir[0] * d2[0] + dir[1] * d2[1]) / n2;
        if (align > 0.5 && (!best || align > best.align)) best = { pts, align, road: l.road };
      }
    }
    return best;
  };
  const extend = (l) => {
    const p = l.p;
    const dEnd = [p[p.length - 1][0] - p[p.length - 2][0], p[p.length - 1][1] - p[p.length - 2][1]];
    const dStart = [p[0][0] - p[1][0], p[0][1] - p[1][1]];
    const n = (d) => { const L = Math.hypot(...d) || 1; return [d[0] / L, d[1] / L]; };
    const after = continuation(p[p.length - 1], n(dEnd), l);
    const before = continuation(p[0], n(dStart), l);
    const head = before ? take(before.pts, APPROACH_M).reverse() : [];
    const tail = after ? take(after.pts, APPROACH_M) : [];
    return [...head.slice(0, -1), ...p, ...tail.slice(1)];
  };
  // the stretch of a route clear of the map's edge (EDGE_CLEAR_M: room to
  // stop; a route run to the edge sent the car off the map) holding `mid`
  const lim = worldSize ? worldSize / 2 - EDGE_CLEAR_M : Infinity;
  const isIn = (q) => Math.abs(q[0]) <= lim && Math.abs(q[1]) <= lim;
  const inside = (pts, mid) => {
    if (!Number.isFinite(lim)) return pts;
    let m = 0; let bd = Infinity;
    pts.forEach((q, i) => { const d = dist(q, mid); if (d < bd) { bd = d; m = i; } });
    if (!isIn(pts[m])) return [];
    let a = m; while (a > 0 && isIn(pts[a - 1])) a--;
    let b = m; while (b + 1 < pts.length && isIn(pts[b + 1])) b++;
    return pts.slice(a, b + 1);
  };
  const candidates = [];
  for (const l of drivable) {
    if (l.k === 'deck' && len(l.p) >= 15) candidates.push({ kind: 'deck', l });
    else if (l.k === 'tunnel' && len(l.p) >= 20) candidates.push({ kind: 'tunnel', l });
    else if (l.k === 'road' && len(l.p) >= 40) {
      let rise = 0;
      for (let i = 1; i < l.p.length; i++) rise = Math.max(rise, Math.abs(l.p[i][2] - l.p[i - 1][2]) / (dist(l.p[i], l.p[i - 1]) || 1));
      if (rise > steepGrade) candidates.push({ kind: 'steep', l });
    }
  }
  // every kind in turn, longest first within a kind
  const byKind = new Map();
  for (const c of candidates) { if (!byKind.has(c.kind)) byKind.set(c.kind, []); byKind.get(c.kind).push(c); }
  // (offset: the Nth longest of each kind first, the ones before it last:
  // other routes over the same level)
  for (const [kind, list] of byKind) {
    list.sort((a, b) => len(b.l.p) - len(a.l.p));
    const k = list.length ? offset % list.length : 0;
    byKind.set(kind, [...list.slice(k), ...list.slice(0, k)]);
  }
  const routes = [];
  const used = [];
  while (routes.length < max && [...byKind.values()].some((l) => l.length)) {
    for (const list of byKind.values()) {
      const c = list.shift();
      if (!c || routes.length >= max) continue;
      // (not the same place twice: a parallel carriageway or a piece of one)
      const mid = c.l.p[c.l.p.length >> 1];
      if (used.some((u) => dist(u, mid) < 40)) continue;
      used.push(mid);
      const points = inside(extend(c.l), c.l.p[c.l.p.length >> 1]);
      if (points.length < 2) continue;
      routes.push({ kind: c.kind, road: c.l.road, points, speed: SPEED[c.l.road] ?? SPEED_DEFAULT, half: c.l.hw || 3 });
    }
  }
  return routes;
}

// distance from (x, y) to a polyline and the line's height and progress there
function nearestOn(points, x, y) {
  let best = { d: Infinity, z: 0, s: 0 };
  let s0 = 0;
  for (let i = 0; i + 1 < points.length; i++) {
    const [ax, ay, az] = points[i]; const [bx, by, bz] = points[i + 1];
    const dx = bx - ax; const dy = by - ay; const L2 = dx * dx + dy * dy || 1e-9; const L = Math.sqrt(L2);
    const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / L2));
    const d = Math.hypot(ax + dx * t - x, ay + dy * t - y);
    if (d < best.d) best = { d, z: az + (bz - az) * t, s: s0 + L * t };
    s0 += L;
  }
  return best;
}

/**
 * What a drive along a route says. samples: [{ t, x, y, z, vx, vy, vz }]
 * (seconds, metres, m/s), damage: { start, end } (the vehicle's damage
 * figure); settle: seconds after the start not judged. Events: bump (vertical acceleration spike), airborne (falling
 * freely), fell (under the road), off route, stuck, damaged. Returns
 * { completed, progress, events: [{ type, t, x, y, value }], maxVertAcc,
 * maxDeviation }.
 */
export function analyseDrive(route, samples, { damage = null, bumpAcc = 7, airTime = 0.25, offRouteM = 6, stuckS = 5, settle = 0 } = {}) {
  const events = [];
  const total = len(route.points);
  let progress = 0; let maxDev = 0; let maxAcc = 0;
  let still = 0; let air = 0; let lastEvent = {};
  const once = (type, t, extra) => {
    if (t - (lastEvent[type] ?? -1e9) < 2) return;   // one per 2 s per kind
    lastEvent[type] = t;
    events.push({ type, t: Math.round(t * 10) / 10, ...extra });
  };
  // vertical acceleration from velocity over 0.1 s windows
  // (the first `settle` seconds the car settles on its wheels after the
  // teleport: not judged)
  const t0 = samples.length ? samples[0].t + settle : 0;
  for (let i = 1; i < samples.length; i++) {
    const s = samples[i];
    if (s.t < t0) continue;
    const n = nearestOn(route.points, s.x, s.y);
    progress = Math.max(progress, n.s);
    maxDev = Math.max(maxDev, n.d);
    const at = { x: Math.round(s.x), y: Math.round(s.y) };
    if (n.d > offRouteM + route.half) once('off route', s.t, { ...at, value: Math.round(n.d * 10) / 10 });
    if (s.z < n.z - 3 && n.d < route.half + 2) once('fell', s.t, { ...at, value: Math.round((n.z - s.z) * 10) / 10 });
    let j = i; while (j > 0 && s.t - samples[j].t < 0.1) j--;
    const dt = s.t - samples[j].t;
    if (dt > 0.05) {
      const az = (s.vz - samples[j].vz) / dt;
      if (Math.abs(az) > maxAcc) maxAcc = Math.abs(az);
      if (Math.abs(az) > bumpAcc) once('bump', s.t, { ...at, value: Math.round(az * 10) / 10 });
      // free fall: accelerating down at nearly g
      air = az < -8 ? air + (s.t - samples[i - 1].t) : 0;
      if (air > airTime) once('airborne', s.t, { ...at, value: Math.round(air * 100) / 100 });
    }
    const speed = Math.hypot(s.vx, s.vy);
    still = speed < 0.5 && n.s < total - 10 ? still + (s.t - samples[i - 1].t) : 0;
    if (still > stuckS) once('stuck', s.t, at);
  }
  if (damage && damage.end - damage.start > 50) events.push({ type: 'damaged', t: samples.length ? samples[samples.length - 1].t : 0, value: Math.round(damage.end - damage.start) });
  return {
    completed: progress >= total - 15,
    progress: Math.round(progress), length: Math.round(total),
    events, maxVertAcc: Math.round(maxAcc * 10) / 10, maxDeviation: Math.round(maxDev * 10) / 10,
  };
}

// where the car was hit, from the drive's own log: the sharpest change of
// velocity in its last seconds, in the car's frame (its way of travel
// just before): front, rear, left / right side, underside (thrown up by a
// step); with the change in m/s
export function impactOf(samples) {
  if (samples.length < 20) return null;
  const end = samples[samples.length - 1].t;
  let best = null;
  for (let i = 5; i < samples.length; i++) {
    const a = samples[i - 5]; const b = samples[i];
    if (b.t < end - 3) continue;
    const dv = [b.vx - a.vx, b.vy - a.vy, b.vz - a.vz];
    const m = Math.hypot(...dv);
    if (!best || m > best.m) best = { m, dv, i: i - 5 };
  }
  if (!best || best.m < 1.5) return null;
  // way of travel 0.3 s before
  let k = best.i; while (k > 0 && samples[best.i].t - samples[k].t < 0.3) k--;
  const v = samples[k]; const sp = Math.hypot(v.vx, v.vy);
  if (sp < 0.5) return null;
  const f = [v.vx / sp, v.vy / sp]; const right = [f[1], -f[0]];
  const along = best.dv[0] * f[0] + best.dv[1] * f[1];
  const side = best.dv[0] * right[0] + best.dv[1] * right[1];
  const up = best.dv[2];
  const where = Math.abs(up) > Math.max(Math.abs(along), Math.abs(side)) ? (up > 0 ? 'underside' : 'landing')
    : Math.abs(along) >= Math.abs(side) ? (along < 0 ? 'front' : 'rear')
      : (side > 0 ? 'left side' : 'right side');   // pushed right: hit on its left
  return { where, dv: Math.round(best.m * 10) / 10, at: [Math.round(samples[best.i].x), Math.round(samples[best.i].y)], t: samples[best.i].t };
}
