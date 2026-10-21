<template>
  <div class="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm" @click.self="$emit('close')">
    <div class="bg-white dark:bg-gray-900 rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-hidden flex flex-col">
      <div class="p-6 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between bg-gray-50 dark:bg-gray-800">
        <div class="flex items-center gap-3">
          <div class="p-2 bg-[#FF6600] rounded-lg shadow-sm">
            <Layers :size="20" class="text-white" />
          </div>
          <div>
            <h2 class="text-lg font-bold text-gray-900 dark:text-white">{{ t('about.title') }}</h2>
            <p class="text-xs text-gray-500 dark:text-gray-400">{{ t('about.subtitle') }}</p>
          </div>
        </div>
        <button @click="$emit('close')" class="text-gray-400 dark:text-gray-500 hover:text-gray-900 dark:hover:text-white transition-colors">
          <X :size="20" />
        </button>
      </div>
      
      <div class="p-6 overflow-y-auto custom-scrollbar space-y-6 text-sm text-gray-600 dark:text-gray-300 leading-relaxed">
        <div class="bg-orange-50 dark:bg-orange-900/20 border border-orange-100 dark:border-orange-900/30 rounded-lg p-4 text-orange-900 dark:text-orange-100">
          <p class="font-medium">{{ t('about.hero') }}</p>
        </div>

        <div class="space-y-4">
          <h3 class="font-bold text-gray-900 dark:text-white flex items-center gap-2">
            <Globe :size="16" class="text-[#FF6600]" />
            {{ t('about.whatTitle') }}
          </h3>
          <p>{{ t('about.whatBody') }}</p>
        </div>

        <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div class="space-y-2">
            <h4 class="font-bold text-gray-900 dark:text-white text-xs uppercase tracking-wider">{{ t('about.elevationTitle') }}</h4>
            <ul class="space-y-2 list-disc list-inside marker:text-[#FF6600]">
              <li v-for="item in tm('about.elevationItems')" :key="item">{{ item }}</li>
            </ul>
          </div>
          <div class="space-y-2">
            <h4 class="font-bold text-gray-900 dark:text-white text-xs uppercase tracking-wider">{{ t('about.previewTitle') }}</h4>
            <ul class="space-y-2 list-disc list-inside marker:text-[#FF6600]">
              <li v-for="item in tm('about.previewItems')" :key="item">{{ item }}</li>
            </ul>
          </div>
        </div>

        <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div class="space-y-2">
            <h4 class="font-bold text-gray-900 dark:text-white text-xs uppercase tracking-wider">{{ t('about.exportTitle') }}</h4>
            <ul class="space-y-2 list-disc list-inside marker:text-[#FF6600]">
              <li v-for="item in tm('about.exportItems')" :key="item">{{ item }}</li>
            </ul>
          </div>
          <div class="space-y-2">
            <h4 class="font-bold text-gray-900 dark:text-white text-xs uppercase tracking-wider">{{ t('about.osmTitle') }}</h4>
            <ul class="space-y-2 list-disc list-inside marker:text-[#FF6600]">
              <li v-for="item in tm('about.osmItems')" :key="item">{{ item }}</li>
            </ul>
          </div>
        </div>

        <div class="grid grid-cols-1 gap-4">
          <div class="space-y-2">
             <h4 class="font-bold text-gray-900 dark:text-white text-xs uppercase tracking-wider">{{ t('about.resolutionTitle') }}</h4>
             <p class="text-xs bg-gray-100 dark:bg-gray-800 p-3 rounded border border-gray-200 dark:border-gray-700">
                <strong>{{ t('about.resolutionStrong') }}</strong><br/>
                {{ t('about.resolutionBody') }}
             </p>
          </div>
        </div>

        <div class="space-y-2">
            <h4 class="font-bold text-gray-900 dark:text-white text-xs uppercase tracking-wider flex items-center gap-2">
              <Grid3X3 :size="14" class="text-[#FF6600]" />
            {{ t('about.batchTitle') }}
          </h4>
          <p class="text-xs bg-gray-100 dark:bg-gray-800 p-3 rounded border border-gray-200 dark:border-gray-700">
            {{ t('about.batchIntro') }}
          </p>
          <ul class="space-y-1 list-disc list-inside marker:text-[#FF6600] text-xs">
            <li v-for="item in tm('about.batchItems')" :key="item">{{ item }}</li>
          </ul>
        </div>

        <div class="space-y-2">
          <h4 class="font-bold text-gray-900 dark:text-white text-xs uppercase tracking-wider">{{ t('about.beamngTitle') }}</h4>
          <p class="text-xs bg-amber-50 dark:bg-amber-900/20 p-3 rounded border border-amber-200 dark:border-amber-900/30 text-amber-800 dark:text-amber-200">
            {{ t('about.beamngBody') }}
          </p>
        </div>

        <div class="space-y-2">
            <h4 class="font-bold text-gray-900 dark:text-white text-xs uppercase tracking-wider">{{ t('about.additionalTitle') }}</h4>
            <ul class="space-y-2 list-disc list-inside marker:text-[#FF6600]">
              <li v-for="item in tm('about.additionalItems')" :key="item">{{ item }}</li>
            </ul>
        </div>

        <div class="pt-4 border-t border-gray-100 dark:border-gray-800">
          <p class="text-xs text-gray-500 dark:text-gray-400 text-center">
            {{ t('about.footerPrefix') }} <a href="https://github.com/nikkiluzader" target="_blank" class="text-[#FF6600] hover:underline">Nikki Luzader</a> • {{ t('about.footerMiddle') }} <a href="https://github.com/nikkiluzader/mapng" target="_blank" class="text-[#FF6600] hover:underline">GitHub</a>
          </p>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { useI18n } from 'vue-i18n';
import { Layers, X, Globe, Grid3X3 } from 'lucide-vue-next';

const { t, tm } = useI18n({ useScope: 'global' });

defineEmits(['close']);
</script>
