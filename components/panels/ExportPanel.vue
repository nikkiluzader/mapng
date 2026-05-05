<template>
  <div v-if="terrainData && !isGenerating" class="space-y-3 pt-4 border-t border-gray-200 dark:border-gray-600">
    <!-- Missing OSM Warning / Action -->
    <div v-if="!terrainData.osmFeatures || terrainData.osmFeatures.length === 0" class="bg-blue-50 dark:bg-blue-900/20 p-2 rounded border border-blue-100 dark:border-blue-800 flex items-center justify-between">
      <div class="text-[10px] text-blue-700 dark:text-blue-300 flex items-center gap-1.5">
        <Trees :size="12" />
        <span>{{ t('exportPanel.osmMissing') }}</span>
      </div>
      <button 
        @click="$emit('fetchOsm')"
        class="text-[10px] font-medium bg-blue-600 hover:bg-blue-700 text-white px-2 py-1 rounded transition-colors"
      >
        {{ t('exportPanel.fetchNow') }}
      </button>
    </div>

    <button
      @click="showExports = !showExports"
      class="w-full flex items-center justify-between text-sm font-medium text-emerald-600 dark:text-emerald-400 hover:text-[#FF6600] transition-colors group"
    >
      <span class="flex items-center gap-2">
        <Download :size="16" />
        {{ t('exportPanel.readyToExport') }}
        <span class="text-xs text-gray-500 dark:text-gray-400 font-normal">{{ terrainData.width }}x{{ terrainData.height }}</span>
      </span>
      <ChevronDown :size="14" :class="['transition-transform duration-200', showExports ? 'rotate-180' : '']" />
    </button>
    
    <template v-if="showExports">
      <!-- BeamNG Level -->
      <div class="space-y-1.5">
        <button
          @click="showExportBeamNG = !showExportBeamNG"
          class="w-full flex items-center justify-between group"
        >
          <div class="flex items-center gap-1.5">
            <h4 class="text-[10px] font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500 group-hover:text-[#FF6600] transition-colors">{{ t('exportPanel.beamngLevel') }}</h4>
            <span class="text-[8px] uppercase tracking-wider bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400 px-1.5 py-0.5 rounded font-bold">{{ t('exportPanel.experimental') }}</span>
          </div>
          <ChevronDown :size="12" :class="['text-gray-400 dark:text-gray-500 transition-transform duration-200', showExportBeamNG ? 'rotate-180' : '']" />
        </button>
        <div v-if="showExportBeamNG" class="space-y-1.5">
          <div class="flex items-center justify-between gap-2 px-0.5">
            <span class="text-[10px] text-gray-500 dark:text-gray-400 shrink-0">{{ t('exportPanel.levelName') }}</span>
            <input
              v-model="beamNGLevelName"
              @input="handleBeamNGLevelNameInput"
              type="text"
              maxlength="64"
              :placeholder="t('exportPanel.levelNamePlaceholder')"
              class="min-w-0 flex-1 text-[9px] bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded px-1.5 py-0.5 text-gray-600 dark:text-gray-300"
            />
          </div>

          <!-- Base texture selector -->
          <div class="flex items-center justify-between gap-2 px-0.5">
            <span class="text-[10px] text-gray-500 dark:text-gray-400 shrink-0">{{ t('exportPanel.baseTexture') }}</span>
            <select v-model="beamNGBaseTexture" class="text-[9px] bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded px-1.5 py-0.5 text-gray-600 dark:text-gray-300 cursor-pointer">
              <option value="none">{{ t('exportPanel.none') }}</option>
              <option value="hybrid" :disabled="!terrainData?.hybridTextureUrl && !terrainData?.hybridTextureCanvas">{{ t('exportPanel.satelliteHybrid') }}</option>
              <option value="satellite" :disabled="!terrainData?.satelliteTextureUrl">{{ t('exportPanel.satellite') }}</option>
              <option v-if="hasOsmData" value="osm" :disabled="!terrainData?.osmTextureUrl">{{ t('exportPanel.osm') }}</option>
            </select>
          </div>

          <!-- PBR terrain materials source selector -->
          <div class="flex items-center justify-between gap-2 px-0.5">
            <span class="text-[10px] text-gray-500 dark:text-gray-400 shrink-0">{{ t('exportPanel.pbrMaterials') }}</span>
            <select v-model="beamNGPbrSource" :disabled="!hasOsmData" class="text-[9px] bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded px-1.5 py-0.5 text-gray-600 dark:text-gray-300 cursor-pointer disabled:cursor-not-allowed disabled:opacity-60">
              <option value="none">{{ t('exportPanel.off') }}</option>
              <option v-if="hasOsmData" value="osm">{{ t('exportPanel.osmData') }}</option>
            </select>
          </div>

          <!-- Road export mode selector -->
          <div class="flex items-center justify-between gap-2 px-0.5">
            <span class="text-[10px] text-gray-500 dark:text-gray-400 shrink-0">{{ t('exportPanel.roads') }}</span>
            <select v-model="beamNGRoadType" :disabled="!hasOsmData" class="text-[9px] bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded px-1.5 py-0.5 text-gray-600 dark:text-gray-300 cursor-pointer disabled:cursor-not-allowed disabled:opacity-60">
              <option v-if="hasOsmData" value="architect">{{ t('exportPanel.roadTypeArchitect') }}</option>
              <option v-if="hasOsmData" value="mesh">{{ t('exportPanel.roadTypeMesh') }}</option>
              <option v-if="hasOsmData" value="decal">{{ t('exportPanel.roadTypeSpline') }}</option>
              <option value="none">{{ t('exportPanel.roadTypeNone') }}</option>
            </select>
          </div>

          <div class="flex items-center justify-between gap-2 px-0.5">
            <span class="text-[10px] text-gray-500 dark:text-gray-400 shrink-0">{{ t('exportPanel.flavor') }}</span>
            <select v-model="beamNGFlavorId" class="min-w-0 text-[9px] bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded px-1.5 py-0.5 text-gray-600 dark:text-gray-300 cursor-pointer">
              <option value="">{{ t('exportPanel.selectLevel') }}</option>
              <option v-for="flavor in beamNGFlavorOptions" :key="flavor.id" :value="flavor.id">
                {{ flavor.label }}
              </option>
            </select>
          </div>

          <!-- Surrounding terrain backdrop source -->
          <div class="flex items-center justify-between gap-2 px-0.5">
            <span class="text-[10px] text-gray-500 dark:text-gray-400 shrink-0">{{ t('exportPanel.includeBackdrop') }}</span>
            <select
              v-model="beamNGBackdropSource"
              :disabled="isCustomUploadTerrain"
              class="text-[9px] bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded px-1.5 py-0.5 text-gray-600 dark:text-gray-300 cursor-pointer disabled:cursor-not-allowed disabled:opacity-60"
            >
              <option value="off">Off</option>
              <option value="global30m">30m Global</option>
              <option value="usgs1m">USGS 1m</option>
              <option value="gpxz" :disabled="!canUseGpxzBackdrop">GPXZ</option>
            </select>
          </div>
          <div class="px-0.5 text-[9px] text-gray-500 dark:text-gray-400">
            <span v-if="beamNGBackdropSource === 'global30m'">Uses global terrain tiles for surrounding backdrop.</span>
            <span v-else-if="beamNGBackdropSource === 'usgs1m'">Uses USGS 1m elevation where available.</span>
            <span v-else-if="beamNGBackdropSource === 'gpxz'">Uses GPXZ elevation tiles for surrounding backdrop.</span>
            <span v-else>Surrounding backdrop disabled.</span>
          </div>

          <div class="flex items-center justify-between gap-2 px-0.5">
            <span class="text-[10px] text-gray-500 dark:text-gray-400 shrink-0">{{ t('exportPanel.includeBuildings') }}</span>
            <label class="flex items-center gap-1.5 cursor-pointer">
              <input type="checkbox" v-model="beamNGIncludeBuildings" :disabled="!hasOsmData" class="rounded border-gray-300 dark:border-gray-600 accent-[#FF6600] cursor-pointer disabled:cursor-not-allowed disabled:opacity-60" />
              <span class="text-[9px] text-gray-500 dark:text-gray-400">{{ t('exportPanel.exportBuildings') }}</span>
            </label>
          </div>

          <div class="flex items-center justify-between gap-2 px-0.5">
            <span class="text-[10px] text-gray-500 dark:text-gray-400 shrink-0">{{ t('exportPanel.applyFoundations') }}</span>
            <label class="flex items-center gap-1.5 cursor-pointer">
              <input type="checkbox" v-model="beamNGApplyFoundations" :disabled="!hasOsmData" class="rounded border-gray-300 dark:border-gray-600 accent-[#FF6600] cursor-pointer disabled:cursor-not-allowed disabled:opacity-60" />
              <span class="text-[9px] text-gray-500 dark:text-gray-400">{{ t('exportPanel.raiseUnderBuildings') }}</span>
            </label>
          </div>

          <div class="flex items-center justify-between gap-2 px-0.5">
            <span class="text-[10px] text-gray-500 dark:text-gray-400 shrink-0">{{ t('exportPanel.water') }}</span>
            <label class="flex items-center gap-1.5 cursor-pointer">
              <input type="checkbox" v-model="beamNGIncludeWater" :disabled="!hasOsmData" class="rounded border-gray-300 dark:border-gray-600 accent-[#FF6600] cursor-pointer disabled:cursor-not-allowed disabled:opacity-60" />
              <span class="text-[9px] text-gray-500 dark:text-gray-400">{{ t('exportPanel.lakesRivers') }}</span>
            </label>
          </div>

          <div class="flex items-center justify-between gap-2 px-0.5">
            <span class="text-[10px] text-gray-500 dark:text-gray-400 shrink-0">{{ t('exportPanel.seaLevelOffset') }}</span>
            <div class="flex items-center gap-1">
              <input
                v-model.number="beamNGSeaLevelOffset"
                type="number"
                step="1"
                min="-2000"
                max="2000"
                class="w-20 text-[9px] bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded px-1.5 py-0.5 text-gray-600 dark:text-gray-300"
              />
              <span class="text-[9px] text-gray-500 dark:text-gray-400">m</span>
            </div>
          </div>

          <div class="flex items-center justify-between gap-2 px-0.5">
            <span class="text-[10px] text-gray-500 dark:text-gray-400 shrink-0">{{ t('exportPanel.treesBushes') }}</span>
            <label class="flex items-center gap-1.5 cursor-pointer">
              <input type="checkbox" v-model="beamNGIncludeTrees" :disabled="!hasOsmData" class="rounded border-gray-300 dark:border-gray-600 accent-[#FF6600] cursor-pointer disabled:cursor-not-allowed disabled:opacity-60" />
              <span class="text-[9px] text-gray-500 dark:text-gray-400">{{ t('exportPanel.nativeForest') }}</span>
            </label>
          </div>

          <div class="flex items-center justify-between gap-2 px-0.5">
            <span class="text-[10px] text-gray-500 dark:text-gray-400 shrink-0">{{ t('exportPanel.rocks') }}</span>
            <label class="flex items-center gap-1.5 cursor-pointer">
              <input type="checkbox" v-model="beamNGIncludeRocks" :disabled="!hasOsmData" class="rounded border-gray-300 dark:border-gray-600 accent-[#FF6600] cursor-pointer disabled:cursor-not-allowed disabled:opacity-60" />
              <span class="text-[9px] text-gray-500 dark:text-gray-400">{{ t('exportPanel.quarryRock') }}</span>
            </label>
          </div>

          <div class="px-2 py-1.5 rounded border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/20">
            <p class="text-[9px] text-amber-800 dark:text-amber-300 leading-snug">
              {{ t('exportPanel.communityQualityNotice') }}
            </p>
          </div>

          <div v-if="beamNGFlavorRequired && !beamNGFlavorId" class="px-0.5 text-[9px] text-amber-600 dark:text-amber-400">
            {{ t('exportPanel.chooseFlavor') }}
          </div>

          <!-- Export button -->
          <button
            @click="handleBeamNGLevelExport"
            :disabled="isAnyExporting || (beamNGFlavorRequired && !beamNGFlavorId)"
            class="relative w-full flex items-center gap-3 p-3 bg-[#FF6600] hover:bg-[#e85d00] border border-[#d65500] rounded text-white transition-colors group disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <div class="flex items-center justify-center w-8 h-8 shrink-0">
              <Loader2 v-if="isExportingBeamNGLevel" :size="20" class="animate-spin text-white" />
              <PackageOpen v-else :size="20" class="text-white/90" />
            </div>
            <div class="text-left">
              <div class="text-[12px] font-semibold">{{ t('exportPanel.beamngLevelExport') }}</div>
              <div class="text-[10px] text-white/90">{{ t('exportPanel.generatePlayableZip') }}</div>
            </div>
            <Download v-if="!isAnyExporting" :size="10" class="absolute top-1 right-1 opacity-70 group-hover:opacity-100 transition-opacity text-white" />
          </button>

          <a
            v-if="beamNGPendingDownloadUrl"
            :href="beamNGPendingDownloadUrl"
            :download="beamNGPendingDownloadName || 'beamng_level.zip'"
            @click="handleBeamNGPendingDownloadClick"
            class="w-full flex items-center justify-center gap-2 p-2 bg-emerald-600 hover:bg-emerald-700 border border-emerald-700 rounded text-white text-[11px] font-medium transition-colors"
          >
            <Download :size="14" />
            Download Ready: {{ beamNGPendingDownloadName || 'beamng_level.zip' }}
          </a>
        </div>
      </div>

      <!-- 2D Assets -->
      <div class="space-y-1.5">
        <button
          @click="showExport2D = !showExport2D"
          class="w-full flex items-center justify-between group"
        >
          <h4 class="text-[10px] font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500 group-hover:text-[#FF6600] transition-colors">{{ t('exportPanel.assets2d') }}</h4>
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
              <Loader2 v-if="isExportingHeightmap" :size="20" class="animate-spin text-[#FF6600]" />
              <img v-else-if="heightmapPreviewUrl" :src="heightmapPreviewUrl" class="w-full h-full object-cover" />
              <Mountain v-else :size="24" class="text-gray-400 dark:text-gray-500" />
            </div>
            <span class="text-[11px] font-medium">{{ t('exportPanel.heightmap') }}</span>
            <span class="text-[10px] text-gray-500 dark:text-gray-400">{{ terrainData.width }}px 16-bit grayscale PNG</span>
            <Download v-if="!isAnyExporting" :size="10" class="absolute top-1 right-1 opacity-0 group-hover:opacity-100 transition-opacity text-[#FF6600]" />
          </button>

          <!-- Satellite Texture -->
          <button 
            @click="downloadTexture"
            :disabled="isAnyExporting"
            class="relative flex flex-col items-center justify-center p-1.5 bg-white dark:bg-gray-800 hover:bg-gray-50 dark:hover:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded text-sm text-gray-700 dark:text-gray-300 transition-colors group disabled:opacity-50 disabled:cursor-not-allowed h-24 overflow-hidden"
          >
            <div class="w-full h-full flex items-center justify-center mb-0.5 overflow-hidden rounded bg-gray-100 dark:bg-gray-900">
              <Loader2 v-if="isExportingTexture" :size="20" class="animate-spin text-[#FF6600]" />
              <img v-else-if="satellitePreviewUrl" :src="satellitePreviewUrl" class="w-full h-full object-cover" />
              <Box v-else :size="24" class="text-gray-400 dark:text-gray-500" />
            </div>
            <span class="text-[11px] font-medium">{{ t('exportPanel.satellite') }}</span>
            <span class="text-[10px] text-gray-500 dark:text-gray-400">{{ terrainData.width }}px PNG</span>
            <Download v-if="!isAnyExporting" :size="10" class="absolute top-1 right-1 opacity-0 group-hover:opacity-100 transition-opacity text-[#FF6600]" />
          </button>

          <!-- OSM Texture -->
          <button 
            @click="downloadOSMTexture"
            :disabled="!terrainData.osmTextureUrl || isAnyExporting"
            class="relative flex flex-col items-center justify-center p-1.5 bg-white dark:bg-gray-800 hover:bg-gray-50 dark:hover:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded text-sm text-gray-700 dark:text-gray-300 transition-colors group disabled:opacity-50 disabled:cursor-not-allowed h-24 overflow-hidden"
          >
            <div class="w-full h-full flex items-center justify-center mb-0.5 overflow-hidden rounded bg-gray-100 dark:bg-gray-900">
              <Loader2 v-if="isExportingOSMTexture" :size="20" class="animate-spin text-[#FF6600]" />
              <img v-else-if="osmPreviewUrl" :src="osmPreviewUrl" class="w-full h-full object-cover" />
              <Trees v-else :size="24" class="text-gray-400 dark:text-gray-500" />
            </div>
            <span class="text-[11px] font-medium">{{ t('exportPanel.osmTexture') }}</span>
            <span class="text-[10px] text-gray-500 dark:text-gray-400">{{ terrainData.width }}px PNG</span>
            <Download v-if="!isAnyExporting" :size="10" class="absolute top-1 right-1 opacity-0 group-hover:opacity-100 transition-opacity text-[#FF6600]" />
          </button>

          <!-- Hybrid Texture -->
          <button 
            @click="downloadHybridTexture"
            :disabled="!terrainData.hybridTextureUrl || isAnyExporting"
            class="relative flex flex-col items-center justify-center p-1.5 bg-white dark:bg-gray-800 hover:bg-gray-50 dark:hover:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded text-sm text-gray-700 dark:text-gray-300 transition-colors group disabled:opacity-50 disabled:cursor-not-allowed h-24 overflow-hidden"
          >
            <div class="w-full h-full flex items-center justify-center mb-0.5 overflow-hidden rounded bg-gray-100 dark:bg-gray-900">
              <Loader2 v-if="isExportingHybridTexture" :size="20" class="animate-spin text-[#FF6600]" />
              <img v-else-if="hybridPreviewUrl" :src="hybridPreviewUrl" class="w-full h-full object-cover" />
              <Layers v-else :size="24" class="text-gray-400 dark:text-gray-500" />
            </div>
            <span class="text-[11px] font-medium">{{ t('exportPanel.satelliteHybrid') }}</span>
            <span class="text-[10px] text-gray-500 dark:text-gray-400">{{ terrainData.width }}px PNG</span>
            <Download v-if="!isAnyExporting" :size="10" class="absolute top-1 right-1 opacity-0 group-hover:opacity-100 transition-opacity text-[#FF6600]" />
          </button>

          <!-- Road Mask -->
          <button 
            @click="downloadRoadMask"
            :disabled="!terrainData.osmFeatures || terrainData.osmFeatures.length === 0 || isAnyExporting"
            class="relative flex flex-col items-center justify-center p-1.5 bg-white dark:bg-gray-800 hover:bg-gray-50 dark:hover:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded text-sm text-gray-700 dark:text-gray-300 transition-colors group disabled:opacity-50 disabled:cursor-not-allowed h-24 overflow-hidden"
          >
            <div class="w-full h-full flex items-center justify-center mb-0.5 overflow-hidden rounded bg-gray-100 dark:bg-gray-900">
              <Loader2 v-if="isExportingRoadMask" :size="20" class="animate-spin text-[#FF6600]" />
              <img v-else-if="roadMaskPreviewUrl" :src="roadMaskPreviewUrl" class="w-full h-full object-cover" />
              <Route v-else :size="24" class="text-gray-400 dark:text-gray-500" />
            </div>
            <span class="text-[11px] font-medium">{{ t('exportPanel.roadMask') }}</span>
            <span class="text-[10px] text-gray-500 dark:text-gray-400">{{ terrainData.width }}px 16-bit grayscale PNG</span>
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
          <h4 class="text-[10px] font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500 group-hover:text-[#FF6600] transition-colors">{{ t('exportPanel.models3d') }}</h4>
          <ChevronDown :size="12" :class="['text-gray-400 dark:text-gray-500 transition-transform duration-200', showExport3D ? 'rotate-180' : '']" />
        </button>

        <template v-if="showExport3D">
          <!-- Shared 3D options -->
          <div class="space-y-2 px-2 py-2 bg-gray-50 dark:bg-gray-700/50 rounded border border-gray-200 dark:border-gray-600">
            <div class="flex items-center gap-1.5">
              <span class="text-[9px] text-gray-500 dark:text-gray-400">{{ t('exportPanel.centerTexture') }}</span>
              <select v-model="modelCenterTextureType" class="text-[9px] bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded px-1.5 py-0.5 text-gray-600 dark:text-gray-300 cursor-pointer">
                <option value="satellite">{{ t('exportPanel.satellite') }}</option>
                <option value="osm" :disabled="!terrainData?.osmTextureUrl">{{ t('exportPanel.osm') }}</option>
                <option value="hybrid" :disabled="!terrainData?.hybridTextureUrl">{{ t('exportPanel.hybrid') }}</option>
                <option value="none">{{ t('exportPanel.none') }}</option>
              </select>
            </div>
            <div class="flex items-center gap-2 flex-nowrap overflow-x-auto whitespace-nowrap pb-0.5">
              <span class="text-[9px] text-gray-500 dark:text-gray-400">{{ t('exportPanel.tiles') }}</span>
              <label class="flex items-center gap-1 cursor-pointer">
                <input type="radio" v-model="modelTileSelection" value="center-only" class="accent-[#FF6600] w-3 h-3" />
                <span class="text-[9px] text-gray-500 dark:text-gray-400">{{ t('exportPanel.center') }}</span>
              </label>
              <label class="flex items-center gap-1 cursor-pointer">
                <input type="radio" v-model="modelTileSelection" value="center-plus-surroundings" class="accent-[#FF6600] w-3 h-3" />
                <span class="text-[9px] text-gray-500 dark:text-gray-400">{{ t('exportPanel.centerPlusSurroundings') }}</span>
              </label>
              <label class="flex items-center gap-1 cursor-pointer">
                <input type="radio" v-model="modelTileSelection" value="surroundings-only" class="accent-[#FF6600] w-3 h-3" />
                <span class="text-[9px] text-gray-500 dark:text-gray-400">{{ t('exportPanel.surroundingsOnly') }}</span>
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
                <Loader2 v-if="isExportingGLB" :size="20" class="animate-spin text-[#FF6600]" />
                <Box v-else :size="24" class="text-gray-400 dark:text-gray-500" />
              </div>
              <span class="text-[11px] font-medium">{{ t('exportPanel.glbModel') }}</span>
              <span class="text-[10px] text-gray-500 dark:text-gray-400">.glb binary</span>
              <Download v-if="!isAnyExporting" :size="10" class="absolute top-1 right-1 opacity-0 group-hover:opacity-100 transition-opacity text-[#FF6600]" />
            </button>

            <!-- DAE (Collada) Model -->
            <button 
              @click="handleDAEExport"
              :disabled="isAnyExporting"
              class="relative flex flex-col items-center justify-center p-2 bg-white dark:bg-gray-800 hover:bg-gray-50 dark:hover:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded text-sm text-gray-700 dark:text-gray-300 transition-colors group disabled:opacity-50 disabled:cursor-not-allowed h-20"
            >
              <div class="w-full h-full flex items-center justify-center mb-0.5">
                <Loader2 v-if="isExportingDAE" :size="20" class="animate-spin text-[#FF6600]" />
                <FileCode v-else :size="24" class="text-gray-400 dark:text-gray-500" />
              </div>
              <span class="text-[11px] font-medium">{{ t('exportPanel.colladaDae') }}</span>
              <span class="text-[10px] text-gray-500 dark:text-gray-400">.dae + textures</span>
              <Download v-if="!isAnyExporting" :size="10" class="absolute top-1 right-1 opacity-0 group-hover:opacity-100 transition-opacity text-[#FF6600]" />
            </button>
            
            <!-- TER (BeamNG) Model -->
            <button 
              @click="handleTERExport"
              :disabled="isAnyExporting"
              class="relative flex flex-col items-center justify-center p-2 bg-white dark:bg-gray-800 hover:bg-gray-50 dark:hover:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded text-sm text-gray-700 dark:text-gray-300 transition-colors group disabled:opacity-50 disabled:cursor-not-allowed h-20"
            >
              <div class="w-full h-full flex items-center justify-center mb-0.5">
                <Loader2 v-if="isExportingTER" :size="20" class="animate-spin text-[#FF6600]" />
                <FileCode v-else :size="24" class="text-gray-400 dark:text-gray-500" />
              </div>
              <span class="text-[11px] font-medium">{{ t('exportPanel.beamngTerrain') }}</span>
              <span class="text-[10px] text-gray-500 dark:text-gray-400">.ter heightmap</span>
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
          <h4 class="text-[10px] font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500 group-hover:text-[#FF6600] transition-colors">{{ t('exportPanel.geoData') }}</h4>
          <ChevronDown :size="12" :class="['text-gray-400 dark:text-gray-500 transition-transform duration-200', showExportGeo ? 'rotate-180' : '']" />
        </button>
        <div v-if="showExportGeo" class="space-y-2">
          <div class="grid grid-cols-2 gap-1.5">
            <!-- GeoTIFF -->
            <button 
              @click="downloadGeoTIFF"
              :disabled="isAnyExporting"
              class="relative flex flex-col items-center justify-center p-2 bg-white dark:bg-gray-800 hover:bg-gray-50 dark:hover:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded text-sm text-gray-700 dark:text-gray-300 transition-colors group disabled:opacity-50 disabled:cursor-not-allowed h-20"
            >
              <div class="w-full h-full flex items-center justify-center mb-0.5">
                <Loader2 v-if="isExportingGeoTIFF" :size="20" class="animate-spin text-[#FF6600]" />
                <FileCode v-else :size="24" class="text-gray-400 dark:text-gray-500" />
              </div>
              <span class="text-[11px] font-medium">{{ t('exportPanel.geoTiff') }}</span>
              <span class="text-[10px] text-gray-500 dark:text-gray-400">{{ terrainData?.sourceGeoTiffs ? terrainData.sourceGeoTiffs.source.toUpperCase() : 'WGS84' }}</span>
              <Download v-if="!isAnyExporting" :size="10" class="absolute top-1 right-1 opacity-0 group-hover:opacity-100 transition-opacity text-[#FF6600]" />
            </button>

            <!-- OSM GeoJSON -->
            <button 
              @click="downloadOSM"
              :disabled="!terrainData.osmFeatures || terrainData.osmFeatures.length === 0 || isAnyExporting"
              class="relative flex flex-col items-center justify-center p-2 bg-white dark:bg-gray-800 hover:bg-gray-50 dark:hover:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded text-sm text-gray-700 dark:text-gray-300 transition-colors group disabled:opacity-50 disabled:cursor-not-allowed h-20"
            >
              <div class="w-full h-full flex items-center justify-center mb-0.5">
                <Loader2 v-if="isExportingOSM" :size="20" class="animate-spin text-[#FF6600]" />
                <FileJson v-else :size="24" class="text-gray-400 dark:text-gray-500" />
              </div>
              <span class="text-[11px] font-medium">{{ t('exportPanel.geoJson') }}</span>
              <span class="text-[10px] text-gray-500 dark:text-gray-400">{{ t('exportPanel.osmVectors') }}</span>
              <Download v-if="!isAnyExporting" :size="10" class="absolute top-1 right-1 opacity-0 group-hover:opacity-100 transition-opacity text-[#FF6600]" />
            </button>
          </div>

          <div class="rounded border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/20 px-2.5 py-2 text-[10px] text-amber-800 dark:text-amber-300 leading-snug">
            <p>
              {{ t('exportPanel.cleanupToolNotice') }}
              <a
                href="https://github.com/alexkleinwaechter/BeamNG_LevelCleanUp/releases/tag/1.5.5"
                target="_blank"
                rel="noopener noreferrer"
                class="font-semibold text-[#FF6600] underline underline-offset-2 hover:text-[#e85d00] transition-colors"
              >
                {{ t('exportPanel.cleanupToolLinkLabel') }}
              </a>
              {{ t('exportPanel.cleanupToolCredit') }}
            </p>
          </div>
        </div>
      </div>
    </template>
  </div>

  <!-- BeamNG export progress modal -->
  <Teleport to="body">
    <Transition name="fade">
      <div
        v-if="isExportingBeamNGLevel"
        class="fixed inset-0 z-[9999] flex items-center justify-center bg-black/60 backdrop-blur-sm"
      >
        <div class="bg-white dark:bg-gray-900 rounded-xl shadow-2xl border border-gray-200 dark:border-gray-700 p-6 w-[calc(100vw-2rem)] max-w-md flex flex-col gap-4">
          <!-- Header -->
          <div class="flex items-center gap-3">
            <Loader2 :size="20" class="animate-spin text-[#FF6600] shrink-0" />
            <div>
              <div class="text-sm font-semibold text-gray-900 dark:text-gray-100">{{ t('exportPanel.exportingBeamng') }}</div>
              <div class="text-[11px] text-gray-500 dark:text-gray-400">{{ t('exportPanel.mayTakeWhile') }}</div>
            </div>
          </div>

          <!-- Progress bar -->
          <div class="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2 overflow-hidden">
            <div
              class="h-2 rounded-full bg-[#FF6600] transition-all duration-300 ease-out"
              :style="{ width: `${beamNGProgressPct}%` }"
            />
          </div>

          <!-- Step label -->
          <div class="flex justify-between items-start gap-2">
            <span class="min-w-0 flex-1 text-[11px] leading-snug text-gray-600 dark:text-gray-400 break-words">{{ beamNGProgressStep }}</span>
            <span class="text-[11px] font-mono text-[#FF6600] ml-2 shrink-0">{{ beamNGProgressPct }}%</span>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.15s ease;
}
.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}
</style>

