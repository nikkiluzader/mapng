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
import { getBuiltInProj4 } from './uploadGeoMetadata.js';
import { sampleSatelliteTexture } from './satelliteImageSampler.js';

const DEBUG_RESAMPLER = false;
const debugLog = (...args) => {
    if (DEBUG_RESAMPLER) console.debug(...args);
};

const LARGE_HOLE_SKIP_RATIO = 0.35;

const createProgressReporter = (id) => {
    const lastPercentByStage = new Map();
    return ({ stage, message, current = 0, total = 1, force = false }) => {
        const safeTotal = Math.max(1, total);
        const percent = Math.max(0, Math.min(100, (current / safeTotal) * 100));
        const rounded = Math.floor(percent);
        const previous = lastPercentByStage.get(stage) ?? -1;
        if (!force && rounded <= previous) return;
        lastPercentByStage.set(stage, rounded);
        self.postMessage({ id, type: 'progress', stage, message, current, total: safeTotal, percent });
    };
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
    let validSum = 0, validCnt = 0;
    if (h00 !== noDataVal) { validSum += h00; validCnt++; }
    if (h10 !== noDataVal) { validSum += h10; validCnt++; }
    if (h01 !== noDataVal) { validSum += h01; validCnt++; }
    if (h11 !== noDataVal) { validSum += h11; validCnt++; }
    if (validCnt === 0) return noDataVal;
    if (validCnt < 4) return validSum / validCnt;

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

    let validSum = 0, validCnt = 0;
    if (h00 !== noDataVal) { validSum += h00; validCnt++; }
    if (h10 !== noDataVal) { validSum += h10; validCnt++; }
    if (h01 !== noDataVal) { validSum += h01; validCnt++; }
    if (h11 !== noDataVal) { validSum += h11; validCnt++; }
    if (validCnt === 0) return noDataVal;
    if (validCnt < 4) return validSum / validCnt;

    const top = (1 - dx) * h00 + dx * h10;
    const bottom = (1 - dx) * h01 + dx * h11;
    return (1 - dy) * top + dy * bottom;
};

