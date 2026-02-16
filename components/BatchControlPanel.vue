<template>
  <div class="space-y-6">
    <!-- Experimental Banner -->
    <div class="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg px-3 py-2 flex items-start gap-2">
      <AlertTriangle :size="14" class="text-amber-500 mt-0.5 shrink-0" />
      <p class="text-[10px] text-amber-700 dark:text-amber-400 leading-relaxed">
        <span class="font-bold">Experimental.</span> Batch processing is a work in progress. Large grids or high-resolution tiles may encounter issues.
      </p>
    </div>

    <!-- Grid Configuration -->
    <div class="space-y-4">
      <label class="text-sm font-medium text-gray-700 dark:text-gray-300 flex items-center gap-2">
        <Grid3X3 :size="16" class="text-gray-700 dark:text-gray-300" />
        Grid Configuration
      </label>

      <div class="bg-gray-50 dark:bg-gray-700 p-3 rounded border border-gray-200 dark:border-gray-600 space-y-3">
        <!-- Grid Width -->
        <div class="flex items-center justify-between">
          <span class="text-xs text-gray-600 dark:text-gray-400">Width (columns)</span>
          <div class="flex items-center gap-2">
            <button @click="gridCols = Math.max(1, gridCols - 1)"
              class="w-6 h-6 flex items-center justify-center rounded bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-600 transition-colors text-xs font-bold">
              −
            </button>
            <input type="number" v-model.number="gridCols" min="1" max="20"
              class="w-12 text-center bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded px-1 py-0.5 text-sm text-gray-900 dark:text-white focus:ring-1 focus:ring-[#FF6600] outline-none" />
            <button @click="gridCols = Math.min(20, gridCols + 1)"
              class="w-6 h-6 flex items-center justify-center rounded bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-600 transition-colors text-xs font-bold">
              +
            </button>
          </div>
        </div>

        <!-- Grid Height -->
        <div class="flex items-center justify-between">
          <span class="text-xs text-gray-600 dark:text-gray-400">Height (rows)</span>
          <div class="flex items-center gap-2">
            <button @click="gridRows = Math.max(1, gridRows - 1)"
              class="w-6 h-6 flex items-center justify-center rounded bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-600 transition-colors text-xs font-bold">
              −
            </button>
            <input type="number" v-model.number="gridRows" min="1" max="20"
              class="w-12 text-center bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded px-1 py-0.5 text-sm text-gray-900 dark:text-white focus:ring-1 focus:ring-[#FF6600] outline-none" />
            <button @click="gridRows = Math.min(20, gridRows + 1)"
              class="w-6 h-6 flex items-center justify-center rounded bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-600 transition-colors text-xs font-bold">
              +
            </button>
          </div>
        </div>

        <!-- Summary -->
        <div class="pt-2 border-t border-gray-200 dark:border-gray-600 space-y-2">
          <div class="grid grid-cols-3 gap-2 text-[10px]">
            <div class="text-center">
              <div class="text-gray-400 dark:text-gray-500">Tiles</div>
              <div class="text-gray-900 dark:text-white font-bold text-sm">{{ totalTiles }}</div>
            </div>
            <div class="text-center">
              <div class="text-gray-400 dark:text-gray-500">Total Area</div>
              <div class="text-[#FF6600] font-bold text-sm">{{ totalAreaDisplay }}</div>
            </div>
            <div class="text-center">
              <div class="text-gray-400 dark:text-gray-500">Perimeter</div>
              <div class="text-gray-900 dark:text-white font-bold text-sm">{{ perimeterDisplay }}</div>
            </div>
          </div>
          <div class="grid grid-cols-3 gap-2 text-[10px]">
            <div class="text-center">
              <div class="text-gray-400 dark:text-gray-500">West → East</div>
              <div class="text-gray-700 dark:text-gray-300 font-medium">{{ gridWidthDisplay }}</div>
            </div>
            <div class="text-center">
              <div class="text-gray-400 dark:text-gray-500">North → South</div>
              <div class="text-gray-700 dark:text-gray-300 font-medium">{{ gridHeightDisplay }}</div>
            </div>
            <div class="text-center">
              <div class="text-gray-400 dark:text-gray-500">Per Tile</div>
              <div class="text-gray-700 dark:text-gray-300 font-medium">{{ tileAreaDisplay }}</div>
            </div>
          </div>
        </div>

        <p v-if="totalTiles > 50" class="text-[10px] text-amber-600 dark:text-amber-500 font-medium">
          ⚠️ Large batch ({{ totalTiles }} tiles). This will take a long time and trigger many downloads.
        </p>
      </div>
    </div>

    <hr class="border-gray-200 dark:border-gray-600" />

    <!-- Resolution -->
    <div class="space-y-2">
      <label class="text-sm font-medium text-gray-700 dark:text-gray-300 flex items-center gap-2">
        <Box :size="16" class="text-gray-700 dark:text-gray-300" />
        Tile Resolution
      </label>
      <select :value="resolution" @change="$emit('resolutionChange', parseInt($event.target.value))"
        class="w-full bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded px-2 py-2 text-sm text-gray-900 dark:text-white focus:ring-2 focus:ring-[#FF6600] focus:border-[#FF6600] outline-none">
        <option :value="512">512 x 512 px (Fast)</option>
        <option :value="1024">1024 x 1024 px (Standard)</option>
        <option :value="2048">2048 x 2048 px (High Detail)</option>
        <option :value="4096">4096 x 4096 px (Very High)</option>
        <option :value="8192">8192 x 8192 px (Ultra)</option>
      </select>
      <div class="text-[10px] text-gray-500 dark:text-gray-400 space-y-1">
        <p>Each tile: {{ resolution }}m × {{ resolution }}m at 1m/px</p>
        <p>Grid coverage: {{ gridWidthDisplay }} × {{ gridHeightDisplay }}</p>
        <p v-if="resolution >= 4096" class="text-amber-600 dark:text-amber-500 font-medium">⚠️ High resolution tiles require significant RAM per tile.</p>
      </div>
    </div>

    <hr class="border-gray-200 dark:border-gray-600" />

    <!-- OSM Toggle -->
    <div class="flex items-center justify-between p-2 rounded bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600">
      <label class="text-xs text-gray-700 dark:text-gray-300 flex items-center gap-2 cursor-pointer">
        <Trees :size="12" class="text-emerald-600 dark:text-emerald-400" />
        Include OSM Features
      </label>
      <input type="checkbox" v-model="includeOSM" class="accent-[#FF6600] w-4 h-4 cursor-pointer" />
    </div>

    <!-- Elevation Source -->
    <div class="space-y-2">
      <button @click="showElevationSource = !showElevationSource"
        class="w-full flex items-center justify-between text-sm font-medium text-gray-700 dark:text-gray-300 hover:text-[#FF6600] transition-colors group">
        <span class="flex items-center gap-2">
          <Mountain :size="16" class="text-gray-500 dark:text-gray-400 group-hover:text-[#FF6600] transition-colors" />
          Elevation Data Source
        </span>
        <ChevronDown :size="14" :class="['transition-transform duration-200', showElevationSource ? 'rotate-180' : '']" />
      </button>

      <div v-if="showElevationSource" class="space-y-2 bg-gray-50 dark:bg-gray-700 p-2 rounded border border-gray-200 dark:border-gray-600">
        <label class="flex items-start gap-2 cursor-pointer p-1 hover:bg-gray-100 dark:hover:bg-gray-600 rounded transition-colors">
          <input type="radio" v-model="elevationSource" value="default" class="mt-0.5 accent-[#FF6600]" />
          <div class="space-y-0.5">
            <span class="block text-xs font-medium text-gray-900 dark:text-white">Standard (30m Global)</span>
            <span class="block text-[10px] text-gray-500 dark:text-gray-400 leading-tight">Amazon Terrarium (SRTM). Reliable global coverage.</span>
          </div>
        </label>
        <label class="flex items-start gap-2 cursor-pointer p-1 hover:bg-gray-100 dark:hover:bg-gray-600 rounded transition-colors">
          <input type="radio" v-model="elevationSource" value="usgs" class="mt-0.5 accent-[#FF6600]" />
          <div class="space-y-0.5">
            <span class="block text-xs font-medium text-gray-900 dark:text-white">USGS 1m DEM (USA Only)</span>
            <span class="block text-[10px] text-gray-500 dark:text-gray-400 leading-tight">High-precision. Falls back if unavailable.</span>
          </div>
        </label>
        <label class="flex items-start gap-2 cursor-pointer p-1 hover:bg-gray-100 dark:hover:bg-gray-600 rounded transition-colors">
          <input type="radio" v-model="elevationSource" value="gpxz" class="mt-0.5 accent-[#FF6600]" />
          <div class="space-y-0.5 w-full">
            <span class="block text-xs font-medium text-gray-900 dark:text-white">GPXZ (Premium Global)</span>
            <span class="block text-[10px] text-gray-500 dark:text-gray-400 leading-tight">Requires API Key. Best quality.</span>
            <div v-if="elevationSource === 'gpxz'" class="mt-2">
              <input type="password" v-model="gpxzApiKey" placeholder="Enter GPXZ API Key"
                class="w-full bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded px-2 py-1 text-xs text-gray-900 dark:text-white focus:ring-1 focus:ring-[#FF6600] outline-none" />
              <p class="text-[10px] text-amber-600 dark:text-amber-500 font-medium mt-1">
                ⚠️ Batch jobs with GPXZ use many API calls ({{ totalTiles }} tiles × multiple requests each).
              </p>
            </div>
          </div>
        </label>
      </div>
    </div>

    <hr class="border-gray-200 dark:border-gray-600" />

    <!-- Coordinates -->
    <div class="space-y-2">
      <button @click="showCoordinates = !showCoordinates"
        class="w-full flex items-center justify-between text-sm font-medium text-gray-700 dark:text-gray-300 hover:text-[#FF6600] transition-colors group">
        <span class="flex items-center gap-2">
          <MapPin :size="16" class="text-gray-500 dark:text-gray-400 group-hover:text-[#FF6600] transition-colors" />
          Grid Center
        </span>
        <ChevronDown :size="14" :class="['transition-transform duration-200', showCoordinates ? 'rotate-180' : '']" />
      </button>

      <template v-if="showCoordinates">
        <LocationSearch @select="handleSearchSelect" />

        <div class="grid grid-cols-2 gap-2">
          <div class="space-y-1">
            <label class="text-[10px] text-gray-500 dark:text-gray-400 font-medium px-1 uppercase tracking-wider">Latitude</label>
            <input type="text" v-model="latInput" @change="handleManualLocationChange"
              @paste="handleCoordinatePaste($event)" @keydown.enter="$event.target.blur()"
              class="w-full bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded px-2 py-1 text-xs text-gray-900 dark:text-white focus:ring-1 focus:ring-[#FF6600] outline-none"
              placeholder="Latitude" />
          </div>
          <div class="space-y-1">
            <label class="text-[10px] text-gray-500 dark:text-gray-400 font-medium px-1 uppercase tracking-wider">Longitude</label>
            <input type="text" v-model="lngInput" @change="handleManualLocationChange"
              @paste="handleCoordinatePaste($event)" @keydown.enter="$event.target.blur()"
              class="w-full bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded px-2 py-1 text-xs text-gray-900 dark:text-white focus:ring-1 focus:ring-[#FF6600] outline-none"
              placeholder="Longitude" />
          </div>
        </div>

        <select @change="handleLocationSelect"
          class="w-full bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded px-2 py-1.5 text-xs text-gray-900 dark:text-white focus:ring-1 focus:ring-[#FF6600] outline-none">
          <option v-for="(loc, index) in presetLocations" :key="index" :value="index" :disabled="loc.disabled"
            :selected="index === 0">
            {{ loc.name }}
          </option>
        </select>
      </template>
    </div>

    <hr class="border-gray-200 dark:border-gray-600" />

    <!-- Export Options -->
    <div class="space-y-3">
      <label class="text-sm font-medium text-gray-700 dark:text-gray-300 flex items-center gap-2">
        <Download :size="16" class="text-gray-700 dark:text-gray-300" />
        Export Options
      </label>

      <!-- 2D Assets -->
      <div class="space-y-1.5">
        <h4 class="text-[10px] font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500">2D Assets</h4>
        <div class="space-y-1 bg-gray-50 dark:bg-gray-700 p-2 rounded border border-gray-200 dark:border-gray-600">
          <label class="flex items-center gap-2 cursor-pointer text-xs text-gray-700 dark:text-gray-300">
            <input type="checkbox" v-model="exports.heightmap" class="accent-[#FF6600] w-3.5 h-3.5" />
            Heightmap (16-bit PNG)
          </label>
          <label class="flex items-center gap-2 cursor-pointer text-xs text-gray-700 dark:text-gray-300">
            <input type="checkbox" v-model="exports.satellite" class="accent-[#FF6600] w-3.5 h-3.5" />
            Satellite Texture (PNG)
          </label>
          <label class="flex items-center gap-2 cursor-pointer text-xs text-gray-700 dark:text-gray-300"
            :class="{ 'opacity-50': !includeOSM }">
            <input type="checkbox" v-model="exports.osmTexture" :disabled="!includeOSM"
              class="accent-[#FF6600] w-3.5 h-3.5" />
            OSM Texture (16K PNG)
          </label>
          <label class="flex items-center gap-2 cursor-pointer text-xs text-gray-700 dark:text-gray-300"
            :class="{ 'opacity-50': !includeOSM }">
            <input type="checkbox" v-model="exports.hybridTexture" :disabled="!includeOSM"
              class="accent-[#FF6600] w-3.5 h-3.5" />
            Hybrid Texture (16K PNG)
          </label>
          <label class="flex items-center gap-2 cursor-pointer text-xs text-gray-700 dark:text-gray-300"
            :class="{ 'opacity-50': !includeOSM }">
            <input type="checkbox" v-model="exports.roadMask" :disabled="!includeOSM"
              class="accent-[#FF6600] w-3.5 h-3.5" />
            Road Mask (16-bit PNG)
          </label>
        </div>
      </div>

      <!-- 3D Models -->
      <div class="space-y-1.5">
        <h4 class="text-[10px] font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500">3D Models</h4>
        <div class="space-y-1 bg-gray-50 dark:bg-gray-700 p-2 rounded border border-gray-200 dark:border-gray-600">
          <label class="flex items-center gap-2 cursor-pointer text-xs text-gray-700 dark:text-gray-300">
            <input type="checkbox" v-model="exports.glb" class="accent-[#FF6600] w-3.5 h-3.5" />
            GLB Model (.glb binary)
          </label>
          <label class="flex items-center gap-2 cursor-pointer text-xs text-gray-700 dark:text-gray-300">
            <input type="checkbox" v-model="exports.dae" class="accent-[#FF6600] w-3.5 h-3.5" />
            Collada DAE (.dae + textures)
          </label>
          <div v-if="exports.glb || exports.dae"
            class="flex items-center gap-2 pt-1 mt-1 border-t border-gray-200 dark:border-gray-600">
            <span class="text-[10px] text-gray-500 dark:text-gray-400">Mesh quality:</span>
            <select v-model.number="meshResolution"
              class="text-[10px] bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded px-1.5 py-0.5 text-gray-600 dark:text-gray-300 cursor-pointer">
              <option :value="128">Low</option>
              <option :value="256">Medium</option>
              <option :value="512">High</option>
              <option :value="1024">Ultra</option>
            </select>
          </div>
          <p v-if="exports.glb || exports.dae" class="text-[10px] text-gray-500 dark:text-gray-400">
            3D models generated without surrounding tiles (adjacent batch tiles serve as surroundings).
          </p>
        </div>
      </div>

      <!-- Geo Data -->
      <div class="space-y-1.5">
        <h4 class="text-[10px] font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500">Geo Data</h4>
        <div class="space-y-1 bg-gray-50 dark:bg-gray-700 p-2 rounded border border-gray-200 dark:border-gray-600">
          <label class="flex items-center gap-2 cursor-pointer text-xs text-gray-700 dark:text-gray-300">
            <input type="checkbox" v-model="exports.geotiff" class="accent-[#FF6600] w-3.5 h-3.5" />
            GeoTIFF (.tif)
          </label>
          <label class="flex items-center gap-2 cursor-pointer text-xs text-gray-700 dark:text-gray-300"
            :class="{ 'opacity-50': !includeOSM }">
            <input type="checkbox" v-model="exports.geojson" :disabled="!includeOSM"
              class="accent-[#FF6600] w-3.5 h-3.5" />
            GeoJSON (OSM vectors)
          </label>
        </div>
      </div>
    </div>

    <hr class="border-gray-200 dark:border-gray-600" />

    <!-- Selected exports count -->
    <div class="text-[10px] text-gray-500 dark:text-gray-400 bg-gray-50 dark:bg-gray-700 p-2 rounded border border-gray-200 dark:border-gray-600 space-y-1">
      <p><span class="font-medium text-gray-700 dark:text-gray-300">{{ selectedExportCount }} export{{ selectedExportCount !== 1 ? 's' : '' }}</span> selected per tile</p>
      <p>{{ totalTiles }} tiles × {{ selectedExportCount }} exports = <span class="text-[#FF6600] font-bold">{{ totalTiles * selectedExportCount }} total files</span> (packaged as {{ totalTiles }} ZIPs)</p>
      <p class="text-amber-600 dark:text-amber-500 font-medium mt-1">
        ℹ️ Your browser may ask permission to download multiple files.
      </p>
    </div>

    <!-- Action Buttons -->
    <div class="space-y-2">
      <button @click="handleStart" :disabled="selectedExportCount === 0 || isRunning || (elevationSource === 'gpxz' && !gpxzApiKey)"
        class="w-full py-3 font-bold rounded-md shadow-lg flex items-center justify-center gap-2 transition-all bg-[#FF6600] hover:bg-[#E65C00] text-white shadow-orange-900/10 disabled:opacity-50 disabled:cursor-not-allowed">
        <Play :size="16" />
        Start Batch Job ({{ totalTiles }} tiles)
      </button>

      <!-- Resume saved job -->
      <template v-if="savedState && !isRunning">
        <button @click="$emit('resumeBatch')"
          class="w-full py-2.5 font-medium rounded-md flex items-center justify-center gap-2 transition-all bg-emerald-600 hover:bg-emerald-700 text-white text-sm">
          <RotateCcw :size="14" />
          Resume Previous Job ({{ savedState.totalCompleted }}/{{ savedState.tiles.length }} done)
        </button>
        <button @click="$emit('clearSavedBatch')"
          class="w-full py-2 text-xs font-medium rounded-md flex items-center justify-center gap-2 transition-all bg-white dark:bg-gray-800 hover:bg-gray-50 dark:hover:bg-gray-700 border border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-400">
          <X :size="12" />
          Clear Saved Job
        </button>
      </template>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, watch, nextTick } from 'vue';
