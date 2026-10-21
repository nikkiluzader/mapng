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
            <div class="flex items-center gap-1 min-w-0">
              <select v-model="beamNGBaseTexture" :class="SELECT_XS" @change="handleBeamNGBaseTextureChange">
                <option value="none">{{ t('exportPanel.none') }}</option>
                <option value="hybrid" :disabled="!terrainData?.hybridTextureUrl && !terrainData?.hybridTextureCanvas">{{ t('exportPanel.satelliteHybrid') }}</option>
                <option value="satellite" :disabled="!terrainData?.satelliteTextureUrl">{{ t('exportPanel.satellite') }}</option>
                <option v-if="hasOsmData" value="osm" :disabled="!terrainData?.osmTextureUrl">{{ t('exportPanel.osm') }}</option>
                <option v-if="hasPaintedTexture" value="painted">{{ t('exportPanel.touchedUp') }}</option>
              </select>
              <button
                @click="openTexturePaint"
                :disabled="!canPaintTexture || isPreparingTexturePaint"
                :title="canPaintTexture ? t('exportPanel.texturePaint.open') : t('exportPanel.texturePaint.needsTexture')"
                :class="['p-1 rounded border transition-colors shrink-0',
                  hasPaintedTexture
                    ? 'border-[#FF6600] text-[#FF6600] bg-orange-50 dark:bg-orange-900/20 hover:bg-orange-100 dark:hover:bg-orange-900/40'
                    : 'border-gray-300 dark:border-gray-600 text-gray-500 dark:text-gray-400 hover:text-[#FF6600] hover:border-[#FF6600]',
                  'disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:text-gray-500 disabled:hover:border-gray-300 dark:disabled:hover:border-gray-600']"
              >
                <Loader2 v-if="isPreparingTexturePaint" :size="11" class="animate-spin" />
                <Paintbrush v-else :size="11" />
              </button>
            </div>
          </div>

          <!-- PBR terrain materials source selector -->
          <div class="flex items-center justify-between gap-2 px-0.5">
            <span class="text-[10px] text-gray-500 dark:text-gray-400 shrink-0">{{ t('exportPanel.pbrMaterials') }}</span>
            <input type="checkbox" v-model="beamNGPbrSource" true-value="osm" false-value="none" :disabled="!hasOsmData" :class="CHECKBOX" />
          </div>

          <!-- Road export mode selector -->
          <div class="flex items-center justify-between gap-2 px-0.5">
            <span class="text-[10px] text-gray-500 dark:text-gray-400 shrink-0">{{ t('exportPanel.roads') }}</span>
            <input type="checkbox" v-model="beamNGRoadType" true-value="decal" false-value="none" :disabled="!hasOsmData" :class="CHECKBOX" />
          </div>

          <div class="flex items-center justify-between gap-2 px-0.5">
            <span class="text-[10px] text-gray-500 dark:text-gray-400 shrink-0">{{ t('exportPanel.biome') }}</span>
            <select v-model="beamNGBiomeId" :class="[SELECT_XS, 'min-w-0']">
              <option value="">{{ t('exportPanel.selectLevel') }}</option>
              <option v-for="biome in beamNGBiomeOptions" :key="biome.id" :value="biome.id">
                {{ biome.label }}
              </option>
            </select>
          </div>

          <!-- Surrounding terrain backdrop source -->
          <div class="flex items-center justify-between gap-2 px-0.5">
            <span class="text-[10px] text-gray-500 dark:text-gray-400 shrink-0">{{ t('exportPanel.includeBackdrop') }}</span>
            <select
              v-model="beamNGBackdropSource"
              :class="SELECT_XS"
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
            <span class="text-[10px] text-gray-500 dark:text-gray-400 shrink-0">{{ t('exportPanel.seaLevelOffset') }}</span>
            <div class="flex items-center gap-1">
              <input
                :value="terrainData?.flat ? -1 : beamNGSeaLevelOffset"
                @input="beamNGSeaLevelOffset = Number($event.target.value)"
                :disabled="terrainData?.flat"
                type="number"
                step="1"
                min="-2000"
                max="2000"
                class="w-20 text-[9px] bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded px-1.5 py-0.5 text-gray-600 dark:text-gray-300 disabled:opacity-50 disabled:cursor-not-allowed"
              />
              <span class="text-[9px] text-gray-500 dark:text-gray-400">m</span>
            </div>
          </div>

          <div class="px-2 py-1.5 rounded border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/20">
            <p class="text-[9px] text-amber-800 dark:text-amber-300 leading-snug">
              {{ t('exportPanel.communityQualityNotice') }}
            </p>
          </div>

          <div v-if="beamNGBiomeRequired && !beamNGBiomeId" class="px-0.5 text-[9px] text-amber-600 dark:text-amber-400">
            {{ t('exportPanel.chooseBiome') }}
          </div>

          <!-- Export button -->
          <button
            @click="handleBeamNGLevelExport"
            :disabled="isAnyExporting || (beamNGBiomeRequired && !beamNGBiomeId)"
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
                href="https://github.com/alexkleinwaechter/BeamNG_LevelCleanUp/releases/latest"
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
import { ref, computed, watch, nextTick, onUnmounted } from 'vue';
import { useI18n } from 'vue-i18n';
import {
  Download, ChevronDown, Loader2, Trees, FileCode, FileJson, PackageOpen, Paintbrush
} from 'lucide-vue-next';
import TexturePaintModal from '../modals/TexturePaintModal.vue';
import { buildRunConfiguration as buildRunConfigurationBase } from '../../services/runConfiguration';
import { exportGeoTiff } from '../../services/exportGeoTiff';
import { buildCommonTraceMetadata, downloadJsonFile } from '../../services/traceability';
import { exportBeamNGLevel } from '../../services/exportBeamNGLevel';
import { CHECKBOX, SELECT_XS } from '../base/controlStyles.js';
import { prepareCroppedTerrainData } from '../../services/cropTerrain';
import { getBeamNGBiomeOptions } from '../../services/beamngBiomeCatalog.js';
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
});

