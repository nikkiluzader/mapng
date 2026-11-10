<template>
  <!-- One button. Not generated yet: Generate (the terrain and the map data,
       then the 2D preview opens). Generated: on to Export. -->
  <BaseButton
    block
    variant="primary"
    size="lg"
    prominent
    :disabled="isGenerating || (useGPXZ && !gpxzApiKey)"
    @click="isCached ? $emit('ready') : $emit('generate', false)"
  >
    <span v-if="isGenerating" class="animate-pulse text-xs">{{ t('generateActions.processing') }}</span>
    <template v-else-if="isCached">
      <div class="flex items-center gap-2">
        <CircleCheck :size="16" />
        <span>{{ t('generateActions.dataReady') }}</span>
      </div>
      <span class="text-micro font-normal opacity-90">{{ t('generateActions.downloadBelow') }}</span>
    </template>
    <template v-else>
      <div class="flex items-center gap-2">
        <Mountain :size="16" />
        <span>{{ t('generateActions.generate') }}</span>
      </div>
      <span class="text-micro font-normal opacity-90">{{ hasCustomElevation ? t('generateActions.usingUploadedElevation') : t('generateActions.generateHint') }}</span>
    </template>
  </BaseButton>
</template>

<script setup>
import { useI18n } from 'vue-i18n';
import BaseButton from '../base/BaseButton.vue';
import { Mountain, CircleCheck } from 'lucide-vue-next';

const { t } = useI18n({ useScope: 'global' });

defineProps({
  isGenerating: { type: Boolean, default: false },
  isCached: { type: Boolean, default: false },
  useGPXZ: { type: Boolean, default: false },
  gpxzApiKey: { type: String, default: '' },
  hasCustomElevation: { type: Boolean, default: false },
});

// ready: the data is made already (the wizard goes to Export)
defineEmits(['generate', 'ready']);
</script>
