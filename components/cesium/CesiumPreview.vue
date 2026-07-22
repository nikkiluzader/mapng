<template>
  <section
    data-testid="cesium-preview"
    class="relative h-full w-full overflow-hidden bg-[#08131f]"
    aria-label="Cesium Preview"
  >
    <div ref="container" class="h-full w-full" :class="{ invisible: errorMessage }"></div>

    <aside
      v-if="!isLoading && !errorMessage"
      data-testid="cesium-layer-control"
      class="absolute left-4 top-4 z-10 max-h-[calc(100%-2rem)] w-64 overflow-y-auto rounded-xl border border-white/15 bg-slate-950/85 text-white shadow-2xl backdrop-blur"
    >
      <div class="flex items-center gap-2 border-b border-white/10 px-3 py-2.5 text-xs font-bold uppercase tracking-wide">
        <Layers :size="15" class="text-[#FF6600]" />
        {{ t('view.cesiumLayers') }}
      </div>

      <div class="space-y-1 p-2 text-xs">
        <label class="cesium-layer-row">
          <input
            v-model="layerState.terrain"
            data-testid="cesium-layer-terrain"
            type="checkbox"
            class="accent-[#FF6600]"
          />
          <span>{{ t('view.cesiumTerrain') }}</span>
        </label>
        <label class="cesium-layer-row">
          <input
            v-model="layerState.imagery"
            data-testid="cesium-layer-imagery"
            type="checkbox"
            class="accent-[#FF6600]"
          />
          <span>{{ t('view.cesiumImagery') }}</span>
        </label>
        <label class="cesium-layer-row">
          <input
            v-model="layerState.projectBounds"
            data-testid="cesium-layer-bounds"
            type="checkbox"
            class="accent-[#FF6600]"
          />
          <span>{{ t('view.cesiumProjectBounds') }}</span>
        </label>
        <label class="cesium-layer-row">
          <input
            v-model="layerState.projectCenter"
            data-testid="cesium-layer-center"
            type="checkbox"
            class="accent-[#FF6600]"
          />
          <span>{{ t('view.cesiumProjectCenter') }}</span>
        </label>
        <label
          class="cesium-layer-row"
          :class="{ 'cursor-not-allowed opacity-50': !osmRoadCount || osmLayerLoading }"
        >
          <input
            v-model="layerState.osmCenterlines"
            data-testid="cesium-layer-osm-roads"
            type="checkbox"
            class="accent-[#FF6600]"
            :disabled="!osmRoadCount || osmLayerLoading"
          />
          <span>{{ t('view.cesiumOsmCenterlines') }}</span>
          <span v-if="osmRoadCount" class="ml-auto tabular-nums text-slate-400">{{ osmRoadCount }}</span>
        </label>
        <p
          v-if="osmLayerLoading"
          data-testid="cesium-osm-status"
          class="px-2 py-1 text-[11px] text-sky-300"
        >
          {{ t('view.cesiumOsmLoading') }}
        </p>
        <p
          v-else-if="osmLayerError"
          data-testid="cesium-osm-status"
          class="px-2 py-1 text-[11px] text-rose-300"
        >
          {{ t('view.cesiumOsmLayerFailed') }}
        </p>
        <p
          v-else-if="!osmRoadCount"
          data-testid="cesium-osm-status"
          class="px-2 py-1 text-[11px] text-slate-400"
        >
          {{ t('view.cesiumOsmUnavailable') }}
        </p>
        <label
          class="cesium-layer-row"
          :class="{ 'cursor-not-allowed opacity-50': !osmBuildingCount || buildingLayerLoading }"
        >
          <input
            v-model="layerState.buildings"
            data-testid="cesium-layer-buildings"
            type="checkbox"
            class="accent-[#FF6600]"
            :disabled="!osmBuildingCount || buildingLayerLoading"
          />
          <span>{{ t('view.cesiumBuildings') }}</span>
          <span v-if="osmBuildingCount" class="ml-auto tabular-nums text-slate-400">{{ osmBuildingCount }}</span>
        </label>
        <p
          v-if="buildingLayerLoading"
          data-testid="cesium-buildings-status"
          class="px-2 py-1 text-[11px] text-sky-300"
        >
          {{ t('view.cesiumBuildingsLoading') }}
        </p>
        <p
          v-else-if="buildingLayerError"
          data-testid="cesium-buildings-status"
          class="px-2 py-1 text-[11px] text-rose-300"
        >
          {{ t('view.cesiumBuildingsFailed') }}
        </p>
        <p
          v-else-if="!osmBuildingCount"
          data-testid="cesium-buildings-status"
          class="px-2 py-1 text-[11px] text-slate-400"
        >
          {{ t('view.cesiumBuildingsUnavailable') }}
        </p>
        <p
          v-else-if="estimatedBuildingCount"
          data-testid="cesium-buildings-estimated"
          class="px-2 py-1 text-[11px] text-amber-300"
        >
          {{ t('view.cesiumBuildingsEstimated', { count: estimatedBuildingCount }) }}
        </p>
        <label
          class="cesium-layer-row"
          :class="{ 'cursor-not-allowed opacity-50': !roadWidthCount || roadWidthLayerLoading }"
        >
          <input
            v-model="layerState.roadWidths"
            data-testid="cesium-layer-road-widths"
            type="checkbox"
            class="accent-[#FF6600]"
            :disabled="!roadWidthCount || roadWidthLayerLoading"
          />
          <span>{{ t('view.cesiumRoadWidths') }}</span>
          <span v-if="roadWidthCount" class="ml-auto tabular-nums text-slate-400">{{ roadWidthCount }}</span>
        </label>
        <p
          v-if="roadWidthLayerLoading"
          data-testid="cesium-road-widths-status"
          class="px-2 py-1 text-[11px] text-sky-300"
        >
          {{ t('view.cesiumRoadWidthsLoading') }}
        </p>
        <p
          v-else-if="roadWidthLayerError"
          data-testid="cesium-road-widths-status"
          class="px-2 py-1 text-[11px] text-rose-300"
        >
          {{ t('view.cesiumRoadWidthsFailed') }}
        </p>
        <p
          v-else-if="estimatedRoadWidthCount"
          data-testid="cesium-road-widths-estimated"
          class="px-2 py-1 text-[11px] text-amber-300"
        >
          {{ t('view.cesiumRoadWidthsEstimated', { count: estimatedRoadWidthCount }) }}
        </p>
        <label
          class="cesium-layer-row"
          :class="{ 'cursor-not-allowed opacity-50': !junctionCount || junctionLayerLoading }"
        >
          <input
            v-model="layerState.junctions"
            data-testid="cesium-layer-junctions"
            type="checkbox"
            class="accent-[#FF6600]"
            :disabled="!junctionCount || junctionLayerLoading"
          />
          <span>{{ t('view.cesiumJunctions') }}</span>
          <span v-if="junctionCount" class="ml-auto tabular-nums text-slate-400">{{ junctionCount }}</span>
        </label>
        <p
          v-if="junctionLayerLoading"
          data-testid="cesium-junctions-status"
          class="px-2 py-1 text-[11px] text-sky-300"
        >
          {{ t('view.cesiumJunctionsLoading') }}
        </p>
        <p
          v-else-if="junctionLayerError"
          data-testid="cesium-junctions-status"
          class="px-2 py-1 text-[11px] text-rose-300"
        >
          {{ t('view.cesiumJunctionsFailed') }}
        </p>
        <p
          v-else-if="junctionCount"
          data-testid="cesium-junctions-derived"
          class="px-2 py-1 text-[11px] text-slate-400"
        >
          {{ t('view.cesiumJunctionsDerived') }}
        </p>

        <div v-if="COMPILER_PREVIEW_ENABLED" class="mt-2 border-t border-white/10 pt-2">
          <p class="px-2 pb-1 text-[11px] font-semibold uppercase tracking-wide text-cyan-300">
            {{ t('view.cesiumCompilerResult') }}
          </p>
          <p v-if="compilerIsWorking && !compilerSurfaceCount" class="px-2 pb-1 text-[11px] text-cyan-300">
            {{ t('view.cesiumCompilerAutomaticWorking') }}
          </p>
          <p v-else-if="compilerError && !compilerSurfaceCount" class="px-2 pb-1 text-[11px] text-rose-300">
            {{ t('view.cesiumCompilerAutomaticFailed') }}
          </p>
          <div class="flex gap-1 px-1">
            <input
              v-model="compilerJobInput"
              data-testid="cesium-compiler-job-input"
              type="text"
              spellcheck="false"
              class="min-w-0 flex-1 rounded-md border border-white/15 bg-slate-900 px-2 py-1.5 text-[11px] text-white outline-none focus:border-cyan-400"
              :placeholder="t('view.cesiumCompilerJobPlaceholder')"
              @keyup.enter="loadCompilerPreview"
            />
            <button
              data-testid="cesium-compiler-load"
              type="button"
              class="rounded-md bg-cyan-500/20 px-2 py-1.5 font-semibold text-cyan-200 hover:bg-cyan-500/30 disabled:cursor-not-allowed disabled:opacity-50"
              :disabled="compilerLayerLoading"
              @click="loadCompilerPreview"
            >
              {{ t('view.cesiumCompilerLoad') }}
            </button>
          </div>
          <label
            class="cesium-layer-row mt-1"
            :class="{ 'cursor-not-allowed opacity-50': !compilerSurfaceCount || compilerLayerLoading }"
          >
            <input
              v-model="layerState.compilerSurfaces"
              data-testid="cesium-layer-compiler-surfaces"
              type="checkbox"
              class="accent-cyan-400"
              :disabled="!compilerSurfaceCount || compilerLayerLoading"
            />
            <span>{{ t('view.cesiumCompilerSurfaces') }}</span>
            <span v-if="compilerSurfaceCount" class="ml-auto tabular-nums text-slate-400">{{ compilerSurfaceCount }}</span>
          </label>
          <p v-if="compilerLayerLoading" class="px-2 py-1 text-[11px] text-cyan-300">
            {{ t('view.cesiumCompilerLoading') }}
          </p>
          <p v-else-if="compilerLayerError && !compilerError" class="px-2 py-1 text-[11px] text-rose-300">
            {{ t('view.cesiumCompilerFailed') }}
          </p>
          <p v-else-if="compilerSurfaceCount" class="px-2 py-1 text-[11px] text-emerald-300">
            {{ t('view.cesiumCompilerLoaded', { count: compilerSurfaceCount }) }}
          </p>
          <p v-else class="px-2 py-1 text-[11px] text-slate-400">
            {{ t('view.cesiumCompilerUnavailable') }}
          </p>
        </div>
      </div>

      <div class="border-t border-white/10 p-2 text-xs">
        <button
          data-testid="cesium-reset-camera"
          type="button"
          class="mb-2 flex w-full items-center justify-center gap-2 rounded-lg bg-white/10 px-3 py-2 font-semibold text-white transition-colors hover:bg-white/15"
          @click="resetCesiumCamera"
        >
          <RotateCcw :size="15" />
          {{ t('preview.resetCamera') }}
        </button>
        <p v-if="!fpvMode" class="mb-2 px-1 text-[11px] leading-relaxed text-slate-400">
          {{ t('view.cesiumOrbitHint') }}
        </p>
        <button
          data-testid="cesium-fpv-toggle"
          type="button"
          class="flex w-full items-center justify-center gap-2 rounded-lg px-3 py-2 font-semibold transition-colors"
          :class="fpvMode ? 'bg-[#FF6600] text-white hover:bg-[#E65C00]' : 'bg-white/10 text-white hover:bg-white/15'"
          @click="toggleFpvMode"
        >
          <Crosshair :size="15" />
          {{ fpvMode ? t('view.cesiumFpvExit') : t('view.cesiumFpvEnter') }}
        </button>
        <p class="mt-2 px-1 text-[11px] leading-relaxed" :class="fpvMode ? 'text-emerald-300' : 'text-slate-400'">
          {{ fpvMode
            ? (fpvPointerLocked ? t('view.cesiumFpvActive') : t('view.cesiumFpvClickToCapture'))
            : t('view.cesiumFpvHint') }}
        </p>
      </div>

      <div class="border-t border-white/10 px-3 py-2.5 text-[11px] text-slate-300">
        <p data-testid="cesium-project-name" class="truncate font-semibold text-white" :title="projectName">
          {{ projectName }}
        </p>
        <p data-testid="cesium-project-dimensions" class="mt-1">{{ dimensionsLabel }}</p>
        <p class="mt-2 text-amber-300">{{ t('view.cesiumTerrainNotice') }}</p>
        <p v-if="layerWarning" class="mt-2 text-rose-300" role="status">
          {{ t('view.cesiumLayerWarning') }}
        </p>
      </div>
    </aside>

    <div
      v-if="isLoading"
      class="absolute inset-0 z-10 flex flex-col items-center justify-center gap-4 bg-[#08131f] text-white"
      role="status"
    >
      <Loader2 class="animate-spin text-[#FF6600]" :size="48" />
      <p class="text-sm font-semibold">{{ t('view.cesiumLoading') }}</p>
    </div>

    <div
      v-if="errorMessage"
      class="absolute inset-0 z-20 flex items-center justify-center bg-[#08131f] p-6 text-center text-white"
      role="alert"
      data-testid="cesium-error"
    >
      <div class="max-w-md rounded-2xl border border-amber-400/30 bg-slate-900/90 p-6 shadow-2xl">
        <TriangleAlert class="mx-auto mb-3 text-amber-400" :size="36" />
        <h2 class="text-base font-bold">{{ t('view.cesiumUnavailable') }}</h2>
        <p class="mt-2 text-sm text-slate-300">{{ t('view.cesiumConfigHint') }}</p>
      </div>
    </div>
  </section>
