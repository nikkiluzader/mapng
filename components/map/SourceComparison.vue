<template>
  <!-- Compare sources here: a 500 m square from every elevation source this place has, as hillshades, with
       a recommendation and the quality report. Its own section (it sat folded inside the source selector). -->
  <SettingSection v-if="hasCenter" v-model:open="open" :title="t('map.compareHere')" :icon="Layers" data-testid="compare-section">
    <div class="space-y-2 rounded-lg border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-800/40 p-2.5 text-micro leading-tight">
      <p class="text-gray-500 dark:text-gray-400">
        {{ store.compareSpot ? t('map.compareIntroSpot') : t('map.compareIntro') }}
        <button v-if="store.compareSpot" type="button" data-testid="compare-middle" class="text-brand hover:underline" @click="store.compareSpot = null">{{ t('map.compareBackToMiddle') }}</button>
        <span v-else>{{ t('map.compareSpotHint') }}</span>
      </p>
      <div v-if="stale" class="flex items-center gap-2">
        <button type="button" data-testid="compare-toggle" class="font-bold text-brand hover:underline" @click="loadCompare">{{ t('map.compareStart') }}</button>
        <span v-if="moved" class="text-gray-500 dark:text-gray-400">{{ t('map.compareMoved') }}</span>
      </div>
      <template v-else>
        <div data-testid="compare-panel" class="grid grid-cols-3 gap-1.5">
          <figure v-for="cell in compareCells" :key="cell.key" :data-testid="`compare-cell-${cell.key}`" class="flex flex-col gap-0.5 min-w-0">
            <div class="aspect-square rounded border border-gray-200 dark:border-gray-600 bg-gray-100 dark:bg-gray-900 overflow-hidden flex items-center justify-center">
              <img v-if="cell.url" :src="cell.url" :alt="cell.label" class="w-full h-full object-cover" style="image-rendering: auto" />
              <button v-else-if="cell.key === 'gpxz' && cell.state === 'ask'" type="button" class="px-1 text-center text-brand hover:underline" @click="loadGpxzCompare">{{ t('map.compareAddGpxz') }}</button>
              <button v-else-if="cell.regional && cell.state === 'ask'" type="button" class="px-1 text-center text-brand hover:underline" :title="cell.key === 'kron86' ? t('map.compareAddSurveyHint') : ''" @click="loadRegional(cell.key)">{{ t('map.compareAddSurvey') }}</button>
              <span v-else class="px-1 text-center text-gray-400">{{ cell.state === 'loading' ? (cell.progress || '…') : cell.note }}</span>
            </div>
            <figcaption class="truncate font-bold text-gray-700 dark:text-gray-200" :title="cell.label">{{ cell.label }}</figcaption>
            <span v-if="cell.detail" class="truncate text-gray-500 dark:text-gray-400">{{ cell.detail }}</span>
          </figure>
        </div>
        <!-- which of the loaded sources to use here (services/sourceRecommend.js): light, from the pictures' own heights -->
        <p v-if="recommendText" data-testid="compare-recommend" class="leading-snug" :class="recommend?.why === 'lidarLevel' ? 'text-amber-700 dark:text-amber-400' : 'text-gray-600 dark:text-gray-300'">
          <span class="font-semibold">{{ t('map.recommendLabel') }}</span> {{ recommendText }}
          <button v-if="pickable" type="button" data-testid="compare-use" class="ml-1 font-bold text-brand hover:underline" @click="emit('pick', pickable)">{{ t('map.compareUse') }}</button>
        </p>
        <!-- the comparison as a page to keep or share: each source scored on this square -->
        <div v-if="canReport" class="flex items-center gap-2">
          <button type="button" data-testid="compare-report" class="text-brand hover:underline disabled:opacity-50" :disabled="reportBusy" @click="saveQualityReport">
            {{ reportBusy ? t('map.compareReportBusy') : t('map.compareReport') }}
          </button>
          <span v-if="reportNote" class="text-gray-500 dark:text-gray-400">{{ reportNote }}</span>
        </div>
      </template>
    </div>
  </SettingSection>
</template>

