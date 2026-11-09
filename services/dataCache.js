// The browser's download cache: every map-data response (elevation, satellite,
// OSM, land cover, lidar, the backdrop's tiles ...) kept in IndexedDB, so a
// second Generate, Preview or Export of an area reads it instead of the
// network. The desktop app keeps its own on disk (desktop/runner/
// browserShims.mjs installSourceRecorder); this one is installed by the page
// only where IndexedDB exists.
//
// Kept within MAX_BYTES (the oldest-used dropped first) and per entry within
// MAX_ENTRY_BYTES; OpenStreetMap answers for OSM_TTL_MS (the map changes),
// the rest for TTL_MS. The app's own files and its services that aren't map
// data (usage stats, share codes, crash reports, update checks) go straight
// to the network.
//
// The export guard: the level export only processes what Generate and the
// export's data step (services/exportData.js) downloaded. While the guard is
// on, a map-data request the cache can't answer is counted (and refused when
// strict: tests), so a later feature that quietly downloads during the export
// shows up.

const DB_NAME = 'mapng-data-cache';
const STORE = 'responses';
const CACHE_VERSION = 'v1';
export const MAX_BYTES = 1.5 * 1024 ** 3;
const MAX_ENTRY_BYTES = 64 * 1024 ** 2;
const TTL_MS = 60 * 24 * 3600 * 1000;
const OSM_TTL_MS = 7 * 24 * 3600 * 1000;
const TOUCH_MS = 3600 * 1000;   // a hit refreshes its last-used time at most this often

// (the app's services that aren't map data, and requests that must stay live)
const NOT_DATA = /\/api\/(usage|share|crash|hotspots|report|version|feedback|nominatim[\w-]*)\b|api\.github\.com|\/releases\b|\/gpxz\/v1\/account|\/api\/gpxz\/status/i;

/** Whether a request is map data the cache keeps: a GET (or an Overpass POST) to another origin, or the app's data proxies. */
export function isDataRequest(url, method = 'GET', origin = (typeof location !== 'undefined' ? location.origin : '')) {
  if (!url || NOT_DATA.test(url)) return false;
  if (method !== 'GET' && !(method === 'POST' && /overpass|\/interpreter\b|\/api\/osm/i.test(url))) return false;
  if (/^(blob|data):/.test(url)) return false;
  if (/^https?:\/\//i.test(url)) {
    if (origin && url.startsWith(origin)) return /\/api\//.test(url.slice(origin.length));
    return true;
  }
  // (relative: the app's own files, but for its data proxies)
  return /^\/api\//.test(url);
}

const isOsm = (url) => /overpass|\/interpreter\b|\/api\/osm|openstreetmap\.org|osm[-_]?tiles|\.pmtiles/i.test(url);
const headerOf = (init, name) => {
  const h = init?.headers;
  if (!h) return '';
  if (typeof h.get === 'function') return h.get(name) || '';
  const k = Object.keys(h).find((x) => x.toLowerCase() === name.toLowerCase());
  return k ? String(h[k]) : '';
};

/** The cache key: method, URL without key/token parameters, the Range asked for, and a POST's body. */
export function dataCacheKey(url, init = {}) {
  const method = String(init.method || 'GET').toUpperCase();
  let u = String(url);
  try {
    const p = new URL(u, 'https://x.invalid');
    for (const k of [...p.searchParams.keys()]) if (/^(key|api_?key|token|access_token|apikey)$/i.test(k)) p.searchParams.delete(k);
    u = p.origin === 'https://x.invalid' ? p.pathname + p.search : p.toString();
  } catch { /* as given */ }
  const body = typeof init.body === 'string' ? init.body : '';
  return `${CACHE_VERSION}|${method}|${u}|${headerOf(init, 'range')}|${body}`;
}

// ---- the export guard ------------------------------------------------------

const guard = { on: false, strict: false, misses: [] };
/** Run fn with downloads of map data refused (strict) or counted. Returns fn's result; guard.misses lists what still went out. */
export async function withDownloadGuard(fn, { strict = !!globalThis.__MAPNG_STRICT_NO_DOWNLOAD } = {}) {
  const was = { ...guard, misses: guard.misses };
  guard.on = true; guard.strict = strict; guard.misses = [];
  try { return await fn(); } finally {
    const misses = guard.misses;
    Object.assign(guard, was);
    if (misses.length) console.warn(`[Data cache] The export downloaded ${misses.length} file(s) the data step should have: ${misses.slice(0, 5).join(', ')}`);
    lastGuardMisses = misses;
  }
}
let lastGuardMisses = [];
/** What the last guarded run still downloaded. */
export const guardMisses = () => lastGuardMisses;
/** Note a download during the guard (the desktop runner's cache reports its misses here too). */
export function noteGuardMiss(url) {
  if (!guard.on) return;
  guard.misses.push(String(url));
  if (guard.strict) throw new Error(`The export tried to download map data (${url}); it should come from Generate or the export's data step.`);
}

// ---- IndexedDB -------------------------------------------------------------

let dbPromise = null;
function openDb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const s = req.result.createObjectStore(STORE, { keyPath: 'key' });
      s.createIndex('used', 'used');
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}
const done = (r) => new Promise((resolve, reject) => { r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });

