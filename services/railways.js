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
// comes up (an elevated stretch, a cutting to a depot) is it built. A tunnel
// mapped on a rail or light rail line is built (a short bore under a hill).
const isUnderground = (tags) => {
  const tunnel = String(tags.tunnel ?? '').toLowerCase();
  return (tunnel && tunnel !== 'no') || tags.location === 'underground' || (Number.parseInt(tags.layer, 10) || 0) < 0;
};

/** The railway kind of an OSM way's tags ('rail', 'tram', ...), or null when it is not one we build. */
export function railKindOf(tags = {}) {
  const kind = String(tags.railway ?? '').toLowerCase();
  if (!RAIL_KIND_SET.has(kind)) return null;
  if (tags.area === 'yes') return null;
  if (LIFECYCLE_FLAGS.some((k) => tags[k] && tags[k] !== 'no')) return null;
  if (kind === 'subway' && isUnderground(tags)) return null;
  return kind;
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
export function railSegmentsFrom(features = [], { streetRunning = () => false } = {}) {
  const out = [];
  for (const f of features) {
    if (f?.type !== 'railway' || !Array.isArray(f.geometry)) continue;
    const kind = railKindOf(f.tags);
    if (!kind) continue;
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
