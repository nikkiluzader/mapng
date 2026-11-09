<template>
  <!-- Background areas (Location step, advanced): the tools for shading the parts of the
       square nobody drives. The map side: components/map/backgroundLayer.js. -->
  <SettingSection id="mapng-sec-background" :title="t('backgroundAreas.title')" :icon="Mountain" storage-key="mapng_ui_sec_background">
    <template #aside>{{ asideText }}</template>
    <p class="text-caption leading-snug text-gray-500 dark:text-gray-400">{{ t('backgroundAreas.intro') }}</p>

    <div class="flex flex-col gap-1.5">
      <button
        v-for="b in toolButtons"
        :key="b.id"
        type="button"
        :class="[TOOL, tool === b.id ? TOOL_ON : TOOL_OFF]"
        :aria-pressed="tool === b.id"
        @click="pick(b.id)"
      >
        <span class="flex items-center gap-2"><component :is="b.icon" :size="14" />{{ b.label }}</span>
        <kbd class="font-mono text-nano opacity-60">{{ b.key }}</kbd>
      </button>

      <div v-if="tool === 'unmask' || tool === 'raw'" class="flex flex-col gap-1.5 rounded-lg border border-gray-200 dark:border-gray-700 p-2">
        <div class="flex gap-1" role="group" :aria-label="t('backgroundAreas.shape')">
          <button
            v-for="s in shapeButtons" :key="s.id" type="button"
            :class="[SEG, unmaskShape === s.id ? TOOL_ON : TOOL_OFF]" :aria-pressed="unmaskShape === s.id"
            @click="setShape(s.id)"
          ><component :is="s.icon" :size="13" />{{ s.label }}</button>
        </div>
        <div v-if="tool === 'unmask'" class="flex gap-1" role="group" :aria-label="t('backgroundAreas.paintMode')">
          <button type="button" :class="[SEG, !paintBackground ? TOOL_ON : TOOL_OFF]" :aria-pressed="!paintBackground" @click="paintBackground = false">{{ t('backgroundAreas.modeKeep') }}</button>
          <button type="button" :class="[SEG, paintBackground ? TOOL_ON : TOOL_OFF]" :aria-pressed="paintBackground" @click="paintBackground = true">{{ t('backgroundAreas.modeBackground') }}</button>
        </div>
        <div v-else class="flex gap-1" role="group" :aria-label="t('backgroundAreas.paintMode')">
          <button type="button" :class="[SEG, !paintSmooth ? TOOL_ON : TOOL_OFF]" :aria-pressed="!paintSmooth" @click="paintSmooth = false">{{ t('backgroundAreas.modeRaw') }}</button>
          <button type="button" :class="[SEG, paintSmooth ? TOOL_ON : TOOL_OFF]" :aria-pressed="paintSmooth" @click="paintSmooth = true">{{ t('backgroundAreas.modeSmooth') }}</button>
        </div>
        <div v-if="unmaskShape === 'brush'" class="flex items-center justify-between gap-2 text-caption text-gray-600 dark:text-gray-300">
          <span>{{ t('backgroundAreas.brushSize') }}</span>
          <input
            type="range" min="10" max="1000" step="10" :value="brushM" class="flex-1 accent-brand"
            :aria-label="t('backgroundAreas.brushSize')" @input="setBrush($event.target.value)"
          />
          <span class="font-mono w-14 text-right">{{ brushM }} m</span>
        </div>
        <p class="text-micro text-gray-500 dark:text-gray-400">{{ t(tool === 'raw' ? 'backgroundAreas.rawShift' : 'backgroundAreas.unmaskShift') }}</p>
      </div>

      <div class="flex items-center justify-between gap-2 pl-1 text-caption text-gray-600 dark:text-gray-300">
        <span>{{ t('backgroundAreas.width') }}</span>
        <input
          type="range" min="100" max="1500" step="50"
          :value="mask.widthM || 300"
          class="flex-1 accent-brand"
          :aria-label="t('backgroundAreas.width')"
          @input="setWidth($event.target.value)"
        />
        <span class="font-mono w-14 text-right">{{ mask.widthM || 300 }} m</span>
      </div>
      <p v-if="tool === 'road' && roadStatus === 'loading'" class="text-micro text-gray-500 dark:text-gray-400 pl-1">{{ t('backgroundAreas.roadsLoading') }}</p>
      <p v-else-if="tool === 'road' && roadStatus === 'failed'" class="text-micro text-amber-600 dark:text-amber-400 pl-1">{{ t('backgroundAreas.roadsFailed') }}</p>
      <p v-else-if="tool === 'road' && roadStatus === 'ready' && !roadChoices.length" class="text-micro text-gray-500 dark:text-gray-400 pl-1">{{ t('backgroundAreas.roadsNone') }}</p>

      <div class="flex gap-1.5">
        <button type="button" :class="[TOOL, TOOL_OFF, 'flex-1 justify-center']" :disabled="!history.length" @click="undo">
          <span class="flex items-center gap-2"><Undo2 :size="14" />{{ t('backgroundAreas.undo') }}</span>
        </button>
        <button type="button" :class="[TOOL, TOOL_OFF, 'flex-1 justify-center']" :disabled="!store.backgroundDrawn" @click="clearAll">
          <span class="flex items-center gap-2"><Trash2 :size="14" />{{ t('backgroundAreas.clear') }}</span>
        </button>
      </div>
    </div>

    <p v-if="hint" class="text-caption leading-snug" :class="hintBad ? 'text-red-600 dark:text-red-400' : 'text-gray-600 dark:text-gray-300'">{{ hint }}</p>

    <div v-if="stats" class="rounded border border-gray-200 dark:border-gray-700 px-2.5 py-2 font-mono text-micro leading-relaxed text-gray-600 dark:text-gray-300">
      <div>{{ t('backgroundAreas.statShare', { bg: stats.bg, kept: stats.kept }) }}</div>
      <div>{{ t('backgroundAreas.statKm', { km: stats.km }) }}</div>
      <div v-if="stats.raw">{{ t('backgroundAreas.statRaw', { pct: stats.raw }) }}</div>
    </div>

    <p v-if="store.boxLocked" class="flex items-start gap-1.5 rounded border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/60 px-2.5 py-2 text-caption leading-snug text-gray-600 dark:text-gray-300">
      <Lock :size="12" class="shrink-0 mt-0.5 text-brand" />
      <span>{{ t('backgroundAreas.locked') }}</span>
    </p>

    <Teleport to="body">
      <div v-if="pendingLock" class="fixed inset-0 z-[10000] flex items-center justify-center p-4 bg-gray-900/20 dark:bg-black/40" @click.self="cancelLock">
        <div role="dialog" aria-modal="true" class="w-full max-w-sm rounded-2xl border border-gray-200 dark:border-white/10 bg-white dark:bg-gray-950 p-5 shadow-2xl">
          <h3 class="font-display text-base font-bold italic text-gray-900 dark:text-white mb-2">{{ t('backgroundAreas.lockTitle') }}</h3>
          <p class="text-sm text-gray-700 dark:text-gray-300 mb-2">{{ t('backgroundAreas.lockBody') }}</p>
          <ul class="list-disc pl-5 text-caption text-gray-500 dark:text-gray-400 space-y-0.5 mb-3">
            <li>{{ t('backgroundAreas.lockPoint1') }}</li>
            <li>{{ t('backgroundAreas.lockPoint2') }}</li>
            <li>{{ t('backgroundAreas.lockPoint3') }}</li>
          </ul>
          <label class="flex items-center gap-2 text-caption text-gray-500 dark:text-gray-400">
            <input v-model="dontAsk" type="checkbox" :class="CHECKBOX" />{{ t('backgroundAreas.lockDontAsk') }}
          </label>
          <div class="flex justify-end gap-2 mt-4">
            <button type="button" class="px-3 py-1.5 rounded-lg text-sm border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200 hover:border-brand" @click="cancelLock">{{ t('backgroundAreas.lockCancel') }}</button>
            <button type="button" class="px-3 py-1.5 rounded-lg text-sm bg-brand text-white hover:bg-brand-500" @click="confirmLock(dontAsk)">{{ t('backgroundAreas.lockOk') }}</button>
          </div>
        </div>
      </div>
    </Teleport>
  </SettingSection>
