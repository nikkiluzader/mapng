<template>
  <!-- Desktop app: send a crash / problem report? Shows exactly what would be
       sent; nothing leaves the computer unless the user chooses Send.
       (composables/useReportDialog.js, desktop/crashReports.js) -->
  <Teleport to="body">
    <div v-if="request" class="fixed inset-0 z-[10002] flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div class="bg-white dark:bg-gray-900 rounded-2xl shadow-2xl border border-gray-200 dark:border-gray-700 w-[calc(100vw-2rem)] max-w-lg max-h-[calc(100vh-2rem)] flex flex-col overflow-hidden" role="dialog" aria-modal="true">
        <div class="px-6 py-4 bg-gradient-to-r from-brand to-amber-500 text-white flex items-center gap-2">
          <LifeBuoy :size="18" class="shrink-0" />
          <h2 class="text-base font-bold">{{ t(`report.title_${request.kind}`) }}</h2>
        </div>

        <div class="p-6 space-y-3 overflow-y-auto text-xs text-gray-700 dark:text-gray-200">
          <template v-if="sent">
            <p class="flex items-center gap-2 font-medium text-emerald-700 dark:text-emerald-400"><CheckCircle2 :size="16" />{{ t('report.sent') }}</p>
            <div class="flex items-center gap-2">
              <code class="px-2 py-1 rounded bg-gray-100 dark:bg-gray-800 font-mono text-sm font-semibold">{{ sent }}</code>
              <button type="button" class="px-2 py-1 text-caption rounded border border-gray-300 dark:border-gray-600 hover:border-brand hover:text-brand" @click="copyId">{{ copied ? t('report.copied') : t('report.copy') }}</button>
            </div>
            <p class="text-caption text-gray-500 dark:text-gray-400">{{ t('report.sentHint') }}</p>
          </template>

          <template v-else>
            <p>{{ t('report.intro') }}</p>
            <p v-if="request.ctx.error" class="p-2 rounded bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-300 text-caption [overflow-wrap:anywhere]">{{ request.ctx.error }}</p>

            <label class="block">
              <span class="text-caption font-medium">{{ request.kind === 'manual' ? t('report.describeManual') : t('report.describe') }}</span>
              <textarea v-model="description" rows="3" maxlength="4000" class="mt-1 w-full rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-brand" />
            </label>

            <label v-if="preview?.area" class="flex items-start gap-2 cursor-pointer select-none">
              <input v-model="includeArea" type="checkbox" class="mt-0.5 accent-brand" />
              <span>{{ t('report.includeArea', { lat: Number(preview.area.lat).toFixed(4), lng: Number(preview.area.lng).toFixed(4) }) }}</span>
            </label>

            <p v-if="preparing" class="flex items-center gap-2 text-caption text-gray-500"><Loader2 :size="12" class="animate-spin" />{{ t('report.preparing') }}</p>
            <details v-else-if="preview" class="rounded border border-gray-200 dark:border-gray-700 px-3 py-2">
              <summary class="cursor-pointer text-caption font-medium hover:text-brand">{{ t('report.whatsIncluded') }}</summary>
              <ul class="mt-2 space-y-1 text-caption text-gray-600 dark:text-gray-300">
                <li>{{ t('report.incApp', { version: preview.appVersion }) }}</li>
                <li>{{ t('report.incSystem', { os: preview.os, ram: preview.memory?.totalGB, cpus: preview.memory?.cpus }) }}</li>
                <li v-if="preview.error">{{ t('report.incError') }}</li>
                <li v-if="preview.logChars">{{ t('report.incLog', { kb: Math.max(1, Math.round(preview.logChars / 1024)) }) }}</li>
                <li v-if="preview.hasOptions">{{ t('report.incOptions') }}</li>
                <li v-if="preview.dumpBytes">{{ t('report.incDump', { kb: Math.max(1, Math.round(preview.dumpBytes / 1024)) }) }}</li>
                <li v-if="preview.area && includeArea">{{ t('report.incArea') }}</li>
                <li v-if="preview.hasConfig && (includeArea || !preview.area)">{{ t('report.incConfig') }}</li>
                <li v-if="description.trim()">{{ t('report.incDescription') }}</li>
                <li class="text-gray-500 dark:text-gray-400">{{ t('report.incNever') }}</li>
              </ul>
              <pre v-if="preview.logTail" class="mt-2 max-h-40 overflow-auto rounded bg-gray-100 dark:bg-gray-800 p-2 text-micro leading-snug whitespace-pre-wrap">{{ preview.logTail }}</pre>
              <a href="https://mapng.com/data.html#reports" target="_blank" rel="noopener" class="mt-2 inline-block text-caption text-brand hover:underline">{{ t('report.privacy') }}</a>
            </details>
            <p v-if="failed" class="text-caption text-red-600 dark:text-red-400">{{ failed }}</p>
          </template>
        </div>

        <div class="px-6 py-3 border-t border-gray-200 dark:border-gray-700 flex justify-end gap-2">
          <template v-if="sent">
            <button type="button" class="px-4 py-1.5 rounded bg-brand hover:bg-brand-500 text-white text-xs font-semibold" @click="close">{{ t('report.done') }}</button>
          </template>
          <template v-else>
            <button type="button" class="px-3 py-1.5 rounded text-xs text-gray-600 dark:text-gray-300 hover:text-brand" :disabled="sending" @click="dontSend">{{ t('report.dontSend') }}</button>
            <button type="button" class="px-4 py-1.5 rounded bg-brand hover:bg-brand-500 text-white text-xs font-semibold disabled:opacity-50" :disabled="!token || sending || (request.kind === 'manual' && !description.trim())" @click="send">
              <Loader2 v-if="sending" :size="12" class="inline animate-spin mr-1" />{{ t('report.send') }}
            </button>
          </template>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup>
