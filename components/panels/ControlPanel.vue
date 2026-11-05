<template>
  <div class="space-y-5">
    <!-- Basic / Advanced: advanced restores the map-maker tools (2D/3D asset
         downloads, Surrounding Tiles, per-category level export options). -->
    <div>
      <SegmentedControl
        :model-value="store.advancedMode ? 'advanced' : 'basic'"
        @update:model-value="store.setAdvancedMode($event === 'advanced')"
        :options="[
          { value: 'basic', label: t('controlPanel.modeBasic') },
          { value: 'advanced', label: t('controlPanel.modeAdvanced') },
        ]"
      />
      <p class="mt-1.5 text-[11px] text-gray-500 dark:text-gray-400">
        {{ t(store.advancedMode ? 'controlPanel.modeAdvancedHint' : 'controlPanel.modeBasicHint') }}
      </p>
    </div>

    <!-- 1. Where -->
    <SettingSection v-model:open="showCoordinates" :title="t('controlPanel.ui.location')" :icon="MapPin">
      <CoordinatesInput :center="center" @locationChange="handleLocationChange" />
    </SettingSection>

    <!-- 2. How big and how detailed -->
    <SettingSection :title="t('controlPanel.ui.areaDetail')" :icon="Box" storage-key="mapng_ui_sec_area">
      <div
        v-if="devMode"
        class="rounded border border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-900/20 px-3 py-2"
      >
        <p class="text-[11px] font-semibold text-amber-800 dark:text-amber-300">
          Developer mode enabled (press ~ to toggle)
        </p>
      </div>

      <!-- Uploaded georeferenced sources can use either full native coverage
           or a user-selected square crop inside that coverage. -->
      <div v-if="nativeDims" class="space-y-1">
        <div v-if="supportsUploadAreaMode" class="space-y-2">
          <label class="text-xs text-gray-500 dark:text-gray-400">{{ t('controlPanel.uploadAreaMode') }}</label>
          <div class="grid grid-cols-2 gap-2">
            <button
              type="button"
              @click="$emit('update:uploadedAreaMode', 'native')"
              :class="[
                'rounded border px-3 py-2 text-sm font-medium transition-colors',
                uploadedAreaMode === 'native'
                  ? 'border-[#FF6600] bg-orange-50 dark:bg-orange-900/20 text-[#FF6600]'
                  : 'border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-300',
              ]"
            >
              {{ t('controlPanel.fullCoverage') }}
            </button>
            <button
              type="button"
              @click="$emit('update:uploadedAreaMode', 'crop')"
              :class="[
                'rounded border px-3 py-2 text-sm font-medium transition-colors',
                uploadedAreaMode === 'crop'
                  ? 'border-[#FF6600] bg-orange-50 dark:bg-orange-900/20 text-[#FF6600]'
                  : 'border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-300',
              ]"
            >
              {{ t('controlPanel.squareCrop') }}
            </button>
          </div>
        </div>

        <label v-if="uploadedAreaMode !== 'crop'" class="text-xs text-gray-500 dark:text-gray-400">{{ t('controlPanel.resolutionOutputSize') }}</label>
        <div v-if="uploadedAreaMode !== 'crop'" class="w-full bg-gray-100 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded px-2 py-2 text-sm text-gray-500 dark:text-gray-400">
          {{ nativeDims.width }} × {{ nativeDims.height }} px
          <span class="text-[10px] ml-1">({{ t('controlPanel.nativeCoverage', { source: nativeDims.sourceLabel }) }})</span>
        </div>
        <ResolutionSelector
          v-else
          :modelValue="resolution"
          @update:modelValue="$emit('resolutionChange', $event)"
          :label="t('controlPanel.resolutionOutputSize')"
          :max-resolution="maxSquareCropResolution"
        >
          <p>{{ t('controlPanel.squareCropWithinCoverage') }}</p>
          <p v-if="uploadedElevationMeta?.suggestedResolution">{{ t('controlPanel.suggestedSquareExport', { size: uploadedElevationMeta.suggestedResolution }) }}</p>
        </ResolutionSelector>
        <div class="text-[10px] text-gray-500 dark:text-gray-400 pt-1 space-y-1">
          <p v-if="nativeDims.note" class="text-[#FF6600] font-medium">
            {{ nativeDims.note }}
          </p>
          <p v-if="supportsUploadAreaMode && uploadedAreaMode !== 'crop'">{{ t('controlPanel.switchToSquareCrop') }}</p>
          <p v-else-if="supportsUploadAreaMode">{{ t('controlPanel.dragMapToPositionCrop') }}</p>
          <p v-else>{{ t('controlPanel.removeUploadedForCustomResolution') }}</p>
          <p v-if="previewStale" class="flex items-center gap-1 text-amber-600 dark:text-amber-400 font-medium">
            <AlertTriangle :size="11" class="shrink-0" />
            {{ t('controlPanel.previewOutOfDatePanel') }}
          </p>
        </div>
      </div>

      <ResolutionSelector
        v-else
        :modelValue="resolution"
        @update:modelValue="$emit('resolutionChange', $event)"
        :label="t('controlPanel.resolutionOutputSize')"
      >
      </ResolutionSelector>
      <!-- (the website only: big maps belong in the desktop app) -->
      <p v-if="!desktopApp && Number(resolution) >= 4096" class="flex items-start gap-1.5 -mt-1 text-[10px] leading-snug text-gray-500 dark:text-gray-400">
        <Download :size="11" class="shrink-0 mt-px text-[#FF6600]" />
        <span>{{ t('controlPanel.desktopHint') }} <a :href="DESKTOP_DOWNLOAD_URL" target="_blank" rel="noopener" class="text-[#FF6600] hover:underline">{{ t('controlPanel.desktopHintLink') }}</a></span>
      </p>

      <ProcessingResolutionInput
        :model-value="processingMetersPerPixel"
        :resolution="Number(resolution) || 0"
        @update:model-value="(v) => $emit('update:processingMetersPerPixel', v)"
      />

    </SettingSection>

    <!-- Surrounding Tiles (advanced mode) -->
    <SurroundingTiles
      v-if="store.advancedMode"
      :terrain-data="terrainData"
      :center="center"
      :resolution="resolution"
      @update:selected-positions="handleSurroundingTilesChange"
      @update:show-on-map="() => {}"
    />

    <!-- 3. Where the data comes from: elevation (with uploads and raw terrain), then OpenStreetMap -->
      <ElevationSourceSelector
        v-model:elevationSource="elevationSource"
        :usgsStatus="usgsStatus"
        v-model:gpxzApiKey="gpxzApiKey"
        :gpxzStatus="gpxzStatus"
        :isCheckingGPXZ="isCheckingGPXZ"
        :isAreaLargeForGPXZ="isAreaLargeForGPXZ"
        :areaSqKm="areaSqKm"
        :center="center"
        @verifyGpxzKey="checkGPXZStatus"
      >
      <!-- Elevation Upload (BYOD: tif/tiff/asc/gml/xml/zip/laz/las) -->
      <ElevationUploadControl
        :uploaded-elevation-file="uploadedElevationFile"
        :uploaded-elevation-meta="uploadedElevationMeta"
        :vertical-unit-override="elevationUnitOverride"
        :asc-coordinate-system="uploadedAscCoordinateSystem"
        :no-data-override="uploadedNoDataOverride"
        :gap-fill-source="gapFillSource"
        :layer-order="uploadedLayerOrder"
        :layer-slots="elevationLayerSlots"
        :max-slots="maxElevationSlots"
        :gpxz-key-available="!!gpxzApiKey"
        @update:verticalUnitOverride="(v) => elevationUnitOverride = v"
        @update:gapFillSource="(v) => gapFillSource = v"
        @update:layerOrder="(v) => $emit('update:uploadedLayerOrder', v)"
        @slot-selected="(i, files) => $emit('elevationSlotSelected', i, files)"
        @slot-removed="(i) => $emit('elevationSlotRemoved', i)"
        @update:ascCoordinateSystem="(v) => $emit('update:uploadedAscCoordinateSystem', v)"
        @update:noDataOverride="(v) => $emit('update:uploadedNoDataOverride', v)"
        @file-selected="$emit('elevationFileSelected', $event)"
        @clear="$emit('elevationFileClear')"
      />

      <!-- LAZ Metadata Card -->
      <LazMetaCard
        v-if="isLazFileActive && uploadedElevationMeta"
        :meta="uploadedElevationMeta"
      />

      <!-- Raster Metadata Card -->
      <RasterMetaCard
        v-if="uploadedElevationMeta && !isLazFileActive"
        :meta="uploadedElevationMeta"
        :vertical-unit-override="elevationUnitOverride"
      />
        <!-- Raw terrain (advanced): skip the road/terrain smoothing at Generate Data -->
        <SettingCard v-if="store.advancedMode">
          <SettingRow
            check
            :model-value="store.rawTerrain"
            @update:model-value="store.setRawTerrain"
            :label="t('controlPanel.rawTerrain')"
            :hint="t(store.rawTerrain ? 'controlPanel.rawTerrainOn' : 'controlPanel.rawTerrainOff')"
          />
        </SettingCard>
      </ElevationSourceSelector>

    <SettingSection :title="t('controlPanel.ui.mapData')" :icon="Trees" storage-key="mapng_ui_sec_mapdata">
      <!-- OpenStreetMap features, and Overture's buildings where OSM has none -->
      <SettingCard>
        <SettingRow check v-model="fetchOSM" :label="t('controlPanel.includeOsmFeatures')" :hint="t('controlPanel.ui.osmHint')" />
        <details v-if="fetchOSM" class="pl-4 text-[11px] text-gray-500 dark:text-gray-400" :open="!!customOverpassUrl">
          <summary class="cursor-pointer select-none hover:text-[#FF6600]">{{ t('controlPanel.customOverpass') }}</summary>
          <input
            v-model.trim="customOverpassUrl"
            type="password"
            autocomplete="off"
            spellcheck="false"
            placeholder="https://api.tracestrack.com/overpass/YOUR_KEY/interpreter"
            class="mt-1 w-full px-1.5 py-1 rounded border border-gray-300 dark:border-gray-500 bg-white dark:bg-gray-800 text-[11px] text-gray-900 dark:text-white"
          />
          <p v-if="customOverpassUrl && !customOverpassValid" class="mt-0.5 text-amber-600 dark:text-amber-400">{{ t('controlPanel.customOverpassInvalid') }}</p>
          <p class="mt-0.5 leading-snug">{{ t('controlPanel.customOverpassHint') }} <a href="https://tracestrack.com/2026/08/07/using-overpass-api-in-turbo-or-josm/" target="_blank" rel="noopener" class="text-[#FF6600] hover:underline">Tracestrack</a> · <a href="https://overspan.dev/" target="_blank" rel="noopener" class="text-[#FF6600] hover:underline">Overspan</a></p>
        </details>
        <!-- (services/overtureTiles.js) -->
        <SettingRow
          check
          v-model="overtureBuildings"
          :label="t('controlPanel.overtureBuildings')"
          :hint="t('controlPanel.overtureBuildingsHint')"
          :disabled="!fetchOSM"
          :disabled-reason="t('controlPanel.ui.needsOsmOn')"
        />
      </SettingCard>

    </SettingSection>

    <!-- 4. Generate -->
    <!-- Generate Actions -->
    <GenerateActions
      :is-generating="isGenerating"
      :is-cached="isCached"
      :use-gpxz="useGPXZ"
      :gpxz-api-key="gpxzApiKey"
      :has-custom-elevation="!!uploadedElevationFile"
      @generate="(preview) => $emit('generate', preview, fetchOSM, elevationSource, gpxzApiKey, elevationUnitOverride, metersPerPixel, gapFillSource)"
    />

    <!-- 5. The result: what was generated, and the exports -->
    <h3 v-if="terrainData && !isGenerating" class="flex items-center gap-2 pt-4 border-t border-gray-200 dark:border-gray-600 text-[13px] font-semibold text-emerald-700 dark:text-emerald-400">
      <CheckCircle2 :size="14" class="shrink-0" />
      {{ t('exportPanel.readyToExport') }}
      <span class="text-[11px] font-normal text-gray-500 dark:text-gray-400">{{ terrainData.width }}×{{ terrainData.height }}</span>
    </h3>
    <!-- Terrain Stats (shown when data is available) -->
    <TerrainStats
      :terrain-data="terrainData"
      :meters-per-pixel="metersPerPixel"
      :area-display="areaDisplay"
    />

    <!-- Export Panel (shown when data is available) -->
    <div v-if="terrainData && !isGenerating">
      <ExportPanel
        :key="exportPanelKey"
        :terrain-data="terrainData"
        :is-generating="isGenerating"
        :center="center"
        :zoom="zoom"
        :resolution="resolution"
        :elevation-source="elevationSource"
        :gpxz-api-key="gpxzApiKey"
        :gpxz-status="gpxzStatus"
        :fetch-o-s-m="fetchOSM"
        :surrounding-tile-positions="surroundingTilePositions"
        @fetch-osm="$emit('fetchOsm')"
        @export-success="$emit('exportSuccess', $event)"
      />
    </div>

    <!-- Configuration & Session (collapsed by default) -->
    <SettingSection v-model:open="showConfig" :title="t('controlPanel.configurationSession')" :icon="Settings">
      <RunConfigControls
        :status="runConfigStatus"
        @copy="copyRunConfiguration"
        @paste="pasteRunConfiguration"
        @save="saveRunConfiguration"
        @load="handleRunConfigFile"
        sendable
        :sending="sendingConfig"
        :sent="sentConfig"
        @send="sendConfig"
        @open-code="openShareCode"
      />
      <JobStateControls
        :has-terrain-data="!!terrainData"
        :is-generating="isGenerating"
        :is-exporting="isExportingJob"
        :is-importing="isImportingJob"
        :status="jobStatus"
        @export="handleExportJob"
        @import-file="handleImportJobFile"
      />
    </SettingSection>

    <!-- (outside the collapsible section: Ctrl+V on the map opens it too) -->
    <SessionConfigDialog
      v-if="pendingConfig"
      :rows="pendingConfigRows"
      @apply="applyPendingConfig"
      @cancel="pendingConfig = null"
    />

    <div class="p-3 rounded-lg bg-gradient-to-br from-orange-50 to-amber-50 dark:from-orange-900/20 dark:to-amber-900/10 border border-orange-200 dark:border-orange-800">
      <div class="flex items-start justify-between gap-3">
        <div>
          <p class="text-xs font-semibold text-orange-700 dark:text-orange-300">{{ t('support.cardTitle') }}</p>
          <p class="text-[11px] text-orange-700/90 dark:text-orange-300/90 leading-relaxed mt-1">{{ t('support.cardBody') }}</p>
        </div>
        <button
          type="button"
          @click="$emit('showSupport')"
          class="shrink-0 px-3 py-1.5 text-[11px] font-semibold bg-[#f45d22] hover:bg-[#e4521a] text-white rounded-md transition-colors"
        >
          {{ t('support.donate') }}
        </button>
      </div>
    </div>

  </div>
