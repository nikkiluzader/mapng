<script setup>
import { ref, computed, onMounted, onUnmounted } from 'vue';
import { useI18n } from 'vue-i18n';
import { desktopApp } from '../../services/platform/desktop.js';

const { t } = useI18n({ useScope: 'global' });

const used = ref(null);   // MB or null if unsupported
const total = ref(null);  // MB
const limit = ref(null);  // MB — V8 heap size limit (jsHeapSizeLimit)
const peak = ref(0);      // MB

// Desktop app: the machine's CPU and memory instead of the page's heap (the
// export runs in its own process, without the page's 4 GB limit).
const usage = ref(null);
const exportPeak = ref(0);   // GB, this export
let stopUsage = null;

let intervalId = null;

function update() {
  const mem = performance?.memory;
  if (!mem) return;
  const mb = v => Math.round(v / 1048576);
  const u = mb(mem.usedJSHeapSize);
  const t = mb(mem.totalJSHeapSize);
  used.value = u;
  total.value = t;
  limit.value = mb(mem.jsHeapSizeLimit);
  if (u > peak.value) peak.value = u;
}

const gb = (bytes) => (bytes / 2 ** 30).toFixed(1);
const pct = (f) => `${Math.round(Math.max(0, Math.min(1, f)) * 100)}%`;
const memUsed = computed(() => (usage.value ? 1 - usage.value.memFree / usage.value.memTotal : 0));
const jobUsed = computed(() => (usage.value?.export ? usage.value.export.rss / (usage.value.export.heapLimit || 1) : 0));
const level = (fraction) => (fraction > 0.85 ? 'text-red-400' : fraction > 0.65 ? 'text-yellow-400' : 'text-green-400');

function onUsage(u) {
  if (u.export && !usage.value?.export) exportPeak.value = 0;
  if (u.export) exportPeak.value = Math.max(exportPeak.value, u.export.rss / 2 ** 30);
  usage.value = u;
}

onMounted(() => {
  if (desktopApp?.onUsage) {
    stopUsage = desktopApp.onUsage(onUsage);
    return;
  }
  update();
  intervalId = setInterval(update, 500);
});

onUnmounted(() => { clearInterval(intervalId); stopUsage?.(); });
</script>

<template>
  <!-- Desktop: two rows, always detailed: the machine on top, the running job (export,
       generate, update) below. The web has only the page's own heap. -->
  <div v-if="desktopApp" class="px-3.5 py-2 rounded-xl bg-black/60 border border-white/10 font-mono text-caption tabular-nums select-none whitespace-nowrap pointer-events-none">
    <template v-if="usage">
      <div class="flex items-center gap-2">
        <span class="text-white/50 uppercase tracking-wider text-nano">{{ t('memoryWidget.cpu') }}</span>
        <span :class="level(usage.cpu)">{{ Math.round(usage.cpu * 100) }}%</span>
        <span class="w-11 h-1.5 rounded-full bg-white/10 overflow-hidden" :class="level(usage.cpu)"><i class="block h-full bg-current" :style="{ width: pct(usage.cpu) }"></i></span>
        <span class="text-white/45">{{ t('memoryWidget.coreCount', { value: usage.cores }) }}</span>
        <span class="text-white/25">·</span>
        <span class="text-white/50 uppercase tracking-wider text-nano">{{ t('memoryWidget.ram') }}</span>
        <span :class="level(memUsed)">{{ gb(usage.memTotal - usage.memFree) }}</span>
        <span class="text-white/30">/</span>
        <span class="text-white/50">{{ gb(usage.memTotal) }} GB</span>
        <span class="w-11 h-1.5 rounded-full bg-white/10 overflow-hidden" :class="level(memUsed)"><i class="block h-full bg-current" :style="{ width: pct(memUsed) }"></i></span>
        <span class="text-white/45">{{ t('memoryWidget.freeGb', { value: gb(usage.memFree) }) }}</span>
        <span class="text-white/25">·</span>
        <span class="text-white/50 uppercase tracking-wider text-nano">{{ t('memoryWidget.app') }}</span>
        <span class="text-white/80">{{ gb(usage.app) }} GB</span>
      </div>
      <div class="flex items-center gap-2 mt-1.5 pt-1.5 border-t border-white/10">
        <template v-if="usage.export">
          <span class="text-brand-300 uppercase tracking-wider text-nano">{{ t(`memoryWidget.${usage.export.kind || 'export'}`) }}</span>
          <span :class="level(jobUsed)">{{ gb(usage.export.rss) }} GB</span>
          <span class="w-11 h-1.5 rounded-full bg-white/10 overflow-hidden" :class="level(jobUsed)"><i class="block h-full bg-current" :style="{ width: pct(jobUsed) }"></i></span>
          <span class="text-white/45">{{ t('memoryWidget.limitGb', { value: gb(usage.export.heapLimit) }) }}</span>
          <span class="text-white/25">·</span>
          <span class="text-white/45">{{ t('memoryWidget.peakGb', { value: exportPeak.toFixed(1) }) }}</span>
          <span class="text-white/25">·</span>
          <span class="text-white/80">{{ t('memoryWidget.cores', { value: usage.export.cores.toFixed(1), total: usage.cores }) }}</span>
        </template>
        <template v-else>
          <span class="text-white/50 uppercase tracking-wider text-nano">{{ t('memoryWidget.jobs') }}</span>
          <span class="text-white/40">{{ t('memoryWidget.noJobs') }}</span>
        </template>
      </div>
    </template>
    <span v-else class="text-white/30 italic">…</span>
  </div>
  <div v-else class="flex items-center gap-2 px-3 py-1.5 rounded-full bg-black/60 border border-white/10 font-mono text-caption tabular-nums select-none whitespace-nowrap pointer-events-none">
    <span class="text-white/50 uppercase tracking-wider text-nano">{{ t('memoryWidget.mem') }}</span>
    <template v-if="used !== null">
      <span :class="used / limit > 0.85 ? 'text-red-400' : used / limit > 0.65 ? 'text-yellow-400' : 'text-green-400'">
        {{ used }} MB
      </span>
      <span class="text-white/30">/</span>
      <span class="text-white/50">{{ t('memoryWidget.max', { value: limit }) }}</span>
      <span class="text-white/25">·</span>
      <span class="text-white/35">{{ t('memoryWidget.peak', { value: peak }) }}</span>
    </template>
    <span v-else class="text-white/30 italic">{{ t('memoryWidget.unavailable') }}</span>
  </div>
</template>
