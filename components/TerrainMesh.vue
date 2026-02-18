<script setup>
import { computed, shallowRef, reactive, watch, toRaw, markRaw, onUnmounted } from 'vue';
import * as THREE from 'three';

const props = defineProps({
  terrainData: { required: true },
  quality: { required: true },
  textureType: { default: 'satellite' },
  wireframe: { default: false, type: Boolean }
});

const SCENE_SIZE = 100;
const geometry = shallowRef(null);

// Generate terrain geometry
watch([() => props.terrainData?.heightMap, () => props.quality], () => {
  const data = toRaw(props.terrainData);
  if (!data) return;

  const MAX_MESH_RESOLUTION = 2048;
  const baseStride = Math.ceil(Math.max(data.width, data.height) / MAX_MESH_RESOLUTION);
  const qualityMultiplier = props.quality === 'high' ? 1 : props.quality === 'medium' ? 2 : 4;
  const stride = Math.max(1, baseStride * qualityMultiplier);

  const widthSteps = Math.ceil((data.width - 1) / stride);
  const heightSteps = Math.ceil((data.height - 1) / stride);

  const geo = new THREE.PlaneGeometry(SCENE_SIZE, SCENE_SIZE, widthSteps, heightSteps);
  const vertices = geo.attributes.position.array;
  const uvs = geo.attributes.uv.array;

  // Calculate scale factor (units per meter)
  const latRad = (data.bounds.north + data.bounds.south) / 2 * Math.PI / 180;
  const metersPerDegree = 111320 * Math.cos(latRad);
  const realWidthMeters = (data.bounds.east - data.bounds.west) * metersPerDegree;
  const unitsPerMeter = SCENE_SIZE / realWidthMeters;
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
    vertices[i * 3 + 2] = (h - data.minHeight) * unitsPerMeter * EXAGGERATION;

    uvs[i * 2] = u;
    uvs[i * 2 + 1] = v;
  }

  geo.computeVertexNormals();
  
  // Dispose old geometry if it exists
  if (geometry.value) {
    geometry.value.dispose();
  }
  
  geometry.value = markRaw(geo);
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
  const tex = new THREE.TextureLoader().load(url);
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

// Helper to create texture directly from canvas (skips PNG encode/decode)
const loadCanvasTexture = (canvas) => {
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
  return markRaw(tex);
};

// Watch individual URLs and update the cache
watch(() => props.terrainData?.satelliteTextureUrl, (url) => {
  if (textureCache.satellite) textureCache.satellite.dispose();
  textureCache.satellite = loadTexture(url);
}, { immediate: true });

watch(() => props.terrainData?.osmTextureUrl, (url) => {
  if (textureCache.osm) textureCache.osm.dispose();
  // Prefer direct canvas if available (sharper, avoids PNG round-trip)
  const canvas = props.terrainData?.osmTextureCanvas;
  if (canvas) {
    canvasCache.osm = canvas;
    textureCache.osm = loadCanvasTexture(canvas);
  } else {
    canvasCache.osm = null;
    textureCache.osm = loadTexture(url);
  }
}, { immediate: true });

watch(() => props.terrainData?.hybridTextureUrl, (url) => {
  if (textureCache.hybrid) textureCache.hybrid.dispose();
  // Prefer direct canvas if available
  const canvas = props.terrainData?.hybridTextureCanvas;
  if (canvas) {
    canvasCache.hybrid = canvas;
    textureCache.hybrid = loadCanvasTexture(canvas);
  } else {
    canvasCache.hybrid = null;
    textureCache.hybrid = loadTexture(url);
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
});
</script>

<template>
  <TresMesh 
    v-if="geometry"
    :rotation="[-Math.PI / 2, 0, 0]" 
    :position="[0, 0, 0]"
    cast-shadow
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
</template>
