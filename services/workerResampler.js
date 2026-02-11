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
            pendingMessages.delete(id);
            if (type === 'error') pending.reject(new Error(error));
            else pending.resolve(data);
        };
        worker.onerror = (e) => {
            console.error('[ResamplerWorker] Uncaught error:', e);
            // Reject all pending, force recreation on next call
            for (const [, p] of pendingMessages) p.reject(new Error('Worker error'));
            pendingMessages.clear();
            worker.terminate();
            worker = null;
        };
        return worker;
    } catch (e) {
        console.warn('[ResamplerWorker] Failed to create worker, falling back to main thread:', e);
        return null;
    }
};

/**
 * Post a message to the worker and return a promise for the response.
 */
const postToWorker = (message, transferables = []) => {
    const w = getWorker();
    if (!w) return null; // signal caller to use fallback

    const id = ++messageId;
    return new Promise((resolve, reject) => {
        pendingMessages.set(id, { resolve, reject });
        w.postMessage({ ...message, id }, transferables);
    });
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
    source, center, width, height, interpolation, smooth, fallbackData
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
            }

            const transferables = [];
            // Collect raster buffers for transfer (clone first to avoid neutering originals)
            const tilesForWorker = tiles.map(t => {
                const rasterCopy = new Float32Array(t.raster);
                transferables.push(rasterCopy.buffer);
                return { ...t, raster: rasterCopy };
            });

            // Clone fallback pixels for transfer
            let fallbackForWorker = null;
            if (fallbackData) {
                const pixelsCopy = new Uint8Array(fallbackData.pixels);
                transferables.push(pixelsCopy.buffer);
                fallbackForWorker = { ...fallbackData, pixels: pixelsCopy };
            }

            const result = await postToWorker({
                type: 'resampleHeight',
                center,
                width,
                height,
                smooth,
                tiles: tilesForWorker,
                fallback: fallbackForWorker,
                epsgDefs,
            }, transferables);

            if (result) {
                return { heightMap: result.heightMap, bounds: result.bounds };
            }
        } catch (e) {
            console.warn('[ResamplerWorker] Height resampling failed, falling back:', e);
        }
    }

    // Fallback: main thread
    return resampleToMeterGrid(source, center, width, height, interpolation, smooth);
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
    source, center, width, height, imageSourceData
) => {
    if (getWorker() && imageSourceData) {
        try {
            const pixelsCopy = new Uint8Array(imageSourceData.pixels);
            const result = await postToWorker({
                type: 'resampleImage',
                center,
                width,
                height,
                imageSource: { ...imageSourceData, pixels: pixelsCopy },
            }, [pixelsCopy.buffer]);

            if (result && result.rgbaBuffer) {
                // Convert RGBA buffer back to a canvas
                const canvas = document.createElement('canvas');
                canvas.width = width;
                canvas.height = height;
                const ctx = canvas.getContext('2d');
                const imgData = ctx.createImageData(width, height);
                imgData.data.set(new Uint8ClampedArray(result.rgbaBuffer.buffer));
                ctx.putImageData(imgData, 0, 0);
                return canvas;
            }
        } catch (e) {
            console.warn('[ResamplerWorker] Image resampling failed, falling back:', e);
        }
    }

    // Fallback: main thread
    return resampleImageToMeterGrid(source, center, width, height);
};
