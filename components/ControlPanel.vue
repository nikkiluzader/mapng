<template>
  <div class="space-y-6">
    <!-- Action Buttons -->
    <div class="grid grid-cols-2 gap-3">
      <button
        @click="$emit('generate', true, fetchOSM, useUSGS, useGPXZ, gpxzApiKey)"
        :disabled="isGenerating || (useGPXZ && !gpxzApiKey)"
        :class="['py-3 font-bold rounded-md shadow-lg flex flex-col items-center justify-center gap-1 transition-all disabled:opacity-50 disabled:cursor-not-allowed',
          isCached
            ? 'bg-[#FF6600] hover:bg-[#E65C00] text-white shadow-orange-900/10'
            : 'bg-[#FF6600] hover:bg-[#E65C00] text-white shadow-orange-900/10 disabled:bg-gray-300 dark:disabled:bg-gray-700']"
      >
          <span v-if="isGenerating" class="animate-pulse text-xs">Processing...</span>
          <template v-else-if="isCached">
              <div class="flex items-center gap-2">
                   <Mountain :size="16" />
                   <span>Preview 3D</span>
              </div>
              <span class="text-[10px] font-normal opacity-90">Using cached data</span>
          </template>
          <template v-else>
              <div class="flex items-center gap-2">
                   <Mountain :size="16" />
                   <span>Preview 3D</span>
              </div>
              <span class="text-[10px] font-normal opacity-90">View before download</span>
          </template>
      </button>

      <button
        @click="$emit('generate', false, fetchOSM, useUSGS, useGPXZ, gpxzApiKey)"
        :disabled="isGenerating || isCached || (useGPXZ && !gpxzApiKey)"
        :class="['py-3 font-bold rounded-md shadow-sm flex flex-col items-center justify-center gap-1 transition-all disabled:cursor-not-allowed',
          isCached
            ? 'bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800 text-emerald-700 dark:text-emerald-400'
            : 'bg-white dark:bg-gray-800 hover:bg-gray-50 dark:hover:bg-gray-700 border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 disabled:opacity-50']"
      >
           <span v-if="isGenerating" class="animate-pulse text-xs">Processing...</span>
          <template v-else-if="isCached">
              <div class="flex items-center gap-2">
                   <CircleCheck :size="16" />
                   <span>Data Ready</span>
              </div>
              <span class="text-[10px] font-normal text-emerald-600 dark:text-emerald-400">Download below</span>
          </template>
          <template v-else>
              <div class="flex items-center gap-2">
                   <FileDown :size="16" />
                   <span>Generate Data</span>
              </div>
              <span class="text-[10px] font-normal text-gray-500 dark:text-gray-400">Skip 3D view, get files</span>
          </template>
      </button>
    </div>

        <div class="grid grid-cols-2 gap-2">
            <button
                @click="copyRunConfiguration"
                class="py-2 text-xs font-medium rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 hover:bg-gray-50 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-300 transition-colors"
            >
                Copy Configuration
            </button>
            <button
                @click="pasteRunConfiguration"
                class="py-2 text-xs font-medium rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 hover:bg-gray-50 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-300 transition-colors"
            >
                Paste Configuration
            </button>
            <button
                @click="saveRunConfiguration"
                class="py-2 text-xs font-medium rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 hover:bg-gray-50 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-300 transition-colors"
            >
                Save Configuration
            </button>
            <button
                @click="runConfigFileInput?.click()"
                class="py-2 text-xs font-medium rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 hover:bg-gray-50 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-300 transition-colors"
            >
                Load Configuration
            </button>
            <input
                ref="runConfigFileInput"
                type="file"
                accept="application/json,.json"
                class="hidden"
                @change="handleRunConfigFile"
            />
        </div>
        <p v-if="runConfigStatus" class="text-[10px] text-gray-500 dark:text-gray-400">{{ runConfigStatus }}</p>

        <hr class="border-gray-200 dark:border-gray-600" />

        <!-- Job Data (Import/Export) -->
        <div class="space-y-3">
            <label class="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider flex items-center gap-2">
                <Database :size="14" />
                Single Job State
            </label>
            <div class="grid grid-cols-2 gap-2">
                <button
                    @click="jobFileInput?.click()"
                    :disabled="isImportingJob || isGenerating"
                    class="py-2 text-xs font-medium rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 hover:bg-gray-50 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-300 transition-colors flex items-center justify-center gap-2"
                >
                    <Import v-if="!isImportingJob" :size="14" />
                    <Loader2 v-else :size="14" class="animate-spin" />
                    Import Job
                </button>
                <button
                    v-if="terrainData"
                    @click="handleExportJob"
                    :disabled="isExportingJob || isGenerating"
                    class="py-2 text-xs font-medium rounded-md border border-[#FF6600]/30 bg-[#FF6600]/5 hover:bg-[#FF6600]/10 text-[#FF6600] transition-colors flex items-center justify-center gap-2 animate-in fade-in zoom-in-95"
                >
                    <Package v-if="!isExportingJob" :size="14" />
                    <Loader2 v-else :size="14" class="animate-spin" />
                    Export Job
                </button>
                <input
                    ref="jobFileInput"
                    type="file"
                    accept=".mapng"
                    class="hidden"
                    @change="handleImportJobFile"
                />
            </div>
            <p v-if="jobStatus" class="text-[10px] text-gray-500 dark:text-gray-400 text-center">{{ jobStatus }}</p>
        </div>

    <hr class="border-gray-200 dark:border-gray-600" />

    <!-- Resolution & Settings -->
    <div class="space-y-4">
      <label class="text-sm font-medium text-gray-700 dark:text-gray-300 flex items-center gap-2">
        <Box :size="16" class="text-gray-700 dark:text-gray-300" />
        Output Settings
      </label>

      <div class="space-y-1">
          <span class="text-xs text-gray-500 dark:text-gray-400">Resolution (Output Size)</span>
          <select 
              :value="resolution" 
              @change="$emit('resolutionChange', parseInt($event.target.value))"
              class="w-full bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded px-2 py-2 text-sm text-gray-900 dark:text-white focus:ring-2 focus:ring-[#FF6600] focus:border-[#FF6600] outline-none"
          >
              <option :value="512">512 x 512 px (Fast)</option>
              <option :value="1024">1024 x 1024 px (Standard)</option>
              <option :value="2048">2048 x 2048 px (High Detail)</option>
              <option :value="4096">4096 x 4096 px (Very High)</option>
              <option :value="8192">8192 x 8192 px (Ultra)</option>
          </select>
          <div class="text-[10px] text-gray-500 dark:text-gray-400 pt-1 space-y-1">
              <p>• Downloads match selected size exactly.</p>
              <p>• Fetches max detail (Terrain Z15, Sat Z17).</p>
              <p v-if="resolution >= 4096" class="text-amber-600 dark:text-amber-500 font-medium">⚠️ Large area. May require high RAM.</p>
              <p>• Current Scale: <span class="text-[#FF6600]">{{ metersPerPixel.toFixed(2) }}m/px</span></p>
          </div>
      </div>

      <!-- OSM Toggle -->
      <div class="flex items-center justify-between p-2 rounded bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600">
          <label class="text-xs text-gray-700 dark:text-gray-300 flex items-center gap-2 cursor-pointer">
              <Trees :size="12" class="text-emerald-600 dark:text-emerald-400" />
              Include OSM Features
          </label>
          <input 
              type="checkbox" 
              v-model="fetchOSM"
              class="accent-[#FF6600] w-4 h-4 cursor-pointer"
          />
      </div>
 
      <!-- Elevation Source Selection -->
      <div class="space-y-2">
        <button 
          @click="showElevationSource = !showElevationSource"
          class="w-full flex items-center justify-between text-sm font-medium text-gray-700 dark:text-gray-300 hover:text-[#FF6600] transition-colors group"
        >
          <span class="flex items-center gap-2">
            <Mountain :size="16" class="text-gray-500 dark:text-gray-400 group-hover:text-[#FF6600] transition-colors" />
            Elevation Data Source
          </span>
          <ChevronDown :size="14" :class="['transition-transform duration-200', showElevationSource ? 'rotate-180' : '']" />
        </button>
        
        <div v-if="showElevationSource" class="space-y-2 bg-gray-50 dark:bg-gray-700 p-2 rounded border border-gray-200 dark:border-gray-600">
            <!-- Default -->
            <label class="flex items-start gap-2 cursor-pointer p-1 hover:bg-gray-100 dark:hover:bg-gray-600 rounded transition-colors">
                <input type="radio" v-model="elevationSource" value="default" class="mt-0.5 accent-[#FF6600]" />
                <div class="space-y-0.5">
                    <span class="block text-xs font-medium text-gray-900 dark:text-white">Standard (30m Global)</span>
                    <span class="block text-[10px] text-gray-500 dark:text-gray-400 leading-tight">
                        Amazon Terrarium (SRTM). Reliable global coverage. Good for general terrain.
                    </span>
                </div>
            </label>

            <!-- USGS -->
            <label class="flex items-start gap-2 cursor-pointer p-1 hover:bg-gray-100 dark:hover:bg-gray-600 rounded transition-colors">
                <input type="radio" v-model="elevationSource" value="usgs" class="mt-0.5 accent-[#FF6600]" />
                <div class="space-y-0.5">
                    <div class="flex items-center gap-2">
                        <span class="block text-xs font-medium text-gray-900 dark:text-white">USGS 1m DEM (USA Only)</span>
                        <span v-if="usgsStatus" class="text-[9px] text-emerald-600 dark:text-emerald-400 font-bold px-1 bg-emerald-100 dark:bg-emerald-900/30 rounded">ONLINE</span>
                        <span v-else-if="usgsStatus === false" class="text-[9px] text-red-600 dark:text-red-400 font-bold px-1 bg-red-100 dark:bg-red-900/30 rounded">OFFLINE</span>
                    </div>
                    <span class="block text-[10px] text-gray-500 dark:text-gray-400 leading-tight">
                        High-precision data for USA. Falls back to Standard if data is missing/corrupt.
                    </span>
                </div>
            </label>

            <!-- GPXZ -->
            <label class="flex items-start gap-2 cursor-pointer p-1 hover:bg-gray-100 dark:hover:bg-gray-600 rounded transition-colors">
                <input type="radio" v-model="elevationSource" value="gpxz" class="mt-0.5 accent-[#FF6600]" />
                <div class="space-y-0.5 w-full">
                    <span class="block text-xs font-medium text-gray-900 dark:text-white">GPXZ (Premium Global)</span>
                    <span class="block text-[10px] text-gray-500 dark:text-gray-400 leading-tight">
                        Highest quality global data. Requires API Key. <a href="https://www.gpxz.io/docs/dataset#coverage" target="_blank" class="text-[#FF6600] hover:underline" @click.stop>Check Coverage</a>
                    </span>
                    
                    <div v-if="elevationSource === 'gpxz'" class="mt-2 animate-in fade-in slide-in-from-top-1">
                        <input 
                            type="password" 
                            v-model="gpxzApiKey"
                            placeholder="Enter GPXZ API Key"
                            class="w-full bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded px-2 py-1 text-xs text-gray-900 dark:text-white focus:ring-1 focus:ring-[#FF6600] outline-none"
                        />
                        <p class="text-[10px] text-gray-500 dark:text-gray-400 leading-tight mt-1">
                            Free tier: 100 req/day. <a href="https://www.gpxz.io/" target="_blank" class="text-[#FF6600] hover:underline">Get a key</a>
                        </p>
                        <!-- GPXZ Account Status -->
                        <div v-if="gpxzApiKey" class="mt-2">
                          <button @click="checkGPXZStatus" :disabled="isCheckingGPXZ"
                            class="text-[10px] text-[#FF6600] hover:underline disabled:opacity-50 disabled:no-underline">
                            {{ isCheckingGPXZ ? 'Checking...' : (gpxzStatus ? 'Refresh Status' : 'Check Account') }}
                          </button>
                          <div v-if="gpxzStatus" class="mt-1 bg-white dark:bg-gray-800 rounded border border-gray-200 dark:border-gray-600 p-2 space-y-1">
                            <div class="flex items-center justify-between text-[10px]">
                              <span class="text-gray-500 dark:text-gray-400">Plan</span>
                              <span :class="['font-bold uppercase', gpxzStatus.plan === 'free' ? 'text-gray-600 dark:text-gray-300' : 'text-emerald-600 dark:text-emerald-400']">{{ gpxzStatus.plan }}</span>
                            </div>
                            <div class="flex items-center justify-between text-[10px]">
                              <span class="text-gray-500 dark:text-gray-400">Today</span>
                              <span class="text-gray-700 dark:text-gray-300">{{ gpxzStatus.used }} / {{ gpxzStatus.limit }}</span>
                            </div>
                            <div class="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-1 mt-0.5">
                              <div class="h-1 rounded-full transition-all" :class="gpxzStatus.remaining < 20 ? 'bg-red-500' : 'bg-emerald-500'" :style="{ width: Math.min(100, (gpxzStatus.used / gpxzStatus.limit) * 100) + '%' }"></div>
                            </div>
                            <div class="flex items-center justify-between text-[10px]">
                              <span class="text-gray-500 dark:text-gray-400">Concurrency</span>
                              <span class="text-gray-700 dark:text-gray-300">{{ gpxzStatus.concurrency }}x parallel</span>
                            </div>
                            <p v-if="!gpxzStatus.valid" class="text-[10px] text-red-500 font-medium">⚠️ Invalid API key</p>
                          </div>
                        </div>
                        <p v-if="isAreaLargeForGPXZ" class="text-[10px] text-orange-600 dark:text-orange-400 font-medium leading-tight mt-1">
                            ⚠️ Large area ({{ areaSqKm.toFixed(2) }} km²). Uses multiple API calls.
                        </p>
                    </div>
                </div>
            </label>
        </div>
      </div>
    </div>

    <hr class="border-gray-200 dark:border-gray-600" />

    <!-- Coordinates -->
    <div class="space-y-2">
      <button 
        @click="showCoordinates = !showCoordinates"
        class="w-full flex items-center justify-between text-sm font-medium text-gray-700 dark:text-gray-300 hover:text-[#FF6600] transition-colors group"
      >
        <span class="flex items-center gap-2">
          <MapPin :size="16" class="text-gray-500 dark:text-gray-400 group-hover:text-[#FF6600] transition-colors" />
          Center Coordinates
        </span>
        <ChevronDown :size="14" :class="['transition-transform duration-200', showCoordinates ? 'rotate-180' : '']" />
      </button>
      
      <!-- Location Search -->
      <template v-if="showCoordinates">
      <LocationSearch @select="handleSearchSelect" />
      
      <div class="grid grid-cols-2 gap-2">
          <div class="space-y-1">
              <label class="text-[10px] text-gray-500 dark:text-gray-400 font-medium px-1 uppercase tracking-wider">Latitude</label>
              <input
                type="text"
                v-model="latInput"
                @change="handleManualLocationChange"
                @paste="handleCoordinatePaste($event, 'lat')"
                @keydown.enter="$event.target.blur()"
                class="w-full bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded px-2 py-1 text-xs text-gray-900 dark:text-white focus:ring-1 focus:ring-[#FF6600] outline-none"
                placeholder="Latitude"
              />
          </div>
          <div class="space-y-1">
              <label class="text-[10px] text-gray-500 dark:text-gray-400 font-medium px-1 uppercase tracking-wider">Longitude</label>
              <input
                type="text"
                v-model="lngInput"
                @change="handleManualLocationChange"
                @paste="handleCoordinatePaste($event, 'lng')"
                @keydown.enter="$event.target.blur()"
                class="w-full bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded px-2 py-1 text-xs text-gray-900 dark:text-white focus:ring-1 focus:ring-[#FF6600] outline-none"
                placeholder="Longitude"
              />
          </div>
      </div>
      
      <select 
          @change="handleLocationSelect"
          class="w-full bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded px-2 py-1.5 text-xs text-gray-900 dark:text-white focus:ring-1 focus:ring-[#FF6600] outline-none"
      >
          <option 
            v-for="(loc, index) in interestingLocations" 
            :key="index" 
            :value="index"
            :disabled="loc.disabled"
            :selected="index === 0"
          >
            {{ loc.name }}
          </option>
      </select>
      </template>
    </div>

    <hr class="border-gray-200 dark:border-gray-600" />

    <!-- Surrounding Tiles -->
    <SurroundingTiles 
      :terrain-data="terrainData"
      :center="center"
      :resolution="resolution"
      @update:selected-positions="(v) => $emit('surroundingTilesChange', v)"
      @update:show-on-map="() => {}"
    />

    <!-- Export Panel -->
    <div ref="exportPanel" v-if="terrainData && !isGenerating" class="space-y-3 pt-4 border-t border-gray-200 dark:border-gray-600">
        <!-- Missing OSM Warning / Action -->
        <div v-if="!terrainData.osmFeatures || terrainData.osmFeatures.length === 0" class="bg-blue-50 dark:bg-blue-900/20 p-2 rounded border border-blue-100 dark:border-blue-800 flex items-center justify-between">
            <div class="text-[10px] text-blue-700 dark:text-blue-300 flex items-center gap-1.5">
                <Trees :size="12" />
                <span>OSM Data missing</span>
            </div>
            <button 
                @click="$emit('fetchOsm')"
                class="text-[10px] font-medium bg-blue-600 hover:bg-blue-700 text-white px-2 py-1 rounded transition-colors"
            >
                Fetch Now
            </button>
        </div>

        <button
            @click="showExports = !showExports"
            class="w-full flex items-center justify-between text-sm font-medium text-emerald-600 dark:text-emerald-400 hover:text-[#FF6600] transition-colors group"
        >
            <span class="flex items-center gap-2">
                <Download :size="16" />
                Ready to Export
                <span class="text-xs text-gray-500 dark:text-gray-400 font-normal">{{ terrainData.width }}x{{ terrainData.height }}</span>
            </span>
            <ChevronDown :size="14" :class="['transition-transform duration-200', showExports ? 'rotate-180' : '']" />
        </button>
        
      <template v-if="showExports">
        <!-- 2D Assets -->
        <div class="space-y-1.5">
            <button
                @click="showExport2D = !showExport2D"
                class="w-full flex items-center justify-between group"
            >
                <h4 class="text-[10px] font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500 group-hover:text-[#FF6600] transition-colors">2D Assets</h4>
                <ChevronDown :size="12" :class="['text-gray-400 dark:text-gray-500 transition-transform duration-200', showExport2D ? 'rotate-180' : '']" />
            </button>
            <div v-if="showExport2D" class="grid grid-cols-2 gap-1.5">
                <!-- Heightmap -->
                <button 
                    @click="downloadHeightmap"
                    :disabled="isAnyExporting"
                    class="relative flex flex-col items-center justify-center p-1.5 bg-white dark:bg-gray-800 hover:bg-gray-50 dark:hover:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded text-sm text-gray-700 dark:text-gray-300 transition-colors group disabled:opacity-50 disabled:cursor-not-allowed h-24 overflow-hidden"
                >
                    <div class="w-full h-full flex items-center justify-center mb-0.5 overflow-hidden rounded bg-gray-100 dark:bg-gray-900">
                        <Loader2 v-if="isAnyExporting" :size="20" class="animate-spin text-[#FF6600]" />
                        <img v-else-if="heightmapPreviewUrl" :src="heightmapPreviewUrl" class="w-full h-full object-cover" />
                        <Mountain v-else :size="24" class="text-gray-400 dark:text-gray-500" />
                    </div>
                    <span class="text-[9px] font-medium">Heightmap</span>
                    <span class="text-[8px] text-gray-500 dark:text-gray-400">{{ terrainData.width }}px 16-bit grayscale PNG</span>
                    <Download v-if="!isAnyExporting" :size="10" class="absolute top-1 right-1 opacity-0 group-hover:opacity-100 transition-opacity text-[#FF6600]" />
                </button>

                <!-- Satellite Texture -->
                <button 
                    @click="downloadTexture"
                    :disabled="isAnyExporting"
                    class="relative flex flex-col items-center justify-center p-1.5 bg-white dark:bg-gray-800 hover:bg-gray-50 dark:hover:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded text-sm text-gray-700 dark:text-gray-300 transition-colors group disabled:opacity-50 disabled:cursor-not-allowed h-24 overflow-hidden"
                >
                    <div class="w-full h-full flex items-center justify-center mb-0.5 overflow-hidden rounded bg-gray-100 dark:bg-gray-900">
                        <Loader2 v-if="isAnyExporting" :size="20" class="animate-spin text-[#FF6600]" />
                        <img v-else-if="terrainData.satelliteTextureUrl" :src="terrainData.satelliteTextureUrl" class="w-full h-full object-cover" />
                        <Box v-else :size="24" class="text-gray-400 dark:text-gray-500" />
                    </div>
                    <span class="text-[9px] font-medium">Satellite</span>
                    <span class="text-[8px] text-gray-500 dark:text-gray-400">{{ terrainData.width }}px PNG</span>
                    <Download v-if="!isAnyExporting" :size="10" class="absolute top-1 right-1 opacity-0 group-hover:opacity-100 transition-opacity text-[#FF6600]" />
                </button>

                <!-- OSM Texture -->
                <button 
                    @click="downloadOSMTexture"
                    :disabled="!terrainData.osmTextureUrl || isAnyExporting"
                    class="relative flex flex-col items-center justify-center p-1.5 bg-white dark:bg-gray-800 hover:bg-gray-50 dark:hover:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded text-sm text-gray-700 dark:text-gray-300 transition-colors group disabled:opacity-50 disabled:cursor-not-allowed h-24 overflow-hidden"
                >
                    <div class="w-full h-full flex items-center justify-center mb-0.5 overflow-hidden rounded bg-gray-100 dark:bg-gray-900">
                        <Loader2 v-if="isAnyExporting" :size="20" class="animate-spin text-[#FF6600]" />
                        <img v-else-if="terrainData.osmTextureUrl" :src="terrainData.osmTextureUrl" class="w-full h-full object-cover" />
                        <Trees v-else :size="24" class="text-gray-400 dark:text-gray-500" />
                    </div>
                    <span class="text-[9px] font-medium">OSM Texture</span>
                    <span class="text-[8px] text-gray-500 dark:text-gray-400">{{ terrainData.width }}px PNG</span>
                    <Download v-if="!isAnyExporting" :size="10" class="absolute top-1 right-1 opacity-0 group-hover:opacity-100 transition-opacity text-[#FF6600]" />
                </button>

                <!-- Hybrid Texture -->
                <button 
                    @click="downloadHybridTexture"
                    :disabled="!terrainData.hybridTextureUrl || isAnyExporting"
                    class="relative flex flex-col items-center justify-center p-1.5 bg-white dark:bg-gray-800 hover:bg-gray-50 dark:hover:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded text-sm text-gray-700 dark:text-gray-300 transition-colors group disabled:opacity-50 disabled:cursor-not-allowed h-24 overflow-hidden"
                >
                    <div class="w-full h-full flex items-center justify-center mb-0.5 overflow-hidden rounded bg-gray-100 dark:bg-gray-900">
                        <Loader2 v-if="isAnyExporting" :size="20" class="animate-spin text-[#FF6600]" />
                        <img v-else-if="terrainData.hybridTextureUrl" :src="terrainData.hybridTextureUrl" class="w-full h-full object-cover" />
                        <Layers v-else :size="24" class="text-gray-400 dark:text-gray-500" />
                    </div>
                    <span class="text-[9px] font-medium">Hybrid</span>
                    <span class="text-[8px] text-gray-500 dark:text-gray-400">{{ terrainData.width }}px PNG</span>
                    <Download v-if="!isAnyExporting" :size="10" class="absolute top-1 right-1 opacity-0 group-hover:opacity-100 transition-opacity text-[#FF6600]" />
                </button>

                <!-- Segmented Satellite Texture -->
                <button 
                    @click="downloadSegmentedTexture"
                    :disabled="!terrainData.segmentedTextureUrl || isAnyExporting"
                    class="relative flex flex-col items-center justify-center p-1.5 bg-white dark:bg-gray-800 hover:bg-gray-50 dark:hover:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded text-sm text-gray-700 dark:text-gray-300 transition-colors group disabled:opacity-50 disabled:cursor-not-allowed h-24 overflow-hidden"
                >
                    <div class="w-full h-full flex items-center justify-center mb-0.5 overflow-hidden rounded bg-gray-100 dark:bg-gray-900">
                        <Loader2 v-if="isAnyExporting" :size="20" class="animate-spin text-[#FF6600]" />
                        <img v-else-if="terrainData.segmentedTextureUrl" :src="terrainData.segmentedTextureUrl" class="w-full h-full object-cover" />
                        <Paintbrush v-else :size="24" class="text-gray-400 dark:text-gray-500" />
                    </div>
                    <span class="text-[9px] font-medium">Segmented</span>
                    <span class="text-[8px] text-gray-500 dark:text-gray-400">{{ terrainData.width }}px PNG</span>
                    <Download v-if="!isAnyExporting" :size="10" class="absolute top-1 right-1 opacity-0 group-hover:opacity-100 transition-opacity text-[#FF6600]" />
                </button>

                <!-- Segmented Hybrid Texture -->
                <button 
                    @click="downloadSegmentedHybridTexture"
                    :disabled="!terrainData.segmentedHybridTextureUrl || isAnyExporting"
                    class="relative flex flex-col items-center justify-center p-1.5 bg-white dark:bg-gray-800 hover:bg-gray-50 dark:hover:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded text-sm text-gray-700 dark:text-gray-300 transition-colors group disabled:opacity-50 disabled:cursor-not-allowed h-24 overflow-hidden"
                >
                    <div class="w-full h-full flex items-center justify-center mb-0.5 overflow-hidden rounded bg-gray-100 dark:bg-gray-900">
                        <Loader2 v-if="isAnyExporting" :size="20" class="animate-spin text-[#FF6600]" />
                        <img v-else-if="terrainData.segmentedHybridTextureUrl" :src="terrainData.segmentedHybridTextureUrl" class="w-full h-full object-cover" />
                        <Paintbrush v-else :size="24" class="text-gray-400 dark:text-gray-500" />
                    </div>
                    <span class="text-[9px] font-medium">Seg. Hybrid</span>
                    <span class="text-[8px] text-gray-500 dark:text-gray-400">{{ terrainData.width }}px PNG</span>
                    <Download v-if="!isAnyExporting" :size="10" class="absolute top-1 right-1 opacity-0 group-hover:opacity-100 transition-opacity text-[#FF6600]" />
                </button>

                <!-- Road Mask -->
                <button 
                    @click="downloadRoadMask"
                    :disabled="!terrainData.osmFeatures || terrainData.osmFeatures.length === 0 || isAnyExporting"
                    class="relative flex flex-col items-center justify-center p-1.5 bg-white dark:bg-gray-800 hover:bg-gray-50 dark:hover:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded text-sm text-gray-700 dark:text-gray-300 transition-colors group disabled:opacity-50 disabled:cursor-not-allowed h-24 overflow-hidden"
                >
                    <div class="w-full h-full flex items-center justify-center mb-0.5 overflow-hidden rounded bg-gray-100 dark:bg-gray-900">
                        <Loader2 v-if="isAnyExporting" :size="20" class="animate-spin text-[#FF6600]" />
                        <img v-else-if="roadMaskPreviewUrl" :src="roadMaskPreviewUrl" class="w-full h-full object-cover" />
                        <Route v-else :size="24" class="text-gray-400 dark:text-gray-500" />
                    </div>
                    <span class="text-[9px] font-medium">Road Mask</span>
                    <span class="text-[8px] text-gray-500 dark:text-gray-400">{{ terrainData.width }}px 16-bit grayscale PNG</span>
                    <Download v-if="!isAnyExporting" :size="10" class="absolute top-1 right-1 opacity-0 group-hover:opacity-100 transition-opacity text-[#FF6600]" />
                </button>
            </div>
        </div>

        <!-- 3D Models -->
        <div class="space-y-1.5">
            <button
                @click="showExport3D = !showExport3D"
                class="w-full flex items-center justify-between group"
            >
                <h4 class="text-[10px] font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500 group-hover:text-[#FF6600] transition-colors">3D Models</h4>
                <ChevronDown :size="12" :class="['text-gray-400 dark:text-gray-500 transition-transform duration-200', showExport3D ? 'rotate-180' : '']" />
            </button>

            <template v-if="showExport3D">
            <!-- Shared 3D options -->
            <div class="space-y-2 px-2 py-2 bg-gray-50 dark:bg-gray-700/50 rounded border border-gray-200 dark:border-gray-600">
                <div class="flex items-center gap-1.5">
                    <span class="text-[9px] text-gray-500 dark:text-gray-400">Center Texture:</span>
                    <select v-model="modelCenterTextureType" class="text-[9px] bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded px-1.5 py-0.5 text-gray-600 dark:text-gray-300 cursor-pointer">
                        <option value="satellite">Satellite</option>
                        <option value="osm" :disabled="!terrainData?.osmTextureUrl">OSM</option>
                        <option value="hybrid" :disabled="!terrainData?.hybridTextureUrl">Hybrid</option>
                        <option value="segmented" :disabled="!terrainData?.segmentedTextureUrl">Segmented</option>
                        <option value="segmentedHybrid" :disabled="!terrainData?.segmentedHybridTextureUrl">Seg. Hybrid</option>
                        <option value="none">None</option>
                    </select>
                </div>
                <div class="flex items-center gap-2 flex-nowrap overflow-x-auto whitespace-nowrap pb-0.5">
                    <span class="text-[9px] text-gray-500 dark:text-gray-400">Tiles:</span>
                    <label class="flex items-center gap-1 cursor-pointer">
                        <input type="radio" v-model="modelTileSelection" value="center-only" class="accent-[#FF6600] w-3 h-3" />
                        <span class="text-[9px] text-gray-500 dark:text-gray-400">Center</span>
                    </label>
                    <label class="flex items-center gap-1 cursor-pointer">
                        <input type="radio" v-model="modelTileSelection" value="center-plus-surroundings" class="accent-[#FF6600] w-3 h-3" />
                        <span class="text-[9px] text-gray-500 dark:text-gray-400">Center + Surroundings</span>
                    </label>
                    <label class="flex items-center gap-1 cursor-pointer">
                        <input type="radio" v-model="modelTileSelection" value="surroundings-only" class="accent-[#FF6600] w-3 h-3" />
                        <span class="text-[9px] text-gray-500 dark:text-gray-400">Surroundings Only</span>
                    </label>
                </div>
            </div>

            <div class="grid grid-cols-2 gap-1.5">
                <!-- GLB Model -->
                <button 
                    @click="handleGLBExport"
                    :disabled="isAnyExporting"
                    class="relative flex flex-col items-center justify-center p-2 bg-white dark:bg-gray-800 hover:bg-gray-50 dark:hover:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded text-sm text-gray-700 dark:text-gray-300 transition-colors group disabled:opacity-50 disabled:cursor-not-allowed h-20"
                >
                    <div class="w-full h-full flex items-center justify-center mb-0.5">
                        <Loader2 v-if="isAnyExporting" :size="20" class="animate-spin text-[#FF6600]" />
                        <Box v-else :size="24" class="text-gray-400 dark:text-gray-500" />
                    </div>
                    <span class="text-[9px] font-medium">GLB Model</span>
                    <span class="text-[8px] text-gray-500 dark:text-gray-400">.glb binary</span>
                    <Download v-if="!isAnyExporting" :size="10" class="absolute top-1 right-1 opacity-0 group-hover:opacity-100 transition-opacity text-[#FF6600]" />
                </button>

                <!-- DAE (Collada) Model -->
                <button 
                    @click="handleDAEExport"
                    :disabled="isAnyExporting"
                    class="relative flex flex-col items-center justify-center p-2 bg-white dark:bg-gray-800 hover:bg-gray-50 dark:hover:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded text-sm text-gray-700 dark:text-gray-300 transition-colors group disabled:opacity-50 disabled:cursor-not-allowed h-20"
                >
                    <div class="w-full h-full flex items-center justify-center mb-0.5">
                        <Loader2 v-if="isAnyExporting" :size="20" class="animate-spin text-[#FF6600]" />
                        <FileCode v-else :size="24" class="text-gray-400 dark:text-gray-500" />
                    </div>
                    <span class="text-[9px] font-medium">Collada DAE</span>
                    <span class="text-[8px] text-gray-500 dark:text-gray-400">.dae + textures</span>
                    <Download v-if="!isAnyExporting" :size="10" class="absolute top-1 right-1 opacity-0 group-hover:opacity-100 transition-opacity text-[#FF6600]" />
                </button>
            </div>
            </template>
        </div>

        <!-- Geo Data -->
        <div class="space-y-1.5">
            <button
                @click="showExportGeo = !showExportGeo"
                class="w-full flex items-center justify-between group"
            >
                <h4 class="text-[10px] font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500 group-hover:text-[#FF6600] transition-colors">Geo Data</h4>
                <ChevronDown :size="12" :class="['text-gray-400 dark:text-gray-500 transition-transform duration-200', showExportGeo ? 'rotate-180' : '']" />
            </button>
            <div v-if="showExportGeo" class="grid grid-cols-2 gap-1.5">
                <!-- GeoTIFF -->
                <button 
                    @click="downloadGeoTIFF"
                    :disabled="isAnyExporting"
                    class="relative flex flex-col items-center justify-center p-2 bg-white dark:bg-gray-800 hover:bg-gray-50 dark:hover:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded text-sm text-gray-700 dark:text-gray-300 transition-colors group disabled:opacity-50 disabled:cursor-not-allowed h-20"
                >
                    <div class="w-full h-full flex items-center justify-center mb-0.5">
                        <Loader2 v-if="isAnyExporting" :size="20" class="animate-spin text-[#FF6600]" />
                        <FileCode v-else :size="24" class="text-gray-400 dark:text-gray-500" />
                    </div>
                    <span class="text-[9px] font-medium">GeoTIFF</span>
                    <span class="text-[8px] text-gray-500 dark:text-gray-400">{{ terrainData?.sourceGeoTiffs ? terrainData.sourceGeoTiffs.source.toUpperCase() : 'WGS84' }}</span>
                    <Download v-if="!isAnyExporting" :size="10" class="absolute top-1 right-1 opacity-0 group-hover:opacity-100 transition-opacity text-[#FF6600]" />
                </button>

                <!-- OSM GeoJSON -->
                <button 
                    @click="downloadOSM"
                    :disabled="!terrainData.osmFeatures || terrainData.osmFeatures.length === 0 || isAnyExporting"
                    class="relative flex flex-col items-center justify-center p-2 bg-white dark:bg-gray-800 hover:bg-gray-50 dark:hover:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded text-sm text-gray-700 dark:text-gray-300 transition-colors group disabled:opacity-50 disabled:cursor-not-allowed h-20"
                >
                    <div class="w-full h-full flex items-center justify-center mb-0.5">
                        <Loader2 v-if="isAnyExporting" :size="20" class="animate-spin text-[#FF6600]" />
                        <FileJson v-else :size="24" class="text-gray-400 dark:text-gray-500" />
                    </div>
                    <span class="text-[9px] font-medium">GeoJSON</span>
                    <span class="text-[8px] text-gray-500 dark:text-gray-400">OSM vectors</span>
                    <Download v-if="!isAnyExporting" :size="10" class="absolute top-1 right-1 opacity-0 group-hover:opacity-100 transition-opacity text-[#FF6600]" />
                </button>
            </div>
        </div>
      </template>

        <div class="bg-gray-50 dark:bg-gray-700 p-2 rounded border border-gray-200 dark:border-gray-600 space-y-2">
            <div class="grid grid-cols-3 gap-1 text-[10px] text-gray-500 dark:text-gray-400 border-b border-gray-200 dark:border-gray-600 pb-2">
                <div class="text-center border-r border-gray-200 dark:border-gray-600">
                    <div class="text-gray-400 dark:text-gray-500">Min</div>
                    <div class="text-gray-700 dark:text-gray-300 font-medium">{{ Math.round(terrainData.minHeight) }}m</div>
                </div>
                <div class="text-center border-r border-gray-200 dark:border-gray-600">
                    <div class="text-gray-400 dark:text-gray-500">Max</div>
                    <div class="text-gray-700 dark:text-gray-300 font-medium">{{ Math.round(terrainData.maxHeight) }}m</div>
                </div>
                <div class="text-center">
                    <div class="text-gray-400 dark:text-gray-500">Diff</div>
                    <div class="text-[#FF6600] font-bold">{{ Math.round(terrainData.maxHeight - terrainData.minHeight) }}m</div>
                </div>
            </div>
            <div class="grid grid-cols-2 gap-1 text-[10px] text-gray-500 dark:text-gray-400">
                 <div class="text-center border-r border-gray-200 dark:border-gray-600">
                    <div class="text-gray-400 dark:text-gray-500">Scale</div>
                    <div class="text-gray-700 dark:text-gray-300 font-medium">{{ metersPerPixel.toFixed(2) }}m/px</div>
                </div>
                <div class="text-center">
                    <div class="text-gray-400 dark:text-gray-500">Total Area</div>
                    <div class="text-gray-700 dark:text-gray-300 font-medium">{{ areaDisplay }}</div>
                </div>
            </div>
        </div>

    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, watch, nextTick } from 'vue';
