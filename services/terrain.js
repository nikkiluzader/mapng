import { fetchOSMData, getLastOSMRequestInfo, getOSMQueryParameters } from "./osm.js";
import { parseRasterOrGridElevationFile, parseTifFile, parseTifFiles, parseGridFiles } from "./tifLoader.js";
import { resolveNoDataValue, NODATA_AUTO, NODATA_FALLBACK } from "./nodataDetect.js";
import { GAP_FILL_STANDARD, GAP_FILL_GPXZ, GAP_FILL_NONE } from "./gapFillSources.js";
import { applyLayerOrder, assignLayerIndices } from "./elevationLayers.js";
export { parseRasterOrGridElevationFile };
// Backward-compatible export; prefer parseElevationFile() in new call sites.
export { parseTifFile };
import { parseLazFile, parseLazFiles } from "./lazLoader.js";
export { parseLazFile };
import { parseAscFiles } from './ascLoader.js';
import { rasterizeLazOffThread } from "./lazClient.js";
import { generateOSMTexture, generateHybridTexture } from "./osmTexture.js";
import * as GeoTIFF from "geotiff";
import {
  resampleHeightAndImageOffThread,
  resampleImageOffThread,
} from "./resamplerClient.js";
import { createLocalToWGS84 } from "./geoUtils.js";
import { fetchKron86GridForBounds, isWithinKron86Coverage } from "./kron86.js";
import { smoothRoadsInHeightmap } from "./roadSmoother.js";
import { scaleNativeDimsToProcessingMpp } from "./uploadBounds.js";

// Constants
const TILE_SIZE = 256;
export const TERRAIN_ZOOM = 15; // Fixed high detail zoom level for Terrain
const SATELLITE_ZOOM = 17; // Higher detail zoom level for Satellite (approx 1.2m/px)
const MIN_SATELLITE_ZOOM = 0;
export const TILE_API_URL = "https://s3.amazonaws.com/elevation-tiles-prod/terrarium";
const SATELLITE_API_URL =
  "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile";
const USGS_PRODUCT_API = "https://tnmaccess.nationalmap.gov/api/v1/products";
const USGS_DATASET = "Digital Elevation Model (DEM) 1 meter";
const FEET_TO_METERS = 0.3048;
const US_SURVEY_FEET_TO_METERS = 1200 / 3937;

// Helper to normalize longitude to -180 to 180
const normalizeLng = (lng) => {
  return ((((lng + 180) % 360) + 360) % 360) - 180;
};

const unwrapLngNearRef = (lng, refLng) => {
  let out = lng;
  let delta = out - refLng;
  while (delta > 180) {
    out -= 360;
    delta = out - refLng;
  }
  while (delta < -180) {
    out += 360;
    delta = out - refLng;
  }
  return out;
};

/**
 * Compute fetch bounds from the same local metric projection used by resampling.
 * This avoids meters/degree approximation drift, especially at higher latitudes.
 */
const computeMetricFetchBounds = (normalizedCenter, width, height, padMeters = 4) => {
  const toWGS84 = createLocalToWGS84(normalizedCenter.lat, normalizedCenter.lng);
  const halfWidth = width / 2 + padMeters;
  const halfHeight = height / 2 + padMeters;

  const corners = [
    toWGS84.forward([-halfWidth, halfHeight]),
    toWGS84.forward([halfWidth, halfHeight]),
    toWGS84.forward([-halfWidth, -halfHeight]),
    toWGS84.forward([halfWidth, -halfHeight]),
  ];

  const lats = corners.map(([, lat]) => lat);
  const unwrappedLngs = corners.map(([lng]) => unwrapLngNearRef(lng, normalizedCenter.lng));

  return {
    north: Math.max(...lats),
    south: Math.min(...lats),
    east: normalizeLng(Math.max(...unwrappedLngs)),
    west: normalizeLng(Math.min(...unwrappedLngs)),
  };
};

/**
 * Determine the scale factor needed to convert raw elevation values to metres.
 * An explicit override (e.g. from the BYOD UI) takes precedence over any unit
 * detected in the file's metadata. Falls back to 1.0 (metres assumed) when
 * neither source yields a usable unit.
 *
 * @param {object} meta     - Parsed file metadata (tifLoader / lazLoader result)
 * @param {string} override - 'auto' | 'meters' | 'feet' | 'us_survey_feet'
 * @returns {{ scale: number, source: 'override'|'metadata'|'default' }}
 */
const resolveElevationUnitScale = (meta, override = 'auto') => {
  const selected = (override || 'auto').toLowerCase();
  if (selected === 'meters') return { scale: 1, source: 'override' };
  if (selected === 'feet') return { scale: FEET_TO_METERS, source: 'override' };
  if (selected === 'us_survey_feet') return { scale: US_SURVEY_FEET_TO_METERS, source: 'override' };

  const detected = String(meta?.verticalUnitDetected || 'unknown').toLowerCase();
  if (detected === 'meters') return { scale: 1, source: 'metadata' };
  if (detected === 'feet') return { scale: FEET_TO_METERS, source: 'metadata' };
  if (detected === 'us_survey_feet') return { scale: US_SURVEY_FEET_TO_METERS, source: 'metadata' };
  return { scale: 1, source: 'default' };
};

/**
 * Scale every valid elevation sample in a Float32Array from its source unit to
 * metres. Modifies the array in-place. NO_DATA_VALUE (-99999) and non-finite
 * values are left untouched so they propagate correctly through hole-filling.
 *
 * @param {Float32Array} heightMap
 * @param {number} scale - multiply factor from resolveElevationUnitScale()
 */
const convertHeightMapToMeters = (heightMap, scale) => {
  if (!heightMap || !Number.isFinite(scale) || Math.abs(scale - 1) < 1e-9) return;
  for (let i = 0; i < heightMap.length; i++) {
    const v = heightMap[i];
    if (Number.isFinite(v) && v !== NO_DATA_VALUE) {
      heightMap[i] = v * scale;
    }
  }
};

const decodeTerrariumHeight = (r, g, b) => {
  const h = r * 256 + g + b / 256 - 32768;
  // Tolerance, not an exact sentinel match: AWS resamples the Terrarium tiles
  // server-side, so coastline pixels arrive already blended between land values
  // and -32768 (see components/map/ElevationOverlay.vue for the full rationale).
  return h <= -32760 ? NO_DATA_VALUE : h;
};

/**
 * Repair Terrarium tiles that arrived as solid no-data.
 *
 * AWS's global tile pyramid has holes at high zoom: around the prime meridian
 * off Altea (ES) every z14 and z15 tile in columns x 16382–16385 is a 270-byte
 * black PNG that decodes to −32768, while the same ground has real samples from
 * z13 down. Nothing downstream can tell that apart from genuine sea-floor
 * no-data, so the band ends up flattened to the tile baseline and reads as a
 * chunk of terrain (or backdrop) cut away.
 *
 * Called once on an assembled mosaic canvas: each fully-blank tile is redrawn
 * from the nearest ancestor tile that carries data, nearest-neighbour so the
 * RGB height encoding survives the upscale.
 *
 * @returns {Promise<{repaired: number, blank: number}>}
 */
export const repairTerrariumNoDataTiles = async ({
  ctx,
  zoom,
  minTileX,
  minTileY,
  tileCountX,
  tileCountY,
  signal,
  onProgress,
  maxZoomOut = 6,
  concurrency = 8,
}) => {
  if (!ctx || tileCountX < 1 || tileCountY < 1) return { repaired: 0, blank: 0 };

  // A tile is blank when no sampled pixel decodes to a real height. Sampling
  // every 8th pixel still catches a single valid pixel in any 8×8 block, and
  // placeholder tiles are uniformly black anyway. Read one tile-row at a time:
  // canvas readbacks are the expensive part, and a full-mosaic one would double
  // peak memory right before the caller reads the whole canvas itself.
  const rowWidth = tileCountX * TILE_SIZE;
  const blanks = [];
  for (let ty = 0; ty < tileCountY; ty++) {
    const { data } = ctx.getImageData(0, ty * TILE_SIZE, rowWidth, TILE_SIZE);
    for (let tx = 0; tx < tileCountX; tx++) {
      const originX = tx * TILE_SIZE;
      let blank = true;
      for (let y = 0; y < TILE_SIZE && blank; y += 8) {
        for (let x = 0; x < TILE_SIZE; x += 8) {
          const i = (y * rowWidth + originX + x) * 4;
          if (decodeTerrariumHeight(data[i], data[i + 1], data[i + 2]) !== NO_DATA_VALUE) { blank = false; break; }
        }
      }
      if (blank) blanks.push({ tx: minTileX + tx, ty: minTileY + ty, drawX: originX, drawY: ty * TILE_SIZE });
    }
  }
  if (blanks.length === 0) return { repaired: 0, blank: 0 };

  onProgress?.(`Refilling ${blanks.length} empty elevation tile(s) from lower zoom...`);

  // Ancestors are shared by neighbouring blanks — fetch each one once.
  const ancestorCache = new Map();
  const loadAncestor = (z, x, y) => {
    const key = `${z}/${x}/${y}`;
    if (!ancestorCache.has(key)) {
      const numTiles = 2 ** z;
      const wrappedX = ((x % numTiles) + numTiles) % numTiles;
      ancestorCache.set(key, loadImage(`${TILE_API_URL}/${z}/${wrappedX}/${y}.png`, signal).catch(() => null));
    }
    return ancestorCache.get(key);
  };

  // Scratch canvas to test an ancestor's sub-rect before committing it.
  const probe = document.createElement('canvas');
  probe.width = TILE_SIZE;
  probe.height = TILE_SIZE;
  const probeCtx = probe.getContext('2d', { willReadFrequently: true });

  const previousSmoothing = ctx.imageSmoothingEnabled;
  ctx.imageSmoothingEnabled = false;   // averaging Terrarium RGB invents heights
  if (probeCtx) probeCtx.imageSmoothingEnabled = false;

  let repaired = 0;
  await pMap(blanks, async ({ tx, ty, drawX, drawY }) => {
    for (let step = 1; step <= maxZoomOut && zoom - step >= 0; step++) {
      signal?.throwIfAborted();
      const img = await loadAncestor(zoom - step, tx >> step, ty >> step);
      if (!img) continue;

      // The slice of the ancestor covering this tile, blown back up to full size.
      const span = TILE_SIZE >> step;
      if (span < 1) break;
      const srcX = (tx & ((1 << step) - 1)) * span;
      const srcY = (ty & ((1 << step) - 1)) * span;

      if (probeCtx) {
        probeCtx.clearRect(0, 0, TILE_SIZE, TILE_SIZE);
        probeCtx.drawImage(img, srcX, srcY, span, span, 0, 0, TILE_SIZE, TILE_SIZE);
        const { data } = probeCtx.getImageData(0, 0, TILE_SIZE, TILE_SIZE);
        let hasData = false;
        for (let i = 0; i < data.length && !hasData; i += 4 * 8) {
          if (decodeTerrariumHeight(data[i], data[i + 1], data[i + 2]) !== NO_DATA_VALUE) hasData = true;
        }
        if (!hasData) continue;
      }

      ctx.drawImage(img, srcX, srcY, span, span, drawX, drawY, TILE_SIZE, TILE_SIZE);
      repaired++;
      return;
    }
  }, concurrency, signal);

  ctx.imageSmoothingEnabled = previousSmoothing;
  probe.width = 0;
  probe.height = 0;

  console.info(`[Terrarium] Repaired ${repaired}/${blanks.length} empty z${zoom} elevation tile(s) from lower-zoom data.`);
  return { repaired, blank: blanks.length };
};

const getSatelliteZoomForProcessingMpp = (processingMetersPerPixel = 1) => {
  const mpp = Number(processingMetersPerPixel);
  const normalizedMpp = Number.isFinite(mpp) && mpp > 0 ? mpp : 1;
  const reduction = normalizedMpp > 1 ? Math.floor(normalizedMpp / 4) : 0;
  return Math.max(MIN_SATELLITE_ZOOM, SATELLITE_ZOOM - reduction);
};

// Downstream consumers cap satellite-derived textures at 8192px (see
// SAT_SOURCE_MAX_SIZE in resamplerClient.js and the OSM/hybrid texture
// generators), so mosaic imagery finer than that cap can resolve is pure
// overhead. Keep this in sync with resamplerClient.js.
const SAT_TEXTURE_MAX_SIZE = 8192;

/**
 * Reduce `requestedZoom` until the satellite mosaic carries no more ground
 * resolution than the downstream texture cap can express. Each zoom step
 * quarters mosaic memory and tile downloads: a 0.84 m/px 16k export only ever
 * shows ~1.68 m/px of imagery (8192px over ~13.8 km), so z16 (~1.45 m/px at
 * 52°N) replaces z17's 75×75-tile / ~1.4 GB mosaic with 38×38 tiles at
 * ~370 MB — identical output quality. Never raises the zoom.
 */
const clampSatelliteZoomForOutput = (fetchBounds, requestedZoom, outputPx) => {
  const outPx = Math.min(Number(outputPx) || SAT_TEXTURE_MAX_SIZE, SAT_TEXTURE_MAX_SIZE);
  const latRad = ((fetchBounds.north + fetchBounds.south) / 2) * Math.PI / 180;
  const widthMeters = Math.abs(fetchBounds.east - fetchBounds.west) * 111320 * Math.cos(latRad);
  if (!(widthMeters > 0) || !(outPx > 0)) return requestedZoom;
  const neededMpp = widthMeters / outPx;
  // Web-mercator ground resolution at zoom z: 156543.03392 · cos(lat) / 2^z.
  let z = requestedZoom;
  while (z > MIN_SATELLITE_ZOOM && (156543.03392 * Math.cos(latRad)) / 2 ** (z - 1) <= neededMpp) {
    z--;
  }
  if (z !== requestedZoom) {
    console.log(`[Sat Mosaic] zoom clamped ${requestedZoom} → ${z} (a ${outPx}px texture over ${Math.round(widthMeters)} m needs only ${neededMpp.toFixed(2)} m/px)`);
  }
  return z;
};