</template>

<script setup>
import { computed, ref, watch, onMounted, onBeforeUnmount } from 'vue';
import { useI18n } from 'vue-i18n';
import { Mountain, MountainSnow, Spline, PaintBucket, Eraser, Route, Undo2, Trash2, Lock, Hand, Paintbrush, Brush, Square, Lasso } from 'lucide-vue-next';
import SettingSection from '../base/SettingSection.vue';
import { CHECKBOX } from '../base/controlStyles.js';
import { useMainStore } from '../../stores/mainStore';
import { useBackgroundEditor } from '../../composables/useBackgroundEditor.js';
import { rasterizeMask, rasterizeRaw, backgroundFraction } from '../../services/backgroundMask.js';
import { computeMetricSelectionBounds } from '../../services/uploadBounds';
import { fetchOsmRoads } from '../../services/osm.js';

const props = defineProps({
  center: { type: Object, required: true },
  resolution: { type: [Number, String], required: true },
  metersPerPixel: { type: [Number, String], default: 1 },
});

const { t } = useI18n();
const store = useMainStore();
const { unmaskShape, brushM, paintBackground, paintSmooth, setShape, setBrush, mask, tool, history, pendingLock, roadChoices, roadStatus, hint, hintBad, edit, confirmLock, cancelLock, undo, clearAll, setHint } = useBackgroundEditor();
const dontAsk = ref(false);

