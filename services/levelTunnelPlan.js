// A chunked level's long tunnels, planned once for the whole level (services/chunkedExport.js). Each chunk plans the
// tunnels it sees on its own cut: where a tunnel runs out of the chunk's grid (a "free end") the planner only knows
// "under the ground there", and for a tunnel under a mountain that is hundreds of metres over the tunnel's real
// line. The level knows more: both portals of every tunnel that lies inside it, and the ground at them. A bored
// tunnel's road is the straight grade between its portals, so that line is worked out once, from the level's
// overview, and every chunk takes its free ends from it. The chunks' pieces then lie on one line whatever each of
// them sees.
//
// Positions are lat/lng; heights absolute metres.
import { metresPerDegree } from './mapFrame.js';

export const PLAN_JOIN_M = 2;        // tunnel ways whose ends are this near are one tunnel
export const PLAN_REACH_M = 4;       // a point this near a planned tunnel's line is on it
const CELL_M = 32;

const isTunnel = (tags = {}) => { const t = String(tags.tunnel ?? '').toLowerCase(); return t === 'yes'; };
const isBridge = (tags = {}) => { const b = String(tags.bridge ?? '').toLowerCase(); return !!b && b !== 'no'; };

/**
 * The plan: { tunnels: [{ pts: [{ x, y }] (metres east / north of the level's centre), s (metres along), length,
 * z0, z1 (the ground at its two ends), whole (both ends are real ends: not cut at the level's edge) }],
 * zAt(lat, lng) -> z | null (the planned road height at a point on a planned tunnel) }.
 * features: the level's map features (roads and railways with tags and geometry [{ lat, lng }]); groundAt(lat, lng):
 * the level's ground (its overview), or null where there is none; center: the level's centre; inLevel(lat, lng):
 * false for a point at or past the level's edge (a tunnel cut there has no portal to plan from); edgeProbeM: how far
 * past a tunnel's end that is asked.
 */
