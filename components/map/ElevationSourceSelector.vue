<template>
  <SettingSection v-model:open="showElevationSource" :title="t('map.elevationDataSource')" :icon="Mountain">
    <div class="space-y-2 rounded-lg border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-800/40 p-2.5">
        <select
            v-model="localElevationSource"
            class="w-full bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded px-2 py-1 text-xs text-gray-900 dark:text-white focus:ring-1 focus:ring-brand outline-none cursor-pointer"
        >
            <option value="mapterhorn">{{ t('map.mapterhornFree') }}</option>
            <option value="default">{{ t('map.standard30m') }}</option>
            <option value="none">{{ t('map.flatNone') }}</option>
            <option value="kron86" :disabled="!coverage.kron86 && localElevationSource !== 'kron86'">
              {{ t('map.kron86Poland') }}{{ coverage.kron86 ? '' : ` — ${t('map.outsideCoverage')}` }}
            </option>
            <option value="usgs" :disabled="!coverage.usgs && localElevationSource !== 'usgs'">
              {{ t('map.usgs1m') }}{{ coverage.usgs ? '' : ` — ${t('map.outsideCoverage')}` }}
            </option>
            <option value="gpxz">{{ t('map.gpxzPremium') }}</option>
        </select>

        <p v-if="selectedOutsideCoverage" class="text-micro text-amber-600 dark:text-amber-500 font-medium leading-tight">
          <AlertTriangle :size="11" class="inline -mt-0.5 mr-0.5" />{{ t('map.selectedSourceOutsideCoverage') }}
        </p>

        <!-- What free lidar holds here (Mapterhorn), measured over the selection when it settles -->
        <div v-if="sourceHint" data-testid="source-hint"
          :class="['rounded border px-2 py-1.5 text-micro leading-tight flex items-start gap-1.5',
            sourceHint.kind === 'suggest' ? 'border-brand/40 bg-brand/5 text-gray-700 dark:text-gray-200'
            : sourceHint.kind === 'warn' ? 'border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-400'
            : 'border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-300']">
          <Sparkles v-if="sourceHint.kind === 'suggest'" :size="12" class="text-brand shrink-0 mt-px" />
          <span class="flex-1">{{ sourceHint.text }}</span>
          <button v-if="sourceHint.kind === 'suggest'" type="button" @click="localElevationSource = 'mapterhorn'"
            class="shrink-0 font-bold text-brand hover:underline">{{ t('map.hintUseFreeLidar') }}</button>
        </div>
        <p v-else-if="probing" class="text-micro text-gray-400 leading-tight">{{ t('map.hintChecking') }}</p>

        <!-- Compare here: a 500 m square from each source at the selection's centre, as hillshades -->
        <div v-if="center" class="text-micro leading-tight">
          <button type="button" data-testid="compare-toggle" class="text-brand hover:underline" @click="toggleCompare">
            {{ compareOpen ? t('map.compareHide') : t('map.compareHere') }}
          </button>
          <div v-if="compareOpen" data-testid="compare-panel" class="mt-1.5 grid grid-cols-3 gap-1.5">
            <figure v-for="cell in compareCells" :key="cell.key" class="flex flex-col gap-0.5 min-w-0">
              <div class="aspect-square rounded border border-gray-200 dark:border-gray-600 bg-gray-100 dark:bg-gray-900 overflow-hidden flex items-center justify-center">
                <img v-if="cell.url" :src="cell.url" :alt="cell.label" class="w-full h-full object-cover" style="image-rendering: auto" />
                <button v-else-if="cell.key === 'gpxz' && cell.state === 'ask'" type="button" class="px-1 text-center text-brand hover:underline" @click="loadGpxzCompare">{{ t('map.compareAddGpxz') }}</button>
                <span v-else class="px-1 text-center text-gray-400">{{ cell.state === 'loading' ? '…' : cell.note }}</span>
              </div>
              <figcaption class="truncate font-bold text-gray-700 dark:text-gray-200" :title="cell.label">{{ cell.label }}</figcaption>
              <span v-if="cell.detail" class="truncate text-gray-500 dark:text-gray-400">{{ cell.detail }}</span>
            </figure>
          </div>
        </div>

        <!-- Default -->
        <span v-if="localElevationSource === 'default'" class="block text-micro text-gray-500 dark:text-gray-400 leading-tight">
            {{ t('map.standardDescription') }}
        </span>

        <!-- Mapterhorn -->
        <span v-else-if="localElevationSource === 'mapterhorn'" class="block text-micro text-gray-500 dark:text-gray-400 leading-tight">
            {{ t('map.mapterhornDescription') }} <a href="https://mapterhorn.com/coverage" target="_blank" rel="noopener" class="text-brand hover:underline">{{ t('map.checkCoverage') }}</a>
        </span>

        <!-- None / Flat -->
        <span v-else-if="localElevationSource === 'none'" class="block text-micro text-gray-500 dark:text-gray-400 leading-tight">
            {{ t('map.flatNoneDescription') }}
        </span>

        <!-- NMT EVRF2007 -->
        <span v-else-if="localElevationSource === 'kron86'" class="block text-micro text-gray-500 dark:text-gray-400 leading-tight">
            {{ t('map.kron86Description') }}
        </span>

        <!-- USGS -->
        <div v-else-if="localElevationSource === 'usgs'" class="space-y-0.5">
            <span v-if="usgsStatus" class="inline-block text-nano text-emerald-600 dark:text-emerald-400 font-bold px-1 bg-emerald-100 dark:bg-emerald-900/30 rounded">{{ t('map.online') }}</span>
            <span v-else-if="usgsStatus === false" class="inline-block text-nano text-red-600 dark:text-red-400 font-bold px-1 bg-red-100 dark:bg-red-900/30 rounded">{{ t('map.offline') }}</span>
            <span class="block text-micro text-gray-500 dark:text-gray-400 leading-tight">
                {{ t('map.usgsDescription') }}
            </span>
        </div>

        <!-- GPXZ -->
        <div v-else-if="localElevationSource === 'gpxz'" class="space-y-0.5 w-full">
                <span class="block text-micro text-gray-500 dark:text-gray-400 leading-tight">
                    {{ t('map.gpxzDescription') }} <a href="https://www.gpxz.io/docs/dataset#coverage" target="_blank" rel="noopener" class="text-brand hover:underline">{{ t('map.checkCoverage') }}</a>
                </span>
                <p v-if="localGpxzApiKey" class="text-micro leading-tight mt-1">
                  <button type="button" class="text-brand hover:underline disabled:opacity-50" :disabled="gpxzProbe === 'loading'" @click="checkGpxzHere">{{ t('map.gpxzCheckHere') }}</button>
                  <span v-if="gpxzProbe && gpxzProbe !== 'loading'" class="text-gray-600 dark:text-gray-300"> · {{ gpxzProbe }}</span>
                </p>

                <div class="mt-2 animate-in fade-in slide-in-from-top-1">
                    <input
                        type="password" 
                        v-model="localGpxzApiKey"
                        :placeholder="t('map.enterGpxzKey')"
                        class="w-full bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded px-2 py-1 text-xs text-gray-900 dark:text-white focus:ring-1 focus:ring-brand outline-none"
                    />
                    <p class="text-micro text-gray-500 dark:text-gray-400 leading-tight mt-1">
                        {{ t('map.freeTier') }} <a href="https://www.gpxz.io/" target="_blank" rel="noopener" class="text-brand hover:underline">{{ t('map.getKey') }}</a>
                    </p>
                    <p v-if="isBatchMode" class="text-micro text-amber-600 dark:text-amber-500 font-medium mt-1">
                      <AlertTriangle :size="11" class="inline -mt-0.5 mr-0.5" />{{ t('map.gpxzBatchWarning', { tiles: totalTiles }) }}
                    </p>
                    <!-- GPXZ Account Status -->
                    <div v-if="localGpxzApiKey" class="mt-2">
                      <button @click="verifyGpxzKey" :disabled="isCheckingGPXZ"
                        class="text-micro text-brand hover:underline disabled:opacity-50 disabled:no-underline">
                        {{ isCheckingGPXZ ? t('map.checking') : (gpxzStatus ? t('map.refreshStatus') : t('map.checkAccount')) }}
                      </button>
                      <div v-if="gpxzStatus" class="mt-1 bg-white dark:bg-gray-800 rounded border border-gray-200 dark:border-gray-600 p-2 space-y-1">
                        <div class="flex items-center justify-between text-micro">
                          <span class="text-gray-500 dark:text-gray-400">{{ t('map.plan') }}</span>
                          <span :class="['font-bold uppercase', gpxzStatus.plan === 'free' ? 'text-gray-600 dark:text-gray-300' : 'text-emerald-600 dark:text-emerald-400']">{{ gpxzStatus.plan }}</span>
                        </div>
                        <div class="flex items-center justify-between text-micro">
                          <span class="text-gray-500 dark:text-gray-400">{{ t('map.today') }}</span>
                          <span class="text-gray-700 dark:text-gray-300">{{ gpxzStatus.used }} / {{ gpxzStatus.limit }}</span>
                        </div>
                        <div class="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-1 mt-0.5">
                          <div class="h-1 rounded-full transition-all" :class="gpxzStatus.remaining < 20 ? 'bg-red-500' : 'bg-emerald-500'" :style="{ width: Math.min(100, (gpxzStatus.used / gpxzStatus.limit) * 100) + '%' }"></div>
                        </div>
                        <div class="flex items-center justify-between text-micro">
                          <span class="text-gray-500 dark:text-gray-400">{{ t('map.concurrency') }}</span>
                          <span class="text-gray-700 dark:text-gray-300">{{ t('map.parallel', { count: gpxzStatus.concurrency }) }}</span>
                        </div>
                        <p v-if="!gpxzStatus.valid" class="text-micro text-red-500 font-medium"><AlertTriangle :size="11" class="inline -mt-0.5 mr-0.5" />{{ t('map.invalidApiKey') }}</p>
                      </div>
                    </div>
                    <p v-if="isAreaLargeForGPXZ" class="text-micro text-orange-600 dark:text-orange-400 font-medium leading-tight mt-1">
                        <AlertTriangle :size="11" class="inline -mt-0.5 mr-0.5" />{{ t('map.largeAreaWarning', { area: areaSqKm.toFixed(2) }) }}
                    </p>
                </div>
        </div>
    </div>
    <!-- (the control panel adds its upload and raw-terrain controls here) -->
    <slot />
  </SettingSection>