import { MapPin, Mountain, Download, Box, FileDown, Loader2, Trees, FileJson, Layers, Route, FileCode, CircleCheck, ChevronDown, Paintbrush, Package, Import, Database } from 'lucide-vue-next';
import LocationSearch from './LocationSearch.vue';
import SurroundingTiles from './SurroundingTiles.vue';
import { exportToGLB, exportToDAE } from '../services/export3d';
import { checkUSGSStatus, probeGPXZLimits } from '../services/terrain';
import { exportGeoTiff } from '../services/exportGeoTiff';
import { createWGS84ToLocal } from '../services/geoUtils';
import { encode } from 'fast-png';
import { buildCommonTraceMetadata, cloneRateLimitInfo, downloadJsonFile } from '../services/traceability';
import { exportJobData, importJobData } from '../services/jobData';


const props = defineProps(['center', 'zoom', 'resolution', 'isGenerating', 'terrainData', 'generationCacheKey']);

const emit = defineEmits(['locationChange', 'resolutionChange', 'generate', 'fetchOsm', 'surroundingTilesChange', 'importData']);

// Local state for formatted coordinate inputs to allow high precision typing
const latInput = ref(props.center.lat.toString());
const lngInput = ref(props.center.lng.toString());

const handleManualLocationChange = () => {
    const lat = parseFloat(latInput.value);
    const lng = parseFloat(lngInput.value);
    
    if (!isNaN(lat) && !isNaN(lng)) {
        emit('locationChange', { ...props.center, lat, lng });
    }
};

