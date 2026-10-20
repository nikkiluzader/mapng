import { ref, watch } from 'vue';
import { OVERPASS_STATUS_EVENT, probePublicOverpassMirrors, publicOverpassMirrorsDown } from '../services/osm.js';

// Shared outage state for the banner and its reopen button.
const down = ref(false);
const dismissed = ref(false);
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
    // A fresh outage after recovery shows the full banner again.
    watch(down, (isDown, wasDown) => { if (isDown && !wasDown) dismissed.value = false; });
  }
  return { down, dismissed };
};