</template>

<script setup>
import { ref, computed, onMounted, onUnmounted, watch } from 'vue';
import { CUSTOM_OVERPASS_STORAGE_KEY, OVERTURE_BUILDINGS_STORAGE_KEY } from '../../services/osm.js';
import { useI18n } from 'vue-i18n';
import { MapPin, Box, Trees, Settings, AlertTriangle, Download, CheckCircle2 } from 'lucide-vue-next';
import { desktopApp, DESKTOP_DOWNLOAD_URL } from '../../services/platform/desktop.js';
import SettingSection from '../base/SettingSection.vue';
import SettingRow from '../base/SettingRow.vue';
import SettingCard from '../base/SettingCard.vue';
import SegmentedControl from '../base/SegmentedControl.vue';
import CoordinatesInput from '../map/CoordinatesInput.vue';
import ElevationSourceSelector from '../map/ElevationSourceSelector.vue';
import ResolutionSelector from '../map/ResolutionSelector.vue';
import SurroundingTiles from '../map/SurroundingTiles.vue';
import ExportPanel from './ExportPanel.vue';
import { useMainStore } from '../../stores/mainStore';
import GenerateActions from '../controls/GenerateActions.vue';
import ElevationUploadControl from '../controls/ElevationUploadControl.vue';
import RunConfigControls from '../controls/RunConfigControls.vue';
import JobStateControls from '../controls/JobStateControls.vue';
import ProcessingResolutionInput from '../controls/ProcessingResolutionInput.vue';
import TerrainStats from '../controls/TerrainStats.vue';
import LazMetaCard from '../controls/LazMetaCard.vue';
import RasterMetaCard from '../controls/RasterMetaCard.vue';
import { checkUSGSStatus, probeGPXZLimits } from '../../services/terrain';
import { downloadJsonFile } from '../../services/traceability';
import { exportJobData, importJobData } from '../../services/jobData';
import { buildRunConfiguration as buildRunConfigurationBase } from '../../services/runConfiguration';
import { applyStoredSettings, buildSessionConfig, describeSessionConfig, encodeSessionCode, fetchSharedCode, looksLikeSessionCode, parseSessionText, sendSessionCode, shareIdFrom, shareLink } from '../../services/sessionConfig.js';
import { setBaseTexture } from '../../composables/useBaseTexture.js';
import SessionConfigDialog from '../modals/SessionConfigDialog.vue';
import { setSessionCodeSource } from '../../composables/useReportDialog.js';
import { getMaxSquareCropResolution, scaleNativeDimsToProcessingMpp } from '../../services/uploadBounds';
import { normalizeGapFillSource } from '../../services/gapFillSources.js';

