import { fetchOSMData, getLastOSMRequestInfo, getOSMQueryParameters } from "./osm";
import { parseTifFile } from "./tifLoader";
export { parseTifFile };
import { parseLazFile } from "./lazLoader";
export { parseLazFile };
import { rasterizeLazOffThread } from "./lazClient";
import { generateOSMTexture, generateHybridTexture } from "./osmTexture";
import * as GeoTIFF from "geotiff";
import {
  resampleHeightAndImageOffThread,
  resampleImageOffThread,
} from "./resamplerClient";
import { createLocalToWGS84 } from "./geoUtils";

// Constants
const TILE_SIZE = 256;
export const TERRAIN_ZOOM = 15; // Fixed high detail zoom level for Terrain
const SATELLITE_ZOOM = 17; // Higher detail zoom level for Satellite (approx 1.2m/px)
const TILE_API_URL = "https://s3.amazonaws.com/elevation-tiles-prod/terrarium";
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
    const concurrency = rateInfo?.concurrency || 1;
    const rps = rateInfo?.rps || 1;
    // Delay between requests per worker to stay under rps limit
    // e.g. 8 workers at 10 rps → each worker delays 800ms between requests
    // Free tier gets a 200ms buffer to avoid 429s from timing jitter
    const rawDelay = Math.ceil((concurrency / rps) * 1000);
    const perWorkerDelayMs = (rateInfo?.plan === 'free') ? Math.max(rawDelay, 1200) : rawDelay;

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
      // Wait before the points check to avoid 429 from the probe request
      await new Promise((r) => setTimeout(r, perWorkerDelayMs));
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

    console.log(`[GPXZ] Split into ${requests.length} tiles (with overlap). Concurrency: ${concurrency}, delay: ${perWorkerDelayMs}ms`);
    onProgress?.(`Fetching ${requests.length} GPXZ tiles (${rateInfo?.plan || 'free'} plan, ${concurrency}x concurrent)...`);

    let completedChunks = 0;
    const results = await pMap(
      requests,
      async (reqBounds) => {
        // Rate limit delay — adjusted per worker for the plan's rps limit
        await new Promise((r) => setTimeout(r, perWorkerDelayMs));
        signal?.throwIfAborted();

        const url = `/api/gpxz/v1/elevation/hires-raster?bbox_top=${reqBounds.north}&bbox_bottom=${reqBounds.south}&bbox_left=${reqBounds.west}&bbox_right=${reqBounds.east}&res_m=best&projection=best&tight_bounds=false`;

        // Retry logic for 429 Rate Limit AND network errors
        let result = null;
        let retries = 0;
        const MAX_RETRIES = 5;

        while (retries < MAX_RETRIES) {
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
        console.error(`Error processing item ${i}`, e);
        // @ts-ignore - basic error handling
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
 * Satellite texture is always sourced from Esri World Imagery at zoom 17
 * (~1.2 m/px), independent of the elevation source.
 *
 * Both height and image resampling are performed off-thread via a Web Worker
 * to avoid blocking the main thread during the expensive per-pixel loop.
 *
 * @param {object}   center             - { lat, lng }
 * @param {number}   resolution         - Output pixel size (= metres, at 1 m/px)
 * @param {boolean}  includeOSM         - Fetch OSM features and generate textures
 * @param {boolean}  useUSGS            - Attempt USGS 1 m DEM first
 * @param {boolean}  useGPXZ            - Attempt GPXZ hires elevation first
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
    targetBounds = null,
  } = generationOptions || {};
  // Normalize longitude to handle world wrapping
  const normalizedCenter = {
    lat: center.lat,
    lng: normalizeLng(center.lng),
  };

  // 1. Define Target Metric Grid
  // Resolution is treated as "Output Size in Pixels" AND "Extent in Meters" (1m/px)
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
    : computeMetricFetchBounds(normalizedCenter, width, height);

  // 2. Try GPXZ / USGS
  let rawData = null;
  let usgsFallback = false;
  let shouldSmooth = false;
  let gpxzChunkFailures = false;
  let sourceGeoTiffs = undefined;

  if (useGPXZ && gpxzApiKey) {
    onProgress?.("Fetching high-res GPXZ elevation data...");
    const gpxzResult = await fetchGPXZRaw(fetchBounds, gpxzApiKey, onProgress, signal);
    if (gpxzResult) {
      rawData = gpxzResult.data;
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

  // Calculate tile range covering the fetchBounds for Satellite (Z17)
  const satNw = project(fetchBounds.north, fetchBounds.west, SATELLITE_ZOOM);
  const satSe = project(fetchBounds.south, fetchBounds.east, SATELLITE_ZOOM);

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
  // Always fetch global tiles to serve as fallback for holes in high-res data
  if (!sourceGeoTiffs || sourceGeoTiffs.source !== "gpxz" || gpxzChunkFailures) {
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

        const numTiles = Math.pow(2, SATELLITE_ZOOM);
        const wrappedTx = ((tx % numTiles) + numTiles) % numTiles;

        const satUrl = `${SATELLITE_API_URL}/${SATELLITE_ZOOM}/${ty}/${wrappedTx}`;
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

  if (terrainDataImg) {
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
      SATELLITE_ZOOM,
      satMinTileX,
      satMinTileY,
    );
    if (!px) return { r: 0, g: 0, b: 0, a: 255 };
    return px;
  };

  // 4. Resample Heightmap to Metric Grid
  signal?.throwIfAborted();
  onProgress?.("Resampling heightmap to 1m/px...");

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
    zoom: SATELLITE_ZOOM,
    minTileX: satMinTileX,
    minTileY: satMinTileY,
  };

  const { heightMap, bounds: finalBounds, canvas: finalSatCanvas } = await resampleHeightAndImageOffThread(
    {
      type: rawData ? "geotiff" : "sampler",
      data: rawData || undefined,
      sampler: heightSampler || undefined,
      transferRasters: !!rawData,
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
    targetBounds,
  );

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

  // 7. Fetch OSM Data
  let osmFeatures = [];
  let osmRequestInfo = null;
  if (includeOSM) {
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
    sourceGeoTiffs,
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
 * Generate terrain data from a user-uploaded TIF file instead of fetching
 * elevation from GPXZ/USGS/Terrarium.
 *
 * Satellite tiles are still fetched normally from the network using the
 * coordinates, so OSM overlays and textures work exactly as in the normal flow.
 *
 * @param {object} tifData     - Parsed result from parseTifFile()
 * @param {object} center      - { lat, lng } — from GeoTIFF metadata or user input
 * @param {number} resolution  - Output size in pixels (= metres at 1m/px)
 * @param {boolean} includeOSM
 * @param {Function} onProgress
 * @param {AbortSignal} signal
 * @param {object} generationOptions
 */
export const loadTerrainFromTif = async (
  tifData,
  center,
  resolution,
  includeOSM = false,
  onProgress,
  signal,
  generationOptions = {},
) => {
  const {
    generateOSMTextureAsset = true,
    generateHybridTextureAsset = true,
    globalTileConcurrency = 20,
    elevationUnitOverride = 'auto',
  } = generationOptions || {};

  const normalizedCenter = { lat: center.lat, lng: normalizeLng(center.lng) };
  let width;
  let height;
  let fetchBounds;

  onProgress?.('Calculating metric bounds...');

  // For georeferenced GeoTIFFs with known native bounds, process the full
  // native coverage so user uploads retain their complete resolution.
  if (tifData.bounds && tifData.nativeWidth && tifData.nativeHeight) {
    width = tifData.nativeWidth;
    height = tifData.nativeHeight;
    fetchBounds = {
      north: tifData.bounds.north,
      south: tifData.bounds.south,
      east: normalizeLng(tifData.bounds.east),
      west: normalizeLng(tifData.bounds.west),
    };
  } else {
    width = resolution;
    height = resolution;
    fetchBounds = computeMetricFetchBounds(normalizedCenter, width, height);
  }

  // ── Satellite tiles (same as fetchTerrainData, no terrain tiles needed) ────
  const satNw = project(fetchBounds.north, fetchBounds.west, SATELLITE_ZOOM);
  const satSe = project(fetchBounds.south, fetchBounds.east, SATELLITE_ZOOM);
  const satMinTileX = Math.floor(satNw.x / TILE_SIZE);
  const satMinTileY = Math.floor(satNw.y / TILE_SIZE);
  const satMaxTileX = Math.floor(satSe.x / TILE_SIZE);
  const satMaxTileY = Math.floor(satSe.y / TILE_SIZE);
  const satTileCountX = satMaxTileX - satMinTileX + 1;
  const satTileCountY = satMaxTileY - satMinTileY + 1;

  const satCanvas = document.createElement('canvas');
  satCanvas.width  = satTileCountX * TILE_SIZE;
  satCanvas.height = satTileCountY * TILE_SIZE;
  const sCtx = satCanvas.getContext('2d', { willReadFrequently: true });
  if (!sCtx) throw new Error('Failed to create satellite canvas context');

  const satRequests = [];
  for (let tx = satMinTileX; tx <= satMaxTileX; tx++)
    for (let ty = satMinTileY; ty <= satMaxTileY; ty++)
      satRequests.push({ tx, ty });

  onProgress?.(`Downloading ${satRequests.length} satellite tiles...`);
  let completed = 0;
  await pMap(satRequests, async ({ tx, ty }) => {
    completed++;
    if (completed % 10 === 0 || completed === satRequests.length)
      onProgress?.(`Downloaded ${completed}/${satRequests.length} satellite tiles...`);
    const numTiles = Math.pow(2, SATELLITE_ZOOM);
    const wrappedTx = ((tx % numTiles) + numTiles) % numTiles;
    const satUrl = `${SATELLITE_API_URL}/${SATELLITE_ZOOM}/${ty}/${wrappedTx}`;
    const sImg = await loadImage(satUrl, signal);
    const drawX = (tx - satMinTileX) * TILE_SIZE;
    const drawY = (ty - satMinTileY) * TILE_SIZE;
    if (sImg) sCtx.drawImage(sImg, drawX, drawY);
    else { sCtx.fillStyle = '#1a1a1a'; sCtx.fillRect(drawX, drawY, TILE_SIZE, TILE_SIZE); }
  }, Math.max(1, Number(globalTileConcurrency || 20)), signal);

  const satDataImg = sCtx.getImageData(0, 0, satCanvas.width, satCanvas.height);
  const colorSampler = (lat, lng) => {
    const p = project(lat, lng, SATELLITE_ZOOM);
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
  onProgress?.('Resampling uploaded TIF to 1m/px...');

  let heightMap, finalBounds;
  let finalSatCanvas = null;

  if (tifData.bounds) {
    // Known CRS — use geographic coordinate mapping through the worker
    const imageSamplerData = {
      pixels: satDataImg.data,
      width: satDataImg.width,
      height: satDataImg.height,
      zoom: SATELLITE_ZOOM,
      minTileX: satMinTileX,
      minTileY: satMinTileY,
    };
    const result = await resampleHeightAndImageOffThread(
      { type: 'geotiff', data: [{ image: tifData.image, raster: tifData.raster }] },
      colorSampler,
      normalizedCenter,
      width,
      height,
      'bilinear',
      false,
      null,
      true,
      imageSamplerData,
    );
    heightMap = result.heightMap;
    finalBounds = result.bounds;
    finalSatCanvas = result.canvas;
  } else {
    // Unknown/user-defined CRS — stretch TIF directly to output grid via bilinear scaling.
    // The user has positioned the map on the correct location, so we fill the selected area
    // with the TIF data regardless of coordinate metadata.
    const srcW = tifData.sourceWidth;
    const srcH = tifData.sourceHeight;
    const noDataVal = tifData.noData ?? -99999;
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
        const h00 = tifData.raster[y0 * srcW + x0];
        const h10 = tifData.raster[y0 * srcW + x1];
        const h01 = tifData.raster[y1 * srcW + x0];
        const h11 = tifData.raster[y1 * srcW + x1];
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

  const tifUnit = resolveElevationUnitScale(tifData, elevationUnitOverride);
  convertHeightMapToMeters(heightMap, tifUnit.scale);

  // ── Resample satellite texture ───────────────────────────────────────────────
  if (!finalSatCanvas) {
    signal?.throwIfAborted();
    onProgress?.('Resampling satellite texture...');
    const imageSamplerData = {
      pixels: satDataImg.data,
      width: satDataImg.width,
      height: satDataImg.height,
      zoom: SATELLITE_ZOOM,
      minTileX: satMinTileX,
      minTileY: satMinTileY,
    };
    finalSatCanvas = await resampleImageOffThread(
      { sampler: colorSampler },
      normalizedCenter,
      width,
      height,
      imageSamplerData,
    );
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

  // ── OSM ──────────────────────────────────────────────────────────────────────
  let osmFeatures = [];
  let osmRequestInfo = null;
  if (includeOSM) {
    signal?.throwIfAborted();
    onProgress?.('Fetching OpenStreetMap data...');
    osmFeatures = await fetchOSMData(finalBounds);
    osmRequestInfo = getLastOSMRequestInfo() || {
      ...getOSMQueryParameters(finalBounds),
      endpointUsed: null,
      startedAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
      elementCount: 0,
    };
  }

  onProgress?.('Finalizing terrain data...');
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
      detected: tifData.verticalUnitDetected || 'unknown',
      detectionSource: tifData.verticalUnitDetectionSource || null,
      scaleToMeters: tifUnit.scale,
      source: tifUnit.source,
    },
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
  } = generationOptions || {};

  const normalizedCenter = { lat: center.lat, lng: normalizeLng(center.lng) };

  onProgress?.('Calculating metric bounds...');

  // If the LAZ has known WGS84 bounds + native pixel dimensions, use them
  // directly — this anchors both the heightmap and OSM to the exact same
  // geographic rectangle, eliminating the centre ± resolution/2 approximation
  // error that caused terrain/OSM misalignment for non-metric CRS files.
  // Fall back to the user-selected resolution when precise bounds are missing.
  let width, height, fetchBounds;
  if (lazData.bounds && lazData.nativeWidth && lazData.nativeHeight) {
    width       = lazData.nativeWidth;
    height      = lazData.nativeHeight;
    fetchBounds = {
      north: lazData.bounds.north,
      south: lazData.bounds.south,
      east:  normalizeLng(lazData.bounds.east),
      west:  normalizeLng(lazData.bounds.west),
    };
  } else {
    width  = resolution;
    height = resolution;
    fetchBounds = computeMetricFetchBounds(normalizedCenter, width, height);
  }

  // ── Satellite tiles ───────────────────────────────────────────────────────
  const satNw = project(fetchBounds.north, fetchBounds.west, SATELLITE_ZOOM);
  const satSe = project(fetchBounds.south, fetchBounds.east, SATELLITE_ZOOM);
  const satMinTileX   = Math.floor(satNw.x / TILE_SIZE);
  const satMinTileY   = Math.floor(satNw.y / TILE_SIZE);
  const satMaxTileX   = Math.floor(satSe.x / TILE_SIZE);
  const satMaxTileY   = Math.floor(satSe.y / TILE_SIZE);
  const satTileCountX = satMaxTileX - satMinTileX + 1;
  const satTileCountY = satMaxTileY - satMinTileY + 1;

  const satCanvas = document.createElement('canvas');
  satCanvas.width  = satTileCountX * TILE_SIZE;
  satCanvas.height = satTileCountY * TILE_SIZE;
  const sCtx = satCanvas.getContext('2d', { willReadFrequently: true });
  if (!sCtx) throw new Error('Failed to create satellite canvas context');

  const satRequests = [];
  for (let tx = satMinTileX; tx <= satMaxTileX; tx++)
    for (let ty = satMinTileY; ty <= satMaxTileY; ty++)
      satRequests.push({ tx, ty });

  onProgress?.(`Downloading ${satRequests.length} satellite tiles...`);
  let completed = 0;
  await pMap(satRequests, async ({ tx, ty }) => {
    completed++;
    if (completed % 10 === 0 || completed === satRequests.length)
      onProgress?.(`Downloaded ${completed}/${satRequests.length} satellite tiles...`);
    const numTiles  = Math.pow(2, SATELLITE_ZOOM);
    const wrappedTx = ((tx % numTiles) + numTiles) % numTiles;
    const satUrl    = `${SATELLITE_API_URL}/${SATELLITE_ZOOM}/${ty}/${wrappedTx}`;
    const sImg = await loadImage(satUrl, signal);
    const drawX = (tx - satMinTileX) * TILE_SIZE;
    const drawY = (ty - satMinTileY) * TILE_SIZE;
    if (sImg) sCtx.drawImage(sImg, drawX, drawY);
    else { sCtx.fillStyle = '#1a1a1a'; sCtx.fillRect(drawX, drawY, TILE_SIZE, TILE_SIZE); }
  }, Math.max(1, Number(globalTileConcurrency || 20)), signal);

  const satDataImg   = sCtx.getImageData(0, 0, satCanvas.width, satCanvas.height);
  const colorSampler = (lat, lng) => {
    const p = project(lat, lng, SATELLITE_ZOOM);
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

  const { heightMap } = await rasterizeLazOffThread(
    lazData,
    normalizedCenter,
    width,
    height,
    (current, total, status) => {
      const pct = total > 0 ? Math.round(current / total * 100) : 0;
      onProgress?.(status || `Processing point cloud… ${pct}%`);
    },
  );

  const lazUnit = resolveElevationUnitScale(lazData, elevationUnitOverride);
  convertHeightMapToMeters(heightMap, lazUnit.scale);

  // ── Resample satellite texture ────────────────────────────────────────────
  signal?.throwIfAborted();
  onProgress?.('Resampling satellite texture...');
  const imageSamplerData = {
    pixels:   satDataImg.data,
    width:    satDataImg.width,
    height:   satDataImg.height,
    zoom:     SATELLITE_ZOOM,
    minTileX: satMinTileX,
    minTileY: satMinTileY,
  };
  const finalSatCanvas = await resampleImageOffThread(
    { sampler: colorSampler },
    normalizedCenter,
    width,
    height,
    imageSamplerData,
  );

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

  // ── OSM ───────────────────────────────────────────────────────────────────
  let osmFeatures = [], osmRequestInfo = null;
  if (includeOSM) {
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
