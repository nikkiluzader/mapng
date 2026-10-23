<script setup>
import { ref, shallowRef, watch, toRaw, markRaw, onUnmounted } from 'vue';
import * as THREE from 'three';
import { fetchSurroundingTiles, POSITIONS } from '../../services/surroundingTiles';

const SCENE_SIZE = 100;
const SEAM_BLEND_WIDTH_UNITS = SCENE_SIZE * 0.42;

const props = defineProps({
  terrainData: { type: Object, required: true },
  quality: { type: String, default: 'low' },
  textureMode: { type: String, default: 'satellite' },
  visible: { type: Boolean, default: false },
});
const emit = defineEmits(['loading-state']);

const EXAGGERATION = 1.0;

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

const emitLoadingState = (overrides = {}) => {
  emit('loading-state', {
    isLoading: isLoading.value,
    textureMode: props.textureMode,
    completedSatellite: 0,
    totalSatellite: 0,
    ...overrides,
  });
};

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

const smoothstep = (edge0, edge1, x) => {
  const t = clamp((x - edge0) / Math.max(edge1 - edge0, 1e-6), 0, 1);
  return t * t * (3 - 2 * t);
};

const getQualityProfile = (quality, terrainData) => {
  const centerResolution = Math.max(256, Number(terrainData?.width || 1024));

  if (quality === 'high') {
    return {
      fetchResolution: Math.min(centerResolution, 1024),
      satelliteZoom: 15,
      seamEdgeResolution: 384,
      depthResolution: 256,
      cornerResolution: 320,
      anisotropy: 16,
    };
  }

  if (quality === 'medium') {
    return {
      fetchResolution: Math.min(centerResolution, 768),
      satelliteZoom: 14,
      seamEdgeResolution: 256,
      depthResolution: 192,
      cornerResolution: 224,
      anisotropy: 8,
    };
  }

  return {
    fetchResolution: Math.min(centerResolution, 512),
    satelliteZoom: 13,
    seamEdgeResolution: 192,
    depthResolution: 128,
    cornerResolution: 160,
    anisotropy: 4,
  };
};

const getCenterHeightAtScenePos = (terrainData, sceneX, sceneZ, unitsPerMeter) => {
  const u = clamp((sceneX + SCENE_SIZE / 2) / SCENE_SIZE, 0, 1);
  const v = clamp((sceneZ + SCENE_SIZE / 2) / SCENE_SIZE, 0, 1);

  const localX = u * (terrainData.width - 1);
  const localZ = v * (terrainData.height - 1);

  const x0 = Math.floor(localX);
  const x1 = Math.min(x0 + 1, terrainData.width - 1);
  const y0 = Math.floor(localZ);
  const y1 = Math.min(y0 + 1, terrainData.height - 1);

  const wx = localX - x0;
  const wy = localZ - y0;

  const hm = terrainData.heightMap;
  const w = terrainData.width;

  const i00 = y0 * w + x0;
  const i10 = y0 * w + x1;
  const i01 = y1 * w + x0;
  const i11 = y1 * w + x1;

  const h00 = hm[i00] < -10000 ? terrainData.minHeight : hm[i00];
  const h10 = hm[i10] < -10000 ? terrainData.minHeight : hm[i10];
  const h01 = hm[i01] < -10000 ? terrainData.minHeight : hm[i01];
  const h11 = hm[i11] < -10000 ? terrainData.minHeight : hm[i11];

  const h = (1 - wy) * ((1 - wx) * h00 + wx * h10) + wy * ((1 - wx) * h01 + wx * h11);
  return (h - terrainData.minHeight) * unitsPerMeter * EXAGGERATION;
};