const { t } = useI18n({ useScope: 'global' });

const props = defineProps(['center', 'zoom', 'resolution', 'devMode', 'isGenerating', 'terrainData', 'generationCacheKey', 'uploadedElevationFile', 'uploadedElevationMeta', 'uploadedAscCoordinateSystem', 'uploadedNoDataOverride', 'uploadedLayerOrder', 'elevationLayerSlots', 'maxElevationSlots', 'uploadedAreaMode', 'processingMetersPerPixel']);

const emit = defineEmits(['locationChange', 'resolutionChange', 'zoomChange', 'generate', 'fetchOsm', 'surroundingTilesChange', 'importData', 'elevationFileSelected', 'elevationFileClear', 'elevationSlotSelected', 'elevationSlotRemoved', 'showSupport', 'exportSuccess', 'update:uploadedAscCoordinateSystem', 'update:uploadedNoDataOverride', 'update:uploadedLayerOrder', 'update:uploadedAreaMode', 'update:processingMetersPerPixel', 'update:previewStale']);

const handleLocationChange = (newLocation) => {
  emit('locationChange', { ...props.center, ...newLocation });
};

const store = useMainStore();
const surroundingTilePositions = ref([]);
watch(() => store.advancedMode, (advanced) => {
  if (!advanced) handleSurroundingTilesChange([]);
});
const runConfigStatus = ref('');
const isExportingJob = ref(false);
const isImportingJob = ref(false);
const jobStatus = ref('');

