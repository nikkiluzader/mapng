<template>
  <div class="space-y-3">
    <!-- Collapsible Header -->
    <button 
      @click="isExpanded = !isExpanded"
      class="w-full flex items-center justify-between text-sm font-medium text-gray-700 dark:text-gray-300 hover:text-[#FF6600] transition-colors group"
    >
      <span class="flex items-center gap-2">
        <LayoutGrid :size="16" class="text-gray-500 dark:text-gray-400 group-hover:text-[#FF6600] transition-colors" />
        Surrounding Tiles
      </span>
      <ChevronDown :size="14" :class="['transition-transform duration-200', isExpanded ? 'rotate-180' : '']" />
    </button>

    <template v-if="isExpanded">
      <p class="text-[10px] text-gray-500 dark:text-gray-400 leading-tight">
        Download adjacent tiles for out-of-bounds terrain. Uses standard 30m elevation, no OSM data.
      </p>

      <!-- 3×3 Interactive Grid -->
      <div class="grid grid-cols-3 gap-1.5 max-w-[180px] mx-auto py-1">
        <template v-for="pos in gridOrder" :key="pos">
          <!-- Center cell (not selectable) -->
          <div 
            v-if="pos === 'CENTER'"
            class="aspect-square rounded-md bg-[#FF6600]/15 border-2 border-[#FF6600]/60 flex items-center justify-center select-none"
            title="Center tile (your main export)"
          >
            <span class="text-[11px] font-bold text-[#FF6600]">C</span>
          </div>

          <!-- Surrounding tile cell -->
          <button 
            v-else
            @click="toggle(pos)"
            :title="`Tile ${labels[pos]} (${pos})`"
            :class="[
              'aspect-square rounded-md border-2 flex items-center justify-center transition-all duration-150 text-[11px] font-semibold',
              selected.has(pos)
                ? 'bg-emerald-100 dark:bg-emerald-900/40 border-emerald-500 dark:border-emerald-400 text-emerald-700 dark:text-emerald-300 shadow-sm shadow-emerald-200 dark:shadow-none'
                : 'bg-gray-50 dark:bg-gray-800 border-gray-200 dark:border-gray-600 text-gray-400 dark:text-gray-500 hover:border-gray-400 dark:hover:border-gray-400 hover:text-gray-600 dark:hover:text-gray-300'
            ]"
          >
            {{ labels[pos] }}
          </button>
        </template>
      </div>

      <!-- Select All / Clear -->
      <div class="flex items-center justify-center gap-3 text-[10px]">
        <button @click="selectAll" class="text-[#FF6600] hover:underline font-medium">Select All</button>
        <span class="text-gray-300 dark:text-gray-600">|</span>
        <button @click="clearAll" class="text-gray-500 dark:text-gray-400 hover:underline">Clear</button>
      </div>

      <!-- Show on Map toggle -->
      <div class="flex items-center justify-between p-2 rounded bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600">
          <label class="text-[10px] text-gray-700 dark:text-gray-300 flex items-center gap-1.5 cursor-pointer">
              <LayoutGrid :size="10" class="text-blue-500" />
              Show on map
          </label>
          <input 
              type="checkbox" 
              v-model="showOnMap"
              class="accent-[#FF6600] w-3.5 h-3.5 cursor-pointer"
          />
      </div>

      <!-- Satellite Quality -->
      <div class="space-y-1">
        <span class="text-[10px] text-gray-500 dark:text-gray-400 font-medium">Satellite Quality</span>
        <select 
          v-model.number="satZoom"
          class="w-full bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded px-2 py-1.5 text-xs text-gray-900 dark:text-white focus:ring-1 focus:ring-[#FF6600] outline-none"
        >
          <option v-for="q in qualities" :key="q.value" :value="q.value">
            {{ q.label }} — {{ q.desc }}
          </option>
        </select>
      </div>

      <!-- Output Info -->
      <div class="text-[10px] text-gray-500 dark:text-gray-400 bg-gray-50 dark:bg-gray-700/50 p-2 rounded border border-gray-200 dark:border-gray-600 space-y-0.5">
        <div class="flex justify-between">
          <span>Output size</span>
          <span class="text-gray-700 dark:text-gray-300 font-medium">{{ outputSize }}×{{ outputSize }}px</span>
        </div>
        <div class="flex justify-between">
          <span>Scale</span>
          <span class="text-gray-700 dark:text-gray-300 font-medium">1m/px</span>
        </div>
        <div class="flex justify-between">
          <span>Per-tile area</span>
          <span class="text-gray-700 dark:text-gray-300 font-medium">{{ resolution }}×{{ resolution }}m</span>
        </div>
        <p class="text-[9px] text-gray-400 dark:text-gray-500 pt-1 leading-tight">Elevation upsampled from 30m source data. Same pixel size as center tile.</p>
      </div>

      <!-- Download Button -->
      <button
        @click="handleDownload"
        :disabled="selected.size === 0 || isDownloading || !terrainData"
        :class="[
          'w-full py-2.5 text-xs font-bold rounded-md transition-all flex items-center justify-center gap-2',
          selected.size > 0 && !isDownloading && terrainData
            ? 'bg-gray-800 dark:bg-gray-200 text-white dark:text-gray-900 hover:bg-gray-700 dark:hover:bg-gray-300 shadow-sm'
            : 'bg-gray-200 dark:bg-gray-700 text-gray-400 dark:text-gray-500 cursor-not-allowed'
        ]"
      >
        <Loader2 v-if="isDownloading" :size="14" class="animate-spin" />
        <Download v-else :size="14" />
        <span v-if="isDownloading" class="truncate">{{ downloadStatus }}</span>
        <span v-else-if="!terrainData && selected.size > 0">Generate terrain first</span>
        <span v-else>Download {{ selected.size }} Tile{{ selected.size !== 1 ? 's' : '' }} (ZIP)</span>
      </button>

      <!-- Cancel link -->
      <button
        v-if="isDownloading"
        @click="cancelDownload"
        class="w-full text-center text-[10px] text-gray-500 hover:text-red-500 transition-colors py-1"
      >
        Cancel
      </button>
    </template>
  </div>
