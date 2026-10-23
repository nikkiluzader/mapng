/**
 * Manages a resampler Web Worker and provides a Promise-based API.
 * Falls back to main-thread resampling if workers are unavailable.
 */
import proj4 from 'proj4';
import { resampleToMeterGrid, resampleImageToMeterGrid } from './terrainResampler.js';

let worker = null;
let messageId = 0;
const pendingMessages = new Map();

/**
 * Lazily create (or return existing) worker instance.
 */
const getWorker = () => {
    if (worker) return worker;
    try {
        worker = new Worker(
            new URL('./resamplerWorker.js', import.meta.url),
            { type: 'module' }
        );
        worker.onmessage = (e) => {
            const { id, type, error, ...data } = e.data;
            const pending = pendingMessages.get(id);
            if (!pending) return;
            if (type === 'progress') {
                pending.onProgress?.(data);
                return;
            }
            pendingMessages.delete(id);
            if (type === 'error') pending.reject(new Error(error));
            else pending.resolve(data);
        };
        worker.onerror = (e) => {
            console.error('[ResamplerClient] Uncaught error:', e);
            // Reject all pending, force recreation on next call
            for (const [, p] of pendingMessages) p.reject(new Error('Worker error'));
            pendingMessages.clear();
            worker.terminate();
            worker = null;
        };
        return worker;
    } catch (e) {
        console.warn('[ResamplerClient] Failed to create worker, falling back to main thread:', e);
        return null;
    }
};

// ── Worker-side upload raster cache ─────────────────────────────────────────
// Uploaded GeoTIFF rasters can run to GBs (16 DEFRA tiles ≈ 1.6 GB) and used
// to be re-cloned and re-transferred on every preview/generate run. Instead,
// the first run transfers them once with {mode:'store', key}; repeat runs
// against the same source array ping the worker ('hasRasterCache') and, on a
// hit, send raster-less tile metadata with {mode:'use', key}. The worker
// keeps at most one raster set ('store' evicts), so a new upload replaces the
// old one. Grid (ASC) uploads are excluded: their source.data is rebuilt per
// run, so there is no stable identity to key on.
let uploadRasterCacheState = null; // { sourceData, key }
let uploadRasterCacheSeq = 0;

const workerHasRasterCache = async (key) => {
    try {
        const res = await postToWorker({ type: 'hasRasterCache', key });
        return res?.has === true;
    } catch {
        return false;
    }
};

/**
 * Drop the worker-resident upload raster cache (call when the user removes
 * or replaces their uploaded elevation files, so up to ~GBs are freed without
 * waiting for the next 'store' to evict).
 */
export const releaseUploadRasterCache = async () => {
    uploadRasterCacheState = null;
    if (!worker) return;
    try {
        await postToWorker({ type: 'releaseRasterCache' });
    } catch {
        // worker gone — nothing resident anyway
    }
};

/**
 * Build the tiles payload for a resample message, cloning + transferring
 * raster buffers only when the worker does not already hold them.
 * Returns { tilesForWorker, rasterCache } — rasterCache is the directive to
 * include in the message (or null when caching does not apply).
 */
const buildTilesPayload = async (source, tiles, transferables) => {
    const transferSourceRasters = source?.transferRasters === true;
    const cacheable = !transferSourceRasters
        && source?.type === 'geotiff'
        && Array.isArray(source.data)
        && tiles.length > 0;

    if (cacheable
        && uploadRasterCacheState?.sourceData === source.data
        && await workerHasRasterCache(uploadRasterCacheState.key)) {
        console.log(`[ResamplerClient] Upload rasters: reusing worker cache (${tiles.length} tiles, no copy/transfer)`);
        return {
            tilesForWorker: tiles.map((t) => ({ ...t, raster: null })),
            rasterCache: { mode: 'use', key: uploadRasterCacheState.key },
        };
    }

    const tilesForWorker = tiles.map((t) => {
        const raster = transferSourceRasters ? t.raster : new Float32Array(t.raster);
        transferables.push(raster.buffer);
        return { ...t, raster };
    });

    if (!cacheable) return { tilesForWorker, rasterCache: null };

    const totalMB = tilesForWorker.reduce((n, t) => n + (t.raster?.byteLength || 0), 0) / (1024 * 1024);
    console.log(`[ResamplerClient] Upload rasters: transferring ${tiles.length} tiles (${totalMB.toFixed(0)} MB) into worker cache`);

    // Registered optimistically: the worker stores the rasters at message
    // receipt, before resampling, so the cache survives a failed run. If the
    // message never arrives (worker death), the next run's ping misses and we
    // store again.
    const key = `upload_${++uploadRasterCacheSeq}`;
    uploadRasterCacheState = { sourceData: source.data, key };
    return { tilesForWorker, rasterCache: { mode: 'store', key } };
};

