// How heavy a BeamNG level will be, shown before exporting (export panel).
// From a BeamNG developer's advice (Wonly, 2026-11): past about 30 km from
// the level's centre the engine's precision runs out and things jitter;
// otherwise 0.40 is limited mostly by the memory meshes take, and frame
// rate by how much small-triangle and alpha-clipped geometry (foliage) is on
// screen; many separate meshes or instances are cheap. So: warn, never block.
//
// Only what is known before the export counts here (trees also come from
// satellite canopy found during the export, so they are not estimated).

export const PRECISION_LIMIT_KM = 30;
const PRECISION_WARN_KM = 25;
const CAPPED_BUILDINGS = 20000;   // exportBeamNGLevel.js SAFE_CAPS.buildings

// Past these the export itself is untried: a 66 km map of a city of 4 million buildings (a desktop user's, 2026-11)
// generated after a fix and then failed in the export's first minute. Still a warning, never a block.
const EXTREME_FAR_KM = 40;            // corners this far from the centre: a map about 57 km across
const EXTREME_BUILDINGS = 1000000;    // building footprints in the area, built or not

const RANK = { light: 0, heavy: 1, veryHeavy: 2, extreme: 3 };

/**
 * @param {object} p
 * @param {number} p.terrainPx       terrain width in pixels
 * @param {number} p.metersPerPixel
 * @param {number} p.buildings       building footprints in the area (OSM + Overture)
 * @param {boolean} p.safeCaps       content caps on (Build everything off)
 * @param {boolean} p.includeBuildings
 * @returns {{ rating: 'light'|'heavy'|'veryHeavy'|'extreme', farthestKm: number, sizeKm: number, builtBuildings: number,
 *            notes: { key: string, rating: string, params: object }[] }}
 */
export function estimateLevelWeight({ terrainPx, metersPerPixel = 1, buildings = 0, safeCaps = true, includeBuildings = true }) {
  const sizeKm = (Math.max(0, Number(terrainPx) || 0) * (Number(metersPerPixel) || 1)) / 1000;
  // (a square level: its corners are half a diagonal from the centre)
  const farthestKm = (sizeKm / 2) * Math.SQRT2;
  const builtBuildings = includeBuildings ? (safeCaps ? Math.min(buildings, CAPPED_BUILDINGS) : buildings) : 0;
  const notes = [];
  const add = (key, rating, params = {}) => notes.push({ key, rating, params });
  const km = (v) => (v < 10 ? v.toFixed(1) : String(Math.round(v)));

  // (first in the list: what the size means for MapNG itself)
  if (farthestKm > EXTREME_FAR_KM || buildings > EXTREME_BUILDINGS) add('extremeSize', 'extreme', { km: km(sizeKm), count: Math.round(buildings).toLocaleString() });

  if (farthestKm > PRECISION_LIMIT_KM) add('farEdge', 'veryHeavy', { km: km(farthestKm), limit: PRECISION_LIMIT_KM });
  else if (farthestKm > PRECISION_WARN_KM) add('nearEdge', 'heavy', { km: km(farthestKm), limit: PRECISION_LIMIT_KM });

  if (terrainPx > 16384) add('hugeTerrain', 'veryHeavy', { px: terrainPx });
  else if (terrainPx >= 16384) add('bigTerrain', 'heavy', { px: terrainPx });

  if (includeBuildings) {
    if (!safeCaps && buildings > 50000) add('manyBuildings', 'veryHeavy', { count: buildings.toLocaleString() });
    else if (!safeCaps && buildings > CAPPED_BUILDINGS) add('manyBuildings', 'heavy', { count: buildings.toLocaleString() });
    else if (safeCaps && buildings > CAPPED_BUILDINGS) add('buildingsCapped', 'light', { count: buildings.toLocaleString(), built: CAPPED_BUILDINGS.toLocaleString() });
  }
  // (caps off: trees, fences, lamps and props are not limited either)
  if (!safeCaps && (sizeKm >= 4 || buildings > 5000)) add('uncapped', 'heavy');

  const rating = notes.reduce((worst, n) => (RANK[n.rating] > RANK[worst] ? n.rating : worst), 'light');
  return { rating, farthestKm, sizeKm, builtBuildings, notes };
}
