<template>
  <!-- Spawn and quicktravel points (Location step): where the car starts and the places the big
       map's Quicktravel list jumps to. The map side: components/map/spawnPointLayer.js. -->
  <SettingSection id="mapng-sec-points" :title="t('spawnPoints.title')" :icon="Navigation" storage-key="mapng_ui_sec_points">
    <template #aside>{{ asideText }}</template>
    <p class="text-caption leading-snug text-gray-500 dark:text-gray-400">{{ t('spawnPoints.intro') }}</p>

    <button
      type="button"
      data-testid="point-tool"
      :class="[TOOL, store.pointTool ? TOOL_ON : TOOL_OFF]"
      :aria-pressed="store.pointTool"
      :disabled="editor.full() && !store.pointTool"
      @click="editor.setTool(!store.pointTool)"
    >
      <span class="flex items-center gap-2"><MapPinPlus :size="14" />{{ t('spawnPoints.place') }}</span>
      <kbd class="font-mono text-nano opacity-60">P</kbd>
    </button>
    <p v-if="store.pointTool" class="text-caption leading-snug text-gray-600 dark:text-gray-300">{{ t('spawnPoints.placeHint') }}</p>

    <p v-if="!rows.length" class="flex items-start gap-1.5 rounded border border-dashed border-gray-300 dark:border-gray-600 px-2.5 py-2 text-caption leading-snug text-gray-500 dark:text-gray-400">
      <Car :size="12" class="shrink-0 mt-0.5" />
      <span>{{ t('spawnPoints.empty') }}</span>
    </p>

    <ul v-else class="flex flex-col gap-1" data-testid="point-list">
      <li
        v-for="row in rows"
        :key="row.p.id"
        class="rounded-lg border px-1.5 py-1 transition-colors"
        :class="[
          row.p.id === store.selectedPointId ? 'border-brand bg-brand-50/60 dark:bg-brand-900/20' : 'border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800',
          row.outside ? 'border-dashed' : '',
        ]"
        @click="store.selectedPointId = row.p.id"
      >
        <div class="flex items-center gap-1">
          <button
            type="button"
            class="shrink-0 p-1 rounded hover:bg-gray-200 dark:hover:bg-gray-700"
            :class="row.p.isDefault ? 'text-amber-500' : 'text-gray-400 hover:text-amber-500'"
            :title="row.p.isDefault ? t('spawnPoints.unsetDefault') : t('spawnPoints.setDefault')"
            :aria-pressed="row.p.isDefault"
            :aria-label="t('spawnPoints.setDefault')"
            @click.stop="editor.toggleDefault(row.p.id)"
          ><Star :size="14" :fill="row.p.isDefault ? 'currentColor' : 'none'" /></button>
          <input
            type="text"
            :value="row.p.name"
            :placeholder="row.placeholder"
            :maxlength="POINT_NAME_MAX"
            class="min-w-0 flex-1 bg-transparent px-1 py-0.5 rounded text-sm text-gray-800 dark:text-gray-100 border border-transparent hover:border-gray-300 dark:hover:border-gray-600 focus:border-brand focus:outline-none"
            :aria-label="t('spawnPoints.name')"
            @focus="store.selectedPointId = row.p.id"
            @change="editor.updatePoint(row.p.id, { name: $event.target.value })"
            @keydown.enter="$event.target.blur()"
          />
          <label class="shrink-0 flex items-center gap-0.5 text-micro text-gray-500 dark:text-gray-400" :title="t('spawnPoints.heading')">
            <Compass :size="11" />
            <input
              type="number" min="0" max="359" step="5"
              :value="Math.round(row.p.heading)"
              class="w-11 bg-transparent px-0.5 py-0.5 rounded font-mono text-micro text-right text-gray-700 dark:text-gray-200 border border-transparent hover:border-gray-300 dark:hover:border-gray-600 focus:border-brand focus:outline-none"
              :aria-label="t('spawnPoints.heading')"
              @change="editor.updatePoint(row.p.id, { heading: Number($event.target.value) || 0 })"
            />°
          </label>
          <button
            type="button"
            class="shrink-0 p-1 rounded text-gray-400 hover:text-red-600 hover:bg-gray-200 dark:hover:bg-gray-700"
            :title="t('spawnPoints.remove')"
            :aria-label="t('spawnPoints.remove')"
            @click.stop="editor.removePoint(row.p.id)"
          ><Trash2 :size="13" /></button>
        </div>
        <p v-if="row.outside" class="flex items-center gap-1 pl-7 text-micro text-red-600 dark:text-red-400">
          <AlertTriangle :size="10" class="shrink-0" />{{ t('spawnPoints.outside') }}
        </p>
        <p v-else-if="row.p.isDefault" class="pl-7 text-micro text-amber-700 dark:text-amber-400">{{ t('spawnPoints.spawnTag') }}</p>
      </li>
    </ul>

    <div v-if="rows.length" class="flex items-center justify-between gap-2">
      <span class="text-micro text-gray-500 dark:text-gray-400">{{ t('spawnPoints.count', { n: rows.length, max: MAX_POINTS }) }}</span>
      <button type="button" class="text-caption text-gray-500 hover:text-red-600 dark:text-gray-400 flex items-center gap-1" @click="editor.clearPoints()">
        <Trash2 :size="12" />{{ t('spawnPoints.clear') }}
      </button>
    </div>
    <p v-if="rows.length && !hasDefault" class="text-micro leading-snug text-gray-500 dark:text-gray-400">{{ t('spawnPoints.noDefault') }}</p>
    <p v-if="rows.length" class="text-micro leading-snug text-gray-500 dark:text-gray-400">{{ t('spawnPoints.snapNote') }}</p>
  </SettingSection>
