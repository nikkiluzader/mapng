<template>
  <!-- Mobile Restriction Overlay -->
  <div class="flex md:hidden fixed inset-0 z-[999] bg-white flex-col items-center justify-center p-8 text-center text-gray-900">
    <div class="bg-gray-50 p-6 rounded-2xl border border-gray-200 shadow-2xl max-w-sm flex flex-col items-center">
      <div class="p-4 bg-[#FF6600]/10 rounded-full mb-6">
        <Monitor :size="48" class="text-[#FF6600]" />
      </div>
      <h1 class="text-2xl font-bold text-gray-900 mb-2">Desktop Required</h1>
      <p class="text-gray-600 text-sm leading-relaxed mb-6">
        MapNG is a high-performance terrain generation tool designed for BeamNG modding.
      </p>
      <p class="text-gray-500 text-xs mb-6">
        To ensure the best experience with 3D rendering, precise map selection, and file management, please access this application on a desktop or laptop computer.
      </p>
      <div class="flex items-center gap-2 text-xs font-medium text-[#FF6600] bg-[#FF6600]/10 px-4 py-2 rounded-full border border-[#FF6600]/20">
        <MousePointer2 :size="12" />
        <span>Mouse & Keyboard Recommended</span>
      </div>
    </div>
  </div>

  <!-- Main Application - Hidden on Mobile -->
  <div class="hidden md:flex h-screen w-full flex-col md:flex-row overflow-hidden bg-white text-gray-900">
    <!-- Sidebar / Control Panel -->
    <aside class="w-full md:w-80 lg:w-96 flex-shrink-0 flex flex-col border-r border-gray-200 bg-white z-10 relative shadow-xl">
      <div class="p-5 border-b border-gray-200 flex items-center gap-3 bg-white">
        <div class="p-2 bg-[#FF6600] rounded-lg shadow-lg shadow-orange-500/30">
          <Layers :size="24" class="text-white" />
        </div>
        <div>
          <h1 class="text-xl font-bold tracking-tight text-gray-900">MapNG</h1>
          <p class="text-xs text-gray-500">BeamNG Terrain Generator</p>
        </div>
        <button 
          @click="showAbout = true"
          class="ml-auto text-gray-400 hover:text-[#FF6600] transition-colors p-1 rounded-full hover:bg-orange-50"
          title="What is this?"
        >
          <CircleHelp :size="20" />
        </button>
      </div>
      
      <div class="flex-1 overflow-y-auto custom-scrollbar p-5 bg-gray-50/50">
        <ControlPanel 
          :center="center" 
          :resolution="resolution"
          :terrain-data="terrainData"
          :is-generating="isLoading"
          @location-change="handleLocationChange"
          @resolution-change="setResolution"
          @generate="handleGenerate"
        />
      </div>
      
      <div class="p-4 border-t border-gray-200 text-xs text-gray-500 text-center bg-white space-y-1">
         <p>AWS Terrain • Esri • OSM</p>
         <p class="italic opacity-70">App generated with Gemini 3</p>
         <a href="mailto:nikkiluzader@gmail.com" class="text-[#FF6600] hover:text-[#E65C00] transition-colors block mt-1">
           Contact: nikkiluzader@gmail.com
         </a>
         <button 
           @click="showStackInfo = true"
           class="text-gray-600 hover:text-[#FF6600] transition-colors flex items-center justify-center gap-1 w-full mt-3 pt-3 border-t border-gray-100"
         >
           <Code :size="12" /> View Tech Stack
         </button>
      </div>
    </aside>

    <!-- Main Content Area -->
    <main class="flex-1 relative flex flex-col h-full bg-gray-100">
      <!-- Toggle View Tabs -->
      <div class="absolute top-4 right-4 z-20 flex bg-white/90 backdrop-blur rounded-lg p-1 shadow-xl border border-gray-200">
        <button
          @click="switchTo2D"
          :class="['px-4 py-2 rounded-md text-sm font-medium transition-all flex items-center gap-2',
            !previewMode ? 'bg-gray-800 text-white shadow-sm' : 'text-gray-500 hover:text-gray-900']"
        >
          <Globe :size="16" />
          2D Map
        </button>
        <button
          @click="previewMode = true"
          :disabled="!terrainData"
          :class="['px-4 py-2 rounded-md text-sm font-medium transition-all flex items-center gap-2',
            previewMode ? 'bg-[#FF6600] text-white shadow-sm' : 'text-gray-500 hover:text-gray-900',
            !terrainData ? 'opacity-50 cursor-not-allowed' : '']"
        >
          <Layers :size="16" />
          3D Preview
        </button>
      </div>

      <!-- Views -->
      <div class="flex-1 relative w-full h-full">
        <!-- Map View -->
        <div :class="['absolute inset-0 transition-all duration-500', previewMode ? 'opacity-0 invisible' : 'opacity-100 visible']">
          <MapSelector 
            :center="center" 
            :zoom="zoom" 
            :resolution="resolution"
            @move="setCenter" 
            @zoom="setZoom"
          />
        </div>
        
        <!-- 3D Preview View -->
        <div :class="['absolute inset-0 transition-all duration-500 bg-black', previewMode ? 'opacity-100 visible' : 'opacity-0 invisible pointer-events-none']">
          <Suspense>
            <template #default>
              <Preview3D 
                v-if="terrainData && previewMode"
                :terrain-data="terrainData" 
              />
            </template>
            <template #fallback>
              <div class="w-full h-full flex items-center justify-center text-white flex-col gap-4">
                <Loader2 class="animate-spin text-[#FF6600]" :size="48" />
                <div class="text-lg font-medium">Loading 3D Scene...</div>
              </div>
            </template>
          </Suspense>
        </div>
        
        <!-- Loading Overlay -->
        <div v-if="isLoading" class="absolute inset-0 z-50 flex items-center justify-center bg-white/80 backdrop-blur-sm">
          <div class="text-center p-8 rounded-2xl bg-white border border-gray-200 shadow-2xl min-w-[300px]">
            <Loader2 :size="48" class="text-[#FF6600] animate-spin mx-auto mb-4" />
            <h3 class="text-xl text-gray-900 font-bold mb-2">Processing Terrain</h3>
            <p class="text-gray-600 text-sm font-medium mb-4 animate-pulse">{{ loadingStatus }}</p>
            <div class="text-xs text-gray-400 max-w-xs mx-auto">
                <span v-if="resolution >= 2048">High resolution (2048+) may take 1-2 minutes.</span>
                <span v-if="resolution >= 4096" class="block text-amber-500 mt-1">Very large area (4k/8k). Please wait...</span>
            </div>
          </div>
        </div>
      </div>
    </main>

    <!-- About Modal -->
  <div v-if="showAbout" class="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm" @click.self="showAbout = false">
    <div class="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-hidden flex flex-col">
      <div class="p-6 border-b border-gray-200 flex items-center justify-between bg-gray-50">
        <div class="flex items-center gap-3">
          <div class="p-2 bg-[#FF6600] rounded-lg shadow-sm">
            <Layers :size="20" class="text-white" />
          </div>
          <div>
            <h2 class="text-lg font-bold text-gray-900">About MapNG</h2>
            <p class="text-xs text-gray-500">BeamNG.drive Terrain Generator</p>
          </div>
        </div>
        <button @click="showAbout = false" class="text-gray-400 hover:text-gray-900 transition-colors">
          <X :size="20" />
        </button>
      </div>
      
      <div class="p-6 overflow-y-auto custom-scrollbar space-y-6 text-sm text-gray-600 leading-relaxed">
        <div class="bg-orange-50 border border-orange-100 rounded-lg p-4 text-orange-900">
          <p class="font-medium">MapNG is a specialized tool designed to streamline the creation of real-world terrain maps for BeamNG.drive.</p>
        </div>

        <div class="space-y-4">
          <h3 class="font-bold text-gray-900 flex items-center gap-2">
            <Globe :size="16" class="text-[#FF6600]" />
            What does it do?
          </h3>
          <p>
            It allows modders to select any location on Earth, visualize it in 3D, and export high-precision heightmaps and 3D models ready for game engine import. Unlike generic terrain tools, MapNG focuses on the specific needs of vehicle simulation: high-resolution height data, accurate scale, and integrated road network data.
          </p>
        </div>

        <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div class="space-y-2">
            <h4 class="font-bold text-gray-900 text-xs uppercase tracking-wider">Key Features</h4>
            <ul class="space-y-2 list-disc list-inside marker:text-[#FF6600]">
              <li>Global Elevation Data (AWS)</li>
              <li>1m Resolution USA Data (USGS)</li>
              <li>Premium High-Res Global Data (GPXZ)</li>
              <li>3D Preview with Satellite Imagery</li>
              <li>OSM Road & Building Integration</li>
            </ul>
          </div>
          <div class="space-y-2">
            <h4 class="font-bold text-gray-900 text-xs uppercase tracking-wider">Export Formats</h4>
            <ul class="space-y-2 list-disc list-inside marker:text-[#FF6600]">
              <li>16-bit PNG Heightmaps</li>
              <li>High-Res Satellite Textures</li>
              <li>GLB 3D Models</li>
              <li>GeoJSON Vector Data</li>
            </ul>
          </div>
        </div>

        <div class="pt-4 border-t border-gray-100">
          <p class="text-xs text-gray-500 text-center">
            Created by <a href="https://github.com/nikkiluzader" target="_blank" class="text-[#FF6600] hover:underline">Nikki Luzader</a> • Open Source on <a href="https://github.com/nikkiluzader/mapng" target="_blank" class="text-[#FF6600] hover:underline">GitHub</a>
          </p>
        </div>
      </div>
    </div>
  </div>

  <!-- Tech Stack Modal -->
    <div v-if="showStackInfo" class="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4 animate-in fade-in duration-200">
      <div class="bg-white border border-gray-200 rounded-xl shadow-2xl w-full max-w-2xl max-h-[85vh] overflow-y-auto custom-scrollbar flex flex-col animate-in zoom-in-95 duration-200">
        <!-- Header -->
        <div class="p-5 border-b border-gray-200 flex items-center justify-between sticky top-0 bg-white/95 backdrop-blur z-10">
          <div class="flex items-center gap-3">
            <div class="p-2 bg-gray-100 rounded-lg">
              <Code :size="20" class="text-[#FF6600]" />
            </div>
            <h2 class="text-lg font-bold text-gray-900">MapNG Tech Stack</h2>
          </div>
          <button 
            @click="showStackInfo = false" 
            class="p-2 hover:bg-gray-100 rounded-full transition-colors text-gray-400 hover:text-gray-900"
          >
            <X :size="20" />
          </button>
        </div>

        <!-- Content -->
        <div class="p-6 space-y-8">
          <section class="space-y-3">
            <h3 class="text-sm font-semibold text-[#FF6600] uppercase tracking-wider">Core Framework</h3>
            <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div class="bg-gray-50 p-3 rounded border border-gray-200">
                <div class="font-medium text-gray-900">Vue 3</div>
                <div class="text-xs text-gray-500 mt-1">Composition API & reactivity</div>
              </div>
              <div class="bg-gray-50 p-3 rounded border border-gray-200">
                <div class="font-medium text-gray-900">TypeScript</div>
                <div class="text-xs text-gray-500 mt-1">Strict type safety & interfaces</div>
              </div>
              <div class="bg-gray-50 p-3 rounded border border-gray-200">
                <div class="font-medium text-gray-900">Tailwind CSS</div>
                <div class="text-xs text-gray-500 mt-1">Utility-first styling</div>
              </div>
              <div class="bg-gray-50 p-3 rounded border border-gray-200">
                <div class="font-medium text-gray-900">Vite</div>
                <div class="text-xs text-gray-500 mt-1">Next-generation frontend tooling</div>
              </div>
            </div>
          </section>

          <section class="space-y-3">
            <h3 class="text-sm font-semibold text-[#FF6600] uppercase tracking-wider">3D & Graphics</h3>
            <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div class="bg-gray-50 p-3 rounded border border-gray-200">
                <div class="font-medium text-gray-900">Three.js</div>
                <div class="text-xs text-gray-500 mt-1">WebGL 3D engine</div>
              </div>
              <div class="bg-gray-50 p-3 rounded border border-gray-200">
                <div class="font-medium text-gray-900">TresJS</div>
                <div class="text-xs text-gray-500 mt-1">Vue 3 renderer for Three.js</div>
              </div>
              <div class="bg-gray-50 p-3 rounded border border-gray-200">
                <div class="font-medium text-gray-900">Cientos</div>
                <div class="text-xs text-gray-500 mt-1">Helpers for OrbitControls, Skybox, Shadows</div>
              </div>
              <div class="bg-gray-50 p-3 rounded border border-gray-200">
                <div class="font-medium text-gray-900">InstancedMesh</div>
                <div class="text-xs text-gray-500 mt-1">High-performance tree rendering</div>
              </div>
            </div>
          </section>

          <section class="space-y-3">
            <h3 class="text-sm font-semibold text-[#FF6600] uppercase tracking-wider">Mapping & GIS</h3>
            <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
               <div class="bg-gray-50 p-3 rounded border border-gray-200">
                <div class="font-medium text-gray-900">Leaflet & Vue-Leaflet</div>
                <div class="text-xs text-gray-500 mt-1">Interactive 2D map interface</div>
              </div>
              <div class="bg-gray-50 p-3 rounded border border-gray-200">
                <div class="font-medium text-gray-900">Web Mercator Projection</div>
                <div class="text-xs text-gray-500 mt-1">Custom implementation for pixel-perfect terrain stitching</div>
              </div>
            </div>
          </section>

          <section class="space-y-3">
            <h3 class="text-sm font-semibold text-[#FF6600] uppercase tracking-wider">Data Sources</h3>
            <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
               <div class="bg-gray-50 p-3 rounded border border-gray-200">
                <div class="font-medium text-gray-900">AWS Elevation Tiles</div>
                <div class="text-xs text-gray-500 mt-1">Raw heightmap data source (Terrarium format)</div>
              </div>
               <div class="bg-gray-50 p-3 rounded border border-gray-200">
                <div class="font-medium text-gray-900">Esri World Imagery</div>
                <div class="text-xs text-gray-500 mt-1">High-res satellite texture overlays</div>
              </div>
              <div class="bg-gray-50 p-3 rounded border border-gray-200">
                <div class="font-medium text-gray-900">USGS National Map</div>
                <div class="text-xs text-gray-500 mt-1">1m resolution DEM (USA Only)</div>
              </div>
              <div class="bg-gray-50 p-3 rounded border border-gray-200">
                <div class="font-medium text-gray-900">GPXZ API</div>
                <div class="text-xs text-gray-500 mt-1">Premium global high-res elevation data</div>
              </div>
              <div class="bg-gray-50 p-3 rounded border border-gray-200">
                <div class="font-medium text-gray-900">Overpass API (OSM)</div>
                <div class="text-xs text-gray-500 mt-1">Live vector data for roads, buildings, and vegetation</div>
              </div>
            </div>
          </section>

          <section class="space-y-3">
            <h3 class="text-sm font-semibold text-[#FF6600] uppercase tracking-wider">Export & Processing</h3>
            <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div class="bg-gray-50 p-3 rounded border border-gray-200">
                <div class="font-medium text-gray-900">GLTFExporter</div>
                <div class="text-xs text-gray-500 mt-1">Standard 3D model export (GLB)</div>
              </div>
              <div class="bg-gray-50 p-3 rounded border border-gray-200">
                <div class="font-medium text-gray-900">fast-png</div>
                <div class="text-xs text-gray-500 mt-1">16-bit precision heightmap encoding</div>
              </div>
              <div class="bg-gray-50 p-3 rounded border border-gray-200">
                <div class="font-medium text-gray-900">geotiff.js & proj4</div>
                <div class="text-xs text-gray-500 mt-1">GeoTIFF parsing & coordinate projection</div>
              </div>
              <div class="bg-gray-50 p-3 rounded border border-gray-200">
                <div class="font-medium text-gray-900">BufferGeometryUtils</div>
                <div class="text-xs text-gray-500 mt-1">Mesh optimization & merging</div>
              </div>
            </div>
          </section>
        </div>
        
        <div class="p-5 border-t border-gray-200 bg-gray-50 text-center">
          <p class="text-xs text-gray-500">Built to assist with BeamNG.drive modding workflows.</p>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { Globe, Layers, Loader2, Code, X, Monitor, MousePointer2, CircleHelp } from 'lucide-vue-next';
