<template>
  <div class="space-y-6">
    <!-- Elevation Upload (BYOD: tif/tiff/asc/gml/xml/zip/laz/las) -->
    <ElevationUploadControl
      :uploaded-elevation-file="uploadedElevationFile"
      :uploaded-elevation-meta="uploadedElevationMeta"
      :vertical-unit-override="elevationUnitOverride"
      :asc-coordinate-system="uploadedAscCoordinateSystem"
      @update:verticalUnitOverride="(v) => elevationUnitOverride = v"
      @update:ascCoordinateSystem="(v) => $emit('update:uploadedAscCoordinateSystem', v)"
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

    <!-- Generate Actions -->
    <GenerateActions
      :is-generating="isGenerating"
      :is-cached="isCached"
      :use-gpxz="useGPXZ"
      :gpxz-api-key="gpxzApiKey"
      :has-custom-elevation="!!uploadedElevationFile"
      @generate="(preview) => $emit('generate', preview, fetchOSM, elevationSource, gpxzApiKey, elevationUnitOverride, metersPerPixel, enhanceRoads, levelRoads)"
    />

    <!-- Output Settings -->
    <div class="space-y-4">
      <label class="text-sm font-medium text-gray-700 dark:text-gray-300 flex items-center gap-2">
        <Box :size="16" class="text-gray-700 dark:text-gray-300" />
        {{ t('controlPanel.outputSettings') }}
      </label>

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

      <ProcessingResolutionInput
        :model-value="processingMetersPerPixel"
        @update:model-value="(v) => $emit('update:processingMetersPerPixel', v)"
      />

      <!-- OSM Toggle -->
      <div class="p-2 rounded bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600">
        <BaseToggle v-model="fetchOSM">
          <Trees :size="12" class="text-emerald-600 dark:text-emerald-400" />
          {{ t('controlPanel.includeOsmFeatures') }}
        </BaseToggle>
      </div>

      <!-- Road Enhancing Toggle -->
      <div class="p-2 rounded bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600">
        <BaseToggle v-model="enhanceRoads" :disabled="isFlat">
          <Route :size="12" class="text-[#FF6600]" />
          {{ t('controlPanel.enhanceRoads') }}
        </BaseToggle>
        <p class="mt-1 ml-6 text-[10px] text-gray-500 dark:text-gray-400 leading-tight">
          {{ isFlat ? t('controlPanel.roadsDisabledFlat') : t('controlPanel.enhanceRoadsHint') }}
        </p>
      </div>

      <!-- Road Pathing Toggle -->
      <div class="p-2 rounded bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600">
        <BaseToggle v-model="levelRoads" :disabled="isFlat">
          <Route :size="12" class="text-blue-600 dark:text-blue-400" />
          {{ t('controlPanel.levelRoads') }}
        </BaseToggle>
        <p class="mt-1 ml-6 text-[10px] text-gray-500 dark:text-gray-400 leading-tight">
          {{ isFlat ? t('controlPanel.roadsDisabledFlat') : t('controlPanel.levelRoadsHint') }}
        </p>
      </div>

      <!-- Elevation Source Selection -->
      <ElevationSourceSelector
        v-model:elevationSource="elevationSource"
        :usgsStatus="usgsStatus"
        v-model:gpxzApiKey="gpxzApiKey"
        :gpxzStatus="gpxzStatus"
        :isCheckingGPXZ="isCheckingGPXZ"
        :isAreaLargeForGPXZ="isAreaLargeForGPXZ"
        :areaSqKm="areaSqKm"
        :center="centerStable"
        @verifyGpxzKey="checkGPXZStatus"
      />
    </div>

    <!-- Center Coordinates (collapsible) -->
    <div class="space-y-2">
      <button
        @click="showCoordinates = !showCoordinates"
        class="w-full flex items-center justify-between text-sm font-medium text-gray-700 dark:text-gray-300 hover:text-[#FF6600] transition-colors group"
      >
        <span class="flex items-center gap-2">
          <MapPin :size="16" class="text-gray-500 dark:text-gray-400 group-hover:text-[#FF6600] transition-colors" />
          {{ t('controlPanel.centerCoordinates') }}
        </span>
        <ChevronDown :size="14" :class="['transition-transform duration-200', showCoordinates ? 'rotate-180' : '']" />
      </button>
      <template v-if="showCoordinates">
        <CoordinatesInput :center="center" @locationChange="handleLocationChange" />
      </template>
    </div>

    <!-- Surrounding Tiles -->
    <SurroundingTiles
      :terrain-data="terrainData"
      :center="center"
      :resolution="resolution"
      @update:selected-positions="handleSurroundingTilesChange"
      @update:show-on-map="() => {}"
    />

    <!-- Configuration & Session (collapsible, collapsed by default) -->
    <div class="space-y-3">
      <button
        @click="showConfig = !showConfig"
        class="w-full flex items-center justify-between text-sm font-medium text-gray-700 dark:text-gray-300 hover:text-[#FF6600] transition-colors group"
      >
        <span class="flex items-center gap-2">
          <Settings :size="16" class="text-gray-500 dark:text-gray-400 group-hover:text-[#FF6600] transition-colors" />
          {{ t('controlPanel.configurationSession') }}
        </span>
        <ChevronDown :size="14" :class="['transition-transform duration-200', showConfig ? 'rotate-180' : '']" />
      </button>
      <template v-if="showConfig">
        <RunConfigControls
          :status="runConfigStatus"
          @copy="copyRunConfiguration"
          @paste="pasteRunConfiguration"
          @save="saveRunConfiguration"
          @load="handleRunConfigFile"
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
      </template>
    </div>

    <!-- Terrain Stats (shown when data is available) -->
    <TerrainStats
      :terrain-data="terrainData"
      :meters-per-pixel="metersPerPixel"
      :area-display="areaDisplay"
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

    <!-- Export Panel (shown when data is available) -->
    <div v-if="terrainData && !isGenerating">
      <ExportPanel
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
  </div>
