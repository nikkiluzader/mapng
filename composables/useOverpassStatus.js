import { ref, watch } from 'vue';
import { OVERPASS_STATUS_EVENT, probePublicOverpassMirrors, publicOverpassMirrorsDown } from '../services/osm.js';

// Shared outage state for the banner and its chip.
//
// The notice starts minimized (a small chip in the view tabs): MapNG keeps
// working on Overture Maps when the Overpass servers are down, and the full
// banner on every visit alarmed people for nothing. Opening it lasts for the
// page; a recovery folds it back for the next outage.
const down = ref(false);
const dismissed = ref(true);
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
    // Recovery folds an opened notice back: the next outage starts minimized.
    watch(down, (isDown, wasDown) => {
      if (!isDown && wasDown) dismissed.value = true;
    });
  }
  return { down, dismissed };
};
