<template>
  <div class="flex-1 min-h-0 flex flex-col">
  <WizardLayout v-model="step" :steps="wizardSteps">
    <!-- Basic / Advanced: advanced restores the map-maker tools (2D/3D asset
         downloads, Surrounding Tiles, per-category level export options). -->
    <template #bar>
      <div :title="t(store.advancedMode ? 'controlPanel.modeAdvancedHint' : 'controlPanel.modeBasicHint')">
        <SegmentedControl
          :model-value="store.advancedMode ? 'advanced' : 'basic'"
          @update:model-value="store.setAdvancedMode($event === 'advanced')"
          :options="[
            { value: 'basic', label: t('controlPanel.modeBasic') },
            { value: 'advanced', label: t('controlPanel.modeAdvanced') },
          ]"
        />
      </div>
    </template>

    <!-- 1. Where: the place, how big and how detailed -->
    <div v-show="step === 1" class="space-y-5">
      <SettingSection v-model:open="showCoordinates" :title="t('controlPanel.ui.location')" :icon="MapPin">
        <fieldset :disabled="store.boxLocked" :class="store.boxLocked ? 'opacity-60' : ''" :title="store.boxLocked ? (store.boxLockedByBackground ? t('backgroundAreas.lockedField') : t('map.lockedField')) : null">
          <CoordinatesInput :center="center" @locationChange="handleLocationChange" />
        </fieldset>
      </SettingSection>

      <!-- 2. How big and how detailed -->
      <SettingSection id="mapng-sec-area" :title="t('controlPanel.ui.areaDetail')" :icon="Box" storage-key="mapng_ui_sec_area">
        <div
          v-if="devMode"
          class="rounded border border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-900/20 px-3 py-2"
        >
          <p class="text-caption font-semibold text-amber-800 dark:text-amber-300">
            Developer mode enabled (press ~ to toggle)
          </p>
        </div>

        <!-- Uploaded georeferenced sources can use either full native coverage
             or a user-selected square crop inside that coverage. -->
        <div v-if="nativeDims" class="space-y-1">
          <div v-if="supportsUploadAreaMode" class="space-y-2">
            <label class="text-xs text-gray-500 dark:text-gray-400">{{ t('controlPanel.uploadAreaMode') }}</label>
            <div class="grid grid-cols-2 gap-2">
              <button
                type="button"
                @click="$emit('update:uploadedAreaMode', 'native')"
                :class="[
                  'rounded border px-3 py-2 text-sm font-medium transition-colors',
                  uploadedAreaMode === 'native'
                    ? 'border-brand bg-orange-50 dark:bg-orange-900/20 text-brand'
                    : 'border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-300',
                ]"
              >
                {{ t('controlPanel.fullCoverage') }}
              </button>
              <button
                type="button"
                @click="$emit('update:uploadedAreaMode', 'crop')"
                :class="[
                  'rounded border px-3 py-2 text-sm font-medium transition-colors',
                  uploadedAreaMode === 'crop'
                    ? 'border-brand bg-orange-50 dark:bg-orange-900/20 text-brand'
                    : 'border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-300',
                ]"
              >
                {{ t('controlPanel.squareCrop') }}
              </button>
            </div>
          </div>

          <label v-if="uploadedAreaMode !== 'crop'" class="text-xs text-gray-500 dark:text-gray-400">{{ t('controlPanel.resolutionOutputSize') }}</label>
          <div v-if="uploadedAreaMode !== 'crop'" class="w-full bg-gray-100 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded px-2 py-2 text-sm text-gray-500 dark:text-gray-400">
            {{ nativeDims.width }} × {{ nativeDims.height }} px
            <span class="text-micro ml-1">({{ t('controlPanel.nativeCoverage', { source: nativeDims.sourceLabel }) }})</span>
          </div>
          <ResolutionSelector
            v-else
            :modelValue="resolution"
            @update:modelValue="$emit('resolutionChange', $event)"
            :label="t('controlPanel.resolutionOutputSize')"
            :max-resolution="maxSquareCropResolution"
          >
            <p>{{ t('controlPanel.squareCropWithinCoverage') }}</p>
            <p v-if="uploadedElevationMeta?.suggestedResolution">{{ t('controlPanel.suggestedSquareExport', { size: uploadedElevationMeta.suggestedResolution }) }}</p>
          </ResolutionSelector>
          <div class="text-micro text-gray-500 dark:text-gray-400 pt-1 space-y-1">
            <p v-if="nativeDims.note" class="text-brand font-medium">
              {{ nativeDims.note }}
            </p>
            <p v-if="supportsUploadAreaMode && uploadedAreaMode !== 'crop'">{{ t('controlPanel.switchToSquareCrop') }}</p>
            <p v-else-if="supportsUploadAreaMode">{{ t('controlPanel.dragMapToPositionCrop') }}</p>
            <p v-else>{{ t('controlPanel.removeUploadedForCustomResolution') }}</p>
            <p v-if="previewStale" class="flex items-center gap-1 text-amber-600 dark:text-amber-400 font-medium">
              <AlertTriangle :size="11" class="shrink-0" />
              {{ t('controlPanel.previewOutOfDatePanel') }}
            </p>
          </div>
        </div>

        <fieldset v-else :disabled="store.boxLocked" :class="store.boxLocked ? 'opacity-60' : ''" :title="store.boxLocked ? (store.boxLockedByBackground ? t('backgroundAreas.lockedField') : t('map.lockedField')) : null">
          <ResolutionSelector
            :modelValue="resolution"
            @update:modelValue="$emit('resolutionChange', $event)"
            :label="t('controlPanel.resolutionOutputSize')"
          >
          </ResolutionSelector>
        </fieldset>
        <!-- (the website only: big maps belong in the desktop app) -->
        <p v-if="!desktopApp && Number(resolution) >= 4096" class="flex items-start gap-1.5 -mt-1 text-micro leading-snug text-gray-500 dark:text-gray-400">
          <Download :size="11" class="shrink-0 mt-px text-brand" />
          <span>{{ t('controlPanel.desktopHint') }} <a :href="DESKTOP_DOWNLOAD_URL" target="_blank" rel="noopener" class="text-brand hover:underline">{{ t('controlPanel.desktopHintLink') }}</a></span>
        </p>

        <fieldset :disabled="store.boxLocked" :class="store.boxLocked ? 'opacity-60' : ''">
          <ProcessingResolutionInput
            :model-value="processingMetersPerPixel"
            :resolution="Number(resolution) || 0"
            @update:model-value="(v) => $emit('update:processingMetersPerPixel', v)"
          />
        </fieldset>
        <!-- A huge area at a coarse m per pixel: fine for the terrain (BeamNG
             spaces its squares out), but lots of OSM data is trouble -->
        <p v-if="bigArea && fetchOSM" class="flex items-start gap-1.5 text-micro leading-snug text-amber-700 dark:text-amber-300">
          <AlertTriangle :size="11" class="shrink-0 mt-px" />
          <span>{{ t('controlPanel.bigAreaOsm', { km: sideKmText }) }}</span>
        </p>
        <p v-if="farShake" class="flex items-start gap-1.5 text-micro leading-snug text-amber-700 dark:text-amber-300">
          <AlertTriangle :size="11" class="shrink-0 mt-px" />
          <span>{{ t('controlPanel.farShake') }}</span>
        </p>

      </SettingSection>

      <!-- Spawn and quicktravel points (Basic too: where the car starts is a basic wish; not in a batch job) -->
      <SpawnPoints
        v-if="!store.batchMode"
        :center="center"
        :resolution="resolution"
        :meters-per-pixel="processingMetersPerPixel"
      />

      <!-- Background areas (advanced; not with an uploaded elevation file, which picks its own box) -->
      <BackgroundAreas
        v-if="store.advancedMode && !uploadedElevationFile"
        :center="center"
        :resolution="resolution"
        :meters-per-pixel="processingMetersPerPixel"
      />

      <!-- Surrounding Tiles (advanced mode) -->
      <SurroundingTiles
        v-if="store.advancedMode"
        :terrain-data="terrainData"
        :center="center"
        :resolution="resolution"
        @update:selected-positions="handleSurroundingTilesChange"
        @update:show-on-map="() => {}"
      />

    </div>

    <!-- 2. Built from: elevation (with uploads and the Terrain choice), then OpenStreetMap -->
    <div v-show="step === 2" class="space-y-5">
        <ElevationSourceSelector
          id="mapng-sec-elevation"
          :meters-per-pixel="metersPerPixel"
          :changed="elevationChanged"
          resettable
          @reset="resetElevation"
          v-model:elevationSource="elevationSource"
          :usgsStatus="usgsStatus"
          v-model:gpxzApiKey="gpxzApiKey"
          :gpxzStatus="gpxzStatus"
          :isCheckingGPXZ="isCheckingGPXZ"
          :isAreaLargeForGPXZ="isAreaLargeForGPXZ"
          :areaSqKm="areaSqKm"
          :center="center"
          @verifyGpxzKey="checkGPXZStatus"
        >
        <!-- Elevation Upload (BYOD: tif/tiff/asc/gml/xml/zip/laz/las) -->
        <ElevationUploadControl
          :uploaded-elevation-file="uploadedElevationFile"
          :uploaded-elevation-meta="uploadedElevationMeta"
          :vertical-unit-override="elevationUnitOverride"
          :asc-coordinate-system="uploadedAscCoordinateSystem"
          :no-data-override="uploadedNoDataOverride"
          :gap-fill-source="gapFillSource"
          :layer-order="uploadedLayerOrder"
          :layer-slots="elevationLayerSlots"
          :max-slots="maxElevationSlots"
          :gpxz-key-available="!!gpxzApiKey"
          @update:verticalUnitOverride="(v) => elevationUnitOverride = v"
          @update:gapFillSource="(v) => gapFillSource = v"
          @update:layerOrder="(v) => $emit('update:uploadedLayerOrder', v)"
          @slot-selected="(i, files) => $emit('elevationSlotSelected', i, files)"
          @slot-removed="(i) => $emit('elevationSlotRemoved', i)"
          @update:ascCoordinateSystem="(v) => $emit('update:uploadedAscCoordinateSystem', v)"
          @update:noDataOverride="(v) => $emit('update:uploadedNoDataOverride', v)"
          @file-selected="$emit('elevationFileSelected', $event)"
          @clear="$emit('elevationFileClear')"
        />

        <!-- LAZ Metadata Card -->
        <LazMetaCard
          v-if="isLazFileActive && uploadedElevationMeta"
          :meta="uploadedElevationMeta"
        />

        <!-- Raster Metadata Card -->
        <RasterMetaCard
          v-if="uploadedElevationMeta && !isLazFileActive"
          :meta="uploadedElevationMeta"
          :vertical-unit-override="elevationUnitOverride"
        />
          <!-- Terrain: how much MapNG shapes the elevation (advanced; basic is always Ready to drive) -->
          <p v-if="!store.advancedMode" class="text-caption leading-snug text-gray-500 dark:text-gray-400 px-1">{{ t('terrainChoice.basicNote') }}</p>
          <SettingCard v-else>
            <TerrainChoice :elevation-source="elevationSource" :upload="!!uploadedElevationFile && (!Array.isArray(uploadedElevationFile) || uploadedElevationFile.length > 0)" />
          </SettingCard>
        </ElevationSourceSelector>

      <!-- every elevation source this place has, side by side (its own section, after the choice) -->
      <SourceComparison :center="center" :gpxz-api-key="gpxzApiKey" :elevation-source="elevationSource" @pick="(k) => (elevationSource = k)" />

      <SettingSection id="mapng-sec-mapdata" :changed="mapDataChanged" resettable @reset="resetMapData" :title="t('controlPanel.ui.mapData')" :icon="Trees" storage-key="mapng_ui_sec_mapdata">
        <!-- OpenStreetMap features, and Overture's buildings where OSM has none -->
        <SettingCard>
          <SettingRow check v-model="fetchOSM" :label="t('controlPanel.includeOsmFeatures')" :hint="t('controlPanel.ui.osmHint')" />
          <!-- MapNG's own copy of OpenStreetMap first, or the live servers (services/osm.js fetchOsmRaw) -->
          <SettingRow
            check
            v-model="osmTilesFirst"
            :label="t('controlPanel.osmTilesFirst')"
            :hint="t('controlPanel.osmTilesFirstHint')"
            :disabled="!fetchOSM"
            :disabled-reason="t('controlPanel.ui.needsOsmOn')"
          />
          <details v-if="fetchOSM" class="pl-4 text-caption text-gray-500 dark:text-gray-400" :open="!!customOverpassUrl">
            <summary class="cursor-pointer select-none hover:text-brand">{{ t('controlPanel.customOverpass') }}</summary>
            <input
              v-model.trim="customOverpassUrl"
              type="password"
              autocomplete="off"
              spellcheck="false"
              placeholder="https://api.tracestrack.com/overpass/YOUR_KEY/interpreter"
              class="mt-1 w-full px-1.5 py-1 rounded border border-gray-300 dark:border-gray-500 bg-white dark:bg-gray-800 text-caption text-gray-900 dark:text-white focus:outline-none focus:ring-1 focus:ring-brand focus:border-brand"
            />
            <p v-if="customOverpassUrl && !customOverpassValid" class="mt-0.5 text-amber-600 dark:text-amber-400">{{ t('controlPanel.customOverpassInvalid') }}</p>
            <p class="mt-0.5 leading-snug">{{ t('controlPanel.customOverpassHint') }} <a href="https://tracestrack.com/2026/08/07/using-overpass-api-in-turbo-or-josm/" target="_blank" rel="noopener" class="text-brand hover:underline">Tracestrack</a> · <a href="https://overspan.dev/" target="_blank" rel="noopener" class="text-brand hover:underline">Overspan</a></p>
          </details>
          <OsmFileInput v-if="fetchOSM" :area="selectionArea" />
          <!-- (services/overtureTiles.js) -->
          <SettingRow
            check
            v-model="overtureBuildings"
            :label="t('controlPanel.overtureBuildings')"
            :hint="t('controlPanel.overtureBuildingsHint')"
            :disabled="!fetchOSM"
            :disabled-reason="t('controlPanel.ui.needsOsmOn')"
          />
        </SettingCard>

      </SettingSection>

    </div>

    <!-- 3. Generate: the whole setup at a glance, then the buttons below -->
    <div v-show="step === 3" class="space-y-4">
      <div class="space-y-1.5">
        <div class="text-micro font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500">{{ t('wizard.review') }}</div>
        <GenerateSummary rows :items="summaryItems" @step="(n) => step = n" />
        <p class="text-caption leading-snug text-gray-500 dark:text-gray-400">{{ t('wizard.reviewHint') }}</p>
      </div>
      <!-- (generated already: whether it still matches the settings) -->
      <div v-if="terrainData && !isGenerating" class="rounded-lg border px-3 py-2 text-caption" :class="isCached ? 'border-emerald-200 dark:border-emerald-800 bg-emerald-50/60 dark:bg-emerald-900/10' : 'border-amber-200 dark:border-amber-800 bg-amber-50/60 dark:bg-amber-900/10'">
        <div class="flex items-center gap-1.5 font-semibold" :class="isCached ? 'text-emerald-700 dark:text-emerald-400' : 'text-amber-700 dark:text-amber-300'">
          <CheckCircle2 v-if="isCached" :size="13" class="shrink-0" /><AlertTriangle v-else :size="13" class="shrink-0" />
          {{ isCached ? t('wizard.generated') : t('wizard.generatedStale') }}
        </div>
        <button type="button" class="mt-1 text-brand hover:underline" @click="step = 4">{{ t('wizard.toExport') }}</button>
      </div>


    </div>

    <!-- 4. Export: what was generated, and what the level gets (the export button sits in the bar below) -->
    <div v-show="step === 4" class="space-y-5">
      <!-- (settings changed since generating: the export would use the old
           terrain, its old elevation source and Terrain choice; say so first) -->
      <div v-if="exportStale" class="rounded-lg border border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-900/20 px-3 py-2.5 space-y-2">
        <p class="flex items-start gap-1.5 text-caption leading-snug font-medium text-amber-800 dark:text-amber-200">
          <AlertTriangle :size="13" class="shrink-0 mt-px" />{{ t('wizard.exportStale') }}
        </p>
        <button
          type="button"
          class="px-3 py-1 rounded-md bg-brand hover:bg-brand-500 text-white text-caption font-semibold"
          @click="$emit('generate', false, fetchOSM, elevationSource, gpxzApiKey, elevationUnitOverride, metersPerPixel, gapFillSource)"
        >{{ t('wizard.generateAgain') }}</button>
      </div>
      <h3 v-if="terrainData && !isGenerating" class="flex items-center gap-2 pt-4 border-t border-gray-200 dark:border-gray-600 text-sm font-semibold text-emerald-700 dark:text-emerald-400">
        <CheckCircle2 :size="14" class="shrink-0" />
        {{ t('exportPanel.readyToExport') }}
        <span class="text-caption font-normal text-gray-500 dark:text-gray-400">{{ terrainData.width }}×{{ terrainData.height }}</span>
      </h3>
      <!-- Terrain Stats (shown when data is available) -->
      <TerrainStats
        :terrain-data="terrainData"
        :meters-per-pixel="metersPerPixel"
        :area-display="areaDisplay"
      />

      <!-- Export Panel (shown when data is available) -->
      <div v-if="terrainData && !isGenerating">
        <ExportPanel
          :key="exportPanelKey"
        button-target="#mapng-wizard-export"
          :terrain-data="terrainData"
          :is-generating="isGenerating"
          :center="center"
          :zoom="zoom"
          :resolution="resolution"
          :elevation-source="elevationSource"
          :gpxz-api-key="gpxzApiKey"
          :gpxz-status="gpxzStatus"
          :fetch-o-s-m="fetchOSM"
          :surrounding-tile-positions="surroundingTilePositions"
          @fetch-osm="$emit('fetchOsm')"
          @export-success="$emit('exportSuccess', $event)"
        />
      </div>

    </div>

    <template #footer>
      <template v-if="step < 4">
        <GenerateSummary compact :items="summaryItems" @step="(n) => step = n" />
        <GenerateActions
          :is-generating="isGenerating"
          :is-cached="isCached"
          :use-gpxz="useGPXZ"
          :gpxz-api-key="gpxzApiKey"
          :has-custom-elevation="!!uploadedElevationFile"
          @generate="(preview) => $emit('generate', preview, fetchOSM, elevationSource, gpxzApiKey, elevationUnitOverride, metersPerPixel, gapFillSource)"
          @ready="step = 4; if (store.viewMode === 'location' && terrainData) store.viewMode = 'preview2d'"
        />
      </template>
      <!-- (ExportPanel teleports its export button here) -->
      <p v-if="step === 4 && exportStale" class="flex items-center gap-1.5 text-micro leading-snug text-amber-700 dark:text-amber-300">
        <AlertTriangle :size="11" class="shrink-0" />{{ t('wizard.exportStaleShort') }}
      </p>
      <div v-show="step === 4" id="mapng-wizard-export" class="space-y-2"></div>
    </template>
  </WizardLayout>

    <!-- (outside the collapsible section: Ctrl+V on the map opens it too) -->
    <!-- Share & load settings: opened from the share icon in the top bar -->
    <ShareDialog>
      <RunConfigControls
        :status="runConfigStatus"
        @copy="copyRunConfiguration"
        @save="saveRunConfiguration"
        @load="handleRunConfigFile"
        sendable
        :sending="sendingConfig"
        :sent="sentConfig"
        @send="sendConfig"
        @open-code="openShareCode"
      />
    </ShareDialog>
    <SessionConfigDialog
      v-if="pendingConfig"
      :rows="pendingConfigRows"
      @apply="applyPendingConfig"
      @cancel="pendingConfig = null"
    />
  </div>
