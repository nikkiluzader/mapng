// What to build (step 4, "What to build"): every feature MapNG builds, in the
// groups the panel shows, each with how it is switched off. One table for the
// panel, the share codes, the export and its report.
//
// A feature is switched off in up to two ways:
//   - tags: the OSM features carrying them are left out of the export's data
//     before anything is built (the mapped benches, the traffic_signals
//     nodes), filterOsmByTags below, at the export's start;
//   - generated: what MapNG adds on its own (benches at a steady spacing
//     along streets, lamps along lit roads, lane paint) is checked against
//     contentOn(options, id) where it is made.
// Some features map to an existing export option (buildings: includeBuildings).
// Power users can also leave out single OSM tags (excludeTags, "Show OSM tags").
// Pure: no DOM, no storage.

/** Groups and their features. tags: OSM selectors 'key=value' or 'key=*'; option: export options set when off. */
export const CONTENT_GROUPS = [
  { id: 'roads', items: [
    { id: 'roadSurfaces', option: { roadType: 'none' } },
    { id: 'markings' },
    { id: 'crosswalks' },
    { id: 'signals', tags: ['highway=traffic_signals', 'crossing=traffic_signals'] },
    { id: 'signs', tags: ['highway=stop', 'highway=give_way', 'traffic_sign=*'] },
    { id: 'lamps', tags: ['highway=street_lamp'] },
    { id: 'calming', tags: ['traffic_calming=*'] },
  ] },
  { id: 'structures', items: [
    { id: 'bridges', option: { includeBridges: false } },
    // (the bridges of footpaths, cycleways and steps: footBridgeOf below)
    { id: 'footBridges' },
    { id: 'tunnels', option: { includeTunnels: false } },
    { id: 'dams', option: { includeDams: false } },
    { id: 'railways', tags: ['railway=rail', 'railway=light_rail', 'railway=subway', 'railway=tram', 'railway=narrow_gauge', 'railway=monorail', 'railway=funicular'], option: { includeRailways: false } },
  ] },
  { id: 'buildings', items: [
    { id: 'buildings', option: { includeBuildings: false } },
  ] },
  { id: 'walk', items: [
    { id: 'sidewalks', option: { includeSidewalks: false } },
    { id: 'paths', tags: ['highway=footway', 'highway=path', 'highway=cycleway', 'highway=bridleway'] },
    { id: 'steps', tags: ['highway=steps'] },
  ] },
  { id: 'furniture', items: [
    { id: 'benches', tags: ['amenity=bench', 'leisure=picnic_table'] },
    { id: 'bins', tags: ['amenity=waste_basket', 'amenity=waste_disposal', 'amenity=recycling'] },
    { id: 'hydrants', tags: ['emergency=fire_hydrant'] },
    { id: 'fountains', tags: ['amenity=fountain', 'amenity=drinking_water'] },
    { id: 'fences', tags: ['barrier=fence', 'barrier=wall', 'barrier=retaining_wall', 'barrier=hedge', 'barrier=city_wall'] },
    { id: 'gates', tags: ['barrier=gate', 'barrier=lift_gate', 'barrier=swing_gate', 'barrier=sliding_gate', 'barrier=bollard', 'barrier=jersey_barrier', 'barrier=guard_rail', 'barrier=chain'] },
    { id: 'poles', tags: ['power=line', 'power=minor_line', 'power=pole', 'power=tower'] },
  ] },
  { id: 'parking', items: [
    { id: 'carParks', tags: ['amenity=parking'] },
    { id: 'parkedCars' },
  ] },
  { id: 'green', items: [
    { id: 'trees', option: { includeTrees: false } },
    { id: 'groundCover' },
    { id: 'rocks', option: { includeRocks: false } },
  ] },
  { id: 'water', items: [
    // (by kind, waterKindOf below: a region's lakes may be mapped well and its streams not)
    { id: 'rivers' },
    { id: 'lakes' },
    { id: 'sea' },
    { id: 'pools', tags: ['leisure=swimming_pool'] },
  ] },
  { id: 'leisure', items: [
    { id: 'sportsFields', tags: ['leisure=pitch', 'leisure=track'] },
    { id: 'playgrounds', tags: ['leisure=playground'] },
    { id: 'fuel', tags: ['amenity=fuel', 'amenity=charging_station'] },
  ] },
];