// Handle pasting coordinates — supports "lat, lng" or "lat lng" pairs pasted into either field
const handleCoordinatePaste = (e, field) => {
    const pasted = (e.clipboardData || window.clipboardData).getData('text').trim();
    
    // Try to detect a coordinate pair (comma, space, or tab separated)
    const match = pasted.match(/^([\-]?\d+\.?\d*)\s*[,\s\t]+\s*([\-]?\d+\.?\d*)$/);
    if (match) {
        e.preventDefault();
        const a = parseFloat(match[1]);
        const b = parseFloat(match[2]);
        if (!isNaN(a) && !isNaN(b)) {
            latInput.value = a.toString();
            lngInput.value = b.toString();
            emit('locationChange', { ...props.center, lat: a, lng: b });
        }
        return;
    }
    
    // Single value paste — let it go through, then trigger update
    nextTick(() => {
        handleManualLocationChange();
    });
};

// Sync inputs with props when they change from other sources (map move, search, dropdown)
watch(() => props.center, (newVal) => {
    if (parseFloat(latInput.value) !== newVal.lat) {
        latInput.value = newVal.lat.toString();
    }
    if (parseFloat(lngInput.value) !== newVal.lng) {
        lngInput.value = newVal.lng.toString();
    }
}, { deep: true });

