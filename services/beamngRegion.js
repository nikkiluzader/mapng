/**
 * Picks the BeamNG look for an export from where it is, instead of a biome
 * the user chooses: the "biome" the exporter works with (ground cover,
 * signature trees, rocks, terrain detail textures, water) is one of the
 * official levels, chosen by climate, after BeamNG.Earth (one rule for every
 * place; regional variation from the position).
 *
 *   - North America: hot desert lowlands (Phoenix, Las Vegas) → Johnson
 *     Valley; the low West Coast → West Coast USA; the rest of the dry West
 *     and high ground (Utah, Flagstaff, the Sierra) → Utah; everything else →
 *     East Coast USA.
 *   - The Mediterranean → Italy; the tropics → Jungle Rock Island.
 *   - Elsewhere → East Coast USA (temperate).
 *
 * Coordinates alone miss the deserts outside North America (Arabia, the
 * Sahara, inland Australia), so the OSM land cover decides there: a map whose
 * mapped land cover is mostly scrub, sand, bare rock or desert gets the
 * desert look.
 */
import { treeClimate } from './beamngTrees.js';

const HIGH_DESERT_M = 1500;      // dry-West ground above this reads as Utah, not Johnson Valley
const DRY_COVER_SHARE = 0.6;     // share of mapped land cover that makes a map "dry"
const MIN_COVER_SHARE = 0.05;    // mapped land cover below this share of the map says nothing

const DRY_COVER = (t) => ['scrub', 'sand', 'bare_rock', 'scree', 'desert', 'shingle'].includes(t.natural)
  || t.landcover === 'sand' || t.landuse === 'desert';
const GREEN_COVER = (t) => ['wood', 'grassland', 'wetland'].includes(t.natural)
  || ['forest', 'meadow', 'grass', 'farmland', 'orchard', 'vineyard', 'village_green'].includes(t.landuse)
  || ['grass', 'trees'].includes(t.landcover)
  || ['park', 'garden'].includes(t.leisure);

const ringAreaM2 = (geometry, cosLat) => {
  let a = 0;
  for (let i = 0; i < geometry.length; i++) {
    const p = geometry[i];
    const q = geometry[(i + 1) % geometry.length];
    a += (p.lng * cosLat) * q.lat - (q.lng * cosLat) * p.lat;
  }
  return Math.abs(a) * 0.5 * 111320 * 111320;
};

/**
 * Share of the mapped land cover that is dry, or null when too little of the
 * map is mapped to say. features: MapNG OSM features; mapAreaM2: the map's area.
 */
export function dryCoverShare(features = [], lat = 0, mapAreaM2 = 0) {
  const cosLat = Math.cos((lat * Math.PI) / 180);
  let dry = 0;
  let green = 0;
  for (const f of features) {
    if (f?.type !== 'landuse' || !Array.isArray(f.geometry) || f.geometry.length < 3) continue;
    const tags = f.tags || {};
    const isDry = DRY_COVER(tags);
    if (!isDry && !GREEN_COVER(tags)) continue;
    const area = ringAreaM2(f.geometry, cosLat);
    if (isDry) dry += area; else green += area;
  }
  const covered = dry + green;
  if (covered <= 0 || (mapAreaM2 > 0 && covered < mapAreaM2 * MIN_COVER_SHARE)) return null;
  return dry / covered;
}

const mediterranean = (lat, lon) => lat > 30 && lat < 46 && lon > -10 && lon < 40;
const northAmerica = (lat, lon) => lat > 24 && lon > -170 && lon < -50;

/**
 * { biomeId, reason } for an export at (lat, lon).
 * meanHeightM: mean terrain height (m) or null; features: MapNG OSM features;
 * mapAreaM2: the map's area in m².
 */
export function resolveRegionalBiome({ lat, lon, meanHeightM = null, features = [], mapAreaM2 = 0 }) {
  const c = treeClimate(lat, lon);
  const highGround = Number.isFinite(meanHeightM) && meanHeightM > HIGH_DESERT_M;

  if (northAmerica(lat, lon)) {
    if (c.hotDesert && !highGround) return { biomeId: 'johnson_valley', reason: 'hot desert (North America)' };
    // West Coast USA is Southern California: the low West Coast (Los Angeles,
    // the Central Valley, the Bay Area) is it, dry or not.
    if (c.westCoast && !highGround) return { biomeId: 'west_coast_usa', reason: 'West Coast' };
    if (c.dryWest) return { biomeId: 'utah', reason: highGround ? 'high desert (dry West)' : 'dry West' };
    if (!c.tropics) return { biomeId: 'east_coast_usa', reason: 'temperate North America' };
  }

  const dry = dryCoverShare(features, lat, mapAreaM2);
  const dryLand = dry != null && dry >= DRY_COVER_SHARE;
  if (dryLand) {
    return Math.abs(lat) < 36.5 && !highGround
      ? { biomeId: 'johnson_valley', reason: `desert (OSM land cover ${Math.round(dry * 100)}% dry)` }
      : { biomeId: 'utah', reason: `dry upland (OSM land cover ${Math.round(dry * 100)}% dry)` };
  }
  if (mediterranean(lat, lon)) return { biomeId: 'italy', reason: 'Mediterranean' };
  if (c.tropics) return { biomeId: 'jungle_rock_island', reason: 'tropics' };
  return { biomeId: 'east_coast_usa', reason: 'temperate' };
}