/**
 * Fetch a satellite tile mosaic for `fetchBounds` into a CPU-side RGBA buffer.
 *
 * Chromium cannot reliably back a mosaic-sized canvas at fine processing
 * resolutions (e.g. 0.84 m/px over ~14 km → 75×75 z17 tiles = 19200² px):
 * past ~2^28 total pixels — or earlier under GPU memory pressure — drawImage
 * silently no-ops and getImageData returns transparent black, which turned
 * BYOD satellite/hybrid textures black at 16k. Stitching each tile through a
 * single 256×256 scratch canvas into a plain Uint8ClampedArray avoids canvas
 * size limits entirely (fetchTerrainData already works this way).
 *
 * Returns { satDataImg: {data,width,height}, satMinTileX, satMinTileY, tileCount }.
 */
const fetchSatelliteMosaic = async (
  fetchBounds,
  satelliteZoom,
  signal,
  onTileProgress = null,
  globalTileConcurrency = 20,
) => {
  const satNw = project(fetchBounds.north, fetchBounds.west, satelliteZoom);
  const satSe = project(fetchBounds.south, fetchBounds.east, satelliteZoom);
  const satMinTileX = Math.floor(satNw.x / TILE_SIZE);
  const satMinTileY = Math.floor(satNw.y / TILE_SIZE);
  const satMaxTileX = Math.floor(satSe.x / TILE_SIZE);
  const satMaxTileY = Math.floor(satSe.y / TILE_SIZE);
  const satCanvasWidth = (satMaxTileX - satMinTileX + 1) * TILE_SIZE;
  const satCanvasHeight = (satMaxTileY - satMinTileY + 1) * TILE_SIZE;

  const satBuffer = new Uint8ClampedArray(satCanvasWidth * satCanvasHeight * 4);
  // Default to opaque black so any gap (missed tile) reads as opaque rather
  // than transparent (little-endian RGBA: 0,0,0,255).
  new Uint32Array(satBuffer.buffer).fill(0xFF000000);

  // Reuse a single 256×256 scratch canvas to extract each tile's pixels.
  // JS is single-threaded so concurrent pMap callbacks never actually overlap;
  // clearing+drawing+reading is always atomic within one event-loop turn.
  const tempSatCanvas = document.createElement('canvas');
  tempSatCanvas.width = TILE_SIZE;
  tempSatCanvas.height = TILE_SIZE;
  const tempSatCtx = tempSatCanvas.getContext('2d', { willReadFrequently: true });
  if (!tempSatCtx) throw new Error('Failed to create satellite scratch canvas context');

  const satRequests = [];
  for (let tx = satMinTileX; tx <= satMaxTileX; tx++)
    for (let ty = satMinTileY; ty <= satMaxTileY; ty++)
      satRequests.push({ tx, ty });

  let completed = 0;
  await pMap(satRequests, async ({ tx, ty }) => {
    completed++;
    if (completed % 10 === 0 || completed === satRequests.length) {
      onTileProgress?.(completed, satRequests.length);
    }
    const numTiles = 2 ** satelliteZoom;
    const wrappedTx = ((tx % numTiles) + numTiles) % numTiles;
    const sImg = await loadImage(`${SATELLITE_API_URL}/${satelliteZoom}/${ty}/${wrappedTx}`, signal);
    const drawX = (tx - satMinTileX) * TILE_SIZE;
    const drawY = (ty - satMinTileY) * TILE_SIZE;
    if (sImg) {
      tempSatCtx.clearRect(0, 0, TILE_SIZE, TILE_SIZE);
      tempSatCtx.drawImage(sImg, 0, 0);
      const tilePixels = tempSatCtx.getImageData(0, 0, TILE_SIZE, TILE_SIZE).data;
      for (let row = 0; row < TILE_SIZE; row++) {
        const srcOff = row * TILE_SIZE * 4;
        const dstOff = ((drawY + row) * satCanvasWidth + drawX) * 4;
        satBuffer.set(tilePixels.subarray(srcOff, srcOff + TILE_SIZE * 4), dstOff);
      }
    } else {
      // Dark gray placeholder for failed tiles (alpha already 255).
      for (let row = 0; row < TILE_SIZE; row++) {
        const dstOff = ((drawY + row) * satCanvasWidth + drawX) * 4;
        for (let col = 0; col < TILE_SIZE; col++) {
          satBuffer[dstOff + col * 4] = 0x1a;
          satBuffer[dstOff + col * 4 + 1] = 0x1a;
          satBuffer[dstOff + col * 4 + 2] = 0x1a;
        }
      }
    }
  }, Math.max(1, Number(globalTileConcurrency || 20)), signal);

  const cIdx = ((satCanvasHeight >> 1) * satCanvasWidth + (satCanvasWidth >> 1)) * 4;
  console.log(`[Sat Mosaic] ${satCanvasWidth}x${satCanvasHeight} (${satRequests.length} tiles, z${satelliteZoom}) center: r=${satBuffer[cIdx]} g=${satBuffer[cIdx + 1]} b=${satBuffer[cIdx + 2]} a=${satBuffer[cIdx + 3]}`);

  return {
    satDataImg: { data: satBuffer, width: satCanvasWidth, height: satCanvasHeight },
    satMinTileX,
    satMinTileY,
    tileCount: satRequests.length,
  };
};

/**
 * Download the global Terrarium elevation tiles covering `bounds` and return
 * the stitched mosaic in the serializable form the resampler worker consumes
 * (`{ pixels, width, height, zoom, minTileX, minTileY }`).
 *
 * Shared by the plain sampler below and by the BYOD gap-fill path, which needs
 * the raw pixels rather than a closure so they can cross into the worker.
 */
export const fetchTerrariumMosaic = async (
  bounds,
  signal,
  onProgress,
  globalTileConcurrency = 20,
) => {
  const nw = project(bounds.north, bounds.west, TERRAIN_ZOOM);
  const se = project(bounds.south, bounds.east, TERRAIN_ZOOM);

  const minTileX = Math.floor(nw.x / TILE_SIZE);
  const minTileY = Math.floor(nw.y / TILE_SIZE);
  const maxTileX = Math.floor(se.x / TILE_SIZE);
  const maxTileY = Math.floor(se.y / TILE_SIZE);

  const tileCountX = maxTileX - minTileX + 1;
  const tileCountY = maxTileY - minTileY + 1;
  const canvasWidth = tileCountX * TILE_SIZE;
  const canvasHeight = tileCountY * TILE_SIZE;

  const terrainCanvas = document.createElement('canvas');
  terrainCanvas.width = canvasWidth;
  terrainCanvas.height = canvasHeight;
  const tCtx = terrainCanvas.getContext('2d', { willReadFrequently: true });
  if (!tCtx) throw new Error('Failed to create terrarium canvas context');

  const requests = [];
  for (let tx = minTileX; tx <= maxTileX; tx++) {
    for (let ty = minTileY; ty <= maxTileY; ty++) {
      requests.push({ tx, ty });
    }
  }

  let completed = 0;
  await pMap(
    requests,
    async ({ tx, ty }) => {
      completed++;
      if (completed % 10 === 0 || completed === requests.length) {
        onProgress?.(`Downloading fallback terrain tiles... ${completed}/${requests.length}`);
      }

      const drawX = (tx - minTileX) * TILE_SIZE;
      const drawY = (ty - minTileY) * TILE_SIZE;
      const numTiles = Math.pow(2, TERRAIN_ZOOM);
      const wrappedTx = ((tx % numTiles) + numTiles) % numTiles;
      const terrainUrl = `${TILE_API_URL}/${TERRAIN_ZOOM}/${wrappedTx}/${ty}.png`;

      const img = await loadImage(terrainUrl, signal);
      if (img) {
        tCtx.drawImage(img, drawX, drawY);
      } else {
        // Keep a nodata value in failed cells instead of arbitrary flat fill.
        tCtx.fillStyle = 'rgb(0,0,0)';
        tCtx.fillRect(drawX, drawY, TILE_SIZE, TILE_SIZE);
      }
    },
    Math.max(1, Number(globalTileConcurrency || 20)),
    signal,
  );

  await repairTerrariumNoDataTiles({
    ctx: tCtx,
    zoom: TERRAIN_ZOOM,
    minTileX,
    minTileY,
    tileCountX,
    tileCountY,
    signal,
    onProgress,
  });

  const terrainDataImg = tCtx.getImageData(0, 0, canvasWidth, canvasHeight);
  terrainCanvas.width = 0;
  terrainCanvas.height = 0;

  return {
    pixels: terrainDataImg.data,
    width: terrainDataImg.width,
    height: terrainDataImg.height,
    zoom: TERRAIN_ZOOM,
    minTileX,
    minTileY,
    tileCount: requests.length,
  };
};

const createTerrariumHeightSampler = async (
  bounds,
  signal,
  onProgress,
  globalTileConcurrency = 20,
) => {
  const mosaic = await fetchTerrariumMosaic(bounds, signal, onProgress, globalTileConcurrency);

  return (lat, lng) => {
    const p = project(lat, lng, TERRAIN_ZOOM);
    const localX = p.x - mosaic.minTileX * TILE_SIZE;
    const localY = p.y - mosaic.minTileY * TILE_SIZE;

    const x = Math.floor(localX);
    const y = Math.floor(localY);
    if (x < 0 || x >= mosaic.width || y < 0 || y >= mosaic.height) {
      return NO_DATA_VALUE;
    }

    const i = (y * mosaic.width + x) * 4;
    return decodeTerrariumHeight(
      mosaic.pixels[i],
      mosaic.pixels[i + 1],
      mosaic.pixels[i + 2],
    );
  };
};

const fillLazNoDataWithGlobalTerrain = async (
  heightMap,
  width,
  height,
  bounds,
  signal,
  onProgress,
  globalTileConcurrency = 20,
) => {
  const missingIndices = [];
  for (let i = 0; i < heightMap.length; i++) {
    if (heightMap[i] === NO_DATA_VALUE || !Number.isFinite(heightMap[i])) {
      missingIndices.push(i);
    }
  }
  if (missingIndices.length === 0) return;

  onProgress?.('Filling LAZ edge gaps with global DEM...');
  const sampleHeight = await createTerrariumHeightSampler(bounds, signal, onProgress, globalTileConcurrency);

  const filledMask = new Uint8Array(heightMap.length);
  const latSpan = bounds.north - bounds.south;
  const lngSpan = bounds.east - bounds.west;

  const cellLatLng = (idx) => {
    const row = Math.floor(idx / width);
    const col = idx - row * width;
    const u = width > 1 ? (col / (width - 1)) : 0;
    const v = height > 1 ? (row / (height - 1)) : 0;
    return { lat: bounds.north - v * latSpan, lng: bounds.west + u * lngSpan };
  };

  // The high-res LAZ surface and the coarse global DEM usually sit on different
  // vertical datums (e.g. NAVD88 vs EGM96), so naively pasting global heights
  // leaves a visible step at the footprint edge. Estimate the median offset
  // between the two at the boundary (LAZ cells adjacent to a gap) and shift the
  // global fill by it so the surfaces line up.
  let datumOffset = 0;
  const offsetSamples = [];
  for (let i = 0; i < heightMap.length; i++) {
    const h = heightMap[i];
    if (h === NO_DATA_VALUE || !Number.isFinite(h)) continue;
    const row = Math.floor(i / width);
    const col = i - row * width;
    const neighborIsGap = (
      (col > 0 && heightMap[i - 1] === NO_DATA_VALUE)
      || (col < width - 1 && heightMap[i + 1] === NO_DATA_VALUE)
      || (row > 0 && heightMap[i - width] === NO_DATA_VALUE)
      || (row < height - 1 && heightMap[i + width] === NO_DATA_VALUE)
    );
    if (!neighborIsGap) continue;
    const { lat, lng } = cellLatLng(i);
    const g = sampleHeight(lat, lng);
    if (g !== NO_DATA_VALUE && Number.isFinite(g)) offsetSamples.push(h - g);
  }
  if (offsetSamples.length > 0) {
    offsetSamples.sort((a, b) => a - b);
    datumOffset = offsetSamples[Math.floor(offsetSamples.length / 2)];
  }

  for (let m = 0; m < missingIndices.length; m++) {
    const idx = missingIndices[m];
    const { lat, lng } = cellLatLng(idx);
    const sampled = sampleHeight(lat, lng);

    if (sampled !== NO_DATA_VALUE && Number.isFinite(sampled)) {
      heightMap[idx] = sampled + datumOffset;
      filledMask[idx] = 1;
    }
  }

  // Gentle seam blending on newly filled cells only.
  const scratch = new Float32Array(heightMap.length);
  for (let pass = 0; pass < 2; pass++) {
    scratch.set(heightMap);
    for (let y = 1; y < height - 1; y++) {
      for (let x = 1; x < width - 1; x++) {
        const idx = y * width + x;
        if (!filledMask[idx]) continue;

        let sum = 0;
        let cnt = 0;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            if (dx === 0 && dy === 0) continue;
            const v = scratch[(y + dy) * width + (x + dx)];
            if (v !== NO_DATA_VALUE && Number.isFinite(v)) {
              sum += v;
              cnt++;
            }
          }
        }
        if (cnt > 0) {
          heightMap[idx] = scratch[idx] * 0.6 + (sum / cnt) * 0.4;
        }
      }
    }
  }
};

