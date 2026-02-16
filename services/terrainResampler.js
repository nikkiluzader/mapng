import proj4 from 'proj4';
import * as GeoTIFF from 'geotiff';
import { createLocalToWGS84 } from './geoUtils';

/**
 * Resamples a source raster (GeoTIFF or generic sampler) to a 1 meter/pixel grid
 * centered at the given location.
 */
export const resampleToMeterGrid = async (
    source,
    center,
    width,
    height,
    _interpolation = 'bilinear',
    smooth = false
) => {
    
    const heightMap = new Float32Array(width * height);
    
    // Use shared local Transverse Mercator projection
    const toWGS84 = createLocalToWGS84(center.lat, center.lng);

    // Calculate the extent in meters (centered at 0,0 in local proj)
    const halfWidth = width / 2;
    const halfHeight = height / 2;

    // Pre-calculate GeoTIFF converters

    const tiles = [];

    if (source.type === 'geotiff' && source.data) {
        for (const item of source.data) {
            const image = item.image;
            const raster = item.raster;
            const width = image.getWidth();
            const height = image.getHeight();
            const [originX, originY] = image.getOrigin();
            const [resX, resY] = image.getResolution();
            const noData = image.getGDALNoData() ?? -99999;

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

        if (h00 === noDataVal || h10 === noDataVal || h01 === noDataVal || h11 === noDataVal) return noDataVal;

        return (1 - dy) * ((1 - dx) * h00 + dx * h10) + dy * ((1 - dx) * h01 + dx * h11);
    };

    // Iterate over the target grid (1m per pixel)
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            // Coordinates in local meter grid (Y goes up in math, but down in image usually. 
            // Let's assume standard image coordinates: (0,0) is top-left.
            // So y=0 is North-most.
            const localX = x - halfWidth;
            const localY = halfHeight - y; // Invert Y so 0 is top (North)

            // Convert to Lat/Lon
            const [lng, lat] = toWGS84.forward([localX, localY]);

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

            heightMap[y * width + x] = h;
        }
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

    // Calculate actual bounds of the generated grid
    const nw = toWGS84.forward([-halfWidth, halfHeight]);
    const se = toWGS84.forward([halfWidth, -halfHeight]);

    return {
        heightMap,
        bounds: {
            north: nw[1],
            west: nw[0],
            south: se[1],
            east: se[0]
        }
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
    height
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

    const halfWidth = width / 2;
    const halfHeight = height / 2;

    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const localX = x - halfWidth;
            const localY = halfHeight - y;

            const [lng, lat] = toWGS84.forward([localX, localY]);
            
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

