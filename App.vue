<template>
  <!-- Mobile Restriction Overlay -->
  <MobileRestrictionOverlay />

  <!-- Main Application - Hidden on Mobile -->
  <div class="hidden md:flex h-screen w-full flex-col md:flex-row overflow-hidden bg-white dark:bg-gray-900 text-gray-900 dark:text-white">
    <AppSidebar
      :batch-mode="batchMode"
      :is-dark-mode="isDarkMode"
      :build-hash="buildHash"
      :build-time="buildTime"
      @show-about="showAbout = true"
      @show-disclaimer="showDisclaimer = true"
      @show-stack="showStackInfo = true"
      @toggle-dark="store.toggleDarkMode"
      @set-batch-mode="setBatchMode"
    >
      <!-- Single mode -->
      <ControlPanel
        v-if="!batchMode"
        :center="center"
        :zoom="zoom"
        :resolution="resolution"
        :terrain-data="terrainData"
        :is-generating="isLoading"
        :generation-cache-key="lastGenerationKey"
        :uploaded-tif-file="uploadedTifFile"
        :uploaded-tif-meta="uploadedTifMeta"
        @location-change="handleLocationChange"
        @resolution-change="store.setResolution"
        @zoom-change="store.setZoom"
        @generate="handleGenerate"
        @fetch-osm="handleFetchOSM"
        @surrounding-tiles-change="(v) => surroundingTilePositions = v"
        @import-data="handleImportData"
        @tif-selected="handleTifSelected"
        @tif-clear="handleTifClear"
      />

      <!-- Batch mode -->
      <BatchControlPanel
        v-if="batchMode"
        :center="center"
        :resolution="resolution"
        :is-running="batchRunning"
        :saved-state="savedBatchState"
        :tile-offsets="batchTileOffsets"
        :tile-follow-center="batchTileFollowCenter"
        @location-change="handleLocationChange"
        @resolution-change="store.setResolution"
        @start-batch="handleStartBatch"
        @resume-batch="handleResumeBatch"
        @clear-saved-batch="handleClearSavedBatch"
        @clear-cache="handleClearBatchCache"
        @update:grid-cols="store.setBatchGridCols"
        @update:grid-rows="store.setBatchGridRows"
        @update:tile-offsets="store.setBatchTileOffsets"
        @update:tile-follow-center="store.setBatchTileFollowCenter"
      />
    </AppSidebar>

    <!-- Main Content Area -->
    <main class="flex-1 relative flex flex-col h-full bg-gray-100 dark:bg-gray-950">
      <ViewTabs
        :preview-mode="previewMode"
        :can-preview="!!terrainData"
        @switch-2d="switchTo2D"
        @switch-3d="previewMode = true"
      />

      <!-- Views -->
      <div class="flex-1 relative w-full h-full">
        <!-- Map View -->
        <div :class="['absolute inset-0 transition-all duration-500', previewMode ? 'opacity-0 invisible' : 'opacity-100 visible']">
          <MapSelector 
            :center="center" 
            :zoom="zoom" 
            :resolution="resolution"
            :is-dark-mode="isDarkMode"
            :uploaded-tif-file="uploadedTifFile"
            :uploaded-tif-meta="uploadedTifMeta"
            :surrounding-tile-positions="surroundingTilePositions"
            :batch-grid="batchGridTiles"
            :batch-editable="batchMode && !batchRunning && !showBatchProgress"
            @move="handleMapMove" 
            @zoom="store.setZoom"
            @batch-tile-drag="handleBatchTileDrag"
          />
        </div>
        
        <!-- 3D Preview View -->
        <div :class="['absolute inset-0 transition-all duration-500 bg-black', previewMode ? 'opacity-100 visible' : 'opacity-0 invisible pointer-events-none']">
          <Suspense>
            <template #default>
              <Preview3D 
                v-if="terrainData && previewMode"
                :terrain-data="terrainData"
              />
            </template>
            <template #fallback>
              <div class="w-full h-full flex items-center justify-center text-white flex-col gap-4">
                <Loader2 class="animate-spin text-[#FF6600]" :size="48" />
                <div class="text-lg font-medium text-white">Loading 3D Scene...</div>
              </div>
            </template>
          </Suspense>
        </div>
        
        <!-- Loading Overlay -->
        <div v-if="isLoading" class="absolute inset-0 z-50 flex items-center justify-center bg-white/80 dark:bg-gray-950/80 backdrop-blur-sm">
          <div class="text-center p-8 rounded-2xl bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 shadow-2xl min-w-[300px]">
            <Loader2 :size="48" class="text-[#FF6600] animate-spin mx-auto mb-4" />
            <h3 class="text-xl text-gray-900 dark:text-white font-bold mb-2">Processing Terrain</h3>
            <p class="text-gray-600 dark:text-gray-400 text-sm font-medium mb-4 animate-pulse">{{ loadingStatus }}</p>
            <div class="text-xs text-gray-400 dark:text-gray-500 max-w-xs mx-auto">
                <span v-if="resolution >= 2048">High resolution (2048+) may take 1-2 minutes.</span>
                <span v-if="resolution >= 4096" class="block text-amber-500 mt-1">Very large area (4k/8k). Please wait...</span>
            </div>
            <button
              @click="cancelGeneration"
              class="mt-5 px-6 py-2 text-sm font-medium text-gray-600 dark:text-gray-300 bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 rounded-lg transition-colors border border-gray-300 dark:border-gray-600"
            >
              Cancel
            </button>
          </div>
        </div>
      </div>
    </main>
  </div>

  <!-- Batch Progress Modal -->
    <BatchProgressModal
      v-if="showBatchProgress && batchState"
      :state="batchState"
      :current-step="batchCurrentStep"
      @close="handleBatchProgressClose"
      @cancel="handleBatchCancel"
      @resume="handleResumeBatch"
      @retry-failed="handleRetryFailed"
    />

    <!-- About Modal -->
    <AboutModal v-if="showAbout" @close="showAbout = false" />

    <!-- Disclaimer Modal -->
    <DisclaimerModal v-if="showDisclaimer" @close="showDisclaimer = false" />

    <!-- Tech Stack Modal -->
    <TechStackModal v-if="showStackInfo" @close="showStackInfo = false" />
