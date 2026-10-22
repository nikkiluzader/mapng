import { ref, watch } from 'vue';
import { OVERPASS_STATUS_EVENT, probePublicOverpassMirrors, publicOverpassMirrorsDown } from '../services/osm.js';

// Shared outage state for the banner and its reopen button.
//
// Closing the banner is remembered across reloads (it stays a small reopen
// button) for the rest of that outage: the choice is cleared once the
// servers are seen answering again, and expires after DISMISS_TTL_MS in case
// they recovered while the page was closed and a new outage began.
const DISMISS_KEY = 'mapng_overpass_banner_dismissed_at';
const DISMISS_TTL_MS = 12 * 60 * 60 * 1000;

const readDismissed = () => {
  try {
    const at = Number(localStorage.getItem(DISMISS_KEY));
    return Number.isFinite(at) && at > 0 && Date.now() - at < DISMISS_TTL_MS;
  } catch {
    return false;
  }
};
const writeDismissed = (on) => {
  try {
    if (on) localStorage.setItem(DISMISS_KEY, String(Date.now()));
    else localStorage.removeItem(DISMISS_KEY);
  } catch { /* private mode: the choice lasts for this page only */ }
};

const down = ref(false);
const dismissed = ref(readDismissed());
let started = false;

const refresh = () => { down.value = publicOverpassMirrorsDown(); };

export const useOverpassStatus = () => {
  if (!started) {
    started = true;
    refresh();
    window.addEventListener(OVERPASS_STATUS_EVENT, refresh);
    // Pre-flight check on each visit (throttled inside the probe).
    probePublicOverpassMirrors().catch(() => {});
    // Cool-downs expire on their own, so re-check now and then.
    setInterval(refresh, 60000);
    // Closing / reopening is the user's choice: remember it.
    watch(dismissed, (on) => writeDismissed(on));
    // Recovery forgets it, so the next outage shows the full banner again.
    watch(down, (isDown, wasDown) => {
      if (!isDown && wasDown) dismissed.value = false;
    });
  }
  return { down, dismissed };
};
