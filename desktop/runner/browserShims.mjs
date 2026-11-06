// The browser APIs the level export draws with, in Node: a real canvas
// (@napi-rs/canvas) behind document.createElement('canvas'), OffscreenCanvas,
// Image, ImageData and createImageBitmap, and blob: URLs kept in memory so
// images and fetch() can read them back. (scripts/sweep/polyfill.mjs stubs
// the images instead; the desktop app needs the real ones.)
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
    this.encode(mime === 'image/png' ? 'png' : mime.slice(6), q)
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
  globalThis.fetch = (input, init) => {
    let url = typeof input === 'string' ? input : input instanceof URL ? input.href : input?.url;
    if (url?.startsWith('app://mapng/')) { url = url.slice('app://mapng'.length); input = url; }
    if (url?.startsWith('blob:')) {
      const blob = blobs.get(url);
      return Promise.resolve(blob ? new Response(blob) : new Response(null, { status: 404 }));
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
      return originalFetch(input, { ...init, headers });
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
const cacheable = (status) => (status >= 200 && status < 300) || status === 404;
const linkInto = (from, to) => { try { fs.linkSync(from, to); } catch { try { fs.copyFileSync(from, to); } catch { /* best effort */ } } };

export function installSourceRecorder({ dir, mode = 'record', fallback = true, recordDir = null }) {
  fs.mkdirSync(dir, { recursive: true });
  if (recordDir) fs.mkdirSync(recordDir, { recursive: true });
  // (downloaded: misses that went online; missedUrls: the first few, for the log)
  const stats = { recorded: 0, replayed: 0, missed: 0, downloaded: 0, missedUrls: [] };
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
      const stale = meta && OSM_REQUEST.test(normalized) && !(Date.now() - (meta.savedAt || 0) < CACHE_OSM_MS);
      if (meta && !stale) {
        stats.replayed++;
        if (recordDir) { linkInto(metaFile, path.join(recordDir, `${key}.json`)); if (fs.existsSync(bodyFile)) linkInto(bodyFile, path.join(recordDir, `${key}.bin`)); }
        const body = meta.status === 204 || meta.status === 304 ? null : fs.readFileSync(bodyFile);
        return new Response(body, { status: meta.status, statusText: meta.statusText, headers: meta.headers });
      }
      stats.downloaded++;
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
      if (fs.existsSync(metaFile)) {
        stats.replayed++;
        const meta = JSON.parse(fs.readFileSync(metaFile, 'utf8'));
        const body = meta.status === 204 || meta.status === 304 ? null : fs.readFileSync(bodyFile);
        return new Response(body, { status: meta.status, statusText: meta.statusText, headers: meta.headers });
      }
      stats.missed++;
      if (stats.missedUrls.length < 20) stats.missedUrls.push(url.slice(0, 160));
      // (an OSM request the first run did not get fails the same way now)
      const normalized = String(url).replace(/^https?:\/\/[^/]+(\/api\/interpreter)/, 'overpass:$1');
      if (!fallback || OSM_REQUEST.test(normalized)) throw new TypeError(`fetch failed: not in the recorded sources (${url})`);
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
      fs.writeFileSync(metaPath, JSON.stringify({ url, method: init.method || 'GET', status: r.status, statusText: r.statusText, headers, savedAt: Date.now() }));
      stats.recorded++;
    } catch { /* an unreadable body (aborted): the caller sees the same */ }
  }
  return stats;
}