</template>

<style scoped>
.cesium-layer-row {
  @apply flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 transition-colors hover:bg-white/10;
}
</style>

<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { Crosshair, Layers, Loader2, RotateCcw, TriangleAlert } from 'lucide-vue-next';
import 'cesium/Build/Cesium/Widgets/widgets.css';
import {
  CESIUM_ION_TOKEN,
  formatCesiumDistance,
  getCesiumBoundsCenter,
  hasCesiumToken,
  measureCesiumBounds,
  normalizeCesiumBounds,
} from '../../services/cesiumConfig.js';
import {
  getCesiumRoadStyle,
  osmRoadFeaturesToGeoJson,
} from '../../services/cesiumOsmAdapter.js';
import {
  applyTerrainHeightsToBuildingGeoJson,
  getBuildingTerrainSamplePoints,
  osmBuildingFeaturesToGeoJson,
} from '../../services/cesiumOsmBuildingsAdapter.js';
import {
  deriveCoordinateJunctionsGeoJson,
  getRoadWidthPreviewStyle,
  osmRoadWidthsToGeoJson,
} from '../../services/cesiumRoadDiagnosticsAdapter.js';
import {
  FPV_EYE_HEIGHT_METERS,
  FPV_MOUSE_SENSITIVITY,
  clampFpvPitch,
  getFpvMovement,
  isFpvControlKey,
} from '../../services/cesiumFpvControls.js';
import {
  applyTerrainHeightsToCompilerPreview,
  countCompilerPreviewSurfaces,
  fetchCompilerPreview,
  getCompilerPreviewTerrainSamplePoints,
  normalizeCompilerJobId,
  offsetCompilerPreviewHeights,
} from '../../services/cesiumCompilerPreview.js';