<script setup>
import { ref, computed, watch, nextTick, onUnmounted } from 'vue';
import { useI18n } from 'vue-i18n';
import {
  Download, ChevronDown, Loader2, Mountain, Box, Trees, Layers, Route, FileCode, FileJson, PackageOpen
} from 'lucide-vue-next';
import { buildRunConfiguration as buildRunConfigurationBase } from '../../services/runConfiguration';
import { generateHeightmapBlob, generateTerBlob } from '../../services/batchExports';
import { exportToGLB, exportToDAE } from '../../services/export3d';
import { exportGeoTiff } from '../../services/exportGeoTiff';
import { buildCommonTraceMetadata, downloadJsonFile } from '../../services/traceability';
import { createWGS84ToLocal } from '../../services/geoUtils';
import { exportBeamNGLevel } from '../../services/exportBeamNGLevel';
import { prepareCroppedTerrainData } from '../../services/cropTerrain';
import { getBeamNGFlavorOptions } from '../../services/beamngFlavorCatalog.js';
import { reverseLocationName } from '../../services/nominatim';

const { t } = useI18n({ useScope: 'global' });

const props = defineProps({
  terrainData: { type: Object, default: null },
  isGenerating: { type: Boolean, default: false },
  center: { type: Object, required: true },
  zoom: { type: Number, required: true },
  resolution: { type: Number, required: true },
  elevationSource: { type: String, default: 'default' },
  gpxzApiKey: { type: String, default: '' },
  gpxzStatus: { type: Object, default: null },
  fetchOSM: { type: Boolean, default: true },
  surroundingTilePositions: { type: Array, default: () => [] },
});

