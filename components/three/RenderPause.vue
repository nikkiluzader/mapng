<!-- Inside the 3D canvas: stops the draw loop while a Generate or an export runs (services/heavyJob.js),
     and starts it again after. -->
<script setup>
import { watch, onBeforeUnmount } from 'vue';
import { useLoop } from '@tresjs/core';
import { heavyJobRunning } from '../../services/heavyJob.js';

// (pause() stops only the animations; pauseRender() is what stops the frame being drawn)
const { pause, resume, pauseRender, resumeRender } = useLoop();
watch(heavyJobRunning, (running) => { if (running) { pause(); pauseRender(); } else { resumeRender(); resume(); } }, { immediate: true });
onBeforeUnmount(() => { resumeRender(); resume(); });
</script>

<template><TresGroup /></template>
