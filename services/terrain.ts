import { LatLng, TerrainData, Bounds, OSMFeature } from "../types";
import { fetchOSMData } from "./osm";
import * as GeoTIFF from 'geotiff';
import proj4 from 'proj4';

// Constants
const TILE_SIZE = 256;
const TERRAIN_ZOOM = 15; // Fixed high detail zoom level
const TILE_API_URL = "https://s3.amazonaws.com/elevation-tiles-prod/terrarium";
const SATELLITE_API_URL = "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile";
const USGS_PRODUCT_API = "https://tnmaccess.nationalmap.gov/api/v1/products";
const USGS_DATASET = "Digital Elevation Model (DEM) 1 meter";

// Math Helpers for Web Mercator Projection (Source of Truth for Fetching)
const MAX_LATITUDE = 85.05112878;

const project = (lat: number, lng: number, zoom: number) => {
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
    
    try {
        const response = await fetch(`https://epsg.io/${code}.proj4`);
        if (!response.ok) throw new Error("Proj4 fetch failed");
        const def = await response.text();
        proj4.defs(epsg, def);
        return epsg;
    } catch (e) {
        console.warn(`Failed to fetch definition for EPSG:${code}`, e);
        return '';
    }
};

const NO_DATA_VALUE = -99999;

const fetchUSGSTerrain = async (startX: number, startY: number, width: number, height: number): Promise<Float32Array | null> => {
    try {
        // Calculate bounds for the query
        const nw = unproject(startX, startY, TERRAIN_ZOOM);
        const se = unproject(startX + width, startY + height, TERRAIN_ZOOM);
        const bounds = { north: nw.lat, west: nw.lng, south: se.lat, east: se.lng };

        // 1. Query USGS API
        const bbox = `${bounds.west},${bounds.south},${bounds.east},${bounds.north}`;
        const url = `${USGS_PRODUCT_API}?datasets=${encodeURIComponent(USGS_DATASET)}&bbox=${bbox}&prodFormats=GeoTIFF&max=1`;
        
        const response = await fetch(url);
        const data = await response.json();
        
        if (!data.items || data.items.length === 0) return null;
        
        // 2. Download GeoTIFF
        const downloadUrl = data.items[0].downloadURL;
        const tiffResponse = await fetch(downloadUrl);
        const arrayBuffer = await tiffResponse.arrayBuffer();
        
        // 3. Parse GeoTIFF
        const tiff = await GeoTIFF.fromArrayBuffer(arrayBuffer);
        const image = await tiff.getImage();
        const rasters = await image.readRasters();
        const raster = rasters[0] as Float32Array | Int16Array; // Height data
        
        // 4. Get Projection
        const geoKeys = image.getGeoKeys();
        const epsgCode = geoKeys.ProjectedCSTypeGeoKey || geoKeys.GeographicTypeGeoKey;
        
        if (!epsgCode) {
            console.warn("No EPSG code found in GeoTIFF");
            return null;
        }
        
        const projName = await getProj4Def(epsgCode);
        if (!projName) return null;
        
        // 5. Resample to requested grid
        const heightMap = new Float32Array(width * height);
        heightMap.fill(NO_DATA_VALUE); // Initialize with NO_DATA

        const tiffWidth = image.getWidth();
        const tiffHeight = image.getHeight();
        const [originX, originY] = image.getOrigin();
        const [resX, resY] = image.getResolution(); 
        
        // Converter from WGS84 (Lat/Lon) to TIFF CRS
        const converter = proj4('EPSG:4326', projName);
        
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
                    
                    const h = (1 - dy) * ((1 - dx) * h00 + dx * h10) + dy * ((1 - dx) * h01 + dx * h11);
                    heightMap[y * width + x] = h;
                }
                // Else remains NO_DATA_VALUE
            }
        }
        
        console.log("Successfully loaded USGS 1m DEM data");
        return heightMap;
        
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

export const fetchTerrainData = async (center: LatLng, resolution: number, includeOSM: boolean = false, useUSGS: boolean = false): Promise<TerrainData> => {
  // 1. Calculate World Pixel Coordinates for the Center
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

  // Try USGS first if in USA (CONUS, Alaska, Hawaii) AND enabled
  let usgsHeightMap: Float32Array | null = null;
  
  const isCONUS = bounds.north < 50 && bounds.south > 24 && bounds.west > -125 && bounds.east < -66;
  const isAlaska = bounds.north < 72 && bounds.south > 50 && bounds.west > -170 && bounds.east < -129;
  const isHawaii = bounds.north < 23 && bounds.south > 18 && bounds.west > -161 && bounds.east < -154;

  if (useUSGS && (isCONUS || isAlaska || isHawaii)) {
      usgsHeightMap = await fetchUSGSTerrain(startX, startY, resolution, resolution);
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

    // If we have USGS data for this pixel, use it instead
    if (usgsHeightMap) {
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
      osmFeatures = await fetchOSMData(bounds);
  }

  return {
    heightMap,
    width: resolution,
    height: resolution,
    minHeight,
    maxHeight,
    satelliteTextureUrl: satCanvas.toDataURL('image/jpeg', 0.9),
    bounds,
    osmFeatures
  };
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