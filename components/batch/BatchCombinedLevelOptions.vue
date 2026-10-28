<template>
  <div class="space-y-3">
    <label class="text-sm font-medium text-gray-700 dark:text-gray-300 flex items-center gap-2">
      <PackageOpen :size="16" class="text-gray-700 dark:text-gray-300" />
      {{ t('batchCombined.title') }}
    </label>

    <BaseCard padded class="space-y-2 bg-gray-50 dark:bg-gray-700 border-gray-200 dark:border-gray-600">
      <!-- Level name -->
      <div class="flex items-center justify-between gap-2">
        <span class="text-[11px] text-gray-600 dark:text-gray-400 shrink-0">{{ t('exportPanel.levelName') }}</span>
        <input
          :value="model.levelName"
          @input="update('levelName', $event.target.value)"
          type="text"
          maxlength="64"
          :placeholder="t('exportPanel.levelNamePlaceholder')"
          class="min-w-0 flex-1 text-[11px] bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded px-1.5 py-0.5 text-gray-700 dark:text-gray-300"
        />
      </div>

      <!-- Base texture -->
      <div class="flex items-center justify-between gap-2">
        <span class="text-[11px] text-gray-600 dark:text-gray-400 shrink-0">{{ t('exportPanel.baseTexture') }}</span>
        <select :value="model.baseTexture" @change="update('baseTexture', $event.target.value)" :class="SELECT_XS">
          <option value="none">{{ t('exportPanel.none') }}</option>
          <option value="hybrid">{{ t('exportPanel.satelliteHybrid') }}</option>
          <option value="satellite">{{ t('exportPanel.satellite') }}</option>
          <option v-if="includeOSM" value="osm">{{ t('exportPanel.osm') }}</option>
          <option v-if="includeOSM" value="game">{{ t('exportPanel.gameTexture') }}</option>
        </select>
      </div>

      <!-- PBR materials -->
      <div class="flex items-center justify-between gap-2">
        <span class="text-[11px] text-gray-600 dark:text-gray-400 shrink-0">{{ t('exportPanel.pbrMaterials') }}</span>
        <select :value="model.pbrSource" @change="update('pbrSource', $event.target.value)" :disabled="!includeOSM" :class="SELECT_XS">
          <option value="none">{{ t('exportPanel.off') }}</option>
          <option v-if="includeOSM" value="osm">{{ t('exportPanel.osmData') }}</option>
        </select>
      </div>

      <!-- Roads -->
      <div class="flex items-center justify-between gap-2">
        <span class="text-[11px] text-gray-600 dark:text-gray-400 shrink-0">{{ t('exportPanel.roads') }}</span>
        <select :value="model.roadType" @change="update('roadType', $event.target.value)" :disabled="!includeOSM" :class="SELECT_XS">
          <option v-if="includeOSM" value="decal">{{ t('exportPanel.roadTypeSpline') }}</option>
          <option value="none">{{ t('exportPanel.roadTypeNone') }}</option>
        </select>
      </div>


      <!-- Backdrop -->
      <div class="flex items-center justify-between gap-2">
        <span class="text-[11px] text-gray-600 dark:text-gray-400 shrink-0">{{ t('exportPanel.includeBackdrop') }}</span>
        <select :value="model.backdropSource" @change="update('backdropSource', $event.target.value)" :class="SELECT_XS">
          <option value="off">Off</option>
          <option value="global30m">30m Global</option>
          <option value="usgs1m">USGS 1m</option>
          <option value="gpxz">GPXZ</option>
        </select>
      </div>

      <!-- Feature toggles -->
      <label class="flex items-center justify-between gap-2 cursor-pointer" :class="{ 'opacity-50': !includeOSM }">
        <span class="text-[11px] text-gray-600 dark:text-gray-400">{{ t('exportPanel.includeBuildings') }}</span>
        <input type="checkbox" :class="CHECKBOX" :checked="model.includeBuildings" :disabled="!includeOSM" @change="update('includeBuildings', $event.target.checked)" />
      </label>
      <label class="flex items-center justify-between gap-2 cursor-pointer" :class="{ 'opacity-50': !includeOSM }">
        <span class="text-[11px] text-gray-600 dark:text-gray-400">{{ t('exportPanel.applyFoundations') }}</span>
        <input type="checkbox" :class="CHECKBOX" :checked="model.applyFoundations" :disabled="!includeOSM" @change="update('applyFoundations', $event.target.checked)" />
      </label>
      <label class="flex items-center justify-between gap-2 cursor-pointer" :class="{ 'opacity-50': !includeOSM }">
        <span class="text-[11px] text-gray-600 dark:text-gray-400">{{ t('exportPanel.treesBushes') }}</span>
        <input type="checkbox" :class="CHECKBOX" :checked="model.includeTrees" :disabled="!includeOSM" @change="update('includeTrees', $event.target.checked)" />
      </label>
      <label class="flex items-center justify-between gap-2 cursor-pointer" :class="{ 'opacity-50': !includeOSM }">
        <span class="text-[11px] text-gray-600 dark:text-gray-400">{{ t('exportPanel.rocks') }}</span>
        <input type="checkbox" :class="CHECKBOX" :checked="model.includeRocks" :disabled="!includeOSM" @change="update('includeRocks', $event.target.checked)" />
      </label>
      <label class="flex items-center justify-between gap-2 cursor-pointer" :class="{ 'opacity-50': !includeOSM }">
        <span class="text-[11px] text-gray-600 dark:text-gray-400">{{ t('exportPanel.water') }}</span>
        <input type="checkbox" :class="CHECKBOX" :checked="model.includeWater" :disabled="!includeOSM" @change="update('includeWater', $event.target.checked)" />
      </label>

      <div class="flex items-center justify-between gap-2">
        <span class="text-[11px] text-gray-600 dark:text-gray-400 shrink-0">{{ t('exportPanel.seaLevelOffset') }}</span>
        <div class="flex items-center gap-1">
          <input
            :value="model.seaLevelOffset"
            @input="update('seaLevelOffset', $event.target.value)"
            type="number"
            step="1"
            min="-2000"
            max="2000"
            class="w-20 text-[11px] bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded px-1.5 py-0.5 text-gray-700 dark:text-gray-300"
          />
          <span class="text-[10px] text-gray-500 dark:text-gray-400">m</span>
        </div>
      </div>
    </BaseCard>
  </div>
</template>

<script setup>
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import BaseCard from '../base/BaseCard.vue';
import { CHECKBOX, SELECT_XS } from '../base/controlStyles.js';
import { PackageOpen } from 'lucide-vue-next';

const { t } = useI18n({ useScope: 'global' });

const props = defineProps({
  levelOptions: { type: Object, required: true },
  includeOSM: { type: Boolean, default: true },
});

const emit = defineEmits(['update:levelOptions']);

const model = computed(() => props.levelOptions);

const update = (key, value) => {
  let next = value;
  if (key === 'seaLevelOffset') {
    const num = Number(value);
    next = Number.isFinite(num) ? num : 0;
  }
  emit('update:levelOptions', { ...props.levelOptions, [key]: next });
};
</script>
