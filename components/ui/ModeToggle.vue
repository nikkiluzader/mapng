<template>
  <div class="flex p-2 border-b border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 gap-1">
    <BaseButton
      block
      variant="ghost"
      :class="[tabBase, !batchMode ? tabSingleActive : tabInactive]"
      @click="$emit('set-batch-mode', false)"
    >
      <Map :size="12" />
      {{ t('mode.singleTile') }}
    </BaseButton>
    <BaseButton
      block
      variant="ghost"
      :class="[tabBase, batchMode ? tabBatchActive : tabInactive]"
      @click="$emit('set-batch-mode', true)"
    >
      <Grid3X3 :size="12" />
      {{ t('mode.batchJob') }}
    </BaseButton>
  </div>
</template>

<script setup>
import { useI18n } from 'vue-i18n';
import BaseButton from '../base/BaseButton.vue';
import { Grid3X3, Map } from 'lucide-vue-next';

const { t } = useI18n({ useScope: 'global' });

const tabBase = 'flex-1 py-1.5 px-3 text-xs font-medium rounded-lg flex items-center justify-center gap-1.5 transition-all';
const tabInactive = 'text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white hover:bg-gray-100 dark:hover:bg-gray-800';
// (one look for the active tab, in light and dark mode)
const tabActive = '!bg-gray-900 dark:!bg-gray-700 !text-white shadow-sm';
const tabSingleActive = tabActive;
const tabBatchActive = tabActive;

defineProps({
  batchMode: { type: Boolean, default: false },
});

defineEmits(['set-batch-mode']);
</script>
