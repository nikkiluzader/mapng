<template>
  <div v-if="terrainData && !isGenerating" class="space-y-3 pt-4 border-t border-gray-200 dark:border-gray-600">
    <!-- Missing OSM Warning / Action -->
    <div v-if="!terrainData.osmFeatures || terrainData.osmFeatures.length === 0" class="bg-blue-50 dark:bg-blue-900/20 p-2 rounded border border-blue-100 dark:border-blue-800 flex items-center justify-between">
      <div class="text-[10px] text-blue-700 dark:text-blue-300 flex items-center gap-1.5">
        <Trees :size="12" />
        <span>OSM Data missing</span>
      </div>
      <button 
        @click="$emit('fetchOsm')"
        class="text-[10px] font-medium bg-blue-600 hover:bg-blue-700 text-white px-2 py-1 rounded transition-colors"
      >
        Fetch Now
      </button>
    </div>

    <button
      @click="showExports = !showExports"
      class="w-full flex items-center justify-between text-sm font-medium text-emerald-600 dark:text-emerald-400 hover:text-[#FF6600] transition-colors group"
    >
      <span class="flex items-center gap-2">
        <Download :size="16" />
        Ready to Export
        <span class="text-xs text-gray-500 dark:text-gray-400 font-normal">{{ terrainData.width }}x{{ terrainData.height }}</span>
      </span>
      <ChevronDown :size="14" :class="['transition-transform duration-200', showExports ? 'rotate-180' : '']" />
    </button>
    
    <template v-if="showExports">
      <!-- 2D Assets -->
      <div class="space-y-1.5">
        <button
          @click="showExport2D = !showExport2D"
          class="w-full flex items-center justify-between group"
        >
          <h4 class="text-[10px] font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500 group-hover:text-[#FF6600] transition-colors">2D Assets</h4>
          <ChevronDown :size="12" :class="['text-gray-400 dark:text-gray-500 transition-transform duration-200', showExport2D ? 'rotate-180' : '']" />
        </button>
        <div v-if="showExport2D" class="grid grid-cols-2 gap-1.5">
          <!-- Heightmap -->
          <button 
            @click="downloadHeightmap"
            :disabled="isAnyExporting"
            class="relative flex flex-col items-center justify-center p-1.5 bg-white dark:bg-gray-800 hover:bg-gray-50 dark:hover:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded text-sm text-gray-700 dark:text-gray-300 transition-colors group disabled:opacity-50 disabled:cursor-not-allowed h-24 overflow-hidden"
          >
            <div class="w-full h-full flex items-center justify-center mb-0.5 overflow-hidden rounded bg-gray-100 dark:bg-gray-900">
              <Loader2 v-if="isExportingHeightmap" :size="20" class="animate-spin text-[#FF6600]" />
              <img v-else-if="heightmapPreviewUrl" :src="heightmapPreviewUrl" class="w-full h-full object-cover" />
              <Mountain v-else :size="24" class="text-gray-400 dark:text-gray-500" />
            </div>
            <span class="text-[11px] font-medium">Heightmap</span>
            <span class="text-[10px] text-gray-500 dark:text-gray-400">{{ terrainData.width }}px 16-bit grayscale PNG</span>
            <Download v-if="!isAnyExporting" :size="10" class="absolute top-1 right-1 opacity-0 group-hover:opacity-100 transition-opacity text-[#FF6600]" />
          </button>

          <!-- Satellite Texture -->
          <button 
            @click="downloadTexture"
            :disabled="isAnyExporting"
            class="relative flex flex-col items-center justify-center p-1.5 bg-white dark:bg-gray-800 hover:bg-gray-50 dark:hover:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded text-sm text-gray-700 dark:text-gray-300 transition-colors group disabled:opacity-50 disabled:cursor-not-allowed h-24 overflow-hidden"
          >
            <div class="w-full h-full flex items-center justify-center mb-0.5 overflow-hidden rounded bg-gray-100 dark:bg-gray-900">
              <Loader2 v-if="isExportingTexture" :size="20" class="animate-spin text-[#FF6600]" />
              <img v-else-if="terrainData.satelliteTextureUrl" :src="terrainData.satelliteTextureUrl" class="w-full h-full object-cover" />
              <Box v-else :size="24" class="text-gray-400 dark:text-gray-500" />
            </div>
            <span class="text-[11px] font-medium">Satellite</span>
            <span class="text-[10px] text-gray-500 dark:text-gray-400">{{ terrainData.width }}px PNG</span>
            <Download v-if="!isAnyExporting" :size="10" class="absolute top-1 right-1 opacity-0 group-hover:opacity-100 transition-opacity text-[#FF6600]" />
          </button>

          <!-- OSM Texture -->
          <button 
            @click="downloadOSMTexture"
            :disabled="!terrainData.osmTextureUrl || isAnyExporting"
            class="relative flex flex-col items-center justify-center p-1.5 bg-white dark:bg-gray-800 hover:bg-gray-50 dark:hover:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded text-sm text-gray-700 dark:text-gray-300 transition-colors group disabled:opacity-50 disabled:cursor-not-allowed h-24 overflow-hidden"
          >
            <div class="w-full h-full flex items-center justify-center mb-0.5 overflow-hidden rounded bg-gray-100 dark:bg-gray-900">
              <Loader2 v-if="isExportingOSMTexture" :size="20" class="animate-spin text-[#FF6600]" />
              <img v-else-if="terrainData.osmTextureUrl" :src="terrainData.osmTextureUrl" class="w-full h-full object-cover" />
              <Trees v-else :size="24" class="text-gray-400 dark:text-gray-500" />
            </div>
            <span class="text-[11px] font-medium">OSM Texture</span>
            <span class="text-[10px] text-gray-500 dark:text-gray-400">{{ terrainData.width }}px PNG</span>
            <Download v-if="!isAnyExporting" :size="10" class="absolute top-1 right-1 opacity-0 group-hover:opacity-100 transition-opacity text-[#FF6600]" />
          </button>

          <!-- Hybrid Texture -->
          <button 
            @click="downloadHybridTexture"
            :disabled="!terrainData.hybridTextureUrl || isAnyExporting"
            class="relative flex flex-col items-center justify-center p-1.5 bg-white dark:bg-gray-800 hover:bg-gray-50 dark:hover:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded text-sm text-gray-700 dark:text-gray-300 transition-colors group disabled:opacity-50 disabled:cursor-not-allowed h-24 overflow-hidden"
          >
            <div class="w-full h-full flex items-center justify-center mb-0.5 overflow-hidden rounded bg-gray-100 dark:bg-gray-900">
              <Loader2 v-if="isExportingHybridTexture" :size="20" class="animate-spin text-[#FF6600]" />
              <img v-else-if="terrainData.hybridTextureUrl" :src="terrainData.hybridTextureUrl" class="w-full h-full object-cover" />
              <Layers v-else :size="24" class="text-gray-400 dark:text-gray-500" />
            </div>
            <span class="text-[11px] font-medium">Hybrid</span>
            <span class="text-[10px] text-gray-500 dark:text-gray-400">{{ terrainData.width }}px PNG</span>
            <Download v-if="!isAnyExporting" :size="10" class="absolute top-1 right-1 opacity-0 group-hover:opacity-100 transition-opacity text-[#FF6600]" />
          </button>

          <!-- Segmented Satellite Texture -->
          <button 
            @click="downloadSegmentedTexture"
            :disabled="!terrainData.segmentedTextureUrl || isAnyExporting"
            class="relative flex flex-col items-center justify-center p-1.5 bg-white dark:bg-gray-800 hover:bg-gray-50 dark:hover:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded text-sm text-gray-700 dark:text-gray-300 transition-colors group disabled:opacity-50 disabled:cursor-not-allowed h-24 overflow-hidden"
          >
            <div class="w-full h-full flex items-center justify-center mb-0.5 overflow-hidden rounded bg-gray-100 dark:bg-gray-900">
              <Loader2 v-if="isExportingSegmentedTexture" :size="20" class="animate-spin text-[#FF6600]" />
              <img v-else-if="terrainData.segmentedTextureUrl" :src="terrainData.segmentedTextureUrl" class="w-full h-full object-cover" />
              <Paintbrush v-else :size="24" class="text-gray-400 dark:text-gray-500" />
            </div>
            <span class="text-[11px] font-medium">Segmented</span>
            <span class="text-[10px] text-gray-500 dark:text-gray-400">{{ terrainData.width }}px PNG</span>
            <Download v-if="!isAnyExporting" :size="10" class="absolute top-1 right-1 opacity-0 group-hover:opacity-100 transition-opacity text-[#FF6600]" />
          </button>

          <!-- Segmented Hybrid Texture -->
          <button 
            @click="downloadSegmentedHybridTexture"
            :disabled="!terrainData.segmentedHybridTextureUrl || isAnyExporting"
            class="relative flex flex-col items-center justify-center p-1.5 bg-white dark:bg-gray-800 hover:bg-gray-50 dark:hover:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded text-sm text-gray-700 dark:text-gray-300 transition-colors group disabled:opacity-50 disabled:cursor-not-allowed h-24 overflow-hidden"
          >
            <div class="w-full h-full flex items-center justify-center mb-0.5 overflow-hidden rounded bg-gray-100 dark:bg-gray-900">
              <Loader2 v-if="isExportingSegmentedHybridTexture" :size="20" class="animate-spin text-[#FF6600]" />
              <img v-else-if="terrainData.segmentedHybridTextureUrl" :src="terrainData.segmentedHybridTextureUrl" class="w-full h-full object-cover" />
              <Paintbrush v-else :size="24" class="text-gray-400 dark:text-gray-500" />
            </div>
            <span class="text-[11px] font-medium">Seg. Hybrid</span>
            <span class="text-[10px] text-gray-500 dark:text-gray-400">{{ terrainData.width }}px PNG</span>
            <Download v-if="!isAnyExporting" :size="10" class="absolute top-1 right-1 opacity-0 group-hover:opacity-100 transition-opacity text-[#FF6600]" />
          </button>

          <!-- Road Mask -->
          <button 
            @click="downloadRoadMask"
            :disabled="!terrainData.osmFeatures || terrainData.osmFeatures.length === 0 || isAnyExporting"
            class="relative flex flex-col items-center justify-center p-1.5 bg-white dark:bg-gray-800 hover:bg-gray-50 dark:hover:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded text-sm text-gray-700 dark:text-gray-300 transition-colors group disabled:opacity-50 disabled:cursor-not-allowed h-24 overflow-hidden"
          >
            <div class="w-full h-full flex items-center justify-center mb-0.5 overflow-hidden rounded bg-gray-100 dark:bg-gray-900">
              <Loader2 v-if="isExportingRoadMask" :size="20" class="animate-spin text-[#FF6600]" />
              <img v-else-if="roadMaskPreviewUrl" :src="roadMaskPreviewUrl" class="w-full h-full object-cover" />
              <Route v-else :size="24" class="text-gray-400 dark:text-gray-500" />
            </div>
            <span class="text-[11px] font-medium">Road Mask</span>
            <span class="text-[10px] text-gray-500 dark:text-gray-400">{{ terrainData.width }}px 16-bit grayscale PNG</span>
            <Download v-if="!isAnyExporting" :size="10" class="absolute top-1 right-1 opacity-0 group-hover:opacity-100 transition-opacity text-[#FF6600]" />
          </button>
        </div>
      </div>

      <!-- 3D Models -->
      <div class="space-y-1.5">
        <button
          @click="showExport3D = !showExport3D"
          class="w-full flex items-center justify-between group"
        >
          <h4 class="text-[10px] font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500 group-hover:text-[#FF6600] transition-colors">3D Models</h4>
          <ChevronDown :size="12" :class="['text-gray-400 dark:text-gray-500 transition-transform duration-200', showExport3D ? 'rotate-180' : '']" />
        </button>

        <template v-if="showExport3D">
          <!-- Shared 3D options -->
          <div class="space-y-2 px-2 py-2 bg-gray-50 dark:bg-gray-700/50 rounded border border-gray-200 dark:border-gray-600">
            <div class="flex items-center gap-1.5">
              <span class="text-[9px] text-gray-500 dark:text-gray-400">Center Texture:</span>
              <select v-model="modelCenterTextureType" class="text-[9px] bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded px-1.5 py-0.5 text-gray-600 dark:text-gray-300 cursor-pointer">
                <option value="satellite">Satellite</option>
                <option value="osm" :disabled="!terrainData?.osmTextureUrl">OSM</option>
                <option value="hybrid" :disabled="!terrainData?.hybridTextureUrl">Hybrid</option>
                <option value="segmented" :disabled="!terrainData?.segmentedTextureUrl">Segmented</option>
                <option value="segmentedHybrid" :disabled="!terrainData?.segmentedHybridTextureUrl">Seg. Hybrid</option>
                <option value="none">None</option>
              </select>
            </div>
            <div class="flex items-center gap-2 flex-nowrap overflow-x-auto whitespace-nowrap pb-0.5">
              <span class="text-[9px] text-gray-500 dark:text-gray-400">Tiles:</span>
              <label class="flex items-center gap-1 cursor-pointer">
                <input type="radio" v-model="modelTileSelection" value="center-only" class="accent-[#FF6600] w-3 h-3" />
                <span class="text-[9px] text-gray-500 dark:text-gray-400">Center</span>
              </label>
              <label class="flex items-center gap-1 cursor-pointer">
                <input type="radio" v-model="modelTileSelection" value="center-plus-surroundings" class="accent-[#FF6600] w-3 h-3" />
                <span class="text-[9px] text-gray-500 dark:text-gray-400">Center + Surroundings</span>
              </label>
              <label class="flex items-center gap-1 cursor-pointer">
                <input type="radio" v-model="modelTileSelection" value="surroundings-only" class="accent-[#FF6600] w-3 h-3" />
                <span class="text-[9px] text-gray-500 dark:text-gray-400">Surroundings Only</span>
              </label>
            </div>
          </div>

          <div class="grid grid-cols-2 gap-1.5">
            <!-- GLB Model -->
            <button 
              @click="handleGLBExport"
              :disabled="isAnyExporting"
              class="relative flex flex-col items-center justify-center p-2 bg-white dark:bg-gray-800 hover:bg-gray-50 dark:hover:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded text-sm text-gray-700 dark:text-gray-300 transition-colors group disabled:opacity-50 disabled:cursor-not-allowed h-20"
            >
              <div class="w-full h-full flex items-center justify-center mb-0.5">
                <Loader2 v-if="isExportingGLB" :size="20" class="animate-spin text-[#FF6600]" />
                <Box v-else :size="24" class="text-gray-400 dark:text-gray-500" />
              </div>
              <span class="text-[11px] font-medium">GLB Model</span>
              <span class="text-[10px] text-gray-500 dark:text-gray-400">.glb binary</span>
              <Download v-if="!isAnyExporting" :size="10" class="absolute top-1 right-1 opacity-0 group-hover:opacity-100 transition-opacity text-[#FF6600]" />
            </button>

            <!-- DAE (Collada) Model -->
            <button 
              @click="handleDAEExport"
              :disabled="isAnyExporting"
              class="relative flex flex-col items-center justify-center p-2 bg-white dark:bg-gray-800 hover:bg-gray-50 dark:hover:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded text-sm text-gray-700 dark:text-gray-300 transition-colors group disabled:opacity-50 disabled:cursor-not-allowed h-20"
            >
              <div class="w-full h-full flex items-center justify-center mb-0.5">
                <Loader2 v-if="isExportingDAE" :size="20" class="animate-spin text-[#FF6600]" />
                <FileCode v-else :size="24" class="text-gray-400 dark:text-gray-500" />
              </div>
              <span class="text-[11px] font-medium">Collada DAE</span>
              <span class="text-[10px] text-gray-500 dark:text-gray-400">.dae + textures</span>
              <Download v-if="!isAnyExporting" :size="10" class="absolute top-1 right-1 opacity-0 group-hover:opacity-100 transition-opacity text-[#FF6600]" />
            </button>
            
            <!-- TER (BeamNG) Model -->
            <button 
              @click="handleTERExport"
              :disabled="isAnyExporting"
              class="relative flex flex-col items-center justify-center p-2 bg-white dark:bg-gray-800 hover:bg-gray-50 dark:hover:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded text-sm text-gray-700 dark:text-gray-300 transition-colors group disabled:opacity-50 disabled:cursor-not-allowed h-20"
            >
              <div class="w-full h-full flex items-center justify-center mb-0.5">
                <Loader2 v-if="isExportingTER" :size="20" class="animate-spin text-[#FF6600]" />
                <FileCode v-else :size="24" class="text-gray-400 dark:text-gray-500" />
              </div>
              <span class="text-[11px] font-medium">BeamNG Terrain</span>
              <span class="text-[10px] text-gray-500 dark:text-gray-400">.ter heightmap</span>
              <Download v-if="!isAnyExporting" :size="10" class="absolute top-1 right-1 opacity-0 group-hover:opacity-100 transition-opacity text-[#FF6600]" />
            </button>
          </div>
        </template>
      </div>

      <!-- Geo Data -->
      <div class="space-y-1.5">
        <button
          @click="showExportGeo = !showExportGeo"
          class="w-full flex items-center justify-between group"
        >
          <h4 class="text-[10px] font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500 group-hover:text-[#FF6600] transition-colors">Geo Data</h4>
          <ChevronDown :size="12" :class="['text-gray-400 dark:text-gray-500 transition-transform duration-200', showExportGeo ? 'rotate-180' : '']" />
        </button>
        <div v-if="showExportGeo" class="grid grid-cols-2 gap-1.5">
          <!-- GeoTIFF -->
          <button 
            @click="downloadGeoTIFF"
            :disabled="isAnyExporting"
            class="relative flex flex-col items-center justify-center p-2 bg-white dark:bg-gray-800 hover:bg-gray-50 dark:hover:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded text-sm text-gray-700 dark:text-gray-300 transition-colors group disabled:opacity-50 disabled:cursor-not-allowed h-20"
          >
            <div class="w-full h-full flex items-center justify-center mb-0.5">
              <Loader2 v-if="isExportingGeoTIFF" :size="20" class="animate-spin text-[#FF6600]" />
              <FileCode v-else :size="24" class="text-gray-400 dark:text-gray-500" />
            </div>
            <span class="text-[11px] font-medium">GeoTIFF</span>
            <span class="text-[10px] text-gray-500 dark:text-gray-400">{{ terrainData?.sourceGeoTiffs ? terrainData.sourceGeoTiffs.source.toUpperCase() : 'WGS84' }}</span>
            <Download v-if="!isAnyExporting" :size="10" class="absolute top-1 right-1 opacity-0 group-hover:opacity-100 transition-opacity text-[#FF6600]" />
          </button>

          <!-- OSM GeoJSON -->
          <button 
            @click="downloadOSM"
            :disabled="!terrainData.osmFeatures || terrainData.osmFeatures.length === 0 || isAnyExporting"
            class="relative flex flex-col items-center justify-center p-2 bg-white dark:bg-gray-800 hover:bg-gray-50 dark:hover:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded text-sm text-gray-700 dark:text-gray-300 transition-colors group disabled:opacity-50 disabled:cursor-not-allowed h-20"
          >
            <div class="w-full h-full flex items-center justify-center mb-0.5">
              <Loader2 v-if="isExportingOSM" :size="20" class="animate-spin text-[#FF6600]" />
              <FileJson v-else :size="24" class="text-gray-400 dark:text-gray-500" />
            </div>
            <span class="text-[11px] font-medium">GeoJSON</span>
            <span class="text-[10px] text-gray-500 dark:text-gray-400">OSM vectors</span>
            <Download v-if="!isAnyExporting" :size="10" class="absolute top-1 right-1 opacity-0 group-hover:opacity-100 transition-opacity text-[#FF6600]" />
          </button>
        </div>
      </div>
    </template>
  </div>
