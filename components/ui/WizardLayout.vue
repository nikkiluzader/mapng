<template>
  <!-- The control panel as a wizard: the mode switch, a stepper, one step's
       settings (scrolling), and a bottom bar that is always there (what the
       button will build, and the button). Single tile and batch alike.
       Every step stays mounted (v-show in the panel): switching steps keeps
       what was typed, and the export panel keeps its state. -->
  <div class="flex-1 min-h-0 flex flex-col">
    <!-- the mode switch under Single tile / Batch job: Basic/Advanced, or Separate tiles/Combined level -->
    <div v-if="$slots.bar" class="px-3 py-2 border-b border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900">
      <slot name="bar" />
    </div>

    <!-- the steps -->
    <nav
      class="grid border-b border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900"
      :style="{ gridTemplateColumns: `repeat(${steps.length}, minmax(0, 1fr))` }"
      role="tablist"
      :aria-label="t('wizard.steps')"
    >
      <button
        v-for="(step, i) in steps"
        :key="step.key || i"
        type="button"
        role="tab"
        :aria-selected="modelValue === i + 1"
        :disabled="step.locked"
        :title="step.locked ? step.lockedReason : step.label"
        class="flex flex-col items-center gap-0.5 px-1 pt-2 pb-1.5 border-b-[3px] text-caption font-semibold transition-colors min-w-0"
        :class="modelValue === i + 1
          ? 'border-brand text-brand'
          : step.locked
            ? 'border-transparent text-gray-300 dark:text-gray-600 cursor-not-allowed'
            : 'border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-100'"
        @click="go(i + 1)"
      >
        <span
          class="w-5 h-5 rounded-full border-2 flex items-center justify-center font-display text-micro font-bold"
          :class="modelValue === i + 1
            ? 'bg-brand border-brand text-white'
            : step.done
              ? 'border-brand text-brand'
              : step.locked ? 'border-gray-200 dark:border-gray-700' : 'border-gray-300 dark:border-gray-600'"
        >
          <Check v-if="step.done && modelValue !== i + 1" :size="11" :stroke-width="3" />
          <Lock v-else-if="step.locked" :size="10" />
          <template v-else>{{ i + 1 }}</template>
        </span>
        <span class="truncate max-w-full">{{ step.label }}</span>
      </button>
    </nav>

    <!-- this step's settings -->
    <div ref="scroller" class="flex-1 min-h-0 overflow-y-auto custom-scrollbar bg-gray-50/50 dark:bg-gray-800/50 p-5">
      <slot :step="modelValue" />
      <div class="flex items-center justify-between pt-5">
        <button
          type="button"
          class="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-xs font-semibold text-gray-700 dark:text-gray-200 hover:border-brand hover:text-brand transition-colors"
          :class="{ invisible: modelValue <= 1 }"
          @click="go(modelValue - 1)"
        ><ChevronLeft :size="14" />{{ t('wizard.back') }}</button>
        <button
          type="button"
          class="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-xs font-semibold text-gray-700 dark:text-gray-200 hover:border-brand hover:text-brand transition-colors"
          :class="{ invisible: !nextOpen }"
          @click="go(modelValue + 1)"
        >{{ t('wizard.next') }}<ChevronRight :size="14" /></button>
      </div>
    </div>

    <!-- always there: what will be built, and the button -->
    <div v-if="$slots.footer" class="px-4 pt-2.5 pb-3 border-t border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 space-y-2">
      <slot name="footer" :step="modelValue" />
    </div>
  </div>
</template>

<script setup>
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { Check, ChevronLeft, ChevronRight, Lock } from 'lucide-vue-next';

const props = defineProps({
  // [{ key, label, done?, locked?, lockedReason? }]
  steps: { type: Array, required: true },
  // the step shown, from 1
  modelValue: { type: Number, default: 1 },
});
const emit = defineEmits(['update:modelValue']);
const { t } = useI18n({ useScope: 'global' });

const scroller = ref(null);
const go = (n) => {
  const step = props.steps[n - 1];
  if (!step || step.locked) return;
  emit('update:modelValue', n);
};
const nextOpen = computed(() => {
  const next = props.steps[props.modelValue];
  return !!next && !next.locked;
});
// (a new step starts at its top)
watch(() => props.modelValue, () => { if (scroller.value) scroller.value.scrollTop = 0; }, { flush: 'post' });

defineExpose({ scroller });
</script>
