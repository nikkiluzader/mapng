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
      <span class="text-[12px] text-gray-700 dark:text-gray-200 min-w-0">{{ label }}</span>
      <input
        v-if="check"
        type="checkbox"
        :checked="modelValue && !disabled"
        :disabled="disabled"
        class="accent-[#FF6600] w-4 h-4 shrink-0"
        :class="disabled ? 'cursor-not-allowed' : 'cursor-pointer'"
        @change="$emit('update:modelValue', $event.target.checked)"
      />
      <div v-else class="flex items-center gap-1 shrink-0"><slot /></div>
    </div>
    <p v-if="disabled && disabledReason" class="mt-0.5 text-[11px] leading-snug text-amber-700 dark:text-amber-300">{{ disabledReason }}</p>
    <p v-else-if="hint" class="mt-0.5 text-[11px] leading-snug text-gray-500 dark:text-gray-400">{{ hint }}</p>
  </component>
</template>

<script setup>
defineProps({
  label: { type: String, required: true },
  hint: { type: String, default: '' },
  disabled: { type: Boolean, default: false },
  disabledReason: { type: String, default: '' },
  check: { type: Boolean, default: false },
  modelValue: { type: Boolean, default: false },
  indent: { type: Boolean, default: false },
});
defineEmits(['update:modelValue']);
</script>