export const CONTENT_ITEMS = CONTENT_GROUPS.flatMap((g) => g.items.map((it) => ({ ...it, group: g.id })));
export const CONTENT_IDS = CONTENT_ITEMS.map((it) => it.id);
const BY_ID = new Map(CONTENT_ITEMS.map((it) => [it.id, it]));

const keepOnly = (ids) => CONTENT_IDS.filter((id) => !ids.includes(id));
/** Quick select: what each preset switches off. */
export const CONTENT_PRESETS = {
  all: [],
  clean: ['benches', 'bins', 'hydrants', 'poles', 'parkedCars', 'calming', 'gates'],
  roads: keepOnly(['roadSurfaces', 'markings', 'crosswalks', 'signals', 'signs', 'lamps', 'calming', 'bridges', 'tunnels', 'dams', 'railways']),
  scenery: keepOnly(['trees', 'groundCover', 'rocks', 'rivers', 'lakes', 'sea']),
};
export const PRESET_IDS = Object.keys(CONTENT_PRESETS);

/** The preset whose off list this is exactly, or 'custom'. */
export function presetOf(offIds = [], excludeTags = []) {
  if (excludeTags.length) return 'custom';
  const off = new Set(offIds);
  for (const [id, list] of Object.entries(CONTENT_PRESETS)) {
    if (list.length === off.size && list.every((x) => off.has(x))) return id;
  }
  return 'custom';
}

/** Clean an off list / tag list from storage or a code: known ids only; selectors 'key=value' or 'key=*'. */
export function sanitizeContentOff(list) {
  if (!Array.isArray(list)) return [];
  // (until 0.2.14 one switch, 'water': the inland water, rivers and lakes)
  const ids = list.includes('water') ? [...list, 'rivers', 'lakes'] : list;
  return [...new Set(ids.filter((id) => BY_ID.has(id)))];
}

const RIVER_WATER = new Set(['river', 'canal', 'stream', 'ditch', 'drain', 'stream_pool', 'rapids', 'lock', 'fish_pass']);
const FLOWING = new Set(['river', 'stream', 'canal', 'ditch', 'drain', 'riverbank', 'tidal_channel', 'brook', 'wadi', 'flowline', 'rapids']);
const WATER_WORKS = new Set(['dam', 'weir', 'lock_gate', 'sluice_gate', 'waterfall', 'boatyard', 'fuel', 'sanitary_dump_station', 'water_point', 'turning_point', 'milestone', 'security_lock', 'check_dam']);
const SEA_PLACES = new Set(['sea', 'ocean']);
/**
 * The kind of a water feature, for the three water switches: 'river' (a
 * waterway's line, a river's or canal's mapped area), 'sea' (the coastline,
 * a mapped sea or bay), 'lake' (every other water area: lakes, ponds,
 * reservoirs, basins); null for anything that is no water.
 */
