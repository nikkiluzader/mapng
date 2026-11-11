/**
 * Road width estimation shared by the BeamNG export and the heightmap road
 * smoother.
 *
 * Both consumers must agree: the export draws a DecalRoad of a given width,
 * and the smoother has to flatten the terrain under exactly that footprint.
 * When they disagreed (the smoother used a fixed 6 m corridor) a motorway's
 * outer lanes sat on unflattened terrain and kept most of the original
 * cross-slope, so "Level Roads" looked like it did nothing on big roads.
 */

/**
 * Highway classes that never become a driveable road in the export.
 *
 * Shared so the terrain side agrees with the drawing side: carving a flat
 * bench along a hiking trail leaves a terrace in the hillside with no road on
 * it, which is worse than leaving the trail on natural ground.
 */
export const NON_DRIVEABLE_HIGHWAYS = new Set([
  'footway', 'path', 'pedestrian', 'steps', 'cycleway',
  'bridleway', 'corridor', 'proposed', 'construction',
]);

/**
 * Parse a strictly positive integer, returning 0 when invalid.
 */
function parsePositiveInt(value) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

/**
 * Clamp a numeric value to the inclusive [min, max] range.
 */
function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

/**
 * Parse OSM width-style values to meters.
 *
 * Supports values like "12", "12 m", and "40 ft". Unit-less large values
 * above 40 are interpreted as feet, matching common OSM tagging practice.
 */
