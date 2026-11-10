// Railways: OSM railway=* lines built as track in the level.
//
// What is a railway we build (the data step keeps it as a 'railway' feature),
// what kind it is (its grade limit, its width, its clearances), and the rail
// segments the structure solver takes alongside the roads (services/
// structures/), so a rail bridge, a rail tunnel and a road over a railway go
// through the same profile solve as the roads do. Nothing here knows about
// any place.

import { getEffectiveRoadLayer } from './roadNetwork.js';
import { RAILWAY_WAYS } from './overpassQuery.js';

// Active railways. railway=abandoned / disused / razed / construction /
// proposed are values of their own, so they never match; a line kept as
// railway=rail with disused=yes (the old lifecycle tagging) is left out too.
// (the same list the Overpass query asks for: overpassQuery.js)
export const RAIL_KINDS = RAILWAY_WAYS;
const RAIL_KIND_SET = new Set(RAIL_KINDS);
const LIFECYCLE_FLAGS = ['abandoned', 'disused', 'razed', 'demolished', 'construction', 'proposed'];

// A subway in its tunnel is underground for the whole of it: only where it
// comes up (an elevated stretch, a cutting to a depot) is it built. So are a
// light rail's, a tram's and a monorail's tunnels: a city's metro tunnel,
// stations and all, under the streets (a downtown light rail subway mapped
// as light_rail, tunnel=yes, layer=-2), which no bore of ours stands for. A
// main line's tunnel through a hill is built (a bore, as a road's).
const URBAN_KINDS = new Set(['subway', 'light_rail', 'tram', 'monorail']);
const isUnderground = (tags, kind) => {
  const tunnel = String(tags.tunnel ?? '').toLowerCase();
  if (tunnel === 'yes' || tunnel === 'flooded' || tags.location === 'underground') return true;
  // (a subway mapped on a layer below the ground, its tunnel tag left off)
  return kind === 'subway' && (Number.parseInt(tags.layer, 10) || 0) < 0 && tunnel !== 'building_passage';
};

/** The railway kind of an OSM way's tags ('rail', 'tram', ...), or null when it is not one we build. */
export function railKindOf(tags = {}) {
  const kind = activeRailKind(tags);
  if (!kind) return null;
  if (URBAN_KINDS.has(kind) && isUnderground(tags, kind)) return null;
  return kind;
}

/**
 * The kind of an active railway line, underground or not ('rail', 'subway'...),
 * or null. The data step keeps every active line (a city's metro in its
 * tunnel too: what joins a station's untagged track to the tunnels either
 * side of it, railSegmentsFrom); railKindOf picks the ones built.
 */
export function activeRailKind(tags = {}) {
  const kind = String(tags.railway ?? '').toLowerCase();
  if (!RAIL_KIND_SET.has(kind)) return null;
  if (tags.area === 'yes') return null;
  if (LIFECYCLE_FLAGS.some((k) => tags[k] && tags[k] !== 'no')) return null;
  return kind;
}

// A city line's short piece with no tunnel tag between two of its tunnels
// is underground with them (a metro station's track mapped untagged under a
// downtown street, a building passage at its platforms): as long as this at
// most, joined at each end to nothing but tunnels (or such pieces).
const TUNNEL_GAP_MAX_M = 400;