/**
 * Post a message to the worker and return a promise for the response.
 */
const postToWorker = (message, transferables = [], options = {}) => {
    const w = getWorker();
    if (!w) return null; // signal caller to use fallback

    const id = ++messageId;
    return new Promise((resolve, reject) => {
        pendingMessages.set(id, { resolve, reject, onProgress: options.onProgress });
        w.postMessage({ ...message, id }, transferables);
    });
};

// The satellite texture is downscaled to 8192 downstream anyway, and a 16384²
// canvas hits Chromium's max canvas area (2^28 px) — at that exact limit Chrome
// silently yields a *blank* (black) canvas while Firefox still works, which is
// why satellite/hybrid exports came out black only on Chromium at 16k. So we
// never create a canvas larger than this; the full-res heightMap is separate
// and unaffected, so the .ter keeps its native resolution.
const SAT_SOURCE_MAX_SIZE = 8192;

const canvasFromRgbaBuffer = async (width, height, rgbaBuffer) => {
    const pixels = rgbaBuffer instanceof Uint8ClampedArray
        ? rgbaBuffer
        : new Uint8ClampedArray(rgbaBuffer);
    // ImageData is backed by a plain ArrayBuffer (no canvas-area limit), so it is
    // safe to build at full resolution even when width/height exceed the cap.
    const imageData = new ImageData(pixels, width, height);

    const overCap = width > SAT_SOURCE_MAX_SIZE || height > SAT_SOURCE_MAX_SIZE;
    if (overCap && typeof createImageBitmap === 'function') {
        try {
            const scale = Math.min(SAT_SOURCE_MAX_SIZE / width, SAT_SOURCE_MAX_SIZE / height);
            const outW = Math.max(1, Math.round(width * scale));
            const outH = Math.max(1, Math.round(height * scale));
            // createImageBitmap resizes off the canvas path, so no oversized
            // canvas is ever allocated.
            const bitmap = await createImageBitmap(imageData, {
                resizeWidth: outW,
                resizeHeight: outH,
                resizeQuality: 'high',
            });
            const canvas = document.createElement('canvas');
            canvas.width = outW;
            canvas.height = outH;
            canvas.getContext('2d').drawImage(bitmap, 0, 0);
            if ('close' in bitmap) bitmap.close();
            console.log(`[ResamplerClient] satellite source canvas capped ${width}x${height} → ${outW}x${outH}`);
            return canvas;
        } catch (e) {
            console.warn('[ResamplerClient] capped satellite canvas failed, using full size:', e.message);
        }
    }

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    canvas.getContext('2d').putImageData(imageData, 0, 0);
    return canvas;
};

/**
 * Build the gap-fill payload for a resample message: geo-referenced rasters
 * (e.g. GPXZ hires chunks) that the worker samples wherever the primary source
 * has no data. The Terrarium mosaic travels separately as `fallback`.
 */
const buildGapFillPayload = (gapFillData, transferables) => {
    if (!Array.isArray(gapFillData) || gapFillData.length === 0) {
        return { gapFillTiles: null, gapFillEpsgDefs: null };
    }
    const { tiles, epsgDefs } = prepareTiles(gapFillData);
    const gapFillTiles = tiles.map((t) => {
        const raster = new Float32Array(t.raster);
        transferables.push(raster.buffer);
        return { ...t, raster };
    });
    return { gapFillTiles, gapFillEpsgDefs: epsgDefs };
};

