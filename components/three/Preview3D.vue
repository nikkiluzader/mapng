<template>
  <div class="w-full h-full bg-black relative overflow-hidden">

    <!-- WebGL unavailable fallback (static check or runtime failure) -->
    <div v-if="!webGLAvailable || webGLRuntimeError" class="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-gray-900 text-center px-6">
      <svg xmlns="http://www.w3.org/2000/svg" class="w-10 h-10 text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M9.75 9.75l4.5 4.5m0-4.5l-4.5 4.5M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
      <p class="text-sm font-semibold text-gray-300">3D preview unavailable</p>
      <p class="text-xs text-gray-500 max-w-xs">Your browser could not create a WebGL context. Try enabling GPU acceleration or opening the app in a different browser.</p>
    </div>

    <!-- dpr caps rendering at 2x device pixels: on 3-4x mobile/hiDPI screens the
         uncapped default more than doubles fragment work for no visible gain. -->
    <TresCanvas v-else-if="!webGLRuntimeError" window-size :dpr="[1, 2]" :clear-color="textureType === 'none' ? '#87CEEB' : '#000000'" shadows :tone-mapping="THREE.ACESFilmicToneMapping" :tone-mapping-exposure="0.8" :renderer="{ logarithmicDepthBuffer: true }">
      <Suspense>
        <template #default>
          <TresGroup>
            <TresPerspectiveCamera
              :args="cameraArgs"
              :position="cameraPosition"
            />
            <!-- 2048 per cascade: 4×4096² depth maps cost ~256 MB of GPU memory
                 plus four full-res shadow passes per frame — far beyond what a
                 100-unit preview scene needs. -->
            <CSMLight
              :light-direction="activeSunPreset.lightDirection"
              :cascades="4"
              :shadow-map-size="2048"
              :max-far="500"
              :light-intensity="activeSunPreset.lightIntensity"
              :ambient-intensity="activeSunPreset.ambientIntensity"
              :light-color="activeSunPreset.lightColor"
              :ambient-color="activeSunPreset.ambientColor"
              :shadow-bias="0.00045"
              :shadow-normal-bias="0.035"
              :light-margin="50"
            />

            <Environment :files="currentHdrFile" :background="true" :environment-intensity="activeSunPreset.environmentIntensity" />

            <TerrainMesh
              :terrain-data="mergedTerrainData"
              :quality="meshQuality"
              :texture-type="textureType"
              :show-water="showWater"
              :water-level-offset-meters="waterLevelOffsetMeters"
              :wireframe="advancedMode && showWireframe"
            />

            <MapngFlag3D
              :terrain-data="mergedTerrainData"
            />

            <OSMFeatures3D
              :terrain-data="terrainData"
              :feature-visibility="featureVisibility"
            />

            <SurroundingTerrain3D
              v-if="advancedMode"
              :terrain-data="terrainData"
              :visible="showSurroundings"
              :quality="surroundingQuality"
              :texture-mode="surroundingTextureType"
              @loading-state="handleSurroundingsLoadingState"
            />

            <OrbitControls
              ref="controlsRef"
              make-default
              :min-distance="0.1"
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
      :title="showSceneSettings ? t('preview.hideSettings') : t('preview.showSettings')"
    >
      <component :is="showSceneSettings ? ChevronLeft : ChevronRight" :size="14" class="text-[#FF6600]" />
      <span v-if="!showSceneSettings" class="text-xs font-medium text-gray-700 dark:text-gray-300 whitespace-nowrap">{{ t('preview.sceneSettings') }}</span>
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
        <span class="text-sm font-bold">{{ t('preview.sceneSettings') }}</span>
      </div>

      <!-- Environment Selector -->
      <div class="space-y-2 mb-4">
        <label class="text-xs text-gray-500 dark:text-gray-400 flex items-center gap-1">
          <Settings :size="12" /> {{ t('preview.environment') }}
        </label>
        <select
          v-model="preset"
          :class="[SELECT_SM, 'appearance-none capitalize hover:bg-gray-50 dark:hover:bg-gray-700']"
        >
          <option v-for="p in presets" :key="p" :value="p">{{ p }}</option>
        </select>
      </div>

      <div class="space-y-2 mb-4">
        <label class="text-xs text-gray-500 dark:text-gray-400 flex items-center gap-1">
          <Settings :size="12" /> {{ t('preview.sunPositioning') }}
        </label>
        <select
          v-model="sunPosition"
          :class="[SELECT_SM, 'appearance-none hover:bg-gray-50 dark:hover:bg-gray-700']"
        >
          <option v-for="s in sunPositionOptions" :key="s" :value="s">{{ s }}</option>
        </select>
      </div>

      <!-- Terrain Mesh Quality -->
      <div class="space-y-2 mb-4">
        <label class="text-xs text-gray-500 dark:text-gray-400 flex items-center gap-1">
          <Layers :size="12" /> {{ t('preview.meshQuality') }}
        </label>
        <select
          v-model="meshQuality"
          :class="[SELECT_SM, 'appearance-none hover:bg-gray-50 dark:hover:bg-gray-700']"
        >
          <option v-for="q in meshQualityOptions" :key="q.value" :value="q.value">{{ t(q.labelKey) }}</option>
        </select>
        <p v-if="meshQuality === 'full'" class="text-[10px] text-gray-400 dark:text-gray-500">
          {{ t('preview.qualityFullHint') }}
        </p>
      </div>

      <!-- Overlays -->
      <div class="space-y-2">
        <label class="text-xs text-gray-500 dark:text-gray-400 flex items-center gap-1">
          <Layers :size="12" /> {{ t('preview.textureMode') }}
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
            {{ t('preview.satellite') }}
          </button>
          <button
            @click="textureType = 'osm'"
            :disabled="!terrainData.osmTextureUrl"
            :title="
              !terrainData.osmTextureUrl
                ? t('preview.noOsmData')
                : t('preview.showOsmLayer')
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
            {{ t('preview.osm') }}
          </button>
          <button
            @click="textureType = 'hybrid'"
            :disabled="!terrainData.hybridTextureUrl"
            :title="
              !terrainData.hybridTextureUrl
                ? t('preview.noHybridData')
                : t('preview.showHybridLayer')
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
            {{ t('preview.hybrid') }}
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
            {{ t('preview.none') }}
          </button>
        </div>

        <!-- wireframe and 3D features -->
        <div class="space-y-3 pt-2">
          <!-- Surroundings + wireframe: advanced mode -->
          <template v-if="advancedMode">
          <div>
            <label class="text-[10px] text-gray-400 dark:text-gray-500 block mb-1">{{ t('preview.surroundingsTexture') }}</label>
            <select
              v-model="surroundingTextureType"
              :class="[SELECT_XS, 'w-full max-w-[140px] appearance-none hover:bg-gray-50 dark:hover:bg-gray-700']"
            >
              <option value="satellite">{{ t('preview.satellite') }}</option>
              <option value="none">{{ t('preview.none') }}</option>
            </select>
          </div>

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
              >{{ t('preview.surroundingTerrain') }}</span
            >
          </label>
          <p v-if="showSurroundings" class="text-[10px] text-gray-400 dark:text-gray-500 ml-11 -mt-1">{{ t('preview.surroundingDesc') }}</p>
          <p
            v-if="showSurroundings && surroundingTextureType === 'satellite' && isSurroundingsLoading"
            class="text-[10px] text-gray-400 dark:text-gray-500 ml-11 -mt-1"
          >
            {{ surroundingsSatelliteProgress.completed }} of {{ surroundingsSatelliteProgress.total }} satellite images downloaded
          </p>

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
              >{{ t('preview.wireframeMode') }}</span
            >
          </label>
          </template>

          <div class="space-y-2">
            <label class="text-xs text-gray-500 dark:text-gray-400 flex items-center gap-1 font-medium mb-1">
              <Layers :size="12" /> {{ t('preview.features3d') }}
            </label>
            <div class="grid grid-cols-2 gap-2">
              <label class="flex items-center gap-2 cursor-pointer group/check">
                <div class="relative">
                  <input
                    type="checkbox"
                    v-model="showWater"
                    class="peer sr-only"
                  />
                  <div
                    class="w-7 h-4 bg-gray-200 peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-[#FF6600]/20 rounded-full peer peer-checked:after:translate-x-full rtl:peer-checked:after:-translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:start-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-3 after:w-3 after:transition-all peer-checked:bg-[#FF6600]"
                  ></div>
                </div>
                <span class="text-[10px] capitalize text-gray-700 dark:text-gray-300 group-hover/check:text-gray-900 dark:group-hover/check:text-white font-medium select-none">
                  {{ t('preview.water') }}
                </span>
              </label>
              <div class="col-span-2 flex items-center justify-between gap-2 px-0.5">
                <span class="text-[10px] text-gray-500 dark:text-gray-400 shrink-0">{{ t('preview.seaLevelOffset') }}</span>
                <div class="flex items-center gap-1">
                  <input
                    v-model.number="waterLevelOffsetMeters"
                    type="number"
                    step="1"
                    min="-2000"
                    max="2000"
                    :disabled="!showWater"
                    class="w-20 text-[9px] bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded px-1.5 py-0.5 text-gray-600 dark:text-gray-300 disabled:opacity-60"
                  />
                  <span class="text-[9px] text-gray-500 dark:text-gray-400">m</span>
                </div>
              </div>
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

        <div class="pt-4 border-t border-gray-100 dark:border-gray-700">
          <button
            @click="resetCamera"
            class="w-full flex items-center justify-center gap-2 py-2 bg-gray-900 dark:bg-gray-700 hover:bg-black dark:hover:bg-gray-600 text-white text-xs font-bold rounded-md transition-colors shadow-lg shadow-black/10"
          >
            <RotateCcw :size="14" />
            {{ t('preview.resetCamera') }}
          </button>
        </div>
      </div>
    </div>

  </div>
