// OSM draws a curve as a few straight edges: a round fountain's wall or the
// walk round it came out as a dozen-sided polygon. Gentle corners are cut off
// (Chaikin's corner cutting, a few passes: the line tends to the smooth curve
// through it), sharp ones (a wall's real corner) kept square, the ends kept.

const DEFAULT_PASSES = 3;
const DEFAULT_MAX_TURN_DEG = 75;
const DEFAULT_MAX_CUT_M = 2.5;   // no further back along an edge than this (a gentle bend between long walls stays a bend)

const turnAt = (a, p, b, get) => {
  const [ax, ay] = get(a); const [px, py] = get(p); const [bx, by] = get(b);
  const ux = px - ax; const uy = py - ay; const vx = bx - px; const vy = by - py;
  const lu = Math.hypot(ux, uy); const lv = Math.hypot(vx, vy);
  if (lu < 1e-12 || lv < 1e-12) return 0;
  return Math.acos(Math.max(-1, Math.min(1, (ux * vx + uy * vy) / (lu * lv))));
};

/**
 * The line with its gentle corners rounded: points of any shape, read with
 * get(p) -> [x, y] and made with lerp(p, q, t); closed when its last point
 * repeats its first (it stays closed). Corners turning more than maxTurnDeg
 * stay put, as do the ends of an open line. get's units are metres (maxCut).
 */
export function smoothLine(points, { get = (p) => p, lerp = (p, q, t) => p.map((v, i) => v + (q[i] - v) * t), passes = DEFAULT_PASSES, maxTurnDeg = DEFAULT_MAX_TURN_DEG, maxCut = DEFAULT_MAX_CUT_M } = {}) {
  if (!Array.isArray(points) || points.length < 3) return points;
  const maxTurn = (maxTurnDeg * Math.PI) / 180;
  const [fx, fy] = get(points[0]); const [lx, ly] = get(points[points.length - 1]);
  const closed = points.length > 3 && Math.hypot(fx - lx, fy - ly) < 1e-9;
  let pts = closed ? points.slice(0, -1) : points.slice();
  for (let pass = 0; pass < passes; pass++) {
    const n = pts.length;
    const out = [];
    for (let i = 0; i < n; i++) {
      const p = pts[i];
      const atEnd = !closed && (i === 0 || i === n - 1);
      const a = pts[(i - 1 + n) % n]; const b = pts[(i + 1) % n];
      if (atEnd || turnAt(a, p, b, get) > maxTurn || turnAt(a, p, b, get) < 1e-3) { out.push(p); continue; }
      // the corner cut: a quarter of the way back to each neighbour
      const len = (q) => { const [x0, y0] = get(p); const [x1, y1] = get(q); return Math.hypot(x1 - x0, y1 - y0); };
      out.push(lerp(p, a, Math.min(0.25, maxCut / len(a))), lerp(p, b, Math.min(0.25, maxCut / len(b))));
    }
    pts = out;
  }
  return closed ? [...pts, pts[0]] : pts;
}