const TOOL = 'flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-lg border text-sm font-medium transition-colors disabled:opacity-40 disabled:cursor-default';
const TOOL_OFF = 'border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 text-gray-700 dark:text-gray-200 hover:border-brand';
const TOOL_ON = 'border-brand bg-brand text-white';
const SEG = 'flex-1 flex items-center justify-center gap-1 px-1.5 py-1 rounded-md border text-caption font-medium transition-colors';
const shapeButtons = computed(() => [
  { id: 'brush', icon: Brush, label: t('backgroundAreas.shapeBrush') },
  { id: 'rect', icon: Square, label: t('backgroundAreas.shapeRect') },
  { id: 'lasso', icon: Lasso, label: t('backgroundAreas.shapeLasso') },
]);

const toolButtons = computed(() => [
  { id: 'pan', icon: Hand, label: t('backgroundAreas.toolPan'), key: 'H' },
  { id: 'line', icon: Spline, label: t('backgroundAreas.toolLine'), key: 'D' },
  { id: 'bucket', icon: PaintBucket, label: t('backgroundAreas.toolShade'), key: 'B' },
  { id: 'erase', icon: Eraser, label: t('backgroundAreas.toolErase'), key: 'E' },
  { id: 'road', icon: Route, label: t('backgroundAreas.toolRoad'), key: 'R' },
  { id: 'unmask', icon: Paintbrush, label: t('backgroundAreas.toolUnmask'), key: 'U' },
  { id: 'raw', icon: MountainSnow, label: t('backgroundAreas.toolRaw'), key: 'N' },
]);

const sizeMeters = computed(() => (Number(props.resolution) || 0) * (Number(props.metersPerPixel) || 1));
const selectionBounds = () => computeMetricSelectionBounds(props.center, sizeMeters.value);

const HINTS = { pan: '', line: 'hintLine', bucket: 'hintBucket', erase: 'hintErase', road: 'hintRoad', unmask: 'hintUnmask', raw: 'hintRaw' };
function pick(id) {
  tool.value = tool.value === id && id !== 'pan' ? 'pan' : id;
  setHint(HINTS[tool.value] ? t(`backgroundAreas.${HINTS[tool.value]}`) : '');
  if (tool.value === 'road') loadRoads();
}