</template>

<script setup>
import SettingSection from '../base/SettingSection.vue';
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { Mountain, ChevronDown, AlertTriangle, Sparkles } from 'lucide-vue-next';
import { boxAround, probeMapterhorn, probeGpxz } from '../../services/sourceAdvisor.js';
import { standardPatch, mapterhornPatch, gpxzPatch, hillshadeDataUrl } from '../../services/sourceCompare.js';

const { t } = useI18n({ useScope: 'global' });

const props = defineProps({
  elevationSource: {
    type: String,
    required: true
  },
  usgsStatus: {
    type: Boolean,
    default: null
  },
  gpxzApiKey: {
    type: String,
    default: ''
  },
  gpxzStatus: {
    type: Object,
    default: null
  },
  isCheckingGPXZ: {
    type: Boolean,
    default: false
  },
  isAreaLargeForGPXZ: {
    type: Boolean,
    default: false
  },
  areaSqKm: {
    type: Number,
    default: 0
  },
  isBatchMode: {
    type: Boolean,
    default: false
  },
  totalTiles: {
    type: Number,
    default: 0
  },
  // Map centre: region-only sources are disabled outside their coverage (issue #18).
  center: {
    type: Object,
    default: null
  }
});

// Coarse coverage boxes [south, west, north, east] of the region-only sources.
const SOURCE_COVERAGE = {
  // USGS 3DEP 1 m: conterminous US, Alaska, Hawaii, Puerto Rico
  usgs: [[24.4, -125.0, 49.5, -66.8], [51.0, -180.0, 71.6, -129.9], [18.8, -160.4, 22.4, -154.7], [17.8, -67.4, 18.6, -65.2]],
  // NMT EVRF2007: Poland
  kron86: [[49.0, 14.1, 54.9, 24.2]],
};

