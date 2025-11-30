import { LatLng, TerrainData, Bounds, OSMFeature } from "../types";
import { fetchOSMData } from "./osm";
import { generateOSMTexture, generateHybridTexture } from "./osmTexture";
import * as GeoTIFF from 'geotiff';
import proj4 from 'proj4';

// Constants
const TILE_SIZE = 256;
export const TERRAIN_ZOOM = 15; // Fixed high detail zoom level
const TILE_API_URL = "https://s3.amazonaws.com/elevation-tiles-prod/terrarium";
const SATELLITE_API_URL = "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile";
const USGS_PRODUCT_API = "https://tnmaccess.nationalmap.gov/api/v1/products";
const USGS_DATASET = "Digital Elevation Model (DEM) 1 meter";

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

const unproject = (x: number, y: number, zoom: number): LatLng => {
  const z = TILE_SIZE * Math.pow(2, zoom);
  const lng = (x / z) * 360 - 180;
  
  const n = Math.PI - 2 * Math.PI * y / z;
  const lat = (180 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)));
  
  return { lat, lng };
};

const getProj4Def = async (code: number): Promise<string> => {
    const epsg = `EPSG:${code}`;
    if (proj4.defs(epsg)) return epsg;
    
    console.log(`[Proj4] Fetching definition for ${epsg}...`);
    try {
        const response = await fetch(`https://epsg.io/${code}.proj4`);
        if (!response.ok) throw new Error("Proj4 fetch failed");
        const def = await response.text();
        proj4.defs(epsg, def);
        console.log(`[Proj4] Loaded definition for ${epsg}`);
        return epsg;
    } catch (e) {
        console.warn(`Failed to fetch definition for EPSG:${code}`, e);
        return '';
    }
};

const NO_DATA_VALUE = -99999;

const resampleGeoTIFF = async (image: GeoTIFF.GeoTIFFImage, raster: Float32Array | Int16Array, startX: number, startY: number, width: number, height: number): Promise<Float32Array | null> => {
    const tiffWidth = image.getWidth();
    const tiffHeight = image.getHeight();
    const [originX, originY] = image.getOrigin();
    const [resX, resY] = image.getResolution(); 
    
    const geoKeys = image.getGeoKeys();
    const epsgCode = geoKeys.ProjectedCSTypeGeoKey || geoKeys.GeographicTypeGeoKey;
    
    if (!epsgCode) {
        console.warn("No EPSG code found in GeoTIFF");
        return null;
    }
    
    const projName = await getProj4Def(epsgCode);
    if (!projName) return null;

    // Converter from WGS84 (Lat/Lon) to TIFF CRS
    const converter = proj4('EPSG:4326', projName);
    
    const noData = image.getGDALNoData();

    const heightMap = new Float32Array(width * height);
    heightMap.fill(NO_DATA_VALUE);

    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            // Get Lat/Lon for this pixel in the Web Mercator grid
            const loc = unproject(startX + x, startY + y, TERRAIN_ZOOM);
            
            // Convert Lat/Lon to TIFF CRS
            const [tiffX, tiffY] = converter.forward([loc.lng, loc.lat]);
            
            // Map to TIFF pixel coordinates
            const px = (tiffX - originX) / resX;
            const py = (tiffY - originY) / resY;
            
            if (px >= 0 && px < tiffWidth - 1 && py >= 0 && py < tiffHeight - 1) {
                // Bilinear Interpolation
                const x0 = Math.floor(px);
                const y0 = Math.floor(py);
                const dx = px - x0;
                const dy = py - y0;
                
                const i00 = y0 * tiffWidth + x0;
                const i10 = i00 + 1;
                const i01 = (y0 + 1) * tiffWidth + x0;
                const i11 = i01 + 1;
                
                const h00 = raster[i00];
                const h10 = raster[i10];
                const h01 = raster[i01];
                const h11 = raster[i11];
                
                // Check for NoData or invalid values
                if ((noData !== null && (h00 === noData || h10 === noData || h01 === noData || h11 === noData)) ||
                    (h00 < -10000 || h10 < -10000 || h01 < -10000 || h11 < -10000)) {
                    heightMap[y * width + x] = NO_DATA_VALUE;
                    continue;
                }

                const h = (1 - dy) * ((1 - dx) * h00 + dx * h10) + dy * ((1 - dx) * h01 + dx * h11);
                heightMap[y * width + x] = h;
            }
        }
    }
    return heightMap;
};

