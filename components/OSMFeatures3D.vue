<script setup>
import { shallowRef, watch, toRaw } from 'vue';
import { createOSMGroup } from '../services/export3d';

const props = defineProps({
  terrainData: { required: true },
  featureVisibility: { 
    type: Object, 
    default: () => ({ buildings: true, water: true, vegetation: true, barriers: true }) 
  }
});

const group = shallowRef(null);

const updateVisibility = () => {
  if (group.value && props.featureVisibility) {
    group.value.traverse((child) => {
      if (child.isMesh && child.name && props.featureVisibility[child.name] !== undefined) {
        child.visible = props.featureVisibility[child.name];
      }
    });
  }
};

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
    updateVisibility();
  } else {
    group.value = null;
  }
}, { immediate: true });

watch(() => props.featureVisibility, updateVisibility, { deep: true });
</script>

<template>
  <primitive v-if="group" :object="group" />
</template>
