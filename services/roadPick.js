// Road mode (refs/output/road-mode-plan.md): pick the road nearest a click and follow it both ways along connected ways
// with the same name or road number (ref) as the road picked. The roads come from a roads-only read of the map data
// (services/osm.js fetchRoadFeatures: MapNG's planet tiles first), one small read per click.
//
// A stretch is one polyline [{ lat, lng }...] with the names and refs it went through.

const DRIVABLE = new Set(['motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'unclassified', 'residential',
  'motorway_link', 'trunk_link', 'primary_link', 'secondary_link', 'tertiary_link', 'living_street', 'service', 'road', 'track']);
export const PICK_RADIUS_M = 1200;     // the box read round a click (half its side)
export const JOIN_M = 3;               // ways whose ends are this close are joined
export const MAX_PICK_M = 60;          // a click farther than this from any road picks nothing
export const ROAD_MAX_POINTS = 6000;   // a followed road kept to this many points
export const FOLLOW_MAX_TURN = (100 * Math.PI) / 180;   // a continuation turning more than this is not the road going on
/** The road classes road mode reads (services/osm.js fetchRoadFeatures `classes`). */
export const PICK_CLASSES = 'motorway|trunk|primary|secondary|tertiary|unclassified|residential|living_street|road|track|service|motorway_link|trunk_link|primary_link|secondary_link|tertiary_link';

const R = 6371008.8; const rad = Math.PI / 180;
const metres = (a, b) => { const x = (b.lng - a.lng) * rad * Math.cos(((a.lat + b.lat) / 2) * rad); const y = (b.lat - a.lat) * rad; return Math.sqrt(x * x + y * y) * R; };

/** The box (lat/lng) of half side `halfM` metres round a point. */
export function boxAround(p, halfM) {
  const dLat = halfM / 111320; const dLng = halfM / (111320 * Math.cos(p.lat * rad));
  return { north: p.lat + dLat, south: p.lat - dLat, east: p.lng + dLng, west: p.lng - dLng };
}

/** Distance (m) from p to segment ab, and the point on it. */
function toSegment(p, a, b) {
  const kx = 111320 * Math.cos(p.lat * rad); const ky = 111320;
  const ax = (a.lng - p.lng) * kx; const ay = (a.lat - p.lat) * ky; const bx = (b.lng - p.lng) * kx; const by = (b.lat - p.lat) * ky;
  const dx = bx - ax; const dy = by - ay; const L2 = dx * dx + dy * dy;
  const t = L2 > 0 ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / L2)) : 0;
  const x = ax + t * dx; const y = ay + t * dy;
  return { d: Math.sqrt(x * x + y * y), t, at: { lat: a.lat + t * (b.lat - a.lat), lng: a.lng + t * (b.lng - a.lng) } };
}

/** The drivable roads among map features: [{ id, name, ref, highway, pts }]. */
export function drivableRoads(features) {
  return (features || []).filter((f) => f?.type === 'road' && DRIVABLE.has(f.tags?.highway) && Array.isArray(f.geometry) && f.geometry.length >= 2)
    .map((f) => ({ id: String(f.id), name: f.tags?.name || '', ref: f.tags?.ref || '', highway: f.tags.highway, ...(f.tags?.junction === 'roundabout' || f.tags?.junction === 'circular' ? { roundabout: true } : {}), pts: f.geometry.map((g) => ({ lat: g.lat, lng: g.lng })) }));
}

/** The road nearest p within MAX_PICK_M, or null. */
export function nearestRoad(roads, p) {
  let best = null;
  for (const r of roads) for (let k = 1; k < r.pts.length; k++) {
    const s = toSegment(p, r.pts[k - 1], r.pts[k]);
    if (s.d <= MAX_PICK_M && (!best || s.d < best.d)) best = { road: r, d: s.d };
  }
  return best?.road || null;
}

// (names and numbers compared loosely: OSM splits one road into many ways whose tags differ in form: "I 95" and
// "I 95;US 1", "I-95", "Main St" and "main st"; any shared number or the same name is the same road)
const refTokens = (r) => String(r || '').split(/[;,/]/).map((t) => t.replace(/[\s-]+/g, '').toUpperCase()).filter(Boolean);
const normName = (n) => String(n || '').trim().toLowerCase().replace(/\s+/g, ' ');
export const sameRoad = (a, b) => {
  const ra = refTokens(a.ref); const rb = refTokens(b.ref);
  if (ra.length && rb.length && ra.some((t) => rb.includes(t))) return true;
  if (normName(a.name) && normName(a.name) === normName(b.name)) return true;
  return !a.name && !a.ref && !b.name && !b.ref && a.highway === b.highway;
};
const heading = (a, b) => Math.atan2(b.lat - a.lat, (b.lng - a.lng) * Math.cos(a.lat * rad));

