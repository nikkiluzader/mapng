<template>
  <!-- Expand all / Collapse all: the same two quiet buttons wherever a list of
       collapsible sections has them (each wizard step, What to build). -->
  <div class="flex items-center justify-end gap-3 text-caption text-gray-500 dark:text-gray-400">
    <button type="button" class="inline-flex items-center gap-1 hover:text-brand transition-colors disabled:opacity-40 disabled:hover:text-gray-500" :disabled="disabled" @click="$emit('set', true)">
      <ChevronsUpDown :size="12" />{{ t('sections.expandAll') }}
    </button>
    <button type="button" class="inline-flex items-center gap-1 hover:text-brand transition-colors disabled:opacity-40 disabled:hover:text-gray-500" :disabled="disabled" @click="$emit('set', false)">
      <ChevronsDownUp :size="12" />{{ t('sections.collapseAll') }}
    </button>
  </div>
</template>

<script setup>
import { useI18n } from 'vue-i18n';
import { ChevronsUpDown, ChevronsDownUp } from 'lucide-vue-next';

defineProps({ disabled: { type: Boolean, default: false } });
// set(open): true to expand everything, false to collapse it
defineEmits(['set']);
const { t } = useI18n({ useScope: 'global' });
</script>
