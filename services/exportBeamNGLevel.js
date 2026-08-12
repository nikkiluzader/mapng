import * as THREE from 'three';
import JSZip from 'jszip';
import { encode } from 'fast-png';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { exportTer } from './exportTer.js';
import { buildTerrainMaterials } from './osmTerrainMaterials.js';
import { createOSMGroup, createSurroundingMeshes, SCENE_SIZE } from './export3d.js';
import { prepareCroppedTerrainData } from './cropTerrain.js';
import { applyBuildingFoundations } from './buildingFoundations.js';
import { ColladaExporter } from './ColladaExporter.js';
import { buildRoadNetwork, getEffectiveRoadLayer, makeRoadNodeKey, mergeLinearRoadSegments } from './roadNetwork.js';
import { createBeamNGLinkFileRegistry } from './beamngLinkFiles.js';
import { getBiomeRuntimeMaterialDefs } from './beamngRuntimeMaterialCatalog.js';
import { getFuelStationRuntimeMaterialDefs } from './beamngFuelStationMaterials.js';
import { validateBeamNGZipStructure } from './beamngExportConformance.js';
import { buildManualMapNavigationData, inferManualLaneData } from './beamngMapNavigation.js';
import { buildBeamNGSignalExportBundle } from './beamngSignals.js';
import {
  estimateRoadHalfWidth,
  getDefaultLaneCount,
  getDefaultLaneWidthMeters,
  isOneWayRoad,
  NON_DRIVEABLE_HIGHWAYS,
} from './roadWidth.js';
import {
  getBeamNGBiomeById,
  getGlobalEnvironmentMap,
  getGroundCoverProfile,
  getManagedForestTemplate,
  getRockCandidates,
  getShapeMaterialDefsForBiome,
  getStreetFurnitureProfile,
  getTrafficProfile,
  getWaterProfile,
  resolveBushType,
  resolveTreeTypeForTags,
} from './beamngBiomeCatalog.js';

const BEAMNG_EXPORT_SERVICE_LOG = '[BeamNG Export Service]';

/**
 * Sanitize user input to a deterministic BeamNG level id.
 * Rules: lowercase snake_case, no leading digit, max 64 chars.
 */
