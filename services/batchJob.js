/**
 * batchJob.js — Batch job grid computation, state management, and runner.
 *
 * Production-oriented runner with explicit state machine, staged timings,
 * retry policy, queue scheduling, and persisted manifest checkpoints.
 */

import JSZip from 'jszip';
import { fetchTerrainData } from './terrain.js';
import { exportToGLB, exportToDAE } from './export3d.js';
import {
  generateHeightmapBlob,
  generateSatelliteBlob,
  generateOSMTextureBlob,
  generateHybridTextureBlob,
  generateSegmentedSatelliteBlob,
  generateSegmentedHybridBlob,
  generateRoadMaskBlob,
  generateGeoTIFFBlob,
  generateGeoJSONBlob,
} from './batchExports.js';
import { buildCommonTraceMetadata, getBuildTrace } from './traceability.js';
import {
  JOB_STATES,
  TILE_STATES,
  computeDeterministicJobId,
  computeTileId,
  ensureJobAndTileStates,
  summarizeStageTimings,
} from './batchRuntime.js';
import { classifyError, runWithRetry } from './retryPolicy.js';
import { createTaskQueue, createRateLimiter } from './taskQueues.js';
import { installBatchFetchCache, clearBatchCache } from './batchCache.js';

// ─── Grid Computation ────────────────────────────────────────────────

export function computeGridTiles(center, resolution, gridCols, gridRows) {
  const tiles = [];
  const metersPerDegLat = 111320;
  const metersPerDegLng = 111320 * Math.cos(center.lat * Math.PI / 180);

  for (let row = 0; row < gridRows; row++) {
    for (let col = 0; col < gridCols; col++) {
      const offsetX = (col - (gridCols - 1) / 2) * resolution;
      const offsetY = ((gridRows - 1) / 2 - row) * resolution;

      const tileLat = center.lat + offsetY / metersPerDegLat;
      const tileLng = center.lng + offsetX / metersPerDegLng;

      const halfLatSpan = resolution / 2 / metersPerDegLat;
      const halfLngSpan = resolution / 2 / metersPerDegLng;

      tiles.push({
        row,
        col,
        index: row * gridCols + col,
        center: { lat: tileLat, lng: tileLng },
        bounds: {
          north: tileLat + halfLatSpan,
          south: tileLat - halfLatSpan,
          east: tileLng + halfLngSpan,
          west: tileLng - halfLngSpan,
        },
      });
    }
  }
  return tiles;
}

export function computeGridBounds(center, resolution, gridCols, gridRows) {
  const metersPerDegLat = 111320;
  const metersPerDegLng = 111320 * Math.cos(center.lat * Math.PI / 180);

  const totalWidth = gridCols * resolution;
  const totalHeight = gridRows * resolution;

  return {
    north: center.lat + totalHeight / 2 / metersPerDegLat,
    south: center.lat - totalHeight / 2 / metersPerDegLat,
    east: center.lng + totalWidth / 2 / metersPerDegLng,
    west: center.lng - totalWidth / 2 / metersPerDegLng,
  };
}

// ─── State Management ────────────────────────────────────────────────

const STORAGE_KEY = 'mapng_batch_state_v2';
const LEGACY_STORAGE_KEY = 'mapng_batch_state';

const mapLegacyJobStatus = (status) => {
  if (status === 'idle') return JOB_STATES.PENDING;
  if (status === 'running') return JOB_STATES.RUNNING;
  if (status === 'paused') return JOB_STATES.PAUSED;
  if (status === 'completed' || status === 'completed_with_errors') return JOB_STATES.COMPLETED;
  return status;
};

const mapLegacyTileStatus = (status) => {
  if (status === 'pending') return TILE_STATES.QUEUED;
  if (status === 'processing') return TILE_STATES.PROCESSING;
  if (status === 'completed') return TILE_STATES.DONE;
  return status;
};