</template>

<script setup>
import { ref, computed, onMounted } from 'vue';
import { storeToRefs } from 'pinia';
import { useMainStore } from './stores/mainStore';
import { Loader2 } from 'lucide-vue-next';
import MobileRestrictionOverlay from './components/modals/MobileRestrictionOverlay.vue';
import AboutModal from './components/modals/AboutModal.vue';
import DisclaimerModal from './components/modals/DisclaimerModal.vue';
import TechStackModal from './components/modals/TechStackModal.vue';
import ControlPanel from './components/panels/ControlPanel.vue';
import BatchControlPanel from './components/panels/BatchControlPanel.vue';
import BatchProgressModal from './components/modals/BatchProgressModal.vue';
import MapSelector from './components/map/MapSelector.vue';
import Preview3D from './components/three/Preview3D.vue';
import AppSidebar from './components/layout/AppSidebar.vue';
import ViewTabs from './components/ui/ViewTabs.vue';
import { fetchTerrainData, addOSMToTerrain, loadTerrainFromTif, parseTifFile, loadTerrainFromLaz, parseLazFile } from './services/terrain';
import {
  computeGridTiles,
  computeGridTilesWithOffsets,
  createBatchJobState,
  runBatchJob,
  saveBatchState,
  loadBatchState,
  clearBatchState,
  clearBatchClientCache,
  resetFailedTiles,
} from './services/batchJob';

if (import.meta.env.DEV) {
  import('./services/batchDebugHarness.js');
}

const store = useMainStore();
const {
  center,
  zoom,
  resolution,
  isDarkMode,
  batchMode,
  terrainData,
  lastGenerationKey,
  isLoading,
  loadingStatus,
  previewMode,
  surroundingTilePositions,
  batchGridCols,
  batchGridRows,
  batchTileFollowCenter,
  batchTileOffsets,
  batchState,
  batchRunning,
  batchCurrentStep,
  showBatchProgress,
  savedBatchState
} = storeToRefs(store);

