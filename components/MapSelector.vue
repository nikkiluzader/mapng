<template>
  <div class="w-full h-full bg-gray-100 relative z-0">
     <l-map 
        ref="mapRef"
        :center="[center.lat, center.lng]" 
        :zoom="zoom" 
        :options="mapOptions"
        style="height: 100%; width: 100%"
        @move="handleMove"
        @zoom="handleZoom"
     >
      <!-- Base Layers -->
      <l-tile-layer
        v-if="selectedLayer === 'osm'"
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        attribution="&copy; <a href='https://www.openstreetmap.org/copyright'>OpenStreetMap</a> contributors"
        layer-type="base"
      />

      <l-tile-layer
        v-if="selectedLayer === 'satellite'"
        url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
        attribution="&copy; <a href='https://www.esri.com/'>Esri</a>"
        layer-type="base"
        :max-zoom="18"
      />

      <l-tile-layer
        v-if="selectedLayer === 'topo'"
        url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}"
        attribution="&copy; <a href='https://www.esri.com/'>Esri</a>"
        layer-type="base"
      />

      <!-- Overlay -->
      <l-tile-layer
        v-if="showLabels"
        url="https://{s}.basemaps.cartocdn.com/rastertiles/voyager_only_labels/{z}/{x}/{y}{r}.png"
        attribution="&copy; <a href='https://www.openstreetmap.org/copyright'>OpenStreetMap</a> contributors &copy; <a href='https://carto.com/attributions'>CARTO</a>"
        layer-type="overlay"
        :opacity="0.7"
      />
      
      <l-rectangle 
        v-if="bounds"
        :bounds="[[bounds.getSouthWest().lat, bounds.getSouthWest().lng], [bounds.getNorthEast().lat, bounds.getNorthEast().lng]]" 
        color="#FF6600"
        :weight="2"
        :fill-opacity="0.1"
        :options="{ dashArray: '10, 10' }"
      />
    </l-map>

    <!-- Custom Layer Control -->
    <div class="absolute bottom-6 right-4 z-[400] bg-white rounded-lg shadow-xl border border-gray-200 overflow-hidden text-gray-800 text-xs">
        <div class="bg-gray-50 px-3 py-2 border-b border-gray-200 font-medium flex items-center gap-2">
            <Layers :size="14" class="text-[#FF6600]" />
            Map Layers
        </div>
        <div class="p-2 space-y-1">
            <label class="flex items-center gap-2 p-1 hover:bg-gray-50 rounded cursor-pointer">
                <input type="radio" v-model="selectedLayer" value="osm" class="accent-[#FF6600]" />
                <span>OpenStreetMap</span>
            </label>
            <label class="flex items-center gap-2 p-1 hover:bg-gray-50 rounded cursor-pointer">
                <input type="radio" v-model="selectedLayer" value="satellite" class="accent-[#FF6600]" />
                <span>Satellite</span>
            </label>
            <label class="flex items-center gap-2 p-1 hover:bg-gray-50 rounded cursor-pointer">
                <input type="radio" v-model="selectedLayer" value="topo" class="accent-[#FF6600]" />
                <span>Topo Map</span>
            </label>
            <div class="h-px bg-gray-100 my-1"></div>
            <label class="flex items-center gap-2 p-1 hover:bg-gray-50 rounded cursor-pointer">
                <input type="checkbox" v-model="showLabels" class="accent-[#FF6600]" />
                <span>Show Labels</span>
            </label>
        </div>
    </div>

    <!-- Center Crosshair -->
    <div class="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 z-[400] pointer-events-none">
        <div class="w-8 h-8 text-[#FF6600] drop-shadow-lg flex items-center justify-center">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="w-full h-full filter drop-shadow-md">
                <line x1="12" y1="4" x2="12" y2="20" />
                <line x1="4" y1="12" x2="20" y2="12" />
                <rect x="10" y="10" width="4" height="4" stroke-width="1" />
            </svg>
        </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted, nextTick } from 'vue';
import { LMap, LTileLayer, LRectangle } from '@vue-leaflet/vue-leaflet';
import { Layers } from 'lucide-vue-next';
import L from 'leaflet';
import { LatLng } from '../types';
import 'leaflet/dist/leaflet.css';

// Fix Leaflet icon assets
// @ts-ignore
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
});

// Static options to prevent reactivity issues
const mapOptions = { scrollWheelZoom: true };

interface Props {
  center: LatLng;
  zoom: number;
  resolution: number;
}

const props = defineProps<Props>();

const emit = defineEmits<{
  move: [center: LatLng];
  zoom: [zoom: number];
}>();

const mapRef = ref<any>(null);
const currentCenter = ref<LatLng>(props.center);
const currentZoom = ref<number>(props.zoom);
const selectedLayer = ref('osm');
const showLabels = ref(true);

// Calculate bounds based on resolution
const bounds = computed(() => {
  if (!mapRef.value?.leafletObject) return null;
  
  const map = mapRef.value.leafletObject;
  const center = currentCenter.value;
  const TERRAIN_ZOOM = 15;
  
  // Project the LatLng to World Pixels at Zoom 15
  const centerPoint = map.project([center.lat, center.lng], TERRAIN_ZOOM);
  const halfRes = props.resolution / 2;
  
  // Calculate bounds in pixel space
  const nwPoint = L.point(centerPoint.x - halfRes, centerPoint.y - halfRes);
  const sePoint = L.point(centerPoint.x + halfRes, centerPoint.y + halfRes);
  
  // Convert back to LatLng
  const nw = map.unproject(nwPoint, TERRAIN_ZOOM);
  const se = map.unproject(sePoint, TERRAIN_ZOOM);
  
  return L.latLngBounds(nw, se);
});

// Handle map move
const handleMove = () => {
  if (!mapRef.value?.leafletObject) return;
  const map = mapRef.value.leafletObject;
  const c = map.getCenter();
  currentCenter.value = { lat: c.lat, lng: c.lng };
  emit('move', currentCenter.value);
};

// Handle map zoom
const handleZoom = () => {
  if (!mapRef.value?.leafletObject) return;
  const map = mapRef.value.leafletObject;
  currentZoom.value = map.getZoom();
  emit('zoom', currentZoom.value);
};

// Watch for external center changes (e.g., from AI search)
watch(() => props.center, (newCenter: LatLng) => {
  const dist = Math.sqrt(
    Math.pow(currentCenter.value.lat - newCenter.lat, 2) + 
    Math.pow(currentCenter.value.lng - newCenter.lng, 2)
  );
  
  // Only move if significantly different to avoid fighting user drag
  if (dist > 0.0001 && mapRef.value?.leafletObject) {
    const map = mapRef.value.leafletObject;
    map.setView([newCenter.lat, newCenter.lng], props.zoom, { animate: true });
    currentCenter.value = newCenter;
  }
}, { deep: true });

// Watch for zoom changes
watch(() => props.zoom, (newZoom: number) => {
  if (newZoom !== currentZoom.value && mapRef.value?.leafletObject) {
    const map = mapRef.value.leafletObject;
    map.setZoom(newZoom);
    currentZoom.value = newZoom;
  }
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
