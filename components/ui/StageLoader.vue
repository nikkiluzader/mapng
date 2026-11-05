<template>
  <!-- A progress card that feels like BeamNG.drive's level loading screen: a
       row of stage tiles (done and current filled orange, the rest outlined),
       one slanted bar that runs start to finish for each stage, the stage's
       name in big italics, and the latest lines underneath. -->
  <div class="stage-loader w-[min(30rem,calc(100vw-2rem))] rounded-2xl bg-white border border-gray-200 dark:bg-gray-950/95 dark:border-white/10 shadow-2xl p-6 text-left text-gray-900 dark:text-white">
    <div class="flex items-center justify-between gap-3 mb-4">
      <span class="font-display text-caption font-semibold uppercase tracking-[0.12em] text-gray-500 dark:text-white/50">{{ title }}</span>
      <span class="font-mono text-caption text-brand dark:text-brand-300">{{ pct }}%</span>
    </div>

    <!-- Stage tiles -->
    <div class="grid gap-2" :style="{ gridTemplateColumns: `repeat(${visibleSteps.length}, minmax(0, 1fr))` }">
      <div
        v-for="(step, i) in visibleSteps"
        :key="step.key"
        class="aspect-square max-h-14 rounded-lg flex items-center justify-center transition-colors duration-300"
        :class="i <= activeIndex
          ? 'bg-brand text-white shadow-[0_0_18px_rgba(255,102,0,0.35)]'
          : 'border-2 border-brand/70 text-brand bg-brand-50/40 dark:text-white/80 dark:bg-black/30'"
        :title="step.label"
      >
        <component :is="step.icon" :size="24" :stroke-width="2.25" />
      </div>
    </div>

    <!-- The stage's own bar: fills, then starts over for the next stage -->
    <div class="stage-loader__track mt-3" role="progressbar" :aria-valuenow="Math.round(stageFraction * 100)" aria-valuemin="0" aria-valuemax="100" :aria-label="activeStep?.label">
      <div class="stage-loader__fill" :style="{ width: `${Math.round(stageFraction * 100)}%` }"></div>
    </div>

    <!-- Stage name -->
    <div class="mt-3 h-11 flex items-center">
      <!-- (line height with room for descenders: truncate clips the g, p, y otherwise) -->
      <span class="text-[28px] leading-[1.3] pr-1 font-bold italic text-gray-800 dark:text-white/90 truncate">{{ activeStep?.label }}</span>
    </div>

    <!-- Latest lines: finished steps, then what is running now -->
    <div class="mt-3 h-[88px] flex flex-col justify-end gap-0.5 overflow-hidden text-xs leading-snug">
      <div v-for="(line, i) in doneLines" :key="i" class="flex justify-between gap-3 text-gray-400 dark:text-white/45">
        <span class="min-w-0 flex-1 truncate" :title="line.step">{{ line.step }}</span>
        <span class="font-mono shrink-0">{{ formatDuration(line.durationMs) }}</span>
      </div>
      <div class="text-gray-700 dark:text-white/80 truncate" :title="status">{{ status }}</div>
    </div>

    <div class="mt-4 pt-3 border-t border-gray-200 dark:border-white/10 flex items-center justify-between gap-3">
      <button
        v-if="cancellable"
        type="button"
        class="px-4 py-1.5 rounded-lg text-xs font-medium text-gray-700 border border-gray-300 hover:border-brand hover:text-brand dark:text-white/80 dark:border-white/20 dark:hover:text-white transition-colors"
        @click="$emit('cancel')"
      >
        {{ cancelLabel }}
      </button>
      <span class="ml-auto font-mono text-micro text-gray-400 dark:text-white/45">{{ elapsedLabel }} {{ formatDuration(elapsedMs) }}</span>
    </div>
  </div>
</template>

<script setup>
import { computed } from 'vue';
import '@fontsource-variable/noto-sans/wght-italic.css';

const props = defineProps({
  title: { type: String, default: '' },
  // [{ key, label, icon, members: [[fineStage, weight], ...] }] in pipeline order
  steps: { type: Array, required: true },
  activeStage: { type: String, default: null },   // the fine stage running now
  activeFraction: { type: Number, default: 0 },   // 0..1 of that fine stage
  pct: { type: Number, default: 0 },              // overall percent
  status: { type: String, default: '' },
  done: { type: Array, default: () => [] },       // [{ step, durationMs }]
  elapsedMs: { type: Number, default: 0 },
  elapsedLabel: { type: String, default: '' },
  cancellable: { type: Boolean, default: false },
  cancelLabel: { type: String, default: 'Cancel' },
});
defineEmits(['cancel']);

// stages with no work in this run (no OSM, no upload) are not shown
const visibleSteps = computed(() => props.steps.filter((s) => s.members.some(([, w]) => w > 0)));
const activeIndex = computed(() => {
  const i = visibleSteps.value.findIndex((s) => s.members.some(([k]) => k === props.activeStage));
  return i < 0 ? 0 : i;
});
const activeStep = computed(() => visibleSteps.value[activeIndex.value]);
// the share of the current stage done: its finished members plus the running one
const stageFraction = computed(() => {
  const step = activeStep.value;
  if (!step) return 0;
  const total = step.members.reduce((sum, [, w]) => sum + Math.max(0, w), 0) || 1;
  let before = 0;
  for (const [key, w] of step.members) {
    if (key === props.activeStage) return Math.min(1, (before + Math.max(0, w) * Math.min(1, Math.max(0, props.activeFraction))) / total);
    before += Math.max(0, w);
  }
  return 0;
});
const doneLines = computed(() => props.done.slice(-4));

const formatDuration = (ms) => {
  if (!Number.isFinite(ms)) return '';
  if (ms < 1000) return `${Math.round(ms)} ms`;
  const sec = Math.round(ms / 1000);
  return sec < 60 ? `${sec} s` : `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
};
</script>

<style scoped>
/* the slanted bar of the game's loading screen */
.stage-loader__track {
  height: 14px;
  background: #e5e7eb;
  clip-path: polygon(0 0, 100% 0, calc(100% - 10px) 100%, 0 100%);
  overflow: hidden;
}
:global(.dark) .stage-loader__track { background: rgba(255, 255, 255, 0.08); }
.stage-loader__fill {
  height: 100%;
  background: var(--brand);
  clip-path: polygon(0 0, 100% 0, calc(100% - 10px) 100%, 0 100%);
  transition: width 0.4s ease-out;
}
</style>