const emit = defineEmits(['fetchOsm', 'exportSuccess']);
const BEAMNG_EXPORT_UI_LOG = '[BeamNG Export UI]';

// Export states
const isExportingHeightmap = ref(false);
const isExportingTexture = ref(false);
const isExportingOSMTexture = ref(false);
const isExportingHybridTexture = ref(false);
const isExportingRoadMask = ref(false);
const isExportingGeoTIFF = ref(false);
const isExportingGLB = ref(false);
const isExportingDAE = ref(false);
const isExportingTER = ref(false);
const isExportingOSM = ref(false);
const isExportingBeamNGLevel = ref(false);
const beamNGProgressStep = ref('');
const beamNGProgressPct  = ref(0);
const normalizeBeamNGSeaLevelOffset = (value) => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 0;
  return Math.max(-2000, Math.min(2000, numeric));
};
const resolveBeamNGBaseTexture = (terrainData, preferred = 'osm') => {
  const availableTextures = {
    none: true,
    osm: !!terrainData?.osmTextureUrl,
    hybrid: !!terrainData?.hybridTextureUrl || !!terrainData?.hybridTextureCanvas,
    satellite: !!terrainData?.satelliteTextureUrl,
  };

  if (availableTextures[preferred]) return preferred;
  return Object.keys(availableTextures).find((key) => availableTextures[key]) || preferred;
};