</template>

<script setup>
import { DEFAULT_ELEVATION_SOURCE, initialElevationSource } from '../../services/elevationDefaults.js';
import { ref, shallowRef, computed, onMounted, onUnmounted, watch, toRaw } from 'vue';
import { provideSectionGroup } from '../../composables/useSectionGroup.js';
// Expand all / Collapse all for every section in this panel
provideSectionGroup();
import { CUSTOM_OVERPASS_STORAGE_KEY, OVERTURE_BUILDINGS_STORAGE_KEY } from '../../services/osm.js';
import { useOsmSource } from '../../composables/useOsmSource.js';
import { useI18n } from 'vue-i18n';
import { MapPin, Box, Trees, AlertTriangle, Download, CheckCircle2 } from 'lucide-vue-next';
import { desktopApp, DESKTOP_DOWNLOAD_URL } from '../../services/platform/desktop.js';
import SettingSection from '../base/SettingSection.vue';
import SettingRow from '../base/SettingRow.vue';
import SettingCard from '../base/SettingCard.vue';
import SegmentedControl from '../base/SegmentedControl.vue';
import CoordinatesInput from '../map/CoordinatesInput.vue';
import ElevationSourceSelector from '../map/ElevationSourceSelector.vue';
import SourceComparison from '../map/SourceComparison.vue';
import ResolutionSelector from '../map/ResolutionSelector.vue';
import SurroundingTiles from '../map/SurroundingTiles.vue';
import BackgroundAreas from '../controls/BackgroundAreas.vue';
import SpawnPoints from '../controls/SpawnPoints.vue';
import ExportPanel from './ExportPanel.vue';
import { useMainStore } from '../../stores/mainStore';
import GenerateActions from '../controls/GenerateActions.vue';
import ElevationUploadControl from '../controls/ElevationUploadControl.vue';
import RunConfigControls from '../controls/RunConfigControls.vue';
import ProcessingResolutionInput from '../controls/ProcessingResolutionInput.vue';
import TerrainStats from '../controls/TerrainStats.vue';
import LazMetaCard from '../controls/LazMetaCard.vue';
import RasterMetaCard from '../controls/RasterMetaCard.vue';
import { checkUSGSStatus, probeGPXZLimits } from '../../services/terrain';
import { downloadJsonFile } from '../../services/traceability';
import { buildRunConfiguration as buildRunConfigurationBase } from '../../services/runConfiguration';
import { applyStoredSettings, usableMask, buildSessionConfig, describeSessionConfig, encodeSessionCode, encodeSessionCodeWithin, configPoints, fetchSharedCode, looksLikeSessionCode, parseSessionText, sendSessionCode, shareIdFrom, shareLink } from '../../services/sessionConfig.js';
import { setBaseTexture } from '../../composables/useBaseTexture.js';
import SessionConfigDialog from '../modals/SessionConfigDialog.vue';
import ShareDialog from '../modals/ShareDialog.vue';
import { closeShareDialog } from '../../composables/useShareDialog.js';
import { withoutPersonal } from '../../services/personalKeys.js';
import { setSessionConfigSource } from '../../composables/useReportDialog.js';
import { getMaxSquareCropResolution, scaleNativeDimsToProcessingMpp } from '../../services/uploadBounds';
import { normalizeGapFillSource } from '../../services/gapFillSources.js';
import TerrainChoice from '../ui/TerrainChoice.vue';
import WizardLayout from '../ui/WizardLayout.vue';
import { BIG_AREA_KM, reachesShakeDistance } from '../../services/levelLimits.js';
import { getLoadedOsmFile, onOsmFileChange, osmFileCoverage } from '../../services/osmFile.js';
import OsmFileInput from '../controls/OsmFileInput.vue';
import { computeGridBounds } from '../../services/batchJob.js';
import GenerateSummary from '../ui/GenerateSummary.vue';
import { terrainMode, setTerrainMode, terrainGenerationOptions } from '../../composables/useTerrainMode.js';
import { reloadTerrainSettings } from '../../composables/useTerrainMode.js';
import { reloadContentSettings } from '../../composables/useBuildContent.js';

