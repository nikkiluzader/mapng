<template>
  <div class="fixed inset-0 z-[120] flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm" @click.self="$emit('close')">
    <div class="w-full max-w-md rounded-2xl bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 shadow-2xl overflow-hidden">
      <div class="px-5 py-4 bg-gradient-to-r from-[#FF6600] to-[#f59e0b] text-white">
        <h2 class="text-lg font-bold">{{ t('support.modalTitle') }}</h2>
        <p class="text-xs text-white/90 mt-1">{{ t(contextLabel) }}</p>
      </div>

      <div class="p-5 space-y-4">
        <p class="text-sm text-gray-700 dark:text-gray-300 leading-relaxed">{{ t('support.modalBody') }}</p>
        <p class="text-xs text-gray-500 dark:text-gray-400 leading-relaxed">{{ t('support.modalBodySecondary') }}</p>

        <div class="flex flex-wrap items-center gap-2 pt-1">
          <a
            :href="kofiUrl"
            target="_blank"
            rel="noopener noreferrer"
            class="px-4 py-2 rounded-md bg-[#FF6600] hover:bg-[#e85d00] text-white text-sm font-semibold transition-colors"
          >
            {{ t('support.openKofi') }}
          </a>
          <button
            type="button"
            @click="$emit('close')"
            class="px-4 py-2 rounded-md bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-200 text-sm font-medium transition-colors"
          >
            {{ t('support.notNow') }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';

const props = defineProps({
  context: {
    type: String,
    default: 'manual',
  },
  kofiUrl: {
    type: String,
    default: 'https://ko-fi.com/nikluz',
  },
});

defineEmits(['close']);

const { t } = useI18n({ useScope: 'global' });

const contextLabel = computed(() => {
  if (props.context === 'batch') return 'support.contextBatch';
  if (props.context === 'single') return 'support.contextSingle';
  return 'support.contextGeneral';
});
</script>
