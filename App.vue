<template>
  <!-- Mobile Restriction Overlay -->
  <div class="flex md:hidden fixed inset-0 z-[999] bg-white dark:bg-gray-900 flex-col items-center justify-center p-8 text-center text-gray-900 dark:text-white">
    <div class="bg-gray-50 dark:bg-gray-800 p-6 rounded-2xl border border-gray-200 dark:border-gray-700 shadow-2xl max-w-sm flex flex-col items-center">
      <div class="p-4 bg-[#FF6600]/10 rounded-full mb-6">
        <Monitor :size="48" class="text-[#FF6600]" />
      </div>
      <h1 class="text-2xl font-bold text-gray-900 dark:text-white mb-2">Desktop Required</h1>
      <p class="text-gray-600 dark:text-gray-300 text-sm leading-relaxed mb-6">
        MapNG is a high-performance terrain generation tool designed for BeamNG modding.
      </p>
      <p class="text-gray-500 dark:text-gray-400 text-xs mb-6">
        To ensure the best experience with 3D rendering, precise map selection, and file management, please access this application on a desktop or laptop computer.
      </p>
      <div class="flex items-center gap-2 text-xs font-medium text-[#FF6600] bg-[#FF6600]/10 px-4 py-2 rounded-full border border-[#FF6600]/20">
        <MousePointer2 :size="12" />
        <span>Mouse & Keyboard Recommended</span>
      </div>
    </div>
  </div>

  <!-- Main Application - Hidden on Mobile -->
  <div class="hidden md:flex h-screen w-full flex-col md:flex-row overflow-hidden bg-white dark:bg-gray-900 text-gray-900 dark:text-white">
    <!-- Sidebar / Control Panel -->
    <aside class="w-full md:w-80 lg:w-96 flex-shrink-0 flex flex-col border-r border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 z-10 relative shadow-xl">
      <div class="p-5 border-b border-gray-200 dark:border-gray-700 flex items-center gap-3 bg-white dark:bg-gray-900">
        <div class="p-1.5 bg-[#FF6600] rounded-lg">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" class="w-7 h-7">
            <g fill="white" opacity="0.95">
              <polygon points="15,75 35,35 55,75"/>
              <polygon points="40,75 60,25 85,75"/>
              <line x1="10" y1="80" x2="90" y2="80" stroke="white" stroke-width="2" opacity="0.5"/>
              <line x1="10" y1="85" x2="90" y2="85" stroke="white" stroke-width="1.5" opacity="0.3"/>
            </g>
          </svg>
        </div>
        <div>
          <h1 class="text-xl font-bold tracking-tight text-gray-900 dark:text-white">MapNG</h1>
          <p class="text-xs text-gray-500 dark:text-gray-400">BeamNG Terrain Generator</p>
        </div>
        <button 
          @click="showAbout = true"
          class="ml-auto text-gray-400 hover:text-[#FF6600] transition-colors p-1 rounded-full hover:bg-orange-50 dark:hover:bg-gray-800"
          title="What is this?"
        >
          <CircleHelp :size="20" />
        </button>
      </div>
      
      <!-- Mode Toggle -->
      <div class="flex p-2 border-b border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 gap-1">
        <button
          @click="batchMode = false"
          :class="['flex-1 py-1.5 text-xs font-medium rounded-md flex items-center justify-center gap-1.5 transition-all',
            !batchMode ? 'bg-gray-800 dark:bg-gray-100 text-white dark:text-gray-900 shadow-sm' : 'text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white hover:bg-gray-100 dark:hover:bg-gray-800']"
        >
          <Map :size="12" />
          Single Tile
        </button>
        <button
          @click="batchMode = true"
          :class="['flex-1 py-1.5 text-xs font-medium rounded-md flex items-center justify-center gap-1.5 transition-all',
            batchMode ? 'bg-[#FF6600] text-white shadow-sm' : 'text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white hover:bg-gray-100 dark:hover:bg-gray-800']"
        >
          <Grid3X3 :size="12" />
          Batch Job
          <span class="text-[8px] uppercase tracking-wider opacity-75 bg-white/20 px-1 rounded">Beta</span>
        </button>
      </div>

      <div class="flex-1 overflow-y-auto custom-scrollbar p-5 bg-gray-50/50 dark:bg-gray-800/50">
        <!-- Single mode -->
        <ControlPanel 
          v-if="!batchMode"
          :center="center" 
          :resolution="resolution"
          :terrain-data="terrainData"
          :is-generating="isLoading"
          :generation-cache-key="lastGenerationKey"
          @location-change="handleLocationChange"
          @resolution-change="setResolution"
          @generate="handleGenerate"
          @fetch-osm="handleFetchOSM"
          @surrounding-tiles-change="(v) => surroundingTilePositions = v"
        />

        <!-- Batch mode -->
        <BatchControlPanel
          v-if="batchMode"
          :center="center"
          :resolution="resolution"
          :is-running="batchRunning"
          :saved-state="savedBatchState"
          @location-change="handleLocationChange"
          @resolution-change="setResolution"
          @start-batch="handleStartBatch"
          @resume-batch="handleResumeBatch"
          @clear-saved-batch="handleClearSavedBatch"
          @update:grid-cols="(v) => batchGridCols = v"
          @update:grid-rows="(v) => batchGridRows = v"
        />
      </div>
      
      <div class="p-4 border-t border-gray-200 dark:border-gray-700 text-xs text-gray-500 dark:text-gray-400 text-center bg-white dark:bg-gray-900 space-y-3">
         <div class="flex items-center justify-between px-2">
            <button 
              @click="showDisclaimer = true"
              class="font-medium hover:text-[#FF6600] transition-colors"
            >
              Disclaimer
            </button>
            <button 
              @click="toggleDarkMode"
              class="p-1.5 rounded-full bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors"
              :title="isDarkMode ? 'Switch to Light Mode' : 'Switch to Dark Mode'"
            >
              <Sun v-if="isDarkMode" :size="14" />
              <Moon v-else :size="14" />
            </button>
         </div>
         
         <a href="mailto:nikkiluzader@gmail.com" class="text-[#FF6600] hover:text-[#E65C00] transition-colors block">
           Contact: nikkiluzader@gmail.com
         </a>
         
         <button 
           @click="showStackInfo = true"
           class="text-gray-600 dark:text-gray-400 hover:text-[#FF6600] dark:hover:text-[#FF6600] transition-colors flex items-center justify-center gap-1 w-full pt-3 border-t border-gray-100 dark:border-gray-800"
         >
           <Code :size="12" /> View Tech Stack
         </button>
         <span class="text-[10px] text-gray-400 dark:text-gray-500">Build {{ buildHash }} · {{ buildTime }}</span>
      </div>
    </aside>

    <!-- Main Content Area -->
    <main class="flex-1 relative flex flex-col h-full bg-gray-100 dark:bg-gray-950">
      <!-- Toggle View Tabs -->
      <div class="absolute top-4 right-4 z-20 flex bg-white/90 dark:bg-gray-800/90 backdrop-blur rounded-lg p-1 shadow-xl border border-gray-200 dark:border-gray-700">
        <button
          @click="switchTo2D"
          :class="['px-4 py-2 rounded-md text-sm font-medium transition-all flex items-center gap-2',
            !previewMode ? 'bg-gray-800 dark:bg-gray-100 text-white dark:text-gray-900 shadow-sm' : 'text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white']"
        >
          <Globe :size="16" />
          2D Map
        </button>
        <button
          @click="previewMode = true"
          :disabled="!terrainData"
          :class="['px-4 py-2 rounded-md text-sm font-medium transition-all flex items-center gap-2',
            previewMode ? 'bg-[#FF6600] text-white shadow-sm' : 'text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white',
            !terrainData ? 'opacity-50 cursor-not-allowed' : '']"
        >
          <Layers :size="16" />
          3D Preview
        </button>
      </div>

      <!-- Views -->
      <div class="flex-1 relative w-full h-full">
        <!-- Map View -->
        <div :class="['absolute inset-0 transition-all duration-500', previewMode ? 'opacity-0 invisible' : 'opacity-100 visible']">
          <MapSelector 
            :center="center" 
            :zoom="zoom" 
            :resolution="resolution"
            :is-dark-mode="isDarkMode"
            :surrounding-tile-positions="surroundingTilePositions"
            :batch-grid="batchGridTiles"
            @move="setCenter" 
            @zoom="setZoom"
          />
        </div>
        
        <!-- 3D Preview View -->
        <div :class="['absolute inset-0 transition-all duration-500 bg-black', previewMode ? 'opacity-100 visible' : 'opacity-0 invisible pointer-events-none']">
          <Suspense>
            <template #default>
              <Preview3D 
                v-if="terrainData && previewMode"
                :terrain-data="terrainData" 
                @update-textures="handleUpdateTextures"
              />
            </template>
            <template #fallback>
              <div class="w-full h-full flex items-center justify-center text-white flex-col gap-4">
                <Loader2 class="animate-spin text-[#FF6600]" :size="48" />
                <div class="text-lg font-medium text-white">Loading 3D Scene...</div>
              </div>
            </template>
          </Suspense>
        </div>
        
        <!-- Loading Overlay -->
        <div v-if="isLoading" class="absolute inset-0 z-50 flex items-center justify-center bg-white/80 dark:bg-gray-950/80 backdrop-blur-sm">
          <div class="text-center p-8 rounded-2xl bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 shadow-2xl min-w-[300px]">
            <Loader2 :size="48" class="text-[#FF6600] animate-spin mx-auto mb-4" />
            <h3 class="text-xl text-gray-900 dark:text-white font-bold mb-2">Processing Terrain</h3>
            <p class="text-gray-600 dark:text-gray-400 text-sm font-medium mb-4 animate-pulse">{{ loadingStatus }}</p>
            <div class="text-xs text-gray-400 dark:text-gray-500 max-w-xs mx-auto">
                <span v-if="resolution >= 2048">High resolution (2048+) may take 1-2 minutes.</span>
                <span v-if="resolution >= 4096" class="block text-amber-500 mt-1">Very large area (4k/8k). Please wait...</span>
            </div>
            <button
              @click="cancelGeneration"
              class="mt-5 px-6 py-2 text-sm font-medium text-gray-600 dark:text-gray-300 bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 rounded-lg transition-colors border border-gray-300 dark:border-gray-600"
            >
              Cancel
            </button>
          </div>
        </div>
      </div>
    </main>

    <!-- Batch Progress Modal -->
    <BatchProgressModal
      v-if="showBatchProgress && batchState"
      :state="batchState"
      :current-step="batchCurrentStep"
      @close="handleBatchProgressClose"
      @cancel="handleBatchCancel"
      @resume="handleResumeBatch"
      @retry-failed="handleRetryFailed"
    />

    <!-- About Modal -->
  <div v-if="showAbout" class="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm" @click.self="showAbout = false">
    <div class="bg-white dark:bg-gray-900 rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-hidden flex flex-col">
      <div class="p-6 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between bg-gray-50 dark:bg-gray-800">
        <div class="flex items-center gap-3">
          <div class="p-2 bg-[#FF6600] rounded-lg shadow-sm">
            <Layers :size="20" class="text-white" />
          </div>
          <div>
            <h2 class="text-lg font-bold text-gray-900 dark:text-white">About MapNG</h2>
            <p class="text-xs text-gray-500 dark:text-gray-400">BeamNG.drive Terrain Generator</p>
          </div>
        </div>
        <button @click="showAbout = false" class="text-gray-400 dark:text-gray-500 hover:text-gray-900 dark:hover:text-white transition-colors">
          <X :size="20" />
        </button>
      </div>
      
      <div class="p-6 overflow-y-auto custom-scrollbar space-y-6 text-sm text-gray-600 dark:text-gray-300 leading-relaxed">
        <div class="bg-orange-50 dark:bg-orange-900/20 border border-orange-100 dark:border-orange-900/30 rounded-lg p-4 text-orange-900 dark:text-orange-100">
          <p class="font-medium">MapNG is a specialized web application that converts real-world geographic data into game-engine-ready terrain assets for BeamNG.drive modding.</p>
        </div>

        <div class="space-y-4">
          <h3 class="font-bold text-gray-900 dark:text-white flex items-center gap-2">
            <Globe :size="16" class="text-[#FF6600]" />
            What does it do?
          </h3>
          <p>
            Select any location on Earth, configure your terrain settings, and MapNG will generate high-precision heightmaps, detailed textures, and full 3D models ready for game engine import — all at a consistent 1 meter per pixel scale. The app features an interactive 3D preview with HDR lighting, cascaded shadow maps, and procedurally generated 3D buildings, trees, and road networks rendered directly from OpenStreetMap data. For large-scale projects, Batch Job mode can process entire grids of tiles automatically.
          </p>
        </div>

        <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div class="space-y-2">
            <h4 class="font-bold text-gray-900 dark:text-white text-xs uppercase tracking-wider">Elevation Sources</h4>
            <ul class="space-y-2 list-disc list-inside marker:text-[#FF6600]">
              <li>Standard 30m Global (AWS Terrarium/SRTM)</li>
              <li>USGS 1m DEM (USA — CONUS, Alaska, Hawaii)</li>
              <li>GPXZ Premium High-Res (Global, concurrent requests for paid plans)</li>
            </ul>
          </div>
          <div class="space-y-2">
            <h4 class="font-bold text-gray-900 dark:text-white text-xs uppercase tracking-wider">3D Preview</h4>
            <ul class="space-y-2 list-disc list-inside marker:text-[#FF6600]">
              <li>HDR environment lighting &amp; CSM shadows</li>
              <li>Satellite, OSM, Hybrid &amp; bare texture modes</li>
              <li>3D buildings, trees, bushes &amp; barriers</li>
              <li>Surrounding terrain tiles (8 directions)</li>
              <li>Quality &amp; wireframe controls</li>
            </ul>
          </div>
        </div>

        <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div class="space-y-2">
            <h4 class="font-bold text-gray-900 dark:text-white text-xs uppercase tracking-wider">Export Formats (9 Types)</h4>
            <ul class="space-y-2 list-disc list-inside marker:text-[#FF6600]">
              <li>16-bit PNG Heightmap</li>
              <li>Satellite Texture (JPG)</li>
              <li>16K OSM "Blueprint" Texture (PNG)</li>
              <li>Hybrid Satellite + Roads Texture (PNG)</li>
              <li>Road Mask (16-bit PNG)</li>
              <li>GeoTIFF (WGS84 or source CRS)</li>
              <li>GeoJSON Vector Data</li>
              <li>GLB 3D Model (+ optional surroundings)</li>
              <li>Collada DAE (+ optional surroundings)</li>
            </ul>
          </div>
          <div class="space-y-2">
            <h4 class="font-bold text-gray-900 dark:text-white text-xs uppercase tracking-wider">OSM Texture Features</h4>
            <ul class="space-y-2 list-disc list-inside marker:text-[#FF6600]">
              <li>40+ land-use color categories</li>
              <li>Lane-accurate road rendering with markings</li>
              <li>Junction fills with Bézier-curved corners</li>
              <li>Crosswalk detection &amp; zebra stripes</li>
              <li>Chaikin's algorithm for smooth curves</li>
              <li>Customizable OSM background color</li>
            </ul>
          </div>
        </div>

        <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div class="space-y-2">
            <h4 class="font-bold text-gray-900 dark:text-white text-xs uppercase tracking-wider">Surrounding Tiles</h4>
            <p class="text-xs bg-gray-100 dark:bg-gray-800 p-3 rounded border border-gray-200 dark:border-gray-700">
              Download up to 8 adjacent terrain tiles as a ZIP package with heightmaps, satellite textures, and metadata — perfect for building multi-tile BeamNG worlds.
            </p>
          </div>
          <div class="space-y-2">
             <h4 class="font-bold text-gray-900 dark:text-white text-xs uppercase tracking-wider">Resolution Note</h4>
             <p class="text-xs bg-gray-100 dark:bg-gray-800 p-3 rounded border border-gray-200 dark:border-gray-700">
                <strong>All heightmaps are exported at 1 meter per pixel.</strong><br/>
                Output sizes range from 512px to 8192px (0.26 km² to 67 km²). Standard 30m data is bilinearly upsampled for smooth surfaces.
             </p>
          </div>
        </div>

        <div class="space-y-2">
          <h4 class="font-bold text-gray-900 dark:text-white text-xs uppercase tracking-wider flex items-center gap-2">
            <Grid3X3 :size="14" class="text-[#FF6600]" />
            Batch Job Mode
            <span class="text-[8px] uppercase tracking-wider bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400 px-1.5 py-0.5 rounded font-bold">Beta</span>
          </h4>
          <p class="text-xs bg-gray-100 dark:bg-gray-800 p-3 rounded border border-gray-200 dark:border-gray-700">
            Process large areas by defining a grid of tiles (up to 20×20). Each tile is generated sequentially with all selected exports packaged into individual ZIP files. Features include:
          </p>
          <ul class="space-y-1 list-disc list-inside marker:text-[#FF6600] text-xs">
            <li>Configurable grid dimensions, resolution, and export selections</li>
            <li>Live progress tracking with color-coded tile grid and satellite thumbnails</li>
            <li>Persistent state — pause, resume, and retry failed tiles</li>
            <li>Automatic memory cleanup between tiles for stability</li>
            <li>GPXZ concurrent requests for paid plans (up to 20× parallel)</li>
            <li>Per-tile coordinate-stamped filenames for easy organization</li>
          </ul>
        </div>

        <div class="space-y-2">
            <h4 class="font-bold text-gray-900 dark:text-white text-xs uppercase tracking-wider">Additional Features</h4>
            <ul class="space-y-2 list-disc list-inside marker:text-[#FF6600]">
              <li>Nominatim location search with 100+ categorized icons</li>
              <li>13 preset scenic locations (Grand Canyon, Mt. Fuji, Tail of the Dragon, etc.)</li>
              <li>"Mod of the Day" – highlights the latest BeamNG map mod</li>
              <li>GPXZ plan auto-detection with concurrent request support</li>
              <li>Web Worker-based off-thread terrain processing</li>
              <li>Light &amp; dark mode with persistent preferences</li>
              <li>Automatic geolocation on first visit</li>
              <li>Generation caching — skip reprocessing when switching views</li>
              <li>Abort support for long-running generation tasks</li>
            </ul>
        </div>

        <div class="pt-4 border-t border-gray-100 dark:border-gray-800">
          <p class="text-xs text-gray-500 dark:text-gray-400 text-center">
            Created by <a href="https://github.com/nikkiluzader" target="_blank" class="text-[#FF6600] hover:underline">Nikki Luzader</a> • Open Source on <a href="https://github.com/nikkiluzader/mapng" target="_blank" class="text-[#FF6600] hover:underline">GitHub</a>
          </p>
        </div>
      </div>
    </div>
  </div>

  <!-- Disclaimer Modal -->
  <div v-if="showDisclaimer" class="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm" @click.self="showDisclaimer = false">
    <div class="bg-white dark:bg-gray-900 rounded-2xl shadow-2xl w-full max-w-md overflow-hidden flex flex-col animate-in zoom-in-95 duration-200">
      <div class="p-6 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between bg-gray-50 dark:bg-gray-800">
        <div class="flex items-center gap-3">
          <div class="p-2 bg-amber-100 dark:bg-amber-900/30 rounded-lg">
            <AlertTriangle :size="20" class="text-amber-600 dark:text-amber-500" />
          </div>
          <h2 class="text-lg font-bold text-gray-900 dark:text-white">Data Accuracy Disclaimer</h2>
        </div>
        <button @click="showDisclaimer = false" class="text-gray-400 dark:text-gray-500 hover:text-gray-900 dark:hover:text-white transition-colors">
          <X :size="20" />
        </button>
      </div>
      
      <div class="p-6 space-y-4 text-sm text-gray-600 dark:text-gray-300 leading-relaxed">
        <p>
          Please be aware that all terrain data, heightmaps, and 3D models generated by MapNG are <span class="font-bold text-gray-900 dark:text-white">estimations</span> based on available satellite and elevation datasets.
        </p>
        
        <div class="bg-amber-50 dark:bg-amber-900/20 border border-amber-100 dark:border-amber-900/30 rounded-lg p-4 text-amber-900 dark:text-amber-100 text-xs">
          <p class="font-medium mb-1">Resolution & Scale</p>
          <p>All heightmaps are exported at 1 meter per pixel resolution to ensure consistent scaling in game engines. However, when using the Standard (30m) dataset, the terrain is upsampled. This means it will be smooth but lack the fine details found in true 1m datasets like USGS or GPXZ.</p>
        </div>

        <p class="text-xs text-gray-500 dark:text-gray-400">
          This tool is intended for modding and creative use. It should not be used for navigation, engineering, or critical real-world planning.
        </p>

        <button 
          @click="showDisclaimer = false"
          class="w-full py-2.5 bg-gray-900 dark:bg-white text-white dark:text-gray-900 font-medium rounded-lg hover:bg-gray-800 dark:hover:bg-gray-100 transition-colors mt-2"
        >
          I Understand
        </button>
      </div>
    </div>
  </div>

  <!-- Tech Stack Modal -->
    <div v-if="showStackInfo" class="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4 animate-in fade-in duration-200">
      <div class="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-xl shadow-2xl w-full max-w-2xl max-h-[85vh] overflow-y-auto custom-scrollbar flex flex-col animate-in zoom-in-95 duration-200">
        <!-- Header -->
        <div class="p-5 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between sticky top-0 bg-white/95 dark:bg-gray-900/95 backdrop-blur z-10">
          <div class="flex items-center gap-3">
            <div class="p-2 bg-gray-100 dark:bg-gray-800 rounded-lg">
              <Code :size="20" class="text-[#FF6600]" />
            </div>
            <h2 class="text-lg font-bold text-gray-900 dark:text-white">MapNG Tech Stack</h2>
          </div>
          <button 
            @click="showStackInfo = false" 
            class="p-2 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-full transition-colors text-gray-400 hover:text-gray-900 dark:hover:text-white"
          >
            <X :size="20" />
          </button>
        </div>

        <!-- Content -->
        <div class="p-6 space-y-8">
          <section class="space-y-3">
            <h3 class="text-sm font-semibold text-[#FF6600] uppercase tracking-wider">Core Framework</h3>
            <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div class="bg-gray-50 dark:bg-gray-800 p-3 rounded border border-gray-200 dark:border-gray-700">
                <div class="font-medium text-gray-900 dark:text-white">Vue 3</div>
                <div class="text-xs text-gray-500 dark:text-gray-400 mt-1">Composition API & reactive state management</div>
              </div>
              <div class="bg-gray-50 dark:bg-gray-800 p-3 rounded border border-gray-200 dark:border-gray-700">
                <div class="font-medium text-gray-900 dark:text-white">JavaScript (ES6+)</div>
                <div class="text-xs text-gray-500 dark:text-gray-400 mt-1">Modern standard with dynamic imports & async/await</div>
              </div>
              <div class="bg-gray-50 dark:bg-gray-800 p-3 rounded border border-gray-200 dark:border-gray-700">
                <div class="font-medium text-gray-900 dark:text-white">Tailwind CSS</div>
                <div class="text-xs text-gray-500 dark:text-gray-400 mt-1">Utility-first styling with dark mode support</div>
              </div>
              <div class="bg-gray-50 dark:bg-gray-800 p-3 rounded border border-gray-200 dark:border-gray-700">
                <div class="font-medium text-gray-900 dark:text-white">Vite</div>
                <div class="text-xs text-gray-500 dark:text-gray-400 mt-1">Fast dev server & optimized production builds</div>
              </div>
              <div class="bg-gray-50 dark:bg-gray-800 p-3 rounded border border-gray-200 dark:border-gray-700">
                <div class="font-medium text-gray-900 dark:text-white">VueUse</div>
                <div class="text-xs text-gray-500 dark:text-gray-400 mt-1">Composable utility functions for Vue 3</div>
              </div>
              <div class="bg-gray-50 dark:bg-gray-800 p-3 rounded border border-gray-200 dark:border-gray-700">
                <div class="font-medium text-gray-900 dark:text-white">Lucide Icons</div>
                <div class="text-xs text-gray-500 dark:text-gray-400 mt-1">Beautiful, consistent icon set (Vue components)</div>
              </div>
            </div>
          </section>

          <section class="space-y-3">
            <h3 class="text-sm font-semibold text-[#FF6600] uppercase tracking-wider">3D Engine & Rendering</h3>
            <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div class="bg-gray-50 dark:bg-gray-800 p-3 rounded border border-gray-200 dark:border-gray-700">
                <div class="font-medium text-gray-900 dark:text-white">Three.js</div>
                <div class="text-xs text-gray-500 dark:text-gray-400 mt-1">WebGL 3D engine — geometry, materials, textures, export</div>
              </div>
              <div class="bg-gray-50 dark:bg-gray-800 p-3 rounded border border-gray-200 dark:border-gray-700">
                <div class="font-medium text-gray-900 dark:text-white">TresJS</div>
                <div class="text-xs text-gray-500 dark:text-gray-400 mt-1">Declarative Vue 3 renderer for Three.js scenes</div>
              </div>
              <div class="bg-gray-50 dark:bg-gray-800 p-3 rounded border border-gray-200 dark:border-gray-700">
                <div class="font-medium text-gray-900 dark:text-white">Cientos</div>
                <div class="text-xs text-gray-500 dark:text-gray-400 mt-1">OrbitControls, HDR environment, shadows, sky</div>
              </div>
              <div class="bg-gray-50 dark:bg-gray-800 p-3 rounded border border-gray-200 dark:border-gray-700">
                <div class="font-medium text-gray-900 dark:text-white">Cascaded Shadow Maps</div>
                <div class="text-xs text-gray-500 dark:text-gray-400 mt-1">4-cascade CSM with 4096px shadow maps & PCF filtering</div>
              </div>
              <div class="bg-gray-50 dark:bg-gray-800 p-3 rounded border border-gray-200 dark:border-gray-700">
                <div class="font-medium text-gray-900 dark:text-white">HDR Environment</div>
                <div class="text-xs text-gray-500 dark:text-gray-400 mt-1">4K puresky HDRI for realistic ambient & reflection lighting</div>
              </div>
              <div class="bg-gray-50 dark:bg-gray-800 p-3 rounded border border-gray-200 dark:border-gray-700">
                <div class="font-medium text-gray-900 dark:text-white">GLTFExporter</div>
                <div class="text-xs text-gray-500 dark:text-gray-400 mt-1">Full 3D model export with terrain, OSM features & surroundings</div>
              </div>
            </div>
          </section>

          <section class="space-y-3">
            <h3 class="text-sm font-semibold text-[#FF6600] uppercase tracking-wider">Mapping & GIS</h3>
            <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
               <div class="bg-gray-50 dark:bg-gray-800 p-3 rounded border border-gray-200 dark:border-gray-700">
                <div class="font-medium text-gray-900 dark:text-white">Leaflet & Vue-Leaflet</div>
                <div class="text-xs text-gray-500 dark:text-gray-400 mt-1">Interactive 2D map with 3 base layers & dark mode</div>
              </div>
              <div class="bg-gray-50 dark:bg-gray-800 p-3 rounded border border-gray-200 dark:border-gray-700">
                <div class="font-medium text-gray-900 dark:text-white">proj4 & GeoTIFF</div>
                <div class="text-xs text-gray-500 dark:text-gray-400 mt-1">CRS reprojection, DEM parsing & GeoTIFF export</div>
              </div>
              <div class="bg-gray-50 dark:bg-gray-800 p-3 rounded border border-gray-200 dark:border-gray-700">
                <div class="font-medium text-gray-900 dark:text-white">Local Transverse Mercator</div>
                <div class="text-xs text-gray-500 dark:text-gray-400 mt-1">Custom metric projection for pixel-perfect 1m/px grids</div>
              </div>
              <div class="bg-gray-50 dark:bg-gray-800 p-3 rounded border border-gray-200 dark:border-gray-700">
                <div class="font-medium text-gray-900 dark:text-white">Nominatim Geocoding</div>
                <div class="text-xs text-gray-500 dark:text-gray-400 mt-1">Dual-endpoint search with 100+ type-categorized results</div>
              </div>
            </div>
          </section>

          <section class="space-y-3">
            <h3 class="text-sm font-semibold text-[#FF6600] uppercase tracking-wider">Texture & Image Processing</h3>
            <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div class="bg-gray-50 dark:bg-gray-800 p-3 rounded border border-gray-200 dark:border-gray-700">
                <div class="font-medium text-gray-900 dark:text-white">HTML5 Canvas API</div>
                <div class="text-xs text-gray-500 dark:text-gray-400 mt-1">16K procedural texture generation with 40+ land-use colors</div>
              </div>
              <div class="bg-gray-50 dark:bg-gray-800 p-3 rounded border border-gray-200 dark:border-gray-700">
                <div class="font-medium text-gray-900 dark:text-white">fast-png</div>
                <div class="text-xs text-gray-500 dark:text-gray-400 mt-1">16-bit precision heightmap & road mask encoding</div>
              </div>
              <div class="bg-gray-50 dark:bg-gray-800 p-3 rounded border border-gray-200 dark:border-gray-700">
                <div class="font-medium text-gray-900 dark:text-white">OSM Lane Renderer</div>
                <div class="text-xs text-gray-500 dark:text-gray-400 mt-1">Lane markings, junction fills, crosswalks, Chaikin smoothing</div>
              </div>
              <div class="bg-gray-50 dark:bg-gray-800 p-3 rounded border border-gray-200 dark:border-gray-700">
                <div class="font-medium text-gray-900 dark:text-white">Web Workers</div>
                <div class="text-xs text-gray-500 dark:text-gray-400 mt-1">Off-thread terrain & image resampling with transferable buffers</div>
              </div>
            </div>
          </section>

          <section class="space-y-3">
            <h3 class="text-sm font-semibold text-[#FF6600] uppercase tracking-wider">Data Sources</h3>
            <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
               <div class="bg-gray-50 dark:bg-gray-800 p-3 rounded border border-gray-200 dark:border-gray-700">
                <div class="font-medium text-gray-900 dark:text-white">AWS Terrain Tiles</div>
                <div class="text-xs text-gray-500 dark:text-gray-400 mt-1">Global 30m SRTM elevation (Terrarium encoding @ Z15)</div>
              </div>
              <div class="bg-gray-50 dark:bg-gray-800 p-3 rounded border border-gray-200 dark:border-gray-700">
                <div class="font-medium text-gray-900 dark:text-white">USGS National Map</div>
                <div class="text-xs text-gray-500 dark:text-gray-400 mt-1">1m DEM via TNM Access API (CONUS, Alaska, Hawaii)</div>
              </div>
              <div class="bg-gray-50 dark:bg-gray-800 p-3 rounded border border-gray-200 dark:border-gray-700">
                <div class="font-medium text-gray-900 dark:text-white">GPXZ API</div>
                <div class="text-xs text-gray-500 dark:text-gray-400 mt-1">Premium global hi-res elevation with auto-chunking, rate-limit probing &amp; concurrent requests for paid plans</div>
              </div>
               <div class="bg-gray-50 dark:bg-gray-800 p-3 rounded border border-gray-200 dark:border-gray-700">
                <div class="font-medium text-gray-900 dark:text-white">Esri World Imagery</div>
                <div class="text-xs text-gray-500 dark:text-gray-400 mt-1">High-res satellite textures at Z17 (~1.2m/px)</div>
              </div>
              <div class="bg-gray-50 dark:bg-gray-800 p-3 rounded border border-gray-200 dark:border-gray-700">
                <div class="font-medium text-gray-900 dark:text-white">Overpass API (OSM)</div>
                <div class="text-xs text-gray-500 dark:text-gray-400 mt-1">Roads, buildings, land-use, vegetation, barriers (3 failover endpoints)</div>
              </div>
              <div class="bg-gray-50 dark:bg-gray-800 p-3 rounded border border-gray-200 dark:border-gray-700">
                <div class="font-medium text-gray-900 dark:text-white">JSZip</div>
                <div class="text-xs text-gray-500 dark:text-gray-400 mt-1">Client-side ZIP packaging for batch jobs, multi-tile &amp; GeoTIFF exports</div>
              </div>
            </div>
          </section>

          <section class="space-y-3">
            <h3 class="text-sm font-semibold text-[#FF6600] uppercase tracking-wider">Deployment</h3>
            <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div class="bg-gray-50 dark:bg-gray-800 p-3 rounded border border-gray-200 dark:border-gray-700">
                <div class="font-medium text-gray-900 dark:text-white">Cloudflare Pages</div>
                <div class="text-xs text-gray-500 dark:text-gray-400 mt-1">Global edge-deployed static hosting via Wrangler CLI</div>
              </div>
            </div>
          </section>
        </div>
        
        <div class="p-5 border-t border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 text-center">
          <p class="text-xs text-gray-500 dark:text-gray-400">Built to assist with BeamNG.drive modding workflows.</p>
          <p class="italic opacity-70 text-xs text-gray-400 dark:text-gray-500 mt-2">App enhanced with Claude</p>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue';
