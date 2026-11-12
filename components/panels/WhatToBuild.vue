<template>
  <!-- What to build (step 4): quick select, the features in groups with
       switches, and (Advanced) a Fine-tuning tab for the settings that change
       how a feature is built. Rules: services/buildContent.js; state:
       composables/useBuildContent.js. -->
  <SettingCard :title="t('build.title')" :note="!hasOsmData ? t('exportPanel.ui.noOsmNote') : ''" note-tone="warn">
    <template #header>
      <div v-if="advanced" role="tablist" :aria-label="t('build.title')" class="flex rounded border border-gray-300 dark:border-gray-600 overflow-hidden text-micro">
        <button
          v-for="tab in ['features', 'tune']" :key="tab" type="button" role="tab"
          :aria-selected="contentTab === tab" @click="contentTab = tab"
          class="px-2 py-0.5 transition-colors"
          :class="contentTab === tab ? 'bg-gray-800 text-white dark:bg-gray-200 dark:text-gray-900' : 'bg-white text-gray-700 hover:bg-gray-100 dark:bg-gray-800 dark:text-gray-200 dark:hover:bg-gray-700'"
        >{{ t(`build.tab_${tab}`) }}</button>
      </div>
      <span v-else class="text-micro text-gray-500 dark:text-gray-400">{{ t(`build.preset_${basicPreset}`) }}</span>
    </template>

    <!-- Quick select (Basic: all there is) -->
    <div v-if="!advanced || contentTab === 'features'" class="space-y-1">
      <div class="flex flex-wrap gap-1" role="radiogroup" :aria-label="t('build.quickSelect')">
        <button
          v-for="p in PRESET_IDS" :key="p" type="button" role="radio"
          :aria-checked="activePreset === p" :disabled="!hasOsmData"
          @click="pickPreset(p)"
          class="px-2 py-0.5 rounded-full border text-caption transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          :class="activePreset === p
            ? 'border-brand bg-orange-50 text-orange-800 font-semibold dark:bg-orange-900/30 dark:text-orange-200'
            : 'border-gray-300 text-gray-700 hover:border-brand dark:border-gray-600 dark:text-gray-200'"
        >{{ t(`build.preset_${p}`) }}</button>
        <span v-if="advanced && activePreset === 'custom'" class="px-2 py-0.5 rounded-full border border-dashed border-gray-400 text-caption text-gray-600 dark:text-gray-300">{{ t('build.preset_custom') }}</span>
      </div>
      <p class="text-caption leading-snug text-gray-500 dark:text-gray-400">{{ t(`build.presetHint_${activePreset}`) }}</p>
    </div>

    <!-- Features (Advanced) -->
    <template v-if="advanced && contentTab === 'features'">
      <SectionToggleAll @set="setAllGroups" />
      <div class="divide-y divide-gray-100 dark:divide-gray-700/60 -mx-1">
        <div v-for="g in groups" :key="g.id" class="px-1">
          <div class="flex items-center gap-1.5 min-h-[30px]">
            <button type="button" class="flex items-center gap-1.5 flex-1 min-w-0 text-left" :aria-expanded="!!open[g.id]" @click="open[g.id] = !open[g.id]">
              <ChevronRight :size="12" class="shrink-0 text-gray-500 transition-transform" :class="open[g.id] ? 'rotate-90' : ''" />
              <span v-if="colourMap" class="w-2.5 h-2.5 rounded-sm shrink-0" :style="{ background: GROUP_COLOURS[g.id] }" />
              <span class="text-xs truncate" :class="g.onCount ? 'text-gray-800 dark:text-gray-100' : 'text-gray-400 dark:text-gray-500'">{{ t(`build.group_${g.id}`) }}</span>
              <span class="text-micro text-gray-500 dark:text-gray-400 shrink-0">{{ g.onCount === g.items.length ? t('build.allOn') : g.onCount === 0 ? t('build.off') : t('build.someOn', { n: g.onCount, of: g.items.length }) }}</span>
            </button>
            <Switch :on="g.onCount > 0" :label="t('build.groupAll', { group: t(`build.group_${g.id}`) })" :disabled="!hasOsmData" @toggle="toggleGroup(g)" />
          </div>
          <div v-if="open[g.id]" class="pb-1.5 pl-4 space-y-0.5">
            <div v-for="it in g.items" :key="it.id">
              <div class="flex items-center gap-1.5 min-h-[26px]">
                <span class="text-caption flex-1 min-w-0 truncate" :class="it.on ? 'text-gray-800 dark:text-gray-100' : 'text-gray-400 dark:text-gray-500'">{{ t(`build.item_${it.id}`) }}</span>
                <button
                  v-if="showOsmTags && it.tags.length" type="button"
                  class="text-micro text-gray-500 hover:text-brand dark:text-gray-400 underline-offset-2 hover:underline shrink-0"
                  :aria-expanded="!!tagsOpen[it.id]" @click="tagsOpen[it.id] = !tagsOpen[it.id]"
                >{{ t('build.tagsN', { n: it.tags.length }) }}</button>
                <span class="text-micro text-gray-500 dark:text-gray-400 shrink-0 tabular-nums">{{ it.detail }}</span>
                <Switch small :on="it.on" :label="t(`build.item_${it.id}`)" :disabled="!hasOsmData" @toggle="setBuilt(it.id, !it.on)" />
              </div>
              <ul v-if="showOsmTags && tagsOpen[it.id]" class="ml-2 mb-1 pl-2 border-l border-gray-200 dark:border-gray-600 space-y-0.5">
                <li v-for="tg in it.tags" :key="tg.tag" class="flex items-center gap-1.5">
                  <code class="text-micro flex-1 min-w-0 truncate" :class="it.on && tg.on ? 'text-gray-700 dark:text-gray-200' : 'text-gray-400 dark:text-gray-500 line-through'">{{ tg.tag }}</code>
                  <span class="text-micro text-gray-500 tabular-nums">{{ tg.count.toLocaleString() }}</span>
                  <Switch small :on="it.on && tg.on" :label="tg.tag" :disabled="!it.on" @toggle="setTagOn(tg.tag, !tg.on)" />
                </li>
              </ul>
            </div>
          </div>
        </div>
      </div>
      <div class="flex flex-wrap items-center gap-x-3 gap-y-1 pt-1 border-t border-gray-100 dark:border-gray-700/60">
        <label class="flex items-center gap-1.5 text-caption text-gray-600 dark:text-gray-300 cursor-pointer">
          <Switch small :on="showOsmTags" :label="t('build.showTags')" @toggle="showOsmTags = !showOsmTags" />{{ t('build.showTags') }}
        </label>
        <label class="flex items-center gap-1.5 text-caption text-gray-600 dark:text-gray-300 cursor-pointer">
          <Switch small :on="colourMap" :label="t('build.colourMap')" @toggle="colourMap = !colourMap" />{{ t('build.colourMap') }}
        </label>
        <span v-if="excludeTags.length" class="text-micro text-gray-500 dark:text-gray-400">{{ t('build.tagsLeftOut', { n: excludeTags.length }) }}
          <button type="button" class="underline hover:text-brand" @click="excludeTags = []">{{ t('build.keepAllTags') }}</button></span>
      </div>
      <!-- the features are drawn on the 2D preview: said to someone who has
           them switched on and is looking at another view, with the way there -->
      <p v-if="colourMap && store.viewMode !== 'preview2d'" class="flex flex-wrap items-center gap-x-2 gap-y-1 text-caption leading-snug text-gray-600 dark:text-gray-300" role="status">
        <span>{{ t('build.colourMapIn3d') }}</span>
        <button type="button" class="font-semibold text-brand hover:underline" @click="store.viewMode = 'preview2d'">{{ t('build.show2dMap') }}</button>
      </p>
    </template>

    <!-- Fine-tuning (Advanced) -->
    <template v-if="advanced && contentTab === 'tune'">
      <section class="space-y-1.5" :class="treesBuilt ? '' : 'opacity-50'">
        <h4 class="text-micro font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">{{ t('build.group_green') }}</h4>
        <div class="flex items-center justify-between gap-2">
          <span class="text-xs font-medium text-gray-800 dark:text-gray-100">{{ t('exportPanel.ui.forestDensity') }}</span>
          <span v-if="!treesBuilt" class="text-micro text-gray-500">{{ t('build.offInFeatures', { what: t('build.item_trees') }) }}</span>
        </div>
        <div role="radiogroup" :aria-label="t('exportPanel.ui.forestDensity')" class="grid grid-cols-4 rounded border border-gray-300 dark:border-gray-600 overflow-hidden">
          <button
            v-for="k in FOREST_DENSITY_KEYS" :key="k" type="button" role="radio"
            :aria-checked="forestDensity === k" :disabled="!treesBuilt || !hasOsmData"
            @click="$emit('update:forestDensity', k)"
            class="py-1 text-caption border-r last:border-r-0 border-gray-200 dark:border-gray-600 transition-colors disabled:cursor-not-allowed"
            :class="forestDensity === k ? 'bg-brand text-white font-semibold' : 'bg-white text-gray-700 hover:bg-gray-50 dark:bg-gray-800 dark:text-gray-200 dark:hover:bg-gray-700'"
          >{{ t(`exportPanel.ui.forestDensity_${k}`) }}</button>
        </div>
        <p class="text-caption leading-snug text-gray-500 dark:text-gray-400">{{ t(`exportPanel.ui.forestDensityHint_${forestDensity}`) }}</p>
        <!-- Which trees this area gets (services/treeTable.js): shown, not yet chosen -->
        <div v-if="trees && trees.rows.length" class="space-y-1 pt-1" data-testid="tree-table">
          <div class="flex items-center justify-between gap-2">
            <span class="text-xs font-medium text-gray-800 dark:text-gray-100">{{ t('build.trees.title') }}</span>
            <!-- every kind back to Keep, every model back on: what the data picked -->
            <button
              v-if="treeChoicesMade" type="button" data-testid="tree-reset"
              class="text-micro text-brand hover:underline" :title="t('build.trees.resetHint')"
              @click="resetTreeChoices"
            >{{ t('build.trees.reset') }}</button>
          </div>
          <p class="text-caption leading-snug text-gray-500 dark:text-gray-400">
            {{ trees.source === 'records' ? t('build.trees.fromRecords', { count: trees.records }) : t('build.trees.fromClimate') }}
          </p>
          <ul class="rounded border border-gray-200 dark:border-gray-700 divide-y divide-gray-200 dark:divide-gray-700">
            <li v-for="row in trees.rows" :key="row.group" class="px-2 py-1" :class="row.off || row.swappedTo ? 'opacity-70' : ''" :data-tree-kind="row.group">
              <div class="flex items-center justify-between gap-2 text-caption">
                <span class="font-medium text-gray-800 dark:text-gray-100 truncate">{{ treeGroupName(row.group) }}</span>
                <span class="flex items-center gap-2 shrink-0">
                  <span v-if="!row.off && !row.swappedTo" class="tabular-nums text-gray-600 dark:text-gray-300">{{ treeShare(row.share) }}</span>
                  <!-- keep the kind, leave it out (its trees become the others), or plant another kind in its place -->
                  <select
                    :value="row.off ? 'off' : row.swappedTo ? `to:${row.swappedTo}` : 'keep'"
                    :disabled="!treesBuilt" :aria-label="t('build.trees.choiceFor', { kind: treeGroupName(row.group) })"
                    class="max-w-[9.5rem] rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-micro py-0.5 pl-1 pr-5"
                    @change="setTreeChoice(row.group, $event.target.value)"
                  >
                    <option value="keep">{{ t('build.trees.keepIt') }}</option>
                    <option value="off" :disabled="!row.off && !row.swappedTo && treeKindsOn <= 1">{{ t('build.trees.leaveOut') }}</option>
                    <optgroup :label="t('build.trees.replaceWith')">
                      <option v-for="k in TREE_KIND_IDS.filter((id) => id !== row.group)" :key="k" :value="`to:${k}`">{{ treeGroupName(k) }}</option>
                    </optgroup>
                  </select>
                </span>
              </div>
              <!-- its models, each to switch off (the last one stays) -->
              <div v-if="!row.off && !row.swappedTo" class="mt-0.5 flex flex-wrap gap-1">
                <button
                  v-for="m in row.models" :key="m.type" type="button" :disabled="!treesBuilt || (!m.off && row.models.filter((x) => !x.off).length <= 1)"
                  :aria-pressed="!m.off" :title="m.off ? t('build.trees.modelOff') : t('build.trees.modelOn')" :data-tree-model="m.type"
                  class="px-1 rounded border text-micro leading-snug transition-colors disabled:cursor-not-allowed"
                  :class="m.off ? 'border-gray-200 dark:border-gray-700 text-gray-400 line-through' : 'border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:border-brand'"
                  @click="toggleTreeModel(m.type)"
                >{{ treeModelLabel(m.type) }}</button>
              </div>
              <div v-else-if="row.swappedTo" class="text-micro leading-snug text-gray-500 dark:text-gray-400">{{ t('build.trees.plantedAs', { kind: treeGroupName(row.swappedTo) }) }}</div>
              <!-- (a kind others were swapped into says so: its share is not only its own) -->
              <div v-if="!row.off && !row.swappedTo && treeTakesIn(row.group).length" class="mt-0.5 text-micro leading-snug text-amber-700 dark:text-amber-300" data-tree-takes-in>{{ t('build.trees.takesIn', { kinds: treeTakesIn(row.group).map(treeGroupName).join(', ') }) }}</div>
            </li>
          </ul>
          <p class="text-micro leading-snug text-gray-500 dark:text-gray-400">{{ t('build.trees.switchHint') }} {{ t('build.trees.note') }}</p>
        </div>
      </section>
      <section class="space-y-1.5 pt-1" :class="roadsBuilt ? '' : 'opacity-50'">
        <h4 class="text-micro font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">{{ t('build.group_roads') }}</h4>
        <div class="flex items-start gap-2">
          <div class="flex-1 min-w-0">
            <div class="text-xs font-medium text-gray-800 dark:text-gray-100">{{ t('exportPanel.ui.assumeParking') }}</div>
            <p class="text-caption leading-snug text-gray-500 dark:text-gray-400">{{ roadsBuilt ? t('exportPanel.ui.assumeParkingHint') : t('build.offInFeatures', { what: t('build.item_roadSurfaces') }) }}</p>
          </div>
          <Switch :on="assumeParking && roadsBuilt" :label="t('exportPanel.ui.assumeParking')" :disabled="!roadsBuilt || !hasOsmData" @toggle="$emit('update:assumeParking', !assumeParking)" />
        </div>
        <!-- sidewalks as flat decals on the ground instead of raised meshes (exportBeamNGLevel.js sidewalkStyle) -->
        <div class="flex items-start gap-2">
          <div class="flex-1 min-w-0">
            <div class="text-xs font-medium text-gray-800 dark:text-gray-100">{{ t('exportPanel.ui.decalSidewalks') }}</div>
            <p class="text-caption leading-snug text-gray-500 dark:text-gray-400">{{ roadsBuilt ? t('exportPanel.ui.decalSidewalksHint') : t('build.offInFeatures', { what: t('build.item_roadSurfaces') }) }}</p>
          </div>
          <Switch :on="decalSidewalks && roadsBuilt" :label="t('exportPanel.ui.decalSidewalks')" :disabled="!roadsBuilt || !hasOsmData" @toggle="$emit('update:decalSidewalks', !decalSidewalks)" />
        </div>
        <!-- the raised sidewalks' height over the road (beamngSidewalks.js CURB_HEIGHTS_M); nothing to set for decals -->
        <div :class="decalSidewalks ? 'opacity-50' : ''">
          <span class="text-xs font-medium text-gray-800 dark:text-gray-100">{{ t('exportPanel.ui.curbHeight') }}</span>
          <div role="radiogroup" :aria-label="t('exportPanel.ui.curbHeight')" class="mt-1 grid grid-cols-3 rounded border border-gray-300 dark:border-gray-600 overflow-hidden">
            <button
              v-for="k in CURB_HEIGHT_KEYS" :key="k" type="button" role="radio"
              :aria-checked="curbHeight === k" :disabled="!roadsBuilt || !hasOsmData || decalSidewalks"
              @click="$emit('update:curbHeight', k)"
              class="py-1 text-caption border-r last:border-r-0 border-gray-200 dark:border-gray-600 transition-colors disabled:cursor-not-allowed"
              :class="curbHeight === k ? 'bg-brand text-white font-semibold' : 'bg-white text-gray-700 hover:bg-gray-50 dark:bg-gray-800 dark:text-gray-200 dark:hover:bg-gray-700'"
            >{{ t(`exportPanel.ui.curbHeight_${k}`) }}</button>
          </div>
          <p class="mt-1 text-caption leading-snug text-gray-500 dark:text-gray-400">{{ t('exportPanel.ui.curbHeightHint') }}</p>
        </div>
      </section>
      <section class="space-y-1.5 pt-1" :class="bridgesBuilt ? '' : 'opacity-50'">
        <h4 class="text-micro font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">{{ t('build.group_structures') }}</h4>
        <div class="flex items-start gap-2">
          <div class="flex-1 min-w-0">
            <div class="text-xs font-medium text-gray-800 dark:text-gray-100">{{ t('exportPanel.lidarDecks') }}</div>
            <p class="text-caption leading-snug text-gray-500 dark:text-gray-400">{{ bridgesBuilt ? t('exportPanel.ui.lidarDecksHint') : t('build.offInFeatures', { what: t('build.item_bridges') }) }}</p>
          </div>
          <Switch :on="lidarDecks && bridgesBuilt" :label="t('exportPanel.lidarDecks')" :disabled="!bridgesBuilt || !hasOsmData" @toggle="$emit('update:lidarDecks', !lidarDecks)" />
        </div>
      </section>
      <section class="space-y-1.5 pt-1">
        <h4 class="text-micro font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">{{ t('build.limits') }}</h4>
        <div class="flex items-start gap-2">
          <div class="flex-1 min-w-0">
            <div class="text-xs font-medium text-gray-800 dark:text-gray-100">{{ t('exportPanel.ui.buildEverything') }}</div>
            <p class="text-caption leading-snug text-gray-500 dark:text-gray-400">{{ t('exportPanel.ui.buildEverythingHint') }}</p>
          </div>
          <Switch :on="!safeCaps" :label="t('exportPanel.ui.buildEverything')" @toggle="$emit('update:safeCaps', !safeCaps)" />
        </div>
      </section>
    </template>

    <p v-if="advanced" class="text-micro text-gray-500 dark:text-gray-400">{{ footer }}</p>
  </SettingCard>