// ─── Satellite Pixel Sampler ─────────────────────────────────────────────────
// Satellite texture at imageWidth × imageHeight (may be finer than the grid,
// baseTextureSize.js). If the larger buffer cannot be allocated, fall back to
// one texel per grid square rather than failing the whole run.
const resampleSatelliteImage = ({ width, height, imageWidth, imageHeight, toWGS84, targetBounds, imageSource }) => {
    let outWidth = imageWidth || width;
    let outHeight = imageHeight || height;
    let out;
    try {
        out = new Uint8ClampedArray(outWidth * outHeight * 4);
    } catch (err) {
        if (outWidth === width && outHeight === height) throw err;
        console.warn(`[ResamplerWorker] ${outWidth}x${outHeight} satellite texture could not be allocated; using ${width}x${height}`);
        outWidth = width;
        outHeight = height;
        out = new Uint8ClampedArray(outWidth * outHeight * 4);
    }
    const originX = imageSource.minTileX * TILE_SIZE;
    const originY = imageSource.minTileY * TILE_SIZE;
    const gridToMosaic = (gx, gy) => {
        const [lng, lat] = getPixelLatLng(gx, gy, width, height, toWGS84, targetBounds);
        const p = project(lat, lng, imageSource.zoom);
        return [p.x - originX, p.y - originY];
    };
    sampleSatelliteTexture({
        width,
        height,
        outWidth,
        outHeight,
        mosaic: { pixels: imageSource.pixels, width: imageSource.width, height: imageSource.height },
        gridToMosaic,
        out,
    });
    return { rgbaBuffer: out, imageWidth: outWidth, imageHeight: outHeight };
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

// ─── Gap fill with a secondary elevation source ──────────────────────────────

// The offset between two elevation sources is smooth and long-wavelength (datum
// and vintage differences, not terrain), so it is solved on a coarse grid and
// interpolated back up. 256 cells across is far finer than the offset varies.
const DELTA_GRID_MAX = 256;
const DELTA_SOLVE_ITERATIONS = 400;
// Half-width, in output pixels, of the cosmetic smoothing band on the seam.
const SEAM_FEATHER_RADIUS = 3;

/**
 * Solve a harmonic (Laplace) extension of scattered samples across a coarse
 * grid: cells holding a sample are fixed, every other cell relaxes to the
 * average of its neighbours. Gauss-Seidel, red-black-free — the field is smooth
 * and the grid tiny, so plain sweeps converge fine.
 */
const solveCoarseDeltaField = (sum, count, gw, gh) => {
    const field = new Float32Array(gw * gh);
    const fixed = new Uint8Array(gw * gh);
    let seeded = 0;
    let seedTotal = 0;
    for (let i = 0; i < field.length; i++) {
        if (count[i] > 0) {
            field[i] = sum[i] / count[i];
            fixed[i] = 1;
            seeded++;
            seedTotal += field[i];
        }
    }
    if (seeded === 0) return null;

    // Seed the free cells with the mean so the relaxation starts close to the
    // answer instead of walking out from zero.
    const mean = seedTotal / seeded;
    for (let i = 0; i < field.length; i++) {
        if (!fixed[i]) field[i] = mean;
    }

    for (let iter = 0; iter < DELTA_SOLVE_ITERATIONS; iter++) {
        let maxChange = 0;
        for (let y = 0; y < gh; y++) {
            const row = y * gw;
            for (let x = 0; x < gw; x++) {
                const idx = row + x;
                if (fixed[idx]) continue;
                const left = x > 0 ? field[idx - 1] : field[idx];
                const right = x < gw - 1 ? field[idx + 1] : field[idx];
                const up = y > 0 ? field[idx - gw] : field[idx];
                const down = y < gh - 1 ? field[idx + gw] : field[idx];
                const next = (left + right + up + down) / 4;
                const change = Math.abs(next - field[idx]);
                if (change > maxChange) maxChange = change;
                field[idx] = next;
            }
        }
        if (maxChange < 1e-4) break;
    }

    return field;
};

/**
 * Splice a secondary elevation source into the holes of a primary one.
 *
 * Uploaded LiDAR and the global dataset never agree in absolute terms — they
 * differ by metres to tens of metres from vertical datum and survey vintage —
 * so dropping raw fallback values into the gaps leaves a cliff around every
 * patch. Instead the *offset* between the two surfaces is measured along the
 * seam, extended smoothly across the gap (harmonic extension of the delta
 * field), and added to the fallback. The patched surface then meets the real
 * data exactly at the seam and relaxes to the fallback's own shape away from
 * it — the standard offset-blend used for merging DEMs.
 *
 * @returns {{ filled: number, holes: number, seamPixels: number, meanDelta: number }|null}
 */
export const blendGapFillIntoHoles = (heightMap, fillMap, width, height, noData) => {
    const total = width * height;
    const isHole = new Uint8Array(total);
    let holeCount = 0;
    for (let i = 0; i < total; i++) {
        if (heightMap[i] === noData || !Number.isFinite(heightMap[i])) {
            isHole[i] = 1;
            holeCount++;
        }
    }
    if (holeCount === 0 || holeCount === total) {
        // Nothing to blend, or nothing to blend *against* — with no primary data
        // anywhere the fallback stands on its own and needs no offset.
        if (holeCount === total) {
            let filled = 0;
            for (let i = 0; i < total; i++) {
                const v = fillMap[i];
                if (v !== noData && Number.isFinite(v)) { heightMap[i] = v; filled++; }
            }
            return { filled, holes: holeCount, seamPixels: 0, meanDelta: 0 };
        }
        return null;
    }

    // ── 1. Measure the offset along the seam ─────────────────────────────────
    const gw = Math.max(2, Math.min(DELTA_GRID_MAX, width));
    const gh = Math.max(2, Math.min(DELTA_GRID_MAX, height));
    const sum = new Float64Array(gw * gh);
    const count = new Uint32Array(gw * gh);
    const seamMask = new Uint8Array(total);
    let seamPixels = 0;
    let deltaTotal = 0;

    for (let y = 0; y < height; y++) {
        const row = y * width;
        for (let x = 0; x < width; x++) {
            const idx = row + x;
            if (isHole[idx]) continue;
            const fillValue = fillMap[idx];
            if (fillValue === noData || !Number.isFinite(fillValue)) continue;
            // Real data touching a hole: this is where the two surfaces must meet.
            const touchesHole = (x > 0 && isHole[idx - 1])
                || (x < width - 1 && isHole[idx + 1])
                || (y > 0 && isHole[idx - width])
                || (y < height - 1 && isHole[idx + width]);
            if (!touchesHole) continue;

            const delta = heightMap[idx] - fillValue;
            const gx = Math.min(gw - 1, ((x * gw / width) | 0));
            const gy = Math.min(gh - 1, ((y * gh / height) | 0));
            const gIdx = gy * gw + gx;
            sum[gIdx] += delta;
            count[gIdx]++;
            seamMask[idx] = 1;
            seamPixels++;
            deltaTotal += delta;
        }
    }

    // ── 2. Extend the offset across the gaps ─────────────────────────────────
    const field = solveCoarseDeltaField(sum, count, gw, gh);
    const meanDelta = seamPixels > 0 ? deltaTotal / seamPixels : 0;

    const sampleDelta = (x, y) => {
        if (!field) return meanDelta;
        // Bilinear read of the coarse field at this pixel's fractional cell.
        const fx = Math.min(gw - 1, Math.max(0, (x + 0.5) * gw / width - 0.5));
        const fy = Math.min(gh - 1, Math.max(0, (y + 0.5) * gh / height - 0.5));
        const x0 = fx | 0;
        const y0 = fy | 0;
        const x1 = Math.min(gw - 1, x0 + 1);
        const y1 = Math.min(gh - 1, y0 + 1);
        const tx = fx - x0;
        const ty = fy - y0;
        const top = field[y0 * gw + x0] * (1 - tx) + field[y0 * gw + x1] * tx;
        const bottom = field[y1 * gw + x0] * (1 - tx) + field[y1 * gw + x1] * tx;
        return top * (1 - ty) + bottom * ty;
    };

    // ── 3. Patch the holes ───────────────────────────────────────────────────
    let filled = 0;
    for (let y = 0; y < height; y++) {
        const row = y * width;
        for (let x = 0; x < width; x++) {
            const idx = row + x;
            if (!isHole[idx]) continue;
            const fillValue = fillMap[idx];
            // No fallback coverage either — leave it for the inpainter.
            if (fillValue === noData || !Number.isFinite(fillValue)) continue;
            heightMap[idx] = fillValue + sampleDelta(x, y);
            filled++;
        }
    }

    // ── 4. Soften the crease ─────────────────────────────────────────────────
    // The offset blend guarantees the two surfaces meet at the same height, but
    // their slopes still differ (0.5 m LiDAR against a ~30 m global dataset), so
    // the seam reads as a crease. Average across a narrow band centred on it,
    // weighted to fade out at the band edge, which leaves real data untouched
    // more than a few pixels in.
    featherSeam(heightMap, seamMask, isHole, width, height, noData);

    return { filled, holes: holeCount, seamPixels, meanDelta };
};

/**
 * Blend each pixel near a seam toward the local average of its neighbourhood,
 * with a weight that peaks on the seam and reaches zero SEAM_FEATHER_RADIUS
 * pixels away. Operates on a snapshot so the pass is order-independent.
 */
const featherSeam = (map, seamMask, isHole, width, height, noData) => {
    const radius = SEAM_FEATHER_RADIUS;
    // Distance-to-seam, capped at radius + 1 (anything further is left alone).
    const distance = new Uint8Array(width * height).fill(radius + 1);
    const queue = [];
    for (let i = 0; i < seamMask.length; i++) {
        if (seamMask[i]) { distance[i] = 0; queue.push(i); }
    }
    if (queue.length === 0) return;

    // Breadth-first expansion outward from the seam, in both directions.
    for (let head = 0; head < queue.length; head++) {
        const idx = queue[head];
        const d = distance[idx];
        if (d >= radius) continue;
        const y = (idx / width) | 0;
        const x = idx - y * width;
        const push = (nx, ny) => {
            if (nx < 0 || nx >= width || ny < 0 || ny >= height) return;
            const nIdx = ny * width + nx;
            if (distance[nIdx] <= d + 1) return;
            // Never pull an un-patched hole into the average; it is still NO_DATA.
            if (isHole[nIdx] && (map[nIdx] === noData || !Number.isFinite(map[nIdx]))) return;
            distance[nIdx] = d + 1;
            queue.push(nIdx);
        };
        push(x - 1, y); push(x + 1, y); push(x, y - 1); push(x, y + 1);
    }

    const snapshot = new Float32Array(map);
    for (const idx of queue) {
        const d = distance[idx];
        if (d > radius) continue;
        const y = (idx / width) | 0;
        const x = idx - y * width;
        let sum = 0;
        let cnt = 0;
        for (let dy = -1; dy <= 1; dy++) {
            const ny = y + dy;
            if (ny < 0 || ny >= height) continue;
            const base = ny * width;
            for (let dx = -1; dx <= 1; dx++) {
                const nx = x + dx;
                if (nx < 0 || nx >= width) continue;
                const v = snapshot[base + nx];
                if (v === noData || !Number.isFinite(v)) continue;
                sum += v;
                cnt++;
            }
        }
        if (cnt === 0) continue;
        // 1 on the seam, fading to 0 at the band edge.
        const weight = 0.5 * (1 - d / (radius + 1));
        map[idx] = snapshot[idx] * (1 - weight) + (sum / cnt) * weight;
    }
};

/**
 * Split tiles into their priority layers and prepare each one independently.
 *
 * Tiles carry a `layerIndex` assigned from the user's layer ordering (see
 * elevationLayers.js). Layer 0 is the base survey; each later layer only gets
 * consulted where everything before it came up empty.
 *
 * @returns {Array<Array<object>>} prepared CRS groups, one entry per layer
 */
const buildLayerStack = async (tiles, epsgDefs, noData) => {
    if (!tiles?.length) return [];
    const byLayer = new Map();
    for (const tile of tiles) {
        const index = Number.isFinite(tile.layerIndex) ? tile.layerIndex : 0;
        if (!byLayer.has(index)) byLayer.set(index, []);
        byLayer.get(index).push(tile);
    }
    const ordered = [...byLayer.keys()].sort((a, b) => a - b);
    const stack = [];
    for (const index of ordered) {
        stack.push(await buildPreparedTileGroups(byLayer.get(index), epsgDefs, noData));
    }
    return stack;
};

/**
 * Ready a secondary elevation source for gap filling.
 *
 * Two shapes feed in: geo-referenced rasters (GPXZ hires chunks, arriving in the
 * same {raster, origin, res, epsg} form as an upload) and the global Terrarium
 * mosaic. Both end up behind one sampler.
 */
const prepareGapFill = async (gapFillTiles, gapFillEpsgDefs, fallback, noData) => {
    const groups = gapFillTiles?.length
        ? await buildPreparedTileGroups(gapFillTiles, gapFillEpsgDefs, noData)
        : [];
    if (groups.length === 0 && !fallback) return null;
    return {
        sample: (lng, lat) => sampleHeightAt(lng, lat, groups, fallback, noData),
        label: groups.length ? 'high-res gap-fill tiles' : 'global elevation tiles',
    };
};

/**
 * Sample the gap-fill source everywhere the primary source came up empty, then
 * splice it in with a smooth offset (see blendGapFillIntoHoles).
 */
const applyGapFill = (heightMap, width, height, noData, gapFill, toWGS84, targetBounds, reportProgress) => {
    if (!gapFill) return null;

    const total = width * height;
    // Only two kinds of pixel need a value from the filling source: the holes
    // themselves, and the covered pixels immediately around them where the seam
    // offset gets measured. Sampling the rest would be pure waste — for a 90-tile
    // layer that is a tile scan per pixel.
    const needed = new Uint8Array(total);
    let holes = 0;
    for (let y = 0; y < height; y++) {
        const row = y * width;
        for (let x = 0; x < width; x++) {
            const idx = row + x;
            const v = heightMap[idx];
            if (v !== noData && Number.isFinite(v)) continue;
            holes++;
            needed[idx] = 1;
            if (x > 0) needed[idx - 1] = 1;
            if (x < width - 1) needed[idx + 1] = 1;
            if (y > 0) needed[idx - width] = 1;
            if (y < height - 1) needed[idx + width] = 1;
        }
    }
    if (holes === 0) return null;

    const message = `Filling gaps from ${gapFill.label}...`;
    reportProgress?.({ stage: 'gap-fill', message, current: 0, total: height, force: true });

    const fillMap = new Float32Array(total).fill(noData);
    for (let y = 0; y < height; y++) {
        const row = y * width;
        for (let x = 0; x < width; x++) {
            const idx = row + x;
            if (!needed[idx]) continue;
            const [lng, lat] = getPixelLatLng(x, y, width, height, toWGS84, targetBounds);
            let v = gapFill.sample(lng, lat);
            if (!Number.isFinite(v) || v <= -200 || v === noData) v = noData;
            fillMap[idx] = v;
        }
        if ((y & 31) === 31 || y === height - 1) {
            reportProgress?.({ stage: 'gap-fill', message, current: y + 1, total: height });
        }
    }

    const result = blendGapFillIntoHoles(heightMap, fillMap, width, height, noData);
    if (result) {
        console.info(
            `[ResamplerWorker] Gap fill from ${gapFill.label}: patched ${result.filled}/${result.holes} empty pixels `
            + `(${((result.filled / total) * 100).toFixed(1)}% of output), `
            + `seam ${result.seamPixels} px, mean offset ${result.meanDelta.toFixed(2)} m.`,
        );
    }
    return result;
};

/**
 * Run the upload's priority stack: every layer after the base fills what the
 * layers before it left empty, each spliced in with its own seam blend.
 */
const fillFromLayerStack = (heightMap, width, height, noData, layerStack, toWGS84, targetBounds, reportProgress) => {
    for (let index = 1; index < layerStack.length; index++) {
        const groups = layerStack[index];
        if (!groups?.length) continue;
        applyGapFill(heightMap, width, height, noData, {
            sample: (lng, lat) => sampleHeightAt(lng, lat, groups, null, noData),
            label: `elevation layer ${index + 1}`,
        }, toWGS84, targetBounds, reportProgress);
    }
};

const measureNoDataCoverage = (map, noData) => {
    let missing = 0;
    for (let index = 0; index < map.length; index++) {
        const value = map[index];
        if (value === noData || !Number.isFinite(value)) missing++;
    }
    return {
        missing,
        total: map.length,
        ratio: map.length > 0 ? missing / map.length : 0,
    };
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
const finalizeHeightMap = (
    heightMap,
    width,
    height,
    noData,
    smooth,
    fillHoles,
    expandFilledGaps = true,
    reportProgress = null,
) => {
    if (fillHoles) {
        const noDataCoverage = measureNoDataCoverage(heightMap, noData);
        if (noDataCoverage.ratio >= LARGE_HOLE_SKIP_RATIO) {
            reportProgress?.({
                stage: 'finalize',
                message: 'Large unmapped regions detected; preserving gaps instead of synthesizing terrain.',
                current: 3,
                total: 3,
                force: true,
            });
            console.warn(
                `[ResamplerWorker] Skipping hole filling for sparse output (${(noDataCoverage.ratio * 100).toFixed(1)}% no-data).`,
            );
            return;
        }

        reportProgress?.({ stage: 'finalize', message: 'Filling gaps in uploaded elevation...', current: 1, total: 3, force: true });
        debugLog('[ResamplerWorker] Hole filling enabled: starting push/pull seed');
        const seededMask = pushPullInpaint(heightMap, width, height, noData);
        if (!seededMask) {
            reportProgress?.({
                stage: 'finalize',
                message: 'No gaps detected in uploaded elevation.',
                current: 3,
                total: 3,
                force: true,
            });
            return;
        }
        // Gap expansion + relaxation cost scales with pixel count, so the fixed
        // 64-pass / 200-iteration budgets that are fine at 1–2k become a multi-
        // minute hang at 8k–16k — especially when a scan crosses a data-coverage
        // border and leaves a large no-data region (e.g. the edge of Poland's
        // dataset). Scale the iteration budgets down as resolution grows so the
        // absolute work stays bounded; full quality is retained at normal sizes.
        const megapixels = (width * height) / (2048 * 2048);
        const expandPasses = Math.max(8, Math.round(64 / Math.max(1, Math.sqrt(megapixels))));
        const relaxIterations = Math.max(20, Math.round(200 / Math.max(1, megapixels)));

        let relaxMask = seededMask;
        if (expandFilledGaps) {
            reportProgress?.({ stage: 'finalize', message: 'Expanding filled gaps...', current: 2, total: 3, force: true });
            const expandedMask = expandFill(heightMap, width, height, noData, expandPasses, 3, seededMask);
            relaxMask = expandedMask || seededMask;
        } else {
            reportProgress?.({ stage: 'finalize', message: 'Skipping gap expansion for uploaded elevation.', current: 2, total: 3, force: true });
        }
        relaxFilled(heightMap, width, height, noData, relaxMask, relaxIterations);
    }

    if (smooth) {
        reportProgress?.({ stage: 'finalize', message: 'Smoothing uploaded elevation...', current: 3, total: 3, force: true });
        smoothHeightMap(heightMap, width, height, noData);
    } else if (fillHoles) {
        reportProgress?.({ stage: 'finalize', message: 'Uploaded elevation cleanup complete.', current: 3, total: 3, force: true });
    }
};

const resampleHeight = async ({ id, center, width, height, targetBounds = null, smooth, fillHoles = true, expandFilledGaps = true, tiles, fallback, epsgDefs, gapFillTiles = null, gapFillEpsgDefs = null }) => {
    const heightMap = new Float32Array(width * height);
    const toWGS84 = createLocalToWGS84(center.lat, center.lng);

    const NO_DATA = -99999;
    const reportProgress = createProgressReporter(id);
    reportProgress({ stage: 'prepare', message: 'Preparing uploaded elevation tiles...', current: 0, total: 1, force: true });
    const layerStack = await buildLayerStack(tiles, epsgDefs, NO_DATA);
    const preparedGroups = layerStack[0] || [];
    const gapFill = await prepareGapFill(gapFillTiles, gapFillEpsgDefs, fallback, NO_DATA);
    reportProgress({ stage: 'prepare', message: 'Uploaded elevation tiles ready.', current: 1, total: 1, force: true });

    // Main resampling loop. The gap-fill source is sampled separately below so
    // the two surfaces can be joined smoothly instead of butted together.
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const [lng, lat] = getPixelLatLng(x, y, width, height, toWGS84, targetBounds);

            let h = sampleHeightAt(lng, lat, preparedGroups, null, NO_DATA);

            if (!Number.isFinite(h) || h <= -200 || h === NO_DATA) h = NO_DATA;
            heightMap[y * width + x] = h;
        }
        if ((y & 31) === 31 || y === height - 1) {
            reportProgress({
                stage: 'sample-height',
                message: 'Mapping uploaded elevation to the output grid...',
                current: y + 1,
                total: height,
            });
        }
    }

    fillFromLayerStack(heightMap, width, height, NO_DATA, layerStack, toWGS84, targetBounds, reportProgress);
    applyGapFill(heightMap, width, height, NO_DATA, gapFill, toWGS84, targetBounds, reportProgress);
    finalizeHeightMap(heightMap, width, height, NO_DATA, smooth, fillHoles, expandFilledGaps, reportProgress);

    return {
        heightMap,
        bounds: getOutputBounds(toWGS84, width, height, targetBounds),
    };
};

