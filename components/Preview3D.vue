<template>
  <div class="w-full h-full bg-black relative group">
    <TresCanvas window-size clear-color="#000000">
      <TresPerspectiveCamera :args="cameraArgs" :position="cameraPosition" />
      <TresAmbientLight :intensity="0.5" />
      <TresDirectionalLight :position="[50, 50, 25]" :intensity="1" :cast-shadow="true" />
      
      <Environment :preset="preset" :background="true" />
      
      <TerrainMesh 
        :terrain-data="mergedTerrainData" 
        :quality="quality" 
        :texture-type="textureType"
        :wireframe="showWireframe"
      />

      <OSMFeatures3D 
        :terrain-data="terrainData"
        :visible="show3DFeatures"
      />
      
      <OrbitControls 
        ref="controlsRef"
        make-default
        :enable-damping="true" 
        :damping-factor="0.1" 
        :screen-space-panning="true"
        :min-distance="0.01"
        :max-distance="20000"
        :pan-speed="2.0"
        :zoom-speed="1.5"
      />
    </TresCanvas>

    <!-- Scene Controls Overlay -->
    <div class="absolute top-4 left-4 z-30 bg-white/90 backdrop-blur-md border border-gray-200 rounded-lg p-4 w-64 shadow-2xl transition-opacity opacity-0 group-hover:opacity-100">
       <div class="flex items-center gap-2 text-gray-900 mb-3 border-b border-gray-200 pb-2">
          <Settings :size="16" class="text-[#FF6600]" />
          <span class="text-sm font-bold">Scene Settings</span>
       </div>

       <!-- Quality Selector -->
       <div class="mb-4 space-y-2">
          <label class="text-xs text-gray-500 flex items-center gap-1">
              <Gauge :size="12" /> Mesh Quality
          </label>
          <div class="flex bg-gray-100 rounded-md p-1 border border-gray-200">
              <button
                  v-for="q in ['low', 'medium', 'high']"
                  :key="q"
                  @click="quality = q"
                  :class="['flex-1 text-xs py-1.5 rounded capitalize transition-colors',
                      quality === q 
                      ? 'bg-[#FF6600] text-white shadow-sm font-medium' 
                      : 'text-gray-500 hover:text-gray-900 hover:bg-white']"
              >
                  {{ q }}
              </button>
          </div>
          <p class="text-[10px] text-gray-400 text-right">
              {{ quality === 'low' ? 'Low poly' : quality === 'medium' ? 'Balanced' : 'Max Safe Detail' }}
          </p>
       </div>

       <!-- Environment Selector -->
       <div class="space-y-2 mb-4">
          <label class="text-xs text-gray-500 flex items-center gap-1">
              <Settings :size="12" /> Environment
          </label>
          <select
              v-model="preset"
              class="w-full appearance-none bg-white border border-gray-200 text-gray-900 text-xs rounded py-2 px-3 focus:ring-1 focus:ring-[#FF6600] outline-none capitalize cursor-pointer hover:bg-gray-50"
          >
              <option v-for="p in presets" :key="p" :value="p">{{ p }}</option>
          </select>
       </div>

       <!-- Overlays -->
       <div class="space-y-2">
          <label class="text-xs text-gray-500 flex items-center gap-1">
              <Layers :size="12" /> Texture Mode
          </label>
          
          <div class="flex bg-gray-100 rounded-md p-1 border border-gray-200 mb-2">
              <button
                  @click="textureType = 'satellite'"
                  :class="['flex-1 text-xs py-1.5 rounded transition-colors',
                      textureType === 'satellite' 
                      ? 'bg-[#FF6600] text-white shadow-sm font-medium' 
                      : 'text-gray-500 hover:text-gray-900 hover:bg-white']"
              >
                  Satellite
              </button>
              <button
                  @click="textureType = 'osm'"
                  :disabled="!terrainData.osmTextureUrl"
                  :title="!terrainData.osmTextureUrl ? 'No OSM data available' : 'Show OSM Layer'"
                  :class="['flex-1 text-xs py-1.5 rounded transition-colors',
                      textureType === 'osm' 
                      ? 'bg-[#FF6600] text-white shadow-sm font-medium' 
                      : !terrainData.osmTextureUrl ? 'text-gray-300 cursor-not-allowed' : 'text-gray-500 hover:text-gray-900 hover:bg-white']"
              >
                  OSM
              </button>
              <button
                  @click="textureType = 'hybrid'"
                  :disabled="!terrainData.hybridTextureUrl"
                  :title="!terrainData.hybridTextureUrl ? 'No Hybrid data available' : 'Show Hybrid Layer'"
                  :class="['flex-1 text-xs py-1.5 rounded transition-colors',
                      textureType === 'hybrid' 
                      ? 'bg-[#FF6600] text-white shadow-sm font-medium' 
                      : !terrainData.hybridTextureUrl ? 'text-gray-300 cursor-not-allowed' : 'text-gray-500 hover:text-gray-900 hover:bg-white']"
              >
                  Hybrid
              </button>
              <button
                  @click="textureType = 'none'"
                  :class="['flex-1 text-xs py-1.5 rounded transition-colors',
                      textureType === 'none' 
                      ? 'bg-[#FF6600] text-white shadow-sm font-medium' 
                      : 'text-gray-500 hover:text-gray-900 hover:bg-white']"
              >
                  None
              </button>
          </div>

          <!-- wireframe and 3D features -->
          <div class="space-y-3 pt-2">
              <label class="flex items-center gap-2 cursor-pointer group/check">
                  <div class="relative">
                      <input type="checkbox" v-model="showWireframe" class="peer sr-only" />
                      <div class="w-9 h-5 bg-gray-200 peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-[#FF6600]/20 rounded-full peer peer-checked:after:translate-x-full rtl:peer-checked:after:-translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:start-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-[#FF6600]"></div>
                  </div>
                  <span class="text-xs text-gray-700 group-hover/check:text-gray-900">Wireframe Mode</span>
              </label>

              <label class="flex items-center gap-2 cursor-pointer group/check">
                  <div class="relative">
                      <input type="checkbox" v-model="show3DFeatures" class="peer sr-only" />
                      <div class="w-9 h-5 bg-gray-200 peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-[#FF6600]/20 rounded-full peer peer-checked:after:translate-x-full rtl:peer-checked:after:-translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:start-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-[#FF6600]"></div>
                  </div>
                  <span class="text-xs text-gray-700 group-hover/check:text-gray-900 font-medium">Render 3D Objects</span>
              </label>
          </div>

          <!-- Ground Cover Toggle Panel -->
          <div class="mt-4 border-t border-gray-100 pt-3">
             <button 
                @click="showLayerPanel = !showLayerPanel"
                class="w-full flex items-center justify-between text-xs font-semibold text-gray-500 hover:text-gray-900 mb-2 transition-colors group"
             >
                <div class="flex items-center gap-1">
                    <Box :size="12" />
                    <span>Ground Cover Layers</span>
                    <span v-if="isRegenerating" class="ml-2 animate-spin text-[#FF6600]">
                       <Loader2 :size="10" />
                    </span>
                </div>
                <ChevronDown :size="14" :class="['transition-transform duration-200', showLayerPanel ? 'rotate-180' : '']" />
             </button>

             <transition
                enter-active-class="transition duration-200 ease-out"
                enter-from-class="transform opacity-0 -translate-y-2 scale-95"
                enter-to-class="transform opacity-100 translate-y-0 scale-100"
                leave-active-class="transition duration-150 ease-in"
                leave-from-class="transform opacity-100 translate-y-0 scale-100"
                leave-to-class="transform opacity-0 -translate-y-2 scale-95"
             >
                <div v-if="showLayerPanel" class="space-y-1.5 max-h-48 overflow-y-auto custom-scrollbar p-1">
                    <div v-if="availableCategories.length === 0" class="text-[10px] text-gray-400 italic py-2 text-center">
                        No terrain features detected
                    </div>
                    <label 
                        v-for="cat in availableCategories" 
                        :key="cat"
                        class="flex items-center gap-2 cursor-pointer group/layer px-1 py-0.5 rounded hover:bg-orange-50/50"
                    >
                        <div class="relative flex items-center">
                            <input 
                                type="checkbox" 
                                :checked="visibleLayers[cat] !== false"
                                @change="toggleLayer(cat)"
                                class="peer sr-only" 
                            />
                            <div class="w-7 h-4 bg-gray-200 rounded-full peer peer-checked:bg-[#FF6600] after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-3 after:w-3 after:transition-all peer-checked:after:translate-x-3"></div>
                        </div>
                        <span class="text-[10px] text-gray-600 group-hover/layer:text-gray-900 transition-colors">{{ cat }}</span>
                    </label>
                </div>
             </transition>
          </div>

          <div class="pt-4 border-t border-gray-100">
              <button 
                @click="resetCamera"
                class="w-full flex items-center justify-center gap-2 py-2 bg-gray-900 hover:bg-black text-white text-xs font-bold rounded-md transition-colors shadow-lg shadow-black/10"
              >
                <RotateCcw :size="14" />
                Reset Camera
              </button>
          </div>
       </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, watch, reactive, shallowRef } from 'vue';