import { Grid3X3, Box, Trees, Mountain, MapPin, Download, ChevronDown, Play, RotateCcw, X, AlertTriangle } from 'lucide-vue-next';
import LocationSearch from './LocationSearch.vue';

const props = defineProps({
  center: { type: Object, required: true },
  resolution: { type: Number, required: true },
  isRunning: { type: Boolean, default: false },
  savedState: { type: Object, default: null },
});

const emit = defineEmits([
  'locationChange', 'resolutionChange', 'startBatch',
  'resumeBatch', 'clearSavedBatch', 'update:gridCols', 'update:gridRows',
]);

// Grid config
const gridCols = ref(parseInt(localStorage.getItem('mapng_batch_cols')) || 3);
const gridRows = ref(parseInt(localStorage.getItem('mapng_batch_rows')) || 3);

// Settings
const includeOSM = ref(localStorage.getItem('mapng_batch_osm') !== 'false');
const elevationSource = ref(localStorage.getItem('mapng_batch_elevation') || 'default');
const gpxzApiKey = ref(localStorage.getItem('mapng_gpxzApiKey') || '');
const showElevationSource = ref(false);
const showCoordinates = ref(false);
const meshResolution = ref(parseInt(localStorage.getItem('mapng_batch_mesh')) || 256);

// Export options
const exports = ref({
  heightmap: true,
  satellite: true,
  osmTexture: true,
  hybridTexture: true,
  roadMask: false,
  glb: false,
  dae: false,
  geotiff: false,
  geojson: false,
});

