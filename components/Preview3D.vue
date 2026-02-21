<template>
  <div class="w-full h-full bg-black relative overflow-hidden">
    <TresCanvas window-size :clear-color="textureType === 'none' ? '#87CEEB' : '#000000'" shadows :tone-mapping="THREE.ACESFilmicToneMapping" :tone-mapping-exposure="0.8" :renderer="{ logarithmicDepthBuffer: true }">
      <Suspense>
        <template #default>
          <TresGroup>
            <TresPerspectiveCamera
              :args="cameraArgs"
              :position="cameraPosition"
            />
            <CSMLight
              :light-direction="activeSunPreset.lightDirection"
              :cascades="4"
              :shadow-map-size="4096"
              :max-far="500"
              :light-intensity="activeSunPreset.lightIntensity"
              :ambient-intensity="activeSunPreset.ambientIntensity"
              :light-color="activeSunPreset.lightColor"
              :ambient-color="activeSunPreset.ambientColor"
              :shadow-bias="0.00025"
              :shadow-normal-bias="0.02"
              :light-margin="50"
            />

            <Environment :files="currentHdrFile" :background="true" :environment-intensity="activeSunPreset.environmentIntensity" />

            <TerrainMesh
              :terrain-data="mergedTerrainData"
              :quality="quality"
              :texture-type="textureType"
              :wireframe="showWireframe"
            />

            <OSMFeatures3D
              :terrain-data="terrainData"
              :feature-visibility="featureVisibility"
            />

            <SurroundingTerrain3D
              :terrain-data="terrainData"
              :visible="showSurroundings"
              quality="low"
            />

            <OrbitControls
              ref="controlsRef"
              make-default
              :min-distance="1"
              :max-distance="1000"
              :min-polar-angle="0"
              :max-polar-angle="Math.PI * 0.48"
              :enable-damping="true"
              :damping-factor="0.05"
            />
          </TresGroup>
        </template>
        <template #fallback>
          <TresGroup />
        </template>
      </Suspense>
    </TresCanvas>

    <!-- Toggle Tab -->
    <button
      @click="showSceneSettings = !showSceneSettings"
      :class="[
        'absolute top-4 z-40 bg-white/90 dark:bg-gray-800/90 backdrop-blur-md border border-gray-200 dark:border-gray-700 rounded-r-lg shadow-lg transition-all duration-300 ease-in-out hover:bg-gray-50 dark:hover:bg-gray-700 flex items-center gap-1.5 px-2 py-2',
        showSceneSettings ? 'left-64' : 'left-0'
      ]"
      :title="showSceneSettings ? 'Hide Scene Settings' : 'Show Scene Settings'"
    >
      <component :is="showSceneSettings ? ChevronLeft : ChevronRight" :size="14" class="text-[#FF6600]" />
      <span v-if="!showSceneSettings" class="text-xs font-medium text-gray-700 dark:text-gray-300 whitespace-nowrap">Scene Settings</span>
    </button>

    <!-- Scene Controls Slide-out Panel -->
    <div
      :class="[
        'absolute top-0 left-0 z-30 bg-white/90 dark:bg-gray-900/95 backdrop-blur-md border-r border-gray-200 dark:border-gray-700 p-4 w-64 shadow-2xl transition-transform duration-300 ease-in-out h-full overflow-y-auto',
        showSceneSettings ? 'translate-x-0' : '-translate-x-full'
      ]"
    >
      <div
        class="flex items-center gap-2 text-gray-900 dark:text-white mb-3 border-b border-gray-200 dark:border-gray-700 pb-2"
      >
        <Settings :size="16" class="text-[#FF6600]" />
        <span class="text-sm font-bold">Scene Settings</span>
      </div>

      <!-- Quality Selector -->
      <div class="mb-4 space-y-2">
        <label class="text-xs text-gray-500 dark:text-gray-400 flex items-center gap-1">
          <Gauge :size="12" /> Mesh Quality
        </label>
        <div class="flex bg-gray-100 dark:bg-gray-800 rounded-md p-1 border border-gray-200 dark:border-gray-700">
          <button
            v-for="q in ['low', 'medium', 'high']"
            :key="q"
            @click="quality = q"
            :class="[
              'flex-1 text-xs py-1.5 rounded capitalize transition-colors',
              quality === q
                ? 'bg-[#FF6600] text-white shadow-sm font-medium'
                : 'text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white hover:bg-white dark:hover:bg-gray-700',
            ]"
          >
            {{ q }}
          </button>
        </div>
        <p class="text-[10px] text-gray-400 dark:text-gray-500 text-right">
          {{
            quality === "low"
              ? "Low poly"
              : quality === "medium"
                ? "Balanced"
                : "Max Safe Detail"
          }}
        </p>
      </div>

      <!-- Environment Selector -->
      <div class="space-y-2 mb-4">
        <label class="text-xs text-gray-500 dark:text-gray-400 flex items-center gap-1">
          <Settings :size="12" /> Environment
        </label>
        <select
          v-model="preset"
          class="w-full appearance-none bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-gray-900 dark:text-white text-xs rounded py-2 px-3 focus:ring-1 focus:ring-[#FF6600] outline-none capitalize cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-700"
        >
          <option v-for="p in presets" :key="p" :value="p">{{ p }}</option>
        </select>
      </div>

      <div class="space-y-2 mb-4">
        <label class="text-xs text-gray-500 dark:text-gray-400 flex items-center gap-1">
          <Settings :size="12" /> Sun Positioning
        </label>
        <select
          v-model="sunPosition"
          class="w-full appearance-none bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-gray-900 dark:text-white text-xs rounded py-2 px-3 focus:ring-1 focus:ring-[#FF6600] outline-none cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-700"
        >
          <option v-for="s in sunPositionOptions" :key="s" :value="s">{{ s }}</option>
        </select>
      </div>

      <!-- Overlays -->
      <div class="space-y-2">
        <label class="text-xs text-gray-500 dark:text-gray-400 flex items-center gap-1">
          <Layers :size="12" /> Texture Mode
        </label>

        <div
          class="flex bg-gray-100 dark:bg-gray-800 rounded-md p-1 border border-gray-200 dark:border-gray-700 mb-2"
        >
          <button
            @click="textureType = 'satellite'"
            :class="[
              'flex-1 text-xs py-1.5 rounded transition-colors',
              textureType === 'satellite'
                ? 'bg-[#FF6600] text-white shadow-sm font-medium'
                : 'text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white hover:bg-white dark:hover:bg-gray-700',
            ]"
          >
            Satellite
          </button>
          <button
            @click="textureType = 'osm'"
            :disabled="!terrainData.osmTextureUrl"
            :title="
              !terrainData.osmTextureUrl
                ? 'No OSM data available'
                : 'Show OSM Layer'
            "
            :class="[
              'flex-1 text-xs py-1.5 rounded transition-colors',
              textureType === 'osm'
                ? 'bg-[#FF6600] text-white shadow-sm font-medium'
                : !terrainData.osmTextureUrl
                  ? 'text-gray-300 dark:text-gray-600 cursor-not-allowed'
                  : 'text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white hover:bg-white dark:hover:bg-gray-700',
            ]"
          >
            OSM
          </button>
          <button
            @click="textureType = 'hybrid'"
            :disabled="!terrainData.hybridTextureUrl"
            :title="
              !terrainData.hybridTextureUrl
                ? 'No Hybrid data available'
                : 'Show Hybrid Layer'
            "
            :class="[
              'flex-1 text-xs py-1.5 rounded transition-colors',
              textureType === 'hybrid'
                ? 'bg-[#FF6600] text-white shadow-sm font-medium'
                : !terrainData.hybridTextureUrl
                  ? 'text-gray-300 dark:text-gray-600 cursor-not-allowed'
                  : 'text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white hover:bg-white dark:hover:bg-gray-700',
            ]"
          >
            Hybrid
          </button>
          <button
            @click="textureType = 'none'"
            :class="[
              'flex-1 text-xs py-1.5 rounded transition-colors',
              textureType === 'none'
                ? 'bg-[#FF6600] text-white shadow-sm font-medium'
                : 'text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white hover:bg-white dark:hover:bg-gray-700',
            ]"
          >
            None
          </button>
        </div>

        <!-- Second row: Segmented modes -->
        <div
          class="flex bg-gray-100 dark:bg-gray-800 rounded-md p-1 border border-gray-200 dark:border-gray-700 mb-2"
        >
          <button
            @click="textureType = 'segmented'"
            :disabled="!mergedTerrainData.segmentedTextureUrl"
            :title="!mergedTerrainData.segmentedTextureUrl ? 'No segmented data available' : 'Segmented satellite (flat color blobs)'"
            :class="[
              'flex-1 text-xs py-1.5 rounded transition-colors',
              textureType === 'segmented'
                ? 'bg-[#FF6600] text-white shadow-sm font-medium'
                : !mergedTerrainData.segmentedTextureUrl
                  ? 'text-gray-300 dark:text-gray-600 cursor-not-allowed'
                  : 'text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white hover:bg-white dark:hover:bg-gray-700',
            ]"
          >
            Segmented
          </button>
          <button
            @click="textureType = 'segmentedHybrid'"
            :disabled="!mergedTerrainData.segmentedHybridTextureUrl"
            :title="!mergedTerrainData.segmentedHybridTextureUrl ? 'No segmented hybrid data available' : 'Segmented satellite + roads overlay'"
            :class="[
              'flex-1 text-xs py-1.5 rounded transition-colors',
              textureType === 'segmentedHybrid'
                ? 'bg-[#FF6600] text-white shadow-sm font-medium'
                : !mergedTerrainData.segmentedHybridTextureUrl
                  ? 'text-gray-300 dark:text-gray-600 cursor-not-allowed'
                  : 'text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white hover:bg-white dark:hover:bg-gray-700',
            ]"
          >
            Seg. Hybrid
          </button>
        </div>

        <!-- wireframe and 3D features -->
        <div class="space-y-3 pt-2">
          <label class="flex items-center gap-2 cursor-pointer group/check">
            <div class="relative">
              <input
                type="checkbox"
                v-model="showSurroundings"
                class="peer sr-only"
              />
              <div
                class="w-9 h-5 bg-gray-200 peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-[#FF6600]/20 rounded-full peer peer-checked:after:translate-x-full rtl:peer-checked:after:-translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:start-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-[#FF6600]"
              ></div>
            </div>
            <span class="text-xs text-gray-700 dark:text-gray-300 group-hover/check:text-gray-900 dark:group-hover/check:text-white"
              >Surrounding Terrain</span
            >
          </label>
          <p v-if="showSurroundings" class="text-[10px] text-gray-400 dark:text-gray-500 ml-11 -mt-1">Low-res adjacent tiles. May take a moment to load.</p>

          <label class="flex items-center gap-2 cursor-pointer group/check">
            <div class="relative">
              <input
                type="checkbox"
                v-model="showWireframe"
                class="peer sr-only"
              />
              <div
                class="w-9 h-5 bg-gray-200 peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-[#FF6600]/20 rounded-full peer peer-checked:after:translate-x-full rtl:peer-checked:after:-translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:start-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-[#FF6600]"
              ></div>
            </div>
            <span class="text-xs text-gray-700 dark:text-gray-300 group-hover/check:text-gray-900 dark:group-hover/check:text-white"
              >Wireframe Mode</span
            >
          </label>

          <div class="space-y-2">
            <label class="text-xs text-gray-500 dark:text-gray-400 flex items-center gap-1 font-medium mb-1">
              <Layers :size="12" /> 3D Features
            </label>
            <div class="grid grid-cols-2 gap-2">
              <label v-for="(val, key) in featureVisibility" :key="key" class="flex items-center gap-2 cursor-pointer group/check">
                <div class="relative">
                  <input
                    type="checkbox"
                    v-model="featureVisibility[key]"
                    class="peer sr-only"
                  />
                  <div
                    class="w-7 h-4 bg-gray-200 peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-[#FF6600]/20 rounded-full peer peer-checked:after:translate-x-full rtl:peer-checked:after:-translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:start-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-3 after:w-3 after:transition-all peer-checked:bg-[#FF6600]"
                  ></div>
                </div>
                <span class="text-[10px] capitalize text-gray-700 dark:text-gray-300 group-hover/check:text-gray-900 dark:group-hover/check:text-white font-medium select-none">
                  {{ key }}
                </span>
              </label>
            </div>
          </div>
        </div>

          <!-- OSM Background Color -->
          <div v-if="terrainData.osmFeatures && terrainData.osmFeatures.length > 0" class="space-y-2 pt-2 border-t border-gray-100 dark:border-gray-700">
            <label class="text-xs text-gray-500 dark:text-gray-400 flex items-center gap-1 font-medium mb-1">
              <Settings :size="12" /> OSM Background Color (for missing data)
            </label>
            <div class="flex flex-wrap gap-1.5 p-1.5 bg-gray-50 dark:bg-gray-800 rounded border border-gray-200 dark:border-gray-700">
              <button 
                v-for="color in baseColorOptions" 
                :key="color.value"
                @click="baseColor = color.value"
                :title="color.name"
                :class="[
                  'w-6 h-6 rounded-full border-2 transition-all shadow-sm',
                  baseColor === color.value ? 'border-[#FF6600] scale-110 shadow-md' : 'border-transparent hover:scale-105'
                ]"
                :style="{ backgroundColor: color.value }"
              ></button>
            </div>
          </div>

        <div class="pt-4 border-t border-gray-100 dark:border-gray-700">
          <button
            @click="resetCamera"
            class="w-full flex items-center justify-center gap-2 py-2 bg-gray-900 dark:bg-gray-700 hover:bg-black dark:hover:bg-gray-600 text-white text-xs font-bold rounded-md transition-colors shadow-lg shadow-black/10"
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
import { ref, computed, watch, reactive, shallowRef, toRaw } from "vue";
import * as THREE from "three";
import { TresCanvas } from "@tresjs/core";
import { OrbitControls, Environment } from "@tresjs/cientos";
import {
  Settings,
  Gauge,
  Layers,
  RotateCcw,
  ChevronLeft,
  ChevronRight,
} from "lucide-vue-next";
import TerrainMesh from "./TerrainMesh.vue";
import OSMFeatures3D from "./OSMFeatures3D.vue";
import CSMLight from "./CSMLight.vue";
import SurroundingTerrain3D from "./SurroundingTerrain3D.vue";
import {
  generateOSMTexture,
  generateHybridTexture,
} from "../services/osmTexture";

