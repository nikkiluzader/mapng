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
            ? 'border-brand bg-brand-50/60 text-brand-800 font-semibold dark:bg-brand/15 dark:text-brand-200'
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
            <BaseSwitch :on="g.onCount > 0" :label="t('build.groupAll', { group: t(`build.group_${g.id}`) })" :disabled="!hasOsmData" @toggle="toggleGroup(g)" />
          </div>
          <div v-if="open[g.id]" class="pb-1.5 pl-4 space-y-0.5">
            <div v-for="it in g.items" :key="it.id">
              <div class="flex items-center gap-1.5 min-h-[26px]">
                <span class="text-caption min-w-0 truncate" :class="it.on ? 'text-gray-800 dark:text-gray-100' : 'text-gray-400 dark:text-gray-500'">{{ t(`build.item_${it.id}`) }}</span>
                <button
                  v-if="showOsmTags && it.tags.length" type="button"
                  class="text-micro text-gray-500 hover:text-brand dark:text-gray-400 underline-offset-2 hover:underline shrink-0"
                  :aria-expanded="!!tagsOpen[it.id]" @click="tagsOpen[it.id] = !tagsOpen[it.id]"
                >{{ t('build.tagsN', { n: it.tags.length }) }}</button>
                <!-- (how many the area has, then the game models used for them: "6 in this area - 2 models used". The
                     models, with photos, only where the site serves them: useAssetThumbs.js) -->
                <span v-if="it.detail || itemModels[it.id]?.length" class="text-micro text-gray-400 dark:text-gray-500 shrink-0" aria-hidden="true">-</span>
                <span class="text-micro text-gray-500 dark:text-gray-400 shrink-0 tabular-nums" data-testid="item-detail">{{ it.count ? t('build.inThisArea', { n: it.detail }) : it.detail }}</span>
                <template v-if="itemModels[it.id]?.length">
                  <span v-if="it.detail" class="text-micro text-gray-400 dark:text-gray-500 shrink-0" aria-hidden="true">-</span>
                  <button
                    type="button" data-testid="item-models"
                    class="text-micro text-gray-500 hover:text-brand dark:text-gray-400 underline-offset-2 hover:underline shrink-0"
                    :aria-expanded="!!modelsOpen[it.id]" @click="modelsOpen[it.id] = !modelsOpen[it.id]"
                  >{{ t('build.modelsN', { n: itemModels[it.id].length }, itemModels[it.id].length) }}</button>
                </template>
                <span class="flex-1" />
                <BaseSwitch size="sm" :on="it.on" :label="t(`build.item_${it.id}`)" :disabled="!hasOsmData" @toggle="setBuilt(it.id, !it.on)" />
              </div>
              <div v-if="itemModels[it.id]?.length && modelsOpen[it.id]" class="ml-2 mb-1.5 pl-2 border-l border-gray-200 dark:border-gray-600" data-testid="item-model-strip">
                <ul class="flex flex-wrap gap-1.5">
                  <li v-for="m in itemModels[it.id].slice(0, MODEL_STRIP_MAX)" :key="m.shape" class="w-[72px]">
                    <!-- (the whole photo beside the pointer, on hover or keyboard focus: modelPeek below) -->
                    <img
                      :src="thumbUrl(m)" :alt="m.is || m.name" loading="lazy" decoding="async" width="72" height="54" tabindex="0"
                      @mouseenter="peekAt(m, $event)" @mouseleave="modelPeek = null" @focus="peekAt(m, $event)" @blur="modelPeek = null"
                      class="w-[72px] h-[54px] object-cover rounded border bg-gray-200 dark:bg-gray-700"
                      :class="m.used ? 'border-brand' : 'border-gray-200 dark:border-gray-600 opacity-80'"
                    />
                    <div class="text-micro leading-tight truncate text-gray-600 dark:text-gray-300">{{ m.name }}</div>
                  </li>
                </ul>
                <a href="/asset-review.html" target="_blank" rel="noopener" class="mt-1 inline-block text-micro text-brand hover:underline">{{ t('build.modelsAll') }}</a>
              </div>
              <ul v-if="showOsmTags && tagsOpen[it.id]" class="ml-2 mb-1 pl-2 border-l border-gray-200 dark:border-gray-600 space-y-0.5">
                <li v-for="tg in it.tags" :key="tg.tag" class="flex items-center gap-1.5">
                  <code class="text-micro flex-1 min-w-0 truncate" :class="it.on && tg.on ? 'text-gray-700 dark:text-gray-200' : 'text-gray-400 dark:text-gray-500 line-through'">{{ tg.tag }}</code>
                  <span class="text-micro text-gray-500 tabular-nums">{{ tg.count.toLocaleString() }}</span>
                  <BaseSwitch size="sm" :on="it.on && tg.on" :label="tg.tag" :disabled="!it.on" @toggle="setTagOn(tg.tag, !tg.on)" />
                </li>
              </ul>
            </div>
          </div>
        </div>
      </div>
      <div class="flex flex-wrap items-center gap-x-3 gap-y-1 pt-1 border-t border-gray-100 dark:border-gray-700/60">
        <label class="flex items-center gap-1.5 text-caption text-gray-600 dark:text-gray-300 cursor-pointer">
          <BaseSwitch size="sm" :on="showOsmTags" :label="t('build.showTags')" @toggle="showOsmTags = !showOsmTags" />{{ t('build.showTags') }}
        </label>
        <label class="flex items-center gap-1.5 text-caption text-gray-600 dark:text-gray-300 cursor-pointer">
          <BaseSwitch size="sm" :on="colourMap" :label="t('build.colourMap')" @toggle="colourMap = !colourMap" />{{ t('build.colourMap') }}
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

    <!-- Fine-tuning (Advanced): groups that fold, each setting one short line with the rest behind its info button -->
    <template v-if="advanced && contentTab === 'tune'">
      <div class="rounded border border-gray-200 dark:border-gray-700 divide-y divide-gray-200 dark:divide-gray-700" data-testid="tune-groups">
        <!-- trees and ground -->
        <section :class="treesBuilt ? '' : 'opacity-60'">
          <button type="button" class="w-full flex items-center gap-2 px-2 py-2 text-left hover:bg-gray-50 dark:hover:bg-gray-800/60" :aria-expanded="tuneOpen.green" data-testid="tune-group-green" @click="toggleTune('green')">
            <ChevronRight :size="14" class="shrink-0 text-gray-400 transition-transform" :class="tuneOpen.green ? 'rotate-90' : ''" />
            <span class="text-xs font-semibold text-gray-800 dark:text-gray-100">{{ t('build.group_green') }}</span>
            <span class="ml-auto text-micro text-gray-500 dark:text-gray-400 truncate">{{ treesBuilt ? tuneSummary.green : t('build.off') }}</span>
          </button>
          <div v-if="tuneOpen.green" class="px-2 pb-2.5 space-y-2.5">
            <TuneRow :title="t('exportPanel.ui.forestDensity')" :short="treesBuilt ? t(`exportPanel.ui.forestDensityHint_${forestDensity}`) : t('build.offInFeatures', { what: t('build.item_trees') })">
              <div role="radiogroup" :aria-label="t('exportPanel.ui.forestDensity')" class="grid grid-cols-4 gap-1 p-1 rounded-lg bg-gray-100 dark:bg-gray-800 border border-gray-200 dark:border-gray-700">
                <button
                  v-for="k in FOREST_DENSITY_KEYS" :key="k" type="button" role="radio"
                  :aria-checked="forestDensity === k" :disabled="!treesBuilt || !hasOsmData"
                  @click="$emit('update:forestDensity', k)"
                  class="px-1 py-1 rounded text-caption transition-colors disabled:cursor-not-allowed"
                  :class="forestDensity === k ? 'bg-brand text-white shadow-sm font-medium' : 'text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white hover:bg-white dark:hover:bg-gray-700'"
                >{{ t(`exportPanel.ui.forestDensity_${k}`) }}</button>
              </div>
            </TuneRow>
            <!-- Which trees this area gets (services/treeTable.js): one row a kind; its models open on a click -->
            <div v-if="trees && trees.rows.length" data-testid="tree-table">
              <TuneRow
                :title="t('build.trees.title')" :more="`${t('build.trees.switchHint')} ${t('build.trees.note')}`" :more-label="t('build.tune.more')" :less-label="t('build.tune.less')"
                :short="trees.source === 'records' ? t('build.trees.fromRecords', { count: trees.records }) : t('build.trees.fromClimate')"
              >
                <template #control>
                  <!-- every kind back to Keep, every model back on: what the data picked -->
                  <button v-if="treeChoicesMade" type="button" data-testid="tree-reset" class="shrink-0 text-micro text-brand hover:underline" :title="t('build.trees.resetHint')" @click="resetTreeChoices">{{ t('build.trees.reset') }}</button>
                </template>
                <ul class="rounded border border-gray-200 dark:border-gray-700 divide-y divide-gray-200 dark:divide-gray-700">
                  <li v-for="row in trees.rows" :key="row.group" class="px-1.5 py-1" :class="row.off || row.swappedTo ? 'opacity-70' : ''" :data-tree-kind="row.group">
                    <div class="flex items-center justify-between gap-1.5 text-caption">
                      <button
                        type="button" class="flex items-center gap-1 min-w-0 text-left disabled:cursor-default" :disabled="row.off || !!row.swappedTo"
                        :aria-expanded="treeOpen.has(row.group)" :aria-label="t('build.tune.showModels', { kind: treeGroupName(row.group) })" :data-tree-open="row.group"
                        @click="toggleTreeOpen(row.group)"
                      >
                        <ChevronRight :size="12" class="shrink-0 text-gray-400 transition-transform" :class="[treeOpen.has(row.group) && !row.off && !row.swappedTo ? 'rotate-90' : '', row.off || row.swappedTo ? 'invisible' : '']" />
                        <span class="font-medium text-gray-800 dark:text-gray-100 truncate">{{ treeGroupName(row.group) }}</span>
                      </button>
                      <span class="flex items-center gap-2 shrink-0">
                        <span v-if="!row.off && !row.swappedTo" class="tabular-nums text-gray-600 dark:text-gray-300">{{ treeShare(row.share) }}</span>
                        <!-- keep the kind, leave it out (its trees become the others), or plant another kind in its place -->
                        <select
                          :value="row.off ? 'off' : row.swappedTo ? `to:${row.swappedTo}` : 'keep'"
                          :disabled="!treesBuilt" :aria-label="t('build.trees.choiceFor', { kind: treeGroupName(row.group) })"
                          :class="[SELECT_XS, 'max-w-[8.5rem]']"
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
                    <!-- its models, each to switch off (the last one stays): shown when the kind is opened, or when one is off -->
                    <div v-if="!row.off && !row.swappedTo && (treeOpen.has(row.group) || row.models.some((m) => m.off))" class="mt-1 ml-4 flex flex-wrap gap-1">
                      <button
                        v-for="m in row.models" :key="m.type" type="button" :disabled="!treesBuilt || (!m.off && row.models.filter((x) => !x.off).length <= 1)"
                        :aria-pressed="!m.off" :title="m.off ? t('build.trees.modelOff') : t('build.trees.modelOn')" :data-tree-model="m.type"
                        class="px-1 rounded border text-micro leading-snug transition-colors disabled:cursor-not-allowed"
                        :class="m.off ? 'border-gray-200 dark:border-gray-700 text-gray-400 line-through' : 'border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:border-brand'"
                        @click="toggleTreeModel(m.type)"
                      >{{ treeModelLabel(m.type) }}</button>
                    </div>
                    <div v-else-if="row.swappedTo" class="ml-4 text-micro leading-snug text-gray-500 dark:text-gray-400">{{ t('build.trees.plantedAs', { kind: treeGroupName(row.swappedTo) }) }}</div>
                    <!-- (a kind others were swapped into says so: its share is not only its own) -->
                    <div v-if="!row.off && !row.swappedTo && treeTakesIn(row.group).length" class="mt-0.5 ml-4 text-micro leading-snug text-amber-700 dark:text-amber-300" data-tree-takes-in>{{ t('build.trees.takesIn', { kinds: treeTakesIn(row.group).map(treeGroupName).join(', ') }) }}</div>
                  </li>
                </ul>
              </TuneRow>
            </div>
          </div>
        </section>
        <!-- roads and markings -->
        <section :class="roadsBuilt ? '' : 'opacity-60'">
          <button type="button" class="w-full flex items-center gap-2 px-2 py-2 text-left hover:bg-gray-50 dark:hover:bg-gray-800/60" :aria-expanded="tuneOpen.roads" data-testid="tune-group-roads" @click="toggleTune('roads')">
            <ChevronRight :size="14" class="shrink-0 text-gray-400 transition-transform" :class="tuneOpen.roads ? 'rotate-90' : ''" />
            <span class="text-xs font-semibold text-gray-800 dark:text-gray-100">{{ t('build.group_roads') }}</span>
            <span class="ml-auto text-micro text-gray-500 dark:text-gray-400 truncate">{{ roadsBuilt ? tuneSummary.roads : t('build.off') }}</span>
          </button>
          <div v-if="tuneOpen.roads" class="px-2 pb-2.5 space-y-2.5">
            <p v-if="!roadsBuilt" class="text-caption leading-snug text-gray-500 dark:text-gray-400">{{ t('build.offInFeatures', { what: t('build.item_roadSurfaces') }) }}</p>
            <!-- road surfaces: MapNG's decal roads, or (experimental) Mesh Roads / Hero Roads; only the chosen one is described -->
            <TuneRow :title="t('exportPanel.ui.roadSurface')" :short="t(`build.tune.surface_${roadSurface}`)">
              <template #control>
                <select
                  data-testid="road-surface" :value="roadSurface" :disabled="!roadsBuilt || !hasOsmData" :aria-label="t('exportPanel.ui.roadSurface')"
                  :class="[SELECT_XS, 'max-w-[9.5rem]']"
                  @change="$emit('update:roadSurface', $event.target.value)"
                >
                  <option value="decal">{{ t('exportPanel.ui.roadSurface_decal') }}</option>
                  <option value="mesh">{{ t('exportPanel.ui.roadSurface_mesh') }}</option>
                  <option value="hero">{{ t('exportPanel.ui.roadSurface_hero') }}</option>
                </select>
              </template>
            </TuneRow>
            <!-- every road at the slope the lidar survey measured along it (structures/profileSolve.js); off: tertiary roads and smaller only -->
            <TuneRow :title="t('exportPanel.ui.followSurvey')" :short="t('build.tune.followShort')" :more="t('exportPanel.ui.followSurveyHint')" :more-label="t('build.tune.more')" :less-label="t('build.tune.less')">
              <template #control><BaseSwitch :on="followSurvey && roadsBuilt" :label="t('exportPanel.ui.followSurvey')" :disabled="!roadsBuilt || !hasOsmData" data-testid="follow-survey" @toggle="$emit('update:followSurvey', !followSurvey)" /></template>
            </TuneRow>
            <TuneRow :title="t('exportPanel.ui.assumeParking')" :short="t('build.tune.parkingShort')" :more="t('exportPanel.ui.assumeParkingHint')" :more-label="t('build.tune.more')" :less-label="t('build.tune.less')">
              <template #control><BaseSwitch :on="assumeParking && roadsBuilt" :label="t('exportPanel.ui.assumeParking')" :disabled="!roadsBuilt || !hasOsmData" @toggle="$emit('update:assumeParking', !assumeParking)" /></template>
            </TuneRow>
            <!-- road widths measured from the satellite picture: set before Generate (it downloads), so only pointed to here -->
            <TuneRow :title="t('exportPanel.ui.measuredWidths')" :short="measuredWidthsShort" :more="measuredWidthsShort === measuredWidthsNote ? '' : measuredWidthsNote" :more-label="t('build.tune.more')" :less-label="t('build.tune.less')" data-testid="measured-widths-note">
              <button type="button" class="block text-caption font-medium text-brand hover:underline" @click="showMeasureSetting">{{ t('exportPanel.ui.measuredWidthsChange') }}</button>
            </TuneRow>
            <!-- sidewalks as flat decals on the ground instead of raised meshes (exportBeamNGLevel.js sidewalkStyle) -->
            <TuneRow :title="t('exportPanel.ui.decalSidewalks')" :short="t('build.tune.walksShort')" :more="t('exportPanel.ui.decalSidewalksHint')" :more-label="t('build.tune.more')" :less-label="t('build.tune.less')">
              <template #control><BaseSwitch :on="decalSidewalks && roadsBuilt" :label="t('exportPanel.ui.decalSidewalks')" :disabled="!roadsBuilt || !hasOsmData" @toggle="$emit('update:decalSidewalks', !decalSidewalks)" /></template>
            </TuneRow>
            <!-- the raised sidewalks' height over the road (beamngSidewalks.js CURB_HEIGHTS_M); nothing to set for decals -->
            <TuneRow :title="t('exportPanel.ui.curbHeight')" :short="t('build.tune.curbShort')" :more="t('exportPanel.ui.curbHeightHint')" :more-label="t('build.tune.more')" :less-label="t('build.tune.less')" :dim="decalSidewalks">
              <div role="radiogroup" :aria-label="t('exportPanel.ui.curbHeight')" class="grid grid-cols-3 gap-1 p-1 rounded-lg bg-gray-100 dark:bg-gray-800 border border-gray-200 dark:border-gray-700">
                <button
                  v-for="k in CURB_HEIGHT_KEYS" :key="k" type="button" role="radio"
                  :aria-checked="curbHeight === k" :disabled="!roadsBuilt || !hasOsmData || decalSidewalks"
                  @click="$emit('update:curbHeight', k)"
                  :aria-label="t(`exportPanel.ui.curbHeight_${k}`)"
                  class="px-1 py-1 rounded text-caption leading-tight transition-colors disabled:cursor-not-allowed"
                  :class="curbHeight === k ? 'bg-brand text-white shadow-sm font-medium' : 'text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white hover:bg-white dark:hover:bg-gray-700'"
                ><span class="block truncate">{{ twoLines(t(`exportPanel.ui.curbHeight_${k}`))[0] }}</span><span class="block text-micro opacity-80 tabular-nums">{{ twoLines(t(`exportPanel.ui.curbHeight_${k}`))[1] }}</span></button>
              </div>
            </TuneRow>
          </div>
        </section>
        <!-- bridges -->
        <section :class="bridgesBuilt ? '' : 'opacity-60'">
          <button type="button" class="w-full flex items-center gap-2 px-2 py-2 text-left hover:bg-gray-50 dark:hover:bg-gray-800/60" :aria-expanded="tuneOpen.bridges" data-testid="tune-group-bridges" @click="toggleTune('bridges')">
            <ChevronRight :size="14" class="shrink-0 text-gray-400 transition-transform" :class="tuneOpen.bridges ? 'rotate-90' : ''" />
            <span class="text-xs font-semibold text-gray-800 dark:text-gray-100">{{ t('build.group_bridges') }}</span>
            <span class="ml-auto text-micro text-gray-500 dark:text-gray-400 truncate">{{ bridgesBuilt ? tuneSummary.bridges : t('build.off') }}</span>
          </button>
          <div v-if="tuneOpen.bridges" class="px-2 pb-2.5 space-y-2.5">
            <TuneRow :title="t('exportPanel.lidarDecks')" :short="bridgesBuilt ? t('exportPanel.ui.lidarDecksHint') : t('build.offInFeatures', { what: t('build.item_bridges') })">
              <template #control><BaseSwitch :on="lidarDecks && bridgesBuilt" :label="t('exportPanel.lidarDecks')" :disabled="!bridgesBuilt || !hasOsmData" @toggle="$emit('update:lidarDecks', !lidarDecks)" /></template>
            </TuneRow>
          </div>
        </section>
        <!-- limits -->
        <section>
          <button type="button" class="w-full flex items-center gap-2 px-2 py-2 text-left hover:bg-gray-50 dark:hover:bg-gray-800/60" :aria-expanded="tuneOpen.limits" data-testid="tune-group-limits" @click="toggleTune('limits')">
            <ChevronRight :size="14" class="shrink-0 text-gray-400 transition-transform" :class="tuneOpen.limits ? 'rotate-90' : ''" />
            <span class="text-xs font-semibold text-gray-800 dark:text-gray-100">{{ t('build.limits') }}</span>
            <span class="ml-auto text-micro text-gray-500 dark:text-gray-400 truncate">{{ tuneSummary.limits }}</span>
          </button>
          <div v-if="tuneOpen.limits" class="px-2 pb-2.5 space-y-2.5">
            <TuneRow :title="t('exportPanel.ui.buildEverything')" :short="t('build.tune.capsShort')" :more="t('exportPanel.ui.buildEverythingHint')" :more-label="t('build.tune.more')" :less-label="t('build.tune.less')">
              <template #control><BaseSwitch :on="!safeCaps" :label="t('exportPanel.ui.buildEverything')" @toggle="$emit('update:safeCaps', !safeCaps)" /></template>
            </TuneRow>
            <!-- the map data the level was built from, in it for bug reports (exportBeamNGLevel.js addSourceData) -->
            <TuneRow :title="t('exportPanel.ui.bundleOsm')" :short="t('build.tune.bundleOsmShort')" :more="t('exportPanel.ui.bundleOsmHint')" :more-label="t('build.tune.more')" :less-label="t('build.tune.less')">
              <template #control><BaseSwitch :on="bundleOsm && hasOsmData" :label="t('exportPanel.ui.bundleOsm')" :disabled="!hasOsmData" data-testid="bundle-osm" @toggle="$emit('update:bundleOsm', !bundleOsm)" /></template>
            </TuneRow>
            <!-- (experimental) the ground as models, no TerrainBlock: any shape (exportBeamNGLevel.js generateGroundModelDAEs) -->
            <TuneRow :title="t('exportPanel.ui.groundModels')" :short="t('build.tune.groundModelsShort')" :more="t('exportPanel.ui.groundModelsHint')" :more-label="t('build.tune.more')" :less-label="t('build.tune.less')">
              <template #control><BaseSwitch :on="groundModels" :label="t('exportPanel.ui.groundModels')" data-testid="ground-models" @toggle="$emit('update:groundModels', !groundModels)" /></template>
            </TuneRow>
          </div>
        </section>
      </div>
    </template>

    <p v-if="advanced" class="text-micro text-gray-500 dark:text-gray-400">{{ footer }}</p>
    <Teleport to="body">
      <div
        v-if="modelPeek" data-testid="model-peek" role="tooltip"
        class="fixed z-[2000] pointer-events-none rounded-lg border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-800 shadow-xl p-2"
        :style="{ left: modelPeek.left + 'px', top: modelPeek.top + 'px', width: PEEK_PX + 16 + 'px' }"
      >
        <img :src="thumbUrl(modelPeek.m)" :alt="modelPeek.m.is || modelPeek.m.name" :width="PEEK_PX" :height="PEEK_PX" class="block rounded bg-gray-200 dark:bg-gray-700" :style="{ width: PEEK_PX + 'px', height: PEEK_PX + 'px' }" />
        <div class="mt-1.5 text-xs font-semibold text-gray-900 dark:text-gray-100 break-all">{{ modelPeek.m.name }}</div>
        <div v-if="modelPeek.m.is" class="text-caption leading-snug text-gray-600 dark:text-gray-300">{{ modelPeek.m.is }}</div>
        <dl class="mt-1.5 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-caption leading-snug">
          <template v-for="row in peekRows(modelPeek.m)" :key="row[0]">
            <dt class="text-gray-500 dark:text-gray-400">{{ row[0] }}</dt>
            <dd class="text-gray-800 dark:text-gray-100 break-all" :class="row[2] ? 'font-mono text-micro' : ''">{{ row[1] }}</dd>
          </template>
        </dl>
      </div>
    </Teleport>
  </SettingCard>
