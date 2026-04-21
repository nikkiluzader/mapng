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

const DEBUG_RESAMPLER = false;
const debugLog = (...args) => {
    if (DEBUG_RESAMPLER) console.debug(...args);
};

// ─── Built-in proj4 strings for common CRS (avoids CORS fetch) ──────────────
const getBuiltInProj4 = (epsgCode) => {
    if (epsgCode === 3857) {
        return '+proj=merc +a=6378137 +b=6378137 +lat_ts=0.0 +lon_0=0.0 +x_0=0.0 +y_0=0 +k=1.0 +units=m +nadgrids=@null +wktext +no_defs';
    }
    if (epsgCode >= 32601 && epsgCode <= 32660) {
        return `+proj=utm +zone=${epsgCode - 32600} +datum=WGS84 +units=m +no_defs`;
    }
    if (epsgCode >= 32701 && epsgCode <= 32760) {
        return `+proj=utm +zone=${epsgCode - 32700} +south +datum=WGS84 +units=m +no_defs`;
    }
    return null;
};

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

const normalizeLng = (lng) => ((((lng + 180) % 360) + 360) % 360) - 180;

const getPixelLatLng = (x, y, width, height, toWGS84, targetBounds) => {
    if (targetBounds && Number.isFinite(targetBounds.north) && Number.isFinite(targetBounds.south)
        && Number.isFinite(targetBounds.east) && Number.isFinite(targetBounds.west)) {
        const u = width > 1 ? x / (width - 1) : 0.5;
        const v = height > 1 ? y / (height - 1) : 0.5;
        const lat = targetBounds.north - v * (targetBounds.north - targetBounds.south);

        let lngSpan = targetBounds.east - targetBounds.west;
        if (lngSpan > 180) lngSpan -= 360;
        if (lngSpan < -180) lngSpan += 360;
        const lng = normalizeLng(targetBounds.west + u * lngSpan);
        return [lng, lat];
    }

    const halfWidth = width / 2;
    const halfHeight = height / 2;
    const localX = x - halfWidth;
    const localY = halfHeight - y;
    return toWGS84.forward([localX, localY]);
};

