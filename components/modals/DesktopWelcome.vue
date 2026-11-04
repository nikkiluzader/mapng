<template>
  <!-- Desktop app, first launch: where levels go, what the app adds, updates -->
  <Teleport to="body">
    <div v-if="show" class="fixed inset-0 z-[10000] flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div class="bg-white dark:bg-gray-900 rounded-xl shadow-2xl border border-gray-200 dark:border-gray-700 w-[calc(100vw-2rem)] max-w-lg overflow-hidden">
        <div class="px-6 py-5 bg-gradient-to-r from-[#FF6600] to-[#f59e0b] text-white">
          <h2 class="text-lg font-bold">{{ t('desktopWelcome.title') }}</h2>
          <p class="text-[12px] text-white/90 mt-0.5">{{ t('desktopWelcome.subtitle') }}</p>
        </div>

        <div class="p-6 space-y-4">
          <div class="space-y-1.5">
            <div class="text-[12px] font-medium text-gray-800 dark:text-gray-100">{{ t('desktopWelcome.modsFolder') }}</div>
            <div
              class="flex items-center gap-2 p-2 rounded border text-[11px]"
              :class="folderOk ? 'border-gray-200 dark:border-gray-600 bg-gray-50 dark:bg-gray-800' : 'border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-900/20'"
            >
              <FolderOpen :size="14" class="shrink-0" :class="folderOk ? 'text-[#FF6600]' : 'text-amber-600'" />
              <span class="min-w-0 flex-1 [overflow-wrap:anywhere] text-gray-700 dark:text-gray-200">{{ folder || t('desktopWelcome.notFound') }}</span>
              <button type="button" class="shrink-0 px-2 py-0.5 text-[10px] rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-200 hover:border-[#FF6600] hover:text-[#FF6600] transition-colors" @click="choose">
                {{ t('desktopWelcome.change') }}
              </button>
            </div>
            <p v-if="!folderOk" class="text-[10px] text-amber-700 dark:text-amber-300">{{ t('desktopWelcome.notFoundHint') }}</p>
          </div>

          <ul class="space-y-2 text-[11px] text-gray-600 dark:text-gray-300">
            <li class="flex gap-2"><Cpu :size="14" class="shrink-0 mt-0.5 text-[#FF6600]" /><span>{{ t('desktopWelcome.pointPower') }}</span></li>
            <li class="flex gap-2"><Library :size="14" class="shrink-0 mt-0.5 text-[#FF6600]" /><span>{{ t('desktopWelcome.pointLevels') }}</span></li>
            <li class="flex gap-2"><PackageOpen :size="14" class="shrink-0 mt-0.5 text-[#FF6600]" /><span>{{ t('desktopWelcome.pointMods') }}</span></li>
          </ul>

          <label class="flex items-start gap-2 text-[11px] text-gray-700 dark:text-gray-200 cursor-pointer select-none">
            <input v-model="updates" type="checkbox" class="mt-0.5 accent-[#FF6600]" />
            <span>{{ t('desktopWelcome.updates') }}</span>
          </label>

          <label class="flex items-start gap-2 text-[11px] text-gray-700 dark:text-gray-200 cursor-pointer select-none">
            <input v-model="shareExports" type="checkbox" class="mt-0.5 accent-[#FF6600]" />
            <span>{{ t('hotspots.welcome') }} <button type="button" class="text-[#FF6600] hover:underline" @click.prevent.stop="openHotspotPrivacy">{{ t('hotspots.privacy.link') }}</button></span>
          </label>

          <div class="flex justify-end">
            <button type="button" class="px-4 py-2 rounded bg-[#FF6600] hover:bg-[#e85d00] text-white text-[12px] font-semibold transition-colors" @click="done">
              {{ t('desktopWelcome.start') }}
            </button>
          </div>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup>
import { onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { Cpu, FolderOpen, Library, PackageOpen } from 'lucide-vue-next';
import { desktopApp } from '../../services/platform/desktop.js';
import { openHotspotPrivacy, setShareExports } from '../../composables/useExportHotspots.js';

const { t } = useI18n();
const show = ref(false);
const folder = ref(null);
const folderOk = ref(false);
const updates = ref(true);
const shareExports = ref(false);   // (opt in: unticked until the user ticks it)

onMounted(async () => {
  if (!desktopApp?.welcomeDone) return;
  try {
    const info = await desktopApp.info();
    if (info?.welcomed) return;
    folder.value = info?.modsFolder || null;
    folderOk.value = !!info?.modsFolderExists;
    show.value = true;
  } catch { /* no welcome then */ }
});

async function choose() {
  const picked = await desktopApp.chooseModsFolder();
  if (picked) { folder.value = picked; folderOk.value = true; }
}

async function done() {
  show.value = false;
  setShareExports(shareExports.value);
  await desktopApp.welcomeDone({ updates: updates.value });
  window.dispatchEvent(new CustomEvent('mapng:levels-changed'));
}
</script>
