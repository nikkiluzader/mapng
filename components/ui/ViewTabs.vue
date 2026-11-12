<template>
  <div class="absolute top-4 right-4 z-20 flex items-center gap-1.5 bg-white/95 dark:bg-gray-800/95 backdrop-blur rounded-2xl p-1.5 shadow-lg border border-gray-200/80 dark:border-gray-700">
    <!-- where the map data comes from: what the last Generate used, or what the next will ask first -->
    <span
      data-testid="osm-source"
      class="flex items-center gap-1 h-8 px-2 rounded-lg text-xs whitespace-nowrap"
      :class="osmSource.warn ? 'text-amber-700 dark:text-amber-300' : 'text-gray-600 dark:text-gray-300'"
      :title="osmSource.hint"
    >
      <component :is="osmSource.warn ? Info : Database" :size="14" />
      {{ osmSource.label }}
    </span>
    <BaseButton
      v-for="tab in TABS" :key="tab.id"
      size="sm"
      variant="ghost"
      class="view-tab"
      :class="viewMode === tab.id ? 'view-tab--active' : 'view-tab--inactive'"
      :disabled="tab.needsData && !canPreview"
      :title="tab.needsData && !canPreview ? t('view.needsData') : ''"
      :aria-pressed="viewMode === tab.id"
      @click="$emit('switch', tab.id)"
    >
      <component :is="tab.icon" :size="16" />
      {{ t(tab.label) }}
    </BaseButton>
  </div>
</template>

<style scoped>
.view-tab {
  @apply flex items-center gap-2 rounded-lg px-3 py-2 transition-all duration-150;
}

.view-tab--active {
  @apply bg-gray-900 dark:bg-gray-700 text-white shadow-sm;
}

.view-tab--inactive {
  @apply text-gray-600 dark:text-gray-300;
}

.view-tab:disabled {
  @apply opacity-50 cursor-not-allowed;
}

.view-tab--active:hover {
  @apply bg-gray-900 dark:bg-gray-700 text-white;
}

.view-tab--inactive:hover {
  @apply bg-transparent text-gray-800 dark:text-white;
}
</style>

<script setup>
import { useI18n } from 'vue-i18n';
import BaseButton from '../base/BaseButton.vue';
import { computed } from 'vue';
import { storeToRefs } from 'pinia';
import { Globe, Layers, Info, Database, Map as MapIcon } from 'lucide-vue-next';
import { useOverpassStatus } from '../../composables/useOverpassStatus.js';
import { useOsmSource } from '../../composables/useOsmSource.js';
import { useMainStore } from '../../stores/mainStore';

const { t } = useI18n({ useScope: 'global' });
const { down: osmDown } = useOverpassStatus();
const { tilesFirst } = useOsmSource();
const { terrainData } = storeToRefs(useMainStore());
// The map data's source, in a few words. With a terrain: what its data pull used. Without:
// what the next one asks first (the Map data setting), and whether the live servers answer.
const osmSource = computed(() => {
  const info = terrainData.value?.osmRequestInfo;
  const used = String(info?.endpointUsed || '');
  if (used.includes('mapng-osm-tiles')) return { label: t('view.sourceTiles'), hint: info.osmSnapshot ? t('view.sourceTilesUsedHint', { date: info.osmSnapshot }) : t('view.sourceTilesHint') };
  if (used.includes('overture-maps')) return { label: t('view.sourceBackup'), hint: t('view.sourceBackupHint'), warn: true };
  if (used.includes('osm-file')) return { label: t('view.sourceFile'), hint: t('view.sourceFileHint') };
  if (used) return { label: t('view.sourceLive'), hint: t('view.sourceLiveUsedHint') };
  if (tilesFirst.value) return { label: t('view.sourceTiles'), hint: t('view.sourceTilesHint') };
  if (osmDown.value) return { label: t('view.sourceLiveDown'), hint: t('view.sourceLiveDownHint'), warn: true };
  return { label: t('view.sourceLive'), hint: t('view.sourceLiveHint') };
});

// Location: the world map, where the area is chosen. The two previews show the
// generated area: flat with what will be built, and in 3D.
const TABS = [
  { id: 'location', label: 'view.location', icon: Globe },
  { id: 'preview2d', label: 'view.preview2d', icon: MapIcon, needsData: true },
  { id: 'preview3d', label: 'view.preview3d', icon: Layers, needsData: true },
];

defineProps({
  viewMode: { type: String, default: 'location' },
  canPreview: { type: Boolean, default: false },
});

defineEmits(['switch']);
</script>