const exportPanel = ref(null);
const runConfigFileInput = ref(null);
const runConfigStatus = ref('');
const isExportingGLB = ref(false);
const isExportingHeightmap = ref(false);
const isExportingTexture = ref(false);
const isExportingOSMTexture = ref(false);
const isExportingHybridTexture = ref(false);
const isExportingSegmentedTexture = ref(false);
const isExportingSegmentedHybridTexture = ref(false);
const isExportingOSM = ref(false);
const isExportingRoadMask = ref(false);
const isExportingGeoTIFF = ref(false);
const isExportingDAE = ref(false);

const isExportingJob = ref(false);
const isImportingJob = ref(false);
const jobStatus = ref('');
const jobFileInput = ref(null);

const handleExportJob = async () => {
    if (!props.terrainData) return;
    isExportingJob.value = true;
    jobStatus.value = 'Preparing job data...';
    try {
        const blob = await exportJobData(props.terrainData, props.generationCacheKey);
        const date = new Date().toISOString().slice(0, 10);
        const lat = props.center.lat.toFixed(4);
        const lng = props.center.lng.toFixed(4);
        const filename = `MapNG_Job_${date}_${lat}_${lng}.mapng`;
        triggerDownload(blob, filename);
        jobStatus.value = 'Job exported successfully.';
    } catch (e) {
        console.error('Job export failed:', e);
        jobStatus.value = 'Job export failed.';
    } finally {
        isExportingJob.value = false;
    }
};

