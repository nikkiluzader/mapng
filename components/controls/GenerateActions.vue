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
      <span v-if="isGenerating" class="animate-pulse text-xs">{{ t('generateActions.processing') }}</span>
      <template v-else-if="isCached">
        <div class="flex items-center gap-2">
          <Mountain :size="16" />
          <span>{{ t('generateActions.preview3d') }}</span>
        </div>
        <span class="text-[10px] font-normal opacity-90">{{ t('generateActions.usingCachedData') }}</span>
      </template>
      <template v-else>
        <div class="flex items-center gap-2">
          <Mountain :size="16" />
          <span>{{ t('generateActions.preview3d') }}</span>
        </div>
        <span class="text-[10px] font-normal opacity-90">{{ hasCustomElevation ? t('generateActions.usingUploadedElevation') : t('generateActions.viewBeforeDownload') }}</span>
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
      <span v-if="isGenerating" class="animate-pulse text-xs">{{ t('generateActions.processing') }}</span>
      <template v-else-if="isCached">
        <div class="flex items-center gap-2">
          <CircleCheck :size="16" />
          <span>{{ t('generateActions.dataReady') }}</span>
        </div>
        <span class="text-[10px] font-normal text-emerald-600 dark:text-emerald-400">{{ t('generateActions.downloadBelow') }}</span>
      </template>
      <template v-else>
        <div class="flex items-center gap-2">
          <FileDown :size="16" />
          <span>{{ t('generateActions.generateData') }}</span>
        </div>
        <span class="text-[10px] font-normal text-gray-500 dark:text-gray-400">{{ t('generateActions.skip3dGetFiles') }}</span>
      </template>
    </BaseButton>
  </div>
</template>

<script setup>
import { useI18n } from 'vue-i18n';
import BaseButton from '../base/BaseButton.vue';
import { Mountain, CircleCheck, FileDown } from 'lucide-vue-next';

const { t } = useI18n({ useScope: 'global' });

defineProps({
  isGenerating: { type: Boolean, default: false },
  isCached: { type: Boolean, default: false },
  useGPXZ: { type: Boolean, default: false },
  gpxzApiKey: { type: String, default: '' },
  hasCustomElevation: { type: Boolean, default: false },
});

defineEmits(['generate']);
</script>
