<template>
  <div class="w-full h-full bg-black relative group">
    <TresCanvas window-size clear-color="#000000">
      <TresPerspectiveCamera :args="cameraArgs" :position="cameraPosition" />
      <TresAmbientLight :intensity="0.5" />
      <TresDirectionalLight :position="[50, 50, 25]" :intensity="1" :cast-shadow="true" />
      
      <Environment :preset="preset" :background="true" />
      
      <TerrainMesh :terrain-data="terrainData" :quality="quality" />
      
      <OSMFeatures 
        v-if="terrainData.osmFeatures && terrainData.osmFeatures.length > 0" 
        :terrain-data="terrainData" 
        :show-areas="showAreas"
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

    <!-- Scene Controls Overlay -->
    <div class="absolute top-4 left-4 z-30 bg-white/90 backdrop-blur-md border border-gray-200 rounded-lg p-4 w-64 shadow-2xl transition-opacity opacity-0 group-hover:opacity-100">
       <div class="flex items-center gap-2 text-gray-900 mb-3 border-b border-gray-200 pb-2">
          <Settings :size="16" class="text-[#FF6600]" />
          <span class="text-sm font-bold">Scene Settings</span>
       </div>

       <!-- Quality Selector -->
       <div class="mb-4 space-y-2">
          <label class="text-xs text-gray-500 flex items-center gap-1">
              <Gauge :size="12" /> Mesh Quality
          </label>
          <div class="flex bg-gray-100 rounded-md p-1 border border-gray-200">
              <button
                  v-for="q in (['low', 'medium', 'high'] as Quality[])"
                  :key="q"
                  @click="quality = q"
                  :class="['flex-1 text-xs py-1.5 rounded capitalize transition-colors',
                      quality === q 
                      ? 'bg-[#FF6600] text-white shadow-sm font-medium' 
                      : 'text-gray-500 hover:text-gray-900 hover:bg-white']"
              >
                  {{ q }}
              </button>
          </div>
          <p class="text-[10px] text-gray-400 text-right">
              {{ quality === 'low' ? 'Low poly' : quality === 'medium' ? 'Balanced' : 'Max Safe Detail' }}
          </p>
       </div>

       <!-- Environment Selector -->
       <div class="space-y-2 mb-4">
          <label class="text-xs text-gray-500 flex items-center gap-1">
              <Settings :size="12" /> Environment
          </label>
          <select
              v-model="preset"
              class="w-full appearance-none bg-white border border-gray-200 text-gray-900 text-xs rounded py-2 px-3 focus:ring-1 focus:ring-[#FF6600] outline-none capitalize cursor-pointer hover:bg-gray-50"
          >
              <option v-for="p in presets" :key="p" :value="p">{{ p }}</option>
          </select>
       </div>

       <!-- Overlays -->
       <div class="space-y-2">
          <label class="text-xs text-gray-500 flex items-center gap-1">
              <Layers :size="12" /> Overlays
          </label>
          <label class="flex items-center gap-2 cursor-pointer group/check">
              <div class="relative">
                  <input type="checkbox" v-model="showAreas" class="peer sr-only" />
                  <div class="w-9 h-5 bg-gray-200 peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-[#FF6600]/20 rounded-full peer peer-checked:after:translate-x-full rtl:peer-checked:after:-translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:start-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-[#FF6600]"></div>
              </div>
              <span class="text-xs text-gray-700 group-hover/check:text-gray-900">Ground Materials</span>
          </label>
       </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import { TresCanvas } from '@tresjs/core';
import { OrbitControls, Environment } from '@tresjs/cientos';
import { Settings, Gauge, Layers } from 'lucide-vue-next';
import { TerrainData } from '../types';
import TerrainMesh from './TerrainMesh.vue';
import OSMFeatures from './OSMFeatures.vue';

type Quality = 'low' | 'medium' | 'high';
type Preset = 'sunset' | 'dawn' | 'night' | 'forest' | 'studio' | 'city' | 'umbrellas' | 'snow' | 'hangar' | 'urban' | 'modern' | 'shangai';

interface Props {
  terrainData: TerrainData;
}

defineProps<Props>();

const quality = ref<Quality>('high');
const preset = ref<Preset>('dawn');
const showAreas = ref(false);
const presets: Preset[] = ['city', 'dawn', 'sunset', 'night', 'forest', 'studio', 'umbrellas', 'snow', 'hangar', 'urban', 'modern', 'shangai'];

// Static camera config to prevent re-renders resetting position
const cameraPosition: [number, number, number] = [0, 60, 90];
const cameraArgs: [number, number, number, number] = [40, 1, 0.1, 1000];
</script>
