import proj4 from 'proj4';
import * as GeoTIFF from 'geotiff';
import { LatLng, Bounds } from '../types';

/**
 * Resamples a source raster (GeoTIFF or generic sampler) to a 1 meter/pixel grid
 * centered at the given location.
 */
export const resampleToMeterGrid = async (
    source: {
        type: 'geotiff' | 'sampler',
        data?: { image: GeoTIFF.GeoTIFFImage, raster: Float32Array | Int16Array },
        sampler?: (lat: number, lng: number) => number
    },
    center: LatLng,
    width: number,
    height: number,
    _interpolation: 'bilinear' | 'cubic' = 'bilinear'
): Promise<{ heightMap: Float32Array, bounds: Bounds }> => {
    
    const heightMap = new Float32Array(width * height);
    
    // Define a local projection centered on the target area
    // Transverse Mercator is good for local scale accuracy
    const localProjDef = `+proj=tmerc +lat_0=${center.lat} +lon_0=${center.lng} +k=1 +x_0=0 +y_0=0 +datum=WGS84 +units=m +no_defs`;
    const toWGS84 = proj4(localProjDef, 'EPSG:4326');

    // Calculate the extent in meters (centered at 0,0 in local proj)
    const halfWidth = width / 2;
    const halfHeight = height / 2;

    // Pre-calculate GeoTIFF converter if needed
    let tiffConverter: any = null;
    let tiffWidth = 0;
    let tiffHeight = 0;
    let tiffOriginX = 0;
    let tiffOriginY = 0;
    let tiffResX = 0;
    let tiffResY = 0;
    let tiffRaster: Float32Array | Int16Array | null = null;
    let noData = -99999; // Match terrain.ts NO_DATA_VALUE

    if (source.type === 'geotiff' && source.data) {
        const image = source.data.image;
        tiffRaster = source.data.raster;
        tiffWidth = image.getWidth();
        tiffHeight = image.getHeight();
        [tiffOriginX, tiffOriginY] = image.getOrigin();
        [tiffResX, tiffResY] = image.getResolution();
        noData = image.getGDALNoData() ?? -99999;

        const geoKeys = image.getGeoKeys();
        const epsgCode = geoKeys.ProjectedCSTypeGeoKey || geoKeys.GeographicTypeGeoKey;
        
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
                
                tiffConverter = proj4('EPSG:4326', epsg);
            } catch (e) {
                console.warn(`Proj4 definition for ${epsg} missing or invalid, assuming WGS84 if 4326`, e);
                if (epsgCode === 4326) {
                    tiffConverter = { forward: (p: number[]) => p };
                }
            }
        } else {
            // Fallback for missing EPSG code (common in some web-served GeoTIFFs like GPXZ)
            console.warn("[Resampler] No EPSG code found in GeoTIFF keys. Assuming EPSG:4326 (Lat/Lon).");
            tiffConverter = { forward: (p: number[]) => p };
        }
    }

    // Helper for bilinear interpolation
    const bilinear = (raster: Float32Array | Int16Array, w: number, x: number, y: number, noDataVal: number) => {
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

            if (source.type === 'geotiff' && tiffConverter && tiffRaster) {
                // Convert Lat/Lon to TIFF CRS
                const [tx, ty] = tiffConverter.forward([lng, lat]);
                
                // Map to TIFF pixel space
                const px = (tx - tiffOriginX) / tiffResX;
                const py = (ty - tiffOriginY) / tiffResY;

                if (px >= 0 && px < tiffWidth - 1 && py >= 0 && py < tiffHeight - 1) {
                    h = bilinear(tiffRaster, tiffWidth, px, py, noData);
                }
            } else if (source.type === 'sampler' && source.sampler) {
                h = source.sampler(lat, lng);
            }

            heightMap[y * width + x] = h;
        }
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
    source: {
        sampler: (lat: number, lng: number) => { r: number, g: number, b: number, a: number }
    },
    center: LatLng,
    width: number,
    height: number
): Promise<HTMLCanvasElement> => {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error("Could not create canvas context");
    
    const imageData = ctx.createImageData(width, height);
    const data = imageData.data;

    // Define local projection (same as heightmap)
    const localProjDef = `+proj=tmerc +lat_0=${center.lat} +lon_0=${center.lng} +k=1 +x_0=0 +y_0=0 +datum=WGS84 +units=m +no_defs`;
    const toWGS84 = proj4(localProjDef, 'EPSG:4326');

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

