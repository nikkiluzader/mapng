<script setup>
// The preview's air: distance haze in the sky's horizon colour (the far
// backdrop and the sea fade into the sky instead of ending at a hard line),
// and a sky/ground fill light (shade takes the sky's blue from above and the
// ground's warmth from below, as outdoors, instead of going black).
import { onUnmounted, watch } from 'vue';
import * as THREE from 'three';
import { useTresContext } from '@tresjs/core';

const props = defineProps({
  horizon: { type: String, default: '#b9cbe0' },
  skyColor: { type: String, default: '#cfe2ff' },
  groundColor: { type: String, default: '#6b5a44' },
  fill: { type: Number, default: 0.55 },
  // (scene units: the map is 100 across)
  fogNear: { type: Number, default: 180 },
  fogFar: { type: Number, default: 1500 },
});

const { scene } = useTresContext();
let hemi = null;

function apply() {
  const s = scene.value;
  if (!s) return;
  s.fog = new THREE.Fog(new THREE.Color(props.horizon), props.fogNear, props.fogFar);
  if (!hemi) { hemi = new THREE.HemisphereLight(); hemi.name = 'mapng_sky_fill'; s.add(hemi); }
  hemi.color.set(props.skyColor);
  hemi.groundColor.set(props.groundColor);
  hemi.intensity = props.fill;
}

watch([scene, () => props.horizon, () => props.skyColor, () => props.groundColor, () => props.fill, () => props.fogNear, () => props.fogFar], apply, { immediate: true });

onUnmounted(() => {
  const s = scene.value;
  if (s) { s.fog = null; if (hemi) s.remove(hemi); }
  hemi?.dispose?.();
  hemi = null;
});
</script>

<template>
  <!-- (sets the scene's fog and adds its fill light) -->
</template>