const resampleCompositeGeoTIFF = async (
    tiles: { image: GeoTIFF.GeoTIFFImage, raster: Float32Array | Int16Array, bounds: Bounds }[],
    startX: number,
    startY: number,
    width: number,
    height: number
): Promise<Float32Array | null> => {
    const heightMap = new Float32Array(width * height);
    heightMap.fill(NO_DATA_VALUE);

    // Pre-calculate tile metadata to avoid repeated calls
    const tileMeta = await Promise.all(tiles.map(async (t) => {
        const tiffWidth = t.image.getWidth();
        const tiffHeight = t.image.getHeight();
        const [originX, originY] = t.image.getOrigin();
        const [resX, resY] = t.image.getResolution();
        return { ...t, tiffWidth, tiffHeight, originX, originY, resX, resY };
    }));

    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const loc = unproject(startX + x, startY + y, TERRAIN_ZOOM);
            
            // Find which tile covers this location
            // Since we use projection=latlon, coordinates are directly comparable
            const tile = tileMeta.find(t => 
                loc.lat <= t.bounds.north && loc.lat >= t.bounds.south &&
                loc.lng >= t.bounds.west && loc.lng <= t.bounds.east
            );

            if (tile) {
                // Map to TIFF pixel coordinates (Lat/Lon projection)
                // originX is West (min X), originY is North (max Y) usually for GeoTIFF
                // resX is positive, resY is usually negative (top-down)
                
                const px = (loc.lng - tile.originX) / tile.resX;
                const py = (loc.lat - tile.originY) / tile.resY;

                if (px >= 0 && px < tile.tiffWidth - 1 && py >= 0 && py < tile.tiffHeight - 1) {
                    // Bilinear Interpolation
                    const x0 = Math.floor(px);
                    const y0 = Math.floor(py);
                    const dx = px - x0;
                    const dy = py - y0;
                    
                    const i00 = y0 * tile.tiffWidth + x0;
                    const i10 = i00 + 1;
                    const i01 = (y0 + 1) * tile.tiffWidth + x0;
                    const i11 = i01 + 1;
                    
                    const h00 = tile.raster[i00];
                    const h10 = tile.raster[i10];
                    const h01 = tile.raster[i01];
                    const h11 = tile.raster[i11];
                    
                    const h = (1 - dy) * ((1 - dx) * h00 + dx * h10) + dy * ((1 - dx) * h01 + dx * h11);
                    heightMap[y * width + x] = h;
                }
            }
        }
    }
    return heightMap;
};

