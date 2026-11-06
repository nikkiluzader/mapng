<template>
  <!-- What the button above will build, in one line: area, detail, source,
       terrain, map data. Each part jumps to its setting, so checking a setup
       never means scrolling the whole panel. -->
  <div class="rounded-lg border border-gray-200 dark:border-gray-700 bg-white/70 dark:bg-gray-800/50 px-2.5 py-2">
    <div class="text-micro font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500 mb-1">{{ t('genSummary.title') }}</div>
    <div class="flex flex-wrap gap-1">
      <button
        v-for="item in items"
        :key="item.key"
        type="button"
        class="px-2 py-0.5 rounded-full text-caption border transition-colors"
        :class="item.warn
          ? 'border-amber-300 bg-amber-50 text-amber-800 hover:border-amber-400 dark:border-amber-700 dark:bg-amber-900/20 dark:text-amber-200'
          : 'border-gray-200 bg-gray-50 text-gray-700 hover:border-brand hover:text-brand dark:border-gray-600 dark:bg-gray-700/60 dark:text-gray-200'"
        :title="t('genSummary.jump')"
        @click="jump(item.target)"
      >{{ item.label }}</button>
    </div>
  </div>
</template>

<script setup>
import { useI18n } from 'vue-i18n';

defineProps({
  // [{ key, label, target (an element id), warn? }]
  items: { type: Array, required: true },
});
const { t } = useI18n({ useScope: 'global' });
const jump = (id) => {
  const el = id && document.getElementById(id);
  if (!el) return;
  el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  el.classList.add('mapng-flash');
  setTimeout(() => el.classList.remove('mapng-flash'), 1200);
};
</script>

<style>
/* (the setting a summary part jumped to, for a moment) */
.mapng-flash { outline: 2px solid var(--brand); outline-offset: 4px; border-radius: 8px; transition: outline-color 0.6s; }
</style>