const emit = defineEmits(['fetchOsm', 'exportSuccess']);
const BEAMNG_EXPORT_UI_LOG = '[BeamNG Export UI]';

// Export states
const isExportingGeoTIFF = ref(false);
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
    painted: !!terrainData?.paintedTextureBlob,
    hybrid: !!terrainData?.hybridTextureUrl || !!terrainData?.hybridTextureCanvas,
    satellite: !!terrainData?.satelliteTextureUrl,
    osm: !!terrainData?.osmTextureUrl,
    none: true,
  };

  if (availableTextures[preferred]) return preferred;
  // Closest available look, never "none" while an image exists.
  return Object.keys(availableTextures).find((key) => key !== 'painted' && availableTextures[key]) || preferred;
};

// The user's base texture choice is remembered across areas and reloads; the
// selected value falls back per terrain when that texture isn't available
// (e.g. 'painted' only exists after a touch-up).
const beamNGBaseTexturePreference = ref(localStorage.getItem('mapng_beamNGBaseTexture') || 'osm');
const beamNGBaseTexture = ref(resolveBeamNGBaseTexture(props.terrainData, beamNGBaseTexturePreference.value));
const handleBeamNGBaseTextureChange = () => {
  beamNGBaseTexturePreference.value = beamNGBaseTexture.value;
  localStorage.setItem('mapng_beamNGBaseTexture', beamNGBaseTexture.value);
};
const legacyIncludeBackdrop = localStorage.getItem('mapng_beamNGIncludeBackdrop');
const beamNGBackdropSource = ref(
  localStorage.getItem('mapng_beamNGBackdropSource')
  || (legacyIncludeBackdrop === 'true' ? 'global30m' : 'off')
);
const beamNGSeaLevelOffset = ref(normalizeBeamNGSeaLevelOffset(localStorage.getItem('mapng_beamNGSeaLevelOffset')));
// Migrate legacy boolean mesh road setting if it exists
// DecalRoads are the only road system; earlier choices (Road Architect, Mesh
// Roads, the old "spline" name) all mean "roads on". Only 'none' stays off.
const beamNGRoadType = ref(localStorage.getItem('mapng_beamNGRoadType') === 'none' ? 'none' : 'decal');
const beamNGBiomeOptions = getBeamNGBiomeOptions();
const persistedBeamNGBiome = localStorage.getItem('mapng_beamNGBiomeId') || '';
const beamNGBiomeId = ref(beamNGBiomeOptions.some((biome) => biome.id === persistedBeamNGBiome) ? persistedBeamNGBiome : '');
const beamNGLevelName = ref('');
const beamNGSuggestedLevelName = ref('');
const beamNGLevelNameTouched = ref(false);
let beamNGLevelNameRequestId = 0;
const hasOsmData = computed(() => Array.isArray(props.terrainData?.osmFeatures) && props.terrainData.osmFeatures.length > 0);
const isCustomUploadTerrain = computed(() => !!props.terrainData?.elevationUnitApplied);
const beamNGBiomeRequired = computed(() => hasOsmData.value);
const canUseGpxzBackdrop = computed(() => props.elevationSource === 'gpxz' && !!props.gpxzApiKey);
const beamNGPendingDownloadUrl = ref('');
const beamNGPendingDownloadName = ref('');

