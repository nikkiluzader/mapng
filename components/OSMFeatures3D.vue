<script setup>
import { shallowRef, watch, toRaw } from 'vue';
import { createOSMGroup } from '../services/export3d';

const props = defineProps({
  terrainData: { required: true },
  visible: { default: true, type: Boolean }
});

const group = shallowRef(null);

watch(() => props.terrainData, (data) => {
  if (group.value) {
    // Clean up old group geometries and materials
    group.value.traverse((child) => {
      if (child.isMesh) {
        child.geometry.dispose();
        if (Array.isArray(child.material)) {
          child.material.forEach(m => m.dispose());
        } else {
          child.material.dispose();
        }
      }
    });
  }

  if (data) {
    const rawData = toRaw(data);
    group.value = createOSMGroup(rawData);
  } else {
    group.value = null;
  }
}, { immediate: true });
</script>

<template>
  <primitive v-if="group && visible" :object="group" />
</template>
