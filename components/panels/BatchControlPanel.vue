<template>
  <div class="space-y-6">
    <!-- Batch Stability Note -->
    <div class="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg px-3 py-2 flex items-start gap-2">
      <AlertTriangle :size="14" class="text-amber-500 mt-0.5 shrink-0" />
      <p class="text-[10px] text-amber-700 dark:text-amber-400 leading-relaxed">
        <span class="font-bold">Resource heavy.</span> Large grids or high-resolution tiles can still hit browser memory or download limits.
      </p>
    </div>

    <BatchGridConfig
      :grid-cols="gridCols"
      :grid-rows="gridRows"
      :total-tiles="totalTiles"
      :total-area-display="totalAreaDisplay"
      :perimeter-display="perimeterDisplay"
      :grid-width-display="gridWidthDisplay"
      :grid-height-display="gridHeightDisplay"
      :tile-area-display="tileAreaDisplay"
      @update:grid-cols="(v) => gridCols = v"
      @update:grid-rows="(v) => gridRows = v"
    />

    <div class="space-y-2">
      <div class="flex items-center justify-between">
        <p class="text-xs font-medium text-gray-700 dark:text-gray-300">Tile Offsets (meters)</p>
        <BaseButton size="sm" variant="secondary" @click="resetTileOffsets">Reset All</BaseButton>
      </div>
      <label class="flex items-center justify-between p-2 rounded bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 text-xs text-gray-700 dark:text-gray-300">
        <span>Tiles Follow Map Center</span>
        <input type="checkbox" v-model="tileFollowCenterLocal" class="accent-[#FF6600] w-4 h-4 cursor-pointer" />
      </label>
      <p class="text-[10px] text-gray-500 dark:text-gray-400">Move tiles independently by offsetting each tile center (X east/west, Y north/south).</p>
      <div class="max-h-44 overflow-y-auto border border-gray-200 dark:border-gray-600 rounded bg-gray-50 dark:bg-gray-700 p-2 space-y-1">
        <div
          v-for="entry in tileOffsetEntries"
          :key="entry.index"
          class="grid grid-cols-[54px_1fr_1fr_42px] gap-1 items-center"
        >
          <span class="text-[10px] text-gray-600 dark:text-gray-300">R{{ entry.row + 1 }}C{{ entry.col + 1 }}</span>
          <input
            type="number"
            step="10"
            class="bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded px-1.5 py-1 text-[10px] text-gray-900 dark:text-white"
            :value="entry.offsetX"
            @input="updateTileOffset(entry.index, 'offsetX', $event.target.value)"
            placeholder="X"
          />
          <input
            type="number"
            step="10"
            class="bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded px-1.5 py-1 text-[10px] text-gray-900 dark:text-white"
            :value="entry.offsetY"
            @input="updateTileOffset(entry.index, 'offsetY', $event.target.value)"
            placeholder="Y"
          />
          <button
            class="text-[10px] py-1 px-1 rounded border border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:bg-white dark:hover:bg-gray-800"
            @click="resetTileOffset(entry.index)"
          >
            0
          </button>
        </div>
      </div>
    </div>

    <div class="space-y-2">
      <div class="flex items-center justify-between">
        <p class="text-xs font-medium text-gray-700 dark:text-gray-300">Tile Names</p>
        <BaseButton size="sm" variant="secondary" @click="resetTileNames">Reset All</BaseButton>
      </div>
      <p class="text-[10px] text-gray-500 dark:text-gray-400">Defaults use row/column labels. Rename any tile to change its export ZIP filename and batch labels.</p>
      <div class="max-h-44 overflow-y-auto border border-gray-200 dark:border-gray-600 rounded bg-gray-50 dark:bg-gray-700 p-2 space-y-1">
        <div
          v-for="entry in tileNameEntries"
          :key="entry.index"
          class="grid grid-cols-[54px_1fr] gap-1 items-center"
        >
          <span class="text-[10px] text-gray-600 dark:text-gray-300">R{{ entry.row + 1 }}C{{ entry.col + 1 }}</span>
          <input
            type="text"
            class="bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded px-1.5 py-1 text-[10px] text-gray-900 dark:text-white"
            :value="entry.name"
            :placeholder="entry.defaultName"
            @input="updateTileName(entry.index, $event.target.value)"
          />
        </div>
      </div>
    </div>

    <hr class="border-gray-200 dark:border-gray-600" />

    <!-- Resolution -->
    <div class="space-y-2">
      <label class="text-sm font-medium text-gray-700 dark:text-gray-300 flex items-center gap-2">
        <Box :size="16" class="text-gray-700 dark:text-gray-300" />
        Tile Resolution
      </label>
      <ResolutionSelector
        :modelValue="resolution"
        @update:modelValue="$emit('resolutionChange', $event)"
      >
        <p>Each tile: {{ resolution }}m × {{ resolution }}m at 1m/px</p>
        <p>Grid coverage: {{ gridWidthDisplay }} × {{ gridHeightDisplay }}</p>
        <p v-if="resolution >= 4096" class="text-amber-600 dark:text-amber-500 font-medium">⚠️ High resolution tiles require significant RAM per tile.</p>
      </ResolutionSelector>
    </div>

    <div class="flex items-center justify-between p-2 rounded bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600">
      <label class="text-xs text-gray-700 dark:text-gray-300 flex items-center gap-2 cursor-pointer">
        <Mountain :size="12" class="text-amber-600 dark:text-amber-400" />
        Shared Elevation Baseline (all heightmaps use one min/max)
      </label>
      <input type="checkbox" v-model="sharedElevationBaseline" class="accent-[#FF6600] w-4 h-4 cursor-pointer" />
    </div>

    <p v-if="sharedElevationBaseline" class="text-[10px] text-amber-600 dark:text-amber-500">
      Extra pre-scan required: batch runs one elevation-only pass first to compute global min/max.
    </p>

    <hr class="border-gray-200 dark:border-gray-600" />

    <BatchPerformanceProfile v-model:modelValue="performanceProfile" />

    <hr class="border-gray-200 dark:border-gray-600" />

    <!-- OSM Toggle -->
    <div class="flex items-center justify-between p-2 rounded bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600">
      <label class="text-xs text-gray-700 dark:text-gray-300 flex items-center gap-2 cursor-pointer">
        <Trees :size="12" class="text-emerald-600 dark:text-emerald-400" />
        Include OSM Features
      </label>
      <input type="checkbox" v-model="includeOSM" class="accent-[#FF6600] w-4 h-4 cursor-pointer" />
    </div>

    <!-- Elevation Source -->
    <ElevationSourceSelector
      v-model:elevationSource="elevationSource"
      :usgsStatus="null"
      v-model:gpxzApiKey="gpxzApiKey"
      :gpxzStatus="gpxzStatus"
      :isCheckingGPXZ="isCheckingGPXZ"
      :isBatchMode="true"
      :totalTiles="totalTiles"
      @verifyGpxzKey="checkGPXZStatus"
    />

    <hr class="border-gray-200 dark:border-gray-600" />

    <!-- Coordinates -->
    <div class="space-y-2">
      <button @click="showCoordinates = !showCoordinates"
        class="w-full flex items-center justify-between text-sm font-medium text-gray-700 dark:text-gray-300 hover:text-[#FF6600] transition-colors group">
        <span class="flex items-center gap-2">
          <MapPin :size="16" class="text-gray-500 dark:text-gray-400 group-hover:text-[#FF6600] transition-colors" />
          Grid Center
        </span>
        <ChevronDown :size="14" :class="['transition-transform duration-200', showCoordinates ? 'rotate-180' : '']" />
      </button>

      <template v-if="showCoordinates">
        <CoordinatesInput :center="center" @locationChange="handleLocationChange" />
      </template>
    </div>

    <hr class="border-gray-200 dark:border-gray-600" />

    <BatchExportOptions
      :exports="exports"
      :include-o-s-m="includeOSM"
      :mesh-resolution="meshResolution"
      @update:exports="handleExportsUpdate"
      @update:mesh-resolution="(v) => meshResolution.value = v"
    />

    <hr class="border-gray-200 dark:border-gray-600" />

    <!-- Selected exports count -->
    <div class="text-[10px] text-gray-500 dark:text-gray-400 bg-gray-50 dark:bg-gray-700 p-2 rounded border border-gray-200 dark:border-gray-600 space-y-1">
      <p><span class="font-medium text-gray-700 dark:text-gray-300">{{ selectedExportCount }} export{{ selectedExportCount !== 1 ? 's' : '' }}</span> selected per tile</p>
      <p>{{ totalTiles }} tiles × {{ selectedExportCount }} exports = <span class="text-[#FF6600] font-bold">{{ totalTiles * selectedExportCount }} total files</span> (packaged as {{ totalTiles }} ZIPs)</p>
      <p class="text-amber-600 dark:text-amber-500 font-medium mt-1">
        ℹ️ Your browser may ask permission to download multiple files.
      </p>
    </div>

    <!-- Action Buttons -->
    <div class="space-y-2">
      <BatchRunConfigControls
        :status="runConfigStatus"
        @copy="copyRunConfiguration"
        @paste="pasteRunConfiguration"
        @save="saveRunConfiguration"
        @load="handleRunConfigFile"
      />

      <BaseButton
        block
        size="lg"
        variant="primary"
        :disabled="selectedExportCount === 0 || totalTiles === 0 || isRunning || (elevationSource === 'gpxz' && !gpxzApiKey)"
        @click="handleStart"
      >
        <Play :size="16" />
        Start Batch Job ({{ totalTiles }} tiles)
      </BaseButton>

      <template v-if="hasResumableSavedState">
        <BaseButton block size="md" variant="primary" class="bg-emerald-600 hover:bg-emerald-700" @click="$emit('resumeBatch')">
          <RotateCcw :size="14" />
          Resume Previous Job ({{ savedState.totalCompleted }}/{{ savedState.tiles.length }} done)
        </BaseButton>
        <BaseButton block size="sm" variant="secondary" @click="$emit('clearSavedBatch')">
          <X :size="12" />
          Clear Saved Job
        </BaseButton>
        <BaseButton block size="sm" variant="secondary" @click="$emit('clearCache')">
          <X :size="12" />
          Clear Cache
        </BaseButton>
      </template>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, watch, nextTick } from 'vue';
