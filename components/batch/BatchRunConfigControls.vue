<template>
  <div class="space-y-2">
    <div class="grid grid-cols-2 gap-2">
      <BaseButton size="sm" variant="secondary" @click="$emit('copy')">{{ t('batch.copyConfig') }}</BaseButton>
      <BaseButton size="sm" variant="secondary" @click="$emit('paste')">{{ t('batch.pasteConfig') }}</BaseButton>
      <BaseButton size="sm" variant="secondary" @click="$emit('save')">{{ t('batch.saveConfig') }}</BaseButton>
      <BaseButton size="sm" variant="secondary" @click="triggerLoad">{{ t('batch.loadConfig') }}</BaseButton>
      <input ref="fileInput" type="file" accept="application/json,.json" class="hidden" @change="handleFile" />
    </div>
    <p v-if="status" class="text-micro text-gray-500 dark:text-gray-400">{{ status }}</p>
  </div>
</template>

<script setup>
import { ref } from 'vue';
import { useI18n } from 'vue-i18n';
import BaseButton from '../base/BaseButton.vue';

const { t } = useI18n({ useScope: 'global' });

const props = defineProps({
  status: { type: String, default: '' },
});

const emit = defineEmits(['copy', 'paste', 'save', 'load']);

const fileInput = ref(null);
const triggerLoad = () => fileInput.value?.click();
const handleFile = (event) => {
  const file = event.target.files?.[0];
  if (!file) return;
  emit('load', file);
  event.target.value = '';
};
</script>
