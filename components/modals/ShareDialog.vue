<template>
  <!-- Share & load settings: a short code, someone else's code, the long code
       and files. Opened from the share icon in the sidebar's top bar; the
       panel that is showing puts its own controls inside. -->
  <Teleport to="body">
    <div
      v-if="shareDialogOpen"
      class="fixed inset-0 z-[10001] flex items-center justify-center bg-black/50 backdrop-blur-sm"
      @click.self="closeShareDialog"
      @keydown.esc="closeShareDialog"
    >
      <div ref="panel" tabindex="-1" class="bg-white dark:bg-gray-900 rounded-2xl shadow-2xl border border-gray-200 dark:border-gray-700 w-[calc(100vw-2rem)] max-w-md max-h-[calc(100vh-2rem)] flex flex-col overflow-hidden outline-none" role="dialog" aria-modal="true" :aria-label="t('config.shareDialogTitle')">
        <div class="px-5 py-3.5 bg-gradient-to-r from-brand to-amber-500 text-white flex items-center gap-2">
          <Share2 :size="17" class="shrink-0" />
          <h2 class="text-base font-bold">{{ t('config.shareDialogTitle') }}</h2>
          <button type="button" class="ml-auto p-1 rounded-full hover:bg-white/20" :title="t('common.close')" :aria-label="t('common.close')" @click="closeShareDialog">
            <X :size="17" />
          </button>
        </div>
        <div class="p-5 overflow-y-auto">
          <slot />
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup>
import { nextTick, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { Share2, X } from 'lucide-vue-next';
import { shareDialogOpen, closeShareDialog } from '../../composables/useShareDialog.js';

const { t } = useI18n({ useScope: 'global' });
const panel = ref(null);
// (focus inside, so Esc closes it straight away)
watch(shareDialogOpen, async (open) => { if (open) { await nextTick(); panel.value?.focus(); } });
</script>
