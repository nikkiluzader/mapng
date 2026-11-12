<template>
  <!-- A progress card that feels like BeamNG.drive's level loading screen: a
       row of stage tiles (done and current filled orange, the rest outlined),
       one slanted bar that runs start to finish for each stage, the stage's
       name in big italics, and the latest lines underneath. -->
  <div class="stage-loader w-[min(30rem,calc(100vw-2rem))] rounded-2xl bg-white border border-gray-200 dark:bg-gray-950/95 dark:border-white/10 shadow-2xl p-6 text-left text-gray-900 dark:text-white">
    <div class="flex items-center justify-between gap-3 mb-4">
      <span class="font-display text-caption font-semibold uppercase tracking-[0.12em] text-gray-500 dark:text-white/50">{{ title }}</span>
      <span class="font-mono text-caption text-brand dark:text-brand-300 tabular-nums">{{ shownPct }}%</span>
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
    <div class="stage-loader__track mt-3" role="progressbar" :aria-valuenow="Math.round(shownStageFraction * 100)" aria-valuemin="0" aria-valuemax="100" :aria-label="activeStep?.label">
      <div class="stage-loader__fill" :style="{ width: `${(shownStageFraction * 100).toFixed(1)}%` }"></div>
    </div>

    <!-- Stage name -->
    <div class="mt-3 h-11 flex items-center">
      <!-- (line height with room for descenders: truncate clips the g, p, y otherwise) -->
      <span class="text-[28px] leading-[1.3] pr-1 font-bold italic text-gray-800 dark:text-white/90 truncate">{{ activeStep?.label }}</span>
    </div>

    <!-- Latest lines: finished steps, then what is running now -->
    <div class="mt-3 h-[88px] flex flex-col justify-end gap-0.5 overflow-hidden text-xs leading-snug">
      <div v-for="(line, i) in doneLines" :key="i" class="flex justify-between gap-3 text-gray-400 dark:text-white/45">
        <span class="min-w-0 flex-1 truncate" :title="tidy(line.step)">{{ tidy(line.step) }}</span>
        <span class="font-mono shrink-0">{{ formatDuration(line.durationMs) }}</span>
      </div>
      <div class="text-gray-700 dark:text-white/80 truncate" :title="tidy(status)">{{ tidy(status) }}</div>
    </div>

    <!-- The settings this run uses (export): closed until opened -->
    <details v-if="settings?.length" class="stage-loader__settings mt-4 pt-3 border-t border-gray-200 dark:border-white/10" @toggle="settingsOpen = $event.target.open">
      <summary class="flex items-center justify-between gap-3 cursor-pointer select-none font-display text-caption font-semibold uppercase tracking-[0.12em] hover:text-brand" :class="settingsOpen ? 'text-brand dark:text-brand-300' : 'text-gray-500 dark:text-white/50'">
        <span>{{ settingsLabel }} ({{ settingCount }})</span>
        <ChevronRight :size="14" class="transition-transform" :class="settingsOpen ? 'rotate-90' : ''" />
      </summary>
      <div class="mt-2 grid grid-cols-2 gap-x-4 max-h-60 overflow-y-auto pr-1">
        <div v-for="group in settings" :key="group.title" class="min-w-0">
          <div class="mt-2 mb-0.5 font-display text-nano font-semibold uppercase tracking-[0.14em] text-brand dark:text-brand-300">{{ group.title }}</div>
          <div v-for="row in group.rows" :key="row.label" class="flex justify-between gap-2 py-0.5 border-b border-dashed border-gray-200 dark:border-white/10 text-micro">
            <span class="text-gray-500 dark:text-white/50 truncate" :title="row.label">{{ row.label }}</span>
            <span class="text-right truncate" :class="row.off ? 'text-gray-400 dark:text-white/35' : 'text-gray-800 dark:text-white/85'" :title="row.value">{{ row.value }}</span>
          </div>
        </div>
      </div>
    </details>

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
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import '@fontsource-variable/noto-sans/wght-italic.css';
import { ChevronRight } from 'lucide-vue-next';
import { useI18n } from 'vue-i18n';
import { localizeStatus } from '../../services/statusLines.js';

