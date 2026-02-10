<template>
  <div class="space-y-6">
    <!-- Resolution & Settings -->
    <div class="space-y-4">
      <label class="text-sm font-medium text-gray-700 dark:text-gray-300 flex items-center gap-2">
        <Box :size="16" class="text-gray-700 dark:text-gray-300" />
        Output Settings
      </label>

      <div class="space-y-1">
          <span class="text-xs text-gray-500 dark:text-gray-400">Resolution (Output Size)</span>
          <select 
              :value="resolution" 
              @change="$emit('resolutionChange', parseInt($event.target.value))"
              class="w-full bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded px-2 py-2 text-sm text-gray-900 dark:text-white focus:ring-2 focus:ring-[#FF6600] focus:border-[#FF6600] outline-none"
          >
              <option :value="512">512 x 512 px (Fast)</option>
              <option :value="1024">1024 x 1024 px (Standard)</option>
              <option :value="2048">2048 x 2048 px (High Detail)</option>
              <option :value="4096">4096 x 4096 px (Very High)</option>
              <option :value="8192">8192 x 8192 px (Ultra)</option>
          </select>
          <div class="text-[10px] text-gray-500 dark:text-gray-400 pt-1 space-y-1">
              <p>• Downloads match selected size exactly.</p>
              <p>• Fetches max detail (Terrain Z15, Sat Z17).</p>
              <p v-if="resolution >= 4096" class="text-amber-600 dark:text-amber-500 font-medium">⚠️ Large area. May require high RAM.</p>
              <p>• Current Scale: <span class="text-[#FF6600]">{{ metersPerPixel.toFixed(2) }}m/px</span></p>
          </div>
      </div>

      <!-- OSM Toggle -->
      <div class="flex items-center justify-between p-2 rounded bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600">
          <label class="text-xs text-gray-700 dark:text-gray-300 flex items-center gap-2 cursor-pointer">
              <Trees :size="12" class="text-emerald-600 dark:text-emerald-400" />
              Include OSM Features
          </label>
          <input 
              type="checkbox" 
              v-model="fetchOSM"
              class="accent-[#FF6600] w-4 h-4 cursor-pointer"
          />
      </div>
 
      <!-- Elevation Source Selection -->
      <div class="space-y-2">
        <label class="text-xs font-medium text-gray-700 dark:text-gray-300 flex items-center gap-2">
            <Mountain :size="12" />
            Elevation Data Source
        </label>
        
        <div class="space-y-2 bg-gray-50 dark:bg-gray-700 p-2 rounded border border-gray-200 dark:border-gray-600">
            <!-- Default -->
            <label class="flex items-start gap-2 cursor-pointer p-1 hover:bg-gray-100 dark:hover:bg-gray-600 rounded transition-colors">
                <input type="radio" v-model="elevationSource" value="default" class="mt-0.5 accent-[#FF6600]" />
                <div class="space-y-0.5">
                    <span class="block text-xs font-medium text-gray-900 dark:text-white">Standard (30m Global)</span>
                    <span class="block text-[10px] text-gray-500 dark:text-gray-400 leading-tight">
                        Amazon Terrarium (SRTM). Reliable global coverage. Good for general terrain.
                    </span>
                </div>
            </label>

            <!-- USGS -->
            <label class="flex items-start gap-2 cursor-pointer p-1 hover:bg-gray-100 dark:hover:bg-gray-600 rounded transition-colors">
                <input type="radio" v-model="elevationSource" value="usgs" class="mt-0.5 accent-[#FF6600]" />
                <div class="space-y-0.5">
                    <div class="flex items-center gap-2">
                        <span class="block text-xs font-medium text-gray-900 dark:text-white">USGS 1m DEM (USA Only)</span>
                        <span v-if="usgsStatus" class="text-[9px] text-emerald-600 dark:text-emerald-400 font-bold px-1 bg-emerald-100 dark:bg-emerald-900/30 rounded">ONLINE</span>
                        <span v-else-if="usgsStatus === false" class="text-[9px] text-red-600 dark:text-red-400 font-bold px-1 bg-red-100 dark:bg-red-900/30 rounded">OFFLINE</span>
                    </div>
                    <span class="block text-[10px] text-gray-500 dark:text-gray-400 leading-tight">
                        High-precision data for USA. Falls back to Standard if data is missing/corrupt.
                    </span>
                </div>
            </label>

            <!-- GPXZ -->
            <label class="flex items-start gap-2 cursor-pointer p-1 hover:bg-gray-100 dark:hover:bg-gray-600 rounded transition-colors">
                <input type="radio" v-model="elevationSource" value="gpxz" class="mt-0.5 accent-[#FF6600]" />
                <div class="space-y-0.5 w-full">
                    <span class="block text-xs font-medium text-gray-900 dark:text-white">GPXZ (Premium Global)</span>
                    <span class="block text-[10px] text-gray-500 dark:text-gray-400 leading-tight">
                        Highest quality global data. Requires API Key. <a href="https://www.gpxz.io/docs/dataset#coverage" target="_blank" class="text-[#FF6600] hover:underline" @click.stop>Check Coverage</a>
                    </span>
                    
                    <div v-if="elevationSource === 'gpxz'" class="mt-2 animate-in fade-in slide-in-from-top-1">
                        <input 
                            type="password" 
                            v-model="gpxzApiKey"
                            placeholder="Enter GPXZ API Key"
                            class="w-full bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded px-2 py-1 text-xs text-gray-900 dark:text-white focus:ring-1 focus:ring-[#FF6600] outline-none"
                        />
                        <p class="text-[10px] text-gray-500 dark:text-gray-400 leading-tight mt-1">
                            Free tier: 100 req/day. <a href="https://www.gpxz.io/" target="_blank" class="text-[#FF6600] hover:underline">Get a key</a>
                        </p>
                        <p v-if="isAreaLargeForGPXZ" class="text-[10px] text-orange-600 dark:text-orange-400 font-medium leading-tight mt-1">
                            ⚠️ Large area ({{ areaSqKm.toFixed(2) }} km²). Uses multiple API calls.
                        </p>
                    </div>
                </div>
            </label>
        </div>
      </div>
    </div>

    <hr class="border-gray-200 dark:border-gray-600" />

    <!-- Coordinates -->
    <div class="space-y-2">
      <label class="text-sm font-medium text-gray-700 dark:text-gray-300 flex items-center gap-2">
        <MapPin :size="16" class="text-gray-700 dark:text-gray-300" />
        Center Coordinates
      </label>
      
      <!-- Location Search -->
      <LocationSearch @select="handleSearchSelect" />
      
      <div class="grid grid-cols-2 gap-2">
          <div class="space-y-1">
              <label class="text-[10px] text-gray-500 dark:text-gray-400 font-medium px-1 uppercase tracking-wider">Latitude</label>
              <input
                type="text"
                v-model="latInput"
                @change="handleManualLocationChange"
                @keydown.enter="$event.target.blur()"
                class="w-full bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded px-2 py-1 text-xs text-gray-900 dark:text-white focus:ring-1 focus:ring-[#FF6600] outline-none"
                placeholder="Latitude"
              />
          </div>
          <div class="space-y-1">
              <label class="text-[10px] text-gray-500 dark:text-gray-400 font-medium px-1 uppercase tracking-wider">Longitude</label>
              <input
                type="text"
                v-model="lngInput"
                @change="handleManualLocationChange"
                @keydown.enter="$event.target.blur()"
                class="w-full bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded px-2 py-1 text-xs text-gray-900 dark:text-white focus:ring-1 focus:ring-[#FF6600] outline-none"
                placeholder="Longitude"
              />
          </div>
      </div>
      
      <select 
          @change="handleLocationSelect"
          class="w-full bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded px-2 py-1.5 text-xs text-gray-900 dark:text-white focus:ring-1 focus:ring-[#FF6600] outline-none"
      >
          <option 
            v-for="(loc, index) in interestingLocations" 
            :key="index" 
            :value="index"
            :disabled="loc.disabled"
            :selected="index === 0"
          >
            {{ loc.name }}
          </option>
      </select>
    </div>

    <!-- Generate Buttons -->
    <div class="pt-2 grid grid-cols-2 gap-3">
      <button
        @click="$emit('generate', true, fetchOSM, useUSGS, useGPXZ, gpxzApiKey)"
        :disabled="isGenerating || (useGPXZ && !gpxzApiKey)"
        class="py-3 bg-[#FF6600] hover:bg-[#E65C00] text-white font-bold rounded-md shadow-lg shadow-orange-900/10 flex flex-col items-center justify-center gap-1 transition-all disabled:opacity-50 disabled:cursor-not-allowed disabled:bg-gray-300 dark:disabled:bg-gray-700"
      >
          <span v-if="isGenerating" class="animate-pulse text-xs">Processing...</span>
          <template v-else>
              <div class="flex items-center gap-2">
                   <Mountain :size="16" />
                   <span>Preview 3D</span>
              </div>
              <span class="text-[10px] font-normal opacity-90">View before download</span>
          </template>
      </button>

      <button
        @click="$emit('generate', false, fetchOSM, useUSGS, useGPXZ, gpxzApiKey)"
        :disabled="isGenerating || (useGPXZ && !gpxzApiKey)"
        class="py-3 bg-white dark:bg-gray-800 hover:bg-gray-50 dark:hover:bg-gray-700 border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 font-bold rounded-md shadow-sm flex flex-col items-center justify-center gap-1 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
      >
           <span v-if="isGenerating" class="animate-pulse text-xs">Processing...</span>
          <template v-else>
              <div class="flex items-center gap-2">
                   <FileDown :size="16" />
                   <span>Generate Data</span>
              </div>
              <span class="text-[10px] font-normal text-gray-500 dark:text-gray-400">Skip 3D view, get files</span>
          </template>
      </button>
    </div>

    <!-- Export Panel -->
    <div ref="exportPanel" v-if="terrainData && !isGenerating" class="space-y-3 pt-4 border-t border-gray-200 dark:border-gray-600">
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

        <div class="flex items-center justify-between">
            <label class="text-sm font-medium text-emerald-600 dark:text-emerald-400 flex items-center gap-2">
                <Download :size="16" />
                Ready to Export
            </label>
            <span class="text-xs text-gray-500 dark:text-gray-400">{{ terrainData.width }}x{{ terrainData.height }}</span>
        </div>
        
        <div class="grid grid-cols-2 gap-2">
            <!-- Heightmap -->
            <button 
                @click="downloadHeightmap"
                :disabled="isExportingHeightmap"
                class="relative flex flex-col items-center justify-center p-2 bg-white dark:bg-gray-800 hover:bg-gray-50 dark:hover:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded text-sm text-gray-700 dark:text-gray-300 transition-colors group disabled:opacity-50 disabled:cursor-not-allowed h-24"
            >
                <div class="w-full h-full flex items-center justify-center mb-1">
                    <Loader2 v-if="isExportingHeightmap" :size="24" class="animate-spin text-[#FF6600]" />
                    <Mountain v-else :size="32" class="text-gray-400 dark:text-gray-500" />
                </div>
                <span class="text-[10px] font-medium">Heightmap</span>
                <span class="text-[9px] text-gray-500 dark:text-gray-400">{{ terrainData.width }}px PNG</span>
                <Download v-if="!isExportingHeightmap" :size="12" class="absolute top-1 right-1 opacity-0 group-hover:opacity-100 transition-opacity text-[#FF6600]" />
            </button>

            <!-- Satellite Texture -->
            <button 
                @click="downloadTexture"
                :disabled="isExportingTexture"
                class="relative flex flex-col items-center justify-center p-2 bg-white dark:bg-gray-800 hover:bg-gray-50 dark:hover:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded text-sm text-gray-700 dark:text-gray-300 transition-colors group disabled:opacity-50 disabled:cursor-not-allowed h-24 overflow-hidden"
            >
                <div class="w-full h-full flex items-center justify-center mb-1 overflow-hidden rounded bg-gray-100 dark:bg-gray-900">
                    <Loader2 v-if="isExportingTexture" :size="24" class="animate-spin text-[#FF6600]" />
                    <img v-else-if="terrainData.satelliteTextureUrl" :src="terrainData.satelliteTextureUrl" class="w-full h-full object-cover" />
                    <Box v-else :size="32" class="text-gray-400 dark:text-gray-500" />
                </div>
                <span class="text-[10px] font-medium">Satellite</span>
                <span class="text-[9px] text-gray-500 dark:text-gray-400">{{ terrainData.width }}px JPG</span>
                <Download v-if="!isExportingTexture" :size="12" class="absolute top-1 right-1 opacity-0 group-hover:opacity-100 transition-opacity text-[#FF6600]" />
            </button>

            <!-- OSM Texture -->
            <button 
                @click="downloadOSMTexture"
                :disabled="!terrainData.osmTextureUrl || isExportingOSMTexture"
                class="relative flex flex-col items-center justify-center p-2 bg-white dark:bg-gray-800 hover:bg-gray-50 dark:hover:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded text-sm text-gray-700 dark:text-gray-300 transition-colors group disabled:opacity-50 disabled:cursor-not-allowed h-24 overflow-hidden"
            >
                <div class="w-full h-full flex items-center justify-center mb-1 overflow-hidden rounded bg-gray-100 dark:bg-gray-900">
                    <Loader2 v-if="isExportingOSMTexture" :size="24" class="animate-spin text-[#FF6600]" />
                    <img v-else-if="terrainData.osmTextureUrl" :src="terrainData.osmTextureUrl" class="w-full h-full object-cover" />
                    <Trees v-else :size="32" class="text-gray-400 dark:text-gray-500" />
                </div>
                <span class="text-[10px] font-medium">OSM Texture</span>
                <span class="text-[9px] text-gray-500 dark:text-gray-400">8192px PNG</span>
                <Download v-if="!isExportingOSMTexture" :size="12" class="absolute top-1 right-1 opacity-0 group-hover:opacity-100 transition-opacity text-[#FF6600]" />
            </button>

            <!-- Hybrid Texture -->
            <button 
                @click="downloadHybridTexture"
                :disabled="!terrainData.hybridTextureUrl || isExportingHybridTexture"
                class="relative flex flex-col items-center justify-center p-2 bg-white dark:bg-gray-800 hover:bg-gray-50 dark:hover:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded text-sm text-gray-700 dark:text-gray-300 transition-colors group disabled:opacity-50 disabled:cursor-not-allowed h-24 overflow-hidden"
            >
                <div class="w-full h-full flex items-center justify-center mb-1 overflow-hidden rounded bg-gray-100 dark:bg-gray-900">
                    <Loader2 v-if="isExportingHybridTexture" :size="24" class="animate-spin text-[#FF6600]" />
                    <img v-else-if="terrainData.hybridTextureUrl" :src="terrainData.hybridTextureUrl" class="w-full h-full object-cover" />
                    <Layers v-else :size="32" class="text-gray-400 dark:text-gray-500" />
                </div>
                <span class="text-[10px] font-medium">Hybrid</span>
                <span class="text-[9px] text-gray-500 dark:text-gray-400">8192px PNG</span>
                <Download v-if="!isExportingHybridTexture" :size="12" class="absolute top-1 right-1 opacity-0 group-hover:opacity-100 transition-opacity text-[#FF6600]" />
            </button>

            <!-- OSM GeoJSON -->
             <button 
                @click="downloadOSM"
                :disabled="!terrainData.osmFeatures || terrainData.osmFeatures.length === 0 || isExportingOSM"
                class="relative flex flex-col items-center justify-center p-2 bg-white dark:bg-gray-800 hover:bg-gray-50 dark:hover:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded text-sm text-gray-700 dark:text-gray-300 transition-colors group disabled:opacity-50 disabled:cursor-not-allowed h-24"
            >
                <div class="w-full h-full flex items-center justify-center mb-1">
                    <Loader2 v-if="isExportingOSM" :size="24" class="animate-spin text-[#FF6600]" />
                    <FileJson v-else :size="32" class="text-gray-400 dark:text-gray-500" />
                </div>
                <span class="text-[10px] font-medium">OSM Data (JSON)</span>
                <Download v-if="!isExportingOSM" :size="12" class="absolute top-1 right-1 opacity-0 group-hover:opacity-100 transition-opacity text-[#FF6600]" />
            </button>

            <!-- Road Mask -->
            <button 
                @click="downloadRoadMask"
                :disabled="!terrainData.osmFeatures || terrainData.osmFeatures.length === 0 || isExportingRoadMask"
                class="relative flex flex-col items-center justify-center p-2 bg-white dark:bg-gray-800 hover:bg-gray-50 dark:hover:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded text-sm text-gray-700 dark:text-gray-300 transition-colors group disabled:opacity-50 disabled:cursor-not-allowed h-24"
            >
                <div class="w-full h-full flex items-center justify-center mb-1">
                    <Loader2 v-if="isExportingRoadMask" :size="24" class="animate-spin text-[#FF6600]" />
                    <Route v-else :size="32" class="text-gray-400 dark:text-gray-500" />
                </div>
                <span class="text-[10px] font-medium">Road Mask</span>
                <span class="text-[9px] text-gray-500 dark:text-gray-400">16-bit PNG</span>
                <Download v-if="!isExportingRoadMask" :size="12" class="absolute top-1 right-1 opacity-0 group-hover:opacity-100 transition-opacity text-[#FF6600]" />
            </button>

            <!-- GeoTIFF -->
            <button 
                @click="downloadGeoTIFF"
                :disabled="isExportingGeoTIFF"
                class="relative flex flex-col items-center justify-center p-2 bg-white dark:bg-gray-800 hover:bg-gray-50 dark:hover:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded text-sm text-gray-700 dark:text-gray-300 transition-colors group disabled:opacity-50 disabled:cursor-not-allowed h-24"
            >
                <div class="w-full h-full flex items-center justify-center mb-1">
                    <Loader2 v-if="isExportingGeoTIFF" :size="24" class="animate-spin text-[#FF6600]" />
                    <FileCode v-else :size="32" class="text-gray-400 dark:text-gray-500" />
                </div>
                <span class="text-[10px] font-medium">GeoTIFF</span>
                <span class="text-[9px] text-gray-500 dark:text-gray-400">{{ terrainData?.sourceGeoTiffs ? terrainData.sourceGeoTiffs.source.toUpperCase() : 'WGS84' }}</span>
                <Download v-if="!isExportingGeoTIFF" :size="12" class="absolute top-1 right-1 opacity-0 group-hover:opacity-100 transition-opacity text-[#FF6600]" />
            </button>
            
            <!-- GLB Model -->
            <button 
                @click="handleGLBExport"
                :disabled="isExportingGLB"
                class="relative flex flex-col items-center justify-center p-2 bg-white dark:bg-gray-800 hover:bg-gray-50 dark:hover:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded text-sm text-gray-700 dark:text-gray-300 transition-colors group disabled:opacity-50 h-24"
            >
                <div class="w-full h-full flex items-center justify-center mb-1">
                    <Loader2 v-if="isExportingGLB" :size="24" class="animate-spin text-[#FF6600]" />
                    <Box v-else :size="32" class="text-gray-400 dark:text-gray-500" />
                </div>
                <span class="text-[10px] font-medium">GLB Model</span>
                <Download v-if="!isExportingGLB" :size="12" class="absolute top-1 right-1 opacity-0 group-hover:opacity-100 transition-opacity text-[#FF6600]" />
            </button>
        </div>

        <div class="bg-gray-50 dark:bg-gray-700 p-2 rounded border border-gray-200 dark:border-gray-600 space-y-2">
            <div class="grid grid-cols-3 gap-1 text-[10px] text-gray-500 dark:text-gray-400 border-b border-gray-200 dark:border-gray-600 pb-2">
                <div class="text-center border-r border-gray-200 dark:border-gray-600">
                    <div class="text-gray-400 dark:text-gray-500">Min</div>
                    <div class="text-gray-700 dark:text-gray-300 font-medium">{{ Math.round(terrainData.minHeight) }}m</div>
                </div>
                <div class="text-center border-r border-gray-200 dark:border-gray-600">
                    <div class="text-gray-400 dark:text-gray-500">Max</div>
                    <div class="text-gray-700 dark:text-gray-300 font-medium">{{ Math.round(terrainData.maxHeight) }}m</div>
                </div>
                <div class="text-center">
                    <div class="text-gray-400 dark:text-gray-500">Diff</div>
                    <div class="text-[#FF6600] font-bold">{{ Math.round(terrainData.maxHeight - terrainData.minHeight) }}m</div>
                </div>
            </div>
            <div class="grid grid-cols-2 gap-1 text-[10px] text-gray-500 dark:text-gray-400">
                 <div class="text-center border-r border-gray-200 dark:border-gray-600">
                    <div class="text-gray-400 dark:text-gray-500">Scale</div>
                    <div class="text-gray-700 dark:text-gray-300 font-medium">{{ metersPerPixel.toFixed(2) }}m/px</div>
                </div>
                <div class="text-center">
                    <div class="text-gray-400 dark:text-gray-500">Total Area</div>
                    <div class="text-gray-700 dark:text-gray-300 font-medium">{{ areaDisplay }}</div>
                </div>
            </div>
        </div>
    </div>

    <hr class="border-gray-200 dark:border-gray-600" />
    <ModOfTheDay />
  </div>