const { t } = useI18n({ useScope: 'global' });

const props = defineProps(['center', 'zoom', 'resolution', 'devMode', 'isGenerating', 'terrainData', 'generationCacheKey', 'uploadedElevationFile', 'uploadedElevationMeta', 'uploadedAscCoordinateSystem', 'uploadedNoDataOverride', 'uploadedLayerOrder', 'elevationLayerSlots', 'maxElevationSlots', 'uploadedAreaMode', 'processingMetersPerPixel']);

const emit = defineEmits(['locationChange', 'resolutionChange', 'zoomChange', 'generate', 'fetchOsm', 'surroundingTilesChange', 'elevationFileSelected', 'elevationFileClear', 'elevationSlotSelected', 'elevationSlotRemoved', 'showSupport', 'exportSuccess', 'update:uploadedAscCoordinateSystem', 'update:uploadedNoDataOverride', 'update:uploadedLayerOrder', 'update:uploadedAreaMode', 'update:processingMetersPerPixel', 'update:previewStale']);

const handleLocationChange = (newLocation) => {
  emit('locationChange', { ...props.center, ...newLocation });
};

const store = useMainStore();
const surroundingTilePositions = ref([]);
watch(() => store.advancedMode, (advanced) => {
  if (!advanced) handleSurroundingTilesChange([]);
});
const runConfigStatus = ref('');
const fetchOSM = ref(localStorage.getItem('mapng_fetchOSM') !== 'false');
const useUSGS = ref(false);
const useGPXZ = ref(false);
const elevationUnitOverride = ref(localStorage.getItem('mapng_elevationUnitOverride') || 'auto');
// Which dataset fills the parts of an export the upload does not cover.
const gapFillSource = ref(normalizeGapFillSource(localStorage.getItem('mapng_gapFillSource')));
const elevationSource = ref(initialElevationSource('mapng_elevationSource'));
const gpxzApiKey = ref(localStorage.getItem('mapng_gpxzApiKey') || '');
const gpxzStatus = ref(null); // { plan, used, limit, remaining, concurrency, valid }
const isCheckingGPXZ = ref(false);
const usgsStatus = ref(null);