</template>

<script setup>
import { ref, computed, watch, nextTick } from 'vue';
import {
  Download, ChevronDown, Loader2, Mountain, Box, Trees, Layers, Paintbrush, Route, FileCode, FileJson
} from 'lucide-vue-next';
import { buildRunConfiguration as buildRunConfigurationBase } from '../../services/runConfiguration';
import { generateHeightmapBlob, generateTerBlob } from '../../services/batchExports';
import { exportToGLB, exportToDAE } from '../../services/export3d';
import { exportGeoTiff } from '../../services/exportGeoTiff';
import { buildCommonTraceMetadata, downloadJsonFile } from '../../services/traceability';
import { createWGS84ToLocal } from '../../services/geoUtils';

const props = defineProps({
  terrainData: { type: Object, default: null },
  isGenerating: { type: Boolean, default: false },
  center: { type: Object, required: true },
  zoom: { type: Number, required: true },
  resolution: { type: Number, required: true },
  elevationSource: { type: String, default: 'default' },
  gpxzApiKey: { type: String, default: '' },
  gpxzStatus: { type: Object, default: null },
  fetchOSM: { type: Boolean, default: true },
  surroundingTilePositions: { type: Array, default: () => [] },
});

const emit = defineEmits(['fetchOsm']);

// Export states
const isExportingHeightmap = ref(false);
const isExportingTexture = ref(false);
const isExportingOSMTexture = ref(false);
const isExportingHybridTexture = ref(false);
const isExportingSegmentedTexture = ref(false);
const isExportingSegmentedHybridTexture = ref(false);
const isExportingRoadMask = ref(false);
const isExportingGeoTIFF = ref(false);
const isExportingGLB = ref(false);
const isExportingDAE = ref(false);
const isExportingTER = ref(false);
const isExportingOSM = ref(false);