</template>

<script setup>
import { ref, computed, onMounted, watch, nextTick } from 'vue';
import { MapPin, Mountain, Download, Box, FileDown, Loader2, Trees, FileJson, Layers, Route, FileCode } from 'lucide-vue-next';
import ModOfTheDay from './ModOfTheDay.vue';
import LocationSearch from './LocationSearch.vue';
import { exportToGLB } from '../services/export3d';
import { checkUSGSStatus } from '../services/terrain';
import { exportGeoTiff } from '../services/exportGeoTiff';
import proj4 from 'proj4';
import { encode } from 'fast-png';


const props = defineProps(['center', 'resolution', 'isGenerating', 'terrainData']);

const emit = defineEmits(['locationChange', 'resolutionChange', 'generate', 'fetchOsm']);

// Local state for formatted coordinate inputs to allow high precision typing
const latInput = ref(props.center.lat.toString());
const lngInput = ref(props.center.lng.toString());

const handleManualLocationChange = () => {
    const lat = parseFloat(latInput.value);
    const lng = parseFloat(lngInput.value);
    
    if (!isNaN(lat) && !isNaN(lng)) {
        emit('locationChange', { ...props.center, lat, lng });
    }
};

// Sync inputs with props when they change from other sources (map move, search, dropdown)
watch(() => props.center, (newVal) => {
    if (parseFloat(latInput.value) !== newVal.lat) {
        latInput.value = newVal.lat.toString();
    }
    if (parseFloat(lngInput.value) !== newVal.lng) {
        lngInput.value = newVal.lng.toString();
    }
}, { deep: true });

