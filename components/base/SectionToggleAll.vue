<template>
  <!-- Expand all / Collapse all for the panel's sections (composables/useSectionGroup.js) -->
  <div v-if="group" class="flex justify-end gap-3 -mb-2">
    <button type="button" class="flex items-center gap-1 text-caption text-gray-500 dark:text-gray-400 hover:text-brand transition-colors" @click="group.setAll(true)">
      <ChevronsUpDown :size="12" />{{ t('controlPanel.expandAll') }}
    </button>
    <button type="button" class="flex items-center gap-1 text-caption text-gray-500 dark:text-gray-400 hover:text-brand transition-colors" @click="group.setAll(false)">
      <ChevronsDownUp :size="12" />{{ t('controlPanel.collapseAll') }}
    </button>
  </div>
</template>

<script setup>
import { useI18n } from 'vue-i18n';
import { ChevronsDownUp, ChevronsUpDown } from 'lucide-vue-next';
import { useSectionGroup } from '../../composables/useSectionGroup.js';

const { t } = useI18n({ useScope: 'global' });
const group = useSectionGroup();
</script>
