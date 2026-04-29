/**
 * Web Worker for LAS/LAZ point cloud rasterization.
 *
 * Uses the laz-perf/lib/worker build which correctly sets ENVIRONMENT_IS_WORKER=true.
 * WASM is served from /laz-perf.wasm (copied to public/).
 *
 * Message protocol:
 *   In:  { id, type:'rasterize', ...lazMeta, center, width, height, epsgDefs }
 *   Out: { id, type:'progress', current, total, status? }
 *        { id, type:'done', heightMap: Float32Array }
 *        { id, type:'error', error: string }
 */
import proj4 from 'proj4';
// Import the worker-specific build (ENVIRONMENT_IS_WORKER=true).
// WASM is resolved via locateFile → /laz-perf.wasm in public/.
import { createLazPerf } from 'laz-perf/lib/worker';
import { getBuiltInProj4 } from './uploadGeoMetadata.js';

const NO_DATA = -99999;

// ─── Classification byte offset by point format ───────────────────────────────
// Formats 0–5 (LAS 1.0–1.3): classification at byte 15
// Formats 6–10 (LAS 1.4):    classification at byte 16
const classificationOffset = (fmt) => fmt >= 6 ? 16 : 15;

// ─── Spike removal ────────────────────────────────────────────────────────────
// Cells whose elevation is significantly above the median of their 8 neighbors
// are vegetation / noise returns. Mark them as NO_DATA so the pyramid hole-filler
// can interpolate a smooth ground surface in their place.
const removeSpikes = (heightMap, width, height) => {
  const SPIKE_HEIGHT = 25; // metres above neighbour median → outlier
  const scratch = new Float32Array(8);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = y * width + x;
      const val = heightMap[idx];
      if (val === NO_DATA || !Number.isFinite(val)) continue;

      let cnt = 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dy === 0) continue;
          const nx = x + dx, ny = y + dy;
          if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
          const nv = heightMap[ny * width + nx];
          if (nv !== NO_DATA && Number.isFinite(nv)) scratch[cnt++] = nv;
        }
      }

      if (cnt < 3) continue;

      // Insertion-sort the small buffer (3–8 elements — faster than Array.sort)
      for (let i = 1; i < cnt; i++) {
        const v = scratch[i]; let j = i - 1;
        while (j >= 0 && scratch[j] > v) { scratch[j + 1] = scratch[j]; j--; }
        scratch[j + 1] = v;
      }
      const median = scratch[cnt >> 1];

      if (val - median > SPIKE_HEIGHT) heightMap[idx] = NO_DATA;
    }
  }
};

// ─── Build a point→grid-index mapper ─────────────────────────────────────────
const buildGridMapper = ({ epsgCode, center, width, height, minX, maxX, minY, maxY, epsgDefs }) => {
  if (epsgDefs) {
    for (const [key, def] of Object.entries(epsgDefs)) {
      if (def && !proj4.defs(key)) proj4.defs(key, def);
    }
  }

  const halfW = width  / 2;
  const halfH = height / 2;

  // Projected CRS in metres — use metric offset from centre
  if (epsgCode && epsgCode !== 4326) {
    const epsg = `EPSG:${epsgCode}`;
    try {
      if (!proj4.defs(epsg)) {
        const builtIn = getBuiltInProj4(epsgCode);
        if (builtIn) proj4.defs(epsg, builtIn);
        // Workers can't async-fetch — CRS must arrive via epsgDefs
      }
      const toFileCRS = proj4('EPSG:4326', epsg);
      const [cx, cy]  = toFileCRS.forward([center.lng, center.lat]);

      // Determine how many CRS units equal 1 metre in each axis.
      // This handles non-metric CRS (e.g. EPSG:6438 uses US survey feet, not metres).
      // Without this, halfW/halfH (in metres) would be compared against dx/dy (in feet),
      // causing the terrain to be stretched by ~3.28× and misaligned with OSM overlays.
      const mPerDegLat = 111320;
      const mPerDegLng = 111320 * Math.cos(center.lat * Math.PI / 180);
      const [ex]    = toFileCRS.forward([center.lng + 1 / mPerDegLng, center.lat]);
      const [, ny]  = toFileCRS.forward([center.lng, center.lat + 1 / mPerDegLat]);
      const crsPerMX = Math.abs(ex - cx);  // CRS units per metre (easting)
      const crsPerMY = Math.abs(ny - cy);  // CRS units per metre (northing)

      const halfW_crs = halfW * crsPerMX;
      const halfH_crs = halfH * crsPerMY;

      return (px, py) => {
        const dx = px - cx;
        const dy = py - cy;
        if (dx < -halfW_crs || dx > halfW_crs || dy < -halfH_crs || dy > halfH_crs) return -1;
        const col = Math.min(width  - 1, Math.floor((dx + halfW_crs) / (2 * halfW_crs) * width));
        const row = Math.min(height - 1, Math.floor((halfH_crs - dy) / (2 * halfH_crs) * height));
        return row * width + col;
      };
    } catch (e) {
      console.warn('[lazWorker] CRS mapping failed, falling back to extent stretch:', e);
    }
  }

  // Geographic CRS (EPSG:4326) — degree→metre approximation
  if (epsgCode === 4326) {
    const mPerDegLat = 111320;
    const mPerDegLng = 111320 * Math.cos(center.lat * Math.PI / 180);
    return (px, py) => {
      const dx = (px - center.lng) * mPerDegLng;
      const dy = (py - center.lat) * mPerDegLat;
      if (dx < -halfW || dx > halfW || dy < -halfH || dy > halfH) return -1;
      const col = Math.min(width  - 1, Math.floor((dx + halfW) / width  * width));
      const row = Math.min(height - 1, Math.floor((halfH - dy) / height * height));
      return row * width + col;
    };
  }

  // Unknown CRS — stretch file native extent to output grid
  const extW = maxX - minX || 1;
  const extH = maxY - minY || 1;
  return (px, py) => {
    if (px < minX || px > maxX || py < minY || py > maxY) return -1;
    const col = Math.min(width  - 1, Math.floor((px - minX) / extW * width));
    const row = Math.min(height - 1, Math.floor((maxY - py) / extH * height));
    return row * width + col;
  };
};

