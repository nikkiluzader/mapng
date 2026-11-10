<template>
  <!-- The map just generated was built from Overture, the backup (services/osm.js: no MapNG tiles
       for the area, no Overpass server answering). Said once per Generate, where it matters: on
       the result, not as a standing alarm (OverpassStatusBanner stays a chip). An overlay over the
       foot of the map (clear of the previews' panels top left, the view tabs top right and the
       memory readout under it), not part of the layout. -->
  <div
    v-if="shown"
    role="status"
    class="fixed bottom-16 left-[calc(50%+12rem)] -translate-x-1/2 z-[95] w-[min(40rem,calc(100%-27rem))] flex items-start gap-2 px-4 py-2.5 rounded-lg shadow-lg bg-amber-100 dark:bg-amber-900 border border-amber-300 dark:border-amber-700 text-amber-900 dark:text-amber-100 text-xs"
  >
    <AlertTriangle :size="16" class="shrink-0 mt-0.5" />
    <p class="flex-1 leading-snug">
      <strong>{{ t('backupData.title') }}</strong>
      {{ t('backupData.body') }}
    </p>
    <button
      type="button"
      class="shrink-0 p-1 rounded hover:bg-amber-200 dark:hover:bg-amber-800"
      :aria-label="t('backupData.dismiss')"
      :title="t('backupData.dismiss')"
      @click="dismissedFor = stamp"
    >
      <X :size="14" />
    </button>
  </div>
</template>

<script setup>
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { storeToRefs } from 'pinia';
import { AlertTriangle, X } from 'lucide-vue-next';
import { useMainStore } from '../../stores/mainStore';

const { t } = useI18n();
const { terrainData } = storeToRefs(useMainStore());
// (one notice per data pull: closing it lasts until the next Generate)
const dismissedFor = ref(null);
const info = computed(() => terrainData.value?.osmRequestInfo || null);
const stamp = computed(() => info.value?.completedAt || info.value?.startedAt || 'this');
const shown = computed(() => String(info.value?.endpointUsed || '').includes('overture-maps') && dismissedFor.value !== stamp.value);
</script>
