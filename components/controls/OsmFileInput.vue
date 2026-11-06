<template>
  <!-- An OpenStreetMap file of the user's own (services/osmFile.js): fetched
       from openstreetmap.org with one click, dropped here, then read instead
       of the Overpass servers while it covers the area. -->
  <details class="pl-4 text-caption text-gray-500 dark:text-gray-400" :open="!!file || undefined">
    <summary class="cursor-pointer select-none hover:text-brand">
      {{ t('osmFile.title') }}
      <span v-if="file" class="ml-1 font-semibold" :class="coverageClass">· {{ t(`osmFile.short_${coverage.coverage}`) }}</span>
    </summary>

    <!-- a file is loaded: what it is, whether it covers the area -->
    <div v-if="file" class="mt-1 rounded-lg border px-2.5 py-2" :class="coverageBorder">
      <div class="flex items-start gap-2">
        <FileText :size="14" class="shrink-0 mt-0.5 text-gray-400" />
        <div class="min-w-0 flex-1">
          <div class="font-medium text-gray-800 dark:text-gray-100 truncate" :title="file.name">{{ file.name }}</div>
          <div class="text-micro text-gray-500 dark:text-gray-400">{{ t('osmFile.counts', { nodes: fmt(file.counts.nodes), ways: fmt(file.counts.ways) }) }}</div>
        </div>
        <button type="button" class="shrink-0 text-gray-400 hover:text-red-500" :title="t('osmFile.remove')" :aria-label="t('osmFile.remove')" @click="clearOsmFile()">
          <X :size="14" />
        </button>
      </div>
      <p class="mt-1.5 flex items-start gap-1.5 leading-snug" :class="coverageClass">
        <component :is="coverage.coverage === 'full' ? CheckCircle2 : AlertTriangle" :size="12" class="shrink-0 mt-px" />
        <span>{{ t(`osmFile.coverage_${coverage.coverage}${grid && coverage.coverage === 'partial' ? 'Grid' : ''}`, { pct: Math.round(coverage.share * 100) }) }}</span>
      </p>
    </div>

    <!-- none yet: get one for the area, then drop it here -->
    <div v-else class="mt-1 space-y-1.5">
      <p class="leading-snug">{{ t('osmFile.hint') }}</p>
      <div class="flex flex-wrap gap-1.5">
        <a
          v-if="areaOk"
          :href="osmExportUrl(area)"
          target="_blank"
          rel="noopener noreferrer"
          class="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-brand text-white font-semibold hover:bg-brand-500"
          :title="t('osmFile.downloadTitle')"
        ><Download :size="12" />{{ t('osmFile.download') }}</a>
        <a
          :href="osmExportPageUrl(area)"
          target="_blank"
          rel="noopener noreferrer"
          class="inline-flex items-center gap-1 px-2 py-1 rounded-md border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200 hover:border-brand hover:text-brand"
        ><ExternalLink :size="12" />{{ t('osmFile.openSite') }}</a>
      </div>
      <p v-if="!areaOk" class="flex items-start gap-1.5 leading-snug text-amber-700 dark:text-amber-300">
        <AlertTriangle :size="12" class="shrink-0 mt-px" />{{ t('osmFile.tooBig') }}
      </p>
      <label
        class="flex flex-col items-center justify-center gap-0.5 rounded-lg border-2 border-dashed px-3 py-3 text-center cursor-pointer transition-colors"
        :class="dragging ? 'border-brand bg-brand-50/60 dark:bg-brand/10 text-brand' : 'border-gray-300 dark:border-gray-600 hover:border-brand hover:text-brand'"
        @dragenter.prevent="dragging = true"
        @dragover.prevent="dragging = true"
        @dragleave.prevent="dragging = false"
        @drop.prevent="onDrop"
      >
        <Upload :size="16" />
        <span class="font-medium">{{ reading ? t('osmFile.reading') : t('osmFile.drop') }}</span>
        <span class="text-micro text-gray-400">{{ t('osmFile.formats') }}</span>
        <input type="file" accept=".osm,.xml,.json,application/xml,application/json" class="sr-only" @change="onPick" />
      </label>
      <p v-if="error" :title="error" class="flex items-start gap-1.5 leading-snug text-red-600 dark:text-red-400">
        <AlertTriangle :size="12" class="shrink-0 mt-px" />{{ t('osmFile.bad') }}
      </p>
    </div>
  </details>
</template>

<script setup>
import { computed, onBeforeUnmount, ref, shallowRef } from 'vue';
import { useI18n } from 'vue-i18n';
import { AlertTriangle, CheckCircle2, Download, ExternalLink, FileText, Upload, X } from 'lucide-vue-next';
import {
  getLoadedOsmFile, loadOsmFileText, clearOsmFile, onOsmFileChange,
  osmFileCoverage, osmExportUrl, osmExportPageUrl, osmExportAreaOk,
} from '../../services/osmFile.js';

const props = defineProps({
  // the area being generated: { south, west, north, east } (a batch: the whole grid)
  area: { type: Object, required: true },
  // (a batch grid: each tile checks the file on its own)
  grid: { type: Boolean, default: false },
});
const { t, locale } = useI18n({ useScope: 'global' });

const file = shallowRef(getLoadedOsmFile());
const stop = onOsmFileChange((f) => { file.value = f; });
onBeforeUnmount(stop);

const dragging = ref(false);
const reading = ref(false);
const error = ref('');

const areaOk = computed(() => osmExportAreaOk(props.area));
const coverage = computed(() => (file.value ? osmFileCoverage(file.value.bounds, props.area) : { coverage: 'none', share: 0 }));
const coverageClass = computed(() => ({
  full: 'text-emerald-700 dark:text-emerald-400',
  partial: 'text-amber-700 dark:text-amber-300',
  none: 'text-red-600 dark:text-red-400',
})[coverage.value.coverage]);
const coverageBorder = computed(() => ({
  full: 'border-emerald-200 dark:border-emerald-800 bg-emerald-50/50 dark:bg-emerald-900/10',
  partial: 'border-amber-200 dark:border-amber-800 bg-amber-50/50 dark:bg-amber-900/10',
  none: 'border-red-200 dark:border-red-800 bg-red-50/50 dark:bg-red-900/10',
})[coverage.value.coverage]);
const fmt = (n) => Number(n || 0).toLocaleString(locale.value);

async function read(picked) {
  if (!picked) return;
  error.value = '';
  reading.value = true;
  try {
    loadOsmFileText(await picked.text(), picked.name || 'map.osm');
  } catch (e) {
    error.value = String(e?.message || e);
  } finally {
    reading.value = false;
  }
}
const onDrop = (e) => { dragging.value = false; read(e.dataTransfer?.files?.[0]); };
const onPick = (e) => { read(e.target.files?.[0]); e.target.value = ''; };
</script>