// ─── Pyramid push-pull hole filling ──────────────────────────────────────────
const fillHoles = (heightMap, width, height) => {
  let anyHole = false;
  for (let i = 0; i < heightMap.length; i++) {
    if (heightMap[i] === NO_DATA || !Number.isFinite(heightMap[i])) { anyHole = true; break; }
  }
  if (!anyHole) return;

  // Build mip-map pyramid (coarsen until 1×1)
  const levels = [{ data: new Float32Array(heightMap), w: width, h: height }];
  while (levels[levels.length - 1].w > 1 || levels[levels.length - 1].h > 1) {
    const prev = levels[levels.length - 1];
    const nw   = Math.max(1, Math.ceil(prev.w / 2));
    const nh   = Math.max(1, Math.ceil(prev.h / 2));
    const next = new Float32Array(nw * nh).fill(NO_DATA);
    for (let y = 0; y < nh; y++) {
      for (let x = 0; x < nw; x++) {
        let sum = 0, cnt = 0;
        for (let dy = 0; dy < 2; dy++) {
          for (let dx = 0; dx < 2; dx++) {
            const sy = y * 2 + dy, sx = x * 2 + dx;
            if (sy >= prev.h || sx >= prev.w) continue;
            const v = prev.data[sy * prev.w + sx];
            if (v !== NO_DATA && Number.isFinite(v)) { sum += v; cnt++; }
          }
        }
        if (cnt > 0) next[y * nw + x] = sum / cnt;
      }
    }
    levels.push({ data: next, w: nw, h: nh });
  }

  // Seed coarsest level
  if (levels[levels.length - 1].data[0] === NO_DATA) {
    let sum = 0, cnt = 0;
    for (const v of heightMap) { if (v !== NO_DATA && Number.isFinite(v)) { sum += v; cnt++; } }
    levels[levels.length - 1].data[0] = cnt > 0 ? sum / cnt : 0;
  }

  // Propagate down
  for (let li = levels.length - 2; li >= 0; li--) {
    const coarse = levels[li + 1];
    const fine   = levels[li];
    for (let y = 0; y < fine.h; y++) {
      for (let x = 0; x < fine.w; x++) {
        const idx = y * fine.w + x;
        if (fine.data[idx] !== NO_DATA && Number.isFinite(fine.data[idx])) continue;
        const cx0 = Math.min(coarse.w - 1, Math.floor(x * 0.5));
        const cy0 = Math.min(coarse.h - 1, Math.floor(y * 0.5));
        const cx1 = Math.min(coarse.w - 1, cx0 + 1);
        const cy1 = Math.min(coarse.h - 1, cy0 + 1);
        const fx = x * 0.5 - cx0, fy = y * 0.5 - cy0;
        fine.data[idx] =
          coarse.data[cy0 * coarse.w + cx0] * (1-fx) * (1-fy) +
          coarse.data[cy0 * coarse.w + cx1] * fx     * (1-fy) +
          coarse.data[cy1 * coarse.w + cx0] * (1-fx) * fy     +
          coarse.data[cy1 * coarse.w + cx1] * fx     * fy;
      }
    }
  }
  heightMap.set(levels[0].data);
};

// ─── Lazy laz-perf WASM instance (created once per worker) ───────────────────
let lazPerfInstance = null;
const getLazPerf = async () => {
  if (lazPerfInstance) return lazPerfInstance;
  // locateFile redirects WASM fetch to /laz-perf.wasm (copied to public/)
  lazPerfInstance = await createLazPerf({
    locateFile: (path) => path.endsWith('.wasm') ? '/laz-perf.wasm' : path,
  });
  return lazPerfInstance;
};

