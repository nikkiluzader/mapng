import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import { loadBatchState } from '../services/batchJob';

export const useMainStore = defineStore('main', () => {
  // --- Global State ---
  const center = ref(
    JSON.parse(localStorage.getItem('mapng_center') || 'null') || { lat: 35.1983, lng: -111.6513 }
  );
  const zoom = ref(parseInt(localStorage.getItem('mapng_zoom')) || 13);
  const resolution = ref(parseInt(localStorage.getItem('mapng_resolution')) || 1024);
  const isDarkMode = ref(localStorage.getItem('theme') === 'dark');
  const batchMode = ref(localStorage.getItem('mapng_batch_mode') === 'true');

  if (batchMode.value && Number(resolution.value) > 8192) {
    resolution.value = 8192;
    localStorage.setItem('mapng_resolution', String(8192));
  }

  // --- Single Tile State ---
  const terrainData = ref(null);
  const lastGenerationKey = ref(null);
  const isLoading = ref(false);
  const loadingStatus = ref("Initializing...");
  const previewMode = ref(false);
  const surroundingTilePositions = ref([]);

  // --- Batch Job State ---
  const batchGridCols = ref(parseInt(localStorage.getItem('mapng_batch_cols')) || 3);
  const batchGridRows = ref(parseInt(localStorage.getItem('mapng_batch_rows')) || 3);
  const batchTileFollowCenter = ref(localStorage.getItem('mapng_batch_tile_follow_center') !== 'false');
  const batchTileOffsets = ref((() => {
    try {
      const saved = localStorage.getItem('mapng_batch_tile_offsets');
      const parsed = saved ? JSON.parse(saved) : [];
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  })());
  const batchTileNames = ref((() => {
    try {
      const saved = localStorage.getItem('mapng_batch_tile_names');
      const parsed = saved ? JSON.parse(saved) : [];
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  })());
  const batchState = ref(null);
  const batchRunning = ref(false);
  const batchCurrentStep = ref('');
  const showBatchProgress = ref(false);
  const savedBatchState = ref(loadBatchState());

  // --- Actions ---
  function setCenter(newCenter) {
    center.value = newCenter;
    localStorage.setItem('mapng_center', JSON.stringify(newCenter));
  }

  function setZoom(newZoom) {
    zoom.value = newZoom;
    localStorage.setItem('mapng_zoom', String(newZoom));
  }

  function setResolution(newResolution) {
    resolution.value = newResolution;
    localStorage.setItem('mapng_resolution', String(newResolution));
  }

  function toggleDarkMode() {
    isDarkMode.value = !isDarkMode.value;
    if (isDarkMode.value) {
      document.documentElement.classList.add('dark');
      localStorage.setItem('theme', 'dark');
    } else {
      document.documentElement.classList.remove('dark');
      localStorage.setItem('theme', 'light');
    }
  }

  function setBatchMode(value) {
    batchMode.value = value;
    localStorage.setItem('mapng_batch_mode', value ? 'true' : 'false');
  }

  function setBatchGridCols(cols) {
    batchGridCols.value = cols;
    localStorage.setItem('mapng_batch_cols', String(cols));
  }

  function setBatchGridRows(rows) {
    batchGridRows.value = rows;
    localStorage.setItem('mapng_batch_rows', String(rows));
  }

  function setBatchTileFollowCenter(value) {
    batchTileFollowCenter.value = !!value;
    localStorage.setItem('mapng_batch_tile_follow_center', batchTileFollowCenter.value ? 'true' : 'false');
  }

  function setBatchTileOffsets(offsets) {
    batchTileOffsets.value = Array.isArray(offsets) ? offsets : [];
    localStorage.setItem('mapng_batch_tile_offsets', JSON.stringify(batchTileOffsets.value));
  }

  function setBatchTileNames(names) {
    batchTileNames.value = Array.isArray(names) ? names : [];
    localStorage.setItem('mapng_batch_tile_names', JSON.stringify(batchTileNames.value));
  }

  return {
    // State
    center,
    zoom,
    resolution,
    isDarkMode,
    batchMode,
    terrainData,
    lastGenerationKey,
    isLoading,
    loadingStatus,
    previewMode,
    surroundingTilePositions,
    batchGridCols,
    batchGridRows,
    batchTileFollowCenter,
    batchTileOffsets,
    batchTileNames,
    batchState,
    batchRunning,
    batchCurrentStep,
    showBatchProgress,
    savedBatchState,
    // Actions
    setCenter,
    setZoom,
    setResolution,
    toggleDarkMode,
    setBatchMode,
    setBatchGridCols,
    setBatchGridRows,
    setBatchTileFollowCenter,
    setBatchTileOffsets,
    setBatchTileNames
  };
});