export function planLevelTunnels(features, { center, groundAt, inLevel = () => true, minLength = 0, edgeProbeM = 0 } = {}) {
  const k = metresPerDegree(center.lat);
  const xy = (p) => ({ x: (p.lng - center.lng) * k.lng, y: (p.lat - center.lat) * k.lat });
  // the tunnel ways, as lines in metres
  const parts = [];
  for (const f of features || []) {
    const g = f?.geometry; const tags = f?.tags || {};
    if (!Array.isArray(g) || g.length < 2 || !isTunnel(tags) || isBridge(tags)) continue;
    if (f.type !== 'road' && f.type !== 'railway') continue;
    // (a road tunnel and a railway tunnel never chain; nor do roads of different layers)
    parts.push({ pts: g.map(xy), ll: g, kind: f.type, layer: String(tags.layer ?? ''), used: false });
  }
  // chained end to end (a tunnel is often several ways: a change of name, of lanes, of speed limit)
  const near = (a, b) => (a.x - b.x) ** 2 + (a.y - b.y) ** 2 <= PLAN_JOIN_M * PLAN_JOIN_M;
  const chains = [];
  for (const p of parts) {
    if (p.used) continue;
    p.used = true;
    let pts = p.pts.slice(); let ll = p.ll.slice();
    for (let grew = true; grew;) {
      grew = false;
      for (const q of parts) {
        if (q.used || q.kind !== p.kind || q.layer !== p.layer) continue;
        const a = pts[0]; const b = pts[pts.length - 1]; const c = q.pts[0]; const d = q.pts[q.pts.length - 1];
        // (only where exactly two ends meet: a ramp joining inside a tunnel does not make the line fork)
        const add = near(b, c) ? [pts.concat(q.pts.slice(1)), ll.concat(q.ll.slice(1))]
          : near(b, d) ? [pts.concat(q.pts.slice(0, -1).reverse()), ll.concat(q.ll.slice(0, -1).reverse())]
            : near(a, d) ? [q.pts.slice(0, -1).concat(pts), q.ll.slice(0, -1).concat(ll)]
              : near(a, c) ? [q.pts.slice(1).reverse().concat(pts), q.ll.slice(1).reverse().concat(ll)] : null;
        if (!add) continue;
        [pts, ll] = add; q.used = true; grew = true;
      }
    }
    chains.push({ pts, ll, kind: p.kind });
  }
  const tunnels = [];
  for (const c of chains) {
    const s = [0]; for (let i = 1; i < c.pts.length; i++) s.push(s[i - 1] + Math.hypot(c.pts[i].x - c.pts[i - 1].x, c.pts[i].y - c.pts[i - 1].y));
    const length = s[s.length - 1]; if (!(length > minLength)) continue;
    const a = c.ll[0]; const b = c.ll[c.ll.length - 1];
    // (an end is a real end when the level goes on past it: tested edgeProbeM farther along the tunnel's own
    // direction, since a way cut at the level's edge ends exactly on it)
    const past = (i, j) => { const p = c.pts[i]; const q = c.pts[j]; const d = Math.hypot(p.x - q.x, p.y - q.y) || 1; const e = { x: p.x + ((p.x - q.x) / d) * edgeProbeM, y: p.y + ((p.y - q.y) / d) * edgeProbeM }; return { lat: center.lat + e.y / k.lat, lng: center.lng + e.x / k.lng }; };
    const pa = past(0, 1); const pb = past(c.pts.length - 1, c.pts.length - 2);
    const whole = inLevel(pa.lat, pa.lng) && inLevel(pb.lat, pb.lng);
    const z0 = groundAt(a.lat, a.lng); const z1 = groundAt(b.lat, b.lng);
    // (a tunnel cut at the level's edge, or with no ground known at an end: not planned, the chunks' own rule holds)
    if (!whole || !Number.isFinite(z0) || !Number.isFinite(z1)) continue;
    tunnels.push({ pts: c.pts, s, length, z0, z1, whole, kind: c.kind });
  }
  // a grid over the planned lines' pieces
  const grid = new Map(); const key = (cx, cy) => cx * 73856093 ^ cy * 19349663;
  tunnels.forEach((t, ti) => {
    for (let i = 0; i + 1 < t.pts.length; i++) {
      const a = t.pts[i]; const b = t.pts[i + 1];
      const x0 = Math.floor((Math.min(a.x, b.x) - PLAN_REACH_M) / CELL_M); const x1 = Math.floor((Math.max(a.x, b.x) + PLAN_REACH_M) / CELL_M);
      const y0 = Math.floor((Math.min(a.y, b.y) - PLAN_REACH_M) / CELL_M); const y1 = Math.floor((Math.max(a.y, b.y) + PLAN_REACH_M) / CELL_M);
      for (let cx = x0; cx <= x1; cx++) for (let cy = y0; cy <= y1; cy++) { const kk = key(cx, cy); let l = grid.get(kk); if (!l) { l = []; grid.set(kk, l); } l.push(ti, i); }
    }
  });
  const zAt = (lat, lng) => {
    const p = xy({ lat, lng }); const l = grid.get(key(Math.floor(p.x / CELL_M), Math.floor(p.y / CELL_M))); if (!l) return null;
    let best = PLAN_REACH_M * PLAN_REACH_M; let z = null;
    for (let j = 0; j < l.length; j += 2) {
      const t = tunnels[l[j]]; const i = l[j + 1]; const a = t.pts[i]; const b = t.pts[i + 1];
      const ux = b.x - a.x; const uy = b.y - a.y; const L2 = ux * ux + uy * uy;
      const f = L2 > 0 ? Math.max(0, Math.min(1, ((p.x - a.x) * ux + (p.y - a.y) * uy) / L2)) : 0;
      const d = (a.x + ux * f - p.x) ** 2 + (a.y + uy * f - p.y) ** 2;
      if (d <= best) { best = d; const along = t.s[i] + (t.s[i + 1] - t.s[i]) * f; z = t.z0 + ((t.z1 - t.z0) * along) / t.length; }
    }
    return z;
  };
  return { tunnels, zAt };
}
