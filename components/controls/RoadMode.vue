<template>
  <!-- Road mode (refs/output/road-mode-plan.md): a picked road, a stretch of it between two handles, widened either side -->
  <div class="space-y-2" data-testid="road-mode">
    <p v-if="!store.road" class="text-micro text-gray-600 dark:text-gray-300" data-testid="road-hint">
      <MousePointerClick :size="12" class="inline -mt-0.5 mr-0.5" />{{ busy ? t('road.reading') : t('road.clickHint') }}
    </p>
    <template v-else>
      <p class="text-xs font-medium text-gray-700 dark:text-gray-300" data-testid="road-name">{{ roadName }}</p>
      <p class="text-micro text-gray-500 dark:text-gray-400">{{ t('road.handlesHint') }}</p>
      <div class="flex gap-1.5">
        <BaseButton size="sm" variant="secondary" data-testid="road-extend-start" :disabled="busy || disabled" @click="extend('start')">{{ t('road.extendStart') }}</BaseButton>
        <BaseButton size="sm" variant="secondary" data-testid="road-extend-end" :disabled="busy || disabled" @click="extend('end')">{{ t('road.extendEnd') }}</BaseButton>
      </div>
    </template>
    <p v-if="error" class="flex items-start gap-1.5 text-micro leading-snug text-amber-700 dark:text-amber-300" data-testid="road-error">
      <AlertTriangle :size="11" class="shrink-0 mt-px" /><span>{{ t(`road.error_${error}`) }}</span>
    </p>

    <label class="block text-xs text-gray-700 dark:text-gray-300">
      <span class="flex justify-between"><span>{{ t('road.width') }}</span><span class="text-gray-500 dark:text-gray-400" data-testid="road-width-value">{{ t('road.widthValue', { m: store.roadHalfWidthM }) }}</span></span>
      <input type="range" class="w-full accent-[var(--brand)]" :min="CORRIDOR_MIN_M" :max="CORRIDOR_MAX_M" step="25" :value="store.roadHalfWidthM" :disabled="disabled" data-testid="road-width"
        :aria-label="t('road.width')" @input="store.setRoadHalfWidthM(Number($event.target.value))" />
    </label>

    <template v-if="grid">
      <p class="text-micro text-gray-600 dark:text-gray-300" data-testid="road-grid">{{ t('road.gridLine', { km: (stretchM / 1000).toFixed(2), w: grid.width, h: grid.height, area: areaKm }) }}</p>
      <p class="flex items-start gap-1.5 text-micro leading-snug text-amber-700 dark:text-amber-300"><AlertTriangle :size="11" class="shrink-0 mt-px" /><span>{{ t('tiles.models') }}</span></p>
      <p v-if="!grid.webOk && !isDesktop" class="flex items-start gap-1.5 text-micro font-medium leading-snug text-red-600 dark:text-red-400" data-testid="road-web-cap">
        <AlertTriangle :size="11" class="shrink-0 mt-px" /><span>{{ t('road.webCap', { max: 16384 }) }}</span>
      </p>
      <p v-else-if="!grid.webOk" class="flex items-start gap-1.5 text-micro leading-snug text-amber-700 dark:text-amber-300">
        <AlertTriangle :size="11" class="shrink-0 mt-px" /><span>{{ t('tiles.desktopWarn', { max: 16384 }) }}</span>
      </p>
    </template>
    <BaseButton v-if="store.road" size="sm" variant="secondary" data-testid="road-clear" :disabled="disabled" @click="clearRoad">{{ t('road.clear') }}</BaseButton>
  </div>
</template>

<script setup>
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { AlertTriangle, MousePointerClick } from 'lucide-vue-next';
import BaseButton from '../base/BaseButton.vue';
import { useMainStore } from '../../stores/mainStore';
import { useRoadMode } from '../../composables/useRoadMode.js';
import { CORRIDOR_MIN_M, CORRIDOR_MAX_M } from '../../services/roadCorridor.js';
import { desktopApp } from '../../services/platform/desktop.js';

const props = defineProps({
  metersPerPixel: { type: [Number, String], default: 1 },
  disabled: { type: Boolean, default: false },
});
const { t } = useI18n();
const store = useMainStore();
const isDesktop = !!desktopApp;
const { stretchM, grid, busy, error, extend, clearRoad } = useRoadMode(() => props.metersPerPixel);
const roadName = computed(() => {
  const r = store.road; if (!r) return '';
  const label = [...(r.refs || []), ...(r.names || [])].filter(Boolean).slice(0, 3).join(' · ');
  return label || t('road.unnamed');
});
const areaKm = computed(() => {
  const g = grid.value; if (!g) return '0';
  const m = Number(props.metersPerPixel) > 0 ? Number(props.metersPerPixel) : 1;
  return (g.areaPx * m * m / 1e6).toFixed(2);
});
</script>
