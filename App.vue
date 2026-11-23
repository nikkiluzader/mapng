<template>
  <!-- Mobile Restriction Overlay -->
  <MobileRestrictionOverlay />

  <!-- Main Application - Hidden on Mobile -->
  <div class="hidden md:flex h-screen w-full flex-col overflow-hidden bg-white dark:bg-gray-900 text-gray-900 dark:text-white">
  <BackupDataNotice />
  <div class="flex flex-1 min-h-0 w-full flex-row overflow-hidden">
    <AppSidebar
      :batch-mode="batchMode"
      :is-dark-mode="isDarkMode"
      :build-main-hash="buildMainHash"
      :build-main-time="buildMainTime"
      :build-dev-hash="buildDevHash"
      :build-dev-time="buildDevTime"
      @show-about="showAbout = true"
      @show-support="openSupportTip('manual')"
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
        :generation-key-for="generationKeyFor"
        :uploaded-elevation-file="uploadedElevationFile"
        :uploaded-elevation-meta="uploadedElevationMeta"
        :uploaded-asc-coordinate-system="uploadedAscCoordinateSystem"
        :uploaded-no-data-override="uploadedNoDataOverride"
        :uploaded-layer-order="uploadedLayerOrder"
        :elevation-layer-slots="elevationSlots"
        :max-elevation-slots="MAX_ELEVATION_SLOTS"
        :uploaded-area-mode="uploadedAreaMode"
        :processing-meters-per-pixel="processingMetersPerPixel"
        @location-change="handleLocationChange"
        @resolution-change="store.setResolution"
        @update:uploaded-asc-coordinate-system="handleUploadedAscCoordinateSystemChange"
        @update:uploaded-no-data-override="(v) => uploadedNoDataOverride = v"
        @update:uploaded-layer-order="(v) => uploadedLayerOrder = v"
        @update:uploaded-area-mode="handleUploadedAreaModeChange"
        @update:processingMetersPerPixel="handleProcessingMetersPerPixelChange"
        @update:preview-stale="(v) => previewStale = v"
        @zoom-change="store.setZoom"
        @generate="(preview, fetchOSM, elevationSource, gpxzApiKey, elevationUnitOverride, metersPerPixel, gapFillSource, fallbackSource) => handleGenerate(preview, fetchOSM, elevationSource, gpxzApiKey, elevationUnitOverride, metersPerPixel, gapFillSource, fallbackSource)"
        @fetch-osm="handleFetchOSM"
        @surrounding-tiles-change="(v) => surroundingTilePositions = v"
        @elevation-file-selected="handleElevationFileSelected"
        @elevation-file-clear="handleElevationFileClear"
        @elevation-slot-selected="handleElevationSlotSelected"
        @elevation-slot-removed="handleElevationSlotRemoved"
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
    <!-- (isolate: the map and the previews stack among themselves. Their own controls sit at z 500 to 1000, as
         Leaflet's do, and without this they lay on top of every window that opens over the page: the 2D
         preview's settings box over the export's "done" window and the support card) -->
    <main class="flex-1 relative isolate flex flex-col h-full bg-gray-100 dark:bg-gray-950">
      <!-- Memory widget: centred on the map area (not the window, where it covered
           the elevation minimap's legend), above the map, below dialogs -->
      <div class="absolute bottom-4 left-1/2 -translate-x-1/2 z-30 pointer-events-none">
        <!-- the site was deployed while this page stayed open: its older parts stop working (services/appUpdate.js) -->
        <div
          v-if="appUpdated && !updateNoticeHidden" data-testid="app-updated" role="alert"
          class="fixed left-1/2 top-20 z-[100000] flex w-[min(92vw,34rem)] -translate-x-1/2 items-start gap-3 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-950 shadow-lg dark:border-amber-600 dark:bg-amber-950 dark:text-amber-50"
        >
          <div class="min-w-0 flex-1">
            <p class="font-semibold">{{ t('app.updated.title') }}</p>
            <p class="mt-0.5 leading-snug">{{ t('app.updated.body') }}</p>
          </div>
          <div class="flex shrink-0 flex-col gap-1.5">
            <button type="button" class="rounded bg-brand px-3 py-1.5 text-xs font-semibold text-white hover:bg-brand-500" @click="reloadForUpdate">{{ t('app.updated.reload') }}</button>
            <button type="button" class="rounded px-3 py-1 text-xs underline" @click="updateNoticeHidden = true">{{ t('app.updated.later') }}</button>
          </div>
        </div>
        <MemoryWidget />
      </div>
      <!-- the live Network activity panel, docked at the map area's lower left (above the map, below dialogs) -->
      <NetworkMonitor />
      <ViewTabs
        :view-mode="viewMode"
        :can-preview="!!terrainData"
        @switch="(mode) => { viewMode = mode; }"
      />

      <!-- Views -->
      <div class="flex-1 relative w-full h-full">
        <!-- Map View -->
        <div :class="['absolute inset-0 transition-all duration-500', viewMode !== 'location' ? 'opacity-0 invisible' : 'opacity-100 visible']">
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
            :batch-grid-follows-center="batchGridFollowsCenter"
            :batch-editable="batchMode && !batchRunning && !showBatchProgress"
            :box-locked="store.boxLocked"
            @move="handleMapMove" 
            @zoom="store.setZoom"
            @batch-tile-drag="handleBatchTileDrag"
          />
        </div>
        
        <!-- the settings changed since this was generated: said over either preview -->
          <div
            v-if="previewStale && viewMode !== 'location' && terrainData"
            class="absolute top-4 left-1/2 -translate-x-1/2 z-[700] flex items-center gap-2 px-4 py-2 rounded-lg bg-amber-500/95 text-white text-sm font-medium shadow-lg pointer-events-none"
          >
            <AlertTriangle :size="15" class="shrink-0" />
            {{ t('controlPanel.previewOutOfDate') }}
          </div>

        <!-- 2D preview: the generated area flat, with what will be built -->
        <div :class="['absolute inset-0 transition-all duration-500', viewMode === 'preview2d' ? 'opacity-100 visible' : 'opacity-0 invisible pointer-events-none']">
          <Preview2D v-if="terrainData && viewMode === 'preview2d'" :terrain-data="terrainData" />
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
                <Loader2 class="animate-spin text-brand" :size="48" />
                <div class="text-lg font-medium text-white">{{ t('app.loadingScene') }}</div>
              </div>
            </template>
          </Suspense>
        </div>
        
        <!-- Loading Overlay: the stage card (components/ui/StageLoader.vue), fed by
             services/generationProgress.js -->
        <div v-if="isLoading" class="absolute inset-0 z-50 flex items-center justify-center p-4 pb-28 overflow-y-auto bg-gray-900/10 dark:bg-black/25">
          <StageLoader
            :title="t('app.processingTerrain')"
            :finished="loadingFinished"
            :steps="generationSteps"
            :active-stage="loadingStage"
            :active-fraction="loadingStageFraction"
            :pct="loadingOverallPct"
            :status="loadingStatus"
            :done="loadingDone"
            :elapsed-ms="loadingElapsedMs"
            :elapsed-label="t('exportPanel.elapsed')"
            cancellable
            :cancel-label="t('common.cancel')"
            @cancel="cancelGeneration"
          />
        </div>
      </div>
    </main>

    <!-- Desktop app: the MapNG levels in the mods folder -->
    <LevelsSidebar v-if="desktopApp" ref="levelsSidebar" @show-on-map="handleShowLevelOnMap" @modify="handleModifyLevel" />
    <DesktopWelcome v-if="desktopApp" />
    <HotspotsPrivacy />
    <ReportDialog />
    <UnfinishedJobNotice />
  </div>
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
import { ref, shallowRef, computed, watch, onMounted, onUnmounted, nextTick } from 'vue';
import { getLoadedOsmFile, onOsmFileChange } from './services/osmFile.js';
import { storeToRefs } from 'pinia';
import { useI18n } from 'vue-i18n';
import { useMainStore } from './stores/mainStore';
import { Loader2, AlertTriangle } from 'lucide-vue-next';
import MobileRestrictionOverlay from './components/modals/MobileRestrictionOverlay.vue';
import MemoryWidget from './components/ui/MemoryWidget.vue';
import NetworkMonitor from './components/ui/NetworkMonitor.vue';
import { startNetworkMonitor } from './composables/useNetworkMonitor.js';
// (counted from the page's first request, whether the panel is open or not)
startNetworkMonitor();
import { appUpdated, codeFailed } from './services/appUpdate.js';
import { isDiskFull, isOutOfMemory } from './services/errorText.js';
import { useMeasureRoadWidths } from './composables/useMeasureRoadWidths.js';
import AboutModal from './components/modals/AboutModal.vue';
import DisclaimerModal from './components/modals/DisclaimerModal.vue';
import TechStackModal from './components/modals/TechStackModal.vue';
import SupportTipModal from './components/modals/SupportTipModal.vue';
import ControlPanel from './components/panels/ControlPanel.vue';
import BatchControlPanel from './components/panels/BatchControlPanel.vue';
import BatchProgressModal from './components/modals/BatchProgressModal.vue';
import MapSelector from './components/map/MapSelector.vue';
import Preview3D from './components/three/Preview3D.vue';
import Preview2D from './components/map/Preview2D.vue';
import AppSidebar from './components/layout/AppSidebar.vue';
import LevelsSidebar from './components/layout/LevelsSidebar.vue';
import DesktopWelcome from './components/modals/DesktopWelcome.vue';
import HotspotsPrivacy from './components/modals/HotspotsPrivacy.vue';
import ReportDialog from './components/modals/ReportDialog.vue';
import UnfinishedJobNotice from './components/ui/UnfinishedJobNotice.vue';
import { markJobStart, markJobEnd } from './services/sessionGuard.js';
import { heavyJobRunning } from './services/heavyJob.js';
import { currentSessionCode } from './composables/useReportDialog.js';
import { openReportDialog, logPathFrom } from './composables/useReportDialog.js';
import ViewTabs from './components/ui/ViewTabs.vue';
import BackupDataNotice from './components/ui/BackupDataNotice.vue';
import { createGenerationProgress, GENERATION_STEP_GROUPS } from './services/generationProgress.js';
import { terrainGenerationOptions } from './composables/useTerrainMode.js';
import { useBaseTexture } from './composables/useBaseTexture.js';
import { texturesToGenerate, ensureTexture, hasTexture, textureKindOf } from './services/textureOnDemand.js';
import StageLoader from './components/ui/StageLoader.vue';
import { Compass, Mountain, Grid3x3, Map as MapIcon, Shovel, Paintbrush } from 'lucide-vue-next';
import { fetchTerrainData, addOSMToTerrain, parseElevationFile, loadTerrainFromUploadedElevation } from './services/terrain';
import { desktopApp, fetchTerrainDataOnDesktop, generateNextFromLevel } from './services/platform/desktop.js';
import { applyExportSettings } from './services/exportSettings.js';
import { releaseUploadRasterCache } from './services/resamplerClient';
import { applyAscCoordinateSystem } from './services/ascLoader.js';
import { NODATA_AUTO } from './services/nodataDetect.js';
import { mergeElevationSlots } from './services/tifLoader.js';
import { DEFAULT_GAP_FILL_SOURCE } from './services/gapFillSources.js';
import { normalizeFallbackSource } from './services/elevationFallback.js';
import { computeUploadedCropBounds, nativeSquareAt } from './services/uploadBounds';
import { layoutGrid, WEB_MAX_SIDE, tilesFromTerrain, tilesFrame } from './services/tileLayout.js';
import { needsChunks } from './services/chunkedGenerate.js';
import { corridorGrid } from './services/roadCorridor.js';
import { stretchBetween, cumulative } from './services/roadPick.js';
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
// (the "MapNG was updated" notice: services/appUpdate.js)
const updateNoticeHidden = ref(false);
const reloadForUpdate = () => { window.location.reload(); };
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
  viewMode,
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

// The ground texture looked at or exported, when Generate did not paint it: painted now, once, from what the
// Generate already holds (no download). The previews and the export panel hear of it through store.texturesMade.
const { baseTexture } = useBaseTexture();
watch(() => [baseTexture.value, store.terrainData], async ([choice, td]) => {
  const kind = textureKindOf(choice);
  if (!kind || !td || hasTexture(td, kind) || !(td.osmFeatures?.length > 0)) return;
  store.texturePreparing = kind;
  try { if (await ensureTexture(td, kind) && store.terrainData === td) store.texturesMade++; }
  catch (e) { console.warn(`[Textures] the ${kind} texture could not be prepared:`, e?.message || e); }
  finally { if (store.texturePreparing === kind) store.texturePreparing = ''; }
});
// (the 3D preview stops drawing while Generate runs: services/heavyJob.js; an export sets it itself)
watch(isLoading, (loading) => { heavyJobRunning.value = !!loading; });

const showStackInfo = ref(false);
const showAbout = ref(false);
const showDisclaimer = ref(false);
const showSupportTip = ref(false);
const devMode = ref(false);
const supportPromptContext = ref('manual');
const loadingProgressPercent = ref(null);
const loadingProgressDetail = ref('');
// Overall generation progress: stages weighted by their time, the steps
// finished ({ step, durationMs }) and the time since the run began.
const loadingOverallPct = ref(0);
const loadingDone = ref([]);
const loadingElapsedMs = ref(0);
let generationProgress = null;
let generationTimer = null;
let generationStartedAt = 0;
const formatStepDuration = (ms) => {
  if (!Number.isFinite(ms)) return '';
  if (ms < 1000) return `${Math.round(ms)} ms`;
  const sec = Math.round(ms / 1000);
  return sec < 60 ? `${sec} s` : `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
};
const loadingStage = ref(null);
const loadingStageFraction = ref(0);
const loadingWeights = ref({});
const GENERATION_STEP_ICONS = { prepare: Compass, elevation: Mountain, terrain: Grid3x3, mapData: MapIcon, shaping: Shovel, textures: Paintbrush };
const generationSteps = computed(() => GENERATION_STEP_GROUPS.map((g) => ({
  key: g.key,
  label: t(`progressStages.generate.${g.key}`),
  icon: GENERATION_STEP_ICONS[g.key],
  members: g.members.map((m) => [m, Number(loadingWeights.value[m]) || 0]),
})));
const applyGenerationProgress = ({ pct, completed, stage, stageFraction }) => {
  loadingOverallPct.value = pct;
  if (stage) { loadingStage.value = stage; loadingStageFraction.value = stageFraction ?? 0; }
  if (completed) loadingDone.value = [...loadingDone.value, completed];
};
const startGenerationProgress = (options) => {
  stopGenerationProgress();
  generationProgress = createGenerationProgress(options);
  loadingWeights.value = generationProgress.weights;
  loadingStage.value = null;
  loadingStageFraction.value = 0;
  generationStartedAt = performance.now();
  loadingOverallPct.value = 0;
  loadingDone.value = [];
  loadingElapsedMs.value = 0;
  // the creep on silent steps and the elapsed time move between messages
  generationTimer = setInterval(() => {
    loadingElapsedMs.value = performance.now() - generationStartedAt;
    if (generationProgress) applyGenerationProgress(generationProgress.tick());
  }, 200);
};
const stopGenerationProgress = () => {
  if (generationTimer) clearInterval(generationTimer);
  generationTimer = null;
  generationProgress = null;
};
const lastLoggedLoadingStatus = ref('');
const lastLoggedLoadingPercent = ref(-1);
let abortController = null;
let batchAbortController = null;
// The raw job object runBatchJob mutates. batchState holds shallow copies of it
// for reactivity, so anything that must reach the runner writes here.
let batchLiveState = null;

const KOFI_URL = 'https://ko-fi.com/nikluz';
const TIP_LAST_SHOWN_KEY = 'mapng_tip_last_shown_at';
const TIP_COOLDOWN_MS = 24 * 60 * 60 * 1000;

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

// (after a finished export, at most once a day: TIP_COOLDOWN_MS; the header's heart opens it any time)
const maybePromptSupportAfterSingleExport = () => {
  if (!canAutoShowTip()) return;
  openSupportTip('single');
  markTipShownNow();
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
// Flattened view of every slot's files, kept for the consumers that only care
// whether a custom upload is active (map overlay, cache key, generate path).
const uploadedElevationFile = computed(() => {
  const files = elevationSlots.value.flatMap((slot) => slot.files || []);
  if (files.length === 0) return null;
  return files.length === 1 ? files[0] : files;
});
const uploadedElevationMeta = ref(null);   // parseElevationFile() result | null
const uploadedAreaMode = ref(localStorage.getItem('mapng_uploaded_area_mode') || 'native');
const previewStale = ref(false);   // 3D preview no longer matches current upload settings
const uploadedAscCoordinateSystem = ref(localStorage.getItem('mapng_uploaded_asc_crs') || 'auto');
// Belongs to the current upload (the detected fill value is a property of those
// files), so it is deliberately not persisted and resets with every new upload.
const uploadedNoDataOverride = ref(NODATA_AUTO);
// Layer priority for the current upload, as an array of layer ids. Null means
// "as detected" (newest survey first); also per-upload, so never persisted.
const uploadedLayerOrder = ref(null);
// 0.1-10 m/px (components/controls/ProcessingResolutionInput.vue): saved
// values and loaded session configs are held to it too
const PROCESSING_MPP_MIN = 0.1;
const PROCESSING_MPP_MAX = 10;
const normalizeProcessingMpp = (value) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return 1;
  return Number(Math.min(PROCESSING_MPP_MAX, Math.max(PROCESSING_MPP_MIN, parsed)).toFixed(10));
};

const storedProcessingMpp = normalizeProcessingMpp(localStorage.getItem('mapng_processing_mpp') || 1);
const processingMetersPerPixel = ref(
  storedProcessingMpp,
);

const getEffectiveProcessingMpp = (value = processingMetersPerPixel.value) => normalizeProcessingMpp(value);

const handleProcessingMetersPerPixelChange = (value, { force = false } = {}) => {
  // (background areas lock the box: its size too)
  if (store.boxLocked && !force) return;
  const parsed = normalizeProcessingMpp(value);
  processingMetersPerPixel.value = parsed;
  localStorage.setItem('mapng_processing_mpp', String(parsed));
};

const applyAscCoordinateSelection = async (meta) => {
  const sourceFormat = String(meta?.sourceFormat || '').toLowerCase();
  if (!meta || (sourceFormat !== 'asc' && sourceFormat !== 'asc-multi')) return meta;

  const selected = String(uploadedAscCoordinateSystem.value || 'auto').toLowerCase();
  if (selected === 'auto') return meta;

  const epsgCode = Number(selected);
  if (!Number.isFinite(epsgCode)) return meta;

  return applyAscCoordinateSystem(meta, epsgCode);
};

// Compute batch grid tiles for map overlay (live preview while configuring)
// The preview grid is laid out around the map centre (it moves with a drag);
// a job's own tiles, or "Tiles follow map center" turned off, stay where they
// are on the map. (MapSelector draws a following grid at the live centre.)
const batchGridFollowsCenter = computed(() => {
  if (!batchMode.value || batchTileFollowCenter.value === false) return false;
  const status = batchState.value?.status;
  return !(batchState.value && (showBatchProgress.value || batchRunning.value || ['running', 'paused', 'pending'].includes(status)));
});
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
// (desktop app: after a crash, the offer to send its report; Help -> Report a
// Problem opens the dialog with the current area)
let stopReportMenu = null;
onMounted(async () => {
  window.addEventListener('keydown', handleGlobalDevToggleKey);
  if (desktopApp?.onOpenReport) {
    stopReportMenu = desktopApp.onOpenReport(({ kind } = {}) => openReportDialog(kind || 'manual', {
      area: { lat: center.value.lat, lng: center.value.lng, resolution: resolution.value, metersPerPixel: Number(processingMetersPerPixel.value || 1) },
    }));
  }
  try {
    const crashed = await desktopApp?.pendingCrash?.();
    if (crashed) openReportDialog('crash', { error: crashed.error || '' });
  } catch { /* none */ }
});

onUnmounted(() => {
  stopReportMenu?.();
  window.removeEventListener('keydown', handleGlobalDevToggleKey);
});

const handleLocationChange = (newCenter) => {
  if (store.boxLocked) return;
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
const { on: measureRoadWidthsOn } = useMeasureRoadWidths();
// (the map data file loaded in Map data, kept here so the generation key follows it)
const loadedOsmFile = shallowRef(getLoadedOsmFile());
onOsmFileChange((f) => { loadedOsmFile.value = f; });
const buildGenerationKey = (c, res, osm, elevationSource, gpxzKey, uploadedElevationFile = null, elevationUnitOverride = 'auto', processingMpp = 1, gapFillSource = DEFAULT_GAP_FILL_SOURCE, fallbackSource = 'standard') => {
  const uploadSignature = Array.isArray(uploadedElevationFile)
    ? uploadedElevationFile
        .map((file) => `${file.name}|${file.size}|${file.lastModified}`)
        .sort()
        .join('||')
    : (uploadedElevationFile
      ? `${uploadedElevationFile.name}|${uploadedElevationFile.size}|${uploadedElevationFile.lastModified}`
      : null);

  return JSON.stringify({
    lat: c.lat,
    lng: c.lng,
    resolution: res,
    // (tiles in step 1: the layout changes the map; one tile adds nothing, so a single square's key is as before)
    ...(store.areaMode === 'road' && !store.batchMode ? { road: store.road ? [store.road.pts.length, Math.round(store.road.startM), Math.round(store.road.endM), store.roadHalfWidthM, store.road.pts[0]?.lat, store.road.pts.at(-1)?.lng] : null }
      : store.tiles.length > 1 ? { tiles: store.tiles.map((t) => [Math.round(t.dx * 1e4), Math.round(t.dy * 1e4)]) } : {}),
    processingMetersPerPixel: processingMpp,
    osm,
    elevationSource,
    gpxzKeySig: elevationSource === 'gpxz' ? signatureForKey(gpxzKey) : '',
    elevationUnitOverride,
    uploadedAscCoordinateSystem: uploadedAscCoordinateSystem.value,
    uploadedNoDataOverride: uploadedNoDataOverride.value,
    uploadedLayerOrder: uploadedLayerOrder.value,
    gapFillSource,
    // (the source tried when the chosen one has nothing here: another fallback generates again)
    fallbackSource: normalizeFallbackSource(fallbackSource, elevationSource),
    uploadedAreaMode: uploadedAreaMode.value,
    rawTerrain: store.rawTerrainActive,
    // (Map data > Measure road widths from the satellite picture: it changes the roads Generate makes. Left
    // out of this key, switching it after a Generate did nothing: the same map was shown again, "changing
    // this does not even let you re-generate map", a tester)
    measureWidths: !!osm && measureRoadWidthsOn.value,
    // (the Terrain choice's generation passes: changing one generates again)
    generationEdits: terrainGenerationOptions(store.advancedMode),
    // Include file identity so changing uploads always invalidates cached terrain.
    uploadedElevation: uploadSignature,
    // (a map data file loaded in Map data: another file, or the same one loaded again, is other map data)
    osmFile: osm && loadedOsmFile.value ? [loadedOsmFile.value.name, loadedOsmFile.value.size, loadedOsmFile.value.loadedAt] : null,
    // (background areas change what is fetched and kept)
    backgroundMask: store.backgroundActive ? store.backgroundMask : null,
  });
};

// The key of what the panel's current choices would generate: the panel compares it with the key of the map on
// screen to say whether that map is current. One builder for both, so the two can never disagree. (They did: the
// panel held its own copy of some of the key's fields. With an uploaded elevation file it always offered Generate,
// which then found the key unchanged and did nothing: report MR-QWXXKH; and it knew nothing of tiles or a road.)
const generationKeyFor = (fetchOSM, elevationSource, gpxzApiKey, elevationUnitOverride, processingMpp, gapFillSource, fallbackSource) => buildGenerationKey(
  center.value, resolution.value, fetchOSM, String(elevationSource || 'default').toLowerCase(), gpxzApiKey, uploadedElevationFile.value,
  elevationUnitOverride, processingMpp, gapFillSource, fallbackSource,
);

// ── Elevation layer slots ───────────────────────────────────────────────────
// Slot 0 is the base upload; each slot after it is a fallback the user added,
// consulted only where everything above it has no data. Each slot keeps its own
// parsed metadata so adding a fallback never re-reads the rasters already held.
const MAX_ELEVATION_SLOTS = 5;
const elevationSlots = ref([]); // [{ id, files: File[], meta, error }]
let elevationSlotSeq = 0;

const rebuildMergedUpload = () => {
  const merged = mergeElevationSlots(elevationSlots.value);
  uploadedElevationMeta.value = merged;
  return merged;
};

const resetUploadDerivedState = () => {
  uploadedAreaMode.value = 'native';
  localStorage.setItem('mapng_uploaded_area_mode', 'native');
  uploadedAscCoordinateSystem.value = 'auto';
  localStorage.setItem('mapng_uploaded_asc_crs', 'auto');
  uploadedNoDataOverride.value = NODATA_AUTO;
  uploadedLayerOrder.value = null;
  terrainData.value = null;
  lastGenerationKey.value = null;
};

// (a point cloud that names no coordinate system: its best guess ranked by the area on the map, or the system the
// user picked in the upload's Coordinate system list)
const uploadParseOpts = () => {
  const picked = Number(uploadedAscCoordinateSystem.value);
  return { near: isValidCenter(store.center) ? { lat: store.center.lat, lng: store.center.lng } : null, ...(Number.isFinite(picked) && picked > 0 ? { forceEpsg: picked } : {}) };
};
const parseSlotFiles = async (files) => {
  const selected = files.length > 1 ? files : files[0];
  const meta = await parseElevationFile(selected, uploadParseOpts());
  return applyAscCoordinateSelection(meta);
};

const handleElevationFileSelected = async (fileOrFiles) => {
  const files = (Array.isArray(fileOrFiles) ? fileOrFiles : [fileOrFiles]).filter(Boolean);
  if (files.length === 0) return;

  // Replacing the base upload replaces the whole stack: fallbacks were chosen
  // to complement a specific base and mean nothing without it.
  elevationSlots.value = [{ id: `slot_${++elevationSlotSeq}`, files, meta: null, error: null }];
  uploadedElevationMeta.value = null;
  resetUploadDerivedState();
  try {
    const resolvedMeta = await parseSlotFiles(files);
    elevationSlots.value = [{ ...elevationSlots.value[0], meta: resolvedMeta }];
    const merged = rebuildMergedUpload();
    // (an upload picks its own area: background areas drawn for the old box go)
    if (isValidCenter(merged?.center)) { store.clearBackgroundMask(); store.setCenter(merged.center, { force: true }); }
  } catch (e) {
    console.warn('[BYOD] Failed to read file metadata:', e);
    elevationSlots.value = [{ ...elevationSlots.value[0], error: e.message || t('upload.readFailed') }];
  }
};

const handleElevationSlotSelected = async (slotIndex, fileOrFiles) => {
  const files = (Array.isArray(fileOrFiles) ? fileOrFiles : [fileOrFiles]).filter(Boolean);
  if (files.length === 0) return;
  if (slotIndex === 0) return handleElevationFileSelected(files);
  if (slotIndex >= MAX_ELEVATION_SLOTS) return;

  const slots = [...elevationSlots.value];
  slots[slotIndex] = { id: `slot_${++elevationSlotSeq}`, files, meta: null, error: null };
  elevationSlots.value = slots;
  uploadedLayerOrder.value = null;
  terrainData.value = null;
  lastGenerationKey.value = null;

  try {
    const resolvedMeta = await parseSlotFiles(files);
    const base = elevationSlots.value[0]?.meta;
    // Mixed source types cannot share one resample pass — the worker samples
    // either GeoTIFF tiles or grid tiles, not both.
    if (base && resolvedMeta.sourceType !== base.sourceType) {
      throw new Error(t('upload.fallbackFormatMismatch', { format: base.sourceType }));
    }
    const next = [...elevationSlots.value];
    next[slotIndex] = { ...next[slotIndex], meta: resolvedMeta };
    elevationSlots.value = next;
    rebuildMergedUpload();
  } catch (e) {
    console.warn('[BYOD] Failed to read fallback layer metadata:', e);
    const next = [...elevationSlots.value];
    next[slotIndex] = { ...next[slotIndex], error: e.message || t('upload.readFailed') };
    elevationSlots.value = next;
  }
};

const handleElevationSlotRemoved = (slotIndex) => {
  if (slotIndex === 0) return handleElevationFileClear();
  elevationSlots.value = elevationSlots.value.filter((_, i) => i !== slotIndex);
  uploadedLayerOrder.value = null;
  terrainData.value = null;
  lastGenerationKey.value = null;
  rebuildMergedUpload();
};

const handleElevationFileClear = () => {
  elevationSlots.value = [];
  uploadedElevationMeta.value = null;
  uploadedAreaMode.value = 'native';
  localStorage.setItem('mapng_uploaded_area_mode', 'native');
  uploadedAscCoordinateSystem.value = 'auto';
  localStorage.setItem('mapng_uploaded_asc_crs', 'auto');
  uploadedNoDataOverride.value = NODATA_AUTO;
  uploadedLayerOrder.value = null;
  // Free the worker-resident copy of the uploaded rasters (can be GBs).
  releaseUploadRasterCache();
};

const handleUploadedAscCoordinateSystemChange = async (value) => {
  uploadedAscCoordinateSystem.value = value;
  localStorage.setItem('mapng_uploaded_asc_crs', value);

  const fileOrFiles = uploadedElevationFile.value;
  if (!fileOrFiles) return;
  const files = Array.isArray(fileOrFiles) ? fileOrFiles : [fileOrFiles];
  // (a point cloud with a guessed coordinate system: parsed again in the one picked, the map moved to it)
  const allLaz = files.length > 0 && files.every((file) => /\.(laz|las)$/i.test(String(file?.name || '')));
  if (allLaz) {
    try {
      const meta = await parseElevationFile(fileOrFiles, uploadParseOpts());
      if (elevationSlots.value.length) elevationSlots.value = [{ ...elevationSlots.value[0], meta }, ...elevationSlots.value.slice(1)];
      const merged = elevationSlots.value.length ? rebuildMergedUpload() : (uploadedElevationMeta.value = meta);
      if (isValidCenter(merged?.center)) store.setCenter(merged.center, { force: true });
      terrainData.value = null;
      lastGenerationKey.value = null;
    } catch (error) {
      console.warn('[BYOD] Failed to re-parse the point cloud after a coordinate system change:', error);
    }
    return;
  }
  const allAsc = files.length > 0
    && files.every((file) => String(file?.name || '').toLowerCase().endsWith('.asc'));
  if (!allAsc) return;

  try {
    const baseMeta = await parseElevationFile(fileOrFiles);
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
  if (generationProgress) applyGenerationProgress(generationProgress.update(loadingStatus.value, loadingProgressPercent.value));

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

const handleGenerate = async (showPreview, fetchOSM, elevationSource = 'default', gpxzApiKey = '', elevationUnitOverride = 'auto', processingMpp = 1, gapFillSource = DEFAULT_GAP_FILL_SOURCE, fallbackSource = 'standard') => {
  // The website, at a size a browser tab does not finish (8192 and up: the tab's memory limit): asked first.
  if (!desktopApp && Number(resolution.value) >= 8192 && !window.confirm(t(Number(resolution.value) >= 16384 ? 'controlPanel.browserSizeConfirm16k' : 'controlPanel.browserSizeConfirm8k'))) return;
  const normalizedSource = String(elevationSource || 'default').toLowerCase();
  const useUSGS = normalizedSource === 'usgs';
  const useGPXZ = normalizedSource === 'gpxz';
  const useKRON86 = normalizedSource === 'kron86';
  const useFlat = normalizedSource === 'none';
  const raw = store.rawTerrainActive;
  // (the Terrain choice: Custom picks the generation passes; raw is Untouched)
  const { raw: _rawChoice, ...generationEdits } = terrainGenerationOptions(store.advancedMode);
  const requestKey = buildGenerationKey(
    center.value,
    resolution.value,
    fetchOSM,
    normalizedSource,
    gpxzApiKey,
    uploadedElevationFile.value,
    elevationUnitOverride,
    processingMpp,
    gapFillSource,
    fallbackSource
  );

  // If we already have terrain data for the exact same parameters, reuse it
  if (terrainData.value && lastGenerationKey.value) {
    const cachedParams = JSON.parse(lastGenerationKey.value);
    const newParams = JSON.parse(requestKey);

    // Check if only the OSM toggle changed (was off, now on). Only for
    // uploads and flat terrain: every other source aligns and levels its
    // roads during generation, which needs the OSM data, so adding OSM
    // regenerates.
    const onlyOsmAdded =
      !cachedParams.osm && newParams.osm &&
      (useFlat || !!uploadedElevationFile.value) &&
      cachedParams.lat === newParams.lat &&
      cachedParams.lng === newParams.lng &&
      cachedParams.resolution === newParams.resolution &&
      Number(cachedParams.processingMetersPerPixel || 1) === Number(newParams.processingMetersPerPixel || 1) &&
      cachedParams.elevationSource === newParams.elevationSource &&
      !!cachedParams.rawTerrain === !!newParams.rawTerrain &&
      JSON.stringify(cachedParams.generationEdits || null) === JSON.stringify(newParams.generationEdits || null) &&
      (cachedParams.gpxzKeySig ?? '') === (newParams.gpxzKeySig ?? '');

    if (requestKey === lastGenerationKey.value) {
      // Exact match — skip fetch entirely, just switch view if needed
      openPreviewAfterGenerate();
      return;
    }

    if (onlyOsmAdded) {
      // Terrain + textures are identical, just add OSM data on top
      isLoading.value = true;
      startGenerationProgress({ resolution: resolution.value, includeOSM: true, startAt: 'osm' });
      applyLoadingUpdate(t('app.status.addingOsm'));
      try {
        const updatedData = await addOSMToTerrain(terrainData.value, undefined, applyLoadingUpdate);
        terrainData.value = updatedData;
        lastGenerationKey.value = requestKey;
        warnIfOsmUnavailable(updatedData);
        openPreviewAfterGenerate();
      } catch (error) {
        console.error("Failed to add OSM data:", error);
        alert(t('app.error.fetchOsm'));
      } finally {
        isLoading.value = false;
        stopGenerationProgress();
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
  // (what this run will do: Raw terrain skips the ground filter and road shaping, the source sets the elevation stage)
  startGenerationProgress({
    resolution: resolution.value, includeOSM: !!fetchOSM, upload: !!uploadedElevationFile.value,
    raw, flat: useFlat, source: uploadedElevationFile.value ? 'upload' : normalizedSource,
    groundFilter: generationEdits.groundFilter, smoothRoads: generationEdits.smoothRoads,
  });
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
      const parsedMeta = uploadedElevationMeta.value ?? rebuildMergedUpload();
      if (!parsedMeta) throw new Error(t('app.error.uploadUnreadable'));
      // The upload card can override the no-data value the loader detected.
      const meta = { ...parsedMeta, noDataOverride: uploadedNoDataOverride.value };
      // (native mode: the power-of-two square the user placed inside the file, at the map's centre: built as that square
      // alone, its own size and resolution; the file's middle when the centre is outside the file)
      const nativeSquare = uploadedAreaMode.value !== 'crop' && meta?.bounds ? nativeSquareAt(meta, Number(processingMpp || 1), center.value) : null;
      const targetBounds = uploadedAreaMode.value === 'crop' && meta?.bounds
        ? computeUploadedCropBounds(center.value, Number(resolution.value) * Number(processingMpp || 1), meta.bounds)
        : nativeSquare?.bounds || null;
      const effectiveCenter = meta.center ?? center.value;
      data = await loadTerrainFromUploadedElevation(
        meta,
        effectiveCenter,
        nativeSquare ? nativeSquare.sizePx : resolution.value,
        fetchOSM,
        applyLoadingUpdate,
        signal,
        {
          elevationUnitOverride,
          gapFillSource,
          gpxzApiKey,
          layerOrder: uploadedLayerOrder.value,
          processingMetersPerPixel: nativeSquare ? nativeSquare.effMpp : Number(processingMpp || 1),
          targetBounds,
          preferNativeCoverage: uploadedAreaMode.value !== 'crop',
          raw,
          ...generationEdits,
          ...texturesToGenerate(baseTexture.value),
        },
      );
    } else {
      const generationOptions = {
        processingMetersPerPixel: Number(processingMpp || 1),
        flat: useFlat,
        raw,
        useMapterhorn: normalizedSource === 'mapterhorn',
        // (the source tried when this one has nothing here, before the global 30 m: services/elevationFallback.js)
        fallbackSource: normalizeFallbackSource(fallbackSource, normalizedSource),
        ...generationEdits,
        // (all three textures, every time: services/textureOnDemand.js)
        ...texturesToGenerate(baseTexture.value),
        // (a plain copy: it goes to a worker / the desktop app)
        // (not with several tiles: the mask belongs to the first tile's box)
        ...(store.backgroundActive && store.tiles.length < 2 && store.areaMode !== 'road' ? { backgroundMask: JSON.parse(JSON.stringify(store.backgroundMask)) } : {}),
        // (the desktop app keeps these with the level's project, so Modify
        // brings the points back; they never change the terrain made)
        ...(desktopApp && store.points.length ? { points: JSON.parse(JSON.stringify(store.points)) } : {}),
      };
      // tiles in step 1 (services/tileLayout.js): one map over their footprint. The grid is the footprint's bounding
      // rectangle centred on its middle; a footprint that fills a power-of-two square is generated as today's square
      // (a TerrainBlock); any other shape carries its footprint (ground models at export). One tile: as before.
      let genCenter = center.value; let genSize = resolution.value;
      // road mode (refs/output/road-mode-plan.md): the chosen stretch widened either side; its grid and row runs from
      // services/roadCorridor.js (the same frame and pixels Generate uses); always ground models
      if (store.areaMode === 'road' && !store.batchMode) {
        const r = store.road;
        if (!r) throw new Error(t('road.pickFirst'));
        const mpp = Number(processingMpp || 1);
        const g = corridorGrid(stretchBetween(r.pts, r.startM, r.endM), store.roadHalfWidthM, mpp);
        if (!desktopApp && g.areaPx > WEB_MAX_SIDE * WEB_MAX_SIDE) throw new Error(t('road.webCap', { km2: Math.round(g.areaPx * mpp * mpp / 1e6), maxKm2: Math.round(WEB_MAX_SIDE * WEB_MAX_SIDE * mpp * mpp / 1e6) }));
        genCenter = g.center; genSize = { width: g.width, height: g.height };
        generationOptions.footprint = { runs: g.runs };
        // (past one grid's square: built in chunks, services/chunkedGenerate.js)
        if (needsChunks(g.width, g.height)) generationOptions.chunked = { W: g.width, H: g.height, mpp };
        generationOptions.road = { pts: stretchBetween(r.pts, r.startM, r.endM), halfWidthM: g.halfWidthM, names: r.names || [], refs: r.refs || [], highway: r.highway || 'road' };
        console.log(`[Road mode] ${(Math.abs(r.endM - r.startM) / 1000).toFixed(2)} km of ${[...(r.refs || []), ...(r.names || [])].join(' / ') || 'road'}, ${g.halfWidthM} m either side: a ${g.width}×${g.height} grid, corridor ${g.areaPx} px (${g.runs.length} row runs).`);
      } else if (store.tiles.length > 1) {
        const R = Number(resolution.value);
        const mpp = Number(processingMpp || 1);
        const g = layoutGrid(store.tiles.map((t) => ({ dx: Math.round(t.dx * R), dy: Math.round(t.dy * R) })), R);
        if (!desktopApp && !g.webOk) throw new Error(t('tiles.webCap', { km2: Math.round(g.areaPx * mpp * mpp / 1e6), maxKm2: Math.round(WEB_MAX_SIDE * WEB_MAX_SIDE * mpp * mpp / 1e6) }));
        // (the map's centre in its own frame, tile 0's middle on the chosen centre: services/tileLayout.js tilesFrame,
        // which the tiles on the map are drawn from too)
        genCenter = tilesFrame(center.value, store.tiles.map((t) => ({ dx: Math.round(t.dx * R), dy: Math.round(t.dy * R) })), R, mpp).center;
        genSize = g.terrainBlock ? g.width : { width: g.width, height: g.height };
        if (!g.terrainBlock && g.areaPx < g.width * g.height) generationOptions.footprint = g.rects;
        if (g.chunked) { generationOptions.footprint = g.rects; generationOptions.chunked = { W: g.width, H: g.height, mpp }; }
        // (what the tiles were: the previews, share codes and the desktop's Modify read them back; plain numbers, as
        // this goes to a worker or the desktop app)
        generationOptions.tiles = { list: store.tiles.map((t) => ({ dx: t.dx, dy: t.dy })), tilePx: R, anchor: { lat: center.value.lat, lng: center.value.lng }, together: !!store.tilesTogether, snap: !!store.tilesSnap };
        console.log(`[Tiles] ${store.tiles.length} tiles: a ${g.width}×${g.height} grid, ${g.terrainBlock ? 'a power-of-two square (TerrainBlock)' : `ground models${generationOptions.footprint ? ', footprint ' + g.areaPx + ' px' : ''}`}${g.overlaps ? ', overlaps fetched once' : ''}${g.islands ? ', islands' : ''}.`);
      }
      // (the desktop app fetches and processes in a Node process: no 4 GB
      // window limit; the website does it here)
      // (a note that a Generate is running: services/sessionGuard.js)
      markJobStart('generate', { code: await currentSessionCode(), build: typeof __BUILD_HASH__ !== 'undefined' ? __BUILD_HASH__ : '' });
      data = desktopApp
        ? await fetchTerrainDataOnDesktop(genCenter, genSize, fetchOSM, useUSGS, useGPXZ, useKRON86, gpxzApiKey, applyLoadingUpdate, signal, generationOptions)
        : await fetchTerrainData(genCenter, genSize, fetchOSM, useUSGS, useGPXZ, useKRON86, gpxzApiKey, undefined, applyLoadingUpdate, signal, generationOptions);
    }
    // (the export leaves objects out of the same background areas)
    if (data && store.backgroundActive && !uploadedElevationFile.value && store.tiles.length < 2 && store.areaMode !== 'road') data.backgroundMask = JSON.parse(JSON.stringify(store.backgroundMask));
    markJobEnd();
    terrainData.value = data;
    lastGenerationKey.value = requestKey;
    warnIfOsmUnavailable(data);
    
    openPreviewAfterGenerate();
  } catch (error) {
    if (error.name === 'AbortError') {
      markJobEnd();
      console.log("Terrain generation cancelled.");
      applyLoadingUpdate(t('app.status.cancelled'));
      return;
    }
    console.error("Failed to generate terrain:", error);
    // The site was updated under this page (a part of the app could not be loaded any more): that is the
    // failure. The notice with Reload is shown instead of a reason that is none and the offer to send a report.
    // (Four reports in one night read "out of memory: the satellite picture could not be fitted to a 1024 x
    // 1024 map (Worker error)": pages opened before a deploy, their resampler's file gone.)
    if (await codeFailed().catch(() => false)) {
      markJobEnd();
      updateNoticeHidden.value = false;
      return;
    }
    const byodMessage = String(error?.message || '');
    if (!uploadedElevationFile.value) {
      // (the reason, and the offer to send a report: with the job's log in the desktop app, the page's last lines on the website)
      // (a desktop report read only "ENOSPC: no space left on device, write": the disk was full)
      const message = isDiskFull(byodMessage) ? t('app.error.diskFull')
        // (the desktop app could not get the memory for a picture the size of the map: "Create skia surface failed";
        // in the desktop app every out-of-memory says so, not the website's "use the desktop app", report MR-PM849Z)
        : isOutOfMemory(byodMessage) && (desktopApp || /skia surface/i.test(byodMessage)) ? t('app.error.outOfMemoryComputer')
        : byodMessage.replace(/^Error invoking remote method '[^']+': (Error: )?/, '').replace(/\s*\[log: [^\]]+\]$/, '') || t('app.error.fetchTerrain');
      markJobEnd();
      openReportDialog('generate', {
        error: message,
        // (from the raw text: the desktop job's log goes with the report, reports MR-PM849Z and MR-NTHDMB had none)
        logPath: logPathFrom(byodMessage),
        area: { lat: center.value.lat, lng: center.value.lng, resolution: resolution.value, metersPerPixel: Number(processingMpp || 1) },
      });
    } else if (byodMessage) {
      alert(byodMessage);
    } else {
      alert(t('app.error.fetchTerrain'));
    }
  } finally {
    // (done: the card runs on to 100 % before it goes)
    if (lastGenerationKey.value === requestKey && terrainData.value && isLoading.value) {
      loadingFinished.value = true;
      await new Promise((resolve) => setTimeout(resolve, 450));
      loadingFinished.value = false;
    }
    isLoading.value = false;
    loadingProgressPercent.value = null;
    loadingProgressDetail.value = '';
    stopGenerationProgress();
    abortController = null;
  }
};

// fetchOSMData never throws on a mirror outage (the terrain is still usable),
// so say so instead of silently returning a map with no roads or buildings.
const warnIfOsmUnavailable = (data) => {
  if (data?.osmRequestInfo?.error) alert(t('app.error.osmUnavailable'));
};

const handleFetchOSM = async () => {
  if (!terrainData.value) return;
  
  isLoading.value = true;
  startGenerationProgress({ resolution: resolution.value, includeOSM: true, startAt: 'osm' });
  applyLoadingUpdate(t('app.status.fetchingOsm'));
  
  try {
      const updatedData = await addOSMToTerrain(terrainData.value, undefined, applyLoadingUpdate);
      terrainData.value = updatedData;
      warnIfOsmUnavailable(updatedData);
  } catch (error) {
      console.error("Failed to fetch OSM data:", error);
      alert(t('app.error.fetchOsm'));
  } finally {
      isLoading.value = false;
      stopGenerationProgress();
  }
};


const cancelGeneration = () => {
  if (abortController) {
    abortController.abort();
    abortController = null;
  }
};

// (a level from the levels sidebar: the map on its area, at its size)
const levelsSidebar = ref(null);
const handleShowLevelOnMap = (level) => {
  if (!level?.center) return;
  switchTo2D();
  // (another area: background areas drawn for this box go)
  store.clearBackgroundMask();
  setCenter({ lat: level.center.lat, lng: level.center.lng }, { force: true });
  if (level.resolution) setResolution(level.resolution, { force: true });
  if (level.metersPerPixel) handleProcessingMetersPerPixelChange(level.metersPerPixel, { force: true });
};

/**
 * "Modify" in My Levels: the level loaded back into the window to change
 * and export again. Its export options go into the export panel, the map
 * moves to its area and size, and its terrain is generated again from its
 * saved sources (offline, no GPXZ calls); exporting replaces the level.
 */
const handleModifyLevel = async (level) => {
  let info = null;
  try { info = await desktopApp.levelProject(level.levelName); } catch { info = null; }
  if (!info?.center) { window.alert(t('levels.modifyNoData', { name: level.title })); return; }
  applyExportSettings(info.options, info.options?.levelName || level.title);
  store.setAdvancedMode(true);
  // (Raw terrain ticked the way the level was made: unchanged unless the user changes it)
  store.setRawTerrain(!!info.generationOptions?.raw);
  // (an uploaded elevation file takes another path: the level's own data wins)
  if (uploadedElevationFile.value) handleElevationFileClear();
  switchTo2D();
  // (the level's own background areas, or none)
  store.setBackgroundMask(info.generationOptions?.backgroundMask || null);
  // (and its spawn and quicktravel points: as last exported, its mapng.json, else as generated)
  const levelPoints = info.options?.points || info.generationOptions?.points;
  if (Array.isArray(levelPoints)) store.setPoints(levelPoints);
  // the level's area: its tiles (tile 0's centre and the tile size), its road (the stretch and width), or one square
  const savedTiles = tilesFromTerrain({ tiles: info.generationOptions?.tiles });
  const savedRoad = info.generationOptions?.road;
  if (savedRoad?.pts?.length > 1) {
    store.setAreaMode('road');
    store.setRoad({ pts: savedRoad.pts, names: savedRoad.names || [], refs: savedRoad.refs || [], highway: savedRoad.highway || 'road', startM: 0, endM: cumulative(savedRoad.pts).at(-1), ids: [] });
    store.setRoadHalfWidthM(savedRoad.halfWidthM);
    setCenter({ lat: info.center.lat, lng: info.center.lng }, { force: true });
  } else if (savedTiles) {
    store.setAreaMode('tiles');
    store.setTiles(savedTiles.list); store.setTilesTogether(savedTiles.together); store.setTilesSnap(savedTiles.snap);
    setCenter(savedTiles.anchor || { lat: info.center.lat, lng: info.center.lng }, { force: true });
    setResolution(savedTiles.tilePx, { force: true });
  } else {
    store.setAreaMode('tiles'); store.setTiles([{ dx: 0, dy: 0 }]);
    setCenter({ lat: info.center.lat, lng: info.center.lng }, { force: true });
    if (info.resolution && typeof info.resolution !== 'object') setResolution(info.resolution, { force: true });
  }
  const mpp = Number(info.generationOptions?.processingMetersPerPixel) || 1;
  handleProcessingMetersPerPixelChange(mpp, { force: true });
  lastGenerationKey.value = null;
  await nextTick();
  generateNextFromLevel(level.levelName, { center: info.center, resolution: info.resolution || resolution.value, mpp });
  // (the level's own source comes from its saved data, whatever is named here.
  // The window's GPXZ key goes along, as Update sends it: with none, a GPXZ
  // level used to come back on the 30 m)
  const levelSource = info.useGPXZ ? 'gpxz' : info.useUSGS ? 'usgs' : info.useKRON86 ? 'kron86' : info.generationOptions?.useMapterhorn ? 'mapterhorn' : info.generationOptions?.flat ? 'none' : 'default';
  await handleGenerate(false, info.includeOSM, levelSource, localStorage.getItem('mapng_gpxzApiKey') || '', 'auto', mpp);
};

// Generated: the 2D preview opens (what was asked for, flat, with what will be
// built). Someone already looking at the 3D preview keeps it.
const openPreviewAfterGenerate = () => { if (viewMode.value !== 'preview3d') viewMode.value = 'preview2d'; };
// (no terrain: nothing to preview)
watch(terrainData, (data) => { if (!data && viewMode.value !== 'location') viewMode.value = 'location'; });

const loadingFinished = ref(false);

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
  // Mark the runner's own object — it checks status to tell cancel from pause.
  const target = batchLiveState || batchState.value;
  if (target) {
    target.status = 'canceled';
    saveBatchState(target);
    batchState.value = { ...target };
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
    alert(t('app.batchCacheCleared'));
  } catch (error) {
    console.error('[Batch] Failed to clear cache:', error);
    alert(t('app.batchCacheClearFailed'));
  }
};

const executeBatchJob = async (state) => {
  batchRunning.value = true;
  batchAbortController = new AbortController();
  batchLiveState = state;

  // Re-snapshot the runner's own object, not the previous snapshot: copying a
  // copy freezes top-level fields (status, finalizing, counts) at their first
  // value, so the UI never sees the job leave the tile loop.
  const syncBatchState = () => {
    batchState.value = { ...state };
  };

  try {
    await runBatchJob(
      state,
      // onProgress
      ({ tileIndex, step, tile }) => {
        batchCurrentStep.value = step;
        if (Number.isInteger(tileIndex)) state.currentTileIndex = tileIndex;
        if (tile?.id) state.currentTileId = tile.id;
        // Force reactivity on tile status changes
        syncBatchState();
      },
      // onTileComplete
      (tile) => {
        syncBatchState();
      },
      // onError
      (tile, error) => {
        console.error(`[Batch] Tile ${tile.label || `R${tile.row + 1}C${tile.col + 1}`} failed:`, error);
        syncBatchState();
      },
      batchAbortController.signal
    );
  } catch (error) {
    if (error.name !== 'AbortError') {
      console.error('[Batch] Unexpected error:', error);
      state.status = 'failed';
      saveBatchState(state);
    }
  } finally {
    batchRunning.value = false;
    batchAbortController = null;
    batchCurrentStep.value = '';
    // Force final state update
    syncBatchState();
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
