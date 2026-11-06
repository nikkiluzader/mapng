// The Terrain choice: how much MapNG touches the elevation, in one place.
//
//   ready      Ready to drive (the default): the global 30 m gets the ground
//              filter, rivers brought down to their banks, roads levelled in,
//              fine ground detail and sharpened cliffs; lidar, GPXZ and uploads
//              get the light pass (roads aligned). Every export edit is on.
//   custom     The generation passes and the export's edits chosen one by one.
//   untouched  The elevation exactly as downloaded: no generation passes
//              ("Raw terrain") and no export edits.
//
// It used to be two settings in two places: "Raw terrain" before Generate
// Data and "Terrain edits" in the export panel. The storage keys those used
// stay (mapng_raw_terrain, mapng_beamNGShapeMode / ShapeTerrain and the six
// edit boxes): share codes, "Modify" in My Levels and the settings stats read
// them. This module keeps them in step with the choice.
import { ref, watch } from 'vue';

export const TERRAIN_MODES = ['ready', 'custom', 'untouched'];
const MODE_KEY = 'mapng_terrain_mode';

// the export's edits a Custom choice picks from (key in the export's options, storage key)
export const TERRAIN_EDIT_KEYS = [
  ['shapeRoads', 'mapng_beamNGShapeRoads'],
  ['shapeBridges', 'mapng_beamNGShapeBridges'],
  ['shapeOverpasses', 'mapng_beamNGShapeOverpasses'],
  ['shapeTunnels', 'mapng_beamNGShapeTunnels'],
  ['shapeExtras', 'mapng_beamNGShapeExtras'],
  ['shapeDetail', 'mapng_beamNGShapeDetail'],
];

const read = (key) => { try { return localStorage.getItem(key); } catch { return null; } };
const write = (key, value) => { try { localStorage.setItem(key, value); } catch { /* private mode */ } };

// The choice as stored, or as the old two settings said it.
function storedMode() {
  const mode = read(MODE_KEY);
  if (TERRAIN_MODES.includes(mode)) return mode;
  if (read('mapng_raw_terrain') === 'true') return 'untouched';
  const shapeMode = read('mapng_beamNGShapeMode');
  if (shapeMode === 'custom' || shapeMode === 'none' || read('mapng_beamNGShapeTerrain') === 'false') return 'custom';
  return 'ready';
}

// the generation passes a Custom choice picks from (Generate Data's options, storage key)
export const TERRAIN_GENERATION_KEYS = [
  ['groundFilter', 'mapng_genGroundFilter'],
  ['lowerWater', 'mapng_genLowerWater'],
  ['smoothRoads', 'mapng_genSmoothRoads'],
];

export const terrainMode = ref(storedMode());
export const terrainEdits = Object.fromEntries(TERRAIN_EDIT_KEYS.map(([k, key]) => [k, ref(read(key) !== 'false')]));
export const generationEdits = Object.fromEntries(TERRAIN_GENERATION_KEYS.map(([k, key]) => [k, ref(read(key) !== 'false')]));

// (the old "no export edits" setting, met for the first time: Custom with every box off)
if (!TERRAIN_MODES.includes(read(MODE_KEY)) && (read('mapng_beamNGShapeMode') === 'none' || read('mapng_beamNGShapeTerrain') === 'false')) {
  for (const r of Object.values(terrainEdits)) r.value = false;
}

// the old keys, from the choice
const syncKeys = (mode) => {
  write(MODE_KEY, mode);
  write('mapng_raw_terrain', String(mode === 'untouched'));
  write('mapng_beamNGShapeMode', mode === 'ready' ? 'all' : mode === 'untouched' ? 'none' : 'custom');
  write('mapng_beamNGShapeTerrain', String(mode !== 'untouched'));
};
watch(terrainMode, syncKeys, { immediate: true });
for (const [k, key] of TERRAIN_EDIT_KEYS) watch(terrainEdits[k], (v) => write(key, String(!!v)));
for (const [k, key] of TERRAIN_GENERATION_KEYS) watch(generationEdits[k], (v) => write(key, String(!!v)));

export function setTerrainMode(mode) {
  if (TERRAIN_MODES.includes(mode)) terrainMode.value = mode;
}

/**
 * Read the choice back after something wrote the old keys directly (a level's
 * saved export options, for "Modify"; a loaded share code).
 */
export function reloadTerrainSettings() {
  try { localStorage.removeItem(MODE_KEY); } catch { /* private mode */ }
  for (const [k, key] of TERRAIN_EDIT_KEYS) terrainEdits[k].value = read(key) !== 'false';
  const mode = storedMode();
  if (mode === 'custom' && read('mapng_beamNGShapeMode') === 'none') for (const r of Object.values(terrainEdits)) r.value = false;
  terrainMode.value = mode;
  syncKeys(mode);
}

/** The export's shaping options for the choice (advanced: false = Basic, which always shapes everything). */
export function terrainShapingOptions(advanced = true) {
  const mode = advanced ? terrainMode.value : 'ready';
  const pick = (k) => mode === 'ready' || (mode === 'custom' && terrainEdits[k].value);
  return {
    shapeTerrain: mode !== 'untouched',
    ...Object.fromEntries(TERRAIN_EDIT_KEYS.map(([k]) => [k, pick(k)])),
  };
}

/**
 * Generate Data's options for the choice (advanced: false = Basic, always
 * Ready to drive): Untouched is raw; Custom picks the passes one by one.
 */
export function terrainGenerationOptions(advanced = true) {
  const mode = advanced ? terrainMode.value : 'ready';
  const pick = (k) => mode !== 'custom' || generationEdits[k].value;
  return {
    raw: mode === 'untouched',
    ...Object.fromEntries(TERRAIN_GENERATION_KEYS.map(([k]) => [k, pick(k)])),
  };
}
