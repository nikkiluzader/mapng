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
              @change="$emit('resolutionChange', parseInt(($event.target as HTMLSelectElement).value))"
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
              <p>• Always fetches max detail (Zoom 15).</p>
              <p v-if="resolution >= 4096" class="text-amber-600 dark:text-amber-500 font-medium">⚠️ Large area. May require high RAM.</p>
              <p>• Current Scale: <span class="text-[#FF6600]">{{ metersPerPixel.toFixed(2) }}m/px</span></p>
          </div>
      </div>

      <!-- OSM Toggle -->
      <div class="flex items-center justify-between p-2 rounded bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600">
          <label class="text-xs text-gray-700 dark:text-gray-300 flex items-center gap-2 cursor-pointer">
              <Trees :size="12" class="text-emerald-600 dark:text-emerald-400" />
              Include 3D Features (OSM)
          </label>
          <input 
              type="checkbox" 
              v-model="fetchOSM"
              class="accent-[#FF6600] w-4 h-4 cursor-pointer"
          />
      </div>

      <!-- USGS Toggle -->
      <div class="flex flex-col gap-1 p-2 rounded bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600" :class="{ 'opacity-50 pointer-events-none': useGPXZ }">
          <div class="flex items-center justify-between">
            <label class="text-xs text-gray-700 dark:text-gray-300 flex items-center gap-2 cursor-pointer">
                <Mountain :size="12" class="text-blue-600 dark:text-blue-400" />
                Use USGS 1m DEM (USA Only)
            </label>
            <input 
                type="checkbox" 
                v-model="useUSGS"
                class="accent-[#FF6600] w-4 h-4 cursor-pointer"
            />
          </div>
          <div class="flex items-center gap-1 text-[10px]">
             <span class="text-gray-500 dark:text-gray-400">National Map Status:</span>
             <span v-if="usgsStatus === null" class="text-gray-400 dark:text-gray-500">Checking...</span>
             <span v-else-if="usgsStatus" class="text-emerald-600 dark:text-emerald-400 font-medium">● Online</span>
             <span v-else class="text-red-500 dark:text-red-400 font-medium">● Offline / Unreachable</span>
          </div>
      </div>

      <!-- GPXZ Toggle -->
      <div class="flex flex-col gap-2 p-2 rounded bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600">
          <div class="flex items-center justify-between">
            <label class="text-xs text-gray-700 dark:text-gray-300 flex items-center gap-2 cursor-pointer">
                <Globe :size="12" class="text-purple-600 dark:text-purple-400" />
                Use GPXZ Elevation API
            </label>
            <input 
                type="checkbox" 
                v-model="useGPXZ"
                class="accent-[#FF6600] w-4 h-4 cursor-pointer"
            />
          </div>
          
          <div v-if="useGPXZ" class="space-y-2 animate-in fade-in slide-in-from-top-1">
              <input 
                type="password" 
                v-model="gpxzApiKey"
                placeholder="Enter GPXZ API Key"
                class="w-full bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded px-2 py-1 text-xs text-gray-900 dark:text-white focus:ring-1 focus:ring-[#FF6600] outline-none"
              />
              <p class="text-[10px] text-gray-500 dark:text-gray-400 leading-tight">
                  Key is not stored. Free tier: 100 req/day.
                  <a href="https://www.gpxz.io/" target="_blank" class="text-[#FF6600] hover:underline">Get a key</a>
              </p>
              <p v-if="isAreaLargeForGPXZ" class="text-[10px] text-orange-600 dark:text-orange-400 font-medium leading-tight">
                  ⚠️ Large area ({{ areaSqKm.toFixed(2) }} km²). Will use multiple API calls.
              </p>
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
      <div class="grid grid-cols-2 gap-2">
          <input
            type="number"
            :value="center.lat.toFixed(5)"
            @input="$emit('locationChange', { ...center, lat: parseFloat(($event.target as HTMLInputElement).value) })"
            class="bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded px-2 py-1 text-xs text-gray-900 dark:text-white focus:ring-1 focus:ring-[#FF6600] outline-none"
            step="0.0001"
          />
          <input
            type="number"
            :value="center.lng.toFixed(5)"
            @input="$emit('locationChange', { ...center, lng: parseFloat(($event.target as HTMLInputElement).value) })"
            class="bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded px-2 py-1 text-xs text-gray-900 dark:text-white focus:ring-1 focus:ring-[#FF6600] outline-none"
            step="0.0001"
          />
      </div>
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
                   <span>Direct DL</span>
              </div>
              <span class="text-[10px] font-normal text-gray-500 dark:text-gray-400">Skip render, get files</span>
          </template>
      </button>
    </div>

    <!-- Export Panel -->
    <div v-if="terrainData && !isGenerating" class="space-y-3 pt-4 border-t border-gray-200 dark:border-gray-600 animate-in fade-in slide-in-from-top-2">
        <div class="flex items-center justify-between">
            <label class="text-sm font-medium text-emerald-600 dark:text-emerald-400 flex items-center gap-2">
                <Download :size="16" />
                Ready to Export
            </label>
            <span class="text-xs text-gray-500 dark:text-gray-400">{{ terrainData.width }}x{{ terrainData.height }}</span>
        </div>
        
        <div class="grid grid-cols-1 gap-2">
            <button 
                @click="downloadHeightmap"
                :disabled="isExportingHeightmap"
                class="flex items-center justify-between px-3 py-2 bg-white dark:bg-gray-800 hover:bg-gray-50 dark:hover:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded text-sm text-gray-700 dark:text-gray-300 transition-colors group disabled:opacity-50 disabled:cursor-not-allowed"
            >
                <div class="flex items-center gap-2">
                    <Loader2 v-if="isExportingHeightmap" :size="12" class="animate-spin text-[#FF6600]" />
                    <span>Heightmap (16-bit PNG)</span>
                </div>
                <Download v-if="!isExportingHeightmap" :size="12" class="opacity-0 group-hover:opacity-100 transition-opacity text-[#FF6600]" />
            </button>
            <button 
                @click="downloadTexture"
                :disabled="isExportingTexture"
                class="flex items-center justify-between px-3 py-2 bg-white dark:bg-gray-800 hover:bg-gray-50 dark:hover:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded text-sm text-gray-700 dark:text-gray-300 transition-colors group disabled:opacity-50 disabled:cursor-not-allowed"
            >
                <div class="flex items-center gap-2">
                    <Loader2 v-if="isExportingTexture" :size="12" class="animate-spin text-[#FF6600]" />
                    <span>Satellite Image (JPG)</span>
                </div>
                <Download v-if="!isExportingTexture" :size="12" class="opacity-0 group-hover:opacity-100 transition-opacity text-[#FF6600]" />
            </button>

             <button 
                @click="downloadOSM"
                :disabled="!terrainData.osmFeatures || terrainData.osmFeatures.length === 0 || isExportingOSM"
                class="flex items-center justify-between px-3 py-2 bg-white dark:bg-gray-800 hover:bg-gray-50 dark:hover:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded text-sm text-gray-700 dark:text-gray-300 transition-colors group disabled:opacity-50 disabled:cursor-not-allowed"
            >
                <div class="flex items-center gap-2">
                    <Loader2 v-if="isExportingOSM" :size="12" class="animate-spin text-[#FF6600]" />
                    <span>OSM Data (GeoJSON)</span>
                </div>
                <FileJson v-if="!isExportingOSM" :size="12" class="opacity-0 group-hover:opacity-100 transition-opacity text-[#FF6600]" />
            </button>
            
            <div class="grid grid-cols-1 gap-2">
                <button 
                    @click="handleGLBExport"
                    :disabled="isExportingGLB"
                    class="flex items-center justify-center gap-2 px-2 py-2 bg-white dark:bg-gray-800 hover:bg-gray-50 dark:hover:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded text-sm text-gray-700 dark:text-gray-300 transition-colors group disabled:opacity-50"
                >
                    <Loader2 v-if="isExportingGLB" :size="12" class="animate-spin text-[#FF6600]" />
                    <Box v-else :size="12" class="text-gray-500 dark:text-gray-400" />
                    <span>GLB Model</span>
                </button>
            </div>
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
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue';
import { MapPin, Mountain, Download, Box, FileDown, Loader2, Trees, FileJson, Globe } from 'lucide-vue-next';
import { LatLng, TerrainData } from '../types';
import { exportToGLB } from '../services/export3d';
import { checkUSGSStatus } from '../services/terrain';

