<template>
  <div class="space-y-1">
    <label v-if="label" class="text-xs text-gray-500 dark:text-gray-400">{{ label }}</label>
    <select
      :value="modelValue"
      :disabled="disabled"
      @change="$emit('update:modelValue', parseInt($event.target.value))"
      :class="[
        'w-full border rounded px-2 py-2 text-sm outline-none',
        disabled
          ? 'bg-gray-100 dark:bg-gray-700 border-gray-200 dark:border-gray-600 text-gray-400 dark:text-gray-500 cursor-not-allowed'
          : 'bg-white dark:bg-gray-800 border-gray-300 dark:border-gray-600 text-gray-900 dark:text-white focus:ring-2 focus:ring-[#FF6600] focus:border-[#FF6600]',
      ]"
    >
      <option :value="512">512 x 512 px ({{ t('map.resolutionFast') }})</option>
      <option :value="1024">1024 x 1024 px ({{ t('map.resolutionStandard') }})</option>
      <option :value="2048">2048 x 2048 px ({{ t('map.resolutionHighDetail') }})</option>
      <option :value="4096">4096 x 4096 px ({{ t('map.resolutionVeryHigh') }})</option>
      <option :value="8192">8192 x 8192 px ({{ t('map.resolutionUltra') }})</option>
      <option v-if="allowExperimental16384" :value="16384">16384 x 16384 px (Experimental)</option>
    </select>
    <div class="text-[10px] text-gray-500 dark:text-gray-400 pt-1 space-y-1">
      <slot></slot>
    </div>
  </div>
</template>

<script setup>
import { useI18n } from 'vue-i18n';

const { t } = useI18n({ useScope: 'global' });

defineProps({
  modelValue: { type: Number, required: true },
  label:      { type: String,  default: '' },
  disabled:   { type: Boolean, default: false },
  allowExperimental16384: { type: Boolean, default: false },
});
defineEmits(['update:modelValue']);
</script>