const resampleHeightAndImage = async ({ id, center, width, height, imageWidth, imageHeight, targetBounds = null, smooth, fillHoles = true, expandFilledGaps = true, tiles, fallback, epsgDefs, imageSource, flat = false, gapFillTiles = null, gapFillEpsgDefs = null }) => {
    const heightMap = new Float32Array(width * height);
    const toWGS84 = createLocalToWGS84(center.lat, center.lng);
    const NO_DATA = -99999;
    const reportProgress = createProgressReporter(id);
    // Flat mode: no elevation source — leave heightMap zero-filled and skip both
    // the per-pixel height sampling and hole-filling. The satellite image is
    // still resampled so textures and OSM overlays work normally.
    const layerStack = flat ? [] : await buildLayerStack(tiles, epsgDefs, NO_DATA);
    const preparedGroups = layerStack[0] || [];
    const gapFill = flat ? null : await prepareGapFill(gapFillTiles, gapFillEpsgDefs, fallback, NO_DATA);
    if (!flat) {
        reportProgress({ stage: 'prepare', message: 'Preparing uploaded elevation tiles...', current: 0, total: 1, force: true });
        reportProgress({ stage: 'prepare', message: 'Uploaded elevation tiles ready.', current: 1, total: 1, force: true });
    }

    if (!flat) {
        for (let y = 0; y < height; y++) {
            const rowOffset = y * width;
            for (let x = 0; x < width; x++) {
                const [lng, lat] = getPixelLatLng(x, y, width, height, toWGS84, targetBounds);
                // Gap-fill is sampled and blended in afterwards, not inline, so
                // the seam between the two sources can be joined smoothly.
                let h = sampleHeightAt(lng, lat, preparedGroups, null, NO_DATA);
                if (!Number.isFinite(h) || h <= -200 || h === NO_DATA) h = NO_DATA;
                heightMap[rowOffset + x] = h;
            }
            if ((y & 31) === 31 || y === height - 1) {
                reportProgress({
                    stage: 'sample-height-image',
                    message: 'Mapping uploaded elevation to the output grid...',
                    current: y + 1,
                    total: height,
                });
            }
        }
    }

    reportProgress({ stage: 'sample-image', message: 'Mapping satellite imagery to the output grid...', current: 0, total: 1, force: true });
    const image = resampleSatelliteImage({ width, height, imageWidth, imageHeight, toWGS84, targetBounds, imageSource });
    reportProgress({ stage: 'sample-image', message: 'Mapping satellite imagery to the output grid...', current: 1, total: 1, force: true });

    if (!flat) {
        fillFromLayerStack(heightMap, width, height, NO_DATA, layerStack, toWGS84, targetBounds, reportProgress);
        applyGapFill(heightMap, width, height, NO_DATA, gapFill, toWGS84, targetBounds, reportProgress);
        finalizeHeightMap(heightMap, width, height, NO_DATA, smooth, fillHoles, expandFilledGaps, reportProgress);
    }

    return {
        heightMap,
        rgbaBuffer: image.rgbaBuffer,
        imageWidth: image.imageWidth,
        imageHeight: image.imageHeight,
        bounds: getOutputBounds(toWGS84, width, height, targetBounds),
    };
};