</template>

<script setup>
import { useMeasureRoadWidths } from '../../composables/useMeasureRoadWidths.js';
import { useAssetThumbs, modelsInUse, tagsPresent } from '../../composables/useAssetThumbs.js';
import { resolveRegionalBiome } from '../../services/beamngRegion.js';
import { regionOfBiome } from '../../services/tagModels.js';
import { WIDTH_SOURCE_TAG } from '../../services/satRoadWidth.js';
import { computed, reactive, ref, toRaw } from 'vue';
import { treeTable, treeModelLabel, sampleElevations } from '../../services/treeTable.js';
import { TREE_KIND_IDS } from '../../services/beamngTrees.js';
import { useI18n } from 'vue-i18n';
import { ChevronRight } from 'lucide-vue-next';
import SettingCard from '../base/SettingCard.vue';
import SectionToggleAll from '../base/SectionToggleAll.vue';
import BaseSwitch from '../base/BaseSwitch.vue';
import TuneRow from '../base/TuneRow.vue';
import { SELECT_XS } from '../base/controlStyles.js';
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
  followSurvey: { type: Boolean, default: true },
  bundleOsm: { type: Boolean, default: true },
  groundModels: { type: Boolean, default: false },
  decalSidewalks: { type: Boolean, default: false },
  roadSurface: { type: String, default: 'decal' },
  curbHeight: { type: String, default: 'standard' },
  treeKindsOff: { type: Array, default: () => [] },
  treeSwaps: { type: Array, default: () => [] },
  treeModelsOff: { type: Array, default: () => [] },
});
const CURB_HEIGHT_KEYS = ['standard', 'low', 'flush'];
const emit = defineEmits(['update:forestDensity', 'update:lidarDecks', 'update:safeCaps', 'update:assumeParking', 'update:followSurvey', 'update:bundleOsm', 'update:groundModels', 'update:decalSidewalks', 'update:roadSurface', 'update:curbHeight', 'update:treeKindsOff', 'update:treeSwaps', 'update:treeModelsOff']);
// (Map data > Measure road widths: whether it is on, how many of this map's roads it measured, and the way there)
const { on: measureWidthsOn, show: showMeasureSetting } = useMeasureRoadWidths();
const measuredRoads = computed(() => {
  const features = toRaw(useMainStore().terrainData)?.osmFeatures;
  if (!Array.isArray(features)) return null;
  let n = 0;
  for (const f of features) if (f?.tags?.[WIDTH_SOURCE_TAG] === 'satellite') n++;
  return n;
});
const roadPieces = computed(() => {
  const features = toRaw(useMainStore().terrainData)?.osmFeatures;
  if (!Array.isArray(features)) return 0;
  let n = 0;
  for (const f of features) if (f?.type === 'road') n++;
  return n;
});
// (how many of how many, so a few measured roads do not read as all of them; and what a change of the switch
// needs, which a tester found missing: "it doesnt say anything when i change setting")
const measuredWidthsNote = computed(() => (measuredRoads.value > 0
  ? t('exportPanel.ui.measuredWidthsUsedOf', { n: measuredRoads.value, total: roadPieces.value })
    + (measureWidthsOn.value ? '' : ` ${t('exportPanel.ui.measuredWidthsNowOff')}`)
  : measureWidthsOn.value ? t('exportPanel.ui.measuredWidthsOnNone') : t('exportPanel.ui.measuredWidthsOff')));
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
// (the note's first sentence on the row, the whole of it behind the info button)
const measuredWidthsShort = computed(() => (measuredRoads.value > 0 ? t('exportPanel.ui.measuredWidthsUsedOf', { n: measuredRoads.value, total: roadPieces.value }) : measureWidthsOn.value ? firstSentence(t('exportPanel.ui.measuredWidthsOnNone')) : t('build.tune.widthsOffShort')));
const firstSentence = (s0) => { const s = String(s0 || ''); const k = s.search(/[.。](\s|$)/); return k > 0 && k < s.length - 1 ? s.slice(0, k + 1) : s; };
// (a choice's label in two lines: "Standard (15 cm)" is its name and, smaller, its measure)
const twoLines = (label) => { const m = String(label).match(/^(.*?)\s*\(([^)]*)\)\s*$/); return m ? [m[1], m[2]] : [String(label), '']; };
// Fine-tuning's groups fold; which are open is kept for the next visit (none at first: four rows, each with what is set)
const TUNE_OPEN_KEY = 'mapng_tune_open';
const tuneOpen = reactive({ green: false, roads: false, bridges: false, limits: false });
try { for (const k of JSON.parse(localStorage.getItem(TUNE_OPEN_KEY) || '[]')) if (k in tuneOpen) tuneOpen[k] = true; } catch { /* first visit */ }
const toggleTune = (k) => { tuneOpen[k] = !tuneOpen[k]; try { localStorage.setItem(TUNE_OPEN_KEY, JSON.stringify(Object.keys(tuneOpen).filter((x) => tuneOpen[x]))); } catch { /* not kept */ } };
// (a tree kind's models show when the kind is opened)
const treeOpen = reactive(new Set());
const toggleTreeOpen = (g) => { if (treeOpen.has(g)) treeOpen.delete(g); else treeOpen.add(g); };
// what each folded group has set, in a few words
const tuneSummary = computed(() => ({
  green: [t(`exportPanel.ui.forestDensity_${props.forestDensity}`), trees.value?.rows?.length ? t('build.tune.kinds', { n: trees.value.rows.filter((r) => !r.off && !r.swappedTo).length }) : ''].filter(Boolean).join(' · '),
  roads: [t(`exportPanel.ui.roadSurface_${props.roadSurface}`), props.decalSidewalks ? t('exportPanel.ui.decalSidewalks') : t(`exportPanel.ui.curbHeight_${props.curbHeight}`)].join(' · '),
  bridges: `${t('exportPanel.lidarDecks')}: ${props.lidarDecks ? t('build.tune.on') : t('build.tune.off')}`,
  limits: `${t('exportPanel.ui.buildEverything')}: ${props.safeCaps ? t('build.tune.off') : t('build.tune.on')}`,
}));
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

