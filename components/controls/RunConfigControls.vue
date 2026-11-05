<template>
  <div class="grid grid-cols-2 gap-2">
    <BaseButton size="sm" variant="secondary" @click="$emit('copy')">{{ t('batch.copyConfig') }}</BaseButton>
    <BaseButton size="sm" variant="secondary" @click="$emit('paste')">{{ t('batch.pasteConfig') }}</BaseButton>
    <BaseButton size="sm" variant="secondary" @click="$emit('save')">{{ t('batch.saveConfig') }}</BaseButton>
    <BaseButton size="sm" variant="secondary" @click="triggerLoad">{{ t('batch.loadConfig') }}</BaseButton>
    <input ref="fileInput" type="file" accept="application/json,.json" class="hidden" @change="handleFile" />
  </div>
  <p v-if="status" class="text-[10px] text-gray-500 dark:text-gray-400">{{ status }}</p>

  <!-- Send with a short code (mapng.com keeps it 24 hours), or open one -->
  <div v-if="sendable" class="space-y-1.5 pt-1">
    <BaseButton size="sm" variant="secondary" class="w-full" :disabled="sending" @click="$emit('send')">{{ t('config.send') }}</BaseButton>
    <div>
      <form class="flex gap-1" @submit.prevent="openCode">
        <input v-model="codeInput" type="text" maxlength="40" :placeholder="t('config.codePlaceholder')" class="min-w-0 flex-1 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-2 py-1 text-[11px] uppercase placeholder:normal-case focus:outline-none focus:ring-1 focus:ring-[#FF6600]" />
        <BaseButton size="sm" variant="secondary" type="submit" :disabled="!codeInput.trim()">{{ t('config.open') }}</BaseButton>
      </form>
    </div>
    <div v-if="sent" class="rounded border border-[#FF6600]/40 bg-orange-50 dark:bg-orange-900/10 p-2 text-[11px] text-gray-700 dark:text-gray-200 space-y-1">
      <div class="flex items-center gap-2">
        <code class="text-[14px] font-semibold tracking-wider">{{ sent.id }}</code>
        <button type="button" class="text-[10px] text-[#FF6600] hover:underline" @click="copy(sent.id, 'id')">{{ copied === 'id' ? t('config.copiedShort') : t('config.copyCode') }}</button>
        <button type="button" class="text-[10px] text-[#FF6600] hover:underline" @click="copy(sent.link, 'link')">{{ copied === 'link' ? t('config.copiedShort') : t('config.copyLink') }}</button>
      </div>
      <p class="text-[10px] text-gray-500 dark:text-gray-400">{{ t('config.sentHint') }}</p>
    </div>
  </div>
</template>

<script setup>
import { ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import BaseButton from '../base/BaseButton.vue';

const { t } = useI18n({ useScope: 'global' });

const props = defineProps({
  status: { type: String, default: '' },
  sendable: { type: Boolean, default: false },
  sending: { type: Boolean, default: false },
  sent: { type: Object, default: null },      // { id, link }
});

const emit = defineEmits(['copy', 'paste', 'save', 'load', 'send', 'open-code']);

const fileInput = ref(null);
const codeInput = ref('');
const copied = ref('');
watch(() => props.sent, () => { copied.value = ''; });
const triggerLoad = () => fileInput.value?.click();
const handleFile = (event) => {
  const file = event.target.files?.[0];
  if (!file) return;
  emit('load', file);
  event.target.value = '';
};
const openCode = () => { emit('open-code', codeInput.value.trim()); codeInput.value = ''; };
const copy = async (text, which) => {
  try { await navigator.clipboard.writeText(text); copied.value = which; } catch { /* clipboard blocked */ }
};
</script>
