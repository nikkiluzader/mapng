/**
 * Surrounding Tiles Service
 * 
 * Generates lightweight adjacent terrain tiles for out-of-bounds / background
 * scenery in game engines. Uses standard 30m elevation data and selectable
 * satellite quality. No OSM data, no high-res elevation sources.
 * 
 * Key optimization: fetches tiles for the combined bounding box of ALL selected
 * positions in one pass, then extracts per-position data from shared canvases.
 */

import { project, TERRAIN_ZOOM, fetchTerrainData } from './terrain';
import { encode } from 'fast-png';
import JSZip from 'jszip';

// --- Constants ---

const TILE_SIZE = 256;
const TILE_API_URL = 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium';
const SATELLITE_API_URL =
  'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile';
const NO_DATA_VALUE = -99999;

// Position definitions with lat/lng offset multipliers
// dLat: +1 = north, -1 = south
// dLng: +1 = east,  -1 = west
export const POSITIONS = [
  { key: 'NW', label: '1', dLat: +1, dLng: -1 },
  { key: 'N',  label: '2', dLat: +1, dLng:  0 },
  { key: 'NE', label: '3', dLat: +1, dLng: +1 },
  { key: 'W',  label: '4', dLat:  0, dLng: -1 },
  { key: 'E',  label: '5', dLat:  0, dLng: +1 },
  { key: 'SW', label: '6', dLat: -1, dLng: -1 },
  { key: 'S',  label: '7', dLat: -1, dLng:  0 },
  { key: 'SE', label: '8', dLat: -1, dLng: +1 },
];

// Grid layout order (for rendering the 3×3 UI grid)
export const GRID_ORDER = ['NW', 'N', 'NE', 'W', 'CENTER', 'E', 'SW', 'S', 'SE'];

// Satellite quality presets
export const SATELLITE_QUALITY = [
  { value: 13, label: 'Low',      desc: '~19m/px, fastest' },
  { value: 14, label: 'Medium',   desc: '~10m/px, balanced' },
  { value: 15, label: 'Standard', desc: '~5m/px, best quality' },
];

// Number → compass label map
export const POSITION_LABELS = {
  NW: '1', N: '2', NE: '3',
  W:  '4',          E:  '5',
  SW: '6', S: '7', SE: '8',
};

// --- Helpers ---

const loadImage = (url, signal) =>
  new Promise((resolve) => {
    if (signal?.aborted) { resolve(null); return; }
    const img = new Image();
    img.crossOrigin = 'Anonymous';
    const onAbort = () => { img.src = ''; resolve(null); };
    signal?.addEventListener('abort', onAbort, { once: true });
    img.onload = () => { signal?.removeEventListener('abort', onAbort); resolve(img); };
    img.onerror = () => { signal?.removeEventListener('abort', onAbort); resolve(null); };
    img.src = url;
  });

/**
 * Compute adjacent tile bounds by shifting center bounds.
 */
export const getAdjacentBounds = (centerBounds, positionKey) => {
  const pos = POSITIONS.find(p => p.key === positionKey);
  if (!pos) throw new Error(`Invalid position: ${positionKey}`);

  const latSpan = centerBounds.north - centerBounds.south;
  const lngSpan = centerBounds.east - centerBounds.west;

  return {
    north: centerBounds.north + pos.dLat * latSpan,
    south: centerBounds.south + pos.dLat * latSpan,
    east:  centerBounds.east  + pos.dLng * lngSpan,
    west:  centerBounds.west  + pos.dLng * lngSpan,
  };
};

/**
 * Decode Terrarium-encoded RGB pixel to elevation in meters.
 * Mapzen/Terrarium encoding: height = R*256 + G + B/256 - 32768
 */
const terrariumHeight = (r, g, b) => {
  const h = r * 256 + g + b / 256 - 32768;
  return h <= -32760 ? NO_DATA_VALUE : h;
};

/**
 * Suppress isolated elevation outliers that can appear in global Terrarium data
 * and produce extreme spikes in low-detail backdrop meshes.
 *
 * Strategy: compare each sample to the median of its 8-neighbour hood and
 * replace only when the deviation is implausibly large.
 */