const props = defineProps({
  title: { type: String, default: '' },
  // [{ key, label, icon, members: [[fineStage, weight], ...] }] in pipeline order
  steps: { type: Array, required: true },
  activeStage: { type: String, default: null },   // the fine stage running now
  activeFraction: { type: Number, default: 0 },   // 0..1 of that fine stage, as reported
  pct: { type: Number, default: 0 },              // overall percent, as reported
  status: { type: String, default: '' },
  done: { type: Array, default: () => [] },       // [{ step, durationMs }]
  elapsedMs: { type: Number, default: 0 },
  elapsedLabel: { type: String, default: '' },
  cancellable: { type: Boolean, default: false },
  cancelLabel: { type: String, default: 'Cancel' },
  // [{ title, rows: [{ label, value, off }] }]: the run's settings, shown in a closed section
  settings: { type: Array, default: () => [] },
  settingsLabel: { type: String, default: 'Settings used' },
  // the run is done: the card runs on to 100 % (a few tenths of a second) before
  // whoever shows it takes it away, where it used to vanish wherever its eased
  // number had got to (74 % on a four-second run)
  finished: { type: Boolean, default: false },
});
defineEmits(['cancel']);

// stages with no work in this run (no OSM, no upload, raw terrain) are not shown
const visibleSteps = computed(() => props.steps.filter((s) => s.members.some(([, w]) => w > 0)));
const activeIndex = computed(() => {
  const i = visibleSteps.value.findIndex((s) => s.members.some(([k]) => k === props.activeStage));
  return i < 0 ? 0 : i;
});
const activeStep = computed(() => visibleSteps.value[activeIndex.value]);
const doneLines = computed(() => props.done.slice(-4));
const settingsOpen = ref(false);
const settingCount = computed(() => props.settings.reduce((n, g) => n + (g.rows?.length || 0), 0));

// ---- smooth, paced progress ---------------------------------------------------
// Reports come in bursts: a percent now and then, long silent steps, steps that
// end early. Between them each fine stage creeps on by the time it has taken
// against the time it should take (its weight × this run's own seconds per unit
// of weight so far): ~85 % of the stage at that time, then on slowly toward 99 %;
// a report moves it on at once. The overall percent follows from the
// same weights and eases toward its target, never backwards, never 100 before
// the end.
const fine = computed(() => props.steps.flatMap((s) => s.members.map(([k, w]) => [k, Math.max(0, Number(w) || 0)])));
const totalWeight = computed(() => fine.value.reduce((sum, [, w]) => sum + w, 0) || 1);
const indexOf = (stage) => fine.value.findIndex(([k]) => k === stage);

const startedAt = performance.now();
let stageStartedAt = startedAt;
let trackedStage = null;
let stageCreep = 0;              // shown share of the running fine stage (never backwards within it)
const shown = ref(0);            // overall 0..1, eased
const shownStage = ref(0);       // the stage card's own bar, 0..1, eased
let target = 0;
let targetStage = 0;

const weightBefore = (i) => fine.value.slice(0, Math.max(0, i)).reduce((sum, [, w]) => sum + w, 0);
const secondsPerWeight = () => {
  const i = indexOf(trackedStage);
  const done = weightBefore(i);
  const elapsed = (performance.now() - startedAt) / 1000;
  // (this run's pace once a few seconds of it are known; one second a unit till then)
  return done > 0 && elapsed > 2 ? Math.min(30, Math.max(0.1, (elapsed - (performance.now() - stageStartedAt) / 1000) / done)) : 1;
};

