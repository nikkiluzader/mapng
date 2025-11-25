<script setup lang="ts">
import { computed, shallowRef, watch, toRaw, markRaw } from 'vue';
import * as THREE from 'three';
import { TerrainData } from '../types';

type Quality = 'low' | 'medium' | 'high';

interface Props {
  terrainData: TerrainData;
  quality: Quality;
}

const props = defineProps<Props>();

const SCENE_SIZE = 100;
const geometry = shallowRef<THREE.PlaneGeometry | null>(null);

// Generate terrain geometry
watch([() => props.terrainData, () => props.quality], () => {
  const data = toRaw(props.terrainData);
  if (!data) return;

  const MAX_MESH_RESOLUTION = 1024;
  const baseStride = Math.ceil(Math.max(data.width, data.height) / MAX_MESH_RESOLUTION);
  const qualityMultiplier = props.quality === 'high' ? 1 : props.quality === 'medium' ? 2 : 4;
  const stride = baseStride * qualityMultiplier;

  const widthSteps = Math.ceil((data.width - 1) / stride);
  const heightSteps = Math.ceil((data.height - 1) / stride);

  const geo = new THREE.PlaneGeometry(SCENE_SIZE, SCENE_SIZE, widthSteps, heightSteps);
  const vertices = geo.attributes.position.array as Float32Array;
  const uvs = geo.attributes.uv.array as Float32Array;

  // Calculate scale factor (units per meter)
  const latRad = (data.bounds.north + data.bounds.south) / 2 * Math.PI / 180;
  const metersPerDegree = 111320 * Math.cos(latRad);
  const realWidthMeters = (data.bounds.east - data.bounds.west) * metersPerDegree;
  const unitsPerMeter = SCENE_SIZE / realWidthMeters;
  const EXAGGERATION = 1.5;

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

    vertices[i * 3] = globalX;
    vertices[i * 3 + 1] = -(globalZ);
    vertices[i * 3 + 2] = (data.heightMap[dataIndex] - data.minHeight) * unitsPerMeter * EXAGGERATION;

    // Update UVs to match the physical position
    // Texture (0,0) is top-left, Mesh UV (0,0) is bottom-left
    // u maps 0->1 (Left->Right) => UV.x
    // v maps 0->1 (Top->Bottom) => UV.y should be 1->0
    uvs[i * 2] = u;
    uvs[i * 2 + 1] = 1 - v;
  }

  geo.computeVertexNormals();
  
  // Dispose old geometry if it exists
  if (geometry.value) {
    geometry.value.dispose();
  }
  
  geometry.value = markRaw(geo);
}, { immediate: true });

// Load texture
const texture = computed(() => {
  if (props.terrainData.satelliteTextureUrl) {
    const tex = new THREE.TextureLoader().load(props.terrainData.satelliteTextureUrl);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.minFilter = THREE.LinearFilter;
    tex.magFilter = THREE.LinearFilter;
    return tex;
  }
  return null;
});
</script>

<template>
  <TresMesh 
    v-if="geometry"
    :rotation="[-Math.PI / 2, 0, 0]" 
    :position="[0, 0, 0]"
    :cast-shadow="true"
    :receive-shadow="true"
    :geometry="geometry"
  >
    <TresMeshStandardMaterial 
      :map="texture"
      :color="texture ? 0xffffff : 0x64748b"
      :roughness="1"
      :metalness="0"
      :side="2"
    />
  </TresMesh>
</template>
