// The desktop app (desktop/): the level export handed to a full Node process
// instead of run in the page. Null on the web, where nothing changes.
//
// The terrain data goes over as files of a job (desktop/runner/jobFormat.mjs
// reads them back): the OSM features as JSON, typed arrays as their bytes,
// canvases and images as PNGs, the rest inline in job.json.
import { toRaw } from 'vue';

export const desktopApp = (typeof window !== 'undefined' && window.mapngDesktop) || null;

// (one IPC message each: well under Chromium's message size limit)
const TERRAIN_FILE_URL = /^app:\/\/mapng\/__terrain\/([\w-]+)\/([\w.-]+)$/;
const mimeOf = (file) => ({ png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', json: 'application/json' }[file.split('.').pop().toLowerCase()] || '');
const CHUNK_BYTES = 64 * 1024 * 1024;

async function sendBytes(jobId, name, bytes) {
  if (bytes.byteLength === 0) { await desktopApp.writeJobFile(jobId, name, new Uint8Array(0), false); return; }
  for (let o = 0; o < bytes.byteLength; o += CHUNK_BYTES) {
    await desktopApp.writeJobFile(jobId, name, bytes.subarray(o, Math.min(o + CHUNK_BYTES, bytes.byteLength)), o > 0);
  }
}

async function sendBlob(jobId, name, blob) {
  if (blob.size === 0) { await sendBytes(jobId, name, new Uint8Array(0)); return; }
  for (let o = 0; o < blob.size; o += CHUNK_BYTES) {
    const piece = new Uint8Array(await blob.slice(o, o + CHUNK_BYTES).arrayBuffer());
    await desktopApp.writeJobFile(jobId, name, piece, o > 0);
  }
}

const isCanvas = (v) => (typeof HTMLCanvasElement !== 'undefined' && v instanceof HTMLCanvasElement)
  || (typeof OffscreenCanvas !== 'undefined' && v instanceof OffscreenCanvas);
const isBitmap = (v) => (typeof ImageBitmap !== 'undefined' && v instanceof ImageBitmap)
  || (typeof HTMLImageElement !== 'undefined' && v instanceof HTMLImageElement);

function canvasBlob(canvas) {
  if (typeof canvas.convertToBlob === 'function') return canvas.convertToBlob({ type: 'image/png' });
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('canvas to PNG failed'))), 'image/png'));
}

async function bitmapBlob(img) {
  const c = document.createElement('canvas');
  c.width = img.naturalWidth || img.width;
  c.height = img.naturalHeight || img.height;
  c.getContext('2d').drawImage(img, 0, 0);
  return canvasBlob(c);
}

/** A value made ready for job.json: big and binary parts sent as files. */
async function pack(value, key, job) {
  value = toRaw(value);
  if (value == null || typeof value === 'boolean' || typeof value === 'number') return value;
  if (typeof value === 'function' || typeof value === 'symbol') return undefined;
  const name = () => `${String(key).replace(/[^\w-]+/g, '_')}_${++job.files}`;
  if (typeof value === 'string') {
    // (a generated terrain's file: linked into the job where it already is)
    const terrainFile = value.match(TERRAIN_FILE_URL);
    if (terrainFile) {
      const file = name();
      await desktopApp.linkTerrainFile(job.id, file, terrainFile[1], terrainFile[2]);
      return { $file: file, as: 'blobUrl', type: mimeOf(terrainFile[2]) };
    }
    // (images by blob:/data: URL: the URL dies with the page, so the image goes)
    if (/^(blob|data):/.test(value)) {
      const blob = await (await fetch(value)).blob();
      const file = name();
      await sendBlob(job.id, file, blob);
      return { $file: file, as: 'blobUrl', type: blob.type };
    }
    return value;
  }
  if (ArrayBuffer.isView(value)) {
    const file = name();
    await sendBytes(job.id, file, new Uint8Array(value.buffer, value.byteOffset, value.byteLength));
    return { $file: file, as: value.constructor.name };
  }
  if (value instanceof ArrayBuffer) {
    const file = name();
    await sendBytes(job.id, file, new Uint8Array(value));
    return { $file: file, as: 'Uint8Array' };
  }
  if (value instanceof Blob && terrainBlobUrls.has(value)) {
    const [, terrainId, terrainFile] = terrainBlobUrls.get(value).match(TERRAIN_FILE_URL);
    const file = name();
    await desktopApp.linkTerrainFile(job.id, file, terrainId, terrainFile);
    return { $file: file, as: 'blob', type: value.type };
  }
  if (value instanceof Blob) {
    const file = name();
    await sendBlob(job.id, file, value);
    return { $file: file, as: 'blob', type: value.type };
  }
  if (isCanvas(value) || isBitmap(value)) {
    const file = name();
    await sendBlob(job.id, file, isCanvas(value) ? await canvasBlob(value) : await bitmapBlob(value));
    return { $file: file, as: 'canvas' };
  }
  if (Array.isArray(value)) {
    const out = [];
    for (let i = 0; i < value.length; i++) out.push(await pack(value[i], key, job));
    return out;
  }
  if (value instanceof Map || value instanceof Set) return undefined;
  const out = {};
  for (const [k, v] of Object.entries(value)) {
    const packed = await pack(v, k, job);
    if (packed !== undefined) out[k] = packed;
  }
  return out;
}

async function packTerrainData(terrainData, job) {
  const td = toRaw(terrainData);
  const out = {};
  for (const [k, v] of Object.entries(td)) {
    if (k === 'osmFeatures' && Array.isArray(v)) {
      // (the biggest value by far: one JSON file, not walked value by value)
      const file = `osmFeatures_${++job.files}.json`;
      await sendBytes(job.id, file, new TextEncoder().encode(JSON.stringify(toRaw(v))));
      out[k] = { $file: file, as: 'json' };
    } else if (k === 'sourceGeoTiffs') {
      // (the GeoTIFF readers stay behind; the export reads only their source)
      if (v?.source) out[k] = { source: v.source };
    } else {
      const packed = await pack(v, k, job);
      if (packed !== undefined) out[k] = packed;
    }
  }
  return out;
}