const props = defineProps({
  center: {
    type: Object,
    default: () => ({ lat: 48.7687, lng: 18.7408 }),
  },
  projectBounds: {
    type: Object,
    default: null,
  },
  projectName: {
    type: String,
    default: 'MapNG Project',
  },
  osmFeatures: {
    type: Array,
    default: () => [],
  },
  compilerJobId: {
    type: String,
    default: '',
  },
  compilerStatus: {
    type: String,
    default: 'idle',
  },
  compilerError: {
    type: String,
    default: '',
  },
  active: {
    type: Boolean,
    default: true,
  },
});

const { t } = useI18n({ useScope: 'global' });
const container = ref(null);
const isLoading = ref(true);
const errorMessage = ref('');
const layerWarning = ref('');
const osmLayerLoading = ref(false);
const osmLayerError = ref('');
const buildingLayerLoading = ref(false);
const buildingLayerError = ref('');
const roadWidthLayerLoading = ref(false);
const roadWidthLayerError = ref('');
const junctionLayerLoading = ref(false);
const junctionLayerError = ref('');
const compilerLayerLoading = ref(false);
const compilerLayerError = ref('');
const compilerJobInput = ref(props.compilerJobId || '');
const compilerPreview = ref(null);
const fpvMode = ref(false);
const fpvPointerLocked = ref(false);
// Road surfaces are enabled independently. The experimental deformed terrain
// must never replace or overlay Cesium World Terrain in this mode.
const COMPILER_PREVIEW_ENABLED = true;
const layerState = reactive({
  terrain: true,
  imagery: true,
  projectBounds: true,
  projectCenter: true,
  osmCenterlines: false,
  buildings: false,
  roadWidths: false,
  junctions: false,
  compilerSurfaces: false,
});

const normalizedBounds = computed(() => normalizeCesiumBounds(props.projectBounds));
const osmRoadGeoJson = computed(() => osmRoadFeaturesToGeoJson(props.osmFeatures));
const osmRoadCount = computed(() => osmRoadGeoJson.value.features.length);
const osmBuildingsGeoJson = computed(() => osmBuildingFeaturesToGeoJson(props.osmFeatures));
const osmBuildingCount = computed(() => osmBuildingsGeoJson.value.features.length);
const estimatedBuildingCount = computed(() => osmBuildingsGeoJson.value.features.reduce(
  (count, feature) => count + (feature.properties.previewHeightEstimated ? 1 : 0),
  0,
));
const roadWidthsGeoJson = computed(() => osmRoadWidthsToGeoJson(props.osmFeatures));
const roadWidthCount = computed(() => roadWidthsGeoJson.value.features.length);
const estimatedRoadWidthCount = computed(() => roadWidthsGeoJson.value.features.reduce(
  (count, feature) => count + (feature.properties.previewWidthConfidence === 'estimated' ? 1 : 0),
  0,
));
const junctionsGeoJson = computed(() => deriveCoordinateJunctionsGeoJson(props.osmFeatures));
const junctionCount = computed(() => junctionsGeoJson.value.features.length);
const compilerSurfaceCount = computed(
  () => countCompilerPreviewSurfaces(compilerPreview.value).total,
);
const compilerIsWorking = computed(() => ![
  '', 'idle', 'inputs-missing', 'FAILED', 'SUCCEEDED',
].includes(String(props.compilerStatus || '')));
const projectDimensions = computed(() => measureCesiumBounds(normalizedBounds.value));
const dimensionsLabel = computed(() => {
  const dimensions = projectDimensions.value;
  if (!dimensions) return t('view.cesiumDimensionsUnavailable');
  return `${formatCesiumDistance(dimensions.widthMeters)} × ${formatCesiumDistance(dimensions.heightMeters)}`;
});