const coverage = computed(() => {
  const lat = Number(props.center?.lat);
  const lng = Number(props.center?.lng);
  const known = Number.isFinite(lat) && Number.isFinite(lng);
  const inside = (boxes) => !known || boxes.some(([s, w, n, e]) => lat >= s && lat <= n && lng >= w && lng <= e);
  return { usgs: inside(SOURCE_COVERAGE.usgs), kron86: inside(SOURCE_COVERAGE.kron86) };
});

const selectedOutsideCoverage = computed(() => (
  (localElevationSource.value === 'usgs' && !coverage.value.usgs)
  || (localElevationSource.value === 'kron86' && !coverage.value.kron86)
));

const emit = defineEmits(['update:elevationSource', 'update:gpxzApiKey', 'verifyGpxzKey']);

const localElevationSource = ref(props.elevationSource);
const localGpxzApiKey = ref(props.gpxzApiKey);
const showElevationSource = ref(localStorage.getItem('mapng_showElevationSource') !== 'false');

watch(showElevationSource, (v) => localStorage.setItem('mapng_showElevationSource', String(v)));

watch(localElevationSource, (newVal) => {
  emit('update:elevationSource', newVal);
});

watch(() => props.elevationSource, (newVal) => {
  localElevationSource.value = newVal;
});