import { Globe, Layers, Loader2, Code, X, Monitor, MousePointer2, CircleHelp, Sun, Moon, AlertTriangle, Grid3X3, Map } from 'lucide-vue-next';
import ControlPanel from './components/ControlPanel.vue';
import BatchControlPanel from './components/BatchControlPanel.vue';
import BatchProgressModal from './components/BatchProgressModal.vue';
import MapSelector from './components/MapSelector.vue';
import Preview3D from './components/Preview3D.vue';
import { fetchTerrainData, addOSMToTerrain } from './services/terrain';
import {
  computeGridTiles,
  createBatchJobState,
  runBatchJob,
  saveBatchState,
  loadBatchState,
  clearBatchState,
  resetFailedTiles,
} from './services/batchJob';

const center = ref(
  JSON.parse(localStorage.getItem('mapng_center') || 'null') || { lat: 35.1983, lng: -111.6513 }
);
const zoom = ref(parseInt(localStorage.getItem('mapng_zoom')) || 13);
const resolution = ref(parseInt(localStorage.getItem('mapng_resolution')) || 1024);
const terrainData = ref(null);
const lastGenerationKey = ref(null);
const isLoading = ref(false);
const loadingStatus = ref("Initializing...");
const previewMode = ref(false);
const showStackInfo = ref(false);
const showAbout = ref(false);
const showDisclaimer = ref(false);
const isDarkMode = ref(false);
const surroundingTilePositions = ref([]);
let abortController = null;