/* global __BUILD_HASH__ */
import { ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { CheckCircle2, LifeBuoy, Loader2 } from 'lucide-vue-next';
import { desktopApp } from '../../services/platform/desktop.js';
import { currentSessionCode, useReportDialog } from '../../composables/useReportDialog.js';

const { t } = useI18n();
const { request, closeReportDialog } = useReportDialog();
const preview = ref(null);
const token = ref(null);
const preparing = ref(false);
const sending = ref(false);
const sent = ref(null);
const failed = ref('');
const copied = ref(false);
const description = ref('');
const includeArea = ref(true);

watch(request, async (req) => {
  preview.value = null; token.value = null; sent.value = null; failed.value = ''; copied.value = false;
  description.value = req?.ctx?.description || '';
  includeArea.value = true;
  if (!req || !desktopApp?.prepareReport) return;
  preparing.value = true;
  try {
    const config = req.ctx.config ?? await currentSessionCode();
    const r = await desktopApp.prepareReport(req.kind, { ...req.ctx, config, build: typeof __BUILD_HASH__ !== 'undefined' ? __BUILD_HASH__ : '' });
    token.value = r.token; preview.value = r.preview;
  } catch (error) {
    failed.value = String(error?.message || error).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
  } finally { preparing.value = false; }
});

async function send() {
  sending.value = true; failed.value = '';
  try {
    const r = await desktopApp.sendReport(token.value, { includeArea: includeArea.value, description: description.value, kind: request.value.kind });
    sent.value = r.id;
  } catch (error) {
    failed.value = String(error?.message || error).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
  } finally { sending.value = false; }
}

async function dontSend() {
  try { await desktopApp.dismissReport(request.value.kind); } catch { /* none */ }
  close();
}
function close() { closeReportDialog(); }
async function copyId() {
  try { await navigator.clipboard.writeText(sent.value); copied.value = true; } catch { /* clipboard blocked */ }
}
</script>
