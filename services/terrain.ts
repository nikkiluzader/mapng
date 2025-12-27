import { LatLng, TerrainData, Bounds, OSMFeature } from "../types";
import { fetchOSMData } from "./osm";
import { generateOSMTexture, generateHybridTexture } from "./osmTexture";
import * as GeoTIFF from 'geotiff';
import { resampleToMeterGrid, resampleImageToMeterGrid } from './terrainResampler';

// Constants
const TILE_SIZE = 256;
export const TERRAIN_ZOOM = 15; // Fixed high detail zoom level for Terrain
const SATELLITE_ZOOM = 17; // Higher detail zoom level for Satellite (approx 1.2m/px)
const TILE_API_URL = "https://s3.amazonaws.com/elevation-tiles-prod/terrarium";
const SATELLITE_API_URL = "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile";
const USGS_PRODUCT_API = "https://tnmaccess.nationalmap.gov/api/v1/products";
const USGS_DATASET = "Digital Elevation Model (DEM) 1 meter";

// Helper to normalize longitude to -180 to 180
const normalizeLng = (lng: number) => {
  return ((lng + 180) % 360 + 360) % 360 - 180;
};

// Math Helpers for Web Mercator Projection (Source of Truth for Fetching)
const MAX_LATITUDE = 85.05112878;

export const project = (lat: number, lng: number, zoom: number) => {
  const d = Math.PI / 180;
  const max = MAX_LATITUDE;
  const latClamped = Math.max(Math.min(max, lat), -max);
  const sin = Math.sin(latClamped * d);

  const z = TILE_SIZE * Math.pow(2, zoom);
  
  const x = z * (lng + 180) / 360;
  const y = z * (0.5 - 0.25 * Math.log((1 + sin) / (1 - sin)) / Math.PI);

  return { x, y };
};

const NO_DATA_VALUE = -99999;