import { Grid3X3, Box, Trees, Mountain, MapPin, ChevronDown, Play, RotateCcw, X, AlertTriangle } from 'lucide-vue-next';
import CoordinatesInput from '../map/CoordinatesInput.vue';
import ElevationSourceSelector from '../map/ElevationSourceSelector.vue';
import ResolutionSelector from '../map/ResolutionSelector.vue';
import BatchGridConfig from '../batch/BatchGridConfig.vue';
import BatchPerformanceProfile from '../batch/BatchPerformanceProfile.vue';
import BatchExportOptions from '../batch/BatchExportOptions.vue';
import BatchRunConfigControls from '../batch/BatchRunConfigControls.vue';
import BaseButton from '../base/BaseButton.vue';
import { probeGPXZLimits } from '../../services/terrain';
import { cloneRateLimitInfo, downloadJsonFile } from '../../services/traceability';

const props = defineProps({
  center: { type: Object, required: true },
  resolution: { type: Number, required: true },
  isRunning: { type: Boolean, default: false },
  savedState: { type: Object, default: null },
  tileOffsets: { type: Array, default: () => [] },
  tileNames: { type: Array, default: () => [] },
  tileFollowCenter: { type: Boolean, default: true },
});

const emit = defineEmits([
  'locationChange', 'resolutionChange', 'startBatch',
  'resumeBatch', 'clearSavedBatch', 'update:gridCols', 'update:gridRows', 'update:tileOffsets', 'update:tileNames', 'update:tileFollowCenter', 'clearCache',
]);