// ─── Base texture touch-up painting ─────────────────────────────────
const showTexturePaintModal = ref(false);
const isPreparingTexturePaint = ref(false);
const texturePaintSourceUrl = ref('');
const texturePaintResumeUrl = ref('');
const texturePaintSourceKind = ref('hybrid');
let texturePaintObjectUrls = [];

const hasPaintedTexture = computed(() => !!props.terrainData?.paintedTextureBlob);

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
};

const isAnyExporting = computed(() => (
  isExportingGeoTIFF.value ||
  isExportingOSM.value ||
  isExportingBeamNGLevel.value
));

// Collapsible section states
const showExports = ref(localStorage.getItem('mapng_showExports') !== 'false');
const showExportBeamNG = ref(localStorage.getItem('mapng_showExportBeamNG') !== 'false');
// Migrate legacy boolean value from old 'mapng_beamNGGeneratePbr' key.
const _legacyPbr = localStorage.getItem('mapng_beamNGGeneratePbr');
const _defaultPbrSource = localStorage.getItem('mapng_beamNGPbrSource')
  ?? (_legacyPbr === 'false' ? 'none' : 'osm');
const beamNGPbrSource = ref(_defaultPbrSource);
const showExportGeo = ref(localStorage.getItem('mapng_showExportGeo') !== 'false');

watch(showExports, (v) => localStorage.setItem('mapng_showExports', String(v)));
watch(showExportBeamNG, (v) => localStorage.setItem('mapng_showExportBeamNG', String(v)));
watch(beamNGPbrSource, (v) => localStorage.setItem('mapng_beamNGPbrSource', v));
watch(beamNGBackdropSource, (v) => localStorage.setItem('mapng_beamNGBackdropSource', v));
watch(beamNGSeaLevelOffset, (v) => {
  const normalized = normalizeBeamNGSeaLevelOffset(v);
  if (normalized !== v) {
    beamNGSeaLevelOffset.value = normalized;
    return;
  }
  localStorage.setItem('mapng_beamNGSeaLevelOffset', String(normalized));
});
watch(beamNGRoadType, (v) => localStorage.setItem('mapng_beamNGRoadType', v));
watch(beamNGBiomeId, (v) => localStorage.setItem('mapng_beamNGBiomeId', v));
watch(showExportGeo, (v) => localStorage.setItem('mapng_showExportGeo', String(v)));

