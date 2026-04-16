<template>
  <div class="space-y-3">
    <label class="text-sm font-medium text-gray-700 dark:text-gray-300 flex items-center gap-2">
      <Download :size="16" class="text-gray-700 dark:text-gray-300" />
      {{ t('batchExport.title') }}
    </label>

    <div class="space-y-1.5">
      <h4 class="text-[10px] font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500">{{ t('batchExport.assets2d') }}</h4>
      <BaseCard padded class="space-y-1 bg-gray-50 dark:bg-gray-700 border-gray-200 dark:border-gray-600">
        <label class="flex items-center gap-2 cursor-pointer text-xs text-gray-700 dark:text-gray-300">
          <input type="checkbox" class="accent-[#FF6600] w-3.5 h-3.5" :checked="exports.heightmap" @change="updateExport('heightmap', $event.target.checked)" />
          {{ t('batchExport.heightmap') }}
        </label>
        <label class="flex items-center gap-2 cursor-pointer text-xs text-gray-700 dark:text-gray-300">
          <input type="checkbox" class="accent-[#FF6600] w-3.5 h-3.5" :checked="exports.satellite" @change="updateExport('satellite', $event.target.checked)" />
          {{ t('batchExport.satelliteTexture') }}
        </label>
        <label class="flex items-center gap-2 cursor-pointer text-xs text-gray-700 dark:text-gray-300" :class="{ 'opacity-50': !includeOSM }">
          <input type="checkbox" class="accent-[#FF6600] w-3.5 h-3.5" :checked="exports.osmTexture" :disabled="!includeOSM" @change="updateExport('osmTexture', $event.target.checked)" />
          {{ t('batchExport.osmTexture') }}
        </label>
        <label class="flex items-center gap-2 cursor-pointer text-xs text-gray-700 dark:text-gray-300" :class="{ 'opacity-50': !includeOSM }">
          <input type="checkbox" class="accent-[#FF6600] w-3.5 h-3.5" :checked="exports.hybridTexture" :disabled="!includeOSM" @change="updateExport('hybridTexture', $event.target.checked)" />
          {{ t('batchExport.hybridTexture') }}
        </label>
        <label class="flex items-center gap-2 cursor-pointer text-xs text-gray-700 dark:text-gray-300" :class="{ 'opacity-50': !includeOSM }">
          <input type="checkbox" class="accent-[#FF6600] w-3.5 h-3.5" :checked="exports.roadMask" :disabled="!includeOSM" @change="updateExport('roadMask', $event.target.checked)" />
          {{ t('batchExport.roadMask') }}
        </label>
      </BaseCard>
    </div>

    <div class="space-y-1.5">
      <h4 class="text-[10px] font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500">{{ t('batchExport.models3d') }}</h4>
      <BaseCard padded class="space-y-1 bg-gray-50 dark:bg-gray-700 border-gray-200 dark:border-gray-600">
        <label class="flex items-center gap-2 cursor-pointer text-xs text-gray-700 dark:text-gray-300">
          <input type="checkbox" class="accent-[#FF6600] w-3.5 h-3.5" :checked="exports.glb" @change="updateExport('glb', $event.target.checked)" />
          {{ t('batchExport.glbModel') }}
        </label>
        <label class="flex items-center gap-2 cursor-pointer text-xs text-gray-700 dark:text-gray-300">
          <input type="checkbox" class="accent-[#FF6600] w-3.5 h-3.5" :checked="exports.dae" @change="updateExport('dae', $event.target.checked)" />
          {{ t('batchExport.colladaDae') }}
        </label>
        <label class="flex items-center gap-2 cursor-pointer text-xs text-gray-700 dark:text-gray-300">
          <input type="checkbox" class="accent-[#FF6600] w-3.5 h-3.5" :checked="exports.ter" @change="updateExport('ter', $event.target.checked)" />
          {{ t('batchExport.beamngTerrain') }}
        </label>
        <div v-if="exports.glb || exports.dae" class="flex items-center gap-2 pt-1 mt-1 border-t border-gray-200 dark:border-gray-600">
          <span class="text-[10px] text-gray-500 dark:text-gray-400">{{ t('batchExport.meshQuality') }}</span>
          <select
            class="text-[10px] bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded px-1.5 py-0.5 text-gray-600 dark:text-gray-300 cursor-pointer"
            :value="meshResolution"
            @change="$emit('update:meshResolution', Number($event.target.value))"
          >
            <option :value="128">{{ t('batchExport.qualityLow') }}</option>
            <option :value="256">{{ t('batchExport.qualityMedium') }}</option>
            <option :value="512">{{ t('batchExport.qualityHigh') }}</option>
            <option :value="1024">{{ t('batchExport.qualityUltra') }}</option>
          </select>
        </div>
        <p v-if="exports.glb || exports.dae" class="text-[10px] text-gray-500 dark:text-gray-400">
          {{ t('batchExport.modelsNoSurroundings') }}
        </p>
      </BaseCard>
    </div>

    <div class="space-y-1.5">
      <h4 class="text-[10px] font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500">{{ t('batchExport.geoData') }}</h4>
      <BaseCard padded class="space-y-1 bg-gray-50 dark:bg-gray-700 border-gray-200 dark:border-gray-600">
        <label class="flex items-center gap-2 cursor-pointer text-xs text-gray-700 dark:text-gray-300">
          <input type="checkbox" class="accent-[#FF6600] w-3.5 h-3.5" :checked="exports.geotiff" @change="updateExport('geotiff', $event.target.checked)" />
          {{ t('batchExport.geoTiff') }}
        </label>
        <label class="flex items-center gap-2 cursor-pointer text-xs text-gray-700 dark:text-gray-300" :class="{ 'opacity-50': !includeOSM }">
          <input type="checkbox" class="accent-[#FF6600] w-3.5 h-3.5" :checked="exports.geojson" :disabled="!includeOSM" @change="updateExport('geojson', $event.target.checked)" />
          {{ t('batchExport.geoJson') }}
        </label>
      </BaseCard>
    </div>
  </div>
</template>

<script setup>
import { useI18n } from 'vue-i18n';
import BaseCard from '../base/BaseCard.vue';
import { Download } from 'lucide-vue-next';

const { t } = useI18n({ useScope: 'global' });

const props = defineProps({
  exports: { type: Object, required: true },
  includeOSM: { type: Boolean, default: true },
  meshResolution: { type: Number, default: 512 },
});

const emit = defineEmits(['update:exports', 'update:meshResolution']);

const updateExport = (key, value) => {
  emit('update:exports', { ...props.exports, [key]: value });
};
</script>