// Load saved export prefs
try {
  const saved = localStorage.getItem('mapng_batch_exports');
  if (saved) Object.assign(exports.value, JSON.parse(saved));
} catch { /* ignore */ }

// Coordinate inputs
const latInput = ref(props.center.lat.toString());
const lngInput = ref(props.center.lng.toString());

const presetLocations = [
  { name: "Select a location...", lat: 0, lng: 0, disabled: true },
  { name: "Angeles Crest Highway, USA", lat: 34.389292767087476, lng: -118.08463811874391 },
  { name: "Grand Canyon, USA", lat: 36.05758, lng: -112.14236 },
  { name: "Johnson Valley OHV, USA", lat: 34.49523, lng: -116.82180 },
  { name: "Mount Everest, Nepal", lat: 27.9881, lng: 86.9250 },
  { name: "Mount Fuji, Japan", lat: 35.3606, lng: 138.7274 },
  { name: "Matterhorn, Switzerland", lat: 45.9763, lng: 7.6586 },
  { name: "Yosemite Valley, USA", lat: 37.7456, lng: -119.5936 },
];

// Formatting helpers
function formatDist(km) {
  return km >= 1 ? `${km.toFixed(1)} km` : `${(km * 1000).toFixed(0)} m`;
}
function formatArea(km2) {
  return km2 >= 1 ? `${km2.toFixed(2)} km²` : `${(km2 * 1_000_000).toFixed(0)} m²`;
}

