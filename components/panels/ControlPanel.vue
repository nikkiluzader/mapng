<template>
  <div class="space-y-6">
    <!-- TIF Upload (BYOD) -->
    <TifUploadControl
      :uploaded-tif-file="uploadedTifFile"
      :uploaded-tif-meta="uploadedTifMeta"
      :vertical-unit-override="elevationUnitOverride"
      @update:verticalUnitOverride="(v) => elevationUnitOverride = v"
      @file-selected="$emit('tifSelected', $event)"
      @clear="$emit('tifClear')"
    />

    <!-- LAZ Metadata Card -->
    <LazMetaCard
      v-if="isLazFileActive && uploadedTifMeta"
      :meta="uploadedTifMeta"
    />

    <!-- TIF Metadata Card -->
    <TifMetaCard
      v-if="uploadedTifMeta && !isLazFileActive"
      :meta="uploadedTifMeta"
      :vertical-unit-override="elevationUnitOverride"
    />

    <!-- Generate Actions -->
    <GenerateActions
      :is-generating="isGenerating"
      :is-cached="isCached"
      :use-gpxz="useGPXZ"
      :gpxz-api-key="gpxzApiKey"
      :has-custom-elevation="!!uploadedTifFile"
      @generate="(preview) => $emit('generate', preview, fetchOSM, useUSGS, useGPXZ, gpxzApiKey, elevationUnitOverride)"
    />

    <!-- Output Settings -->
    <div class="space-y-4">
      <label class="text-sm font-medium text-gray-700 dark:text-gray-300 flex items-center gap-2">
        <Box :size="16" class="text-gray-700 dark:text-gray-300" />
        Output Settings
      </label>

      <!-- When an uploaded source has native dimensions, resolution is driven
           by the file's native coverage; show an info row instead of dropdown. -->
      <div v-if="nativeDims" class="space-y-1">
        <label class="text-xs text-gray-500 dark:text-gray-400">Resolution (Output Size)</label>
        <div class="w-full bg-gray-100 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded px-2 py-2 text-sm text-gray-500 dark:text-gray-400">
          {{ nativeDims.width }} × {{ nativeDims.height }} px
          <span class="text-[10px] ml-1">({{ nativeDims.sourceLabel }} native coverage)</span>
        </div>
        <div class="text-[10px] text-gray-500 dark:text-gray-400 pt-1 space-y-1">
          <p v-if="nativeDims.note" class="text-[#FF6600] font-medium">
            {{ nativeDims.note }}
          </p>
          <p>Remove the uploaded file to choose a custom resolution.</p>
        </div>
      </div>

      <ResolutionSelector
        v-else
        :modelValue="resolution"
        @update:modelValue="$emit('resolutionChange', $event)"
        label="Resolution (Output Size)"
      >
        <p>• Downloads match selected size exactly.</p>
        <p>• Fetches max detail (Terrain Z15, Sat Z17).</p>
        <p v-if="resolution >= 4096" class="text-amber-600 dark:text-amber-500 font-medium">⚠️ Large area. May require high RAM.</p>
        <p>• Current Scale: <span class="text-[#FF6600]">{{ metersPerPixel.toFixed(2) }}m/px</span></p>
      </ResolutionSelector>

      <!-- OSM Toggle -->
      <div class="p-2 rounded bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600">
        <BaseToggle v-model="fetchOSM">
          <Trees :size="12" class="text-emerald-600 dark:text-emerald-400" />
          Include OSM Features
        </BaseToggle>
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
          Center Coordinates
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
          Configuration & Session
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

    <!-- Export Panel (shown when data is available) -->
    <div v-if="terrainData && !isGenerating" ref="exportPanelEl">
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
      />
    </div>
  </div>
</template>

<script setup>
    import { ref, computed, onMounted, watch } from 'vue';
    import { MapPin, Box, Trees, ChevronDown, Settings } from 'lucide-vue-next';
import BaseToggle from '../base/BaseToggle.vue';
import CoordinatesInput from '../map/CoordinatesInput.vue';
import ElevationSourceSelector from '../map/ElevationSourceSelector.vue';
import ResolutionSelector from '../map/ResolutionSelector.vue';
import SurroundingTiles from '../map/SurroundingTiles.vue';
import ExportPanel from './ExportPanel.vue';
import GenerateActions from '../controls/GenerateActions.vue';
import TifUploadControl from '../controls/TifUploadControl.vue';
import RunConfigControls from '../controls/RunConfigControls.vue';
import JobStateControls from '../controls/JobStateControls.vue';
import TerrainStats from '../controls/TerrainStats.vue';
import LazMetaCard from '../controls/LazMetaCard.vue';
import TifMetaCard from '../controls/TifMetaCard.vue';
import { checkUSGSStatus, probeGPXZLimits } from '../../services/terrain';
import { downloadJsonFile } from '../../services/traceability';
import { exportJobData, importJobData } from '../../services/jobData';
import { buildRunConfiguration as buildRunConfigurationBase } from '../../services/runConfiguration';


