<template>
  <!-- What sharing export areas sends, where it is kept, and what it is used for
       (composables/useExportHotspots.js; worker side: hotspotsObject.js) -->
  <Teleport to="body">
    <div v-if="privacyOpen" class="fixed inset-0 z-[10001] flex items-center justify-center bg-black/60 backdrop-blur-sm" @click.self="privacyOpen = false">
      <div class="bg-white dark:bg-gray-900 rounded-xl shadow-2xl border border-gray-200 dark:border-gray-700 w-[calc(100vw-2rem)] max-w-lg max-h-[calc(100vh-2rem)] flex flex-col overflow-hidden" role="dialog" aria-modal="true" :aria-label="t('hotspots.privacy.title')">
        <div class="px-6 py-4 bg-gradient-to-r from-[#FF6600] to-[#f59e0b] text-white flex items-center gap-2">
          <ShieldCheck :size="18" class="shrink-0" />
          <h2 class="text-base font-bold">{{ t('hotspots.privacy.title') }}</h2>
        </div>

        <div class="p-6 space-y-3 overflow-y-auto text-[11px] leading-relaxed text-gray-600 dark:text-gray-300">
          <p class="text-gray-800 dark:text-gray-100">{{ t('hotspots.privacy.intro') }}</p>
          <section v-for="part in PARTS" :key="part">
            <h3 class="text-[11px] font-semibold text-gray-800 dark:text-gray-100">{{ t(`hotspots.privacy.${part}Title`) }}</h3>
            <p>{{ t(`hotspots.privacy.${part}`) }}</p>
          </section>
          <a :href="DATA_PAGE" target="_blank" rel="noopener" class="inline-flex items-center gap-1 font-medium text-[#FF6600] hover:underline">
            {{ t('hotspots.privacy.readMore') }}<ExternalLink :size="11" />
          </a>
        </div>

        <div class="px-6 py-3 border-t border-gray-200 dark:border-gray-700 flex items-center justify-between gap-3">
          <span class="text-[10px] text-gray-500 dark:text-gray-400">
            {{ share === 'on' ? t('hotspots.privacy.statusOn') : t('hotspots.privacy.statusOff') }}
          </span>
          <button type="button" class="px-4 py-1.5 rounded bg-[#FF6600] hover:bg-[#e85d00] text-white text-[12px] font-semibold transition-colors" @click="privacyOpen = false">
            {{ t('hotspots.privacy.close') }}
          </button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup>
import { onMounted, onUnmounted } from 'vue';
import { useI18n } from 'vue-i18n';
import { ExternalLink, ShieldCheck } from 'lucide-vue-next';
import { desktopApp } from '../../services/platform/desktop.js';
import { useExportHotspots } from '../../composables/useExportHotspots.js';

// (the page about the data, public/data.html: the desktop app opens it in the browser)
const DATA_PAGE = desktopApp ? 'https://mapng.com/data.html' : '/data.html';
const PARTS = ['sent', 'notSent', 'where', 'how', 'use', 'never', 'control'];
const { t } = useI18n();
const { privacyOpen, share } = useExportHotspots();

const onKey = (event) => { if (event.key === 'Escape') privacyOpen.value = false; };
onMounted(() => window.addEventListener('keydown', onKey));
onUnmounted(() => window.removeEventListener('keydown', onKey));
</script>
