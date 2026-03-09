/**
 * Manages the lazWorker and provides a Promise-based API for point cloud rasterization.
 */
import proj4 from 'proj4';

let worker = null;
let messageId = 0;
const pending = new Map();

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
 * @param {function} onProgress - (current, total, status?) callback
 */
export const rasterizeLazOffThread = (lazMeta, center, width, height, onProgress) => {
  const w = getWorker();
  if (!w) return Promise.reject(new Error('LAZ worker unavailable'));

  // Pass any pre-loaded EPSG definition so the worker avoids a network fetch
  const epsgDefs = {};
  if (lazMeta.epsgCode) {
    const key = `EPSG:${lazMeta.epsgCode}`;
    const def = proj4.defs(key);
    if (def) epsgDefs[key] = typeof def === 'string' ? def : (def.defData ?? undefined);
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
      epsgDefs,
    }, [bufferCopy]);
  });
};
