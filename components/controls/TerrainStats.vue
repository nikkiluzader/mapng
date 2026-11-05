<template>
  <BaseCard v-if="terrainData" class="bg-gray-50 dark:bg-gray-700 border-gray-200 dark:border-gray-600 space-y-2" padded>
    <div class="grid grid-cols-3 gap-1 text-micro text-gray-500 dark:text-gray-400 border-b border-gray-200 dark:border-gray-600 pb-2">
      <div class="text-center border-r border-gray-200 dark:border-gray-600">
        <div class="text-gray-400 dark:text-gray-500">{{ t('terrainStats.min') }}</div>
        <div class="text-gray-700 dark:text-gray-300 font-medium">{{ Math.round(terrainData.minHeight) }}m</div>
      </div>
      <div class="text-center border-r border-gray-200 dark:border-gray-600">
        <div class="text-gray-400 dark:text-gray-500">{{ t('terrainStats.max') }}</div>
        <div class="text-gray-700 dark:text-gray-300 font-medium">{{ Math.round(terrainData.maxHeight) }}m</div>
      </div>
      <div class="text-center">
        <div class="text-gray-400 dark:text-gray-500">{{ t('terrainStats.diff') }}</div>
        <div class="text-brand font-bold">{{ Math.round(terrainData.maxHeight - terrainData.minHeight) }}m</div>
      </div>
    </div>
    <div class="grid grid-cols-2 gap-1 text-micro text-gray-500 dark:text-gray-400">
      <div class="text-center border-r border-gray-200 dark:border-gray-600">
        <div class="text-gray-400 dark:text-gray-500">{{ t('terrainStats.scale') }}</div>
        <div class="text-gray-700 dark:text-gray-300 font-medium">{{ metersPerPixel.toFixed(2) }}m/px</div>
      </div>
      <div class="text-center">
        <div class="text-gray-400 dark:text-gray-500">{{ t('terrainStats.totalArea') }}</div>
        <div class="text-gray-700 dark:text-gray-300 font-medium">{{ areaDisplay }}</div>
      </div>
    </div>
  </BaseCard>
</template>

<script setup>
import { useI18n } from 'vue-i18n';
import BaseCard from '../base/BaseCard.vue';

const { t } = useI18n({ useScope: 'global' });

defineProps({
  terrainData: { type: Object, default: null },
  metersPerPixel: { type: Number, default: 1 },
  areaDisplay: { type: String, default: '' },
});
</script>