const showStackInfo = ref(false);
const showAbout = ref(false);
const showDisclaimer = ref(false);
let abortController = null;
let batchAbortController = null;

// BYOD — user-uploaded TIF elevation data
const uploadedTifFile = ref(null);   // File | null
const uploadedTifMeta = ref(null);   // parseTifFile() result | null

// Compute batch grid tiles for map overlay (live preview while configuring)
const batchGridTiles = computed(() => {
  if (!batchMode.value) return [];
  // Use persisted batch tiles only while a job is active/paused
  // or while the progress modal is open.
  const status = batchState.value?.status;
  const usePersistedTiles = !!batchState.value && (
    showBatchProgress.value ||
    batchRunning.value ||
    status === 'running' ||
    status === 'paused' ||
    status === 'pending'
  );
  if (usePersistedTiles) return batchState.value.tiles;
  // Otherwise compute preview grid from config
  return computeGridTilesWithOffsets(
    center.value,
    resolution.value,
    batchGridCols.value,
    batchGridRows.value,
    batchTileOffsets.value,
  );
});

// Build info (injected by Vite at build time)
const buildHash = __BUILD_HASH__;
const buildTime = new Date(__BUILD_TIME__).toLocaleString();

const { toggleDarkMode, setCenter, setZoom, setResolution, setBatchMode } = store;

// Attempt to get user location on load
onMounted(() => {
  if (isDarkMode.value) {
    document.documentElement.classList.add('dark');
  } else {
    document.documentElement.classList.remove('dark');
  }

  if ("geolocation" in navigator) {
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setCenter({
          lat: position.coords.latitude,
          lng: position.coords.longitude
        });
      },
      (err) => {
        console.debug("Geolocation access denied or failed, using default location.", err);
      },
      {
        enableHighAccuracy: false, // Use WiFi/Cell towers for speed
        timeout: 5000, // Don't wait more than 5s
        maximumAge: 600000 // Accept cached positions up to 10 minutes old
      }
    );
  }
});

const handleLocationChange = (newCenter) => {
  setCenter(newCenter);
  terrainData.value = null;
  lastGenerationKey.value = null;
  // Cancel any in-flight generation when location changes
  if (abortController) {
    abortController.abort();
    abortController = null;
  }
};