const handleImportJobFile = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    isImportingJob.value = true;
    jobStatus.value = 'Importing job data...';
    try {
        const data = await importJobData(file);
        emit('importData', data);
        jobStatus.value = 'Job imported successfully.';
    } catch (e) {
        console.error('Job import failed:', e);
        jobStatus.value = 'Job import failed: ' + e.message;
    } finally {
        isImportingJob.value = false;
        if (jobFileInput.value) jobFileInput.value.value = '';
    }
};
const isAnyExporting = computed(() => (
    isExportingGLB.value ||
    isExportingHeightmap.value ||
    isExportingTexture.value ||
    isExportingOSMTexture.value ||
    isExportingHybridTexture.value ||
    isExportingSegmentedTexture.value ||
    isExportingSegmentedHybridTexture.value ||
    isExportingOSM.value ||
    isExportingRoadMask.value ||
    isExportingGeoTIFF.value ||
    isExportingDAE.value
));
const modelCenterTextureType = ref('none');
const modelTileSelection = ref('center-only');
const fetchOSM = ref(localStorage.getItem('mapng_fetchOSM') !== 'false');
const useUSGS = ref(false);
const useGPXZ = ref(false);
const elevationSource = ref(localStorage.getItem('mapng_elevationSource') || 'default');
const gpxzApiKey = ref(localStorage.getItem('mapng_gpxzApiKey') || '');
const gpxzStatus = ref(null); // { plan, used, limit, remaining, concurrency, valid }
const isCheckingGPXZ = ref(false);
const usgsStatus = ref(null);

// Collapsible section states (persisted via localStorage, hidden by default)
const showElevationSource = ref(localStorage.getItem('mapng_showElevationSource') === 'true');
const showCoordinates = ref(localStorage.getItem('mapng_showCoordinates') === 'true');
const showExports = ref(localStorage.getItem('mapng_showExports') !== 'false'); // default open
const showExport2D = ref(localStorage.getItem('mapng_showExport2D') !== 'false'); // default open
const showExport3D = ref(localStorage.getItem('mapng_showExport3D') !== 'false'); // default open
const showExportGeo = ref(localStorage.getItem('mapng_showExportGeo') !== 'false'); // default open

const interestingLocations = [
  { name: "Select a location...", lat: 0, lng: 0, disabled: true },
  { name: "Angeles Crest Highway, USA", lat: 34.389292767087476, lng: -118.08463811874391 },
  { name: "Devils Tower, USA", lat: 44.59056, lng: -104.71511 },
  { name: "Grand Canyon, USA", lat: 36.05758, lng: -112.14236 },
  { name: "Johnson Valley OHV, USA", lat: 34.49523, lng: -116.82180 },
  { name: "Lombard Street, San Francisco, USA", lat: 37.80213155813396, lng: -122.41888135671617 },
  { name: "Million Dollar Highway, USA", lat: 37.9180, lng: -107.7002 },
  { name: "Mount Everest, Nepal", lat: 27.9881, lng: 86.9250 },
  { name: "Mount Fuji, Japan", lat: 35.3606, lng: 138.7274 },
  { name: "Matterhorn, Switzerland", lat: 45.9763, lng: 7.6586 },
  { name: "Rossfeld Panoramastraße, Germany", lat: 47.6087, lng: 13.0234 },
  { name: "Tail of the Dragon, USA", lat: 35.50323405090838, lng: -83.94679069519044 },
  { name: "Yosemite Valley, USA", lat: 37.7456, lng: -119.5936 }
];

const handleLocationSelect = (e) => {
    const idx = parseInt(e.target.value);
    if (idx > 0) {
        const loc = interestingLocations[idx];
        emit('locationChange', { lat: loc.lat, lng: loc.lng });
        // Reset selection to default
        e.target.selectedIndex = 0;
    }
};

// Handle Nominatim search result selection
const handleSearchSelect = (result) => {
    emit('locationChange', { lat: result.lat, lng: result.lng });
};

onMounted(async () => {
    // Initialize flags from persisted elevation source
    useUSGS.value = elevationSource.value === 'usgs';
    useGPXZ.value = elevationSource.value === 'gpxz';
    usgsStatus.value = await checkUSGSStatus();
});