const props = defineProps(["terrainData"]);
const emit = defineEmits(["update-textures"]);

const controlsRef = ref(null);

const hdrPresets = {
  "Kloofendal Pure Sky": "kloofendal_48d_partly_cloudy_puresky_4k.hdr",
};

const SUN_PRESETS = {
  Morning: {
    lightDirection: [-1, -0.2, -0.35],
    lightIntensity: 2.0,
    ambientIntensity: 0.08,
    environmentIntensity: 0.03,
    lightColor: '#ffcd94',
    ambientColor: '#ffead1',
  },
  "Mid Morning": {
    lightDirection: [-1, -0.45, -0.55],
    lightIntensity: 2.8,
    ambientIntensity: 0.05,
    environmentIntensity: 0.025,
    lightColor: '#ffe6bf',
    ambientColor: '#fff5e6',
  },
  Noon: {
    lightDirection: [0, -1, -0.08],
    lightIntensity: 3.5,
    ambientIntensity: 0.03,
    environmentIntensity: 0.02,
    lightColor: '#ffffff',
    ambientColor: '#f5f9ff',
  },
  Afternoon: {
    lightDirection: [0.9, -0.45, -0.45],
    lightIntensity: 2.8,
    ambientIntensity: 0.05,
    environmentIntensity: 0.022,
    lightColor: '#ffe3bf',
    ambientColor: '#fff1e0',
  },
  Evening: {
    lightDirection: [0.9, -0.22, -0.25],
    lightIntensity: 1.8,
    ambientIntensity: 0.1,
    environmentIntensity: 0.02,
    lightColor: '#ff8c4a',
    ambientColor: '#ffc79c',
  },
  Night: {
    lightDirection: [0.25, -0.08, -0.12],
    lightIntensity: 0.16,
    ambientIntensity: 0.028,
    environmentIntensity: 0.006,
    lightColor: '#86a9ff',
    ambientColor: '#9cb8ff',
  },
};