const signatureForKey = (key) => {
  if (!key) return '';
  // Lightweight non-cryptographic signature for cache invalidation.
  let hash = 2166136261;
  for (let i = 0; i < key.length; i++) {
    hash ^= key.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
};

// Build a cache key from the parameters that affect terrain generation.
// If this key matches the last generation, we can skip re-fetching.
const buildGenerationKey = (c, res, osm, usgs, gpxz, gpxzKey, tifFile = null, elevationUnitOverride = 'auto') => {
  return JSON.stringify({
    lat: c.lat,
    lng: c.lng,
    resolution: res,
    osm,
    usgs,
    gpxz,
    gpxzKeySig: gpxz ? signatureForKey(gpxzKey) : '',
    elevationUnitOverride,
    // Include file identity so a different upload invalidates the cache
    tif: tifFile ? `${tifFile.name}|${tifFile.size}|${tifFile.lastModified}` : null,
  });
};

const handleTifSelected = async (file) => {
  uploadedTifFile.value = file;
  uploadedTifMeta.value = null;
  terrainData.value = null;
  lastGenerationKey.value = null;
  try {
    const ext = file.name.toLowerCase().split('.').pop();
    const meta = (ext === 'laz' || ext === 'las')
      ? await parseLazFile(file)
      : await parseTifFile(file);
    uploadedTifMeta.value = meta;
    // Auto-centre map if the file contains coordinate metadata
    if (meta.center) store.setCenter(meta.center);
  } catch (e) {
    console.warn('[BYOD] Failed to read file metadata:', e);
  }
};

const handleTifClear = () => {
  uploadedTifFile.value = null;
  uploadedTifMeta.value = null;
};

const handleGenerate = async (showPreview, fetchOSM, useUSGS, useGPXZ, gpxzApiKey, elevationUnitOverride = 'auto') => {
  const requestKey = buildGenerationKey(
    center.value,
    resolution.value,
    fetchOSM,
    useUSGS,
    useGPXZ,
    gpxzApiKey,
    uploadedTifFile.value,
    elevationUnitOverride,
  );

  // If we already have terrain data for the exact same parameters, reuse it
  if (terrainData.value && lastGenerationKey.value) {
    const cachedParams = JSON.parse(lastGenerationKey.value);
    const newParams = JSON.parse(requestKey);

    // Check if only the OSM toggle changed (was off, now on)
    const onlyOsmAdded =
      !cachedParams.osm && newParams.osm &&
      cachedParams.lat === newParams.lat &&
      cachedParams.lng === newParams.lng &&
      cachedParams.resolution === newParams.resolution &&
      cachedParams.usgs === newParams.usgs &&
      cachedParams.gpxz === newParams.gpxz &&
      (cachedParams.gpxzKeySig ?? cachedParams.gpxzKey ?? '') === (newParams.gpxzKeySig ?? '');

    if (requestKey === lastGenerationKey.value) {
      // Exact match — skip fetch entirely, just switch view if needed
      if (showPreview) previewMode.value = true;
      return;
    }

    if (onlyOsmAdded) {
      // Terrain + textures are identical, just add OSM data on top
      isLoading.value = true;
      loadingStatus.value = "Adding OSM data to existing terrain...";
      try {
        const updatedData = await addOSMToTerrain(terrainData.value, undefined, (status) => {
          loadingStatus.value = status;
        });
        terrainData.value = updatedData;
        lastGenerationKey.value = requestKey;
        if (showPreview) {
          loadingStatus.value = "Rendering 3D scene...";
          previewMode.value = true;
        }
      } catch (error) {
        console.error("Failed to add OSM data:", error);
        alert("Failed to fetch OSM data.");
      } finally {
        isLoading.value = false;
      }
      return;
    }
  }

  // Cancel any in-flight generation
  if (abortController) {
    abortController.abort();
    abortController = null;
  }

  abortController = new AbortController();
  const { signal } = abortController;

  isLoading.value = true;
  loadingStatus.value = "Starting terrain generation...";
  
  // Flush old data to free memory before loading new large datasets
  if (terrainData.value) {
      terrainData.value = null;
      lastGenerationKey.value = null;
      // Allow a brief moment for Vue to unmount 3D components and trigger disposal
      await new Promise(r => setTimeout(r, 100));
  }

  try {
    let data;
    if (uploadedTifFile.value) {
      // BYOD path — use uploaded elevation file, still fetch satellite/OSM
      const ext = uploadedTifFile.value.name.toLowerCase().split('.').pop();
      const isLaz = ext === 'laz' || ext === 'las';
      const meta = uploadedTifMeta.value
        ?? (isLaz ? await parseLazFile(uploadedTifFile.value) : await parseTifFile(uploadedTifFile.value));
      const effectiveCenter = meta.center ?? center.value;
      if (isLaz) {
        data = await loadTerrainFromLaz(
          meta,
          effectiveCenter,
          resolution.value,
          fetchOSM,
          (status) => { loadingStatus.value = status; },
          signal,
          { elevationUnitOverride },
        );
      } else {
        data = await loadTerrainFromTif(
          meta,
          effectiveCenter,
          resolution.value,
          fetchOSM,
          (status) => { loadingStatus.value = status; },
          signal,
          { elevationUnitOverride },
        );
      }
    } else {
      data = await fetchTerrainData(
        center.value,
        resolution.value,
        fetchOSM,
        useUSGS,
        useGPXZ,
        gpxzApiKey,
        undefined,
        (status) => { loadingStatus.value = status; },
        signal,
      );
    }
    terrainData.value = data;
    lastGenerationKey.value = requestKey;
    
    if (showPreview) {
        loadingStatus.value = "Rendering 3D scene...";
        previewMode.value = true;
    }
  } catch (error) {
    if (error.name === 'AbortError') {
      console.log("Terrain generation cancelled.");
      loadingStatus.value = "Cancelled.";
      return;
    }
    console.error("Failed to generate terrain:", error);
    alert("Failed to fetch terrain data. The requested area might be too large or service is down.");
  } finally {
    isLoading.value = false;
    abortController = null;
  }
};

const handleFetchOSM = async () => {
  if (!terrainData.value) return;
  
  isLoading.value = true;
  loadingStatus.value = "Fetching OSM data...";
  
  try {
      const updatedData = await addOSMToTerrain(terrainData.value, undefined, (status) => {
          loadingStatus.value = status;
      });
      terrainData.value = updatedData;
  } catch (error) {
      console.error("Failed to fetch OSM data:", error);
      alert("Failed to fetch OSM data.");
  } finally {
      isLoading.value = false;
  }
};

const handleImportData = (data) => {
  if (!data) return;

  // 1. Update Map Central View if bounds exist
  if (data.bounds) {
      const lat = (data.bounds.north + data.bounds.south) / 2;
      const lng = (data.bounds.east + data.bounds.west) / 2;
      setCenter({ lat, lng });
  }

  // 2. Update resolution
  if (data.width) {
      setResolution(data.width);
  }

  // 3. Set the data
  terrainData.value = data;

  // 4. Restore the generation key if it was included
  if (data.generationKey) {
      lastGenerationKey.value = data.generationKey;
  } else {
      // Fallback: build a key that marks this area as "valid/cached" for the current UI state
      lastGenerationKey.value = buildGenerationKey(
          center.value,
          resolution.value,
          !!data.osmFeatures?.length,
          data.usgsFallback === false,
          false,
          ''
      );
  }

  // 5. Jump to 3D Preview
  previewMode.value = true;
};

const cancelGeneration = () => {
  if (abortController) {
    abortController.abort();
    abortController = null;
  }
};

const switchTo2D = () => {
  previewMode.value = false;
  // Do not clear terrainData here, so users can switch back and forth
  // without losing their generated exports.
};

// ─── Batch Job Handlers ─────────────────────────────────────────────

const handleStartBatch = (config) => {
  const state = createBatchJobState(config);
  batchState.value = state;
  showBatchProgress.value = true;
  executeBatchJob(state);
};

const handleResumeBatch = () => {
  let state = batchState.value || savedBatchState.value;
  if (!state) return;

  // If resuming from saved state, hydrate it
  if (!batchState.value) {
    batchState.value = state;
  }

  showBatchProgress.value = true;
  executeBatchJob(batchState.value);
};

const handleRetryFailed = () => {
  if (!batchState.value) return;
  resetFailedTiles(batchState.value);
  // Force reactivity update
  batchState.value = { ...batchState.value };
  executeBatchJob(batchState.value);
};

const handleBatchCancel = () => {
  if (batchState.value) {
    batchState.value.status = 'canceled';
    saveBatchState(batchState.value);
  }
  if (batchAbortController) {
    batchAbortController.abort();
    batchAbortController = null;
  }
};

const handleBatchProgressClose = () => {
  showBatchProgress.value = false;
  // If the job is fully complete with no errors, clear saved state
  if (batchState.value?.status === 'completed') {
    clearBatchState();
    savedBatchState.value = null;
    batchState.value = null;
  }
  // If paused or has errors, keep state for resume
  savedBatchState.value = loadBatchState();
};

const handleClearSavedBatch = () => {
  clearBatchState();
  savedBatchState.value = null;
  batchState.value = null;
};

const handleClearBatchCache = async () => {
  try {
    await clearBatchClientCache();
    alert('Batch cache cleared.');
  } catch (error) {
    console.error('[Batch] Failed to clear cache:', error);
    alert('Failed to clear batch cache.');
  }
};

const executeBatchJob = async (state) => {
  batchRunning.value = true;
  batchAbortController = new AbortController();

  try {
    await runBatchJob(
      state,
      // onProgress
      ({ tileIndex, step, tile }) => {
        batchCurrentStep.value = step;
        if (batchState.value) {
          if (Number.isInteger(tileIndex)) batchState.value.currentTileIndex = tileIndex;
          if (tile?.id) batchState.value.currentTileId = tile.id;
        }
        // Force reactivity on tile status changes
        batchState.value = { ...batchState.value };
      },
      // onTileComplete
      (tile) => {
        batchState.value = { ...batchState.value };
      },
      // onError
      (tile, error) => {
        console.error(`[Batch] Tile R${tile.row + 1}C${tile.col + 1} failed:`, error);
        batchState.value = { ...batchState.value };
      },
      batchAbortController.signal
    );
  } catch (error) {
    if (error.name !== 'AbortError') {
      console.error('[Batch] Unexpected error:', error);
    }
  } finally {
    batchRunning.value = false;
    batchAbortController = null;
    batchCurrentStep.value = '';
    // Force final state update
    batchState.value = { ...batchState.value };
    savedBatchState.value = loadBatchState();
  }
};

const handleBatchTileDrag = ({ index, lat, lng }) => {
  if (!Number.isInteger(index)) return;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;

  const baseTiles = computeGridTiles(
    center.value,
    resolution.value,
    batchGridCols.value,
    batchGridRows.value,
  );
  const baseTile = baseTiles.find((tile) => tile.index === index);
  if (!baseTile) return;

  const metersPerDegLat = 111320;
  const metersPerDegLng = 111320 * Math.cos(baseTile.center.lat * Math.PI / 180);
  const offsetX = (lng - baseTile.center.lng) * metersPerDegLng;
  const offsetY = (lat - baseTile.center.lat) * metersPerDegLat;

  const current = Array.isArray(batchTileOffsets.value) ? [...batchTileOffsets.value] : [];
  const byIndex = new Map(current.map((entry) => [Number(entry.index), { ...entry }]));
  byIndex.set(index, { index, offsetX, offsetY });

  const next = [...byIndex.values()]
    .filter((entry) => Math.abs(Number(entry.offsetX || 0)) > 0.001 || Math.abs(Number(entry.offsetY || 0)) > 0.001)
    .sort((a, b) => a.index - b.index);

  store.setBatchTileOffsets(next);
};

const handleMapMove = (newCenter) => {
  const oldCenter = center.value;
  store.setCenter(newCenter);

  const keepWorldFixed = batchMode.value
    && !batchRunning.value
    && !showBatchProgress.value
    && batchTileFollowCenter.value === false;

  if (!keepWorldFixed) return;

  const oldTiles = computeGridTilesWithOffsets(
    oldCenter,
    resolution.value,
    batchGridCols.value,
    batchGridRows.value,
    batchTileOffsets.value,
  );
  const newBaseTiles = computeGridTiles(
    newCenter,
    resolution.value,
    batchGridCols.value,
    batchGridRows.value,
  );

  const nextOffsets = oldTiles.map((tile) => {
    const baseTile = newBaseTiles.find((candidate) => candidate.index === tile.index);
    if (!baseTile) return null;

    const metersPerDegLat = 111320;
    const metersPerDegLng = 111320 * Math.cos(baseTile.center.lat * Math.PI / 180);
    const offsetX = (tile.center.lng - baseTile.center.lng) * metersPerDegLng;
    const offsetY = (tile.center.lat - baseTile.center.lat) * metersPerDegLat;

    return { index: tile.index, offsetX, offsetY };
  })
    .filter(Boolean)
    .filter((entry) => Math.abs(Number(entry.offsetX || 0)) > 0.001 || Math.abs(Number(entry.offsetY || 0)) > 0.001)
    .sort((a, b) => a.index - b.index);

  store.setBatchTileOffsets(nextOffsets);
};
</script>