// ── Batch Mode State ──────────────────────────────────────────
const batchMode = ref(false);
const batchGridCols = ref(parseInt(localStorage.getItem('mapng_batch_cols')) || 3);
const batchGridRows = ref(parseInt(localStorage.getItem('mapng_batch_rows')) || 3);
const batchState = ref(null);       // The active/saved batch job state
const batchRunning = ref(false);    // True while the runner is executing
const batchCurrentStep = ref('');   // Current step description for progress modal
const showBatchProgress = ref(false);
let batchAbortController = null;

// Saved batch state from localStorage (for resume)
const savedBatchState = ref(loadBatchState());

// Compute batch grid tiles for map overlay (live preview while configuring)
const batchGridTiles = computed(() => {
  if (!batchMode.value) return [];
  // If a batch is active (running/paused/done), use its tile data
  if (batchState.value) return batchState.value.tiles;
  // Otherwise compute preview grid from config
  return computeGridTiles(center.value, resolution.value, batchGridCols.value, batchGridRows.value);
});

// Build info (injected by Vite at build time)
const buildHash = __BUILD_HASH__;
const buildTime = new Date(__BUILD_TIME__).toLocaleString();

const toggleDarkMode = () => {
  isDarkMode.value = !isDarkMode.value;
  if (isDarkMode.value) {
    document.documentElement.classList.add('dark');
    localStorage.setItem('theme', 'dark');
  } else {
    document.documentElement.classList.remove('dark');
    localStorage.setItem('theme', 'light');
  }
};