const handleLocationChange = (newLocation) => {
  emit('locationChange', { ...props.center, ...newLocation });
};

// Grid config
const gridCols = ref(parseInt(localStorage.getItem('mapng_batch_cols')) || 3);
const gridRows = ref(parseInt(localStorage.getItem('mapng_batch_rows')) || 3);
const sharedElevationBaseline = ref(localStorage.getItem('mapng_batch_shared_elevation') === 'true');
const tileFollowCenterLocal = ref(props.tileFollowCenter);

const normalizeTileOffsets = (offsets, tileCount) => {
  const map = new Map();
  if (Array.isArray(offsets)) {
    offsets.forEach((entry) => {
      const index = Number(entry?.index);
      if (!Number.isInteger(index) || index < 0 || index >= tileCount) return;
      map.set(index, {
        index,
        offsetX: Number.isFinite(Number(entry?.offsetX)) ? Number(entry.offsetX) : 0,
        offsetY: Number.isFinite(Number(entry?.offsetY)) ? Number(entry.offsetY) : 0,
      });
    });
  }

  const normalized = [];
  for (let index = 0; index < tileCount; index++) {
    normalized.push(map.get(index) || { index, offsetX: 0, offsetY: 0 });
  }
  return normalized;
};

const tileOffsets = ref([]);
const tileNames = ref([]);