const beamNGBaseTexture = ref(resolveBeamNGBaseTexture(props.terrainData));
const legacyIncludeBackdrop = localStorage.getItem('mapng_beamNGIncludeBackdrop');
const beamNGBackdropSource = ref(
  localStorage.getItem('mapng_beamNGBackdropSource')
  || (legacyIncludeBackdrop === 'true' ? 'global30m' : 'off')
);
const beamNGIncludeBuildings = ref(localStorage.getItem('mapng_beamNGIncludeBuildings') !== 'false');
const beamNGApplyFoundations = ref(localStorage.getItem('mapng_beamNGApplyFoundations') !== 'false');
const beamNGIncludeWater = ref(localStorage.getItem('mapng_beamNGIncludeWater') !== 'false');
const beamNGSeaLevelOffset = ref(normalizeBeamNGSeaLevelOffset(localStorage.getItem('mapng_beamNGSeaLevelOffset')));
const beamNGIncludeTrees = ref(localStorage.getItem('mapng_beamNGIncludeTrees') !== 'false');
const beamNGIncludeRocks = ref(localStorage.getItem('mapng_beamNGIncludeRocks') === 'true');
// Migrate legacy boolean mesh road setting if it exists
const _legacyMesh = localStorage.getItem('mapng_beamNGUseMeshRoads');
let initialRoadType = localStorage.getItem('mapng_beamNGRoadType') || (_legacyMesh === 'true' ? 'mesh' : 'decal');
if (initialRoadType === 'spline') initialRoadType = 'decal'; // Migrate from old spline naming
const beamNGRoadType = ref(initialRoadType);
const beamNGFlavorOptions = getBeamNGFlavorOptions();
const persistedBeamNGFlavor = localStorage.getItem('mapng_beamNGFlavorId') || '';
const beamNGFlavorId = ref(beamNGFlavorOptions.some((flavor) => flavor.id === persistedBeamNGFlavor) ? persistedBeamNGFlavor : '');
const beamNGLevelName = ref('');
const beamNGSuggestedLevelName = ref('');
const beamNGLevelNameTouched = ref(false);
let beamNGLevelNameRequestId = 0;
const hasOsmData = computed(() => Array.isArray(props.terrainData?.osmFeatures) && props.terrainData.osmFeatures.length > 0);
const isCustomUploadTerrain = computed(() => !!props.terrainData?.elevationUnitApplied);
const beamNGFlavorRequired = computed(() => hasOsmData.value);
const canUseGpxzBackdrop = computed(() => props.elevationSource === 'gpxz' && !!props.gpxzApiKey);
const beamNGPendingDownloadUrl = ref('');
const beamNGPendingDownloadName = ref('');

