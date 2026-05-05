/**
 * Manages the lazWorker and provides a Promise-based API for point cloud rasterization.
 */
import proj4 from 'proj4';
import { getBuiltInProj4 } from './uploadGeoMetadata.js';

let worker = null;
let messageId = 0;
const pending = new Map();
const epsgDefCache = new Map();

const resolveProj4Def = async (epsgCode) => {
  if (!epsgCode) return null;
  const key = `EPSG:${epsgCode}`;

  if (epsgDefCache.has(key)) return epsgDefCache.get(key);

  const existing = proj4.defs(key);
  if (existing) {
    const resolved = typeof existing === 'string' ? existing : (existing.defData ?? null);
    epsgDefCache.set(key, resolved);
    return resolved;
  }

  const builtIn = getBuiltInProj4(epsgCode);
  if (builtIn) {
    proj4.defs(key, builtIn);
    epsgDefCache.set(key, builtIn);
    return builtIn;
  }

  try {
    const response = await fetch(`https://epsg.io/${epsgCode}.proj4`, { cache: 'no-store' });
    if (!response.ok) {
      epsgDefCache.set(key, null);
      return null;
    }
    const text = (await response.text()).trim();
    if (!text || !text.includes('+proj=')) {
      epsgDefCache.set(key, null);
      return null;
    }
    proj4.defs(key, text);
    epsgDefCache.set(key, text);
    return text;
  } catch {
    epsgDefCache.set(key, null);
    return null;
  }
};

const getWorker = () => {
  if (worker) return worker;
  try {
    worker = new Worker(new URL('./lazWorker.js', import.meta.url), { type: 'module' });
    worker.onmessage = (e) => {
      const { id, type, ...data } = e.data;
      if (type === 'progress') {
        pending.get(id)?.onProgress?.(data.current, data.total, data.status);
        return;
      }
      const p = pending.get(id);
      if (!p) return;
      pending.delete(id);
      if (type === 'error') p.reject(new Error(data.error));
      else p.resolve(data);
    };
    worker.onerror = (e) => {
      console.error('[LazClient] Worker error:', e);
      for (const p of pending.values()) p.reject(new Error('LAZ worker error: ' + (e.message || 'unknown')));
      pending.clear();
      worker.terminate();
      worker = null;
    };
    return worker;
  } catch (e) {
    console.warn('[LazClient] Failed to create worker:', e);
    return null;
  }
};

/**
 * Rasterize a LAS/LAZ point cloud to a Float32Array heightmap.
 *
 * @param {object}   lazMeta    - Result from parseLazFile()
 * @param {object}   center     - { lat, lng }
 * @param {number}   width      - Output grid width (pixels = metres at 1m/px)
 * @param {number}   height     - Output grid height
 * @param {object?}  targetBounds - Optional WGS84 bounds {north,south,east,west}
 * @param {function} onProgress - (current, total, status?) callback
 */
export const rasterizeLazOffThread = async (lazMeta, center, width, height, targetBounds, onProgress) => {
  const w = getWorker();
  if (!w) return Promise.reject(new Error('LAZ worker unavailable'));

  // Pass any pre-loaded EPSG definition so the worker avoids a network fetch
  const epsgDefs = {};
  if (lazMeta.epsgCode) {
    const key = `EPSG:${lazMeta.epsgCode}`;
    const def = await resolveProj4Def(lazMeta.epsgCode);
    if (def) epsgDefs[key] = def;
  }

  // Copy buffer — preserves original for potential re-generation without re-uploading
  const bufferCopy = lazMeta.buffer.slice(0);

  const id = ++messageId;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject, onProgress });
    w.postMessage({
      id,
      type: 'rasterize',
      buffer:                bufferCopy,
      isLaz:                 lazMeta.isLaz,
      pointFormat:           lazMeta.pointFormat,
      pointDataRecordLength: lazMeta.pointDataRecordLength,
      pointDataOffset:       lazMeta.pointDataOffset,
      pointCount:            lazMeta.pointCount,
      scaleX:  lazMeta.scaleX,  scaleY: lazMeta.scaleY,  scaleZ: lazMeta.scaleZ,
      offsetX: lazMeta.offsetX, offsetY: lazMeta.offsetY, offsetZ: lazMeta.offsetZ,
      minX: lazMeta.minX, maxX: lazMeta.maxX,
      minY: lazMeta.minY, maxY: lazMeta.maxY,
      epsgCode: lazMeta.epsgCode,
      center,
      width,
      height,
      targetBounds,
      epsgDefs,
    }, [bufferCopy]);
  });
};