export function parseRoadWidthMeters(value) {
  if (!value) return null;
  const raw = String(value).trim().toLowerCase();

  if (raw.includes('ft')) {
    const parsed = Number.parseFloat(raw.replace('ft', '').trim());
    return Number.isFinite(parsed) && parsed > 0 ? parsed * 0.3048 : null;
  }

  if (raw.includes('m')) {
    const parsed = Number.parseFloat(raw.replace('m', '').trim());
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
  }

  const parsed = Number.parseFloat(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;

  // OSM width values above ~40 without units are commonly feet.
  return parsed > 40 ? parsed * 0.3048 : parsed;
}

/**
 * Return a class-based default lane width in meters.
 */
export function getDefaultLaneWidthMeters(highway) {
  if (['motorway', 'motorway_link', 'trunk', 'trunk_link'].includes(highway)) return 3.7;
  if (['primary', 'primary_link', 'secondary', 'secondary_link'].includes(highway)) return 3.5;
  if (['tertiary', 'tertiary_link'].includes(highway)) return 3.25;
  if (['service', 'track'].includes(highway)) return 2.8;
  return 3.0;
}

/**
 * Return a class-based default lane count, adjusted for one-way roads.
 */
export function getDefaultLaneCount(highway, isOneWay) {
  if (['motorway', 'trunk'].includes(highway)) return isOneWay ? 2 : 4;
  if (['motorway_link', 'trunk_link', 'primary_link', 'secondary_link', 'tertiary_link'].includes(highway)) {
    return 1;
  }
  if (['service', 'track'].includes(highway)) return 1;
  return isOneWay ? 1 : 2;
}

/**
 * Return min/max half-width bounds for a given highway class.
 */
// A width measured between a street's buildings (streetWidths.js) may be
// narrower than the class minimum: an old town's or Tokyo's one-lane street.
const MEASURED_MIN_HALF_M = 1.5;

export function getRoadHalfWidthClamp(highway) {
  if (['motorway', 'motorway_link', 'trunk', 'trunk_link'].includes(highway)) {
    return { min: 3.5, max: 9.0 };
  }
  if (['primary', 'primary_link', 'secondary', 'secondary_link'].includes(highway)) {
    return { min: 2.8, max: 6.0 };
  }
  if (['service', 'track'].includes(highway)) {
    return { min: 1.8, max: 3.5 };
  }
  if (highway === 'raceway') return { min: 1.5, max: 12 };
  return { min: 2.2, max: 5.0 };
}

// Racing: highway=raceway by kind (racewayKind), their usual paved widths.
// mapng:raceway is set by the exporter where the geometry says more than the
// tags (a long dead-straight raceway: a drag strip).
const UNPAVED_RACE = new Set(['dirt', 'clay', 'ground', 'earth', 'unpaved', 'gravel', 'sand', 'mud', 'compacted', 'grass']);
const RACEWAY_HALF_M = { drag: 6, dirt: 8, kart: 4, moto: 2.5, pit: 3.5, circuit: 6 };
/** The kind of a raceway: drag | dirt | kart | moto | pit | circuit. */
export function racewayKind(tags = {}) {
  const k = String(tags['mapng:raceway'] || '').toLowerCase();
  if (RACEWAY_HALF_M[k]) return k;
  const sport = String(tags.sport || '').toLowerCase(); const raceway = String(tags.raceway || '').toLowerCase();
  const name = String(tags.name || '').toLowerCase();
  if (/drag/.test(raceway) || /drag/.test(sport) || /drag ?strip|dragway/.test(name)) return 'drag';
  if (/pit/.test(raceway) || /\bpit\b|pit lane|pitlane/.test(name)) return 'pit';
  if (/motocross|mx|enduro|supercross|bmx/.test(sport) || raceway === 'motocross') return 'moto';
  if (/kart/.test(sport) || /kart/.test(raceway)) return 'kart';
  if (UNPAVED_RACE.has(String(tags.surface || '').toLowerCase())) return 'dirt';
  return 'circuit';
}
// a motorsport / BMX racing line mapped as leisure=track rather than a raceway
const TRACK_LINE_SPORT = /motor|kart|motocross|supercross|enduro|bmx|speedway|autocross|rallycross|dirt/;
export const isRacingTrackLine = (tags = {}) => tags.leisure === 'track' && !tags.highway && tags.area !== 'yes' && TRACK_LINE_SPORT.test(String(tags.sport || '').toLowerCase());
export const racewayHalfWidth = (tags = {}) => RACEWAY_HALF_M[racewayKind(tags)];

const TAGGED_LANES_MAX = 10;
/**
 * Estimate road half-width in meters from OSM tags and roadway class.
 *
 * Priority: explicit `width` tag -> lane-based estimate -> style fallback,
 * always clamped to class-specific practical limits.
 */
export function estimateRoadHalfWidth(tags = {}, highway, isOneWay = false, fallbackHalfWidth = 3.5) {
  const explicitWidth = parseRoadWidthMeters(tags.width);
  const limits = getRoadHalfWidthClamp(highway);
  if (Number.isFinite(explicitWidth) && explicitWidth > 0) {
    return clamp(explicitWidth / 2, limits.min, limits.max);
  }
  // a raceway by its kind (a circuit 12 m, a dirt oval 16, a kart track 8), not by lanes
  if (highway === 'raceway') return clamp(racewayHalfWidth(tags), limits.min, limits.max);

  const lanesFromTotal = parsePositiveInt(tags.lanes);
  const lanesFromDir = parsePositiveInt(tags['lanes:forward']) + parsePositiveInt(tags['lanes:backward']);
  const inferredLanes = Math.max(
    getDefaultLaneCount(highway, isOneWay),
    lanesFromTotal || lanesFromDir || 0,
  );
  const estimatedHalf = (inferredLanes * getDefaultLaneWidthMeters(highway)) / 2;
  // lanes counted by the mapper are kept: the class maximum is for roads with no count (a
  // six-lane primary squeezed into 12 m had 2 m lanes), up to TAGGED_LANES_MAX of them
  const tagged = Math.min(lanesFromTotal || lanesFromDir || 0, TAGGED_LANES_MAX);
  const max = Math.max(limits.max, (tagged * getDefaultLaneWidthMeters(highway)) / 2);

  return clamp(estimatedHalf || fallbackHalfWidth, limits.min, max);
}

/**
 * Whether a way is one-way, which halves the inferred lane count.
 */
export function isOneWayRoad(tags = {}) {
  const value = String(tags.oneway ?? '').trim().toLowerCase();
  if (value === 'yes' || value === '1' || value === 'true') return true;
  if (value === '-1' || value === 'reverse') return true;
  if (tags.junction === 'roundabout') return true;
  if (tags.highway === 'motorway' || tags.highway === 'motorway_link') return true;
  return false;
}

// ── Carriageway: driving width + parking lanes / shoulders ──────────────────
//
// estimateRoadHalfWidth() is the DRIVING width (lanes × lane width). Real
// roads are paved wider than that: city streets carry parking lanes, rural
// roads a paved edge strip. Measured from BeamNG's own levels (BeamNG.Earth's
// road study, refs/BeamNG.Earth-main/docs/research/2026-10-11-official-road-
// study.md §2): rural paved surface ≈ AI width + 2–2.5 m; West Coast USA's
// plain streets are 12.5 m paved for 8 m of driving, ~2.3 m parking a side.
//
// OSM draws a way down the middle of the whole carriageway, so the asphalt is
// centred on the way and an asymmetric extra (parking one side) shifts the
// driving lanes instead (laneShift).

export const PARKING_LANE_M = 2.3;
export const EDGE_STRIP_M = 1.0;

// Classes whose urban stretches get default kerbside parking.
const PARKING_CLASSES = new Set([
  'residential', 'tertiary', 'secondary', 'unclassified', 'living_street',
]);

// Classes with no default paved shoulder (narrow lanes, ramps, private ways).
const NO_SHOULDER_CLASSES = new Set([
  'service', 'track', 'living_street', 'busway', 'raceway',
  'motorway_link', 'trunk_link', 'primary_link', 'secondary_link', 'tertiary_link',
]);

const UNPAVED = new Set([
  'unpaved', 'dirt', 'gravel', 'fine_gravel', 'ground', 'grass', 'sand', 'earth', 'mud', 'compacted',
]);

// parking:<side>=* (2022 scheme) and parking:lane:<side>=* (legacy) values
// that put cars on the carriageway, with the width they take.
const PARKING_ON_CARRIAGEWAY_M = {
  lane: PARKING_LANE_M, street_side: PARKING_LANE_M, parallel: PARKING_LANE_M,
  marked: PARKING_LANE_M, yes: PARKING_LANE_M,
  diagonal: 4.5, perpendicular: 5.0,
};
const PARKING_ORIENTATION_M = { parallel: PARKING_LANE_M, diagonal: 4.5, perpendicular: 5.0 };
// Explicitly no parking on the carriageway (on_kerb / separate lots included).
const PARKING_NONE = new Set([
  'no', 'none', 'separate', 'on_kerb', 'shoulder', 'no_parking', 'no_stopping', 'fire_lane', 'no_standing',
]);

function tagFor(tags, keys) {
  for (const key of keys) {
    const value = tags[key];
    if (value !== undefined && value !== null && String(value).trim() !== '') {
      return String(value).trim().toLowerCase();
    }
  }
  return null;
}

/**
 * Metres of parking on one side ('left' | 'right') of the carriageway from
 * OSM tags, or null when the side is untagged.
 */
export function parseParkingSideMeters(tags = {}, side) {
  const value = tagFor(tags, [`parking:${side}`, 'parking:both', `parking:lane:${side}`, 'parking:lane:both']);
  if (value === null) return null;
  if (PARKING_NONE.has(value)) return 0;
  if (value === 'half_on_kerb') return PARKING_LANE_M / 2;
  const orientation = tagFor(tags, [`parking:${side}:orientation`, 'parking:both:orientation']);
  if (orientation && PARKING_ORIENTATION_M[orientation]) return PARKING_ORIENTATION_M[orientation];
  return PARKING_ON_CARRIAGEWAY_M[value] ?? null;
}

/**
 * Metres of paved shoulder on one side from shoulder=* tags, or null when
 * untagged.
 */
export function parseShoulderSideMeters(tags = {}, side) {
  const width = parseRoadWidthMeters(tagFor(tags, [`shoulder:${side}:width`, 'shoulder:both:width', 'shoulder:width']));
  const value = tagFor(tags, [`shoulder:${side}`, 'shoulder:both', 'shoulder']);
  if (value === null) return Number.isFinite(width) ? width : null;
  if (value === 'no' || value === 'none') return 0;
  const onThisSide = value === 'yes' || value === 'both' || value === side;
  if (!onThisSide && (value === 'left' || value === 'right')) return 0;
  return Number.isFinite(width) ? width : EDGE_STRIP_M;
}

/**
 * The features with no parking assumed: a street of the classes that get a
 * default kerbside lane, with no parking tags of its own, is given
 * parking:both=no, so every later step (widths, parked cars, paint) takes it
 * as mapped that way. Fine-tuning's "Assume street parking" off; the export
 * applies it to its own copy of the data. Tagged parking is left alone.
 * Returns { features, changed }.
 */
export function withoutAssumedParking(features) {
  if (!Array.isArray(features)) return { features, changed: 0 };
  let changed = 0;
  const out = features.map((f) => {
    const t = f?.tags;
    if (f?.type !== 'road' || !t || !PARKING_CLASSES.has(t.highway)) return f;
    if (parseParkingSideMeters(t, 'left') !== null && parseParkingSideMeters(t, 'right') !== null) return f;
    changed++;
    return { ...f, tags: { ...t, 'parking:both': 'no', 'mapng:parking': 'not_assumed' } };
  });
  return changed ? { features: out, changed } : { features, changed: 0 };
}

/**
 * The parking on one side of a road ('left' | 'right' of its node order),
 * by the same rules as its cross-section: { orientation } when cars park in
 * that side's extra width (tagged, or the urban default lane), else null
 * (a shoulder, an edge strip, nothing). orientation: 'parallel' |
 * 'diagonal' | 'perpendicular'.
 */
export function streetParkingSide(tags = {}, highway, isOneWay = false, { urban = false } = {}, side) {
  const parking = parseParkingSideMeters(tags, side);
  const orientationOf = () => {
    const value = tagFor(tags, [`parking:${side}`, 'parking:both', `parking:lane:${side}`, 'parking:lane:both']);
    const o = tagFor(tags, [`parking:${side}:orientation`, 'parking:both:orientation']) || value;
    return o === 'diagonal' || o === 'perpendicular' ? o : 'parallel';
  };
  if (parking !== null) return parking > 0 ? { orientation: orientationOf() } : null;
  if (parseShoulderSideMeters(tags, side) !== null) return null;
  const paved = !UNPAVED.has(String(tags.surface || '').toLowerCase()) && highway !== 'track';
  return paved && urban && !isOneWay && PARKING_CLASSES.has(highway) ? { orientation: 'parallel' } : null;
}

/**
 * Full cross-section of a road.
 *
 * Returns { drivingHalfWidth, leftExtra, rightExtra, carriagewayHalfWidth,
 * laneShift } in metres; left/right are relative to the way's node order and
 * laneShift is how far the driving lanes sit to the LEFT of the way (negative
 * = right), matching offsetNodes' sign convention.
 *
 * Tags win over defaults per side: parking:* / parking:lane:*, shoulder*,
 * and width (taken as the whole carriageway, parking included). Without tags,
 * urban two-way streets of PARKING_CLASSES get a parking lane each side and
 * rural paved roads an EDGE_STRIP_M strip each side.
 */
export function estimateRoadCrossSection(tags = {}, highway, isOneWay = false, { urban = false, fallbackHalfWidth = 3.5 } = {}) {
  const paved = !UNPAVED.has(String(tags.surface || '').toLowerCase()) && highway !== 'track';
  const extraFor = (side) => {
    const parking = parseParkingSideMeters(tags, side);
    if (parking !== null && parking > 0) return parking;
    const shoulder = parseShoulderSideMeters(tags, side);
    if (shoulder !== null) return shoulder;
    if (parking === 0) return 0;
    if (!paved) return 0;
    if (urban) return (!isOneWay && PARKING_CLASSES.has(highway)) ? PARKING_LANE_M : 0;
    return NO_SHOULDER_CLASSES.has(highway) ? 0 : EDGE_STRIP_M;
  };
  let leftExtra = extraFor('left');
  let rightExtra = extraFor('right');

  let drivingHalfWidth = estimateRoadHalfWidth(tags, highway, isOneWay, fallbackHalfWidth);
  const explicitWidth = parseRoadWidthMeters(tags.width);
  let carriagewayHalfWidth;
  if (Number.isFinite(explicitWidth) && explicitWidth > 0) {
    // width= is the whole carriageway. Keep only TAGGED extras inside it;
    // defaults would invent parking the mapper already measured.
    const limits = getRoadHalfWidthClamp(highway);
    carriagewayHalfWidth = clamp(explicitWidth / 2, limits.min, limits.max + PARKING_LANE_M);
    const taggedExtra = (side) => {
      const parking = parseParkingSideMeters(tags, side);
      if (parking !== null) return parking;
      return parseShoulderSideMeters(tags, side) ?? 0;
    };
    leftExtra = taggedExtra('left');
    rightExtra = taggedExtra('right');
    drivingHalfWidth = Math.max(limits.min, carriagewayHalfWidth - (leftExtra + rightExtra) / 2);
    carriagewayHalfWidth = drivingHalfWidth + (leftExtra + rightExtra) / 2;
  } else {
    carriagewayHalfWidth = drivingHalfWidth + (leftExtra + rightExtra) / 2;
    // the curb-to-curb width measured between the street's buildings
    // (streetWidths.js) fitted onto the default lanes and extras: narrower,
    // the parking / shoulders give way first, then the lanes (to the measured
    // minimum); wider, the extras grow and the lanes stay
    const measured = parseRoadWidthMeters(tags['mapng:carriageway_width']);
    if (Number.isFinite(measured) && measured > 0) {
      const half = measured / 2;
      const extras = (leftExtra + rightExtra) / 2;
      if (half < carriagewayHalfWidth) {
        const keepExtras = Math.max(0, half - drivingHalfWidth);
        const f = extras > 0 ? Math.min(1, keepExtras / extras) : 0;
        leftExtra *= f; rightExtra *= f;
        drivingHalfWidth = Math.max(Math.min(drivingHalfWidth, MEASURED_MIN_HALF_M), half - (leftExtra + rightExtra) / 2);
      } else if (extras > 0) {
        const f = (half - drivingHalfWidth) / extras;
        leftExtra *= f; rightExtra *= f;
      } else {
        leftExtra = rightExtra = half - drivingHalfWidth;
      }
      carriagewayHalfWidth = drivingHalfWidth + (leftExtra + rightExtra) / 2;
    }
  }

  // a cap only (twinCarriageways.js: a divided road's carriageway fitted beside its twin): narrower,
  // the extras give way first, then the lanes, to the cap; never wider
  const cap = parseRoadWidthMeters(tags['mapng:carriageway_max']);
  if (Number.isFinite(cap) && cap > 0 && cap / 2 < carriagewayHalfWidth) {
    const half = cap / 2;
    const extras = (leftExtra + rightExtra) / 2;
    const keepExtras = Math.max(0, half - drivingHalfWidth);
    const f = extras > 0 ? Math.min(1, keepExtras / extras) : 0;
    leftExtra *= f; rightExtra *= f;
    drivingHalfWidth = Math.min(drivingHalfWidth, half - (leftExtra + rightExtra) / 2);
    carriagewayHalfWidth = drivingHalfWidth + (leftExtra + rightExtra) / 2;
  }

  return {
    drivingHalfWidth,
    leftExtra,
    rightExtra,
    carriagewayHalfWidth,
    laneShift: (rightExtra - leftExtra) / 2,
  };
}

// ── Urban detection from building footprints ────────────────────────────────
//
// Built-up streets are lined by buildings; that is the cheapest reliable
// signal we have in every export (BeamNG.Earth uses ESA WorldCover's built-up
// class for the same decision).

const URBAN_CELL_M = 50;
const URBAN_SAMPLE_M = 25;
const URBAN_RADIUS_M = 45;
const URBAN_MIN_BUILDINGS = 3;
const URBAN_SHARE = 0.5;
const URBAN_OUTLINE_STEP_M = 10;
const M_PER_DEG_LAT = 111320;

/**
 * Build a classifier `(roadFeature) => boolean` that is true when most of the
 * road runs past at least URBAN_MIN_BUILDINGS buildings within
 * URBAN_RADIUS_M. Results are memoised per feature id.
 */
// Land uses a town's streets run through, and the speed over which a road there is no street.
const TOWN_LAND = new Set(['commercial', 'retail']);   // (residential land reaches far out along country lanes)
const TOWN_MAX_KMH = 72;
const LAND_CELL_DEG = 0.005;
const STREET_TOWN_SHARE = 0.6;

/**
 * Is a road a curbed town street: built up, lit, or through town land at town
 * speed. Wider than buildUrbanRoadClassifier, which counts buildings beside the
 * road and so misses a street along a park, a car park or a vacant block.
 */
export function buildCurbedStreetClassifier(osmFeatures = []) {
  const urban = buildUrbanRoadClassifier(osmFeatures);
  const cells = new Map();
  for (const f of osmFeatures) {
    if (!TOWN_LAND.has(f?.tags?.landuse) || !(f.geometry?.length > 2)) continue;
    const lats = f.geometry.map((p) => p.lat); const lngs = f.geometry.map((p) => p.lng);
    const box = [Math.min(...lats), Math.max(...lats), Math.min(...lngs), Math.max(...lngs)];
    for (let i = Math.floor(box[0] / LAND_CELL_DEG); i <= Math.floor(box[1] / LAND_CELL_DEG); i++) {
      for (let j = Math.floor(box[2] / LAND_CELL_DEG); j <= Math.floor(box[3] / LAND_CELL_DEG); j++) {
        const key = `${i},${j}`;
        if (!cells.has(key)) cells.set(key, []);
        cells.get(key).push(f.geometry);
      }
    }
  }
  const inside = (ring, p) => {
    let hit = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const a = ring[i]; const b = ring[j];
      if ((a.lat > p.lat) !== (b.lat > p.lat) && p.lng < ((b.lng - a.lng) * (p.lat - a.lat)) / (b.lat - a.lat) + a.lng) hit = !hit;
    }
    return hit;
  };
  const speed = (tags) => {
    const m = String(tags?.maxspeed ?? '').match(/(\d+(?:\.\d+)?)\s*(mph)?/i);
    return m ? Number(m[1]) * (m[2] ? 1.609 : 1) : null;
  };
  const inTown = (feature) => {
    if (urban(feature) || String(feature?.tags?.lit).toLowerCase() === 'yes') return true;
    if ((speed(feature?.tags) ?? 0) > TOWN_MAX_KMH) return false;
    const g = feature?.geometry || [];
    if (!g.length) return false;
    // (a few points along it: a short way's middle can fall just outside the land)
    const stride = Math.max(1, Math.floor(g.length / 5));
    for (let i = 0; i < g.length; i += stride) {
      const p = g[i];
      if ((cells.get(`${Math.floor(p.lat / LAND_CELL_DEG)},${Math.floor(p.lng / LAND_CELL_DEG)}`) || []).some((ring) => inside(ring, p))) return true;
    }
    return false;
  };
  // a named street is curbed as a whole: its stretch past a vacant lot too
  const streets = new Map();
  for (const f of osmFeatures) {
    const name = f?.type === 'road' ? f.tags?.name : null;
    if (!name || !(f.geometry?.length > 1)) continue;
    const s = streets.get(name) ?? { town: 0, all: 0 };
    const n = f.geometry.length; s.all += n; if (inTown(f)) s.town += n;
    streets.set(name, s);
  }
  return (feature) => {
    if (inTown(feature)) return true;
    if ((speed(feature?.tags) ?? 0) > TOWN_MAX_KMH) return false;
    const s = streets.get(feature?.tags?.name);
    return !!s && s.town >= STREET_TOWN_SHARE * s.all;
  };
}