const recompute = () => {
  if (props.finished) { target = 1; targetStage = 1; return; }
  const now = performance.now();
  if (props.activeStage !== trackedStage) {
    // (a later stage: the earlier one is done; the bar starts over for the new card stage)
    trackedStage = props.activeStage;
    stageStartedAt = now;
    stageCreep = 0;
  }
  const i = indexOf(trackedStage);
  const w = i >= 0 ? fine.value[i][1] : 0;
  const expected = Math.max(0.3, w * secondsPerWeight());
  // (~85 % by the expected time, then on slowly toward 99 %: never frozen, never done early)
  const t = (now - stageStartedAt) / 1000 / expected;
  const creep = 0.9 * (1 - Math.exp(-2.3 * t)) + 0.09 * (1 - Math.exp(-t / 6));
  stageCreep = Math.min(1, Math.max(stageCreep, creep, Number(props.activeFraction) || 0));
  // overall: the weights done plus the running stage's share, or the reported percent if that is further
  const fromWeights = i >= 0 ? (weightBefore(i) + w * stageCreep) / totalWeight.value : 0;
  target = Math.min(0.995, Math.max(target, fromWeights, (Number(props.pct) || 0) / 100));
  // the card stage's bar: its finished members plus the running one
  const step = activeStep.value;
  if (step) {
    const total = step.members.reduce((sum, [, mw]) => sum + Math.max(0, mw), 0) || 1;
    let before = 0;
    for (const [key, mw] of step.members) {
      if (key === trackedStage) { targetStage = Math.min(1, (before + Math.max(0, mw) * stageCreep) / total); break; }
      before += Math.max(0, mw);
    }
  }
};

let frame = 0;
let lastFrameAt = performance.now();
let lastStepKey = null;
const animate = () => {
  const now = performance.now();
  const dt = Math.min(0.25, (now - lastFrameAt) / 1000);
  lastFrameAt = now;
  recompute();
  // ease: about half the gap closed every quarter second, and never faster
  // than 25 points a second (a stage that ends early slides on, not jumps)
  const k = 1 - Math.exp(-dt * (props.finished ? 14 : 2.8));
  // (done: to the end briskly, whatever is left of it)
  shown.value = props.finished ? Math.min(1, shown.value + Math.max((1 - shown.value) * k, 2.5 * dt))
    : Math.max(shown.value, shown.value + Math.min((target - shown.value) * k, 0.25 * dt));
  const stepKey = activeStep.value?.key ?? null;
  if (stepKey !== lastStepKey) { lastStepKey = stepKey; shownStage.value = 0; }
  shownStage.value = Math.max(shownStage.value, shownStage.value + (targetStage - shownStage.value) * k);
  frame = requestAnimationFrame(animate);
};
onMounted(() => { frame = requestAnimationFrame(animate); });
onBeforeUnmount(() => cancelAnimationFrame(frame));
// (a report jumps the targets at once; the frame loop eases toward them)
watch(() => [props.activeStage, props.activeFraction, props.pct, props.finished], recompute);
// (a new card stage: its bar starts over in the same update as its name, not
// a frame later with the old stage's fill under the new name)
watch(() => activeStep.value?.key ?? null, (key) => { lastStepKey = key; shownStage.value = 0; targetStage = 0; }, { flush: 'sync' });

const shownPct = computed(() => (props.finished && shown.value >= 0.999 ? 100 : Math.min(99, Math.floor(shown.value * 100))));
const shownStageFraction = computed(() => shownStage.value);

// (the reports come from many places: three dots or the ellipsis character; one kind shown)
// and in the app's language (services/statusLines.js: the code reports in English)
const { t: translate, locale } = useI18n();
const tidy = (text) => {
  const line = String(text ?? '').replace(/\.{3}/g, '…');
  return locale.value === 'en' ? line : localizeStatus(line, (key, values) => translate(`statusLines.${key}`, values));
};

const formatDuration = (ms) => {
  if (!Number.isFinite(ms)) return '';
  if (ms < 1000) return `${Math.round(ms)} ms`;
  const sec = Math.round(ms / 1000);
  return sec < 60 ? `${sec} s` : `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
};
</script>

<style scoped>
/* the slanted bar of the game's loading screen */
.stage-loader__settings > summary { list-style: none; }
.stage-loader__settings > summary::-webkit-details-marker { display: none; }
.stage-loader__track {
  height: 14px;
  background: #e5e7eb;
  clip-path: polygon(0 0, 100% 0, calc(100% - 10px) 100%, 0 100%);
  overflow: hidden;
}
:global(.dark) .stage-loader__settings > summary { list-style: none; }
.stage-loader__settings > summary::-webkit-details-marker { display: none; }
.stage-loader__track { background: rgba(255, 255, 255, 0.08); }
.stage-loader__fill {
  height: 100%;
  background: var(--brand);
  clip-path: polygon(0 0, 100% 0, calc(100% - 10px) 100%, 0 100%);
}
</style>