const exportPanel = ref(null);
const isExportingGLB = ref(false);
const isExportingHeightmap = ref(false);
const isExportingTexture = ref(false);
const isExportingOSMTexture = ref(false);
const isExportingHybridTexture = ref(false);
const isExportingOSM = ref(false);
const isExportingRoadMask = ref(false);
const isExportingGeoTIFF = ref(false);
const fetchOSM = ref(true);
const useUSGS = ref(false);
const useGPXZ = ref(false);
const elevationSource = ref('default');
const gpxzApiKey = ref('');
const usgsStatus = ref(null);

const interestingLocations = [
  { name: "Select a location...", lat: 0, lng: 0, disabled: true },
  { name: "Angeles Crest Highway, USA", lat: 34.389292767087476, lng: -118.08463811874391 },
  { name: "Devils Tower, USA", lat: 44.59056, lng: -104.71511 },
  { name: "Grand Canyon, USA", lat: 36.05758, lng: -112.14236 },
  { name: "Johnson Valley OHV, USA", lat: 34.49523, lng: -116.82180 },
  { name: "Lombard Street, San Francisco, USA", lat: 37.80213155813396, lng: -122.41888135671617 },
  { name: "Million Dollar Highway, USA", lat: 37.9180, lng: -107.7002 },
  { name: "Mount Everest, Nepal", lat: 27.9881, lng: 86.9250 },
  { name: "Mount Fuji, Japan", lat: 35.3606, lng: 138.7274 },
  { name: "Matterhorn, Switzerland", lat: 45.9763, lng: 7.6586 },
  { name: "Rossfeld Panoramastraße, Germany", lat: 47.6087, lng: 13.0234 },
  { name: "Tail of the Dragon, USA", lat: 35.50323405090838, lng: -83.94679069519044 },
  { name: "Yosemite Valley, USA", lat: 37.7456, lng: -119.5936 }
];

