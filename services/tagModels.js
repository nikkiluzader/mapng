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
// (a biome's id, or the regional look itself as the export has it)
export const regionOfBiome = (biome) => REGION_OF_BIOME[String((typeof biome === 'object' ? biome?.id || biome?.levelName : biome) || '').toLowerCase()] || 'any';

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
export const allTagModelShapes = () => [...new Set([...Object.values(data.tags).flatMap((byRegion) => Object.values(byRegion).flat()).map((m) => m.shape), ...Object.values(data.parts || {}).map((p) => p.shape)])];

// ---- mapped points a picked model is placed at (the rules in data/model-picks.json "objects") ----

const OBJECTS = Object.entries(data.objects || {}).map(([id, o]) => ({ id, ...o, key: o.tag.split('='), }));
const has = (tags, cond) => Object.entries(cond || {}).every(([k, values]) => values.includes(tags[k]));
const hasAny = (tags, cond) => Object.entries(cond || {}).some(([k, values]) => values.includes(tags[k]));

/** The OSM node tags these objects are mapped with, for the fetch: [[key, value], ...], each once. */
export const tagObjectNodeTags = () => [...new Map(OBJECTS.map((o) => [o.tag, o.key])).values()];

/** The object rule a mapped point's tags fall under, or null: { id, pick, face, item, cap, beside }. */
export function tagObjectFor(tags) {
  if (!tags) return null;
  for (const o of OBJECTS) {
    if (tags[o.key[0]] !== o.key[1]) continue;
    if (o.when && !has(tags, o.when)) continue;
    if (o.unless && hasAny(tags, o.unless)) continue;
    return o;
  }
  return null;
}

/** Whether a mapped point carries one of the objects' tags at all (what the data step keeps). */
export const isTagObjectNode = (tags) => !!tags && OBJECTS.some((o) => tags[o.key[0]] === o.key[1]);

/**
 * Where and how one object stands: by a road, clear of its lanes, its front to the road (or as its direction tag
 * says). `road`: the nearest road's { cx, cy (its nearest centre-line point), dist, halfWidth } or null.
 * Returns { x, y, facing } (facing: radians from +X; the model's yawOffset is added by the caller).
 */
export function standTagObject(rule, x, y, road, tags = {}, n = 0) {
  let px = x; let py = y; let facing = null;
  const dirDeg = Number.parseFloat(tags.direction);
  if (road && Number.isFinite(road.dist)) {
    // (a point mapped on the carriageway, a bus stop on the road's line: moved out beside it, the side it is on)
    const clear = (road.halfWidth ?? 3) + (rule.beside ?? 1);
    let ux = px - road.cx; let uy = py - road.cy; const d = Math.hypot(ux, uy);
    if (d < clear) {
      if (d < 0.05) { const a = (n * 2.399963) % (2 * Math.PI); ux = Math.cos(a); uy = Math.sin(a); } else { ux /= d; uy /= d; }
      px = road.cx + ux * clear; py = road.cy + uy * clear;
    }
    if (rule.face === 'road') facing = Math.atan2(road.cy - py, road.cx - px);
  }
  // (OSM: 0 = north, clockwise; the way the object faces)
  if (Number.isFinite(dirDeg) && rule.face !== 'none') facing = ((90 - dirDeg) * Math.PI) / 180;
  // (nothing to face: every one its own way, the same each time)
  if (facing === null) facing = rule.face === 'none' ? 0 : ((n * 2.399963) % (2 * Math.PI));
  return { x: px, y: py, facing };
}

// ---- the models the code builds with by name (data/model-picks.json "parts") ----

/**
 * A part: { shapeFile, ...facts } for a role name
 * ("STREET_LIGHT_SHAPES.arterial"). A fresh object each call. Throws for a role nobody defined: a typo, not data.
 */
export function part(role) {
  const p = data.parts?.[role];
  if (!p) throw new Error(`no model part "${role}" in data/tag-models.json (data/model-picks.json parts)`);
  return { shapeFile: p.shape, ...(p.facts || {}) };
}

/** Every part of a table, by its key: partsOf('BOLLARD_SHAPES') -> { steel: {...}, concrete: {...} }. */
export function partsOf(table) {
  const out = {};
  for (const role of Object.keys(data.parts || {})) if (role.startsWith(`${table}.`)) out[role.slice(table.length + 1)] = part(role);
  return out;
}