watch(localGpxzApiKey, (newVal) => {
  emit('update:gpxzApiKey', newVal);
});

// ── Free lidar here? (Mapterhorn over the selection box, once the map settles) ──
const probe = ref(null);          // { coverage, zoom, metersPerPixel, reachable }
const probing = ref(false);
let probeTimer = null; let probeAbort = null;
const selectionBox = () => {
  const lat = Number(props.center?.lat), lng = Number(props.center?.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  const side = props.areaSqKm > 0 ? Math.sqrt(props.areaSqKm) : 1;
  return boxAround({ lat, lng }, Math.min(side, 20));
};
const runProbe = () => {
  clearTimeout(probeTimer);
  probeTimer = setTimeout(async () => {
    const box = selectionBox(); if (!box) return;
    probeAbort?.abort(); probeAbort = new AbortController();
    probing.value = true;
    try { probe.value = await probeMapterhorn(box, { signal: probeAbort.signal }); }
    catch { /* aborted by a newer selection */ }
    finally { probing.value = false; }
  }, 700);
};
watch(() => [props.center?.lat, props.center?.lng, props.areaSqKm], runProbe, { immediate: true });

const fmtRes = (m) => (m < 1.5 ? m.toFixed(1) : String(Math.round(m)));
const sourceHint = computed(() => {
  const p = probe.value; const src = localElevationSource.value;
  if (!p || !p.reachable || src === 'none') return null;
  const pct = Math.round(p.coverage * 100); const res = p.metersPerPixel ? fmtRes(p.metersPerPixel) : null;
  if (src === 'mapterhorn') {
    if (pct === 0) return { kind: 'warn', text: t('map.hintMhNone') };
    if (pct >= 100 && res) return { kind: 'info', text: t('map.hintMhFull', { res }) };
    return { kind: 'info', text: t('map.hintMhPartial', { res: res || '?', pct }) };
  }
  if ((src === 'default' || src === 'gpxz') && pct > 0 && res) return { kind: 'suggest', text: t('map.hintFreeLidar', { res, pct }) };
  return null;
});

// GPXZ at the selection, on request only (one call of the user's plan)
const gpxzProbe = ref(null);
const checkGpxzHere = async () => {
  const box = selectionBox(); if (!box || !localGpxzApiKey.value) return;
  gpxzProbe.value = 'loading';
  try {
    const pts = await probeGpxz(box, localGpxzApiKey.value);
    const best = Math.min(...pts.map((p) => p.resolution).filter(Number.isFinite));
    const names = [...new Set(pts.map((p) => p.source).filter((n) => n && !/bathymetry/.test(n)))].join(', ');
    gpxzProbe.value = t('map.gpxzHere', { res: fmtRes(best), sources: names });
  } catch (e) { gpxzProbe.value = t('map.gpxzHereFailed'); }
};
watch(() => [props.center?.lat, props.center?.lng], () => { if (gpxzProbe.value !== 'loading') gpxzProbe.value = null; });

// ── Compare here ──
const COMPARE_SIDE_M = 512, COMPARE_PX = 192;
const compareOpen = ref(false);
const compare = ref({});           // key -> { url, state, note, detail }
let compareAbort = null;
const compareCells = computed(() => [
  { key: 'standard', label: t('config.source_default'), ...compare.value.standard },
  { key: 'mapterhorn', label: 'Mapterhorn', ...compare.value.mapterhorn },
  { key: 'gpxz', label: 'GPXZ', ...(compare.value.gpxz || { state: localGpxzApiKey.value ? 'ask' : 'none', note: t('map.compareNeedsKey') }) },
]);
const centerPoint = () => ({ lat: Number(props.center?.lat), lng: Number(props.center?.lng) });
const setCell = (key, v) => { compare.value = { ...compare.value, [key]: v }; };
const loadCompare = async () => {
  compareAbort?.abort(); compareAbort = new AbortController(); const signal = compareAbort.signal;
  const c = centerPoint(); compare.value = {};
  const cell = COMPARE_SIDE_M / COMPARE_PX;
  setCell('standard', { state: 'loading' }); setCell('mapterhorn', { state: 'loading' });
  standardPatch(c, { sideM: COMPARE_SIDE_M, px: COMPARE_PX, signal })
    .then((h) => setCell('standard', { url: hillshadeDataUrl(h, COMPARE_PX, cell), detail: '~30 m' }))
    .catch(() => { if (!signal.aborted) setCell('standard', { note: t('map.compareFailed') }); });
  try {
    const p = probe.value?.reachable ? probe.value : await probeMapterhorn(boxAround(c, 0.6), { signal });
    if (!p.zoom) setCell('mapterhorn', { note: t('map.compareNoLidar') });
    else {
      const h = await mapterhornPatch(c, p.zoom, { sideM: COMPARE_SIDE_M, px: COMPARE_PX, signal });
      setCell('mapterhorn', { url: hillshadeDataUrl(h, COMPARE_PX, cell), detail: `~${fmtRes(p.metersPerPixel)} m · ${t('map.compareFree')}` });
    }
  } catch { if (!signal.aborted) setCell('mapterhorn', { note: t('map.compareFailed') }); }
};
const loadGpxzCompare = async () => {
  const c = centerPoint(); setCell('gpxz', { state: 'loading' });
  try {
    const h = await gpxzPatch(c, localGpxzApiKey.value, { sideM: COMPARE_SIDE_M, px: COMPARE_PX, signal: compareAbort?.signal });
    setCell('gpxz', { url: hillshadeDataUrl(h, COMPARE_PX, COMPARE_SIDE_M / COMPARE_PX), detail: t('map.compareOneCall') });
  } catch { setCell('gpxz', { note: t('map.compareFailed') }); }
};
const toggleCompare = () => { compareOpen.value = !compareOpen.value; if (compareOpen.value) loadCompare(); else compareAbort?.abort(); };
watch(() => [props.center?.lat, props.center?.lng], () => { if (compareOpen.value) { compareOpen.value = false; compareAbort?.abort(); } });

watch(() => props.gpxzApiKey, (newVal) => {
  localGpxzApiKey.value = newVal;
});

const verifyGpxzKey = () => {
  emit('verifyGpxzKey');
};
</script>