const blendToCenterSeamHeight = (terrainData, data, offset, globalX, globalZ, surroundingHeight, unitsPerMeter, profile) => {
  const half = SCENE_SIZE / 2;
  
  // 1. Point on center tile boundary nearest to current vertex
  const seamX = clamp(globalX, -half, half);
  const seamZ = clamp(globalZ, -half, half);
  
  // 2. Euclidean distance to that boundary point
  const dx = globalX - seamX;
  const dz = globalZ - seamZ;
  const distanceToSeam = Math.sqrt(dx * dx + dz * dz);

  if (distanceToSeam > SEAM_BLEND_WIDTH_UNITS) return surroundingHeight;

  // 3. 11-tap Filter along the dominant seam tangent to average out noise.
  // This is the robust way to fix "skirting" on South/West tiles.
  const isHorizontalSeam = Math.abs(dz) > Math.abs(dx);
  const meshStep = SCENE_SIZE / profile.seamEdgeResolution;
  const samples = 11;
  let totalH = 0;
  for (let s = 0; s < samples; s++) {
    const t = (s / (samples - 1)) - 0.5;
    // Sample PARALLEL to the seam we are blending with.
    const offX = isHorizontalSeam ? (t * meshStep * 2.0) : 0;
    const offZ = !isHorizontalSeam ? (t * meshStep * 2.0) : 0;
    totalH += getCenterHeightAtScenePos(terrainData, seamX + offX, seamZ + offZ, unitsPerMeter);
  }
  const centerEdgeH = totalH / samples;
  
  // 4. Surround height at same boundary point (also averaged slightly)
  const localX = seamX - offset.x * SCENE_SIZE;
  const localZ = seamZ - offset.z * SCENE_SIZE;
  const uEdge = (localX + half) / SCENE_SIZE;
  const vEdge = (localZ + half) / SCENE_SIZE;
  const surroundingRawH = sampleSurroundingHeight(data, uEdge, vEdge);
  const surroundingEdgeH = (surroundingRawH - terrainData.minHeight) * unitsPerMeter * EXAGGERATION;

  // 5. Compute vertical difference at seam
  const errorAtSeam = centerEdgeH - surroundingEdgeH;
  
  // 6. Taper offset using a wider smooth curve and a small 100% plateau at the edge
  const plateau = 0.5; // Stay 100% matched for first half meter
  const blend = smoothstep(plateau, SEAM_BLEND_WIDTH_UNITS, distanceToSeam);
  
  return surroundingHeight + errorAtSeam * (1 - blend);
};

const sampleSurroundingHeight = (data, u, v) => {
  const w = data.width;
  const h = data.height;
  const x = clamp(u * (w - 1), 0, Math.max(0, w - 1));
  const y = clamp(v * (h - 1), 0, Math.max(0, h - 1));
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const x1 = Math.min(x0 + 1, w - 1);
  const y1 = Math.min(y0 + 1, h - 1);
  const dx = x - x0;
  const dy = y - y0;

  const index = (ix, iy) => iy * w + ix;
  const h00Raw = data.heightMap[index(x0, y0)];
  const h10Raw = data.heightMap[index(x1, y0)];
  const h01Raw = data.heightMap[index(x0, y1)];
  const h11Raw = data.heightMap[index(x1, y1)];

  const h00 = h00Raw < -10000 ? data.minHeight : h00Raw;
  const h10 = h10Raw < -10000 ? data.minHeight : h10Raw;
  const h01 = h01Raw < -10000 ? data.minHeight : h01Raw;
  const h11 = h11Raw < -10000 ? data.minHeight : h11Raw;

  const top = (1 - dx) * h00 + dx * h10;
  const bottom = (1 - dx) * h01 + dx * h11;
  return (1 - dy) * top + dy * bottom;
};