const isAnyExporting = computed(() => (
  isExportingHeightmap.value ||
  isExportingTexture.value ||
  isExportingOSMTexture.value ||
  isExportingHybridTexture.value ||
  isExportingSegmentedTexture.value ||
  isExportingSegmentedHybridTexture.value ||
  isExportingRoadMask.value ||
  isExportingGeoTIFF.value ||
  isExportingGLB.value ||
  isExportingDAE.value ||
  isExportingTER.value ||
  isExportingOSM.value
));

const modelCenterTextureType = ref('none');
const modelTileSelection = ref('center-only');

// Collapsible section states
const showExports = ref(localStorage.getItem('mapng_showExports') !== 'false');
const showExport2D = ref(localStorage.getItem('mapng_showExport2D') !== 'false');
const showExport3D = ref(localStorage.getItem('mapng_showExport3D') !== 'false');
const showExportGeo = ref(localStorage.getItem('mapng_showExportGeo') !== 'false');

watch(showExports, (v) => localStorage.setItem('mapng_showExports', String(v)));
watch(showExport2D, (v) => localStorage.setItem('mapng_showExport2D', String(v)));
watch(showExport3D, (v) => localStorage.setItem('mapng_showExport3D', String(v)));
watch(showExportGeo, (v) => localStorage.setItem('mapng_showExportGeo', String(v)));

