<script setup>
import { watch, onUnmounted, shallowRef } from 'vue';
import * as THREE from 'three';
import { useTresContext, useLoop } from '@tresjs/core';
import { CSM } from 'three/examples/jsm/csm/CSM.js';

const props = defineProps({
  lightDirection: { type: Array, default: () => [-1, -0.5, -0.65] },
  cascades: { type: Number, default: 4 },
  shadowMapSize: { type: Number, default: 2048 },
  maxFar: { type: Number, default: 500 },
  lightIntensity: { type: Number, default: 3.5 },
  ambientIntensity: { type: Number, default: 0.1 },
  shadowBias: { type: Number, default: -0.0001 },
  lightMargin: { type: Number, default: 50 },
});

const { scene, camera, renderer } = useTresContext();

const csm = shallowRef(null);
const patchedMaterials = new WeakSet();

const setupCSM = () => {
  // Dispose existing CSM if any
  if (csm.value) {
    csm.value.dispose();
    csm.value = null;
  }

  const cam = camera.value;
  const scn = scene.value;
  if (!cam || !scn) return;

  // PCFShadowMap follows object silhouettes properly (BasicShadowMap produces blocky pixel shadows)
  const rend = renderer.value;
  if (rend) {
    rend.shadowMap.type = THREE.PCFShadowMap;
  }

  const instance = new CSM({
    camera: cam,
    parent: scn,
    cascades: props.cascades,
    maxFar: props.maxFar,
    mode: 'practical',
    shadowMapSize: props.shadowMapSize,
    shadowBias: props.shadowBias,
    lightDirection: new THREE.Vector3(...props.lightDirection).normalize(),
    lightIntensity: props.lightIntensity,
    lightNear: 0.1,
    lightFar: 1000,
    lightMargin: props.lightMargin,
  });

  // Enable fade for smooth transitions between cascades
  instance.fade = true;

  csm.value = instance;
};

// Traverse scene and patch any unpatched materials for CSM
const patchMaterials = () => {
  const csmInstance = csm.value;
  const scn = scene.value;
  if (!csmInstance || !scn) return;

  scn.traverse((child) => {
    if (!child.isMesh || !child.material) return;

    const materials = Array.isArray(child.material)
      ? child.material
      : [child.material];

    for (const mat of materials) {
      if (!patchedMaterials.has(mat)) {
        csmInstance.setupMaterial(mat);
        patchedMaterials.add(mat);
      }
    }
  });
};

// Set up CSM when camera becomes available
watch(
  () => camera.value,
  (cam) => {
    if (cam) setupCSM();
  },
  { immediate: true }
);

// Update light direction reactively
watch(
  () => props.lightDirection,
  (dir) => {
    if (csm.value && dir) {
      csm.value.lightDirection = new THREE.Vector3(...dir).normalize();
    }
  }
);

// Hook into TresJS render loop
const { onBeforeRender } = useLoop();

onBeforeRender(() => {
  if (csm.value) {
    patchMaterials();
    csm.value.update();
  }
});

onUnmounted(() => {
  if (csm.value) {
    csm.value.dispose();
    csm.value = null;
  }
});
</script>

<template>
  <!-- CSM manages its own DirectionalLights internally -->
  <TresAmbientLight :intensity="ambientIntensity" />
</template>