// Build mesh data from surrounding tile result
const buildTileMesh = (pos, data, terrainData, unitsPerMeter, profile) => {
  const offset = SCENE_OFFSETS[pos];
  if (!offset) return null;

  const maxSegX = Math.max(4, data.width - 1);
  const maxSegY = Math.max(4, data.height - 1);
  const isCornerTile = offset.x !== 0 && offset.z !== 0;
  const seamRunsAlongX = offset.x === 0 && offset.z !== 0; // N/S seam
  const seamRunsAlongY = offset.z === 0 && offset.x !== 0; // E/W seam

  let segsX;
  let segsY;

  if (isCornerTile) {
    segsX = Math.min(maxSegX, profile.cornerResolution);
    segsY = Math.min(maxSegY, profile.cornerResolution);
  } else if (seamRunsAlongX) {
    segsX = Math.min(maxSegX, profile.seamEdgeResolution);
    segsY = Math.min(maxSegY, profile.depthResolution);
  } else if (seamRunsAlongY) {
    segsX = Math.min(maxSegX, profile.depthResolution);
    segsY = Math.min(maxSegY, profile.seamEdgeResolution);
  } else {
    segsX = Math.min(maxSegX, profile.depthResolution);
    segsY = Math.min(maxSegY, profile.depthResolution);
  }

  segsX = Math.max(4, Math.floor(segsX));
  segsY = Math.max(4, Math.floor(segsY));

  const geo = new THREE.PlaneGeometry(SCENE_SIZE, SCENE_SIZE, segsX, segsY);
  const vertices = geo.attributes.position.array;
  const uvs = geo.attributes.uv.array;

  for (let i = 0; i < vertices.length / 3; i++) {
    const col = i % (segsX + 1);
    const row = Math.floor(i / (segsX + 1));

    const u = col / segsX;
    const v = row / segsY;

    const h = sampleSurroundingHeight(data, u, v);

    const localX = u * SCENE_SIZE - SCENE_SIZE / 2;
    const localZ = v * SCENE_SIZE - SCENE_SIZE / 2;
    const globalX = localX + offset.x * SCENE_SIZE;
    const globalZ = localZ + offset.z * SCENE_SIZE;
    const surroundingHeight = (h - terrainData.minHeight) * unitsPerMeter * EXAGGERATION;
    const blendedHeight = blendToCenterSeamHeight(
      terrainData,
      data,
      offset,
      globalX,
      globalZ,
      surroundingHeight,
      unitsPerMeter,
      profile,
    );

    vertices[i * 3] = globalX;
    vertices[i * 3 + 1] = -globalZ;
    vertices[i * 3 + 2] = blendedHeight;

    uvs[i * 2] = u;
    uvs[i * 2 + 1] = v;
  }

  geo.computeVertexNormals();

  // Load satellite texture
  const useTexture = props.textureMode !== 'none';
  let texture = null;
  if (useTexture && data.satelliteDataUrl) {
    texture = new THREE.TextureLoader().load(data.satelliteDataUrl);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.generateMipmaps = true;
    texture.minFilter = THREE.LinearMipmapLinearFilter;
    texture.magFilter = THREE.LinearFilter;
    texture.anisotropy = profile.anisotropy;
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
  emitLoadingState({ isLoading: true });

  try {
    const allPositions = POSITIONS.map(p => p.key);
    const profile = getQualityProfile(props.quality, props.terrainData);
    const results = await fetchSurroundingTiles(
      props.terrainData.bounds,
      allPositions,
      profile.fetchResolution,
      profile.satelliteZoom,
      null,
      abortController.signal,
      {
        includeSatellite: props.textureMode !== 'none',
        useNativeTerrainGrid: true,
        onDownloadProgress: ({ completedSatellite = 0, totalSatellite = 0 }) => {
          emitLoadingState({
            isLoading: true,
            completedSatellite,
            totalSatellite,
          });
        },
      },
    );

    // Compute scale
    const latRad = (props.terrainData.bounds.north + props.terrainData.bounds.south) / 2 * Math.PI / 180;
    const metersPerDegree = 111320 * Math.cos(latRad);
    const realWidthMeters = (props.terrainData.bounds.east - props.terrainData.bounds.west) * metersPerDegree;
    const unitsPerMeter = SCENE_SIZE / realWidthMeters;

    const meshes = [];
    for (const [pos, data] of Object.entries(results)) {
      const mesh = buildTileMesh(pos, data, props.terrainData, unitsPerMeter, profile);
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
    emitLoadingState({ isLoading: false });
    abortController = null;
  }
};

// Fetch when toggled visible (lazy load)
watch(() => props.visible, (v) => {
  if (v && !loaded.value && !isLoading.value) {
    fetchAndBuild();
  } else if (!v) {
    emitLoadingState({ isLoading: false });
  }
}, { immediate: true });

// Refetch if terrain data changes while visible
watch(() => props.terrainData?.bounds, () => {
  if (props.visible) {
    loaded.value = false;
    fetchAndBuild();
  }
});

watch(() => props.quality, () => {
  if (props.visible) {
    loaded.value = false;
    fetchAndBuild();
  }
});

watch(() => props.textureMode, () => {
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