let CesiumApi = null;
let viewer = null;
let resizeObserver = null;
let worldTerrainProvider = null;
let ellipsoidTerrainProvider = null;
let imageryLayer = null;
let boundsEntity = null;
let centerEntity = null;
let osmRoadDataSource = null;
let osmLoadGeneration = 0;
let buildingDataSource = null;
let buildingLoadGeneration = 0;
let roadWidthDataSource = null;
let roadWidthLoadGeneration = 0;
let junctionDataSource = null;
let junctionLoadGeneration = 0;
let compilerDataSource = null;
let compilerLoadGeneration = 0;
let compilerFetchController = null;
const fpvPressedKeys = new Set();
let fpvLastTickTime = 0;
let fpvHadPointerLock = false;
let removeFpvTick = null;
let removeFpvMorphListener = null;
let fpvCanvas = null;
let roadLayersAutoEnabled = false;

const enableGeneratedRoadLayersOnce = () => {
  if (roadLayersAutoEnabled || !osmRoadCount.value) return;
  layerState.osmCenterlines = true;
  layerState.roadWidths = roadWidthCount.value > 0;
  roadLayersAutoEnabled = true;
};

const moveCameraToProject = () => {
  if (!viewer || !CesiumApi || viewer.isDestroyed()) return;

  const projectCenter = getCesiumBoundsCenter(normalizedBounds.value, props.center);
  const dimensions = projectDimensions.value;
  const largestDimension = Math.max(
    Number(dimensions?.widthMeters || 0),
    Number(dimensions?.heightMeters || 0),
  );
  const cameraRange = Math.max(2500, largestDimension * 3.5);
  const target = CesiumApi.Cartesian3.fromDegrees(projectCenter.lng, projectCenter.lat);
  viewer.camera.lookAt(
    target,
    new CesiumApi.HeadingPitchRange(
      0,
      CesiumApi.Math.toRadians(-55),
      cameraRange,
    ),
  );
  viewer.camera.lookAtTransform(CesiumApi.Matrix4.IDENTITY);
};

const resetCesiumCamera = () => {
  if (fpvMode.value) exitFpvMode();
  moveCameraToProject();
};

const configureOrbitControls = () => {
  if (!viewer || viewer.isDestroyed()) return;
  const controls = viewer.scene.screenSpaceCameraController;
  controls.enableInputs = true;
  controls.enableRotate = true;
  controls.enableTranslate = true;
  controls.enableZoom = true;
  controls.enableTilt = true;
  controls.enableLook = true;
  controls.enableCollisionDetection = true;
  controls.minimumZoomDistance = 1;
  controls.maximumZoomDistance = 10_000_000;
  controls.inertiaSpin = 0.85;
  controls.inertiaTranslate = 0.85;
  controls.inertiaZoom = 0.8;
};

const getFpvCanvas = () => viewer?.scene?.canvas || null;

const keepFpvCameraOnTerrain = () => {
  if (!viewer || !CesiumApi || viewer.isDestroyed()) return;
  const cartographic = viewer.camera.positionCartographic;
  const terrainHeight = viewer.scene.globe.getHeight(cartographic);
  if (!Number.isFinite(terrainHeight)) return;

  const destination = CesiumApi.Cartesian3.fromRadians(
    cartographic.longitude,
    cartographic.latitude,
    terrainHeight + FPV_EYE_HEIGHT_METERS,
  );
  viewer.camera.setView({
    destination,
    orientation: {
      heading: viewer.camera.heading,
      pitch: viewer.camera.pitch,
      roll: 0,
    },
  });
};

const moveCameraToFpvStart = async () => {
  if (!viewer || !CesiumApi || viewer.isDestroyed()) return;
  const projectCenter = getCesiumBoundsCenter(normalizedBounds.value, props.center);
  const position = CesiumApi.Cartographic.fromDegrees(projectCenter.lng, projectCenter.lat);

  try {
    const [sampledPosition] = await CesiumApi.sampleTerrainMostDetailed(
      worldTerrainProvider,
      [position],
    );
    if (!fpvMode.value || !viewer || viewer.isDestroyed()) return;
    const terrainHeight = Number.isFinite(sampledPosition?.height)
      ? sampledPosition.height
      : 0;
    viewer.camera.setView({
      destination: CesiumApi.Cartesian3.fromRadians(
        position.longitude,
        position.latitude,
        terrainHeight + FPV_EYE_HEIGHT_METERS,
      ),
      orientation: {
        heading: Number.isFinite(viewer.camera.heading) ? viewer.camera.heading : 0,
        pitch: 0,
        roll: 0,
      },
    });
  } catch {
    if (!fpvMode.value || !viewer || viewer.isDestroyed()) return;
    const loadedTerrainHeight = viewer.scene.globe.getHeight(position);
    if (Number.isFinite(loadedTerrainHeight)) {
      viewer.camera.setView({
        destination: CesiumApi.Cartesian3.fromRadians(
          position.longitude,
          position.latitude,
          loadedTerrainHeight + FPV_EYE_HEIGHT_METERS,
        ),
        orientation: {
          heading: Number.isFinite(viewer.camera.heading) ? viewer.camera.heading : 0,
          pitch: 0,
          roll: 0,
        },
      });
    } else {
      keepFpvCameraOnTerrain();
    }
  }
};

const requestFpvPointerLock = () => {
  const canvas = getFpvCanvas();
  if (!fpvMode.value || !props.active || !canvas) return;
  canvas.tabIndex = 0;
  canvas.focus();
  canvas.requestPointerLock?.();
};

const exitFpvMode = ({ releasePointer = true } = {}) => {
  fpvMode.value = false;
  fpvPointerLocked.value = false;
  fpvHadPointerLock = false;
  fpvPressedKeys.clear();
  fpvLastTickTime = 0;
  if (viewer && !viewer.isDestroyed()) {
    viewer.scene.screenSpaceCameraController.enableInputs = true;
  }
  if (releasePointer && document.pointerLockElement) {
    document.exitPointerLock?.();
  }
};

const enterFpvMode = () => {
  if (!viewer || viewer.isDestroyed() || !props.active) return;
  fpvMode.value = true;
  fpvPressedKeys.clear();
  fpvLastTickTime = 0;
  viewer.scene.screenSpaceCameraController.enableInputs = false;
  requestFpvPointerLock();
  void moveCameraToFpvStart();
};

const toggleFpvMode = () => {
  if (fpvMode.value) exitFpvMode();
  else enterFpvMode();
};

const handleFpvPointerLockChange = () => {
  const locked = document.pointerLockElement === getFpvCanvas();
  fpvPointerLocked.value = locked;
  if (locked) {
    fpvHadPointerLock = true;
  } else if (fpvMode.value && fpvHadPointerLock) {
    exitFpvMode({ releasePointer: false });
  }
};