// Generate a small grayscale heightmap preview
const heightmapPreviewUrl = computed(() => {
  if (!props.terrainData?.heightMap) return null;
  const src = props.terrainData;
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  const imgData = ctx.createImageData(size, size);
  const range = src.maxHeight - src.minHeight;
  const stepX = src.width / size;
  const stepY = src.height / size;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const srcX = Math.min(Math.floor(x * stepX), src.width - 1);
      const srcY = Math.min(Math.floor(y * stepY), src.height - 1);
      const h = src.heightMap[srcY * src.width + srcX];
      const v = range > 0 ? Math.floor(((h - src.minHeight) / range) * 255) : 0;
      const idx = (y * size + x) * 4;
      imgData.data[idx] = v;
      imgData.data[idx + 1] = v;
      imgData.data[idx + 2] = v;
      imgData.data[idx + 3] = 255;
    }
  }
  ctx.putImageData(imgData, 0, 0);
  return canvas.toDataURL('image/png');
});

// Generate a small road mask preview
const roadMaskPreviewUrl = computed(() => {
  if (!props.terrainData?.osmFeatures || props.terrainData.osmFeatures.length === 0) return null;
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  const src = props.terrainData;
  const scaleX = size / src.width;
  const scaleY = size / src.height;
  ctx.fillStyle = 'black';
  ctx.fillRect(0, 0, size, size);
  const toLocal = createWGS84ToLocal(props.center.lat, props.center.lng);
  ctx.strokeStyle = 'white';
  ctx.lineWidth = Math.max(2, 8 * scaleX);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  src.osmFeatures.forEach(feature => {
    if (feature.type !== 'road') return;
    const highway = feature.tags?.highway;
    const exclude = ['footway', 'path', 'pedestrian', 'steps', 'cycleway', 'bridleway', 'corridor'];
    if (highway && exclude.includes(highway)) return;
    ctx.beginPath();
    feature.geometry.forEach((pt, index) => {
      const [x, y] = toLocal.forward([pt.lng, pt.lat]);
      const u = (x + src.width / 2) * scaleX;
      const v = (src.height / 2 - y) * scaleY;
      if (index === 0) ctx.moveTo(u, v);
      else ctx.lineTo(u, v);
    });
    ctx.stroke();
  });
  return canvas.toDataURL('image/png');
});

