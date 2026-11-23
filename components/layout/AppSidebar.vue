<template>
  <aside class="w-full md:w-80 lg:w-96 flex-shrink-0 flex flex-col border-r border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 z-10 relative shadow-xl">
    <div class="p-5 border-b border-gray-200 dark:border-gray-700 flex items-center gap-3 bg-white dark:bg-gray-900">
      <div class="p-1.5 bg-brand rounded-lg">
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" class="w-7 h-7">
          <g fill="white" opacity="0.95">
            <polygon points="15,75 35,35 55,75" />
            <polygon points="40,75 60,25 85,75" />
            <line x1="10" y1="80" x2="90" y2="80" stroke="white" stroke-width="2" opacity="0.5" />
            <line x1="10" y1="85" x2="90" y2="85" stroke="white" stroke-width="1.5" opacity="0.3" />
          </g>
        </svg>
      </div>
      <div>
        <h1 class="text-xl font-bold tracking-tight text-gray-900 dark:text-white">MapNG</h1>
        <p class="text-xs text-gray-500 dark:text-gray-400">{{ t('sidebar.tagline') }}</p>
      </div>
      <!-- Share & load settings (components/modals/ShareDialog.vue, shown by the active panel) -->
      <BaseButton
        size="sm"
        variant="ghost"
        class="ml-auto text-gray-400 hover:text-brand transition-colors p-1 rounded-full hover:bg-brand-50/60 dark:hover:bg-gray-800"
        :title="t('config.shareDialogTitle')"
        :aria-label="t('config.shareDialogTitle')"
        @click="openShareDialog"
      >
        <Share2 :size="18" />
      </BaseButton>
      <!-- Reset (services/resetApp.js): every setting, the place, tiles and road back to the start. Web and desktop.
           (The desktop app's reload is still View → Reload / Ctrl+R.) -->
      <BaseButton
        data-testid="reset-app"
        size="sm"
        variant="ghost"
        class="text-gray-400 hover:text-brand transition-colors p-1 rounded-full hover:bg-brand-50/60 dark:hover:bg-gray-800 disabled:opacity-40 disabled:cursor-not-allowed"
        :disabled="heavyJobRunning"
        :title="heavyJobRunning ? t('sidebar.resetBusy') : t('sidebar.resetTooltip')"
        :aria-label="t('sidebar.resetTooltip')"
        @click="askReset"
      >
        <RotateCcw :size="18" />
      </BaseButton>
      <!-- Support MapNG (Ko-fi: components/modals/SupportTipModal.vue) -->
      <BaseButton
        data-testid="support-heart"
        size="sm"
        variant="ghost"
        class="text-gray-400 hover:text-brand transition-colors p-1 rounded-full hover:bg-brand-50/60 dark:hover:bg-gray-800"
        :title="t('support.cardTitle')"
        :aria-label="t('support.cardTitle')"
        @click="$emit('show-support')"
      >
        <Heart :size="18" />
      </BaseButton>
      <BaseButton
        size="sm"
        variant="ghost"
        :class="['text-gray-400 hover:text-brand transition-colors p-1 rounded-full hover:bg-brand-50/60 dark:hover:bg-gray-800']"
        :title="t('sidebar.aboutTooltip')"
        @click="$emit('show-about')"
      >
        <CircleHelp :size="20" />
      </BaseButton>
    </div>

    <!-- Batch jobs are retired (tiles in step 1): this bar shows only while an unfinished job from an earlier
         version is open, with the way out -->
    <div v-if="batchMode" class="px-4 py-2 border-b border-amber-300/60 dark:border-amber-500/30 bg-amber-50 dark:bg-amber-500/10 text-xs text-amber-900 dark:text-amber-100 space-y-1.5" data-testid="batch-retired" role="status">
      <p class="font-semibold">{{ t('mode.retiredTitle') }}</p>
      <p class="leading-relaxed">{{ t('mode.retiredBody') }}</p>
      <button type="button" class="px-2.5 py-1 rounded bg-amber-600 hover:bg-amber-500 text-white font-semibold disabled:opacity-50 disabled:cursor-not-allowed" :disabled="heavyJobRunning" data-testid="batch-leave" @click="$emit('leave-batch')">{{ t('mode.retiredLeave') }}</button>
    </div>

    <!-- (the panel lays itself out: components/ui/WizardLayout.vue, with its own scrolling) -->
    <div class="flex-1 min-h-0 flex flex-col">
      <slot />
    </div>

    <!-- The footer: one bar of icons (name on hover), then language and dark
         mode, and under it the build this is. -->
    <div class="px-2.5 pt-1.5 pb-2 border-t border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900">
      <div class="flex items-center gap-0.5">
        <component
          :is="link.href ? 'a' : 'button'"
          v-for="link in footerLinks"
          :key="link.key"
          :href="link.href"
          :target="link.href ? '_blank' : undefined"
          :rel="link.href ? 'noopener noreferrer' : undefined"
          :type="link.href ? undefined : 'button'"
          class="mapng-foot-icon"
          :data-tip="link.label"
          :aria-label="link.title || link.label"
          :data-testid="`foot-${link.key}`"
          @click="link.onClick ? link.onClick() : (link.emit && $emit(link.emit))"
        >
          <component :is="link.icon" :size="15" />
        </component>
        <!-- language: the short name on a button, the real picker laid over it -->
        <label class="mapng-foot-icon ml-auto !w-auto px-2 gap-1 text-micro font-semibold" :data-tip="t('language.label')">
          <Globe :size="15" />{{ localeShort }}
          <select
            :value="locale"
            class="absolute inset-0 opacity-0 cursor-pointer"
            :aria-label="t('language.label')"
            @change="handleLocaleChange"
          >
            <option v-for="code in locales" :key="code" :value="code">{{ t(`language.${code}`) }}</option>
          </select>
        </label>
        <button
          type="button"
          class="mapng-foot-icon"
          :data-tip="isDarkMode ? t('sidebar.switchToLightMode') : t('sidebar.switchToDarkMode')"
          :aria-label="isDarkMode ? t('sidebar.switchToLightMode') : t('sidebar.switchToDarkMode')"
          @click="$emit('toggle-dark')"
        >
          <Sun v-if="isDarkMode" :size="15" />
          <Moon v-else :size="15" />
        </button>
      </div>
      <!-- (the desktop app: its version and the build; the website: which branch's build) -->
      <div class="mt-0.5 text-center text-micro text-gray-400 dark:text-gray-500 leading-tight truncate">
        <template v-if="desktopVersion">{{ t('sidebar.desktopBuild', { version: desktopVersion }) }} · {{ t('sidebar.build', { hash: ownBuild.hash, time: ownBuild.time }) }}</template>
        <template v-else-if="isProductionHost">{{ t('sidebar.branchMain') }} · {{ t('sidebar.build', { hash: buildMainHash, time: buildMainTime }) }}</template>
        <template v-else>{{ t('sidebar.branchDev') }} · {{ t('sidebar.build', { hash: buildDevHash, time: buildDevTime }) }}</template>
      </div>
    </div>
    <Teleport to="body">
      <div v-if="confirmReset" class="fixed inset-0 z-[130] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm" role="dialog" aria-modal="true" :aria-label="t('sidebar.resetTitle')" data-testid="reset-dialog" @click.self="resetting || (confirmReset = false)" @keydown.esc="resetting || (confirmReset = false)">
        <div class="w-full max-w-md rounded-2xl bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 shadow-2xl p-5 space-y-3">
          <h2 class="text-base font-bold text-gray-900 dark:text-white">{{ t('sidebar.resetTitle') }}</h2>
          <p class="text-sm text-gray-700 dark:text-gray-300 leading-relaxed">{{ t('sidebar.resetBody') }}</p>
          <p class="text-xs text-gray-500 dark:text-gray-400 leading-relaxed">{{ t('sidebar.resetKept') }} {{ t('sidebar.resetOnceAWeek') }}</p>
          <label class="flex items-start gap-2 text-sm text-gray-800 dark:text-gray-200 cursor-pointer">
            <input v-model="keepPlace" type="checkbox" class="mt-0.5 accent-[var(--brand)]" data-testid="reset-keep-place" :disabled="resetting" />
            <span>{{ t('sidebar.resetKeepPlace') }}<span class="block text-xs text-gray-500 dark:text-gray-400">{{ t('sidebar.resetKeepPlaceHint') }}</span></span>
          </label>
          <div class="flex flex-wrap items-center justify-end gap-2 pt-1">
            <button ref="cancelReset" type="button" class="px-4 py-1.5 rounded bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-200 text-xs font-medium transition-colors" :disabled="resetting" @click="confirmReset = false">{{ t('sidebar.resetCancel') }}</button>
            <button type="button" data-testid="reset-confirm" :disabled="resetting" class="px-4 py-1.5 rounded bg-red-600 hover:bg-red-500 text-white text-xs font-semibold transition-colors disabled:opacity-60" @click="doReset">{{ t('sidebar.resetConfirm') }}</button>
          </div>
        </div>
      </div>
    </Teleport>
  </aside>
</template>

<script setup>
import { netPanelOpen } from '../../composables/useNetworkMonitor.js';
import { computed, nextTick, onMounted, ref, watch } from 'vue';
import { heavyJobRunning } from '../../services/heavyJob.js';
import { resetApp, resetNeedsAsking, noteResetAsked, resetKeepsPlace, setResetKeepsPlace } from '../../services/resetApp.js';
import { desktopApp, DESKTOP_DOWNLOAD_URL } from '../../services/platform/desktop.js';
import { useI18n } from 'vue-i18n';
import BaseButton from '../base/BaseButton.vue';
import { getSupportedLocales, setI18nLanguage } from '../../i18n';
import { CircleHelp, Heart, Sun, Moon, Code, Download, RotateCcw, Globe, Github, MessageCircle, Mail, Database, Shield, ShieldCheck, Activity, Share2, FlaskConical, BarChart3 } from 'lucide-vue-next';
import { openShareDialog } from '../../composables/useShareDialog.js';

const { t, locale } = useI18n({ useScope: 'global' });
const isDesktop = !!desktopApp;
// Reset: asked first (it cannot be undone), then every setting cleared and the page loaded again
const confirmReset = ref(false);
const cancelReset = ref(null);
watch(confirmReset, (on) => { if (on) nextTick(() => cancelReset.value?.focus()); });
const resetting = ref(false);
// (keep the map where it is: on unless switched off, and remembered)
const keepPlace = ref(resetKeepsPlace());
watch(keepPlace, (on) => setResetKeepsPlace(on));
// (asked once a week at most: within a week of the last answer the button resets at once)
const askReset = () => { if (resetNeedsAsking()) confirmReset.value = true; else doReset(); };
const doReset = async () => { if (confirmReset.value) noteResetAsked();  if (resetting.value) return; resetting.value = true; try { await resetApp(); } finally { resetting.value = false; confirmReset.value = false; } };
const locales = computed(() => getSupportedLocales());
// (the language's short name on the footer button: EN, DE, … and 中文)
const localeShort = computed(() => (String(locale.value).startsWith('zh') ? '中文' : String(locale.value).slice(0, 2).toUpperCase()));
// The footer's links, all alike: an icon, the name on hover. The desktop app
// has no "get the desktop app" link.
// (an info page opens in the app's own light or dark: public/pages.js reads ?theme=)
const pageLink = (page) => `${desktopApp ? 'https://mapng.com' : ''}/${page}.html?theme=${props.isDarkMode ? 'dark' : 'light'}`;
const footerLinks = computed(() => [
  { key: 'discord', icon: MessageCircle, label: t('sidebar.discord'), href: 'https://discord.gg/j6ZvcF8rgk' },
  { key: 'github', icon: Github, label: t('sidebar.github'), href: 'https://github.com/nikkiluzader/mapng' },
  { key: 'contact', icon: Mail, label: t('sidebar.contact'), href: 'https://github.com/nikkiluzader/mapng/issues/new' },
  ...(desktopApp ? [] : [{ key: 'desktop', icon: Download, label: t('sidebar.desktopApp'), title: t('sidebar.desktopAppTooltip'), href: DESKTOP_DOWNLOAD_URL }]),
  { key: 'data', icon: Database, label: t('sidebar.yourData'), href: pageLink('data') },
  // (what limits the app and how to check it: public/security.html)
  { key: 'security', icon: ShieldCheck, label: t('sidebar.security'), href: pageLink('security') },
  // (the live Network activity panel at the map's lower left: components/ui/NetworkMonitor.vue)
  { key: 'network', icon: Activity, label: t('net.sidebar'), onClick: () => { netPanelOpen.value = !netPanelOpen.value; } },
  // (the public counts: where people build, which settings, what goes wrong: public/stats.html)
  { key: 'stats', icon: BarChart3, label: t('sidebar.stats'), href: pageLink('stats') },
  // (who writes the code, how it is tested, what the tests miss: public/how-its-built.html)
  { key: 'how', icon: FlaskConical, label: t('sidebar.howBuilt'), href: pageLink('how-its-built') },
  { key: 'disclaimer', icon: Shield, label: t('sidebar.disclaimer'), emit: 'show-disclaimer' },
  { key: 'stack', icon: Code, label: t('sidebar.stack'), emit: 'show-stack' },
]);

// (the desktop app names its version instead of the site's build)
const desktopVersion = ref(null);
// (the build this app was made from, not the site's deployed branches)
/* global __BUILD_HASH__, __BUILD_TIME__ */
const ownBuild = {
  hash: typeof __BUILD_HASH__ !== 'undefined' ? __BUILD_HASH__ : 'n/a',
  time: typeof __BUILD_TIME__ !== 'undefined' ? new Date(__BUILD_TIME__).toLocaleString() : 'n/a',
};
onMounted(async () => {
  if (!desktopApp) return;
  try { desktopVersion.value = (await desktopApp.info())?.version || null; } catch { /* none */ }
});

// Show only the build line that matches where the app is running: mapng.com
// tracks main, everything else (dev.mapng.com, localhost, preview URLs) tracks
// dev. Showing both meant one line always described a deployment the user
// wasn't looking at. Hostname rather than build-time branch, so a locally
// served production bundle still reports as dev.
const isProductionHost = typeof window !== 'undefined'
  && /^(www\.)?mapng\.com$/i.test(window.location.hostname);

const props = defineProps({
  batchMode: { type: Boolean, default: false },
  isDarkMode: { type: Boolean, default: false },
  buildMainHash: { type: String, default: 'n/a' },
  buildMainTime: { type: String, default: 'n/a' },
  buildDevHash: { type: String, default: 'n/a' },
  buildDevTime: { type: String, default: 'n/a' },
});

defineEmits(['show-about', 'show-support', 'show-disclaimer', 'show-stack', 'toggle-dark', 'leave-batch']);

const handleLocaleChange = (event) => {
  setI18nLanguage(event.target.value);
};
</script>

<style>
/* the footer's icon buttons, with their name above on hover */
.mapng-foot-icon { position: relative; width: 30px; height: 30px; border-radius: 8px; display: inline-flex; align-items: center; justify-content: center; color: rgb(107 114 128); transition: color .15s, background-color .15s; }
.dark .mapng-foot-icon { color: rgb(156 163 175); }
.mapng-foot-icon:hover, .mapng-foot-icon:focus-visible { background: rgb(243 244 246); color: var(--brand, #ff6600); }
.dark .mapng-foot-icon:hover, .dark .mapng-foot-icon:focus-visible { background: rgb(31 41 55); }
.mapng-foot-icon:hover::after, .mapng-foot-icon:focus-visible::after {
  content: attr(data-tip); position: absolute; bottom: calc(100% + 4px); left: 50%; transform: translateX(-50%);
  background: rgb(17 24 39); color: #fff; font-size: 11px; font-weight: 500; line-height: 1.2; padding: 3px 7px; border-radius: 6px;
  white-space: nowrap; pointer-events: none; z-index: 30;
}
.dark .mapng-foot-icon:hover::after, .dark .mapng-foot-icon:focus-visible::after { background: rgb(243 244 246); color: rgb(17 24 39); }
/* (the first and last keep their name inside the sidebar) */
.mapng-foot-icon:first-child:hover::after { left: 0; transform: none; }
.mapng-foot-icon:last-child:hover::after { left: auto; right: 0; transform: none; }
</style>