const handleExportJob = async () => {
  if (!props.terrainData) return;
  isExportingJob.value = true;
  jobStatus.value = t('status.jobPreparing');
  try {
    const blob = await exportJobData(props.terrainData, props.generationCacheKey);
    const date = new Date().toISOString().slice(0, 10);
    const lat = props.center.lat.toFixed(4);
    const lng = props.center.lng.toFixed(4);
    const filename = `MapNG_Job_${date}_${lat}_${lng}.mapng`;
    triggerDownload(blob, filename);
    jobStatus.value = t('status.jobExported');
  } catch (e) {
    console.error('Job export failed:', e);
    jobStatus.value = t('status.jobExportFailed');
  } finally {
    isExportingJob.value = false;
  }
};

const handleImportJobFile = async (file) => {
  if (!file) return;
  isImportingJob.value = true;
  jobStatus.value = t('status.jobImporting');
  try {
    const data = await importJobData(file);
    emit('importData', data);
    jobStatus.value = t('status.jobImported');
  } catch (e) {
    console.error('Job import failed:', e);
    jobStatus.value = t('status.jobImportFailed', { message: e.message });
  } finally {
    isImportingJob.value = false;
  }
};

const fetchOSM = ref(localStorage.getItem('mapng_fetchOSM') !== 'false');
const useUSGS = ref(false);
const useGPXZ = ref(false);
const elevationUnitOverride = ref(localStorage.getItem('mapng_elevationUnitOverride') || 'auto');
// Which dataset fills the parts of an export the upload does not cover.
const gapFillSource = ref(normalizeGapFillSource(localStorage.getItem('mapng_gapFillSource')));
const elevationSource = ref(localStorage.getItem('mapng_elevationSource') || 'default');
const gpxzApiKey = ref(localStorage.getItem('mapng_gpxzApiKey') || '');
const gpxzStatus = ref(null); // { plan, used, limit, remaining, concurrency, valid }
const isCheckingGPXZ = ref(false);
const usgsStatus = ref(null);