import ControlPanel from './components/ControlPanel.vue';
import MapSelector from './components/MapSelector.vue';
import Preview3D from './components/Preview3D.vue';
import { LatLng, TerrainData } from './types';
import { fetchTerrainData } from './services/terrain';

const center = ref<LatLng>({ lat: 35.1983, lng: -111.6513 }); // Flagstaff, AZ default
const zoom = ref<number>(13);
const resolution = ref<number>(1024);
const terrainData = ref<TerrainData | null>(null);
const isLoading = ref<boolean>(false);
const loadingStatus = ref<string>("Initializing...");
const previewMode = ref<boolean>(false);
const showStackInfo = ref<boolean>(false);
const showAbout = ref<boolean>(false);

// Attempt to get user location on load
onMounted(() => {
  if ("geolocation" in navigator) {
    navigator.geolocation.getCurrentPosition(
      (position) => {
        center.value = {
          lat: position.coords.latitude,
          lng: position.coords.longitude
        };
      },
      (err) => {
        console.debug("Geolocation access denied or failed, using default location.", err);
      },
      {
        enableHighAccuracy: false, // Use WiFi/Cell towers for speed
        timeout: 5000, // Don't wait more than 5s
        maximumAge: 600000 // Accept cached positions up to 10 minutes old
      }
    );
  }
});

