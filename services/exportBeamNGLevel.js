import JSZip from 'jszip';
import { exportTer } from './exportTer.js';

/**
 * Sanitize a string for use as a BeamNG level folder name.
 */
function sanitizeLevelName(name) {
  return name.replace(/[^a-zA-Z0-9_]/g, '_');
}

/**
 * Compute terrain square size (meters per grid square) from bounds.
 */
function computeSquareSize(terrainData) {
  const { bounds, width, height } = terrainData;
  const size = Math.min(width, height);
  const centerLat = (bounds.north + bounds.south) / 2;
  const latRad = (centerLat * Math.PI) / 180;
  const metersPerDegreeLng = 111320 * Math.cos(latRad);
  const realWidthMeters = (bounds.east - bounds.west) * metersPerDegreeLng;
  return Math.round((realWidthMeters / size) * 100) / 100;
}

/**
 * Convert a WGS84 coordinate to BeamNG world-space [x, y, z].
 * Z is meters above the terrain's minimum elevation (+ offset).
 */
function geoToWorld(lat, lng, terrainData, squareSize, zOffset = 3) {
  const { bounds, width, height, heightMap, minHeight } = terrainData;
  const size = Math.min(width, height);
  const worldSize = size * squareSize;

  const u = Math.max(0, Math.min(1, (lng - bounds.west) / (bounds.east - bounds.west)));
  // v=0 is north (top of heightMap), v=1 is south
  const v = Math.max(0, Math.min(1, (bounds.north - lat) / (bounds.north - bounds.south)));

  const col = Math.min(width - 1, Math.floor(u * width));
  const row = Math.min(height - 1, Math.floor(v * height));
  const worldH = heightMap[row * width + col] - minHeight;

  // X = east, Y = north (BeamNG convention)
  const worldX = (u - 0.5) * worldSize;
  const worldY = (0.5 - v) * worldSize;

  return [
    Math.round(worldX * 10) / 10,
    Math.round(worldY * 10) / 10,
    Math.round((worldH + zOffset) * 10) / 10,
  ];
}

/**
 * Find the best spawn position: midpoint of the road nearest the terrain center,
 * falling back to terrain center if no usable roads exist.
 */
function findSpawnPosition(terrainData, center, squareSize) {
  const EXCLUDE = ['footway', 'path', 'pedestrian', 'steps', 'cycleway', 'bridleway', 'corridor'];

  let spawnLat = center.lat;
  let spawnLng = center.lng;

  if (terrainData.osmFeatures?.length) {
    let bestDist = Infinity;
    for (const feature of terrainData.osmFeatures) {
      if (feature.type !== 'road' || !feature.geometry?.length) continue;
      const highway = feature.tags?.highway;
      if (highway && EXCLUDE.includes(highway)) continue;
      const mid = feature.geometry[Math.floor(feature.geometry.length / 2)];
      const dist = Math.hypot(mid.lat - center.lat, mid.lng - center.lng);
      if (dist < bestDist) {
        bestDist = dist;
        spawnLat = mid.lat;
        spawnLng = mid.lng;
      }
    }
  }

  return geoToWorld(spawnLat, spawnLng, terrainData, squareSize, 3);
}

/**
 * Return the best available terrain texture as a PNG Blob, in priority order:
 *   1. hybridTextureCanvas (satellite + road overlay, already in memory)
 *   2. hybridTextureUrl    (blob URL of the hybrid composite)
 *   3. satelliteTextureUrl (plain satellite, typically a JPEG)
 *   4. Grey 64×64 fallback
 *
 * Source images are always re-encoded as PNG because BeamNG's GBitmap::readPNG
 * rejects non-PNG streams (satellite tiles are JPEG).
 */
async function getTerrainTextureBlob(terrainData) {
  // 1. Hybrid canvas — fastest path, already in memory
  if (terrainData.hybridTextureCanvas) {
    return new Promise(r => terrainData.hybridTextureCanvas.toBlob(r, 'image/png'));
  }

  // Helper: load a URL into a canvas and export as PNG
  async function urlToPngBlob(url) {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    await new Promise((resolve, reject) => {
      img.onload = resolve;
      img.onerror = reject;
      img.src = url;
    });
    const canvas = document.createElement('canvas');
    canvas.width = img.naturalWidth || img.width;
    canvas.height = img.naturalHeight || img.height;
    canvas.getContext('2d').drawImage(img, 0, 0);
    return new Promise(r => canvas.toBlob(r, 'image/png'));
  }

  // 2. Hybrid URL
  if (terrainData.hybridTextureUrl) {
    try { return await urlToPngBlob(terrainData.hybridTextureUrl); } catch (_) {}
  }

  // 3. Plain satellite URL
  if (terrainData.satelliteTextureUrl) {
    try { return await urlToPngBlob(terrainData.satelliteTextureUrl); } catch (_) {}
  }

  // 4. Grey fallback
  const canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 64;
  canvas.getContext('2d').fillStyle = '#888';
  canvas.getContext('2d').fillRect(0, 0, 64, 64);
  return new Promise(r => canvas.toBlob(r, 'image/png'));
}