// Collapsible section states (persisted via localStorage, hidden by default)
const showCoordinates = ref(localStorage.getItem('mapng_showCoordinates') !== 'false');

onMounted(async () => {
  // Initialise elevation-source flags from persisted selection
  useUSGS.value = elevationSource.value === 'usgs';
  useGPXZ.value = elevationSource.value === 'gpxz';
  usgsStatus.value = await checkUSGSStatus();
});

// Keep useUSGS / useGPXZ flags in sync with the elevation source selector
watch(elevationSource, (newVal) => {
  useUSGS.value = newVal === 'usgs';
  useGPXZ.value = newVal === 'gpxz';
  localStorage.setItem('mapng_elevationSource', newVal);
});

// Persist OSM toggle
const customOverpassUrl = ref(localStorage.getItem(CUSTOM_OVERPASS_STORAGE_KEY) || '');
const customOverpassValid = computed(() => /^https:\/\/\S+$/.test(customOverpassUrl.value));
watch(customOverpassUrl, (newVal) => {
  if (newVal) localStorage.setItem(CUSTOM_OVERPASS_STORAGE_KEY, newVal);
  else localStorage.removeItem(CUSTOM_OVERPASS_STORAGE_KEY);
});

watch(fetchOSM, (newVal) => {
  localStorage.setItem('mapng_fetchOSM', String(newVal));
});

