<template>
  <div class="space-y-2">
    <label class="text-sm font-medium text-gray-700 dark:text-gray-300 flex items-center gap-2">
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
      <a :href="mod['Resource URL']" target="_blank" class="block group">
        <div class="relative h-32 w-full overflow-hidden bg-gray-100 dark:bg-gray-900">
            <img 
                v-if="mod['Thumbnail URL']" 
                :src="mod['Thumbnail URL']" 
                :alt="mod.Title"
                class="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
            />
            <div v-else class="w-full h-full flex items-center justify-center text-gray-400">
                <ImageOff :size="24" />
            </div>
            <div class="absolute top-2 right-2 bg-black/60 backdrop-blur text-white text-[10px] px-1.5 py-0.5 rounded flex items-center gap-1">
                <Star :size="10" class="text-yellow-400 fill-yellow-400" />
                {{ mod.Rating }}
            </div>
        </div>
        
        <div class="p-3 space-y-2">
            <div>
                <h3 class="font-medium text-gray-900 dark:text-white text-sm leading-tight group-hover:text-[#FF6600] transition-colors line-clamp-1" :title="mod.Title">
                    {{ mod.Title }}
                </h3>
                <p class="text-xs text-gray-500 dark:text-gray-400">by {{ mod.Author }}</p>
            </div>

            <div class="flex items-center justify-between text-[10px] text-gray-500 dark:text-gray-400 border-t border-gray-100 dark:border-gray-700 pt-2">
                <div class="flex items-center gap-1" title="Downloads">
                    <Download :size="12" />
                    {{ mod.Downloads }}
                </div>
                <div class="flex items-center gap-1" title="Version">
                    <Tag :size="12" />
                    v{{ mod.Version }}
                </div>
            </div>
        </div>
      </a>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { Trophy, Download, Star, Tag, ImageOff } from 'lucide-vue-next';
import { fetchModOfTheDay, type ModOfTheDay } from '../services/modOfTheDay';

const mod = ref<ModOfTheDay | null>(null);
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
