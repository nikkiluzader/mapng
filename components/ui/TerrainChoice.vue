<template>
  <!-- The Terrain choice (composables/useTerrainMode.js): how much MapNG
       touches the elevation. One place for what used to be "Raw terrain"
       here and "Terrain edits" in the export panel. -->
  <div class="space-y-1.5" role="radiogroup" :aria-label="t('terrainChoice.title')">
    <div class="flex items-baseline justify-between gap-2">
      <span class="text-xs font-semibold text-gray-700 dark:text-gray-200">{{ t('terrainChoice.title') }}</span>
      <span class="text-micro text-gray-400 dark:text-gray-500">{{ t('terrainChoice.subtitle') }}</span>
    </div>
    <label
      v-for="option in options"
      :key="option.value"
      class="flex items-start gap-2.5 rounded-lg border px-3 py-2 cursor-pointer transition-colors"
      :class="terrainMode === option.value
        ? 'border-brand bg-brand-50/60 dark:bg-brand/10'
        : 'border-gray-200 dark:border-gray-600 hover:border-gray-300 dark:hover:border-gray-500'"
    >
      <input
        type="radio"
        name="mapng-terrain-mode"
        class="mt-0.5 accent-brand"
        :value="option.value"
        :checked="terrainMode === option.value"
        @change="setTerrainMode(option.value)"
      />
      <span class="min-w-0">
        <span class="block text-xs font-medium text-gray-800 dark:text-gray-100">
          {{ option.label }}
          <span v-if="option.value === 'ready'" class="ml-1 text-micro font-semibold text-brand">{{ t('terrainChoice.recommended') }}</span>
        </span>
        <span class="block text-caption leading-snug text-gray-500 dark:text-gray-400">{{ option.hint }}</span>
      </span>
    </label>

    <!-- Custom: the export's edits, one by one (the generation passes stay on) -->
    <div v-if="terrainMode === 'custom'" class="pl-2 space-y-0.5">
      <SettingRow check indent v-model="terrainEdits.shapeRoads.value" :label="t('exportPanel.shapeRoads')" :hint="t('exportPanel.shapeRoadsHint')" />
      <SettingRow check indent v-model="terrainEdits.shapeBridges.value" :label="t('exportPanel.shapeBridges')" :hint="t('exportPanel.shapeBridgesHint')" />
      <SettingRow check indent v-model="terrainEdits.shapeOverpasses.value" :label="t('exportPanel.shapeOverpasses')" :hint="t('exportPanel.shapeOverpassesHint')" />
      <SettingRow check indent v-model="terrainEdits.shapeTunnels.value" :label="t('exportPanel.shapeTunnels')" :hint="t('exportPanel.shapeTunnelsHint')" />
      <SettingRow check indent v-model="terrainEdits.shapeExtras.value" :label="t('exportPanel.shapeExtras')" :hint="t('exportPanel.shapeExtrasHint')" />
      <SettingRow check indent v-model="terrainEdits.shapeDetail.value" :label="t('exportPanel.shapeDetail')" :hint="t('exportPanel.shapeDetailHint')" />
    </div>

    <!-- Untouched on 30 m data: say what that costs -->
    <p v-if="terrainMode === 'untouched' && coarse" class="flex items-start gap-1.5 text-caption leading-snug text-amber-700 dark:text-amber-300">
      <AlertTriangle :size="12" class="shrink-0 mt-px" />{{ t('terrainChoice.untouchedWarn') }}
    </p>
  </div>
</template>

<script setup>
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { AlertTriangle } from 'lucide-vue-next';
import SettingRow from '../base/SettingRow.vue';
import { terrainMode, terrainEdits, setTerrainMode } from '../../composables/useTerrainMode.js';

const props = defineProps({
  // the elevation source picked: 'mapterhorn' (Best free), 'default' (global 30 m), 'gpxz', 'usgs', 'kron86', 'none'
  elevationSource: { type: String, default: 'mapterhorn' },
  // a file of the user's own is the elevation
  upload: { type: Boolean, default: false },
});

const { t } = useI18n({ useScope: 'global' });
// (the global 30 m could be what the level is built from: Best free where there is no lidar)
const coarse = computed(() => !props.upload && ['mapterhorn', 'default'].includes(String(props.elevationSource || 'mapterhorn')));
const options = computed(() => [
  { value: 'ready', label: t('terrainChoice.ready'), hint: t(coarse.value ? 'terrainChoice.readyHint30' : 'terrainChoice.readyHintFine') },
  { value: 'custom', label: t('terrainChoice.custom'), hint: t('terrainChoice.customHint') },
  { value: 'untouched', label: t('terrainChoice.untouched'), hint: t('terrainChoice.untouchedHint') },
]);
</script>