// On unless turned off; read by fetchOSMData (single tile and batch alike).
// (shared with the note in the view bar: composables/useOsmSource.js keeps it)
const { tilesFirst: osmTilesFirst } = useOsmSource();
const overtureBuildings = ref(localStorage.getItem(OVERTURE_BUILDINGS_STORAGE_KEY) !== 'false');
watch(overtureBuildings, (newVal) => {
  localStorage.setItem(OVERTURE_BUILDINGS_STORAGE_KEY, String(newVal));
});

// Persist GPXZ API key and reset status when it changes
watch(gpxzApiKey, (newVal) => {
  localStorage.setItem('mapng_gpxzApiKey', newVal);
  gpxzStatus.value = null;
});

watch(gapFillSource, (newVal) => {
  localStorage.setItem('mapng_gapFillSource', normalizeGapFillSource(newVal));
});

watch(elevationUnitOverride, (newVal) => {
  localStorage.setItem('mapng_elevationUnitOverride', newVal || 'auto');
});

// Probe GPXZ account limits and cache the result for UI display
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
watch(showCoordinates, (v) => localStorage.setItem('mapng_showCoordinates', String(v)));

// If USGS returns no data the terrain pipeline falls back to global tiles;
// reflect that in the UI by resetting the source selector to the default.
watch(() => props.terrainData, (newData) => {
  if (newData?.usgsFallback) {
    elevationSource.value = DEFAULT_ELEVATION_SOURCE;
    alert(t('app.error.usgsFallback'));
  } else if (newData?.kron86Fallback) {
    elevationSource.value = DEFAULT_ELEVATION_SOURCE;
    alert(t('app.error.kron86Fallback'));
  }
});

// Sections that differ from the defaults (a dot by the title) and their Reset
const elevationChanged = computed(() => elevationSource.value !== 'mapterhorn' || (store.advancedMode && terrainMode.value !== 'ready'));
const resetElevation = () => { elevationSource.value = 'mapterhorn'; setTerrainMode('ready'); };
const mapDataChanged = computed(() => !fetchOSM.value || !overtureBuildings.value || !osmTilesFirst.value);
const resetMapData = () => { fetchOSM.value = true; overtureBuildings.value = true; osmTilesFirst.value = true; };

// The setup in one line (the wizard's bottom bar) and as the review step's
// list (components/ui/GenerateSummary.vue); each part goes to its step.
const osmFile = shallowRef(getLoadedOsmFile());
const stopOsmFile = onOsmFileChange((f) => { osmFile.value = f; });
onUnmounted(stopOsmFile);
const summaryItems = computed(() => {
  const upload = Array.isArray(props.uploadedElevationFile) ? props.uploadedElevationFile.length > 0 : !!props.uploadedElevationFile;
  const km = ((Number(props.resolution) || 0) * (Number(props.processingMetersPerPixel) || 1)) / 1000;
  const kmText = km >= 10 ? km.toFixed(0) : km.toFixed(1);
  const mode = store.advancedMode ? terrainMode.value : 'ready';
  const fromFile = fetchOSM.value && osmFile.value && osmFileCoverage(osmFile.value.bounds, selectionArea.value).coverage !== 'none';
  return [
    { key: 'area', rowLabel: t('wizard.rowArea'), label: t('genSummary.area', { w: kmText, h: kmText }), target: 'mapng-sec-area', step: 1 },
    { key: 'px', rowLabel: t('wizard.rowResolution'), label: t('genSummary.px', { px: props.resolution }), target: 'mapng-sec-area', step: 1 },
    { key: 'source', rowLabel: t('wizard.rowElevation'), label: t(`genSummary.source_${upload ? 'upload' : elevationSource.value}`), target: 'mapng-sec-elevation', step: 2 },
    { key: 'terrain', rowLabel: t('wizard.rowTerrain'), label: t(`terrainChoice.${mode}`), target: 'mapng-sec-elevation', step: 2, warn: mode === 'untouched' },
    { key: 'osm', rowLabel: t('wizard.rowMapData'), label: t(!fetchOSM.value ? 'genSummary.osmOff' : fromFile ? 'genSummary.osmFile' : 'genSummary.osmOn'), target: 'mapng-sec-mapdata', step: 2, warn: !fetchOSM.value },
  ];
});

