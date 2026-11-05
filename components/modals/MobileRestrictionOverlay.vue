<template>
  <div class="flex md:hidden fixed inset-0 z-[999] bg-white dark:bg-gray-900 flex-col items-center justify-center p-8 text-center text-gray-900 dark:text-white">
    <div class="bg-gray-50 dark:bg-gray-800 p-6 rounded-2xl border border-gray-200 dark:border-gray-700 shadow-2xl max-w-sm flex flex-col items-center">
      <div class="p-4 bg-brand/10 rounded-full mb-6">
        <Monitor :size="48" class="text-brand" />
      </div>
      <h1 class="text-2xl font-bold text-gray-900 dark:text-white mb-2">{{ t('mobile.desktopRequired') }}</h1>
      <p class="text-gray-600 dark:text-gray-300 text-sm leading-relaxed mb-6">
        {{ t('mobile.description') }}
      </p>
      <p class="text-gray-500 dark:text-gray-400 text-xs mb-6">
        {{ t('mobile.details') }}
      </p>
      <div class="flex items-center gap-2 text-xs font-medium text-brand bg-brand/10 px-4 py-2 rounded-full border border-brand/20">
        <MousePointer2 :size="12" />
        <span>{{ t('mobile.inputHint') }}</span>
      </div>
    </div>
  </div>
</template>

<script setup>
import { useI18n } from 'vue-i18n';
import { Monitor, MousePointer2 } from 'lucide-vue-next';

const { t } = useI18n({ useScope: 'global' });
</script>
