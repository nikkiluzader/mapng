<template>
  <!-- Active: badge with file info + clear button -->
  <div v-if="uploadedElevationFile" class="flex items-center gap-2 px-3 py-2 rounded-lg bg-blue-50 dark:bg-blue-950 border border-blue-200 dark:border-blue-800 text-sm">
    <FileUp :size="14" class="shrink-0 text-blue-500 dark:text-blue-400" />
    <div class="flex-1 min-w-0">
      <p class="font-medium text-blue-800 dark:text-blue-200 truncate">{{ uploadedElevationFile.name }}</p>

      <!-- LAZ/LAS status -->
      <template v-if="isLazFile">
        <p v-if="uploadedElevationMeta?.center" class="text-[11px] text-emerald-600 dark:text-emerald-400">
          {{ ptLabel }} — {{ t('upload.autoDetected') }}
        </p>
        <p v-else-if="uploadedElevationMeta" class="text-[11px] text-amber-600 dark:text-amber-400">
          {{ ptLabel }} — {{ t('upload.usingSelected') }}
        </p>
        <p v-else class="text-[11px] text-blue-500 dark:text-blue-400 animate-pulse">
          {{ t('upload.reading') }}
        </p>
      </template>

      <!-- Raster/text upload status (GeoTIFF, ASC, GML, XML, ZIP) -->
      <template v-else>
        <p v-if="uploadedElevationMeta?.center" class="text-[11px] text-emerald-600 dark:text-emerald-400">
          {{ detectedStatusLabel }}
        </p>
        <p v-else-if="uploadedElevationMeta?.isGeoReferenced" class="text-[11px] text-amber-600 dark:text-amber-400">
          {{ unsupportedStatusLabel }}
        </p>
        <p v-else-if="uploadedElevationMeta" class="text-[11px] text-amber-600 dark:text-amber-400">
          {{ t('upload.noGeoMetadata') }}
        </p>
        <p v-else class="text-[11px] text-blue-500 dark:text-blue-400 animate-pulse">
          {{ t('upload.reading') }}
        </p>
      </template>

      <div v-if="uploadedElevationMeta" class="mt-2 space-y-1.5">
        <div class="flex items-center gap-2">
          <label class="w-24 shrink-0 text-[11px] font-medium text-blue-700 dark:text-blue-300">{{ t('upload.elevationUnits') }}</label>
          <select
            :value="verticalUnitOverride"
            @change="$emit('update:verticalUnitOverride', $event.target.value)"
            class="flex-1 min-w-0 text-[11px] rounded-md border border-blue-300 dark:border-blue-700 bg-white dark:bg-gray-900 px-2 py-1 text-gray-700 dark:text-gray-200 focus:outline-none focus:ring-1 focus:ring-[#FF6600] focus:border-[#FF6600]"
          >
            <option value="auto">{{ t('upload.auto') }} ({{ detectedUnitLabel }})</option>
            <option value="meters">{{ t('upload.meters') }}</option>
            <option value="feet">{{ t('upload.feetIntl') }}</option>
            <option value="us_survey_feet">{{ t('upload.feetUs') }}</option>
          </select>
        </div>

        <div v-if="showAscCoordinateSelector" class="flex items-center gap-2">
          <label class="w-24 shrink-0 text-[11px] font-medium text-blue-700 dark:text-blue-300">{{ t('upload.coordinateSystem') }}</label>
          <select
            :value="ascCoordinateSystem"
            @change="$emit('update:ascCoordinateSystem', $event.target.value)"
            class="flex-1 min-w-0 text-[11px] rounded-md border border-blue-300 dark:border-blue-700 bg-white dark:bg-gray-900 px-2 py-1 text-gray-700 dark:text-gray-200 focus:outline-none focus:ring-1 focus:ring-[#FF6600] focus:border-[#FF6600]"
          >
            <option value="auto">{{ t('upload.auto') }}</option>
            <option value="2180">{{ t('upload.crsPl1992') }}</option>
          </select>
        </div>
      </div>
    </div>
    <button
      @click="$emit('clear')"
      class="shrink-0 p-1 rounded hover:bg-blue-100 dark:hover:bg-blue-900 text-blue-400 hover:text-blue-600 dark:hover:text-blue-200 transition-colors"
      :title="t('upload.removeUploaded')"
    >
      <X :size="14" />
    </button>
  </div>

  <!-- Idle: upload trigger -->
  <div v-else>
    <label
      class="flex items-center gap-2 w-full px-3 py-2 rounded-lg border border-dashed border-gray-300 dark:border-gray-600 text-sm text-gray-500 dark:text-gray-400 hover:border-[#FF6600] hover:text-[#FF6600] dark:hover:border-[#FF6600] dark:hover:text-[#FF6600] cursor-pointer transition-colors"
    >
      <Upload :size="14" class="shrink-0" />
      <span>{{ t('upload.uploadElevation') }}</span>
      <input
        ref="fileInput"
        type="file"
        accept=".tif,.tiff,.asc,.gml,.xml,.zip,.laz,.las"
        class="sr-only"
        @change="handleFileChange"
      />
    </label>
  </div>
</template>

<script setup>
import { ref, computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { Upload, FileUp, X } from 'lucide-vue-next';

const { t } = useI18n({ useScope: 'global' });

const props = defineProps({
  uploadedElevationFile: { type: Object, default: null },
  uploadedElevationMeta: { type: Object, default: null },
  verticalUnitOverride: { type: String, default: 'auto' },
  ascCoordinateSystem: { type: String, default: 'auto' },
});

const emit = defineEmits(['file-selected', 'clear', 'update:verticalUnitOverride', 'update:ascCoordinateSystem']);
const fileInput = ref(null);

const isLazFile = computed(() => {
  const name = props.uploadedElevationFile?.name?.toLowerCase() ?? '';
  return name.endsWith('.laz') || name.endsWith('.las');
});

const rasterFormatLabel = computed(() => props.uploadedElevationMeta?.formatLabel || 'Raster');

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

const showAscCoordinateSelector = computed(() => props.uploadedElevationMeta?.sourceFormat === 'asc');

const handleFileChange = (e) => {
  const file = e.target.files?.[0];
  if (file) emit('file-selected', file);
  if (fileInput.value) fileInput.value.value = '';
};
</script>
