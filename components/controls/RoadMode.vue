<template>
  <!-- Road mode (refs/output/road-mode-plan.md): a picked road, a stretch of it between two handles, widened either side -->
  <div class="space-y-2" data-testid="road-mode">
    <p v-if="!store.road" class="text-micro text-gray-600 dark:text-gray-300" data-testid="road-hint" aria-live="polite">
      <MousePointerClick :size="12" class="inline -mt-0.5 mr-0.5" />{{ busy ? t('road.reading') : t('road.clickHint') }}
    </p>
    <template v-else>
      <p class="text-xs font-medium text-gray-700 dark:text-gray-300" data-testid="road-name">{{ roadName }}</p>
      <p class="text-micro text-gray-500 dark:text-gray-400">{{ t('road.handlesHint') }}</p>
      <p v-if="busy" class="text-micro text-gray-500 dark:text-gray-400" data-testid="road-busy" aria-live="polite">{{ t('road.routing') }}</p>
    </template>
    <p v-if="error" class="flex items-start gap-1.5 text-micro leading-snug text-amber-700 dark:text-amber-300" data-testid="road-error" role="alert">
      <AlertTriangle :size="11" class="shrink-0 mt-px" /><span>{{ t(`road.error_${error}`) }}</span>
    </p>

    <label class="block text-xs text-gray-700 dark:text-gray-300">
      <span class="flex justify-between"><span>{{ t('road.width') }}</span><span class="text-gray-500 dark:text-gray-400" data-testid="road-width-value">{{ t('road.widthValue', { m: widthShown }) }}</span></span>
      <!-- (the number follows the slider at once; the corridor is worked out again when it rests) -->
      <input type="range" class="w-full accent-[var(--brand)]" :min="CORRIDOR_MIN_M" :max="CORRIDOR_MAX_M" step="25" :value="widthShown" :disabled="disabled" data-testid="road-width"
        :aria-label="t('road.width')" @input="slideWidth(Number($event.target.value))" @change="commitWidth(Number($event.target.value))" />
    </label>

    <template v-if="grid">
      <p class="text-micro text-gray-600 dark:text-gray-300" data-testid="road-grid">{{ t('road.gridLine', { km: (stretchM / 1000).toFixed(2), w: grid.width, h: grid.height, area: areaKm }) }}</p>
      <p class="flex items-start gap-1.5 text-micro leading-snug text-amber-700 dark:text-amber-300"><AlertTriangle :size="11" class="shrink-0 mt-px" /><span>{{ t('tiles.models') }}</span></p>
      <!-- (past one grid's square: built in chunks, refs/output/chunked-pipeline-plan.md) -->
      <p v-if="grid.chunked" class="flex items-start gap-1.5 text-micro leading-snug text-gray-600 dark:text-gray-300" data-testid="road-chunked">
        <Layers :size="11" class="shrink-0 mt-px" /><span>{{ t('road.chunked') }}</span>
      </p>
      <!-- (the website's cap is the corridor's own area; the desktop app only warns) -->
      <p v-if="!grid.webOk" class="flex items-start gap-1.5 text-micro leading-snug" :class="isDesktop ? 'text-amber-700 dark:text-amber-300' : 'font-medium text-red-600 dark:text-red-400'" data-testid="road-web-cap">
        <AlertTriangle :size="11" class="shrink-0 mt-px" /><span>{{ t(isDesktop ? 'road.bigDesktop' : 'road.webCap', capArgs) }}</span>
      </p>
    </template>
    <BaseButton v-if="store.road" size="sm" variant="secondary" data-testid="road-clear" :disabled="disabled || busy" @click="clearRoad">{{ t('road.clear') }}</BaseButton>
  </div>
</template>

<script setup>
import { computed, ref, watch, onUnmounted } from 'vue';
import { useI18n } from 'vue-i18n';
import { AlertTriangle, Layers, MousePointerClick } from 'lucide-vue-next';
import BaseButton from '../base/BaseButton.vue';
import { useMainStore } from '../../stores/mainStore';
import { useRoadMode } from '../../composables/useRoadMode.js';
import { CORRIDOR_MIN_M, CORRIDOR_MAX_M } from '../../services/roadCorridor.js';
import { WEB_MAX_SIDE } from '../../services/tileLayout.js';
import { desktopApp } from '../../services/platform/desktop.js';

const props = defineProps({
  metersPerPixel: { type: [Number, String], default: 1 },
  disabled: { type: Boolean, default: false },
});
const { t } = useI18n();
const store = useMainStore();
const isDesktop = !!desktopApp;
const { stretchM, grid, busy, error, clearRoad } = useRoadMode(() => props.metersPerPixel);
// the width as the slider shows it; the store (and with it the corridor on the map) follows 120 ms after it rests
const widthShown = ref(store.roadHalfWidthM);
watch(() => store.roadHalfWidthM, (v) => { widthShown.value = v; });
let widthTimer = null;
const slideWidth = (v) => { widthShown.value = v; clearTimeout(widthTimer); widthTimer = setTimeout(() => store.setRoadHalfWidthM(v), 120); };
const commitWidth = (v) => { clearTimeout(widthTimer); widthShown.value = v; store.setRoadHalfWidthM(v); };
onUnmounted(() => clearTimeout(widthTimer));
const roadName = computed(() => {
  const r = store.road; if (!r) return '';
  const label = [...(r.refs || []), ...(r.names || [])].filter(Boolean).slice(0, 3).join(' · ');
  return label || t('road.unnamed');
});
const capArgs = computed(() => {
  const m = Number(props.metersPerPixel) > 0 ? Number(props.metersPerPixel) : 1;
  return { km2: Math.round((grid.value?.areaPx || 0) * m * m / 1e6), maxKm2: Math.round(WEB_MAX_SIDE * WEB_MAX_SIDE * m * m / 1e6) };
});
const areaKm = computed(() => {
  const g = grid.value; if (!g) return '0';
  const m = Number(props.metersPerPixel) > 0 ? Number(props.metersPerPixel) : 1;
  return (g.areaPx * m * m / 1e6).toFixed(2);
});
</script>