const getOutputBounds = (toWGS84, width, height, targetBounds) => {
    if (targetBounds && Number.isFinite(targetBounds.north) && Number.isFinite(targetBounds.south)
        && Number.isFinite(targetBounds.east) && Number.isFinite(targetBounds.west)) {
        return {
            north: targetBounds.north,
            south: targetBounds.south,
            east: normalizeLng(targetBounds.east),
            west: normalizeLng(targetBounds.west),
        };
    }

    const halfWidth = width / 2;
    const halfHeight = height / 2;
    const nw = toWGS84.forward([-halfWidth, halfHeight]);
    const se = toWGS84.forward([halfWidth, -halfHeight]);
    return { north: nw[1], west: nw[0], south: se[1], east: se[0] };
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
const writeSampledImagePixel = (out, outIndex, pixels, imgW, imgH, zoom, minTileX, minTileY, lat, lng) => {
    const p = project(lat, lng, zoom);
    const localX = p.x - minTileX * TILE_SIZE;
    const localY = p.y - minTileY * TILE_SIZE;

    const x = Math.floor(localX);
    const y = Math.floor(localY);

    if (x < 0 || x >= imgW || y < 0 || y >= imgH) {
        out[outIndex] = 0;
        out[outIndex + 1] = 0;
        out[outIndex + 2] = 0;
        out[outIndex + 3] = 255;
        return;
    }

    const i = (y * imgW + x) * 4;
    out[outIndex] = pixels[i];
    out[outIndex + 1] = pixels[i + 1];
    out[outIndex + 2] = pixels[i + 2];
    out[outIndex + 3] = pixels[i + 3];
};

/**
 * Group GeoTIFF tiles by CRS, look up (or fetch) proj4 definitions for each
 * group, and build a converter from WGS84 lon/lat to the tile's projected
 * coordinate space. Returns an array of group objects ready for sampleHeightAt().
 *
 * Tiles that share a CRS are batched together so the expensive proj4 conversion
 * is only performed once per output pixel regardless of how many source tiles
 * cover that area.
 */
const buildPreparedTileGroups = async (tiles, epsgDefs, noDataValue) => {
    if (epsgDefs) {
        for (const [code, def] of Object.entries(epsgDefs)) {
            if (def && !proj4.defs(code)) proj4.defs(code, def);
        }
    }

    const groups = new Map();

    if (!tiles || tiles.length === 0) return [];

    for (const tile of tiles) {
        const epsgKey = tile.epsgCode ? `EPSG:${tile.epsgCode}` : 'EPSG:4326';
        let group = groups.get(epsgKey);

        if (!group) {
            let converter = null;
            const identity = !tile.epsgCode || tile.epsgCode === 4326;
            if (!identity) {
                try {
                    if (!proj4.defs(epsgKey)) {
                        const builtIn = getBuiltInProj4(tile.epsgCode);
                        if (builtIn) {
                            proj4.defs(epsgKey, builtIn);
                        } else {
                            const response = await fetch(`https://epsg.io/${tile.epsgCode}.proj4`);
                            if (response.ok) {
                                const def = await response.text();
                                proj4.defs(epsgKey, def);
                            }
                        }
                    }
                    converter = proj4('EPSG:4326', epsgKey);
                } catch (e) {
                    if (tile.epsgCode === 4326) {
                        converter = { forward: (p) => p };
                    } else {
                        continue;
                    }
                }
            }

            group = {
                identity,
                converter,
                tiles: [],
                lastTile: null,
            };
            groups.set(epsgKey, group);
        }

        group.tiles.push({
            raster: tile.raster,
            width: tile.width,
            height: tile.height,
            originX: tile.originX,
            originY: tile.originY,
            resX: tile.resX,
            resY: tile.resY,
            noData: Number.isFinite(tile.noData) ? tile.noData : noDataValue,
        });
    }

    return [...groups.values()];
};

const samplePreparedTile = (tile, projectedX, projectedY) => {
    const px = (projectedX - tile.originX) / tile.resX;
    const py = (projectedY - tile.originY) / tile.resY;
    if (px < 0 || px >= tile.width - 1 || py < 0 || py >= tile.height - 1) {
        return tile.noData;
    }
    return bilinear(tile.raster, tile.width, px, py, tile.noData);
};

/**
 * Sample elevation at a single WGS84 point from the prepared tile groups, with
 * Terrarium fallback for positions not covered by any high-res tile.
 *
 * Implements a simple "last-tile cache": after a successful lookup, the winning
 * tile is stored on its group so the next nearby pixel skips the linear scan.
 * This gives a large speedup on spatially coherent access patterns (raster scan).
 */
const sampleHeightAt = (lng, lat, preparedGroups, fallback, noData) => {
    for (const group of preparedGroups) {
        let projectedX;
        let projectedY;
        if (group.identity) {
            projectedX = lng;
            projectedY = lat;
        } else {
            const projected = group.converter.forward([lng, lat]);
            projectedX = projected[0];
            projectedY = projected[1];
        }

        if (group.lastTile) {
            const cachedVal = samplePreparedTile(group.lastTile, projectedX, projectedY);
            if (cachedVal !== group.lastTile.noData) return cachedVal;
        }

        for (const tile of group.tiles) {
            if (tile === group.lastTile) continue;
            const value = samplePreparedTile(tile, projectedX, projectedY);
            if (value !== tile.noData) {
                group.lastTile = tile;
                return value;
            }
        }
    }

    if (fallback) {
        return sampleTerrarium(
            fallback.pixels,
            fallback.width,
            fallback.height,
            fallback.zoom,
            fallback.minTileX,
            fallback.minTileY,
            lat,
            lng,
            noData,
        );
    }

    return noData;
};

// ─── Height Resampling Helpers ───────────────────────────────────────────────

/**
 * Pyramid-based push/pull inpainting for NO_DATA holes.
 *
 * Builds a mipmap pyramid by averaging valid (non-NO_DATA) neighbours at each
 * level. The coarsest level is seeded with the global mean. Then the pyramid is
 * pulled back up: each hole at a finer level is bilinearly interpolated from the
 * coarser level above it. A final 1-pixel box blur smooths seams around filled
 * areas.
 *
 * Returns the filled-pixel mask (1 where a hole was patched) so that subsequent
 * relaxation passes can target only those pixels.
 */
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
        debugLog('[ResamplerWorker] No holes detected, skipping inpaint');
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

/**
 * Neighbour-average fill for holes that pushPullInpaint couldn't reach.
 * Iterates up to maxPasses times; each pass replaces every remaining NO_DATA
 * pixel with the average of its valid neighbours within `radius` pixels.
 * Stops early when no new pixels are filled.
 *
 * Returns a mask of all pixels that were touched (combining the seed mask from
 * pushPull with newly filled pixels) so the relaxation step knows which
 * values were synthesised vs. sampled directly from source data.
 */
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

/**
 * Smooth synthesised (hole-filled) pixels by iterating a blended bi-harmonic /
 * Laplacian operator only on pixels marked in filledMask.
 *
 * The update rule mixes:
 *   - Bi-harmonic (weighted 1−tension): promotes smooth curvature, suppresses
 *     sharp kinks at the boundary between real data and filled values.
 *   - Laplacian (weighted tension=0.5): acts as a tension/spring term that
 *     anchors the surface closer to its neighbours, preventing Gibbs-phenomenon
 *     overshoots in filled pits or sharp ridges.
 *
 * Only filled pixels are mutated; real-data pixels act as fixed boundary
 * conditions that constrain the solution.
 */
const relaxFilled = (map, width, height, noData, filledMask, iterations = 200) => {
    if (!filledMask) return;
    const filledIndices = [];
    for (let i = 0; i < filledMask.length; i++) {
        if (filledMask[i]) filledIndices.push(i);
    }
    if (filledIndices.length === 0) return;

    for (let iter = 0; iter < iterations; iter++) {
        let updated = false;
        for (let i = 0; i < filledIndices.length; i++) {
            const idx = filledIndices[i];
            const y = (idx / width) | 0;
            const x = idx - y * width;
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
        if (!updated) break;
    }
};

const boxBlurHorizontal = (src, dst, width, height, radius, noData) => {
    for (let y = 0; y < height; y++) {
        const rowOff = y * width;
        let sum = 0;
        let count = 0;

        for (let k = 0; k <= Math.min(width - 1, radius); k++) {
            const val = src[rowOff + k];
            if (val !== noData) {
                sum += val;
                count++;
            }
        }

        for (let x = 0; x < width; x++) {
            dst[rowOff + x] = count > 0 ? sum / count : noData;

            const removeX = x - radius;
            if (removeX >= 0) {
                const removeVal = src[rowOff + removeX];
                if (removeVal !== noData) {
                    sum -= removeVal;
                    count--;
                }
            }

            const addX = x + radius + 1;
            if (addX < width) {
                const addVal = src[rowOff + addX];
                if (addVal !== noData) {
                    sum += addVal;
                    count++;
                }
            }
        }
    }
};

const boxBlurVertical = (src, dst, width, height, radius, noData) => {
    for (let x = 0; x < width; x++) {
        let sum = 0;
        let count = 0;

        for (let k = 0; k <= Math.min(height - 1, radius); k++) {
            const val = src[k * width + x];
            if (val !== noData) {
                sum += val;
                count++;
            }
        }

        for (let y = 0; y < height; y++) {
            dst[y * width + x] = count > 0 ? sum / count : noData;

            const removeY = y - radius;
            if (removeY >= 0) {
                const removeVal = src[removeY * width + x];
                if (removeVal !== noData) {
                    sum -= removeVal;
                    count--;
                }
            }

            const addY = y + radius + 1;
            if (addY < height) {
                const addVal = src[addY * width + x];
                if (addVal !== noData) {
                    sum += addVal;
                    count++;
                }
            }
        }
    }
};

const smoothHeightMap = (heightMap, width, height, noData) => {
    const radius = 8;
    const tempMap = new Float32Array(heightMap.length);
    boxBlurHorizontal(heightMap, tempMap, width, height, radius, noData);
    boxBlurVertical(tempMap, heightMap, width, height, radius, noData);
    boxBlurHorizontal(heightMap, tempMap, width, height, radius, noData);
    boxBlurVertical(tempMap, heightMap, width, height, radius, noData);
};

/**
 * Post-processing pipeline applied to a freshly resampled heightmap:
 *  1. Hole filling  — pushPull seed → expandFill propagation → Laplacian relax
 *  2. Smoothing     — separable box blur (GPXZ coarse-data mode only)
 */
const finalizeHeightMap = (heightMap, width, height, noData, smooth, fillHoles) => {
    if (fillHoles) {
        debugLog('[ResamplerWorker] Hole filling enabled: starting push/pull seed');
        const seededMask = pushPullInpaint(heightMap, width, height, noData);
        const expandedMask = expandFill(heightMap, width, height, noData, 64, 3, seededMask);
        relaxFilled(heightMap, width, height, noData, expandedMask || seededMask, 200);
    }

    if (smooth) {
        smoothHeightMap(heightMap, width, height, noData);
    }
};

const resampleHeight = async ({ center, width, height, targetBounds = null, smooth, fillHoles = true, tiles, fallback, epsgDefs }) => {
    const heightMap = new Float32Array(width * height);
    const toWGS84 = createLocalToWGS84(center.lat, center.lng);

    const NO_DATA = -99999;
    const preparedGroups = await buildPreparedTileGroups(tiles, epsgDefs, NO_DATA);

    // Main resampling loop
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const [lng, lat] = getPixelLatLng(x, y, width, height, toWGS84, targetBounds);

            let h = sampleHeightAt(lng, lat, preparedGroups, fallback, NO_DATA);

            if (!Number.isFinite(h) || h <= -200 || h === NO_DATA) h = NO_DATA;
            heightMap[y * width + x] = h;
        }
    }

    finalizeHeightMap(heightMap, width, height, NO_DATA, smooth, fillHoles);

    return {
        heightMap,
        bounds: getOutputBounds(toWGS84, width, height, targetBounds),
    };
};

