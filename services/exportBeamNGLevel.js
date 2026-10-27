import * as THREE from 'three';
import JSZip from 'jszip';
import { chooseBaseTextureSize } from './baseTextureSize.js';
import { encode } from 'fast-png';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { exportTer } from './exportTer.js';
import { buildTerrainMaterials, isVegetationColor } from './osmTerrainMaterials.js';
import { createOSMGroup, createSurroundingMeshes, SCENE_SIZE } from './export3d.js';
import { buildTexturedBuildings, getBuildingMaterialDefs } from './beamngBuildings.js';
import { placeTrafficCalming } from './trafficCalming.js';
import { placeBollards } from './bollards.js';
import { planLakes, planRivers } from './beamngWater.js';
import { tunnelDryZones, tunnelsBelow, planSeaBlocks, clipRiverNodes, clipLakeTile } from './beamngWaterClip.js';
import { placeCurveWarnings } from './curveWarningSigns.js';
import { chooseTreeGroup, chooseTreeItem, treeHintFromTags, treeItemHeight } from './beamngTrees.js';
import { SHAPE_IMPOSTER_FILES } from './beamngTreeLibrary.js';
import { prepareCroppedTerrainData } from './cropTerrain.js';
import { applyBuildingFoundations } from './buildingFoundations.js';
import { ColladaExporter } from './ColladaExporter.js';
import { buildRoadNetwork, getEffectiveRoadLayer, makeRoadNodeKey, mergeLinearRoadSegments } from './roadNetwork.js';
import { createBeamNGLinkFileRegistry } from './beamngLinkFiles.js';
import { getBiomeRuntimeMaterialDefs } from './beamngRuntimeMaterialCatalog.js';
import { getFuelStationRuntimeMaterialDefs } from './beamngFuelStationMaterials.js';
import { validateBeamNGZipStructure } from './beamngExportConformance.js';
import {
  collectGiveWayNodeKeys,
  geometryHasGiveWay,
  GIVE_WAY_DRIVABILITY_STEP,
  inferManualLaneData,
  inferRoadDrivability,
  parseMaxspeedMps,
} from './beamngMapNavigation.js';
import { resolveRoadRulesAt } from './countryRules.js';
import { buildRoadSignProps } from './roadSigns.js';
import { generateRoadLamps } from './streetLamps.js';
import { buildSidewalkMeshes, getSidewalkMaterialDefs, SIDEWALK_MATERIALS } from './beamngSidewalks.js';
import { buildRoadNameZones } from './roadNameZones.js';
import { placeStreetProps, POLE_LAMP_Z, POLE_LAMP_REACH_M, hash01 as propHash } from './streetProps.js';
import {
  solveBridgeDecks, deckHeightAt, buildDeckGeometry, hitsDeck, alongDeck,
  liftFor, rampLength, rampLift, resample, RAMP_SHOULDER_M, RAMP_SIDE_SLOPE, PARAPET_W_M, DECK_MAX_GRADE, DECK_ROAD_CLEAR_M,
} from './beamngBridges.js';
import {
  solveTunnel, chainTunnelParts, absorbBranch, nearestOnTunnel, isBoredTunnelTag, isGalleryTag, tunnelRoadZ, tunnelGroundAt, tunnelHoleAt, tunnelReach,
  hitsTunnel, buildTubeGeometry, buildPortalGeometry, buildWindowGeometry, buildTunnelObjects, LIGHT_SPACING_M, LINING_M, extraAt,
} from './beamngTunnels.js';
import {
  PROP_HYDRANT, PROP_BINS, PROP_SHAPES, STREET_LIGHT_SHAPES, SIGNAL_MAST, POWER_WIRE_MATERIAL, getPowerWireMaterialDefs,
  BARRIER_SHAPES,
} from './beamngPropLibrary.js';
import {
  buildCarriagewayIndex,
  cutNodes,
  isInZone,
  isOnCrossingCarriageway,
  isOnOtherCarriageway,
  parallelHalfWidthAt,
  parallelRoadAt,
} from './roadMarkingCuts.js';
import {
  buildBeamNGSignalExportBundle,
  collectJunctionApproaches,
  SIGNAL_HEAD_SHAPE,
  SIGNAL_POLE_SHAPE,
} from './beamngSignals.js';
import {
  buildUrbanRoadClassifier,
  estimateRoadCrossSection,
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
  getOwnVegetationSelector,
  getRockCandidates,
  getShapeMaterialDefsForBiome,
  getStreetFurnitureProfile,
  getTrafficProfile,
  getWaterProfile,
} from './beamngBiomeCatalog.js';
import { resolveRegionalBiome } from './beamngRegion.js';

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

// Natural Earth UN regions (country_rules.json) → info.json region ids.
const UN_REGION_TO_LEVEL_REGION = {
  Europe: 'europe', Asia: 'asia', Africa: 'africa', Oceania: 'oceania',
};

function getRegionForCountry(country, roadRules = null) {
  if (roadRules?.region === 'Americas') {
    return roadRules.countryCode === 'US' || roadRules.countryCode === 'CA' || roadRules.countryCode === 'MX'
      ? 'northAmerica' : 'southAmerica';
  }
  if (UN_REGION_TO_LEVEL_REGION[roadRules?.region]) return UN_REGION_TO_LEVEL_REGION[roadRules.region];
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

const SPAWN_END_CLEAR_M = 20;    // this far from a carriageway's ends (junctions, bridge and tunnel ends)
const SPAWN_MAX_GRADE = 0.08;    // along the road over ±SPAWN_GRADE_M
const SPAWN_GRADE_M = 10;
const SPAWN_ON_GROUND_M = 1;     // the road this close to the terrain: not on a deck or a walled ramp
const SPAWN_CLASS_PENALTY_M = { service: 150, track: 400, unclassified: 50, living_street: 50 };

/**
 * The spawn on a drawn ground carriageway near the map's centre: a node
 * clear of its ends, on a gentle grade, on the terrain and with nothing over
 * it, facing along the road. Null without one (findSpawnPosition stands).
 */
function findRoadSpawn(carriageways, groundAt, covered = () => false, { leftHandTraffic = false } = {}) {
  let best = null;
  for (const cw of carriageways) {
    const n = cw.nodes;
    if (!Array.isArray(n) || n.length < 3 || NON_DRIVEABLE_HIGHWAYS.has(cw.highway)) continue;
    const s = [0];
    for (let i = 1; i < n.length; i++) s.push(s[i - 1] + Math.hypot(n[i][0] - n[i - 1][0], n[i][1] - n[i - 1][1]));
    const total = s[s.length - 1];
    const penalty = SPAWN_CLASS_PENALTY_M[cw.highway] ?? 0;
    for (let i = 1; i + 1 < n.length; i++) {
      if (s[i] < SPAWN_END_CLEAR_M || total - s[i] < SPAWN_END_CLEAR_M) continue;
      const [x, y, z] = n[i];
      const score = Math.hypot(x, y) + penalty;
      if (best && score >= best.score) continue;
      let a = i; while (a > 0 && s[i] - s[a] < SPAWN_GRADE_M) a--;
      let b = i; while (b + 1 < n.length && s[b] - s[i] < SPAWN_GRADE_M) b++;
      if (Math.abs(n[b][2] - n[a][2]) > SPAWN_MAX_GRADE * (s[b] - s[a])) continue;
      if (Math.abs(z - groundAt(x, y)) > SPAWN_ON_GROUND_M || covered(x, y, z, z + 3)) continue;
      const dx = n[b][0] - n[a][0]; const dy = n[b][1] - n[a][1]; const L = Math.hypot(dx, dy) || 1;
      const fx = dx / L; const fy = dy / L;
      // in the lane traffic keeps to on a two-way road, not on the centre line
      const lane = cw.oneWay ? 0 : (cw.half / 2) * (leftHandTraffic ? -1 : 1);
      best = {
        score,
        position: [roundTo(x + fy * lane, 2), roundTo(y - fx * lane, 2), roundTo(z + 0.5, 2)],
        // rows: right, forward (BeamNG +Y), up
        rotationMatrix: [roundTo(fy, 6), roundTo(-fx, 6), 0, roundTo(fx, 6), roundTo(fy, 6), 0, 0, 0, 1],
      };
    }
  }
  return best && { position: best.position, rotationMatrix: best.rotationMatrix };
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
async function resizePngBlob(blob, targetSize, bmp = null) {
  if (!blob) return blob;
  bmp = bmp ?? await createImageBitmap(blob);
  if (bmp.width === targetSize && bmp.height === targetSize) {
    bmp.close();
    return blob;
  }
  const canvas = document.createElement('canvas');
  canvas.width = targetSize;
  canvas.height = targetSize;
  const ctx = canvas.getContext('2d');
  // 'high' filters downscales instead of point-sampling them (aliasing).
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bmp, 0, 0, targetSize, targetSize);
  bmp.close();
  return new Promise(r => canvas.toBlob(r, 'image/png'));
}

/**
 * Size the base texture for a grid (chooseBaseTextureSize) and resize the
 * blob to exactly that square; returns { blob, size }. `allowFiner: false`
 * keeps the grid size (flat placeholder, procedural OSM texture).
 */
async function fitBaseTexture(blob, gridSize, { allowFiner = true } = {}) {
  if (!blob) return { blob, size: gridSize };
  const bmp = await createImageBitmap(blob);
  const size = allowFiner ? chooseBaseTextureSize(bmp.width, gridSize) : gridSize;
  return { blob: await resizePngBlob(blob, size, bmp), size };
}

/**
 * Vegetation mask (north-up, ≤ VEGETATION_MASK_MAX px a side) from a
 * satellite-based texture blob, for the OSM material painter: unmapped ground
 * that is green there gets Grass (osmTerrainMaterials isVegetationColor).
 * Decoded downscaled and read in strips so a 16k export allocates no
 * full-grid RGBA buffer. Null when the texture can't be decoded.
 */
const VEGETATION_MASK_MAX = 4096;
const VEGETATION_MASK_STRIP = 256;
async function buildVegetationMask(blob) {
  if (!blob) return null;
  try {
    const probe = await createImageBitmap(blob);
    const size = Math.min(VEGETATION_MASK_MAX, probe.width);
    probe.close?.();
    const bmp = await createImageBitmap(blob, { resizeWidth: size, resizeHeight: size, resizeQuality: 'medium' });
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = VEGETATION_MASK_STRIP;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx?.getImageData) { bmp.close?.(); return null; }
    const data = new Uint8Array(size * size);
    for (let y0 = 0; y0 < size; y0 += VEGETATION_MASK_STRIP) {
      const rows = Math.min(VEGETATION_MASK_STRIP, size - y0);
      ctx.clearRect(0, 0, size, VEGETATION_MASK_STRIP);
      ctx.drawImage(bmp, 0, y0, size, rows, 0, 0, size, rows);
      const px = ctx.getImageData(0, 0, size, rows).data;
      for (let i = 0; i < size * rows; i++) {
        if (isVegetationColor(px[i * 4], px[i * 4 + 1], px[i * 4 + 2])) data[y0 * size + i] = 1;
      }
    }
    bmp.close?.();
    return { data, size };
  } catch (error) {
    console.warn(`${BEAMNG_EXPORT_SERVICE_LOG} Vegetation mask unavailable; unmapped ground keeps DefaultMaterial.`, error?.message || error);
    return null;
  }
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
/**
 * Sidewalk meshes (beamngSidewalks.js) as one Collada shape: visual meshes
 * plus a Colmesh-1 collision copy, in BeamNG's base00 > start01 layout.
 */
function generateSidewalksDAE(meshes) {
  if (!meshes.length) return null;
  const parts = meshes.map((mesh) => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', mesh.geometry.getAttribute('position').clone());
    return g;
  });
  const collisionGeom = mergeGeometries(parts);
  parts.forEach((g) => g.dispose());
  const base00 = new THREE.Group();
  base00.name = 'base00';
  const start01 = new THREE.Group();
  start01.name = 'start01';
  for (const mesh of meshes) start01.add(mesh);
  if (collisionGeom) {
    collisionGeom.name = 'Colmesh-1';
    const collision = new THREE.Mesh(collisionGeom, new THREE.MeshBasicMaterial({ name: SIDEWALK_MATERIALS.curb }));
    collision.name = 'Colmesh-1';
    start01.add(collision);
  }
  base00.add(start01);
  base00.updateMatrixWorld(true);
  const result = new ColladaExporter().parse(base00, undefined, { version: '1.4.1', upAxis: 'Z_UP' });
  return result?.data ?? null;
}

// Overhead wires as thin crossed ribbons (a double-sided material shows both
// faces), cut into WIRE_TILE_M tiles so each is its own object the engine can
// cull, rather than one map-wide mesh.
const WIRE_TILE_M = 512;
const WIRE_HALF_W = 0.015;

/**
 * Wire polylines (streetProps.js) as Collada shapes: [{ key, data }] per tile,
 * no collision.
 */
function generatePowerWireDAEs(wires) {
  if (!wires.length) return [];
  const tiles = new Map();
  for (const line of wires) {
    const key = `${Math.floor(line[0][0] / WIRE_TILE_M)}_${Math.floor(line[0][1] / WIRE_TILE_M)}`.replace(/-/g, 'm');
    if (!tiles.has(key)) tiles.set(key, []);
    tiles.get(key).push(line);
  }
  const out = [];
  for (const [key, lines] of tiles) {
    const pos = [];
    for (const line of lines) {
      for (let i = 0; i + 1 < line.length; i++) {
        const a = line[i];
        const b = line[i + 1];
        const d = new THREE.Vector3(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
        if (d.length() < 1e-6) continue;
        d.normalize();
        const side = new THREE.Vector3().crossVectors(d, new THREE.Vector3(0, 0, 1));
        if (side.length() < 1e-6) side.set(1, 0, 0);
        side.normalize().multiplyScalar(WIRE_HALF_W);
        const up = new THREE.Vector3().crossVectors(side, d).normalize().multiplyScalar(WIRE_HALF_W);
        for (const v of [side, up]) {
          const p0 = [a[0] - v.x, a[1] - v.y, a[2] - v.z];
          const p1 = [b[0] - v.x, b[1] - v.y, b[2] - v.z];
          const p2 = [b[0] + v.x, b[1] + v.y, b[2] + v.z];
          const p3 = [a[0] + v.x, a[1] + v.y, a[2] + v.z];
          pos.push(...p0, ...p1, ...p2, ...p0, ...p2, ...p3);
        }
      }
    }
    if (!pos.length) continue;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pos), 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array((pos.length / 3) * 2), 2));
    geo.computeVertexNormals();
    // No trailing digits in node names: BeamNG reads them as a detail level.
    const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ name: POWER_WIRE_MATERIAL }));
    mesh.name = 'power_wires';
    const base00 = new THREE.Group();
    base00.name = 'base00';
    const start01 = new THREE.Group();
    start01.name = 'start01';
    start01.add(mesh);
    base00.add(start01);
    base00.updateMatrixWorld(true);
    const result = new ColladaExporter().parse(base00, undefined, { version: '1.4.1', upAxis: 'Z_UP' });
    if (result?.data) out.push({ key, data: result.data });
    geo.dispose();
  }
  return out;
}

export const BRIDGE_MATERIAL = 'mapng_bridge_concrete';

/** Bridge concrete material (BeamNG's shared plain concrete). */
function getBridgeMaterialDefs() {
  const T = '/assets/materials/tileable/concrete/concrete_plain/t_concrete_plain';
  return {
    [BRIDGE_MATERIAL]: {
      name: BRIDGE_MATERIAL,
      mapTo: BRIDGE_MATERIAL,
      class: 'Material',
      version: 1.5,
      annotation: 'CONCRETE',
      groundType: 'CONCRETE',
      Stages: [{
        ambientOcclusionMap: `${T}_ao.data.png`,
        baseColorMap: `${T}_b.color.png`,
        normalMap: `${T}_nm.normal.png`,
        roughnessMap: `${T}_r.data.png`,
        pixelSpecular: true,
      }, {}, {}, {}],
      translucentBlendOp: 'None',
    },
  };
}

/**
 * Solved bridge decks as Collada shapes, one per bridge (its own object, so it
 * can be picked, moved or deleted, and is culled on its own), with its origin
 * at the bridge's centre: visual mesh + a Colmesh-1 collision copy.
 * Returns [{ key, origin: [x, y, z], data, triangles }].
 */
function generateBridgeDAEs(decks, groundAt, roadLines) {
  const out = [];
  // one Collada shape (visual mesh + a Colmesh-1 collision copy), origin-relative
  const toDae = ({ positions: pos, uvs }, origin) => {
    if (!pos.length) return null;
    const positions = Float32Array.from(pos, (v, k) => v - origin[k % 3]);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(uvs), 2));
    geo.computeVertexNormals();
    const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ name: BRIDGE_MATERIAL }));
    mesh.name = 'bridge_deck';
    const colGeo = new THREE.BufferGeometry();
    colGeo.setAttribute('position', new THREE.BufferAttribute(positions.slice(), 3));
    colGeo.name = 'Colmesh-1';
    const collision = new THREE.Mesh(colGeo, new THREE.MeshBasicMaterial({ name: BRIDGE_MATERIAL }));
    collision.name = 'Colmesh-1';
    const base00 = new THREE.Group();
    base00.name = 'base00';
    const start01 = new THREE.Group();
    start01.name = 'start01';
    start01.add(mesh);
    start01.add(collision);
    base00.add(start01);
    base00.updateMatrixWorld(true);
    const result = new ColladaExporter().parse(base00, undefined, { version: '1.4.1', upAxis: 'Z_UP' });
    geo.dispose();
    colGeo.dispose();
    return result?.data || null;
  };
  decks.forEach((deck, i) => {
    const g = buildDeckGeometry(deck, { groundAt, roadLines, neighbours: decks.filter((d) => d !== deck).flatMap((d) => d.parts) });
    if (!g.positions.length) return;
    const pts = deck.parts.flatMap((p) => p.xy.map(([x, y], k) => [x, y, p.z[k]]));
    const origin = [
      Math.round(pts.reduce((n, p) => n + p[0], 0) / pts.length * 100) / 100,
      Math.round(pts.reduce((n, p) => n + p[1], 0) / pts.length * 100) / 100,
      Math.round(Math.min(...pts.map((p) => p[2])) * 100) / 100,
    ];
    // the road surface and the rest (parapets, sides, girders, piers) apart:
    // decals clip onto the first only
    const data = toDae(g.sides, origin);
    const deckData = toDae(g.top, origin);
    if (data || deckData) out.push({ key: `b${String(i + 1).padStart(3, '0')}`, origin, data, deckData, triangles: g.positions.length / 9 });
  });
  return out;
}

export const TUNNEL_MATERIAL = 'mapng_tunnel_concrete';

/** Tunnel lining / headwall concrete (the bridges' shared plain concrete). */
function getTunnelMaterialDefs() {
  const bridge = getBridgeMaterialDefs()[BRIDGE_MATERIAL];
  return { [TUNNEL_MATERIAL]: { ...bridge, name: TUNNEL_MATERIAL, mapTo: TUNNEL_MATERIAL } };
}

/**
 * Tunnel structures as Collada shapes: each tube piece and each portal
 * (headwall + wingwalls) its own object, origin at its centre (lowest z):
 * visual mesh + a Colmesh-1 collision copy.
 * Returns [{ key, tunnel, part, origin, data, triangles }].
 */
function generateTunnelDAEs(tunnels) {
  const out = [];
  const write = (t, part, { pos, uv }) => {
    if (!pos.length) return;
    const origin = [0, 1, 2].map((a) => {
      let lo = Infinity; let hi = -Infinity;
      for (let k = a; k < pos.length; k += 3) { lo = Math.min(lo, pos[k]); hi = Math.max(hi, pos[k]); }
      return Math.round((a === 2 ? lo : (lo + hi) / 2) * 100) / 100;
    });
    const positions = Float32Array.from(pos, (v, k) => v - origin[k % 3]);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(Float32Array.from(uv), 2));
    geo.computeVertexNormals();
    const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ name: TUNNEL_MATERIAL }));
    mesh.name = `tunnel_${part}`;
    const colGeo = new THREE.BufferGeometry();
    colGeo.setAttribute('position', new THREE.BufferAttribute(positions.slice(), 3));
    colGeo.name = 'Colmesh-1';
    const collision = new THREE.Mesh(colGeo, new THREE.MeshBasicMaterial({ name: TUNNEL_MATERIAL }));
    collision.name = 'Colmesh-1';
    const base00 = new THREE.Group();
    base00.name = 'base00';
    const start01 = new THREE.Group();
    start01.name = 'start01';
    start01.add(mesh);
    start01.add(collision);
    base00.add(start01);
    base00.updateMatrixWorld(true);
    const result = new ColladaExporter().parse(base00, undefined, { version: '1.4.1', upAxis: 'Z_UP' });
    if (result?.data) out.push({ key: `${t.key}_${part}`, tunnel: t.key, part, origin, data: result.data, triangles: pos.length / 9 });
    geo.dispose();
    colGeo.dispose();
  };
  for (const t of tunnels) {
    buildTubeGeometry(t).forEach((piece, i) => write(t, `tube${i + 1}`, piece));
    if (t.portals[0]) write(t, 'portal_a', buildPortalGeometry(t, 'S'));
    if (t.portals[1]) write(t, 'portal_b', buildPortalGeometry(t, 'N'));
    const windows = buildWindowGeometry(t);
    if (windows) write(t, 'windows', windows);
  }
  return out;
}

// Tunnel lights over the whole level, at most (spaced out beyond it).
const MAX_TUNNEL_LIGHTS = 4000;

/**
 * The 'tunnels' MissionGroup tree: a SimGroup per tunnel holding its
 * structure objects, its lights + fixtures, and its Zones / Portals /
 * ambience. { items, lightCount, zoneCount }.
 */
function buildTunnelGroups(tunnels, daes, levelName) {
  const total = tunnels.reduce((n, t) => n + t.tubeLength, 0);
  const lightSpacing = Math.max(LIGHT_SPACING_M, total / MAX_TUNNEL_LIGHTS);
  const items = [];
  let lightCount = 0;
  let zoneCount = 0;
  for (const t of tunnels) {
    const group = `tunnel_${t.key}`;
    const { lights, zones, lightCount: nl, zoneCount: nz } = buildTunnelObjects(t, group, generatePersistentId, { lightSpacing });
    t.lights = nl;
    t.zones = nz;
    lightCount += nl;
    zoneCount += nz;
    const structure = daes.filter((d) => d.tunnel === t.key).map((d) => ({
      __parent: group,
      class: 'TSStatic',
      name: `${group}_${d.part}`,
      persistentId: generatePersistentId(),
      position: d.origin,
      shapeName: `/levels/${levelName}/map_assets/custom_assets/tunnels/tunnel_${d.key}.dae`,
      collisionType: 'Collision Mesh',
      // roads ride the tube floors; a portal is all walls, which a road decal
      // clipped over objects above them (a ramp on a bridge) smears down
      ...(d.part.startsWith('portal') || d.part === 'windows' ? { decalType: 'None' } : {}),
      prebuildCollisionData: 0,
      useInstanceRenderData: true,
    }));
    items.push({
      class: 'SimGroup', name: group, persistentId: generatePersistentId(), __parent: 'tunnels',
      __items: [
        ...structure,
        { class: 'SimGroup', name: `${group}_lights`, persistentId: generatePersistentId(), __parent: group, __items: lights },
        { class: 'SimGroup', name: `${group}_zones`, persistentId: generatePersistentId(), __parent: group, __items: zones },
      ],
    });
  }
  return { items, lightCount, zoneCount, lightSpacing };
}

