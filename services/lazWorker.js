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
import { POOL_BELOW_SPACING, poolFineCells, relaxFilled, relaxLevel } from './lazGrid.js';
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
// (where the last mapped point fell inside the grid, as fractions 0-1 across and down; every mapper sets it before
// its bounds test. The point cloud preview bins on it at its own resolution; the terrain's cells are unchanged)
const FRAC = { u: 0, v: 0 };
const buildGridMapper = ({ epsgCode, center, width, height, minX, maxX, minY, maxY, targetBounds, epsgDefs }) => {
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
      if (!proj4.defs(epsg)) {
        console.info(`[lazWorker] No proj4 definition for ${epsg}; using extent-stretch fallback.`);
        throw new Error(`Missing proj4 definition for ${epsg}`);
      }
      const toFileCRS = proj4('EPSG:4326', epsg);

      // Prefer explicit WGS84 bounds from the pipeline so point rasterization
      // shares the exact same geographic envelope as satellite/OSM sampling.
      //
      // Inverse-project each point to lon/lat and bin it linearly within that
      // envelope. This is correct for ANY projection — including conic CRS like
      // Albers (EPSG:6350), where a lon/lat rectangle is a rotated/curved quad
      // in projected space. The previous approach stretched the projected
      // bounding box, which tilted the data and broke alignment with the
      // linear-in-lon/lat OSM/satellite grid.
      if (targetBounds && ['north', 'south', 'east', 'west'].every((key) => Number.isFinite(Number(targetBounds[key])))) {
        const west = Number(targetBounds.west);
        const east = Number(targetBounds.east);
        const south = Number(targetBounds.south);
        const north = Number(targetBounds.north);
        const lngSpan = east - west;
        const latSpan = north - south;
        if (lngSpan > 0 && latSpan > 0) {
          const toWGS84 = proj4(epsg, 'EPSG:4326');
          return (px, py) => {
            const [lng, lat] = toWGS84.forward([px, py]);
            FRAC.u = (lng - west) / lngSpan; FRAC.v = (north - lat) / latSpan;
            if (lng < west || lng > east || lat < south || lat > north) return -1;
            const col = Math.min(width - 1, Math.max(0, Math.floor((lng - west) / lngSpan * width)));
            const row = Math.min(height - 1, Math.max(0, Math.floor((north - lat) / latSpan * height)));
            return row * width + col;
          };
        }
      }

      const [cx, cy]  = toFileCRS.forward([center.lng, center.lat]);

      // Build a local 2D basis in file CRS for +1m east and +1m north.
      // This handles:
      // 1) non-metric CRS units (e.g. US survey feet), and
      // 2) local axis rotation/shear between geographic EN and projected XY.
      // Using only independent X/Y scales can introduce directional offsets.
      const mPerDegLat = 111320;
      const mPerDegLng = 111320 * Math.cos(center.lat * Math.PI / 180);
      const [ex, ey] = toFileCRS.forward([center.lng + 1 / mPerDegLng, center.lat]);
      const [nx, ny] = toFileCRS.forward([center.lng, center.lat + 1 / mPerDegLat]);

      const ux = ex - cx;
      const uy = ey - cy;
      const vx = nx - cx;
      const vy = ny - cy;

      const det = ux * vy - uy * vx;
      if (!Number.isFinite(det) || Math.abs(det) < 1e-12) {
        throw new Error(`Degenerate local CRS basis for ${epsg}`);
      }

      return (px, py) => {
        const dx = px - cx;
        const dy = py - cy;

        // Solve [u v] * [east north]^T = d for local metre offsets.
        const eastMeters = (dx * vy - dy * vx) / det;
        const northMeters = (ux * dy - uy * dx) / det;
        FRAC.u = (eastMeters + halfW) / (2 * halfW); FRAC.v = (halfH - northMeters) / (2 * halfH);

        if (eastMeters < -halfW || eastMeters > halfW || northMeters < -halfH || northMeters > halfH) return -1;

        const col = Math.min(width  - 1, Math.max(0, Math.floor((eastMeters + halfW) / (2 * halfW) * width)));
        const row = Math.min(height - 1, Math.max(0, Math.floor((halfH - northMeters) / (2 * halfH) * height)));
        return row * width + col;
      };
    } catch (e) {
      if (!String(e?.message || '').includes('Missing proj4 definition')) {
        console.warn('[lazWorker] CRS mapping failed, falling back to extent stretch:', e);
      }
    }
  }

  // Geographic CRS (EPSG:4326) — degree→metre approximation
  if (epsgCode === 4326) {
    if (targetBounds && ['north', 'south', 'east', 'west'].every((key) => Number.isFinite(Number(targetBounds[key])))) {
      const north = Number(targetBounds.north);
      const south = Number(targetBounds.south);
      const east = Number(targetBounds.east);
      const west = Number(targetBounds.west);
      const spanX = east - west;
      const spanY = north - south;
      if (spanX > 0 && spanY > 0) {
        return (px, py) => {
          FRAC.u = (px - west) / spanX; FRAC.v = (north - py) / spanY;
          if (px < west || px > east || py < south || py > north) return -1;
          const col = Math.min(width - 1, Math.max(0, Math.floor((px - west) / spanX * width)));
          const row = Math.min(height - 1, Math.max(0, Math.floor((north - py) / spanY * height)));
          return row * width + col;
        };
      }
    }

    const mPerDegLat = 111320;
    const mPerDegLng = 111320 * Math.cos(center.lat * Math.PI / 180);
    return (px, py) => {
      const dx = (px - center.lng) * mPerDegLng;
      const dy = (py - center.lat) * mPerDegLat;
      FRAC.u = (dx + halfW) / width; FRAC.v = (halfH - dy) / height;
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
    FRAC.u = (px - minX) / extW; FRAC.v = (maxY - py) / extH;
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

  // Propagate down, each level's filled cells relaxed against its measured ones (lazGrid.relaxLevel: without it a
  // lone point in a wide gap stood at the bottom of a funnel metres deep)
  for (let li = levels.length - 2; li >= 0; li--) {
    const coarse = levels[li + 1];
    const fine   = levels[li];
    let nHoles = 0;
    for (let i = 0; i < fine.data.length; i++) if (fine.data[i] === NO_DATA || !Number.isFinite(fine.data[i])) nHoles++;
    const levelHoles = new Int32Array(nHoles);
    for (let i = 0, k = 0; i < fine.data.length; i++) if (fine.data[i] === NO_DATA || !Number.isFinite(fine.data[i])) levelHoles[k++] = i;
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
    // (the finest level is relaxed after, by relaxFilled, over the holes inside the footprint only)
    if (li > 0 && levelHoles.length) relaxLevel(fine.data, fine.w, fine.h, levelHoles);
  }
  heightMap.set(levels[0].data);
};

// The empty cells outside every tile's footprint (each a quad of grid coordinates), as markExteriorNoData's mask.
const markOutsideFootprints = (heightMap, width, height, quads) => {
  const inside = new Uint8Array(width * height);
  for (const q of quads) {
    const v0 = Math.max(0, Math.floor(Math.min(...q.map((p) => p[1])))); const v1 = Math.min(height - 1, Math.ceil(Math.max(...q.map((p) => p[1]))));
    for (let r = v0; r <= v1; r++) {
      const y = r + 0.5; const xs = [];
      for (let k = 0; k < 4; k++) {
        const [ax, ay] = q[k]; const [bx, by] = q[(k + 1) % 4];
        if ((ay > y) !== (by > y)) xs.push(ax + ((y - ay) / (by - ay)) * (bx - ax));
      }
      xs.sort((a, b) => a - b);
      for (let k = 0; k + 1 < xs.length; k += 2) {
        const c0 = Math.max(0, Math.ceil(xs[k] - 0.5)); const c1 = Math.min(width - 1, Math.floor(xs[k + 1] - 0.5));
        for (let c = c0; c <= c1; c++) inside[r * width + c] = 1;
      }
    }
  }
  const outside = new Uint8Array(width * height);
  for (let i = 0; i < outside.length; i++) if (!inside[i] && heightMap[i] === NO_DATA) outside[i] = 1;
  return outside;
};

// Mark NO_DATA cells connected to the grid border so we can preserve them after
// interpolation. This prevents the hole-filler from extrapolating terrain into
// exterior empty regions around the point cloud footprint.
const markExteriorNoData = (heightMap, width, height) => {
  const total = width * height;
  const marked = new Uint8Array(total);
  const queue = new Uint32Array(total);
  let head = 0;
  let tail = 0;

  const enqueue = (idx) => {
    if (marked[idx]) return;
    if (heightMap[idx] !== NO_DATA || !Number.isFinite(heightMap[idx])) return;
    marked[idx] = 1;
    queue[tail++] = idx;
  };

  // Seed flood-fill from all four borders.
  for (let x = 0; x < width; x++) {
    enqueue(x);
    enqueue((height - 1) * width + x);
  }
  for (let y = 1; y < height - 1; y++) {
    enqueue(y * width);
    enqueue(y * width + (width - 1));
  }

  while (head < tail) {
    const idx = queue[head++];
    const y = Math.floor(idx / width);
    const x = idx - y * width;

    if (x > 0) enqueue(idx - 1);
    if (x < width - 1) enqueue(idx + 1);
    if (y > 0) enqueue(idx - width);
    if (y < height - 1) enqueue(idx + width);
  }

  return marked;
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

// ─── Accumulate one tile's ground/water points into shared cell sums ──────────
// Decodes a single LAZ/LAS buffer and adds each ground (class 2) / water (9)
// return to groundSum/groundCnt via the tile's own gridMapper. Multiple
// overlapping tiles share these accumulators, so overlap regions simply average
// every contributing tile's points — seamless, with no per-tile edge artifacts.
// (layers: what the cloud carries, counted in the same pass: points per classification code, points with an
// intensity and its peak, colour sampled every RGB_SAMPLE_EVERY points. The upload card lists them; later steps can
// take trees, buildings or markings from them)
const RGB_SAMPLE_EVERY = 1000;
const rgbOffset = (fmt) => ({ 2: 20, 3: 28, 5: 28, 7: 30, 8: 30, 10: 30 }[fmt] ?? -1);
export const newLayerStats = () => ({ classes: new Float64Array(256), points: 0, intensityPoints: 0, intensityMax: 0, rgbSamples: 0, rgbColoured: 0 });
const countLayers = (L, cls, intensity, rgbAt, i) => {
  L.classes[cls]++; L.points++;
  if (intensity > 0) { L.intensityPoints++; if (intensity > L.intensityMax) L.intensityMax = intensity; }
  if (rgbAt && i % RGB_SAMPLE_EVERY === 0) { L.rgbSamples++; if (rgbAt()) L.rgbColoured++; }
};
// ─── Point cloud preview (the 2D preview's Classes and Intensity views) ───────
// A grid at its own resolution (about two point spacings a cell, at most PREVIEW_MAX_PX a side) over the same
// bounds as the terrain: per cell the class of the highest point (an aerial view: noise and flight-strip overlap
// left out) and the average return (paint and signs show bright). Ground and water points are placed by the terrain's
// own projection (FRAC); the rest by a straight-line fit of it across the tile, used only where it agrees with the
// exact projection to a tenth of a cell (a display, not geometry).
const PREVIEW_MAX_PX = 2048;
// (the tiles' average point spacing from their headers, m)
const pointSpacingOf = (tiles) => {
  let pts = 0; let area = 0;
  for (const t of tiles) { pts += Number(t.pointCount) || 0; area += Math.max(0, (t.maxX - t.minX) * (t.maxY - t.minY)); }
  return pts > 0 && area > 0 ? Math.sqrt(area / pts) : 1;
};
const newPreview = (width, height, metersPerPixel, tiles) => {
  const spacing = pointSpacingOf(tiles);
  const mpp = Number(metersPerPixel) > 0 ? Number(metersPerPixel) : 1;
  const cellM = Math.max(2 * spacing, 0.25, (Math.max(width, height) * mpp) / PREVIEW_MAX_PX);
  const w = Math.max(1, Math.round(width * mpp / cellM)); const h = Math.max(1, Math.round(height * mpp / cellM));
  const top = new Float32Array(w * h).fill(-Infinity);
  return { w, h, top, cls: new Uint8Array(w * h).fill(255), isum: new Uint32Array(w * h), icnt: new Uint16Array(w * h) };
};
const previewAdd = (P, u, v, z, cls, intensity) => {
  if (!(u >= 0 && u < 1 && v >= 0 && v < 1) || cls === 7 || cls === 18) return;
  const i = ((v * P.h) | 0) * P.w + ((u * P.w) | 0);
  if (intensity > 0 && P.icnt[i] < 65535) { P.isum[i] += intensity; P.icnt[i]++; }
  if (cls !== 12 && z > P.top[i]) { P.top[i] = z; P.cls[i] = cls; }
};
// (a straight-line fit u, v = a + b·x + c·y of the exact mapper across a tile, or null where it is off by more
// than a tenth of a preview cell at the tile's corners and middle)
const fitTileFrac = (gridMapper, tile, P) => {
  const at = (x, y) => { gridMapper(x, y); return [FRAC.u, FRAC.v]; };
  const { minX, maxX, minY, maxY } = tile; const dx = maxX - minX; const dy = maxY - minY;
  if (!(dx > 0 && dy > 0)) return null;
  const [u0, v0] = at(minX, minY); const [u1, v1] = at(maxX, minY); const [u2, v2] = at(minX, maxY);
  const fit = { u0, v0, ux: (u1 - u0) / dx, vx: (v1 - v0) / dx, uy: (u2 - u0) / dy, vy: (v2 - v0) / dy, minX, minY };
  if (![fit.ux, fit.vx, fit.uy, fit.vy, u0, v0].every(Number.isFinite)) return null;
  const tolU = 0.1 / P.w; const tolV = 0.1 / P.h;
  for (const [x, y] of [[maxX, maxY], [(minX + maxX) / 2, (minY + maxY) / 2], [minX + dx / 4, maxY - dy / 4]]) {
    const [eu, ev] = at(x, y);
    const fu = fit.u0 + (x - minX) * fit.ux + (y - minY) * fit.uy; const fv = fit.v0 + (x - minX) * fit.vx + (y - minY) * fit.vy;
    if (!(Math.abs(fu - eu) <= tolU && Math.abs(fv - ev) <= tolV)) return null;
  }
  return fit;
};
const accumulateTilePoints = async (tile, gridMapper, groundSum, groundCnt, onPoint, layers = null, preview = null) => {
  const {
    buffer, isLaz,
    pointFormat, pointDataRecordLength, pointDataOffset, pointCount,
    scaleX, scaleY, scaleZ, offsetX, offsetY, offsetZ,
  } = tile;
  const clsOff = classificationOffset(pointFormat);
  const clsMask = pointFormat >= 6 ? 0xFF : 0x1F;
  const rgbOff = rgbOffset(pointFormat);
  const fit = preview ? fitTileFrac(gridMapper, tile, preview) : null;
  // (a point the terrain skips, onto the preview: by the fit, else by the exact mapper)
  const previewOther = (px, py, pz, c, inten) => {
    if (fit) previewAdd(preview, fit.u0 + (px - fit.minX) * fit.ux + (py - fit.minY) * fit.uy, fit.v0 + (px - fit.minX) * fit.vx + (py - fit.minY) * fit.vy, pz, c, inten);
    else { gridMapper(px, py); previewAdd(preview, FRAC.u, FRAC.v, pz, c, inten); }
  };

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
      const fullCls = heap8[pointPtr + clsOff] & clsMask;
      const inten = heap8[pointPtr + 12] | (heap8[pointPtr + 13] << 8);
      if (layers) countLayers(layers, fullCls, inten, rgbOff >= 0 ? () => (heap8[pointPtr + rgbOff] | heap8[pointPtr + rgbOff + 1] | heap8[pointPtr + rgbOff + 2] | heap8[pointPtr + rgbOff + 3] | heap8[pointPtr + rgbOff + 4] | heap8[pointPtr + rgbOff + 5]) > 0 : null, i);
      // Only ground (2) and water (9) — everything else is vegetation/noise
      if (cls !== 2 && cls !== 9) {
        if (preview) previewOther(rawX * scaleX + offsetX, rawY * scaleY + offsetY, rawZ * scaleZ + offsetZ, fullCls, inten);
        onPoint(); continue;
      }

      const px = rawX * scaleX + offsetX;
      const py = rawY * scaleY + offsetY;
      const pz = rawZ * scaleZ + offsetZ;

      const idx = gridMapper(px, py);
      if (idx >= 0) { groundSum[idx] += pz; groundCnt[idx]++; }
      if (preview) previewAdd(preview, FRAC.u, FRAC.v, pz, fullCls, inten);
      onPoint();
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
      const fullCls = bytes[base + clsOff] & clsMask;
      const inten = dataView.getUint16(base + 12, true);
      if (layers) countLayers(layers, fullCls, inten, rgbOff >= 0 ? () => (dataView.getUint16(base + rgbOff, true) | dataView.getUint16(base + rgbOff + 2, true) | dataView.getUint16(base + rgbOff + 4, true)) > 0 : null, i);
      if (cls !== 2 && cls !== 9) {
        if (preview) previewOther(rawX * scaleX + offsetX, rawY * scaleY + offsetY, rawZ * scaleZ + offsetZ, fullCls, inten);
        onPoint(); continue;
      }

      const px = rawX * scaleX + offsetX;
      const py = rawY * scaleY + offsetY;
      const pz = rawZ * scaleZ + offsetZ;

      const idx = gridMapper(px, py);
      if (idx >= 0) { groundSum[idx] += pz; groundCnt[idx]++; }
      if (preview) previewAdd(preview, FRAC.u, FRAC.v, pz, fullCls, inten);
      onPoint();
    }
  }
};