// Math Helpers for Web Mercator Projection (Source of Truth for Fetching)
const MAX_LATITUDE = 85.05112878;

export const project = (lat, lng, zoom) => {
  const d = Math.PI / 180;
  const max = MAX_LATITUDE;
  const latClamped = Math.max(Math.min(max, lat), -max);
  const sin = Math.sin(latClamped * d);

  const z = TILE_SIZE * Math.pow(2, zoom);

  const x = (z * (lng + 180)) / 360;
  const y = z * (0.5 - (0.25 * Math.log((1 + sin) / (1 - sin))) / Math.PI);

  return { x, y };
};

// ─── GPXZ Rate Limit Discovery & State ─────────────────────────────
// Cached state about the user's GPXZ plan limits
let gpxzRateLimitInfo = null;

// Global request pacer shared across ALL concurrent GPXZ fetches.
//
// Per-tile pacing alone is not enough: batch mode runs several tiles'
// fetchGPXZRaw() calls at once, so without a shared gate the aggregate request
// rate is (fetchConcurrency × per-tile chunks) — far over the plan's rps and a
// guaranteed source of 429s. This gate spaces request *starts* globally so the
// combined rate across every tile stays under the plan limit. The reserve-then-
// await pattern is safe: the read and write of gpxzNextSlotAt happen in the same
// synchronous block before any yield, so two callers cannot interleave.
let gpxzNextSlotAt = 0;

/**
 * Wait for the next globally-paced GPXZ request slot. Spacing is derived from
 * the probed plan rps with a small safety margin; falls back to 1 rps until the
 * plan is known.
 */
const acquireGpxzSlot = async (signal) => {
  const plan = gpxzRateLimitInfo;
  const rps = Math.max(1, Number(plan?.rps) || 1);
  // 10% headroom under the advertised rps absorbs timing jitter and the
  // server's own window accounting, which otherwise still trips occasional 429s.
  const minIntervalMs = Math.ceil(1000 / (rps * 0.9));
  const now = performance.now();
  const startAt = Math.max(now, gpxzNextSlotAt);
  gpxzNextSlotAt = startAt + minIntervalMs;
  const wait = startAt - now;
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  signal?.throwIfAborted();
};

/**
 * Probe the GPXZ API to discover the user's plan limits.
 * Makes a lightweight /v1/elevation/point request and reads rate-limit headers.
 * Returns { used, limit, remaining, resetSec, rps, concurrency, plan }
 */
export async function probeGPXZLimits(apiKey, signal) {
  try {
    const resp = await fetch(
      '/api/gpxz/v1/elevation/point?lat=0&lon=0',
      { headers: { 'x-api-key': apiKey }, signal }
    );

    const used = parseInt(resp.headers.get('x-ratelimit-used') || '0', 10);
    const limit = parseInt(resp.headers.get('x-ratelimit-limit') || '100', 10);
    const remainingHeader = resp.headers.get('x-ratelimit-remaining');
    const remaining = remainingHeader !== null ? parseInt(remainingHeader, 10) : Math.max(0, limit - used);
    const resetSec = parseInt(resp.headers.get('x-ratelimit-reset') || '0', 10);

    // Determine plan tier and concurrency from daily limit
    // Free: 100/day, 1 rps → concurrency 1
    // Small: 2,500/day, 10 rps → concurrency 8
    // Large: 7,500/day, 25 rps → concurrency 20
    // Advanced: >7,500/day → concurrency 20
    let plan, rps, concurrency;
    if (limit <= 100) {
      plan = 'free';
      rps = 1;
      concurrency = 1;
    } else if (limit <= 2500) {
      plan = 'small';
      rps = 10;
      concurrency = 8;
    } else {
      plan = 'large';
      rps = 25;
      concurrency = 20;
    }

    const info = { used, limit, remaining, resetSec, rps, concurrency, plan, valid: resp.ok };
    gpxzRateLimitInfo = info;
    console.log(`[GPXZ] Plan: ${plan} | Limit: ${limit}/day | Used: ${used} | Remaining: ${remaining} | Concurrency: ${concurrency}`);
    return info;
  } catch (e) {
    console.warn('[GPXZ] Failed to probe rate limits:', e);
    // Fallback to free-tier assumptions
    const fallback = { used: 0, limit: 100, remaining: 100, resetSec: 0, rps: 1, concurrency: 1, plan: 'free', valid: false };
    gpxzRateLimitInfo = fallback;
    return fallback;
  }
}

/**
 * Update cached rate limit info from response headers (called after each request).
 */
function updateRateLimitFromHeaders(response) {
  if (!gpxzRateLimitInfo) return;
  const used = response.headers.get('x-ratelimit-used');
  const remaining = response.headers.get('x-ratelimit-remaining');
  if (used) gpxzRateLimitInfo.used = parseInt(used, 10);
  if (remaining !== null) {
    gpxzRateLimitInfo.remaining = parseInt(remaining, 10);
  } else if (used) {
    gpxzRateLimitInfo.remaining = Math.max(0, gpxzRateLimitInfo.limit - gpxzRateLimitInfo.used);
  }
}

/** Get the last known GPXZ rate limit info */
export function getGPXZRateLimitInfo() {
  return gpxzRateLimitInfo;
}

const NO_DATA_VALUE = -99999;

/**
 * Parse any supported BYOD elevation upload format into a metadata object
 * consumable by the terrain generation pipeline.
 *
 * Supported extensions:
 * - Point cloud: .laz, .las
 * - Raster/text: .tif, .tiff, .asc, .gml, .xml, .zip
 */
export const parseElevationFile = async (fileOrFiles) => {
  const files = Array.isArray(fileOrFiles)
    ? fileOrFiles
    : (fileOrFiles ? [fileOrFiles] : []);

  if (files.length === 0) {
    throw new Error('No elevation files selected.');
  }

  const extOf = (file) => String(file?.name || '').toLowerCase().split('.').pop();

  if (files.length > 1) {
    // Group by extension family. Each family has its own tile-merge path.
    const families = {
      asc: (f) => f === 'asc',
      tif: (f) => f === 'tif' || f === 'tiff',
      gml: (f) => f === 'gml' || f === 'xml',
      laz: (f) => f === 'laz' || f === 'las',
    };
    const family = Object.entries(families).find(([, test]) => files.every((file) => test(extOf(file))));
    if (!family) {
      throw new Error('Multiple-file upload requires all files to be the same type (all TIF, all ASC, all GML/XML, or all LAZ/LAS). For mixed formats, upload a ZIP archive instead.');
    }
    switch (family[0]) {
      case 'asc': return parseAscFiles(files);
      case 'tif': return parseTifFiles(files);
      case 'gml': return parseGridFiles(files);
      case 'laz': return parseLazFiles(files);
    }
  }

  const file = files[0];
  const ext = extOf(file);
  if (ext === 'laz' || ext === 'las') {
    return parseLazFile(file);
  }
  return parseRasterOrGridElevationFile(file);
};

/**
 * Acquire the secondary elevation source used to fill gaps in an upload.
 *
 * Uploaded LiDAR rarely covers the whole export area: survey polygons are
 * irregular, and the no-data fill outside them leaves holes (see
 * nodataDetect.js). Rather than synthesising terrain for those gaps, we drop in
 * a real dataset and let the worker blend the seam.
 *
 * Returns the two payload shapes the worker understands:
 *  - `fallbackData` — the global Terrarium mosaic
 *  - `gapFillData`  — geo-referenced rasters (GPXZ hires chunks)
 * GPXZ falls back to the global tiles if the request yields nothing, so a
 * missing key or a failed fetch degrades instead of leaving holes.
 */
const fetchGapFillSource = async ({
  gapFillSource,
  bounds,
  gpxzApiKey,
  signal,
  emitProgress,
  globalTileConcurrency = 20,
}) => {
  const empty = { fallbackData: null, gapFillData: null };
  const mode = String(gapFillSource || GAP_FILL_STANDARD).toLowerCase();
  if (mode === GAP_FILL_NONE) return empty;

  const fetchStandard = async () => {
    emitProgress?.({ status: 'Downloading fallback elevation tiles for gaps...', percent: null });
    try {
      const mosaic = await fetchTerrariumMosaic(
        bounds,
        signal,
        (message) => emitProgress?.({ status: message, percent: null }),
        globalTileConcurrency,
      );
      console.info(`[BYOD] Gap fill: global elevation mosaic ready (${mosaic.tileCount} tiles).`);
      return { fallbackData: mosaic, gapFillData: null };
    } catch (error) {
      if (signal?.aborted) throw error;
      console.warn('[BYOD] Gap fill: global elevation tiles unavailable, leaving gaps to the inpainter:', error);
      return empty;
    }
  };

  if (mode === GAP_FILL_GPXZ) {
    if (!gpxzApiKey) {
      console.warn('[BYOD] Gap fill: GPXZ selected without an API key — using global elevation tiles instead.');
      return fetchStandard();
    }
    emitProgress?.({ status: 'Fetching GPXZ elevation for gaps...', percent: null });
    try {
      const gpxzResult = await fetchGPXZRaw(
        bounds,
        gpxzApiKey,
        (message) => emitProgress?.({ status: message, percent: null }),
        signal,
      );
      if (gpxzResult?.data?.length) {
        console.info(`[BYOD] Gap fill: GPXZ returned ${gpxzResult.data.length} raster chunk(s).`);
        return { fallbackData: null, gapFillData: gpxzResult.data };
      }
      console.warn('[BYOD] Gap fill: GPXZ returned no data — using global elevation tiles instead.');
    } catch (error) {
      if (signal?.aborted) throw error;
      console.warn('[BYOD] Gap fill: GPXZ request failed — using global elevation tiles instead:', error);
    }
    return fetchStandard();
  }

  return fetchStandard();
};

/**
 * Fetch high-resolution elevation data from the GPXZ hires-raster API.
 *
 * Flow:
 *  1. Probe the user's plan limits (once per session) to set concurrency + per-worker delay.
 *  2. Sample five representative points to decide whether to smooth the output
 *     (coarse-resolution data is common outside urban areas).
 *  3. Chunk the bounding box into ≤9 km² pieces (the API limit is 10 km²) with
 *     ~220 m overlaps so tile seams don't leave gaps after merging.
 *  4. Fetch chunks concurrently at plan-appropriate parallelism with retry logic
 *     for 429 rate-limit responses and mid-stream network failures.
 *
 * @returns {{ data, smooth, rawArrayBuffers, hadChunkFailures } | null}
 */
