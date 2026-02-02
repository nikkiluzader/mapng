<template>
  <div class="relative" ref="containerRef">
    <!-- Search Input -->
    <div class="relative">
      <input
        ref="inputRef"
        type="text"
        v-model="searchQuery"
        @input="handleInput"
        @focus="handleFocus"
        @keydown="handleKeydown"
        placeholder="Search for a location..."
        class="w-full bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded px-3 py-2 pl-8 text-xs text-gray-900 dark:text-white focus:ring-2 focus:ring-[#FF6600] focus:border-[#FF6600] outline-none placeholder-gray-400 dark:placeholder-gray-500"
      />
      
      <!-- Search Icon -->
      <Search 
        v-if="!isLoading" 
        :size="14" 
        class="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400 dark:text-gray-500" 
      />
      
      <!-- Loading Spinner -->
      <Loader2 
        v-else 
        :size="14" 
        class="absolute left-2.5 top-1/2 -translate-y-1/2 text-[#FF6600] animate-spin" 
      />
      
      <!-- Clear Button -->
      <button
        v-if="searchQuery"
        @click="clearSearch"
        class="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors p-0.5 rounded"
        type="button"
      >
        <X :size="14" />
      </button>
    </div>

    <!-- Results Dropdown -->
    <div 
      v-if="showResults && (results.length > 0 || noResults)"
      class="absolute z-50 w-full mt-1 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-600 rounded-lg shadow-xl max-h-64 overflow-y-auto"
    >
      <!-- No Results -->
      <div 
        v-if="noResults" 
        class="px-3 py-4 text-xs text-gray-500 dark:text-gray-400 text-center"
      >
        <MapPinOff :size="20" class="mx-auto mb-2 text-gray-400 dark:text-gray-500" />
        No locations found for "{{ searchQuery }}"
      </div>

      <!-- Results List -->
      <ul v-else class="py-1">
        <li
          v-for="(result, index) in results"
          :key="`${result.lat}-${result.lng}-${index}`"
          @click="selectResult(result)"
          @mouseenter="highlightedIndex = index"
          :class="[
            'px-3 py-2 cursor-pointer transition-colors flex items-start gap-2',
            highlightedIndex === index 
              ? 'bg-orange-50 dark:bg-gray-700' 
              : 'hover:bg-gray-50 dark:hover:bg-gray-700'
          ]"
        >
          <span class="text-sm flex-shrink-0 mt-0.5">{{ getTypeIcon(result.type) }}</span>
          <div class="flex-1 min-w-0">
            <div class="text-xs font-medium text-gray-900 dark:text-white truncate">
              {{ getShortDisplayName(result.displayName) }}
            </div>
            <div class="text-[10px] text-gray-500 dark:text-gray-400 truncate">
              {{ result.displayName }}
            </div>
          </div>
        </li>
      </ul>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted, onUnmounted } from 'vue';
import { Search, Loader2, X, MapPinOff } from 'lucide-vue-next';
import { searchLocation, getShortName, getLocationTypeIcon } from '../services/nominatim';

const emit = defineEmits(['select']);

const containerRef = ref(null);
const inputRef = ref(null);

const searchQuery = ref('');
const results = ref([]);
const isLoading = ref(false);
const showResults = ref(false);
const noResults = ref(false);
const highlightedIndex = ref(-1);

let debounceTimer = null;

const handleInput = () => {
  noResults.value = false;
  
  if (debounceTimer) {
    clearTimeout(debounceTimer);
  }
  
  if (!searchQuery.value || searchQuery.value.trim().length < 2) {
    results.value = [];
    showResults.value = false;
    return;
  }
  
  debounceTimer = setTimeout(async () => {
    await performSearch();
  }, 300);
};

const performSearch = async () => {
  if (!searchQuery.value || searchQuery.value.trim().length < 2) {
    return;
  }
  
  isLoading.value = true;
  showResults.value = true;
  highlightedIndex.value = -1;
  
  try {
    const searchResults = await searchLocation(searchQuery.value);
    results.value = searchResults;
    noResults.value = searchResults.length === 0;
  } catch (error) {
    console.error('[LocationSearch] Search failed:', error);
    results.value = [];
    noResults.value = true;
  } finally {
    isLoading.value = false;
  }
};

const handleFocus = () => {
  if (results.value.length > 0 || noResults.value) {
    showResults.value = true;
  }
};

const handleKeydown = (e) => {
  if (!showResults.value || results.value.length === 0) {
    if (e.key === 'Enter') {
      performSearch();
    }
    return;
  }
  
  switch (e.key) {
    case 'ArrowDown':
      e.preventDefault();
      highlightedIndex.value = Math.min(highlightedIndex.value + 1, results.value.length - 1);
      break;
    case 'ArrowUp':
      e.preventDefault();
      highlightedIndex.value = Math.max(highlightedIndex.value - 1, 0);
      break;
    case 'Enter':
      e.preventDefault();
      if (highlightedIndex.value >= 0 && highlightedIndex.value < results.value.length) {
        selectResult(results.value[highlightedIndex.value]);
      }
      break;
    case 'Escape':
      e.preventDefault();
      showResults.value = false;
      inputRef.value?.blur();
      break;
  }
};

const selectResult = (result) => {
  emit('select', result);
  searchQuery.value = getShortName(result.displayName);
  showResults.value = false;
  results.value = [];
  noResults.value = false;
};

const clearSearch = () => {
  searchQuery.value = '';
  results.value = [];
  showResults.value = false;
  noResults.value = false;
  highlightedIndex.value = -1;
  inputRef.value?.focus();
};

const getShortDisplayName = (displayName) => {
  return getShortName(displayName);
};

const getTypeIcon = (type) => {
  return getLocationTypeIcon(type);
};

// Close dropdown when clicking outside
const handleClickOutside = (e) => {
  if (containerRef.value && !containerRef.value.contains(e.target)) {
    showResults.value = false;
  }
};

onMounted(() => {
  document.addEventListener('click', handleClickOutside);
});

onUnmounted(() => {
  document.removeEventListener('click', handleClickOutside);
  if (debounceTimer) {
    clearTimeout(debounceTimer);
  }
});
</script>