const props = defineProps(['center', 'zoom', 'resolution', 'isGenerating', 'terrainData', 'generationCacheKey', 'uploadedTifFile', 'uploadedTifMeta']);

const emit = defineEmits(['locationChange', 'resolutionChange', 'zoomChange', 'generate', 'fetchOsm', 'surroundingTilesChange', 'importData', 'tifSelected', 'tifClear']);

const handleLocationChange = (newLocation) => {
    emit('locationChange', { ...props.center, ...newLocation });
};
const surroundingTilePositions = ref([]);
const exportPanelEl = ref(null);
const runConfigStatus = ref('');
const isExportingJob = ref(false);
const isImportingJob = ref(false);
const jobStatus = ref('');

const handleExportJob = async () => {
    if (!props.terrainData) return;
    isExportingJob.value = true;
    jobStatus.value = 'Preparing job data...';
    try {
        const blob = await exportJobData(props.terrainData, props.generationCacheKey);
        const date = new Date().toISOString().slice(0, 10);
        const lat = props.center.lat.toFixed(4);
        const lng = props.center.lng.toFixed(4);
        const filename = `MapNG_Job_${date}_${lat}_${lng}.mapng`;
        triggerDownload(blob, filename);
        jobStatus.value = 'Job exported successfully.';
    } catch (e) {
        console.error('Job export failed:', e);
        jobStatus.value = 'Job export failed.';
    } finally {
        isExportingJob.value = false;
    }
};
const handleImportJobFile = async (file) => {
    if (!file) return;
    isImportingJob.value = true;
    jobStatus.value = 'Importing job data...';
    try {
        const data = await importJobData(file);
        emit('importData', data);
        jobStatus.value = 'Job imported successfully.';
    } catch (e) {
        console.error('Job import failed:', e);
        jobStatus.value = 'Job import failed: ' + e.message;
    } finally {
        isImportingJob.value = false;
    }
};

const fetchOSM = ref(localStorage.getItem('mapng_fetchOSM') !== 'false');
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
    // Initialize flags from persisted elevation source
    useUSGS.value = elevationSource.value === 'usgs';
    useGPXZ.value = elevationSource.value === 'gpxz';
    usgsStatus.value = await checkUSGSStatus();
});

// Sync elevation source with flags
watch(elevationSource, (newVal) => {
    useUSGS.value = newVal === 'usgs';
    useGPXZ.value = newVal === 'gpxz';
    localStorage.setItem('mapng_elevationSource', newVal);
});

// Persist OSM toggle
watch(fetchOSM, (newVal) => {
    localStorage.setItem('mapng_fetchOSM', String(newVal));
});

// Persist GPXZ API key
watch(gpxzApiKey, (newVal) => {
    localStorage.setItem('mapng_gpxzApiKey', newVal);
    // Reset status when key changes
    gpxzStatus.value = null;
});

watch(elevationUnitOverride, (newVal) => {
  localStorage.setItem('mapng_elevationUnitOverride', newVal || 'auto');
});

// Check GPXZ account status
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

// Watch for terrain data updates to handle fallback scenarios
watch(() => props.terrainData, (newData) => {
    if (newData?.usgsFallback) {
        elevationSource.value = 'default';
    alert("USGS 1m data for this area was missing or corrupt. Falling back to the Standard Terrarium dataset.\n\nOutput remains on the app's 1m/px processing grid.");
    }
});

// Calculate resolution scale (Meters per Pixel)
// With the new pipeline, we enforce 1m/px for all sources.
const isLazFileActive = computed(() => {
  const name = props.uploadedTifFile?.name?.toLowerCase() ?? '';
  return name.endsWith('.laz') || name.endsWith('.las');
});

const isGeoTiffActive = computed(() => {
  if (isLazFileActive.value) return false;
  return !!props.uploadedTifMeta?.isGeoTiff;
});