// Collapsible section states (persisted via localStorage, hidden by default)
const showCoordinates = ref(localStorage.getItem('mapng_showCoordinates') !== 'false');
const showConfig = ref(false);

onMounted(async () => {
  // Initialise elevation-source flags from persisted selection
  useUSGS.value = elevationSource.value === 'usgs';
  useGPXZ.value = elevationSource.value === 'gpxz';
  usgsStatus.value = await checkUSGSStatus();
});

// Keep useUSGS / useGPXZ flags in sync with the elevation source selector
watch(elevationSource, (newVal) => {
  useUSGS.value = newVal === 'usgs';
  useGPXZ.value = newVal === 'gpxz';
  localStorage.setItem('mapng_elevationSource', newVal);
});

// Persist OSM toggle
const customOverpassUrl = ref(localStorage.getItem(CUSTOM_OVERPASS_STORAGE_KEY) || '');
const customOverpassValid = computed(() => /^https:\/\/\S+$/.test(customOverpassUrl.value));
watch(customOverpassUrl, (newVal) => {
  if (newVal) localStorage.setItem(CUSTOM_OVERPASS_STORAGE_KEY, newVal);
  else localStorage.removeItem(CUSTOM_OVERPASS_STORAGE_KEY);
});

watch(fetchOSM, (newVal) => {
  localStorage.setItem('mapng_fetchOSM', String(newVal));
});

// On unless turned off; read by fetchOSMData (single tile and batch alike).
const overtureBuildings = ref(localStorage.getItem(OVERTURE_BUILDINGS_STORAGE_KEY) !== 'false');
watch(overtureBuildings, (newVal) => {
  localStorage.setItem(OVERTURE_BUILDINGS_STORAGE_KEY, String(newVal));
});

// Persist GPXZ API key and reset status when it changes
watch(gpxzApiKey, (newVal) => {
  localStorage.setItem('mapng_gpxzApiKey', newVal);
  gpxzStatus.value = null;
});

watch(gapFillSource, (newVal) => {
  localStorage.setItem('mapng_gapFillSource', normalizeGapFillSource(newVal));
});

watch(elevationUnitOverride, (newVal) => {
  localStorage.setItem('mapng_elevationUnitOverride', newVal || 'auto');
});

// Probe GPXZ account limits and cache the result for UI display
const checkGPXZStatus = async () => {
  if (!gpxzApiKey.value) return;
  isCheckingGPXZ.value = true;
  try {
    const info = await probeGPXZLimits(gpxzApiKey.value);
    gpxzStatus.value = info;
  } finally {
    isCheckingGPXZ.value = false;
  }
};

// Persist collapsible section states
watch(showCoordinates, (v) => localStorage.setItem('mapng_showCoordinates', String(v)));

// If USGS returns no data the terrain pipeline falls back to global tiles;
// reflect that in the UI by resetting the source selector to 'default'.
watch(() => props.terrainData, (newData) => {
  if (newData?.usgsFallback) {
    elevationSource.value = 'default';
    alert(t('app.error.usgsFallback'));
  } else if (newData?.kron86Fallback) {
    elevationSource.value = 'default';
    alert(t('app.error.kron86Fallback'));
  }
});

const processingMetersPerPixelNumber = computed(() => {
  const parsed = Number(props.processingMetersPerPixel);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
});

const metersPerPixel = computed(() => processingMetersPerPixelNumber.value);

// Detect active file type for metadata card routing
const isLazFileActive = computed(() => {
  const file = Array.isArray(props.uploadedElevationFile)
    ? props.uploadedElevationFile[0]
    : props.uploadedElevationFile;
  const name = file?.name?.toLowerCase() ?? '';
  return name.endsWith('.laz') || name.endsWith('.las');
});