const clearPendingBeamNGDownload = () => {
  if (beamNGPendingDownloadUrl.value) {
    const urlToRevoke = beamNGPendingDownloadUrl.value;
    setTimeout(() => URL.revokeObjectURL(urlToRevoke), 120_000);
  }
  beamNGPendingDownloadUrl.value = '';
  beamNGPendingDownloadName.value = '';
};

const isAnyExporting = computed(() => (
  isExportingHeightmap.value ||
  isExportingTexture.value ||
  isExportingOSMTexture.value ||
  isExportingHybridTexture.value ||
  isExportingRoadMask.value ||
  isExportingGeoTIFF.value ||
  isExportingGLB.value ||
  isExportingDAE.value ||
  isExportingTER.value ||
  isExportingOSM.value ||
  isExportingBeamNGLevel.value
));

const modelCenterTextureType = ref('none');
const modelTileSelection = ref('center-only');

// Collapsible section states
const showExports = ref(localStorage.getItem('mapng_showExports') !== 'false');
const showExport2D = ref(localStorage.getItem('mapng_showExport2D') !== 'false');
const showExport3D = ref(localStorage.getItem('mapng_showExport3D') !== 'false');
const showExportBeamNG = ref(localStorage.getItem('mapng_showExportBeamNG') !== 'false');
// Migrate legacy boolean value from old 'mapng_beamNGGeneratePbr' key.
const _legacyPbr = localStorage.getItem('mapng_beamNGGeneratePbr');
const _defaultPbrSource = localStorage.getItem('mapng_beamNGPbrSource')
  ?? (_legacyPbr === 'false' ? 'none' : 'osm');
const beamNGPbrSource = ref(_defaultPbrSource);
const showExportGeo = ref(localStorage.getItem('mapng_showExportGeo') !== 'false');

const THUMB_SIZE = 256;
const satellitePreviewUrl = ref('');
const osmPreviewUrl = ref('');
const hybridPreviewUrl = ref('');
let satellitePreviewToken = 0;
let osmPreviewToken = 0;
let hybridPreviewToken = 0;

const revokeObjectUrl = (url) => {
  if (!url || typeof url !== 'string') return;
  if (!url.startsWith('blob:')) return;
  URL.revokeObjectURL(url);
};

const clearPreviewUrl = (targetRef) => {
  revokeObjectUrl(targetRef.value);
  targetRef.value = '';
};

const createThumbnailUrlFromSource = async (sourceUrl, size = THUMB_SIZE) => {
  if (!sourceUrl) return '';
  const image = new Image();
  image.decoding = 'async';
  image.src = sourceUrl;

  await new Promise((resolve, reject) => {
    image.onload = () => resolve();
    image.onerror = () => reject(new Error('Failed to load texture preview source.'));
  });

  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) return '';
  ctx.drawImage(image, 0, 0, size, size);

  const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
  if (!blob) return '';
  return URL.createObjectURL(blob);
};

const updatePreviewUrl = async (sourceUrl, targetRef, nextToken) => {
  clearPreviewUrl(targetRef);
  if (!sourceUrl) return;
  try {
    const previewUrl = await createThumbnailUrlFromSource(sourceUrl);
    if (nextToken() === false) {
      revokeObjectUrl(previewUrl);
      return;
    }
    targetRef.value = previewUrl;
  } catch {
    // Keep preview empty on decode errors.
  }
};

watch(showExports, (v) => localStorage.setItem('mapng_showExports', String(v)));
watch(showExport2D, (v) => localStorage.setItem('mapng_showExport2D', String(v)));
watch(showExport3D, (v) => localStorage.setItem('mapng_showExport3D', String(v)));
watch(showExportBeamNG, (v) => localStorage.setItem('mapng_showExportBeamNG', String(v)));
watch(beamNGPbrSource, (v) => localStorage.setItem('mapng_beamNGPbrSource', v));
watch(beamNGBackdropSource, (v) => localStorage.setItem('mapng_beamNGBackdropSource', v));
watch(beamNGIncludeBuildings, (v) => localStorage.setItem('mapng_beamNGIncludeBuildings', String(v)));
watch(beamNGApplyFoundations, (v) => localStorage.setItem('mapng_beamNGApplyFoundations', String(v)));
watch(beamNGIncludeWater, (v) => localStorage.setItem('mapng_beamNGIncludeWater', String(v)));
watch(beamNGSeaLevelOffset, (v) => {
  const normalized = normalizeBeamNGSeaLevelOffset(v);
  if (normalized !== v) {
    beamNGSeaLevelOffset.value = normalized;
    return;
  }
  localStorage.setItem('mapng_beamNGSeaLevelOffset', String(normalized));
});
watch(beamNGIncludeTrees, (v) => localStorage.setItem('mapng_beamNGIncludeTrees', String(v)));
watch(beamNGIncludeRocks, (v) => localStorage.setItem('mapng_beamNGIncludeRocks', String(v)));
watch(beamNGRoadType, (v) => localStorage.setItem('mapng_beamNGRoadType', v));
watch(beamNGFlavorId, (v) => localStorage.setItem('mapng_beamNGFlavorId', v));
watch(showExportGeo, (v) => localStorage.setItem('mapng_showExportGeo', String(v)));

watch(
  () => props.terrainData?.satelliteTextureUrl,
  (url) => {
    const token = ++satellitePreviewToken;
    updatePreviewUrl(url, satellitePreviewUrl, () => token === satellitePreviewToken);
  },
  { immediate: true },
);

watch(
  () => props.terrainData?.osmTextureUrl,
  (url) => {
    const token = ++osmPreviewToken;
    updatePreviewUrl(url, osmPreviewUrl, () => token === osmPreviewToken);
  },
  { immediate: true },
);

watch(
  () => props.terrainData?.hybridTextureUrl,
  (url) => {
    const token = ++hybridPreviewToken;
    updatePreviewUrl(url, hybridPreviewUrl, () => token === hybridPreviewToken);
  },
  { immediate: true },
);

onUnmounted(() => {
  clearPreviewUrl(satellitePreviewUrl);
  clearPreviewUrl(osmPreviewUrl);
  clearPreviewUrl(hybridPreviewUrl);
});

const buildBeamNGFallbackLevelName = () => (
  `mapng_${props.center.lat.toFixed(4)}_${props.center.lng.toFixed(4)}`
    .replace(/-/g, '_')
    .replace(/\./g, '_')
);

const applySuggestedBeamNGLevelName = (suggestedName) => {
  const trimmedSuggestion = String(suggestedName || '').trim();
  const previousSuggestion = beamNGSuggestedLevelName.value;
  const current = beamNGLevelName.value.trim();
  const canReplace = !beamNGLevelNameTouched.value || !current || current === previousSuggestion;
  beamNGSuggestedLevelName.value = trimmedSuggestion;
  if (canReplace) {
    beamNGLevelName.value = trimmedSuggestion || buildBeamNGFallbackLevelName();
    beamNGLevelNameTouched.value = false;
  }
};

const updateSuggestedBeamNGLevelName = async () => {
  if (!showExportBeamNG.value) return;
  const requestId = ++beamNGLevelNameRequestId;
  const fallbackName = buildBeamNGFallbackLevelName();
  if (!Number.isFinite(props.center?.lat) || !Number.isFinite(props.center?.lng)) {
    applySuggestedBeamNGLevelName(fallbackName);
    return;
  }
  try {
    const suggested = await reverseLocationName(props.center.lat, props.center.lng);
    if (requestId !== beamNGLevelNameRequestId) return;
    applySuggestedBeamNGLevelName(suggested || fallbackName);
  } catch (error) {
    console.warn('Failed to suggest BeamNG level name:', error);
    if (requestId !== beamNGLevelNameRequestId) return;
    applySuggestedBeamNGLevelName(fallbackName);
  }
};

const handleBeamNGLevelNameInput = () => {
  beamNGLevelNameTouched.value = beamNGLevelName.value.trim() !== beamNGSuggestedLevelName.value.trim();
};

watch(
  () => [props.center.lat, props.center.lng, showExportBeamNG.value],
  ([, , isBeamNgSectionOpen]) => {
    if (!isBeamNgSectionOpen) return;
    updateSuggestedBeamNGLevelName();
  },
  { immediate: true }
);

watch(
  () => props.terrainData,
  (terrainData) => {
    beamNGBaseTexture.value = resolveBeamNGBaseTexture(terrainData, beamNGBaseTexture.value);
  },
  { immediate: true }
);