const handleFpvMouseMove = (event) => {
  if (!fpvMode.value || !fpvPointerLocked.value || !viewer || viewer.isDestroyed()) return;
  viewer.camera.setView({
    orientation: {
      heading: viewer.camera.heading + event.movementX * FPV_MOUSE_SENSITIVITY,
      pitch: clampFpvPitch(viewer.camera.pitch - event.movementY * FPV_MOUSE_SENSITIVITY),
      roll: 0,
    },
  });
};

const handleFpvKeyDown = (event) => {
  if (!fpvMode.value) return;
  if (event.key === 'Escape') {
    exitFpvMode();
    return;
  }
  if (!isFpvControlKey(event.key)) return;
  event.preventDefault();
  fpvPressedKeys.add(event.key.toLowerCase());
};

const handleFpvKeyUp = (event) => {
  if (!isFpvControlKey(event.key)) return;
  if (fpvMode.value) event.preventDefault();
  fpvPressedKeys.delete(event.key.toLowerCase());
};

const updateFpvCamera = () => {
  if (!fpvMode.value || !viewer || viewer.isDestroyed()) {
    fpvLastTickTime = 0;
    return;
  }
  const now = performance.now();
  if (!fpvLastTickTime) {
    fpvLastTickTime = now;
    return;
  }
  const movement = getFpvMovement(fpvPressedKeys, (now - fpvLastTickTime) / 1000);
  fpvLastTickTime = now;
  if (movement.forward > 0) viewer.camera.moveForward(movement.forward);
  if (movement.forward < 0) viewer.camera.moveBackward(-movement.forward);
  if (movement.right > 0) viewer.camera.moveRight(movement.right);
  if (movement.right < 0) viewer.camera.moveLeft(-movement.right);
  if (movement.forward || movement.right) keepFpvCameraOnTerrain();
};

const setupFpvControls = () => {
  fpvCanvas = getFpvCanvas();
  fpvCanvas?.addEventListener('click', requestFpvPointerLock);
  document.addEventListener('pointerlockchange', handleFpvPointerLockChange);
  document.addEventListener('mousemove', handleFpvMouseMove);
  window.addEventListener('keydown', handleFpvKeyDown);
  window.addEventListener('keyup', handleFpvKeyUp);
  removeFpvTick = viewer?.clock.onTick.addEventListener(updateFpvCamera) || null;
  removeFpvMorphListener = viewer?.scene.morphStart.addEventListener(exitFpvMode) || null;
};

const teardownFpvControls = () => {
  exitFpvMode();
  fpvCanvas?.removeEventListener('click', requestFpvPointerLock);
  document.removeEventListener('pointerlockchange', handleFpvPointerLockChange);
  document.removeEventListener('mousemove', handleFpvMouseMove);
  window.removeEventListener('keydown', handleFpvKeyDown);
  window.removeEventListener('keyup', handleFpvKeyUp);
  removeFpvTick?.();
  removeFpvMorphListener?.();
  removeFpvTick = null;
  removeFpvMorphListener = null;
  fpvCanvas = null;
};

const removeProjectEntities = () => {
  if (!viewer || viewer.isDestroyed()) return;
  if (boundsEntity) viewer.entities.remove(boundsEntity);
  if (centerEntity) viewer.entities.remove(centerEntity);
  boundsEntity = null;
  centerEntity = null;
};

const rebuildProjectEntities = () => {
  if (!viewer || !CesiumApi || viewer.isDestroyed()) return;
  removeProjectEntities();
  layerWarning.value = '';

  const bounds = normalizedBounds.value;
  if (!bounds) return;

  try {
    const polygonPositions = CesiumApi.Cartesian3.fromDegreesArray([
      bounds.west, bounds.south,
      bounds.east, bounds.south,
      bounds.east, bounds.north,
      bounds.west, bounds.north,
    ]);
    const outlinePositions = CesiumApi.Cartesian3.fromDegreesArray([
      bounds.west, bounds.south,
      bounds.east, bounds.south,
      bounds.east, bounds.north,
      bounds.west, bounds.north,
      bounds.west, bounds.south,
    ]);

    boundsEntity = viewer.entities.add({
      id: 'mapng-project-bounds',
      show: layerState.projectBounds,
      polygon: {
        hierarchy: new CesiumApi.PolygonHierarchy(polygonPositions),
        material: CesiumApi.Color.fromCssColorString('#FF6600').withAlpha(0.2),
        classificationType: CesiumApi.ClassificationType.BOTH,
      },
      polyline: {
        positions: outlinePositions,
        clampToGround: true,
        width: 3,
        material: CesiumApi.Color.fromCssColorString('#FF8A33'),
      },
    });

    const projectCenter = getCesiumBoundsCenter(bounds, props.center);
    centerEntity = viewer.entities.add({
      id: 'mapng-project-center',
      show: layerState.projectCenter,
      position: CesiumApi.Cartesian3.fromDegrees(projectCenter.lng, projectCenter.lat),
      point: {
        pixelSize: 12,
        color: CesiumApi.Color.fromCssColorString('#FF6600'),
        outlineColor: CesiumApi.Color.WHITE,
        outlineWidth: 2,
        heightReference: CesiumApi.HeightReference.CLAMP_TO_GROUND,
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
      },
      label: {
        text: `${props.projectName}\n${dimensionsLabel.value}`,
        font: '600 14px sans-serif',
        fillColor: CesiumApi.Color.WHITE,
        showBackground: true,
        backgroundColor: CesiumApi.Color.fromCssColorString('#0F172A').withAlpha(0.85),
        pixelOffset: new CesiumApi.Cartesian2(18, 0),
        horizontalOrigin: CesiumApi.HorizontalOrigin.LEFT,
        verticalOrigin: CesiumApi.VerticalOrigin.CENTER,
        heightReference: CesiumApi.HeightReference.CLAMP_TO_GROUND,
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
      },
    });
  } catch {
    removeProjectEntities();
    layerWarning.value = 'project-layer-failed';
  }
};

const removeOsmRoadDataSource = () => {
  osmLoadGeneration += 1;
  if (viewer && !viewer.isDestroyed() && osmRoadDataSource) {
    viewer.dataSources.remove(osmRoadDataSource, true);
  }
  osmRoadDataSource = null;
};

