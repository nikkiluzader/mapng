<template>
  <div class="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4 animate-in fade-in duration-200">
    <div class="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-2xl shadow-2xl w-full max-w-2xl max-h-[85vh] overflow-y-auto custom-scrollbar flex flex-col animate-in zoom-in-95 duration-200">
      <!-- Header -->
      <div class="p-5 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between sticky top-0 bg-white/95 dark:bg-gray-900/95 backdrop-blur z-10">
        <div class="flex items-center gap-3">
          <div class="p-2 bg-gray-100 dark:bg-gray-800 rounded-lg">
            <Code :size="20" class="text-brand" />
          </div>
          <h2 class="text-lg font-bold text-gray-900 dark:text-white">{{ t('tech.title') }}</h2>
        </div>
        <button 
          @click="$emit('close')" 
          class="p-2 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-full transition-colors text-gray-400 hover:text-gray-900 dark:hover:text-white"
        >
          <X :size="20" />
        </button>
      </div>

      <!-- Content -->
      <div class="p-6 space-y-8">
        <section class="space-y-3">
          <h3 class="text-sm font-semibold text-brand uppercase tracking-wider">{{ t('tech.coreFramework') }}</h3>
          <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div v-for="card in tm('tech.sections.core')" :key="card.name" class="bg-gray-50 dark:bg-gray-800 p-3 rounded border border-gray-200 dark:border-gray-700">
              <div class="font-medium text-gray-900 dark:text-white">{{ card.name }}</div>
              <div class="text-xs text-gray-500 dark:text-gray-400 mt-1">{{ card.desc }}</div>
            </div>
          </div>
        </section>

        <section class="space-y-3">
          <h3 class="text-sm font-semibold text-brand uppercase tracking-wider">{{ t('tech.rendering') }}</h3>
          <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div v-for="card in tm('tech.sections.render')" :key="card.name" class="bg-gray-50 dark:bg-gray-800 p-3 rounded border border-gray-200 dark:border-gray-700">
              <div class="font-medium text-gray-900 dark:text-white">{{ card.name }}</div>
              <div class="text-xs text-gray-500 dark:text-gray-400 mt-1">{{ card.desc }}</div>
            </div>
          </div>
        </section>

        <section class="space-y-3">
          <h3 class="text-sm font-semibold text-brand uppercase tracking-wider">{{ t('tech.mapping') }}</h3>
          <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div v-for="card in tm('tech.sections.map')" :key="card.name" class="bg-gray-50 dark:bg-gray-800 p-3 rounded border border-gray-200 dark:border-gray-700">
              <div class="font-medium text-gray-900 dark:text-white">{{ card.name }}</div>
              <div class="text-xs text-gray-500 dark:text-gray-400 mt-1">{{ card.desc }}</div>
            </div>
          </div>
        </section>

        <section class="space-y-3">
          <h3 class="text-sm font-semibold text-brand uppercase tracking-wider">{{ t('tech.texture') }}</h3>
          <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div v-for="card in tm('tech.sections.tex')" :key="card.name" class="bg-gray-50 dark:bg-gray-800 p-3 rounded border border-gray-200 dark:border-gray-700">
              <div class="font-medium text-gray-900 dark:text-white">{{ card.name }}</div>
              <div class="text-xs text-gray-500 dark:text-gray-400 mt-1">{{ card.desc }}</div>
            </div>
          </div>
        </section>

        <section class="space-y-3">
          <h3 class="text-sm font-semibold text-brand uppercase tracking-wider">{{ t('tech.sources') }}</h3>
          <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div v-for="card in tm('tech.sections.src')" :key="card.name" class="bg-gray-50 dark:bg-gray-800 p-3 rounded border border-gray-200 dark:border-gray-700">
              <div class="font-medium text-gray-900 dark:text-white">{{ card.name }}</div>
              <div class="text-xs text-gray-500 dark:text-gray-400 mt-1">{{ card.desc }}</div>
            </div>
          </div>
        </section>

        <section class="space-y-3">
          <h3 class="text-sm font-semibold text-brand uppercase tracking-wider">{{ t('tech.deployment') }}</h3>
          <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div v-for="card in tm('tech.sections.deploy')" :key="card.name" class="bg-gray-50 dark:bg-gray-800 p-3 rounded border border-gray-200 dark:border-gray-700">
              <div class="font-medium text-gray-900 dark:text-white">{{ card.name }}</div>
              <div class="text-xs text-gray-500 dark:text-gray-400 mt-1">{{ card.desc }}</div>
            </div>
          </div>
        </section>
      </div>
      
      <div class="p-5 border-t border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 text-center">
        <p class="text-xs text-gray-500 dark:text-gray-400">{{ t('tech.footer1') }}</p>
        <p class="italic opacity-70 text-xs text-gray-400 dark:text-gray-500 mt-2">{{ t('tech.footer2') }}</p>
      </div>
    </div>
  </div>
</template>

<script setup>
import { useI18n } from 'vue-i18n';
import { Code, X } from 'lucide-vue-next';

const { t, tm } = useI18n({ useScope: 'global' });

defineEmits(['close']);
</script>
