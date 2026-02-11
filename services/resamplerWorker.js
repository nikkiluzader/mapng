/**
 * Web Worker for CPU-intensive terrain resampling operations.
 * Offloads the per-pixel projection + sampling loops from the main thread.
 *
 * Handles two message types:
 *   - resampleHeight: heightmap resampling (GeoTIFF tiles + Terrarium fallback)
 *   - resampleImage:  satellite image resampling
 *
 * All data is passed as transferable ArrayBuffers where possible.
 */
import proj4 from 'proj4';

// ─── Web Mercator Projection (mirrors terrain.js) ───────────────────────────
const TILE_SIZE = 256;
const MAX_LATITUDE = 85.05112878;

const project = (lat, lng, zoom) => {
    const d = Math.PI / 180;
    const max = MAX_LATITUDE;
    const latClamped = Math.max(Math.min(max, lat), -max);
    const sin = Math.sin(latClamped * d);
    const z = TILE_SIZE * Math.pow(2, zoom);
    const x = (z * (lng + 180)) / 360;
    const y = z * (0.5 - (0.25 * Math.log((1 + sin) / (1 - sin))) / Math.PI);
    return { x, y };
};

// ─── Local Transverse Mercator (mirrors geoUtils.js) ─────────────────────────
const createLocalToWGS84 = (centerLat, centerLng) => {
    const def = `+proj=tmerc +lat_0=${centerLat} +lon_0=${centerLng} +k=1 +x_0=0 +y_0=0 +datum=WGS84 +units=m +no_defs`;
    return proj4(def, 'EPSG:4326');
};

// ─── Bilinear Interpolation ──────────────────────────────────────────────────
const bilinear = (raster, w, x, y, noDataVal) => {
    const x0 = Math.floor(x);
    const y0 = Math.floor(y);
    const dx = x - x0;
    const dy = y - y0;

    const i00 = y0 * w + x0;
    const i10 = i00 + 1;
    const i01 = (y0 + 1) * w + x0;
    const i11 = i01 + 1;

    if (i00 < 0 || i11 >= raster.length) return noDataVal;

    const h00 = raster[i00];
    const h10 = raster[i10];
    const h01 = raster[i01];
    const h11 = raster[i11];

    if (h00 === noDataVal || h10 === noDataVal || h01 === noDataVal || h11 === noDataVal) return noDataVal;

    return (1 - dy) * ((1 - dx) * h00 + dx * h10) + dy * ((1 - dx) * h01 + dx * h11);
};

