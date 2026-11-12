// "MapNG was updated": a page that is older than the site.
//
// Every build names its code files after their contents, and a deploy removes
// the old ones. A page opened before the deploy still asks for the old names
// the next time it needs a part it has not loaded yet (the terrain resampler,
// the GeoTIFF decoder, the 3D preview): those answer 404 and the feature
// stops, silently. Measured on the site: about 1,500 such requests a week,
// and Generate ending with no terrain and no message when the resampler's
// file was gone.
//
// This module notices, two ways: when a part fails to load (codeFailed, and
// Vite's own preloadError), and beforehand, by comparing the page's entry
// script with the one the site serves now (when the tab is looked at again,
// and now and then). App.vue shows the notice. The desktop app carries its
// own files and never changes under a running page: nothing to check there.
import { ref } from 'vue';

/** True once the page is known to be older than the site. */
export const appUpdated = ref(false);

const CHECK_EVERY_MS = 15 * 60 * 1000;
const CHECK_MIN_GAP_MS = 60 * 1000;
let lastCheck = 0;

/** The entry script a page of this HTML loads: its path, or '' when there is none. */
export function entryScriptOf(html) {
  const m = /<script[^>]+type=["']module["'][^>]*\bsrc=["']([^"']+)["']/i.exec(String(html || ''))
    || /<script[^>]+\bsrc=["']([^"']+)["'][^>]*type=["']module["']/i.exec(String(html || ''));
  if (!m) return '';
  try { return new URL(m[1], 'https://x/').pathname; } catch { return ''; }
}

/** Whether `served` (the site's entry script now) differs from `loaded` (this page's); unknown is "no". */
export const isOlder = (loaded, served) => !!loaded && !!served && loaded !== served;

const loadedEntry = () => {
  if (typeof document === 'undefined') return '';
  const el = document.querySelector('script[type="module"][src]');
  try { return el ? new URL(el.src, location.href).pathname : ''; } catch { return ''; }
};
const onWeb = () => typeof location !== 'undefined' && /^https?:$/.test(location.protocol);

/** Ask the site which build it serves now; sets appUpdated when it is not this page's. */
export async function checkForUpdate({ force = false, fetchFn = globalThis.fetch } = {}) {
  if (appUpdated.value || !onWeb()) return appUpdated.value;
  if (!force && Date.now() - lastCheck < CHECK_MIN_GAP_MS) return false;
  lastCheck = Date.now();
  try {
    const r = await fetchFn(`${location.origin}/`, { cache: 'no-store', headers: { Accept: 'text/html' } });
    if (!r.ok) return false;
    if (isOlder(loadedEntry(), entryScriptOf(await r.text()))) appUpdated.value = true;
  } catch { /* offline: ask again later */ }
  return appUpdated.value;
}

/** A part of the app failed to load or to start: most likely its file is gone. Find out. */
export function codeFailed() {
  return checkForUpdate({ force: true });
}

/** Start watching (once, from main.js). */
export function watchForUpdates() {
  if (typeof window === 'undefined' || !onWeb()) return;
  // (Vite: a lazily loaded part, or its styles, could not be fetched)
  window.addEventListener('vite:preloadError', () => { codeFailed(); });
  window.addEventListener('unhandledrejection', (e) => {
    if (/dynamically imported module|Importing a module script failed|error loading dynamically imported/i.test(String(e?.reason?.message || e?.reason || ''))) codeFailed();
  });
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') checkForUpdate(); });
  setInterval(() => { if (document.visibilityState === 'visible') checkForUpdate(); }, CHECK_EVERY_MS);
}
