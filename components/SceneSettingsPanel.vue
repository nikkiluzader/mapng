<template>
  <div class="absolute top-4 left-4 z-30 bg-white/90 dark:bg-gray-900/90 backdrop-blur-md border border-gray-200 dark:border-gray-700 rounded-lg p-4 w-64 shadow-2xl transition-opacity opacity-0 group-hover:opacity-100">
    <div class="flex items-center gap-2 text-gray-900 dark:text-white mb-3 border-b border-gray-200 dark:border-gray-700 pb-2">
      <Settings :size="16" class="text-[#FF6600]" />
      <span class="text-sm font-bold">Scene Settings</span>
    </div>

    <!-- Quality Selector -->
    <div class="mb-4 space-y-2">
      <label class="text-xs text-gray-500 dark:text-gray-400 flex items-center gap-1">
        <Gauge :size="12" /> Mesh Quality
      </label>
      <div class="flex bg-gray-100 dark:bg-gray-800 rounded-md p-1 border border-gray-200 dark:border-gray-700">
        <button
          v-for="q in ['low', 'medium', 'high']"
          :key="q"
          @click="$emit('update:quality', q)"
          class="flex-1 text-xs py-1.5 rounded capitalize transition-colors"
          :class="quality === q ? 'bg-[#FF6600] text-white shadow-sm font-medium' : 'text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white hover:bg-white dark:hover:bg-gray-700'"
        >
          {{ q }}
        </button>
      </div>
      <p class="text-[10px] text-gray-400 dark:text-gray-500 text-right">
        {{ quality === 'low' ? 'Low poly' : quality === 'medium' ? 'Balanced' : 'Max Safe Detail' }}
      </p>
    </div>

    <!-- Environment Selector -->
    <div class="space-y-2 mb-4">
      <label class="text-xs text-gray-500 dark:text-gray-400 flex items-center gap-1">
        <Sun :size="12" /> Environment
      </label>
      <select
        :value="preset"
        @change="$emit('update:preset', $event.target.value)"
        class="w-full appearance-none bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-gray-900 dark:text-white text-xs rounded py-2 px-3 focus:ring-1 focus:ring-[#FF6600] outline-none capitalize cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-700"
      >
        <option v-for="p in presets" :key="p" :value="p">{{ p }}</option>
      </select>
    </div>

    <!-- Overlays -->
    <div class="space-y-2">
      <label class="text-xs text-gray-500 dark:text-gray-400 flex items-center gap-1">
        <Layers :size="12" /> Texture Mode
      </label>

      <div class="flex bg-gray-100 dark:bg-gray-800 rounded-md p-1 border border-gray-200 dark:border-gray-700 mb-2">
        <button
          @click="$emit('update:textureType', 'satellite')"
          class="flex-1 text-xs py-1.5 rounded transition-colors"
          :class="textureType === 'satellite' ? 'bg-[#FF6600] text-white shadow-sm font-medium' : 'text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white hover:bg-white dark:hover:bg-gray-700'"
        >
          Satellite
        </button>
        <button
          @click="$emit('update:textureType', 'osm')"
          :disabled="!osmAvailable"
          :title="!osmAvailable ? 'No OSM data available' : 'Show OSM Layer'"
          class="flex-1 text-xs py-1.5 rounded transition-colors"
          :class="textureType === 'osm' ? 'bg-[#FF6600] text-white shadow-sm font-medium' : !osmAvailable ? 'text-gray-300 dark:text-gray-600 cursor-not-allowed' : 'text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white hover:bg-white dark:hover:bg-gray-700'"
        >
          OSM
        </button>
        <button
          @click="$emit('update:textureType', 'hybrid')"
          :disabled="!hybridAvailable"
          :title="!hybridAvailable ? 'No Hybrid data available' : 'Show Hybrid Layer'"
          class="flex-1 text-xs py-1.5 rounded transition-colors"
          :class="textureType === 'hybrid' ? 'bg-[#FF6600] text-white shadow-sm font-medium' : !hybridAvailable ? 'text-gray-300 dark:text-gray-600 cursor-not-allowed' : 'text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white hover:bg-white dark:hover:bg-gray-700'"
        >
          Hybrid
        </button>
        <button
          @click="$emit('update:textureType', 'none')"
          class="flex-1 text-xs py-1.5 rounded transition-colors"
          :class="textureType === 'none' ? 'bg-[#FF6600] text-white shadow-sm font-medium' : 'text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white hover:bg-white dark:hover:bg-gray-700'"
        >
          None
        </button>
      </div>

      <!-- Wireframe Toggle -->
      <label class="flex items-center gap-2 cursor-pointer group/check">
        <div class="relative">
          <input 
            type="checkbox" 
            :checked="showWireframe"
            @change="$emit('update:showWireframe', $event.target.checked)"
            class="peer sr-only" 
          />
          <div class="w-9 h-5 bg-gray-200 dark:bg-gray-700 peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-[#FF6600]/20 rounded-full peer peer-checked:after:translate-x-full rtl:peer-checked:after:-translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:start-[2px] after:bg-white after:border-gray-300 dark:after:border-gray-600 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-[#FF6600]"></div>
        </div>
        <span class="text-xs text-gray-700 dark:text-gray-300 group-hover/check:text-gray-900 dark:group-hover/check:text-white">Wireframe Mode</span>
      </label>
    </div>
  </div>
</template>

<script setup>
import { Settings, Gauge, Layers, Sun } from 'lucide-vue-next';

defineProps({
  quality: String,
  preset: String,
  presets: Array,
  textureType: String,
  showWireframe: Boolean,
  osmAvailable: Boolean,
  hybridAvailable: Boolean
});

defineEmits(['update:quality', 'update:preset', 'update:textureType', 'update:showWireframe']);
</script>
