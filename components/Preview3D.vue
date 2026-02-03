<template>
  <div class="w-full h-full bg-black relative group">
    <TresCanvas window-size clear-color="#000000">
      <TresPerspectiveCamera :args="cameraArgs" :position="cameraPosition" />
      <TresAmbientLight :intensity="0.5" />
      <TresDirectionalLight :position="[50, 50, 25]" :intensity="1" :cast-shadow="true" />
      
      <Suspense>
        <Environment :preset="preset" :background="true" />
      </Suspense>
      
      <TerrainMesh 
        :terrain-data="terrainData" 
        :quality="quality" 
        :texture-type="textureType"
        :wireframe="showWireframe"
      />
      
      <OrbitControls 
        make-default
        :enable-damping="true" 
        :damping-factor="0.1" 
        :max-polar-angle="Math.PI / 2 - 0.05"
        :min-distance="10"
        :max-distance="250"
      />
    </TresCanvas>

    <SceneSettingsPanel
      v-model:quality="quality"
      v-model:preset="preset"
      v-model:texture-type="textureType"
      v-model:show-wireframe="showWireframe"
      :presets="presets"
      :osm-available="!!terrainData.osmTextureUrl"
      :hybrid-available="!!terrainData.hybridTextureUrl"
    />
  </div>
</template>

<script setup>
import { ref } from 'vue';
import { TresCanvas } from '@tresjs/core';
import { OrbitControls, Environment } from '@tresjs/cientos';
import TerrainMesh from './TerrainMesh.vue';
import SceneSettingsPanel from './SceneSettingsPanel.vue';

defineProps(['terrainData']);

const quality = ref('high');

const preset = ref('dawn');
const textureType = ref('satellite');
const showWireframe = ref(false);
const presets = ['city', 'dawn', 'sunset', 'night', 'forest', 'studio', 'umbrellas', 'snow', 'hangar', 'urban', 'modern', 'shangai'];

// Static camera config to prevent re-renders resetting position
const cameraPosition = [0, 60, 90];
const cameraArgs = [40, 1, 0.1, 1000];
</script>