const defaultTileName = (index, cols = gridCols.value) => {
  const safeCols = Math.max(1, cols);
  return `R${Math.floor(index / safeCols) + 1}C${(index % safeCols) + 1}`;
};

const normalizeTileNames = (names, tileCount, cols = gridCols.value) => {
  const map = new Map();
  if (Array.isArray(names)) {
    names.forEach((entry) => {
      const index = Number(entry?.index);
      if (!Number.isInteger(index) || index < 0 || index >= tileCount) return;
      const value = String(entry?.name || '').trim();
      if (!value || value === defaultTileName(index, cols)) return;
      map.set(index, { index, name: value });
    });
  }

  const normalized = [];
  for (let index = 0; index < tileCount; index++) {
    normalized.push(map.get(index) || { index, name: '' });
  }
  return normalized;
};

// Settings
const includeOSM = ref(localStorage.getItem('mapng_batch_osm') !== 'false');
const elevationSource = ref(localStorage.getItem('mapng_batch_elevation') || 'default');
const gpxzApiKey = ref(localStorage.getItem('mapng_gpxzApiKey') || '');
const gpxzStatus = ref(null);
const isCheckingGPXZ = ref(false);
const showCoordinates = ref(false);
const meshResolution = ref(parseInt(localStorage.getItem('mapng_batch_mesh')) || 256);
const performanceProfile = ref(localStorage.getItem('mapng_batch_profile') || 'balanced');
const runConfigStatus = ref('');

const DEFAULT_EXPORTS = {
  heightmap: true,
  satellite: true,
  osmTexture: false,
  hybridTexture: false,
  segmentedSatellite: false,
  segmentedHybrid: false,
  roadMask: false,
  glb: false,
  dae: false,
  ter: false,
  geotiff: false,
  geojson: false,
};

const normalizeExports = (value) => {
  const src = (value && typeof value === 'object') ? value : {};
  const normalized = {};
  Object.keys(DEFAULT_EXPORTS).forEach((key) => {
    normalized[key] = src[key] === true;
  });
  return normalized;
};

// Export options
const exports = ref({ ...DEFAULT_EXPORTS });

// Load saved export prefs
try {
  const saved = localStorage.getItem('mapng_batch_exports');
  if (saved) {
    exports.value = normalizeExports(JSON.parse(saved));
  } else {
    exports.value = normalizeExports(DEFAULT_EXPORTS);
  }
} catch { /* ignore */ }
localStorage.setItem('mapng_batch_exports', JSON.stringify(exports.value));

