// The game's model for an OSM tag, by the region's look: data/tag-models.json, made from the model catalogue and
// the picks in data/model-picks.json (scripts/tag-library/from-catalogue.mjs). A new object for a tag is a line
// in the picks, not code here.
import data from '../data/tag-models.json' with { type: 'json' };

// The region of the world a biome's look belongs to (the catalogue's regions).
const REGION_OF_BIOME = {
  italy: 'europe', european: 'europe', european_template: 'europe',
  utah: 'north-america', east_coast: 'north-america', east_coast_usa: 'north-america', west_coast: 'north-america', west_coast_usa: 'north-america', johnson_valley: 'north-america',
  jungle: 'tropical', jungle_rock_island: 'tropical', small_island: 'tropical',
};
export const regionOfBiome = (biome) => REGION_OF_BIOME[String(biome || '').toLowerCase()] || 'any';

/** Every model picked for a tag in a biome: the region's own, else the ones for anywhere. [] when the tag has none. */
export function tagModelsFor(tag, biome) {
  const byRegion = data.tags[tag];
  if (!byRegion) return [];
  const own = byRegion[regionOfBiome(biome)];
  return (own?.length ? own : byRegion.any) || [];
}

/**
 * The model to place for a tag: { shapeFile, yawOffset (radians, added to the direction it should face), size,
 * box } or null. `n` picks among the variants (the same n, the same model: an object's index, so a level comes
 * out the same every time).
 */
export function tagModel(tag, biome, n = 0) {
  const list = tagModelsFor(tag, biome);
  if (!list.length) return null;
  const m = list[((Math.trunc(n) % list.length) + list.length) % list.length];
  return { shapeFile: m.shape, yawOffset: ((m.yaw || 0) * Math.PI) / 180, size: m.size, box: m.box };
}

/** Every model any tag may place: the set whose materials ship with an export. */
export const allTagModelShapes = () => [...new Set(Object.values(data.tags).flatMap((byRegion) => Object.values(byRegion).flat()).map((m) => m.shape))];
