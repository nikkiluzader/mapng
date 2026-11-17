<template>
  <!-- One setting: label on the left, its control on the right (all controls
       line up in one column), a short hint underneath. A disabled row says why
       instead of its hint. With `check`, the control is a checkbox bound to
       v-model and the whole row toggles it; a disabled box shows unticked (it
       won't apply) while the choice underneath is kept. -->
  <component
    :is="check ? 'label' : 'div'"
    class="block"
    :class="[indent ? 'pl-4' : '', disabled ? 'opacity-60' : '', check && !disabled ? 'cursor-pointer' : '', check && disabled ? 'cursor-not-allowed' : '']"
  >
    <div class="flex items-center justify-between gap-3 min-h-[22px]">
      <span class="text-xs text-gray-700 dark:text-gray-200 min-w-0">{{ label }}
        <!-- (the full explanation, behind a button: the row itself keeps one short line) -->
        <button
          v-if="more" type="button" data-testid="row-more" :aria-expanded="open" :aria-label="open ? lessLabel : moreLabel" :title="open ? lessLabel : moreLabel"
          class="inline-flex align-middle ml-0.5 p-0.5 rounded text-gray-400 hover:text-brand focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/40"
          :class="open ? 'text-brand' : ''" @click.prevent.stop="open = !open"
        ><Info :size="12" /></button>
      </span>
      <input
        v-if="check"
        type="checkbox"
        :checked="modelValue && !disabled"
        :disabled="disabled"
        :class="[CHECKBOX, 'shrink-0 disabled:!opacity-100']"
        @change="$emit('update:modelValue', $event.target.checked)"
      />
      <div v-else class="flex items-center gap-1 shrink-0"><slot /></div>
    </div>
    <p v-if="disabled && disabledReason" class="mt-0.5 text-caption leading-snug text-amber-700 dark:text-amber-300">{{ disabledReason }}</p>
    <p v-else-if="hint" class="mt-0.5 text-caption leading-snug text-gray-500 dark:text-gray-400">{{ hint }}</p>
    <p v-if="open && more" data-testid="row-more-text" class="mt-1 text-caption leading-snug text-gray-600 dark:text-gray-300 rounded bg-gray-50 dark:bg-gray-800/60 border border-gray-200 dark:border-gray-700 px-2 py-1.5">{{ more }}</p>
  </component>
</template>

<script setup>
import { ref } from 'vue';
import { Info } from 'lucide-vue-next';
import { CHECKBOX } from './controlStyles.js';

defineProps({
  label: { type: String, required: true },
  hint: { type: String, default: '' },
  more: { type: String, default: '' },
  moreLabel: { type: String, default: 'More' },
  lessLabel: { type: String, default: 'Less' },
  disabled: { type: Boolean, default: false },
  disabledReason: { type: String, default: '' },
  check: { type: Boolean, default: false },
  modelValue: { type: Boolean, default: false },
  indent: { type: Boolean, default: false },
});
defineEmits(['update:modelValue']);
const open = ref(false);
</script>
