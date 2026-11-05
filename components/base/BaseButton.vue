<template>
  <component
    :is="as"
    :type="as === 'button' ? type : undefined"
    :disabled="disabled"
    :class="classes"
    v-bind="$attrs"
  >
    <slot />
  </component>
</template>

<script setup>
import { computed } from 'vue';

const props = defineProps({
  as: { type: String, default: 'button' },
  type: { type: String, default: 'button' },
  variant: { type: String, default: 'primary' },
  size: { type: String, default: 'md' },
  block: { type: Boolean, default: false },
  prominent: { type: Boolean, default: false },
  disabled: { type: Boolean, default: false },
});

const layoutClass = computed(() => props.prominent
  ? 'flex flex-col items-center justify-center text-center gap-1 w-full rounded-md'
  : 'inline-flex items-center justify-center gap-2 rounded-md'
);

const base = computed(() => [
  props.prominent ? 'py-3 font-bold' : 'font-medium',
  'transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-[#FF6600] disabled:opacity-50 disabled:cursor-not-allowed',
  layoutClass.value,
]);

const variantClass = computed(() => {
  switch (props.variant) {
    case 'primary':
      return props.prominent
        ? 'bg-[#FF6600] text-white hover:bg-[#e85d00] shadow-orange-900/10'
        : 'bg-[#FF6600] text-white hover:bg-[#e85d00] shadow-orange-900/10';
    case 'secondary':
      return props.prominent
        ? 'bg-white dark:bg-gray-800 hover:bg-gray-50 dark:hover:bg-gray-700 border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 shadow-sm'
        : 'bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-200 border border-gray-300 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-700';
    case 'success':
      return 'bg-emerald-600 text-white hover:bg-emerald-700 shadow-emerald-900/10';
    case 'ghost':
      return 'bg-transparent text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800 border border-transparent';
    default:
      return '';
  }
});

const sizeClass = computed(() => {
  if (props.prominent) return 'px-3 py-1.5 text-sm';
  switch (props.size) {
    case 'sm':
      return 'px-2.5 py-1 text-xs';
    case 'lg':
      return 'px-4 py-2.5 text-sm';
    default:
      return 'px-3 py-1.5 text-sm';
  }
});

const classes = computed(() => [
  base.value,
  variantClass.value,
  sizeClass.value,
  props.block ? 'w-full' : '',
]);
</script>
