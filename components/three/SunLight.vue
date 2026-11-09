<script setup>
// The preview's sun: one shadow-casting directional light whose shadow box
// follows what the camera looks at. Zoomed out it covers the whole map;
// zoomed in it shrinks round the orbit target, so close-ups get crisp
// shadows from a single shadow map. (Replaced the four-cascade CSM, which
// had to patch each material's shader: the buildings, trees and props never
// were, took all four cascades' sun at once and looked washed out, and the
// four shadow passes cost the most frame time and shader compiles.)
import { onUnmounted, watch } from 'vue';
import * as THREE from 'three';
import { useTresContext, useLoop } from '@tresjs/core';

const props = defineProps({
  // (the direction the light travels: from the sun down to the ground)
  lightDirection: { type: Array, default: () => [-1, -0.5, -0.65] },
  shadowMapSize: { type: Number, default: 4096 },
  lightIntensity: { type: Number, default: 3.5 },
  ambientIntensity: { type: Number, default: 0.1 },
  lightColor: { type: String, default: '#ffffff' },
  ambientColor: { type: String, default: '#ffffff' },
  // (scene units: the map is 100 across)
  maxHalfSize: { type: Number, default: 80 },
  minHalfSize: { type: Number, default: 4 },
});

const { scene, camera, renderer, controls } = useTresContext();

const light = new THREE.DirectionalLight(props.lightColor, props.lightIntensity);
light.name = 'mapng_sun';
light.castShadow = true;
light.shadow.mapSize.set(props.shadowMapSize, props.shadowMapSize);
light.shadow.camera.near = 1;
light.shadow.camera.far = 600;
light.shadow.bias = -0.0004;
scene.value?.add(light, light.target);

const dir = new THREE.Vector3();
const setDir = () => dir.set(...props.lightDirection).normalize();
setDir();

watch(renderer, (r) => {
  if (!r) return;
  r.shadowMap.enabled = true;
  r.shadowMap.type = THREE.PCFSoftShadowMap;
}, { immediate: true });
watch(() => props.lightDirection, setDir);
watch(() => props.lightColor, (c) => light.color.set(c));
watch(() => props.lightIntensity, (i) => { light.intensity = i; });
watch(() => props.shadowMapSize, (n) => {
  light.shadow.mapSize.set(n, n);
  light.shadow.map?.dispose(); light.shadow.map = null;
});

// (dev: the preview's scene and sun, for probes)
if (import.meta.env.DEV && typeof window !== 'undefined') {
  watch([scene, renderer, camera], () => { window.__mapngPreview = { light, scene: scene.value, renderer: renderer.value, camera: camera.value, controls }; }, { immediate: true });
}

const target = new THREE.Vector3();
const rot = new THREE.Matrix4();
const inv = new THREE.Matrix4();
const p = new THREE.Vector3();
const up = new THREE.Vector3(0, 1, 0);

const { onBeforeRender } = useLoop();
onBeforeRender(() => {
  const cam = camera.value;
  if (!cam) return;
  // what the camera looks at: the orbit target, else a point ahead of it
  const t = controls.value?.target;
  if (t) target.copy(t);
  else cam.getWorldDirection(target).multiplyScalar(60).add(cam.position);
  const dist = cam.position.distanceTo(target);
  // (the box: about what fills the view, in steps so zooming doesn't shimmer)
  const want = THREE.MathUtils.clamp(dist * 0.85, props.minHalfSize, props.maxHalfSize);
  const half = Math.min(props.maxHalfSize, props.minHalfSize * Math.pow(1.25, Math.ceil(Math.log(want / props.minHalfSize) / Math.log(1.25))));
  // (its middle snapped to whole shadow texels in the light's view: no crawling edges as the camera pans)
  const texel = (2 * half) / light.shadow.mapSize.x;
  rot.lookAt(new THREE.Vector3(0, 0, 0), dir, Math.abs(dir.y) > 0.99 ? new THREE.Vector3(0, 0, 1) : up);
  inv.copy(rot).invert();
  p.copy(target).applyMatrix4(inv);
  p.x = Math.round(p.x / texel) * texel; p.y = Math.round(p.y / texel) * texel;
  p.applyMatrix4(rot);
  light.target.position.copy(p);
  light.position.copy(p).addScaledVector(dir, -300);
  const sc = light.shadow.camera;
  if (sc.right !== half) {
    sc.left = -half; sc.right = half; sc.top = half; sc.bottom = -half;
    sc.updateProjectionMatrix();
  }
  // (offset along the surface normal by about a texel and a half: no acne on slopes, no floating shadows)
  light.shadow.normalBias = texel * 1.5;
  light.target.updateMatrixWorld();
});

watch(scene, (s, old) => {
  old?.remove(light, light.target);
  s?.add(light, light.target);
});

onUnmounted(() => {
  scene.value?.remove(light, light.target);
  light.shadow.map?.dispose();
  light.dispose();
});
</script>

<template>
  <TresAmbientLight :intensity="ambientIntensity" :color="ambientColor" />
</template>