// Attempt to get user location on load
onMounted(() => {
  // Check for saved theme. Default to light mode if no preference is saved.
  // This ignores system preference to ensure a consistent default as requested.
  if (localStorage.theme === 'dark') {
    isDarkMode.value = true;
    document.documentElement.classList.add('dark');
  } else {
    isDarkMode.value = false;
    document.documentElement.classList.remove('dark');
  }

  if ("geolocation" in navigator) {
    navigator.geolocation.getCurrentPosition(
      (position) => {
        center.value = {
          lat: position.coords.latitude,
          lng: position.coords.longitude
        };
      },
      (err) => {
        console.debug("Geolocation access denied or failed, using default location.", err);
      },
      {
        enableHighAccuracy: false, // Use WiFi/Cell towers for speed
        timeout: 5000, // Don't wait more than 5s
        maximumAge: 600000 // Accept cached positions up to 10 minutes old
      }
    );
  }
});

const handleLocationChange = (newCenter) => {
  center.value = newCenter;
  terrainData.value = null;
  lastGenerationKey.value = null;
  // Cancel any in-flight generation when location changes
  if (abortController) {
    abortController.abort();
    abortController = null;
  }
};

const setCenter = (newCenter) => {
  center.value = newCenter;
  localStorage.setItem('mapng_center', JSON.stringify(newCenter));
};

