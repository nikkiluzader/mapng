<template>
  <div class="absolute top-4 right-4 z-20 flex items-center gap-1.5 bg-white/95 dark:bg-gray-800/95 backdrop-blur rounded-2xl p-1.5 shadow-lg border border-gray-200/80 dark:border-gray-700">
    <button
      v-if="osmDown && osmDismissed"
      type="button"
      class="flex items-center gap-1 h-8 px-2 rounded-lg text-xs text-amber-700 dark:text-amber-300 hover:bg-amber-100 dark:hover:bg-amber-900/50"
      :title="t('overpassStatus.reopen')"
      :aria-label="t('overpassStatus.reopen')"
      @click="osmDismissed = false"
    >
      <Info :size="14" />
      {{ t('overpassStatus.chip') }}
    </button>
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
import { Globe, Layers, Info, Map as MapIcon } from 'lucide-vue-next';
import { useOverpassStatus } from '../../composables/useOverpassStatus.js';

const { t } = useI18n({ useScope: 'global' });
const { down: osmDown, dismissed: osmDismissed } = useOverpassStatus();

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