// Watch for generation completion to scroll to export panel
watch(() => props.isGenerating, async (newVal) => {
    if (!newVal && props.terrainData) {
        await nextTick();
        exportPanel.value?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
});

// Sync elevation source with flags
watch(elevationSource, (newVal) => {
    useUSGS.value = newVal === 'usgs';
    useGPXZ.value = newVal === 'gpxz';
    localStorage.setItem('mapng_elevationSource', newVal);
});

// Persist OSM toggle
watch(fetchOSM, (newVal) => {
    localStorage.setItem('mapng_fetchOSM', String(newVal));
});

// Persist GPXZ API key
watch(gpxzApiKey, (newVal) => {
    localStorage.setItem('mapng_gpxzApiKey', newVal);
    // Reset status when key changes
    gpxzStatus.value = null;
});

// Check GPXZ account status
const checkGPXZStatus = async () => {
    if (!gpxzApiKey.value) return;
    isCheckingGPXZ.value = true;
    try {
        const info = await probeGPXZLimits(gpxzApiKey.value);
        gpxzStatus.value = info;
    } finally {
        isCheckingGPXZ.value = false;
    }
};

// Persist collapsible section states
watch(showElevationSource, (v) => localStorage.setItem('mapng_showElevationSource', String(v)));
watch(showCoordinates, (v) => localStorage.setItem('mapng_showCoordinates', String(v)));
watch(showExports, (v) => localStorage.setItem('mapng_showExports', String(v)));
watch(showExport2D, (v) => localStorage.setItem('mapng_showExport2D', String(v)));
watch(showExport3D, (v) => localStorage.setItem('mapng_showExport3D', String(v)));
watch(showExportGeo, (v) => localStorage.setItem('mapng_showExportGeo', String(v)));

// Watch for terrain data updates to handle fallback scenarios
watch(() => props.terrainData, (newData) => {
    if (newData?.usgsFallback) {
        elevationSource.value = 'default';
        alert("USGS 1m data for this area was missing or corrupt. Falling back on the Standard Terrarium dataset.\n\nMeters per pixel has been adjusted to the standard dataset resolution.");
    }
});

// Calculate resolution scale (Meters per Pixel)
// With the new pipeline, we enforce 1m/px for all sources.
const metersPerPixel = computed(() => {
  return 1.0;
});

// Calculate Area
const totalWidthMeters = computed(() => props.resolution * metersPerPixel.value);
const totalAreaSqM = computed(() => totalWidthMeters.value * totalWidthMeters.value);
const areaSqKm = computed(() => totalAreaSqM.value / 1000000);

// Check if the current parameters match the last successful generation
const isCached = computed(() => {
  if (!props.generationCacheKey || !props.terrainData) return false;
  const currentKey = JSON.stringify({
    lat: props.center.lat,
    lng: props.center.lng,
    resolution: props.resolution,
    osm: fetchOSM.value,
    usgs: useUSGS.value,
    gpxz: useGPXZ.value,
    gpxzKey: useGPXZ.value ? gpxzApiKey.value : '',
  });
  return currentKey === props.generationCacheKey;
});

const isAreaLargeForGPXZ = computed(() => {
    return useGPXZ.value && areaSqKm.value > 10;
});

const areaDisplay = computed(() => {
  return totalAreaSqM.value > 1000000 
    ? `${areaSqKm.value.toFixed(2)} km²`
    : `${Math.round(totalAreaSqM.value).toLocaleString()} m²`;
});

// Generate a small grayscale heightmap preview
const heightmapPreviewUrl = computed(() => {
    if (!props.terrainData?.heightMap) return null;
    const src = props.terrainData;
    const size = 128;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    const imgData = ctx.createImageData(size, size);
    const range = src.maxHeight - src.minHeight;
    const stepX = src.width / size;
    const stepY = src.height / size;
    for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
            const srcX = Math.min(Math.floor(x * stepX), src.width - 1);
            const srcY = Math.min(Math.floor(y * stepY), src.height - 1);
            const h = src.heightMap[srcY * src.width + srcX];
            const v = range > 0 ? Math.floor(((h - src.minHeight) / range) * 255) : 0;
            const idx = (y * size + x) * 4;
            imgData.data[idx] = v;
            imgData.data[idx + 1] = v;
            imgData.data[idx + 2] = v;
            imgData.data[idx + 3] = 255;
        }
    }
    ctx.putImageData(imgData, 0, 0);
    return canvas.toDataURL('image/png');
});

// Generate a small road mask preview
const roadMaskPreviewUrl = computed(() => {
    if (!props.terrainData?.osmFeatures || props.terrainData.osmFeatures.length === 0) return null;
    const size = 128;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    const src = props.terrainData;
    const scaleX = size / src.width;
    const scaleY = size / src.height;
    ctx.fillStyle = 'black';
    ctx.fillRect(0, 0, size, size);
    const toLocal = createWGS84ToLocal(props.center.lat, props.center.lng);
    ctx.strokeStyle = 'white';
    ctx.lineWidth = Math.max(2, 8 * scaleX);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    src.osmFeatures.forEach(feature => {
        if (feature.type !== 'road') return;
        const highway = feature.tags?.highway;
        const exclude = ['footway', 'path', 'pedestrian', 'steps', 'cycleway', 'bridleway', 'corridor'];
        if (highway && exclude.includes(highway)) return;
        ctx.beginPath();
        feature.geometry.forEach((pt, index) => {
            const [x, y] = toLocal.forward([pt.lng, pt.lat]);
            const u = (x + src.width / 2) * scaleX;
            const v = (src.height / 2 - y) * scaleY;
            if (index === 0) ctx.moveTo(u, v);
            else ctx.lineTo(u, v);
        });
        ctx.stroke();
    });
    return canvas.toDataURL('image/png');
});

const buildRunConfiguration = () => {
    return {
        schemaVersion: 1,
        mode: 'single',
        center: { ...props.center },
        zoom: props.zoom ?? null,
        resolution: props.resolution,
        includeOSM: fetchOSM.value,
        elevationSource: elevationSource.value,
        useUSGS: useUSGS.value,
        useGPXZ: useGPXZ.value,
        gpxzApiKey: gpxzApiKey.value || '',
        gpxzStatus: gpxzStatus.value ? { ...gpxzStatus.value } : cloneRateLimitInfo(),
        modelOptions: {
            centerTextureType: modelCenterTextureType.value,
            tileSelection: modelTileSelection.value,
            includeSurroundings: modelTileSelection.value !== 'center-only',
        },
        terrain: props.terrainData ? {
            width: props.terrainData.width,
            height: props.terrainData.height,
            bounds: props.terrainData.bounds,
            minHeight: props.terrainData.minHeight,
            maxHeight: props.terrainData.maxHeight,
        } : null,
        textureModes: {
            satellite: !!props.terrainData?.satelliteTextureUrl,
            osm: !!props.terrainData?.osmTextureUrl,
            hybrid: !!props.terrainData?.hybridTextureUrl,
            segmentedSatellite: !!props.terrainData?.segmentedTextureUrl,
            segmentedHybrid: !!props.terrainData?.segmentedHybridTextureUrl,
            roadMask: !!props.terrainData?.osmFeatures?.length,
        },
        osmQuery: props.terrainData?.osmRequestInfo || null,
    };
};

const buildExportMetadata = (exportType, filename, extra = {}) => {
    const runCfg = buildRunConfiguration();
    return buildCommonTraceMetadata({
        mode: 'single',
        center: runCfg.center,
        zoom: runCfg.zoom,
        resolution: runCfg.resolution,
        terrainData: props.terrainData,
        textureModes: runCfg.textureModes,
        osmQuery: runCfg.osmQuery,
        gpxz: runCfg.gpxzStatus,
        extra: {
            export: {
                type: exportType,
                filename,
            },
            runConfiguration: runCfg,
            ...extra,
        },
    });
};

const ENABLE_METADATA_SIDECARS = false;

const isJsonMimeType = (mime = '') => {
    const normalized = String(mime).toLowerCase();
    return normalized.includes('application/json') || normalized.includes('text/json');
};

const inferMimeTypeFromFilename = (filename = '') => {
    const lower = String(filename).toLowerCase();
    if (lower.endsWith('.zip')) return 'application/zip';
    if (lower.endsWith('.tif') || lower.endsWith('.tiff')) return 'image/tiff';
    return null;
};

const ensureDownloadBlobType = async (blob, expectedMimeType, fallbackMimeType = expectedMimeType) => {
    if (!blob) throw new Error(`Missing export blob for ${expectedMimeType}.`);

    if (isJsonMimeType(blob.type)) {
        throw new Error(`Received JSON payload instead of ${expectedMimeType} export data.`);
    }

    const currentType = String(blob.type || '').toLowerCase();
    const expectedType = String(expectedMimeType || '').toLowerCase();

    if (!expectedType || currentType === expectedType) {
        if (!blob.type && (fallbackMimeType || expectedMimeType)) {
            const buffer = await blob.arrayBuffer();
            return new Blob([buffer], { type: fallbackMimeType || expectedMimeType });
        }
        return blob;
    }

    const buffer = await blob.arrayBuffer();
    return new Blob([buffer], { type: fallbackMimeType || expectedMimeType || 'application/octet-stream' });
};

const downloadBlobUrlAsFile = async (url, filename, expectedMimePrefix = 'image/', fallbackMimeType = 'application/octet-stream') => {
    const response = await fetch(url);
    const blob = await response.blob();

    if (isJsonMimeType(blob.type)) {
        throw new Error(`Received JSON payload for ${filename} instead of binary file.`);
    }

    let outBlob = blob;
    const hasExpectedType = expectedMimePrefix
        ? (blob.type || '').toLowerCase().startsWith(expectedMimePrefix.toLowerCase())
        : true;

    if (!hasExpectedType || !blob.type) {
        const buffer = await blob.arrayBuffer();
        outBlob = new Blob([buffer], { type: fallbackMimeType });
    }

    const typedBlob = await ensureDownloadBlobType(outBlob, fallbackMimeType, fallbackMimeType);
    triggerDownload(typedBlob, filename);
};

const triggerDownload = (blob, filename) => {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.download = filename;
    link.href = url;
    link.click();
    URL.revokeObjectURL(url);
};

const yieldToUi = async () => {
    await nextTick();
    await new Promise((resolve) => {
        requestAnimationFrame(() => {
            setTimeout(resolve, 0);
        });
    });
};

const downloadMetadataSidecar = (exportFilename, metadata) => {
    if (!ENABLE_METADATA_SIDECARS) return;
    const baseName = exportFilename.replace(/\.[^.]+$/, '');
    downloadJsonFile(metadata, `${baseName}.metadata.json`);
};

const copyRunConfiguration = async () => {
    const payload = buildRunConfiguration();
    const text = JSON.stringify(payload, null, 2);
    try {
        if (navigator.clipboard?.writeText) {
            await navigator.clipboard.writeText(text);
            runConfigStatus.value = 'Run configuration copied to clipboard.';
            return;
        }
    } catch {
    }
    runConfigStatus.value = 'Clipboard write unavailable in this browser/session.';
};