const rebuildOsmRoadDataSource = async () => {
  removeOsmRoadDataSource();
  osmLayerError.value = '';

  if (!viewer || !CesiumApi || viewer.isDestroyed() || !osmRoadCount.value) {
    osmLayerLoading.value = false;
    layerState.osmCenterlines = false;
    return;
  }

  const generation = osmLoadGeneration;
  osmLayerLoading.value = true;

  try {
    const dataSource = await CesiumApi.GeoJsonDataSource.load(osmRoadGeoJson.value, {
      clampToGround: true,
    });

    if (generation !== osmLoadGeneration || !viewer || viewer.isDestroyed()) {
      dataSource.entities.removeAll();
      return;
    }

    const now = CesiumApi.JulianDate.now();
    dataSource.name = 'MapNG OSM centerlines';
    dataSource.entities.values.forEach((entity) => {
      const properties = entity.properties?.getValue(now) || {};
      const style = getCesiumRoadStyle(properties.highway);
      if (entity.polyline) {
        entity.polyline.material = CesiumApi.Color.fromCssColorString(style.color);
        entity.polyline.width = style.width;
        entity.polyline.clampToGround = true;
      }
      entity.name = properties.name || `${properties.highway || 'road'} · ${properties.osmId || ''}`;
    });

    dataSource.show = layerState.osmCenterlines;
    osmRoadDataSource = await viewer.dataSources.add(dataSource);
  } catch {
    if (generation === osmLoadGeneration) {
      osmLayerError.value = 'osm-layer-failed';
      layerState.osmCenterlines = false;
    }
  } finally {
    if (generation === osmLoadGeneration) osmLayerLoading.value = false;
  }
};

const removeBuildingDataSource = () => {
  buildingLoadGeneration += 1;
  if (viewer && !viewer.isDestroyed() && buildingDataSource) {
    viewer.dataSources.remove(buildingDataSource, true);
  }
  buildingDataSource = null;
};

const rebuildBuildingDataSource = async () => {
  removeBuildingDataSource();
  buildingLayerError.value = '';

  if (!viewer || !CesiumApi || viewer.isDestroyed() || !osmBuildingCount.value) {
    buildingLayerLoading.value = false;
    layerState.buildings = false;
    return;
  }

  const generation = buildingLoadGeneration;
  buildingLayerLoading.value = true;

  try {
    const sourceGeoJson = osmBuildingsGeoJson.value;
    let renderGeoJson = sourceGeoJson;
    let hasAbsoluteTerrainHeights = false;

    try {
      const samplePoints = getBuildingTerrainSamplePoints(sourceGeoJson);
      const cartographicPositions = samplePoints.map((point) => (
        CesiumApi.Cartographic.fromDegrees(point.lng, point.lat)
      ));
      const sampledPositions = await CesiumApi.sampleTerrainMostDetailed(
        worldTerrainProvider,
        cartographicPositions,
      );
      if (generation !== buildingLoadGeneration || !viewer || viewer.isDestroyed()) return;
      const terrainHeights = sampledPositions.map((position) => (
        Number.isFinite(position?.height)
          ? position.height
          : viewer.scene.globe.getHeight(position)
      ));
      const groundedGeoJson = applyTerrainHeightsToBuildingGeoJson(
        sourceGeoJson,
        terrainHeights,
      );
      if (groundedGeoJson.features.length > 0) {
        renderGeoJson = groundedGeoJson;
        hasAbsoluteTerrainHeights = true;
      }
    } catch {
      // Safe fallback: flat clamped footprints are preferable to floating extrusions.
      renderGeoJson = sourceGeoJson;
      hasAbsoluteTerrainHeights = false;
    }

    const dataSource = await CesiumApi.GeoJsonDataSource.load(renderGeoJson, {
      clampToGround: !hasAbsoluteTerrainHeights,
    });

    if (generation !== buildingLoadGeneration || !viewer || viewer.isDestroyed()) {
      dataSource.entities.removeAll();
      return;
    }

    const now = CesiumApi.JulianDate.now();
    dataSource.name = 'MapNG OSM buildings';
    dataSource.entities.values.forEach((entity) => {
      const properties = entity.properties?.getValue(now) || {};
      if (entity.polygon) {
        const absoluteRoofHeight = Number(properties.previewAbsoluteRoofMeters);
        entity.polygon.material = CesiumApi.Color.fromCssColorString('#E8B56A').withAlpha(0.78);
        entity.polygon.outline = true;
        entity.polygon.outlineColor = CesiumApi.Color.fromCssColorString('#7C4A16');
        if (Number.isFinite(absoluteRoofHeight)) {
          entity.polygon.height = undefined;
          entity.polygon.heightReference = CesiumApi.HeightReference.NONE;
          entity.polygon.perPositionHeight = true;
          entity.polygon.extrudedHeight = absoluteRoofHeight;
          entity.polygon.extrudedHeightReference = CesiumApi.HeightReference.NONE;
          entity.polygon.closeTop = true;
          entity.polygon.closeBottom = true;
        } else {
          entity.polygon.extrudedHeight = undefined;
          entity.polygon.extrudedHeightReference = CesiumApi.HeightReference.NONE;
        }
      }
      entity.name = properties.name || `${properties.building || properties.buildingPart || 'building'} · ${properties.osmId || ''}`;
    });

    dataSource.show = layerState.buildings;
    buildingDataSource = await viewer.dataSources.add(dataSource);
  } catch {
    if (generation === buildingLoadGeneration) {
      buildingLayerError.value = 'buildings-layer-failed';
      layerState.buildings = false;
    }
  } finally {
    if (generation === buildingLoadGeneration) buildingLayerLoading.value = false;
  }
};

const removeRoadWidthDataSource = () => {
  roadWidthLoadGeneration += 1;
  if (viewer && !viewer.isDestroyed() && roadWidthDataSource) {
    viewer.dataSources.remove(roadWidthDataSource, true);
  }
  roadWidthDataSource = null;
};

const rebuildRoadWidthDataSource = async () => {
  removeRoadWidthDataSource();
  roadWidthLayerError.value = '';
  if (!viewer || !CesiumApi || viewer.isDestroyed() || !roadWidthCount.value) {
    roadWidthLayerLoading.value = false;
    layerState.roadWidths = false;
    return;
  }

  const generation = roadWidthLoadGeneration;
  roadWidthLayerLoading.value = true;
  try {
    const dataSource = await CesiumApi.GeoJsonDataSource.load(roadWidthsGeoJson.value, {
      clampToGround: true,
    });
    if (generation !== roadWidthLoadGeneration || !viewer || viewer.isDestroyed()) {
      dataSource.entities.removeAll();
      return;
    }

    const now = CesiumApi.JulianDate.now();
    dataSource.name = 'MapNG road width diagnostics';
    dataSource.entities.values.forEach((entity) => {
      const properties = entity.properties?.getValue(now) || {};
      const positions = entity.polyline?.positions;
      const style = getRoadWidthPreviewStyle(properties.previewWidthSource);
      if (positions) {
        entity.corridor = new CesiumApi.CorridorGraphics({
          positions,
          width: Number(properties.previewWidthMeters || 5.5),
          material: CesiumApi.Color.fromCssColorString(style.color).withAlpha(style.alpha),
          cornerType: CesiumApi.CornerType.ROUNDED,
          classificationType: CesiumApi.ClassificationType.BOTH,
          zIndex: 1,
        });
        entity.polyline = undefined;
      }
      entity.name = `${properties.name || properties.highway || 'road'} · ${Number(properties.previewWidthMeters || 0).toFixed(1)} m`;
    });
    dataSource.show = layerState.roadWidths;
    roadWidthDataSource = await viewer.dataSources.add(dataSource);
  } catch {
    if (generation === roadWidthLoadGeneration) {
      roadWidthLayerError.value = 'road-width-layer-failed';
      layerState.roadWidths = false;
    }
  } finally {
    if (generation === roadWidthLoadGeneration) roadWidthLayerLoading.value = false;
  }
};

