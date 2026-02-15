<template>
  <div class="space-y-2">
    <label v-if="!headless" class="text-sm font-medium text-gray-700 dark:text-gray-300 flex items-center gap-2">
      <Trophy :size="16" class="text-yellow-500" />
      Mod of the Day
    </label>

    <div v-if="loading" class="p-4 text-center text-gray-500 dark:text-gray-400 text-xs animate-pulse">
      Loading...
    </div>

    <div v-else-if="error" class="p-2 text-red-500 text-xs bg-red-50 dark:bg-red-900/20 rounded border border-red-100 dark:border-red-900/30">
      Failed to load mod of the day.
    </div>

    <div v-else-if="mod" class="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden shadow-sm hover:shadow-md transition-shadow">
      <a :href="mod['Resource URL']" target="_blank" class="flex p-3 gap-3 group">
        <!-- Image Container -->
        <div class="relative w-20 h-20 flex-shrink-0 rounded-md overflow-hidden bg-gray-100 dark:bg-gray-900 border border-gray-100 dark:border-gray-700">
            <img 
                v-if="mod['Thumbnail URL']" 
                :src="mod['Thumbnail URL']" 
                :alt="mod.Title"
                class="w-full h-full object-cover"
            />
            <div v-else class="w-full h-full flex items-center justify-center text-gray-400">
                <ImageOff :size="20" />
            </div>
        </div>
        
        <!-- Info Container -->
        <div class="flex-1 min-w-0 flex flex-col h-20 justify-between">
            <div>
                <h3 class="font-bold text-gray-900 dark:text-white text-sm leading-tight group-hover:text-[#FF6600] transition-colors line-clamp-2 mb-1" :title="mod.Title">
                    {{ mod.Title }}
                </h3>
                <p class="text-xs text-gray-500 dark:text-gray-400 truncate">by {{ mod.Author }}</p>
            </div>

            <div class="flex items-center justify-between text-[10px] text-gray-500 dark:text-gray-400">
                <div class="flex items-center gap-1 text-yellow-600 dark:text-yellow-500 font-medium bg-yellow-50 dark:bg-yellow-900/20 px-1.5 py-0.5 rounded">
                    <Star :size="10" class="fill-current" />
                    {{ mod.Rating }}
                </div>
                
                <div class="flex items-center gap-3">
                    <div class="flex items-center gap-1" title="Version">
                        <Tag :size="10" />
                        v{{ mod.Version }}
                    </div>
                    <div class="flex items-center gap-1" title="Downloads">
                        <Download :size="10" />
                        {{ mod.Downloads }}
                    </div>
                </div>
            </div>
        </div>
      </a>
    </div>
    
    <p v-if="mod" class="text-[10px] text-gray-400 dark:text-gray-500 text-center italic">
      *Most recently updated map on BeamNG.com
    </p>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue';
import { Trophy, Download, Star, Tag, ImageOff } from 'lucide-vue-next';
import { fetchModOfTheDay } from '../services/modOfTheDay';

const props = defineProps({
  headless: { type: Boolean, default: false }
});

const mod = ref(null);
const loading = ref(true);
const error = ref(false);

onMounted(async () => {
  try {
    mod.value = await fetchModOfTheDay();
  } catch (e) {
    console.error(e);
    error.value = true;
  } finally {
    loading.value = false;
  }
});
</script>