const pasteRunConfiguration = async () => {
    try {
        if (!navigator.clipboard?.readText) {
            runConfigStatus.value = 'Clipboard read unavailable in this browser/session.';
            return;
        }
        const text = await navigator.clipboard.readText();
        if (!text?.trim()) {
            runConfigStatus.value = 'Clipboard is empty.';
            return;
        }
        const json = JSON.parse(text);
        applyRunConfiguration(json);
        runConfigStatus.value = 'Configuration pasted from clipboard.';
    } catch (error) {
        console.error('Failed to paste run configuration:', error);
        runConfigStatus.value = 'Clipboard content is not valid configuration JSON.';
    }
};

const saveRunConfiguration = () => {
    const payload = buildRunConfiguration();
    downloadJsonFile(payload, `MapNG_RunConfig_${new Date().toISOString().slice(0, 10)}.json`);
    runConfigStatus.value = 'Configuration downloaded as JSON.';
};

const applyRunConfiguration = (config) => {
    const src = config?.runConfiguration || config;
    if (!src || typeof src !== 'object') throw new Error('Invalid JSON schema');

    if (src.center && Number.isFinite(src.center.lat) && Number.isFinite(src.center.lng)) {
        emit('locationChange', { lat: src.center.lat, lng: src.center.lng });
    }
    if (Number.isFinite(src.resolution)) {
        emit('resolutionChange', parseInt(src.resolution));
    }
    if (typeof src.includeOSM === 'boolean') {
        fetchOSM.value = src.includeOSM;
    }
    if (typeof src.elevationSource === 'string' && ['default', 'usgs', 'gpxz'].includes(src.elevationSource)) {
        elevationSource.value = src.elevationSource;
    }
    if (typeof src.gpxzApiKey === 'string') {
        gpxzApiKey.value = src.gpxzApiKey;
    }
    if (src.gpxzStatus && typeof src.gpxzStatus === 'object') {
        gpxzStatus.value = { ...src.gpxzStatus };
    }
    if (src.modelOptions && typeof src.modelOptions === 'object') {
        if (
            typeof src.modelOptions.centerTextureType === 'string' &&
            ['satellite', 'osm', 'hybrid', 'segmented', 'segmentedHybrid', 'none'].includes(src.modelOptions.centerTextureType)
        ) {
            modelCenterTextureType.value = src.modelOptions.centerTextureType;
        }
        if (
            typeof src.modelOptions.tileSelection === 'string' &&
            ['center-only', 'center-plus-surroundings', 'surroundings-only'].includes(src.modelOptions.tileSelection)
        ) {
            modelTileSelection.value = src.modelOptions.tileSelection;
        } else if (typeof src.modelOptions.includeSurroundings === 'boolean') {
            modelTileSelection.value = src.modelOptions.includeSurroundings ? 'center-plus-surroundings' : 'center-only';
        }
    }
};

const getModelTileExportOptions = () => {
    const availableTextureType = (requestedType) => {
        const requested = String(requestedType || 'osm');
        const available = {
            satellite: !!props.terrainData?.satelliteTextureUrl,
            osm: !!props.terrainData?.osmTextureUrl,
            hybrid: !!props.terrainData?.hybridTextureUrl,
            segmented: !!props.terrainData?.segmentedTextureUrl,
            segmentedHybrid: !!props.terrainData?.segmentedHybridTextureUrl,
            none: true,
        };

        if (available[requested]) return requested;
        if (available.osm) return 'osm';
        if (available.hybrid) return 'hybrid';
        if (available.segmented) return 'segmented';
        if (available.segmentedHybrid) return 'segmentedHybrid';
        if (available.satellite) return 'satellite';
        return 'none';
    };

    const includeCenterTile = modelTileSelection.value !== 'surroundings-only';
    const includeSurroundings = modelTileSelection.value !== 'center-only';
    return {
        includeCenterTile,
        includeSurroundings,
        tileSelection: modelTileSelection.value,
        centerTextureType: availableTextureType(modelCenterTextureType.value),
    };
};

const handleRunConfigFile = async (event) => {
    const input = event.target;
    const file = input.files?.[0];
    if (!file) return;

    try {
        const text = await file.text();
        const json = JSON.parse(text);
        applyRunConfiguration(json);
        runConfigStatus.value = 'Configuration loaded. Generate to rerun with these settings.';
    } catch (error) {
        console.error('Failed to load run configuration:', error);
        runConfigStatus.value = 'Invalid configuration file.';
    } finally {
        input.value = '';
    }
};

const downloadHeightmap = async () => {
  if (!props.terrainData) return;
  isExportingHeightmap.value = true;
    await yieldToUi();

  try {
      // Dynamic import removed (now static)

      const width = props.terrainData.width;
      const height = props.terrainData.height;
      const data = new Uint16Array(width * height);
      
      const range = props.terrainData.maxHeight - props.terrainData.minHeight;
      
      for (let i = 0; i < props.terrainData.heightMap.length; i++) {
          const h = props.terrainData.heightMap[i];
          let val = 0;
          if (range > 0) {
               val = Math.floor(((h - props.terrainData.minHeight) / range) * 65535);
          }
          val = Math.max(0, Math.min(65535, val));
          data[i] = val;

                    if (i > 0 && i % 262144 === 0) {
                        await yieldToUi();
                    }
      }

            await yieldToUi();
  
      const pngData = encode({
          width,
          height,
          data,
          depth: 16,
          channels: 1,
      });
  
      const blob = new Blob([new Uint8Array(pngData)], { type: 'image/png' });
    const filename = `Heightmap_16bit_${props.resolution}px_${props.center.lat.toFixed(4)}_${props.center.lng.toFixed(4)}.png`;
        triggerDownload(blob, filename);

    downloadMetadataSidecar(filename, buildExportMetadata('heightmap_16bit_png', filename));
  } catch (error) {
      console.error("Failed to load PNG encoder", error);
      alert("Failed to generate PNG. Please try again.");
  } finally {
      isExportingHeightmap.value = false;
  }
};

const downloadTexture = async () => {
    if(!props.terrainData?.satelliteTextureUrl) return;
    isExportingTexture.value = true;
    await yieldToUi();
    
    try {
        // Convert satellite to PNG for consistency
        const img = new Image();
        img.crossOrigin = 'anonymous';
        await new Promise((resolve, reject) => {
            img.onload = resolve;
            img.onerror = reject;
            img.src = props.terrainData.satelliteTextureUrl;
        });
        const canvas = document.createElement('canvas');
        canvas.width = img.width;
        canvas.height = img.height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0);

        const blob = await new Promise((resolve) => {
            canvas.toBlob((value) => resolve(value || null), 'image/png');
        });
        if (!blob) throw new Error('Failed to create satellite PNG blob.');
        const filename = `Satellite_${props.resolution}px_${props.center.lat.toFixed(4)}_${props.center.lng.toFixed(4)}.png`;
        const typedBlob = await ensureDownloadBlobType(blob, 'image/png');
        triggerDownload(typedBlob, filename);
        downloadMetadataSidecar(filename, buildExportMetadata('satellite_png', filename));
    } catch (error) {
        // Fallback: fetch URL as blob and enforce PNG download semantics
        console.warn('Satellite canvas export failed, falling back to blob fetch:', error);
        const filename = `Satellite_${props.resolution}px_${props.center.lat.toFixed(4)}_${props.center.lng.toFixed(4)}.png`;
        await downloadBlobUrlAsFile(props.terrainData.satelliteTextureUrl, filename, 'image/', 'image/png');
        downloadMetadataSidecar(filename, buildExportMetadata('satellite_png', filename));
    } finally {
        isExportingTexture.value = false;
    }
};

const downloadOSMTexture = async () => {
    if(!props.terrainData?.osmTextureUrl) return;
    isExportingOSMTexture.value = true;
    await yieldToUi();

    try {
        const filename = `OSM_Texture_${props.resolution}px_${props.center.lat.toFixed(4)}_${props.center.lng.toFixed(4)}.png`;
        await downloadBlobUrlAsFile(props.terrainData.osmTextureUrl, filename, 'image/', 'image/png');
        downloadMetadataSidecar(filename, buildExportMetadata('osm_texture_png', filename));
    } finally {
        isExportingOSMTexture.value = false;
    }
};

const downloadHybridTexture = async () => {
    if(!props.terrainData?.hybridTextureUrl) return;
    isExportingHybridTexture.value = true;
    await yieldToUi();

    try {
        const filename = `Hybrid_Texture_${props.resolution}px_${props.center.lat.toFixed(4)}_${props.center.lng.toFixed(4)}.png`;
        await downloadBlobUrlAsFile(props.terrainData.hybridTextureUrl, filename, 'image/', 'image/png');
        downloadMetadataSidecar(filename, buildExportMetadata('hybrid_texture_png', filename));
    } finally {
        isExportingHybridTexture.value = false;
    }
};

const downloadSegmentedTexture = async () => {
    if (!props.terrainData?.segmentedTextureUrl) return;
    isExportingSegmentedTexture.value = true;
    await yieldToUi();

    try {
        const filename = `Segmented_Satellite_${props.resolution}px_${props.center.lat.toFixed(4)}_${props.center.lng.toFixed(4)}.png`;
        await downloadBlobUrlAsFile(props.terrainData.segmentedTextureUrl, filename, 'image/', 'image/png');
        downloadMetadataSidecar(filename, buildExportMetadata('segmented_satellite_png', filename));
    } finally {
        isExportingSegmentedTexture.value = false;
    }
};

