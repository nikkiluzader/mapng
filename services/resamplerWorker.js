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

    if (!Number.isFinite(h00) || !Number.isFinite(h10) || !Number.isFinite(h01) || !Number.isFinite(h11)) return noDataVal;
    if (h00 === noDataVal || h10 === noDataVal || h01 === noDataVal || h11 === noDataVal) return noDataVal;

    const interp = (1 - dy) * ((1 - dx) * h00 + dx * h10) + dy * ((1 - dx) * h01 + dx * h11);
    return Number.isFinite(interp) ? interp : noDataVal;
};

// ─── Terrarium Sampler ───────────────────────────────────────────────────────
const sampleTerrarium = (pixels, imgW, imgH, zoom, minTileX, minTileY, lat, lng, noDataVal) => {
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
        const h = r * 256 + g + b / 256 - 32768;
        return h <= -32760 ? noDataVal : h;
    };

    const h00 = getH(x0, y0);
    const h10 = getH(x0 + 1, y0);
    const h01 = getH(x0, y0 + 1);
    const h11 = getH(x0 + 1, y0 + 1);

    if (h00 === noDataVal || h10 === noDataVal || h01 === noDataVal || h11 === noDataVal) return noDataVal;

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

// ─── Height Resampling Helpers ───────────────────────────────────────────────
const pushPullInpaint = (map, width, height, noData) => {
    let hasHole = false;
    let sumValid = 0;
    let countValid = 0;
    for (let i = 0; i < map.length; i++) {
        const v = map[i];
        if (v === noData || !Number.isFinite(v)) hasHole = true;
        else { sumValid += v; countValid++; }
    }
    if (!hasHole) {
        console.debug('[ResamplerWorker] No holes detected, skipping inpaint');
        return null;
    }
    const fallback = countValid > 0 ? sumValid / countValid : 0;

    const levels = [];
    levels.push({ data: new Float32Array(map), w: width, h: height });

    while (levels[levels.length - 1].w > 1 || levels[levels.length - 1].h > 1) {
        const prev = levels[levels.length - 1];
        const nw = Math.max(1, Math.floor((prev.w + 1) / 2));
        const nh = Math.max(1, Math.floor((prev.h + 1) / 2));
        const next = new Float32Array(nw * nh);
        next.fill(noData);

        for (let y = 0; y < nh; y++) {
            for (let x = 0; x < nw; x++) {
                let sum = 0;
                let cnt = 0;
                for (let dy = 0; dy < 2; dy++) {
                    const py = y * 2 + dy;
                    if (py >= prev.h) continue;
                    for (let dx = 0; dx < 2; dx++) {
                        const px = x * 2 + dx;
                        if (px >= prev.w) continue;
                        const v = prev.data[py * prev.w + px];
                        if (v !== noData && Number.isFinite(v)) { sum += v; cnt++; }
                    }
                }
                if (cnt > 0) next[y * nw + x] = sum / cnt;
            }
        }

        levels.push({ data: next, w: nw, h: nh });
    }

    const top = levels[levels.length - 1];
    for (let i = 0; i < top.data.length; i++) {
        if (top.data[i] === noData) top.data[i] = fallback;
    }

    for (let li = levels.length - 2; li >= 0; li--) {
        const coarse = levels[li + 1];
        const fine = levels[li];
        const mask = new Uint8Array(fine.data.length);

        for (let y = 0; y < fine.h; y++) {
            const cy = y * 0.5;
            const y0 = Math.floor(cy);
            const fy = cy - y0;
            const y1 = Math.min(coarse.h - 1, y0 + 1);
            for (let x = 0; x < fine.w; x++) {
                const idx = y * fine.w + x;
                if (fine.data[idx] !== noData) continue;
                const cx = x * 0.5;
                const x0 = Math.floor(cx);
                const fx = cx - x0;
                const x1 = Math.min(coarse.w - 1, x0 + 1);

                const c00 = coarse.data[y0 * coarse.w + x0];
                const c10 = coarse.data[y0 * coarse.w + x1];
                const c01 = coarse.data[y1 * coarse.w + x0];
                const c11 = coarse.data[y1 * coarse.w + x1];

                const topVal = c00 * (1 - fx) + c10 * fx;
                const botVal = c01 * (1 - fx) + c11 * fx;
                const interp = topVal * (1 - fy) + botVal * fy;

                fine.data[idx] = interp;
                mask[idx] = 1;
            }
        }

        levels[li].mask = mask;
    }

    const base = levels[0];
    const mask = base.mask;
    if (mask) {
        const out = new Float32Array(base.data);
        const rad = 1;
        for (let y = 0; y < base.h; y++) {
            for (let x = 0; x < base.w; x++) {
                const idx = y * base.w + x;
                if (!mask[idx]) continue;
                let sum = 0;
                let cnt = 0;
                for (let dy = -rad; dy <= rad; dy++) {
                    const ny = y + dy;
                    if (ny < 0 || ny >= base.h) continue;
                    const rowOff = ny * base.w;
                    for (let dx = -rad; dx <= rad; dx++) {
                        const nx = x + dx;
                        if (nx < 0 || nx >= base.w) continue;
                        sum += base.data[rowOff + nx];
                        cnt++;
                    }
                }
                if (cnt > 0) out[idx] = sum / cnt;
            }
        }
        base.data.set(out);
    }

    map.set(levels[0].data);
    return mask || null;
};