</template>

<script setup>
import { computed, reactive, defineComponent, h, toRaw } from 'vue';
import { treeTable, treeModelLabel, sampleElevations } from '../../services/treeTable.js';
import { TREE_KIND_IDS } from '../../services/beamngTrees.js';
import { useI18n } from 'vue-i18n';
import { ChevronRight } from 'lucide-vue-next';
import SettingCard from '../base/SettingCard.vue';
import SectionToggleAll from '../base/SectionToggleAll.vue';
import { useMainStore } from '../../stores/mainStore';
import { CONTENT_GROUPS, PRESET_IDS, osmTagCounts } from '../../services/buildContent.js';
import { GROUP_COLOURS } from '../../services/buildContentColours.js';
import {
  advancedOff, advancedPreset, basicPreset, excludeTags, showOsmTags, colourMap, contentTab,
  setBuilt, applyPreset, setTagOn, isBuilt,
} from '../../composables/useBuildContent.js';

const props = defineProps({
  advanced: { type: Boolean, default: false },
  hasOsmData: { type: Boolean, default: false },
  osmFeatures: { type: Array, default: () => [] },
  forestDensity: { type: String, default: 'normal' },
  lidarDecks: { type: Boolean, default: true },
  safeCaps: { type: Boolean, default: true },
  assumeParking: { type: Boolean, default: true },
  decalSidewalks: { type: Boolean, default: false },
  curbHeight: { type: String, default: 'standard' },
  treeKindsOff: { type: Array, default: () => [] },
  treeSwaps: { type: Array, default: () => [] },
  treeModelsOff: { type: Array, default: () => [] },
});
const CURB_HEIGHT_KEYS = ['standard', 'low', 'flush'];
const emit = defineEmits(['update:forestDensity', 'update:lidarDecks', 'update:safeCaps', 'update:assumeParking', 'update:decalSidewalks', 'update:curbHeight', 'update:treeKindsOff', 'update:treeSwaps', 'update:treeModelsOff']);
const { t, te } = useI18n();
const store = useMainStore();
// (a feature's small hint, where it has one: asking for a missing key logs a warning)
const detailOf = (id) => { const k = `build.detail_${id}`; return te(k) || te(k, 'en') ? t(k) : ''; };
const FOREST_DENSITY_KEYS = ['light', 'normal', 'dense', 'veryDense'];
// (which trees this area gets: the export's own rules, counted; services/treeTable.js)
const trees = computed(() => {
  if (contentTab.value !== 'tune') return null;
  const td = toRaw(store.terrainData);
  const b = td?.bounds;
  if (!b || !props.hasOsmData) return null;
  return treeTable({
    lat: (b.north + b.south) / 2, lon: (b.east + b.west) / 2,
    mix: td.treeSpeciesMix ?? null, elevations: sampleElevations(td.heightMap), off: props.treeKindsOff, swaps: props.treeSwaps, modelsOff: props.treeModelsOff,
  });
});
const treeGroupName = (g) => { const k = `build.trees.group_${g}`; return te(k) || te(k, 'en') ? t(k) : g.replace(/_/g, ' '); };
const treeKindsOn = computed(() => (trees.value?.rows || []).filter((r) => !r.off && !r.swappedTo).length);
// (keep / 'off' / 'to:<kind>' for one kind: a kind is in one list at most)
const setTreeChoice = (group, choice) => {
  const off = new Set(props.treeKindsOff); off.delete(group);
  const swaps = props.treeSwaps.filter((x) => !String(x).startsWith(`${group}>`));
  if (choice === 'off') off.add(group);
  else if (choice.startsWith('to:')) swaps.push(`${group}>${choice.slice(3)}`);
  emit('update:treeKindsOff', [...off]);
  emit('update:treeSwaps', swaps);
};
const treeChoicesMade = computed(() => props.treeKindsOff.length + props.treeSwaps.length + props.treeModelsOff.length > 0);
const resetTreeChoices = () => { emit('update:treeKindsOff', []); emit('update:treeSwaps', []); emit('update:treeModelsOff', []); };
// (the kinds swapped into this one)
const treeTakesIn = (group) => props.treeSwaps.map((x) => String(x).split('>')).filter(([, to]) => to === group).map(([from]) => from);
const toggleTreeModel = (type) => {
  const off = new Set(props.treeModelsOff);
  if (off.has(type)) off.delete(type); else off.add(type);
  emit('update:treeModelsOff', [...off]);
};
const treeShare = (s) => (s < 0.01 ? '<1%' : `${Math.round(s * 100)}%`);

