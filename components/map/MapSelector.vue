<template>
  <div class="w-full h-full bg-gray-100 relative z-0">
     <l-map 
        ref="mapRef"
        :center="initialCenter"
        :zoom="initialZoom" 
        :options="mapOptions"
        style="height: 100%; width: 100%"
        @move="handleMove"
        @moveend="flushMove"
        @zoom="handleZoom"
        @ready="onMapReady"
     >
      <!-- Base Layers (one world: no copies east or west, services/mapView.js) -->
      <l-tile-layer
        v-if="selectedLayer === 'osm'"
        :key="osmUrl"
        :url="osmUrl"
        :attribution="osmAttribution"
        layer-type="base"
        :options="{ ...ONE_WORLD, maxNativeZoom: osmMaxNativeZoom }"
      />

      <l-tile-layer
        v-if="selectedLayer === 'satellite'"
        url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
        attribution="&copy; <a href='https://www.esri.com/'>Esri</a>"
        layer-type="base"
        :max-zoom="18"
        :options="ONE_WORLD"
      />

      <l-tile-layer
        v-if="selectedLayer === 'topo'"
        url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}"
        attribution="&copy; <a href='https://www.esri.com/'>Esri</a>"
        layer-type="base"
        :options="ONE_WORLD"
      />

      <!-- Place and road names, only on the bases that have none (dark canvas,
           satellite when "Show names" is on): Esri reference layers (keyless).
           z-index keeps them above a base layer switched in after them. -->
      <template v-if="showLabels">
        <l-tile-layer
          v-for="layer in labelLayers"
          :key="layer.url"
          :url="layer.url"
          :attribution="ESRI_REFERENCE_ATTRIBUTION"
          layer-type="overlay"
          :opacity="layer.opacity"
          :z-index="10"
          :options="{ ...ONE_WORLD, maxNativeZoom: layer.maxNativeZoom, minZoom: layer.minZoom ?? 0, maxZoom: layer.maxZoom ?? 22, updateWhenZooming: false, keepBuffer: 1 }"
        />
      </template>
      
      <!-- The world's edge: past it the map repeats (dimmed) so an edge selection
           still shows both sides; the centre stops on the line (keepCenterOnWorld) -->
      <l-polygon
        v-if="maskPaneReady"
        :lat-lngs="OUTSIDE_WORLD"
        pane="mapngMask"
        :stroke="false"
        fill-color="#000000"
        :fill-opacity="isDarkMode ? 0.45 : 0.3"
        :interactive="false"
      />
      <l-rectangle
        v-if="maskPaneReady"
        :bounds="WORLD_BOUNDS"
        pane="mapngMask"
        :color="isDarkMode ? '#e5e7eb' : '#374151'"
        :weight="2"
        :fill="false"
        :interactive="false"
        :options="{ dashArray: '8, 6' }"
      />

      <!-- MapNG's own OSM coverage (control panel toggle): the hosted archives' outlines -->
      <template v-if="showOsmCoverage">
        <l-polygon
          v-for="area in osmCoverageAreas"
          :key="`osm-coverage-${area.region}`"
          :lat-lngs="area.rings"
          color="#10B981"
          :weight="2"
          :fill-opacity="0.06"
          :options="{ dashArray: '6, 6', lineCap: 'round' }"
        >
          <l-tooltip :options="{ sticky: true }">
            {{ t('map.osmCoverageTooltip', { region: formatCoverageRegion(area.region), date: area.builtAt.slice(0, 10) }) }}
          </l-tooltip>
        </l-polygon>
      </template>

      <!-- Everything outside the selection a little darker, so the export area stands out -->
      <l-polygon
        v-if="selectionMask && maskPaneReady"
        :lat-lngs="selectionMask"
        pane="mapngMask"
        :stroke="false"
        fill-color="#000000"
        :fill-opacity="isDarkMode ? 0.32 : 0.2"
        :interactive="false"
      />
      <l-marker
        v-if="selectionLabel"
        :lat-lng="selectionLabel.at"
        :icon="selectionLabel.icon"
        :interactive="false"
        :keyboard="false"
      />

      <l-rectangle 
        v-if="selectionBounds && !hasBatchGrid && !showUploadedCoverageBounds"
        :bounds="[[selectionBounds.south, selectionBounds.west], [selectionBounds.north, selectionBounds.east]]" 
        color="#FF6600"
        :weight="2"
        :fill-opacity="0.1"
        :interactive="false"
        :options="{ dashArray: '2, 8', lineCap: 'round' }"
      />

      <l-rectangle
        v-if="showUploadedCoverageBounds && !hasBatchGrid"
        :bounds="[[nativeCoverageBounds.south, nativeCoverageBounds.west], [nativeCoverageBounds.north, nativeCoverageBounds.east]]"
        color="#3B82F6"
        :weight="1.5"
        :fill-opacity="0.04"
        :options="{ dashArray: '5, 7', lineCap: 'round' }"
      />

      <l-rectangle
        v-for="tile in uploadedCoverageTiles"
        v-if="showUploadedTileZones && !hasBatchGrid"
        :key="`uploaded-zip-tile-${tile.index}`"
        :bounds="[[tile.bounds.south, tile.bounds.west], [tile.bounds.north, tile.bounds.east]]"
        color="#60A5FA"
        :weight="1"
        :fill-opacity="0.02"
        :options="{ dashArray: '3, 4', lineCap: 'round' }"
      >
        <l-tooltip :permanent="false" direction="top" :offset="[0, -6]">
          {{ tile.label }}
        </l-tooltip>
      </l-rectangle>

      <l-rectangle
        v-for="tile in uploadedMissingTiles"
        v-if="showUploadedTileZones && !hasBatchGrid"
        :key="`uploaded-zip-missing-${tile.row}-${tile.col}`"
        :bounds="[[tile.bounds.south, tile.bounds.west], [tile.bounds.north, tile.bounds.east]]"
        color="#EF4444"
        :weight="1.5"
        :fill-opacity="0.08"
        :options="{ dashArray: '2, 6', lineCap: 'round' }"
      >
        <l-tooltip :permanent="false" direction="top" :offset="[0, -6]">
          {{ t('map.missingTile', { label: tile.label }) }}
        </l-tooltip>
      </l-rectangle>

      <l-rectangle
        v-if="uploadedCropBounds && !hasBatchGrid"
        :bounds="[[uploadedCropBounds.south, uploadedCropBounds.west], [uploadedCropBounds.north, uploadedCropBounds.east]]"
        color="#FF6600"
        :weight="2"
        :fill-opacity="0.1"
        :interactive="false"
        :options="{ dashArray: '2, 8', lineCap: 'round' }"
      />

      <!-- Batch Grid Tiles -->
      <l-rectangle
        v-for="tile in batchGrid"
        :key="'batch-' + tile.index"
        :bounds="[[tile.bounds.south, tile.bounds.west], [tile.bounds.north, tile.bounds.east]]"
        :color="batchTileColor(tile)"
        :weight="tile.status === 'processing' ? 2.5 : 1.5"
        :fill-opacity="batchTileFillOpacity(tile)"
        :options="{ dashArray: tile.status === 'pending' ? '4, 6' : undefined, lineCap: 'round' }"
      />

      <l-marker
        v-for="tile in batchGrid"
        v-if="batchEditable"
        :key="'batch-handle-' + tile.index"
        :lat-lng="[tile.center.lat, tile.center.lng]"
        :draggable="true"
        :icon="batchHandleIcon"
        @drag="(event) => handleBatchTileDrag(tile, event)"
        @dragend="(event) => handleBatchTileDrag(tile, event)"
      >
        <l-tooltip :permanent="false" direction="top" :offset="[0, -8]">
          {{ t('mapSelector.moveTile', { label: tile.label || `R${tile.row + 1}C${tile.col + 1}` }) }}
        </l-tooltip>
      </l-marker>

      <!-- Surrounding Tile Bounding Boxes (hidden during batch mode) -->
      <l-rectangle
        v-for="rect in surroundingBounds"
        v-if="!hasBatchGrid"
        :key="rect.key"
        :bounds="[[rect.south, rect.west], [rect.north, rect.east]]"
        color="#3B82F6"
        :weight="1.5"
        :fill-opacity="0.06"
        :options="{ dashArray: '4, 6', lineCap: 'round' }"
      />
    </l-map>

    <!-- Live free-dataset elevation preview, fitted to the selection area -->
    <ElevationOverlay :bounds="elevationOverlayBounds" />

    <!-- Layer panel: the base map, MapNG's own overlays, and the two opt-ins. Folds to its header. -->
    <div class="absolute bottom-20 right-4 z-[400] w-[220px] max-h-[calc(100%-7rem)] overflow-y-auto bg-white dark:bg-gray-800 rounded-lg shadow-xl border border-gray-200 dark:border-gray-600 text-gray-800 dark:text-gray-200 text-xs">
        <button
          type="button"
          class="w-full bg-gray-50 dark:bg-gray-700 px-3 py-2 font-medium flex items-center gap-2 text-left"
          :class="layerPanelOpen ? 'border-b border-gray-200 dark:border-gray-600' : ''"
          :aria-expanded="layerPanelOpen"
          @click="layerPanelOpen = !layerPanelOpen"
        >
          <Layers :size="14" class="text-[#FF6600]" />
          <span class="flex-1">{{ t('mapSelector.mapLayers') }}</span>
          <ChevronDown :size="14" class="text-gray-400 transition-transform" :class="layerPanelOpen ? '' : '-rotate-90'" />
        </button>
        <div v-if="layerPanelOpen" class="p-2 space-y-1">
            <p :class="PANEL_HEADING">{{ t('mapSelector.groupMap') }}</p>
            <label :class="PANEL_ROW">
                <input type="radio" v-model="selectedLayer" value="osm" class="accent-[#FF6600]" />
                <span>{{ t('mapSelector.openStreetMap') }}</span>
            </label>
            <label :class="PANEL_ROW">
                <input type="radio" v-model="selectedLayer" value="satellite" class="accent-[#FF6600]" />
                <span>{{ t('mapSelector.satellite') }}</span>
            </label>
            <label v-if="selectedLayer === 'satellite'" :class="PANEL_ROW" class="pl-7">
                <input type="checkbox" v-model="satelliteNames" :class="CHECKBOX" />
                <span>{{ t('mapSelector.satelliteNames') }}</span>
            </label>
            <label :class="PANEL_ROW">
                <input type="radio" v-model="selectedLayer" value="topo" class="accent-[#FF6600]" />
                <span>{{ t('mapSelector.topoMap') }}</span>
            </label>

            <p :class="PANEL_HEADING" class="pt-2">{{ t('mapSelector.groupShow') }}</p>
            <label :class="PANEL_ROW" :title="t('controlPanel.osmCoverageHint')">
                <input type="checkbox" v-model="showOsmCoverage" :class="CHECKBOX" />
                <span>{{ t('mapSelector.osmCoverage') }}</span>
            </label>
            <p v-if="showOsmCoverage && osmCoverageStatus !== 'ready'" class="pl-7 -mt-1 text-[10px]" :class="osmCoverageStatus === 'unavailable' ? 'text-amber-600 dark:text-amber-400' : 'text-gray-500 dark:text-gray-400'">
              {{ osmCoverageStatus === 'unavailable' ? t('controlPanel.osmCoverageUnavailable') : t('controlPanel.osmCoverageLoading') }}
            </p>
            <label :class="PANEL_ROW">
                <input type="checkbox" v-model="showHotspots" :class="CHECKBOX" />
                <span>{{ t('mapSelector.hotspots') }}</span>
            </label>
            <p v-if="showHotspots" class="pl-7 -mt-1 text-[10px]" :class="hotspotsStatus === 'unavailable' ? 'text-amber-600 dark:text-amber-400' : 'text-gray-500 dark:text-gray-400'">
              {{ hotspotsStatus === 'unavailable' ? t('hotspots.unavailable') : hotspotsStatus === 'loading' ? t('hotspots.loading') : t('mapSelector.hotspotsCount', { count: (hotspotTotals.web + hotspotTotals.desktop).toLocaleString() }) }}
            </p>

            <p :class="PANEL_HEADING" class="pt-2">{{ t('mapSelector.groupSharing') }}</p>
            <label :class="PANEL_ROW">
                <input type="checkbox" :checked="shareExports === 'on'" @change="setShareExports($event.target.checked)" :class="CHECKBOX" />
                <span>{{ t('mapSelector.shareExports') }}</span>
            </label>
            <button type="button" class="pl-7 -mt-1 block text-[10px] text-[#FF6600] hover:underline" @click="openHotspotPrivacy">{{ t('hotspots.privacy.link') }}</button>
            <!-- (separate: which settings, never where; composables/useUsageStats.js) -->
            <label :class="PANEL_ROW">
                <input type="checkbox" :checked="shareSettings === 'on'" @change="setShareSettings($event.target.checked)" :class="CHECKBOX" />
                <span>{{ t('usage.shareToggle') }}</span>
            </label>
            <a href="https://mapng.com/data.html#usage" target="_blank" rel="noopener" class="block pl-7 -mt-1 text-[10px] text-[#FF6600] hover:underline">{{ t('usage.readMore') }}</a>
        </div>
    </div>

    <!-- Edit in OSM CTA -->
    <div class="absolute bottom-6 right-4 z-[400] bg-white dark:bg-gray-800 rounded-lg shadow-xl border border-gray-200 dark:border-gray-600 overflow-hidden text-gray-800 dark:text-gray-200 text-xs">
      <div class="p-2">
        <button
          @click="openInOsm"
          type="button"
          :title="t('map.editInOsm')"
          :aria-label="t('map.editInOsm')"
          class="w-full text-left text-[12px] font-medium text-teal-700 hover:text-teal-900 dark:text-teal-300 dark:hover:text-teal-200 transition-colors px-2 py-1.5"
        >
          {{ t('map.editInOsm') }}
        </button>
      </div>
    </div>

    <!-- Center Crosshair -->
    <div class="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 z-[400] pointer-events-none">
        <div class="w-8 h-8 text-[#FF6600] drop-shadow-lg flex items-center justify-center">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1" class="w-full h-full filter drop-shadow-md">
                <line x1="12" y1="4" x2="12" y2="20" />
                <line x1="4" y1="12" x2="20" y2="12" />
                <rect x="10" y="10" width="4" height="4" stroke-width="1" />
            </svg>
        </div>
    </div>

    <!-- Right-click menu -->
    <div
      v-if="contextMenu"
      class="absolute z-[1000] min-w-[180px] rounded-lg shadow-xl border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-200 text-xs py-1"
      :style="{ left: `${contextMenu.x}px`, top: `${contextMenu.y}px` }"
      role="menu"
      @contextmenu.prevent
    >
      <div class="px-3 py-1 text-[10px] text-gray-500 dark:text-gray-400 font-mono">{{ formatLatLng(contextMenu.lat, contextMenu.lng) }}</div>
      <button type="button" role="menuitem" class="w-full text-left px-3 py-1.5 hover:bg-gray-100 dark:hover:bg-gray-700" @click="centerSelectionHere">{{ t('map.centerHere') }}</button>
      <button type="button" role="menuitem" class="w-full text-left px-3 py-1.5 hover:bg-gray-100 dark:hover:bg-gray-700" @click="copyCoordinates">{{ copiedNotice ? t('map.copied') : t('map.copyCoordinates') }}</button>
    </div>
  </div>
