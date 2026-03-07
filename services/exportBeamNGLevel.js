import * as THREE from 'three';
import JSZip from 'jszip';
import { exportTer } from './exportTer.js';
import { createOSMGroup, createSurroundingMeshes, SCENE_SIZE } from './export3d.js';

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
 * Load a URL into a canvas and re-encode as a PNG Blob.
 * Required because BeamNG's GBitmap::readPNG rejects non-PNG streams
 * (satellite tiles are JPEG).
 */
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

/**
 * Return the terrain texture as a PNG Blob for the given textureType.
 *
 * textureType options:
 *   'hybrid'          — satellite + road overlay (default)
 *   'satellite'       — plain satellite imagery
 *   'osm'             — procedural OSM texture
 *   'segmented'       — segmented satellite
 *   'segmentedHybrid' — segmented satellite + OSM roads overlay
 *
 * Falls back to the grey 64×64 placeholder if the requested texture is
 * unavailable. Always re-encodes as PNG.
 */
async function getTerrainTextureBlob(terrainData, textureType = 'hybrid') {
  try {
    if (textureType === 'hybrid') {
      // In-memory canvas is the fastest path — no fetch needed.
      if (terrainData.hybridTextureCanvas) {
        return new Promise(r => terrainData.hybridTextureCanvas.toBlob(r, 'image/png'));
      }
      if (terrainData.hybridTextureUrl) return await urlToPngBlob(terrainData.hybridTextureUrl);
    } else if (textureType === 'satellite' && terrainData.satelliteTextureUrl) {
      return await urlToPngBlob(terrainData.satelliteTextureUrl);
    } else if (textureType === 'osm' && terrainData.osmTextureUrl) {
      return await urlToPngBlob(terrainData.osmTextureUrl);
    } else if (textureType === 'segmented' && terrainData.segmentedTextureUrl) {
      return await urlToPngBlob(terrainData.segmentedTextureUrl);
    } else if (textureType === 'segmentedHybrid' && terrainData.segmentedHybridTextureUrl) {
      return await urlToPngBlob(terrainData.segmentedHybridTextureUrl);
    }
  } catch (_) {}

  // Fallback: try plain satellite, then grey placeholder
  if (terrainData.satelliteTextureUrl) {
    try { return await urlToPngBlob(terrainData.satelliteTextureUrl); } catch (_) {}
  }
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
 * Generate a Collada (.dae) Blob containing all OSM 3D objects (buildings,
 * trees, barriers, street furniture) in BeamNG world-space coordinates.
 *
 * Coordinate transform — Three.js scene-space (Y-up, normalized 0–100 units)
 * → BeamNG world-space (Z-up, real metres, origin at terrain centre):
 *   beamX =  sceneX * s   (east stays east)
 *   beamY = -sceneZ * s   (Three.js +Z is south; BeamNG +Y is north)
 *   beamZ =  sceneY * s   (Three.js Y-up becomes BeamNG Z-up)
 * where s = worldSize / SCENE_SIZE.
 *
 * All materials are named "osm_object" so they resolve to a single entry in
 * the level's art/shapes/main.materials.json (vertex-colour, no texture map).
 * Texture maps are stripped before export — they belong to the 3D preview, not
 * to the game level file.
 *
 * The exported DAE declares Z_UP so BeamNG loads it without any axis rotation.
 *
 * Returns a Blob, or null if there are no OSM features.
 */
async function generateOSMObjectsDAE(terrainData, worldSize) {
  if (!terrainData.osmFeatures?.length) return null;

  const osmGroup = createOSMGroup(terrainData);

  // Verify there is at least one mesh child — an empty group means no features
  // were of a type that produces geometry (e.g. only road centrelines).
  let hasMesh = false;
  osmGroup.traverse(c => { if (c.isMesh) hasMesh = true; });
  if (!hasMesh) return null;

  // Transform: scene-space (Y-up, normalised) → BeamNG world-space (Z-up, metres)
  const s = worldSize / SCENE_SIZE;
  const transformMatrix = new THREE.Matrix4().set(
    s,  0,  0,  0,   // beamX = sceneX * s
    0,  0, -s,  0,   // beamY = -sceneZ * s
    0,  s,  0,  0,   // beamZ = sceneY * s
    0,  0,  0,  1,
  );

  osmGroup.traverse(child => {
    if (!child.isMesh) return;

    // Bake the coordinate transform into each geometry's vertex data.
    // applyMatrix4 handles positions and derives the correct normal matrix.
    child.geometry.applyMatrix4(transformMatrix);

    // Strip texture maps (3D-preview assets) and name materials for BeamNG.
    const mats = Array.isArray(child.material) ? child.material : [child.material];
    mats.forEach(m => {
      if (!m) return;
      m.map = null;
      m.normalMap = null;
      m.roughnessMap = null;
      m.metalnessMap = null;
      m.name = 'osm_object';
    });
  });

  // Export to Collada
  const scene = new THREE.Scene();
  scene.add(osmGroup);
  scene.updateMatrixWorld(true);

  const { ColladaExporter } = await import('./ColladaExporter.js');
  const result = new ColladaExporter().parse(scene, undefined, { version: '1.4.1' });
  if (!result?.data) return null;

  // result.data is a Blob — read it as text so we can patch the asset header.
  // The geometry is already in Z-up space; declare Z_UP so BeamNG does not
  // apply an additional Y→Z axis rotation on top.
  const daeText = await result.data.text();
  const daePatched = daeText.replace('<up_axis>Y_UP</up_axis>', '<up_axis>Z_UP</up_axis>');
  return new Blob([daePatched], { type: 'model/vnd.collada+xml' });
}

/**
 * Generate a Collada (.dae) Blob containing the 8 surrounding terrain tiles
 * (NW, N, NE, W, E, SW, S, SE) textured with satellite imagery at zoom 15.
 *
 * Fetches surrounding tile elevation + satellite data (zoom 15, max 1024px),
 * builds a Three.js mesh group with per-tile satellite textures, applies the
 * scene-space → BeamNG world-space coordinate transform, and exports as DAE.
 *
 * Each tile gets its own material named `backdrop_${pos}` (e.g. backdrop_NW).
 * The ColladaExporter packages the satellite images as `textures/backdrop_*.png`
 * and returns them in result.textures — these are saved alongside the DAE in
 * art/shapes/textures/ in the level zip.
 *
 * Returns { daeBlob, textureFiles } where textureFiles is the array from
 * ColladaExporter (each entry: { name, ext, data: Uint8Array, directory }).
 * Returns null if no surrounding data could be fetched.
 */
async function generateTerrainBackdropDAE(terrainData, worldSize) {
  // Zoom 15 gives ~4m/px satellite imagery; 1024px cap avoids canvas-size
  // failures at large resolutions while still giving usable texture quality.
  const surroundingGroup = await createSurroundingMeshes(terrainData, null, 128, {
    fetchResolutionCap: 1024,
    includeSatellite: true,
    satelliteZoom: 15,
  });
  if (!surroundingGroup) return null;

  let hasMesh = false;
  surroundingGroup.traverse(c => { if (c.isMesh) hasMesh = true; });
  if (!hasMesh) return null;

  // Place the group in a temporary scene so scene.updateMatrixWorld() propagates
  // the correct matrixWorld to every child (group at origin → mesh.matrixWorld
  // equals the mesh's own local matrix: rotation.x = -π/2 + position offset).
  const scene = new THREE.Scene();
  scene.add(surroundingGroup);
  scene.updateMatrixWorld(true);

  const s = worldSize / SCENE_SIZE;
  const transformMatrix = new THREE.Matrix4().set(
    s,  0,  0,  0,   // beamX = sceneX * s
    0,  0, -s,  0,   // beamY = -sceneZ * s
    0,  s,  0,  0,   // beamZ = sceneY * s
    0,  0,  0,  1,
  );

  surroundingGroup.traverse(child => {
    if (!child.isMesh) return;

    // Derive tile position name from mesh name (e.g. "terrain_NW" → "NW").
    const pos = child.name.replace('terrain_', '') || 'tile';
    const matName = `backdrop_${pos}`;

    // Name the material and its texture map for the ColladaExporter and for
    // BeamNG's material resolution via main.materials.json.
    const mats = Array.isArray(child.material) ? child.material : [child.material];
    mats.forEach(m => {
      if (!m) return;
      m.name = matName;
      if (m.map) m.map.name = matName;
      // Strip non-diffuse maps — they don't belong in the level file.
      m.normalMap = null;
      m.roughnessMap = null;
      m.metalnessMap = null;
    });

    // Bake world transform (rotation + tile offset) into geometry vertex data,
    // then apply the BeamNG coordinate transform on top.
    child.geometry.applyMatrix4(child.matrixWorld);
    child.geometry.applyMatrix4(transformMatrix);

    // Reset node-level transform to identity — geometry now has everything baked.
    child.position.set(0, 0, 0);
    child.rotation.set(0, 0, 0);
    child.scale.set(1, 1, 1);
    child.updateMatrix();
    child.matrixWorld.identity();
  });

  const { ColladaExporter } = await import('./ColladaExporter.js');
  const result = new ColladaExporter().parse(scene, undefined, {
    textureDirectory: 'textures',
    version: '1.4.1',
  });
  if (!result?.data) return null;

  const daeText = await result.data.text();
  const daePatched = daeText.replace('<up_axis>Y_UP</up_axis>', '<up_axis>Z_UP</up_axis>');
  return {
    daeBlob: new Blob([daePatched], { type: 'model/vnd.collada+xml' }),
    textureFiles: result.textures ?? [],
  };
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
 *       │   ├── terrain.png
 *       │   └── main.materials.json        (TerrainMaterial — chosen base texture)
 *       ├── art/shapes/                    (present when OSM features or backdrop exist)
 *       │   ├── osm_objects.dae            (buildings, trees, barriers — optional)
 *       │   ├── terrain_backdrop.dae       (surrounding terrain mesh — optional)
 *       │   └── main.materials.json        (Materials for all DAEs in this folder)
 *       └── main/
 *           └── MissionGroup/
 *               ├── items.level.json
 *               ├── PlayerDropPoints/
 *               │   └── items.level.json
 *               └── Level_objects/
 *                   ├── items.level.json   (LevelInfo, TimeOfDay, ScatterSky, Other group)
 *                   └── Other/
 *                       └── items.level.json  (TerrainBlock + optional TSStatics)
 *
 * @param {object} terrainData
 * @param {object} center        — { lat, lng }
 * @param {object} [options]
 * @param {string} [options.baseTexture='hybrid']      — 'hybrid' | 'satellite' | 'osm' | 'segmented' | 'segmentedHybrid'
 * @param {boolean} [options.includeBackdrop=false]    — fetch and include surrounding terrain backdrop DAE
 */
export async function exportBeamNGLevel(terrainData, center, options = {}) {
  const { baseTexture = 'hybrid', includeBackdrop = false } = options;
  const lat = center.lat.toFixed(4);
  const lng = center.lng.toFixed(4);
  const levelName = sanitizeLevelName(`mapng_${lat}_${lng}`);

  const size = Math.min(terrainData.width, terrainData.height);
  const squareSize = computeSquareSize(terrainData);
  const halfExtent = (size / 2) * squareSize;
  const worldSize = size * squareSize;
  const maxHeight = Math.ceil(terrainData.maxHeight - terrainData.minHeight);

  const spawnPosition = findSpawnPosition(terrainData, center, squareSize);

  const [{ blob: terBlob }, previewBlob, texBlob, osmDaeBlob, backdropResult] = await Promise.all([
    exportTer(terrainData),
    generatePreviewBlob(terrainData),
    getTerrainTextureBlob(terrainData, baseTexture),
    generateOSMObjectsDAE(terrainData, worldSize),
    includeBackdrop ? generateTerrainBackdropDAE(terrainData, worldSize) : Promise.resolve(null),
  ]);
  const backdropDaeBlob = backdropResult?.daeBlob ?? null;
  const backdropTextureFiles = backdropResult?.textureFiles ?? [];

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

  // ── art/shapes/ (OSM 3D objects and/or terrain backdrop) ──────────────────
  // Only written when at least one DAE file is present.
  if (osmDaeBlob || backdropDaeBlob) {
    zip.folder(`${base}/art/shapes`);

    if (osmDaeBlob) zip.file(`${base}/art/shapes/osm_objects.dae`, osmDaeBlob);
    if (backdropDaeBlob) zip.file(`${base}/art/shapes/terrain_backdrop.dae`, backdropDaeBlob);

    // Build a single materials JSON covering all DAEs in this directory.
    const shapeMaterials = {};
    if (osmDaeBlob) {
      // Vertex-colour Material: BeamNG multiplies diffuseColor × vertex colour.
      // All OSM mesh materials are named "osm_object" to resolve to this entry.
      shapeMaterials.osm_object = {
        class: 'Material',
        name: 'osm_object',
        mapTo: 'osm_object',
        annotation: 'BUILDINGS',
        Stages: [{ diffuseColor: [1, 1, 1, 1], vertColor: true }],
        translucentBlendOp: 'None',
      };
    }
    if (backdropDaeBlob) {
      // Save per-tile satellite textures alongside the DAE.
      if (backdropTextureFiles.length > 0) {
        zip.folder(`${base}/art/shapes/textures`);
        for (const tex of backdropTextureFiles) {
          zip.file(`${base}/art/shapes/textures/${tex.name}.${tex.ext}`, tex.data);
          // One BeamNG Material entry per tile, referencing its satellite texture.
          shapeMaterials[tex.name] = {
            class: 'Material',
            name: tex.name,
            mapTo: tex.name,
            annotation: 'TERRAIN',
            Stages: [{
              diffuseMap: `levels/${levelName}/art/shapes/textures/${tex.name}.${tex.ext}`,
              diffuseColor: [1, 1, 1, 1],
            }],
            translucentBlendOp: 'None',
          };
        }
      } else {
        // No satellite textures available — use a flat earth-tone fallback.
        shapeMaterials.backdrop_terrain = {
          class: 'Material',
          name: 'backdrop_terrain',
          mapTo: 'backdrop_terrain',
          annotation: 'TERRAIN',
          Stages: [{ diffuseColor: [0.55, 0.5, 0.45, 1] }],
          translucentBlendOp: 'None',
        };
      }
    }
    zip.file(`${base}/art/shapes/main.materials.json`, JSON.stringify(shapeMaterials, null, 2));
  }

  // ── art/terrain/terrain.png ────────────────────────────────────────────────
  zip.file(`${base}/art/terrain/terrain.png`, texBlob);

  // ── art/terrain/main.materials.json ───────────────────────────────────────
  // TerrainMaterial with the chosen base texture as full-terrain diffuse overlay.
  // Material name must match the name written in terrain.ter ("DefaultMaterial").
  // diffuseSize = worldSize so the texture covers the entire terrain exactly once.
  zip.file(`${base}/art/terrain/main.materials.json`, JSON.stringify({
    DefaultMaterial: {
      class: 'TerrainMaterial',
      internalName: 'DefaultMaterial',
      diffuseMap: `levels/${levelName}/art/terrain/terrain.png`,
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
  //
  // TSStatic (optional): OSM 3D objects DAE, placed at world origin.
  // The DAE geometry is already in BeamNG world-space — no rotation or scale
  // needed on the TSStatic. Collada up_axis is declared Z_UP in the file.
  const otherItems = [{
    __parent: 'Other',
    class: 'TerrainBlock',
    name: 'theTerrain',
    position: [-halfExtent, -halfExtent, 0],
    squareSize,
    maxHeight,
    baseTexSize: size,
    terrainFile: `levels/${levelName}/terrain.ter`,
  }];

  if (osmDaeBlob) {
    otherItems.push({
      __parent: 'Other',
      class: 'TSStatic',
      name: 'osm_objects',
      position: [0, 0, 0],
      shapeName: `levels/${levelName}/art/shapes/osm_objects.dae`,
      useInstanceRenderData: true,
    });
  }

  if (backdropDaeBlob) {
    otherItems.push({
      __parent: 'Other',
      class: 'TSStatic',
      name: 'terrain_backdrop',
      position: [0, 0, 0],
      shapeName: `levels/${levelName}/art/shapes/terrain_backdrop.dae`,
      useInstanceRenderData: true,
    });
  }

  zip.file(`${base}/main/MissionGroup/Level_objects/Other/items.level.json`,
    toNDJSON(otherItems)
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