// A small switch (role="switch"), the panel's one on/off control here.
const Switch = defineComponent({
  props: { on: Boolean, small: Boolean, disabled: Boolean, label: String },
  emits: ['toggle'],
  setup(p, { emit }) {
    return () => {
      const w = p.small ? 28 : 34; const ht = p.small ? 16 : 20; const k = ht - 6;
      return h('button', {
        type: 'button', role: 'switch', 'aria-checked': String(!!p.on), 'aria-label': p.label, disabled: p.disabled,
        class: ['relative shrink-0 rounded-full transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-brand disabled:cursor-not-allowed disabled:opacity-50',
          p.on ? 'bg-brand' : 'bg-gray-400 dark:bg-gray-600'],
        style: { width: `${w}px`, height: `${ht}px` },
        onClick: (e) => { e.preventDefault(); if (!p.disabled) emit('toggle'); },
      }, [h('span', { class: 'absolute top-[3px] rounded-full bg-white transition-all', style: { width: `${k}px`, height: `${k}px`, left: p.on ? `${w - k - 3}px` : '3px' } })]);
    };
  },
});

const open = reactive({});
const tagsOpen = reactive({});
// (Expand all / Collapse all: every group; collapsing closes the tag lists under them too)
const setAllGroups = (on) => { for (const g of CONTENT_GROUPS) open[g.id] = on; if (!on) for (const k of Object.keys(tagsOpen)) tagsOpen[k] = false; };
const activePreset = computed(() => (props.advanced ? advancedPreset.value : basicPreset.value));
const pickPreset = (p) => { if (props.advanced) applyPreset(p); else basicPreset.value = p; };

