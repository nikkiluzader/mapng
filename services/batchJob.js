/**
 * batchJob.js — Batch job grid computation, state management, and runner.
 *
 * Processes a grid of terrain tiles sequentially. Each tile is fetched,
 * all selected exports are generated, packaged into a ZIP, and downloaded.
 * Memory is freed after each tile. State is persisted so jobs can be resumed.
 */

import JSZip from 'jszip';
import { fetchTerrainData } from './terrain.js';
import { exportToGLB, exportToDAE } from './export3d.js';
import {
  generateHeightmapBlob,
  generateSatelliteBlob,
  generateOSMTextureBlob,
  generateHybridTextureBlob,
  generateRoadMaskBlob,
  generateGeoTIFFBlob,
  generateGeoJSONBlob,
} from './batchExports.js';

// ─── Grid Computation ────────────────────────────────────────────────

/**
 * Compute tile center coordinates for each cell in the grid.
 * Row 0 is the northernmost row, col 0 is the westernmost column.
 */
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
          east:  tileLng + halfLngSpan,
          west:  tileLng - halfLngSpan,
        },
        status: 'pending',   // pending | processing | completed | failed
        error: null,
      });
    }
  }
  return tiles;
}

/**
 * Compute the overall bounding box of the entire grid.
 */
export function computeGridBounds(center, resolution, gridCols, gridRows) {
  const metersPerDegLat = 111320;
  const metersPerDegLng = 111320 * Math.cos(center.lat * Math.PI / 180);

  const totalWidth = gridCols * resolution;
  const totalHeight = gridRows * resolution;

  return {
    north: center.lat + totalHeight / 2 / metersPerDegLat,
    south: center.lat - totalHeight / 2 / metersPerDegLat,
    east:  center.lng + totalWidth / 2 / metersPerDegLng,
    west:  center.lng - totalWidth / 2 / metersPerDegLng,
  };
}

// ─── State Management ────────────────────────────────────────────────

const STORAGE_KEY = 'mapng_batch_state';

/**
 * Create a new batch job state from configuration.
 */
export function createBatchJobState(config) {
  const tiles = computeGridTiles(config.center, config.resolution, config.gridCols, config.gridRows);
  return {
    id: `batch_${Date.now()}`,
    center: { ...config.center },
    resolution: config.resolution,
    gridCols: config.gridCols,
    gridRows: config.gridRows,

    exports: { ...config.exports },

    includeOSM: config.includeOSM,
    elevationSource: config.elevationSource,
    gpxzApiKey: config.gpxzApiKey || '',
    glbMeshResolution: config.glbMeshResolution || 512,

    status: 'idle',          // idle | running | paused | completed | completed_with_errors
    currentTileIndex: -1,
    tiles,
    startedAt: null,
    completedAt: null,
    totalCompleted: 0,
    totalFailed: 0,
    tileCompletionTimes: [],  // ms per completed tile, for ETA calculation
  };
}

export function saveBatchState(state) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // localStorage might be full — not critical
    console.warn('[Batch] Could not persist batch state to localStorage');
  }
}

export function loadBatchState() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    return saved ? JSON.parse(saved) : null;
  } catch {
    return null;
  }
}

export function clearBatchState() {
  localStorage.removeItem(STORAGE_KEY);
}

/**
 * Reset failed tiles to 'pending' for retry.
 */
export function resetFailedTiles(state) {
  for (const tile of state.tiles) {
    if (tile.status === 'failed') {
      tile.status = 'pending';
      tile.error = null;
    }
  }
  state.status = 'idle';
  state.totalFailed = 0;
  saveBatchState(state);
}

// ─── Download Helper ─────────────────────────────────────────────────

function triggerDownload(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  // Small delay before revoking so the browser can start the download
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

/**
 * Generate a small thumbnail data URL from terrain data for the progress grid.
 * Uses satellite texture if available, falls back to heightmap grayscale.
 */
function generateTileSnapshot(terrainData) {
  const size = 64;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  try {
    // Try satellite texture first
    if (terrainData.satelliteTextureUrl) {
      const img = new Image();
      img.src = terrainData.satelliteTextureUrl;
      // If already loaded (data URL), draw synchronously
      if (img.complete && img.naturalWidth > 0) {
        ctx.drawImage(img, 0, 0, size, size);
        return canvas.toDataURL('image/jpeg', 0.6);
      }
    }

    // Fallback: heightmap grayscale
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
      return canvas.toDataURL('image/jpeg', 0.6);
    }
  } catch {
    // Snapshot generation is non-critical
  }
  return null;
}

// ─── Batch Job Runner ────────────────────────────────────────────────