</template>

<script setup>
// (bundled, not fetched from a CDN: one less outside service)
import markerIcon2x from 'leaflet/dist/images/marker-icon-2x.png';
import markerIcon from 'leaflet/dist/images/marker-icon.png';
import markerShadow from 'leaflet/dist/images/marker-shadow.png';
import { useUsageStats } from '../../composables/useUsageStats.js';
import { ref, computed, watch, onMounted, onBeforeUnmount, nextTick } from 'vue';
import { useI18n } from 'vue-i18n';
import { LMap, LTileLayer, LRectangle, LMarker, LTooltip, LPolygon } from '@vue-leaflet/vue-leaflet';
import { Layers, ChevronDown } from 'lucide-vue-next';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import ElevationOverlay from './ElevationOverlay.vue';
import { getAdjacentBounds, POSITION_LABELS } from '../../services/surroundingTiles';
import { computeMetricSelectionBounds, computeUploadedCropBounds } from '../../services/uploadBounds';
import { CHECKBOX } from '../base/controlStyles.js';
import { useOsmCoverage } from '../../composables/useOsmCoverage.js';
import { useExportHotspots } from '../../composables/useExportHotspots.js';
import { addHotspotLayer } from '../../services/hotspotLayer.js';
import { daysSince } from '../../services/exportHotspots.js';
import { WORLD_BOUNDS, minZoomForWidth, formatSelectionSize, formatLatLng, clampLng } from '../../services/mapView.js';

