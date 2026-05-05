<template>
  <!-- Memory Widget — always on top -->
  <div class="fixed bottom-4 left-1/2 -translate-x-1/2 z-[99999] pointer-events-none">
    <MemoryWidget />
  </div>

  <!-- Mobile Restriction Overlay -->
  <MobileRestrictionOverlay />

  <!-- Main Application - Hidden on Mobile -->
  <div class="hidden md:flex h-screen w-full flex-col md:flex-row overflow-hidden bg-white dark:bg-gray-900 text-gray-900 dark:text-white">
    <AppSidebar
      :batch-mode="batchMode"
      :is-dark-mode="isDarkMode"
      :build-main-hash="buildMainHash"
      :build-main-time="buildMainTime"
      :build-dev-hash="buildDevHash"
      :build-dev-time="buildDevTime"
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
        :dev-mode="devMode"
        :terrain-data="terrainData"
        :is-generating="isLoading"
        :generation-cache-key="lastGenerationKey"
        :uploaded-elevation-file="uploadedElevationFile"
        :uploaded-elevation-meta="uploadedElevationMeta"
        :uploaded-asc-coordinate-system="uploadedAscCoordinateSystem"
        :uploaded-area-mode="uploadedAreaMode"
        :processing-meters-per-pixel="processingMetersPerPixel"
        @location-change="handleLocationChange"
        @resolution-change="store.setResolution"
        @update:uploaded-asc-coordinate-system="handleUploadedAscCoordinateSystemChange"
        @update:uploaded-area-mode="handleUploadedAreaModeChange"
        @update:processingMetersPerPixel="handleProcessingMetersPerPixelChange"
        @zoom-change="store.setZoom"
        @generate="handleGenerate"
        @fetch-osm="handleFetchOSM"
        @surrounding-tiles-change="(v) => surroundingTilePositions = v"
        @import-data="handleImportData"
        @elevation-file-selected="handleElevationFileSelected"
        @elevation-file-clear="handleElevationFileClear"
        @show-support="openSupportTip('manual')"
        @export-success="handleSingleExportSuccess"
      />

      <!-- Batch mode -->
      <BatchControlPanel
        v-if="batchMode"
        :center="center"
        :resolution="resolution"
        :processing-meters-per-pixel="processingMetersPerPixel"
        :is-running="batchRunning"
        :saved-state="savedBatchState"
        :tile-offsets="batchTileOffsets"
        :tile-names="batchTileNames"
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
        @update:tile-names="store.setBatchTileNames"
        @update:tile-follow-center="store.setBatchTileFollowCenter"
        @update:processingMetersPerPixel="handleProcessingMetersPerPixelChange"
        @show-support="openSupportTip('manual')"
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
            :processing-meters-per-pixel="processingMetersPerPixel"
            :is-dark-mode="isDarkMode"
            :uploaded-elevation-file="uploadedElevationFile"
            :uploaded-elevation-meta="uploadedElevationMeta"
            :uploaded-area-mode="uploadedAreaMode"
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
                <div class="text-lg font-medium text-white">{{ t('app.loadingScene') }}</div>
              </div>
            </template>
          </Suspense>
        </div>
        
        <!-- Loading Overlay -->
        <div v-if="isLoading" class="absolute inset-0 z-50 flex items-center justify-center bg-white/80 dark:bg-gray-950/80 backdrop-blur-sm">
          <div class="text-center p-8 rounded-2xl bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 shadow-2xl min-w-[300px]">
            <Loader2 :size="48" class="text-[#FF6600] animate-spin mx-auto mb-4" />
            <h3 class="text-xl text-gray-900 dark:text-white font-bold mb-2">{{ t('app.processingTerrain') }}</h3>
            <p class="text-gray-600 dark:text-gray-400 text-sm font-medium mb-4 animate-pulse">{{ loadingStatus }}</p>
            <div v-if="loadingProgressPercent !== null" class="mb-4 w-full max-w-xs mx-auto space-y-1">
              <div class="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2.5 overflow-hidden">
                <div class="h-full rounded-full bg-[#FF6600] transition-all duration-300 ease-out" :style="{ width: loadingProgressPercent + '%' }"></div>
              </div>
              <div class="flex items-center justify-between text-[11px] text-gray-500 dark:text-gray-400">
                <span>{{ loadingProgressPercent.toFixed(0) }}%</span>
                <span v-if="loadingProgressDetail">{{ loadingProgressDetail }}</span>
              </div>
            </div>
            <div class="text-xs text-gray-400 dark:text-gray-500 max-w-xs mx-auto">
                <span v-if="resolution >= 2048">{{ t('app.highResolutionWait') }}</span>
                <span v-if="resolution >= 4096" class="block text-amber-500 mt-1">{{ t('app.veryLargeAreaWait') }}</span>
            </div>
            <button
              @click="cancelGeneration"
              class="mt-5 px-6 py-2 text-sm font-medium text-gray-600 dark:text-gray-300 bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 rounded-lg transition-colors border border-gray-300 dark:border-gray-600"
            >
              {{ t('common.cancel') }}
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

    <!-- Support Tip Modal -->
    <SupportTipModal
      v-if="showSupportTip"
      :context="supportPromptContext"
      :kofi-url="KOFI_URL"
      @close="handleSupportTipClose"
    />