// A tunnel passing under the whole map: a main line's tunnel (any kind's)
// whose every end lies on the map's edge has no portal on the map. How deep
// it runs is in no data: its height came from the mountainside at the map's
// edges, and the valley between was bridged 60 m up (Rogers Pass, the
// Connaught and Mount Macdonald tunnels). Underground for the whole map,
// not built.
const EDGE_TOL_M = 3;
function throughTunnelIds(rail, bounds) {
  const out = new Set();
  if (!bounds) return out;
  const tagged = (f) => { const t = String(f.tags?.tunnel ?? '').toLowerCase(); return (t && t !== 'no') || f.tags?.location === 'underground'; };
  const tunnels = rail.filter(tagged);
  if (!tunnels.length) return out;
  const key = (p) => `${p.lat},${p.lng}`;
  const ends = (f) => [f.geometry[0], f.geometry[f.geometry.length - 1]];
  const at = new Map();
  for (const f of rail) for (const p of ends(f)) { if (!at.has(key(p))) at.set(key(p), []); at.get(key(p)).push(f); }
  const midLat = (bounds.north + bounds.south) / 2;
  const onEdge = (p) => Math.min(Math.abs(p.lat - bounds.north), Math.abs(p.lat - bounds.south)) * 111320 <= EDGE_TOL_M
    || Math.min(Math.abs(p.lng - bounds.east), Math.abs(p.lng - bounds.west)) * 111320 * Math.cos((midLat * Math.PI) / 180) <= EDGE_TOL_M
    || p.lat > bounds.north || p.lat < bounds.south || p.lng > bounds.east || p.lng < bounds.west;
  const seen = new Set();
  for (const start of tunnels) {
    if (seen.has(start)) continue;
    // the tunnel features joined end to end
    const chain = []; const queue = [start]; seen.add(start);
    let portal = false;
    while (queue.length) {
      const f = queue.pop(); chain.push(f);
      for (const p of ends(f)) {
        const others = (at.get(key(p)) || []).filter((o) => o !== f);
        // (an end on open track, or a dead end inside the map: a portal there)
        if (others.some((o) => !tagged(o)) || (!others.length && !onEdge(p))) portal = true;
        for (const o of others) if (tagged(o) && !seen.has(o)) { seen.add(o); queue.push(o); }
      }
    }
    if (!portal) for (const f of chain) out.add(f.id);
  }
  return out;
}

/**
 * The ids of the railway features underground: city lines (subway, light
 * rail, tram, monorail) in their tunnels, and the short untagged pieces
 * between such tunnels.
 */
export function undergroundRailIds(features = [], bounds = null) {
  const rail = features.filter((f) => f?.type === 'railway' && activeRailKind(f.tags) && f.geometry?.length >= 2);
  const under = new Set(rail.filter((f) => URBAN_KINDS.has(activeRailKind(f.tags)) && isUnderground(f.tags, activeRailKind(f.tags))).map((f) => f.id));
  for (const id of throughTunnelIds(rail, bounds)) under.add(id);
  if (!under.size) return under;
  const key = (p) => `${p.lat},${p.lng}`;
  const at = new Map();
  for (const f of rail) for (const p of [f.geometry[0], f.geometry[f.geometry.length - 1]]) {
    if (!at.has(key(p))) at.set(key(p), []);
    at.get(key(p)).push(f);
  }
  const lengthM = (g) => {
    let m = 0;
    for (let i = 1; i < g.length; i++) {
      const dy = (g[i].lat - g[i - 1].lat) * 111320;
      const dx = (g[i].lng - g[i - 1].lng) * 111320 * Math.cos((g[i].lat * Math.PI) / 180);
      m += Math.hypot(dx, dy);
    }
    return m;
  };
  for (let pass = 0; pass < 6; pass++) {
    let changed = false;
    for (const f of rail) {
      if (under.has(f.id) || !URBAN_KINDS.has(activeRailKind(f.tags))) continue;
      if ((f.tags.bridge && f.tags.bridge !== 'no') || lengthM(f.geometry) > TUNNEL_GAP_MAX_M) continue;
      const ends = [f.geometry[0], f.geometry[f.geometry.length - 1]].map((p) => (at.get(key(p)) || []).filter((o) => o !== f));
      // (both ends in tunnels: a piece running out to a dead end or the map's
      // edge from a portal is the line coming up, above ground)
      if (!ends.every((list) => list.length && list.every((o) => under.has(o.id)))) continue;
      under.add(f.id); changed = true;
    }
    if (!changed) break;
  }
  return under;
}

// The tags a rail line keeps through the data step (and the R2 tiles' tag
// trim, scripts/build-osm-tiles.py keeps every tag of a kept way).
export const RAIL_TAGS = ['railway', 'bridge', 'tunnel', 'layer', 'gauge', 'electrified', 'tracks', 'usage', 'service', 'name',
  'bridge:structure', 'bridge:name', 'tunnel:name', 'embedded', 'embedded_rails', 'location', 'cutting', 'embankment', 'ref', 'operator'];