// The wizard (components/ui/WizardLayout.vue): Where, Built from, Generate,
// and Export once there is terrain to export. After generating it moves on
// to Export by itself.
const step = ref(1);
// (a step stays ticked once moved past, wherever the user goes after: going
// back to look at Location doesn't untick it; with terrain made, Location and
// Sources are done; Generate is ticked while the terrain matches the settings)
const furthestStep = ref(1);
watch(step, (n) => { furthestStep.value = Math.max(furthestStep.value, n); store.exportStepOpen = n === 4; }, { immediate: true });
const wizardSteps = computed(() => [
  { key: 'where', label: t('panelSteps.where'), done: furthestStep.value > 1 || !!props.terrainData },
  { key: 'built', label: t('panelSteps.builtFrom'), done: furthestStep.value > 2 || !!props.terrainData },
  { key: 'generate', label: t('wizard.generate'), done: !!props.terrainData && isCached.value },
  { key: 'export', label: t('wizard.export'), locked: !props.terrainData, lockedReason: t('wizard.exportLocked') },
]);
// (the terrain on screen was made from other settings than these: an export now
// would use it as it is, e.g. still from the old elevation source)
const exportStale = computed(() => !!props.terrainData && !props.isGenerating && !isCached.value && !props.uploadedElevationFile);
watch(() => props.isGenerating, (now, before) => {
  if (before && !now && props.terrainData) step.value = 4;
});
// (the terrain gone, e.g. a new upload cleared it: Export can't stay open)
watch(() => props.terrainData, (td) => { if (!td && step.value === 4) step.value = 3; });

const processingMetersPerPixelNumber = computed(() => {
  const parsed = Number(props.processingMetersPerPixel);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
});

const metersPerPixel = computed(() => processingMetersPerPixelNumber.value);
// (services/levelLimits.js: when a big area's notes show)
const sideKm = computed(() => ((Number(props.resolution) || 0) * metersPerPixel.value) / 1000);
const sideKmText = computed(() => (sideKm.value >= 10 ? sideKm.value.toFixed(0) : sideKm.value.toFixed(1)));
const bigArea = computed(() => sideKm.value >= BIG_AREA_KM);
const farShake = computed(() => reachesShakeDistance(sideKm.value));
// (the box being generated, for the OSM file: does the file cover it)
const selectionArea = computed(() => computeGridBounds(props.center, props.resolution, 1, 1, props.resolution * metersPerPixel.value));

// Detect active file type for metadata card routing
const isLazFileActive = computed(() => {
  const file = Array.isArray(props.uploadedElevationFile)
    ? props.uploadedElevationFile[0]
    : props.uploadedElevationFile;
  const name = file?.name?.toLowerCase() ?? '';
  return name.endsWith('.laz') || name.endsWith('.las');
});

const isGeoReferencedRasterActive = computed(() => {
  if (isLazFileActive.value) return false;
  return !!props.uploadedElevationMeta?.bounds;
});

// When a LAZ file is active with native dimensions, lock the resolution display
// to show the file's native coverage rather than the resolution dropdown.
const lazNativeDims = computed(() => {
  if (!isLazFileActive.value) return null;
  const meta = props.uploadedElevationMeta;
  if (!meta?.nativeWidth || !meta?.nativeHeight) return null;
  const { width, height } = scaleNativeDimsToProcessingMpp(meta.nativeWidth, meta.nativeHeight, metersPerPixel.value);
  return {
    width,
    height,
    cropSize: null,
    sourceLabel: 'LAZ',
    note: null,
  };
});

// Same native-dimension lock for georeferenced raster uploads.
const georeferencedRasterNativeDims = computed(() => {
  if (!isGeoReferencedRasterActive.value) return null;
  const meta = props.uploadedElevationMeta;
  if (!meta?.nativeWidth || !meta?.nativeHeight || !meta?.bounds) return null;
  const { width, height } = scaleNativeDimsToProcessingMpp(meta.nativeWidth, meta.nativeHeight, metersPerPixel.value);
  return {
    width,
    height,
    cropSize: null,
    sourceLabel: meta?.formatLabel || 'Raster',
    note: null,
  };
});

const nativeDims = computed(() => lazNativeDims.value || georeferencedRasterNativeDims.value);
// Any georeferenced upload (LAZ/LAS or raster) with WGS84 bounds can offer the
// native-vs-square-crop choice; uploads lacking a CRS stay native-only since a
// geographic crop can't be positioned without bounds.
const supportsUploadAreaMode = computed(() => !!props.uploadedElevationMeta?.bounds);
const maxSquareCropResolution = computed(() => getMaxSquareCropResolution(props.uploadedElevationMeta, metersPerPixel.value));

watch([() => props.uploadedAreaMode, maxSquareCropResolution], ([mode, maxResolution]) => {
  if (mode !== 'crop' || !Number.isFinite(maxResolution) || maxResolution <= 0) return;
  if (Number(props.resolution) > maxResolution) {
    emit('resolutionChange', props.uploadedElevationMeta?.suggestedResolution || maxResolution);
  }
}, { immediate: true });

// ── Stale-preview tracking for uploads ──────────────────────────────────────
// The 3D preview only reflects the last generation; changing the crop (mode or
// box position) or any other generation input leaves it out of date. Track that
// so the UI can prompt a re-run instead of silently showing the old terrain.
const previewStale = ref(false);
watch(
  () => [
    props.resolution,
    metersPerPixel.value,
    props.uploadedAreaMode,
    props.uploadedAscCoordinateSystem,
    props.uploadedNoDataOverride,
    props.uploadedLayerOrder,
    gapFillSource.value,
    elevationUnitOverride.value,
    fetchOSM.value,
    // Crop position only changes the output in square-crop mode.
    props.uploadedAreaMode === 'crop' ? props.center.lat : 0,
    props.uploadedAreaMode === 'crop' ? props.center.lng : 0,
  ],
  () => {
    if (props.uploadedElevationFile && props.terrainData) previewStale.value = true;
  },
);
// A completed generation refreshes the cache key; a new/cleared upload resets too.
watch(() => props.generationCacheKey, () => { previewStale.value = false; });
watch(() => props.uploadedElevationFile, () => { previewStale.value = false; });
watch(previewStale, (v) => emit('update:previewStale', v), { immediate: true });

// Area calculations (resolution is in metres because metersPerPixel = 1)
const totalWidthMeters = computed(() => props.resolution * metersPerPixel.value);
const totalAreaSqM = computed(() => totalWidthMeters.value * totalWidthMeters.value);
const areaSqKm = computed(() => totalAreaSqM.value / 1000000);