// Fix Leaflet icon assets
// @ts-ignore
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: markerIcon2x,
  iconUrl: markerIcon,
  shadowUrl: markerShadow,
});

// Static options to prevent reactivity issues. One flat world: the centre
// stops at ±180° and Mercator's ±85°, and the world never repeats east or west.
const mapOptions = {
  scrollWheelZoom: true,
  worldCopyJump: false,   // (the pan limit: keepCenterOnWorld)
};
// (tiles repeat past ±180° so a selection at the edge still shows what lies
// across it; the border and the dimmed outside mark where the world ends)
const ONE_WORLD = {};
const OUTSIDE_WORLD = [
  [[-89.9, -900], [89.9, -900], [89.9, 900], [-89.9, 900]],
  [[WORLD_BOUNDS[0][0], -180], [WORLD_BOUNDS[1][0], -180], [WORLD_BOUNDS[1][0], 180], [WORLD_BOUNDS[0][0], 180]],
];
const { t, locale } = useI18n({ useScope: 'global' });
const { show: showOsmCoverage, areas: osmCoverageAreas, status: osmCoverageStatus } = useOsmCoverage();
// Archive regions are Geofabrik slugs ("utah", "new-mexico").
// (planet pieces are named planet-<z>-<x>-<y>: shown as "World")
const formatCoverageRegion = (region) => (region.startsWith('planet')
  ? t('map.osmCoverageWorld')
  : region.replace(/[-_]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()));


const props = defineProps({
  center: { type: Object, required: true },
  zoom: { type: Number, required: true },
  resolution: { type: [Number, String], required: true },
  processingMetersPerPixel: { type: [Number, String], default: 1 },
  isDarkMode: { type: Boolean, default: false },
  uploadedElevationFile: { type: [Object, Array], default: null },
  uploadedElevationMeta: { type: Object, default: null },
  uploadedAreaMode: { type: String, default: 'native' },
  surroundingTilePositions: { type: Array, default: () => [] },
  batchGrid: { type: Array, default: () => [] },
  batchEditable: { type: Boolean, default: false },
});

const hasBatchGrid = computed(() => props.batchGrid && props.batchGrid.length > 0);

const batchTileColor = (tile) => {
  switch (tile.status) {
    case 'processing': return '#3B82F6';
    case 'completed': return '#10B981';
    case 'failed': return '#EF4444';
    default: return '#FF6600';
  }
};

const batchTileFillOpacity = (tile) => {
  switch (tile.status) {
    case 'processing': return 0.2;
    case 'completed': return 0.15;
    case 'failed': return 0.2;
    default: return 0.05;
  }
};

const emit = defineEmits(['move', 'zoom', 'batchTileDrag']);

const mapRef = ref(null);
// The map's starting view only. Later centre/zoom changes from outside go
// through the watchers below: binding the live props here made vue-leaflet
// pan back to every centre this map had just reported, which cut animated
// moves (flyTo, panTo) short.
const initialCenter = [props.center.lat, props.center.lng];
const initialZoom = props.zoom;
const currentCenter = ref(props.center);
const currentZoom = ref(props.zoom);
// Remembered across reloads.
const MAP_LAYERS = ['osm', 'satellite', 'topo'];
const readStored = (key) => { try { return localStorage.getItem(key); } catch { return null; } };
const writeStored = (key, value) => { try { localStorage.setItem(key, value); } catch { /* storage blocked */ } };
const storedLayer = readStored('mapng_mapLayer');
const selectedLayer = ref(MAP_LAYERS.includes(storedLayer) ? storedLayer : 'osm');
// Names on satellite imagery (default on). The light OSM and topo maps have
// their own names, and the dark base never does: labels go only where missing.
const satelliteNames = ref(readStored('mapng_satelliteLabels') !== 'false');
const showLabels = computed(() => (selectedLayer.value === 'satellite' ? satelliteNames.value : selectedLayer.value === 'osm' && props.isDarkMode));
watch(selectedLayer, (v) => writeStored('mapng_mapLayer', v));
const layerPanelOpen = ref(readStored('mapng_layerPanelOpen') !== 'false');
watch(layerPanelOpen, (v) => writeStored('mapng_layerPanelOpen', String(v)));
const PANEL_ROW = 'flex items-center gap-2 p-1 hover:bg-gray-50 dark:hover:bg-gray-700 rounded cursor-pointer';
const PANEL_HEADING = 'px-1 text-[10px] font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400';
watch(satelliteNames, (v) => writeStored('mapng_satelliteLabels', String(v)));
const isMovingProgrammatically = ref(false);


