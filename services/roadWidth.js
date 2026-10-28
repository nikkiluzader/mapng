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
  return { min: 2.2, max: 5.0 };
}

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

  const lanesFromTotal = parsePositiveInt(tags.lanes);
  const lanesFromDir = parsePositiveInt(tags['lanes:forward']) + parsePositiveInt(tags['lanes:backward']);
  const inferredLanes = Math.max(
    getDefaultLaneCount(highway, isOneWay),
    lanesFromTotal || lanesFromDir || 0,
  );
  const estimatedHalf = (inferredLanes * getDefaultLaneWidthMeters(highway)) / 2;

  return clamp(estimatedHalf || fallbackHalfWidth, limits.min, limits.max);
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
const M_PER_DEG_LAT = 111320;

/**
 * Build a classifier `(roadFeature) => boolean` that is true when most of the
 * road runs past at least URBAN_MIN_BUILDINGS buildings within
 * URBAN_RADIUS_M. Results are memoised per feature id.
 */
export function buildUrbanRoadClassifier(osmFeatures = []) {
  const buildings = [];
  let latSum = 0;
  for (const f of osmFeatures) {
    if (f?.type !== 'building' || !Array.isArray(f.geometry) || f.geometry.length < 3) continue;
    let lat = 0;
    let lng = 0;
    for (const p of f.geometry) { lat += p.lat; lng += p.lng; }
    lat /= f.geometry.length;
    lng /= f.geometry.length;
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    buildings.push([lat, lng]);
    latSum += lat;
  }
  const cache = new Map();
  if (buildings.length === 0) return () => false;

  const cosLat = Math.cos((latSum / buildings.length) * Math.PI / 180) || 1;
  const toXY = (lat, lng) => [lng * M_PER_DEG_LAT * cosLat, lat * M_PER_DEG_LAT];
  const grid = new Map();
  for (const [lat, lng] of buildings) {
    const [x, y] = toXY(lat, lng);
    const key = `${Math.floor(x / URBAN_CELL_M)},${Math.floor(y / URBAN_CELL_M)}`;
    const cell = grid.get(key);
    if (cell) cell.push([x, y]); else grid.set(key, [[x, y]]);
  }
  const countNear = (x, y) => {
    const cx = Math.floor(x / URBAN_CELL_M);
    const cy = Math.floor(y / URBAN_CELL_M);
    const r2 = URBAN_RADIUS_M * URBAN_RADIUS_M;
    let n = 0;
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        for (const [bx, by] of grid.get(`${cx + dx},${cy + dy}`) || []) {
          if ((bx - x) ** 2 + (by - y) ** 2 <= r2 && ++n >= URBAN_MIN_BUILDINGS) return n;
        }
      }
    }
    return n;
  };

  return (feature) => {
    const id = feature?.id;
    if (id !== undefined && cache.has(id)) return cache.get(id);
    const pts = (feature?.geometry || []).map((p) => toXY(p.lat, p.lng));
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
    const urban = samples > 0 && urbanSamples / samples >= URBAN_SHARE;
    if (id !== undefined) cache.set(id, urban);
    return urban;
  };
}
