// The browser APIs the level export draws with, in Node: a real canvas
// (@napi-rs/canvas) behind document.createElement('canvas'), OffscreenCanvas,
// Image, ImageData and createImageBitmap, and blob: URLs kept in memory so
// images and fetch() can read them back. (scripts/sweep/polyfill.mjs stubs
// the images instead; the desktop app needs the real ones.)
import { allowedUrl, setOwnServer } from '../networkGuard.js';
import { canvasToPng, encodeGray16 } from './fastPng.mjs';
// (the level export's heightmap picture, written on many cores in this process: exportBeamNGLevel.js asks for it here)
globalThis.__mapngEncodeGray16 = encodeGray16;
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { Worker as NodeWorker } from 'node:worker_threads';
import { createCanvas, Image, ImageData, loadImage } from '@napi-rs/canvas';

const blobs = new Map();
let blobSeq = 0;

const imageSrc = Object.getOwnPropertyDescriptor(Image.prototype, 'src');

/** The bytes behind a blob:, data: or file URL, or a Buffer as given. */
async function bytesOf(src) {
  if (typeof src !== 'string') return src;
  if (src.startsWith('blob:')) {
    const blob = blobs.get(src);
    if (!blob) throw new Error(`unknown blob URL ${src}`);
    return Buffer.from(await blob.arrayBuffer());
  }
  return Buffer.from(await (await fetch(src)).arrayBuffer());
}

function mimeOf(type) {
  return type === 'image/jpeg' || type === 'image/webp' ? type : 'image/png';
}

// the canvas methods the browser has and @napi-rs/canvas names differently
export function withBrowserMethods(canvas) {
  canvas.toBlob = function toBlob(callback, type, quality) {
    const mime = mimeOf(type);
    const q = Number.isFinite(quality) ? Math.round(quality * 100) : undefined;
    // (a PNG: written on many cores, fastPng.mjs; the canvas's own encoder takes 10 s for an 8 km texture)
    (mime === 'image/png' ? canvasToPng(this) : this.encode(mime.slice(6), q))
      .then((buf) => callback(new Blob([buf], { type: mime })), () => callback(null));
  };
  canvas.convertToBlob = function convertToBlob({ type, quality } = {}) {
    return new Promise((resolve) => this.toBlob(resolve, type, quality));
  };
  return canvas;
}

class ShimImage extends Image {
  constructor(width, height) {
    super(width, height);
    this.crossOrigin = null;
  }

  get src() { return this._src ?? ''; }

  set src(value) {
    this._src = value;
    bytesOf(value).then(
      (bytes) => imageSrc.set.call(this, bytes),
      (error) => this.onerror?.(error),
    );
  }

  decode() {
    return new Promise((resolve, reject) => {
      if (this.complete && this.width) { resolve(); return; }
      const { onload, onerror } = this;
      this.onload = (...a) => { onload?.(...a); resolve(); };
      this.onerror = (e) => { onerror?.(e); reject(e); };
    });
  }
}

const MIME = { '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.zip': 'application/zip', '.dds': 'image/vnd-ms.dds' };

/**
 * assetsDir: the app's own files (public/ in development, the built dist/
 * when packaged), which the page reads by path (/beamng_shape_materials.json);
 * apiOrigin: where /api/* goes, as on mapng.com; apiFetch: how (the app's
 * main process, when given: desktop/runner/common.mjs appApiFetch).
 */
// A browser Web Worker on Node's worker threads, for the page's own workers
// (the heightmap resampler: without it the resampling ran on this one thread
// in the slow fallback loop, which a 16k GPXZ map did not finish). The worker
// module sees `self` with onmessage / postMessage, as in a browser.
const WORKER_BOOT = `
const { parentPort, workerData } = require('node:worker_threads');
globalThis.self = globalThis;
const early = [];
let ready = false;
self.postMessage = (data, transfer) => parentPort.postMessage(data, transfer || []);
parentPort.on('message', (data) => {
  if (!ready) { early.push(data); return; }
  if (typeof self.onmessage === 'function') self.onmessage({ data });
});
import(workerData.url).then(() => {
  ready = true;
  for (const data of early.splice(0)) if (typeof self.onmessage === 'function') self.onmessage({ data });
}, (error) => { throw error; });
`;