watch(
  [hasOsmData, isCustomUploadTerrain, canUseGpxzBackdrop],
  ([hasOsm, isCustom, gpxzAllowed]) => {
    if (!hasOsm) {
      if (beamNGBaseTexture.value === 'osm') {
        beamNGBaseTexture.value = resolveBeamNGBaseTexture(props.terrainData, 'hybrid');
      }
      beamNGPbrSource.value = 'none';
      beamNGRoadType.value = 'none';
      beamNGIncludeBuildings.value = false;
      beamNGApplyFoundations.value = false;
      beamNGIncludeWater.value = false;
      beamNGIncludeTrees.value = false;
      beamNGIncludeRocks.value = false;
    }
    if (isCustom) {
      beamNGBackdropSource.value = 'off';
    }
    if (beamNGBackdropSource.value === 'gpxz' && !gpxzAllowed) {
      beamNGBackdropSource.value = 'global30m';
    }
  },
  { immediate: true }
);

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
  const projection = createRoadMaskProjection(src, size, size, props.center);
  if (!projection) return null;
  ctx.fillStyle = 'black';
  ctx.fillRect(0, 0, size, size);
  ctx.strokeStyle = 'white';
  ctx.lineWidth = Math.max(2, 8 * projection.metersToPx);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  src.osmFeatures.forEach(feature => {
    if (feature.type !== 'road') return;
    const highway = feature.tags?.highway;
    const exclude = ['footway', 'path', 'pedestrian', 'steps', 'cycleway', 'bridleway', 'corridor'];
    if (highway && exclude.includes(highway)) return;
    ctx.beginPath();
    feature.geometry.forEach((pt, index) => {
      const { x: u, y: v } = projection.toPixel(pt.lat, pt.lng);
      if (index === 0) ctx.moveTo(u, v);
      else ctx.lineTo(u, v);
    });
    ctx.stroke();
  });
  return canvas.toDataURL('image/png');
});

const buildRunConfiguration = () => ({
  ...buildRunConfigurationBase({
    center: props.center,
    zoom: props.zoom,
    resolution: props.resolution,
    includeOSM: props.fetchOSM,
    elevationSource: props.elevationSource,
    gpxzApiKey: props.gpxzApiKey,
    gpxzStatus: props.gpxzStatus,
    terrainData: props.terrainData,
  }),
  modelOptions: {
    centerTextureType: modelCenterTextureType.value,
    tileSelection: modelTileSelection.value,
    includeSurroundings: modelTileSelection.value !== 'center-only',
  },
});

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
  link.rel = 'noopener';
  link.style.display = 'none';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  // Delay revocation so larger blobs (e.g. BeamNG zip exports) are not
  // invalidated before the browser begins consuming the object URL.
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
};

const notifyExportSuccess = (type, filename) => {
  emit('exportSuccess', {
    mode: 'single',
    type,
    filename,
    at: Date.now(),
  });
};

const yieldToUi = async () => {
  await nextTick();
  await new Promise((resolve) => {
    requestAnimationFrame(() => {
      setTimeout(resolve, 0);
    });
  });
};

// Returns terrainData cropped to exportCropSize if a LAZ file drove the native size
const getExportTerrainData = () => prepareCroppedTerrainData(props.terrainData);

const resolveProcessingMetersPerPixel = (terrainData) => {
  const parsed = Number(terrainData?.processingMetersPerPixel);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
};

const createRoadMaskProjection = (terrainData, targetWidth, targetHeight, fallbackCenter = null) => {
  if (!terrainData) return null;
  const centerLat = Number.isFinite(Number(terrainData.bounds?.north)) && Number.isFinite(Number(terrainData.bounds?.south))
    ? (terrainData.bounds.north + terrainData.bounds.south) / 2
    : fallbackCenter?.lat;
  const centerLng = Number.isFinite(Number(terrainData.bounds?.east)) && Number.isFinite(Number(terrainData.bounds?.west))
    ? (terrainData.bounds.east + terrainData.bounds.west) / 2
    : fallbackCenter?.lng;
  if (!Number.isFinite(centerLat) || !Number.isFinite(centerLng)) return null;

  const sourceWidth = Math.max(1, Number(terrainData.width) || 1);
  const sourceHeight = Math.max(1, Number(terrainData.height) || 1);
  const scaleX = targetWidth / sourceWidth;
  const scaleY = targetHeight / sourceHeight;
  const processingMetersPerPixel = resolveProcessingMetersPerPixel(terrainData);
  const metersToPxX = scaleX / processingMetersPerPixel;
  const metersToPxY = scaleY / processingMetersPerPixel;
  const toLocal = createWGS84ToLocal(centerLat, centerLng);

  return {
    metersToPx: Math.min(metersToPxX, metersToPxY),
    toPixel: (lat, lng) => {
      const [localX, localY] = toLocal.forward([lng, lat]);
      return {
        x: localX * metersToPxX + (sourceWidth / 2) * scaleX,
        y: (sourceHeight / 2) * scaleY - localY * metersToPxY,
      };
    },
  };
};

const downloadMetadataSidecar = (exportFilename, metadata) => {
  if (!ENABLE_METADATA_SIDECARS) return;
  const baseName = exportFilename.replace(/\.[^.]+$/, '');
  downloadJsonFile(metadata, `${baseName}.metadata.json`);
};

const downloadHeightmap = async () => {
  if (!props.terrainData?.heightMap) return;
  isExportingHeightmap.value = true;
  try {
    await yieldToUi();
    const td = await getExportTerrainData();
    const blob = generateHeightmapBlob(td);
    const typedBlob = await ensureDownloadBlobType(blob, 'image/png');
    const filename = `heightmap_${props.center.lat.toFixed(4)}_${props.center.lng.toFixed(4)}.png`;
    triggerDownload(typedBlob, filename);
    notifyExportSuccess('heightmap', filename);
    const metadata = buildExportMetadata('heightmap', filename);
    downloadMetadataSidecar(filename, metadata);
  } catch (error) {
    console.error('Failed to export heightmap:', error);
    alert(t('export.errorHeightmap'));
  } finally {
    isExportingHeightmap.value = false;
  }
};

const downloadTexture = async () => {
  if (!props.terrainData?.satelliteTextureUrl) return;
  isExportingTexture.value = true;
  try {
    await yieldToUi();
    const td = await getExportTerrainData();
    const filename = `texture_${props.center.lat.toFixed(4)}_${props.center.lng.toFixed(4)}.png`;
    await downloadBlobUrlAsFile(td.satelliteTextureUrl ?? props.terrainData.satelliteTextureUrl, filename, 'image/', 'image/png');
    notifyExportSuccess('texture_satellite', filename);

    const metadata = buildExportMetadata('texture_satellite', filename);
    downloadMetadataSidecar(filename, metadata);
  } catch (error) {
    console.error('Failed to export texture:', error);
    alert(t('export.errorTexture'));
  } finally {
    isExportingTexture.value = false;
  }
};

const downloadOSMTexture = async () => {
  if (!props.terrainData?.osmTextureUrl) return;
  isExportingOSMTexture.value = true;
  try {
    await yieldToUi();
    const td = await getExportTerrainData();
    const filename = `osm_texture_${props.center.lat.toFixed(4)}_${props.center.lng.toFixed(4)}.png`;
    await downloadBlobUrlAsFile(td.osmTextureUrl ?? props.terrainData.osmTextureUrl, filename, 'image/', 'image/png');
    notifyExportSuccess('texture_osm', filename);
    const metadata = buildExportMetadata('texture_osm', filename);
    downloadMetadataSidecar(filename, metadata);
  } catch (error) {
    console.error('Failed to export OSM texture:', error);
    alert(t('export.errorOsmTexture'));
  } finally {
    isExportingOSMTexture.value = false;
  }
};

const downloadHybridTexture = async () => {
  if (!props.terrainData?.hybridTextureUrl) return;
  isExportingHybridTexture.value = true;
  try {
    await yieldToUi();
    const td = await getExportTerrainData();
    const filename = `hybrid_texture_${props.center.lat.toFixed(4)}_${props.center.lng.toFixed(4)}.png`;
    await downloadBlobUrlAsFile(td.hybridTextureUrl ?? props.terrainData.hybridTextureUrl, filename, 'image/', 'image/png');
    notifyExportSuccess('texture_hybrid', filename);
    const metadata = buildExportMetadata('texture_hybrid', filename);
    downloadMetadataSidecar(filename, metadata);
  } catch (error) {
    console.error('Failed to export hybrid texture:', error);
    alert(t('export.errorHybridTexture'));
  } finally {
    isExportingHybridTexture.value = false;
  }
};

