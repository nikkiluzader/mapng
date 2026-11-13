<template>
  <div v-if="terrainData && !isGenerating" class="space-y-3">
    <!-- Missing OSM Warning / Action -->
    <div v-if="!terrainData.osmFeatures || terrainData.osmFeatures.length === 0" class="bg-blue-50 dark:bg-blue-900/20 p-2 rounded border border-blue-100 dark:border-blue-800 flex items-center justify-between">
      <div class="text-micro text-blue-700 dark:text-blue-300 flex items-center gap-1.5">
        <Trees :size="12" />
        <span>{{ t('exportPanel.osmMissing') }}</span>
      </div>
      <button 
        @click="$emit('fetchOsm')"
        class="text-micro font-medium bg-blue-600 hover:bg-blue-700 text-white px-2 py-1 rounded transition-colors"
      >
        {{ t('exportPanel.fetchNow') }}
      </button>
    </div>

    <!-- (the "Ready to export" heading and the terrain stats come from ControlPanel, above) -->
      <!-- BeamNG Level: cards of settings (components/base/Setting*.vue), then the export -->
      <!-- (Both: the two halves named, each with its own sections) -->
      <div v-if="showLevel && showAssets" class="text-micro font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500" data-testid="export-half-level">{{ t('exportPanel.ui.halfLevel') }}</div>
      <SettingSection v-if="showLevel" v-model:open="showExportBeamNG" :title="t('exportPanel.beamngLevel')" :icon="PackageOpen" data-testid="export-level-section">
          <SettingCard :title="t('exportPanel.ui.cardLevel')">
            <SettingRow :label="t('exportPanel.levelName')">
              <input
                v-model="beamNGLevelName"
                @input="handleBeamNGLevelNameInput"
                type="text"
                maxlength="64"
                :placeholder="t('exportPanel.levelNamePlaceholder')"
                class="w-44 text-xs bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded px-1.5 py-0.5 text-gray-800 dark:text-gray-100 focus:outline-none focus:ring-1 focus:ring-brand focus:border-brand"
              />
            </SettingRow>
            <SettingRow v-if="advancedMode" :label="t('exportPanel.viewDistance')" :hint="t('exportPanel.ui.viewDistanceHint')">
              <select v-model="beamNGViewDistance" :class="SELECT_XS">
                <option :value="AUTO_VIEW_DISTANCE">{{ t('exportPanel.ui.viewDistanceAuto', { km: autoViewDistanceKm }) }}</option>
                <option v-for="m in VIEW_DISTANCES_M" :key="m" :value="m">{{ m / 1000 }} km</option>
              </select>
            </SettingRow>
            <SettingRow :label="t('exportPanel.baseTexture')">
              <select v-model="beamNGBaseTexture" :class="SELECT_XS" @change="handleBeamNGBaseTextureChange">
                <option value="none">{{ t('exportPanel.none') }}</option>
                <option value="hybrid">{{ t('exportPanel.satelliteHybrid') }}</option>
                <option value="satellite" :disabled="!terrainData?.satelliteTextureUrl">{{ t('exportPanel.satellite') }}</option>
                <option v-if="hasOsmData" value="osm">{{ t('exportPanel.osm') }}</option>
                <option v-if="hasOsmData" value="game">{{ t('exportPanel.gameTexture') }}</option>
                <option v-if="hasPaintedTexture" value="painted">{{ t('exportPanel.touchedUp') }}</option>
              </select>
              <button
                @click="openTexturePaint"
                :disabled="!canPaintTexture || isPreparingTexturePaint"
                :title="canPaintTexture ? t('exportPanel.texturePaint.open') : t('exportPanel.texturePaint.needsTexture')"
                :class="['p-1 rounded border transition-colors shrink-0',
                  hasPaintedTexture
                    ? 'border-brand text-brand bg-orange-50 dark:bg-orange-900/20 hover:bg-orange-100 dark:hover:bg-orange-900/40'
                    : 'border-gray-300 dark:border-gray-600 text-gray-500 dark:text-gray-400 hover:text-brand hover:border-brand',
                  'disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:text-gray-500 disabled:hover:border-gray-300 dark:disabled:hover:border-gray-600']"
              >
                <Loader2 v-if="isPreparingTexturePaint" :size="12" class="animate-spin" />
                <Paintbrush v-else :size="12" />
              </button>
            </SettingRow>
            <SettingRow
              v-if="beamNGBaseTexture === 'game'"
              indent
              :label="t('exportPanel.gameTextureBlend')"
              :hint="isRepaintingGameTexture ? t('exportPanel.gameTextureBlendRepainting') : isPreparingBlend ? t('exportPanel.gameTextureBlendPreparing') : t('exportPanel.gameTextureBlendHint')"
            >
              <input
                type="range" min="0" max="100" step="1"
                v-model.number="gameTextureBlend"
                :disabled="isRepaintingGameTexture || isAnyExporting"
                :aria-label="t('exportPanel.gameTextureBlend')"
                class="w-28 accent-brand disabled:opacity-50"
                @pointerdown="prepareLiveBlend"
                @focus="prepareLiveBlend"
                @input="onGameTextureBlendInput"
                @change="applyGameTextureBlend"
              />
              <Loader2 v-if="isRepaintingGameTexture || isPreparingBlend" :size="12" class="animate-spin text-brand" />
              <span v-else class="w-9 text-right text-xs tabular-nums text-gray-600 dark:text-gray-300">{{ gameTextureBlend }}%</span>
            </SettingRow>
            <SettingRow
              check
              :model-value="beamNGPbrSource === 'osm'"
              @update:model-value="beamNGPbrSource = $event ? 'osm' : 'none'"
              :label="t('exportPanel.pbrMaterials')"
              :hint="t('exportPanel.ui.pbrHint')"
              :disabled="!hasOsmData"
              :disabled-reason="t('exportPanel.ui.needsOsm')"
            />
            <SettingRow :label="t('exportPanel.seaLevelOffset')" :hint="terrainData?.flat ? t('exportPanel.ui.seaLevelFlat') : t('exportPanel.ui.seaLevelHint')">
              <input
                :value="terrainData?.flat ? -1 : beamNGSeaLevelOffset"
                @input="beamNGSeaLevelOffset = Number($event.target.value)"
                :disabled="terrainData?.flat"
                type="number"
                step="1"
                min="-2000"
                max="2000"
                class="w-20 text-xs bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded px-1.5 py-0.5 text-gray-800 dark:text-gray-100 disabled:opacity-50 disabled:cursor-not-allowed focus:outline-none focus:ring-1 focus:ring-brand focus:border-brand"
              />
              <span class="text-caption text-gray-500 dark:text-gray-400">m</span>
            </SettingRow>
          </SettingCard>

          <!-- What to build: presets, features in groups, (Advanced) Fine-tuning: WhatToBuild.vue -->
          <WhatToBuild
            :advanced="advancedMode"
            :has-osm-data="hasOsmData"
            :osm-features="osmFeaturesRaw"
            v-model:forest-density="beamNGForestDensity"
            v-model:lidar-decks="beamNGLidarDecks"
            v-model:safe-caps="beamNGSafeCaps"
            v-model:assume-parking="beamNGAssumeParking"
            v-model:decal-sidewalks="beamNGDecalSidewalks"
            v-model:road-surface="beamNGRoadSurface"
            v-model:curb-height="beamNGCurbHeight"
            v-model:tree-kinds-off="beamNGTreeKindsOff"
            v-model:tree-swaps="beamNGTreeSwaps"
            v-model:tree-models-off="beamNGTreeModelsOff"
          />

          <!-- Terrain: chosen once, in the elevation section (TerrainChoice); here only what this level gets -->
          <SettingCard v-if="advancedMode" :title="t('exportPanel.ui.cardTerrain')">
            <p class="text-caption leading-snug text-gray-700 dark:text-gray-200">{{ t(`exportPanel.ui.terrainSummary_${terrainMode}`) }}</p>
            <p class="text-caption leading-snug text-gray-500 dark:text-gray-400">{{ t('exportPanel.ui.terrainChangeHere') }}</p>
            <p v-if="terrainChoiceChangedSinceGenerate" class="text-caption leading-snug text-amber-700 dark:text-amber-300">{{ t('exportPanel.ui.terrainRegenerate') }}</p>
            <p class="text-caption leading-snug text-gray-500 dark:text-gray-400">{{ t('exportPanel.ui.reportNote') }}</p>
          </SettingCard>

          <!-- Elevation around the map, beyond its edges -->
          <SettingCard :title="t('exportPanel.ui.cardSurroundings')">
            <SettingRow :label="t('exportPanel.includeBackdrop')" :hint="t(`exportPanel.ui.backdropHint_${beamNGBackdropSource}`)">
              <select v-model="beamNGBackdropSource" :class="SELECT_XS">
                <option value="off">{{ t('exportPanel.ui.backdropOff') }}</option>
                <option value="global30m">{{ t('exportPanel.ui.backdropGlobal') }}</option>
                <option value="usgs1m">{{ t('exportPanel.ui.backdropUsgs') }}</option>
                <option value="gpxz" :disabled="!canUseGpxzBackdrop">GPXZ</option>
              </select>
            </SettingRow>
            <!-- how fine a satellite picture the backdrop gets (services/backdropImagery.js) -->
            <SettingRow
              v-if="beamNGBackdropSource !== 'off'"
              indent
              :label="t('exportPanel.ui.backdropImagery')"
              :hint="backdropImageryHint"
              :disabled="beamNGBackdropSource !== 'global30m'"
              :disabled-reason="t('exportPanel.ui.backdropImageryOwn')"
            >
              <select v-model="beamNGBackdropImagery" :class="SELECT_XS" :disabled="beamNGBackdropSource !== 'global30m'">
                <option v-for="id in BACKDROP_IMAGERY_IDS" :key="id" :value="id">{{ t(`exportPanel.ui.backdropImagery_${id}`) }}</option>
              </select>
            </SettingRow>
            <p v-if="beamNGBackdropSource === 'global30m' && backdropPlan.limited" class="pl-4 text-caption leading-snug text-amber-700 dark:text-amber-300">
              {{ t(desktopApp ? 'exportPanel.ui.backdropImageryLimitedDesktop' : 'exportPanel.ui.backdropImageryLimitedWeb', { mpp: backdropPlan.metresPerPixel.toFixed(1) }) }}
            </p>
            <p v-else-if="beamNGBackdropSource === 'global30m' && backdropPlan.tiles > BACKDROP_MANY_TILES" class="pl-4 text-caption leading-snug text-amber-700 dark:text-amber-300">
              {{ t('exportPanel.ui.backdropImagerySlow', { n: backdropPlan.tiles.toLocaleString() }) }}
            </p>
            <p v-if="exportDataStatus && exportDataStatus.status !== 'idle'" class="text-caption leading-snug" :class="exportDataStatus.status === 'failed' ? 'text-amber-700 dark:text-amber-300' : 'text-gray-500 dark:text-gray-400'">
              {{ exportDataStatus.status === 'running'
                ? t('exportPanel.ui.dataRunning', { pct: Math.round((exportDataStatus.fraction || 0) * 100) })
                : exportDataStatus.status === 'done' ? t('exportPanel.ui.dataDone') : t('exportPanel.ui.dataFailed') }}
            </p>
          </SettingCard>

          <!-- How heavy the level will be (services/levelWeight.js): warnings, never a block -->
          <SettingCard :title="t('exportPanel.weight.title')">
            <template #header>
              <span
                class="px-1.5 py-0.5 rounded text-micro font-semibold"
                :class="{
                  'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300': levelWeight.rating === 'light',
                  'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300': levelWeight.rating === 'heavy',
                  'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300': levelWeight.rating === 'veryHeavy',
                }"
              >{{ t(`exportPanel.weight.rating_${levelWeight.rating}`) }}</span>
            </template>
            <p class="text-caption leading-snug text-gray-600 dark:text-gray-300">
              {{ t('exportPanel.weight.size', { km: levelWeight.sizeKm < 10 ? levelWeight.sizeKm.toFixed(1) : Math.round(levelWeight.sizeKm), far: levelWeight.farthestKm < 10 ? levelWeight.farthestKm.toFixed(1) : Math.round(levelWeight.farthestKm), buildings: levelWeight.builtBuildings.toLocaleString() }) }}
              {{ t(`exportPanel.weight.summary_${levelWeight.rating}`) }}
            </p>
            <!-- a terrain that is not a power-of-two square is cut to one (services/squareCrop.js) -->
            <p v-if="squareCrop" class="flex gap-1.5 text-caption leading-snug text-amber-700 dark:text-amber-300" data-testid="square-crop">
              <AlertTriangle :size="12" class="shrink-0 mt-px" />
              <span>
                {{ t('exportPanel.weight.squareCrop', { w: squareCrop.width, h: squareCrop.height, size: squareCrop.size, pct: Math.round(squareCrop.keptShare * 100) }) }}
                <template v-if="squareCrop.suggestMpp">{{ ' ' + t('exportPanel.weight.squareCropTip', { mpp: squareCrop.suggestMpp, size: squareCrop.suggestSize }) }}</template>
              </span>
            </p>
            <ul v-if="levelWeight.notes.length" class="space-y-1">
              <li
                v-for="note in levelWeight.notes"
                :key="note.key"
                class="flex gap-1.5 text-caption leading-snug"
                :class="note.rating === 'veryHeavy' ? 'text-red-700 dark:text-red-300' : note.rating === 'heavy' ? 'text-amber-700 dark:text-amber-300' : 'text-gray-600 dark:text-gray-300'"
              >
                <AlertTriangle v-if="note.rating !== 'light'" :size="12" class="shrink-0 mt-px" />
                <span>{{ t(`exportPanel.weight.${note.key}`, note.params) }}</span>
              </li>
            </ul>
          </SettingCard>

          <p class="px-0.5 text-caption leading-snug text-gray-500 dark:text-gray-400">{{ t('exportPanel.communityQualityNotice') }}</p>

          <!-- Export button (in the wizard: in its bottom bar, buttonTarget) -->
          <Teleport defer :to="buttonTarget || 'body'" :disabled="!buttonTarget">
            <button
              @click="onBeamNGExportClick"
              :disabled="isAnyExporting"
              class="relative w-full flex items-center gap-3 p-3 bg-brand hover:bg-brand-500 border border-brand-500 rounded text-white transition-colors group disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <div class="flex items-center justify-center w-8 h-8 shrink-0">
                <Loader2 v-if="isExportingBeamNGLevel || levelCheck?.state === 'checking'" :size="20" class="animate-spin text-white" />
                <ShieldCheck v-else-if="exportUpToDate" :size="20" class="text-white/90" />
                <PackageOpen v-else :size="20" class="text-white/90" />
              </div>
              <div v-if="exportUpToDate && !isExportingBeamNGLevel" class="text-left">
                <div class="text-xs font-semibold">{{ t('exportPanel.ui.checkLevel') }}</div>
                <div class="text-micro text-white/90">{{ t('exportPanel.ui.levelUpToDate', { ago: exportedAgo }) }}</div>
              </div>
              <div v-else class="text-left">
                <div class="text-xs font-semibold">{{ t('exportPanel.beamngLevelExport') }}</div>
                <div class="text-micro text-white/90">{{ t('exportPanel.generatePlayableZip') }}</div>
              </div>
              <Download v-if="!isAnyExporting && !exportUpToDate" :size="10" class="absolute top-1 right-1 opacity-70 group-hover:opacity-100 transition-opacity text-white" />
            </button>

            <!-- nothing changed since the last export: what the check found, and building it again anyway -->
            <div v-if="(exportUpToDate || levelCheck) && !isExportingBeamNGLevel" class="flex items-center justify-between gap-2 px-0.5 text-caption">
              <span v-if="levelCheck?.state === 'ok'" class="flex items-center gap-1 text-emerald-700 dark:text-emerald-400"><CheckCircle2 :size="12" />{{ t('exportPanel.ui.levelChecked') }}</span>
              <span v-else-if="levelCheck?.state === 'rebuilding'" class="text-amber-700 dark:text-amber-300 [overflow-wrap:anywhere]">{{ t('exportPanel.ui.levelRebuilt', { problems: levelCheck.problems.join('; ') }) }}</span>
              <span v-else class="text-gray-500 dark:text-gray-400">{{ t('exportPanel.ui.nothingChanged') }}</span>
              <button v-if="exportUpToDate" type="button" class="shrink-0 underline text-gray-600 dark:text-gray-300 hover:text-brand" :disabled="isAnyExporting" @click="handleBeamNGLevelExport()">{{ t('exportPanel.ui.rebuildAnyway') }}</button>
            </div>

            <a
              v-if="beamNGPendingDownloadUrl"
              :href="beamNGPendingDownloadUrl"
              :download="beamNGPendingDownloadName || 'beamng_level.zip'"
              @click="handleBeamNGPendingDownloadClick"
              class="w-full flex items-center justify-center gap-2 p-2 bg-emerald-600 hover:bg-emerald-700 border border-emerald-700 rounded text-white text-caption font-medium transition-colors"
            >
              <Download :size="14" />
              {{ t('exportPanel.downloadReady', { name: beamNGPendingDownloadName || 'beamng_level.zip' }) }}
            </a>

          </Teleport>

          <div
            v-if="beamNGDesktopFailed"
            id="mapng-export-outcome-failed"
            class="w-full flex items-start gap-2 p-2 rounded border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/20"
          >
            <AlertCircle :size="14" class="shrink-0 mt-0.5 text-red-600 dark:text-red-400" />
            <div class="min-w-0 flex-1 space-y-1.5">
              <div class="text-caption font-medium text-red-700 dark:text-red-300">{{ t('exportPanel.desktopFailed') }}</div>
              <div class="text-micro text-red-700/90 dark:text-red-300/90 [overflow-wrap:anywhere]">{{ beamNGDesktopFailed.message }}</div>
              <button v-if="beamNGDesktopFailed.logPath" type="button" class="flex items-center gap-1 px-2 py-0.5 text-micro rounded border border-red-300 dark:border-red-700 bg-white dark:bg-gray-800 text-red-700 dark:text-red-300 hover:border-brand hover:text-brand transition-colors" @click="showDesktopExportLog">
                <FileText :size="11" />{{ t('exportPanel.desktopShowLog') }}
              </button>
              <!-- (a report with this export's log and settings, after the user sees what's in it) -->
              <button type="button" class="flex items-center gap-1 px-2 py-0.5 text-micro rounded border border-red-300 dark:border-red-700 bg-white dark:bg-gray-800 text-red-700 dark:text-red-300 hover:border-brand hover:text-brand transition-colors" @click="reportDesktopExportFailure">
                <LifeBuoy :size="11" />{{ t('report.sendReport') }}
              </button>
            </div>
          </div>

          <div
            v-if="beamNGDesktopSaved"
            id="mapng-export-outcome-saved"
            class="w-full flex items-start gap-2 p-2 rounded border border-gray-200 dark:border-gray-600 bg-gray-50 dark:bg-gray-700/50"
          >
            <CheckCircle2 :size="14" class="shrink-0 mt-0.5 text-brand" />
            <div class="min-w-0 flex-1 space-y-1.5">
              <div class="text-caption font-medium text-gray-700 dark:text-gray-200 [overflow-wrap:anywhere]">{{ t('exportPanel.desktopSaved', { name: beamNGDesktopSaved.filename }) }}</div>
              <div class="text-micro text-gray-500 dark:text-gray-400">{{ t('exportPanel.desktopLoadHint') }}</div>
              <div class="flex flex-wrap gap-1.5">
                <button type="button" class="flex items-center gap-1 px-2 py-0.5 text-micro rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-200 hover:border-brand hover:text-brand transition-colors" @click="showDesktopSavedLevel">
                  <FolderOpen :size="11" />{{ t('exportPanel.desktopShowInFolder') }}
                </button>
                <button type="button" class="px-2 py-0.5 text-micro rounded text-gray-500 dark:text-gray-400 hover:text-brand transition-colors" @click="changeDesktopModsFolder">{{ t('exportPanel.desktopChangeFolder') }}</button>
              </div>
            </div>
          </div>

          <!-- Once, after a first export: share where exports are (only a ~5 km cell) for the hotspot map -->
          <div
            v-if="askShareExports"
            class="w-full flex items-start gap-2 p-2 rounded border border-brand/40 bg-orange-50 dark:bg-orange-900/10"
          >
            <Flame :size="14" class="shrink-0 mt-0.5 text-brand" />
            <div class="min-w-0 flex-1 space-y-1.5">
              <div class="text-caption font-medium text-gray-800 dark:text-gray-100">{{ t('hotspots.askTitle') }}</div>
              <div class="text-micro leading-snug text-gray-600 dark:text-gray-300">{{ t('hotspots.askBody') }} <button type="button" class="text-brand hover:underline" @click.prevent.stop="openHotspotPrivacy">{{ t('hotspots.privacy.link') }}</button></div>
              <div class="flex flex-wrap gap-1.5">
                <button type="button" class="px-2.5 py-0.5 text-micro font-semibold rounded bg-brand hover:bg-brand-500 text-white transition-colors" @click="answerShareExports(true)">{{ t('hotspots.askYes') }}</button>
                <button type="button" class="px-2 py-0.5 text-micro rounded text-gray-500 dark:text-gray-400 hover:text-brand transition-colors" @click="answerShareExports(false)">{{ t('hotspots.askNo') }}</button>
              </div>
            </div>
          </div>
          <div
            v-else-if="askShareSettings"
            class="w-full flex items-start gap-2 p-2 rounded border border-brand/40 bg-orange-50 dark:bg-orange-900/10"
          >
            <BarChart3 :size="14" class="shrink-0 mt-0.5 text-brand" />
            <div class="min-w-0 flex-1 space-y-1.5">
              <div class="text-caption font-medium text-gray-800 dark:text-gray-100">{{ t('usage.askTitle') }}</div>
              <div class="text-micro leading-snug text-gray-600 dark:text-gray-300">{{ t('usage.askBody') }} <button type="button" class="text-brand hover:underline" @click.prevent.stop="openUsagePrivacy">{{ t('usage.readMore') }}</button></div>
              <div class="flex flex-wrap gap-1.5">
                <button type="button" class="px-2.5 py-0.5 text-micro font-semibold rounded bg-brand hover:bg-brand-500 text-white transition-colors" @click="answerShareSettings(true)">{{ t('usage.askYes') }}</button>
                <button type="button" class="px-2 py-0.5 text-micro rounded text-gray-500 dark:text-gray-400 hover:text-brand transition-colors" @click="answerShareSettings(false)">{{ t('usage.askNo') }}</button>
              </div>
            </div>
          </div>
      </SettingSection>

      <!-- Assets for creators (the Generate step's choice: Assets or Both; composables/useWorkflow.js) -->
      <div v-if="showAssets" class="space-y-1" :class="showLevel ? 'pt-3 border-t border-gray-200 dark:border-gray-600' : ''" data-testid="export-half-assets">
        <div class="text-micro font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500">{{ t('exportPanel.ui.halfAssets') }}</div>
        <p class="text-caption leading-snug text-gray-500 dark:text-gray-400">{{ t('exportPanel.ui.halfAssetsHint') }}</p>
      </div>
      <!-- 2D Assets -->
      <SettingSection v-if="showAssets" v-model:open="showExport2D" :title="t('exportPanel.assets2d')" :icon="Layers" data-testid="export-2d-section">
        <div class="grid grid-cols-2 gap-1.5">
          <!-- Heightmap -->
          <button 
            @click="downloadHeightmap"
            :disabled="isAnyExporting"
            class="relative flex flex-col items-center justify-center p-1.5 bg-white dark:bg-gray-800 hover:bg-gray-50 dark:hover:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded text-sm text-gray-700 dark:text-gray-300 transition-colors group disabled:opacity-50 disabled:cursor-not-allowed h-24 overflow-hidden"
          >
            <div class="w-full h-full flex items-center justify-center mb-0.5 overflow-hidden rounded bg-gray-100 dark:bg-gray-900">
              <Loader2 v-if="isExportingHeightmap" :size="20" class="animate-spin text-brand" />
              <img v-else-if="heightmapPreviewUrl" :src="heightmapPreviewUrl" class="w-full h-full object-cover" />
              <Mountain v-else :size="24" class="text-gray-400 dark:text-gray-500" />
            </div>
            <span class="text-caption font-medium">{{ t('exportPanel.heightmap') }}</span>
            <span class="text-micro text-gray-500 dark:text-gray-400">{{ terrainData.width }}px 16-bit grayscale PNG</span>
            <Download v-if="!isAnyExporting" :size="10" class="absolute top-1 right-1 opacity-0 group-hover:opacity-100 transition-opacity text-brand" />
          </button>

          <!-- Satellite Texture -->
          <button 
            @click="downloadTexture"
            :disabled="isAnyExporting"
            class="relative flex flex-col items-center justify-center p-1.5 bg-white dark:bg-gray-800 hover:bg-gray-50 dark:hover:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded text-sm text-gray-700 dark:text-gray-300 transition-colors group disabled:opacity-50 disabled:cursor-not-allowed h-24 overflow-hidden"
          >
            <div class="w-full h-full flex items-center justify-center mb-0.5 overflow-hidden rounded bg-gray-100 dark:bg-gray-900">
              <Loader2 v-if="isExportingTexture" :size="20" class="animate-spin text-brand" />
              <img v-else-if="satellitePreviewUrl" :src="satellitePreviewUrl" class="w-full h-full object-cover" />
              <Box v-else :size="24" class="text-gray-400 dark:text-gray-500" />
            </div>
            <span class="text-caption font-medium">{{ t('exportPanel.satellite') }}</span>
            <span class="text-micro text-gray-500 dark:text-gray-400">{{ terrainData.width }}px PNG</span>
            <Download v-if="!isAnyExporting" :size="10" class="absolute top-1 right-1 opacity-0 group-hover:opacity-100 transition-opacity text-brand" />
          </button>

          <!-- OSM Texture -->
          <button 
            @click="downloadOSMTexture"
            :disabled="!hasOsmData || isAnyExporting"
            class="relative flex flex-col items-center justify-center p-1.5 bg-white dark:bg-gray-800 hover:bg-gray-50 dark:hover:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded text-sm text-gray-700 dark:text-gray-300 transition-colors group disabled:opacity-50 disabled:cursor-not-allowed h-24 overflow-hidden"
          >
            <div class="w-full h-full flex items-center justify-center mb-0.5 overflow-hidden rounded bg-gray-100 dark:bg-gray-900">
              <Loader2 v-if="isExportingOSMTexture" :size="20" class="animate-spin text-brand" />
              <img v-else-if="osmPreviewUrl" :src="osmPreviewUrl" class="w-full h-full object-cover" />
              <Trees v-else :size="24" class="text-gray-400 dark:text-gray-500" />
            </div>
            <span class="text-caption font-medium">{{ t('exportPanel.osmTexture') }}</span>
            <span class="text-micro text-gray-500 dark:text-gray-400">{{ terrainData.width }}px PNG</span>
            <Download v-if="!isAnyExporting" :size="10" class="absolute top-1 right-1 opacity-0 group-hover:opacity-100 transition-opacity text-brand" />
          </button>

          <!-- Game Texture -->
          <button 
            @click="downloadGameTexture"
            :disabled="!hasOsmData || isAnyExporting"
            class="relative flex flex-col items-center justify-center p-1.5 bg-white dark:bg-gray-800 hover:bg-gray-50 dark:hover:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded text-sm text-gray-700 dark:text-gray-300 transition-colors group disabled:opacity-50 disabled:cursor-not-allowed h-24 overflow-hidden"
          >
            <div class="w-full h-full flex items-center justify-center mb-0.5 overflow-hidden rounded bg-gray-100 dark:bg-gray-900">
              <Loader2 v-if="isExportingGameTexture" :size="20" class="animate-spin text-brand" />
              <img v-else-if="gamePreviewUrl" :src="gamePreviewUrl" class="w-full h-full object-cover" />
              <Layers v-else :size="24" class="text-gray-400 dark:text-gray-500" />
            </div>
            <span class="text-caption font-medium">{{ t('exportPanel.gameTexture') }}</span>
            <span class="text-micro text-gray-500 dark:text-gray-400">{{ terrainData.width }}px PNG</span>
            <Download v-if="!isAnyExporting" :size="10" class="absolute top-1 right-1 opacity-0 group-hover:opacity-100 transition-opacity text-brand" />
          </button>

          <!-- Road Mask -->
          <button 
            @click="downloadRoadMask"
            :disabled="!terrainData.osmFeatures || terrainData.osmFeatures.length === 0 || isAnyExporting"
            class="relative flex flex-col items-center justify-center p-1.5 bg-white dark:bg-gray-800 hover:bg-gray-50 dark:hover:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded text-sm text-gray-700 dark:text-gray-300 transition-colors group disabled:opacity-50 disabled:cursor-not-allowed h-24 overflow-hidden"
          >
            <div class="w-full h-full flex items-center justify-center mb-0.5 overflow-hidden rounded bg-gray-100 dark:bg-gray-900">
              <Loader2 v-if="isExportingRoadMask" :size="20" class="animate-spin text-brand" />
              <img v-else-if="roadMaskPreviewUrl" :src="roadMaskPreviewUrl" class="w-full h-full object-cover" />
              <Route v-else :size="24" class="text-gray-400 dark:text-gray-500" />
            </div>
            <span class="text-caption font-medium">{{ t('exportPanel.roadMask') }}</span>
            <span class="text-micro text-gray-500 dark:text-gray-400">{{ terrainData.width }}px 16-bit grayscale PNG</span>
            <Download v-if="!isAnyExporting" :size="10" class="absolute top-1 right-1 opacity-0 group-hover:opacity-100 transition-opacity text-brand" />
          </button>
        </div>
      </SettingSection>

      <!-- 3D Models (advanced mode) -->
      <SettingSection v-if="showAssets" v-model:open="showExport3D" :title="t('exportPanel.models3d')" :icon="Box" data-testid="export-3d-section">

        <template v-if="showExport3D">
          <!-- Shared 3D options -->
          <div class="space-y-2 px-2 py-2 bg-gray-50 dark:bg-gray-700/50 rounded border border-gray-200 dark:border-gray-600">
            <div class="flex items-center gap-1.5">
              <span class="text-nano text-gray-500 dark:text-gray-400">{{ t('exportPanel.centerTexture') }}</span>
              <select v-model="modelCenterTextureType" :class="SELECT_XS">
                <option value="satellite">{{ t('exportPanel.satellite') }}</option>
                <option value="osm" :disabled="!hasOsmData">{{ t('exportPanel.osm') }}</option>
                <option value="hybrid" :disabled="!hasOsmData">{{ t('exportPanel.hybrid') }}</option>
                <option value="none">{{ t('exportPanel.none') }}</option>
              </select>
            </div>
            <div class="flex items-center gap-2 flex-nowrap overflow-x-auto whitespace-nowrap pb-0.5">
              <span class="text-nano text-gray-500 dark:text-gray-400">{{ t('exportPanel.tiles') }}</span>
              <label class="flex items-center gap-1 cursor-pointer">
                <input type="radio" v-model="modelTileSelection" value="center-only" class="accent-brand w-3 h-3" />
                <span class="text-nano text-gray-500 dark:text-gray-400">{{ t('exportPanel.center') }}</span>
              </label>
              <label class="flex items-center gap-1 cursor-pointer">
                <input type="radio" v-model="modelTileSelection" value="center-plus-surroundings" class="accent-brand w-3 h-3" />
                <span class="text-nano text-gray-500 dark:text-gray-400">{{ t('exportPanel.centerPlusSurroundings') }}</span>
              </label>
              <label class="flex items-center gap-1 cursor-pointer">
                <input type="radio" v-model="modelTileSelection" value="surroundings-only" class="accent-brand w-3 h-3" />
                <span class="text-nano text-gray-500 dark:text-gray-400">{{ t('exportPanel.surroundingsOnly') }}</span>
              </label>
            </div>
            <label class="flex items-center gap-1.5 cursor-pointer">
              <input type="checkbox" v-model="modelRealWorldScale" :class="CHECKBOX" />
              <span class="text-nano text-gray-500 dark:text-gray-400">{{ t('exportPanel.realWorldScale') }}</span>
            </label>
            <!-- the area modelled: the whole map, or a square picked on the 2D preview (services/modelArea.js) -->
            <div class="flex items-center justify-between gap-2" data-testid="model-area">
              <span class="text-nano text-gray-500 dark:text-gray-400">{{ t('exportPanel.ui.modelArea') }}: <span class="text-gray-700 dark:text-gray-200">{{ store.modelAreaPicking ? t('exportPanel.ui.modelAreaPicking') : store.modelArea ? t('exportPanel.ui.modelAreaPart', { m: Math.round(modelAreaRect.size * meshMpp) }) : t('exportPanel.ui.modelAreaWhole') }}</span></span>
              <span class="flex items-center gap-2 shrink-0">
                <button type="button" class="text-nano font-semibold text-brand hover:underline" data-testid="model-area-pick" @click="pickModelArea">{{ t('exportPanel.ui.modelAreaPick') }}</button>
                <button v-if="store.modelArea" type="button" class="text-nano font-semibold text-brand hover:underline" data-testid="model-area-clear" @click="store.modelArea = null">{{ t('exportPanel.ui.modelAreaWhole') }}</button>
              </span>
            </div>
            <!-- a mesh too big for one file goes out as tiles that share their edges -->
            <div class="flex items-center justify-between gap-2">
              <span class="text-nano text-gray-500 dark:text-gray-400">{{ t('exportPanel.ui.modelTiles') }}</span>
              <select v-model="modelTiles" :class="SELECT_XS" data-testid="model-tiles" :aria-label="t('exportPanel.ui.modelTiles')">
                <option value="auto">{{ t('exportPanel.ui.modelTilesAuto', { k: modelTilesAuto || 16 }) }}</option>
                <option v-for="k in TILE_COUNTS" :key="k" :value="String(k)">{{ k === 1 ? t('exportPanel.ui.modelTilesOne') : `${k} × ${k}` }}</option>
              </select>
            </div>
            <!-- the mesh's point spacing, and what it costs, before the download (services/modelMesh.js) -->
            <div class="flex items-center justify-between gap-2">
              <span class="text-nano text-gray-500 dark:text-gray-400">{{ t('exportPanel.ui.meshSpacing') }}</span>
              <select v-model="modelMeshStride" :class="SELECT_XS" data-testid="mesh-spacing" :aria-label="t('exportPanel.ui.meshSpacing')">
                <option value="auto">{{ t('exportPanel.ui.meshSpacingAuto', { m: meshSpacingText(meshPlan(modelAreaRect.size, meshMpp, autoStride(modelAreaRect.size)).spacingM) }) }}</option>
                <option v-for="s in MESH_STRIDES" :key="s" :value="String(s)">{{ t('exportPanel.ui.meshSpacingEvery', { m: meshSpacingText(s * meshMpp) }) }}</option>
              </select>
            </div>
            <p class="text-nano tabular-nums" :class="modelMesh.tooBig ? 'text-amber-700 dark:text-amber-300' : 'text-gray-500 dark:text-gray-400'" data-testid="mesh-info">
              {{ t(modelMesh.tooBig ? 'exportPanel.ui.meshTooBig' : modelTileCount > 1 ? 'exportPanel.ui.meshInfoTiles' : 'exportPanel.ui.meshInfo', { k: modelTileCount, side: modelMesh.side.toLocaleString(), millions: (modelMesh.points / 1e6).toFixed(modelMesh.points < 1e7 ? 1 : 0), size: formatBytes(modelMesh.bytes * modelTileCount * modelTileCount) }) }}
            </p>
          </div>

          <div class="grid grid-cols-2 gap-1.5">
            <!-- GLB Model -->
            <button 
              @click="handleGLBExport"
              :disabled="isAnyExporting || modelMesh.tooBig"
              class="relative flex flex-col items-center justify-center p-2 bg-white dark:bg-gray-800 hover:bg-gray-50 dark:hover:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded text-sm text-gray-700 dark:text-gray-300 transition-colors group disabled:opacity-50 disabled:cursor-not-allowed h-20"
            >
              <div class="w-full h-full flex items-center justify-center mb-0.5">
                <Loader2 v-if="isExportingGLB" :size="20" class="animate-spin text-brand" />
                <Box v-else :size="24" class="text-gray-400 dark:text-gray-500" />
              </div>
              <span class="text-caption font-medium">{{ t('exportPanel.glbModel') }}</span>
              <span class="text-micro text-gray-500 dark:text-gray-400">.glb binary</span>
              <Download v-if="!isAnyExporting" :size="10" class="absolute top-1 right-1 opacity-0 group-hover:opacity-100 transition-opacity text-brand" />
            </button>

            <!-- DAE (Collada) Model -->
            <button 
              @click="handleDAEExport"
              :disabled="isAnyExporting || modelMesh.tooBig || modelTileCount > 1"
              :title="modelTileCount > 1 ? t('exportPanel.ui.daeNoTiles') : ''"
              class="relative flex flex-col items-center justify-center p-2 bg-white dark:bg-gray-800 hover:bg-gray-50 dark:hover:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded text-sm text-gray-700 dark:text-gray-300 transition-colors group disabled:opacity-50 disabled:cursor-not-allowed h-20"
            >
              <div class="w-full h-full flex items-center justify-center mb-0.5">
                <Loader2 v-if="isExportingDAE" :size="20" class="animate-spin text-brand" />
                <FileCode v-else :size="24" class="text-gray-400 dark:text-gray-500" />
              </div>
              <span class="text-caption font-medium">{{ t('exportPanel.colladaDae') }}</span>
              <span class="text-micro text-gray-500 dark:text-gray-400">.dae + textures</span>
              <Download v-if="!isAnyExporting" :size="10" class="absolute top-1 right-1 opacity-0 group-hover:opacity-100 transition-opacity text-brand" />
            </button>
            
            <!-- TER (BeamNG) Model -->
            <button 
              @click="handleTERExport"
              :disabled="isAnyExporting"
              class="relative flex flex-col items-center justify-center p-2 bg-white dark:bg-gray-800 hover:bg-gray-50 dark:hover:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded text-sm text-gray-700 dark:text-gray-300 transition-colors group disabled:opacity-50 disabled:cursor-not-allowed h-20"
            >
              <div class="w-full h-full flex items-center justify-center mb-0.5">
                <Loader2 v-if="isExportingTER" :size="20" class="animate-spin text-brand" />
                <FileCode v-else :size="24" class="text-gray-400 dark:text-gray-500" />
              </div>
              <span class="text-caption font-medium">{{ t('exportPanel.beamngTerrain') }}</span>
              <span class="text-micro text-gray-500 dark:text-gray-400">.ter heightmap</span>
              <Download v-if="!isAnyExporting" :size="10" class="absolute top-1 right-1 opacity-0 group-hover:opacity-100 transition-opacity text-brand" />
            </button>
          </div>
        </template>
      </SettingSection>

      <!-- Geo Data -->
      <SettingSection v-if="showAssets" v-model:open="showExportGeo" :title="t('exportPanel.geoData')" :icon="FileJson" data-testid="export-geo-section">
        <div class="space-y-2">
          <div class="grid grid-cols-2 gap-1.5">
            <!-- GeoTIFF -->
            <button 
              @click="downloadGeoTIFF"
              :disabled="isAnyExporting"
              class="relative flex flex-col items-center justify-center p-2 bg-white dark:bg-gray-800 hover:bg-gray-50 dark:hover:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded text-sm text-gray-700 dark:text-gray-300 transition-colors group disabled:opacity-50 disabled:cursor-not-allowed h-20"
            >
              <div class="w-full h-full flex items-center justify-center mb-0.5">
                <Loader2 v-if="isExportingGeoTIFF" :size="20" class="animate-spin text-brand" />
                <FileCode v-else :size="24" class="text-gray-400 dark:text-gray-500" />
              </div>
              <span class="text-caption font-medium">{{ t('exportPanel.geoTiff') }}</span>
              <span class="text-micro text-gray-500 dark:text-gray-400">{{ terrainData?.sourceGeoTiffs ? terrainData.sourceGeoTiffs.source.toUpperCase() : 'WGS84' }}</span>
              <Download v-if="!isAnyExporting" :size="10" class="absolute top-1 right-1 opacity-0 group-hover:opacity-100 transition-opacity text-brand" />
            </button>

            <!-- OSM GeoJSON -->
            <button 
              @click="downloadOSM"
              :disabled="!terrainData.osmFeatures || terrainData.osmFeatures.length === 0 || isAnyExporting"
              class="relative flex flex-col items-center justify-center p-2 bg-white dark:bg-gray-800 hover:bg-gray-50 dark:hover:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded text-sm text-gray-700 dark:text-gray-300 transition-colors group disabled:opacity-50 disabled:cursor-not-allowed h-20"
            >
              <div class="w-full h-full flex items-center justify-center mb-0.5">
                <Loader2 v-if="isExportingOSM" :size="20" class="animate-spin text-brand" />
                <FileJson v-else :size="24" class="text-gray-400 dark:text-gray-500" />
              </div>
              <span class="text-caption font-medium">{{ t('exportPanel.geoJson') }}</span>
              <span class="text-micro text-gray-500 dark:text-gray-400">{{ t('exportPanel.osmVectors') }}</span>
              <Download v-if="!isAnyExporting" :size="10" class="absolute top-1 right-1 opacity-0 group-hover:opacity-100 transition-opacity text-brand" />
            </button>
          </div>

          <div class="rounded border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/20 px-2.5 py-2 text-micro text-amber-800 dark:text-amber-300 leading-snug">
            <p>
              {{ t('exportPanel.cleanupToolNotice') }}
              <a
                href="https://github.com/alexkleinwaechter/BeamNG_LevelCleanUp/releases/latest"
                target="_blank"
                rel="noopener noreferrer"
                class="font-semibold text-brand underline underline-offset-2 hover:text-brand-500 transition-colors"
              >
                {{ t('exportPanel.cleanupToolLinkLabel') }}
              </a>
              {{ t('exportPanel.cleanupToolCredit') }}
            </p>
          </div>
        </div>
      </SettingSection>
  </div>

  <!-- BeamNG export progress modal -->
  <Teleport to="body">
    <Transition name="fade">
      <div
        v-if="isExportingBeamNGLevel"
        class="fixed inset-0 z-[9999] flex items-center justify-center p-4 pb-28 overflow-y-auto bg-gray-900/10 dark:bg-black/25"
      >
        <!-- the stage card (components/ui/StageLoader.vue), fed by the exporter's
             phases (EXPORT_STEP_GROUPS) -->
        <StageLoader
          :title="t('exportPanel.exportingBeamng')"
          :finished="exportFinished"
          :steps="exportSteps"
          :active-stage="beamNGPhase"
          :active-fraction="beamNGPhaseFraction"
          :pct="beamNGProgressPct"
          :status="beamNGProgressStep"
          :done="beamNGProgressDone"
          :elapsed-ms="beamNGElapsedMs"
          :elapsed-label="t('exportPanel.elapsed')"
          :cancellable="desktopApp"
          :cancel-label="t('levels.cancel')"
          :settings="exportSettingsShown"
          :settings-label="t('exportSettings.title')"
          @cancel="cancelDesktopExport"
        />
      </div>
    </Transition>
  </Teleport>

  <!-- Base texture touch-up painter -->
  <Teleport to="body">
    <TexturePaintModal
      v-if="showTexturePaintModal"
      :source-url="texturePaintSourceUrl"
      :resume-url="texturePaintResumeUrl"
      :source-label="texturePaintSourceLabel"
      @close="closeTexturePaint"
      @save="handleTexturePaintSave"
    />
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
import { ref, shallowRef, computed, watch, nextTick, onUnmounted, toRaw } from 'vue';
import { useMainStore } from '../../stores/mainStore';
import { useI18n } from 'vue-i18n';
import {
  Download, ChevronDown, Loader2, Mountain, Box, Trees, Layers, Route, FileCode, FileJson, PackageOpen, Paintbrush, CheckCircle2, FolderOpen, AlertCircle, FileText, Flame, AlertTriangle, LifeBuoy, BarChart3, Compass, Building2, Package, ShieldCheck
} from 'lucide-vue-next';
import { zipIndexOfBlob, levelZipProblems } from '../../services/zipIndex.js';
import { VIEW_DISTANCES_M, AUTO_VIEW_DISTANCE, viewDistanceChoice, autoViewDistance } from '../../services/viewDistance.js';
import StageLoader from '../ui/StageLoader.vue';
import { rasterizeMask, backgroundFraction } from '../../services/backgroundMask.js';
import { summarizeExportSettings, translateExportSettings } from '../../services/exportSettingsSummary.js';
import TexturePaintModal from '../modals/TexturePaintModal.vue';
import { buildRunConfiguration as buildRunConfigurationBase } from '../../services/runConfiguration';
import { generateHeightmapBlob, generateTerBlob } from '../../services/batchExports';
import { exportToGLB, exportToDAE } from '../../services/export3d';
import { useWorkflow } from '../../composables/useWorkflow.js';
import { ensureTexture, hasTexture } from '../../services/textureOnDemand.js';
import { MESH_STRIDES, meshPlan, autoStride, strideOf, maxMeshResolutionFor } from '../../services/modelMesh.js';
import { TILE_COUNTS, clampArea, tileRects, tilesNeeded, partOffset } from '../../services/modelArea.js';
import { exportGeoTiff } from '../../services/exportGeoTiff';
import { buildCommonTraceMetadata, downloadJsonFile } from '../../services/traceability';
import { createWGS84ToLocal } from '../../services/geoUtils';
import { exportBeamNGLevel, EXPORT_STEP_GROUPS } from '../../services/exportBeamNGLevel';
import { terrainMode, terrainShapingOptions, terrainGenerationOptions } from '../../composables/useTerrainMode.js';
import { desktopApp, exportLevelOnDesktop, prefetchExportDataOnDesktop } from '../../services/platform/desktop.js';
import { downloadExportData, ensureExportData, exportDataNeeds, exportDataState, onExportDataChange } from '../../services/exportData.js';
import { withDownloadGuard } from '../../services/dataCache.js';
import { pageStepCache } from '../../services/stepCache.js';
import { openHotspotPrivacy, reportExport, useExportHotspots } from '../../composables/useExportHotspots.js';
import SettingSection from '../base/SettingSection.vue';
import SettingCard from '../base/SettingCard.vue';
import SettingRow from '../base/SettingRow.vue';
import { BACKDROP_APPLIED_KEY } from '../../services/exportSettings.js';
import { BACKDROP_IMAGERY_IDS, backdropImageryId, backdropImageryPlan, WEB_STITCH_LIMIT_PX, DESKTOP_STITCH_LIMIT_PX } from '../../services/backdropImagery.js';
import { readGameTextureBlend, writeGameTextureBlend, repaintGameTexture, canBlendLive, prepareBlendAnchors, composeBlend, commitGameTextureCanvas } from '../../services/gameTextureBlend.js';
import WhatToBuild from './WhatToBuild.vue';
import { legacyOn, isBuilt, contentOptions } from '../../composables/useBuildContent.js';
import { useBaseTexture } from '../../composables/useBaseTexture.js';
import { PENDING_LEVEL_NAME_KEY } from '../../services/exportSettings.js';
import { currentSessionCode, currentSessionConfigValue, openReportDialog } from '../../composables/useReportDialog.js';
import { markJobStart, markJobEnd } from '../../services/sessionGuard.js';
import { heavyJobRunning } from '../../services/heavyJob.js';
import { reportUsage, useUsageStats } from '../../composables/useUsageStats.js';
import { estimateLevelWeight } from '../../services/levelWeight.js';
import { sanitizeTreeKindsOff, sanitizeTreeModelsOff, sanitizeTreeSwaps } from '../../services/beamngTrees.js';
import { squareCropNotice } from '../../services/squareCrop.js';
import { CHECKBOX, SELECT_XS } from '../base/controlStyles.js';
import { prepareCroppedTerrainData } from '../../services/cropTerrain';
import { reverseLocationName } from '../../services/nominatim';

const { t } = useI18n({ useScope: 'global' });

const props = defineProps({
  terrainData: { type: Object, default: null },
  // (the wizard's bottom bar: a selector the export button is teleported to)
  buttonTarget: { type: String, default: '' },
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
// (the button is in the wizard's bottom bar: bring what came of the export into view)
const showExportOutcome = (id) => nextTick(() => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'center' }));


const store = useMainStore();
const advancedMode = computed(() => store.advancedMode);
// (what the Generate step said is being made: which halves of this panel show)
const { showLevel, showAssets } = useWorkflow();

const emit = defineEmits(['fetchOsm', 'exportSuccess']);
const BEAMNG_EXPORT_UI_LOG = '[BeamNG Export UI]';

// Export states
const isExportingHeightmap = ref(false);
const isExportingTexture = ref(false);
const isExportingOSMTexture = ref(false);
const isExportingHybridTexture = ref(false);
const isExportingGameTexture = ref(false);
const isExportingRoadMask = ref(false);
const isExportingGeoTIFF = ref(false);
const isExportingGLB = ref(false);
const isExportingDAE = ref(false);
const isExportingTER = ref(false);
const isExportingOSM = ref(false);
const isExportingBeamNGLevel = ref(false);
const beamNGProgressStep = ref('');
const beamNGProgressPct  = ref(0);
// Finished export steps ({ step, durationMs }) and the time since export began.
const beamNGProgressDone = ref([]);
// the stage card: the exporter's phase running, its share done, each phase's weight
const beamNGPhase = ref(null);
const beamNGPhaseFraction = ref(0);
const beamNGPhaseWeights = ref({});
const EXPORT_STEP_ICONS = { prepare: Compass, roads: Route, terrain: Mountain, buildings: Building2, nature: Trees, package: Package };
const exportSteps = computed(() => EXPORT_STEP_GROUPS.map((g) => ({
  key: g.key,
  label: t(`progressStages.export.${g.key}`),
  icon: EXPORT_STEP_ICONS[g.key],
  // (before the first report every stage counts, so all six show)
  members: g.members.map((m) => [m, beamNGPhase.value ? Number(beamNGPhaseWeights.value[m]) || 0 : 1]),
})));
const beamNGElapsedMs = ref(0);
const formatStepDuration = (ms) => {
  if (!Number.isFinite(ms)) return '';
  if (ms < 1000) return `${Math.round(ms)} ms`;
  const sec = Math.round(ms / 1000);
  return sec < 60 ? `${sec} s` : `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
};
const normalizeBeamNGSeaLevelOffset = (value) => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 0;
  return Math.max(-2000, Math.min(2000, numeric));
};
const resolveBeamNGBaseTexture = (terrainData, preferred = 'osm') => {
  const availableTextures = {
    painted: !!terrainData?.paintedTextureBlob,
    hybrid: !!terrainData?.hybridTextureUrl || !!terrainData?.hybridTextureCanvas,
    satellite: !!terrainData?.satelliteTextureUrl,
    osm: !!terrainData?.osmTextureUrl,
    game: !!terrainData?.gameTextureUrl || !!terrainData?.gameTextureCanvas,
    none: true,
  };

  if (availableTextures[preferred]) return preferred;
  // Closest available look, never "none" while an image exists.
  return Object.keys(availableTextures).find((key) => key !== 'painted' && availableTextures[key]) || preferred;
};

// The user's base texture choice is remembered across areas and reloads; the
// selected value falls back per terrain when that texture isn't available
// (e.g. 'painted' only exists after a touch-up).
// (shared with the 3D preview's texture buttons: composables/useBaseTexture.js)
const { baseTexture: beamNGBaseTexturePreference, setBaseTexture } = useBaseTexture();
const beamNGBaseTexture = ref(resolveBeamNGBaseTexture(props.terrainData, beamNGBaseTexturePreference.value));
const handleBeamNGBaseTextureChange = () => {
  setBaseTexture(beamNGBaseTexture.value);
};
// (a texture picked in the 3D preview becomes the export's, when this terrain has it)
watch(beamNGBaseTexturePreference, (preferred) => {
  const resolved = resolveBeamNGBaseTexture(props.terrainData, preferred);
  if (resolved === preferred) beamNGBaseTexture.value = resolved;
});
// Game texture: how much of the satellite image it takes (services/gameTextureBlend.js).
// Released, the slider repaints the texture in place: the 3D preview shows it,
// the export uses it, and the next Generate paints at the same setting.
const gameTextureBlend = ref(readGameTextureBlend());
const paintedGameTextureBlend = ref(gameTextureBlend.value);
const exportFinished = ref(false);
const isRepaintingGameTexture = ref(false);
// Live: the texture painted once at 0, 50 and 100 % (the first time the slider
// is touched), then cross-faded as it moves, so it follows the hand. Larger
// textures than the anchors may take are repainted when the slider is let go.
const blendAnchors = shallowRef(null);
const isPreparingBlend = ref(false);
let blendFrame = 0;
const drawLiveBlend = () => {
  blendFrame = 0;
  const td = toRaw(props.terrainData); const anchors = blendAnchors.value;
  if (!anchors || !td?.gameTextureCanvas || td.gameTextureCanvas.width !== anchors.size) return;
  composeBlend(anchors, gameTextureBlend.value, td.gameTextureCanvas);
  paintedGameTextureBlend.value = gameTextureBlend.value;
  store.textureRevision++;
};
const prepareLiveBlend = async () => {
  const td = props.terrainData;
  if (blendAnchors.value || isPreparingBlend.value || isRepaintingGameTexture.value || !canBlendLive(td)) return;
  isPreparingBlend.value = true;
  try {
    const anchors = await prepareBlendAnchors(td, { from: toRaw(td), paintedPct: paintedGameTextureBlend.value });
    if (props.terrainData !== td) return;   // (another terrain since)
    blendAnchors.value = anchors;
    // (moved while they were painted: show where it is now)
    if (anchors && gameTextureBlend.value !== paintedGameTextureBlend.value) drawLiveBlend();
  } catch (err) {
    console.error('[Game Texture] live blend unavailable, repainting on release:', err);
  } finally { isPreparingBlend.value = false; }
};
const onGameTextureBlendInput = () => {
  if (blendAnchors.value) { if (!blendFrame) blendFrame = requestAnimationFrame(drawLiveBlend); } else prepareLiveBlend();
};
watch(() => props.terrainData, () => { blendAnchors.value = null; paintedGameTextureBlend.value = readGameTextureBlend(); gameTextureBlend.value = paintedGameTextureBlend.value; });
const applyGameTextureBlend = async () => {
  const wanted = gameTextureBlend.value;
  writeGameTextureBlend(wanted);
  // (live: the canvas is already there; its file follows)
  if (blendAnchors.value) {
    if (blendFrame) { cancelAnimationFrame(blendFrame); drawLiveBlend(); }
    await commitGameTextureCanvas(props.terrainData);
    store.textureRevision++;
    return;
  }
  if (isPreparingBlend.value) return;   // (the anchors draw it when they are ready)
  if (isRepaintingGameTexture.value || wanted === paintedGameTextureBlend.value) return;
  isRepaintingGameTexture.value = true;
  try {
    if (await repaintGameTexture(props.terrainData, wanted, { from: toRaw(props.terrainData) })) { paintedGameTextureBlend.value = wanted; store.textureRevision++; }
  } catch (err) {
    console.error('[Game Texture] repaint failed:', err);
    gameTextureBlend.value = paintedGameTextureBlend.value;
    writeGameTextureBlend(paintedGameTextureBlend.value);
  } finally {
    isRepaintingGameTexture.value = false;
    // (moved again while it painted: paint that)
    if (gameTextureBlend.value !== paintedGameTextureBlend.value) applyGameTextureBlend();
  }
};
onUnmounted(() => { if (blendFrame) cancelAnimationFrame(blendFrame); });
const legacyIncludeBackdrop = localStorage.getItem('mapng_beamNGIncludeBackdrop');
// The backdrop starts Off with every terrain: choosing one starts its download
// at once, so it is never chosen for the user. The one exception: settings
// just applied that ask for it (a level being modified, a share code), which
// leave BACKDROP_APPLIED_KEY for the next terrain.
const takeAppliedBackdrop = () => {
  try {
    if (localStorage.getItem(BACKDROP_APPLIED_KEY) !== '1') return 'off';
    return localStorage.getItem('mapng_beamNGBackdropSource') || (legacyIncludeBackdrop === 'true' ? 'global30m' : 'off');
  } catch { return 'off'; }
};
const beamNGBackdropSource = ref(takeAppliedBackdrop());
// (the panel opens with its terrain: the applied settings were for this one)
if (props.terrainData) { try { localStorage.removeItem(BACKDROP_APPLIED_KEY); } catch { /* private mode */ } }
watch(() => props.terrainData, (td, was) => {
  if (!td || td === was) return;
  beamNGBackdropSource.value = takeAppliedBackdrop();
  try { localStorage.removeItem(BACKDROP_APPLIED_KEY); } catch { /* private mode */ }
});
// The backdrop's satellite imagery: Standard is what it has always been; finer
// costs downloads and memory. A browser tab is held to a smaller stitched
// picture than the desktop app (services/backdropImagery.js).
const beamNGBackdropImagery = ref(backdropImageryId(localStorage.getItem('mapng_beamNGBackdropImagery')));
watch(beamNGBackdropImagery, (v) => localStorage.setItem('mapng_beamNGBackdropImagery', v));
const backdropStitchLimit = desktopApp ? DESKTOP_STITCH_LIMIT_PX : WEB_STITCH_LIMIT_PX;
const BACKDROP_MANY_TILES = 600;
const backdropPlan = computed(() => backdropImageryPlan({ quality: beamNGBackdropImagery.value, bounds: props.terrainData?.bounds, stitchLimit: backdropStitchLimit, mapSize: props.terrainData?.width }));
const backdropImageryHint = computed(() => {
  const p = backdropPlan.value;
  return p.metresPerPixel ? t('exportPanel.ui.backdropImageryHint', { mpp: p.metresPerPixel.toFixed(1), n: p.tiles.toLocaleString(), px: p.textureSize }) : '';
});
watch(backdropPlan, (p) => { store.backdropImagery = p; }, { immediate: true });
// (the 2D preview draws the surrounding tiles when a backdrop is chosen)
watch(beamNGBackdropSource, (v) => { store.backdropSource = v || 'off'; }, { immediate: true });
const beamNGIncludeBuildings = legacyOn.buildings;
const beamNGIncludeWater = computed(() => ['rivers', 'lakes', 'sea'].map((id) => (built(id) ? 1 : 0)).join(''));
// Structures and the export's terrain shaping (advanced mode; basic builds
// and shapes everything). Off, the export leaves those heights as generated.
const storedOn = (key) => localStorage.getItem(key) !== 'false';
const beamNGIncludeBridges = legacyOn.bridges;
const beamNGIncludeTunnels = legacyOn.tunnels;
const beamNGLidarDecks = ref(storedOn('mapng_beamNGLidarDecks'));
const beamNGSeaLevelOffset = ref(normalizeBeamNGSeaLevelOffset(localStorage.getItem('mapng_beamNGSeaLevelOffset')));
const beamNGIncludeTrees = legacyOn.trees;
// how thick woods stand (advanced; basic: normal): exportBeamNGLevel FOREST_DENSITY
const FOREST_DENSITY_KEYS = ['light', 'normal', 'dense', 'veryDense'];
const storedForestDensity = localStorage.getItem('mapng_beamNGForestDensity');
const beamNGForestDensity = ref(FOREST_DENSITY_KEYS.includes(storedForestDensity) ? storedForestDensity : 'normal');
// (how far the game draws: services/viewDistance.js)
const beamNGViewDistance = ref(viewDistanceChoice(localStorage.getItem('mapng_beamNGViewDistance')));
// (what Auto comes to for this map: its width, 4 km at least, 16 km at most)
const autoViewDistanceKm = computed(() => autoViewDistance((Number(props.terrainData?.width) || 0) * resolveProcessingMetersPerPixel(props.terrainData)) / 1000);
const beamNGIncludeRocks = legacyOn.rocks;
// content caps (buildings, fences, lamps, trees ...): off builds everything the map has
const beamNGSafeCaps = ref(storedOn('mapng_beamNGSafeCaps'));
// (Fine-tuning: a parking lane a side on town streets with no parking tags; services/roadWidth.js)
const beamNGAssumeParking = ref(storedOn('mapng_beamNGAssumeParking'));
// (Fine-tuning: sidewalks as flat decals instead of raised meshes; exportBeamNGLevel.js sidewalkStyle)
const beamNGDecalSidewalks = ref(localStorage.getItem('mapng_beamNGDecalSidewalks') === 'true');
// (Fine-tuning: road surfaces as MapNG's decal roads, or experimental Hero Roads; exportBeamNGLevel.js roadSurface)
const beamNGRoadSurface = ref(localStorage.getItem('mapng_beamNGRoadSurface') === 'hero' ? 'hero' : 'decal');
// (Fine-tuning: the raised sidewalks' height over the road; beamngSidewalks.js CURB_HEIGHTS_M)
const beamNGCurbHeight = ref(['standard', 'low', 'flush'].includes(localStorage.getItem('mapng_beamNGCurbHeight')) ? localStorage.getItem('mapng_beamNGCurbHeight') : 'standard');
// (Fine-tuning: tree kinds left out of the area's mix; services/beamngTrees.js)
const storedList = (key) => { try { return JSON.parse(localStorage.getItem(key) || '[]'); } catch { return []; } };
const beamNGTreeKindsOff = ref(sanitizeTreeKindsOff(storedList('mapng_beamNGTreeKindsOff')));
const beamNGTreeSwaps = ref(sanitizeTreeSwaps(storedList('mapng_beamNGTreeSwaps')));
const beamNGTreeModelsOff = ref(sanitizeTreeModelsOff(storedList('mapng_beamNGTreeModelsOff')));
// Migrate legacy boolean mesh road setting if it exists
// DecalRoads are the only road system; earlier choices (Road Architect, Mesh
// Roads, the old "spline" name) all mean "roads on". Only 'none' stays off.
const exportSettingsShown = ref([]);
// (roads on/off is What to build's "Road surfaces": composables/useBuildContent.js keeps the old key)
const beamNGRoadType = computed({ get: () => (legacyOn.roadSurfaces.value ? 'decal' : 'none'), set: (v) => { legacyOn.roadSurfaces.value = v !== 'none'; } });
const built = (id) => isBuilt(advancedMode.value, id);
const osmFeaturesRaw = computed(() => { const f = props.terrainData?.osmFeatures; return Array.isArray(f) ? toRaw(f) : []; });
const beamNGLevelName = ref('');
// (a level loaded back by "Modify" in My Levels keeps its own name:
// services/exportSettings.js)
const pendingLevelName = (() => {
  try { const v = localStorage.getItem(PENDING_LEVEL_NAME_KEY); localStorage.removeItem(PENDING_LEVEL_NAME_KEY); return v; } catch { return null; }
})();
const beamNGSuggestedLevelName = ref('');
const beamNGLevelNameTouched = ref(false);
if (pendingLevelName) { beamNGLevelName.value = pendingLevelName; beamNGLevelNameTouched.value = true; }
let beamNGLevelNameRequestId = 0;
const hasOsmData = computed(() => Array.isArray(props.terrainData?.osmFeatures) && props.terrainData.osmFeatures.length > 0);
// (how heavy the level will be: shown before exporting, services/levelWeight.js)
const buildingFootprints = computed(() => {
  const features = props.terrainData?.osmFeatures;
  if (!Array.isArray(features)) return 0;
  let n = 0;
  for (const f of features) if (f?.type === 'building') n++;
  return n;
});
const levelWeight = computed(() => estimateLevelWeight({
  terrainPx: Number(props.terrainData?.width) || 0,
  metersPerPixel: resolveProcessingMetersPerPixel(props.terrainData),
  buildings: buildingFootprints.value,
  safeCaps: !advancedMode.value || beamNGSafeCaps.value,
  includeBuildings: hasOsmData.value && built('buildings'),
}));
const squareCrop = computed(() => squareCropNotice(props.terrainData?.width, props.terrainData?.height, resolveProcessingMetersPerPixel(props.terrainData)));
const isCustomUploadTerrain = computed(() => !!props.terrainData?.elevationUnitApplied);
const canUseGpxzBackdrop = computed(() => props.elevationSource === 'gpxz' && !!props.gpxzApiKey);

// The export's data step (services/exportData.js): the backdrop's tiles and
// the bridges' lidar survey downloaded ahead, in the background, as soon as
// these options ask for them; the export waits for it, then only processes.
const exportDataOptions = computed(() => {
  const source = beamNGBackdropSource.value === 'gpxz' && !canUseGpxzBackdrop.value ? 'global30m' : beamNGBackdropSource.value;
  return {
    includeBackdrop: source !== 'off',
    backdropElevationSource: source,
    backdropGpxzApiKey: source === 'gpxz' ? String(props.gpxzApiKey || '') : '',
    backdropImagery: source === 'global30m' ? beamNGBackdropImagery.value : 'standard',
    backdropStitchLimit,
    roadType: hasOsmData.value && built('roadSurfaces') ? 'decal' : 'none',
    includeBridges: built('bridges'),
    lidarDecks: !advancedMode.value || beamNGLidarDecks.value,
    includeWater: hasOsmData.value && (built('rivers') || built('lakes')),
    backgroundMask: props.terrainData?.backgroundMask || null,
  };
});
const runExportData = (terrainData, options, onProgress) => (desktopApp
  ? prefetchExportDataOnDesktop(terrainData, options, onProgress)
  : downloadExportData(terrainData, options, { onProgress }));
const exportDataStatus = ref(null);
const refreshExportDataStatus = () => {
  const td = props.terrainData ? toRaw(props.terrainData) : null;
  const st = td ? exportDataState(td, exportDataOptions.value) : null;
  exportDataStatus.value = st ? { ...st } : null;
};
const offExportData = onExportDataChange(refreshExportDataStatus);
onUnmounted(offExportData);
onUnmounted(() => { clearTimeout(beamNGLevelNameTimer); beamNGLevelNameAbort?.abort(); });
let exportDataTimer = null;
watch(exportDataOptions, (o) => { store.exportDataOptions = o; }, { immediate: true });
watch([() => props.terrainData, exportDataOptions], () => {
  clearTimeout(exportDataTimer);
  refreshExportDataStatus();
  // (a moment after the last change: a source picked in passing isn't downloaded)
  exportDataTimer = setTimeout(() => {
    const td = props.terrainData ? toRaw(props.terrainData) : null;
    if (!td || !exportDataNeeds(td, exportDataOptions.value)) return;
    ensureExportData(td, exportDataOptions.value, { run: runExportData }).catch((err) => console.warn('[Export data] downloading ahead failed; the export will try again:', err?.message || err));
  }, 1500);
}, { immediate: true });
onUnmounted(() => clearTimeout(exportDataTimer));
const beamNGPendingDownloadUrl = ref('');
const beamNGPendingDownloadName = ref('');
// (desktop app: the level written into the mods folder, { path, filename })
const beamNGDesktopSaved = ref(null);
const beamNGDesktopFailed = ref(null);   // { message, logPath }
let desktopExportAbort = null;
const cancelDesktopExport = () => desktopExportAbort?.abort();
const showDesktopExportLog = () => desktopApp?.showItem(beamNGDesktopFailed.value?.logPath);
// (the last export's options, for a report about it)
// the Terrain choice's generation passes no longer match the generated terrain's
const terrainChoiceChangedSinceGenerate = computed(() => {
  const made = props.terrainData?.generationEdits;
  if (!made) return !!props.terrainData && !!props.terrainData.raw !== (advancedMode.value && terrainMode.value === 'untouched');
  const now = terrainGenerationOptions(advancedMode.value);
  return Object.keys(now).some((k) => !!now[k] !== !!made[k]);
});
let lastExportOptions = null;
const reportDesktopExportFailure = () => openReportDialog('export', {
  error: beamNGDesktopFailed.value?.message || '',
  logPath: beamNGDesktopFailed.value?.logPath || null,
  options: lastExportOptions,
  area: { lat: props.center?.lat, lng: props.center?.lng, resolution: props.terrainData?.width, metersPerPixel: resolveProcessingMetersPerPixel(props.terrainData) },
});
const showDesktopSavedLevel = () => desktopApp?.showItem(beamNGDesktopSaved.value?.path);
const changeDesktopModsFolder = () => desktopApp?.chooseModsFolder();

// ─── Base texture touch-up painting ─────────────────────────────────
const showTexturePaintModal = ref(false);
const isPreparingTexturePaint = ref(false);
const texturePaintSourceUrl = ref('');
const texturePaintResumeUrl = ref('');
const texturePaintSourceKind = ref('hybrid');
let texturePaintObjectUrls = [];

// (the terrain isn't deeply reactive: a save bumps paintedTick)
const paintedTick = ref(0);
const hasPaintedTexture = computed(() => paintedTick.value >= 0 && !!props.terrainData?.paintedTextureBlob);

const TEXTURE_SOURCE_LABEL_KEYS = {
  hybrid: 'exportPanel.satelliteHybrid',
  satellite: 'exportPanel.satellite',
  osm: 'exportPanel.osm',
};

const texturePaintSourceLabel = computed(() => {
  const key = TEXTURE_SOURCE_LABEL_KEYS[texturePaintSourceKind.value];
  return key ? t(key) : texturePaintSourceKind.value;
});

// The texture the paint session edits: the selected base texture, or the
// painted texture's original source when "Touched up" is selected.
const resolveTexturePaintKind = () => {
  const selected = beamNGBaseTexture.value;
  if (selected === 'painted') return props.terrainData?.paintedTextureSource || 'hybrid';
  if (selected === 'none') return null;
  return selected;
};

const texturePaintKindAvailable = (kind) => {
  const td = props.terrainData;
  if (!td || !kind) return false;
  if (kind === 'hybrid') return !!(td.hybridTextureCanvas || td.hybridTextureBlob || td.hybridTextureUrl);
  if (kind === 'satellite') return !!td.satelliteTextureUrl;
  if (kind === 'osm') return !!(td.osmTextureCanvas || td.osmTextureBlob || td.osmTextureUrl);
  if (kind === 'game') return !!(td.gameTextureCanvas || td.gameTextureBlob || td.gameTextureUrl);
  return false;
};

const canPaintTexture = computed(() => texturePaintKindAvailable(resolveTexturePaintKind()));

const trackTexturePaintUrl = (url) => {
  texturePaintObjectUrls.push(url);
  return url;
};

const releaseTexturePaintUrls = () => {
  for (const url of texturePaintObjectUrls) URL.revokeObjectURL(url);
  texturePaintObjectUrls = [];
};

const resolveTexturePaintSourceUrl = async (kind) => {
  const td = props.terrainData;
  if (kind === 'hybrid') {
    if (td.hybridTextureCanvas) {
      const blob = await new Promise((r) => td.hybridTextureCanvas.toBlob(r, 'image/png'));
      if (blob) return trackTexturePaintUrl(URL.createObjectURL(blob));
    }
    if (td.hybridTextureBlob) return trackTexturePaintUrl(URL.createObjectURL(td.hybridTextureBlob));
    return td.hybridTextureUrl;
  }
  if (kind === 'satellite') return td.satelliteTextureUrl;
  if (td.osmTextureCanvas) {
    const blob = await new Promise((r) => td.osmTextureCanvas.toBlob(r, 'image/png'));
    if (blob) return trackTexturePaintUrl(URL.createObjectURL(blob));
  }
  if (td.osmTextureBlob) return trackTexturePaintUrl(URL.createObjectURL(td.osmTextureBlob));
  return td.osmTextureUrl;
};

const openTexturePaint = async () => {
  if (isPreparingTexturePaint.value) return;
  const kind = resolveTexturePaintKind();
  if (!texturePaintKindAvailable(kind)) return;
  isPreparingTexturePaint.value = true;
  try {
    const td = props.terrainData;
    texturePaintSourceKind.value = kind;
    texturePaintSourceUrl.value = await resolveTexturePaintSourceUrl(kind);
    // Resume the saved paint layer only when it was painted over this source.
    texturePaintResumeUrl.value = (td.paintedPaintLayerBlob && td.paintedTextureSource === kind)
      ? trackTexturePaintUrl(URL.createObjectURL(td.paintedPaintLayerBlob))
      : '';
    showTexturePaintModal.value = true;
  } catch (error) {
    console.error(`${BEAMNG_EXPORT_UI_LOG} Failed to open texture painter:`, error);
    releaseTexturePaintUrls();
  } finally {
    isPreparingTexturePaint.value = false;
  }
};

const closeTexturePaint = () => {
  showTexturePaintModal.value = false;
  releaseTexturePaintUrls();
};

const handleTexturePaintSave = ({ compositeBlob, paintLayerBlob }) => {
  const td = props.terrainData;
  if (td) {
    td.paintedTextureBlob = compositeBlob;
    td.paintedPaintLayerBlob = paintLayerBlob;
    td.paintedTextureSource = texturePaintSourceKind.value;
    paintedTick.value++;
    beamNGBaseTexture.value = 'painted';
  }
  closeTexturePaint();
};

const clearPendingBeamNGDownload = () => {
  if (beamNGPendingDownloadUrl.value) {
    const urlToRevoke = beamNGPendingDownloadUrl.value;
    setTimeout(() => URL.revokeObjectURL(urlToRevoke), 120_000);
  }
  beamNGPendingDownloadUrl.value = '';
  beamNGPendingDownloadName.value = '';
  beamNGDesktopSaved.value = null;
  beamNGDesktopFailed.value = null;
};

const isAnyExporting = computed(() => (
  isExportingHeightmap.value ||
  isExportingTexture.value ||
  isExportingOSMTexture.value ||
  isExportingHybridTexture.value ||
  isExportingGameTexture.value ||
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
// Default GLB/DAE exports to real-world metres (1 unit = 1 m) so models drop
// into Blender at the correct scale for modelling guard rails etc.
const modelRealWorldScale = ref(localStorage.getItem('mapng_modelRealWorldScale') !== 'false');
// (the 3D model's point spacing: 'auto' or every nth height; services/modelMesh.js)
const modelMeshStride = ref((() => { const v = localStorage.getItem('mapng_modelMeshStride'); return MESH_STRIDES.includes(Number(v)) ? v : 'auto'; })());
watch(modelMeshStride, (v) => localStorage.setItem('mapng_modelMeshStride', String(v)));
const meshMpp = computed(() => { const m = Number(props.terrainData?.processingMetersPerPixel); return m > 0 ? m : 1; });
// (the area modelled, the tiles it is cut into, and one tile's mesh: services/modelArea.js)
const modelAreaRect = computed(() => { const w = props.terrainData?.width || 2; const h = props.terrainData?.height || w; return clampArea(store.modelArea, w, h) || { c0: 0, r0: 0, size: Math.min(w, h) }; });
const modelTiles = ref((() => { const v = localStorage.getItem('mapng_modelTiles'); return TILE_COUNTS.includes(Number(v)) ? v : 'auto'; })());
watch(modelTiles, (v) => localStorage.setItem('mapng_modelTiles', String(v)));
const modelStride = computed(() => strideOf(modelMeshStride.value, modelAreaRect.value.size));
const modelTilesAuto = computed(() => tilesNeeded(modelAreaRect.value.size, meshMpp.value, modelStride.value));
const modelTileCount = computed(() => (modelTiles.value === 'auto' ? (modelTilesAuto.value || 16) : Number(modelTiles.value)));
const modelTileSize = computed(() => (modelTileCount.value > 1 ? Math.ceil((modelAreaRect.value.size - 1) / modelTileCount.value) + 1 : modelAreaRect.value.size));
const modelMesh = computed(() => meshPlan(modelTileSize.value, meshMpp.value, modelStride.value));
watch(() => props.terrainData, () => { store.modelArea = null; store.modelAreaPicking = false; });
const pickModelArea = () => { store.modelAreaPicking = true; if (store.viewMode !== 'preview2d') store.viewMode = 'preview2d'; };
// One piece of the model (the whole map, the picked area, or one tile of either): its terrain and where it goes.
const modelPieces = () => (modelTileCount.value > 1 ? tileRects(modelAreaRect.value, modelTileCount.value) : [{ i: 0, j: 0, ...modelAreaRect.value }]);
const modelPieceData = async (rect) => {
  const full = toRaw(props.terrainData);
  const whole = rect.c0 === 0 && rect.r0 === 0 && rect.size === full.width && rect.size === full.height;
  const td = whole ? await getExportTerrainData() : await prepareCroppedTerrainData({ ...full, exportCropSize: rect.size, exportCropStart: { x: rect.c0, y: rect.r0 } });
  // (a part's game texture is its cropped file, not the whole map's canvas)
  if (!whole) { td.gameTextureCanvas = null; td.gameTextureBlob = null; }
  const place = partOffset({ width: full.width, height: full.height, metersPerPixel: meshMpp.value, minHeight: full.minHeight }, rect, td.minHeight);
  return { td, whole, place };
};
const meshSpacingText = (m) => (Number.isInteger(m) ? String(m) : m.toFixed(1));
const formatBytes = (b) => (b >= 2 ** 30 ? `${(b / 2 ** 30).toFixed(1)} GB` : `${Math.max(1, Math.round(b / 2 ** 20))} MB`);
watch(modelRealWorldScale, (v) => localStorage.setItem('mapng_modelRealWorldScale', String(v)));

// Collapsible section states
const showExport2D = ref(localStorage.getItem('mapng_showExport2D') !== 'false');
const showExport3D = ref(localStorage.getItem('mapng_showExport3D') !== 'false');
const showExportBeamNG = ref(localStorage.getItem('mapng_showExportBeamNG') !== 'false');
// Migrate legacy boolean value from old 'mapng_beamNGGeneratePbr' key.
const _legacyPbr = localStorage.getItem('mapng_beamNGGeneratePbr');
const _defaultPbrSource = localStorage.getItem('mapng_beamNGPbrSource')
  ?? (_legacyPbr === 'false' ? 'none' : 'osm');
const beamNGPbrSource = ref(_defaultPbrSource);
const showExportGeo = ref(localStorage.getItem('mapng_showExportGeo') !== 'false');

// ---- "Level up to date": nothing changed since the last export --------------
// Everything the level is made from, as one string: the terrain (by identity:
// a new Generate is a new terrain), its touched-up texture, and every export
// setting. While it matches the last export's, the button checks the level
// instead of building it again ("Rebuild anyway" still builds).
const terrainTokens = new WeakMap();
let terrainTokenSeq = 0;
const terrainToken = (td) => {
  const raw = td ? toRaw(td) : null;
  if (!raw) return null;
  if (!terrainTokens.has(raw)) terrainTokens.set(raw, ++terrainTokenSeq);
  return terrainTokens.get(raw);
};
const exportInputs = computed(() => JSON.stringify({
  terrain: terrainToken(props.terrainData),
  painted: paintedTick.value,
  advanced: advancedMode.value,
  terrainMode: terrainMode.value,
  shaping: terrainShapingOptions(advancedMode.value),
  name: beamNGLevelName.value.trim(),
  baseTexture: beamNGBaseTexture.value, pbr: beamNGPbrSource.value, roads: beamNGRoadType.value,
  backdrop: beamNGBackdropSource.value, gpxz: beamNGBackdropSource.value === 'gpxz' ? String(props.gpxzApiKey || '').length : 0,
  buildings: beamNGIncludeBuildings.value, water: beamNGIncludeWater.value, trees: beamNGIncludeTrees.value,
  forest: beamNGForestDensity.value, rocks: beamNGIncludeRocks.value, caps: beamNGSafeCaps.value, parking: beamNGAssumeParking.value, decalWalks: beamNGDecalSidewalks.value, roadSurface: beamNGRoadSurface.value, curb: beamNGCurbHeight.value, treeKinds: beamNGTreeKindsOff.value.join(','), treeSwaps: beamNGTreeSwaps.value.join(','), treeModels: beamNGTreeModelsOff.value.join(','),
  view: beamNGViewDistance.value,
  bridges: beamNGIncludeBridges.value, tunnels: beamNGIncludeTunnels.value, lidar: beamNGLidarDecks.value,
  sea: beamNGSeaLevelOffset.value,
  content: contentOptions(advancedMode.value),
  // (points change only the spawns and their photos, but the level made is another)
  points: store.points,
}));
// { inputs, at, filename, desktop: { path, size } | null, blob: Blob | null }
const lastExport = ref(null);
const exportUpToDate = computed(() => !!lastExport.value && lastExport.value.inputs === exportInputs.value);
const levelCheck = ref(null);   // null | { state: 'checking' | 'ok' | 'rebuilding', problems }
// (anything changed: the old level no longer matches; its zip let go)
watch(exportInputs, () => { levelCheck.value = null; if (lastExport.value && !exportUpToDate.value) lastExport.value = null; });
const agoTick = ref(Date.now());
const agoTimer = setInterval(() => { agoTick.value = Date.now(); }, 30000);
onUnmounted(() => clearInterval(agoTimer));
const exportedAgo = computed(() => {
  if (!lastExport.value) return '';
  const min = Math.max(0, Math.round((agoTick.value - lastExport.value.at) / 60000));
  return min < 1 ? t('exportPanel.ui.justNow') : t('exportPanel.ui.minutesAgo', { n: min });
});

/** "Check level": the last export looked over (its zip in the mods folder, or the one made in the page); rebuilt if anything is wrong. */
async function checkLevel() {
  const last = lastExport.value;
  if (!last) return handleBeamNGLevelExport();
  levelCheck.value = { state: 'checking', problems: [] };
  let problems = [];
  try {
    if (desktopApp && last.desktop?.path && desktopApp.verifyLevel) {
      const r = await desktopApp.verifyLevel(last.desktop.path, last.desktop.size);
      problems = r?.ok ? [] : (r?.problems || ['the level could not be checked']);
    } else if (last.blob) {
      problems = levelZipProblems(await zipIndexOfBlob(last.blob));
    } else {
      problems = ['the exported level is no longer at hand'];
    }
  } catch (err) {
    problems = [String(err?.message || err)];
  }
  if (!problems.length) {
    levelCheck.value = { state: 'ok', problems: [] };
    // (the same level offered again: in the page, its download; on the desktop, where it is)
    if (last.desktop) beamNGDesktopSaved.value = { path: last.desktop.path, filename: last.filename };
    else if (last.blob && !beamNGPendingDownloadUrl.value) {
      beamNGPendingDownloadUrl.value = URL.createObjectURL(last.blob);
      beamNGPendingDownloadName.value = last.filename;
    }
    return;
  }
  levelCheck.value = { state: 'rebuilding', problems };
  console.warn(`${BEAMNG_EXPORT_UI_LOG} Check level found: ${problems.join('; ')}; building it again.`);
  await handleBeamNGLevelExport({ keepCheck: true });
}
const onBeamNGExportClick = () => (exportUpToDate.value ? checkLevel() : handleBeamNGLevelExport());

const THUMB_SIZE = 256;
const satellitePreviewUrl = ref('');
const osmPreviewUrl = ref('');
const hybridPreviewUrl = ref('');
const gamePreviewUrl = ref('');
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

watch(showExport2D, (v) => localStorage.setItem('mapng_showExport2D', String(v)));
watch(showExport3D, (v) => localStorage.setItem('mapng_showExport3D', String(v)));
watch(showExportBeamNG, (v) => localStorage.setItem('mapng_showExportBeamNG', String(v)));
watch(beamNGPbrSource, (v) => localStorage.setItem('mapng_beamNGPbrSource', v));
watch(beamNGBackdropSource, (v) => localStorage.setItem('mapng_beamNGBackdropSource', v));
watch(beamNGLidarDecks, (v) => localStorage.setItem('mapng_beamNGLidarDecks', String(v)));
watch(beamNGSeaLevelOffset, (v) => {
  const normalized = normalizeBeamNGSeaLevelOffset(v);
  if (normalized !== v) {
    beamNGSeaLevelOffset.value = normalized;
    return;
  }
  localStorage.setItem('mapng_beamNGSeaLevelOffset', String(normalized));
});
watch(beamNGForestDensity, (v) => localStorage.setItem('mapng_beamNGForestDensity', v));
watch(beamNGViewDistance, (v) => localStorage.setItem('mapng_beamNGViewDistance', String(viewDistanceChoice(v))));
watch(beamNGSafeCaps, (v) => localStorage.setItem('mapng_beamNGSafeCaps', String(v)));
watch(beamNGAssumeParking, (v) => localStorage.setItem('mapng_beamNGAssumeParking', String(v)));
watch(beamNGDecalSidewalks, (v) => localStorage.setItem('mapng_beamNGDecalSidewalks', String(v)));
watch(beamNGRoadSurface, (v) => localStorage.setItem('mapng_beamNGRoadSurface', v === 'hero' ? 'hero' : 'decal'));
watch(beamNGCurbHeight, (v) => localStorage.setItem('mapng_beamNGCurbHeight', v));
watch(beamNGTreeKindsOff, (v) => localStorage.setItem('mapng_beamNGTreeKindsOff', JSON.stringify(sanitizeTreeKindsOff(v))));
watch(beamNGTreeSwaps, (v) => localStorage.setItem('mapng_beamNGTreeSwaps', JSON.stringify(sanitizeTreeSwaps(v))));
watch(beamNGTreeModelsOff, (v) => localStorage.setItem('mapng_beamNGTreeModelsOff', JSON.stringify(sanitizeTreeModelsOff(v))));
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
  () => [props.terrainData?.osmTextureUrl, store.texturesMade],
  ([url]) => {
    const token = ++osmPreviewToken;
    updatePreviewUrl(url, osmPreviewUrl, () => token === osmPreviewToken);
  },
  { immediate: true },
);

watch(
  () => [props.terrainData?.hybridTextureUrl, store.texturesMade],
  ([url]) => {
    const token = ++hybridPreviewToken;
    updatePreviewUrl(url, hybridPreviewUrl, () => token === hybridPreviewToken);
  },
  { immediate: true },
);

let gamePreviewToken = 0;
watch(
  () => [props.terrainData?.gameTextureUrl, store.texturesMade],
  ([url]) => {
    const token = ++gamePreviewToken;
    updatePreviewUrl(url, gamePreviewUrl, () => token === gamePreviewToken);
  },
  { immediate: true },
);

onUnmounted(() => {
  clearPreviewUrl(satellitePreviewUrl);
  clearPreviewUrl(osmPreviewUrl);
  clearPreviewUrl(hybridPreviewUrl);
  clearPreviewUrl(gamePreviewUrl);
  releaseTexturePaintUrls();
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

// The suggested name comes from OpenStreetMap's public address server, which
// asks to be used gently. It was asked at every move of the map, from the
// moment the page opened: about 20,000 times a day, and refused hundreds of
// times. Now: only once there is a terrain to export (the name is for the
// level), only while the name is still the suggestion (a name typed in is
// kept), and only when the map has stood still for a moment.
const LEVEL_NAME_SETTLE_MS = 1500;
let beamNGLevelNameTimer = 0;
let beamNGLevelNameAbort = null;
const levelNameWanted = () => showExportBeamNG.value && !!props.terrainData
  && !(beamNGLevelNameTouched.value && beamNGLevelName.value.trim());
const scheduleSuggestedBeamNGLevelName = () => {
  clearTimeout(beamNGLevelNameTimer);
  beamNGLevelNameAbort?.abort();
  beamNGLevelNameAbort = null;
  if (!levelNameWanted()) return;
  beamNGLevelNameTimer = setTimeout(updateSuggestedBeamNGLevelName, LEVEL_NAME_SETTLE_MS);
};

const updateSuggestedBeamNGLevelName = async () => {
  if (!levelNameWanted()) return;
  const requestId = ++beamNGLevelNameRequestId;
  beamNGLevelNameAbort = typeof AbortController === 'function' ? new AbortController() : null;
  const fallbackName = buildBeamNGFallbackLevelName();
  if (!Number.isFinite(props.center?.lat) || !Number.isFinite(props.center?.lng)) {
    applySuggestedBeamNGLevelName(fallbackName);
    return;
  }
  try {
    const suggested = await reverseLocationName(props.center.lat, props.center.lng, { signal: beamNGLevelNameAbort?.signal || null });
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
  () => [props.center.lat, props.center.lng, showExportBeamNG.value, !!props.terrainData],
  () => {
    // (with no terrain yet the field shows the coordinate name: no lookup)
    if (!props.terrainData && !beamNGLevelNameTouched.value) applySuggestedBeamNGLevelName(buildBeamNGFallbackLevelName());
    scheduleSuggestedBeamNGLevelName();
  },
  { immediate: true }
);

watch(
  () => props.terrainData,
  (terrainData) => {
    beamNGBaseTexture.value = resolveBeamNGBaseTexture(terrainData, beamNGBaseTexturePreference.value);
  },
  { immediate: true }
);

watch(
  [hasOsmData, isCustomUploadTerrain, canUseGpxzBackdrop],
  ([hasOsm, isCustom, gpxzAllowed]) => {
    // Without OSM data the OSM-driven controls are disabled and the export
    // uses "off" for them (effective* in handleBeamNGLevelExport). Don't write
    // "off" into the settings themselves: that ran on every page load (no
    // terrain yet) and saved over the user's choices.
    if (!hasOsm && beamNGBaseTexture.value === 'osm') {
      beamNGBaseTexture.value = resolveBeamNGBaseTexture(props.terrainData, 'hybrid');
    }
    // (an uploaded map used to get the 30 m backdrop by itself; choosing a
    // backdrop starts its download now, so it starts Off like any other)
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
    extra: {
      processingMetersPerPixel: resolveProcessingMetersPerPixel(props.terrainData),
    },
  }),
  modelOptions: {
    centerTextureType: modelCenterTextureType.value,
    tileSelection: modelTileSelection.value,
    includeSurroundings: modelTileSelection.value !== 'center-only',
    realWorldScale: modelRealWorldScale.value,
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

// Export hotspots (composables/useExportHotspots.js): count a finished level
// export when this user shares; ask once, after the first one.
const { share: shareExports, setShareExports } = useExportHotspots();
const askShareExports = ref(false);
let unreportedExport = null;
// Settings stats (composables/useUsageStats.js): asked once too, after the
// hotspot question is answered, so there's only ever one question showing
const { share: shareSettings, setShareSettings } = useUsageStats();
const askShareSettings = ref(false);
let unreportedSettings = null;
const onLevelExported = (center) => {
  const platform = desktopApp ? 'desktop' : 'web';
  if (shareExports.value === 'on') reportExport(center, platform);
  else if (shareExports.value == null) { unreportedExport = { center: { ...center }, platform }; askShareExports.value = true; }
  const config = currentSessionConfigValue();
  if (shareSettings.value === 'on') reportUsage(config, platform);
  else if (shareSettings.value == null) { unreportedSettings = { config, platform }; if (!askShareExports.value) askShareSettings.value = true; }
};
const answerShareExports = (on) => {
  setShareExports(on);
  askShareExports.value = false;
  if (on && unreportedExport) reportExport(unreportedExport.center, unreportedExport.platform);
  unreportedExport = null;
  if (shareSettings.value == null && unreportedSettings) askShareSettings.value = true;
};
const openUsagePrivacy = () => window.open('https://mapng.com/data.html#usage', '_blank', 'noopener');
const answerShareSettings = (on) => {
  setShareSettings(on);
  askShareSettings.value = false;
  if (on && unreportedSettings) reportUsage(unreportedSettings.config, unreportedSettings.platform);
  unreportedSettings = null;
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
// The store's terrain data is deeply reactive: every OSM point read through
// Vue's proxy made a wooded 8 km BeamNG export plant trees for 9 minutes
// (~150x slower than the raw object). Exports only read it, so hand them
// the raw object.
// A texture Generate left out, painted before it is downloaded or put on a model (services/textureOnDemand.js).
const prepareTexture = async (kind) => {
  const td = toRaw(props.terrainData);
  if (!td || hasTexture(td, kind) || !['osm', 'hybrid', 'game'].includes(kind)) return;
  store.texturePreparing = kind;
  try { if (await ensureTexture(td, kind)) store.texturesMade++; } finally { if (store.texturePreparing === kind) store.texturePreparing = ''; }
};
const getExportTerrainData = () => prepareCroppedTerrainData(toRaw(props.terrainData));

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
  if (!hasOsmData.value) return;
  isExportingOSMTexture.value = true;
  try {
    await yieldToUi();
    await prepareTexture('osm');
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

const downloadGameTexture = async () => {
  const td0 = props.terrainData;
  if (!hasOsmData.value) return;
  isExportingGameTexture.value = true;
  try {
    await yieldToUi();
    await prepareTexture('game');
    const td = await getExportTerrainData();
    const filename = `game_texture_${props.center.lat.toFixed(4)}_${props.center.lng.toFixed(4)}.png`;
    let url = td.gameTextureUrl ?? td0.gameTextureUrl;
    if (!url && (td.gameTextureCanvas || td0.gameTextureCanvas)) {
      const blob = await new Promise((r) => (td.gameTextureCanvas || td0.gameTextureCanvas).toBlob(r, 'image/png'));
      url = URL.createObjectURL(blob);
    }
    await downloadBlobUrlAsFile(url, filename, 'image/', 'image/png');
    notifyExportSuccess('texture_game', filename);
    downloadMetadataSidecar(filename, buildExportMetadata('texture_game', filename));
  } catch (error) {
    console.error('Failed to export game texture:', error);
    alert(t('export.errorGameTexture'));
  } finally {
    isExportingGameTexture.value = false;
  }
};

const downloadHybridTexture = async () => {
  if (!hasOsmData.value) return;
  isExportingHybridTexture.value = true;
  try {
    await yieldToUi();
    await prepareTexture('hybrid');
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
    await prepareTexture(modelCenterTextureType.value);
    const pieces = modelPieces(); const made = [];
    for (const rect of pieces) {
      const { td, whole, place } = await modelPieceData(rect);
      made.push({ rect, blob: await exportToGLB(td, {
        centerTextureType: modelCenterTextureType.value,
        // (surrounding tiles belong to the whole map: a part or a tile is the terrain itself)
        tileSelection: whole ? modelTileSelection.value : 'center-only',
        realWorldScale: modelRealWorldScale.value,
        placeMeters: place,
        maxMeshResolution: maxMeshResolutionFor(rect.size, modelStride.value),
        surroundingTilePositions: props.surroundingTilePositions,
        center: props.center,
        resolution: props.resolution,
        returnBlob: true
      }) });
      await yieldToUi();
    }
    if (made.length > 1) {
      // (tiles: one zip of GLBs, each in its place: import them all and they lie edge to edge)
      const { default: JSZip } = await import('jszip');
      const zip = new JSZip();
      for (const m of made) zip.file(`terrain_tile_r${m.rect.j + 1}_c${m.rect.i + 1}.glb`, m.blob);
      const zipName = `terrain_${props.center.lat.toFixed(4)}_${props.center.lng.toFixed(4)}_${modelTileCount.value}x${modelTileCount.value}_tiles.zip`;
      triggerDownload(await zip.generateAsync({ type: 'blob', compression: 'STORE' }), zipName);
      notifyExportSuccess('glb', zipName);
      return;
    }
    const blob = made[0].blob;
    const typedBlob = await ensureDownloadBlobType(blob, 'model/gltf-binary', 'application/octet-stream');
    const filename = `terrain_${props.center.lat.toFixed(4)}_${props.center.lng.toFixed(4)}.glb`;
    triggerDownload(typedBlob, filename);
    notifyExportSuccess('glb', filename);
    const metadata = buildExportMetadata('glb', filename, {
      modelOptions: {
        centerTextureType: modelCenterTextureType.value,
        tileSelection: modelTileSelection.value,
        realWorldScale: modelRealWorldScale.value,
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
    await prepareTexture(modelCenterTextureType.value);
    const { td, whole, place } = await modelPieceData(modelAreaRect.value);
    const zipBlob = await exportToDAE(td, {
      centerTextureType: modelCenterTextureType.value,
      tileSelection: whole ? modelTileSelection.value : 'center-only',
      realWorldScale: modelRealWorldScale.value,
      placeMeters: place,
      maxMeshResolution: maxMeshResolutionFor(modelAreaRect.value.size, modelStride.value),
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
        realWorldScale: modelRealWorldScale.value,
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

const handleBeamNGLevelExport = async ({ keepCheck = false } = {}) => {
  const startedAt = performance.now();
  // (what this level is made from, as the export starts: "Level up to date" after it)
  const inputsAtStart = exportInputs.value;
  if (!keepCheck) levelCheck.value = null;
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

  // Clear any stale pending bundle from a previous run.
  clearPendingBeamNGDownload();

  // Keep users in-app: pre-acquire a save handle while click activation is
  // still present, then write the generated ZIP after export completes.
  // (the desktop app writes into the mods folder instead)
  let beamNGSaveHandle = null;
  const supportsSavePicker = !desktopApp && typeof window !== 'undefined' && typeof window.showSaveFilePicker === 'function';
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
  // (the 3D preview stops drawing while the export runs in this page; the desktop app exports in its own process)
  heavyJobRunning.value = !desktopApp;
  // (a note that an export is running, with the settings as they are: services/sessionGuard.js)
  currentSessionCode().then((code) => { if (isExportingBeamNGLevel.value) markJobStart('export', { code, build: typeof __BUILD_HASH__ !== 'undefined' ? __BUILD_HASH__ : '' }); }).catch(() => {});
  let exportSucceeded = false;
  beamNGProgressStep.value = 'Preparing…';
  beamNGProgressPct.value  = 0;
  beamNGProgressDone.value = [];
  beamNGElapsedMs.value = 0;
  beamNGPhase.value = null;
  beamNGPhaseFraction.value = 0;
  beamNGPhaseWeights.value = {};
  // ticks between progress events (a long step reports only when it ends)
  const elapsedTimer = setInterval(() => { beamNGElapsedMs.value = performance.now() - startedAt; }, 1000);
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

    let effectiveBaseTexture = beamNGBaseTexture.value;
    if (effectiveBaseTexture === 'painted' && !td?.paintedTextureBlob) {
      // Painted data didn't survive terrain preparation; fall back to its source.
      effectiveBaseTexture = resolveBeamNGBaseTexture(td, td?.paintedTextureSource || 'hybrid');
    }
    if (effectiveBaseTexture !== 'none' && effectiveBaseTexture !== 'painted' && !hasOsmData.value) {
      effectiveBaseTexture = resolveBeamNGBaseTexture(td, 'hybrid');
    }
    const effectivePbrSource = hasOsmData.value ? beamNGPbrSource.value : 'none';
    const effectiveRoadType = hasOsmData.value && built('roadSurfaces') ? 'decal' : 'none';
    // Custom elevation uploads can now include the surrounding backdrop too: it
    // is fetched from the chosen external source (global 30 m / USGS 1 m / GPXZ)
    // around the upload's geographic bounds and scaled by the processing
    // resolution, exactly like a standard export.
    const effectiveBackdropSource = beamNGBackdropSource.value === 'gpxz' && !canUseGpxzBackdrop.value
      ? 'global30m'
      : beamNGBackdropSource.value;
    const effectiveIncludeBackdrop = effectiveBackdropSource !== 'off';
    // Basic mode ignores the (hidden) per-category boxes: buildings, trees,
    // rocks and water whenever OSM data exists.
    const advanced = advancedMode.value;
    // (What to build: composables/useBuildContent.js; basic builds its preset)
    const effectiveIncludeBuildings = hasOsmData.value && built('buildings');
    const effectiveIncludeWater = hasOsmData.value && (built('rivers') || built('lakes'));
    // Flat terrain sits at height 0; place the water plane just below ground
    // (−1 m) so it doesn't flood the whole level. Matches the 3D preview default.
    const effectiveSeaLevelOffset = props.terrainData?.flat
      ? -1
      : normalizeBeamNGSeaLevelOffset(beamNGSeaLevelOffset.value);
    const effectiveIncludeTrees = hasOsmData.value && built('trees');
    const effectiveIncludeRocks = hasOsmData.value && built('rocks');
    // structures and terrain shaping: all on in basic mode
    const structureOptions = {
      includeBridges: built('bridges'),
      includeTunnels: built('tunnels'),
      // ('all': every edit; 'custom': the chosen ones; 'none': the master is off)
      // (the Terrain choice: composables/useTerrainMode.js; basic always shapes everything)
      ...terrainShapingOptions(advanced),
      // measured bridge heights from the US lidar survey where it covers the map
      lidarDecks: !advanced || beamNGLidarDecks.value,
    };
    // the rest of What to build: features switched off, OSM tags left out (services/buildContent.js)
    const content = contentOptions(advanced);
    const effectiveBackdropGpxzApiKey = effectiveBackdropSource === 'gpxz' ? String(props.gpxzApiKey || '') : '';

    console.log(`${BEAMNG_EXPORT_UI_LOG} Effective export options:`, {
      baseTexture: effectiveBaseTexture,
      pbrSource: effectivePbrSource,
      roadType: effectiveRoadType,
      includeBackdrop: effectiveIncludeBackdrop,
      backdropElevationSource: effectiveBackdropSource,
      backdropGpxzApiKey: effectiveBackdropGpxzApiKey,
      backdropImagery: effectiveBackdropSource === 'global30m' ? beamNGBackdropImagery.value : 'standard',
      backdropStitchLimit,
      includeBuildings: effectiveIncludeBuildings,
      includeWater: effectiveIncludeWater,
      seaLevelOffset: effectiveSeaLevelOffset,
      includeTrees: effectiveIncludeTrees,
      forestDensity: advanced ? beamNGForestDensity.value : 'normal',
      viewDistance: advanced ? viewDistanceChoice(beamNGViewDistance.value) : AUTO_VIEW_DISTANCE,
      includeRocks: effectiveIncludeRocks,
      safeCaps: !advanced || beamNGSafeCaps.value,
      assumeParking: !advanced || beamNGAssumeParking.value,
      sidewalkStyle: advanced && beamNGDecalSidewalks.value ? 'decal' : 'mesh',
      roadSurface: advanced && beamNGRoadSurface.value === 'hero' ? 'hero' : 'decal',
      curbHeight: advanced ? beamNGCurbHeight.value : 'standard',
      treeKindsOff: advanced ? sanitizeTreeKindsOff(beamNGTreeKindsOff.value) : [],
      // (basic mode: the area's own trees, none of Fine-tuning's choices)
      treeSwaps: advanced ? sanitizeTreeSwaps(beamNGTreeSwaps.value) : [],
      treeModelsOff: advanced ? sanitizeTreeModelsOff(beamNGTreeModelsOff.value) : [],
      ...structureOptions,
      levelName: beamNGLevelName.value.trim(),
      elevationSource: props.elevationSource,
      requestedResolution: props.resolution,
    });

    // (the whole control panel as one line, for the report: services/sessionConfig.js)
    const sessionCode = await currentSessionCode();
    const levelOptions = {
      ...content,
      sessionCode,
      baseTexture: effectiveBaseTexture,
      includeBackdrop: effectiveIncludeBackdrop,
      backdropElevationSource: effectiveBackdropSource,
      backdropGpxzApiKey: effectiveBackdropGpxzApiKey,
      backdropImagery: effectiveBackdropSource === 'global30m' ? beamNGBackdropImagery.value : 'standard',
      backdropStitchLimit,
      includeBuildings: effectiveIncludeBuildings,
      pbrSource: effectivePbrSource,
      includeWater: effectiveIncludeWater,
      seaLevelOffset: effectiveSeaLevelOffset,
      includeTrees: effectiveIncludeTrees,
      forestDensity: advanced ? beamNGForestDensity.value : 'normal',
      viewDistance: advanced ? viewDistanceChoice(beamNGViewDistance.value) : AUTO_VIEW_DISTANCE,
      includeRocks: effectiveIncludeRocks,
      safeCaps: !advanced || beamNGSafeCaps.value,
      assumeParking: !advanced || beamNGAssumeParking.value,
      sidewalkStyle: advanced && beamNGDecalSidewalks.value ? 'decal' : 'mesh',
      roadSurface: advanced && beamNGRoadSurface.value === 'hero' ? 'hero' : 'decal',
      curbHeight: advanced ? beamNGCurbHeight.value : 'standard',
      treeKindsOff: advanced ? sanitizeTreeKindsOff(beamNGTreeKindsOff.value) : [],
      // (basic mode: the area's own trees, none of Fine-tuning's choices)
      treeSwaps: advanced ? sanitizeTreeSwaps(beamNGTreeSwaps.value) : [],
      treeModelsOff: advanced ? sanitizeTreeModelsOff(beamNGTreeModelsOff.value) : [],
      ...structureOptions,
      roadType: effectiveRoadType,
      levelName: beamNGLevelName.value.trim(),
      elevationSource: props.elevationSource,
      requestedResolution: props.resolution,
      requestedProcessingMetersPerPixel: resolveProcessingMetersPerPixel(td),
      // the spawn and quicktravel points from step 1 (services/spawnPoints.js), a plain copy
      points: JSON.parse(JSON.stringify(toRaw(store.points) || [])),
      onProgress: ({ step, pct, elapsedMs, completed, phase, phaseFraction, phaseWeights }) => {
        beamNGProgressStep.value = step;
        beamNGProgressPct.value  = pct;
        if (phase) { beamNGPhase.value = phase; beamNGPhaseFraction.value = phaseFraction ?? 0; }
        if (phaseWeights) beamNGPhaseWeights.value = phaseWeights;
        if (Number.isFinite(elapsedMs)) beamNGElapsedMs.value = elapsedMs;
        if (completed) beamNGProgressDone.value = [...beamNGProgressDone.value, completed];
        console.log(`${BEAMNG_EXPORT_UI_LOG} Progress:`, { step, pct });
      },
    };
    // (the progress window's "Settings used")
    exportSettingsShown.value = translateExportSettings(summarizeExportSettings(levelOptions, {
      backgroundPct: td?.backgroundMask ? Math.round(backgroundFraction(rasterizeMask(td.backgroundMask, 256)) * 100) : 0,
      terrainMode: terrainMode.value, advanced, width: td?.width, metersPerPixel: resolveProcessingMetersPerPixel(td),
    }), t);

    // The data step first (usually done already, in the background): the
    // export after it only processes what's in the cache
    const dataTd = toRaw(props.terrainData);
    let dataResult = null;
    if (dataTd && exportDataNeeds(dataTd, exportDataOptions.value)) {
      beamNGProgressStep.value = t('exportPanel.ui.dataWaiting');
      dataResult = await ensureExportData(dataTd, exportDataOptions.value, {
        run: runExportData,
        onProgress: (text) => { beamNGProgressStep.value = `${t('exportPanel.ui.dataWaiting')} ${text}`; },
      }).catch((err) => { console.warn(`${BEAMNG_EXPORT_UI_LOG} Downloading ahead failed; the export fetches what it needs:`, err?.message || err); return null; });
    }
    // (the lakes and rivers round the map, for the water out over the backdrop)
    if (dataResult?.surroundWater?.length) levelOptions.surroundingWater = dataResult.surroundWater;

    // (the runner runs the data step itself when this one didn't finish)
    levelOptions.dataStepDone = !dataTd || !exportDataNeeds(dataTd, exportDataOptions.value) || exportDataState(dataTd, exportDataOptions.value)?.status === 'done';

    if (desktopApp) {
      lastExportOptions = Object.fromEntries(Object.entries(levelOptions).filter(([, v]) => typeof v !== 'function'));
      desktopExportAbort = new AbortController();
      const saved = await exportLevelOnDesktop(td, props.center, levelOptions, { signal: desktopExportAbort.signal });
      if (saved?.cancelled) return;
      exportSucceeded = true;
      console.log(`${BEAMNG_EXPORT_UI_LOG} Desktop export written:`, saved);
      beamNGDesktopSaved.value = { path: saved.path, filename: saved.filename };
      lastExport.value = { inputs: inputsAtStart, at: Date.now(), filename: saved.filename, desktop: { path: saved.path, size: saved.size }, blob: null };
      showExportOutcome('mapng-export-outcome-saved');
      notifyExportSuccess('beamng_level_zip', saved.filename);
      onLevelExported(props.center);
      return;
    }

    // (under the download guard: anything still downloaded is logged, services/dataCache.js;
    // the steps nothing changed for since the last export reused: services/stepCache.js)
    const { blob, filename } = await withDownloadGuard(() => exportBeamNGLevel(td, props.center, { ...levelOptions, stepCache: pageStepCache() }));

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
    onLevelExported(props.center);
    // (kept for "Check level" and downloading the same level again)
    lastExport.value = { inputs: inputsAtStart, at: Date.now(), filename, desktop: null, blob };

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
    exportSucceeded = true;
  } catch (error) {
    // Message inline: copied console logs collapse the object to "Object".
    console.error(`${BEAMNG_EXPORT_UI_LOG} Failed to export BeamNG level: ${error?.name || 'Error'}: ${error?.message || error}`, {
      message: error?.message,
      name: error?.name,
      stack: error?.stack,
      error,
    });
    // (the desktop app says why and keeps the export's log)
    // (why it failed, kept on screen with the offer to send a report: the desktop app's log, or the page's last lines)
    beamNGDesktopFailed.value = { message: error?.message || String(error) || t('export.errorBeamngLevel'), logPath: error?.logPath || null }; showExportOutcome('mapng-export-outcome-failed');
  } finally {
    markJobEnd();
    heavyJobRunning.value = false;
    desktopExportAbort = null;
    clearInterval(elapsedTimer);
    // (done: the card runs on to 100 % before it goes)
    if (exportSucceeded) { exportFinished.value = true; await new Promise((resolve) => setTimeout(resolve, 450)); exportFinished.value = false; }
    isExportingBeamNGLevel.value = false;
    beamNGProgressStep.value = '';
    beamNGProgressPct.value  = 0;
    beamNGProgressDone.value = [];
    beamNGElapsedMs.value = 0;
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