const fetchGPXZRaw = async (bounds, apiKey, onProgress, signal) => {
  try {
    signal?.throwIfAborted();
    // 1. Probe rate limits if not already known
    if (!gpxzRateLimitInfo) {
      onProgress?.('Checking GPXZ account limits...');
      await probeGPXZLimits(apiKey, signal);
    }

    const rateInfo = gpxzRateLimitInfo;
    // pMap parallelism per tile; the global acquireGpxzSlot() gate (not this
    // number) is what actually bounds the aggregate request rate across tiles.
    const concurrency = rateInfo?.concurrency || 1;

    // 2. Check resolution profile via Points API.
    // Sample center + near-corners so smoothing reflects mixed-coverage areas.
    const centerLat = (bounds.north + bounds.south) / 2;
    const centerLng = (bounds.east + bounds.west) / 2;
    const latInset = (bounds.north - bounds.south) * 0.2;
    const lngInset = (bounds.east - bounds.west) * 0.2;
    const sampledLatLons = [
      [centerLat, centerLng],
      [bounds.north - latInset, bounds.west + lngInset],
      [bounds.north - latInset, bounds.east - lngInset],
      [bounds.south + latInset, bounds.west + lngInset],
      [bounds.south + latInset, bounds.east - lngInset],
    ];

    let shouldSmooth = false;
    try {
      // Pace the points check through the same global gate as raster requests.
      await acquireGpxzSlot(signal);
      const latlons = sampledLatLons.map(([lat, lng]) => `${lat},${lng}`).join('|');
      const pointsUrl = `/api/gpxz/v1/elevation/points?latlons=${encodeURIComponent(latlons)}`;
      const pointsResp = await fetch(pointsUrl, {
        headers: { "x-api-key": apiKey },
        signal,
      });
      if (pointsResp.ok) {
        const pointsData = await pointsResp.json();
        if (pointsData.results && pointsData.results.length > 0) {
          const resolutions = pointsData.results
            .map((r) => Number(r?.resolution))
            .filter((r) => Number.isFinite(r));

          if (resolutions.length > 0) {
            const coarseCount = resolutions.filter((r) => r > 2).length;
            const sorted = [...resolutions].sort((a, b) => a - b);
            const median = sorted[Math.floor(sorted.length / 2)];
            const minRes = sorted[0];
            const maxRes = sorted[sorted.length - 1];

            // Smooth only when coarse data dominates; avoids over-smoothing mixed high-res areas.
            shouldSmooth = coarseCount >= Math.ceil(resolutions.length / 2) && median > 2;

            console.log(
              `[GPXZ] Sampled resolution profile: min=${minRes}m median=${median}m max=${maxRes}m; coarse=${coarseCount}/${resolutions.length}; smooth=${shouldSmooth}`,
            );
          }
        }
      }
    } catch (e) {
      console.warn("[GPXZ] Failed to check resolution:", e);
    }

    // 2. Calculate Area & Tiles
    // Calculate Area in km²
    const latDist = (bounds.north - bounds.south) * 111.32;
    const avgLatRad = (((bounds.north + bounds.south) / 2) * Math.PI) / 180;
    const lonDist = (bounds.east - bounds.west) * 111.32 * Math.cos(avgLatRad);
    const areaKm2 = latDist * lonDist;

    console.log(`[GPXZ] Total Requested Area: ${areaKm2.toFixed(2)} km²`);

    // GPXZ Limit is 10km². We use a safe chunk size of ~9km² (3km x 3km)
    const TARGET_CHUNK_SIDE_KM = 3;
    const BUFFER_DEG = 0.002; // ~220m overlap to prevent seams

    // Calculate grid size
    const latSpan = bounds.north - bounds.south;
    const lngSpan = bounds.east - bounds.west;

    const metersPerDegLat = 111320;
    const metersPerDegLng = 111320 * Math.cos(avgLatRad);

    const chunkLatDeg = (TARGET_CHUNK_SIDE_KM * 1000) / metersPerDegLat;
    const chunkLngDeg = (TARGET_CHUNK_SIDE_KM * 1000) / metersPerDegLng;

    const rows = Math.ceil(latSpan / chunkLatDeg);
    const cols = Math.ceil(lngSpan / chunkLngDeg);

    const requests = [];

    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const s = bounds.south + r * (latSpan / rows);
        const n = bounds.south + (r + 1) * (latSpan / rows);
        const w = bounds.west + c * (lngSpan / cols);
        const e = bounds.west + (c + 1) * (lngSpan / cols);

        // Normalize longitudes to [-180, 180]
        const normW = normalizeLng(w);
        const normE = normalizeLng(e);

        // Check for dateline crossing
        if (w < e && normW > normE) {
          // Split into two requests
          // Add buffer to internal edges too
          requests.push({
            north: n + BUFFER_DEG,
            south: s - BUFFER_DEG,
            west: normW - BUFFER_DEG,
            east: 180,
          });
          requests.push({
            north: n + BUFFER_DEG,
            south: s - BUFFER_DEG,
            west: -180,
            east: normE + BUFFER_DEG,
          });
        } else {
          requests.push({
            north: n + BUFFER_DEG,
            south: s - BUFFER_DEG,
            west: normW - BUFFER_DEG,
            east: normE + BUFFER_DEG,
          });
        }
      }
    }

    console.log(`[GPXZ] Split into ${requests.length} tiles (with overlap). Concurrency: ${concurrency}, global pace: ${Math.ceil(1000 / (Math.max(1, Number(gpxzRateLimitInfo?.rps) || 1) * 0.9))}ms/req`);
    onProgress?.(`Fetching ${requests.length} GPXZ tiles (${rateInfo?.plan || 'free'} plan, ${concurrency}x concurrent)...`);

    let completedChunks = 0;
    const results = await pMap(
      requests,
      async (reqBounds) => {
        const url = `/api/gpxz/v1/elevation/hires-raster?bbox_top=${reqBounds.north}&bbox_bottom=${reqBounds.south}&bbox_left=${reqBounds.west}&bbox_right=${reqBounds.east}&res_m=best&projection=best&tight_bounds=false`;

        // Retry logic for 429 Rate Limit AND network errors
        let result = null;
        let retries = 0;
        const MAX_RETRIES = 5;

        while (retries < MAX_RETRIES) {
          // Globally pace request starts across every concurrent tile.
          await acquireGpxzSlot(signal);
          let response = null;
          try {
            response = await fetch(url, { headers: { "x-api-key": apiKey }, signal });
          } catch (fetchErr) {
            // Network error (ERR_QUIC_PROTOCOL_ERROR, Failed to fetch, etc.)
            const waitTime = 2000 * Math.pow(2, retries);
            console.warn(
              `[GPXZ] Network error: ${fetchErr.message}. Retrying in ${waitTime}ms... (attempt ${retries + 1}/${MAX_RETRIES})`,
            );
            onProgress?.(`Network error — retrying in ${Math.ceil(waitTime / 1000)}s...`);
            await new Promise((r) => setTimeout(r, waitTime));
            retries++;
            continue;
          }

          if (response.status === 429) {
            // Use retry-after header if available, otherwise exponential backoff
            const retryAfter = response.headers.get('retry-after');
            const waitTime = retryAfter
              ? parseInt(retryAfter, 10) * 1000 + 200 // Add small buffer
              : 2000 * Math.pow(2, retries); // Exponential backoff: 2s, 4s, 8s, 16s, 32s
            console.warn(
              `[GPXZ] Rate limit hit (429). Retrying in ${waitTime}ms... (attempt ${retries + 1}/${MAX_RETRIES})`,
            );
            onProgress?.(`Rate limited — retrying in ${Math.ceil(waitTime / 1000)}s...`);
            await new Promise((r) => setTimeout(r, waitTime));
            retries++;
            continue;
          }

          if (!response.ok) {
            console.error(`[GPXZ] Tile Error: ${response.status}`);
            return null;
          }

          // Update cached rate limit info from response headers
          updateRateLimitFromHeaders(response);

          // Read the body — this can also fail mid-stream on flaky connections
          try {
            const arrayBuffer = await response.arrayBuffer();
            const tiff = await GeoTIFF.fromArrayBuffer(arrayBuffer);
            const image = await tiff.getImage();
            const rasters = await image.readRasters();
            const raster = rasters[0];
            await tiff.close();
            result = { image, raster, arrayBuffer };
            break;
          } catch (bodyErr) {
            const waitTime = 2000 * Math.pow(2, retries);
            console.warn(
              `[GPXZ] Body read error: ${bodyErr.message}. Retrying in ${waitTime}ms... (attempt ${retries + 1}/${MAX_RETRIES})`,
            );
            onProgress?.(`Download interrupted — retrying in ${Math.ceil(waitTime / 1000)}s...`);
            await new Promise((r) => setTimeout(r, waitTime));
            retries++;
            continue;
          }
        }

        if (!result) {
          console.error(`[GPXZ] Tile failed after ${MAX_RETRIES} retries`);
          return null;
        }

        completedChunks++;
        const remaining = gpxzRateLimitInfo?.remaining;
        const quotaInfo = remaining != null ? ` (${remaining} API calls remaining today)` : '';
        onProgress?.(`Fetching GPXZ tiles... ${completedChunks}/${requests.length}${quotaInfo}`);

        return result;
      },
      concurrency,
    );

    const validResults = results.filter((r) => r !== null);
    const hadChunkFailures = validResults.length < requests.length;

    if (validResults.length === 0) return null;

    const rawArrayBuffers = validResults.map((r) => r.arrayBuffer);
    if (hadChunkFailures) {
      console.warn(`[GPXZ] ${requests.length - validResults.length}/${requests.length} chunks failed. Terrarium fallback will be enabled for gap recovery.`);
    }
    return { data: validResults, smooth: shouldSmooth, rawArrayBuffers, hadChunkFailures };
  } catch (e) {
    console.error("Failed to fetch GPXZ terrain:", e);
    return null;
  }
};

/**
 * Fetch 1-metre DEM tiles from the USGS 3DEP National Map API.
 * Only covers CONUS, Alaska, and Hawaii — callers must check coverage first.
 *
 * Queries the USGS TNM Access product catalogue for GeoTIFF DEM tiles that
 * intersect the requested bounding box, then downloads them sequentially to
 * avoid memory exhaustion (1 m tiles are large). Retries transient network
 * failures up to MAX_RETRIES times with linear back-off.
 *
 * @returns {{ data: Array<{image, raster}>, rawArrayBuffers: ArrayBuffer[] } | null}
 */
const fetchUSGSRaw = async (bounds, onProgress, signal) => {
  const MAX_RETRIES = 3;
  const RETRY_DELAY = 1000;

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  try {
    signal?.throwIfAborted();
    // 1. Query USGS API
    // Round coordinates to 6 decimal places to improve cache hit rate and reduce query string length
    const bbox = `${bounds.west.toFixed(6)},${bounds.south.toFixed(6)},${bounds.east.toFixed(6)},${bounds.north.toFixed(6)}`;
    // Limit to 4 tiles to cover corners/overlaps without overloading memory
    const url = `${USGS_PRODUCT_API}?datasets=${encodeURIComponent(USGS_DATASET)}&bbox=${bbox}&prodFormats=GeoTIFF&max=4`;

    console.log(`[USGS] Querying products: ${url}`);

    let response = null;
    let attempts = 0;

    while (attempts < MAX_RETRIES) {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 15000); // 15s timeout

        response = await fetch(url, {
          signal: signal || controller.signal,
          // Ensure no custom headers are sent to avoid preflight OPTIONS request which fails on USGS
          headers: {},
        });
        clearTimeout(timeoutId);

        if (response.ok) break;

        console.warn(
          `[USGS] API Query failed: ${response.status}. Retrying...`,
        );
      } catch (err) {
        console.warn(`[USGS] Network error: ${err}. Retrying...`);
      }

      attempts++;
      await sleep(RETRY_DELAY * attempts);
    }

    if (!response || !response.ok) {
      console.warn(`[USGS] Failed to query API after ${MAX_RETRIES} attempts.`);
      return null;
    }

    let data;
    try {
      const text = await response.text();
      data = JSON.parse(text);
    } catch (e) {
      console.warn(`[USGS] Failed to parse API response as JSON:`, e);
      return null;
    }

    if (!data.items || data.items.length === 0) {
      console.log(`[USGS] No products found for bounds.`);
      return null;
    }

    onProgress?.(`Found ${data.items.length} USGS tiles. Downloading...`);

    const results = [];
    const rawArrayBuffers = [];

    // 2. Download GeoTIFFs sequentially
    // We process sequentially to avoid memory exhaustion with large 1m tiles
    for (let i = 0; i < data.items.length; i++) {
      const item = data.items[i];
      const downloadUrl = item.downloadURL;
      onProgress?.(`Downloading USGS tile ${i + 1}/${data.items.length}...`);
      signal?.throwIfAborted();

      try {
        const tiffResponse = await fetch(downloadUrl, { signal });
        if (!tiffResponse.ok) {
          console.warn(
            `[USGS] Failed to download tile: ${tiffResponse.status}`,
          );
          continue;
        }

        const arrayBuffer = await tiffResponse.arrayBuffer();

        // 3. Parse GeoTIFF
        const tiff = await GeoTIFF.fromArrayBuffer(arrayBuffer);
        const image = await tiff.getImage();
        const rasters = await image.readRasters();
        const raster = rasters[0]; // Height data

        await tiff.close();

        results.push({ image, raster });
        rawArrayBuffers.push(arrayBuffer);
      } catch (e) {
        console.warn(`[USGS] Failed to parse tile ${downloadUrl}`, e);
      }
    }

    if (results.length === 0) {
      console.warn("[USGS] All tile downloads failed.");
      return null;
    }

    return { data: results, rawArrayBuffers };
  } catch (e) {
    console.warn("Failed to load USGS terrain:", e);
    return null;
  }
};

/**
 * Minimal concurrent map. Runs up to `concurrency` promises at once, collects
 * results in original order, and handles errors by storing null for failed items.
 * Checks the abort signal before starting each item so callers can cancel early.
 */
async function pMap(items, mapper, concurrency, signal) {
  const results = new Array(items.length);
  let index = 0;

  const next = async () => {
    while (index < items.length) {
      signal?.throwIfAborted();
      const i = index++;
      try {
        results[i] = await mapper(items[i]);
      } catch (e) {
        if (e?.name !== 'AbortError') console.error(`Error processing item ${i}`, e);
        results[i] = null;
      }
    }
  };

  const workers = [];
  for (let i = 0; i < concurrency; i++) {
    workers.push(next());
  }
  await Promise.all(workers);
  return results;
}

const loadImage = (url, signal) => {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) { reject(signal.reason); return; }
    const img = new Image();
    img.crossOrigin = "Anonymous";
    const onAbort = () => { img.src = ''; reject(signal.reason); };
    signal?.addEventListener('abort', onAbort, { once: true });
    img.onload = () => { signal?.removeEventListener('abort', onAbort); resolve(img); };
    img.onerror = () => { signal?.removeEventListener('abort', onAbort); resolve(null); };
    img.src = url;
  });
};

const SAT_TEX_MAX_SIZE = 8192;