const suppressHeightSpikes = (heightMap, width, height, minHeight, maxHeight) => {
  if (!heightMap || width < 3 || height < 3) return 0;

  // Keep this conservative so real cliffs/ridges are preserved.
  const range = Math.max(1, maxHeight - minHeight);
  const spikeDelta = Math.max(180, range * 0.6);

  const out = new Float32Array(heightMap);
  const neighbors = new Float32Array(8);
  let replaced = 0;

  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const idx = y * width + x;
      const value = heightMap[idx];
      if (!Number.isFinite(value) || value === NO_DATA_VALUE) continue;

      let count = 0;
      for (let oy = -1; oy <= 1; oy++) {
        for (let ox = -1; ox <= 1; ox++) {
          if (ox === 0 && oy === 0) continue;
          const n = heightMap[(y + oy) * width + (x + ox)];
          if (!Number.isFinite(n) || n === NO_DATA_VALUE) continue;
          neighbors[count++] = n;
        }
      }

      if (count < 5) continue;

      const sorted = Array.from(neighbors.subarray(0, count)).sort((a, b) => a - b);
      const median = sorted[Math.floor(count / 2)];
      if (Math.abs(value - median) > spikeDelta) {
        out[idx] = median;
        replaced++;
      }
    }
  }

  if (replaced > 0) {
    heightMap.set(out);
  }
  return replaced;
};

// --- Main Pipeline ---

/**
 * Fetch and process all selected surrounding tiles efficiently.
 * 
 * Computes the combined bounding box, fetches all map tiles once,
 * then extracts per-position heightmaps and satellite textures.
 * 
 * @param {Object} centerBounds  - { north, south, east, west } of the center tile
 * @param {string[]} selectedPositions - Array of position keys: ['NW', 'N', ...]
 * @param {number} resolution - Center tile resolution (pixels = meters)
 * @param {number} satelliteZoom - Zoom level for satellite tiles (13-15)
 * @param {Function} onProgress - Progress callback
 * @param {AbortSignal} signal - Abort signal for cancellation
 * @returns {Object} Map of position → tile data
 */