const isGeoReferencedRasterActive = computed(() => {
  if (isLazFileActive.value) return false;
  return !!props.uploadedElevationMeta?.bounds;
});

// When a LAZ file is active with native dimensions, lock the resolution display
// to show the file's native coverage rather than the resolution dropdown.
const lazNativeDims = computed(() => {
  if (!isLazFileActive.value) return null;
  const meta = props.uploadedElevationMeta;
  if (!meta?.nativeWidth || !meta?.nativeHeight) return null;
  const { width, height } = scaleNativeDimsToProcessingMpp(meta.nativeWidth, meta.nativeHeight, metersPerPixel.value);
  return {
    width,
    height,
    cropSize: null,
    sourceLabel: 'LAZ',
    note: null,
  };
});

// Same native-dimension lock for georeferenced raster uploads.
const georeferencedRasterNativeDims = computed(() => {
  if (!isGeoReferencedRasterActive.value) return null;
  const meta = props.uploadedElevationMeta;
  if (!meta?.nativeWidth || !meta?.nativeHeight || !meta?.bounds) return null;
  const { width, height } = scaleNativeDimsToProcessingMpp(meta.nativeWidth, meta.nativeHeight, metersPerPixel.value);
  return {
    width,
    height,
    cropSize: null,
    sourceLabel: meta?.formatLabel || 'Raster',
    note: null,
  };
});

const nativeDims = computed(() => lazNativeDims.value || georeferencedRasterNativeDims.value);
// Any georeferenced upload (LAZ/LAS or raster) with WGS84 bounds can offer the
// native-vs-square-crop choice; uploads lacking a CRS stay native-only since a
// geographic crop can't be positioned without bounds.
const supportsUploadAreaMode = computed(() => !!props.uploadedElevationMeta?.bounds);
const maxSquareCropResolution = computed(() => getMaxSquareCropResolution(props.uploadedElevationMeta, metersPerPixel.value));

watch([() => props.uploadedAreaMode, maxSquareCropResolution], ([mode, maxResolution]) => {
  if (mode !== 'crop' || !Number.isFinite(maxResolution) || maxResolution <= 0) return;
  if (Number(props.resolution) > maxResolution) {
    emit('resolutionChange', props.uploadedElevationMeta?.suggestedResolution || maxResolution);
  }
}, { immediate: true });

// ── Stale-preview tracking for uploads ──────────────────────────────────────
// The 3D preview only reflects the last generation; changing the crop (mode or
// box position) or any other generation input leaves it out of date. Track that
// so the UI can prompt a re-run instead of silently showing the old terrain.
const previewStale = ref(false);
watch(
  () => [
    props.resolution,
    metersPerPixel.value,
    props.uploadedAreaMode,
    props.uploadedAscCoordinateSystem,
    props.uploadedNoDataOverride,
    props.uploadedLayerOrder,
    gapFillSource.value,
    elevationUnitOverride.value,
    fetchOSM.value,
    // Crop position only changes the output in square-crop mode.
    props.uploadedAreaMode === 'crop' ? props.center.lat : 0,
    props.uploadedAreaMode === 'crop' ? props.center.lng : 0,
  ],
  () => {
    if (props.uploadedElevationFile && props.terrainData) previewStale.value = true;
  },
);
// A completed generation refreshes the cache key; a new/cleared upload resets too.
watch(() => props.generationCacheKey, () => { previewStale.value = false; });
watch(() => props.uploadedElevationFile, () => { previewStale.value = false; });
watch(previewStale, (v) => emit('update:previewStale', v), { immediate: true });

// Area calculations (resolution is in metres because metersPerPixel = 1)
const totalWidthMeters = computed(() => props.resolution * metersPerPixel.value);
const totalAreaSqM = computed(() => totalWidthMeters.value * totalWidthMeters.value);
const areaSqKm = computed(() => totalAreaSqM.value / 1000000);