const handleExportsUpdate = (nextExports) => {
  exports.value = normalizeExports(nextExports);
  localStorage.setItem('mapng_batch_exports', JSON.stringify(exports.value));
};

// Formatting helpers
function formatDist(km) {
  return km >= 1 ? `${km.toFixed(1)} km` : `${(km * 1000).toFixed(0)} m`;
}
function formatArea(km2) {
  return km2 >= 1 ? `${km2.toFixed(2)} km²` : `${(km2 * 1_000_000).toFixed(0)} m²`;
}

// Computed
const totalTiles = computed(() => gridCols.value * gridRows.value);
const gridWidthKm = computed(() => (gridCols.value * props.resolution) / 1000);
const gridHeightKm = computed(() => (gridRows.value * props.resolution) / 1000);
const totalAreaKm = computed(() => gridWidthKm.value * gridHeightKm.value);
const totalAreaDisplay = computed(() => formatArea(totalAreaKm.value));
const tileAreaKm = computed(() => (props.resolution * props.resolution) / 1_000_000);
const tileAreaDisplay = computed(() => formatArea(tileAreaKm.value));
const perimeterDisplay = computed(() => formatDist(2 * (gridWidthKm.value + gridHeightKm.value)));
const gridWidthDisplay = computed(() => formatDist(gridWidthKm.value));
const gridHeightDisplay = computed(() => formatDist(gridHeightKm.value));
const selectedExportCount = computed(() =>
  Object.values(exports.value).filter(Boolean).length
);

const hasResumableSavedState = computed(() => {
  if (!props.savedState || props.isRunning) return false;
  return props.savedState.status !== 'completed';
});

const tileOffsetEntries = computed(() =>
  tileOffsets.value.map((entry) => ({
    ...entry,
    row: Math.floor(entry.index / Math.max(1, gridCols.value)),
    col: entry.index % Math.max(1, gridCols.value),
  }))
);

const tileNameEntries = computed(() =>
  tileNames.value.map((entry) => ({
    ...entry,
    row: Math.floor(entry.index / Math.max(1, gridCols.value)),
    col: entry.index % Math.max(1, gridCols.value),
    defaultName: defaultTileName(entry.index),
  }))
);

const emitTileOffsets = () => {
  const nonZero = tileOffsets.value
    .filter((entry) => Math.abs(entry.offsetX) > 0 || Math.abs(entry.offsetY) > 0)
    .map((entry) => ({ ...entry }));
  emit('update:tileOffsets', nonZero);
};

const emitTileNames = () => {
  const customNames = tileNames.value
    .map((entry) => ({
      index: entry.index,
      name: String(entry.name || '').trim(),
    }))
    .filter((entry) => entry.name && entry.name !== defaultTileName(entry.index))
    .map((entry) => ({ ...entry }));
  emit('update:tileNames', customNames);
};

const updateTileOffset = (index, axis, value) => {
  const numeric = Number(value);
  const next = Number.isFinite(numeric) ? numeric : 0;
  const row = tileOffsets.value[index];
  if (!row) return;
  row[axis] = next;
  emitTileOffsets();
};

const resetTileOffset = (index) => {
  const row = tileOffsets.value[index];
  if (!row) return;
  row.offsetX = 0;
  row.offsetY = 0;
  emitTileOffsets();
};

const resetTileOffsets = () => {
  tileOffsets.value = normalizeTileOffsets([], totalTiles.value);
  emitTileOffsets();
};

const updateTileName = (index, value) => {
  const row = tileNames.value[index];
  if (!row) return;
  row.name = String(value || '');
  emitTileNames();
};

const resetTileNames = () => {
  tileNames.value = normalizeTileNames([], totalTiles.value);
  emitTileNames();
};