// (counts of the OSM tags each feature covers, in this area)
const tagCounts = computed(() => osmTagCounts(props.osmFeatures));
const groups = computed(() => {
  const off = new Set(advancedOff.value);
  const left = new Set(excludeTags.value);
  return CONTENT_GROUPS.map((g) => {
    const items = g.items.map((it) => {
      const tags = (tagCounts.value[it.id] || []).map((x) => ({ ...x, on: !left.has(x.tag) }));
      const total = tags.reduce((n, x) => n + x.count, 0);
      return { id: it.id, on: !off.has(it.id), tags, detail: total ? total.toLocaleString() : detailOf(it.id) };
    });
    return { id: g.id, items, onCount: items.filter((i) => i.on).length };
  });
});
const toggleGroup = (g) => { const on = g.onCount === 0; for (const it of g.items) setBuilt(it.id, on); };

const treesBuilt = computed(() => isBuilt(true, 'trees'));
const bridgesBuilt = computed(() => isBuilt(true, 'bridges'));
const roadsBuilt = computed(() => isBuilt(true, 'roadSurfaces'));
const footer = computed(() => {
  const all = groups.value.flatMap((g) => g.items);
  const on = all.filter((i) => i.on).length;
  const tuned = [
    t(`exportPanel.ui.forestDensity_${props.forestDensity}`).toLowerCase() + ' ' + t('build.forest'),
    props.lidarDecks ? t('build.measuredDecks') : null,
    props.safeCaps ? t('build.capped') : t('build.noCaps'),
    props.assumeParking ? null : t('build.noAssumedParking'),
    props.decalSidewalks ? t('build.decalSidewalks') : props.curbHeight !== 'standard' ? `${t('exportPanel.ui.curbHeight').toLowerCase()}: ${t(`exportPanel.ui.curbHeight_${props.curbHeight}`).toLowerCase()}` : null,
  ].filter(Boolean).join(' · ');
  return contentTab.value === 'features'
    ? t('build.footerFeatures', { on, of: all.length, tuned })
    : t('build.footerTune', { on, of: all.length });
});
</script>