</template>

<script setup>
import { ref, computed, onMounted, onUnmounted } from 'vue';
import { storeToRefs } from 'pinia';
import { useI18n } from 'vue-i18n';
import { useMainStore } from './stores/mainStore';
import { Loader2 } from 'lucide-vue-next';
import MobileRestrictionOverlay from './components/modals/MobileRestrictionOverlay.vue';
import MemoryWidget from './components/ui/MemoryWidget.vue';
import AboutModal from './components/modals/AboutModal.vue';
import DisclaimerModal from './components/modals/DisclaimerModal.vue';
import TechStackModal from './components/modals/TechStackModal.vue';
import SupportTipModal from './components/modals/SupportTipModal.vue';
import ControlPanel from './components/panels/ControlPanel.vue';
import BatchControlPanel from './components/panels/BatchControlPanel.vue';
import BatchProgressModal from './components/modals/BatchProgressModal.vue';
import MapSelector from './components/map/MapSelector.vue';
import Preview3D from './components/three/Preview3D.vue';
import AppSidebar from './components/layout/AppSidebar.vue';
import ViewTabs from './components/ui/ViewTabs.vue';
import { fetchTerrainData, addOSMToTerrain, parseElevationFile, loadTerrainFromUploadedElevation } from './services/terrain';
import { applyAscCoordinateSystem } from './services/ascLoader.js';
import { computeUploadedCropBounds } from './services/uploadBounds';
import {
  computeGridTiles,
  computeGridTilesWithOffsets,
  createBatchJobState,
  getDefaultTileLabel,
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
const { t } = useI18n({ useScope: 'global' });
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
  batchTileNames,
  batchState,
  batchRunning,
  batchCurrentStep,
  showBatchProgress,
  savedBatchState
} = storeToRefs(store);

const showStackInfo = ref(false);
const showAbout = ref(false);
const showDisclaimer = ref(false);
const showSupportTip = ref(false);
const devMode = ref(false);
const supportPromptContext = ref('manual');
const loadingProgressPercent = ref(null);
const loadingProgressDetail = ref('');
const lastLoggedLoadingStatus = ref('');
const lastLoggedLoadingPercent = ref(-1);
let abortController = null;
let batchAbortController = null;

const KOFI_URL = 'https://ko-fi.com/nikluz';
const TIP_LAST_SHOWN_KEY = 'mapng_tip_last_shown_at';
const TIP_SINGLE_COUNT_KEY = 'mapng_tip_single_export_count';
const TIP_COOLDOWN_MS = 24 * 60 * 60 * 1000;
const TIP_SINGLE_EXPORT_INTERVAL = 3;