const setZoom = (newZoom) => {
  zoom.value = newZoom;
  localStorage.setItem('mapng_zoom', String(newZoom));
};

const setResolution = (newResolution) => {
  resolution.value = newResolution;
  localStorage.setItem('mapng_resolution', String(newResolution));
};

// Build a cache key from the parameters that affect terrain generation.
// If this key matches the last generation, we can skip re-fetching.
const buildGenerationKey = (c, res, osm, usgs, gpxz, gpxzKey) => {
  return JSON.stringify({
    lat: c.lat,
    lng: c.lng,
    resolution: res,
    osm,
    usgs,
    gpxz,
    gpxzKey: gpxz ? gpxzKey : '',
  });
};

const handleGenerate = async (showPreview, fetchOSM, useUSGS, useGPXZ, gpxzApiKey) => {
  const requestKey = buildGenerationKey(center.value, resolution.value, fetchOSM, useUSGS, useGPXZ, gpxzApiKey);

  // If we already have terrain data for the exact same parameters, reuse it
  if (terrainData.value && lastGenerationKey.value) {
    const cachedParams = JSON.parse(lastGenerationKey.value);
    const newParams = JSON.parse(requestKey);

    // Check if only the OSM toggle changed (was off, now on)
    const onlyOsmAdded =
      !cachedParams.osm && newParams.osm &&
      cachedParams.lat === newParams.lat &&
      cachedParams.lng === newParams.lng &&
      cachedParams.resolution === newParams.resolution &&
      cachedParams.usgs === newParams.usgs &&
      cachedParams.gpxz === newParams.gpxz &&
      cachedParams.gpxzKey === newParams.gpxzKey;

    if (requestKey === lastGenerationKey.value) {
      // Exact match — skip fetch entirely, just switch view if needed
      if (showPreview) previewMode.value = true;
      return;
    }

    if (onlyOsmAdded) {
      // Terrain + textures are identical, just add OSM data on top
      isLoading.value = true;
      loadingStatus.value = "Adding OSM data to existing terrain...";
      try {
        const updatedData = await addOSMToTerrain(terrainData.value, undefined, (status) => {
          loadingStatus.value = status;
        });
        terrainData.value = updatedData;
        lastGenerationKey.value = requestKey;
        if (showPreview) {
          loadingStatus.value = "Rendering 3D scene...";
          previewMode.value = true;
        }
      } catch (error) {
        console.error("Failed to add OSM data:", error);
        alert("Failed to fetch OSM data.");
      } finally {
        isLoading.value = false;
      }
      return;
    }
  }

  // Cancel any in-flight generation
  if (abortController) {
    abortController.abort();
    abortController = null;
  }

  abortController = new AbortController();
  const { signal } = abortController;

  isLoading.value = true;
  loadingStatus.value = "Starting terrain generation...";
  
  // Flush old data to free memory before loading new large datasets
  if (terrainData.value) {
      terrainData.value = null;
      lastGenerationKey.value = null;
      // Allow a brief moment for Vue to unmount 3D components and trigger disposal
      await new Promise(r => setTimeout(r, 100));
  }

  try {
    const data = await fetchTerrainData(
        center.value, 
        resolution.value, 
        fetchOSM, 
        useUSGS, 
        useGPXZ, 
        gpxzApiKey,
        undefined,
        (status) => { loadingStatus.value = status; },
        signal
    );
    terrainData.value = data;
    lastGenerationKey.value = requestKey;
    
    if (showPreview) {
        loadingStatus.value = "Rendering 3D scene...";
        previewMode.value = true;
    }
  } catch (error) {
    if (error.name === 'AbortError') {
      console.log("Terrain generation cancelled.");
      loadingStatus.value = "Cancelled.";
      return;
    }
    console.error("Failed to generate terrain:", error);
    alert("Failed to fetch terrain data. The requested area might be too large or service is down.");
  } finally {
    isLoading.value = false;
    abortController = null;
  }
};