export function waterKindOf(f) {
  const t = f?.tags || {};
  if (f?.type === 'coastline' || t.natural === 'coastline' || t.natural === 'bay' || t.natural === 'strait' || SEA_PLACES.has(String(t.place || '').toLowerCase())) return 'sea';
  if (f?.type !== 'water') return null;
  if (t.leisure === 'swimming_pool') return null;
  const way = String(t.waterway || '').toLowerCase();
  if (FLOWING.has(way) || RIVER_WATER.has(String(t.water || '').toLowerCase())) return 'river';
  // (what stands in or beside the water is no water: a dam and a weir are the dams', built or not with them)
  if (WATER_WORKS.has(way) && t.natural !== 'water' && !t.water) return null;
  return 'lake';
}
const WATER_ITEM = { river: 'rivers', lake: 'lakes', sea: 'sea' };
const FOOT_WAYS = new Set(['footway', 'path', 'cycleway', 'steps', 'bridleway', 'pedestrian', 'corridor']);
/** A footbridge: a path, cycleway or flight of steps mapped as a bridge (no road's bridge). */
export const footBridgeOf = (f) => f?.type === 'road' && FOOT_WAYS.has(f.tags?.highway) && !!f.tags?.bridge && f.tags.bridge !== 'no';
/** The features left with the footbridges taken out (their stretch of path with them): { features, removed }. */
export function filterFootBridges(features, options) {
  if (!Array.isArray(features) || contentOn(options, 'footBridges')) return { features, removed: 0 };
  const out = features.filter((f) => !footBridgeOf(f));
  return { features: out, removed: features.length - out.length };
}
/** The features left once the water kinds switched off are taken out: { features, removed }. */
export function filterWaterKinds(features, options) {
  const off = ['river', 'lake', 'sea'].filter((k) => !contentOn(options, WATER_ITEM[k]));
  if (!Array.isArray(features) || !off.length) return { features, removed: 0 };
  const out = features.filter((f) => { const k = waterKindOf(f); return !k || !off.includes(k); });
  return { features: out, removed: features.length - out.length };
}
const SELECTOR = /^[a-z0-9_:.-]{1,40}=(\*|[^=\s][^=]{0,60})$/i;
export function sanitizeExcludeTags(list) {
  return Array.isArray(list) ? [...new Set(list.map((s) => String(s).trim()).filter((s) => SELECTOR.test(s)))].slice(0, 200) : [];
}

/**
 * The export options for a content choice: { contentOff, excludeTags } (every
 * tag an off feature leaves out, plus the user's own) and the existing
 * options the off features set (roadType 'none', includeBuildings false ...).
 */
export function contentExportOptions(offIds = [], userExcludeTags = []) {
  const off = sanitizeContentOff(offIds);
  const tags = new Set(sanitizeExcludeTags(userExcludeTags));
  const options = {};
  for (const id of off) {
    const it = BY_ID.get(id);
    for (const t of it.tags || []) tags.add(t);
    Object.assign(options, it.option || {});
  }
  // (the old one water option: off when no inland water is built)
  if (off.includes('rivers') && off.includes('lakes')) options.includeWater = false;
  return { ...options, contentOff: off, excludeTags: [...tags] };
}

/** Whether the export builds a feature (true unless the options switch it off). */
export function contentOn(options, id) {
  return !(Array.isArray(options?.contentOff) && options.contentOff.includes(id));
}

const parseSelectors = (selectors) => {
  const exact = new Map(); const anyValue = new Set();
  for (const s of selectors || []) {
    const i = s.indexOf('='); if (i < 1) continue;
    const k = s.slice(0, i); const v = s.slice(i + 1);
    if (v === '*') anyValue.add(k);
    else { if (!exact.has(k)) exact.set(k, new Set()); exact.get(k).add(v); }
  }
  return { exact, anyValue };
};
/** Whether an OSM feature's tags match any selector. */
export function tagsMatch(tags, selectors) {
  const { exact, anyValue } = parseSelectors(selectors);
  return matchParsed(tags, exact, anyValue);
}
function matchParsed(tags, exact, anyValue) {
  if (!tags) return false;
  for (const k of anyValue) if (tags[k] != null && tags[k] !== 'no') return true;
  for (const [k, vals] of exact) if (tags[k] != null && vals.has(String(tags[k]))) return true;
  return false;
}

/**
 * The OSM features left after leaving out every feature carrying an excluded
 * tag. A street that also carries a tram line (railway=tram on a road way)
 * keeps its road: only a feature whose own kind is the excluded one goes
 * (type 'railway' for railway tags, type 'road' for highway tags ...), so
 * switching railways off never takes the streets the trams run in.
 */
