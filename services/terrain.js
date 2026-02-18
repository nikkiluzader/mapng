import { fetchOSMData } from "./osm";
import { generateOSMTexture, generateHybridTexture, generateSegmentedHybridTexture } from "./osmTexture";
import { segmentSatelliteTexture } from "./segmentation";
import * as GeoTIFF from "geotiff";
import {
  resampleToMeterGrid,
  resampleImageToMeterGrid,
} from "./terrainResampler";
import {
  resampleHeightMapOffThread,
  resampleImageOffThread,
} from "./workerResampler";

// Constants
const TILE_SIZE = 256;
export const TERRAIN_ZOOM = 15; // Fixed high detail zoom level for Terrain
const SATELLITE_ZOOM = 17; // Higher detail zoom level for Satellite (approx 1.2m/px)
const TILE_API_URL = "https://s3.amazonaws.com/elevation-tiles-prod/terrarium";
const SATELLITE_API_URL =
  "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile";
const USGS_PRODUCT_API = "https://tnmaccess.nationalmap.gov/api/v1/products";
const USGS_DATASET = "Digital Elevation Model (DEM) 1 meter";

// Helper to normalize longitude to -180 to 180
const normalizeLng = (lng) => {
  return ((((lng + 180) % 360) + 360) % 360) - 180;
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

    // 2. Check Resolution via Points API
    // We check the center point to see what dataset is being used
    const centerLat = (bounds.north + bounds.south) / 2;
    const centerLng = (bounds.east + bounds.west) / 2;

    let shouldSmooth = false;
    try {
      // Wait before the points check to avoid 429 from the probe request
      await new Promise((r) => setTimeout(r, perWorkerDelayMs));
      const pointsUrl = `/api/gpxz/v1/elevation/points?latlons=${centerLat},${centerLng}`;
      const pointsResp = await fetch(pointsUrl, {
        headers: { "x-api-key": apiKey },
        signal,
      });
      if (pointsResp.ok) {
        const pointsData = await pointsResp.json();
        if (pointsData.results && pointsData.results.length > 0) {
          const res = pointsData.results[0].resolution;
          console.log(`[GPXZ] Dataset Resolution: ${res}m`);
          // If resolution is worse than 2m (e.g. 10m, 30m), enable smoothing
          if (res > 2) {
            shouldSmooth = true;
            console.log("[GPXZ] Low resolution detected. Enabling smoothing.");
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

        const url = `/api/gpxz/v1/elevation/hires-raster?bbox_top=${reqBounds.north}&bbox_bottom=${reqBounds.south}&bbox_left=${reqBounds.west}&bbox_right=${reqBounds.east}&res_m=1&projection=latlon`;

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

    if (validResults.length === 0) return null;

    const rawArrayBuffers = validResults.map((r) => r.arrayBuffer);
    return { data: validResults, smooth: shouldSmooth, rawArrayBuffers };
  } catch (e) {
    console.error("Failed to fetch GPXZ terrain:", e);
    return null;
  }
};

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

    const data = await response.json();

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

// Helper for concurrency control
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
) => {
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

  // Calculate approximate Lat/Lon bounds for fetching
  const metersPerDegLat = 111320;
  const metersPerDegLng =
    111320 * Math.cos((normalizedCenter.lat * Math.PI) / 180);
  const latSpan = height / metersPerDegLat;
  const lngSpan = width / metersPerDegLng;

  const fetchBounds = {
    north: normalizedCenter.lat + latSpan / 2,
    south: normalizedCenter.lat - latSpan / 2,
    east: normalizedCenter.lng + lngSpan / 2,
    west: normalizedCenter.lng - lngSpan / 2,
  };

  // 2. Try GPXZ / USGS
  let rawData = null;
  let usgsFallback = false;
  let shouldSmooth = false;
  let sourceGeoTiffs = undefined;

  if (useGPXZ && gpxzApiKey) {
    onProgress?.("Fetching high-res GPXZ elevation data...");
    const gpxzResult = await fetchGPXZRaw(fetchBounds, gpxzApiKey, onProgress, signal);
    if (gpxzResult) {
      rawData = gpxzResult.data;
      shouldSmooth = gpxzResult.smooth;
      sourceGeoTiffs = {
        arrayBuffers: gpxzResult.rawArrayBuffers,
        source: "gpxz",
      };
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
      sourceGeoTiffs = {
        arrayBuffers: usgsResult.rawArrayBuffers,
        source: "usgs",
      };
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

  const satCanvas = document.createElement("canvas");
  satCanvas.width = satCanvasWidth;
  satCanvas.height = satCanvasHeight;
  const sCtx = satCanvas.getContext("2d", { willReadFrequently: true });

  if (!tCtx || !sCtx) throw new Error("Failed to create canvas contexts");

  // Fetch tiles

  const requests = [];

  // Terrain Requests
  // Always fetch global tiles to serve as fallback for holes in high-res data
  if (!sourceGeoTiffs || sourceGeoTiffs.source !== "gpxz") {
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
    `Downloading ${requests.filter((r) => r.type === "terrain").length} terrain and ${requests.filter((r) => r.type === "satellite").length} satellite tiles...`,
  );

  let completed = 0;
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
        const drawX = (tx - minTileX) * TILE_SIZE;
        const drawY = (ty - minTileY) * TILE_SIZE;

        const numTiles = Math.pow(2, TERRAIN_ZOOM);
        const wrappedTx = ((tx % numTiles) + numTiles) % numTiles;

        const terrainUrl = `${TILE_API_URL}/${TERRAIN_ZOOM}/${wrappedTx}/${ty}.png`;
        const tImg = await loadImage(terrainUrl, signal);
        if (tImg) tCtx.drawImage(tImg, drawX, drawY);
        else {
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
        if (sImg) sCtx.drawImage(sImg, drawX, drawY);
        else {
          sCtx.fillStyle = "#1a1a1a";
          sCtx.fillRect(drawX, drawY, TILE_SIZE, TILE_SIZE);
        }
      }
    },
    20,
    signal,
  );

  // Create Samplers from Canvases
  // Always create the terrain data image so we have a fallback sampler
  const terrainDataImg = tCtx.getImageData(0, 0, canvasWidth, canvasHeight);
  const satDataImg = sCtx.getImageData(0, 0, satCanvasWidth, satCanvasHeight);

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
        // Mapzen encoding
        return r * 256 + g + b / 256 - 32768;
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

  const { heightMap, bounds: finalBounds } = await resampleHeightMapOffThread(
    {
      type: rawData ? "geotiff" : "sampler",
      data: rawData || undefined,
      sampler: heightSampler || undefined,
    },
    normalizedCenter,
    width,
    height,
    "bilinear",
    shouldSmooth,
    fallbackSamplerData,
  );

  // 5. Resample Satellite Texture to Metric Grid
  signal?.throwIfAborted();
  onProgress?.("Resampling satellite texture...");

  // Prepare serializable satellite data for the web worker
  const imageSamplerData = {
    pixels: satDataImg.data,
    width: satDataImg.width,
    height: satDataImg.height,
    zoom: SATELLITE_ZOOM,
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
  if (includeOSM) {
    signal?.throwIfAborted();
    onProgress?.("Fetching OpenStreetMap data...");
    osmFeatures = await fetchOSMData(finalBounds);
  }

  onProgress?.("Finalizing terrain data...");

  // Use toBlob + createObjectURL instead of toDataURL for satellite texture.
  // toDataURL creates a massive base64 string (~33% larger than binary) and blocks the main thread.
  // toBlob is async and createObjectURL is a zero-copy reference to the blob.
  const satelliteTextureUrl = await new Promise((resolve) => {
    finalSatCanvas.toBlob(
      (blob) => resolve(blob ? URL.createObjectURL(blob) : ""),
      "image/jpeg",
      0.9,
    );
  });

  const terrainData = {
    heightMap,
    width,
    height,
    minHeight,
    maxHeight,
    satelliteTextureUrl,
    bounds: finalBounds,
    osmFeatures,
    usgsFallback,
    sourceGeoTiffs,
  };

  // Generate segmented satellite texture (runs in worker, fast)
  onProgress?.("Generating segmented satellite texture...");
  try {
    const segResult = await segmentSatelliteTexture(satelliteTextureUrl, { onProgress });
    terrainData.segmentedTextureUrl = segResult.url;
    terrainData.segmentedTextureCanvas = segResult.canvas;
  } catch (e) {
    console.warn("Segmentation failed, skipping:", e);
  }

  if (includeOSM && osmFeatures.length > 0) {
    const options = { Roads: true, baseColor, onProgress };
    onProgress?.("Generating OSM texture...");
    const osmResult = await generateOSMTexture(terrainData, options);
    terrainData.osmTextureUrl = osmResult.url;
    terrainData.osmTextureCanvas = osmResult.canvas;
    onProgress?.("Generating Hybrid texture...");
    const hybridResult = await generateHybridTexture(
      terrainData,
      options,
    );
    terrainData.hybridTextureUrl = hybridResult.url;
    terrainData.hybridTextureCanvas = hybridResult.canvas;

    // Generate segmented hybrid (segmented base + roads)
    if (terrainData.segmentedTextureUrl) {
      onProgress?.("Generating Segmented Hybrid texture...");
      const segHybridResult = await generateSegmentedHybridTexture(terrainData, options);
      terrainData.segmentedHybridTextureUrl = segHybridResult.url;
      terrainData.segmentedHybridTextureCanvas = segHybridResult.canvas;
    }
  }

  return terrainData;
};

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

export const addOSMToTerrain = async (
  terrainData,
  baseColor = undefined,
  onProgress,
) => {
  onProgress?.("Fetching OpenStreetMap data...");
  const osmFeatures = await fetchOSMData(terrainData.bounds);

  const newTerrainData = { ...terrainData, osmFeatures };

  if (osmFeatures.length > 0) {
    const options = { Roads: true, baseColor, onProgress };
    onProgress?.("Generating OSM texture...");
    const osmResult = await generateOSMTexture(
      newTerrainData,
      options,
    );
    newTerrainData.osmTextureUrl = osmResult.url;
    newTerrainData.osmTextureCanvas = osmResult.canvas;
    onProgress?.("Generating Hybrid texture...");
    const hybridResult = await generateHybridTexture(
      newTerrainData,
      options,
    );
    newTerrainData.hybridTextureUrl = hybridResult.url;
    newTerrainData.hybridTextureCanvas = hybridResult.canvas;

    // Generate segmented hybrid if segmented base exists
    if (newTerrainData.segmentedTextureUrl) {
      onProgress?.("Generating Segmented Hybrid texture...");
      const segHybridResult = await generateSegmentedHybridTexture(newTerrainData, options);
      newTerrainData.segmentedHybridTextureUrl = segHybridResult.url;
      newTerrainData.segmentedHybridTextureCanvas = segHybridResult.canvas;
    }
  }

  return newTerrainData;
};