// ─── Image Resampling ────────────────────────────────────────────────────────
const resampleImageData = ({ center, width, height, imageWidth, imageHeight, targetBounds = null, imageSource }) => {
    const toWGS84 = createLocalToWGS84(center.lat, center.lng);
    return resampleSatelliteImage({ width, height, imageWidth, imageHeight, toWGS84, targetBounds, imageSource });
};

// ─── Uploaded raster cache ───────────────────────────────────────────────────
// Single-entry cache of the most recently transferred upload raster set.
// Uploaded GeoTIFF rasters can run to GBs; the client transfers them once
// with rasterCache {mode:'store', key} and repeat runs send raster-less tile
// metadata with {mode:'use', key} (after confirming via 'hasRasterCache').
// 'store' evicts any prior entry so at most one raster set stays resident.
const uploadRasterCache = new Map();

const resolveTileRasters = (tiles, directive) => {
    if (!directive || !Array.isArray(tiles)) return tiles;
    if (directive.mode === 'use') {
        const cached = uploadRasterCache.get(directive.key);
        if (!cached || cached.length !== tiles.length) throw new Error('RASTER_CACHE_MISS');
        return tiles.map((t, i) => ({ ...t, raster: cached[i] }));
    }
    if (directive.mode === 'store') {
        uploadRasterCache.clear();
        uploadRasterCache.set(directive.key, tiles.map((t) => t.raster));
    }
    return tiles;
};

