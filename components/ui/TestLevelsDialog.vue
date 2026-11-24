<template>
  <!-- The official test levels (worker/testLevels.js): the list from /api/test-levels, a download link each. On the
       desktop app the levels list downloads them into the mods folder instead (LevelsSidebar.vue). -->
  <Teleport to="body">
    <div v-if="open" class="fixed inset-0 z-[100000] flex items-center justify-center bg-black/50 p-4" @click.self="$emit('close')">
      <div class="w-full max-w-md rounded-lg bg-white dark:bg-gray-900 shadow-xl border border-gray-200 dark:border-gray-700">
        <div class="flex items-center gap-2 px-4 py-3 border-b border-gray-200 dark:border-gray-700">
          <h2 class="text-sm font-semibold text-gray-900 dark:text-white">{{ t('testLevels.title') }}</h2>
          <button type="button" class="ml-auto p-1 rounded text-gray-400 hover:text-brand" :title="t('testLevels.close')" @click="$emit('close')"><X :size="16" /></button>
        </div>
        <div class="px-4 py-3 space-y-3 text-xs text-gray-700 dark:text-gray-300">
          <p>{{ t('testLevels.intro') }}</p>
          <p v-if="loading" class="text-gray-500 dark:text-gray-400">{{ t('testLevels.loading') }}</p>
          <p v-else-if="error" class="text-red-600 dark:text-red-400">{{ t('testLevels.error') }}</p>
          <ul v-else class="space-y-2">
            <li v-for="lv in levels" :key="lv.file" class="flex items-center gap-2">
              <span class="flex-1">{{ t(`testLevels.kind.${lv.kind}`) }}<span class="text-gray-400 dark:text-gray-500"> · {{ (lv.size / 1048576).toFixed(0) }} MB</span></span>
              <a
                :href="`/api/test-levels/${lv.file}`"
                :download="lv.file"
                class="shrink-0 inline-flex items-center gap-1 px-2 py-1 rounded border border-gray-300 dark:border-gray-600 hover:border-brand hover:text-brand"
              ><Download :size="12" />{{ t('testLevels.download') }}</a>
            </li>
          </ul>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup>
import { ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { Download, X } from 'lucide-vue-next';

const props = defineProps({ open: { type: Boolean, default: false } });
defineEmits(['close']);
const { t } = useI18n();
const levels = ref([]); const loading = ref(false); const error = ref(false);
const KINDS = new Set(['coverage', 'roads', 'structures', 'terrain']);

watch(() => props.open, async (on) => {
  if (!on || levels.value.length || loading.value) return;
  loading.value = true; error.value = false;
  try {
    const r = await fetch('/api/test-levels');
    if (!r.ok) throw new Error(String(r.status));
    const m = await r.json();
    levels.value = (m?.levels || []).filter((l) => KINDS.has(l.kind) && /^mapng_[a-z0-9_]+\.zip$/.test(String(l.file)));
  } catch {
    error.value = true;
  } finally {
    loading.value = false;
  }
}, { immediate: true });
</script>
