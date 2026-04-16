import * as THREE from 'three';
import JSZip from 'jszip';
import { encode } from 'fast-png';
import { exportTer } from './exportTer.js';
import { buildTerrainMaterials } from './osmTerrainMaterials.js';
import { createOSMGroup, createSurroundingMeshes, SCENE_SIZE } from './export3d.js';
import { prepareCroppedTerrainData } from './cropTerrain.js';
import { applyBuildingFoundations } from './buildingFoundations.js';
import { ColladaExporter } from './ColladaExporter.js';
import {
  getBeamNGFlavorById,
  getGlobalEnvironmentMap,
  getGroundCoverProfile,
  getManagedForestTemplate,
  getRockCandidates,
  getShapeMaterialDefsForFlavor,
  getWaterProfile,
  resolveBushType,
  resolveTreeTypeForTags,
} from './beamngFlavorCatalog.js';

/**
 * Sanitize a string for use as a BeamNG level folder name.
 */
function sanitizeLevelName(name) {
  return String(name || '')
    .trim()
    .replace(/[^a-zA-Z0-9_]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '');
}

/**
 * Generate a UUID v4 string for use as a BeamNG persistentId.
 * BeamNG uses these to track scene objects across editor save/load cycles.
 */
function generatePersistentId() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = Math.random() * 16 | 0;
    return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
  });
}

function pointInBounds(pt, bounds) {
  return (
    pt &&
    pt.lat <= bounds.north &&
    pt.lat >= bounds.south &&
    pt.lng >= bounds.west &&
    pt.lng <= bounds.east
  );
}

function filterOSMFeaturesToBounds(features, bounds) {
  if (!Array.isArray(features)) return [];
  return features.filter((feature) => {
    if (!Array.isArray(feature?.geometry) || feature.geometry.length === 0) return false;
    return feature.geometry.some((pt) => pointInBounds(pt, bounds));
  });
}

/**
 * Compute terrain square size (meters per grid square) from bounds.
 */
function computeSquareSize(terrainData) {
  if (Number.isFinite(terrainData?.metersPerPixel) && terrainData.metersPerPixel > 0) {
    return Math.round(terrainData.metersPerPixel * 100) / 100;
  }

  const { bounds, width } = terrainData;
  const centerLat = (bounds.north + bounds.south) / 2;
  const latRad = (centerLat * Math.PI) / 180;
  const metersPerDegreeLng = 111320 * Math.cos(latRad);
  const realWidthMeters = (bounds.east - bounds.west) * metersPerDegreeLng;
  return Math.round((realWidthMeters / width) * 100) / 100;
}

/**
 * Convert a WGS84 coordinate to BeamNG world-space [x, y, z].
 * Z is meters above the terrain's minimum elevation (+ offset).
 */