</template>

<script setup>
import { ref, computed, reactive, watch, onErrorCaptured } from "vue";
import { useI18n } from 'vue-i18n';
import * as THREE from "three";
import { TresCanvas } from "@tresjs/core";
import { OrbitControls, Environment } from "@tresjs/cientos";
import {
  Settings,
  Layers,
  RotateCcw,
  ChevronLeft,
  ChevronRight,
} from "lucide-vue-next";

const { t } = useI18n({ useScope: 'global' });
import TerrainMesh from "./TerrainMesh.vue";
import MapngFlag3D from "./MapngFlag3D.vue";
import OSMFeatures3D from "./OSMFeatures3D.vue";
import CSMLight from "./CSMLight.vue";
import SurroundingTerrain3D from "./SurroundingTerrain3D.vue";
import { useMainStore } from "../../stores/mainStore";
import { SELECT_SM, SELECT_XS } from "../base/controlStyles.js";

const props = defineProps(["terrainData"]);
const store = useMainStore();
const advancedMode = computed(() => store.advancedMode);

const controlsRef = ref(null);

const webGLAvailable = (() => {
  try {
    const canvas = document.createElement("canvas");
    return !!(
      window.WebGLRenderingContext &&
      (canvas.getContext("webgl") || canvas.getContext("experimental-webgl"))
    );
  } catch {
    return false;
  }
})();