const handleLocationChange = (newCenter: LatLng) => {
  center.value = newCenter;
  terrainData.value = null;
};

const setCenter = (newCenter: LatLng) => {
  center.value = newCenter;
};

const setZoom = (newZoom: number) => {
  zoom.value = newZoom;
};

const setResolution = (newResolution: number) => {
  resolution.value = newResolution;
};

const handleGenerate = async (showPreview: boolean, fetchOSM: boolean, useUSGS: boolean, useGPXZ: boolean, gpxzApiKey: string) => {
  isLoading.value = true;
  loadingStatus.value = "Starting terrain generation...";
  try {
    const data = await fetchTerrainData(
        center.value, 
        resolution.value, 
        fetchOSM, 
        useUSGS, 
        useGPXZ, 
        gpxzApiKey,
        (status) => { loadingStatus.value = status; }
    );
    terrainData.value = data;
    
    if (showPreview) {
        loadingStatus.value = "Rendering 3D scene...";
        previewMode.value = true;
    }
  } catch (error) {
    console.error("Failed to generate terrain:", error);
    alert("Failed to fetch terrain data. The requested area might be too large or service is down.");
  } finally {
    isLoading.value = false;
  }
};

const switchTo2D = () => {
  previewMode.value = false;
  terrainData.value = null;
};
</script>
