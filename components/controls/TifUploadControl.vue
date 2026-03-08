<template>
  <!-- Active: show badge with file info + clear button -->
  <div v-if="uploadedTifFile" class="flex items-center gap-2 px-3 py-2 rounded-lg bg-blue-50 dark:bg-blue-950 border border-blue-200 dark:border-blue-800 text-sm">
    <FileUp :size="14" class="shrink-0 text-blue-500 dark:text-blue-400" />
    <div class="flex-1 min-w-0">
      <p class="font-medium text-blue-800 dark:text-blue-200 truncate">{{ uploadedTifFile.name }}</p>
      <p v-if="uploadedTifMeta?.isGeoTiff && uploadedTifMeta?.center" class="text-[11px] text-emerald-600 dark:text-emerald-400">
        GeoTIFF — coordinates auto-detected
      </p>
      <p v-else-if="uploadedTifMeta?.isGeoTiff" class="text-[11px] text-amber-600 dark:text-amber-400">
        GeoTIFF — CRS unsupported, using selected coordinates
      </p>
      <p v-else-if="uploadedTifMeta" class="text-[11px] text-amber-600 dark:text-amber-400">
        No geo metadata — using selected coordinates
      </p>
      <p v-else class="text-[11px] text-blue-500 dark:text-blue-400 animate-pulse">
        Reading file…
      </p>
    </div>
    <button
      @click="$emit('clear')"
      class="shrink-0 p-1 rounded hover:bg-blue-100 dark:hover:bg-blue-900 text-blue-400 hover:text-blue-600 dark:hover:text-blue-200 transition-colors"
      title="Remove uploaded file"
    >
      <X :size="14" />
    </button>
  </div>

  <!-- Idle: compact upload trigger -->
  <div v-else>
    <label
      class="flex items-center gap-2 w-full px-3 py-2 rounded-lg border border-dashed border-gray-300 dark:border-gray-600 text-sm text-gray-500 dark:text-gray-400 hover:border-[#FF6600] hover:text-[#FF6600] dark:hover:border-[#FF6600] dark:hover:text-[#FF6600] cursor-pointer transition-colors"
    >
      <Upload :size="14" class="shrink-0" />
      <span>Upload elevation (.tif)</span>
      <input
        ref="fileInput"
        type="file"
        accept=".tif,.tiff"
        class="sr-only"
        @change="handleFileChange"
      />
    </label>
  </div>
</template>

<script setup>
import { ref } from 'vue';
import { Upload, FileUp, X } from 'lucide-vue-next';

defineProps({
  uploadedTifFile: { type: Object, default: null },
  uploadedTifMeta: { type: Object, default: null },
});

const emit = defineEmits(['file-selected', 'clear']);
const fileInput = ref(null);

const handleFileChange = (e) => {
  const file = e.target.files?.[0];
  if (file) emit('file-selected', file);
  // Reset input so the same file can be re-selected after clearing
  if (fileInput.value) fileInput.value.value = '';
};
</script>