</template>

<script setup>
import { computed, onMounted, onBeforeUnmount } from 'vue';
import { useI18n } from 'vue-i18n';
import { Navigation, MapPinPlus, Star, Trash2, Compass, AlertTriangle, Car } from 'lucide-vue-next';
import SettingSection from '../base/SettingSection.vue';
import { useMainStore } from '../../stores/mainStore';
import { usePointsEditor } from '../../composables/usePointsEditor.js';
import { computeMetricSelectionBounds } from '../../services/uploadBounds';
import { MAX_POINTS, POINT_NAME_MAX, pointInBounds } from '../../services/spawnPoints.js';

const props = defineProps({
  center: { type: Object, required: true },
  resolution: { type: [Number, String], required: true },
  metersPerPixel: { type: [Number, String], default: 1 },
});

const { t } = useI18n();
const store = useMainStore();
const editor = usePointsEditor();

const TOOL = 'w-full flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-lg border text-sm font-medium transition-colors disabled:opacity-40 disabled:cursor-default';
const TOOL_OFF = 'border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 text-gray-700 dark:text-gray-200 hover:border-brand';
const TOOL_ON = 'border-brand bg-brand text-white';

// (the box as the sidebar knows it; the map checks its own live box)
const box = computed(() => computeMetricSelectionBounds(props.center, (Number(props.resolution) || 0) * (Number(props.metersPerPixel) || 1)));
const rows = computed(() => store.points.map((p, i) => ({
  p,
  outside: !!box.value && !pointInBounds(p, box.value),
  placeholder: t('spawnPoints.pointN', { n: i + 1 }),
})));
const hasDefault = computed(() => store.points.some((p) => p.isDefault));
const asideText = computed(() => (rows.value.length ? t('spawnPoints.aside', { n: rows.value.length }) : t('spawnPoints.asideAuto')));

// P places points, Escape stops, Delete removes the selected one (not while typing)
function onKey(e) {
  if (e.ctrlKey || e.metaKey || e.altKey || /input|textarea|select/i.test(e.target?.tagName || '') || e.target?.isContentEditable) return;
  if (store.batchMode) return;
  if (e.key === 'p' || e.key === 'P') { editor.setTool(!store.pointTool); e.preventDefault(); return; }
  if (e.key === 'Escape' && store.pointTool) { editor.setTool(false); return; }
  if ((e.key === 'Delete' || e.key === 'Backspace') && store.selectedPointId) { editor.removePoint(store.selectedPointId); e.preventDefault(); }
}
onMounted(() => window.addEventListener('keydown', onKey));
onBeforeUnmount(() => { window.removeEventListener('keydown', onKey); editor.setTool(false); });
</script>