/**
 * Run a batch job, processing tiles sequentially.
 *
 * @param {Object} state     - Mutable batch job state (will be updated in-place)
 * @param {Function} onProgress - Called with { tileIndex, step, tile } on each progress update
 * @param {Function} onTileComplete - Called with tile object when a tile finishes
 * @param {Function} onError  - Called with (tile, error) when a tile fails
 * @param {AbortSignal} signal - For cancellation
 */
export async function runBatchJob(state, onProgress, onTileComplete, onError, signal) {
  state.status = 'running';
  if (!state.startedAt) state.startedAt = Date.now();
  saveBatchState(state);

  for (let i = 0; i < state.tiles.length; i++) {
    const tile = state.tiles[i];

    // Skip completed tiles (supports resume)
    if (tile.status === 'completed') continue;

    // Check for cancellation
    if (signal?.aborted) {
      tile.status = tile.status === 'processing' ? 'pending' : tile.status;
      state.status = 'paused';
      saveBatchState(state);
      return;
    }

    state.currentTileIndex = i;
    tile.status = 'processing';
    tile.error = null;
    const tileStartTime = Date.now();

    const label = `R${tile.row + 1}C${tile.col + 1}`;
    onProgress({ tileIndex: i, step: `Starting tile ${label}...`, tile });

    try {
      // ── 1. Fetch terrain data ────────────────────────────
      onProgress({ tileIndex: i, step: 'Fetching terrain data...', tile });

      const terrainData = await fetchTerrainData(
        tile.center,
        state.resolution,
        state.includeOSM,
        state.elevationSource === 'usgs',
        state.elevationSource === 'gpxz',
        state.gpxzApiKey,
        undefined,
        (status) => onProgress({ tileIndex: i, step: status, tile }),
        signal
      );

      // Check for abort after long fetch
      if (signal?.aborted) {
        tile.status = 'pending';
        state.status = 'paused';
        saveBatchState(state);
        return;
      }

      // ── 2. Generate exports and package into ZIP ─────────
      onProgress({ tileIndex: i, step: 'Packaging exports...', tile });
      const zip = new JSZip();

      // Tile metadata
      zip.file('metadata.json', JSON.stringify({
        batchId: state.id,
        row: tile.row,
        col: tile.col,
        label,
        center: tile.center,
        resolution: state.resolution,
        bounds: terrainData.bounds,
        minHeight: terrainData.minHeight,
        maxHeight: terrainData.maxHeight,
        gridPosition: `Row ${tile.row + 1} of ${state.gridRows}, Col ${tile.col + 1} of ${state.gridCols}`,
        elevationSource: state.elevationSource,
        includeOSM: state.includeOSM,
        generatedAt: new Date().toISOString(),
      }, null, 2));

      // Heightmap
      if (state.exports.heightmap) {
        onProgress({ tileIndex: i, step: 'Generating heightmap...', tile });
        const blob = generateHeightmapBlob(terrainData);
        if (blob) zip.file('heightmap_16bit.png', blob);
      }

      // Satellite
      if (state.exports.satellite) {
        onProgress({ tileIndex: i, step: 'Generating satellite texture...', tile });
        const blob = await generateSatelliteBlob(terrainData);
        if (blob) zip.file('satellite.png', blob);
      }

      // OSM Texture
      if (state.exports.osmTexture && terrainData.osmTextureUrl) {
        onProgress({ tileIndex: i, step: 'Generating OSM texture...', tile });
        const blob = await generateOSMTextureBlob(terrainData);
        if (blob) zip.file('osm_texture.png', blob);
      }

      // Hybrid Texture
      if (state.exports.hybridTexture && terrainData.hybridTextureUrl) {
        onProgress({ tileIndex: i, step: 'Generating hybrid texture...', tile });
        const blob = await generateHybridTextureBlob(terrainData);
        if (blob) zip.file('hybrid_texture.png', blob);
      }

      // Road Mask
      if (state.exports.roadMask && terrainData.osmFeatures?.length > 0) {
        onProgress({ tileIndex: i, step: 'Generating road mask...', tile });
        const blob = generateRoadMaskBlob(terrainData, tile.center);
        if (blob) zip.file('road_mask_16bit.png', blob);
      }

      // GLB Model (no surroundings for batch — adjacent tiles ARE the surroundings)
      if (state.exports.glb) {
        onProgress({ tileIndex: i, step: 'Generating GLB model...', tile });
        const blob = await exportToGLB(terrainData, {
          maxMeshResolution: state.glbMeshResolution,
          includeSurroundings: false,
          returnBlob: true,
          onProgress: (s) => onProgress({ tileIndex: i, step: s, tile }),
        });
        if (blob) zip.file('model.glb', blob);
      }

      // DAE Model
      if (state.exports.dae) {
        onProgress({ tileIndex: i, step: 'Generating Collada DAE model...', tile });
        const blob = await exportToDAE(terrainData, {
          maxMeshResolution: state.glbMeshResolution,
          includeSurroundings: false,
          returnBlob: true,
          onProgress: (s) => onProgress({ tileIndex: i, step: s, tile }),
        });
        if (blob) zip.file('model.dae.zip', blob);
      }

      // GeoTIFF
      if (state.exports.geotiff) {
        onProgress({ tileIndex: i, step: 'Generating GeoTIFF...', tile });
        const blob = await generateGeoTIFFBlob(terrainData, tile.center);
        if (blob) zip.file('heightmap.tif', blob);
      }

      // GeoJSON
      if (state.exports.geojson && terrainData.osmFeatures?.length > 0) {
        onProgress({ tileIndex: i, step: 'Generating GeoJSON...', tile });
        const blob = generateGeoJSONBlob(terrainData);
        if (blob) zip.file('features.geojson', blob);
      }

      // ── 3. Generate and download the ZIP ─────────────────
      onProgress({ tileIndex: i, step: 'Creating ZIP archive...', tile });
      let zipBlob;
      try {
        zipBlob = await zip.generateAsync({ type: 'blob' });
      } catch (zipErr) {
        console.error(`[Batch] ZIP generation failed for ${label}:`, zipErr);
        // Retry with arraybuffer fallback (avoids browser Blob size limits)
        try {
          const buf = await zip.generateAsync({ type: 'arraybuffer' });
          zipBlob = new Blob([buf], { type: 'application/zip' });
        } catch (retryErr) {
          throw new Error(`ZIP too large for ${label} — try a smaller tile resolution or disable 3D exports. (${retryErr.message})`);
        }
      }

      const date = new Date().toISOString().slice(0, 10);
      triggerDownload(zipBlob, `MapNG_Batch_${label}_${date}.zip`);

      // ── 4. Generate thumbnail snapshot ───────────────────
      tile.snapshot = generateTileSnapshot(terrainData);

      // ── 5. Mark tile as completed ────────────────────────
      tile.status = 'completed';
      state.totalCompleted++;

      const elapsed = Date.now() - tileStartTime;
      state.tileCompletionTimes.push(elapsed);

      onTileComplete(tile);

      // ── 6. Aggressive memory cleanup ─────────────────────
      // Null out all large data references
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
      if (terrainData.osmTextureUrl) {
        URL.revokeObjectURL(terrainData.osmTextureUrl);
        terrainData.osmTextureUrl = null;
      }
      if (terrainData.hybridTextureUrl) {
        URL.revokeObjectURL(terrainData.hybridTextureUrl);
        terrainData.hybridTextureUrl = null;
      }
      terrainData.osmFeatures = null;
      terrainData.sourceGeoTiffs = null;
      terrainData.satelliteTextureUrl = null;

      // Allow GC before next tile
      await new Promise(r => setTimeout(r, 300));

      saveBatchState(state);

    } catch (error) {
      if (error.name === 'AbortError' || signal?.aborted) {
        tile.status = 'pending';
        state.status = 'paused';
        saveBatchState(state);
        return;
      }

      console.error(`[Batch] Tile ${label} failed:`, error);
      tile.status = 'failed';
      tile.error = error.message || 'Unknown error';
      state.totalFailed++;
      onError(tile, error);

      // Clean up any partial data
      await new Promise(r => setTimeout(r, 200));
      saveBatchState(state);
      // Continue to next tile
    }
  }

  // ── Batch complete ───────────────────────────────────────
  state.currentTileIndex = -1;
  state.completedAt = Date.now();
  state.status = state.totalFailed > 0 ? 'completed_with_errors' : 'completed';
  saveBatchState(state);
}

/**
 * Calculate estimated time remaining based on average tile completion times.
 */
export function estimateTimeRemaining(state) {
  if (!state.tileCompletionTimes.length) return null;

  const avg = state.tileCompletionTimes.reduce((a, b) => a + b, 0) / state.tileCompletionTimes.length;
  const remaining = state.tiles.filter(t => t.status === 'pending' || t.status === 'processing').length;
  return Math.round(avg * remaining);
}

/**
 * Format milliseconds to human-readable string.
 */
export function formatDuration(ms) {
  if (!ms || ms < 0) return '—';
  const seconds = Math.floor(ms / 1000) % 60;
  const minutes = Math.floor(ms / 60000) % 60;
  const hours = Math.floor(ms / 3600000);

  if (hours > 0) return `${hours}h ${minutes}m ${seconds}s`;
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}