const quality = ref("high");
const preset = ref("Kloofendal Pure Sky");
const sunPosition = ref("Noon");
const textureType = ref("osm");
const showWireframe = ref(false);
const showSurroundings = ref(false);
const showSceneSettings = ref(false);
const featureVisibility = reactive({
  buildings: true,
  vegetation: true,
  barriers: true,
});
const customOsmUrl = ref(null);
const customHybridUrl = ref(null);
const customOsmCanvas = ref(null);
const customHybridCanvas = ref(null);
const isRegenerating = ref(false);

const baseColor = ref('#999999');
const baseColorOptions = [
  { name: "Cement Grey (Default)", value: "#999999" },
  { name: "Forest Green", value: "#4a7a52" },
  { name: "Sandy Gold", value: "#ad8d60" },
  { name: "Rocky Grey", value: "#8a8a8a" },
  { name: "Dirt Brown", value: "#bfae96" },
  { name: "Deep Moss", value: "#4d5d4a" }
];

const regenerateTextures = async () => {
  if (!props.terrainData) return;
  isRegenerating.value = true;
  try {
    const options = { baseColor: baseColor.value };
    const osmResult = await generateOSMTexture(props.terrainData, options);
    const hybridResult = await generateHybridTexture(props.terrainData, options);
 
    customOsmUrl.value = osmResult.url;
    customHybridUrl.value = hybridResult.url;
    customOsmCanvas.value = osmResult.canvas;
    customHybridCanvas.value = hybridResult.canvas;
    
    emit("update-textures", {
      osmTextureUrl: osmResult.url,
      hybridTextureUrl: hybridResult.url,
      osmTextureCanvas: osmResult.canvas,
      hybridTextureCanvas: hybridResult.canvas,
    });
  } catch (e) {
    console.error("Failed to regenerate textures:", e);
  } finally {
    isRegenerating.value = false;
  }
};

