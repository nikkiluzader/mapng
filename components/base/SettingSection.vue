<template>
  <!-- A collapsible section of the sidebar: one look for every section of the
       control and export panels (icon, title, chevron), open state remembered. -->
  <section class="space-y-2">
    <div class="flex items-center gap-2">
      <button
        type="button"
        class="flex-1 min-w-0 flex items-center justify-between gap-2 group text-left"
        :aria-expanded="open"
        @click="toggle"
      >
        <span class="flex items-center gap-2 min-w-0">
          <component :is="icon" v-if="icon" :size="14" class="shrink-0" :class="accent ? 'text-brand' : 'text-gray-500 dark:text-gray-400 group-hover:text-brand'" />
          <span class="font-display text-sm font-semibold text-gray-800 dark:text-gray-100 group-hover:text-brand transition-colors truncate">{{ title }}</span>
          <!-- (something here differs from the defaults) -->
          <span v-if="changed" class="w-1.5 h-1.5 rounded-full bg-brand shrink-0" :title="t('sections.changedTitle')"></span>
          <span v-if="$slots.aside" class="text-caption font-normal text-gray-500 dark:text-gray-400 shrink-0"><slot name="aside" /></span>
        </span>
        <ChevronDown :size="14" class="shrink-0 text-gray-400 dark:text-gray-500 transition-transform duration-200" :class="open ? 'rotate-180' : ''" />
      </button>
      <button
        v-if="changed && resettable"
        type="button"
        class="shrink-0 text-caption text-gray-400 hover:text-brand transition-colors"
        :title="t('sections.resetTitle')"
        @click="$emit('reset')"
      >{{ t('sections.reset') }}</button>
    </div>
    <div v-if="open" class="space-y-2">
      <slot />
    </div>
  </section>
</template>

<script setup>
import { computed, ref, watch } from 'vue';
import { ChevronDown } from 'lucide-vue-next';
import { useI18n } from 'vue-i18n';
import { useSectionGroup } from '../../composables/useSectionGroup.js';

const props = defineProps({
  title: { type: String, required: true },
  icon: { type: [Object, Function], default: null },
  // localStorage key for the open state; without one the section starts as defaultOpen each time
  storageKey: { type: String, default: '' },
  defaultOpen: { type: Boolean, default: true },
  accent: { type: Boolean, default: false },
  // v-model:open, for a section whose open state the parent keeps (else it keeps its own)
  open: { type: Boolean, default: undefined },
  // something in the section differs from the defaults (a dot by the title), and
  // the parent can put it back (a Reset button, which emits 'reset')
  changed: { type: Boolean, default: false },
  resettable: { type: Boolean, default: false },
});
const emit = defineEmits(['update:open', 'reset']);
const { t } = useI18n({ useScope: 'global' });

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
// Expand all / Collapse all from the panel (provideSectionGroup)
const group = useSectionGroup();
if (group) watch(() => group.signal.value, (cmd) => { if (!cmd) return; own.value = cmd.open; emit('update:open', cmd.open); });
defineExpose({ open });
</script>