const downloadSegmentedHybridTexture = async () => {
    if (!props.terrainData?.segmentedHybridTextureUrl) return;
    isExportingSegmentedHybridTexture.value = true;
    await yieldToUi();

    try {
        const filename = `Segmented_Hybrid_${props.resolution}px_${props.center.lat.toFixed(4)}_${props.center.lng.toFixed(4)}.png`;
        await downloadBlobUrlAsFile(props.terrainData.segmentedHybridTextureUrl, filename, 'image/', 'image/png');
        downloadMetadataSidecar(filename, buildExportMetadata('segmented_hybrid_png', filename));
    } finally {
        isExportingSegmentedHybridTexture.value = false;
    }
};

const downloadOSM = async () => {
    if (!props.terrainData?.osmFeatures || props.terrainData.osmFeatures.length === 0) {
        alert("No OSM data available. Try enabling 'Include 3D Features' and generating again.");
        return;
    }
    
    isExportingOSM.value = true;
    await yieldToUi();

    try {
        const features = props.terrainData.osmFeatures.map((f) => {
            const coordinates = f.geometry.map((p) => [p.lng, p.lat]);
        
            let geometryType = 'LineString';
            let geometryCoordinates = coordinates;

            const isClosed = coordinates.length > 3 && 
                coordinates[0][0] === coordinates[coordinates.length-1][0] && 
                coordinates[0][1] === coordinates[coordinates.length-1][1];

            if (f.type === 'building' || (f.type === 'vegetation' && isClosed)) {
                 geometryType = 'Polygon';
                 geometryCoordinates = [coordinates];
            }

            return {
                type: "Feature",
                properties: {
                    id: f.id,
                    feature_type: f.type,
                    ...f.tags
                },
                geometry: {
                    type: geometryType,
                    coordinates: geometryCoordinates
                }
            };
        });

        const geoJSON = {
            type: "FeatureCollection",
            features: features
        };

        const blob = new Blob([JSON.stringify(geoJSON, null, 2)], { type: 'application/geo+json' });
        const url = URL.createObjectURL(blob);
        const filename = `MapNG_OSM_${props.resolution}px_${props.center.lat.toFixed(4)}_${props.center.lng.toFixed(4)}.geojson`;
    
        const link = document.createElement('a');
        link.download = filename;
        link.href = url;
        link.click();
        downloadMetadataSidecar(filename, buildExportMetadata('osm_geojson', filename, {
            featureCount: geoJSON.features.length,
        }));
    
        URL.revokeObjectURL(url);
    } finally {
        isExportingOSM.value = false;
    }
};

const downloadRoadMask = async () => {
    if (!props.terrainData || !props.terrainData.osmFeatures) return;
    isExportingRoadMask.value = true;
    await yieldToUi();

    try {
        // Dynamic imports removed (now static)

        const width = props.terrainData.width;
        const height = props.terrainData.height;
        
        // Create canvas for drawing
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (!ctx) throw new Error("Could not get canvas context");

        // Fill black
        ctx.fillStyle = 'black';
        ctx.fillRect(0, 0, width, height);

        // Setup projection
        const center = props.center;
        const toLocal = createWGS84ToLocal(center.lat, center.lng);

        // Draw roads
        ctx.strokeStyle = 'white';
        ctx.lineWidth = 8; 
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';

        props.terrainData.osmFeatures.forEach(feature => {
            if (feature.type === 'road') {
                // Exclude footpaths and non-drivable paths
                const highway = feature.tags?.highway;
                const exclude = ['footway', 'path', 'pedestrian', 'steps', 'cycleway', 'bridleway', 'corridor'];
                if (highway && exclude.includes(highway)) return;

                ctx.beginPath();
                feature.geometry.forEach((pt, index) => {
                    const [x, y] = toLocal.forward([pt.lng, pt.lat]);
                    // Map to pixel coords
                    // Top-left of grid is (-width/2, height/2)
                    const u = x + width / 2;
                    const v = height / 2 - y;
                    
                    if (index === 0) ctx.moveTo(u, v);
                    else ctx.lineTo(u, v);
                });
                ctx.stroke();
            }
        });

        // Convert to 16-bit grayscale PNG
        const imageData = ctx.getImageData(0, 0, width, height);
        const data = new Uint16Array(width * height);
        
        for (let i = 0; i < data.length; i++) {
            // If pixel is lit, set to max 16-bit value
            // Check red channel (index 0, 4, 8...)
            if (imageData.data[i * 4] > 128) { 
                data[i] = 65535;
            } else {
                data[i] = 0;
            }

            if (i > 0 && i % 262144 === 0) {
                await yieldToUi();
            }
        }

        await yieldToUi();

        const pngData = encode({
            width,
            height,
            data,
            depth: 16,
            channels: 1,
        });

        const blob = new Blob([new Uint8Array(pngData)], { type: 'image/png' });
        const url = URL.createObjectURL(blob);
        const filename = `RoadMask_16bit_${props.resolution}px_${props.center.lat.toFixed(4)}_${props.center.lng.toFixed(4)}.png`;
        const link = document.createElement('a');
        link.download = filename;
        link.href = url;
        link.click();
        downloadMetadataSidecar(filename, buildExportMetadata('road_mask_16bit_png', filename));
        URL.revokeObjectURL(url);

    } catch (e) {
        console.error("Road mask export failed:", e);
        alert("Failed to export road mask.");
    } finally {
        isExportingRoadMask.value = false;
    }
};

const downloadGeoTIFF = async () => {
    if (!props.terrainData) return;
    isExportingGeoTIFF.value = true;
    await yieldToUi();

    try {
        const { blob, filename } = await exportGeoTiff(props.terrainData, props.center);
        const expectedMimeType = inferMimeTypeFromFilename(filename) || 'image/tiff';
        const typedBlob = await ensureDownloadBlobType(blob, expectedMimeType, expectedMimeType);
        triggerDownload(typedBlob, filename);
                downloadMetadataSidecar(filename, buildExportMetadata('geotiff', filename, {
                    geotiffSource: props.terrainData?.sourceGeoTiffs?.source || 'wgs84',
                }));
    } catch (e) {
        console.error("GeoTIFF export failed:", e);
        alert("Failed to export GeoTIFF.");
    } finally {
        isExportingGeoTIFF.value = false;
    }
};

const handleGLBExport = async () => {
  if (!props.terrainData) return;
  isExportingGLB.value = true;
    await yieldToUi();
  try {
                const tileExportOptions = getModelTileExportOptions();
        const blob = await exportToGLB(props.terrainData, {
            includeSurroundings: tileExportOptions.includeSurroundings,
            includeCenterTile: tileExportOptions.includeCenterTile,
            tileSelection: tileExportOptions.tileSelection,
            centerTextureType: tileExportOptions.centerTextureType,
            returnBlob: true,
    });
        const date = new Date().toISOString().slice(0, 10);
        const lat = ((props.terrainData.bounds.north + props.terrainData.bounds.south) / 2).toFixed(4);
        const lng = ((props.terrainData.bounds.east + props.terrainData.bounds.west) / 2).toFixed(4);
        const filename = `MapNG_Model_${date}_${lat}_${lng}.glb`;
        const typedBlob = await ensureDownloadBlobType(blob, 'model/gltf-binary', 'application/octet-stream');
        triggerDownload(typedBlob, filename);
        downloadMetadataSidecar(filename, buildExportMetadata('glb_model', filename, {
            modelOptions: {
                centerTextureType: tileExportOptions.centerTextureType,
                includeSurroundings: tileExportOptions.includeSurroundings,
                includeCenterTile: tileExportOptions.includeCenterTile,
                tileSelection: tileExportOptions.tileSelection,
            },
        }));
  } catch (error) {
    console.error("GLB Export failed:", error);
    alert("Failed to export GLB.");
  } finally {
    isExportingGLB.value = false;
  }
};

const handleDAEExport = async () => {
  if (!props.terrainData) return;
  isExportingDAE.value = true;
    await yieldToUi();
  try {
                const tileExportOptions = getModelTileExportOptions();
        const blob = await exportToDAE(props.terrainData, {
            includeSurroundings: tileExportOptions.includeSurroundings,
            includeCenterTile: tileExportOptions.includeCenterTile,
            tileSelection: tileExportOptions.tileSelection,
            centerTextureType: tileExportOptions.centerTextureType,
            returnBlob: true,
    });
        const date = new Date().toISOString().slice(0, 10);
        const lat = ((props.terrainData.bounds.north + props.terrainData.bounds.south) / 2).toFixed(4);
        const lng = ((props.terrainData.bounds.east + props.terrainData.bounds.west) / 2).toFixed(4);
        const ext = blob?.type === 'application/zip' ? '.dae.zip' : '.dae';
        const filename = `MapNG_Model_${date}_${lat}_${lng}${ext}`;
        const typedBlob = ext === '.dae.zip'
            ? await ensureDownloadBlobType(blob, 'application/zip')
            : await ensureDownloadBlobType(blob, 'model/vnd.collada+xml', 'application/octet-stream');
        triggerDownload(typedBlob, filename);
        downloadMetadataSidecar(filename, buildExportMetadata('dae_model', filename, {
            modelOptions: {
                centerTextureType: tileExportOptions.centerTextureType,
                includeSurroundings: tileExportOptions.includeSurroundings,
                includeCenterTile: tileExportOptions.includeCenterTile,
                tileSelection: tileExportOptions.tileSelection,
            },
        }));
  } catch (error) {
    console.error("DAE Export failed:", error);
    alert("Failed to export Collada DAE.");
  } finally {
    isExportingDAE.value = false;
  }
};
</script>