const batchHandleIcon = L.divIcon({
  className: 'mapng-batch-handle',
  html: '<div style="width:14px;height:14px;border-radius:9999px;background:#FF6600;border:2px solid white;box-shadow:0 0 0 1px rgba(0,0,0,0.25);"></div>',
  iconSize: [14, 14],
  iconAnchor: [7, 7],
});

const handleBatchTileDrag = (tile, event) => {
  const marker = event?.target;
  if (!marker || !tile) return;
  const latLng = marker.getLatLng();
  if (!latLng) return;
  emit('batchTileDrag', {
    index: tile.index,
    row: tile.row,
    col: tile.col,
    lat: latLng.lat,
    lng: latLng.lng,
  });
};

// Keyless Esri tiles (the satellite / topo layers come from the same servers).
// CARTO's basemaps started rendering "API KEY REQUIRED" in 2026-10.
const ESRI_TILES = 'https://server.arcgisonline.com/ArcGIS/rest/services';
// Esri serves HTTP/1.1 only (6 connections per host), so the label layers come
// from Esri's second host instead of queueing behind the satellite tiles; they
// also skip the intermediate zoom levels while zooming (updateWhenZooming).
const ESRI_LABEL_TILES = 'https://services.arcgisonline.com/ArcGIS/rest/services';
const ESRI_REFERENCE_ATTRIBUTION = 'Labels &copy; <a href="https://www.esri.com/">Esri</a> and its data providers';

const osmUrl = computed(() => {
  return props.isDarkMode
    ? `${ESRI_TILES}/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}`
    : 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png';
});

// Esri's Canvas basemaps stop at z16 ("Map data not yet available" tiles
// beyond); Leaflet upscales instead. vue-leaflet only passes this via options.
const osmMaxNativeZoom = computed(() => (props.isDarkMode ? 16 : 19));

const osmAttribution = computed(() => {
  return props.isDarkMode
    ? '&copy; <a href="https://www.esri.com/">Esri</a>, HERE, Garmin &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
    : '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';
});

const labelLayers = computed(() => (selectedLayer.value !== 'satellite'
  ? [{ url: `${ESRI_LABEL_TILES}/Canvas/World_Dark_Gray_Reference/MapServer/tile/{z}/{y}/{x}`, maxNativeZoom: 16, opacity: 1 }]
  : [
    // Each layer only where it helps (fewer tiles on Esri's 6-connection host):
    // roads and street names from z11, place names up to z15.
    { url: `${ESRI_LABEL_TILES}/Reference/World_Transportation/MapServer/tile/{z}/{y}/{x}`, maxNativeZoom: 19, minZoom: 11, opacity: 0.8 },
    { url: `${ESRI_LABEL_TILES}/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}`, maxNativeZoom: 17, maxZoom: 15, opacity: 1 },
  ]));

// Calculate bounds from output size and processing meters-per-pixel.
const activeSelectionSizeMeters = computed(() => {
  const base = Number(props.resolution);
  const mpp = Number(props.processingMetersPerPixel);

  if (!Number.isFinite(base) || base <= 0) return 1024;
  if (!Number.isFinite(mpp) || mpp <= 0) return base;
  return base * mpp;
});

const bounds = computed(() => {
  const metricBounds = computeMetricSelectionBounds(currentCenter.value, activeSelectionSizeMeters.value);
  if (!metricBounds) return null;
  const nw = L.latLng(metricBounds.north, metricBounds.west);
  const se = L.latLng(metricBounds.south, metricBounds.east);
  return L.latLngBounds(nw, se);
});

const selectionBounds = computed(() => {
  if (!bounds.value) return null;
  return {
    north: bounds.value.getNorthEast().lat,
    south: bounds.value.getSouthWest().lat,
    east: bounds.value.getNorthEast().lng,
    west: bounds.value.getSouthWest().lng,
  };
});

const nativeCoverageBounds = computed(() => {
  const b = props.uploadedElevationMeta?.bounds;
  if (!props.uploadedElevationFile || !b) return null;
  if (![b.north, b.south, b.east, b.west].every((v) => Number.isFinite(v))) return null;
  return {
    north: b.north,
    south: b.south,
    east: b.east,
    west: b.west,
  };
});

const showUploadedCoverageBounds = computed(() => !!nativeCoverageBounds.value);

const uploadedCoverageTiles = computed(() => {
  const tiles = props.uploadedElevationMeta?.zipTileBounds;
  if (!Array.isArray(tiles)) return [];
  return tiles.filter((tile) => {
    const b = tile?.bounds;
    return b && [b.north, b.south, b.east, b.west].every((value) => Number.isFinite(value));
  });
});

const uploadedMissingTiles = computed(() => {
  const tiles = props.uploadedElevationMeta?.zipMissingTileBounds;
  if (!Array.isArray(tiles)) return [];
  return tiles.filter((tile) => {
    const b = tile?.bounds;
    return b && [b.north, b.south, b.east, b.west].every((value) => Number.isFinite(value));
  });
});

const showUploadedTileZones = computed(() => {
  if (!showUploadedCoverageBounds.value) return false;
  const format = String(props.uploadedElevationMeta?.sourceFormat || '').toLowerCase();
  return format === 'gml-zip' && uploadedCoverageTiles.value.length > 1;
});

const uploadedCropBounds = computed(() => {
  if (!nativeCoverageBounds.value || props.uploadedAreaMode !== 'crop') return null;
  return computeUploadedCropBounds(currentCenter.value, activeSelectionSizeMeters.value, nativeCoverageBounds.value);
});

// Area the elevation minimap stays fitted to: the batch grid extent when a
// grid is shown, otherwise the crop box (BYOD crop mode) or the selection box.
const elevationOverlayBounds = computed(() => {
  if (hasBatchGrid.value) {
    let north = -Infinity;
    let south = Infinity;
    let east = -Infinity;
    let west = Infinity;
    for (const tile of props.batchGrid) {
      const b = tile?.bounds;
      if (!b) continue;
      north = Math.max(north, b.north);
      south = Math.min(south, b.south);
      east = Math.max(east, b.east);
      west = Math.min(west, b.west);
    }
    if ([north, south, east, west].every((v) => Number.isFinite(v))) {
      return { north, south, east, west };
    }
  }
  return uploadedCropBounds.value || selectionBounds.value;
});

