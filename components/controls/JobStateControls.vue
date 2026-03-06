<template>
  <div class="space-y-3">
    <label class="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider flex items-center gap-2">
      <Database :size="14" />
      Session Data
    </label>
    <div class="grid grid-cols-2 gap-2">
      <BaseButton size="sm" variant="secondary" :disabled="isImporting || isGenerating" @click="triggerImport">
        <Import v-if="!isImporting" :size="14" />
        <Loader2 v-else :size="14" class="animate-spin" />
        Import Job
      </BaseButton>
      <BaseButton
        v-if="hasTerrainData"
        size="sm"
        variant="primary"
        :disabled="isExporting || isGenerating"
        @click="$emit('export')"
      >
        <Package v-if="!isExporting" :size="14" />
        <Loader2 v-else :size="14" class="animate-spin" />
        Export Job
      </BaseButton>
      <input ref="fileInput" type="file" accept=".mapng" class="hidden" @change="handleFile" />
    </div>
    <p v-if="status" class="text-[10px] text-gray-500 dark:text-gray-400 text-center">{{ status }}</p>
  </div>
</template>

<script setup>
import { ref } from 'vue';
import BaseButton from '../base/BaseButton.vue';
import { Database, Import, Loader2, Package } from 'lucide-vue-next';

defineProps({
  hasTerrainData: { type: Boolean, default: false },
  isGenerating: { type: Boolean, default: false },
  isExporting: { type: Boolean, default: false },
  isImporting: { type: Boolean, default: false },
  status: { type: String, default: '' },
});

const emit = defineEmits(['import-file', 'export']);

const fileInput = ref(null);
const triggerImport = () => fileInput.value?.click();
const handleFile = (event) => {
  const file = event.target.files?.[0];
  if (!file) return;
  emit('import-file', file);
  event.target.value = '';
};
</script>
