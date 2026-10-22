<template>
  <!-- An overlay, not part of the layout: pushing the page down resized the
       map under Leaflet and moved its centre off the selection. Centred so it
       clears the view tabs (top right). -->
  <div
    v-if="down && !dismissed"
    role="alert"
    class="fixed top-2 left-1/2 -translate-x-1/2 z-[1100] w-[min(44rem,calc(100%-2rem))] flex items-center gap-2 px-4 py-2 rounded-lg shadow-lg bg-amber-100 dark:bg-amber-900 border border-amber-300 dark:border-amber-700 text-amber-900 dark:text-amber-100 text-xs"
  >
    <AlertTriangle :size="16" class="shrink-0" />
    <p class="flex-1 leading-snug">
      <strong>{{ t('overpassStatus.title') }}</strong>
      {{ t('overpassStatus.body') }}
    </p>
    <button
      type="button"
      class="shrink-0 p-1 rounded hover:bg-amber-200 dark:hover:bg-amber-800"
      :aria-label="t('overpassStatus.dismiss')"
      :title="t('overpassStatus.dismiss')"
      @click="dismissed = true"
    >
      <X :size="14" />
    </button>
  </div>
</template>

<script setup>
import { useI18n } from 'vue-i18n';
import { AlertTriangle, X } from 'lucide-vue-next';
import { useOverpassStatus } from '../../composables/useOverpassStatus.js';

const { t } = useI18n();
const { down, dismissed } = useOverpassStatus();
</script>