const buildRunConfiguration = () => ({
  ...buildRunConfigurationBase({
    center: props.center,
    zoom: props.zoom,
    resolution: props.resolution,
    includeOSM: props.fetchOSM,
    elevationSource: props.elevationSource,
    gpxzApiKey: props.gpxzApiKey,
    gpxzStatus: props.gpxzStatus,
    terrainData: props.terrainData,
  }),
  modelOptions: {
    centerTextureType: modelCenterTextureType.value,
    tileSelection: modelTileSelection.value,
    includeSurroundings: modelTileSelection.value !== 'center-only',
  },
});

const buildExportMetadata = (exportType, filename, extra = {}) => {
  const runCfg = buildRunConfiguration();
  return buildCommonTraceMetadata({
    mode: 'single',
    center: runCfg.center,
    zoom: runCfg.zoom,
    resolution: runCfg.resolution,
    terrainData: props.terrainData,
    textureModes: runCfg.textureModes,
    osmQuery: runCfg.osmQuery,
    gpxz: runCfg.gpxzStatus,
    extra: {
      export: {
        type: exportType,
        filename,
      },
      runConfiguration: runCfg,
      ...extra,
    },
  });
};

const ENABLE_METADATA_SIDECARS = false;

const isJsonMimeType = (mime = '') => {
  const normalized = String(mime).toLowerCase();
  return normalized.includes('application/json') || normalized.includes('text/json');
};