// Steepest grade the profile solve lets each kind climb. Main-line rail is
// built at 1-2 % and tops out near 3 %; trams and light rail climb street
// hills (Lisbon's trams 13 %, most systems under 8 %); a funicular climbs
// its hillside, whatever its slope (it is pulled by a cable).
export const RAIL_GRADE_LIMIT = {
  rail: 0.025, narrow_gauge: 0.04, subway: 0.04, light_rail: 0.06, monorail: 0.06, tram: 0.07, funicular: 1,
};
// ...and the steepest each follows its terrain where the ground is steeper
// (no hillside allowance as a mountain road has: a railway on a hillside
// runs on a shelf at its own grade, in cuttings and on fills).
export const RAIL_GRADE_CEILING = {
  rail: 0.03, narrow_gauge: 0.05, subway: 0.045, light_rail: 0.08, monorail: 0.08, tram: 0.09, funicular: 1,
};
// A rail line's cuttings and fills reach further from the ground than a
// road's before it gives in and follows the terrain: a 2 % line across a
// valley is on a 10 m embankment, not down in the valley.
export const RAIL_GROUND_BAND_M = 12;

/** The structure graph's class for a rail kind (an edge's highway: 'railway:rail'). */
export const railClass = (kind) => `railway:${kind}`;
/** The rail kind of a graph edge's class, or null for a road. */
export const railKindOfClass = (highway) => (typeof highway === 'string' && highway.startsWith('railway:') ? highway.slice(8) : null);

// Track geometry (one track): rails 1.435 m apart (standard gauge), sleepers
// 2.6 m long, the ballast's top 3.4 m wide and its shoulders down 1:1.5 to
// the formation. Tracks side by side are 4 m apart (centre to centre).
export const STANDARD_GAUGE_M = 1.435;
export const TRACK_SPACING_M = 4;
export const BALLAST_TOP_HALF_M = 1.7;
// From the top of the rail (the solved profile: what a road meets at a level
// crossing) down to the formation (the terrain under the ballast): rail
// 0.17 m + sleeper 0.2 m + ballast under it 0.3 m.
export const RAIL_DEPTH_M = 0.65;
// The top of the rail over the ground the elevation data shows along a line:
// a survey sees the line's ballast and sleepers, a little under the rails,
// not its formation (which lies RAIL_DEPTH_M down, under the ballast).
export const RAIL_OVER_GROUND_M = 0.2;

/** Gauge in metres from OSM gauge=* (mm; '1435;1520' takes the first), standard gauge without one. */
export function gaugeOf(tags = {}) {
  const mm = Number.parseFloat(String(tags.gauge ?? '').split(/[;,]/)[0]);
  if (Number.isFinite(mm) && mm >= 300 && mm <= 3000) return mm / 1000;
  return tags.railway === 'narrow_gauge' ? 1.0 : STANDARD_GAUGE_M;
}

/** Number of tracks a way carries (tracks=*, 1 without it; at most 8). */
export function tracksOf(tags = {}) {
  const n = Number.parseInt(tags.tracks, 10);
  return Number.isFinite(n) && n >= 1 ? Math.min(8, n) : 1;
}

/**
 * Half width of a rail line's formation (m): its tracks side by side and
 * the ballast past the outer rails. What the structure solver's corridor,
 * deck and clearances take as the line's "half width".
 */
export function railHalfWidth(tags = {}) {
  const kind = railKindOf(tags) || 'rail';
  const scale = gaugeOf(tags) / STANDARD_GAUGE_M;
  const n = tracksOf(tags);
  // (a monorail's beam is narrow; a tram's track in a street a paved strip)
  const one = kind === 'monorail' ? 1.0 : kind === 'tram' ? 1.4 : BALLAST_TOP_HALF_M * Math.max(0.7, scale) + 0.3;
  return one + ((n - 1) * TRACK_SPACING_M * Math.max(0.7, scale)) / 2;
}

/**
 * The rail lines of the map as segments for the structure graph, shaped as
 * roadNetwork's road segments (geometry, tags, highway, layer, sourceFeature):
 * highway is the rail class ('railway:rail'), rail the kind. Trams running
 * in a street (streetRunning(feature) true) are left out: they are drawn on
 * their street's surface, not built as a line of their own.
 */