<script setup>
import SettingSection from '../base/SettingSection.vue';
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { Layers } from 'lucide-vue-next';
import { boxAround, probeMapterhorn } from '../../services/sourceAdvisor.js';
import { useMainStore } from '../../stores/mainStore';
import { recommendSource } from '../../services/sourceRecommend.js';
import { standardPatch, mapterhornPatch, gpxzPatch, regionalPatch, regionalSourcesAt, hillshadeDataUrl } from '../../services/sourceCompare.js';

const { t } = useI18n({ useScope: 'global' });
const props = defineProps({
  center: { type: Object, default: null },
  gpxzApiKey: { type: String, default: '' },
  // the elevation source chosen now (the recommendation offers "Use it" only for another one)
  elevationSource: { type: String, default: '' },
});
const emit = defineEmits(['pick']);
const store = useMainStore();

// (folded until asked for: opening it reads tiles from every source)
const open = ref(false);
const hasCenter = computed(() => Number.isFinite(Number(props.center?.lat)) && Number.isFinite(Number(props.center?.lng)));
const fmtRes = (m) => (m < 1.5 ? m.toFixed(1) : String(Math.round(m)));

// (1 m cells: the quality report measures road benches on the same heights the pictures show)
const COMPARE_SIDE_M = 512, COMPARE_PX = 512;
// heights behind each picture, for the report (not reactive: 1 MB arrays)
const compareHeights = {};
const compare = ref({});           // key -> { url, state, note, detail, progress }
const stale = ref(true);           // nothing loaded for where the selection is now
const moved = ref(false);
let compareAbort = null;
// (a spot chosen on the map with a right-click, else the middle of the selection)
const centerPoint = () => (store.compareSpot ? { lat: Number(store.compareSpot.lat), lng: Number(store.compareSpot.lng) } : { lat: Number(props.center?.lat), lng: Number(props.center?.lng) });
// the region's own surveys at this place (USGS in the United States, NMT in Poland): each its own cell
const regional = computed(() => (hasCenter.value ? regionalSourcesAt(centerPoint()) : []));
const REGIONAL_LABEL = { usgs: 'USGS 1 m', kron86: 'NMT (Polska)' };
const compareCells = computed(() => [
  { key: 'standard', label: t('map.compareGlobal30'), ...compare.value.standard },
  { key: 'mapterhorn', label: 'Mapterhorn', ...compare.value.mapterhorn },
  { key: 'gpxz', label: 'GPXZ', ...(compare.value.gpxz || { state: props.gpxzApiKey ? 'ask' : 'none', note: t('map.compareNeedsKey') }) },
  ...regional.value.map((key) => ({ key, regional: true, label: REGIONAL_LABEL[key] || key, ...(compare.value[key] || { state: 'ask' }) })),
]);
const recommend = ref(null);       // { pick, why, share, apartM } once every picture asked for has loaded
const updateRecommend = () => {
  const loading = Object.values(compare.value).some((c) => c?.state === 'loading');
  try { recommend.value = loading ? null : recommendSource(compareHeights, COMPARE_PX, COMPARE_SIDE_M / COMPARE_PX); } catch { recommend.value = null; }
};
const recommendText = computed(() => {
  const r = recommend.value; if (!r) return '';
  const name = { standard: t('map.compareGlobal30'), mapterhorn: t('map.recommendBestFree'), gpxz: 'GPXZ', ...REGIONAL_LABEL }[r.pick];
  if (r.why === 'lidarLevel') return t('map.recommendLidarLevel', { source: name, percent: Math.round(r.share * 100), metres: Math.round(r.apartM) });
  if (r.why === 'noLidar') return t('map.recommendNoLidar', { source: name });
  return t('map.recommendFinest', { source: name });
});
// the recommended source as the selector names it, when it is not the one chosen already
const SELECTOR_KEY = { standard: 'default', mapterhorn: 'mapterhorn', gpxz: 'gpxz', usgs: 'usgs', kron86: 'kron86' };
const pickable = computed(() => { const k = SELECTOR_KEY[recommend.value?.pick]; return k && k !== props.elevationSource ? k : ''; });
const setCell = (key, v) => { compare.value = { ...compare.value, [key]: v }; updateRecommend(); };
const loadCompare = async () => {
  compareAbort?.abort(); compareAbort = new AbortController(); const signal = compareAbort.signal;
  const c = centerPoint(); compare.value = {}; recommend.value = null; for (const k of Object.keys(compareHeights)) delete compareHeights[k]; reportNote.value = '';
  stale.value = false; moved.value = false;
  const cell = COMPARE_SIDE_M / COMPARE_PX;
  setCell('standard', { state: 'loading' }); setCell('mapterhorn', { state: 'loading' });
  standardPatch(c, { sideM: COMPARE_SIDE_M, px: COMPARE_PX, signal })
    .then((h) => { compareHeights.standard = { h, res: 30 }; setCell('standard', { url: hillshadeDataUrl(h, COMPARE_PX, cell), detail: '~30 m' }); })
    .catch(() => { if (!signal.aborted) setCell('standard', { note: t('map.compareFailed') }); });
  try {
    const p = await probeMapterhorn(boxAround(c, 0.6), { signal });
    if (!p.zoom) setCell('mapterhorn', { note: t('map.compareNoLidar') });
    else {
      const h = await mapterhornPatch(c, p.zoom, { sideM: COMPARE_SIDE_M, px: COMPARE_PX, signal });
      compareHeights.mapterhorn = { h, res: p.metersPerPixel };
      setCell('mapterhorn', { url: hillshadeDataUrl(h, COMPARE_PX, cell), detail: `~${fmtRes(p.metersPerPixel)} m · ${t('map.compareFree')}` });
    }
  } catch { if (!signal.aborted) setCell('mapterhorn', { note: t('map.compareFailed') }); }
};
const loadGpxzCompare = async () => {
  const c = centerPoint(); const signal = compareAbort?.signal; setCell('gpxz', { state: 'loading' });
  try {
    const h = await gpxzPatch(c, props.gpxzApiKey, { sideM: COMPARE_SIDE_M, px: COMPARE_PX, signal });
    compareHeights.gpxz = { h, res: 1 };
    setCell('gpxz', { url: hillshadeDataUrl(h, COMPARE_PX, COMPARE_SIDE_M / COMPARE_PX), detail: '~1 m' });
  } catch { if (!signal?.aborted) setCell('gpxz', { note: t('map.compareFailed') }); }
};
// A region's own survey (asked for: it downloads whole survey sheets, which can be large)
const loadRegional = async (key) => {
  const c = centerPoint(); const signal = compareAbort?.signal; setCell(key, { state: 'loading' });
  try {
    const h = await regionalPatch(c, key, { sideM: COMPARE_SIDE_M, px: COMPARE_PX, signal, onProgress: (text) => { if (compare.value[key]?.state === 'loading') compare.value = { ...compare.value, [key]: { state: 'loading', progress: String(text || '').slice(0, 60) } }; } });
    if (signal?.aborted) return;
    if (!h) { setCell(key, { note: t('map.compareNoSurvey') }); return; }
    compareHeights[key] = { h, res: 1 };
    setCell(key, { url: hillshadeDataUrl(h, COMPARE_PX, COMPARE_SIDE_M / COMPARE_PX), detail: `~1 m · ${t('map.compareFree')}` });
  } catch (e) { console.warn('[Compare]', key, e); if (!signal?.aborted) setCell(key, { note: t('map.compareFailed') }); }
};

