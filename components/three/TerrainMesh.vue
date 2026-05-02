<script setup>
import { computed, shallowRef, reactive, watch, toRaw, markRaw, onUnmounted, ref } from 'vue';
import * as THREE from 'three';
import { useTresContext, useLoop } from '@tresjs/core';

const props = defineProps({
  terrainData: { required: true },
  quality: { required: true },
  textureType: { default: 'satellite' },
  showWater: { default: true, type: Boolean },
  waterLevelOffsetMeters: { default: 0, type: Number },
  wireframe: { default: false, type: Boolean }
});

const SCENE_SIZE = 100;
const geometry = shallowRef(null);
const waterMeshRef = ref(null);
const waterCubeRenderTarget = shallowRef(null);
const waterCubeCamera = shallowRef(null);
const { scene, renderer, camera } = useTresContext();
const { onBeforeRender } = useLoop();

const WATER_REFLECTION_RESOLUTION_BY_QUALITY = {
  low: 64,
  medium: 96,
  high: 128,
};
const WATER_REFLECTION_UPDATE_EVERY_N_FRAMES = 2;
const WATER_REFLECTION_FAR = 600;
const WATER_CAMERA_MOVE_EPSILON = 0.01;
const WATER_CAMERA_ROT_EPSILON = 0.0008;
let reflectionFrameCounter = 0;
const lastReflectionCameraPosition = new THREE.Vector3(Number.NaN, Number.NaN, Number.NaN);
const lastReflectionCameraQuaternion = new THREE.Quaternion(Number.NaN, Number.NaN, Number.NaN, Number.NaN);

const unitsPerMeter = computed(() => {
  const data = toRaw(props.terrainData);
  if (!data?.bounds) return 0;
  const latRad = ((data.bounds.north + data.bounds.south) / 2) * Math.PI / 180;
  const metersPerDegree = 111320 * Math.cos(latRad);
  const realWidthMeters = (data.bounds.east - data.bounds.west) * metersPerDegree;
  if (!Number.isFinite(realWidthMeters) || realWidthMeters <= 0) return 0;
  return SCENE_SIZE / realWidthMeters;
});

const seaLevelSceneZ = computed(() => {
  const data = toRaw(props.terrainData);
  const minHeight = Number(data?.minHeight);
  const upm = unitsPerMeter.value;
  if (!Number.isFinite(minHeight) || !Number.isFinite(upm) || upm <= 0) return 0;
  const offsetMeters = Number.isFinite(Number(props.waterLevelOffsetMeters))
    ? Number(props.waterLevelOffsetMeters)
    : 0;
  // Exported terrain uses minHeight as local Z origin, so sea level (0 m)
  // sits at -minHeight in terrain space.
  return (-minHeight + offsetMeters) * upm;
});

const waterPlaneSize = computed(() => SCENE_SIZE * 3);
const waterEnvMap = computed(() => waterCubeRenderTarget.value?.texture ?? null);
const waterReflectionResolution = computed(() => {
  const quality = String(props.quality || 'medium');
  return WATER_REFLECTION_RESOLUTION_BY_QUALITY[quality] ?? WATER_REFLECTION_RESOLUTION_BY_QUALITY.medium;
});

const disposeWaterReflection = () => {
  const sceneObj = scene.value;
  if (sceneObj && waterCubeCamera.value) {
    sceneObj.remove(waterCubeCamera.value);
  }
  if (waterCubeRenderTarget.value) {
    waterCubeRenderTarget.value.dispose();
  }
  waterCubeRenderTarget.value = null;
  waterCubeCamera.value = null;
};

const initWaterReflection = () => {
  const sceneObj = scene.value;
  if (!sceneObj) return;
  disposeWaterReflection();

  const target = new THREE.WebGLCubeRenderTarget(waterReflectionResolution.value, {
    generateMipmaps: false,
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
  });
  target.texture.colorSpace = THREE.SRGBColorSpace;

  const cubeCamera = new THREE.CubeCamera(0.1, WATER_REFLECTION_FAR, target);
  sceneObj.add(cubeCamera);

  waterCubeRenderTarget.value = markRaw(target);
  waterCubeCamera.value = markRaw(cubeCamera);
};

watch(() => scene.value, (sceneObj) => {
  if (sceneObj) initWaterReflection();
}, { immediate: true });

watch(() => props.quality, () => {
  if (scene.value) initWaterReflection();
});