export function railSegmentsFrom(features = [], { streetRunning = () => false, bounds = null, underground = undergroundRailIds(features, bounds) } = {}) {
  const out = [];
  for (const f of features) {
    if (f?.type !== 'railway' || !Array.isArray(f.geometry)) continue;
    const kind = railKindOf(f.tags);
    if (!kind || underground.has(f.id)) continue;
    const geometry = f.geometry.filter((p) => p && Number.isFinite(Number(p.lat)) && Number.isFinite(Number(p.lng)));
    if (geometry.length < 2) continue;
    if (streetRunning(f, kind)) continue;
    out.push({
      id: `${f.id}_rail`,
      sourceFeature: f,
      geometry,
      tags: f.tags || {},
      highway: railClass(kind),
      rail: kind,
      layer: getEffectiveRoadLayer(f.tags || {}),
    });
  }
  return out;
}

// A tram or light rail line laid in a street: most of its length within its
// street's half width of the street's centreline (mapped on the street
// itself, or a few metres off it in the street's own lanes), or tagged
// embedded=yes / embedded_rails. Built as a line of its own, it was a ballast
// bed dug into the street.
const STREET_SHARE = 0.6;
const STREET_SAMPLE_M = 10;
export function streetRunningTest(roads, project) {
  // roads: [{ xy: [[x, y]...], half }] in world metres, indexed in 32 m cells
  const CELL = 32;
  const cells = new Map();
  const lines = roads.map((r) => ({ xy: r.xy, half: r.half }));
  lines.forEach((l, li) => {
    for (let i = 0; i + 1 < l.xy.length; i++) {
      const [ax, ay] = l.xy[i]; const [bx, by] = l.xy[i + 1];
      const x0 = Math.floor(Math.min(ax, bx) / CELL); const x1 = Math.floor(Math.max(ax, bx) / CELL);
      const y0 = Math.floor(Math.min(ay, by) / CELL); const y1 = Math.floor(Math.max(ay, by) / CELL);
      for (let cx = x0; cx <= x1; cx++) for (let cy = y0; cy <= y1; cy++) {
        const k = `${cx},${cy}`;
        if (!cells.has(k)) cells.set(k, []);
        cells.get(k).push(li, i);
      }
    }
  });
  const inStreet = (x, y) => {
    const list = cells.get(`${Math.floor(x / CELL)},${Math.floor(y / CELL)}`) || [];
    for (let j = 0; j < list.length; j += 2) {
      const l = lines[list[j]]; const i = list[j + 1];
      const [ax, ay] = l.xy[i]; const [bx, by] = l.xy[i + 1];
      const vx = bx - ax; const vy = by - ay; const L2 = vx * vx + vy * vy || 1e-9;
      const t = Math.max(0, Math.min(1, ((x - ax) * vx + (y - ay) * vy) / L2));
      if (Math.hypot(ax + vx * t - x, ay + vy * t - y) <= l.half + 0.5) return true;
    }
    return false;
  };
  return (feature, kind) => {
    if (kind !== 'tram' && kind !== 'light_rail') return false;
    const tags = feature.tags || {};
    // (on a bridge or in a tunnel of its own it is a line of its own)
    if ((tags.bridge && tags.bridge !== 'no') || (tags.tunnel && tags.tunnel !== 'no')) return false;
    if (tags.embedded === 'yes' || (tags.embedded_rails && tags.embedded_rails !== 'no')) return true;
    if (tags.highway) return true;   // (a street way that carries the tram itself)
    const xy = feature.geometry.map((p) => project(p.lat, p.lng));
    let n = 0; let hit = 0;
    for (let i = 0; i + 1 < xy.length; i++) {
      const [ax, ay] = xy[i]; const [bx, by] = xy[i + 1];
      const L = Math.hypot(bx - ax, by - ay);
      const k = Math.max(1, Math.ceil(L / STREET_SAMPLE_M));
      for (let j = 0; j < k; j++) {
        const f = (j + 0.5) / k;
        n++;
        if (inStreet(ax + (bx - ax) * f, ay + (by - ay) * f)) hit++;
      }
    }
    return n > 0 && hit / n >= STREET_SHARE;
  };
}
