// Steps in the finished terrain beside roads, as lines for retaining walls. A heightfield cannot stand vertical: where the
// shaping leaves ground a storey higher on one grid point than the next (a road on a shelf cut into a hillside, a trench
// beside a raised street, a cutting's top), the drop is drawn as a staircase along the grid, the sawtooth seen along
// raised streets and cuttings in Tignes and Val d'Isère. A wall stood on the step hides it, as real roads hold such
// ground: the step edges are traced on the grid, chained, straightened (the staircase's diagonal) and handed on as
// retaining walls (the barrier builder stands each from the low ground to just over the high side).
import { fastHypot } from './fastMath.js';

export const STEP_MIN_M = 1.5;      // neighbouring grid points this far apart in height: a step
export const STEP_MAX_M = 8;        // ... and no more (a cliff in the survey is left as it is)
export const STEP_REACH_M = 14;     // only this near a road
export const STEP_MIN_LINE_M = 6;   // a wall line at least this long
export const STEP_TILE = 64;        // grid points per scanned tile

/** Douglas-Peucker on [[x, y]...] within tol. */
export function simplifyLine(pts, tol) {
  if (pts.length < 3) return pts.slice();
  const keep = new Uint8Array(pts.length); keep[0] = 1; keep[pts.length - 1] = 1;
  const stack = [[0, pts.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop();
    const [ax, ay] = pts[a]; const [bx, by] = pts[b];
    const dx = bx - ax; const dy = by - ay; const L = fastHypot(dx, dy) || 1e-9;
    let best = -1; let bi = -1;
    for (let i = a + 1; i < b; i++) {
      const d = Math.abs((pts[i][0] - ax) * dy - (pts[i][1] - ay) * dx) / L;
      if (d > best) { best = d; bi = i; }
    }
    if (best > tol) { keep[bi] = 1; stack.push([a, bi], [bi, b]); }
  }
  return pts.filter((_, i) => keep[i]);
}

/** A moving average over 2k+1 points, the ends kept: a grid staircase becomes its diagonal. */
export function smoothLine(pts, k) {
  if (pts.length < 3) return pts.slice();
  return pts.map((p, i) => {
    if (i === 0 || i === pts.length - 1) return p;
    const a = Math.max(0, i - k); const b = Math.min(pts.length - 1, i + k);
    let x = 0; let y = 0; for (let j = a; j <= b; j++) { x += pts[j][0]; y += pts[j][1]; }
    return [x / (b - a + 1), y / (b - a + 1)];
  });
}

/**
 * The step lines: { heightMap, width, height, minHeight } over a grid of `sq` m, grid point (c, r) at
 * ((c - W/2) sq, (H - 1 - r - H/2) sq); roads: [{ nodes: [[x, y]...], half }] (only near them is looked at);
 * source: the heights before shaping (a step there already, a cliff in the survey, is not walled);
 * skip(x, y): a point not to wall (a road's own surface, under a deck, a tunnel's mouth, a building).
 * Returns [[[x, y]...]] world polylines, each straightened and at least STEP_MIN_LINE_M long.
 */
export function findTerrainSteps({ heightMap, width: W, height: H, minHeight = 0 }, sq, roads, { source = null, skip = () => false, minStep = STEP_MIN_M, maxStep = STEP_MAX_M, reach = STEP_REACH_M } = {}) {
  const T = STEP_TILE;
  const tiles = new Map();   // tile -> the road segments near it [ax, ay, bx, by, half]
  const tw = Math.ceil(W / T);
  for (const r of roads) {
    const n = r.nodes || [];
    for (let i = 0; i + 1 < n.length; i++) {
      const R = (r.half || 3) + reach;
      const c0 = Math.floor((Math.min(n[i][0], n[i + 1][0]) - R) / sq + W / 2); const c1 = Math.ceil((Math.max(n[i][0], n[i + 1][0]) + R) / sq + W / 2);
      const r0 = Math.floor(H - 1 - ((Math.max(n[i][1], n[i + 1][1]) + R) / sq + H / 2)); const r1 = Math.ceil(H - 1 - ((Math.min(n[i][1], n[i + 1][1]) - R) / sq + H / 2));
      for (let tr = Math.max(0, Math.floor(r0 / T)); tr <= Math.min(Math.ceil(H / T) - 1, Math.floor(r1 / T)); tr++) {
        for (let tc = Math.max(0, Math.floor(c0 / T)); tc <= Math.min(tw - 1, Math.floor(c1 / T)); tc++) {
          const k = tr * tw + tc; let l = tiles.get(k); if (!l) tiles.set(k, (l = []));
          l.push([n[i][0], n[i][1], n[i + 1][0], n[i + 1][1], r.half || 3]);
        }
      }
    }
  }
  const xOf = (c) => (c - W / 2) * sq; const yOf = (r) => (H - 1 - r - H / 2) * sq;
  const h = (c, r) => heightMap[r * W + c] - minHeight;
  // step edges between grid points, as segments between the cell corners round the pair (keys on a half-grid)
  const segs = [];
  let near = [];
  const nearRoad = (x, y) => {
    for (const [ax, ay, bx, by, hf] of near) {
      const dx = bx - ax; const dy = by - ay; const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy || 1)));
      if (fastHypot(ax + dx * t - x, ay + dy * t - y) <= hf + reach) return true;
    }
    return false;
  };
  const step = (c0, r0, c1, r1) => {
    const a = h(c0, r0); const b = h(c1, r1);
    const d = Math.abs(a - b);
    if (!(d > minStep && d <= maxStep)) return;
    // (only a step the shaping made: the surveyed ground there rose less than half as much)
    if (source && Math.abs(source[r0 * W + c0] - source[r1 * W + c1]) > d * 0.5) return;
    const mx = (xOf(c0) + xOf(c1)) / 2; const my = (yOf(r0) + yOf(r1)) / 2;
    if (!nearRoad(mx, my) || skip(mx, my)) return;
    // (the segment across the pair, through its midpoint)
    if (r0 === r1) segs.push([mx, my - sq / 2, mx, my + sq / 2]);
    else segs.push([mx - sq / 2, my, mx + sq / 2, my]);
  };
  for (const [t, l] of tiles) {
    near = l;
    const tr = Math.floor(t / tw); const tc = t - tr * tw;
    for (let r = tr * T; r < Math.min(H, (tr + 1) * T); r++) {
      for (let c = tc * T; c < Math.min(W, (tc + 1) * T); c++) {
        if (c + 1 < W) step(c, r, c + 1, r);
        if (r + 1 < H) step(c, r, c, r + 1);
      }
    }
  }
  if (!segs.length) return [];
  // chain the segments end to end through shared corners (only where exactly two meet: a fork ends both chains)
  const key = (x, y) => `${Math.round(x / sq * 2)},${Math.round(y / sq * 2)}`;
  const at = new Map();
  segs.forEach((s, i) => {
    for (const k of [key(s[0], s[1]), key(s[2], s[3])]) { let l = at.get(k); if (!l) at.set(k, (l = [])); l.push(i); }
  });
  const used = new Uint8Array(segs.length);
  const lines = [];
  const walk = (i, fromKey) => {
    // from segment i, leaving fromKey's end: the points onward
    const pts = [];
    if (!(i >= 0)) return pts;
    let cur = i; let prevKey = fromKey;
    for (;;) {
      used[cur] = 1;
      const s = segs[cur];
      const ka = key(s[0], s[1]);
      const [ex, ey, nk] = ka === prevKey ? [s[2], s[3], key(s[2], s[3])] : [s[0], s[1], ka];
      pts.push([ex, ey]);
      const next = (at.get(nk) || []).filter((j) => !used[j]);
      if ((at.get(nk) || []).length !== 2 || next.length !== 1) break;
      cur = next[0]; prevKey = nk;
    }
    return pts;
  };
  for (let i = 0; i < segs.length; i++) {
    if (used[i]) continue;
    const s = segs[i];
    const ka = key(s[0], s[1]); const kb = key(s[2], s[3]);
    used[i] = 1;
    const fwd = (at.get(kb) || []).length === 2 ? walk((at.get(kb) || []).find((j) => j !== i && !used[j]) ?? -1, kb) : [];
    const back = (at.get(ka) || []).length === 2 ? walk((at.get(ka) || []).find((j) => j !== i && !used[j]) ?? -1, ka) : [];
    const pts = [...back.reverse(), [s[0], s[1]], [s[2], s[3]], ...fwd];
    const line = simplifyLine(smoothLine(pts, 3), sq * 0.6);
    let L = 0; for (let k = 1; k < line.length; k++) L += fastHypot(line[k][0] - line[k - 1][0], line[k][1] - line[k - 1][1]);
    if (L >= STEP_MIN_LINE_M) lines.push(line);
  }
  return lines;
}