/**
 * The road followed from `start` both ways: { pts, ids, names, refs, highway }.
 *
 * A way continues the road when it is the same road as the one PICKED (sameRoad with `start`, not with the last way
 * followed: comparing with the last way let the road drift, "I 95" to "I 95;US 1" to "US 1"), it starts or ends at the
 * road's end, and it does not turn back (FOLLOW_MAX_TURN: at the end of a dual carriageway the other carriageway is
 * the same road, starting at the same point, heading home). A roundabout is passed through: its ring is followed to
 * the exit that carries the picked road on, the one most nearly straight across.
 */
export function followRoad(roads, start) {
  const used = new Set([start.id]);
  let pts = start.pts.slice();
  const names = new Set([start.name].filter(Boolean)); const refs = new Set([start.ref].filter(Boolean));
  const turnOf = (h0, a, b) => { let t = Math.abs(heading(a, b) - h0); if (t > Math.PI) t = 2 * Math.PI - t; return t; };
  // the way that carries the picked road on from `end` (heading h0), or null: { r, rev, turn }
  const nextFrom = (end, h0, okRoad) => {
    let best = null;
    for (const r of roads) {
      if (used.has(r.id) || !okRoad(r)) continue;
      const n = r.pts.length;
      if (metres(r.pts[0], end) <= JOIN_M) { const turn = turnOf(h0, end, r.pts[1]); if (turn <= FOLLOW_MAX_TURN && (!best || turn < best.turn)) best = { r, rev: false, turn }; }
      if (metres(r.pts[n - 1], end) <= JOIN_M) { const turn = turnOf(h0, end, r.pts[n - 2]); if (turn <= FOLLOW_MAX_TURN && (!best || turn < best.turn)) best = { r, rev: true, turn }; }
    }
    return best;
  };
  // across a roundabout whose ring passes `end`: the ring's points to the exit that carries the picked road on, and
  // that exit: { ring: [points after end ... the exit's point], next: { r, rev } }, or null
  const across = (end, h0) => {
    let best = null;
    for (const q of roads) {
      if (!q.roundabout || used.has(q.id)) continue;
      const closed = metres(q.pts[0], q.pts[q.pts.length - 1]) <= JOIN_M;
      const ring = closed ? q.pts.slice(0, -1) : q.pts; const n = ring.length; if (n < 3) continue;
      let i = -1; for (let k = 0; k < n; k++) if (metres(ring[k], end) <= JOIN_M) { i = k; break; }
      if (i < 0) continue;
      for (let j = 0; j < n; j++) {
        if (j === i) continue;
        for (const r of roads) {
          if (used.has(r.id) || r.roundabout || !sameRoad(start, r)) continue;
          const m = r.pts.length;
          for (const rev of [false, true]) {
            const first = rev ? r.pts[m - 1] : r.pts[0]; if (metres(first, ring[j]) > JOIN_M) continue;
            // (straight across: the exit's own direction against the way we came in)
            const turn = turnOf(h0, first, rev ? r.pts[m - 2] : r.pts[1]);
            if (turn > FOLLOW_MAX_TURN || (best && turn >= best.turn)) continue;
            // the ring from i to j, the shorter way round (an open arc: the only way)
            const fwd = []; for (let k = i; k !== j;) { k = (k + 1) % n; if (!closed && k === 0 && j !== 0) { fwd.length = 0; break; } fwd.push(ring[k]); }
            const back = []; for (let k = i; k !== j;) { k = (k - 1 + n) % n; if (!closed && k === n - 1 && j !== n - 1) { back.length = 0; break; } back.push(ring[k]); }
            const len = (a) => (a.length ? cumulative([end, ...a]).at(-1) : Infinity);
            const arc = len(fwd) <= len(back) ? fwd : back; if (!arc.length) continue;
            best = { turn, ring: arc, q, next: { r, rev } };
          }
        }
      }
    }
    return best;
  };
  const grow = (atEnd) => {
    for (let guard = 0; guard < 5000; guard++) {
      const end = atEnd ? pts[pts.length - 1] : pts[0];
      const prev = atEnd ? pts[pts.length - 2] : pts[1];
      const h0 = heading(prev, end);
      let add = null;
      const best = nextFrom(end, h0, (r) => !r.roundabout && sameRoad(start, r));
      if (best) {
        used.add(best.r.id);
        add = best.rev ? best.r.pts.slice().reverse() : best.r.pts;
        if (best.r.name) names.add(best.r.name); if (best.r.ref) refs.add(best.r.ref);
      } else {
        const x = across(end, h0); if (!x) return;
        used.add(x.q.id); used.add(x.next.r.id);
        const out = x.next.rev ? x.next.r.pts.slice().reverse() : x.next.r.pts;
        add = [end, ...x.ring, ...out.slice(1)];
        if (x.next.r.name) names.add(x.next.r.name); if (x.next.r.ref) refs.add(x.next.r.ref);
      }
      // (`add` runs from the joined end outward: appended after the end, or reversed in front of the start)
      pts = atEnd ? pts.concat(add.slice(1)) : add.slice(1).reverse().concat(pts);
      if (pts.length > ROAD_MAX_POINTS) return;
    }
  };
  grow(true); grow(false);
  return { pts, ids: [...used], names: [...names], refs: [...refs], highway: start.highway };
}

