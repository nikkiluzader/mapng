import * as THREE from 'three';
import JSZip from 'jszip';
import { exportTer } from './exportTer.js';
import { buildTerrainMaterials } from './osmTerrainMaterials.js';
import { createOSMGroup, createSurroundingMeshes, SCENE_SIZE } from './export3d.js';
import { prepareCroppedTerrainData } from './cropTerrain.js';
import { ColladaExporter } from './ColladaExporter.js';

/**
 * Sanitize a string for use as a BeamNG level folder name.
 */
function sanitizeLevelName(name) {
  return name.replace(/[^a-zA-Z0-9_]/g, '_');
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
  const h00 = heightMap[r0 * width + c0];
  const h10 = heightMap[r0 * width + c1];
  const h01 = heightMap[r1 * width + c0];
  const h11 = heightMap[r1 * width + c1];
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
 *   'segmented'       — segmented satellite
 *   'segmentedHybrid' — segmented satellite + OSM roads overlay
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
    } else if (textureType === 'segmented') {
      if (terrainData.segmentedTextureCanvas) return new Promise(r => terrainData.segmentedTextureCanvas.toBlob(r, 'image/png'));
      if (terrainData.segmentedTextureBlob) return terrainData.segmentedTextureBlob;
      if (terrainData.segmentedTextureUrl) return await urlToPngBlob(terrainData.segmentedTextureUrl);
    } else if (textureType === 'segmentedHybrid') {
      if (terrainData.segmentedHybridTextureCanvas) return new Promise(r => terrainData.segmentedHybridTextureCanvas.toBlob(r, 'image/png'));
      if (terrainData.segmentedHybridTextureBlob) return terrainData.segmentedHybridTextureBlob;
      if (terrainData.segmentedHybridTextureUrl) return await urlToPngBlob(terrainData.segmentedHybridTextureUrl);
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

  const result = new ColladaExporter().parse(scene, undefined, {
    textureDirectory: 'textures',
    version: '1.4.1',
    upAxis: 'Z_UP',
  });
  if (!result?.data) return null;
  return {
    daeBlob: result.data,
    textureFiles: result.textures ?? [],
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

// OSM highway type → BeamNG DecalRoad properties.
// width: half-width in metres (total road width = 2 × value, per BeamNG node format).
//   4 = 8 m total (single-lane residential), 8 = 16 m total (two-lane arterial).
// textureLength: metres of road per texture tile — longer = fewer visible seams
// renderPriority: higher = renders on top at intersections; major roads over minor
const HIGHWAY_STYLE = {
  motorway:       { material: 'road_asphalt_2lane',  width: 8,   textureLength: 24, renderPriority: 16 },
  motorway_link:  { material: 'road_asphalt_2lane',  width: 5,   textureLength: 20, renderPriority: 15 },
  trunk:          { material: 'road_asphalt_2lane',  width: 8,   textureLength: 24, renderPriority: 15 },
  trunk_link:     { material: 'road_asphalt_2lane',  width: 5,   textureLength: 20, renderPriority: 14 },
  primary:        { material: 'road_asphalt_2lane',  width: 8,   textureLength: 20, renderPriority: 14 },
  primary_link:   { material: 'road_asphalt_2lane',  width: 5,   textureLength: 18, renderPriority: 13 },
  secondary:      { material: 'road_asphalt_2lane',  width: 6,   textureLength: 18, renderPriority: 13 },
  secondary_link: { material: 'road_asphalt_2lane',  width: 5,   textureLength: 16, renderPriority: 12 },
  tertiary:       { material: 'road_asphalt_2lane',  width: 5,   textureLength: 16, renderPriority: 12 },
  tertiary_link:  { material: 'road_asphalt_2lane',  width: 4,   textureLength: 15, renderPriority: 11 },
  residential:    { material: 'road_asphalt_2lane',  width: 4,   textureLength: 15, renderPriority: 11 },
  living_street:  { material: 'road_asphalt_2lane',  width: 4,   textureLength: 12, renderPriority: 10 },
  unclassified:   { material: 'road_asphalt_2lane',  width: 4,   textureLength: 15, renderPriority: 11 },
  road:           { material: 'road_asphalt_2lane',  width: 4,   textureLength: 15, renderPriority: 10 },
  service:        { material: 'road_asphalt_2lane',  width: 4,   textureLength: 12, renderPriority: 10 },
  raceway:        { material: 'road_asphalt_2lane',  width: 6,   textureLength: 20, renderPriority: 12 },
  busway:         { material: 'road_asphalt_2lane',  width: 4,   textureLength: 15, renderPriority: 11 },
  track:          { material: 'm_dirt_road_gravels',  width: 4,   textureLength: 12, renderPriority: 9  },
};

// OSM highway types to exclude from road generation (non-vehicle ways).
const ROAD_SKIP = new Set([
  'footway', 'path', 'pedestrian', 'steps', 'cycleway',
  'bridleway', 'corridor', 'proposed', 'construction',
]);

/**
 * Convert OSM road features to BeamNG DecalRoad scene objects.
 *
 * Each OSM way is clipped to the terrain's safe inner boundary before export.
 * Ways that cross the boundary are split into multiple DecalRoads at the
 * crossing point, so no node lands outside or too near the TerrainBlock edge
 * (which causes BeamNG's improvedSpline to float those segments in the air).
 *
 * DecalRoad nodes format: [x, y, z, halfWidth]
 *   halfWidth = distance from road centreline to each edge (metres).
 *
 * Returns an empty array when no OSM data is available.
 */
function generateDecalRoads(terrainData, squareSize) {
  if (!terrainData.osmFeatures?.length) return [];

  const roads = [];

  for (const feature of terrainData.osmFeatures) {
    if (feature.type !== 'road' || !feature.geometry?.length) continue;

    const highway = feature.tags?.highway;
    if (!highway || ROAD_SKIP.has(highway)) continue;

    const style = HIGHWAY_STYLE[highway] ?? { material: 'road_asphalt_2lane', width: 3, textureLength: 15, renderPriority: 10 };

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
          style.width,
        ]);
      }

      const nodes = decimateNodes(rawNodes);
      if (nodes.length < 2) continue;

      roads.push({
        class: 'DecalRoad',
        persistentId: generatePersistentId(),
        __parent: 'Decal_roads',
        position: [nodes[0][0], nodes[0][1], nodes[0][2]],
        autoLanes: true,
        breakAngle: 3,
        decalBias: 0.001,
        detail: 0.1,
        drivability: 1,
        improvedSpline: true,
        smoothness: 0.1,
        material: style.material,
        nodes,
        overObjects: true,
        renderPriority: style.renderPriority,
        textureLength: style.textureLength,
        zBias: 0.05,
      });
    }
  }

  return roads;
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
 *       ├── mainLevel.lua
 *       ├── preview.png
 *       ├── theTerrain.ter
 *       ├── theTerrain.terrain.json
 *       ├── theTerrain.terrainheightmap.png
 *       ├── art/terrains/
 *       │   ├── terrain.png
 *       │   └── main.materials.json        (TerrainMaterial + TerrainMaterialTextureSet)
 *       ├── art/shapes/                    (present when OSM features or backdrop exist)
 *       │   ├── osm_objects.dae            (buildings, trees, barriers — optional)
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
 * @param {string}  [options.baseTexture='hybrid']         — 'hybrid' | 'satellite' | 'osm' | 'segmented' | 'segmentedHybrid'
 * @param {boolean} [options.includeBackdrop=false]         — fetch and include surrounding terrain backdrop DAE
 * @param {boolean} [options.generatePbrMaterials=true]     — paint OSM-derived PBR terrain materials over the base texture
 */