export function filterOsmByTags(features, selectors) {
  if (!Array.isArray(features) || !selectors?.length) return { features, removed: 0, byTag: {} };
  const { exact, anyValue } = parseSelectors(selectors);
  const byTag = {};
  const out = [];
  for (const f of features) {
    const t = f?.tags;
    let hit = null;
    if (t) {
      for (const k of anyValue) if (t[k] != null && t[k] !== 'no') { hit = `${k}=*`; break; }
      if (!hit) for (const [k, vals] of exact) if (t[k] != null && vals.has(String(t[k]))) { hit = `${k}=${t[k]}`; break; }
    }
    // (a railway tag on a road way: the road stays; a highway tag on a railway feature: the railway stays)
    if (hit && ((hit.startsWith('railway=') && f.type === 'road') || (hit.startsWith('highway=') && f.type === 'railway'))) hit = null;
    // (a crossing mapped as a footway/cycleway/path way is the crosswalk's: footpaths left out keep it, the crosswalk paint needs it)
    if (hit && /^highway=(footway|cycleway|path|bridleway)$/.test(hit) && (t.footway === 'crossing' || t.cycleway === 'crossing' || t.path === 'crossing')) hit = null;
    if (hit) { byTag[hit] = (byTag[hit] || 0) + 1; continue; }
    out.push(f);
  }
  return { features: out, removed: features.length - out.length, byTag };
}

/**
 * Per feature, the OSM tags in this area that it covers, with counts (the
 * panel's "Show OSM tags" rows): { [id]: [{ tag, count }] }, most common first.
 */
export function osmTagCounts(features) {
  const out = {};
  if (!Array.isArray(features)) return out;
  const counters = CONTENT_ITEMS.filter((it) => it.tags?.length).map((it) => ({ it, ...parseSelectors(it.tags), counts: new Map() }));
  for (const f of features) {
    const t = f?.tags; if (!t) continue;
    for (const c of counters) {
      for (const k of c.anyValue) if (t[k] != null && t[k] !== 'no') { const key = `${k}=${t[k]}`; c.counts.set(key, (c.counts.get(key) || 0) + 1); }
      for (const [k, vals] of c.exact) if (t[k] != null && vals.has(String(t[k]))) { const key = `${k}=${t[k]}`; c.counts.set(key, (c.counts.get(key) || 0) + 1); }
    }
  }
  for (const c of counters) out[c.it.id] = [...c.counts.entries()].sort((a, b) => b[1] - a[1]).map(([tag, count]) => ({ tag, count }));
  return out;
}

const PATH_HIGHWAYS = new Set(['footway', 'path', 'cycleway', 'bridleway', 'pedestrian', 'track']);
/**
 * The feature an OSM feature belongs to, for the 2D map's colouring by
 * group: its tags first (a bench node, a footway), else its kind
 * (type 'building', 'water' ...). null: drawn neutral.
 */
export function itemOfFeature(f) {
  const t = f?.tags || {};
  if (footBridgeOf(f)) return 'footBridges';
  for (const it of TAGGED) if (matchParsed(t, it.exact, it.anyValue) && !(f.type === 'road' && it.id === 'railways')) return it.id;
  switch (f?.type) {
    case 'road': return PATH_HIGHWAYS.has(t.highway) ? 'paths' : 'roadSurfaces';
    case 'railway': return 'railways';
    case 'building': return 'buildings';
    case 'water': case 'coastline': return WATER_ITEM[waterKindOf(f)] ?? 'lakes';
    case 'vegetation': return t.natural === 'bare_rock' || t.natural === 'scree' ? 'rocks' : t.landuse === 'grass' || t.landuse === 'meadow' || t.natural === 'grassland' ? 'groundCover' : 'trees';
    case 'barrier': return 'fences';
    case 'power_line': return 'poles';
    case 'street_furniture': return 'benches';
    case 'fountain': return 'fountains';
    case 'fuel_station': case 'fuel_pump': return 'fuel';
    case 'traffic_calming': return 'calming';
    case 'parking': return 'carParks';
    default: return null;
  }
}
const TAGGED = CONTENT_ITEMS.filter((it) => it.tags?.length).map((it) => ({ id: it.id, ...parseSelectors(it.tags) }));
/** Group id of a feature id. */
export const groupOfItem = (id) => BY_ID.get(id)?.group ?? null;