const signatureForKey = (key) => {
  if (!key) return '';
  let hash = 2166136261;
  for (let i = 0; i < key.length; i++) {
    hash ^= key.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
};

// True when the current UI params exactly match the last successful generation,
// so the user can skip re-fetching and go straight to export.
// Whether the terrain shown was made from these settings: the fields of
// App.vue's generation key this panel knows, compared one by one (a copy of
// the whole key here never matched it, so this always said "changed").
const isCached = computed(() => {
  if (props.uploadedElevationFile) return false; // always re-generate when custom file is active
  if (!props.generationCacheKey || !props.terrainData) return false;
  let made;
  try { made = JSON.parse(props.generationCacheKey); } catch { return false; }
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  return made.lat === props.center.lat
    && made.lng === props.center.lng
    && Number(made.resolution) === Number(props.resolution)
    && Number(made.processingMetersPerPixel) === Number(metersPerPixel.value)
    && made.osm === fetchOSM.value
    && made.elevationSource === elevationSource.value
    && made.gpxzKeySig === (elevationSource.value === 'gpxz' ? signatureForKey(gpxzApiKey.value) : '')
    && (made.gapFillSource === undefined || made.gapFillSource === gapFillSource.value)
    && !!made.rawTerrain === !!store.rawTerrainActive
    && (made.generationEdits === undefined || same(made.generationEdits, terrainGenerationOptions(store.advancedMode)))
    // (background and No smoothing areas change what is fetched and how roads are smoothed: App.vue's key has them)
    && (made.backgroundMask === undefined || same(made.backgroundMask, store.backgroundActive ? store.backgroundMask : null));
});

// GPXZ has a 10 km² per-request limit; warn when the selected area exceeds it.
const isAreaLargeForGPXZ = computed(() => useGPXZ.value && areaSqKm.value > 10);

const areaDisplay = computed(() => {
  return totalAreaSqM.value > 1000000
    ? `${areaSqKm.value.toFixed(2)} km²`
    : `${Math.round(totalAreaSqM.value).toLocaleString()} m²`;
});

const handleSurroundingTilesChange = (positions) => {
  surroundingTilePositions.value = positions || [];
  emit('surroundingTilesChange', surroundingTilePositions.value);
};

const buildRunConfiguration = () => buildRunConfigurationBase({
  center: props.center,
  zoom: props.zoom,
  resolution: props.resolution,
  includeOSM: fetchOSM.value,
  elevationSource: elevationSource.value,
  gpxzApiKey: gpxzApiKey.value,
  gpxzStatus: gpxzStatus.value,
  terrainData: props.terrainData,
  extra: {
    processingMetersPerPixel: metersPerPixel.value,
    rawTerrain: store.rawTerrainActive,
  },
});

const triggerDownload = (blob, filename) => {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.download = filename;
  link.href = url;
  link.click();
  URL.revokeObjectURL(url);
};

// The whole control panel (data + export settings) as one config, never
// with keys: services/sessionConfig.js. Copy gives a one-line "mapng:1:…"
// code; Paste, Load and Ctrl+V on the map show what it would change first.
const currentSessionConfig = () => buildSessionConfig({ ...buildRunConfiguration(), rawTerrain: store.rawTerrain }, localStorage, { backgroundMask: store.backgroundActive ? toRaw(store.backgroundMask) : null, points: toRaw(store.points) });

const copyRunConfiguration = async () => {
  try {
    const code = await encodeSessionCode(currentSessionConfig());
    if (!navigator.clipboard?.writeText) throw new Error('no clipboard');
    await navigator.clipboard.writeText(code);
    runConfigStatus.value = t('config.copied');
  } catch {
    runConfigStatus.value = t('status.clipboardWriteUnavailable');
  }
};

// a config waiting for the user's Apply (SessionConfigDialog.vue)
const pendingConfig = ref(null);
// (a code opened: its review takes over from the share window)
watch(pendingConfig, (cfg) => { if (cfg) closeShareDialog(); });
const pendingConfigRows = computed(() => (pendingConfig.value ? describeSessionConfig(pendingConfig.value, { hasGpxzKey: !!gpxzApiKey.value }) : []));
const previewConfigText = async (text, { quiet = false } = {}) => {
  try {
    pendingConfig.value = await parseSessionText(text);
    return true;
  } catch (error) {
    if (!quiet) {
      console.error('Not a MapNG config:', error);
      runConfigStatus.value = String(text || '').trim() ? t('config.invalid') : t('status.clipboardEmpty');
    }
    return false;
  }
};

// (the notice after an unexpected close offers the settings as they were: components/ui/UnfinishedJobNotice.vue)
const onRestoreCode = (event) => { if (typeof event?.detail === 'string') previewConfigText(event.detail, { quiet: true }); };
onMounted(() => window.addEventListener('mapng:restore-session-code', onRestoreCode));
onUnmounted(() => window.removeEventListener('mapng:restore-session-code', onRestoreCode));

// (the export panel reads its settings when it appears: re-created after a config is applied)
const exportPanelKey = ref(0);
const applyPendingConfig = () => {
  const config = pendingConfig.value;
  pendingConfig.value = null;
  if (!config) return;
  try {
    // (a config with an area replaces the background areas: the old ones
    // lock the box to the old area; a config with its own puts them back)
    const hasArea = config.center && Number.isFinite(Number(config.center.lat));
    if (hasArea || usableMask(config.backgroundMask)) store.clearBackgroundMask();
    applyRunConfiguration(config);
    if (typeof config.advancedMode === 'boolean') store.setAdvancedMode(config.advancedMode);
    if (usableMask(config.backgroundMask)) {
      store.setAdvancedMode(true);   // (background areas are an Advanced step-1 tool)
      store.setBackgroundMask(config.backgroundMask);
    }
    // (a config with points brings its own; one without leaves the user's: they are geographic, and kept outside the box)
    const points = configPoints(config);
    if (points) store.setPoints(points);
    if (typeof config.rawTerrain === 'boolean') store.setRawTerrain(config.rawTerrain);
    if (typeof config.gapFillSource === 'string' && config.gapFillSource) gapFillSource.value = normalizeGapFillSource(config.gapFillSource);
    if (typeof config.elevationUnitOverride === 'string' && config.elevationUnitOverride) elevationUnitOverride.value = config.elevationUnitOverride;
    if (typeof config.overtureBuildings === 'boolean') overtureBuildings.value = config.overtureBuildings;
    if (applyStoredSettings(config, localStorage)) {
      // (the code's terrain edits went into the old keys: the Terrain choice reads them back)
      reloadTerrainSettings();
      reloadContentSettings();
      if (config.export.baseTexture) setBaseTexture(config.export.baseTexture);
      exportPanelKey.value += 1;
    }
    runConfigStatus.value = t('config.applied');
  } catch (error) {
    console.error('Failed to apply config:', error);
    runConfigStatus.value = t('config.invalid');
  }
};

// Send: mapng.com keeps the code 24 hours under a short code (worker/shareCodes.js)
const sendingConfig = ref(false);
const sentConfig = ref(null);   // { id, link }
const sendConfig = async () => {
  sendingConfig.value = true;
  try {
    // (mapng.com keeps codes up to 16 KB: a big background-areas drawing is
    // left out of the short code, the long one still has it)
    // (then the points, if it is still too big)
    const { code, dropped } = await encodeSessionCodeWithin(currentSessionConfig(), 16000);
    const { id } = await sendSessionCode(code);
    sentConfig.value = { id, link: shareLink(id) };
    runConfigStatus.value = dropped.includes('points') ? t('config.sentWithoutPoints') : dropped.length ? t('config.sentWithoutAreas') : '';
  } catch (error) {
    sentConfig.value = null;
    runConfigStatus.value = t('config.sendFailed', { reason: String(error?.message || error) });
  } finally { sendingConfig.value = false; }
};
const openShareCode = async (text) => {
  const id = shareIdFrom(text);
  if (!id) { await previewConfigText(text); return; }   // (a full code typed into the box works too)
  try { await previewConfigText(await fetchSharedCode(id)); }
  catch (error) { runConfigStatus.value = t('config.openFailed', { reason: String(error?.message || error) }); }
};

// Ctrl+V anywhere outside a text box: a pasted MapNG config opens the same preview
const onWindowPaste = (event) => {
  const target = event.target;
  if (target && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))) return;
  const text = event.clipboardData?.getData('text') || '';
  const trimmed = text.trim();
  if (/^(https?:\/\/)?(dev\.)?mapng\.com\/#[A-Za-z0-9]{3}-?[A-Za-z0-9]{3}$/.test(trimmed) || /^[A-Za-z0-9]{3}-[A-Za-z0-9]{3}$/.test(trimmed)) {
    if (shareIdFrom(trimmed)) { event.preventDefault(); openShareCode(trimmed); }
    return;
  }
  if (!looksLikeSessionCode(trimmed) && !(trimmed.startsWith('{') && trimmed.includes('"center"'))) return;
  event.preventDefault();
  previewConfigText(trimmed, { quiet: !looksLikeSessionCode(trimmed) });
};
onMounted(() => {
  window.addEventListener('paste', onWindowPaste);
  setSessionConfigSource(currentSessionConfig);
  // a mapng.com/#K7F-29Q link: open the sent config's preview
  const linked = shareIdFrom(window.location.hash);
  if (linked && /^#[A-Za-z0-9]{3}-?[A-Za-z0-9]{3}$/.test(window.location.hash)) {
    history.replaceState(null, '', window.location.pathname + window.location.search);
    openShareCode(linked);
  }
});
onUnmounted(() => { window.removeEventListener('paste', onWindowPaste); setSessionConfigSource(null); });