/**
 * Prepare serializable tile metadata from GeoTIFF image objects.
 * Called on main thread to extract data the worker needs.
 */
const prepareTiles = (sourceData) => {
    if (!sourceData) return { tiles: [], epsgDefs: {} };
    const tiles = [];
    const epsgDefs = {};

    for (const item of sourceData) {
        const image = item.image;
        const raster = item.raster;
        const geoKeys = image.getGeoKeys();
        const epsgCode = geoKeys.ProjectedCSTypeGeoKey || geoKeys.GeographicTypeGeoKey;

        // Capture any loaded proj4 definitions so worker doesn't need to re-fetch
        if (epsgCode) {
            const epsg = `EPSG:${epsgCode}`;
            const def = proj4.defs(epsg);
            if (def && typeof def === 'object') {
                // proj4 stores parsed defs as objects; pass the raw string if available
                epsgDefs[epsg] = def.defData || undefined;
            } else if (typeof def === 'string') {
                epsgDefs[epsg] = def;
            }
        }

        tiles.push({
            raster,
            width: image.getWidth(),
            height: image.getHeight(),
            originX: image.getOrigin()[0],
            originY: image.getOrigin()[1],
            resX: image.getResolution()[0],
            resY: image.getResolution()[1],
            // The loader resolves no-data per tile (GDAL_NODATA tag, detected
            // fill value, or user override) — only fall back to the tag when
            // the source predates that.
            noData: Number.isFinite(item.noData) ? item.noData : (image.getGDALNoData() ?? -99999),
            // Priority stack position; 0 unless the upload resolved to several
            // survey layers (see elevationLayers.js).
            layerIndex: Number.isFinite(item.layerIndex) ? item.layerIndex : 0,
            epsgCode,
        });
    }

    return { tiles, epsgDefs };
};

const prepareGridTiles = (sourceData) => {
    if (!sourceData?.tiles) return { tiles: [], epsgDefs: sourceData?.epsgDefs || {} };
    const tiles = sourceData.tiles
        .map((tile) => {
            const width = Number(tile?.width);
            const height = Number(tile?.height);
            if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 1 || height <= 1) {
                return null;
            }

            let originX = Number(tile?.originX);
            let originY = Number(tile?.originY);
            let resX = Number(tile?.resX);
            let resY = Number(tile?.resY);
            const bounds = tile?.bounds;

            // Backward compatibility: derive affine grid params from geographic bounds
            // when tile metadata predates origin/res fields.
            if (
                (!Number.isFinite(originX) || !Number.isFinite(originY) || !Number.isFinite(resX) || !Number.isFinite(resY))
                && bounds
            ) {
                const west = Number(bounds.west);
                const east = Number(bounds.east);
                const south = Number(bounds.south);
                const north = Number(bounds.north);
                if ([west, east, south, north].every(Number.isFinite)) {
                    originX = west;
                    originY = north;
                    resX = (east - west) / width;
                    resY = (south - north) / height;
                }
            }

            if (!Number.isFinite(originX) || !Number.isFinite(originY) || !Number.isFinite(resX) || !Number.isFinite(resY)) {
                return null;
            }

            const noData = Number.isFinite(tile?.noData) ? Number(tile.noData) : -99999;
            const epsgCode = Number.isFinite(tile?.epsgCode) ? Number(tile.epsgCode) : null;
            const layerIndex = Number.isFinite(tile?.layerIndex) ? Number(tile.layerIndex) : 0;
            const raster = tile?.raster instanceof Float32Array
                ? new Float32Array(tile.raster)
                : new Float32Array(tile?.raster || []);

            return {
                raster,
                width,
                height,
                originX,
                originY,
                resX,
                resY,
                noData,
                epsgCode,
                layerIndex,
            };
        })
        .filter(Boolean);

    return {
        tiles,
        epsgDefs: sourceData.epsgDefs || {},
    };
};