// Compute surrounding tile bounding boxes from current center + resolution
const surroundingBounds = computed(() => {
  if (!props.surroundingTilePositions?.length) return [];

  const center = currentCenter.value;
  const sizeMeters = activeSelectionSizeMeters.value;
  
  const metersPerDegLat = 111320;
  const metersPerDegLng = 111320 * Math.cos(center.lat * Math.PI / 180);
  
  const latSpan = sizeMeters / metersPerDegLat;
  const lngSpan = sizeMeters / metersPerDegLng;
  
  const centerBounds = {
    north: center.lat + latSpan / 2,
    south: center.lat - latSpan / 2,
    east:  center.lng + lngSpan / 2,
    west:  center.lng - lngSpan / 2,
  };

  return props.surroundingTilePositions.map(pos => ({
    key: pos,
    label: POSITION_LABELS[pos],
    ...getAdjacentBounds(centerBounds, pos),
  }));
});

// Handle map move
// The map's own centre the last time it was reported. Leaflet also fires
// 'move' when nothing moved (layout resizes); re-reporting its pixel-rounded
// centre then overwrote coordinates typed with more precision (issue #3).
let lastMapCenter = null;
const mapCenterUnchanged = (c) => lastMapCenter
  && Math.abs(c.lat - lastMapCenter.lat) < 1e-12
  && Math.abs(c.lng - lastMapCenter.lng) < 1e-12;

const handleMove = () => {
  if (isMovingProgrammatically.value) return;
  if (!mapRef.value?.leafletObject) return;
  const map = mapRef.value.leafletObject;
  const c = map.getCenter();
  if (mapCenterUnchanged(c)) return;
  lastMapCenter = { lat: c.lat, lng: c.lng };

  currentCenter.value = { lat: c.lat, lng: clampLng(c.lng) };
  emitMove(currentCenter.value);
};

// The rest of the app hears about a drag at most every MOVE_EMIT_MS, and
// exactly where it ends (moveend): each report re-renders the sidebar, and
// with a big terrain loaded that churn kept the 2D map stalling on garbage
// collection. The selection box here follows every move (currentCenter).
const MOVE_EMIT_MS = 120;
let pendingMove = null;
// The last centre this map reported: when it comes back as the center prop it
// is our own echo (already behind the map during an animated move), not a
// request to move; obeying it cut flyTo/panTo animations short.
let lastEmitted = null;
let moveTimer = null;
let lastMoveEmitAt = 0;
const flushMove = () => {
  clearTimeout(moveTimer);
  moveTimer = null;
  if (!pendingMove) return;
  lastMoveEmitAt = performance.now();
  const c = pendingMove;
  pendingMove = null;
  lastEmitted = c;
  emit('move', c);
};
const emitMove = (c) => {
  pendingMove = c;
  const since = performance.now() - lastMoveEmitAt;
  if (since >= MOVE_EMIT_MS) flushMove();
  else if (!moveTimer) moveTimer = setTimeout(flushMove, MOVE_EMIT_MS - since);
};

// Handle map zoom
const handleZoom = () => {
  if (!mapRef.value?.leafletObject) return;
  const map = mapRef.value.leafletObject;
  currentZoom.value = map.getZoom();
  emit('zoom', currentZoom.value);
};

// Where a programmatic move (typed coordinates, search) was sent: reported
// back exactly when the map lands there, instead of the map's own
// pixel-rounded centre, so manually entered coordinates keep every digit.
let programmaticTarget = null;
const PROGRAMMATIC_LANDING_DEG = 1e-6;

const onMoveEnd = () => {
    isMovingProgrammatically.value = false;
    // Ensure we sync final position
    if (mapRef.value?.leafletObject) {
        const map = mapRef.value.leafletObject;
        const c = map.getCenter();
        const target = programmaticTarget;
        programmaticTarget = null;
        // This listener stays registered after the first programmatic move, so
        // it also sees no-op moveends (layout resizes): nothing to report then.
        if (!target && mapCenterUnchanged(c)) return;
        lastMapCenter = { lat: c.lat, lng: c.lng };
        currentCenter.value = target
          && Math.abs(c.lat - target.lat) < PROGRAMMATIC_LANDING_DEG
          && Math.abs(c.lng - target.lng) < PROGRAMMATIC_LANDING_DEG
          ? { lat: target.lat, lng: target.lng }
          : { lat: c.lat, lng: clampLng(c.lng) };
        lastEmitted = currentCenter.value;
        emit('move', currentCenter.value);
    }
};

const onDragStart = () => {
    isMovingProgrammatically.value = false;
    programmaticTarget = null;
};

// Open current view in OpenStreetMap iD editor (new tab)
const openInOsm = () => {
  try {
    let center = props.center;
    let zoom = props.zoom;
    if (mapRef.value?.leafletObject) {
      const map = mapRef.value.leafletObject;
      const c = map.getCenter();
      center = { lat: c.lat, lng: c.lng };
      zoom = map.getZoom();
    } else {
      center = currentCenter.value || props.center;
      zoom = currentZoom.value || props.zoom;
    }

    const url = `https://www.openstreetmap.org/edit?editor=id#map=${zoom}/${center.lat}/${center.lng}`;
    window.open(url, '_blank', 'noopener,noreferrer');
  } catch (err) {
    console.warn('openInOsm failed', err);
    const url = `https://www.openstreetmap.org/?mlat=${props.center.lat}&mlon=${props.center.lng}#map=${props.zoom}/${props.center.lat}/${props.center.lng}`;
    window.open(url, '_blank', 'noopener,noreferrer');
  }
};

// Watch for external center changes (e.g., from AI search)
watch(() => props.center, (newCenter) => {
  if (lastEmitted && newCenter && newCenter.lat === lastEmitted.lat && newCenter.lng === lastEmitted.lng) return;
  const dist = Math.sqrt(
    Math.pow(currentCenter.value.lat - newCenter.lat, 2) + 
    Math.pow(currentCenter.value.lng - newCenter.lng, 2)
  );
  
  // Only move if significantly different to avoid fighting user drag
  if (dist > 0.0001 && mapRef.value?.leafletObject) {
    const map = mapRef.value.leafletObject;
    isMovingProgrammatically.value = true;
    
    map.off('moveend', onMoveEnd);
    map.off('dragstart', onDragStart);
    
    map.on('moveend', onMoveEnd);
    map.on('dragstart', onDragStart);
    
    programmaticTarget = { lat: newCenter.lat, lng: newCenter.lng };
    map.setView([newCenter.lat, newCenter.lng], props.zoom, { animate: true });
    currentCenter.value = newCenter;
  } else {
    // Too small to move the map (< ~11 m), but it is the new centre: keep it,
    // or the next map event reports the old one back over the typed value.
    currentCenter.value = { lat: newCenter.lat, lng: newCenter.lng };
  }
}, { deep: true });

// Watch for zoom changes
watch(() => props.zoom, (newZoom) => {
  if (newZoom !== currentZoom.value && mapRef.value?.leafletObject) {
    const map = mapRef.value.leafletObject;
    map.setZoom(newZoom);
    currentZoom.value = newZoom;
  }
});

