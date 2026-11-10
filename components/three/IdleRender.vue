<script setup>
// Visual quality "Standard": Tres's own render, but only on the frames worth
// drawing (useIdleRender.js). "Cinematic" does the same inside PostFX.vue.
import { onUnmounted } from 'vue';
import { useTresContext, useLoop } from '@tresjs/core';
import { useIdleRender } from './useIdleRender.js';

const { renderer, sizes } = useTresContext();
const { shouldDraw } = useIdleRender(renderer, () => [sizes.width.value, sizes.height.value]);
const registration = useLoop().render(({ renderer: r, scene: s, camera: cam }) => {
  if (r && s && cam && shouldDraw(cam)) r.render(s, cam);
});
onUnmounted(() => { registration?.off?.(); });
</script>

<template>
  <!-- nothing drawn itself: it renders the scene -->
</template>
