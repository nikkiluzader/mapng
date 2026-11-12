<template>
  <div class="space-y-2">
  <!-- Active: badge with file info + clear button -->
  <div v-if="uploadedElevationFile" class="flex items-center gap-2 px-3 py-2 rounded-lg bg-blue-50 dark:bg-blue-950 border border-blue-200 dark:border-blue-800 text-sm">
    <!-- self-start: the card grows tall once the no-data help is expanded, and a
         vertically centred icon/button pair drifts away from the filename. -->
    <FileUp :size="14" class="shrink-0 self-start mt-0.5 text-blue-500 dark:text-blue-400" />
    <div class="flex-1 min-w-0">
      <p class="font-medium text-blue-800 dark:text-blue-200 truncate">{{ uploadedFileLabel }}</p>

      <!-- LAZ/LAS status -->
      <template v-if="isLazFile">
        <p v-if="uploadedElevationMeta?.center" class="text-caption text-emerald-600 dark:text-emerald-400">
          {{ ptLabel }} — {{ t('upload.autoDetected') }}
        </p>
        <p v-else-if="uploadedElevationMeta" class="text-caption text-amber-600 dark:text-amber-400">
          {{ ptLabel }} — {{ t('upload.usingSelected') }}
        </p>
        <p v-else class="text-caption text-blue-500 dark:text-blue-400 animate-pulse">
          {{ t('upload.reading') }}
        </p>
      </template>

      <!-- Raster/text upload status (GeoTIFF, ASC, GML, XML, ZIP) -->
      <template v-else>
        <p v-if="uploadedElevationMeta?.center" class="text-caption text-emerald-600 dark:text-emerald-400">
          {{ detectedStatusLabel }}
        </p>
        <p v-else-if="uploadedElevationMeta?.isGeoReferenced" class="text-caption text-amber-600 dark:text-amber-400">
          {{ unsupportedStatusLabel }}
        </p>
        <!-- (an ASC grid with no location: at its real size on the map's centre, services/ascLoader.js) -->
        <p v-else-if="placedSize" class="text-caption text-amber-600 dark:text-amber-400" data-testid="upload-placed">
          {{ t('upload.placedAtCenter', { w: Math.round(placedSize.width).toLocaleString(), h: Math.round(placedSize.height).toLocaleString() }) }}
        </p>
        <p v-else-if="uploadedElevationMeta" class="text-caption text-amber-600 dark:text-amber-400">
          {{ t('upload.noGeoMetadata') }}
        </p>
        <p v-else class="text-caption text-blue-500 dark:text-blue-400 animate-pulse">
          {{ t('upload.reading') }}
        </p>
      </template>

      <div v-if="uploadedElevationMeta" class="mt-2 space-y-1.5">
        <div class="flex items-center gap-2">
          <label class="w-24 shrink-0 text-caption font-medium text-blue-700 dark:text-blue-300">{{ t('upload.elevationUnits') }}</label>
          <select
            :value="verticalUnitOverride"
            @change="$emit('update:verticalUnitOverride', $event.target.value)"
            class="flex-1 min-w-0 text-caption rounded-lg border border-blue-300 dark:border-blue-700 bg-white dark:bg-gray-900 px-2 py-1 text-gray-700 dark:text-gray-200 focus:outline-none focus:ring-1 focus:ring-brand focus:border-brand"
          >
            <option value="auto">{{ t('upload.auto') }} ({{ detectedUnitLabel }})</option>
            <option value="meters">{{ t('upload.meters') }}</option>
            <option value="feet">{{ t('upload.feetIntl') }}</option>
            <option value="us_survey_feet">{{ t('upload.feetUs') }}</option>
          </select>
        </div>

        <!-- Only shown when we *inferred* a no-data fill value. A tagged
             GDAL_NODATA needs no judgement call from the user, so it stays out
             of the way. -->
        <div v-if="detectedNoData !== null" class="space-y-1.5">
          <div class="flex items-center gap-2">
            <label class="w-24 shrink-0 flex items-center gap-1 text-caption font-medium text-blue-700 dark:text-blue-300">
              {{ t('upload.noDataValue') }}
              <button
                type="button"
                @click="showNoDataHelp = !showNoDataHelp"
                :title="t('upload.noDataWhatsThis')"
                :aria-expanded="showNoDataHelp"
                class="shrink-0 rounded text-blue-400 hover:text-blue-600 dark:text-blue-500 dark:hover:text-blue-300 transition-colors"
              >
                <CircleHelp :size="12" />
              </button>
            </label>
            <select
              :value="noDataMode"
              @change="handleNoDataModeChange($event.target.value)"
              class="flex-1 min-w-0 text-caption rounded-lg border border-blue-300 dark:border-blue-700 bg-white dark:bg-gray-900 px-2 py-1 text-gray-700 dark:text-gray-200 focus:outline-none focus:ring-1 focus:ring-brand focus:border-brand"
            >
              <option value="auto">{{ t('upload.noDataAuto', { value: formatNoData(detectedNoData) }) }}</option>
              <option value="none">{{ t('upload.noDataNone') }}</option>
              <option value="custom">{{ t('upload.noDataCustom') }}</option>
            </select>
          </div>

          <div v-if="noDataMode === 'custom'" class="flex items-center gap-2">
            <span class="w-24 shrink-0"></span>
            <input
              type="number"
              step="any"
              :value="customNoData"
              @change="handleCustomNoDataChange($event.target.value)"
              :placeholder="String(detectedNoData)"
              class="flex-1 min-w-0 text-caption rounded-lg border border-blue-300 dark:border-blue-700 bg-white dark:bg-gray-900 px-2 py-1 text-gray-700 dark:text-gray-200 tabular-nums focus:outline-none focus:ring-1 focus:ring-brand focus:border-brand"
            />
          </div>

          <div
            v-if="showNoDataHelp"
            class="rounded-lg bg-blue-100/70 dark:bg-blue-900/40 border border-blue-200 dark:border-blue-800 px-2 py-1.5 space-y-1.5 text-micro leading-relaxed text-blue-800 dark:text-blue-200"
          >
            <p>{{ t('upload.noDataHelpWhat') }}</p>
            <p>{{ t('upload.noDataHelpFound', { value: formatNoData(detectedNoData), percent: detectedNoDataPercent }) }}</p>
            <p>{{ t('upload.noDataHelpOverride', { value: formatNoData(detectedNoData) }) }}</p>
          </div>
        </div>

        <div v-if="showAscCoordinateSelector" class="flex items-center gap-2">
          <label class="w-24 shrink-0 text-caption font-medium text-blue-700 dark:text-blue-300">{{ t('upload.coordinateSystem') }}</label>
          <select
            :value="ascCoordinateSystem"
            @change="$emit('update:ascCoordinateSystem', $event.target.value)"
            class="flex-1 min-w-0 text-caption rounded-lg border border-blue-300 dark:border-blue-700 bg-white dark:bg-gray-900 px-2 py-1 text-gray-700 dark:text-gray-200 focus:outline-none focus:ring-1 focus:ring-brand focus:border-brand"
          >
            <option value="auto">{{ t('upload.auto') }}</option>
            <option value="2180">{{ t('upload.crsPl1992') }}</option>
          </select>
        </div>
      </div>
    </div>
    <button
      @click="$emit('clear')"
      class="shrink-0 self-start p-1 rounded hover:bg-blue-100 dark:hover:bg-blue-900 text-blue-400 hover:text-blue-600 dark:hover:text-blue-200 transition-colors"
      :title="t('upload.removeUploaded')"
    >
      <X :size="14" />
    </button>
  </div>

  <!-- Idle: upload trigger -->
  <div v-else>
    <label
      class="flex items-center gap-2 w-full px-3 py-2 rounded-lg border border-dashed border-gray-300 dark:border-gray-600 text-sm text-gray-500 dark:text-gray-400 hover:border-brand hover:text-brand dark:hover:border-brand dark:hover:text-brand cursor-pointer transition-colors"
    >
      <Upload :size="14" class="shrink-0" />
      <span>{{ t('upload.uploadElevation') }}</span>
      <input
        ref="fileInput"
        type="file"
        multiple
        accept=".tif,.tiff,.asc,.gml,.xml,.zip,.laz,.las"
        class="sr-only"
        @change="handleFileChange"
      />
    </label>
  </div>

  <!-- Fallback layer slots: each is its own upload, consulted only where every
       slot above it has no data. -->
  <template v-if="supportsFallbackLayers">
    <div
      v-for="(slot, index) in fallbackSlots"
      :key="slot.id"
      class="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-blue-50/60 dark:bg-blue-950/60 border border-blue-200 dark:border-blue-800"
    >
      <span class="shrink-0 rounded bg-blue-200/70 dark:bg-blue-800/70 px-1.5 py-0.5 text-micro font-semibold text-blue-700 dark:text-blue-200 tabular-nums">
        {{ t('upload.fallbackBadge', { n: index + 1 }) }}
      </span>
      <div class="flex-1 min-w-0">
        <p class="truncate text-caption font-medium text-blue-800 dark:text-blue-200" :title="slotFileLabel(slot)">
          {{ slotFileLabel(slot) }}
        </p>
        <p v-if="slot.error" class="text-micro text-red-500 dark:text-red-400">{{ slot.error }}</p>
        <p v-else-if="!slot.meta" class="text-micro text-blue-500 dark:text-blue-400 animate-pulse">{{ t('upload.reading') }}</p>
        <p v-else class="text-micro text-emerald-600 dark:text-emerald-400">{{ slotSummary(slot) }}</p>
      </div>
      <button
        type="button"
        @click="$emit('slot-removed', index + 1)"
        :title="t('upload.removeFallbackLayer')"
        class="shrink-0 p-1 rounded text-blue-400 hover:text-blue-600 dark:hover:text-blue-200 hover:bg-blue-100 dark:hover:bg-blue-900 transition-colors"
      >
        <X :size="12" />
      </button>
    </div>

    <label
      v-if="canAddFallbackLayer"
      class="flex items-center gap-2 w-full px-3 py-1.5 rounded-lg border border-dashed border-blue-300 dark:border-blue-800 text-caption text-blue-600 dark:text-blue-400 hover:border-brand hover:text-brand cursor-pointer transition-colors"
    >
      <Plus :size="13" class="shrink-0" />
      <span>{{ t('upload.addFallbackLayer') }}</span>
      <input
        type="file"
        multiple
        :accept="fallbackAccept"
        class="sr-only"
        @change="handleFallbackChange"
      />
    </label>
    <p v-else-if="fallbackSlots.length >= maxFallbackSlots" class="px-1 text-micro text-gray-400 dark:text-gray-500">
      {{ t('upload.fallbackLayerLimit', { max: maxSlots }) }}
    </p>
  </template>

    <!-- Priority stack: which survey wins where they overlap, and what
         covers whatever none of them reach. Only worth showing once an
         upload actually resolves to more than one survey. -->
    <div v-if="orderedLayers.length > 1" class="space-y-1">
      <div class="flex items-center gap-1 text-caption font-medium text-blue-700 dark:text-blue-300">
        <Layers :size="12" class="shrink-0" />
        {{ t('upload.elevationLayers') }}
        <button
          type="button"
          @click="showLayerHelp = !showLayerHelp"
          :title="t('upload.noDataWhatsThis')"
          :aria-expanded="showLayerHelp"
          class="shrink-0 rounded text-blue-400 hover:text-blue-600 dark:text-blue-500 dark:hover:text-blue-300 transition-colors"
        >
          <CircleHelp :size="12" />
        </button>
      </div>

      <div
        v-if="showLayerHelp"
        class="rounded-lg bg-blue-100/70 dark:bg-blue-900/40 border border-blue-200 dark:border-blue-800 px-2 py-1.5 text-micro leading-relaxed text-blue-800 dark:text-blue-200"
      >
        {{ t('upload.layersHelp') }}
      </div>

      <ul class="space-y-1">
        <li
          v-for="(layer, index) in orderedLayers"
          :key="layer.id"
          class="flex items-center gap-1.5 rounded-lg border border-blue-200 dark:border-blue-800 bg-white/70 dark:bg-gray-900/50 px-2 py-1"
        >
          <span class="w-4 shrink-0 text-micro font-semibold text-blue-500 dark:text-blue-400 tabular-nums">{{ index + 1 }}.</span>
          <span class="flex-1 min-w-0 truncate text-caption text-gray-700 dark:text-gray-200" :title="layer.label">{{ layer.label }}</span>
          <span class="shrink-0 text-micro text-gray-400 dark:text-gray-500 tabular-nums">{{ t('upload.layerTileCount', { count: layer.indices.length }) }}</span>
          <button
            type="button"
            @click="moveLayer(index, -1)"
            :disabled="index === 0"
            :title="t('upload.layerMoveUp')"
            class="shrink-0 rounded p-0.5 text-blue-400 enabled:hover:text-blue-600 dark:enabled:hover:text-blue-300 disabled:opacity-25 transition-colors"
          >
            <ChevronUp :size="12" />
          </button>
          <button
            type="button"
            @click="moveLayer(index, 1)"
            :disabled="index === orderedLayers.length - 1"
            :title="t('upload.layerMoveDown')"
            class="shrink-0 rounded p-0.5 text-blue-400 enabled:hover:text-blue-600 dark:enabled:hover:text-blue-300 disabled:opacity-25 transition-colors"
          >
            <ChevronDown :size="12" />
          </button>
        </li>
      </ul>
    </div>

    <div v-if="showGapFillControl" class="space-y-1">
      <div class="flex items-center gap-2">
        <label class="w-24 shrink-0 text-caption font-medium text-blue-700 dark:text-blue-300">{{ t('upload.fillGapsWith') }}</label>
        <select
          :value="gapFillSource"
          @change="$emit('update:gapFillSource', $event.target.value)"
          class="flex-1 min-w-0 text-caption rounded-lg border border-blue-300 dark:border-blue-700 bg-white dark:bg-gray-900 px-2 py-1 text-gray-700 dark:text-gray-200 focus:outline-none focus:ring-1 focus:ring-brand focus:border-brand"
        >
          <option :value="GAP_FILL_STANDARD">{{ t('upload.gapFillStandard') }}</option>
          <option :value="GAP_FILL_GPXZ">{{ t('upload.gapFillGpxz') }}</option>
          <option :value="GAP_FILL_NONE">{{ t('upload.gapFillNone') }}</option>
        </select>
      </div>
      <p class="text-micro leading-snug text-blue-600/80 dark:text-blue-400/80 pl-[6.5rem]">
        {{ gapFillHint }}
      </p>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { Upload, FileUp, X, CircleHelp, Layers, ChevronUp, ChevronDown, Plus } from 'lucide-vue-next';
import { NODATA_AUTO, NODATA_NONE } from '../../services/nodataDetect.js';
import { ascNeedsPlacing, ascGroundSize } from '../../services/ascLoader.js';
import { applyLayerOrder } from '../../services/elevationLayers.js';
import { GAP_FILL_STANDARD, GAP_FILL_GPXZ, GAP_FILL_NONE } from '../../services/gapFillSources.js';

const { t } = useI18n({ useScope: 'global' });

const props = defineProps({
  uploadedElevationFile: { type: [Object, Array], default: null },
  uploadedElevationMeta: { type: Object, default: null },
  verticalUnitOverride: { type: String, default: 'auto' },
  ascCoordinateSystem: { type: String, default: 'auto' },
  noDataOverride: { type: [String, Number], default: NODATA_AUTO },
  layerOrder: { type: Array, default: null },
  gapFillSource: { type: String, default: GAP_FILL_STANDARD },
  gpxzKeyAvailable: { type: Boolean, default: false },
  layerSlots: { type: Array, default: () => [] },
  maxSlots: { type: Number, default: 5 },
});

const emit = defineEmits([
  'file-selected',
  'clear',
  'update:verticalUnitOverride',
  'update:ascCoordinateSystem',
  'update:noDataOverride',
  'update:layerOrder',
  'update:gapFillSource',
  'slot-selected',
  'slot-removed',
]);
const fileInput = ref(null);
const showNoDataHelp = ref(false);
const showLayerHelp = ref(false);

const isLazFile = computed(() => {
  const file = Array.isArray(props.uploadedElevationFile)
    ? props.uploadedElevationFile[0]
    : props.uploadedElevationFile;
  const name = file?.name?.toLowerCase() ?? '';
  return name.endsWith('.laz') || name.endsWith('.las');
});

const uploadedFileLabel = computed(() => {
  // The base slot's own files — `uploadedElevationFile` is flattened across
  // every slot, so it would read "9 files" on a 3-file base upload.
  const baseFiles = props.layerSlots[0]?.files
    ?? (Array.isArray(props.uploadedElevationFile)
      ? props.uploadedElevationFile
      : (props.uploadedElevationFile ? [props.uploadedElevationFile] : []));
  if (baseFiles.length === 0) return '';
  if (baseFiles.length === 1) return baseFiles[0]?.name || '';
  return t('upload.filesSelected', { count: baseFiles.length });
});

const rasterFormatLabel = computed(() => props.uploadedElevationMeta?.formatLabel || 'Raster');
const placedSize = computed(() => (ascNeedsPlacing(props.uploadedElevationMeta) ? ascGroundSize(props.uploadedElevationMeta) : null));

const detectedStatusLabel = computed(() => `${rasterFormatLabel.value} - ${t('upload.autoDetected')}`);

const unsupportedStatusLabel = computed(() => `${rasterFormatLabel.value} - ${t('upload.unsupportedCrsUsingSelected')}`);

const ptLabel = computed(() => {
  const count = props.uploadedElevationMeta?.pointCount;
  if (!count) return t('upload.pointCloud');
  const m = count / 1_000_000;
  return m >= 1 ? `${m.toFixed(1)}M pts` : `${(count / 1000).toFixed(0)}K pts`;
});

const detectedUnitLabel = computed(() => {
  const u = props.uploadedElevationMeta?.verticalUnitDetected;
  if (u === 'meters') return t('upload.metersDetected');
  if (u === 'feet') return t('upload.feetDetected');
  if (u === 'us_survey_feet') return t('upload.usFeetDetected');
  return t('upload.unknownDefaultMeters');
});

// ── Fallback layer slots ────────────────────────────────────────────────────
const fallbackSlots = computed(() => props.layerSlots.slice(1));
const maxFallbackSlots = computed(() => Math.max(0, props.maxSlots - 1));

// Layering needs a georeferenced raster/grid base: point clouds run through a
// different pipeline, and an ungeoreferenced raster is stretched to the map
// rather than sampled, so neither can take a fallback behind it.
const supportsFallbackLayers = computed(() => {
  if (!props.uploadedElevationFile || isLazFile.value) return false;
  return !!props.uploadedElevationMeta?.isGeoReferenced;
});

const canAddFallbackLayer = computed(
  () => supportsFallbackLayers.value && props.layerSlots.length < props.maxSlots,
);

// Fallbacks must parse into the same kind of source as the base — the worker
// samples GeoTIFF tiles or grid tiles in one pass, not a mixture.
const fallbackAccept = computed(
  () => (props.uploadedElevationMeta?.sourceType === 'grid' ? '.asc,.gml,.xml,.zip' : '.tif,.tiff'),
);

const slotFileLabel = (slot) => {
  const files = slot?.files || [];
  if (files.length === 0) return '';
  return files.length === 1 ? files[0].name : t('upload.filesSelected', { count: files.length });
};

const slotSummary = (slot) => {
  const layers = slot?.meta?.layers || [];
  if (layers.length > 1) return layers.map((l) => l.label).join(' → ');
  return layers[0]?.label || slot?.meta?.formatLabel || '';
};

const handleFallbackChange = (e) => {
  const files = Array.from(e.target.files || []);
  if (files.length > 0) emit('slot-selected', props.layerSlots.length, files);
  e.target.value = '';
};

// ── Layer priority stack ────────────────────────────────────────────────────
const orderedLayers = computed(
  () => applyLayerOrder(props.uploadedElevationMeta?.layers || [], props.layerOrder),
);

const moveLayer = (index, direction) => {
  const ids = orderedLayers.value.map((layer) => layer.id);
  const target = index + direction;
  if (target < 0 || target >= ids.length) return;
  [ids[index], ids[target]] = [ids[target], ids[index]];
  emit('update:layerOrder', ids);
};

// Gaps are not only about layers: a single survey's polygon rarely fills a
// square export either, so the backstop is offered for any georeferenced upload.
const showGapFillControl = computed(() => !!props.uploadedElevationMeta?.isGeoReferenced);

const gapFillHint = computed(() => {
  if (props.gapFillSource === GAP_FILL_NONE) return t('upload.gapFillNoneHint');
  if (props.gapFillSource === GAP_FILL_GPXZ) {
    return props.gpxzKeyAvailable ? t('upload.gapFillGpxzHint') : t('upload.gapFillGpxzNoKeyHint');
  }
  return t('upload.gapFillStandardHint');
});

// Only an *inferred* fill value is surfaced — a file that declares GDAL_NODATA
// is unambiguous and needs no decision from the user.
const detectedNoData = computed(() => {
  const detection = props.uploadedElevationMeta?.noDataDetection;
  if (detection?.source !== 'detected' || !Number.isFinite(detection.value)) return null;
  return detection.value;
});

const detectedNoDataPercent = computed(() => {
  const share = props.uploadedElevationMeta?.noDataDetection?.share;
  if (!Number.isFinite(share)) return '—';
  return share >= 0.01 ? `${Math.round(share * 100)}` : `${(share * 100).toFixed(1)}`;
});

const formatNoData = (v) => {
  if (!Number.isFinite(v)) return '—';
  if (Math.abs(v) >= 1e6) return v.toExponential(2);
  return String(Number(v.toFixed(4)));
};

const noDataMode = computed(() => {
  const override = props.noDataOverride;
  if (override === NODATA_NONE) return 'none';
  if (override === NODATA_AUTO || override == null || override === '') return 'auto';
  return 'custom';
});

const customNoData = ref('');

// A new upload re-detects, so any override from the previous file is stale.
watch(detectedNoData, () => {
  showNoDataHelp.value = false;
  customNoData.value = '';
});

const handleNoDataModeChange = (mode) => {
  if (mode === 'auto') return emit('update:noDataOverride', NODATA_AUTO);
  if (mode === 'none') return emit('update:noDataOverride', NODATA_NONE);
  const seed = customNoData.value === '' ? detectedNoData.value : Number(customNoData.value);
  customNoData.value = String(seed ?? 0);
  emit('update:noDataOverride', String(seed ?? 0));
};

const handleCustomNoDataChange = (raw) => {
  customNoData.value = raw;
  const parsed = Number(raw);
  // An emptied box falls back to the detected value rather than masking nothing.
  emit('update:noDataOverride', raw === '' || !Number.isFinite(parsed) ? NODATA_AUTO : String(parsed));
};

const showAscCoordinateSelector = computed(() => {
  const sourceFormat = String(props.uploadedElevationMeta?.sourceFormat || '').toLowerCase();
  return sourceFormat === 'asc' || sourceFormat === 'asc-multi';
});

const handleFileChange = (e) => {
  const files = Array.from(e.target.files || []);
  if (files.length === 1) emit('file-selected', files[0]);
  else if (files.length > 1) emit('file-selected', files);
  if (fileInput.value) fileInput.value.value = '';
};
</script>