// Catches runtime WebGL context failures from TresCanvas (e.g. GPU memory exhausted
// at extreme resolutions). The static webGLAvailable check passes because it tests
// with a tiny canvas, but TresCanvas can still fail on the full scene context.
const webGLRuntimeError = ref(false);
onErrorCaptured((err) => {
  const msg = err?.message ?? String(err);
  if (msg.toLowerCase().includes('webgl') || msg.toLowerCase().includes('context')) {
    console.warn('[Preview3D] WebGL runtime error caught:', msg);
    webGLRuntimeError.value = true;
    return false; // stop propagation
  }
});

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

// 'full' renders the native heightmap grid (capped at 2048 mesh; the
// full-resolution normal map carries detail beyond that) — heavier on GPU/RAM,
// so it is opt-in and not persisted.
const meshQuality = ref('medium');
const meshQualityOptions = [
  { value: 'medium', labelKey: 'preview.qualityBalanced' },
  { value: 'high', labelKey: 'preview.qualityMaxSafe' },
  { value: 'full', labelKey: 'preview.qualityFull' },
];
// SurroundingTerrain3D has its own low/medium/high fetch profiles; 'full'
// center-tile detail doesn't warrant re-downloading surrounding tiles.
const surroundingQuality = computed(() => (meshQuality.value === 'full' ? 'high' : meshQuality.value));
const preset = ref("Kloofendal Pure Sky");
const sunPosition = ref("Mid Morning");
const textureType = ref("hybrid");
const surroundingTextureType = ref("none");
const showWireframe = ref(false);
const showWater = ref(true);
const waterLevelOffsetMeters = ref(0);
const showSurroundings = ref(false);
const showSceneSettings = ref(false);
const isSurroundingsLoading = ref(false);
const surroundingsSatelliteProgress = reactive({
  completed: 0,
  total: 0,
});
const featureVisibility = reactive({
  buildings: true,
  vegetation: true,
  barriers: true,
});

