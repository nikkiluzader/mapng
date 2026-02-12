<script setup>
import { shallowRef, watch, toRaw, onUnmounted } from 'vue';
import { createOSMGroup } from '../services/export3d';

const props = defineProps({
  terrainData: { required: true },
  featureVisibility: { 
    type: Object, 
    default: () => ({ buildings: true, vegetation: true, barriers: true }) 
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

watch(() => props.terrainData, (data) => {
  if (group.value) {
    disposeGroup(group.value);
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

onUnmounted(() => {
  if (group.value) {
    disposeGroup(group.value);
    group.value = null;
  }
});
</script>

<template>
  <primitive v-if="group" :object="group" />
</template>
