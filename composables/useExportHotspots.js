import { ref, watch } from 'vue';
import { hotspotCell } from '../services/exportHotspots.js';

// Export hotspots (services/exportHotspots.js): the opt-in to share where
// one's exports are (only their ~5 km grid cell), and the 2D map overlay of
// everyone's shared exports. Web app and desktop app alike.
const SHARE_KEY = 'mapng_share_exports';      // 'on' | 'off' | unset (not asked yet)
const SHOW_KEY = 'mapng_show_hotspots';

const read = (key) => { try { return localStorage.getItem(key); } catch { return null; } };
const write = (key, value) => { try { localStorage.setItem(key, value); } catch { /* private mode */ } };

const share = ref(read(SHARE_KEY));           // 'on' | 'off' | null
const show = ref(read(SHOW_KEY) === 'true');
const cells = ref([]);                         // [{ y, x, web, desktop, total }]
const totals = ref({ web: 0, desktop: 0 });
const status = ref('idle');                    // idle | loading | ready | unavailable
const privacyOpen = ref(false);                // the "how your data is used" dialog
let started = false;

export function openHotspotPrivacy() { privacyOpen.value = true; }

export function setShareExports(on) {
  share.value = on ? 'on' : 'off';
  write(SHARE_KEY, share.value);
}

/** After a level export: count it, when this user shares. Never throws, never waits. */
export function reportExport(center, platform) {
  if (share.value !== 'on') return;
  const cell = hotspotCell(Number(center?.lat), Number(center?.lng ?? center?.lon));
  if (!cell) return;
  fetch('/api/hotspots', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ ...cell, platform }),
    keepalive: true,
  }).then(() => { if (status.value === 'ready') { status.value = 'idle'; if (show.value) load(); } })
    .catch(() => { /* offline: not counted */ });
}

async function load() {
  if (status.value === 'loading' || status.value === 'ready') return;
  status.value = 'loading';
  try {
    const response = await fetch('/api/hotspots');
    if (!response.ok) throw new Error(String(response.status));
    const data = await response.json();
    cells.value = (data.cells || []).map(([y, x, web, desktop, lastDay]) => ({ y, x, web, desktop, lastDay, total: web + desktop }));
    totals.value = data.totals || { web: 0, desktop: 0 };
    status.value = 'ready';
  } catch {
    status.value = 'unavailable';
  }
}

export const useExportHotspots = () => {
  if (!started) {
    started = true;
    watch(show, (on) => { write(SHOW_KEY, String(on)); if (on) load(); }, { immediate: true });
  }
  return { share, show, cells, totals, status, setShareExports, privacyOpen, openHotspotPrivacy };
};