const handleFetchOSM = async () => {
  if (!terrainData.value) return;
  
  isLoading.value = true;
  loadingStatus.value = "Fetching OSM data...";
  
  try {
      const updatedData = await addOSMToTerrain(terrainData.value, undefined, (status) => {
          loadingStatus.value = status;
      });
      terrainData.value = updatedData;
  } catch (error) {
      console.error("Failed to fetch OSM data:", error);
      alert("Failed to fetch OSM data.");
  } finally {
      isLoading.value = false;
  }
};

const handleUpdateTextures = ({ osmTextureUrl, hybridTextureUrl, osmTextureCanvas, hybridTextureCanvas }) => {
  if (terrainData.value) {
    terrainData.value = {
      ...terrainData.value,
      osmTextureUrl,
      hybridTextureUrl,
      osmTextureCanvas,
      hybridTextureCanvas
    };
  }
};

const cancelGeneration = () => {
  if (abortController) {
    abortController.abort();
    abortController = null;
  }
};

const switchTo2D = () => {
  previewMode.value = false;
  // Do not clear terrainData here, so users can switch back and forth
  // without losing their generated exports.
};

// ─── Batch Job Handlers ─────────────────────────────────────────────

const handleStartBatch = (config) => {
  const state = createBatchJobState(config);
  batchState.value = state;
  showBatchProgress.value = true;
  executeBatchJob(state);
};