const fetchGPXZTerrain = async (startX: number, startY: number, width: number, height: number, apiKey: string): Promise<Float32Array | null> => {
    try {
        const nw = unproject(startX, startY, TERRAIN_ZOOM);
        const se = unproject(startX + width, startY + height, TERRAIN_ZOOM);
        const bounds = { north: nw.lat, west: nw.lng, south: se.lat, east: se.lng };

        // Calculate Area in km²
        // Approx: 1 deg lat = 111km. 1 deg lon = 111km * cos(lat)
        const latDist = (bounds.north - bounds.south) * 111.32;
        const avgLatRad = (bounds.north + bounds.south) / 2 * Math.PI / 180;
        const lonDist = (bounds.east - bounds.west) * 111.32 * Math.cos(avgLatRad);
        const areaKm2 = latDist * lonDist;

        console.log(`[GPXZ] Requested Area: ${areaKm2.toFixed(2)} km²`);

        const MAX_AREA_KM2 = 9.5; // Safety margin below 10km²
        const tileRequests: Bounds[] = [];

        if (areaKm2 > MAX_AREA_KM2) {
            // Split into grid
            const cols = Math.ceil(lonDist / Math.sqrt(MAX_AREA_KM2));
            const rows = Math.ceil(latDist / Math.sqrt(MAX_AREA_KM2));
            
            const latStep = (bounds.north - bounds.south) / rows;
            const lonStep = (bounds.east - bounds.west) / cols;

            console.log(`[GPXZ] Area too large. Splitting into ${cols}x${rows} grid.`);

            for (let r = 0; r < rows; r++) {
                for (let c = 0; c < cols; c++) {
                    // Note: North is max lat, South is min lat.
                    // Iterating r from 0 (top) to rows (bottom)
                    const subNorth = bounds.north - (r * latStep);
                    const subSouth = bounds.north - ((r + 1) * latStep);
                    const subWest = bounds.west + (c * lonStep);
                    const subEast = bounds.west + ((c + 1) * lonStep);
                    
                    tileRequests.push({
                        north: subNorth,
                        south: subSouth,
                        west: subWest,
                        east: subEast
                    });
                }
            }
        } else {
            tileRequests.push(bounds);
        }

        // Fetch all tiles
        const tiles = await pMap(tileRequests, async (b) => {
             // Force projection=latlon to simplify stitching
             const url = `https://api.gpxz.io/v1/elevation/hires-raster?bbox_top=${b.north}&bbox_bottom=${b.south}&bbox_left=${b.west}&bbox_right=${b.east}&res_m=1&projection=latlon`;
             
             console.log(`[GPXZ] Fetching tile: ${url}`);
             const response = await fetch(url, { headers: { 'x-api-key': apiKey } });
             
             if (!response.ok) {
                 console.error(`[GPXZ] Tile Error: ${response.status}`);
                 return null;
             }
             
             const arrayBuffer = await response.arrayBuffer();
             const tiff = await GeoTIFF.fromArrayBuffer(arrayBuffer);
             const image = await tiff.getImage();
             const rasters = await image.readRasters();
             const raster = rasters[0] as Float32Array | Int16Array;
             
             return { image, raster, bounds: b };
        }, 4); // Concurrency 4

        const validTiles = tiles.filter((t): t is NonNullable<typeof t> => t !== null);
        
        if (validTiles.length === 0) return null;

        return await resampleCompositeGeoTIFF(validTiles, startX, startY, width, height);

    } catch (e) {
        console.error("Failed to fetch GPXZ terrain:", e);
        return null;
    }
};

