<template>
  <label
    class="flex items-center justify-between gap-3 select-none"
    :class="disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer'"
  >
    <div class="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
      <slot />
    </div>
    <input
      type="checkbox"
      class="accent-brand w-4 h-4"
      :class="disabled ? 'cursor-not-allowed' : 'cursor-pointer'"
      :checked="modelValue"
      :disabled="disabled"
      @change="$emit('update:modelValue', $event.target.checked)"
    />
  </label>
</template>

<script setup>
defineProps({
  modelValue: { type: Boolean, default: false },
  disabled: { type: Boolean, default: false },
});

defineEmits(['update:modelValue']);
</script>
