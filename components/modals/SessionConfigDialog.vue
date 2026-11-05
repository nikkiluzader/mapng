<template>
  <!-- A pasted / loaded / received MapNG config: what it would change, applied
       only on Apply (services/sessionConfig.js describeSessionConfig). -->
  <Teleport to="body">
    <div class="fixed inset-0 z-[10002] flex items-center justify-center bg-black/60 backdrop-blur-sm" @keydown.esc="$emit('cancel')">
      <div class="bg-white dark:bg-gray-900 rounded-2xl shadow-2xl border border-gray-200 dark:border-gray-700 w-[calc(100vw-2rem)] max-w-md max-h-[calc(100vh-2rem)] flex flex-col overflow-hidden" role="dialog" aria-modal="true">
        <div class="px-6 py-4 bg-gradient-to-r from-brand to-amber-500 text-white flex items-center gap-2">
          <ClipboardPaste :size="18" class="shrink-0" />
          <h2 class="text-base font-bold">{{ t('config.dialogTitle') }}</h2>
        </div>
        <div class="p-6 space-y-3 overflow-y-auto text-xs text-gray-700 dark:text-gray-200">
          <p>{{ t('config.dialogIntro') }}</p>
          <template v-for="section in sections" :key="section.id">
            <div v-if="section.rows.length">
              <div class="text-micro font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400 mb-1">{{ t(`config.section_${section.id}`) }}</div>
              <dl class="rounded border border-gray-200 dark:border-gray-700 divide-y divide-gray-100 dark:divide-gray-800">
                <div v-for="row in section.rows" :key="row.label" class="flex gap-3 px-3 py-1.5">
                  <dt class="w-32 shrink-0 text-gray-500 dark:text-gray-400">{{ t(row.label) }}</dt>
                  <dd class="min-w-0 flex-1 [overflow-wrap:anywhere]">
                    {{ valueText(row) }}
                    <span v-if="row.warn" class="block text-caption text-amber-600 dark:text-amber-400">{{ t(row.warn) }}</span>
                  </dd>
                </div>
              </dl>
            </div>
          </template>
          <p class="text-caption text-gray-500 dark:text-gray-400">{{ t('config.dialogNote') }}</p>
        </div>
        <div class="px-6 py-3 border-t border-gray-200 dark:border-gray-700 flex justify-end gap-2">
          <button type="button" class="px-3 py-1.5 rounded text-xs text-gray-600 dark:text-gray-300 hover:text-brand" @click="$emit('cancel')">{{ t('config.cancel') }}</button>
          <button ref="applyButton" type="button" class="px-4 py-1.5 rounded bg-brand hover:bg-brand-500 text-white text-xs font-semibold" @click="$emit('apply')">{{ t('config.apply') }}</button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup>
import { computed, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { ClipboardPaste } from 'lucide-vue-next';

const props = defineProps({ rows: { type: Array, default: () => [] } });
defineEmits(['apply', 'cancel']);
const { t } = useI18n();
const applyButton = ref(null);
onMounted(() => applyButton.value?.focus());

const sections = computed(() => ['data', 'export'].map((id) => ({ id, rows: props.rows.filter((r) => r.section === id) })));
const valueText = (row) => {
  if (!row.valueKey) return row.value;
  const params = { ...(row.params || {}) };
  if (Array.isArray(params.list)) params.list = params.list.map((k) => t(k)).join(', ');
  return t(row.valueKey, params);
};
</script>