// Converts a satellite canvas to a blob URL, capping at SAT_TEX_MAX_SIZE to
// avoid GPU upload failures at extreme resolutions (e.g. 16k dev mode).
// Uses OffscreenCanvas.convertToBlob() when available so JPEG encoding runs
// off the main thread, preventing the visible freeze that canvas.toBlob()
// causes in Chrome right after a progress status update.
const canvasToSatelliteBlobUrl = async (srcCanvas) => {
  console.log(`[Sat URL] srcCanvas: ${srcCanvas.width}x${srcCanvas.height}`);

  // Sample the center pixel of the source canvas to detect a blank/black canvas
  // early — a GPU-backed canvas can silently lose its data under memory pressure.
  try {
    const sCtx = srcCanvas.getContext('2d');
    if (sCtx) {
      const cx = srcCanvas.width >> 1, cy = srcCanvas.height >> 1;
      const px = sCtx.getImageData(cx, cy, 1, 1).data;
      console.log(`[Sat URL] srcCanvas center pixel: r=${px[0]} g=${px[1]} b=${px[2]} a=${px[3]}`);
    } else {
      console.warn('[Sat URL] srcCanvas.getContext("2d") returned null');
    }
  } catch (e) {
    console.warn('[Sat URL] could not sample srcCanvas:', e.message);
  }

  // Yield so Vue can flush the preceding onProgress status update before the
  // encode starts, preventing a perceived freeze/flicker in the loading modal.
  await new Promise(r => setTimeout(r, 0));

  const needsDownscale = srcCanvas.width > SAT_TEX_MAX_SIZE || srcCanvas.height > SAT_TEX_MAX_SIZE;
  const targetW = needsDownscale ? Math.round(srcCanvas.width  * Math.min(SAT_TEX_MAX_SIZE / srcCanvas.width,  SAT_TEX_MAX_SIZE / srcCanvas.height)) : srcCanvas.width;
  const targetH = needsDownscale ? Math.round(srcCanvas.height * Math.min(SAT_TEX_MAX_SIZE / srcCanvas.width,  SAT_TEX_MAX_SIZE / srcCanvas.height)) : srcCanvas.height;

  let blob = null;
  // Prefer OffscreenCanvas path: encoding + optional downscale run off the main
  // thread. When downscaling, use createImageBitmap with resize options to avoid
  // creating a second GPU-backed canvas (saves ~256 MB at 16k).
  if (typeof OffscreenCanvas !== 'undefined') {
    try {
      let source = srcCanvas;
      if (needsDownscale) {
        source = await createImageBitmap(srcCanvas, { resizeWidth: targetW, resizeHeight: targetH, resizeQuality: 'high' });
        console.log(`[Sat URL] capped ${srcCanvas.width}x${srcCanvas.height} → ${targetW}x${targetH} via ImageBitmap`);
      }
      const offscreen = new OffscreenCanvas(targetW, targetH);
      offscreen.getContext('2d').drawImage(source, 0, 0);
      if (source !== srcCanvas && 'close' in source) source.close();
      blob = await offscreen.convertToBlob({ type: 'image/jpeg', quality: 0.9 });
      console.log(`[Sat URL] OffscreenCanvas encode — blob=${blob ? `${(blob.size/1024).toFixed(0)} KB` : 'null'}`);
    } catch (e) {
      console.warn('[Sat URL] OffscreenCanvas path failed, falling back:', e.message);
    }
  }
  if (!blob) {
    // Fallback: draw to a regular canvas (creates second backing store if downscaling)
    let canvas = srcCanvas;
    if (needsDownscale) {
      const scaled = document.createElement('canvas');
      scaled.width  = targetW;
      scaled.height = targetH;
      const scaledCtx = scaled.getContext('2d');
      if (scaledCtx) scaledCtx.drawImage(srcCanvas, 0, 0, targetW, targetH);
      canvas = scaled;
    }
    blob = await new Promise(r => canvas.toBlob(b => r(b), 'image/jpeg', 0.9));
    console.log(`[Sat URL] canvas.toBlob fallback — blob=${blob ? `${(blob.size/1024).toFixed(0)} KB` : 'null'}`);
    if (canvas !== srcCanvas) {
      canvas.width = 0;
      canvas.height = 0;
    }
  }

  const url = blob ? URL.createObjectURL(blob) : '';
  console.log(`[Sat URL] result: ${url ? 'ok' : 'empty'}`);
  return url;
};

/**
 * Fetch and assemble a complete TerrainData object for the given centre point.
 *
 * Elevation pipeline (first successful source wins):
 *   1. GPXZ hires-raster (if useGPXZ + key provided)
 *   2. USGS 1 m DEM (if useUSGS and location is within CONUS / Alaska / Hawaii)
 *   3. AWS Terrarium global tiles (always fetched as satellite-texture fallback)
 *
 * Satellite texture is sourced from Esri World Imagery. Base zoom is 17
 * (~1.2 m/px) and is reduced by floor(processingMetersPerPixel / 4) when
 * processingMetersPerPixel > 1 to reduce fetch/memory load.
 *
 * Both height and image resampling are performed off-thread via a Web Worker
 * to avoid blocking the main thread during the expensive per-pixel loop.
 *
 * @param {object}   center             - { lat, lng }
 * @param {number}   resolution         - Output pixel size (= metres, at 1 m/px)
 * @param {boolean}  includeOSM         - Fetch OSM features and generate textures
 * @param {boolean}  useUSGS            - Attempt USGS 1 m DEM first
 * @param {boolean}  useGPXZ            - Attempt GPXZ hires elevation first
 * @param {boolean}  useKRON86          - Attempt KRON86 (Poland only) first
 * @param {string}   gpxzApiKey         - GPXZ API key (required when useGPXZ)
 * @param {string}   [baseColor]        - Tint for OSM texture generation
 * @param {Function} [onProgress]       - Callback(statusString) for UI progress updates
 * @param {AbortSignal} [signal]        - Cancellation signal
 * @param {object}   [generationOptions]
 * @returns {Promise<object>} TerrainData — heightMap, bounds, satellite/OSM textures, …
 */
