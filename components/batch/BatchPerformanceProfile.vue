<template>
  <SettingSection :title="t('batch.performanceProfile')" :icon="Gauge" storage-key="mapng_ui_sec_batchperf">
    <select
      :class="SELECT_MD"
      :value="modelValue"
      @change="$emit('update:modelValue', $event.target.value)"
    >
      <option value="throughput">{{ t('batch.profileThroughput') }}</option>
      <option value="balanced">{{ t('batch.profileBalanced') }}</option>
      <option value="low_memory">{{ t('batch.profileLowMemory') }}</option>
    </select>
    <p class="text-micro text-gray-500 dark:text-gray-400">
      {{ isDesktop ? t('batch.profileHelpDesktop') : t('batch.profileHelp') }}
    </p>
  </SettingSection>
</template>

<script setup>
import SettingSection from '../base/SettingSection.vue';
import { Gauge } from 'lucide-vue-next';
import { useI18n } from 'vue-i18n';
import { SELECT_MD } from '../base/controlStyles.js';
import { desktopApp } from '../../services/platform/desktop.js';

const { t } = useI18n({ useScope: 'global' });
const isDesktop = !!desktopApp;

defineProps({
  modelValue: { type: String, default: 'balanced' },
});

defineEmits(['update:modelValue']);
</script>