const handleSurroundingsLoadingState = (state) => {
  isSurroundingsLoading.value = !!state?.isLoading;

  if (state?.textureMode !== 'satellite') {
    surroundingsSatelliteProgress.completed = 0;
    surroundingsSatelliteProgress.total = 0;
    return;
  }

  surroundingsSatelliteProgress.completed = Number(state?.completedSatellite || 0);
  surroundingsSatelliteProgress.total = Number(state?.totalSatellite || 0);
};

const mergedTerrainData = computed(() => {
  return props.terrainData;
});

// Flat terrain sits at height 0, so default the water plane just below ground
// (−1 m) instead of at 0 where it would flood the entire level.
watch(() => props.terrainData?.flat, (flat) => {
  if (flat) waterLevelOffsetMeters.value = -1;
}, { immediate: true });

const presets = Object.keys(hdrPresets);
const sunPositionOptions = Object.keys(SUN_PRESETS);
const currentHdrFile = computed(() => `/hdr/${hdrPresets[preset.value]}`);
const activeSunPreset = computed(() => SUN_PRESETS[sunPosition.value] || SUN_PRESETS.Noon);

// Blender-style "infinite zoom": stock OrbitControls dollies a fraction of the
// remaining distance to a FIXED target each scroll, so zoom asymptotes and, on
// large maps, stalls long before you reach terrain away from the map center.
// zoomToCursor dollies along the cursor ray and slides the orbit target with
// the camera, so every scroll step stays useful and you can keep zooming
// through the scene. The cientos wrapper doesn't expose this as a prop, so set
// it on the underlying three.js controls instance once it mounts.
//
// screenSpacePanning must be OFF with zoomToCursor: screen-space panning moves
// the orbit target in the camera plane, leaving it floating mid-air after a
// pan; cursor zoom then collapses the camera→target radius to minDistance
// while still far above the terrain, freezing both zoom and pan (pan speed is
// proportional to the radius). With it off, panning slides the target along
// the horizontal ground plane and cursor zoom re-anchors it by ray-plane
// intersection (MapControls behavior), so the radius always tracks real
// geometry.
watch(controlsRef, (ctrl) => {
  const controls = ctrl?.instance || ctrl;
  if (controls && 'zoomToCursor' in controls) {
    controls.zoomToCursor = true;
    controls.screenSpacePanning = false;
  }
}, { immediate: true });

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
