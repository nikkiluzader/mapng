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
  </aside>
</template>

<script setup>
import { computed, onMounted, onUnmounted, reactive, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { FolderOpen, Hammer, HardDrive, Library, Loader2, MapPin, Mountain, PanelRightClose, RefreshCw, SlidersHorizontal, Trash2 } from 'lucide-vue-next';
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
    const r = await desktopApp.rebuildLevel(level.zipName, level.levelName, (p) => { busy[level.levelName] = progressText(p); });
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

// To the Recycle Bin / Trash (zip and saved data), after asking
async function remove(level) {
  if (!window.confirm(t('levels.confirmDelete', { name: level.title }))) return;
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