// ─── Main rasterization ───────────────────────────────────────────────────────
// Accepts a single tile (legacy top-level fields) or `params.tiles` — an array
// of per-tile param objects that are accumulated into one shared output grid.
const rasterize = async (params, id) => {
  const { center, width, height, targetBounds, epsgDefs } = params;
  const tiles = Array.isArray(params.tiles) && params.tiles.length > 0
    ? params.tiles
    : [params];

  const totalCells = width * height;

  // Only accumulate classified ground (class 2) and water (class 9) returns.
  // All unclassified / vegetation / noise falls through to NO_DATA and gets
  // smoothly interpolated by the pyramid hole-filler below.
  const groundSum = new Float64Array(totalCells);
  const groundCnt = new Uint32Array(totalCells);

  const layers = newLayerStats();
  const preview = params.pointPreview === false ? null : newPreview(width, height, params.metersPerPixel, tiles);
  const PROGRESS_EVERY = 250_000;
  const totalPoints = tiles.reduce((sum, t) => sum + Number(t.pointCount || 0), 0) || 1;
  let processed = 0;
  const onPoint = () => {
    if (++processed % PROGRESS_EVERY === 0) {
      self.postMessage({ id, type: 'progress', current: processed, total: totalPoints });
    }
  };

  const footprints = [];
  for (const tile of tiles) {
    const gridMapper = buildGridMapper({
      epsgCode: tile.epsgCode,
      center, width, height,
      minX: tile.minX, maxX: tile.maxX, minY: tile.minY, maxY: tile.maxY,
      targetBounds, epsgDefs,
    });
    await accumulateTilePoints(tile, gridMapper, groundSum, groundCnt, onPoint, layers, preview);
    // (the tile's extent on the grid: its four corners, as the mapper places them)
    const quad = [[tile.minX, tile.minY], [tile.maxX, tile.minY], [tile.maxX, tile.maxY], [tile.minX, tile.maxY]]
      .map(([x, y]) => { gridMapper(x, y); return [FRAC.u * width, FRAC.v * height]; });
    if (quad.every(([u, v]) => Number.isFinite(u) && Number.isFinite(v))) footprints.push(quad);
  }

  // (cells finer than the points: each takes its neighbours' points too)
  const cellM = Number(params.metersPerPixel) > 0 ? Number(params.metersPerPixel) : 1;
  if (cellM < POOL_BELOW_SPACING * pointSpacingOf(tiles)) poolFineCells(groundSum, groundCnt, width, height);

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

  // Outside the cloud: the empty cells beyond every tile's footprint (the gap fill's, gapFillSources.js). Empty cells
  // inside a footprint are the cloud's own gaps, filled from its points below. (Taken as every empty cell joined to the
  // grid's edge, in sparse ground under trees, where at 10 cm nine cells in ten hold no point, nearly all of them were
  // "outside": the base elevation filled them and each point stood as a spike or a pit among its heights, the
  // "stalactite field" of Toma's 10 cm cloud. Without a footprint, the edge rule as before.)
  const exteriorNoDataMask = footprints.length ? markOutsideFootprints(heightMap, width, height, footprints) : markExteriorNoData(heightMap, width, height);

  self.postMessage({ id, type: 'progress', current: processed, total: processed, status: 'Filling holes…' });
  // (the cells to fill inside the footprint, before filling: smoothed after)
  let nHoles = 0;
  for (let i = 0; i < totalCells; i++) if (heightMap[i] === NO_DATA && !exteriorNoDataMask[i]) nHoles++;
  const holes = new Int32Array(nHoles);
  for (let i = 0, k = 0; i < totalCells; i++) if (heightMap[i] === NO_DATA && !exteriorNoDataMask[i]) holes[k++] = i;
  fillHoles(heightMap, width, height);
  relaxFilled(heightMap, width, height, holes);

  // Restore border-connected no-data after filling so only interior gaps are
  // interpolated; this avoids warped edges around sparse footprints.
  for (let i = 0; i < heightMap.length; i++) {
    if (exteriorNoDataMask[i]) heightMap[i] = NO_DATA;
  }

  return { heightMap, layers: summarizeLayers(layers), pointPreview: preview ? finishPreview(preview) : null };
};
// (the preview as the page keeps it: class codes (255 empty) and brightness 1-255 (0 empty): each cell's average
// return, stretched between the 2nd and 99.5th percentile of the cells, so asphalt is dark and paint and signs bright)
const finishPreview = (P) => {
  const n = P.w * P.h; const hist = new Uint32Array(65536); let filled = 0;
  const mean = new Uint16Array(n);
  for (let i = 0; i < n; i++) { if (P.icnt[i]) { const m = Math.round(P.isum[i] / P.icnt[i]); mean[i] = m; hist[m]++; filled++; } }
  let lo = 0; let hi = 1;
  if (filled) {
    let acc = 0; let gotLo = false;
    for (let v = 0; v < 65536; v++) { acc += hist[v]; if (!gotLo && acc >= filled * 0.02) { lo = v; gotLo = true; } if (acc >= filled * 0.995) { hi = v; break; } }
  }
  const span = Math.max(1, hi - lo);
  const intensity = new Uint8Array(n);
  for (let i = 0; i < n; i++) { if (P.icnt[i]) intensity[i] = 1 + Math.max(0, Math.min(254, Math.round((mean[i] - lo) / span * 254))); }
  return { w: P.w, h: P.h, classes: P.cls, intensity };
};
// (the layer counts as the page shows them: shares per classification code over 0.1 %, intensity and colour)
const summarizeLayers = (L) => {
  if (!L.points) return null;
  const classes = [];
  for (let c = 0; c < 256; c++) if (L.classes[c] / L.points >= 0.001) classes.push({ code: c, points: L.classes[c], share: L.classes[c] / L.points });
  classes.sort((a, b) => b.points - a.points);
  return { points: L.points, classes, intensity: L.intensityPoints / L.points >= 0.5, intensityMax: L.intensityMax, colour: L.rgbSamples > 0 && L.rgbColoured / L.rgbSamples >= 0.5 };
};

// ─── Message handler ──────────────────────────────────────────────────────────
self.onmessage = async (e) => {
  const { id, type, ...data } = e.data;
  try {
    if (type === 'rasterize') {
      const { heightMap, layers, pointPreview } = await rasterize(data, id);
      const transfer = [heightMap.buffer];
      if (pointPreview) transfer.push(pointPreview.classes.buffer, pointPreview.intensity.buffer);
      self.postMessage({ id, type: 'done', heightMap, layers, pointPreview }, transfer);
    }
  } catch (err) {
    self.postMessage({ id, type: 'error', error: err.message });
  }
};
