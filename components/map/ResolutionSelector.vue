<template>
  <div class="space-y-1">
    <label v-if="label" class="text-xs text-gray-500 dark:text-gray-400">{{ label }}</label>
    <select
      :value="modelValue"
      :disabled="disabled"
      @change="$emit('update:modelValue', parseInt($event.target.value))"
      :class="SELECT_MD"
    >
      <option v-for="option in options" :key="option" :value="option">{{ formatOption(option) }}</option>
    </select>
    <div class="text-micro text-gray-500 dark:text-gray-400 pt-1 space-y-1">
      <slot></slot>
    </div>
  </div>
</template>

<script setup>
import { computed } from 'vue';

import { VALID_SQUARE_EXPORT_RESOLUTIONS } from '../../services/uploadBounds';
import { SELECT_MD } from '../base/controlStyles.js';

const props = defineProps({
  modelValue: { type: Number, required: true },
  label:      { type: String,  default: '' },
  disabled:   { type: Boolean, default: false },
  maxResolution: { type: Number, default: null },
});
defineEmits(['update:modelValue']);

const options = computed(() => VALID_SQUARE_EXPORT_RESOLUTIONS.filter((value) => {
  if (Number.isFinite(props.maxResolution) && props.maxResolution > 0) {
    return value <= props.maxResolution;
  }
  return true;
}));

const formatOption = (option) => {
  return `${option} x ${option} px`;
};
</script>
