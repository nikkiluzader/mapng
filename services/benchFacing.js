// Which way a mapped bench looks. Nothing here knows about any place.
//
// A bench was turned to the nearest street for cars within 30 m, and east where there was none: on a riverside
// walk every bench stood end-on to the water (the Thames by the Tower). In order:
//   1. its own direction=* tag (degrees or a compass point);
//   2. water within WATER_REACH_M (a river, a lake, the sea): it looks out over the water;
//   3. the nearest path or street within WAY_REACH_M: it looks at the way it stands beside; else no opinion (null).

export const WATER_REACH_M = 25;
const WAY_REACH_M = 30;
const COMPASS = { n: 0, nne: 22.5, ne: 45, ene: 67.5, e: 90, ese: 112.5, se: 135, sse: 157.5, s: 180, ssw: 202.5, sw: 225, wsw: 247.5, w: 270, wnw: 292.5, nw: 315, nnw: 337.5,
  north: 0, east: 90, south: 180, west: 270 };

/** direction=* as a math yaw (radians from +x, counter-clockwise), or null. OSM: 0 = north, 90 = east. */
export function directionYaw(value) {
  if (value == null) return null;
  const s = String(value).trim().toLowerCase();
  const deg = s in COMPASS ? COMPASS[s] : Number.parseFloat(s);
  return Number.isFinite(deg) && /^[-+.\d]/.test(s) || s in COMPASS ? ((90 - deg) * Math.PI) / 180 : null;
}

/** The nearest point of a set of lines ([[x, y]...]) to (x, y) within reach: { x, y, d } or null. */
export function nearestOnLines(lines, x, y, reach) {
  let best = null;
  for (const line of lines) {
    const pts = line.pts || line; const box = line.box;
    if (box && (x < box[0] - reach || x > box[2] + reach || y < box[1] - reach || y > box[3] + reach)) continue;
    for (let i = 0; i + 1 < pts.length; i++) {
      const ax = pts[i][0]; const ay = pts[i][1]; const vx = pts[i + 1][0] - ax; const vy = pts[i + 1][1] - ay;
      const t = Math.max(0, Math.min(1, ((x - ax) * vx + (y - ay) * vy) / (vx * vx + vy * vy || 1e-9)));
      const px = ax + vx * t; const py = ay + vy * t; const d = Math.hypot(px - x, py - y);
      if (d <= reach && (!best || d < best.d)) best = { x: px, y: py, d };
    }
  }
  return best;
}

/** A line with its box, for nearestOnLines. */
export function boxed(pts) {
  let x0 = Infinity; let y0 = Infinity; let x1 = -Infinity; let y1 = -Infinity;
  for (const [x, y] of pts) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  return { pts, box: [x0, y0, x1, y1] };
}

/**
 * The yaw a bench at (x, y) looks along, or null. water: shore lines; ways: the paths' and streets' centre lines
 * (both as boxed lines).
 */
export function benchFacing(x, y, tags = {}, { water = [], ways = [] } = {}) {
  const tagged = directionYaw(tags.direction);
  if (tagged != null) return tagged;
  const to = (p) => Math.atan2(p.y - y, p.x - x);
  const shore = nearestOnLines(water, x, y, WATER_REACH_M);
  // (at the water's very edge the direction to the shore line is noise: there the way behind it decides, looked away from)
  if (shore && shore.d >= 0.75) return to(shore);
  const way = nearestOnLines(ways, x, y, WAY_REACH_M);
  if (shore && way && way.d >= 0.75) return to(way) + Math.PI;
  if (way && way.d >= 0.3) return to(way);
  return null;
}