onBeforeRender(() => {
  if (!props.showWater) return;
  const sceneObj = scene.value;
  const rendererObj = renderer.value;
  const activeCamera = camera.value;
  const cubeCamera = waterCubeCamera.value;
  if (!sceneObj || !rendererObj || !cubeCamera || !activeCamera) return;

  reflectionFrameCounter += 1;
  if (reflectionFrameCounter % WATER_REFLECTION_UPDATE_EVERY_N_FRAMES !== 0) return;

  const cameraMoved = lastReflectionCameraPosition.distanceToSquared(activeCamera.position) > (WATER_CAMERA_MOVE_EPSILON * WATER_CAMERA_MOVE_EPSILON);
  const cameraRotated = 1 - Math.abs(lastReflectionCameraQuaternion.dot(activeCamera.quaternion)) > WATER_CAMERA_ROT_EPSILON;
  if (!cameraMoved && !cameraRotated) return;

  const waterMesh = waterMeshRef.value?.instance ?? waterMeshRef.value;
  // Keep the reflection probe near the viewer to avoid static, boxy artifacts
  // from sampling a single center-position cubemap over a large water plane.
  cubeCamera.position.set(activeCamera.position.x, seaLevelSceneZ.value + 0.15, activeCamera.position.z);

  // Hide water while capturing to avoid self-reflection artifacts.
  if (waterMesh) waterMesh.visible = false;
  cubeCamera.update(rendererObj, sceneObj);
  if (waterMesh) waterMesh.visible = true;

  lastReflectionCameraPosition.copy(activeCamera.position);
  lastReflectionCameraQuaternion.copy(activeCamera.quaternion);
});

// Generate terrain geometry
watch([() => props.terrainData?.heightMap, () => props.quality], () => {
  const data = toRaw(props.terrainData);
  if (!data) return;

  const maxDim = Math.max(Number(data.width || 0), Number(data.height || 0));
  let MAX_MESH_RESOLUTION = 2048;
  if (maxDim >= 8192) {
    MAX_MESH_RESOLUTION = props.quality === 'high' ? 768 : props.quality === 'medium' ? 640 : 512;
  } else if (maxDim >= 4096) {
    MAX_MESH_RESOLUTION = props.quality === 'high' ? 1280 : props.quality === 'medium' ? 1024 : 768;
  }

  const baseStride = Math.ceil(Math.max(data.width, data.height) / MAX_MESH_RESOLUTION);
  const qualityMultiplier = props.quality === 'high' ? 1 : props.quality === 'medium' ? 2 : 4;
  const stride = Math.max(1, baseStride * qualityMultiplier);

  const widthSteps = Math.ceil((data.width - 1) / stride);
  const heightSteps = Math.ceil((data.height - 1) / stride);

  const geo = new THREE.PlaneGeometry(SCENE_SIZE, SCENE_SIZE, widthSteps, heightSteps);
  const vertices = geo.attributes.position.array;
  const uvs = geo.attributes.uv.array;

  // Calculate scale factor (units per meter)
  const upm = unitsPerMeter.value;
  const EXAGGERATION = 1.0;

  for (let i = 0; i < vertices.length / 3; i++) {
    const colIndex = i % (widthSteps + 1);
    const rowIndex = Math.floor(i / (widthSteps + 1));

    const mapCol = Math.min(colIndex * stride, data.width - 1);
    const mapRow = Math.min(rowIndex * stride, data.height - 1);
    
    const dataIndex = mapRow * data.width + mapCol;

    const u = mapCol / (data.width - 1);
    const v = mapRow / (data.height - 1);

    const globalX = (u * SCENE_SIZE) - (SCENE_SIZE / 2);
    const globalZ = (v * SCENE_SIZE) - (SCENE_SIZE / 2);

    let h = data.heightMap[dataIndex];
    // Handle NO_DATA_VALUE (-99999) by clamping to minHeight to avoid deep spikes
    if (h < -10000) {
      h = data.minHeight;
    }

    vertices[i * 3] = globalX;
    vertices[i * 3 + 1] = -(globalZ);
    vertices[i * 3 + 2] = (h - data.minHeight) * upm * EXAGGERATION;

    uvs[i * 2] = u;
    uvs[i * 2 + 1] = v;
  }

  geo.computeVertexNormals();

  // Dispose old geometry if it exists
  if (geometry.value) {
    geometry.value.dispose();
  }

  geometry.value = markRaw(geo);

  // After 2 frames the WebGL renderer has uploaded the buffer to GPU.
  // Null the CPU-side TypedArrays to free the ArrayBuffer (~50-130 MB at
  // max mesh resolution). The GPU retains the data; dispose() on unmount
  // still correctly deletes the WebGL buffers.
  requestAnimationFrame(() => requestAnimationFrame(() => {
    const g = toRaw(geometry.value);
    if (g === geo) { // only if this geometry is still active
      if (g.attributes.position) g.attributes.position.array = null;
      if (g.attributes.normal)   g.attributes.normal.array   = null;
      if (g.attributes.uv)       g.attributes.uv.array       = null;
    }
  }));
}, { immediate: true });

const textureCache = reactive({
  satellite: null,
  osm: null,
  hybrid: null
});

// Track canvas refs for direct CanvasTexture usage
const canvasCache = reactive({
  osm: null,
  hybrid: null
});

// Helper to load and configure a texture from URL
const loadTexture = (url) => {
  if (!url) return null;
  const tex = new THREE.TextureLoader().load(
    url,
    (t) => console.log(`[TerrainMesh] texture loaded — ${t.image?.width}x${t.image?.height}`),
    undefined,
    (err) => console.error('[TerrainMesh] texture load error:', err),
  );
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.anisotropy = 16;
  tex.flipY = false;
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  return markRaw(tex);
};