const fetchGPXZRaw = async (bounds: Bounds, apiKey: string, onProgress?: (status: string) => void): Promise<{ data: { image: GeoTIFF.GeoTIFFImage, raster: Float32Array | Int16Array }[], smooth: boolean, rawArrayBuffers: ArrayBuffer[] } | null> => {
    try {
        // 1. Check Resolution via Points API
        // We check the center point to see what dataset is being used
        const centerLat = (bounds.north + bounds.south) / 2;
        const centerLng = (bounds.east + bounds.west) / 2;
        
        let shouldSmooth = false;
        try {
            const pointsUrl = `https://api.gpxz.io/v1/elevation/points?latlons=${centerLat},${centerLng}`;
            const pointsResp = await fetch(pointsUrl, { headers: { 'x-api-key': apiKey } });
            if (pointsResp.ok) {
                const pointsData = await pointsResp.json();
                if (pointsData.results && pointsData.results.length > 0) {
                    const res = pointsData.results[0].resolution;
                    console.log(`[GPXZ] Dataset Resolution: ${res}m`);
                    // If resolution is worse than 2m (e.g. 10m, 30m), enable smoothing
                    if (res > 2) {
                        shouldSmooth = true;
                        console.log("[GPXZ] Low resolution detected. Enabling smoothing.");
                    }
                }
            }
        } catch (e) {
            console.warn("[GPXZ] Failed to check resolution:", e);
        }

        // 2. Calculate Area & Tiles
        // Calculate Area in km²
        const latDist = (bounds.north - bounds.south) * 111.32;
        const avgLatRad = (bounds.north + bounds.south) / 2 * Math.PI / 180;
        const lonDist = (bounds.east - bounds.west) * 111.32 * Math.cos(avgLatRad);
        const areaKm2 = latDist * lonDist;

        console.log(`[GPXZ] Total Requested Area: ${areaKm2.toFixed(2)} km²`);

        // GPXZ Limit is 10km². We use a safe chunk size of ~9km² (3km x 3km)
        const TARGET_CHUNK_SIDE_KM = 3;
        const BUFFER_DEG = 0.002; // ~220m overlap to prevent seams
        
        // Calculate grid size
        const latSpan = bounds.north - bounds.south;
        const lngSpan = bounds.east - bounds.west;
        
        const metersPerDegLat = 111320;
        const metersPerDegLng = 111320 * Math.cos(avgLatRad);
        
        const chunkLatDeg = (TARGET_CHUNK_SIDE_KM * 1000) / metersPerDegLat;
        const chunkLngDeg = (TARGET_CHUNK_SIDE_KM * 1000) / metersPerDegLng;
        
        const rows = Math.ceil(latSpan / chunkLatDeg);
        const cols = Math.ceil(lngSpan / chunkLngDeg);
        
        const requests: Bounds[] = [];
        
        for (let r = 0; r < rows; r++) {
            for (let c = 0; c < cols; c++) {
                const s = bounds.south + r * (latSpan / rows);
                const n = bounds.south + (r + 1) * (latSpan / rows);
                const w = bounds.west + c * (lngSpan / cols);
                const e = bounds.west + (c + 1) * (lngSpan / cols);
                
                // Normalize longitudes to [-180, 180]
                const normW = normalizeLng(w);
                const normE = normalizeLng(e);
                
                // Check for dateline crossing
                if (w < e && normW > normE) {
                    // Split into two requests
                    // Add buffer to internal edges too
                    requests.push({ 
                        north: n + BUFFER_DEG, 
                        south: s - BUFFER_DEG, 
                        west: normW - BUFFER_DEG, 
                        east: 180 
                    });
                    requests.push({ 
                        north: n + BUFFER_DEG, 
                        south: s - BUFFER_DEG, 
                        west: -180, 
                        east: normE + BUFFER_DEG 
                    });
                } else {
                    requests.push({ 
                        north: n + BUFFER_DEG, 
                        south: s - BUFFER_DEG, 
                        west: normW - BUFFER_DEG, 
                        east: normE + BUFFER_DEG 
                    });
                }
            }
        }
        
        console.log(`[GPXZ] Split into ${requests.length} tiles (with overlap).`);
        onProgress?.(`Fetching ${requests.length} GPXZ tiles...`);

        const results = await pMap(requests, async (reqBounds) => {
             // Enforce 1 request per second rate limit for free tier
             await new Promise(r => setTimeout(r, 1100));

             const url = `https://api.gpxz.io/v1/elevation/hires-raster?bbox_top=${reqBounds.north}&bbox_bottom=${reqBounds.south}&bbox_left=${reqBounds.west}&bbox_right=${reqBounds.east}&res_m=1&projection=latlon`;
             
             // Retry logic for 429 Rate Limit
             let response: Response | null = null;
             let retries = 0;
             const MAX_RETRIES = 3;
             
             while (retries < MAX_RETRIES) {
                 response = await fetch(url, { headers: { 'x-api-key': apiKey } });
                 
                 if (response.status === 429) {
                     const waitTime = 2000 * Math.pow(2, retries); // Exponential backoff: 2s, 4s, 8s
                     console.warn(`[GPXZ] Rate limit hit (429). Retrying in ${waitTime}ms...`);
                     await new Promise(r => setTimeout(r, waitTime));
                     retries++;
                     continue;
                 }
                 
                 break;
             }

             if (!response || !response.ok) {
                 console.error(`[GPXZ] Tile Error: ${response?.status}`);
                 return null;
             }
             
             const version = response.headers.get('X-DATASET-VERSION');
             if (version) console.debug(`[GPXZ] Dataset Version: ${version}`);

             const arrayBuffer = await response.arrayBuffer();
             const tiff = await GeoTIFF.fromArrayBuffer(arrayBuffer);
             const image = await tiff.getImage();
             const rasters = await image.readRasters();
             const raster = rasters[0] as Float32Array | Int16Array;
             
             await tiff.close();
             
             return { image, raster, arrayBuffer };
        }, 1); // Concurrency 1 for strict rate limiting

        const validResults = results.filter((r): r is { image: GeoTIFF.GeoTIFFImage, raster: Float32Array | Int16Array, arrayBuffer: ArrayBuffer } => r !== null);
        
        if (validResults.length === 0) return null;
        
        const rawArrayBuffers = validResults.map(r => r.arrayBuffer);
        return { data: validResults, smooth: shouldSmooth, rawArrayBuffers };

    } catch (e) {
        console.error("Failed to fetch GPXZ terrain:", e);
        return null;
    }
};

