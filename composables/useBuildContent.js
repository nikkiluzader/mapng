// What to build (step 4): which features the level gets, in one place for the
// export panel, the 2D map's colouring and the share codes.
//
// Seven features keep the storage keys they always had (roads, buildings,
// trees, rocks, water, bridges, tunnels: share codes, "Modify" in My Levels
// and the settings stats read them); the rest are a list of ids switched off
// (mapng_beamNGContentOff). OSM tags left out one by one (the "Show OSM tags"
// rows) are mapng_beamNGExcludeTags. Basic mode shows only the presets
// (mapng_beamNGBasicPreset, Everything by default). Rules: services/buildContent.js.
import { ref, computed, watch } from 'vue';
import { CONTENT_IDS, CONTENT_PRESETS, PRESET_IDS, presetOf, sanitizeContentOff, sanitizeExcludeTags, contentExportOptions } from '../services/buildContent.js';

const read = (key) => { try { return localStorage.getItem(key); } catch { return null; } };
const write = (key, value) => { try { localStorage.setItem(key, value); } catch { /* private mode */ } };
const readList = (key) => { try { return JSON.parse(read(key) || '[]'); } catch { return []; } };

// the features with their own old key: [id, key, read as on, write]
const LEGACY = [
  ['roadSurfaces', 'mapng_beamNGRoadType', (v) => v !== 'none', (on) => (on ? 'decal' : 'none')],
  ['buildings', 'mapng_beamNGIncludeBuildings'],
  ['trees', 'mapng_beamNGIncludeTrees'],
  ['rocks', 'mapng_beamNGIncludeRocks'],
  ['water', 'mapng_beamNGIncludeWater'],
  ['bridges', 'mapng_beamNGIncludeBridges'],
  ['tunnels', 'mapng_beamNGIncludeTunnels'],
].map(([id, key, get = (v) => v !== 'false', put = (on) => String(on)]) => ({ id, key, get, put }));
const LEGACY_IDS = new Set(LEGACY.map((l) => l.id));

const OFF_KEY = 'mapng_beamNGContentOff';
const TAGS_KEY = 'mapng_beamNGExcludeTags';
const PRESET_KEY = 'mapng_beamNGBasicPreset';

/** On/off of the seven features with their own key (refs; the export panel's beamNGInclude… settings). */
export const legacyOn = Object.fromEntries(LEGACY.map((l) => [l.id, ref(l.get(read(l.key)))]));
const extraOff = ref(sanitizeContentOff(readList(OFF_KEY)).filter((id) => !LEGACY_IDS.has(id)));
export const excludeTags = ref(sanitizeExcludeTags(readList(TAGS_KEY)));
export const basicPreset = ref(PRESET_IDS.includes(read(PRESET_KEY)) ? read(PRESET_KEY) : 'all');
// views (per viewer, not in codes): the OSM tag rows, the 2D map coloured by group (step 4 only), the card's tab
export const showOsmTags = ref(read('mapng_contentShowTags') === 'true');
export const colourMap = ref(read('mapng_contentColourMap') === 'true');
export const contentTab = ref(read('mapng_contentTab') === 'tune' ? 'tune' : 'features');

for (const l of LEGACY) watch(legacyOn[l.id], (on) => write(l.key, l.put(on)));
watch(extraOff, (v) => write(OFF_KEY, JSON.stringify(v)), { deep: true });
watch(excludeTags, (v) => write(TAGS_KEY, JSON.stringify(v)), { deep: true });
watch(basicPreset, (v) => write(PRESET_KEY, v));
watch(showOsmTags, (v) => write('mapng_contentShowTags', String(v)));
watch(colourMap, (v) => write('mapng_contentColourMap', String(v)));
watch(contentTab, (v) => write('mapng_contentTab', v));

/** Advanced mode's off list: the seven old switches and the rest. */
export const advancedOff = computed(() => [
  ...LEGACY.filter((l) => !legacyOn[l.id].value).map((l) => l.id),
  ...extraOff.value,
]);
/** The quick-select preset the advanced choice matches, or 'custom'. */
export const advancedPreset = computed(() => presetOf(advancedOff.value, excludeTags.value));

/** The off list in force: advanced, every switch; basic, its preset. */
export const effectiveOff = (advanced) => (advanced ? advancedOff.value : CONTENT_PRESETS[basicPreset.value] || []);
/** Whether a feature is built. */
export const isBuilt = (advanced, id) => !effectiveOff(advanced).includes(id);
/** The export's options for the choice in force (services/buildContent.js contentExportOptions). */
// (excludeTags: the user's own tags only; the export adds every off feature's tags itself)
export const contentOptions = (advanced) => {
  const own = advanced ? [...excludeTags.value] : [];
  return { ...contentExportOptions(effectiveOff(advanced), own), excludeTags: own };
};

/** Switch one feature (advanced). */
export function setBuilt(id, on) {
  if (LEGACY_IDS.has(id)) { legacyOn[id].value = on; return; }
  const s = new Set(extraOff.value);
  if (on) s.delete(id); else s.add(id);
  extraOff.value = CONTENT_IDS.filter((x) => s.has(x));
}
/** Apply a quick-select preset (advanced): every switch as the preset says, the single tags cleared. */
export function applyPreset(id) {
  const off = new Set(CONTENT_PRESETS[id] || []);
  for (const l of LEGACY) legacyOn[l.id].value = !off.has(l.id);
  extraOff.value = CONTENT_IDS.filter((x) => off.has(x) && !LEGACY_IDS.has(x));
  excludeTags.value = [];
}
/** Leave out (or keep) one OSM tag. */
export function setTagOn(tag, on) {
  const s = new Set(excludeTags.value);
  if (on) s.delete(tag); else s.add(tag);
  excludeTags.value = [...s];
}

/** Read everything back from storage (a share code or a loaded config just wrote it). */
export function reloadContentSettings() {
  for (const l of LEGACY) legacyOn[l.id].value = l.get(read(l.key));
  extraOff.value = sanitizeContentOff(readList(OFF_KEY)).filter((id) => !LEGACY_IDS.has(id));
  excludeTags.value = sanitizeExcludeTags(readList(TAGS_KEY));
  basicPreset.value = PRESET_IDS.includes(read(PRESET_KEY)) ? read(PRESET_KEY) : 'all';
}