const removeJunctionDataSource = () => {
  junctionLoadGeneration += 1;
  if (viewer && !viewer.isDestroyed() && junctionDataSource) {
    viewer.dataSources.remove(junctionDataSource, true);
  }
  junctionDataSource = null;
};

const rebuildJunctionDataSource = async () => {
  removeJunctionDataSource();
  junctionLayerError.value = '';
  if (!viewer || !CesiumApi || viewer.isDestroyed() || !junctionCount.value) {
    junctionLayerLoading.value = false;
    layerState.junctions = false;
    return;
  }

  const generation = junctionLoadGeneration;
  junctionLayerLoading.value = true;
  try {
    const dataSource = await CesiumApi.GeoJsonDataSource.load(junctionsGeoJson.value, {
      clampToGround: true,
    });
    if (generation !== junctionLoadGeneration || !viewer || viewer.isDestroyed()) {
      dataSource.entities.removeAll();
      return;
    }

    const colors = {
      'T-junction': '#F59E0B',
      '4-way': '#EF4444',
      'multi-way': '#D946EF',
      'split/merge': '#38BDF8',
    };
    const now = CesiumApi.JulianDate.now();
    dataSource.name = 'MapNG coordinate-derived junctions';
    dataSource.entities.values.forEach((entity) => {
      const properties = entity.properties?.getValue(now) || {};
      if (entity.billboard) entity.billboard = undefined;
      entity.point = new CesiumApi.PointGraphics({
        pixelSize: 11,
        color: CesiumApi.Color.fromCssColorString(colors[properties.classification] || '#F59E0B'),
        outlineColor: CesiumApi.Color.WHITE,
        outlineWidth: 2,
        heightReference: CesiumApi.HeightReference.CLAMP_TO_GROUND,
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
      });
      entity.name = `${properties.classification || 'junction'} · ${properties.nodeIdentity || ''}`;
    });
    dataSource.show = layerState.junctions;
    junctionDataSource = await viewer.dataSources.add(dataSource);
  } catch {
    if (generation === junctionLoadGeneration) {
      junctionLayerError.value = 'junction-layer-failed';
      layerState.junctions = false;
    }
  } finally {
    if (generation === junctionLoadGeneration) junctionLayerLoading.value = false;
  }
};

const removeCompilerDataSource = () => {
  compilerLoadGeneration += 1;
  if (viewer && !viewer.isDestroyed() && compilerDataSource) {
    viewer.dataSources.remove(compilerDataSource, true);
  }
  compilerDataSource = null;
};

const rebuildCompilerDataSource = async () => {
  removeCompilerDataSource();
  if (!viewer || !CesiumApi || viewer.isDestroyed() || !compilerSurfaceCount.value) {
    layerState.compilerSurfaces = false;
    return;
  }

  const generation = compilerLoadGeneration;
  try {
    let displayPreview = offsetCompilerPreviewHeights(compilerPreview.value);
    let clampCompilerSurfaceToGround = false;
    if (worldTerrainProvider) {
      try {
        const samplePoints = getCompilerPreviewTerrainSamplePoints(compilerPreview.value);
        const positions = samplePoints.map((point) => (
          CesiumApi.Cartographic.fromDegrees(point.lng, point.lat)
        ));
        const sampledPositions = await CesiumApi.sampleTerrainMostDetailed(
          worldTerrainProvider,
          positions,
        );
        if (generation !== compilerLoadGeneration || !viewer || viewer.isDestroyed()) return;
        const terrainHeights = sampledPositions.map((position) => (
          Number.isFinite(position?.height)
            ? position.height
            : viewer.scene.globe.getHeight(position)
        ));
        displayPreview = applyTerrainHeightsToCompilerPreview(
          compilerPreview.value,
          terrainHeights,
        );
        clampCompilerSurfaceToGround = !displayPreview;
        if (!displayPreview) displayPreview = compilerPreview.value;
      } catch {
        displayPreview = compilerPreview.value;
        clampCompilerSurfaceToGround = true;
      }
    }
    const dataSource = await CesiumApi.GeoJsonDataSource.load(displayPreview, {
      clampToGround: clampCompilerSurfaceToGround,
    });
    if (generation !== compilerLoadGeneration || !viewer || viewer.isDestroyed()) {
      dataSource.entities.removeAll();
      return;
    }

    const now = CesiumApi.JulianDate.now();
    dataSource.name = 'GeoCrash compiled road surfaces';
    dataSource.entities.values.forEach((entity) => {
      const properties = entity.properties?.getValue(now) || {};
      if (entity.polygon) {
        entity.polygon.perPositionHeight = !clampCompilerSurfaceToGround;
        entity.polygon.material = properties.kind === 'junction_surface'
          ? CesiumApi.Color.fromCssColorString('#22D3EE').withAlpha(0.82)
          : CesiumApi.Color.fromCssColorString('#06B6D4').withAlpha(0.62);
        entity.polygon.outline = false;
      }
      entity.name = properties.kind === 'junction_surface'
        ? `Compiler junction · ${properties.junctionId || ''}`
        : `Compiler road · ${properties.roadId || ''}`;
    });
    dataSource.show = layerState.compilerSurfaces;
    compilerDataSource = await viewer.dataSources.add(dataSource);
  } catch {
    if (generation === compilerLoadGeneration) {
      compilerLayerError.value = 'compiler-layer-failed';
      layerState.compilerSurfaces = false;
    }
  }
};