const resampleHeightAndImage = async ({ center, width, height, targetBounds = null, smooth, fillHoles = true, tiles, fallback, epsgDefs, imageSource }) => {
    const heightMap = new Float32Array(width * height);
    const rgbaBuffer = new Uint8ClampedArray(width * height * 4);
    const toWGS84 = createLocalToWGS84(center.lat, center.lng);
    const NO_DATA = -99999;
    const preparedGroups = await buildPreparedTileGroups(tiles, epsgDefs, NO_DATA);

    for (let y = 0; y < height; y++) {
        const rowOffset = y * width;
        const rowPixelOffset = rowOffset * 4;
        for (let x = 0; x < width; x++) {
            const [lng, lat] = getPixelLatLng(x, y, width, height, toWGS84, targetBounds);

            let h = sampleHeightAt(lng, lat, preparedGroups, fallback, NO_DATA);
            if (!Number.isFinite(h) || h <= -200 || h === NO_DATA) h = NO_DATA;
            heightMap[rowOffset + x] = h;

            writeSampledImagePixel(
                rgbaBuffer,
                rowPixelOffset + x * 4,
                imageSource.pixels,
                imageSource.width,
                imageSource.height,
                imageSource.zoom,
                imageSource.minTileX,
                imageSource.minTileY,
                lat,
                lng,
            );
        }
    }

    finalizeHeightMap(heightMap, width, height, NO_DATA, smooth, fillHoles);

    return {
        heightMap,
        rgbaBuffer,
        bounds: getOutputBounds(toWGS84, width, height, targetBounds),
    };
};

// ─── Image Resampling ────────────────────────────────────────────────────────
const resampleImageData = ({ center, width, height, targetBounds = null, imageSource }) => {
    const rgbaBuffer = new Uint8ClampedArray(width * height * 4);
    const toWGS84 = createLocalToWGS84(center.lat, center.lng);

    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const [lng, lat] = getPixelLatLng(x, y, width, height, toWGS84, targetBounds);
            const idx = (y * width + x) * 4;
            writeSampledImagePixel(
                rgbaBuffer,
                idx,
                imageSource.pixels,
                imageSource.width,
                imageSource.height,
                imageSource.zoom,
                imageSource.minTileX,
                imageSource.minTileY,
                lat,
                lng,
            );
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
        } else if (type === 'resampleHeightAndImage') {
            const result = await resampleHeightAndImage(params);
            self.postMessage(
                {
                    id,
                    type: 'result',
                    heightMap: result.heightMap,
                    rgbaBuffer: result.rgbaBuffer,
                    bounds: result.bounds,
                },
                [result.heightMap.buffer, result.rgbaBuffer.buffer]
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
