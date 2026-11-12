<template>
  <!-- A Generate or an Export never ended last time (the tab ran out of memory, the browser or the
       app crashed): the settings as they were are offered back, and a report if the person wants
       one. All of it comes from this browser's own storage (services/sessionGuard.js). -->
  <div
    v-if="job" data-testid="unfinished-job" role="alert"
    class="fixed left-1/2 top-20 z-[100000] flex w-[min(92vw,36rem)] -translate-x-1/2 items-start gap-3 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-950 shadow-lg dark:border-amber-600 dark:bg-amber-950 dark:text-amber-50"
  >
    <div class="min-w-0 flex-1">
      <p class="font-semibold">{{ t('app.unfinished.title') }}</p>
      <p class="mt-0.5 leading-snug">{{ t(job.kind === 'export' ? 'app.unfinished.export' : 'app.unfinished.generate') }} <span v-if="job.code">{{ t('app.unfinished.kept') }}</span></p>
      <div class="mt-2 flex flex-wrap gap-2">
        <button v-if="job.code" type="button" class="rounded bg-brand px-3 py-1.5 text-xs font-semibold text-white hover:opacity-90" @click="restore">{{ t('app.unfinished.restore') }}</button>
        <button type="button" class="rounded border border-amber-400 px-3 py-1.5 text-xs font-semibold hover:bg-amber-100 dark:hover:bg-amber-900" @click="report">{{ t('app.unfinished.report') }}</button>
        <button type="button" class="rounded px-3 py-1.5 text-xs underline" @click="dismiss">{{ t('app.unfinished.dismiss') }}</button>
      </div>
    </div>
  </div>
</template>

<script setup>
import { onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { unfinishedJob, markJobEnd } from '../../services/sessionGuard.js';
import { openReportDialog } from '../../composables/useReportDialog.js';
import { desktopApp } from '../../services/platform/desktop.js';

const { t } = useI18n({ useScope: 'global' });
const job = ref(null);

onMounted(() => {
  const note = unfinishedJob();
  if (!note) return;
  // (read once: the note is taken away now, so the notice shows a single time)
  markJobEnd();
  job.value = note;
});

function restore() {
  // (the control panel shows what the code holds and asks before applying it: its usual review)
  window.dispatchEvent(new CustomEvent('mapng:restore-session-code', { detail: job.value.code }));
  job.value = null;
}
function report() {
  // (the desktop app has its own crash reports with the job's log; this one says what was running)
  openReportDialog(job.value.kind === 'export' ? 'export' : 'generate', {
    error: `${job.value.kind === 'export' ? 'An export' : 'A Generate'} was still running when ${desktopApp ? 'the app' : 'the page'} closed (build ${job.value.build || 'unknown'}).`,
    config: job.value.code || '',
  });
  job.value = null;
}
function dismiss() { job.value = null; }
</script>