export const fetchTerrainData = async (
  center,
  resolution,
  includeOSM = false,
  useUSGS = false,
  useGPXZ = false,
  useKRON86 = false,
  gpxzApiKey = "",
  baseColor = undefined,
  onProgress,
  signal,
  generationOptions = {},
) => {
  const {
    keepSourceGeoTiffs = true,
    generateOSMTextureAsset = true,
    generateHybridTextureAsset = true,
    globalTileConcurrency = 20,
    processingMetersPerPixel = 1,
    targetBounds = null,
    enhanceRoads = false,
    levelRoads = false,
    flat = false,
  } = generationOptions || {};
  // Normalize longitude to handle world wrapping
  const normalizedCenter = {
    lat: center.lat,
    lng: normalizeLng(center.lng),
  };
  const effectiveMetersPerPixel = Number.isFinite(Number(processingMetersPerPixel)) && Number(processingMetersPerPixel) > 0
    ? Number(processingMetersPerPixel)
    : 1;
  // 1. Define Target Metric Grid
  // Resolution is output pixels; meters-per-pixel controls world coverage.
  const width = resolution;
  const height = resolution;

  onProgress?.("Calculating metric bounds...");

  const fetchBounds = targetBounds
    ? {
        north: Number(targetBounds.north),
        south: Number(targetBounds.south),
        east: normalizeLng(Number(targetBounds.east)),
        west: normalizeLng(Number(targetBounds.west)),
      }
    : computeMetricFetchBounds(
        normalizedCenter,
        width * effectiveMetersPerPixel,
        height * effectiveMetersPerPixel,
      );

  const satelliteZoom = clampSatelliteZoomForOutput(
    fetchBounds,
    getSatelliteZoomForProcessingMpp(effectiveMetersPerPixel),
    width,
  );

  // 2. Try GPXZ / USGS
  let rawData = null;
  let rawDataSourceType = null;
  let usgsFallback = false;
  let kron86Fallback = false;
  let kron86FallbackReason = null;
  let shouldSmooth = false;
  let gpxzChunkFailures = false;
  let sourceGeoTiffs = undefined;

  if (useGPXZ && gpxzApiKey) {
    onProgress?.("Fetching high-res GPXZ elevation data...");
    const gpxzResult = await fetchGPXZRaw(fetchBounds, gpxzApiKey, onProgress, signal);
    if (gpxzResult) {
      rawData = gpxzResult.data;
      rawDataSourceType = "geotiff";
      shouldSmooth = gpxzResult.smooth;
      gpxzChunkFailures = !!gpxzResult.hadChunkFailures;
      if (keepSourceGeoTiffs) {
        sourceGeoTiffs = {
          arrayBuffers: gpxzResult.rawArrayBuffers,
          source: "gpxz",
        };
      }
    }
  }

  if (!rawData && useKRON86) {
    if (!isWithinKron86Coverage(fetchBounds)) {
      kron86Fallback = true;
      kron86FallbackReason = 'outside_poland';
      onProgress?.('NMT EVRF2007 covers Poland only. Falling back to global elevation tiles...');
    } else {
      onProgress?.('Fetching NMT EVRF2007 elevation index (Poland)...');
      try {
        const kron86Result = await fetchKron86GridForBounds(fetchBounds, { onProgress, signal });
        if (kron86Result?.gridMeta?.gridTiles?.length) {
          rawData = {
            tiles: kron86Result.gridMeta.gridTiles,
          };
          rawDataSourceType = 'grid';
        } else {
          kron86Fallback = true;
          kron86FallbackReason = kron86Result?.fallbackReason || 'unavailable';
          onProgress?.('NMT EVRF2007 data was unavailable for this area. Falling back to global elevation tiles...');
        }
      } catch (error) {
        console.warn('[NMT-EVRF2007] Failed to load NMT EVRF2007 elevation data:', error);
        kron86Fallback = true;
        kron86FallbackReason = 'request_failed';
        onProgress?.('NMT EVRF2007 request failed. Falling back to global elevation tiles...');
      }
    }
  }

  const isCONUS =
    fetchBounds.north < 50 &&
    fetchBounds.south > 24 &&
    fetchBounds.west > -125 &&
    fetchBounds.east < -66;
  const isAlaska =
    fetchBounds.north < 72 &&
    fetchBounds.south > 50 &&
    fetchBounds.west > -170 &&
    fetchBounds.east < -129;
  const isHawaii =
    fetchBounds.north < 23 &&
    fetchBounds.south > 18 &&
    fetchBounds.west > -161 &&
    fetchBounds.east < -154;

  if (!rawData && useUSGS && (isCONUS || isAlaska || isHawaii)) {
    const usgsResult = await fetchUSGSRaw(fetchBounds, onProgress, signal);
    if (usgsResult) {
      rawData = usgsResult.data;
      if (keepSourceGeoTiffs) {
        sourceGeoTiffs = {
          arrayBuffers: usgsResult.rawArrayBuffers,
          source: "usgs",
        };
      }
    } else {
      usgsFallback = true;
      console.warn(
        "[USGS] Failed to fetch raw data, falling back to global tiles.",
      );
    }
  }

  // 3. Prepare Samplers
  let heightSampler = null;
  let colorSampler = null;

  // We always need global tiles for Satellite Texture, and as fallback for Height
  onProgress?.("Fetching global tiles...");

  // Calculate tile range covering the fetchBounds for Terrain (Z15)
  const nw = project(fetchBounds.north, fetchBounds.west, TERRAIN_ZOOM);
  const se = project(fetchBounds.south, fetchBounds.east, TERRAIN_ZOOM);

  const minTileX = Math.floor(nw.x / TILE_SIZE);
  const minTileY = Math.floor(nw.y / TILE_SIZE);
  const maxTileX = Math.floor(se.x / TILE_SIZE);
  const maxTileY = Math.floor(se.y / TILE_SIZE);

  // Calculate tile range covering the fetchBounds for Satellite
  const satNw = project(fetchBounds.north, fetchBounds.west, satelliteZoom);
  const satSe = project(fetchBounds.south, fetchBounds.east, satelliteZoom);

  const satMinTileX = Math.floor(satNw.x / TILE_SIZE);
  const satMinTileY = Math.floor(satNw.y / TILE_SIZE);
  const satMaxTileX = Math.floor(satSe.x / TILE_SIZE);
  const satMaxTileY = Math.floor(satSe.y / TILE_SIZE);

  // Create canvases to hold the stitched tiles
  const tileCountX = maxTileX - minTileX + 1;
  const tileCountY = maxTileY - minTileY + 1;
  const canvasWidth = tileCountX * TILE_SIZE;
  const canvasHeight = tileCountY * TILE_SIZE;

  const satTileCountX = satMaxTileX - satMinTileX + 1;
  const satTileCountY = satMaxTileY - satMinTileY + 1;
  const satCanvasWidth = satTileCountX * TILE_SIZE;
  const satCanvasHeight = satTileCountY * TILE_SIZE;

  const terrainCanvas = document.createElement("canvas");
  terrainCanvas.width = canvasWidth;
  terrainCanvas.height = canvasHeight;
  const tCtx = terrainCanvas.getContext("2d", { willReadFrequently: true });

  if (!tCtx) throw new Error("Failed to create terrain canvas context");

  // Build satellite pixel data into a CPU-side buffer rather than a GPU-backed
  // canvas. A large canvas (e.g. 18432x18176 at 16k) can have its GPU backing
  // store silently zeroed under memory pressure, causing getImageData to return
  // all-transparent pixels even when every tile loaded successfully.
  // Using a plain Uint8ClampedArray eliminates the GPU round-trip entirely and
  // halves peak memory (no separate getImageData copy needed).
  const satBuffer = new Uint8ClampedArray(satCanvasWidth * satCanvasHeight * 4);
  // Default alpha=255 so any gap (missed tile) reads as opaque rather than transparent
  const satBuffer32 = new Uint32Array(satBuffer.buffer);
  satBuffer32.fill(0xFF000000); // little-endian RGBA: (0,0,0,255) opaque black

  // Reuse a single 256×256 scratch canvas to extract each satellite tile's pixels.
  // JS is single-threaded so concurrent pMap callbacks never actually overlap;
  // clearing+drawing+reading is always atomic within one event-loop turn.
  const tempSatCanvas = document.createElement("canvas");
  tempSatCanvas.width = TILE_SIZE;
  tempSatCanvas.height = TILE_SIZE;
  const tempSatCtx = tempSatCanvas.getContext("2d", { willReadFrequently: true });
  if (!tempSatCtx) throw new Error("Failed to create satellite scratch canvas context");

  // Fetch tiles

  const requests = [];

  // Terrain Requests
  // Always fetch global tiles to serve as fallback for holes in high-res data.
  // Flat mode skips elevation entirely, so no terrain tiles are needed.
  if (!flat && (!sourceGeoTiffs || sourceGeoTiffs.source !== "gpxz" || gpxzChunkFailures)) {
    for (let tx = minTileX; tx <= maxTileX; tx++) {
      for (let ty = minTileY; ty <= maxTileY; ty++) {
        requests.push({ tx, ty, type: "terrain" });
      }
    }
  }

  // Satellite Requests
  for (let tx = satMinTileX; tx <= satMaxTileX; tx++) {
    for (let ty = satMinTileY; ty <= satMaxTileY; ty++) {
      requests.push({ tx, ty, type: "satellite" });
    }
  }

  onProgress?.(
    `Downloading ${requests.filter((r) => r.type === "terrain").length} terrain and ${requests.filter((r) => r.type === "satellite").length} satellite tiles (${Math.max(1, Number(globalTileConcurrency || 20))}x concurrent)...`,
  );

  let completed = 0;
  let terrainTilesRequested = 0;
  let terrainTilesSucceeded = 0;
  let terrainTilesFailed = 0;
  let satTilesSucceeded = 0;
  let satTilesFailed = 0;
  await pMap(
    requests,
    async ({ tx, ty, type }) => {
      completed++;
      if (completed % 10 === 0 || completed === requests.length) {
        onProgress?.(
          `Downloaded ${completed}/${requests.length} global tiles...`,
        );
      }
      if (type === "terrain") {
        terrainTilesRequested++;
        const drawX = (tx - minTileX) * TILE_SIZE;
        const drawY = (ty - minTileY) * TILE_SIZE;

        const numTiles = Math.pow(2, TERRAIN_ZOOM);
        const wrappedTx = ((tx % numTiles) + numTiles) % numTiles;

        const terrainUrl = `${TILE_API_URL}/${TERRAIN_ZOOM}/${wrappedTx}/${ty}.png`;
        const tImg = await loadImage(terrainUrl, signal);
        if (tImg) {
          terrainTilesSucceeded++;
          tCtx.drawImage(tImg, drawX, drawY);
        } else {
          terrainTilesFailed++;
          tCtx.fillStyle = "black";
          tCtx.fillRect(drawX, drawY, TILE_SIZE, TILE_SIZE);
        }
      } else {
        const drawX = (tx - satMinTileX) * TILE_SIZE;
        const drawY = (ty - satMinTileY) * TILE_SIZE;

        const numTiles = Math.pow(2, satelliteZoom);
        const wrappedTx = ((tx % numTiles) + numTiles) % numTiles;

        const satUrl = `${SATELLITE_API_URL}/${satelliteZoom}/${ty}/${wrappedTx}`;
        const sImg = await loadImage(satUrl, signal);
        if (sImg) {
          satTilesSucceeded++;
          tempSatCtx.clearRect(0, 0, TILE_SIZE, TILE_SIZE);
          tempSatCtx.drawImage(sImg, 0, 0);
          const tilePixels = tempSatCtx.getImageData(0, 0, TILE_SIZE, TILE_SIZE).data;
          for (let row = 0; row < TILE_SIZE; row++) {
            const srcOff = row * TILE_SIZE * 4;
            const dstOff = ((drawY + row) * satCanvasWidth + drawX) * 4;
            satBuffer.set(tilePixels.subarray(srcOff, srcOff + TILE_SIZE * 4), dstOff);
          }
        } else {
          satTilesFailed++;
          // Fallback: already initialized to opaque black; write dark gray for visibility
          for (let row = 0; row < TILE_SIZE; row++) {
            const dstOff = ((drawY + row) * satCanvasWidth + drawX) * 4;
            for (let col = 0; col < TILE_SIZE; col++) {
              satBuffer[dstOff + col * 4]     = 0x1a;
              satBuffer[dstOff + col * 4 + 1] = 0x1a;
              satBuffer[dstOff + col * 4 + 2] = 0x1a;
              // alpha already 255 from initialization
            }
          }
        }
      }
    },
    Math.max(1, Number(globalTileConcurrency || 20)),
    signal,
  );
  console.log(`[Sat Tiles] ${satTilesSucceeded} ok / ${satTilesFailed} failed — canvas ${satCanvasWidth}x${satCanvasHeight}`);

  if (!rawData && terrainTilesRequested > 0 && terrainTilesSucceeded === 0) {
    throw new Error(
      `Failed to download elevation terrain tiles (${terrainTilesFailed}/${terrainTilesRequested} failed). Please retry or switch elevation source.`
    );
  }

  await repairTerrariumNoDataTiles({
    ctx: tCtx,
    zoom: TERRAIN_ZOOM,
    minTileX,
    minTileY,
    tileCountX,
    tileCountY,
    signal,
    onProgress,
  });

  // Create Samplers from Canvases
  // Always create the terrain data image so we have a fallback sampler
  const terrainDataImg = tCtx.getImageData(0, 0, canvasWidth, canvasHeight);
  // satDataImg uses the CPU-side buffer directly — no GPU readback needed.
  const satDataImg = { data: satBuffer, width: satCanvasWidth, height: satCanvasHeight };
  {
    const d = satDataImg.data;
    const sample = (px, py) => {
      const idx = (py * satCanvasWidth + px) * 4;
      return `(${d[idx]},${d[idx+1]},${d[idx+2]},${d[idx+3]})`;
    };
    const cx = satCanvasWidth >> 1, cy = satCanvasHeight >> 1;
    console.log(`[Sat Canvas] ${satCanvasWidth}x${satCanvasHeight} — center:${sample(cx,cy)} TL:${sample(0,0)} TR:${sample(satCanvasWidth-1,0)} BL:${sample(0,satCanvasHeight-1)} BR:${sample(satCanvasWidth-1,satCanvasHeight-1)}`);
  }

  // Helper to get pixel from Mercator Canvas
  const getMercatorPixel = (lat, lng, data, zoom, minTx, minTy) => {
    const p = project(lat, lng, zoom);
    const localX = p.x - minTx * TILE_SIZE;
    const localY = p.y - minTy * TILE_SIZE;

    const x = Math.floor(localX);
    const y = Math.floor(localY);

    if (x < 0 || x >= data.width || y < 0 || y >= data.height) return null;

    const i = (y * data.width + x) * 4;
    return {
      r: data.data[i],
      g: data.data[i + 1],
      b: data.data[i + 2],
      a: data.data[i + 3],
    };
  };

  if (flat) {
    // Flat mode: no elevation data was fetched — every sample is zero so the
    // resampled grid is perfectly level. Satellite + OSM still flow normally.
    heightSampler = () => 0;
  } else if (terrainDataImg) {
    heightSampler = (lat, lng) => {
      // Bilinear Interpolation for smoother terrain
      const p = project(lat, lng, TERRAIN_ZOOM);
      const localX = p.x - minTileX * TILE_SIZE;
      const localY = p.y - minTileY * TILE_SIZE;

      const x0 = Math.floor(localX);
      const y0 = Math.floor(localY);
      const dx = localX - x0;
      const dy = localY - y0;

      const w = terrainDataImg.width;
      const h = terrainDataImg.height;

      const getH = (x, y) => {
        const cx = Math.max(0, Math.min(w - 1, x));
        const cy = Math.max(0, Math.min(h - 1, y));
        const i = (cy * w + cx) * 4;
        const r = terrainDataImg.data[i];
        const g = terrainDataImg.data[i + 1];
        const b = terrainDataImg.data[i + 2];
        // Mapzen encoding with nodata guard (0,0,0 → -32768)
        const h = r * 256 + g + b / 256 - 32768;
        return h <= -32760 ? NO_DATA_VALUE : h;
      };

      const h00 = getH(x0, y0);
      const h10 = getH(x0 + 1, y0);
      const h01 = getH(x0, y0 + 1);
      const h11 = getH(x0 + 1, y0 + 1);

      const top = (1 - dx) * h00 + dx * h10;
      const bottom = (1 - dx) * h01 + dx * h11;
      return (1 - dy) * top + dy * bottom;
    };
  }

  colorSampler = (lat, lng) => {
    const px = getMercatorPixel(
      lat,
      lng,
      satDataImg,
      satelliteZoom,
      satMinTileX,
      satMinTileY,
    );
    if (!px) return { r: 0, g: 0, b: 0, a: 255 };
    return px;
  };

  // 4. Resample Heightmap to Metric Grid
  signal?.throwIfAborted();
  onProgress?.(`Resampling heightmap to ${effectiveMetersPerPixel}m/px...`);

  // Prepare serializable fallback sampler data for the web worker
  const fallbackSamplerData = terrainDataImg ? {
    pixels: terrainDataImg.data,
    width: terrainDataImg.width,
    height: terrainDataImg.height,
    zoom: TERRAIN_ZOOM,
    minTileX,
    minTileY,
  } : null;

  const imageSamplerData = {
    pixels: satDataImg.data,
    width: satDataImg.width,
    height: satDataImg.height,
    zoom: satelliteZoom,
    minTileX: satMinTileX,
    minTileY: satMinTileY,
  };

  const { heightMap, bounds: finalBounds, canvas: finalSatCanvas } = await resampleHeightAndImageOffThread(
    {
      type: rawData ? (rawDataSourceType || "geotiff") : "sampler",
      data: rawData || undefined,
      sampler: heightSampler || undefined,
      transferRasters: !!rawData && (rawDataSourceType === "geotiff"),
    },
    colorSampler,
    normalizedCenter,
    width,
    height,
    "bilinear",
    shouldSmooth,
    fallbackSamplerData,
    // GPXZ is generally hole-free; if GPXZ chunks failed, keep fill enabled.
    !(useGPXZ && rawData && !gpxzChunkFailures),
    imageSamplerData,
    fetchBounds,
    undefined, // onProgress
    undefined, // expandFilledGaps (defaults to true)
    flat,
  );

  // 7. Fetch OSM Data
  let osmFeatures = [];
  let osmRequestInfo = null;
  if (includeOSM || enhanceRoads || levelRoads) {
    signal?.throwIfAborted();
    onProgress?.("Fetching OpenStreetMap data...");
    osmFeatures = await fetchOSMData(finalBounds);
    osmRequestInfo = getLastOSMRequestInfo() || {
      ...getOSMQueryParameters(finalBounds),
      endpointUsed: null,
      startedAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
      elementCount: 0,
    };
  }

  if ((enhanceRoads || levelRoads) && osmFeatures.length > 0) {
    onProgress?.("Smoothing roads in heightmap...");
    smoothRoadsInHeightmap(heightMap, width, height, finalBounds, osmFeatures, effectiveMetersPerPixel, enhanceRoads, levelRoads);
  }

  // 6. Calculate Min/Max
  let minHeight = Infinity;
  let maxHeight = -Infinity;
  for (let i = 0; i < heightMap.length; i++) {
    const h = heightMap[i];
    if (h !== NO_DATA_VALUE) {
      if (h < minHeight) minHeight = h;
      if (h > maxHeight) maxHeight = h;
    }
  }
  if (minHeight === Infinity) minHeight = 0;
  if (maxHeight === -Infinity) maxHeight = 0;

  onProgress?.("Finalizing terrain data...");
  const satelliteTextureUrl = await canvasToSatelliteBlobUrl(finalSatCanvas);
  // Free the (potentially huge) source canvas immediately — it's no longer needed
  // and holding onto it during OSM/hybrid texture generation exhausts memory at 16k.
  finalSatCanvas.width = 0;
  finalSatCanvas.height = 0;

  const terrainData = {
    heightMap,
    width,
    height,
    minHeight,
    maxHeight,
    satelliteTextureUrl,
    bounds: finalBounds,
    osmFeatures,
    osmRequestInfo,
    usgsFallback,
    kron86Fallback,
    kron86FallbackReason,
    sourceGeoTiffs,
    processingMetersPerPixel: effectiveMetersPerPixel,
    flat,
  };

  if (includeOSM && osmFeatures.length > 0) {
    const options = { Roads: true, baseColor, onProgress };
    if (generateOSMTextureAsset) {
      onProgress?.("Generating OSM texture...");
      const osmResult = await generateOSMTexture(terrainData, options);
      terrainData.osmTextureUrl = osmResult.url;
      terrainData.osmTextureCanvas = osmResult.canvas;
      terrainData.osmTextureBlob = osmResult.blob || null;
    }

    if (generateHybridTextureAsset) {
      onProgress?.("Generating Hybrid texture...");
      const hybridResult = await generateHybridTexture(
        terrainData,
        options,
      );
      terrainData.hybridTextureUrl = hybridResult.url;
      terrainData.hybridTextureCanvas = hybridResult.canvas;
      terrainData.hybridTextureBlob = hybridResult.blob || null;
    }

  }

  return terrainData;
};

/**
 * Generate terrain data from a user-uploaded raster/grid elevation file instead of fetching
 * elevation from GPXZ/USGS/Terrarium.
 *
 * Legacy compatibility API: prefer loadTerrainFromUploadedElevation() for new
 * code so callers do not need format-specific naming.
 *
 * Satellite tiles are still fetched normally from the network using the
 * coordinates, so OSM overlays and textures work exactly as in the normal flow.
 *
 * @param {object} uploadedRasterData - Parsed result from parseRasterOrGridElevationFile()
 * @param {object} center      - { lat, lng } — from file metadata or user input
 * @param {number} resolution  - Output size in pixels (= metres at 1m/px)
 * @param {boolean} includeOSM
 * @param {Function} onProgress
 * @param {AbortSignal} signal
 * @param {object} generationOptions
 */
