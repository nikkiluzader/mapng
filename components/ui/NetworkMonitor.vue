<!-- The live Network activity panel, docked at the map's lower left: every address the app has connected to, as it
     happens (composables/useNetworkMonitor.js). Opened from the sidebar's foot; stays open until closed. -->
<template>
  <section
    v-if="netPanelOpen" data-testid="net-panel" :aria-label="t('net.panelTitle')"
    class="absolute left-3 bottom-9 z-30 pointer-events-auto w-[min(24rem,calc(100%-1.5rem))] max-h-[min(55vh,26rem)] flex flex-col rounded-lg border border-gray-200 dark:border-gray-700 bg-white/95 dark:bg-gray-900/95 backdrop-blur shadow-xl text-gray-800 dark:text-gray-100"
  >
    <header class="flex items-center gap-2 px-3 py-2 border-b border-gray-200 dark:border-gray-700">
      <Activity :size="14" class="text-brand shrink-0" />
      <h3 class="font-display text-xs font-bold">{{ t('net.panelTitle') }}</h3>
      <span class="flex items-center gap-1 text-micro font-semibold uppercase tracking-wider text-emerald-600 dark:text-emerald-400">
        <span class="inline-block w-1.5 h-1.5 rounded-full bg-emerald-500" :class="busy ? 'animate-ping' : ''"></span>{{ t('net.live') }}
      </span>
      <span class="ml-auto text-micro tabular-nums text-gray-500 dark:text-gray-400" data-testid="net-total">{{ total }} {{ t('net.requests').toLowerCase() }}</span>
      <button type="button" class="text-micro text-brand hover:underline" data-testid="net-clear" @click="clearNet">{{ t('net.clear') }}</button>
      <button type="button" class="p-0.5 rounded text-gray-400 hover:text-brand" :aria-label="t('net.close')" :title="t('net.close')" data-testid="net-close" @click="netPanelOpen = false"><X :size="14" /></button>
    </header>
    <div class="overflow-y-auto">
      <p v-if="!rows.length" class="px-3 py-3 text-caption text-gray-500 dark:text-gray-400">{{ t('net.none') }}</p>
      <table v-else class="w-full text-caption">
        <thead class="sticky top-0 bg-white dark:bg-gray-900 text-micro uppercase tracking-wider text-gray-400 dark:text-gray-500">
          <tr><th class="text-left font-semibold px-3 py-1">{{ t('net.address') }}</th><th class="text-right font-semibold px-2 py-1">{{ t('net.requests') }}</th><th v-if="showBytes" class="text-right font-semibold px-3 py-1">{{ t('net.data') }}</th></tr>
        </thead>
        <tbody>
          <tr v-for="r in rows" :key="r.host" class="border-t border-gray-100 dark:border-gray-800 align-top" :data-net-host="r.host" :class="now - r.last < 2500 ? 'bg-emerald-50/70 dark:bg-emerald-900/15' : ''">
            <td class="px-3 py-1 min-w-0">
              <div class="font-mono text-micro [overflow-wrap:anywhere]" :class="r.listed ? '' : 'text-amber-700 dark:text-amber-300'">{{ r.host }}</div>
              <div class="text-micro leading-snug" :class="r.listed ? 'text-gray-500 dark:text-gray-400' : 'text-amber-700 dark:text-amber-300'">{{ r.listed && r.kind ? t(`net.kinds.${r.kind}`) : t('net.notListed') }}</div>
            </td>
            <td class="px-2 py-1 text-right tabular-nums whitespace-nowrap">{{ r.count }}<span v-if="r.failed" class="text-amber-600 dark:text-amber-400"> ({{ r.failed }} {{ t('net.failed') }})</span><span v-if="r.blocked" class="text-red-600 dark:text-red-400"> ({{ r.blocked }} {{ t('net.refused') }})</span></td>
            <td v-if="showBytes" class="px-3 py-1 text-right tabular-nums whitespace-nowrap text-gray-500 dark:text-gray-400">{{ r.bytes ? size(r.bytes) : '' }}</td>
          </tr>
        </tbody>
      </table>
    </div>
    <footer class="px-3 py-1.5 border-t border-gray-200 dark:border-gray-700 text-micro leading-snug text-gray-500 dark:text-gray-400">
      {{ fromApp ? t('net.sinceApp') : t('net.since') }} {{ t('net.noteNothing') }}
      <a href="/data.html#addresses" target="_blank" rel="noopener" class="text-brand hover:underline">{{ t('net.listLink') }}</a>
    </footer>
  </section>
</template>

<script setup>
import { computed, onMounted, onUnmounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { Activity, X } from 'lucide-vue-next';
import { netPanelOpen, netRows, netTotal, netTick, clearNet, netFromApp, startNetworkMonitor } from '../../composables/useNetworkMonitor.js';

const { t } = useI18n();
const fromApp = netFromApp();
const showBytes = !fromApp;
const now = ref(Date.now());
let clock = null;
onMounted(() => { startNetworkMonitor(); clock = setInterval(() => { now.value = Date.now(); }, 1000); });
onUnmounted(() => clearInterval(clock));
const rows = computed(() => { netTick.value; return netRows(); });
const total = computed(() => { netTick.value; return netTotal(); });
const busy = computed(() => rows.value.some((r) => now.value - r.last < 2500));
const size = (b) => (b >= 1048576 ? `${(b / 1048576).toFixed(1)} MB` : b >= 1024 ? `${Math.round(b / 1024)} KB` : `${b} B`);
</script>