function deriveSchedulerConfig(input) {
  const resolution = Number(input?.resolution || 1024);
  const exports = input?.exports || {};
  const includeOSM = !!input?.includeOSM;
  const requestedProfile = String(input?.performanceProfile || '').trim();

  const heavy3D = !!(exports.glb || exports.dae);
  const heavyVectorTextures = includeOSM && !!(exports.osmTexture || exports.hybridTexture || exports.segmentedHybrid);
  const heavySegmentation = !!exports.segmentedSatellite || !!exports.segmentedHybrid;
  const highRes = resolution >= 8192;
  const veryHighRes = resolution >= 4096;

  let profile = 'balanced';
  let globalTileConcurrency = 20;
  let fetchConcurrency = 4;
  let computeConcurrency = 1;
  let encodeConcurrency = 1;
  let overpassMinIntervalMs = 600;

  if (requestedProfile === 'throughput') {
    profile = 'throughput';
    globalTileConcurrency = resolution >= 8192 ? 12 : 20;
    fetchConcurrency = resolution >= 8192 ? 3 : 4;
    computeConcurrency = 1;
    encodeConcurrency = 1;
    overpassMinIntervalMs = 550;
    return {
      profile,
      fetchConcurrency,
      computeConcurrency,
      encodeConcurrency,
      globalTileConcurrency,
      overpassMinIntervalMs,
    };
  }

  if (requestedProfile === 'low_memory') {
    profile = 'low_memory';
    globalTileConcurrency = resolution >= 8192 ? 6 : 8;
    fetchConcurrency = resolution >= 4096 ? 1 : 2;
    computeConcurrency = 1;
    encodeConcurrency = 1;
    overpassMinIntervalMs = 900;
    return {
      profile,
      fetchConcurrency,
      computeConcurrency,
      encodeConcurrency,
      globalTileConcurrency,
      overpassMinIntervalMs,
    };
  }

  if (highRes) {
    profile = 'highres_8192';
    globalTileConcurrency = (heavy3D || heavySegmentation || heavyVectorTextures) ? 8 : 10;
    fetchConcurrency = 2;
    computeConcurrency = 1;
    encodeConcurrency = 1;
    overpassMinIntervalMs = 750;
  } else if (veryHighRes) {
    profile = 'highres_4096';
    globalTileConcurrency = 12;
    fetchConcurrency = 3;
    computeConcurrency = 1;
    encodeConcurrency = 1;
    overpassMinIntervalMs = 650;
  }

  return {
    profile,
    fetchConcurrency,
    computeConcurrency,
    encodeConcurrency,
    globalTileConcurrency,
    overpassMinIntervalMs,
  };
}

export function createBatchJobState(config) {
  const id = computeDeterministicJobId(config);
  const performanceProfile = ['throughput', 'balanced', 'low_memory'].includes(config?.performanceProfile)
    ? config.performanceProfile
    : 'balanced';
  const scheduler = {
    ...deriveSchedulerConfig({ ...config, performanceProfile }),
    ...(config.scheduler || {}),
  };
  const baseTiles = computeGridTiles(config.center, config.resolution, config.gridCols, config.gridRows);
  const tiles = baseTiles.map((tile) => ({
    ...tile,
    id: computeTileId(id, tile),
    status: TILE_STATES.QUEUED,
    snapshot: null,
    stageTimings: {},
    memory: {
      startUsedBytes: null,
      afterFetchUsedBytes: null,
      beforeZipUsedBytes: null,
      afterZipUsedBytes: null,
      endUsedBytes: null,
      peakUsedBytes: 0,
    },
    lifecycle: {
      startedAt: null,
      fetchCompletedAt: null,
      zipCompletedAt: null,
      completedAt: null,
      totalMs: 0,
    },
    attempts: 0,
    errors: [],
    lastError: null,
    nextRetryAt: null,
    retryable: false,
  }));

  return {
    schemaVersion: 2,
    id,
    center: { ...config.center },
    resolution: config.resolution,
    gridCols: config.gridCols,
    gridRows: config.gridRows,
    exports: { ...config.exports },
    includeOSM: config.includeOSM,
    elevationSource: config.elevationSource,
    gpxzApiKey: config.gpxzApiKey || '',
    gpxzStatus: config.gpxzStatus || null,
    glbMeshResolution: config.glbMeshResolution || 512,
    performanceProfile,

    scheduler,

    status: JOB_STATES.PENDING,
    currentTileIndex: -1,
    currentTileId: null,
    tiles,
    startedAt: null,
    completedAt: null,
    canceledAt: null,
    totalCompleted: 0,
    totalFailed: 0,
    tileCompletionTimes: [],
    instrumentation: {
      memory: {
        supported: false,
        samples: [],
        peakUsedBytes: 0,
        peakTotalBytes: 0,
        sampleLimit: 120,
        sampleIntervalMs: 1200,
        lastSampleAt: 0,
      },
    },
    summary: null,
  };
}

const migrateLoadedState = (state) => {
  if (!state) return null;

  state.status = mapLegacyJobStatus(state.status);
  if (Array.isArray(state.tiles)) {
    state.tiles.forEach((tile) => {
      tile.status = mapLegacyTileStatus(tile.status);
    });
  }

  if (!state.schemaVersion) state.schemaVersion = 2;
  state.performanceProfile = ['throughput', 'balanced', 'low_memory'].includes(state.performanceProfile)
    ? state.performanceProfile
    : 'balanced';
  const fallbackScheduler = deriveSchedulerConfig(state);
  state.scheduler = {
    ...fallbackScheduler,
    ...(state.scheduler || {}),
  };
  ensureJobAndTileStates(state);
  return state;
};