const fetchUSGSRaw = async (bounds: Bounds): Promise<{ data: { image: GeoTIFF.GeoTIFFImage, raster: Float32Array | Int16Array }[], rawArrayBuffers: ArrayBuffer[] } | null> => {
    const MAX_RETRIES = 3;
    const RETRY_DELAY = 1000;

    const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

    try {
        // 1. Query USGS API
        // Round coordinates to 6 decimal places to improve cache hit rate and reduce query string length
        const bbox = `${bounds.west.toFixed(6)},${bounds.south.toFixed(6)},${bounds.east.toFixed(6)},${bounds.north.toFixed(6)}`;
        // Limit to 4 tiles to cover corners/overlaps without overloading memory
        const url = `${USGS_PRODUCT_API}?datasets=${encodeURIComponent(USGS_DATASET)}&bbox=${bbox}&prodFormats=GeoTIFF&max=4`;
        
        console.log(`[USGS] Querying products: ${url}`);

        let response: Response | null = null;
        let attempts = 0;

        while (attempts < MAX_RETRIES) {
            try {
                const controller = new AbortController();
                const timeoutId = setTimeout(() => controller.abort(), 15000); // 15s timeout

                response = await fetch(url, { 
                    signal: controller.signal,
                    // Ensure no custom headers are sent to avoid preflight OPTIONS request which fails on USGS
                    headers: {} 
                });
                clearTimeout(timeoutId);

                if (response.ok) break;
                
                console.warn(`[USGS] API Query failed: ${response.status}. Retrying...`);
            } catch (err) {
                console.warn(`[USGS] Network error: ${err}. Retrying...`);
            }
            
            attempts++;
            await sleep(RETRY_DELAY * attempts);
        }

        if (!response || !response.ok) {
            console.warn(`[USGS] Failed to query API after ${MAX_RETRIES} attempts.`);
            return null;
        }

        const data = await response.json();
        
        if (!data.items || data.items.length === 0) {
            console.log(`[USGS] No products found for bounds.`);
            return null;
        }
        
        console.log(`[USGS] Found ${data.items.length} tiles. Downloading sequentially to handle overlap...`);

        const results: { image: GeoTIFF.GeoTIFFImage, raster: Float32Array | Int16Array }[] = [];
        const rawArrayBuffers: ArrayBuffer[] = [];

        // 2. Download GeoTIFFs sequentially
        // We process sequentially to avoid memory exhaustion with large 1m tiles
        for (const item of data.items) {
            const downloadUrl = item.downloadURL;
            console.log(`[USGS] Downloading GeoTIFF from: ${downloadUrl}`);

            try {
                const tiffResponse = await fetch(downloadUrl);
                if (!tiffResponse.ok) {
                    console.warn(`[USGS] Failed to download tile: ${tiffResponse.status}`);
                    continue;
                }

                const arrayBuffer = await tiffResponse.arrayBuffer();
                
                // 3. Parse GeoTIFF
                const tiff = await GeoTIFF.fromArrayBuffer(arrayBuffer);
                const image = await tiff.getImage();
                const rasters = await image.readRasters();
                const raster = rasters[0] as Float32Array | Int16Array; // Height data
                
                await tiff.close();
                
                results.push({ image, raster });
                rawArrayBuffers.push(arrayBuffer);
            } catch (e) {
                console.warn(`[USGS] Failed to parse tile ${downloadUrl}`, e);
            }
        }
        
        if (results.length === 0) {
            console.warn("[USGS] All tile downloads failed.");
            return null;
        }
        
        return { data: results, rawArrayBuffers };
        
    } catch (e) {
        console.warn("Failed to load USGS terrain:", e);
        return null;
    }
};

// Helper for concurrency control
async function pMap<T, R>(
  items: T[],
  mapper: (item: T) => Promise<R>,
  concurrency: number
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let index = 0;
  
  const next = async (): Promise<void> => {
    while (index < items.length) {
      const i = index++;
      try {
        results[i] = await mapper(items[i]);
      } catch (e) {
        console.error(`Error processing item ${i}`, e);
        // @ts-ignore - basic error handling
        results[i] = null;
      }
    }
  };

  const workers = [];
  for (let i = 0; i < concurrency; i++) {
    workers.push(next());
  }
  await Promise.all(workers);
  return results;
}

const loadImage = (url: string): Promise<HTMLImageElement | null> => {
    return new Promise((resolve) => {
        const img = new Image();
        img.crossOrigin = "Anonymous";
        img.onload = () => resolve(img);
        img.onerror = () => resolve(null);
        img.src = url;
    });
}

