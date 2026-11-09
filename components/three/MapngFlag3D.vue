<script setup>
import { shallowRef, watch, toRaw, onUnmounted } from 'vue';
import * as THREE from 'three';
import JSZip from 'jszip';
import { ColladaLoader } from 'three/examples/jsm/loaders/ColladaLoader.js';
import { useTresContext, useLoop } from '@tresjs/core';
import { pickFlagCell } from '../../services/flagPlacement.js';

const props = defineProps({
  terrainData: { required: true },
});

const flagObject = shallowRef(null);
let placedOn = null;   // (the terrain geometry the flag was last stood on)

let cachedTemplate = null;
const SCENE_SIZE = 100;

function getUnitsPerMeter(terrainData) {
  const latRad = ((terrainData.bounds.north + terrainData.bounds.south) / 2) * Math.PI / 180;
  const metersPerDegree = 111320 * Math.cos(latRad);
  const realWidthMeters = (terrainData.bounds.east - terrainData.bounds.west) * metersPerDegree;
  return SCENE_SIZE / realWidthMeters;
}

// The flag's place across the map (services/flagPlacement.js: the summit,
// spikes and the map's edges left out); its height is the drawn terrain's
// under it (placeOnTerrain): the preview's mesh is decimated and smoothed,
// so a summit sample's own height floated over it.
function flagSpot(terrainData) {
  const { width, height } = terrainData;
  const cell = width && height ? pickFlagCell(terrainData) : null;
  if (!cell) return [0, 0];
  const u = width > 1 ? cell.col / (width - 1) : 0.5;
  const v = height > 1 ? cell.row / (height - 1) : 0.5;
  return [(u * SCENE_SIZE) - (SCENE_SIZE / 2), (v * SCENE_SIZE) - (SCENE_SIZE / 2)];
}

function disposeObject(root) {
  if (!root) return;
  root.traverse((child) => {
    if (child.isMesh) {
      if (child.geometry) child.geometry.dispose();
      const materials = Array.isArray(child.material) ? child.material : [child.material];
      materials.filter(Boolean).forEach((material) => {
        if (material.map) material.map.dispose();
        material.dispose?.();
      });
    }
  });
}

async function loadFlagTemplate() {
  if (cachedTemplate) return cachedTemplate;

  const response = await fetch('/mapng_flag_static.zip');
  if (!response.ok) throw new Error(`Failed to load MapNG flag asset: ${response.status}`);

  const archive = await JSZip.loadAsync(await response.arrayBuffer());
  const daeText = await archive.file('mapng/flagng.dae')?.async('string');
  const textureBlob = await archive.file('mapng/mapng_flag_d.png')?.async('blob');
  if (!daeText || !textureBlob) throw new Error('MapNG flag asset is missing required files');

  const textureUrl = URL.createObjectURL(textureBlob);
  cachedTemplate = {
    daeText,
    textureUrl,
  };
  return cachedTemplate;
}

watch(() => props.terrainData, async (data) => {
  if (flagObject.value) {
    disposeObject(flagObject.value);
    flagObject.value = null;
  }

  if (!data?.heightMap?.length) return;

  try {
    const rawData = toRaw(data);
    const template = await loadFlagTemplate();
    const loader = new ColladaLoader();
    const patchedDae = template.daeText.replace(/mapng_flag_d\.png/g, template.textureUrl);
    const collada = loader.parse(patchedDae, '');
    const texture = new THREE.TextureLoader().load(template.textureUrl);
    texture.flipY = false;
    texture.colorSpace = THREE.SRGBColorSpace;

    collada.scene.traverse((child) => {
      if (!child.isMesh) return;

      const materialName = child.material?.name || '';
      if (materialName === 'mapng_flag') {
        child.material = new THREE.MeshStandardMaterial({
          map: texture,
          side: THREE.DoubleSide,
          transparent: true,
          alphaTest: 0.1,
        });
        return;
      }

      child.material = new THREE.MeshStandardMaterial({
        color: materialName === 'lod_vertcol' ? '#b0b0b0' : '#8a8f96',
        metalness: materialName === 'metal_paint_peeling' ? 0.55 : 0.15,
        roughness: 0.7,
        vertexColors: materialName === 'lod_vertcol',
      });
    });

    const scene = collada.scene;
    const [x, z] = flagSpot(rawData);
    const unitsPerMeter = getUnitsPerMeter(rawData);
    scene.scale.setScalar(unitsPerMeter);
    scene.position.set(x, 0, z);
    scene.visible = false;   // (until it stands on the drawn terrain)
    placedOn = null;
    flagObject.value = scene;
  } catch (error) {
    console.warn('Failed to load MapNG flag for preview:', error);
  }
}, { immediate: true });

// stand the flag on the drawn terrain (TerrainMesh's height lookup for its
// geometry), again whenever the mesh is rebuilt (another quality, a new terrain)
const { scene: tresScene } = useTresContext();
function meshHeightAt(mesh, x, z) {
  const at = mesh.geometry?.userData?.heightAtScene;
  if (typeof at !== 'function') return null;
  const h = at(x - mesh.position.x, z - mesh.position.z);
  return Number.isFinite(h) ? h + mesh.position.y : null;
}
useLoop().onBeforeRender(() => {
  const flag = flagObject.value; const s = tresScene.value;
  if (!flag || !s) return;
  const terrain = s.getObjectByName('mapng_terrain');
  if (!terrain?.geometry || placedOn === terrain.geometry) return;
  const h = meshHeightAt(terrain, flag.position.x, flag.position.z);
  if (h == null) return;
  placedOn = terrain.geometry;
  // (its foot 10 cm into the ground)
  flag.position.y = h - 0.1 * flag.scale.x;
  flag.visible = true;
});

onUnmounted(() => {
  if (flagObject.value) {
    disposeObject(flagObject.value);
    flagObject.value = null;
  }
});
</script>

<template>
  <primitive v-if="flagObject" :object="flagObject" />
</template>