interface Props {
  center: LatLng;
  resolution: number;
  isGenerating: boolean;
  terrainData: TerrainData | null;
}

const props = defineProps<Props>();

defineEmits<{
  locationChange: [loc: LatLng];
  resolutionChange: [res: number];
  generate: [showPreview: boolean, fetchOSM: boolean, useUSGS: boolean, useGPXZ: boolean, gpxzApiKey: string];
}>();

const isExportingGLB = ref(false);
const isExportingHeightmap = ref(false);
const isExportingTexture = ref(false);
const isExportingOSM = ref(false);
const fetchOSM = ref(false);
const useUSGS = ref(false);
const useGPXZ = ref(false);
const gpxzApiKey = ref('');
const usgsStatus = ref<boolean | null>(null);

onMounted(async () => {
    usgsStatus.value = await checkUSGSStatus();
});

// Exclusive toggles
watch(useGPXZ, (newVal) => {
    if (newVal) useUSGS.value = false;
});

watch(useUSGS, (newVal) => {
    if (newVal) useGPXZ.value = false;
});

// Watch for terrain data updates to handle fallback scenarios
watch(() => props.terrainData, (newData) => {
    if (newData?.usgsFallback) {
        useUSGS.value = false;
        alert("USGS 1m data for this area was missing or corrupt. Falling back on the Standard Terrarium dataset.\n\nMeters per pixel has been adjusted to the standard dataset resolution.");
    }
});

// Calculate resolution scale (Meters per Pixel) at Zoom 15 (Fixed Fetch Zoom)
const metersPerPixel = computed(() => {
  const lat = props.center.lat;
  const lng = props.center.lng;

  const isCONUS = lat < 50 && lat > 24 && lng > -125 && lng < -66;
  const isAlaska = lat < 72 && lat > 50 && lng > -170 && lng < -129;
  const isHawaii = lat < 23 && lat > 18 && lng > -161 && lng < -154;
  
  if (useUSGS.value && (isCONUS || isAlaska || isHawaii)) {
      return 1.0;
  }
  // GPXZ is typically high res (1m or better), so we can assume 1m/px for display purposes if enabled
  if (useGPXZ.value) {
      return 1.0;
  }
  return (156543.03 * Math.cos(props.center.lat * Math.PI / 180)) / 32768;
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
      // Dynamic import for fast-png
      // @ts-ignore
      const { encode } = await import('fast-png');

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

const downloadOSM = async () => {
    if (!props.terrainData?.osmFeatures || props.terrainData.osmFeatures.length === 0) {
        alert("No OSM data available. Try enabling 'Include 3D Features' and generating again.");
        return;
    }
    
    isExportingOSM.value = true;
    
    // Simulate processing delay
    await new Promise(resolve => setTimeout(resolve, 500));

    const features = props.terrainData.osmFeatures.map((f: any) => {
        const coordinates = f.geometry.map((p: any) => [p.lng, p.lat]);
        
        let geometryType = 'LineString';
        let geometryCoordinates: any = coordinates;

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