const fetchUSGSTerrain = async (startX: number, startY: number, width: number, height: number): Promise<Float32Array | null> => {
    try {
        // Calculate bounds for the query
        const nw = unproject(startX, startY, TERRAIN_ZOOM);
        const se = unproject(startX + width, startY + height, TERRAIN_ZOOM);
        const bounds = { north: nw.lat, west: nw.lng, south: se.lat, east: se.lng };

        // 1. Query USGS API
        const bbox = `${bounds.west},${bounds.south},${bounds.east},${bounds.north}`;
        const url = `${USGS_PRODUCT_API}?datasets=${encodeURIComponent(USGS_DATASET)}&bbox=${bbox}&prodFormats=GeoTIFF&max=1`;
        
        console.log(`[USGS] Querying products: ${url}`);

        const response = await fetch(url);
        const data = await response.json();
        
        if (!data.items || data.items.length === 0) {
            console.log(`[USGS] No products found for bounds.`);
            return null;
        }
        
        // 2. Download GeoTIFF
        const downloadUrl = data.items[0].downloadURL;
        console.log(`[USGS] Downloading GeoTIFF from: ${downloadUrl}`);

        const tiffResponse = await fetch(downloadUrl);
        const arrayBuffer = await tiffResponse.arrayBuffer();
        
        // 3. Parse GeoTIFF
        const tiff = await GeoTIFF.fromArrayBuffer(arrayBuffer);
        const image = await tiff.getImage();
        const rasters = await image.readRasters();
        const raster = rasters[0] as Float32Array | Int16Array; // Height data
        
        return await resampleGeoTIFF(image, raster, startX, startY, width, height);
        
    } catch (e) {
        console.warn("Failed to load USGS terrain, falling back to global provider:", e);
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

export const fetchTerrainData = async (
    center: LatLng, 
    resolution: number, 
    includeOSM: boolean = false, 
    useUSGS: boolean = false, 
    useGPXZ: boolean = false, 
    gpxzApiKey: string = '',
    onProgress?: (status: string) => void
): Promise<TerrainData> => {
  // 1. Calculate World Pixel Coordinates for the Center
  onProgress?.("Calculating coordinates...");
  const centerPx = project(center.lat, center.lng, TERRAIN_ZOOM);
  
  // 2. Calculate the bounding box in Pixel Coordinates
  // We want 'resolution' pixels centered on 'centerPx'
  const startX = Math.floor(centerPx.x - resolution / 2);
  const startY = Math.floor(centerPx.y - resolution / 2);
  const endX = startX + resolution;
  const endY = startY + resolution;

  // Calculate Exact Geographic Bounds of this pixel window
  // Used for OSM fetching and 3D projection alignment
  const nw = unproject(startX, startY, TERRAIN_ZOOM);
  const se = unproject(endX, endY, TERRAIN_ZOOM);
  const bounds: Bounds = {
      north: nw.lat,
      west: nw.lng,
      south: se.lat,
      east: se.lng
  };

  // Try GPXZ if enabled
  let gpxzHeightMap: Float32Array | null = null;
  if (useGPXZ && gpxzApiKey) {
      onProgress?.("Fetching high-res GPXZ elevation data...");
      gpxzHeightMap = await fetchGPXZTerrain(startX, startY, resolution, resolution, gpxzApiKey);
  }

  // Try USGS first if in USA (CONUS, Alaska, Hawaii) AND enabled AND GPXZ not used
  let usgsHeightMap: Float32Array | null = null;
  let usgsFallback = false;
  
  const isCONUS = bounds.north < 50 && bounds.south > 24 && bounds.west > -125 && bounds.east < -66;
  const isAlaska = bounds.north < 72 && bounds.south > 50 && bounds.west > -170 && bounds.east < -129;
  const isHawaii = bounds.north < 23 && bounds.south > 18 && bounds.west > -161 && bounds.east < -154;

  if (!useGPXZ && useUSGS && (isCONUS || isAlaska || isHawaii)) {
      onProgress?.("Fetching USGS 1m DEM data...");
      usgsHeightMap = await fetchUSGSTerrain(startX, startY, resolution, resolution);

      if (usgsHeightMap) {
          // Check for valid data density
          let validCount = 0;
          const total = usgsHeightMap.length;
          for(let i = 0; i < total; i++) {
              if(usgsHeightMap[i] !== NO_DATA_VALUE) {
                  validCount++;
              }
          }
          
          // Only fallback if we have effectively NO valid data (e.g. < 0.1% valid)
          // User requested to keep data even if it has holes, as long as it's not completely empty.
          if (validCount < total * 0.001) {
              console.warn(`[USGS] Data mostly incomplete (${validCount}/${total} valid). Falling back to global terrain.`);
              usgsHeightMap = null;
              usgsFallback = true;
          }
      } else {
          // If fetchUSGSTerrain returned null (e.g. API error or no products), we also consider this a fallback scenario
          // if the user explicitly requested USGS.
          usgsFallback = true;
      }
  }

  // 3. Determine which tiles cover this pixel range
  const minTileX = Math.floor(startX / TILE_SIZE);
  const minTileY = Math.floor(startY / TILE_SIZE);
  const maxTileX = Math.floor((endX - 1) / TILE_SIZE);
  const maxTileY = Math.floor((endY - 1) / TILE_SIZE);

  // 4. Create Canvas for Stitching
  const canvas = document.createElement('canvas');
  canvas.width = resolution;
  canvas.height = resolution;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error("Could not create canvas context");

  const satCanvas = document.createElement('canvas');
  satCanvas.width = resolution;
  satCanvas.height = resolution;
  const satCtx = satCanvas.getContext('2d');

  // 5. Generate Tile Requests
  interface TileRequest {
    tx: number;
    ty: number;
  }
  const requests: TileRequest[] = [];
  for (let tx = minTileX; tx <= maxTileX; tx++) {
    for (let ty = minTileY; ty <= maxTileY; ty++) {
      requests.push({ tx, ty });
    }
  }

  // 6. Fetch Tiles with Concurrency Limit
  // 8192px = 1024 tiles. We need to be gentle.
  onProgress?.("Fetching global terrain & satellite tiles...");
  await pMap(requests, async ({ tx, ty }) => {
     const tilePixelX = tx * TILE_SIZE;
     const tilePixelY = ty * TILE_SIZE;
     const drawX = tilePixelX - startX;
     const drawY = tilePixelY - startY;

     // Always fetch global terrain as fallback
     const terrainUrl = `${TILE_API_URL}/${TERRAIN_ZOOM}/${tx}/${ty}.png`;
     const tImg = await loadImage(terrainUrl);
     if(tImg) ctx.drawImage(tImg, drawX, drawY);
     else {
         ctx.fillStyle = "black";
         ctx.fillRect(drawX, drawY, TILE_SIZE, TILE_SIZE);
     }

     // Fetch Satellite
     if (satCtx) {
        const satUrl = `${SATELLITE_API_URL}/${TERRAIN_ZOOM}/${ty}/${tx}`;
        const sImg = await loadImage(satUrl);
        if(sImg) satCtx.drawImage(sImg, drawX, drawY);
        else {
            satCtx.fillStyle = "#1a1a1a";
            satCtx.fillRect(drawX, drawY, TILE_SIZE, TILE_SIZE);
        }
     }
  }, 20); // Concurrency limit of 20

  // 7. Process Heightmap Data
  onProgress?.("Processing heightmap data...");
  let heightMap: Float32Array;
  let minHeight = Infinity;
  let maxHeight = -Infinity;

  // Read global data from canvas
  const imageData = ctx.getImageData(0, 0, resolution, resolution);
  const pixels = imageData.data;
  heightMap = new Float32Array(resolution * resolution);
  
  for (let i = 0; i < pixels.length; i += 4) {
    const r = pixels[i];
    const g = pixels[i + 1];
    const b = pixels[i + 2];
    
    // Mapzen encoding: (R * 256 + G + B / 256) - 32768
    let h = (r * 256 + g + b / 256) - 32768;
    
    // Filter out invalid data / spikes
    if (h < -12000 || h > 9000) {
        h = i > 0 ? heightMap[(i / 4) - 1] : 0;
    }

    // If we have GPXZ data for this pixel, use it instead
    if (gpxzHeightMap) {
        const gpxzVal = gpxzHeightMap[i / 4];
        if (gpxzVal !== NO_DATA_VALUE) {
            h = gpxzVal;
        }
    }
    // If we have USGS data for this pixel, use it instead
    else if (usgsHeightMap) {
        const usgsVal = usgsHeightMap[i / 4];
        if (usgsVal !== NO_DATA_VALUE) {
            h = usgsVal;
        }
    }

    heightMap[i / 4] = h;
    
    if (h < minHeight) minHeight = h;
    if (h > maxHeight) maxHeight = h;
  }

  // 8. Fetch OSM Data (Optional)
  let osmFeatures: OSMFeature[] = [];
  if (includeOSM) {
      onProgress?.("Fetching OpenStreetMap data...");
      osmFeatures = await fetchOSMData(bounds);
  }

  onProgress?.("Finalizing terrain data...");
  
  const terrainData: TerrainData = {
    heightMap,
    width: resolution,
    height: resolution,
    minHeight,
    maxHeight,
    satelliteTextureUrl: satCanvas.toDataURL('image/jpeg', 0.9),
    bounds,
    osmFeatures,
    usgsFallback
  };

  if (includeOSM && osmFeatures.length > 0) {
      onProgress?.("Generating OSM texture...");
      terrainData.osmTextureUrl = await generateOSMTexture(terrainData);
      onProgress?.("Generating Hybrid texture...");
      terrainData.hybridTextureUrl = await generateHybridTexture(terrainData);
  }

  return terrainData;
};

const loadImage = (url: string): Promise<HTMLImageElement | null> => {
    return new Promise((resolve) => {
        const img = new Image();
        img.crossOrigin = "Anonymous";
        img.onload = () => resolve(img);
        img.onerror = () => resolve(null);
        img.src = url;
    });
}

export const checkUSGSStatus = async (): Promise<boolean> => {
    try {
        // Simple ping to the product API with a small query
        const response = await fetch(`${USGS_PRODUCT_API}?max=1`);
        return response.ok;
    } catch (e) {
        return false;
    }
};