const markTipShownNow = () => {
  localStorage.setItem(TIP_LAST_SHOWN_KEY, String(Date.now()));
};

const canAutoShowTip = () => {
  const last = Number(localStorage.getItem(TIP_LAST_SHOWN_KEY) || '0');
  return !Number.isFinite(last) || last <= 0 || (Date.now() - last) > TIP_COOLDOWN_MS;
};

const openSupportTip = (context = 'manual') => {
  supportPromptContext.value = context;
  showSupportTip.value = true;
};

const handleSupportTipClose = () => {
  showSupportTip.value = false;
};

const maybePromptSupportAfterSingleExport = () => {
  const currentCount = Number(localStorage.getItem(TIP_SINGLE_COUNT_KEY) || '0');
  const nextCount = Number.isFinite(currentCount) ? currentCount + 1 : 1;
  localStorage.setItem(TIP_SINGLE_COUNT_KEY, String(nextCount));
  const shouldPrompt = (nextCount === 1 || nextCount % TIP_SINGLE_EXPORT_INTERVAL === 0) && canAutoShowTip();
  if (shouldPrompt) {
    openSupportTip('single');
    markTipShownNow();
  }
};

const maybePromptSupportAfterBatchComplete = () => {
  if (!canAutoShowTip()) return;
  openSupportTip('batch');
  markTipShownNow();
};

const handleSingleExportSuccess = () => {
  maybePromptSupportAfterSingleExport();
};

// BYOD upload state shared across upload, map overlay, and generation pipeline.
const uploadedElevationFile = ref(null);   // File | null
const uploadedElevationMeta = ref(null);   // parseElevationFile() result | null
const uploadedAreaMode = ref(localStorage.getItem('mapng_uploaded_area_mode') || 'native');
const uploadedAscCoordinateSystem = ref(localStorage.getItem('mapng_uploaded_asc_crs') || 'auto');
const storedProcessingMpp = Number(localStorage.getItem('mapng_processing_mpp') || 1);
const processingMetersPerPixel = ref(
  Number.isFinite(storedProcessingMpp) && storedProcessingMpp > 0
    ? storedProcessingMpp
    : 1,
);

const getEffectiveProcessingMpp = (value = processingMetersPerPixel.value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
};

const handleProcessingMetersPerPixelChange = (value) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return;
  processingMetersPerPixel.value = parsed;
  localStorage.setItem('mapng_processing_mpp', String(parsed));
};

const applyAscCoordinateSelection = async (meta) => {
  if (!meta || meta.sourceFormat !== 'asc') return meta;

  const selected = String(uploadedAscCoordinateSystem.value || 'auto').toLowerCase();
  if (selected === 'auto') return meta;

  const epsgCode = Number(selected);
  if (!Number.isFinite(epsgCode)) return meta;

  return applyAscCoordinateSystem(meta, epsgCode);
};

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
    Number(resolution.value) * getEffectiveProcessingMpp(),
  ).map((tile) => {
    const customName = (batchTileNames.value || []).find((entry) => Number(entry.index) === tile.index)?.name || '';
    return {
      ...tile,
      customName,
      label: customName || getDefaultTileLabel(tile, batchGridCols.value),
    };
  });
});

// Build info (injected by Vite at build time)
const formatBuildTime = (value) => {
  const raw = String(value || '').trim();
  if (!raw) return 'n/a';
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return raw;
  return parsed.toLocaleString();
};

const buildMainHash = String(__BUILD_MAIN_HASH__ || 'n/a');
const buildMainTime = formatBuildTime(__BUILD_MAIN_TIME__);
const buildDevHash = String(__BUILD_DEV_HASH__ || 'n/a');
const buildDevTime = formatBuildTime(__BUILD_DEV_TIME__);

const { setCenter, setResolution, setBatchMode: setStoreBatchMode } = store;

