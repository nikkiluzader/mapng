<template>
  <BaseCard class="space-y-3 bg-gray-50 dark:bg-gray-700 border-gray-200 dark:border-gray-600">
    <!-- Combined level: square N×N selector (power-of-2 only) -->
    <div v-if="combinedLevel" class="space-y-2">
      <div class="flex items-center justify-between">
        <span class="text-xs text-gray-600 dark:text-gray-400">{{ t('batchCombined.gridSize') }}</span>
        <div class="flex items-center gap-1.5">
          <button
            v-for="n in POW2_GRID_OPTIONS"
            :key="n"
            type="button"
            :disabled="combinedTierFor(n) === 'disabled'"
            @click="selectSquareGrid(n)"
            :class="[
              'px-2 py-1 rounded text-xs font-medium border transition-colors',
              gridCols === n
                ? 'bg-brand border-brand-500 text-white'
                : 'bg-white dark:bg-gray-800 border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:border-brand',
              combinedTierFor(n) === 'disabled' ? 'opacity-40 cursor-not-allowed' : '',
            ]"
          >
            {{ n }}×{{ n }}
          </button>
        </div>
      </div>
      <p class="text-micro text-gray-500 dark:text-gray-400">{{ t('batchCombined.gridSizeHint') }}</p>

      <div class="flex items-center justify-between text-micro pt-1 border-t border-gray-200 dark:border-gray-600">
        <span class="text-gray-400 dark:text-gray-500">{{ t('batchCombined.combinedHeightmap') }}</span>
        <span class="font-mono font-medium" :class="{
          'text-gray-700 dark:text-gray-300': combinedTier === 'ok',
          'text-red-600 dark:text-red-500': combinedTier === 'disabled',
        }">{{ combinedDim }} × {{ combinedDim }} px</span>
      </div>
      <p v-if="combinedTier === 'disabled'" class="text-micro text-red-600 dark:text-red-500 font-medium">
        <AlertTriangle :size="11" class="inline -mt-0.5 mr-0.5" />{{ t(isDesktop ? 'batchCombined.disabledWarningDesktop' : 'batchCombined.disabledWarning') }}
      </p>
      <p v-else-if="combinedDim >= COMBINED_SUPPORTED_MAX" class="text-micro text-amber-600 dark:text-amber-500 font-medium">
        <AlertTriangle :size="11" class="inline -mt-0.5 mr-0.5" />{{ t(isDesktop ? 'batchCombined.largeSizeNoteDesktop' : 'batchCombined.largeSizeNote', { mb: combinedMemoryMB }) }}
      </p>
    </div>

    <!-- Separate tiles: independent Width × Height -->
    <div v-else class="space-y-3">
      <div class="flex items-center justify-between">
        <span class="text-xs text-gray-600 dark:text-gray-400">{{ t('batch.gridWidthColumns') }}</span>
        <div class="flex items-center gap-2">
          <BaseButton size="sm" variant="secondary" @click="$emit('update:gridCols', Math.max(1, gridCols - 1))">−</BaseButton>
          <input
            type="number"
            v-model.number="localGridCols"
            min="1"
            max="20"
            class="w-12 text-center bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded px-1 py-0.5 text-sm text-gray-900 dark:text-white focus:ring-1 focus:ring-brand outline-none"
          />
          <BaseButton size="sm" variant="secondary" @click="$emit('update:gridCols', Math.min(20, gridCols + 1))">+</BaseButton>
        </div>
      </div>

      <div class="flex items-center justify-between">
        <span class="text-xs text-gray-600 dark:text-gray-400">{{ t('batch.gridHeightRows') }}</span>
        <div class="flex items-center gap-2">
          <BaseButton size="sm" variant="secondary" @click="$emit('update:gridRows', Math.max(1, gridRows - 1))">−</BaseButton>
          <input
            type="number"
            v-model.number="localGridRows"
            min="1"
            max="20"
            class="w-12 text-center bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded px-1 py-0.5 text-sm text-gray-900 dark:text-white focus:ring-1 focus:ring-brand outline-none"
          />
          <BaseButton size="sm" variant="secondary" @click="$emit('update:gridRows', Math.min(20, gridRows + 1))">+</BaseButton>
        </div>
      </div>
    </div>

    <div class="pt-2 border-t border-gray-200 dark:border-gray-600 space-y-2">
      <div class="grid grid-cols-3 gap-2 text-micro">
        <div class="text-center">
          <div class="text-gray-400 dark:text-gray-500">{{ t('batch.tiles') }}</div>
          <div class="text-gray-900 dark:text-white font-bold text-sm">{{ totalTiles }}</div>
        </div>
        <div class="text-center">
          <div class="text-gray-400 dark:text-gray-500">{{ t('batch.totalArea') }}</div>
          <div class="text-brand font-bold text-sm">{{ totalAreaDisplay }}</div>
        </div>
        <div class="text-center">
          <div class="text-gray-400 dark:text-gray-500">{{ t('batch.perimeter') }}</div>
          <div class="text-gray-900 dark:text-white font-bold text-sm">{{ perimeterDisplay }}</div>
        </div>
      </div>
      <div class="grid grid-cols-3 gap-2 text-micro">
        <div class="text-center">
          <div class="text-gray-400 dark:text-gray-500">{{ t('batch.westToEast') }}</div>
          <div class="text-gray-700 dark:text-gray-300 font-medium">{{ gridWidthDisplay }}</div>
        </div>
        <div class="text-center">
          <div class="text-gray-400 dark:text-gray-500">{{ t('batch.northToSouth') }}</div>
          <div class="text-gray-700 dark:text-gray-300 font-medium">{{ gridHeightDisplay }}</div>
        </div>
        <div class="text-center">
          <div class="text-gray-400 dark:text-gray-500">{{ t('batch.perTile') }}</div>
          <div class="text-gray-700 dark:text-gray-300 font-medium">{{ tileAreaDisplay }}</div>
        </div>
      </div>
    </div>

    <p v-if="totalTiles > 50" class="text-micro text-amber-600 dark:text-amber-500 font-medium">
      <AlertTriangle :size="11" class="inline -mt-0.5 mr-0.5" />{{ t('batch.largeBatchWarning', { count: totalTiles }) }}
    </p>
  </BaseCard>