const downloadRoadMask = async () => {
  if (!props.terrainData?.osmFeatures || props.terrainData.osmFeatures.length === 0) return;
  isExportingRoadMask.value = true;
  try {
    await yieldToUi();
    const td = await getExportTerrainData();
    const canvas = document.createElement('canvas');
    canvas.width = td.width;
    canvas.height = td.height;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = 'black';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    const projection = createRoadMaskProjection(td, canvas.width, canvas.height, props.center);
    if (!projection) throw new Error('Unable to create road mask projection.');
    ctx.strokeStyle = 'white';
    ctx.lineWidth = Math.max(2, 8 * projection.metersToPx);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    td.osmFeatures.forEach(feature => {
      if (feature.type !== 'road') return;
      const highway = feature.tags?.highway;
      const exclude = ['footway', 'path', 'pedestrian', 'steps', 'cycleway', 'bridleway', 'corridor'];
      if (highway && exclude.includes(highway)) return;
      ctx.beginPath();
      feature.geometry.forEach((pt, index) => {
        const { x: u, y: v } = projection.toPixel(pt.lat, pt.lng);
        if (index === 0) ctx.moveTo(u, v);
        else ctx.lineTo(u, v);
      });
      ctx.stroke();
    });
    const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
    const typedBlob = await ensureDownloadBlobType(blob, 'image/png');
    const filename = `road_mask_${props.center.lat.toFixed(4)}_${props.center.lng.toFixed(4)}.png`;
    triggerDownload(typedBlob, filename);
    notifyExportSuccess('road_mask', filename);
    const metadata = buildExportMetadata('road_mask', filename);
    downloadMetadataSidecar(filename, metadata);
  } catch (error) {
    console.error('Failed to export road mask:', error);
    alert(t('export.errorRoadMask'));
  } finally {
    isExportingRoadMask.value = false;
  }
};

const downloadGeoTIFF = async () => {
  if (!props.terrainData) return;
  isExportingGeoTIFF.value = true;
  try {
    await yieldToUi();
    const td = await getExportTerrainData();
    const { blob: tiffBlob, filename } = await exportGeoTiff(td, props.center);
    const typedBlob = await ensureDownloadBlobType(tiffBlob, 'image/tiff');
    triggerDownload(typedBlob, filename);
    notifyExportSuccess('geotiff', filename);
    const metadata = buildExportMetadata('geotiff', filename);
    downloadMetadataSidecar(filename, metadata);
  } catch (error) {
    console.error('Failed to export GeoTIFF:', error);
    alert(t('export.errorGeotiff'));
  } finally {
    isExportingGeoTIFF.value = false;
  }
};

const downloadOSM = async () => {
  if (!props.terrainData?.osmFeatures || props.terrainData.osmFeatures.length === 0) return;
  isExportingOSM.value = true;
  try {
    await yieldToUi();
    const toRingCoordinates = (geometry = []) => {
      const coords = geometry.map((p) => [p.lng, p.lat]);
      if (coords.length > 2) {
        const [fx, fy] = coords[0];
        const [lx, ly] = coords[coords.length - 1];
        if (fx !== lx || fy !== ly) coords.push([fx, fy]);
      }
      return coords;
    };

    const isClosedGeometry = (geometry = []) => {
      if (!geometry || geometry.length < 4) return false;
      const first = geometry[0];
      const last = geometry[geometry.length - 1];
      return first?.lat === last?.lat && first?.lng === last?.lng;
    };

    const toGeoJsonGeometry = (feature) => {
      const geometry = feature?.geometry || [];
      if (!geometry.length) return null;
      if (geometry.length === 1) {
        return { type: 'Point', coordinates: [geometry[0].lng, geometry[0].lat] };
      }

      const hasHoles = Array.isArray(feature?.holes) && feature.holes.length > 0;
      const forcePolygon = feature?.type === 'building' || feature?.type === 'landuse' || feature?.type === 'water';
      const isPolygon = hasHoles || forcePolygon || isClosedGeometry(geometry);
      if (isPolygon) {
        const rings = [toRingCoordinates(geometry)];
        for (const hole of feature.holes || []) {
          rings.push(toRingCoordinates(hole));
        }
        return { type: 'Polygon', coordinates: rings };
      }

      return {
        type: 'LineString',
        coordinates: geometry.map((p) => [p.lng, p.lat]),
      };
    };

    const geojson = {
      type: 'FeatureCollection',
      features: props.terrainData.osmFeatures
        .map((f) => {
          const geometry = toGeoJsonGeometry(f);
          if (!geometry) return null;
          return {
            type: 'Feature',
            geometry,
            properties: {
              ...(f.tags || {}),
              _mapngType: f.type,
              _mapngId: f.id,
            },
          };
        })
        .filter(Boolean)
    };
    const filename = `osm_features_${props.center.lat.toFixed(4)}_${props.center.lng.toFixed(4)}.geojson`;
    downloadJsonFile(geojson, filename);
    notifyExportSuccess('osm_geojson', filename);
    const metadata = buildExportMetadata('osm_geojson', filename);
    downloadMetadataSidecar(filename, metadata);
  } finally {
    isExportingOSM.value = false;
  }
};

const handleGLBExport = async () => {
  if (!props.terrainData) return;
  isExportingGLB.value = true;
  try {
    await yieldToUi();
    const td = await getExportTerrainData();
    const blob = await exportToGLB(td, {
      centerTextureType: modelCenterTextureType.value,
      tileSelection: modelTileSelection.value,
      surroundingTilePositions: props.surroundingTilePositions,
      center: props.center,
      resolution: props.resolution,
      returnBlob: true
    });
    const typedBlob = await ensureDownloadBlobType(blob, 'model/gltf-binary', 'application/octet-stream');
    const filename = `terrain_${props.center.lat.toFixed(4)}_${props.center.lng.toFixed(4)}.glb`;
    triggerDownload(typedBlob, filename);
    notifyExportSuccess('glb', filename);
    const metadata = buildExportMetadata('glb', filename, {
      modelOptions: {
        centerTextureType: modelCenterTextureType.value,
        tileSelection: modelTileSelection.value,
      }
    });
    downloadMetadataSidecar(filename, metadata);
  } catch (error) {
    console.error('Failed to export GLB:', error);
    alert(t('export.errorGlb'));
  } finally {
    isExportingGLB.value = false;
  }
};

const handleDAEExport = async () => {
  if (!props.terrainData) return;
  isExportingDAE.value = true;
  try {
    await yieldToUi();
    const td = await getExportTerrainData();
    const zipBlob = await exportToDAE(td, {
      centerTextureType: modelCenterTextureType.value,
      tileSelection: modelTileSelection.value,
      surroundingTilePositions: props.surroundingTilePositions,
      center: props.center,
      resolution: props.resolution,
      returnBlob: true
    });
    const typedBlob = await ensureDownloadBlobType(zipBlob, 'application/zip');
    const filename = `terrain_${props.center.lat.toFixed(4)}_${props.center.lng.toFixed(4)}.dae.zip`;
    triggerDownload(typedBlob, filename);
    notifyExportSuccess('dae_zip', filename);
    const metadata = buildExportMetadata('dae_zip', filename, {
      modelOptions: {
        centerTextureType: modelCenterTextureType.value,
        tileSelection: modelTileSelection.value,
      }
    });
    downloadMetadataSidecar(filename, metadata);
  } catch (error) {
    console.error('Failed to export DAE:', error);
    alert(t('export.errorDae'));
  } finally {
    isExportingDAE.value = false;
  }
};