/**
 * Resample heightmap using Web Worker, with main-thread fallback.
 *
 * @param {object} source            - { type, data, sampler }
 * @param {object} center            - { lat, lng }
 * @param {number} width
 * @param {number} height
 * @param {string} interpolation
 * @param {boolean|number} smooth - true = coarse-data blur (radius 8), number = box radius
 * @param {object|null} fallbackData - { pixels, width, height, zoom, minTileX, minTileY }
 */
export const resampleHeightMapOffThread = async (
    source,
    center,
    width,
    height,
    interpolation,
    smooth,
    fallbackData,
    fillHoles = true,
    targetBounds = null,
    onProgress = null,
    expandFilledGaps = true,
    gapFillData = null,
) => {
    // Attempt worker path
    if (getWorker()) {
        try {
            let tiles = [];
            let epsgDefs = {};

            if (source.type === 'geotiff' && source.data) {
                const prepared = prepareTiles(source.data);
                tiles = prepared.tiles;
                epsgDefs = prepared.epsgDefs;
            } else if (source.type === 'grid' && source.data) {
                const prepared = prepareGridTiles(source.data);
                tiles = prepared.tiles;
                epsgDefs = prepared.epsgDefs;
            }

            const transferables = [];
            // Clone raster buffers for transfer only when the worker doesn't
            // already hold them cached (see buildTilesPayload).
            const { tilesForWorker, rasterCache } = await buildTilesPayload(source, tiles, transferables);

            // Clone fallback pixels for transfer
            let fallbackForWorker = null;
            if (fallbackData) {
                const shouldTransferOriginalPixels = source.type === 'sampler' && fallbackData.pixels?.buffer;
                const pixels = shouldTransferOriginalPixels
                    ? fallbackData.pixels
                    : new Uint8Array(fallbackData.pixels);
                transferables.push(pixels.buffer);
                fallbackForWorker = { ...fallbackData, pixels };
            }

            const result = await postToWorker({
                type: 'resampleHeight',
                center,
                width,
                height,
                targetBounds,
                smooth,
                fillHoles,
                expandFilledGaps,
                tiles: tilesForWorker,
                rasterCache,
                fallback: fallbackForWorker,
                epsgDefs,
                ...buildGapFillPayload(gapFillData, transferables),
            }, transferables, { onProgress });

            if (result) {
                return { heightMap: result.heightMap, bounds: result.bounds };
            }
        } catch (e) {
            console.warn('[ResamplerClient] Height resampling failed, falling back:', e);
        }
    }

    // Fallback: main thread
    return resampleToMeterGrid(source, center, width, height, interpolation, smooth, fillHoles, targetBounds, expandFilledGaps);
};