const ensureDownloadBlobType = async (blob, expectedMimeType, fallbackMimeType = expectedMimeType) => {
  if (!blob) throw new Error(`Missing export blob for ${expectedMimeType}.`);
  if (isJsonMimeType(blob.type)) {
    throw new Error(`Received JSON payload instead of ${expectedMimeType} export data.`);
  }
  const currentType = String(blob.type || '').toLowerCase();
  const expectedType = String(expectedMimeType || '').toLowerCase();
  if (!expectedType || currentType === expectedType) {
    if (!blob.type && (fallbackMimeType || expectedMimeType)) {
      const buffer = await blob.arrayBuffer();
      return new Blob([buffer], { type: fallbackMimeType || expectedMimeType });
    }
    return blob;
  }
  const buffer = await blob.arrayBuffer();
  return new Blob([buffer], { type: fallbackMimeType || expectedMimeType || 'application/octet-stream' });
};

const downloadBlobUrlAsFile = async (url, filename, expectedMimePrefix = 'image/', fallbackMimeType = 'application/octet-stream') => {
  const response = await fetch(url);
  const blob = await response.blob();
  if (isJsonMimeType(blob.type)) {
    throw new Error(`Received JSON payload for ${filename} instead of binary file.`);
  }
  let outBlob = blob;
  const hasExpectedType = expectedMimePrefix
    ? (blob.type || '').toLowerCase().startsWith(expectedMimePrefix.toLowerCase())
    : true;
  if (!hasExpectedType || !blob.type) {
    const buffer = await blob.arrayBuffer();
    outBlob = new Blob([buffer], { type: fallbackMimeType });
  }
  const typedBlob = await ensureDownloadBlobType(outBlob, fallbackMimeType, fallbackMimeType);
  triggerDownload(typedBlob, filename);
};

const triggerDownload = (blob, filename) => {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.download = filename;
  link.href = url;
  link.click();
  URL.revokeObjectURL(url);
};

const yieldToUi = async () => {
  await nextTick();
  await new Promise((resolve) => {
    requestAnimationFrame(() => {
      setTimeout(resolve, 0);
    });
  });
};

const downloadMetadataSidecar = (exportFilename, metadata) => {
  if (!ENABLE_METADATA_SIDECARS) return;
  const baseName = exportFilename.replace(/\.[^.]+$/, '');
  downloadJsonFile(metadata, `${baseName}.metadata.json`);
};

const downloadHeightmap = async () => {
  if (!props.terrainData?.heightMap) return;
  isExportingHeightmap.value = true;
  try {
    await yieldToUi();
    const blob = generateHeightmapBlob(props.terrainData);
    const typedBlob = await ensureDownloadBlobType(blob, 'image/png');
    const filename = `heightmap_${props.center.lat.toFixed(4)}_${props.center.lng.toFixed(4)}.png`;
    triggerDownload(typedBlob, filename);
    const metadata = buildExportMetadata('heightmap', filename);
    downloadMetadataSidecar(filename, metadata);
  } catch (error) {
    console.error('Failed to export heightmap:', error);
    alert('Failed to export heightmap. See console for details.');
  } finally {
    isExportingHeightmap.value = false;
  }
};