// Export hotspots (control panel toggle): everyone's shared export cells
const { show: showHotspots, cells: hotspotCells, status: hotspotsStatus, totals: hotspotTotals, share: shareExports, setShareExports, openHotspotPrivacy } = useExportHotspots();
const { share: shareSettings, setShareSettings } = useUsageStats();
const leafletMap = ref(null);
let hotspotLayer = null;

// The box the map's own tools frame (the elevation preview's box): the export
// area, the BYOD crop or the batch grid. Dimmed around, labelled with its size.
const maskedBox = computed(() => (hasBatchGrid.value ? null : (uploadedCropBounds.value || (showUploadedCoverageBounds.value ? null : selectionBounds.value))));
// Only once the box is big enough on screen to read (zoomed out, the dim
// would just grey the whole map and the label would cover what is there).
const maskPaneReady = ref(false);
const boxScreenPx = computed(() => {
  const b = maskedBox.value;
  if (!b) return 0;
  const lat = (b.north + b.south) / 2;
  const metersPerPx = (156543.03 * Math.cos((lat * Math.PI) / 180)) / 2 ** currentZoom.value;
  return activeSelectionSizeMeters.value / metersPerPx;
});
const selectionMask = computed(() => {
  const b = maskedBox.value;
  if (!b || boxScreenPx.value < 48) return null;
  return [
    [[-89.9, -900], [89.9, -900], [89.9, 900], [-89.9, 900]],
    [[b.south, b.west], [b.north, b.west], [b.north, b.east], [b.south, b.east]],
  ];
});
const selectionLabel = computed(() => {
  const b = maskedBox.value;
  const size = activeSelectionSizeMeters.value;
  const text = formatSelectionSize(size, size);
  if (!b || !text || boxScreenPx.value < 48) return null;
  return {
    at: [b.north, (b.east + b.west) / 2],
    icon: L.divIcon({
      className: 'mapng-selection-size',
      html: `<span>${text}</span>`,
      iconSize: [0, 0],
    }),
  };
});

// Map tools (Leaflet controls, top left under the zoom buttons): zoom to the
// selection, a scale bar, the coordinates under the mouse.
const coordsText = () => {
  const c = currentCenter.value;
  return formatLatLng(c?.lat, c?.lng);
};
const zoomToSelection = () => {
  const map = leafletMap.value;
  const b = elevationOverlayBounds.value;
  if (!map || !b) return;
  // Zoom only: the selection is the map centre, so moving the centre would move it.
  const zoom = map.getBoundsZoom([[b.south, b.west], [b.north, b.east]], false, L.point(120, 120));
  map.setZoom(Math.min(zoom, map.getMaxZoom() || 19));
};
// Two labelled rows: the mouse, and the crosshair (the selection's centre).
// Text set directly (no Vue render per mouse move).
let cursorValueEl = null;
let centerValueEl = null;
const showCursor = (text) => { if (cursorValueEl) cursorValueEl.textContent = text; };
watch(currentCenter, () => { if (centerValueEl) centerValueEl.textContent = coordsText(); });

const addMapTools = (map) => {
  const ZoomBox = L.Control.extend({
    options: { position: 'topleft' },
    onAdd() {
      const bar = L.DomUtil.create('div', 'leaflet-bar');
      const a = L.DomUtil.create('a', 'mapng-zoom-selection', bar);
      a.href = '#';
      a.role = 'button';
      a.title = t('map.zoomToSelection');
      a.setAttribute('aria-label', t('map.zoomToSelection'));
      a.innerHTML = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5"/><rect x="9" y="9" width="6" height="6" rx="1"/></svg>';
      L.DomEvent.disableClickPropagation(bar);
      L.DomEvent.on(a, 'click', (e) => { L.DomEvent.preventDefault(e); zoomToSelection(); });
      return bar;
    },
  });
  const Coords = L.Control.extend({
    options: { position: 'topleft' },
    onAdd() {
      const box = L.DomUtil.create('div', 'mapng-coords');
      const row = (key, label, value) => {
        const r = L.DomUtil.create('div', `mapng-coords__row mapng-coords__row--${key}`, box);
        const icon = L.DomUtil.create('span', 'mapng-coords__icon', r);
        icon.innerHTML = key === 'cursor'
          ? '<svg viewBox="0 0 24 24" width="11" height="11" fill="currentColor"><path d="M5 3l14 7-6 2-2 6z"/></svg>'
          : '<svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M12 3v18M3 12h18"/></svg>';
        L.DomUtil.create('span', 'mapng-coords__label', r).textContent = label;
        const v = L.DomUtil.create('span', 'mapng-coords__value', r);
        v.textContent = value;
        return v;
      };
      cursorValueEl = row('cursor', t('map.coordsCursor'), '—');
      centerValueEl = row('center', t('map.coordsCrosshair'), coordsText());
      return box;
    },
  });
  // Shortcut hints under the coordinates
  const Keys = L.Control.extend({
    options: { position: 'topleft' },
    onAdd() {
      const box = L.DomUtil.create('div', 'mapng-keys');
      const row = (keys, text) => {
        const r = L.DomUtil.create('div', 'mapng-keys__row', box);
        const k = L.DomUtil.create('span', 'mapng-keys__keys', r);
        keys.forEach((key, i) => {
          if (i) k.append('+');
          L.DomUtil.create('kbd', '', k).textContent = key;
        });
        L.DomUtil.create('span', 'mapng-keys__text', r).textContent = text;
      };
      row([t('map.keyScroll')], t('map.keyZoomCursor'));
      row([t('map.keyCtrl'), t('map.keyScroll')], t('map.keyZoomCrosshair'));
      row([t('map.keyRightClick')], t('map.keyMenu'));
      row(['←↑↓→'], t('map.keyNudge'));
      return box;
    },
  });
  new ZoomBox().addTo(map);
  L.control.scale({ position: 'topleft', maxWidth: 140 }).addTo(map);
  new Coords().addTo(map);
  new Keys().addTo(map);

  // Ctrl + scroll: zoom on the crosshair (the selection stays put); plain
  // scroll zooms toward the mouse. Leaflet reads this option when it zooms,
  // so each wheel event sets it first (capture phase, before Leaflet's own).
  map.getContainer().addEventListener('wheel', (e) => {
    map.options.scrollWheelZoom = e.ctrlKey ? 'center' : true;
  }, { capture: true, passive: true });

  let frame = 0;
  map.on('mousemove', (e) => {
    if (frame) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      showCursor(formatLatLng(e.latlng.lat, clampLng(e.latlng.lng)));
    });
  });
  map.on('mouseout', () => { cancelAnimationFrame(frame); frame = 0; showCursor('—'); });
};

// One world fills the map's width at the furthest-out zoom (no grey sides).
const fitMinZoom = (map) => {
  const z = minZoomForWidth(map.getSize().x);
  map.setMinZoom(z);
  if (map.getZoom() < z) map.setZoom(z);
};