export function saveBatchState(state) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    console.warn('[Batch] Could not persist batch state to localStorage');
  }
}

export function loadBatchState() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY) || localStorage.getItem(LEGACY_STORAGE_KEY);
    if (!saved) return null;
    const state = migrateLoadedState(JSON.parse(saved));
    if (!state) return null;

    // Completed jobs should not remain as "saved resumable" jobs.
    if (state.status === JOB_STATES.COMPLETED) {
      clearBatchState();
      return null;
    }

    return state;
  } catch {
    return null;
  }
}

export function clearBatchState() {
  localStorage.removeItem(STORAGE_KEY);
  localStorage.removeItem(LEGACY_STORAGE_KEY);
}

export async function clearBatchClientCache() {
  await clearBatchCache();
}

export function resetFailedTiles(state) {
  for (const tile of state.tiles) {
    if (tile.status === TILE_STATES.FAILED) {
      tile.status = TILE_STATES.QUEUED;
      tile.lastError = null;
      tile.retryable = false;
      tile.nextRetryAt = null;
    }
  }
  state.status = JOB_STATES.PENDING;
  state.totalFailed = 0;
  saveBatchState(state);
}

// ─── Utilities ───────────────────────────────────────────────────────

function triggerDownload(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

const isJsonMimeType = (mime = '') => {
  const normalized = String(mime).toLowerCase();
  return normalized.includes('application/json') || normalized.includes('text/json');
};

async function ensureExportBlobType(blob, expectedMimeType, fallbackMimeType = expectedMimeType) {
  if (!blob) return null;

  if (isJsonMimeType(blob.type)) {
    throw new Error(`Expected ${expectedMimeType} blob but received JSON payload.`);
  }

  const currentType = String(blob.type || '').toLowerCase();
  const expectedType = String(expectedMimeType || '').toLowerCase();

  if (!expectedType || currentType === expectedType) {
    if (!blob.type && (fallbackMimeType || expectedMimeType)) {
      const buffer = await blob.arrayBuffer();
      return new Blob([buffer], { type: fallbackMimeType || expectedMimeType });
    }
    return blob;
  }

  const buffer = await blob.arrayBuffer();
  return new Blob([buffer], { type: fallbackMimeType || expectedMimeType || 'application/octet-stream' });
}

function getSnapshotSize(state) {
  const maxGridPx = 400;
  const cols = Math.max(1, Number(state.gridCols || 1));
  const rows = Math.max(1, Number(state.gridRows || 1));
  const cellPx = maxGridPx / Math.max(cols, rows);
  const ideal = Math.round(cellPx * 2);
  return Math.max(96, Math.min(512, ideal));
}

async function loadImage(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = url;
  });
}

async function generateTileSnapshot(terrainData, state) {
  const size = getSnapshotSize(state);
  const jpegQuality = size >= 320 ? 0.85 : 0.75;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  try {
    if (terrainData.satelliteTextureUrl) {
      const img = await loadImage(terrainData.satelliteTextureUrl);
      ctx.drawImage(img, 0, 0, size, size);
      return canvas.toDataURL('image/jpeg', jpegQuality);
    }

    if (terrainData.heightMap) {
      const imgData = ctx.createImageData(size, size);
      const range = terrainData.maxHeight - terrainData.minHeight;
      const stepX = terrainData.width / size;
      const stepY = terrainData.height / size;
      for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
          const srcX = Math.min(Math.floor(x * stepX), terrainData.width - 1);
          const srcY = Math.min(Math.floor(y * stepY), terrainData.height - 1);
          const h = terrainData.heightMap[srcY * terrainData.width + srcX];
          const v = range > 0 ? Math.floor(((h - terrainData.minHeight) / range) * 255) : 0;
          const idx = (y * size + x) * 4;
          imgData.data[idx] = v;
          imgData.data[idx + 1] = v;
          imgData.data[idx + 2] = v;
          imgData.data[idx + 3] = 255;
        }
      }
      ctx.putImageData(imgData, 0, 0);
      return canvas.toDataURL('image/jpeg', jpegQuality);
    }
  } catch {
  }

  return null;
}

