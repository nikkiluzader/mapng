<template>
  <div class="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm" @click.self="$emit('close')">
    <div class="bg-white dark:bg-gray-900 rounded-2xl shadow-2xl border border-gray-200 dark:border-gray-700 w-full max-w-md max-h-[90vh] overflow-hidden flex flex-col animate-in zoom-in-95 duration-200">
      <div class="p-6 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between bg-gray-50 dark:bg-gray-800">
        <div class="flex items-center gap-3">
          <div class="p-2 bg-amber-100 dark:bg-amber-900/30 rounded-lg">
            <AlertTriangle :size="20" class="text-amber-600 dark:text-amber-500" />
          </div>
          <h2 class="text-base font-bold text-gray-900 dark:text-white">{{ t('disclaimer.title') }}</h2>
        </div>
        <button @click="$emit('close')" class="text-gray-400 dark:text-gray-500 hover:text-gray-900 dark:hover:text-white transition-colors">
          <X :size="20" />
        </button>
      </div>
      
      <div class="p-6 space-y-4 text-sm text-gray-600 dark:text-gray-300 leading-relaxed overflow-y-auto">
        <p>
          {{ t('disclaimer.lead') }}
        </p>
        
        <div class="bg-amber-50 dark:bg-amber-900/20 border border-amber-100 dark:border-amber-900/30 rounded-lg p-4 text-amber-900 dark:text-amber-100 text-xs">
          <p class="font-medium mb-1">{{ t('disclaimer.resolutionTitle') }}</p>
          <p>{{ t('disclaimer.resolutionBody') }}</p>
        </div>

        <!-- (what a heavy map can do to the computer it is built on, and that MapNG comes with no warranty) -->
        <div class="bg-red-50 dark:bg-red-900/20 border border-red-100 dark:border-red-900/30 rounded-lg p-4 text-red-900 dark:text-red-100 text-xs" data-testid="disclaimer-computer">
          <p class="font-medium mb-1">{{ t('disclaimer.computerTitle') }}</p>
          <p>{{ t('disclaimer.computerBody') }}</p>
          <p class="mt-2 font-medium">{{ t('disclaimer.noWarranty') }}</p>
        </div>

        <p class="text-xs text-gray-500 dark:text-gray-400">
          {{ t('disclaimer.usage') }}
        </p>

        <button 
          @click="$emit('close')"
          class="w-full py-2.5 bg-gray-900 dark:bg-white text-white dark:text-gray-900 font-medium rounded-lg hover:bg-gray-800 dark:hover:bg-gray-100 transition-colors mt-2"
        >
          {{ t('disclaimer.confirm') }}
        </button>
      </div>
    </div>
  </div>
</template>

<script setup>
import { useI18n } from 'vue-i18n';
import { AlertTriangle, X } from 'lucide-vue-next';

const { t } = useI18n({ useScope: 'global' });

defineEmits(['close']);
</script>