async function read(key) {
  const db = await openDb();
  return done(db.transaction(STORE, 'readonly').objectStore(STORE).get(key));
}
async function touch(rec) {
  const db = await openDb();
  await done(db.transaction(STORE, 'readwrite').objectStore(STORE).put({ ...rec, used: Date.now() }));
}
let totalBytes = null;
async function write(rec) {
  const db = await openDb();
  await done(db.transaction(STORE, 'readwrite').objectStore(STORE).put(rec));
  if (totalBytes != null) totalBytes += rec.size;
  await trim(db);
}
// the oldest-used entries dropped until the cache is within MAX_BYTES
async function trim(db) {
  if (totalBytes == null) {
    totalBytes = 0;
    await new Promise((resolve, reject) => {
      const c = db.transaction(STORE, 'readonly').objectStore(STORE).openCursor();
      c.onsuccess = () => { const cur = c.result; if (!cur) return resolve(); totalBytes += cur.value.size || 0; cur.continue(); };
      c.onerror = () => reject(c.error);
    });
  }
  if (totalBytes <= MAX_BYTES) return;
  await new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    const c = tx.objectStore(STORE).index('used').openCursor();
    c.onsuccess = () => {
      const cur = c.result;
      if (!cur || totalBytes <= MAX_BYTES * 0.9) return resolve();
      totalBytes -= cur.value.size || 0;
      cur.delete();
      cur.continue();
    };
    c.onerror = () => reject(c.error);
  });
}

/** Empty the download cache (a setting, or a test). */
export async function clearDataCache() {
  const db = await openDb();
  await done(db.transaction(STORE, 'readwrite').objectStore(STORE).clear());
  totalBytes = 0;
}

// ---- the fetch wrapper -----------------------------------------------------

let installed = false;
/** Wrap the page's fetch with the cache (once; nothing where IndexedDB is missing). */
export function installDataCache() {
  if (installed || typeof indexedDB === 'undefined' || typeof globalThis.fetch !== 'function') return false;
  installed = true;
  const network = globalThis.fetch.bind(globalThis);
  globalThis.fetch = async (input, init = {}) => {
    const url = typeof input === 'string' ? input : String(input?.url || input || '');
    const method = String(init.method || input?.method || 'GET').toUpperCase();
    if (!isDataRequest(url, method)) return network(input, init);
    const key = dataCacheKey(url, { ...init, method });
    try {
      const rec = await read(key);
      if (rec && Date.now() - rec.saved < (isOsm(url) ? OSM_TTL_MS : TTL_MS)) {
        if (Date.now() - (rec.used || 0) > TOUCH_MS) touch(rec).catch(() => {});
        return new Response(rec.bytes, { status: rec.status, statusText: rec.statusText, headers: rec.headers });
      }
    } catch { /* the cache unreadable: the network */ }
    noteGuardMiss(url);
    const res = await network(input, init);
    if (!(res.status === 200 || res.status === 206)) return res;
    const length = Number(res.headers.get('content-length') || 0);
    if (length > MAX_ENTRY_BYTES) return res;
    try {
      const bytes = await res.clone().arrayBuffer();
      if (bytes.byteLength <= MAX_ENTRY_BYTES) {
        const headers = {};
        res.headers.forEach((v, k) => { headers[k] = v; });
        const now = Date.now();
        write({ key, status: res.status, statusText: res.statusText, headers, bytes, size: bytes.byteLength, saved: now, used: now }).catch(() => {});
      }
    } catch { /* not kept: still answered */ }
    return res;
  };
  return true;
}

// ---- images ----------------------------------------------------------------

/**
 * A map-data image (an elevation or satellite tile) as an <img>, read through
 * the cache: fetched (so the cache keeps it), shown from a blob URL. Without
 * the cache (the desktop runner's Node, a test) or for anything else, the
 * plain <img> load. Resolves null when it can't be loaded; rejects with the
 * signal's reason when aborted.
 */
export async function loadDataImage(url, signal) {
  if (signal?.aborted) throw signal.reason ?? new DOMException('Aborted', 'AbortError');
  if (installed && typeof document !== 'undefined' && isDataRequest(url, 'GET')) {
    let res;
    try { res = await globalThis.fetch(url, { signal, mode: 'cors' }); } catch (e) {
      if (signal?.aborted) throw signal.reason ?? e;
      if (guard.strict && guard.on) throw e;
      return plainImage(url, signal);   // (a CORS refusal: the <img> way, as before)
    }
    if (!res.ok) return null;
    const blobUrl = URL.createObjectURL(await res.blob());
    try { return await plainImage(blobUrl, signal); } finally { URL.revokeObjectURL(blobUrl); }
  }
  return plainImage(url, signal);
}

function plainImage(url, signal) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'Anonymous';
    const onAbort = () => { img.src = ''; reject(signal.reason ?? new DOMException('Aborted', 'AbortError')); };
    signal?.addEventListener('abort', onAbort, { once: true });
    img.onload = () => { signal?.removeEventListener('abort', onAbort); resolve(img); };
    img.onerror = () => { signal?.removeEventListener('abort', onAbort); resolve(null); };
    img.src = url;
  });
}