// Handlers
const handleStart = () => {
  emit('startBatch', {
    center: { ...props.center },
    resolution: props.resolution,
    gridCols: gridCols.value,
    gridRows: gridRows.value,
    tileNames: tileNames.value
      .map((entry) => ({ index: entry.index, name: String(entry.name || '').trim() }))
      .filter((entry) => entry.name && entry.name !== defaultTileName(entry.index)),
    tileOffsets: tileOffsets.value
      .filter((entry) => Math.abs(entry.offsetX) > 0 || Math.abs(entry.offsetY) > 0)
      .map((entry) => ({ ...entry })),
    elevationNormalization: {
      enabled: sharedElevationBaseline.value,
      scope: 'global_batch',
    },
    includeOSM: includeOSM.value,
    elevationSource: elevationSource.value,
    gpxzApiKey: gpxzApiKey.value,
    gpxzStatus: gpxzStatus.value ? { ...gpxzStatus.value } : cloneRateLimitInfo(),
    glbMeshResolution: meshResolution.value,
    performanceProfile: performanceProfile.value,
    exports: { ...exports.value },
  });
};

const buildRunConfiguration = () => {
  return {
    schemaVersion: 1,
    mode: 'batch',
    center: { ...props.center },
    resolution: props.resolution,
    gridCols: gridCols.value,
    gridRows: gridRows.value,
    tileNames: tileNames.value
      .map((entry) => ({ index: entry.index, name: String(entry.name || '').trim() }))
      .filter((entry) => entry.name && entry.name !== defaultTileName(entry.index)),
    tileOffsets: tileOffsets.value
      .filter((entry) => Math.abs(entry.offsetX) > 0 || Math.abs(entry.offsetY) > 0)
      .map((entry) => ({ ...entry })),
    elevationNormalization: {
      enabled: sharedElevationBaseline.value,
      scope: 'global_batch',
    },
    includeOSM: includeOSM.value,
    elevationSource: elevationSource.value,
    gpxzApiKey: gpxzApiKey.value || '',
    gpxzStatus: gpxzStatus.value ? { ...gpxzStatus.value } : cloneRateLimitInfo(),
    glbMeshResolution: meshResolution.value,
    performanceProfile: performanceProfile.value,
    exports: { ...exports.value },
  };
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
    console.error('Failed to paste batch configuration:', error);
    runConfigStatus.value = 'Clipboard content is not valid configuration JSON.';
  }
};

const saveRunConfiguration = () => {
  const payload = buildRunConfiguration();
  downloadJsonFile(payload, `MapNG_BatchRunConfig_${new Date().toISOString().slice(0, 10)}.json`);
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

const normalizePerformanceProfile = (value) => {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'throughput' || normalized === 'max_throughput' || normalized === 'max-throughput') {
    return 'throughput';
  }
  if (normalized === 'low_memory' || normalized === 'low-memory' || normalized === 'low memory') {
    return 'low_memory';
  }
  return normalized === 'balanced' ? 'balanced' : null;
};