// Computed
const totalTiles = computed(() => gridCols.value * gridRows.value);
const gridWidthKm = computed(() => (gridCols.value * props.resolution) / 1000);
const gridHeightKm = computed(() => (gridRows.value * props.resolution) / 1000);
const totalAreaKm = computed(() => gridWidthKm.value * gridHeightKm.value);
const totalAreaDisplay = computed(() => formatArea(totalAreaKm.value));
const perimeterDisplay = computed(() => formatDist(2 * (gridWidthKm.value + gridHeightKm.value)));
const tileAreaKm = computed(() => (props.resolution * props.resolution) / 1_000_000);
const tileAreaDisplay = computed(() => formatArea(tileAreaKm.value));
const gridWidthDisplay = computed(() => formatDist(gridWidthKm.value));
const gridHeightDisplay = computed(() => formatDist(gridHeightKm.value));
const selectedExportCount = computed(() =>
  Object.values(exports.value).filter(Boolean).length
);

// Handlers
const handleManualLocationChange = () => {
  const lat = parseFloat(latInput.value);
  const lng = parseFloat(lngInput.value);
  if (!isNaN(lat) && !isNaN(lng)) emit('locationChange', { lat, lng });
};

const handleCoordinatePaste = (e) => {
  const pasted = (e.clipboardData || window.clipboardData).getData('text').trim();
  const match = pasted.match(/^([\-]?\d+\.?\d*)\s*[,\s\t]+\s*([\-]?\d+\.?\d*)$/);
  if (match) {
    e.preventDefault();
    const a = parseFloat(match[1]);
    const b = parseFloat(match[2]);
    if (!isNaN(a) && !isNaN(b)) {
      latInput.value = a.toString();
      lngInput.value = b.toString();
      emit('locationChange', { lat: a, lng: b });
    }
    return;
  }
  nextTick(() => handleManualLocationChange());
};