</template>

<script setup>
import { ref, computed, onMounted, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { MapPin, Box, Trees, ChevronDown, Settings, Route, AlertTriangle } from 'lucide-vue-next';
import BaseToggle from '../base/BaseToggle.vue';
import CoordinatesInput from '../map/CoordinatesInput.vue';
import ElevationSourceSelector from '../map/ElevationSourceSelector.vue';
import ResolutionSelector from '../map/ResolutionSelector.vue';
import SurroundingTiles from '../map/SurroundingTiles.vue';
import ExportPanel from './ExportPanel.vue';
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
import { getMaxSquareCropResolution, scaleNativeDimsToProcessingMpp } from '../../services/uploadBounds';
import { ELEVATION_SOURCES } from '../../services/elevationSources.js';

const { t } = useI18n({ useScope: 'global' });

const props = defineProps(['center', 'centerStable', 'zoom', 'resolution', 'devMode', 'isGenerating', 'terrainData', 'generationCacheKey', 'uploadedElevationFile', 'uploadedElevationMeta', 'uploadedAscCoordinateSystem', 'uploadedAreaMode', 'processingMetersPerPixel']);

const emit = defineEmits(['locationChange', 'resolutionChange', 'zoomChange', 'generate', 'fetchOsm', 'surroundingTilesChange', 'importData', 'elevationFileSelected', 'elevationFileClear', 'showSupport', 'exportSuccess', 'update:uploadedAscCoordinateSystem', 'update:uploadedAreaMode', 'update:processingMetersPerPixel', 'update:previewStale']);

const handleLocationChange = (newLocation) => {
  emit('locationChange', { ...props.center, ...newLocation });
};

const surroundingTilePositions = ref([]);
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
const enhanceRoads = ref(localStorage.getItem('mapng_enhanceRoads') === 'true');
const levelRoads = ref(localStorage.getItem('mapng_levelRoads') === 'true');
const useUSGS = ref(false);
const useGPXZ = ref(false);
const elevationUnitOverride = ref(localStorage.getItem('mapng_elevationUnitOverride') || 'auto');
const elevationSource = ref(localStorage.getItem('mapng_elevationSource') || 'default');
const gpxzApiKey = ref(localStorage.getItem('mapng_gpxzApiKey') || '');
const gpxzStatus = ref(null); // { plan, used, limit, remaining, concurrency, valid }
const isCheckingGPXZ = ref(false);
const usgsStatus = ref(null);

// Collapsible section states (persisted via localStorage, hidden by default)
const showCoordinates = ref(localStorage.getItem('mapng_showCoordinates') === 'true');
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

// Flat mode produces perfectly level terrain, so the road-into-terrain options
// (which carve/raise elevation under roads) are meaningless — disable + force
// them off while flat is selected.
const isFlat = computed(() => elevationSource.value === 'none');
watch(isFlat, (flat) => {
  if (flat) {
    enhanceRoads.value = false;
    levelRoads.value = false;
  }
}, { immediate: true });

// Persist OSM toggle
watch(fetchOSM, (newVal) => {
  localStorage.setItem('mapng_fetchOSM', String(newVal));
});

// Persist enhanceRoads toggle
watch(enhanceRoads, (newVal) => {
  localStorage.setItem('mapng_enhanceRoads', String(newVal));
});

// Persist levelRoads toggle
watch(levelRoads, (newVal) => {
  localStorage.setItem('mapng_levelRoads', String(newVal));
});

// Persist GPXZ API key and reset status when it changes
watch(gpxzApiKey, (newVal) => {
  localStorage.setItem('mapng_gpxzApiKey', newVal);
  gpxzStatus.value = null;
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

watch(() => props.centerStable, (newCenter) => {
  if (!newCenter) return;
  const currentSource = ELEVATION_SOURCES.find(s => s.id === elevationSource.value);
  if (currentSource && !currentSource.isGlobal && currentSource.checkCoverage) {
    if (!currentSource.checkCoverage(newCenter)) {
      elevationSource.value = 'default';
    }
  }
}, { immediate: true, deep: true });

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
    elevationUnitOverride.value,
    fetchOSM.value,
    enhanceRoads.value,
    levelRoads.value,
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
    enhanceRoads: enhanceRoads.value,
    levelRoads: levelRoads.value,
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
  enhanceRoads: enhanceRoads.value,
  levelRoads: levelRoads.value,
  elevationSource: elevationSource.value,
  gpxzApiKey: gpxzApiKey.value,
  gpxzStatus: gpxzStatus.value,
  terrainData: props.terrainData,
  extra: {
    processingMetersPerPixel: metersPerPixel.value,
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

// Strip the GPXZ API key before copying to clipboard so users can safely
// share run configurations without leaking credentials.
const sanitizeConfigForClipboard = (payload) => {
  if (!payload || typeof payload !== 'object') return payload;
  return {
    ...payload,
    gpxzApiKey: payload.gpxzApiKey ? '' : payload.gpxzApiKey,
    gpxzApiKeyMasked: !!payload.gpxzApiKey,
  };
};

const copyRunConfiguration = async () => {
  const payload = sanitizeConfigForClipboard(buildRunConfiguration());
  const text = JSON.stringify(payload, null, 2);
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      runConfigStatus.value = t('status.runConfigCopied');
      return;
    }
  } catch {
    // Fall through to error message
  }
  runConfigStatus.value = t('status.clipboardWriteUnavailable');
};

const pasteRunConfiguration = async () => {
  try {
    if (!navigator.clipboard?.readText) {
      runConfigStatus.value = t('status.clipboardReadUnavailable');
      return;
    }
    const text = await navigator.clipboard.readText();
    if (!text?.trim()) {
      runConfigStatus.value = t('status.clipboardEmpty');
      return;
    }
    const json = JSON.parse(text);
    applyRunConfiguration(json);
    runConfigStatus.value = t('status.runConfigPasted');
  } catch (error) {
    console.error('Failed to paste run configuration:', error);
    runConfigStatus.value = t('status.runConfigInvalidJson');
  }
};

const saveRunConfiguration = () => {
  const payload = buildRunConfiguration();
  downloadJsonFile(payload, `MapNG_RunConfig_${new Date().toISOString().slice(0, 10)}.json`);
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

  const enhanceRoadsValue = toBooleanOrNull(src.enhanceRoads);
  if (enhanceRoadsValue !== null) {
    enhanceRoads.value = enhanceRoadsValue;
  }

  const levelRoadsValue = toBooleanOrNull(src.levelRoads);
  if (levelRoadsValue !== null) {
    levelRoads.value = levelRoadsValue;
  }

  const explicitSource = typeof src.elevationSource === 'string' ? src.elevationSource.toLowerCase() : null;
  if (explicitSource && ['default', 'usgs', 'gpxz', 'kron86'].includes(explicitSource)) {
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

  if (typeof src.gpxzApiKey === 'string') {
    gpxzApiKey.value = src.gpxzApiKey;
  }
  if (src.gpxzStatus && typeof src.gpxzStatus === 'object') {
    gpxzStatus.value = { ...src.gpxzStatus };
  }
};

const handleRunConfigFile = async (file) => {
  if (!file) return;
  try {
    const text = await file.text();
    const json = JSON.parse(text);
    applyRunConfiguration(json);
    runConfigStatus.value = t('status.runConfigLoadedSingle');
  } catch (error) {
    console.error('Failed to load run configuration:', error);
    runConfigStatus.value = t('status.runConfigInvalidFile');
  }
};
</script>