const applyRunConfiguration = (config) => {
  const src = config?.runConfiguration || config;
  if (!src || typeof src !== 'object') throw new Error('Invalid JSON schema');

  const schemaVersion = Number(src.schemaVersion ?? 1);
  const modeRaw = String(src.mode || config?.mode || 'batch').toLowerCase();
  if (schemaVersion !== 1 || modeRaw !== 'batch') {
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

  const colsValue = toNumberOrNull(src.gridCols);
  if (colsValue !== null) {
    gridCols.value = clampInt(colsValue, 1, 20);
  }

  const rowsValue = toNumberOrNull(src.gridRows);
  if (rowsValue !== null) {
    gridRows.value = clampInt(rowsValue, 1, 20);
  }

  if (Array.isArray(src.tileOffsets)) {
    tileOffsets.value = normalizeTileOffsets(src.tileOffsets, totalTiles.value);
    emitTileOffsets();
  }

  if (Array.isArray(src.tileNames)) {
    tileNames.value = normalizeTileNames(src.tileNames, totalTiles.value);
    emitTileNames();
  }

  if (src.elevationNormalization && typeof src.elevationNormalization === 'object') {
    const enabledValue = toBooleanOrNull(src.elevationNormalization.enabled);
    sharedElevationBaseline.value = enabledValue === null ? sharedElevationBaseline.value : enabledValue;
  }

  const includeOSMValue = toBooleanOrNull(src.includeOSM);
  if (includeOSMValue !== null) {
    includeOSM.value = includeOSMValue;
  }

  const explicitSource = typeof src.elevationSource === 'string' ? src.elevationSource.toLowerCase() : null;
  if (explicitSource && ['default', 'usgs', 'gpxz'].includes(explicitSource)) {
    elevationSource.value = explicitSource;
  } else {
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

  const meshResolutionValue = toNumberOrNull(src.glbMeshResolution);
  if (meshResolutionValue !== null) {
    meshResolution.value = clampInt(meshResolutionValue, 64, 1024);
  }

  const nextProfile = normalizePerformanceProfile(src.performanceProfile);
  if (nextProfile) {
    performanceProfile.value = nextProfile;
  }

  if (src.exports && typeof src.exports === 'object') {
    exports.value = normalizeExports(src.exports);
    localStorage.setItem('mapng_batch_exports', JSON.stringify(exports.value));
  }
};

const handleRunConfigFile = async (file) => {
  if (!file) return;

  try {
    const text = await file.text();
    const json = JSON.parse(text);
    applyRunConfiguration(json);
    runConfigStatus.value = 'Configuration loaded. Start batch to rerun with these settings.';
  } catch (error) {
    console.error('Failed to load batch configuration:', error);
    runConfigStatus.value = 'Invalid configuration file (schema mismatch).';
  }
};

// Emit grid changes for map overlay
watch(gridCols, (v) => {
  localStorage.setItem('mapng_batch_cols', String(v));
  emit('update:gridCols', v);
});
watch(gridRows, (v) => {
  localStorage.setItem('mapng_batch_rows', String(v));
  emit('update:gridRows', v);
});

watch([gridCols, gridRows], () => {
  tileOffsets.value = normalizeTileOffsets(tileOffsets.value, totalTiles.value);
  tileNames.value = normalizeTileNames(tileNames.value, totalTiles.value);
  emitTileOffsets();
  emitTileNames();
}, { immediate: true });

watch(() => props.tileOffsets, (value) => {
  tileOffsets.value = normalizeTileOffsets(value, totalTiles.value);
}, { immediate: true, deep: true });
watch(() => props.tileNames, (value) => {
  tileNames.value = normalizeTileNames(value, totalTiles.value);
}, { immediate: true, deep: true });
watch(() => props.tileFollowCenter, (value) => {
  tileFollowCenterLocal.value = !!value;
}, { immediate: true });
watch(tileFollowCenterLocal, (value) => {
  emit('update:tileFollowCenter', !!value);
});
watch(sharedElevationBaseline, (v) => localStorage.setItem('mapng_batch_shared_elevation', String(v)));

// Persist settings
watch(includeOSM, (v) => localStorage.setItem('mapng_batch_osm', String(v)));
watch(elevationSource, (v) => localStorage.setItem('mapng_batch_elevation', v));
watch(gpxzApiKey, (v) => {
  localStorage.setItem('mapng_gpxzApiKey', v);
  gpxzStatus.value = null;
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
watch(meshResolution, (v) => localStorage.setItem('mapng_batch_mesh', String(v)));
watch(performanceProfile, (v) => localStorage.setItem('mapng_batch_profile', v));
watch(exports, (v) => localStorage.setItem('mapng_batch_exports', JSON.stringify(normalizeExports(v))), {
  deep: true,
  flush: 'sync',
});

// Disable OSM-dependent exports when OSM is off
watch(includeOSM, (v) => {
  if (!v) {
    exports.value.osmTexture = false;
    exports.value.hybridTexture = false;
    exports.value.segmentedHybrid = false;
    exports.value.roadMask = false;
    exports.value.geojson = false;
  }
});

// Initial emit to set grid on map
emit('update:gridCols', gridCols.value);
emit('update:gridRows', gridRows.value);
</script>
