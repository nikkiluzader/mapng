<template>
  <!-- A small set of exclusive choices as one segmented control (same look as
       the Basic / Advanced switch). -->
  <div class="grid gap-0.5 p-0.5 rounded-md bg-gray-100 dark:bg-gray-700" :style="{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }" role="radiogroup">
    <button
      v-for="option in options"
      :key="option.value"
      type="button"
      role="radio"
      :aria-checked="modelValue === option.value"
      :disabled="disabled"
      class="px-2 py-1 rounded text-[12px] font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
      :class="modelValue === option.value
        ? 'bg-white dark:bg-gray-900 text-[#FF6600] shadow-sm'
        : 'text-gray-600 dark:text-gray-300 hover:text-[#FF6600]'"
      @click="$emit('update:modelValue', option.value)"
    >{{ option.label }}</button>
  </div>
</template>

<script setup>
defineProps({
  options: { type: Array, required: true },   // [{ value, label }]
  modelValue: { type: [String, Number, Boolean], default: null },
  disabled: { type: Boolean, default: false },
});
defineEmits(['update:modelValue']);
</script>