const signatureForKey = (key) => {
  if (!key) return '';
  let hash = 2166136261;
  for (let i = 0; i < key.length; i++) {
    hash ^= key.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
};

// True when the current UI params exactly match the last successful generation,
// so the user can skip re-fetching and go straight to export.
const isCached = computed(() => {
  if (props.uploadedElevationFile) return false; // always re-generate when custom file is active
  if (!props.generationCacheKey || !props.terrainData) return false;
  const currentKey = JSON.stringify({
    lat: props.center.lat,
    lng: props.center.lng,
    resolution: props.resolution,
    osm: fetchOSM.value,
    elevationSource: elevationSource.value,
    gpxzKeySig: elevationSource.value === 'gpxz' ? signatureForKey(gpxzApiKey.value) : '',
  });
  return currentKey === props.generationCacheKey;
});

// GPXZ has a 10 km² per-request limit; warn when the selected area exceeds it.
const isAreaLargeForGPXZ = computed(() => useGPXZ.value && areaSqKm.value > 10);

const areaDisplay = computed(() => {
  return totalAreaSqM.value > 1000000
    ? `${areaSqKm.value.toFixed(2)} km²`
    : `${Math.round(totalAreaSqM.value).toLocaleString()} m²`;
});

const handleSurroundingTilesChange = (positions) => {
  surroundingTilePositions.value = positions || [];
  emit('surroundingTilesChange', surroundingTilePositions.value);
};

const buildRunConfiguration = () => buildRunConfigurationBase({
  center: props.center,
  zoom: props.zoom,
  resolution: props.resolution,
  includeOSM: fetchOSM.value,
  elevationSource: elevationSource.value,
  gpxzApiKey: gpxzApiKey.value,
  gpxzStatus: gpxzStatus.value,
  terrainData: props.terrainData,
  extra: {
    processingMetersPerPixel: metersPerPixel.value,
    rawTerrain: store.rawTerrainActive,
  },
});

const triggerDownload = (blob, filename) => {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.download = filename;
  link.href = url;
  link.click();
  URL.revokeObjectURL(url);
};

// The whole control panel (data + export settings) as one config, never
// with keys: services/sessionConfig.js. Copy gives a one-line "mapng:1:…"
// code; Paste, Load and Ctrl+V on the map show what it would change first.
const currentSessionConfig = () => buildSessionConfig({ ...buildRunConfiguration(), rawTerrain: store.rawTerrain }, localStorage);

const copyRunConfiguration = async () => {
  try {
    const code = await encodeSessionCode(currentSessionConfig());
    if (!navigator.clipboard?.writeText) throw new Error('no clipboard');
    await navigator.clipboard.writeText(code);
    runConfigStatus.value = t('config.copied');
  } catch {
    runConfigStatus.value = t('status.clipboardWriteUnavailable');
  }
};

// a config waiting for the user's Apply (SessionConfigDialog.vue)
const pendingConfig = ref(null);
const pendingConfigRows = computed(() => (pendingConfig.value ? describeSessionConfig(pendingConfig.value, { hasGpxzKey: !!gpxzApiKey.value }) : []));
const previewConfigText = async (text, { quiet = false } = {}) => {
  try {
    pendingConfig.value = await parseSessionText(text);
    return true;
  } catch (error) {
    if (!quiet) {
      console.error('Not a MapNG config:', error);
      runConfigStatus.value = String(text || '').trim() ? t('config.invalid') : t('status.clipboardEmpty');
    }
    return false;
  }
};

const pasteRunConfiguration = async () => {
  if (!navigator.clipboard?.readText) {
    runConfigStatus.value = t('status.clipboardReadUnavailable');
    return;
  }
  try { await previewConfigText(await navigator.clipboard.readText()); }
  catch { runConfigStatus.value = t('status.clipboardReadUnavailable'); }
};

// (the export panel reads its settings when it appears: re-created after a config is applied)
const exportPanelKey = ref(0);
const applyPendingConfig = () => {
  const config = pendingConfig.value;
  pendingConfig.value = null;
  if (!config) return;
  try {
    applyRunConfiguration(config);
    if (typeof config.advancedMode === 'boolean') store.setAdvancedMode(config.advancedMode);
    if (typeof config.rawTerrain === 'boolean') store.setRawTerrain(config.rawTerrain);
    if (typeof config.gapFillSource === 'string' && config.gapFillSource) gapFillSource.value = normalizeGapFillSource(config.gapFillSource);
    if (typeof config.elevationUnitOverride === 'string' && config.elevationUnitOverride) elevationUnitOverride.value = config.elevationUnitOverride;
    if (typeof config.overtureBuildings === 'boolean') overtureBuildings.value = config.overtureBuildings;
    if (applyStoredSettings(config, localStorage)) {
      if (config.export.baseTexture) setBaseTexture(config.export.baseTexture);
      exportPanelKey.value += 1;
    }
    runConfigStatus.value = t('config.applied');
  } catch (error) {
    console.error('Failed to apply config:', error);
    runConfigStatus.value = t('config.invalid');
  }
};

// Send: mapng.com keeps the code 24 hours under a short code (shareCodes.js)
const sendingConfig = ref(false);
const sentConfig = ref(null);   // { id, link }
const sendConfig = async () => {
  sendingConfig.value = true;
  try {
    const { id } = await sendSessionCode(await encodeSessionCode(currentSessionConfig()));
    sentConfig.value = { id, link: shareLink(id) };
    runConfigStatus.value = '';
  } catch (error) {
    sentConfig.value = null;
    runConfigStatus.value = t('config.sendFailed', { reason: String(error?.message || error) });
  } finally { sendingConfig.value = false; }
};
const openShareCode = async (text) => {
  const id = shareIdFrom(text);
  if (!id) { await previewConfigText(text); return; }   // (a full code typed into the box works too)
  try { await previewConfigText(await fetchSharedCode(id)); }
  catch (error) { runConfigStatus.value = t('config.openFailed', { reason: String(error?.message || error) }); }
};

// Ctrl+V anywhere outside a text box: a pasted MapNG config opens the same preview
const onWindowPaste = (event) => {
  const target = event.target;
  if (target && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))) return;
  const text = event.clipboardData?.getData('text') || '';
  const trimmed = text.trim();
  if (/^(https?:\/\/)?(dev\.)?mapng\.com\/#[A-Za-z0-9]{3}-?[A-Za-z0-9]{3}$/.test(trimmed) || /^[A-Za-z0-9]{3}-[A-Za-z0-9]{3}$/.test(trimmed)) {
    if (shareIdFrom(trimmed)) { event.preventDefault(); openShareCode(trimmed); }
    return;
  }
  if (!looksLikeSessionCode(trimmed) && !(trimmed.startsWith('{') && trimmed.includes('"center"'))) return;
  event.preventDefault();
  previewConfigText(trimmed, { quiet: !looksLikeSessionCode(trimmed) });
};
onMounted(() => {
  window.addEventListener('paste', onWindowPaste);
  setSessionCodeSource(() => encodeSessionCode(currentSessionConfig()));
  // a mapng.com/#K7F-29Q link: open the sent config's preview
  const linked = shareIdFrom(window.location.hash);
  if (linked && /^#[A-Za-z0-9]{3}-?[A-Za-z0-9]{3}$/.test(window.location.hash)) {
    history.replaceState(null, '', window.location.pathname + window.location.search);
    openShareCode(linked);
  }
});
onUnmounted(() => { window.removeEventListener('paste', onWindowPaste); setSessionCodeSource(null); });

