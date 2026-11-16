// Rows of one model filling a mapped area: a vineyard's vines, a solar farm's panel rows (services/exportBeamNGLevel.js
// places them as forest items, instanced). Nothing here knows about any place: the rows run along the area's
// longest side, a model's length apart, `pitch` metres between rows, `margin` metres in from the outline.

/** The direction (radians from +x) of a ring's longest side: the way a field's rows usually run. */
export function rowDirection(ring) {
  let best = 0; let bestLen = -1;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i]; const b = ring[(i + 1) % ring.length];
    const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (L > bestLen) { bestLen = L; best = Math.atan2(b[1] - a[1], b[0] - a[0]); }
  }
  return best;
}

const pointInRing = (x, y, r) => {
  let inside = false;
  for (let a = 0, b = r.length - 1; a < r.length; b = a++) {
    if (((r[a][1] > y) !== (r[b][1] > y)) && (x < ((r[b][0] - r[a][0]) * (y - r[a][1])) / (r[b][1] - r[a][1]) + r[a][0])) inside = !inside;
  }
  return inside;
};
const distToRing = (x, y, r) => {
  let d = Infinity;
  for (let a = 0, b = r.length - 1; a < r.length; b = a++) {
    const vx = r[a][0] - r[b][0]; const vy = r[a][1] - r[b][1]; const L = vx * vx + vy * vy || 1e-9;
    const u = Math.max(0, Math.min(1, ((x - r[b][0]) * vx + (y - r[b][1]) * vy) / L));
    d = Math.min(d, Math.hypot(r[b][0] + vx * u - x, r[b][1] + vy * u - y));
  }
  return d;
};

/**
 * The pieces of rows filling `ring` (world [x, y] points; `holes` cut out): [{ x, y, yaw }], each piece's centre and
 * its turn (its local +x along the row). `length`: one piece's length along its row; `pitch`: row to row; `margin`:
 * kept clear of the outline (a piece's whole length inside it); `cap`: at most this many.
 */
export function fillRows(ring, { holes = [], length, pitch, margin = 1, cap = Infinity, angle = rowDirection(ring) } = {}) {
  const out = [];
  if (!(ring?.length >= 3) || !(length > 0) || !(pitch > 0)) return out;
  const c = Math.cos(angle); const s = Math.sin(angle);
  // (the ring in the rows' own frame: u along the rows, v across them)
  const uv = ring.map(([x, y]) => [x * c + y * s, -x * s + y * c]);
  const u0 = Math.min(...uv.map((p) => p[0])); const u1 = Math.max(...uv.map((p) => p[0]));
  const v0 = Math.min(...uv.map((p) => p[1])); const v1 = Math.max(...uv.map((p) => p[1]));
  const ok = (x, y) => pointInRing(x, y, ring) && distToRing(x, y, ring) >= margin && !holes.some((h) => pointInRing(x, y, h) || distToRing(x, y, h) < margin);
  for (let v = v0 + margin + pitch / 2; v <= v1 - margin; v += pitch) {
    for (let u = u0 + margin + length / 2; u <= u1 - margin - length / 2 + 1e-9; u += length) {
      const x = u * c - v * s; const y = u * s + v * c;
      // (the piece's two ends inside too: no vine row hanging over the field's edge)
      const ex = (length / 2) * c; const ey = (length / 2) * s;
      if (!ok(x, y) || !ok(x - ex, y - ey) || !ok(x + ex, y + ey)) continue;
      out.push({ x, y, yaw: angle });
      if (out.length >= cap) return out;
    }
  }
  return out;
}