function releaseTerrainResources(terrainData) {
  if (!terrainData || typeof terrainData !== 'object') return;

  if (terrainData.heightMap) terrainData.heightMap = null;

  if (terrainData.osmTextureCanvas) {
    terrainData.osmTextureCanvas.width = 1;
    terrainData.osmTextureCanvas.height = 1;
    terrainData.osmTextureCanvas = null;
  }
  if (terrainData.hybridTextureCanvas) {
    terrainData.hybridTextureCanvas.width = 1;
    terrainData.hybridTextureCanvas.height = 1;
    terrainData.hybridTextureCanvas = null;
  }
  if (terrainData.segmentedTextureCanvas) {
    terrainData.segmentedTextureCanvas.width = 1;
    terrainData.segmentedTextureCanvas.height = 1;
    terrainData.segmentedTextureCanvas = null;
  }
  if (terrainData.segmentedHybridTextureCanvas) {
    terrainData.segmentedHybridTextureCanvas.width = 1;
    terrainData.segmentedHybridTextureCanvas.height = 1;
    terrainData.segmentedHybridTextureCanvas = null;
  }

  if (terrainData.osmTextureUrl) URL.revokeObjectURL(terrainData.osmTextureUrl);
  if (terrainData.hybridTextureUrl) URL.revokeObjectURL(terrainData.hybridTextureUrl);
  if (terrainData.segmentedTextureUrl) URL.revokeObjectURL(terrainData.segmentedTextureUrl);
  if (terrainData.segmentedHybridTextureUrl) URL.revokeObjectURL(terrainData.segmentedHybridTextureUrl);
  if (terrainData.satelliteTextureUrl) URL.revokeObjectURL(terrainData.satelliteTextureUrl);

  terrainData.osmTextureUrl = null;
  terrainData.hybridTextureUrl = null;
  terrainData.segmentedTextureUrl = null;
  terrainData.segmentedHybridTextureUrl = null;
  terrainData.satelliteTextureUrl = null;

  terrainData.osmTextureBlob = null;
  terrainData.hybridTextureBlob = null;
  terrainData.segmentedTextureBlob = null;
  terrainData.segmentedHybridTextureBlob = null;

  terrainData.osmFeatures = null;
  terrainData.sourceGeoTiffs = null;
}

const checkpoint = (state) => {
  sampleMemory(state);
  state.summary = summarizeStageTimings(state);
  saveBatchState(state);
};

const readPerformanceMemory = () => {
  const mem = performance?.memory;
  if (!mem) return null;
  const usedBytes = Number(mem.usedJSHeapSize || 0);
  const totalBytes = Number(mem.totalJSHeapSize || 0);
  const limitBytes = Number(mem.jsHeapSizeLimit || 0);
  if (!Number.isFinite(usedBytes) || !Number.isFinite(totalBytes)) return null;
  return { usedBytes, totalBytes, limitBytes };
};

const sampleMemory = (state, { tile = null, label = 'checkpoint', force = false } = {}) => {
  const store = state?.instrumentation?.memory;
  if (!store) return null;

  const now = Date.now();
  if (!force && store.lastSampleAt && (now - store.lastSampleAt) < (store.sampleIntervalMs || 1200)) {
    return null;
  }

  const sample = readPerformanceMemory();
  if (!sample) {
    store.supported = false;
    store.lastSampleAt = now;
    return null;
  }

  store.supported = true;
  store.lastSampleAt = now;
  const sampleRow = {
    at: now,
    label,
    tileId: tile?.id || null,
    usedBytes: sample.usedBytes,
    totalBytes: sample.totalBytes,
    limitBytes: sample.limitBytes,
  };

  store.samples.push(sampleRow);
  const limit = Math.max(20, Number(store.sampleLimit || 120));
  if (store.samples.length > limit) {
    store.samples.splice(0, store.samples.length - limit);
  }

  store.peakUsedBytes = Math.max(Number(store.peakUsedBytes || 0), sample.usedBytes);
  store.peakTotalBytes = Math.max(Number(store.peakTotalBytes || 0), sample.totalBytes);

  if (tile) {
    tile.memory = tile.memory || {};
    tile.memory.peakUsedBytes = Math.max(Number(tile.memory.peakUsedBytes || 0), sample.usedBytes);
  }

  return sampleRow;
};

const addTiming = (tile, stage, ms) => {
  tile.stageTimings[stage] = Math.round((tile.stageTimings[stage] || 0) + ms);
};

const runTimedStage = async (tile, stage, fn) => {
  const start = performance.now();
  const result = await fn();
  addTiming(tile, stage, performance.now() - start);
  return result;
};

const sanitizeError = (error, classification, attempt, waitMs = null) => {
  const timestamp = new Date().toISOString();
  return {
    classification: classification.retryable ? 'retryable' : 'non-retryable',
    kind: classification.kind,
    status: classification.status,
    message: error?.message || String(error),
    stack: error?.stack || null,
    timestamp,
    attempts: attempt,
    nextRetryAt: waitMs ? new Date(Date.now() + waitMs).toISOString() : null,
  };
};