// ─── Terrarium Sampler ───────────────────────────────────────────────────────
const sampleTerrarium = (pixels, imgW, imgH, zoom, minTileX, minTileY, lat, lng) => {
    const p = project(lat, lng, zoom);
    const localX = p.x - minTileX * TILE_SIZE;
    const localY = p.y - minTileY * TILE_SIZE;

    const x0 = Math.floor(localX);
    const y0 = Math.floor(localY);
    const dx = localX - x0;
    const dy = localY - y0;

    const getH = (x, y) => {
        const cx = Math.max(0, Math.min(imgW - 1, x));
        const cy = Math.max(0, Math.min(imgH - 1, y));
        const i = (cy * imgW + cx) * 4;
        const r = pixels[i];
        const g = pixels[i + 1];
        const b = pixels[i + 2];
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

// ─── Satellite Pixel Sampler ─────────────────────────────────────────────────
const sampleImage = (pixels, imgW, imgH, zoom, minTileX, minTileY, lat, lng) => {
    const p = project(lat, lng, zoom);
    const localX = p.x - minTileX * TILE_SIZE;
    const localY = p.y - minTileY * TILE_SIZE;

    const x = Math.floor(localX);
    const y = Math.floor(localY);

    if (x < 0 || x >= imgW || y < 0 || y >= imgH)
        return { r: 0, g: 0, b: 0, a: 255 };

    const i = (y * imgW + x) * 4;
    return { r: pixels[i], g: pixels[i + 1], b: pixels[i + 2], a: pixels[i + 3] };
};

// ─── Height Resampling ───────────────────────────────────────────────────────
const resampleHeight = async ({ center, width, height, smooth, tiles, fallback, epsgDefs }) => {
    const heightMap = new Float32Array(width * height);
    const toWGS84 = createLocalToWGS84(center.lat, center.lng);
    const halfWidth = width / 2;
    const halfHeight = height / 2;

    // Register any pre-fetched EPSG definitions
    if (epsgDefs) {
        for (const [code, def] of Object.entries(epsgDefs)) {
            if (!proj4.defs(code)) proj4.defs(code, def);
        }
    }

    // Build tile converters (recreate proj4 instances from EPSG codes)
    const preparedTiles = [];
    if (tiles && tiles.length > 0) {
        for (const tile of tiles) {
            let converter = null;
            if (tile.epsgCode) {
                const epsg = `EPSG:${tile.epsgCode}`;
                try {
                    if (!proj4.defs(epsg)) {
                        // Try to fetch definition
                        const response = await fetch(`https://epsg.io/${tile.epsgCode}.proj4`);
                        if (response.ok) {
                            const def = await response.text();
                            proj4.defs(epsg, def);
                        }
                    }
                    converter = proj4('EPSG:4326', epsg);
                } catch (e) {
                    if (tile.epsgCode === 4326) {
                        converter = { forward: (p) => p };
                    }
                }
            } else {
                converter = { forward: (p) => p };
            }

            if (converter) {
                preparedTiles.push({
                    raster: tile.raster,
                    width: tile.width,
                    height: tile.height,
                    originX: tile.originX,
                    originY: tile.originY,
                    resX: tile.resX,
                    resY: tile.resY,
                    noData: tile.noData,
                    converter,
                });
            }
        }
    }

    const NO_DATA = -99999;

    // Main resampling loop
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const localX = x - halfWidth;
            const localY = halfHeight - y;
            const [lng, lat] = toWGS84.forward([localX, localY]);

            let h = NO_DATA;

            // Try GeoTIFF tiles first
            if (preparedTiles.length > 0) {
                for (const tile of preparedTiles) {
                    const [tx, ty] = tile.converter.forward([lng, lat]);
                    const px = (tx - tile.originX) / tile.resX;
                    const py = (ty - tile.originY) / tile.resY;

                    if (px >= 0 && px < tile.width - 1 && py >= 0 && py < tile.height - 1) {
                        const val = bilinear(tile.raster, tile.width, px, py, tile.noData);
                        if (val !== tile.noData) {
                            h = val;
                            break;
                        }
                    }
                }
            }

            // Fallback to Terrarium sampler
            if (h === NO_DATA && fallback) {
                h = sampleTerrarium(
                    fallback.pixels, fallback.width, fallback.height,
                    fallback.zoom, fallback.minTileX, fallback.minTileY,
                    lat, lng
                );
            }

            heightMap[y * width + x] = h;
        }
    }

    // Smoothing pass
    if (smooth) {
        const radius = 8;
        const tempMap = new Float32Array(heightMap.length);

        const blurH = (src, dst) => {
            for (let y = 0; y < height; y++) {
                for (let x = 0; x < width; x++) {
                    let sum = 0, count = 0;
                    const start = Math.max(0, x - radius);
                    const end = Math.min(width - 1, x + radius);
                    for (let k = start; k <= end; k++) {
                        const val = src[y * width + k];
                        if (val !== NO_DATA) { sum += val; count++; }
                    }
                    dst[y * width + x] = count > 0 ? sum / count : NO_DATA;
                }
            }
        };

        const blurV = (src, dst) => {
            for (let x = 0; x < width; x++) {
                for (let y = 0; y < height; y++) {
                    let sum = 0, count = 0;
                    const start = Math.max(0, y - radius);
                    const end = Math.min(height - 1, y + radius);
                    for (let k = start; k <= end; k++) {
                        const val = src[k * width + x];
                        if (val !== NO_DATA) { sum += val; count++; }
                    }
                    dst[y * width + x] = count > 0 ? sum / count : NO_DATA;
                }
            }
        };

        blurH(heightMap, tempMap);
        blurV(tempMap, heightMap);
        blurH(heightMap, tempMap);
        blurV(tempMap, heightMap);
    }

    // Compute output bounds
    const nw = toWGS84.forward([-halfWidth, halfHeight]);
    const se = toWGS84.forward([halfWidth, -halfHeight]);

    return {
        heightMap,
        bounds: { north: nw[1], west: nw[0], south: se[1], east: se[0] },
    };
};

// ─── Image Resampling ────────────────────────────────────────────────────────
const resampleImageData = ({ center, width, height, imageSource }) => {
    const rgbaBuffer = new Uint8ClampedArray(width * height * 4);
    const toWGS84 = createLocalToWGS84(center.lat, center.lng);
    const halfWidth = width / 2;
    const halfHeight = height / 2;

    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const localX = x - halfWidth;
            const localY = halfHeight - y;
            const [lng, lat] = toWGS84.forward([localX, localY]);

            const color = sampleImage(
                imageSource.pixels, imageSource.width, imageSource.height,
                imageSource.zoom, imageSource.minTileX, imageSource.minTileY,
                lat, lng
            );

            const idx = (y * width + x) * 4;
            rgbaBuffer[idx] = color.r;
            rgbaBuffer[idx + 1] = color.g;
            rgbaBuffer[idx + 2] = color.b;
            rgbaBuffer[idx + 3] = color.a;
        }
    }

    return rgbaBuffer;
};

// ─── Message Handler ─────────────────────────────────────────────────────────
self.onmessage = async (e) => {
    const { type, id, ...params } = e.data;

    try {
        if (type === 'resampleHeight') {
            const result = await resampleHeight(params);
            self.postMessage(
                { id, type: 'result', heightMap: result.heightMap, bounds: result.bounds },
                [result.heightMap.buffer]
            );
        } else if (type === 'resampleImage') {
            const result = resampleImageData(params);
            self.postMessage(
                { id, type: 'result', rgbaBuffer: result },
                [result.buffer]
            );
        }
    } catch (err) {
        self.postMessage({ id, type: 'error', error: err.message });
    }
};