let roadsKey = '';
let roadsAbort = null;
async function loadRoads() {
  const b = mask.value.bounds || selectionBounds();
  if (!b) return;
  const key = [b.north, b.south, b.east, b.west].map((v) => v.toFixed(6)).join(',');
  if (key === roadsKey && roadStatus.value !== 'failed') return;
  roadsKey = key;
  roadsAbort?.abort();
  roadsAbort = new AbortController();
  roadStatus.value = 'loading';
  try {
    roadChoices.value = await fetchOsmRoads(b, { signal: roadsAbort.signal });
    roadStatus.value = 'ready';
  } catch (e) {
    if (e?.name === 'AbortError') return;
    console.warn('[Background areas] roads:', e);
    roadStatus.value = 'failed';
  }
}
// (another box: the old roads no longer apply)
watch(() => store.boxLocked ? 'locked' : `${props.center.lat},${props.center.lng},${sizeMeters.value}`, () => {
  if (!store.boxLocked) { roadChoices.value = []; roadStatus.value = 'idle'; roadsKey = ''; }
});

function setWidth(v) {
  const widthM = Number(v) || 300;
  if (!mask.value.bounds) { store.setBackgroundMask({ ...mask.value, widthM }); return; }
  store.setBackgroundMask({ ...mask.value, widthM });
}

const stats = computed(() => {
  if (!store.backgroundDrawn) return null;
  const r = rasterizeMask(mask.value, 256, { metersAcross: sizeMeters.value });
  const f = backgroundFraction(r);
  const km2 = (sizeMeters.value / 1000) ** 2;
  const rawCells = mask.value.raw?.length ? rasterizeRaw(mask.value, 256, { metersAcross: sizeMeters.value }) : null;
  let raw = 0; if (rawCells) { for (let i = 0; i < rawCells.length; i++) raw += rawCells[i]; raw = Math.max(raw ? 1 : 0, Math.round((100 * raw) / rawCells.length)); }
  return { raw, bg: Math.round(f * 100), kept: Math.round((1 - f) * 100), km: (km2 * (1 - f)).toFixed(km2 * (1 - f) < 10 ? 1 : 0) };
});
const asideText = computed(() => (stats.value ? t('backgroundAreas.aside', { pct: stats.value.bg }) : t('backgroundAreas.asideNone')));

// D / B / E / R / U / N / H while the map is the focus (not while typing)
const KEYS = { h: 'pan', d: 'line', b: 'bucket', e: 'erase', r: 'road', u: 'unmask', n: 'raw' };
function onKey(e) {
  if (e.ctrlKey && e.key.toLowerCase() === 'z' && store.backgroundDrawn && !/input|textarea|select/i.test(e.target?.tagName || '')) { undo(); e.preventDefault(); return; }
  if (e.ctrlKey || e.metaKey || e.altKey || /input|textarea|select/i.test(e.target?.tagName || '') || e.target?.isContentEditable) return;
  const id = KEYS[e.key.toLowerCase()];
  if (id && (tool.value !== 'pan' || store.backgroundDrawn || id !== 'pan')) pick(id);
  if (e.key === 'Escape' && tool.value !== 'pan') pick('pan');
  // with Unmask or No smoothing: [ and ] size the brush, 1/2/3 pick the shape
  if (tool.value === 'unmask' || tool.value === 'raw') {
    if (e.key === '[' || e.key === ']') setBrush(Math.max(10, Math.min(1000, brushM.value + (e.key === ']' ? 1 : -1) * (brushM.value >= 200 ? 50 : 10))));
    const shape = { 1: 'brush', 2: 'rect', 3: 'lasso' }[e.key];
    if (shape) setShape(shape);
  }
}
// Areas drawn for another box (moved while in Basic mode or a batch job): they no
// longer fit, so they go, with a word why
function dropIfStale() {
  const m = store.backgroundMask;
  const b = selectionBounds();
  if (!store.backgroundDrawn || !m?.bounds || !b) return;
  const tol = Math.max(1e-6, (b.north - b.south) * 1e-4);
  const same = ['north', 'south', 'east', 'west'].every((k) => Math.abs(m.bounds[k] - b[k]) < tol);
  if (!same) { store.clearBackgroundMask(); setHint(t('backgroundAreas.staleCleared'), true); }
}
onMounted(() => { window.addEventListener('keydown', onKey); dropIfStale(); });
watch(() => store.backgroundActive, (on) => { if (on) dropIfStale(); });
onBeforeUnmount(() => { window.removeEventListener('keydown', onKey); tool.value = 'pan'; });
defineExpose({ edit });
</script>