export const fetchTerrainData = async (
    center: LatLng, 
    resolution: number, 
    includeOSM: boolean = false, 
    useUSGS: boolean = false, 
    useGPXZ: boolean = false, 
    gpxzApiKey: string = '',
    onProgress?: (status: string) => void
): Promise<TerrainData> => {
  
  // Normalize longitude to handle world wrapping
  const normalizedCenter = {
      lat: center.lat,
      lng: normalizeLng(center.lng)
  };

  // 1. Define Target Metric Grid
  // Resolution is treated as "Output Size in Pixels" AND "Extent in Meters" (1m/px)
  const width = resolution;
  const height = resolution;
  
  onProgress?.("Calculating metric bounds...");
  
  // Calculate approximate Lat/Lon bounds for fetching
  const metersPerDegLat = 111320;
  const metersPerDegLng = 111320 * Math.cos(normalizedCenter.lat * Math.PI / 180);
  const latSpan = height / metersPerDegLat;
  const lngSpan = width / metersPerDegLng;
  
  const fetchBounds: Bounds = {
      north: normalizedCenter.lat + latSpan / 2,
      south: normalizedCenter.lat - latSpan / 2,
      east: normalizedCenter.lng + lngSpan / 2,
      west: normalizedCenter.lng - lngSpan / 2
    };

  // 2. Try GPXZ / USGS
  let rawData: { image: GeoTIFF.GeoTIFFImage, raster: Float32Array | Int16Array }[] | null = null;
  let usgsFallback = false;
  let shouldSmooth = false;
  let sourceGeoTiffs: { arrayBuffers: ArrayBuffer[], source: 'gpxz' | 'usgs' | 'global' } | undefined = undefined;

  if (useGPXZ && gpxzApiKey) {
      onProgress?.("Fetching high-res GPXZ elevation data...");
      const gpxzResult = await fetchGPXZRaw(fetchBounds, gpxzApiKey, onProgress);
      if (gpxzResult) {
          rawData = gpxzResult.data;
          shouldSmooth = gpxzResult.smooth;
          sourceGeoTiffs = { arrayBuffers: gpxzResult.rawArrayBuffers, source: 'gpxz' };
      }
  }

  const isCONUS = fetchBounds.north < 50 && fetchBounds.south > 24 && fetchBounds.west > -125 && fetchBounds.east < -66;
  const isAlaska = fetchBounds.north < 72 && fetchBounds.south > 50 && fetchBounds.west > -170 && fetchBounds.east < -129;
  const isHawaii = fetchBounds.north < 23 && fetchBounds.south > 18 && fetchBounds.west > -161 && fetchBounds.east < -154;

  if (!rawData && useUSGS && (isCONUS || isAlaska || isHawaii)) {
      onProgress?.("Fetching USGS 1m DEM data...");
      const usgsResult = await fetchUSGSRaw(fetchBounds);
      if (usgsResult) {
          rawData = usgsResult.data;
          sourceGeoTiffs = { arrayBuffers: usgsResult.rawArrayBuffers, source: 'usgs' };
      } else {
          usgsFallback = true;
          console.warn("[USGS] Failed to fetch raw data, falling back to global tiles.");
      }
  }

  // 3. Prepare Samplers
  let heightSampler: ((lat: number, lng: number) => number) | null = null;
  let colorSampler: ((lat: number, lng: number) => { r: number, g: number, b: number, a: number }) | null = null;

  // We always need global tiles for Satellite Texture, and as fallback for Height
  onProgress?.("Fetching global tiles...");
  
  // Calculate tile range covering the fetchBounds for Terrain (Z15)
  const nw = project(fetchBounds.north, fetchBounds.west, TERRAIN_ZOOM);
  const se = project(fetchBounds.south, fetchBounds.east, TERRAIN_ZOOM);
  
  const minTileX = Math.floor(nw.x / TILE_SIZE);
  const minTileY = Math.floor(nw.y / TILE_SIZE);
  const maxTileX = Math.floor(se.x / TILE_SIZE);
  const maxTileY = Math.floor(se.y / TILE_SIZE);

  // Calculate tile range covering the fetchBounds for Satellite (Z17)
  const satNw = project(fetchBounds.north, fetchBounds.west, SATELLITE_ZOOM);
  const satSe = project(fetchBounds.south, fetchBounds.east, SATELLITE_ZOOM);
  
  const satMinTileX = Math.floor(satNw.x / TILE_SIZE);
  const satMinTileY = Math.floor(satNw.y / TILE_SIZE);
  const satMaxTileX = Math.floor(satSe.x / TILE_SIZE);
  const satMaxTileY = Math.floor(satSe.y / TILE_SIZE);

  // Create canvases to hold the stitched tiles
  const tileCountX = maxTileX - minTileX + 1;
  const tileCountY = maxTileY - minTileY + 1;
  const canvasWidth = tileCountX * TILE_SIZE;
  const canvasHeight = tileCountY * TILE_SIZE;

  const satTileCountX = satMaxTileX - satMinTileX + 1;
  const satTileCountY = satMaxTileY - satMinTileY + 1;
  const satCanvasWidth = satTileCountX * TILE_SIZE;
  const satCanvasHeight = satTileCountY * TILE_SIZE;

  const terrainCanvas = document.createElement('canvas');
  terrainCanvas.width = canvasWidth;
  terrainCanvas.height = canvasHeight;
  const tCtx = terrainCanvas.getContext('2d', { willReadFrequently: true });

  const satCanvas = document.createElement('canvas');
  satCanvas.width = satCanvasWidth;
  satCanvas.height = satCanvasHeight;
  const sCtx = satCanvas.getContext('2d', { willReadFrequently: true });

  if (!tCtx || !sCtx) throw new Error("Failed to create canvas contexts");

  // Fetch tiles
  interface TileRequest { tx: number; ty: number; type: 'terrain' | 'satellite' }
  const requests: TileRequest[] = [];
  
  // Terrain Requests
  // Always fetch global tiles to serve as fallback for holes in high-res data
  for (let tx = minTileX; tx <= maxTileX; tx++) {
    for (let ty = minTileY; ty <= maxTileY; ty++) {
      requests.push({ tx, ty, type: 'terrain' });
    }
  }

  // Satellite Requests
  for (let tx = satMinTileX; tx <= satMaxTileX; tx++) {
    for (let ty = satMinTileY; ty <= satMaxTileY; ty++) {
      requests.push({ tx, ty, type: 'satellite' });
    }
  }

  await pMap(requests, async ({ tx, ty, type }) => {
     if (type === 'terrain') {
         const drawX = (tx - minTileX) * TILE_SIZE;
         const drawY = (ty - minTileY) * TILE_SIZE;
         
         const numTiles = Math.pow(2, TERRAIN_ZOOM);
         const wrappedTx = (tx % numTiles + numTiles) % numTiles;
         
         const terrainUrl = `${TILE_API_URL}/${TERRAIN_ZOOM}/${wrappedTx}/${ty}.png`;
         const tImg = await loadImage(terrainUrl);
         if(tImg) tCtx.drawImage(tImg, drawX, drawY);
         else {
             tCtx.fillStyle = "black";
             tCtx.fillRect(drawX, drawY, TILE_SIZE, TILE_SIZE);
         }
     } else {
         const drawX = (tx - satMinTileX) * TILE_SIZE;
         const drawY = (ty - satMinTileY) * TILE_SIZE;
         
         const numTiles = Math.pow(2, SATELLITE_ZOOM);
         const wrappedTx = (tx % numTiles + numTiles) % numTiles;

         const satUrl = `${SATELLITE_API_URL}/${SATELLITE_ZOOM}/${ty}/${wrappedTx}`;
         const sImg = await loadImage(satUrl);
         if(sImg) sCtx.drawImage(sImg, drawX, drawY);
         else {
             sCtx.fillStyle = "#1a1a1a";
             sCtx.fillRect(drawX, drawY, TILE_SIZE, TILE_SIZE);
         }
     }
  }, 20);

  // Create Samplers from Canvases
  // Always create the terrain data image so we have a fallback sampler
  const terrainDataImg = tCtx.getImageData(0, 0, canvasWidth, canvasHeight);
  const satDataImg = sCtx.getImageData(0, 0, satCanvasWidth, satCanvasHeight);

  // Helper to get pixel from Mercator Canvas
  const getMercatorPixel = (lat: number, lng: number, data: ImageData, zoom: number, minTx: number, minTy: number) => {
      const p = project(lat, lng, zoom);
      const localX = p.x - (minTx * TILE_SIZE);
      const localY = p.y - (minTy * TILE_SIZE);
      
      const x = Math.floor(localX);
      const y = Math.floor(localY);
      
      if (x < 0 || x >= data.width || y < 0 || y >= data.height) return null;
      
      const i = (y * data.width + x) * 4;
      return {
          r: data.data[i],
          g: data.data[i+1],
          b: data.data[i+2],
          a: data.data[i+3]
      };
  };

  if (terrainDataImg) {
      heightSampler = (lat, lng) => {
          // Bilinear Interpolation for smoother terrain
          const p = project(lat, lng, TERRAIN_ZOOM);
          const localX = p.x - (minTileX * TILE_SIZE);
          const localY = p.y - (minTileY * TILE_SIZE);

          const x0 = Math.floor(localX);
          const y0 = Math.floor(localY);
          const dx = localX - x0;
          const dy = localY - y0;

          const w = terrainDataImg.width;
          const h = terrainDataImg.height;

          const getH = (x: number, y: number) => {
             const cx = Math.max(0, Math.min(w - 1, x));
             const cy = Math.max(0, Math.min(h - 1, y));
             const i = (cy * w + cx) * 4;
             const r = terrainDataImg.data[i];
             const g = terrainDataImg.data[i+1];
             const b = terrainDataImg.data[i+2];
             // Mapzen encoding
             return (r * 256 + g + b / 256) - 32768;
          };

          const h00 = getH(x0, y0);
          const h10 = getH(x0 + 1, y0);
          const h01 = getH(x0, y0 + 1);
          const h11 = getH(x0 + 1, y0 + 1);

          const top = (1 - dx) * h00 + dx * h10;
          const bottom = (1 - dx) * h01 + dx * h11;
          return (1 - dy) * top + dy * bottom;
      };
  }

  colorSampler = (lat, lng) => {
      const px = getMercatorPixel(lat, lng, satDataImg, SATELLITE_ZOOM, satMinTileX, satMinTileY);
      if (!px) return { r: 0, g: 0, b: 0, a: 255 };
      return px;
  };

  // 4. Resample Heightmap to Metric Grid
  onProgress?.("Resampling heightmap to 1m/px...");
  const { heightMap, bounds: finalBounds } = await resampleToMeterGrid(
      { 
          type: rawData ? 'geotiff' : 'sampler', 
          data: rawData || undefined, 
          sampler: heightSampler || undefined 
      },
      center,
      width,
      height,
      'bilinear',
      shouldSmooth
  );

  // 5. Resample Satellite Texture to Metric Grid
  onProgress?.("Resampling satellite texture...");
  const finalSatCanvas = await resampleImageToMeterGrid(
      { sampler: colorSampler },
      center,
      width,
      height
  );

  // 6. Calculate Min/Max
  let minHeight = Infinity;
  let maxHeight = -Infinity;
  for (let i = 0; i < heightMap.length; i++) {
      const h = heightMap[i];
      if (h !== NO_DATA_VALUE) {
          if (h < minHeight) minHeight = h;
          if (h > maxHeight) maxHeight = h;
      }
  }
  if (minHeight === Infinity) minHeight = 0;
  if (maxHeight === -Infinity) maxHeight = 0;

  // 7. Fetch OSM Data
  let osmFeatures: OSMFeature[] = [];
  if (includeOSM) {
      onProgress?.("Fetching OpenStreetMap data...");
      osmFeatures = await fetchOSMData(finalBounds);
  }

  onProgress?.("Finalizing terrain data...");
  
  const terrainData: TerrainData = {
    heightMap,
    width,
    height,
    minHeight,
    maxHeight,
    satelliteTextureUrl: finalSatCanvas.toDataURL('image/jpeg', 0.9),
    bounds: finalBounds,
    osmFeatures,
    usgsFallback,
    sourceGeoTiffs
  };

  if (includeOSM && osmFeatures.length > 0) {
      onProgress?.("Generating OSM texture...");
      terrainData.osmTextureUrl = await generateOSMTexture(terrainData);
      onProgress?.("Generating Hybrid texture...");
      terrainData.hybridTextureUrl = await generateHybridTexture(terrainData);
  }

  return terrainData;
};

export const checkUSGSStatus = async (): Promise<boolean> => {
    try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 5000);
        // Use empty headers to avoid preflight OPTIONS request
        const response = await fetch(`${USGS_PRODUCT_API}?max=1`, { 
            headers: {},
            signal: controller.signal
        });
        clearTimeout(timeoutId);
        return response.ok;
    } catch (e) {
        return false;
    }
};

export const addOSMToTerrain = async (
    terrainData: TerrainData,
    onProgress?: (status: string) => void
): Promise<TerrainData> => {
    onProgress?.("Fetching OpenStreetMap data...");
    const osmFeatures = await fetchOSMData(terrainData.bounds);
    
    const newTerrainData = { ...terrainData, osmFeatures };
    
    if (osmFeatures.length > 0) {
        onProgress?.("Generating OSM texture...");
        newTerrainData.osmTextureUrl = await generateOSMTexture(newTerrainData);
        onProgress?.("Generating Hybrid texture...");
        newTerrainData.hybridTextureUrl = await generateHybridTexture(newTerrainData);
    }
    
    return newTerrainData;
};