// The pan limit: the map's centre (the selection) stays on the world, at any
// zoom, with blank space past the edges. (Leaflet's own maxBounds limits the
// view instead, so the centre stopped half a screen short of every edge;
// padding it fails north and south, where Mercator clips at ±85°.)
const keepCenterOnWorld = (map) => {
  const clampPoint = (p, zoom) => {
    const world = 256 * 2 ** zoom;
    return L.point(Math.min(world, Math.max(0, p.x)), Math.min(world, Math.max(0, p.y)));
  };
  // setView / zoom / flyTo: Leaflet asks _limitCenter for every target
  const limitCenter = map._limitCenter;
  map._limitCenter = function (center, zoom, bounds) {
    const limited = limitCenter.call(this, center, zoom, bounds);
    const p = this.project(limited, zoom);
    const clamped = clampPoint(p, zoom);
    return clamped.equals(p) ? limited : this.unproject(clamped, zoom);
  };
  // dragging: hold the pane where the centre is still on the world
  map.dragging._draggable?.on('predrag', function () {
    const half = map.getSize().divideBy(2);
    const origin = map.getPixelOrigin();
    const world = 256 * 2 ** map.getZoom();
    const pos = this._newPos;
    pos.x = Math.min(half.x + origin.x, Math.max(half.x + origin.x - world, pos.x));
    pos.y = Math.min(half.y + origin.y, Math.max(half.y + origin.y - world, pos.y));
  });
  // a fling's coast (inertia): Leaflet sizes it here first; cut it at the edge
  const limitOffset = map._limitOffset;
  map._limitOffset = function (offset, bounds) {
    const limited = limitOffset.call(this, offset, bounds);
    const z = this.getZoom();
    const from = this.getPixelBounds().getCenter();
    const to = clampPoint(from.add(limited), z);
    return to.subtract(from);
  };
  // anything else that still ends past an edge: settle back on it
  map.on('moveend', () => {
    const z = map.getZoom();
    const raw = map.getPixelBounds().getCenter();
    const want = clampPoint(raw, z);
    if (!want.equals(raw)) map.panTo(map.unproject(want, z), { animate: true, duration: 0.25 });
  });
};

// Right-click (or long-press) menu: move the selection here, copy the spot.
const contextMenu = ref(null);   // { x, y, lat, lng } in map-container pixels
const copiedNotice = ref(false);
const closeContextMenu = () => { contextMenu.value = null; };
const centerSelectionHere = () => {
  const m = contextMenu.value;
  closeContextMenu();
  if (!m || !leafletMap.value) return;
  leafletMap.value.panTo([m.lat, m.lng]);
};
const copyCoordinates = async () => {
  const m = contextMenu.value;
  if (!m) return;
  try {
    await navigator.clipboard.writeText(formatLatLng(m.lat, m.lng));
    copiedNotice.value = true;
    setTimeout(() => { copiedNotice.value = false; closeContextMenu(); }, 900);
  } catch {
    closeContextMenu();
  }
};
const onKeydown = (e) => { if (e.key === 'Escape') closeContextMenu(); };

const onMapReady = (map) => {
  leafletMap.value = map;
  // (the dim outside the selection: above the tiles, under every overlay)
  map.createPane('mapngMask').style.zIndex = '350';
  map.getPane('mapngMask').style.pointerEvents = 'none';
  maskPaneReady.value = true;
  if (import.meta.env.DEV) window.__mapngMap = map;   // (dev server only: browser checks drive the map)
  fitMinZoom(map);
  map.on('resize', () => fitMinZoom(map));
  keepCenterOnWorld(map);
  addMapTools(map);
  map.on('contextmenu', (e) => {
    copiedNotice.value = false;
    // (kept inside the map: the menu is ~200 × 100 px)
    const size = map.getSize();
    contextMenu.value = {
      x: Math.min(e.containerPoint.x, size.x - 200),
      y: Math.min(e.containerPoint.y, size.y - 100),
      lat: e.latlng.lat,
      lng: clampLng(e.latlng.lng),
    };
  });
  map.on('movestart zoomstart click', closeContextMenu);
  window.addEventListener('keydown', onKeydown);
};
onBeforeUnmount(() => window.removeEventListener('keydown', onKeydown));
const hotspotWhen = (dot) => {
  const days = daysSince(dot.lastDay);
  if (days === null) return '';
  const ago = days === 0 ? t('hotspots.today') : days === 1 ? t('hotspots.yesterday') : t('hotspots.daysAgo', { n: days });
  return t('hotspots.lastExport', { when: ago });
};
const hotspotText = () => ({
  count: (dot) => t('hotspots.count', { count: dot.total.toLocaleString() }, dot.total),
  tooltip: (dot) => [t('hotspots.count', { count: dot.total.toLocaleString() }, dot.total), hotspotWhen(dot)].filter(Boolean).join(' · ')
    + (dot.cells > 1 ? ` (${t('hotspots.clickToZoom')})` : ''),
  when: hotspotWhen,
  web: t('hotspots.web'),
  desktop: t('hotspots.desktop'),
  moveHere: t('map.centerHere'),
});
watch([leafletMap, showHotspots, hotspotCells, locale], ([map, on, cells]) => {
  if (hotspotLayer) { hotspotLayer.remove(); hotspotLayer = null; }
  if (!map || !on || !cells.length) return;
  hotspotLayer = addHotspotLayer(map, cells, hotspotText(), (dot) => {
    // "Move selection here": to the cell, close enough to see what is there
    map.flyTo([dot.lat, dot.lon], Math.max(map.getZoom(), 13), { duration: 0.8 });
  });
});

// Fix for initial load centering
onMounted(() => {
  nextTick(() => {
    setTimeout(() => {
      if (mapRef.value?.leafletObject) {
        const map = mapRef.value.leafletObject;
        map.invalidateSize();
        map.setView([props.center.lat, props.center.lng], props.zoom, { animate: false });
      }
    }, 200);
  });
});
</script>

<style>
/* Map cursor: a thin crosshair like the selection's (white halo for satellite
   and dark maps), also while dragging; clickable things keep the hand. */
