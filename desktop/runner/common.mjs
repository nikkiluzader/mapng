// What every runner process shares: talking to the app, the memory reports
// the app's monitor shows, and the page's settings.
import v8 from 'node:v8';

export const send = (msg) => (process.send ? process.send(msg) : console.log(JSON.stringify(msg)));

/** This process's memory and busy cores to the app, each second. */
export function startMemoryReports() {
  if (!process.send) return;
  const heapLimit = v8.getHeapStatistics().heap_size_limit;
  let cpuBefore = process.cpuUsage(); let at = Date.now();
  setInterval(() => {
    const { rss, heapUsed } = process.memoryUsage();
    const cpuNow = process.cpuUsage(); const now = Date.now();
    // (busy cores: CPU time over wall time)
    const cores = ((cpuNow.user - cpuBefore.user) + (cpuNow.system - cpuBefore.system)) / 1000 / Math.max(1, now - at);
    cpuBefore = cpuNow; at = now;
    send({ type: 'memory', rss, heapUsed, heapLimit, cores });
  }, 1000).unref();
}

/**
 * The page's localStorage as it was when the job started (its own Overpass
 * server, the Overture switch, mirror health): the services read their
 * settings from there. Writes stay in this process.
 */
export function installLocalStorage(snapshot = {}) {
  const store = new Map(Object.entries(snapshot || {}).map(([k, v]) => [k, String(v)]));
  globalThis.localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => { store.set(k, String(v)); },
    removeItem: (k) => { store.delete(k); },
    clear: () => store.clear(),
    key: (i) => [...store.keys()][i] ?? null,
    get length() { return store.size; },
  };
}

/** Cancellation by message: { type: 'cancel' } from the app aborts the signal. */
export function cancelSignal() {
  const controller = new AbortController();
  process.on('message', (msg) => { if (msg?.type === 'cancel') controller.abort(); });
  return controller.signal;
}

/**
 * A fetch of mapng.com's /api/* made by the app's main process (Electron's
 * network stack) when this process runs under the app: Cloudflare's bot
 * checks turn plain Node away with a challenge page, a browser stack not.
 * Null when run by hand (no app to ask).
 */
export function appApiFetch() {
  if (!process.send) return null;
  let seq = 0;
  const waiting = new Map();
  process.on('message', (msg) => {
    if (msg?.type !== 'api-fetch-result') return;
    const w = waiting.get(msg.id);
    if (!w) return;
    waiting.delete(msg.id);
    if (msg.error) w.reject(new TypeError(`fetch failed: ${msg.error}`));
    else w.resolve(new Response(msg.status === 204 || msg.status === 304 ? null : Buffer.from(msg.body || '', 'base64'), { status: msg.status, statusText: msg.statusText, headers: msg.headers }));
  });
  return async (url, init = {}) => {
    const id = ++seq;
    const headers = Object.fromEntries(new Headers(init.headers || undefined).entries());
    // (JSON over IPC: bytes as base64)
    let body; let bodyBase64 = false;
    if (init.body != null) {
      if (typeof init.body === 'string') body = init.body;
      else { body = Buffer.from(await new Response(init.body).arrayBuffer()).toString('base64'); bodyBase64 = true; }
    }
    if (init.signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    return new Promise((resolve, reject) => {
      waiting.set(id, { resolve, reject });
      process.send({ type: 'api-fetch', id, url, method: init.method || 'GET', headers, body, bodyBase64 });
      init.signal?.addEventListener?.('abort', () => { if (waiting.delete(id)) reject(new DOMException('Aborted', 'AbortError')); }, { once: true });
    });
  };
}