const expandFill = (map, width, height, noData, maxPasses = 64, radius = 3, baseMask = null) => {
    const filledMask = baseMask ? new Uint8Array(baseMask) : new Uint8Array(map.length);
    for (let pass = 0; pass < maxPasses; pass++) {
        let any = false;
        for (let y = 0; y < height; y++) {
            const rowOff = y * width;
            for (let x = 0; x < width; x++) {
                const idx = rowOff + x;
                if (map[idx] !== noData) continue;
                let sum = 0;
                let cnt = 0;
                for (let dy = -radius; dy <= radius; dy++) {
                    const ny = y + dy;
                    if (ny < 0 || ny >= height) continue;
                    const base = ny * width;
                    for (let dx = -radius; dx <= radius; dx++) {
                        const nx = x + dx;
                        if (nx < 0 || nx >= width) continue;
                        const v = map[base + nx];
                        if (v !== noData && Number.isFinite(v)) { sum += v; cnt++; }
                    }
                }
                if (cnt > 0) {
                    map[idx] = sum / cnt;
                    filledMask[idx] = 1;
                    any = true;
                }
            }
        }
        if (!any) break;
    }
    return filledMask;
};

const relaxFilled = (map, width, height, noData, filledMask, iterations = 200) => {
    if (!filledMask) return;
    for (let iter = 0; iter < iterations; iter++) {
        let updated = false;
        for (let y = 0; y < height; y++) {
            const rowOff = y * width;
            for (let x = 0; x < width; x++) {
                const idx = rowOff + x;
                if (!filledMask[idx]) continue;
                
                const curVal = map[idx];
                const getV = (dx, dy) => {
                    const nx = Math.max(0, Math.min(width - 1, x + dx));
                    const ny = Math.max(0, Math.min(height - 1, y + dy));
                    const val = map[ny * width + nx];
                    if (val === noData || !Number.isFinite(val)) return curVal;
                    return val;
                };

                let sumBi = 0;
                // distance 1: weight 8
                sumBi += 8 * (getV(-1, 0) + getV(1, 0) + getV(0, -1) + getV(0, 1));
                // distance sqrt(2): weight -2
                sumBi -= 2 * (getV(-1, -1) + getV(1, -1) + getV(-1, 1) + getV(1, 1));
                // distance 2: weight -1
                sumBi -= 1 * (getV(-2, 0) + getV(2, 0) + getV(0, -2) + getV(0, 2));
                const biVal = sumBi / 20;

                let sumLap = getV(-1, 0) + getV(1, 0) + getV(0, -1) + getV(0, 1);
                const lapVal = sumLap / 4;

                // 50% tension to prevent deep pits/overshoots (Gibbs phenomenon) while preserving smooth curvature
                const tension = 0.5;
                const newVal = biVal * (1 - tension) + lapVal * tension;

                if (Math.abs(newVal - curVal) > 0.0001) {
                    map[idx] = newVal;
                    updated = true;
                }
            }
        }
        if (!updated) break;
    }
};