</template>

<script setup>
import { AlertTriangle } from 'lucide-vue-next';
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import BaseCard from '../base/BaseCard.vue';
import BaseButton from '../base/BaseButton.vue';
import { desktopApp } from '../../services/platform/desktop.js';

const { t } = useI18n({ useScope: 'global' });
const isDesktop = !!desktopApp;

const props = defineProps({
  gridCols: { type: Number, default: 3 },
  gridRows: { type: Number, default: 3 },
  totalTiles: { type: Number, default: 0 },
  totalAreaDisplay: { type: String, default: '' },
  perimeterDisplay: { type: String, default: '' },
  gridWidthDisplay: { type: String, default: '' },
  gridHeightDisplay: { type: String, default: '' },
  tileAreaDisplay: { type: String, default: '' },
  combinedLevel: { type: Boolean, default: false },
  resolution: { type: Number, default: 1024 },
});

const emit = defineEmits(['update:gridCols', 'update:gridRows']);

// Combined level grids must be square and a power of 2 so the stitched
// heightmap (N × resolution) is itself a power-of-2 square (.ter requirement).
const POW2_GRID_OPTIONS = [2, 4, 8];
// 16384² is MapNG's largest level (a single tile's too). In a browser it is
// also the ceiling of the tab's ~4 GB heap: the exporter's full-grid buffers
// (minimap RGBA, road-architect + .ter heightfields) take 1 GiB each there.
// The desktop app says only the first: it is the size limit, not memory.
const COMBINED_SUPPORTED_MAX = 16384;

const combinedDimFor = (n) => n * Math.max(1, props.resolution);
const combinedTierFor = (n) => {
  const dim = combinedDimFor(n);
  if (dim > COMBINED_SUPPORTED_MAX) return 'disabled';
  return 'ok';
};

const combinedDim = computed(() => combinedDimFor(props.gridCols));
const combinedTier = computed(() => combinedTierFor(props.gridCols));
// Float32 stitched heightmap RAM estimate (4 bytes/px).
const combinedMemoryMB = computed(() => Math.round((combinedDim.value * combinedDim.value * 4) / (1024 * 1024)));

const selectSquareGrid = (n) => {
  if (combinedTierFor(n) === 'disabled') return;
  emit('update:gridCols', n);
  emit('update:gridRows', n);
};

const localGridCols = computed({
  get: () => props.gridCols,
  set: (val) => emit('update:gridCols', Math.max(1, Math.min(20, val || 1))),
});

const localGridRows = computed({
  get: () => props.gridRows,
  set: (val) => emit('update:gridRows', Math.max(1, Math.min(20, val || 1))),
});
</script>