const loadCompilerPreview = async () => {
  if (!COMPILER_PREVIEW_ENABLED) return;
  const jobId = normalizeCompilerJobId(compilerJobInput.value);
  compilerLayerError.value = '';
  if (!jobId) {
    compilerLayerError.value = 'compiler-job-invalid';
    return;
  }

  compilerFetchController?.abort();
  compilerFetchController = new AbortController();
  compilerLayerLoading.value = true;
  try {
    const preview = await fetchCompilerPreview(jobId, {
      signal: compilerFetchController.signal,
    });
    compilerPreview.value = preview;
    compilerJobInput.value = jobId;
    localStorage.setItem('mapng_compiler_preview_job_id', jobId);
    layerState.compilerSurfaces = true;
    await rebuildCompilerDataSource();
    syncLayerVisibility();
  } catch (error) {
    if (error?.name !== 'AbortError') {
      compilerPreview.value = null;
      removeCompilerDataSource();
      compilerLayerError.value = error?.message || 'compiler-layer-failed';
      layerState.compilerSurfaces = false;
    }
  } finally {
    compilerLayerLoading.value = false;
  }
};

const syncLayerVisibility = () => {
  if (!viewer || viewer.isDestroyed()) return;

  try {
    if (imageryLayer) imageryLayer.show = layerState.imagery;
    if (worldTerrainProvider && ellipsoidTerrainProvider) {
      viewer.terrainProvider = layerState.terrain
        ? worldTerrainProvider
        : ellipsoidTerrainProvider;
    }
    if (boundsEntity) boundsEntity.show = layerState.projectBounds;
    if (centerEntity) centerEntity.show = layerState.projectCenter;
    if (osmRoadDataSource) osmRoadDataSource.show = layerState.osmCenterlines;
    if (buildingDataSource) buildingDataSource.show = layerState.buildings;
    if (roadWidthDataSource) roadWidthDataSource.show = layerState.roadWidths;
    if (junctionDataSource) junctionDataSource.show = layerState.junctions;
    if (compilerDataSource) compilerDataSource.show = layerState.compilerSurfaces;
    viewer.scene.globe.depthTestAgainstTerrain = true;
  } catch {
    layerWarning.value = 'layer-visibility-failed';
  }
};

const destroyViewer = () => {
  resizeObserver?.disconnect();
  resizeObserver = null;

  teardownFpvControls();
  removeOsmRoadDataSource();
  removeBuildingDataSource();
  removeRoadWidthDataSource();
  removeJunctionDataSource();
  compilerFetchController?.abort();
  compilerFetchController = null;
  removeCompilerDataSource();
  if (viewer && !viewer.isDestroyed()) {
    viewer.destroy();
  }
  viewer = null;
  imageryLayer = null;
  boundsEntity = null;
  centerEntity = null;
  osmRoadDataSource = null;
  buildingDataSource = null;
  roadWidthDataSource = null;
  junctionDataSource = null;
  compilerDataSource = null;
};

const initializeCesium = async () => {
  if (!hasCesiumToken()) {
    errorMessage.value = 'missing-token';
    isLoading.value = false;
    return;
  }

  try {
    await nextTick();
    CesiumApi = await import('cesium');
    CesiumApi.Ion.defaultAccessToken = CESIUM_ION_TOKEN;

    const [terrainProvider, imageryProvider] = await Promise.all([
      CesiumApi.createWorldTerrainAsync({ requestVertexNormals: true }),
      CesiumApi.IonImageryProvider.fromAssetId(2),
    ]);
    worldTerrainProvider = terrainProvider;
    ellipsoidTerrainProvider = new CesiumApi.EllipsoidTerrainProvider();

    viewer = new CesiumApi.Viewer(container.value, {
      animation: false,
      baseLayer: false,
      baseLayerPicker: false,
      fullscreenButton: false,
      geocoder: false,
      homeButton: true,
      infoBox: true,
      navigationHelpButton: false,
      sceneModePicker: true,
      selectionIndicator: true,
      timeline: false,
      terrainProvider: worldTerrainProvider,
    });

    imageryLayer = viewer.imageryLayers.addImageryProvider(imageryProvider);
    viewer.scene.globe.depthTestAgainstTerrain = true;
    configureOrbitControls();
    rebuildProjectEntities();
    enableGeneratedRoadLayersOnce();
    await Promise.all([
      rebuildOsmRoadDataSource(),
      rebuildBuildingDataSource(),
      rebuildRoadWidthDataSource(),
      rebuildJunctionDataSource(),
    ]);
    const initialCompilerJobId = normalizeCompilerJobId(
      props.compilerJobId,
    );
    if (initialCompilerJobId) {
      compilerJobInput.value = initialCompilerJobId;
      await loadCompilerPreview();
    }
    syncLayerVisibility();
    moveCameraToProject();
    setupFpvControls();

    resizeObserver = new ResizeObserver(() => viewer?.resize());
    resizeObserver.observe(container.value);
  } catch {
    destroyViewer();
    errorMessage.value = 'initialization-failed';
  } finally {
    isLoading.value = false;
  }
};

watch(layerState, syncLayerVisibility, { deep: true });
watch(
  () => [
    props.projectBounds?.north,
    props.projectBounds?.south,
    props.projectBounds?.east,
    props.projectBounds?.west,
    props.projectName,
  ],
  () => {
    rebuildProjectEntities();
    moveCameraToProject();
  },
);
watch(
  () => props.active,
  (active) => {
    if (!active && fpvMode.value) exitFpvMode();
  },
);
watch(
  () => props.osmFeatures,
  () => {
    enableGeneratedRoadLayersOnce();
    rebuildOsmRoadDataSource();
    rebuildBuildingDataSource();
    rebuildRoadWidthDataSource();
    rebuildJunctionDataSource();
  },
);
watch(
  () => props.compilerJobId,
  (jobId) => {
    const normalized = normalizeCompilerJobId(jobId);
    if (!normalized) return;
    if (normalized !== normalizeCompilerJobId(compilerJobInput.value)) {
      compilerJobInput.value = normalized;
    }
    if (!compilerPreview.value && viewer && !viewer.isDestroyed()) void loadCompilerPreview();
  },
);
watch(
  () => props.compilerStatus,
  (status) => {
    const normalized = String(status || '');
    if (normalized && !['idle', 'inputs-missing', 'FAILED'].includes(normalized)) {
      if (normalized !== 'SUCCEEDED' && compilerPreview.value) {
        compilerPreview.value = null;
        layerState.compilerSurfaces = false;
        removeCompilerDataSource();
      }
      // A new automatic compile supersedes any stale error from the optional
      // manual job loader. Its own failure is presented through compilerError.
      compilerLayerError.value = '';
    }
  },
);
watch(
  () => [props.center?.lat, props.center?.lng],
  () => {
    if (!normalizedBounds.value) moveCameraToProject();
  },
);

onMounted(initializeCesium);
onBeforeUnmount(destroyViewer);
</script>