export function buildUrbanRoadClassifier(osmFeatures = []) {
  // each building by points along its outline (every URBAN_OUTLINE_STEP_M),
  // so a block of big buildings counts as near the street it fronts (a hotel
  // or a college hall filling a block had its centre over 45 m from it)
  const outlines = [];
  let latSum = 0;
  for (const f of osmFeatures) {
    if (f?.type !== 'building' || !Array.isArray(f.geometry) || f.geometry.length < 3) continue;
    const ring = f.geometry.filter((p) => Number.isFinite(p?.lat) && Number.isFinite(p?.lng));
    if (ring.length < 3) continue;
    outlines.push(ring);
    latSum += ring[0].lat;
  }
  const cache = new Map();
  if (outlines.length === 0) return () => false;

  const cosLat = Math.cos((latSum / outlines.length) * Math.PI / 180) || 1;
  const toXY = (lat, lng) => [lng * M_PER_DEG_LAT * cosLat, lat * M_PER_DEG_LAT];
  const grid = new Map();
  outlines.forEach((ring, id) => {
    const pts = ring.map((p) => toXY(p.lat, p.lng));
    const seen = new Set();
    const put = (x, y) => {
      const key = `${Math.floor(x / URBAN_CELL_M)},${Math.floor(y / URBAN_CELL_M)}`;
      const cell = grid.get(key);
      if (cell) cell.push([x, y, id]); else grid.set(key, [[x, y, id]]);
      seen.add(key);
    };
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i]; const b = pts[(i + 1) % pts.length];
      const n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / URBAN_OUTLINE_STEP_M));
      for (let k = 0; k < n; k++) put(a[0] + ((b[0] - a[0]) * k) / n, a[1] + ((b[1] - a[1]) * k) / n);
    }
  });
  const countNear = (x, y) => {
    const cx = Math.floor(x / URBAN_CELL_M);
    const cy = Math.floor(y / URBAN_CELL_M);
    const r2 = URBAN_RADIUS_M * URBAN_RADIUS_M;
    const found = new Set();
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        for (const [bx, by, id] of grid.get(`${cx + dx},${cy + dy}`) || []) {
          if (!found.has(id) && (bx - x) ** 2 + (by - y) ** 2 <= r2) {
            found.add(id);
            if (found.size >= URBAN_MIN_BUILDINGS) return found.size;
          }
        }
      }
    }
    return found.size;
  };

  // [samples, urban samples] along a way's line
  const tally = (geometry) => {
    const pts = (geometry || []).map((p) => toXY(p.lat, p.lng));
    let samples = 0;
    let urbanSamples = 0;
    const visit = (x, y) => {
      samples++;
      if (countNear(x, y) >= URBAN_MIN_BUILDINGS) urbanSamples++;
    };
    for (let i = 0; i < pts.length - 1; i++) {
      const [ax, ay] = pts[i];
      const [bx, by] = pts[i + 1];
      const len = Math.hypot(bx - ax, by - ay);
      const steps = Math.max(1, Math.ceil(len / URBAN_SAMPLE_M));
      for (let s = 0; s < steps; s++) {
        const t = s / steps;
        visit(ax + (bx - ax) * t, ay + (by - ay) * t);
      }
    }
    if (pts.length > 0) visit(...pts[pts.length - 1]);
    return [samples, urbanSamples];
  };
  // OSM cuts a street into pieces wherever a tag changes: a 15 m piece
  // between a park and one big hotel judged alone read as countryside in a
  // town centre. A way is judged with the pieces of the same street joined
  // to its ends (same name, a shared end node), their samples pooled.
  const nodeKey = (p) => `${p.lat.toFixed(7)},${p.lng.toFixed(7)}`;
  const byEnd = new Map();
  for (const f of osmFeatures) {
    const name = f?.type === 'road' ? f.tags?.name : null;
    if (!name || !(f.geometry?.length >= 2)) continue;
    for (const e of [f.geometry[0], f.geometry[f.geometry.length - 1]]) {
      const k = `${name}|${nodeKey(e)}`;
      if (!byEnd.has(k)) byEnd.set(k, []);
      byEnd.get(k).push(f);
    }
  }
  const tallies = new Map();
  const tallyOf = (f) => {
    if (f.id === undefined) return tally(f.geometry);
    if (!tallies.has(f.id)) tallies.set(f.id, tally(f.geometry));
    return tallies.get(f.id);
  };

  return (feature) => {
    const id = feature?.id;
    if (id !== undefined && cache.has(id)) return cache.get(id);
    let [samples, urbanSamples] = tallyOf(feature || {});
    const name = feature?.tags?.name;
    const g = feature?.geometry || [];
    if (name && g.length >= 2) {
      const seen = new Set([id]);
      for (const e of [g[0], g[g.length - 1]]) {
        for (const n of byEnd.get(`${name}|${nodeKey(e)}`) || []) {
          if (seen.has(n.id)) continue;
          seen.add(n.id);
          const [a, b] = tallyOf(n);
          samples += a; urbanSamples += b;
        }
      }
    }
    const urban = samples > 0 && urbanSamples / samples >= URBAN_SHARE;
    if (id !== undefined) cache.set(id, urban);
    return urban;
  };
}