onUnmounted(() => {
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
    // Custom elevation uploads default to the global 30 m backdrop rather than
    // 'off', so an uploaded map gets surrounding terrain out of the box. Users
    // can still switch it to USGS/GPXZ or turn it back off.
    if (isCustom && beamNGBackdropSource.value === 'off') {
      beamNGBackdropSource.value = 'global30m';
    }
    if (beamNGBackdropSource.value === 'gpxz' && !gpxzAllowed) {
      beamNGBackdropSource.value = 'global30m';
    }
  },
  { immediate: true }
);

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

const downloadMetadataSidecar = (exportFilename, metadata) => {
  if (!ENABLE_METADATA_SIDECARS) return;
  const baseName = exportFilename.replace(/\.[^.]+$/, '');
  downloadJsonFile(metadata, `${baseName}.metadata.json`);
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
  if (beamNGBiomeRequired.value && !beamNGBiomeId.value) {
    console.warn(`${BEAMNG_EXPORT_UI_LOG} Aborting: biome is required but missing.`);
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

    let effectiveBaseTexture = beamNGBaseTexture.value;
    if (effectiveBaseTexture === 'painted' && !td?.paintedTextureBlob) {
      // Painted data didn't survive terrain preparation; fall back to its source.
      effectiveBaseTexture = resolveBeamNGBaseTexture(td, td?.paintedTextureSource || 'hybrid');
    }
    if (effectiveBaseTexture !== 'none' && effectiveBaseTexture !== 'painted' && !hasOsmData.value) {
      effectiveBaseTexture = resolveBeamNGBaseTexture(td, 'hybrid');
    }
    const effectivePbrSource = hasOsmData.value ? beamNGPbrSource.value : 'none';
    const effectiveRoadType = hasOsmData.value ? beamNGRoadType.value : 'none';
    // Custom elevation uploads can now include the surrounding backdrop too: it
    // is fetched from the chosen external source (global 30 m / USGS 1 m / GPXZ)
    // around the upload's geographic bounds and scaled by the processing
    // resolution, exactly like a standard export.
    const effectiveBackdropSource = beamNGBackdropSource.value === 'gpxz' && !canUseGpxzBackdrop.value
      ? 'global30m'
      : beamNGBackdropSource.value;
    const effectiveIncludeBackdrop = effectiveBackdropSource !== 'off';
    // Buildings, trees, rocks and water always come with the level when OSM
    // data exists. No terrain foundations: buildings carry their own.
    const effectiveIncludeBuildings = hasOsmData.value;
    const effectiveApplyFoundations = false;
    const effectiveIncludeWater = hasOsmData.value;
    // Flat terrain sits at height 0; place the water plane just below ground
    // (−1 m) so it doesn't flood the whole level. Matches the 3D preview default.
    const effectiveSeaLevelOffset = props.terrainData?.flat
      ? -1
      : normalizeBeamNGSeaLevelOffset(beamNGSeaLevelOffset.value);
    const effectiveIncludeTrees = hasOsmData.value;
    const effectiveIncludeRocks = hasOsmData.value;
    const effectiveBackdropGpxzApiKey = effectiveBackdropSource === 'gpxz' ? String(props.gpxzApiKey || '') : '';

    const effectiveBiomeId = beamNGBiomeId.value || beamNGBiomeOptions[0]?.id;

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
      biomeId: effectiveBiomeId,
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
      biomeId: effectiveBiomeId,
      levelName: beamNGLevelName.value.trim(),
      elevationSource: props.elevationSource,
      requestedResolution: props.resolution,
      requestedProcessingMetersPerPixel: resolveProcessingMetersPerPixel(td),
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
    // Message inline: copied console logs collapse the object to "Object".
    console.error(`${BEAMNG_EXPORT_UI_LOG} Failed to export BeamNG level: ${error?.name || 'Error'}: ${error?.message || error}`, {
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
</script>