export const resampleHeightAndImageOffThread = async (
    source,
    imageSampler,
    center,
    width,
    height,
    interpolation,
    smooth,
    fallbackData,
    fillHoles,
    imageSourceData,
    targetBounds = null,
    onProgress = null,
    expandFilledGaps = true,
    flat = false,
    gapFillData = null,
    imageSize = null,
) => {
    const imageWidth = imageSize?.width || width;
    const imageHeight = imageSize?.height || height;
    if (getWorker() && imageSourceData) {
        try {
            let tiles = [];
            let epsgDefs = {};

            if (source.type === 'geotiff' && source.data) {
                const prepared = prepareTiles(source.data);
                tiles = prepared.tiles;
                epsgDefs = prepared.epsgDefs;
            } else if (source.type === 'grid' && source.data) {
                const prepared = prepareGridTiles(source.data);
                tiles = prepared.tiles;
                epsgDefs = prepared.epsgDefs;
            }

            const transferables = [];
            // Clone raster buffers for transfer only when the worker doesn't
            // already hold them cached (see buildTilesPayload).
            const { tilesForWorker, rasterCache } = await buildTilesPayload(source, tiles, transferables);

            let fallbackForWorker = null;
            if (fallbackData) {
                const shouldTransferOriginalPixels = source.type === 'sampler' && fallbackData.pixels?.buffer;
                const pixels = shouldTransferOriginalPixels
                    ? fallbackData.pixels
                    : new Uint8Array(fallbackData.pixels);
                transferables.push(pixels.buffer);
                fallbackForWorker = { ...fallbackData, pixels };
            }

            const imagePixels = imageSourceData.pixels;
            transferables.push(imagePixels.buffer);

            const result = await postToWorker({
                type: 'resampleHeightAndImage',
                center,
                width,
                height,
                imageWidth,
                imageHeight,
                targetBounds,
                smooth,
                fillHoles,
                expandFilledGaps,
                flat,
                tiles: tilesForWorker,
                rasterCache,
                fallback: fallbackForWorker,
                epsgDefs,
                ...buildGapFillPayload(gapFillData, transferables),
                imageSource: { ...imageSourceData, pixels: imagePixels },
            }, transferables, { onProgress });

            if (result) {
                const rgba = new Uint8ClampedArray(result.rgbaBuffer.buffer || result.rgbaBuffer);
                const outW = result.imageWidth || width;
                const outH = result.imageHeight || height;
                const midIdx = ((outH >> 1) * outW + (outW >> 1)) * 4;
                console.log(`[ResamplerClient] worker rgbaBuffer ${outW}x${outH} center: r=${rgba[midIdx]} g=${rgba[midIdx+1]} b=${rgba[midIdx+2]} a=${rgba[midIdx+3]}`);
                return {
                    heightMap: result.heightMap,
                    bounds: result.bounds,
                    canvas: await canvasFromRgbaBuffer(outW, outH, result.rgbaBuffer),
                };
            }
        } catch (e) {
            console.warn('[ResamplerClient] Bundled resampling failed, falling back to main-thread (imageSourceData.pixels may be detached):', e);
        }
    }

    console.log('[ResamplerClient] Using main-thread fallback path for image resampling — worker unavailable or failed above');
    // imageSourceData.pixels may be detached if the worker path was attempted
    // (buffers are transferred zero-copy). Use a null sampler rather than reading
    // garbage from a detached TypedArray.
    const pixelsDetached = imageSourceData && imageSourceData.pixels?.buffer?.byteLength === 0;
    if (pixelsDetached) {
        console.warn('[ResamplerClient] imageSourceData.pixels is detached — falling back to black satellite texture');
    }
    const safeImageSampler = (!pixelsDetached && imageSampler) ? imageSampler : null;
    const [{ heightMap, bounds }, canvas] = await Promise.all([
        resampleHeightMapOffThread(
            source,
            center,
            width,
            height,
            interpolation,
            smooth,
            fallbackData,
            fillHoles,
            targetBounds,
            onProgress,
            expandFilledGaps,
            gapFillData,
        ),
        Promise.resolve(safeImageSampler
            ? resampleImageToMeterGrid({ sampler: safeImageSampler }, center, width, height, targetBounds, imageWidth, imageHeight)
            : null),
    ]);

    return { heightMap, bounds, canvas };
};

/**
 * Resample satellite image using Web Worker, with main-thread fallback.
 *
 * @param {object} source      - { sampler }
 * @param {object} center      - { lat, lng }
 * @param {number} width
 * @param {number} height
 * @param {object|null} imageSourceData - { pixels, width, height, zoom, minTileX, minTileY }
 */
export const resampleImageOffThread = async (
    source, center, width, height, imageSourceData, targetBounds = null, imageSize = null
) => {
    const imageWidth = imageSize?.width || width;
    const imageHeight = imageSize?.height || height;
    if (getWorker() && imageSourceData) {
        try {
            const result = await postToWorker({
                type: 'resampleImage',
                center,
                width,
                height,
                imageWidth,
                imageHeight,
                targetBounds,
                imageSource: imageSourceData,
            }, [imageSourceData.pixels.buffer]);

            if (result && result.rgbaBuffer) {
                return await canvasFromRgbaBuffer(result.imageWidth || width, result.imageHeight || height, result.rgbaBuffer);
            }
        } catch (e) {
            console.warn('[ResamplerClient] Image resampling failed, falling back:', e);
        }
    }

    // Fallback: main thread
    return resampleImageToMeterGrid(source, center, width, height, targetBounds, imageWidth, imageHeight);
};
