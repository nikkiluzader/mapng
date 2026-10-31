// Small water surfaces (pools, fountain basins and bowls) as WaterBlock
// rectangles: strips across the outline in its own frame (its best oriented
// box), each reaching from wall to wall and past a wall by at most `cap`
// (under the coping or the rim, which stand over the water and hide it).
// Strips of one width in a row merge: a rectangle is one block.

/** The best oriented box (by the ring's edge directions): { u (along the long side), s0, s1, t0, t1, area }. */
export function orientedBox(ring) {
  let best = null;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i]; const b = ring[(i + 1) % ring.length];
    const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (L < 0.05) continue;
    let u = [(b[0] - a[0]) / L, (b[1] - a[1]) / L];
    let s0 = Infinity; let s1 = -Infinity; let t0 = Infinity; let t1 = -Infinity;
    for (const p of ring) { const s = p[0] * u[0] + p[1] * u[1]; const t = -p[0] * u[1] + p[1] * u[0]; s0 = Math.min(s0, s); s1 = Math.max(s1, s); t0 = Math.min(t0, t); t1 = Math.max(t1, t); }
    const area = (s1 - s0) * (t1 - t0);
    if (best && area >= best.area - 1e-9) continue;
    if (t1 - t0 > s1 - s0) { u = [-u[1], u[0]]; [s0, s1, t0, t1] = [t0, t1, -s1, -s0]; }
    best = { area, u, s0, s1, t0, t1 };
  }
  return best;
}
/** World point of frame coordinates (s along u, t across). */
export const frameAt = (bx, s, t) => [bx.u[0] * s - bx.u[1] * t, bx.u[1] * s + bx.u[0] * t];

// s ranges inside a ring (in frame coordinates) along the line at t
function spansAt(st, t) {
  const xs = [];
  for (let i = 0, j = st.length - 1; i < st.length; j = i++) {
    const [si, ti] = st[i]; const [sj, tj] = st[j];
    if ((ti > t) !== (tj > t)) xs.push(si + ((t - ti) * (sj - si)) / (tj - ti));
  }
  xs.sort((a, b) => a - b);
  const out = [];
  for (let k = 0; k + 1 < xs.length; k += 2) out.push([xs[k], xs[k + 1]]);
  return out;
}

/**
 * Rectangles covering the ring: [{ cx, cy, sx, sy, u }] (u the rectangle's
 * x axis), strips h deep, past the outline by at most cap.
 */
export function coverRing(ring, { cap = 0.2, h = 0.3 } = {}) {
  const bx = orientedBox(ring);
  if (!bx) return [];
  const st = ring.map(([x, y]) => [x * bx.u[0] + y * bx.u[1], -x * bx.u[1] + y * bx.u[0]]);
  const W = bx.t1 - bx.t0;
  const n = Math.max(1, Math.ceil(W / h));
  const dh = W / n;
  const eps = Math.min(1e-4, dh / 100);
  const rows = [];
  for (let j = 0; j < n; j++) {
    const ta = bx.t0 + j * dh; const tb = ta + dh;
    const lo = spansAt(st, ta + eps); const mid = spansAt(st, ta + dh / 2); const hi = spansAt(st, tb - eps);
    for (const m of mid) {
      const near = [...lo, ...hi].filter(([a, b]) => b > m[0] && a < m[1]);
      const all = [m, ...near];
      const uL = Math.min(...all.map((q) => q[0])); const uR = Math.max(...all.map((q) => q[1]));
      // as wide as the outline gets across the strip, but past the middle
      // line's span by at most cap (at a tip, where the outline turns, the
      // strip's corners would stand out)
      const l = Math.max(uL, m[0] - cap); const r = Math.min(uR, m[1] + cap);
      if (r - l > 0.05) rows.push({ l, r, j0: j, j1: j });
    }
  }
  // strips of the same span in consecutive rows merge
  const merged = [];
  for (const q of rows) {
    const m = merged.find((p) => p.j1 === q.j0 - 1 && Math.abs(p.l - q.l) < 1e-3 && Math.abs(p.r - q.r) < 1e-3);
    if (m) m.j1 = q.j1; else merged.push({ ...q });
  }
  return merged.map((q) => {
    const ta = bx.t0 + q.j0 * dh; const tb = bx.t0 + (q.j1 + 1) * dh;
    const [cx, cy] = frameAt(bx, (q.l + q.r) / 2, (ta + tb) / 2);
    return { cx, cy, sx: q.r - q.l, sy: tb - ta, u: bx.u };
  });
}