// When a LAZ file is active and has native dimension info, expose it for the template.
const lazNativeDims = computed(() => {
  if (!isLazFileActive.value) return null;
  const meta = props.uploadedTifMeta;
  if (!meta?.nativeWidth || !meta?.nativeHeight) return null;
  return {
    width: meta.nativeWidth,
    height: meta.nativeHeight,
    cropSize: meta.suggestedResolution ?? null,
    sourceLabel: 'LAZ',
    note: meta.suggestedResolution
      ? `Export area: ${meta.suggestedResolution} × ${meta.suggestedResolution} px (orange box in 3D preview)`
      : null,
  };
});

// Apply the same native-dimension override behavior for georeferenced GeoTIFFs.
const tifNativeDims = computed(() => {
  if (!isGeoTiffActive.value) return null;
  const meta = props.uploadedTifMeta;
  if (!meta?.nativeWidth || !meta?.nativeHeight || !meta?.bounds) return null;
  const crop = meta.suggestedResolution ?? null;
  const hasCrop = Number.isFinite(crop);
  return {
    width: hasCrop ? crop : meta.nativeWidth,
    height: hasCrop ? crop : meta.nativeHeight,
    cropSize: null,
    sourceLabel: hasCrop ? 'GeoTIFF crop window' : 'GeoTIFF',
    note: hasCrop
      ? `Processing is limited to ${crop} × ${crop} px around the center for faster generation.`
      : null,
  };
});

const nativeDims = computed(() => lazNativeDims.value || tifNativeDims.value);

const metersPerPixel = computed(() => {
  return 1.0;
});

// Calculate Area
const totalWidthMeters = computed(() => props.resolution * metersPerPixel.value);
const totalAreaSqM = computed(() => totalWidthMeters.value * totalWidthMeters.value);
const areaSqKm = computed(() => totalAreaSqM.value / 1000000);

// Check if the current parameters match the last successful generation
const isCached = computed(() => {
  if (props.uploadedTifFile) return false; // always re-generate when custom TIF is active
  if (!props.generationCacheKey || !props.terrainData) return false;
  const currentKey = JSON.stringify({
    lat: props.center.lat,
    lng: props.center.lng,
    resolution: props.resolution,
    osm: fetchOSM.value,
    usgs: useUSGS.value,
    gpxz: useGPXZ.value,
    gpxzKey: useGPXZ.value ? gpxzApiKey.value : '',
  });
  return currentKey === props.generationCacheKey;
});

const isAreaLargeForGPXZ = computed(() => {
    return useGPXZ.value && areaSqKm.value > 10;
});

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
});

const triggerDownload = (blob, filename) => {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.download = filename;
    link.href = url;
    link.click();
    URL.revokeObjectURL(url);
};

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
        runConfigStatus.value = 'Run configuration copied to clipboard (GPXZ key masked).';
            return;
        }
    } catch {
    }
    runConfigStatus.value = 'Clipboard write unavailable in this browser/session.';
};

const pasteRunConfiguration = async () => {
    try {
        if (!navigator.clipboard?.readText) {
            runConfigStatus.value = 'Clipboard read unavailable in this browser/session.';
            return;
        }
        const text = await navigator.clipboard.readText();
        if (!text?.trim()) {
            runConfigStatus.value = 'Clipboard is empty.';
            return;
        }
        const json = JSON.parse(text);
        applyRunConfiguration(json);
        runConfigStatus.value = 'Configuration pasted from clipboard.';
    } catch (error) {
        console.error('Failed to paste run configuration:', error);
        runConfigStatus.value = 'Clipboard content is not valid configuration JSON.';
    }
};

const saveRunConfiguration = () => {
    const payload = buildRunConfiguration();
    downloadJsonFile(payload, `MapNG_RunConfig_${new Date().toISOString().slice(0, 10)}.json`);
    runConfigStatus.value = 'Configuration downloaded as JSON.';
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
    emit('resolutionChange', clampInt(resolutionValue, 512, 8192));
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
  if (explicitSource && ['default', 'usgs', 'gpxz'].includes(explicitSource)) {
    elevationSource.value = explicitSource;
  } else {
    // Legacy fallback for shared configs that only include useUSGS/useGPXZ.
    const useUSGSValue = toBooleanOrNull(src.useUSGS);
    const useGPXZValue = toBooleanOrNull(src.useGPXZ);
    if (useGPXZValue === true) {
      elevationSource.value = 'gpxz';
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
        runConfigStatus.value = 'Configuration loaded. Generate to rerun with these settings.';
    } catch (error) {
        console.error('Failed to load run configuration:', error);
        runConfigStatus.value = 'Invalid configuration file (schema mismatch).';
    }
};
</script>
