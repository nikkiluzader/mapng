<template>
  <!-- Tiles in step 1 (refs/output/tiles-plan.md): one tile is today's square; more make one map of any shape -->
  <div class="space-y-2" data-testid="tile-layout">
    <div class="flex items-center gap-2">
      <span class="text-xs font-medium text-gray-700 dark:text-gray-300">{{ t('tiles.title') }}</span>
      <span class="text-micro text-gray-500 dark:text-gray-400" data-testid="tile-count">{{ t('tiles.count', { n: store.tiles.length }, store.tiles.length) }}</span>
      <BaseButton size="sm" variant="secondary" class="ml-auto" data-testid="tile-add" :disabled="disabled" @click="addTile">
        <Plus :size="12" class="mr-0.5" />{{ t('tiles.add') }}
      </BaseButton>
    </div>
    <p v-if="!multi" class="text-micro text-gray-500 dark:text-gray-400">{{ t('tiles.oneHint') }}</p>

    <template v-if="multi">
      <div class="grid grid-cols-2 gap-1.5" role="radiogroup" :aria-label="t('tiles.arrange')">
        <button v-for="opt in ['together', 'free']" :key="opt" type="button" role="radio" :aria-checked="(opt === 'together') === store.tilesTogether"
          :data-testid="`tiles-${opt}`" :disabled="disabled"
          :class="['rounded border px-2 py-1.5 text-xs font-medium transition-colors', (opt === 'together') === store.tilesTogether ? 'border-brand bg-brand-50/60 dark:bg-brand/10 text-brand' : 'border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-300']"
          @click="store.setTilesTogether(opt === 'together')">{{ t(`tiles.${opt}`) }}</button>
      </div>
      <p class="text-micro text-gray-500 dark:text-gray-400">{{ t(store.tilesTogether ? 'tiles.togetherHint' : 'tiles.freeHint') }}</p>
      <label v-if="!store.tilesTogether" class="flex items-center justify-between text-xs text-gray-700 dark:text-gray-300">
        <span>{{ t('tiles.snap') }}</span>
        <BaseSwitch :on="store.tilesSnap" :label="t('tiles.snap')" data-testid="tiles-snap" :disabled="disabled" @toggle="store.setTilesSnap(!store.tilesSnap)" />
      </label>

      <ul class="flex flex-wrap gap-1" :aria-label="t('tiles.list')">
        <li v-for="(tile, i) in store.tiles" :key="i" class="flex items-center gap-1 rounded border border-gray-200 dark:border-gray-600 px-1.5 py-0.5 text-micro text-gray-600 dark:text-gray-300">
          {{ t('tiles.tile', { n: i + 1 }) }}
          <button v-if="i > 0" type="button" class="text-gray-400 hover:text-red-500" :title="t('tiles.remove', { n: i + 1 })" :aria-label="t('tiles.remove', { n: i + 1 })" :data-testid="`tile-remove-${i}`" :disabled="disabled" @click="removeTile(i)"><X :size="11" /></button>
        </li>
      </ul>

      <p class="text-micro text-gray-600 dark:text-gray-300" data-testid="tile-grid">{{ t('tiles.gridLine', { w: grid.width, h: grid.height, km: areaKm }) }}</p>
      <p v-if="grid.terrainBlock" class="text-micro text-emerald-700 dark:text-emerald-300" data-testid="tile-terrain">{{ t('tiles.terrain') }}</p>
      <p v-else class="flex items-start gap-1.5 text-micro leading-snug text-amber-700 dark:text-amber-300" data-testid="tile-models">
        <AlertTriangle :size="11" class="shrink-0 mt-px" /><span>{{ t('tiles.models') }}</span>
      </p>
      <p v-if="grid.islands" class="text-micro text-gray-500 dark:text-gray-400">{{ t('tiles.islands') }}</p>
      <!-- (past one grid's square: built in chunks, refs/output/chunked-pipeline-plan.md) -->
      <p v-if="grid.chunked" class="flex items-start gap-1.5 text-micro leading-snug text-gray-600 dark:text-gray-300" data-testid="tile-chunked">
        <Layers :size="11" class="shrink-0 mt-px" /><span>{{ t('tiles.chunked') }}</span>
      </p>
      <!-- (the website's cap is the footprint's own area; the desktop app only warns) -->
      <p v-if="!grid.webOk" class="flex items-start gap-1.5 text-micro leading-snug" :class="isDesktop ? 'text-amber-700 dark:text-amber-300' : 'font-medium text-red-600 dark:text-red-400'" data-testid="tile-web-cap">
        <AlertTriangle :size="11" class="shrink-0 mt-px" /><span>{{ t(isDesktop ? 'tiles.bigDesktop' : 'tiles.webCap', capArgs) }}</span>
      </p>
      <BaseButton size="sm" variant="secondary" data-testid="tile-clear" :disabled="disabled" @click="clearTiles">{{ t('tiles.clear') }}</BaseButton>
    </template>
  </div>
</template>

<script setup>
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { Plus, X, AlertTriangle, Layers } from 'lucide-vue-next';
import BaseButton from '../base/BaseButton.vue';
import BaseSwitch from '../base/BaseSwitch.vue';
import { useMainStore } from '../../stores/mainStore';
import { useTiles } from '../../composables/useTiles.js';
import { WEB_MAX_SIDE } from '../../services/tileLayout.js';
import { desktopApp } from '../../services/platform/desktop.js';

const props = defineProps({
  resolution: { type: [Number, String], default: 1024 },
  metersPerPixel: { type: [Number, String], default: 1 },
  disabled: { type: Boolean, default: false },
});
const { t } = useI18n();
const store = useMainStore();
const isDesktop = !!desktopApp;
const { multi, grid, addTile, removeTile, clearTiles } = useTiles(() => props.resolution, () => props.metersPerPixel);
const capArgs = computed(() => {
  const m = Number(props.metersPerPixel) > 0 ? Number(props.metersPerPixel) : 1;
  return { km2: Math.round((grid.value?.areaPx || 0) * m * m / 1e6), maxKm2: Math.round(WEB_MAX_SIDE * WEB_MAX_SIDE * m * m / 1e6) };
});
const areaKm = computed(() => {
  const m = Number(props.metersPerPixel) > 0 ? Number(props.metersPerPixel) : 1;
  return (grid.value.areaPx * m * m / 1e6).toFixed(2);
});
</script>
