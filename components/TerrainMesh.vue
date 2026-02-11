<script setup>
import { computed, shallowRef, watch, toRaw, markRaw, onUnmounted } from 'vue';
import * as THREE from 'three';

const props = defineProps({
  terrainData: { required: true },
  quality: { required: true },
  textureType: { default: 'satellite' },
  wireframe: { default: false, type: Boolean }
});

const SCENE_SIZE = 100;
const geometry = shallowRef(null);
const texture = shallowRef(null);

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

const activeTextureUrl = computed(() => {
  const data = props.terrainData || {};
  if (props.textureType === 'satellite') return data.satelliteTextureUrl;
  if (props.textureType === 'osm') return data.osmTextureUrl;
  if (props.textureType === 'hybrid') return data.hybridTextureUrl;
  return null;
});

// Load texture when the active URL changes
watch(activeTextureUrl, (url) => {
  // Dispose previous texture to free GPU memory
  if (texture.value) {
    texture.value.dispose();
  }

  if (url) {
    const tex = new THREE.TextureLoader().load(url);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.minFilter = THREE.LinearFilter;
    tex.magFilter = THREE.LinearFilter;
    tex.anisotropy = 16;
    tex.flipY = false;
    tex.premultiplyAlpha = false;
    texture.value = markRaw(tex);
  } else {
    texture.value = null;
  }
}, { immediate: true });

onUnmounted(() => {
  if (geometry.value) geometry.value.dispose();
  if (texture.value) texture.value.dispose();
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
      :key="texture ? 'tex' : 'solid'"
      :map="texture"
      :color="texture ? 0xffffff : 0x6B705C"
      :roughness="1"
      :metalness="0"
      :side="2"
      :wireframe="wireframe"
    />
  </TresMesh>
</template>
