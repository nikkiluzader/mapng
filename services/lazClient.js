/**
 * Manages the lazWorker and provides a Promise-based API for point cloud rasterization.
 */
import { codeFailed } from './appUpdate.js';
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
      codeFailed();   // (its file may be gone: the site was updated under this page)
      console.error('[LazClient] Worker error:', e);
      const detail = e.message || (e.filename ? `${e.filename}:${e.lineno}` : 'unknown');
      for (const p of pending.values()) p.reject(new Error('LAZ worker error: ' + detail));
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
 * @param {AbortSignal} [signal]
 */
export const rasterizeLazOffThread = async (lazMeta, center, width, height, targetBounds, onProgress, signal) => {
  signal?.throwIfAborted();
  const w = getWorker();
  if (!w) return Promise.reject(new Error('LAZ worker unavailable'));

  // One or many point-cloud tiles; multiple overlapping tiles are accumulated
  // into a single output grid by the worker for seamless merging.
  const tileMetas = Array.isArray(lazMeta.tiles) && lazMeta.tiles.length > 0
    ? lazMeta.tiles
    : [lazMeta];

  // Pass any pre-loaded EPSG definitions so the worker avoids a network fetch
  const epsgDefs = {};
  for (const tile of tileMetas) {
    if (!tile.epsgCode) continue;
    const key = `EPSG:${tile.epsgCode}`;
    if (epsgDefs[key]) continue;
    const def = await resolveProj4Def(tile.epsgCode);
    if (def) epsgDefs[key] = def;
  }

  // Copy buffers — preserves originals for re-generation without re-uploading
  const transferables = [];
  const tiles = tileMetas.map((tile) => {
    const bufferCopy = tile.buffer.slice(0);
    transferables.push(bufferCopy);
    return {
      buffer:                bufferCopy,
      isLaz:                 tile.isLaz,
      pointFormat:           tile.pointFormat,
      pointDataRecordLength: tile.pointDataRecordLength,
      pointDataOffset:       tile.pointDataOffset,
      pointCount:            tile.pointCount,
      scaleX:  tile.scaleX,  scaleY: tile.scaleY,  scaleZ: tile.scaleZ,
      offsetX: tile.offsetX, offsetY: tile.offsetY, offsetZ: tile.offsetZ,
      minX: tile.minX, maxX: tile.maxX,
      minY: tile.minY, maxY: tile.maxY,
      epsgCode: tile.epsgCode,
    };
  });

  if (signal?.aborted) return Promise.reject(new DOMException('Aborted', 'AbortError'));

  const id = ++messageId;
  return new Promise((resolve, reject) => {
    let onAbort;
    if (signal) {
      signal.throwIfAborted();
      onAbort = () => {
        pending.delete(id);
        reject(new DOMException('Aborted', 'AbortError'));
      };
      signal.addEventListener('abort', onAbort, { once: true });
    }
    pending.set(id, {
      resolve: (value) => {
        if (onAbort) signal.removeEventListener('abort', onAbort);
        resolve(value);
      },
      reject: (err) => {
        if (onAbort) signal.removeEventListener('abort', onAbort);
        reject(err);
      },
      onProgress,
    });
    w.postMessage({
      id,
      type: 'rasterize',
      tiles,
      center,
      width,
      height,
      targetBounds,
      epsgDefs,
    }, transferables);
  });
};