export async function exportBeamNGLevel(terrainData, center, options = {}) {
  const { baseTexture = 'hybrid', includeBackdrop = false, generatePbrMaterials = true, onProgress } = options;

  // Report progress and yield to the browser so UI updates and GC can run.
  const report = (step, pct) => onProgress?.({ step, pct });
  const yield_ = () => new Promise(r => setTimeout(r, 0));

  // BeamNG TerrainBlock is square. If source data is rectangular, center-crop
  // everything (heightmap, bounds, textures) so terrain, texture, and OSM
  // objects share the same footprint.
  let td = terrainData;
  if (td.width !== td.height) {
    const cropSize = Math.min(td.width, td.height);
    td = await prepareCroppedTerrainData({ ...td, exportCropSize: cropSize });
  }

  const exportTerrainData = {
    ...td,
    osmFeatures: filterOSMFeaturesToBounds(td.osmFeatures, td.bounds),
  };

  const lat = center.lat.toFixed(4);
  const lng = center.lng.toFixed(4);
  const levelName = sanitizeLevelName(`mapng_${lat}_${lng}`);

  const size = exportTerrainData.width;
  const squareSize = computeSquareSize(exportTerrainData);
  const halfExtent = (size / 2) * squareSize;
  const worldSize = size * squareSize;
  const maxHeight = Math.ceil(exportTerrainData.maxHeight - exportTerrainData.minHeight);

  const { position: spawnPosition, rotationMatrix: spawnRotationMatrix } =
    findSpawnPosition(exportTerrainData, center, squareSize);

  const decalRoads = generateDecalRoads(exportTerrainData, squareSize);

  // ── Sequential pipeline — one heavy operation at a time ────────────────────
  // Running everything in parallel (Promise.all) keeps multiple large buffers
  // alive simultaneously. Sequencing lets each blob be GC-eligible before the
  // next one is allocated, which is critical for 4096+ terrain grids.

  report('Painting OSM terrain materials…', 5);
  await yield_();
  // Determine the output resolution of the terrain texture.
  // All canvas types (hybrid, osm, segmented) are rendered at the same output resolution.
  // Check any alive canvas first; hybridTexWidth is saved before the canvas is freed by
  // the 3D preview. Falls back to the terrain heightmap grid size as a last resort.
  const satelliteTexSize =
    exportTerrainData.hybridTextureCanvas?.width ??
    exportTerrainData.osmTextureCanvas?.width ??
    exportTerrainData.segmentedTextureCanvas?.width ??
    exportTerrainData.segmentedHybridTextureCanvas?.width ??
    exportTerrainData.hybridTexWidth ??
    exportTerrainData.width;
  const pbrResult = generatePbrMaterials
    ? await buildTerrainMaterials(exportTerrainData, worldSize, levelName, satelliteTexSize)
    : null;

  report('Exporting terrain binary (.ter)…', 20);
  await yield_();
  const { blob: terBlob } = await exportTer(exportTerrainData, {
    layerMap: pbrResult?.layerMap ?? null,
    materialNames: pbrResult?.materialNames ?? null,
  });

  report('Generating satellite texture…', 35);
  await yield_();
  let texBlob = await getTerrainTextureBlob(exportTerrainData, baseTexture);
  // terrain.png must be exactly baseTexSize pixels — BeamNG's TerrainMaterialTextureSet
  // enforces that all base textures share the same pixel dimensions.
  if (generatePbrMaterials && texBlob) {
    texBlob = await resizePngBlob(texBlob, satelliteTexSize);
  }

  report('Generating heightmap preview…', 50);
  await yield_();
  let heightmapBlob = await generateHeightmapPng(exportTerrainData);

  report('Generating level preview image…', 58);
  await yield_();
  let previewBlob = await generatePreviewBlob(exportTerrainData);

  report('Building 3D OSM objects…', 65);
  await yield_();
  let osmDaeBlob = await generateOSMObjectsDAE(exportTerrainData, worldSize);

  let backdropDaeBlob = null;
  let backdropTextureFiles = [];
  if (includeBackdrop) {
    report('Fetching terrain backdrop…', 75);
    await yield_();
    const backdropResult = await generateTerrainBackdropDAE(exportTerrainData, worldSize);
    backdropDaeBlob = backdropResult?.daeBlob ?? null;
    backdropTextureFiles = backdropResult?.textureFiles ?? [];
  }

  report('Assembling ZIP archive…', 85);
  await yield_();

  const zip = new JSZip();
  const base = `levels/${levelName}`;

  // Explicit directory entries so BeamNG's FS:directoryExists() works correctly
  zip.folder('levels');
  zip.folder(base);
  zip.folder(`${base}/art`);
  zip.folder(`${base}/art/terrains`);
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
    spawnPoints: [{
      name: 'Default',
      objectname: 'spawn_default',
      preview: 'preview.png',
      translationId: 'Default Spawnpoint',
    }],
    title: `mapng ${lat}, ${lng}`,
  }, null, 2));

  // ── mainLevel.lua ──────────────────────────────────────────────────────────
  // Lua initialization script executed on level load. Expected by BeamNG's
  // level subsystem and the World Editor.
  zip.file(`${base}/mainLevel.lua`, [
    '-- Auto-generated by mapng',
    'local M = {}',
    '',
    'function M.onClientStartMission()',
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

  // ── theTerrain.ter ─────────────────────────────────────────────────────────
  zip.file(`${base}/theTerrain.ter`, terBlob);

  // ── theTerrain.terrainheightmap.png ────────────────────────────────────────
  // Grayscale heightmap preview used by BeamNG's terrain system and World Editor.
  // Capped at 2048px — the .ter binary holds the full-res data; this is display only.
  zip.file(`${base}/theTerrain.terrainheightmap.png`, heightmapBlob);
  heightmapBlob = null;

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
  ];
  if (decalRoads.length > 0) {
    missionGroupItems.push({ __parent: 'MissionGroup', class: 'SimGroup', name: 'Decal_roads', persistentId: generatePersistentId() });
  }
  zip.file(`${base}/main/MissionGroup/items.level.json`, toNDJSON(missionGroupItems));

  // ── main/MissionGroup/Decal_roads/items.level.json ─────────────────────────
  if (decalRoads.length > 0) {
    zip.folder(`${base}/main/MissionGroup/Decal_roads`);
    zip.file(`${base}/main/MissionGroup/Decal_roads/items.level.json`, toNDJSON(decalRoads));
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

  zip.file(`${base}/main/MissionGroup/Level_objects/Other/items.level.json`,
    toNDJSON(otherItems)
  );

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

  report('Compressing ZIP…', 93);
  await yield_();
  const zipBlob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE' });
  report('Done', 100);
  return { blob: zipBlob, filename: `${levelName}.zip` };
}