const downloadTexture = async () => {
  if (!props.terrainData?.satelliteTextureUrl) return;
  isExportingTexture.value = true;
  try {
    await yieldToUi();
    const filename = `texture_${props.center.lat.toFixed(4)}_${props.center.lng.toFixed(4)}.png`;
    await downloadBlobUrlAsFile(props.terrainData.satelliteTextureUrl, filename, 'image/', 'image/png');
    const metadata = buildExportMetadata('texture_satellite', filename);
    downloadMetadataSidecar(filename, metadata);
  } catch (error) {
    console.error('Failed to export texture:', error);
    alert('Failed to export texture. See console for details.');
  } finally {
    isExportingTexture.value = false;
  }
};

const downloadOSMTexture = async () => {
  if (!props.terrainData?.osmTextureUrl) return;
  isExportingOSMTexture.value = true;
  try {
    await yieldToUi();
    const filename = `osm_texture_${props.center.lat.toFixed(4)}_${props.center.lng.toFixed(4)}.png`;
    await downloadBlobUrlAsFile(props.terrainData.osmTextureUrl, filename, 'image/', 'image/png');
    const metadata = buildExportMetadata('texture_osm', filename);
    downloadMetadataSidecar(filename, metadata);
  } catch (error) {
    console.error('Failed to export OSM texture:', error);
    alert('Failed to export OSM texture. See console for details.');
  } finally {
    isExportingOSMTexture.value = false;
  }
};

const downloadHybridTexture = async () => {
  if (!props.terrainData?.hybridTextureUrl) return;
  isExportingHybridTexture.value = true;
  try {
    await yieldToUi();
    const filename = `hybrid_texture_${props.center.lat.toFixed(4)}_${props.center.lng.toFixed(4)}.png`;
    await downloadBlobUrlAsFile(props.terrainData.hybridTextureUrl, filename, 'image/', 'image/png');
    const metadata = buildExportMetadata('texture_hybrid', filename);
    downloadMetadataSidecar(filename, metadata);
  } catch (error) {
    console.error('Failed to export hybrid texture:', error);
    alert('Failed to export hybrid texture. See console for details.');
  } finally {
    isExportingHybridTexture.value = false;
  }
};

const downloadSegmentedTexture = async () => {
  if (!props.terrainData?.segmentedTextureUrl) return;
  isExportingSegmentedTexture.value = true;
  try {
    await yieldToUi();
    const filename = `segmented_texture_${props.center.lat.toFixed(4)}_${props.center.lng.toFixed(4)}.png`;
    await downloadBlobUrlAsFile(props.terrainData.segmentedTextureUrl, filename, 'image/', 'image/png');
    const metadata = buildExportMetadata('texture_segmented', filename);
    downloadMetadataSidecar(filename, metadata);
  } catch (error) {
    console.error('Failed to export segmented texture:', error);
    alert('Failed to export segmented texture. See console for details.');
  } finally {
    isExportingSegmentedTexture.value = false;
  }
};

const downloadSegmentedHybridTexture = async () => {
  if (!props.terrainData?.segmentedHybridTextureUrl) return;
  isExportingSegmentedHybridTexture.value = true;
  try {
    await yieldToUi();
    const filename = `segmented_hybrid_texture_${props.center.lat.toFixed(4)}_${props.center.lng.toFixed(4)}.png`;
    await downloadBlobUrlAsFile(props.terrainData.segmentedHybridTextureUrl, filename, 'image/', 'image/png');
    const metadata = buildExportMetadata('texture_segmented_hybrid', filename);
    downloadMetadataSidecar(filename, metadata);
  } catch (error) {
    console.error('Failed to export segmented hybrid texture:', error);
    alert('Failed to export segmented hybrid texture. See console for details.');
  } finally {
    isExportingSegmentedHybridTexture.value = false;
  }
};

const downloadRoadMask = async () => {
  if (!props.terrainData?.osmFeatures || props.terrainData.osmFeatures.length === 0) return;
  isExportingRoadMask.value = true;
  try {
    await yieldToUi();
    const canvas = document.createElement('canvas');
    canvas.width = props.terrainData.width;
    canvas.height = props.terrainData.height;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = 'black';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    const toLocal = createWGS84ToLocal(props.center.lat, props.center.lng);
    ctx.strokeStyle = 'white';
    ctx.lineWidth = Math.max(2, 8 * (canvas.width / props.terrainData.width));
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    props.terrainData.osmFeatures.forEach(feature => {
      if (feature.type !== 'road') return;
      const highway = feature.tags?.highway;
      const exclude = ['footway', 'path', 'pedestrian', 'steps', 'cycleway', 'bridleway', 'corridor'];
      if (highway && exclude.includes(highway)) return;
      ctx.beginPath();
      feature.geometry.forEach((pt, index) => {
        const [x, y] = toLocal.forward([pt.lng, pt.lat]);
        const u = x + props.terrainData.width / 2;
        const v = props.terrainData.height / 2 - y;
        if (index === 0) ctx.moveTo(u, v);
        else ctx.lineTo(u, v);
      });
      ctx.stroke();
    });
    const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
    const typedBlob = await ensureDownloadBlobType(blob, 'image/png');
    const filename = `road_mask_${props.center.lat.toFixed(4)}_${props.center.lng.toFixed(4)}.png`;
    triggerDownload(typedBlob, filename);
    const metadata = buildExportMetadata('road_mask', filename);
    downloadMetadataSidecar(filename, metadata);
  } catch (error) {
    console.error('Failed to export road mask:', error);
    alert('Failed to export road mask. See console for details.');
  } finally {
    isExportingRoadMask.value = false;
  }
};

