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
      <option v-for="option in options" :key="option" :value="option">{{ formatOption(option) }}</option>
    </select>
    <div class="text-[10px] text-gray-500 dark:text-gray-400 pt-1 space-y-1">
      <slot></slot>
    </div>
  </div>
</template>

<script setup>
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';

import { VALID_SQUARE_EXPORT_RESOLUTIONS } from '../../services/uploadBounds';

const { t } = useI18n({ useScope: 'global' });

const props = defineProps({
  modelValue: { type: Number, required: true },
  label:      { type: String,  default: '' },
  disabled:   { type: Boolean, default: false },
  allowExperimental16384: { type: Boolean, default: false },
  maxResolution: { type: Number, default: null },
});
defineEmits(['update:modelValue']);

const options = computed(() => VALID_SQUARE_EXPORT_RESOLUTIONS.filter((value) => {
  if (!props.allowExperimental16384 && value === 16384) return false;
  if (Number.isFinite(props.maxResolution) && props.maxResolution > 0) {
    return value <= props.maxResolution;
  }
  return true;
}));

const formatOption = (option) => {
  if (option === 512) return `512 x 512 px (${t('map.resolutionFast')})`;
  if (option === 1024) return `1024 x 1024 px (${t('map.resolutionStandard')})`;
  if (option === 2048) return `2048 x 2048 px (${t('map.resolutionHighDetail')})`;
  if (option === 4096) return `4096 x 4096 px (${t('map.resolutionVeryHigh')})`;
  if (option === 8192) return `8192 x 8192 px (${t('map.resolutionUltra')})`;
  return `${option} x ${option} px (Experimental)`;
};
</script>