const handleSearchSelect = (result) => emit('locationChange', { lat: result.lat, lng: result.lng });

const handleLocationSelect = (e) => {
  const idx = parseInt(e.target.value);
  if (idx > 0) {
    const loc = presetLocations[idx];
    emit('locationChange', { lat: loc.lat, lng: loc.lng });
    e.target.selectedIndex = 0;
  }
};

const handleStart = () => {
  emit('startBatch', {
    center: { ...props.center },
    resolution: props.resolution,
    gridCols: gridCols.value,
    gridRows: gridRows.value,
    includeOSM: includeOSM.value,
    elevationSource: elevationSource.value,
    gpxzApiKey: gpxzApiKey.value,
    glbMeshResolution: meshResolution.value,
    exports: { ...exports.value },
  });
};

// Sync center from parent
watch(() => props.center, (newVal) => {
  if (parseFloat(latInput.value) !== newVal.lat) latInput.value = newVal.lat.toString();
  if (parseFloat(lngInput.value) !== newVal.lng) lngInput.value = newVal.lng.toString();
}, { deep: true });

// Emit grid changes for map overlay
watch(gridCols, (v) => {
  localStorage.setItem('mapng_batch_cols', String(v));
  emit('update:gridCols', v);
});
watch(gridRows, (v) => {
  localStorage.setItem('mapng_batch_rows', String(v));
  emit('update:gridRows', v);
});

// Persist settings
watch(includeOSM, (v) => localStorage.setItem('mapng_batch_osm', String(v)));
watch(elevationSource, (v) => localStorage.setItem('mapng_batch_elevation', v));
watch(gpxzApiKey, (v) => localStorage.setItem('mapng_gpxzApiKey', v));
watch(meshResolution, (v) => localStorage.setItem('mapng_batch_mesh', String(v)));
watch(exports, (v) => localStorage.setItem('mapng_batch_exports', JSON.stringify(v)), { deep: true });

// Disable OSM-dependent exports when OSM is off
watch(includeOSM, (v) => {
  if (!v) {
    exports.value.osmTexture = false;
    exports.value.hybridTexture = false;
    exports.value.roadMask = false;
    exports.value.geojson = false;
  }
});

// Initial emit to set grid on map
emit('update:gridCols', gridCols.value);
emit('update:gridRows', gridRows.value);
</script>