export const fetchSurroundingTiles = async (
  centerBounds,
  selectedPositions,
  resolution,
  satelliteZoom = 14,
  onProgress,
  signal,
  options = {},
) => {
  if (!selectedPositions.length) return {};

  const outputSize = resolution;
  const includeSatellite = options?.includeSatellite !== false;
  const useNativeTerrainGrid = options?.useNativeTerrainGrid === true;
  const elevationSource = options?.elevationSource || 'global30m'; // global30m | usgs1m | gpxz
  const gpxzApiKey = options?.gpxzApiKey || '';
  const onDownloadProgress = typeof options?.onDownloadProgress === 'function'
    ? options.onDownloadProgress
    : null;

  // 1. Compute per-position bounds and combined bbox
  const allBounds = {};
  let combined = null;

  for (const pos of selectedPositions) {
    const b = getAdjacentBounds(centerBounds, pos);
    allBounds[pos] = b;
    if (!combined) {
      combined = { ...b };
    } else {
      combined.north = Math.max(combined.north, b.north);
      combined.south = Math.min(combined.south, b.south);
      combined.east  = Math.max(combined.east, b.east);
      combined.west  = Math.min(combined.west, b.west);
    }
  }

  // Non-global sources reuse the existing terrain pipeline per surrounding tile.
  // This is slower than the stitched Terrarium pass, but gives users access to
  // higher-quality elevation sources for backdrop generation.
  if (elevationSource !== 'global30m') {
    if (elevationSource === 'gpxz' && !gpxzApiKey) {
      throw new Error('GPXZ key is required for GPXZ surrounding tile source.');
    }

    const results = {};
    let posIdx = 0;

    for (const pos of selectedPositions) {
      signal?.throwIfAborted();
      posIdx++;
      onProgress?.(`Fetching ${elevationSource.toUpperCase()} data for tile ${pos} (${posIdx}/${selectedPositions.length})...`);

      const b = allBounds[pos];
      const tileCenter = {
        lat: (b.north + b.south) / 2,
        lng: (b.east + b.west) / 2,
      };

      const td = await fetchTerrainData(
        tileCenter,
        outputSize,
        false,
        elevationSource === 'usgs1m',
        elevationSource === 'gpxz',
        elevationSource === 'gpxz' ? gpxzApiKey : '',
        undefined,
        undefined,
        signal,
        {
          keepSourceGeoTiffs: false,
          generateOSMTextureAsset: false,
          generateHybridTextureAsset: false,
          globalTileConcurrency: 10,
        },
      );

      let validSamples = 0;
      let noDataSamples = 0;
      for (let i = 0; i < td.heightMap.length; i++) {
        const h = td.heightMap[i];
        if (Number.isFinite(h) && h !== NO_DATA_VALUE) validSamples++;
        else noDataSamples++;
      }
      const totalSamples = validSamples + noDataSamples;
      const noDataRatio = totalSamples > 0 ? noDataSamples / totalSamples : 1;

      results[pos] = {
        heightMap: td.heightMap,
        bounds: b,
        width: td.width,
        height: td.height,
        minHeight: td.minHeight,
        maxHeight: td.maxHeight,
        satelliteDataUrl: includeSatellite ? td.satelliteTextureUrl : null,
        diagnostics: {
          validSamples,
          noDataSamples,
          totalSamples,
          noDataRatio,
          allInvalid: validSamples === 0,
          source: elevationSource,
        },
      };
    }

    return results;
  }

  // 2. Calculate terrain tile range (Z15) for combined area
  signal?.throwIfAborted();
  onProgress?.('Calculating tile coverage...');

  const tNW = project(combined.north, combined.west, TERRAIN_ZOOM);
  const tSE = project(combined.south, combined.east, TERRAIN_ZOOM);

  const tMinTX = Math.floor(tNW.x / TILE_SIZE);
  const tMinTY = Math.floor(tNW.y / TILE_SIZE);
  const tMaxTX = Math.floor(tSE.x / TILE_SIZE);
  const tMaxTY = Math.floor(tSE.y / TILE_SIZE);

  const tCanvas = document.createElement('canvas');
  tCanvas.width  = (tMaxTX - tMinTX + 1) * TILE_SIZE;
  tCanvas.height = (tMaxTY - tMinTY + 1) * TILE_SIZE;
  const tCtx = tCanvas.getContext('2d', { willReadFrequently: true });

  // 3. Calculate satellite tile range for combined area (optional)
  let sMinTX = 0;
  let sMinTY = 0;
  let sMaxTX = -1;
  let sMaxTY = -1;
  let sCanvas = null;
  let sCtx = null;

  if (includeSatellite) {
    const sNW = project(combined.north, combined.west, satelliteZoom);
    const sSE = project(combined.south, combined.east, satelliteZoom);

    sMinTX = Math.floor(sNW.x / TILE_SIZE);
    sMinTY = Math.floor(sNW.y / TILE_SIZE);
    sMaxTX = Math.floor(sSE.x / TILE_SIZE);
    sMaxTY = Math.floor(sSE.y / TILE_SIZE);

    sCanvas = document.createElement('canvas');
    sCanvas.width  = (sMaxTX - sMinTX + 1) * TILE_SIZE;
    sCanvas.height = (sMaxTY - sMinTY + 1) * TILE_SIZE;
    sCtx = sCanvas.getContext('2d');
  }

  // 4. Build fetch request list
  const requests = [];

  for (let tx = tMinTX; tx <= tMaxTX; tx++) {
    for (let ty = tMinTY; ty <= tMaxTY; ty++) {
      requests.push({ tx, ty, type: 'terrain' });
    }
  }

  if (includeSatellite) {
    for (let tx = sMinTX; tx <= sMaxTX; tx++) {
      for (let ty = sMinTY; ty <= sMaxTY; ty++) {
        requests.push({ tx, ty, type: 'satellite' });
      }
    }
  }

  const terrainCount = requests.filter(r => r.type === 'terrain').length;
  const satCount = requests.length - terrainCount;
  let completedTerrain = 0;
  let completedSatellite = 0;

  const publishDownloadProgress = () => {
    onDownloadProgress?.({
      completedTerrain,
      totalTerrain: terrainCount,
      completedSatellite,
      totalSatellite: satCount,
      includeSatellite,
      completedTotal: completedTerrain + completedSatellite,
      total: requests.length,
    });
  };

  publishDownloadProgress();

  if (includeSatellite) {
    onProgress?.(`Downloading ${terrainCount} terrain + ${satCount} satellite tiles...`);
  } else {
    onProgress?.(`Downloading ${terrainCount} terrain tiles...`);
  }

  // 5. Fetch in batches with controlled concurrency
  const BATCH_SIZE = 20;
  let completed = 0;

  for (let i = 0; i < requests.length; i += BATCH_SIZE) {
    signal?.throwIfAborted();
    const batch = requests.slice(i, i + BATCH_SIZE);

    await Promise.all(batch.map(async ({ tx, ty, type }) => {
      if (type === 'terrain') {
        const numTiles = Math.pow(2, TERRAIN_ZOOM);
        const wrappedTx = ((tx % numTiles) + numTiles) % numTiles;
        const url = `${TILE_API_URL}/${TERRAIN_ZOOM}/${wrappedTx}/${ty}.png`;
        const img = await loadImage(url, signal);
        const dx = (tx - tMinTX) * TILE_SIZE;
        const dy = (ty - tMinTY) * TILE_SIZE;
        if (img) tCtx.drawImage(img, dx, dy);
        else { tCtx.fillStyle = 'black'; tCtx.fillRect(dx, dy, TILE_SIZE, TILE_SIZE); }
        completedTerrain++;
      } else if (includeSatellite && sCtx) {
        const numTiles = Math.pow(2, satelliteZoom);
        const wrappedTx = ((tx % numTiles) + numTiles) % numTiles;
        const url = `${SATELLITE_API_URL}/${satelliteZoom}/${ty}/${wrappedTx}`;
        const img = await loadImage(url, signal);
        const dx = (tx - sMinTX) * TILE_SIZE;
        const dy = (ty - sMinTY) * TILE_SIZE;
        if (img) sCtx.drawImage(img, dx, dy);
        else { sCtx.fillStyle = '#1a1a1a'; sCtx.fillRect(dx, dy, TILE_SIZE, TILE_SIZE); }
        completedSatellite++;
      }
      completed++;
    }));

    publishDownloadProgress();
    onProgress?.(`Downloaded ${completed}/${requests.length} tiles...`);
  }

  // 6. Read terrain pixel data once (shared across all positions)
  const terrainImgData = tCtx.getImageData(0, 0, tCanvas.width, tCanvas.height);
  const terrainWidth = terrainImgData.width;
  const terrainHeight = terrainImgData.height;

  const getTerrainHeightAt = (x, y) => {
    const cx = Math.max(0, Math.min(terrainWidth - 1, x));
    const cy = Math.max(0, Math.min(terrainHeight - 1, y));
    const i = (cy * terrainWidth + cx) * 4;
    return terrariumHeight(
      terrainImgData.data[i],
      terrainImgData.data[i + 1],
      terrainImgData.data[i + 2],
    );
  };

  const sampleTerrainBilinear = (sx, sy) => {
    const x0 = Math.floor(sx);
    const y0 = Math.floor(sy);
    const dx = sx - x0;
    const dy = sy - y0;

    const h00 = getTerrainHeightAt(x0, y0);
    const h10 = getTerrainHeightAt(x0 + 1, y0);
    const h01 = getTerrainHeightAt(x0, y0 + 1);
    const h11 = getTerrainHeightAt(x0 + 1, y0 + 1);

    if (h00 !== NO_DATA_VALUE && h10 !== NO_DATA_VALUE && h01 !== NO_DATA_VALUE && h11 !== NO_DATA_VALUE) {
      const top = (1 - dx) * h00 + dx * h10;
      const bot = (1 - dx) * h01 + dx * h11;
      return (1 - dy) * top + dy * bot;
    }

    let sum = 0;
    let count = 0;
    if (h00 !== NO_DATA_VALUE) { sum += h00; count++; }
    if (h10 !== NO_DATA_VALUE) { sum += h10; count++; }
    if (h01 !== NO_DATA_VALUE) { sum += h01; count++; }
    if (h11 !== NO_DATA_VALUE) { sum += h11; count++; }
    return count > 0 ? (sum / count) : NO_DATA_VALUE;
  };

  // 7. Extract per-position data from shared canvases
  const results = {};
  let posIdx = 0;

  for (const pos of selectedPositions) {
    signal?.throwIfAborted();
    posIdx++;
    onProgress?.(`Processing tile ${pos} (${posIdx}/${selectedPositions.length})...`);

    const bounds = allBounds[pos];
    const tileTopLeft = project(bounds.north, bounds.west, TERRAIN_ZOOM);
    const tileBottomRight = project(bounds.south, bounds.east, TERRAIN_ZOOM);
    const terrainSrcX = tileTopLeft.x - tMinTX * TILE_SIZE;
    const terrainSrcY = tileTopLeft.y - tMinTY * TILE_SIZE;
    const terrainSrcW = tileBottomRight.x - tileTopLeft.x;
    const terrainSrcH = tileBottomRight.y - tileTopLeft.y;

    const outputWidth = outputSize;
    const outputHeight = outputSize;

    // --- Heightmap: bilinear sampling from terrain canvas ---
    const heightMap = new Float32Array(outputWidth * outputHeight);
    let minH = Infinity, maxH = -Infinity;
    let validSamples = 0;
    let noDataSamples = 0;

    for (let py = 0; py < outputHeight; py++) {
      for (let px = 0; px < outputWidth; px++) {
        let elev;

        if (useNativeTerrainGrid) {
          const u = (px + 0.5) / outputWidth;
          const v = (py + 0.5) / outputHeight;
          const sx = terrainSrcX + u * terrainSrcW;
          const sy = terrainSrcY + v * terrainSrcH;
          elev = sampleTerrainBilinear(sx, sy);
        } else {
          const u = (px + 0.5) / outputWidth;
          const v = (py + 0.5) / outputHeight;
          const lat = bounds.north - v * (bounds.north - bounds.south);
          const lng = bounds.west + u * (bounds.east - bounds.west);

          const p = project(lat, lng, TERRAIN_ZOOM);
          const lx = p.x - tMinTX * TILE_SIZE;
          const ly = p.y - tMinTY * TILE_SIZE;
          elev = sampleTerrainBilinear(lx, ly);
        }

        heightMap[py * outputWidth + px] = elev;
        if (Number.isFinite(elev) && elev !== NO_DATA_VALUE) {
          validSamples++;
          if (elev < minH) minH = elev;
          if (elev > maxH) maxH = elev;
        } else {
          noDataSamples++;
        }
      }
    }

    const totalSamples = validSamples + noDataSamples;
    const noDataRatio = totalSamples > 0 ? noDataSamples / totalSamples : 1;
    if (minH === Infinity) minH = 0;
    if (maxH === -Infinity) maxH = minH;

    if (noDataSamples > 0) {
      // Prevent invalid elevations from creating extreme meshes by filling with the tile baseline.
      for (let i = 0; i < heightMap.length; i++) {
        if (!Number.isFinite(heightMap[i]) || heightMap[i] === NO_DATA_VALUE) {
          heightMap[i] = minH;
        }
      }
    }

    const spikeReplacements = suppressHeightSpikes(heightMap, outputWidth, outputHeight, minH, maxH);

    let satelliteDataUrl = null;
    if (includeSatellite && sCanvas) {
      const outSat = document.createElement('canvas');
      outSat.width = outputWidth;
      outSat.height = outputHeight;
      const outCtx = outSat.getContext('2d');

      const tl = project(bounds.north, bounds.west, satelliteZoom);
      const br = project(bounds.south, bounds.east, satelliteZoom);
      const srcX = tl.x - sMinTX * TILE_SIZE;
      const srcY = tl.y - sMinTY * TILE_SIZE;
      const srcW = br.x - tl.x;
      const srcH = br.y - tl.y;

      outCtx.drawImage(sCanvas, srcX, srcY, srcW, srcH, 0, 0, outputWidth, outputHeight);
      satelliteDataUrl = outSat.toDataURL('image/jpeg', 0.85);
    }

    results[pos] = {
      heightMap,
      bounds,
      width: outputWidth,
      height: outputHeight,
      minHeight: minH,
      maxHeight: maxH,
      satelliteDataUrl,
      diagnostics: {
        validSamples,
        noDataSamples,
        totalSamples,
        noDataRatio,
        allInvalid: validSamples === 0,
        spikeReplacements,
      },
    };
  }

  return results;
};