/**
 * exportBeamNGLevel's work done by the desktop app: the level written into
 * the BeamNG mods folder. Resolves { path, filename, size }, or
 * { cancelled: true } when the user picked no folder.
 */
export async function exportLevelOnDesktop(terrainData, center, options, { signal } = {}) {
  const { onProgress, ...rest } = options;
  const jobId = await desktopApp.beginJob();
  const onAbort = () => desktopApp.cancelJob(jobId);
  signal?.addEventListener?.('abort', onAbort, { once: true });
  try {
    return await runDesktopExport(jobId, terrainData, center, rest, onProgress, signal);
  } catch (error) {
    if (signal?.aborted) { await desktopApp.cleanupJob(jobId); return { cancelled: true }; }
    // ("Error invoking remote method 'job:run': Error: <reason> [log: <file>]")
    const message = String(error?.message || error).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
    const log = message.match(/\s*\[log: (.+)\]$/);
    throw Object.assign(new Error(log ? message.slice(0, log.index) : message), { logPath: log?.[1] || null });
  } finally {
    signal?.removeEventListener?.('abort', onAbort);
  }
}

async function runDesktopExport(jobId, terrainData, center, rest, onProgress, signal) {
  const job = { id: jobId, files: 0 };
  onProgress?.({ step: 'Handing the map to the desktop exporter…', pct: 0 });
  const packedTerrain = await packTerrainData(terrainData, job);
  const info = await desktopApp.info().catch(() => ({}));
  const packedOptions = await pack({ ...rest, appVersion: info?.version || null, platform: 'desktop' }, 'options', job);
  if (signal?.aborted) throw new DOMException('Export cancelled', 'AbortError');
  const result = await desktopApp.runJob(jobId, { center: toRaw(center), terrainData: packedTerrain, options: packedOptions }, onProgress);
  await desktopApp.cleanupJob(jobId);
  // (the levels sidebar lists it)
  if (!result?.cancelled) window.dispatchEvent(new CustomEvent('mapng:levels-changed'));
  return result;
}

// ---- Generate Data in Node --------------------------------------------------

// (the page's settings the terrain services read: desktop/runner/common.mjs)
function settingsSnapshot() {
  const out = {};
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k?.startsWith('mapng')) out[k] = localStorage.getItem(k);
    }
  } catch { /* none */ }
  return out;
}

// (Blobs read from a generated terrain's files: an export links the file)
const terrainBlobUrls = new WeakMap();

const TYPED_ARRAYS = {
  Float32Array, Float64Array, Int8Array, Uint8Array, Uint8ClampedArray, Int16Array, Uint16Array, Int32Array, Uint32Array,
};

/** terrain.json's value read back in the page: images stay files, by URL. */
async function reviveTerrainValue(value, base) {
  if (Array.isArray(value)) return Promise.all(value.map((v) => reviveTerrainValue(v, base)));
  if (!value || typeof value !== 'object') return value;
  if (typeof value.$file === 'string') {
    const url = `${base}/${value.$file}`;
    if (value.as === 'blobUrl' || value.as === 'canvas') return url;
    const r = await fetch(url);
    if (!r.ok) throw new Error(`terrain file ${value.$file}: ${r.status}`);
    if (value.as === 'json') return r.json();
    if (value.as === 'blob') {
      const blob = new Blob([await r.arrayBuffer()], { type: value.type || '' });
      terrainBlobUrls.set(blob, url);
      return blob;
    }
    const Typed = TYPED_ARRAYS[value.as];
    if (!Typed) throw new Error(`unknown terrain value kind ${value.as}`);
    return new Typed(await r.arrayBuffer());
  }
  const out = {};
  for (const [k, v] of Object.entries(value)) out[k] = await reviveTerrainValue(v, base);
  return out;
}

/**
 * services/terrain.js fetchTerrainData's work done by the desktop app in a
 * Node process (same arguments): no 4 GB window limit on the fetching and
 * processing. The terrain's images come back as app:// file URLs, not
 * copies; an export links those files instead of sending them back.
 */
export async function fetchTerrainDataOnDesktop(center, resolution, includeOSM, useUSGS, useGPXZ, useKRON86, gpxzApiKey, onProgress, signal, generationOptions = {}) {
  if (signal?.aborted) throw new DOMException('Terrain generation cancelled', 'AbortError');
  let terrainId = null;
  const onAbort = () => { if (terrainId) desktopApp.cancelTerrain(terrainId); };
  signal?.addEventListener?.('abort', onAbort, { once: true });
  try {
    const result = await desktopApp.generateTerrain({
      center: toRaw(center), resolution, includeOSM, useUSGS, useGPXZ, useKRON86, gpxzApiKey,
      generationOptions: JSON.parse(JSON.stringify(toRaw(generationOptions) || {})),
      localStorage: settingsSnapshot(),
    }, {
      onStarted: (id) => { terrainId = id; if (signal?.aborted) desktopApp.cancelTerrain(id); },
      onProgress,
    });
    if (result?.cancelled || signal?.aborted) throw new DOMException('Terrain generation cancelled', 'AbortError');
    const base = `app://mapng/__terrain/${result.id}`;
    const stored = await (await fetch(`${base}/terrain.json`)).json();
    const data = await reviveTerrainValue(stored, base);
    data.desktopTerrainId = result.id;
    return data;
  } finally {
    signal?.removeEventListener?.('abort', onAbort);
  }
}