/**
 * Generate a 512×512 preview PNG (satellite or heightmap fallback).
 * Required: freeroamConfigurator.validateFiles() checks that the file listed
 * in info.json["previews"] physically exists — without it the level falls back
 * to the default level (West Coast USA).
 */
async function generatePreviewBlob(terrainData) {
  const SIZE = 512;
  const canvas = document.createElement('canvas');
  canvas.width = SIZE;
  canvas.height = SIZE;
  const ctx = canvas.getContext('2d');

  if (terrainData.satelliteTextureUrl) {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    await new Promise((resolve, reject) => {
      img.onload = resolve;
      img.onerror = reject;
      img.src = terrainData.satelliteTextureUrl;
    });
    ctx.drawImage(img, 0, 0, SIZE, SIZE);
  } else {
    const { width, height, heightMap, minHeight, maxHeight } = terrainData;
    const imgData = ctx.createImageData(SIZE, SIZE);
    const range = maxHeight - minHeight;
    const stepX = width / SIZE;
    const stepY = height / SIZE;
    for (let y = 0; y < SIZE; y++) {
      for (let x = 0; x < SIZE; x++) {
        const srcX = Math.min(Math.floor(x * stepX), width - 1);
        const srcY = Math.min(Math.floor(y * stepY), height - 1);
        const h = heightMap[srcY * width + srcX];
        const v = range > 0 ? Math.floor(((h - minHeight) / range) * 255) : 128;
        const idx = (y * SIZE + x) * 4;
        imgData.data[idx] = v;
        imgData.data[idx + 1] = v;
        imgData.data[idx + 2] = v;
        imgData.data[idx + 3] = 255;
      }
    }
    ctx.putImageData(imgData, 0, 0);
  }

  return new Promise(r => canvas.toBlob(r, 'image/png'));
}

/**
 * Write a newline-delimited JSON (NDJSON) string from an array of objects.
 * Each object is one line, file ends with a newline — matching BeamNG's format.
 */
function toNDJSON(objects) {
  return objects.map(o => JSON.stringify(o)).join('\n') + '\n';
}

/**
 * Generate a complete BeamNG level .zip from terrainData and center coordinates.
 *
 * ZIP structure:
 *   {levelName}.zip/
 *   └── levels/{levelName}/
 *       ├── info.json
 *       ├── preview.png
 *       ├── terrain.ter
 *       ├── terrain.terrain.json
 *       ├── art/terrain/
 *       │   ├── satellite.png
 *       │   └── main.materials.json
 *       └── main/
 *           └── MissionGroup/
 *               ├── items.level.json
 *               ├── PlayerDropPoints/
 *               │   └── items.level.json
 *               └── Level_objects/
 *                   ├── items.level.json   (LevelInfo, TimeOfDay, ScatterSky, Other group)
 *                   └── Other/
 *                       └── items.level.json  (TerrainBlock)
 */