const updateCounts = (state) => {
  state.totalCompleted = state.tiles.filter((t) => t.status === TILE_STATES.DONE).length;
  state.totalFailed = state.tiles.filter((t) => t.status === TILE_STATES.FAILED).length;
};

const isPausedOrCanceled = (signal, state) => {
  if (!signal?.aborted) return false;
  if (state.status === JOB_STATES.CANCELED) return true;
  state.status = JOB_STATES.PAUSED;
  return true;
};

function buildTileMetadata(state, tile, terrainData) {
  const runConfig = {
    schemaVersion: 1,
    mode: 'batch',
    center: { ...state.center },
    resolution: state.resolution,
    gridCols: state.gridCols,
    gridRows: state.gridRows,
    includeOSM: state.includeOSM,
    elevationSource: state.elevationSource,
    gpxzApiKey: state.gpxzApiKey || '',
    gpxzStatus: state.gpxzStatus || null,
    glbMeshResolution: state.glbMeshResolution,
    performanceProfile: state.performanceProfile || 'balanced',
    exports: { ...state.exports },
    scheduler: { ...(state.scheduler || {}) },
  };

  return buildCommonTraceMetadata({
    mode: 'batch',
    center: tile.center,
    zoom: null,
    resolution: state.resolution,
    terrainData,
    textureModes: {
      satellite: !!terrainData.satelliteTextureUrl,
      osm: !!terrainData.osmTextureUrl,
      hybrid: !!terrainData.hybridTextureUrl,
      segmentedSatellite: !!terrainData.segmentedTextureUrl,
      segmentedHybrid: !!terrainData.segmentedHybridTextureUrl,
      roadMask: !!terrainData.osmFeatures?.length,
    },
    osmQuery: terrainData.osmRequestInfo || null,
    gpxz: state.gpxzStatus || null,
    extra: {
      batchId: state.id,
      tile: {
        id: tile.id,
        row: tile.row,
        col: tile.col,
        label: `R${tile.row + 1}C${tile.col + 1}`,
        center: tile.center,
      },
      build: getBuildTrace(),
      runConfiguration: runConfig,
      stageTimings: tile.stageTimings,
      scheduler: { ...(state.scheduler || {}) },
      terrain: {
        bounds: terrainData.bounds,
        minHeight: terrainData.minHeight,
        maxHeight: terrainData.maxHeight,
        width: terrainData.width,
        height: terrainData.height,
      },
    },
  });
}

function buildQueues(state, onQueueWait) {
  const scheduler = state.scheduler || {
    fetchConcurrency: 4,
    computeConcurrency: 1,
    encodeConcurrency: 1,
    overpassMinIntervalMs: 600,
  };
  const fetchQueue = createTaskQueue({ concurrency: scheduler.fetchConcurrency, name: 'fetch' });
  const computeQueue = createTaskQueue({ concurrency: scheduler.computeConcurrency, name: 'compute' });
  const encodeQueue = createTaskQueue({ concurrency: scheduler.encodeConcurrency, name: 'encode' });

  const overpassLimiter = createRateLimiter({
    minIntervalMs: Math.max(0, Number(scheduler.overpassMinIntervalMs || 600)),
    concurrency: 1,
  });

  const scheduleFetch = (tile, task) => {
    return fetchQueue.enqueue(() => overpassLimiter.schedule(task), {
      onStart: (waitMs) => onQueueWait(tile, 'queue_wait_fetch', waitMs),
    });
  };
  const scheduleCompute = (tile, task) => {
    return computeQueue.enqueue(task, {
      onStart: (waitMs) => onQueueWait(tile, 'queue_wait_compute', waitMs),
    });
  };
  const scheduleEncode = (tile, task) => {
    return encodeQueue.enqueue(task, {
      onStart: (waitMs) => onQueueWait(tile, 'queue_wait_encode', waitMs),
    });
  };

  return {
    scheduleFetch,
    scheduleCompute,
    scheduleEncode,
    close: () => {
      fetchQueue.close();
      computeQueue.close();
      encodeQueue.close();
    },
  };
}