/** A polyline's cumulative distances (m). */
export function cumulative(pts) {
  const s = [0]; for (let k = 1; k < pts.length; k++) s.push(s[k - 1] + metres(pts[k - 1], pts[k])); return s;
}

/** The polyline between distances a and b along it (a < b), cut exactly at both. */
export function stretchBetween(pts, a, b) {
  const s = cumulative(pts); const total = s[s.length - 1];
  const lo = Math.max(0, Math.min(a, b)); const hi = Math.min(total, Math.max(a, b));
  const at = (d) => { let k = 1; while (k < s.length - 1 && s[k] < d) k++; const t = s[k] > s[k - 1] ? (d - s[k - 1]) / (s[k] - s[k - 1]) : 0; return { k, p: { lat: pts[k - 1].lat + t * (pts[k].lat - pts[k - 1].lat), lng: pts[k - 1].lng + t * (pts[k].lng - pts[k - 1].lng) } }; };
  const A = at(lo); const B = at(hi);
  return [A.p, ...pts.slice(A.k, B.k), B.p];
}

/** The distance along the polyline of the point on it nearest p. */
export function distanceAlong(pts, p) {
  const s = cumulative(pts); let best = null;
  for (let k = 1; k < pts.length; k++) { const q = toSegment(p, pts[k - 1], pts[k]); if (!best || q.d < best.d) best = { d: q.d, along: s[k - 1] + q.t * (s[k] - s[k - 1]) }; }
  return best ? best.along : 0;
}

// ── Routing along the roads (a handle dragged beyond the stretch) ───────────────────────────────────────────────────
// OSM splits a road into many ways (bridges, junctions, carriageways, tag changes), so following by name alone stops
// early. A handle dropped anywhere is reached along the road network instead: the cheapest path from the stretch's end,
// where staying on the same road (sameRoad with the picked one) costs its length, another road of the same or a bigger
// class ROUTE_OTHER_ROAD times its length, and a smaller road ROUTE_SMALLER_ROAD times: the route keeps to the road
// picked and leaves it only where it must or where the handle was put on another road.
export const ROUTE_MAX_M = 20000;       // the farthest one drop may reach (straight line from the end)
export const ROUTE_OTHER_ROAD = 3;
export const ROUTE_SMALLER_ROAD = 8;
export const ROUTE_SNAP_M = 250;        // a drop this far from any road is not routed
const RANK = { motorway: 7, trunk: 6, primary: 5, secondary: 4, tertiary: 3, unclassified: 2, residential: 2, living_street: 1, service: 1, track: 0, road: 2 };
const rankOf = (h) => RANK[String(h || '').replace(/_link$/, '')] ?? 1;

/**
 * The path [{ lat, lng }...] along the roads from `from` to `to`, keeping to `picked` ({ name, ref, highway }) where it
 * can; null when either end is farther than ROUTE_SNAP_M from a road or the two are not connected.
 */