const handleBeamNGLevelExport = async () => {
  const startedAt = performance.now();
  console.log(`${BEAMNG_EXPORT_UI_LOG} Export requested`);
  console.log(`${BEAMNG_EXPORT_UI_LOG} Input terrainData:`, {
    hasTerrainData: !!props.terrainData,
    width: props.terrainData?.width,
    height: props.terrainData?.height,
    hasOsmData: hasOsmData.value,
    isCustomUploadTerrain: isCustomUploadTerrain.value,
  });

  if (!props.terrainData) {
    console.warn(`${BEAMNG_EXPORT_UI_LOG} Aborting: missing terrainData.`);
    return;
  }
  if (beamNGFlavorRequired.value && !beamNGFlavorId.value) {
    console.warn(`${BEAMNG_EXPORT_UI_LOG} Aborting: flavor is required but missing.`);
    return;
  }

  // Clear any stale pending bundle from a previous run.
  clearPendingBeamNGDownload();

  // Keep users in-app: pre-acquire a save handle while click activation is
  // still present, then write the generated ZIP after export completes.
  let beamNGSaveHandle = null;
  const supportsSavePicker = typeof window !== 'undefined' && typeof window.showSaveFilePicker === 'function';
  if (supportsSavePicker) {
    const fallbackName = `mapng_${props.center.lat.toFixed(4)}_${props.center.lng.toFixed(4)}`
      .replace(/[^a-zA-Z0-9_-]+/g, '_');
    const suggestedBase = String(beamNGLevelName.value || fallbackName).trim().replace(/[^a-zA-Z0-9_-]+/g, '_') || fallbackName;
    const suggestedName = `${suggestedBase}.zip`;
    try {
      beamNGSaveHandle = await window.showSaveFilePicker({
        suggestedName,
        types: [{
          description: 'ZIP archive',
          accept: { 'application/zip': ['.zip'] },
        }],
      });
      console.log(`${BEAMNG_EXPORT_UI_LOG} Save picker acquired handle.`, { suggestedName });
    } catch (e) {
      console.warn(`${BEAMNG_EXPORT_UI_LOG} Save picker unavailable/cancelled, will use anchor fallback.`, e);
    }
  } else {
    console.log(`${BEAMNG_EXPORT_UI_LOG} File System Access API unavailable, using anchor fallback.`);
  }

  isExportingBeamNGLevel.value = true;
  beamNGProgressStep.value = 'Preparing…';
  beamNGProgressPct.value  = 0;
  try {
    console.log(`${BEAMNG_EXPORT_UI_LOG} Starting export pipeline...`);
    await yieldToUi();
    const td = await getExportTerrainData();
    console.log(`${BEAMNG_EXPORT_UI_LOG} Export terrain prepared:`, {
      width: td?.width,
      height: td?.height,
      minHeight: td?.minHeight,
      maxHeight: td?.maxHeight,
      hasBounds: !!td?.bounds,
      osmFeatureCount: Array.isArray(td?.osmFeatures) ? td.osmFeatures.length : null,
    });

    const effectiveBaseTexture = beamNGBaseTexture.value === 'none'
      ? 'none'
      : (hasOsmData.value
        ? beamNGBaseTexture.value
        : resolveBeamNGBaseTexture(td, 'hybrid'));
    const effectivePbrSource = hasOsmData.value ? beamNGPbrSource.value : 'none';
    const effectiveRoadType = hasOsmData.value ? beamNGRoadType.value : 'none';
    const effectiveBackdropSource = isCustomUploadTerrain.value
      ? 'off'
      : (beamNGBackdropSource.value === 'gpxz' && !canUseGpxzBackdrop.value
        ? 'global30m'
        : beamNGBackdropSource.value);
    const effectiveIncludeBackdrop = effectiveBackdropSource !== 'off';
    const effectiveIncludeBuildings = hasOsmData.value ? beamNGIncludeBuildings.value : false;
    const effectiveApplyFoundations = hasOsmData.value ? beamNGApplyFoundations.value : false;
    const effectiveIncludeWater = hasOsmData.value ? beamNGIncludeWater.value : false;
    const effectiveSeaLevelOffset = normalizeBeamNGSeaLevelOffset(beamNGSeaLevelOffset.value);
    const effectiveIncludeTrees = hasOsmData.value ? beamNGIncludeTrees.value : false;
    const effectiveIncludeRocks = hasOsmData.value ? beamNGIncludeRocks.value : false;
    const effectiveBackdropGpxzApiKey = effectiveBackdropSource === 'gpxz' ? String(props.gpxzApiKey || '') : '';

    const effectiveFlavorId = beamNGFlavorId.value || beamNGFlavorOptions[0]?.id;

    console.log(`${BEAMNG_EXPORT_UI_LOG} Effective export options:`, {
      baseTexture: effectiveBaseTexture,
      pbrSource: effectivePbrSource,
      roadType: effectiveRoadType,
      includeBackdrop: effectiveIncludeBackdrop,
      backdropElevationSource: effectiveBackdropSource,
      backdropGpxzApiKey: effectiveBackdropGpxzApiKey,
      includeBuildings: effectiveIncludeBuildings,
      applyFoundations: effectiveApplyFoundations,
      includeWater: effectiveIncludeWater,
      seaLevelOffset: effectiveSeaLevelOffset,
      includeTrees: effectiveIncludeTrees,
      includeRocks: effectiveIncludeRocks,
      flavorId: effectiveFlavorId,
      levelName: beamNGLevelName.value.trim(),
      elevationSource: props.elevationSource,
      requestedResolution: props.resolution,
    });

    const { blob, filename } = await exportBeamNGLevel(td, props.center, {
      baseTexture: effectiveBaseTexture,
      includeBackdrop: effectiveIncludeBackdrop,
      backdropElevationSource: effectiveBackdropSource,
      backdropGpxzApiKey: effectiveBackdropGpxzApiKey,
      includeBuildings: effectiveIncludeBuildings,
      applyFoundations: effectiveApplyFoundations,
      pbrSource: effectivePbrSource,
      includeWater: effectiveIncludeWater,
      seaLevelOffset: effectiveSeaLevelOffset,
      includeTrees: effectiveIncludeTrees,
      includeRocks: effectiveIncludeRocks,
      roadType: effectiveRoadType,
      flavorId: effectiveFlavorId,
      levelName: beamNGLevelName.value.trim(),
      elevationSource: props.elevationSource,
      requestedResolution: props.resolution,
      onProgress: ({ step, pct }) => {
        beamNGProgressStep.value = step;
        beamNGProgressPct.value  = pct;
        console.log(`${BEAMNG_EXPORT_UI_LOG} Progress:`, { step, pct });
      },
    });

    if (effectiveBackdropSource === 'gpxz' && !effectiveBackdropGpxzApiKey) {
      console.warn(`${BEAMNG_EXPORT_UI_LOG} GPXZ backdrop selected but no GPXZ key was passed to export.`);
    }

    console.log(`${BEAMNG_EXPORT_UI_LOG} Export returned payload:`, {
      filename,
      blobType: blob?.type,
      blobSize: blob?.size,
      isBlob: blob instanceof Blob,
    });

    if (!(blob instanceof Blob)) {
      throw new Error('BeamNG export did not return a Blob payload.');
    }
    if (!filename || typeof filename !== 'string') {
      throw new Error('BeamNG export did not return a valid filename.');
    }

    console.log(`${BEAMNG_EXPORT_UI_LOG} Triggering browser download...`, {
      filename,
      blobType: blob.type,
      blobSize: blob.size,
    });

    if (beamNGSaveHandle) {
      const writable = await beamNGSaveHandle.createWritable();
      await writable.write(blob);
      await writable.close();
      console.log(`${BEAMNG_EXPORT_UI_LOG} Download written via File System Access API.`);
      notifyExportSuccess('beamng_level_zip', filename);
      console.log(`${BEAMNG_EXPORT_UI_LOG} Export success notification emitted.`);
    } else {
      // Stage a blob URL and expose a real user-clicked anchor download link.
      beamNGPendingDownloadUrl.value = URL.createObjectURL(blob);
      beamNGPendingDownloadName.value = filename;
      console.warn(`${BEAMNG_EXPORT_UI_LOG} Auto-download fallback blocked risk detected; awaiting explicit anchor click.`);
    }
  } catch (error) {
    console.error(`${BEAMNG_EXPORT_UI_LOG} Failed to export BeamNG level:`, {
      message: error?.message,
      name: error?.name,
      stack: error?.stack,
      error,
    });
    alert(t('export.errorBeamngLevel'));
  } finally {
    isExportingBeamNGLevel.value = false;
    beamNGProgressStep.value = '';
    beamNGProgressPct.value  = 0;
    console.log(`${BEAMNG_EXPORT_UI_LOG} Export flow completed in ms:`, Math.round(performance.now() - startedAt));
  }
};

const handleBeamNGPendingDownloadClick = () => {
  const filename = beamNGPendingDownloadName.value || 'beamng_level.zip';
  if (!beamNGPendingDownloadUrl.value) {
    console.warn(`${BEAMNG_EXPORT_UI_LOG} Pending download requested but URL is missing.`);
    return;
  }
  console.log(`${BEAMNG_EXPORT_UI_LOG} Dispatching pending download via explicit anchor click.`, {
    filename,
    urlLength: beamNGPendingDownloadUrl.value.length,
  });

  // Do not clear immediately; allow browser to fully consume the blob URL.
  const urlToRevoke = beamNGPendingDownloadUrl.value;
  setTimeout(() => {
    URL.revokeObjectURL(urlToRevoke);
    if (beamNGPendingDownloadUrl.value === urlToRevoke) {
      beamNGPendingDownloadUrl.value = '';
      beamNGPendingDownloadName.value = '';
    }
  }, 120_000);

  notifyExportSuccess('beamng_level_zip', filename);
  console.log(`${BEAMNG_EXPORT_UI_LOG} Export success notification emitted after explicit anchor click.`);
};

const handleTERExport = async () => {
  if (!props.terrainData) return;
  isExportingTER.value = true;
  try {
    await yieldToUi();
    const td = await getExportTerrainData();
    const terBlob = await generateTerBlob(td);
    const filename = `terrain_${props.center.lat.toFixed(4)}_${props.center.lng.toFixed(4)}.ter`;
    
    // Create download link
    const url = URL.createObjectURL(terBlob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    
    // Cleanup
    document.body.removeChild(link);
    setTimeout(() => URL.revokeObjectURL(url), 100);
    notifyExportSuccess('terrain_ter', filename);

    const metadata = buildCommonTraceMetadata({
      center: props.center,
      resolution: props.resolution,
      exportType: 'terrain_ter',
      size: props.terrainData.width,
      date_iso: new Date().toISOString()
    });
    downloadMetadataSidecar(filename, metadata);
  } catch (error) {
    console.error('Failed to export TER:', error);
    alert(t('export.errorTer'));
  } finally {
    isExportingTER.value = false;
  }
};
</script>
