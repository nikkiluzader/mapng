/**
 * Manages a resampler Web Worker and provides a Promise-based API.
 * Falls back to main-thread resampling if workers are unavailable.
 */
import proj4 from 'proj4';
import { resampleToMeterGrid, resampleImageToMeterGrid } from './terrainResampler';

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

const canvasFromRgbaBuffer = (width, height, rgbaBuffer) => {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    // new ImageData(array, w, h) wraps the existing Uint8ClampedArray directly
    // (no copy), saving ~1 GB at 16k vs ctx.createImageData() + .set().
    const pixels = rgbaBuffer instanceof Uint8ClampedArray
        ? rgbaBuffer
        : new Uint8ClampedArray(rgbaBuffer);
    ctx.putImageData(new ImageData(pixels, width, height), 0, 0);
    return canvas;
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
            noData: image.getGDALNoData() ?? -99999,
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
 * @param {boolean} smooth
 * @param {object|null} fallbackData - { pixels, width, height, zoom, minTileX, minTileY }
 */
export const resampleHeightMapOffThread = async (
    source, center, width, height, interpolation, smooth, fallbackData, fillHoles = true, targetBounds = null, onProgress = null
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
            // Collect raster buffers for transfer (clone first to avoid neutering originals)
            const transferSourceRasters = source?.transferRasters === true;
            const tilesForWorker = tiles.map(t => {
                const raster = transferSourceRasters ? t.raster : new Float32Array(t.raster);
                transferables.push(raster.buffer);
                return { ...t, raster };
            });

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
                tiles: tilesForWorker,
                fallback: fallbackForWorker,
                epsgDefs,
            }, transferables, { onProgress });

            if (result) {
                return { heightMap: result.heightMap, bounds: result.bounds };
            }
        } catch (e) {
            console.warn('[ResamplerClient] Height resampling failed, falling back:', e);
        }
    }

    // Fallback: main thread
    return resampleToMeterGrid(source, center, width, height, interpolation, smooth, fillHoles, targetBounds);
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
) => {
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
            const transferSourceRasters = source?.transferRasters === true;
            const tilesForWorker = tiles.map((tile) => {
                const raster = transferSourceRasters ? tile.raster : new Float32Array(tile.raster);
                transferables.push(raster.buffer);
                return { ...tile, raster };
            });

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
                targetBounds,
                smooth,
                fillHoles,
                tiles: tilesForWorker,
                fallback: fallbackForWorker,
                epsgDefs,
                imageSource: { ...imageSourceData, pixels: imagePixels },
            }, transferables, { onProgress });

            if (result) {
                const rgba = new Uint8ClampedArray(result.rgbaBuffer.buffer || result.rgbaBuffer);
                const midIdx = ((height >> 1) * width + (width >> 1)) * 4;
                console.log(`[ResamplerClient] worker rgbaBuffer ${width}x${height} center: r=${rgba[midIdx]} g=${rgba[midIdx+1]} b=${rgba[midIdx+2]} a=${rgba[midIdx+3]}`);
                return {
                    heightMap: result.heightMap,
                    bounds: result.bounds,
                    canvas: canvasFromRgbaBuffer(width, height, result.rgbaBuffer),
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
        ),
        Promise.resolve(safeImageSampler
            ? resampleImageToMeterGrid({ sampler: safeImageSampler }, center, width, height, targetBounds)
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
    source, center, width, height, imageSourceData, targetBounds = null
) => {
    if (getWorker() && imageSourceData) {
        try {
            const result = await postToWorker({
                type: 'resampleImage',
                center,
                width,
                height,
                targetBounds,
                imageSource: imageSourceData,
            }, [imageSourceData.pixels.buffer]);

            if (result && result.rgbaBuffer) {
                return canvasFromRgbaBuffer(width, height, result.rgbaBuffer);
            }
        } catch (e) {
            console.warn('[ResamplerClient] Image resampling failed, falling back:', e);
        }
    }

    // Fallback: main thread
    return resampleImageToMeterGrid(source, center, width, height, targetBounds);
};
