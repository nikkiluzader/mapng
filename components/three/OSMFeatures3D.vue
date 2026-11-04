<script setup>
import { shallowRef, watch, toRaw, onUnmounted } from 'vue';
import { createOSMGroup } from '../../services/export3d';
import { sceneFromDescription } from '../../services/daeWorker.js';

const props = defineProps({
  terrainData: { required: true },
  featureVisibility: { 
    type: Object, 
    default: () => ({ buildings: true, vegetation: true, barriers: true }) 
  }
});

const group = shallowRef(null);

const disposeGroup = (grp) => {
  if (!grp) return;
  grp.traverse((child) => {
    if (child.isMesh) {
      if (child.geometry) child.geometry.dispose();
      if (child.material) {
        if (Array.isArray(child.material)) {
          child.material.forEach(m => m.dispose());
        } else {
          child.material.dispose();
        }
      }
    }
  });
};

const buildPreviewOptions = (data) => {
  // PREVIEW-ONLY SAFETY PROFILE:
  // These limits intentionally reduce 3D preview memory usage for dense OSM areas.
  // Do not reuse this profile for export pipelines (GLB/DAE/BeamNG), which must
  // preserve full export quality.
  const osmCount = Array.isArray(data?.osmFeatures) ? data.osmFeatures.length : 0;
  const maxDim = Math.max(Number(data?.width || 0), Number(data?.height || 0));
  const dense = osmCount >= 9000 || (maxDim >= 8192 && osmCount >= 5000);
  const veryDense = osmCount >= 18000 || (maxDim >= 8192 && osmCount >= 10000);

  return {
    // Build every category once; the visibility checkboxes toggle mesh.visible
    // below instead of triggering a full extrude/merge rebuild per click.
    includeBuildings: true,
    includeVegetation: true,
    includeBarriers: true,
    includeStreetFurniture: !dense,
    maxBuildings: Number.POSITIVE_INFINITY,
    maxBarriers: veryDense ? 800 : dense ? 1800 : 5000,
    maxTrees: veryDense ? 600 : dense ? 1200 : 3000,
    maxBushes: veryDense ? 400 : dense ? 800 : 3000,
    maxStreetFurniture: veryDense ? 0 : dense ? 300 : 1500,
    simplifyBuildingFootprints: true,
    footprintSimplifyTolerance: veryDense ? 1.9 : dense ? 1.2 : 0.6,
    lightweightVegetationMode: true,
  };
};

// createOSMGroup names its merged meshes by category ('buildings',
// 'vegetation', 'barriers'); flipping `visible` is free, while a rebuild
// re-extrudes and re-merges every footprint (seconds of jank in dense areas).
const applyVisibility = () => {
  const grp = group.value;
  if (!grp) return;
  const vis = {
    buildings: props.featureVisibility?.buildings !== false,
    vegetation: props.featureVisibility?.vegetation !== false,
    barriers: props.featureVisibility?.barriers !== false,
  };
  grp.traverse((child) => {
    if (child.isMesh && child.name in vis) child.visible = vis[child.name];
  });
};

// The shapes are built in a Web Worker (services/previewOsmWorker.js): built
// here they froze the window for seconds in dense areas. The worker gets the
// OSM features and the heightmap (for big maps a downsampled one: the
// preview's terrain mesh is coarser still), and sends back finished meshes.
// Where no worker starts, they are built here as before.
const WORKER_HEIGHTMAP_MAX = 4096;
let worker = null;
let workerBroken = false;
let buildSeq = 0;

const getWorker = () => {
  if (worker || workerBroken || typeof Worker === 'undefined') return worker;
  try {
    worker = new Worker(new URL('../../services/previewOsmWorker.js', import.meta.url), { type: 'module' });
  } catch {
    workerBroken = true;
    worker = null;
  }
  return worker;
};

// (the fields createOSMGroup reads; a heightmap above WORKER_HEIGHTMAP_MAX sampled down)
const workerTerrain = (data) => {
  const { width, height, heightMap } = data;
  let w = width; let h = height; let hm = heightMap;
  const step = Math.max(1, Math.ceil(Math.max(width, height) / WORKER_HEIGHTMAP_MAX));
  if (step > 1 && heightMap) {
    w = Math.ceil(width / step); h = Math.ceil(height / step);
    hm = new Float32Array(w * h);
    for (let y = 0; y < h; y++) {
      const sy = Math.min(height - 1, y * step) * width;
      for (let x = 0; x < w; x++) hm[y * w + x] = heightMap[sy + Math.min(width - 1, x * step)];
    }
  }
  return {
    bounds: { ...data.bounds }, width: w, height: h, heightMap: hm,
    minHeight: data.minHeight, maxHeight: data.maxHeight,
    metersPerPixel: data.metersPerPixel, processingMetersPerPixel: data.processingMetersPerPixel,
    osmFeatures: data.osmFeatures,
  };
};

const buildHere = (rawData) => {
  group.value = createOSMGroup(rawData, buildPreviewOptions(rawData));
  applyVisibility();
};

const rebuildGroup = (data) => {
  const seq = ++buildSeq;
  if (group.value) {
    disposeGroup(group.value);
    group.value = null;
  }
  if (!data) return;
  const rawData = toRaw(data);
  const w = getWorker();
  if (!w) { buildHere(rawData); return; }
  const onMessage = ({ data: msg }) => {
    if (msg?.id !== seq) return;
    w.removeEventListener('message', onMessage);
    if (seq !== buildSeq) return;   // (a newer terrain came meanwhile)
    if (msg.error) { console.warn('[Preview] OSM worker failed, building here:', msg.error); buildHere(rawData); return; }
    group.value = sceneFromDescription(msg.desc);
    applyVisibility();
  };
  w.addEventListener('message', onMessage);
  try {
    w.postMessage({ id: seq, terrain: workerTerrain(rawData), options: buildPreviewOptions(rawData) });
  } catch (error) {
    w.removeEventListener('message', onMessage);
    console.warn('[Preview] OSM worker unavailable, building here:', error);
    workerBroken = true;
    buildHere(rawData);
  }
};

watch(
  () => props.terrainData,
  (data) => rebuildGroup(data),
  { immediate: true }
);

watch(
  [
    () => props.featureVisibility?.buildings,
    () => props.featureVisibility?.vegetation,
    () => props.featureVisibility?.barriers,
  ],
  () => applyVisibility()
);

onUnmounted(() => {
  buildSeq++;
  worker?.terminate();
  worker = null;
  if (group.value) {
    disposeGroup(group.value);
    group.value = null;
  }
});
</script>

<template>
  <primitive v-if="group" :object="group" />
</template>