// --- ZIP Packaging ---

/**
 * Package surrounding tile results into a downloadable ZIP file.
 * 
 * Each tile gets:
 *   - 16-bit PNG heightmap (normalized to its own min/max range)
 *   - Satellite texture (JPG)
 *   - Metadata JSON with bounds, height range, and scale info
 */
export const downloadSurroundingTilesZip = async (
  results,
  centerBounds,
  center,
  resolution,
  onProgress,
) => {
  const zip = new JSZip();
  const outputSize = resolution;
  const mpp = 1.0;
  const entries = Object.entries(results);

  for (let i = 0; i < entries.length; i++) {
    const [pos, data] = entries[i];
    onProgress?.(`Packaging tile ${pos} (${i + 1}/${entries.length})...`);

    // Encode heightmap as 16-bit PNG
    const range = data.maxHeight - data.minHeight;
    const hData = new Uint16Array(outputSize * outputSize);

    for (let j = 0; j < data.heightMap.length; j++) {
      let val = range > 0
        ? Math.floor(((data.heightMap[j] - data.minHeight) / range) * 65535)
        : 0;
      hData[j] = Math.max(0, Math.min(65535, val));
    }

    const pngBytes = encode({
      width: outputSize,
      height: outputSize,
      data: hData,
      depth: 16,
      channels: 1,
    });

    const label = POSITION_LABELS[pos] || pos;
    zip.file(`Tile${label}_${pos}_Heightmap_${outputSize}px.png`, new Uint8Array(pngBytes));

    // Satellite texture
    const satResp = await fetch(data.satelliteDataUrl);
    const satBlob = await satResp.blob();
    zip.file(`Tile${label}_${pos}_Satellite_${outputSize}px.jpg`, satBlob);

    // Per-tile metadata
    zip.file(`Tile${label}_${pos}_metadata.json`, JSON.stringify({
      position: pos,
      tileNumber: parseInt(label),
      bounds: data.bounds,
      outputPixels: outputSize,
      minHeight_m: Math.round(data.minHeight * 100) / 100,
      maxHeight_m: Math.round(data.maxHeight * 100) / 100,
      heightRange_m: Math.round(range * 100) / 100,
      metersPerPixel: mpp,
      areaSizeMeters: resolution,
    }, null, 2));
  }

  // Global info file
  zip.file('_tiles_info.json', JSON.stringify({
    generatedAt: new Date().toISOString(),
    centerCoordinates: center,
    centerBounds,
    centerResolution: resolution,
    tileOutputSize: resolution,
    tileAreaMeters: `${resolution}x${resolution}`,
    metersPerPixel: 1.0,
    tilesIncluded: entries.map(([pos]) => pos),
    tileLayout: [
      '1(NW)  2(N)   3(NE)',
      '4(W)   [CTR]  5(E)',
      '6(SW)  7(S)   8(SE)',
    ],
    note: 'Each heightmap is independently normalized to its own [minHeight, maxHeight] range. Use the per-tile metadata to reconstruct absolute elevation values if needed for seamless terrain stitching.',
  }, null, 2));

  onProgress?.('Compressing ZIP...');
  const blob = await zip.generateAsync({ type: 'blob' });

  const link = document.createElement('a');
  link.download = `MapNG_Surrounding_Tiles_${center.lat.toFixed(4)}_${center.lng.toFixed(4)}.zip`;
  link.href = URL.createObjectURL(blob);
  link.click();
  URL.revokeObjectURL(link.href);
};