const saveRunConfiguration = () => {
  downloadJsonFile(currentSessionConfig(), `MapNG_Config_${new Date().toISOString().slice(0, 10)}.json`);
  runConfigStatus.value = t('status.runConfigDownloaded');
};

const toNumberOrNull = (value) => {
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
};

const toBooleanOrNull = (value) => {
  if (value === true || value === false) return value;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (normalized === 'true' || normalized === '1') return true;
    if (normalized === 'false' || normalized === '0') return false;
  }
  if (value === 1) return true;
  if (value === 0) return false;
  return null;
};

const clampInt = (value, min, max) => Math.min(max, Math.max(min, parseInt(value, 10)));

const applyRunConfiguration = (config) => {
  const src = config?.runConfiguration || config;
  if (!src || typeof src !== 'object') throw new Error('Invalid JSON schema');

  const schemaVersion = Number(src.schemaVersion ?? 1);
  const modeRaw = String(src.mode || config?.mode || 'single').toLowerCase();
  if (schemaVersion !== 1 || modeRaw !== 'single') {
    throw new Error('Unsupported configuration schema.');
  }

  const lat = toNumberOrNull(src?.center?.lat);
  const lng = toNumberOrNull(src?.center?.lng);
  if (lat !== null && lng !== null) {
    emit('locationChange', { lat, lng });
  }

  const resolutionValue = toNumberOrNull(src.resolution);
  if (resolutionValue !== null) {
    emit('resolutionChange', clampInt(resolutionValue, 512, 16384));
  }

  const processingMetersPerPixelValue = toNumberOrNull(src.processingMetersPerPixel);
  if (processingMetersPerPixelValue !== null && processingMetersPerPixelValue > 0) {
    emit('update:processingMetersPerPixel', processingMetersPerPixelValue);
  }

  const zoomValue = toNumberOrNull(src.zoom);
  if (zoomValue !== null) {
    emit('zoomChange', clampInt(zoomValue, 1, 20));
  }

  const includeOSMValue = toBooleanOrNull(src.includeOSM);
  if (includeOSMValue !== null) {
    fetchOSM.value = includeOSMValue;
  }

  const explicitSource = typeof src.elevationSource === 'string' ? src.elevationSource.toLowerCase() : null;
  if (explicitSource && ['default', 'none', 'usgs', 'gpxz', 'kron86'].includes(explicitSource)) {
    elevationSource.value = explicitSource;
  } else {
    // Legacy fallback for shared configs that only include useUSGS/useGPXZ booleans.
    const useUSGSValue = toBooleanOrNull(src.useUSGS);
    const useGPXZValue = toBooleanOrNull(src.useGPXZ);
    const useKRON86Value = toBooleanOrNull(src.useKRON86 ?? src.useKron86);
    if (useGPXZValue === true) {
      elevationSource.value = 'gpxz';
    } else if (useKRON86Value === true) {
      elevationSource.value = 'kron86';
    } else if (useUSGSValue === true) {
      elevationSource.value = 'usgs';
    }
  }

  // (keys never come from a config: the user's own GPXZ key stays)
  if (src.gpxzStatus && typeof src.gpxzStatus === 'object') {
    gpxzStatus.value = { ...src.gpxzStatus };
  }
};

const handleRunConfigFile = async (file) => {
  if (!file) return;
  try {
    await previewConfigText(await file.text());
  } catch (error) {
    console.error('Failed to load run configuration:', error);
    runConfigStatus.value = t('status.runConfigInvalidFile');
  }
};
</script>