function sanitizeLevelId(name) {
  let sanitized = String(name || '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9_]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '');

  if (!sanitized) return 'mapng_level';
  if (/^[0-9]/.test(sanitized)) sanitized = `mapng_${sanitized}`;
  if (sanitized.length > 64) sanitized = sanitized.slice(0, 64).replace(/_+$/g, '');

  return sanitized || 'mapng_level';
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

/**
 * Check whether a {lat,lng} point lies inside inclusive geographic bounds.
 */
function pointInBounds(pt, bounds) {
  return (
    pt &&
    pt.lat <= bounds.north &&
    pt.lat >= bounds.south &&
    pt.lng >= bounds.west &&
    pt.lng <= bounds.east
  );
}

/**
 * Keep only OSM features whose geometry intersects the provided bounds.
 *
 * A feature is retained when at least one geometry point is in bounds.
 */
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
  // Prefer an explicit per-pixel ground resolution. Standard exports carry
  // `metersPerPixel`; custom elevation uploads carry `processingMetersPerPixel`
  // (the resolution the heightmap was resampled to). Either one ties the BeamNG
  // square size — and therefore the surrounding-backdrop scale, which is derived
  // from worldSize = size · squareSize — directly to the processing resolution.
  // Only when neither is present do we fall back to deriving it from bounds.
  const explicitMpp = [terrainData?.metersPerPixel, terrainData?.processingMetersPerPixel]
    .map(Number)
    .find((v) => Number.isFinite(v) && v > 0);
  if (explicitMpp != null) {
    return Math.round(explicitMpp * 100) / 100;
  }

  const { bounds, width } = terrainData;
  const centerLat = (bounds.north + bounds.south) / 2;
  const latRad = (centerLat * Math.PI) / 180;
  const metersPerDegreeLng = 111320 * Math.cos(latRad);
  const realWidthMeters = (bounds.east - bounds.west) * metersPerDegreeLng;
  return Math.round((realWidthMeters / width) * 100) / 100;
}

/**
 * BeamNG TerrainBlock expects square power-of-two terrain dimensions.
 * Pick the largest power-of-two that fits within the source dimensions.
 */
function computeBeamNGTerrainSize(width, height) {
  const minDim = Math.floor(Math.min(width, height));
  if (!Number.isFinite(minDim) || minDim < 2) return minDim;
  return 2 ** Math.floor(Math.log2(minDim));
}

// Map a BeamNG country key (e.g. "levels.common.country.usa") to an info.json
// `region` identifier and a sensible `roadRules.turnOnRed` default. Region is a
// camelCase identifier per Level-Metadata.md (e.g. "northAmerica"). turnOnRed is
// only commonly legal in North America; everything else defaults to the documented
// `false`.
const COUNTRY_REGION_MAP = [
  { match: /(usa|united_states|canada|mexico)/, region: 'northAmerica' },
  { match: /(brazil|argentina|chile|colombia|peru)/, region: 'southAmerica' },
  { match: /(japan|china|korea|india|thailand|indonesia|singapore)/, region: 'asia' },
  { match: /(australia|new_zealand)/, region: 'oceania' },
  { match: /(egypt|nigeria|kenya|south_africa|morocco)/, region: 'africa' },
  // Default bucket for the many European country keys (italy, germany, france, …).
  { match: /(italy|germany|france|spain|uk|united_kingdom|england|netherlands|belgium|sweden|norway|poland|austria|switzerland|europe)/, region: 'europe' },
];

function getRegionForCountry(country) {
  const key = String(country ?? '').toLowerCase();
  for (const { match, region } of COUNTRY_REGION_MAP) {
    if (match.test(key)) return region;
  }
  return 'northAmerica';
}

function getTurnOnRedForCountry(country) {
  // Right-turn-on-red is broadly legal in the US/Canada and rare elsewhere.
  return /(usa|united_states|canada)/.test(String(country ?? '').toLowerCase());
}

// Self-contained level ground models (Ground-Models.md). The terrain materials
// emitted by the OSM painter link each layer to one of these via
// `groundmodelName` (GRASS/DIRT/SAND/ROCK/ASPHALT/GRAVEL/MUD), and DecalRoads
// project onto the terrain — so the terrain material under a road determines its
// physics surface. That is the OSM `surface=*` → ground-model mapping.
//
// Values mirror the vanilla `/art/groundmodels.json` definitions verbatim, so
// shipping them changes no physics behavior; the benefit is a self-contained mod
// that does not depend on global ground-model names existing (the doc-recommended
// pattern). ASPHALT keeps its `groundmodel_asphalt1` alias so the non-PBR fallback
// resolves locally too.
const MAPNG_GROUND_MODELS = {
  ASPHALT: {
    staticFrictionCoefficient: 0.98, slidingFrictionCoefficient: 0.70,
    hydrodynamicFriction: 0, stribeckVelocity: 4.5, strength: 1,
    roughnessCoefficient: 0, defaultDepth: 0, collisiontype: 'ASPHALT',
    skidMarks: true, aliases: ['groundmodel_asphalt1', 'grid', 'concrete', 'concrete2'],
  },
  GRASS: {
    staticFrictionCoefficient: 0.61, slidingFrictionCoefficient: 0.65,
    hydrodynamicFriction: 0.005, stribeckVelocity: 4, strength: 1,
    roughnessCoefficient: 0.43, fluidDensity: 8000, flowConsistencyIndex: 1500,
    flowBehaviorIndex: 0.7, dragAnisotropy: 0, shearStrength: 4000,
    defaultDepth: 0.05, collisiontype: 'GRASS', skidMarks: false,
    aliases: ['grass', 'grass2', 'grass3', 'grass4', 'forest', 'forest_floor'],
  },
  DIRT: {
    staticFrictionCoefficient: 0.70, slidingFrictionCoefficient: 0.73,
    hydrodynamicFriction: 0.0067, stribeckVelocity: 5, strength: 1,
    roughnessCoefficient: 0.42, fluidDensity: 14000, flowConsistencyIndex: 2100,
    flowBehaviorIndex: 0.75, dragAnisotropy: 0.5, shearStrength: 2500,
    defaultDepth: 0, collisiontype: 'DIRT', skidMarks: false,
    aliases: ['dirt_grass', 'derby_dirt'],
  },
  GRAVEL: {
    staticFrictionCoefficient: 0.69, slidingFrictionCoefficient: 0.74,
    hydrodynamicFriction: 0.0072, stribeckVelocity: 6, strength: 1,
    roughnessCoefficient: 0.44, fluidDensity: 16000, flowConsistencyIndex: 2500,
    flowBehaviorIndex: 0.75, dragAnisotropy: 0.5, shearStrength: 4000,
    defaultDepth: 0, collisiontype: 'GRAVEL', skidMarks: false,
    aliases: ['dirt_loose'],
  },
  ROCK: {
    staticFrictionCoefficient: 0.93, slidingFrictionCoefficient: 0.65,
    hydrodynamicFriction: 0, stribeckVelocity: 4, strength: 1,
    roughnessCoefficient: 0.15, defaultDepth: 0, collisiontype: 'ROCK',
    skidMarks: false, aliases: ['rock_cliff', 'rocks_large'],
  },
  SAND: {
    staticFrictionCoefficient: 0.6, slidingFrictionCoefficient: 0.6,
    hydrodynamicFriction: 0.02, stribeckVelocity: 6, strength: 1,
    roughnessCoefficient: 0.5, fluidDensity: 25000, flowConsistencyIndex: 5000,
    flowBehaviorIndex: 0.25, dragAnisotropy: 0.5, shearStrength: 12000,
    defaultDepth: 0.1, collisiontype: 'SAND', skidMarks: false,
    aliases: ['beachsand', 'sandtrap'],
  },
  MUD: {
    staticFrictionCoefficient: 0.55, slidingFrictionCoefficient: 0.55,
    hydrodynamicFriction: 0.01, stribeckVelocity: 6, strength: 1,
    roughnessCoefficient: 0.5, fluidDensity: 7000, flowConsistencyIndex: 2000,
    flowBehaviorIndex: 0.5, dragAnisotropy: 0.75, shearStrength: 4000,
    defaultDepth: 0.15, collisiontype: 'MUD', skidMarks: false,
  },
};

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
 *   'none'            — flat neutral color
 *   'hybrid'          — satellite + road overlay (default)
 *   'satellite'       — plain satellite imagery
 *   'osm'             — procedural OSM texture
 *   'painted'         — user-touched-up texture from the paint editor
 *                       (falls back to the hybrid chain if missing)
 *
 * Falls back to the grey 64×64 placeholder if the requested texture is
 * unavailable. Always re-encodes as PNG.
 */
async function getTerrainTextureBlob(terrainData, textureType = 'hybrid') {
  try {
    if (textureType === 'none') {
      const canvas = document.createElement('canvas');
      canvas.width = 64;
      canvas.height = 64;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#808080';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      return new Promise(r => canvas.toBlob(r, 'image/png'));
    }
    if (textureType === 'painted' && terrainData.paintedTextureBlob) {
      return terrainData.paintedTextureBlob;
    }
    if (textureType === 'hybrid' || textureType === 'painted') {
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
 * Generate a 16-bit grayscale heightmap PNG at the terrain's native resolution.
 * Written as {terrainName}.terrainheightmap.png alongside the .ter file.
 * Referenced by terrain.terrain.json as "heightmapImage" — used by BeamNG's
 * terrain system internally (minimap display, editor visualization).
 *
 * 16-bit matters: Terrain-Files.md §Heightmap import reads R16 images directly
 * as u16 height data, so we quantize with the SAME ceil-based scale as the .ter
 * writer (exportTer.js) — re-importing this image in the World Editor restores
 * the terrain losslessly. An 8-bit image would quantize a 500 m range to ~2 m
 * steps and produce visibly terraced terrain on re-import.
 */
async function generateHeightmapPng(terrainData, maxSize = Number.POSITIVE_INFINITY) {
  const { width, height, heightMap, minHeight, maxHeight } = terrainData;
  const safeMaxSize = Number.isFinite(maxSize) && maxSize > 0 ? maxSize : Number.POSITIVE_INFINITY;
  const outW = Math.min(width, safeMaxSize);
  const outH = Math.min(height, safeMaxSize);
  const scaleX = width  / outW;
  const scaleY = height / outH;

  // Same quantization as exportTer.js: stored = (h - min) × 65536 / ceil(range),
  // matching the TerrainBlock decode stored × maxHeight / 65536.
  const range = maxHeight - minHeight;
  const blockMaxHeight = Math.max(1, Math.ceil(range));
  const heightScale = 65536 / blockMaxHeight;

  const data = new Uint16Array(outW * outH);
  for (let y = 0; y < outH; y++) {
    const srcY = Math.min(height - 1, Math.round(y * scaleY));
    for (let x = 0; x < outW; x++) {
      const srcX = Math.min(width - 1, Math.round(x * scaleX));
      let val = Math.floor((heightMap[srcY * width + srcX] - minHeight) * heightScale);
      if (!Number.isFinite(val)) val = 0;
      data[y * outW + x] = Math.max(0, Math.min(65535, val));
    }
  }

  const pngData = encode({ width: outW, height: outH, data, depth: 16, channels: 1 });
  return new Blob([new Uint8Array(pngData)], { type: 'image/png' });
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
    // Signs are placed as native BeamNG sign assets (see buildNativeSignObjects),
    // so don't bake the procedural sign boxes into the generic OSM mesh.
    includeSigns: false,
    // Street furniture (lamps, benches, bollards) is 3D-preview-only geometry;
    // lamps and benches ship as native game assets (buildStreetFurnitureObjects).
    includeStreetFurniture: false,
    // Keep exact building footprints in exported levels.
    simplifyBuildingFootprints: false,
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

  let buildingCollisionMesh = null;

  osmGroup.traverse(child => {
    if (!child.isMesh) return;

    // Bake the coordinate transform into each geometry's vertex data first.
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

    // Clone the already-transformed building geometry as the collision mesh.
    // Must be cloned AFTER applyMatrix4 so it is in BeamNG world coordinates.
    // BeamNG identifies collision geometry by the <geometry id> starting with "Col".
    const isBuildingMesh = String(child.name || '').toLowerCase() === 'buildings';
    if (isBuildingMesh && !buildingCollisionMesh) {
      const collisionGeom = child.geometry.clone();
      collisionGeom.name = 'Colmesh-1';
      buildingCollisionMesh = new THREE.Mesh(
        collisionGeom,
        new THREE.MeshBasicMaterial({ name: 'osm_object', color: 0xffffff }),
      );
      buildingCollisionMesh.name = 'Colmesh-1';
    }
  });

  // Always wrap in the BeamNG scene hierarchy:
  // Working BeamNG structure (matches flag reference asset):
  //   base00 > start01 > [visual meshes] + Colmesh-1
  // base00 must be the TOP-LEVEL node directly inside <visual_scene>.
  // Passing a THREE.Scene to the exporter would wrap base00 in an extra
  // unnamed node, breaking BeamNG's strict node-depth requirements.
  const base00 = new THREE.Group();
  base00.name = 'base00';
  const start01 = new THREE.Group();
  start01.name = 'start01';
  start01.add(osmGroup);
  if (buildingCollisionMesh) start01.add(buildingCollisionMesh);
  base00.add(start01);

  // Compute world matrices with base00 as the root (not a Scene).
  base00.updateMatrixWorld(true);

  // Pass base00 directly so it becomes the top-level node in <visual_scene>,
  // matching the reference flag asset structure.
  const result = new ColladaExporter().parse(base00, undefined, { version: '1.4.1', upAxis: 'Z_UP' });
  if (!result?.data) return null;
  return result.data;
}

/**
 * Generate a collision-only Collada (.dae) for OSM buildings.
 *
 * BeamNG can be picky when visual + collision meshes are mixed in a single
 * object graph. This emits a dedicated Colmesh-only DAE and is referenced by a
 * hidden TSStatic collision object in the level scene.
 */
async function generateOSMBuildingsCollisionDAE(terrainData, worldSize) {
  if (!terrainData?.osmFeatures?.length) return null;

  const buildings = terrainData.osmFeatures.filter((feature) => (
    feature?.type === 'building' && Array.isArray(feature.geometry) && feature.geometry.length >= 3
  ));
  if (buildings.length === 0) return null;

  const parseHeightMeters = (tags = {}) => {
    const parseNum = (value) => {
      if (value === undefined || value === null) return NaN;
      const raw = String(value).trim().toLowerCase();
      if (!raw) return NaN;
      if (raw.includes('ft')) {
        const ft = Number.parseFloat(raw.replace('ft', '').trim());
        return Number.isFinite(ft) && ft > 0 ? ft * 0.3048 : NaN;
      }
      const m = Number.parseFloat(raw.replace('m', '').trim());
      return Number.isFinite(m) && m > 0 ? m : NaN;
    };

    const explicitHeight = parseNum(tags.height);
    if (Number.isFinite(explicitHeight)) return Math.min(220, Math.max(2.5, explicitHeight));

    const levels = Number.parseFloat(tags['building:levels'] ?? tags.levels);
    if (Number.isFinite(levels) && levels > 0) {
      const roof = Number.parseFloat(tags['roof:levels'] ?? tags['building:roof:levels'] ?? 0);
      return Math.min(220, Math.max(2.5, (levels + Math.max(0, roof)) * 3.1));
    }

    const type = String(tags.building || '').toLowerCase();
    if (['industrial', 'warehouse', 'retail', 'commercial'].includes(type)) return 10;
    if (['garage', 'hut', 'shed'].includes(type)) return 4;
    return 7.5;
  };

  const proxyGeometries = [];
  const maxCollisionProxies = 12000;
  const squareSize = worldSize / terrainData.width;

  for (let i = 0; i < buildings.length && proxyGeometries.length < maxCollisionProxies; i++) {
    const feature = buildings[i];
    const geometry = Array.isArray(feature.geometry) ? feature.geometry : [];
    if (geometry.length < 3) continue;

    let ring = geometry;
    if (geometry.length > 3) {
      const first = geometry[0];
      const last = geometry[geometry.length - 1];
      if (first?.lat === last?.lat && first?.lng === last?.lng) {
        ring = geometry.slice(0, -1);
      }
    }
    if (ring.length < 3) continue;

    const worldPoints = ring.map((pt) => geoToWorldPoint(pt.lat, pt.lng, terrainData, squareSize, 0));

    let minX = Number.POSITIVE_INFINITY;
    let maxX = Number.NEGATIVE_INFINITY;
    let minY = Number.POSITIVE_INFINITY;
    let maxY = Number.NEGATIVE_INFINITY;
    let minTerrainZ = Number.POSITIVE_INFINITY;

    for (let p = 0; p < worldPoints.length; p++) {
      const [x, y, z] = worldPoints[p];
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
      minTerrainZ = Math.min(minTerrainZ, z);
    }

    if (!Number.isFinite(minX) || !Number.isFinite(minY) || !Number.isFinite(minTerrainZ)) continue;

    const spanX = Math.max(0.8, maxX - minX);
    const spanY = Math.max(0.8, maxY - minY);
    const heightZ = parseHeightMeters(feature.tags || {});
    const centerX = (minX + maxX) * 0.5;
    const centerY = (minY + maxY) * 0.5;
    const centerZ = minTerrainZ + (heightZ * 0.5);

    // BoxGeometry axes are X/Y/Z; we map directly to BeamNG world X/Y/Z.
    const box = new THREE.BoxGeometry(spanX, spanY, heightZ);
    box.translate(centerX, centerY, centerZ);
    proxyGeometries.push(box.index ? box.toNonIndexed() : box);
  }

  if (proxyGeometries.length === 0) return null;

  const mergedCollisionGeometry = mergeGeometries(proxyGeometries, false);
  proxyGeometries.forEach((g) => g.dispose());
  if (!mergedCollisionGeometry) return null;

  // Name the geometry so ColladaExporter generates id="Colmesh-1-mesh" —
  // BeamNG identifies collision geometry by the <geometry> element's id
  // starting with "Col" (matches the same convention as the node name).
  mergedCollisionGeometry.name = 'Colmesh-1';

  const collisionMesh = new THREE.Mesh(
    mergedCollisionGeometry,
    new THREE.MeshBasicMaterial({ color: 0xffffff }),
  );
  collisionMesh.name = 'Colmesh-1';
  collisionMesh.material.name = 'osm_object';

  const base00 = new THREE.Group();
  base00.name = 'base00';
  const collisionMarker = new THREE.Group();
  collisionMarker.name = 'collision-1';
  const start01 = new THREE.Group();
  start01.name = 'start01';
  start01.add(collisionMesh);
  base00.add(collisionMarker);
  base00.add(start01);

  const scene = new THREE.Scene();
  scene.add(base00);
  scene.updateMatrixWorld(true);

  const result = new ColladaExporter().parse(scene, undefined, { version: '1.4.1', upAxis: 'Z_UP' });
  if (!result?.data) return null;
  return result.data;
}

/**
 * Build the terrain-backdrop material library (main.materials.json contents).
 *
 * Each surrounding tile mesh references a `backdrop_<pos>` material by name; the
 * DAE carries only names, so every referenced material MUST be defined here or
 * BeamNG renders the magenta "NO TEXTURE" placeholder on that tile. Tiles whose
 * satellite imagery downloaded get a textured material; any referenced tile
 * without a texture (e.g. a failed satellite fetch) gets a flat ground-colored
 * material so it still blends in.
 *
 * @param {string} levelName
 * @param {Array<{name:string, ext:string}>} textureFiles  exported tile textures
 * @param {string[]} materialNames  every `backdrop_<pos>` the mesh references
 * @returns {Object} material-name → material def
 */
export function buildBackdropMaterialDefs(levelName, textureFiles = [], materialNames = []) {
  const defs = {};

  for (const tex of textureFiles) {
    defs[tex.name] = {
      class: 'Material',
      name: tex.name,
      mapTo: tex.name,
      annotation: 'TERRAIN',
      Stages: [{
        diffuseMap: `levels/${levelName}/map_assets/custom_assets/terrain_backdrop/Textures/${tex.name}.${tex.ext}`,
        diffuseColor: [1, 1, 1, 1],
      }],
      translucentBlendOp: 'None',
    };
  }

  const referenced = materialNames.length > 0 ? materialNames : ['backdrop_terrain'];
  for (const matName of referenced) {
    if (defs[matName]) continue;
    defs[matName] = {
      class: 'Material',
      name: matName,
      mapTo: matName,
      annotation: 'TERRAIN',
      Stages: [{ diffuseColor: [0.55, 0.5, 0.45, 1] }],
      translucentBlendOp: 'None',
    };
  }

  return defs;
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
async function generateTerrainBackdropDAE(terrainData, worldSize, options = {}) {
  // Zoom 15 gives ~4m/px satellite imagery; 1024px cap avoids canvas-size
  // failures at large resolutions while still giving usable texture quality.
  const surroundingGroup = await createSurroundingMeshes(terrainData, null, 128, {
    fetchResolutionCap: 1024,
    includeSatellite: true,
    satelliteZoom: 15,
    elevationSource: options.elevationSource || 'global30m',
    gpxzApiKey: options.gpxzApiKey || '',
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

  // Every backdrop mesh references a `backdrop_<pos>` material by name; the DAE
  // carries only the name, so each one must have a matching def in the level's
  // main.materials.json or BeamNG renders the "NO TEXTURE" placeholder. Collect
  // the full set here so the writer can backfill a flat-color material for any
  // tile whose satellite imagery failed to download/attach.
  const materialNames = new Set();
  surroundingGroup.traverse(child => {
    if (!child.isMesh) return;

    // Derive tile position name from mesh name (e.g. "terrain_NW" → "NW").
    const pos = child.name.replace('terrain_', '') || 'tile';
    const matName = `backdrop_${pos}`;
    materialNames.add(matName);

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
    materialNames: [...materialNames],
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

// Target spacing (metres) for road nodes.  OSM way geometry is irregular —
// ~1–2 m in dense urban areas but often 20–50 m+ on rural straightaways, where
// a vertex is only dropped at curves.  We resample every road centerline to this
// uniform spacing BEFORE converting to world space, so that (a) the spline never
// draws a long straight chord between sparse vertices, and (b) every node samples
// the real terrain height at its own position (via geoToWorld) and the road hugs
// the terrain instead of floating over valleys / cutting through crests.
const ROAD_NODE_SPACING_M = 2.0;
const JUNCTION_MARKING_TRIM_M = 4.0;

// Crossing roads of these classes should NOT cause lane markings to be trimmed
// back — a driveway or footpath meeting a road doesn't interrupt its paint.
const MINOR_CROSSING_HIGHWAYS = new Set([
  'service', 'track', 'footway', 'path', 'cycleway', 'bridleway',
  'steps', 'pedestrian', 'corridor', 'living_street',
]);

/**
 * Resample a lat/lng polyline to a uniform arc-length spacing (in metres).
 *
 * Distances are measured with a local equirectangular approximation at the
 * polyline's mean latitude — accurate to well under a centimetre over the few
 * kilometres an exported tile spans.  The first vertex is always preserved and
 * the exact final vertex is appended (so the road reaches its real endpoints);
 * every interior point is placed `spacingM` metres along the path.  Densifies
 * sparse straightaways AND thins over-dense urban geometry in one pass.
 *
 * Input/return: array of { lat, lng } (any extra fields on points are dropped).
 */
function resampleGeometryToSpacing(geometry, spacingM) {
  if (!Array.isArray(geometry) || geometry.length < 2 || !(spacingM > 0)) return geometry;

  const meanLat = geometry.reduce((sum, p) => sum + p.lat, 0) / geometry.length;
  const mPerDegLat = 111320;
  const mPerDegLng = 111320 * Math.cos((meanLat * Math.PI) / 180);
  const dist = (a, b) => Math.hypot(
    (b.lng - a.lng) * mPerDegLng,
    (b.lat - a.lat) * mPerDegLat,
  );

  const out = [{ lat: geometry[0].lat, lng: geometry[0].lng }];
  let prev = geometry[0];
  let distSinceLast = 0; // metres accumulated since the last emitted point

  for (let i = 1; i < geometry.length; i++) {
    const curr = geometry[i];
    let segLen = dist(prev, curr);
    while (distSinceLast + segLen >= spacingM) {
      const need = spacingM - distSinceLast; // distance from `prev` to the new point
      const t = segLen > 1e-9 ? need / segLen : 0;
      const np = {
        lat: prev.lat + (curr.lat - prev.lat) * t,
        lng: prev.lng + (curr.lng - prev.lng) * t,
      };
      out.push(np);
      prev = np;
      segLen = dist(prev, curr);
      distSinceLast = 0;
    }
    distSinceLast += segLen;
    prev = curr;
  }

  // Append the exact final vertex unless the last emitted point already lands on it.
  const last = geometry[geometry.length - 1];
  if (dist(out[out.length - 1], last) > 1e-6) {
    out.push({ lat: last.lat, lng: last.lng });
  }
  return out;
}

function trimNodesByDistance(nodes, trimStartM = 0, trimEndM = 0) {
  if (!Array.isArray(nodes) || nodes.length < 2) return [];
  const totalTrim = Math.max(0, trimStartM) + Math.max(0, trimEndM);
  if (totalTrim <= 0) return nodes;

  const segLen = [];
  const cumLen = [0];
  let total = 0;
  for (let i = 1; i < nodes.length; i++) {
    const dx = nodes[i][0] - nodes[i - 1][0];
    const dy = nodes[i][1] - nodes[i - 1][1];
    const len = Math.hypot(dx, dy);
    segLen.push(len);
    total += len;
    cumLen.push(total);
  }

  if (total <= totalTrim + 0.25) return [];

  const startD = Math.max(0, trimStartM);
  const endD = Math.max(startD, total - Math.max(0, trimEndM));

  const sampleAtDistance = (dist) => {
    if (dist <= 0) return [...nodes[0]];
    if (dist >= total) return [...nodes[nodes.length - 1]];
    for (let i = 1; i < nodes.length; i++) {
      if (cumLen[i] < dist) continue;
      const prevDist = cumLen[i - 1];
      const local = segLen[i - 1] > 1e-6 ? (dist - prevDist) / segLen[i - 1] : 0;
      return [
        nodes[i - 1][0] + (nodes[i][0] - nodes[i - 1][0]) * local,
        nodes[i - 1][1] + (nodes[i][1] - nodes[i - 1][1]) * local,
        nodes[i - 1][2] + (nodes[i][2] - nodes[i - 1][2]) * local,
        nodes[i - 1][3] + (nodes[i][3] - nodes[i - 1][3]) * local,
      ];
    }
    return [...nodes[nodes.length - 1]];
  };

  const trimmed = [sampleAtDistance(startD)];
  for (let i = 1; i < nodes.length - 1; i++) {
    const d = cumLen[i];
    if (d > startD && d < endD) trimmed.push(nodes[i]);
  }
  trimmed.push(sampleAtDistance(endD));

  // Interior nodes are already uniformly spaced; only the two endpoints were
  // resampled to the trim distances, so return as-is (no decimation).
  return trimmed;
}

// All names below are BeamNG's GLOBAL ("m_") road material library, shipped with
// the base game (verified against base levels: they are referenced by DecalRoads
// but never defined inside any level zip, i.e. they live in core /art/road).
// Using them keeps exported levels self-contained without redistributing the
// per-level road textures (t_asphalt_variation_*, etc.).
// IMPORTANT: only materials that exist in BeamNG's CORE install resolve in an
// exported level — most named asphalt/dirt surfaces (m_road_variation_01,
// m_asphalt_cracks, m_dirt_road, …) are actually defined per-level and ship
// their own textures, so referencing them yields "NO MATERIAL" at runtime.
//
// Confirmed-core (resolve with no extra assets):
//   - DefaultDecalRoadMaterial : the engine's built-in road surface (asphalt).
//   - road_invisible           : invisible placeholder surface.
//   - m_line_white / m_line_yellow_double / m_line_white_discontinue : lane paint.
//   - m_road_asphalt_edge_grass : asphalt→grass edge blend.
// The road surface uses DefaultDecalRoadMaterial so roads have a real, crisp,
// tiling asphalt independent of the baked base-texture resolution.
const GLOBAL_DECAL_MATERIALS = {
  invisible: 'road_invisible',
  asphalt: 'DefaultDecalRoadMaterial',   // core built-in asphalt road surface
  lineWhite: 'm_line_white',
  lineYellowDouble: 'm_line_yellow_double',
  lineYellowSingle: 'm_line_yellow',
  lineWhiteDashed: 'm_line_white_discontinue',
  edgeAsphaltGrass: 'm_road_asphalt_edge_grass',
  dirtRoad: 'DefaultDecalRoadMaterial',  // no core dirt surface exists; use default road
};

// Decal Road Layer Templates.
//
// Each road is built from several overlapping DecalRoads, matching how base-game
// levels (Italy/ECA) compose roads. Field conventions, derived from real ECA roads:
//   - renderPriority: LOWER renders ON TOP. Lines (1-2) sit above the asphalt
//     surface (14); the optional damage overlay (12) sits just above asphalt.
//   - textureLength: metres the material tiles along the road. Asphalt ~100 to
//     avoid obvious repetition; painted lines 6.4 (dash pattern); edge blends ~8.
//   - breakAngle: spline subdivision threshold (asphalt 2°, thin layers 1°).
//   - startEndFadeMag: fade length applied ONLY at a road's true termini (not at
//     internal chunk joins — see getLayeredRoadDecals), so chunking stays seamless.
//   - distanceFade: [start, end] LOD fade in metres for the big asphalt surface.
//   - drivability: 1 marks the surface as an AI/navigation road (DecalRoad nav).
//
// Geometry: 'widthScale' makes a layer span the full corridor (2 × halfWidth);
// literal 'width' is a full metric width (lines/edge strips). Offsets are in
// halfWidth multiples for edge-relative layers, metres otherwise.
const ASPHALT_BASE = {
  name: 'asphalt', material: GLOBAL_DECAL_MATERIALS.asphalt,
  widthScale: 2.0, offset: 0,
  // DefaultDecalRoadMaterial's texture tiles best around the engine default
  // (~10 m); long lengths (ECA used 100 for its bespoke texture) would stretch it.
  renderPriority: 14, textureLength: 10, breakAngle: 2,
  startEndFadeMag: 4, distanceFade: [250, 150], drivability: 1,
};
const EDGE_BLEND = (width) => ([
  { name: 'edge_left', material: GLOBAL_DECAL_MATERIALS.edgeAsphaltGrass, width, offset: -1.0, isEdge: true, mirrorByReversingNodes: true,
    renderPriority: 9, textureLength: 8, breakAngle: 1, startEndFadeMag: 1 },
  { name: 'edge_right', material: GLOBAL_DECAL_MATERIALS.edgeAsphaltGrass, width, offset: 1.0, isEdge: true,
    renderPriority: 9, textureLength: 8, breakAngle: 1, startEndFadeMag: 1 },
]);

// Line markings (center/edge/lane-separator paint) are NOT part of the static
// templates — they depend on oneway/lanes tags and are built per corridor by
// buildLineMarkingLayers().
const ROAD_TEMPLATES = {
  default: [
    ASPHALT_BASE,
    ...EDGE_BLEND(2.0),
  ],
  major: [
    ASPHALT_BASE,
    ...EDGE_BLEND(2.5),
  ],
  minor: [
    ASPHALT_BASE,
    ...EDGE_BLEND(2.0),
  ],
  unpaved: [
    { name: 'dirt', material: GLOBAL_DECAL_MATERIALS.dirtRoad, widthScale: 2.2, offset: 0,
      renderPriority: 14, textureLength: 10, breakAngle: 1, startEndFadeMag: 3, drivability: 1 },
  ],
};

// Base (asphalt/dirt) surface render priority per highway class. LOWER renders
// ON TOP, so major roads (13) paint over the minor/service roads (15-16) they
// overlap at junctions and parking-lot mouths, instead of an arbitrary winner.
const SURFACE_RENDER_PRIORITY = {
  motorway: 13, motorway_link: 13,
  trunk: 13, trunk_link: 13,
  primary: 13, primary_link: 13,
  secondary: 14, secondary_link: 14,
  tertiary: 14, tertiary_link: 14,
  residential: 14, living_street: 14, unclassified: 14, road: 14, busway: 14,
  raceway: 14,
  service: 15, track: 15,
};

function getSurfaceRenderPriority(highway) {
  return SURFACE_RENDER_PRIORITY[highway] ?? 14;
}

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
  track:          { width: 4, edgeMaterial: GLOBAL_DECAL_MATERIALS.edgeAsphaltGrass },
};

const DEFAULT_ROAD_STYLE = { width: 3, edgeMaterial: GLOBAL_DECAL_MATERIALS.edgeAsphaltGrass };

const STABLE_DECAL_WIDTH_HIGHWAYS = new Set([
  'motorway',
  'motorway_link',
  'trunk',
  'trunk_link',
  'primary',
  'primary_link',
  'secondary',
  'secondary_link',
]);

function getDecalMergeStyleKey(segment) {
  const tags = segment?.tags || {};
  return JSON.stringify([
    segment?.highway || tags.highway || '',
    segment?.layer ?? getEffectiveRoadLayer(tags),
    tags.name || '',
    tags.ref || '',
    tags.oneway || '',
    tags.surface || '',
  ]);
}

function getDecalWidthCorridorKey(segment) {
  const tags = segment?.tags || {};
  return JSON.stringify([
    segment?.highway || tags.highway || '',
    segment?.layer ?? getEffectiveRoadLayer(tags),
    tags.name || '',
    tags.ref || '',
    tags.oneway || '',
  ]);
}

function buildStableDecalHalfWidthMap(roads = []) {
  const widthGroups = new Map();

  for (const road of roads) {
    const tags = road?.tags || {};
    const highway = tags.highway || road?.highway;
    if (!STABLE_DECAL_WIDTH_HIGHWAYS.has(highway)) continue;

    const members = Array.isArray(road.members) && road.members.length > 0 ? road.members : [road];
    const key = getDecalWidthCorridorKey(road);
    const widths = widthGroups.get(key) || [];
    for (const member of members) {
      const memberTags = member?.tags || {};
      const isOneWay = isOneWayRoad(memberTags);
      const style = HIGHWAY_STYLE[highway] ?? DEFAULT_ROAD_STYLE;
      const halfWidth = estimateRoadHalfWidth(memberTags, highway, isOneWay, style.width);
      if (Number.isFinite(halfWidth) && halfWidth > 0) widths.push(halfWidth);
    }
    widthGroups.set(key, widths);
  }

  const stableMap = new Map();
  for (const [key, widths] of widthGroups.entries()) {
    if (widths.length === 0) continue;
    const [highway] = JSON.parse(key);
    const laneWidth = getDefaultLaneWidthMeters(highway);
    const minWidth = Math.min(...widths);
    const maxWidth = Math.max(...widths);
    // Keep a constant width only when variation is likely from OSM segmentation,
    // not from an actual multi-lane transition.
    if ((maxWidth - minWidth) <= laneWidth) {
      stableMap.set(key, maxWidth);
    }
  }

  return stableMap;
}

function getMergedRoadRenderTags(segmentFeature) {
  const sourceTags = segmentFeature?.sourceFeature?.tags || {};
  const members = Array.isArray(segmentFeature?.members) && segmentFeature.members.length > 0
    ? segmentFeature.members
    : [segmentFeature];
  const memberTags = members.map((member) => member?.tags || {});
  const highway = segmentFeature?.highway || sourceTags.highway;

  const laneMarkingsWanted = memberTags.some((tags) => shouldUseLaneMarkings(highway, tags));
  const grassEdgeWanted = memberTags.some((tags) => shouldUseGrassEdgeBlend(highway, tags));

  const renderTags = { ...sourceTags };
  if (laneMarkingsWanted) {
    // Merged corridors should retain lane paint when any member segment called for it.
    renderTags.lane_markings = 'yes';
  }
  if (grassEdgeWanted) {
    const surface = String(renderTags.surface ?? '').trim().toLowerCase();
    if (surface && UNPAVED_SURFACES.has(surface)) {
      delete renderTags.surface;
    }
  }

  return renderTags;
}

function normalizeGeoVector(from, to) {
  if (!from || !to) return null;
  const avgLatRad = (((from.lat || 0) + (to.lat || 0)) * 0.5 * Math.PI) / 180;
  const vx = ((to.lng || 0) - (from.lng || 0)) * Math.cos(avgLatRad);
  const vy = (to.lat || 0) - (from.lat || 0);
  const len = Math.hypot(vx, vy);
  if (len < 1e-12) return null;
  return { x: vx / len, y: vy / len };
}

function getSegmentEndpointDirection(segmentFeature, isStart) {
  const geometry = segmentFeature?.geometry;
  if (!Array.isArray(geometry) || geometry.length < 2) return null;
  if (isStart) {
    return normalizeGeoVector(geometry[0], geometry[1]);
  }
  return normalizeGeoVector(geometry[geometry.length - 1], geometry[geometry.length - 2]);
}

function getEntryEndpointDirection(entry) {
  const geometry = entry?.road?.geometry;
  if (!Array.isArray(geometry) || geometry.length < 2) return null;
  if (entry.isStart) {
    return normalizeGeoVector(geometry[0], geometry[1]);
  }
  return normalizeGeoVector(geometry[geometry.length - 1], geometry[geometry.length - 2]);
}

function getEndpointTrimProfile(segmentFeature, nodeKey, isStart, intersections) {
  const empty = { center: 0, pos: 0, neg: 0 };
  if (!nodeKey || !intersections?.has(nodeKey)) return empty;

  const entries = intersections.get(nodeKey) || [];
  if (entries.length < 2) return empty;

  const selfDir = getSegmentEndpointDirection(segmentFeature, isStart);
  if (!selfDir) {
    return {
      center: JUNCTION_MARKING_TRIM_M,
      pos: JUNCTION_MARKING_TRIM_M,
      neg: JUNCTION_MARKING_TRIM_M,
    };
  }

  const members = Array.isArray(segmentFeature?.members) && segmentFeature.members.length > 0
    ? segmentFeature.members
    : [segmentFeature];
  const memberIds = new Set(members.map((member) => member?.id).filter(Boolean));
  if (segmentFeature?.id) memberIds.add(segmentFeature.id);

  const others = [];
  for (const entry of entries) {
    const otherId = entry?.road?.id;
    if (otherId && memberIds.has(otherId)) continue;
    // Ignore minor connectors (driveways, paths, …) — they shouldn't break paint.
    const otherHighway = entry?.road?.highway || entry?.road?.tags?.highway || '';
    if (MINOR_CROSSING_HIGHWAYS.has(otherHighway)) continue;
    const dir = getEntryEndpointDirection(entry);
    if (!dir) continue;
    const dotAgainstBack = (-selfDir.x * dir.x) + (-selfDir.y * dir.y);
    others.push({ dir, dotAgainstBack });
  }

  if (others.length === 0) {
    // Only minor connectors (or degenerate geometry) meet here — keep paint running.
    return empty;
  }

  let continuationIndex = -1;
  let continuationDot = -Infinity;
  for (let i = 0; i < others.length; i++) {
    if (others[i].dotAgainstBack > continuationDot) {
      continuationDot = others[i].dotAgainstBack;
      continuationIndex = i;
    }
  }
  const hasContinuation = continuationDot > 0.82;

  let hasPosBranch = false;
  let hasNegBranch = false;
  const CROSS_EPS = 0.08;

  for (let i = 0; i < others.length; i++) {
    if (hasContinuation && i === continuationIndex) continue;
    const dir = others[i].dir;
    const cross = (selfDir.x * dir.y) - (selfDir.y * dir.x);
    if (cross > CROSS_EPS) hasNegBranch = true;
    else if (cross < -CROSS_EPS) hasPosBranch = true;
    else {
      hasPosBranch = true;
      hasNegBranch = true;
    }
  }

  const trimCenter = !hasContinuation || (hasPosBranch && hasNegBranch);
  return {
    center: trimCenter ? JUNCTION_MARKING_TRIM_M : 0,
    pos: hasPosBranch ? JUNCTION_MARKING_TRIM_M : 0,
    neg: hasNegBranch ? JUNCTION_MARKING_TRIM_M : 0,
  };
}

// OSM highway types to exclude from road generation (non-vehicle ways).
const ROAD_SKIP = NON_DRIVEABLE_HIGHWAYS;

// Major roads receive full markings (double-yellow centre + white edge lines).
const MAJOR_ROAD_MARKINGS = new Set([
  'motorway', 'motorway_link',
  'trunk', 'trunk_link',
  'primary', 'primary_link',
  'secondary', 'secondary_link',
]);

// Mid-tier roads get a lighter dashed-centre marking (no edge lines).
const MINOR_MARKED_HIGHWAYS = new Set([
  'tertiary', 'tertiary_link',
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

/**
 * Infer that a road should not receive lane paint from OSM tags.
 *
 * Explicit lane_markings=no always disables paint. Unpaved surfaces are also
 * treated as unmarked unless tags explicitly force lane markings on.
 */
function isLikelyUnmarkedRoad(tags = {}) {
  const laneMarkings = String(tags.lane_markings ?? '').trim().toLowerCase();
  if (laneMarkings === 'yes') return false;
  if (laneMarkings === 'no') return true;

  const surface = String(tags.surface ?? '').trim().toLowerCase();
  if (!surface) return false;
  return UNPAVED_SURFACES.has(surface);
}

/**
 * Decide if this highway class should get white/yellow lane line decals.
 */
function shouldUseLaneMarkings(highway, tags = {}) {
  if (!MAJOR_ROAD_MARKINGS.has(highway) && !MINOR_MARKED_HIGHWAYS.has(highway)) return false;
  return !isLikelyUnmarkedRoad(tags);
}

/**
 * Decide if this road should get asphalt-to-grass blend edge decals.
 */
function shouldUseGrassEdgeBlend(highway, tags = {}) {
  if (!GRASS_EDGE_BLEND_HIGHWAYS.has(highway)) return false;
  const surface = String(tags.surface ?? '').trim().toLowerCase();
  // If explicitly unpaved, skip asphalt-grass edge blend.
  if (surface && UNPAVED_SURFACES.has(surface)) return false;
  return true;
}

function shouldGenerateDecalRoads(highway, tags = {}) {
  if (!highway || ROAD_SKIP.has(highway)) return false;
  if (tags.area === 'yes') return false;

  if (highway === 'trunk_link') return false;

  if (highway === 'service') return false;

  const service = String(tags.service ?? '').trim().toLowerCase();
  if (['parking_aisle', 'driveway', 'alley', 'emergency_access'].includes(service)) {
    return false;
  }

  return true;
}

/**
 * Detect oneway=-1/reverse: travel runs against the OSM digitization order.
 */
function isReverseOneWayRoad(tags = {}) {
  const value = String(tags.oneway ?? '').trim().toLowerCase();
  return value === '-1' || value === 'reverse';
}

/**
 * Build the DecalRoad AI/navigation metadata for one road corridor
 * (DecalRoad.md §Navigation / AI pathfinding fields).
 *
 * Applied only to the drivable base layer; paint/edge layers stay visual-only.
 * Mirrors the map.json segment logic in beamngMapNavigation.js so AI behavior
 * is consistent across road modes:
 *   - oneWay follows node order; flipDirection covers oneway=-1/reverse.
 *   - manual lanes from lanes/lanes:forward/lanes:backward tags (autoLanes off).
 *   - private/track roads are gated and hidden from the navigation display.
 */
function getDecalRoadNavMetadata(highway, tags = {}) {
  const oneWay = isOneWayRoad(tags);
  const meta = { ...inferManualLaneData(highway, tags, oneWay) };

  if (oneWay) {
    meta.oneWay = true;
    if (isReverseOneWayRoad(tags)) meta.flipDirection = true;
  }

  const access = String(tags.access ?? '').trim().toLowerCase();
  const service = String(tags.service ?? '').trim().toLowerCase();
  if (access === 'private' || service === 'driveway' || highway === 'track') {
    meta.gatedRoad = true;
    meta.hiddenInNavi = true;
  }

  return meta;
}

/**
 * Parse a strictly positive integer, returning 0 when invalid.
 */
function parsePositiveInt(value) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

/**
 * Create a parallel offset of road nodes in world-space.
 *
 * Input and output node format: [x, y, z, halfWidth].
 */
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
  // Input centerline is already uniformly spaced; the offset inherits that
  // spacing one-to-one, so keep every node rather than decimating.
  return out;
}

// Minimum XY spacing between consecutive road nodes. Near-duplicate nodes
// (clip points landing on an original vertex, the resampler's exact-endpoint
// append, junction trim endpoints — all then rounded to mm) give BeamNG's
// improvedSpline a ~zero-length segment; the tangent math divides by it and
// the batch builder logs "packed position exceeded supported local range …
// by inf m" and drops that batch. The community MapNG guide documents the
// same glitch and fixes it in-editor by deleting the too-close node.
const MIN_ROAD_NODE_SPACING_M = 0.15;

/**
 * Drop non-finite road nodes and collapse consecutive nodes closer than
 * minSpacing in XY. The true endpoint is preserved: a too-close final node
 * replaces the previously kept one instead of being dropped. Works for any
 * node arity ([x,y,z,width] DecalRoads, 8-value MeshRoads). Returns [] when
 * fewer than 2 usable nodes remain.
 */
// A node where the path reverses onto itself (≈180° hairpin) is never a real
// 2 m-spaced roadway — it is degenerate data, and improvedSpline's normal math
// collapses on it the same way it does on zero-length segments.
const SPIKE_REVERSAL_DOT = -0.99;

function collapseCloseNodes(nodes, minSpacing) {
  const out = [nodes[0]];
  for (let i = 1; i < nodes.length; i++) {
    const node = nodes[i];
    const prev = out[out.length - 1];
    const spacing = Math.hypot(node[0] - prev[0], node[1] - prev[1]);
    if (spacing >= minSpacing) {
      out.push(node);
    } else if (i === nodes.length - 1 && out.length >= 2) {
      // Keep the road's real terminus; the previously kept node was within
      // minSpacing of it and is the one that gets dropped.
      out[out.length - 1] = node;
    }
  }
  return out;
}

function removeSpikeNodes(nodes) {
  if (nodes.length <= 2) return nodes;
  const out = [nodes[0]];
  for (let i = 1; i < nodes.length - 1; i++) {
    const prev = out[out.length - 1];
    const curr = nodes[i];
    const next = nodes[i + 1];
    const inX = curr[0] - prev[0];
    const inY = curr[1] - prev[1];
    const outX = next[0] - curr[0];
    const outY = next[1] - curr[1];
    const lenIn = Math.hypot(inX, inY);
    const lenOut = Math.hypot(outX, outY);
    if (lenIn > 1e-9 && lenOut > 1e-9) {
      const dot = (inX * outX + inY * outY) / (lenIn * lenOut);
      if (dot <= SPIKE_REVERSAL_DOT) continue; // drop the hairpin node
    }
    out.push(curr);
  }
  out.push(nodes[nodes.length - 1]);
  return out;
}

export function sanitizeRoadNodes(nodes, minSpacing = MIN_ROAD_NODE_SPACING_M) {
  if (!Array.isArray(nodes)) return [];
  let out = nodes.filter((n) => Array.isArray(n) && n.every((v) => Number.isFinite(v)));

  // Removing a spike can leave its neighbors inside minSpacing and vice versa,
  // so alternate the two passes until stable (bounded — each pass only drops).
  for (let pass = 0; pass < 5 && out.length >= 2; pass++) {
    const collapsed = collapseCloseNodes(out, minSpacing);
    const despiked = removeSpikeNodes(collapsed);
    const stable = despiked.length === out.length;
    out = despiked;
    if (stable) break;
  }
  return out.length >= 2 ? out : [];
}

/**
 * Build one BeamNG DecalRoad object from prepared spline nodes and style props.
 */
function makeRoadDecal(nodes, name, parentName, props, materialOverride) {
  const cleanNodes = sanitizeRoadNodes(nodes);
  if (cleanNodes.length < 2) return null;
  const decal = {
    name,
    class: 'DecalRoad',
    persistentId: generatePersistentId(),
    __parent: parentName || 'Decal_roads',
    position: [cleanNodes[0][0], cleanNodes[0][1], cleanNodes[0][2]],
    improvedSpline: true,
    material: materialOverride || props.material,
    nodes: cleanNodes,
    breakAngle: props.breakAngle,
    renderPriority: props.renderPriority,
    textureLength: props.textureLength,
  };
  if (Array.isArray(props.startEndFade)) decal.startEndFade = props.startEndFade;
  if (Array.isArray(props.distanceFade)) decal.distanceFade = props.distanceFade;
  if (Number.isFinite(props.drivability)) decal.drivability = props.drivability;
  if (Number.isFinite(props.detail)) decal.detail = props.detail;
  return decal;
}

function maybeReverseDecalNodes(nodes, layer) {
  if (!Array.isArray(nodes) || nodes.length < 2) return nodes;
  if (!layer?.mirrorByReversingNodes) return nodes;
  return [...nodes].reverse();
}

// Sanity cap on painted lane separators per roadway — bad OSM lane counts
// (lanes=12 typos) shouldn't bury a road in paint.
const MAX_PAINTED_LANE_SEPARATORS = 6;

const LINE_LAYER_BASE = { textureLength: 6.4, breakAngle: 1 };

/**
 * Build line-marking decal layers (center line, edge lines, lane separators)
 * for one road corridor from its OSM tags.
 *
 * Geometry/sign conventions (see offsetNodes): a POSITIVE offset places the
 * line on the LEFT of the node-order direction. oneway=yes ways are digitized
 * in the travel direction (routing requires it); oneway=-1 runs against it,
 * flipping which side is travel-left.
 *
 * One-way roads get no center line: white dashed separators between lanes,
 * and on major classes a solid yellow travel-left edge + white right edge
 * (US divided-highway convention). Two-way roads get the center divider at
 * the forward/backward lane boundary (offset 0 when symmetric) — yellow
 * double on major classes, white dashed on minor — plus dashed separators
 * for any additional lanes per direction.
 *
 * Caveat: when lanes:forward/backward are asymmetric AND the corridor merger
 * reversed the seed geometry, the painted layout mirrors. Symmetric layouts
 * (the overwhelmingly common case) are unaffected.
 */
export function buildLineMarkingLayers(highway, tags = {}, styleHalfWidth = 3.5) {
  const majorRoad = MAJOR_ROAD_MARKINGS.has(highway);
  const edgeOffset = 0.9 * styleHalfWidth;
  const layers = [];

  const totalTag = parsePositiveInt(tags.lanes);
  const fwdTag = parsePositiveInt(tags['lanes:forward']);
  const backTag = parsePositiveInt(tags['lanes:backward']);

  const pushSeparator = (k, lanes) => {
    const offset = -edgeOffset + (2 * edgeOffset * k) / lanes;
    layers.push({
      name: `line_sep_${k}`, material: GLOBAL_DECAL_MATERIALS.lineWhiteDashed,
      width: 0.15, offset, renderPriority: 2, ...LINE_LAYER_BASE,
    });
  };

  if (isOneWayRoad(tags)) {
    const lanes = Math.max(1, totalTag || (fwdTag + backTag) || getDefaultLaneCount(highway, true));
    const sepCount = Math.min(lanes - 1, MAX_PAINTED_LANE_SEPARATORS);
    for (let k = 1; k <= sepCount; k++) pushSeparator(k, lanes);

    if (majorRoad) {
      const leftSign = isReverseOneWayRoad(tags) ? -1 : 1;
      layers.push({
        name: leftSign > 0 ? 'line_right' : 'line_left', material: GLOBAL_DECAL_MATERIALS.lineYellowSingle,
        width: 0.2, offset: leftSign * edgeOffset, renderPriority: 1, ...LINE_LAYER_BASE,
      });
      layers.push({
        name: leftSign > 0 ? 'line_left' : 'line_right', material: GLOBAL_DECAL_MATERIALS.lineWhite,
        width: 0.2, offset: -leftSign * edgeOffset, renderPriority: 1, ...LINE_LAYER_BASE,
      });
    }
    return layers;
  }

  // Two-way: resolve per-direction lane counts.
  let lanes = totalTag || (fwdTag && backTag ? fwdTag + backTag : 0) || getDefaultLaneCount(highway, false);
  let nF = fwdTag;
  let nB = backTag;
  if (!nF && !nB) {
    nF = Math.max(1, Math.floor(lanes / 2));
    nB = Math.max(1, lanes - nF);
  } else {
    nF = nF || Math.max(1, lanes - nB);
    nB = nB || Math.max(1, lanes - nF);
  }
  lanes = nF + nB;

  // Center divider sits at the forward/backward boundary. Forward travel
  // follows node order, so its lanes occupy the negative-offset (right) side.
  const centerOffset = -edgeOffset + (2 * edgeOffset * nF) / lanes;
  layers.push({
    name: 'line_center',
    material: majorRoad ? GLOBAL_DECAL_MATERIALS.lineYellowDouble : GLOBAL_DECAL_MATERIALS.lineWhiteDashed,
    width: majorRoad ? 0.4 : 0.2, offset: centerOffset, renderPriority: 2, ...LINE_LAYER_BASE,
  });

  let seps = 0;
  for (let k = 1; k < lanes && seps < MAX_PAINTED_LANE_SEPARATORS; k++) {
    if (k === nF) continue; // that boundary is the center divider
    seps++;
    pushSeparator(k, lanes);
  }

  if (majorRoad) {
    layers.push({
      name: 'line_left', material: GLOBAL_DECAL_MATERIALS.lineWhite,
      width: 0.2, offset: -edgeOffset, renderPriority: 1, ...LINE_LAYER_BASE,
    });
    layers.push({
      name: 'line_right', material: GLOBAL_DECAL_MATERIALS.lineWhite,
      width: 0.2, offset: edgeOffset, renderPriority: 1, ...LINE_LAYER_BASE,
    });
  }
  return layers;
}

function getLayeredRoadDecals(centerNodes, highway, tags, styleHalfWidth, parentName, options = {}) {
  const isUnpaved = UNPAVED_SURFACES.has(tags.surface) || highway === 'track';
  const laneMarkingsEnabled = shouldUseLaneMarkings(highway, tags);
  const grassEdgeBlendEnabled = shouldUseGrassEdgeBlend(highway, tags);
  const majorRoad = MAJOR_ROAD_MARKINGS.has(highway);
  const startTrim = options.startTrim || { center: 0, pos: 0, neg: 0 };
  const endTrim = options.endTrim || { center: 0, pos: 0, neg: 0 };

  let templateKey = 'default';
  if (isUnpaved) templateKey = 'unpaved';
  else if (majorRoad && laneMarkingsEnabled) templateKey = 'major';
  else if (laneMarkingsEnabled) templateKey = 'minor';

  const layers = (ROAD_TEMPLATES[templateKey] || ROAD_TEMPLATES.default).filter((layer) => {
    if (layer.name.startsWith('edge_')) return grassEdgeBlendEnabled;
    return true;
  });
  if (!isUnpaved && laneMarkingsEnabled) {
    layers.push(...buildLineMarkingLayers(highway, tags, styleHalfWidth));
  }
  const decals = [];

  for (const layer of layers) {
    let offset = layer.offset;
    let width = layer.width || (styleHalfWidth * (layer.widthScale || 1.0));

    // Handle offsets relative to the road edge (typical for line markings)
    if (layer.isEdgeRelative) {
      // Offset is multiplier of styleHalfWidth
      offset = layer.offset * styleHalfWidth;
    } else if (layer.isEdge) {
      // Keep the hard edge close to the pavement and let the soft fade run outward.
      offset = layer.offset * (styleHalfWidth + (width / 2) - 0.15);
    }

    const baseNodes = offsetNodes(centerNodes, offset, width);
    const shouldTrimAtJunction = layer.name.startsWith('line_') || layer.name.startsWith('edge_');
    let trimStartM = 0;
    let trimEndM = 0;
    if (shouldTrimAtJunction) {
      if (layer.name === 'line_center') {
        trimStartM = Math.max(0, startTrim.center || 0);
        trimEndM = Math.max(0, endTrim.center || 0);
      } else if (offset > 0.01) {
        trimStartM = Math.max(0, startTrim.pos || 0);
        trimEndM = Math.max(0, endTrim.pos || 0);
      } else if (offset < -0.01) {
        trimStartM = Math.max(0, startTrim.neg || 0);
        trimEndM = Math.max(0, endTrim.neg || 0);
      } else {
        trimStartM = Math.max(0, startTrim.center || 0);
        trimEndM = Math.max(0, endTrim.center || 0);
      }
      // Mirrored layers reverse node order, so endpoint-specific trim must swap.
      if (layer.mirrorByReversingNodes) {
        const tmp = trimStartM;
        trimStartM = trimEndM;
        trimEndM = tmp;
      }
    }
    const trimmedNodes = shouldTrimAtJunction
      ? trimNodesByDistance(baseNodes, trimStartM, trimEndM)
      : baseNodes;
    const layeredNodes = maybeReverseDecalNodes(trimmedNodes, layer);
    if (layeredNodes.length < 2) continue;

    // Use names that the BeamNG Road Spline Tool recognizes.
    let levelName = 'Layer';
    if (layer.name === 'asphalt' || layer.name === 'dirt') levelName = 'Base';
    else if (layer.name === 'line_center') levelName = 'Center Line';
    else if (layer.name === 'line_left') levelName = 'Edge Line - Left';
    else if (layer.name === 'line_right') levelName = 'Edge Line - Right';
    else if (layer.name === 'edge_left') levelName = 'Edge Blend - Left';
    else if (layer.name === 'edge_right') levelName = 'Edge Blend - Right';

    // Fade only at a road's true termini — never at internal chunk joins, or
    // every ~chunk boundary would show a gap. mirrored layers swap start/end.
    let startEndFade;
    if (Number.isFinite(layer.startEndFadeMag) && layer.startEndFadeMag > 0) {
      let s = options.isRoadStart ? layer.startEndFadeMag : 0;
      let e = options.isRoadEnd ? layer.startEndFadeMag : 0;
      if (layer.mirrorByReversingNodes) { const t = s; s = e; e = t; }
      startEndFade = [s, e];
    }

    const isBaseSurface = layer.name === 'asphalt' || layer.name === 'dirt';
    const decal = makeRoadDecal(layeredNodes, levelName, parentName, {
      material: layer.material,
      renderPriority: isBaseSurface ? getSurfaceRenderPriority(highway, tags) : layer.renderPriority,
      breakAngle: Number.isFinite(layer.breakAngle) ? layer.breakAngle : 1,
      textureLength: Number.isFinite(layer.textureLength) ? layer.textureLength : 8,
      startEndFade,
      distanceFade: layer.distanceFade,
      drivability: layer.drivability,
    });

    // Only the drivable base layer feeds the AI/navigation graph; attach the
    // documented pathfinding fields there (oneWay, lanes, gatedRoad, …).
    if (decal && Number.isFinite(layer.drivability) && layer.drivability > 0 && options.navMetadata) {
      Object.assign(decal, options.navMetadata);
    }

    if (decal) decals.push(decal);
  }

  return decals;
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

  const sourceRoadFeatures = terrainData.osmFeatures.filter((feature) => {
    if (feature?.type !== 'road' || !feature.geometry?.length) return false;
    const highway = feature.tags?.highway;
    return !!highway && !ROAD_SKIP.has(highway);
  });
  const roadNetwork = buildRoadNetwork(sourceRoadFeatures);
  const mergedRoadSegments = mergeLinearRoadSegments(
    roadNetwork.segments,
    roadNetwork.intersections,
    { styleKeyResolver: getDecalMergeStyleKey },
  );
  const drivableRoads = mergedRoadSegments.length > 0 ? mergedRoadSegments : roadNetwork.segments;
  const stableHalfWidthMap = buildStableDecalHalfWidthMap(drivableRoads);

  const roadSplinesByName = new Map();
  const segmentCounterByName = new Map();
  const usedGroupNames = new Map();
  const LAYER_CODE = {
    Base: 'b',
    'Center Line': 'cl',
    'Edge Line - Left': 'ell',
    'Edge Line - Right': 'elr',
    'Edge Blend - Left': 'ebl',
    'Edge Blend - Right': 'ebr',
  };

  const getOrCreateSplineGroup = (groupName) => {
    if (roadSplinesByName.has(groupName)) return roadSplinesByName.get(groupName);
    const group = {
      class: 'SimGroup',
      name: groupName,
      persistentId: generatePersistentId(),
      __parent: 'Decal_Roads',
      __items: [],
    };
    roadSplinesByName.set(groupName, group);
    return group;
  };

  for (const segmentFeature of drivableRoads) {
    const feature = segmentFeature.sourceFeature;
    const highway = segmentFeature.highway;
    if (!shouldGenerateDecalRoads(highway, feature.tags || {})) continue;
    const rawName = feature.tags?.name || feature.tags?.ref || `road_${feature.id}`;
    const baseName = sanitizeBeamNGObjectName(rawName, `road_${feature.id || 'x'}`);
    const used = usedGroupNames.get(baseName) || 0;
    usedGroupNames.set(baseName, used + 1);
    const cleanName = used > 0 ? sanitizeBeamNGObjectName(`${baseName}_${used + 1}`) : baseName;
    
    const style = HIGHWAY_STYLE[highway] ?? DEFAULT_ROAD_STYLE;
    const isOneWay = isOneWayRoad(feature.tags || {});
    const renderTags = getMergedRoadRenderTags(segmentFeature);
    const corridorKey = getDecalWidthCorridorKey(segmentFeature);
    const estimatedHalfWidth = estimateRoadHalfWidth(feature.tags || {}, highway, isOneWay, style.width);
    const stableHalfWidth = stableHalfWidthMap.get(corridorKey);
    const styleHalfWidth = Number.isFinite(stableHalfWidth) && stableHalfWidth > 0
      ? stableHalfWidth
      : estimatedHalfWidth;
    const startTrimProfile = getEndpointTrimProfile(
      segmentFeature,
      segmentFeature.startKey,
      true,
      roadNetwork.intersections,
    );
    const endTrimProfile = getEndpointTrimProfile(
      segmentFeature,
      segmentFeature.endKey,
      false,
      roadNetwork.intersections,
    );

    // Clip to the terrain's safe inner boundary, splitting at crossings.
    // Then further chunk each segment so no single DecalRoad is too long.
    const clippedSegments = clipGeometryToMargin(segmentFeature.geometry, terrainData.bounds)
      .map(s => resampleGeometryToSpacing(s, ROAD_NODE_SPACING_M))
      .flatMap(s => chunkPolyline(s));

    if (clippedSegments.length === 0) continue;

    const splineGroup = getOrCreateSplineGroup(cleanName);

    for (let i = 0; i < clippedSegments.length; i++) {
      const segment = clippedSegments[i];
      const rawNodes = [];
      for (const pt of segment) {
        // geoToWorldPoint, not geoToWorld: the latter quantizes X/Y/Z to 0.1 m,
        // which at 2 m node spacing puts visible lateral jitter into the spline
        // (and its painted lines). Road nodes are mm-rounded below instead.
        const [wx, wy, wz] = geoToWorldPoint(pt.lat, pt.lng, terrainData, squareSize, 0.1);
        // Defense in depth: a non-finite node becomes an inf DecalRoad position
        // that BeamNG rejects at batch build, taking the whole road down. Source
        // geometry is already sanitized in buildRoadNetwork; skip here too so no
        // future path can emit one.
        if (!Number.isFinite(wx) || !Number.isFinite(wy) || !Number.isFinite(wz)) continue;
        rawNodes.push([
          Math.round(wx * 1000) / 1000,
          Math.round(wy * 1000) / 1000,
          Math.round(wz * 1000) / 1000,
          styleHalfWidth,
        ]);
      }

      // Nodes are already uniformly spaced (geometry was resampled to
      // ROAD_NODE_SPACING_M before world conversion), so no decimation here.
      const centerNodes = rawNodes;
      if (centerNodes.length < 2) continue;

      const layeredDecals = getLayeredRoadDecals(
        centerNodes,
        highway,
        renderTags,
        styleHalfWidth,
        cleanName,
        {
          startTrim: i === 0 ? startTrimProfile : { center: 0, pos: 0, neg: 0 },
          endTrim: i === clippedSegments.length - 1 ? endTrimProfile : { center: 0, pos: 0, neg: 0 },
          isRoadStart: i === 0,
          isRoadEnd: i === clippedSegments.length - 1,
          navMetadata: getDecalRoadNavMetadata(highway, renderTags),
        },
      );

      if (layeredDecals.length > 0) {
        const segCount = (segmentCounterByName.get(cleanName) || 0) + 1;
        segmentCounterByName.set(cleanName, segCount);
        const nameSuffix = `s${segCount}`;
        const roadNamePrefix = sanitizeBeamNGObjectName(`dr_${cleanName}`);
        for (let d = 0; d < layeredDecals.length; d++) {
          const decal = layeredDecals[d];
          const layerCode = LAYER_CODE[decal.name] || `l${d + 1}`;
          decal.name = sanitizeBeamNGObjectName(`${roadNamePrefix}_${nameSuffix}_${layerCode}`);
          splineGroup.__items.push(decal);
        }
      }
    }
  }

  const groups = Array.from(roadSplinesByName.values()).filter((g) => g.__items.length > 0);

  const junctionMarkings = generateJunctionMarkingDecals(terrainData, squareSize);
  if (junctionMarkings.length > 0) {
    groups.push({
      class: 'SimGroup',
      name: 'junction_markings',
      persistentId: generatePersistentId(),
      __parent: 'Decal_Roads',
      __items: junctionMarkings,
    });
  }

  return groups;
}

// ── Junction markings: stop lines + crosswalks ───────────────────────────────
// OSM maps stop positions (highway=stop), signal stop positions
// (highway=traffic_signals) and pedestrian crossings (highway=crossing) as
// NODES that are vertices of the road way itself, so each marking can be
// placed exactly on the roadway with the road's own tangent.
const STOP_BAR_THICKNESS_M = 0.45;        // MUTCD stop bars are 12-24 in
const CROSSWALK_LINE_WIDTH_M = 0.3;
const CROSSWALK_LINE_GAP_HALF_M = 1.2;    // transverse pair, 2.4 m apart
// Painted span stays inside the edge lines (0.9 × halfWidth).
const JUNCTION_MARK_SPAN_FACTOR = 0.88;

function shouldPaintCrossing(tags = {}) {
  const crossing = String(tags.crossing ?? '').trim().toLowerCase();
  if (['unmarked', 'informal', 'no'].includes(crossing)) return false;
  if (String(tags['crossing:markings'] ?? '').trim().toLowerCase() === 'no') return false;
  return true;
}

/**
 * Build stop-line and crosswalk DecalRoads from OSM point features.
 *
 * Returns an array of DecalRoad objects (no group wrapper).
 */
export function generateJunctionMarkingDecals(terrainData, squareSize) {
  const features = terrainData.osmFeatures || [];
  if (!features.length) return [];

  const roads = features.filter((f) =>
    f?.type === 'road' &&
    Array.isArray(f.geometry) && f.geometry.length >= 2 &&
    f.tags?.highway && !ROAD_SKIP.has(f.tags.highway),
  );
  if (roads.length === 0) return [];

  // Index every road vertex by the shared node-key convention so point
  // features can be matched to the way they sit on.
  const vertexIndex = new Map();
  for (const road of roads) {
    road.geometry.forEach((pt, index) => {
      if (!Number.isFinite(pt?.lat) || !Number.isFinite(pt?.lng)) return;
      const key = makeRoadNodeKey(pt);
      const entries = vertexIndex.get(key) || [];
      entries.push({ road, index });
      vertexIndex.set(key, entries);
    });
  }

  const { bounds } = terrainData;
  const margin = ROAD_EDGE_MARGIN + 0.005;
  const insideMargin = (pt) => {
    const u = (pt.lng - bounds.west) / (bounds.east - bounds.west);
    const v = (bounds.north - pt.lat) / (bounds.north - bounds.south);
    return u >= margin && u <= 1 - margin && v >= margin && v <= 1 - margin;
  };

  // Road tangent (unit, world XY) at vertex `index`, central difference.
  const tangentAt = (road, index) => {
    const geom = road.geometry;
    const a = geom[Math.max(0, index - 1)];
    const b = geom[Math.min(geom.length - 1, index + 1)];
    const [ax, ay] = geoToWorldPoint(a.lat, a.lng, terrainData, squareSize, 0);
    const [bx, by] = geoToWorldPoint(b.lat, b.lng, terrainData, squareSize, 0);
    const len = Math.hypot(bx - ax, by - ay);
    if (len < 1e-6) return null;
    return [(bx - ax) / len, (by - ay) / len];
  };

  const nodeAt = (x, y, width) => [
    Math.round(x * 1000) / 1000,
    Math.round(y * 1000) / 1000,
    Math.round((getTerrainHeightAtWorldXY(x, y, terrainData, squareSize) + 0.1) * 1000) / 1000,
    width,
  ];

  const decals = [];
  const pushLine = (baseName, cx, cy, dirX, dirY, fromM, toM, lineWidth) => {
    const nodes = [
      nodeAt(cx + dirX * fromM, cy + dirY * fromM, lineWidth),
      nodeAt(cx + dirX * toM, cy + dirY * toM, lineWidth),
    ];
    const name = sanitizeBeamNGObjectName(`${baseName}_${decals.length + 1}`);
    const decal = makeRoadDecal(nodes, name, 'junction_markings', {
      material: GLOBAL_DECAL_MATERIALS.lineWhite,
      renderPriority: 1, breakAngle: 1, textureLength: 6.4,
    });
    if (decal) decals.push(decal);
  };

  let stopCount = 0;
  let crossingCount = 0;
  const paintedCrossingKeys = new Set();

  const roadMetricsAt = (road, index, pt) => {
    const roadTags = road.tags || {};
    const highway = roadTags.highway;
    const tangent = tangentAt(road, index);
    if (!tangent) return null;
    const oneWay = isOneWayRoad(roadTags);
    const style = HIGHWAY_STYLE[highway] ?? DEFAULT_ROAD_STYLE;
    const halfW = JUNCTION_MARK_SPAN_FACTOR *
      estimateRoadHalfWidth(roadTags, highway, oneWay, style.width);
    const [px, py] = geoToWorldPoint(pt.lat, pt.lng, terrainData, squareSize, 0);
    return { roadTags, tangent, oneWay, halfW, px, py };
  };

  // Transverse crosswalk: two full-width lines straddling the crossing point.
  const paintCrosswalk = (road, index, pt) => {
    const key = makeRoadNodeKey(pt);
    if (paintedCrossingKeys.has(key)) return;
    const m = roadMetricsAt(road, index, pt);
    if (!m) return;
    paintedCrossingKeys.add(key);
    const perp = [-m.tangent[1], m.tangent[0]];
    for (const side of [-1, 1]) {
      pushLine(
        'jm_crosswalk',
        m.px + m.tangent[0] * CROSSWALK_LINE_GAP_HALF_M * side,
        m.py + m.tangent[1] * CROSSWALK_LINE_GAP_HALF_M * side,
        perp[0], perp[1], -m.halfW, m.halfW, CROSSWALK_LINE_WIDTH_M,
      );
    }
    crossingCount++;
  };

  // Crossings mapped as WAYS (footway/cycleway with *=crossing): the way
  // shares a vertex with each vehicle road it crosses — paint there. This is
  // how most US suburbs are mapped; crossing NODES are handled below.
  for (const feature of features) {
    const tags = feature.tags || {};
    const isCrossingWay =
      tags.footway === 'crossing' || tags.cycleway === 'crossing' || tags.path === 'crossing';
    if (!isCrossingWay || !shouldPaintCrossing(tags)) continue;
    if (!Array.isArray(feature.geometry) || feature.geometry.length < 2) continue;

    for (const pt of feature.geometry) {
      if (!Number.isFinite(pt?.lat) || !Number.isFinite(pt?.lng) || !insideMargin(pt)) continue;
      const entries = vertexIndex.get(makeRoadNodeKey(pt)) || [];
      for (const { road, index } of entries) {
        paintCrosswalk(road, index, pt);
      }
    }
  }

  for (const feature of features) {
    if (!Array.isArray(feature?.geometry) || feature.geometry.length !== 1) continue;
    const tags = feature.tags || {};
    const kind = tags.highway;
    if (kind !== 'stop' && kind !== 'traffic_signals' && kind !== 'crossing') continue;
    if (kind === 'crossing' && !shouldPaintCrossing(tags)) continue;

    const pt = feature.geometry[0];
    if (!Number.isFinite(pt?.lat) || !Number.isFinite(pt?.lng) || !insideMargin(pt)) continue;

    const entries = vertexIndex.get(makeRoadNodeKey(pt));
    if (!entries || entries.length === 0) continue;
    // A node shared by several distinct roads is the junction node itself
    // (common for older traffic_signals mapping) — a bar there would sit in
    // the middle of the intersection.
    const distinctRoads = new Set(entries.map((e) => e.road));
    if (distinctRoads.size > 1) continue;

    const { road, index } = entries[0];

    if (kind === 'crossing') {
      paintCrosswalk(road, index, pt);
      continue;
    }

    const m = roadMetricsAt(road, index, pt);
    if (!m) continue;
    const { roadTags, tangent, oneWay, halfW, px, py } = m;

    // Stop bar (highway=stop / highway=traffic_signals): spans only the
    // approaching lanes. Travel direction comes from the way orientation,
    // corrected by the node's direction tag; on two-way roads without one,
    // assume the bar sits just before the junction and orient toward the
    // nearer way end.
    let approach = tangent;
    const dirTag = String(tags['traffic_signals:direction'] ?? tags.direction ?? '').trim().toLowerCase();
    if (oneWay) {
      if (isReverseOneWayRoad(roadTags)) approach = [-tangent[0], -tangent[1]];
    } else if (dirTag === 'backward') {
      approach = [-tangent[0], -tangent[1]];
    } else if (dirTag !== 'forward') {
      const nearerStart = index < road.geometry.length - 1 - index;
      if (nearerStart) approach = [-tangent[0], -tangent[1]];
    }
    const right = [approach[1], -approach[0]];
    // One-way: bar across the full roadway. Two-way: approach half only,
    // with a small gap at the center line.
    const fromM = oneWay ? -halfW : 0.25;
    pushLine('jm_stopline', px, py, right[0], right[1], fromM, halfW, STOP_BAR_THICKNESS_M);
    stopCount++;
  }

  if (decals.length > 0) {
    console.log(`[BeamNG Export] Junction markings: ${stopCount} stop bars, ${crossingCount} crosswalks`);
  }
  return decals;
}

// ── Turn-lane arrow decals ────────────────────────────────────────────────────
// Painted from OSM turn:lanes data using BeamNG's core road-markings atlas
// (/assets/materials/decalroad/lines/roadmarkings1, the same one
// west_coast_usa's decal_roadmarkings1 uses). 4×4 atlas; rect 0 = left arrow,
// 1 = right arrow, 2 = straight arrow (3 = STOP text, 4.. = ONLY/BUS/etc.).
// Decal instance format (main.decals.json, documented in its header):
// [rectIdx, size, renderPriority, pos.xyz, normal.xyz, tangent.xyz, uid].
// Tangent is the ACROSS-LANE axis — verified empirically: adjacent-lane arrow
// pairs in west_coast_usa separate parallel to their tangent in 152/156
// cases. Its sign matters: the stencil's "up" renders along −(normal ×
// tangent), so the tangent must point driver-LEFT for arrows to face the
// direction of travel (in-game verified 2026-06-10).
export const ROAD_ARROW_MATERIAL = {
  name: 'mapng_roadmarkings',
  mapTo: 'mapng_roadmarkings',
  class: 'Material',
  persistentId: '7c1f5a90-44a1-4b62-9c11-0a8e62d41a01',
  Stages: [{
    ambientOcclusionMap: '/assets/materials/decalroad/lines/roadmarkings1/t_decal_roadmarkings_ao.data.png',
    baseColorMap: '/assets/materials/decalroad/lines/roadmarkings1/t_decal_roadmarkings_b.color.png',
    metallicFactor: 0.5,
    metallicMap: '/assets/materials/decalroad/lines/roadmarkings1/t_decal_roadmarkings_m.data.png',
    normalMap: '/assets/materials/decalroad/lines/roadmarkings1/t_decal_roadmarkings_nm.normal.png',
    opacityMap: '/assets/materials/decalroad/lines/roadmarkings1/t_decal_roadmarkings_o.data.png',
    roughnessMap: '/assets/materials/decalroad/lines/roadmarkings1/t_decal_roadmarkings_r.data.png',
  }, {}, {}, {}],
  alphaRef: 8,
  alphaTest: true,
  annotation: 'DRIVING_INSTRUCTIONS',
  castShadows: false,
  materialTag0: 'decal',
  materialTag1: 'road',
  materialTag2: 'beamng',
  translucent: true,
  translucentZWrite: true,
  version: 1.5,
};

export const ROAD_ARROW_DECAL_DATA = {
  name: 'mapng_road_arrows',
  class: 'DecalData',
  persistentId: 'b8e24c11-93d0-4f7a-8a55-0a8e62d41a02',
  fadeEndPixelSize: 20,
  fadeStartPixelSize: 40,
  material: 'mapng_roadmarkings',
  renderPriority: 6,
  texCols: 4,
  texRows: 4,
  textureCoordCount: 15,
  textureCoords: Array.from({ length: 16 }, (_, i) => [
    (i % 4) * 0.25, Math.floor(i / 4) * 0.25, 0.25, 0.25,
  ]),
};

const TURN_ARROW_RECT = { left: 0, right: 1, through: 2 };
const TURN_ARROW_SIZE = { left: 4.5, right: 3.7, through: 3.4 }; // WCU medians
const TURN_ARROW_SETBACK_M = 8;

/**
 * Collapse one turn:lanes lane value to a paintable arrow, or null.
 * Combined directives ('left;through') paint the turn — it carries the
 * information a driver needs; the atlas has no combo stencils.
 */
function parseTurnDirective(value) {
  const v = String(value ?? '').trim().toLowerCase();
  if (!v || v === 'none') return null;
  if (v.includes('merge')) return null;
  if (v.includes('left') || v.includes('reverse')) return 'left';
  if (v.includes('right')) return 'right';
  if (v.includes('through')) return 'through';
  return null;
}

/**
 * Walk back `setbackM` metres from one end of a road geometry.
 * Returns { x, y, dir } where dir is the unit travel direction TOWARD that
 * end, or null for degenerate geometry.
 */
function walkBackFromEnd(geometry, fromEnd, setbackM, terrainData, squareSize) {
  const pts = fromEnd ? [...geometry].reverse() : geometry;
  const world = pts.map((pt) => geoToWorldPoint(pt.lat, pt.lng, terrainData, squareSize, 0));
  let total = 0;
  for (let i = 1; i < world.length; i++) {
    total += Math.hypot(world[i][0] - world[i - 1][0], world[i][1] - world[i - 1][1]);
  }
  if (total < 2) return null;
  const target = Math.min(setbackM, total / 2);

  let walked = 0;
  for (let i = 1; i < world.length; i++) {
    const [ax, ay] = world[i - 1];
    const [bx, by] = world[i];
    const seg = Math.hypot(bx - ax, by - ay);
    if (seg < 1e-9) continue;
    if (walked + seg >= target) {
      const t = (target - walked) / seg;
      const x = ax + (bx - ax) * t;
      const y = ay + (by - ay) * t;
      // Travel direction toward the junction end = back along the walk.
      const dir = [(ax - bx) / seg, (ay - by) / seg];
      return { x, y, dir };
    }
    walked += seg;
  }
  return null;
}

/**
 * Build turn-arrow decal instances from OSM turn:lanes tags.
 *
 * Arrows are placed per lane, TURN_ARROW_SETBACK_M back from the way end that
 * meets a junction; ways whose tagged end doesn't touch another road are
 * skipped (turn:lanes ways are almost always short junction-approach
 * segments).
 */
export function generateTurnArrowDecals(terrainData, squareSize) {
  const features = terrainData.osmFeatures || [];
  if (!features.length) return [];

  const roads = features.filter((f) =>
    f?.type === 'road' &&
    Array.isArray(f.geometry) && f.geometry.length >= 2 &&
    f.tags?.highway && !ROAD_SKIP.has(f.tags.highway),
  );
  if (roads.length === 0) return [];

  // A turn-lane way's tagged end must touch another road to count as a
  // junction approach. T-junction ends land on the other road's MID vertex,
  // so count distinct roads across ALL vertices, not just endpoints.
  const roadsAtNode = new Map();
  for (const road of roads) {
    for (const pt of road.geometry) {
      if (!Number.isFinite(pt?.lat) || !Number.isFinite(pt?.lng)) continue;
      const key = makeRoadNodeKey(pt);
      const set = roadsAtNode.get(key) || new Set();
      set.add(road);
      roadsAtNode.set(key, set);
    }
  }

  const { bounds } = terrainData;
  const margin = ROAD_EDGE_MARGIN + 0.005;
  const insideMargin = (x, y) => {
    const worldSize = terrainData.width * squareSize;
    const u = x / worldSize + 0.5;
    const v = 0.5 - y / worldSize;
    return u >= margin && u <= 1 - margin && v >= margin && v <= 1 - margin;
  };

  const instances = [];

  for (const road of roads) {
    const tags = road.tags || {};
    const highway = tags.highway;
    const oneWay = isOneWayRoad(tags);
    const reversed = isReverseOneWayRoad(tags);

    // Per-direction lane specs. Plain turn:lanes on a two-way road is
    // ambiguous per the wiki — skip it there.
    const specs = [];
    const fwdSpec = tags['turn:lanes:forward'] || ((oneWay && !reversed) ? tags['turn:lanes'] : null);
    const backSpec = tags['turn:lanes:backward'] || ((oneWay && reversed) ? tags['turn:lanes'] : null);
    if (fwdSpec) specs.push({ spec: fwdSpec, towardEnd: true });
    if (backSpec) specs.push({ spec: backSpec, towardEnd: false });
    if (specs.length === 0) continue;

    const style = HIGHWAY_STYLE[highway] ?? DEFAULT_ROAD_STYLE;
    const halfW = estimateRoadHalfWidth(tags, highway, oneWay, style.width);
    const drivableHalf = 0.9 * halfW;

    for (const { spec, towardEnd } of specs) {
      const laneValues = String(spec).split('|');
      const nDir = laneValues.length;
      if (nDir === 0) continue;

      // Opposing-direction lane count shares the same drivable width.
      let nOpp = 0;
      if (!oneWay) {
        const totalTag = parsePositiveInt(tags.lanes);
        const oppTag = parsePositiveInt(tags[towardEnd ? 'lanes:backward' : 'lanes:forward']);
        nOpp = oppTag || (totalTag ? Math.max(1, totalTag - nDir) : nDir);
      }
      const laneWidth = (2 * drivableHalf) / (nDir + nOpp);

      const endPt = towardEnd ? road.geometry[road.geometry.length - 1] : road.geometry[0];
      if (!Number.isFinite(endPt?.lat) || !Number.isFinite(endPt?.lng)) continue;
      if ((roadsAtNode.get(makeRoadNodeKey(endPt))?.size || 0) < 2) continue;

      const placed = walkBackFromEnd(road.geometry, towardEnd, TURN_ARROW_SETBACK_M, terrainData, squareSize);
      if (!placed || !insideMargin(placed.x, placed.y)) continue;

      const [dx, dy] = placed.dir;
      const right = [dy, -dx]; // driver-right in the travel frame

      for (let k = 0; k < nDir; k++) {
        const directive = parseTurnDirective(laneValues[k]);
        if (!directive) continue;
        // Lanes are listed left-to-right in the travel direction; opposing
        // lanes occupy the driver-left part of the roadway.
        const offset = -drivableHalf + (nOpp + k + 0.5) * laneWidth;
        const x = placed.x + right[0] * offset;
        const y = placed.y + right[1] * offset;
        if (!insideMargin(x, y)) continue;
        const z = getTerrainHeightAtWorldXY(x, y, terrainData, squareSize) + 0.1;
        const size = Math.min(TURN_ARROW_SIZE[directive], laneWidth * 1.35);

        instances.push([
          TURN_ARROW_RECT[directive],
          roundTo(size, 2),
          0,
          roundTo(x, 3), roundTo(y, 3), roundTo(z, 3),
          0, 0, 1,
          // Tangent must be driver-LEFT: the engine lays the stencil's "up"
          // along −(normal × tangent), so a driver-right tangent rendered
          // every arrow 180° rotated (verified in-game 2026-06-10).
          roundTo(-right[0], 6), roundTo(-right[1], 6), 0,
          hashString(`${road.id}:${towardEnd ? 'f' : 'b'}:${k}`),
        ]);
      }
    }
  }

  return instances;
}

/**
 * Create the default Road Architect profile object used by generated roads.
 *
 * The profile embeds lane, edge, centerline, and blend-layer defaults expected
 * by BeamNG's roadarchitect plugin session format.
 */
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

/**
 * Convert a geographic node into one Road Architect node entry.
 */
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

/**
 * Build a stable key for a lat/lng point to support node identity matching.
 */
/**
 * Create a Road Architect profile layer representing a pedestrian crossing.
 */
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

/**
 * Create a Road Architect profile layer that places a traffic boom object.
 */
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

/**
 * Build a reduced-marking profile for road approaches at 4-way intersections.
 */
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

/**
 * Build a profile that emits only sidewalk geometry for intersection corners.
 */
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

/**
 * Create one locked Road Architect node for generated sidewalk arcs.
 */
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

/**
 * Normalize a 2D vector, falling back to +X when magnitude is near zero.
 */
function normalize2D(dx, dy) {
  const len = Math.hypot(dx, dy);
  if (len < 1e-6) return { x: 1, y: 0 };
  return { x: dx / len, y: dy / len };
}

/**
 * Decorate four-way intersections with approach profiles and sidewalk arcs.
 *
 * Returns extra sidewalk roads and the next available sidewalk index counter.
 */
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

/**
 * Build a Road Architect session JSON object from clipped OSM roads.
 *
 * The output matches the plugin session schema under `data.{roads,profiles,...}`
 * and is written into the exported level so users can edit generated roads in
 * BeamNG's Road Architect tools.
 */
function generateRoadArchitectSession(terrainData, squareSize, levelName) {
  if (!terrainData?.osmFeatures?.length) return null;

  const roadNetwork = buildRoadNetwork(terrainData.osmFeatures.filter((feature) => {
    if (feature?.type !== 'road' || !Array.isArray(feature.geometry) || feature.geometry.length < 2) return false;
    const highway = feature.tags?.highway;
    return !!highway && !ROAD_SKIP.has(highway);
  }));

  const fourWayNodeKeys = new Set();
  for (const [nodeKey, entries] of roadNetwork.intersections.entries()) {
    const uniqueSegments = new Set(entries.map((entry) => entry.road.id));
    if (uniqueSegments.size >= 4) fourWayNodeKeys.add(nodeKey);
  }

  const roads = [];
  const intersectionEntries = new Map();

  for (const segmentFeature of roadNetwork.segments) {
    const feature = segmentFeature.sourceFeature;
    const tags = feature.tags || {};
    const highway = segmentFeature.highway;

    const style = HIGHWAY_STYLE[highway] ?? DEFAULT_ROAD_STYLE;
    const isOneWay = isOneWayRoad(tags);
    const halfWidth = estimateRoadHalfWidth(tags, highway, isOneWay, style.width);
    const laneCount = Math.max(1, getDefaultLaneCount(highway, isOneWay));
    const clippedSegments = clipGeometryToMargin(segmentFeature.geometry, terrainData.bounds)
      .flatMap((segment) => chunkPolyline(segment, 80));

    for (let segmentIndex = 0; segmentIndex < clippedSegments.length; segmentIndex++) {
      const segment = clippedSegments[segmentIndex];
      const nodes = segment.map((pt) => makeRoadArchitectNode(pt, terrainData, squareSize, halfWidth, laneCount));
      if (nodes.length < 2) continue;

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

      /**
       * Register one road endpoint as a candidate 4-way intersection approach.
       */
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

      if (segmentIndex === 0) addIntersectionEntry(segmentFeature.startKey, 'start');
      if (segmentIndex === clippedSegments.length - 1) addIntersectionEntry(segmentFeature.endKey, 'end');
    }
  }

  if (roads.length === 0) return null;

  const usedGroupNames = new Map();
  const placedGroups = roads.map((road, index) => {
    const baseName = sanitizeRoadFolderName(road?.displayName, `road_${index + 1}`);
    const used = usedGroupNames.get(baseName) || 0;
    usedGroupNames.set(baseName, used + 1);
    const groupName = used > 0 ? `${baseName}_${used + 1}` : baseName;
    const groupIndex = index + 1;
    road.groupIdx = [groupIndex];

    return {
      name: groupName,
      list: road.nodes.map((_, nodeIndex) => ({ r: road.name, n: nodeIndex + 1 })),
    };
  });

  return {
    data: {
      groups: [],
      junctions: [],
      mapName: String(levelName || 'mapng').toLowerCase(),
      placedGroups,
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
      .map(s => resampleGeometryToSpacing(s, ROAD_NODE_SPACING_M))
      .flatMap(s => chunkPolyline(s));

    for (const segment of clippedSegments) {
      const rawNodes = [];
      for (const pt of segment) {
        // geoToWorldPoint avoids geoToWorld's 0.1 m grid quantization (see
        // generateDecalRoads); nodes are mm-rounded below.
        const [wx, wy, wz] = geoToWorldPoint(pt.lat, pt.lng, terrainData, squareSize, 0.1);
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

      // Geometry was already resampled to ROAD_NODE_SPACING_M before world
      // conversion, but clip/chunk endpoints can still land within mm of a
      // neighbor — collapse those like the DecalRoad path does.
      const cleanRawNodes = sanitizeRoadNodes(rawNodes);
      if (cleanRawNodes.length < 2) continue;
      const nodes = cleanRawNodes.map(n => [n[0], n[1], n[2], n[3], 0.5, 0, 0, 1]);

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
  return objects
    .map((o) => {
      const { __items, ...rest } = o;
      return JSON.stringify(rest);
    })
    .join('\n') + '\n';
}

function writeSimGroupTree(zip, folderPath, items) {
  if (!Array.isArray(items) || items.length === 0) {
    zip.file(`${folderPath}/items.level.json`, '');
    return;
  }

  zip.file(`${folderPath}/items.level.json`, toNDJSON(items));

  for (const item of items) {
    if (item.class !== 'SimGroup') continue;
    if (!item.name) continue;
    if (!Array.isArray(item.__items)) continue;

    const childFolderPath = `${folderPath}/${item.name}`;
    zip.folder(childFolderPath);
    writeSimGroupTree(zip, childFolderPath, item.__items);
  }
}

const WATERWAY_WIDTHS = {
  river: 20,
  canal: 12,
  stream: 3.5,
  drain: 2.5,
  ditch: 1.5,
};

const WATERWAY_DEPTHS = {
  river: 6,
  canal: 4,
  stream: 1.2,
  drain: 1,
  ditch: 0.6,
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
  depthGradientTex: '/assets/materials/tileable/water/depthcolor_ramp/depthcolor_ramp_italy_muddy_b.png',
  foamAmbientLerp: 1.29999995,
  foamMaxDepth: 0.150000006,
  foamRippleInfluence: 0.0149999997,
  foamTex: '/assets/materials/tileable/water/water_effects/foam2_b.color.dds',
  fresnelBias: 0.2,
  fresnelPower: 20,
  fullReflect: false,
  gridElementSize: 1,
  gridSize: 1,
  overallRippleMagnitude: 0.2,
  overallWaveMagnitude: 0,
  reflectivity: 0.8,
  rippleTex: '/assets/materials/tileable/water/water_effects/ripple_nm.normal.dds',
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
  depthGradientTex: '/assets/materials/tileable/water/depthcolor_ramp/depthcolor_ramp_italy_rivers_b.png',
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
  rippleTex: '/assets/materials/tileable/water/water_effects/ripple3_nm.normal.dds',
  subdivideLength: 2,
  underwaterColor: [254, 253, 252, 250],
  waterFogDensity: 0.8,
  waterFogDensityOffset: 0,
  wetDarkening: 0.3,
  wetDepth: 0.35,
};

/**
 * Round a number to a fixed number of decimal places.
 */
function roundTo(value, places = 3) {
  const f = 10 ** places;
  return Math.round(value * f) / f;
}

/**
 * Format a finite number with fixed decimals, otherwise return "n/a".
 */
function formatNumber(value, places = 3) {
  if (!Number.isFinite(value)) return 'n/a';
  return Number(value).toFixed(places);
}

/**
 * Format truthy/falsey values as Yes/No for report output.
 */
function formatBool(value) {
  return value ? 'Yes' : 'No';
}

/**
 * Format a Date instance as ISO-8601, otherwise return "n/a".
 */
function formatIsoTimestamp(value) {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) return 'n/a';
  return value.toISOString();
}

/**
 * Format a duration in ms with human-readable units.
 */
function formatDurationMs(value) {
  if (!Number.isFinite(value)) return 'n/a';
  if (value >= 1000) return `${(value / 1000).toFixed(2)} s`;
  return `${Math.round(value)} ms`;
}

/**
 * Convert square meters to square kilometers for report display.
 */
function metersToKm2(value) {
  if (!Number.isFinite(value)) return 'n/a';
  return (value / 1_000_000).toFixed(3);
}

/**
 * Clamp a numeric value to the inclusive [min, max] range.
 */
function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

/**
 * Summarize OSM feature counts by feature type and basic geometry shape.
 */
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

/**
 * Build a human-readable elevation source label for export reports.
 */
function resolveElevationSourceLabel(terrainData, selectedElevationSource) {
  const explicit = typeof selectedElevationSource === 'string' ? selectedElevationSource.trim() : '';
  const normalized = explicit.toLowerCase();
  const sourceGeoTiffsSource = terrainData?.sourceGeoTiffs?.source;

  if (normalized === 'usgs') {
    return terrainData?.usgsFallback ? 'USGS requested, fell back to default/WGS84 source' : 'USGS';
  }
  if (normalized === 'gpxz') return 'GPXZ';
  if (normalized === 'kron86') {
    return terrainData?.kron86Fallback ? 'NMT EVRF2007 requested, fell back to default/WGS84 source' : 'NMT EVRF2007 (Poland)';
  }
  if (normalized === 'default') {
    return sourceGeoTiffsSource ? `Default (${String(sourceGeoTiffsSource).toUpperCase()})` : 'Default/WGS84';
  }
  if (explicit) return explicit;
  if (sourceGeoTiffsSource) return String(sourceGeoTiffsSource).toUpperCase();
  return 'Default/WGS84';
}

/**
 * Count valid vs no-data elevation samples from terrainData.heightMap.
 */
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

/**
 * Build the plaintext export diagnostics report bundled in the level zip.
 */
function buildBeamNGExportReport({
  terrainData,
  originalTerrainData,
  center,
  options,
  levelName,
  levelDisplayName,
  biome,
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
  const requestedProcessingMpp = Number(options?.requestedProcessingMetersPerPixel);
  const sourceProcessingMpp = Number(originalTerrainData?.processingMetersPerPixel);
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
    `- Biome: ${biome?.label || biome?.name || biome?.id || 'n/a'}`,
    `- Export started (UTC): ${formatIsoTimestamp(exportStartedAt)}`,
    `- Report generated (UTC): ${formatIsoTimestamp(reportGeneratedAt)}`,
    `- Processing time before ZIP compression: ${formatDurationMs(totalDurationMs)}`,
    '',
    'Terrain',
    `- Requested resolution: ${Number.isFinite(selectedResolution) ? `${selectedResolution} px` : 'n/a'}`,
    `- Requested processing resolution: ${Number.isFinite(requestedProcessingMpp) ? `${formatNumber(requestedProcessingMpp, 3)} m/px` : 'n/a'}`,
    `- Source processing resolution used: ${Number.isFinite(sourceProcessingMpp) ? `${formatNumber(sourceProcessingMpp, 3)} m/px` : 'n/a'}`,
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
    `- Normalized terrain size for BeamNG (square power-of-two): ${formatBool(didCropToSquare)}`,
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
    `- Include rocks: ${formatBool(options?.includeRocks)}`,
    '',
    'Generated Content',
    `- Terrain materials written: ${terrainMaterialCount}`,
    `- Road Architect roads generated: ${roadArchitectRoadCount}`,
    `- Road Architect junctions generated: ${roadArchitectJunctionCount}`,
    `- Barrier folders: ${barrierMeshSplineGroups.length}`,
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

/**
 * Load bundled MapNG flag assets from the static zip served at runtime.
 *
 * Returns an array of { path, data } entries ready to write into JSZip.
 */
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

/**
 * Load the bundled universal reflection cubemap faces (6 HDR DDS files).
 * Returns [{ path: 'cubemap/skyboxN.hdr.dds', data: Uint8Array }, ...].
 *
 * Faces are served as individual static files rather than one archive because
 * Cloudflare Workers caps a single static asset at 25 MiB; a combined zip
 * (~33 MiB) exceeds that and fails to deploy.
 */
async function loadMapngCubemapAsset() {
  const files = [];
  for (let i = 0; i < 6; i++) {
    const name = `skybox${i}.hdr.dds`;
    const response = await fetch(`/cubemap/${name}`);
    if (!response.ok) throw new Error(`Failed to load cubemap face ${name}: ${response.status}`);
    files.push({
      path: `cubemap/${name}`,
      data: new Uint8Array(await response.arrayBuffer()),
    });
  }
  return files;
}

/**
 * Build the CubemapData + Material defs for the bundled universal cubemap,
 * with cubeFace paths scoped to the export level. Fresh persistentIds avoid
 * collisions with other datablocks (see Datablocks.md).
 *
 * @param {string} levelName sanitized export level id
 */
function buildCubemapMaterialDefs(levelName) {
  const facePath = (i) =>
    `/levels/${levelName}/art/cubemaps/Universal_cubemap_reflection/cubemap/skybox${i}.hdr.dds`;
  return {
    cubemap_Universal_cubemap_reflection: {
      name: 'cubemap_Universal_cubemap_reflection',
      class: 'CubemapData',
      persistentId: generatePersistentId(),
      cubeFace: [facePath(0), facePath(1), facePath(2), facePath(3), facePath(4), facePath(5)],
    },
    Universal_cubemap_reflection: {
      name: 'Universal_cubemap_reflection',
      mapTo: 'unmapped_mat',
      class: 'Material',
      persistentId: generatePersistentId(),
      Stages: [{}, {}, {}, {}],
      cubemap: 'cubemap_Universal_cubemap_reflection',
      materialTag0: 'beamng',
      materialTag1: 'Natural',
      materialTag2: 'BNG_sky',
    },
  };
}

/**
 * Find the highest sampled terrain point and return world-space [x,y,z].
 */
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

/**
 * Check whether a point array forms a closed lat/lng ring.
 */
function isClosedRing(points) {
  if (!Array.isArray(points) || points.length < 4) return false;
  const a = points[0];
  const b = points[points.length - 1];
  return a.lat === b.lat && a.lng === b.lng;
}

/**
 * Sample terrain height at a lat/lng using bilinear interpolation.
 *
 * Returned value is world-space Z relative to terrain minHeight.
 */
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

/**
 * Convert a geographic point to BeamNG world-space coordinates.
 */
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

/**
 * Sample terrain height (relative to minHeight, like geoToWorldPoint's Z) at a
 * world-space X/Y position. Inverse of geoToWorldPoint's planar mapping:
 *   worldX = (u - 0.5) * worldSize ; worldY = (0.5 - v) * worldSize.
 */
function getTerrainHeightAtWorldXY(worldX, worldY, terrainData, squareSize) {
  const { bounds, width } = terrainData;
  const worldSize = width * squareSize;
  const u = worldX / worldSize + 0.5;
  const v = 0.5 - worldY / worldSize;
  const lat = bounds.north - v * (bounds.north - bounds.south);
  const lng = bounds.west + u * (bounds.east - bounds.west);
  return getTerrainHeightWorld(lat, lng, terrainData);
}

/**
 * Build a 3x3 Z-up rotation matrix from yaw radians.
 */
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
    shapeName: '/levels/east_coast_usa/art/shapes/buildings/eca_bld_wood_fence_a.DAE',
    segmentLength: 2,
    zOffset: 0.05,
    yawOffset: 0,
  },
  chainLinkFence: {
    // hirochi fence_pedestrian: a clean chain-link mesh with NO embedded
    // textures (unlike west_coast screenfence1.dae, which hardcodes a missing
    // catchfence_d.dds). Its `chainlink` material resolves from BeamNG's global
    // library + /assets/, so nothing extra needs bundling.
    shapeName: '/levels/hirochi_raceway/art/shapes/objects/fence_pedestrian.dae',
    // Mesh runs along its local Y axis (length ~2.0 m), like guardrail/jersey
    // which use +90° here and orient correctly, so match that. min Z ≈ -1.7.
    segmentLength: 2,
    zOffset: 1.7,
    yawOffset: Math.PI * 0.5,
  },
};

function buildCloudObjects(biome) {
  if (biome?.levelName !== 'east_coast_usa') return [];
  return [{
    __parent: 'sky_and_sun',
    name: 'clouds',
    class: 'CloudLayer',
    persistentId: generatePersistentId(),
    position: [547.21698, -452.971985, 609.744995],
    Textures: [
      { texDirection: null, texScale: 1.5, texSpeed: 0.00200000009 },
      { texDirection: [0.800000012, 0.200000003], texScale: 3, texSpeed: 0.0250000004 },
      { texDirection: [0.200000003, 0.5], texScale: 4, texSpeed: 0.0350000001 },
    ],
    baseColor: [0.996078014, 0.996078014, 0.996078014, 0.996078014],
    coverage: 1.20000005,
    exposure: 1.29999995,
    height: 3,
    texture: 'levels/east_coast_usa/art/skies/SkyNormals_05.dds',
    windSpeed: 0.200000003,
  }];
}

const MAX_NATIVE_BARRIER_OBJECTS = 8000;

/**
 * Resolve OSM barrier tags to one of the native BeamNG barrier asset presets.
 */
function resolveNativeBarrierAsset(tags = {}, biome = null) {
  const barrierType = String(tags.barrier ?? '').trim().toLowerCase();
  const material = String(tags.material ?? '').trim().toLowerCase();
  const levelName = String(biome?.levelName ?? '').toLowerCase();

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
    if (levelName && levelName !== 'east_coast_usa') {
      return NATIVE_BARRIER_ASSETS.chainLinkFence;
    }
    return NATIVE_BARRIER_ASSETS.fence;
  }

  if (barrierType === 'chain_link' || material === 'chain_link') {
    return NATIVE_BARRIER_ASSETS.chainLinkFence;
  }

  return NATIVE_BARRIER_ASSETS.guardrail;
}

/**
 * Convert OSM barrier features into BeamNG TSStatic barrier objects.
 *
 * Includes repeated segment placement and optional post/endcap meshes where
 * the selected barrier asset defines them.
 */
function buildNativeBarrierObjects(terrainData, squareSize, biome = null) {
  const features = terrainData.osmFeatures?.filter((feature) => (
    feature.type === 'barrier' && Array.isArray(feature.geometry) && feature.geometry.length >= 2
  )) ?? [];

  const objects = [];

  /**
   * Add one TSStatic barrier instance at a geographic point with yaw.
   */
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

  /**
   * Place repeated barrier panels along one OSM barrier polyline.
   */
  const pushFeatureInstances = (feature, asset, namePrefix) => {
    const geometry = Array.isArray(feature?.geometry) ? feature.geometry : [];
    if (geometry.length < 2) return;

    const segmentStarts = [];
    const segmentLengths = [];
    const cumulative = [0];
    let totalLen = 0;

    for (let i = 0; i < geometry.length - 1; i++) {
      const a = geometry[i];
      const b = geometry[i + 1];
      const wa = geoToWorldPoint(a.lat, a.lng, terrainData, squareSize, 0);
      const wb = geoToWorldPoint(b.lat, b.lng, terrainData, squareSize, 0);
      const dx = wb[0] - wa[0];
      const dy = wb[1] - wa[1];
      const len = Math.hypot(dx, dy);
      if (!Number.isFinite(len) || len < 0.01) continue;
      segmentStarts.push(i);
      segmentLengths.push(len);
      totalLen += len;
      cumulative.push(totalLen);
    }

    if (!Number.isFinite(totalLen) || totalLen < 0.5 || segmentStarts.length < 1) return;

    const isFenceAsset = String(asset?.shapeName || '').toLowerCase().includes('wood_fence');
    const nominalSpacing = Math.max(0.75, Number(asset.segmentLength) || 2);
    const panelCount = Math.max(1, Math.round(totalLen / nominalSpacing));
    const panelSpacing = totalLen / panelCount;

    /**
     * Sample interpolated geo/world coordinates and tangent at path distance.
     */
    const sampleAtDistance = (distance) => {
      const d = Math.max(0, Math.min(totalLen, distance));
      let segIdx = segmentLengths.length - 1;
      for (let i = 0; i < segmentLengths.length; i++) {
        if (d <= cumulative[i + 1]) {
          segIdx = i;
          break;
        }
      }
      const baseIdx = segmentStarts[segIdx];
      const a = geometry[baseIdx];
      const b = geometry[baseIdx + 1];
      const segStartDist = cumulative[segIdx];
      const segLen = segmentLengths[segIdx];
      const t = segLen > 1e-6 ? (d - segStartDist) / segLen : 0;
      const lat = a.lat + (b.lat - a.lat) * t;
      const lng = a.lng + (b.lng - a.lng) * t;
      const world = geoToWorldPoint(lat, lng, terrainData, squareSize, 0);
      const yaw = Math.atan2(b.lat - a.lat, b.lng - a.lng);
      return {
        lat,
        lng,
        x: world[0],
        y: world[1],
        terrainZ: getTerrainHeightWorld(lat, lng, terrainData),
        yaw,
      };
    };

    for (let i = 0; i < panelCount; i++) {
      if (objects.length >= MAX_NATIVE_BARRIER_OBJECTS) return;
      const startSample = sampleAtDistance(i * panelSpacing);
      const endSample = sampleAtDistance((i + 1) * panelSpacing);
      const centerSample = sampleAtDistance((i + 0.5) * panelSpacing);
      const rotationYaw = centerSample.yaw + (Number.isFinite(asset.yawOffset) ? asset.yawOffset : 0);
      const panelTerrainZ = isFenceAsset
        ? Math.max(startSample.terrainZ, endSample.terrainZ, centerSample.terrainZ)
        : centerSample.terrainZ;
      objects.push({
        __parent: 'Barriers',
        class: 'TSStatic',
        name: `${namePrefix}_${i + 1}`,
        persistentId: generatePersistentId(),
        position: [
          roundTo(centerSample.x, 3),
          roundTo(centerSample.y, 3),
          roundTo(panelTerrainZ + (Number.isFinite(asset.zOffset) ? asset.zOffset : 0), 3),
        ],
        rotationMatrix: rotationMatrixFromYaw(rotationYaw),
        shapeName: asset.shapeName,
        useInstanceRenderData: true,
      });
    }

    if (asset.postShapeName) {
      const isClosed = isClosedRing(geometry);
      const postCount = isClosed ? panelCount : panelCount + 1;
      for (let i = 0; i < postCount; i++) {
        if (objects.length >= MAX_NATIVE_BARRIER_OBJECTS) return;
        const sample = sampleAtDistance(i * panelSpacing);
        const rotationYaw = sample.yaw + (Number.isFinite(asset.yawOffset) ? asset.yawOffset : 0);
        objects.push({
          __parent: 'Barriers',
          class: 'TSStatic',
          name: `${namePrefix}_post_${i + 1}`,
          persistentId: generatePersistentId(),
          position: [
            roundTo(sample.x, 3),
            roundTo(sample.y, 3),
            roundTo(sample.terrainZ + (Number.isFinite(asset.postZOffset) ? asset.postZOffset : asset.zOffset), 3),
          ],
          rotationMatrix: rotationMatrixFromYaw(rotationYaw),
          shapeName: asset.postShapeName,
          useInstanceRenderData: true,
        });
      }
    }
  };

  /**
   * Place optional guardrail endcap meshes at both barrier endpoints.
   */
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
    const asset = resolveNativeBarrierAsset(feature.tags || {}, biome);
    if (!asset) continue;

    pushFeatureInstances(feature, asset, `barrier_${featureIndex}`);

    if (asset.endShapeName && objects.length < MAX_NATIVE_BARRIER_OBJECTS) {
      pushGuardrailEndcaps(feature, asset, featureIndex);
    }
  }

  return objects;
}

/**
 * Clone barrier TSStatic objects for folder-level JSON items output.
 */
function buildBarrierFolderItems(barrierObjects) {
  if (!Array.isArray(barrierObjects) || barrierObjects.length === 0) return [];
  return barrierObjects.map((obj, index) => ({
    ...obj,
    __parent: 'barriers',
    name: String(obj?.name || `barrier_${index + 1}`),
    isRenderEnabled: false,
  }));
}

// Native BeamNG sign meshes, referenced from official level art via .link files
// (no mesh bundled). The east_coast_usa signs_usa set is a clean, generic
// traffic-sign library suitable for any biome.
const NATIVE_SIGN_ASSETS = {
  stop: { shapeName: '/levels/east_coast_usa/art/shapes/signs_usa/sign_stop.dae' },
  give_way: { shapeName: '/levels/east_coast_usa/art/shapes/signs_usa/sign_yield.dae' },
};

const MAX_NATIVE_SIGN_OBJECTS = 4000;

// Material definitions used by the signs_usa meshes. Linking only the .dae gets
// the geometry but leaves the sign faces bare metal because the `signs_usa`
// material (the painted texture atlas) and the `eca_bld_metalbeams` pole
// material are never provided.
//
// Texture maps point at the SHARED /assets/ folder directly (BeamNG 0.37+).
// In the game the level-scoped paths (levels/east_coast_usa/.../*.dds) are now
// just *.dds.link redirects into /assets/, so referencing the level path only
// works if that redirect file is also present. The /assets/ paths are global,
// install-guaranteed, and independent of which base level is installed, so we
// reference them directly. See ASSET_TEXTURE_PATHS / docs assets-folder note.
function getSignRuntimeMaterialDefs() {
  return {
    signs_usa: {
      name: 'signs_usa',
      mapTo: 'signs_usa',
      class: 'Material',
      Stages: [
        {
          colorMap: '/assets/materials/signage/signs_usa/eca_roadsigns_d.dds',
          specularMap: '/assets/materials/signage/signs_usa/eca_roadsigns_s.dds',
          pixelSpecular: true,
          roughnessFactor: 0.607767701,
          useAnisotropic: true,
          vertColor: true,
        },
        {}, {}, {},
      ],
      alphaRef: 64,
      alphaTest: true,
      annotation: 'TRAFFIC_SIGNS',
      groundType: 'METAL',
      materialTag0: 'beamng',
      materialTag1: 'vehicle',
      translucentBlendOp: 'None',
    },
    eca_bld_metalbeams: {
      name: 'eca_bld_metalbeams',
      mapTo: 'eca_bld_metalbeams',
      class: 'Material',
      Stages: [
        {
          colorMap: '/assets/materials/trim/metal/eca_bld_metalbeams/eca_bld_metalbeams_d.dds',
          normalMap: '/assets/materials/trim/metal/eca_bld_metalbeams/eca_bld_metalbeams_n.dds',
          specularMap: '/assets/materials/trim/metal/eca_bld_metalbeams/eca_bld_metalbeams_s.dds',
          detailMap: '/assets/materials/trim/metal/eca_bld_metalbeams/detail_grunge_01_low_desat.dds',
          detailScale: [0.2, 0.2],
          useAnisotropic: true,
        },
        {}, {}, {},
      ],
      annotation: 'TRAFFIC_SIGNS',
      groundType: 'METAL',
      materialTag0: 'beamng',
      materialTag1: 'building',
      translucentBlendOp: 'None',
    },
  };
}

/**
 * Resolve an OSM point feature's tags to a native BeamNG sign asset.
 *
 * Only well-defined sign types map to a mesh; ambiguous `traffic_sign` nodes
 * return null (a wrong-meaning sign is worse than none). `traffic_signals`
 * nodes are handled by the signals system, not here.
 */
function resolveNativeSignAsset(tags = {}) {
  const highway = String(tags.highway ?? '').trim().toLowerCase();
  if (highway === 'stop') return NATIVE_SIGN_ASSETS.stop;
  if (highway === 'give_way') return NATIVE_SIGN_ASSETS.give_way;
  return null;
}

/**
 * Project a world-space point onto the nearest road polyline and return the
 * closest point, the road tangent there, and the perpendicular distance.
 *
 * roads: [{ pts: [[x,y], …], halfWidth }]. Returns null if no road is near.
 */
function findNearestRoad(px, py, roads, maxSearch) {
  let best = null;
  for (const road of roads) {
    const pts = road.pts;
    for (let i = 0; i + 1 < pts.length; i++) {
      const ax = pts[i][0], ay = pts[i][1];
      const bx = pts[i + 1][0], by = pts[i + 1][1];
      const dx = bx - ax, dy = by - ay;
      const segLen2 = dx * dx + dy * dy;
      if (segLen2 < 1e-9) continue;
      let t = ((px - ax) * dx + (py - ay) * dy) / segLen2;
      t = Math.max(0, Math.min(1, t));
      const cx = ax + t * dx, cy = ay + t * dy;
      const dist = Math.hypot(px - cx, py - cy);
      if (!best || dist < best.dist) {
        const len = Math.sqrt(segLen2);
        best = { dist, cx, cy, tx: dx / len, ty: dy / len, halfWidth: road.halfWidth };
      }
    }
  }
  if (!best || best.dist > maxSearch) return null;
  return best;
}

/**
 * Convert OSM stop/give_way point nodes into native BeamNG sign TSStatic
 * objects, replacing the procedural sign boxes that used to be baked into the
 * OSM objects DAE. Returned objects use `__parent: 'signs'` and are run through
 * the link registry by the caller.
 *
 * OSM tends to place sign nodes on the road centerline, which would leave signs
 * standing in the middle of the road. We offset each sign perpendicular to the
 * nearest road, out past its edge onto the shoulder, on the side that faces
 * approaching traffic (right side for right-hand-drive), and yaw the sign to
 * face back down the road toward oncoming vehicles.
 */
// Pre-project drivable roads to world-space polylines once for offset lookup
// (shared by sign and street-furniture placement).
function projectDrivableRoads(terrainData, squareSize) {
  const roads = [];
  for (const feature of terrainData.osmFeatures ?? []) {
    if (feature.type !== 'road' || !Array.isArray(feature.geometry) || feature.geometry.length < 2) continue;
    const highway = feature.tags?.highway;
    if (!highway || ['footway', 'path', 'pedestrian', 'steps', 'cycleway', 'bridleway', 'corridor'].includes(highway)) continue;
    const isOneWay = isOneWayRoad(feature.tags || {});
    const halfWidth = estimateRoadHalfWidth(feature.tags || {}, highway, isOneWay);
    const pts = feature.geometry
      .filter((p) => Number.isFinite(p?.lat) && Number.isFinite(p?.lng))
      .map((p) => geoToWorldPoint(p.lat, p.lng, terrainData, squareSize, 0));
    if (pts.length >= 2) roads.push({ pts, halfWidth });
  }
  return roads;
}

function buildNativeSignObjects(terrainData, squareSize, rightHandDrive = false) {
  const features = terrainData.osmFeatures?.filter((feature) => (
    feature.type === 'street_furniture'
    && Array.isArray(feature.geometry)
    && feature.geometry.length === 1
  )) ?? [];

  const roads = projectDrivableRoads(terrainData, squareSize);

  // Shoulder clearance beyond the road edge so the post sits off the asphalt.
  const SHOULDER_M = 1.5;
  // Cap the search so a sign far from any road isn't yanked across the map.
  const MAX_ROAD_SEARCH_M = 25;

  const objects = [];
  for (let i = 0; i < features.length; i++) {
    if (objects.length >= MAX_NATIVE_SIGN_OBJECTS) break;
    const feature = features[i];
    const asset = resolveNativeSignAsset(feature.tags || {});
    if (!asset) continue;
    const pt = feature.geometry[0];
    if (!Number.isFinite(pt?.lat) || !Number.isFinite(pt?.lng)) continue;
    const world = geoToWorldPoint(pt.lat, pt.lng, terrainData, squareSize, 0);

    let posX = world[0];
    let posY = world[1];
    let yaw = 0;

    const near = findNearestRoad(world[0], world[1], roads, MAX_ROAD_SEARCH_M);
    if (near) {
      // Perpendicular to the road tangent. Two candidates; pick the traffic side.
      // Right-hand-drive → signs face traffic from the right of travel direction.
      const side = rightHandDrive ? -1 : 1;
      const perpX = -near.ty * side;
      const perpY = near.tx * side;
      const offset = near.halfWidth + SHOULDER_M;
      // Offset from the road centerline point (not the original node) so signs
      // sit a consistent distance from the edge even if OSM placed them off-center.
      posX = near.cx + perpX * offset;
      posY = near.cy + perpY * offset;
      // Face the sign back toward oncoming traffic: look along -tangent for the
      // approach. Yaw measured so the sign's forward axis points at the road.
      yaw = Math.atan2(-perpY, -perpX);
    }

    const z = getTerrainHeightAtWorldXY(posX, posY, terrainData, squareSize);

    objects.push({
      __parent: 'signs',
      class: 'TSStatic',
      name: `sign_${i}`,
      persistentId: generatePersistentId(),
      position: [roundTo(posX, 3), roundTo(posY, 3), roundTo(z, 3)],
      rotationMatrix: rotationMatrixFromYaw(yaw),
      shapeName: asset.shapeName,
      useInstanceRenderData: true,
    });
  }
  return objects;
}

// Street furniture caps. BeamNG QA (Wonly): 25k+ lights per level are fine
// even on Steam Deck; the constraints that matter are no shadow-casting point
// lights and no heavy overlap — hence the min-spacing dedupe below.
const MAX_STREET_LAMPS = 20000;
const MAX_BENCHES = 5000;
const LAMP_MIN_SPACING_M = 2;

// Vanilla wcusa street lamp light (lightemitters_vintage sodium pairing,
// 400+ instances) — with castShadows forced off per QA guidance. isEnabled
// false + nightLight "1" makes the engine run them dusk-to-dawn, no lua.
const STREET_LAMP_LIGHT_TEMPLATE = {
  class: 'PointLight',
  attenuationRatio: [0, 0, 0],
  brightness: 0.0795774609,
  castShadows: false,
  color: [1, 0.474550009, 0.156189993, 1],
  intensity: 5000,
  isEnabled: false,
  nightLight: '1',
  radius: 15,
  useColorTemperature: 'true',
};

/**
 * Convert OSM street furniture nodes into native BeamNG objects:
 *   highway=street_lamp → biome lamp TSStatic + nightLight PointLight at the
 *                         luminaire (engine toggles it dusk-to-dawn)
 *   amenity=bench       → biome bench TSStatic
 *
 * Both orient toward the nearest drivable road (lamp arm over the roadway,
 * bench seat facing it); `direction`/`light:direction` tags win when present.
 * Wall/wire/ceiling-mounted lamps are skipped — their node marks a luminaire
 * with no pole, frequently in the middle of the carriageway.
 *
 * Replaces the procedural preview primitives that used to be baked into the
 * OSM objects DAE (see generateOSMObjectsDAE includeStreetFurniture: false).
 */
function buildStreetFurnitureObjects(terrainData, squareSize, biome) {
  const profile = getStreetFurnitureProfile(biome);
  if (!profile) return [];

  const features = terrainData.osmFeatures?.filter((feature) => (
    feature.type === 'street_furniture'
    && Array.isArray(feature.geometry)
    && feature.geometry.length === 1
  )) ?? [];
  if (features.length === 0) return [];

  const roads = projectDrivableRoads(terrainData, squareSize);
  const MAX_ROAD_SEARCH_M = 30;

  const objects = [];
  let lampCount = 0;
  let benchCount = 0;
  const lampCells = new Set();
  const cellKey = (x, y) => `${Math.round(x / LAMP_MIN_SPACING_M)},${Math.round(y / LAMP_MIN_SPACING_M)}`;

  for (let i = 0; i < features.length; i++) {
    const tags = features[i].tags || {};
    const isLamp = tags.highway === 'street_lamp';
    const isBench = !isLamp && tags.amenity === 'bench';
    if (!isLamp && !isBench) continue;
    if (isLamp && ['wall', 'wall_mounted', 'ceiling', 'wire'].includes(String(tags.support))) continue;
    if (isLamp && lampCount >= MAX_STREET_LAMPS) continue;
    if (isBench && benchCount >= MAX_BENCHES) continue;

    const pt = features[i].geometry[0];
    if (!Number.isFinite(pt?.lat) || !Number.isFinite(pt?.lng)) continue;
    const world = geoToWorldPoint(pt.lat, pt.lng, terrainData, squareSize, 0);
    const posX = world[0];
    const posY = world[1];

    const asset = isLamp ? profile.lamp : profile.bench;
    if (!asset?.shapeFile) continue;

    // Face the nearest road; explicit OSM direction tags override.
    let facing = null;
    const dirTag = tags['light:direction'] ?? tags.direction;
    const dirDeg = Number.parseFloat(dirTag);
    if (Number.isFinite(dirDeg)) {
      // OSM: 0 = north (+Y), 90 = east (+X) → math yaw from +X axis.
      facing = ((90 - dirDeg) * Math.PI) / 180;
    } else {
      const near = findNearestRoad(posX, posY, roads, MAX_ROAD_SEARCH_M);
      if (near) facing = Math.atan2(near.cy - posY, near.cx - posX);
    }
    if (facing === null) facing = 0;
    const yaw = facing + (asset.yawOffset ?? 0);

    if (isLamp) {
      const key = cellKey(posX, posY);
      if (lampCells.has(key)) continue;
      lampCells.add(key);
    }

    const z = getTerrainHeightAtWorldXY(posX, posY, terrainData, squareSize);
    const kind = isLamp ? 'street_lamp' : 'bench';
    objects.push({
      __parent: 'street_furniture',
      class: 'TSStatic',
      name: `${kind}_${i}`,
      persistentId: generatePersistentId(),
      position: [roundTo(posX, 3), roundTo(posY, 3), roundTo(z, 3)],
      rotationMatrix: rotationMatrixFromYaw(yaw),
      shapeName: asset.shapeFile,
      useInstanceRenderData: true,
    });

    if (isLamp) {
      lampCount++;
      const forward = asset.lightForward ?? 0;
      objects.push({
        __parent: 'street_furniture',
        name: `street_lamp_light_${i}`,
        persistentId: generatePersistentId(),
        position: [
          roundTo(posX + Math.cos(facing) * forward, 3),
          roundTo(posY + Math.sin(facing) * forward, 3),
          roundTo(z + (asset.lightHeight ?? 6), 3),
        ],
        ...STREET_LAMP_LIGHT_TEMPLATE,
      });
    } else {
      benchCount++;
    }
  }

  if (lampCount + benchCount > 0) {
    console.log(`[BeamNG Export] Street furniture: ${lampCount} lamps (+lights), ${benchCount} benches`);
  }
  return objects;
}

// Cap to keep pathological inputs from exploding the scene file.
const MAX_FUEL_STATIONS = 200;
const MAX_PUMPS_PER_STATION = 8;
// Real fuel_pump nodes are assigned to their nearest station within this radius.
const PUMP_ASSOC_RADIUS_M = 60;
// Search radius for snapping a station's pumps to the nearest drivable road.
const FUEL_ROAD_SEARCH_M = 45;

// Stock BeamNG meshes referenced (via .link) from the always-installed East
// Coast USA level. eca_gastation_pumps is a multi-pump island (one per station);
// eca_charging_station is a single charger unit (one per pump). Their materials
// are bundled by the caller via getFuelStationRuntimeMaterialDefs().
const FUEL_PUMP_SHAPE = '/levels/east_coast_usa/art/shapes/buildings/eca_gastation_pumps.DAE';
const EV_CHARGER_SHAPE = '/levels/east_coast_usa/art/shapes/buildings/eca_charging_station.DAE';

/**
 * Derive BeamNG energyTypes from OSM fuel:* tags. Charging stations are electric;
 * everything else defaults to a normal gasoline/diesel station with an `unknown`
 * fallback (see Fuel-Station-Setup.md §energy-types).
 */
function deriveEnergyTypes(tags = {}) {
  if (tags.amenity === 'charging_station') return ['electricEnergy'];
  const types = new Set();
  if (tags['fuel:diesel'] === 'yes' || tags['fuel:HGV_diesel'] === 'yes') types.add('diesel');
  const hasOctane = Object.keys(tags).some((k) => k.startsWith('fuel:octane_'));
  if (hasOctane || tags['fuel:gasoline'] === 'yes' || tags['fuel:e10'] === 'yes' || tags['fuel:e5'] === 'yes') {
    types.add('gasoline');
  }
  if (tags['fuel:electricity'] === 'yes') types.add('electricEnergy');
  // No specific pump tags → assume a normal dual-fuel station.
  if (!types.has('gasoline') && !types.has('diesel')) {
    types.add('gasoline');
    types.add('diesel');
  }
  types.add('unknown');
  return [...types];
}

/**
 * Turn OSM fuel/charging stations into working BeamNG fuel stations.
 *
 * Each pump becomes a BeamNGGameplayArea (the interaction volume the vehicle
 * overlaps to refuel) paired with a BeamNGPointOfInterest (the in-world/minimap
 * icon), per Fuel-Station-Setup.md. The pairs are referenced from the level's
 * facilities.facilities.json, which this also builds.
 *
 * Pump placement: when OSM provides `man_made=fuel_pump` nodes we use their real
 * positions; otherwise (the common case — station mapped as a single node/area)
 * we synthesize two pumps just off the nearest road so a vehicle can actually
 * pull alongside the gameplay area.
 *
 * Returns { objects, facilities } where `objects` are scene items parented to the
 * `gasStations` SimGroup and `facilities` are the gasStations entries.
 */
function buildFuelStations(terrainData, squareSize) {
  const features = terrainData.osmFeatures ?? [];
  const stations = features.filter((f) => (
    f.type === 'fuel_station'
    && Array.isArray(f.geometry)
    && f.geometry.length === 1
    && Number.isFinite(f.geometry[0]?.lat)
    && Number.isFinite(f.geometry[0]?.lng)
  ));
  if (stations.length === 0) return { objects: [], facilities: [] };

  // Project stations and pumps to world space once.
  const stationPts = stations.map((f) => geoToWorldPoint(f.geometry[0].lat, f.geometry[0].lng, terrainData, squareSize, 0));
  const pumpFeatures = features.filter((f) => (
    f.type === 'fuel_pump'
    && Array.isArray(f.geometry)
    && f.geometry.length === 1
    && Number.isFinite(f.geometry[0]?.lat)
    && Number.isFinite(f.geometry[0]?.lng)
  ));
  const pumpPts = pumpFeatures.map((f) => geoToWorldPoint(f.geometry[0].lat, f.geometry[0].lng, terrainData, squareSize, 0));

  // Assign each real pump to its nearest station within PUMP_ASSOC_RADIUS_M.
  const pumpsByStation = stations.map(() => []);
  for (let pi = 0; pi < pumpPts.length; pi++) {
    let bestSi = -1;
    let bestDist = PUMP_ASSOC_RADIUS_M;
    for (let si = 0; si < stationPts.length; si++) {
      const d = Math.hypot(pumpPts[pi][0] - stationPts[si][0], pumpPts[pi][1] - stationPts[si][1]);
      if (d < bestDist) { bestDist = d; bestSi = si; }
    }
    if (bestSi >= 0) pumpsByStation[bestSi].push(pumpPts[pi]);
  }

  // Pre-project drivable roads for offsetting synthesized pumps toward the road.
  const roads = [];
  for (const feature of features) {
    if (feature.type !== 'road' || !Array.isArray(feature.geometry) || feature.geometry.length < 2) continue;
    const highway = feature.tags?.highway;
    if (!highway || ['footway', 'path', 'pedestrian', 'steps', 'cycleway', 'bridleway', 'corridor'].includes(highway)) continue;
    const isOneWay = isOneWayRoad(feature.tags || {});
    const halfWidth = estimateRoadHalfWidth(feature.tags || {}, highway, isOneWay);
    const pts = feature.geometry
      .filter((p) => Number.isFinite(p?.lat) && Number.isFinite(p?.lng))
      .map((p) => geoToWorldPoint(p.lat, p.lng, terrainData, squareSize, 0));
    if (pts.length >= 2) roads.push({ pts, halfWidth });
  }

  const objects = [];
  const facilities = [];

  const limit = Math.min(stations.length, MAX_FUEL_STATIONS);
  for (let si = 0; si < limit; si++) {
    const feature = stations[si];
    const tags = feature.tags || {};
    const anchor = stationPts[si];
    const energyTypes = deriveEnergyTypes(tags);
    const isElectric = energyTypes.length === 1 && energyTypes[0] === 'electricEnergy';
    const stationName = tags.name || tags.brand
      || (isElectric ? `Charging Station ${si + 1}` : `Fuel Station ${si + 1}`);
    const stationId = `fuel_${si + 1}`;

    // Determine pump world positions and a yaw to align bays with the road.
    const near = findNearestRoad(anchor[0], anchor[1], roads, FUEL_ROAD_SEARCH_M);
    const bayYaw = near ? Math.atan2(near.ty, near.tx) : 0;
    let pumpPositions = pumpsByStation[si].slice(0, MAX_PUMPS_PER_STATION);

    if (pumpPositions.length === 0) {
      // Synthesize two pumps just off the nearest road so a vehicle can reach the
      // gameplay area. With no road nearby, fall back to the station anchor.
      let baseX = anchor[0];
      let baseY = anchor[1];
      let tx = 1, ty = 0;
      if (near) {
        // Unit vector from road centerline toward the station (which side to use).
        let nx = anchor[0] - near.cx;
        let ny = anchor[1] - near.cy;
        const nlen = Math.hypot(nx, ny) || 1;
        nx /= nlen; ny /= nlen;
        const offset = near.halfWidth + 3; // off the asphalt, onto the apron
        baseX = near.cx + nx * offset;
        baseY = near.cy + ny * offset;
        tx = near.tx; ty = near.ty;
      }
      pumpPositions = [
        [baseX - tx * 3, baseY - ty * 3],
        [baseX + tx * 3, baseY + ty * 3],
      ];
    }

    const pumpRefs = [];
    for (let pi = 0; pi < pumpPositions.length; pi++) {
      const [px, py] = pumpPositions[pi];
      const ground = getTerrainHeightAtWorldXY(px, py, terrainData, squareSize);
      const areaName = `${stationId}_pump_area_${pi + 1}`;
      const iconName = `${stationId}_pump_icon_${pi + 1}`;

      objects.push({
        __parent: 'gasStations',
        class: 'BeamNGGameplayArea',
        name: areaName,
        persistentId: generatePersistentId(),
        position: [roundTo(px, 3), roundTo(py, 3), roundTo(ground + 1.5, 3)],
        rotationMatrix: rotationMatrixFromYaw(bayYaw),
        scale: [5, 7, 4],
        area2D: false,
      });
      objects.push({
        __parent: 'gasStations',
        class: 'BeamNGPointOfInterest',
        name: iconName,
        persistentId: generatePersistentId(),
        position: [roundTo(px, 3), roundTo(py, 3), roundTo(ground + 2.5, 3)],
        title: stationName,
        desc: isElectric ? 'Electric charging station' : 'Fuel station',
        type: 'gasStation',
      });
      pumpRefs.push([areaName, iconName]);
    }

    // Visible mesh. Charging stations use one charger unit per pump; fuel
    // stations use a single pump-island mesh centered on the pump cluster.
    if (isElectric) {
      for (let pi = 0; pi < pumpPositions.length; pi++) {
        const [px, py] = pumpPositions[pi];
        const g = getTerrainHeightAtWorldXY(px, py, terrainData, squareSize);
        objects.push({
          __parent: 'gasStations',
          class: 'TSStatic',
          name: `${stationId}_charger_${pi + 1}`,
          persistentId: generatePersistentId(),
          position: [roundTo(px, 3), roundTo(py, 3), roundTo(g, 3)],
          rotationMatrix: rotationMatrixFromYaw(bayYaw),
          shapeName: EV_CHARGER_SHAPE,
          useInstanceRenderData: true,
        });
      }
    } else {
      const cx = pumpPositions.reduce((s, p) => s + p[0], 0) / pumpPositions.length;
      const cy = pumpPositions.reduce((s, p) => s + p[1], 0) / pumpPositions.length;
      const g = getTerrainHeightAtWorldXY(cx, cy, terrainData, squareSize);
      objects.push({
        __parent: 'gasStations',
        class: 'TSStatic',
        name: `${stationId}_pumps`,
        persistentId: generatePersistentId(),
        position: [roundTo(cx, 3), roundTo(cy, 3), roundTo(g, 3)],
        rotationMatrix: rotationMatrixFromYaw(bayYaw),
        shapeName: FUEL_PUMP_SHAPE,
        useInstanceRenderData: true,
      });
    }

    facilities.push({
      id: stationId,
      name: stationName,
      description: isElectric ? 'Electric charging station.' : 'Fuel station.',
      energyTypes,
      pumps: pumpRefs,
    });
  }

  return { objects, facilities };
}

/**
 * Sanitize user-facing road folder names for BeamNG file-safe usage.
 */
function sanitizeRoadFolderName(value, fallback) {
  const ascii = String(value || '')
    .normalize('NFKD')
    .replace(/[^\x00-\x7F]/g, '');
  const cleaned = ascii
    .replace(/[^A-Za-z0-9 _.-]/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 96);
  return cleaned || fallback;
}

/**
 * Sanitize a SimObject name for BeamNG/Torque constraints.
 * Name must not start with a digit and should stay compact.
 */
function sanitizeBeamNGObjectName(value, fallback = 'road') {
  const ascii = String(value || '')
    .normalize('NFKD')
    .replace(/[^\x00-\x7F]/g, '');
  let cleaned = ascii
    .replace(/[^A-Za-z0-9_]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '');

  if (!cleaned) cleaned = String(fallback || 'road').replace(/[^A-Za-z0-9_]/g, '_');
  if (!/^[A-Za-z_]/.test(cleaned)) cleaned = `r_${cleaned}`;
  if (cleaned.length > 48) cleaned = cleaned.slice(0, 48).replace(/_+$/g, '');
  return cleaned || 'road';
}

/**
 * Build road group folder metadata from a Road Architect session.
 */
function buildRoadFolderGroups(roadArchitectSession) {
  const placedGroups = Array.isArray(roadArchitectSession?.data?.placedGroups)
    ? roadArchitectSession.data.placedGroups
    : [];
  if (placedGroups.length > 0) {
    return placedGroups.map((group, index) => ({
      groupName: sanitizeRoadFolderName(group?.name, `road_${index + 1}`),
    }));
  }

  const roads = Array.isArray(roadArchitectSession?.data?.roads)
    ? roadArchitectSession.data.roads
    : [];
  if (roads.length === 0) return [];

  const usedNames = new Map();
  const groups = [];

  for (let i = 0; i < roads.length; i++) {
    const road = roads[i];
    const displayName = sanitizeRoadFolderName(road?.displayName, `road_${i + 1}`);
    const used = usedNames.get(displayName) || 0;
    usedNames.set(displayName, used + 1);
    const groupName = used > 0 ? `${displayName}_${used + 1}` : displayName;
    groups.push({ groupName });
  }

  return groups;
}

/**
 * Point-in-polygon test in geographic coordinates using ray casting.
 */
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

/**
 * Point-in-polygon test in world XY coordinates using ray casting.
 */
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

/**
 * Deterministic string hash (FNV-1a style) used for pseudo-random seeding.
 */
function hashString(value) {
  let hash = 2166136261;
  const input = String(value);
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

/**
 * Fast deterministic pseudo-random scalar in [0,1) from numeric seed.
 */
function seededRandom(seed) {
  const x = Math.sin(seed * 12.9898) * 43758.5453123;
  return x - Math.floor(x);
}

/**
 * Downsample a polyline to at most maxPoints while preserving endpoints.
 */
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

/**
 * Exclude ocean/marina-like water features from inland water generation.
 */
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

/**
 * Return percentile value from an ascending-sorted numeric array.
 */
function percentileValue(sortedValues, fraction) {
  if (!sortedValues.length) return 0;
  const idx = clamp(Math.floor((sortedValues.length - 1) * fraction), 0, sortedValues.length - 1);
  return sortedValues[idx];
}

/**
 * Compute a minimum-area oriented rectangle fit for polygon world points.
 *
 * Used to place WaterBlock primitives that best match OSM polygon footprint.
 */
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

/**
 * Build WaterBlock objects for closed inland water polygons.
 */
function buildWaterBlockObjects(terrainData, squareSize, biome) {
  const waterProfile = getWaterProfile(biome);
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

/**
 * Build one sea-level WaterPlane spanning the exported level.
 */
function buildSeaLevelWaterPlane(terrainData, biome, seaLevelOffset = 0) {
  const waterProfile = getWaterProfile(biome);
  const minHeight = Number(terrainData?.minHeight);
  const safeSeaLevelOffset = Number.isFinite(Number(seaLevelOffset)) ? Number(seaLevelOffset) : 0;
  // Terrain world-space Z is stored relative to min elevation, so sea level (0m)
  // sits at -minHeight in exported level coordinates.
  const seaLevelZ = (Number.isFinite(minHeight) ? -minHeight : 0) + safeSeaLevelOffset;
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

/**
 * Apply a simple 3-point moving average to a height sequence.
 */
function smoothHeights(heights) {
  if (heights.length < 3) return heights;
  const out = heights.slice();
  for (let i = 1; i < heights.length - 1; i++) {
    out[i] = (heights[i - 1] + heights[i] + heights[i + 1]) / 3;
  }
  return out;
}

/**
 * Parse a numeric width token (with optional units) or return fallback.
 */
function parseNumericWidth(value, fallback) {
  if (value == null) return fallback;
  const match = String(value).match(/[\d.]+/);
  const parsed = match ? parseFloat(match[0]) : NaN;
  return Number.isFinite(parsed) ? parsed : fallback;
}

/**
 * Build River objects for linear waterway OSM features.
 */
function buildRiverObjects(terrainData, squareSize, biome) {
  const waterProfile = getWaterProfile(biome);
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
    const width = Math.max(1.5, parseNumericWidth(feature.tags.width, fallbackWidth));
    const depth = WATERWAY_DEPTHS[feature.tags.waterway] ?? Math.max(0.6, width * 0.15);
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

/**
 * Clone managed forest templates by item name and assign fresh persistentIds.
 */
function cloneManagedItemData(itemNames, biome) {
  const out = {};
  for (const itemName of itemNames) {
    const template = getManagedForestTemplate(biome, itemName);
    if (!template) continue;
    out[itemName] = {
      ...structuredClone(template),
      persistentId: generatePersistentId(),
    };
  }
  return out;
}

/**
 * Build one managed-forest placement record at a geographic point.
 */
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

// Density multipliers were 2.5 (trees) / 2.0 (grass); together with the
// near-world-sized grass render radius below they made dense vegetation areas
// GPU-bound. 1.5/1.0 keeps coverage convincing at a fraction of the cost.
const BEAMNG_TREE_DENSITY_MULTIPLIER = 1.5;
const BEAMNG_GRASS_DENSITY_MULTIPLIER = 1.0;
const BEAMNG_MAX_FOREST_PLACEMENTS_PER_TYPE = 12000;
const BEAMNG_MAX_GROUNDCOVER_ELEMENTS = 650000;
const BEAMNG_MAX_GROUNDCOVER_OBJECTS = 48;
// Grass billboards are camera-relative: GroundCover generates elements out to
// `radius` meters from the viewer. Official levels keep this around 80–160 m;
// grass beyond that is invisible anyway and is pure overdraw.
const BEAMNG_GROUNDCOVER_MAX_RADIUS = 160;

// A GroundCover object spreads `maxElements` across a gridSize×gridSize grid of
// cells, so per-cell density is maxElements / gridSize². BeamNG warns
// ("has too many elements") and culls when a cell exceeds its per-cell billboard
// cap. Shipped levels stay at/under ~10,000 elements per cell (e.g. gridSize 8 /
// maxElements 640,000). Pick the smallest gridSize that keeps per-cell density
// under this budget so dense fields don't overflow their cells.
const BEAMNG_MAX_GROUNDCOVER_PER_CELL = 10000;
function gridSizeForElements(maxElements, minGridSize = 2) {
  const needed = Math.ceil(Math.sqrt(Math.max(1, maxElements) / BEAMNG_MAX_GROUNDCOVER_PER_CELL));
  return Math.max(minGridSize, needed);
}

// GroundCover renders billboards in a gridSize×gridSize grid of cells spanning the
// camera-relative `radius`. A cell re-populates as a single unit when the camera
// crosses into it, so oversized cells visibly "pop" in as blocks on a grid as you
// approach. Sizing gridSize purely from the per-cell element cap minimises gridSize
// and yields coarse cells (e.g. radius 160 / gridSize 6 ⇒ ~53 m cells). Official
// lush-grass covers instead keep cells ~25 m (Utah Grass_green: radius 100 /
// gridSize 8). Drive gridSize off the radius so cells stay ~25 m, while never
// dropping below the element-cap minimum (smaller cells only ever hold fewer
// elements, so the cap is never violated). Capped at 16 to bound per-object cost.
const BEAMNG_GROUNDCOVER_TARGET_CELL_M = 25;
function gridSizeForCover(radius, maxElements) {
  const cellDriven = Math.ceil((2 * radius) / BEAMNG_GROUNDCOVER_TARGET_CELL_M);
  return Math.min(16, Math.max(gridSizeForElements(maxElements), cellDriven));
}

/**
 * Randomly jitter a lat/lng point by up to N meters using deterministic seed.
 */
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

/**
 * Sample pseudo-random placements inside a polygon feature with hole support.
 */
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

/**
 * Build grouped BeamNG forest placements for trees, bushes, and optional rocks.
 *
 * Returns Map<managedForestType, placement[]>.
 */
function buildForestPlacements(terrainData, squareSize, { includeTrees, includeRocks }, biome) {
  const regularPlacementsByType = new Map();
  const priorityPlacementsByType = new Map();
  const treeDensityMultiplier = BEAMNG_TREE_DENSITY_MULTIPLIER;
  const bushDensityMultiplier = BEAMNG_TREE_DENSITY_MULTIPLIER;
  /**
   * Add a forest placement to priority or regular buckets with hard caps.
   */
  const pushPlacement = (placement, { priority = false } = {}) => {
    if (!getManagedForestTemplate(biome, placement.type)) return;
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
        const itemType = resolveTreeTypeForTags(biome, feature.tags || {});
        const isBush = feature.tags?.natural === 'shrub';
        const isTreeRow =
          feature.tags?.natural === 'tree_row' ||
          feature.tags?.tree_row === 'yes' ||
          feature.tags?.source_feature === 'tree_row';
        const resolvedType = isBush ? resolveBushType(biome) : itemType;
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
          const itemType = resolveTreeTypeForTags(biome, tags);
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
          const itemType = resolveBushType(biome, { hedge: tags.barrier === 'hedge' });
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
    const rockTypes = getRockCandidates(biome);
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

/**
 * Serialize forest placement maps into export file descriptors.
 */
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

/**
 * Build the line-delimited object list for main.forestbrushes4.json.
 *
 * For each placed forest item type, emit a ForestBrush container plus one
 * ForestBrushElement that references the matching ForestItemData. This makes
 * the World Editor Forest tool palette usable (the editor can re-paint the
 * same item types the export placed) instead of shipping an empty group.
 *
 * The trailing ForestBrushGroup SimGroup mirrors the official template
 * (refs/MapNG_template/levels/mapng_template/main.forestbrushes4.json).
 *
 * @param {string[]} itemNames managed ForestItemData keys actually placed
 * @returns {object[]} objects to serialize with toNDJSON
 */
function buildForestBrushItems(itemNames) {
  const items = [];
  for (const name of itemNames) {
    const brushName = `ForestBrush_${name}`;
    items.push({
      name: brushName,
      internalName: name,
      class: 'ForestBrush',
      persistentId: generatePersistentId(),
      __parent: 'ForestBrushGroup',
    });
    // No `name` on elements: sim object names are global, and naming the
    // element after its ForestItemData collides with that object on level
    // load. Vanilla brushes carry only internalName + forestItemData.
    items.push({
      internalName: name,
      class: 'ForestBrushElement',
      persistentId: generatePersistentId(),
      __parent: brushName,
      forestItemData: name,
      scaleMin: 0.85,
      scaleMax: 1.25,
    });
  }
  // The engine auto-creates ForestBrushGroup, but the official template ships
  // the SimGroup explicitly; keep parity for predictable editor behavior.
  items.push({
    name: 'ForestBrushGroup',
    class: 'SimGroup',
    persistentId: generatePersistentId(),
  });
  return items;
}

/**
 * Build GroundCover objects used to render broad grass coverage in BeamNG.
 */
function buildGroundCoverObjects(terrainData, squareSize, includeTrees, biome) {
  if (!includeTrees) return [];
  const groundCover = getGroundCoverProfile(biome);
  const grassClumpScale = Math.max(1, Math.sqrt(BEAMNG_GRASS_DENSITY_MULTIPLIER));
  const widthMeters = terrainData.width * squareSize;
  const heightMeters = terrainData.height * squareSize;
  // Cap the camera-relative render radius: 0.85× the world size (the old value)
  // drew grass billboards out to ~870 m on a 1 km map — the single biggest
  // vegetation GPU cost. ~160 m matches official-level groundcover ranges.
  const mapRadius = Math.max(60, Math.min(
    BEAMNG_GROUNDCOVER_MAX_RADIUS,
    roundTo(Math.min(widthMeters, heightMeters) * 0.85, 3),
  ));
  const centerHeight = getTerrainHeightWorld(
    (terrainData.bounds.north + terrainData.bounds.south) * 0.5,
    (terrainData.bounds.east + terrainData.bounds.west) * 0.5,
    terrainData,
  );

  const grassFeatures = (terrainData.osmFeatures || []).filter((feature) => {
    if (feature.type !== 'landuse') return false;
    if (!Array.isArray(feature.geometry) || feature.geometry.length < 3) return false;
    const tags = feature.tags || {};
    return (
      tags.landuse === 'grass'
      || tags.landuse === 'meadow'
      || tags.landuse === 'village_green'
      || tags.landuse === 'recreation_ground'
      || tags.landcover === 'grass'
      || tags.natural === 'grassland'
      || tags.leisure === 'park'
      || tags.leisure === 'garden'
      || tags.leisure === 'pitch'
      || tags.surface === 'grass'
    );
  });

  if (biome?.levelName === 'mapng_template') {
    const templateTypesLongGrass = [
      { billboardUVs: [0, 0, 0.545454562, 0.489090919], layer: 'Grass', probability: 0.300000012, sizeMax: 0.349999994, sizeMin: 0.200000003, windScale: 0.0500000007 },
      { billboardUVs: [0.541666687, 0, 0.458333343, 0.487500012], clumpRadius: 2, layer: 'Grass', probability: 1, sizeMax: 0.400000006, sizeMin: 0.200000003, windScale: 0.0500000007 },
      { billboardUVs: [0, 0.497916669, 0.641666651, 0.487500012], layer: 'Grass', probability: 1, sizeMax: 0.349999994, sizeMin: 0.200000003, windScale: 0.0500000007 },
      { billboardUVs: [0.649999976, 0.502083361, 0.349999994, 0.491666675], layer: 'Grass', probability: 1, sizeMax: 0.300000012, sizeMin: 0.200000003, windScale: 0.0500000007 },
      { billboardUVs: [0.514583349, 0.0078125, 0.485416681, 0.464843988], probability: 0.400000006, sizeMax: 0.400000006, sizeMin: 0.300000012, windScale: 0.0500000007 },
      { billboardUVs: [0, 0, 0.550000012, 0.490999997], probability: 0.200000003, sizeMax: 0.300000012, sizeMin: 0.25, windScale: 0.0500000007 },
      { billboardUVs: [0.668749988, 0.522833228, 0.331250012, 0.466833383], probability: 0.300000012, sizeMax: 0.25, sizeMin: 0.200000003, windScale: 0.0500000007 },
      { billboardUVs: [0.496093988, 0.75, 0.503906012, 0.25], probability: null, sizeMax: 0.100000001, sizeMin: 0.0799999982, windScale: 0.0500000007 },
    ];
    const templateTypesFlowerGrass = [
      { billboardUVs: [0.808593988, 0.398436993, 0.191405997, 0.226560995], clumpExponent: null, clumpRadius: null, layer: 'Flowers', probability: 0.300000012, sizeMax: 0.449999988, sizeMin: 0.300000012, windScale: 0.200000003 },
      { billboardUVs: [0.644531012, 0.402345002, 0.203124002, 0.218749002], clumpExponent: -0.300000012, clumpRadius: 0.5, layer: 'Flowers', maxClumpCount: 2, minClumpCount: 2, probability: 0.5, sizeMax: 0.449999988, sizeMin: 0.349999994, windScale: 0.200000003 },
      { billboardUVs: [0, 0.359504849, 0.18020834, 0.205990344], clumpExponent: null, clumpRadius: null, layer: 'Flowers', maxClumpCount: 4, minClumpCount: 3, probability: 0.00999999978, sizeMax: 0.5, sizeMin: 0.419999987, windScale: 0.100000001 },
      { billboardUVs: [0.157237172, 0.704189062, 0.243769377, 0.289538532], clumpExponent: null, clumpRadius: 0.5, maxClumpCount: 4, minClumpCount: 2, probability: 0.100000001, sizeMax: 0.550000012, sizeMin: 0.449999988, windScale: 0.100000001 },
      { billboardUVs: [0.327467173, 0.367344826, 0.30659467, 0.317013353], clumpExponent: -0.100000001, clumpRadius: null, maxClumpCount: 5, minClumpCount: 2, probability: 0.150000006, sizeMax: 0.800000012, sizeMin: 0.5, windScale: 0.200000003 },
      {}, {}, {},
    ];

    const templateObjects = [];
    const emitTemplateCover = ({ centerLat, centerLng, radius, areaSqM, material, types, seed }) => {
      const [x, y] = geoToWorldPoint(centerLat, centerLng, terrainData, squareSize, 0);
      templateObjects.push({
        __parent: 'vegetation',
        class: 'GroundCover',
        name: `mapng_template_cover_${templateObjects.length + 1}`,
        persistentId: generatePersistentId(),
        position: [roundTo(x, 3), roundTo(y, 3), roundTo(getTerrainHeightWorld(centerLat, centerLng, terrainData), 3)],
        material,
        Types: types,
        dissolveRadius: Math.max(30, roundTo(radius * 0.75, 3)),
        gridSize: gridSizeForCover(radius, Math.min(400000, Math.max(90000, Math.round(areaSqM * 1.9)))),
        maxBillboardTiltAngle: 60,
        maxElements: Math.min(400000, Math.max(90000, Math.round(areaSqM * 1.9))),
        noShapes: true,
        radius: roundTo(radius, 3),
        seed,
        shapeCullRadius: roundTo(Math.max(29, radius * 0.98), 3),
        shapesCastShadows: false,
        windGustFrequency: 0.100000001,
        windGustLength: 0.5,
        windGustStrength: 0.0500000007,
        windTurbulenceFrequency: 0.5,
        windTurbulenceStrength: 0.100000001,
      });
    };

    for (const feature of grassFeatures.slice(0, BEAMNG_MAX_GROUNDCOVER_OBJECTS)) {
      const ring = isClosedRing(feature.geometry) ? feature.geometry.slice(0, -1) : feature.geometry;
      if (ring.length < 3) continue;
      let centerLat = 0;
      let centerLng = 0;
      const worldPoints = [];
      for (const pt of ring) {
        centerLat += pt.lat;
        centerLng += pt.lng;
        worldPoints.push(geoToWorldPoint(pt.lat, pt.lng, terrainData, squareSize, 0));
      }
      centerLat /= ring.length;
      centerLng /= ring.length;

      let areaSqM = 0;
      for (let i = 0; i < worldPoints.length; i++) {
        const a = worldPoints[i];
        const b = worldPoints[(i + 1) % worldPoints.length];
        areaSqM += (a[0] * b[1]) - (b[0] * a[1]);
      }
      areaSqM = Math.abs(areaSqM) * 0.5;
      if (!Number.isFinite(areaSqM) || areaSqM < 180) continue;

      const radius = Math.max(24, Math.min(130, Math.sqrt(areaSqM / Math.PI) * 1.1));
      const tags = feature.tags || {};
      const isFlowerLike = tags.landuse === 'meadow' || tags.leisure === 'garden';
      emitTemplateCover({
        centerLat,
        centerLng,
        radius,
        areaSqM,
        material: isFlowerLike ? 'GC_Flowers_1' : (templateObjects.length % 2 === 0 ? 'GC_Grass_close' : 'GC_Grass_close_2'),
        types: isFlowerLike ? templateTypesFlowerGrass : templateTypesLongGrass,
        seed: 10 + templateObjects.length,
      });
    }

    if (templateObjects.length === 0) {
      emitTemplateCover({
        centerLat: (terrainData.bounds.north + terrainData.bounds.south) * 0.5,
        centerLng: (terrainData.bounds.east + terrainData.bounds.west) * 0.5,
        radius: 80,
        areaSqM: Math.max(25000, widthMeters * heightMeters * 0.08),
        material: 'GC_Grass_close',
        types: templateTypesLongGrass,
        seed: 17,
      });
    }

    return templateObjects;
  }

  const buildGrassTypes = (scaleMultiplier = 1) => {
    const clumpScale = grassClumpScale * scaleMultiplier;
    const grassTypes = [
      {
        billboardUVs: [0.496093988, 0, 0.503906012, 0.47656101],
        clumpRadius: 1.5,
        layer: groundCover.terrainLayer,
        maxClumpCount: Math.round(10 * clumpScale),
        minClumpCount: Math.round(4 * clumpScale),
        probability: 1,
        sizeMax: 0.7,
        sizeMin: 0.42,
        windScale: 0.08,
      },
      {
        billboardUVs: [0, 0, 0.507812023, 0.488281012],
        layer: groundCover.terrainLayer,
        maxClumpCount: Math.round(8 * clumpScale),
        minClumpCount: Math.round(3 * clumpScale),
        probability: 0.7,
        sizeMax: 0.65,
        sizeMin: 0.38,
        windScale: 0.08,
      },
      {
        billboardUVs: [0, 0.50781101, 0.5, 0.49218899],
        layer: groundCover.terrainLayer,
        maxClumpCount: Math.round(7 * clumpScale),
        minClumpCount: Math.round(3 * clumpScale),
        probability: 0.55,
        sizeMax: 0.58,
        sizeMin: 0.34,
        windScale: 0.08,
      },
      {
        billboardUVs: [0.5, 0.503906012, 0.5, 0.496093988],
        clumpRadius: 0.35,
        layer: groundCover.terrainLayer,
        maxClumpCount: Math.round(8 * clumpScale),
        minClumpCount: Math.round(3 * clumpScale),
        probability: 0.45,
        sizeMax: 0.52,
        sizeMin: 0.32,
        windScale: 0.08,
      },
    ];
    // The hardcoded UVs above are calibrated to east_coast's grass atlas. Each biome's
    // grass texture lays its sprites out differently, so applying these rects to another
    // biome's texture lands the billboard's base on empty padding → the grass floats
    // above the terrain. When the biome profile supplies bottom-anchored sub-rects, use
    // them (cycling if fewer than the slot count) so every billboard plants on the ground.
    const sprites = groundCover.grassSprites;
    if (Array.isArray(sprites) && sprites.length) {
      grassTypes.forEach((type, i) => {
        type.billboardUVs = sprites[i % sprites.length];
      });
    }
    return [...grassTypes, {}, {}, {}, {}];
  };

  const baseCoverMaxElements = Math.min(
    BEAMNG_MAX_GROUNDCOVER_ELEMENTS,
    Math.max(
      180000,
      Math.round(((widthMeters * heightMeters) / 3.2) * BEAMNG_GRASS_DENSITY_MULTIPLIER),
    ),
  );
  const groundCoverObjects = [{
    __parent: 'vegetation',
    class: 'GroundCover',
    name: 'mapng_grass_cover',
    persistentId: generatePersistentId(),
    position: [0, 0, roundTo(centerHeight, 3)],
    material: groundCover.materialName,
    gridSize: gridSizeForCover(mapRadius, baseCoverMaxElements),
    radius: mapRadius,
    // Fade only near the placement edge so grass stays visible far out, instead
    // of dissolving at ~0.65·radius.
    dissolveRadius: Math.max(80, roundTo(mapRadius * 0.92, 3)),
    shapeCullRadius: mapRadius,
    maxBillboardTiltAngle: 40,
    maxElements: baseCoverMaxElements,
    windGustLength: 1.7,
    windGustStrength: 0.1,
    // windGustFrequency drives gust recurrence and windTurbulenceStrength gives
    // the turbulence an amplitude — without the latter, windTurbulenceFrequency
    // alone produced no sway. Gentle values matched to the template-cover path;
    // stronger sway noticeably loads the GPU near dense grass.
    windGustFrequency: 0.1,
    windTurbulenceFrequency: 0.2,
    windTurbulenceStrength: 0.05,
    seed: 11,
    Types: buildGrassTypes(1),
  }];

  // ── Variety covers (east_coast_usa recipe) ─────────────────────────────────
  // Official levels layer several billboard covers with different atlases and
  // terrain-layer bindings instead of one uniform grass sheet. The UV rects
  // below are lifted from east_coast_usa's GroundCover objects (Weed2,
  // Forest_weed, Daisies, buttercups, small_grass_*); materials are the shared
  // core-asset defs from beamngRuntimeMaterialCatalog. Bindings:
  //  - 'Grass'     gets sparse weeds + occasional flowers on top of the grass.
  //  - 'DirtGrass' (OSM scrub/heath) gets dense weed clumps + dry short grass
  //    instead of lawn billboards.
  const varietyRadius = Math.max(60, Math.min(100, mapRadius));
  const varietyWind = {
    windGustLength: 1.7, windGustStrength: 0.1, windGustFrequency: 0.1,
    windTurbulenceFrequency: 0.2, windTurbulenceStrength: 0.05,
  };
  const weedElements = Math.min(220000, Math.max(60000, Math.round(baseCoverMaxElements * 0.5)));
  groundCoverObjects.push({
    __parent: 'vegetation',
    class: 'GroundCover',
    name: 'mapng_weed_cover',
    persistentId: generatePersistentId(),
    position: [0, 0, roundTo(centerHeight, 3)],
    material: 'mapng_gc_undergrowth',
    gridSize: gridSizeForCover(varietyRadius, weedElements),
    radius: varietyRadius,
    dissolveRadius: Math.max(50, roundTo(varietyRadius * 0.88, 3)),
    shapeCullRadius: varietyRadius,
    maxBillboardTiltAngle: 40,
    maxElements: weedElements,
    seed: 23,
    ...varietyWind,
    Types: [
      { billboardUVs: [0.40625, 0.707032025, 0.144529998, 0.128904998], layer: 'Grass',
        clumpExponent: -0.2, maxClumpCount: 4, minClumpCount: 2, probability: 0.45,
        sizeMax: 0.4, sizeMin: 0.2, windScale: 0.05 },
      { billboardUVs: [0.421875, 0.835937977, 0.140625998, 0.136718005], layer: 'Grass',
        clumpExponent: -0.2, maxClumpCount: 4, minClumpCount: 2, probability: 0.35,
        sizeMax: 0.4, sizeMin: 0.2, windScale: 0.05 },
      { billboardUVs: [0.410156012, 0.703125, 0.144530997, 0.128905997], layer: 'DirtGrass',
        clumpRadius: 3, maxClumpCount: 6, minClumpCount: 3, probability: 1,
        sizeMax: 0.6, sizeMin: 0.3, windScale: 0.05 },
      { billboardUVs: [0.417968005, 0.839843988, 0.148438007, 0.160155997], layer: 'DirtGrass',
        clumpExponent: -0.1, maxClumpCount: 5, minClumpCount: 2, probability: 1,
        sizeMax: 0.6, sizeMin: 0.3, windScale: 0.05 },
      {}, {}, {}, {},
    ],
  });

  const flowerElements = 40000;
  groundCoverObjects.push({
    __parent: 'vegetation',
    class: 'GroundCover',
    name: 'mapng_flower_cover',
    persistentId: generatePersistentId(),
    position: [0, 0, roundTo(centerHeight, 3)],
    material: 'mapng_gc_undergrowth',
    gridSize: gridSizeForCover(varietyRadius, flowerElements),
    radius: varietyRadius,
    dissolveRadius: Math.max(50, roundTo(varietyRadius * 0.88, 3)),
    shapeCullRadius: varietyRadius,
    maxBillboardTiltAngle: 40,
    maxElements: flowerElements,
    seed: 29,
    ...varietyWind,
    Types: [
      // Daisies + buttercups, kept rare so fields read green with accents.
      { billboardUVs: [0.199219003, 0.359376013, 0.140625, 0.128905997], layer: 'Grass',
        clumpExponent: 3, clumpRadius: 0.5, maxClumpCount: 4, minClumpCount: 2, probability: 1,
        sizeMax: 0.5, sizeMin: 0.3, windScale: 0.05 },
      { billboardUVs: [0.808593988, 0.398436993, 0.191405997, 0.226560995], layer: 'Grass',
        clumpRadius: 0.5, maxClumpCount: 4, minClumpCount: 2, probability: 0.5,
        sizeMax: 0.5, sizeMin: 0.4, windScale: 0.2 },
      { billboardUVs: [0.644531012, 0.402345002, 0.203124002, 0.218749002], layer: 'Grass',
        clumpRadius: 0.5, maxClumpCount: 4, minClumpCount: 2, probability: 0.35,
        sizeMax: 0.5, sizeMin: 0.4, windScale: 0.2 },
      {}, {}, {}, {}, {},
    ],
  });

  const dryGrassElements = Math.min(180000, Math.max(50000, Math.round(baseCoverMaxElements * 0.4)));
  groundCoverObjects.push({
    __parent: 'vegetation',
    class: 'GroundCover',
    name: 'mapng_dry_grass_cover',
    persistentId: generatePersistentId(),
    position: [0, 0, roundTo(centerHeight, 3)],
    material: 'mapng_gc_grass_dry',
    gridSize: gridSizeForElements(dryGrassElements),
    radius: varietyRadius,
    dissolveRadius: Math.max(50, roundTo(varietyRadius * 0.88, 3)),
    shapeCullRadius: varietyRadius,
    maxBillboardTiltAngle: 40,
    maxElements: dryGrassElements,
    seed: 31,
    ...varietyWind,
    Types: [
      { billboardUVs: [0, 0.0078125, 1, 0.464843988], layer: 'DirtGrass',
        clumpRadius: 2, maxClumpCount: 6, minClumpCount: 2, probability: 1,
        sizeMax: 0.45, sizeMin: 0.22, windScale: 0.1 },
      { billboardUVs: [0, 0.505124986, 1, 0.472656012], layer: 'DirtGrass',
        clumpExponent: -0.5, maxClumpCount: 4, minClumpCount: 2, probability: 0.8,
        sizeMax: 0.4, sizeMin: 0.2, windScale: 0.1 },
      { billboardUVs: [0, 0.507812977, 0.5, 0.390625], layer: 'Dirt',
        clumpExponent: -0.5, maxClumpCount: 4, minClumpCount: 2, probability: 0.4,
        sizeMax: 0.4, sizeMin: 0.25, windScale: 0.2 },
      {}, {}, {}, {}, {},
    ],
  });

  // Add dense per-area grass cover for OSM polygons tagged as grass-like fields.
  let areaObjectIndex = 0;
  for (const feature of grassFeatures) {
    if (groundCoverObjects.length >= BEAMNG_MAX_GROUNDCOVER_OBJECTS) break;
    const ring = isClosedRing(feature.geometry) ? feature.geometry.slice(0, -1) : feature.geometry;
    if (ring.length < 3) continue;

    let centroidLat = 0;
    let centroidLng = 0;
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    const worldPoints = [];

    for (const pt of ring) {
      centroidLat += pt.lat;
      centroidLng += pt.lng;
      const [x, y] = geoToWorldPoint(pt.lat, pt.lng, terrainData, squareSize, 0);
      worldPoints.push([x, y]);
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
    }

    centroidLat /= ring.length;
    centroidLng /= ring.length;

    let areaSqM = 0;
    for (let i = 0; i < worldPoints.length; i++) {
      const [x1, y1] = worldPoints[i];
      const [x2, y2] = worldPoints[(i + 1) % worldPoints.length];
      areaSqM += (x1 * y2) - (x2 * y1);
    }
    areaSqM = Math.abs(areaSqM) * 0.5;
    if (!Number.isFinite(areaSqM) || areaSqM < 120) continue;

    const approxRadius = Math.max(
      14,
      Math.min(
        BEAMNG_GROUNDCOVER_MAX_RADIUS,
        Math.max(
          Math.sqrt(areaSqM / Math.PI) * 1.3,
          Math.max(maxX - minX, maxY - minY) * 0.6,
        ),
      ),
    );
    const centerHeightWorld = getTerrainHeightWorld(centroidLat, centroidLng, terrainData);
    const [centerX, centerY] = geoToWorldPoint(centroidLat, centroidLng, terrainData, squareSize, 0);

    const fieldMaxElements = Math.min(
      BEAMNG_MAX_GROUNDCOVER_ELEMENTS,
      Math.max(50000, Math.round(areaSqM * 2.8 * BEAMNG_GRASS_DENSITY_MULTIPLIER)),
    );
    groundCoverObjects.push({
      __parent: 'vegetation',
      class: 'GroundCover',
      name: `mapng_grass_field_${++areaObjectIndex}`,
      persistentId: generatePersistentId(),
      position: [roundTo(centerX, 3), roundTo(centerY, 3), roundTo(centerHeightWorld, 3)],
      material: groundCover.materialName,
      gridSize: gridSizeForElements(fieldMaxElements),
      radius: roundTo(approxRadius, 3),
      dissolveRadius: roundTo(Math.max(40, approxRadius * 0.92), 3),
      shapeCullRadius: roundTo(Math.max(approxRadius, approxRadius * 1.25), 3),
      maxBillboardTiltAngle: 40,
      maxElements: fieldMaxElements,
      windGustLength: 1.7,
      windGustStrength: 0.1,
      windGustFrequency: 0.1,
      windTurbulenceFrequency: 0.2,
      windTurbulenceStrength: 0.05,
      seed: 100 + areaObjectIndex,
      Types: buildGrassTypes(1.25),
    });
  }

  return groundCoverObjects;
}

/**
 * Pump a JSZip internal stream into a writable stream with backpressure:
 * pause the zip stream while each chunk write is in flight so only one
 * chunk lives in the heap at a time.
 */
async function streamZipToWritable(zip, writable, onPercent) {
  const stream = zip.generateInternalStream({
    type: 'uint8array',
    compression: 'DEFLATE',
    streamFiles: true,
  });
  await new Promise((resolve, reject) => {
    let chain = Promise.resolve();
    stream.on('data', (chunk, metadata) => {
      stream.pause();
      chain = chain
        .then(() => writable.write(chunk))
        .then(() => {
          onPercent?.(metadata?.percent);
          stream.resume();
        })
        .catch(reject);
    });
    stream.on('error', reject);
    stream.on('end', () => { chain.then(resolve, reject); });
    stream.resume();
  });
}

const OPFS_EXPORT_DIR = 'beamng_exports';

/**
 * Stream the level zip into the Origin Private File System and return the
 * resulting disk-backed File (a Blob subclass — drop-in for the in-memory
 * path, including URL.createObjectURL downloads). Returns null when OPFS is
 * unavailable or anything fails, so the caller can fall back to the
 * in-memory generateAsync path.
 *
 * Earlier exports are cleaned up on a 1-hour TTL rather than immediately:
 * a File handed to the UI reads from the OPFS entry lazily, so deleting an
 * entry too eagerly could break a download still in progress.
 */
async function generateZipToOPFS(zip, filename, onPercent) {
  if (typeof navigator === 'undefined' || !navigator.storage?.getDirectory) return null;
  try {
    const root = await navigator.storage.getDirectory();
    const dir = await root.getDirectoryHandle(OPFS_EXPORT_DIR, { create: true });

    for await (const [name, handle] of dir.entries()) {
      if (name === filename) continue; // truncated by createWritable below
      try {
        const file = handle.kind === 'file' ? await handle.getFile() : null;
        if (!file || Date.now() - file.lastModified > 60 * 60 * 1000) {
          await dir.removeEntry(name, { recursive: true });
        }
      } catch { /* best-effort cleanup */ }
    }

    const fileHandle = await dir.getFileHandle(filename, { create: true });
    const writable = await fileHandle.createWritable();
    try {
      await streamZipToWritable(zip, writable, onPercent);
      await writable.close();
    } catch (e) {
      try { await writable.abort(); } catch { /* already failed */ }
      throw e;
    }
    return await fileHandle.getFile();
  } catch (e) {
    console.warn(`${BEAMNG_EXPORT_SERVICE_LOG} OPFS zip streaming unavailable/failed — using in-memory zip:`, e?.message || e);
    return null;
  }
}

/**
 * Generate a complete BeamNG level .zip from terrainData and center coordinates.
 *
 * ZIP structure:
 *   {levelName}.zip/
 *   └── levels/{levelName}/
 *       ├── info.json
 *       ├── map.json
 *       ├── signals.json
 *       ├── main.decals.json
 *       ├── main.forestbrushes4.json
 *       ├── mainLevel.lua
 *       ├── preview.png
 *       ├── terrain.terrain.json
 *       ├── art/terrains/
 *       │   ├── terrain.ter
 *       │   ├── terrain.terrainheightmap.png
 *       │   ├── terrain.png
 *       │   └── main.materials.json        (TerrainMaterial + TerrainMaterialTextureSet)
 *       ├── art/shapes/                    (present when OSM features or backdrop exist)
 *       │   ├── osm_objects.dae            (buildings, street furniture — optional)
 *       │   ├── terrain_backdrop.dae       (surrounding terrain mesh — optional)
 *       │   └── main.materials.json        (Materials for all DAEs in this folder)
 *       └── main/
 *           └── MissionGroup/
 *               ├── items.level.json
 *               ├── sky_and_sun/items.level.json
 *               ├── level_objects/items.level.json
 *               ├── PlayerDropPoints/
 *               │   └── items.level.json
 *               ├── AIWaypointsGroup/items.level.json
 *               ├── AIDecalWaypointsGroup/items.level.json
 *               ├── Water/items.level.json
 *               └── vegetation/items.level.json (optional)
 *
 * @param {object} terrainData
 * @param {object} center        — { lat, lng }
 * @param {object} [options]
 * @param {string}  [options.baseTexture='hybrid']         — 'none' | 'hybrid' | 'satellite' | 'osm' | 'painted'
 * @param {boolean} [options.includeBuildings=true]         — include generated OSM 3D objects (.dae)
 * @param {boolean} [options.applyFoundations=true]         — apply terrain foundation pass under buildings
 * @param {boolean} [options.includeBackdrop=false]         — fetch and include surrounding terrain backdrop DAE
 * @param {boolean} [options.includeWater=true]             — emit native BeamNG inland water objects
 * @param {boolean} [options.includeNativeBarriers=true]    — emit native BeamNG TSStatic barrier objects from OSM barriers into MissionGroup/barriers
 * @param {boolean} [options.includeTrees=true]             — emit native BeamNG tree and bush forest instances
 * @param {boolean} [options.includeRocks=false]            — emit native BeamNG rock forest instances
 * @param {string}  [options.biomeId]                      — BeamNG official level biome id
 * @param {string}  [options.levelName]                     — custom user-facing/generated level name
 * @param {string}  [options.country]                       — optional BeamNG traffic country key (e.g. levels.common.country.usa)
 * @param {boolean} [options.rightHandDrive]                — set true for left-side road traffic behavior
 * @param {'osm'|'image'|'none'} [options.pbrSource='osm'] — layer map source: 'osm' uses OSM polygon data,
 *   'image' is accepted for backward compatibility and falls back to OSM inference, 'none' disables PBR materials.
 *   Legacy boolean option `generatePbrMaterials` is still accepted for backward compatibility.
 * @param {number}  [options.seaLevelOffset=0]              — offset in meters applied to exported sea-level WaterPlane Z
 * @param {'decal'|'architect'|'mesh'|'none'} [options.roadType='decal'] — road system: layered DecalRoads (recommended),
 *   a Road Architect session, 3D MeshRoad geometry, or no generated roads
 */
export async function exportBeamNGLevel(terrainData, center, options = {}) {
  const {
    baseTexture = 'hybrid',
    includeBuildings = true,
    applyFoundations = true,
    includeBackdrop = false,
    includeWater = true,
    seaLevelOffset = 0,
    includeNativeBarriers = true,
    includeTrees = true,
    includeRocks = false,
    backdropElevationSource = 'global30m',
    backdropGpxzApiKey = '',
    // DecalRoads are the recommended road system: the community MapNG guide
    // calls Road Architect unstable for serious editing, and the single-tile UI
    // already defaults to 'decal'. Keep all entry points aligned on that.
    roadType = 'decal',
    biomeId,
    levelName: requestedLevelName = '',
    country,
    rightHandDrive,
    onProgress,
  } = options;
  // Backward compat: generatePbrMaterials (bool) → pbrSource (string)
  let pbrSource = options.pbrSource;
  if (pbrSource === undefined) {
    pbrSource = options.generatePbrMaterials === false ? 'none' : 'osm';
  }

  console.log(`${BEAMNG_EXPORT_SERVICE_LOG} Start exportBeamNGLevel`);
  console.log(`${BEAMNG_EXPORT_SERVICE_LOG} Input summary:`, {
    center,
    terrainWidth: terrainData?.width,
    terrainHeight: terrainData?.height,
    hasBounds: !!terrainData?.bounds,
    osmFeatureCount: Array.isArray(terrainData?.osmFeatures) ? terrainData.osmFeatures.length : null,
    options: {
      baseTexture,
      includeBuildings,
      applyFoundations,
      includeBackdrop,
      includeWater,
      seaLevelOffset,
      includeNativeBarriers,
      includeTrees,
      includeRocks,
      backdropElevationSource,
      roadType,
      biomeId,
      levelName: requestedLevelName,
      country,
      rightHandDrive,
      pbrSource,
    },
  });
  // Report progress and yield to the browser so UI updates and GC can run.
  /**
   * Emit progress callbacks consumed by the export UI.
   */
  const report = (step, pct) => {
    console.log(`${BEAMNG_EXPORT_SERVICE_LOG} Step`, { step, pct });
    onProgress?.({ step, pct });
  };
  /**
   * Yield one event-loop tick so UI paint and GC can run during long exports.
   */
  const yield_ = () => new Promise(r => setTimeout(r, 0));
  const exportStartedAt = new Date();
  const processingLog = [];
  let currentStep = null;
  let currentStepStartedAt = performance.now();
  /**
   * Start a timed processing step and close the previous one in the log.
   */
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
  /**
   * Finalize and flush the active timed step into the processing log.
   */
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

  // BeamNG TerrainBlock expects square power-of-two terrain dimensions.
  // Center-crop everything (heightmap, bounds, textures) so terrain, texture,
  // and OSM objects share the same footprint.
  let td = terrainData;
  const targetBeamNGSize = computeBeamNGTerrainSize(td.width, td.height);
  const didCropToSquare = td.width !== targetBeamNGSize || td.height !== targetBeamNGSize;
  if (didCropToSquare) {
    const cropSize = targetBeamNGSize;
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
  const levelName = sanitizeLevelId(levelDisplayName || fallbackLevelName);
  if (!/^[a-z_][a-z0-9_]{0,63}$/.test(levelName)) {
    throw new Error(`Generated invalid BeamNG level id: ${levelName}`);
  }
  const biome = getBeamNGBiomeById(biomeId);
  if (!biome) {
    console.error(`${BEAMNG_EXPORT_SERVICE_LOG} Invalid or missing biomeId.`, { biomeId });
    throw new Error(`Missing or invalid BeamNG biome: ${biomeId || '(none)'}`);
  }
  const trafficProfile = getTrafficProfile(biome);
  const resolvedCountry = typeof country === 'string' && country.trim().length > 0
    ? country.trim()
    : trafficProfile.country;
  const resolvedRightHandDrive = typeof rightHandDrive === 'boolean'
    ? rightHandDrive
    : trafficProfile.rightHandDrive;
  const linkRegistry = createBeamNGLinkFileRegistry(levelName);

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

  const roadArchitectSession = roadType === 'architect'
    ? generateRoadArchitectSession(exportTerrainData, squareSize, levelName)
    : null;
  const roadArchitectRoadCount = Array.isArray(roadArchitectSession?.data?.roads)
    ? roadArchitectSession.data.roads.length
    : 0;
  const roadArchitectJunctionCount = Array.isArray(roadArchitectSession?.data?.junctions)
    ? roadArchitectSession.data.junctions.length
    : 0;

  const meshRoads = roadType === 'mesh'
    ? generateMeshRoads(exportTerrainData, squareSize)
    : [];

  const decalRoads = roadType === 'decal'
    ? generateDecalRoads(exportTerrainData, squareSize)
    : [];

  const manualMapNavigation = buildManualMapNavigationData(exportTerrainData, squareSize, roadType);
  const manualMapSegmentCount = Object.keys(manualMapNavigation.segments).length;
  const { signalData, controllerDefinitions: signalControllerDefinitions } =
    buildBeamNGSignalExportBundle(exportTerrainData, squareSize);

  // Traffic support should reflect whether the export contains any road graph
  // source, either native DecalRoads or manual map.json segments.
  const supportsTraffic = decalRoads.length > 0 || manualMapSegmentCount > 0;

  const roadArchitectHeightmapBlob = roadArchitectSession
    ? generateRoadArchitectHeightmapPng(exportTerrainData, maxHeight)
    : null;

  // ── Sequential pipeline — one heavy operation at a time ────────────────────
  // Running everything in parallel (Promise.all) keeps multiple large buffers
  // alive simultaneously. Sequencing lets each blob be GC-eligible before the
  // next one is allocated, which is critical for 4096+ terrain grids.

  await yield_();
  // BeamNG terrain material libraries must match the selected terrain resolution.
  // Source textures may be generated/cached at lower sizes (e.g. 8192), so we
  // always target the current export grid size here.
  const terrainBaseTexSize = size;

  // Legacy image-based inference is no longer generated and now falls back to OSM.
  const imageCanvas = null;
  const effectivePbrSource = (pbrSource === 'image' && !imageCanvas) ? 'osm' : pbrSource;

  beginStep(`Painting terrain materials (${effectivePbrSource.toUpperCase()})…`, 5);
  const pbrResult = effectivePbrSource !== 'none'
    ? await buildTerrainMaterials(exportTerrainData, worldSize, levelName, biome, terrainBaseTexSize, {
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

  beginStep(`Generating base texture (${baseTexture}, ${terrainBaseTexSize}px)…`, 35);
  await yield_();
  let texBlob = await getTerrainTextureBlob(exportTerrainData, baseTexture);
  // terrain.png must be exactly baseTexSize pixels — TerrainBlock +
  // TerrainMaterialTextureSet expect a consistent base texture size.
  if (texBlob) {
    texBlob = await resizePngBlob(texBlob, terrainBaseTexSize);
  }

  beginStep(`Generating heightmap preview (${size}x${size})…`, 50);
  await yield_();
  let heightmapBlob = await generateHeightmapPng(exportTerrainData, size);

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
    buildSeaLevelWaterPlane(exportTerrainData, biome, seaLevelOffset),
    ...(includeWater
      ? [
          ...buildWaterBlockObjects(exportTerrainData, squareSize, biome),
          ...buildRiverObjects(exportTerrainData, squareSize, biome),
        ]
      : []),
  ];
  const cloudObjects = buildCloudObjects(biome);

  beginStep(`Building native barrier objects (${includeNativeBarriers ? 'enabled' : 'disabled'})…`, 74);
  await yield_();
  const barrierObjects = includeNativeBarriers
    ? buildNativeBarrierObjects(exportTerrainData, squareSize, biome)
    : [];
  const barrierFolderItems = buildBarrierFolderItems(barrierObjects);
  const signObjects = buildNativeSignObjects(exportTerrainData, squareSize, resolvedRightHandDrive);
  const streetFurnitureObjects = buildStreetFurnitureObjects(exportTerrainData, squareSize, biome);
  const { objects: fuelStationObjects, facilities: fuelStationFacilities } =
    buildFuelStations(exportTerrainData, squareSize);
  const roadFolderGroups = buildRoadFolderGroups(roadArchitectSession);
  const usesEastCoastFenceMaterials = barrierFolderItems.some((obj) => (
    String(obj?.shapeName || '').toLowerCase().includes('eca_bld_wood_fence_a.dae')
  ));

  beginStep(`Building vegetation objects (trees: ${includeTrees ? 'on' : 'off'}, rocks: ${includeRocks ? 'on' : 'off'})…`, 77);
  await yield_();
  const forestPlacements = (includeTrees || includeRocks)
    ? buildForestPlacements(exportTerrainData, squareSize, { includeTrees, includeRocks }, biome)
    : new Map();
  const forestFiles = serializeForestFiles(forestPlacements);
  const groundCoverObjects = buildGroundCoverObjects(exportTerrainData, squareSize, includeTrees, biome);
  const managedForestItemData = cloneManagedItemData(Array.from(forestPlacements.keys()), biome);

  let backdropDaeBlob = null;
  let backdropTextureFiles = [];
  let backdropMaterialNames = [];
  let backdropDiagnostics = null;
  if (includeBackdrop) {
    beginStep('Fetching terrain backdrop mesh…', 82);
    await yield_();
    const backdropResult = await generateTerrainBackdropDAE(exportTerrainData, worldSize, {
      elevationSource: backdropElevationSource,
      gpxzApiKey: backdropGpxzApiKey,
    });
    backdropDaeBlob = backdropResult?.daeBlob ?? null;
    backdropTextureFiles = backdropResult?.textureFiles ?? [];
    backdropMaterialNames = backdropResult?.materialNames ?? [];
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

  // Universal reflection cubemap. Bundled so reflections work without relying
  // on another level's cubemap datablock being globally registered. Falls back
  // to the biome's official cubemap name if the asset can't be loaded.
  let cubemapFiles = [];
  try {
    cubemapFiles = await loadMapngCubemapAsset();
  } catch (error) {
    console.warn('Failed to load universal cubemap asset, falling back to biome cubemap:', error);
  }
  const useUniversalCubemap = cubemapFiles.length > 0;

  beginStep(`Assembling ZIP archive (${levelName})…`, 88);
  await yield_();

  const zip = new JSZip();
  const base = `levels/${levelName}`;

  // Explicit directory entries so BeamNG's FS:directoryExists() works correctly
  zip.folder('levels');
  zip.folder(base);
  zip.folder(`${base}/art`);
  zip.folder(`${base}/art/cubemaps`);
  zip.folder(`${base}/art/decals`);
  zip.folder(`${base}/bat`);
  zip.folder(`${base}/art/prefabs`);
  zip.folder(`${base}/art/terrains`);
  zip.folder(`${base}/main`);
  zip.folder(`${base}/main/MissionGroup`);
  zip.folder(`${base}/main/MissionGroup/sky_and_sun`);
  zip.folder(`${base}/main/MissionGroup/level_objects`);
  zip.folder(`${base}/main/MissionGroup/AIWaypointsGroup`);
  zip.folder(`${base}/main/MissionGroup/AIDecalWaypointsGroup`);
  zip.folder(`${base}/main/MissionGroup/PlayerDropPoints`);
  zip.folder(`${base}/main/MissionGroup/CameraBookmarks`);
  zip.folder(`${base}/main/MissionGroup/Water`);
  if (barrierFolderItems.length > 0) {
    zip.folder(`${base}/main/MissionGroup/barriers`);
  }
  if (signObjects.length > 0) {
    zip.folder(`${base}/main/MissionGroup/signs`);
  }
  if (roadFolderGroups.length > 0) {
    zip.folder(`${base}/main/MissionGroup/roads`);
  }
  if (meshRoads.length > 0) {
    zip.folder(`${base}/main/MissionGroup/Mesh_roads`);
  }
  if (forestFiles.length > 0 || groundCoverObjects.length > 0) {
    zip.folder(`${base}/main/MissionGroup/vegetation`);
    zip.folder(`${base}/art/forest`);
    zip.folder(`${base}/forest`);
  }

  // ── info.json ──────────────────────────────────────────────────────────────
  const worldSizeMeters = Math.round(worldSize * 100) / 100;
  // Minimap: the satellite/PBR base color texture IS a north-up top-down image of
  // the level, so it doubles as the big-map/minimap tile (Level-Metadata.md
  // §minimap). offset = [west, north] corner = [-halfExtent, +halfExtent]; size is
  // the world extent in meters. Path is level-relative (prefixed at load time).
  const minimapHalfExtent = Math.round(halfExtent * 100) / 100;
  const minimapImageRel = 'art/terrains/terrain.png';

  zip.file(`${base}/info.json`, JSON.stringify({
    authors: 'mapng',
    biome: biome?.label || biome?.id || 'mapng',
    defaultSpawnPointName: 'spawn_default',
    description: `Generated by mapng at ${lat}, ${lng}`,
    features: 'Procedural OSM-driven roads, vegetation, water, and terrain.',
    previews: ['preview.png'],
    roads: roadType === 'architect' ? 'Road Architect roads from OSM' : 'OSM-derived roads',
    suitablefor: 'Freeroam, testing, and world-building',
    // BeamNG displays this as map dimensions in km; provide real-world meters.
    size: [worldSizeMeters, worldSizeMeters],
    spawnPoints: [{
      name: 'Default',
      objectname: 'spawn_default',
      preview: 'preview.png',
      translationId: 'Default Spawnpoint',
    }],
    title: levelDisplayName,
    supportsTraffic,
    supportsTimeOfDay: true,
    country: resolvedCountry,
    region: getRegionForCountry(resolvedCountry),
    roadRules: {
      rightHandDrive: resolvedRightHandDrive,
      turnOnRed: getTurnOnRedForCountry(resolvedCountry),
    },
    minimap: [{
      file: minimapImageRel,
      size: [worldSizeMeters, worldSizeMeters],
      offset: [-minimapHalfExtent, minimapHalfExtent],
    }],
  }, null, 2));

  // ── city.sites.json ───────────────────────────────────────────────────────
  // Seed a valid Sites Editor file so zones/parking can be authored without
  // creating boilerplate manually in BeamNG World Editor.
  zip.file(`${base}/city.sites.json`, JSON.stringify({
    description: 'Description of these Sites. Contains Locations and Zones.',
    dir: `/levels/${levelName}/`,
    filename: 'city.sites.json',
    locations: {},
    name: 'city.sites.json',
    parkingSpots: [],
    zones: [],
  }, null, 2));

  // ── map.json ───────────────────────────────────────────────────────────────
  zip.file(`${base}/map.json`, JSON.stringify({ segments: manualMapNavigation.segments }, null, 2));

  // ── signals.json ───────────────────────────────────────────────────────────
  // Generate OSM-driven signals when available; fall back to a valid empty schema.
  zip.file(`${base}/signals.json`, JSON.stringify(signalData, null, 2));
  if (signalControllerDefinitions) {
    zip.file(`${base}/signalControllerDefinitions.json`, JSON.stringify(signalControllerDefinitions, null, 2));
  }

  // ── art/decals + main.decals.json: turn-lane arrows ───────────────────────
  // Painted from OSM turn:lanes via the core road-markings atlas.
  const turnArrowInstances = roadType === 'decal'
    ? generateTurnArrowDecals(exportTerrainData, squareSize)
    : [];
  zip.file(`${base}/art/decals/managedDecalData.json`, JSON.stringify(
    turnArrowInstances.length > 0
      ? { [ROAD_ARROW_DECAL_DATA.name]: ROAD_ARROW_DECAL_DATA }
      : {},
    null, 2,
  ));
  if (turnArrowInstances.length > 0) {
    zip.file(`${base}/art/decals/main.materials.json`, JSON.stringify({
      [ROAD_ARROW_MATERIAL.name]: ROAD_ARROW_MATERIAL,
    }, null, 2));
  }
  zip.file(`${base}/main.decals.json`, JSON.stringify({
    header: {
      name: 'DecalData File',
      comments: '// Instances format: rectIdx, size, renderPriority, position.x, position.y, position.z, normal.x, normal.y, normal.z, tangent.x, tangent.y, tangent.z, uid',
      version: 2,
    },
    instances: turnArrowInstances.length > 0
      ? { [ROAD_ARROW_DECAL_DATA.name]: turnArrowInstances }
      : {},
  }, null, 2));

  // Forest brush palette: emit one ForestBrush/ForestBrushElement per placed
  // forest item type so the World Editor Forest tool can re-paint them. Falls
  // back to an empty ForestBrushGroup when the export has no vegetation.
  const forestBrushItemNames = Object.keys(managedForestItemData);
  zip.file(`${base}/main.forestbrushes4.json`,
    forestBrushItemNames.length > 0
      ? toNDJSON(buildForestBrushItems(forestBrushItemNames))
      : toNDJSON([
          {
            class: 'SimGroup',
            name: 'ForestBrushGroup',
            persistentId: generatePersistentId(),
          },
        ])
  );

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
    'local function moveRoadArchitectFolders(sessionData)',
    '  if not scenetree or not scenetree.MissionGroup then return end',
    '  local missionGroup = scenetree.MissionGroup',
    '  local roadsRoot = scenetree.findObject("roads")',
    '  if not roadsRoot then',
    '    roadsRoot = createObject("SimGroup")',
    '    roadsRoot:registerObject("roads")',
    '    missionGroup:addObject(roadsRoot)',
    '  end',
    '  local roads = (sessionData and sessionData.data and sessionData.data.roads) or {}',
    '  for i = 1, #roads do',
    '    local folder = scenetree.findObject("Road Architect - Road " .. tostring(i))',
    '    if folder then',
    '      roadsRoot:addObject(folder)',
    '    end',
    '  end',
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
    '    if scenetree and scenetree.findObject and scenetree.findObject("Road Architect - Road 1") then',
    '      raAutoLoadDone = true',
    '      return true',
    '    end',
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
    '      moveRoadArchitectFolders(sessionData)',
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

  const toZipBinary = async (value) => {
    if (!value) return value;
    if (value instanceof Uint8Array || value instanceof ArrayBuffer) return value;
    if (typeof value.arrayBuffer === 'function') {
      return new Uint8Array(await value.arrayBuffer());
    }
    return value;
  };

  const previewData = await toZipBinary(previewBlob);
  const roadArchitectHeightmapData = await toZipBinary(roadArchitectHeightmapBlob);
  const terrainBinaryData = await toZipBinary(terBlob);
  const terrainHeightmapData = await toZipBinary(heightmapBlob);
  const osmDaeData = await toZipBinary(osmDaeBlob);
  const backdropDaeData = await toZipBinary(backdropDaeBlob);
  const terrainTextureData = await toZipBinary(texBlob);

  // ── preview.png ────────────────────────────────────────────────────────────
  zip.file(`${base}/preview.png`, previewData);
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
      seaLevelOffset,
      includeNativeBarriers,
      includeTrees,
      includeRocks,
      requestedPbrSource: pbrSource,
      terrainMaterialNames: pbrResult?.materialNames ?? ['DefaultMaterial'],
    },
    levelName,
    levelDisplayName,
    biome,
    squareSize,
    satelliteTexSize: terrainBaseTexSize,
    worldSize,
    exportStartedAt,
    reportGeneratedAt,
    processingLog: processingLogSnapshot,
    effectivePbrSource,
    waterObjects,
    barrierObjects,
    barrierMeshSplineGroups: barrierFolderItems.length > 0
      ? [{ groupName: 'barriers' }]
      : [],
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
    if (roadArchitectHeightmapData) {
      zip.file(`${base}/bat/roadatchitectsession.png`, roadArchitectHeightmapData);
    }
  }

  const terrainBinaryPath = `${base}/art/terrains/terrain.ter`;
  const terrainHeightmapPath = `${base}/art/terrains/terrain.terrainheightmap.png`;
  const terrainBinaryVirtualPath = `/levels/${levelName}/art/terrains/terrain.ter`;
  const terrainHeightmapVirtualPath = `/levels/${levelName}/art/terrains/terrain.terrainheightmap.png`;

  // ── art/terrains/terrain.ter ───────────────────────────────────────────────
  zip.file(terrainBinaryPath, terrainBinaryData);

  // ── art/terrains/terrain.terrainheightmap.png ─────────────────────────────
  // Grayscale heightmap used by BeamNG's terrain system and World Editor.
  // Export at full terrain resolution so packaged heightmap dimensions match .ter.
  zip.file(terrainHeightmapPath, terrainHeightmapData);
  heightmapBlob = null;

  // ── map_assets/custom_assets/ (OSM 3D objects and/or terrain backdrop) ──────────────────
  if (osmDaeData || backdropDaeData || mapngFlagFiles.length > 0) {
    if (osmDaeData) {
      zip.folder(`${base}/map_assets/custom_assets/osm_objects`);
      zip.file(`${base}/map_assets/custom_assets/osm_objects/osm_objects.dae`, osmDaeData);
      zip.file(`${base}/map_assets/custom_assets/osm_objects/main.materials.json`, JSON.stringify({
        osm_object: {
          class: 'Material',
          name: 'osm_object',
          mapTo: 'osm_object',
          annotation: 'BUILDINGS',
          Stages: [{ diffuseColor: [1, 1, 1, 1], vertColor: true }],
          translucentBlendOp: 'None',
        }
      }, null, 2));
    }
    if (backdropDaeData) {
      zip.folder(`${base}/map_assets/custom_assets/terrain_backdrop`);
      zip.file(`${base}/map_assets/custom_assets/terrain_backdrop/terrain_backdrop.dae`, backdropDaeData);
      if (backdropTextureFiles.length > 0) {
        zip.folder(`${base}/map_assets/custom_assets/terrain_backdrop/Textures`);
        for (const tex of backdropTextureFiles) {
          zip.file(
            `${base}/map_assets/custom_assets/terrain_backdrop/Textures/${tex.name}.${tex.ext}`,
            await toZipBinary(tex.data),
          );
        }
      }

      // Build the material library so every tile the DAE references is defined —
      // textured where available, flat ground color where the satellite failed —
      // so no tile falls back to BeamNG's "NO TEXTURE" placeholder.
      const shapeMaterials = buildBackdropMaterialDefs(levelName, backdropTextureFiles, backdropMaterialNames);
      zip.file(`${base}/map_assets/custom_assets/terrain_backdrop/main.materials.json`, JSON.stringify(shapeMaterials, null, 2));
    }
    if (mapngFlagFiles.length > 0) {
      zip.folder(`${base}/map_assets/custom_assets/mapng_flag`);
      for (const asset of mapngFlagFiles) {
        const relativePath = asset.path.startsWith('mapng/') ? asset.path.slice('mapng/'.length) : asset.path;
        if (relativePath === 'main.materials.json') {
          const materialDefs = JSON.parse(new TextDecoder().decode(asset.data));
          if (materialDefs.mapng_flag?.Stages?.[0]) {
            materialDefs.mapng_flag.class = 'Material';
            materialDefs.mapng_flag.Stages[0].colorMap = `levels/${levelName}/map_assets/custom_assets/mapng_flag/mapng_flag_d.png`;
          }
          zip.file(`${base}/map_assets/custom_assets/mapng_flag/main.materials.json`, JSON.stringify(materialDefs, null, 2));
        } else {
          zip.file(`${base}/map_assets/custom_assets/mapng_flag/${relativePath}`, asset.data);
        }
      }
    }
  }

  // Write Biome materials (which used to be in art/shapes/) to map_assets/official_assets/biome_materials/
  // because they override official names without having specific meshes.
  const biomeRuntimeDefs = getBiomeRuntimeMaterialDefs(biome);
  zip.file(`${base}/map_assets/official_assets/biome_materials/main.materials.json`, JSON.stringify(biomeRuntimeDefs, null, 2));

  // Per-biome shape material defs harvested from the game install
  // (scripts/build-shape-material-library.py). Every material a placed .dae
  // binds must be defined by this export: the official level that owns the
  // shape is not loaded in-game, and undefined materials fall back to the
  // collada's embedded info, which resolves textures relative to the
  // link-mirrored shape folder (NO-TEXTURE trees). Curated runtime defs win
  // on name conflicts.
  const runtimeMaterialNames = new Set();
  for (const [key, def] of Object.entries(biomeRuntimeDefs)) {
    runtimeMaterialNames.add(key.toLowerCase());
    if (def?.mapTo) runtimeMaterialNames.add(String(def.mapTo).toLowerCase());
  }
  const shapeMaterialDefs = Object.fromEntries(
    Object.entries(await getShapeMaterialDefsForBiome(biome)).filter(([key, def]) => (
      !runtimeMaterialNames.has(key.toLowerCase())
      && !runtimeMaterialNames.has(String(def?.mapTo || '').toLowerCase())
    ))
  );
  if (Object.keys(shapeMaterialDefs).length > 0) {
    zip.file(`${base}/map_assets/official_assets/shape_materials/main.materials.json`, JSON.stringify(shapeMaterialDefs, null, 2));
  }

  // Sign paint materials (signs_usa atlas + metal pole). Without these the
  // linked sign meshes render as bare metal. See getSignRuntimeMaterialDefs.
  if (signObjects.length > 0) {
    zip.file(`${base}/map_assets/official_assets/signs_materials/main.materials.json`, JSON.stringify(getSignRuntimeMaterialDefs(), null, 2));
  }

  // Fuel station mesh materials (eca_gastation_pumps / eca_charging_station).
  // Without these the linked pump/charger meshes render untextured.
  if (fuelStationObjects.length > 0) {
    zip.file(`${base}/map_assets/official_assets/fuelstation_materials/main.materials.json`, JSON.stringify(getFuelStationRuntimeMaterialDefs(), null, 2));
  }

  // ── art/cubemaps/Universal_cubemap_reflection ─────────────────────────────
  // Bundled universal reflection cubemap + CubemapData/Material definition.
  if (useUniversalCubemap) {
    zip.folder(`${base}/art/cubemaps/Universal_cubemap_reflection`);
    zip.folder(`${base}/art/cubemaps/Universal_cubemap_reflection/cubemap`);
    for (const face of cubemapFiles) {
      zip.file(`${base}/art/cubemaps/Universal_cubemap_reflection/${face.path}`, face.data);
    }
    zip.file(
      `${base}/art/cubemaps/Universal_cubemap_reflection/main.materials.json`,
      JSON.stringify(buildCubemapMaterialDefs(levelName), null, 2),
    );
  }

  // ── art/terrains/terrain.png ───────────────────────────────────────────────
  zip.file(`${base}/art/terrains/terrain.png`, terrainTextureData);
  texBlob = null;

  // ── art/terrains/ PBR textures (when OSM material painting is enabled) ─────
  if (pbrResult?.textureFiles?.length) {
    for (const { path, blob } of pbrResult.textureFiles) {
      zip.file(`${base}/art/terrains/${path}`, await toZipBinary(blob));
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
      // diffuseSize is WORLD METERS spanned by the base texture, not pixels
      // (same as the *BaseTexSize fields in osmTerrainMaterials.js).
      diffuseSize: worldSize,
      groundmodelName: 'GROUNDMODEL_ASPHALT1',
    },
  };
  // TerrainMaterial texture slots must be own-level or /assets paths only —
  // the material templates guarantee this (beamngTerrainMaterialLibrary.js);
  // TerrainCellMaterial does not resolve .link redirects, so no link routing.
  zip.file(`${base}/art/terrains/main.materials.json`, JSON.stringify(terrainMaterialDefs, null, 2));

  // ── groundModels/mapng_groundmodels.json ──────────────────────────────────
  // Self-contained physics surfaces (Ground-Models.md). Merged after the global
  // /art/groundmodels.json; the terrain materials' `groundmodelName` values link
  // each painted surface (asphalt roads, dirt/gravel tracks, grass, etc.) here.
  zip.file(`${base}/groundModels/mapng_groundmodels.json`, JSON.stringify(MAPNG_GROUND_MODELS, null, 2));

  // ── terrain.terrain.json — update materials list to match .ter contents ────
  const terrainMaterialNames = pbrResult?.materialNames ?? ['DefaultMaterial'];
  const heightMapSize = size * size;
  zip.file(`${base}/terrain.terrain.json`, JSON.stringify({
    binaryFormat: 'version(char), size(unsigned int), heightMap(heightMapSize * heightMapItemSize), layerMap(layerMapSize * layerMapItemSize), layerTextureMap(layerMapSize * layerMapItemSize), materialNames',
    datafile: terrainBinaryVirtualPath,
    heightMapItemSize: 2,
    heightMapSize,
    heightmapImage: terrainHeightmapVirtualPath,
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
    { __parent: 'MissionGroup', class: 'SimGroup', name: 'sky_and_sun', persistentId: generatePersistentId() },
    { __parent: 'MissionGroup', class: 'SimGroup', name: 'level_objects', persistentId: generatePersistentId() },
    { __parent: 'MissionGroup', class: 'SimGroup', name: 'PlayerDropPoints', persistentId: generatePersistentId() },
    { __parent: 'MissionGroup', class: 'SimGroup', name: 'AIWaypointsGroup', persistentId: generatePersistentId() },
    { __parent: 'MissionGroup', class: 'SimGroup', name: 'AIDecalWaypointsGroup', persistentId: generatePersistentId() },
    { __parent: 'MissionGroup', class: 'SimGroup', name: 'CameraBookmarks', persistentId: generatePersistentId() },
    { __parent: 'MissionGroup', class: 'SimGroup', name: 'Water', persistentId: generatePersistentId() },
    ...((forestFiles.length > 0 || groundCoverObjects.length > 0) ? [{
      __parent: 'MissionGroup',
      class: 'SimGroup',
      name: 'vegetation',
      persistentId: generatePersistentId(),
    }] : []),
    ...(meshRoads.length > 0 ? [{
      __parent: 'MissionGroup',
      class: 'SimGroup',
      name: 'Mesh_roads',
      persistentId: generatePersistentId(),
    }] : []),
    ...(barrierFolderItems.length > 0 ? [{
      __parent: 'MissionGroup',
      class: 'SimGroup',
      name: 'barriers',
      persistentId: generatePersistentId(),
    }] : []),
    ...(signObjects.length > 0 ? [{
      __parent: 'MissionGroup',
      class: 'SimGroup',
      name: 'signs',
      persistentId: generatePersistentId(),
    }] : []),
    ...(streetFurnitureObjects.length > 0 ? [{
      __parent: 'MissionGroup',
      class: 'SimGroup',
      name: 'street_furniture',
      persistentId: generatePersistentId(),
    }] : []),
    ...(fuelStationObjects.length > 0 ? [{
      __parent: 'MissionGroup',
      class: 'SimGroup',
      name: 'gasStations',
      persistentId: generatePersistentId(),
    }] : []),
    ...(roadFolderGroups.length > 0 ? [{
      __parent: 'MissionGroup',
      class: 'SimGroup',
      name: 'roads',
      persistentId: generatePersistentId(),
    }] : []),
    ...(decalRoads.length > 0 ? [{
      __parent: 'MissionGroup',
      class: 'SimGroup',
      name: 'Decal_Roads',
      persistentId: generatePersistentId(),
    }] : []),
  ];
  zip.file(`${base}/main/MissionGroup/items.level.json`, toNDJSON(missionGroupItems));

  // ── main/MissionGroup/Mesh_roads/items.level.json ─────────────────────────
  const rewriteForLinks = (value) => linkRegistry.rewriteObjectPathsDeep(value);
  const rewrittenMeshRoads = rewriteForLinks(meshRoads);
  const rewrittenBarrierFolderItems = rewriteForLinks(barrierFolderItems);
  const rewrittenSignObjects = rewriteForLinks(signObjects);

  if (meshRoads.length > 0) {
    zip.file(`${base}/main/MissionGroup/Mesh_roads/items.level.json`, toNDJSON(rewrittenMeshRoads));
  }

  // ── main/MissionGroup/barriers/items.level.json ─────────────────────────
  if (barrierFolderItems.length > 0) {
    zip.file(`${base}/main/MissionGroup/barriers/items.level.json`, toNDJSON(rewrittenBarrierFolderItems));
  }

  // ── main/MissionGroup/signs/items.level.json ────────────────────────────
  // Native BeamNG sign meshes (TSStatic + .link) for OSM stop/give_way nodes.
  if (signObjects.length > 0) {
    zip.file(`${base}/main/MissionGroup/signs/items.level.json`, toNDJSON(rewrittenSignObjects));
  }

  // ── main/MissionGroup/street_furniture/items.level.json ─────────────────
  // Native lamp/bench TSStatics + nightLight PointLights for OSM
  // street_lamp/bench nodes. rewriteForLinks registers .link files for the
  // level-scoped meshes (core /art/shapes paths pass through untouched).
  if (streetFurnitureObjects.length > 0) {
    zip.file(`${base}/main/MissionGroup/street_furniture/items.level.json`, toNDJSON(rewriteForLinks(streetFurnitureObjects)));
  }

  // ── main/MissionGroup/gasStations/items.level.json + facilities ──────────
  // Working fuel/charging stations: BeamNGGameplayArea + BeamNGPointOfInterest
  // pairs (the in-world pumps) plus the facilities file that ties them together
  // so the engine actually refuels vehicles (Fuel-Station-Setup.md).
  if (fuelStationObjects.length > 0) {
    // rewriteForLinks rewrites the ECA mesh shapeNames and registers .link files.
    zip.file(`${base}/main/MissionGroup/gasStations/items.level.json`, toNDJSON(rewriteForLinks(fuelStationObjects)));
    zip.file(
      `${base}/facilities/facilities.facilities.json`,
      JSON.stringify({ gasStations: fuelStationFacilities }, null, 2)
    );
  }

  // ── main/MissionGroup/roads/items.level.json ──────────────────────────────
  if (roadFolderGroups.length > 0) {
    // Generate SimGroup objects for each Road Architect road group
    const roadGroups = roadFolderGroups.map(g => ({
      __parent: 'roads',
      class: 'SimGroup',
      name: g.groupName,
      persistentId: generatePersistentId(),
    }));

    zip.file(`${base}/main/MissionGroup/roads/items.level.json`, toNDJSON(roadGroups));

    // BeamNG requires sub-folders and an empty items.level.json for each nested SimGroup
    for (const g of roadGroups) {
      zip.folder(`${base}/main/MissionGroup/roads/${g.name}`);
      // An empty string or empty items list will parse without crashing.
      zip.file(`${base}/main/MissionGroup/roads/${g.name}/items.level.json`, '');
    }
  }

  // ── main/MissionGroup/Decal_Roads/items.level.json ────────────────────────
  if (decalRoads.length > 0) {
    writeSimGroupTree(zip, `${base}/main/MissionGroup/Decal_Roads`, decalRoads);
  }

  const aiWaypointItems = manualMapNavigation.waypoints.map((waypoint) => ({
    ...waypoint,
    persistentId: generatePersistentId(),
  }));

  // Base maps include these groups even when empty.
  zip.file(
    `${base}/main/MissionGroup/AIWaypointsGroup/items.level.json`,
    aiWaypointItems.length > 0 ? toNDJSON(aiWaypointItems) : ''
  );
  zip.file(`${base}/main/MissionGroup/AIDecalWaypointsGroup/items.level.json`, '');

  const skyAndSunItems = [
      {
        __parent: 'sky_and_sun',
        class: 'LevelInfo',
        name: 'theLevelInfo',
        persistentId: generatePersistentId(),
        canvasClearColor: [0, 0, 0, 1],
        fogAtmosphereHeight: 1000,
        fogDensity: 0.0001,
        fogDensityOffset: 0,
        globalEnviromentMap: useUniversalCubemap
          ? 'cubemap_Universal_cubemap_reflection'
          : getGlobalEnvironmentMap(biome),
        gravity: -9.81,
        nearClip: 0.1,
        visibleDistance: 4000,
        // Depth bias tuned with visibleDistance to keep DecalRoad markings from
        // z-fighting the terrain (LevelInfo.md §decalBias).
        decalBias: 0.0005,
        // Global audio environment + attenuation model (LevelInfo.md). The engine
        // falls back to AudioAmbienceDefault if unset; declare it explicitly.
        soundAmbience: 'AudioAmbienceDefault',
        soundDistanceModel: 'Logarithmic',
        // Time→temperature curve in °C (noon=0, midnight=0.5, wraps at 1).
        temperatureCurveC: [0, 16, 0.25, 22, 0.5, 13, 0.75, 11, 1, 16],
      },
      {
        __parent: 'sky_and_sun',
        class: 'TimeOfDay',
        name: 'tod',
        persistentId: generatePersistentId(),
        startTime: 0.15,
      },
      {
        __parent: 'sky_and_sun',
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
      ...cloudObjects,
  ];
  const rewrittenSkyAndSunItems = rewriteForLinks(skyAndSunItems);

  // ── main/MissionGroup/sky_and_sun/items.level.json ───────────────────────
  zip.file(`${base}/main/MissionGroup/sky_and_sun/items.level.json`, toNDJSON(rewrittenSkyAndSunItems));

  // ── main/MissionGroup/level_objects/items.level.json ──────────────────────
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
  const levelObjectItems = [{
    __parent: 'level_objects',
    class: 'TerrainBlock',
    name: 'theTerrain',
    persistentId: generatePersistentId(),
    position: [-halfExtent, -halfExtent, 0],
    squareSize,
    maxHeight,
    baseTexSize: size,
    terrainFile: terrainBinaryVirtualPath,
    materialTextureSet: pbrResult?.textureSetName ?? '',
    // Point the terrain block's minimap at the base color texture (north-up
    // top-down). BeamNG convention: leading "levels/…", no leading slash.
    minimapImage: `levels/${levelName}/${minimapImageRel}`,
  }];

  if (osmDaeBlob) {
    levelObjectItems.push({
      __parent: 'level_objects',
      class: 'TSStatic',
      name: 'osm_objects',
      persistentId: generatePersistentId(),
      position: [0, 0, 0],
      shapeName: `/levels/${levelName}/map_assets/custom_assets/osm_objects/osm_objects.dae`,
      collisionType: 'Collision Mesh',
      decalType: 'Collision Mesh',
      prebuildCollisionData: 0,
      useInstanceRenderData: true,
    });
  }



  if (backdropDaeBlob) {
    levelObjectItems.push({
      __parent: 'level_objects',
      class: 'TSStatic',
      name: 'terrain_backdrop',
      persistentId: generatePersistentId(),
      position: [0, 0, 0],
      shapeName: `/levels/${levelName}/map_assets/custom_assets/terrain_backdrop/terrain_backdrop.dae`,
      useInstanceRenderData: true,
    });
  }

  if (mapngFlagFiles.length > 0) {
    levelObjectItems.push({
      __parent: 'level_objects',
      class: 'TSStatic',
      name: 'mapng_flag_marker',
      persistentId: generatePersistentId(),
      position: mapngFlagPosition,
      shapeName: `/levels/${levelName}/map_assets/custom_assets/mapng_flag/flagng.dae`,
      useInstanceRenderData: true,
    });
  }

  const rewrittenLevelObjectItems = rewriteForLinks(levelObjectItems);
  const rewrittenWaterObjects = rewriteForLinks(waterObjects);

  zip.file(`${base}/main/MissionGroup/level_objects/items.level.json`,
    toNDJSON(rewrittenLevelObjectItems)
  );

  zip.file(`${base}/main/MissionGroup/Water/items.level.json`,
    toNDJSON(rewrittenWaterObjects)
  );

  const vegetationItems = [
    ...(forestFiles.length > 0 ? [{
      __parent: 'vegetation',
      class: 'Forest',
      name: 'theForest',
      persistentId: generatePersistentId(),
      lodReflectScalar: 0,
    }, {
      // Global directional wind so placed forest items actually sway (Forest.md
      // §ForestWindEmitter). Without an active emitter the trees are static —
      // base levels always ship one. radialEmitter:false makes it level-wide so
      // position is irrelevant. Values are deliberately gentle: the wind sim
      // runs every frame for every visible forest item, and the original
      // strength-1 / gustFrequency-3 / turbulenceFrequency-2 combination kept
      // GPUs/CPUs working hard near dense tree coverage.
      __parent: 'vegetation',
      class: 'ForestWindEmitter',
      name: 'forest_wind',
      persistentId: generatePersistentId(),
      position: [0, 0, 0],
      windEnabled: true,
      radialEmitter: false,
      strength: 0.3,
      gustStrength: 0.15,
      gustFrequency: 0.5,
      gustYawAngle: 5,
      gustYawFrequency: 1,
      turbulenceStrength: 0.1,
      turbulenceFrequency: 0.5,
    }] : []),
    ...groundCoverObjects,
  ];
  const rewrittenVegetationItems = rewriteForLinks(vegetationItems);
  const rewrittenManagedForestItemData = rewriteForLinks(managedForestItemData);

  if (vegetationItems.length > 0) {
    zip.file(`${base}/main/MissionGroup/vegetation/items.level.json`, toNDJSON(rewrittenVegetationItems));
    if (forestFiles.length > 0) {
      zip.file(`${base}/art/forest/managedItemData.json`, JSON.stringify(rewrittenManagedForestItemData, null, 2));
      for (const forestFile of forestFiles) {
        zip.file(`${base}/${forestFile.path}`, forestFile.contents);
      }
    }
  }

  const linkFiles = linkRegistry.getLinkFiles();
  if (linkFiles.length > 0) {
    for (const linkFile of linkFiles) {
      zip.file(linkFile.path, linkFile.contents);
    }
  }

  // ── main/MissionGroup/PlayerDropPoints/items.level.json ───────────────────
  // Spawn position: midpoint of nearest road to terrain center (or center
  // fallback), 3 m above the terrain surface at that point.
  // rotationMatrix: 9-element flat row-major matrix aligning the vehicle with
  // the road tangent direction at the spawn point.
  const playerDropPointItems = [{
      __parent: 'PlayerDropPoints',
      class: 'SpawnSphere',
      dataBlock: 'SpawnSphereMarker',
      name: 'spawn_default',
      persistentId: generatePersistentId(),
      position: spawnPosition,
      rotationMatrix: spawnRotationMatrix,
      radius: 5,
    }];

  zip.file(`${base}/main/MissionGroup/PlayerDropPoints/items.level.json`, toNDJSON(playerDropPointItems));

  // ── main/MissionGroup/CameraBookmarks/items.level.json ─────────────────────
  // Editor camera bookmarks (CameraBookmark.md; every official level ships a
  // CameraBookmarks group). One bookmark frames the whole map from the south,
  // one frames the spawn area — useful starting viewpoints for first-time
  // editing and screenshot workflows. Matrices: row0=right, row1=forward,
  // row2=up; forward tilted down toward +Y (north).
  const PITCH_DOWN_45 = [1, 0, 0, 0, 0.707107, -0.707107, 0, 0.707107, 0.707107];
  const PITCH_DOWN_30 = [1, 0, 0, 0, 0.866025, -0.5, 0, 0.5, 0.866025];
  const cameraBookmarkItems = [
    {
      __parent: 'CameraBookmarks',
      class: 'CameraBookmark',
      dataBlock: 'CameraBookmarkMarker',
      name: 'map_overview',
      internalName: 'map_overview',
      persistentId: generatePersistentId(),
      position: [0, roundTo(-worldSize * 0.35, 1), roundTo(maxHeight + worldSize * 0.35, 1)],
      rotationMatrix: PITCH_DOWN_45,
    },
    {
      __parent: 'CameraBookmarks',
      class: 'CameraBookmark',
      dataBlock: 'CameraBookmarkMarker',
      name: 'spawn_area',
      internalName: 'spawn_area',
      persistentId: generatePersistentId(),
      position: [
        spawnPosition[0],
        roundTo(spawnPosition[1] - 25, 1),
        roundTo(spawnPosition[2] + 15, 1),
      ],
      rotationMatrix: PITCH_DOWN_30,
    },
  ];
  zip.file(`${base}/main/MissionGroup/CameraBookmarks/items.level.json`, toNDJSON(cameraBookmarkItems));

  // NOTE: no main.level.json is written. The modern `main/` folder tree is the
  // preferred level entry point (Level-Metadata.md §Level discovery); official
  // levels ship only `main/`. The legacy monolithic file used to be emitted as a
  // "fallback" but drifted from the folder tree (it lacked Decal_Roads, roads,
  // and AIWaypointsGroup), risking a silently degraded level if a loader ever
  // preferred it over `main/`.

  validateBeamNGZipStructure(zip, base, {
    requiresVegetation: vegetationItems.length > 0,
    requiresRoadGroups: roadFolderGroups.length > 0,
    requiresMeshRoads: meshRoads.length > 0,
    requiresBarriers: barrierFolderItems.length > 0,
    requiresSigns: signObjects.length > 0,
    requiresDecalRoads: decalRoads.length > 0,
  });

  beginStep('Compressing ZIP archive (DEFLATE)…', 94);
  await yield_();
  const zipFilename = `${levelName}.zip`;
  let lastZipPct = -10;
  const onZipPercent = (pct) => {
    if (!Number.isFinite(pct) || pct - lastZipPct < 5) return;
    lastZipPct = pct;
    report(`Compressing ZIP archive (${Math.round(pct)}%)…`, 94 + Math.min(5, Math.floor(pct / 20)));
  };
  // Stream the archive to disk (OPFS) when available so the ~1 GB output never
  // has to accumulate in the JS heap; fall back to the in-memory blob elsewhere.
  let zipBlob = await generateZipToOPFS(zip, zipFilename, onZipPercent);
  let zipDelivery = 'opfs-stream';
  if (!zipBlob) {
    zipDelivery = 'in-memory';
    zipBlob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE', streamFiles: true });
  }
  console.log(`${BEAMNG_EXPORT_SERVICE_LOG} ZIP generated:`, {
    filename: zipFilename,
    blobType: zipBlob?.type,
    blobSize: zipBlob?.size,
    delivery: zipDelivery,
    levelName,
  });
  beginStep('Done', 100);
  finishProcessingLog();
  console.log(`${BEAMNG_EXPORT_SERVICE_LOG} Completed exportBeamNGLevel`);
  return { blob: zipBlob, filename: `${levelName}.zip` };
}
