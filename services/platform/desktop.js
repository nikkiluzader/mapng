// The desktop app (desktop/): the level export handed to a full Node process
// instead of run in the page. Null on the web, where nothing changes.
//
// The terrain data goes over as files of a job (desktop/runner/jobFormat.mjs
// reads them back): the OSM features as JSON, typed arrays as their bytes,
// canvases and images as PNGs, the rest inline in job.json.
import { toRaw } from 'vue';

export const desktopApp = (typeof window !== 'undefined' && window.mapngDesktop) || null;

// (one IPC message each: well under Chromium's message size limit)
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
export async function exportLevelOnDesktop(terrainData, center, options) {
  const { onProgress, ...rest } = options;
  const jobId = await desktopApp.beginJob();
  const job = { id: jobId, files: 0 };
  onProgress?.({ step: 'Handing the map to the desktop exporter…', pct: 0 });
  const packedTerrain = await packTerrainData(terrainData, job);
  const packedOptions = await pack(rest, 'options', job);
  const result = await desktopApp.runJob(jobId, { center: toRaw(center), terrainData: packedTerrain, options: packedOptions }, onProgress);
  await desktopApp.cleanupJob(jobId);
  return result;
}
