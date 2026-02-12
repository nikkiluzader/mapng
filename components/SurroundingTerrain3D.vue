<script setup>
import { ref, shallowRef, watch, toRaw, markRaw, onUnmounted } from 'vue';
import * as THREE from 'three';
import { fetchSurroundingTiles, POSITIONS } from '../services/surroundingTiles';

const SCENE_SIZE = 100;
// Lower resolution for 3D preview — keeps it fast & memory-light
const PREVIEW_RESOLUTION = 256;
const PREVIEW_SAT_ZOOM = 13;

const props = defineProps({
  terrainData: { type: Object, required: true },
  quality: { type: String, default: 'low' },
  visible: { type: Boolean, default: false },
});

// Map compass directions to scene position offsets (in SCENE_SIZE units)
// Center tile sits at (0,0). N = +Z in geo but -Z in scene (flipped).
// X: W=-1, E=+1
// Z: N=-1, S=+1 (north is "up" / negative Z in scene)
const SCENE_OFFSETS = {
  NW: { x: -1, z: -1 },
  N:  { x:  0, z: -1 },
  NE: { x:  1, z: -1 },
  W:  { x: -1, z:  0 },
  E:  { x:  1, z:  0 },
  SW: { x: -1, z:  1 },
  S:  { x:  0, z:  1 },
  SE: { x:  1, z:  1 },
};

const tileMeshes = ref([]);
const isLoading = ref(false);
const loaded = ref(false);
let abortController = null;

// Build mesh data from surrounding tile result
const buildTileMesh = (pos, data, centerMinHeight, unitsPerMeter) => {
  const offset = SCENE_OFFSETS[pos];
  if (!offset) return null;

  const stride = props.quality === 'high' ? 1 : props.quality === 'medium' ? 2 : 4;
  const steps = Math.max(4, Math.floor((data.width - 1) / stride));

  const geo = new THREE.PlaneGeometry(SCENE_SIZE, SCENE_SIZE, steps, steps);
  const vertices = geo.attributes.position.array;
  const uvs = geo.attributes.uv.array;

  for (let i = 0; i < vertices.length / 3; i++) {
    const col = i % (steps + 1);
    const row = Math.floor(i / (steps + 1));

    const u = col / steps;
    const v = row / steps;

    const mapCol = Math.min(Math.round(u * (data.width - 1)), data.width - 1);
    const mapRow = Math.min(Math.round(v * (data.height - 1)), data.height - 1);
    const idx = mapRow * data.width + mapCol;

    let h = data.heightMap[idx];
    if (h < -10000) h = data.minHeight;

    const localX = u * SCENE_SIZE - SCENE_SIZE / 2;
    const localZ = v * SCENE_SIZE - SCENE_SIZE / 2;

    // Offset to adjacent tile position
    vertices[i * 3] = localX + offset.x * SCENE_SIZE;
    vertices[i * 3 + 1] = -(localZ + offset.z * SCENE_SIZE);
    vertices[i * 3 + 2] = (h - centerMinHeight) * unitsPerMeter;

    uvs[i * 2] = u;
    uvs[i * 2 + 1] = v;
  }

  geo.computeVertexNormals();

  // Load satellite texture
  let texture = null;
  if (data.satelliteDataUrl) {
    texture = new THREE.TextureLoader().load(data.satelliteDataUrl);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.generateMipmaps = true;
    texture.minFilter = THREE.LinearMipmapLinearFilter;
    texture.magFilter = THREE.LinearFilter;
    texture.anisotropy = 4;
    texture.flipY = false;
    texture.wrapS = THREE.ClampToEdgeWrapping;
    texture.wrapT = THREE.ClampToEdgeWrapping;
  }

  return { geometry: markRaw(geo), texture: texture ? markRaw(texture) : null, key: pos };
};

const dispose = () => {
  tileMeshes.value.forEach(m => {
    m.geometry?.dispose();
    m.texture?.dispose();
  });
  tileMeshes.value = [];
  loaded.value = false;
};

const fetchAndBuild = async () => {
  if (!props.terrainData?.bounds || isLoading.value) return;

  if (abortController) abortController.abort();
  abortController = new AbortController();

  dispose();
  isLoading.value = true;

  try {
    const allPositions = POSITIONS.map(p => p.key);
    const results = await fetchSurroundingTiles(
      props.terrainData.bounds,
      allPositions,
      PREVIEW_RESOLUTION,
      PREVIEW_SAT_ZOOM,
      null,
      abortController.signal,
    );

    // Compute scale
    const latRad = (props.terrainData.bounds.north + props.terrainData.bounds.south) / 2 * Math.PI / 180;
    const metersPerDegree = 111320 * Math.cos(latRad);
    const realWidthMeters = (props.terrainData.bounds.east - props.terrainData.bounds.west) * metersPerDegree;
    const unitsPerMeter = SCENE_SIZE / realWidthMeters;

    const meshes = [];
    for (const [pos, data] of Object.entries(results)) {
      const mesh = buildTileMesh(pos, data, props.terrainData.minHeight, unitsPerMeter);
      if (mesh) meshes.push(mesh);
    }

    tileMeshes.value = meshes;
    loaded.value = true;
  } catch (e) {
    if (e.name !== 'AbortError') {
      console.error('[SurroundingTerrain3D] Failed:', e);
    }
  } finally {
    isLoading.value = false;
    abortController = null;
  }
};

// Fetch when toggled visible (lazy load)
watch(() => props.visible, (v) => {
  if (v && !loaded.value && !isLoading.value) {
    fetchAndBuild();
  }
}, { immediate: true });

// Refetch if terrain data changes while visible
watch(() => props.terrainData?.bounds, () => {
  if (props.visible) {
    loaded.value = false;
    fetchAndBuild();
  }
});

onUnmounted(() => {
  if (abortController) abortController.abort();
  dispose();
});
</script>

<template>
  <TresGroup v-if="visible">
    <TresMesh
      v-for="tile in tileMeshes"
      :key="tile.key"
      :rotation="[-Math.PI / 2, 0, 0]"
      :position="[0, 0, 0]"
      receive-shadow
      :geometry="tile.geometry"
    >
      <TresMeshStandardMaterial
        :map="tile.texture"
        :color="tile.texture ? 0xffffff : 0x8a8a8a"
        :roughness="1"
        :metalness="0"
        :side="2"
      />
    </TresMesh>
  </TresGroup>
</template>