// A short span carries no parked cars: a village street's 8 m bridge over
// its stream came out 10.6 m wide, the street's two assumed parking lanes
// carried across it (tester report). A bridge way this short with no parking,
// width or lane tags of its own gets parking:both=no (the street on either
// side keeps its lanes; a city's canal bridges, longer, stay as wide as
// their streets).
const SHORT_SPAN_M = 15;
const SPAN_OWN_TAGS = ['width', 'width:carriageway', 'mapng:carriageway_width', 'parking:both', 'parking:left', 'parking:right', 'parking:lane:both', 'parking:lane:left', 'parking:lane:right'];

/**
 * The features with parking:both=no on short bridge ways that say nothing of
 * their own width (copies; the rest as they were). project(p) -> [x, y] in metres.
 */
export function markShortSpans(features, project) {
  return (features || []).map((f) => {
    const t = f?.tags || {};
    if (f?.type !== 'road' || !t.bridge || t.bridge === 'no' || !PARKING_CLASSES.has(t.highway) || !(f.geometry?.length >= 2)) return f;
    if (SPAN_OWN_TAGS.some((k) => t[k] !== undefined)) return f;
    const xy = f.geometry.map(project);
    let length = 0;
    for (let i = 1; i < xy.length; i++) length += Math.hypot(xy[i][0] - xy[i - 1][0], xy[i][1] - xy[i - 1][1]);
    if (length > SHORT_SPAN_M) return f;
    return { ...f, tags: { ...t, 'parking:both': 'no', 'mapng:parking_source': 'short span' } };
  });
}
