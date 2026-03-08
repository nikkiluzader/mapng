<template>
  <div class="grid grid-cols-2 gap-3">
    <BaseButton
      block
      variant="primary"
      size="lg"
      prominent
      :disabled="isGenerating || (useGPXZ && !gpxzApiKey)"
      @click="$emit('generate', true)"
    >
      <span v-if="isGenerating" class="animate-pulse text-xs">Processing...</span>
      <template v-else-if="isCached">
        <div class="flex items-center gap-2">
          <Mountain :size="16" />
          <span>Preview 3D</span>
        </div>
        <span class="text-[10px] font-normal opacity-90">Using cached data</span>
      </template>
      <template v-else>
        <div class="flex items-center gap-2">
          <Mountain :size="16" />
          <span>Preview 3D</span>
        </div>
        <span class="text-[10px] font-normal opacity-90">{{ hasCustomElevation ? 'Using uploaded TIF' : 'View before download' }}</span>
      </template>
    </BaseButton>

    <BaseButton
      block
      variant="secondary"
      size="lg"
      prominent
      :disabled="isGenerating || isCached || (useGPXZ && !gpxzApiKey)"
      @click="$emit('generate', false)"
    >
      <span v-if="isGenerating" class="animate-pulse text-xs">Processing...</span>
      <template v-else-if="isCached">
        <div class="flex items-center gap-2">
          <CircleCheck :size="16" />
          <span>Data Ready</span>
        </div>
        <span class="text-[10px] font-normal text-emerald-600 dark:text-emerald-400">Download below</span>
      </template>
      <template v-else>
        <div class="flex items-center gap-2">
          <FileDown :size="16" />
          <span>Generate Data</span>
        </div>
        <span class="text-[10px] font-normal text-gray-500 dark:text-gray-400">Skip 3D view, get files</span>
      </template>
    </BaseButton>
  </div>
</template>

<script setup>
import BaseButton from '../base/BaseButton.vue';
import { Mountain, CircleCheck, FileDown } from 'lucide-vue-next';

defineProps({
  isGenerating: { type: Boolean, default: false },
  isCached: { type: Boolean, default: false },
  useGPXZ: { type: Boolean, default: false },
  gpxzApiKey: { type: String, default: '' },
  hasCustomElevation: { type: Boolean, default: false },
});

defineEmits(['generate']);
</script>
