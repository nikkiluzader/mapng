import { LatLng, TerrainData, Bounds, OSMFeature } from "../types";
import { fetchOSMData } from "./osm";

// Constants
const TILE_SIZE = 256;
const TERRAIN_ZOOM = 15; // Fixed high detail zoom level
const TILE_API_URL = "https://s3.amazonaws.com/elevation-tiles-prod/terrarium";
const SATELLITE_API_URL = "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile";

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

export const fetchTerrainData = async (center: LatLng, resolution: number, includeOSM: boolean = false): Promise<TerrainData> => {
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

     // Fetch Terrain
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
  const imageData = ctx.getImageData(0, 0, resolution, resolution);
  const pixels = imageData.data;
  const heightMap = new Float32Array(resolution * resolution);
  
  let minHeight = Infinity;
  let maxHeight = -Infinity;

  for (let i = 0; i < pixels.length; i += 4) {
    const r = pixels[i];
    const g = pixels[i + 1];
    const b = pixels[i + 2];
    
    // Mapzen encoding: (R * 256 + G + B / 256) - 32768
    let h = (r * 256 + g + b / 256) - 32768;
    
    // Filter out invalid data / spikes
    // -32768 is the base value (0,0,0), often used for no-data
    // Deepest ocean is ~ -11000m, Highest peak is ~8848m
    if (h < -12000 || h > 9000) {
        // Use previous valid value or 0 if start
        h = i > 0 ? heightMap[(i / 4) - 1] : 0;
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