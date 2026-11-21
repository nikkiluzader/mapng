// Road mode (refs/output/road-mode-plan.md): pick the road nearest a click and follow it both ways along connected ways
// with the same name or road number (ref). The roads come from the map data Generate reads (services/osm.js
// fetchOSMData: MapNG's planet tiles first, cached by services/dataCache.js), one small read per click or Extend.
//
// A stretch is one polyline [{ lat, lng }...] with the names and refs it went through; "more" at an end says the read
// area ran out there (Extend reads round that end and follows on).

const DRIVABLE = new Set(['motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'unclassified', 'residential',
  'motorway_link', 'trunk_link', 'primary_link', 'secondary_link', 'tertiary_link', 'living_street', 'service', 'road', 'track']);
export const PICK_RADIUS_M = 1200;     // the box read round a click (half its side)
export const JOIN_M = 1.5;             // ways whose ends are this close are joined
export const MAX_PICK_M = 60;          // a click farther than this from any road picks nothing
export const ROAD_MAX_POINTS = 6000;   // a followed road kept to this many points

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
    .map((f) => ({ id: String(f.id), name: f.tags?.name || '', ref: f.tags?.ref || '', highway: f.tags.highway, pts: f.geometry.map((g) => ({ lat: g.lat, lng: g.lng })) }));
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

const sameRoad = (a, b) => (a.ref && b.ref && a.ref === b.ref) || (a.name && b.name && a.name === b.name)
  || (!a.name && !a.ref && !b.name && !b.ref && a.highway === b.highway);
const heading = (a, b) => Math.atan2(b.lat - a.lat, (b.lng - a.lng) * Math.cos(a.lat * rad));

/**
 * The road followed from `start` both ways: { pts, ids, names, refs, moreAtStart, moreAtEnd }. `box`: the area read
 * (an end reaching within JOIN_M * 20 of its edge is "more there").
 */
export function followRoad(roads, start, box = null) {
  const used = new Set([start.id]);
  let pts = start.pts.slice();
  const names = new Set([start.name].filter(Boolean)); const refs = new Set([start.ref].filter(Boolean));
  const grow = (atEnd) => {
    let cur = start;
    for (let guard = 0; guard < 5000; guard++) {
      const end = atEnd ? pts[pts.length - 1] : pts[0];
      const prev = atEnd ? pts[pts.length - 2] : pts[1];
      const h0 = heading(prev, end);
      let best = null;
      for (const r of roads) {
        if (used.has(r.id) || !sameRoad(cur, r)) continue;
        for (const [first, rev] of [[r.pts[0], false], [r.pts[r.pts.length - 1], true]]) {
          if (metres(first, end) > JOIN_M) continue;
          const next = rev ? r.pts[r.pts.length - 2] : r.pts[1];
          let turn = Math.abs(heading(end, next) - h0); if (turn > Math.PI) turn = 2 * Math.PI - turn;
          if (!best || turn < best.turn) best = { r, rev, turn };
        }
      }
      if (!best) return;
      used.add(best.r.id);
      const add = best.rev ? best.r.pts.slice().reverse() : best.r.pts;
      if (best.r.name) names.add(best.r.name); if (best.r.ref) refs.add(best.r.ref);
      // (`add` runs from the joined end outward: appended after the end, or reversed in front of the start)
      pts = atEnd ? pts.concat(add.slice(1)) : add.slice(1).reverse().concat(pts);
      cur = best.r;
      if (pts.length > ROAD_MAX_POINTS) return;
    }
  };
  grow(true); grow(false);
  const nearEdge = (p) => !!box && (metres(p, { lat: box.north, lng: p.lng }) < JOIN_M * 20 || metres(p, { lat: box.south, lng: p.lng }) < JOIN_M * 20
    || metres(p, { lat: p.lat, lng: box.east }) < JOIN_M * 20 || metres(p, { lat: p.lat, lng: box.west }) < JOIN_M * 20);
  return { pts, ids: [...used], names: [...names], refs: [...refs], highway: start.highway, moreAtStart: nearEdge(pts[0]), moreAtEnd: nearEdge(pts[pts.length - 1]) };
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
