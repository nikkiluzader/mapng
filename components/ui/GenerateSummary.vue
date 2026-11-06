<template>
  <!-- What the button will build, in one line: area, detail, source, terrain,
       map data. Each part goes to its step and setting, so checking a setup
       never means hunting for it. compact: the chips alone (the wizard's
       bottom bar); rows: a labelled list (the review step). -->
  <div v-if="rows" class="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 divide-y divide-gray-100 dark:divide-gray-700">
    <button
      v-for="item in items"
      :key="item.key"
      type="button"
      class="w-full flex items-center justify-between gap-3 px-3 py-1.5 text-xs text-left hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors"
      :title="t('genSummary.jump')"
      @click="jump(item)"
    >
      <span class="text-gray-500 dark:text-gray-400">{{ item.rowLabel || item.label }}</span>
      <span class="font-semibold text-right" :class="item.warn ? 'text-amber-700 dark:text-amber-300' : 'text-gray-800 dark:text-gray-100'">{{ item.label }}</span>
    </button>
  </div>
  <div v-else :class="compact ? '' : 'rounded-lg border border-gray-200 dark:border-gray-700 bg-white/70 dark:bg-gray-800/50 px-2.5 py-2'">
    <div v-if="!compact" class="text-micro font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500 mb-1">{{ t('genSummary.title') }}</div>
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
        @click="jump(item)"
      >{{ item.label }}</button>
    </div>
  </div>
</template>

<script setup>
import { nextTick } from 'vue';
import { useI18n } from 'vue-i18n';

defineProps({
  // [{ key, label, rowLabel?, target (an element id), step? (the wizard step it is on), warn? }]
  items: { type: Array, required: true },
  compact: { type: Boolean, default: false },
  rows: { type: Boolean, default: false },
});
// step: the wizard step to show before going to the setting
const emit = defineEmits(['step']);
const { t } = useI18n({ useScope: 'global' });
const jump = async (item) => {
  if (item.step) emit('step', item.step);
  await nextTick();
  const el = item.target && document.getElementById(item.target);
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