// The quality report: this square's roads (one map data request) measured on every source the comparison
// has loaded; opened as one HTML page. GPXZ and the regional surveys are in it only when they were added.
const reportBusy = ref(false);
const reportNote = ref('');
const canReport = computed(() => compareCells.value.some((c) => c.url));
/** A new tab with a waiting line in it, or null when the browser refuses one. */
const openReportTab = (waiting) => {
  try {
    const tab = window.open('', '_blank');
    if (!tab) return null;
    tab.opener = null;
    tab.document.title = 'MapNG';
    const p = tab.document.createElement('p');
    p.textContent = waiting;
    p.style.cssText = 'font: 16px system-ui, sans-serif; margin: 3rem; color: #555';
    tab.document.body.appendChild(p);
    return tab;
  } catch { return null; }
};
const saveQualityReport = async () => {
  if (reportBusy.value) return;
  reportBusy.value = true; reportNote.value = '';
  // The report opens in a new tab (a button that saved a file read as a download nobody had asked for). The
  // tab is opened now, while the click still counts as the user's, and shown the page when it is ready.
  const tab = openReportTab(t('map.compareReportBusy'));
  try {
    const c = centerPoint();
    const [{ fetchOSMData, getLastOSMRequestInfo, restoreLastOSMRequestInfo }, { roadsInPatch, compareSources, qualityReportHtml }] = await Promise.all([import('../../services/osm.js'), import('../../services/sourceQuality.js')]);
    const dLat = COMPARE_SIDE_M / 2 / 111320, dLng = dLat / Math.cos((c.lat * Math.PI) / 180);
    // (this small pull is not the map's: what the last real one recorded is put back after it)
    const lastInfo = getLastOSMRequestInfo();
    let features; let osmSource = '';
    try {
      features = await fetchOSMData({ north: c.lat + dLat, south: c.lat - dLat, east: c.lng + dLng, west: c.lng - dLng }, { signal: compareAbort?.signal });
      osmSource = getLastOSMRequestInfo()?.endpointUsed || '';
    } finally { restoreLastOSMRequestInfo(lastInfo); }
    const roads = roadsInPatch(features, c, COMPARE_SIDE_M);
    const sources = compareCells.value.map((cell) => {
      const got = compareHeights[cell.key];
      // (a regional survey nobody added is left out of the page; GPXZ keeps its "needs a key" card)
      if (cell.regional && !got) return null;
      return { key: cell.key, label: cell.label, detail: cell.detail || '', note: cell.note || (cell.key === 'gpxz' ? t('map.compareNeedsKey') : ''), nativeResM: got?.res ?? NaN, heights: cell.url && got ? got.h : null, px: COMPARE_PX, cellM: COMPARE_SIDE_M / COMPARE_PX, image: cell.url || null };
    }).filter(Boolean);
    const result = compareSources(sources, roads, COMPARE_SIDE_M);
    const html = qualityReportHtml(result, {
      center: c, sideM: COMPARE_SIDE_M, roadCount: roads.length, generatedAt: new Date().toISOString().slice(0, 10),
      appVersion: typeof __BUILD_HASH__ !== 'undefined' ? __BUILD_HASH__ : '', osmSource,
    });
    const url = URL.createObjectURL(new Blob([html], { type: 'text/html' }));
    if (tab && !tab.closed) {
      // (the address is kept for as long as this page lives: the tab can be reloaded)
      tab.location.replace(url);
    } else {
      // (the browser would not open a tab: the page is saved as a file instead)
      const link = document.createElement('a');
      link.href = url; link.download = `mapng-elevation-quality-${c.lat.toFixed(4)}_${c.lng.toFixed(4)}.html`;
      document.body.appendChild(link); link.click(); link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10000);
    }
    reportNote.value = result.verdict;
  } catch (e) {
    console.warn('[Quality report]', e);
    reportNote.value = t('map.compareReportFailed');
    try { tab?.close(); } catch { /* already gone */ }
  } finally { reportBusy.value = false; }
};

// Opened: compare where the selection is. The selection moves: what is shown is of the old place, so it is
// cleared and offered again (not re-read on every pan: each read is tiles from every source).
watch(open, (v) => { if (v && stale.value) loadCompare(); else if (!v) compareAbort?.abort(); });
watch(() => [props.center?.lat, props.center?.lng], () => {
  // (a chosen spot stays where it was put: the selection moving does not move it)
  if (store.compareSpot) return;
  compareAbort?.abort(); const had = !stale.value;
  compare.value = {}; recommend.value = null; reportNote.value = ''; for (const k of Object.keys(compareHeights)) delete compareHeights[k];
  stale.value = true; moved.value = had;
});
// A spot chosen on the map (or given up): the section opens and compares there at once.
watch(() => [store.compareSpot?.lat, store.compareSpot?.lng], () => {
  if (store.compareSpot) { if (!open.value) { stale.value = true; open.value = true; } else loadCompare(); }
  else if (open.value) loadCompare();
});
</script>