class ShimWorker {
  constructor(url) {
    this.onmessage = null;
    this.onerror = null;
    this.worker = new NodeWorker(WORKER_BOOT, { eval: true, workerData: { url: String(url) } });
    this.worker.on('message', (data) => this.onmessage?.({ data }));
    this.worker.on('error', (error) => { console.error('[Worker]', error); this.onerror?.(error); });
    // (kept referenced: while the job waits on its answer nothing else keeps
    // Node running; the runners end themselves with process.exit when done)
  }

  postMessage(data, transfer) {
    const list = (Array.isArray(transfer) ? transfer : transfer?.transfer || []).filter((t) => t instanceof ArrayBuffer);
    try {
      this.worker.postMessage(data, list);
    } catch (error) {
      // (a buffer of native memory, e.g. a canvas's pixels, cannot be moved to
      // another thread on newer Node: copied instead)
      if (error?.name !== 'DataCloneError' || !list.length) throw error;
      this.worker.postMessage(data);
    }
  }

  terminate() { this.worker.terminate(); }
}

export function installBrowserShims({ assetsDir, apiOrigin = 'https://mapng.com', apiFetch = null } = {}) {
  if (typeof globalThis.Worker === 'undefined') globalThis.Worker = ShimWorker;
  globalThis.document = {
    createElement(tag) {
      if (tag === 'canvas') return withBrowserMethods(createCanvas(300, 150));
      // (download anchors and the like: inert)
      return { style: {}, setAttribute() {}, click() {}, remove() {}, appendChild() {} };
    },
    body: { appendChild() {}, removeChild() {} },
  };
  globalThis.OffscreenCanvas = class OffscreenCanvas {
    constructor(width, height) { return withBrowserMethods(createCanvas(width, height)); }
  };
  globalThis.Image = ShimImage;
  globalThis.ImageData = ImageData;
  globalThis.createImageBitmap = async (source, ...rest) => {
    if (rest.length >= 4) {
      // (sx, sy, sw, sh: a crop)
      const [sx, sy, sw, sh] = rest;
      const img = await globalThis.createImageBitmap(source);
      const c = createCanvas(sw, sh);
      c.getContext('2d').drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh);
      return bitmapOf(c);
    }
    if (source instanceof Blob) return bitmapOf(await loadImage(Buffer.from(await source.arrayBuffer())));
    if (source instanceof ImageData) {
      const c = createCanvas(source.width, source.height);
      c.getContext('2d').putImageData(source, 0, 0);
      return bitmapOf(c);
    }
    return bitmapOf(source);
  };

  const originalCreate = URL.createObjectURL;
  URL.createObjectURL = (blob) => {
    if (!(blob instanceof Blob)) return originalCreate(blob);
    const url = `blob:mapng-desktop/${++blobSeq}`;
    blobs.set(url, blob);
    return url;
  };
  URL.revokeObjectURL = (url) => { blobs.delete(url); };

  // (where the page's code thinks it runs: the desktop app's own origin)
  globalThis.location = { protocol: 'app:', host: 'mapng', hostname: 'mapng', origin: 'app://mapng', href: 'app://mapng/', pathname: '/', search: '', hash: '' };

  const originalFetch = globalThis.fetch;
  // A request to another machine while the guard is on: sent without following redirects, and each address it
  // is sent on to is judged like the first (a listed server must not be able to pass the app on to one that is
  // not on the list). A key or sign-in header goes no further than the server it was meant for.
  const MAX_REDIRECTS = 10;
  const guardedFetch = async (input, init = {}) => {
    if (process.env.MAPNG_NET_GUARD !== '1') return originalFetch(input, init);
    const first = input instanceof Request ? input : null;
    let url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    let method = String(init.method || first?.method || 'GET').toUpperCase();
    let headers = new Headers(init.headers || first?.headers || undefined);
    // (a body that can be sent again: text, bytes, form fields. A stream cannot, and is only sent once)
    let body = init.body ?? null;
    if (body == null && first && !['GET', 'HEAD'].includes(method)) body = Buffer.from(await first.clone().arrayBuffer());
    const replayable = body == null || typeof body === 'string' || body instanceof URLSearchParams || body instanceof ArrayBuffer || ArrayBuffer.isView(body) || body instanceof Blob;
    for (let hop = 0; ; hop++) {
      const response = await originalFetch(url, { ...init, method, headers, body: ['GET', 'HEAD'].includes(method) ? undefined : body, redirect: 'manual', signal: init.signal ?? first?.signal });
      const to = [301, 302, 303, 307, 308].includes(response.status) ? response.headers.get('location') : null;
      if (!to || init.redirect === 'manual') return response;
      if (init.redirect === 'error' || hop >= MAX_REDIRECTS) throw new TypeError(`MapNG stopped following redirects at ${new URL(url).hostname}`);
      const next = new URL(to, url);
      if (/^https?:$/.test(next.protocol)) {
        const verdict = allowedUrl(next.href);
        if (!verdict.ok) {
          if (process.send) process.send({ type: 'net-refused', host: verdict.host });
          throw new TypeError(`MapNG did not connect to ${verdict.host} (${new URL(url).hostname} sent the request on to it): it is not on MapNG's list of addresses (mapng.com/data.html#addresses)`);
        }
        if (process.send) { try { process.send({ type: 'net-host', host: next.hostname }); } catch { /* no channel */ } }
      } else throw new TypeError(`MapNG did not follow a redirect to a ${next.protocol} address`);
      try { await response.body?.cancel(); } catch { /* already closed */ }
      // (as a browser does: a POST answered 301, 302 or 303 is asked again as a GET without its body)
      if (response.status === 303 || ((response.status === 301 || response.status === 302) && method === 'POST')) {
        method = 'GET'; body = null;
        headers = new Headers(headers); for (const h of ['content-type', 'content-length', 'content-encoding']) headers.delete(h);
      } else if (!replayable) throw new TypeError(`MapNG could not send the request on to ${next.hostname}: its body can only be sent once`);
      if (next.origin !== new URL(url).origin) {
        headers = new Headers(headers); for (const h of ['authorization', 'cookie', 'x-api-key', 'proxy-authorization']) headers.delete(h);
      }
      url = next.href;
    }
  };
  globalThis.fetch = (input, init) => {
    let url = typeof input === 'string' ? input : input instanceof URL ? input.href : input?.url;
    if (url?.startsWith('app://mapng/')) { url = url.slice('app://mapng'.length); input = url; }
    if (url?.startsWith('blob:')) {
      const blob = blobs.get(url);
      return Promise.resolve(blob ? new Response(blob) : new Response(null, { status: 404 }));
    }
    if (/^https?:/i.test(url || '')) {
      // (only addresses on MapNG's list, and the user's own Overpass server, are asked: ../networkGuard.js.
      // On when the app started this runner; a script that uses these shims by itself is not held to it)
      if (process.env.MAPNG_NET_GUARD === '1') {
        try { setOwnServer(globalThis.localStorage?.getItem('mapng_customOverpassUrl') || ''); } catch { /* none */ }
        const verdict = allowedUrl(url);
        if (!verdict.ok) {
          if (process.send) process.send({ type: 'net-refused', host: verdict.host });
          return Promise.reject(new TypeError(`MapNG did not connect to ${verdict.host}: it is not on MapNG's list of addresses (mapng.com/data.html#addresses)`));
        }
      }
      // (the address goes to the app for Help > Network Activity: the host name only, never the path)
      if (process.send) { try { process.send({ type: 'net-host', host: new URL(url).hostname }); } catch { /* not an address */ } }
    }
    if (url?.startsWith('/api/') && apiFetch) return apiFetch(url, init);
    if (url?.startsWith('/api/')) {
      const headers = new Headers(init?.headers || undefined);
      if (!headers.has('user-agent')) headers.set('user-agent', USER_AGENT);
      return originalFetch(apiOrigin + url, { ...init, headers });
    }
    if (url?.startsWith('/') && !url.startsWith('//') && assetsDir) {
      const rel = decodeURIComponent(url.split(/[?#]/)[0]);
      const file = path.join(assetsDir, path.normalize(rel).replace(/^([/\\])+/, ''));
      if (!file.startsWith(path.resolve(assetsDir) + path.sep) || !fs.existsSync(file)) {
        return Promise.resolve(new Response(null, { status: 404 }));
      }
      return fs.promises.readFile(file).then((buf) => new Response(buf, {
        headers: { 'content-type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream' },
      }));
    }
    // (a browser names itself; Node's default "node" gets rate-limited by
    // public servers such as the Overpass mirrors)
    if (/^https?:/.test(url || '')) {
      const headers = new Headers(init?.headers || (input instanceof Request ? input.headers : undefined));
      if (!headers.has('user-agent')) headers.set('user-agent', USER_AGENT);
      return guardedFetch(input, { ...init, headers });
    }
    return originalFetch(input, init);
  };
}

const USER_AGENT = `MapNG-Desktop/${process.env.MAPNG_VERSION || 'dev'} (+https://mapng.com)`;

// an ImageBitmap: anything drawImage takes, with close()
function bitmapOf(drawable) {
  if (typeof drawable.close !== 'function') drawable.close = () => {};
  return drawable;
}

// ---- the terrain's sources, recorded and replayed --------------------------

const PASS_THROUGH = /^(blob:|data:|\/(?!api\/))/;

/** The request a recorded response answers (the same whichever mirror served it). */
/**
 * An address as it may be written down (a log line, an error, a recorded source's note): the user's
 * own Overpass server is "custom-overpass:" (its address can hold a paid key, in its path, its query
 * or as user:password), and no address keeps a user:password part.
 */
export function shownUrl(url, custom = (() => { try { return String(globalThis.localStorage?.getItem('mapng_customOverpassUrl') || '').trim(); } catch { return ''; } })()) {
  const u = String(url);
  if (custom) {
    try { if (new URL(u).host === new URL(custom).host) return 'custom-overpass:'; } catch { /* not an address: as it is */ }
  }
  return u.replace(/^([a-z][a-z0-9+.-]*:\/\/)[^/@\s]*@/i, '$1');
}

function sourceKey(url, init = {}, bodyText = '') {
  const u = String(url).replace(/^https?:\/\/[^/]+(\/api\/interpreter)/, 'overpass:$1');
  const range = new Headers(init.headers || undefined).get('range') || '';
  return crypto.createHash('sha1').update(`${(init.method || 'GET').toUpperCase()} ${u} ${range} ${bodyText}`).digest('hex');
}

async function bodyTextOf(init) {
  if (init?.body == null) return '';
  if (typeof init.body === 'string') return init.body;
  if (init.body instanceof URLSearchParams) return init.body.toString();
  return Buffer.from(await new Response(init.body).arrayBuffer()).toString('base64');
}

/**
 * Every network response a terrain is made from kept in dir (mode
 * 'record'), or served back from there (mode 'replay': a rebuild with
 * today's code from the same elevation, imagery and OSM). A request
 * nothing was recorded for goes to the network when fallback is on (an
 * older recording), else fails like an offline network.
 * Returns stats { recorded, replayed, missed }.
 */
// OpenStreetMap requests (Overpass mirrors, MapNG's /api/osm cache, the
// mirror probes). A rebuild that misses one of these must not go online: it
// would take today's OSM instead of the map's (the first export got its OSM
// elsewhere, e.g. Overture when Overpass did not answer), and download it.
const OSM_REQUEST = /^(overpass:|\/api\/osm(\?|$))/;

// recordDir (replay mode): a request missing from dir that goes online is
// recorded there, so the next replay has it (an export's lidar or backdrop
// when "Modify" turns something new on).
// mode 'cache' (the app's Generate Data / Preview 3D): dir is a download cache
// shared by every generate in this run of the app (desktop/main.js clears it
// at start): what it holds is used, what it lacks is downloaded and added;
// each generate's own full set goes to recordDir either way (the level's
// saved data). Map data in it expires after CACHE_OSM_MS (someone fixing
// their town on OSM wants it fresh); error answers never go in.
const CACHE_OSM_MS = 30 * 60 * 1000;
const CACHE_MANIFEST_MS = 5 * 60 * 1000;
export const MANIFEST_REQUEST = /\/api\/osm-tiles\/manifest(-all)?(\?|$)/;
const cacheable = (status) => (status >= 200 && status < 300) || status === 404;
const linkInto = (from, to) => { try { fs.linkSync(from, to); } catch { try { fs.copyFileSync(from, to); } catch { /* best effort */ } } };

// strict (the export's download guard in tests and checks: MAPNG_STRICT_NO_DOWNLOAD):
// a request the cache can't answer fails instead of going online; otherwise it
// goes online and is listed in stats.downloadedUrls for the log.
// The saved map data of a level made when no OpenStreetMap server answered:
// the backup (Overture's road tiles) among its recorded requests.
export function savedFromBackupMapData(dir) {
  let names = [];
  try { names = fs.readdirSync(dir); } catch { return false; }
  for (const name of names) {
    if (!name.endsWith('.json') || name === 'user-osm-file.json') continue;
    try {
      // (the url leads each meta file: its first bytes are enough)
      const fd = fs.openSync(path.join(dir, name), 'r');
      const buf = Buffer.alloc(400); const n = fs.readSync(fd, buf, 0, 400, 0); fs.closeSync(fd);
      if (/tiles\.overturemaps\.org\/[^"]*\/transportation\.pmtiles/.test(buf.toString('utf8', 0, n))) return true;
    } catch { /* unreadable: not it */ }
  }
  return false;
}

// refreshOsm (replay mode): 'ifBackup' asks the OpenStreetMap servers again
// when the saved map data is the backup (a level made while they were down
// stayed on it through every update: two lanes for four, no bridges, however
// good the servers were by then); true always asks; false never (the map as
// it was saved). What they answer is recorded for the next replay; when they
// still do not answer, the saved data is used as before.
export function installSourceRecorder({ dir, mode = 'record', fallback = true, recordDir = null, strict = false, refreshOsm = false }) {
  fs.mkdirSync(dir, { recursive: true });
  if (recordDir) fs.mkdirSync(recordDir, { recursive: true });
  const refresh = mode === 'replay' && (refreshOsm === true || (refreshOsm === 'ifBackup' && savedFromBackupMapData(dir)));
  // (downloaded: misses that went online; missedUrls: the first few, for the log)
  // (stats.strict may be switched on later: the export job, after its data step)
  // (pinned: set by the export job; the cache's ages are not looked at while it is on)
  const stats = { recorded: 0, replayed: 0, missed: 0, downloaded: 0, missedUrls: [], downloadedUrls: [], strict: !!strict, refreshOsm: refresh, refreshed: 0, pinned: false };
  // (services/terrain.js skips the GPXZ request pacing while replaying)
  if (mode === 'replay') globalThis.__mapngReplayingSources = true;
  const inner = globalThis.fetch;
  globalThis.fetch = async (input, init = {}) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input?.url;
    if (!url || PASS_THROUGH.test(url)) return inner(input, init);
    const bodyText = await bodyTextOf(init);
    const key = sourceKey(url, init, bodyText);
    const metaFile = path.join(dir, `${key}.json`);
    const bodyFile = path.join(dir, `${key}.bin`);
    if (mode === 'cache') {
      const normalized = String(url).replace(/^https?:\/\/[^/]+(\/api\/interpreter)/, 'overpass:$1');
      let meta = null;
      try { meta = fs.existsSync(metaFile) ? JSON.parse(fs.readFileSync(metaFile, 'utf8')) : null; } catch { meta = null; }
      // (the list of MapNG's map archives: asked again after five minutes. It was kept for as long as the app
      // stayed open, so a list corrected on the server never reached an app left running: a tester's map went
      // on falling back to Overture hours after the list was fixed, 2026-11-13.)
      const age = Date.now() - (meta?.savedAt || 0);
      // (an export reads the map as it was generated: nothing in the cache is too old for it. A chunked level
      // generates every chunk again from the cache at export; half an hour after Generate the later chunks asked the
      // servers for today's roads while the earlier ones had kept the old: roads that no longer met at the seams.)
      const stale = !stats.pinned && meta && ((OSM_REQUEST.test(normalized) && !(age < CACHE_OSM_MS)) || (MANIFEST_REQUEST.test(normalized) && !(age < CACHE_MANIFEST_MS)));
      if (meta && !stale) {
        stats.replayed++;
        // (recently used: the app trims the cache by this, desktop/main.js)
        try { const now = new Date(); fs.utimesSync(metaFile, now, now); } catch { /* read-only */ }
        if (recordDir) { linkInto(metaFile, path.join(recordDir, `${key}.json`)); if (fs.existsSync(bodyFile)) linkInto(bodyFile, path.join(recordDir, `${key}.bin`)); }
        const body = meta.status === 204 || meta.status === 304 ? null : fs.readFileSync(bodyFile);
        return new Response(body, { status: meta.status, statusText: meta.statusText, headers: meta.headers });
      }
      if (stats.strict) throw new TypeError(`fetch refused: the export downloads nothing, and this is not in the download cache (${shownUrl(url)})`);
      stats.downloaded++;
      if (stats.downloadedUrls.length < 20) stats.downloadedUrls.push(shownUrl(url).slice(0, 160));
      const live = await inner(input, init);
      const recMeta = recordDir ? path.join(recordDir, `${key}.json`) : metaFile;
      const recBody = recordDir ? path.join(recordDir, `${key}.bin`) : bodyFile;
      await save(live, recMeta, recBody, url, init);
      if (recordDir && cacheable(live.status) && fs.existsSync(recMeta)) {
        try { fs.rmSync(metaFile, { force: true }); fs.rmSync(bodyFile, { force: true }); } catch { /* replaced below */ }
        linkInto(recBody, bodyFile); linkInto(recMeta, metaFile);
      }
      return live;
    }
    if (mode === 'replay') {
      if (refresh && OSM_REQUEST.test(String(url).replace(/^https?:\/\/[^/]+(\/api\/interpreter)/, 'overpass:$1'))) {
        try {
          const live = await inner(input, init);
          if (live.ok) {
            stats.refreshed++; stats.downloaded++;
            await save(live, path.join(recordDir || dir, `${key}.json`), path.join(recordDir || dir, `${key}.bin`), url, init);
            return live;
          }
        } catch (e) { if (init?.signal?.aborted) throw e; /* still down: the saved data below */ }
      }
      if (fs.existsSync(metaFile)) {
        stats.replayed++;
        const meta = JSON.parse(fs.readFileSync(metaFile, 'utf8'));
        const body = meta.status === 204 || meta.status === 304 ? null : fs.readFileSync(bodyFile);
        return new Response(body, { status: meta.status, statusText: meta.statusText, headers: meta.headers });
      }
      stats.missed++;
      if (stats.missedUrls.length < 20) stats.missedUrls.push(shownUrl(url).slice(0, 160));
      // (an OSM request the first run did not get fails the same way now)
      const normalized = String(url).replace(/^https?:\/\/[^/]+(\/api\/interpreter)/, 'overpass:$1');
      if (!fallback || OSM_REQUEST.test(normalized)) throw new TypeError(`fetch failed: not in the recorded sources (${shownUrl(url)})`);
      stats.downloaded++;
      const live = await inner(input, init);
      if (recordDir) await save(live, path.join(recordDir, `${key}.json`), path.join(recordDir, `${key}.bin`), url, init);
      return live;
    }
    const r = await inner(input, init);
    await save(r, metaFile, bodyFile, url, init);
    return r;
  };
  async function save(r, metaPath, bodyPath, url, init) {
    try {
      const bytes = Buffer.from(await r.clone().arrayBuffer());
      const headers = Object.fromEntries([...r.headers.entries()].filter(([k]) => !/^(content-encoding|content-length|transfer-encoding|set-cookie)$/i.test(k)));
      fs.writeFileSync(bodyPath, bytes);
      fs.writeFileSync(metaPath, JSON.stringify({ url: shownUrl(url), method: init.method || 'GET', status: r.status, statusText: r.statusText, headers, savedAt: Date.now() }));
      stats.recorded++;
    } catch { /* an unreadable body (aborted): the caller sees the same */ }
  }
  return stats;
}