async function processTile(state, tile, ctx, signal) {
  const {
    onProgress,
    onTileComplete,
    onError,
    scheduleFetch,
    scheduleCompute,
    scheduleEncode,
  } = ctx;

  const label = `R${tile.row + 1}C${tile.col + 1}`;
  tile.status = TILE_STATES.PROCESSING;
  tile.lifecycle = tile.lifecycle || {};
  tile.lifecycle.startedAt = Date.now();
  tile.lastError = null;
  tile.nextRetryAt = null;
  tile.retryable = false;
  tile.attempts = 0;
  const tileStartSample = sampleMemory(state, { tile, label: 'tile_start', force: true });
  if (tileStartSample) {
    tile.memory.startUsedBytes = tileStartSample.usedBytes;
  }
  checkpoint(state);

  const tileStart = Date.now();

  await runWithRetry(
    async (attempt) => {
      tile.attempts = attempt;
      const fetchStatus = { activeStage: null, startedAt: 0 };

      const terrainData = await scheduleFetch(tile, () => runTimedStage(tile, 'fetch_total', async () => {
        onProgress({ tileIndex: tile.index, step: `Fetching terrain data (${label})...`, tile });
        const needsSegmentedBase = !!(state.exports.segmentedSatellite || state.exports.segmentedHybrid);
        const needsOsmTexture = !!(state.includeOSM && state.exports.osmTexture);
        const needsHybridTexture = !!(state.includeOSM && state.exports.hybridTexture);
        const needsSegmentedHybrid = !!(state.includeOSM && state.exports.segmentedHybrid);
        return fetchTerrainData(
          tile.center,
          state.resolution,
          state.includeOSM,
          state.elevationSource === 'usgs',
          state.elevationSource === 'gpxz',
          state.gpxzApiKey,
          undefined,
          (status) => {
            const now = performance.now();
            const next = /OpenStreetMap/.test(status)
              ? 'osm_fetch'
              : /segmented satellite/i.test(status)
                ? 'segmentation'
                : /Generating OSM texture/i.test(status)
                  ? 'osm_texture_generation'
                  : /Generating Hybrid texture/i.test(status)
                    ? 'hybrid_texture_generation'
                    : /Segmented Hybrid/i.test(status)
                      ? 'segmented_hybrid_generation'
                      : /(global tiles|Downloading .*terrain|Downloading .*satellite)/i.test(status)
                        ? 'imagery_fetch'
                        : /GPXZ|USGS|elevation/i.test(status)
                          ? 'elevation_fetch'
                          : null;

            if (fetchStatus.activeStage && fetchStatus.activeStage !== next) {
              addTiming(tile, fetchStatus.activeStage, now - fetchStatus.startedAt);
              fetchStatus.startedAt = now;
            }
            if (next && fetchStatus.activeStage !== next) {
              fetchStatus.activeStage = next;
              if (!fetchStatus.startedAt) fetchStatus.startedAt = now;
            }
            onProgress({ tileIndex: tile.index, step: status, tile });
            checkpoint(state);
          },
          signal,
          {
            keepSourceGeoTiffs: !!state.exports.geotiff,
            generateSegmentedSatellite: needsSegmentedBase,
            generateOSMTextureAsset: needsOsmTexture,
            generateHybridTextureAsset: needsHybridTexture,
            generateSegmentedHybridAsset: needsSegmentedHybrid,
            globalTileConcurrency: Number(state.scheduler?.globalTileConcurrency || 20),
          },
        );
      }));

      tile.lifecycle.fetchCompletedAt = Date.now();
      const afterFetchSample = sampleMemory(state, { tile, label: 'after_fetch', force: true });
      if (afterFetchSample) {
        tile.memory.afterFetchUsedBytes = afterFetchSample.usedBytes;
      }

      checkpoint(state);

      const zip = new JSZip();
      const metadata = buildTileMetadata(state, tile, terrainData);
      zip.file('metadata.json', JSON.stringify(metadata, null, 2));

      if (state.exports.heightmap) {
        onProgress({ tileIndex: tile.index, step: 'Encoding heightmap...', tile });
        const blob = await scheduleEncode(tile, () => runTimedStage(tile, 'encode_png_heightmap', async () => generateHeightmapBlob(terrainData)));
        if (blob) zip.file('heightmap_16bit.png', await ensureExportBlobType(blob, 'image/png'));
        checkpoint(state);
      }

      if (state.exports.satellite) {
        onProgress({ tileIndex: tile.index, step: 'Encoding satellite texture...', tile });
        const blob = await scheduleEncode(tile, () => runTimedStage(tile, 'encode_png_satellite', async () => generateSatelliteBlob(terrainData)));
        if (blob) zip.file('satellite.png', await ensureExportBlobType(blob, 'image/png'));
        checkpoint(state);
      }

      if (state.exports.osmTexture && terrainData.osmTextureUrl) {
        const blob = await scheduleEncode(tile, () => runTimedStage(tile, 'encode_png_osm_texture', async () => generateOSMTextureBlob(terrainData)));
        if (blob) zip.file('osm_texture.png', await ensureExportBlobType(blob, 'image/png'));
        checkpoint(state);
      }

      if (state.exports.hybridTexture && terrainData.hybridTextureUrl) {
        const blob = await scheduleEncode(tile, () => runTimedStage(tile, 'encode_png_hybrid_texture', async () => generateHybridTextureBlob(terrainData)));
        if (blob) zip.file('hybrid_texture.png', await ensureExportBlobType(blob, 'image/png'));
        checkpoint(state);
      }

      if (state.exports.segmentedSatellite) {
        const blob = await scheduleCompute(tile, () => runTimedStage(tile, 'compute_segmentation', async () => generateSegmentedSatelliteBlob(terrainData)));
        if (blob) zip.file('segmented_satellite.png', await ensureExportBlobType(blob, 'image/png'));
        checkpoint(state);
      }

      if (state.exports.segmentedHybrid && terrainData.osmFeatures?.length > 0) {
        const blob = await scheduleCompute(tile, () => runTimedStage(tile, 'compute_segmented_hybrid', async () => generateSegmentedHybridBlob(terrainData)));
        if (blob) zip.file('segmented_hybrid.png', await ensureExportBlobType(blob, 'image/png'));
        checkpoint(state);
      }

      if (state.exports.roadMask && terrainData.osmFeatures?.length > 0) {
        const blob = await scheduleCompute(tile, () => runTimedStage(tile, 'compute_road_mask', async () => generateRoadMaskBlob(terrainData, tile.center)));
        if (blob) zip.file('road_mask_16bit.png', await ensureExportBlobType(blob, 'image/png'));
        checkpoint(state);
      }

      if (state.exports.glb) {
        const blob = await scheduleEncode(tile, () => runTimedStage(tile, 'encode_glb', async () => exportToGLB(terrainData, {
          maxMeshResolution: state.glbMeshResolution,
          includeSurroundings: false,
          returnBlob: true,
          onProgress: (s) => onProgress({ tileIndex: tile.index, step: s, tile }),
        })));
        if (blob) zip.file('model.glb', await ensureExportBlobType(blob, 'model/gltf-binary', 'application/octet-stream'));
        checkpoint(state);
      }

      if (state.exports.dae) {
        const blob = await scheduleEncode(tile, () => runTimedStage(tile, 'encode_dae', async () => exportToDAE(terrainData, {
          maxMeshResolution: state.glbMeshResolution,
          includeSurroundings: false,
          returnBlob: true,
          onProgress: (s) => onProgress({ tileIndex: tile.index, step: s, tile }),
        })));
        if (blob) zip.file('model.dae.zip', await ensureExportBlobType(blob, 'application/zip'));
        checkpoint(state);
      }

      if (state.exports.geotiff) {
        const blob = await scheduleEncode(tile, () => runTimedStage(tile, 'encode_geotiff', async () => generateGeoTIFFBlob(terrainData, tile.center)));
        if (blob) zip.file('heightmap.tif', await ensureExportBlobType(blob, 'image/tiff'));
        checkpoint(state);
      }

      if (state.exports.geojson && terrainData.osmFeatures?.length > 0) {
        const blob = await scheduleEncode(tile, () => runTimedStage(tile, 'encode_geojson', async () => generateGeoJSONBlob(terrainData)));
        if (blob) zip.file('features.geojson', await ensureExportBlobType(blob, 'application/geo+json', 'application/geo+json'));
        checkpoint(state);
      }

      const tileSnapshot = await runTimedStage(tile, 'snapshot_generation', async () => generateTileSnapshot(terrainData, state));
      tile.snapshot = tileSnapshot;

      const beforeZipSample = sampleMemory(state, { tile, label: 'before_zip', force: true });
      if (beforeZipSample) {
        tile.memory.beforeZipUsedBytes = beforeZipSample.usedBytes;
      }

      releaseTerrainResources(terrainData);
      await new Promise(r => setTimeout(r, 0));

      const zipBlob = await scheduleEncode(tile, () => runTimedStage(tile, 'encode_zip', async () => {
        try {
          return await zip.generateAsync({ type: 'blob', streamFiles: true, compression: 'STORE' });
        } catch {
          return await zip.generateAsync({ type: 'blob', compression: 'STORE' });
        }
      }));

      tile.lifecycle.zipCompletedAt = Date.now();
      const afterZipSample = sampleMemory(state, { tile, label: 'after_zip', force: true });
      if (afterZipSample) {
        tile.memory.afterZipUsedBytes = afterZipSample.usedBytes;
      }

      const date = new Date().toISOString().slice(0, 10);
      triggerDownload(zipBlob, `MapNG_Batch_${label}_${date}_${tile.center.lat.toFixed(4)}_${tile.center.lng.toFixed(4)}.zip`);

      tile.status = TILE_STATES.DONE;
      tile.lifecycle.completedAt = Date.now();
      tile.lifecycle.totalMs = tile.lifecycle.startedAt
        ? Math.max(0, tile.lifecycle.completedAt - tile.lifecycle.startedAt)
        : 0;
      state.tileCompletionTimes.push(Date.now() - tileStart);
      updateCounts(state);
      checkpoint(state);
      onTileComplete(tile);

      await new Promise(r => setTimeout(r, 120));
      const endSample = sampleMemory(state, { tile, label: 'post_cleanup', force: true });
      if (endSample) {
        tile.memory.endUsedBytes = endSample.usedBytes;
      }
    },
    {
      maxAttempts: 3,
      signal,
      onRetry: ({ attempt, waitMs, classification, error }) => {
        tile.retryable = true;
        tile.nextRetryAt = new Date(Date.now() + waitMs).toISOString();
        const detail = sanitizeError(error, classification, attempt, waitMs);
        tile.lastError = detail;
        tile.errors.push(detail);
        checkpoint(state);
      },
    },
  ).catch((error) => {
    const classification = classifyError(error);
    const detail = sanitizeError(error, classification, tile.attempts || 1, null);
    tile.lastError = detail;
    tile.errors.push(detail);
    tile.retryable = classification.retryable;
    tile.status = classification.kind === 'aborted' && state.status === JOB_STATES.PAUSED
      ? TILE_STATES.QUEUED
      : TILE_STATES.FAILED;
    updateCounts(state);
    checkpoint(state);
    onError(tile, error);
    throw error;
  });
}