</template>

<script setup>
import { ref, computed, watch } from 'vue';
import { LayoutGrid, ChevronDown, Download, Loader2 } from 'lucide-vue-next';
import {
  GRID_ORDER,
  POSITIONS,
  SATELLITE_QUALITY,
  POSITION_LABELS,
  fetchSurroundingTiles,
  downloadSurroundingTilesZip,
} from '../services/surroundingTiles';

const props = defineProps({
  terrainData: { type: Object, default: null },
  center:      { type: Object, required: true },
  resolution:  { type: Number, required: true },
});

const emit = defineEmits(['update:selectedPositions', 'update:showOnMap']);

// --- State ---
const isExpanded = ref(false);
const selected = ref(new Set());
const satZoom = ref(14);
const isDownloading = ref(false);
const downloadStatus = ref('');
const showOnMap = ref(true);
let abortController = null;

// --- Constants ---
const gridOrder = GRID_ORDER;
const qualities = SATELLITE_QUALITY;
const labels = POSITION_LABELS;

// --- Computed ---
const outputSize = computed(() => props.resolution);

// Emit selected positions whenever they change
watch([selected, showOnMap, isExpanded], () => {
  const positionsArray = isExpanded.value && showOnMap.value ? [...selected.value] : [];
  emit('update:selectedPositions', positionsArray);
  emit('update:showOnMap', isExpanded.value && showOnMap.value);
}, { immediate: true });

// --- Actions ---
const toggle = (pos) => {
  const next = new Set(selected.value);
  if (next.has(pos)) next.delete(pos);
  else next.add(pos);
  selected.value = next;
};

const selectAll = () => {
  selected.value = new Set(POSITIONS.map(p => p.key));
};

const clearAll = () => {
  selected.value = new Set();
};

const handleDownload = async () => {
  if (selected.value.size === 0 || !props.terrainData?.bounds) return;

  if (abortController) abortController.abort();
  abortController = new AbortController();

  isDownloading.value = true;
  downloadStatus.value = 'Starting...';

  try {
    const results = await fetchSurroundingTiles(
      props.terrainData.bounds,
      [...selected.value],
      props.resolution,
      satZoom.value,
      (s) => { downloadStatus.value = s; },
      abortController.signal,
    );

    await downloadSurroundingTilesZip(
      results,
      props.terrainData.bounds,
      props.center,
      props.resolution,
      (s) => { downloadStatus.value = s; },
    );

    downloadStatus.value = 'Done!';
    setTimeout(() => { if (!isDownloading.value) return; isDownloading.value = false; }, 1500);
  } catch (error) {
    if (error.name === 'AbortError') {
      downloadStatus.value = 'Cancelled.';
      return;
    }
    console.error('Surrounding tiles failed:', error);
    alert('Failed to generate surrounding tiles. Please try again.');
  } finally {
    isDownloading.value = false;
    abortController = null;
  }
};

const cancelDownload = () => {
  if (abortController) {
    abortController.abort();
    abortController = null;
  }
  isDownloading.value = false;
};
</script>