export async function exportBeamNGLevel(terrainData, center) {
  const lat = center.lat.toFixed(4);
  const lng = center.lng.toFixed(4);
  const levelName = sanitizeLevelName(`mapng_${lat}_${lng}`);

  const size = Math.min(terrainData.width, terrainData.height);
  const squareSize = computeSquareSize(terrainData);
  const halfExtent = (size / 2) * squareSize;
  const worldSize = size * squareSize;
  const maxHeight = Math.ceil(terrainData.maxHeight - terrainData.minHeight);

  const spawnPosition = findSpawnPosition(terrainData, center, squareSize);

  const [{ blob: terBlob }, previewBlob, satBlob] = await Promise.all([
    exportTer(terrainData),
    generatePreviewBlob(terrainData),
    getTerrainTextureBlob(terrainData),
  ]);

  const zip = new JSZip();
  const base = `levels/${levelName}`;

  // Explicit directory entries so BeamNG's FS:directoryExists() works correctly
  zip.folder('levels');
  zip.folder(base);
  zip.folder(`${base}/art`);
  zip.folder(`${base}/art/terrain`);
  zip.folder(`${base}/main`);
  zip.folder(`${base}/main/MissionGroup`);
  zip.folder(`${base}/main/MissionGroup/Level_objects`);
  zip.folder(`${base}/main/MissionGroup/Level_objects/Other`);
  zip.folder(`${base}/main/MissionGroup/PlayerDropPoints`);

  // ── info.json ──────────────────────────────────────────────────────────────
  zip.file(`${base}/info.json`, JSON.stringify({
    authors: 'mapng',
    defaultSpawnPointName: 'spawn_default',
    description: `Generated by mapng at ${lat}, ${lng}`,
    previews: ['preview.png'],
    size: [size, size],
    spawnPoints: [{ name: 'Default', objectname: 'spawn_default', preview: 'preview.png' }],
    title: `mapng ${lat}, ${lng}`,
  }, null, 2));

  // ── preview.png ────────────────────────────────────────────────────────────
  zip.file(`${base}/preview.png`, previewBlob);

  // ── terrain.ter ────────────────────────────────────────────────────────────
  zip.file(`${base}/terrain.ter`, terBlob);

  // ── terrain.terrain.json ───────────────────────────────────────────────────
  // Companion metadata file for the .ter binary (BeamNG convention).
  zip.file(`${base}/terrain.terrain.json`, JSON.stringify({
    datafile: `levels/${levelName}/terrain.ter`,
    materials: ['DefaultMaterial'],
    size,
    version: 9,
  }, null, 2));

  // ── art/terrain/satellite.png ──────────────────────────────────────────────
  zip.file(`${base}/art/terrain/satellite.png`, satBlob);

  // ── art/terrain/main.materials.json ───────────────────────────────────────
  // TerrainMaterial (not TerrainMaterialTextureSet) with the satellite image
  // as the full-terrain diffuse overlay. Material name must match the name
  // written in terrain.ter by exportTer.js ("DefaultMaterial").
  // diffuseSize = worldSize so the texture covers the entire terrain exactly once.
  zip.file(`${base}/art/terrain/main.materials.json`, JSON.stringify({
    DefaultMaterial: {
      class: 'TerrainMaterial',
      internalName: 'DefaultMaterial',
      diffuseMap: `levels/${levelName}/art/terrain/satellite.png`,
      diffuseSize: Math.round(worldSize),
      groundmodelName: 'ASPHALT',
    },
  }, null, 2));

  // ── main/items.level.json ──────────────────────────────────────────────────
  zip.file(`${base}/main/items.level.json`,
    toNDJSON([{ class: 'SimGroup', name: 'MissionGroup' }])
  );

  // ── main/MissionGroup/items.level.json ─────────────────────────────────────
  zip.file(`${base}/main/MissionGroup/items.level.json`,
    toNDJSON([
      { __parent: 'MissionGroup', class: 'SimGroup', name: 'PlayerDropPoints' },
      { __parent: 'MissionGroup', class: 'SimGroup', name: 'Level_objects' },
    ])
  );

  // ── main/MissionGroup/Level_objects/items.level.json ──────────────────────
  // LevelInfo, TimeOfDay, ScatterSky, and the Other group (which holds terrain)
  // are all defined here, matching the Cliff level's structure.
  zip.file(`${base}/main/MissionGroup/Level_objects/items.level.json`,
    toNDJSON([
      {
        __parent: 'Level_objects',
        class: 'LevelInfo',
        name: 'theLevelInfo',
        canvasClearColor: [0, 0, 0, 1],
        fogAtmosphereHeight: 1000,
        fogDensity: 0.0001,
        fogDensityOffset: 0,
        gravity: -9.81,
        nearClip: 0.1,
        visibleDistance: 4000,
      },
      {
        __parent: 'Level_objects',
        class: 'TimeOfDay',
        name: 'tod',
        startTime: 0.15,
      },
      {
        __parent: 'Level_objects',
        class: 'ScatterSky',
        name: 'sunsky',
        ambientScaleGradientFile: 'art/sky_gradients/default/gradient_ambient.png',
        colorizeGradientFile: 'art/sky_gradients/default/gradient_colorize.png',
        enableFogFallBack: false,
        fogScaleGradientFile: 'art/sky_gradients/default/gradient_fog.png',
        shadowDistance: 1500,
        skyBrightness: 40,
        sunScaleGradientFile: 'art/sky_gradients/default/gradient_sunscale.png',
        texSize: 2048,
      },
      {
        __parent: 'Level_objects',
        class: 'SimGroup',
        name: 'Other',
      },
    ])
  );

  // ── main/MissionGroup/Level_objects/Other/items.level.json ────────────────
  // TerrainBlock referencing the .ter file and the satellite-based material.
  // - squareSize: real-world meters per terrain grid square
  // - maxHeight:  elevation range in meters (maps ter 0→65535 to 0→maxHeight)
  // - baseTexSize: resolution of the base color texture (matches satellite pixel size)
  // - terrainFile: forward-slash path, no leading slash (BeamNG convention)
  zip.file(`${base}/main/MissionGroup/Level_objects/Other/items.level.json`,
    toNDJSON([{
      __parent: 'Other',
      class: 'TerrainBlock',
      name: 'theTerrain',
      position: [-halfExtent, -halfExtent, 0],
      squareSize,
      maxHeight,
      baseTexSize: size,
      terrainFile: `levels/${levelName}/terrain.ter`,
    }])
  );

  // ── main/MissionGroup/PlayerDropPoints/items.level.json ───────────────────
  // Spawn position: midpoint of nearest road to terrain center (or center
  // fallback), 3 m above the terrain surface at that point.
  zip.file(`${base}/main/MissionGroup/PlayerDropPoints/items.level.json`,
    toNDJSON([{
      __parent: 'PlayerDropPoints',
      class: 'SpawnSphere',
      dataBlock: 'SpawnSphereMarker',
      name: 'spawn_default',
      position: spawnPosition,
      radius: 5,
    }])
  );

  const zipBlob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE' });
  return { blob: zipBlob, filename: `${levelName}.zip` };
}