const downloadGeoTIFF = async () => {
  if (!props.terrainData) return;
  isExportingGeoTIFF.value = true;
  try {
    await yieldToUi();
    const { blob: tiffBlob, filename } = await exportGeoTiff(props.terrainData, props.center);
    const typedBlob = await ensureDownloadBlobType(tiffBlob, 'image/tiff');
    triggerDownload(typedBlob, filename);
    const metadata = buildExportMetadata('geotiff', filename);
    downloadMetadataSidecar(filename, metadata);
  } catch (error) {
    console.error('Failed to export GeoTIFF:', error);
    alert('Failed to export GeoTIFF. See console for details.');
  } finally {
    isExportingGeoTIFF.value = false;
  }
};

const downloadOSM = async () => {
  if (!props.terrainData?.osmFeatures || props.terrainData.osmFeatures.length === 0) return;
  isExportingOSM.value = true;
  try {
    await yieldToUi();
    const geojson = {
      type: 'FeatureCollection',
      features: props.terrainData.osmFeatures.map(f => ({
        type: 'Feature',
        geometry: {
          type: 'LineString',
          coordinates: f.geometry.map(p => [p.lng, p.lat])
        },
        properties: f.tags
      }))
    };
    const filename = `osm_features_${props.center.lat.toFixed(4)}_${props.center.lng.toFixed(4)}.geojson`;
    downloadJsonFile(geojson, filename);
    const metadata = buildExportMetadata('osm_geojson', filename);
    downloadMetadataSidecar(filename, metadata);
  } finally {
    isExportingOSM.value = false;
  }
};

const handleGLBExport = async () => {
  if (!props.terrainData) return;
  isExportingGLB.value = true;
  try {
    await yieldToUi();
    const blob = await exportToGLB(props.terrainData, {
      centerTextureType: modelCenterTextureType.value,
      tileSelection: modelTileSelection.value,
      surroundingTilePositions: props.surroundingTilePositions,
      center: props.center,
      resolution: props.resolution,
      returnBlob: true
    });
    const typedBlob = await ensureDownloadBlobType(blob, 'model/gltf-binary', 'application/octet-stream');
    const filename = `terrain_${props.center.lat.toFixed(4)}_${props.center.lng.toFixed(4)}.glb`;
    triggerDownload(typedBlob, filename);
    const metadata = buildExportMetadata('glb', filename, {
      modelOptions: {
        centerTextureType: modelCenterTextureType.value,
        tileSelection: modelTileSelection.value,
      }
    });
    downloadMetadataSidecar(filename, metadata);
  } catch (error) {
    console.error('Failed to export GLB:', error);
    alert('Failed to export GLB. See console for details.');
  } finally {
    isExportingGLB.value = false;
  }
};

const handleDAEExport = async () => {
  if (!props.terrainData) return;
  isExportingDAE.value = true;
  try {
    await yieldToUi();
    const zipBlob = await exportToDAE(props.terrainData, {
      centerTextureType: modelCenterTextureType.value,
      tileSelection: modelTileSelection.value,
      surroundingTilePositions: props.surroundingTilePositions,
      center: props.center,
      resolution: props.resolution,
      returnBlob: true
    });
    const typedBlob = await ensureDownloadBlobType(zipBlob, 'application/zip');
    const filename = `terrain_${props.center.lat.toFixed(4)}_${props.center.lng.toFixed(4)}.zip`;
    triggerDownload(typedBlob, filename);
    const metadata = buildExportMetadata('dae_zip', filename, {
      modelOptions: {
        centerTextureType: modelCenterTextureType.value,
        tileSelection: modelTileSelection.value,
      }
    });
    downloadMetadataSidecar(filename, metadata);
  } catch (error) {
    console.error('Failed to export DAE:', error);
    alert('Failed to export DAE. See console for details.');
  } finally {
    isExportingDAE.value = false;
  }
};

const handleTERExport = async () => {
  if (!props.terrainData) return;
  isExportingTER.value = true;
  try {
    await yieldToUi();
    const terBlob = await generateTerBlob(props.terrainData);
    const filename = `terrain_${props.center.lat.toFixed(4)}_${props.center.lng.toFixed(4)}.ter`;
    
    // Create download link
    const url = URL.createObjectURL(terBlob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    
    // Cleanup
    document.body.removeChild(link);
    setTimeout(() => URL.revokeObjectURL(url), 100);

    const metadata = buildCommonTraceMetadata({
      center: props.center,
      resolution: props.resolution,
      exportType: 'terrain_ter',
      size: props.terrainData.width,
      date_iso: new Date().toISOString()
    });
    downloadMetadataSidecar(filename, metadata);
  } catch (error) {
    console.error('Failed to export TER:', error);
    alert('Failed to export TER. See console for details.');
  } finally {
    isExportingTER.value = false;
  }
};
</script>
