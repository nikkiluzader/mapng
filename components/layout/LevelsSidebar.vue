<template>
  <!-- Desktop app only: the MapNG levels in BeamNG's mods folder -->
  <aside
    v-if="!open"
    class="w-10 flex-shrink-0 flex flex-col items-center py-3 gap-2 border-l border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 z-10"
  >
    <button
      type="button"
      class="relative p-2 rounded-lg text-gray-500 dark:text-gray-400 hover:text-brand hover:bg-orange-50 dark:hover:bg-gray-800 transition-colors"
      :title="t('levels.open')"
      @click="setOpen(true)"
    >
      <Library :size="18" />
      <span
        v-if="updatableCount"
        class="absolute -top-0.5 -right-0.5 min-w-[14px] h-[14px] px-0.5 rounded-full bg-brand text-white text-nano leading-[14px] font-semibold text-center"
      >{{ updatableCount }}</span>
    </button>
    <span class="text-micro font-medium tracking-wider uppercase text-gray-400 dark:text-gray-500 [writing-mode:vertical-rl] rotate-180 select-none">{{ t('levels.title') }}</span>
  </aside>

  <aside
    v-else
    class="w-80 flex-shrink-0 flex flex-col border-l border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 z-10 shadow-xl"
  >
    <div class="px-4 py-3 border-b border-gray-200 dark:border-gray-700 flex items-center gap-2">
      <Library :size="16" class="text-brand" />
      <h2 class="text-sm font-semibold text-gray-900 dark:text-white">{{ t('levels.title') }}</h2>
      <span class="text-caption text-gray-400 dark:text-gray-500">{{ levels.length }}</span>
      <button type="button" class="ml-auto p-1 rounded text-gray-400 hover:text-brand transition-colors" :title="t('levels.refresh')" @click="refresh">
        <RefreshCw :size="14" :class="loading ? 'animate-spin' : ''" />
      </button>
      <button type="button" class="p-1 rounded text-gray-400 hover:text-brand transition-colors" :title="t('levels.close')" @click="setOpen(false)">
        <PanelRightClose :size="15" />
      </button>
    </div>

    <div class="px-4 py-2 border-b border-gray-200 dark:border-gray-700 text-micro text-gray-500 dark:text-gray-400 flex items-center gap-2">
      <FolderOpen :size="12" class="shrink-0" />
      <span class="truncate" :title="folder || ''">{{ folder || t('levels.noFolder') }}</span>
    </div>

    <div class="flex-1 overflow-y-auto custom-scrollbar bg-gray-50/50 dark:bg-gray-800/50 p-3 space-y-2.5">
      <p v-if="!loading && !levels.length" class="text-caption text-gray-500 dark:text-gray-400 text-center py-8 px-4 leading-relaxed">
        {{ t('levels.empty') }}
      </p>

      <div
        v-for="level in levels"
        :key="level.zipName + '/' + level.levelName"
        class="rounded border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-800 overflow-hidden"
      >
        <div class="relative h-24 bg-gray-100 dark:bg-gray-700">
          <img v-if="level.preview" :src="level.preview + '?t=' + level.modifiedAt" alt="" class="w-full h-full object-cover" loading="lazy" @error="level.preview = null" />
          <Mountain v-else :size="28" class="absolute inset-0 m-auto text-gray-300 dark:text-gray-600" />
          <span
            v-if="isUpdatable(level)"
            class="absolute top-1.5 right-1.5 px-1.5 py-0.5 rounded bg-brand text-white text-nano font-semibold shadow"
          >{{ t('levels.updateAvailable') }}</span>
        </div>

        <div class="p-2.5 space-y-1.5">
          <div class="flex items-baseline gap-2 min-w-0">
            <div class="text-xs font-semibold text-gray-800 dark:text-gray-100 truncate" :title="level.title">{{ level.title }}</div>
            <span class="ml-auto shrink-0 text-nano px-1.5 py-0.5 rounded border border-gray-200 dark:border-gray-600 text-gray-500 dark:text-gray-400">
              {{ level.appVersion ? `v${level.appVersion}` : (level.kind === 'older' ? t('levels.olderVersion') : t('levels.website')) }}
            </span>
          </div>
          <div class="text-micro text-gray-500 dark:text-gray-400 flex flex-wrap gap-x-2">
            <span v-if="level.sizeMeters">{{ formatSize(level) }}</span>
            <span>{{ formatDate(level.exportedAt || level.modifiedAt) }}</span>
            <span>{{ formatBytes(level.zipBytes) }}</span>
          </div>
          <!-- (whether a rebuild can run offline from the level's saved data) -->
          <div class="flex items-center gap-1 text-micro" :class="level.rebuildable ? 'text-emerald-700 dark:text-emerald-400' : 'text-gray-500 dark:text-gray-400'" :title="level.rebuildable ? t('levels.rebuildSavedHint') : t('levels.rebuildFetchHint')">
            <HardDrive :size="10" class="shrink-0" />
            <span>{{ level.rebuildable ? t('levels.savedData') : t('levels.noSavedData') }}</span>
          </div>

          <div v-if="busy[level.levelName]" class="space-y-1.5 pt-0.5">
            <div class="flex items-center gap-1.5 text-micro text-gray-600 dark:text-gray-300">
              <Loader2 :size="11" class="animate-spin text-brand shrink-0" />
              <span class="truncate" :title="busy[level.levelName]">{{ busy[level.levelName] }}</span>
            </div>
            <button type="button" class="px-2 py-0.5 text-micro rounded text-gray-500 dark:text-gray-400 hover:text-brand transition-colors" @click="cancel(level)">
              {{ t('levels.cancel') }}
            </button>
          </div>
          <div v-else class="flex flex-wrap gap-1.5 pt-0.5">
            <button
              type="button"
              class="flex items-center gap-1 px-2 py-0.5 text-micro rounded border transition-colors"
              :class="isUpdatable(level)
                ? 'bg-brand hover:bg-brand-500 border-brand-500 text-white'
                : 'border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-200 hover:border-brand hover:text-brand'"
              :disabled="anyBusy"
              :title="level.rebuildable ? t('levels.rebuildSavedHint') : t('levels.rebuildFetchHint')"
              @click="rebuild(level)"
            >
              <Hammer :size="11" />{{ t('levels.update') }}
            </button>
            <!-- (back into the window with its settings, to change and export again: App.vue handleModifyLevel) -->
            <button
              type="button"
              class="flex items-center gap-1 px-2 py-0.5 text-micro rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-200 hover:border-brand hover:text-brand transition-colors disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:border-gray-300 disabled:hover:text-gray-700"
              :disabled="anyBusy || !level.rebuildable"
              :title="level.rebuildable ? t('levels.modifyHint') : t('levels.modifyNoData', { name: level.title })"
              @click="$emit('modify', level)"
            >
              <SlidersHorizontal :size="11" />{{ t('levels.modify') }}
            </button>
            <button
              v-if="level.center"
              type="button"
              class="flex items-center gap-1 px-2 py-0.5 text-micro rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-200 hover:border-brand hover:text-brand transition-colors"
              @click="$emit('show-on-map', level)"
            >
              <MapPin :size="11" />{{ t('levels.showOnMap') }}
            </button>
            <button
              type="button"
              class="px-2 py-0.5 text-micro rounded text-gray-500 dark:text-gray-400 hover:text-brand transition-colors"
              :title="t('levels.showInModsHint')"
              @click="desktopApp.showLevelInFolder(level.zipName)"
            >
              {{ t('levels.showInMods') }}
            </button>
            <button
              v-if="level.rebuildable"
              type="button"
              class="px-2 py-0.5 text-micro rounded text-gray-500 dark:text-gray-400 hover:text-brand transition-colors"
              :title="t('levels.showDataHint')"
              @click="desktopApp.showLevelData(level.levelName)"
            >
              {{ t('levels.showData') }}
            </button>
            <!-- this level's export report, sent to the developer (asked for in nearly every bug report) -->
            <button
              type="button"
              class="flex items-center gap-1 px-2 py-0.5 text-micro rounded text-gray-500 dark:text-gray-400 hover:text-brand transition-colors"
              :title="t('levels.sendReportHint')"
              data-testid="level-send-report"
              @click="openReportDialog('level', { zipName: level.zipName, levelName: level.levelName, title: level.title, area: level.center ? { lat: level.center.lat, lng: level.center.lng, resolution: level.resolution, metersPerPixel: level.metersPerPixel } : null })"
            >
              <LifeBuoy :size="11" />{{ t('report.sendReport') }}
            </button>
            <button
              type="button"
              class="ml-auto flex items-center gap-1 px-1.5 py-0.5 text-micro rounded text-gray-400 dark:text-gray-500 hover:text-red-600 dark:hover:text-red-400 transition-colors"
              :disabled="anyBusy"
              :title="t('levels.deleteHint')"
              @click="remove(level)"
            >
              <Trash2 :size="11" />{{ t('levels.delete') }}
            </button>
          </div>
          <!-- the level's last exports (desktop/main.js export history): what changed, how long, what was reused -->
          <button type="button" class="flex items-center gap-1 text-micro text-gray-500 dark:text-gray-400 hover:text-brand transition-colors" @click="toggleHistory(level)">
            <History :size="11" />{{ t('levels.history') }}
            <ChevronDown :size="11" class="transition-transform" :class="history[level.levelName] ? 'rotate-180' : ''" />
          </button>
          <div v-if="history[level.levelName]" class="space-y-1 pl-1 border-l-2 border-gray-200 dark:border-gray-700">
            <p v-if="!history[level.levelName].length" class="pl-1.5 text-micro text-gray-400 dark:text-gray-500">{{ t('levels.historyNone') }}</p>
            <div v-for="(h, i) in history[level.levelName]" :key="i" class="pl-1.5 text-micro leading-snug text-gray-600 dark:text-gray-300">
              <div class="flex flex-wrap gap-x-1.5">
                <span class="font-medium">{{ formatTime(h.at) }}</span>
                <span v-if="h.kind !== 'export'" class="text-gray-400">{{ t(`levels.historyKind_${h.kind}`) }}</span>
                <span>{{ h.seconds }} s</span>
                <span v-if="h.reused?.length" class="text-emerald-700 dark:text-emerald-400">{{ t('levels.historyReused', { list: h.reused.map(stepName).join(', ') }) }}</span>
              </div>
              <div class="text-gray-500 dark:text-gray-400 [overflow-wrap:anywhere]">{{ changeText(h) }}</div>
              <div v-if="h.downloaded" class="text-amber-700 dark:text-amber-300">{{ t('levels.historyDownloaded', { n: h.downloaded }) }}</div>
            </div>
          </div>
          <p v-if="messages[level.levelName]" class="text-micro leading-snug" :class="messages[level.levelName].error ? 'text-red-600 dark:text-red-400' : 'text-gray-500 dark:text-gray-400'">
            {{ messages[level.levelName].text }}
          </p>
          <button
            v-if="messages[level.levelName]?.error"
            type="button"
            class="text-micro text-brand hover:underline"
            @click="openReportDialog('rebuild', { error: messages[level.levelName].text, area: level.center ? { lat: level.center.lat, lng: level.center.lng, resolution: level.resolution, metersPerPixel: level.metersPerPixel } : null })"
          >{{ t('report.sendReport') }}</button>
        </div>
      </div>
    </div>
    <!-- Once: what Delete does (afterwards it just deletes; the button's tooltip says the same) -->
    <Teleport to="body">
      <div v-if="deleteWarning" class="fixed inset-0 z-[10002] flex items-center justify-center bg-black/60 backdrop-blur-sm" @keydown.esc="answerDeleteWarning(false)">
        <div class="bg-white dark:bg-gray-900 rounded-2xl shadow-2xl border border-gray-200 dark:border-gray-700 w-[calc(100vw-2rem)] max-w-md flex flex-col overflow-hidden" role="dialog" aria-modal="true">
          <div class="px-6 py-4 bg-gradient-to-r from-red-600 to-brand text-white flex items-center gap-2">
            <Trash2 :size="18" class="shrink-0" />
            <h2 class="text-base font-bold">{{ t('levels.deleteWarnTitle') }}</h2>
          </div>
          <div class="p-6 space-y-3 text-xs leading-relaxed text-gray-700 dark:text-gray-200">
            <p class="font-semibold">{{ t('levels.deleteWarnLevel', { name: deleteWarning.title }) }}</p>
            <p>{{ t('levels.deleteWarnBody') }}</p>
            <p class="text-caption text-gray-500 dark:text-gray-400">{{ t('levels.deleteWarnOnce') }}</p>
          </div>
          <div class="px-6 py-3 border-t border-gray-200 dark:border-gray-700 flex justify-end gap-2">
            <button type="button" class="px-3 py-1.5 rounded text-xs text-gray-600 dark:text-gray-300 hover:text-brand" @click="answerDeleteWarning(false)">{{ t('levels.deleteWarnCancel') }}</button>
            <button ref="deleteWarnButton" type="button" class="px-4 py-1.5 rounded bg-red-600 hover:bg-red-700 text-white text-xs font-semibold" @click="answerDeleteWarning(true)">{{ t('levels.deleteWarnConfirm') }}</button>
          </div>
        </div>
      </div>
    </Teleport>
  </aside>
</template>

<script setup>
import { PERSONAL_STORAGE_KEYS } from '../../services/personalKeys.js';
import { computed, onMounted, onUnmounted, reactive, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { ChevronDown, FolderOpen, Hammer, HardDrive, History, Library, LifeBuoy, Loader2, MapPin, Mountain, PanelRightClose, RefreshCw, SlidersHorizontal, Trash2 } from 'lucide-vue-next';
import { desktopApp } from '../../services/platform/desktop.js';
import { openReportDialog } from '../../composables/useReportDialog.js';

defineEmits(['show-on-map', 'modify']);
const { t, locale } = useI18n();

const OPEN_KEY = 'mapng_levels_sidebar_open';
const readOpen = () => { try { return localStorage.getItem(OPEN_KEY) !== 'false'; } catch { return true; } };
const open = ref(readOpen());
const setOpen = (v) => {
  open.value = v;
  try { localStorage.setItem(OPEN_KEY, String(v)); } catch { /* fine */ }
  if (v) refresh();
};

const levels = ref([]);
const folder = ref(null);
const appVersion = ref(null);
const loading = ref(false);
const busy = reactive({});       // levelName → progress text
// levelName → its last exports (open), from desktop/main.js's export history
const history = reactive({});
async function toggleHistory(level) {
  if (history[level.levelName]) { delete history[level.levelName]; return; }
  try { history[level.levelName] = (await desktopApp.levelHistory?.(level.levelName, 5)) || []; } catch { history[level.levelName] = []; }
}
// (setting names as the export panel says them, where it has them)
const SETTING_WORDS = {
  forestDensity: 'exportPanel.ui.forestDensity', viewDistance: 'exportPanel.viewDistance', assumeParking: 'exportPanel.ui.assumeParking', treeKindsOff: 'build.trees.leftOutLabel', includeTrees: 'exportPanel.treesBushes', includeBackdrop: 'exportPanel.includeBackdrop',
  backdropElevationSource: 'exportPanel.includeBackdrop', baseTexture: 'exportPanel.baseTexture', levelName: 'exportPanel.levelName',
  includeBuildings: 'exportPanel.ui.buildings', includeWater: 'exportPanel.water', includeRocks: 'exportPanel.rocks',
  includeBridges: 'exportPanel.includeBridges', includeTunnels: 'exportPanel.includeTunnels', seaLevelOffset: 'exportPanel.seaLevelOffset',
};
const settingName = (k) => (SETTING_WORDS[k] ? t(SETTING_WORDS[k]) : k);
const stepName = (k) => (['backdrop', 'buildings', 'materials'].includes(k) ? t(`exportSettings.${k}`) : k);
const changeText = (h) => {
  if (h.changed == null) return t('levels.historyFirst');
  if (!h.changed.length) return t('levels.historyNoChange');
  return h.changed.map((c) => `${settingName(c.setting)}: ${c.from ?? '—'} → ${c.to ?? '—'}`).join(' · ');
};
const formatTime = (iso) => {
  try { return new Date(iso).toLocaleString(locale.value, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }); } catch { return iso; }
};
const messages = reactive({});   // levelName → { text, error }
const anyBusy = computed(() => Object.keys(busy).length > 0);

// (an older MapNG, or a version before this one: a rebuild brings its fixes)
const newer = (a, b) => {
  const pa = String(a || '0').split('.').map(Number); const pb = String(b || '0').split('.').map(Number);
  for (let i = 0; i < 3; i++) if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) > (pb[i] || 0);
  return false;
};
const isUpdatable = (level) => !level.appVersion || newer(appVersion.value, level.appVersion);
const updatableCount = computed(() => levels.value.filter(isUpdatable).length);

async function refresh() {
  if (!desktopApp?.listLevels || loading.value) return;
  loading.value = true;
  try {
    const r = await desktopApp.listLevels();
    folder.value = r.folder;
    appVersion.value = r.appVersion;
    levels.value = r.levels;
  } catch (error) {
    console.warn('[Levels] could not list the mods folder:', error);
  } finally {
    loading.value = false;
  }
}

const progressText = (p) => {
  const u = p?.update;
  if (typeof u === 'string') return u;
  if (u?.status) return u.status;
  if (u?.step) return u.pct != null ? `${u.step} (${Math.round(u.pct * 100)}%)` : u.step;
  return t('levels.working');
};

async function rebuild(level) {
  const detail = level.rebuildable ? t('levels.confirmSaved', { name: level.title }) : t('levels.confirmFetch', { name: level.title });
  if (!window.confirm(detail)) return;
  delete messages[level.levelName];
  busy[level.levelName] = t('levels.starting');
  try {
    // (the window's own key and servers go along: a saved level never holds them)
    const personal = { gpxzApiKey: localStorage.getItem('mapng_gpxzApiKey') || '', localStorage: Object.fromEntries(PERSONAL_STORAGE_KEYS.map((k) => [k, localStorage.getItem(k) || '']).filter(([, v]) => v)) };
    const r = await desktopApp.rebuildLevel(level.zipName, level.levelName, (p) => { busy[level.levelName] = progressText(p); }, personal);
    if (r?.cancelled) messages[level.levelName] = { text: t('levels.cancelled') };
    else {
      // (and whether it stayed offline: from the saved data, or what it downloaded)
      const base = t('levels.rebuilt', { version: appVersion.value, seconds: Math.round(r.seconds || 0) });
      const how = r.downloaded == null ? t('levels.rebuiltFetched')
        : r.downloaded ? t('levels.rebuiltSomeDownloaded', { count: r.downloaded })
          : t('levels.rebuiltOffline');
      messages[level.levelName] = { text: `${base} ${how}` };
    }
  } catch (error) {
    const text = String(error?.message || error).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
    messages[level.levelName] = { text, error: true };
  } finally {
    delete busy[level.levelName];
    refresh();
  }
}

const cancel = (level) => desktopApp.cancelRebuild(level.levelName);

// To the Recycle Bin / Trash (zip and saved data). The first time, a warning
// says what that means; after it was confirmed once, Delete just deletes (the
// button's tooltip keeps the explanation).
const DELETE_WARNED_KEY = 'mapng_levelDeleteWarned';
const deleteWarned = ref((() => { try { return localStorage.getItem(DELETE_WARNED_KEY) === 'true'; } catch { return false; } })());
const deleteWarning = ref(null);   // the level the warning is about
const deleteWarnButton = ref(null);
watch(deleteWarnButton, (el) => el?.focus());

function remove(level) {
  if (!deleteWarned.value) { deleteWarning.value = level; return; }
  deleteLevel(level);
}
function answerDeleteWarning(confirmed) {
  const level = deleteWarning.value;
  deleteWarning.value = null;
  if (!confirmed || !level) return;
  deleteWarned.value = true;
  try { localStorage.setItem(DELETE_WARNED_KEY, 'true'); } catch { /* private mode */ }
  deleteLevel(level);
}
async function deleteLevel(level) {
  delete messages[level.levelName];
  try {
    await desktopApp.deleteLevel(level.zipName, level.levelName);
  } catch (error) {
    const text = String(error?.message || error).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
    messages[level.levelName] = { text, error: true };
    return;
  }
  refresh();
}

const formatSize = (level) => {
  const km = level.sizeMeters / 1000;
  const mpp = level.metersPerPixel;
  return `${km >= 1 ? km.toFixed(km < 10 ? 1 : 0) : km.toFixed(2)} km${mpp ? ` · ${+mpp.toFixed(2)} m/px` : ''}`;
};
const formatDate = (iso) => {
  if (!iso) return '';
  try { return new Date(iso).toLocaleDateString(locale.value, { year: 'numeric', month: 'short', day: 'numeric' }); } catch { return iso.slice(0, 10); }
};
const formatBytes = (n) => (n >= 2 ** 30 ? `${(n / 2 ** 30).toFixed(1)} GB` : `${Math.max(1, Math.round(n / 2 ** 20))} MB`);

// (fresh when the window comes back, and after an export lands)
const onFocus = () => { if (open.value) refresh(); };
let timer = null;
onMounted(() => {
  refresh();
  window.addEventListener('focus', onFocus);
  window.addEventListener('mapng:levels-changed', refresh);
  timer = setInterval(() => { if (open.value && !anyBusy.value) refresh(); }, 15000);
});
onUnmounted(() => {
  window.removeEventListener('focus', onFocus);
  window.removeEventListener('mapng:levels-changed', refresh);
  clearInterval(timer);
});

defineExpose({ refresh });
</script>