const handleResumeBatch = () => {
  let state = batchState.value || savedBatchState.value;
  if (!state) return;

  // If resuming from saved state, hydrate it
  if (!batchState.value) {
    batchState.value = state;
  }

  showBatchProgress.value = true;
  executeBatchJob(batchState.value);
};

const handleRetryFailed = () => {
  if (!batchState.value) return;
  resetFailedTiles(batchState.value);
  // Force reactivity update
  batchState.value = { ...batchState.value };
  executeBatchJob(batchState.value);
};

const handleBatchCancel = () => {
  if (batchAbortController) {
    batchAbortController.abort();
    batchAbortController = null;
  }
};

const handleBatchProgressClose = () => {
  showBatchProgress.value = false;
  // If the job is fully complete with no errors, clear saved state
  if (batchState.value?.status === 'completed') {
    clearBatchState();
    savedBatchState.value = null;
    batchState.value = null;
  }
  // If paused or has errors, keep state for resume
  savedBatchState.value = loadBatchState();
};

const handleClearSavedBatch = () => {
  clearBatchState();
  savedBatchState.value = null;
  batchState.value = null;
};

const executeBatchJob = async (state) => {
  batchRunning.value = true;
  batchAbortController = new AbortController();

  try {
    await runBatchJob(
      state,
      // onProgress
      ({ tileIndex, step, tile }) => {
        batchCurrentStep.value = step;
        // Force reactivity on tile status changes
        batchState.value = { ...batchState.value };
      },
      // onTileComplete
      (tile) => {
        batchState.value = { ...batchState.value };
      },
      // onError
      (tile, error) => {
        console.error(`[Batch] Tile R${tile.row + 1}C${tile.col + 1} failed:`, error);
        batchState.value = { ...batchState.value };
      },
      batchAbortController.signal
    );
  } catch (error) {
    if (error.name !== 'AbortError') {
      console.error('[Batch] Unexpected error:', error);
    }
  } finally {
    batchRunning.value = false;
    batchAbortController = null;
    batchCurrentStep.value = '';
    // Force final state update
    batchState.value = { ...batchState.value };
    savedBatchState.value = loadBatchState();
  }
};
</script>
