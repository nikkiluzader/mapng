import proj4 from 'proj4';
import * as GeoTIFF from 'geotiff';
import { createLocalToWGS84 } from './geoUtils';

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
    return {
        north: nw[1],
        west: nw[0],
        south: se[1],
        east: se[0],
    };
};

/**
 * Resamples a source raster (GeoTIFF or generic sampler) to a 1 meter/pixel grid
 * centered at the given location.
 */
const pushPullInpaint = (map, width, height, noData) => {
    let hasHole = false;
    let sumValid = 0;
    let countValid = 0;
    for (let i = 0; i < map.length; i++) {
        const v = map[i];
        if (v === noData || !Number.isFinite(v)) { hasHole = true; }
        else { sumValid += v; countValid++; }
    }
    if (!hasHole) {
        console.debug('[Resampler] No holes detected, skipping inpaint');
        return null;
    }

    const fallback = countValid > 0 ? sumValid / countValid : 0;
    const levels = [{ data: new Float32Array(map), w: width, h: height }];

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
        const filledMask = new Uint8Array(fine.data.length);

        for (let y = 0; y < fine.h; y++) {
            const cy = y * 0.5;
            const y0 = Math.floor(cy);
            const fy = cy - y0;
            const y1 = Math.min(coarse.h - 1, y0 + 1);
            for (let x = 0; x < fine.w; x++) {
                const idx = y * fine.w + x;
                if (fine.data[idx] !== noData && Number.isFinite(fine.data[idx])) continue;
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
                filledMask[idx] = 1;
            }
        }

        levels[li].mask = filledMask;
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

const relaxFilled = (map, width, height, noData, filledMask, iterations = 120) => {
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

export const resampleToMeterGrid = async (
    source,
    center,
    width,
    height,
    _interpolation = 'bilinear',
    smooth = false,
    fillHoles = true,
    targetBounds = null
) => {
    
    const heightMap = new Float32Array(width * height);
    
    // Use shared local Transverse Mercator projection
    const toWGS84 = createLocalToWGS84(center.lat, center.lng);

    const tiles = [];

    if (source.type === 'geotiff' && source.data) {
        for (const item of source.data) {
            const image = item.image;
            const raster = item.raster;
            const width = image.getWidth();
            const height = image.getHeight();
            const [originX, originY] = image.getOrigin();
            const [resX, resY] = image.getResolution();
            const noData = Number.isFinite(image.getGDALNoData()) ? image.getGDALNoData() : -99999;

            const geoKeys = image.getGeoKeys();
            const epsgCode = geoKeys.ProjectedCSTypeGeoKey || geoKeys.GeographicTypeGeoKey;
            
            let converter = null;

            if (epsgCode) {
                const epsg = `EPSG:${epsgCode}`;
                
                // Check if definition exists, if not fetch it
                try {
                    if (!proj4.defs(epsg)) {
                        console.log(`[Resampler] Fetching Proj4 definition for ${epsg}...`);
                        const response = await fetch(`https://epsg.io/${epsgCode}.proj4`);
                        if (response.ok) {
                            const def = await response.text();
                            proj4.defs(epsg, def);
                            console.log(`[Resampler] Loaded definition for ${epsg}`);
                        } else {
                            console.warn(`[Resampler] Failed to fetch definition for ${epsg}`);
                        }
                    }
                    
                    converter = proj4('EPSG:4326', epsg);
                } catch (e) {
                    console.warn(`Proj4 definition for ${epsg} missing or invalid, assuming WGS84 if 4326`, e);
                    if (epsgCode === 4326) {
                        converter = { forward: (p) => p };
                    }
                }
            } else {
                // Fallback for missing EPSG code (common in some web-served GeoTIFFs like GPXZ)
                console.warn("[Resampler] No EPSG code found in GeoTIFF keys. Assuming EPSG:4326 (Lat/Lon).");
                converter = { forward: (p) => p };
            }

            if (converter) {
                tiles.push({
                    raster,
                    width,
                    height,
                    originX,
                    originY,
                    resX,
                    resY,
                    noData,
                    converter
                });
            }
        }
    }

    // Helper for bilinear interpolation
    const bilinear = (raster, w, x, y, noDataVal) => {
        const x0 = Math.floor(x);
        const y0 = Math.floor(y);
        const dx = x - x0;
        const dy = y - y0;
        
        const i00 = y0 * w + x0;
        const i10 = i00 + 1;
        const i01 = (y0 + 1) * w + x0;
        const i11 = i01 + 1;
        
        // Boundary check
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

    // Iterate over the target grid (1m per pixel)
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const [lng, lat] = getPixelLatLng(x, y, width, height, toWGS84, targetBounds);

            let h = -99999; // Match terrain.ts NO_DATA_VALUE

            if (source.type === 'geotiff' && tiles.length > 0) {
                // Try to find a tile that covers this point
                for (const tile of tiles) {
                    // Convert Lat/Lon to TIFF CRS
                    const [tx, ty] = tile.converter.forward([lng, lat]);
                    
                    // Map to TIFF pixel space
                    const px = (tx - tile.originX) / tile.resX;
                    const py = (ty - tile.originY) / tile.resY;

                    if (px >= 0 && px < tile.width - 1 && py >= 0 && py < tile.height - 1) {
                        const val = bilinear(tile.raster, tile.width, px, py, tile.noData);
                        if (val !== tile.noData) {
                            h = val;
                            break; // Found valid data, stop searching
                        }
                    }
                }
            } 
            
            // Fallback to sampler if GeoTIFF failed or returned NoData
            if (h === -99999 && source.sampler) {
                h = source.sampler(lat, lng);
            }

            if (!Number.isFinite(h) || h <= -200 || h === -99999) h = -99999;
            heightMap[y * width + x] = h;
        }
    }

    // Fill holes introduced by missing Terrarium tiles or GeoTIFF nodata (skip when disabled)
    if (fillHoles) {
        console.debug('[Resampler] Hole filling enabled: starting push/pull seed');
        const seededMask = pushPullInpaint(heightMap, width, height, -99999);
        console.debug('[Resampler] Push/pull seed complete');
        const expandedMask = expandFill(heightMap, width, height, -99999, 64, 3, seededMask);
        console.debug('[Resampler] Expand fill complete');
        relaxFilled(heightMap, width, height, -99999, expandedMask || seededMask, 200);
        console.debug('[Resampler] Relaxation complete');
    }

    // Apply smoothing if requested
    if (smooth) {
        console.log("[Resampler] Applying smoothing pass (Dual Separable Box Blur)...");
        
        // O(1) per-pixel box blur using running sum (sliding window).
        // ~17x faster than naive O(radius) approach for radius=8.
        const radius = 8; 
        const tempMap = new Float32Array(heightMap.length);
        const NO_DATA = -99999;
        
        const blurH = (src, dst) => {
            for (let y = 0; y < height; y++) {
                const rowOff = y * width;
                let sum = 0, count = 0;
                // Initialize window for x=0
                for (let k = 0; k <= radius && k < width; k++) {
                    const val = src[rowOff + k];
                    if (val !== NO_DATA) { sum += val; count++; }
                }
                for (let x = 0; x < width; x++) {
                    // Add right edge entering the window
                    const addX = x + radius;
                    if (addX < width && addX > radius) { // only if not already counted in init
                        const val = src[rowOff + addX];
                        if (val !== NO_DATA) { sum += val; count++; }
                    }
                    // Remove left edge leaving the window
                    const remX = x - radius - 1;
                    if (remX >= 0) {
                        const val = src[rowOff + remX];
                        if (val !== NO_DATA) { sum -= val; count--; }
                    }
                    dst[rowOff + x] = count > 0 ? sum / count : NO_DATA;
                }
            }
        };

        const blurV = (src, dst) => {
            for (let x = 0; x < width; x++) {
                let sum = 0, count = 0;
                // Initialize window for y=0
                for (let k = 0; k <= radius && k < height; k++) {
                    const val = src[k * width + x];
                    if (val !== NO_DATA) { sum += val; count++; }
                }
                for (let y = 0; y < height; y++) {
                    const addY = y + radius;
                    if (addY < height && addY > radius) {
                        const val = src[addY * width + x];
                        if (val !== NO_DATA) { sum += val; count++; }
                    }
                    const remY = y - radius - 1;
                    if (remY >= 0) {
                        const val = src[remY * width + x];
                        if (val !== NO_DATA) { sum -= val; count--; }
                    }
                    dst[y * width + x] = count > 0 ? sum / count : NO_DATA;
                }
            }
        };

        // Pass 1
        blurH(heightMap, tempMap);
        blurV(tempMap, heightMap);
        
        // Pass 2
        blurH(heightMap, tempMap);
        blurV(tempMap, heightMap);
    }

    return {
        heightMap,
        bounds: getOutputBounds(toWGS84, width, height, targetBounds),
    };
};

/**
 * Resamples an image source (Canvas/Image) to a 1 meter/pixel grid
 * centered at the given location.
 */
export const resampleImageToMeterGrid = async (
    source,
    center,
    width,
    height,
    targetBounds = null
) => {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error("Could not create canvas context");
    
    const imageData = ctx.createImageData(width, height);
    const data = imageData.data;

    // Use shared local Transverse Mercator projection
    const toWGS84 = createLocalToWGS84(center.lat, center.lng);

    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const [lng, lat] = getPixelLatLng(x, y, width, height, toWGS84, targetBounds);
            
            const color = source.sampler(lat, lng);
            
            const idx = (y * width + x) * 4;
            data[idx] = color.r;
            data[idx + 1] = color.g;
            data[idx + 2] = color.b;
            data[idx + 3] = color.a;
        }
    }
    
    ctx.putImageData(imageData, 0, 0);
    return canvas;
};

