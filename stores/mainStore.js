import { defineStore } from 'pinia';
import { ref, computed, shallowRef } from 'vue';
import { loadBatchState } from '../services/batchJob';
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

  const batchMode = ref(localStorage.getItem('mapng_batch_mode') === 'true');

  // Advanced mode brings back the map-maker tools the basic UI hides: the 2D
  // asset / 3D model downloads, Surrounding Tiles, per-category level export
  // toggles and the preview's surroundings + wireframe. Basic is the default.
  const advancedMode = ref(localStorage.getItem('mapng_advanced_mode') === 'true');
  // Raw terrain: the Terrain choice "Untouched" (composables/useTerrainMode.js;
  // advanced mode and batch jobs): generation leaves the elevation and OSM
  // roads exactly as pulled (no height blur, ground filter, river lowering,
  // road snapping or smoothing; the road curves stay). Read it through
  // rawTerrainActive so basic mode never applies it.
  const rawTerrain = computed(() => terrainMode.value === 'untouched');
  const rawTerrainActive = computed(() => advancedMode.value && rawTerrain.value);

  if (batchMode.value && Number(resolution.value) > 8192) {
    resolution.value = 8192;
    localStorage.setItem('mapng_resolution', String(8192));
  }

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
  const backgroundActive = computed(() => advancedMode.value && !batchMode.value && backgroundDrawn.value);
  // (also locked, with nothing drawn yet, once a drawing tool is picked: the
  // map can then be zoomed and panned to draw without the box following it)
  const backgroundPinned = ref(false);
  // (and locked by hand: the lock button on the location map, so the map can be
  // zoomed and panned, to place a spawn point say, without the area following
  // it. Asked for by Fizz_Mechanic. Not kept across a reload)
  const boxPinnedByUser = ref(false);
  const boxLockedByBackground = computed(() => backgroundActive.value || (backgroundPinned.value && advancedMode.value && !batchMode.value));
  const boxLocked = computed(() => boxLockedByBackground.value || (boxPinnedByUser.value && !batchMode.value));
  function setBackgroundPinned(v) { backgroundPinned.value = !!v; }
  function setBoxPinned(v) { boxPinnedByUser.value = !!v; }

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

  // --- Batch Job State ---
  const batchGridCols = ref(parseInt(localStorage.getItem('mapng_batch_cols')) || 3);
  const batchGridRows = ref(parseInt(localStorage.getItem('mapng_batch_rows')) || 3);
  const batchTileFollowCenter = ref(localStorage.getItem('mapng_batch_tile_follow_center') !== 'false');
  const batchTileOffsets = ref((() => {
    try {
      const saved = localStorage.getItem('mapng_batch_tile_offsets');
      const parsed = saved ? JSON.parse(saved) : [];
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  })());
  const batchTileNames = ref((() => {
    try {
      const saved = localStorage.getItem('mapng_batch_tile_names');
      const parsed = saved ? JSON.parse(saved) : [];
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  })());
  const batchState = ref(null);
  const batchRunning = ref(false);
  const batchCurrentStep = ref('');
  const showBatchProgress = ref(false);
  const savedBatchState = ref(loadBatchState());

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

  function setBatchMode(value) {
    batchMode.value = value;
    localStorage.setItem('mapng_batch_mode', value ? 'true' : 'false');
  }

  function setBatchGridCols(cols) {
    batchGridCols.value = cols;
    localStorage.setItem('mapng_batch_cols', String(cols));
  }

  function setBatchGridRows(rows) {
    batchGridRows.value = rows;
    localStorage.setItem('mapng_batch_rows', String(rows));
  }

  function setBatchTileFollowCenter(value) {
    batchTileFollowCenter.value = !!value;
    localStorage.setItem('mapng_batch_tile_follow_center', batchTileFollowCenter.value ? 'true' : 'false');
  }

  function setBatchTileOffsets(offsets) {
    batchTileOffsets.value = Array.isArray(offsets) ? offsets : [];
    localStorage.setItem('mapng_batch_tile_offsets', JSON.stringify(batchTileOffsets.value));
  }

  function setBatchTileNames(names) {
    batchTileNames.value = Array.isArray(names) ? names : [];
    localStorage.setItem('mapng_batch_tile_names', JSON.stringify(batchTileNames.value));
  }

  return {
    compareSpot,
    // State
    center,
    zoom,
    resolution,
    isDarkMode,
    batchMode,
    terrainData,
    exportStepOpen,
    lastGenerationKey,
    isLoading,
    loadingStatus,
    previewMode,
    viewMode,
    textureRevision,
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
    backgroundPinned,
    setBackgroundPinned,
    setBackgroundMask,
    clearBackgroundMask,
    batchGridCols,
    batchGridRows,
    batchTileFollowCenter,
    batchTileOffsets,
    batchTileNames,
    batchState,
    batchRunning,
    batchCurrentStep,
    showBatchProgress,
    savedBatchState,
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
    setBatchMode,
    setBatchGridCols,
    setBatchGridRows,
    setBatchTileFollowCenter,
    setBatchTileOffsets,
    setBatchTileNames
  };
});