// Re-render when baseColor changes
watch(baseColor, () => {
  regenerateTextures();
});

// Initialize textures automatically when terrain data is loaded
watch(
  () => props.terrainData?.osmFeatures,
  async (newFeatures) => {
    if (newFeatures) {
      // If terrain.js already generated textures with canvas, use them
      // directly instead of re-rendering (avoids duplicate 16k render)
      const td = props.terrainData;
      if (td?.osmTextureCanvas && td?.osmTextureUrl) {
        customOsmUrl.value = td.osmTextureUrl;
        customOsmCanvas.value = td.osmTextureCanvas;
        customHybridUrl.value = td.hybridTextureUrl || null;
        customHybridCanvas.value = td.hybridTextureCanvas || null;
      } else {
        await regenerateTextures();
      }
    }
  },
  { immediate: true },
);

// Override prop data for rendering
const activeOsmTexture = computed(
  () => customOsmUrl.value || props.terrainData?.osmTextureUrl,
);
const activeHybridTexture = computed(
  () => customHybridUrl.value || props.terrainData?.hybridTextureUrl,
);

const mergedTerrainData = computed(() => {
  return {
    ...props.terrainData,
    osmTextureUrl: activeOsmTexture.value,
    hybridTextureUrl: activeHybridTexture.value,
    osmTextureCanvas: customOsmCanvas.value || props.terrainData?.osmTextureCanvas,
    hybridTextureCanvas: customHybridCanvas.value || props.terrainData?.hybridTextureCanvas,
    satelliteTextureUrl: props.terrainData?.satelliteTextureUrl,
    segmentedTextureUrl: props.terrainData?.segmentedTextureUrl,
    segmentedTextureCanvas: props.terrainData?.segmentedTextureCanvas,
    segmentedHybridTextureUrl: props.terrainData?.segmentedHybridTextureUrl,
    segmentedHybridTextureCanvas: props.terrainData?.segmentedHybridTextureCanvas,
  };
});

const presets = Object.keys(hdrPresets);
const sunPositionOptions = Object.keys(SUN_PRESETS);
const currentHdrFile = computed(() => `/hdr/${hdrPresets[preset.value]}`);
const activeSunPreset = computed(() => SUN_PRESETS[sunPosition.value] || SUN_PRESETS.Noon);

const resetCamera = () => {
  if (controlsRef.value) {
    const controls = controlsRef.value.instance || controlsRef.value;
    // For OrbitControls, we update the camera position and the controls target
    // and then call update() if damping is enabled
    const camera = controls.object;
    if (camera) {
      camera.position.set(0, 80, 100);
      controls.target.set(0, 0, 0);
      controls.update();
    }
  }
};

// Static camera config to prevent re-renders resetting position
const cameraPosition = [0, 60, 90];
const cameraArgs = [50, 1, 0.5, 5000];
</script>