import { TresCanvas } from '@tresjs/core';
import { OrbitControls, Environment } from '@tresjs/cientos';
import { Settings, Gauge, Layers, Box, RotateCcw, ChevronDown, Loader2 } from 'lucide-vue-next';
import TerrainMesh from './TerrainMesh.vue';
import OSMFeatures3D from './OSMFeatures3D.vue';
import { generateOSMTexture, generateHybridTexture, getFeatureCategory, generateLayerCanvases } from '../services/osmTexture';


const props = defineProps(['terrainData']);

const controlsRef = ref(null);
const quality = ref('high');
const preset = ref('dawn');
const textureType = ref('hybrid');
const showWireframe = ref(false);
const show3DFeatures = ref(true);
const showLayerPanel = ref(false);
const isRegenerating = ref(false);

const customOsmUrl = ref(null);
const customHybridUrl = ref(null);

const visibleLayers = reactive({});
const layerCache = shallowRef(null);

// Derive all available categories from the fetched features
const availableCategories = computed(() => {
    if (!props.terrainData?.osmFeatures) return [];
    const cats = new Set();
    props.terrainData.osmFeatures.forEach(f => {
        cats.add(getFeatureCategory(f));
    });
    return Array.from(cats).sort();
});

// Initialize layer state
watch(() => props.terrainData, async (newData) => {
    if (newData?.osmFeatures) {
        // Initialize layers
        availableCategories.value.forEach(cat => {
            if (visibleLayers[cat] === undefined) {
                // Roads are on by default per user request, others off
                visibleLayers[cat] = (cat === 'Roads');
            }
        });
        
        // Pre-render layers for instant toggling
        layerCache.value = await generateLayerCanvases(newData);
        
        // Generate initial textures
        await regenerateTextures();
    }
}, { immediate: true });

