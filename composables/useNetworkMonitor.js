// The live Network activity panel (components/ui/NetworkMonitor.vue): every address the app has connected to, as
// it happens. One list for both builds:
//   - the website: the page's own record of what it loaded (the browser's resource timing: fetches, map tiles,
//     scripts), counted by host from the moment the page opened. The one request a background worker makes is
//     reported by that worker.
//   - the desktop app: the app's own count (desktop/networkActivity.js: the window and the export runner, with
//     what its address guard refused), asked for every second and a half while the panel is open.
// Each host is shown beside what MapNG's published list says it is for (desktop/networkHosts.js, the list on
// mapng.com/data.html). Nothing here is sent anywhere or kept after the page closes.
import { reactive, ref, watch } from 'vue';
import { networkHost } from '../desktop/networkHosts.js';

const OPEN_KEY = 'mapng_net_panel';
export const netPanelOpen = ref((() => { try { return localStorage.getItem(OPEN_KEY) === '1'; } catch { return false; } })());
watch(netPanelOpen, (v) => { try { localStorage.setItem(OPEN_KEY, v ? '1' : '0'); } catch { /* not kept */ } });

const desktop = () => (typeof window !== 'undefined' ? window.mapngDesktop : null);
/** Whether the list is the desktop app's own count (the export runner included). */
export const netFromApp = () => typeof desktop()?.networkActivity === 'function';

const seen = reactive(new Map());   // host -> { count, failed, blocked, bytes, last }
export const netTick = ref(0);      // moves when anything was counted (the "live" dot)

/** One request counted (the website's side). Exported for the tests. */
export function countRequest(url, { bytes = 0, at = Date.now(), ownHost = (typeof location !== 'undefined' ? location.hostname : '') } = {}) {
  let host;
  try { const u = new URL(url, typeof location !== 'undefined' ? location.href : 'https://mapng.com'); if (!/^https?:$/.test(u.protocol)) return; host = u.hostname.toLowerCase(); } catch { return; }
  if (!host) return;
  const row = seen.get(host) || { count: 0, failed: 0, blocked: 0, bytes: 0, last: at, own: host === ownHost };
  row.count++; row.bytes += Number(bytes) || 0; row.last = at;
  seen.set(host, row); netTick.value++;
}

/** The rows as shown: an unlisted address first, then the latest. { host, count, failed, blocked, bytes, last, kind, listed } */
export function netRows() {
  return [...seen].map(([host, r]) => {
    const e = r.own ? { kind: 'mapng' } : networkHost(host);
    return { host, ...r, kind: r.kind || e?.kind || null, listed: r.listed ?? !!e };
  }).sort((a, b) => ((b.blocked > 0) - (a.blocked > 0)) || (a.listed - b.listed) || (b.last - a.last) || a.host.localeCompare(b.host));
}
export const netTotal = () => { let n = 0; for (const r of seen.values()) n += r.count; return n; };
export function clearNet() { seen.clear(); netTick.value++; cleared = Date.now(); baseline = new Map(appRows.map((r) => [r.host, r])); }

let started = false; let timer = null; let appRows = []; let baseline = new Map(); let cleared = 0;
/** Start counting (once). The website counts from the page's first request; the desktop app asks its own count. */
export function startNetworkMonitor() {
  if (started || typeof window === 'undefined') return;
  started = true;
  if (netFromApp()) {
    const pull = async () => {
      try {
        appRows = await desktop().networkActivity() || [];
        let changed = false;
        for (const r of appRows) {
          const b = baseline.get(r.host) || { count: 0, failed: 0, blocked: 0 };
          const row = { count: r.count - b.count, failed: r.failed - b.failed, blocked: (r.blocked || 0) - (b.blocked || 0), bytes: 0, kind: r.kind, listed: r.listed };
          if (row.count + row.blocked <= 0) continue;
          const was = seen.get(r.host);
          if (!was || was.count !== row.count || was.blocked !== row.blocked || was.failed !== row.failed) { seen.set(r.host, { ...row, last: Date.now() }); changed = true; }
        }
        if (changed) netTick.value++;
      } catch { /* the next pull */ }
    };
    // (asked only while the panel is open)
    watch(netPanelOpen, (open) => { clearInterval(timer); if (open) { pull(); timer = setInterval(pull, 1500); } }, { immediate: true });
    return;
  }
  // (the one request a background worker makes, the projection of an uploaded file, is told by the worker itself)
  try { const ch = new BroadcastChannel('mapng-net'); ch.onmessage = (e) => { if (e.data?.url) countRequest(e.data.url); }; } catch { /* a browser without it */ }
  try {
    const obs = new PerformanceObserver((list) => { for (const e of list.getEntries()) if (!cleared || performance.timeOrigin + e.startTime >= cleared) countRequest(e.name, { bytes: e.transferSize, at: Math.round(performance.timeOrigin + e.responseEnd) }); });
    obs.observe({ type: 'resource', buffered: true });
  } catch { /* a browser without resource timing: the panel stays empty */ }
}
/** (tests) */
export function __resetNet() { seen.clear(); cleared = 0; }