function geoToWorld(lat, lng, terrainData, squareSize, zOffset = 3) {
  const { bounds, width, height, heightMap, minHeight } = terrainData;
  const size = width;
  const worldSize = size * squareSize;

  const u = Math.max(0, Math.min(1, (lng - bounds.west) / (bounds.east - bounds.west)));
  // v=0 is north (top of heightMap), v=1 is south
  const v = Math.max(0, Math.min(1, (bounds.north - lat) / (bounds.north - bounds.south)));

  // Bilinear interpolation — matches BeamNG's own terrain height calculation,
  // preventing spawn/road positions from landing inside terrain peaks that fall
  // between heightmap samples.
  const fx = u * (width - 1);
  const fy = v * (height - 1);
  const c0 = Math.min(width - 1, Math.floor(fx));
  const c1 = Math.min(width - 1, c0 + 1);
  const r0 = Math.min(height - 1, Math.floor(fy));
  const r1 = Math.min(height - 1, r0 + 1);
  const tx = fx - c0;
  const ty = fy - r0;
  const sanitizeHeight = (h) => (Number.isFinite(h) && h > -10000 ? h : minHeight);
  const h00 = sanitizeHeight(heightMap[r0 * width + c0]);
  const h10 = sanitizeHeight(heightMap[r0 * width + c1]);
  const h01 = sanitizeHeight(heightMap[r1 * width + c0]);
  const h11 = sanitizeHeight(heightMap[r1 * width + c1]);
  const worldH = (h00 * (1 - tx) * (1 - ty) + h10 * tx * (1 - ty) + h01 * (1 - tx) * ty + h11 * tx * ty) - minHeight;

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
 * Compute a 9-element flat rotation matrix (row-major) for a spawn sphere
 * facing along the direction from ptA toward ptB in BeamNG world space.
 *
 * World space: X = east, Y = north. The rotation is around the Z axis.
 * Returns identity matrix if the two points are coincident.
 */
function computeSpawnRotationMatrix(ptA, ptB) {
  const dx = ptB.lng - ptA.lng; // east component
  const dy = ptB.lat - ptA.lat; // north component
  const len = Math.sqrt(dx * dx + dy * dy);
  if (len < 1e-10) return [1, 0, 0, 0, 1, 0, 0, 0, 1];

  const nx = dx / len; // normalized east
  const ny = dy / len; // normalized north

  // Rotation matrix: vehicle forward aligns with road tangent (nx, ny) in XY plane.
  // Row 0: right vector (ny, -nx, 0)
  // Row 1: forward vector (nx, ny, 0) — BeamNG +Y forward
  // Row 2: up vector (0, 0, 1)
  return [
    Math.round(ny * 1e6) / 1e6, Math.round(-nx * 1e6) / 1e6, 0,
    Math.round(nx * 1e6) / 1e6, Math.round(ny * 1e6) / 1e6,  0,
    0, 0, 1,
  ];
}

/**
 * Find the best spawn position: midpoint of the road nearest the terrain center,
 * falling back to terrain center if no usable roads exist.
 *
 * Returns { position: [x, y, z], rotationMatrix: [9 elements] }.
 */
function findSpawnPosition(terrainData, center, squareSize) {
  const EXCLUDE = ['footway', 'path', 'pedestrian', 'steps', 'cycleway', 'bridleway', 'corridor'];

  let spawnLat = center.lat;
  let spawnLng = center.lng;
  let rotationMatrix = [1, 0, 0, 0, 1, 0, 0, 0, 1]; // identity — facing north

  if (terrainData.osmFeatures?.length) {
    let bestDist = Infinity;
    for (const feature of terrainData.osmFeatures) {
      if (feature.type !== 'road' || !feature.geometry?.length) continue;
      const highway = feature.tags?.highway;
      if (highway && EXCLUDE.includes(highway)) continue;

      const midIdx = Math.floor(feature.geometry.length / 2);
      const mid = feature.geometry[midIdx];
      const dist = Math.hypot(mid.lat - center.lat, mid.lng - center.lng);
      if (dist < bestDist) {
        bestDist = dist;
        spawnLat = mid.lat;
        spawnLng = mid.lng;
        // Compute road tangent direction from adjacent geometry points.
        const prevIdx = Math.max(0, midIdx - 1);
        const nextIdx = Math.min(feature.geometry.length - 1, midIdx + 1);
        rotationMatrix = computeSpawnRotationMatrix(
          feature.geometry[prevIdx],
          feature.geometry[nextIdx],
        );
      }
    }
  }

  return {
    position: geoToWorld(spawnLat, spawnLng, terrainData, squareSize, 3),
    rotationMatrix,
  };
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
 * Resize a PNG blob to an exact square pixel size.
 * Required so terrain.png always matches baseTexSize in the TerrainMaterialTextureSet.
 */
async function resizePngBlob(blob, targetSize) {
  if (!blob) return blob;
  const bmp = await createImageBitmap(blob);
  if (bmp.width === targetSize && bmp.height === targetSize) {
    bmp.close();
    return blob;
  }
  const canvas = document.createElement('canvas');
  canvas.width = targetSize;
  canvas.height = targetSize;
  canvas.getContext('2d').drawImage(bmp, 0, 0, targetSize, targetSize);
  bmp.close();
  return new Promise(r => canvas.toBlob(r, 'image/png'));
}

/**
 * Return the terrain texture as a PNG Blob for the given textureType.
 *
 * textureType options:
 *   'hybrid'          — satellite + road overlay (default)
 *   'satellite'       — plain satellite imagery
 *   'osm'             — procedural OSM texture
 *
 * Falls back to the grey 64×64 placeholder if the requested texture is
 * unavailable. Always re-encodes as PNG.
 */
async function getTerrainTextureBlob(terrainData, textureType = 'hybrid') {
  try {
    if (textureType === 'hybrid') {
      // Priority: raw canvas (lossless, direct) → pre-encoded blob → blob URL fallback.
      // The canvas may be null after the 3D preview frees it from terrainData, but the
      // blob is always kept alive since it's a compressed PNG (much smaller than the canvas).
      if (terrainData.hybridTextureCanvas) {
        return new Promise(r => terrainData.hybridTextureCanvas.toBlob(r, 'image/png'));
      }
      if (terrainData.hybridTextureBlob) return terrainData.hybridTextureBlob;
      if (terrainData.hybridTextureUrl) return await urlToPngBlob(terrainData.hybridTextureUrl);
    } else if (textureType === 'satellite') {
      if (terrainData.satelliteTextureUrl) return await urlToPngBlob(terrainData.satelliteTextureUrl);
    } else if (textureType === 'osm') {
      if (terrainData.osmTextureCanvas) return new Promise(r => terrainData.osmTextureCanvas.toBlob(r, 'image/png'));
      if (terrainData.osmTextureBlob) return terrainData.osmTextureBlob;
      if (terrainData.osmTextureUrl) return await urlToPngBlob(terrainData.osmTextureUrl);
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
 * Generate a grayscale heightmap PNG at the terrain's native resolution.
 * Written as {terrainName}.terrainheightmap.png alongside the .ter file.
 * Referenced by terrain.terrain.json as "heightmapImage" — used by BeamNG's
 * terrain system internally (minimap display, editor visualization).
 */
async function generateHeightmapPng(terrainData, maxSize = 2048) {
  const { width, height, heightMap, minHeight, maxHeight } = terrainData;
  // Cap output to maxSize — this is a visual reference only (World Editor minimap).
  // Full-resolution for large terrains would waste hundreds of MB of canvas RAM.
  const outW = Math.min(width,  maxSize);
  const outH = Math.min(height, maxSize);
  const scaleX = width  / outW;
  const scaleY = height / outH;
  const range  = maxHeight - minHeight;

  const canvas = document.createElement('canvas');
  canvas.width  = outW;
  canvas.height = outH;
  const ctx     = canvas.getContext('2d');
  const imgData = ctx.createImageData(outW, outH);
  const d       = imgData.data;

  for (let y = 0; y < outH; y++) {
    const srcY = Math.min(height - 1, Math.round(y * scaleY));
    for (let x = 0; x < outW; x++) {
      const srcX = Math.min(width - 1, Math.round(x * scaleX));
      const h    = heightMap[srcY * width + srcX];
      const v    = range > 0 ? Math.floor(((h - minHeight) / range) * 255) : 128;
      const idx  = (y * outW + x) * 4;
      d[idx] = d[idx + 1] = d[idx + 2] = v;
      d[idx + 3] = 255;
    }
  }

  ctx.putImageData(imgData, 0, 0);
  return new Promise(r => canvas.toBlob(r, 'image/png'));
}

/**
 * Generate Road Architect-compatible terrain bitmap (16-bit grayscale PNG).
 *
 * Road Architect writes this as GFXFormatR16 and later reads it with
 * bmp:getTexel(x, y), then maps texel values back to terrain heights with:
 *   height = texel * ((zMax - zMin) / 65535) + zMin
 *
 * For generated levels, TerrainBlock zMin is 0 and zMax is maxHeight.
 */
function generateRoadArchitectHeightmapPng(terrainData, terrainBlockMaxHeight) {
  const { width, height, heightMap, minHeight } = terrainData;
  const zMin = 0;
  const zMax = Math.max(1, Number(terrainBlockMaxHeight) || 1);
  const scale = 65535 / Math.max(1e-9, (zMax - zMin));

  const data = new Uint16Array(width * height);
  for (let y = 0; y < height; y++) {
    // Terrain data uses north-origin rows; TerrainBlock grid is south-origin.
    const srcY = height - 1 - y;
    const srcRow = srcY * width;
    const dstRow = y * width;
    for (let x = 0; x < width; x++) {
      const worldRelativeH = Math.max(0, (heightMap[srcRow + x] - minHeight));
      const texel = Math.max(0, Math.min(65535, Math.round(worldRelativeH * scale)));
      data[dstRow + x] = texel;
    }
  }

  const pngData = encode({ width, height, data, depth: 16, channels: 1 });
  return new Blob([new Uint8Array(pngData)], { type: 'image/png' });
}

/**
 * Generate a Collada (.dae) Blob containing BeamNG-safe OSM 3D objects
 * (buildings, street furniture) in world-space coordinates.
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

  // Barriers are exported as native TSStatic objects in BeamNG scene JSON,
  // not baked into the generic OSM DAE mesh.
  const osmGroup = createOSMGroup(terrainData, {
    includeVegetation: false,
    includeBarriers: false,
  });

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

  // Pass upAxis directly — avoids reading the blob as text (which can truncate
  // large DAE files and cause TinyXML parse failures in BeamNG).
  const result = new ColladaExporter().parse(scene, undefined, { version: '1.4.1', upAxis: 'Z_UP' });
  if (!result?.data) return null;
  return result.data;
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
 * Returns { daeBlob, textureFiles, diagnostics } where textureFiles is the array from
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

  const result = new ColladaExporter().parse(scene, undefined, {
    textureDirectory: 'textures',
    version: '1.4.1',
    upAxis: 'Z_UP',
  });
  if (!result?.data) return null;
  return {
    daeBlob: result.data,
    textureFiles: result.textures ?? [],
    diagnostics: surroundingGroup.userData?.surroundingDiagnostics ?? null,
  };
}

// Fraction of terrain width/height to keep clear at each edge.
// BeamNG's improvedSpline raises DecalRoad nodes that fall outside or too near
// the TerrainBlock boundary high above the mesh.  Clipping to this inner margin
// prevents those floating-road artifacts.
const ROAD_EDGE_MARGIN = 0.015; // ≈ 15 m for a 1024-pixel terrain

/**
 * Liang-Barsky clip of segment (u0,v0)→(u1,v1) against the axis-aligned box
 * [lo,hi]×[lo,hi].  Returns [tEnter, tExit] ∈ [0,1] or null if no intersection.
 */
function lbClip(u0, v0, u1, v1, lo, hi) {
  let tEnter = 0, tExit = 1;
  const du = u1 - u0, dv = v1 - v0;
  for (const [p, q] of [[-du, u0 - lo], [du, hi - u0], [-dv, v0 - lo], [dv, hi - v0]]) {
    if (Math.abs(p) < 1e-12) { if (q < 0) return null; }
    else if (p < 0) tEnter = Math.max(tEnter, q / p);
    else            tExit  = Math.min(tExit,  q / p);
  }
  return tEnter <= tExit + 1e-12 ? [tEnter, tExit] : null;
}

/** Linearly interpolate between two {lat,lng} points at parameter t. */
function lerpLatLng(a, b, t) {
  return { lat: a.lat + t * (b.lat - a.lat), lng: a.lng + t * (b.lng - a.lng) };
}

/**
 * Clip an OSM geometry polyline to the terrain's safe inner boundary (minus
 * ROAD_EDGE_MARGIN on each side).  Returns an array of sub-polylines; each
 * sub-polyline has ≥ 2 points and lies entirely within the margin.
 * Segments that cross the boundary are split and the crossing point added,
 * so roads meet the edge cleanly rather than jumping inward.
 */
function clipGeometryToMargin(geometry, bounds) {
  const lo = ROAD_EDGE_MARGIN, hi = 1 - ROAD_EDGE_MARGIN;
  const uvOf = pt => [
    (pt.lng  - bounds.west)  / (bounds.east  - bounds.west),
    (bounds.north - pt.lat)  / (bounds.north - bounds.south),
  ];
  const inside = (u, v) => u >= lo && u <= hi && v >= lo && v <= hi;

  const segments = [];
  let current = [];

  for (let i = 0; i < geometry.length; i++) {
    const pt = geometry[i];
    const [u, v] = uvOf(pt);
    const inNow = inside(u, v);

    if (i === 0) {
      if (inNow) current.push(pt);
      continue;
    }

    const prev  = geometry[i - 1];
    const [pu, pv] = uvOf(prev);
    const inPrev = inside(pu, pv);

    if (inPrev && inNow) {
      // Both inside — normal case.
      current.push(pt);
    } else if (inPrev && !inNow) {
      // Exiting: add the exit point on the margin boundary, then break.
      const clip = lbClip(pu, pv, u, v, lo, hi);
      if (clip) current.push(lerpLatLng(prev, pt, clip[1]));
      if (current.length >= 2) segments.push(current);
      current = [];
    } else if (!inPrev && inNow) {
      // Entering: start new segment at the entry point on the margin boundary.
      const clip = lbClip(pu, pv, u, v, lo, hi);
      current = [clip ? lerpLatLng(prev, pt, clip[0]) : pt, pt];
    } else {
      // Both outside: the segment might still pass through the box.
      const clip = lbClip(pu, pv, u, v, lo, hi);
      if (clip) {
        if (current.length >= 2) segments.push(current);
        segments.push([lerpLatLng(prev, pt, clip[0]), lerpLatLng(prev, pt, clip[1])]);
        current = [];
      }
    }
  }

  if (current.length >= 2) segments.push(current);
  return segments;
}

/**
 * Split a polyline (array of points) into chunks of at most maxNodes nodes.
 * Adjacent chunks overlap by one node so there is no visible gap between the
 * resulting DecalRoad objects.
 */
function chunkPolyline(points, maxNodes = 50) {
  if (points.length <= maxNodes) return [points];
  const chunks = [];
  for (let i = 0; i < points.length - 1; i += maxNodes - 1) {
    chunks.push(points.slice(i, i + maxNodes));
  }
  return chunks;
}

// Minimum world-space distance (metres) between consecutive DecalRoad nodes.
// OSM data can have nodes every 1–2 m in urban areas; at that density, BeamNG's
// spline creates visible facets between every pair of nodes.  Decimating to a
// coarser spacing lets the spline interpolate a smooth curve instead.
const MIN_NODE_SPACING_M = 4.0;

/**
 * Remove DecalRoad nodes that are closer than MIN_NODE_SPACING_M to the
 * previous kept node (measured in XY world-space metres).  Always keeps the
 * first and last node so the road reaches its endpoints exactly.
 */
function decimateNodes(nodes) {
  if (nodes.length <= 2) return nodes;
  const out = [nodes[0]];
  for (let i = 1; i < nodes.length - 1; i++) {
    const prev = out[out.length - 1];
    const dx = nodes[i][0] - prev[0];
    const dy = nodes[i][1] - prev[1];
    if (Math.sqrt(dx * dx + dy * dy) >= MIN_NODE_SPACING_M) {
      out.push(nodes[i]);
    }
  }
  out.push(nodes[nodes.length - 1]);
  return out;
}

const GLOBAL_DECAL_MATERIALS = {
  lineWhite: 'm_line_white',
  lineYellowDouble: 'm_line_yellow_double',
  edgeAsphaltGrass: 'm_road_asphalt_edge_grass',
  edgeDirt: 'm_road_edge_dirt',
};

// OSM highway type → generated decal styling.
// width: half-width in metres (total road width = 2 × value).
// edgeMaterial: blend strip material along the road/terrain boundary.
const HIGHWAY_STYLE = {
  motorway:       { width: 8, edgeMaterial: GLOBAL_DECAL_MATERIALS.edgeAsphaltGrass },
  motorway_link:  { width: 5, edgeMaterial: GLOBAL_DECAL_MATERIALS.edgeAsphaltGrass },
  trunk:          { width: 8, edgeMaterial: GLOBAL_DECAL_MATERIALS.edgeAsphaltGrass },
  trunk_link:     { width: 5, edgeMaterial: GLOBAL_DECAL_MATERIALS.edgeAsphaltGrass },
  primary:        { width: 8, edgeMaterial: GLOBAL_DECAL_MATERIALS.edgeAsphaltGrass },
  primary_link:   { width: 5, edgeMaterial: GLOBAL_DECAL_MATERIALS.edgeAsphaltGrass },
  secondary:      { width: 6, edgeMaterial: GLOBAL_DECAL_MATERIALS.edgeAsphaltGrass },
  secondary_link: { width: 5, edgeMaterial: GLOBAL_DECAL_MATERIALS.edgeAsphaltGrass },
  tertiary:       { width: 5, edgeMaterial: GLOBAL_DECAL_MATERIALS.edgeAsphaltGrass },
  tertiary_link:  { width: 4, edgeMaterial: GLOBAL_DECAL_MATERIALS.edgeAsphaltGrass },
  residential:    { width: 4, edgeMaterial: GLOBAL_DECAL_MATERIALS.edgeAsphaltGrass },
  living_street:  { width: 4, edgeMaterial: GLOBAL_DECAL_MATERIALS.edgeAsphaltGrass },
  unclassified:   { width: 4, edgeMaterial: GLOBAL_DECAL_MATERIALS.edgeAsphaltGrass },
  road:           { width: 4, edgeMaterial: GLOBAL_DECAL_MATERIALS.edgeAsphaltGrass },
  service:        { width: 4, edgeMaterial: GLOBAL_DECAL_MATERIALS.edgeAsphaltGrass },
  raceway:        { width: 6, edgeMaterial: GLOBAL_DECAL_MATERIALS.edgeAsphaltGrass },
  busway:         { width: 4, edgeMaterial: GLOBAL_DECAL_MATERIALS.edgeAsphaltGrass },
  track:          { width: 4, edgeMaterial: GLOBAL_DECAL_MATERIALS.edgeDirt },
};

const DEFAULT_ROAD_STYLE = { width: 3, edgeMaterial: GLOBAL_DECAL_MATERIALS.edgeAsphaltGrass };

const ROAD_MARKING_STYLE = {
  edgeBlend: {
    material: GLOBAL_DECAL_MATERIALS.edgeAsphaltGrass,
    halfWidth: 2,
    offsetInsideEdge: 0.6,
    breakAngle: 0.5,
    detail: 0.3,
    renderPriority: 8,
    textureLength: 8,
    startEndFade: [1, 1],
  },
  edgeWhite: {
    material: GLOBAL_DECAL_MATERIALS.lineWhite,
    halfWidth: 0.2,
    offsetInsideEdge: 1.2,
    breakAngle: 1,
    renderPriority: 1,
    textureLength: 6.4,
    startEndFade: [0.2, 0.2],
  },
  centerDoubleYellow: {
    material: GLOBAL_DECAL_MATERIALS.lineYellowDouble,
    halfWidth: 0.4,
    breakAngle: 1,
    renderPriority: 2,
    textureLength: 6.4,
  },
};

// OSM highway types to exclude from road generation (non-vehicle ways).
const ROAD_SKIP = new Set([
  'footway', 'path', 'pedestrian', 'steps', 'cycleway',
  'bridleway', 'corridor', 'proposed', 'construction',
]);

// Only major roads receive painted lane markings.
const MAJOR_ROAD_MARKINGS = new Set([
  'motorway', 'motorway_link',
  'trunk', 'trunk_link',
  'primary', 'primary_link',
  'secondary', 'secondary_link',
]);

// Grass edge blends are useful mainly on higher class paved roads.
const GRASS_EDGE_BLEND_HIGHWAYS = new Set([
  'motorway', 'motorway_link',
  'trunk', 'trunk_link',
  'primary', 'primary_link',
  'secondary', 'secondary_link',
]);

const UNPAVED_SURFACES = new Set([
  'dirt', 'earth', 'gravel', 'fine_gravel', 'ground', 'mud', 'sand',
  'rock', 'scree', 'grass', 'compacted', 'unpaved', 'pebblestone',
  'snow', 'ice',
]);

function isLikelyUnmarkedRoad(tags = {}) {
  const laneMarkings = String(tags.lane_markings ?? '').trim().toLowerCase();
  if (laneMarkings === 'yes') return false;
  if (laneMarkings === 'no') return true;

  const surface = String(tags.surface ?? '').trim().toLowerCase();
  if (!surface) return false;
  return UNPAVED_SURFACES.has(surface);
}

function shouldUseLaneMarkings(highway, tags = {}) {
  if (!MAJOR_ROAD_MARKINGS.has(highway)) return false;
  return !isLikelyUnmarkedRoad(tags);
}

function shouldUseGrassEdgeBlend(highway, tags = {}) {
  if (!GRASS_EDGE_BLEND_HIGHWAYS.has(highway)) return false;
  const surface = String(tags.surface ?? '').trim().toLowerCase();
  // If explicitly unpaved, skip asphalt-grass edge blend.
  if (surface && UNPAVED_SURFACES.has(surface)) return false;
  return true;
}

function isOneWayRoad(tags = {}) {
  const value = String(tags.oneway ?? '').trim().toLowerCase();
  if (value === 'yes' || value === '1' || value === 'true') return true;
  if (value === '-1' || value === 'reverse') return true;
  if (tags.junction === 'roundabout') return true;
  if (tags.highway === 'motorway' || tags.highway === 'motorway_link') return true;
  return false;
}

function parsePositiveInt(value) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function parseRoadWidthMeters(value) {
  if (!value) return null;
  const raw = String(value).trim().toLowerCase();

  if (raw.includes('ft')) {
    const parsed = Number.parseFloat(raw.replace('ft', '').trim());
    return Number.isFinite(parsed) && parsed > 0 ? parsed * 0.3048 : null;
  }

  if (raw.includes('m')) {
    const parsed = Number.parseFloat(raw.replace('m', '').trim());
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
  }

  const parsed = Number.parseFloat(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;

  // OSM width values above ~40 without units are commonly feet.
  return parsed > 40 ? parsed * 0.3048 : parsed;
}

function getDefaultLaneWidthMeters(highway) {
  if (['motorway', 'motorway_link', 'trunk', 'trunk_link'].includes(highway)) return 3.7;
  if (['primary', 'primary_link', 'secondary', 'secondary_link'].includes(highway)) return 3.5;
  if (['tertiary', 'tertiary_link'].includes(highway)) return 3.25;
  if (['service', 'track'].includes(highway)) return 2.8;
  return 3.0;
}

function getDefaultLaneCount(highway, isOneWay) {
  if (['motorway', 'trunk'].includes(highway)) return isOneWay ? 2 : 4;
  if (['motorway_link', 'trunk_link', 'primary_link', 'secondary_link', 'tertiary_link'].includes(highway)) {
    return 1;
  }
  if (['service', 'track'].includes(highway)) return 1;
  return isOneWay ? 1 : 2;
}

function getRoadHalfWidthClamp(highway) {
  if (['motorway', 'motorway_link', 'trunk', 'trunk_link'].includes(highway)) {
    return { min: 3.5, max: 9.0 };
  }
  if (['primary', 'primary_link', 'secondary', 'secondary_link'].includes(highway)) {
    return { min: 2.8, max: 6.0 };
  }
  if (['service', 'track'].includes(highway)) {
    return { min: 1.8, max: 3.5 };
  }
  return { min: 2.2, max: 5.0 };
}

function estimateRoadHalfWidth(tags = {}, highway, isOneWay = false, fallbackHalfWidth = 3.5) {
  const explicitWidth = parseRoadWidthMeters(tags.width);
  const limits = getRoadHalfWidthClamp(highway);
  if (Number.isFinite(explicitWidth) && explicitWidth > 0) {
    return clamp(explicitWidth / 2, limits.min, limits.max);
  }

  const lanesFromTotal = parsePositiveInt(tags.lanes);
  const lanesFromDir = parsePositiveInt(tags['lanes:forward']) + parsePositiveInt(tags['lanes:backward']);
  const inferredLanes = Math.max(
    getDefaultLaneCount(highway, isOneWay),
    lanesFromTotal || lanesFromDir || 0,
  );
  const estimatedHalf = (inferredLanes * getDefaultLaneWidthMeters(highway)) / 2;

  return clamp(estimatedHalf || fallbackHalfWidth, limits.min, limits.max);
}

function offsetNodes(nodes, offset, halfWidth) {
  if (nodes.length < 2) return [];
  const out = [];
  for (let i = 0; i < nodes.length; i++) {
    const prev = nodes[Math.max(0, i - 1)];
    const next = nodes[Math.min(nodes.length - 1, i + 1)];
    const dx = next[0] - prev[0];
    const dy = next[1] - prev[1];
    const len = Math.hypot(dx, dy);
    const nx = len > 1e-6 ? -dy / len : 0;
    const ny = len > 1e-6 ? dx / len : 0;
    out.push([
      Math.round((nodes[i][0] + nx * offset) * 1000) / 1000,
      Math.round((nodes[i][1] + ny * offset) * 1000) / 1000,
      nodes[i][2],
      halfWidth,
    ]);
  }
  return decimateNodes(out);
}

function makeRoadDecal(nodes, props, materialOverride) {
  if (nodes.length < 2) return null;
  const decal = {
    class: 'DecalRoad',
    persistentId: generatePersistentId(),
    __parent: 'Decal_roads',
    position: [nodes[0][0], nodes[0][1], nodes[0][2]],
    improvedSpline: true,
    material: materialOverride || props.material,
    nodes,
    breakAngle: props.breakAngle,
    renderPriority: props.renderPriority,
    textureLength: props.textureLength,
    startEndFade: props.startEndFade,
  };
  if (Number.isFinite(props.detail)) decal.detail = props.detail;
  return decal;
}

/**
 * Convert OSM road features to BeamNG DecalRoad marking/edge objects.
 *
 * Each OSM way is clipped to the terrain's safe inner boundary before export.
 * Ways that cross the boundary are split into multiple DecalRoads at the
 * crossing point, so no node lands outside or too near the TerrainBlock edge
 * (which causes BeamNG's improvedSpline to float those segments in the air).
 *
 * DecalRoad nodes format: [x, y, z, halfWidth].
 *
 * Returns an empty array when no OSM data is available.
 */
function generateDecalRoads(terrainData, squareSize) {
  if (!terrainData.osmFeatures?.length) return [];

  const decals = [];

  for (const feature of terrainData.osmFeatures) {
    if (feature.type !== 'road' || !feature.geometry?.length) continue;

    const highway = feature.tags?.highway;
    if (!highway || ROAD_SKIP.has(highway)) continue;

    const style = HIGHWAY_STYLE[highway] ?? DEFAULT_ROAD_STYLE;
    const edgeBlendMaterial = ROAD_MARKING_STYLE.edgeBlend.material;
    const isOneWay = isOneWayRoad(feature.tags || {});
    const useLaneMarkings = shouldUseLaneMarkings(highway, feature.tags || {});
    const useEdgeBlend = shouldUseGrassEdgeBlend(highway, feature.tags || {});
    const styleHalfWidth = estimateRoadHalfWidth(feature.tags || {}, highway, isOneWay, style.width);

    // Clip to the terrain's safe inner boundary, splitting at crossings.
    // Then further chunk each segment so no single DecalRoad is too long.
    const clippedSegments = clipGeometryToMargin(feature.geometry, terrainData.bounds)
      .flatMap(s => chunkPolyline(s));

    for (const segment of clippedSegments) {
      const rawNodes = [];
      for (const pt of segment) {
        const [wx, wy, wz] = geoToWorld(pt.lat, pt.lng, terrainData, squareSize, 0.1);
        rawNodes.push([
          Math.round(wx * 1000) / 1000,
          Math.round(wy * 1000) / 1000,
          Math.round(wz * 1000) / 1000,
          styleHalfWidth,
        ]);
      }

      const centerNodes = decimateNodes(rawNodes);
      if (centerNodes.length < 2) continue;

      const leftEdgeBlend = offsetNodes(
        centerNodes,
        styleHalfWidth - ROAD_MARKING_STYLE.edgeBlend.offsetInsideEdge,
        ROAD_MARKING_STYLE.edgeBlend.halfWidth,
      );
      const rightEdgeBlend = offsetNodes(
        centerNodes,
        -(styleHalfWidth - ROAD_MARKING_STYLE.edgeBlend.offsetInsideEdge),
        ROAD_MARKING_STYLE.edgeBlend.halfWidth,
      );
      const leftWhite = offsetNodes(
        centerNodes,
        styleHalfWidth - ROAD_MARKING_STYLE.edgeWhite.offsetInsideEdge,
        ROAD_MARKING_STYLE.edgeWhite.halfWidth,
      );
      const rightWhite = offsetNodes(
        centerNodes,
        -(styleHalfWidth - ROAD_MARKING_STYLE.edgeWhite.offsetInsideEdge),
        ROAD_MARKING_STYLE.edgeWhite.halfWidth,
      );

      const leftEdgeBlendDecal = useEdgeBlend
        ? makeRoadDecal(leftEdgeBlend, ROAD_MARKING_STYLE.edgeBlend, edgeBlendMaterial)
        : null;
      const rightEdgeBlendDecal = useEdgeBlend
        ? makeRoadDecal(rightEdgeBlend, ROAD_MARKING_STYLE.edgeBlend, edgeBlendMaterial)
        : null;
      const leftWhiteDecal = useLaneMarkings ? makeRoadDecal(leftWhite, ROAD_MARKING_STYLE.edgeWhite) : null;
      const rightWhiteDecal = useLaneMarkings ? makeRoadDecal(rightWhite, ROAD_MARKING_STYLE.edgeWhite) : null;

      if (leftEdgeBlendDecal) decals.push(leftEdgeBlendDecal);
      if (rightEdgeBlendDecal) decals.push(rightEdgeBlendDecal);
      if (leftWhiteDecal) decals.push(leftWhiteDecal);
      if (rightWhiteDecal) decals.push(rightWhiteDecal);

      if (useLaneMarkings && !isOneWay) {
        const centerYellow = offsetNodes(centerNodes, 0, ROAD_MARKING_STYLE.centerDoubleYellow.halfWidth);
        const centerYellowDecal = makeRoadDecal(centerYellow, ROAD_MARKING_STYLE.centerDoubleYellow);
        if (centerYellowDecal) decals.push(centerYellowDecal);
      }
    }
  }

  return decals;
}

function createRoadArchitectDefaultProfile() {
  const persistentBaseLayer = {
    boxXLeft: 1,
    boxXRight: 1,
    boxYLeft: 1,
    boxYRight: 1,
    boxZLeft: 1,
    boxZRight: 1,
    doNotDelete: true,
    extentsH: 1,
    extentsL: 1,
    extentsW: 1,
    fadeE: 0,
    fadeS: 0,
    frame: 0,
    isDisplay: false,
    isHidden: false,
    isSpanLong: true,
    jitter: 0,
    laneMax: 1,
    laneMin: 1,
    latOffset: 0,
    matDisplay: '[None]',
    nMax: 1,
    nMin: 1,
    numCols: 1,
    numRows: 1,
    pos: 0,
    rot: 0,
    size: 3,
    spacing: 5,
    type: 1,
    useWorldZ: false,
    vertOffset: 0,
  };

  const layers = [
    {
      ...persistentBaseLayer,
      isLeft: true,
      isPaint: true,
      isReverse: false,
      lane: -1,
      mat: 'm_line_white',
      name: 'Edge Line L',
      off: 0.25,
      texLen: 5,
      width: 0.25,
    },
    {
      ...persistentBaseLayer,
      isLeft: false,
      isPaint: true,
      isReverse: false,
      lane: 1,
      mat: 'm_line_white',
      name: 'Edge Line R',
      off: -0.25,
      texLen: 5,
      width: 0.25,
    },
    {
      ...persistentBaseLayer,
      isDisplay: true,
      isLeft: true,
      isPaint: false,
      isReverse: true,
      lane: -1,
      mat: 'm_road_asphalt_edge',
      name: 'Edge Blend L',
      off: -0.5,
      texLen: 18,
      width: 2.000000238,
    },
    {
      ...persistentBaseLayer,
      isDisplay: true,
      isLeft: false,
      isPaint: false,
      isReverse: false,
      lane: 1,
      mat: 'm_road_asphalt_edge',
      name: 'Edge Blend R',
      off: 0.5,
      texLen: 18.00003433,
      width: 2.000000238,
    },
    {
      ...persistentBaseLayer,
      isLeft: true,
      isPaint: true,
      isReverse: false,
      lane: 1,
      mat: 'm_line_yellow_double_discontinue',
      name: 'Centerline',
      off: 0,
      texLen: 5,
      width: 0.400000006,
    },
  ];

  return {
    '-1': {
      cornerDrop: 0,
      cornerLatOff: 0,
      heightL: 0.01,
      heightR: 0.01,
      isLeftSide: true,
      kerbWidth: 0.12,
      type: 'road_lane',
      vStart: 0,
      width: 3.5,
    },
    '1': {
      cornerDrop: 0,
      cornerLatOff: 0,
      heightL: 0.01,
      heightR: 0.01,
      isLeftSide: true,
      kerbWidth: 0.12,
      type: 'road_lane',
      vStart: 0,
      width: 3.5,
    },
    autoBankingFactor: 1,
    blendLeftMat: 'm_road_asphalt_edge',
    blendLeftWidth: 1,
    blendRightMat: 'm_road_asphalt_edge',
    blendRightWidth: 1,
    centerlineMat: 'm_line_yellow_double_discontinue',
    class: 'urban',
    condition: 0.3,
    conditionCenterline: true,
    conditionEdgesL: true,
    conditionEdgesR: true,
    conditionEndStopE: true,
    conditionEndStopS: true,
    conditionLaneMarkings: true,
    conditionSeed: 41235,
    continueLinesToEnd: false,
    dirtMat: 'm_dirt_variation_04',
    edgeLineGapL: 0.25,
    edgeLineGapR: 0.25,
    edgeMatL: 'm_line_white',
    edgeMatR: 'm_line_white',
    endStopMatE: 'm_line_white',
    endStopMatS: 'm_line_white',
    fadeE: 0,
    fadeS: 0,
    gutterMargin: 0.02,
    gutterMat: 'gutter1',
    gutterWidth: 0.2,
    isAutoBanking: false,
    isDeletable: true,
    isEdgeBlendL: true,
    isEdgeBlendR: true,
    isExtraWidth: false,
    isGutter: false,
    isGutterShow: false,
    isShowEdgeBlend: true,
    isStopDecalE: false,
    isStopDecalS: false,
    laneMarkingsMat: 'm_line_yellow_discontinue',
    layers,
  };
}

function makeRoadArchitectNode(pt, terrainData, squareSize, halfWidth, laneCount) {
  const [x, y, z] = geoToWorldPoint(pt.lat, pt.lng, terrainData, squareSize, 0.1);
  const laneWidth = Math.max(2.6, Math.min(4.5, (halfWidth * 2) / Math.max(1, laneCount)));
  return {
    heightsL: {
      '1': 0.01,
      '-1': 0.01,
    },
    heightsR: {
      '1': 0.01,
      '-1': 0.01,
    },
    incircleRad: 1,
    isAutoBanked: false,
    isLocked: false,
    offset: 0,
    posX: roundTo(x, 6),
    posY: roundTo(y, 6),
    posZ: roundTo(z, 6),
    rot: 0,
    widths: {
      '1': laneWidth,
      '-1': laneWidth,
    },
  };
}

function makeLatLngKey(pt, decimals = 7) {
  return `${Number(pt.lat).toFixed(decimals)}:${Number(pt.lng).toFixed(decimals)}`;
}

function splitPolylineAtNodeKeys(points, splitKeys) {
  if (!Array.isArray(points) || points.length < 2 || !splitKeys || splitKeys.size === 0) {
    return [points];
  }

  const out = [];
  let current = [points[0]];

  for (let i = 1; i < points.length; i++) {
    const pt = points[i];
    current.push(pt);

    // Split at interior nodes that are shared across roads.
    if (i < points.length - 1 && splitKeys.has(makeLatLngKey(pt))) {
      if (current.length >= 2) out.push(current);
      current = [pt];
    }
  }

  if (current.length >= 2) out.push(current);
  return out;
}

function buildRoadIntersectionNodeKeySet(osmFeatures = []) {
  const counts = new Map();
  for (const feature of osmFeatures) {
    if (feature?.type !== 'road' || !Array.isArray(feature.geometry) || feature.geometry.length < 2) continue;
    const highway = feature.tags?.highway;
    if (!highway || ROAD_SKIP.has(highway)) continue;

    for (const pt of feature.geometry) {
      const key = makeLatLngKey(pt);
      counts.set(key, (counts.get(key) || 0) + 1);
    }
  }

  const intersectionKeys = new Set();
  for (const [key, count] of counts.entries()) {
    if (count >= 2) intersectionKeys.add(key);
  }
  return intersectionKeys;
}

function buildRoadNodeCountMap(osmFeatures = []) {
  const counts = new Map();
  for (const feature of osmFeatures) {
    if (feature?.type !== 'road' || !Array.isArray(feature.geometry) || feature.geometry.length < 2) continue;
    const highway = feature.tags?.highway;
    if (!highway || ROAD_SKIP.has(highway)) continue;
    for (const pt of feature.geometry) {
      const key = makeLatLngKey(pt);
      counts.set(key, (counts.get(key) || 0) + 1);
    }
  }
  return counts;
}

function createRoadArchitectPedCrossingLayer(name = 'Ped X - R1') {
  return {
    boxXLeft: 1,
    boxXRight: 1,
    boxYLeft: 1,
    boxYRight: 1,
    boxZLeft: 1,
    boxZRight: 1,
    doNotDelete: true,
    extentsH: 1,
    extentsL: 1,
    extentsW: 1,
    fadeE: 0,
    fadeS: 0,
    frame: 0,
    isDisplay: true,
    isHidden: false,
    isLeft: true,
    isPaint: false,
    isReverse: false,
    isSpanLong: true,
    jitter: 0,
    lane: 1,
    laneMax: 1,
    laneMin: -1,
    latOffset: 0,
    mat: 'crossing_white',
    matDisplay: '[None]',
    nMax: 1,
    nMin: 1,
    name,
    numCols: 0,
    numRows: 0,
    off: 0,
    pos: 0,
    rot: 0,
    size: 0,
    spacing: 0,
    texLen: 5,
    type: 2,
    useWorldZ: false,
    vertOffset: 0,
    width: 2,
  };
}

function createRoadArchitectTrafficBoomLayer(name = 'traffic boom A') {
  return {
    boxXLeft: 1,
    boxXRight: 1,
    boxYLeft: 1,
    boxYRight: 1,
    boxZLeft: 1,
    boxZRight: 1,
    doNotDelete: true,
    extentsH: 1,
    extentsL: 1,
    extentsW: 1,
    fadeE: 0,
    fadeS: 0,
    frame: 0,
    isDisplay: true,
    isHidden: false,
    isLeft: true,
    isPaint: false,
    isReverse: false,
    isSpanLong: true,
    jitter: 0,
    lane: -1,
    laneMax: -1,
    laneMin: -1,
    latOffset: 0,
    mat: '/art/shapes/objects/s_trafficlight_boom_sn.dae',
    matDisplay: 's_trafficlight_boom_ns.dae',
    nMax: 1,
    nMin: 1,
    name,
    numCols: 1,
    numRows: 1,
    off: 0,
    pos: 0,
    rot: 3,
    size: 3,
    spacing: 0,
    texLen: 5,
    type: 5,
    useWorldZ: false,
    vertOffset: 0,
    width: 1,
  };
}

function createRoadArchitectCrossroadsApproachProfile(pedName) {
  const profile = createRoadArchitectDefaultProfile();
  profile.condition = 0.2;
  profile.conditionCenterline = false;
  profile.conditionEdgesL = false;
  profile.conditionEdgesR = false;
  profile.conditionLaneMarkings = false;
  profile.conditionEndStopE = false;
  profile.conditionEndStopS = false;
  profile.fadeE = 3;
  profile.fadeS = 3;
  profile.isEdgeBlendL = false;
  profile.isEdgeBlendR = false;
  profile.layers = [
    createRoadArchitectPedCrossingLayer(pedName),
    createRoadArchitectTrafficBoomLayer(),
  ];
  return profile;
}

function createRoadArchitectSidewalkOnlyProfile() {
  return {
    '1': {
      cornerDrop: 0,
      cornerLatOff: 0,
      heightL: 0.01,
      heightR: 0.12,
      isLeftSide: false,
      kerbWidth: 0.12,
      type: 'sidewalk',
      vStart: 0,
      width: 2,
    },
    autoBankingFactor: 1,
    blendLeftMat: 'm_road_asphalt_edge',
    blendLeftWidth: 1,
    blendRightMat: 'm_road_asphalt_edge',
    blendRightWidth: 1,
    centerlineMat: 'm_line_yellow_double_discontinue',
    class: 'urban',
    condition: 0.2,
    conditionCenterline: true,
    conditionEdgesL: true,
    conditionEdgesR: true,
    conditionEndStopE: true,
    conditionEndStopS: true,
    conditionLaneMarkings: true,
    conditionSeed: 41234,
    continueLinesToEnd: false,
    dirtMat: 'm_dirt_variation_04',
    edgeLineGapL: 0.25,
    edgeLineGapR: 0.25,
    edgeMatL: 'm_line_white',
    edgeMatR: 'm_line_white',
    endStopMatE: 'm_line_white',
    endStopMatS: 'm_line_white',
    fadeE: 3,
    fadeS: 3,
    gutterMargin: 0.02,
    gutterMat: 'gutter1',
    gutterWidth: 0.2,
    isAutoBanking: false,
    isDeletable: true,
    isEdgeBlendL: false,
    isEdgeBlendR: false,
    isExtraWidth: false,
    isGutter: false,
    isGutterShow: false,
    isShowEdgeBlend: true,
    isStopDecalE: false,
    isStopDecalS: false,
    laneMarkingsMat: 'm_line_yellow_discontinue',
    layers: {},
    name: 'New Profile',
    numPatches: 2,
    numPotholes: 0,
    stopGapE: 0.2,
    stopGapS: 0.2,
    styleType: 0,
  };
}

function makeRoadArchitectSidewalkNode(worldX, worldY, worldZ) {
  return {
    heightsL: { '1': 0.01 },
    heightsR: { '1': 0.12 },
    incircleRad: 1,
    isAutoBanked: false,
    isLocked: true,
    offset: 0,
    posX: roundTo(worldX, 6),
    posY: roundTo(worldY, 6),
    posZ: roundTo(worldZ, 6),
    rot: 0,
    widths: { '1': 2 },
  };
}

function normalize2D(dx, dy) {
  const len = Math.hypot(dx, dy);
  if (len < 1e-6) return { x: 1, y: 0 };
  return { x: dx / len, y: dy / len };
}

function enrichRoadArchitectCrossroads(roads, intersectionEntries, startSidewalkIndex = 1) {
  if (!Array.isArray(roads) || !intersectionEntries || intersectionEntries.size === 0) {
    return { sidewalkRoads: [], nextSidewalkIndex: startSidewalkIndex };
  }

  const sidewalkRoads = [];
  let sidewalkIndex = startSidewalkIndex;

  for (const entries of intersectionEntries.values()) {
    const uniqueByRoad = new Map();
    for (const entry of entries) {
      if (!uniqueByRoad.has(entry.roadIndex)) uniqueByRoad.set(entry.roadIndex, entry);
    }
    const candidates = Array.from(uniqueByRoad.values());
    if (candidates.length < 4) continue;

    const selected = candidates.slice(0, 4);

    for (let i = 0; i < selected.length; i++) {
      const sel = selected[i];
      const road = roads[sel.roadIndex];
      if (!road) continue;
      road.profile = createRoadArchitectCrossroadsApproachProfile(`Ped X - R${i + 1}`);

      const nodes = road.nodes;
      if (Array.isArray(nodes) && nodes.length >= 2) {
        if (sel.endpoint === 'start') nodes[0].isLocked = true;
        else nodes[nodes.length - 1].isLocked = true;
      }
    }

    const centerX = selected.reduce((sum, sel) => sum + sel.endX, 0) / selected.length;
    const centerY = selected.reduce((sum, sel) => sum + sel.endY, 0) / selected.length;
    const centerZ = selected.reduce((sum, sel) => sum + sel.endZ, 0) / selected.length;
    const laneHalf = selected.reduce((sum, sel) => sum + sel.laneHalfWidth, 0) / selected.length;
    const sidewalkRadius = Math.max(4.5, laneHalf + 2.5);

    selected.sort((a, b) => Math.atan2(a.dirY, a.dirX) - Math.atan2(b.dirY, b.dirX));

    for (let i = 0; i < selected.length; i++) {
      const a = selected[i];
      const b = selected[(i + 1) % selected.length];
      const ax = centerX + a.dirX * sidewalkRadius;
      const ay = centerY + a.dirY * sidewalkRadius;
      const bx = centerX + b.dirX * sidewalkRadius;
      const by = centerY + b.dirY * sidewalkRadius;
      const bis = normalize2D(a.dirX + b.dirX, a.dirY + b.dirY);
      const mx = centerX + bis.x * sidewalkRadius * 1.2;
      const my = centerY + bis.y * sidewalkRadius * 1.2;

      sidewalkRoads.push({
        bridgeArch: -6,
        bridgeDepth: 4,
        bridgeWidth: 5.5,
        displayName: `Crossroads Sidewalk ${sidewalkIndex++}`,
        extraE: 2,
        extraS: 2,
        forceField: 1,
        granFactor: 2,
        groupIdx: {},
        isAllowTunnels: false,
        isArc: true,
        isBridge: false,
        isCivilEngRoads: false,
        isConformRoadToTerrain: false,
        isDisplayLaneInfo: true,
        isDisplayNodeNumbers: false,
        isDisplayNodeSpheres: true,
        isDisplayRefLine: true,
        isDisplayRoadOutline: true,
        isDisplayRoadSurface: true,
        isDrivable: false,
        isHidden: false,
        isJctRoad: false,
        isOverObject: true,
        isOverlay: false,
        isRigidTranslation: false,
        isVis: true,
        name: generatePersistentId(),
        nodes: [
          makeRoadArchitectSidewalkNode(ax, ay, centerZ),
          makeRoadArchitectSidewalkNode(mx, my, centerZ),
          makeRoadArchitectSidewalkNode(bx, by, centerZ),
        ],
        overlayMat: 'm_tread_marks_clean',
        profile: createRoadArchitectSidewalkOnlyProfile(),
        protrudeE: 0,
        protrudeS: 0,
        radGran: 15,
        radOffset: 0,
        thickness: 1,
        treatAsInvisibleInEdit: false,
        zOffsetFromRoad: 0,
      });
    }
  }

  return { sidewalkRoads, nextSidewalkIndex: sidewalkIndex };
}

function generateRoadArchitectSession(terrainData, squareSize, levelName) {
  if (!terrainData?.osmFeatures?.length) return null;

  const roadNodeCounts = buildRoadNodeCountMap(terrainData.osmFeatures);
  const intersectionNodeKeys = new Set();
  const fourWayNodeKeys = new Set();
  for (const [key, count] of roadNodeCounts.entries()) {
    if (count >= 2) intersectionNodeKeys.add(key);
    if (count >= 4) fourWayNodeKeys.add(key);
  }

  const roads = [];
  const intersectionEntries = new Map();

  for (const feature of terrainData.osmFeatures) {
    if (feature.type !== 'road' || !Array.isArray(feature.geometry) || feature.geometry.length < 2) continue;
    const tags = feature.tags || {};
    const highway = tags.highway;
    if (!highway || ROAD_SKIP.has(highway)) continue;

    const style = HIGHWAY_STYLE[highway] ?? DEFAULT_ROAD_STYLE;
    const isOneWay = isOneWayRoad(tags);
    const halfWidth = estimateRoadHalfWidth(tags, highway, isOneWay, style.width);
    const laneCount = Math.max(1, getDefaultLaneCount(highway, isOneWay));
    const clippedSegments = clipGeometryToMargin(feature.geometry, terrainData.bounds)
      .flatMap((segment) => splitPolylineAtNodeKeys(segment, intersectionNodeKeys))
      .flatMap((segment) => chunkPolyline(segment, 80));

    for (const segment of clippedSegments) {
      const nodes = segment.map((pt) => makeRoadArchitectNode(pt, terrainData, squareSize, halfWidth, laneCount));
      if (nodes.length < 2) continue;

      const startKey = makeLatLngKey(segment[0]);
      const endKey = makeLatLngKey(segment[segment.length - 1]);
      const roadIndex = roads.length;

      roads.push({
        bridgeArch: 0,
        bridgeDepth: 8,
        bridgeWidth: 8,
        displayName: String(tags.name || `${highway}_${roads.length + 1}`),
        extraE: 0,
        extraS: 0,
        forceField: 1.0,
        granFactor: 1,
        groupIdx: [],
        isAllowTunnels: false,
        isArc: false,
        isBridge: false,
        isCivilEngRoads: false,
        isConformRoadToTerrain: true,
        isDisplayLaneInfo: true,
        isDisplayNodeNumbers: false,
        isDisplayNodeSpheres: true,
        isDisplayRefLine: true,
        isDisplayRoadOutline: true,
        isDisplayRoadSurface: true,
        isDrivable: true,
        isHidden: false,
        isJctRoad: false,
        isOverObject: true,
        isOverlay: false,
        isRigidTranslation: false,
        isVis: true,
        name: generatePersistentId(),
        nodes,
        overlayMat: 'm_tread_marks_clean',
        profile: createRoadArchitectDefaultProfile(),
        protrudeE: 0,
        protrudeS: 0,
        radGran: 15,
        radOffset: 0,
        thickness: 1.0,
        treatAsInvisibleInEdit: false,
        zOffsetFromRoad: 0,
      });

      const addIntersectionEntry = (nodeKey, endpoint) => {
        if (!fourWayNodeKeys.has(nodeKey)) return;
        const road = roads[roadIndex];
        if (!road || !Array.isArray(road.nodes) || road.nodes.length < 2) return;
        const endNode = endpoint === 'start' ? road.nodes[0] : road.nodes[road.nodes.length - 1];
        const nearNode = endpoint === 'start' ? road.nodes[1] : road.nodes[road.nodes.length - 2];
        const dir = endpoint === 'start'
          ? normalize2D(nearNode.posX - endNode.posX, nearNode.posY - endNode.posY)
          : normalize2D(endNode.posX - nearNode.posX, endNode.posY - nearNode.posY);
        const list = intersectionEntries.get(nodeKey) || [];
        list.push({
          roadIndex,
          endpoint,
          dirX: dir.x,
          dirY: dir.y,
          endX: endNode.posX,
          endY: endNode.posY,
          endZ: endNode.posZ,
          laneHalfWidth: Number(endNode?.widths?.['1']) || 3.5,
        });
        intersectionEntries.set(nodeKey, list);
      };

      addIntersectionEntry(startKey, 'start');
      addIntersectionEntry(endKey, 'end');
    }
  }

  if (roads.length === 0) return null;

  const { sidewalkRoads } = enrichRoadArchitectCrossroads(roads, intersectionEntries, 1);
  if (sidewalkRoads.length > 0) roads.push(...sidewalkRoads);

  return {
    data: {
      groups: {},
      junctions: {},
      mapName: String(levelName || 'mapng').toLowerCase(),
      placedGroups: {},
      profiles: [createRoadArchitectDefaultProfile()],
      roads,
    },
  };
}

/**
 * Convert OSM road features to BeamNG MeshRoad 3D geometry objects.
 *
 * Each road segment becomes a MeshRoad with m_asphalt_new_01 on the top, side,
 * and bottom surfaces. Node format is [x, y, z, fullWidth, depth, nx, ny, nz].
 * Roads that were split by clipping or chunking share an incremented counter
 * so each object gets a unique name.
 *
 * Returns an empty array when no OSM data is available or useMeshRoads is false.
 */
function generateMeshRoads(terrainData, squareSize) {
  if (!terrainData.osmFeatures?.length) return [];

  const meshRoads = [];
  let roadIndex = 0;

  for (const feature of terrainData.osmFeatures) {
    if (feature.type !== 'road' || !feature.geometry?.length) continue;

    const highway = feature.tags?.highway;
    if (!highway || ROAD_SKIP.has(highway)) continue;

    const style = HIGHWAY_STYLE[highway] ?? DEFAULT_ROAD_STYLE;
    const isOneWay = isOneWayRoad(feature.tags || {});
    const halfWidth = estimateRoadHalfWidth(feature.tags || {}, highway, isOneWay, style.width);
    const fullWidth = halfWidth * 2;

    const clippedSegments = clipGeometryToMargin(feature.geometry, terrainData.bounds)
      .flatMap(s => chunkPolyline(s));

    for (const segment of clippedSegments) {
      const rawNodes = [];
      for (const pt of segment) {
        const [wx, wy, wz] = geoToWorld(pt.lat, pt.lng, terrainData, squareSize, 0.1);
        // MeshRoad node: [x, y, z, fullWidth, depth, normalX, normalY, normalZ]
        rawNodes.push([
          Math.round(wx * 1000) / 1000,
          Math.round(wy * 1000) / 1000,
          Math.round((wz + 0.5) * 1000) / 1000,
          fullWidth,
          4,
          0, 0, 1,
        ]);
      }

      // Reuse decimation but strip/re-add the extra fields (decimateNodes works on [x,y,z,w])
      const stripped = rawNodes.map(n => [n[0], n[1], n[2], n[3]]);
      const decimated = decimateNodes(stripped);
      if (decimated.length < 2) continue;

      // Reattach depth and normal after decimation
      const nodes = decimated.map(n => [n[0], n[1], n[2], n[3], 0.5, 0, 0, 1]);

      meshRoads.push({
        class: 'MeshRoad',
        name: `MeshRoad_${roadIndex++}`,
        persistentId: generatePersistentId(),
        __parent: 'Mesh_roads',
        position: [nodes[0][0], nodes[0][1], nodes[0][2]],
        topMaterial: 'm_asphalt_new_01',
        sideMaterial: 'm_asphalt_new_01',
        bottomMaterial: 'm_asphalt_new_01',
        textureLength: 16,
        nodes,
      });
    }
  }

  return meshRoads;
}

/**
 * Write a newline-delimited JSON (NDJSON) string from an array of objects.
 * Each object is one line, file ends with a newline — matching BeamNG's format.
 */
function toNDJSON(objects) {
  return objects.map(o => JSON.stringify(o)).join('\n') + '\n';
}

const WATERWAY_WIDTHS = {
  river: 26,
  canal: 14,
  stream: 8,
  drain: 4,
  ditch: 3,
};

const WATERWAY_DEPTHS = {
  river: 8,
  canal: 5,
  stream: 3,
  drain: 2,
  ditch: 1.5,
};


const WATER_BLOCK_TEMPLATE = {
  class: 'WaterBlock',
  Foam: [{}, {}],
  'Ripples (texture animation)': [
    { rippleDir: [0, 1], rippleMagnitude: 0.8, rippleSpeed: 0.001, rippleTexScale: [12, 12] },
    { rippleDir: [0, 1], rippleSpeed: 0.02, rippleTexScale: [6, 6] },
    { rippleDir: [0.7, -0.7], rippleMagnitude: 1, rippleSpeed: 0.02, rippleTexScale: [3, 3] },
  ],
  'Waves (vertex undulation)': [
    { waveDir: [0, 1], waveMagnitude: 0.2, waveSpeed: 1 },
    { waveDir: [0.707, 0.707], waveMagnitude: 0.2, waveSpeed: 1 },
    { waveDir: [0.5, 0.86], waveMagnitude: 0.2, waveSpeed: 1 },
  ],
  baseColor: [189, 253, 255, 255],
  cubemap: 'cubemap_italy_reflection',
  depthGradientMax: 30,
  depthGradientTex: '/levels/italy/art/water/depthcolor_ramp_italy_muddy.png',
  foamAmbientLerp: 1.29999995,
  foamMaxDepth: 0.150000006,
  foamRippleInfluence: 0.0149999997,
  foamTex: 'levels/italy/art/water/foam2.dds',
  fresnelBias: 0.2,
  fresnelPower: 20,
  fullReflect: false,
  gridElementSize: 1,
  gridSize: 1,
  overallRippleMagnitude: 0.2,
  overallWaveMagnitude: 0,
  reflectivity: 0.8,
  rippleTex: '/levels/italy/art/water/ripple.dds',
  specularPower: 200,
  waterFogDensity: 1,
  waterFogDensityOffset: 0.1,
  wetDarkening: 0.5,
  wetDepth: 0.2,
};

const WATER_PLANE_TEMPLATE = {
  class: 'WaterPlane',
  Foam: [
    { foamDir: [0, 1], foamSpeed: 0.01 },
    { foamDir: [0, -1], foamOpacity: 5, foamSpeed: 0.01, foamTexScale: [4, 4] },
  ],
  'Ripples (texture animation)': [
    { rippleDir: [0, -1], rippleMagnitude: 0.5, rippleSpeed: 0.008, rippleTexScale: [12, 12] },
    { rippleDir: [0.707, 0.707], rippleMagnitude: 0.5, rippleSpeed: 0.05, rippleTexScale: [2, 2] },
    { rippleDir: [-0.5, 0.86], rippleMagnitude: 0.35, rippleSpeed: 0.003, rippleTexScale: [120, 120] },
  ],
  'Waves (vertex undulation)': [
    { waveDir: [0, -1], waveMagnitude: 0.5, waveSpeed: 1 },
    { waveDir: [0.25, 0.2], waveMagnitude: 0.2, waveSpeed: 2 },
    { waveDir: [0.1, -0.7], waveMagnitude: 0.2, waveSpeed: 3 },
  ],
  baseColor: [253, 254, 254, 0],
  clarity: 0.25,
  depthGradientMax: 70,
  distortEndDist: 10,
  distortFullDepth: 5.5,
  distortStartDist: 0,
  foamAmbientLerp: 1,
  foamMaxDepth: 0.35,
  foamRippleInfluence: 0.005,
  fresnelBias: -0.1,
  fresnelPower: 0.8,
  gridSize: 100,
  overallFoamOpacity: 3.5,
  overallRippleMagnitude: 1,
  overallWaveMagnitude: 0.15,
  reflectDetailAdjust: 0,
  reflectMaxRateMs: 20,
  reflectivity: 0.2,
  specularPower: 210,
  underwaterColor: [60, 223, 254, 253],
  viscosity: 0.001,
  waterFogDensity: 0.8,
  waterFogDensityOffset: 0.1,
  wetDarkening: 0.15,
  wetDepth: 0.5,
};

const RIVER_TEMPLATE = {
  class: 'River',
  Foam: [{}, {}],
  'Ripples (texture animation)': [
    { rippleDir: [0, 1], rippleMagnitude: 1.5, rippleSpeed: 0.1, rippleTexScale: [2, 2] },
    { rippleDir: [0, 1], rippleMagnitude: 2, rippleSpeed: 0.2, rippleTexScale: [5, 5] },
    { rippleDir: [0.1, 0.9], rippleMagnitude: 1, rippleSpeed: 0.01, rippleTexScale: [20, 20] },
  ],
  'Waves (vertex undulation)': [
    { waveDir: [-0.5, 0.8], waveMagnitude: 0.2, waveSpeed: 2 },
    { waveDir: [0.1, -1.5], waveMagnitude: 0.2, waveSpeed: 2 },
    { waveDir: [0.1, 0.5], waveMagnitude: 0.2, waveSpeed: 3 },
  ],
  baseColor: [254, 220, 165, 255],
  cubemap: 'cubemap_ocean_reflection',
  depthGradientMax: 20,
  depthGradientTex: 'levels/italy/art/water/depthcolor_ramp_italy_rivers.png',
  flowMagnitudePhysics: 4,
  foamMaxDepth: 1,
  foamRippleInfluence: 0.09,
  foamTex: 'core/art/water/foam.dds',
  fresnelBias: 0.5,
  fresnelPower: 5,
  fullReflect: false,
  lowLODDistance: 150,
  overallFoamOpacity: 3,
  overallRippleMagnitude: 1.2,
  overallWaveMagnitude: 0.5,
  reflectDetailAdjust: -2,
  reflectMaxRateMs: 10,
  reflectivity: 0.3,
  rippleTex: 'levels/italy/art/water/ripple3.dds',
  subdivideLength: 2,
  underwaterColor: [254, 253, 252, 250],
  waterFogDensity: 0.8,
  waterFogDensityOffset: 0,
  wetDarkening: 0.3,
  wetDepth: 0.35,
};

function roundTo(value, places = 3) {
  const f = 10 ** places;
  return Math.round(value * f) / f;
}

function formatNumber(value, places = 3) {
  if (!Number.isFinite(value)) return 'n/a';
  return Number(value).toFixed(places);
}

function formatBool(value) {
  return value ? 'Yes' : 'No';
}

function formatIsoTimestamp(value) {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) return 'n/a';
  return value.toISOString();
}

function formatDurationMs(value) {
  if (!Number.isFinite(value)) return 'n/a';
  if (value >= 1000) return `${(value / 1000).toFixed(2)} s`;
  return `${Math.round(value)} ms`;
}

function metersToKm2(value) {
  if (!Number.isFinite(value)) return 'n/a';
  return (value / 1_000_000).toFixed(3);
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function summarizeOsmFeatures(features = []) {
  const summary = {
    total: 0,
    roads: 0,
    buildings: 0,
    water: 0,
    vegetation: 0,
    landuse: 0,
    points: 0,
    lines: 0,
    polygons: 0,
  };

  for (const feature of features) {
    summary.total += 1;
    if (feature?.type === 'road') summary.roads += 1;
    if (feature?.type === 'building') summary.buildings += 1;
    if (feature?.type === 'water') summary.water += 1;
    if (feature?.type === 'vegetation') summary.vegetation += 1;
    if (feature?.type === 'landuse') summary.landuse += 1;

    const pointCount = Array.isArray(feature?.geometry) ? feature.geometry.length : 0;
    if (pointCount <= 1) summary.points += 1;
    else if (isClosedRing(feature.geometry)) summary.polygons += 1;
    else summary.lines += 1;
  }

  return summary;
}

function resolveElevationSourceLabel(terrainData, selectedElevationSource) {
  const explicit = typeof selectedElevationSource === 'string' ? selectedElevationSource.trim() : '';
  const normalized = explicit.toLowerCase();
  const sourceGeoTiffsSource = terrainData?.sourceGeoTiffs?.source;

  if (normalized === 'usgs') {
    return terrainData?.usgsFallback ? 'USGS requested, fell back to default/WGS84 source' : 'USGS';
  }
  if (normalized === 'gpxz') return 'GPXZ';
  if (normalized === 'default') {
    return sourceGeoTiffsSource ? `Default (${String(sourceGeoTiffsSource).toUpperCase()})` : 'Default/WGS84';
  }
  if (explicit) return explicit;
  if (sourceGeoTiffsSource) return String(sourceGeoTiffsSource).toUpperCase();
  return 'Default/WGS84';
}

function summarizeTerrainSamples(terrainData) {
  const heightMap = terrainData?.heightMap;
  if (!heightMap || typeof heightMap.length !== 'number') {
    return {
      total: 0,
      valid: 0,
      noData: 0,
      noDataRatio: NaN,
      allInvalid: false,
    };
  }

  let valid = 0;
  let noData = 0;
  for (let i = 0; i < heightMap.length; i++) {
    const h = heightMap[i];
    if (Number.isFinite(h) && h > -10000) valid += 1;
    else noData += 1;
  }

  const total = valid + noData;
  const noDataRatio = total > 0 ? noData / total : NaN;
  return {
    total,
    valid,
    noData,
    noDataRatio,
    allInvalid: total > 0 && valid === 0,
  };
}

function buildBeamNGExportReport({
  terrainData,
  originalTerrainData,
  center,
  options,
  levelName,
  levelDisplayName,
  flavor,
  squareSize,
  satelliteTexSize,
  worldSize,
  exportStartedAt,
  reportGeneratedAt,
  processingLog,
  effectivePbrSource,
  waterObjects,
  barrierObjects,
  barrierMeshSplineGroups,
  roadArchitectRoadCount,
  roadArchitectJunctionCount,
  forestPlacements,
  forestFiles,
  groundCoverObjects,
  osmDaeBlob,
  backdropDaeBlob,
  backdropTextureFiles,
  backdropDiagnostics,
  mapngFlagFiles,
  didCropToSquare,
}) {
  const minHeight = Number(terrainData?.minHeight);
  const maxHeight = Number(terrainData?.maxHeight);
  const heightDiff = maxHeight - minHeight;
  const totalAreaM2 = worldSize * worldSize;
  const bounds = terrainData?.bounds ?? {};
  const selectedResolution = Number(options?.requestedResolution);
  const terrainSampleSummary = summarizeTerrainSamples(terrainData);
  const osmSummary = summarizeOsmFeatures(terrainData?.osmFeatures);
  const originalOsmSummary = summarizeOsmFeatures(originalTerrainData?.osmFeatures);
  const forestPlacementCount = Array.from(forestPlacements.values()).reduce((sum, placements) => sum + placements.length, 0);
  const terrainMaterialCount = Array.isArray(options?.terrainMaterialNames) ? options.terrainMaterialNames.length : 0;
  const startedMs = exportStartedAt instanceof Date ? exportStartedAt.getTime() : NaN;
  const reportGeneratedMs = reportGeneratedAt instanceof Date ? reportGeneratedAt.getTime() : NaN;
  const totalDurationMs = reportGeneratedMs - startedMs;
  const reportLines = [
    'MapNG BeamNG Level Export Report',
    '================================',
    '',
    'Summary',
    `- Level display name: ${levelDisplayName}`,
    `- Level folder name: ${levelName}`,
    `- Flavor: ${flavor?.label || flavor?.name || flavor?.id || 'n/a'}`,
    `- Export started (UTC): ${formatIsoTimestamp(exportStartedAt)}`,
    `- Report generated (UTC): ${formatIsoTimestamp(reportGeneratedAt)}`,
    `- Processing time before ZIP compression: ${formatDurationMs(totalDurationMs)}`,
    '',
    'Terrain',
    `- Requested resolution: ${Number.isFinite(selectedResolution) ? `${selectedResolution} px` : 'n/a'}`,
    `- Exported terrain size: ${terrainData?.width ?? 'n/a'} x ${terrainData?.height ?? 'n/a'} px`,
    `- Terrain texture size: ${satelliteTexSize} x ${satelliteTexSize} px`,
    `- Height range min/max: ${formatNumber(minHeight, 2)} m / ${formatNumber(maxHeight, 2)} m`,
    `- Height difference: ${formatNumber(heightDiff, 2)} m`,
    `- Scale: ${formatNumber(squareSize, 3)} m/px`,
    `- World size: ${formatNumber(worldSize, 2)} m x ${formatNumber(worldSize, 2)} m`,
    `- Total area: ${formatNumber(totalAreaM2, 2)} m^2 (${metersToKm2(totalAreaM2)} km^2)`,
    `- Center coordinates: ${formatNumber(center?.lat, 6)}, ${formatNumber(center?.lng, 6)}`,
    `- Bounds north/south/east/west: ${formatNumber(bounds.north, 6)}, ${formatNumber(bounds.south, 6)}, ${formatNumber(bounds.east, 6)}, ${formatNumber(bounds.west, 6)}`,
    `- Elevation source used: ${resolveElevationSourceLabel(originalTerrainData, options?.elevationSource)}`,
    `- Source GeoTIFF source: ${originalTerrainData?.sourceGeoTiffs?.source ? String(originalTerrainData.sourceGeoTiffs.source).toUpperCase() : 'n/a'}`,
    `- Cropped to square for BeamNG: ${formatBool(didCropToSquare)}`,
    `- Terrain samples (valid/no-data/total): ${terrainSampleSummary.valid}/${terrainSampleSummary.noData}/${terrainSampleSummary.total}`,
    `- Terrain no-data ratio: ${Number.isFinite(terrainSampleSummary.noDataRatio) ? `${formatNumber(terrainSampleSummary.noDataRatio * 100, 2)}%` : 'n/a'}`,
    `- Terrain sample warning: ${terrainSampleSummary.allInvalid ? 'ALL_ELEVATION_SAMPLES_INVALID (export likely unreliable)' : 'none'}`,
    '',
    'Selected Export Options',
    `- Base texture: ${options?.baseTexture ?? 'n/a'}`,
    `- Include buildings: ${formatBool(options?.includeBuildings)}`,
    `- Apply foundations: ${formatBool(options?.applyFoundations)}`,
    `- Include backdrop: ${formatBool(options?.includeBackdrop)}`,
    `- PBR materials: ${effectivePbrSource === 'none' ? 'No' : 'Yes'}`,
    `- PBR source requested: ${options?.requestedPbrSource ?? 'n/a'}`,
    `- PBR source used: ${effectivePbrSource}`,
    `- Include water: ${formatBool(options?.includeWater)}`,
    `- Include native barriers: ${formatBool(options?.includeNativeBarriers)}`,
    `- Include trees/bushes: ${formatBool(options?.includeTrees)}`,
    `- Tree density scale: ${formatNumber(options?.treeDensity, 2)}x`,
    `- Include rocks: ${formatBool(options?.includeRocks)}`,
    '',
    'Generated Content',
    `- Terrain materials written: ${terrainMaterialCount}`,
    `- Road Architect roads generated: ${roadArchitectRoadCount}`,
    `- Road Architect junctions generated: ${roadArchitectJunctionCount}`,
    `- Barrier mesh spline groups: ${barrierMeshSplineGroups.length}`,
    `- Barrier TSStatic objects: ${barrierObjects.length}`,
    `- Water objects generated: ${waterObjects.length}`,
    `- Forest placement groups: ${forestPlacements.size}`,
    `- Forest placement files: ${forestFiles.length}`,
    `- Forest placements total: ${forestPlacementCount}`,
    `- Ground cover objects: ${groundCoverObjects.length}`,
    `- OSM DAE written: ${formatBool(!!osmDaeBlob)}`,
    `- Backdrop DAE written: ${formatBool(!!backdropDaeBlob)}`,
    `- Backdrop textures written: ${backdropTextureFiles.length}`,
    `- MapNG flag asset written: ${formatBool(mapngFlagFiles.length > 0)}`,
  ];

  if (backdropDiagnostics) {
    reportLines.push('');
    reportLines.push('Surrounding Backdrop Diagnostics');
    reportLines.push(`- Requested surrounding tiles: ${backdropDiagnostics.requestedTiles ?? 'n/a'}`);
    reportLines.push(`- Built surrounding tiles: ${backdropDiagnostics.builtTiles ?? 'n/a'}`);
    reportLines.push(`- Direct elevation tiles: ${backdropDiagnostics.directTiles ?? 'n/a'}`);
    reportLines.push(`- Flat-fallback tiles: ${backdropDiagnostics.flatFallbackTiles ?? 'n/a'}`);
    reportLines.push(`- Skipped tiles: ${backdropDiagnostics.skippedTiles ?? 'n/a'}`);
    reportLines.push(`- Flat-fallback threshold (no-data ratio): ${Number.isFinite(backdropDiagnostics.maxNoDataRatio) ? `${formatNumber(backdropDiagnostics.maxNoDataRatio * 100, 2)}%` : 'n/a'}`);

    const perTile = backdropDiagnostics.tiles && typeof backdropDiagnostics.tiles === 'object'
      ? Object.entries(backdropDiagnostics.tiles)
      : [];
    for (const [tileKey, tileDiag] of perTile) {
      const ratioPct = Number.isFinite(tileDiag?.noDataRatio)
        ? `${formatNumber(tileDiag.noDataRatio * 100, 2)}%`
        : 'n/a';
      reportLines.push(
        `- Tile ${tileKey}: mode=${tileDiag?.mode ?? 'unknown'}, valid=${tileDiag?.validSamples ?? 'n/a'}, no-data=${tileDiag?.noDataSamples ?? 'n/a'}, total=${tileDiag?.totalSamples ?? 'n/a'}, no-data ratio=${ratioPct}`
      );
    }
  }

  reportLines.push('');
  reportLines.push('OSM Analysis');
  reportLines.push(`- Source OSM features before bounds filter: ${originalOsmSummary.total}`);
  reportLines.push(`- OSM features after export filter: ${osmSummary.total}`);
  reportLines.push(`- Roads: ${osmSummary.roads}`);
  reportLines.push(`- Buildings: ${osmSummary.buildings}`);
  reportLines.push(`- Water features: ${osmSummary.water}`);
  reportLines.push(`- Vegetation points/features: ${osmSummary.vegetation}`);
  reportLines.push(`- Landuse features: ${osmSummary.landuse}`);
  reportLines.push(`- Point/line/polygon split: ${osmSummary.points}/${osmSummary.lines}/${osmSummary.polygons}`);
  reportLines.push('');
  reportLines.push('Processing Timeline');

  for (const entry of processingLog) {
    reportLines.push(`- ${entry.step}: ${formatDurationMs(entry.durationMs)} (${entry.pct}%)`);
  }

  if (originalTerrainData?.osmRequestInfo) {
    reportLines.push('');
    reportLines.push('OSM Request Metadata');
    for (const [key, value] of Object.entries(originalTerrainData.osmRequestInfo)) {
      reportLines.push(`- ${key}: ${typeof value === 'object' ? JSON.stringify(value) : String(value)}`);
    }
  }

  return reportLines.join('\n') + '\n';
}

async function loadMapngFlagAsset() {
  const response = await fetch('/mapng_flag_static.zip');
  if (!response.ok) throw new Error(`Failed to load mapng flag asset: ${response.status}`);
  const archive = await JSZip.loadAsync(await response.arrayBuffer());
  const files = [];
  for (const entry of Object.values(archive.files)) {
    if (entry.dir) continue;
    files.push({
      path: entry.name,
      data: await entry.async('uint8array'),
    });
  }
  return files;
}

function findHighestTerrainPoint(terrainData, squareSize) {
  const { width, height, heightMap, minHeight } = terrainData;
  let bestIndex = 0;
  let bestHeight = -Infinity;
  for (let i = 0; i < heightMap.length; i++) {
    if (heightMap[i] > bestHeight) {
      bestHeight = heightMap[i];
      bestIndex = i;
    }
  }
  const x = bestIndex % width;
  const y = Math.floor(bestIndex / width);
  const worldSize = width * squareSize;
  const u = width > 1 ? x / (width - 1) : 0.5;
  const v = height > 1 ? y / (height - 1) : 0.5;
  return [
    roundTo((u - 0.5) * worldSize, 3),
    roundTo((0.5 - v) * worldSize, 3),
    roundTo(bestHeight - minHeight + 0.25, 3),
  ];
}

function isClosedRing(points) {
  if (!Array.isArray(points) || points.length < 4) return false;
  const a = points[0];
  const b = points[points.length - 1];
  return a.lat === b.lat && a.lng === b.lng;
}

function getTerrainHeightWorld(lat, lng, terrainData) {
  const { bounds, width, height, heightMap, minHeight } = terrainData;
  const sanitizeHeight = (h) => (Number.isFinite(h) && h > -10000 ? h : minHeight);
  const u = Math.max(0, Math.min(1, (lng - bounds.west) / (bounds.east - bounds.west)));
  const v = Math.max(0, Math.min(1, (bounds.north - lat) / (bounds.north - bounds.south)));
  const fx = u * (width - 1);
  const fy = v * (height - 1);
  const c0 = Math.min(width - 1, Math.floor(fx));
  const c1 = Math.min(width - 1, c0 + 1);
  const r0 = Math.min(height - 1, Math.floor(fy));
  const r1 = Math.min(height - 1, r0 + 1);
  const tx = fx - c0;
  const ty = fy - r0;
  const h00 = sanitizeHeight(heightMap[r0 * width + c0]);
  const h10 = sanitizeHeight(heightMap[r0 * width + c1]);
  const h01 = sanitizeHeight(heightMap[r1 * width + c0]);
  const h11 = sanitizeHeight(heightMap[r1 * width + c1]);
  return (h00 * (1 - tx) * (1 - ty) + h10 * tx * (1 - ty) + h01 * (1 - tx) * ty + h11 * tx * ty) - minHeight;
}

function geoToWorldPoint(lat, lng, terrainData, squareSize, zOffset = 0) {
  const { bounds, width } = terrainData;
  const worldSize = width * squareSize;
  const u = Math.max(0, Math.min(1, (lng - bounds.west) / (bounds.east - bounds.west)));
  const v = Math.max(0, Math.min(1, (bounds.north - lat) / (bounds.north - bounds.south)));
  return [
    (u - 0.5) * worldSize,
    (0.5 - v) * worldSize,
    getTerrainHeightWorld(lat, lng, terrainData) + zOffset,
  ];
}

function rotationMatrixFromYaw(yaw) {
  const c = roundTo(Math.cos(yaw), 6);
  const s = roundTo(Math.sin(yaw), 6);
  return [c, s, 0, -s, c, 0, 0, 0, 1];
}

const NATIVE_BARRIER_ASSETS = {
  guardrail: {
    shapeName: '/levels/west_coast_usa/art/shapes/objects/guardrail1.dae',
    postShapeName: '/levels/west_coast_usa/art/shapes/objects/guardrailpost.dae',
    endShapeName: '/levels/west_coast_usa/art/shapes/objects/guardrail_end.dae',
    segmentLength: 3.8,
    zOffset: 0.15,
    postZOffset: 0.02,
    endZOffset: 0.08,
    yawOffset: Math.PI * 0.5,
  },
  concrete: {
    shapeName: '/levels/west_coast_usa/art/shapes/objects/jerseybarrier_3m.dae',
    segmentLength: 3,
    zOffset: 0.05,
    yawOffset: Math.PI * 0.5,
  },
  fence: {
    shapeName: '/levels/west_coast_usa/art/shapes/objects/fence_metal1.dae',
    segmentLength: 4,
    // In official mesh data, min Z is about -2.38.
    // Lift by ~2.4m so fence feet sit at terrain level.
    zOffset: 2.4,
    yawOffset: Math.PI * 0.5,
  },
  chainLinkFence: {
    shapeName: '/levels/west_coast_usa/art/shapes/objects/screenfence1.dae',
    segmentLength: 3.5,
    // In official mesh data, min Z is about -1.52.
    zOffset: 1.55,
    yawOffset: Math.PI * 0.5,
  },
};

const MAX_NATIVE_BARRIER_OBJECTS = 8000;

function resolveNativeBarrierAsset(tags = {}) {
  const barrierType = String(tags.barrier ?? '').trim().toLowerCase();
  const material = String(tags.material ?? '').trim().toLowerCase();

  if (!barrierType || barrierType === 'hedge') return null;

  if (barrierType === 'guard_rail' || barrierType === 'guardrail' || barrierType === 'handrail') {
    return NATIVE_BARRIER_ASSETS.guardrail;
  }

  if (
    barrierType === 'jersey_barrier'
    || barrierType === 'concrete_barrier'
  ) {
    return NATIVE_BARRIER_ASSETS.concrete;
  }

  if (
    barrierType === 'fence'
    || barrierType === 'chain'
    || barrierType === 'wall'
    || barrierType === 'city_wall'
    || barrierType === 'retaining_wall'
    || barrierType === 'block'
    || barrierType === 'cable_barrier'
    || barrierType === 'wire_fence'
    || barrierType === 'gate'
  ) {
    return NATIVE_BARRIER_ASSETS.fence;
  }

  if (barrierType === 'chain_link' || material === 'chain_link') {
    return NATIVE_BARRIER_ASSETS.chainLinkFence;
  }

  return NATIVE_BARRIER_ASSETS.guardrail;
}

function buildNativeBarrierObjects(terrainData, squareSize) {
  const features = terrainData.osmFeatures?.filter((feature) => (
    feature.type === 'barrier' && Array.isArray(feature.geometry) && feature.geometry.length >= 2
  )) ?? [];

  const objects = [];

  const pushInstanceAtGeo = (pt, yaw, asset, name, zOffsetOverride) => {
    if (objects.length >= MAX_NATIVE_BARRIER_OBJECTS) return;
    const rotationYaw = yaw + (Number.isFinite(asset.yawOffset) ? asset.yawOffset : 0);
    const world = geoToWorldPoint(
      pt.lat,
      pt.lng,
      terrainData,
      squareSize,
      Number.isFinite(zOffsetOverride) ? zOffsetOverride : asset.zOffset,
    );
    objects.push({
      __parent: 'Barriers',
      class: 'TSStatic',
      name,
      persistentId: generatePersistentId(),
      position: [roundTo(world[0], 3), roundTo(world[1], 3), roundTo(world[2], 3)],
        rotationMatrix: rotationMatrixFromYaw(rotationYaw),
      shapeName: asset.shapeName,
      useInstanceRenderData: true,
    });
  };

  const pushSegmentInstances = (startPt, endPt, asset, namePrefix) => {
    const start = geoToWorldPoint(startPt.lat, startPt.lng, terrainData, squareSize, asset.zOffset);
    const end = geoToWorldPoint(endPt.lat, endPt.lng, terrainData, squareSize, asset.zOffset);
    const dx = end[0] - start[0];
    const dy = end[1] - start[1];
    const segmentLen = Math.hypot(dx, dy);
    if (!Number.isFinite(segmentLen) || segmentLen < 0.5) return;

    const yaw = Math.atan2(dy, dx);
    const rotationYaw = yaw + (Number.isFinite(asset.yawOffset) ? asset.yawOffset : 0);
    const rotationMatrix = rotationMatrixFromYaw(rotationYaw);
    const count = Math.max(1, Math.floor(segmentLen / Math.max(1, asset.segmentLength)));

    for (let i = 0; i < count; i++) {
      if (objects.length >= MAX_NATIVE_BARRIER_OBJECTS) return;
      const t = (i + 0.5) / count;
      const geoPt = {
        lat: startPt.lat + (endPt.lat - startPt.lat) * t,
        lng: startPt.lng + (endPt.lng - startPt.lng) * t,
      };
      pushInstanceAtGeo(geoPt, yaw, asset, `${namePrefix}_${objects.length}`);
    }

    if (asset.postShapeName) {
      const postSpacing = Math.max(1.5, asset.segmentLength);
      const postCount = Math.max(2, Math.floor(segmentLen / postSpacing) + 1);
      for (let i = 0; i < postCount; i++) {
        if (objects.length >= MAX_NATIVE_BARRIER_OBJECTS) return;
        const t = postCount <= 1 ? 0 : i / (postCount - 1);
        const geoPt = {
          lat: startPt.lat + (endPt.lat - startPt.lat) * t,
          lng: startPt.lng + (endPt.lng - startPt.lng) * t,
        };
        const world = geoToWorldPoint(
          geoPt.lat,
          geoPt.lng,
          terrainData,
          squareSize,
          Number.isFinite(asset.postZOffset) ? asset.postZOffset : asset.zOffset,
        );
        objects.push({
          __parent: 'Barriers',
          class: 'TSStatic',
          name: `${namePrefix}_post_${objects.length}`,
          persistentId: generatePersistentId(),
          position: [roundTo(world[0], 3), roundTo(world[1], 3), roundTo(world[2], 3)],
          rotationMatrix,
          shapeName: asset.postShapeName,
          useInstanceRenderData: true,
        });
      }
    }
  };

  const pushGuardrailEndcaps = (feature, asset, featureIndex) => {
    if (!asset.endShapeName || !Array.isArray(feature.geometry) || feature.geometry.length < 2) return;
    const startPt = feature.geometry[0];
    const nextPt = feature.geometry[1];
    const endPt = feature.geometry[feature.geometry.length - 1];
    const prevPt = feature.geometry[feature.geometry.length - 2];

    const startYaw = Math.atan2(nextPt.lat - startPt.lat, nextPt.lng - startPt.lng);
    const endYaw = Math.atan2(endPt.lat - prevPt.lat, endPt.lng - prevPt.lng);
    const rotationStartYaw = startYaw + (Number.isFinite(asset.yawOffset) ? asset.yawOffset : 0);
    const rotationEndYaw = endYaw + (Number.isFinite(asset.yawOffset) ? asset.yawOffset : 0);

    if (objects.length < MAX_NATIVE_BARRIER_OBJECTS) {
      const worldStart = geoToWorldPoint(
        startPt.lat,
        startPt.lng,
        terrainData,
        squareSize,
        Number.isFinite(asset.endZOffset) ? asset.endZOffset : asset.zOffset,
      );
      objects.push({
        __parent: 'Barriers',
        class: 'TSStatic',
        name: `barrier_${featureIndex}_end_start`,
        persistentId: generatePersistentId(),
        position: [roundTo(worldStart[0], 3), roundTo(worldStart[1], 3), roundTo(worldStart[2], 3)],
        rotationMatrix: rotationMatrixFromYaw(rotationStartYaw),
        shapeName: asset.endShapeName,
        useInstanceRenderData: true,
      });
    }

    if (objects.length < MAX_NATIVE_BARRIER_OBJECTS) {
      const worldEnd = geoToWorldPoint(
        endPt.lat,
        endPt.lng,
        terrainData,
        squareSize,
        Number.isFinite(asset.endZOffset) ? asset.endZOffset : asset.zOffset,
      );
      objects.push({
        __parent: 'Barriers',
        class: 'TSStatic',
        name: `barrier_${featureIndex}_end_finish`,
        persistentId: generatePersistentId(),
        position: [roundTo(worldEnd[0], 3), roundTo(worldEnd[1], 3), roundTo(worldEnd[2], 3)],
        rotationMatrix: rotationMatrixFromYaw(rotationEndYaw),
        shapeName: asset.endShapeName,
        useInstanceRenderData: true,
      });
    }
  };

  for (let featureIndex = 0; featureIndex < features.length; featureIndex++) {
    if (objects.length >= MAX_NATIVE_BARRIER_OBJECTS) break;
    const feature = features[featureIndex];
    const asset = resolveNativeBarrierAsset(feature.tags || {});
    if (!asset) continue;

    for (let i = 0; i < feature.geometry.length - 1; i++) {
      if (objects.length >= MAX_NATIVE_BARRIER_OBJECTS) break;
      const a = feature.geometry[i];
      const b = feature.geometry[i + 1];
      pushSegmentInstances(a, b, asset, `barrier_${featureIndex}`);
    }

    if (asset.endShapeName && objects.length < MAX_NATIVE_BARRIER_OBJECTS) {
      pushGuardrailEndcaps(feature, asset, featureIndex);
    }
  }

  return objects;
}

function groupBarrierObjectsAsMeshSplines(barrierObjects) {
  if (!Array.isArray(barrierObjects) || barrierObjects.length === 0) return [];

  const grouped = new Map();
  for (const obj of barrierObjects) {
    const name = String(obj?.name || '');
    const match = name.match(/^barrier_(\d+)/);
    const key = match ? Number(match[1]) : -1;
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(obj);
  }

  const keys = Array.from(grouped.keys()).sort((a, b) => a - b);
  return keys.map((key, idx) => {
    const groupName = `Mesh Spline ${idx + 1} - ${generatePersistentId()}`;
    const items = grouped.get(key).map((obj, itemIdx) => ({
      ...obj,
      __parent: groupName,
      name: `${groupName}_Main_${itemIdx + 1}`,
      isRenderEnabled: false,
    }));
    return { groupName, items };
  });
}

function pointInPolygonLatLng(point, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i].lng;
    const yi = ring[i].lat;
    const xj = ring[j].lng;
    const yj = ring[j].lat;
    const intersects = ((yi > point.lat) !== (yj > point.lat)) &&
      (point.lng < ((xj - xi) * (point.lat - yi)) / ((yj - yi) || 1e-12) + xi);
    if (intersects) inside = !inside;
  }
  return inside;
}

function pointInPolygonWorld(x, y, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0];
    const yi = ring[i][1];
    const xj = ring[j][0];
    const yj = ring[j][1];
    const intersect = ((yi > y) !== (yj > y))
      && (x < (((xj - xi) * (y - yi)) / ((yj - yi) || 1e-9)) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
}

function hashString(value) {
  let hash = 2166136261;
  const input = String(value);
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function seededRandom(seed) {
  const x = Math.sin(seed * 12.9898) * 43758.5453123;
  return x - Math.floor(x);
}

function simplifyPolyline(points, maxPoints = 80) {
  if (!Array.isArray(points) || points.length <= maxPoints) return points;
  const out = [points[0]];
  const interior = points.length - 2;
  const targetInterior = Math.max(0, maxPoints - 2);
  const step = interior / Math.max(1, targetInterior);
  for (let i = 1; i <= targetInterior; i++) {
    out.push(points[Math.min(points.length - 2, Math.round(i * step))]);
  }
  out.push(points[points.length - 1]);
  return out;
}

function isExcludedWaterFeature(tags = {}) {
  return (
    tags.place === 'sea' ||
    tags.place === 'ocean' ||
    tags.natural === 'bay' ||
    tags.water === 'dock' ||
    tags.water === 'harbour' ||
    tags.harbour === 'yes' ||
    tags.leisure === 'marina'
  );
}

function percentileValue(sortedValues, fraction) {
  if (!sortedValues.length) return 0;
  const idx = clamp(Math.floor((sortedValues.length - 1) * fraction), 0, sortedValues.length - 1);
  return sortedValues[idx];
}

function computeBestFitWaterBlock(worldPoints) {
  let cx = 0;
  let cy = 0;
  for (const pt of worldPoints) {
    cx += pt[0];
    cy += pt[1];
  }
  cx /= worldPoints.length;
  cy /= worldPoints.length;

  let best = null;
  for (let i = 0; i < worldPoints.length; i++) {
    const a = worldPoints[i];
    const b = worldPoints[(i + 1) % worldPoints.length];
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    if (Math.hypot(dx, dy) < 1e-6) continue;

    const yaw = Math.atan2(dy, dx);
    const cos = Math.cos(yaw);
    const sin = Math.sin(yaw);
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;

    for (const pt of worldPoints) {
      const relX = pt[0] - cx;
      const relY = pt[1] - cy;
      const rx = relX * cos + relY * sin;
      const ry = -relX * sin + relY * cos;
      minX = Math.min(minX, rx);
      maxX = Math.max(maxX, rx);
      minY = Math.min(minY, ry);
      maxY = Math.max(maxY, ry);
    }

    const width = maxX - minX;
    const length = maxY - minY;
    const area = width * length;
    if (!best || area < best.area) {
      best = { yaw, width, length, area };
    }
  }

  if (best) return { cx, cy, ...best };

  return { cx, cy, yaw: 0, width: 4, length: 4, area: 16 };
}

function buildWaterBlockObjects(terrainData, squareSize, flavor) {
  const waterProfile = getWaterProfile(flavor);
  const features = terrainData.osmFeatures?.filter((feature) => {
    if (feature.type !== 'water') return false;
    if (!Array.isArray(feature.geometry) || feature.geometry.length < 4) return false;
    if (!isClosedRing(feature.geometry)) return false;
    if (feature.tags?.waterway) return false;
    return !isExcludedWaterFeature(feature.tags);
  }) ?? [];

  return features.map((feature, index) => {
    const ring = feature.geometry.slice(0, -1);
    const worldPoints = ring.map((pt) => geoToWorldPoint(pt.lat, pt.lng, terrainData, squareSize, 0));
    const fit = computeBestFitWaterBlock(worldPoints);
    const rawWidth = Math.max(4, fit.width);
    const rawLength = Math.max(4, fit.length);
    const pad = clamp(Math.min(rawWidth, rawLength) * 0.092, 1.5, 6.9);
    const width = rawWidth + (pad * 2);
    const length = rawLength + (pad * 2);
    const height = Math.max(1.5, Math.min(width, length) * 0.08);
    const ringHeights = ring.map((pt) => getTerrainHeightWorld(pt.lat, pt.lng, terrainData));
    ringHeights.sort((a, b) => a - b);
    const surfaceElevation = percentileValue(ringHeights, 0.8) + 0.14;

    return {
      ...structuredClone(WATER_BLOCK_TEMPLATE),
      cubemap: waterProfile.waterCubemap,
      depthGradientTex: waterProfile.waterDepthGradientTex,
      foamTex: waterProfile.waterFoamTex,
      rippleTex: waterProfile.waterRippleTex,
      name: `water_body_${index}`,
      persistentId: generatePersistentId(),
      __parent: 'Water',
      position: [roundTo(fit.cx, 3), roundTo(fit.cy, 3), roundTo(surfaceElevation, 3)],
      rotationMatrix: rotationMatrixFromYaw(fit.yaw),
      scale: [roundTo(width, 3), roundTo(length, 3), roundTo(height, 3)],
    };
  });
}

function buildSeaLevelWaterPlane(terrainData, flavor) {
  const waterProfile = getWaterProfile(flavor);
  const minHeight = Number(terrainData?.minHeight);
  // Terrain world-space Z is stored relative to min elevation, so sea level (0m)
  // sits at -minHeight in exported level coordinates.
  const seaLevelZ = Number.isFinite(minHeight) ? -minHeight : 0;
  return {
    ...structuredClone(WATER_PLANE_TEMPLATE),
    cubemap: waterProfile.waterCubemap,
    depthGradientTex: waterProfile.waterDepthGradientTex,
    foamTex: waterProfile.waterFoamTex,
    rippleTex: waterProfile.waterRippleTex,
    name: 'ocean',
    persistentId: generatePersistentId(),
    __parent: 'Water',
    position: [0, 0, roundTo(seaLevelZ, 3)],
  };
}

function smoothHeights(heights) {
  if (heights.length < 3) return heights;
  const out = heights.slice();
  for (let i = 1; i < heights.length - 1; i++) {
    out[i] = (heights[i - 1] + heights[i] + heights[i + 1]) / 3;
  }
  return out;
}

function parseNumericWidth(value, fallback) {
  if (value == null) return fallback;
  const match = String(value).match(/[\d.]+/);
  const parsed = match ? parseFloat(match[0]) : NaN;
  return Number.isFinite(parsed) ? parsed : fallback;
}

function buildRiverObjects(terrainData, squareSize, flavor) {
  const waterProfile = getWaterProfile(flavor);
  const features = terrainData.osmFeatures?.filter((feature) => {
    if (feature.type !== 'water') return false;
    if (!Array.isArray(feature.geometry) || feature.geometry.length < 2) return false;
    if (isClosedRing(feature.geometry)) return false;
    if (!feature.tags?.waterway) return false;
    return !isExcludedWaterFeature(feature.tags);
  }) ?? [];

  return features.map((feature, index) => {
    const geom = simplifyPolyline(feature.geometry, 72);
    const fallbackWidth = WATERWAY_WIDTHS[feature.tags.waterway] ?? 10;
    const width = Math.max(3, parseNumericWidth(feature.tags.width, fallbackWidth));
    const depth = Math.max(1.5, WATERWAY_DEPTHS[feature.tags.waterway] ?? Math.max(2, width * 0.25));
    const worldPts = geom.map((pt) => geoToWorldPoint(pt.lat, pt.lng, terrainData, squareSize, 0));
    const heights = smoothHeights(worldPts.map((pt) => pt[2] + 0.9));
    const nodes = worldPts.map((pt, ptIndex) => ([
      roundTo(pt[0], 3),
      roundTo(pt[1], 3),
      roundTo(heights[ptIndex], 3),
      roundTo(width, 3),
      roundTo(depth, 3),
      0,
      0,
      1,
    ]));
    return {
      ...structuredClone(RIVER_TEMPLATE),
      cubemap: waterProfile.riverCubemap,
      depthGradientTex: waterProfile.riverDepthGradientTex,
      rippleTex: waterProfile.riverRippleTex,
      name: `waterway_${index}`,
      persistentId: generatePersistentId(),
      __parent: 'Water',
      position: nodes.length > 0 ? nodes[0].slice(0, 3) : [0, 0, 0],
      nodes,
    };
  }).filter((river) => river.nodes.length >= 2);
}

function cloneManagedItemData(itemNames, flavor) {
  const out = {};
  for (const itemName of itemNames) {
    const template = getManagedForestTemplate(flavor, itemName);
    if (!template) continue;
    out[itemName] = {
      ...structuredClone(template),
      persistentId: generatePersistentId(),
    };
  }
  return out;
}

function makeForestPlacement(type, point, terrainData, squareSize, seed, scaleMin, scaleMax) {
  const [x, y, z] = geoToWorldPoint(point.lat, point.lng, terrainData, squareSize, 0);
  const yaw = seededRandom(seed + 17) * Math.PI * 2;
  const scale = scaleMin + (scaleMax - scaleMin) * seededRandom(seed + 29);
  return {
    ctxid: 0,
    pos: [roundTo(x, 3), roundTo(y, 3), roundTo(z, 3)],
    rotationMatrix: rotationMatrixFromYaw(yaw),
    scale: roundTo(scale, 6),
    type,
  };
}

const BEAMNG_TREE_DENSITY_MULTIPLIER = 2.5;
const BEAMNG_GRASS_DENSITY_MULTIPLIER = 2.0;
const BEAMNG_MAX_FOREST_PLACEMENTS_PER_TYPE = 12000;
const BEAMNG_MAX_GROUNDCOVER_ELEMENTS = 320000;

function jitterLatLngByMeters(point, meters, seed) {
  if (!meters || meters <= 0) return point;
  const metersPerDegLat = 111320;
  const cosLat = Math.max(0.2, Math.cos((point.lat * Math.PI) / 180));
  const metersPerDegLng = 111320 * cosLat;
  const angle = seededRandom(seed + 0.17) * Math.PI * 2;
  const radius = seededRandom(seed + 0.31) * meters;
  const dLat = (Math.sin(angle) * radius) / metersPerDegLat;
  const dLng = (Math.cos(angle) * radius) / metersPerDegLng;
  return {
    lat: point.lat + dLat,
    lng: point.lng + dLng,
  };
}

function sampleAreaPlacements(feature, terrainData, squareSize, itemType, densityPerSqM, maxCount, scaleMin, scaleMax, baseSeed) {
  if (!Array.isArray(feature.geometry) || feature.geometry.length < 3) return [];
  const ring = isClosedRing(feature.geometry) ? feature.geometry.slice(0, -1) : feature.geometry;
  if (ring.length < 3) return [];
  let minLat = Infinity;
  let maxLat = -Infinity;
  let minLng = Infinity;
  let maxLng = -Infinity;
  for (const pt of ring) {
    minLat = Math.min(minLat, pt.lat);
    maxLat = Math.max(maxLat, pt.lat);
    minLng = Math.min(minLng, pt.lng);
    maxLng = Math.max(maxLng, pt.lng);
  }
  const centerLat = (minLat + maxLat) * 0.5;
  const metersPerDegLng = 111320 * Math.cos((centerLat * Math.PI) / 180);
  const widthM = Math.max(1, (maxLng - minLng) * metersPerDegLng);
  const heightM = Math.max(1, (maxLat - minLat) * 111320);
  const count = Math.min(maxCount, Math.max(0, Math.floor(widthM * heightM * densityPerSqM)));
  const placements = [];
  for (let i = 0; i < count; i++) {
    const seed = baseSeed + i * 13.37;
    const lat = minLat + (maxLat - minLat) * seededRandom(seed + 1);
    const lng = minLng + (maxLng - minLng) * seededRandom(seed + 2);
    const pt = { lat, lng };
    if (!pointInPolygonLatLng(pt, ring)) continue;
    let inHole = false;
    for (const hole of feature.holes || []) {
      if (pointInPolygonLatLng(pt, hole)) {
        inHole = true;
        break;
      }
    }
    if (inHole) continue;
    placements.push(makeForestPlacement(itemType, pt, terrainData, squareSize, seed, scaleMin, scaleMax));
  }
  return placements;
}

function buildForestPlacements(terrainData, squareSize, { includeTrees, includeRocks, treeDensity = 1 }, flavor) {
  const regularPlacementsByType = new Map();
  const priorityPlacementsByType = new Map();
  const treeDensityMultiplier = BEAMNG_TREE_DENSITY_MULTIPLIER * Math.max(0.5, Math.min(10, Number(treeDensity) || 1));
  const bushDensityMultiplier = BEAMNG_TREE_DENSITY_MULTIPLIER;
  const pushPlacement = (placement, { priority = false } = {}) => {
    if (!getManagedForestTemplate(flavor, placement.type)) return;
    const target = priority ? priorityPlacementsByType : regularPlacementsByType;
    if (!target.has(placement.type)) target.set(placement.type, []);
    const list = target.get(placement.type);
    if (list.length >= BEAMNG_MAX_FOREST_PLACEMENTS_PER_TYPE) return;
    list.push(placement);
  };

  if (includeTrees) {
    for (const feature of terrainData.osmFeatures || []) {
      if (feature.type === 'vegetation' && feature.geometry?.length === 1) {
        const seed = hashString(`${feature.id}:${feature.geometry[0].lat}:${feature.geometry[0].lng}`);
        const point = feature.geometry[0];
        const itemType = resolveTreeTypeForTags(flavor, feature.tags || {});
        const isBush = feature.tags?.natural === 'shrub';
        const isTreeRow =
          feature.tags?.natural === 'tree_row' ||
          feature.tags?.tree_row === 'yes' ||
          feature.tags?.source_feature === 'tree_row';
        const resolvedType = isBush ? resolveBushType(flavor) : itemType;
        if (!resolvedType) continue;
        const pointCopies = isTreeRow
          ? 1
          : isBush
            ? Math.max(1, Math.round(bushDensityMultiplier))
            : Math.max(1, Math.round(treeDensityMultiplier));
        const jitterMeters = isBush ? 2.2 : 5.5;
        for (let i = 0; i < pointCopies; i++) {
          const cloneSeed = seed + i * 97.13;
          const sampledPoint = i === 0 ? point : jitterLatLngByMeters(point, jitterMeters, cloneSeed);
          pushPlacement(makeForestPlacement(
            resolvedType,
            sampledPoint,
            terrainData,
            squareSize,
            cloneSeed,
            isBush ? 0.7 : 0.85,
            isBush ? 1.2 : 1.2,
          ), { priority: isTreeRow });
        }
      }
      if (feature.type === 'landuse') {
        const tags = feature.tags || {};
        const isTreeArea =
          tags.natural === 'wood' ||
          tags.natural === 'forest' ||
          tags.landuse === 'forest' ||
          tags.landuse === 'orchard' ||
          tags.landcover === 'trees';
        if (isTreeArea) {
          const itemType = resolveTreeTypeForTags(flavor, tags);
          if (!itemType) continue;
          // Use polygon-driven sampling for BeamNG export so tree coverage
          // reflects full OSM vegetation areas, independent of 3D preview caps.
          const isOrchard = tags.landuse === 'orchard';
          const placements = sampleAreaPlacements(
            feature,
            terrainData,
            squareSize,
            itemType,
            (isOrchard ? 0.0028 : 0.0036) * treeDensityMultiplier,
            (isOrchard ? 1800 : 3600) * treeDensityMultiplier,
            isOrchard ? 0.9 : 0.85,
            isOrchard ? 1.1 : 1.25,
            hashString(`${feature.id}:tree_area`),
          );
          placements.forEach(pushPlacement);
        }

        const isBushArea =
          tags.natural === 'scrub' ||
          tags.natural === 'heath' ||
          tags.natural === 'shrubbery' ||
          tags.landcover === 'scrub';
        if (isBushArea) {
          const itemType = resolveBushType(flavor, { hedge: tags.barrier === 'hedge' });
          if (!itemType) continue;
          const placements = sampleAreaPlacements(
            feature,
            terrainData,
            squareSize,
            itemType,
            0.004 * bushDensityMultiplier,
            400 * bushDensityMultiplier,
            0.75,
            1.2,
            hashString(feature.id),
          );
          placements.forEach(pushPlacement);
        }
      }
    }
  }

  if (includeRocks) {
    const rockTypes = getRockCandidates(flavor);
    for (const feature of terrainData.osmFeatures || []) {
      if (feature.type !== 'landuse') continue;
      const tags = feature.tags || {};
      const isRockArea =
        tags.landuse === 'quarry' ||
        tags.natural === 'bare_rock' ||
        tags.natural === 'rock' ||
        tags.natural === 'scree' ||
        tags.natural === 'shingle';
      if (!isRockArea) continue;
      if (!rockTypes.length) continue;
      const placements = sampleAreaPlacements(
        feature,
        terrainData,
        squareSize,
        rockTypes[hashString(feature.id) % rockTypes.length],
        0.0008,
        140,
        0.8,
        1.25,
        hashString(`${feature.id}:rocks`),
      );
      placements.forEach((placement, idx) => {
        placement.type = rockTypes[(hashString(`${feature.id}:${idx}`) % rockTypes.length)];
        pushPlacement(placement);
      });
    }
  }

  const placementsByType = new Map();
  const allTypes = new Set([
    ...priorityPlacementsByType.keys(),
    ...regularPlacementsByType.keys(),
  ]);

  for (const type of allTypes) {
    const priority = priorityPlacementsByType.get(type) || [];
    const regular = regularPlacementsByType.get(type) || [];
    const merged = [...priority, ...regular].slice(0, BEAMNG_MAX_FOREST_PLACEMENTS_PER_TYPE);
    if (merged.length > 0) placementsByType.set(type, merged);
  }

  return placementsByType;
}

function serializeForestFiles(placementsByType) {
  const files = [];
  for (const [type, placements] of placementsByType.entries()) {
    if (!placements.length) continue;
    files.push({
      path: `forest/${type}.forest4.json`,
      contents: toNDJSON(placements),
    });
  }
  return files;
}

function buildGroundCoverObjects(terrainData, squareSize, includeTrees, flavor) {
  if (!includeTrees) return [];
  const groundCover = getGroundCoverProfile(flavor);
  const grassClumpScale = Math.max(1, Math.sqrt(BEAMNG_GRASS_DENSITY_MULTIPLIER));
  const widthMeters = terrainData.width * squareSize;
  const heightMeters = terrainData.height * squareSize;
  const radius = Math.max(30, roundTo(Math.min(widthMeters, heightMeters) * 0.48, 3));
  const centerHeight = getTerrainHeightWorld(
    (terrainData.bounds.north + terrainData.bounds.south) * 0.5,
    (terrainData.bounds.east + terrainData.bounds.west) * 0.5,
    terrainData,
  );

  return [{
    __parent: 'vegetation',
    class: 'GroundCover',
    name: 'mapng_grass_cover',
    persistentId: generatePersistentId(),
    position: [0, 0, roundTo(centerHeight, 3)],
    material: groundCover.materialName,
    gridSize: Math.max(1, Math.round(3 / Math.sqrt(BEAMNG_GRASS_DENSITY_MULTIPLIER))),
    radius,
    dissolveRadius: Math.max(40, roundTo(radius * 0.6, 3)),
    shapeCullRadius: radius,
    maxBillboardTiltAngle: 40,
    maxElements: Math.min(
      BEAMNG_MAX_GROUNDCOVER_ELEMENTS,
      Math.max(
        180000,
        Math.round(((widthMeters * heightMeters) / 6) * BEAMNG_GRASS_DENSITY_MULTIPLIER),
      ),
    ),
    windGustLength: 1.7,
    windGustStrength: 0.2,
    windTurbulenceFrequency: 0.3,
    seed: 11,
    Types: [
      {
        billboardUVs: [0.496093988, 0, 0.503906012, 0.47656101],
        clumpRadius: 1.5,
        layer: groundCover.terrainLayer,
        maxClumpCount: Math.round(10 * grassClumpScale),
        minClumpCount: Math.round(4 * grassClumpScale),
        probability: 1,
        sizeMax: 0.7,
        sizeMin: 0.42,
        windScale: 0.2,
      },
      {
        billboardUVs: [0, 0, 0.507812023, 0.488281012],
        layer: groundCover.terrainLayer,
        maxClumpCount: Math.round(8 * grassClumpScale),
        minClumpCount: Math.round(3 * grassClumpScale),
        probability: 0.7,
        sizeMax: 0.65,
        sizeMin: 0.38,
        windScale: 0.2,
      },
      {
        billboardUVs: [0, 0.50781101, 0.5, 0.49218899],
        layer: groundCover.terrainLayer,
        maxClumpCount: Math.round(7 * grassClumpScale),
        minClumpCount: Math.round(3 * grassClumpScale),
        probability: 0.55,
        sizeMax: 0.58,
        sizeMin: 0.34,
        windScale: 0.2,
      },
      {
        billboardUVs: [0.5, 0.503906012, 0.5, 0.496093988],
        clumpRadius: 0.35,
        layer: groundCover.terrainLayer,
        maxClumpCount: Math.round(8 * grassClumpScale),
        minClumpCount: Math.round(3 * grassClumpScale),
        probability: 0.45,
        sizeMax: 0.52,
        sizeMin: 0.32,
        windScale: 0.2,
      },
      {}, {}, {}, {},
    ],
  }];
}

/**
 * Generate a complete BeamNG level .zip from terrainData and center coordinates.
 *
 * ZIP structure:
 *   {levelName}.zip/
 *   └── levels/{levelName}/
 *       ├── info.json
 *       ├── mainLevel.lua
 *       ├── preview.png
 *       ├── theTerrain.ter
 *       ├── theTerrain.terrain.json
 *       ├── theTerrain.terrainheightmap.png
 *       ├── art/terrains/
 *       │   ├── terrain.png
 *       │   └── main.materials.json        (TerrainMaterial + TerrainMaterialTextureSet)
 *       ├── art/shapes/                    (present when OSM features or backdrop exist)
 *       │   ├── osm_objects.dae            (buildings, street furniture — optional)
 *       │   ├── terrain_backdrop.dae       (surrounding terrain mesh — optional)
 *       │   └── main.materials.json        (Materials for all DAEs in this folder)
 *       └── main/
 *           └── MissionGroup/
 *               ├── items.level.json
 *               ├── PlayerDropPoints/
 *               │   └── items.level.json
 *               ├── Level_objects/
 *               │   ├── items.level.json   (LevelInfo, TimeOfDay, ScatterSky, Other group)
 *               │   └── Other/
 *               │       └── items.level.json  (TerrainBlock + optional TSStatics)
 *
 * @param {object} terrainData
 * @param {object} center        — { lat, lng }
 * @param {object} [options]
 * @param {string}  [options.baseTexture='hybrid']         — 'hybrid' | 'satellite' | 'osm'
 * @param {boolean} [options.includeBuildings=true]         — include generated OSM 3D objects (.dae)
 * @param {boolean} [options.applyFoundations=true]         — apply terrain foundation pass under buildings
 * @param {boolean} [options.includeBackdrop=false]         — fetch and include surrounding terrain backdrop DAE
 * @param {boolean} [options.includeWater=true]             — emit native BeamNG inland water objects
 * @param {boolean} [options.includeNativeBarriers=true]    — emit native BeamNG TSStatic barrier objects from OSM barriers as MissionGroup Mesh Spline groups
 * @param {boolean} [options.includeTrees=true]             — emit native BeamNG tree and bush forest instances
 * @param {boolean} [options.includeRocks=false]            — emit native BeamNG rock forest instances
 * @param {number}  [options.treeDensity=1]                 — tree density scale for BeamNG forest placement
 * @param {string}  [options.flavorId]                      — BeamNG official level flavor id
 * @param {string}  [options.levelName]                     — custom user-facing/generated level name
 * @param {'osm'|'image'|'none'} [options.pbrSource='osm'] — layer map source: 'osm' uses OSM polygon data,
 *   'image' is accepted for backward compatibility and falls back to OSM inference, 'none' disables PBR materials.
 *   Legacy boolean option `generatePbrMaterials` is still accepted for backward compatibility.
 * @param {boolean} [options.useMeshRoads=false]            — export roads as 3D MeshRoad geometry instead of flat DecalRoad decals
 */
export async function exportBeamNGLevel(terrainData, center, options = {}) {
  const {
    baseTexture = 'hybrid',
    includeBuildings = true,
    applyFoundations = true,
    includeBackdrop = false,
    includeWater = true,
    includeNativeBarriers = true,
    includeTrees = true,
    includeRocks = false,
    treeDensity = 1,
    useMeshRoads = false,
    flavorId,
    levelName: requestedLevelName = '',
    onProgress,
  } = options;
  // Backward compat: generatePbrMaterials (bool) → pbrSource (string)
  let pbrSource = options.pbrSource;
  if (pbrSource === undefined) {
    pbrSource = options.generatePbrMaterials === false ? 'none' : 'osm';
  }
  const normalizedTreeDensity = Math.max(0.5, Math.min(10, Number(treeDensity) || 1));

  // Report progress and yield to the browser so UI updates and GC can run.
  const report = (step, pct) => onProgress?.({ step, pct });
  const yield_ = () => new Promise(r => setTimeout(r, 0));
  const exportStartedAt = new Date();
  const processingLog = [];
  let currentStep = null;
  let currentStepStartedAt = performance.now();
  const beginStep = (step, pct) => {
    const now = performance.now();
    if (currentStep !== null) {
      processingLog.push({
        step: currentStep.step,
        pct: currentStep.pct,
        durationMs: now - currentStepStartedAt,
      });
    }
    currentStep = { step, pct };
    currentStepStartedAt = now;
    report(step, pct);
  };
  const finishProcessingLog = () => {
    if (currentStep !== null) {
      processingLog.push({
        step: currentStep.step,
        pct: currentStep.pct,
        durationMs: performance.now() - currentStepStartedAt,
      });
      currentStep = null;
    }
  };

  // BeamNG TerrainBlock is square. If source data is rectangular, center-crop
  // everything (heightmap, bounds, textures) so terrain, texture, and OSM
  // objects share the same footprint.
  let td = terrainData;
  const didCropToSquare = td.width !== td.height;
  if (td.width !== td.height) {
    const cropSize = Math.min(td.width, td.height);
    td = await prepareCroppedTerrainData({ ...td, exportCropSize: cropSize });
  }

  const foundationInput = {
    ...td,
    osmFeatures: filterOSMFeaturesToBounds(td.osmFeatures, td.bounds),
  };

  let exportTerrainData = foundationInput;
  if (applyFoundations) {
    beginStep('Preparing building foundations…', 2);
    await yield_();
    exportTerrainData = await applyBuildingFoundations(
      foundationInput,
      {
        yieldFn: yield_,
        onProgress: ({ completed, total, applied, skipped }) => {
          if (!total) return;
          const pct = 2 + Math.round((completed / total) * 2);
          const counts = Number.isFinite(applied) && Number.isFinite(skipped)
            ? ` | Applied: ${applied}, Skipped: ${skipped}`
            : '';
          report(`Foundations ${completed}/${total}${counts}`, Math.min(4, pct));
        },
      }
    );
  } else {
    beginStep('Skipping building foundations (disabled)…', 4);
    await yield_();
  }

  const lat = center.lat.toFixed(4);
  const lng = center.lng.toFixed(4);
  const fallbackLevelName = `mapng_${lat}_${lng}`.replace(/-/g, '_').replace(/\./g, '_');
  const levelDisplayName = String(requestedLevelName || '').trim() || fallbackLevelName;
  const levelName = sanitizeLevelName(levelDisplayName) || sanitizeLevelName(fallbackLevelName) || 'mapng_level';
  const flavor = getBeamNGFlavorById(flavorId);
  if (!flavor) {
    throw new Error(`Missing or invalid BeamNG flavor: ${flavorId || '(none)'}`);
  }

  const size = exportTerrainData.width;
  const osmFeatureCount = Array.isArray(exportTerrainData.osmFeatures) ? exportTerrainData.osmFeatures.length : 0;
  const squareSize = computeSquareSize(exportTerrainData);
  const halfExtent = (size / 2) * squareSize;
  const worldSize = size * squareSize;
  const terrainHeightRange = exportTerrainData.maxHeight - exportTerrainData.minHeight;
  // BeamNG TerrainBlock behaves poorly with maxHeight <= 0 (collision/road projection artifacts).
  const maxHeight = Math.max(1, Math.ceil(terrainHeightRange));

  const { position: spawnPosition, rotationMatrix: spawnRotationMatrix } =
    findSpawnPosition(exportTerrainData, center, squareSize);
  const roadArchitectSession = generateRoadArchitectSession(exportTerrainData, squareSize, levelName);
  const roadArchitectRoadCount = Array.isArray(roadArchitectSession?.data?.roads)
    ? roadArchitectSession.data.roads.length
    : 0;
  const roadArchitectJunctionCount = Array.isArray(roadArchitectSession?.data?.junctions)
    ? roadArchitectSession.data.junctions.length
    : 0;
  const meshRoads = useMeshRoads
    ? generateMeshRoads(exportTerrainData, squareSize)
    : [];
  const roadArchitectHeightmapBlob = roadArchitectSession
    ? generateRoadArchitectHeightmapPng(exportTerrainData, maxHeight)
    : null;

  // ── Sequential pipeline — one heavy operation at a time ────────────────────
  // Running everything in parallel (Promise.all) keeps multiple large buffers
  // alive simultaneously. Sequencing lets each blob be GC-eligible before the
  // next one is allocated, which is critical for 4096+ terrain grids.

  await yield_();
  // Determine the output resolution of the terrain texture.
  // All canvas types (hybrid, osm) are rendered at the same output resolution.
  // Check any alive canvas first; hybridTexWidth is saved before the canvas is freed by
  // the 3D preview. Falls back to the terrain heightmap grid size as a last resort.
  const satelliteTexSize =
    exportTerrainData.hybridTextureCanvas?.width ??
    exportTerrainData.osmTextureCanvas?.width ??
    exportTerrainData.hybridTexWidth ??
    exportTerrainData.width;

  // Legacy image-based inference is no longer generated and now falls back to OSM.
  const imageCanvas = null;
  const effectivePbrSource = (pbrSource === 'image' && !imageCanvas) ? 'osm' : pbrSource;

  beginStep(`Painting terrain materials (${effectivePbrSource.toUpperCase()})…`, 5);
  const pbrResult = effectivePbrSource !== 'none'
    ? await buildTerrainMaterials(exportTerrainData, worldSize, levelName, flavor, satelliteTexSize, {
        pbrSource: effectivePbrSource,
        imageCanvas,
      })
    : null;

  beginStep(`Exporting terrain binary (.ter, ${size}x${size})…`, 20);
  await yield_();
  const { blob: terBlob } = await exportTer(exportTerrainData, {
    layerMap: pbrResult?.layerMap ?? null,
    materialNames: pbrResult?.materialNames ?? null,
  });

  beginStep(`Generating base texture (${baseTexture}, ${satelliteTexSize}px)…`, 35);
  await yield_();
  let texBlob = await getTerrainTextureBlob(exportTerrainData, baseTexture);
  // terrain.png must be exactly baseTexSize pixels — BeamNG's TerrainMaterialTextureSet
  // enforces that all base textures share the same pixel dimensions.
  if (pbrResult && texBlob) {
    texBlob = await resizePngBlob(texBlob, satelliteTexSize);
  }

  beginStep(`Generating heightmap preview (${size}x${size})…`, 50);
  await yield_();
  let heightmapBlob = await generateHeightmapPng(exportTerrainData);

  beginStep('Generating level thumbnail image…', 58);
  await yield_();
  let previewBlob = await generatePreviewBlob(exportTerrainData);

  let osmDaeBlob = null;
  if (includeBuildings) {
    beginStep(`Building 3D OSM objects (${osmFeatureCount} features)…`, 65);
    await yield_();
    osmDaeBlob = await generateOSMObjectsDAE(exportTerrainData, worldSize);
  } else {
    beginStep('Skipping 3D OSM object export (disabled)…', 65);
    await yield_();
  }

  beginStep(`Building water objects (sea level + inland ${includeWater ? 'enabled' : 'disabled'})…`, 71);
  await yield_();
  // Always emit a sea-level WaterPlane; includeWater toggles only inland OSM-derived water.
  const waterObjects = [
    buildSeaLevelWaterPlane(exportTerrainData, flavor),
    ...(includeWater
      ? [
          ...buildWaterBlockObjects(exportTerrainData, squareSize, flavor),
          ...buildRiverObjects(exportTerrainData, squareSize, flavor),
        ]
      : []),
  ];

  beginStep(`Building native barrier objects (${includeNativeBarriers ? 'enabled' : 'disabled'})…`, 74);
  await yield_();
  const barrierObjects = includeNativeBarriers
    ? buildNativeBarrierObjects(exportTerrainData, squareSize)
    : [];
  const barrierMeshSplineGroups = groupBarrierObjectsAsMeshSplines(barrierObjects);

  beginStep(`Building vegetation objects (trees: ${includeTrees ? 'on' : 'off'} @ ${normalizedTreeDensity.toFixed(1)}x, rocks: ${includeRocks ? 'on' : 'off'})…`, 77);
  await yield_();
  const forestPlacements = (includeTrees || includeRocks)
    ? buildForestPlacements(exportTerrainData, squareSize, { includeTrees, includeRocks, treeDensity: normalizedTreeDensity }, flavor)
    : new Map();
  const forestFiles = serializeForestFiles(forestPlacements);
  const groundCoverObjects = buildGroundCoverObjects(exportTerrainData, squareSize, includeTrees, flavor);
  const managedForestItemData = cloneManagedItemData(Array.from(forestPlacements.keys()), flavor);
  const shapeMaterialDefsForFlavor = (forestFiles.length > 0 || includeRocks)
    ? await getShapeMaterialDefsForFlavor(flavor)
    : {};

  let backdropDaeBlob = null;
  let backdropTextureFiles = [];
  let backdropDiagnostics = null;
  if (includeBackdrop) {
    beginStep('Fetching terrain backdrop mesh…', 82);
    await yield_();
    const backdropResult = await generateTerrainBackdropDAE(exportTerrainData, worldSize);
    backdropDaeBlob = backdropResult?.daeBlob ?? null;
    backdropTextureFiles = backdropResult?.textureFiles ?? [];
    backdropDiagnostics = backdropResult?.diagnostics ?? null;
  }

  beginStep('Loading MapNG flag asset…', 85);
  await yield_();
  let mapngFlagFiles = [];
  try {
    mapngFlagFiles = await loadMapngFlagAsset();
  } catch (error) {
    console.warn('Failed to load MapNG flag asset, skipping:', error);
  }
  const mapngFlagPosition = findHighestTerrainPoint(exportTerrainData, squareSize);

  beginStep(`Assembling ZIP archive (${levelName})…`, 88);
  await yield_();

  const zip = new JSZip();
  const base = `levels/${levelName}`;

  // Explicit directory entries so BeamNG's FS:directoryExists() works correctly
  zip.folder('levels');
  zip.folder(base);
  zip.folder(`${base}/art`);
  zip.folder(`${base}/bat`);
  zip.folder(`${base}/art/terrains`);
  zip.folder(`${base}/main`);
  zip.folder(`${base}/main/MissionGroup`);
  zip.folder(`${base}/main/MissionGroup/Level_objects`);
  zip.folder(`${base}/main/MissionGroup/Level_objects/Other`);
  zip.folder(`${base}/main/MissionGroup/PlayerDropPoints`);
  zip.folder(`${base}/main/MissionGroup/Water`);
  if (barrierMeshSplineGroups.length > 0) {
    for (const group of barrierMeshSplineGroups) {
      zip.folder(`${base}/main/MissionGroup/${group.groupName}`);
    }
  }
  if (forestFiles.length > 0 || groundCoverObjects.length > 0) {
    zip.folder(`${base}/main/MissionGroup/Level_objects/vegetation`);
    zip.folder(`${base}/art/forest`);
    zip.folder(`${base}/forest`);
  }

  // ── info.json ──────────────────────────────────────────────────────────────
  zip.file(`${base}/info.json`, JSON.stringify({
    authors: 'mapng',
    defaultSpawnPointName: 'spawn_default',
    description: `Generated by mapng at ${lat}, ${lng}`,
    previews: ['preview.png'],
    size: [size, size],
    spawnPoints: [{
      name: 'Default',
      objectname: 'spawn_default',
      preview: 'preview.png',
      translationId: 'Default Spawnpoint',
    }],
    title: levelDisplayName,
  }, null, 2));

  // ── mainLevel.lua ──────────────────────────────────────────────────────────
  // Lua initialization script executed on level load. Expected by BeamNG's
  // level subsystem and the World Editor.
  zip.file(`${base}/mainLevel.lua`, [
    '-- Auto-generated by mapng',
    'local M = {}',
    '',
    'local raAutoLoadPending = false',
    'local raAutoLoadDone = false',
    'local raAutoLoadWait = 0',
    'local raAutoLoadMaxWait = 15',
    '',
    'local function getRoadArchitectSessionPath()',
    '  if not core_levels or not getMissionFilename then return nil end',
    '  local levelName = core_levels.getLevelName(getMissionFilename())',
    '  if not levelName or levelName == "" then return nil end',
    '  return "/levels/" .. tostring(levelName) .. "/bat/roadatchitectsession.json"',
    'end',
    '',
    'local function loadRoadArchitectSessionIfAvailable()',
    '  if raAutoLoadDone then return true end',
    '  local sessionPath = getRoadArchitectSessionPath()',
    '  if not sessionPath then return false end',
    '  if not FS or not FS.fileExists or not FS:fileExists(sessionPath) then',
    '    raAutoLoadDone = true',
    '    return true',
    '  end',
    '',
    '  local sessionData = jsonReadFile(sessionPath)',
    '  if not sessionData or not sessionData.data then',
    '    log("E", "mapng", "Road Architect session exists but could not be read: " .. tostring(sessionPath))',
    '    raAutoLoadDone = true',
    '    return true',
    '  end',
    '',
    '  if not extensions or not extensions.editor_roadArchitect or not extensions.editor_roadArchitect.onDeserialized then',
    '    return false',
    '  end',
    '',
    '  if FS and FS.directoryCreate then FS:directoryCreate("temp/") end',
    '  jsonWriteFile("temp/roadArchitect.json", sessionData, true)',
    '',
    '  local ok, err = pcall(extensions.editor_roadArchitect.onDeserialized)',
    '  if not ok then',
    '    log("E", "mapng", "Road Architect auto-load failed: " .. tostring(err))',
    '    return false',
    '  end',
    '',
    '  local okRoadMgr, roadMgr = pcall(require, "editor/tech/roadArchitect/roads")',
    '  if okRoadMgr and roadMgr and roadMgr.roads then',
    '    for i = 1, #roadMgr.roads do',
    '      local road = roadMgr.roads[i]',
    '      if road and road.isConformRoadToTerrain then',
    '        road.isConformRoadToTerrain[0] = true',
    '      end',
    '      if roadMgr.setDirty and road then',
    '        roadMgr.setDirty(road)',
    '      end',
    '    end',
    '    if roadMgr.computeAllRoadRenderData then',
    '      roadMgr.computeAllRoadRenderData()',
    '    end',
    '    if roadMgr.finalise and #roadMgr.roads > 0 then',
    '      pcall(roadMgr.finalise)',
    '    end',
    '  end',
    '',
    '  raAutoLoadDone = true',
    '  return true',
    'end',
    '',
    'function M.onClientStartMission()',
    '  raAutoLoadPending = true',
    '  raAutoLoadWait = 0',
    '  loadRoadArchitectSessionIfAvailable()',
    'end',
    '',
    'function M.onUpdate(dtReal)',
    '  if not raAutoLoadPending or raAutoLoadDone then return end',
    '  raAutoLoadWait = raAutoLoadWait + (tonumber(dtReal) or 0)',
    '  if loadRoadArchitectSessionIfAvailable() then',
    '    raAutoLoadPending = false',
    '    return',
    '  end',
    '  if raAutoLoadWait >= raAutoLoadMaxWait then',
    '    raAutoLoadPending = false',
    '  end',
    'end',
    '',
    'function M.onSerialize()',
    '  return {}',
    'end',
    '',
    'function M.onDeserialized(data)',
    'end',
    '',
    'return M',
  ].join('\n') + '\n');

  // ── preview.png ────────────────────────────────────────────────────────────
  zip.file(`${base}/preview.png`, previewBlob);
  previewBlob = null;

  const reportGeneratedAt = new Date();
  const processingLogSnapshot = currentStep !== null
    ? [
        ...processingLog,
        {
          step: currentStep.step,
          pct: currentStep.pct,
          durationMs: performance.now() - currentStepStartedAt,
        },
      ]
    : processingLog.slice();
  const reportContents = buildBeamNGExportReport({
    terrainData: exportTerrainData,
    originalTerrainData: terrainData,
    center,
    options: {
      ...options,
      baseTexture,
      includeBuildings,
      applyFoundations,
      includeBackdrop,
      includeWater,
      includeNativeBarriers,
      includeTrees,
      includeRocks,
      treeDensity: normalizedTreeDensity,
      requestedPbrSource: pbrSource,
      terrainMaterialNames: pbrResult?.materialNames ?? ['DefaultMaterial'],
    },
    levelName,
    levelDisplayName,
    flavor,
    squareSize,
    satelliteTexSize,
    worldSize,
    exportStartedAt,
    reportGeneratedAt,
    processingLog: processingLogSnapshot,
    effectivePbrSource,
    waterObjects,
    barrierObjects,
    barrierMeshSplineGroups,
    roadArchitectRoadCount,
    roadArchitectJunctionCount,
    forestPlacements,
    forestFiles,
    groundCoverObjects,
    osmDaeBlob,
    backdropDaeBlob,
    backdropTextureFiles,
    backdropDiagnostics,
    mapngFlagFiles,
    didCropToSquare,
  });
  zip.file(`${base}/export_report.txt`, reportContents);

  if (roadArchitectSession) {
    zip.file(`${base}/bat/roadatchitectsession.json`, JSON.stringify(roadArchitectSession, null, 2));
    if (roadArchitectHeightmapBlob) {
      zip.file(`${base}/bat/roadatchitectsession.png`, roadArchitectHeightmapBlob);
    }
  }

  // ── theTerrain.ter ─────────────────────────────────────────────────────────
  zip.file(`${base}/theTerrain.ter`, terBlob);

  // ── theTerrain.terrainheightmap.png ────────────────────────────────────────
  // Grayscale heightmap preview used by BeamNG's terrain system and World Editor.
  // Capped at 2048px — the .ter binary holds the full-res data; this is display only.
  zip.file(`${base}/theTerrain.terrainheightmap.png`, heightmapBlob);
  heightmapBlob = null;

  // ── art/shapes/ (OSM 3D objects and/or terrain backdrop) ──────────────────
  // Only written when at least one DAE file is present.
  if (osmDaeBlob || backdropDaeBlob || forestFiles.length > 0 || groundCoverObjects.length > 0 || mapngFlagFiles.length > 0) {
    zip.folder(`${base}/art/shapes`);
    if (mapngFlagFiles.length > 0) zip.folder(`${base}/art/shapes/mapng`);

    if (osmDaeBlob) zip.file(`${base}/art/shapes/osm_objects.dae`, osmDaeBlob);
    if (backdropDaeBlob) zip.file(`${base}/art/shapes/terrain_backdrop.dae`, backdropDaeBlob);
    for (const asset of mapngFlagFiles) {
      const relativePath = asset.path.startsWith('mapng/') ? asset.path.slice('mapng/'.length) : asset.path;
      if (relativePath === 'main.materials.json') {
        const materialDefs = JSON.parse(new TextDecoder().decode(asset.data));
        if (materialDefs.mapng_flag?.Stages?.[0]) {
          materialDefs.mapng_flag.class = 'Material';
          materialDefs.mapng_flag.Stages[0].colorMap = `levels/${levelName}/art/shapes/mapng/mapng_flag_d.png`;
        }
        zip.file(`${base}/art/shapes/mapng/main.materials.json`, JSON.stringify(materialDefs, null, 2));
      } else {
        zip.file(`${base}/art/shapes/mapng/${relativePath}`, asset.data);
      }
    }

    // Build a single materials JSON covering all DAEs in this directory.
    const shapeMaterials = {
      ...shapeMaterialDefsForFlavor,
      ...(groundCoverObjects.length > 0 ? {
        [getGroundCoverProfile(flavor).materialName]: structuredClone(getGroundCoverProfile(flavor).materialDef),
      } : {}),
    };
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

  // ── art/terrains/terrain.png ───────────────────────────────────────────────
  zip.file(`${base}/art/terrains/terrain.png`, texBlob);
  texBlob = null;

  // ── art/terrains/ PBR textures (when OSM material painting is enabled) ─────
  if (pbrResult?.textureFiles?.length) {
    for (const { path, blob } of pbrResult.textureFiles) {
      zip.file(`${base}/art/terrains/${path}`, blob);
    }
  }

  // ── art/terrains/main.materials.json ──────────────────────────────────────
  // When PBR materials are active, write all material definitions from the
  // OSM painter (DefaultMaterial satellite base + PBR overlays).
  // Otherwise, fall back to a single DefaultMaterial covering the whole terrain.
  const terrainMaterialDefs = pbrResult?.materialDefs ?? {
    DefaultMaterial: {
      class: 'TerrainMaterial',
      internalName: 'DefaultMaterial',
      diffuseMap: `levels/${levelName}/art/terrains/terrain.png`,
      diffuseSize: Math.round(worldSize),
      groundmodelName: 'GROUNDMODEL_ASPHALT1',
    },
  };
  zip.file(`${base}/art/terrains/main.materials.json`, JSON.stringify(terrainMaterialDefs, null, 2));

  // ── theTerrain.terrain.json — update materials list to match .ter contents ─
  const terrainMaterialNames = pbrResult?.materialNames ?? ['DefaultMaterial'];
  const heightMapSize = size * size;
  zip.file(`${base}/theTerrain.terrain.json`, JSON.stringify({
    binaryFormat: 'version(char), size(unsigned int), heightMap(heightMapSize * heightMapItemSize), layerMap(layerMapSize * layerMapItemSize), layerTextureMap(layerMapSize * layerMapItemSize), materialNames',
    datafile: `/levels/${levelName}/theTerrain.ter`,
    heightMapItemSize: 2,
    heightMapSize,
    heightmapImage: `/levels/${levelName}/theTerrain.terrainheightmap.png`,
    layerMapItemSize: 1,
    layerMapSize: heightMapSize,
    materials: terrainMaterialNames,
    size,
    version: 9,
  }, null, 2));

  // ── main/items.level.json ──────────────────────────────────────────────────
  zip.file(`${base}/main/items.level.json`,
    toNDJSON([{ class: 'SimGroup', name: 'MissionGroup', persistentId: generatePersistentId() }])
  );

  // ── main/MissionGroup/items.level.json ─────────────────────────────────────
  const missionGroupItems = [
    { __parent: 'MissionGroup', class: 'SimGroup', name: 'PlayerDropPoints', persistentId: generatePersistentId() },
    { __parent: 'MissionGroup', class: 'SimGroup', name: 'Level_objects', persistentId: generatePersistentId() },
    { __parent: 'MissionGroup', class: 'SimGroup', name: 'Water', persistentId: generatePersistentId() },
    ...(meshRoads.length > 0 ? [{
      __parent: 'MissionGroup',
      class: 'SimGroup',
      name: 'Mesh_roads',
      persistentId: generatePersistentId(),
    }] : []),
    ...barrierMeshSplineGroups.map((group) => ({
      __parent: 'MissionGroup',
      class: 'SimGroup',
      name: group.groupName,
      persistentId: generatePersistentId(),
    })),
  ];
  zip.file(`${base}/main/MissionGroup/items.level.json`, toNDJSON(missionGroupItems));

  // ── main/MissionGroup/Mesh Spline */items.level.json ──────────────────────
  if (barrierMeshSplineGroups.length > 0) {
    for (const group of barrierMeshSplineGroups) {
      zip.file(`${base}/main/MissionGroup/${group.groupName}/items.level.json`, toNDJSON(group.items));
    }
  }

  // ── main/MissionGroup/Mesh_roads/items.level.json ──────────────────────────
  if (meshRoads.length > 0) {
    zip.folder(`${base}/main/MissionGroup/Mesh_roads`);
    zip.file(`${base}/main/MissionGroup/Mesh_roads/items.level.json`, toNDJSON(meshRoads));
  }

  // ── main/MissionGroup/Level_objects/items.level.json ──────────────────────
  // LevelInfo, TimeOfDay, ScatterSky, and the Other group (which holds terrain)
  // are all defined here, matching the Cliff level's structure.
  zip.file(`${base}/main/MissionGroup/Level_objects/items.level.json`,
    toNDJSON([
      {
        __parent: 'Level_objects',
        class: 'LevelInfo',
        name: 'theLevelInfo',
        persistentId: generatePersistentId(),
        canvasClearColor: [0, 0, 0, 1],
        fogAtmosphereHeight: 1000,
        fogDensity: 0.0001,
        fogDensityOffset: 0,
        globalEnviromentMap: getGlobalEnvironmentMap(flavor),
        gravity: -9.81,
        nearClip: 0.1,
        visibleDistance: 4000,
      },
      {
        __parent: 'Level_objects',
        class: 'TimeOfDay',
        name: 'tod',
        persistentId: generatePersistentId(),
        startTime: 0.15,
      },
      {
        __parent: 'Level_objects',
        class: 'ScatterSky',
        name: 'sunsky',
        persistentId: generatePersistentId(),
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
        persistentId: generatePersistentId(),
      },
      ...((forestFiles.length > 0 || groundCoverObjects.length > 0) ? [{
        __parent: 'Level_objects',
        class: 'SimGroup',
        name: 'vegetation',
        persistentId: generatePersistentId(),
      }] : []),
    ])
  );

  // ── main/MissionGroup/Level_objects/Other/items.level.json ────────────────
  // TerrainBlock referencing the .ter file and the PBR material texture set.
  // - squareSize:        real-world meters per terrain grid square
  // - maxHeight:         elevation range in meters (maps ter 0→65535 to 0→maxHeight)
  // - baseTexSize:       resolution of the base color texture (matches satellite pixel size)
  // - terrainFile:       leading-slash path (BeamNG vanilla convention)
  // - materialTextureSet: links to the TerrainMaterialTextureSet for PBR atlas sizing
  // - minimapImage:      left empty; filled in by the World Editor when a minimap is baked
  //
  // TSStatic (optional): OSM 3D objects DAE, placed at world origin.
  // The DAE geometry is already in BeamNG world-space — no rotation or scale
  // needed on the TSStatic. Collada up_axis is declared Z_UP in the file.
  const otherItems = [{
    __parent: 'Other',
    class: 'TerrainBlock',
    name: 'theTerrain',
    persistentId: generatePersistentId(),
    position: [-halfExtent, -halfExtent, 0],
    squareSize,
    maxHeight,
    baseTexSize: size,
    terrainFile: `/levels/${levelName}/theTerrain.ter`,
    materialTextureSet: pbrResult?.textureSetName ?? '',
    minimapImage: '',
  }];

  if (osmDaeBlob) {
    otherItems.push({
      __parent: 'Other',
      class: 'TSStatic',
      name: 'osm_objects',
      persistentId: generatePersistentId(),
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
      persistentId: generatePersistentId(),
      position: [0, 0, 0],
      shapeName: `levels/${levelName}/art/shapes/terrain_backdrop.dae`,
      useInstanceRenderData: true,
    });
  }

  if (mapngFlagFiles.length > 0) {
    otherItems.push({
      __parent: 'Other',
      class: 'TSStatic',
      name: 'mapng_flag_marker',
      persistentId: generatePersistentId(),
      position: mapngFlagPosition,
      shapeName: `levels/${levelName}/art/shapes/mapng/flagng.dae`,
      useInstanceRenderData: true,
    });
  }

  zip.file(`${base}/main/MissionGroup/Level_objects/Other/items.level.json`,
    toNDJSON(otherItems)
  );

  zip.file(`${base}/main/MissionGroup/Water/items.level.json`,
    toNDJSON(waterObjects)
  );

  if (forestFiles.length > 0 || groundCoverObjects.length > 0) {
    zip.file(`${base}/main/MissionGroup/Level_objects/vegetation/items.level.json`,
      toNDJSON([
        ...(forestFiles.length > 0 ? [{
          __parent: 'vegetation',
          class: 'Forest',
          name: 'theForest',
          persistentId: generatePersistentId(),
          lodReflectScalar: 0,
        }] : []),
        ...groundCoverObjects,
      ])
    );
    if (forestFiles.length > 0) {
      zip.file(`${base}/art/forest/managedItemData.json`, JSON.stringify(managedForestItemData, null, 2));
      for (const forestFile of forestFiles) {
        zip.file(`${base}/${forestFile.path}`, forestFile.contents);
      }
    }
  }

  // ── main/MissionGroup/PlayerDropPoints/items.level.json ───────────────────
  // Spawn position: midpoint of nearest road to terrain center (or center
  // fallback), 3 m above the terrain surface at that point.
  // rotationMatrix: 9-element flat row-major matrix aligning the vehicle with
  // the road tangent direction at the spawn point.
  zip.file(`${base}/main/MissionGroup/PlayerDropPoints/items.level.json`,
    toNDJSON([{
      __parent: 'PlayerDropPoints',
      class: 'SpawnSphere',
      dataBlock: 'SpawnSphereMarker',
      name: 'spawn_default',
      persistentId: generatePersistentId(),
      position: spawnPosition,
      rotationMatrix: spawnRotationMatrix,
      radius: 5,
    }])
  );

  beginStep('Compressing ZIP archive (DEFLATE)…', 94);
  await yield_();
  const zipBlob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE' });
  beginStep('Done', 100);
  finishProcessingLog();
  return { blob: zipBlob, filename: `${levelName}.zip` };
}