export const loadTerrainFromTif = async (
  uploadedRasterData,
  center,
  resolution,
  includeOSM = false,
  onProgress,
  signal,
  generationOptions = {},
) => {
  if (uploadedRasterData?.isLikelyElevation === false) {
    throw new Error(uploadedRasterData.elevationValidationMessage || '[BYOD] Uploaded GeoTIFF is not a valid elevation raster.');
  }

  const {
    generateOSMTextureAsset = true,
    generateHybridTextureAsset = true,
    globalTileConcurrency = 20,
    elevationUnitOverride = 'auto',
    processingMetersPerPixel = 1,
    targetBounds = null,
    preferNativeCoverage = true,
    enhanceRoads = false,
    levelRoads = false,
    gapFillSource = GAP_FILL_STANDARD,
    gpxzApiKey = '',
    layerOrder = null,
  } = generationOptions || {};

  const effectiveMetersPerPixel = Number.isFinite(Number(processingMetersPerPixel)) && Number(processingMetersPerPixel) > 0
    ? Number(processingMetersPerPixel)
    : 1;
  const normalizedCenter = { lat: center.lat, lng: normalizeLng(center.lng) };
  const emitProgress = (update) => onProgress?.(update);

  // No-data masking: whatever parsing worked out (GDAL_NODATA tag or a detected
  // fill value), unless the user overrode it in the upload card. NODATA_FALLBACK
  // stands in for "mask nothing" — no real DEM holds -99999.
  const resolvedNoData = resolveNoDataValue(
    uploadedRasterData.noDataDetection,
    uploadedRasterData.noDataOverride ?? NODATA_AUTO,
  );
  const effectiveNoData = Number.isFinite(resolvedNoData) ? resolvedNoData : NODATA_FALLBACK;
  const noDataOverridden = !!uploadedRasterData.noDataOverride
    && uploadedRasterData.noDataOverride !== NODATA_AUTO;
  if (uploadedRasterData.noDataDetection?.source || uploadedRasterData.noDataOverride) {
    console.info(`[BYOD] No-data value in use: ${effectiveNoData === NODATA_FALLBACK ? 'none' : effectiveNoData} (override: ${uploadedRasterData.noDataOverride ?? NODATA_AUTO}, detected: ${uploadedRasterData.noDataDetection?.value ?? 'none'}).`);
  }

  // ── Layer priority stack ──────────────────────────────────────────────────
  // An upload of several surveys resolves to several layers; the first supplies
  // everything it has, each next one fills what is still empty, and the gap-fill
  // source below backs up whatever no layer reached. Every handover is
  // seam-blended in the worker.
  const orderedLayers = applyLayerOrder(uploadedRasterData.layers || [], layerOrder);
  const rasterEntries = uploadedRasterData.images
    || [{ image: uploadedRasterData.image, raster: uploadedRasterData.raster, noData: uploadedRasterData.noData }];
  const layeredImages = assignLayerIndices(rasterEntries, orderedLayers).map((entry) => ({
    ...entry,
    // A manual override replaces every layer's value; otherwise each layer keeps
    // the fill value its own tiles agreed on.
    noData: noDataOverridden || !Number.isFinite(entry.noData) ? effectiveNoData : entry.noData,
  }));
  if (orderedLayers.length > 1) {
    console.info(`[BYOD] Elevation layer priority: ${orderedLayers.map((l, i) => `${i + 1}. ${l.label}`).join(', ')}`);
  }
  let width;
  let height;
  let fetchBounds;
  const hasTargetBounds = targetBounds && ['north', 'south', 'east', 'west'].every((key) => Number.isFinite(Number(targetBounds[key])));

  emitProgress('Calculating metric bounds...');

  if (hasTargetBounds) {
    width = resolution;
    height = resolution;
    fetchBounds = {
      north: Number(targetBounds.north),
      south: Number(targetBounds.south),
      east: normalizeLng(Number(targetBounds.east)),
      west: normalizeLng(Number(targetBounds.west)),
    };
  } else if (preferNativeCoverage && uploadedRasterData.bounds && uploadedRasterData.nativeWidth && uploadedRasterData.nativeHeight) {
    ({ width, height } = scaleNativeDimsToProcessingMpp(uploadedRasterData.nativeWidth, uploadedRasterData.nativeHeight, effectiveMetersPerPixel));
    fetchBounds = {
      north: uploadedRasterData.bounds.north,
      south: uploadedRasterData.bounds.south,
      east: normalizeLng(uploadedRasterData.bounds.east),
      west: normalizeLng(uploadedRasterData.bounds.west),
    };
  } else {
    width = resolution;
    height = resolution;
    fetchBounds = computeMetricFetchBounds(
      normalizedCenter,
      width * effectiveMetersPerPixel,
      height * effectiveMetersPerPixel,
    );
  }

  // ── Satellite tiles (same as fetchTerrainData, no terrain tiles needed) ────
  // CPU-side mosaic: a tileCount-sized canvas goes blank on Chromium at fine
  // processing resolutions (see fetchSatelliteMosaic).
  const satelliteZoom = clampSatelliteZoomForOutput(
    fetchBounds,
    getSatelliteZoomForProcessingMpp(effectiveMetersPerPixel),
    width,
  );
  emitProgress({
    status: 'Downloading satellite tiles...',
    percent: 0,
  });
  const { satDataImg, satMinTileX, satMinTileY } = await fetchSatelliteMosaic(
    fetchBounds,
    satelliteZoom,
    signal,
    (completed, total) => emitProgress({
      status: `Downloading ${total} satellite tiles...`,
      percent: (completed / Math.max(1, total)) * 100,
      detail: `${completed}/${total} tiles`,
    }),
    globalTileConcurrency,
  );
  const colorSampler = (lat, lng) => {
    const p = project(lat, lng, satelliteZoom);
    const localX = p.x - satMinTileX * TILE_SIZE;
    const localY = p.y - satMinTileY * TILE_SIZE;
    const x = Math.floor(localX);
    const y = Math.floor(localY);
    if (x < 0 || x >= satDataImg.width || y < 0 || y >= satDataImg.height)
      return { r: 0, g: 0, b: 0, a: 255 };
    const i = (y * satDataImg.width + x) * 4;
    return { r: satDataImg.data[i], g: satDataImg.data[i+1], b: satDataImg.data[i+2], a: satDataImg.data[i+3] };
  };

  // ── Resample TIF heightmap to metric grid ───────────────────────────────────
  signal?.throwIfAborted();
  console.info(`[BYOD] Resampling ${uploadedRasterData.gridTiles?.length || uploadedRasterData.images?.length || 1} uploaded tile(s) to ${width}x${height}.`);
  emitProgress({ status: 'Mapping uploaded elevation to the output grid...', percent: 0 });

  let heightMap, finalBounds;
  let finalSatCanvas = null;

  if (uploadedRasterData.bounds) {
    // Known CRS — use geographic coordinate mapping through the worker
    const imageSamplerData = {
      pixels: satDataImg.data,
      width: satDataImg.width,
      height: satDataImg.height,
      zoom: satelliteZoom,
      minTileX: satMinTileX,
      minTileY: satMinTileY,
    };
    const source = uploadedRasterData.sourceType === 'grid'
      ? { type: 'grid', data: { tiles: assignLayerIndices(uploadedRasterData.gridTiles || [], orderedLayers) } }
      : { type: 'geotiff', data: layeredImages };
    const skipGapExpansion = String(uploadedRasterData.sourceFormat || '').toLowerCase() === 'gml-zip';
    const { fallbackData, gapFillData } = await fetchGapFillSource({
      gapFillSource,
      bounds: fetchBounds,
      gpxzApiKey,
      signal,
      emitProgress,
      globalTileConcurrency,
    });
    const result = await resampleHeightAndImageOffThread(
      source,
      colorSampler,
      normalizedCenter,
      width,
      height,
      'bilinear',
      false,
      fallbackData,
      true,
      imageSamplerData,
      fetchBounds,
      (progress) => emitProgress({
        status: progress.message || 'Mapping uploaded elevation to the output grid...',
        percent: Number.isFinite(progress.percent) ? progress.percent : null,
        detail: Number.isFinite(progress.current) && Number.isFinite(progress.total)
          ? `${progress.current}/${progress.total}`
          : null,
        stage: progress.stage || null,
      }),
      !skipGapExpansion,
      false,
      gapFillData,
    );
    heightMap = result.heightMap;
    finalBounds = result.bounds;
    finalSatCanvas = result.canvas;
  } else {
    // Unknown/user-defined CRS — stretch TIF directly to output grid via bilinear scaling.
    // The user has positioned the map on the correct location, so we fill the selected area
    // with the TIF data regardless of coordinate metadata.
    const srcW = uploadedRasterData.sourceWidth;
    const srcH = uploadedRasterData.sourceHeight;
    const noDataVal = effectiveNoData;
    heightMap = new Float32Array(width * height);

    for (let oy = 0; oy < height; oy++) {
      for (let ox = 0; ox < width; ox++) {
        const sx = (ox / (width - 1)) * (srcW - 1);
        const sy = (oy / (height - 1)) * (srcH - 1);
        const x0 = Math.floor(sx);
        const y0 = Math.floor(sy);
        const x1 = Math.min(srcW - 1, x0 + 1);
        const y1 = Math.min(srcH - 1, y0 + 1);
        const tx = sx - x0;
        const ty = sy - y0;
        const h00 = uploadedRasterData.raster[y0 * srcW + x0];
        const h10 = uploadedRasterData.raster[y0 * srcW + x1];
        const h01 = uploadedRasterData.raster[y1 * srcW + x0];
        const h11 = uploadedRasterData.raster[y1 * srcW + x1];
        const anyNoData = [h00, h10, h01, h11].some(
          h => h === noDataVal || !Number.isFinite(h)
        );
        heightMap[oy * width + ox] = anyNoData
          ? noDataVal
          : h00 * (1-tx) * (1-ty) + h10 * tx * (1-ty) + h01 * (1-tx) * ty + h11 * tx * ty;
      }
    }
    finalBounds = fetchBounds;
  }

  const elevationUnit = resolveElevationUnitScale(uploadedRasterData, elevationUnitOverride);
  convertHeightMapToMeters(heightMap, elevationUnit.scale);

  // ── Resample satellite texture ───────────────────────────────────────────────
  if (!finalSatCanvas) {
    signal?.throwIfAborted();
    emitProgress({ status: 'Resampling satellite texture...', percent: null, detail: null });
    const imageSamplerData = {
      pixels: satDataImg.data,
      width: satDataImg.width,
      height: satDataImg.height,
      zoom: satelliteZoom,
      minTileX: satMinTileX,
      minTileY: satMinTileY,
    };
    finalSatCanvas = await resampleImageOffThread(
      { sampler: colorSampler },
      normalizedCenter,
      width,
      height,
      imageSamplerData,
      fetchBounds,
    );
  }

  // ── OSM ──────────────────────────────────────────────────────────────────────
  let osmFeatures = [];
  let osmRequestInfo = null;
  if (includeOSM || enhanceRoads || levelRoads) {
    signal?.throwIfAborted();
    emitProgress('Fetching OpenStreetMap data...');
    osmFeatures = await fetchOSMData(finalBounds);
    osmRequestInfo = getLastOSMRequestInfo() || {
      ...getOSMQueryParameters(finalBounds),
      endpointUsed: null,
      startedAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
      elementCount: 0,
    };
  }

  if ((enhanceRoads || levelRoads) && osmFeatures.length > 0) {
    emitProgress('Smoothing roads in heightmap...');
    smoothRoadsInHeightmap(heightMap, width, height, finalBounds, osmFeatures, effectiveMetersPerPixel, enhanceRoads, levelRoads);
  }

  // ── Min/Max ──────────────────────────────────────────────────────────────────
  let minHeight = Infinity;
  let maxHeight = -Infinity;
  for (let i = 0; i < heightMap.length; i++) {
    const h = heightMap[i];
    if (h !== NO_DATA_VALUE) {
      if (h < minHeight) minHeight = h;
      if (h > maxHeight) maxHeight = h;
    }
  }
  if (minHeight === Infinity)  minHeight = 0;
  if (maxHeight === -Infinity) maxHeight = 0;

  emitProgress('Finalizing terrain data...');
  const satelliteTextureUrl = await canvasToSatelliteBlobUrl(finalSatCanvas);
  finalSatCanvas.width = 0;
  finalSatCanvas.height = 0;

  const terrainData = {
    heightMap, width, height, minHeight, maxHeight,
    satelliteTextureUrl,
    bounds: finalBounds,
    osmFeatures, osmRequestInfo,
    usgsFallback: false,
    sourceGeoTiffs: undefined,
    // Custom upload exports default to full processed dimensions.
    exportCropSize: null,
    elevationUnitApplied: {
      selected: elevationUnitOverride,
      detected: uploadedRasterData.verticalUnitDetected || 'unknown',
      detectionSource: uploadedRasterData.verticalUnitDetectionSource || null,
      scaleToMeters: elevationUnit.scale,
      source: elevationUnit.source,
    },
    processingMetersPerPixel: effectiveMetersPerPixel,
  };

  if (includeOSM && osmFeatures.length > 0) {
    const options = { Roads: true, onProgress };
    if (generateOSMTextureAsset) {
      onProgress?.('Generating OSM texture...');
      const osmResult = await generateOSMTexture(terrainData, options);
      terrainData.osmTextureUrl    = osmResult.url;
      terrainData.osmTextureCanvas = osmResult.canvas;
      terrainData.osmTextureBlob   = osmResult.blob || null;
    }
    if (generateHybridTextureAsset) {
      onProgress?.('Generating Hybrid texture...');
      const hybridResult = await generateHybridTexture(terrainData, options);
      terrainData.hybridTextureUrl    = hybridResult.url;
      terrainData.hybridTextureCanvas = hybridResult.canvas;
      terrainData.hybridTextureBlob   = hybridResult.blob || null;
    }
  }

  return terrainData;
};