async function generateOSMObjectsDAE(terrainData, worldSize, reportStats = null) {
  if (!terrainData.osmFeatures?.length) return null;

  // Buildings: textured walls / roofs from BeamNG's own trim sheets, built
  // straight in world space (services/beamngBuildings.js).
  const squareSize = worldSize / terrainData.width;
  const { meshes: buildingMeshes, count: buildingCount, stats: buildingStats } = buildTexturedBuildings(
    terrainData.osmFeatures,
    (lat, lng) => geoToWorldPoint(lat, lng, terrainData, squareSize, 0),
  );
  if (reportStats) {
    reportStats.built = buildingCount;
    reportStats.stats = buildingStats;
    reportStats.meshes = buildingMeshes.length;
    reportStats.triangles = buildingMeshes.reduce((n, m) => n + (m.geometry.getAttribute('position')?.count || 0) / 3, 0);
  }

  // Barriers are exported as native TSStatic objects in BeamNG scene JSON,
  // not baked into the generic OSM DAE mesh.
  const osmGroup = createOSMGroup(terrainData, {
    includeBuildings: false,
    includeVegetation: false,
    includeBarriers: false,
    // Signs are placed as native BeamNG sign assets (see roadSigns.js),
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
  let hasMesh = buildingMeshes.length > 0;
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

  // Collision: every building's walls and roofs, positions only.
  // BeamNG identifies collision geometry by the <geometry id> starting with "Col".
  let buildingCollisionMesh = null;
  if (buildingMeshes.length > 0) {
    const parts = buildingMeshes.map((mesh) => {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', mesh.geometry.getAttribute('position').clone());
      return g;
    });
    const collisionGeom = mergeGeometries(parts);
    parts.forEach((g) => g.dispose());
    if (collisionGeom) {
      collisionGeom.name = 'Colmesh-1';
      buildingCollisionMesh = new THREE.Mesh(
        collisionGeom,
        new THREE.MeshBasicMaterial({ name: 'osm_object', color: 0xffffff }),
      );
      buildingCollisionMesh.name = 'Colmesh-1';
    }
  }

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
  for (const mesh of buildingMeshes) start01.add(mesh);
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
  // Progress: downloads are most of the time (0–85 % of the step), then the
  // tiles' meshes and textures.
  let downloaded = 0;
  const onText = (text) => {
    // USGS / GPXZ backdrops fetch tile by tile: "… for tile NE (3/8)..."
    const m = /^Fetching .*\((\d+)\/(\d+)\)/.exec(String(text));
    if (m) downloaded = Math.max(downloaded, (Number(m[1]) - 1) / Number(m[2]));
    options.onProgress?.(text, downloaded * 0.85);
  };
  const surroundingGroup = await createSurroundingMeshes(terrainData, onText, 128, {
    fetchResolutionCap: 1024,
    includeSatellite: true,
    satelliteZoom: 15,
    elevationSource: options.elevationSource || 'global30m',
    gpxzApiKey: options.gpxzApiKey || '',
    onDownloadProgress: ({ completedTotal, total }) => {
      if (total > 0) downloaded = completedTotal / total;
    },
  });
  options.onProgress?.('Building the backdrop meshes and textures…', 0.9);
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
// 250 nodes (~500 m at ROAD_NODE_SPACING_M): official roads run to 170-429
// nodes (West Coast USA, Italy), and at DECAL_ROAD_DETAIL a piece samples as
// many points as the old 50-node pieces did at the engine's 0.1.
function chunkPolyline(points, maxNodes = 250) {
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

// Road surface and paint materials from BeamNG's global decal-road library
// (art_shapes.zip art/shapes/common/decalroads/main.materials.json, loaded at
// startup for every level; textures in content/assets/materials/decalroad.zip).
// Exported levels reference them without shipping any textures. The surfaces
// are the ones official maps and BeamNG.Earth use: West Coast USA's asphalt,
// Johnson Valley's dirt road, the concrete street slabs.
const GLOBAL_DECAL_MATERIALS = {
  invisible: 'road_invisible',
  asphalt: 'road_asphalt_2lane',
  concrete: 'road1_concrete',
  lineWhite: 'm_line_white',
  lineYellowDouble: 'm_line_yellow_double',
  lineYellowSingle: 'm_line_yellow',
  lineYellowDashed: 'm_line_yellow_discontinue',
  lineWhiteDashed: 'm_line_white_discontinue',
  edgeAsphaltGrass: 'm_road_asphalt_edge_grass',
  dirtRoad: 'm_dirt_road',
};

// Paved surfaces drawn as concrete slabs instead of asphalt.
const CONCRETE_SURFACES = new Set(['concrete', 'concrete:plates', 'concrete:lanes']);

// Stone and brick paving. The global decal-road library has none, so the
// export ships its own decal-road materials over the game's shared tileable
// textures (the ones Italy, Small Island and West Coast USA pave with; the
// legacy diffuse/specular sets stay version-0 materials, as there). A
// DecalRoad stretches its texture once across its width, so a paved road is
// laid as parallel strips about one texture tile wide (tileM: metres one tile
// of the texture covers, judged from its stone size).
const PAVING_MATERIAL_BASE = {
  class: 'Material',
  alphaRef: 150,
  annotation: 'ASPHALT',
  castShadows: false,
  materialTag0: 'RoadAndPath',
  materialTag1: 'beamng',
  translucent: true,
  translucentZWrite: true,
};
export const PAVING_MATERIALS = {
  // granite setts (surface=sett, cobblestone)
  sett: {
    tileM: 1.0,
    material: {
      ...PAVING_MATERIAL_BASE,
      name: 'mapng_road_sett', mapTo: 'mapng_road_sett', persistentId: 'c5a1e7f2-3b84-4d0e-9a61-5f2d8b0c7a11',
      Stages: [{
        colorMap: '/assets/materials/tileable/paving/t_italy_cobblestone/t_italy_cobblestone_d.color.png',
        normalMap: '/assets/materials/tileable/paving/t_italy_cobblestone/t_italy_cobblestone_n.normal.png',
        specularMap: '/assets/materials/tileable/paving/t_italy_cobblestone/t_italy_cobblestone_s.color.png',
        useAnisotropic: true,
      }, {}, {}, {}],
    },
  },
  // rounded field stones (surface=unhewn_cobblestone)
  cobble: {
    tileM: 1.4,
    material: {
      ...PAVING_MATERIAL_BASE,
      name: 'mapng_road_cobble', mapTo: 'mapng_road_cobble', persistentId: 'c5a1e7f2-3b84-4d0e-9a61-5f2d8b0c7a12',
      Stages: [{
        colorMap: '/assets/materials/tileable/tile/si_cobblestone/si_cobblestone_d.dds',
        normalMap: '/assets/materials/tileable/tile/si_cobblestone/si_cobblestone_n.dds',
        specularMap: '/assets/materials/tileable/tile/si_cobblestone/si_cobblestone_s.dds',
        useAnisotropic: true,
      }, {}, {}, {}],
    },
  },
  // interlocking concrete pavers (surface=paving_stones)
  pavers: {
    tileM: 1.0,
    material: {
      ...PAVING_MATERIAL_BASE,
      name: 'mapng_road_pavers', mapTo: 'mapng_road_pavers', persistentId: 'c5a1e7f2-3b84-4d0e-9a61-5f2d8b0c7a13',
      Stages: [{
        colorMap: '/assets/materials/tileable/tile/italy_bld_hpaver/italy_hpaver_d.dds',
        normalMap: '/assets/materials/tileable/tile/italy_bld_hpaver/italy_hpaver_n.dds',
        specularMap: '/assets/materials/tileable/tile/italy_bld_hpaver/italy_hpaver_s.dds',
        specularPower: 19,
        useAnisotropic: true,
      }, {}, {}, {}],
    },
  },
  // herringbone brick (surface=bricks)
  bricks: {
    tileM: 1.4,
    material: {
      ...PAVING_MATERIAL_BASE,
      name: 'mapng_road_bricks', mapTo: 'mapng_road_bricks', persistentId: 'c5a1e7f2-3b84-4d0e-9a61-5f2d8b0c7a14',
      Stages: [{
        ambientOcclusionMap: '/assets/materials/tileable/brick/t_bricks_herringbone_01/t_bricks_herringbone_01_ao.data.png',
        baseColorMap: '/assets/materials/tileable/brick/t_bricks_herringbone_01/t_bricks_herringbone_01_b.color.png',
        normalMap: '/assets/materials/tileable/brick/t_bricks_herringbone_01/t_bricks_herringbone_01_nm.normal.png',
        roughnessMap: '/assets/materials/tileable/brick/t_bricks_herringbone_01/t_bricks_herringbone_01_r.data.png',
      }, {}, {}, {}],
      version: 1.5,
    },
  },
};
// More strips than this and the tiles grow instead (a wide plaza way).
const PAVING_MAX_STRIPS = 10;

/**
 * The paving (PAVING_MATERIALS key) an OSM surface=* is laid in, or null.
 * Paving stones in the Americas are red brick (historic US downtowns: St.
 * Augustine's old streets), grey concrete pavers elsewhere.
 */
export function pavingOf(surface, { americas = false } = {}) {
  const s = String(surface ?? '').trim().toLowerCase();
  if (s === 'sett' || s === 'cobblestone' || s === 'cobblestone:flattened') return 'sett';
  if (s === 'unhewn_cobblestone') return 'cobble';
  if (s === 'paving_stones' || s.startsWith('paving_stones:')) return americas ? 'bricks' : 'pavers';
  if (s === 'bricks' || s === 'brick' || s === 'clay') return 'bricks';
  return null;
}

/**
 * The strips a paved surface fullWidth wide is laid in: [{ offset, width,
 * textureLength }], offsets from the centre line (metres, + = left).
 */
export function pavingStrips(paving, fullWidth) {
  const { tileM } = PAVING_MATERIALS[paving];
  const n = Math.max(1, Math.min(PAVING_MAX_STRIPS, Math.round(fullWidth / tileM)));
  const w = fullWidth / n;
  // a hair of overlap: no seam of ground between strips on curves
  return Array.from({ length: n }, (_, k) => ({ offset: -fullWidth / 2 + w * (k + 0.5), width: w + 0.04, textureLength: w }));
}
// Metres one texture repeat covers along the road, per surface (official
// usage: BeamNG.Earth 11 for road_asphalt_2lane, West Coast USA 40 for
// road1_concrete, Johnson Valley 88 for m_dirt_road).
const SURFACE_TEXTURE_LENGTH = { asphalt: 11, concrete: 40, dirt: 88 };

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
// No fade on the road surface: where two OSM ways meet, both pieces faded
// and the satellite ground showed through the gap (in-game, 2026-10-22).
const ASPHALT_BASE = {
  name: 'asphalt', material: GLOBAL_DECAL_MATERIALS.asphalt,
  widthScale: 2.0, offset: 0,
  renderPriority: 14, textureLength: SURFACE_TEXTURE_LENGTH.asphalt, breakAngle: 2,
  startEndFadeMag: 0, distanceFade: [250, 150], drivability: 1,
};
// Invisible drivable path at the driving width, used when the asphalt is wider
// (parking lanes / shoulders). Carries the nav metadata instead of the asphalt.
const AI_PATH_LAYER = {
  name: 'ai_path', material: GLOBAL_DECAL_MATERIALS.invisible,
  renderPriority: 20, textureLength: 10, breakAngle: 2, drivability: 1,
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
      renderPriority: 14, textureLength: SURFACE_TEXTURE_LENGTH.dirt, breakAngle: 1, startEndFadeMag: 0, drivability: 1 },
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

function hasWidthTags(tags = {}) {
  return ['width', 'lanes', 'lanes:forward', 'lanes:backward']
    .some((key) => tags[key] !== undefined && String(tags[key]).trim() !== '');
}

// Corridor driving width for ways that carry no lanes / width tag: the most
// common width among the corridor's tagged ways, so an untagged piece of a
// four-lane road isn't drawn at the two-lane default. Tagged ways keep their
// own width — evening those out to the widest one painted all of Big
// Cottonwood Canyon Road (2 lanes, with 3-lane passing stretches and one
// 4-lane block) at four-lane width, running up the cut slopes beside it.
function buildStableDecalHalfWidthMap(roads = []) {
  const widthGroups = new Map();

  for (const road of roads) {
    const tags = road?.tags || {};
    const highway = tags.highway || road?.highway;
    if (!STABLE_DECAL_WIDTH_HIGHWAYS.has(highway)) continue;

    const members = Array.isArray(road.members) && road.members.length > 0 ? road.members : [road];
    const key = getDecalWidthCorridorKey(road);
    const counts = widthGroups.get(key) || new Map();
    for (const member of members) {
      const memberTags = member?.tags || {};
      if (!hasWidthTags(memberTags)) continue;
      const isOneWay = isOneWayRoad(memberTags);
      const style = HIGHWAY_STYLE[highway] ?? DEFAULT_ROAD_STYLE;
      const halfWidth = estimateRoadHalfWidth(memberTags, highway, isOneWay, style.width);
      if (Number.isFinite(halfWidth) && halfWidth > 0) counts.set(halfWidth, (counts.get(halfWidth) || 0) + 1);
    }
    widthGroups.set(key, counts);
  }

  const stableMap = new Map();
  for (const [key, counts] of widthGroups.entries()) {
    let best = 0;
    let bestCount = 0;
    for (const [width, count] of counts) {
      if (count > bestCount || (count === bestCount && width > best)) {
        best = width;
        bestCount = count;
      }
    }
    if (bestCount > 0) stableMap.set(key, best);
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
function getDecalRoadNavMetadata(highway, tags = {}, { leftHandTraffic = false, givesWay = false } = {}) {
  const oneWay = isOneWayRoad(tags);
  const meta = { ...inferManualLaneData(highway, tags, oneWay, leftHandTraffic) };
  // Road hierarchy for junction priority (beamngMapNavigation.inferRoadDrivability).
  meta.drivability = Math.round((inferRoadDrivability(highway, tags) - (givesWay ? GIVE_WAY_DRIVABILITY_STEP : 0)) * 1000) / 1000;
  // Only a mapped maxspeed: without it BeamNG derives a speed itself.
  const speedLimit = parseMaxspeedMps(tags);
  if (speedLimit) meta.speedLimit = speedLimit;

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

// Spline sampling step between nodes (docs: 0.1 = every 10 %). The engine's
// 0.1 sampled our 2 m-spaced nodes every 20 cm, and many roads vanished in-game;
// 0.5 (the midpoint only) draws them (in-game, 2026-10-22). West Coast USA's
// own roads mostly use 0.2-1.
const DECAL_ROAD_DETAIL = 0.5;

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
  decal.detail = Number.isFinite(props.detail) ? props.detail : DECAL_ROAD_DETAIL;
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

// Edge lines sit this far inside the carriageway edge (BeamNG.Earth: 0.3 m).
const EDGE_LINE_INSET_M = 0.3;
// Narrower two-way roads get no centre line (BeamNG.Earth: centre only at ≥ 6 m
// of paved width; 5.5 m of driving width here, parking/shoulders excluded).
const CENTRE_LINE_MIN_WIDTH_M = 5.5;

const hasSidewalkTag = (tags = {}) => ['sidewalk', 'sidewalk:both', 'sidewalk:left', 'sidewalk:right']
  .some((key) => ['both', 'left', 'right', 'yes', 'separate'].includes(String(tags[key] ?? '').trim().toLowerCase()));

/**
 * Build line-marking decal layers (center line, edge lines, lane separators)
 * for one road corridor from its OSM tags.
 *
 * Geometry/sign conventions (see offsetNodes): a POSITIVE offset places the
 * line on the LEFT of the node-order direction. oneway=yes ways are digitized
 * in the travel direction (routing requires it); oneway=-1 runs against it,
 * flipping which side is travel-left.
 *
 * Style by country (options.style, from the export's road rules):
 *   'americas' — yellow centre lines: double solid by default, single dashed
 *                where overtaking=yes; one-way main roads get a yellow
 *                median-side edge (US divided-highway convention).
 *   'white'    — the rest of the world: one white centre line, dashed, solid
 *                where overtaking=no; white edges everywhere.
 * Lane separators are white dashed in both. Two-way roads get the centre line
 * at the forward/backward lane boundary, only when at least
 * CENTRE_LINE_MIN_WIDTH_M wide. Major roads get edge lines unless they are
 * urban streets with sidewalks (a kerb, not paint, marks the edge there).
 *
 * Caveat: when lanes:forward/backward are asymmetric AND the corridor merger
 * reversed the seed geometry, the painted layout mirrors. Symmetric layouts
 * (the overwhelmingly common case) are unaffected.
 */
export function buildLineMarkingLayers(highway, tags = {}, styleHalfWidth = 3.5, options = {}) {
  const style = options.style === 'white' ? 'white' : 'americas';
  const majorRoad = MAJOR_ROAD_MARKINGS.has(highway);
  const edgeOffset = Math.max(0.5, styleHalfWidth - EDGE_LINE_INSET_M);
  const layers = [];
  const drawEdgeLines = majorRoad && !(options.urban && hasSidewalkTag(tags));
  const overtaking = String(tags.overtaking ?? '').trim().toLowerCase();

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

    if (drawEdgeLines) {
      const leftSign = isReverseOneWayRoad(tags) ? -1 : 1;
      layers.push({
        name: leftSign > 0 ? 'line_right' : 'line_left',
        material: style === 'americas' ? GLOBAL_DECAL_MATERIALS.lineYellowSingle : GLOBAL_DECAL_MATERIALS.lineWhite,
        width: 0.15, offset: leftSign * edgeOffset, renderPriority: 1, ...LINE_LAYER_BASE,
      });
      layers.push({
        name: leftSign > 0 ? 'line_left' : 'line_right', material: GLOBAL_DECAL_MATERIALS.lineWhite,
        width: 0.15, offset: -leftSign * edgeOffset, renderPriority: 1, ...LINE_LAYER_BASE,
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
  if (2 * styleHalfWidth >= CENTRE_LINE_MIN_WIDTH_M) {
    const centerOffset = -edgeOffset + (2 * edgeOffset * nF) / lanes;
    let centre;
    if (style === 'americas') {
      centre = overtaking === 'yes'
        ? { material: GLOBAL_DECAL_MATERIALS.lineYellowDashed, width: 0.15 }
        : { material: GLOBAL_DECAL_MATERIALS.lineYellowDouble, width: 0.4 };
    } else {
      centre = overtaking === 'no'
        ? { material: GLOBAL_DECAL_MATERIALS.lineWhite, width: 0.15 }
        : { material: GLOBAL_DECAL_MATERIALS.lineWhiteDashed, width: 0.15 };
    }
    layers.push({
      name: 'line_center', ...centre, offset: centerOffset, renderPriority: 2, ...LINE_LAYER_BASE,
    });
  }

  let seps = 0;
  for (let k = 1; k < lanes && seps < MAX_PAINTED_LANE_SEPARATORS; k++) {
    if (k === nF) continue; // that boundary is the center divider
    seps++;
    pushSeparator(k, lanes);
  }

  if (drawEdgeLines) {
    layers.push({
      name: 'line_left', material: GLOBAL_DECAL_MATERIALS.lineWhite,
      width: 0.15, offset: -edgeOffset, renderPriority: 1, ...LINE_LAYER_BASE,
    });
    layers.push({
      name: 'line_right', material: GLOBAL_DECAL_MATERIALS.lineWhite,
      width: 0.15, offset: edgeOffset, renderPriority: 1, ...LINE_LAYER_BASE,
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

  // styleHalfWidth is the whole carriageway (parking / shoulders included);
  // lanes, paint and the AI path use the driving width inside it.
  const drivingHalfWidth = Number.isFinite(options.drivingHalfWidth) && options.drivingHalfWidth > 0
    ? Math.min(options.drivingHalfWidth, styleHalfWidth)
    : styleHalfWidth;
  const laneShift = Number.isFinite(options.laneShift) ? options.laneShift : 0;
  const paving = isUnpaved ? null : pavingOf(tags.surface, { americas: options.markingStyle === 'americas' });
  // paved in strips, none of which can carry the AI: an invisible path does
  const separateAiPath = !isUnpaved && (!!paving || styleHalfWidth - drivingHalfWidth > 0.1);

  const concrete = !isUnpaved && CONCRETE_SURFACES.has(String(tags.surface ?? '').trim().toLowerCase());
  let layers = (ROAD_TEMPLATES[templateKey] || ROAD_TEMPLATES.default).filter((layer) => {
    // the asphalt-to-grass blend belongs to asphalt
    if (layer.name.startsWith('edge_')) return grassEdgeBlendEnabled && !paving;
    return true;
  }).flatMap((layer) => {
    if (layer.name !== 'asphalt') return [layer];
    if (paving) {
      return pavingStrips(paving, 2 * styleHalfWidth).map((strip) => ({
        ...layer, ...strip, name: 'paving', material: PAVING_MATERIALS[paving].material.name, widthScale: undefined,
      }));
    }
    return [concrete
      ? { ...layer, material: GLOBAL_DECAL_MATERIALS.concrete, textureLength: SURFACE_TEXTURE_LENGTH.concrete }
      : layer];
  });
  if (separateAiPath) {
    // Like the official maps' road_invisible: the AI drives the lanes, not the
    // parking lane or shoulder the asphalt also covers.
    layers = layers.map((layer) => (layer.drivability ? { ...layer, drivability: undefined } : layer));
    layers.push({
      ...AI_PATH_LAYER, width: 2 * drivingHalfWidth, offset: laneShift,
    });
  }
  if (!isUnpaved && laneMarkingsEnabled) {
    layers.push(...buildLineMarkingLayers(highway, tags, drivingHalfWidth, {
      style: options.markingStyle, urban: options.urban,
    })
      .map((layer) => ({ ...layer, offset: layer.offset + laneShift })));
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
    if (layer.name === 'asphalt' || layer.name === 'dirt' || layer.name === 'paving') levelName = 'Base';
    else if (layer.name === 'line_center') levelName = 'Center Line';
    else if (layer.name === 'line_left') levelName = 'Edge Line - Left';
    else if (layer.name === 'line_right') levelName = 'Edge Line - Right';
    else if (layer.name === 'edge_left') levelName = 'Edge Blend - Left';
    else if (layer.name === 'edge_right') levelName = 'Edge Blend - Right';
    else if (layer.name === 'ai_path') levelName = 'AI Path';

    // Fade only at a road's true termini — never at internal chunk joins, or
    // every ~chunk boundary would show a gap. mirrored layers swap start/end.
    let startEndFade;
    if (layer.startEndFadeMag === 0) {
      startEndFade = [0, 0];   // written out: the engine's default is not documented
    } else if (Number.isFinite(layer.startEndFadeMag) && layer.startEndFadeMag > 0) {
      let s = options.isRoadStart ? layer.startEndFadeMag : 0;
      let e = options.isRoadEnd ? layer.startEndFadeMag : 0;
      if (layer.mirrorByReversingNodes) { const t = s; s = e; e = t; }
      startEndFade = [s, e];
    }

    const isBaseSurface = layer.name === 'asphalt' || layer.name === 'dirt' || layer.name === 'paving';
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

    if (decal) {
      // Internal tags for the paint cut pass (removed before export).
      Object.defineProperty(decal, '__layer', { value: layer.name, enumerable: false });
      decals.push(decal);
    }
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
// Lines stop this far outside a crossing road's carriageway (BeamNG.Earth
// roads.py: lines 2 m); edge blends stop at its asphalt.
const PAINT_CUT_MARGIN_M = { line: 2.0, edge: 0.0 };
const isCutPaintLayer = (layerName) => typeof layerName === 'string'
  && (layerName.startsWith('line_') || layerName.startsWith('edge_'));

/**
 * Cut every painted line / edge blend where it runs onto another road's
 * carriageway (see roadMarkingCuts.js). A road ignores itself and the road
 * it simply continues into (an endpoint shared by exactly two roads).
 */
function cutPaintAtOtherRoads(paintDecals, index, drivableRoads, ownersAtNode, zones = []) {
  if (paintDecals.length === 0 || index.segments.length === 0) return;
  const ignoredBy = new Map();
  const ignoreSetFor = (owner) => {
    if (ignoredBy.has(owner)) return ignoredBy.get(owner);
    const set = new Set([owner]);
    const seg = drivableRoads[owner];
    for (const key of [seg?.startKey, seg?.endKey]) {
      const owners = key ? ownersAtNode.get(key) : null;
      if (owners && owners.size === 2) owners.forEach((o) => set.add(o));
    }
    ignoredBy.set(owner, set);
    return set;
  };
  let removed = 0;
  let pieces = 0;
  for (const { decal, group, owner } of paintDecals) {
    const ignore = ignoreSetFor(owner);
    const isLine = decal.__layer.startsWith('line_');
    const margin = isLine ? PAINT_CUT_MARGIN_M.line : PAINT_CUT_MARGIN_M.edge;
    const runs = cutNodes(decal.nodes, (x, y) => (
      isOnOtherCarriageway(index, x, y, margin, (o) => ignore.has(o))
      || (isLine && isInZone(zones, x, y))
    ));
    if (runs.length === 1 && runs[0].length === decal.nodes.length) continue; // untouched
    const at = group.__items.indexOf(decal);
    if (at < 0) continue;
    const replacements = runs.map((nodes, k) => ({
      ...decal,
      name: runs.length > 1 ? `${decal.name}_${k + 1}` : decal.name,
      persistentId: k === 0 ? decal.persistentId : generatePersistentId(),
      nodes,
      // A cut end is a clean paint edge, not a faded road terminus.
      ...(decal.startEndFade ? { startEndFade: [0, 0] } : {}),
    }));
    group.__items.splice(at, 1, ...replacements);
    if (runs.length === 0) removed++;
    pieces += runs.length;
  }
  console.log(`[BeamNG Export] Paint cut at crossing roads: ${paintDecals.length} lines/blends → ${pieces} pieces (${removed} removed entirely).`);
}

// Road paint and sign style by location: 'americas' (yellow centre lines,
// US signs; also BeamNG's US default when the location is unknown) or
// 'white' (white centre lines, Vienna-convention signs) everywhere else.
function getMarkingStyle(roadRules) {
  return !roadRules?.countryCode || roadRules.region === 'Americas' ? 'americas' : 'white';
}

const isBridgeRoad = (tags = {}) => (
  (!!tags.bridge && tags.bridge !== 'no')
  || tags.man_made === 'bridge'
  || tags.location === 'elevated'
  || tags.location === 'overground'
);

// Half widths (m) for linear waterways when deciding what a bridge is over.
const WATERWAY_HALF_M = { river: 10, canal: 6, stream: 2, drain: 1, ditch: 1 };

// Within this far of an OSM coastline its side decides land or sea (OSM draws
// coastlines with the land on the left): river mouths and bays near the sea
// are often mapped as sea, with no water polygon (the St. Johns at Dames Point).
const COAST_REACH_M = 2000;
const COAST_CELL_M = 256;
// Water within this far of a ship-channel line (waterway tagged ship /
// deep_draft) is a ship channel.
const SHIP_CHANNEL_REACH_M = 150;

/**
 * wetAt(x, y): 0 on land, 1 over OSM water (areas, rivers / streams by a
 * typical width, the sea by its coastline), 2 over a ship channel.
 */
export function buildWaterLookup(terrainData, squareSize) {
  const CELL = 64;
  const cells = new Map();
  const add = (box, item) => {
    for (let cx = Math.floor(box[0] / CELL); cx <= Math.floor(box[2] / CELL); cx++) {
      for (let cy = Math.floor(box[1] / CELL); cy <= Math.floor(box[3] / CELL); cy++) {
        const k = `${cx},${cy}`;
        if (!cells.has(k)) cells.set(k, []);
        cells.get(k).push(item);
      }
    }
  };
  for (const f of terrainData.osmFeatures || []) {
    if (f.type !== 'water' || !Array.isArray(f.geometry) || f.geometry.length < 2) continue;
    const xy = f.geometry.map((p) => geoToWorldPoint(p.lat, p.lng, terrainData, squareSize, 0));
    const waterway = f.tags?.waterway;
    const half = WATERWAY_HALF_M[waterway];
    const closed = xy.length > 3 && Math.hypot(xy[0][0] - xy[xy.length - 1][0], xy[0][1] - xy[xy.length - 1][1]) < 0.5;
    const pad = half ?? 0;
    const box = [
      Math.min(...xy.map((p) => p[0])) - pad, Math.min(...xy.map((p) => p[1])) - pad,
      Math.max(...xy.map((p) => p[0])) + pad, Math.max(...xy.map((p) => p[1])) + pad,
    ];
    const ship = f.tags?.deep_draft === 'yes' || f.tags?.ship === 'yes';
    // Polygons assembled from relations need not repeat their first point:
    // anything but an open waterway line is an area.
    if (half != null && !closed) add(box, { line: xy, half, ship });
    else if (xy.length >= 3) add(box, { ring: xy, ship, holes: (f.holes || []).map((h) => h.map((p) => geoToWorldPoint(p.lat, p.lng, terrainData, squareSize, 0))) });
  }
  // ship-channel lines, coastline segments and mapped land (islands in the
  // sea: a wood or a marsh with no coastline of its own), each in their grid
  const shipLines = [];
  const coast = new Map();
  const landCells = new Map();
  const LAND_NATURAL = new Set(['wood', 'scrub', 'grassland', 'heath', 'wetland', 'sand', 'beach', 'bare_rock', 'scree']);
  for (const f of terrainData.osmFeatures || []) {
    const t = f.tags || {};
    const isLand = (f.type === 'building' || (f.type === 'landuse' && (t.landuse || t.leisure || LAND_NATURAL.has(t.natural))))
      && !t.water && t.natural !== 'water';
    if (!isLand || !Array.isArray(f.geometry) || f.geometry.length < 3) continue;
    const ring = f.geometry.map((p) => geoToWorldPoint(p.lat, p.lng, terrainData, squareSize, 0));
    const xs = ring.map((p) => p[0]); const ys = ring.map((p) => p[1]);
    for (let cx = Math.floor(Math.min(...xs) / COAST_CELL_M); cx <= Math.floor(Math.max(...xs) / COAST_CELL_M); cx++) {
      for (let cy = Math.floor(Math.min(...ys) / COAST_CELL_M); cy <= Math.floor(Math.max(...ys) / COAST_CELL_M); cy++) {
        const k = `${cx},${cy}`;
        if (!landCells.has(k)) landCells.set(k, []);
        landCells.get(k).push(ring);
      }
    }
  }
  for (const f of terrainData.osmFeatures || []) {
    if (!Array.isArray(f.geometry) || f.geometry.length < 2) continue;
    const isShip = f.type === 'water' && f.tags?.waterway && (f.tags.deep_draft === 'yes' || f.tags.ship === 'yes');
    if (!isShip && f.type !== 'coastline') continue;
    const xy = f.geometry.map((p) => geoToWorldPoint(p.lat, p.lng, terrainData, squareSize, 0));
    if (isShip) { shipLines.push(xy); continue; }
    for (let i = 0; i + 1 < xy.length; i++) {
      const [ax, ay] = xy[i]; const [bx, by] = xy[i + 1];
      for (let cx = Math.floor(Math.min(ax, bx) / COAST_CELL_M); cx <= Math.floor(Math.max(ax, bx) / COAST_CELL_M); cx++) {
        for (let cy = Math.floor(Math.min(ay, by) / COAST_CELL_M); cy <= Math.floor(Math.max(ay, by) / COAST_CELL_M); cy++) {
          const k = `${cx},${cy}`;
          if (!coast.has(k)) coast.set(k, []);
          coast.get(k).push([ax, ay, bx, by]);
        }
      }
    }
  }
  const nearest = (x, y, segs) => {
    let best = null; let bestD = Infinity;
    for (const [ax, ay, bx, by] of segs) {
      const vx = bx - ax; const vy = by - ay;
      const L2 = vx * vx + vy * vy || 1e-9;
      const t = Math.max(0, Math.min(1, ((x - ax) * vx + (y - ay) * vy) / L2));
      const d = Math.hypot(ax + vx * t - x, ay + vy * t - y);
      if (d < bestD) { bestD = d; best = [ax, ay, bx, by]; }
    }
    return { seg: best, d: bestD };
  };
  const seaAt = (x, y) => {
    if (!coast.size) return false;
    const reach = Math.ceil(COAST_REACH_M / COAST_CELL_M);
    const cx = Math.floor(x / COAST_CELL_M); const cy = Math.floor(y / COAST_CELL_M);
    // the nearest coastline segment, searching outward ring by ring
    for (let r = 0; r <= reach; r++) {
      const segs = [];
      for (let dx = -r; dx <= r; dx++) {
        for (let dy = -r; dy <= r; dy++) segs.push(...(coast.get(`${cx + dx},${cy + dy}`) || []));
      }
      if (!segs.length) continue;
      const { seg, d } = nearest(x, y, segs);
      if (d > (r + 1) * COAST_CELL_M && r < reach) continue;   // something nearer may sit one ring out
      if (d > COAST_REACH_M) return false;
      const [ax, ay, bx, by] = seg;
      return (bx - ax) * (y - ay) - (by - ay) * (x - ax) < 0;   // right of the coastline: the sea
    }
    return false;
  };
  const nearShipChannel = (x, y) => shipLines.some((line) => {
    for (let i = 0; i + 1 < line.length; i++) {
      const vx = line[i + 1][0] - line[i][0]; const vy = line[i + 1][1] - line[i][1];
      const L2 = vx * vx + vy * vy || 1e-9;
      const t = Math.max(0, Math.min(1, ((x - line[i][0]) * vx + (y - line[i][1]) * vy) / L2));
      if (Math.hypot(line[i][0] + vx * t - x, line[i][1] + vy * t - y) < SHIP_CHANNEL_REACH_M) return true;
    }
    return false;
  });
  const inRing = (x, y, ring) => {
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = ring[i];
      const [xj, yj] = ring[j];
      if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
  };
  return (x, y) => {
    let wet = 0;
    for (const item of cells.get(`${Math.floor(x / CELL)},${Math.floor(y / CELL)}`) || []) {
      if (item.ring) {
        if (inRing(x, y, item.ring) && !item.holes.some((h) => inRing(x, y, h))) wet = Math.max(wet, item.ship ? 2 : 1);
        continue;
      }
      const q = item.line;
      for (let i = 0; i + 1 < q.length; i++) {
        const vx = q[i + 1][0] - q[i][0]; const vy = q[i + 1][1] - q[i][1];
        const L2 = vx * vx + vy * vy || 1e-9;
        const t = Math.max(0, Math.min(1, ((x - q[i][0]) * vx + (y - q[i][1]) * vy) / L2));
        if (Math.hypot(q[i][0] + vx * t - x, q[i][1] + vy * t - y) < item.half) { wet = Math.max(wet, item.ship ? 2 : 1); break; }
      }
    }
    if (wet === 0 && seaAt(x, y)
      && !(landCells.get(`${Math.floor(x / COAST_CELL_M)},${Math.floor(y / COAST_CELL_M)}`) || []).some((r) => inRing(x, y, r))) wet = 1;
    if (wet === 1 && nearShipChannel(x, y)) wet = 2;
    return wet;
  };
}

/**
 * Bridge decks for the drawn road segments (services/beamngBridges.js):
 * Map segIndex → solved part ({ xy, z, half }), and the decks. A deck that
 * cannot clear what it crosses gets approach embankments raised into the
 * terrain (terrainData.heightMap is replaced by a raised copy, never edited
 * in place: it is shared with the app's own terrain), then all are re-solved.
 */
// Bare-earth (lidar) elevation has every bridge taken out: under it, a gap
// down to the ground, and the approach embankment ends in a cliff. Where OSM
// ends a bridge short of that cliff the approach road runs on in the gap and
// then climbs the cliff; the deck is carried on along it instead, to where
// the ground has come up (the real bridge is there).
const BERM_SEARCH_M = 30;       // how far past a bridge's end a cliff is looked for
const BERM_RISE_M = 2;          // a rise this steep within BERM_STEP_M is a cliff
const BERM_STEP_M = 4;
const BERM_MIN_M = 1.5;         // the berm top over the bridge's end

// Road classes a deck always clears (never a junction at grade by its
// abutment): VA 337 over I-264, Norfolk, came down onto the freeway
const MAJOR_UNDER_ROADS = new Set(['motorway', 'trunk', 'primary']);
const AT_GRADE_REACH_M = 12;     // as beamngBridges: a minor road met this near an abutment is at grade
                                 // (unless it passes through: no junction of its own near the crossing)

// Roads sunk under decks (sinkRoadsUnderDecks): the drop tapers off along
// the road at SINK_GRADE, the cutting's floor its carriageway + shoulders,
// 1:1 sides up to the ground.
const SINK_GRADE = 0.04;
const SINK_GRADE_MAX = 0.06;    // steeper where a junction is near, never more
const SINK_MAX_M = 7;
const SINK_MIN_M = 1.0;         // a deck short by less than this is left (a gentle dip looked like a ramp)
const SINK_SHOULDER_M = 1.5;

/** Where polylines a and b cross in plan: [[x, y]]. */
function planCrossingPoints(a, b) {
  const out = [];
  for (let i = 0; i + 1 < a.length; i++) {
    const [ax, ay] = a[i]; const [bx, by] = a[i + 1];
    for (let j = 0; j + 1 < b.length; j++) {
      const [cx, cy] = b[j]; const [dx, dy] = b[j + 1];
      const den = (bx - ax) * (dy - cy) - (by - ay) * (dx - cx);
      if (Math.abs(den) < 1e-9) continue;
      const t = ((cx - ax) * (dy - cy) - (cy - ay) * (dx - cx)) / den;
      const u = ((cx - ax) * (by - ay) - (cy - ay) * (bx - ax)) / den;
      if (t >= 0 && t <= 1 && u >= 0 && u <= 1) out.push([ax + (bx - ax) * t, ay + (by - ay) * t]);
    }
  }
  return out;
}

/**
 * Lower each sink's road into a cutting under the deck over it: { road,
 * at: [x, y] (where the deck crosses), deficit (m) }. The road is followed
 * on through plain continuations for the taper. Returns the sinks cut.
 */
function sinkRoadsUnderDecks(terrainData, squareSize, sinks, lowerRoads, tunnels = []) {
  const { width, height, minHeight } = terrainData;
  const hm = heightMapEditor(terrainData);
  const worldSize = width * squareSize;
  const toPixel = (x, y) => [(x / worldSize + 0.5) * (width - 1), (0.5 - y / worldSize) * (height - 1)];
  const toWorld = (c, r) => [((c / (width - 1)) - 0.5) * worldSize, (0.5 - r / (height - 1)) * worldSize];
  const near = (p, q) => Math.hypot(p[0] - q[0], p[1] - q[1]) < 1.5;
  const touching = (tip, used) => lowerRoads.filter((r) => !used.has(r) && (near(r.xy[0], tip) || near(r.xy[r.xy.length - 1], tip)));
  const outward = (r, tip) => (near(r.xy[0], tip) ? r.xy : [...r.xy].reverse());
  const heading = (pts) => {
    const a = pts[0]; const b = pts[Math.min(pts.length - 1, 3)];
    const L = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
    return [(b[0] - a[0]) / L, (b[1] - a[1]) / L];
  };
  // A road as a line with the ground on it, every 2 m, from the ground as it
  // was. through: on through junctions along the road most in line (a
  // freeway sinks past the ramps meeting it), the others noted as branches
  // ({ at: [x, y], roads }); else only on through plain continuations.
  const lineOf = (road, from = null, through = true) => {
    const raw = from ? outward(road, from).map((p) => [p[0], p[1]]) : road.xy.map((p) => [p[0], p[1]]);
    const used = new Set([road]);
    const branches = [];
    for (const end of from ? [1] : [0, 1]) {
      for (let guard = 0; guard < 40; guard++) {
        const tip = end ? raw[raw.length - 1] : raw[0];
        const prev = end ? raw[Math.max(0, raw.length - 4)] : raw[Math.min(raw.length - 1, 3)];
        const dl = Math.hypot(tip[0] - prev[0], tip[1] - prev[1]) || 1;
        const dir = [(tip[0] - prev[0]) / dl, (tip[1] - prev[1]) / dl];
        const next = touching(tip, used);
        if (!next.length) break;
        let go = null;
        if (next.length === 1) go = next[0];
        else if (through) {
          // (the same class first: a freeway goes on as the freeway, not
          // down the ramp leaving it at a shallow angle)
          const ranked = next.map((r) => { const h = heading(outward(r, tip)); return { r, a: h[0] * dir[0] + h[1] * dir[1] + (r.highway === road.highway ? 0.3 : 0) }; })
            .sort((p, q) => q.a - p.a);
          if (ranked[0].a - (ranked[0].r.highway === road.highway ? 0.3 : 0) > 0.8) go = ranked[0].r;
        }
        if (!go) break;
        if (next.length > 1) branches.push({ at: [tip[0], tip[1]], roads: next.filter((r) => r !== go) });
        next.forEach((r) => used.add(r));
        const piece = outward(go, tip).slice(1).map((p) => [p[0], p[1]]);
        if (end) raw.push(...piece); else raw.unshift(...piece.reverse());
      }
    }
    const line = resample(raw, 2).map(([x, y]) => [x, y, getTerrainHeightAtWorldXY(x, y, terrainData, squareSize)]);
    const s = [0];
    for (let i = 1; i < line.length; i++) s.push(s[i - 1] + Math.hypot(line[i][0] - line[i - 1][0], line[i][1] - line[i - 1][1]));
    const stationOf = (x, y) => { let best = Infinity; let sv = 0; line.forEach((p, i) => { const d = Math.hypot(p[0] - x, p[1] - y); if (d < best) { best = d; sv = s[i]; } }); return sv; };
    return { line, s, used, branches: branches.map((b) => ({ ...b, s: stationOf(...b.at) })), stationOf };
  };
  // every sink planned on the ground as it was (planned one after another
  // on ground already cut, the cuts under one deck stacked: Deck Park's
  // freeway went 15 m down), the ones at one crossing merged (the deepest)
  const lines = new Map();
  const plans = [];
  for (const sink of sinks) {
    // a road in a tunnel's approach cutting is the tunnel's: already sunk
    if (tunnels.some((t) => t.kind !== 'gallery' && (() => { const n = nearestOnTunnel(t, ...sink.at, t.W + 2); return n && !n.beyond && Math.abs(n.d) < t.W; })())) continue;
    if (!lines.has(sink.road)) lines.set(sink.road, lineOf(sink.road));
    const L = lines.get(sink.road);
    const s0 = L.stationOf(...sink.at);
    const same = plans.find((q) => q.road === sink.road && Math.abs(q.s0 - s0) < 30);
    if (same) { same.deficit = Math.max(same.deficit, sink.deficit); continue; }
    plans.push({ road: sink.road, L, s0, deficit: sink.deficit });
  }
  const smooth = (f) => f * f * (3 - 2 * f);
  // lower the ground along a line by drop(s) (its carriageway + shoulders the
  // floor, 1:1 sides), sparing the roads not in `own` and tunnel cover
  const cutAlong = (L, drop, sMin, sMax, floorHalf, depth, own) => {
    const pts = L.line.map((p, i) => ({ x: p[0], y: p[1], z: p[2], s: L.s[i] })).filter((p) => p.s >= sMin && p.s <= sMax);
    if (pts.length < 2) return;
    const reach = floorHalf + depth + 1;
    const xs = pts.map((p) => p.x); const ys = pts.map((p) => p.y);
    const [c0, r1] = toPixel(Math.min(...xs) - reach, Math.min(...ys) - reach);
    const [c1, r0] = toPixel(Math.max(...xs) + reach, Math.max(...ys) + reach);
    const box = [Math.min(...xs) - reach - 20, Math.min(...ys) - reach - 20, Math.max(...xs) + reach + 20, Math.max(...ys) + reach + 20];
    // the other roads keep their ground (the cut's sides stop at a road
    // running beside: a ramp next to the sunk one got a 3 m step)
    const others = lowerRoads.filter((r) => !own.has(r) && r.xy.some(([x, y]) => x >= box[0] && x <= box[2] && y >= box[1] && y <= box[3]));
    const onOther = (x, y) => others.some((r) => distanceToLine(r.xy, x, y) < r.half + 1);
    for (let r = Math.max(0, Math.floor(r0)); r <= Math.min(height - 1, Math.ceil(r1)); r++) {
      for (let c = Math.max(0, Math.floor(c0)); c <= Math.min(width - 1, Math.ceil(c1)); c++) {
        const [x, y] = toWorld(c, r);
        let bestD = Infinity; let target = Infinity;
        for (let i = 0; i + 1 < pts.length; i++) {
          const a = pts[i]; const b = pts[i + 1];
          const vx = b.x - a.x; const vy = b.y - a.y;
          const L2 = vx * vx + vy * vy || 1e-9;
          const t = Math.max(0, Math.min(1, ((x - a.x) * vx + (y - a.y) * vy) / L2));
          const d = Math.hypot(a.x + vx * t - x, a.y + vy * t - y);
          if (d >= bestD) continue;
          bestD = d;
          target = a.z + (b.z - a.z) * t - drop(a.s + (b.s - a.s) * t) + Math.max(0, d - floorHalf);
        }
        if (bestD > reach) continue;
        if (bestD > floorHalf && onOther(x, y)) continue;
        // never into the cover over a tunnel's tube
        for (const t of tunnels) {
          if (t.kind === 'gallery') continue;
          const n = nearestOnTunnel(t, x, y, t.W + (t.maxExtra || 0) + LINING_M + 4);
          if (n && !n.beyond && n.into > -1) target = Math.max(target, n.z + t.need);
        }
        const idx = r * width + c;
        if (target + minHeight < hm.at(idx)) hm.set(idx, target + minHeight);
      }
    }
  };
  const cut = [];
  for (const sink of plans) {
    const { L, s0 } = sink;
    // (below the sea is fine: the sea is drawn where the ground was under it
    // before any grading, so a cut stays dry); no deeper than the room to the
    // line's ends allows
    const room = Math.min(s0 - L.s[0], L.s[L.s.length - 1] - s0);
    const depth = Math.min(sink.deficit, SINK_GRADE_MAX * room);
    if (depth < SINK_MIN_M / 2) continue;
    const taper = Math.min(depth / SINK_GRADE, room);
    const drop = (sv) => depth * smooth(Math.max(0, 1 - Math.abs(sv - s0) / taper));
    // the roads meeting it where it is lowered go down with it: each from
    // the depth at the junction back up along itself
    const branchCuts = [];
    for (const br of L.branches) {
      const dj = drop(br.s);
      if (dj < 0.3) continue;
      for (const road of br.roads) {
        const B = lineOf(road, br.at, false);
        const tB = Math.min(dj / SINK_GRADE, B.s[B.s.length - 1]);
        branchCuts.push({ B, road, dj, tB });
      }
    }
    const own = new Set([...L.used, ...branchCuts.flatMap((bc) => [...bc.B.used])]);
    cutAlong(L, drop, s0 - taper, s0 + taper, sink.road.half + SINK_SHOULDER_M, depth, own);
    for (const { B, road, dj, tB } of branchCuts) {
      cutAlong(B, (sb) => dj * smooth(Math.max(0, 1 - sb / tB)), 0, tB, road.half + SINK_SHOULDER_M, dj, own);
    }
    const i0 = L.s.reduce((bi, sv, i) => (Math.abs(sv - s0) < Math.abs(L.s[bi] - s0) ? i : bi), 0);
    cut.push({ at: [Math.round(L.line[i0][0]), Math.round(L.line[i0][1])], depth: Math.round(depth * 10) / 10, branches: branchCuts.length });
  }
  return cut;
}

// A deck joint some ground road starts from is down at the ground there:
// the bridge ends there for that road (North 7th Street, Phoenix: its bridge
// and a merging ramp's end together, the street running on at grade).
const groundRoadStarts = (lowerRoads, isFreeEnd) => (x, y) => !isFreeEnd(x, y) && lowerRoads.some((r) => {
  const a = r.xy[0]; const b = r.xy[r.xy.length - 1];
  return Math.hypot(a[0] - x, a[1] - y) < 1.5 || Math.hypot(b[0] - x, b[1] - y) < 1.5;
});

/**
 * Carry bridges on along their approach roads over a bare-earth gap, up to
 * the berm beyond it: one more part per approach so carried (joined to the
 * bridge at its end, a fork where two ramps leave it), listing the approach's
 * segIndex (.landedOn); the approach road is trimmed to start on the berm.
 * Returns the parts added, as [[part, partSegValue]].
 */
function landOnBerms(parts, lowerRoads, groundAt) {
  const added = [];
  const ends = parts.flatMap((part) => [part.xy[0], part.xy[part.xy.length - 1]].map((end) => ({ part, end })));
  for (const { part, end } of ends) {
    const touching = lowerRoads.filter((r) => {
      const a = r.xy[0]; const b = r.xy[r.xy.length - 1];
      return Math.hypot(a[0] - end[0], a[1] - end[1]) < 1.5 || Math.hypot(b[0] - end[0], b[1] - end[1]) < 1.5;
    });
    for (const road of touching) {
      const fromStart = Math.hypot(road.xy[0][0] - end[0], road.xy[0][1] - end[1]) < 1.5;
      const line = fromStart ? road.xy : [...road.xy].reverse();
      // points along the approach every 2 m, with their arc length
      const pts = [];
      let s0 = 0;
      for (let i = 0; i + 1 < line.length && s0 <= BERM_SEARCH_M + BERM_STEP_M * 2; i++) {
        const L = Math.hypot(line[i + 1][0] - line[i][0], line[i + 1][1] - line[i][1]);
        for (let s = Math.ceil(s0 / 2) * 2; s < s0 + L; s += 2) {
          const t = (s - s0) / L;
          const x = line[i][0] + (line[i + 1][0] - line[i][0]) * t;
          const y = line[i][1] + (line[i + 1][1] - line[i][1]) * t;
          pts.push({ s, x, y, z: groundAt(x, y), i });
        }
        s0 += L;
      }
      const step = BERM_STEP_M / 2;
      let land = -1;
      for (let k = 0; k + step < pts.length && pts[k].s <= BERM_SEARCH_M; k++) {
        if (pts[k + step].z - pts[k].z < BERM_RISE_M) continue;
        // the top of the cliff: where it has stopped rising
        let top = k + step;
        while (top + 1 < pts.length && pts[top + 1].z - pts[top].z > 0.3) top++;
        if (pts[top].z - pts[0].z >= BERM_MIN_M) land = top;
        break;
      }
      if (land < 1) continue;
      const ext = { ...part, xy: [[end[0], end[1]], ...pts.slice(1, land + 1).map(({ x, y }) => [x, y])], landedOn: [road.segIndex] };
      added.push(ext);
      // the approach now starts on the berm
      const rest = [[pts[land].x, pts[land].y, pts[land].z], ...line.slice(pts[land].i + 1)];
      road.xy = fromStart ? rest : rest.reverse();
    }
  }
  return added;
}

// A deck neither the ground nor an embankment lets clear what it crosses
// (an interchange's flyover ramp: OSM maps only the structure as the bridge,
// and the embankments or retaining walls it climbs on are too narrow for 30 m
// elevation to hold; at a junction no embankment can be raised) is carried on
// along its approach roads instead, far enough to climb the shortfall at the
// deck's grade: the approach is drawn on the deck there, as a walled ramp.
const CARRY_MIN_SHORTFALL_M = 0.5;   // short by less than this: left as it is
const CARRY_MAX_M = 300;             // never carried on further than this (per round)
const CARRY_ROUNDS = 3;
const CARRY_CLEAR_M = 25;           // stops this far short of another deck over (or under) the approach
const CARRY_MIN_M = 20;              // shorter than this: not worth carrying on

/**
 * Carry decks on from their abutments along the approach roads: requests
 * [{ x, y, length }] (an abutment and how far). Follows the approach and its
 * plain continuations (one road on, no deck) up to `length`, trimming or
 * dropping the lowerRoads it takes. Returns the parts added (each joined to
 * its deck at the abutment, listing the approaches it runs on, .landedOn).
 */
function carryOnApproaches(parts, lowerRoads, requests, groundAt) {
  const added = [];
  const near = (p, x, y) => Math.hypot(p[0] - x, p[1] - y) < 1.5;
  const endsAt = (xy, x, y) => near(xy[0], x, y) || near(xy[xy.length - 1], x, y);
  // where segment a-b first crosses another deck's line in plan (fraction),
  // or -1; a higher deck is solved after and clears the carried one
  const crossesDeck = (a, b, own) => {
    let first = -1;
    for (const p of parts) {
      if (p === own || (p.layer ?? 1) > (own.layer ?? 1)) continue;
      for (let j = 0; j + 1 < p.xy.length; j++) {
        const [cx, cy] = p.xy[j]; const [dx, dy] = p.xy[j + 1];
        const den = (b[0] - a[0]) * (dy - cy) - (b[1] - a[1]) * (dx - cx);
        if (Math.abs(den) < 1e-9) continue;
        const t = ((cx - a[0]) * (dy - cy) - (cy - a[1]) * (dx - cx)) / den;
        const u = ((cx - a[0]) * (b[1] - a[1]) - (cy - a[1]) * (b[0] - a[0])) / den;
        if (t > 1e-6 && t <= 1 && u >= 0 && u <= 1 && (first < 0 || t < first)) first = t;
      }
    }
    return first;
  };
  const roadBoxes = new Map();
  // where segment a-b first meets another ground road (crossing it, or one
  // ending on it: a junction partway along an OSM way), or -1
  const meetsRoad = (a, b, skip) => {
    const vx = b[0] - a[0]; const vy = b[1] - a[1];
    const L2 = vx * vx + vy * vy || 1e-9;
    let first = -1;
    const take = (t) => { if (t > 1e-6 && t <= 1 && (first < 0 || t < first)) first = t; };
    const box = [Math.min(a[0], b[0]) - 2, Math.min(a[1], b[1]) - 2, Math.max(a[0], b[0]) + 2, Math.max(a[1], b[1]) + 2];
    for (const r of lowerRoads) {
      if (skip.has(r)) continue;
      if (!roadBoxes.has(r)) {
        const xs = r.xy.map((q) => q[0]); const ys = r.xy.map((q) => q[1]);
        roadBoxes.set(r, [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)]);
      }
      const rb = roadBoxes.get(r);
      if (rb[0] > box[2] || rb[2] < box[0] || rb[1] > box[3] || rb[3] < box[1]) continue;
      for (const e of [r.xy[0], r.xy[r.xy.length - 1]]) {
        const t = ((e[0] - a[0]) * vx + (e[1] - a[1]) * vy) / L2;
        if (t >= 0 && t <= 1 && Math.hypot(a[0] + vx * t - e[0], a[1] + vy * t - e[1]) < 2) take(t);
      }
      for (let j = 0; j + 1 < r.xy.length; j++) {
        const [cx, cy] = r.xy[j]; const [dx, dy] = r.xy[j + 1];
        const den = vx * (dy - cy) - vy * (dx - cx);
        if (Math.abs(den) < 1e-9) continue;
        const t = ((cx - a[0]) * (dy - cy) - (cy - a[1]) * (dx - cx)) / den;
        const u = ((cx - a[0]) * vy - (cy - a[1]) * vx) / den;
        if (u >= 0 && u <= 1) take(t);
      }
    }
    return first;
  };
  for (const { x, y, length } of requests) {
    const at = parts.filter((p) => endsAt(p.xy, x, y));
    if (!at.length) continue;
    const start = lowerRoads.filter((r) => endsAt(r.xy, x, y));
    if (start.length !== 1) continue;   // a junction at the abutment
    // where deck parts meet (a ramp merging at the bridge's end) the one most
    // in line with the road running on carries on
    if (at.length > 1) {
      const road = start[0].xy;
      const fromStart = near(road[0], x, y);
      const r1 = fromStart ? road[Math.min(1, road.length - 1)] : road[Math.max(0, road.length - 2)];
      const out = [r1[0] - x, r1[1] - y];
      const inward = (p) => { const q = near(p.xy[0], x, y) ? p.xy[1] : p.xy[p.xy.length - 2]; return [x - q[0], y - q[1]]; };
      const align = (p) => { const v = inward(p); return (v[0] * out[0] + v[1] * out[1]) / ((Math.hypot(...v) * Math.hypot(...out)) || 1); };
      at.sort((a, b) => align(b) - align(a));
    }
    // the approach and its plain continuations, as a path: [x, y, road, i]
    // (point i of that road's line in walking order)
    const path = [[x, y]];
    const steps = [];
    let from = [x, y];
    let road = start[0];
    let walked = 0;
    let limit = length;
    const used = new Set();
    walk: while (road && !used.has(road)) {
      used.add(road);
      const fromStart = near(road.xy[0], from[0], from[1]);
      const line = fromStart ? road.xy : [...road.xy].reverse();
      steps.push({ road, fromStart, line });
      for (let i = 0; i + 1 < line.length; i++) {
        const L = Math.hypot(line[i + 1][0] - line[i][0], line[i + 1][1] - line[i][1]);
        // the approach passes under another deck (or over one, no higher):
        // it is at the ground there, so the carried deck stops well short
        const t = crossesDeck(line[i], line[i + 1], at[0]);
        if (t >= 0) limit = Math.min(limit, walked + t * L - CARRY_CLEAR_M);
        // nor through a junction: a road meeting the approach is at grade
        const tj = meetsRoad(line[i], line[i + 1], new Set([...used, ...start]));
        // (up to it, not short of it: there the deck comes down to the road
        // meeting it, as a ramp leaving a freeway is at its level at the gore)
        if (tj >= 0) limit = Math.min(limit, walked + tj * L);
        if (walked + L >= limit) break walk;
        walked += L;
        path.push([line[i + 1][0], line[i + 1][1]]);
      }
      from = line[line.length - 1];
      const next = lowerRoads.filter((r) => endsAt(r.xy, from[0], from[1]));
      road = next.length === 1 && !parts.some((p) => endsAt(p.xy, from[0], from[1])) ? next[0] : null;
    }
    if (limit < CARRY_MIN_M) continue;
    // now take the approach roads up to the limit
    const xy = [[x, y]];
    const landedOn = [];
    let left = limit;
    for (const { road, fromStart, line } of steps) {
      landedOn.push(road.segIndex);
      let cut = false;
      for (let i = 0; i + 1 < line.length; i++) {
        const L = Math.hypot(line[i + 1][0] - line[i][0], line[i + 1][1] - line[i][1]);
        if (L >= left) {
          const k = left / L;
          const px = line[i][0] + (line[i + 1][0] - line[i][0]) * k;
          const py = line[i][1] + (line[i + 1][1] - line[i][1]) * k;
          xy.push([px, py]);
          const rest = [[px, py, groundAt(px, py)], ...line.slice(i + 1)];
          road.xy = fromStart ? rest : rest.reverse();
          cut = true;
          break;
        }
        xy.push([line[i + 1][0], line[i + 1][1]]);
        left -= L;
      }
      if (cut) break;
      lowerRoads.splice(lowerRoads.indexOf(road), 1);   // the whole road taken
    }
    if (xy.length >= 2) added.push({ ...at[0], xy, landedOn, carried: true });
  }
  return added;
}

// The approach road samples an abutment's height is fitted to (m from the
// bridge's end), and the steepest grade that fit may carry on to it: about
// the steepest streets (a hillside street climbing 23 % from a bridge, held
// to 8 %, put the abutment 3.8 m over the road arriving at it).
const APPROACH_FIT_M = [4, 40];
const APPROACH_MAX_GRADE = 0.25;

function solveExportBridges(drivableRoads, terrainData, squareSize, tunnels = []) {
  const toXY = (geometry) => geometry.map((p) => geoToWorldPoint(p.lat, p.lng, terrainData, squareSize, 0));
  const groundAt = (x, y) => getTerrainHeightAtWorldXY(x, y, terrainData, squareSize);
  const wetAt = buildWaterLookup(terrainData, squareSize);
  // OSM is clipped to the map: a bridge running on past the edge ends there,
  // but that end is no abutment.
  const edge = (terrainData.width * squareSize) / 2 - 3;
  // A bridge meeting a tunnel (tunnel=yes road, bored by solveExportTunnels)
  // has no ground approach there: that end is free too, and the tunnel takes
  // its height from the deck. (Fitting it to the tunnel road's "ground" put
  // the abutment on the hill over the tunnel.)
  const tunnelEnds = [];
  // OSM nodes several ways share (whatever their layers): the junctions
  const nodeRoads = new Map();
  drivableRoads.forEach((seg, i) => {
    for (const p of seg.geometry || []) {
      const k = makeRoadNodeKey(p);
      if (!nodeRoads.has(k)) nodeRoads.set(k, new Set());
      nodeRoads.get(k).add(i);
    }
  });
  const junctionsOf = (seg) => (seg.geometry || []).filter((p) => nodeRoads.get(makeRoadNodeKey(p))?.size > 1)
    .map((p) => geoToWorldPoint(p.lat, p.lng, terrainData, squareSize, 0));
  const isFreeEnd = (x, y) => Math.abs(x) >= edge || Math.abs(y) >= edge
    || tunnelEnds.some(([tx, ty]) => Math.hypot(tx - x, ty - y) < 1.5);
  // Bridge outlines (man_made=bridge) carry the structure type more often
  // than the roads on them do.
  const outlines = (terrainData.osmFeatures || [])
    .filter((f) => f.type === 'bridge_infra' && f.tags?.['bridge:structure'] && f.geometry?.length > 2)
    .map((f) => ({ structure: f.tags['bridge:structure'], ring: toXY(f.geometry) }));
  const inRing = (x, y, ring) => {
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      if ((ring[i][1] > y) !== (ring[j][1] > y) && x < ((ring[j][0] - ring[i][0]) * (y - ring[i][1])) / (ring[j][1] - ring[i][1]) + ring[i][0]) inside = !inside;
    }
    return inside;
  };
  const structureOf = (tags, xy) => tags['bridge:structure']
    || outlines.find((o) => xy.filter(([x, y]) => inRing(x, y, o.ring)).length >= 0.2 * xy.length)?.structure
    || null;
  // decks carried on along their approaches (carryOnApproaches), kept over re-collects
  const carryOns = [];
  const collect = () => {
    tunnelEnds.length = 0;
    const parts = [];
    const partSeg = [];
    const lowerRoads = [];
    drivableRoads.forEach((seg, segIndex) => {
      const tags = seg.sourceFeature?.tags || {};
      if (!shouldGenerateDecalRoads(seg.highway, tags) || !Array.isArray(seg.geometry) || seg.geometry.length < 2) return;
      const xy = toXY(seg.geometry);
      const layer = getEffectiveRoadLayer(tags);
      if (isBridgeRoad(tags)) {
        // the drawn half width is known only later; this estimate shapes the
        // ground at the abutments (gradeAbutments)
        const cs = estimateRoadCrossSection(tags, seg.highway, isOneWayRoad(tags), {
          fallbackHalfWidth: (HIGHWAY_STYLE[seg.highway] ?? DEFAULT_ROAD_STYLE).width,
        });
        const half = cs.drivingHalfWidth + (cs.leftExtra + cs.rightExtra) / 2;
        parts.push({
          xy: xy.map(([x, y]) => [x, y]), half, layer: Math.max(1, layer), structure: structureOf(tags, xy),
          osm: { id: seg.sourceFeature?.id ?? null, name: tags.name || tags.ref || null, highway: seg.highway },
        });
        partSeg.push(segIndex);
      } else if (isBoredTunnelTag(tags)) {
        // underground: nothing for a deck to clear, no ground to fit to
        tunnelEnds.push(xy[0], xy[xy.length - 1]);
      } else {
        lowerRoads.push({
          segIndex,
          layer: Math.min(layer, 0),
          xy: xy.map(([x, y]) => [x, y, groundAt(x, y)]),
          half: (HIGHWAY_STYLE[seg.highway] ?? DEFAULT_ROAD_STYLE).width ?? 4,
          major: MAJOR_UNDER_ROADS.has(seg.highway),
          junctions: junctionsOf(seg),
          highway: seg.highway,
        });
      }
    });
    // carried-on approaches are deck parts of no bridge segment of their own
    for (const ext of landOnBerms(parts, lowerRoads, groundAt)) {
      parts.push(ext);
      partSeg.push(-1);
    }
    for (const ext of carryOnApproaches(parts, lowerRoads, carryOns, groundAt)) {
      parts.push(ext);
      partSeg.push(-1);
    }
    return { parts, partSeg, lowerRoads };
  };
  let { parts, partSeg, lowerRoads } = collect();
  const bySeg = new Map();
  if (!parts.length) return { bySeg, approaches: new Map(), decks: [], roadLines: [] };
  // Overpasses baked into the elevation: the roads under them would climb
  // over the deck's hump into it. Taken out first, so the roads (and the
  // decks' clearance over them) see the ground under the bridge.
  const humps = cutBridgeHumps(terrainData, squareSize, parts, lowerRoads, groundAt);
  if (humps.length > 0) ({ parts, partSeg, lowerRoads } = collect());
  // An abutment meets its approach road at the height the road arrives at:
  // the ground along the approach, fitted and carried on to the bridge's end.
  // Never the ground at the end itself: bare-earth (lidar) elevation has the
  // bridge taken out, so the approach embankment ends in a cliff, and the
  // OSM end of a bridge often lands at its foot (a deck starting metres
  // below the road coming onto it).
  const endHeight = (x, y) => {
    const fits = [];
    for (const r of lowerRoads) {
      const a = r.xy[0]; const b = r.xy[r.xy.length - 1];
      const line = Math.hypot(a[0] - x, a[1] - y) < 1.5 ? r.xy : Math.hypot(b[0] - x, b[1] - y) < 1.5 ? [...r.xy].reverse() : null;
      if (!line) continue;
      const samples = [];
      let s0 = 0;
      for (let i = 0; i + 1 < line.length && s0 < APPROACH_FIT_M[1]; i++) {
        const L = Math.hypot(line[i + 1][0] - line[i][0], line[i + 1][1] - line[i][1]);
        for (let s = Math.ceil(Math.max(s0, APPROACH_FIT_M[0]) / 2) * 2; s <= Math.min(s0 + L, APPROACH_FIT_M[1]); s += 2) {
          const t = (s - s0) / (L || 1);
          samples.push([s, groundAt(line[i][0] + (line[i + 1][0] - line[i][0]) * t, line[i][1] + (line[i + 1][1] - line[i][1]) * t)]);
        }
        s0 += L;
      }
      if (samples.length < 4) continue;
      // Theil-Sen: a stretch of the approach still in the bridge's gap
      // does not drag the fit down
      const slopes = [];
      for (let i = 0; i < samples.length; i++) {
        for (let j = i + 1; j < samples.length; j++) slopes.push((samples[j][1] - samples[i][1]) / (samples[j][0] - samples[i][0]));
      }
      const median = (v) => { const q = [...v].sort((m, n) => m - n); return q[q.length >> 1]; };
      const slope = Math.max(-APPROACH_MAX_GRADE, Math.min(APPROACH_MAX_GRADE, median(slopes)));
      fits.push(median(samples.map(([d, z]) => z - slope * d)));
    }
    return fits.length ? Math.max(...fits) : groundAt(x, y);
  };
  let decks = solveBridgeDecks(parts, { groundAt, endHeight, wetAt, lowerRoads, isFreeEnd, isAbutment: groundRoadStarts(lowerRoads, isFreeEnd) });

  // Embankments for the decks that fall short.
  const ramps = [];
  for (const deck of decks) {
    if (!(deck.shortfall > 0.3)) continue;
    for (const [ax, ay] of deck.abutments) {
      const near = lowerRoads.filter((r) => {
        const a = r.xy[0];
        const b = r.xy[r.xy.length - 1];
        return Math.hypot(a[0] - ax, a[1] - ay) < 1.5 || Math.hypot(b[0] - ax, b[1] - ay) < 1.5;
      });
      if (near.length !== 1) continue;   // a junction at the abutment: no ramp
      // The approach: this road and on through plain continuations (one road
      // in, one out) until there is room for the highest ramp, or a junction.
      const want = rampLength(liftFor(deck.shortfall, Infinity)) + 10;
      const line = [];
      let road = near[0];
      let from = [ax, ay];
      const used = new Set();
      let available = 0;
      while (road && available < want) {
        used.add(road);
        const piece = Math.hypot(road.xy[0][0] - from[0], road.xy[0][1] - from[1]) < 1.5 ? road.xy : [...road.xy].reverse();
        for (let i = line.length ? 1 : 0; i < piece.length; i++) {
          if (line.length) available += Math.hypot(piece[i][0] - line[line.length - 1][0], piece[i][1] - line[line.length - 1][1]);
          line.push(piece[i]);
        }
        from = piece[piece.length - 1];
        const next = lowerRoads.filter((r) => !used.has(r) && (
          Math.hypot(r.xy[0][0] - from[0], r.xy[0][1] - from[1]) < 1.5
          || Math.hypot(r.xy[r.xy.length - 1][0] - from[0], r.xy[r.xy.length - 1][1] - from[1]) < 1.5));
        road = next.length === 1 ? next[0] : null;
      }
      const lift = liftFor(deck.shortfall, available);
      if (lift < 0.5) continue;
      // The ramp follows the real ground (OSM vertices can be far apart).
      const dense = resample(line.map(([x, y]) => [x, y]), 4).map(([x, y]) => [x, y, groundAt(x, y)]);
      const dl = Math.hypot(dense[1][0] - dense[0][0], dense[1][1] - dense[0][1]) || 1;
      // Every other road keeps its ground, and so does the ground under the
      // bridges; this deck's own only on its side of the abutment (an
      // abutment wall), so the approach comes up to meet it.
      const own = new Set(deck.parts.map((p) => p.index));
      const protect = [
        ...lowerRoads.filter((r) => !used.has(r)).map((r) => ({ xy: r.xy, half: r.half })),
        ...parts.map((p, pi) => ({ xy: p.xy, half: p.half, own: own.has(pi) })),
      ];
      ramps.push({
        line: dense, lift, length: rampLength(lift), half: near[0].half, protect,
        abutment: [ax, ay], dir: [(dense[1][0] - dense[0][0]) / dl, (dense[1][1] - dense[0][1]) / dl],
      });
    }
  }
  const built = ramps.length > 0 ? raiseApproachEmbankments(terrainData, squareSize, ramps) : 0;
  if (built > 0) {
    ({ parts, partSeg, lowerRoads } = collect());
    decks = solveBridgeDecks(parts, { groundAt, endHeight, wetAt, lowerRoads, isFreeEnd, isAbutment: groundRoadStarts(lowerRoads, isFreeEnd) });
  }
  // Still short: carried on along the approaches, far enough to climb it.
  // A few rounds: a deck carried higher asks more of the one over it.
  for (let round = 0; round < CARRY_ROUNDS; round++) {
    const before = carryOns.length;
    for (const deck of decks) {
      // over roads only: a deck low over water blocks nothing
      if (!(deck.roadShortfall > CARRY_MIN_SHORTFALL_M)) continue;
      const length = Math.min(CARRY_MAX_M, (deck.roadShortfall + 0.5) / DECK_MAX_GRADE);
      for (const [x, y] of deck.abutments) {
        if (!isFreeEnd(x, y) && !carryOns.some((c) => Math.hypot(c.x - x, c.y - y) < 1.5)) carryOns.push({ x, y, length });
      }
    }
    if (carryOns.length === before) break;
    ({ parts, partSeg, lowerRoads } = collect());
    decks = solveBridgeDecks(parts, { groundAt, endHeight, wetAt, lowerRoads, isFreeEnd, isAbutment: groundRoadStarts(lowerRoads, isFreeEnd) });
  }
  // Still short over a road: that road sinks into a cutting under the deck
  // (downtown freeways run below the streets crossing them; the elevation
  // shows them at street level, and a street with junctions either side of
  // its bridge has no room to climb: North 7th Street over I-10, Phoenix)
  const sinks = [];
  for (const deck of decks) {
    if (!(deck.roadShortfall > SINK_MIN_M)) continue;
    for (const part of deck.parts) {
      for (const road of lowerRoads) {
        for (const [px, py] of planCrossingPoints(part.xy, road.xy)) {
          // an approach meeting the deck's end only touches it; a minor road
          // met right by an abutment is a junction at grade (the solver's rule)
          const at = (p) => Math.hypot(p[0] - px, p[1] - py) < 1.5;
          if ((at(part.xy[0]) || at(part.xy[part.xy.length - 1])) && (at(road.xy[0]) || at(road.xy[road.xy.length - 1]))) continue;
          const through = !road.junctions.some(([jx, jy]) => Math.hypot(jx - px, jy - py) < AT_GRADE_REACH_M + 3);
          if (!road.major && !through && deck.abutments.some(([ax, ay]) => Math.hypot(ax - px, ay - py) < AT_GRADE_REACH_M)) continue;
          const deficit = groundAt(px, py) + DECK_ROAD_CLEAR_M - deckHeightAt(part, px, py);
          if (deficit > SINK_MIN_M / 2) sinks.push({ road, at: [px, py], deficit: Math.min(SINK_MAX_M, deficit + 0.2) });
        }
      }
    }
  }
  const sunkAt = sinks.length ? sinkRoadsUnderDecks(terrainData, squareSize, sinks, lowerRoads, tunnels) : [];
  const sunk = sunkAt.length;
  if (sunk > 0) {
    ({ parts, partSeg, lowerRoads } = collect());
    decks = solveBridgeDecks(parts, { groundAt, endHeight, wetAt, lowerRoads, isFreeEnd, isAbutment: groundRoadStarts(lowerRoads, isFreeEnd) });
  }
  gradeAbutments(terrainData, squareSize, decks);
  for (const deck of decks) for (const part of deck.parts) if (partSeg[part.index] >= 0) bySeg.set(partSeg[part.index], part);
  // approach roads a deck was carried on over (their road is drawn on it there)
  const approaches = new Map();
  for (const deck of decks) {
    for (const part of deck.parts) {
      for (const seg of parts[part.index].landedOn || []) approaches.set(seg, part);
    }
  }
  return {
    bySeg, approaches, decks, roadLines: lowerRoads.map((r) => r.xy), ramps: built, humps, sunk, sunkAt,
    carried: parts.filter((p) => p.carried).length,
    // for the export report: each part's OSM way (carried-on approaches have none)
    partInfo: parts.map((p, i) => ({ ...(p.osm || { id: null, name: null, highway: null }), structure: p.structure ?? null, landing: partSeg[i] < 0 && !p.carried, carried: !!p.carried })),
    endHeight,
  };
}

// Overpasses in the elevation data. Bare-earth models are meant to have the
// bridges taken out, but many (USGS 3DEP-derived 30 m Terrarium among them)
// keep an overpass as a ridge across the road under it: I-65 under SR 114,
// Indiana, rises 6.5 m over 40 m into the deck. Where a ground road crosses
// under a bridge, the ground along the deck's normal is checked against the
// line between the ground HUMP_SIDE_M either side of the deck; standing over
// it by more than HUMP_MIN_M, the strip under the deck around the crossing
// roads is lowered to that line (never raised), fading out along the deck.
// The crossing road's own ground either side of the deck must agree: a road
// on an embankment over low ground also stands over the line across the deck,
// but its embankment runs on along the road (Jacksonville's I-295 loops: 4 m
// pits dug under the flyovers), where a baked-in deck drops away both ways.
const HUMP_SIDE_M = [30, 45];   // ground this far either side of the deck: the real ground
const HUMP_ALONG_M = [25, 45];  // ... and this far along the crossing road, either side
const HUMP_MIN_M = 1.5;         // a ridge over the line by this much is the bridge
const HUMP_MARGIN_M = 6;        // cut beyond a crossing road's edge (shoulders) ...
const HUMP_FADE_M = 10;         // ... then faded back to the ground along the deck
const HUMP_END_M = 15;          // no cut this near a deck part's end (its approach fill)

/**
 * Lower the baked-in overpass ridges under the bridge parts where ground
 * roads (lowerRoads) cross them. Returns [{ x, y, lift }] per crossing cut
 * (lift: metres the ground stood over the line at the crossing).
 */
function cutBridgeHumps(terrainData, squareSize, parts, lowerRoads, groundAt) {
  const { width, height, minHeight } = terrainData;
  const worldSize = width * squareSize;
  const toPixel = (x, y) => [(x / worldSize + 0.5) * (width - 1), (0.5 - y / worldSize) * (height - 1)];
  const toWorld = (c, r) => [((c / (width - 1)) - 0.5) * worldSize, (0.5 - r / (height - 1)) * worldSize];
  const median = (v) => { const q = [...v].sort((m, n) => m - n); return q[q.length >> 1]; };
  // the line through the real ground either side of the deck at (x, y),
  // deck normal n: its height at offset d along n
  const lineAcross = (x, y, nx, ny) => {
    const side = (sign) => {
      const v = [];
      for (let d = HUMP_SIDE_M[0]; d <= HUMP_SIDE_M[1]; d += 2) v.push(groundAt(x + sign * nx * d, y + sign * ny * d));
      return median(v);
    };
    const a = side(-1); const b = side(1);
    const mid = (HUMP_SIDE_M[0] + HUMP_SIDE_M[1]) / 2;
    return (d) => a + (b - a) * (d + mid) / (2 * mid);
  };
  // the crossing road's ground HUMP_ALONG_M either way from where it meets
  // the deck (segment j at u): its height at the crossing, or null when the
  // road is too short either side to tell
  const lineAlong = (q, j, u) => {
    const side = (sign) => {
      const v = [];
      let k = sign > 0 ? j + 1 : j;
      let [px, py] = [q[j][0] + (q[j + 1][0] - q[j][0]) * u, q[j][1] + (q[j + 1][1] - q[j][1]) * u];
      let walked = 0;
      for (let d = HUMP_ALONG_M[0]; d <= HUMP_ALONG_M[1]; d += 2) {
        while (k >= 0 && k < q.length) {
          const L = Math.hypot(q[k][0] - px, q[k][1] - py);
          if (walked + L >= d) {
            const t = (d - walked) / (L || 1);
            v.push(groundAt(px + (q[k][0] - px) * t, py + (q[k][1] - py) * t));
            break;
          }
          walked += L; [px, py] = q[k]; k += sign;
        }
      }
      return v.length >= 3 ? median(v) : null;
    };
    const a = side(-1); const b = side(1);
    if (a == null && b == null) return null;
    return (a ?? b) / 2 + (b ?? a) / 2;
  };
  const hm = heightMapEditor(terrainData);
  const cuts = [];
  for (const part of parts) {
    const xy = part.xy;
    const s = [0];
    for (let i = 1; i < xy.length; i++) s.push(s[i - 1] + Math.hypot(xy[i][0] - xy[i - 1][0], xy[i][1] - xy[i - 1][1]));
    // crossings: deck station, the crossing road's half width
    const crossings = [];
    for (const road of lowerRoads) {
      if ((road.layer ?? 0) >= (part.layer ?? 1)) continue;
      const q = road.xy;
      for (let i = 0; i + 1 < xy.length; i++) {
        const [ax, ay] = xy[i]; const [bx, by] = xy[i + 1];
        for (let j = 0; j + 1 < q.length; j++) {
          const [cx, cy] = q[j]; const [dx, dy] = q[j + 1];
          const den = (bx - ax) * (dy - cy) - (by - ay) * (dx - cx);
          if (Math.abs(den) < 1e-9) continue;
          const t = ((cx - ax) * (dy - cy) - (cy - ay) * (dx - cx)) / den;
          const u = ((cx - ax) * (by - ay) - (cy - ay) * (bx - ax)) / den;
          if (t < 0 || t > 1 || u < 0 || u > 1) continue;
          const x = ax + (bx - ax) * t; const y = ay + (by - ay) * t;
          // an approach road starting at the deck's end only touches it
          const near = (p) => Math.hypot(p[0] - x, p[1] - y) < 1;
          if ((near(xy[0]) || near(xy[xy.length - 1])) && (near(q[0]) || near(q[q.length - 1]))) continue;
          const L = Math.hypot(bx - ax, by - ay) || 1;
          const nx = -(by - ay) / L; const ny = (bx - ax) / L;
          const along = lineAlong(q, j, u);
          const lift = groundAt(x, y) - Math.max(lineAcross(x, y, nx, ny)(0), along ?? -Infinity);
          // (by the deck's end the rise is its own approach embankment)
          const sAt = s[i] + t * L;
          if (sAt < HUMP_END_M || sAt > s[s.length - 1] - HUMP_END_M) continue;
          if (lift > HUMP_MIN_M) crossings.push({ s: sAt, x, y, half: road.half, lift });
        }
      }
    }
    if (!crossings.length) continue;
    // the deck stations to cut (crossings merged), with the fade
    const spans = crossings
      .map((c) => [c.s - c.half - HUMP_MARGIN_M, c.s + c.half + HUMP_MARGIN_M])
      .sort((a, b) => a[0] - b[0])
      .reduce((out, sp) => {
        const last = out[out.length - 1];
        if (last && sp[0] <= last[1] + HUMP_FADE_M) last[1] = Math.max(last[1], sp[1]);
        else out.push([...sp]);
        return out;
      }, []);
    const weightAt = (st) => {
      let w = 0;
      for (const [a, b] of spans) {
        if (st >= a && st <= b) return 1;
        const off = st < a ? a - st : st - b;
        w = Math.max(w, 1 - off / HUMP_FADE_M);
      }
      return Math.max(0, w);
    };
    const reach = HUMP_SIDE_M[0];
    const xs = xy.map((p) => p[0]); const ys = xy.map((p) => p[1]);
    const [c0, r1] = toPixel(Math.min(...xs) - reach, Math.min(...ys) - reach);
    const [c1, r0] = toPixel(Math.max(...xs) + reach, Math.max(...ys) + reach);
    const lines = new Map();   // per deck segment and station step: the line across
    for (let r = Math.max(0, Math.floor(r0)); r <= Math.min(height - 1, Math.ceil(r1)); r++) {
      for (let c = Math.max(0, Math.floor(c0)); c <= Math.min(width - 1, Math.ceil(c1)); c++) {
        const [x, y] = toWorld(c, r);
        let best = Infinity; let st = 0; let d = 0; let seg = 0; let foot = null;
        for (let i = 0; i + 1 < xy.length; i++) {
          const vx = xy[i + 1][0] - xy[i][0]; const vy = xy[i + 1][1] - xy[i][1];
          const L2 = vx * vx + vy * vy || 1e-9;
          const t = Math.max(0, Math.min(1, ((x - xy[i][0]) * vx + (y - xy[i][1]) * vy) / L2));
          const px = xy[i][0] + vx * t; const py = xy[i][1] + vy * t;
          const dist = Math.hypot(px - x, py - y);
          if (dist < best) {
            best = dist; st = s[i] + t * (s[i + 1] - s[i]); seg = i; foot = [px, py];
            const L = Math.sqrt(L2);
            d = ((x - px) * -vy + (y - py) * vx) / L;
          }
        }
        if (best >= reach) continue;
        const w = weightAt(st);
        if (w <= 0) continue;
        const L = Math.hypot(xy[seg + 1][0] - xy[seg][0], xy[seg + 1][1] - xy[seg][1]) || 1;
        const nx = -(xy[seg + 1][1] - xy[seg][1]) / L; const ny = (xy[seg + 1][0] - xy[seg][0]) / L;
        // the line across, per metre of station (shared by the pixels there)
        const key = `${seg}:${Math.round(st)}`;
        if (!lines.has(key)) lines.set(key, lineAcross(foot[0], foot[1], nx, ny));
        const idx = r * width + c;
        const now = hm.at(idx) - minHeight;
        const target = lines.get(key)(d);
        if (target >= now) continue;
        // faded out across the last HUMP_FADE_M before the ground it is
        // measured against (a hard edge there was a step in the road under)
        // (by the true distance: past the deck's end the offset across it
        // is not the distance, and the cut stopped at a ring round the end)
        const wa = Math.min(1, Math.max(0, (reach - best) / HUMP_FADE_M));
        hm.set(idx, now - (now - target) * w * wa + minHeight);
      }
    }
    for (const c of crossings) cuts.push({ x: c.x, y: c.y, lift: c.lift });
  }
  return cuts;
}

// The ground at each abutment meets the deck: the approach is graded to the
// deck end's height (flat for ABUT_FLAT_M, then blending back to the ground by
// ABUT_PAD_M), and the ground under the deck's first UNDER_DECK_M is lowered
// wherever it would show through it. Without this a bridge started with a
// step up or down, and the ground poked through low decks near their ends.
const ABUT_FLAT_M = 3;
const ABUT_PAD_M = 12;
const ABUT_SIDE_M = 4;          // lateral feather beyond the deck's edge
const ABUT_MAX_SHIFT_M = 1.5;   // the pad never moves the ground further than this
const UNDER_DECK_M = 30;
const UNDER_DECK_CLEAR_M = 0.15;
const UNDER_DECK_MAX_CUT_M = 2;  // a deck further under the ground than this is left to it

/** Distance from (x, y) to a polyline [[x, y]...]. */
function distanceToLine(xy, x, y) {
  let best = Infinity;
  for (let i = 0; i + 1 < xy.length; i++) {
    const vx = xy[i + 1][0] - xy[i][0]; const vy = xy[i + 1][1] - xy[i][1];
    const L2 = vx * vx + vy * vy || 1e-9;
    const t = Math.max(0, Math.min(1, ((x - xy[i][0]) * vx + (y - xy[i][1]) * vy) / L2));
    best = Math.min(best, Math.hypot(xy[i][0] + vx * t - x, xy[i][1] + vy * t - y));
  }
  return best;
}

// Bridge grading edits the export's own copy of the heightmap (the app's
// terrain is shared): one copy per export, made at the first changed pixel. A
// 16384² grid is 1 GiB, and a copy per pass plus a full-grid weight buffer ran
// the tab out of memory. `ground` is a pixel's height before this pass.
const exportHeightMaps = new WeakSet();
function heightMapEditor(terrainData) {
  const before = new Map();
  return {
    at: (idx) => terrainData.heightMap[idx],
    ground: (idx) => (before.has(idx) ? before.get(idx) : terrainData.heightMap[idx]),
    set(idx, value) {
      if (!exportHeightMaps.has(terrainData.heightMap)) {
        terrainData.heightMap = terrainData.heightMap.slice();
        exportHeightMaps.add(terrainData.heightMap);
      }
      if (!before.has(idx)) before.set(idx, terrainData.heightMap[idx]);
      terrainData.heightMap[idx] = value;
    },
  };
}

/**
 * Shape the ground at every abutment of the solved decks (replaces
 * terrainData.heightMap with a graded copy; the app's own terrain is shared).
 */
export function gradeAbutments(terrainData, squareSize, decks) {
  const { width, height, minHeight } = terrainData;
  const maxHeight = Number.isFinite(terrainData.maxHeight) ? terrainData.maxHeight : Infinity;
  const hm = heightMapEditor(terrainData);
  const worldSize = width * squareSize;
  const toPixel = (x, y) => [(x / worldSize + 0.5) * (width - 1), (0.5 - y / worldSize) * (height - 1)];
  const toWorld = (c, r) => [((c / (width - 1)) - 0.5) * worldSize, (0.5 - r / (height - 1)) * worldSize];
  const smooth = (t) => t * t * (3 - 2 * t);
  const ends = [];
  for (const deck of decks) {
    for (const part of deck.parts) {
      const { xy, z } = part;
      if (xy.length < 2) continue;
      for (const end of [0, xy.length - 1]) {
        const [ex, ey] = xy[end];
        if (!deck.abutments.some(([ax, ay]) => Math.hypot(ax - ex, ay - ey) < 1)) continue;
        const inner = xy[end === 0 ? 1 : xy.length - 2];
        const len = Math.hypot(ex - inner[0], ey - inner[1]) || 1;
        // deck height going back into the bridge from this end
        const order = end === 0 ? xy.map((_, i) => i) : xy.map((_, i) => xy.length - 1 - i);
        const s = [0];
        for (let k = 1; k < order.length; k++) s.push(s[k - 1] + Math.hypot(xy[order[k]][0] - xy[order[k - 1]][0], xy[order[k]][1] - xy[order[k - 1]][1]));
        const deckZBack = (d) => {
          let k = 0;
          while (k < s.length - 2 && s[k + 1] < d) k++;
          const f = Math.min(1, Math.max(0, (d - s[k]) / Math.max(1e-9, s[k + 1] - s[k])));
          return z[order[k]] + (z[order[k + 1]] - z[order[k]]) * f;
        };
        ends.push({
          ex, ey, u: [(ex - inner[0]) / len, (ey - inner[1]) / len],   // out of the bridge, onto the approach
          // graded one grid square past the slab's edge (the terrain between
          // grid points blends to its neighbours)
          zEnd: z[end], slab: part.half + PARAPET_W_M, half: part.half + PARAPET_W_M + squareSize, deckZBack,
        });
      }
    }
  }
  // each end's pixels: (c, r, x, y, along (> 0 on the approach), across)
  const eachPixel = (e, fn) => {
    const reach = Math.max(ABUT_PAD_M, UNDER_DECK_M) + e.half + ABUT_SIDE_M;
    const [c0, r1] = toPixel(e.ex - reach, e.ey - reach);
    const [c1, r0] = toPixel(e.ex + reach, e.ey + reach);
    for (let r = Math.max(0, Math.floor(r0)); r <= Math.min(height - 1, Math.ceil(r1)); r++) {
      for (let c = Math.max(0, Math.floor(c0)); c <= Math.min(width - 1, Math.ceil(c1)); c++) {
        const [x, y] = toWorld(c, r);
        fn(r * width + c, (x - e.ex) * e.u[0] + (y - e.ey) * e.u[1], Math.abs(-(x - e.ex) * e.u[1] + (y - e.ey) * e.u[0]));
      }
    }
  };
  // 1. approach pads; where two overlap (twin decks, a ramp beside the main
  // line) a deck's own width beats the other's margin, else the stronger claim
  const weight = new Map();
  let touched = 0;
  for (const e of ends) {
    eachPixel(e, (idx, a, l) => {
      if (a < 0 && a >= -squareSize && l <= e.half) {
        // the abutment: the first grid square under the deck filled up to it,
        // or the road dips on its way to the slab
        const claim = l <= e.slab ? 2 : 1;
        if (claim <= (weight.get(idx) ?? 0)) return;
        weight.set(idx, claim);
        hm.set(idx, Math.min(e.deckZBack(-a) - 0.05 + minHeight, maxHeight));
        touched++;
        return;
      }
      if (a < 0 || a > ABUT_PAD_M || l > e.half + ABUT_SIDE_M) return;
      const along = a <= ABUT_FLAT_M ? 1 : smooth(1 - (a - ABUT_FLAT_M) / (ABUT_PAD_M - ABUT_FLAT_M));
      const across = l <= e.half ? 1 : smooth(1 - (l - e.half) / ABUT_SIDE_M);
      const t = along * across;
      const claim = t + (l <= e.slab && a <= ABUT_FLAT_M ? 1 : 0);
      if (claim <= (weight.get(idx) ?? 0)) return;
      weight.set(idx, claim);
      const ground = hm.ground(idx);
      const shift = Math.max(-ABUT_MAX_SHIFT_M, Math.min(ABUT_MAX_SHIFT_M, e.zEnd + minHeight - ground));
      hm.set(idx, Math.min(ground + shift * t, maxHeight));
      touched++;
    });
  }
  // 2. under every deck's first UNDER_DECK_M, below its top: just under it at
  // the very end (no lip where the road meets it), the full clearance a few
  // metres in
  for (const e of ends) {
    eachPixel(e, (idx, a, l) => {
      if (a >= 0 || -a > UNDER_DECK_M || l > e.half) return;
      const cap = e.deckZBack(-a) - UNDER_DECK_CLEAR_M * Math.min(1, 0.1 - a / 3) + minHeight;
      const z = hm.at(idx);
      if (z > cap && z - cap <= UNDER_DECK_MAX_CUT_M) { hm.set(idx, cap); touched++; }
    });
  }
  return touched;
}

/**
 * Raise the terrain along approach roads into ramps up to their bridge
 * abutments: [{ line: [[x, y, z]...] from the abutment out, lift, length, half,
 * protect: [{ xy, half }] }]. Flat across the road and a shoulder, then 1:2
 * side slopes down to the ground; only ever raises, and never raises another
 * road (protect): within its width the ground stays, beyond it the embankment
 * may rise only at the side slope. Replaces terrainData.heightMap with a copy.
 */
function raiseApproachEmbankments(terrainData, squareSize, ramps) {
  const { width, height, minHeight } = terrainData;
  const maxHeight = Number.isFinite(terrainData.maxHeight) ? terrainData.maxHeight : Infinity;
  const hm = heightMapEditor(terrainData);
  const worldSize = width * squareSize;
  const toPixel = (x, y) => [(x / worldSize + 0.5) * (width - 1), (0.5 - y / worldSize) * (height - 1)];
  const toWorld = (c, r) => [((c / (width - 1)) - 0.5) * worldSize, (0.5 - r / (height - 1)) * worldSize];
  // One ramp: false (and nothing raised) when it would have to hold back for
  // another road or bridge anywhere: all or nothing, never a ridge or a step.
  const apply = (ramp, write) => {
    const flat = ramp.half + RAMP_SHOULDER_M;
    const reach = flat + ramp.lift / RAMP_SIDE_SLOPE;
    // the line up to the ramp's length, with arc lengths
    const pts = [ramp.line[0]];
    const s = [0];
    for (let i = 1; i < ramp.line.length && s[s.length - 1] < ramp.length; i++) {
      pts.push(ramp.line[i]);
      s.push(s[s.length - 1] + Math.hypot(ramp.line[i][0] - ramp.line[i - 1][0], ramp.line[i][1] - ramp.line[i - 1][1]));
    }
    if (pts.length < 2) return false;
    const xs = pts.map((p) => p[0]); const ys = pts.map((p) => p[1]);
    const box = [Math.min(...xs) - reach, Math.min(...ys) - reach, Math.max(...xs) + reach, Math.max(...ys) + reach];
    const [c0, r1] = toPixel(box[0], box[1]);
    const [c1, r0] = toPixel(box[2], box[3]);
    const protect = (ramp.protect || []).filter(({ xy }) => xy.some(([x, y]) => x >= box[0] - 50 && x <= box[2] + 50 && y >= box[1] - 50 && y <= box[3] + 50));
    // room (m) beyond the nearest protected road's shoulder, or Infinity
    const roomAt = (x, y) => {
      let room = Infinity;
      const approachSide = (x - ramp.abutment[0]) * ramp.dir[0] + (y - ramp.abutment[1]) * ramp.dir[1] >= -0.5;
      for (const { xy, half, own } of protect) {
        if (own && approachSide) continue;
        for (let i = 0; i + 1 < xy.length; i++) {
          const vx = xy[i + 1][0] - xy[i][0]; const vy = xy[i + 1][1] - xy[i][1];
          const L2 = vx * vx + vy * vy || 1e-9;
          const t = Math.max(0, Math.min(1, ((x - xy[i][0]) * vx + (y - xy[i][1]) * vy) / L2));
          room = Math.min(room, Math.hypot(xy[i][0] + vx * t - x, xy[i][1] + vy * t - y) - half - RAMP_SHOULDER_M);
        }
      }
      return room;
    };
    for (let r = Math.max(0, Math.floor(r0)); r <= Math.min(height - 1, Math.ceil(r1)); r++) {
      for (let c = Math.max(0, Math.floor(c0)); c <= Math.min(width - 1, Math.ceil(c1)); c++) {
        const [x, y] = toWorld(c, r);
        let best = Infinity;
        let along = 0;
        let roadZ = 0;
        for (let i = 0; i + 1 < pts.length; i++) {
          const vx = pts[i + 1][0] - pts[i][0]; const vy = pts[i + 1][1] - pts[i][1];
          const L2 = vx * vx + vy * vy || 1e-9;
          const t = Math.max(0, Math.min(1, ((x - pts[i][0]) * vx + (y - pts[i][1]) * vy) / L2));
          const d = Math.hypot(pts[i][0] + vx * t - x, pts[i][1] + vy * t - y);
          if (d < best) {
            best = d;
            along = s[i] + t * (s[i + 1] - s[i]);
            roadZ = pts[i][2] + t * (pts[i + 1][2] - pts[i][2]);
          }
        }
        if (best > reach || along >= ramp.length) continue;
        // only on the approach's side of the abutment: under the deck the
        // ground is gradeAbutments' (a ramp's round end there reached the
        // road crossing under the bridge, and the whole ramp was refused)
        if ((x - ramp.abutment[0]) * ramp.dir[0] + (y - ramp.abutment[1]) * ramp.dir[1] < -0.5) continue;
        const top = roadZ + rampLift(along, ramp.lift, ramp.length);
        let target = (best <= flat ? top : top - (best - flat) * RAMP_SIDE_SLOPE) + minHeight;
        const idx = r * width + c;
        if (target <= hm.at(idx)) continue;
        const ground = hm.ground(idx);
        const room = roomAt(x, y);
        if (room < 0 || ground + room * RAMP_SIDE_SLOPE < target) {
          if (target - ground > 0.05) return false;
          continue;
        }
        if (write) hm.set(idx, Math.min(target, maxHeight));
      }
    }
    return true;
  };
  let built = 0;
  for (const ramp of ramps) {
    if (apply(ramp, false)) { apply(ramp, true); built++; }
  }
  return built;
}

const TUNNEL_APPROACH_M = 300;   // how far an approach road is followed out from a portal (a cut-and-cover trench)
const TUNNEL_TOUCH_M = 1.5;      // a road ending this close to a tunnel's end continues it
const TUNNEL_ROCK_M = 0.3;       // a bridge this far under the ground is still in the tunnel ...
const TUNNEL_ROCK_REACH_M = 60;  // ... looked for this far along it
const pathLength = (xy) => xy.reduce((n, p, i) => (i ? n + Math.hypot(p[0] - xy[i - 1][0], p[1] - xy[i - 1][1]) : 0), 0);

/**
 * Road tunnels (services/beamngTunnels.js) for the drawn tunnel=yes roads:
 * chains them into paths, solves each under the ground, grades the cuttings,
 * headwall backfill and any made-up cover into the export's own heightmap
 * copy, and lists the terrain squares that open at the portals (layer-map
 * indices, terrain space: 0,0 = SW). halfOf(seg) is the drawn carriageway's
 * half width. Bridges are solved first: a bridge meeting a portal sets its
 * height (and gets no cutting).
 */
function solveExportTunnels(drivableRoads, terrainData, squareSize, bridges, halfOf, { done = new Set() } = {}) {
  const out = { bySeg: new Map(), tunnels: [], skipped: [], holes: [] };
  // before the bridges are solved (bridges null): a tunnel meeting a bridge
  // road waits for them
  const early = !bridges;
  const toXY = (geometry) => geometry.map((p) => geoToWorldPoint(p.lat, p.lng, terrainData, squareSize, 0));
  const groundAt = (x, y) => getTerrainHeightAtWorldXY(x, y, terrainData, squareSize);
  const edge = (terrainData.width * squareSize) / 2 - 3;
  const isFreeEnd = (x, y) => Math.abs(x) >= edge || Math.abs(y) >= edge;
  const parts = [];
  const others = [];
  drivableRoads.forEach((seg, segIndex) => {
    const tags = seg.sourceFeature?.tags || {};
    if (!shouldGenerateDecalRoads(seg.highway, tags) || !Array.isArray(seg.geometry) || seg.geometry.length < 2) return;
    const xy = toXY(seg.geometry);
    if (isBoredTunnelTag(tags) && !isBridgeRoad(tags)) {
      parts.push({
        xy, segIndex, half: halfOf(seg), gallery: isGalleryTag(tags),
        osm: { id: seg.sourceFeature?.id ?? null, name: tags['tunnel:name'] || tags.name || tags.ref || null, highway: seg.highway },
      });
    } else {
      others.push({ xy, segIndex, bridge: bridges?.bySeg.get(segIndex) || null, bridgeRoad: isBridgeRoad(tags) });
    }
  });
  if (!parts.length) return out;
  // galleries and tunnels chained apart (a gallery runs on into a tunnel's mouth)
  const paths = []; const branched = []; const trees = [];
  for (const kind of [false, true]) {
    const subset = parts.map((p, i) => i).filter((i) => parts[i].gallery === kind);
    if (!subset.length) continue;
    const res = chainTunnelParts(subset.map((i) => parts[i]));
    const remap = (path) => ({ ...path, idx: path.idx.map((k) => subset[k]) });
    paths.push(...res.paths.map(remap));
    branched.push(...res.branched.map((group) => group.map((k) => subset[k])));
    trees.push(...res.trees.map((tr) => ({ main: remap(tr.main), branches: tr.branches.map(remap) })));
  }
  for (const group of early ? branched : []) {
    out.skipped.push({ osm: group.map((i) => parts[i].osm), reason: 'branches inside the tunnel (a loop, or ramps off ramps)', length: group.reduce((n, i) => n + pathLength(parts[i].xy), 0) });
  }
  // The road a tunnel end runs on into, followed outwards: the one most in
  // line with the tunnel when several meet there; a bridge gives its deck
  // height instead.
  const approachAt = (end, dir) => {
    const near = (p) => Math.hypot(p[0] - end[0], p[1] - end[1]) < TUNNEL_TOUCH_M;
    let best = null;
    for (const r of others) {
      const a = r.xy[0]; const b = r.xy[r.xy.length - 1];
      const line = near(a) ? r.xy : near(b) ? [...r.xy].reverse() : null;
      if (!line || line.length < 2) continue;
      const k = Math.min(line.length - 1, 3);
      const L = Math.hypot(line[k][0] - line[0][0], line[k][1] - line[0][1]) || 1;
      const align = ((line[k][0] - line[0][0]) * dir[0] + (line[k][1] - line[0][1]) * dir[1]) / L;
      if (!best || align > best.align) best = { r, line, align };
    }
    if (!best) return null;
    if (early && best.r.bridgeRoad) return { defer: true };
    usedByApproach.add(best.r);
    if (best.r.bridge) {
      // OSM often joins tunnel and bridge metres inside the rock: the bore
      // runs on along the bridge while the ground stays over its deck
      const deck = best.r.bridge;
      const dense = resample(best.line.map(([x, y]) => [x, y]), 2);
      // (the last point within TUNNEL_ROCK_REACH_M still under ground: the
      // abutment itself is graded to the deck)
      let k = 1;
      for (let j = 1, s = 0; j < dense.length - 1; j++) {
        s += Math.hypot(dense[j][0] - dense[j - 1][0], dense[j][1] - dense[j - 1][1]);
        if (s > TUNNEL_ROCK_REACH_M) break;
        if (groundAt(dense[j][0], dense[j][1]) > deckHeightAt(deck, dense[j][0], dense[j][1]) + TUNNEL_ROCK_M) k = j + 1;
      }
      const rock = dense.slice(1, k);
      const at = rock.length ? rock[rock.length - 1] : end;
      return { xy: dense.slice(k - 1), deckZ: deckHeightAt(deck, at[0], at[1]), rock };
    }
    // on through the roads it continues into (at a junction the one most in
    // line: a cut-and-cover trench runs out a long way past ramps leaving it)
    const line = best.line.map(([x, y]) => [x, y]);
    const used = new Set([best.r]);
    let length = pathLength(line);
    while (length < TUNNEL_APPROACH_M) {
      const tip = line[line.length - 1];
      const prev = line[Math.max(0, line.length - 4)];
      const dl = Math.hypot(tip[0] - prev[0], tip[1] - prev[1]) || 1;
      const heading = [(tip[0] - prev[0]) / dl, (tip[1] - prev[1]) / dl];
      const next = others.filter((r) => !used.has(r) && !r.bridge
        && (Math.hypot(r.xy[0][0] - tip[0], r.xy[0][1] - tip[1]) < TUNNEL_TOUCH_M || Math.hypot(r.xy[r.xy.length - 1][0] - tip[0], r.xy[r.xy.length - 1][1] - tip[1]) < TUNNEL_TOUCH_M))
        .map((r) => {
          const piece = Math.hypot(r.xy[0][0] - tip[0], r.xy[0][1] - tip[1]) < TUNNEL_TOUCH_M ? r.xy : [...r.xy].reverse();
          const k = Math.min(piece.length - 1, 3);
          const L = Math.hypot(piece[k][0] - piece[0][0], piece[k][1] - piece[0][1]) || 1;
          return { r, piece, align: ((piece[k][0] - piece[0][0]) * heading[0] + (piece[k][1] - piece[0][1]) * heading[1]) / L };
        })
        .filter((c) => c.align > 0.8)
        .sort((a, b) => b.align - a.align);
      if (!next.length) break;
      used.add(next[0].r);
      usedByApproach.add(next[0].r);
      line.push(...next[0].piece.slice(1).map(([x, y]) => [x, y]));
      length = pathLength(line);
    }
    return { xy: line };
  };
  const dirOut = (a, b) => { const L = Math.hypot(a[0] - b[0], a[1] - b[1]) || 1; return [(a[0] - b[0]) / L, (a[1] - b[1]) / L]; };
  // roads an approach runs on (the rest meeting its cutting are side ramps)
  const usedByApproach = new Set();
  // Ramps joining an approach in its cutting (a freeway's on-ramp meeting it
  // in the trench before the tunnel: the trench wall ran across it) are
  // taken into the cutting like the ramps inside a tunnel: it widens on
  // their side, and they leave through an opening in their own trench.
  // A road ending where a bridge starts climbs over the cutting rather than
  // joining it (Norfolk's VA 337 flyover: its ground piece ends 7 m off I-264
  // right where the next bridge piece starts).
  const bridgeEnds = others.filter((o) => o.bridge || o.bridgeRoad).flatMap((o) => [o.xy[0], o.xy[o.xy.length - 1]]);
  const meetsBridge = ([x, y]) => bridgeEnds.some((q) => Math.hypot(q[0] - x, q[1] - y) < TUNNEL_TOUCH_M);
  const takeSideRamps = (t) => {
    if (t.kind === 'gallery') return;
    for (const r of others) {
      if (usedByApproach.has(r) || r.bridge || r.bridgeRoad) continue;
      for (const end of [r.xy[0], r.xy[r.xy.length - 1]]) {
        const n = nearestOnTunnel(t, end[0], end[1], t.W + 4);
        if (!n || n.beyond || n.into >= 0 || Math.abs(n.d) > t.W + 3) continue;
        if (groundAt(end[0], end[1]) - n.z < 0.5) continue;   // out where the cutting has run out
        if (meetsBridge(end)) continue;
        const xy = end === r.xy[0] ? r.xy : [...r.xy].reverse();
        const half = halfOf(drivableRoads[r.segIndex]);
        const res = absorbBranch(t, { xy: xy.map(([x, y]) => [x, y]), half, tunnelLength: 0 }, { groundAt });
        if (res.ok) t.sideRamps = (t.sideRamps || 0) + 1;
      }
    }
  };
  const solvePath = (path) => {
    const key = path.idx.join(',');
    if (done.has(key)) return undefined;   // solved (or left out) in the first phase
    const xy = path.xy;
    const half = Math.max(...path.idx.map((i) => parts[i].half));
    const n = xy.length;
    const approaches = [approachAt(xy[0], dirOut(xy[0], xy[1])), approachAt(xy[n - 1], dirOut(xy[n - 1], xy[n - 2]))];
    if (approaches.some((a) => a?.defer)) return undefined;   // meets a bridge: after the bridges
    // bridge roads crossing an approach: where (arc length from the tunnel's end)
    for (const a of approaches) {
      if (!a?.xy || Number.isFinite(a.deckZ)) continue;
      const sAlong = [0];
      for (let i = 1; i < a.xy.length; i++) sAlong.push(sAlong[i - 1] + Math.hypot(a.xy[i][0] - a.xy[i - 1][0], a.xy[i][1] - a.xy[i - 1][1]));
      a.under = [];
      for (const r of others) {
        if (!r.bridgeRoad) continue;
        for (let i = 0; i + 1 < a.xy.length; i++) {
          for (const [px, py] of planCrossingPoints([a.xy[i], a.xy[i + 1]], r.xy)) {
            a.under.push(sAlong[i] + Math.hypot(px - a.xy[i][0], py - a.xy[i][1]));
          }
        }
      }
    }
    done.add(key);
    // the bore carried on along a bridge still in the rock
    const bore = [...[...(approaches[0]?.rock || [])].reverse(), ...xy, ...(approaches[1]?.rock || [])];
    const gallery = path.idx.some((i) => parts[i].gallery);
    const t = solveTunnel({ xy: bore, half, gallery }, { groundAt, approaches, isFreeEnd, squareSize });
    const osm = path.idx.map((i) => parts[i].osm);
    if (!t.ok) { out.skipped.push({ osm, reason: t.reason, length: t.length }); return null; }
    t.osm = osm;
    t.approachKinds = approaches.map((a) => (!a ? null : Number.isFinite(a.deckZ) ? `bridge (${(a.rock || []).length} rock pts)` : `road ${Math.round(pathLength(a.xy))} m`));
    t.key = `t${String(out.tunnels.length + 1).padStart(3, '0')}`;
    t.groundBefore = t.line.map((p) => p.g);
    t.branches = [];
    out.tunnels.push(t);
    for (const i of path.idx) out.bySeg.set(parts[i].segIndex, t);
    return t;
  };
  // galleries wait for the tunnels' grading, and for the bridges (they run
  // on from tunnel mouths and bridge ends: their ends meet the ground those
  // leave)
  const galleryPaths = paths.filter((path) => path.idx.some((i) => parts[i].gallery));
  for (const path of paths) if (!galleryPaths.includes(path)) solvePath(path);
  // Ramps joining inside a tunnel: the main path solved, each ramp taken
  // into its bore (beamngTunnels absorbBranch) with the road it leaves on
  for (const { main, branches } of trees) {
    const t = solvePath(main);
    if (t === undefined) continue;
    for (const branch of branches) {
      const osm = branch.idx.map((i) => parts[i].osm);
      const tunnelLength = pathLength(branch.xy);
      if (!t) { out.skipped.push({ osm, reason: 'its tunnel was left on the ground', length: tunnelLength }); continue; }
      const xy = branch.xy;
      const n = xy.length;
      const away = approachAt(xy[n - 1], dirOut(xy[n - 1], xy[n - 2]));
      const full = away && !away.defer && !Number.isFinite(away.deckZ) ? [...xy, ...away.xy.slice(1)] : xy;
      const half = Math.max(...branch.idx.map((i) => parts[i].half));
      const res = absorbBranch(t, { xy: full, half, tunnelLength }, { groundAt });
      if (!res.ok) { out.skipped.push({ osm, reason: res.reason, length: tunnelLength }); continue; }
      t.osm.push(...osm);
      t.branches.push({ osm, absorbed: res.absorbed, trench: res.trench });
      for (const i of branch.idx) out.bySeg.set(parts[i].segIndex, t);
    }
  }
  // ramps meeting the approaches in their cuttings, now the tunnels' own
  // ramps are in
  for (const t of out.tunnels) takeSideRamps(t);
  if (!out.tunnels.length && (early || !galleryPaths.length)) return out;

  // Terrain: graded into the export's copy, then the portal squares opened.
  const { width, height, minHeight } = terrainData;
  const hm = heightMapEditor(terrainData);
  const worldSize = width * squareSize;
  const toPixel = (x, y) => [(x / worldSize + 0.5) * (width - 1), (0.5 - y / worldSize) * (height - 1)];
  const toWorld = (c, r) => [((c / (width - 1)) - 0.5) * worldSize, (0.5 - r / (height - 1)) * worldSize];
  const pixelBox = (t) => {
    const [x0, y0, x1, y1] = tunnelReach(t);
    const [c0, r1] = toPixel(x0, y0);
    const [c1, r0] = toPixel(x1, y1);
    return [Math.max(0, Math.floor(c0)), Math.max(0, Math.floor(r0)), Math.min(width - 1, Math.ceil(c1)), Math.min(height - 1, Math.ceil(r1))];
  };
  // blocks of grid points with nothing of the tunnel within reach are skipped
  // (a long diagonal tunnel's box is mostly far from it)
  const BLOCK = 16;
  const reachOf = (t) => t.headHalf + (t.maxExtra || 0) + 64 + Math.max(0, ...(t.cuts || []).map((c) => c.half + 50));
  const nearBlock = (t, c, r) => {
    const [x, y] = toWorld(c + BLOCK / 2, r + BLOCK / 2);
    const reach = reachOf(t) + BLOCK * squareSize;
    if (nearestOnTunnel(t, x, y, reach)) return true;
    return (t.cuts || []).some((cut) => cut.line.some((q) => Math.hypot(q.x - x, q.y - y) < reach));
  };
  const gradeAll = (list) => { for (const t of list) gradeOne(t); };
  const gradeOne = (t) => {
    const [c0, r0, c1, r1] = pixelBox(t);
    let changed = 0;
    for (let br = r0; br <= r1; br += BLOCK) {
      for (let bc = c0; bc <= c1; bc += BLOCK) {
        if (!nearBlock(t, bc, br)) continue;
        for (let r = br; r < Math.min(r1 + 1, br + BLOCK); r++) {
          for (let c = bc; c < Math.min(c1 + 1, bc + BLOCK); c++) {
            const idx = r * width + c;
            const h = hm.at(idx) - minHeight;
            const [x, y] = toWorld(c, r);
            const want = tunnelGroundAt(t, x, y, h);
            if (Math.abs(want - h) > 1e-3) { hm.set(idx, want + minHeight); changed++; }
          }
        }
      }
    }
    t.gradedPixels = changed;
  };
  gradeAll(out.tunnels);
  // then the galleries (and the hillside tunnels short of rock that become
  // galleries), on the ground as it is now
  if (!early) {
    const before = out.tunnels.length;
    for (const path of galleryPaths) solvePath(path);
    const fresh = out.tunnels.slice(before);
    gradeAll(fresh);
  }
  const holes = new Set();
  for (const t of out.tunnels) {
    const [c0, r0, c1, r1] = pixelBox(t);
    let opened = 0;
    // square (c, r) spans pixels c..c+1 and r-1..r (north): layer index of
    // its south-west sample
    for (let r = Math.max(1, r0); r <= r1; r++) {
      for (let c = c0; c < Math.min(c1, width - 1); c++) {
        const corners = [hm.at(r * width + c), hm.at(r * width + c + 1), hm.at((r - 1) * width + c), hm.at((r - 1) * width + c + 1)];
        const [x, y] = toWorld(c + 0.5, r - 0.5);
        if (tunnelHoleAt(t, x, y, Math.min(...corners) - minHeight, Math.max(...corners) - minHeight)) { holes.add((height - 1 - r) * width + c); opened++; }
      }
    }
    t.holes = opened;
  }
  out.holes = [...holes];
  if (globalThis.__MAPNG_TUNNEL_DEBUG) globalThis.__MAPNG_TUNNEL_DEBUG(out, { groundAt, toWorld, toPixel, bridges, width, height, hmAt: (idx) => hm.at(idx) - minHeight });
  console.log(`[BeamNG Export] Tunnels: ${out.tunnels.length} bored (${out.tunnels.map((t) => `${Math.round(t.tubeLength)} m`).join(', ')}), ${out.skipped.length} left on the ground, ${out.holes.length} portal hole square(s).`);
  return out;
}

/** The two tunnel phases as one result (keys numbered through both). */
function joinTunnelPhases(a, b) {
  const tunnels = [...a.tunnels, ...b.tunnels];
  tunnels.forEach((t, i) => { t.key = `t${String(i + 1).padStart(3, '0')}`; });
  return {
    tunnels,
    bySeg: new Map([...a.bySeg, ...b.bySeg]),
    skipped: [...a.skipped, ...b.skipped],
    holes: [...new Set([...a.holes, ...b.holes])],
  };
}

// Pedestrian streets (highway=pedestrian: St. George Street, St. Augustine;
// European old towns) carry no traffic, so they are no part of the road
// network, but they are drawn: in their own surface, under every road that
// meets them, with no paint, edge blend or AI path.
const PEDESTRIAN_WIDTH_M = 6;
const PEDESTRIAN_RENDER_PRIORITY = 16;

/** The surface layers of a pedestrian street fullWidth wide (untagged: as paving stones). */
export function pedestrianSurfaceLayers(surface, fullWidth, { americas = false } = {}) {
  const s = String(surface ?? '').trim().toLowerCase();
  const fade = { distanceFade: ASPHALT_BASE.distanceFade, breakAngle: 2 };
  if (UNPAVED_SURFACES.has(s)) {
    return [{ offset: 0, width: fullWidth * 1.1, material: GLOBAL_DECAL_MATERIALS.dirtRoad, textureLength: SURFACE_TEXTURE_LENGTH.dirt, ...fade }];
  }
  if (CONCRETE_SURFACES.has(s)) {
    return [{ offset: 0, width: fullWidth, material: GLOBAL_DECAL_MATERIALS.concrete, textureLength: SURFACE_TEXTURE_LENGTH.concrete, ...fade }];
  }
  if (s === 'asphalt' || s === 'paved') {
    return [{ offset: 0, width: fullWidth, material: GLOBAL_DECAL_MATERIALS.asphalt, textureLength: SURFACE_TEXTURE_LENGTH.asphalt, ...fade }];
  }
  const paving = pavingOf(s || 'paving_stones', { americas }) || pavingOf('paving_stones', { americas });
  return pavingStrips(paving, fullWidth).map((strip) => ({ ...strip, material: PAVING_MATERIALS[paving].material.name, ...fade }));
}

/**
 * DecalRoads for the pedestrian streets: { decals: [{ decal, street }] (street:
 * its spline group's name), ways: [{ nodes, half }] (for keeping trees off) }.
 */
function buildPedestrianStreetDecals(terrainData, squareSize) {
  const decals = [];
  const ways = [];
  const perStreet = new Map();
  for (const feature of terrainData.osmFeatures || []) {
    const tags = feature?.tags || {};
    if (feature?.type !== 'road' || tags.highway !== 'pedestrian' || !(feature.geometry?.length >= 2)) continue;
    // squares (area=yes) are polygons, not streets; bridges and tunnels have
    // no deck or bore here
    if (tags.area === 'yes' || isBridgeRoad(tags) || (tags.tunnel && tags.tunnel !== 'no')) continue;
    const tagged = Number.parseFloat(tags.width);
    const fullWidth = Number.isFinite(tagged) && tagged > 0 ? Math.min(40, Math.max(2, tagged)) : PEDESTRIAN_WIDTH_M;
    const layers = pedestrianSurfaceLayers(tags.surface, fullWidth, { americas: getMarkingStyle(terrainData.roadRules) === 'americas' });
    const street = sanitizeBeamNGObjectName(tags.name || `pedestrian_${feature.id}`, `pedestrian_${feature.id || 'x'}`);
    const pieces = clipGeometryToMargin(feature.geometry, terrainData.bounds)
      .map((s) => resampleGeometryToSpacing(s, ROAD_NODE_SPACING_M))
      .flatMap((s) => chunkPolyline(s));
    for (const piece of pieces) {
      const nodes = [];
      for (const pt of piece) {
        const [x, y, z] = geoToWorldPoint(pt.lat, pt.lng, terrainData, squareSize, 0.1);
        if (Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z)) {
          nodes.push([Math.round(x * 1000) / 1000, Math.round(y * 1000) / 1000, Math.round(z * 1000) / 1000, fullWidth / 2]);
        }
      }
      if (nodes.length < 2) continue;
      ways.push({ nodes, half: fullWidth / 2 });
      const n = (perStreet.get(street) || 0) + 1;
      perStreet.set(street, n);
      layers.forEach((layer, k) => {
        const decal = makeRoadDecal(offsetNodes(nodes, layer.offset, layer.width), 'Base', street, {
          material: layer.material,
          renderPriority: PEDESTRIAN_RENDER_PRIORITY,
          breakAngle: layer.breakAngle,
          textureLength: layer.textureLength,
          startEndFade: [0, 0],
          distanceFade: layer.distanceFade,
        });
        if (!decal) return;
        decal.name = sanitizeBeamNGObjectName(`dr_${street}_p${n}_b${k + 1}`);
        decals.push({ decal, street });
      });
    }
  }
  return { decals, ways };
}

/** The paving materials the decal groups use, by name (for main.materials.json). */
export function usedPavingMaterials(groups) {
  const byName = new Map(Object.values(PAVING_MATERIALS).map((p) => [p.material.name, p.material]));
  const used = {};
  for (const group of groups) {
    for (const item of group.__items || []) {
      if (byName.has(item.material)) used[item.material] = byName.get(item.material);
    }
  }
  return used;
}

// A short untagged way between two bridge ways, joined by nothing else at
// either end, is the same structure: mappers tag only the spans over
// something (Norfolk's VA 337 flyovers: 14-29 m bridges with 17-54 m gaps
// over the tunnel cuttings; a 76 m embankment between its I-264 ramp's two
// bridges). Left on the ground, the road dives into the gap between its
// decks; where it does lie on the ground, the deck is laid on it.
const BRIDGE_GAP_MAX_M = 100;
const GAP_MINOR_HIGHWAYS = new Set(['service', 'track', 'path', 'footway', 'cycleway', 'bridleway', 'steps', 'pedestrian']);

export function bridgeOverShortGaps(features) {
  const key = (g) => `${g.lat},${g.lng}`;
  const atNode = new Map();
  for (const f of features) for (const g of f.geometry) {
    const k = key(g);
    if (!atNode.has(k)) atNode.set(k, new Set());
    atNode.get(k).add(f);
  }
  const isBridge = (f) => isBridgeRoad(f.tags) && !isBoredTunnelTag(f.tags);
  const lengthM = (geom) => {
    let s = 0;
    for (let i = 1; i < geom.length; i++) {
      const dy = (geom[i].lat - geom[i - 1].lat) * 111320;
      const dx = (geom[i].lng - geom[i - 1].lng) * 111320 * Math.cos(geom[i].lat * Math.PI / 180);
      s += Math.hypot(dx, dy);
    }
    return s;
  };
  return features.map((f) => {
    const tags = f.tags || {};
    if (isBridge(f) || (tags.tunnel && tags.tunnel !== 'no') || f.geometry.length < 2) return f;
    if (lengthM(f.geometry) > BRIDGE_GAP_MAX_M) return f;
    // its interior joins nothing but minor ways (a service track tied onto
    // a ramp's embankment); each end meets bridges only
    const minor = (o) => GAP_MINOR_HIGHWAYS.has(o.tags?.highway);
    if (f.geometry.slice(1, -1).some((g) => [...atNode.get(key(g))].some((o) => o !== f && !minor(o)))) return f;
    let layer = 1;
    for (const g of [f.geometry[0], f.geometry[f.geometry.length - 1]]) {
      const others = [...atNode.get(key(g))].filter((o) => o !== f);
      if (!others.length || !others.every(isBridge)) return f;
      for (const o of others) layer = Math.max(layer, getEffectiveRoadLayer(o.tags));
    }
    return { ...f, tags: { ...tags, bridge: 'yes', layer: String(layer), 'mapng:bridge_gap': 'yes' } };
  });
}

export function generateDecalRoads(terrainData, squareSize) {
  if (!terrainData.osmFeatures?.length) return [];

  const sourceRoadFeatures = bridgeOverShortGaps(terrainData.osmFeatures.filter((feature) => {
    if (feature?.type !== 'road' || !feature.geometry?.length) return false;
    const highway = feature.tags?.highway;
    return !!highway && !ROAD_SKIP.has(highway);
  }));
  const roadNetwork = buildRoadNetwork(sourceRoadFeatures);
  const mergedRoadSegments = mergeLinearRoadSegments(
    roadNetwork.segments,
    roadNetwork.intersections,
    { styleKeyResolver: getDecalMergeStyleKey },
  );
  const drivableRoads = mergedRoadSegments.length > 0 ? mergedRoadSegments : roadNetwork.segments;
  const stableHalfWidthMap = buildStableDecalHalfWidthMap(drivableRoads);
  const isUrbanRoad = buildUrbanRoadClassifier(terrainData.osmFeatures);
  const halfOf = (seg) => {
    const tags = seg.sourceFeature?.tags || {};
    const cs = estimateRoadCrossSection(tags, seg.highway, isOneWayRoad(tags), {
      urban: isUrbanRoad(seg),
      fallbackHalfWidth: (HIGHWAY_STYLE[seg.highway] ?? DEFAULT_ROAD_STYLE).width,
    });
    const stable = hasWidthTags(tags) ? null : stableHalfWidthMap.get(getDecalWidthCorridorKey(seg));
    const driving = Number.isFinite(stable) && stable > 0 ? stable : cs.drivingHalfWidth;
    return driving + (cs.leftExtra + cs.rightExtra) / 2;
  };
  // Tunnels and bridges, their earthworks graded before any road samples the
  // ground. The tunnels meeting no bridge first: a bridge over a tunnel's
  // trench (North 7th Street over I-10 at Deck Park, Phoenix) spans it at the
  // street, not 6.5 m over a freeway the elevation shows at street level.
  // Then the bridges (the road nodes on a bridge ride on its deck), then the
  // tunnels a bridge meets (a portal takes the deck's height).
  const done = new Set();
  const early = solveExportTunnels(drivableRoads, terrainData, squareSize, null, halfOf, { done });
  const bridges = solveExportBridges(drivableRoads, terrainData, squareSize, early.tunnels);
  const late = solveExportTunnels(drivableRoads, terrainData, squareSize, bridges, halfOf, { done });
  const tunnels = joinTunnelPhases(early, late);
  // a road reaching into a tube it is no part of (a ramp OSM ends a few
  // metres into a tunnel's mouth, where the tube widens for it): on the
  // tube's floor there, not draped over the headwall's backfill
  const inTubeSeg = new Set();
  const tubeAt = (x, y) => {
    for (const t of tunnels.tunnels) {
      if (t.kind === 'gallery') continue;
      const n = nearestOnTunnel(t, x, y, t.W + (t.maxExtra || 0) + 1);
      if (!n || n.beyond || n.into < 0.3) continue;
      if (Math.abs(n.d) - extraAt(t, t.line[n.i], Math.sign(n.d) || 1) <= t.W) return t;
    }
    return null;
  };
  const giveWayKeys = collectGiveWayNodeKeys(terrainData.osmFeatures);
  const leftHandTraffic = !!terrainData.roadRules?.leftHandTraffic;
  const markingStyle = getMarkingStyle(terrainData.roadRules);

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
    'AI Path': 'ai',
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

  // Paint cut pass inputs: each drawn road's carriageway, and which roads
  // meet at each endpoint (two meeting = a plain continuation, not a junction).
  const carriageways = [];
  const ownersAtNode = new Map();
  const paintDecals = [];

  for (let segIndex = 0; segIndex < drivableRoads.length; segIndex++) {
    const segmentFeature = drivableRoads[segIndex];
    const feature = segmentFeature.sourceFeature;
    const highway = segmentFeature.highway;
    if (!shouldGenerateDecalRoads(highway, feature.tags || {})) continue;
    for (const key of [segmentFeature.startKey, segmentFeature.endKey]) {
      if (!key) continue;
      if (!ownersAtNode.has(key)) ownersAtNode.set(key, new Set());
      ownersAtNode.get(key).add(segIndex);
    }
    const rawName = feature.tags?.name || feature.tags?.ref || `road_${feature.id}`;
    const baseName = sanitizeBeamNGObjectName(rawName, `road_${feature.id || 'x'}`);
    const used = usedGroupNames.get(baseName) || 0;
    usedGroupNames.set(baseName, used + 1);
    const cleanName = used > 0 ? sanitizeBeamNGObjectName(`${baseName}_${used + 1}`) : baseName;
    
    const style = HIGHWAY_STYLE[highway] ?? DEFAULT_ROAD_STYLE;
    const isOneWay = isOneWayRoad(feature.tags || {});
    const renderTags = getMergedRoadRenderTags(segmentFeature);
    const corridorKey = getDecalWidthCorridorKey(segmentFeature);
    const urbanRoad = isUrbanRoad(segmentFeature);
    const crossSection = estimateRoadCrossSection(feature.tags || {}, highway, isOneWay, {
      urban: urbanRoad,
      fallbackHalfWidth: style.width,
    });
    // Untagged ways take the corridor's DRIVING width; parking / shoulders
    // sit on top of it.
    const stableHalfWidth = hasWidthTags(feature.tags || {}) ? null : stableHalfWidthMap.get(corridorKey);
    const drivingHalfWidth = Number.isFinite(stableHalfWidth) && stableHalfWidth > 0
      ? stableHalfWidth
      : crossSection.drivingHalfWidth;
    const styleHalfWidth = drivingHalfWidth + (crossSection.leftExtra + crossSection.rightExtra) / 2;
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
        const [wx, wy, groundZ] = geoToWorldPoint(pt.lat, pt.lng, terrainData, squareSize, 0.1);
        const deckPart = bridges.bySeg.get(segIndex);
        const carried = bridges.approaches?.get(segIndex);
        const bore = tunnels.bySeg.get(segIndex) || tubeAt(wx, wy);
        if (bore && !tunnels.bySeg.has(segIndex)) inTubeSeg.add(segIndex);
        const wz = deckPart ? deckHeightAt(deckPart, wx, wy) + 0.1
          : carried && distanceToLine(carried.xy, wx, wy) < 1 ? deckHeightAt(carried, wx, wy) + 0.1
            : bore ? tunnelRoadZ(bore, wx, wy)
              : groundZ;
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
      const bridgePart = bridges.bySeg.get(segIndex);
      if (bridgePart) bridgePart.half = styleHalfWidth;
      // a deck carried on along this approach is as wide as the road on it
      const carriedPart = bridges.approaches?.get(segIndex);
      if (carriedPart) carriedPart.half = Math.max(carriedPart.half, styleHalfWidth);
      carriageways.push({
        owner: segIndex, nodes: centerNodes, half: styleHalfWidth,
        tags: renderTags, highway, urban: urbanRoad, wayId: feature.id, oneWay: isOneWay,
        bridge: !!bridgePart, tunnel: tunnels.bySeg.has(segIndex),
      });

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
          navMetadata: getDecalRoadNavMetadata(highway, renderTags, {
            leftHandTraffic,
            givesWay: geometryHasGiveWay(segmentFeature.geometry, giveWayKeys),
          }),
          drivingHalfWidth,
          laneShift: crossSection.laneShift,
          markingStyle,
          urban: urbanRoad,
        },
      );

      if (layeredDecals.length > 0) {
        const segCount = (segmentCounterByName.get(cleanName) || 0) + 1;
        segmentCounterByName.set(cleanName, segCount);
        const nameSuffix = `s${segCount}`;
        const roadNamePrefix = sanitizeBeamNGObjectName(`dr_${cleanName}`);
        const onStructure = bridges.bySeg.has(segIndex) || tunnels.bySeg.has(segIndex) || inTubeSeg.has(segIndex);
        for (let d = 0; d < layeredDecals.length; d++) {
          const decal = layeredDecals[d];
          // paving strips are several Base layers: numbered
          const layerCode = decal.__layer === 'paving' ? `b${d + 1}` : LAYER_CODE[decal.name] || `l${d + 1}`;
          // A grass verge hangs past the deck / tube floor: clipped over objects it
          // smears down the walls and parapets below it, so it is left off there.
          const edgeBlend = layerCode === 'ebl' || layerCode === 'ebr';
          if (edgeBlend && onStructure) continue;
          decal.name = sanitizeBeamNGObjectName(`${roadNamePrefix}_${nameSuffix}_${layerCode}`);
          // On a bridge the road clips onto the deck, in a tunnel onto its
          // floor: without overObjects a DecalRoad is projected onto the
          // terrain (the hill over a tunnel).
          if (!edgeBlend && (onStructure || bridges.approaches?.has(segIndex))) decal.overObjects = true;
          splineGroup.__items.push(decal);
          if (isCutPaintLayer(decal.__layer)) paintDecals.push({ decal, group: splineGroup, owner: segIndex });
        }
      }
    }
  }

  const pedestrianStreets = buildPedestrianStreetDecals(terrainData, squareSize);
  for (const { decal, street } of pedestrianStreets.decals) getOrCreateSplineGroup(street).__items.push(decal);

  const carriagewayIndex = buildCarriagewayIndex(carriageways);
  const junctionMarkings = generateJunctionMarkingDecals(terrainData, squareSize, { carriageways: carriagewayIndex });
  cutPaintAtOtherRoads(paintDecals, carriagewayIndex, drivableRoads, ownersAtNode, junctionMarkings.zones || []);

  const groups = Array.from(roadSplinesByName.values()).filter((g) => g.__items.length > 0);

  if (junctionMarkings.length > 0) {
    groups.push({
      class: 'SimGroup',
      name: 'junction_markings',
      persistentId: generatePersistentId(),
      __parent: 'Decal_Roads',
      __items: junctionMarkings,
    });
  }

  // The drawn carriageways (with the roads each plainly continues into) and
  // crosswalk bands, for things built along them (street lamps, sidewalks).
  for (const cw of carriageways) {
    const seg = drivableRoads[cw.owner];
    cw.continuations = [seg?.startKey, seg?.endKey]
      .map((key) => (key ? ownersAtNode.get(key) : null))
      .filter((owners) => owners && owners.size === 2)
      .flatMap((owners) => [...owners].filter((o) => o !== cw.owner));
  }
  Object.defineProperty(groups, 'carriageways', { value: carriageways, enumerable: false });
  Object.defineProperty(groups, 'pedestrianStreets', { value: pedestrianStreets.ways, enumerable: false });
  Object.defineProperty(groups, 'bridges', { value: bridges, enumerable: false });
  Object.defineProperty(groups, 'tunnels', { value: tunnels, enumerable: false });
  Object.defineProperty(groups, 'crosswalkZones', { value: junctionMarkings.zones || [], enumerable: false });
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
// With the drawn carriageway known: paint stops this far inside its edge.
const JUNCTION_MARK_EDGE_INSET_M = 0.3;
const STOP_BAR_CENTRE_GAP_M = 0.25;
// Crosswalk lines keep this far off crossing roads' carriageways, moving at
// most CROSSWALK_MAX_SHIFT_M along their road; lines stop this far short.
const CROSSWALK_CLEAR_M = 1.6;
const CROSSWALK_MAX_SHIFT_M = 12;
const CROSSWALK_LINE_CLEAR_M = 0.5;

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
export function generateJunctionMarkingDecals(terrainData, squareSize, { carriageways = null } = {}) {
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
    const [px, py] = geoToWorldPoint(pt.lat, pt.lng, terrainData, squareSize, 0);
    // The painted carriageway's real width where the decals exist.
    const drawnHalf = carriageways ? parallelHalfWidthAt(carriageways, px, py, tangent) : null;
    const style = HIGHWAY_STYLE[highway] ?? DEFAULT_ROAD_STYLE;
    const halfW = drawnHalf
      ? Math.max(1, drawnHalf - JUNCTION_MARK_EDGE_INSET_M)
      : JUNCTION_MARK_SPAN_FACTOR * estimateRoadHalfWidth(roadTags, highway, oneWay, style.width);
    return { roadTags, tangent, oneWay, halfW, px, py };
  };

  // A crosswalk mapped inside the junction box moves out along its own road
  // until it clears the crossing roads (BeamNG.Earth puts crosswalks just
  // outside each corner). Null when there's no room.
  const clearOfCrossingRoads = (m) => {
    if (!carriageways) return [m.px, m.py];
    const blocked = (x, y) => isOnCrossingCarriageway(carriageways, x, y, CROSSWALK_CLEAR_M, m.tangent);
    if (!blocked(m.px, m.py)) return [m.px, m.py];
    for (let shift = 0.5; shift <= CROSSWALK_MAX_SHIFT_M; shift += 0.5) {
      for (const sign of [1, -1]) {
        const x = m.px + m.tangent[0] * shift * sign;
        const y = m.py + m.tangent[1] * shift * sign;
        if (!blocked(x, y)) return [x, y];
      }
    }
    return null;
  };
  const zones = [];

  // Transverse crosswalk: two full-width lines straddling the crossing point.
  const paintCrosswalk = (road, index, pt) => {
    const key = makeRoadNodeKey(pt);
    if (paintedCrossingKeys.has(key)) return;
    const m = roadMetricsAt(road, index, pt);
    if (!m) return;
    paintedCrossingKeys.add(key);
    const spot = clearOfCrossingRoads(m);
    if (!spot) return;
    const [cx, cy] = spot;
    // Square to the drawn road where the crosswalk ends up: the tangent at a
    // junction vertex is bent by the other road.
    const drawn = carriageways ? parallelRoadAt(carriageways, cx, cy, m.tangent) : null;
    const tangent = drawn?.dir ?? m.tangent;
    const halfW = drawn ? Math.max(1, drawn.half - JUNCTION_MARK_EDGE_INSET_M) : m.halfW;
    const perp = [-tangent[1], tangent[0]];
    for (const side of [-1, 1]) {
      pushLine(
        'jm_crosswalk',
        cx + tangent[0] * CROSSWALK_LINE_GAP_HALF_M * side,
        cy + tangent[1] * CROSSWALK_LINE_GAP_HALF_M * side,
        perp[0], perp[1], -halfW, halfW, CROSSWALK_LINE_WIDTH_M,
      );
    }
    // Lines along the road stop at the crosswalk.
    zones.push({
      x: cx, y: cy, ux: tangent[0], uy: tangent[1],
      halfLength: CROSSWALK_LINE_GAP_HALF_M + CROSSWALK_LINE_WIDTH_M / 2 + CROSSWALK_LINE_CLEAR_M,
      halfWidth: halfW + 1,
    });
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
    if (kind !== 'crossing' || !shouldPaintCrossing(tags)) continue;

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
    paintCrosswalk(road, index, pt);
  }

  // Stop bars at the same stop points the AI uses (signals + stop signs, one
  // per approach; beamngSignals.collectJunctionApproaches), across the lanes
  // that approach: the kerb half of a two-way road, all of a one-way.
  const junctions = collectJunctionApproaches(terrainData);
  const leftHandTraffic = !!terrainData.roadRules?.leftHandTraffic;
  const approaches = junctions
    ? [...junctions.intersections.flatMap((i) => i.approaches), ...junctions.stopApproaches]
    : [];
  for (const approach of approaches) {
    const ll = junctions.projector.unproject(approach.x, approach.y);
    if (!insideMargin(ll)) continue;
    const [px, py] = geoToWorldPoint(ll.lat, ll.lng, terrainData, squareSize, 0);
    const len = Math.hypot(approach.dir[0], approach.dir[1]) || 1;
    const dir = [approach.dir[0] / len, approach.dir[1] / len];
    const right = [dir[1], -dir[0]];
    const kerb = leftHandTraffic ? [-right[0], -right[1]] : right;
    const drawnHalf = carriageways ? parallelHalfWidthAt(carriageways, px, py, dir) : null;
    const halfW = Math.max(1, (drawnHalf ?? approach.halfWidth) - JUNCTION_MARK_EDGE_INSET_M);
    const fromM = approach.oneWay ? -halfW : STOP_BAR_CENTRE_GAP_M;
    pushLine('jm_stopline', px, py, kerb[0], kerb[1], fromM, halfW, STOP_BAR_THICKNESS_M);
    stopCount++;
  }

  if (decals.length > 0) {
    console.log(`[BeamNG Export] Junction markings: ${stopCount} stop bars, ${crossingCount} crosswalks`);
  }
  // Crosswalk bands, for cutting the road's own lines (see generateDecalRoads).
  Object.defineProperty(decals, 'zones', { value: zones, enumerable: false });
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

const LAKE_BLOCK_DEPTH_M = 6;

const WATER_BLOCK_TEMPLATE = {
  class: 'WaterBlock',
  Foam: [{}, {}],
  'Ripples (texture animation)': [
    { rippleDir: [0, 1], rippleMagnitude: 0.8, rippleSpeed: 0.03, rippleTexScale: [12, 12] },
    { rippleDir: [0, 1], rippleSpeed: 0.09, rippleTexScale: [6, 6] },
    { rippleDir: [0.7, -0.7], rippleMagnitude: 1, rippleSpeed: 0.012, rippleTexScale: [3, 3] },
  ],
  'Waves (vertex undulation)': [
    { waveDir: [0, 1], waveMagnitude: 0.2, waveSpeed: 1 },
    { waveDir: [0.707, 0.707], waveMagnitude: 0.2, waveSpeed: 1 },
    { waveDir: [0.5, 0.86], waveMagnitude: 0.2, waveSpeed: 1 },
  ],
  baseColor: [44, 74, 60, 255],
  clarity: 0.12,
  underwaterColor: [52, 78, 58, 240],
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
  overallRippleMagnitude: 0.6,
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

// Rivers styled like the stock maps' and BeamNG.Earth's (sea.lua RIVER_LOOK):
// no foam (white fringes at every shallow edge), small waves, fresh water
// greener and browner than the sea; ripple tiles longer along the river than
// across (the texture runs along the spline), their speeds set from the flow.
const RIVER_TEMPLATE = {
  class: 'River',
  Foam: [{}, {}],
  'Ripples (texture animation)': [
    { rippleDir: [0, 1], rippleMagnitude: 1, rippleSpeed: 0.3, rippleTexScale: [2, 4] },
    { rippleDir: [0.2, 1], rippleMagnitude: 1, rippleSpeed: 0.06, rippleTexScale: [5, 10] },
    { rippleDir: [-0.2, 1], rippleMagnitude: 0.3, rippleSpeed: 0.006, rippleTexScale: [20, 40] },
  ],
  'Waves (vertex undulation)': [
    { waveDir: [0, 1], waveMagnitude: 0.1, waveSpeed: 2 },
    { waveDir: [0.707, 0.707], waveMagnitude: 0.1, waveSpeed: 1 },
    { waveDir: [0.5, 0.86], waveMagnitude: 0.1, waveSpeed: 2 },
  ],
  baseColor: [44, 74, 60, 255],
  clarity: 0.12,
  cubemap: 'cubemap_ocean_reflection',
  depthGradientMax: 6,
  depthGradientTex: '/assets/materials/tileable/water/depthcolor_ramp/depthcolor_ramp_italy_rivers_b.png',
  flowMagnitudePhysics: 1.2,
  foamMaxDepth: 0.1,
  foamRippleInfluence: 0.05,
  foamTex: '/assets/materials/tileable/water/water_effects/foam_b.color.dds',
  fresnelBias: 0,
  fresnelPower: 3,
  fullReflect: false,
  lowLODDistance: 120,
  overallFoamOpacity: 0,
  overallRippleMagnitude: 1.2,
  overallWaveMagnitude: 0.05,
  reflectDetailAdjust: -2,
  reflectMaxRateMs: 10,
  reflectivity: 0.3,
  rippleTex: '/assets/materials/tileable/water/water_effects/ripple3_nm.normal.dds',
  subdivideLength: 4,
  underwaterColor: [52, 78, 58, 240],
  waterFogDensity: 0.4,
  waterFogDensityOffset: 0.1,
  wetDarkening: 0.3,
  wetDepth: 0.5,
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
 * Format a byte count as B / KB / MB / GB for progress and report output.
 */
function formatBytes(value) {
  if (!Number.isFinite(value) || value < 0) return 'n/a';
  const units = ['B', 'KB', 'MB', 'GB'];
  let v = value;
  let u = 0;
  while (v >= 1024 && u < units.length - 1) { v /= 1024; u++; }
  return `${u === 0 ? v : v.toFixed(v >= 100 ? 0 : 1)} ${units[u]}`;
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

// Rough share of an export's run time per phase, in seconds, fitted to timed
// exports (Salt Lake County 16k: backdrop downloads 180 s, ZIP ~80 s, heightmap
// PNG 23 s, vegetation 18 s; Cottonwood Heights 4k: ZIP 25 s for 1,038 files,
// sidewalks 7 s for 1,329 roads, buildings 1.3 s for 3,399 footprints). Grid
// work scales with the pixel count, road work with the roads, the ZIP with
// its file count (≈ the roads: one folder per named road) and the backdrop's
// downloads with the area, so the bar follows the time actually spent.
function exportPhaseWeights({ size, osmFeatureCount, roadCount, buildingCount, includeBackdrop, applyFoundations }) {
  const px = (size / 4096) ** 2;
  return {
    prepare: 0.5,
    foundations: applyFoundations ? 0.001 * buildingCount : 0,
    roads: 1 + 0.001 * roadCount,
    sidewalks: 0.005 * roadCount,
    props: 0.5 + 0.0002 * roadCount,
    texture: 0.5 + 1 * px,
    materials: 0.3 * px,
    ter: 0.1 * px,
    heightmap: 1.4 * px,
    thumbnail: 0.4,
    buildings: 0.0004 * buildingCount,
    water: 0.2,
    furniture: 0.2 + 0.00005 * osmFeatureCount,
    vegetation: 0.00008 * osmFeatureCount,
    backdrop: includeBackdrop ? 4 + 15 * px : 0,
    assets: 0.5,
    zip: 0.5,
    compress: 2 + 0.018 * roadCount + 2.5 * px,
  };
}

// Compression cost of one ZIP entry (s): JSZip + the OPFS write per file, and
// DEFLATE per MB (4k export: ~20 ms a file, ~46 ms a MB).
const ZIP_FILE_COST_S = 0.02;
const ZIP_MB_COST_S = 0.046;
const byteSizeOf = (data) => {
  if (typeof data === 'string') return data.length;
  return Number(data?.byteLength ?? data?.size) || 0;
};

const JOB_LOG_MAX_LINES = 20000;
const JOB_LOG_MAX_ARG_CHARS = 2000;

// Mirror console output into a timestamped list while an export runs. Large
// arrays and typed arrays are summarized, not serialized.
function captureConsole() {
  const startedAt = performance.now();
  const lines = [];
  let dropped = 0;
  const replacer = (key, value) => {
    if (ArrayBuffer.isView(value)) return `[${value.constructor.name} ${value.length}]`;
    if (Array.isArray(value) && value.length > 50) return `[Array ${value.length}]`;
    return value;
  };
  const format = (arg) => {
    if (typeof arg === 'string') return arg;
    if (arg instanceof Error) return `${arg.name}: ${arg.message}`;
    let text;
    try { text = JSON.stringify(arg, replacer); } catch { text = String(arg); }
    if (text === undefined) text = String(arg);
    return text.length > JOB_LOG_MAX_ARG_CHARS ? `${text.slice(0, JOB_LOG_MAX_ARG_CHARS)}…` : text;
  };
  const originals = {};
  for (const level of ['log', 'info', 'warn', 'error', 'debug']) {
    const original = console[level];
    originals[level] = original;
    console[level] = (...args) => {
      if (lines.length < JOB_LOG_MAX_LINES) {
        const t = ((performance.now() - startedAt) / 1000).toFixed(2).padStart(8);
        lines.push(`[${t}s] ${level.toUpperCase().padEnd(5)} ${args.map(format).join(' ')}`);
      } else {
        dropped++;
      }
      original.apply(console, args);
    };
  }
  return {
    lines,
    get dropped() { return dropped; },
    restore() { for (const [level, fn] of Object.entries(originals)) console[level] = fn; },
  };
}

/**
 * Detailed troubleshooting sections for export_report.txt: what the export
 * built (roads, bridges, buildings, furniture, vegetation, water, terrain
 * materials), the machine it ran on, and the job's console output.
 */
function buildDetailedReportSections(d) {
  const lines = [];
  const section = (title) => { lines.push('', title, '-'.repeat(title.length)); };
  const countBy = (items, keyOf) => {
    const m = new Map();
    for (const it of items) { const k = keyOf(it) ?? 'n/a'; m.set(k, (m.get(k) || 0) + 1); }
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  };
  const listCounts = (entries, limit = 25) => {
    for (const [k, n] of entries.slice(0, limit)) lines.push(`  - ${k}: ${n}`);
    if (entries.length > limit) lines.push(`  - … ${entries.length - limit} more`);
  };
  const td = d.terrainData;
  const minH = Number(td?.minHeight) || 0;
  const toWorld = (p) => geoToWorldPoint(p.lat, p.lng, td, d.squareSize, 0);
  const polylineLength = (pts) => {
    let L = 0;
    for (let i = 1; i < pts.length; i++) L += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
    return L;
  };
  const shapeName = (o) => String(o?.shapeName || o?.class || 'n/a').split('/').pop();

  // ── Environment ────────────────────────────────────────────────────────────
  section('Environment');
  lines.push(`- MapNG build: ${typeof __BUILD_HASH__ !== 'undefined' ? __BUILD_HASH__ : 'n/a'} (${typeof __BUILD_TIME__ !== 'undefined' ? __BUILD_TIME__ : 'n/a'})`);
  const nav = typeof navigator !== 'undefined' ? navigator : null;
  lines.push(`- Browser: ${nav?.userAgent ?? 'n/a'}`);
  lines.push(`- CPU threads: ${nav?.hardwareConcurrency ?? 'n/a'}, device memory: ${nav?.deviceMemory ? `${nav.deviceMemory} GB` : 'n/a'}`);
  const mem = typeof performance !== 'undefined' ? performance.memory : null;
  lines.push(`- JS heap at report time: ${mem ? `${formatBytes(mem.usedJSHeapSize)} used of ${formatBytes(mem.jsHeapSizeLimit)} limit` : 'n/a'}`);
  lines.push(`- Disk streaming for the ZIP (OPFS): ${typeof nav?.storage?.getDirectory === 'function' ? 'available' : 'unavailable (in-memory ZIP)'}`);

  // ── Roads ──────────────────────────────────────────────────────────────────
  section('Roads');
  const roadFeatures = (td?.osmFeatures || []).filter((f) => f.type === 'road' && f.geometry?.length > 1);
  const byClass = new Map();
  for (const f of roadFeatures) {
    const k = f.tags?.highway || 'n/a';
    const e = byClass.get(k) || { n: 0, m: 0, bridges: 0, tunnels: 0 };
    e.n++;
    e.m += polylineLength(f.geometry.map(toWorld));
    if (f.tags?.bridge && f.tags.bridge !== 'no') e.bridges++;
    if (f.tags?.tunnel && f.tags.tunnel !== 'no') e.tunnels++;
    byClass.set(k, e);
  }
  lines.push(`- OSM road ways in the map: ${roadFeatures.length}`);
  for (const [k, e] of [...byClass.entries()].sort((a, b) => b[1].m - a[1].m)) {
    lines.push(`  - ${k}: ${e.n} ways, ${formatNumber(e.m / 1000, 2)} km${e.bridges ? `, ${e.bridges} bridge` : ''}${e.tunnels ? `, ${e.tunnels} tunnel` : ''}`);
  }
  // generateDecalRoads returns one SimGroup per road name (and one for the
  // junction markings) with the DecalRoads inside
  const groups = d.decalRoads || [];
  const decals = [];
  const collect = (items) => {
    for (const it of items || []) {
      if (it?.class === 'DecalRoad') decals.push(it);
      else if (Array.isArray(it?.__items)) collect(it.__items);
    }
  };
  collect(groups);
  lines.push(`- Road groups (one per road name): ${groups.length}`);
  lines.push(`- DecalRoad objects: ${decals.length} (drivable, in the AI road graph: ${decals.filter((r) => Number(r.drivability) > 0).length})`);
  lines.push(`- DecalRoad nodes: ${decals.reduce((n, r) => n + (r.nodes?.length || 0), 0)}`);
  lines.push('- DecalRoads by material:');
  listCounts(countBy(decals, (r) => r.material));
  lines.push(`- Carriageways (paint cut / sidewalk input): ${(groups.carriageways || []).length}`);
  lines.push(`- Crosswalk zones: ${(groups.crosswalkZones || []).length}`);
  lines.push(`- Pedestrian streets drawn (highway=pedestrian, no traffic): ${(groups.pedestrianStreets || []).length} piece(s)`);
  lines.push('- Stone and brick paving (surface=sett/cobblestone/unhewn_cobblestone/paving_stones/bricks) is laid in strips about one texture tile wide: mapng_road_* materials, art/roads/main.materials.json.');

  // ── Bridges ────────────────────────────────────────────────────────────────
  section('Bridges');
  const bridges = d.bridges;
  const decks = bridges?.decks || [];
  const partInfo = bridges?.partInfo || [];
  lines.push(`- Bridge decks: ${decks.length}, approach embankments built: ${bridges?.ramps ?? 0}`);
  lines.push(`- Decks carried on along their approach roads to climb what they cross (walled ramps): ${bridges?.carried ?? 0}`);
  lines.push(`- Roads sunk into a cutting under a deck that could not clear them: ${bridges?.sunk ?? 0}`);
  lines.push(`- Overpasses baked into the elevation, cut out under the deck: ${(bridges?.humps || []).length}${(bridges?.humps || []).length ? ` (the ground stood ${(bridges.humps).map((h) => `${formatNumber(h.lift, 1)} m`).join(', ')} over the roads under them)` : ''}`);
  lines.push('- Heights are absolute (m above sea level); "ground" is the exported terrain under the point.');
  lines.push('- An abutment far from its ground means the deck meets its road above/below the terrain: look there first.');
  const daeByKey = new Map((d.bridgeDaes || []).map((b) => [b.key, b]));
  decks.forEach((deck, i) => {
    const key = `b${String(i + 1).padStart(3, '0')}`;
    const infos = deck.parts.map((p) => partInfo[p.index] || {});
    const named = infos.filter((x) => !x.landing);
    const names = [...new Set(named.map((x) => `${x.name || 'unnamed'} [${x.highway || '?'}]`))].join(', ') || 'n/a';
    const ways = [...new Set(named.map((x) => String(x.id ?? '?').replace(/_seg_\d+$/, '')))].join(', ');
    const landings = infos.filter((x) => x.landing).length;
    const carriedOn = infos.filter((x) => x.carried).length;
    const length = deck.parts.reduce((n, p) => n + polylineLength(p.xy), 0);
    let maxGap = -Infinity; let minGap = Infinity; let sumGap = 0; let nGap = 0;
    for (const p of deck.parts) {
      p.xy.forEach(([x, y], k) => {
        const g = d.groundAtWorld(x, y);
        const gap = p.z[k] - g;
        maxGap = Math.max(maxGap, gap); minGap = Math.min(minGap, gap); sumGap += gap; nGap++;
      });
    }
    const minRoadGap = Math.min(...deck.parts.map((p) => p.minGap ?? Infinity));
    const structure = [...new Set(infos.map((x) => x.structure).filter(Boolean))].join(', ') || 'beam (default)';
    const dae = daeByKey.get(key);
    lines.push('');
    lines.push(`Bridge ${key}: ${names}`);
    lines.push(`  - OSM way(s): ${ways || 'n/a'}${landings ? `; ${landings} part(s) carried on over the approach road (lidar gap)` : ''}${carriedOn ? `; ${carriedOn} part(s) carried on along the approach to climb (walled ramp)` : ''}`);
    lines.push(`  - Length ${formatNumber(length, 1)} m in ${deck.parts.length} part(s), width ${formatNumber(2 * Math.max(...deck.parts.map((p) => p.half)), 1)} m, structure ${structure}, depth ${formatNumber(Math.max(...deck.parts.map((p) => p.depth ?? 0)), 2)} m, layer ${deck.layer ?? 'n/a'}`);
    lines.push(`  - Crosses: ${deck.crossed?.roads ?? 'n/a'} road(s), ${deck.crossed?.water ?? 'n/a'} water run(s)${deck.crossed?.nav ? `, ship channel clearance ${deck.crossed.nav} m` : ''}`);
    (deck.abutments || []).forEach(([ax, ay], j) => {
      let z = null;
      for (const p of deck.parts) {
        for (const k of [0, p.xy.length - 1]) if (Math.hypot(p.xy[k][0] - ax, p.xy[k][1] - ay) < 0.6) z = p.z[k];
      }
      const g = d.groundAtWorld(ax, ay);
      const fit = typeof bridges.endHeight === 'function' ? bridges.endHeight(ax, ay) : null;
      lines.push(`  - Abutment ${j + 1} at (${formatNumber(ax, 1)}, ${formatNumber(ay, 1)}): deck ${formatNumber((z ?? NaN) + minH, 2)} m, ground ${formatNumber(g + minH, 2)} m (${z == null ? 'n/a' : `${z - g >= 0 ? '+' : ''}${formatNumber(z - g, 2)} m`}), approach road fit ${fit == null ? 'n/a' : `${formatNumber(fit + minH, 2)} m`}`);
    });
    lines.push(`  - Deck over ground: max ${formatNumber(maxGap, 2)} m, mean ${formatNumber(sumGap / Math.max(1, nGap), 2)} m, min ${formatNumber(minGap, 2)} m`);
    lines.push(`  - Lowest clearance over a crossed road: ${Number.isFinite(minRoadGap) ? `${formatNumber(minRoadGap, 2)} m` : 'n/a'}; clearance shortfall over roads: ${formatNumber(deck.roadShortfall ?? 0, 2)} m, overall (water too): ${formatNumber(deck.shortfall ?? 0, 2)} m`);
    lines.push(`  - Objects: bridge_${key}.dae + bridge_${key}_deck.dae (the road surface)${dae ? `, ${Math.round(dae.triangles)} triangles, origin (${dae.origin.map((v) => formatNumber(v, 1)).join(', ')})` : ' (not written: no geometry)'}`);
  });

  // ── Tunnels ────────────────────────────────────────────────────────────────
  section('Tunnels');
  const tun = d.tunnels;
  const bored = tun?.tunnels || [];
  const left = tun?.skipped || [];
  lines.push(`- Tunnels built: ${bored.length} (${bored.filter((t) => t.kind === 'cutcover').length} cut and cover, ${bored.filter((t) => t.kind === 'gallery').length} galleries); tunnel=yes roads left on the ground: ${left.length}; portal hole squares: ${(tun?.holes || []).length}`);
  lines.push('- Only drivable tunnel=yes roads are bored (building passages, culverts, galleries and covered ways stay as they were).');
  lines.push('- A bored tunnel needs the ground over its road by the tube height + 1.5 m along most of it; short dips are filled over the tube.');
  lines.push('- One mapped under flat ground (a city deck, an underpass) is cut and cover: a box 0.8 m under the street, its approaches in trenches.');
  lines.push('- On a hillside without the rock over it (and tunnel=avalanche_protector) a gallery: a roof on an uphill wall and valley-side columns, the road where it is.');
  lines.push('- Ramps joining inside a tunnel share its bore: it widens on their side to the portal; past the shared cutting they climb out in their own trench.');
  if (bored.length) lines.push(`- Ceiling lights every ${formatNumber(d.tunnelLightSpacing ?? 8, 1)} m (every 4 m within 30 m of a portal), on day and night`);
  const describe = (osm) => [...new Set((osm || []).map((o) => `${o.name || 'unnamed'} [${o.highway || '?'}]`))].join(', ') || 'n/a';
  const ways = (osm) => [...new Set((osm || []).map((o) => String(o.id ?? '?').replace(/_seg_\d+$/, '')))].join(', ');
  const tunnelDaesByTunnel = new Map();
  for (const dae of d.tunnelDaes || []) {
    if (!tunnelDaesByTunnel.has(dae.tunnel)) tunnelDaesByTunnel.set(dae.tunnel, []);
    tunnelDaesByTunnel.get(dae.tunnel).push(dae);
  }
  for (const t of bored) {
    const a = t.line[t.iS]; const b = t.line[t.iN];
    let minCover = Infinity; let maxCover = -Infinity;
    for (let i = t.iS; i <= t.iN; i++) {
      const c = t.line[i].g - t.line[i].z;
      minCover = Math.min(minCover, c); maxCover = Math.max(maxCover, c);
    }
    const daes = tunnelDaesByTunnel.get(t.key) || [];
    lines.push('');
    lines.push(`Tunnel ${t.key}: ${describe(t.osm)}`);
    lines.push(`  - OSM way(s): ${ways(t.osm) || 'n/a'}`);
    lines.push(`  - ${t.kind === 'cutcover' ? 'Cut-and-cover box' : t.kind === 'gallery' ? `Gallery (roof on a wall ${t.uphill > 0 ? 'right' : 'left'}, columns on the valley side)` : 'Bore'} ${formatNumber(t.tubeLength, 1)} m of ${formatNumber(t.length, 1)} m mapped; inside width ${formatNumber(2 * t.W, 1)} m${t.maxExtra > 0 ? ` (up to ${formatNumber(2 * t.W + t.maxExtra, 1)} m where ramps join)` : ''}, crown ${formatNumber(t.crown, 2)} m over the road`);
    for (const br of t.branches || []) lines.push(`  - Ramp ${describe(br.osm)}: in the bore and its cutting for ${formatNumber(br.absorbed, 0)} m${br.trench > 0 ? `, then its own trench ${formatNumber(br.trench, 0)} m` : ''}`);
    const kind = { cut: 'cutting + wingwalls', bridge: 'meets a bridge', edge: 'map edge, no portal' };
    lines.push(`  - Portal A (${kind[t.portalKind[0]]}) at (${formatNumber(a.x, 1)}, ${formatNumber(a.y, 1)}) road ${formatNumber(a.z + minH, 2)} m; portal B (${kind[t.portalKind[1]]}) at (${formatNumber(b.x, 1)}, ${formatNumber(b.y, 1)}) road ${formatNumber(b.z + minH, 2)} m`);
    lines.push(`  - Ground over the road (before grading): ${formatNumber(minCover, 1)} to ${formatNumber(maxCover, 1)} m`);
    for (const dip of t.dips || []) lines.push(`  - Dip in the cover ${formatNumber(dip.length, 0)} m long at ${formatNumber(dip.s - t.line[t.iS].s, 0)} m in: filled up to ${formatNumber(dip.depth, 1)} m over the tube`);
    for (const [s0, s1] of t.exposed || []) lines.push(`  - Exposed tube ${formatNumber(s1 - s0, 0)} m (thin cover where it meets a bridge; terrain opened, not filled)`);
    if (t.windows?.length) lines.push(`  - Gallery windows: ${t.windows.length} (the cliff face close beside the bore), at ${t.windows.map((w) => `${formatNumber(w.s - t.line[t.iS].s, 0)} m (${w.side > 0 ? 'right' : 'left'}, ${formatNumber(w.face - t.W - LINING_M, 1)} m of rock)`).join(', ')}`);
    lines.push(`  - Terrain: ${t.gradedPixels ?? 0} grid points graded (cuttings, headwall backfill, cover), ${t.holes ?? 0} square(s) opened at the portals`);
    lines.push(`  - Lights: ${t.lights ?? 0}, zones: ${t.zones ?? 0}`);
    lines.push(`  - Objects: ${daes.map((x) => `tunnel_${x.key}.dae (${Math.round(x.triangles)} tris)`).join(', ') || 'none'}`);
  }
  if (left.length) {
    lines.push('');
    lines.push('Left on the ground (drawn over the terrain as before):');
    for (const k of left) lines.push(`  - ${describe(k.osm)} (way ${ways(k.osm) || 'n/a'}, ${formatNumber(k.length ?? 0, 0)} m): ${k.reason}`);
  }

  // ── Buildings ──────────────────────────────────────────────────────────────
  section('Buildings');
  const br = d.buildingReport || {};
  const st = br.stats;
  if (!st) {
    lines.push('- No buildings exported (none in the map, or buildings off).');
  } else {
    lines.push(`- OSM building footprints: ${st.footprints}, built: ${br.built}`);
    lines.push(`- Skipped: invalid geometry ${st.skipped.badGeometry}, under 4 m² ${st.skipped.tiny}, over 50,000 m² (non-industrial) ${st.skipped.oversize}, no terrain under them ${st.skipped.noGround}, over the building cap ${st.skipped.overCap}`);
    lines.push(`- Meshes: ${br.meshes}, triangles: ${Math.round(br.triangles)}, collision: one mesh of every wall and roof`);
    const avg = (a) => (br.built ? a.sum / br.built : NaN);
    lines.push(`- Floors: min ${br.built ? st.floors.min : 'n/a'}, mean ${formatNumber(avg(st.floors), 1)}, max ${st.floors.max}`);
    lines.push(`- Eave height: min ${br.built ? formatNumber(st.height.min, 1) : 'n/a'} m, mean ${formatNumber(avg(st.height), 1)} m, max ${formatNumber(st.height.max, 1)} m`);
    lines.push(`- On sloping ground: ${st.groundSpread.over3m} footprint(s) span more than 3 m of terrain (max ${formatNumber(st.groundSpread.max, 1)} m; their plinth reaches the lowest corner)`);
    lines.push(`- Shop fronts: ${st.shopFronts}, offices: ${st.offices}, courtyards (inner rings): ${st.withHoles}`);
    const sorted = (o) => Object.entries(o).sort((a, b) => b[1] - a[1]);
    lines.push('- Kinds:'); listCounts(sorted(st.kinds));
    lines.push('- OSM building=* classes:'); listCounts(sorted(st.classes), 30);
    lines.push('- Roofs:'); listCounts(sorted(st.roofs));
    lines.push('- Wall materials:'); listCounts(sorted(st.walls));
  }

  // ── Sidewalks and street furniture ─────────────────────────────────────────
  section('Sidewalks and Street Furniture');
  const sw = d.sidewalks || {};
  lines.push(`- Sidewalk curb runs: ${(sw.runs || []).length}, meshes: ${(sw.meshes || []).length}, triangles (with medians): ${sw.triangles ?? 0}`);
  const medianRuns = sw.medianRuns || [];
  const medianM = medianRuns.reduce((n, r) => n + polylineLength(r.points), 0);
  lines.push(`- Divided-road medians: ${medianRuns.length} island run(s), ${formatNumber(medianM / 1000, 2)} km of curb, on ${new Set(medianRuns.map((r) => r.owner)).size} carriageway(s)`);
  const sp = d.streetProps || {};
  const mp = d.mappedStreetProps || {};
  lines.push(`- Street props placed: ${(sp.hydrants || []).length} hydrants, ${(sp.bins || []).length} bins, ${(sp.benches || []).length} benches, ${(sp.poles || []).length} utility poles, ${(sp.wires || []).length} power line spans`);
  lines.push(`- Mapped in OSM: ${(mp.hydrants || []).length} hydrants, ${(mp.bins || []).length} bins`);
  const sig = d.signalData || {};
  lines.push(`- Traffic signals: ${(sig.instances || []).length} signal instances, ${(sig.controllers || []).length} controllers, ${(sig.sequences || []).length} sequences, ${(d.trafficSignalObjects || []).length} signal objects`);
  lines.push(`- Road signs: ${(d.signObjects || []).length}`);
  listCounts(countBy(d.signObjects || [], (o) => String(o.name || '').replace(/^sign_/, '').replace(/_\d+$/, '')));
  lines.push(`- Barriers / fences: ${(d.barrierObjects || []).length}`);
  listCounts(countBy(d.barrierObjects || [], shapeName), 15);
  lines.push(`- Lamps, benches and other furniture: ${(d.streetFurnitureObjects || []).length}`);
  listCounts(countBy(d.streetFurnitureObjects || [], shapeName), 15);
  lines.push(`- Fuel / charging station objects: ${(d.fuelStationObjects || []).length}`);
  const bp = d.bollardPlacement;
  if (bp) lines.push(`- Bollards (OSM barrier=bollard): ${bp.bollards.length} placed (${bp.bollards.filter((b) => b.material === 'concrete').length} concrete), ${bp.skipped.onRoad} on drawn roads left out, ${bp.skipped.blocked} under bridges`);
  const cv = d.curveWarnings;
  if (cv) lines.push(`- Curve warnings from road geometry: ${cv.props.length} signs${cv.props.length ? ` (${Object.entries(cv.counts).map(([k, v]) => `${v} ${k}`).join(', ')})` : ''}`);
  const cm = d.calming || {};
  lines.push(`- Traffic calming placed: ${Object.entries(cm.counts || {}).map(([k, v]) => `${v} ${k}`).join(', ') || 'none'} (${(d.trafficCalmingObjects || []).length} objects, ${(cm.chevrons || []).length} chevron decals, ${(cm.signs || []).length} warning signs)`);
  if (cm.skipped && Object.values(cm.skipped).some(Boolean)) {
    lines.push(`- Traffic calming skipped: ${cm.skipped.offRoad || 0} not on a drawn or service road, ${cm.skipped.unsupported || 0} of other kinds (dips, islands, chokers...)`);
  }

  // ── Vegetation ─────────────────────────────────────────────────────────────
  section('Vegetation');
  const forest = [...(d.forestPlacements || new Map()).entries()].map(([type, list]) => [type, list.length]).sort((a, b) => b[1] - a[1]);
  lines.push(`- Forest item types: ${forest.length}, placements: ${forest.reduce((n, [, c]) => n + c, 0)}`);
  listCounts(forest, 60);
  lines.push(`- Ground cover objects: ${(d.groundCoverObjects || []).length}`);
  for (const g of d.groundCoverObjects || []) lines.push(`  - ${g.name || 'n/a'} (material ${g.material || 'n/a'})`);

  // ── Water ──────────────────────────────────────────────────────────────────
  section('Water');
  lines.push(`- Water objects: ${(d.waterObjects || []).length}`);
  listCounts(countBy(d.waterObjects || [], (o) => o.class));
  const ws = d.waterObjects?.stats;
  if (ws?.sea?.blocks != null) lines.push(`- Sea: ${ws.sea.blocks} WaterBlocks in place of the sea-level plane (a tunnel reaches under sea level: no water in its trenches, none deeper than its roof over the tube)`);
  if (ws?.lakes?.clippedOverTunnels) lines.push(`- Lake tiles held over a tunnel's roof: ${ws.lakes.clippedOverTunnels}`);
  if (ws?.rivers?.nodesClippedOverTunnels) lines.push(`- River nodes held over a tunnel's roof (or left out over its trench): ${ws.rivers.nodesClippedOverTunnels}`);

  // ── Terrain materials ──────────────────────────────────────────────────────
  section('Terrain Materials');
  const names = d.pbrResult?.materialNames || ['DefaultMaterial'];
  const layerMap = d.pbrResult?.layerMap;
  if (layerMap?.length) {
    const counts = new Float64Array(256);
    for (let i = 0; i < layerMap.length; i++) counts[layerMap[i]]++;
    names.forEach((n, i) => lines.push(`  - ${i}: ${n} — ${formatNumber((counts[i] / layerMap.length) * 100, 2)}% of the terrain`));
  } else {
    names.forEach((n, i) => lines.push(`  - ${i}: ${n}`));
  }

  // ── Console ────────────────────────────────────────────────────────────────
  section('Job Console Log');
  const log = d.jobLog;
  if (!log) {
    lines.push('- n/a');
  } else {
    lines.push(`- ${log.lines.length} line(s) from the start of the export to this report (ZIP compression follows it)${log.dropped ? `; ${log.dropped} later line(s) dropped over the ${JOB_LOG_MAX_LINES}-line cap` : ''}.`);
    lines.push('');
    for (const line of log.lines) lines.push(line);
  }
  return lines;
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
  decalRoadCount,
  forestPlacements,
  forestFiles,
  groundCoverObjects,
  osmDaeBlob,
  backdropDaeBlob,
  backdropTextureFiles,
  backdropDiagnostics,
  mapngFlagFiles,
  didCropToSquare,
  detail = null,
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
    `- DecalRoad groups (one per road name; DecalRoads under Roads below): ${decalRoadCount}`,
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
  reportLines.push('- duration, share of the time so far, and where the progress bar stood when the step began');
  const timelineTotalMs = processingLog.reduce((sum, entry) => sum + (entry.durationMs || 0), 0);
  for (const entry of processingLog) {
    const share = timelineTotalMs > 0 ? `${formatNumber((entry.durationMs / timelineTotalMs) * 100, 1)}%` : 'n/a';
    reportLines.push(`- ${entry.step}: ${formatDurationMs(entry.durationMs)} (${share} of the time; bar at ${entry.pct}%)`);
  }

  if (originalTerrainData?.osmRequestInfo) {
    reportLines.push('');
    reportLines.push('OSM Request Metadata');
    for (const [key, value] of Object.entries(originalTerrainData.osmRequestInfo)) {
      reportLines.push(`- ${key}: ${typeof value === 'object' ? JSON.stringify(value) : String(value)}`);
    }
  }

  if (detail) reportLines.push(...buildDetailedReportSections({ terrainData, squareSize, worldSize, ...detail }));

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
/** Mean terrain height (m) from a strided sample of the heightmap, or null. */
function sampleMeanHeight(terrainData) {
  const hm = terrainData?.heightMap;
  if (!hm?.length) return null;
  const stride = Math.max(1, Math.floor(hm.length / 65536));
  let sum = 0;
  let n = 0;
  for (let i = 0; i < hm.length; i += stride) {
    const h = hm[i];
    if (Number.isFinite(h) && h > -32760) { sum += h; n++; }
  }
  return n ? sum / n : null;
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

/**
 * A barrier panel's rotation: its run heading `yaw` tilted up by `pitch`
 * (radians) to follow the ground, the mesh turned by `assetYaw` within that
 * run (a mesh laid along its local Y). Rows are the local axes in world space,
 * as rotationMatrixFromYaw's; West Coast USA tilts its guardrails so.
 */
function rotationMatrixFromYawPitch(yaw, pitch, assetYaw = 0) {
  const cy = Math.cos(yaw); const sy = Math.sin(yaw);
  const cp = Math.cos(pitch); const sp = Math.sin(pitch);
  const run = [cp * cy, cp * sy, sp];
  const left = [-sy, cy, 0];
  const up = [-sp * cy, -sp * sy, cp];
  const co = Math.cos(assetYaw); const so = Math.sin(assetYaw);
  const x = run.map((v, i) => co * v + so * left[i]);
  const y = run.map((v, i) => -so * v + co * left[i]);
  return [...x, ...y, ...up].map((v) => roundTo(v, 6));
}

// steepest a barrier panel is tilted (past it, a cliff: it steps instead)
const BARRIER_MAX_PITCH = Math.PI / 5;

const NATIVE_BARRIER_ASSETS = {
  guardrail: {
    shapeName: '/levels/west_coast_usa/art/shapes/objects/guardrail1.dae',
    postShapeName: '/levels/west_coast_usa/art/shapes/objects/guardrailpost.dae',
    endShapeName: '/levels/west_coast_usa/art/shapes/objects/guardrail_end.dae',
    // the rail runs along its local X, 2.4 m (West Coast USA lays them so,
    // 1.97 m apart: at +90° every panel stood across the road)
    segmentLength: 2,
    // the beam is centred on the rail's origin with its support reaching
    // 0.91 m below, the post stands from its origin 1.1 m: West Coast USA's
    // rails sit 0.96 m over their posts (at 0.15 the beam lay on the ground)
    zOffset: 0.93,
    postZOffset: 0,
    endZOffset: 0.93,
    yawOffset: 0,
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
  // walls (beamngPropLibrary BARRIER_SHAPES): along local X, the pieces a
  // little shorter than the mesh so they overlap
  stoneWall: { shapeName: BARRIER_SHAPES.stoneWall.shapeFile, segmentLength: 3, zOffset: 0, yawOffset: 0 },
  concreteWall: { shapeName: BARRIER_SHAPES.concreteWall.shapeFile, segmentLength: 3.1, zOffset: 0, yawOffset: 0 },
  dryStoneWall: { shapeName: BARRIER_SHAPES.dryStoneWall.shapeFile, segmentLength: 6, zOffset: 0, yawOffset: 0 },
  // a retaining wall holds the ground up: the concrete wall (1 m over its
  // origin, 2 m under) stretched from the low side's ground to just over the
  // high side's (highway retaining walls stood as 1 m stone garden walls at
  // the foot of their fill)
  retainingWall: { shapeName: BARRIER_SHAPES.concreteWall.shapeFile, segmentLength: 3.1, zOffset: 0, yawOffset: 0, retaining: { above: 1, below: 2 } },
  brickWall: { shapeName: BARRIER_SHAPES.brickWall.shapeFile, segmentLength: 3.5, zOffset: 0, yawOffset: 0 },
  // the harbour railing runs along local -Y from its origin at one end
  // (+90° turns -Y onto the run): placed from each piece's start
  railing: { shapeName: BARRIER_SHAPES.railing.shapeFile, segmentLength: 3, zOffset: 0, yawOffset: Math.PI * 0.5, fromStart: true },
};

// Every outdoor level gets one CloudLayer (Sky-and-Weather.md). The 0.39+
// volumetric clouds read only coverage / windSpeed / windDirection /
// altitudeKm; the legacy Textures/baseColor/exposure/texture fields are kept as
// vanilla still saves them. The texture is the engine's global one
// (gameengine.zip art/skies), not another level's.
function buildCloudObjects(biome) {
  const overcast = biome?.levelName === 'east_coast_usa';
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
    baseColor: [0.996078014, 0.996078014, 0.996078014, overcast ? 0.996078014 : 0.322],
    // East Coast's own sky is heavily clouded; elsewhere West Coast USA's
    // light cirrocumulus, which leaves coverage at the engine default.
    ...(overcast ? { coverage: 1.2 } : {}),
    exposure: overcast ? 1.29999995 : 1.45,
    altitudeKm: overcast ? 3 : 1.4,
    windSpeed: overcast ? 0.2 : 0.1,
    windDirection: [1, 0],
    texture: 'art/skies/clouds/clouds_normal_displacement.png',
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

  if (barrierType === 'guard_rail' || barrierType === 'guardrail') {
    return NATIVE_BARRIER_ASSETS.guardrail;
  }

  // railings and chains: no post-and-chain mesh ships, a harbour railing is
  // the nearest (St. Augustine's seawall chains had been white picket fences)
  if (barrierType === 'handrail' || barrierType === 'railing' || barrierType === 'chain') {
    return NATIVE_BARRIER_ASSETS.railing;
  }

  // walls as walls, by what they are made of (stone unless OSM says otherwise)
  if (barrierType === 'wall' || barrierType === 'city_wall' || barrierType === 'retaining_wall') {
    const wallKind = String(tags.wall ?? '').trim().toLowerCase();
    const height = Number.parseFloat(tags.height);
    if (wallKind === 'dry_stone' || wallKind === 'gabion') return NATIVE_BARRIER_ASSETS.dryStoneWall;
    if (material === 'concrete' || material === 'reinforced_concrete' || wallKind === 'noise_barrier' || wallKind === 'jersey_barrier') {
      return NATIVE_BARRIER_ASSETS.concreteWall;
    }
    if (material === 'brick' && Number.isFinite(height) && height >= 2) return NATIVE_BARRIER_ASSETS.brickWall;
    // (retaining walls are concrete unless mapped as stone or brick)
    if (barrierType === 'retaining_wall' && !['stone', 'brick', 'sandstone', 'limestone', 'granite'].includes(material)) {
      return NATIVE_BARRIER_ASSETS.retainingWall;
    }
    return NATIVE_BARRIER_ASSETS.stoneWall;
  }

  if (
    barrierType === 'jersey_barrier'
    || barrierType === 'concrete_barrier'
  ) {
    return NATIVE_BARRIER_ASSETS.concrete;
  }

  if (
    barrierType === 'fence'
    || barrierType === 'block'
    || barrierType === 'cable_barrier'
    || barrierType === 'wire_fence'
    || barrierType === 'gate'
  ) {
    // What OSM says about the fence first; untagged fences take the region's
    // default (wooden in temperate places, chain-link elsewhere).
    const fenceType = String(tags.fence_type ?? '').trim().toLowerCase();
    if (['wood', 'picket', 'board', 'split_rail', 'paling'].includes(fenceType) || material === 'wood') {
      return NATIVE_BARRIER_ASSETS.fence;
    }
    if (['chain_link', 'metal', 'wire', 'mesh'].includes(fenceType) || ['metal', 'steel', 'wire'].includes(material)) {
      return NATIVE_BARRIER_ASSETS.chainLinkFence;
    }
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
const RETAINING_TOP_M = 0.3;    // a retaining wall stands this far over the ground it holds
const RETAINING_FOOT_M = 0.5;   // ... and reaches this far under the ground at its foot

function buildNativeBarrierObjects(terrainData, squareSize, biome = null, { skipAt = () => false, skipLineAt = () => false } = {}) {
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
    // not across a drawn road, in a tunnel's cutting or under a deck (a fence
    // OSM maps along an overpass stood in the trench under it)
    if (skipAt(world[0], world[1], world[2])) return;
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
      // in metres, not degrees (a degree of longitude is shorter: diagonal
      // runs were skewed by several degrees)
      const wa = geoToWorldPoint(a.lat, a.lng, terrainData, squareSize, 0);
      const wb = geoToWorldPoint(b.lat, b.lng, terrainData, squareSize, 0);
      const yaw = Math.atan2(wb[1] - wa[1], wb[0] - wa[0]);
      return {
        lat,
        lng,
        x: world[0],
        y: world[1],
        terrainZ: getTerrainHeightWorld(lat, lng, terrainData),
        yaw,
      };
    };

    // the ground at every joint, smoothed along the run (a median, then a
    // mean, of each and its neighbours): on graded ground stepping by the
    // metre the panels zig-zagged by ±20°
    const jointCount = isClosedRing(geometry) ? panelCount : panelCount + 1;
    const rawJointZ = Array.from({ length: panelCount + 1 }, (_, i) => sampleAtDistance(i * panelSpacing).terrainZ);
    const at3 = (arr, i) => [arr[Math.max(0, i - 1)], arr[i], arr[Math.min(arr.length - 1, i + 1)]];
    const median3 = rawJointZ.map((_, i) => at3(rawJointZ, i).sort((a, b) => a - b)[1]);
    const jointZ = median3.map((_, i) => (i === 0 || i === median3.length - 1 ? median3[i] : at3(median3, i).reduce((a, b) => a + b, 0) / 3));
    // a retaining wall's top follows the ground it holds (the high side), its
    // foot the low side's: per joint, the top smoothed like the ground
    let retainTop = null; let retainLow = null;
    if (asset.retaining) {
      const sides = Array.from({ length: panelCount + 1 }, (_, i) => {
        const j = sampleAtDistance(i * panelSpacing);
        const nx = -Math.sin(j.yaw); const ny = Math.cos(j.yaw);
        const side = (sign) => Math.min(...[1.5, 2.5, 3.5].map((d) => getTerrainHeightAtWorldXY(j.x + sign * nx * d, j.y + sign * ny * d, terrainData, squareSize)));
        const a = side(1); const b = side(-1);
        return [Math.min(a, b), Math.max(Math.max(a, b) + RETAINING_TOP_M, Math.min(a, b) + asset.retaining.above)];
      });
      retainLow = sides.map(([low]) => low);
      const rawTop = sides.map(([, top]) => top);
      const m3 = rawTop.map((_, i) => at3(rawTop, i).sort((a, b) => a - b)[1]);
      retainTop = m3.map((_, i) => (i === 0 || i === m3.length - 1 ? m3[i] : at3(m3, i).reduce((a, b) => a + b, 0) / 3));
    }

    for (let i = 0; i < panelCount; i++) {
      if (objects.length >= MAX_NATIVE_BARRIER_OBJECTS) return;
      const centerSample = sampleAtDistance((i + 0.5) * panelSpacing);
      // tilted along the run to the (smoothed) ground between its ends (a
      // retaining wall: to its top)
      const rise = retainTop ? retainTop[i + 1] - retainTop[i] : jointZ[i + 1] - jointZ[i];
      const pitch = Math.max(-BARRIER_MAX_PITCH, Math.min(BARRIER_MAX_PITCH, Math.atan2(rise, panelSpacing)));
      const panelTerrainZ = (jointZ[i] + jointZ[i + 1]) / 2;
      if (skipLineAt(centerSample.x, centerSample.y, panelTerrainZ, centerSample.yaw)) continue;
      // (a mesh with its origin at one end goes at the piece's start)
      const at = asset.fromStart ? { ...sampleAtDistance(i * panelSpacing), z: jointZ[i] } : { ...centerSample, z: panelTerrainZ };
      // not on a drawn road or under a deck (OSM's line, or the road's width,
      // put walls and fences across lanes where they meet)
      if (skipAt(at.x, at.y, at.z)) continue;
      let scaleZ = 1;
      if (retainTop) {
        // base under the low side's ground (the tilt lowers one end's foot
        // by half the rise), top on the line through the joints' tops
        const { above, below } = asset.retaining;
        const top = (retainTop[i] + retainTop[i + 1]) / 2;
        const foot = Math.min(retainLow[i], retainLow[i + 1]) - RETAINING_FOOT_M - Math.abs(rise) / 2;
        scaleZ = Math.max(1, (top - foot) / (above + below));
        at.z = top - above * scaleZ;
      }
      objects.push({
        __parent: 'Barriers',
        class: 'TSStatic',
        name: `${namePrefix}_${i + 1}`,
        persistentId: generatePersistentId(),
        position: [
          roundTo(at.x, 3),
          roundTo(at.y, 3),
          roundTo(at.z + (Number.isFinite(asset.zOffset) ? asset.zOffset : 0), 3),
        ],
        rotationMatrix: rotationMatrixFromYawPitch(centerSample.yaw, pitch, Number.isFinite(asset.yawOffset) ? asset.yawOffset : 0),
        ...(scaleZ !== 1 ? { scale: [1, 1, roundTo(scaleZ, 3)] } : {}),
        shapeName: asset.shapeName,
        useInstanceRenderData: true,
      });
    }

    if (asset.postShapeName) {
      for (let i = 0; i < jointCount; i++) {
        if (objects.length >= MAX_NATIVE_BARRIER_OBJECTS) return;
        const sample = { ...sampleAtDistance(i * panelSpacing), terrainZ: jointZ[i] };
        if (skipLineAt(sample.x, sample.y, sample.terrainZ, sample.yaw)) continue;
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

    const yawFrom = (p, q) => {
      const wp = geoToWorldPoint(p.lat, p.lng, terrainData, squareSize, 0);
      const wq = geoToWorldPoint(q.lat, q.lng, terrainData, squareSize, 0);
      return Math.atan2(wq[1] - wp[1], wq[0] - wp[0]);
    };
    const startYaw = yawFrom(startPt, nextPt);
    const endYaw = yawFrom(prevPt, endPt);
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
      if (!skipLineAt(worldStart[0], worldStart[1], worldStart[2], startYaw)) objects.push({
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
      if (!skipLineAt(worldEnd[0], worldEnd[1], worldEnd[2], endYaw)) objects.push({
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
        best = { dist, cx, cy, tx: dx / len, ty: dy / len, halfWidth: road.halfWidth, highway: road.highway };
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
  const isUrbanRoad = buildUrbanRoadClassifier(terrainData.osmFeatures ?? []);
  for (const feature of terrainData.osmFeatures ?? []) {
    if (feature.type !== 'road' || !Array.isArray(feature.geometry) || feature.geometry.length < 2) continue;
    const highway = feature.tags?.highway;
    if (!highway || ['footway', 'path', 'pedestrian', 'steps', 'cycleway', 'bridleway', 'corridor'].includes(highway)) continue;
    const isOneWay = isOneWayRoad(feature.tags || {});
    // Whole carriageway: signs and furniture stand beyond any parking lane.
    const halfWidth = estimateRoadCrossSection(feature.tags || {}, highway, isOneWay, {
      urban: isUrbanRoad(feature),
    }).carriagewayHalfWidth;
    const pts = feature.geometry
      .filter((p) => Number.isFinite(p?.lat) && Number.isFinite(p?.lng))
      .map((p) => geoToWorldPoint(p.lat, p.lng, terrainData, squareSize, 0));
    if (pts.length >= 2) roads.push({ pts, halfWidth, highway });
  }
  return roads;
}

/**
 * TSStatics for the signal props built in beamngSignals.js: pole_traffic1
 * posts, signal masts (with a night light at their street light) and
 * trafficlight_overhead1 heads. Heads are dynamic and carry
 * `signalInstance`, the field core_trafficSignals uses to light them (the
 * same fields as West Coast USA's signal prefabs).
 */
function buildTrafficSignalObjects(props = []) {
  const objects = [];
  props.forEach((prop, i) => {
    if (prop.kind === 'signal_pole') {
      objects.push({
        __parent: 'traffic_signals',
        class: 'TSStatic',
        name: `signal_pole_${i}`,
        persistentId: generatePersistentId(),
        position: prop.position,
        rotationMatrix: rotationMatrixFromYaw(prop.yaw),
        shapeName: SIGNAL_POLE_SHAPE,
        annotation: 'TRAFFIC_SIGNALS',
        useInstanceRenderData: true,
      });
    } else if (prop.kind === 'signal_mast') {
      objects.push({
        __parent: 'traffic_signals',
        class: 'TSStatic',
        name: `signal_mast_${i}`,
        persistentId: generatePersistentId(),
        position: prop.position,
        rotationMatrix: rotationMatrixFromYaw(prop.yaw),
        shapeName: SIGNAL_MAST.shapeFile,
        annotation: 'TRAFFIC_SIGNALS',
        useInstanceRenderData: true,
      });
      objects.push({
        __parent: 'traffic_signals',
        name: `signal_mast_${i}_light`,
        persistentId: generatePersistentId(),
        position: [
          roundTo(prop.position[0] + Math.cos(prop.yaw) * SIGNAL_MAST.lightForward, 3),
          roundTo(prop.position[1] + Math.sin(prop.yaw) * SIGNAL_MAST.lightForward, 3),
          roundTo(prop.position[2] + SIGNAL_MAST.lightHeight, 3),
        ],
        ...STREET_LAMP_LIGHT_TEMPLATE,
        radius: SIGNAL_MAST.radius,
      });
    } else if (prop.kind === 'signal_head') {
      objects.push({
        __parent: 'traffic_signals',
        class: 'TSStatic',
        name: `signal_head_${i}`,
        persistentId: generatePersistentId(),
        position: prop.position,
        rotationMatrix: rotationMatrixFromYaw(prop.yaw),
        shapeName: SIGNAL_HEAD_SHAPE,
        annotation: 'TRAFFIC_SIGNALS',
        internalName: 'trafficLight',
        dynamic: true,
        useInstanceRenderData: false,
        instanceColor: 'black',
        instanceColor1: 'black',
        instanceColor2: 'black',
        collisionType: 'None',
        decalType: 'None',
        signalInstance: prop.signalInstance,
      });
    }
  });
  return objects;
}

// Street furniture caps. BeamNG QA (Wonly): 25k+ lights per level are fine
// even on Steam Deck; the constraints that matter are no shadow-casting point
// lights and no heavy overlap — hence the min-spacing dedupe below.
const MAX_STREET_LAMPS = 20000;
const MAX_BENCHES = 5000;
const LAMP_MIN_SPACING_M = 2;
const ARTERIAL_LIGHTING = new Set(['motorway', 'trunk', 'primary', 'secondary', 'tertiary']);
// a mapped lamp this far beyond the nearest carriageway's edge lights a path or square
const PATH_LAMP_MIN_M = 8;

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
/**
 * Mapped street props in world space for placeStreetProps: hydrants, bins,
 * benches ([x, y]), standalone poles ([x, y, z]) and low-voltage power lines
 * ([[x, y, z]...]). High-voltage lines (power=line) are left out: their
 * lattice towers have no stock model, and a wooden pole would carry them.
 */
function collectMappedStreetProps(terrainData, squareSize) {
  const out = { hydrants: [], bins: [], benches: [], poles: [], powerLines: [] };
  const toWorld = (p) => {
    const [x, y] = geoToWorldPoint(p.lat, p.lng, terrainData, squareSize, 0);
    return [x, y, getTerrainHeightAtWorldXY(x, y, terrainData, squareSize)];
  };
  for (const f of terrainData.osmFeatures || []) {
    const tags = f.tags || {};
    if (f.type === 'power_line') {
      if (tags.power === 'minor_line' && Array.isArray(f.geometry) && f.geometry.length > 1) {
        out.powerLines.push(f.geometry.map(toWorld));
      }
      continue;
    }
    if (f.type !== 'street_furniture' || f.geometry?.length !== 1) continue;
    const p = toWorld(f.geometry[0]);
    if (tags.emergency === 'fire_hydrant') out.hydrants.push(p);
    else if (tags.amenity === 'waste_basket') out.bins.push(p);
    else if (tags.amenity === 'bench') out.benches.push(p);
    else if (tags.power === 'pole') out.poles.push(p);
  }
  return out;
}

function buildStreetFurnitureObjects(terrainData, squareSize, biome, { carriageways = [], props = null, underDeck = () => false } = {}) {
  const profile = getStreetFurnitureProfile(biome);
  if (!profile) return [];

  const features = terrainData.osmFeatures?.filter((feature) => (
    feature.type === 'street_furniture'
    && Array.isArray(feature.geometry)
    && feature.geometry.length === 1
  )) ?? [];
  if (features.length === 0 && carriageways.length === 0 && !props?.poles.length) return [];

  const roads = projectDrivableRoads(terrainData, squareSize);
  const MAX_ROAD_SEARCH_M = 30;

  const objects = [];
  let lampCount = 0;
  let benchCount = 0;
  const lampCells = new Set();
  const LAMP_LIMIT = MAX_STREET_LAMPS;
  const osmLampSpots = [];
  // Pole + dusk-to-dawn PointLight at the luminaire, arm toward `facing`.
  const addLamp = (posX, posY, facing, name, asset = profile.lamp) => {
    if (!asset?.shapeFile || lampCount >= LAMP_LIMIT) return;
    const z = getTerrainHeightAtWorldXY(posX, posY, terrainData, squareSize);
    if (underDeck(posX, posY, z, z + (asset.lightHeight ?? 6) + 1)) return;
    objects.push({
      __parent: 'street_furniture',
      class: 'TSStatic',
      name,
      persistentId: generatePersistentId(),
      position: [roundTo(posX, 3), roundTo(posY, 3), roundTo(z, 3)],
      rotationMatrix: rotationMatrixFromYaw(facing + (asset.yawOffset ?? 0)),
      shapeName: asset.shapeFile,
      useInstanceRenderData: true,
    });
    const forward = asset.lightForward ?? 0;
    objects.push({
      __parent: 'street_furniture',
      name: `${name}_light`,
      persistentId: generatePersistentId(),
      position: [
        roundTo(posX + Math.cos(facing) * forward, 3),
        roundTo(posY + Math.sin(facing) * forward, 3),
        roundTo(z + (asset.lightHeight ?? 6), 3),
      ],
      ...STREET_LAMP_LIGHT_TEMPLATE,
      ...(asset.radius ? { radius: asset.radius } : {}),
    });
    lampCount++;
  };
  // Which light a road gets: the tall cobra head on arterials, the davit
  // lamppost on town streets (the region's own lamp where it has one), the
  // lantern post where a mapped lamp stands away from any road.
  const streetLamp = profile.lamp?.shapeFile === STREET_LIGHT_SHAPES.path.shapeFile ? STREET_LIGHT_SHAPES.street : profile.lamp;
  const lampFor = (highway) => (ARTERIAL_LIGHTING.has(String(highway ?? '').replace(/_link$/, '')) ? STREET_LIGHT_SHAPES.arterial : streetLamp);
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
    const nearRoad = findNearestRoad(posX, posY, roads, MAX_ROAD_SEARCH_M);
    const dirTag = tags['light:direction'] ?? tags.direction;
    const dirDeg = Number.parseFloat(dirTag);
    if (Number.isFinite(dirDeg)) {
      // OSM: 0 = north (+Y), 90 = east (+X) → math yaw from +X axis.
      facing = ((90 - dirDeg) * Math.PI) / 180;
    } else if (nearRoad) {
      facing = Math.atan2(nearRoad.cy - posY, nearRoad.cx - posX);
    }
    if (facing === null) facing = 0;
    const yaw = facing + (asset.yawOffset ?? 0);

    if (isLamp) {
      const key = cellKey(posX, posY);
      if (lampCells.has(key)) continue;
      lampCells.add(key);
      osmLampSpots.push([posX, posY]);
    }

    if (isLamp) {
      const lampAsset = !nearRoad || nearRoad.dist - (nearRoad.halfWidth ?? 0) > PATH_LAMP_MIN_M ? STREET_LIGHT_SHAPES.path : lampFor(nearRoad.highway);
      addLamp(posX, posY, facing, `street_lamp_${i}`, lampAsset);
      continue;
    }
    const z = getTerrainHeightAtWorldXY(posX, posY, terrainData, squareSize);
    objects.push({
      __parent: 'street_furniture',
      class: 'TSStatic',
      name: `bench_${i}`,
      persistentId: generatePersistentId(),
      position: [roundTo(posX, 3), roundTo(posY, 3), roundTo(z, 3)],
      rotationMatrix: rotationMatrixFromYaw(yaw),
      shapeName: asset.shapeFile,
      useInstanceRenderData: true,
    });
    benchCount++;
  }

  // Lamps along lit streets: OSM maps few street_lamp nodes, so lit roads
  // (lit=yes, or urban main roads without a lit tag) get poles at a steady
  // spacing (BeamNG.Earth plan B3).
  const generatedLamps = generateRoadLamps(carriageways, osmLampSpots, LAMP_LIMIT - lampCount);
  for (let i = 0; i < generatedLamps.length; i++) {
    const lamp = generatedLamps[i];
    addLamp(lamp.x, lamp.y, lamp.facing, `street_lamp_gen_${i}`, lampFor(lamp.highway));
  }

  // Benches along major town streets (streetProps.js), facing the road.
  for (let i = 0; i < (props?.benches.length ?? 0) && benchCount < MAX_BENCHES; i++) {
    const b = props.benches[i];
    if (!profile.bench?.shapeFile) break;
    objects.push({
      __parent: 'street_furniture',
      class: 'TSStatic',
      name: `bench_gen_${i}`,
      persistentId: generatePersistentId(),
      position: [roundTo(b.x, 3), roundTo(b.y, 3), roundTo(b.z, 3)],
      rotationMatrix: rotationMatrixFromYaw(b.yaw + (profile.bench.yawOffset ?? 0)),
      shapeName: profile.bench.shapeFile,
      useInstanceRenderData: true,
    });
    benchCount++;
  }

  // Wooden utility poles (cross-arm along the pole's yaw; the wires are a
  // separate mesh), a cobra-head lamp on every other town pole: its arm
  // reaches along local -x, over the road, with a dusk-to-dawn light at its end.
  let poleLamps = 0;
  for (let i = 0; i < (props?.poles.length ?? 0); i++) {
    const p = props.poles[i];
    objects.push({
      __parent: 'street_furniture',
      class: 'TSStatic',
      name: `utility_pole_${i}`,
      persistentId: generatePersistentId(),
      position: [roundTo(p.x, 3), roundTo(p.y, 3), roundTo(p.z, 3)],
      rotationMatrix: rotationMatrixFromYaw(p.yaw),
      shapeName: PROP_SHAPES.pole.shapeFile,
      useInstanceRenderData: true,
    });
    if (!p.lamp || lampCount >= LAMP_LIMIT) continue;
    objects.push({
      __parent: 'street_furniture',
      class: 'TSStatic',
      name: `pole_lamp_${i}`,
      persistentId: generatePersistentId(),
      position: [roundTo(p.x, 3), roundTo(p.y, 3), roundTo(p.z + POLE_LAMP_Z, 3)],
      rotationMatrix: rotationMatrixFromYaw(p.yaw),
      shapeName: PROP_SHAPES.poleLamp.shapeFile,
      useInstanceRenderData: true,
    });
    objects.push({
      __parent: 'street_furniture',
      name: `pole_lamp_${i}_light`,
      persistentId: generatePersistentId(),
      position: [
        roundTo(p.x - Math.cos(p.yaw) * POLE_LAMP_REACH_M, 3),
        roundTo(p.y - Math.sin(p.yaw) * POLE_LAMP_REACH_M, 3),
        roundTo(p.z + POLE_LAMP_Z - 0.2, 3),
      ],
      ...STREET_LAMP_LIGHT_TEMPLATE,
    });
    lampCount++;
    poleLamps++;
  }

  if (lampCount + benchCount + (props?.poles.length ?? 0) > 0) {
    console.log(`[BeamNG Export] Street furniture: ${lampCount} lamps (+lights; ${generatedLamps.length} along lit streets, ${poleLamps} on utility poles), ${benchCount} benches, ${props?.poles.length ?? 0} utility poles`);
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
  const isUrbanRoad = buildUrbanRoadClassifier(features);
  for (const feature of features) {
    if (feature.type !== 'road' || !Array.isArray(feature.geometry) || feature.geometry.length < 2) continue;
    const highway = feature.tags?.highway;
    if (!highway || ['footway', 'path', 'pedestrian', 'steps', 'cycleway', 'bridleway', 'corridor'].includes(highway)) continue;
    const isOneWay = isOneWayRoad(feature.tags || {});
    const halfWidth = estimateRoadCrossSection(feature.tags || {}, highway, isOneWay, {
      urban: isUrbanRoad(feature),
    }).carriagewayHalfWidth;
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
 * Lake WaterBlocks: rectangles covering each standing-water outline at the
 * lake's level (services/beamngWater.js planLakes). A WaterBlock's surface is
 * at its position; its volume reaches scale.z / 2 below.
 */
function buildWaterBlockObjects(terrainData, squareSize, biome, stats = {}, dryZones = []) {
  const waterProfile = getWaterProfile(biome);
  const { tiles, stats: lakeStats } = planLakes({
    features: terrainData.osmFeatures || [],
    toWorld: (lat, lng) => geoToWorldPoint(lat, lng, terrainData, squareSize, 0),
    heightAt: (x, y) => getTerrainHeightAtWorldXY(x, y, terrainData, squareSize),
  });
  Object.assign(stats, lakeStats);
  // over a tunnel: no deeper than its roof, none over its trench
  stats.clippedOverTunnels = 0;
  return tiles.map((tile) => ({ tile, depth: clipLakeTile(tile, LAKE_BLOCK_DEPTH_M, dryZones) }))
    .filter(({ depth }) => depth > 0)
    .map(({ tile, depth }, index) => {
      if (depth < LAKE_BLOCK_DEPTH_M) stats.clippedOverTunnels++;
      return { tile, depth, index };
    })
    .map(({ tile, depth, index }) => ({
    ...structuredClone(WATER_BLOCK_TEMPLATE),
    cubemap: waterProfile.waterCubemap,
    depthGradientTex: waterProfile.waterDepthGradientTex,
    foamTex: waterProfile.waterFoamTex,
    rippleTex: waterProfile.waterRippleTex,
    gridSize: Math.max(1, Math.floor(Math.min(100, tile.sx, tile.sy))),
    gridElementSize: roundTo(clamp(Math.min(tile.sx, tile.sy) / 32, 0.5, 4), 2),
    name: `lake_${tile.lake}_${index}`,
    persistentId: generatePersistentId(),
    __parent: 'Water',
    position: [roundTo(tile.cx, 3), roundTo(tile.cy, 3), roundTo(tile.z, 3)],
    scale: [roundTo(tile.sx, 3), roundTo(tile.sy, 3), roundTo(depth * 2, 2)],
  }));
}

/**
 * The sea as WaterBlocks (beamngWaterClip.planSeaBlocks), in place of the
 * plane where a tunnel reaches under sea level: none over its trenches, none
 * deeper than its roof over the tube.
 */
function buildSeaBlockObjects(terrainData, squareSize, biome, seaLevelOffset, dryZones, tunnels, sourceHeightMap = terrainData.heightMap) {
  const waterProfile = getWaterProfile(biome);
  const minHeight = Number(terrainData?.minHeight);
  const seaZ = (Number.isFinite(minHeight) ? -minHeight : 0) + (Number(seaLevelOffset) || 0);
  const before = { ...terrainData, heightMap: sourceHeightMap };
  const blocks = planSeaBlocks({
    size: terrainData.width * squareSize,
    seaZ,
    // the sea where the ground was below it before grading, and still is
    heightAt: (x, y) => Math.max(
      getTerrainHeightAtWorldXY(x, y, terrainData, squareSize),
      getTerrainHeightAtWorldXY(x, y, before, squareSize),
    ),
    zones: dryZones,
    minZ: Math.min(0, ...tunnels.flatMap((t) => t.line.map((p) => p.z))),
  });
  return blocks.map((b, index) => ({
    ...structuredClone(WATER_BLOCK_TEMPLATE),
    cubemap: waterProfile.waterCubemap,
    depthGradientTex: waterProfile.waterDepthGradientTex,
    foamTex: waterProfile.waterFoamTex,
    rippleTex: waterProfile.waterRippleTex,
    gridSize: Math.max(1, Math.floor(Math.min(100, b.sx, b.sy))),
    gridElementSize: roundTo(clamp(Math.min(b.sx, b.sy) / 32, 0.5, 4), 2),
    name: `sea_${index}`,
    persistentId: generatePersistentId(),
    __parent: 'Water',
    position: [roundTo(b.cx, 3), roundTo(b.cy, 3), roundTo(b.z, 3)],
    scale: [roundTo(b.sx, 3), roundTo(b.sy, 3), roundTo(b.depth * 2, 2)],
  }));
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
 * Rivers along year-round waterway centrelines (services/beamngWater.js
 * planRivers): per-node width from the riverbank outline, surface in the
 * channel, kept off the roads; ripples drift downstream at the river's flow.
 */
function buildRiverObjects(terrainData, squareSize, biome, roads = [], stats = {}, dryZones = []) {
  const waterProfile = getWaterProfile(biome);
  const { rivers, stats: riverStats } = planRivers({
    features: terrainData.osmFeatures || [],
    toWorld: (lat, lng) => geoToWorldPoint(lat, lng, terrainData, squareSize, 0),
    heightAt: (x, y) => getTerrainHeightAtWorldXY(x, y, terrainData, squareSize),
    roads,
  });
  Object.assign(stats, riverStats);
  stats.nodesClippedOverTunnels = 0;
  return rivers.map((river, index) => {
    const held = clipRiverNodes(river.nodes, dryZones);
    stats.nodesClippedOverTunnels += held.clipped;
    const nodes = held.nodes.map(([x, y, z, width, depth]) => [roundTo(x, 3), roundTo(y, 3), roundTo(z, 3), roundTo(width, 2), roundTo(depth, 2), 0, 0, 1]);
    const template = structuredClone(RIVER_TEMPLATE);
    template['Ripples (texture animation)'].forEach((layer, i) => { layer.rippleSpeed = roundTo(river.flow / [4, 20, 200][i], 4); });
    return {
      ...template,
      cubemap: waterProfile.riverCubemap,
      depthGradientTex: waterProfile.riverDepthGradientTex,
      rippleTex: waterProfile.riverRippleTex,
      flowMagnitudePhysics: river.flow,
      name: `${river.kind}_${index}`,
      persistentId: generatePersistentId(),
      __parent: 'Water',
      position: nodes[0].slice(0, 3),
      nodes,
    };
  });
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

// How far trunks (and bushes, rocks) stay from a road's or sidewalk's edge.
const VEGETATION_CLEAR_TREE_M = 2;
const VEGETATION_CLEAR_LOW_M = 0.75;
const CLEARANCE_CELL_M = 16;

/**
 * Clearance test against strips [{ points: [[x, y, ...]...], half }]:
 * returns clearOf(x, y, margin), true within half + margin of any strip.
 */
function buildClearanceIndex(strips) {
  const segments = [];
  const grid = new Map();
  let maxHalf = 0;
  for (const { points, half } of strips) {
    maxHalf = Math.max(maxHalf, half);
    for (let i = 0; i + 1 < points.length; i++) {
      const [ax, ay] = points[i];
      const [bx, by] = points[i + 1];
      const idx = segments.push({ ax, ay, bx, by, half }) - 1;
      for (let gx = Math.floor(Math.min(ax, bx) / CLEARANCE_CELL_M); gx <= Math.floor(Math.max(ax, bx) / CLEARANCE_CELL_M); gx++) {
        for (let gy = Math.floor(Math.min(ay, by) / CLEARANCE_CELL_M); gy <= Math.floor(Math.max(ay, by) / CLEARANCE_CELL_M); gy++) {
          const key = `${gx},${gy}`;
          if (!grid.has(key)) grid.set(key, []);
          grid.get(key).push(idx);
        }
      }
    }
  }
  return (x, y, margin) => {
    const r = Math.ceil((maxHalf + margin) / CLEARANCE_CELL_M);
    const cx = Math.floor(x / CLEARANCE_CELL_M);
    const cy = Math.floor(y / CLEARANCE_CELL_M);
    for (let gx = cx - r; gx <= cx + r; gx++) {
      for (let gy = cy - r; gy <= cy + r; gy++) {
        for (const idx of grid.get(`${gx},${gy}`) || []) {
          const s = segments[idx];
          const dx = s.bx - s.ax;
          const dy = s.by - s.ay;
          const len = dx * dx + dy * dy;
          const t = len > 0 ? Math.max(0, Math.min(1, ((x - s.ax) * dx + (y - s.ay) * dy) / len)) : 0;
          const reach = s.half + margin;
          if ((s.ax + t * dx - x) ** 2 + (s.ay + t * dy - y) ** 2 < reach * reach) return true;
        }
      }
    }
    return false;
  };
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
    // Regional trees (services/beamngTrees.js): every tree picks its group from
    // its tags, the climate at its position and whether it stands in town, then
    // a model of that group (nearest its OSM height when mapped).
    const isUrbanPlace = buildUrbanRoadClassifier(terrainData.osmFeatures || []);
    // The biome's own signature models join the candidates (not borrowed ones).
    const SIGNATURE_SELECTORS = {
      deciduous: 'default', oak_west: 'default', tropical: 'default', conifer: 'needle', pine_west: 'needle',
      palm: 'palm', shrub: 'bush', desert_shrub: 'bush',
    };
    const signature = (group) => {
      const type = getOwnVegetationSelector(biome, SIGNATURE_SELECTORS[group]);
      return type ? [{ type, height: treeItemHeight(type) ?? (group.includes('shrub') ? 2.5 : 10) }] : [];
    };
    const pickTree = ({ kind, tags, point, urban, area, seed }) => {
      const hint = treeHintFromTags(tags);
      // exact species the biome ships (Italy: olive, cypress)
      if (kind === 'tree' && (hint === 'olive' || hint === 'cypress')) {
        const type = getOwnVegetationSelector(biome, hint);
        if (type) return { type, scale: 0.85 + 0.3 * seededRandom(hashString(`${seed}:s`)) };
      }
      const group = chooseTreeGroup({ kind, tags, lat: point.lat, lon: point.lng, urban, area, seed });
      return chooseTreeItem(group, { tags, lat: point.lat, lon: point.lng, seed, extra: signature(group) });
    };
    const centroidOf = (feature) => {
      const g = feature.geometry || [];
      const n = Math.max(1, g.length);
      return { lat: g.reduce((a, p) => a + p.lat, 0) / n, lng: g.reduce((a, p) => a + p.lng, 0) / n };
    };

    for (const feature of terrainData.osmFeatures || []) {
      if (feature.type === 'vegetation' && feature.geometry?.length === 1) {
        const seed = hashString(`${feature.id}:${feature.geometry[0].lat}:${feature.geometry[0].lng}`);
        const point = feature.geometry[0];
        const tags = feature.tags || {};
        const isBush = tags.natural === 'shrub';
        const isTreeRow =
          tags.natural === 'tree_row' ||
          tags.tree_row === 'yes' ||
          tags.source_feature === 'tree_row';
        const urban = isUrbanPlace({ id: `veg:${feature.id}`, geometry: [point] });
        const pointCopies = isTreeRow
          ? 1
          : isBush
            ? Math.max(1, Math.round(bushDensityMultiplier))
            : Math.max(1, Math.round(treeDensityMultiplier));
        const jitterMeters = isBush ? 2.2 : 5.5;
        for (let i = 0; i < pointCopies; i++) {
          const cloneSeed = seed + i * 97.13;
          const sampledPoint = i === 0 ? point : jitterLatLngByMeters(point, jitterMeters, cloneSeed);
          const choice = pickTree({
            kind: isBush ? 'shrub' : 'tree',
            // copies are neighbours, not the same tree: only the original keeps the mapped height
            tags: i === 0 ? tags : { ...tags, height: undefined, est_height: undefined },
            point: sampledPoint, urban, area: false, seed: `${feature.id}:${i}`,
          });
          if (!choice) continue;
          const placement = makeForestPlacement(choice.type, sampledPoint, terrainData, squareSize, cloneSeed, 1, 1);
          placement.scale = roundTo(choice.scale, 6);
          pushPlacement(placement, { priority: isTreeRow });
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
        const isBushArea =
          tags.natural === 'scrub' ||
          tags.natural === 'heath' ||
          tags.natural === 'shrubbery' ||
          tags.landcover === 'scrub';
        if (!isTreeArea && !isBushArea) continue;
        const centre = centroidOf(feature);
        const urban = isUrbanPlace({ id: `area:${feature.id}`, geometry: [centre] });
        if (isTreeArea) {
          // Use polygon-driven sampling for BeamNG export so tree coverage
          // reflects full OSM vegetation areas, independent of 3D preview caps.
          const isOrchard = tags.landuse === 'orchard';
          const placements = sampleAreaPlacements(
            feature,
            terrainData,
            squareSize,
            'area_tree',
            (isOrchard ? 0.0028 : 0.0036) * treeDensityMultiplier,
            (isOrchard ? 1800 : 3600) * treeDensityMultiplier,
            1,
            1,
            hashString(`${feature.id}:tree_area`),
          );
          placements.forEach((placement, idx) => {
            const choice = pickTree({ kind: 'tree', tags, point: centre, urban, area: true, seed: `${feature.id}:a${idx}` });
            if (!choice) return;
            placement.type = choice.type;
            placement.scale = roundTo(choice.scale, 6);
            pushPlacement(placement);
          });
        }
        if (isBushArea) {
          const placements = sampleAreaPlacements(
            feature,
            terrainData,
            squareSize,
            'area_bush',
            0.004 * bushDensityMultiplier,
            400 * bushDensityMultiplier,
            1,
            1,
            hashString(feature.id),
          );
          placements.forEach((placement, idx) => {
            const choice = pickTree({ kind: 'shrub', tags, point: centre, urban, area: true, seed: `${feature.id}:b${idx}` });
            if (!choice) return;
            placement.type = choice.type;
            placement.scale = roundTo(choice.scale * (0.75 + 0.45 * seededRandom(hashString(`${feature.id}:bs${idx}`))), 6);
            pushPlacement(placement);
          });
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

    // One cover per material, not per polygon: covers fill around the camera
    // (see the note above the base path's return), so per-polygon copies
    // stacked full layers. The largest matching area sets the density.
    const byMaterial = new Map();
    for (const feature of grassFeatures) {
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
      const material = isFlowerLike ? 'GC_Flowers_1' : (byMaterial.size % 2 === 0 ? 'GC_Grass_close' : 'GC_Grass_close_2');
      const seen = byMaterial.get(material);
      if (!seen || areaSqM > seen.areaSqM) {
        byMaterial.set(material, {
          centerLat,
          centerLng,
          radius,
          areaSqM,
          material,
          types: isFlowerLike ? templateTypesFlowerGrass : templateTypesLongGrass,
        });
      }
    }
    for (const cover of byMaterial.values()) emitTemplateCover({ ...cover, seed: 10 + templateObjects.length });

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
    const sizeScale = groundCover.sizeScale ?? 1;
    if (sizeScale !== 1) {
      grassTypes.forEach((type) => {
        type.sizeMin = roundTo(type.sizeMin * sizeScale, 3);
        type.sizeMax = roundTo(type.sizeMax * sizeScale, 3);
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

  // Daisies + buttercups are an East Coast meadow look; dry biomes opt out.
  const flowerElements = 40000;
  if (groundCover.flowers !== false) groundCoverObjects.push({
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

  // No per-field covers: a GroundCover fills cells around the CAMERA wherever
  // its terrain layer matches (official GroundCover docs) and ignores its
  // position, so one per OSM grass polygon stacked another full grass layer
  // under the car for every field (up to 48; ~600 billboards/m² near the
  // camera in a Mesa export vs vanilla's ≤50, a GPU overdraw sink). OSM grass
  // areas are painted onto the Grass layer, which the base cover already fills.
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
          onPercent?.(metadata?.percent, metadata?.currentFile);
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
 * @param {boolean} [options.includeSidewalks=true]         — raised curbs + sidewalks along drawn roads (.dae)
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
 * @param {'decal'|'none'} [options.roadType='decal'] — 'decal' writes layered DecalRoads (the
 *   only road system); 'none' writes no roads. Legacy 'architect' / 'mesh' mean 'decal'.
 */
export async function exportBeamNGLevel(terrainData, center, options = {}) {
  // Every module logs to the console (OSM, roads, bridges, buildings...); the
  // export keeps its share of that for export_report.txt.
  const jobLog = captureConsole();
  try {
    return await runBeamNGLevelExport(terrainData, center, options, jobLog);
  } finally {
    jobLog.restore();
  }
}

async function runBeamNGLevelExport(terrainData, center, options, jobLog) {
  const {
    baseTexture = 'hybrid',
    includeBuildings = true,
    includeSidewalks = true,
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
  /**
   * Yield one event-loop tick so UI paint and GC can run during long exports.
   */
  const yield_ = () => new Promise(r => setTimeout(r, 0));
  const exportStartedAt = new Date();
  const exportT0 = performance.now();
  const processingLog = [];
  const featureTypeCount = (type) => (terrainData?.osmFeatures || []).reduce((n, f) => n + (f?.type === type ? 1 : 0), 0);
  const phaseWeights = exportPhaseWeights({
    size: computeBeamNGTerrainSize(terrainData.width, terrainData.height),
    osmFeatureCount: Array.isArray(terrainData?.osmFeatures) ? terrainData.osmFeatures.length : 0,
    roadCount: roadType === 'none' ? 0 : featureTypeCount('road'),
    buildingCount: includeBuildings ? featureTypeCount('building') : 0,
    includeBackdrop,
    applyFoundations,
  });
  const totalWeight = Object.values(phaseWeights).reduce((sum, w) => sum + w, 0);
  let weightDone = 0;
  let lastPct = 0;
  let currentStep = null;   // { phase, step, pct }
  let currentStepStartedAt = exportT0;
  // Overall percent: the phases finished plus the share of the current one
  // done, never moving backwards and holding 100 for the end.
  const percentAt = (fraction) => {
    const w = currentStep ? (phaseWeights[currentStep.phase] ?? 0) : 0;
    const pct = Math.floor(((weightDone + w * Math.max(0, Math.min(1, fraction))) / totalWeight) * 100);
    lastPct = Math.max(lastPct, Math.min(99, pct));
    return lastPct;
  };
  /**
   * Emit progress to the export UI: the step's text, the overall percent and,
   * on a new step, the one just finished with its duration.
   */
  const report = (step, fraction = 0, completed = null) => {
    const pct = percentAt(fraction);
    console.log(`${BEAMNG_EXPORT_SERVICE_LOG} Step`, { step, pct });
    onProgress?.({ step, pct, elapsedMs: performance.now() - exportT0, completed });
  };
  /**
   * Close the active step into the processing log.
   */
  const closeStep = () => {
    if (currentStep === null) return null;
    const entry = { step: currentStep.step, pct: currentStep.pct, durationMs: performance.now() - currentStepStartedAt };
    processingLog.push(entry);
    weightDone += phaseWeights[currentStep.phase] ?? 0;
    currentStep = null;
    return entry;
  };
  /**
   * Start a timed processing step (one of exportPhaseWeights' phases).
   */
  const beginStep = (phase, step) => {
    const completed = closeStep();
    currentStep = { phase, step, pct: 0 };
    currentStep.pct = percentAt(0);
    currentStepStartedAt = performance.now();
    report(step, 0, completed);
  };
  const finishProcessingLog = () => { closeStep(); };

  beginStep('prepare', `Preparing ${terrainData.width}×${terrainData.height} terrain and ${Array.isArray(terrainData?.osmFeatures) ? terrainData.osmFeatures.length : 0} OSM features…`);
  await yield_();

  // BeamNG TerrainBlock expects square power-of-two terrain dimensions.
  // Center-crop everything (heightmap, bounds, textures) so terrain, texture,
  // and OSM objects share the same footprint.
  let td = terrainData;
  const targetBeamNGSize = computeBeamNGTerrainSize(td.width, td.height);
  const didCropToSquare = td.width !== targetBeamNGSize || td.height !== targetBeamNGSize;
  if (didCropToSquare) {
    const cropSize = targetBeamNGSize;
    report(`Cropping terrain to ${cropSize}×${cropSize} (BeamNG needs a square power of two)…`);
    td = await prepareCroppedTerrainData({ ...td, exportCropSize: cropSize });
  }

  const foundationInput = {
    ...td,
    osmFeatures: filterOSMFeaturesToBounds(td.osmFeatures, td.bounds),
  };

  let exportTerrainData = foundationInput;
  if (applyFoundations) {
    beginStep('foundations', 'Preparing building foundations…');
    await yield_();
    exportTerrainData = await applyBuildingFoundations(
      foundationInput,
      {
        yieldFn: yield_,
        onProgress: ({ completed, total, applied, skipped }) => {
          if (!total) return;
          const counts = Number.isFinite(applied) && Number.isFinite(skipped)
            ? ` | Applied: ${applied}, Skipped: ${skipped}`
            : '';
          report(`Building foundations ${completed}/${total}${counts}`, completed / total);
        },
      }
    );
  }

  const lat = center.lat.toFixed(4);
  const lng = center.lng.toFixed(4);
  const fallbackLevelName = `mapng_${lat}_${lng}`.replace(/-/g, '_').replace(/\./g, '_');
  const levelDisplayName = String(requestedLevelName || '').trim() || fallbackLevelName;
  const levelName = sanitizeLevelId(levelDisplayName || fallbackLevelName);
  if (!/^[a-z_][a-z0-9_]{0,63}$/.test(levelName)) {
    throw new Error(`Generated invalid BeamNG level id: ${levelName}`);
  }
  report('Choosing the regional look and road rules for this location…', 0.5);
  // The look (ground cover, signature trees, rocks, terrain detail textures,
  // water) follows the location (services/beamngRegion.js); an explicit
  // biomeId still wins (tests, tools).
  const regional = biomeId ? null : resolveRegionalBiome({
    lat: center.lat,
    lon: center.lng,
    meanHeightM: sampleMeanHeight(exportTerrainData),
    features: exportTerrainData.osmFeatures || [],
    mapAreaM2: (exportTerrainData.width * computeSquareSize(exportTerrainData)) ** 2,
  });
  const resolvedBiomeId = biomeId || regional.biomeId;
  const biome = getBeamNGBiomeById(resolvedBiomeId);
  if (!biome) {
    console.error(`${BEAMNG_EXPORT_SERVICE_LOG} Invalid biomeId.`, { biomeId: resolvedBiomeId });
    throw new Error(`Invalid BeamNG biome: ${resolvedBiomeId}`);
  }
  if (regional) console.log(`${BEAMNG_EXPORT_SERVICE_LOG} Regional look: ${biome.label} (${regional.reason}).`);
  // Road rules follow the export's location (driving side, signal cycle,
  // turn on red); the biome only picks visuals. Explicit options still win,
  // and the biome profile is the fallback when the location is unknown.
  const trafficProfile = getTrafficProfile(biome);
  const roadRules = await resolveRoadRulesAt(center.lat, center.lng);
  const resolvedCountry = typeof country === 'string' && country.trim().length > 0
    ? country.trim()
    : roadRules?.beamngCountry ?? trafficProfile.country;
  const resolvedRightHandDrive = typeof rightHandDrive === 'boolean'
    ? rightHandDrive
    : roadRules?.leftHandTraffic ?? trafficProfile.rightHandDrive;
  exportTerrainData.roadRules = {
    leftHandTraffic: resolvedRightHandDrive,
    euroSignals: !!roadRules?.euroSignals,
    countryCode: roadRules?.countryCode ?? null,
    region: roadRules?.region ?? null,
  };
  if (roadRules) {
    console.log(`${BEAMNG_EXPORT_SERVICE_LOG} Road rules: ${roadRules.countryName} (${roadRules.countryCode}), ${resolvedRightHandDrive ? 'left' : 'right'}-hand traffic${roadRules.euroSignals ? ', EU signal cycle' : ''}.`);
  }
  const linkRegistry = createBeamNGLinkFileRegistry(levelName, { companions: SHAPE_IMPOSTER_FILES });

  const size = exportTerrainData.width;
  const osmFeatureCount = Array.isArray(exportTerrainData.osmFeatures) ? exportTerrainData.osmFeatures.length : 0;
  const squareSize = computeSquareSize(exportTerrainData);
  const halfExtent = (size / 2) * squareSize;
  const worldSize = size * squareSize;
  const terrainHeightRange = exportTerrainData.maxHeight - exportTerrainData.minHeight;
  // BeamNG TerrainBlock behaves poorly with maxHeight <= 0 (collision/road projection artifacts).
  const maxHeight = Math.max(1, Math.ceil(terrainHeightRange));

  let { position: spawnPosition, rotationMatrix: spawnRotationMatrix } =
    findSpawnPosition(exportTerrainData, center, squareSize);

  // DecalRoads are the only road system (BeamNG's own levels use them, and the
  // AI navgraph is built from them). Legacy 'architect' / 'mesh' values from
  // saved settings or batch configs are treated as 'decal'.
  const includeRoads = roadType !== 'none';
  if (includeRoads) {
    const roadFeatureCount = (exportTerrainData.osmFeatures || []).filter((f) => f.type === 'road').length;
    beginStep('roads', `Laying out ${roadFeatureCount} OSM roads: DecalRoads, lane markings, junctions, bridge decks and tunnels…`);
    await yield_();
  }
  // the ground before any grading: where the sea really is (a cut below sea
  // level is no sea)
  const sourceHeightMap = exportTerrainData.heightMap;
  const decalRoads = includeRoads
    ? generateDecalRoads(exportTerrainData, squareSize)
    : [];
  // Bridges: decks for the bridge roads; nothing ground-bound (sidewalks,
  // props, lamps) is built along them, nothing tall stands up into them.
  const bridgeDecks = decalRoads.bridges?.decks || [];
  // Tunnels likewise: no sidewalks, lamps or props inside, nothing standing
  // in a tube, a headwall or a cutting's walls (the hill over it is free).
  const tunnelList = decalRoads.tunnels?.tunnels || [];
  const groundCarriageways = (decalRoads.carriageways || []).filter((cw) => !cw.bridge && !cw.tunnel);
  const underDeck = (x, y, z, zTop) => (bridgeDecks.length > 0 && hitsDeck(bridgeDecks, x, y, z, zTop))
    || (tunnelList.length > 0 && hitsTunnel(tunnelList, x, y, z, zTop));
  // the spawn on a drawn road, not on the OSM line 3 m over the terrain (the
  // road nearest the centre was Zion's tunnel: the car dropped onto the cliff
  // over it)
  const roadSpawn = findRoadSpawn(groundCarriageways, (x, y) => getTerrainHeightAtWorldXY(x, y, exportTerrainData, squareSize), underDeck, { leftHandTraffic: resolvedRightHandDrive });
  if (roadSpawn) ({ position: spawnPosition, rotationMatrix: spawnRotationMatrix } = roadSpawn);
  const bridgeDaes = generateBridgeDAEs(
    bridgeDecks,
    (x, y) => getTerrainHeightAtWorldXY(x, y, exportTerrainData, squareSize),
    decalRoads.bridges?.roadLines || [],
  );
  if (bridgeDecks.length > 0) {
    console.log(`${BEAMNG_EXPORT_SERVICE_LOG} Bridges: ${bridgeDecks.length} deck(s), ${decalRoads.bridges?.ramps ?? 0} approach embankment(s), ${bridgeDaes.reduce((n, d) => n + d.triangles, 0)} triangles, one object per bridge.`);
  }
  const tunnelDaes = generateTunnelDAEs(tunnelList);
  const tunnelGroups = buildTunnelGroups(tunnelList, tunnelDaes, levelName);
  if (tunnelList.length > 0) {
    console.log(`${BEAMNG_EXPORT_SERVICE_LOG} Tunnels: ${tunnelList.length} bored, ${tunnelDaes.length} object(s), ${tunnelDaes.reduce((n, d) => n + d.triangles, 0)} triangles, ${tunnelGroups.lightCount} lights, ${tunnelGroups.zoneCount} zones.`);
  }
  if (includeRoads && includeSidewalks) {
    beginStep('sidewalks', `Building sidewalks, curbs and ramps along ${groundCarriageways.length} carriageways${bridgeDecks.length ? ` (${bridgeDecks.length} bridge decks built)` : ''}…`);
    await yield_();
  }
  const sidewalks = includeRoads && includeSidewalks
    ? buildSidewalkMeshes(groundCarriageways, {
      zones: decalRoads.crosswalkZones || [],
      // driveways and parking aisles: the curb lowered where they cross
      driveways: (exportTerrainData.osmFeatures || [])
        .filter((f) => f.type === 'road' && f.tags?.highway === 'service' && f.geometry?.length > 1)
        .map((f) => f.geometry.map((p) => geoToWorldPoint(p.lat, p.lng, exportTerrainData, squareSize, 0))),
    })
    : { meshes: [], runs: [], triangles: 0 };
  if (sidewalks.runs.length > 0) {
    console.log(`${BEAMNG_EXPORT_SERVICE_LOG} Sidewalks: ${sidewalks.runs.length} curb runs, ${(sidewalks.medianRuns || []).length} median island runs, ${sidewalks.triangles} triangles in ${sidewalks.meshes.length} mesh(es).`);
  }
  const sidewalksDae = generateSidewalksDAE(sidewalks.meshes);

  beginStep('props', 'Placing street props (hydrants, bins, benches, utility poles, power lines) and traffic signals…');
  await yield_();
  // Street props (hydrants, bins, benches, utility poles + wires): mapped OSM
  // ones where they exist, the rest at real-world spacings along the roads.
  const mappedStreetProps = collectMappedStreetProps(exportTerrainData, squareSize);
  const streetProps = includeRoads
    ? placeStreetProps({
      carriageways: groundCarriageways,
      runs: sidewalks.runs,
      mapped: mappedStreetProps,
      heightAt: (x, y) => getTerrainHeightAtWorldXY(x, y, exportTerrainData, squareSize),
      townPoles: center.lat > 24 && center.lng > -170 && center.lng < -50,
      isBlocked: underDeck,
    })
    : { hydrants: [], bins: [], benches: [], poles: [], wires: [] };
  // A wire passing just under (or through) a deck is left out.
  streetProps.wires = streetProps.wires.filter((w) => !w.some(([x, y, z]) => underDeck(x, y, z - 1.5, z + 1.5)));
  const powerWireDaes = generatePowerWireDAEs(streetProps.wires);
  console.log(`${BEAMNG_EXPORT_SERVICE_LOG} Street props: ${streetProps.hydrants.length} hydrants, ${streetProps.bins.length} bins, ${streetProps.benches.length} benches, ${streetProps.poles.length} poles, ${streetProps.wires.length} wires in ${powerWireDaes.length} tile(s).`);

  const { signalData, controllerDefinitions: signalControllerDefinitions, props: signalProps = [] } =
    buildBeamNGSignalExportBundle(exportTerrainData, squareSize);

  // Speed bumps, humps, tables and cushions from OSM traffic_calming, all
  // stock assets (services/trafficCalming.js), with chevron paint and a
  // warning sign ahead of humps and tables.
  const calming = includeRoads
    ? placeTrafficCalming({
      features: exportTerrainData.osmFeatures || [],
      carriageways: groundCarriageways,
      toWorld: (lat, lng) => geoToWorldPoint(lat, lng, exportTerrainData, squareSize, 0),
      heightAt: (x, y) => getTerrainHeightAtWorldXY(x, y, exportTerrainData, squareSize),
      isBlocked: (() => {
        const index = buildCarriagewayIndex(groundCarriageways);
        return (x, y) => isOnOtherCarriageway(index, x, y, 0.5, () => false) || underDeck(x, y, getTerrainHeightAtWorldXY(x, y, exportTerrainData, squareSize), 4);
      })(),
      style: getMarkingStyle(exportTerrainData.roadRules),
      leftHandTraffic: !!exportTerrainData.roadRules?.leftHandTraffic,
    })
    : { statics: [], chevrons: [], signs: [], counts: {}, skipped: {} };
  const trafficCalmingObjects = calming.statics.map((item, i) => ({
    __parent: 'traffic_calming',
    class: 'TSStatic',
    name: `calming_${item.kind}_${i}`,
    persistentId: generatePersistentId(),
    position: item.position.map((v) => roundTo(v, 3)),
    rotationMatrix: rotationMatrixFromYaw(item.yaw),
    ...(item.scale ? { scale: item.scale.map((v) => roundTo(v, 4)) } : {}),
    shapeName: item.shape,
    collisionType: 'Collision Mesh',
    useInstanceRenderData: true,
  }));
  if (calming.chevrons.length > 0 && decalRoads.length > 0) {
    // the chevrons paint onto the humps (overObjects), above the road
    const markings = calming.chevrons.map((c, i) => {
      const decal = makeRoadDecal(c.nodes, `Chevrons_${i}`, 'traffic_calming_markings', {
        material: 'road_chevrons', renderPriority: 1, breakAngle: 1, textureLength: c.textureLength,
        startEndFade: [0, 0],
      });
      if (decal) decal.overObjects = true;
      return decal;
    }).filter(Boolean);
    if (markings.length) {
      decalRoads.push({ class: 'SimGroup', name: 'traffic_calming_markings', persistentId: generatePersistentId(), __parent: 'Decal_Roads', __items: markings });
    }
  }
  // Curve warnings and chevrons from the road geometry (services/curveWarningSigns.js).
  const curveWarnings = includeRoads
    ? placeCurveWarnings({
      carriageways: groundCarriageways,
      heightAt: (x, y) => getTerrainHeightAtWorldXY(x, y, exportTerrainData, squareSize),
      isBlocked: (() => {
        const index = buildCarriagewayIndex(groundCarriageways);
        return (x, y) => isOnOtherCarriageway(index, x, y, 0.5, () => false) || underDeck(x, y, getTerrainHeightAtWorldXY(x, y, exportTerrainData, squareSize), 4);
      })(),
      style: getMarkingStyle(exportTerrainData.roadRules),
      leftHandTraffic: !!exportTerrainData.roadRules?.leftHandTraffic,
    })
    : { props: [], counts: {} };
  if (curveWarnings.props.length) {
    console.log(`${BEAMNG_EXPORT_SERVICE_LOG} Curve warnings: ${curveWarnings.props.length} signs (${JSON.stringify(curveWarnings.counts)}).`);
  }
  const calmingTotal = Object.values(calming.counts).reduce((n, v) => n + v, 0);
  if (calmingTotal > 0 || calming.skipped.offRoad) {
    console.log(`${BEAMNG_EXPORT_SERVICE_LOG} Traffic calming: ${JSON.stringify(calming.counts)} placed (${trafficCalmingObjects.length} objects, ${calming.chevrons.length} chevron decals, ${calming.signs.length} warning signs); skipped ${JSON.stringify(calming.skipped)}.`);
  }

  // Traffic needs a road graph; the engine builds it from drivable DecalRoads.
  const supportsTraffic = decalRoads.length > 0;

  // ── Sequential pipeline — one heavy operation at a time ────────────────────
  // Running everything in parallel (Promise.all) keeps multiple large buffers
  // alive simultaneously. Sequencing lets each blob be GC-eligible before the
  // next one is allocated, which is critical for 4096+ terrain grids.

  await yield_();
  beginStep('texture', `Generating the ${baseTexture} base texture for the ${size}×${size} terrain…`);
  await yield_();
  // The base texture may be finer than the grid (2× up to 4096 grids, as
  // west_coast_usa: 2048 grid, 4096 base). Use that size only when the chosen
  // texture carries the detail; the OSM texture and older 1× textures stay at
  // the grid size. *BaseTexSize spans stay in grid squares either way.
  let texBlob = await getTerrainTextureBlob(exportTerrainData, baseTexture);
  report(`Fitting the base texture to the ${size}×${size} grid${texBlob ? ` (${formatBytes(texBlob.size)} source)` : ''}…`, 0.75);
  const fittedTexture = await fitBaseTexture(texBlob, size, {
    allowFiner: baseTexture !== 'none' && baseTexture !== 'osm',
  });
  texBlob = fittedTexture.blob;
  const terrainBaseTexSize = fittedTexture.size;

  // Legacy image-based inference is no longer generated and now falls back to OSM.
  const imageCanvas = null;
  const effectivePbrSource = (pbrSource === 'image' && !imageCanvas) ? 'osm' : pbrSource;

  // Satellite-based textures show where unmapped ground is vegetated.
  const vegetationMask = effectivePbrSource === 'osm' && ['hybrid', 'satellite', 'painted'].includes(baseTexture)
    ? await buildVegetationMask(texBlob)
    : null;

  beginStep('materials', effectivePbrSource !== 'none'
    ? `Painting terrain materials from OSM land use (${size}×${size} layer map)…`
    : 'Writing the default terrain material…');
  const pbrResult = effectivePbrSource !== 'none'
    ? await buildTerrainMaterials(exportTerrainData, worldSize, levelName, biome, terrainBaseTexSize, {
        pbrSource: effectivePbrSource,
        imageCanvas,
        vegetationMask,
      })
    : null;

  beginStep('ter', `Writing the terrain binary (terrain.ter, ${size}×${size} heights + material layers)…`);
  await yield_();
  // Tunnel portals: their terrain squares open (layer 255, Terrain-Files.md
  // "Empty terrain / holes").
  let terLayerMap = pbrResult?.layerMap ?? null;
  // Under a gallery the road is on the ground (the painter leaves tunnel
  // roads out, as under a hill): asphalt there, not grass growing through it
  const asphaltLayer = (pbrResult?.materialNames || []).indexOf('asphalt');
  if (terLayerMap && asphaltLayer >= 0) {
    const n = exportTerrainData.width;
    for (const t of (decalRoads.tunnels?.tunnels || []).filter((q) => q.kind === 'gallery')) {
      for (let i = 0; i + 1 < t.line.length; i++) {
        const p = t.line[i];
        for (let d = -t.W; d <= t.W; d += squareSize / 2) {
          const [x, y] = [p.x + d * p.ty, p.y - d * p.tx];
          const c = Math.round(x / squareSize + n / 2); const r = Math.round(y / squareSize + n / 2);
          if (c >= 0 && c < n && r >= 0 && r < n) terLayerMap[r * n + c] = asphaltLayer;
        }
      }
    }
  }
  const tunnelHoles = decalRoads.tunnels?.holes || [];
  if (tunnelHoles.length > 0) {
    if (!terLayerMap) terLayerMap = new Uint8Array(exportTerrainData.width * exportTerrainData.height);
    // a square opens by its south-west sample; its other corners keep their
    // material, and ground cover grew from them into the opening (a gallery
    // window full of floating grass): rock there, which grows none
    const names = pbrResult?.materialNames || [];
    const bare = [names.indexOf('ROCK'), names.indexOf('asphalt')].find((i) => i >= 0);
    const n = exportTerrainData.width;
    const isHole = new Set(tunnelHoles);
    if (bare !== undefined) {
      for (const k of tunnelHoles) {
        for (const j of [k + 1, k + n, k + n + 1, k - 1, k - n, k - n - 1, k - n + 1, k + n - 1]) {
          if (j >= 0 && j < terLayerMap.length && !isHole.has(j)) terLayerMap[j] = bare;
        }
      }
    }
    for (const k of tunnelHoles) if (k >= 0 && k < terLayerMap.length) terLayerMap[k] = 255;
  }
  // The terrain's range after grading: tunnel trenches and roads sunk under
  // bridges reach below the source's lowest point on flat ground (Deck Park:
  // a 7 m trench, the whole city within 3 m), a portal's backfill over its
  // highest. Encoded from the old minimum they clamped to its floor; the
  // block moves down instead, everything else keeping its height.
  let gradedMin = Infinity; let gradedMax = -Infinity;
  for (const v of exportTerrainData.heightMap) { if (v < gradedMin) gradedMin = v; if (v > gradedMax) gradedMax = v; }
  const terrainBase = Math.min(exportTerrainData.minHeight, gradedMin);
  const terrainTop = Math.max(exportTerrainData.maxHeight, gradedMax);
  const terrainBlockZ = roundTo(terrainBase - exportTerrainData.minHeight, 3);
  const terrainBlockMaxHeight = Math.max(1, Math.ceil(terrainTop - terrainBase));
  const terData = { ...exportTerrainData, minHeight: terrainBase, maxHeight: terrainTop };
  const { blob: terBlob } = await exportTer(terData, {
    layerMap: terLayerMap,
    materialNames: pbrResult?.materialNames ?? null,
  });

  beginStep('heightmap', `Encoding the 16-bit heightmap PNG (${size}×${size})…`);
  await yield_();
  let heightmapBlob = await generateHeightmapPng(terData, size);

  beginStep('thumbnail', 'Rendering the level preview thumbnail…');
  await yield_();
  let previewBlob = await generatePreviewBlob(exportTerrainData);

  let osmDaeBlob = null;
  const buildingReport = {};
  if (includeBuildings) {
    beginStep('buildings', `Building textured 3D buildings (${(exportTerrainData.osmFeatures || []).filter((f) => f.type === 'building').length} OSM footprints)…`);
    await yield_();
    osmDaeBlob = await generateOSMObjectsDAE(exportTerrainData, worldSize, buildingReport);
  } else {
    await yield_();
  }

  beginStep('water', includeWater ? 'Building water: sea level plane, lakes and rivers…' : 'Building the sea level water plane…');
  await yield_();
  // Always emit a sea-level WaterPlane; includeWater toggles only inland OSM-derived water.
  const waterStats = { lakes: {}, rivers: {} };
  // Tunnels stay dry: water over a tube stops at its roof, none in a trench;
  // reaching under sea level, the sea is blocks around them, not the plane
  const dryZones = tunnelDryZones(tunnelList);
  const seaZ = -(Number(exportTerrainData.minHeight) || 0) + (Number(seaLevelOffset) || 0);
  // a plane floods every cut below sea level: the sea as blocks over the
  // ground that was below it when a tunnel or a cut (a road sunk under a
  // bridge, a trench) now reaches under it
  let cutBelowSea = false;
  if (exportTerrainData.heightMap !== sourceHeightMap) {
    const seaAbs = seaZ + (Number(exportTerrainData.minHeight) || 0);
    const hm = exportTerrainData.heightMap;
    for (let i = 0; i < hm.length && !cutBelowSea; i++) cutBelowSea = hm[i] < seaAbs && sourceHeightMap[i] >= seaAbs;
  }
  const seaAsBlocks = (tunnelList.length > 0 && tunnelsBelow(tunnelList, seaZ)) || cutBelowSea;
  const seaObjects = seaAsBlocks
    ? buildSeaBlockObjects(exportTerrainData, squareSize, biome, seaLevelOffset, dryZones, tunnelList, sourceHeightMap)
    : [buildSeaLevelWaterPlane(exportTerrainData, biome, seaLevelOffset)];
  waterStats.sea = seaAsBlocks ? { blocks: seaObjects.length } : { plane: true };
  const waterObjects = [
    ...seaObjects,
    ...(includeWater
      ? [
          ...buildWaterBlockObjects(exportTerrainData, squareSize, biome, waterStats.lakes, dryZones),
          ...buildRiverObjects(exportTerrainData, squareSize, biome,
            groundCarriageways.map((c) => ({ points: c.nodes, half: c.half })), waterStats.rivers, dryZones),
        ]
      : []),
  ];
  Object.defineProperty(waterObjects, 'stats', { value: waterStats, enumerable: false });
  if (includeWater) {
    console.log(`${BEAMNG_EXPORT_SERVICE_LOG} Water: ${waterStats.lakes.tiles ?? 0} lake tiles in ${waterStats.lakes.lakes ?? 0} lakes, ${waterStats.rivers.pieces ?? 0} rivers; left out ${waterStats.rivers.dry ?? 0} dry washes, ${waterStats.rivers.underground ?? 0} culverts, ${waterStats.rivers.otherKinds ?? 0} drains/ditches, ${waterStats.lakes.dry ?? 0} dry lakes; ${waterStats.rivers.cutAtRoads ?? 0} cut at roads.`);
  }
  const cloudObjects = buildCloudObjects(biome);

  beginStep('furniture', 'Placing barriers, fences, road signs, traffic lights, lamps, benches and fuel stations…');
  await yield_();
  const onDrawnRoad = buildClearanceIndex(groundCarriageways.map((cw) => ({ points: cw.nodes, half: cw.half })));
  const barrierObjects = includeNativeBarriers
    ? buildNativeBarrierObjects(exportTerrainData, squareSize, biome, {
      skipAt: (x, y, z) => onDrawnRoad(x, y, 0.3) || underDeck(x, y, z - 1, z + 2),
      // guardrail / fence runs: not under a deck they run along (OSM's railing
      // of the bridge, which has its own parapets, stood on the road under it)
      skipLineAt: (x, y, z, yaw) => bridgeDecks.length > 0 && alongDeck(bridgeDecks, x, y, z, yaw),
    })
    : [];
  const barrierFolderItems = buildBarrierFolderItems(barrierObjects);
  const signObjects = [...buildRoadSignProps(exportTerrainData, squareSize, {
    style: getMarkingStyle(exportTerrainData.roadRules),
  }).props, ...[...calming.signs, ...curveWarnings.props].map((sign) => ({ ...sign, position: sign.position.map((v) => roundTo(v, 3)) }))].map((sign, i) => ({
    __parent: 'signs',
    class: 'TSStatic',
    name: `sign_${sign.kind}_${i}`,
    persistentId: generatePersistentId(),
    position: sign.position,
    rotationMatrix: rotationMatrixFromYaw(sign.yaw),
    shapeName: sign.shape,
    useInstanceRenderData: true,
  }));
  const trafficSignalObjects = buildTrafficSignalObjects(signalProps);
  const streetFurnitureObjects = buildStreetFurnitureObjects(exportTerrainData, squareSize, biome, {
    carriageways: groundCarriageways,
    props: streetProps,
    underDeck,
  });
  // OSM bollards as stock bollards (services/bollards.js), not on drawn roads.
  const bollardPlacement = placeBollards({
    features: exportTerrainData.osmFeatures || [],
    toWorld: (lat, lng) => geoToWorldPoint(lat, lng, exportTerrainData, squareSize, 0),
    heightAt: (x, y) => getTerrainHeightAtWorldXY(x, y, exportTerrainData, squareSize),
    onDrawnRoad: (() => {
      const index = buildCarriagewayIndex(groundCarriageways);
      return (x, y) => isOnOtherCarriageway(index, x, y, 0, () => false);
    })(),
    isBlocked: (x, y, z) => underDeck(x, y, z, z + 2),
  });
  bollardPlacement.bollards.forEach((b, i) => streetFurnitureObjects.push({
    __parent: 'street_furniture',
    class: 'TSStatic',
    name: `bollard_${i}`,
    persistentId: generatePersistentId(),
    position: b.position.map((v) => roundTo(v, 3)),
    rotationMatrix: rotationMatrixFromYaw(b.yaw),
    shapeName: b.shape,
    useInstanceRenderData: true,
  }));
  if (bollardPlacement.bollards.length || bollardPlacement.skipped.onRoad) {
    console.log(`${BEAMNG_EXPORT_SERVICE_LOG} Bollards: ${bollardPlacement.bollards.length} placed, ${bollardPlacement.skipped.onRoad} on drawn roads left out.`);
  }
  const { objects: fuelStationObjects, facilities: fuelStationFacilities } =
    buildFuelStations(exportTerrainData, squareSize);
  const usesEastCoastFenceMaterials = barrierFolderItems.some((obj) => (
    String(obj?.shapeName || '').toLowerCase().includes('eca_bld_wood_fence_a.dae')
  ));

  const plants = [includeTrees && 'trees and bushes', includeRocks && 'rocks'].filter(Boolean).join(', ');
  beginStep('vegetation', plants ? `Planting ${plants}, ground cover and props…` : 'Placing ground cover and props…');
  await yield_();
  const forestPlacements = (includeTrees || includeRocks)
    ? buildForestPlacements(exportTerrainData, squareSize, { includeTrees, includeRocks }, biome)
    : new Map();
  // Trees, bushes and rocks keep off the roads and sidewalks (OSM woods and
  // scrub are often drawn right over the roads through them) and out from
  // under bridge decks.
  const clearOf = buildClearanceIndex([
    ...groundCarriageways.map((cw) => ({ points: cw.nodes, half: cw.half })),
    ...(decalRoads.pedestrianStreets || []).map((way) => ({ points: way.nodes, half: way.half })),
    ...sidewalks.runs.map((run) => ({ points: run.points, half: run.width })),
  ]);
  let vegetationCleared = 0;
  for (const [type, list] of forestPlacements) {
    const margin = (treeItemHeight(type) ?? 10) < 4 ? VEGETATION_CLEAR_LOW_M : VEGETATION_CLEAR_TREE_M;
    const kept = list.filter(({ pos: [x, y, z] }) => !clearOf(x, y, margin) && !underDeck(x, y, z, z + 12));
    vegetationCleared += list.length - kept.length;
    if (kept.length) forestPlacements.set(type, kept);
    else forestPlacements.delete(type);
  }
  if (vegetationCleared) console.log(`${BEAMNG_EXPORT_SERVICE_LOG} Vegetation: ${vegetationCleared} placement(s) kept off roads, sidewalks and bridges.`);
  // Hydrants and bins (mapped + generated) as Forest items: instanced and
  // cheap, and their orientation does not matter.
  const addPropPlacement = (type, x, y, z, yaw) => {
    if (!forestPlacements.has(type)) forestPlacements.set(type, []);
    const list = forestPlacements.get(type);
    if (list.length >= BEAMNG_MAX_FOREST_PLACEMENTS_PER_TYPE) return;
    list.push({ ctxid: 0, pos: [roundTo(x, 3), roundTo(y, 3), roundTo(z, 3)], rotationMatrix: rotationMatrixFromYaw(yaw), scale: 1, type });
  };
  for (const [x, y, z] of mappedStreetProps.hydrants) addPropPlacement(PROP_HYDRANT, x, y, z, propHash(x, y) * Math.PI * 2);
  for (const h of streetProps.hydrants) addPropPlacement(PROP_HYDRANT, h.x, h.y, h.z, h.yaw);
  const binType = (x, y) => PROP_BINS[Math.floor(propHash(x.toFixed(1), y.toFixed(1), 'bin') * PROP_BINS.length)];
  for (const [x, y, z] of mappedStreetProps.bins) addPropPlacement(binType(x, y), x, y, z, propHash(x, y) * Math.PI * 2);
  for (const b of streetProps.bins) addPropPlacement(binType(b.x, b.y), b.x, b.y, b.z, b.yaw);
  const forestFiles = serializeForestFiles(forestPlacements);
  const groundCoverObjects = buildGroundCoverObjects(exportTerrainData, squareSize, includeTrees, biome);
  const managedForestItemData = cloneManagedItemData(Array.from(forestPlacements.keys()), biome);

  let backdropDaeBlob = null;
  let backdropTextureFiles = [];
  let backdropMaterialNames = [];
  let backdropDiagnostics = null;
  if (includeBackdrop) {
    beginStep('backdrop', `Fetching the surrounding backdrop (${backdropElevationSource === 'global30m' ? 'global 30 m' : backdropElevationSource.toUpperCase()} elevation + satellite imagery, 8 tiles)…`);
    await yield_();
    const backdropResult = await generateTerrainBackdropDAE(exportTerrainData, worldSize, {
      elevationSource: backdropElevationSource,
      gpxzApiKey: backdropGpxzApiKey,
      onProgress: (text, fraction) => report(`Backdrop: ${String(text).replace(/\.\.\.$/, '…')}`, fraction),
    });
    backdropDaeBlob = backdropResult?.daeBlob ?? null;
    backdropTextureFiles = backdropResult?.textureFiles ?? [];
    backdropMaterialNames = backdropResult?.materialNames ?? [];
    backdropDiagnostics = backdropResult?.diagnostics ?? null;
  }

  beginStep('assets', 'Loading bundled assets (MapNG flag, reflection cubemap)…');
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

  beginStep('zip', `Assembling the level files (levels/${levelName}/…)…`);
  await yield_();

  const zip = new JSZip();
  // Entry sizes for the compression progress (JSZip keeps none it exposes).
  const zipEntryBytes = new Map();
  const addZipFile = zip.file.bind(zip);
  // (arguments passed on as given: zip.file(name) alone reads an entry)
  zip.file = (...args) => {
    if (args.length > 1 && typeof args[0] === 'string') zipEntryBytes.set(args[0], byteSizeOf(args[1]));
    return addZipFile(...args);
  };
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
  if (trafficCalmingObjects.length > 0) {
    zip.folder(`${base}/main/MissionGroup/traffic_calming`);
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

  // Sky date (TimeOfDay-and-Level-Metadata docs): since 0.39 the sun path,
  // moon, stars and the sunset→sunrise night-light window come from
  // TimeOfDay's latitude/longitude/date. Freeroam overwrites that date with
  // info.json defaultDate (June 20 when missing), so both carry the export
  // day — the season the user is looking at. utcOffset stays unset: the
  // engine then derives it (and DST) from longitude, keeping clock ≈ sun.
  const exportDay = new Date();
  const skyDate = { year: exportDay.getFullYear(), month: exportDay.getMonth() + 1, day: exportDay.getDate() };

  zip.file(`${base}/info.json`, JSON.stringify({
    authors: 'mapng',
    biome: biome?.label || biome?.id || 'mapng',
    defaultSpawnPointName: 'spawn_default',
    description: `Generated by mapng at ${lat}, ${lng}`,
    features: 'Procedural OSM-driven roads, vegetation, water, and terrain.',
    previews: ['preview.png'],
    roads: 'OSM-derived roads',
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
    defaultDate: skyDate,
    country: resolvedCountry,
    region: getRegionForCountry(resolvedCountry, roadRules),
    roadRules: {
      rightHandDrive: resolvedRightHandDrive,
      turnOnRed: roadRules ? roadRules.turnOnRed : getTurnOnRedForCountry(resolvedCountry),
    },
    minimap: [{
      file: minimapImageRel,
      size: [worldSizeMeters, worldSizeMeters],
      offset: [-minimapHalfExtent, minimapHalfExtent],
    }],
  }, null, 2));

  // ── city.sites.json ───────────────────────────────────────────────────────
  // A valid Sites Editor file (zones / parking can be authored in the World
  // Editor), with a zone along every named road: the minimap's label names
  // the road being driven (services/roadNameZones.js).
  const roadNameZones = buildRoadNameZones(decalRoads.carriageways || []);
  zip.file(`${base}/city.sites.json`, JSON.stringify({
    description: 'Description of these Sites. Contains Locations and Zones.',
    dir: `/levels/${levelName}/`,
    filename: 'city.sites.json',
    locations: {},
    name: 'city.sites.json',
    parkingSpots: [],
    zones: roadNameZones,
  }));

  // ── map.json ───────────────────────────────────────────────────────────────
  // Navigation comes from the drivable DecalRoads; map.json carries no
  // manual segments (kept as the valid empty file official levels ship).
  zip.file(`${base}/map.json`, JSON.stringify({ segments: {} }, null, 2));

  // ── signals.json ───────────────────────────────────────────────────────────
  // Generate OSM-driven signals when available; fall back to a valid empty schema.
  zip.file(`${base}/signals.json`, JSON.stringify(signalData, null, 2));
  if (signalControllerDefinitions) {
    zip.file(`${base}/signalControllerDefinitions.json`, JSON.stringify(signalControllerDefinitions, null, 2));
  }

  // ── art/roads: the stone and brick paving decal-road materials ─────────────
  const pavingMaterials = usedPavingMaterials(decalRoads);
  if (Object.keys(pavingMaterials).length > 0) {
    zip.file(`${base}/art/roads/main.materials.json`, JSON.stringify(pavingMaterials, null, 2));
  }

  // ── art/decals + main.decals.json: turn-lane arrows ───────────────────────
  // Painted from OSM turn:lanes via the core road-markings atlas.
  const turnArrowInstances = includeRoads
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
  const terrainBinaryData = await toZipBinary(terBlob);
  const terrainHeightmapData = await toZipBinary(heightmapBlob);
  const osmDaeData = await toZipBinary(osmDaeBlob);
  const sidewalksDaeData = await toZipBinary(sidewalksDae);
  if (bridgeDaes.length > 0) {
    zip.folder(`${base}/map_assets/custom_assets/bridges`);
    for (const { key, data, deckData } of bridgeDaes) {
      if (data) zip.file(`${base}/map_assets/custom_assets/bridges/bridge_${key}.dae`, await toZipBinary(data));
      if (deckData) zip.file(`${base}/map_assets/custom_assets/bridges/bridge_${key}_deck.dae`, await toZipBinary(deckData));
    }
    zip.file(`${base}/map_assets/custom_assets/bridges/main.materials.json`, JSON.stringify(getBridgeMaterialDefs(), null, 2));
  }
  if (tunnelDaes.length > 0) {
    zip.folder(`${base}/map_assets/custom_assets/tunnels`);
    for (const { key, data } of tunnelDaes) {
      zip.file(`${base}/map_assets/custom_assets/tunnels/tunnel_${key}.dae`, await toZipBinary(data));
    }
    zip.file(`${base}/map_assets/custom_assets/tunnels/main.materials.json`, JSON.stringify(getTunnelMaterialDefs(), null, 2));
  }
  if (powerWireDaes.length > 0) {
    zip.folder(`${base}/map_assets/custom_assets/power_lines`);
    for (const { key, data } of powerWireDaes) {
      zip.file(`${base}/map_assets/custom_assets/power_lines/wires_${key}.dae`, await toZipBinary(data));
    }
    zip.file(`${base}/map_assets/custom_assets/power_lines/main.materials.json`, JSON.stringify(getPowerWireMaterialDefs(), null, 2));
  }
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
    decalRoadCount: decalRoads.length,
    forestPlacements,
    forestFiles,
    groundCoverObjects,
    osmDaeBlob,
    backdropDaeBlob,
    backdropTextureFiles,
    backdropDiagnostics,
    mapngFlagFiles,
    didCropToSquare,
    detail: {
      jobLog,
      buildingReport,
      bridges: decalRoads.bridges,
      bridgeDaes,
      tunnels: decalRoads.tunnels,
      tunnelDaes,
      tunnelLightSpacing: tunnelGroups.lightSpacing,
      groundAtWorld: (x, y) => getTerrainHeightAtWorldXY(x, y, exportTerrainData, squareSize),
      decalRoads,
      sidewalks,
      streetProps,
      mappedStreetProps,
      signalData,
      signObjects,
      trafficSignalObjects,
      streetFurnitureObjects,
      fuelStationObjects,
      barrierObjects,
      calming,
      trafficCalmingObjects,
      bollardPlacement,
      curveWarnings,
      forestPlacements,
      groundCoverObjects,
      waterObjects,
      pbrResult,
    },
  });
  zip.file(`${base}/export_report.txt`, reportContents);

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
  if (osmDaeData || sidewalksDae || backdropDaeData || mapngFlagFiles.length > 0) {
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
        },
        ...getBuildingMaterialDefs(),
      }, null, 2));
    }
    if (sidewalksDae) {
      zip.folder(`${base}/map_assets/custom_assets/sidewalks`);
      zip.file(`${base}/map_assets/custom_assets/sidewalks/sidewalks.dae`, sidewalksDaeData);
      zip.file(`${base}/map_assets/custom_assets/sidewalks/main.materials.json`, JSON.stringify(getSidewalkMaterialDefs(), null, 2));
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
  // The GroundCover material comes from the first asset set that has one, which
  // need not be the biome's own (West Coast USA borrows East Coast's BNGGrass),
  // so define it from the profile itself or the grass renders "not found".
  const groundCoverProfile = getGroundCoverProfile(biome);
  if (groundCoverProfile?.materialName && groundCoverProfile.materialDef && !biomeRuntimeDefs[groundCoverProfile.materialName]) {
    biomeRuntimeDefs[groundCoverProfile.materialName] = groundCoverProfile.materialDef;
  }
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
    ...(trafficSignalObjects.length > 0 ? [{
      __parent: 'MissionGroup',
      class: 'SimGroup',
      name: 'traffic_signals',
      persistentId: generatePersistentId(),
    }] : []),
    ...(trafficCalmingObjects.length > 0 ? [{
      __parent: 'MissionGroup',
      class: 'SimGroup',
      name: 'traffic_calming',
      persistentId: generatePersistentId(),
    }] : []),
    ...(fuelStationObjects.length > 0 ? [{
      __parent: 'MissionGroup',
      class: 'SimGroup',
      name: 'gasStations',
      persistentId: generatePersistentId(),
    }] : []),
    ...(decalRoads.length > 0 ? [{
      __parent: 'MissionGroup',
      class: 'SimGroup',
      name: 'Decal_Roads',
      persistentId: generatePersistentId(),
    }] : []),
    ...(tunnelGroups.items.length > 0 ? [{
      __parent: 'MissionGroup',
      class: 'SimGroup',
      name: 'tunnels',
      persistentId: generatePersistentId(),
    }] : []),
  ];
  zip.file(`${base}/main/MissionGroup/items.level.json`, toNDJSON(missionGroupItems));

  const rewriteForLinks = (value) => linkRegistry.rewriteObjectPathsDeep(value);
  const rewrittenBarrierFolderItems = rewriteForLinks(barrierFolderItems);
  const rewrittenSignObjects = rewriteForLinks(signObjects);

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

  // ── main/MissionGroup/traffic_signals/items.level.json ──────────────────
  // Signal posts + heads; each head names its signals.json instance
  // (signalInstance) so core_trafficSignals lights it with the AI's phase.
  if (trafficSignalObjects.length > 0) {
    zip.file(`${base}/main/MissionGroup/traffic_signals/items.level.json`, toNDJSON(rewriteForLinks(trafficSignalObjects)));
  }

  // ── main/MissionGroup/traffic_calming/items.level.json ──────────────────
  // Speed bumps / cushions (Driver Training modules) and humps / tables
  // (Gridmap pieces); rewriteForLinks registers their .link files.
  if (trafficCalmingObjects.length > 0) {
    zip.file(`${base}/main/MissionGroup/traffic_calming/items.level.json`, toNDJSON(rewriteForLinks(trafficCalmingObjects)));
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

  // ── main/MissionGroup/Decal_Roads/items.level.json ────────────────────────
  if (decalRoads.length > 0) {
    writeSimGroupTree(zip, `${base}/main/MissionGroup/Decal_Roads`, decalRoads);
  }

  // ── main/MissionGroup/tunnels/… ─────────────────────────────────────────
  // One SimGroup per tunnel: tube pieces + portals, ceiling lights (wcusa
  // fixture, .link registered by rewriteForLinks), Zones / Portals / ambience.
  if (tunnelGroups.items.length > 0) {
    zip.folder(`${base}/main/MissionGroup/tunnels`);
    writeSimGroupTree(zip, `${base}/main/MissionGroup/tunnels`, rewriteForLinks(tunnelGroups.items));
  }


  // Base maps include these groups even when empty.
  zip.file(
    `${base}/main/MissionGroup/AIWaypointsGroup/items.level.json`,
    ''
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
        time: 0.15,
        play: false,
        latitude: roundTo(center.lat, 6),
        longitude: roundTo(center.lng, 6),
        ...skyDate,
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
    position: [-halfExtent, -halfExtent, terrainBlockZ],
    squareSize,
    maxHeight: terrainBlockMaxHeight,
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



  if (sidewalksDae) {
    // Curbs collide; decals don't project onto them (edge blends stay on the ground).
    levelObjectItems.push({
      __parent: 'level_objects',
      class: 'TSStatic',
      name: 'sidewalks',
      persistentId: generatePersistentId(),
      position: [0, 0, 0],
      shapeName: `/levels/${levelName}/map_assets/custom_assets/sidewalks/sidewalks.dae`,
      collisionType: 'Collision Mesh',
      decalType: 'None',
      prebuildCollisionData: 0,
      useInstanceRenderData: true,
    });
  }

  // Bridge decks, two objects per bridge, both colliding: the road surface,
  // which the road decals project onto, and the rest (parapets, sides,
  // girders, piers), which they must not smear down (decalType: None).
  for (const { key, origin, data, deckData } of bridgeDaes) {
    if (data) {
      levelObjectItems.push({
        __parent: 'level_objects',
        class: 'TSStatic',
        name: `bridge_${key}`,
        persistentId: generatePersistentId(),
        position: origin,
        shapeName: `/levels/${levelName}/map_assets/custom_assets/bridges/bridge_${key}.dae`,
        collisionType: 'Collision Mesh',
        decalType: 'None',
        prebuildCollisionData: 0,
        useInstanceRenderData: true,
      });
    }
    if (deckData) {
      levelObjectItems.push({
        __parent: 'level_objects',
        class: 'TSStatic',
        name: `bridge_${key}_deck`,
        persistentId: generatePersistentId(),
        position: origin,
        shapeName: `/levels/${levelName}/map_assets/custom_assets/bridges/bridge_${key}_deck.dae`,
        collisionType: 'Collision Mesh',
        prebuildCollisionData: 0,
        useInstanceRenderData: true,
      });
    }
  }

  // Overhead wires, one object per tile so the engine culls them by tile.
  for (const { key } of powerWireDaes) {
    levelObjectItems.push({
      __parent: 'level_objects',
      class: 'TSStatic',
      name: `power_wires_${key}`,
      persistentId: generatePersistentId(),
      position: [0, 0, 0],
      shapeName: `/levels/${levelName}/map_assets/custom_assets/power_lines/wires_${key}.dae`,
      collisionType: 'None',
      decalType: 'None',
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
    requiresBarriers: barrierFolderItems.length > 0,
    requiresSigns: signObjects.length > 0,
    requiresDecalRoads: decalRoads.length > 0,
  });

  // JSZip's percent counts files, so one 1 GB terrain.ter held it at 5 %
  // for over a minute: weigh each entry by its cost (per file + per MB).
  const zipEntries = Object.values(zip.files).filter((f) => !f.dir);
  const entryCost = (name) => ZIP_FILE_COST_S + ((zipEntryBytes.get(name) || 0) / 1048576) * ZIP_MB_COST_S;
  const zipTotalBytes = zipEntries.reduce((n, f) => n + (zipEntryBytes.get(f.name) || 0), 0);
  const zipTotalCost = zipEntries.reduce((n, f) => n + entryCost(f.name), 0);
  beginStep('compress', `Compressing ${zipEntries.length} files (${formatBytes(zipTotalBytes)}) into the level ZIP…`);
  await yield_();
  const zipFilename = `${levelName}.zip`;
  let zipCostDone = 0;
  let zipCurrentFile = null;
  let lastZipReportAt = 0;
  const onZipPercent = (pct, currentFile) => {
    if (currentFile && currentFile !== zipCurrentFile) {
      if (zipCurrentFile) zipCostDone += entryCost(zipCurrentFile);
      zipCurrentFile = currentFile;
    }
    const now = performance.now();
    if (now - lastZipReportAt < 250) return;
    lastZipReportAt = now;
    const fraction = zipTotalCost > 0 ? zipCostDone / zipTotalCost : (Number(pct) || 0) / 100;
    const current = zipCurrentFile && !zipCurrentFile.endsWith('/')
      ? ` ${zipCurrentFile.replace(`levels/${levelName}/`, '')} (${formatBytes(zipEntryBytes.get(zipCurrentFile) || 0)})`
      : '';
    report(`Compressing the level ZIP (${formatBytes(zipTotalBytes)}, ${zipEntries.length} files):${current}…`, fraction);
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
  finishProcessingLog();
  lastPct = 100;
  onProgress?.({ step: 'Done', pct: 100, elapsedMs: performance.now() - exportT0, completed: processingLog[processingLog.length - 1] ?? null });
  console.log(`${BEAMNG_EXPORT_SERVICE_LOG} Completed exportBeamNGLevel`);
  return { blob: zipBlob, filename: `${levelName}.zip` };
}