export function routeAlongRoads(roads, from, to, picked) {
  // the graph: a node per distinct point (ways share their junction points exactly), an edge per segment
  const key = (p) => `${p.lat.toFixed(7)},${p.lng.toFixed(7)}`;
  const id = new Map(); const pts = []; const adj = [];
  const node = (p) => { const k = key(p); let i = id.get(k); if (i === undefined) { i = pts.length; id.set(k, i); pts.push(p); adj.push([]); } return i; };
  const pr = rankOf(picked?.highway);
  for (const r of roads) {
    const f = sameRoad(picked || {}, r) ? 1 : rankOf(r.highway) >= pr ? ROUTE_OTHER_ROAD : ROUTE_SMALLER_ROAD;
    for (let k = 1; k < r.pts.length; k++) {
      const a = node(r.pts[k - 1]); const b = node(r.pts[k]); const w = metres(r.pts[k - 1], r.pts[k]) * f;
      adj[a].push([b, w]); adj[b].push([a, w]);
    }
  }
  // the start and the drop snapped onto the nearest segment (not the nearest point: a motorway's points can lie a
  // kilometre apart on a straight, and the nearest point was then a parallel road's), the segment split there by a new
  // node joined to both its ends at their share of its cost
  const segs = [];
  for (const r of roads) {
    const f = sameRoad(picked || {}, r) ? 1 : rankOf(r.highway) >= pr ? ROUTE_OTHER_ROAD : ROUTE_SMALLER_ROAD;
    for (let k = 1; k < r.pts.length; k++) segs.push([r.pts[k - 1], r.pts[k], f]);
  }
  const snap = (p) => {
    let best = null;
    for (const [a, b, f] of segs) { const q = toSegment(p, a, b); if (!best || q.d < best.q.d) best = { q, a, b, f }; }
    if (!best || best.q.d > ROUTE_SNAP_M) return -1;
    const i = node(best.q.at); const ia = node(best.a); const ib = node(best.b);
    adj[i].push([ia, metres(best.q.at, best.a) * best.f], [ib, metres(best.q.at, best.b) * best.f]);
    adj[ia].push([i, metres(best.q.at, best.a) * best.f]); adj[ib].push([i, metres(best.q.at, best.b) * best.f]);
    return i;
  };
  const s = snap(from); const t = snap(to);
  if (s < 0 || t < 0) return null;
  // Dijkstra with a binary heap
  const dist = new Float64Array(pts.length).fill(Infinity); const prev = new Int32Array(pts.length).fill(-1);
  const heap = [[0, s]]; dist[s] = 0;
  const push = (e) => { heap.push(e); let i = heap.length - 1; while (i > 0) { const j = (i - 1) >> 1; if (heap[j][0] <= heap[i][0]) break; [heap[i], heap[j]] = [heap[j], heap[i]]; i = j; } };
  const pop = () => { const top = heap[0]; const last = heap.pop(); if (heap.length) { heap[0] = last; let i = 0; for (;;) { const l = 2 * i + 1; const r2 = l + 1; let m = i; if (l < heap.length && heap[l][0] < heap[m][0]) m = l; if (r2 < heap.length && heap[r2][0] < heap[m][0]) m = r2; if (m === i) break; [heap[i], heap[m]] = [heap[m], heap[i]]; i = m; } } return top; };
  while (heap.length) {
    const [d, u] = pop(); if (d > dist[u]) continue; if (u === t) break;
    for (const [v, w] of adj[u]) if (d + w < dist[v]) { dist[v] = d + w; prev[v] = u; push([d + w, v]); }
  }
  if (!Number.isFinite(dist[t])) return null;
  const path = []; for (let u = t; u >= 0; u = prev[u]) path.push(pts[u]);
  return path.reverse();
}

/** The distance (m) from p to the polyline. */
export function distanceToLine(pts, p) {
  let best = Infinity; for (let k = 1; k < pts.length; k++) best = Math.min(best, toSegment(p, pts[k - 1], pts[k]).d); return best;
}

/** Metres between two points. */
export const metresBetween = metres;

/**
 * The polyline with points dropped that lie within tolM of the line through their neighbours (Douglas-Peucker), the
 * ends kept: a road for a share code. The tolerance is doubled until at most maxPts are left.
 */
export function simplifyPts(pts, tolM = 0.5, maxPts = 2000) {
  if (!Array.isArray(pts) || pts.length <= 2) return pts ? pts.slice() : [];
  const run = (tol) => {
    const keep = new Uint8Array(pts.length); keep[0] = 1; keep[pts.length - 1] = 1;
    const stack = [[0, pts.length - 1]];
    while (stack.length) {
      const [a, b] = stack.pop(); let best = -1; let bi = -1;
      for (let i = a + 1; i < b; i++) { const d = toSegment(pts[i], pts[a], pts[b]).d; if (d > best) { best = d; bi = i; } }
      if (best > tol) { keep[bi] = 1; stack.push([a, bi], [bi, b]); }
    }
    return pts.filter((_, i) => keep[i]);
  };
  let tol = tolM; let out = run(tol);
  while (out.length > maxPts && tol < 1000) { tol *= 2; out = run(tol); }
  return out;
}