// ─── Message Handler ─────────────────────────────────────────────────────────
self.onmessage = async (e) => {
    const { type, id, ...params } = e.data;

    try {
        if (type === 'resampleHeight' || type === 'resampleHeightAndImage') {
            params.tiles = resolveTileRasters(params.tiles, params.rasterCache);
        }

        if (type === 'hasRasterCache') {
            self.postMessage({ id, type: 'result', has: uploadRasterCache.has(params.key) });
        } else if (type === 'releaseRasterCache') {
            uploadRasterCache.clear();
            self.postMessage({ id, type: 'result', released: true });
        } else if (type === 'resampleHeight') {
            const result = await resampleHeight({ id, ...params });
            self.postMessage(
                { id, type: 'result', heightMap: result.heightMap, bounds: result.bounds },
                [result.heightMap.buffer]
            );
        } else if (type === 'resampleHeightAndImage') {
            const result = await resampleHeightAndImage({ id, ...params });
            self.postMessage(
                {
                    id,
                    type: 'result',
                    heightMap: result.heightMap,
                    rgbaBuffer: result.rgbaBuffer,
                    imageWidth: result.imageWidth,
                    imageHeight: result.imageHeight,
                    bounds: result.bounds,
                },
                [result.heightMap.buffer, result.rgbaBuffer.buffer]
            );
        } else if (type === 'resampleImage') {
            const result = resampleImageData(params);
            self.postMessage(
                { id, type: 'result', rgbaBuffer: result.rgbaBuffer, imageWidth: result.imageWidth, imageHeight: result.imageHeight },
                [result.rgbaBuffer.buffer]
            );
        }
    } catch (err) {
        self.postMessage({ id, type: 'error', error: err.message });
    }
};