const open = reactive({});
const tagsOpen = reactive({});
// (the models behind an item, with photos, where the site serves them)
const modelsOpen = reactive({});
const MODEL_STRIP_MAX = 12;
// The whole photo (512 px, as stored) in a card beside the small one: to its right where there is room (over the
// map), else to its left; kept inside the window.
const PEEK_PX = 512;
const modelPeek = ref(null);
// (the card's rows: [label, value, monospace]; only what the model has)
const REGION_KEYS = { any: 'build.modelRegion_any', 'north-america': 'build.modelRegion_northAmerica', europe: 'build.modelRegion_europe', tropical: 'build.modelRegion_tropical' };
const peekRows = (m) => {
  const uses = (m.uses || []).filter((u) => u.used); const all = uses.length ? uses : (m.uses || []);
  const regions = [...new Set(all.map((u) => u.region || 'any'))].map((r) => (REGION_KEYS[r] ? t(REGION_KEYS[r]) : r)).join(', ');
  return [
    [t('build.modelTags'), [...new Set(all.map((u) => u.tag))].join(', '), true],
    regions && [t('build.modelRegion'), regions],
    m.size && [t('build.modelSize'), `${m.size.map((v) => Number(v).toFixed(v < 10 ? 1 : 0)).join(' × ')} m`],
    m.kind && [t('build.modelKind'), m.kind],
    m.level && [t('build.modelFrom'), m.level],
    [t('build.modelFile'), m.shape, true],
  ].filter(Boolean);
};
const peekAt = (m, e) => {
  const r = e.currentTarget.getBoundingClientRect(); const w = PEEK_PX + 16; const h = PEEK_PX + 190;
  const size = Math.min(PEEK_PX, window.innerWidth - 32);
  // (past the whole row of small photos, so the row stays in view while the pointer moves along it)
  const row = e.currentTarget.closest('ul')?.getBoundingClientRect();
  let left = Math.max(r.right, row?.right ?? 0) + 12; if (left + w > window.innerWidth - 8) left = Math.max(8, r.left - w - 12);
  const top = Math.max(8, Math.min(window.innerHeight - h - 8, r.top + r.height / 2 - h / 2));
  modelPeek.value = size < PEEK_PX ? null : { m, left, top };
};
const { assetModels, thumbUrl } = useAssetThumbs();
// (only what this area's export can place: a model placed today, for a tag the map data here holds. Every candidate
// for every tag is on the review page)
// (the area's region, as the export works it out from the place: services/beamngRegion.js)
const areaRegion = computed(() => {
  const td = toRaw(useMainStore().terrainData); const b = td?.bounds;
  if (!b) return 'any';
  try {
    const look = resolveRegionalBiome({ lat: (b.north + b.south) / 2, lon: (b.east + b.west) / 2, features: toRaw(props.osmFeatures) || [], landCover: td.landCover || null });
    return regionOfBiome(look?.biomeId);
  } catch { return 'any'; }
});
const itemModels = computed(() => {
  const all = assetModels.value; if (!all) return {};
  const present = tagsPresent(toRaw(props.osmFeatures));
  return Object.fromEntries(Object.entries(all).map(([id, list]) => [id, modelsInUse(list, present, areaRegion.value)]));
});
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
      return { id: it.id, on: !off.has(it.id), tags, count: total, detail: total ? total.toLocaleString() : detailOf(it.id) };
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
    props.followSurvey ? null : t('build.followSurvey'),
    props.bundleOsm ? null : t('build.bundleOsm'),
    props.groundModels ? t('build.groundModels') : null,
    props.decalSidewalks ? t('build.decalSidewalks') : props.curbHeight !== 'standard' ? `${t('exportPanel.ui.curbHeight').toLowerCase()}: ${t(`exportPanel.ui.curbHeight_${props.curbHeight}`).toLowerCase()}` : null,
  ].filter(Boolean).join(' · ');
  return contentTab.value === 'features'
    ? t('build.footerFeatures', { on, of: all.length, tuned })
    : t('build.footerTune', { on, of: all.length });
});
</script>
