<script setup>
import { ref, onMounted, onUnmounted } from 'vue';
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
  <div class="flex items-center gap-2 px-3 py-1.5 rounded-full bg-black/60 backdrop-blur-sm border border-white/10 font-mono text-[11px] tabular-nums select-none whitespace-nowrap pointer-events-none">
    <template v-if="desktopApp">
      <template v-if="usage">
        <span class="text-white/50 uppercase tracking-wider text-[9px]">{{ t('memoryWidget.cpu') }}</span>
        <span :class="level(usage.cpu)">{{ Math.round(usage.cpu * 100) }}%</span>
        <span class="text-white/25">·</span>
        <span class="text-white/50 uppercase tracking-wider text-[9px]">{{ t('memoryWidget.ram') }}</span>
        <span :class="level(1 - usage.memFree / usage.memTotal)">{{ gb(usage.memTotal - usage.memFree) }}</span>
        <span class="text-white/30">/</span>
        <span class="text-white/50">{{ gb(usage.memTotal) }} GB</span>
        <span class="text-white/25">·</span>
        <span class="text-white/50 text-[9px]">MapNG</span>
        <span class="text-white/70">{{ gb(usage.app) }} GB</span>
        <template v-if="usage.export">
          <span class="text-white/25">|</span>
          <span class="text-white/50 uppercase tracking-wider text-[9px]">{{ t(`memoryWidget.${usage.export.kind || 'export'}`) }}</span>
          <span :class="level(usage.export.rss / usage.export.heapLimit)">{{ gb(usage.export.rss) }} GB</span>
          <span class="text-white/35">{{ t('memoryWidget.peakGb', { value: exportPeak.toFixed(1) }) }}</span>
          <span class="text-white/25">·</span>
          <span class="text-white/70">{{ t('memoryWidget.cores', { value: usage.export.cores.toFixed(1), total: usage.cores }) }}</span>
        </template>
      </template>
      <span v-else class="text-white/30 italic">…</span>
    </template>
    <template v-else>
      <span class="text-white/50 uppercase tracking-wider text-[9px]">{{ t('memoryWidget.mem') }}</span>
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
    </template>
  </div>
</template>
