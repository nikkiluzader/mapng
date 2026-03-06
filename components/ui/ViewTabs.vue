<template>
  <div class="absolute top-4 right-4 z-20 flex items-center gap-1.5 bg-white/95 dark:bg-gray-800/95 backdrop-blur rounded-2xl p-1.5 shadow-lg border border-gray-200/80 dark:border-gray-700">
    <BaseButton
      size="sm"
      variant="ghost"
      class="view-tab"
      :class="!previewMode ? 'view-tab--active' : 'view-tab--inactive'"
      @click="$emit('switch-2d')"
    >
      <Globe :size="16" />
      2D Map
    </BaseButton>
    <BaseButton
      size="sm"
      variant="ghost"
      class="view-tab"
      :class="previewMode ? 'view-tab--active' : 'view-tab--inactive'"
      :disabled="!canPreview"
      @click="$emit('switch-3d')"
    >
      <Layers :size="16" />
      3D Preview
    </BaseButton>
  </div>
</template>

<style scoped>
.view-tab {
  @apply flex items-center gap-2 rounded-lg px-3 py-2 transition-all duration-150;
}

.view-tab--active {
  @apply bg-[#1d2d44] text-white shadow-sm;
}

.view-tab--inactive {
  @apply text-gray-600 dark:text-gray-300;
}

.view-tab:disabled {
  @apply opacity-50 cursor-not-allowed;
}

.view-tab--active:hover {
  @apply bg-[#1d2d44] text-white;
}

.view-tab--inactive:hover {
  @apply bg-transparent text-gray-800 dark:text-white;
}
</style>

<script setup>
import BaseButton from '../base/BaseButton.vue';
import { Globe, Layers } from 'lucide-vue-next';

defineProps({
  previewMode: { type: Boolean, default: false },
  canPreview: { type: Boolean, default: false },
});

defineEmits(['switch-2d', 'switch-3d']);
</script>