export async function runBatchJob(state, onProgress, onTileComplete, onError, signal) {
  ensureJobAndTileStates(state);

  if (!state.startedAt) state.startedAt = Date.now();
  state.status = JOB_STATES.RUNNING;
  sampleMemory(state, { label: 'job_start', force: true });
  checkpoint(state);

  const uninstallFetchCache = installBatchFetchCache();
  const queues = buildQueues(state, (tile, stage, waitMs) => {
    addTiming(tile, stage, waitMs);
  });

  const processTileList = async (tiles, passLabel) => {
    for (const tile of tiles) {
      if (isPausedOrCanceled(signal, state)) {
        checkpoint(state);
        return;
      }

      if (tile.status === TILE_STATES.DONE || tile.status === TILE_STATES.SKIPPED) {
        continue;
      }

      state.currentTileIndex = tile.index;
      state.currentTileId = tile.id || null;
      onProgress({ tileIndex: tile.index, step: `Starting ${passLabel} tile R${tile.row + 1}C${tile.col + 1}...`, tile });
      checkpoint(state);

      try {
        await processTile(state, tile, {
          onProgress,
          onTileComplete,
          onError,
          ...queues,
        }, signal);
      } catch (error) {
        if (error?.name === 'AbortError' || signal?.aborted) {
          if (state.status !== JOB_STATES.CANCELED) {
            state.status = JOB_STATES.PAUSED;
          }
          checkpoint(state);
          return;
        }
      }
    }
  };

  try {
    const initialTiles = state.tiles.filter((t) => t.status === TILE_STATES.QUEUED || t.status === TILE_STATES.FAILED);
    await processTileList(initialTiles, 'primary');

    if (state.status === JOB_STATES.RUNNING) {
      const retryTiles = state.tiles.filter((t) => t.status === TILE_STATES.FAILED && t.retryable);
      if (retryTiles.length > 0) {
        await processTileList(retryTiles, 'retry');
      }
    }

    if (state.status === JOB_STATES.RUNNING) {
      updateCounts(state);
      state.currentTileIndex = -1;
      state.currentTileId = null;
      state.completedAt = Date.now();
      state.status = state.totalFailed > 0 ? JOB_STATES.FAILED : JOB_STATES.COMPLETED;
      sampleMemory(state, { label: 'job_completed', force: true });
      checkpoint(state);
    }
  } finally {
    sampleMemory(state, { label: 'job_finally', force: true });
    checkpoint(state);
    queues.close();
    uninstallFetchCache();
  }
}

export function estimateTimeRemaining(state) {
  if (!state.tileCompletionTimes?.length) return null;

  const avg = state.tileCompletionTimes.reduce((a, b) => a + b, 0) / state.tileCompletionTimes.length;
  const remaining = state.tiles.filter(t =>
    t.status === TILE_STATES.QUEUED || t.status === TILE_STATES.PROCESSING,
  ).length;
  return Math.round(avg * remaining);
}

export function formatDuration(ms) {
  if (!ms || ms < 0) return '—';
  const seconds = Math.floor(ms / 1000) % 60;
  const minutes = Math.floor(ms / 60000) % 60;
  const hours = Math.floor(ms / 3600000);

  if (hours > 0) return `${hours}h ${minutes}m ${seconds}s`;
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}
