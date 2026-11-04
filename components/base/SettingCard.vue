<template>
  <!-- A group of related settings: one card style everywhere (title, an
       optional control at the title's right, an optional note, then rows). -->
  <div class="rounded-md border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-800/40">
    <div v-if="title || $slots.header" class="flex items-center justify-between gap-2 px-2.5 pt-2">
      <span class="text-[12px] font-semibold text-gray-700 dark:text-gray-200">{{ title }}</span>
      <slot name="header" />
    </div>
    <p v-if="note" class="px-2.5 pt-1 text-[11px] leading-snug" :class="noteTone === 'warn' ? 'text-amber-700 dark:text-amber-300' : 'text-gray-500 dark:text-gray-400'">{{ note }}</p>
    <div class="px-2.5 py-2 space-y-2">
      <slot />
    </div>
  </div>
</template>

<script setup>
defineProps({
  title: { type: String, default: '' },
  note: { type: String, default: '' },
  noteTone: { type: String, default: 'muted' },   // muted | warn
});
</script>