// ─── LAZ/LAS terrain loader ───────────────────────────────────────────────────
export const loadTerrainFromLaz = async (
  lazData,
  center,
  resolution,
  includeOSM = false,
  onProgress,
  signal,
  generationOptions = {},
) => {
  const {
    generateOSMTextureAsset      = true,
    generateHybridTextureAsset   = true,
    globalTileConcurrency        = 20,
    elevationUnitOverride        = 'auto',
    processingMetersPerPixel     = 1,
    targetBounds                 = null,
    preferNativeCoverage         = true,
    fillLazEdgeGapsWithGlobalDem = true,
    enhanceRoads                 = false,
    levelRoads                   = false,
  } = generationOptions || {};

  const effectiveMetersPerPixel = Number.isFinite(Number(processingMetersPerPixel)) && Number(processingMetersPerPixel) > 0
    ? Number(processingMetersPerPixel)
    : 1;
  const normalizedCenter = { lat: center.lat, lng: normalizeLng(center.lng) };

  onProgress?.('Calculating metric bounds...');

  // If the LAZ has known WGS84 bounds + native pixel dimensions, use them
  // directly — this anchors both the heightmap and OSM to the exact same
  // geographic rectangle, eliminating the centre ± resolution/2 approximation
  // error that caused terrain/OSM misalignment for non-metric CRS files.
  // Fall back to the user-selected resolution when precise bounds are missing.
  let width, height, fetchBounds;
  const hasTargetBounds = targetBounds && ['north', 'south', 'east', 'west'].every((key) => Number.isFinite(Number(targetBounds[key])));
  if (hasTargetBounds) {
    width = resolution;
    height = resolution;
    fetchBounds = {
      north: Number(targetBounds.north),
      south: Number(targetBounds.south),
      east: normalizeLng(Number(targetBounds.east)),
      west: normalizeLng(Number(targetBounds.west)),
    };
  } else if (preferNativeCoverage && lazData.bounds && lazData.nativeWidth && lazData.nativeHeight) {
    ({ width, height } = scaleNativeDimsToProcessingMpp(lazData.nativeWidth, lazData.nativeHeight, effectiveMetersPerPixel));
    fetchBounds = {
      north: lazData.bounds.north,
      south: lazData.bounds.south,
      east:  normalizeLng(lazData.bounds.east),
      west:  normalizeLng(lazData.bounds.west),
    };
  } else {
    width  = resolution;
    height = resolution;
    fetchBounds = computeMetricFetchBounds(
      normalizedCenter,
      width * effectiveMetersPerPixel,
      height * effectiveMetersPerPixel,
    );
  }

  // ── Satellite tiles ───────────────────────────────────────────────────────
  // CPU-side mosaic: a tileCount-sized canvas goes blank on Chromium at fine
  // processing resolutions (see fetchSatelliteMosaic).
  const satelliteZoom = clampSatelliteZoomForOutput(
    fetchBounds,
    getSatelliteZoomForProcessingMpp(effectiveMetersPerPixel),
    width,
  );
  onProgress?.('Downloading satellite tiles...');
  const { satDataImg, satMinTileX, satMinTileY } = await fetchSatelliteMosaic(
    fetchBounds,
    satelliteZoom,
    signal,
    (completed, total) => onProgress?.(`Downloaded ${completed}/${total} satellite tiles...`),
    globalTileConcurrency,
  );
  const colorSampler = (lat, lng) => {
    const p = project(lat, lng, satelliteZoom);
    const localX = p.x - satMinTileX * TILE_SIZE;
    const localY = p.y - satMinTileY * TILE_SIZE;
    const x = Math.floor(localX);
    const y = Math.floor(localY);
    if (x < 0 || x >= satDataImg.width || y < 0 || y >= satDataImg.height)
      return { r: 0, g: 0, b: 0, a: 255 };
    const i = (y * satDataImg.width + x) * 4;
    return { r: satDataImg.data[i], g: satDataImg.data[i+1], b: satDataImg.data[i+2], a: satDataImg.data[i+3] };
  };

  // ── Rasterize point cloud ─────────────────────────────────────────────────
  signal?.throwIfAborted();
  onProgress?.('Processing point cloud...');
  const rasterCenter = hasTargetBounds
    ? {
        lat: (fetchBounds.north + fetchBounds.south) / 2,
        lng: (fetchBounds.east + fetchBounds.west) / 2,
      }
    : normalizedCenter;

  // Multiple tiles (lazData.tiles) are accumulated into a single output grid
  // inside the worker, so overlapping point clouds merge seamlessly.
  const { heightMap } = await rasterizeLazOffThread(
    lazData,
    rasterCenter,
    width,
    height,
    fetchBounds,
    (current, total, status) => {
      const pct = total > 0 ? Math.round(current / total * 100) : 0;
      onProgress?.(status || `Processing point cloud… ${pct}%`);
    },
    signal,
  );

  const lazUnit = resolveElevationUnitScale(lazData, elevationUnitOverride);
  convertHeightMapToMeters(heightMap, lazUnit.scale);

  if (fillLazEdgeGapsWithGlobalDem) {
    await fillLazNoDataWithGlobalTerrain(
      heightMap,
      width,
      height,
      fetchBounds,
      signal,
      onProgress,
      globalTileConcurrency,
    );
  }

  // ── Resample satellite texture ────────────────────────────────────────────
  signal?.throwIfAborted();
  onProgress?.('Resampling satellite texture...');
  const imageSamplerData = {
    pixels:   satDataImg.data,
    width:    satDataImg.width,
    height:   satDataImg.height,
    zoom:     satelliteZoom,
    minTileX: satMinTileX,
    minTileY: satMinTileY,
  };
  const finalSatCanvas = await resampleImageOffThread(
    { sampler: colorSampler },
    rasterCenter,
    width,
    height,
    imageSamplerData,
    fetchBounds,
  );

  // ── OSM ───────────────────────────────────────────────────────────────────
  let osmFeatures = [], osmRequestInfo = null;
  if (includeOSM || enhanceRoads || levelRoads) {
    signal?.throwIfAborted();
    onProgress?.('Fetching OpenStreetMap data...');
    osmFeatures = await fetchOSMData(fetchBounds);
    osmRequestInfo = getLastOSMRequestInfo() || {
      ...getOSMQueryParameters(fetchBounds),
      endpointUsed: null,
      startedAt:    new Date().toISOString(),
      completedAt:  new Date().toISOString(),
      elementCount: 0,
    };
  }

  if ((enhanceRoads || levelRoads) && osmFeatures.length > 0) {
    onProgress?.("Smoothing roads in heightmap...");
    smoothRoadsInHeightmap(heightMap, width, height, fetchBounds, osmFeatures, effectiveMetersPerPixel, enhanceRoads, levelRoads);
  }

  // ── Min / Max ─────────────────────────────────────────────────────────────
  let minHeight = Infinity, maxHeight = -Infinity;
  for (let i = 0; i < heightMap.length; i++) {
    const h = heightMap[i];
    if (h !== NO_DATA_VALUE) {
      if (h < minHeight) minHeight = h;
      if (h > maxHeight) maxHeight = h;
    }
  }
  if (minHeight ===  Infinity) minHeight = 0;
  if (maxHeight === -Infinity) maxHeight = 0;

  onProgress?.('Finalizing terrain data...');
  const satelliteTextureUrl = await canvasToSatelliteBlobUrl(finalSatCanvas);
  finalSatCanvas.width = 0;
  finalSatCanvas.height = 0;

  const terrainData = {
    heightMap, width, height, minHeight, maxHeight,
    satelliteTextureUrl,
    bounds: fetchBounds,
    osmFeatures, osmRequestInfo,
    usgsFallback:   false,
    sourceGeoTiffs: undefined,
    elevationUnitApplied: {
      selected: elevationUnitOverride,
      detected: lazData.verticalUnitDetected || 'unknown',
      detectionSource: lazData.verticalUnitDetectionSource || null,
      scaleToMeters: lazUnit.scale,
      source: lazUnit.source,
    },
    processingMetersPerPixel: effectiveMetersPerPixel,
    // Custom upload exports default to full processed dimensions.
    exportCropSize: null,
  };

  if (includeOSM && osmFeatures.length > 0) {
    const options = { Roads: true, onProgress };
    if (generateOSMTextureAsset) {
      onProgress?.('Generating OSM texture...');
      const osmResult = await generateOSMTexture(terrainData, options);
      terrainData.osmTextureUrl    = osmResult.url;
      terrainData.osmTextureCanvas = osmResult.canvas;
      terrainData.osmTextureBlob   = osmResult.blob || null;
    }
    if (generateHybridTextureAsset) {
      onProgress?.('Generating Hybrid texture...');
      const hybridResult = await generateHybridTexture(terrainData, options);
      terrainData.hybridTextureUrl    = hybridResult.url;
      terrainData.hybridTextureCanvas = hybridResult.canvas;
      terrainData.hybridTextureBlob   = hybridResult.blob || null;
    }
  }

  return terrainData;
};

/**
 * Format-neutral BYOD terrain loader.
 *
 * Routes parsed upload metadata to the appropriate terrain loader while
 * preserving the same call signature used by format-specific loaders.
 */
export const loadTerrainFromUploadedElevation = async (
  uploadedElevationData,
  center,
  resolution,
  includeOSM = false,
  onProgress,
  signal,
  generationOptions = {},
) => {
  const format = String(uploadedElevationData?.sourceFormat || '').toLowerCase();
  const sourceType = String(uploadedElevationData?.sourceType || '').toLowerCase();
  const isVectorBoundsUpload = sourceType === 'vector' || format === 'gml-vector';

  if (isVectorBoundsUpload) {
    const {
      processingMetersPerPixel = 1,
      targetBounds = null,
      preferNativeCoverage = true,
      enhanceRoads = false,
      levelRoads = false,
    } = generationOptions || {};

    const bounds = targetBounds
      || (preferNativeCoverage ? uploadedElevationData?.bounds || null : null);
    const effectiveCenter = uploadedElevationData?.center || center;
    onProgress?.('Detected vector GML upload. Using its bounds with global terrain elevation data...');

    return fetchTerrainData(
      effectiveCenter,
      resolution,
      includeOSM,
      false,
      false,
      false,
      '',
      undefined,
      onProgress,
      signal,
      {
        processingMetersPerPixel,
        targetBounds: bounds,
        enhanceRoads,
        levelRoads,
      },
    );
  }

  // Prefer explicit format tags, but keep fallbacks for older metadata objects.
  const hasLazHeaderShape = Number.isFinite(Number(uploadedElevationData?.pointFormat))
    && Number.isFinite(Number(uploadedElevationData?.pointDataRecordLength));
  const isPointCloud = format === 'laz'
    || format === 'las'
    || sourceType === 'laz'
    || sourceType === 'las'
    || uploadedElevationData?.isLaz === true
    || hasLazHeaderShape;

  if (isPointCloud) {
    return loadTerrainFromLaz(
      uploadedElevationData,
      center,
      resolution,
      includeOSM,
      onProgress,
      signal,
      generationOptions,
    );
  }

  return loadTerrainFromTif(
    uploadedElevationData,
    center,
    resolution,
    includeOSM,
    onProgress,
    signal,
    generationOptions,
  );
};

/**
 * Quick health-check for the USGS TNM Access API.
 * Used by the elevation source selector to show/hide the USGS option.
 * @returns {Promise<boolean>}
 */
export const checkUSGSStatus = async () => {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);
    // Use empty headers to avoid preflight OPTIONS request
    const response = await fetch(`${USGS_PRODUCT_API}?max=1`, {
      headers: {},
      signal: controller.signal,
    });
    clearTimeout(timeoutId);
    return response.ok;
  } catch (e) {
    return false;
  }
};

/**
 * Fetch OSM features for an existing TerrainData object and attach the
 * resulting procedural textures (OSM + hybrid) to a cloned copy.
 *
 * Called when the user enables the OSM toggle after terrain has already been
 * generated — avoids a full re-fetch of elevation and satellite tiles.
 *
 * @returns {Promise<object>} New TerrainData with osmFeatures + texture URLs added
 */
export const addOSMToTerrain = async (
  terrainData,
  baseColor = undefined,
  onProgress,
) => {
  onProgress?.("Fetching OpenStreetMap data...");
  const osmFeatures = await fetchOSMData(terrainData.bounds);
  const osmRequestInfo = getLastOSMRequestInfo() || {
    ...getOSMQueryParameters(terrainData.bounds),
    endpointUsed: null,
    startedAt: new Date().toISOString(),
    completedAt: new Date().toISOString(),
    elementCount: 0,
  };

  const newTerrainData = { ...terrainData, osmFeatures, osmRequestInfo };

  if (osmFeatures.length > 0) {
    const options = { Roads: true, baseColor, onProgress };
    onProgress?.("Generating OSM texture...");
    const osmResult = await generateOSMTexture(
      newTerrainData,
      options,
    );
    newTerrainData.osmTextureUrl = osmResult.url;
    newTerrainData.osmTextureCanvas = osmResult.canvas;
    newTerrainData.osmTextureBlob = osmResult.blob || null;
    onProgress?.("Generating Hybrid texture...");
    const hybridResult = await generateHybridTexture(
      newTerrainData,
      options,
    );
    newTerrainData.hybridTextureUrl = hybridResult.url;
    newTerrainData.hybridTextureCanvas = hybridResult.canvas;
    newTerrainData.hybridTextureBlob = hybridResult.blob || null;

  }

  return newTerrainData;
};
