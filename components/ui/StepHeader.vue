<template>
  <!-- One of the panel's three steps (where → built from → what you get), the
       same in single tile and batch mode, so the order of decisions shows. -->
  <div class="flex items-center gap-2.5 pt-1">
    <span class="shrink-0 w-6 h-6 rounded-full bg-brand text-white font-display text-xs font-bold flex items-center justify-center">{{ n }}</span>
    <div class="min-w-0">
      <div class="font-display text-micro font-bold uppercase tracking-[0.12em] text-gray-800 dark:text-gray-100">{{ title }}</div>
      <div v-if="hint" class="text-caption text-gray-500 dark:text-gray-400 truncate">{{ hint }}</div>
    </div>
    <span class="flex-1 h-px bg-gray-200 dark:bg-gray-700 ml-1"></span>
  </div>
</template>

<script setup>
defineProps({
  n: { type: [Number, String], required: true },
  title: { type: String, required: true },
  hint: { type: String, default: '' },
});
</script>
