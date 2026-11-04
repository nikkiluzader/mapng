// A level's saved export options (its desktop project, or mapng.json) put
// back into the export panel's stored settings, for "Modify" in My Levels:
// the panel reads these when it appears, so after the level's terrain is
// generated again the export panel shows exactly what the level was made
// with, ready to change. Keys: components/panels/ExportPanel.vue.
import { setBaseTexture } from '../composables/useBaseTexture.js';

export const PENDING_LEVEL_NAME_KEY = 'mapng_pendingLevelName';

const SHAPE_EDITS = [
  ['shapeRoads', 'mapng_beamNGShapeRoads'],
  ['shapeBridges', 'mapng_beamNGShapeBridges'],
  ['shapeOverpasses', 'mapng_beamNGShapeOverpasses'],
  ['shapeTunnels', 'mapng_beamNGShapeTunnels'],
  ['shapeExtras', 'mapng_beamNGShapeExtras'],
];

/** The localStorage entries the export panel would hold for these options. */
export function exportSettingsFor(options = {}) {
  const on = (v) => String(v !== false);
  const out = {
    mapng_beamNGPbrSource: options.pbrSource === 'none' ? 'none' : 'osm',
    mapng_beamNGRoadType: options.roadType === 'none' ? 'none' : 'decal',
    mapng_beamNGBackdropSource: options.includeBackdrop ? (options.backdropElevationSource || 'global30m') : 'off',
    mapng_beamNGIncludeBuildings: on(options.includeBuildings),
    mapng_beamNGIncludeWater: on(options.includeWater),
    mapng_beamNGIncludeTrees: on(options.includeTrees),
    mapng_beamNGIncludeRocks: on(options.includeRocks),
    mapng_beamNGSafeCaps: on(options.safeCaps),
    mapng_beamNGIncludeBridges: on(options.includeBridges),
    mapng_beamNGIncludeTunnels: on(options.includeTunnels),
    mapng_beamNGLidarDecks: on(options.lidarDecks),
  };
  if (Number.isFinite(Number(options.seaLevelOffset))) out.mapng_beamNGSeaLevelOffset = String(Number(options.seaLevelOffset));
  // Terrain edits: none, all, or the chosen ones
  const edits = SHAPE_EDITS.map(([k]) => options[k] !== false);
  out.mapng_beamNGShapeTerrain = on(options.shapeTerrain);
  out.mapng_beamNGShapeMode = options.shapeTerrain === false ? 'none' : edits.every(Boolean) ? 'all' : 'custom';
  SHAPE_EDITS.forEach(([, key], i) => { out[key] = String(edits[i]); });
  return out;
}

/** Store the options for the export panel, and the level's name for its name box. */
export function applyExportSettings(options = {}, levelName = '') {
  for (const [key, value] of Object.entries(exportSettingsFor(options))) {
    try { localStorage.setItem(key, value); } catch { /* private mode */ }
  }
  // (a touched-up texture isn't kept with the level: its source look instead)
  const base = options.baseTexture === 'painted' ? 'hybrid' : options.baseTexture;
  if (base) setBaseTexture(base);
  const name = String(levelName || options.levelName || '').trim();
  try {
    if (name) localStorage.setItem(PENDING_LEVEL_NAME_KEY, name);
    else localStorage.removeItem(PENDING_LEVEL_NAME_KEY);
  } catch { /* private mode */ }
}