const isValidCenter = (point) => {
  const lat = Number(point?.lat);
  const lng = Number(point?.lng);
  return Number.isFinite(lat) && Number.isFinite(lng)
    && lat >= -90 && lat <= 90
    && lng >= -180 && lng <= 180;
};

const handleGlobalDevToggleKey = (event) => {
  if (event.defaultPrevented) return;
  const tag = String(event.target?.tagName || '').toLowerCase();
  const isTypingTarget = tag === 'input' || tag === 'textarea' || tag === 'select' || event.target?.isContentEditable;
  if (isTypingTarget) return;

  if (event.code === 'Backquote' || event.key === '`' || event.key === '~') {
    devMode.value = !devMode.value;
    if (!devMode.value && Number(resolution.value) > 8192) {
      setResolution(8192);
    }
  }
};

const setBatchMode = (value) => {
  setStoreBatchMode(value);
  if (value && Number(resolution.value) > 8192) {
    setResolution(8192);
  }
};

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

  window.addEventListener('keydown', handleGlobalDevToggleKey);

});

onUnmounted(() => {
  window.removeEventListener('keydown', handleGlobalDevToggleKey);
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
const buildGenerationKey = (c, res, osm, elevationSource, gpxzKey, uploadedElevationFile = null, elevationUnitOverride = 'auto', processingMpp = 1) => {
  return JSON.stringify({
    lat: c.lat,
    lng: c.lng,
    resolution: res,
    processingMetersPerPixel: processingMpp,
    osm,
    elevationSource,
    gpxzKeySig: elevationSource === 'gpxz' ? signatureForKey(gpxzKey) : '',
    elevationUnitOverride,
    uploadedAscCoordinateSystem: uploadedAscCoordinateSystem.value,
    uploadedAreaMode: uploadedAreaMode.value,
    // Include file identity so changing uploads always invalidates cached terrain.
    uploadedElevation: uploadedElevationFile
      ? `${uploadedElevationFile.name}|${uploadedElevationFile.size}|${uploadedElevationFile.lastModified}`
      : null,
  });
};

const handleElevationFileSelected = async (file) => {
  // New upload always resets generation state because bounds/resolution may change.
  uploadedElevationFile.value = file;
  uploadedElevationMeta.value = null;
  uploadedAreaMode.value = 'native';
  localStorage.setItem('mapng_uploaded_area_mode', 'native');
  uploadedAscCoordinateSystem.value = 'auto';
  localStorage.setItem('mapng_uploaded_asc_crs', 'auto');
  terrainData.value = null;
  lastGenerationKey.value = null;
  try {
    // Parse every supported upload format via a format-neutral service API.
    const meta = await parseElevationFile(file);
    const resolvedMeta = await applyAscCoordinateSelection(meta);
    uploadedElevationMeta.value = resolvedMeta;
    // Auto-centre map if the file contains coordinate metadata
    if (isValidCenter(resolvedMeta.center)) store.setCenter(resolvedMeta.center);
  } catch (e) {
    console.warn('[BYOD] Failed to read file metadata:', e);
  }
};

const handleElevationFileClear = () => {
  uploadedElevationFile.value = null;
  uploadedElevationMeta.value = null;
  uploadedAreaMode.value = 'native';
  localStorage.setItem('mapng_uploaded_area_mode', 'native');
  uploadedAscCoordinateSystem.value = 'auto';
  localStorage.setItem('mapng_uploaded_asc_crs', 'auto');
};

const handleUploadedAscCoordinateSystemChange = async (value) => {
  uploadedAscCoordinateSystem.value = value;
  localStorage.setItem('mapng_uploaded_asc_crs', value);

  const file = uploadedElevationFile.value;
  if (!file) return;
  const ext = file.name.toLowerCase().split('.').pop();
  if (ext !== 'asc') return;

  try {
    const baseMeta = await parseElevationFile(file);
    const resolvedMeta = await applyAscCoordinateSelection(baseMeta);
    uploadedElevationMeta.value = resolvedMeta;
    if (isValidCenter(resolvedMeta.center)) {
      store.setCenter(resolvedMeta.center);
    }
    terrainData.value = null;
    lastGenerationKey.value = null;
  } catch (error) {
    console.warn('[BYOD] Failed to re-parse ASC metadata after CRS change:', error);
  }
};

const handleUploadedAreaModeChange = (value) => {
  uploadedAreaMode.value = value;
  localStorage.setItem('mapng_uploaded_area_mode', value);
};

const applyLoadingUpdate = (update) => {
  if (typeof update === 'string') {
    loadingStatus.value = update;
    loadingProgressPercent.value = null;
    loadingProgressDetail.value = '';
  } else if (update && typeof update === 'object') {
    loadingStatus.value = update.status || loadingStatus.value;
    loadingProgressPercent.value = Number.isFinite(update.percent) ? update.percent : null;
    loadingProgressDetail.value = update.detail || '';
  }

  if (loadingStatus.value && loadingStatus.value !== lastLoggedLoadingStatus.value) {
    console.info(`[Terrain] ${loadingStatus.value}`);
    lastLoggedLoadingStatus.value = loadingStatus.value;
  }

  if (loadingProgressPercent.value !== null) {
    const rounded = Math.floor(loadingProgressPercent.value / 10) * 10;
    if (rounded > lastLoggedLoadingPercent.value) {
      console.info(`[Terrain] ${rounded}% complete${loadingProgressDetail.value ? ` (${loadingProgressDetail.value})` : ''}`);
      lastLoggedLoadingPercent.value = rounded;
    }
  }
};

const handleGenerate = async (showPreview, fetchOSM, elevationSource = 'default', gpxzApiKey = '', elevationUnitOverride = 'auto', processingMpp = 1) => {
  const normalizedSource = String(elevationSource || 'default').toLowerCase();
  const useUSGS = normalizedSource === 'usgs';
  const useGPXZ = normalizedSource === 'gpxz';
  const useKRON86 = normalizedSource === 'kron86';

  const requestKey = buildGenerationKey(
    center.value,
    resolution.value,
    fetchOSM,
    normalizedSource,
    gpxzApiKey,
    uploadedElevationFile.value,
    elevationUnitOverride,
    processingMpp,
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
      Number(cachedParams.processingMetersPerPixel || 1) === Number(newParams.processingMetersPerPixel || 1) &&
      cachedParams.elevationSource === newParams.elevationSource &&
      (cachedParams.gpxzKeySig ?? '') === (newParams.gpxzKeySig ?? '');

    if (requestKey === lastGenerationKey.value) {
      // Exact match — skip fetch entirely, just switch view if needed
      if (showPreview) previewMode.value = true;
      return;
    }

    if (onlyOsmAdded) {
      // Terrain + textures are identical, just add OSM data on top
      isLoading.value = true;
      loadingStatus.value = t('app.status.addingOsm');
      try {
        const updatedData = await addOSMToTerrain(terrainData.value, undefined, (status) => {
          loadingStatus.value = status;
        });
        terrainData.value = updatedData;
        lastGenerationKey.value = requestKey;
        if (showPreview) {
          loadingStatus.value = t('app.status.rendering3d');
          previewMode.value = true;
        }
      } catch (error) {
        console.error("Failed to add OSM data:", error);
        alert(t('app.error.fetchOsm'));
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
  lastLoggedLoadingStatus.value = '';
  lastLoggedLoadingPercent.value = -1;
  loadingProgressPercent.value = null;
  loadingProgressDetail.value = '';
  applyLoadingUpdate(t('app.status.startingGeneration'));
  
  // Flush old data to free memory before loading new large datasets
  if (terrainData.value) {
      terrainData.value = null;
      lastGenerationKey.value = null;
      // Allow a brief moment for Vue to unmount 3D components and trigger disposal
      await new Promise(r => setTimeout(r, 100));
  }

  try {
    let data;
    if (uploadedElevationFile.value) {
      // BYOD path: local upload defines terrain heights while texture/OSM
      // overlays still come from the normal network tile flow.
      const meta = uploadedElevationMeta.value
        ?? await parseElevationFile(uploadedElevationFile.value);
      const targetBounds = uploadedAreaMode.value === 'crop' && meta?.bounds
        ? computeUploadedCropBounds(center.value, Number(resolution.value) * Number(processingMpp || 1), meta.bounds)
        : null;
      const effectiveCenter = meta.center ?? center.value;
      data = await loadTerrainFromUploadedElevation(
        meta,
        effectiveCenter,
        resolution.value,
        fetchOSM,
        applyLoadingUpdate,
        signal,
        {
          elevationUnitOverride,
          processingMetersPerPixel: Number(processingMpp || 1),
          targetBounds,
          preferNativeCoverage: uploadedAreaMode.value !== 'crop',
        },
      );
    } else {
      data = await fetchTerrainData(
        center.value,
        resolution.value,
        fetchOSM,
        useUSGS,
        useGPXZ,
        useKRON86,
        gpxzApiKey,
        undefined,
        applyLoadingUpdate,
        signal,
        {
          processingMetersPerPixel: Number(processingMpp || 1),
        },
      );
    }
    terrainData.value = data;
    lastGenerationKey.value = requestKey;
    
    if (showPreview) {
      applyLoadingUpdate(t('app.status.rendering3d'));
        previewMode.value = true;
    }
  } catch (error) {
    if (error.name === 'AbortError') {
      console.log("Terrain generation cancelled.");
      applyLoadingUpdate(t('app.status.cancelled'));
      return;
    }
    console.error("Failed to generate terrain:", error);
    const byodMessage = String(error?.message || '');
    if (byodMessage) {
      alert(byodMessage);
    } else {
      alert(t('app.error.fetchTerrain'));
    }
  } finally {
    isLoading.value = false;
    loadingProgressPercent.value = null;
    loadingProgressDetail.value = '';
    abortController = null;
  }
};

const handleFetchOSM = async () => {
  if (!terrainData.value) return;
  
  isLoading.value = true;
  loadingStatus.value = t('app.status.fetchingOsm');
  
  try {
      const updatedData = await addOSMToTerrain(terrainData.value, undefined, (status) => {
          loadingStatus.value = status;
      });
      terrainData.value = updatedData;
  } catch (error) {
      console.error("Failed to fetch OSM data:", error);
      alert(t('app.error.fetchOsm'));
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
      if (isValidCenter({ lat, lng })) {
        setCenter({ lat, lng });
      }
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
          'default',
          '',
          null,
          'auto',
          processingMetersPerPixel.value,
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
  const state = createBatchJobState({
    ...config,
    processingMetersPerPixel: getEffectiveProcessingMpp(config.processingMetersPerPixel),
  });
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
    maybePromptSupportAfterBatchComplete();
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
    alert(t('app.error.batchCacheCleared'));
  } catch (error) {
    console.error('[Batch] Failed to clear cache:', error);
    alert(t('app.error.batchCacheClearFailed'));
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
        console.error(`[Batch] Tile ${tile.label || `R${tile.row + 1}C${tile.col + 1}`} failed:`, error);
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
    Number(resolution.value) * getEffectiveProcessingMpp(),
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

  // "World-fixed" mode: when the user pans the map, keep the batch tiles
  // anchored at their geographic positions instead of moving with the grid
  // centre. Achieved by recalculating each tile's offset against the new
  // base grid so the absolute lat/lng stays constant.
  // Only applies when a batch job is not running and the user has opted out
  // of tile-follow-centre (the default is tiles follow the centre).
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
    Number(resolution.value) * getEffectiveProcessingMpp(),
  );
  const newBaseTiles = computeGridTiles(
    newCenter,
    resolution.value,
    batchGridCols.value,
    batchGridRows.value,
    Number(resolution.value) * getEffectiveProcessingMpp(),
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