const handleLocationSelect = (e) => {
    const idx = parseInt(e.target.value);
    if (idx > 0) {
        const loc = interestingLocations[idx];
        emit('locationChange', { lat: loc.lat, lng: loc.lng });
        // Reset selection to default
        e.target.selectedIndex = 0;
    }
};

// Handle Nominatim search result selection
const handleSearchSelect = (result) => {
    emit('locationChange', { lat: result.lat, lng: result.lng });
};

onMounted(async () => {
    usgsStatus.value = await checkUSGSStatus();
});

// Watch for generation completion to scroll to export panel
watch(() => props.isGenerating, async (newVal) => {
    if (!newVal && props.terrainData) {
        await nextTick();
        exportPanel.value?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
});

// Sync elevation source with flags
watch(elevationSource, (newVal) => {
    useUSGS.value = newVal === 'usgs';
    useGPXZ.value = newVal === 'gpxz';
});

// Watch for terrain data updates to handle fallback scenarios
watch(() => props.terrainData, (newData) => {
    if (newData?.usgsFallback) {
        elevationSource.value = 'default';
        alert("USGS 1m data for this area was missing or corrupt. Falling back on the Standard Terrarium dataset.\n\nMeters per pixel has been adjusted to the standard dataset resolution.");
    }
});

// Calculate resolution scale (Meters per Pixel)
// With the new pipeline, we enforce 1m/px for all sources.
const metersPerPixel = computed(() => {
  return 1.0;
});

// Calculate Area
const totalWidthMeters = computed(() => props.resolution * metersPerPixel.value);
const totalAreaSqM = computed(() => totalWidthMeters.value * totalWidthMeters.value);
const areaSqKm = computed(() => totalAreaSqM.value / 1000000);

const isAreaLargeForGPXZ = computed(() => {
    return useGPXZ.value && areaSqKm.value > 10;
});

const areaDisplay = computed(() => {
  return totalAreaSqM.value > 1000000 
    ? `${areaSqKm.value.toFixed(2)} km²`
    : `${Math.round(totalAreaSqM.value).toLocaleString()} m²`;
});

const downloadHeightmap = async () => {
  if (!props.terrainData) return;
  isExportingHeightmap.value = true;

  try {
      // Dynamic import removed (now static)

      const width = props.terrainData.width;
      const height = props.terrainData.height;
      const data = new Uint16Array(width * height);
      
      const range = props.terrainData.maxHeight - props.terrainData.minHeight;
      
      for (let i = 0; i < props.terrainData.heightMap.length; i++) {
          const h = props.terrainData.heightMap[i];
          let val = 0;
          if (range > 0) {
               val = Math.floor(((h - props.terrainData.minHeight) / range) * 65535);
          }
          val = Math.max(0, Math.min(65535, val));
          data[i] = val;
      }
  
      const pngData = encode({
          width,
          height,
          data,
          depth: 16,
          channels: 1,
      });
  
      const blob = new Blob([new Uint8Array(pngData)], { type: 'image/png' });
      const url = URL.createObjectURL(blob);
      
      const link = document.createElement('a');
      link.download = `Heightmap_16bit_${props.resolution}px_${props.center.lat.toFixed(4)}_${props.center.lng.toFixed(4)}.png`;
      link.href = url;
      link.click();
      
      URL.revokeObjectURL(url);
  } catch (error) {
      console.error("Failed to load PNG encoder", error);
      alert("Failed to generate PNG. Please try again.");
  } finally {
      isExportingHeightmap.value = false;
  }
};

const downloadTexture = async () => {
    if(!props.terrainData?.satelliteTextureUrl) return;
    isExportingTexture.value = true;
    
    // Simulate a small delay for UX consistency or if we were doing processing
    await new Promise(resolve => setTimeout(resolve, 500));

    const link = document.createElement('a');
    link.download = `Satellite_${props.resolution}px_${props.center.lat.toFixed(4)}_${props.center.lng.toFixed(4)}.jpg`;
    link.href = props.terrainData.satelliteTextureUrl;
    link.click();
    
    isExportingTexture.value = false;
};

const downloadOSMTexture = async () => {
    if(!props.terrainData?.osmTextureUrl) return;
    isExportingOSMTexture.value = true;
    
    // Simulate a small delay for UX consistency
    await new Promise(resolve => setTimeout(resolve, 500));

    const link = document.createElement('a');
    link.download = `OSM_Texture_${props.resolution}px_${props.center.lat.toFixed(4)}_${props.center.lng.toFixed(4)}.png`;
    link.href = props.terrainData.osmTextureUrl;
    link.click();
    
    isExportingOSMTexture.value = false;
};

const downloadHybridTexture = async () => {
    if(!props.terrainData?.hybridTextureUrl) return;
    isExportingHybridTexture.value = true;
    
    // Simulate a small delay for UX consistency
    await new Promise(resolve => setTimeout(resolve, 500));

    const link = document.createElement('a');
    link.download = `Hybrid_Texture_${props.resolution}px_${props.center.lat.toFixed(4)}_${props.center.lng.toFixed(4)}.png`;
    link.href = props.terrainData.hybridTextureUrl;
    link.click();
    
    isExportingHybridTexture.value = false;
};

const downloadOSM = async () => {
    if (!props.terrainData?.osmFeatures || props.terrainData.osmFeatures.length === 0) {
        alert("No OSM data available. Try enabling 'Include 3D Features' and generating again.");
        return;
    }
    
    isExportingOSM.value = true;
    
    // Simulate processing delay
    await new Promise(resolve => setTimeout(resolve, 500));

    const features = props.terrainData.osmFeatures.map((f) => {
        const coordinates = f.geometry.map((p) => [p.lng, p.lat]);
        
        let geometryType = 'LineString';
        let geometryCoordinates = coordinates;

        const isClosed = coordinates.length > 3 && 
            coordinates[0][0] === coordinates[coordinates.length-1][0] && 
            coordinates[0][1] === coordinates[coordinates.length-1][1];

        if (f.type === 'building' || (f.type === 'vegetation' && isClosed)) {
             geometryType = 'Polygon';
             geometryCoordinates = [coordinates];
        }

        return {
            type: "Feature",
            properties: {
                id: f.id,
                feature_type: f.type,
                ...f.tags
            },
            geometry: {
                type: geometryType,
                coordinates: geometryCoordinates
            }
        };
    });

    const geoJSON = {
        type: "FeatureCollection",
        features: features
    };

    const blob = new Blob([JSON.stringify(geoJSON, null, 2)], { type: 'application/geo+json' });
    const url = URL.createObjectURL(blob);
    
    const link = document.createElement('a');
    link.download = `MapNG_OSM_${props.resolution}px_${props.center.lat.toFixed(4)}_${props.center.lng.toFixed(4)}.geojson`;
    link.href = url;
    link.click();
    
    URL.revokeObjectURL(url);
    isExportingOSM.value = false;
};

const downloadRoadMask = async () => {
    if (!props.terrainData || !props.terrainData.osmFeatures) return;
    isExportingRoadMask.value = true;

    try {
        // Dynamic imports removed (now static)

        const width = props.terrainData.width;
        const height = props.terrainData.height;
        
        // Create canvas for drawing
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (!ctx) throw new Error("Could not get canvas context");

        // Fill black
        ctx.fillStyle = 'black';
        ctx.fillRect(0, 0, width, height);

        // Setup projection
        const center = props.center;
        const localProjDef = `+proj=tmerc +lat_0=${center.lat} +lon_0=${center.lng} +k=1 +x_0=0 +y_0=0 +datum=WGS84 +units=m +no_defs`;
        const toLocal = proj4('EPSG:4326', localProjDef);

        // Draw roads
        ctx.strokeStyle = 'white';
        ctx.lineWidth = 8; 
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';

        props.terrainData.osmFeatures.forEach(feature => {
            if (feature.type === 'road') {
                // Exclude footpaths and non-drivable paths
                const highway = feature.tags?.highway;
                const exclude = ['footway', 'path', 'pedestrian', 'steps', 'cycleway', 'bridleway', 'corridor'];
                if (highway && exclude.includes(highway)) return;

                ctx.beginPath();
                feature.geometry.forEach((pt, index) => {
                    const [x, y] = toLocal.forward([pt.lng, pt.lat]);
                    // Map to pixel coords
                    // Top-left of grid is (-width/2, height/2)
                    const u = x + width / 2;
                    const v = height / 2 - y;
                    
                    if (index === 0) ctx.moveTo(u, v);
                    else ctx.lineTo(u, v);
                });
                ctx.stroke();
            }
        });

        // Convert to 16-bit grayscale PNG
        const imageData = ctx.getImageData(0, 0, width, height);
        const data = new Uint16Array(width * height);
        
        for (let i = 0; i < data.length; i++) {
            // If pixel is lit, set to max 16-bit value
            // Check red channel (index 0, 4, 8...)
            if (imageData.data[i * 4] > 128) { 
                data[i] = 65535;
            } else {
                data[i] = 0;
            }
        }

        const pngData = encode({
            width,
            height,
            data,
            depth: 16,
            channels: 1,
        });

        const blob = new Blob([new Uint8Array(pngData)], { type: 'image/png' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.download = `RoadMask_16bit_${props.resolution}px_${props.center.lat.toFixed(4)}_${props.center.lng.toFixed(4)}.png`;
        link.href = url;
        link.click();
        URL.revokeObjectURL(url);

    } catch (e) {
        console.error("Road mask export failed:", e);
        alert("Failed to export road mask.");
    } finally {
        isExportingRoadMask.value = false;
    }
};

const downloadGeoTIFF = async () => {
    if (!props.terrainData) return;
    isExportingGeoTIFF.value = true;

    try {
        const { blob, filename } = await exportGeoTiff(props.terrainData, props.center);
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.download = filename;
        link.href = url;
        link.click();
        URL.revokeObjectURL(url);
    } catch (e) {
        console.error("GeoTIFF export failed:", e);
        alert("Failed to export GeoTIFF.");
    } finally {
        isExportingGeoTIFF.value = false;
    }
};

const handleGLBExport = async () => {
  if (!props.terrainData) return;
  isExportingGLB.value = true;
  try {
    await exportToGLB(props.terrainData);
  } catch (error) {
    console.error("GLB Export failed:", error);
    alert("Failed to export GLB.");
  } finally {
    isExportingGLB.value = false;
  }
};
</script>
