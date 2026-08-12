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