// Helper to create texture directly from canvas (skips PNG encode/decode).
// onUploaded: optional callback fired after the GPU upload completes (2 frames).
//   Use it to free external canvas references from terrainData.
const loadCanvasTexture = (canvas, onUploaded) => {
  if (!canvas) return null;
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.anisotropy = 16;
  tex.flipY = false;
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.needsUpdate = true;
  if (onUploaded) {
    // Two rAF frames is enough for the WebGL renderer to call texImage2D.
    // Do NOT null tex.image here — Three.js needs it for correct state management.
    // Instead we only free the external terrainData canvas reference via onUploaded.
    requestAnimationFrame(() => requestAnimationFrame(() => {
      onUploaded();
    }));
  }
  return markRaw(tex);
};

// Watch individual URLs and update the cache
watch(() => props.terrainData?.satelliteTextureUrl, (url) => {
  if (textureCache.satellite) textureCache.satellite.dispose();
  console.log(`[TerrainMesh] satellite texture watch — url=${url ? 'ok' : 'empty/null'}`);
  textureCache.satellite = loadTexture(url);
}, { immediate: true });

watch(() => props.terrainData?.osmTextureUrl, (url) => {
  if (textureCache.osm) textureCache.osm.dispose();
  const canvas = props.terrainData?.osmTextureCanvas;
  console.log(`[TerrainMesh] osm texture watch — url=${url ? "ok" : "empty/null"}, canvas=${canvas ? `${canvas.width}x${canvas.height}` : "null"}`);
  if (canvas) {
    canvasCache.osm = canvas;
    textureCache.osm = loadCanvasTexture(canvas, () => {
      canvasCache.osm = null;
      if (props.terrainData) {
        // Save width so exportBeamNGLevel can determine satelliteTexSize after canvas is freed
        if (!props.terrainData.hybridTexWidth) props.terrainData.hybridTexWidth = canvas.width;
        props.terrainData.osmTextureCanvas = null;
      }
    });
  } else {
    canvasCache.osm = null;
    textureCache.osm = loadTexture(url);
    if (!url) console.warn("[TerrainMesh] osm texture: no canvas and no url — texture will be null");
  }
}, { immediate: true });

watch(() => props.terrainData?.hybridTextureUrl, (url) => {
  if (textureCache.hybrid) textureCache.hybrid.dispose();
  const canvas = props.terrainData?.hybridTextureCanvas;
  console.log(`[TerrainMesh] hybrid texture watch — url=${url ? "ok" : "empty/null"}, canvas=${canvas ? `${canvas.width}x${canvas.height}` : "null"}`);
  if (canvas) {
    canvasCache.hybrid = canvas;
    textureCache.hybrid = loadCanvasTexture(canvas, () => {
      canvasCache.hybrid = null;
      if (props.terrainData) {
        // Save dimensions before clearing so exportBeamNGLevel can still determine
        // the correct baseTexSize for PBR material generation.
        props.terrainData.hybridTexWidth = canvas.width;
        props.terrainData.hybridTextureCanvas = null;
      }
    });
  } else {
    canvasCache.hybrid = null;
    textureCache.hybrid = loadTexture(url);
    if (!url) console.warn("[TerrainMesh] hybrid texture: no canvas and no url — texture will be null");
  }
}, { immediate: true });

// The currently active texture is just a lookup in our cache
const texture = computed(() => {
  return textureCache[props.textureType] || null;
});

onUnmounted(() => {
  if (geometry.value) geometry.value.dispose();
  Object.values(textureCache).forEach(tex => {
    if (tex) tex.dispose();
  });
  disposeWaterReflection();
});
</script>

<template>
  <TresGroup v-if="geometry">
    <TresMesh
      v-if="showWater"
      ref="waterMeshRef"
      :rotation="[-Math.PI / 2, 0, 0]"
      :position="[0, seaLevelSceneZ, 0]"
      :render-order="1"
    >
      <TresPlaneGeometry :args="[waterPlaneSize, waterPlaneSize, 1, 1]" />
      <TresMeshPhysicalMaterial
        :color="0x4f9dc6"
        :transparent="true"
        :opacity="0.6"
        :roughness="0.14"
        :metalness="0.02"
        :reflectivity="0.95"
        :ior="1.333"
        :transmission="0"
        :clearcoat="0.7"
        :clearcoat-roughness="0.12"
        :env-map-intensity="0.95"
        :env-map="waterEnvMap"
        :side="2"
        :depth-write="false"
      />
    </TresMesh>

    <TresMesh
      :rotation="[-Math.PI / 2, 0, 0]"
      :position="[0, 0, 0]"
      :render-order="2"
      receive-shadow
      :geometry="geometry"
    >
      <TresMeshStandardMaterial
        :key="texture ? 'tex' : 'clay'"
        :map="texture"
        :color="texture ? 0xffffff : 0xb0a898"
        :roughness="texture ? 1 : 0.5"
        :metalness="texture ? 0 : 0.5"
        :side="2"
        :wireframe="wireframe"
      />
    </TresMesh>
  </TresGroup>
</template>
