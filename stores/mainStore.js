import { defineStore } from 'pinia';
import { ref, computed, shallowRef, watch } from 'vue';
import { cleanTileAnchor } from '../services/tileLayout.js';
import { terrainMode, setTerrainMode } from '../composables/useTerrainMode.js';
import { emptyMask, maskHasAreas } from '../services/backgroundMask.js';
import { sanitizePoints, POINTS_STORAGE_KEY } from '../services/spawnPoints.js';

const DEFAULT_CENTER = { lat: 35.1983, lng: -111.6513 };

const sanitizeCenter = (candidate) => {
  const lat = Number(candidate?.lat);
  const lng = Number(candidate?.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    console.warn('[Center] Saved center is non-finite, resetting to default.', candidate);
    return { ...DEFAULT_CENTER };
  }
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) {
    console.warn('[Center] Saved center out of range, resetting to default.', candidate);
    return { ...DEFAULT_CENTER };
  }
  return { lat, lng };
};

export const useMainStore = defineStore('main', () => {
  // --- Global State ---
  let persistedCenter = null;
  try {
    persistedCenter = JSON.parse(localStorage.getItem('mapng_center') || 'null');
  } catch {
    persistedCenter = null;
  }
  const center = ref(sanitizeCenter(persistedCenter));
  const zoom = ref(parseInt(localStorage.getItem('mapng_zoom')) || 13);
  // where "Compare sources here" looks: a spot chosen on the map (right-click), or null for the selection's middle
  const compareSpot = ref(null);
  const resolution = ref(parseInt(localStorage.getItem('mapng_resolution')) || 1024);
  const isDarkMode = ref(localStorage.getItem('theme') === 'dark');
  if (typeof document !== 'undefined') {
    if (isDarkMode.value) {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  }

  // Batch jobs are gone (tiles in step 1 took their place; removed in 0.3.7). What an earlier version left behind is
  // thrown away once at start: its settings, an unfinished saved job and its download cache.
  for (const key of [
    'mapng_batch_mode', 'mapng_batch_cols', 'mapng_batch_rows', 'mapng_batch_tile_follow_center',
    'mapng_batch_tile_offsets', 'mapng_batch_tile_names', 'mapng_batch_state_v2', 'mapng_batch_state',
    'mapng_batch_combined_level', 'mapng_batch_elevation', 'mapng_batch_elevation_mapterhornDefault', 'mapng_batch_exports',
    'mapng_batch_level_options', 'mapng_batch_mesh', 'mapng_batch_osm', 'mapng_batch_profile',
    'mapng_batch_shared_elevation', 'mapng_batch_show_tile_layout',
    'mapng_ui_sec_batchexports', 'mapng_ui_sec_batchlevel', 'mapng_ui_sec_batchperf2', 'mapng_ui_sec_batchres',
  ]) {
    try { localStorage.removeItem(key); } catch { /* private mode */ }
  }
  try { globalThis.indexedDB?.deleteDatabase('mapng-batch-cache'); } catch { /* blocked */ }

  // Advanced mode brings back the map-maker tools the basic UI hides: the 2D
  // asset / 3D model downloads, Surrounding Tiles, per-category level export
  // toggles and the preview's surroundings + wireframe. Basic is the default.
  const advancedMode = ref(localStorage.getItem('mapng_advanced_mode') === 'true');
  // Raw terrain: the Terrain choice "Untouched" (composables/useTerrainMode.js;
  // advanced mode): generation leaves the elevation and OSM
  // roads exactly as pulled (no height blur, ground filter, river lowering,
  // road snapping or smoothing; the road curves stay). Read it through
  // rawTerrainActive so basic mode never applies it.
  const rawTerrain = computed(() => terrainMode.value === 'untouched');
  const rawTerrainActive = computed(() => advancedMode.value && rawTerrain.value);

  // --- Single Tile State ---
  // (shallow: a generated terrain holds millions of objects — OSM features and
  // their points, the heightmap; deep reactivity wrapped them all in proxies,
  // and the 2D map stalled on garbage collection after generating. The
  // terrain is replaced whole whenever it changes; in-place writes that the UI
  // shows signal it themselves, e.g. the touched-up texture)
  const terrainData = shallowRef(null);
  const lastGenerationKey = ref(null);
  const isLoading = ref(false);
  const loadingStatus = ref("Initializing...");
  // Which view is over the map: 'location' (the world map, where the area is
  // chosen), 'preview2d' (the generated area flat, with what will be built) or
  // 'preview3d'. Generate opens the 2D preview; the 3D scene is only built
  // when its tab is opened.
  const viewMode = ref('location');
  // (the 3D preview as a switch, for the code that knows two views)
  const previewMode = computed({
    get: () => viewMode.value === 'preview3d',
    set: (on) => { viewMode.value = on ? 'preview3d' : 'location'; },
  });
  // (bumped when a texture of the terrain is repainted in place: the terrain is a
  // shallow ref, so the previews watch this)
  const textureRevision = ref(0);
  // (bumped when a texture Generate left out has been painted on demand, services/textureOnDemand.js: the
  // previews and the export panel's thumbnails look again; texturePreparing names the one being painted)
  const texturesMade = ref(0);
  const texturePreparing = ref('');
  // (the 3D model's area: a square of the map picked on the 2D preview, { c0, r0, size } in height samples, or
  // null for the whole map; modelAreaPicking while the next drag on the 2D preview picks it. services/modelArea.js)
  const modelArea = ref(null);
  const modelAreaPicking = ref(false);
  // (the export's backdrop choice, 'off' or its elevation source: the 2D preview draws
  // the surrounding tiles when one is chosen; the export panel keeps it up to date)
  // (the export's data-step options, as the export panel has them: the 2D preview asks the
  // data step for the backdrop it downloaded)
  const exportDataOptions = shallowRef(null);
  // (the backdrop's imagery as planned for this terrain: quality, metres a pixel…; the 2D preview says it)
  const backdropImagery = shallowRef(null);
  const backdropSource = ref((() => { try { return localStorage.getItem('mapng_beamNGBackdropSource') || 'off'; } catch { return 'off'; } })());
  const surroundingTilePositions = ref([]);

  // --- Background areas (services/backgroundMask.js; Location step, advanced) ---
  // While anything is drawn the area box is locked: the mask's outlines use the
  // box's edges, and generate fetches for that exact square.
  const backgroundMask = ref((() => {
    try {
      const saved = JSON.parse(localStorage.getItem('mapng_background_mask') || 'null');
      return saved && saved.version ? { ...emptyMask(), ...saved } : emptyMask();
    } catch { return emptyMask(); }
  })());
  const backgroundTool = ref('pan');
  const backgroundDrawn = computed(() => {
    const m = backgroundMask.value;
    return !!m.bounds && ((m.lines?.length || 0) > 0 || (m.paint?.length || 0) > 0 || (m.raw?.length || 0) > 0 || maskHasAreas(m));
  });
  const backgroundActive = computed(() => advancedMode.value && backgroundDrawn.value);
  // (also locked, with nothing drawn yet, once a drawing tool is picked: the
  // map can then be zoomed and panned to draw without the box following it)
  const backgroundPinned = ref(false);
  // (and locked by hand: the lock button on the location map, so the map can be
  // zoomed and panned, to place a spawn point say, without the area following
  // it. Asked for by Fizz_Mechanic. Not kept across a reload)
  const boxPinnedByUser = ref(false);
  // (and unlocked by hand over drawn mask areas: the lock button works at any time. The areas were drawn for
  // the box where it is; they are removed, with a word why, once it moves. Locked again before that, they stay.)
  const boxUnlockedOverMask = ref(false);
  const boxLockedByBackground = computed(() => (backgroundActive.value && !boxUnlockedOverMask.value) || (backgroundPinned.value && advancedMode.value));
  const boxLocked = computed(() => boxLockedByBackground.value || boxPinnedByUser.value);
  function setBackgroundPinned(v) { backgroundPinned.value = !!v; }
  function setBoxPinned(v) { boxPinnedByUser.value = !!v; }
  function setBoxUnlockedOverMask(v) { boxUnlockedOverMask.value = !!v && backgroundDrawn.value; }
  // The lock button, whatever holds the lock: on if nothing does; off otherwise, a mask tool put down with it.
  function toggleBoxLock() {
    if (boxLocked.value) {
      boxPinnedByUser.value = false;
      if (backgroundPinned.value) { backgroundPinned.value = false; backgroundTool.value = 'pan'; }
      if (backgroundActive.value) boxUnlockedOverMask.value = true;
    } else if (boxUnlockedOverMask.value) boxUnlockedOverMask.value = false;   // (the mask areas hold it again)
    else boxPinnedByUser.value = true;
  }
  watch(backgroundDrawn, (drawn) => { if (!drawn) boxUnlockedOverMask.value = false; });

  // --- Spawn and quicktravel points (services/spawnPoints.js; Location step) ---
  // An export setting: geographic, independent of the box, never a reason to
  // generate again. Kept as { version, points } so the format can grow.
  const points = ref((() => {
    try { return sanitizePoints(JSON.parse(localStorage.getItem(POINTS_STORAGE_KEY) || 'null')?.points); } catch { return []; }
  })());
  const pointTool = ref(false);          // placing points on the 2D map
  const selectedPointId = ref(null);
  function setPoints(list) {
    points.value = sanitizePoints(list);
    if (selectedPointId.value && !points.value.some((p) => p.id === selectedPointId.value)) selectedPointId.value = null;
    try {
      if (points.value.length) localStorage.setItem(POINTS_STORAGE_KEY, JSON.stringify({ version: 1, points: points.value }));
      else localStorage.removeItem(POINTS_STORAGE_KEY);
    } catch { /* storage full or blocked */ }
  }

  // the Export step open (the 2D map's "Colour the map by group" shows only there: components/map/contentLayer.js)
  const exportStepOpen = ref(false);

  // --- Tiles in step 1 (services/tileLayout.js, refs/output/tiles-plan.md) ---
  // tile offsets from tile 0 (on the map's centre) in tiles (x east, y north): a change of tile size scales the layout;
  // one tile is today's single square. Together: on a grid of whole tiles; free: anywhere, snapping when near.
  // (a road as the app makes it: a line of real points, its two ends as distances along it. Anything else in storage,
  // a cut-off or hand-edited entry, is no road: the corridor's maths would run on it at start)
  const validRoad = (r) => !!r && Array.isArray(r.pts) && r.pts.length >= 2 && r.pts.length <= 50000
    && r.pts.every((p) => p && Number.isFinite(p.lat) && Number.isFinite(p.lng) && Math.abs(p.lat) <= 90 && Math.abs(p.lng) <= 360)
    && Number.isFinite(r.startM) && Number.isFinite(r.endM) && r.startM >= 0 && r.endM >= r.startM
    // (its waypoints, when it has them: points the route was led through, useRoadMode.js)
    && (r.via === undefined || (Array.isArray(r.via) && r.via.length <= 200 && r.via.every((p) => p && Number.isFinite(p.lat) && Number.isFinite(p.lng))));
  const tiles = ref((() => {
    try {
      const saved = JSON.parse(localStorage.getItem('mapng_tiles') || 'null');
      return Array.isArray(saved) && saved.length && saved.length <= 64 && saved.every((t) => Number.isFinite(t?.dx) && Number.isFinite(t?.dy) && Math.abs(t.dx) <= 1000 && Math.abs(t.dy) <= 1000) ? saved : [{ dx: 0, dy: 0 }];
    } catch { return [{ dx: 0, dy: 0 }]; }
  })());
  const tilesTogether = ref(localStorage.getItem('mapng_tiles_together') !== 'false');
  // which point of the tiles stands on the location (services/tileLayout.js anchorOffsetPx): a tile's index, or
  // 'center' for the middle of them all. Tile 1 (index 0) unless chosen.
  const tileAnchor = ref((() => { try { const a = localStorage.getItem('mapng_tiles_anchor'); return cleanTileAnchor(a === 'center' ? a : Number(a), tiles.value.length); } catch { return 0; } })());
  function setTileAnchor(a) { tileAnchor.value = cleanTileAnchor(a, tiles.value.length); try { localStorage.setItem('mapng_tiles_anchor', String(tileAnchor.value)); } catch { /* private mode */ } }
  const tilesSnap = ref(localStorage.getItem('mapng_tiles_snap') !== 'false');
  function setTiles(list) {
    tiles.value = Array.isArray(list) && list.length ? list.map((t) => ({ dx: Number(t.dx) || 0, dy: Number(t.dy) || 0 })) : [{ dx: 0, dy: 0 }];
    tiles.value[0] = { dx: 0, dy: 0 };   // (tile 0 is the map's centre)
    localStorage.setItem('mapng_tiles', JSON.stringify(tiles.value));
    // (an anchor on a tile that is gone falls back to tile 1)
    if (tileAnchor.value !== cleanTileAnchor(tileAnchor.value, tiles.value.length)) setTileAnchor(0);
  }
  // road mode (refs/output/road-mode-plan.md): the area is a picked road widened either side, instead of tiles
  const areaMode = ref(localStorage.getItem('mapng_area_mode') === 'road' ? 'road' : 'tiles');
  const road = ref((() => {
    try {
      const r = JSON.parse(localStorage.getItem('mapng_road') || 'null');
      return validRoad(r) ? r : null;
    } catch { return null; }
  })());
  const roadHalfWidthM = ref(Number(localStorage.getItem('mapng_road_half_width')) || 250);
  function setAreaMode(m) { areaMode.value = m === 'road' ? 'road' : 'tiles'; localStorage.setItem('mapng_area_mode', areaMode.value); }
  function setRoad(r) {
    road.value = validRoad(r) ? r : null;
    try { if (road.value) localStorage.setItem('mapng_road', JSON.stringify(road.value)); else localStorage.removeItem('mapng_road'); } catch { /* full storage: kept for this session */ }
  }
  function setRoadHalfWidthM(v) { roadHalfWidthM.value = Number(v) || 250; localStorage.setItem('mapng_road_half_width', String(roadHalfWidthM.value)); }

  function setTilesTogether(v) { tilesTogether.value = !!v; localStorage.setItem('mapng_tiles_together', String(!!v)); }
  function setTilesSnap(v) { tilesSnap.value = !!v; localStorage.setItem('mapng_tiles_snap', String(!!v)); }

  // --- Actions ---
  // (force: opening a project or share code; it brings or clears its own mask)
  function setCenter(newCenter, { force = false } = {}) {
    if (boxLocked.value && !force) return;
    const safeCenter = sanitizeCenter(newCenter);
    center.value = safeCenter;
    localStorage.setItem('mapng_center', JSON.stringify(safeCenter));
  }

  function setZoom(newZoom) {
    zoom.value = newZoom;
    localStorage.setItem('mapng_zoom', String(newZoom));
  }

  function setResolution(newResolution, { force = false } = {}) {
    if (boxLocked.value && !force) return;
    resolution.value = newResolution;
    localStorage.setItem('mapng_resolution', String(newResolution));
  }

  function setAdvancedMode(value) {
    advancedMode.value = !!value;
    localStorage.setItem('mapng_advanced_mode', String(advancedMode.value));
    // Hidden Surrounding Tiles must not keep drawing on the map or feeding exports.
    if (!advancedMode.value) surroundingTilePositions.value = [];
  }

  // (a share code's rawTerrain: Untouched, or back to Ready to drive from it)
  function setRawTerrain(value) {
    if (value) setTerrainMode('untouched');
    else if (terrainMode.value === 'untouched') setTerrainMode('ready');
  }

  function toggleDarkMode() {
    isDarkMode.value = !isDarkMode.value;
    if (isDarkMode.value) {
      document.documentElement.classList.add('dark');
      localStorage.setItem('theme', 'dark');
    } else {
      document.documentElement.classList.remove('dark');
      localStorage.setItem('theme', 'light');
    }
  }

  function setBackgroundMask(mask) {
    backgroundMask.value = mask && mask.version ? mask : emptyMask();
    try {
      if (backgroundDrawn.value || backgroundMask.value.roads?.length) localStorage.setItem('mapng_background_mask', JSON.stringify(backgroundMask.value));
      else localStorage.removeItem('mapng_background_mask');
    } catch { /* storage full or blocked */ }
  }
  function clearBackgroundMask() { setBackgroundMask(emptyMask()); backgroundTool.value = 'pan'; backgroundPinned.value = false; }

  return {
    compareSpot,
    // State
    center,
    zoom,
    resolution,
    isDarkMode,
    terrainData,
    exportStepOpen,
    lastGenerationKey,
    isLoading,
    loadingStatus,
    previewMode,
    viewMode,
    textureRevision,
    texturesMade,
    texturePreparing,
    modelArea,
    modelAreaPicking,
    backdropSource,
    exportDataOptions,
    backdropImagery,
    surroundingTilePositions,
    backgroundMask,
    points,
    pointTool,
    selectedPointId,
    setPoints,
    backgroundTool,
    backgroundDrawn,
    backgroundActive,
    boxLocked,
    boxLockedByBackground,
    boxPinnedByUser,
    setBoxPinned,
    boxUnlockedOverMask,
    setBoxUnlockedOverMask,
    toggleBoxLock,
    backgroundPinned,
    setBackgroundPinned,
    setBackgroundMask,
    clearBackgroundMask,
    // Actions
    setCenter,
    setZoom,
    setResolution,
    toggleDarkMode,
    advancedMode,
    setAdvancedMode,
    rawTerrain,
    rawTerrainActive,
    setRawTerrain,
    tiles, tilesTogether, tilesSnap, tileAnchor, setTiles, setTilesTogether, setTilesSnap, setTileAnchor,
    areaMode, road, roadHalfWidthM, setAreaMode, setRoad, setRoadHalfWidthM
  };
});