// ─── Main rasterization ───────────────────────────────────────────────────────
const rasterize = async (params, id) => {
  const {
    buffer, isLaz,
    pointFormat, pointDataRecordLength, pointDataOffset, pointCount,
    scaleX, scaleY, scaleZ, offsetX, offsetY, offsetZ,
    minX, maxX, minY, maxY,
    epsgCode, center, width, height, epsgDefs,
  } = params;

  const gridMapper = buildGridMapper({ epsgCode, center, width, height, minX, maxX, minY, maxY, epsgDefs });
  const clsOff     = classificationOffset(pointFormat);
  const totalCells = width * height;

  // Only accumulate classified ground (class 2) and water (class 9) returns.
  // All unclassified / vegetation / noise falls through to NO_DATA and gets
  // smoothly interpolated by the pyramid hole-filler below.
  const groundSum = new Float64Array(totalCells);
  const groundCnt = new Uint32Array(totalCells);

  const PROGRESS_EVERY = 250_000;
  let processed = 0;

  if (isLaz) {
    // ── LAZ: decompress via laz-perf WASM ──────────────────────────────────
    const lp = await getLazPerf();

    const fileBytes = new Uint8Array(buffer);
    const filePtr   = lp._malloc(fileBytes.length);
    if (!filePtr) throw new Error('LAZ: failed to allocate WASM memory');
    lp.HEAPU8.set(fileBytes, filePtr);

    const decoder  = new lp.LASZip();
    decoder.open(filePtr, fileBytes.length);

    const pointLen    = decoder.getPointLength();
    const lazCount    = decoder.getCount();
    const actualCount = lazCount > 0 ? lazCount : pointCount;
    const pointPtr    = lp._malloc(pointLen);
    if (!pointPtr) throw new Error('LAZ: failed to allocate point buffer');

    let heap8  = lp.HEAPU8;
    let heap32 = lp.HEAP32;

    for (let i = 0; i < actualCount; i++) {
      decoder.getPoint(pointPtr);

      // Refresh views if WASM memory grew (rare)
      if (heap8.buffer.byteLength === 0) { heap8 = lp.HEAPU8; heap32 = lp.HEAP32; }

      const rawX = heap32[(pointPtr >> 2)];
      const rawY = heap32[(pointPtr >> 2) + 1];
      const rawZ = heap32[(pointPtr >> 2) + 2];
      const cls = heap8[pointPtr + clsOff] & 0x1F;
      // Only ground (2) and water (9) — everything else is vegetation/noise
      if (cls !== 2 && cls !== 9) continue;

      const px = rawX * scaleX + offsetX;
      const py = rawY * scaleY + offsetY;
      const pz = rawZ * scaleZ + offsetZ;

      const idx = gridMapper(px, py);
      if (idx >= 0) { groundSum[idx] += pz; groundCnt[idx]++; }

      if (++processed % PROGRESS_EVERY === 0) {
        self.postMessage({ id, type: 'progress', current: processed, total: actualCount });
      }
    }

    decoder.delete();
    lp._free(pointPtr);
    lp._free(filePtr);

  } else {
    // ── LAS: direct binary read (uncompressed) ──────────────────────────────
    const bytes    = new Uint8Array(buffer);
    const dataView = new DataView(buffer);
    const stride   = pointDataRecordLength;

    for (let i = 0; i < pointCount; i++) {
      const base = pointDataOffset + i * stride;

      const rawX = dataView.getInt32(base,     true);
      const rawY = dataView.getInt32(base + 4, true);
      const rawZ = dataView.getInt32(base + 8, true);
      const cls = bytes[base + clsOff] & 0x1F;
      if (cls !== 2 && cls !== 9) continue;

      const px = rawX * scaleX + offsetX;
      const py = rawY * scaleY + offsetY;
      const pz = rawZ * scaleZ + offsetZ;

      const idx = gridMapper(px, py);
      if (idx >= 0) { groundSum[idx] += pz; groundCnt[idx]++; }

      if (++processed % PROGRESS_EVERY === 0) {
        self.postMessage({ id, type: 'progress', current: processed, total: pointCount });
      }
    }
  }

  // ── Build final heightmap ─────────────────────────────────────────────────
  // Cells with no ground/water returns are left as NO_DATA; the pyramid
  // hole-filler below interpolates them from surrounding ground points.
  const heightMap = new Float32Array(totalCells);
  let hasData = false;
  for (let i = 0; i < totalCells; i++) {
    if (groundCnt[i] > 0) {
      heightMap[i] = groundSum[i] / groundCnt[i];
      hasData = true;
    } else {
      heightMap[i] = NO_DATA;
    }
  }

  if (!hasData) {
    throw new Error(
      'No points found in the selected area. ' +
      'Make sure the map is centred on the region covered by your file.'
    );
  }

  self.postMessage({ id, type: 'progress', current: processed, total: processed, status: 'Filling holes…' });
  fillHoles(heightMap, width, height);

  return heightMap;
};

// ─── Message handler ──────────────────────────────────────────────────────────
self.onmessage = async (e) => {
  const { id, type, ...data } = e.data;
  try {
    if (type === 'rasterize') {
      const heightMap = await rasterize(data, id);
      self.postMessage({ id, type: 'done', heightMap }, [heightMap.buffer]);
    }
  } catch (err) {
    self.postMessage({ id, type: 'error', error: err.message });
  }
};