const toggleLayer = async (cat) => {
    visibleLayers[cat] = !visibleLayers[cat];
    await regenerateTextures();
};

const regenerateTextures = async () => {
    if (!props.terrainData) return;
    isRegenerating.value = true;
    try {
        // Call the service with current visibility options and pre-rendered canvases
        const osmUrl = await generateOSMTexture(props.terrainData, toRaw(visibleLayers), toRaw(layerCache.value));
        const hybridUrl = await generateHybridTexture(props.terrainData, toRaw(visibleLayers), toRaw(layerCache.value));
        
        customOsmUrl.value = osmUrl;
        customHybridUrl.value = hybridUrl;
    } catch (e) {
        console.error("Failed to regenerate textures:", e);
    } finally {
        isRegenerating.value = false;
    }
};

// Override prop data for rendering
const activeOsmTexture = computed(() => customOsmUrl.value || props.terrainData?.osmTextureUrl);
const activeHybridTexture = computed(() => customHybridUrl.value || props.terrainData?.hybridTextureUrl);

const mergedTerrainData = computed(() => {
    return {
        ...props.terrainData,
        osmTextureUrl: activeOsmTexture.value,
        hybridTextureUrl: activeHybridTexture.value
    };
});
const presets = ['city', 'dawn', 'sunset', 'night', 'forest', 'studio', 'umbrellas', 'snow', 'hangar', 'urban', 'modern', 'shangai'];

const resetCamera = () => {
    if (controlsRef.value) {
        // @ts-ignore - Handle different cientos/three versions
        const controls = controlsRef.value.instance || controlsRef.value;
        if (controls.object) {
            controls.object.position.set(0, 60, 90);
            controls.target.set(0, 0, 0);
            controls.update();
        } else if (typeof controls.reset === 'function') {
            controls.reset();
        }
    }
};

import { toRaw } from 'vue';

// Static camera config to prevent re-renders resetting position
const cameraPosition = [0, 60, 90];
const cameraArgs = [50, 1, 0.1, 50000];
</script>
