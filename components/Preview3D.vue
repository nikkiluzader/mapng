<template>
  <div class="w-full h-full bg-black relative group">
    <TresCanvas window-size clear-color="#000000" shadows>
      <Suspense>
        <template #default>
          <TresGroup>
            <TresPerspectiveCamera
              :args="cameraArgs"
              :position="cameraPosition"
            />
            <TresAmbientLight :intensity="0.2" />
            <TresDirectionalLight
              :position="[50, 80, 50]"
              :intensity="2.0"
              cast-shadow
              :shadow-mapSize-width="2048"
              :shadow-mapSize-height="2048"
              :shadow-camera-left="-100"
              :shadow-camera-right="100"
              :shadow-camera-top="100"
              :shadow-camera-bottom="-100"
              :shadow-camera-near="0.1"
              :shadow-camera-far="500"
              :shadow-bias="-0.002"
            />

            <Environment :files="currentHdrFile" :background="true" />

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

    <!-- Scene Controls Overlay -->
    <div
      class="absolute top-4 left-4 z-30 bg-white/90 backdrop-blur-md border border-gray-200 rounded-lg p-4 w-64 shadow-2xl transition-opacity opacity-0 group-hover:opacity-100"
    >
      <div
        class="flex items-center gap-2 text-gray-900 mb-3 border-b border-gray-200 pb-2"
      >
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
            :class="[
              'flex-1 text-xs py-1.5 rounded capitalize transition-colors',
              quality === q
                ? 'bg-[#FF6600] text-white shadow-sm font-medium'
                : 'text-gray-500 hover:text-gray-900 hover:bg-white',
            ]"
          >
            {{ q }}
          </button>
        </div>
        <p class="text-[10px] text-gray-400 text-right">
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

        <div
          class="flex bg-gray-100 rounded-md p-1 border border-gray-200 mb-2"
        >
          <button
            @click="textureType = 'satellite'"
            :class="[
              'flex-1 text-xs py-1.5 rounded transition-colors',
              textureType === 'satellite'
                ? 'bg-[#FF6600] text-white shadow-sm font-medium'
                : 'text-gray-500 hover:text-gray-900 hover:bg-white',
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
                  ? 'text-gray-300 cursor-not-allowed'
                  : 'text-gray-500 hover:text-gray-900 hover:bg-white',
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
                  ? 'text-gray-300 cursor-not-allowed'
                  : 'text-gray-500 hover:text-gray-900 hover:bg-white',
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
                : 'text-gray-500 hover:text-gray-900 hover:bg-white',
            ]"
          >
            None
          </button>
        </div>

        <!-- wireframe and 3D features -->
        <div class="space-y-3 pt-2">
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
            <span class="text-xs text-gray-700 group-hover/check:text-gray-900"
              >Wireframe Mode</span
            >
          </label>

          <div class="space-y-2">
            <label class="text-xs text-gray-500 flex items-center gap-1 font-medium mb-1">
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
                <span class="text-[10px] capitalize text-gray-700 group-hover/check:text-gray-900 font-medium select-none">
                  {{ key }}
                </span>
              </label>
            </div>
          </div>
        </div>

          <!-- OSM Background Color -->
          <div v-if="terrainData.osmFeatures && terrainData.osmFeatures.length > 0" class="space-y-2 pt-2 border-t border-gray-100">
            <label class="text-xs text-gray-500 flex items-center gap-1 font-medium mb-1">
              <Settings :size="12" /> OSM Background Color
            </label>
            <div class="flex flex-wrap gap-1.5 p-1.5 bg-gray-50 rounded border border-gray-200">
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
import { ref, computed, watch, reactive, shallowRef, toRaw } from "vue";
import { TresCanvas } from "@tresjs/core";
import { OrbitControls, Environment } from "@tresjs/cientos";
import {
  Settings,
  Gauge,
  Layers,
  RotateCcw,
} from "lucide-vue-next";
import TerrainMesh from "./TerrainMesh.vue";
import OSMFeatures3D from "./OSMFeatures3D.vue";
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

const quality = ref("high");
const preset = ref("Kloofendal Pure Sky");
const textureType = ref("osm");
const showWireframe = ref(false);
const featureVisibility = reactive({
  buildings: true,
  water: false,
  vegetation: true,
  barriers: true,
});
const customOsmUrl = ref(null);
const customHybridUrl = ref(null);
const isRegenerating = ref(false);

const baseColor = ref('#f2f2f2');
const baseColorOptions = [
  { name: "Off White (Default)", value: "#f2f2f2" },
  { name: "Forest Green", value: "#4a7a52" },
  { name: "Sandy Gold", value: "#e0d3b0" },
  { name: "Rocky Grey", value: "#8a8a8a" },
  { name: "Dirt Brown", value: "#bfae96" },
  { name: "Deep Moss", value: "#4d5d4a" }
];

const regenerateTextures = async () => {
  if (!props.terrainData) return;
  isRegenerating.value = true;
  try {
    const options = { baseColor: baseColor.value };
    const osmUrl = await generateOSMTexture(props.terrainData, options);
    const hybridUrl = await generateHybridTexture(props.terrainData, options);
 
    customOsmUrl.value = osmUrl;
    customHybridUrl.value = hybridUrl;
    
    emit("update-textures", {
      osmTextureUrl: osmUrl,
      hybridTextureUrl: hybridUrl,
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

// Initialize textures automatically
watch(
  () => props.terrainData?.osmFeatures,
  async (newFeatures) => {
    if (newFeatures) {
      await regenerateTextures();
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
    satelliteTextureUrl: props.terrainData?.satelliteTextureUrl,
  };
});

const presets = Object.keys(hdrPresets);
const currentHdrFile = computed(() => `/hdr/${hdrPresets[preset.value]}`);

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
const cameraArgs = [50, 1, 0.1, 50000];
</script>