const saveRunConfiguration = () => {
  downloadJsonFile(currentSessionConfig(), `MapNG_Config_${new Date().toISOString().slice(0, 10)}.json`);
  runConfigStatus.value = t('status.runConfigDownloaded');
};

const toNumberOrNull = (value) => {
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
};

const toBooleanOrNull = (value) => {
  if (value === true || value === false) return value;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (normalized === 'true' || normalized === '1') return true;
    if (normalized === 'false' || normalized === '0') return false;
  }
  if (value === 1) return true;
  if (value === 0) return false;
  return null;
};

const clampInt = (value, min, max) => Math.min(max, Math.max(min, parseInt(value, 10)));

const applyRunConfiguration = (config) => {
  const src = withoutPersonal(config?.runConfiguration || config);
  if (!src || typeof src !== 'object') throw new Error('Invalid JSON schema');

  const schemaVersion = Number(src.schemaVersion ?? 1);
  const modeRaw = String(src.mode || config?.mode || 'single').toLowerCase();
  if (schemaVersion !== 1 || modeRaw !== 'single') {
    throw new Error('Unsupported configuration schema.');
  }

  const lat = toNumberOrNull(src?.center?.lat);
  const lng = toNumberOrNull(src?.center?.lng);
  if (lat !== null && lng !== null) {
    emit('locationChange', { lat, lng });
  }

  const resolutionValue = toNumberOrNull(src.resolution);
  if (resolutionValue !== null) {
    emit('resolutionChange', clampInt(resolutionValue, 512, 16384));
  }

  const processingMetersPerPixelValue = toNumberOrNull(src.processingMetersPerPixel);
  if (processingMetersPerPixelValue !== null && processingMetersPerPixelValue > 0) {
    emit('update:processingMetersPerPixel', processingMetersPerPixelValue);
  }

  const zoomValue = toNumberOrNull(src.zoom);
  if (zoomValue !== null) {
    emit('zoomChange', clampInt(zoomValue, 1, 20));
  }

  const includeOSMValue = toBooleanOrNull(src.includeOSM);
  if (includeOSMValue !== null) {
    fetchOSM.value = includeOSMValue;
  }

  const explicitSource = typeof src.elevationSource === 'string' ? src.elevationSource.toLowerCase() : null;
  if (explicitSource && ['default', 'mapterhorn', 'none', 'usgs', 'gpxz', 'kron86'].includes(explicitSource)) {
    elevationSource.value = explicitSource;
  } else {
    // Legacy fallback for shared configs that only include useUSGS/useGPXZ booleans.
    const useUSGSValue = toBooleanOrNull(src.useUSGS);
    const useGPXZValue = toBooleanOrNull(src.useGPXZ);
    const useKRON86Value = toBooleanOrNull(src.useKRON86 ?? src.useKron86);
    if (useGPXZValue === true) {
      elevationSource.value = 'gpxz';
    } else if (useKRON86Value === true) {
      elevationSource.value = 'kron86';
    } else if (useUSGSValue === true) {
      elevationSource.value = 'usgs';
    }
  }

  // (keys never come from a config: the user's own GPXZ key stays)
  // (nor the sender's GPXZ plan and limits: services/personalKeys.js)
};

const handleRunConfigFile = async (file) => {
  if (!file) return;
  try {
    await previewConfigText(await file.text());
  } catch (error) {
    console.error('Failed to load run configuration:', error);
    runConfigStatus.value = t('status.runConfigInvalidFile');
  }
};
</script>