.leaflet-container.leaflet-grab,
.leaflet-dragging .leaflet-container.leaflet-grab,
.leaflet-container.leaflet-grab.leaflet-dragging,
.leaflet-dragging .leaflet-grab { cursor: url("data:image/svg+xml;utf8,%3Csvg%20xmlns%3D%22http%3A//www.w3.org/2000/svg%22%20width%3D%2224%22%20height%3D%2224%22%20viewBox%3D%220%200%2024%2024%22%3E%3Cg%20fill%3D%22none%22%20stroke-linecap%3D%22round%22%3E%3Cpath%20d%3D%22M12%202v7M12%2015v7M2%2012h7M15%2012h7%22%20stroke%3D%22%23fff%22%20stroke-width%3D%224%22/%3E%3Cpath%20d%3D%22M12%202v7M12%2015v7M2%2012h7M15%2012h7%22%20stroke%3D%22%231f2937%22%20stroke-width%3D%221.6%22/%3E%3Ccircle%20cx%3D%2212%22%20cy%3D%2212%22%20r%3D%221.6%22%20fill%3D%22%23FF6600%22%20stroke%3D%22%23fff%22%20stroke-width%3D%221%22/%3E%3C/g%3E%3C/svg%3E") 12 12, crosshair; }
.leaflet-dragging .leaflet-grab .leaflet-interactive { cursor: url("data:image/svg+xml;utf8,%3Csvg%20xmlns%3D%22http%3A//www.w3.org/2000/svg%22%20width%3D%2224%22%20height%3D%2224%22%20viewBox%3D%220%200%2024%2024%22%3E%3Cg%20fill%3D%22none%22%20stroke-linecap%3D%22round%22%3E%3Cpath%20d%3D%22M12%202v7M12%2015v7M2%2012h7M15%2012h7%22%20stroke%3D%22%23fff%22%20stroke-width%3D%224%22/%3E%3Cpath%20d%3D%22M12%202v7M12%2015v7M2%2012h7M15%2012h7%22%20stroke%3D%22%231f2937%22%20stroke-width%3D%221.6%22/%3E%3Ccircle%20cx%3D%2212%22%20cy%3D%2212%22%20r%3D%221.6%22%20fill%3D%22%23FF6600%22%20stroke%3D%22%23fff%22%20stroke-width%3D%221%22/%3E%3C/g%3E%3C/svg%3E") 12 12, crosshair; }
/* Map tools (MapSelector addMapTools): one look with Leaflet's zoom bar */
.mapng-zoom-selection { display: flex !important; align-items: center; justify-content: center; color: #374151; }
.mapng-zoom-selection:hover { color: #FF6600; }
.leaflet-control-scale-line { background: rgba(255, 255, 255, 0.8); border-color: #4b5563; color: #1f2937; font-size: 10px; }
.mapng-coords {
  background: rgba(255, 255, 255, 0.92); color: #1f2937; border-radius: 6px; padding: 3px 7px;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.18), 0 0 0 1px rgba(0, 0, 0, 0.08);
  pointer-events: none; white-space: nowrap;
  display: grid; grid-template-columns: auto auto auto; column-gap: 6px; row-gap: 1px; align-items: center;
  font: 10px/16px system-ui, sans-serif;
}
.mapng-coords__row { display: contents; }
.mapng-coords__icon { display: flex; color: #6b7280; }
.mapng-coords__row--center .mapng-coords__icon { color: #FF6600; }
.mapng-coords__label { color: #6b7280; font-weight: 600; text-transform: uppercase; letter-spacing: 0.04em; font-size: 9px; }
.mapng-coords__value { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-variant-numeric: tabular-nums; min-width: 128px; }
.dark .leaflet-container { background: #111827; }
.dark .leaflet-bar a, .dark .mapng-zoom-selection { background: #1f2937; color: #e5e7eb; border-color: #4b5563; }
.dark .leaflet-bar a:hover { background: #374151; }
.dark .leaflet-control-scale-line { background: rgba(31, 41, 55, 0.85); color: #e5e7eb; border-color: #9ca3af; text-shadow: none; }
.dark .mapng-coords { background: rgba(31, 41, 55, 0.92); color: #e5e7eb; box-shadow: 0 1px 3px rgba(0, 0, 0, 0.4), 0 0 0 1px rgba(255, 255, 255, 0.12); }
.dark .mapng-coords__icon, .dark .mapng-coords__label { color: #9ca3af; }
.dark .mapng-coords__row--center .mapng-coords__icon { color: #FF8533; }
/* Shortcut hints (under the coordinates) */
.mapng-keys {
  background: rgba(255, 255, 255, 0.92); color: #4b5563; border-radius: 6px; padding: 4px 7px;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.18), 0 0 0 1px rgba(0, 0, 0, 0.08);
  pointer-events: none; white-space: nowrap; font: 10px/16px system-ui, sans-serif;
  display: grid; grid-template-columns: auto auto; column-gap: 8px; row-gap: 2px; align-items: center;
}
.mapng-keys__row { display: contents; }
.mapng-keys__keys { display: flex; align-items: center; gap: 2px; color: #9ca3af; }
.mapng-keys kbd {
  font: 600 9px/14px system-ui, sans-serif; color: #1f2937; background: #f3f4f6; border: 1px solid #d1d5db;
  border-bottom-width: 2px; border-radius: 4px; padding: 0 4px;
}
.dark .mapng-keys { background: rgba(31, 41, 55, 0.92); color: #d1d5db; box-shadow: 0 1px 3px rgba(0, 0, 0, 0.4), 0 0 0 1px rgba(255, 255, 255, 0.12); }
.dark .mapng-keys kbd { color: #e5e7eb; background: #374151; border-color: #4b5563; }
/* The selection's size, pinned above its top edge */
.mapng-selection-size { pointer-events: none; }
.mapng-selection-size span {
  position: absolute; left: 0; bottom: 4px; transform: translateX(-50%); white-space: nowrap;
  background: #FF6600; color: #fff; font: 600 10px/16px system-ui, sans-serif; padding: 0 6px; border-radius: 9999px;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.3);
}
</style>

<style>
/* Export hotspot popup (services/hotspotLayer.js) */
.mapng-hotspot-popup { min-width: 170px; font: 12px/1.4 system-ui, sans-serif; color: #1f2937; }
.mapng-hotspot-popup__title { font-weight: 600; font-size: 13px; margin-bottom: 6px; }
.mapng-hotspot-popup__bar { display: flex; gap: 2px; height: 6px; border-radius: 3px; overflow: hidden; margin-bottom: 4px; }
.mapng-hotspot-popup__bar span { display: block; min-width: 4px; }
.mapng-hotspot-popup__web { background: #FF6600; }
.mapng-hotspot-popup__desktop { background: #3B82F6; }
.mapng-hotspot-popup__legend { display: flex; align-items: center; gap: 4px; font-size: 11px; color: #4b5563; }
.mapng-hotspot-popup__key { display: inline-block; width: 8px; height: 8px; border-radius: 2px; }
.mapng-hotspot-popup__legend .mapng-hotspot-popup__desktop { margin-left: 8px; }
.mapng-hotspot-popup__when { font-size: 11px; color: #6b7280; margin-top: 4px; }
.mapng-hotspot-popup__button {
  margin-top: 8px; width: 100%; padding: 4px 8px; border-radius: 6px; background: #FF6600; color: #fff;
  font-weight: 600; font-size: 11px; border: 0; cursor: pointer;
}
.mapng-hotspot-popup__button:hover { background: #e55a00; }
.dark .mapng-hotspot-popup-wrap .leaflet-popup-content-wrapper,
.dark .mapng-hotspot-popup-wrap .leaflet-popup-tip { background: #1f2937; box-shadow: none; }
.dark .mapng-hotspot-popup { color: #e5e7eb; }
.dark .mapng-hotspot-popup__legend { color: #d1d5db; }
.dark .mapng-hotspot-popup__when { color: #9ca3af; }
</style>
