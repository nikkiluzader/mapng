<!-- One fine-tuning setting: its name, one short line, its control on the right (slot "control") or under it
     (default slot), and the full explanation behind an info button. -->
<template>
  <div class="space-y-1" :class="dim ? 'opacity-50' : ''">
    <div class="flex items-start gap-2">
      <div class="flex-1 min-w-0">
        <div class="flex items-center gap-1">
          <span class="text-xs font-medium text-gray-800 dark:text-gray-100">{{ title }}</span>
          <button
            v-if="more" type="button" data-testid="tune-more" :aria-expanded="open" :aria-label="open ? lessLabel : moreLabel" :title="open ? lessLabel : moreLabel"
            class="shrink-0 p-0.5 rounded text-gray-400 hover:text-brand focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/40"
            :class="open ? 'text-brand' : ''" @click="open = !open"
          ><Info :size="12" /></button>
        </div>
        <p v-if="short" class="text-caption leading-snug text-gray-500 dark:text-gray-400">{{ short }}</p>
      </div>
      <slot name="control" />
    </div>
    <slot />
    <p v-if="open && more" data-testid="tune-more-text" class="text-caption leading-snug text-gray-600 dark:text-gray-300 rounded bg-gray-50 dark:bg-gray-800/60 border border-gray-200 dark:border-gray-700 px-2 py-1.5">{{ more }}</p>
  </div>
</template>

<script setup>
import { ref } from 'vue';
import { Info } from 'lucide-vue-next';
defineProps({
  title: { type: String, required: true },
  short: { type: String, default: '' },
  more: { type: String, default: '' },
  moreLabel: { type: String, default: 'More' },
  lessLabel: { type: String, default: 'Less' },
  dim: { type: Boolean, default: false },
});
const open = ref(false);
</script>