const resampleHeight = async ({ center, width, height, smooth, fillHoles = true, tiles, fallback, epsgDefs }) => {
    const heightMap = new Float32Array(width * height);
    const toWGS84 = createLocalToWGS84(center.lat, center.lng);
    const halfWidth = width / 2;
    const halfHeight = height / 2;

    const NO_DATA = -99999;
    
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
                    noData: Number.isFinite(tile.noData) ? tile.noData : NO_DATA,
                    converter,
                });
            }
        }
    }
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
                    lat, lng,
                    NO_DATA
                );
            }

            if (!Number.isFinite(h) || h <= -200 || h === NO_DATA) h = NO_DATA;
            heightMap[y * width + x] = h;
        }
    }

    // Fill holes before smoothing to avoid visible seams from missing tiles (skip if disabled)
    if (fillHoles) {
        console.debug('[ResamplerWorker] Hole filling enabled: starting push/pull seed');
        let preMin=Infinity, preMax=-Infinity, preHole=0;
        for(let i=0; i<heightMap.length; i++) {
            if(heightMap[i] === NO_DATA) preHole++;
            else { if(heightMap[i] < preMin) preMin=heightMap[i]; if(heightMap[i] > preMax) preMax=heightMap[i]; }
        }
        console.debug('[ResamplerWorker] Before inpaint - Holes:', preHole, 'Min:', preMin, 'Max:', preMax);
        const seededMask = pushPullInpaint(heightMap, width, height, NO_DATA);
        console.debug('[ResamplerWorker] Push/pull seed complete');
        let seedMin=Infinity, seedMax=-Infinity, seedHole=0;
        for(let i=0; i<heightMap.length; i++) {
            if(heightMap[i] === NO_DATA) seedHole++;
            else { if(heightMap[i] < seedMin) seedMin=heightMap[i]; if(heightMap[i] > seedMax) seedMax=heightMap[i]; }
        }
        console.debug('[ResamplerWorker] After push/pull - Holes:', seedHole, 'Min:', seedMin, 'Max:', seedMax);
        const expandedMask = expandFill(heightMap, width, height, NO_DATA, 64, 3, seededMask);
        console.debug('[ResamplerWorker] Expand fill complete');
        let expMin=Infinity, expMax=-Infinity, expHole=0;
        for(let i=0; i<heightMap.length; i++) {
            if(heightMap[i] === NO_DATA) expHole++;
            else { if(heightMap[i] < expMin) expMin=heightMap[i]; if(heightMap[i] > expMax) expMax=heightMap[i]; }
        }
        console.debug('[ResamplerWorker] After expandFill - Holes:', expHole, 'Min:', expMin, 'Max:', expMax);
        relaxFilled(heightMap, width, height, NO_DATA, expandedMask || seededMask, 200);
        let relMin=Infinity, relMax=-Infinity, relHole=0;
        for(let i=0; i<heightMap.length; i++) {
            if(heightMap[i] === NO_DATA) relHole++;
            else { if(heightMap[i] < relMin) relMin=heightMap[i]; if(heightMap[i] > relMax) relMax=heightMap[i]; }
        }
        console.debug('[ResamplerWorker] Relaxation complete - Holes:', relHole, 'Min:', relMin, 'Max:', relMax);
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
