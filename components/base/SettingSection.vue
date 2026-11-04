<template>
  <!-- A collapsible section of the sidebar: one look for every section of the
       control and export panels (icon, title, chevron), open state remembered. -->
  <section class="space-y-2">
    <button
      type="button"
      class="w-full flex items-center justify-between gap-2 group text-left"
      :aria-expanded="open"
      @click="toggle"
    >
      <span class="flex items-center gap-2 min-w-0">
        <component :is="icon" v-if="icon" :size="14" class="shrink-0" :class="accent ? 'text-[#FF6600]' : 'text-gray-500 dark:text-gray-400 group-hover:text-[#FF6600]'" />
        <span class="text-[13px] font-semibold text-gray-800 dark:text-gray-100 group-hover:text-[#FF6600] transition-colors truncate">{{ title }}</span>
        <span v-if="$slots.aside" class="text-[11px] font-normal text-gray-500 dark:text-gray-400 shrink-0"><slot name="aside" /></span>
      </span>
      <ChevronDown :size="14" class="shrink-0 text-gray-400 dark:text-gray-500 transition-transform duration-200" :class="open ? 'rotate-180' : ''" />
    </button>
    <div v-if="open" class="space-y-2">
      <slot />
    </div>
  </section>
</template>

<script setup>
import { computed, ref, watch } from 'vue';
import { ChevronDown } from 'lucide-vue-next';

const props = defineProps({
  title: { type: String, required: true },
  icon: { type: [Object, Function], default: null },
  // localStorage key for the open state; without one the section starts as defaultOpen each time
  storageKey: { type: String, default: '' },
  defaultOpen: { type: Boolean, default: true },
  accent: { type: Boolean, default: false },
  // v-model:open, for a section whose open state the parent keeps (else it keeps its own)
  open: { type: Boolean, default: undefined },
});
const emit = defineEmits(['update:open']);

const read = () => {
  if (!props.storageKey) return props.defaultOpen;
  try {
    const v = localStorage.getItem(props.storageKey);
    return v == null ? props.defaultOpen : v === 'true';
  } catch { return props.defaultOpen; }
};
const own = ref(read());
const open = computed(() => (props.open === undefined ? own.value : props.open));
const toggle = () => { const next = !open.value; own.value = next; emit('update:open', next); };
watch(own, (v) => {
  if (!props.storageKey) return;
  try { localStorage.setItem(props.storageKey, String(v)); } catch { /* private mode */ }
});
defineExpose({ open });
</script>
