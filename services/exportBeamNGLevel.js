import * as THREE from 'three';
import { backgroundLookup, filterFeaturesByBackground, rawWeightLookup } from './backgroundMask.js';
import { replayingSources } from './sourceWording.js';
import JSZip from 'jszip';
import { createZipCompressor, precompressZipEntries } from './zipCompress.js';
import { chooseBaseTextureSize } from './baseTextureSize.js';
import { encode } from 'fast-png';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { exportTer } from './exportTer.js';
import { buildTerrainMaterials, isVegetationColor } from './osmTerrainMaterials.js';
import { createOSMGroup, createSurroundingMeshes, SCENE_SIZE } from './export3d.js';
import { planPools, poolFootprints, poolWaterBlocks, squareOpens, POOL_WATER_BLOCK } from './pools.js';
import { planDams, damAt, damGuardrails, damTopGeometry, assignDamAxes } from './dams.js';
import { planFountains, fountainFootprints, fountainWaterBlocks } from './fountains.js';
import { streetIndex } from './buildingDetails.js';
import { planPitches, pitchFootprints } from './sportsFields.js';
import { findBridgeTowers, towerPierGeometry, towerHouseTags } from './bridgeTowers.js';
import { buildTexturedBuildings, buildingContext, screenBuilding, getBuildingMaterialDefs, garageExtras, isGarageFeature, FACADE_EMISSIVE_FILE, BUILDING_TILE_M, letterName } from './beamngBuildings.js';
import { isCarportFeature, planCarports } from './beamngCarports.js';
import { placeTrafficCalming } from './trafficCalming.js';
import { placeBollards } from './bollards.js';
import { planGates, gateLeaves, splitAtCuts, isGateBarrier } from './gates.js';
import { carveLakeBeds, carveWaterUnderDecks, fillRemnants, levelUnderDecks, lowerSeabed, planLakes, planRivers } from './beamngWater.js';
import { tunnelDryZones, tunnelsBelow, planSeaBlocks, clipRiverNodes, clipLakeTile, splitLakeTile, hasInlandBelowSea } from './beamngWaterClip.js';
import { placeCurveWarnings } from './curveWarningSigns.js';
import { chooseTreeGroup, chooseTreeItem, treeHintFromTags, treeItemHeight, understoryGroup } from './beamngTrees.js';
import { openWaterAtEdge, plantAllowed, WORLDCOVER_ATTRIBUTION } from './worldCover.js';
import { TREE_MIX_CREDIT } from './treeSpecies.js';
import { placeBoats } from './boats.js';
import { GROUND_CLASSES, satelliteGroundClasses } from './osmTexture.js';
import { SHAPE_IMPOSTER_FILES } from './beamngTreeLibrary.js';
import { prepareCroppedTerrainData, cropHeightmap, cropOSMFeatures, adjustBounds } from './cropTerrain.js';
import { stepHash, cachedStep, terrainFingerprint } from './stepCache.js';
import { sanitizePoints, planSpawnPoints, spawnReportLines } from './spawnPoints.js';
import { renderSpawnPreviews } from './spawnPreview.js';
import { backdropHeightSampler, planBackdropWater, insidePart } from './backdropWater.js';

// (the build, in the step cache keys of steps whose code spans many modules:
// a new build makes them again; no build constant (Node tests): those steps
// aren't cached unless options.stepCodeVersion names the code)
const STEP_CODE_BUILD = typeof __BUILD_HASH__ !== 'undefined' && typeof __BUILD_TIME__ !== 'undefined' ? `${__BUILD_HASH__}@${__BUILD_TIME__}` : null;
const jsonOf = (v) => JSON.stringify(v, (k, x) => (x instanceof Map ? [...x.values()] : x instanceof Set ? [...x] : x));
import { gradeGarageFootprints } from './buildingFoundations.js';
import { ColladaExporter } from './ColladaExporter.js';
import { DAE_OPTIONS, describeScene, writeDae } from './daeWorker.js';
import { geoToWorldPoint, getTerrainHeightWorld, terrainDrape, terrainGroundAt } from './terrainLookup.js';
import { pickFlagCell } from './flagPlacement.js';
import { BUILDING_LITE_FROM_M, buildingTileScene } from './buildingTiles.js';
import { parallelMap, parallelThreads } from './parallel.js';
import { measureStructures, roadLinesFromDecals } from './structures/metrics.js';
import { buildStructureGraph } from './structures/graph.js';
import { findCrossings } from './structures/crossings.js';
import { solveProfilesSteps } from './structures/profileSolve.js';
import { classifyStructures } from './structures/structureRules.js';
import { composeTerrain } from './structures/terrainCompose.js';
import { addFineGroundDetail } from './terrainDetail.js';
import { findPortalBuildings, portalBuildingTags } from './portalBuildings.js';
import { styleDecks, linkCrossings, linkArchCrossings, thinArchDecks, buildStyleGeometry, PAINTS as BRIDGE_PAINTS } from './bridgeStyles.js';
import { prepareSurvey, lidarPins } from './lidarDecks.js';
import { buildLampGlowDAE, lampGlowMaterialDef, LAMP_GLOW_SHAPE, buildFloodGlowDAE, floodGlowMaterialDef, FLOOD_GLOW_SHAPE } from './lampGlow.js';
import { resolveBuildingRoadConflicts } from './buildingRoadConflicts.js';
import { shapingSwitches, allShaping, shapingPlan, rawDeckClasses } from './structures/shaping.js';
import { decksFromSolver, applySolvedHeights, roadLinesFromSolver, solvedHeightAt } from './structures/adapters.js';
import { checkJoints, checkGrades, checkCrossings, checkRoadSurface } from './structures/metrics.js';
import { buildRoadNetwork, getEffectiveRoadLayer, makeRoadNodeKey, mergeLinearRoadSegments } from './roadNetwork.js';
import { createBeamNGLinkFileRegistry } from './beamngLinkFiles.js';
import { getBiomeRuntimeMaterialDefs } from './beamngRuntimeMaterialCatalog.js';
import { getFuelStationRuntimeMaterialDefs } from './beamngFuelStationMaterials.js';
import { stationCanopies, islandsUnder, islandOrigin, islandBays, islandBesideRoad, inRing as inFuelRing } from './fuelStations.js';
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
import { buildIngameProbes } from './ingameProbes.js';
import { smoothLine } from './lineSmoothing.js';
import { buildPlazaMeshes, courtyardPathHalf, courtyardPaved, getPlazaMaterialDefs, isCourtyard, isPlaza, plazaSurface } from './plazas.js';
import { buildSidewalkMeshesParallel, cornerPatches, inferCrossingSidewalks, buildWallDeckMesh, gutterLines, isCurbedClass, lowerUnderWallDecks, checkSidewalkGround, CURB_ONLY_M, ZEBRA_CROSSING_MATERIAL, gradeSidewalkGround, getSidewalkMaterialDefs, SIDEWALK_MATERIALS, sidewalkFootways, streetSides, DEFAULT_SIDEWALK_LOOK } from './beamngSidewalks.js';
import { buildRoadNameZones } from './roadNameZones.js';
import { placeStreetProps, POLE_LAMP_REACH_M, POLE_TYPES, hash01 as propHash, roadsidePolesRegion } from './streetProps.js';
import {
  solveBridgeDecks, widenDecksForSidewalks, deckHeightAt, buildDeckGeometry, hitsDeck, alongDeck, newBridgeBuilder, deckDepthOf, deckEdges,
  liftFor, rampLength, rampLift, resample, RAMP_SHOULDER_M, RAMP_SIDE_SLOPE, PARAPET_W_M, DECK_MAX_GRADE, DECK_ROAD_CLEAR_M,
} from './beamngBridges.js';
import {
  solveTunnel, chainTunnelParts, absorbBranch, nearestOnTunnel, isBoredTunnelTag, isGalleryTag, tunnelRoadZ, tunnelGroundAt, tunnelHoleAt, lowMouthHoleAt, tunnelReach,
  hitsTunnel, buildTubeGeometry, buildPortalGeometry, buildWindowGeometry, buildTunnelObjects, fitBesideRoads, LIGHT_SPACING_M, LINING_M, extraAt,
  galleryRoofHalf,
} from './beamngTunnels.js';
import {
  PROP_HYDRANT, PROP_BINS, PROP_SHAPES, US_SIGN_SHAPES, STREET_LIGHT_SHAPES, SIGNAL_MAST, POWER_WIRE_MATERIAL, getPowerWireMaterialDefs,
  BARRIER_SHAPES, CARPORT_SHAPE,
} from './beamngPropLibrary.js';
import {
  buildCarriagewayIndex,
  carriagewaysAt,
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
import { planRaceways } from './racetracks.js';
import { backdropImageryFetch } from './backdropImagery.js';
import { RAIL_DEPTH_M, railHalfWidth, railKindOf, railSegmentsFrom, streetRunningTest, undergroundRailIds } from './railways.js';
import { prepareRailEdges, unjoinedRailCrossings, markUnjoinedCrossing, buildTrackGeometry, crossingDecals, streetTramDecals, railMaterialDefs, RAIL_MATERIALS, TRAMLINE_MATERIAL, railwayStats } from './railTrack.js';
// footways and other paths: a level crossing of one is a foot crossing
const PATH_HIGHWAYS = new Set(['footway', 'cycleway', 'path', 'pedestrian', 'steps', 'bridleway']);
import { POLE_SHAPE, POLE_SHAPE_HEIGHT_M, beamRotation } from './sportsLights.js';
import {
  buildCurbedStreetClassifier, buildUrbanRoadClassifier,
  estimateRoadCrossSection,
  estimateRoadHalfWidth,
  getDefaultLaneCount,
  getDefaultLaneWidthMeters,
  isOneWayRoad,
  NON_DRIVEABLE_HIGHWAYS,
  racewayKind,
  streetParkingSide,
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
import { contentExportOptions, contentOn, filterOsmByTags, filterWaterKinds, filterFootBridges } from './buildContent.js';

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

// Whether the segment a-b crosses the bounds (Liang-Barsky clip in lat/lng).
function segmentCrossesBounds(a, b, bounds) {
  if (!a || !b) return false;
  let t0 = 0; let t1 = 1;
  const dx = b.lng - a.lng; const dy = b.lat - a.lat;
  for (const [p, q] of [[-dx, a.lng - bounds.west], [dx, bounds.east - a.lng], [-dy, a.lat - bounds.south], [dy, bounds.north - a.lat]]) {
    if (p === 0) { if (q < 0) return false; continue; }
    const r = q / p;
    if (p < 0) { if (r > t1) return false; if (r > t0) t0 = r; } else { if (r < t0) return false; if (r < t1) t1 = r; }
  }
  return true;
}

/**
 * Keep only OSM features whose geometry intersects the provided bounds:
 * a point in bounds, or a segment crossing them (a bridge's long span over a
 * river with its vertices on either bank, outside the area, was dropped
 * whole: Brooklyn Bridge in an export centred on the river).
 */
function filterOSMFeaturesToBounds(features, bounds) {
  if (!Array.isArray(features)) return [];
  return features.filter((feature) => {
    const g = feature?.geometry;
    if (!Array.isArray(g) || g.length === 0) return false;
    return g.some((pt, i) => pointInBounds(pt, bounds) || (i > 0 && segmentCrossesBounds(g[i - 1], pt, bounds)));
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
export function computeBeamNGTerrainSize(width, height) {
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
  // (the game's grid: services/terrainLookup.js)
  const fx = Math.max(0, Math.min(width - 1, u * width));
  const fy = Math.max(0, Math.min(height - 1, v * height - 1));
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

  // (a vehicle spawned at a sphere faces the sphere's -Y, its JBeam forward:
  // the sphere's +Y points back down the road, so the car faces ptA -> ptB;
  // measured in game 2026-11-09, the old +Y-forward matrix spawned it facing
  // backwards in its lane)
  const nx = -dx / len;
  const ny = -dy / len;

  // Rotation matrix rows: right (ny, -nx, 0), +Y (nx, ny, 0), up (0, 0, 1).
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
        // rows: right, +Y, up; the car faces the sphere's -Y, so +Y points
        // back (f): with +Y along f it sat in its lane facing against traffic
        rotationMatrix: [roundTo(-fy, 6), roundTo(fx, 6), 0, roundTo(-fx, 6), roundTo(-fy, 6), 0, 0, 0, 1],
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
    } else if (textureType === 'game') {
      if (terrainData.gameTextureCanvas) return new Promise(r => terrainData.gameTextureCanvas.toBlob(r, 'image/png'));
      if (terrainData.gameTextureBlob) return terrainData.gameTextureBlob;
      if (terrainData.gameTextureUrl) return await urlToPngBlob(terrainData.gameTextureUrl);
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
// Signs off the drawn roads: one standing on a carriageway (or within
// SIGN_ROAD_CLEAR_M of its edge: the sign code steps out by OSM's estimated
// width, the road drawn is often wider) goes straight away from the nearest
// one until clear, up to SIGN_SHIFT_MAX_M, onto the verge, the sidewalk or the
// median; no ground there, it's left out. Each on the finished ground.
const SIGN_ROAD_CLEAR_M = 0.6;
const SIGN_SHIFT_MAX_M = 6;
export function settleSigns(signs, { index, groundAt }) {
  let moved = 0; let dropped = 0;
  const out = [];
  for (const sign of signs) {
    const [x, y] = sign.position;
    let at = [x, y];
    const hits = carriagewaysAt(index, x, y, SIGN_ROAD_CLEAR_M);
    if (hits.length) {
      // the way out: from the nearest road's centre line through the sign
      let best = null;
      for (const s of index.segments) {
        const dx = s.bx - s.ax; const dy = s.by - s.ay; const L2 = dx * dx + dy * dy || 1;
        const t = Math.max(0, Math.min(1, ((x - s.ax) * dx + (y - s.ay) * dy) / L2));
        const cx = s.ax + dx * t; const cy = s.ay + dy * t; const d = Math.hypot(x - cx, y - cy);
        if (!best || d < best.d) best = { d, cx, cy, nx: -dy, ny: dx };
      }
      let ox = x - best.cx; let oy = y - best.cy; let L = Math.hypot(ox, oy);
      if (L < 0.05) { const nl = Math.hypot(best.nx, best.ny) || 1; ox = best.nx / nl; oy = best.ny / nl; L = 1; } else { ox /= L; oy /= L; }
      at = null;
      for (let r = 0.25; r <= SIGN_SHIFT_MAX_M; r += 0.25) {
        const px = x + ox * r; const py = y + oy * r;
        if (!carriagewaysAt(index, px, py, SIGN_ROAD_CLEAR_M).length) { at = [px, py]; break; }
      }
      if (!at) { dropped++; continue; }
      moved++;
    }
    out.push({ ...sign, position: [at[0], at[1], groundAt(at[0], at[1])] });
  }
  return { signs: out, moved, dropped };
}

/**
 * Collada text for many shapes' scenes (root groups, matrices updated), in
 * order: on worker threads where the platform has them (the desktop app's
 * export runner: services/daeWorker.js), else here, a tick between shapes
 * so the page stays responsive.
 */
async function writeDaes(roots) {
  if (roots.length > 1 && (await parallelThreads()) > 1) {
    return parallelMap(roots.map(describeScene), {
      local: writeDae, module: new URL('./daeWorker.js', import.meta.url).href, fn: 'writeDae',
    });
  }
  const out = [];
  for (const root of roots) {
    out.push(new ColladaExporter().parse(root, undefined, DAE_OPTIONS)?.data ?? null);
    await new Promise((r) => setTimeout(r, 0));
  }
  return out;
}

/**
 * The sidewalks cut into square tiles, each its own shape with its own
 * collision mesh: [{ key, data }]. One map-wide shape came apart in the game
 * on a dense 8 km map (10 M vertices in its walk tops, 22 M in its
 * collision): a smeared "rainbow slab" over the city. Tiles also let the
 * engine cull what is out of sight. A triangle goes to the tile its middle
 * is in; the geometry stays in level coordinates (the objects sit at 0,0,0).
 */
async function generateSidewalkTileDAEs(meshes, tileM) {
  if (!meshes.length) return [];
  const tileKey = (x, y) => `${Math.floor(x / tileM)}_${Math.floor(y / tileM)}`.replace(/-/g, 'm');
  // pass 1: triangles per tile, mesh and material
  const counts = new Map();   // `${tile}|${mesh}|${material}` → triangles
  const plans = meshes.map((mesh, mi) => {
    const g = mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry;
    const pos = g.getAttribute('position').array;
    const groups = g.groups.length ? g.groups : [{ start: 0, count: pos.length / 3, materialIndex: 0 }];
    const keys = new Array(pos.length / 9);
    for (const gr of groups) {
      for (let v = gr.start; v + 2 < gr.start + gr.count; v += 3) {
        const o = v * 3;
        const k = `${tileKey((pos[o] + pos[o + 3] + pos[o + 6]) / 3, (pos[o + 1] + pos[o + 4] + pos[o + 7]) / 3)}|${mi}|${gr.materialIndex}`;
        keys[v / 3] = k;
        counts.set(k, (counts.get(k) || 0) + 1);
      }
    }
    return { g, groups, keys };
  });
  // pass 2: each bucket's vertices copied into its own arrays
  const buckets = new Map();
  for (const [k, n] of counts) buckets.set(k, { pos: new Float32Array(n * 9), uv: new Float32Array(n * 6), nrm: new Float32Array(n * 9), at: 0 });
  plans.forEach(({ g, groups, keys }) => {
    const pos = g.getAttribute('position').array;
    const uv = g.getAttribute('uv')?.array;
    const nrm = g.getAttribute('normal')?.array;
    for (const gr of groups) {
      for (let v = gr.start; v + 2 < gr.start + gr.count; v += 3) {
        const b = buckets.get(keys[v / 3]);
        b.pos.set(pos.subarray(v * 3, v * 3 + 9), b.at * 9);
        if (uv) b.uv.set(uv.subarray(v * 2, v * 2 + 6), b.at * 6);
        if (nrm) b.nrm.set(nrm.subarray(v * 3, v * 3 + 9), b.at * 9);
        b.at++;
      }
    }
  });
  // tiles: a mesh per source mesh (its materials as groups) and the collision
  const byTile = new Map();
  for (const [k, b] of buckets) {
    const [tile, mi, mat] = k.split('|');
    if (!byTile.has(tile)) byTile.set(tile, new Map());
    const perMesh = byTile.get(tile);
    if (!perMesh.has(mi)) perMesh.set(mi, []);
    perMesh.get(mi).push({ mat: Number(mat), b });
  }
  const roots = []; const keys = [];
  for (const [tile, perMesh] of [...byTile].sort(([a], [b]) => a.localeCompare(b))) {
    const base00 = new THREE.Group(); base00.name = 'base00';
    const start01 = new THREE.Group(); start01.name = 'start01';
    const collisionParts = [];
    for (const [mi, parts] of perMesh) {
      const src = meshes[Number(mi)];
      const total = parts.reduce((n, p) => n + p.b.at, 0);
      const pos = new Float32Array(total * 9); const uv = new Float32Array(total * 6); const nrm = new Float32Array(total * 9);
      const geo = new THREE.BufferGeometry();
      const materials = Array.isArray(src.material) ? src.material : [src.material];
      const used = [];
      let at = 0;
      for (const { mat, b } of parts.sort((x, y) => x.mat - y.mat)) {
        pos.set(b.pos, at * 9); uv.set(b.uv, at * 6); nrm.set(b.nrm, at * 9);
        geo.addGroup(at * 3, b.at * 3, used.length);
        used.push(materials[mat] || materials[0]);
        at += b.at;
      }
      geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
      geo.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
      const mesh = new THREE.Mesh(geo, used);
      mesh.name = src.name;
      start01.add(mesh);
      collisionParts.push(pos);
    }
    const colPos = new Float32Array(collisionParts.reduce((n, p) => n + p.length, 0));
    let o = 0;
    for (const p of collisionParts) { colPos.set(p, o); o += p.length; }
    const colGeo = new THREE.BufferGeometry();
    colGeo.setAttribute('position', new THREE.BufferAttribute(colPos, 3));
    colGeo.name = 'Colmesh-1';
    const collision = new THREE.Mesh(colGeo, new THREE.MeshBasicMaterial({ name: SIDEWALK_MATERIALS.curb }));
    collision.name = 'Colmesh-1';
    start01.add(collision);
    base00.add(start01);
    base00.updateMatrixWorld(true);
    roots.push(base00); keys.push(tile);
  }
  const data = await writeDaes(roots);
  return keys.map((key, i) => ({ key, data: data[i] })).filter((t) => t.data);
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
export const BRIDGE_STONE_MATERIAL = 'mapng_bridge_stone';
const steelMaterial = (paint) => `mapng_bridge_steel_${paint || 'grey'}`;

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
    // dressed stone (stone deck arches, their piers)
    [BRIDGE_STONE_MATERIAL]: {
      name: BRIDGE_STONE_MATERIAL, mapTo: BRIDGE_STONE_MATERIAL, class: 'Material', version: 1.5, annotation: 'CONCRETE', groundType: 'CONCRETE',
      Stages: [{
        baseColorMap: '/assets/materials/tileable/brick/stone_brick_irregular/t_stone_brick_irregular_b.color.png',
        normalMap: '/assets/materials/tileable/brick/stone_brick_irregular/t_stone_brick_irregular_nm.normal.png',
        roughnessMap: '/assets/materials/tileable/brick/stone_brick_irregular/t_stone_brick_irregular_r.data.png',
        ambientOcclusionMap: '/assets/materials/tileable/brick/stone_brick_irregular/t_stone_brick_irregular_ao.data.png',
        diffuseColor: [0.95, 0.9, 0.82, 1],
      }, {}, {}, {}],
      translucentBlendOp: 'None',
    },
    // painted steel (trusses, arch ribs), one per paint
    ...Object.fromEntries(Object.entries(BRIDGE_PAINTS).map(([paint, rgb]) => [steelMaterial(paint), {
      name: steelMaterial(paint), mapTo: steelMaterial(paint), class: 'Material', version: 1.5, annotation: 'METAL', groundType: 'METAL',
      Stages: [{
        baseColorMap: '/assets/materials/tileable/metal/metal_paint/t_metal_paint_b.color.png',
        normalMap: '/assets/materials/tileable/metal/metal_paint/t_metal_paint_nm.normal.png',
        roughnessMap: '/assets/materials/tileable/metal/metal_paint/t_metal_paint_r.data.png',
        diffuseColor: [...rgb, 1],
        metallicFactor: 0.4,
      }, {}, {}, {}],
      translucentBlendOp: 'None',
    }])),
  };
}

/**
 * Solved bridge decks as Collada shapes, one per bridge (its own object, so it
 * can be picked, moved or deleted, and is culled on its own), with its origin
 * at the bridge's centre: visual mesh + a Colmesh-1 collision copy.
 * Returns [{ key, origin: [x, y, z], data, triangles }].
 */
function generateBridgeDAEs(decks, groundAt, roadLines, groundRoads = [], tops = []) {
  const out = [];
  // one Collada shape (visual mesh + a Colmesh-1 collision copy), origin-relative
  const toDae = ({ positions: pos, uvs }, origin, material = BRIDGE_MATERIAL) => {
    if (!pos.length) return null;
    const positions = Float32Array.from(pos, (v, k) => v - origin[k % 3]);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(uvs), 2));
    geo.computeVertexNormals();
    const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ name: material }));
    mesh.name = 'bridge_deck';
    const colGeo = new THREE.BufferGeometry();
    colGeo.setAttribute('position', new THREE.BufferAttribute(positions.slice(), 3));
    colGeo.name = 'Colmesh-1';
    const collision = new THREE.Mesh(colGeo, new THREE.MeshBasicMaterial({ name: material }));
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
    const g = buildDeckGeometry(deck, { groundAt, roadLines, groundRoads, neighbours: decks.filter((d) => d !== deck).flatMap((d) => d.parts) });
    if (!g.positions.length) return;
    // its style (bridgeStyles.js): steel, concrete and stone apart
    // (a movable span is drawn on a deck of no other style too)
    const style = deck.style || deck.movableSpans?.length ? buildStyleGeometry(deck, { groundAt, newBuilder: newBridgeBuilder, depthOf: deckDepthOf }) : null;
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
    const extras = [];
    // its tower houses' piers (bridgeTowers.js)
    if (deck.towers?.length) {
      const tb = newBridgeBuilder();
      towerPierGeometry(tb, deck.towers, groundAt);
      const d = tb.pos.length ? toDae({ positions: tb.pos, uvs: tb.uv }, origin, BRIDGE_MATERIAL) : null;
      if (d) extras.push({ kind: 'towers', data: d, triangles: tb.pos.length / 9 });
    }
    if (style) {
      for (const [kind, b, material] of [['steel', style.steel, steelMaterial(deck.style?.paint || deck.parts.find((p) => p.paint)?.paint || '')], ['struct', style.concrete, BRIDGE_MATERIAL], ['stone', style.stone, BRIDGE_STONE_MATERIAL], ['cables', style.cable, steelMaterial('black')]]) {
        if (!b.pos.length) continue;
        const d = toDae({ positions: b.pos, uvs: b.uv }, origin, material);
        if (d) extras.push({ kind, data: d, triangles: b.pos.length / 9 });
      }
    }
    if (data || deckData) out.push({ key: `b${String(i + 1).padStart(3, '0')}`, origin, data, deckData, extras, style: deck.style || null, triangles: g.positions.length / 9 + extras.reduce((n, e) => n + e.triangles, 0) });
  });
  // other road surfaces built as decks are (a dam's crest top, services/dams.js):
  // the road decals clip onto them
  tops.forEach((g, i) => {
    if (!g.positions.length) return;
    let x = 0; let y = 0; let zMin = Infinity; const n = g.positions.length / 3;
    for (let k = 0; k < g.positions.length; k += 3) { x += g.positions[k]; y += g.positions[k + 1]; zMin = Math.min(zMin, g.positions[k + 2]); }
    const origin = [Math.round((x / n) * 100) / 100, Math.round((y / n) * 100) / 100, Math.round(zMin * 100) / 100];
    const deckData = toDae(g, origin);
    if (deckData) out.push({ key: `dam${String(i + 1).padStart(2, '0')}`, origin, data: null, deckData, extras: [], style: null, triangles: n / 3 });
  });
  return out;
}

// A railway's track as Collada shapes, one per tile (railTrack.js): a mesh per
// material and a Colmesh-1 of the ballast and the rails' tops.
function railTileDae(tile) {
  const origin = tile.origin;
  const rel = (pos) => Float32Array.from(pos, (v, k) => v - origin[k % 3]);
  const base00 = new THREE.Group();
  base00.name = 'base00';
  const start01 = new THREE.Group();
  start01.name = 'start01';
  const disposables = [];
  for (const [material, part] of Object.entries(tile.parts)) {
    if (!part.pos.length) continue;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(rel(part.pos), 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(part.uv), 2));
    geo.computeVertexNormals();
    const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ name: material }));
    mesh.name = `track_${material.replace(/^mapng_rail_/, '')}`;
    start01.add(mesh);
    disposables.push(geo);
  }
  if (tile.collision.pos.length) {
    const colGeo = new THREE.BufferGeometry();
    colGeo.setAttribute('position', new THREE.BufferAttribute(rel(tile.collision.pos), 3));
    colGeo.name = 'Colmesh-1';
    const collision = new THREE.Mesh(colGeo, new THREE.MeshBasicMaterial({ name: RAIL_MATERIALS.ballast }));
    collision.name = 'Colmesh-1';
    start01.add(collision);
    disposables.push(colGeo);
  }
  base00.add(start01);
  base00.updateMatrixWorld(true);
  const result = new ColladaExporter().parse(base00, undefined, { version: '1.4.1', upAxis: 'Z_UP' });
  for (const g of disposables) g.dispose();
  return result?.data || null;
}

/**
 * The railways of a solved structure graph built for the level: track tiles
 * as Collada shapes, the level crossings' surfaces and the street trams as
 * DecalRoads (the game's tram-rail decal), and the counts for the report.
 */
function buildLevelRailways(sg, terrainData, squareSize, levelName) {
  const segs = sg.railSegments || [];
  const tagsOf = (e) => segs[e.seg]?.tags || {};
  const track = buildTrackGeometry(sg, { tagsOf });
  const daes = [];
  for (const tile of track.tiles) {
    const data = railTileDae(tile);
    if (data) daes.push({ key: tile.key, origin: tile.origin, data, triangles: tile.triangles });
  }
  const props = { renderPriority: 3, textureLength: 40, breakAngle: 1, detail: DECAL_ROAD_DETAIL };
  const decals = [];
  crossingDecals(sg, { tagsOf }).forEach((c, i) => {
    const d = makeRoadDecal(c.nodes, `rail_crossing_${i + 1}`, 'railways', props, TRAMLINE_MATERIAL.name);
    if (d) decals.push(d);
  });
  // trams in their streets: the railway features left out of the graph
  const built = new Set(segs.filter((s) => s.rail).map((s) => s.sourceFeature?.id));
  const toXY = (p) => geoToWorldPoint(p.lat, p.lng, terrainData, squareSize, 0);
  const underground = undergroundRailIds(terrainData.osmFeatures || [], terrainData.bounds);
  const street = (terrainData.osmFeatures || []).filter((f) => f?.type === 'railway' && !built.has(f.id) && !underground.has(f.id)
    && ['tram', 'light_rail'].includes(railKindOf(f.tags)) && f.geometry?.length >= 2);
  let streetTramM = 0;
  streetTramDecals(street.map((f) => ({ xy: f.geometry.map(toXY), tags: f.tags || {} })), (x, y) => getTerrainHeightAtWorldXY(x, y, terrainData, squareSize))
    .forEach((t, i) => {
      for (let k = 1; k < t.nodes.length; k++) streetTramM += Math.hypot(t.nodes[k][0] - t.nodes[k - 1][0], t.nodes[k][1] - t.nodes[k - 1][1]);
      const d = makeRoadDecal(t.nodes, `rail_tram_${i + 1}`, 'railways', props, TRAMLINE_MATERIAL.name);
      if (d) decals.push(d);
    });
  // (the track bed's lines, for what keeps off it: trees, bushes, rocks)
  const lines = sg.edges.filter((e) => e.rail).map((e) => ({ points: Array.from(e.s, (_, i) => [e.x[i], e.y[i]]), half: e.half + 1 }));
  return {
    tiles: track.tiles, daes, decals, lines,
    stats: { ...railwayStats(sg, segs), ...track.stats, crossings: (sg.railCrossings || []).length + (sg.railUnjoined || []).length, streetTramKm: Math.round(streetTramM / 10) / 100, streetTramLines: street.length, levelName },
  };
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
    for (const [k, end, on] of [['a', 'S', t.portals[0]], ['b', 'N', t.portals[1]]]) {
      if (!on) continue;
      const g = buildPortalGeometry(t, end);
      write(t, `portal_${k}`, g);
      // (terrain shaping off: the apron in front of the face, which takes the road decal)
      if (g.apron?.pos.length) write(t, `apron_${k}`, g.apron);
    }
    const windows = buildWindowGeometry(t);
    if (windows) write(t, 'windows', windows);
  }
  return out;
}

// Tunnel lights over the whole level, at most (spaced out beyond it).

/**
 * The 'tunnels' MissionGroup tree: a SimGroup per tunnel holding its
 * structure objects, its lights + fixtures, and its Zones / Portals /
 * ambience. { items, lightCount, zoneCount }.
 */
function buildTunnelGroups(tunnels, daes, levelName) {
  const total = tunnels.reduce((n, t) => n + t.tubeLength, 0);
  const lightSpacing = Math.max(LIGHT_SPACING_M, total / caps.tunnelLights);
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

// (the export report's building stats from several shares: counts added,
// min and max kept, lists joined)
function mergeBuildingStats(into, from) {
  for (const [k, v] of Object.entries(from || {})) {
    if (typeof v === 'number') {
      if (k === 'min') into[k] = Math.min(into[k] ?? Infinity, v);
      else if (k === 'max') into[k] = Math.max(into[k] ?? -Infinity, v);
      else into[k] = (into[k] || 0) + v;
    } else if (Array.isArray(v)) into[k] = [...(into[k] || []), ...v];
    else if (v && typeof v === 'object') into[k] = mergeBuildingStats(into[k] && typeof into[k] === 'object' ? into[k] : {}, v);
    else if (into[k] === undefined) into[k] = v;
  }
  return into;
}

// below this many buildings the threads cost more than they save
const PARALLEL_BUILDINGS_FROM = 1500;

/**
 * The buildings built and written on worker threads (services/buildingWorker.js)
 * where the platform has them: the shared context made here once, the
 * footprints chosen under the cap here (the same ones, in the same order,
 * as one builder would), each tile's buildings a task; fountains, pools,
 * fields, stands and racetracks built here, in tiles of their own. Null
 * where it runs in one thread (the web page), or for a few buildings.
 */
async function buildBuildingsOnWorkers(terrainData, features, project, options) {
  const buildingFeatures = features.filter((f) => f?.type === 'building').length;
  if (buildingFeatures < PARALLEL_BUILDINGS_FROM || (await parallelThreads()) <= 1) return null;
  const ctx = buildingContext(features, project, options.raceways);
  // the footprints that will be built, as the builder would choose them
  const skipped = { badGeometry: 0, tiny: 0, oversize: 0, noGround: 0, overCap: 0 };
  const groups = new Map();   // tile key → features
  let footprints = 0; let chosen = 0;
  for (const f of ctx.features) {
    if (f?.type !== 'building') continue;
    footprints++;
    if (chosen >= options.maxBuildings) { skipped.overCap++; continue; }
    const sc = screenBuilding(f, project, ctx.businessTags);
    if (sc.skip) { skipped[sc.skip] = (skipped[sc.skip] || 0) + 1; continue; }
    chosen++;
    // (the builder's own tile: its ring's mean point)
    let cx = 0; let cy = 0;
    for (const [x, y] of sc.ring) { cx += x; cy += y; }
    const key = `${Math.floor(cx / sc.ring.length / options.tileM)}_${Math.floor(cy / sc.ring.length / options.tileM)}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(f);
  }
  const hotelOf = new Map([...ctx.hotelMain].map(([name, { f }]) => [f, name]));
  // (each task one JSON string: structured-cloning 51k features' objects
  // into the workers took 7 s of this thread)
  const items = [...groups.values()].map((list) => JSON.stringify({
    features: list,
    hints: list.map((f) => ctx.levelsHints.get(f) ?? null),
    business: list.map((f) => ctx.businessTags.get(f) || null),
    hotelMain: list.map((f) => hotelOf.get(f) || null),
  }));
  // the extras a task of their own, first: one thread, the longest task
  // (they ran half as fast here beside the busy workers)
  const slimRaceways = (options.raceways || []).map((cw) => ({ highway: cw.highway, nodes: cw.nodes, half: cw.half, tags: cw.tags, wayId: cw.wayId, oneWay: cw.oneWay }));
  for (const part of ['water', 'fields']) {
    items.unshift(JSON.stringify({
      extras: part, features: ctx.features, raceways: slimRaceways, gateRoads: options.gateRoads || [], dams: options.dams || null,
      maxBuildings: options.maxBuildings, buildingKeys: [...groups.keys()],
    }));
  }
  // (the heightmap in shared memory: every worker reads the same one)
  const hm = terrainData.heightMap;
  const shm = new Float32Array(new SharedArrayBuffer(hm.length * 4)); shm.set(hm);
  const shared = {
    terrain: { bounds: terrainData.bounds, width: terrainData.width, height: terrainData.height, minHeight: terrainData.minHeight, heightMap: shm },
    squareSize: options.squareSize, tileM: options.tileM,
    roads: ctx.features.filter((f) => f?.type === 'road'),
    passages: ctx.streets.passages,
  };
  const shares = await parallelMap(items, {
    local: (item, sh) => import('./buildingWorker.js').then((m) => m.buildBuildingShare(item, sh)),
    module: new URL('./buildingWorker.js', import.meta.url).href, fn: 'buildBuildingShare', shared,
  });
  // (the extras' stats first, as one builder would have them)
  const stats = {}; let count = 0; let meshes = 0; let triangles = 0;
  for (const sh of [shares[1], shares[0], ...shares.slice(2)]) {
    mergeBuildingStats(stats, sh.stats);
    count += sh.count; meshes += sh.meshes; triangles += sh.triangles;
  }
  stats.footprints = footprints;
  // (the workers built only chosen footprints: the skips are all counted here)
  stats.skipped = skipped;
  // (the extras' tiles last, as before: water, then fields; they come as
  // scenes, written now on every thread)
  const extraTiles = [...shares[1].tiles, ...shares[0].tiles];
  const extraData = await parallelMap(extraTiles.map((t) => t.scene), {
    local: writeDae, module: new URL('./daeWorker.js', import.meta.url).href, fn: 'writeDae',
  });
  const tileDaes = [
    ...shares.slice(2).flatMap((sh) => sh.tiles.filter((t) => t.data)),
    ...extraTiles.map(({ scene, ...meta }, i) => ({ ...meta, data: extraData[i] })).filter((t) => t.data),
  ];
  stats.tiles = tileDaes.length;
  return { count, stats, tileDaes, meshes, triangles };
}

async function generateOSMObjectsDAE(terrainData, worldSize, reportStats = null, { raceways = [], gateRoads = [], dams = null, replace = null } = {}) {
  if (!terrainData.osmFeatures?.length) return null;

  // Buildings: textured walls / roofs from BeamNG's own trim sheets, built
  // straight in world space (services/beamngBuildings.js).
  const squareSize = worldSize / terrainData.width;
  // (carports are open roofs on posts: native carport models, not walls)
  // (a filling station's canopy: the game's pump island brings its own)
  const features = terrainData.osmFeatures.filter((f) => !isCarportFeature(f) && !fuelLayout(terrainData, squareSize).used.has(f.id))
    // (copies with export-only tags: a bridge's tower houses on their decks)
    .map((f) => replace?.get(f) || f);
  const project = (lat, lng) => geoToWorldPoint(lat, lng, terrainData, squareSize, 0);
  const buildOptions = { maxBuildings: caps.buildings, tileM: buildingTileSize(worldSize), squareSize, groundAt: terrainGroundAt(terrainData, squareSize), drape: terrainDrape(terrainData, squareSize), raceways, gateRoads, dams };
  const parallel = await buildBuildingsOnWorkers(terrainData, features, project, buildOptions);
  let buildingCount; let buildingStats; let tileDaes; let meshCount; let triangles;
  if (parallel) {
    ({ count: buildingCount, stats: buildingStats, tileDaes, meshes: meshCount, triangles } = parallel);
  } else {
    const built = buildTexturedBuildings(features, project, buildOptions);
    buildingCount = built.count; buildingStats = built.stats; meshCount = built.meshes.length;
    triangles = built.meshes.reduce((n, m) => n + (m.geometry.index?.count ?? m.geometry.getAttribute('position')?.count ?? 0) / 3, 0);
    // (the buildings are their own tile shapes: buildBuildingTileDAEs)
    tileDaes = await buildBuildingTileDAEs(built.tiles || []);
  }
  if (reportStats) {
    reportStats.built = buildingCount;
    reportStats.stats = buildingStats;
    reportStats.meshes = meshCount;
    reportStats.triangles = triangles;
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
  let hasMesh = false;
  osmGroup.traverse(c => { if (c.isMesh) hasMesh = true; });
  if (!hasMesh) return { data: null, tiles: tileDaes };

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

  // (the browser gets the thread back between building the meshes and
  // writing them: together ~15 s for Manhattan's 51k buildings)
  await new Promise((r) => setTimeout(r, 0));
  // Pass base00 directly so it becomes the top-level node in <visual_scene>,
  // matching the reference flag asset structure.
  const result = new ColladaExporter().parse(base00, undefined, { version: '1.4.1', upAxis: 'Z_UP' });
  return { data: result?.data || null, tiles: tileDaes };
}

// Building tiles (beamngBuildings.js): the map's width over this, at least
// BUILDING_TILE_M (a 16 km map: ~1000 shapes of 512 m, not 4000 of 256 m)
const BUILDING_TILES_ACROSS = 32;
const buildingTileSize = (worldSize) => Math.max(BUILDING_TILE_M, worldSize / BUILDING_TILES_ACROSS);

/**
 * One Collada shape per building tile: base00 > start01 > the full meshes
 * (detail size from the tile's radius: shown nearer than about
 * BUILDING_LITE_FROM_M), the lite meshes (down to LITE_DOWN_TO_PX) and the
 * lite geometry again as the collision mesh (Colmesh-1). Positions relative
 * to the tile's origin. Returns [{ key, origin: [x, y], data }].
 */
async function buildBuildingTileDAEs(tiles, { cloneLite = () => true } = {}) {
  const scenes = [];
  for (const t of tiles) {
    scenes.push(buildingTileScene(t, { cloneLite: cloneLite(t) }));
    // (the thread back between tiles: a city is hundreds of them)
    await new Promise((r) => setTimeout(r, 0));
  }
  const data = await writeDaes(scenes.map((sc) => sc.root));
  return scenes.map((sc, i) => ({ ...sc.meta, data: data[i] })).filter((t) => t.data);
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
      // (the seam strips' curtains over a height step are seen from either side)
      doubleSided: true,
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
      doubleSided: true,
      translucentBlendOp: 'None',
    };
  }

  return defs;
}

/**
 * Strips that close the gap between the TerrainBlock and the backdrop's side
 * tiles (BeamNG world coordinates, after the tiles' transform). The inner edge
 * is the terrain's border, sample by sample at the heights the game decodes
 * from terrain.ter (seam.zAt(column, rowFromNorth)), placed as the game places
 * them: x = -half + i·squareSize, y = -half + j·squareSize (j from the south),
 * so the east and north borders sit one square short of +half. The outer edge
 * is the tile's own edge vertices, so the strip meets both without a crack.
 * UVs follow the tile's edge, so each strip wears its tile's texture.
 */
export function buildBackdropSeamStrips(group, worldSize, seam) {
  const { width: W, height: H, squareSize: sq, zAt } = seam;
  const half = worldSize / 2;
  const eps = Math.max(1e-3, sq * 0.05);
  // side → which world axis runs along it, where the tile edge lies, the terrain border
  const SIDES = {
    W: { along: 0, across: 0, edge: -half, inner: (k) => [-half, -half + k * sq, zAt(0, H - 1 - k)], n: H },
    E: { along: 1, across: 0, edge: half, inner: (k) => [-half + (W - 1) * sq, -half + k * sq, zAt(W - 1, H - 1 - k)], n: H },
    S: { along: 0, across: 1, edge: -half, inner: (k) => [-half + k * sq, -half, zAt(k, H - 1)], n: W },
    N: { along: 0, across: 1, edge: half, inner: (k) => [-half + k * sq, -half + (H - 1) * sq, zAt(k, 0)], n: W },
  };
  const out = [];
  group.traverse((child) => {
    if (!child.isMesh) return;
    const pos = child.name.replace('terrain_', '');
    const side = SIDES[pos];
    if (!side) return;
    const P = child.geometry.getAttribute('position');
    const UV = child.geometry.getAttribute('uv');
    if (!child.geometry.getAttribute('normal')) child.geometry.computeVertexNormals();
    const NRM = child.geometry.getAttribute('normal');
    const acrossAxis = side.across === 0 ? 0 : 1;
    const alongAxis = acrossAxis === 0 ? 1 : 0;
    // the tile's edge vertices along the seam, sorted, one per position
    const edge = [];
    const seen = new Set();
    for (let i = 0; i < P.count; i++) {
      const v = [P.getX(i), P.getY(i), P.getZ(i)];
      if (Math.abs(v[acrossAxis] - side.edge) > eps) continue;
      const key = Math.round(v[alongAxis] / eps);
      if (seen.has(key)) continue;
      seen.add(key);
      let nz = [NRM.getX(i), NRM.getY(i), NRM.getZ(i)];
      if (nz[2] < 0) nz = nz.map((c) => -c);
      edge.push({ a: v[alongAxis], p: v, uv: UV ? [UV.getX(i), UV.getY(i)] : [0, 0], n: nz });
    }
    if (edge.length < 2) return;
    edge.sort((p, q) => p.a - q.a);
    // (the tile edge's texture coordinates and normals at a point along the seam)
    const along = (a, key) => {
      if (a <= edge[0].a) return edge[0][key];
      if (a >= edge[edge.length - 1].a) return edge[edge.length - 1][key];
      let lo = 0, hi = edge.length - 1;
      while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (edge[mid].a <= a) lo = mid; else hi = mid; }
      const t = (a - edge[lo].a) / Math.max(1e-9, edge[hi].a - edge[lo].a);
      return edge[lo][key].map((c, k) => c + t * (edge[hi][key][k] - c));
    };
    const inner = [];
    for (let k = 0; k < side.n; k++) {
      const p = side.inner(k);
      inner.push({ a: p[alongAxis], p, uv: along(p[alongAxis], 'uv'), n: along(p[alongAxis], 'n') });
    }
    // zip the two edges by position along the seam
    const verts = [];
    const uvs = [];
    const nrms = [];
    // (every triangle facing up, counter-clockwise seen from above: the game draws
    // one side, and a downward face showed as a dark line or not at all)
    const tri = (x, y, z) => {
      const cross = (y.p[0] - x.p[0]) * (z.p[1] - x.p[1]) - (y.p[1] - x.p[1]) * (z.p[0] - x.p[0]);
      for (const v of cross >= 0 ? [x, y, z] : [x, z, y]) { verts.push(...v.p); uvs.push(...v.uv); nrms.push(...v.n); }
    };
    let i = 0, j = 0;
    while (i < inner.length - 1 || j < edge.length - 1) {
      const nextInner = i < inner.length - 1 ? inner[i + 1].a : Infinity;
      const nextEdge = j < edge.length - 1 ? edge[j + 1].a : Infinity;
      if (nextInner <= nextEdge) { tri(inner[i], inner[i + 1], edge[j]); i++; } else { tri(inner[i], edge[j + 1], edge[j]); j++; }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    // (lit as the ground beside it: the tile edge's normals, not the strip's own
    // steep faces, which drew a dark line along the seam)
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(nrms, 3));
    const mesh = new THREE.Mesh(geo, child.material);
    mesh.name = `seam_${pos}`;
    out.push(mesh);
  });
  return out;
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
// The backdrop's downloads (services/exportData.js fetches the same ahead)
export const BACKDROP_FETCH = Object.freeze({ fetchResolutionCap: 1024, includeSatellite: true, satelliteZoom: 15 });
// (the backdrop's code, in its step cache key: a new version builds it again)
let backdropCode = null;
const BACKDROP_CODE = () => (backdropCode ||= stepHash(STEP_CACHE_VERSION, generateTerrainBackdropDAE.toString(), createSurroundingMeshes.toString(),
  buildBackdropSeamStrips.toString(), buildBackdropMaterialDefs.toString(), JSON.stringify(BACKDROP_FETCH)));
const STEP_CACHE_VERSION = 'steps-1';
async function generateTerrainBackdropDAE(terrainData, worldSize, options = {}) {
  // Zoom 15 gives ~4m/px satellite imagery; 1024px cap avoids canvas-size
  // failures at large resolutions while still giving usable texture quality.
  // Progress: downloads are most of the time (0–85 % of the step), then the
  // tiles' meshes and textures.
  let downloaded = 0;
  const onText = (text) => {
    // USGS / GPXZ backdrops fetch tile by tile: "… for tile NE (3/8)..."
    const m = /^(?:Fetching|Reading saved) .*\((\d+)\/(\d+)\)/.exec(String(text));
    if (m) downloaded = Math.max(downloaded, (Number(m[1]) - 1) / Number(m[2]));
    options.onProgress?.(text, downloaded * 0.85);
  };
  const surroundingGroup = await createSurroundingMeshes(terrainData, onText, 128, {
    ...BACKDROP_FETCH,
    ...backdropImageryFetch({ quality: options.imagery, bounds: terrainData.bounds, stitchLimit: options.stitchLimit }),
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

  // Tile to tile: each tile reads its own heights, so two tiles' shared edge
  // could disagree by a little and show the sky through a hairline; vertices at
  // the same spot get one height (their mean).
  {
    const at = new Map();
    const q = Math.max(1e-3, worldSize * 1e-6);
    surroundingGroup.traverse((child) => {
      if (!child.isMesh) return;
      const P = child.geometry.getAttribute('position');
      for (let i = 0; i < P.count; i++) {
        const key = `${Math.round(P.getX(i) / q)},${Math.round(P.getY(i) / q)}`;
        let e = at.get(key);
        if (!e) { e = { sum: 0, n: 0, refs: [] }; at.set(key, e); }
        e.sum += P.getZ(i); e.n++; e.refs.push(P, i);
      }
    });
    for (const e of at.values()) {
      if (e.n < 2) continue;
      const z = e.sum / e.n;
      for (let k = 0; k < e.refs.length; k += 2) e.refs[k].setZ(e.refs[k + 1], z);
    }
    surroundingGroup.traverse((child) => { if (child.isMesh) child.geometry.getAttribute('position').needsUpdate = true; });
  }

  // The seam: a strip from the terrain's own border samples to each side tile's
  // edge, so nothing shows between them (the terrain ends a square short on the
  // east and north, and its edge bends at every sample where the tile's edge is
  // straight between its vertices).
  if (options.seam) {
    const strips = buildBackdropSeamStrips(surroundingGroup, worldSize, options.seam);
    for (const m of strips) scene.add(m);
  }

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
    // (the tiles' elevations, coarse: the water carried out over the backdrop)
    heights: surroundingGroup.userData?.surroundingHeights ?? null,
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
function clipGeometryToMargin(geometry, bounds, margin = ROAD_EDGE_MARGIN) {
  const lo = margin, hi = 1 - margin;
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
//
// (ease tight nodes below, before a road is cut into pieces)
//
// A wide road is cut shorter still: the engine captures the terrain triangles
// under each piece and caps what one piece holds, so past it the rest of a
// long wide piece silently drew nothing (a 12 m drag strip in 500 m pieces
// on 1 m terrain lost its asphalt midway while its narrow lines drew; the
// DecalRoad docs: split long, wide roads). DECAL_PIECE_AREA_M2 a piece.
const DECAL_PIECE_AREA_M2 = 2400;
/**
 * A road's points cut where it steps onto or off a dam (dams.js), each piece
 * sharing its end node with the next: the game's decal draws on a dam's crest
 * object only as a piece of its own, as on a bridge deck.
 */
export function splitAtDams(points, dams, toWorld) {
  if (!dams?.length || points.length < 3) return [points];
  const on = points.map((pt) => { const [x, y] = toWorld(pt); return !!damAt(dams, x, y); });
  if (!on.some(Boolean)) return [points];
  const out = [];
  let start = 0;
  for (let i = 1; i < points.length; i++) {
    if (on[i] === on[i - 1]) continue;
    // (the piece on the dam takes the step's outer node too: its ends reach the rock)
    const cut = on[i] ? i - 1 : i;
    if (cut > start) { out.push(points.slice(start, cut + 1)); start = cut; }
  }
  out.push(points.slice(start));
  return out.filter((p) => p.length >= 2);
}

function chunkPolyline(points, maxNodes = 250, { widthM = 0, spacingM = 0 } = {}) {
  if (widthM > 0 && spacingM > 0) maxNodes = Math.max(20, Math.min(maxNodes, Math.floor(DECAL_PIECE_AREA_M2 / (widthM * spacingM)) + 1));
  if (points.length <= maxNodes) return [points];
  const chunks = [];
  for (let i = 0; i < points.length - 1; i += maxNodes - 1) {
    chunks.push(points.slice(i, i + maxNodes));
  }
  return chunks;
}

// A road node bending tighter than its half width folds the strip's inner edge
// and the engine drops those slices: wedges of missing road, widest on the
// outside of the bend. Nodes bending under TIGHT_FACTOR half widths are pulled
// toward their neighbours until they don't (the road's ends stay, it meets its
// junctions as before). Measured on the node's own turn: over any longer span
// a one-node kink hides.
const TIGHT_FACTOR = 1.5;
const TIGHT_PASSES = 40;
export function easeTightNodes(points, halfWidthM) {
  if (!(points?.length >= 3) || !(halfWidthM > 0)) return points;
  const lat0 = points[0].lat; const mx = 111320 * Math.cos((lat0 * Math.PI) / 180); const my = 111320;
  const xy = points.map((p) => [p.lng * mx, p.lat * my]);
  const limit = TIGHT_FACTOR * halfWidthM;
  const radiusAt = (i) => {
    const a = xy[i - 1]; const b = xy[i]; const c = xy[i + 1];
    const u = [b[0] - a[0], b[1] - a[1]]; const v = [c[0] - b[0], c[1] - b[1]];
    const lu = Math.hypot(...u); const lv = Math.hypot(...v);
    const turn = Math.abs(Math.atan2(u[0] * v[1] - u[1] * v[0], u[0] * v[0] + u[1] * v[1]));
    return turn > 1e-3 ? (lu + lv) / 2 / turn : Infinity;
  };
  let moved = false;
  for (let pass = 0; pass < TIGHT_PASSES; pass++) {
    const tight = [];
    for (let i = 1; i < xy.length - 1; i++) if (radiusAt(i) < limit) tight.push(i);
    if (!tight.length) break;
    moved = true;
    // the node and its neighbours toward the mean of theirs (the ends pinned)
    const next = new Map();
    for (const t of tight) for (let i = Math.max(1, t - 2); i <= Math.min(xy.length - 2, t + 2); i++) next.set(i, [(xy[i - 1][0] + xy[i + 1][0]) / 2, (xy[i - 1][1] + xy[i + 1][1]) / 2]);
    for (const [i, q] of next) xy[i] = [xy[i][0] * 0.5 + q[0] * 0.5, xy[i][1] * 0.5 + q[1] * 0.5];
  }
  return moved ? points.map((p, i) => ({ ...p, lat: xy[i][1] / my, lng: xy[i][0] / mx })) : points;
}

// Target spacing (metres) for road nodes.  OSM way geometry is irregular —
// ~1–2 m in dense urban areas but often 20–50 m+ on rural straightaways, where
// a vertex is only dropped at curves.  We resample every road centerline to this
// uniform spacing BEFORE converting to world space, so that (a) the spline never
// draws a long straight chord between sparse vertices, and (b) every node samples
// the real terrain height at its own position (via geoToWorld) and the road hugs
// the terrain instead of floating over valleys / cutting through crests.
const ROAD_NODE_SPACING_M = 2.0;

// Content caps: safety ceilings on how much of each kind an export builds.
// None is a documented BeamNG limit (the docs give budgets, not numbers):
// these are ours, from BeamNG's own levels and our tests. Safe caps off
// (exportBeamNGLevel's `safeCaps: false`) builds everything the map has.
// Kept either way, being where the game breaks rather than slows: the
// DecalRoad node budget below, the Sites parking spots and GroundCover's
// elements per cell.
export const SAFE_CAPS = Object.freeze({
  buildings: 20000,
  barriers: 50000,         // fence / wall / hedge / guardrail pieces
  streetLamps: 20000,
  benches: 5000,
  poles: 8000,             // utility poles (streetProps.js)
  fuelStations: 200,
  tunnelLights: 4000,
  forestPerType: 75000,    // BeamNG's own levels: up to 72,936 of one item (Cliff)
  forestTotal: 650000,     // Johnson Valley 663,057 forest items
  forestPerArea: 250000,
});
const NO_CAPS = Object.freeze(Object.fromEntries(Object.keys(SAFE_CAPS).map((k) => [k, Infinity])));
let caps = SAFE_CAPS;
/** Safe caps on (the default) or off (everything built); returns the caps in force. */
export function setSafeCaps(on = true) { caps = on ? SAFE_CAPS : NO_CAPS; return caps; }
// Road paint switched off in What to build (services/buildContent.js): lane
// lines and stop bars (markings), crosswalk paint (crosswalks); set once per
// export, as the caps are. The crosswalks' zones stay: kerb ramps meet them.
let paintOn = { markings: true, crosswalks: true };
export function setPaintSwitches({ markings = true, crosswalks = true } = {}) { paintOn = { markings, crosswalks }; return paintOn; }
// BeamNG builds a level's DecalRoads in one pass at load, and past ~800k
// nodes in all that pass draws nothing: a single-tile 8 km export at 8 m/px
// (926k nodes over 1913 km of decal layers) loaded with every road
// invisible (in game, 2026-10-28; 809k still drew). An export whose roads
// would exceed DECAL_NODE_BUDGET at the base spacing spreads its nodes out
// (decals hug the terrain between them anyway); normal exports keep 2 m.
const DECAL_NODE_BUDGET = 650000;
const DECAL_LAYERS_PER_ROAD = 2.3;   // surface, paint and AI layers per road metre, measured
const MAX_ROAD_NODE_SPACING_M = 6;
let roadNodeSpacingM = ROAD_NODE_SPACING_M;

/**
 * The time to stamp the level ZIP's entries with: the local clock, as ZIP
 * times are read (by BeamNG too), written through JSZip, which stores a
 * Date's UTC fields. Stamped with the UTC clock, west of Greenwich every mesh
 * stood hours newer than the shape cache the game writes at load
 * (temp/levels/<level>/…/*.cdae): until that wore off, all ~800 meshes were
 * imported again on every load (an 8 km level: 134 s, not 51 s).
 */
export function zipEntryDate(now = new Date()) {
  return new Date(now.getTime() - now.getTimezoneOffset() * 60000);
}

/** The node spacing that keeps this export's road decals within budget (and sets it). */
export function chooseRoadNodeSpacing(osmFeatures = []) {
  let lengthM = 0;
  for (const f of osmFeatures) {
    if (f?.type !== 'road' || !(f.geometry?.length >= 2)) continue;
    const g = f.geometry;
    for (let i = 1; i < g.length; i++) {
      const dy = (g[i].lat - g[i - 1].lat) * 111320;
      const dx = (g[i].lng - g[i - 1].lng) * 111320 * Math.cos((g[i].lat * Math.PI) / 180);
      lengthM += Math.hypot(dx, dy);
    }
  }
  const nodes = (lengthM / ROAD_NODE_SPACING_M) * DECAL_LAYERS_PER_ROAD;
  roadNodeSpacingM = Math.min(MAX_ROAD_NODE_SPACING_M, ROAD_NODE_SPACING_M * Math.max(1, nodes / DECAL_NODE_BUDGET));
  return { spacing: roadNodeSpacingM, lengthKm: lengthM / 1000, estimatedNodes: Math.round(nodes) };
}
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
// the engine's common decal-road gutter (art/shapes/common/decalroads)
const GUTTER_MATERIAL = 'gutter1';
const GUTTER_WIDTH_M = 0.25;   // (half West Coast USA's 0.5 m: it read too wide on our streets)

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
  edgeDirt: 'm_road_edge_dirt',
  edgeDirtGrass: 'm_road_edge_dirt_grass',
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

// A building part that does not reach the ground (a canopy, a roof over a
// forecourt, an overhang on columns, a bridge between buildings).
function isRaisedBuildingPart(tags = {}) {
  const b = String(tags.building || '').toLowerCase();
  if (['roof', 'canopy', 'carport', 'bridge'].includes(b) || tags['building:part'] === 'roof') return true;
  const minLevel = Number.parseFloat(tags['building:min_level'] ?? tags.min_level);
  const minHeight = Number.parseFloat(tags.min_height);
  return (Number.isFinite(minLevel) && minLevel > 0) || (Number.isFinite(minHeight) && minHeight > 0) || Number.parseInt(tags.layer, 10) > 0;
}

function getDecalMergeStyleKey(segment) {
  const tags = segment?.tags || {};
  return JSON.stringify([
    segment?.highway || tags.highway || '',
    segment?.layer ?? getEffectiveRoadLayer(tags),
    tags.name || '',
    tags.ref || '',
    tags.oneway || '',
    tags.surface || '',
    // (a drawbridge span stays its own segment: the structure solver keeps
    // the whole bridge low by it)
    tags.bridge === 'movable' || (!!tags['bridge:movable'] && tags['bridge:movable'] !== 'no'),
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
  // (mapng:carriageway_width: measured between the street's buildings, streetWidths.js)
  return ['width', 'lanes', 'lanes:forward', 'lanes:backward', 'mapng:carriageway_width']
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
  if (!paintOn.markings) return false;
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
// Width steps between two ways of one street. Where exactly two ways meet
// end to end, nearly straight on, under one name, and one is drawn wider,
// the wider one narrows to the other over its last WIDTH_TAPER_RUN metres per
// metre of difference (a side), at most WIDTH_TAPER_SHARE of its length.
// ways: [{ name, half, xy: [[x, y]...] } | null] by index.
// Returns Map(index -> (x, y, half) => that way's half width at (x, y)).
const WIDTH_TAPER_RUN = 8;
const WIDTH_TAPER_MIN_M = 3;
const WIDTH_TAPER_SHARE = 0.45;
const WIDTH_TAPER_STEP_M = 0.2;
const WIDTH_TAPER_MEET_M = 0.75;
const WIDTH_TAPER_ON_COS = Math.cos((30 * Math.PI) / 180);
export function findWidthTapers(ways) {
  // (ends met by where they lie, not their node keys: two ways sharing an
  // OSM node came out under different keys, and the step stayed)
  const ends = [];
  const grid = new Map();
  const lengthOf = (xy) => xy.reduce((sum, q, i) => (i ? sum + Math.hypot(q[0] - xy[i - 1][0], q[1] - xy[i - 1][1]) : 0), 0);
  ways.forEach((w, k) => {
    if (!w || w.xy.length < 2) return;
    const n = w.xy.length;
    for (const [p, q, atStart] of [[w.xy[0], w.xy[1], true], [w.xy[n - 1], w.xy[n - 2], false]]) {
      const L = Math.hypot(q[0] - p[0], q[1] - p[1]) || 1;
      const end = { k, atStart, p, out: [(q[0] - p[0]) / L, (q[1] - p[1]) / L] };
      const cx = Math.floor(p[0] / WIDTH_TAPER_MEET_M); const cy = Math.floor(p[1] / WIDTH_TAPER_MEET_M);
      let joint = null;
      for (let dx = -1; dx <= 1 && !joint; dx++) {
        for (let dy = -1; dy <= 1 && !joint; dy++) {
          joint = (grid.get(`${cx + dx},${cy + dy}`) || []).find((j) => Math.hypot(j[0].p[0] - p[0], j[0].p[1] - p[1]) < WIDTH_TAPER_MEET_M) || null;
        }
      }
      if (joint) { joint.push(end); continue; }
      joint = [end]; ends.push(joint);
      const key = `${cx},${cy}`;
      if (!grid.has(key)) grid.set(key, []);
      grid.get(key).push(joint);
    }
  });
  const plans = new Map();   // k -> [{ atStart, to, run }]
  for (const list of ends) {
    if (list.length !== 2) continue;
    const [a, b] = list;
    const wa = ways[a.k]; const wb = ways[b.k];
    if (a.k === b.k || !wa.name || wa.name !== wb.name) continue;
    if (a.out[0] * b.out[0] + a.out[1] * b.out[1] > -WIDTH_TAPER_ON_COS) continue;
    const [wide, narrow] = wa.half > wb.half ? [a, b] : [b, a];
    const step = ways[wide.k].half - ways[narrow.k].half;
    if (step < WIDTH_TAPER_STEP_M) continue;
    const run = Math.min(Math.max(WIDTH_TAPER_MIN_M, WIDTH_TAPER_RUN * step), WIDTH_TAPER_SHARE * lengthOf(ways[wide.k].xy));
    if (!plans.has(wide.k)) plans.set(wide.k, []);
    plans.get(wide.k).push({ atStart: wide.atStart, to: ways[narrow.k].half, run });
  }
  const out = new Map();
  for (const [k, list] of plans) {
    const xy = ways[k].xy; const total = lengthOf(xy);
    const stationOf = (x, y) => {
      let best = 0; let d = Infinity; let s = 0;
      for (let i = 0; i + 1 < xy.length; i++) {
        const ex = xy[i + 1][0] - xy[i][0]; const ey = xy[i + 1][1] - xy[i][1]; const L2 = ex * ex + ey * ey || 1;
        const t = Math.max(0, Math.min(1, ((x - xy[i][0]) * ex + (y - xy[i][1]) * ey) / L2));
        const e = Math.hypot(x - xy[i][0] - t * ex, y - xy[i][1] - t * ey);
        if (e < d) { d = e; best = s + t * Math.sqrt(L2); }
        s += Math.sqrt(L2);
      }
      return best;
    };
    out.set(k, (x, y, half) => {
      const st = stationOf(x, y);
      let h = half;
      for (const { atStart, to, run } of list) {
        const d = atStart ? st : total - st;
        // (eased at both ends: no kink where the taper starts or meets the next way)
        if (d < run) { const t = d / run; h = Math.min(h, to + (half - to) * (t * t * (3 - 2 * t))); }
      }
      return h;
    });
  }
  return out;
}

function offsetNodes(nodes, offsetArg, halfWidthArg) {
  if (nodes.length < 2) return [];
  const out = [];
  // (either one value, or each node's: (k) => value)
  const offsetOf = typeof offsetArg === 'function' ? offsetArg : () => offsetArg;
  const halfOf = typeof halfWidthArg === 'function' ? halfWidthArg : () => halfWidthArg;
  for (let i = 0; i < nodes.length; i++) {
    const offset = offsetOf(i); const halfWidth = halfOf(i);
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
    // (and to an open edge: a curb stands at a town street's)
    if (layer.name.startsWith('edge_')) return grassEdgeBlendEnabled && !paving && !options.curbed;
    return true;
  }).map((layer) => {
    if (!layer.name.startsWith('edge_') || options.edgeSeed === undefined) return layer;
    // some variety along the country roads, a road at a time, a side apart
    const pick = (hashString(`${options.edgeSeed}:${layer.name}`) >>> 0) / 4294967296;
    const material = pick < 0.45 ? GLOBAL_DECAL_MATERIALS.edgeAsphaltGrass : pick < 0.8 ? GLOBAL_DECAL_MATERIALS.edgeDirtGrass : GLOBAL_DECAL_MATERIALS.edgeDirt;
    return { ...layer, material };
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
  // a paved raceway: white edge lines, a drag strip's centre line between its two lanes
  if (!isUnpaved && highway === 'raceway') {
    const e = Math.max(0.5, drivingHalfWidth - 0.35);
    for (const [name, off] of [['line_left', -e], ['line_right', e]]) layers.push({ name, material: GLOBAL_DECAL_MATERIALS.lineWhite, width: 0.2, offset: off + laneShift, renderPriority: 1, ...LINE_LAYER_BASE });
    if (racewayKind(tags) === 'drag') layers.push({ name: 'line_center', material: GLOBAL_DECAL_MATERIALS.lineWhite, width: 0.15, offset: laneShift, renderPriority: 2, ...LINE_LAYER_BASE });
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

    // (where the way narrows to the next: the surface and its edges scaled
    // node by node, the lanes kept where they are)
    const scaled = !layer.width;
    const edgeOffset = layer.isEdgeRelative || layer.isEdge;
    const baseNodes = options.halfAt && (scaled || edgeOffset)
      ? offsetNodes(centerNodes, (k) => (edgeOffset ? offset * (options.halfAt[k] / styleHalfWidth) : offset), (k) => (scaled ? width * (options.halfAt[k] / styleHalfWidth) : width))
      : offsetNodes(centerNodes, offset, width);
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
// another road's carriageway this far above or below (the solved road
// heights) is a different level: a stacked deck, a road under a bridge
const PAINT_CUT_LEVEL_M = 3;
function cutPaintAtOtherRoads(paintDecals, index, drivableRoads, ownersAtNode, zones = [], heightOf = null) {
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
    // (a carriageway on another level never cuts it: both decks of a
    // double-deck bridge lost every lane line, each "under" the other)
    const otherLevel = heightOf ? (o, x, y) => {
      const zo = heightOf(o, x, y); const zs = heightOf(owner, x, y);
      return zo !== null && zs !== null && Math.abs(zo - zs) > PAINT_CUT_LEVEL_M;
    } : () => false;
    const runs = cutNodes(decal.nodes, (x, y) => (
      isOnOtherCarriageway(index, x, y, margin, (o) => ignore.has(o) || otherLevel(o, x, y))
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
    for (const r of replacements) {
      if (decal.__owner !== undefined) Object.defineProperty(r, '__owner', { value: decal.__owner, enumerable: false });
      if (decal.__layer !== undefined) Object.defineProperty(r, '__layer', { value: decal.__layer, enumerable: false });
    }
    group.__items.splice(at, 1, ...replacements);
    if (runs.length === 0) removed++;
    pieces += runs.length;
  }
  console.log(`[BeamNG Export] Paint cut at crossing roads: ${paintDecals.length} lines/blends → ${pieces} pieces (${removed} removed entirely).`);
}

// A street paved apart from the one it meets (brick into asphalt) stops where
// its corners begin, a corner radius out from that street's edge, and the
// mouth between them takes the other street's surface (St. Augustine's brick
// lanes end at the cross street's concrete apron, not out across its asphalt).
// Only the lesser street is cut: by class, then plain surface over paving.
const SURFACE_CUT_RADIUS_M = { residential: 3, living_street: 3, unclassified: 3, service: 3, tertiary: 4.5, secondary: 6, primary: 6, trunk: 8 };
const SURFACE_RANK = { motorway: 7, trunk: 6, primary: 5, secondary: 4, tertiary: 3, unclassified: 2, residential: 2, living_street: 1, service: 1 };
const surfaceKeyOf = (tags = {}, americas = false) => {
  const s = String(tags.surface ?? '').trim().toLowerCase();
  return pavingOf(s, { americas }) || (CONCRETE_SURFACES.has(s) ? 'concrete' : UNPAVED_SURFACES.has(s) ? 'unpaved' : 'asphalt');
};
const surfaceLook = (key) => (PAVING_MATERIALS[key]
  ? { material: PAVING_MATERIALS[key].material.name, textureLength: PAVING_MATERIALS[key].tileM }
  : key === 'concrete' ? { material: GLOBAL_DECAL_MATERIALS.concrete, textureLength: SURFACE_TEXTURE_LENGTH.concrete }
    : { material: GLOBAL_DECAL_MATERIALS.asphalt, textureLength: SURFACE_TEXTURE_LENGTH.asphalt });

// a corner's junction: the streets within this reach of its corner point
const CORNER_JUNCTION_REACH_M = 7;
// how finely a street's centre line is tested for where its surface stops
const SURFACE_CUT_STEP_M = 0.25;
const MOUTH_NODE_GAP_M = 0.6;

export function cutSurfaceAtOtherSurfaces(surfaceDecals, carriageways, index, { americas = false, groupOf = () => null } = {}) {
  const byOwner = new Map(carriageways.map((cw) => [cw.owner, { cw, key: surfaceKeyOf(cw.tags, americas) }]));
  const rank = (cw) => (SURFACE_RANK[String(cw.highway).replace(/_link$/, '')] ?? 1) * 2 + (PAVING_MATERIALS[surfaceKeyOf(cw.tags, americas)] ? 0 : 1);
  // does (x, y) lie on (or within a corner radius of) a greater street of another surface?
  const crossAt = (owner, x, y) => {
    const me = byOwner.get(owner);
    if (!me || me.key === 'unpaved') return null;
    let best = null;
    for (const hit of carriagewaysAt(index, x, y, 8)) {
      const o = byOwner.get(hit.owner);
      if (!o || hit.owner === owner || o.key === me.key || o.key === 'unpaved' || rank(o.cw) <= rank(me.cw)) continue;
      const r = Math.max(SURFACE_CUT_RADIUS_M[me.cw.highway] ?? 3, SURFACE_CUT_RADIUS_M[o.cw.highway] ?? 3);
      if (carriagewaysAt(index, x, y, r).some((h) => h.owner === hit.owner)) { best = o; break; }
    }
    return best;
  };
  // Each street is judged along its own centre line, and its side-by-side
  // strips are cut where their stations leave it, so the paving ends in one
  // straight edge square to the street rather than in steps.
  const profiles = new Map();
  const profileOf = (owner) => {
    if (profiles.has(owner)) return profiles.get(owner);
    const me = byOwner.get(owner);
    let prof = null;
    if (me && me.cw.nodes.length >= 2) {
      const n = me.cw.nodes;
      const cum = [0];
      for (let i = 1; i < n.length; i++) cum.push(cum[i - 1] + Math.hypot(n[i][0] - n[i - 1][0], n[i][1] - n[i - 1][1]));
      const length = cum[cum.length - 1];
      const pointAt = (st) => {
        let i = 1;
        while (i < n.length - 1 && cum[i] < st) i++;
        const span = cum[i] - cum[i - 1] || 1;
        const t = Math.max(0, Math.min(1, (st - cum[i - 1]) / span));
        const dx = n[i][0] - n[i - 1][0]; const dy = n[i][1] - n[i - 1][1]; const L = Math.hypot(dx, dy) || 1;
        return { p: [n[i - 1][0] + dx * t, n[i - 1][1] + dy * t, n[i - 1][2] + (n[i][2] - n[i - 1][2]) * t], dir: [dx / L, dy / L] };
      };
      const steps = Math.max(1, Math.ceil(length / SURFACE_CUT_STEP_M));
      const blocked = [];
      for (let k = 0; k <= steps; k++) { const { p } = pointAt((k / steps) * length); blocked.push(crossAt(owner, p[0], p[1])); }
      // the stretches on another street (at the ends, or where it crosses
      // one midway) and the cut stations bounding them
      const spans = [];
      for (let k = 0; k <= steps; k++) {
        if (!blocked[k]) continue;
        let j = k; while (j < steps && blocked[j + 1]) j++;
        spans.push({ a: k ? (k / steps) * length : -Infinity, b: j < steps ? (j / steps) * length : Infinity, other: blocked[k] });
        k = j;
      }
      const cuts = spans.flatMap((sp) => [Number.isFinite(sp.a) ? sp.a : null, Number.isFinite(sp.b) ? sp.b : null]).filter((v) => v !== null).map((st) => ({ st }));
      const stationOf = (x, y) => {
        let best = Infinity; let st = 0;
        for (let i = 1; i < n.length; i++) {
          const ax = n[i - 1][0]; const ay = n[i - 1][1]; const dx = n[i][0] - ax; const dy = n[i][1] - ay; const L2 = dx * dx + dy * dy || 1;
          const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / L2));
          const d = Math.hypot(ax + dx * t - x, ay + dy * t - y);
          if (d < best) { best = d; st = cum[i - 1] + t * Math.sqrt(L2); }
        }
        return st;
      };
      const isCut = (st) => spans.some((sp) => st > sp.a && st < sp.b);
      prof = { n, length, pointAt, stationOf, isCut, cuts, spans, steps };
    }
    profiles.set(owner, prof);
    return prof;
  };
  // move a cut strip end along its strip onto the line square to the street
  // at the cut station
  const squareEnd = (run, atStart, prof) => {
    const e = atStart ? run[0] : run[run.length - 1];
    const q = atStart ? run[1] : run[run.length - 2];
    const st = prof.stationOf(e[0], e[1]);
    const c = prof.cuts.reduce((m, k) => (Math.abs(k.st - st) < Math.abs((m?.st ?? Infinity) - st) ? k : m), null);
    if (!c || Math.abs(c.st - st) > 1.5) return;
    const { p, dir } = prof.pointAt(c.st);
    const d = [e[0] - q[0], e[1] - q[1]]; const along = d[0] * dir[0] + d[1] * dir[1];
    if (Math.abs(along) < 1e-6) return;
    const t = -((e[0] - p[0]) * dir[0] + (e[1] - p[1]) * dir[1]) / along;
    if (Math.abs(t * Math.hypot(d[0], d[1])) > 1.5) return;
    const moved = [e[0] + d[0] * t, e[1] + d[1] * t, e[2] + (e[2] - q[2]) * t, ...e.slice(3)];
    if (atStart) run[0] = moved; else run[run.length - 1] = moved;
  };
  let cut = 0;
  for (const { decal, group, owner } of surfaceDecals) {
    const prof = profileOf(owner);
    if (!prof || !prof.cuts.length) continue;
    const runs = cutNodes(decal.nodes, (x, y) => prof.isCut(prof.stationOf(x, y)));
    if (runs.length === 1 && runs[0].length === decal.nodes.length) continue;
    const at = group.__items.indexOf(decal);
    if (at < 0) continue;
    for (const run of runs) { squareEnd(run, true, prof); squareEnd(run, false, prof); }
    const replacements = runs.map((nodes, k) => {
      const r = { ...decal, name: runs.length > 1 ? `${decal.name}_${k + 1}` : decal.name, persistentId: k === 0 ? decal.persistentId : generatePersistentId(), nodes, ...(decal.startEndFade ? { startEndFade: [0, 0] } : {}) };
      for (const key of ['__owner', '__layer']) if (decal[key] !== undefined) Object.defineProperty(r, key, { value: decal[key], enumerable: false });
      return r;
    });
    group.__items.splice(at, 1, ...replacements);
    cut++;
  }
  // the mouth: the street's own line from the cut on into the other street,
  // at its full width, in the other street's surface
  const fills = [];
  for (const { cw, key } of byOwner.values()) {
    const prof = profileOf(cw.owner);
    if (!prof) continue;
    for (const sp of prof.spans) {
      if (!sp.other || sp.other.key === key) continue;
      const s0 = Math.max(0, sp.a); const s1 = Math.min(prof.length, sp.b);
      if (s1 - s0 < 0.5) continue;
      const pts = [prof.pointAt(s0).p];
      for (let i = 1; i < prof.n.length - 1; i++) {
        const st = prof.stationOf(prof.n[i][0], prof.n[i][1]);
        // (no node right beside the cut: the game's spline overshoots there)
        if (st > s0 + MOUTH_NODE_GAP_M && st < s1 - MOUTH_NODE_GAP_M) pts.push(prof.n[i]);
      }
      pts.push(prof.pointAt(s1).p);
      const nodes = pts.map(([x, y, z]) => [x, y, z, cw.half * 2]);
      const look = surfaceLook(sp.other.key);
      const decal = makeRoadDecal(nodes, sanitizeBeamNGObjectName(`mouth_${cw.owner}_${Math.round(s0)}`), 'road_mouths', { material: look.material, renderPriority: 14, breakAngle: 2, textureLength: look.textureLength, distanceFade: [300, 100] });
      if (decal) fills.push(decal);
    }
  }
  if (cut || fills.length) console.log(`[BeamNG Export] Surfaces cut at other surfaces: ${cut} decals trimmed, ${fills.length} junction mouths in the cross street's surface.`);
  return fills;
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
// small waterways: wetAt gives MINOR_WET over them (water, but no clearance
// lift: a short bridge over a mountain stream is on its road's grade line)
const MINOR_WATERWAYS = new Set(['stream', 'drain', 'ditch']);
const MINOR_WET = 0.5;

// Within this far of an OSM coastline its side decides land or sea (OSM draws
// coastlines with the land on the left): river mouths and bays near the sea
// are often mapped as sea, with no water polygon (the St. Johns at Dames Point).
const COAST_REACH_M = 2000;
const COAST_CELL_M = 256;
// Water within this far of a ship-channel line (waterway tagged ship /
// deep_draft) is a ship channel.
const SHIP_CHANNEL_REACH_M = 150;

/**
 * wetAt(x, y): 0 on land, 0.5 over a stream / drain / ditch only, 1 over OSM water (areas, rivers by a
 * typical width, the sea by its coastline), 2 over a ship channel.
 */
const WATER_AREA_NATURAL = new Set(['strait', 'bay']);
const ROAD_LAYER_MARGIN_M = 0.3;   // asphalt painted this far past a road's drawn edge
const LAKE_KEEP_M = 4;             // no lake bed this far past a ground road's edge (sidewalk + quay)
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
    // (a strait or bay is water too, though parsed as land cover: a river
    // mouth mapped as one, its banks off the map, had no water under its bridge)
    const openWater = WATER_AREA_NATURAL.has(f.tags?.natural);
    if ((f.type !== 'water' && !openWater) || !Array.isArray(f.geometry) || f.geometry.length < 2) continue;
    const xy = f.geometry.map((p) => geoToWorldPoint(p.lat, p.lng, terrainData, squareSize, 0));
    const waterway = openWater ? undefined : f.tags?.waterway;
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
    // (a stream, drain or ditch: minor water, a bridge stays on its road's line over it)
    if (half != null && !closed) add(box, { line: xy, half, ship, minor: MINOR_WATERWAYS.has(waterway) });
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
        if (Math.hypot(q[i][0] + vx * t - x, q[i][1] + vy * t - y) < item.half) { wet = Math.max(wet, item.ship ? 2 : item.minor ? MINOR_WET : 1); break; }
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
  const toPixel = (x, y) => [(x / worldSize + 0.5) * width, ((0.5 - y / worldSize) * height - 1)];
  const toWorld = (c, r) => [((c / width) - 0.5) * worldSize, (0.5 - (r + 1) / height) * worldSize];
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
  const toPixel = (x, y) => [(x / worldSize + 0.5) * width, ((0.5 - y / worldSize) * height - 1)];
  const toWorld = (c, r) => [((c / width) - 0.5) * worldSize, (0.5 - (r + 1) / height) * worldSize];
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
// keepGround: remember each pixel's height before this editor's first
// change (ground(idx)); the others write straight through (a Map of every
// pixel the terrain composer touches took 4 s of a dense 8 km export).
const LOW_MOUTH_CAP_M = 12;

function heightMapEditor(terrainData, { keepGround = false } = {}) {
  const before = keepGround ? new Map() : null;
  return {
    at: (idx) => terrainData.heightMap[idx],
    ground: (idx) => {
      if (!before) throw new Error('heightMapEditor: ground() needs { keepGround: true }');
      return before.has(idx) ? before.get(idx) : terrainData.heightMap[idx];
    },
    set(idx, value) {
      if (!exportHeightMaps.has(terrainData.heightMap)) {
        terrainData.heightMap = terrainData.heightMap.slice();
        exportHeightMaps.add(terrainData.heightMap);
      }
      if (before && !before.has(idx)) before.set(idx, terrainData.heightMap[idx]);
      terrainData.heightMap[idx] = value;
    },
  };
}

/**
 * The ground under sports fields to each one's best-fit plane (least squares
 * over its samples), blended back to the ground round it over FIELD_BLEND_M;
 * roads' ground left. The heightmap's pixels on the terrain's own grid.
 */
const FIELD_BLEND_M = 4;
function gradePitchGround(terrainData, squareSize, pitches) {
  const { width: W, height: H } = terrainData;
  const hm = heightMapEditor(terrainData);
  const sq = squareSize;
  const pos = (c, r) => [(c - W / 2) * sq, (H - 1 - r - H / 2) * sq];
  let fields = 0; let pixels = 0;
  for (const p of pitches) {
    if (p.area > 40000) continue;
    const ring = p.ring;
    let x0 = Infinity; let y0 = Infinity; let x1 = -Infinity; let y1 = -Infinity;
    for (const [x, y] of ring) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
    const c0 = Math.max(0, Math.floor((x0 - FIELD_BLEND_M) / sq + W / 2)); const c1 = Math.min(W - 1, Math.ceil((x1 + FIELD_BLEND_M) / sq + W / 2));
    const r0 = Math.max(0, Math.floor(H - 1 - ((y1 + FIELD_BLEND_M) / sq + H / 2))); const r1 = Math.min(H - 1, Math.ceil(H - 1 - ((y0 - FIELD_BLEND_M) / sq + H / 2)));
    // the plane: least squares over the field's own pixels (off the roads)
    let n = 0; let sx = 0; let sy = 0; let sz = 0; let sxx = 0; let syy = 0; let sxy = 0; let sxz = 0; let syz = 0;
    const cx = (x0 + x1) / 2; const cy = (y0 + y1) / 2;
    for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) {
      const [x, y] = pos(c, r);
      if (!inRingXY(x, y, ring) || (p.onRoad && p.onRoad(x, y))) continue;
      const z = hm.at(r * W + c); const X = x - cx; const Y = y - cy;
      n++; sx += X; sy += Y; sz += z; sxx += X * X; syy += Y * Y; sxy += X * Y; sxz += X * z; syz += Y * z;
    }
    if (n < 20) continue;
    // solve [n sx sy; sx sxx sxy; sy sxy syy] [a b c] = [sz sxz syz]
    const M = [[n, sx, sy, sz], [sx, sxx, sxy, sxz], [sy, sxy, syy, syz]];
    for (let i = 0; i < 3; i++) {
      let piv = i; for (let k = i + 1; k < 3; k++) if (Math.abs(M[k][i]) > Math.abs(M[piv][i])) piv = k;
      [M[i], M[piv]] = [M[piv], M[i]];
      if (Math.abs(M[i][i]) < 1e-9) break;
      for (let k = 0; k < 3; k++) if (k !== i) { const f = M[k][i] / M[i][i]; for (let j = i; j < 4; j++) M[k][j] -= f * M[i][j]; }
    }
    const a = M[0][3] / M[0][0]; const b = M[1][3] / M[1][1]; const cc = M[2][3] / M[2][2];
    if (![a, b, cc].every(Number.isFinite)) continue;
    // (a field steeper than a ramp is not graded: it was mapped on a hillside as it is)
    if (Math.hypot(b, cc) > 0.04) continue;
    const plane = (x, y) => a + b * (x - cx) + cc * (y - cy);
    const distOut = (x, y) => { let best = Infinity; for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) { const [ax, ay] = ring[j]; const [bx, by] = ring[i]; const dx = bx - ax; const dy = by - ay; const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / ((dx * dx + dy * dy) || 1e-9))); best = Math.min(best, Math.hypot(ax + dx * t - x, ay + dy * t - y)); } return best; };
    for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) {
      const [x, y] = pos(c, r);
      if (p.onRoad && p.onRoad(x, y)) continue;
      const inside = inRingXY(x, y, ring);
      const d = inside ? 0 : distOut(x, y);
      if (d > FIELD_BLEND_M) continue;
      const idx = r * W + c; const g = hm.at(idx);
      const f = d / FIELD_BLEND_M; const w = 1 - f * f * (3 - 2 * f);   // (smooth falloff)
      hm.set(idx, g + (plane(x, y) - g) * w); pixels++;
    }
    fields++;
  }
  return { fields, pixels };
}

/**
 * Drag strips graded smooth, whatever the shaping switches say: a real strip
 * is laser-graded to millimetres, the survey under one carries centimetres of
 * noise (VMP: 2.2 cm rms, 123 kinks over 2 cm, 14 cm at the shutdown end) that
 * throw a car about at 150 mph. Along the strip the ground's own profile
 * smoothed over +-DRAG_PROFILE_M (its real grade kept), level across its width
 * and walls, blended back over DRAG_BLEND_M beside and past its ends.
 */
const DRAG_PROFILE_M = 100;
const DRAG_BLEND_M = 6;
export function gradeDragStrips(terrainData, squareSize, carriageways) {
  const strips = planRaceways(carriageways || []).filter((r) => r.kind === 'drag');
  if (!strips.length) return { strips: 0, pixels: 0, before: 0, after: 0 };
  const { width: W, height: H } = terrainData;
  const hm = heightMapEditor(terrainData);
  const sq = squareSize;
  const ground = terrainGroundAt(terrainData, sq);
  const base = Number.isFinite(terrainData.minHeight) ? terrainData.minHeight : 0;
  const pos = (c, r) => [(c - W / 2) * sq, (H - 1 - r - H / 2) * sq];
  let pixels = 0; let before = 0; let after = 0;
  for (const rw of strips) {
    const a = rw.nodes[0]; const b = rw.nodes[rw.nodes.length - 1];
    const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (L < 50) continue;
    const u = [(b[0] - a[0]) / L, (b[1] - a[1]) / L]; const v = [-u[1], u[0]];
    const core = rw.half + 1.2;   // (the strip and its walls)
    // the ground's profile along the strip: the mean across its width every metre
    const n = Math.floor(L) + 1;
    const raw = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      let sum = 0; let k = 0;
      for (let t = -rw.half; t <= rw.half + 1e-6; t += rw.half / 3) { const x = a[0] + u[0] * i + v[0] * t; const y = a[1] + u[1] * i + v[1] * t; const g = ground(x, y); if (Number.isFinite(g)) { sum += g; k++; } }
      raw[i] = k ? sum / k : NaN;
    }
    for (let i = 0; i < n; i++) if (!Number.isFinite(raw[i])) raw[i] = i ? raw[i - 1] : raw.find(Number.isFinite) ?? 0;
    // smoothed twice over +-DRAG_PROFILE_M (the window shrinks at the ends)
    const box = (src) => { const pre = new Float64Array(n + 1); for (let i = 0; i < n; i++) pre[i + 1] = pre[i] + src[i]; const out = new Float64Array(n); for (let i = 0; i < n; i++) { const w = Math.min(DRAG_PROFILE_M, i, n - 1 - i); out[i] = (pre[i + w + 1] - pre[i - w]) / (2 * w + 1); } return out; };
    const prof = box(box(raw));
    const profAt = (s) => { const t = Math.max(0, Math.min(n - 1, s)); const i = Math.min(n - 2, Math.floor(t)); const f = t - i; return prof[i] + (prof[i + 1] - prof[i]) * f; };
    let b0 = 0; for (let i = 0; i < n; i++) b0 += (raw[i] - prof[i]) ** 2;
    const reach = core + DRAG_BLEND_M;
    const xs = [a[0], b[0]].flatMap((x) => [x - reach, x + reach]); const ys = [a[1], b[1]].flatMap((y) => [y - reach, y + reach]);
    const c0 = Math.max(0, Math.floor(Math.min(...xs) / sq + W / 2)); const c1 = Math.min(W - 1, Math.ceil(Math.max(...xs) / sq + W / 2));
    const r0 = Math.max(0, Math.floor(H - 1 - (Math.max(...ys) / sq + H / 2))); const r1 = Math.min(H - 1, Math.ceil(H - 1 - (Math.min(...ys) / sq + H / 2)));
    for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) {
      const [x, y] = pos(c, r);
      const s = (x - a[0]) * u[0] + (y - a[1]) * u[1]; const t = Math.abs((x - a[0]) * v[0] + (y - a[1]) * v[1]);
      // how far outside the graded box (beside it, past its ends)
      const d = Math.hypot(Math.max(0, t - core), Math.max(0, -s, s - L));
      if (d > DRAG_BLEND_M) continue;
      const idx = r * W + c; const g = hm.at(idx);
      const f = d / DRAG_BLEND_M; const w = 1 - f * f * (3 - 2 * f);
      // (the profile is in ground heights, over minHeight; the heightmap absolute)
      hm.set(idx, g + (profAt(s) + base - g) * w); pixels++;
    }
    // (the bumps along its centre line before and after, the worst strip's)
    const g2 = terrainGroundAt(terrainData, sq);
    let a0 = 0; for (let i = 0; i < n; i++) a0 += (g2(a[0] + u[0] * i, a[1] + u[1] * i) - prof[i]) ** 2;
    before = Math.max(before, Math.sqrt(b0 / n)); after = Math.max(after, Math.sqrt(a0 / n));
  }
  return { strips: strips.length, pixels, before, after };
}

/**
 * Shape the ground at every abutment of the solved decks (replaces
 * terrainData.heightMap with a graded copy; the app's own terrain is shared).
 */
export function gradeAbutments(terrainData, squareSize, decks) {
  const { width, height, minHeight } = terrainData;
  const maxHeight = Number.isFinite(terrainData.maxHeight) ? terrainData.maxHeight : Infinity;
  const hm = heightMapEditor(terrainData, { keepGround: true });
  const worldSize = width * squareSize;
  const toPixel = (x, y) => [(x / worldSize + 0.5) * width, ((0.5 - y / worldSize) * height - 1)];
  const toWorld = (c, r) => [((c / width) - 0.5) * worldSize, (0.5 - (r + 1) / height) * worldSize];
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
  const hm = heightMapEditor(terrainData, { keepGround: true });
  const worldSize = width * squareSize;
  const toPixel = (x, y) => [(x / worldSize + 0.5) * width, ((0.5 - y / worldSize) * height - 1)];
  const toWorld = (c, r) => [((c / width) - 0.5) * worldSize, (0.5 - (r + 1) / height) * worldSize];
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
function* solveExportTunnels(drivableRoads, terrainData, squareSize, bridges, halfOf, { done = new Set(), shape = true } = {}) {
  const out = { bySeg: new Map(), tunnels: [], skipped: [], holes: [], graded: new Set(), tube: new Set(), mouth: new Map() };
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
    // (a railway's segment: its tunnels are bored as a road's are)
    if ((!seg.rail && !shouldGenerateDecalRoads(seg.highway, tags)) || !Array.isArray(seg.geometry) || seg.geometry.length < 2) return;
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
    // a bridge road with no deck solved yet (structure solver v2 builds the
    // decks after the tunnels): the portal opens onto the bridge (the Fort
    // Pitt Tunnel onto its bridge's decks, the Liberty Tunnel onto the
    // Liberty Bridge); no cutting, and no approach eased down to the river
    // under the deck (its 'fill' dropped the tunnel with shaping off and its
    // road climbed the hill instead); the solver joins the deck to the portal
    if (best.r.bridgeRoad && !best.r.bridge) return { xy: best.line.map(([x, y]) => [x, y]), onBridge: true };
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
      // (never on along a bridge: the approach ends where the road goes onto one)
      const next = others.filter((r) => !used.has(r) && !r.bridge && !r.bridgeRoad
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
  const absorbedSide = new Set();
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
        if (res.ok) { t.sideRamps = (t.sideRamps || 0) + 1; absorbedSide.add(r); }
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
      if (!a?.xy || Number.isFinite(a.deckZ) || a.onBridge) continue;
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
    // streets crossing over it (not on a bridge): an underpass, dug under
    // them, never a gallery on the surface (a gallery at road level by a
    // harbour slope lifted every street over it onto a deck)
    let streetsOver = false;
    for (const r of others) {
      if (streetsOver) break;
      if (r.bridgeRoad || r.bridge) continue;
      for (let i = 0; i + 1 < xy.length && !streetsOver; i++) if (planCrossingPoints([xy[i], xy[i + 1]], r.xy).length) streetsOver = true;
    }
    // (shaping off on fine elevation: portals at the survey's own portal faces)
    const t = solveTunnel({ xy: bore, half, gallery }, { groundAt, approaches, isFreeEnd, squareSize, streetsOver, raw: !shape && !terrainData?.coarseElevation });
    const osm = path.idx.map((i) => parts[i].osm);
    if (!t.ok) { out.skipped.push({ osm, reason: t.reason, length: t.length }); return null; }
    t.osm = osm;
    t.approachKinds = approaches.map((a) => (!a ? null : Number.isFinite(a.deckZ) ? `bridge (${(a.rock || []).length} rock pts)` : a.onBridge ? 'bridge (deck solved later)' : `road ${Math.round(pathLength(a.xy))} m`));
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
  // the other roads beside them: their ground left alone, walls clear of them
  const besides = others.filter((r) => !usedByApproach.has(r) && !absorbedSide.has(r) && !r.bridge && !r.bridgeRoad && !out.bySeg.has(r.segIndex))
    .map((r) => ({ xy: r.xy, half: halfOf(drivableRoads[r.segIndex]) }));
  for (const t of out.tunnels) if (t.kind !== 'gallery') fitBesideRoads(t, besides, groundAt);
  if (!out.tunnels.length && (early || !galleryPaths.length)) return out;

  // Terrain: graded into the export's copy, then the portal squares opened.
  const { width, height, minHeight } = terrainData;
  const hm = heightMapEditor(terrainData);
  const worldSize = width * squareSize;
  const toPixel = (x, y) => [(x / worldSize + 0.5) * width, ((0.5 - y / worldSize) * height - 1)];
  const toWorld = (c, r) => [((c / width) - 0.5) * worldSize, (0.5 - (r + 1) / height) * worldSize];
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
  const gradeOne = (t) => {
    // (a gallery left ungraded has no hillside brought up to its roof: its concrete back wall instead)
    if (t.kind === 'gallery' && !shape) t.keepWall = true;
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
            const want = shape ? tunnelGroundAt(t, x, y, h) : h;
            if (Math.abs(want - h) > 1e-3) { hm.set(idx, want + minHeight); changed++; if (want < h - CUT_KEEP_M) out.graded.add(idx); }
            // over the tube itself (inside its portals): the tunnel's alone
            const on = t.portals[0] || t.portals[1] ? nearestOnTunnel(t, x, y, t.headHalf) : null;
            if (on && on.into >= 0 && !on.beyond) out.tube.add(idx);
            // the open stretch in front of a face, across the road and its walkways, is the tunnel's too,
            // cut or not: where the ground already stood at the road (a low box's mouth, its lid ending a
            // few metres out), a neighbouring corridor's fill was composed across it, 3 to 5 m of ground
            // in the carriageway (Tignes)
            else if (on && on.into < 0 && !on.beyond && Math.abs(on.d) <= t.W + 1) {
              out.graded.add(idx);
              // (a low box's mouth, on the lanes: nothing built later stands above the road going in.
              // A car park's aisle beside the portal, on the lid in the survey, had its ground composed
              // onto the lane's edge)
              if (t.gradedCover && on.into > -LOW_MOUTH_CAP_M && Math.abs(on.d) <= t.W) out.mouth.set(idx, Math.min(out.mouth.get(idx) ?? Infinity, on.z + minHeight));
            }
          }
        }
      }
    }
    t.gradedPixels = changed;
  };
  // terrain shaping at tunnels switched off: only the tunnels whose roads
  // already meet the ground at their portals are built (no cutting, backfill
  // or cover; the portal holes still open, they change no height); the
  // rest stay roads on the ground
  // On fine elevation (lidar, GPXZ, an upload) a real cut-and-cover tunnel's
  // ramps are in the data already: one that would still dig its trenches
  // deep into ground the data shows at road level doesn't match it (a road
  // tagged tunnel under a deck the ground model removed: a 7-8 m trench by
  // the Tignes dam) and stays a road on the ground. The 30 m data smooths
  // ramps away: there the box is dug as before.
  const fine = !terrainData?.coarseElevation;
  const drop = (t, reason, shaping) => {
    out.tunnels.splice(out.tunnels.indexOf(t), 1);
    for (const [seg, tt] of [...out.bySeg]) if (tt === t) out.bySeg.delete(seg);
    out.skipped.push({ osm: t.osm, reason, length: t.length, ...(shaping ? { shaping: true } : {}) });
  };
  const keepFitting = (list) => list.filter((t) => {
    if (shape) {
      if (!fine || t.kind !== 'cutcover') return true;
      const dig = cutCoverDig(t);
      if (dig <= CUTCOVER_MAX_DIG_M) return true;
      drop(t, `a cut-and-cover box would dig ${dig.toFixed(1)} m into ground the elevation data shows at road level (left on the ground)`, false);
      return false;
    }
    const misfit = tunnelGroundMisfit(t);
    if (misfit.ok) return true;
    drop(t, misfit.reason, true);
    return false;
  });
  // (a pause after each tunnel graded: the browser gets the thread back)
  for (const t of keepFitting([...out.tunnels])) { gradeOne(t); yield; }
  // then the galleries (and the hillside tunnels short of rock that become
  // galleries), on the ground as it is now
  if (!early) {
    const before = out.tunnels.length;
    for (const path of galleryPaths) solvePath(path);
    const fresh = keepFitting(out.tunnels.slice(before));
    for (const t of fresh) { gradeOne(t); yield; }
  }
  const holes = new Set();
  for (const t of out.tunnels) {
    const [c0, r0, c1, r1] = pixelBox(t);
    let opened = 0;
    // square (c, r) spans pixels c..c+1 and r-1..r (north): layer index of
    // its south-west sample (blocks far from the tube skipped, as in the
    // grading: every square of a long diagonal tunnel's box took 17 s in
    // Manhattan)
    const rStart = Math.max(1, r0); const cEnd = Math.min(c1, width - 1);
    for (let br = rStart; br <= r1; br += BLOCK) {
      for (let bc = c0; bc < cEnd; bc += BLOCK) {
        if (!nearBlock(t, bc, br)) continue;
        for (let r = br; r < Math.min(r1 + 1, br + BLOCK); r++) {
          for (let c = bc; c < Math.min(cEnd, bc + BLOCK); c++) {
            const corners = [hm.at(r * width + c), hm.at(r * width + c + 1), hm.at((r - 1) * width + c), hm.at((r - 1) * width + c + 1)];
            // (the square's middle on the terrain's own grid: samples squareSize
            // apart from minus half its extent, the heightmap's rows flipped;
            // the heightmap's (W - 1)-span grid drifted a square across the map)
            const x = (c + 0.5 - width / 2) * squareSize; const y = (height / 2 - r - 0.5) * squareSize;
            if (tunnelHoleAt(t, x, y, Math.min(...corners) - minHeight, Math.max(...corners) - minHeight)) { holes.add((height - 1 - r) * width + c); opened++; }
          }
        }
      }
    }
    t.holes = opened;
    yield;
  }
  out.holes = [...holes];
  if (globalThis.__MAPNG_TUNNEL_DEBUG) globalThis.__MAPNG_TUNNEL_DEBUG(out, { groundAt, toWorld, toPixel, bridges, width, height, hmAt: (idx) => hm.at(idx) - minHeight });
  // (MAPNG_TUNNEL_DUMP=1: each built tunnel's solved line, for diagnosing its portals)
  if (globalThis.process?.env?.MAPNG_TUNNEL_DUMP) {
    for (const t of out.tunnels) console.log('[tunnel dump]', JSON.stringify({ osm: t.osm?.[0]?.tags?.name || t.osm?.[0]?.id, kind: t.kind, low: !!t.low, raw: !!t.raw, iS: t.iS, iN: t.iN, portals: t.portals, portalKind: t.portalKind, headDepth: t.headDepth, stepAt: t.stepAt, line: t.line.map((q) => [Math.round(q.x * 10) / 10, Math.round(q.y * 10) / 10, Math.round(q.s), q.kind, Math.round(q.z * 10) / 10, Number.isFinite(q.g) ? Math.round(q.g * 10) / 10 : null]) }));
  }
  console.log(`[BeamNG Export] Tunnels: ${out.tunnels.length} bored (${out.tunnels.map((t) => `${Math.round(t.tubeLength)} m`).join(', ')}), ${out.skipped.length} left on the ground, ${out.holes.length} portal hole square(s).`);
  return out;
}

// a road on a dam's crest rides this far over its concrete top (dams.js)
const DAM_ROAD_LIFT_M = 0.02;   // (as a deck's road: the decal captures only surfaces just under its nodes)

// a cut-and-cover tunnel's trenches on fine elevation data: at most this deep
// into the ground (solveExportTunnels' keepFitting)
const CUTCOVER_MAX_DIG_M = 3;
/** How deep a cut-and-cover tunnel's approaches cut below the ground (m). */
export function cutCoverDig(t) {
  let worst = 0;
  t.line.forEach((p, k) => {
    if (k >= t.iS && k <= t.iN) return;
    if (Number.isFinite(p.z) && Number.isFinite(p.g)) worst = Math.max(worst, p.g - p.z);
  });
  return worst;
}

// terrain shaping at tunnels off: a tunnel is built only where its road
// outside the portals runs within this of the ground (no cutting needed)
const RAW_TUNNEL_FIT_M = 1;
const RAW_TUNNEL_HUMP_M = 10;
const RAW_TUNNEL_FIT_MAX_M = 4;

/**
 * Whether a solved tunnel fits the ground as it is: a cut-and-cover box
 * never does (dug out and covered over); a bore or gallery when its road
 * outside the tube stays within RAW_TUNNEL_FIT_M of the ground.
 * Returns { ok, reason, worst }.
 */
export function tunnelGroundMisfit(t) {
  if (t.kind === 'cutcover') return { ok: false, reason: 'a cut-and-cover box needs the ground dug out and covered (terrain shaping at tunnels is off)', worst: null };
  // (each station's misfit the least within RAW_TUNNEL_HUMP_M along the road:
  // a street crossing over the approach, which the elevation keeps as ground
  // over the road, needs no cutting; the busway out of the Mount Washington
  // Transit Tunnel under East Carson Street read 8 m)
  const off = (p) => (Number.isFinite(p.z) && Number.isFinite(p.g) ? Math.abs(p.z - p.g) : 0);
  let worst = 0;
  let at = null;
  t.line.forEach((p, k) => {
    if (k >= t.iS && k <= t.iN) return;
    let m = off(p);
    for (let j = k - 1; j >= 0 && m > 0 && Math.abs(t.line[j].s - p.s) <= RAW_TUNNEL_HUMP_M; j--) m = Math.min(m, off(t.line[j]));
    for (let j = k + 1; j < t.line.length && m > 0 && Math.abs(t.line[j].s - p.s) <= RAW_TUNNEL_HUMP_M; j++) m = Math.min(m, off(t.line[j]));
    if (m > worst) { worst = m; at = p; }
  });
  if (globalThis.process?.env?.MAPNG_TUNNEL_PROFILE && worst > RAW_TUNNEL_FIT_M) {
    console.log('[tunnel misfit]', JSON.stringify({ osm: t.osm, iS: t.iS, iN: t.iN, kinds: t.approachKinds, portalKind: t.portalKind, worst, at: at && { x: at.x, y: at.y, s: at.s, z: at.z, g: at.g }, line: t.line.filter((_, k) => k % 5 === 0 || k === t.iS || k === t.iN).map((p) => [Math.round(p.s), +p.z.toFixed(1), +p.g.toFixed(1), p.kind]) }));
  }
  // (a long bore deep under a hill: an approach a little off its ground is
  // far less wrong than its road laid over the hill instead, the Mount
  // Washington Transit Tunnel's busway up a 295 % slope: the tolerance grows
  // with the cover, to RAW_TUNNEL_FIT_MAX_M under ten times that)
  let cover = 0;
  for (let k = t.iS; k <= t.iN; k++) { const p = t.line[k]; if (Number.isFinite(p?.g) && Number.isFinite(p?.z)) cover = Math.max(cover, p.g - p.z); }
  const tolerance = Math.max(RAW_TUNNEL_FIT_M, Math.min(RAW_TUNNEL_FIT_MAX_M, cover / 10));
  return worst <= tolerance
    ? { ok: true, reason: null, worst }
    : { ok: false, reason: `its approach would need ${worst.toFixed(1)} m of cutting or fill (terrain shaping at tunnels is off)`, worst };
}

/** The two tunnel phases as one result (keys numbered through both). */
// a tunnel's cutting: ground it lowered by more than this (out.graded)
const CUT_KEEP_M = 0.1;

function joinTunnelPhases(a, b) {
  const tunnels = [...a.tunnels, ...b.tunnels];
  tunnels.forEach((t, i) => { t.key = `t${String(i + 1).padStart(3, '0')}`; });
  return {
    tunnels,
    bySeg: new Map([...a.bySeg, ...b.bySeg]),
    skipped: [...a.skipped, ...b.skipped],
    holes: [...new Set([...a.holes, ...b.holes])],
    graded: new Set([...(a.graded || []), ...(b.graded || [])]),
    mouth: new Map([...(a.mouth || []), ...(b.mouth || [])]),
    tube: new Set([...(a.tube || []), ...(b.tube || [])]),
  };
}

// Pedestrian streets (highway=pedestrian: St. George Street, St. Augustine;
// European old towns) carry no traffic, so they are no part of the road
// network, but they are drawn: in their own surface, under every road that
// meets them, with no paint, edge blend or AI path.
const PEDESTRIAN_WIDTH_M = 6;
const PEDESTRIAN_RENDER_PRIORITY = 16;
// Footpaths, cycleways and trails (a neighbourhood's exercise path, a park's
// walks) are drawn the same way, narrow: their own surface on the terrain.
// One running along a street beside its raised sidewalk is that sidewalk
// (mapped separately) and is left out; a street tagged sidewalk=separate gets
// no raised one, its footway is drawn instead.
const FOOTPATH_WIDTH_M = { footway: 1.8, cycleway: 2.5, path: 1.5, bridleway: 2 };
const FOOTPATH_DEFAULT_SURFACE = { footway: null, cycleway: null, path: 'dirt', bridleway: 'dirt' };
const FOOTPATH_SKIP = new Set(['traffic_island', 'access_aisle']);
const FOOTPATH_ALONG_COS = 0.85;
const FOOTPATH_MIN_M = 4;
const UNPAVED_PATH = new Set(['dirt', 'earth', 'ground', 'grass', 'gravel', 'fine_gravel', 'sand', 'mud', 'unpaved', 'compacted', 'woodchips', 'pebblestone']);
// Service roads (driveways, parking aisles, alleys, drive-throughs) are no
// part of the road network either (no AI into private drives), but drawn:
// their own surface, as wide as their kind, under the roads they meet.
// Untagged, a driveway is concrete in town in the Americas (asphalt in town
// elsewhere) and gravel in the country; the rest asphalt.
const SERVICE_WIDTH_M = { driveway: 3.2, parking_aisle: 6, alley: 4, 'drive-through': 3.5, emergency_access: 3.5 };
const SERVICE_DEFAULT_WIDTH_M = 4.5;
const SERVICE_SPLIT_COS = Math.cos(45 * Math.PI / 180);

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
function buildPedestrianStreetDecals(terrainData, squareSize, carriageways = [], { raisedFootways = false } = {}) {
  const decals = [];
  const ways = [];
  const footpaths = [];
  const perStreet = new Map();
  const americas = getMarkingStyle(terrainData.roadRules) === 'americas';
  // the streets' raised sidewalks: [{ nodes, half, left, right }]
  const openStreets = carriageways.filter((cw) => !cw.bridge && !cw.tunnel);
  const sidesOf = streetSides(openStreets, sidewalkFootways(terrainData.osmFeatures, (p) => geoToWorldPoint(p.lat, p.lng, terrainData, squareSize, 0)));
  const streets = openStreets.map((cw) => ({ ...cw, ...sidesOf.get(cw) }));
  // is a footpath's point (x, y), heading (dx, dy), that street's sidewalk?
  // (street segments binned on a grid by their reach: scanning every segment
  // for every footpath point froze Manhattan's export for over 16 minutes)
  const SIDEWALK_CELL_M = 32;
  const sidewalkCells = new Map();
  const cellOf = (x, y) => `${Math.floor(x / SIDEWALK_CELL_M)},${Math.floor(y / SIDEWALK_CELL_M)}`;
  for (const cw of streets) {
    const reach = cw.half + Math.max(cw.left || 0, cw.right || 0) + 3;
    if (!(Math.max(cw.left || 0, cw.right || 0) > CURB_ONLY_M)) continue;
    const n = cw.nodes;
    for (let i = 0; i + 1 < n.length; i++) {
      const x0 = Math.floor((Math.min(n[i][0], n[i + 1][0]) - reach) / SIDEWALK_CELL_M);
      const x1 = Math.floor((Math.max(n[i][0], n[i + 1][0]) + reach) / SIDEWALK_CELL_M);
      const y0 = Math.floor((Math.min(n[i][1], n[i + 1][1]) - reach) / SIDEWALK_CELL_M);
      const y1 = Math.floor((Math.max(n[i][1], n[i + 1][1]) + reach) / SIDEWALK_CELL_M);
      for (let cx = x0; cx <= x1; cx++) {
        for (let cy = y0; cy <= y1; cy++) {
          const key = `${cx},${cy}`;
          let list = sidewalkCells.get(key);
          if (!list) sidewalkCells.set(key, (list = []));
          list.push(cw, i);
        }
      }
    }
  }
  const onSidewalk = (x, y, dx, dy) => {
    const list = sidewalkCells.get(cellOf(x, y));
    if (!list) return false;
    for (let j = 0; j < list.length; j += 2) {
      const cw = list[j]; const i = list[j + 1]; const n = cw.nodes;
      const vx = n[i + 1][0] - n[i][0]; const vy = n[i + 1][1] - n[i][1];
      const L2 = vx * vx + vy * vy || 1e-9;
      const t = ((x - n[i][0]) * vx + (y - n[i][1]) * vy) / L2;
      if (t < 0 || t > 1) continue;
      const L = Math.sqrt(L2);
      const across = ((x - n[i][0]) * -vy + (y - n[i][1]) * vx) / L;   // + left of the street
      const width = across > 0 ? cw.left : cw.right;
      if (!(width > CURB_ONLY_M) || Math.abs(across) > cw.half + width / 2 + 1.2) continue;
      const dl = Math.hypot(dx, dy) || 1;
      if (Math.abs((dx * vx + dy * vy) / (dl * L)) >= FOOTPATH_ALONG_COS) return true;
    }
    return false;
  };
  const isUrban = buildUrbanRoadClassifier(terrainData.osmFeatures || []);
  let serviceCount = 0; let serviceLength = 0;
  // vertices shared by two or more roads: a service road's square end there
  // is carried on half its width, closing the corner where aisles meet
  const nodeKey = (p) => `${p.lat.toFixed(7)},${p.lng.toFixed(7)}`;
  const roadsAtNode = new Map();
  for (const f of terrainData.osmFeatures || []) {
    if (f?.type !== 'road' || !(f.geometry?.length >= 2)) continue;
    for (const k of new Set(f.geometry.map(nodeKey))) roadsAtNode.set(k, (roadsAtNode.get(k) || 0) + 1);
  }
  for (const feature of terrainData.osmFeatures || []) {
    const tags = feature?.tags || {};
    const footpath = Object.hasOwn(FOOTPATH_WIDTH_M, tags.highway);
    const service = tags.highway === 'service';
    if (feature?.type !== 'road' || (tags.highway !== 'pedestrian' && !footpath && !service) || !(feature.geometry?.length >= 2)) continue;
    // squares (area=yes) are polygons, not streets; bridges and tunnels have
    // no deck or bore here
    if (tags.area === 'yes' || isBridgeRoad(tags) || (tags.tunnel && tags.tunnel !== 'no')) continue;
    if (footpath && (FOOTPATH_SKIP.has(String(tags.footway || '')) || tags.indoor === 'yes' || tags.level?.startsWith?.('-'))) continue;
    // (a crossing's landings are slabs joining the sidewalk to the curb; painted, not paved, on the road)
    if (footpath && tags.footway === 'crossing' && !raisedFootways) continue;
    const tagged = Number.parseFloat(tags.width);
    const kind = String(tags.service || '').trim().toLowerCase();
    const lanes = Number.parseInt(tags.lanes, 10);
    const fullWidth = footpath
      ? (Number.isFinite(tagged) && tagged > 0 ? Math.min(8, Math.max(1, tagged)) : FOOTPATH_WIDTH_M[tags.highway])
      : service
        ? (Number.isFinite(tagged) && tagged > 0 ? Math.min(20, Math.max(2, tagged)) : lanes >= 2 ? Math.min(12, 3 * lanes) : SERVICE_WIDTH_M[kind] ?? SERVICE_DEFAULT_WIDTH_M)
        : (Number.isFinite(tagged) && tagged > 0 ? Math.min(40, Math.max(2, tagged)) : PEDESTRIAN_WIDTH_M);
    const surface = tags.surface
      || (footpath ? FOOTPATH_DEFAULT_SURFACE[tags.highway] ?? (americas ? 'concrete' : 'asphalt') : null)
      || (service ? (kind === 'driveway' ? (!isUrban(feature) ? 'gravel' : americas ? 'concrete' : 'asphalt') : 'asphalt') : null);
    const layers = pedestrianSurfaceLayers(surface, fullWidth, { americas });
    const street = sanitizeBeamNGObjectName(tags.name || `${footpath ? tags.highway : service ? `service_${kind || 'road'}` : 'pedestrian'}_${feature.id}`, `pedestrian_${feature.id || 'x'}`);
    const pieces = clipGeometryToMargin(feature.geometry, terrainData.bounds)
      .map((s) => easeTightNodes(resampleGeometryToSpacing(s, roadNodeSpacingM), fullWidth / 2))
      .flatMap((s) => chunkPolyline(s, 250, { widthM: fullWidth, spacingM: roadNodeSpacingM }));
    for (const piece of pieces) {
      const world = [];
      for (const pt of piece) {
        const [x, y, z] = geoToWorldPoint(pt.lat, pt.lng, terrainData, squareSize, 0.1);
        if (Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z)) {
          world.push([Math.round(x * 1000) / 1000, Math.round(y * 1000) / 1000, Math.round(z * 1000) / 1000, fullWidth / 2]);
        }
      }
      if (service && world.length >= 2) {
        const extend = (end, prev, atKey) => {
          if ((roadsAtNode.get(atKey) || 0) < 2) return;
          const dx = end[0] - prev[0]; const dy = end[1] - prev[1]; const d = Math.hypot(dx, dy);
          if (d < 1e-6) return;
          end[0] = Math.round((end[0] + (dx / d) * fullWidth / 2) * 1000) / 1000;
          end[1] = Math.round((end[1] + (dy / d) * fullWidth / 2) * 1000) / 1000;
        };
        extend(world[0], world[1], nodeKey(piece[0]));
        extend(world[world.length - 1], world[world.length - 2], nodeKey(piece[piece.length - 1]));
      }
      // a service road turning sharply (a car park's loop aisle turns 90° at
      // its corners): one DecalRoad cannot, it pinches and leaves a gap; split
      // there into pieces carried half the width past the corner
      const serviceRuns = [];
      if (service) {
        let start = 0;
        for (let k = 1; k + 1 < world.length; k++) {
          const ax = world[k][0] - world[k - 1][0]; const ay = world[k][1] - world[k - 1][1];
          const bx = world[k + 1][0] - world[k][0]; const by = world[k + 1][1] - world[k][1];
          const la = Math.hypot(ax, ay); const lb = Math.hypot(bx, by);
          if (la < 1e-6 || lb < 1e-6 || (ax * bx + ay * by) / (la * lb) > SERVICE_SPLIT_COS) continue;
          const part = world.slice(start, k + 1).map((p) => [...p]);
          const end = part[part.length - 1];
          end[0] = Math.round((end[0] + (ax / la) * fullWidth / 2) * 1000) / 1000;
          end[1] = Math.round((end[1] + (ay / la) * fullWidth / 2) * 1000) / 1000;
          serviceRuns.push(part);
          start = k;
        }
        const last = world.slice(start).map((p) => [...p]);
        if (start > 0) {
          const [p0, p1] = last;
          const dx = p1[0] - p0[0]; const dy = p1[1] - p0[1]; const d = Math.hypot(dx, dy) || 1;
          p0[0] = Math.round((p0[0] - (dx / d) * fullWidth / 2) * 1000) / 1000;
          p0[1] = Math.round((p0[1] - (dy / d) * fullWidth / 2) * 1000) / 1000;
        }
        serviceRuns.push(last);
      }
      // a footpath along a street's raised sidewalk is that sidewalk: its
      // stretches there are left out
      const runs = [];
      if (footpath) {
        let run = [];
        world.forEach((p, k) => {
          const a = world[Math.max(0, k - 1)]; const b = world[Math.min(world.length - 1, k + 1)];
          if (onSidewalk(p[0], p[1], b[0] - a[0], b[1] - a[1])) { if (run.length) runs.push(run); run = []; } else run.push(p);
        });
        if (run.length) runs.push(run);
      } else if (service) runs.push(...serviceRuns);
      else runs.push(world);
      for (const nodes of runs) {
      if (nodes.length < 2) continue;
      if (footpath && pathLength(nodes) < FOOTPATH_MIN_M) continue;
      // (paved footways are real slabs wherever they run; dirt and gravel paths stay on the ground)
      const raised = footpath && tags.highway === 'footway' && !UNPAVED_PATH.has(surface) && !tags.bridge && !tags.tunnel;
      if (footpath) footpaths.push({ nodes, half: fullWidth / 2, sidewalk: raised, crossing: tags.footway === 'crossing', surface: tags.surface });
      if (service) { serviceCount++; serviceLength += pathLength(nodes); }
      ways.push({ nodes, half: fullWidth / 2 });
      const n = (perStreet.get(street) || 0) + 1;
      perStreet.set(street, n);
      // (a raised slab is this footway: no decal under it)
      if (raised && raisedFootways) continue;
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
  }
  return { decals, ways, footpaths, services: { count: serviceCount, length: serviceLength } };
}

/** The paving materials the decal groups use, by name (for main.materials.json). */
export function usedPavingMaterials(groups) {
  const byName = new Map(Object.values(PAVING_MATERIALS).map((p) => [p.material.name, p.material]));
  // (the railways' tram-rail decal: level crossings and trams in their streets)
  byName.set(TRAMLINE_MATERIAL.name, TRAMLINE_MATERIAL);
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

export function generateDecalRoads(terrainData, squareSize, opts = {}) {
  const steps = decalRoadSteps(terrainData, squareSize, opts);
  for (;;) {
    const { done, value } = steps.next();
    if (done) return value;
  }
}

/**
 * generateDecalRoads, handing the browser the thread back (`yieldFn`) at
 * each pause: Manhattan's road layout ran ~45 s in one go and Chrome offered
 * to kill the page.
 */
export async function generateDecalRoadsYielding(terrainData, squareSize, yieldFn, opts = {}) {
  const steps = decalRoadSteps(terrainData, squareSize, opts);
  for (;;) {
    const { done, value } = steps.next();
    if (done) return value;
    await yieldFn();
  }
}

// The road layout, pausing (yield) between its phases and every 200 roads.
// A raceway at least DRAG_MIN_M long and dead straight (within DRAG_STRAIGHT_M
// of its chord) that is most of the raceways it joins: a drag strip, whatever
// its tags say (they rarely do); a shorter straight is a connecting lane, a
// small share of a network is a circuit's straight.
const DRAG_MIN_M = 380;   // (a quarter mile and some: a 233 m straight inside a training course was no drag strip)
const DRAG_STRAIGHT_M = 2;
const DRAG_NETWORK_SHARE = 1 / 3;
// A motocross or BMX raceway without a surface tag is dirt, not asphalt.
const OFFROAD_SPORT = /motocross|supercross|enduro|bmx|speedway|autocross|rallycross/;
export function prepareRaceways(features) {
  for (const f of features) {
    const t = f?.tags;
    if (t?.highway === 'raceway' && !t.surface && OFFROAD_SPORT.test(String(t.sport || '').toLowerCase())) f.tags = { ...t, surface: 'dirt' };
  }
}

export function markDragStrips(features, project) {
  // the raceways that touch, and their lengths: a dead-straight raceway is a
  // strip only as DRAG_NETWORK_SHARE of them or more (Lime Rock's 597 m Sam
  // Posey Straight is 13 % of its circuit; a strip and its return road, half)
  const root = new Map();
  const find = (k) => { let r = k; while (root.get(r) !== r) r = root.get(r); root.set(k, r); return r; };
  const key = (q) => `${q.lat},${q.lng}`;
  const lines = features.filter((f) => f?.type === 'road' && f.tags?.highway === 'raceway' && f.tags.area !== 'yes' && f.geometry?.length >= 2);
  for (const f of lines) {
    const k0 = key(f.geometry[0]);
    if (!root.has(k0)) root.set(k0, k0);
    for (const q of f.geometry) { const k = key(q); if (!root.has(k)) root.set(k, k); root.set(find(k), find(k0)); }
  }
  const lengthOf = (f) => { const p = f.geometry.map((q) => project(q.lat, q.lng)); let s = 0; for (let i = 1; i < p.length; i++) s += Math.hypot(p[i][0] - p[i - 1][0], p[i][1] - p[i - 1][1]); return s; };
  const networkM = new Map();
  for (const f of lines) { const r = find(key(f.geometry[0])); networkM.set(r, (networkM.get(r) || 0) + lengthOf(f)); }
  for (const f of features) {
    const t = f?.tags;
    if (f?.type !== 'road' || t?.highway !== 'raceway' || t['mapng:raceway'] || !(f.geometry?.length >= 2)) continue;
    const pts = f.geometry.map((q) => project(q.lat, q.lng));
    const a = pts[0]; const b = pts[pts.length - 1];
    const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (L < DRAG_MIN_M) continue;
    const dev = Math.max(...pts.map((q) => Math.abs((b[0] - a[0]) * (q[1] - a[1]) - (b[1] - a[1]) * (q[0] - a[0])) / L));
    if (dev > DRAG_STRAIGHT_M) continue;
    if (L < DRAG_NETWORK_SHARE * (networkM.get(find(key(f.geometry[0]))) || L)) continue;
    t['mapng:raceway'] = 'drag';
    // laid dead straight between its ends: the wobble left is mapping noise
    // (points clicked off aerial imagery, +-1.4 m every 50-140 m on a strip
    // lined with walls); a point other roads share moves with it in them too
    const g0 = f.geometry[0]; const g1 = f.geometry[f.geometry.length - 1];
    const moved = new Map();
    f.geometry = f.geometry.map((q, i) => {
      if (i === 0 || i === f.geometry.length - 1) return q;
      const u = ((pts[i][0] - a[0]) * (b[0] - a[0]) + (pts[i][1] - a[1]) * (b[1] - a[1])) / (L * L);
      const nq = { ...q, lat: g0.lat + (g1.lat - g0.lat) * u, lng: g0.lng + (g1.lng - g0.lng) * u };
      moved.set(`${q.lat},${q.lng}`, nq);
      return nq;
    });
    if (moved.size) for (const o of features) {
      if (o === f || o?.type !== 'road' || !o.geometry?.length) continue;
      if (o.geometry.some((q) => moved.has(`${q.lat},${q.lng}`))) o.geometry = o.geometry.map((q) => { const m = moved.get(`${q.lat},${q.lng}`); return m ? { ...q, lat: m.lat, lng: m.lng } : q; });
    }
  }
}

function* decalRoadSteps(terrainData, squareSize, opts = {}) {
  const includeBridges = opts.includeBridges !== false;
  const includeTunnels = opts.includeTunnels !== false;
  const shaping = shapingSwitches(opts.shaping);
  const budget = chooseRoadNodeSpacing(terrainData.osmFeatures || []);
  if (budget.spacing > ROAD_NODE_SPACING_M) {
    console.log(`${BEAMNG_EXPORT_SERVICE_LOG} Road nodes every ${budget.spacing.toFixed(2)} m (not ${ROAD_NODE_SPACING_M} m): ${budget.lengthKm.toFixed(0)} km of roads would make ~${budget.estimatedNodes} DecalRoad nodes, past what BeamNG draws at load.`);
  }
  if (!terrainData.osmFeatures?.length) return [];
  prepareRaceways(terrainData.osmFeatures);
  markDragStrips(terrainData.osmFeatures, (lat, lng) => geoToWorldPoint(lat, lng, terrainData, squareSize, 0));

  const sourceRoadFeatures = bridgeOverShortGaps(terrainData.osmFeatures.filter((feature) => {
    if (feature?.type !== 'road' || !feature.geometry?.length) return false;
    const highway = feature.tags?.highway;
    // (a raceway's area=yes outline is its surface, drawn as one (racetracks.js), not a road round it)
    if (highway === 'raceway' && feature.tags?.area === 'yes') return false;
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
  const isCurbedStreet = buildCurbedStreetClassifier(terrainData.osmFeatures);
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
  // Railways (services/railways.js): graph edges of their own class beside
  // the roads, so a rail bridge, a rail tunnel, a road bridge over a line and
  // a level crossing come out of the one profile solve. Indexed after the
  // roads: an edge's seg below drivableRoads.length is a road (the decals'
  // owners), past it a railway. Only with the solver building the level.
  let railSegs = [];
  if (opts.structureSolver === 'v2' && opts.includeRailways !== false) {
    try {
      const project = (lat, lng) => geoToWorldPoint(lat, lng, terrainData, squareSize, 0);
      // (a tram in its street is drawn on the street, not built as a line of its own)
      const streets = drivableRoads.map((seg) => ({ xy: seg.geometry.map((p) => project(p.lat, p.lng)), half: halfOf(seg) }));
      // (a short untagged piece between two rail bridges is the same structure, as a road's)
      const railFeatures = bridgeOverShortGaps(terrainData.osmFeatures.filter((f) => f?.type === 'railway' && f.geometry?.length >= 2));
      railSegs = railSegmentsFrom(railFeatures, { streetRunning: streetRunningTest(streets, project), bounds: terrainData.bounds });
    } catch (err) {
      console.warn(`${BEAMNG_EXPORT_SERVICE_LOG} Railways skipped: ${err?.message || err}`);
      railSegs = [];
    }
  }
  const graphSegments = railSegs.length ? [...drivableRoads, ...railSegs] : drivableRoads;
  const graphHalfOf = (seg) => (seg.rail ? railHalfWidth(seg.tags) : halfOf(seg));
  // The structure solver (graph, crossings, profile, classes). Shadow mode
  // unless options.structureSolver asks for it: a failure here is logged
  // and skipped, never an export failure.
  let structureGraph = null;
  try {
    // The structure solver's road graph (stage A), built on the untouched
    // ground. Shadow mode: nothing reads it yet but the report.
    const graphEdge = (terrainData.width * squareSize) / 2 - 3;
    structureGraph = buildStructureGraph(graphSegments, {
      project: (lat, lng) => geoToWorldPoint(lat, lng, terrainData, squareSize, 0),
      groundAt: (x, y) => getTerrainHeightAtWorldXY(x, y, terrainData, squareSize),
      halfOf: graphHalfOf,
      isFreeEnd: (x, y) => Math.abs(x) >= graphEdge || Math.abs(y) >= graphEdge,
      // (each road cut at the map's edge, the points added there marked:
      // squashed onto the edge, roads leaving the map side by side met there)
      clip: (geometry) => {
        const own = new Set(geometry);
        return clipGeometryToMargin(geometry, terrainData.bounds, 0).map((part) => part.map((p) => (own.has(p) ? p : { ...p, cut: true })));
      },
    });
    // (bridges / tunnels switched off: those roads are plain roads)
    if (!includeBridges) for (const e of structureGraph.edges) e.bridge = false;
    if (!includeTunnels) for (const e of structureGraph.edges) e.tunnel = false;
    // railways: their ground at the top of the rail, the formation under it,
    // and the level crossings (railTrack.js)
    if (railSegs.length) {
      structureGraph.railSegments = graphSegments;
      structureGraph.railCrossings = prepareRailEdges(structureGraph, { pathClasses: PATH_HIGHWAYS });
      structureGraph.railUnjoined = unjoinedRailCrossings(structureGraph);
      for (const c of structureGraph.railUnjoined) markUnjoinedCrossing(structureGraph, c);
    }
    // stage B: crossings and their order, bridges over water (shadow mode too)
    structureGraph.crossings = findCrossings(structureGraph, { waterAt: buildWaterLookup(terrainData, squareSize) });
    // no bridges: nothing is lifted over anything, every road on its ground
    if (!includeBridges) structureGraph.crossings = { ...structureGraph.crossings, crossings: [], overlaps: [], water: [] };
    yield;
    yield;
  } catch (err) {
    console.warn(`${BEAMNG_EXPORT_SERVICE_LOG} Structure solver skipped: ${err?.message || err}`);
    structureGraph = null;
  }
  // Tunnels and bridges, their earthworks graded before any road samples the
  // ground. The tunnels meeting no bridge first: a bridge over a tunnel's
  // trench (North 7th Street over I-10 at Deck Park, Phoenix) spans it at the
  // street, not 6.5 m over a freeway the elevation shows at street level.
  // Then the bridges (the road nodes on a bridge ride on its deck), then the
  // tunnels a bridge meets (a portal takes the deck's height).
  const done = new Set();
  const noTunnels = () => ({ bySeg: new Map(), tunnels: [], skipped: [], holes: [], graded: new Set(), tube: new Set(), mouth: new Map() });
  // (railway tunnels too: their bores come from the same builder)
  const early = includeTunnels ? yield* solveExportTunnels(graphSegments, terrainData, squareSize, null, graphHalfOf, { done, shape: shaping.tunnels }) : noTunnels();
  yield;
  // (structure solver v2: the decks come from the solver after the road
  // layout, so today's bridge passes are skipped)
  // (no graph, e.g. it failed on this map: today's bridge passes instead)
  // (today's passes shape the ground at every bridge: none with bridges or
  // their shaping switched off)
  const noBridges = () => ({ bySeg: new Map(), approaches: new Map(), decks: [], roadLines: [], ramps: 0, humps: [], sunk: 0, sunkAt: [], carried: 0, partInfo: [], endHeight: () => null });
  const bridges = (opts.structureSolver === 'v2' && structureGraph) || !includeBridges || !shaping.bridges || !shaping.overpasses
    ? noBridges()
    : solveExportBridges(drivableRoads, terrainData, squareSize, early.tunnels);
  yield;
  const late = includeTunnels ? yield* solveExportTunnels(graphSegments, terrainData, squareSize, bridges, graphHalfOf, { done, shape: shaping.tunnels }) : noTunnels();
  yield;
  const tunnels = joinTunnelPhases(early, late);
  // The structure solver's profile and classes (stages C, D), after today's
  // tunnels. Building the level ('v2'), today's tunnels' roads are pinned
  // at the tunnels' own heights (until the solver builds tunnels too), so
  // approaches grade into the portals; in shadow mode it keeps its own
  // tunnel rules.
  if (structureGraph) {
    try {
      structureGraph.pins = [];
      structureGraph.tunnelsPinned = opts.structureSolver === 'v2';
      structureGraph.edges.forEach((e, k) => {
        const t = opts.structureSolver === 'v2' ? tunnels.bySeg.get(e.seg) : null;
        if (!t) return;
        e.external = true;
        // (a railway's profile is the top of its rail: the tube's floor is its formation)
        const lift = e.rail ? RAIL_DEPTH_M : 0;
        for (let i = 0; i < e.s.length; i++) structureGraph.pins.push([k, i, tunnelRoadZ(t, e.x[i], e.y[i]) + lift]);
      });
      // dams (services/dams.js): a road along a dam's crest rides on it,
      // pinned at the crest; the dam is its structure (no deck, no piers,
      // the terrain under it as the data has it: classes 'dam')
      if (opts.includeDams) {
        structureGraph.dams = planDams(terrainData.osmFeatures || [], (lat, lng) => geoToWorldPoint(lat, lng, terrainData, squareSize, 0), {
          groundAt: (x, y) => getTerrainHeightAtWorldXY(x, y, terrainData, squareSize),
        });
        if (structureGraph.dams.length) structureGraph.edges.forEach((e, k) => {
          if (e.external || e.tunnel) return;
          const at = new Uint8Array(e.s.length); let any = false;
          for (let i = 0; i < e.s.length; i++) {
            const d = damAt(structureGraph.dams, e.x[i], e.y[i]);
            if (!d) continue;
            at[i] = 1; any = true;
            // (just over the crest top: the decals project down onto it, as onto a deck)
            if (opts.structureSolver === 'v2') structureGraph.pins.push([k, i, d.crest + DAM_ROAD_LIFT_M]);
          }
          if (any) e.damAt = at;
        });
      }
      // measured deck heights (US lidar): each bridge measured along most of
      // it pinned where the survey found its surface
      if (opts.lidar?.grid && opts.structureSolver === 'v2') {
        const minH = Number(terrainData.minHeight) || 0;
        const measured = lidarPins(structureGraph, opts.lidar, (x, y) => getTerrainHeightAtWorldXY(x, y, terrainData, squareSize) + minH, minH);
        structureGraph.pins.push(...measured.pins);
        opts.lidar.result = measured;
      }
      // terrain shaping switched off somewhere: the stations held on their
      // ground, the bridges built as decks wherever they leave it
      if (!allShaping(shaping) || opts.rawAt) {
        // (the rim-to-rim line of a plain deck runs through its measured heights;
        // the roads in No smoothing areas held on their ground)
        const plan = shapingPlan(structureGraph, shaping, { measured: structureGraph.pins, rawAt: opts.rawAt || null });
        structureGraph.fixed = plan.fixed;
        structureGraph.noCut = plan.noCut;
        // (each plain deck's span, rim to rim, pinned as today's tunnels are)
        structureGraph.pins.push(...plan.pins);
        Object.defineProperty(structureGraph, 'shaping', { value: plan, enumerable: false });
      }
      // stage C: every road's profile in one solve (shadow mode: measured with
      // the same checks as the level's roads, for the report)
      {
        const t0 = performance.now();
        structureGraph.profile = yield* solveProfilesSteps(structureGraph);
        structureGraph.profile.ms = Math.round(performance.now() - t0);
        const lines = structureGraph.edges.map((e, k) => ({
          nodes: Array.from(e.s, (_, i) => [e.x[i], e.y[i], structureGraph.profile.z[k][i], e.half]),
          highway: e.highway, bridge: e.bridge, tunnel: e.tunnel, tags: { layer: String(e.layer) }, half: e.half,
        }));
        structureGraph.previewChecks = { joints: checkJoints(lines), grades: checkGrades(lines), crossings: checkCrossings(lines) };
        Object.defineProperty(structureGraph, 'previewLines', { value: lines, enumerable: false });
        // stage D: what each stretch becomes
        structureGraph.classes = classifyStructures(structureGraph);
        if (structureGraph.shaping) structureGraph.classes = rawDeckClasses(structureGraph, structureGraph.classes, structureGraph.shaping.rawDeck, structureGraph.shaping.span);
        // no bridges: a stretch the solve still left high is fill, never a deck
        if (!includeBridges) for (const seg of structureGraph.classes.segments) if (seg.kind === 'deck') seg.kind = 'embankment';
      }
      yield;
    } catch (err) {
      console.warn(`${BEAMNG_EXPORT_SERVICE_LOG} Structure solver profile skipped: ${err?.message || err}`);
      structureGraph.profile = null; structureGraph.classes = null;
    }
  }
  // a road reaching into a tube it is no part of (a ramp OSM ends a few
  // metres into a tunnel's mouth, where the tube widens for it): on the
  // tube's floor there, not draped over the headwall's backfill
  const inTubeSeg = new Set();
  // the tube a ground road's point at (x, y) runs inside (a ramp joining in
  // the bore), heading (dx, dy); a road crossing it runs over it instead (a
  // street over a cut-and-cover box: North 3rd Street over Deck Park's I-10
  // dropped 10 m into the tunnel)
  const TUBE_ALONG_COS = 0.5;
  const tubeAt = (x, y, dx = 0, dy = 0) => {
    for (const t of tunnels.tunnels) {
      if (t.kind === 'gallery') continue;
      const n = nearestOnTunnel(t, x, y, t.W + (t.maxExtra || 0) + 1);
      if (!n || n.beyond || n.into < 0.3) continue;
      const q = t.line[n.i];
      const L = Math.hypot(dx, dy);
      if (L > 1e-6 && Math.abs((dx * q.tx + dy * q.ty) / L) < TUBE_ALONG_COS) continue;
      if (Math.abs(n.d) - extraAt(t, q, Math.sign(n.d) || 1) <= t.W) return t;
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
  const surfaceDecals = [];

  // each way's widths (the cross section, the corridor's steady driving width)
  const widthsOf = (segmentFeature) => {
    const feature = segmentFeature.sourceFeature;
    const highway = segmentFeature.highway;
    const style = HIGHWAY_STYLE[highway] ?? DEFAULT_ROAD_STYLE;
    const isOneWay = isOneWayRoad(feature.tags || {});
    const urbanRoad = isUrbanRoad(segmentFeature);
    const crossSection = estimateRoadCrossSection(feature.tags || {}, highway, isOneWay, {
      urban: urbanRoad,
      fallbackHalfWidth: style.width,
    });
    // Untagged ways take the corridor's DRIVING width; parking / shoulders
    // sit on top of it.
    const stableHalfWidth = hasWidthTags(feature.tags || {}) ? null : stableHalfWidthMap.get(getDecalWidthCorridorKey(segmentFeature));
    const drivingHalfWidth = Number.isFinite(stableHalfWidth) && stableHalfWidth > 0
      ? stableHalfWidth
      : crossSection.drivingHalfWidth;
    const styleHalfWidth = drivingHalfWidth + (crossSection.leftExtra + crossSection.rightExtra) / 2;
    return { style, isOneWay, urbanRoad, crossSection, drivingHalfWidth, styleHalfWidth };
  };
  // a street wider on one way than the next narrows to it over the wider
  // one's last metres instead of stepping (its curbs jogged out a metre)
  const widthTapers = findWidthTapers(drivableRoads.map((sf) => (shouldGenerateDecalRoads(sf.highway, sf.sourceFeature.tags || {})
    ? { name: sf.sourceFeature.tags?.name || '', half: widthsOf(sf).styleHalfWidth, xy: sf.geometry.map((pt) => geoToWorldPoint(pt.lat, pt.lng, terrainData, squareSize, 0).slice(0, 2)) }
    : null)));
  for (let segIndex = 0; segIndex < drivableRoads.length; segIndex++) {
    if (segIndex % 200 === 199) yield;
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
    
    const renderTags = getMergedRoadRenderTags(segmentFeature);
    const { style, isOneWay, urbanRoad, crossSection, drivingHalfWidth, styleHalfWidth } = widthsOf(segmentFeature);
    const taper = widthTapers.get(segIndex);
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
      .map(s => easeTightNodes(resampleGeometryToSpacing(s, roadNodeSpacingM), styleHalfWidth))
      // (a road on a dam's crest its own pieces there, as a bridge's way is:
      // a piece reaching from the terrain onto the dam drew nothing on it)
      .flatMap((s) => splitAtDams(s, structureGraph?.dams, (pt) => geoToWorldPoint(pt.lat, pt.lng, terrainData, squareSize, 0)))
      .flatMap(s => chunkPolyline(s, 250, { widthM: 2 * styleHalfWidth, spacingM: roadNodeSpacingM }));

    if (clippedSegments.length === 0) continue;

    const splineGroup = getOrCreateSplineGroup(cleanName);

    for (let i = 0; i < clippedSegments.length; i++) {
      const segment = clippedSegments[i];
      const rawNodes = [];
      const segWorld = segment.map((pt) => geoToWorldPoint(pt.lat, pt.lng, terrainData, squareSize, 0.1));
      for (let k = 0; k < segment.length; k++) {
        // geoToWorldPoint, not geoToWorld: the latter quantizes X/Y/Z to 0.1 m,
        // which at 2 m node spacing puts visible lateral jitter into the spline
        // (and its painted lines). Road nodes are mm-rounded below instead.
        const [wx, wy, groundZ] = segWorld[k];
        const before = segWorld[Math.max(0, k - 1)]; const after = segWorld[Math.min(segment.length - 1, k + 1)];
        const deckPart = bridges.bySeg.get(segIndex);
        const carried = bridges.approaches?.get(segIndex);
        const bore = tunnels.bySeg.get(segIndex) || tubeAt(wx, wy, after[0] - before[0], after[1] - before[1]);
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
      // (each node's own half width where the way narrows to the next one)
      const halfAt = taper ? centerNodes.map((nd) => taper(nd[0], nd[1], styleHalfWidth)) : null;
      if (halfAt) halfAt.forEach((h, k) => { centerNodes[k][3] = h; });
      const bridgePart = bridges.bySeg.get(segIndex);
      if (bridgePart) bridgePart.half = styleHalfWidth;
      // a deck carried on along this approach is as wide as the road on it
      const carriedPart = bridges.approaches?.get(segIndex);
      if (carriedPart) carriedPart.half = Math.max(carriedPart.half, styleHalfWidth);
      carriageways.push({
        owner: segIndex, nodes: centerNodes, half: styleHalfWidth, ...(halfAt ? { halfAt } : {}),
        tags: renderTags, highway, urban: urbanRoad, curbed: isCurbedStreet(feature), wayId: feature.id, oneWay: isOneWay,
        bridge: !!bridgePart, carried: !!carriedPart, tunnel: tunnels.bySeg.has(segIndex),
        leftExtra: crossSection.leftExtra, rightExtra: crossSection.rightExtra,
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
          halfAt,
          laneShift: crossSection.laneShift,
          markingStyle,
          urban: urbanRoad,
      curbed: isCurbedClass(highway) && (urbanRoad || isCurbedStreet(feature)),
      edgeSeed: String(feature.id),
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
          // (the road it belongs to, for the structure checks; not serialized)
          Object.defineProperty(decal, '__owner', { value: segIndex, enumerable: false });
          splineGroup.__items.push(decal);
          if (isCutPaintLayer(decal.__layer)) paintDecals.push({ decal, group: splineGroup, owner: segIndex });
          else if (decal.__layer === 'paving' || decal.__layer === 'asphalt') surfaceDecals.push({ decal, group: splineGroup, owner: segIndex });
        }
      }
    }
  }

  yield;
  const pedestrianStreets = buildPedestrianStreetDecals(terrainData, squareSize, carriageways, { raisedFootways: !!opts.raisedFootways });
  yield;
  for (const { decal, street } of pedestrianStreets.decals) getOrCreateSplineGroup(street).__items.push(decal);

  const carriagewayIndex = buildCarriagewayIndex(carriageways);
  const junctionMarkings = generateJunctionMarkingDecals(terrainData, squareSize, { carriageways: carriagewayIndex });
  yield;
  // the solved road heights (structure solver): a road's height at (x, y), its nearest station
  const solvedHeightOf = (() => {
    const z = structureGraph?.profile?.z;
    if (!z) return null;
    const bySeg = new Map();
    structureGraph.edges.forEach((e, k) => { if (!bySeg.has(e.seg)) bySeg.set(e.seg, []); bySeg.get(e.seg).push(k); });
    return (owner, x, y) => {
      const ks = bySeg.get(owner);
      if (!ks) return null;
      let best = Infinity; let zz = null;
      for (const k of ks) {
        const e = structureGraph.edges[k];
        for (let i = 0; i < e.s.length; i++) {
          const d = (e.x[i] - x) ** 2 + (e.y[i] - y) ** 2;
          if (d < best) { best = d; zz = z[k][i]; }
        }
      }
      return best < 400 ? zz : null;
    };
  })();
  cutPaintAtOtherRoads(paintDecals, carriagewayIndex, drivableRoads, ownersAtNode, junctionMarkings.zones || [], solvedHeightOf);
  const mouths = cutSurfaceAtOtherSurfaces(surfaceDecals, carriageways, carriagewayIndex, { americas: markingStyle === 'americas' });
  if (mouths.length) getOrCreateSplineGroup('road_mouths').__items.push(...mouths);
  yield;

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
  Object.defineProperty(groups, 'footpaths', { value: pedestrianStreets.footpaths, enumerable: false });
  Object.defineProperty(groups, 'serviceRoads', { value: pedestrianStreets.services, enumerable: false });
  Object.defineProperty(groups, 'bridges', { value: bridges, enumerable: false });
  Object.defineProperty(groups, 'tunnels', { value: tunnels, enumerable: false });
  Object.defineProperty(groups, 'crosswalkZones', { value: junctionMarkings.zones || [], enumerable: false });
  Object.defineProperty(groups, 'structureGraph', { value: structureGraph, enumerable: false });
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
const CROSSWALK_ZEBRA_WIDTH_M = 3;        // the game's zebra paint, across the road
const CROSSWALK_ZEBRA_REPEAT_M = 5;       // (the game's default, as Italy lays it)
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

/** Piers and footbridges as deck lines: [{ nodes, half, wood }]. */
function buildDeckPaths(terrainData, squareSize) {
  const out = [];
  for (const f of terrainData.osmFeatures || []) {
    const tags = f.tags || {};
    const pier = f.type === 'pier';
    if (!pier && !(['footway', 'path', 'cycleway'].includes(tags.highway) && isBridgeRoad(tags))) continue;
    if (!(f.geometry?.length > 1)) continue;
    const tagged = Number.parseFloat(tags.width);
    const half = (Number.isFinite(tagged) && tagged > 0 ? Math.min(12, Math.max(1, tagged)) : pier ? 2.4 : FOOTPATH_WIDTH_M[tags.highway] ?? 1.8) / 2;
    const concrete = ['concrete', 'asphalt', 'paved', 'paving_stones'].includes(tags.surface);
    for (const piece of clipGeometryToMargin(f.geometry, terrainData.bounds)) {
      const nodes = resampleGeometryToSpacing(piece, 2).map((p) => geoToWorldPoint(p.lat, p.lng, terrainData, squareSize, 0));
      const layer = Number.parseFloat(tags.layer);
      out.push({ nodes, half, bridge: !pier, wood: !concrete && (pier || tags.surface === 'wood' || tags.bridge === 'boardwalk' || !tags.surface), ...(Number.isFinite(layer) ? { layer } : {}) });
    }
  }
  return out;
}

/**
 * Build stop-line and crosswalk DecalRoads from OSM point features.
 *
 * Returns an array of DecalRoad objects (no group wrapper).
 */
export function generateJunctionMarkingDecals(terrainData, squareSize, { carriageways = null } = {}) {
  const features = terrainData.osmFeatures || [];
  if (!features.length) return [];
  const americasCrossings = getMarkingStyle(terrainData.roadRules) === 'americas';

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
    if ((baseName === 'jm_stopline' && !paintOn.markings) || (baseName === 'jm_crosswalk' && !paintOn.crosswalks)) return;
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

  // A crossing mapped as a way is drawn along that way, in the style mapped:
  // its ends are the sidewalks' own, so the paint meets them. Lines for
  // crossing:markings=lines, the game's zebra bars for zebra, between two
  // lines for a ladder; unsaid, the region's usual.
  const roadIndex = carriageways;   // (the index of the drawn carriageways)
  const paintCrossingWay = (feature, tags) => {
    if (!roadIndex) return false;
    const pts = feature.geometry.map((p) => geoToWorldPoint(p.lat, p.lng, terrainData, squareSize, 0));
    const samples = [];
    for (let i = 0; i + 1 < pts.length; i++) {
      const L = Math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1]);
      const n = Math.max(1, Math.ceil(L / 0.25));
      for (let k = 0; k < n; k++) samples.push([pts[i][0] + ((pts[i + 1][0] - pts[i][0]) * k) / n, pts[i][1] + ((pts[i + 1][1] - pts[i][1]) * k) / n]);
    }
    samples.push(pts[pts.length - 1]);
    let best = null; let from = null;
    samples.forEach((q, i) => {
      const on = carriagewaysAt(roadIndex, q[0], q[1], 0).length > 0;
      if (on && from === null) from = i;
      if (from !== null && (!on || i === samples.length - 1)) {
        const to = on ? i : i - 1;
        if (!best || to - from > best[1] - best[0]) best = [from, to];
        from = null;
      }
    });
    if (!best) return false;
    const a = samples[best[0]]; const b = samples[best[1]];
    const span = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (span < 2) return false;
    const dir = [(b[0] - a[0]) / span, (b[1] - a[1]) / span];
    const perp = [-dir[1], dir[0]];
    const cx = (a[0] + b[0]) / 2; const cy = (a[1] + b[1]) / 2;
    const half = span / 2;
    // (unmarked as to its style: the region's usual crossing, two lines in
    // the Americas, zebra bars elsewhere; crossing:markings=yes says only that it is marked)
    const tagged = String(tags['crossing:markings'] ?? '').trim().toLowerCase();
    const style = tagged && tagged !== 'yes' ? tagged : (americasCrossings ? 'lines' : 'zebra');
    if (style === 'lines' || style === 'lines:paired') {
      for (const side of [-1, 1]) pushLine('jm_crosswalk', cx + perp[0] * CROSSWALK_LINE_GAP_HALF_M * side, cy + perp[1] * CROSSWALK_LINE_GAP_HALF_M * side, dir[0], dir[1], -half, half, CROSSWALK_LINE_WIDTH_M);
    } else {
      const decal = paintOn.crosswalks ? makeRoadDecal([nodeAt(a[0], a[1], CROSSWALK_ZEBRA_WIDTH_M), nodeAt(b[0], b[1], CROSSWALK_ZEBRA_WIDTH_M)], sanitizeBeamNGObjectName(`jm_zebra_${decals.length + 1}`), 'junction_markings', {
        material: ZEBRA_CROSSING_MATERIAL, renderPriority: 1, breakAngle: 1, textureLength: CROSSWALK_ZEBRA_REPEAT_M,
      }) : null;
      if (decal) decals.push(decal);
      if (style.startsWith('ladder')) {
        for (const side of [-1, 1]) pushLine('jm_crosswalk', cx + perp[0] * (CROSSWALK_ZEBRA_WIDTH_M / 2 + 0.1) * side, cy + perp[1] * (CROSSWALK_ZEBRA_WIDTH_M / 2 + 0.1) * side, dir[0], dir[1], -half, half, CROSSWALK_LINE_WIDTH_M);
      }
    }
    zones.push({ x: cx, y: cy, ux: perp[0], uy: perp[1], halfLength: CROSSWALK_LINE_GAP_HALF_M + CROSSWALK_LINE_WIDTH_M / 2 + CROSSWALK_LINE_CLEAR_M, halfWidth: half + 1 });
    for (const p of feature.geometry) paintedCrossingKeys.add(makeRoadNodeKey(p));
    crossingCount++;
    return true;
  };

  // Crossings mapped as WAYS (footway/cycleway with *=crossing), with no road
  // drawn to measure against: painted where the way shares a vertex with the
  // road. Crossing NODES are handled below.
  for (const feature of features) {
    const tags = feature.tags || {};
    // (a crossing's paved outline, area:highway, is not a line to paint along)
    const isCrossingWay = !tags['area:highway'] && tags.area !== 'yes' &&
      (tags.footway === 'crossing' || tags.cycleway === 'crossing' || tags.path === 'crossing');
    if (!isCrossingWay || !shouldPaintCrossing(tags)) continue;
    if (!Array.isArray(feature.geometry) || feature.geometry.length < 2) continue;
    if (paintCrossingWay(feature, tags)) continue;

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
  // (lane markings switched off: no arrows either)
  if (!features.length || !paintOn.markings) return [];

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

  // Sibling groups whose names differ only in case ("Via Alessandro
  // Manzoni" / "VIa Alessandro Manzoni" in OSM) get separate folders that
  // collide on Windows when the zip is extracted (it asks to overwrite, and
  // a group's roads are lost): later ones are renamed, their children moved.
  const taken = new Set();
  for (const item of items) {
    if (item.class !== 'SimGroup' || !item.name) continue;
    let name = item.name;
    for (let k = 2; taken.has(name.toLowerCase()); k++) name = `${item.name}_c${k}`;
    if (name !== item.name) {
      for (const child of item.__items || []) if (child.__parent === item.name) child.__parent = name;
      item.name = name;
    }
    taken.add(name.toLowerCase());
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
  if (normalized === 'mapterhorn') {
    const mh = terrainData?.mapterhornInfo;
    if (!mh || mh.fallbackReason) return `Best free (Mapterhorn): ${mh?.fallbackReason === 'no_lidar' ? 'no lidar here' : 'Mapterhorn not reachable'}, global 30 m (AWS Terrain Tiles) used`;
    return `Best free: Mapterhorn lidar, z${mh.zoom} (~${Number(mh.metersPerPixel).toFixed(1)} m), on ${Math.round(mh.lidarFraction * 100)}% of the area; global 30 m (AWS Terrain Tiles) elsewhere (© Mapterhorn and its open-data sources, mapterhorn.com/attribution)`;
  }
  if (normalized === 'kron86') {
    return terrainData?.kron86Fallback ? 'NMT EVRF2007 requested, fell back to default/WGS84 source' : 'NMT EVRF2007 (Poland)';
  }
  if (normalized === 'default') {
    return sourceGeoTiffsSource ? `Global 30 m (${String(sourceGeoTiffsSource).toUpperCase()})` : 'Global 30 m (AWS Terrain Tiles)';
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
function exportPhaseWeights({ size, osmFeatureCount, roadCount, buildingCount, includeBackdrop, fineDetail = false, bridgeLidar = false }) {
  // Roughly seconds, from a timed 2048² export (px 0.25: 2211 roads, 2822
  // buildings, ~10k features): roads + sidewalks 9 s, base texture 1.7 s,
  // materials 1.2 s, terrain.ter 1.7 s, thumbnail 2.4 s, buildings 2.5 s,
  // furniture 2.5 s, vegetation 2.2 s, assembling 2.5 s, compression 7 s. The
  // progress card then paces each phase by this run's own speed.
  const px = (size / 4096) ** 2;
  return {
    prepare: 0.5,
    // fine ground detail and cliffs (8k: 6.5 s), measured bridge heights (~0.3 s a US survey node)
    detail: fineDetail ? 0.3 + 1.6 * px : 0,
    lidar: bridgeLidar ? 3 : 0,
    roads: 1 + 0.001 * roadCount,
    sidewalks: 0.0025 * roadCount,
    props: 0.5 + 0.0002 * roadCount,
    texture: 0.5 + 4.5 * px,
    materials: 0.3 + 3.5 * px,
    ter: 0.3 + 6 * px,
    heightmap: 0.2 + 1.4 * px,
    thumbnail: 0.5 + 7 * px,
    backdrop: includeBackdrop ? 4 + 15 * px : 0,
    buildings: 0.3 + 0.0008 * buildingCount,
    water: 0.2,
    furniture: 0.5 + 0.0002 * osmFeatureCount,
    vegetation: 0.5 + 0.00015 * osmFeatureCount,
    assets: 0.4,
    zip: 0.5 + 8 * px,
    compress: 2 + 0.002 * roadCount + 8 * px,
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
const onOff = (v) => (v ? 'on' : 'OFF');

/**
 * The terrain-shaping and structure switches, what each one covers and what
 * it did in this export, for export_report.txt. `section(title)` writes a
 * section heading into the caller's lines; returns the lines below it.
 */
function shapingReportLines(sh, section) {
  section('Terrain Shaping and Structures');
  const lines = [];
  const unchanged = !sh.rawTerrain && sh.includeBridges && sh.includeTunnels && sh.master && sh.roads && sh.bridges && sh.overpasses && sh.tunnels && sh.extras;
  lines.push(unchanged
    ? '- All defaults: the terrain was shaped for roads, bridges, overpasses, tunnels, sidewalks and lakes as usual.'
    : '- Some terrain shaping was switched off (advanced mode). Off means the export left those heights exactly as generated.');
  lines.push('', 'Data generation (before the export)');
  lines.push(`- Raw terrain: ${sh.rawTerrain ? 'on (no height blur, road snapping or road smoothing/levelling at generation; road curves kept)' : 'off (roads snapped, smoothed and levelled into the terrain at generation)'}`);
  if (sh.rawAreas) lines.push('- No smoothing areas: drawn (in those areas the heights were kept as downloaded at generation, eased in over 20 m at their edges, and the export held the roads on that ground)');
  lines.push('', 'Structures built');
  lines.push(`- Bridges & overpasses: ${onOff(sh.includeBridges)}${sh.includeBridges ? ` (${sh.decksBuilt} deck(s) built)` : ' (bridge roads drawn on the ground; no road lifted over another)'}`);
  lines.push(`- Tunnels: ${onOff(sh.includeTunnels)}${sh.includeTunnels ? ` (${sh.tunnelsBuilt} built)` : ' (tunnel roads drawn over the ground)'}`);
  lines.push('', 'Terrain shaping at export');
  lines.push(`- Master switch: ${onOff(sh.master)}${sh.master ? '' : ' (every switch below off)'}`);
  lines.push(`- Under roads (ground levelled to each road's smoothed profile, with side slopes): ${onOff(sh.roads)}`);
  lines.push(`- At bridges over water and valleys (approach embankments, abutment fill, ground kept clear under the deck): ${onOff(sh.bridges)}`);
  lines.push(`- At overpasses over roads (the same, for decks over another road): ${onOff(sh.overpasses)}`);
  lines.push(`- At tunnels (portal cuttings, headwall backfill, cut-and-cover cover): ${onOff(sh.tunnels)} (portal holes always open: they change no height)`);
  lines.push(`- Sidewalks, lake beds and car parks (ground under curbs and slabs, lake beds deepening away from the shore, multi-storey car park decks): ${onOff(sh.extras)}`);
  lines.push('', 'What the switches did here');
  const p = sh.plan;
  if (p) {
    const pct = p.stations ? ` (${((100 * p.fixedStations) / p.stations).toFixed(1)}%)` : '';
    lines.push(`- Road stations held exactly on the ground: ${p.fixedStations} of ${p.stations}${pct}; ordinary roads ${p.byRole.road}, bridge approaches ${p.byRole.bridge}, overpass approaches ${p.byRole.overpass}, tunnel roads and approaches ${p.byRole.tunnel}`);
    if (p.rawAreaStations) lines.push(`- Of those, in No smoothing areas: ${p.rawAreaStations}`);
    lines.push(`- Bridge/overpass roads built as plain decks (no embankment or abutment fill; deck wherever the road is ${'>'}0.1 m over the ground, its ends on the ground): ${p.rawDecks} road(s), ${sh.rawDeckParts} deck stretch(es)`);
    const spans = p.spans || [];
    if (spans.length) {
      lines.push(`- Plain decks spanning a dip rim to rim (straight from where the road leaves the ground to where it meets it again, past the OSM bridge's ends where the dip runs on): ${spans.length}`);
      for (const sp of spans.slice(0, 20)) {
        const at = (q) => `(${formatNumber(q[0], 0)}, ${formatNumber(q[1], 0)}) at ${formatNumber(q[2], 1)} m`;
        lines.push(`  - ${formatNumber(sp.length, 0)} m from ${at(sp.from)} to ${at(sp.to)}; OSM's bridge ${formatNumber(sp.osmLength, 0)} m`);
      }
      if (spans.length > 20) lines.push(`  - … ${spans.length - 20} more`);
    }
    if (p.rawDecks > spans.length) lines.push(`- Plain decks with no dip under them (flat ground or an overpass whose embankments the elevation lacks): ramped up within their own length, at up to twice the class grade`);
  } else {
    lines.push('- Road stations held on the ground: none (every road shaped as usual)');
  }
  if (sh.composedPixels != null) lines.push(`- Terrain grid points shaped for roads and structures: ${sh.composedPixels}${sh.skippedPieces ? `; ${sh.skippedPieces} road piece(s) left unshaped` : ''}`);
  if (sh.tunnelsNotFitting?.length) {
    lines.push(`- Tunnels left as roads on the ground because they don't fit the ground without shaping: ${sh.tunnelsNotFitting.length}`);
    for (const t of sh.tunnelsNotFitting.slice(0, 15)) {
      const names = [...new Set((t.osm || []).map((o) => o?.name || (o?.id != null ? `way ${o.id}` : null)).filter(Boolean))];
      lines.push(`  - ${names.join(', ') || 'unnamed'} (${formatNumber(t.length, 0)} m): ${t.reason}`);
    }
    if (sh.tunnelsNotFitting.length > 15) lines.push(`  - … ${sh.tunnelsNotFitting.length - 15} more`);
  }
  lines.push(`- Ground under sidewalks graded: ${sh.sidewalkGroundPixels} grid point(s)`);
  if (sh.lakeBedPixels != null) lines.push(`- Lake bed grid points dug: ${sh.lakeBedPixels}${sh.extras ? '' : ' (shaping off: only the survey\'s flat water surface, at most 1.5 m under the water, so the water shows over it)'}`);
  for (const lk of (sh.lakeDepths || []).slice(0, 12)) {
    lines.push(`  - ${lk.name || 'Unnamed lake'}: ${formatNumber(lk.depth, 1)} m at its deepest (${lk.source === 'osm' ? 'its OSM depth tag' : lk.source === 'dam' ? 'a reservoir: against its dam, the floor rising away from it' : lk.source === 'slope' ? `the shore's slope ${formatNumber(lk.slope * 100, 0)}% carried under the water` : 'no shore to read: the shallow bed'}), ${formatNumber(lk.reach, 0)} m from the nearest shore there${lk.banksEased ? `; ${lk.banksEased} grid point(s) of a wall at the waterline cut back into a bank` : ''}`);
  }
  if (sh.seabedPixels) lines.push(`- Sea floor grid points lowered under the sea (the survey recorded the water's surface; WorldCover water within 0.3 m of the sea): ${sh.seabedPixels}`);
  if (sh.lidar === null || sh.lidar === undefined) lines.push('- Measured bridge heights (US lidar): off');
  else if (sh.lidar.skipped) lines.push(`- Measured bridge heights (US lidar): not used, ${sh.lidar.skipped}`);
  else {
    const d = sh.lidar.datum;
    lines.push(`- Measured bridge heights (US lidar, USGS 3DEP ${sh.lidar.dataset}): ${sh.lidar.pinned} of ${sh.lidar.bridges} bridge stretches pinned at ${sh.lidar.stations} stations; ${sh.lidar.bridged ?? 0} more (movable spans, or measured along under 60% of their length) laid straight between measured neighbours, ${sh.lidar.partlyPinned ?? 0} more pinned along their measured runs clear of the ground (5 stations or more, 2 m over it), the rest kept the inferred profile`);
    lines.push(`  - Survey: ${sh.lidar.nodes} octree nodes, ${(sh.lidar.bytes / 1e6).toFixed(1)} MB, ${sh.lidar.points} points; tied to the terrain from its ground points: ${d.scale === 1 ? 'metres' : 'feet'}, ${d.offset >= 0 ? '+' : ''}${d.offset.toFixed(2)} m, spread ${d.spread.toFixed(2)} m over ${d.n} samples`);
    if (sh.lidar.partial.length) lines.push(`  - Not pinned (OSM way, stations measured/total): ${sh.lidar.partial.slice(0, 20).join(', ')}${sh.lidar.partial.length > 20 ? ', …' : ''}`);
  }
  if (sh.levelledUnderDecks) lines.push(`- Ground under bridge decks levelled to the ground beside them (the elevation data held the deck's own shape): ${sh.levelledUnderDecks} grid points`);
  if (sh.underDeckBedPixels) lines.push(`- Hidden water beds dug (under bridge decks, where the elevation data held the deck: a dam; along outlined rivers where the ground stood over the water): ${sh.underDeckBedPixels} grid points`);
  if (p && sh.residual) {
    lines.push(`- Worst left unmet with roads held on the ground: clearance short by ${formatNumber(sh.residual.crossing, 2)} m, water clearance short by ${formatNumber(sh.residual.water, 2)} m, grade ${formatNumber(sh.residual.grade * 100, 1)}% over the class limit, junction step ${formatNumber(sh.residual.joint, 2)} m (0 = met)`);
    lines.push('  (a plain deck must climb within its own length: it may ramp up to twice its class grade, and where even that can\'t reach the clearance, the clearance gives way)');
  }
  return lines;
}

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

  // ── Terrain shaping ────────────────────────────────────────────────────────
  if (d.shaping) lines.push(...shapingReportLines(d.shaping, section));

  // ── Roads ──────────────────────────────────────────────────────────────────
  section('Roads');
  const roadFeatures = (td?.osmFeatures || []).filter((f) => f.type === 'road' && f.geometry?.length > 1);
  {
    const measuredRoads = roadFeatures.filter((f) => f.tags?.['mapng:carriageway_width']);
    lines.push(`- Street widths measured between the buildings along them (no width tag in OSM): ${measuredRoads.length} of ${roadFeatures.length} roads${measuredRoads.length ? `; median ${formatNumber(measuredRoads.map((f) => Number(f.tags['mapng:carriageway_width'])).sort((a, b) => a - b)[Math.floor(measuredRoads.length / 2)], 1)} m curb to curb (lanes keep their class width; parking and shoulders give way or grow)` : ''}`);
  }
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
  const footpathCount = (groups.footpaths || []).length;
  const serviceCount = groups.serviceRoads?.count || 0;
  lines.push(`- Pedestrian streets drawn (highway=pedestrian, no traffic): ${(groups.pedestrianStreets || []).length - footpathCount - serviceCount} piece(s)`);
  lines.push(`- Service roads drawn (driveways, parking aisles, alleys; no traffic): ${serviceCount} piece(s), ${formatNumber((groups.serviceRoads?.length || 0) / 1000, 2)} km`);
  lines.push(`- Footpaths, cycleways and trails drawn (beside a street's raised sidewalk left out): ${footpathCount} piece(s), ${formatNumber((groups.footpaths || []).reduce((n, f) => n + pathLength(f.nodes), 0) / 1000, 2)} km`);
  lines.push('- Stone and brick paving (surface=sett/cobblestone/unhewn_cobblestone/paving_stones/bricks) is laid in strips about one texture tile wide: mapng_road_* materials, art/roads/main.materials.json.');

  // ── Structure checks ───────────────────────────────────────────────────────
  const sc = d.structureChecks;
  if (sc) {
    section('Structure checks');
    lines.push('- How well roads, bridges and tunnels fit together and the terrain around them. 0 is the goal for every count; "at" is world x, y in metres (F11 world editor coordinates).');
    const at = (w) => (w ? ` at (${w.at.join(', ')})` : '');
    const j = sc.joints;
    lines.push(`- Steps where roads meet (ends > ${0.1} m apart in height): ${j.steps} of ${j.joints} joints${j.worst ? `; worst ${formatNumber(j.worst.dz, 2)} m between ${j.worst.roads.join(' and ')}${at(j.worst)}` : ''}`);
    const g = sc.grades;
    const gl = (o, what) => `${o.count} stretch(es) on ${what}${o.worst ? `; worst ${formatNumber(o.worst.grade * 100, 1)}% (limit ${formatNumber(o.worst.limit * 100, 0)}%) on ${o.worst.road}${at(o.worst)}` : ''}`;
    lines.push(`- Steeper than the road class allows: ${gl(g.structure, 'bridges/tunnels')}; ${gl(g.ground, 'ground roads')}`);
    const c = sc.crossings;
    lines.push(`- Grade-separated crossings short of 6.5 m (deck top over the road under it): ${c.short} of ${c.crossings}${c.worst ? `; worst ${formatNumber(c.worst.gap, 2)} m between ${c.worst.roads.join(' and ')}${at(c.worst)}` : ''}`);
    if (sc.groundGaps) {
      const gg = sc.groundGaps;
      lines.push(`- Ground road nodes floating over / buried in the terrain (> 0.5 m): ${gg.off} of ${gg.nodes}${gg.worst ? `; worst ${formatNumber(gg.worst.dz, 2)} m on ${gg.worst.road}${at(gg.worst)}` : ''}`);
    }
    if (sc.throughDecks) {
      const td = sc.throughDecks;
      lines.push(`- Terrain over a deck's road surface or up into its clear underside: ${td.through} of ${td.samples} samples${td.worst ? `; worst ${formatNumber(td.worst.by, 2)} m on ${td.worst.deck}${at(td.worst)}` : ''}`);
    }
    const sp = sc.spikes;
    lines.push(`- Terrain spikes / pits near structures (> 2 m off their 3×3 median): ${sp.spikes} of ${sp.pixels} pixels${sp.worst ? `; worst ${formatNumber(sp.worst.off, 2)} m${at(sp.worst)}` : ''}`);
    const rs = sc.surface;
    if (rs) {
      lines.push('- Road surface (the terrain the road smoothing left under ground roads):');
      lines.push(`  - Bumps / dips along roads (grade changing more than the class allows within 6 m): ${rs.kinks.count} of ${rs.kinks.points} points${rs.kinks.worst ? `; worst ${formatNumber(rs.kinks.worst.kink * 100, 1)}% (limit ${formatNumber(rs.kinks.worst.limit * 100, 0)}%) on ${rs.kinks.worst.road}${at(rs.kinks.worst)}` : ''}`);
      lines.push(`  - Tilted (> 8%) or humped (> 0.2 m) across the road: ${rs.cross.count} of ${rs.cross.points} cross-sections${rs.cross.worst ? `; worst tilt ${formatNumber(rs.cross.worst.tilt * 100, 1)}%, hump ${formatNumber(rs.cross.worst.hump, 2)} m on ${rs.cross.worst.road}${at(rs.cross.worst)}` : ''}`);
      lines.push(`  - Junction centres bumped or dipped (> 0.25 m off the roads 12 m out): ${rs.junctions.count} of ${rs.junctions.checked} junctions${rs.junctions.worst ? `; worst ${formatNumber(rs.junctions.worst.bump, 2)} m at ${rs.junctions.worst.roads}${at(rs.junctions.worst)}` : ''}`);
      lines.push(`  - Creases just outside road edges (ground slope changing > 30% between 1-4 m and 4-8 m out): ${rs.creases.count} of ${rs.creases.points} points${rs.creases.worst ? `; worst ${formatNumber(rs.creases.worst.change * 100, 0)}% on ${rs.creases.worst.road}${at(rs.creases.worst)}` : ''}`);
    }
    // the worst places of each check, to fly to (F11 world editor or free camera)
    const places = [
      ['Steps where roads meet (m)', sc.joints.top],
      ['Too steep on bridges/tunnels (grade)', sc.grades.structure.top],
      ['Too steep on ground roads (grade)', sc.grades.ground.top],
      ['Crossings short of clearance (m short)', sc.crossings.top],
      ['Ground roads off the terrain (m)', sc.groundGaps?.top],
      ['Terrain through decks (m)', sc.throughDecks?.top],
      ['Terrain spikes / pits (m)', sc.spikes.top],
      ['Road bumps / dips (grade change)', sc.surface?.kinks.top],
      ['Road tilted / humped across', sc.surface?.cross.top],
      ['Junction centre bumps / dips (m)', sc.surface?.junctions.top],
      ['Creases beside roads (slope change)', sc.surface?.creases.top],
    ].filter(([, list]) => list?.length);
    if (places.length) {
      lines.push('- Worst places per check (value, world x, y, what):');
      for (const [title, list] of places) {
        lines.push(`  - ${title}:`);
        for (const p of list) lines.push(`    - ${p.value} at (${p.at.join(', ')}) ${p.what}`);
      }
    }
    const sg = d.decalRoads?.structureGraph?.stats;
    if (sg) {
      lines.push(`- Structure solver graph: ${sg.nodes} nodes, ${sg.edges} edges (${sg.bridgeEdges} bridge, ${sg.tunnelEdges} tunnel), ${sg.stations} stations; ${sg.joints} joints where a road goes onto a bridge, into a tunnel or changes layer, ${sg.junctions} junctions (${sg.multiLevelJunctions} mixing layers), ${sg.ends} dead ends, ${sg.edgeOfMap} roads leaving the map`);
      const cx = d.decalRoads.structureGraph.crossings?.stats;
      if (cx) lines.push(`- Structure solver crossings: ${cx.crossings} grade-separated (${cx.byLayer} by OSM layer, ${cx.byBridge} by bridge tag, ${cx.byTunnel} by tunnel tag), ${cx.unjoined} ground roads crossing level that OSM did not join; ${cx.waterRuns} bridge run(s) over water (${cx.channels} ship channel)`);
      const pf = d.decalRoads.structureGraph.profile; const pv = d.decalRoads.structureGraph.previewChecks;
      const cl = d.decalRoads.structureGraph.classes?.stats;
      if (cl?.lengthByKind) {
        const order = ['deck', 'embankment', 'boredTunnel', 'cutAndCover', 'cutting'];
        const label = { deck: 'deck', embankment: 'embankment', boredTunnel: 'bored tunnel', cutAndCover: 'cut-and-cover', cutting: 'cutting' };
        const parts = order.filter((k) => cl.byKind[k]).map((k) => `${label[k]} ${cl.byKind[k]} (${formatNumber(cl.lengthByKind[k] / 1000, 2)} km)`);
        lines.push(`- Structure solver classes: ${parts.join(', ') || 'all ground'}; ${cl.culverts} bridge tag(s) over nothing (culverts), ${cl.untaggedDecks} untagged stretch(es) that need a deck, ${cl.openTunnels} tunnel tag(s) too shallow for a roof (open cutting)`);
      }
      const vt = d.decalRoads.structureGraph.terrain;
      if (vt) {
        const su = vt.surface;
        lines.push(`- Structure solver v2 TERRAIN APPLIED (test switch): ${vt.pixels} pixels, ${vt.capped} held under decks, ${vt.wallPixels} on retaining-wall steps, ${vt.roadUnderDeckTooLow} road-core pixels under a deck too low over them (not dug), ${vt.ms} ms; under the solver's roads: ${su.kinks.count} bumps/dips, ${su.cross.count} tilted/humped cross-sections, ${su.junctions.count} of ${su.junctions.checked} junction centres off`);
        for (const [title, list] of [['bumps/dips', su.kinks.top], ['cross-sections', su.cross.top], ['junctions', su.junctions.top]]) {
          if (list?.length) lines.push(`  - v2 worst ${title}: ${list.slice(0, 5).map((p) => `${p.value} at (${p.at.join(', ')}) ${p.what}`).join('; ')}`);
        }
      }
      if (pf && pv) {
        lines.push(`- Structure solver profile (${pf.rounds} rounds, ${pf.ms} ms): steps ${pv.joints.steps}, too steep ${pv.grades.structure.count + pv.grades.ground.count}, short crossings ${pv.crossings.short} of ${pv.crossings.crossings}; remaining violations: joints ${pf.residual.joint} m, crossings ${pf.residual.crossing} m, grade +${pf.residual.grade}, water ${pf.residual.water} m, tunnel cover ${pf.residual.cover} m`);
      }
    }
    lines.push(`- Checked in ${sc.ms} ms.`);
  }

  // ── Structures (solver) ───────────────────────────────────────────────────
  const sgr = d.decalRoads?.structureGraph;
  if (sgr?.built && sgr.classes && sgr.profile) {
    section('Structures (solver)');
    lines.push('- Every road\'s height solved at once (joints level, crossings cleared, grade limits per class, bridges over water, tunnel cover), then each stretch classed from its height over the ground and its tags; the terrain is composed once from the result.');
    const cl = sgr.classes.stats;
    const label = { deck: 'deck', embankment: 'embankment', boredTunnel: 'bored tunnel', cutAndCover: 'cut-and-cover', cutting: 'cutting', external: 'tunnel (today\'s builder)', dam: 'on a dam (the dam its structure)' };
    for (const k of ['deck', 'embankment', 'cutting', 'cutAndCover', 'boredTunnel', 'external', 'dam']) {
      if (cl.byKind[k]) lines.push(`  - ${label[k]}: ${cl.byKind[k]} stretch(es), ${formatNumber((cl.lengthByKind[k] || 0) / 1000, 2)} km`);
    }
    lines.push(`- Bridge tags over nothing (culverts, no deck): ${cl.culverts}; approaches carried on as decks where a fill would reach a road below: ${cl.carried || 0} station(s); untagged stretches that needed a deck: ${cl.untaggedDecks}`);
    const r = sgr.profile.residual;
    lines.push(`- Left unmet by the solve (0 is the goal): joints ${r.joint} m, crossings ${r.crossing} m short, grades +${r.grade} over the limit, water clearance ${r.water} m short, tunnel cover ${r.cover} m short`);
    const t = sgr.terrain;
    if (t) lines.push(`- Terrain: ${t.pixels} pixels composed in ${t.ms} ms, ${t.capped} held under decks, ${t.despiked || 0} despiked, ${t.wallPixels} on retaining-wall steps, ${t.roadUnderDeckTooLow} road-core pixels under a deck too low over them`);
    const decksList = d.bridges?.decks || [];
    if (decksList.length) {
      lines.push('- Decks (b###, parts, length, highest over the ground):');
      decksList.forEach((deck, i) => {
        let len = 0; let hi = 0;
        for (const p of deck.parts) {
          for (let k = 1; k < p.xy.length; k++) len += Math.hypot(p.xy[k][0] - p.xy[k - 1][0], p.xy[k][1] - p.xy[k - 1][1]);
          const e = sgr.edges[p.edge];
          if (e) for (let k = 0; k < e.s.length; k++) if (e.s[k] >= p.s0 && e.s[k] <= p.s1) hi = Math.max(hi, sgr.profile.z[p.edge][k] - e.g[k]);
        }
        lines.push(`  - b${String(i + 1).padStart(3, '0')}: ${deck.parts.length} part(s), ${formatNumber(len, 0)} m, up to ${formatNumber(hi, 1)} m${deck.parts.some((p) => !sgr.edges[p.edge]?.bridge) ? ' (includes untagged / carried stretches)' : ''}`);
      });
    }
  }

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
    lines.push(`  - Objects: bridge_${key}.dae + bridge_${key}_deck.dae (the road surface)${(dae?.extras || []).map((e) => ` + bridge_${key}_${e.kind}.dae`).join('')}${dae ? `, ${Math.round(dae.triangles)} triangles, origin (${dae.origin.map((v) => formatNumber(v, 1)).join(', ')})` : ' (not written: no geometry)'}`);
    if (dae?.style) lines.push(`  - Style: ${dae.style.type}${dae.style.type === 'arch' ? ' (a steel arch over the deck from 250 m in one span, else deck arches)' : ''}, ${dae.style.paint} paint${dae.style.material ? `, ${dae.style.material}` : ''}; from its ${dae.style.source}${dae.style.corridor > 1 ? `, shared by the ${dae.style.corridor} decks side by side` : ''}; ${dae.style.spans.length} span(s): ${dae.style.spans.map((sp) => `${formatNumber(sp.s1 - sp.s0, 0)} m`).join(', ')}`);
    else if (dae) lines.push('  - Style: a plain deck (no bridge type in the map: its road or outline)');
  });

  // ── Tunnels ────────────────────────────────────────────────────────────────
  section('Tunnels');
  const tun = d.tunnels;
  const bored = tun?.tunnels || [];
  const left = tun?.skipped || [];
  lines.push(`- Tunnels built: ${bored.length} (${bored.filter((t) => t.kind === 'cutcover').length} cut and cover, ${bored.filter((t) => t.kind === 'gallery').length} galleries); tunnel=yes roads left on the ground: ${left.length}; portal hole squares: ${(tun?.holes || []).length}`);
  lines.push('- Drivable tunnel=yes and tunnel=avalanche_protector roads are built (building passages, culverts and covered ways stay as they were).');
  lines.push('- A bored tunnel needs the ground over its road by the tube height + 1.5 m along most of it; short dips are filled over the tube.');
  lines.push('- One mapped under flat ground (a city deck, an underpass) is cut and cover: a box 0.8 m under the street, its approaches in trenches.');
  lines.push('- On a hillside without the rock over it (and tunnel=avalanche_protector) a gallery: a roof on valley-side columns, the hillside brought up to the roof as its back (backfilled where the slope is lower), the road where it is.');
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
    lines.push(`  - ${t.kind === 'cutcover' ? 'Cut-and-cover box' : t.kind === 'gallery' ? `Gallery (hillside ${t.uphill > 0 ? 'right' : 'left'} up to the roof, columns on the valley side)` : 'Bore'} ${formatNumber(t.tubeLength, 1)} m of ${formatNumber(t.length, 1)} m mapped; inside width ${formatNumber(2 * t.W, 1)} m${t.maxExtra > 0 ? ` (up to ${formatNumber(2 * t.W + t.maxExtra, 1)} m where ramps join)` : ''}, crown ${formatNumber(t.crown, 2)} m over the road`);
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

  // ── Railways ───────────────────────────────────────────────────────────────
  const rw = d.railways?.stats;
  section('Railways');
  if (!rw) {
    lines.push('- No railway built (none in the map data, or the structure solver off). Active railway=rail, light_rail, subway (above ground), tram, narrow_gauge, monorail and funicular lines are built; abandoned, disused, razed, construction and proposed ones are not.');
  } else {
    lines.push('- Each line\'s height is solved with the roads (grade limits per kind: rail 2.5 %, narrow gauge and subway 4 %, light rail 6 %, tram 7 %, funicular none), bridges and tunnels from its tags and what it crosses; the track (rails, concrete or timber sleepers, gravel ballast) is laid on the solved profile, its formation shaped into the terrain.');
    lines.push(`- Lines: ${rw.lines}; track: ${formatNumber(rw.trackKm, 2)} km (every track of a multi-track line counted), ${rw.sleepers} sleepers, ${rw.triangles} triangles in ${d.railways.daes.length} object(s)`);
    for (const [kind, v] of Object.entries(rw.byKind)) {
      const steep = rw.steepest[kind];
      lines.push(`  - ${kind.replace(/_/g, ' ')}: ${v.lines} line(s), ${formatNumber(v.km, 2)} km, ${formatNumber(v.bridgeKm, 2)} km on bridges, ${formatNumber(v.tunnelKm, 2)} km in tunnels${steep ? `; steepest ${formatNumber(steep.grade * 100, 1)} % at (${formatNumber(steep.x, 0)}, ${formatNumber(steep.y, 0)})` : ''}`);
    }
    const sk = rw.structureKm || {};
    lines.push(`- Along the lines: ${['ground', 'embankment', 'cutting', 'deck', 'external', 'boredTunnel', 'cutAndCover'].filter((k) => sk[k]).map((k) => `${{ ground: 'on the ground', embankment: 'embankment', cutting: 'cutting', deck: 'bridge', external: 'tunnel', boredTunnel: 'tunnel (unbuilt)', cutAndCover: 'cut and cover (unbuilt)' }[k]} ${formatNumber(sk[k], 2)} km`).join(', ') || 'n/a'}`);
    lines.push(`- Rail bridges: ${rw.bridgeRuns} deck run(s)${rw.bridgeNames.length ? ` (${rw.bridgeNames.slice(0, 12).join(', ')}${rw.bridgeNames.length > 12 ? ', ...' : ''})` : ''}; their decks are listed under Bridges with [railway:<kind>]`);
    lines.push(`- Rail tunnels: ${rw.tunnelRuns} run(s)${rw.tunnelNames.length ? ` (${rw.tunnelNames.slice(0, 12).join(', ')})` : ''}; built ones are listed under Tunnels. A light rail, tram or monorail line in a tunnel (a city's metro tunnel) is not built, nor a subway below ground.`);
    lines.push(`- Level crossings: ${rw.roadCrossings} with roads, ${rw.pathCrossings} with paths (the road and the rails at one height, the crossing surfaced with the game's tram-rail decal); ${rw.unjoinedCrossings} where a road and a line pass through each other with no shared node (laid level, no ballast across the road)`);
    lines.push(`- Trams in their streets (drawn on the street with the tram-rail decal, no track bed): ${rw.streetTramLines} line(s), ${formatNumber(rw.streetTramKm, 2)} km`);
  }

  // ── Buildings ──────────────────────────────────────────────────────────────
  section('Buildings');
  const br = d.buildingReport || {};
  const st = br.stats;
  if (!st) {
    lines.push('- No buildings exported (none in the map, or buildings off).');
  } else {
    lines.push(`- OSM building footprints: ${st.footprints}, built: ${br.built}`);
    lines.push(`- Skipped: invalid geometry ${st.skipped.badGeometry}, under 4 m² ${st.skipped.tiny}, over 50,000 m² (non-industrial) ${st.skipped.oversize}, no terrain under them ${st.skipped.noGround}, over the building cap ${st.skipped.overCap}, bridge piers / towers mapped as buildings (drawn by the bridges) ${st.skipped.bridgeParts || 0}`);
    lines.push(`- Shapes: ${br.tiles ?? 0} building tile(s) (each a full detail level near the camera and a lite one from about ${BUILDING_LITE_FROM_M} m: no laid-over windows, soffits or small details), ${br.meshes} full mesh(es), ${Math.round(br.triangles)} triangles; collision: the lite walls and roofs`);
    const avg = (a) => (br.built ? a.sum / br.built : NaN);
    lines.push(`- Floors: min ${br.built ? st.floors.min : 'n/a'}, mean ${formatNumber(avg(st.floors), 1)}, max ${st.floors.max}`);
    lines.push(`- Eave height: min ${br.built ? formatNumber(st.height.min, 1) : 'n/a'} m, mean ${formatNumber(avg(st.height), 1)} m, max ${formatNumber(st.height.max, 1)} m`);
    const hs = st.heightSource || {};
    lines.push(`- Heights from: OSM tags ${hs.tagged || 0}, Overture (Microsoft / Google ML) ${hs.overture || 0}, the median of tagged neighbours of the same kind within 120 m ${hs.neighbours || 0}, estimated from class and size ${hs.estimated || 0}`);
    lines.push(`- On sloping ground: ${st.groundSpread.over3m} footprint(s) span more than 3 m of terrain (max ${formatNumber(st.groundSpread.max, 1)} m; their plinth reaches the lowest corner)`);
    lines.push(`- Shop fronts: ${st.shopFronts}, offices: ${st.offices}, courtyards (inner rings): ${st.withHoles}`);
    const dt = st.details || {};
    lines.push(`- Details: parapets ${dt.parapets || 0}, shop awnings / fascias ${dt.shopfronts || 0}, verandas ${dt.veranda || 0}, door hoods ${dt.hood || 0}, front steps ${dt.steps || 0}, chimneys ${dt.chimneys || 0}, roof plant pieces ${dt.roofPlant || 0}, church towers ${dt.towers || 0}, domes ${dt.domes || 0}, silos / tanks ${dt.silos || 0}, passage openings ${dt.passages || 0}, castles / forts ${dt.forts || 0} (merlons ${dt.merlons || 0}, sentry boxes ${dt.sentryBoxes || 0}, corner towers ${dt.cornerTowers || 0}, gates ${dt.gates || 0})`);
    if (st.uses || dt.historic) lines.push(`- Building uses with their own look (from the building's tags or a point inside it): ${Object.entries(st.uses || {}).map(([k, v]) => `${k} ${v}`).join(', ') || 'none'}; historic ${dt.historic || 0}. Hotel canopies ${dt.hotelCanopies || 0}, flags ${dt.hotelFlags || 0}, rooftop signs ${dt.hotelSigns || 0}; pub signs ${dt.pubSigns || 0}; café signs ${dt.cafeSigns || 0}; string courses ${dt.courses || 0}`);
    if (br.sportsLights && Object.keys(br.sportsLights).length) lines.push(`- Floodlights (poles by kind of venue, grandstand downlights; OSM lit=no respected, road courses and off-road tracks only with lit=yes): ${Object.entries(br.sportsLights).map(([k, v]) => `${k} ${v}`).join(', ')}`);
    if (br.dragGrade?.strips) lines.push(`- Drag strips graded smooth (always, whatever the shaping switches: a real strip is laser-graded): ${br.dragGrade.strips}, ${br.dragGrade.pixels} terrain points; bumps along the centre line ${formatNumber(br.dragGrade.before * 100, 1)} cm rms before, ${formatNumber(br.dragGrade.after * 100, 1)} cm after (the strip's own grade kept, smoothed over ±${DRAG_PROFILE_M} m)`);
    if (dt.racing) lines.push(`- Racetracks (highway=raceway by kind: kerbs round paved bends, kart tyre walls, a dirt oval's wall and catch fence, a drag strip's light tree and walls; area=yes raceways as surfaces): ${Object.entries(dt.racing).map(([k, v]) => `${k} ${v}`).join(', ')}`);
    if (dt.pitches) lines.push(`- Sports fields (OSM leisure=pitch / track by sport=*: surface by surface=* or the sport's usual one, regulation markings scaled to the mapped size, goals, posts, hoops, nets, fences): ${Object.entries(dt.pitches).map(([k, v]) => `${k} ${v}`).join(', ')}`);
    if (dt.seating) lines.push(`- Seating (building=grandstand, leisure=bleachers: tiered seats facing the nearest field): ${Object.entries(dt.seating).map(([k, v]) => `${k} ${v}`).join(', ')}`);
    if (dt.pools) lines.push(`- Swimming pools (OSM leisure=swimming_pool, outdoors: sunk in the ground with a deck, its terrain squares opened; lane pools, wading pools, above-ground pools): ${Object.entries(dt.pools).map(([k, v]) => `${k} ${v}`).join(', ')}; shapes (free-form outlines smoothed, the rest as mapped): ${Object.entries(dt.poolShapes || {}).map(([k, v]) => `${k} ${v}`).join(', ')}`);
    if (dt.dams?.length) lines.push(`- Dams (OSM waterway=dam, concrete over the gap the elevation data left; the terrain as the data has it): ${dt.dams.map((d) => `${d.name || 'unnamed'} (up to ${d.gap} m tall over the ground)`).join(', ')}`);
    if (dt.fountains) lines.push(`- Fountains (OSM amenity=fountain / drinking_water, by kind from fountain=* and shape: stone basins with water, bowls, jets, obelisks, pools, wall spouts, splash pads, drinking posts): ${Object.entries(dt.fountains).map(([k, v]) => `${k} ${v}`).join(', ')}`);
    const sorted = (o) => Object.entries(o).sort((a, b) => b[1] - a[1]);
    lines.push('- Kinds:'); listCounts(sorted(st.kinds));
    lines.push('- OSM building=* classes:'); listCounts(sorted(st.classes), 30);
    lines.push('- Roofs:'); listCounts(sorted(st.roofs));
    lines.push('- Wall materials:'); listCounts(sorted(st.walls));
  }
  const bc = d.buildingConflicts;
  if (bc) {
    lines.push(`- Buildings on roads (each footprint checked against the roads' driving lanes; tunnels, building passages, covered ways, bridges, driveways and parking aisles never count):`);
    lines.push(`  - Machine-learned / cadastre outlines (Overture, no OSM source) on a road, left out: ${bc.dropped.length}`);
    lines.push(`  - OSM buildings reaching into the lanes, cut back along the lanes' edge: ${bc.clipped.length} (OSM buildings are never left out)`);
    lines.push(`  - OSM buildings largely on a road, kept as mapped: ${bc.flagged.length}${bc.flagged.length ? ' (check these in the map data: a misplaced footprint, or a road through a passage not tagged tunnel=building_passage)' : ''}`);
    for (const x of bc.flagged.slice(0, 25)) lines.push(`    - ${x.id}: ${Math.round(x.share * 100)}% of it on the lanes`);
    if (bc.flagged.length > 25) lines.push(`    - … ${bc.flagged.length - 25} more`);
  }

  // ── Sidewalks and street furniture ─────────────────────────────────────────
  section('Sidewalks and Street Furniture');
  const sw = d.sidewalks || {};
  lines.push(`- Sidewalk curb runs: ${(sw.runs || []).length}, raised walkways away from the curb: ${(sw.walkRuns || []).length}, piers and footbridges: ${(sw.deckRuns || []).length}, gangways: ${sw.gangways?.ramp ?? 0} ramps + ${sw.gangways?.stairs ?? 0} stairs, meshes: ${(sw.meshes || []).length}, triangles (with medians): ${sw.triangles ?? 0}`);
  const swg = d.structureChecks?.sidewalks;
  if (swg) lines.push(`- Sidewalks on the terrain: ${swg.floating} of ${swg.samples} samples floating, ${swg.buried} buried; ground graded under them: ${sw.groundPixels ?? 0} pixels${swg.worst ? `; worst ${swg.worst.gap} m at (${swg.worst.at.join(', ')}) on a ${swg.worst.road}` : ''}`);
  const medianRuns = sw.medianRuns || [];
  const medianM = medianRuns.reduce((n, r) => n + polylineLength(r.points), 0);
  lines.push(`- Divided-road medians: ${medianRuns.length} island run(s), ${formatNumber(medianM / 1000, 2)} km of curb, on ${new Set(medianRuns.map((r) => r.owner)).size} carriageway(s)`);
  const sp = d.streetProps || {};
  const mp = d.mappedStreetProps || {};
  lines.push(`- Street props placed: ${(sp.hydrants || []).length} hydrants, ${(sp.bins || []).length} bins, ${(sp.benches || []).length} benches, ${(sp.poles || []).length} utility poles, ${(sp.wires || []).length} power line spans`);
  if (sp.countryPoles === false) lines.push('- Utility poles: only the ones OpenStreetMap maps. Pole lines along country roads are added where they are the norm (North America, Japan, Australia, New Zealand), not here.');
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
  if (d.barrierObjects?.gateStats?.length) lines.push(`- Open gates and openings: ${d.barrierObjects.gateStats.map(([k, v]) => `${v} ${k}`).join(', ')}`);
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
  if (ws?.sea?.blocks != null) lines.push(`- Sea: ${ws.sea.blocks} WaterBlocks in place of the sea-level plane (ground or a cut below sea level the open sea doesn't reach stays dry; no water in a tunnel's trenches, none deeper than its roof over the tube)`);
  if (ws?.pools?.poolBlocks || ws?.pools?.fountainBlocks) lines.push(`- Pool and fountain water: ${ws.pools.poolBlocks} WaterBlocks in ${ws.pools.pools} pools, ${ws.pools.fountainBlocks} in ${ws.pools.fountains} fountains (clear, pale blue, slow ripples; each reaching under its coping or rim)`);
  if (ws?.backdrop) lines.push(`- Water over the backdrop (the lakes, ponds and rivers round the map): ${ws.backdrop.blocks} lake WaterBlocks in ${ws.backdrop.lakes} lakes, ${ws.backdrop.rivers} rivers`);
  if (ws?.lakes?.riverAreas) lines.push(`- Wide or tidal rivers as area water (WaterBlocks at the river's level, no River ribbon in them): ${ws.lakes.riverAreas}`);
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
  spawnReport = null,
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
    // (the whole control panel as one line: paste it into MapNG to get these settings)
    ...(typeof options?.sessionCode === 'string' && options.sessionCode ? [`- Session config (paste into MapNG): ${options.sessionCode}`] : []),
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
    ...(originalTerrainData?.groundFilterInfo ? [`- Ground under buildings (global 30 m): ${(() => { const g = originalTerrainData.groundFilterInfo;
      if (g.applied) return `taken out: ${(g.share * 100).toFixed(0)}% of the area lowered, mean ${g.meanCut.toFixed(1)} m, up to ${g.maxCut.toFixed(1)} m (rooftop signal ${g.dsmSlope.toFixed(2)}; GEDTM30, OpenGeoHub, CC-BY 4.0${g.copMixed ? '; averaged with Copernicus GLO-30, DLR e.V. / Airbus, EU and ESA, via Mapterhorn' : ''})`;
      return { bare_earth_already: 'not needed, the elevation here is bare earth already', gedtm_unavailable: 'skipped, GEDTM30 not reachable', error: 'skipped after an error', no_fit: 'skipped, not enough map data' }[g.reason] || `skipped (${g.reason})`; })()}`] : []),
    `- Source GeoTIFF source: ${originalTerrainData?.sourceGeoTiffs?.source ? String(originalTerrainData.sourceGeoTiffs.source).toUpperCase() : 'n/a'}`,
    `- Normalized terrain size for BeamNG (square power-of-two): ${formatBool(didCropToSquare)}`,
    `- Terrain samples (valid/no-data/total): ${terrainSampleSummary.valid}/${terrainSampleSummary.noData}/${terrainSampleSummary.total}`,
    `- Terrain no-data ratio: ${Number.isFinite(terrainSampleSummary.noDataRatio) ? `${formatNumber(terrainSampleSummary.noDataRatio * 100, 2)}%` : 'n/a'}`,
    `- Terrain sample warning: ${terrainSampleSummary.allInvalid ? 'ALL_ELEVATION_SAMPLES_INVALID (export likely unreliable)' : 'none'}`,
    '',
    'Selected Export Options',
    `- Base texture: ${options?.baseTexture ?? 'n/a'}`,
    `- Include buildings: ${formatBool(options?.includeBuildings)}`,
    `- Include bridges & overpasses: ${formatBool(options?.includeBridges !== false)}`,
    `- Include tunnels: ${formatBool(options?.includeTunnels !== false)}`,
    `- Terrain shaping at export (master): ${formatBool(options?.shapeTerrain !== false)}`,
    `- Shape terrain under roads / at bridges / at overpasses / at tunnels / sidewalks+lakes+car parks / fine ground detail (global 30 m): ${[options?.shapeRoads, options?.shapeBridges, options?.shapeOverpasses, options?.shapeTunnels, options?.shapeExtras, options?.shapeDetail].map((v) => (options?.shapeTerrain !== false && v !== false ? 'Yes' : 'No')).join(' / ')}`,
    `- Raw terrain at data generation: ${formatBool(!!originalTerrainData?.raw)}`,
    '  (details: "Terrain Shaping and Structures" below)',
    `- Include backdrop: ${formatBool(options?.includeBackdrop)}`,
    `- PBR materials: ${effectivePbrSource === 'none' ? 'No' : 'Yes'}`,
    `- PBR source requested: ${options?.requestedPbrSource ?? 'n/a'}`,
    `- PBR source used: ${effectivePbrSource}`,
    `- Include water: ${formatBool(options?.includeWater)}`,
    `- Measured bridge heights (US lidar): ${formatBool(options?.lidarDecks !== false)}`,
    `- Include native barriers: ${formatBool(options?.includeNativeBarriers)}`,
    `- Safe caps on content: ${options?.safeCaps === false ? 'No (everything in the map built)' : `Yes (at most ${Object.entries(SAFE_CAPS).map(([k, v]) => `${v} ${k}`).join(', ')})`}`,
    `- Include trees/bushes: ${formatBool(options?.includeTrees)}`,
    `- Forest density: ${options?.forestDensity || 'normal'} (×${forestDensityMultiplier(options?.forestDensity)} the base tree rates; woods ~${Math.round(36 * forestDensityMultiplier(options?.forestDensity))} trees/ha)`,
    `- Include rocks: ${formatBool(options?.includeRocks)}`,
    `- Include sidewalks: ${formatBool(options?.includeSidewalks !== false)}`,
    ...(() => {
      // What to build (services/buildContent.js): the features switched off and the OSM left out for them
      const cf = options?.contentFilter;
      if (!cf || (!cf.off.length && !cf.tags.length)) return ['- What to build: everything'];
      const top = Object.entries(cf.byTag || {}).sort((a, b) => b[1] - a[1]).slice(0, 12).map(([k, n]) => `${k} ${n}`).join(', ');
      return [
        `- What to build, switched off: ${cf.off.length ? cf.off.join(', ') : 'none'}`,
        ...(cf.userTags.length ? [`- OSM tags left out one by one: ${cf.userTags.join(', ')}`] : []),
        `- OSM features left out for them: ${cf.removed}${top ? ` (${top})` : ''}`,
      ];
    })(),
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
    ...(forestPlacements?.underwater ? [`- Left out under water (below the sea plane or a lake's surface): ${forestPlacements.underwater.dropped} trees, bushes and plants; ${forestPlacements.underwater.kept} kept, within ${UNDERWATER_ROAD_M} m of a road (one in ${UNDERWATER_KEEP})`] : []),
    ...(forestPlacements?.landCover ? [forestPlacements.landCover.used
      ? `- Left out by land cover (${forestPlacements.landCover.attribution}): ${forestPlacements.landCover.dropped.wood} trees (of mapped woods, or seen as canopy in the imagery) where it sees no tree cover, ${forestPlacements.landCover.dropped.bush} bushes on rock, snow or water, ${forestPlacements.landCover.dropped.scatter} scattered trees on bare ground`
      : '- Land cover (ESA WorldCover): unavailable, trees follow OSM alone'] : []),
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

  reportLines.push(...spawnReportLines(spawnReport));
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
// The flag at the map's summit (services/flagPlacement.js: spikes and the
// map's edges left out), on a terrain vertex as the game draws it (samples
// squareSize apart from minus half the extent, rows from the south), its
// foot 10 cm into the ground.
function findHighestTerrainPoint(terrainData, squareSize) {
  const { width, height, heightMap, minHeight } = terrainData;
  const cell = pickFlagCell(terrainData);
  if (!cell) return [0, 0, 0];
  const j = height - 1 - cell.row;
  return [
    roundTo((cell.col - width / 2) * squareSize, 3),
    roundTo((j - height / 2) * squareSize, 3),
    roundTo(heightMap[cell.row * width + cell.col] - (Number(minHeight) || 0) - 0.1, 3),
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




/**
 * Convert a geographic point to BeamNG world-space coordinates.
 */
/**
 * The laz decoder and the survey index in the browser (the WASM and the index
 * are served by the app); a script passes its own (options.lidarProvider).
 */
export async function defaultLidarProvider() {
  // (in Node, the desktop app's export runner: laz-perf's Node build, which
  // finds its own WASM; the web build's directory import fails there, and the
  // installed app built every bridge deck without its measured height)
  const inNode = typeof process !== 'undefined' && !!process.versions?.node && typeof window === 'undefined';
  const lp = inNode
    ? await (await import(/* @vite-ignore */ ['laz-perf', 'lib', 'node', 'index.js'].join('/'))).createLazPerf()
    : await (await import('laz-perf/lib/web')).createLazPerf({ locateFile: (path) => (path.endsWith('.wasm') ? '/laz-perf.wasm' : path) });
  const index = (await (await fetch('/ept-index.json')).json()).datasets;
  return { index, lp, fetchImpl: (...a) => fetch(...a) };
}

const isMovableBridge = (tags = {}) => tags.bridge === 'movable' || !!tags['bridge:movable'];

/**
 * What the export's downloads are made from, without the export: the terrain
 * cropped to its square power of two (heights, bounds, OSM: no textures) and
 * its features as the export filters them (to the bounds, out of background
 * areas), with its square size. The export's data step
 * (services/exportData.js) fetches the backdrop and the bridge survey from
 * this, the same requests the export then finds in the cache.
 */
export function exportDataInputs(terrainData, options = {}) {
  let td = terrainData;
  const size = computeBeamNGTerrainSize(td.width, td.height);
  if (td.width !== size || td.height !== size) {
    const startX = Math.floor((td.width - size) / 2); const startY = Math.floor((td.height - size) / 2);
    const heightMap = cropHeightmap(td.heightMap, td.width, td.height, startX, startY, size);
    let minHeight = Infinity; let maxHeight = -Infinity;
    for (let i = 0; i < heightMap.length; i++) { const h = heightMap[i]; if (h < minHeight) minHeight = h; if (h > maxHeight) maxHeight = h; }
    if (minHeight === Infinity) minHeight = td.minHeight;
    if (maxHeight === -Infinity) maxHeight = td.maxHeight;
    const bounds = adjustBounds(td.bounds, td.width, td.height, startX, startY, size);
    td = { ...td, width: size, height: size, heightMap, minHeight, maxHeight, bounds, osmFeatures: cropOSMFeatures(td.osmFeatures, bounds) };
  }
  let features = filterOSMFeaturesToBounds(td.osmFeatures, td.bounds);
  const bgMask = td.backgroundMask || options.backgroundMask || null;
  const bgLook = bgMask ? backgroundLookup(bgMask, { n: 2048 }) : null;
  if (bgLook && features?.length) features = filterFeaturesByBackground(features, bgLook, bgMask.bounds);
  return { terrainData: { ...td, osmFeatures: features }, squareSize: computeSquareSize(td) };
}

/**
 * Measured bridge heights (US lidar, lidarDecks.js): the survey along the
 * export's bridge ways, read before the roads are laid out (the solver takes
 * it as pins). Returns prepareSurvey's lookups or { skipped }.
 */
export async function prefetchLidarDecks(terrainData, squareSize, options, onProgress) {
  const { bounds, width } = terrainData; const ws = width * squareSize;
  const toLocal = (lat, lng) => [((lng - bounds.west) / (bounds.east - bounds.west) - 0.5) * ws, (0.5 - (bounds.north - lat) / (bounds.north - bounds.south)) * ws];
  const toGeo = (x, y) => [bounds.north - (0.5 - y / ws) * (bounds.north - bounds.south), bounds.west + (x / ws + 0.5) * (bounds.east - bounds.west)];
  const bridgeLines = [];
  for (const f of terrainData.osmFeatures || []) {
    const t = f.tags || {};
    if (f.type !== 'road' || !t.bridge || t.bridge === 'no' || isMovableBridge(t) || !(f.geometry?.length > 1)) continue;
    const raw = f.geometry.map((p) => toLocal(p.lat, p.lng));
    if (!raw.some(([x, y]) => Math.abs(x) < ws / 2 && Math.abs(y) < ws / 2)) continue;
    const pts = [];
    for (let i = 0; i + 1 < raw.length; i++) {
      const [ax, ay] = raw[i]; const [bx, by] = raw[i + 1];
      const n = Math.max(1, Math.round(Math.hypot(bx - ax, by - ay) / 4));
      for (let k = 0; k < n; k++) pts.push([ax + ((bx - ax) * k) / n, ay + ((by - ay) * k) / n]);
    }
    pts.push(raw.at(-1));
    bridgeLines.push({ pts });
  }
  if (!bridgeLines.length) return { skipped: 'no bridges' };
  const provider = options.lidarProvider ? await options.lidarProvider() : await defaultLidarProvider();
  const minHeight = Number(terrainData.minHeight) || 0;
  const maxHeight = Number(terrainData.maxHeight) || minHeight + 100;
  return prepareSurvey({
    bridgeLines, toGeo, toLocal, provider, onProgress,
    demAtAbs: (x, y) => getTerrainHeightAtWorldXY(x, y, terrainData, squareSize) + minHeight,
    zAbs: [minHeight, maxHeight + 60],
  });
}

function inRingXY(x, y, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]; const [xj, yj] = ring[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}


/**
 * Sample terrain height (relative to minHeight, like geoToWorldPoint's Z) at a
 * world-space X/Y position. Inverse of geoToWorldPoint's planar mapping:
 *   worldX = (u - 0.5) * worldSize ; worldY = (0.5 - v) * worldSize.
 */
export function getTerrainHeightAtWorldXY(worldX, worldY, terrainData, squareSize) {
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
    meshLength: 3,
    zOffset: 0.05,
    yawOffset: Math.PI * 0.5,
  },
  fence: {
    shapeName: '/levels/east_coast_usa/art/shapes/buildings/eca_bld_wood_fence_a.DAE',
    // its picket panel runs from its origin 1.95 m along +X (East Coast USA
    // lays them 2 m apart): placed from each piece's start (centred, every
    // panel stood a metre on and no corner closed)
    segmentLength: 2,
    meshLength: 2,
    fromStart: true,
    zOffset: 0.05,
    yawOffset: 0,
  },
  chainLinkFence: {
    // hirochi fence_pedestrian: a clean chain-link mesh with NO embedded
    // textures (unlike west_coast screenfence1.dae, which hardcodes a missing
    // catchfence_d.dds). Its `chainlink` material resolves from BeamNG's global
    // library + /assets/, so nothing extra needs bundling.
    shapeName: '/levels/hirochi_raceway/art/shapes/objects/fence_pedestrian.dae',
    // Mesh runs along its local Y axis, like guardrail/jersey which use +90°
    // here and orient correctly, so match that. min Z ≈ -1.7. It runs 2.16 m
    // from a post at its origin along +Y (+90° turns +Y against the run):
    // placed at each piece's end (centred, every panel stood a metre on)
    // (its mesh, though, is only 1.99 m long and 1.02 m tall, z -0.48 to
    // 0.54: the posts run on down to -1.7, made to stand on a wall. Stretched
    // to 1.8 m, the mesh's foot just over the ground, posts buried; at 2.16
    // m and lifted 1.7 m every panel left a gap and floated a metre up)
    segmentLength: 2,
    meshLength: 1.99,
    fromEnd: true,
    scaleZ: 1.75,
    zOffset: 0.03 + 0.48 * 1.75,
    yawOffset: Math.PI * 0.5,
  },
  // walls (beamngPropLibrary BARRIER_SHAPES): along local X, centred
  // (meshLength: the visible piece, measured from the official shapes)
  stoneWall: { shapeName: BARRIER_SHAPES.stoneWall.shapeFile, segmentLength: 3, meshLength: 3.12, zOffset: 0, yawOffset: 0 },
  concreteWall: { shapeName: BARRIER_SHAPES.concreteWall.shapeFile, segmentLength: 3.1, meshLength: 3.04, zOffset: 0, yawOffset: 0 },
  dryStoneWall: { shapeName: BARRIER_SHAPES.dryStoneWall.shapeFile, segmentLength: 6, meshLength: 6.33, zOffset: 0, yawOffset: 0 },
  // a retaining wall holds the ground up: the concrete wall (1 m over its
  // origin, 2 m under) stretched from the low side's ground to just over the
  // high side's (highway retaining walls stood as 1 m stone garden walls at
  // the foot of their fill)
  retainingWall: { shapeName: BARRIER_SHAPES.concreteWall.shapeFile, segmentLength: 3.1, meshLength: 3.04, zOffset: 0, yawOffset: 0, retaining: { above: 1, below: 2 } },
  brickWall: { shapeName: BARRIER_SHAPES.brickWall.shapeFile, segmentLength: 3.5, meshLength: 3.42, zOffset: 0, yawOffset: 0 },
  // the harbour railing runs along local -Y from its origin at one end
  // (+90° turns -Y onto the run): placed from each piece's start
  railing: { shapeName: BARRIER_SHAPES.railing.shapeFile, segmentLength: 3, zOffset: 0, yawOffset: Math.PI * 0.5, fromStart: true },
  // the clipped hedge piece, 2.3 m of leaves laid every 2.1 m (overlapping:
  // no light between pieces), sunk a little into the ground; its height
  // set per hedge (scaleZ, from OSM's height)
  hedge: { shapeName: PROP_SHAPES.hedge.shapeFile, segmentLength: 2.1, meshLength: 2.1, zOffset: -0.08, yawOffset: 0, meshHeight: 1.64 },
};

const HEDGE_HEIGHT_M = 1.2;   // an untagged hedge: a clipped garden hedge
const HEDGE_SCALE_Z = [0.35, 3];

// Ground mapped as something other than pavement, and the houses whose front
// lawns are often left unmapped (beamngSidewalks.js: a town curb's unmapped
// ground paved behind it, these not).
const OPEN_LANDUSE = new Set(['grass', 'meadow', 'recreation_ground', 'village_green', 'cemetery', 'forest', 'orchard', 'farmland', 'allotments', 'greenfield', 'flowerbed', 'plant_nursery', 'religious']);
const OPEN_LEISURE = new Set(['park', 'garden', 'pitch', 'playground', 'golf_course', 'dog_park', 'nature_reserve', 'common', 'sports_centre', 'stadium', 'track', 'swimming_pool']);
const OPEN_NATURAL = new Set(['wood', 'scrub', 'grassland', 'heath', 'water', 'wetland', 'sand', 'beach', 'bare_rock']);
function isOpenGround(t) {
  return OPEN_LANDUSE.has(t.landuse) || OPEN_LEISURE.has(t.leisure) || OPEN_NATURAL.has(t.natural) || t.waterway === 'riverbank' || t.amenity === 'grave_yard' || t.landcover === 'grass' || t.landcover === 'trees';
}
const HOUSE_BUILDINGS = new Set(['house', 'detached', 'semidetached_house', 'bungalow', 'farm', 'cabin', 'residential']);
const HOUSE_RING_MAX_M2 = 220;   // (beamngBuildings: a plain building this small is a house)

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

// Only a ceiling against runaway data: the engine has no object limit
// (BeamNG's own levels place 22,256 TSStatics in West Coast USA, 18,679 in
// Italy), and a suburb's garden fences and walls need ~18,000 pieces over
// 2 km: at the old 8,000 more than half were left out.

// Walls and fences along a racetrack: most of their length within RACESIDE_M of a raceway.
const RACESIDE_M = 30;
function racesideWalls(osmFeatures, barriers) {
  const out = new Set();
  const segs = [];
  for (const f of osmFeatures) {
    if (f?.tags?.highway !== 'raceway' || !(f.geometry?.length >= 2)) continue;
    for (let i = 0; i + 1 < f.geometry.length; i++) segs.push([f.geometry[i], f.geometry[i + 1]]);
  }
  if (!segs.length) return out;
  // (metres per degree near the track)
  const lat0 = segs[0][0].lat; const kx = 111320 * Math.cos((lat0 * Math.PI) / 180); const ky = 110540;
  const near = (p) => segs.some(([a, b]) => {
    const ax = (a.lng - p.lng) * kx; const ay = (a.lat - p.lat) * ky; const bx = (b.lng - p.lng) * kx; const by = (b.lat - p.lat) * ky;
    const dx = bx - ax; const dy = by - ay; const t = Math.max(0, Math.min(1, -(ax * dx + ay * dy) / (dx * dx + dy * dy || 1)));
    return Math.hypot(ax + dx * t, ay + dy * t) < RACESIDE_M;
  });
  for (const f of barriers) {
    if (!['wall', 'retaining_wall', 'fence'].includes(f?.tags?.barrier) || !(f.geometry?.length >= 2)) continue;
    const pts = f.geometry;
    if (pts.filter(near).length >= pts.length * 0.6) out.add(f);
  }
  return out;
}

/**
 * Resolve OSM barrier tags to one of the native BeamNG barrier asset presets.
 */
function resolveNativeBarrierAsset(tags = {}, biome = null) {
  const barrierType = String(tags.barrier ?? '').trim().toLowerCase();
  const material = String(tags.material ?? '').trim().toLowerCase();
  const levelName = String(biome?.levelName ?? '').toLowerCase();

  if (!barrierType) return null;

  if (barrierType === 'hedge') {
    const height = Number.parseFloat(tags.height);
    const h = Number.isFinite(height) && height > 0 ? height : HEDGE_HEIGHT_M;
    const hedge = NATIVE_BARRIER_ASSETS.hedge;
    return { ...hedge, scaleZ: Math.max(HEDGE_SCALE_Z[0], Math.min(HEDGE_SCALE_Z[1], h / hedge.meshHeight)) };
  }

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
    // (beside a racetrack, unmapped material: a concrete circuit wall, not a garden's stone)
    if (tags['mapng:trackside'] === 'yes' && !material) return NATIVE_BARRIER_ASSETS.concreteWall;
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
    // (beside a racetrack: chain link, no garden's picket)
    if (tags['mapng:trackside'] === 'yes') return NATIVE_BARRIER_ASSETS.chainLinkFence;
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
const BARRIER_CORNER_RAD = (20 * Math.PI) / 180;   // a turn this sharp in a barrier's line: a panel joint on it
const BARRIER_HALF_THICK_M = 0.3;     // a wall's half thickness, for meeting at corners
const BARRIER_CORNER_EXT_MAX_M = 0.6;
const BARRIER_CURVE_SHARE = 0.25;   // on a curve, panels no longer than this share of its radius
const BARRIER_CURVE_MIN_M = 1.2;
const BARRIER_FIT_MIN = 0.85;   // a panel this much shorter than its mesh is scaled down to fit
const RETAINING_TOP_M = 0.3;    // a retaining wall stands this far over the ground it holds
const RETAINING_FOOT_M = 0.5;   // ... and reaches this far under the ground at its foot

const GATE_UNDRAWN_HALF_M = { service: 2.5, track: 1.8 };
const GATE_MAP_PAD_M = 20;
const GATE_WAY_PIECE_M = 16;
const GATE_WAY_MAX_PIECES = 4096;

/** What can pass through a gate: the drawn roads, and OSM's other ways on the ground (a service road may only be painted on the terrain, a footpath not drawn at all). */
function gateWaysOf(terrainData, carriageways, squareSize) {
  const ways = carriageways.filter((cw) => cw.highway !== 'raceway').map((cw) => ({ pts: cw.nodes, half: cw.half, highway: cw.highway }));
  const drawn = new Set(carriageways.map((cw) => cw.wayId));
  for (const f of terrainData.osmFeatures || []) {
    const h = f.type === 'road' ? f.tags?.highway : null;
    if (!h || h === 'raceway' || drawn.has(f.id) || f.tags.bridge || f.tags.tunnel || f.tags.area === 'yes' || !(f.geometry?.length >= 2)) continue;
    const half = FOOTPATH_WIDTH_M[h] ? FOOTPATH_WIDTH_M[h] / 2 : GATE_UNDRAWN_HALF_M[h] ?? 3;
    const pts = f.geometry.map((q) => geoToWorldPoint(q.lat, q.lng, terrainData, squareSize, 0).slice(0, 2));
    for (const run of runsOnMap(pts, (terrainData.width * squareSize) / 2 + GATE_MAP_PAD_M, (terrainData.height * squareSize) / 2 + GATE_MAP_PAD_M)) ways.push({ pts: run, half, highway: h });
  }
  return ways;
}

// a way's stretches on the map, in short pieces (OSM's ways run on past its
// edge: one long segment's bounding box filled a clearance grid until it overflowed)
function runsOnMap(pts, maxX, maxY) {
  const runs = []; let run = [];
  const add = (q) => {
    if (Math.abs(q[0]) <= maxX && Math.abs(q[1]) <= maxY) { run.push(q); return; }
    if (run.length >= 2) runs.push(run);
    run = [];
  };
  for (let i = 0; i + 1 < pts.length; i++) {
    const a = pts[i]; const b = pts[i + 1];
    const n = Math.min(GATE_WAY_MAX_PIECES, Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / GATE_WAY_PIECE_M)));
    for (let k = 0; k < n; k++) add([a[0] + ((b[0] - a[0]) * k) / n, a[1] + ((b[1] - a[1]) * k) / n]);
  }
  if (pts.length) add(pts[pts.length - 1]);
  if (run.length >= 2) runs.push(run);
  return runs;
}

// the steepest a gate's leaf leans to reach the ground at its free end
const GATE_MAX_PITCH = 0.3;

/** A gate's leaves (services/gates.js) as TSStatics standing on the terrain. */
function gateObjects(gates, ground, free, startIndex = 0) {
  const objects = [];
  gates.forEach((gate, i) => {
    for (const [k, leaf] of gateLeaves(gate, free, { prefer: gate.prefer ?? 1 }).entries()) {
      const g = ground(leaf.x, leaf.y); const tip = ground(leaf.tip[0], leaf.tip[1]);
      if (!Number.isFinite(g)) continue;
      const run = Math.hypot(leaf.tip[0] - leaf.x, leaf.tip[1] - leaf.y);
      // (leaves hinged at their origin rise to the tip; a sliding gate's mesh runs the other way)
      const rise = run > 0.1 && Number.isFinite(tip) ? Math.atan2(tip - g, run) : 0;
      const pitch = leaf.level ? 0 : Math.max(-GATE_MAX_PITCH, Math.min(GATE_MAX_PITCH, rise));
      objects.push({
        __parent: 'Barriers',
        class: 'TSStatic',
        name: `gate_${startIndex + i}_${k}`,
        persistentId: generatePersistentId(),
        position: [roundTo(leaf.x, 3), roundTo(leaf.y, 3), roundTo(g + leaf.z, 3)],
        rotationMatrix: rotationMatrixFromYawPitch(leaf.yaw, pitch),
        ...(leaf.scale !== 1 ? { scale: [roundTo(leaf.scale, 3), 1, 1] } : {}),
        shapeName: leaf.shapeName,
        useInstanceRenderData: true,
      });
    }
  });
  return objects;
}

function buildNativeBarrierObjects(terrainData, squareSize, biome = null, { skipAt = () => false, skipLineAt = () => false, gateWays = [], trackGates = [], gateFree = () => true, extra = [] } = {}) {
  // (extra: barriers the exporter adds, e.g. guardrails along a road on a
  // dam; one with __zAt(x, y) stands on that surface, not the terrain)
  const features = [...(terrainData.osmFeatures?.filter((feature) => (
    feature.type === 'barrier' && Array.isArray(feature.geometry) && feature.geometry.length >= 2
  )) ?? []), ...extra];

  const objects = [];
  // the retaining walls' tops, for what is built on them
  const wallTops = [];
  Object.defineProperty(objects, 'wallTops', { value: wallTops, enumerable: false });

  /**
   * Add one TSStatic barrier instance at a geographic point with yaw.
   */
  const pushInstanceAtGeo = (pt, yaw, asset, name, zOffsetOverride) => {
    if (objects.length >= caps.barriers) return;
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
    // (OSM's straight edges round a curve rounded off: a fountain's ring
    // wall came out a dozen-sided polygon; real corners stay square)
    const geometry = Array.isArray(feature?.geometry) ? smoothLine(feature.geometry, {
      get: (p) => geoToWorldPoint(p.lat, p.lng, terrainData, squareSize, 0),
      lerp: (p, q, t) => ({ ...p, lat: p.lat + (q.lat - p.lat) * t, lng: p.lng + (q.lng - p.lng) * t }),
    }) : [];
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

    // (by the mesh's own length where it is known: every piece then scaled
    // to its stretch lands on the next joint; official levels lay them at
    // their length, unscaled, corners by hand)
    const nominalSpacing = Math.max(0.75, Number(asset.meshLength) || Number(asset.segmentLength) || 2);
    // Panel joints: one on every corner (a fence round a garden met itself
    // in pieces: a panel spaced along the whole line straddled the corner at
    // one side's angle), the panels evenly spaced between corners; a curve of
    // short pieces is spaced along as one stretch.
    const corners = [0];
    const cornerTurn = new Map();   // a corner's distance -> how far the line turns there
    for (let k = 1; k < segmentLengths.length; k++) {
      const pa = geometry[segmentStarts[k - 1]]; const pb = geometry[segmentStarts[k - 1] + 1];
      const qa = geometry[segmentStarts[k]]; const qb = geometry[segmentStarts[k] + 1];
      const wa = geoToWorldPoint(pa.lat, pa.lng, terrainData, squareSize, 0); const wb = geoToWorldPoint(pb.lat, pb.lng, terrainData, squareSize, 0);
      const wc = geoToWorldPoint(qa.lat, qa.lng, terrainData, squareSize, 0); const wd = geoToWorldPoint(qb.lat, qb.lng, terrainData, squareSize, 0);
      let turn = Math.abs(Math.atan2(wd[1] - wc[1], wd[0] - wc[0]) - Math.atan2(wb[1] - wa[1], wb[0] - wa[0]));
      if (turn > Math.PI) turn = 2 * Math.PI - turn;
      if (turn > BARRIER_CORNER_RAD) { corners.push(cumulative[k]); cornerTurn.set(cumulative[k], turn); }
    }
    corners.push(totalLen);
    // how much a stretch turns along its length (a ring round a fountain:
    // its 3 m panels stood as coarse chords): shorter panels on a tight curve
    const segYaw = segmentStarts.map((i) => {
      const wa = geoToWorldPoint(geometry[i].lat, geometry[i].lng, terrainData, squareSize, 0);
      const wb = geoToWorldPoint(geometry[i + 1].lat, geometry[i + 1].lng, terrainData, squareSize, 0);
      return Math.atan2(wb[1] - wa[1], wb[0] - wa[0]);
    });
    const turnBetween = (d0, d1) => {
      let turn = 0;
      for (let k = 1; k < segYaw.length; k++) {
        if (cumulative[k] <= d0 + 1e-6 || cumulative[k] >= d1 - 1e-6) continue;
        let t = Math.abs(segYaw[k] - segYaw[k - 1]);
        if (t > Math.PI) t = 2 * Math.PI - t;
        turn += t;
      }
      return turn;
    };
    const joints = [];
    for (let c = 0; c + 1 < corners.length; c++) {
      const stretch = corners[c + 1] - corners[c];
      const turn = turnBetween(corners[c], corners[c + 1]);
      const radius = turn > 0.05 ? stretch / turn : Infinity;
      const spacing = Math.max(BARRIER_CURVE_MIN_M, Math.min(nominalSpacing, radius * BARRIER_CURVE_SHARE));
      const n = Math.max(1, Math.round(stretch / spacing));
      for (let k = 0; k < n; k++) joints.push(corners[c] + (stretch * k) / n);
    }
    joints.push(totalLen);
    const panelCount = joints.length - 1;

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
        terrainZ: feature.__zAt ? feature.__zAt(world[0], world[1]) : getTerrainHeightWorld(lat, lng, terrainData),
        yaw,
      };
    };

    // the ground at every joint, smoothed along the run (a median, then a
    // mean, of each and its neighbours): on graded ground stepping by the
    // metre the panels zig-zagged by ±20°
    const jointCount = isClosedRing(geometry) ? panelCount : panelCount + 1;
    const rawJointZ = joints.map((d) => sampleAtDistance(d).terrainZ);
    const at3 = (arr, i) => [arr[Math.max(0, i - 1)], arr[i], arr[Math.min(arr.length - 1, i + 1)]];
    const median3 = rawJointZ.map((_, i) => at3(rawJointZ, i).sort((a, b) => a - b)[1]);
    const jointZ = median3.map((_, i) => (i === 0 || i === median3.length - 1 ? median3[i] : at3(median3, i).reduce((a, b) => a + b, 0) / 3));
    // a retaining wall's top follows the ground it holds (the high side), its
    // foot the low side's: per joint, the top smoothed like the ground
    let retainTop = null; let retainLow = null;
    if (asset.retaining) {
      const sides = joints.map((d) => {
        const j = sampleAtDistance(d);
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
      if (objects.length >= caps.barriers) return;
      const panelSpacing = joints[i + 1] - joints[i];
      // each piece stretched or shrunk to reach the next joint (a mesh of
      // known length; others only shortened on a short stretch, not sticking
      // out past both corners). Its mesh runs along local X, or Y at +90°.
      // a wall's pieces carried on past a corner by half its thickness's
      // share of the turn: their outer faces meet (square ends left a notch
      // on the outside of every bend round a fountain's ring)
      const centred = asset.meshLength && !asset.fromStart && !asset.fromEnd;
      const ext = (dist) => (centred && cornerTurn.has(dist) ? Math.min(BARRIER_CORNER_EXT_MAX_M, (asset.halfThick ?? BARRIER_HALF_THICK_M) * Math.tan(cornerTurn.get(dist) / 2)) : 0);
      const e0 = ext(joints[i]); const e1 = ext(joints[i + 1]);
      // a centred piece lies on the chord between its joints, end to end with
      // the next (placed at the line's halfway point, turned to the segment
      // there, pieces over a curve stood in and out of line like teeth)
      const j0 = sampleAtDistance(joints[i]); const j1 = sampleAtDistance(joints[i + 1]);
      const chord = Math.hypot(j1.x - j0.x, j1.y - j0.y);
      const chordYaw = Math.atan2(j1.y - j0.y, j1.x - j0.x);
      const useChord = centred && chord > 0.2;
      const along = ((useChord ? chord : panelSpacing) + e0 + e1) / nominalSpacing;
      const fit = asset.meshLength ? Math.abs(along - 1) > 0.005 : along < BARRIER_FIT_MIN;
      const alongY = Math.abs(Math.abs(Number(asset.yawOffset) || 0) - Math.PI / 2) < 0.01;
      const mid = sampleAtDistance((joints[i] + joints[i + 1]) / 2);
      const centerSample = useChord ? { ...mid, x: (j0.x + j1.x) / 2, y: (j0.y + j1.y) / 2, yaw: chordYaw } : mid;
      // tilted along the run to the (smoothed) ground between its ends (a
      // retaining wall: to its top)
      const rise = retainTop ? retainTop[i + 1] - retainTop[i] : jointZ[i + 1] - jointZ[i];
      const pitch = Math.max(-BARRIER_MAX_PITCH, Math.min(BARRIER_MAX_PITCH, Math.atan2(rise, panelSpacing)));
      const panelTerrainZ = (jointZ[i] + jointZ[i + 1]) / 2;
      if (skipLineAt(centerSample.x, centerSample.y, panelTerrainZ, centerSample.yaw)) continue;
      // (a mesh with its origin at one end goes at the piece's start)
      const at = asset.fromStart ? { ...sampleAtDistance(joints[i]), z: jointZ[i] }
        : asset.fromEnd ? { ...sampleAtDistance(joints[i + 1]), z: jointZ[i + 1] }
          : { ...centerSample, z: panelTerrainZ, x: centerSample.x + Math.cos(centerSample.yaw) * (e1 - e0) / 2, y: centerSample.y + Math.sin(centerSample.yaw) * (e1 - e0) / 2 };
      // not on a drawn road or under a deck (OSM's line, or the road's width,
      // put walls and fences across lanes where they meet)
      if (skipAt(at.x, at.y, at.z)) continue;
      let scaleZ = asset.scaleZ ?? 1;
      if (retainTop) {
        // base under the low side's ground (the tilt lowers one end's foot
        // by half the rise), top on the line through the joints' tops
        const { above, below } = asset.retaining;
        const top = (retainTop[i] + retainTop[i + 1]) / 2;
        wallTops.push({ x: at.x, y: at.y, z: top });
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
        ...(scaleZ !== 1 || fit ? { scale: alongY ? [1, roundTo(fit ? along : 1, 3), roundTo(scaleZ, 3)] : [roundTo(fit ? along : 1, 3), 1, roundTo(scaleZ, 3)] } : {}),
        shapeName: asset.shapeName,
        useInstanceRenderData: true,
      });
    }

    if (asset.postShapeName) {
      for (let i = 0; i < jointCount; i++) {
        if (objects.length >= caps.barriers) return;
        const sample = { ...sampleAtDistance(joints[i]), terrainZ: jointZ[i] };
        // (as its rails: a post on a drawn road stood alone in the lane)
        if (skipLineAt(sample.x, sample.y, sample.terrainZ, sample.yaw) || skipAt(sample.x, sample.y, sample.terrainZ)) continue;
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

    if (objects.length < caps.barriers) {
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

    if (objects.length < caps.barriers) {
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

  const trackside = racesideWalls(terrainData.osmFeatures || [], features);
  const assets = features.map((f) => resolveNativeBarrierAsset(trackside.has(f) ? { ...f.tags, 'mapng:trackside': 'yes' } : (f.tags || {}), biome));
  // gates and the openings they stand in (services/gates.js)
  const toXY = (q) => { const w = geoToWorldPoint(q.lat, q.lng, terrainData, squareSize, 0); return [w[0], w[1]]; };
  const barrierLines = features.map((f, i) => ({ pts: f.geometry.map(toXY), tags: f.tags || {}, chainLink: assets[i] === NATIVE_BARRIER_ASSETS.chainLinkFence }));
  const gateNodes = (terrainData.osmFeatures || [])
    .filter((f) => f.type === 'street_furniture' && f.geometry?.length === 1 && isGateBarrier(f.tags))
    .map((f) => { const [x, y] = toXY(f.geometry[0]); return { x, y, tags: f.tags }; });
  const gatePlan = planGates({ barriers: barrierLines, ways: gateWays, nodes: gateNodes });
  const lerpGeo = (a, b, u) => ({ ...a, lat: a.lat + (b.lat - a.lat) * u, lng: a.lng + (b.lng - a.lng) * u });

  for (let featureIndex = 0; featureIndex < features.length; featureIndex++) {
    if (objects.length >= caps.barriers) break;
    const asset = assets[featureIndex];
    if (!asset || gatePlan.lines.has(featureIndex)) continue;
    const pieces = splitAtCuts(features[featureIndex].geometry, barrierLines[featureIndex].pts, gatePlan.cuts[featureIndex], lerpGeo);
    pieces.forEach((geometry, piece) => {
      const feature = pieces.length > 1 ? { ...features[featureIndex], geometry } : features[featureIndex];
      pushFeatureInstances(feature, asset, `barrier_${featureIndex}${piece ? `_${piece}` : ''}`);
      if (asset.endShapeName && objects.length < caps.barriers) pushGuardrailEndcaps(feature, asset, featureIndex);
    });
  }

  const ground = terrainGroundAt(terrainData, squareSize);
  const gates = [...gatePlan.gates, ...trackGates];
  objects.push(...gateObjects(gates, ground, gateFree));
  Object.defineProperty(objects, 'gateStats', {
    value: Object.entries(gates.reduce((c, g) => { c[g.style] = (c[g.style] || 0) + 1; return c; }, {})),
    enumerable: false,
  });
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
// (roads' segments in a grid, made once per roads array: only those within
// maxSearch are measured, in road order, so ties resolve as a full scan did;
// every sign and prop measured against every road in the map before)
const NEAREST_ROAD_CELL_M = 32;
const nearestRoadIndexes = new WeakMap();
function nearestRoadIndex(roads) {
  let index = nearestRoadIndexes.get(roads);
  if (index) return index;
  const cells = new Map();
  roads.forEach((road, r) => {
    const pts = road.pts || [];
    for (let i = 0; i + 1 < pts.length; i++) {
      const a = pts[i]; const b = pts[i + 1];
      for (let gx = Math.floor(Math.min(a[0], b[0]) / NEAREST_ROAD_CELL_M); gx <= Math.floor(Math.max(a[0], b[0]) / NEAREST_ROAD_CELL_M); gx++) {
        for (let gy = Math.floor(Math.min(a[1], b[1]) / NEAREST_ROAD_CELL_M); gy <= Math.floor(Math.max(a[1], b[1]) / NEAREST_ROAD_CELL_M); gy++) {
          const k = gx * 1048576 + gy;
          if (!cells.has(k)) cells.set(k, []);
          cells.get(k).push(r * 1048576 + i);
        }
      }
    }
  });
  index = { cells };
  nearestRoadIndexes.set(roads, index);
  return index;
}

function findNearestRoad(px, py, roads, maxSearch) {
  // (a road or two: measured directly; many, with a finite reach: by the grid)
  if (roads.length > 8 && Number.isFinite(maxSearch)) {
    const { cells } = nearestRoadIndex(roads);
    const found = new Set();
    for (let gx = Math.floor((px - maxSearch) / NEAREST_ROAD_CELL_M); gx <= Math.floor((px + maxSearch) / NEAREST_ROAD_CELL_M); gx++) {
      for (let gy = Math.floor((py - maxSearch) / NEAREST_ROAD_CELL_M); gy <= Math.floor((py + maxSearch) / NEAREST_ROAD_CELL_M); gy++) {
        for (const id of cells.get(gx * 1048576 + gy) || []) found.add(id);
      }
    }
    let best = null;
    for (const id of [...found].sort((a, b) => a - b)) {
      const road = roads[Math.floor(id / 1048576)]; const i = id % 1048576; const pts = road.pts;
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
    if (!best || best.dist > maxSearch) return null;
    return best;
  }
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
        ...lampLink(`signal_mast_${i}_light`),
      });
      objects.push(lampSpotLight(`signal_mast_${i}_light`, 'traffic_signals', [
        roundTo(prop.position[0] + Math.cos(prop.yaw) * SIGNAL_MAST.lightForward, 3),
        roundTo(prop.position[1] + Math.sin(prop.yaw) * SIGNAL_MAST.lightForward, 3),
        roundTo(prop.position[2] + SIGNAL_MAST.lightHeight - 0.2, 3),
      ], SIGNAL_MAST.lightHeight));
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
const LAMP_MIN_SPACING_M = 2;
const ARTERIAL_LIGHTING = new Set(['motorway', 'trunk', 'primary', 'secondary', 'tertiary']);
// a mapped lamp this far beyond the nearest carriageway's edge lights a path or square
const PATH_LAMP_MIN_M = 8;

// Vanilla wcusa street lamp light (lightemitters_vintage sodium pairing,
// 400+ instances) — with castShadows forced off per QA guidance. isEnabled
// false + nightLight "1" makes the engine run them dusk-to-dawn, no lua.
// Car park ceiling lights: on day and night (it is dark under a deck),
// neutral white, short reach, no shadows.
const GARAGE_LIGHT_TEMPLATE = {
  class: 'PointLight',
  attenuationRatio: [0, 0, 0],
  brightness: 0.0795774609,
  castShadows: false,
  color: [1, 0.92, 0.82, 1],
  intensity: 7000,
  isEnabled: true,
  radius: 13,
  useColorTemperature: 'true',
};

// Street lights as West Coast USA's own: a SpotLight aimed straight down
// from the luminaire (a pool on the road, not a glow on every facade), and
// the lamp TSStatic naming it as its `child` with instanceColor black, so
// the environment's night lights switch the light on at dusk and light the
// lamp head's emissive in the light's colour (core/environment.lua
// addLinkedNightLights). No shadows (QA guidance: hundreds of instances).
const LAMP_SPOT_DOWN = [1, 0, 0, 0, 0, -1, 0, 1, 0];   // local Y (the beam) down
const LAMP_COLOUR = [0.95, 0.9, 0.82, 1];               // neutral LED white
const LAMP_CD_AT_12M = 3500;   // (the engine's 5000 cd washed out lamp-lined arterials)
const WALL_LAMP_HEIGHT_M = 5;     // a lantern on a facade
const HUNG_LAMP_HEIGHT_M = 6.5;   // hung on a wire over the carriageway
export function lampSpotLight(name, parent, position, lightHeight = 8) {
  return {
    __parent: parent,
    class: 'SpotLight',
    name,
    persistentId: generatePersistentId(),
    position,
    rotationMatrix: LAMP_SPOT_DOWN,
    castShadows: false,
    color: LAMP_COLOUR,
    innerAngle: 25,
    outerAngle: 150,
    intensityUnit: 'cd',
    // LAMP_CD_AT_12M at a 12.5 m cobra head; lower lamps get less (ground
    // light falls with the mounting height squared), or a 7 m pole lamp
    // glares three times as bright on the road
    intensity: Math.round(Math.max(1200, LAMP_CD_AT_12M * (lightHeight / 12.5) ** 2)),
    isEnabled: false,
    nightLight: '1',
    range: roundTo(Math.max(20, lightHeight * 3.6), 2),
    useColorTemperature: 'false',
  };
}
// Floodlight poles and grandstand downlights (services/sportsLights.js): the
// game's stadium pole, its height by scale, turned to face the venue, with one
// dusk-to-dawn light aimed into it (cool LED white; no shadows, as street lamps)
const FLOOD_HEAD_YAW = Math.PI / 2;   // (the mesh's bar of heads runs along local X: side-on to the venue)
const FLOOD_COLOUR = [0.93, 0.96, 1, 1];
const STAND_LIGHT_CD = 18000;
export function sportsLightObjects(plan, groundAt) {
  const objects = []; const counts = {}; const glows = [];
  (plan?.poles || []).forEach((p, i) => {
    const g = groundAt(p.x, p.y);
    if (!Number.isFinite(g)) return;
    const name = `sports_pole_${i + 1}`; const head = g + p.h - 0.4;
    const aimZ = groundAt(p.aim[0], p.aim[1]);
    const to = [p.aim[0] - p.x, p.aim[1] - p.y, (Number.isFinite(aimZ) ? aimZ : g) - head];
    const dist = Math.hypot(...to);
    objects.push({
      __parent: 'street_furniture', class: 'TSStatic', name, persistentId: generatePersistentId(),
      shapeName: POLE_SHAPE, position: [roundTo(p.x, 3), roundTo(p.y, 3), roundTo(g + 1.2 * (p.h / POLE_SHAPE_HEIGHT_M), 3)],
      rotationMatrix: rotationMatrixFromYaw(Math.atan2(to[1], to[0]) + FLOOD_HEAD_YAW),
      scale: Array(3).fill(roundTo(p.h / POLE_SHAPE_HEIGHT_M, 3)), useInstanceRenderData: true, ...lampLink(`${name}_light`),
    });
    objects.push({
      __parent: 'street_furniture', class: 'SpotLight', name: `${name}_light`, persistentId: generatePersistentId(),
      position: [roundTo(p.x, 3), roundTo(p.y, 3), roundTo(head, 3)], rotationMatrix: beamRotation(to),
      castShadows: false, color: FLOOD_COLOUR, innerAngle: Math.round((p.beam || 120) * 0.45), outerAngle: p.beam || 120, intensityUnit: 'cd', intensity: p.cd,
      isEnabled: false, nightLight: '1', range: roundTo(Math.max(p.h * 4, dist * 3), 2), useColorTemperature: 'false',
    });
    glows.push({ x: p.x, y: p.y, z: g + p.h * (29.9 / POLE_SHAPE_HEIGHT_M), scale: Math.max(0.5, p.h / POLE_SHAPE_HEIGHT_M), yaw: Math.atan2(to[1], to[0]) + FLOOD_HEAD_YAW, i: i + 1 });
    counts[p.kind] = (counts[p.kind] || 0) + 1;
  });
  (plan?.stands || []).forEach((l, i) => {
    objects.push({ ...lampSpotLight(`stand_light_${i + 1}`, 'street_furniture', [roundTo(l.x, 3), roundTo(l.y, 3), roundTo(l.z, 3)], 6), color: FLOOD_COLOUR, intensity: STAND_LIGHT_CD });
  });
  if (plan?.stands?.length) counts.grandstand = plan.stands.length;
  return { objects, counts, glows };
}
// (a lamp TSStatic linked to its light)
const lampLink = (lightName) => ({ child: lightName, instanceColor: [0, 0, 0, 1] });


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
        // (its tags along: a line's material / height picks its poles)
        out.powerLines.push(Object.assign(f.geometry.map(toWorld), { tags, id: f.id }));
      }
      continue;
    }
    if (f.type !== 'street_furniture' || f.geometry?.length !== 1) continue;
    const p = toWorld(f.geometry[0]);
    if (tags.emergency === 'fire_hydrant') out.hydrants.push(p);
    else if (tags.amenity === 'waste_basket') out.bins.push(p);
    else if (tags.amenity === 'bench') out.benches.push(p);
    else if (tags.power === 'pole') out.poles.push(Object.assign(p, { tags, id: f.id }));
  }
  return out;
}

// a bridge's lamp on its parapet: the parapet's middle past the road's edge (beamngBridges.js
// PARAPET_W_M 0.45), on its top (PARAPET_H_M 0.9)
const DECK_LAMP_PARAPET_OFF_M = 0.22;
const DECK_LAMP_PARAPET_H_M = 0.9;
/**
 * The deck roads, each urban where a ground road at either of its ends is (a bridge over water has no
 * buildings beside it: a town's main road lit up to the river was dark across its bridge). Its own lit=*
 * still decides first (streetLamps.js isLitRoad).
 */
function deckRoadsForLamps(carriageways, ground) {
  const decks = carriageways.filter((cw) => cw.bridge && !cw.tunnel && cw.nodes?.length >= 2);
  // urban road points, gridded (a deck's end within DECK_LAMP_JOIN_M of one: it lands in town)
  const CELL = 80; const grid = new Map();
  const put = (p) => { const k = `${Math.floor(p[0] / CELL)},${Math.floor(p[1] / CELL)}`; if (!grid.has(k)) grid.set(k, []); grid.get(k).push(p); };
  for (const cw of ground) if (cw.urban) for (const p of cw.nodes || []) put(p);
  const near = (p) => {
    const cx = Math.floor(p[0] / CELL); const cy = Math.floor(p[1] / CELL);
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (const q of grid.get(`${cx + dx},${cy + dy}`) || []) if (Math.hypot(q[0] - p[0], q[1] - p[1]) < DECK_LAMP_JOIN_M) return true;
    return false;
  };
  // (deck road to deck road: carried along a bridge of several parts)
  const urban = new Set(decks.filter((cw) => cw.urban));
  for (const cw of urban) for (const p of cw.nodes) put(p);
  let changed = true;
  for (let round = 0; changed && round < 20; round++) {
    changed = false;
    for (const cw of decks) {
      if (urban.has(cw)) continue;
      if (near(cw.nodes[0]) || near(cw.nodes[cw.nodes.length - 1])) { urban.add(cw); changed = true; for (const p of cw.nodes) put(p); }
    }
  }
  return decks.map((cw) => (urban.has(cw) && !cw.urban ? { ...cw, urban: true } : cw));
}
const DECK_LAMP_JOIN_M = 80;   // (a bridge landing in a town: an urban road this near either end; the waterfront roads at its feet often have no buildings beside them)

/** The nearest deck road's centreline point to (x, y): { x, y, z, half } or null. */
function nearestDeckRoad(carriageways, x, y) {
  let best = null;
  for (const cw of carriageways) {
    const n = cw.nodes || [];
    for (let i = 0; i + 1 < n.length; i++) {
      const vx = n[i + 1][0] - n[i][0]; const vy = n[i + 1][1] - n[i][1]; const L2 = vx * vx + vy * vy || 1e-9;
      const t = Math.max(0, Math.min(1, ((x - n[i][0]) * vx + (y - n[i][1]) * vy) / L2));
      const px = n[i][0] + vx * t; const py = n[i][1] + vy * t; const d = Math.hypot(px - x, py - y);
      if (!best || d < best.d) best = { d, x: px, y: py, z: n[i][2] + (n[i + 1][2] - n[i][2]) * t, half: cw.half };
    }
  }
  return best;
}

function buildStreetFurnitureObjects(terrainData, squareSize, biome, { carriageways = [], deckCarriageways = [], deckParts = [], props = null, underDeck = () => false, deckAt = () => null, seaZ = -Infinity, roadLamps = true } = {}) {
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
  const LAMP_LIMIT = caps.streetLamps;
  const osmLampSpots = [];
  // Pole + dusk-to-dawn PointLight at the luminaire, arm toward `facing`.
  const addLamp = (posX, posY, facing, name, asset = profile.lamp, onZ = null) => {
    if (!asset?.shapeFile || lampCount >= LAMP_LIMIT) return;
    // (a lamp on a bridge's parapet stands at its height: onZ)
    const z = onZ ?? getTerrainHeightAtWorldXY(posX, posY, terrainData, squareSize);
    if (onZ == null && underDeck(posX, posY, z, z + (asset.lightHeight ?? 6) + 1)) return;
    objects.push({
      __parent: 'street_furniture',
      class: 'TSStatic',
      name,
      persistentId: generatePersistentId(),
      position: [roundTo(posX, 3), roundTo(posY, 3), roundTo(z, 3)],
      rotationMatrix: rotationMatrixFromYaw(facing + (asset.yawOffset ?? 0)),
      shapeName: asset.shapeFile,
      useInstanceRenderData: true,
      ...lampLink(`${name}_light`),
    });
    const forward = asset.lightForward ?? 0;
    objects.push(lampSpotLight(`${name}_light`, 'street_furniture', [
      roundTo(posX + Math.cos(facing) * forward, 3),
      roundTo(posY + Math.sin(facing) * forward, 3),
      roundTo(z + (asset.lightHeight ?? 6) - 0.2, 3),
    ], asset.lightHeight ?? 6));
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
    if (isLamp && lampCount >= LAMP_LIMIT) continue;
    // A lantern on a wall or hung on a wire over the street (old European
    // towns are lit almost only so: Bologna maps 743 wall and 676 wire lamps
    // to 71 on masts): no pole to place, but its light, where it hangs.
    if (isLamp && ['wall', 'wall_mounted', 'ceiling', 'wire', 'suspended'].includes(String(tags.support ?? tags.lamp_mount))) {
      if (String(tags.support) === 'ceiling') continue;   // (under arcades, galleries: not the street)
      const pt = features[i].geometry[0];
      if (!Number.isFinite(pt?.lat) || !Number.isFinite(pt?.lng)) continue;
      const [lx, ly] = geoToWorldPoint(pt.lat, pt.lng, terrainData, squareSize, 0);
      const key = cellKey(lx, ly);
      if (lampCells.has(key)) continue;
      lampCells.add(key);
      const z = getTerrainHeightAtWorldXY(lx, ly, terrainData, squareSize);
      const tagged = Number.parseFloat(tags.height);
      const h = Number.isFinite(tagged) && tagged > 2 && tagged < 15 ? tagged
        : String(tags.support) === 'wire' ? HUNG_LAMP_HEIGHT_M : WALL_LAMP_HEIGHT_M;
      if (underDeck(lx, ly, z, z + h + 1)) continue;
      objects.push(lampSpotLight(`street_lamp_${lampCount}_light`, 'street_furniture', [roundTo(lx, 3), roundTo(ly, 3), roundTo(z + h, 3)], h));
      lampCount++;
      continue;
    }
    if (isBench && benchCount >= caps.benches) continue;

    const pt = features[i].geometry[0];
    if (!Number.isFinite(pt?.lat) || !Number.isFinite(pt?.lng)) continue;
    const world = geoToWorldPoint(pt.lat, pt.lng, terrainData, squareSize, 0);
    const posX = world[0];
    const posY = world[1];
    // on a pier or footbridge it stands on the deck; in the water with no deck, nowhere
    const deckZ = deckAt(posX, posY);
    if (deckZ === null && getTerrainHeightAtWorldXY(posX, posY, terrainData, squareSize) < seaZ) continue;
    // (a marina's seating isn't worth placing by guess: none on a deck)
    if (deckZ !== null && isBench) continue;

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
    const z = deckZ ?? getTerrainHeightAtWorldXY(posX, posY, terrainData, squareSize);
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
  // town residential streets lit too, except in North America where the
  // utility poles carry their lamps (streetProps.js townPoles)
  const midLat = (terrainData.bounds.north + terrainData.bounds.south) / 2;
  const midLng = (terrainData.bounds.east + terrainData.bounds.west) / 2;
  const northAmerica = midLat > 24 && midLng > -170 && midLng < -50;
  // (street lamps switched off in What to build: none placed along the roads either)
  const generatedLamps = roadLamps ? generateRoadLamps(carriageways, osmLampSpots, LAMP_LIMIT - lampCount, { litStreets: !northAmerica }) : [];
  for (let i = 0; i < generatedLamps.length; i++) {
    const lamp = generatedLamps[i];
    addLamp(lamp.x, lamp.y, lamp.facing, `street_lamp_gen_${i}`, lampFor(lamp.highway));
  }
  // ... and along lit bridges (the same rule: lit=yes, or an urban main road), on the parapet's top at
  // the deck's height, the arm over the road (the ground pass keeps off decks: no lamp on the river bed)
  const deckLamps = roadLamps && deckCarriageways.length ? generateRoadLamps(deckCarriageways, osmLampSpots, LAMP_LIMIT - lampCount, { litStreets: !northAmerica }) : [];
  for (let i = 0; i < deckLamps.length; i++) {
    const lamp = deckLamps[i];
    // (the solved deck's own centreline, height and width: the carriageways' nodes are not at its height)
    const at = nearestDeckRoad(deckParts.map((q) => ({ nodes: q.xy.map((v, k) => [v[0], v[1], q.z[k]]), half: q.half })), lamp.x, lamp.y);
    if (!at) continue;
    const d = Math.hypot(lamp.x - at.x, lamp.y - at.y) || 1;
    const off = at.half + DECK_LAMP_PARAPET_OFF_M;
    addLamp(at.x + ((lamp.x - at.x) / d) * off, at.y + ((lamp.y - at.y) / d) * off, lamp.facing, `bridge_lamp_${i}`, lampFor(lamp.highway), at.z + DECK_LAMP_PARAPET_H_M);
  }

  // Benches along major town streets (streetProps.js), facing the road.
  for (let i = 0; i < (props?.benches.length ?? 0) && benchCount < caps.benches; i++) {
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
    const type = POLE_TYPES[p.type] || POLE_TYPES.wood_wide;
    objects.push({
      __parent: 'street_furniture',
      class: 'TSStatic',
      name: `utility_pole_${i}`,
      persistentId: generatePersistentId(),
      position: [roundTo(p.x, 3), roundTo(p.y, 3), roundTo(p.z, 3)],
      rotationMatrix: rotationMatrixFromYaw(p.yaw + (type.yawOffset || 0)),
      shapeName: PROP_SHAPES[type.shape].shapeFile,
      // (cars stop at a pole: its collision mesh, said outright)
      collisionType: 'Collision Mesh',
      useInstanceRenderData: true,
    });
    if (!p.lamp || type.lampZ == null || lampCount >= LAMP_LIMIT) continue;
    const lampZ = type.lampZ;
    objects.push({
      __parent: 'street_furniture',
      class: 'TSStatic',
      name: `pole_lamp_${i}`,
      persistentId: generatePersistentId(),
      position: [roundTo(p.x, 3), roundTo(p.y, 3), roundTo(p.z + lampZ, 3)],
      rotationMatrix: rotationMatrixFromYaw(p.yaw),
      shapeName: PROP_SHAPES.poleLamp.shapeFile,
      useInstanceRenderData: true,
      ...lampLink(`pole_lamp_${i}_light`),
    });
    objects.push(lampSpotLight(`pole_lamp_${i}_light`, 'street_furniture', [
      roundTo(p.x - Math.cos(p.yaw) * POLE_LAMP_REACH_M, 3),
      roundTo(p.y - Math.sin(p.yaw) * POLE_LAMP_REACH_M, 3),
      roundTo(p.z + lampZ - 0.3, 3),
    ], lampZ));
    lampCount++;
    poleLamps++;
  }

  if (lampCount + benchCount + (props?.poles.length ?? 0) > 0) {
    console.log(`[BeamNG Export] Street furniture: ${lampCount} lamps (+lights; ${generatedLamps.length} along lit streets, ${poleLamps} on utility poles), ${benchCount} benches, ${props?.poles.length ?? 0} utility poles`);
  }
  return objects;
}

// Cap to keep pathological inputs from exploding the scene file.
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
// (a station mapped twice, as a point and as areas, the same brand within
// FUEL_SAME_STATION_M: the areas only, a stray island beside the road else)
const FUEL_SAME_STATION_M = 120;
const fuelStationFeatures = (features) => {
  const all = features.filter((f) => (
    f.type === 'fuel_station'
    && Array.isArray(f.geometry)
    && f.geometry.length === 1
    && Number.isFinite(f.geometry[0]?.lat)
    && Number.isFinite(f.geometry[0]?.lng)
  ));
  const brand = (f) => String(f.tags?.brand || f.tags?.name || '').trim().toLowerCase();
  const mapped = all.filter((f) => f.canopy || f.area);
  const m = (a, b) => Math.hypot((a.lat - b.lat) * 111000, (a.lng - b.lng) * 111000 * Math.cos((a.lat * Math.PI) / 180));
  return all.filter((f) => f.canopy || f.area || !brand(f)
    || !mapped.some((o) => brand(o) === brand(f) && m(o.geometry[0], f.geometry[0]) <= FUEL_SAME_STATION_M));
};

// Each station's canopy (services/fuelStations.js), worked out once per
// export: the building pass leaves the canopies out, the station pass puts
// its pump islands under them.
const fuelLayoutCache = new WeakMap();
function fuelLayout(terrainData, squareSize) {
  const hit = fuelLayoutCache.get(terrainData);
  if (hit) return hit;
  const features = terrainData.osmFeatures ?? [];
  const toW = (q) => { const p = geoToWorldPoint(q.lat, q.lng, terrainData, squareSize, 0); return [p[0], p[1]]; };
  const ring = (g) => (Array.isArray(g) && g.length >= 3 ? g.filter((q) => Number.isFinite(q?.lat)).map(toW) : null);
  const stations = fuelStationFeatures(features).slice(0, caps.fuelStations)
    .map((f) => ({ tags: f.tags || {}, pt: toW(f.geometry[0]), canopy: ring(f.canopy), area: ring(f.area) }));
  const buildings = features.filter((f) => f.type === 'building' && f.geometry?.length >= 3 && ['roof', 'canopy'].includes(f.tags?.building))
    .map((f) => ({ id: f.id, tags: f.tags, ring: ring(f.geometry) }));
  // (any building, for a station's grounds round its shop not to be taken as its canopy)
  const allRings = stations.some((st) => st.area) ? features.filter((f) => f.type === 'building' && f.geometry?.length >= 3 && !['roof', 'canopy'].includes(f.tags?.building)).map((f) => ring(f.geometry)) : [];
  const buildingAt = (x, y) => allRings.some((r) => inFuelRing(r, x, y));
  const out = stations.length ? stationCanopies(stations, buildings, { buildingAt }) : { canopies: [], used: new Set() };
  fuelLayoutCache.set(terrainData, out);
  return out;
}

function buildFuelStations(terrainData, squareSize) {
  const features = terrainData.osmFeatures ?? [];
  const stations = fuelStationFeatures(features);
  if (stations.length === 0) return { objects: [], facilities: [] };
  const { canopies } = fuelLayout(terrainData, squareSize);
  // (buildings, for a road-side island to stand clear of)
  const buildingRings = features.filter((f) => f.type === 'building' && f.geometry?.length >= 3)
    .map((f) => f.geometry.map((q) => { const p = geoToWorldPoint(q.lat, q.lng, terrainData, squareSize, 0); return [p[0], p[1]]; }));

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
    if (pts.length >= 2) roads.push({ pts, halfWidth, service: highway === 'service' });
  }

  const objects = [];
  const facilities = [];

  const limit = Math.min(stations.length, caps.fuelStations);
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

    // a fuel station's islands: under its canopy, at its mapped pumps, else
    // beside the road clear of buildings; their bays where cars refuel
    let islands = null;
    let bays = null;
    if (!isElectric) {
      // (the drive lanes mapped under it: drivable ways, not the street)
      if (canopies[si]) islands = islandsUnder(canopies[si], roads.filter((r) => r.service).map((r) => r.pts));
      else if (pumpsByStation[si].length) {
        const cx = pumpPositions.reduce((s2, p) => s2 + p[0], 0) / pumpPositions.length;
        const cy = pumpPositions.reduce((s2, p) => s2 + p[1], 0) / pumpPositions.length;
        islands = [{ c: [cx, cy], yaw: bayYaw }];
      } else if (near) {
        const nx = anchor[0] - near.cx; const ny = anchor[1] - near.cy; const nl = Math.hypot(nx, ny) || 1;
        // (only the roads and buildings within reach of where it may go)
        const R = 80;
        const nearRoads = roads.filter((r) => r.pts.some((q) => Math.hypot(q[0] - anchor[0], q[1] - anchor[1]) < R + 200));
        const nearRings = buildingRings.filter((r) => r.some((q) => Math.hypot(q[0] - anchor[0], q[1] - anchor[1]) < R));
        const blocked = (x, y) => nearRings.some((r) => inFuelRing(r, x, y)) || nearRoads.some((r) => !!findNearestRoad(x, y, [r], r.halfWidth + 0.5));
        islands = [islandBesideRoad(near, [nx / nl, ny / nl], blocked)];
      } else islands = [{ c: [anchor[0], anchor[1]], yaw: 0 }];
      if (!pumpsByStation[si].length) bays = islands.flatMap(islandBays);
    }

    const pumpRefs = [];
    const bayList = bays || pumpPositions.map(([px, py]) => ({ c: [px, py], yaw: bayYaw, scale: [5, 7, 4] }));
    for (let pi = 0; pi < bayList.length; pi++) {
      const [px, py] = bayList[pi].c;
      const ground = getTerrainHeightAtWorldXY(px, py, terrainData, squareSize);
      const areaName = `${stationId}_pump_area_${pi + 1}`;
      const iconName = `${stationId}_pump_icon_${pi + 1}`;

      objects.push({
        __parent: 'gasStations',
        class: 'BeamNGGameplayArea',
        name: areaName,
        persistentId: generatePersistentId(),
        position: [roundTo(px, 3), roundTo(py, 3), roundTo(ground + 1.5, 3)],
        rotationMatrix: rotationMatrixFromYaw(bayList[pi].yaw),
        scale: bayList[pi].scale.map((v) => roundTo(v, 3)),
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
      // (the island's middle on its spot: its origin sits 7 m off to one side)
      islands.forEach((isl, k) => {
        const [ox, oy] = islandOrigin(isl);
        const g = getTerrainHeightAtWorldXY(isl.c[0], isl.c[1], terrainData, squareSize);
        const scaled = (isl.sx ?? 1) !== 1 || (isl.sy ?? 1) !== 1;
        objects.push({
          __parent: 'gasStations',
          class: 'TSStatic',
          name: `${stationId}_pumps${k ? `_${k + 1}` : ''}`,
          persistentId: generatePersistentId(),
          position: [roundTo(ox, 3), roundTo(oy, 3), roundTo(g, 3)],
          rotationMatrix: rotationMatrixFromYaw(isl.yaw),
          ...(scaled ? { scale: [roundTo(isl.sx ?? 1, 3), roundTo(isl.sy ?? 1, 3), 1] } : {}),
          shapeName: FUEL_PUMP_SHAPE,
          useInstanceRenderData: true,
        });
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
  // (cut to 48: the start kept and a hash of the whole, so long names that
  // differ only at their end stay apart; a plain cut made duplicate object
  // names, which BeamNG resolves by dropping one)
  if (cleaned.length > 48) {
    let h = 2166136261;
    for (let i = 0; i < cleaned.length; i++) { h ^= cleaned.charCodeAt(i); h = Math.imul(h, 16777619); }
    cleaned = `${cleaned.slice(0, 40).replace(/_+$/g, '')}_${(h >>> 0).toString(36).slice(0, 7)}`;
  }
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
/**
 * The swimming pools' and fountains' water: WaterBlocks in each one's frame,
 * reaching under its coping or rim (services/pools.js, fountains.js), all
 * with the pools' look (clear, pale blue, slow ripples).
 */
function buildPoolWaterObjects(terrainData, squareSize, biome, stats = {}) {
  const waterProfile = getWaterProfile(biome);
  const features = terrainData.osmFeatures || [];
  const project = (lat, lng) => geoToWorldPoint(lat, lng, terrainData, squareSize, 0);
  const pools = planPools(features, project, { squareSize, groundAt: terrainGroundAt(terrainData, squareSize) });
  const fountains = planFountains(features, project);
  const streets = fountains.some((f) => f.kind === 'wall') ? streetIndex(features, project) : null;
  const { rippleSpeeds, ...look } = POOL_WATER_BLOCK;
  const out = [];
  const add = (b, name) => {
    const block = {
      ...structuredClone(WATER_BLOCK_TEMPLATE),
      cubemap: waterProfile.waterCubemap,
      foamTex: waterProfile.waterFoamTex,
      rippleTex: waterProfile.waterRippleTex,
      ...structuredClone(look),
      gridSize: Math.max(1, Math.floor(Math.min(100, b.sx, b.sy))),
      gridElementSize: roundTo(clamp(Math.min(b.sx, b.sy) / 32, 0.05, 4), 2),
      name,
      persistentId: generatePersistentId(),
      __parent: 'Water',
      position: [roundTo(b.cx, 3), roundTo(b.cy, 3), roundTo(b.z, 3)],
      // (the block's x along its rectangle)
      rotationMatrix: [roundTo(b.u[0], 6), roundTo(b.u[1], 6), 0, roundTo(-b.u[1], 6), roundTo(b.u[0], 6), 0, 0, 0, 1],
      scale: [roundTo(b.sx, 3), roundTo(b.sy, 3), roundTo(b.depth * 2, 2)],
    };
    block['Ripples (texture animation)'] = block['Ripples (texture animation)'].map((r, j) => ({ ...r, rippleSpeed: rippleSpeeds[j] ?? r.rippleSpeed }));
    out.push(block);
  };
  pools.forEach((p, k) => poolWaterBlocks(p).forEach((b, i) => add(b, `pool_${k}_${i}`)));
  const poolBlocks = out.length;
  fountains.forEach((f, k) => fountainWaterBlocks(f, streets).forEach((b, i) => add(b, `fountain_${k}_${i}`)));
  Object.assign(stats, { pools: pools.length, poolBlocks, fountains: fountains.length, fountainBlocks: out.length - poolBlocks });
  return out;
}

function buildWaterBlockObjects(terrainData, squareSize, biome, stats = {}, dryZones = [], plan = null) {
  const waterProfile = getWaterProfile(biome);
  const { tiles, stats: lakeStats } = plan || planLakes({
    features: terrainData.osmFeatures || [],
    toWorld: (lat, lng) => geoToWorldPoint(lat, lng, terrainData, squareSize, 0),
    heightAt: (x, y) => getTerrainHeightAtWorldXY(x, y, terrainData, squareSize),
  });
  Object.assign(stats, lakeStats);
  // over a tunnel: no deeper than its roof, none over its trench
  stats.clippedOverTunnels = 0;
  // (deep enough to reach the lake's bed under it: carveLakeBeds digs real
  // depths now, and a block shallower than its bed left dry water under it)
  const bedDepth = (tile) => {
    let low = Infinity;
    for (let i = 0; i <= 6; i++) for (let j = 0; j <= 6; j++) {
      const g = getTerrainHeightAtWorldXY(tile.cx + (i / 6 - 0.5) * tile.sx, tile.cy + (j / 6 - 0.5) * tile.sy, terrainData, squareSize);
      if (Number.isFinite(g)) low = Math.min(low, g);
    }
    return Number.isFinite(low) ? Math.max(LAKE_BLOCK_DEPTH_M, Math.ceil(tile.z - low + 1)) : LAKE_BLOCK_DEPTH_M;
  };
  // (a long strip cut where a tunnel's trench or tube crosses it, not left out whole)
  const pieces = dryZones?.length ? tiles.flatMap((tile) => splitLakeTile(tile, dryZones)) : tiles;
  stats.splitForTunnels = pieces.length - tiles.length;
  return pieces.map((tile) => { const want = bedDepth(tile); return { tile, want, depth: clipLakeTile(tile, want, dryZones) }; })
    .filter(({ depth }) => depth > 0)
    .map(({ tile, depth, want }, index) => {
      if (depth < want) stats.clippedOverTunnels++;
      stats.deepestBlock = Math.max(stats.deepestBlock || 0, depth);
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
function buildSeaBlockObjects(terrainData, squareSize, biome, seaLevelOffset, dryZones, tunnels, sourceHeightMap = terrainData.heightMap, seaAtUV = null) {
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
    // (world x east, y north from the centre -> the map's fractions)
    seaAt: seaAtUV ? (x, y) => { const size = terrainData.width * squareSize; return seaAtUV(x / size + 0.5, 0.5 - y / size); } : null,
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
 * Carriageways split into their stretches on and off the given deck parts
 * (a part's road: graph edge -> segment, the carriageway's owner), the
 * stretches on one flagged bridge. A node is on a part within its half width
 * of the part's line.
 */
export function splitOnDecks(carriageways, parts, edges) {
  const byOwner = new Map();
  for (const p of parts) {
    const seg = edges?.[p.edge]?.seg;
    if (seg === undefined) continue;
    if (!byOwner.has(seg)) byOwner.set(seg, []);
    byOwner.get(seg).push(p);
  }
  const onPart = (q, p) => {
    for (let i = 0; i + 1 < p.xy.length; i++) {
      const [ax, ay] = p.xy[i]; const [bx, by] = p.xy[i + 1];
      const vx = bx - ax; const vy = by - ay; const L2 = vx * vx + vy * vy || 1e-9;
      const t = Math.max(0, Math.min(1, ((q[0] - ax) * vx + (q[1] - ay) * vy) / L2));
      if (Math.hypot(ax + vx * t - q[0], ay + vy * t - q[1]) <= Math.max(1, p.half * 0.5)) return true;
    }
    return false;
  };
  const out = [];
  for (const cw of carriageways) {
    const own = byOwner.get(cw.owner);
    if (!own || cw.bridge || cw.tunnel) { out.push(cw); continue; }
    const flags = cw.nodes.map((q) => own.some((p) => onPart(q, p)));
    if (!flags.some(Boolean)) { out.push(cw); continue; }
    let start = 0;
    for (let i = 1; i <= cw.nodes.length; i++) {
      if (i < cw.nodes.length && flags[i] === flags[start]) continue;
      // each stretch shares its boundary node with the next (no gap in the road)
      const nodes = cw.nodes.slice(start, Math.min(cw.nodes.length, i + 1));
      if (nodes.length >= 2) out.push({ ...cw, nodes, bridge: flags[start] });
      start = i;
    }
  }
  return out;
}

/**
 * Rivers along year-round waterway centrelines (services/beamngWater.js
 * planRivers): per-node width from the riverbank outline, surface in the
 * channel, kept off the roads; ripples drift downstream at the river's flow.
 */
function buildRiverObjects(terrainData, squareSize, biome, roads = [], stats = {}, dryZones = [], plan = null) {
  const waterProfile = getWaterProfile(biome);
  const { rivers, stats: riverStats } = plan || planRivers({
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
// The Forest density setting (advanced): how many trees a wood, a canopy patch
// or a park's scatter gets, as a multiplier of the base rates. 'normal' is the
// 1.5 above (about 54 trees a hectare in a wood); real woods stand thicker,
// 'dense' and 'veryDense' come closer at a frame-rate cost. Mapped single
// trees and bushes keep their copies whatever the setting.
export const FOREST_DENSITY = Object.freeze({ light: 1, normal: BEAMNG_TREE_DENSITY_MULTIPLIER, dense: 3, veryDense: 5 });
export const forestDensityMultiplier = (key) => FOREST_DENSITY[key] ?? BEAMNG_TREE_DENSITY_MULTIPLIER;
const BEAMNG_GRASS_DENSITY_MULTIPLIER = 1.0;
// (the forest placement ceilings are in SAFE_CAPS: at 12,000 per type and
// 3,600 per polygon, big forests came out thin)
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
// Parking spaces (city.sites.json parkingSpots: BeamNG's parked traffic,
// missions and garages park in them; the exports had none). A row of bays
// each side of every parking aisle, square to it, inside its lot's outline,
// clear of buildings, roads and other aisles.
const PARKING_BAY_W = 2.5;
const PARKING_BAY_L = 5.5;
const PARKING_BAY_DEPTHS = [PARKING_BAY_L, 4.8];
const PARKING_AISLE_HALF = 3;
const PARKING_END_CLEAR_M = 2;
const PARKING_OLD_ID_BASE = 100000;

// Painted stall lines for those bays: each bay's two sides, square to its
// aisle, the full bay depth (a side shared by two neighbours drawn once).
const PARKING_LINE_W = 0.12;     // 4-6 in stall lines

export function buildParkingMarkings(spots, terrainData, squareSize) {
  const seen = new Set();
  const decals = [];
  for (const sp of spots) {
    if (sp.unmarked) continue;
    const [x, y] = sp.pos;
    const yaw = 2 * Math.atan2(sp.rot[2], sp.rot[3]);
    const ax = Math.cos(yaw); const ay = Math.sin(yaw);     // across the bay (local X)
    const dx = -Math.sin(yaw); const dy = Math.cos(yaw);    // its depth (local Y)
    const halfW = sp.scl[0] / 2; const halfL = sp.scl[1] / 2;
    for (const side of [-1, 1]) {
      const cx = x + ax * side * halfW; const cy = y + ay * side * halfW;
      const key = `${Math.round(cx / 0.4)},${Math.round(cy / 0.4)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const node = (px, py) => [roundTo(px, 3), roundTo(py, 3), roundTo(getTerrainHeightAtWorldXY(px, py, terrainData, squareSize) + 0.1, 3), PARKING_LINE_W];
      const decal = makeRoadDecal([node(cx - dx * halfL, cy - dy * halfL), node(cx + dx * halfL, cy + dy * halfL)],
        sanitizeBeamNGObjectName(`parking_line_${decals.length + 1}`), 'parking_markings', {
          material: GLOBAL_DECAL_MATERIALS.lineWhite, renderPriority: 1, breakAngle: 1, textureLength: 6.4,
        });
      if (decal) decals.push(decal);
    }
  }
  return decals;
}

// Street parking: spaces in the parking lane of every carriageway that has
// one (OSM parking:* tags, or the urban default lane the cross-section
// adds), parallel spaces a car long, angled / perpendicular stalls where
// tagged, clear of junctions, side roads, driveways and crosswalks.
const STREET_SPACE_L = 6.0;
const STREET_STALL_W = 2.6;
const STREET_JUNCTION_CLEAR_M = 4;   // past a crossing road's edge
const STREET_DRIVEWAY_CLEAR_M = 2.5;

// The Sites loader (gameplay/util/sortedList.lua onDeserialized) re-sorts
// its whole list after every spot it adds: n spots cost ~n² log n, and
// 20133 spots held the loading screen 77 s (official levels: 452 at most
// in one file). city.sites.json gets an even spread of at most this many
// (the painted bays are all kept); parked traffic only fills spots near
// the player anyway.
export const SITES_MAX_PARKING_SPOTS = 3000;
const SITES_SAMPLE_CELL_M = 64;

/** A spot's rotation (our yaw quaternion) as city.sites.json takes it: the yaw turned the other way. */
export const siteRotation = ([x, y, z, w]) => [x, y, z ? -z : 0, w];

export function sampleSiteSpots(spots, max = SITES_MAX_PARKING_SPOTS) {
  if (spots.length <= max) return spots;
  // round-robin over 64 m cells: every neighbourhood keeps some
  const cells = new Map();
  for (const sp of spots) {
    const k = `${Math.floor(sp.pos[0] / SITES_SAMPLE_CELL_M)},${Math.floor(sp.pos[1] / SITES_SAMPLE_CELL_M)}`;
    if (!cells.has(k)) cells.set(k, []);
    cells.get(k).push(sp);
  }
  // each cell's spots alternating along it (every other one first), then
  // one per cell per round
  const lists = [...cells.values()].map((l) => [...l.filter((_, i) => i % 2 === 0), ...l.filter((_, i) => i % 2 === 1)]);
  const picked = [];
  for (let round = 0; picked.length < max; round++) {
    let any = false;
    for (const list of lists) {
      if (round >= list.length) continue;
      any = true;
      picked.push(list[round]);
      if (picked.length >= max) break;
    }
    if (!any) break;
  }
  return picked.map((sp, i) => ({ ...sp, oldId: PARKING_OLD_ID_BASE + i }));
}

export function buildParkingSpots(terrainData, squareSize, carriageways = [], { crosswalkZones = [], leftHandTraffic = false } = {}) {
  const toXY = (p) => geoToWorldPoint(p.lat, p.lng, terrainData, squareSize, 0);
  const feats = terrainData.osmFeatures || [];
  const aisles = feats.filter((f) => f?.type === 'road' && f.tags?.highway === 'service' && f.tags?.service === 'parking_aisle' && f.geometry?.length >= 2)
    .map((f) => ({ id: f.id, xy: f.geometry.map(toXY), half: (Number.parseFloat(f.tags.width) / 2) || PARKING_AISLE_HALF, surface: String(f.tags.surface || '').toLowerCase() }));
  const ringOf = (f) => f.geometry.map(toXY);
  const lots = feats.filter((f) => f?.tags?.amenity === 'parking' && f.geometry?.length >= 3 && !['multi-storey', 'underground', 'rooftop'].includes(f.tags.parking)).map(ringOf);
  const buildings = feats.filter((f) => f?.type === 'building' && f.geometry?.length >= 3 && !isCarportFeature(f)).map(ringOf);
  const inRing = (x, y, ring) => {
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = ring[i]; const [xj, yj] = ring[j];
      if (((yi > y) !== (yj > y)) && x < ((xj - xi) * (y - yi)) / ((yj - yi) || 1e-12) + xi) inside = !inside;
    }
    return inside;
  };
  const distToLine = (xy, x, y) => {
    let best = Infinity;
    for (let i = 0; i + 1 < xy.length; i++) {
      const vx = xy[i + 1][0] - xy[i][0]; const vy = xy[i + 1][1] - xy[i][1];
      const L2 = vx * vx + vy * vy || 1e-9;
      const t = Math.max(0, Math.min(1, ((x - xy[i][0]) * vx + (y - xy[i][1]) * vy) / L2));
      best = Math.min(best, Math.hypot(xy[i][0] + vx * t - x, xy[i][1] + vy * t - y));
    }
    return best;
  };
  const roads = carriageways.filter((cw) => !cw.bridge && !cw.tunnel).map((cw) => ({ xy: cw.nodes, half: cw.half }));
  // everything bucketed by 32 m cells (a city's thousands of bays checked
  // against its thousands of buildings took a minute unindexed)
  const CELL = 32;
  const grid = (items, boxOf) => {
    const g = new Map();
    for (const it of items) {
      const [x0, y0, x1, y1] = boxOf(it);
      for (let cx = Math.floor(x0 / CELL); cx <= Math.floor(x1 / CELL); cx++) {
        for (let cy = Math.floor(y0 / CELL); cy <= Math.floor(y1 / CELL); cy++) {
          const k = `${cx},${cy}`;
          if (!g.has(k)) g.set(k, []);
          g.get(k).push(it);
        }
      }
    }
    return (x, y) => g.get(`${Math.floor(x / CELL)},${Math.floor(y / CELL)}`) || [];
  };
  const boxOfXY = (xy, pad) => [Math.min(...xy.map((p) => p[0])) - pad, Math.min(...xy.map((p) => p[1])) - pad, Math.max(...xy.map((p) => p[0])) + pad, Math.max(...xy.map((p) => p[1])) + pad];
  // (lines split into their segments, so a long road is only near its own cells)
  const segments = (lines) => lines.flatMap((l) => l.xy.slice(0, -1).map((p, i) => ({ xy: [p, l.xy[i + 1]], half: l.half, line: l })));
  const buildingsAt = grid(buildings, (ring) => boxOfXY(ring, 1));
  const roadsAt = grid(segments(roads), (sg) => boxOfXY(sg.xy, sg.half + PARKING_BAY_L));
  const aislesAt = grid(segments(aisles), (sg) => boxOfXY(sg.xy, sg.half + PARKING_BAY_L));
  const spotGrid = new Map();
  const spots = [];
  // bays as rectangles (corner rings), overlap by separating axes, shrunk a
  // little so neighbours sharing a line do not count
  const SPOT_CELL = 8;
  const overlapsRect = (a, b) => {
    for (const poly of [a, b]) {
      for (let i = 0; i < 4; i++) {
        const [x1, y1] = poly[i]; const [x2, y2] = poly[(i + 1) % 4];
        const nx = y1 - y2; const ny = x2 - x1;
        let amin = Infinity; let amax = -Infinity; let bmin = Infinity; let bmax = -Infinity;
        for (const [px, py] of a) { const d = px * nx + py * ny; amin = Math.min(amin, d); amax = Math.max(amax, d); }
        for (const [px, py] of b) { const d = px * nx + py * ny; bmin = Math.min(bmin, d); bmax = Math.max(bmax, d); }
        const len = Math.hypot(nx, ny) || 1;
        if (amax - bmin < 0.15 * len || bmax - amin < 0.15 * len) return false;
      }
    }
    return true;
  };
  const overlapsSpot = (corners) => {
    const cx = corners.reduce((t, p) => t + p[0], 0) / 4; const cy = corners.reduce((t, p) => t + p[1], 0) / 4;
    for (let ox = -1; ox <= 1; ox++) for (let oy = -1; oy <= 1; oy++) {
      for (const other of spotGrid.get(`${Math.floor(cx / SPOT_CELL) + ox},${Math.floor(cy / SPOT_CELL) + oy}`) || []) {
        if (overlapsRect(corners, other)) return true;
      }
    }
    return false;
  };
  const addSpotRect = (x, y, corners) => {
    const k = `${Math.floor(x / SPOT_CELL)},${Math.floor(y / SPOT_CELL)}`;
    if (!spotGrid.has(k)) spotGrid.set(k, []);
    spotGrid.get(k).push(corners);
  };
  for (const aisle of aisles) {
    // the lot this aisle runs in (its bays stay inside it), if it is mapped
    const lot = lots.find((ring) => aisle.xy.some(([x, y]) => inRing(x, y, ring)));
    for (let i = 0; i + 1 < aisle.xy.length; i++) {
      const [ax, ay] = aisle.xy[i]; const [bx, by] = aisle.xy[i + 1];
      const L = Math.hypot(bx - ax, by - ay);
      if (L < PARKING_BAY_W + 2 * PARKING_END_CLEAR_M) continue;
      const ux = (bx - ax) / L; const uy = (by - ay) / L;
      const n = Math.floor((L - 2 * PARKING_END_CLEAR_M) / PARKING_BAY_W);
      const start = (L - n * PARKING_BAY_W) / 2 + PARKING_BAY_W / 2;
      for (const side of [1, -1]) {
        // the bay's depth runs away from the aisle: its local Y (scl [w, l, h])
        const dx = -uy * side; const dy = ux * side;
        const yaw = Math.atan2(-dx, dy);
        for (let k = 0; k < n; k++) {
          const s = start + k * PARKING_BAY_W;
          // full depth, else a shorter bay where two rows meet back to back
          let fit = null;
          for (const depth of PARKING_BAY_DEPTHS) {
            const o = aisle.half + depth / 2;
            const cx = ax + ux * s + dx * o; const cy = ay + uy * s + dy * o;
            const cs = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([a, b]) => [cx + ux * a * PARKING_BAY_W / 2 + dx * b * depth / 2, cy + uy * a * PARKING_BAY_W / 2 + dy * b * depth / 2]);
            if (!overlapsSpot(cs)) { fit = { x: cx, y: cy, corners: cs, depth }; break; }
          }
          if (!fit) continue;
          const { x, y, corners, depth } = fit;
          if (lot && !corners.every(([cx, cy]) => inRing(cx, cy, lot))) continue;
          if (buildingsAt(x, y).some((ring) => corners.some(([cx, cy]) => inRing(cx, cy, ring)) || inRing(x, y, ring))) continue;
          if (roadsAt(x, y).some((sg) => distToLine(sg.xy, x, y) < sg.half + PARKING_BAY_L / 2)) continue;
          if (aislesAt(x, y).some((sg) => sg.line !== aisle && distToLine(sg.xy, x, y) < sg.half + PARKING_BAY_L / 2 - 0.3)) continue;
          if (overlapsSpot(corners)) continue;
          addSpotRect(x, y, corners);
          const z = getTerrainHeightAtWorldXY(x, y, terrainData, squareSize);
          spots.push({
            name: `parking_${aisle.id}_${i}_${side > 0 ? 'l' : 'r'}${k + 1}`,
            pos: [roundTo(x, 3), roundTo(y, 3), roundTo(z, 3)],
            rot: [0, 0, roundTo(Math.sin(yaw / 2), 6), roundTo(Math.cos(yaw / 2), 6)],
            scl: [PARKING_BAY_W, depth, 3],
            color: [1, 1, 1],
            customFields: { names: {}, tags: {}, types: {}, values: {} },
            isMultiSpot: false,
            // the Sites loader keys its id map by oldId (missing, the level
            // load stopped in sortedList.lua); past the zones' ids
            oldId: PARKING_OLD_ID_BASE + spots.length,
          });
          // the ground under the bay: its aisle's surface (terrain paint)
          Object.defineProperty(spots[spots.length - 1], 'ground', { value: { corners, surface: aisle.surface, inLot: !!lot } });
        }
      }
    }
  }
  // ── street parking ─────────────────────────────────────────────────────
  const ground = carriageways.filter((cw) => !cw.bridge && !cw.tunnel && cw.nodes?.length >= 2);
  const cwSegs = grid(ground.flatMap((cw) => cw.nodes.slice(0, -1).map((p, i) => ({ xy: [p, cw.nodes[i + 1]], half: cw.half, cw }))),
    (sg) => boxOfXY(sg.xy, sg.half + STREET_JUNCTION_CLEAR_M + STREET_SPACE_L));
  // driveways and other ways that are not drawn carriageways still need a gap
  const minorWays = feats.filter((f) => f?.type === 'road' && f.geometry?.length >= 2
    && ['service', 'track', 'unclassified', 'residential', 'living_street'].includes(f.tags?.highway))
    .map((f) => ({ id: f.id, xy: f.geometry.map(toXY), half: 0 }));
  const minorAt = grid(segments(minorWays), (sg) => boxOfXY(sg.xy, STREET_DRIVEWAY_CLEAR_M + STREET_SPACE_L));
  const inZone = (x, y) => crosswalkZones.some((z) => {
    const dx = x - z.x; const dy = y - z.y;
    return Math.abs(dx * z.ux + dy * z.uy) < z.halfLength + STREET_SPACE_L / 2 && Math.abs(-dx * z.uy + dy * z.ux) < z.halfWidth + 1;
  });
  let streetSpaces = 0;
  for (const cw of ground) {
    const urban = !!cw.urban;
    for (const side of ['left', 'right']) {
      const extra = side === 'left' ? cw.leftExtra : cw.rightExtra;
      if (!(extra > 1.5)) continue;
      const kind = streetParkingSide(cw.tags || {}, cw.highway, cw.oneWay, { urban }, side);
      if (!kind) continue;
      const sgn = side === 'left' ? 1 : -1;
      const parallel = kind.orientation === 'parallel';
      const pitch = parallel ? STREET_SPACE_L : STREET_STALL_W;
      const off = cw.half - extra / 2;
      // cars face the traffic on their side (both sides with it on a one-way)
      const facing = cw.oneWay || (side === 'right') !== leftHandTraffic ? 1 : -1;
      // walk the centreline by arc length, a space every pitch metres
      const xy = cw.nodes;
      let carry = pitch / 2;
      for (let i = 0; i + 1 < xy.length; i++) {
        const [ax, ay] = xy[i]; const [bx, by] = xy[i + 1];
        const L = Math.hypot(bx - ax, by - ay);
        if (L < 1e-6) continue;
        const ux = (bx - ax) / L; const uy = (by - ay) / L;
        const nx = -uy * sgn; const ny = ux * sgn;       // toward this side's kerb
        let s = carry;
        for (; s < L; s += pitch) {
          const x = ax + ux * s + nx * off; const y = ay + uy * s + ny * off;
          // the space's depth axis (local Y): along the road for a parallel
          // space (its car's length), toward the kerb for a stall
          const dx = parallel ? ux * facing : nx; const dy = parallel ? uy * facing : ny;
          const wAcross = parallel ? extra : STREET_STALL_W;
          const lAlong = parallel ? STREET_SPACE_L - 0.4 : extra;
          const yaw = Math.atan2(-dx, dy);
          if (cwSegs(x, y).some((sg) => sg.cw !== cw && sg.cw.wayId !== cw.wayId
            && distToLine(sg.xy, x, y) < sg.half + STREET_JUNCTION_CLEAR_M + (parallel ? STREET_SPACE_L / 2 : STREET_STALL_W / 2))) continue;
          if (minorAt(x, y).some((sg) => sg.line.id !== cw.wayId && distToLine(sg.xy, x, y) < STREET_DRIVEWAY_CLEAR_M + (parallel ? STREET_SPACE_L / 2 : STREET_STALL_W / 2))) continue;
          if (inZone(x, y)) continue;
          if (buildingsAt(x, y).some((ring) => inRing(x, y, ring))) continue;
          const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([a, b]) => [x + dy * a * wAcross / 2 + dx * b * lAlong / 2, y - dx * a * wAcross / 2 + dy * b * lAlong / 2]);
          if (overlapsSpot(corners)) continue;
          addSpotRect(x, y, corners);
          const z = getTerrainHeightAtWorldXY(x, y, terrainData, squareSize);
          const spot = {
            name: `street_parking_${cw.wayId}_${side[0]}${streetSpaces + 1}`,
            pos: [roundTo(x, 3), roundTo(y, 3), roundTo(z, 3)],
            rot: [0, 0, roundTo(Math.sin(yaw / 2), 6), roundTo(Math.cos(yaw / 2), 6)],
            scl: [roundTo(wAcross, 3), roundTo(lAlong, 3), 3],
            color: [1, 1, 1],
            customFields: { names: {}, tags: {}, types: {}, values: {} },
            isMultiSpot: false,
            oldId: PARKING_OLD_ID_BASE + spots.length,
          };
          // (painted stall lines for angled / perpendicular stalls only:
          // parallel street parking is mostly unmarked)
          if (parallel) Object.defineProperty(spot, 'unmarked', { value: true });
          spots.push(spot);
          streetSpaces++;
        }
        carry = s - L;
      }
    }
  }

  return spots;
}

// Scattered trees per m² over open, tended or lived-in land (BeamNG's own
// towns stand in trees; ours only had the ones OSM maps one by one).
const SCATTER_TREES = {
  park: 0.0005, garden: 0.0005, cemetery: 0.0005, recreation_ground: 0.0004, village_green: 0.0004,
  golf_course: 0.0003, residential: 0.0006, wetland: 0.001,
};
function scatterDensityOf(tags, wetland) {
  if (wetland === '') return SCATTER_TREES.wetland;   // an untagged wetland: trees among its bushes
  if (tags.leisure === 'park' || tags.leisure === 'garden') return SCATTER_TREES.park;
  if (tags.leisure === 'golf_course') return SCATTER_TREES.golf_course;
  if (tags.landuse === 'cemetery' || tags.amenity === 'grave_yard') return SCATTER_TREES.cemetery;
  if (tags.landuse === 'recreation_ground' || tags.leisure === 'recreation_ground') return SCATTER_TREES.recreation_ground;
  if (tags.landuse === 'village_green') return SCATTER_TREES.village_green;
  if (tags.landuse === 'residential') return SCATTER_TREES.residential;
  return 0;
}

// Canopy trees from the satellite ground classes (terrainData.groundClasses,
// osmTexture.js satelliteGroundClasses): the trees of the yards, streets
// and woods OSM never mapped. Each connected patch of tree-crown cells is a
// tree (a yard's lone crown: one, at its middle) or, past CANOPY_SINGLE_M2,
// a stand sampled at the density of an OSM wood.
const CANOPY_CLASS = GROUND_CLASSES.indexOf('trees');
const CANOPY_MIN_M2 = 12;          // smaller: noise the majority filter left
const CANOPY_SINGLE_M2 = 160;      // up to here, one crown (or two touching)
const CANOPY_TREES_PER_M2 = 0.0036;
const CANOPY_MAPPED_TREE_M = 5;
// Plants under the trees of a wood or a large canopy stand (ferns; broad
// leaves in the tropics; none on dry floors): per m², and the least stand.
const UNDERSTORY_PER_M2 = 0.012;
const UNDERSTORY_MIN_STAND_M2 = 1500;    // a mapped tree this close is that crown

// Cells of a north-up w×h grid over bounds inside any of the rings (holes cut out).
function rasterizeAreas(areas, w, h, bounds) {
  const mask = new Uint8Array(w * h);
  const { north, south, east, west } = bounds;
  const gx = (lng) => ((lng - west) / (east - west)) * w;
  const gy = (lat) => ((north - lat) / (north - south)) * h;
  for (const { ring, holes } of areas) {
    const rings = [ring, ...(holes || [])].map((r) => r.map((p) => [gx(p.lng), gy(p.lat)]));
    let y0 = Infinity; let y1 = -Infinity;
    for (const [, y] of rings[0]) { if (y < y0) y0 = y; if (y > y1) y1 = y; }
    for (let row = Math.max(0, Math.floor(y0)); row <= Math.min(h - 1, Math.ceil(y1)); row++) {
      const cy = row + 0.5;
      const xs = [];
      for (const r of rings) {
        for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
          const [xi, yi] = r[i]; const [xj, yj] = r[j];
          if ((yi > cy) !== (yj > cy)) xs.push(xi + ((cy - yi) / (yj - yi)) * (xj - xi));
        }
      }
      xs.sort((a, b) => a - b);
      for (let k = 0; k + 1 < xs.length; k += 2) {
        for (let col = Math.max(0, Math.ceil(xs[k] - 0.5)); col <= Math.min(w - 1, Math.floor(xs[k + 1] - 0.5)); col++) mask[row * w + col] = 1;
      }
    }
  }
  return mask;
}

/**
 * Canopy patches outside `covered`: [{ cells: [index…], cx, cy }] in grid
 * cells (4-connected), smallest dropped.
 */
function canopyPatches(cls, w, h, covered, minCells) {
  const seen = new Uint8Array(w * h);
  const patches = [];
  const stack = [];
  for (let start = 0; start < w * h; start++) {
    if (seen[start] || cls[start] !== CANOPY_CLASS || covered[start]) continue;
    const cells = [];
    seen[start] = 1;
    stack.push(start);
    let sx = 0; let sy = 0;
    while (stack.length) {
      const i = stack.pop();
      cells.push(i);
      const x = i % w; const y = (i - x) / w;
      sx += x; sy += y;
      if (x > 0) visit(i - 1);
      if (x < w - 1) visit(i + 1);
      if (y > 0) visit(i - w);
      if (y < h - 1) visit(i + w);
    }
    if (cells.length >= minCells) patches.push({ cells, cx: sx / cells.length + 0.5, cy: sy / cells.length + 0.5 });
  }
  return patches;
  function visit(j) {
    if (!seen[j] && cls[j] === CANOPY_CLASS && !covered[j]) { seen[j] = 1; stack.push(j); }
  }
}

// (the paint rounds to 1 m cells and blends a cell further; a big trunk is ~1 m)
const OPEN_GROUND_CLEAR_M = 4;
const TREELESS_GOLF = new Set(['bunker', 'green', 'tee', 'fairway', 'driving_range', 'water_hazard', 'lateral_water_hazard']);

// a plant under water: kept one in this many, only near a road
const UNDERWATER_KEEP = 30;
const UNDERWATER_ROAD_M = 25;

async function buildForestPlacements(terrainData, squareSize, { includeTrees, includeRocks, treeMix = null, water = null, forestDensity = 'normal' }, biome, tick = async () => {}) {
  // (what the land cover left out, for the report: set when trees are planted)
  let landCover = null;
  // Buildings, water and open playing ground, for the scattered and canopy
  // trees (a yard's tree is not in the house or the pool): world rings
  // bucketed by 32 m cells
  const AVOID_CELL = 32;
  const avoid = new Map();
  for (const f of terrainData.osmFeatures || []) {
    const isBuilding = f?.type === 'building';
    const isWater = f?.type === 'water' || f?.tags?.natural === 'water';
    // open ground no tree stands on: bunkers, greens, tees, fairways, pitches,
    // running tracks, car parks (a crown overhanging one put its trunk in
    // the sand, or in a car park's aisle)
    // (a pool by its deck too: services/pools.js, up to 4 m round it)
    const isOpen = TREELESS_GOLF.has(f?.tags?.golf) || f?.tags?.leisure === 'pitch' || f?.tags?.leisure === 'track' || f?.tags?.leisure === 'swimming_pool'
      || (f?.tags?.amenity === 'parking' && !['multi-storey', 'underground', 'rooftop'].includes(f.tags.parking));
    if ((!isBuilding && !isWater && !isOpen) || !(f.geometry?.length >= 3)) continue;
    const ring = f.geometry.map((p) => geoToWorldPoint(p.lat, p.lng, terrainData, squareSize, 0));
    const pad = isBuilding ? 2 : isOpen ? OPEN_GROUND_CLEAR_M : 1;
    const box = [Math.min(...ring.map((p) => p[0])) - pad, Math.min(...ring.map((p) => p[1])) - pad, Math.max(...ring.map((p) => p[0])) + pad, Math.max(...ring.map((p) => p[1])) + pad];
    if ((box[2] - box[0]) * (box[3] - box[1]) > 4e6) continue;   // a whole sea or lake: its own trees are not placed anyway
    const item = { ring, box, isBuilding, isOpen };
    for (let cx = Math.floor(box[0] / AVOID_CELL); cx <= Math.floor(box[2] / AVOID_CELL); cx++) {
      for (let cy = Math.floor(box[1] / AVOID_CELL); cy <= Math.floor(box[3] / AVOID_CELL); cy++) {
        const k = `${cx},${cy}`;
        if (!avoid.has(k)) avoid.set(k, []);
        avoid.get(k).push(item);
      }
    }
  }
  for (const ring of terrainData.parkingBayRings || []) {
    const box = [Math.min(...ring.map((p) => p[0])) - 1, Math.min(...ring.map((p) => p[1])) - 1, Math.max(...ring.map((p) => p[0])) + 1, Math.max(...ring.map((p) => p[1])) + 1];
    const item = { ring, box, isBuilding: false, isOpen: false };
    for (let cx = Math.floor(box[0] / AVOID_CELL); cx <= Math.floor(box[2] / AVOID_CELL); cx++) {
      for (let cy = Math.floor(box[1] / AVOID_CELL); cy <= Math.floor(box[3] / AVOID_CELL); cy++) {
        const key = `${cx},${cy}`;
        if (!avoid.has(key)) avoid.set(key, []);
        avoid.get(key).push(item);
      }
    }
  }
  const inRingXY = (x, y, ring) => {
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = ring[i]; const [xj, yj] = ring[j];
      if (((yi > y) !== (yj > y)) && x < ((xj - xi) * (y - yi)) / ((yj - yi) || 1e-12) + xi) inside = !inside;
    }
    return inside;
  };
  const nearRingXY = (x, y, ring, d) => {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [ax, ay] = ring[j]; const [bx, by] = ring[i];
      const dx = bx - ax; const dy = by - ay;
      const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / ((dx * dx + dy * dy) || 1e-12)));
      if ((ax + t * dx - x) ** 2 + (ay + t * dy - y) ** 2 < d * d) return true;
    }
    return false;
  };
  // (a building by its box grown 2 m: trunks and crowns clear of the walls;
  // a bunker or green also by a strip round its edge, where its paint runs)
  const inBuildingOrWater = (x, y) => (avoid.get(`${Math.floor(x / AVOID_CELL)},${Math.floor(y / AVOID_CELL)}`) || [])
    .some((it) => x >= it.box[0] && x <= it.box[2] && y >= it.box[1] && y <= it.box[3]
      && (it.isBuilding || inRingXY(x, y, it.ring) || (it.isOpen && nearRingXY(x, y, it.ring, OPEN_GROUND_CLEAR_M))));

  const inOpenOrWater = (x, y) => (avoid.get(`${Math.floor(x / AVOID_CELL)},${Math.floor(y / AVOID_CELL)}`) || [])
    .some((it) => !it.isBuilding && x >= it.box[0] && x <= it.box[2] && y >= it.box[1] && y <= it.box[3] && inRingXY(x, y, it.ring));

  const regularPlacementsByType = new Map();
  const priorityPlacementsByType = new Map();
  // (woods, canopy patches, scrub and the parks' scatter by the setting; a
  // mapped tree's or bush's copies by the base rate)
  const treeDensityMultiplier = forestDensityMultiplier(forestDensity);
  // (undergrowth thickens up to 'dense' only; a park's or yard's scatter
  // never past 'normal': more there is a wood, not a park)
  const bushDensityMultiplier = Math.min(treeDensityMultiplier, FOREST_DENSITY.dense);
  const scatterDensityMultiplier = Math.min(treeDensityMultiplier, FOREST_DENSITY.normal);
  const pointCopyMultiplier = BEAMNG_TREE_DENSITY_MULTIPLIER;
  /**
   * Add a forest placement to priority or regular buckets with hard caps.
   */
  let placed = 0;
  // (a point off the map comes back from geoToWorldPoint pinned to its edge:
  // trees of a way or a scatter reaching past the bounds piled up there, 1277
  // in one corner of a dense 2 km export, and BeamNG's forest cell tree
  // recursed on the pile until it overflowed the stack and crashed the load)
  const forestHalf = (terrainData.width * squareSize) / 2;
  // Under water (the sea plane, a lake's blocks): water is a surface a driver
  // sees from the road, so what stands below it is left out, but for one in
  // UNDERWATER_KEEP within UNDERWATER_ROAD_M of a drawn road (St. Augustine's
  // tidal marsh, lidar under the sea plane: 119,531 ferns and bushes under
  // the water). A tree OSM maps by itself always stands.
  const underwater = { dropped: 0, kept: 0 };
  const pushPlacement = (placement, { priority = false, mapped = false } = {}) => {
    if (!getManagedForestTemplate(biome, placement.type)) return;
    if (!mapped && water?.underWater?.(placement.pos[0], placement.pos[1], placement.pos[2])) {
      const nearRoad = water.nearRoad?.(placement.pos[0], placement.pos[1]);
      if (!nearRoad || seededRandom(hashString(`uw:${Math.round(placement.pos[0] * 10)}:${Math.round(placement.pos[1] * 10)}`)) >= 1 / UNDERWATER_KEEP) { underwater.dropped++; return; }
      underwater.kept++;
    }
    if (!(Math.abs(placement.pos[0]) < forestHalf && Math.abs(placement.pos[1]) < forestHalf)) return;
    if (placed >= caps.forestTotal) return;
    const target = priority ? priorityPlacementsByType : regularPlacementsByType;
    if (!target.has(placement.type)) target.set(placement.type, []);
    const list = target.get(placement.type);
    if (list.length >= caps.forestPerType) return;
    list.push(placement);
    placed++;
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
    // What really covers the ground (services/worldCover.js, ESA WorldCover,
    // 10 m): trees from a mapped wood only where there is tree cover, bushes
    // not on rock or snow, no scattered trees on bare ground. OSM's woods are
    // often drawn generously, and in the mountains far above the tree line
    // (Tignes: 144,000 trees above 2,250 m, most of them in the open).
    const worldSize = terrainData.width * squareSize;
    // (read while generating: terrainData.landCover; the export downloads
    // nothing, so a terrain without it plants by OSM alone)
    let coverN = Math.min(4096, Math.max(64, Math.ceil(worldSize / 10)));
    let coverGrid = null;
    if (terrainData.landCover?.grid) ({ grid: coverGrid, n: coverN } = terrainData.landCover);
    else console.warn(`${BEAMNG_EXPORT_SERVICE_LOG} No land cover (WorldCover) with this terrain; trees follow OSM alone.`);
    const coverAt = (x, y) => {
      if (!coverGrid) return 0;
      const c = Math.min(coverN - 1, Math.max(0, Math.floor((x / worldSize + 0.5) * coverN)));
      const r = Math.min(coverN - 1, Math.max(0, Math.floor((0.5 - y / worldSize) * coverN)));
      return coverGrid[r * coverN + c];
    };
    const coverDropped = { wood: 0, bush: 0, scatter: 0 };
    const coverKeeps = (placement, kind, seedText) => {
      if (plantAllowed(coverAt(placement.pos[0], placement.pos[1]), kind, seededRandom(hashString(seedText)))) return true;
      coverDropped[kind]++;
      return false;
    };
    // (a placement's height above the sea, for the species: conifers in the mountains)
    const baseZ = Number.isFinite(terrainData.minHeight) ? terrainData.minHeight : 0;
    const elevationOf = (placement) => placement.pos[2] + baseZ;
    landCover = { used: !!coverGrid, dropped: coverDropped, attribution: WORLDCOVER_ATTRIBUTION };
    const pickTree = ({ kind, tags, point, urban, area, seed, elevation = null }) => {
      const hint = treeHintFromTags(tags);
      // exact species the biome ships (Italy: olive, cypress)
      if (kind === 'tree' && (hint === 'olive' || hint === 'cypress')) {
        const type = getOwnVegetationSelector(biome, hint);
        if (type) return { type, scale: 0.85 + 0.3 * seededRandom(hashString(`${seed}:s`)) };
      }
      const group = chooseTreeGroup({ kind, tags, lat: point.lat, lon: point.lng, urban, area, seed, mix: treeMix, elevation });
      // (an olive or cypress drawn from the local mix: the biome's own, if it ships one)
      if (kind === 'tree' && (group === 'olive' || group === 'cypress')) {
        const type = getOwnVegetationSelector(biome, group);
        if (type) return { type, scale: 0.85 + 0.3 * seededRandom(hashString(`${seed}:s`)) };
      }
      return chooseTreeItem(group, { tags, lat: point.lat, lon: point.lng, seed, extra: signature(group) });
    };
    const ground = terrainData.groundClasses?.cls?.length === terrainData.groundClasses?.w * terrainData.groundClasses?.h
      ? terrainData.groundClasses : null;
    const centroidOf = (feature) => {
      const g = feature.geometry || [];
      const n = Math.max(1, g.length);
      return { lat: g.reduce((a, p) => a + p.lat, 0) / n, lng: g.reduce((a, p) => a + p.lng, 0) / n };
    };

    for (const feature of terrainData.osmFeatures || []) {
      await tick();
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
            ? Math.max(1, Math.round(pointCopyMultiplier))
            : Math.max(1, Math.round(pointCopyMultiplier));
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
          // not in a pool, on a court or a field (a copy scattered round a
          // mapped tree landed on a basketball slab); the copies not in a
          // building either (the mapped tree itself may stand by a wall)
          if (i > 0 ? inBuildingOrWater(placement.pos[0], placement.pos[1]) : inOpenOrWater(placement.pos[0], placement.pos[1])) continue;
          placement.scale = roundTo(choice.scale, 6);
          pushPlacement(placement, { priority: isTreeRow, mapped: i === 0 });
        }
      }
      if (feature.type === 'landuse') {
        const tags = feature.tags || {};
        const wetland = tags.natural === 'wetland' ? String(tags.wetland || '').toLowerCase() : null;
        const isTreeArea =
          tags.natural === 'wood' ||
          tags.natural === 'forest' ||
          tags.landuse === 'forest' ||
          tags.landuse === 'orchard' ||
          tags.landcover === 'trees' ||
          wetland === 'swamp' || wetland === 'mangrove';
        const isBushArea =
          tags.natural === 'scrub' ||
          tags.natural === 'heath' ||
          tags.natural === 'shrubbery' ||
          tags.landcover === 'scrub' ||
          (wetland !== null && wetland !== 'swamp' && wetland !== 'mangrove' && wetland !== 'tidalflat');
        // trees scattered over parks, cemeteries, greens, golf courses and
        // the yards of a residential area (none had any but mapped ones)
        // (with the satellite's canopy, the real trees stand there instead)
        const scatter = ground ? 0 : scatterDensityOf(tags, wetland);
        if (scatter > 0) {
          const centre = centroidOf(feature);
          const urban = isUrbanPlace({ id: `area:${feature.id}`, geometry: [centre] });
          const placements = sampleAreaPlacements(feature, terrainData, squareSize, 'area_tree', scatter * scatterDensityMultiplier,
            caps.forestPerArea, 1, 1, hashString(`${feature.id}:scatter`));
          placements.forEach((placement, idx) => {
            if (inBuildingOrWater(placement.pos[0], placement.pos[1])) return;
            if (!coverKeeps(placement, 'scatter', `${feature.id}:wcs${idx}`)) return;
            const choice = pickTree({ kind: 'tree', tags, point: centre, urban, area: true, seed: `${feature.id}:s${idx}`, elevation: elevationOf(placement) });
            if (!choice) return;
            placement.type = choice.type;
            placement.scale = roundTo(choice.scale, 6);
            pushPlacement(placement);
          });
        }
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
            caps.forestPerArea,
            1,
            1,
            hashString(`${feature.id}:tree_area`),
          );
          placements.forEach((placement, idx) => {
            if (!coverKeeps(placement, 'wood', `${feature.id}:wca${idx}`)) return;
            const choice = pickTree({ kind: 'tree', tags, point: centre, urban, area: true, seed: `${feature.id}:a${idx}`, elevation: elevationOf(placement) });
            if (!choice) return;
            placement.type = choice.type;
            placement.scale = roundTo(choice.scale, 6);
            pushPlacement(placement);
          });
          // the wood's floor: ferns, or broad leaves in the tropics (not
          // under an orchard's mown rows)
          const floor = isOrchard ? null : understoryGroup(centre.lat, centre.lng);
          if (floor) {
            sampleAreaPlacements(feature, terrainData, squareSize, 'area_bush', UNDERSTORY_PER_M2 * bushDensityMultiplier,
              caps.forestPerArea, 1, 1, hashString(`${feature.id}:floor`)).forEach((placement, idx) => {
              // (a wood's floor only under its trees: the same land cover rule)
              if (!plantAllowed(coverAt(placement.pos[0], placement.pos[1]), 'wood', seededRandom(hashString(`${feature.id}:wcf${idx}`)))) return;
              const choice = chooseTreeItem(floor, { lat: centre.lat, lon: centre.lng, seed: `${feature.id}:f${idx}` });
              if (!choice) return;
              placement.type = choice.type;
              placement.scale = roundTo(choice.scale, 6);
              pushPlacement(placement);
            });
          }
        }
        if (isBushArea) {
          const placements = sampleAreaPlacements(
            feature,
            terrainData,
            squareSize,
            'area_bush',
            0.004 * bushDensityMultiplier,
            caps.forestPerArea,
            1,
            1,
            hashString(feature.id),
          );
          placements.forEach((placement, idx) => {
            if (!coverKeeps(placement, 'bush', `${feature.id}:wcb${idx}`)) return;
            const choice = pickTree({ kind: 'shrub', tags, point: centre, urban, area: true, seed: `${feature.id}:b${idx}` });
            if (!choice) return;
            placement.type = choice.type;
            placement.scale = roundTo(choice.scale * (0.75 + 0.45 * seededRandom(hashString(`${feature.id}:bs${idx}`))), 6);
            pushPlacement(placement);
          });
        }
      }
    }
    if (ground) await placeCanopyTrees();

    async function placeCanopyTrees() {
      const { cls, w, h } = ground;
      const { north, south, east, west } = terrainData.bounds;
      const cellLat = (north - south) / h; const cellLng = (east - west) / w;
      const cellM2 = ((terrainData.width * squareSize) / w) * ((terrainData.height * squareSize) / h);
      // OSM's own woods and scrub keep their own trees
      const areas = [];
      const mapped = new Map();   // mapped trees by 8 m world cells
      const MAPPED_CELL = 8;
      for (const f of terrainData.osmFeatures || []) {
        const t = f?.tags || {};
        if (f?.type === 'vegetation' && f.geometry?.length === 1) {
          const [x, y] = geoToWorldPoint(f.geometry[0].lat, f.geometry[0].lng, terrainData, squareSize, 0);
          const k = `${Math.floor(x / MAPPED_CELL)},${Math.floor(y / MAPPED_CELL)}`;
          if (!mapped.has(k)) mapped.set(k, []);
          mapped.get(k).push([x, y]);
          continue;
        }
        if (f?.type !== 'landuse' || !(f.geometry?.length >= 3)) continue;
        const wet = t.natural === 'wetland' ? String(t.wetland || '').toLowerCase() : null;
        if (t.natural === 'wood' || t.natural === 'forest' || t.landuse === 'forest' || t.landuse === 'orchard'
          || t.landcover === 'trees' || t.natural === 'scrub' || t.natural === 'heath' || t.natural === 'shrubbery'
          || t.landcover === 'scrub' || wet !== null) areas.push({ ring: f.geometry, holes: f.holes });
      }
      const covered = rasterizeAreas(areas, w, h, terrainData.bounds);
      const nearMapped = (x, y) => {
        const cx = Math.floor(x / MAPPED_CELL); const cy = Math.floor(y / MAPPED_CELL);
        for (let dx = -1; dx <= 1; dx++) {
          for (let dy = -1; dy <= 1; dy++) {
            for (const [mx, my] of mapped.get(`${cx + dx},${cy + dy}`) || []) {
              if ((mx - x) ** 2 + (my - y) ** 2 < CANOPY_MAPPED_TREE_M ** 2) return true;
            }
          }
        }
        return false;
      };
      const patches = canopyPatches(cls, w, h, covered, Math.max(1, Math.round(CANOPY_MIN_M2 / cellM2)));
      let trees = 0;
      for (let pi = 0; pi < patches.length; pi++) {
      const patch = patches[pi];
      await tick();
        const areaM2 = patch.cells.length * cellM2;
        const seed = hashString(`canopy:${patch.cells[0]}`);
        // spots: a crown's middle (if it is on the crown; a crescent's is
        // not), else cells drawn at random
        const spots = [];
        const middle = Math.floor(patch.cy) * w + Math.floor(patch.cx);
        const count = areaM2 <= CANOPY_SINGLE_M2 ? 1 : Math.max(1, Math.round(areaM2 * CANOPY_TREES_PER_M2 * treeDensityMultiplier));
        if (count === 1 && cls[middle] === CANOPY_CLASS && !covered[middle]) spots.push([patch.cx, patch.cy]);
        for (let k = 0; spots.length < count && k < count * 3; k++) {
          const i = patch.cells[Math.floor(seededRandom(seed + k * 7.31) * patch.cells.length)];
          const x = i % w; const y = (i - x) / w;
          spots.push([x + seededRandom(seed + k * 3.7), y + seededRandom(seed + k * 5.3)]);
        }
        const urban = isUrbanPlace({ id: `canopy:${pi}`, geometry: [{ lat: north - patch.cy * cellLat, lng: west + patch.cx * cellLng }] });
      // a stand's floor (not a yard's lone tree or a town's street trees)
      const floor = areaM2 >= UNDERSTORY_MIN_STAND_M2 && !urban ? understoryGroup(north - patch.cy * cellLat, west + patch.cx * cellLng) : null;
      if (floor) {
        const n = Math.round(areaM2 * UNDERSTORY_PER_M2 * bushDensityMultiplier);
        for (let k = 0; k < n; k++) {
          const i = patch.cells[Math.floor(seededRandom(seed + 9000 + k * 7.77) * patch.cells.length)];
          const gx = (i % w) + seededRandom(seed + 9000 + k * 3.1); const gy = Math.floor(i / w) + seededRandom(seed + 9000 + k * 5.9);
          const point = { lat: north - gy * cellLat, lng: west + gx * cellLng };
          const [x, y] = geoToWorldPoint(point.lat, point.lng, terrainData, squareSize, 0);
          if (inBuildingOrWater(x, y)) continue;
          const choice = chooseTreeItem(floor, { lat: point.lat, lon: point.lng, seed: `canopy:${pi}:f${k}` });
          if (!choice) continue;
          const placement = makeForestPlacement(choice.type, point, terrainData, squareSize, seed + 9000 + k, 1, 1);
          placement.scale = roundTo(choice.scale, 6);
          pushPlacement(placement);
        }
      }
        spots.forEach(([gx, gy], k) => {
          const point = { lat: north - gy * cellLat, lng: west + gx * cellLng };
          const [x, y, z] = geoToWorldPoint(point.lat, point.lng, terrainData, squareSize, 0);
          if (inBuildingOrWater(x, y) || nearMapped(x, y)) return;
          // (the satellite's 'canopy' is often shadow or dark grass on a steep
          // mountainside: only where the land cover sees trees too)
          if (!coverKeeps({ pos: [x, y] }, 'wood', `canopy:${pi}:${k}:wc`)) return;
          const choice = pickTree({ kind: 'tree', tags: {}, point, urban, area: count > 1, seed: `canopy:${pi}:${k}`, elevation: z + baseZ });
          if (!choice) return;
          const placement = makeForestPlacement(choice.type, point, terrainData, squareSize, seed + k, 1, 1);
          placement.scale = roundTo(choice.scale, 6);
          pushPlacement(placement);
          trees++;
        });
      }
      console.log(`${BEAMNG_EXPORT_SERVICE_LOG} Canopy trees: ${trees} from ${patches.length} satellite canopy patch(es) outside OSM woods.`);
    }
  }

  if (includeRocks) {
    const rockTypes = getRockCandidates(biome);
    for (const feature of terrainData.osmFeatures || []) {
      if (feature.type !== 'landuse') continue;
      await tick();
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
    const merged = [...priority, ...regular].slice(0, caps.forestPerType);
    if (merged.length > 0) placementsByType.set(type, merged);
  }

  // (for the report: what the land cover left out)
  if (landCover) placementsByType.landCover = landCover;
  if (underwater.dropped || underwater.kept) placementsByType.underwater = underwater;
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

  // Lawns (parks, greens, cemeteries, golf fairways: the Lawn layer) get
  // only mown grass a few cm tall, none of the long field grass above.
  const lawnElements = Math.min(160000, Math.max(40000, Math.round(baseCoverMaxElements * 0.35)));
  groundCoverObjects.push({
    __parent: 'vegetation',
    class: 'GroundCover',
    name: 'mapng_lawn_cover',
    persistentId: generatePersistentId(),
    position: [0, 0, roundTo(centerHeight, 3)],
    material: 'mapng_gc_grass_mown',
    gridSize: gridSizeForElements(lawnElements),
    radius: varietyRadius,
    dissolveRadius: Math.max(50, roundTo(varietyRadius * 0.88, 3)),
    shapeCullRadius: varietyRadius,
    maxBillboardTiltAngle: 40,
    maxElements: lawnElements,
    seed: 41,
    ...varietyWind,
    Types: [
      { billboardUVs: [0, 0.0078125, 1, 0.464843988], layer: 'Lawn',
        clumpRadius: 1, maxClumpCount: 6, minClumpCount: 3, probability: 1,
        sizeMax: 0.16, sizeMin: 0.08, windScale: 0.05 },
      { billboardUVs: [0, 0.505124986, 1, 0.472656012], layer: 'Lawn',
        clumpRadius: 1, maxClumpCount: 5, minClumpCount: 2, probability: 0.8,
        sizeMax: 0.14, sizeMin: 0.07, windScale: 0.05 },
      {}, {}, {}, {}, {}, {},
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
 * @param {string}  [options.baseTexture='hybrid']         — 'none' | 'hybrid' | 'satellite' | 'osm' | 'game' | 'painted'
 * @param {boolean} [options.includeBuildings=true]         — include generated OSM 3D objects (.dae)
 * @param {boolean} [options.includeSidewalks=true]         — raised curbs + sidewalks along drawn roads (.dae)
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
// The export options worth keeping in mapng.json: plain settings only (no
// callbacks, keys, images or big data)
const STAMP_SKIP_OPTIONS = /^(on[A-Z]|.*(ApiKey|Key|Token|Secret)$|treeSpeciesMix$|appVersion$|platform$)/;
function stampOptions(options) {
  const out = {};
  for (const [k, v] of Object.entries(options || {})) {
    if (STAMP_SKIP_OPTIONS.test(k)) continue;
    if (v == null || ['string', 'number', 'boolean'].includes(typeof v)) out[k] = v;
    else if (Array.isArray(v) && v.length <= 32 && v.every((x) => x == null || ['string', 'number', 'boolean'].includes(typeof x))) out[k] = v;
  }
  // (the spawn and quicktravel points are objects, kept by name: Rebuild and
  // Modify in the desktop levels sidebar read them back from here)
  const points = sanitizePoints(options?.points);
  if (points.length) out.points = points;
  return out;
}

/** levels/<name>/mapng.json: the level's maker, version, area and settings. */
export function mapngLevelStamp({ terrainData, center, options = {}, levelName, worldSize }) {
  const td = terrainData || {};
  return {
    generator: 'MapNG',
    format: 1,
    appVersion: options.appVersion || null,
    platform: options.platform || 'web',
    build: typeof __BUILD_HASH__ !== 'undefined' ? __BUILD_HASH__ : null,
    buildTime: typeof __BUILD_TIME__ !== 'undefined' ? __BUILD_TIME__ : null,
    exportedAt: new Date().toISOString(),
    levelName,
    center: center ? { lat: Number(center.lat), lng: Number(center.lng) } : null,
    bounds: td.bounds || null,
    resolution: td.width || null,
    metersPerPixel: td.processingMetersPerPixel || 1,
    sizeMeters: Math.round((worldSize || 0) * 100) / 100,
    elevationSource: options.elevationSource || (td.sourceGeoTiffs?.source ?? null),
    options: stampOptions(options),
  };
}

/**
 * The six stages the export card shows (components/ui/StageLoader.vue), each
 * the export phases (beginStep) it covers, in the order they run.
 */
export const EXPORT_STEP_GROUPS = [
  { key: 'prepare', members: ['prepare', 'detail', 'lidar'] },
  { key: 'roads', members: ['roads', 'sidewalks', 'props'] },
  { key: 'terrain', members: ['texture', 'materials', 'ter', 'heightmap', 'thumbnail', 'backdrop'] },
  { key: 'buildings', members: ['buildings', 'water', 'furniture'] },
  { key: 'nature', members: ['vegetation'] },
  { key: 'package', members: ['assets', 'zip', 'compress'] },
];

export async function exportBeamNGLevel(terrainData, center, options = {}) {
  // Every module logs to the console (OSM, roads, bridges, buildings...); the
  // export keeps its share of that for export_report.txt.
  const jobLog = captureConsole();
  try {
    // The structure solver builds bridges, decks and the terrain around them
    // by default; structureSolver: 'v1' keeps today's bridge passes.
    const structureSolver = options.structureSolver ?? 'v2';
    return await runBeamNGLevelExport(terrainData, center, { ...options, structureSolver }, jobLog);
  } finally {
    jobLog.restore();
  }
}

async function runBeamNGLevelExport(terrainData, center, options, jobLog) {
  const {
    baseTexture = 'hybrid',
    includeBuildings = true,
    includeSidewalks = true,
    // the local tree mix (treeSpecies.js) when already known; undefined: fetched
    treeSpeciesMix: requestedTreeMix = undefined,
    // the slabs' concrete: a key of SIDEWALK_LOOKS (beamngSidewalks.js)
    sidewalkLook = DEFAULT_SIDEWALK_LOOK,
    includeBackdrop = false,
    includeBridges = true,
    includeTunnels = true,
    includeWater = true,
    seaLevelOffset = 0,
    includeNativeBarriers = true,
    // off: no content caps (buildings, barriers, lamps, trees ...): SAFE_CAPS
    safeCaps = true,
    includeTrees = true,
    // trees in woods, canopy and scrub: a key of FOREST_DENSITY
    forestDensity = 'normal',
    includeRocks = false,
    backdropElevationSource = 'global30m',
    backdropGpxzApiKey = '',
    // the backdrop's satellite imagery (services/backdropImagery.js) and the stitched
    // picture's limit where the export runs (a browser tab's; none given: the canvas's)
    backdropImagery = 'standard',
    backdropStitchLimit = 0,
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
  // Terrain shaping at export (advanced mode): a master switch and one per
  // kind of road. Off, the export leaves those heights exactly as generated.
  const shapingOptions = {
    terrain: options.shapeTerrain !== false,
    roads: options.shapeRoads !== false,
    bridges: options.shapeBridges !== false,
    overpasses: options.shapeOverpasses !== false,
    tunnels: options.shapeTunnels !== false,
  };
  const shaping = shapingSwitches(shapingOptions);
  const shapeExtras = shapingOptions.terrain && options.shapeExtras !== false;
  // fine ground detail on levels from the global 30 m (terrainDetail.js); never on lidar or uploads
  const shapeDetail = shapingOptions.terrain && options.shapeDetail !== false;
  // Backward compat: generatePbrMaterials (bool) → pbrSource (string)
  let pbrSource = options.pbrSource;
  if (pbrSource === undefined) {
    pbrSource = options.generatePbrMaterials === false ? 'none' : 'osm';
  }

  setSafeCaps(safeCaps !== false);
  setPaintSwitches({ markings: contentOn(options, 'markings'), crosswalks: contentOn(options, 'crosswalks') });
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
      includeBackdrop,
      includeWater,
      seaLevelOffset,
      includeNativeBarriers,
      safeCaps,
      includeTrees,
      includeRocks,
      backdropElevationSource,
      includeBridges,
      includeTunnels,
      shaping: { ...shaping, extras: shapeExtras, master: shapingOptions.terrain },
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
    fineDetail: shapeDetail && !!terrainData?.coarseElevation,
    bridgeLidar: roadType !== 'none' && includeBridges && options.lidarDecks !== false && (options.structureSolver ?? 'v2') === 'v2',
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
    onProgress?.({
      step, pct, elapsedMs: performance.now() - exportT0, completed,
      // for the stage card (EXPORT_STEP_GROUPS): the phase running, its share done, every phase's weight
      phase: currentStep?.phase ?? null, phaseFraction: Math.max(0, Math.min(1, fraction)), phaseWeights,
    });
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
  // (steps taken from the step cache, unchanged since the last export)
  const reusedSteps = [];

  beginStep('prepare', `Preparing ${terrainData.width}×${terrainData.height} terrain and ${Array.isArray(terrainData?.osmFeatures) ? terrainData.osmFeatures.length : 0} OSM features…`);
  await yield_();

  // What to build (services/buildContent.js): the OSM features of every
  // feature switched off, and the tags left out one by one, gone from the
  // export's data before anything is built
  const contentChoice = contentExportOptions(options.contentOff, options.excludeTags);
  const contentFilter = filterOsmByTags(terrainData?.osmFeatures, contentChoice.excludeTags);
  if (contentFilter.removed) {
    terrainData = { ...terrainData, osmFeatures: contentFilter.features };
    console.log(`${BEAMNG_EXPORT_SERVICE_LOG} What to build: ${contentChoice.contentOff.length} feature(s) off; ${contentFilter.removed} OSM features left out (${Object.entries(contentFilter.byTag).slice(0, 8).map(([k, n]) => `${k} ${n}`).join(', ')}).`);
  }
  const built = (id) => contentOn(options, id);
  // (footbridges switched off: gone with their stretch of path)
  {
    const fb = filterFootBridges(terrainData?.osmFeatures, options);
    if (fb.removed) {
      terrainData = { ...terrainData, osmFeatures: fb.features };
      console.log(`${BEAMNG_EXPORT_SERVICE_LOG} What to build: ${fb.removed} footbridge(s) left out.`);
    }
  }
  // (the water kinds switched off: rivers, lakes, the sea's coastline)
  {
    const w = filterWaterKinds(terrainData?.osmFeatures, options);
    if (w.removed) {
      terrainData = { ...terrainData, osmFeatures: w.features };
      console.log(`${BEAMNG_EXPORT_SERVICE_LOG} What to build: water left out: ${['rivers', 'lakes', 'sea'].filter((id) => !built(id)).join(', ')} (${w.removed} OSM features).`);
    }
  }

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

  // buildings standing on drawn roads: ML outlines left out, OSM ones cut
  // back from the lanes (buildingRoadConflicts.js), before anything is built
  // on or around them
  let buildingConflicts = null;
  let boundedFeatures = filterOSMFeaturesToBounds(td.osmFeatures, td.bounds);
  // Background areas (backgroundMask.js): the hills nobody drives keep their
  // shape, without buildings, trees, props or roads wholly inside them
  const bgMask = td.backgroundMask || options?.backgroundMask || null;
  const bgLook = bgMask ? backgroundLookup(bgMask, { n: 2048 }) : null;
  // No smoothing areas (the same mask's `raw` strokes): the roads there are
  // held on the ground as generated, never levelled into it
  const rawLook = bgMask ? rawWeightLookup(bgMask, { n: 2048 }) : null;
  const rawAtWorld = rawLook ? (() => {
    const b = td.bounds; const mb = bgMask.bounds; const ws = td.width * computeSquareSize(td);
    return (x, y) => {
      const lat = b.north - (0.5 - y / ws) * (b.north - b.south);
      const lng = b.west + (x / ws + 0.5) * (b.east - b.west);
      return rawLook.full((lng - mb.west) / (mb.east - mb.west), (mb.north - lat) / (mb.north - mb.south));
    };
  })() : null;
  const bgAtWorld = (() => {
    if (!bgLook) return () => false;
    const b = td.bounds; const mb = bgMask.bounds; const ws = td.width * computeSquareSize(td);
    return (x, y) => {
      const lat = b.north - (0.5 - y / ws) * (b.north - b.south);
      const lng = b.west + (x / ws + 0.5) * (b.east - b.west);
      return bgLook((lng - mb.west) / (mb.east - mb.west), (mb.north - lat) / (mb.north - mb.south));
    };
  })();
  // (a list of scene objects or spots, in place: those standing in background go)
  const keepOutOfBackground = (list) => {
    if (!bgLook || !Array.isArray(list)) return;
    const kept = list.filter((o) => { const p = o?.position || o?.pos; return !(Array.isArray(p) && bgAtWorld(Number(p[0]), Number(p[1]))); });
    list.length = 0; list.push(...kept);
  };
  if (bgLook && boundedFeatures?.length) {
    const before = boundedFeatures.length;
    boundedFeatures = filterFeaturesByBackground(boundedFeatures, bgLook, bgMask.bounds);
    console.log(`${BEAMNG_EXPORT_SERVICE_LOG} Background areas: ${Math.round(bgLook.fraction * 100)}% of the map; ${before - boundedFeatures.length} map feature(s) left out there.`);
  }
  // sidewalks OSM leaves unmapped where it maps a crossing onto them
  if (includeSidewalks && boundedFeatures?.length) {
    const b = td.bounds; const ws = td.width * computeSquareSize(td);
    const before = boundedFeatures;
    boundedFeatures = inferCrossingSidewalks(boundedFeatures, (p) => [((p.lng - b.west) / (b.east - b.west) - 0.5) * ws, (0.5 - (b.north - p.lat) / (b.north - b.south)) * ws]);
    const n = boundedFeatures.filter((f, i) => f !== before[i]).length;
    if (n) console.log(`${BEAMNG_EXPORT_SERVICE_LOG} Sidewalks: ${n} untagged street way(s) given sidewalks where crossings end beside them.`);
  }
  if (includeBuildings && boundedFeatures?.length) {
    const b = td.bounds; const ws = td.width * computeSquareSize(td);
    const project = (lat, lng) => [((lng - b.west) / (b.east - b.west) - 0.5) * ws, (0.5 - (b.north - lat) / (b.north - b.south)) * ws];
    const unproject = (x, y) => ({ lat: b.north - (0.5 - y / ws) * (b.north - b.south), lng: b.west + (x / ws + 0.5) * (b.east - b.west) });
    buildingConflicts = resolveBuildingRoadConflicts(boundedFeatures, { project, unproject, urbanAt: buildUrbanRoadClassifier(boundedFeatures) });
    boundedFeatures = buildingConflicts.features;
    if (buildingConflicts.dropped.length || buildingConflicts.clipped.length || buildingConflicts.flagged.length) {
      console.log(`${BEAMNG_EXPORT_SERVICE_LOG} Buildings on roads: ${buildingConflicts.dropped.length} ML outline(s) left out, ${buildingConflicts.clipped.length} OSM building(s) cut back from the lanes, ${buildingConflicts.flagged.length} largely on a road kept as mapped.`);
    }
  }
  const foundationInput = {
    ...td,
    osmFeatures: boundedFeatures,
    // (a given ground-class grid is of the uncropped area: classified again)
    groundClasses: didCropToSquare ? undefined : td.groundClasses,
  };

  // multi-storey car parks: the terrain graded to their flat ground deck
  let exportTerrainData = includeBuildings && shapeExtras
    ? await gradeGarageFootprints(foundationInput, isGarageFeature, { yieldFn: yield_ })
    : foundationInput;
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
    // (what covers the land: ESA WorldCover, read while generating)
    landCover: exportTerrainData.landCover || null,
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
  // the global 30 m holds nothing smaller than tens of metres: small relief by land cover and sharpened OSM cliffs,
  // on unbuilt ground only, before the roads are laid (they level their corridors over it) and before the ground is
  // taken as the level's own (sourceHeightMap). Never on the generated data itself: on the export's copy.
  let fineDetail = null;
  if (shapeDetail && terrainData?.coarseElevation && exportTerrainData.bounds) {
    const cliffLines = (exportTerrainData.osmFeatures || []).filter((f) => f.type === 'cliff').length;
    beginStep('detail', `Adding fine ground detail by land cover${cliffLines ? ` and sharpening ${cliffLines} mapped cliff line${cliffLines === 1 ? '' : 's'}` : ''} (global 30 m terrain)…`);
    await yield_();
    // (changed in place when the export already holds its own copy: no second full-size heightmap on 16k maps)
    const owned = exportTerrainData.heightMap !== terrainData?.heightMap;   // (Vue never proxies typed arrays)
    const d = addFineGroundDetail({ heightMap: exportTerrainData.heightMap, width: exportTerrainData.width, height: exportTerrainData.height, bounds: exportTerrainData.bounds, metersPerPixel: squareSize, osmFeatures: exportTerrainData.osmFeatures, inPlace: owned });
    exportTerrainData = { ...exportTerrainData, heightMap: d.heightMap };
    fineDetail = d.stats;
    console.log(`${BEAMNG_EXPORT_SERVICE_LOG} Fine ground detail: ${(d.stats.share * 100).toFixed(0)}% of the terrain, up to ${d.stats.maxAdd.toFixed(2)} m; ${d.stats.cliffs} mapped cliff(s) sharpened.`);
  }
  // measured bridge heights (US lidar), read before the roads are laid out
  // (its own step, before the roads step begins: the road layout's time was
  // reported as the lidar's)
  let lidar = null;
  if (includeRoads && includeBridges && options.lidarDecks !== false && (options.structureSolver ?? 'v2') === 'v2') {
    beginStep('lidar', 'Reading measured bridge heights (US lidar survey)…');
    try {
      lidar = await prefetchLidarDecks(exportTerrainData, squareSize, options, (k, n) => report(`Reading measured bridge heights (US lidar survey): node ${k + 1} of ${n}…`, n ? k / n : 0));
    } catch (err) {
      lidar = { skipped: `the survey could not be read (${err?.message || err})` };
    }
    console.log(`${BEAMNG_EXPORT_SERVICE_LOG} Lidar decks: ${lidar.skipped ? `skipped: ${lidar.skipped}` : `${lidar.dataset}, ${lidar.nodes} nodes, ${(lidar.bytes / 1e6).toFixed(1)} MB, ${lidar.points} points; datum ${lidar.datum.scale === 1 ? 'm' : 'ft'} ${lidar.datum.offset >= 0 ? '+' : ''}${lidar.datum.offset.toFixed(2)} m (spread ${lidar.datum.spread.toFixed(2)} m)`}`);
  }
  if (includeRoads) {
    const roadFeatureCount = (exportTerrainData.osmFeatures || []).filter((f) => f.type === 'road').length;
    beginStep('roads', `Laying out ${roadFeatureCount} OSM roads: DecalRoads, lane markings, junctions, bridge decks and tunnels${shapingOptions.terrain && shapingOptions.roads ? ', and shaping the terrain under them' : ' (terrain under them left as it is)'}…`);
    await yield_();
  }
  // the ground before any grading: where the sea really is (a cut below sea
  // level is no sea)
  const sourceHeightMap = exportTerrainData.heightMap;

  const decalRoads = includeRoads
    ? await generateDecalRoadsYielding(exportTerrainData, squareSize, yield_, { raisedFootways: includeSidewalks, structureSolver: options.structureSolver, includeBridges, includeTunnels, includeDams: includeBuildings && options.includeDams !== false, includeRailways: options.includeRailways !== false, shaping: shapingOptions, lidar: lidar?.grid ? lidar : null, rawAt: rawAtWorld })
    : [];
  // Bridges: decks for the bridge roads; nothing ground-bound (sidewalks,
  // props, lamps) is built along them, nothing tall stands up into them.
  // Structure solver v2 terrain (stage E), behind a test switch until the
  // bridge and tunnel objects come from the solver too: the terrain the
  // solved roads need, composed and written in one pass over the result.
  const sg = decalRoads.structureGraph;
  // v2: bridge decks from the solver's deck stretches, every road decal at
  // its solved height (the terrain is composed just below)
  if (options.structureSolver === 'v2' && sg?.classes) {
    // the solver's widths up to the widths the roads are drawn at (shoulders,
    // parking lanes): the terrain cores and decks must cover the drawn road
    const drawnHalf = new Map();
    for (const cw of decalRoads.carriageways || []) drawnHalf.set(cw.owner, Math.max(drawnHalf.get(cw.owner) || 0, cw.half || 0));
    for (const e of sg.edges) { const h = drawnHalf.get(e.seg); if (h > e.half) e.half = h; }
    // (a dam with a road on it shaped round that road: services/dams.js)
    if (sg.dams?.length) assignDamAxes(sg);
    const decks = decksFromSolver(sg);
    const parts = decks.flatMap((d) => d.parts);
    sg.built = true;
    decalRoads.bridges.decks = decks;
    decalRoads.bridges.roadLines = roadLinesFromSolver(sg);
    decalRoads.bridges.partInfo = parts.map((p) => ({ ...p.osm, structure: p.structure ?? null, landing: false, carried: false }));
    // the carriageways on the solver's decks are bridges: split where a
    // road's deck stretch begins and ends (today's builder flags them as it
    // lays them; a v2 deck's road came out as ground: sidewalks and quays
    // built beside the deck, rivers cut under every bridge)
    if (Array.isArray(decalRoads.carriageways)) {
      const split = splitOnDecks(decalRoads.carriageways, parts, sg.edges);
      decalRoads.carriageways.splice(0, decalRoads.carriageways.length, ...split);
    }
    // (tunnels still come from today's builder: their roads keep its heights)
    const applied = applySolvedHeights(decalRoads, sg, { skipOwners: new Set(decalRoads.tunnels?.bySeg?.keys?.() || []) });
    console.log(`${BEAMNG_EXPORT_SERVICE_LOG} Structure solver v2: ${decks.length} deck(s) of ${parts.length} part(s); ${applied.nodes} road nodes in ${applied.decals} decals at their solved heights.`);
    await yield_();
  }
  if ((options.structureSolver === 'v2-terrain' || options.structureSolver === 'v2') && sg?.classes) {
    const t0 = performance.now();
    // (the ground today's tunnels dug out, their cuttings, is theirs: only a
    // road's own surface is composed over it; their fill and cover is
    // composed as any ground)
    const tunnelGraded = decalRoads.tunnels?.graded;
    const composed = composeTerrain(sg, {
      heightMap: exportTerrainData.heightMap, width: exportTerrainData.width, height: exportTerrainData.height,
      worldSize: exportTerrainData.width * squareSize, minHeight: Number(exportTerrainData.minHeight) || 0,
      keep: tunnelGraded?.size ? (idx) => tunnelGraded.has(idx) : null,
      tube: decalRoads.tunnels?.tube?.size ? (idx) => decalRoads.tunnels.tube.has(idx) : null,
      skip: sg.shaping?.skip || null,
    });
    const hm = heightMapEditor(exportTerrainData);
    // (nothing composed inside a dam: the terrain there as the data has it)
    const inDam = sg.dams?.length ? (() => {
      const W = exportTerrainData.width; const H = exportTerrainData.height; const ws = W * squareSize;
      return (idx) => damAt(sg.dams, ((idx % W) / W - 0.5) * ws, (0.5 - (Math.floor(idx / W) + 1) / H) * ws);
    })() : null;
    composed.apply((idx, v) => { if (!inDam?.(idx)) hm.set(idx, v); });
    sg.terrain = { ...composed.stats, ms: Math.round(performance.now() - t0) };
    sg.terrain.surface = checkRoadSurface(sg.previewLines || [], (x, y) => getTerrainHeightAtWorldXY(x, y, exportTerrainData, squareSize));
    if (globalThis.__MAPNG_STRUCT_DEBUG) globalThis.__MAPNG_STRUCT_DEBUG(sg, { decalRoads, groundAt: (x, y) => getTerrainHeightAtWorldXY(x, y, exportTerrainData, squareSize) });
    console.log(`${BEAMNG_EXPORT_SERVICE_LOG} Structure solver v2 terrain: ${composed.stats.pixels} pixels in ${composed.stats.corridors} corridors, ${composed.stats.capped} held under decks, ${sg.terrain.ms} ms.`);
    await yield_();
  }
  // Railways (services/railways.js, railTrack.js): the track on the solved
  // profiles, the crossings' surfaces and the trams in their streets
  let railways = null;
  if (options.structureSolver === 'v2' && sg?.railSegments && sg.classes && sg.profile) {
    try {
      railways = buildLevelRailways(sg, exportTerrainData, squareSize, levelName);
      if (railways.decals.length) decalRoads.push({ class: 'SimGroup', name: 'railways', persistentId: generatePersistentId(), __parent: 'Decal_Roads', __items: railways.decals });
      console.log(`${BEAMNG_EXPORT_SERVICE_LOG} Railways: ${railways.stats.trackKm} km of track, ${railways.daes.length} object(s), ${railways.stats.triangles} triangles, ${railways.stats.crossings} level crossing(s), ${railways.stats.streetTramKm} km of tram in streets.`);
    } catch (err) {
      console.warn(`${BEAMNG_EXPORT_SERVICE_LOG} Railway track skipped: ${err?.message || err}`);
      railways = null;
    }
    await yield_();
  }
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
  await yield_();
  // water under the decks: its bed carved there (the elevation data often
  // holds the deck itself, a dam the river hid in), before the bridges are
  // built over it (their arches spring from the bed)
  // (each part's drawn half widths per point: decks widen where they join and fork)
  for (const d of bridgeDecks) deckEdges(d).forEach((e, i) => { d.parts[i].halfL = e.hl; d.parts[i].halfR = e.hr; });
  let underDeckBeds = 0;
  let lampGlowCount = 0;   // (street lamps' night glows, lampGlow.js)
  // the ground roads the rivers keep off and the lake beds' quays (a deck's
  // stretch is no ground carriageway: splitOnDecks)
  const riverRoads = () => groundCarriageways.map((c) => ({ points: c.nodes, half: c.half }));
  let deckCover = null;
  const W0 = exportTerrainData.width; const H0 = exportTerrainData.height;
  if (bridgeDecks.length > 0) {
    const W = W0; const H = H0; const worldSize = W * squareSize;
    const covered = new Uint8Array(W * H);
    for (const d of bridgeDecks) {
      const edges = deckEdges(d);
      d.parts.forEach((p, pi) => {
        for (let i = 0; i + 1 < p.xy.length; i++) {
          const [ax, ay] = p.xy[i]; const [bx, by] = p.xy[i + 1];
          const reach = Math.max(edges[pi].hl[i], edges[pi].hr[i], edges[pi].hl[i + 1], edges[pi].hr[i + 1]) + PARAPET_W_M + 1;
          const L = Math.hypot(bx - ax, by - ay); const n = Math.max(1, Math.ceil(L / (squareSize * 0.5)));
          for (let k = 0; k <= n; k++) {
            const x = ax + ((bx - ax) * k) / n; const y = ay + ((by - ay) * k) / n;
            const cc = (x / worldSize + 0.5) * W; const rr = ((0.5 - y / worldSize) * H - 1); const rp = reach / squareSize;
            for (let r = Math.max(0, Math.floor(rr - rp)); r <= Math.min(H - 1, Math.ceil(rr + rp)); r++) {
              for (let c = Math.max(0, Math.floor(cc - rp)); c <= Math.min(W - 1, Math.ceil(cc + rp)); c++) if (Math.hypot(c - cc, r - rr) <= rp) covered[r * W + c] = 1;
            }
          }
        }
      });
    }
    deckCover = covered;
  }
  // the rivers planned once, on the ground before any bed is dug (planned
  // after the lake beds, a canal through a lake took its surface from the
  // bed: 1.3 m under the lake beside it)
  let riverPlan = null;
  if (includeWater) {
    try {
      riverPlan = planRivers({
        features: exportTerrainData.osmFeatures || [],
        toWorld: (lat, lng) => geoToWorldPoint(lat, lng, exportTerrainData, squareSize, 0),
        heightAt: (x, y) => getTerrainHeightAtWorldXY(x, y, exportTerrainData, squareSize),
        roads: riverRoads(),
      });
    } catch (err) {
      console.warn(`${BEAMNG_EXPORT_SERVICE_LOG} Rivers not planned: ${err?.message || err}`);
    }
  }
  // the deck's own shape in the elevation data levelled away under it (a dam
  // over the sea, a lake, a valley), its ends on their abutments' fill left
  let levelledUnderDecks = 0;
  const loweredUnderDecks = new Set();   // (for the remnant fill after the beds)
  if (bridgeDecks.length > 0 && shapingOptions.terrain && shapingOptions.bridges) {
    try {
      // where water lies beside a deck: the sea, a lake, a river's width
      const seaLocal = -(Number(exportTerrainData.minHeight) || 0) + (Number(seaLevelOffset) || 0);
      const lakePolys = includeWater ? planLakes({
        features: exportTerrainData.osmFeatures || [],
        toWorld: (lat, lng) => geoToWorldPoint(lat, lng, exportTerrainData, squareSize, 0),
        heightAt: (x, y) => getTerrainHeightAtWorldXY(x, y, exportTerrainData, squareSize),
      }).lakes.map((l) => l.poly) : [];
      const riverSegs = (riverPlan?.rivers || []).flatMap((r) => r.nodes.slice(0, -1).map((a, i) => [a, r.nodes[i + 1]]));
      const wet = (x, y) => {
        if (getTerrainHeightAtWorldXY(x, y, exportTerrainData, squareSize) <= seaLocal + 0.5) return true;
        if (lakePolys.some((p) => p.contains(x, y))) return true;
        return riverSegs.some(([a, b]) => {
          const vx = b[0] - a[0]; const vy = b[1] - a[1]; const L2 = vx * vx + vy * vy || 1e-9;
          const t = Math.max(0, Math.min(1, ((x - a[0]) * vx + (y - a[1]) * vy) / L2));
          return Math.hypot(a[0] + vx * t - x, a[1] + vy * t - y) <= (a[3] + (b[3] - a[3]) * t) / 2 + 1;
        });
      };
      // (ground roads and their sidewalks keep their ground)
      const keepRoads = buildCarriagewayIndex(groundCarriageways.map((cw) => ({ ...cw, half: (cw.half || 3) + LAKE_KEEP_M })));
      const lev = levelUnderDecks(bridgeDecks, {
        heightMap: exportTerrainData.heightMap, width: W0, height: H0, worldSize: W0 * squareSize, minHeight: Number(exportTerrainData.minHeight) || 0,
      }, (x, y) => isOnOtherCarriageway(keepRoads, x, y, 0, () => false), PARAPET_W_M, wet);
      const hmLev = heightMapEditor(exportTerrainData);
      lev.apply((idx, v) => hmLev.set(idx, v));
      for (const i of lev.indices()) loweredUnderDecks.add(i);
      levelledUnderDecks = lev.pixels;
    } catch (err) {
      console.warn(`${BEAMNG_EXPORT_SERVICE_LOG} Levelling under decks skipped: ${err?.message || err}`);
    }
  }
  if (includeWater && shapeExtras && deckCover && riverPlan) {
    try {
      const W = W0; const H = H0; const worldSize = W * squareSize;
      const covered = deckCover;
      const heightAt = (x, y) => getTerrainHeightAtWorldXY(x, y, exportTerrainData, squareSize);
      const toWorld = (lat, lng) => geoToWorldPoint(lat, lng, exportTerrainData, squareSize, 0);
      const { rivers } = riverPlan;
      // (ground roads and a margin keep their ground: quays, a bridge's approach)
      const bedKeep = buildCarriagewayIndex(groundCarriageways.map((cw) => ({ ...cw, half: (cw.half || 3) + LAKE_KEEP_M })));
      // (under a deck: the approach road and its sidewalks, no quay margin past them)
      const bedKeepTight = buildCarriagewayIndex(groundCarriageways.map((cw) => ({ ...cw, half: (cw.half || 3) + 2.5 })));
      const { lakes } = planLakes({ features: exportTerrainData.osmFeatures || [], toWorld, heightAt });
      const beds = carveWaterUnderDecks({ rivers, lakes }, {
        heightMap: exportTerrainData.heightMap, width: W, height: H, worldSize, minHeight: Number(exportTerrainData.minHeight) || 0,
      }, (idx) => covered[idx] === 1, (x, y) => isOnOtherCarriageway(bedKeep, x, y, 0, () => false),
      // (under a deck only the approach road and its sidewalks: the quay margin left a dam at the bridge's ends)
      (x, y) => isOnOtherCarriageway(bedKeepTight, x, y, 0, () => false));
      const hmBed = heightMapEditor(exportTerrainData);
      beds.apply((idx, v) => hmBed.set(idx, v));
      for (const i of beds.indices()) loweredUnderDecks.add(i);
      underDeckBeds = beds.pixels;
      // single pixels left standing among the lowered ones (shards on the banks)
      const toW = (c, r) => [((c / W) - 0.5) * worldSize, (0.5 - (r + 1) / H) * worldSize];
      const rem = fillRemnants(exportTerrainData.heightMap, W, H, loweredUnderDecks, {
        keep: (c, r) => { const [x, y] = toW(c, r); return isOnOtherCarriageway(bedKeep, x, y, 0, () => false); },
      });
      rem.apply((idx, v) => hmBed.set(idx, v));
      underDeckBeds += rem.pixels;
      if (sg) sg.underDeckBeds = beds.pixels;
    } catch (err) {
      console.warn(`${BEAMNG_EXPORT_SERVICE_LOG} Water beds under decks skipped: ${err?.message || err}`);
    }
  }
  // what each bridge is (bridgeStyles.js): from its road's tags or its outline's
  const bridgeOutlines = (exportTerrainData.osmFeatures || [])
    .filter((f) => f.type === 'bridge_infra' && f.geometry?.length > 2)
    .map((f) => ({ ring: f.geometry.map((p) => geoToWorldPoint(p.lat, p.lng, exportTerrainData, squareSize, 0)), tags: f.tags || {} }));
  const styledBridges = styleDecks(bridgeDecks, { outlines: bridgeOutlines, groundAt: (x, y) => getTerrainHeightAtWorldXY(x, y, exportTerrainData, squareSize) });
  // buildings that are part of a bridge (a drawbridge's tower houses, services/bridgeTowers.js): their
  // houses at the deck's height (copies of their features for the building pass), their piers drawn
  // with the bridge
  const bridgeTowers = bridgeDecks.length ? findBridgeTowers({
    buildings: (exportTerrainData.osmFeatures || [])
      .filter((f) => f.type === 'building' && f.geometry?.length > 2)
      .map((f) => ({ f, ring: f.geometry.map((p) => geoToWorldPoint(p.lat, p.lng, exportTerrainData, squareSize, 0)) })),
    outlines: bridgeOutlines,
    decks: bridgeDecks,
    groundAt: (x, y) => getTerrainHeightAtWorldXY(x, y, exportTerrainData, squareSize),
    wetAt: buildWaterLookup(exportTerrainData, squareSize),
  }) : [];
  const bridgeTowerHouses = bridgeTowers.length ? new Map(bridgeTowers.map((t) => [t.f, { ...t.f, tags: towerHouseTags(t) }])) : null;
  // buildings over tunnel portals (services/portalBuildings.js): on the portal, the bores opening under
  // them, not walls down to the road across the mouth
  const portalBuildings = tunnelList.length ? findPortalBuildings({
    buildings: (exportTerrainData.osmFeatures || [])
      .filter((f) => f.type === 'building' && f.geometry?.length > 2 && !bridgeTowerHouses?.has(f))
      .map((f) => ({ f, ring: f.geometry.map((p) => geoToWorldPoint(p.lat, p.lng, exportTerrainData, squareSize, 0)) })),
    tunnels: tunnelList,
    groundAt: (x, y) => getTerrainHeightAtWorldXY(x, y, exportTerrainData, squareSize),
  }) : [];
  if (portalBuildings.length) console.log(`${BEAMNG_EXPORT_SERVICE_LOG} Buildings over tunnel portals: ${portalBuildings.length}, raised onto the portals.`);
  const liftedBuildings = bridgeTowerHouses || portalBuildings.length ? new Map([...(bridgeTowerHouses || []), ...portalBuildings.map((pb) => [pb.f, { ...pb.f, tags: portalBuildingTags(pb) }])]) : null;
  for (const t of bridgeTowers) (t.deck.towers ||= []).push(t);
  if (bridgeTowers.length) console.log(`${BEAMNG_EXPORT_SERVICE_LOG} Bridge tower houses: ${bridgeTowers.length} (${bridgeTowers.filter((t) => t.pier).length} on piers of their own).`);
  linkCrossings(bridgeDecks, { roads: groundCarriageways.map((cw) => ({ xy: cw.nodes, half: cw.half })) });
  // (a deck arch's road on its vault: a thin slab, no girders in the vault)
  thinArchDecks(bridgeDecks);
  if (styledBridges) console.log(`${BEAMNG_EXPORT_SERVICE_LOG} Bridge styles: ${bridgeDecks.filter((d) => d.style).map((d) => d.style.type).join(', ')}.`);
  // sidewalks mapped on a bridge: its deck wide enough, the parapets outside them
  if (includeSidewalks) widenDecksForSidewalks(bridgeDecks, buildDeckPaths(exportTerrainData, squareSize));
  // (a bridge mapped as a way per carriageway or deck: one steel arch or truss over them all; after the
  // widths are final, its ribs outside the outer edges)
  const archTwins = linkArchCrossings(bridgeDecks, { groundAt: (x, y) => getTerrainHeightAtWorldXY(x, y, exportTerrainData, squareSize) });
  if (archTwins) console.log(`${BEAMNG_EXPORT_SERVICE_LOG} Bridge arches/trusses over twin decks: ${archTwins} run(s) drawn under their crossing's one structure.`);
  const bridgeDaes = generateBridgeDAEs(
    bridgeDecks,
    (x, y) => getTerrainHeightAtWorldXY(x, y, exportTerrainData, squareSize),
    decalRoads.bridges?.roadLines || [],
    // the drawn ground roads (a deck's parapet standing on one at its height,
    // where the street climbs onto the deck, is left out)
    groundCarriageways.map((cw) => ({ xy: cw.nodes.map((nd) => [nd[0], nd[1]]), z: cw.nodes.map((nd) => nd[2]), half: cw.half })),
    // dams' crest tops (their walls are in the building tiles)
    (decalRoads.structureGraph?.dams || []).map((d) => damTopGeometry(d)),
  );
  if (bridgeDecks.length > 0) {
    console.log(`${BEAMNG_EXPORT_SERVICE_LOG} Bridges: ${bridgeDecks.length} deck(s), ${decalRoads.bridges?.ramps ?? 0} approach embankment(s), ${bridgeDaes.reduce((n, d) => n + d.triangles, 0)} triangles, one object per bridge.`);
  }
  await yield_();
  const tunnelDaes = generateTunnelDAEs(tunnelList);
  await yield_();
  const tunnelGroups = buildTunnelGroups(tunnelList, tunnelDaes, levelName);
  if (tunnelList.length > 0) {
    console.log(`${BEAMNG_EXPORT_SERVICE_LOG} Tunnels: ${tunnelList.length} bored, ${tunnelDaes.length} object(s), ${tunnelDaes.reduce((n, d) => n + d.triangles, 0)} triangles, ${tunnelGroups.lightCount} lights, ${tunnelGroups.zoneCount} zones.`);
  }
  if (includeRoads && includeSidewalks) {
    beginStep('sidewalks', `Building sidewalks, curbs and ramps along ${groundCarriageways.length} carriageways${bridgeDecks.length ? ` (${bridgeDecks.length} bridge decks built)` : ''}…`);
    await yield_();
  }
  // (the walkway tops on worker threads in the desktop app; here otherwise)
  const sidewalks = includeRoads && includeSidewalks
    ? await buildSidewalkMeshesParallel(groundCarriageways, {
      zones: decalRoads.crosswalkZones || [],
      // building footprints at ground level: no slab into a wall
      buildings: (exportTerrainData.osmFeatures || [])
        .filter((f) => f.type === 'building' && f.geometry?.length > 2 && !isRaisedBuildingPart(f.tags))
        .map((f) => f.geometry.map((p) => geoToWorldPoint(p.lat, p.lng, exportTerrainData, squareSize, 0))),
      // driveways and parking aisles: the curb lowered where they cross
      driveways: (exportTerrainData.osmFeatures || [])
        .filter((f) => f.type === 'road' && f.tags?.highway === 'service' && f.geometry?.length > 1)
        .map((f) => f.geometry.map((p) => geoToWorldPoint(p.lat, p.lng, exportTerrainData, squareSize, 0))),
      footways: sidewalkFootways(exportTerrainData.osmFeatures, (p) => geoToWorldPoint(p.lat, p.lng, exportTerrainData, squareSize, 0)),
      // ground mapped as something other than pavement (parks, grass,
      // gardens, water, sports grounds): no sidewalk laid over it from a curb
      openGround: (exportTerrainData.osmFeatures || [])
        .filter((f) => f.geometry?.length > 2 && isOpenGround(f.tags || {}))
        .map((f) => f.geometry.map((p) => geoToWorldPoint(p.lat, p.lng, exportTerrainData, squareSize, 0))),
      // houses: the ground between one and the curb is its front lawn
      // (a small plain building=yes one too: most houses are mapped so)
      houses: (exportTerrainData.osmFeatures || [])
        .filter((f) => f.type === 'building' && f.geometry?.length > 2 && (HOUSE_BUILDINGS.has(f.tags?.building) || f.tags?.building === 'yes'))
        .map((f) => f.geometry.map((p) => geoToWorldPoint(p.lat, p.lng, exportTerrainData, squareSize, 0)))
        .filter((ring) => HOUSE_RING_MAX_M2 >= Math.abs(ring.reduce((a, p, i) => { const q = ring[(i + 1) % ring.length]; return a + p[0] * q[1] - q[0] * p[1]; }, 0) / 2)),
      // car parks: a bare curb opens along one right at the street
      parking: (exportTerrainData.osmFeatures || [])
        .filter((f) => f.tags?.amenity === 'parking' && f.geometry?.length > 2 && !['underground', 'multi-storey', 'rooftop'].includes(f.tags.parking))
        .map((f) => f.geometry.map((p) => geoToWorldPoint(p.lat, p.lng, exportTerrainData, squareSize, 0))),
      // walls mapped as areas: a concrete deck across the top
      wallAreas: (exportTerrainData.osmFeatures || [])
        .filter((f) => f.type === 'barrier' && f.tags?.area === 'yes' && ['wall', 'city_wall', 'retaining_wall'].includes(f.tags.barrier) && f.geometry?.length > 3)
        .map((f) => f.geometry.map((p) => geoToWorldPoint(p.lat, p.lng, exportTerrainData, squareSize, 0))),
      // walls a sidewalk runs along: the gap decked out to them
      walls: (exportTerrainData.osmFeatures || [])
        .filter((f) => ['retaining_wall', 'wall', 'city_wall'].includes(f.tags?.barrier) && f.geometry?.length > 1)
        .map((f) => f.geometry.map((p) => geoToWorldPoint(p.lat, p.lng, exportTerrainData, squareSize, 0))),
      // mapped water: a wall with it behind is a seawall, decked out to from a promenade
      water: (exportTerrainData.osmFeatures || [])
        .filter((f) => (f.tags?.natural === 'water' || f.tags?.waterway === 'riverbank') && f.geometry?.length > 3)
        .map((f) => f.geometry.map((p) => geoToWorldPoint(p.lat, p.lng, exportTerrainData, squareSize, 0))),
      // piers and footbridges: decks clear of the ground (and sidewalks on road bridges)
      decks: buildDeckPaths(exportTerrainData, squareSize),
      // (a road bridge's own deck: its road's line, at the deck's height)
      // (its layer: a path mapped on another layer, a low crossing under it, is not on it)
      bridgeRoads: bridgeDecks.flatMap((d, di) => d.parts.filter((part) => part.xy?.length > 1).map((part, i) => ({
        owner: `deck_${di}_${i}`, half: part.half || 4, tags: Number.isFinite(part.layer) ? { layer: String(part.layer) } : {},
        nodes: part.xy.map(([x, y]) => [x, y, deckHeightAt(part, x, y)]),
      }))),
      seaZ: -(Number(exportTerrainData.minHeight) || 0) + (Number(seaLevelOffset) || 0),
      // the sidewalks away from the curb: raised over their decals
      walks: decalRoads.footpaths,
      sidewalkLook,
      // (paving stones laid as the streets' decals lay them: red brick in the Americas)
      americas: getMarkingStyle(exportTerrainData.roadRules) === 'americas',
      groundAt: (x, y) => getTerrainHeightAtWorldXY(x, y, exportTerrainData, squareSize),
    })
    : { meshes: [], runs: [], triangles: 0 };
  if (sidewalks.runs.length > 0 && shapeExtras) {
    // the ground under the slabs (they hang at road height + the curb)
    const graded = gradeSidewalkGround([...sidewalks.runs, ...sidewalks.walkRuns, ...sidewalks.cornerRuns, ...sidewalks.cornerGround], groundCarriageways, {
      heightMap: exportTerrainData.heightMap, width: exportTerrainData.width, height: exportTerrainData.height,
      worldSize: exportTerrainData.width * squareSize, minHeight: Number(exportTerrainData.minHeight) || 0,
    }, { overhead: underDeck });
    const hmSide = heightMapEditor(exportTerrainData);
    graded.apply((idx, v) => hmSide.set(idx, v));
    lowerUnderWallDecks(sidewalks.wallDecks, {
      heightMap: exportTerrainData.heightMap, width: exportTerrainData.width, height: exportTerrainData.height,
      worldSize: exportTerrainData.width * squareSize, minHeight: Number(exportTerrainData.minHeight) || 0,
    }, (idx, v) => hmSide.set(idx, v));
    sidewalks.groundPixels = graded.pixels;
    console.log(`${BEAMNG_EXPORT_SERVICE_LOG} Sidewalks: ${sidewalks.runs.length} curb runs, ${(sidewalks.medianRuns || []).length} median island runs, ${(sidewalks.pockets || []).length} paved pockets by seawalls, ${sidewalks.triangles} triangles in ${sidewalks.meshes.length} mesh(es).`);
  }

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
      countryPoles: roadsidePolesRegion(center.lat, center.lng),
      isBlocked: underDeck,
      lat: center.lat, lon: center.lng,
      maxPoles: caps.poles,
    })
    : { hydrants: [], bins: [], benches: [], poles: [], wires: [] };
  // (for the report: whether pole lines were added along country roads here)
  streetProps.countryPoles = includeRoads && roadsidePolesRegion(center.lat, center.lng);
  // What to build: the ones switched off (placed along the streets as well as mapped)
  if (!built('hydrants')) streetProps.hydrants = [];
  if (!built('bins')) streetProps.bins = [];
  if (!built('benches')) streetProps.benches = [];
  if (!built('poles')) { streetProps.poles = []; streetProps.wires = []; }
  if (!built('lamps')) for (const pole of streetProps.poles) pole.lamp = false;
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
  // carports: Italy's carport model tiled over each carport footprint
  const carportObjects = planCarports(exportTerrainData.osmFeatures || [], (lat, lng) => geoToWorldPoint(lat, lng, exportTerrainData, squareSize, 0))
    .map((t, i) => ({
      __parent: 'carports',
      class: 'TSStatic',
      name: `carport_${i + 1}`,
      persistentId: generatePersistentId(),
      position: [roundTo(t.x, 3), roundTo(t.y, 3), roundTo(getTerrainHeightAtWorldXY(t.x, t.y, exportTerrainData, squareSize), 3)],
      rotationMatrix: rotationMatrixFromYaw(t.yaw),
      scale: t.scale.map((v) => roundTo(v, 4)),
      shapeName: CARPORT_SHAPE.shapeFile,
      collisionType: 'Collision Mesh',
      useInstanceRenderData: true,
    }));
  if (carportObjects.length) console.log(`${BEAMNG_EXPORT_SERVICE_LOG} Carports: ${carportObjects.length} carport module(s).`);
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
  // (signs switched off in What to build: none)
  const curveWarnings = includeRoads && built('signs')
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
  // (the texture by the name the export panel gives it)
  const baseTextureName = { osm: 'OSM', game: 'Game', hybrid: 'satellite hybrid', satellite: 'satellite', painted: 'touched-up', none: 'plain' }[baseTexture] || baseTexture;
  beginStep('texture', `Generating the ${baseTextureName} base texture for the ${size}×${size} terrain…`);
  await yield_();
  // The base texture may be finer than the grid (2× up to 4096 grids, as
  // west_coast_usa: 2048 grid, 4096 base). Use that size only when the chosen
  // texture carries the detail; the OSM texture and older 1× textures stay at
  // the grid size. *BaseTexSize spans stay in grid squares either way.
  let texBlob = await getTerrainTextureBlob(exportTerrainData, baseTexture);
  report(`Fitting the base texture to the ${size}×${size} grid${texBlob ? ` (${formatBytes(texBlob.size)} source)` : ''}…`, 0.75);
  const fittedTexture = await fitBaseTexture(texBlob, size, {
    allowFiner: baseTexture !== 'none' && baseTexture !== 'osm' && baseTexture !== 'game',
  });
  texBlob = fittedTexture.blob;
  const terrainBaseTexSize = fittedTexture.size;

  // Legacy image-based inference is no longer generated and now falls back to OSM.
  const imageCanvas = null;
  const effectivePbrSource = (pbrSource === 'image' && !imageCanvas) ? 'osm' : pbrSource;

  // Satellite-based textures show where unmapped ground is vegetated.
  // (the game map paints the ground it classified: its greens are the grass)
  const vegetationMask = effectivePbrSource === 'osm' && ['hybrid', 'satellite', 'painted', 'game'].includes(baseTexture)
    ? await buildVegetationMask(texBlob)
    : null;

  // the satellite classified (the game texture's classes): green residential
  // yards for the Lawn paint here, tree crowns for the canopy trees later
  if (!exportTerrainData.groundClasses && exportTerrainData.satelliteTextureUrl && (includeTrees || effectivePbrSource === 'osm')) {
    try {
      exportTerrainData.groundClasses = await satelliteGroundClasses(exportTerrainData);
    } catch (e) {
      console.warn(`${BEAMNG_EXPORT_SERVICE_LOG} Satellite ground classes unavailable:`, e?.message || e);
    }
  }

  // parking spaces (city.sites.json) now: the terrain paints their bays
  const parkingSpots = buildParkingSpots(exportTerrainData, squareSize, decalRoads.carriageways || [], {
    crosswalkZones: decalRoads.crosswalkZones || [],
    leftHandTraffic: !!exportTerrainData.roadRules?.leftHandTraffic,
  });
  keepOutOfBackground(parkingSpots);
  // multi-storey car parks (beamngBuildings.js): a spot per bay on every
  // deck (their lines are painted in the mesh) and ceiling lights
  const garage = includeBuildings
    ? garageExtras(exportTerrainData.osmFeatures || [], (lat, lng) => geoToWorldPoint(lat, lng, exportTerrainData, squareSize, 0))
    : { spots: [], lights: [] };
  for (const g of garage.spots) {
    const spot = {
      name: `garage_parking_${parkingSpots.length + 1}`,
      pos: [roundTo(g.x, 3), roundTo(g.y, 3), roundTo(g.z, 3)],
      rot: [0, 0, roundTo(Math.sin(g.yaw / 2), 6), roundTo(Math.cos(g.yaw / 2), 6)],
      scl: [g.w, g.l, 3],
      color: [1, 1, 1],
      customFields: { names: {}, tags: {}, types: {}, values: {} },
      isMultiSpot: false,
      oldId: 100000 + parkingSpots.length,
    };
    Object.defineProperty(spot, 'unmarked', { value: true });
    parkingSpots.push(spot);
  }
  const garageLightObjects = garage.lights.map((l, i) => ({
    ...GARAGE_LIGHT_TEMPLATE,
    __parent: 'garage_lights',
    name: `garage_light_${i + 1}`,
    persistentId: generatePersistentId(),
    position: [roundTo(l.x, 3), roundTo(l.y, 3), roundTo(l.z, 3)],
  }));
  if (garage.spots.length) console.log(`${BEAMNG_EXPORT_SERVICE_LOG} Garages: ${garage.spots.length} deck spaces, ${garageLightObjects.length} ceiling lights.`);
  // (and the trees keep out of them)
  exportTerrainData.parkingBayRings = parkingSpots.filter((sp) => sp.ground).map((sp) => sp.ground.corners);

  beginStep('materials', effectivePbrSource !== 'none'
    ? `Painting terrain materials from OSM land use (${size}×${size} layer map)…`
    : 'Writing the default terrain material…');
  // (kept in the step cache by everything it reads: the shaped terrain, the
  // level's name and look, the base texture's vegetation, the parking bays)
  const stepCode = options.stepCodeVersion || STEP_CODE_BUILD;
  const materialBays = parkingSpots.filter((sp) => sp.ground && !sp.ground.inLot).map((sp) => sp.ground);
  const materialsKey = effectivePbrSource !== 'none' && stepCode
    ? stepHash('materials', STEP_CACHE_VERSION, stepCode, terrainFingerprint(exportTerrainData), worldSize, levelName, jsonOf(biome), terrainBaseTexSize,
      effectivePbrSource, ArrayBuffer.isView(vegetationMask) ? vegetationMask : (vegetationMask?.data || vegetationMask?.mask || jsonOf(vegetationMask ?? null)), jsonOf(materialBays))
    : null;
  const { value: pbrResult, reused: materialsReused } = effectivePbrSource !== 'none'
    ? await cachedStep(options.stepCache || null, materialsKey, () => buildTerrainMaterials(exportTerrainData, worldSize, levelName, biome, terrainBaseTexSize, {
        pbrSource: effectivePbrSource,
        imageCanvas,
        vegetationMask,
        groundClasses: exportTerrainData.groundClasses,
        parkingBays: materialBays,
      }))
    : { value: null, reused: false };
  if (materialsReused) { reusedSteps.push('materials'); console.log(`${BEAMNG_EXPORT_SERVICE_LOG} Terrain materials reused from the last export (step cache).`); }

  // Standing water planned before the terrain is written: lakes whose
  // ground the elevation data records at the water's surface get a bed
  // (the water showed nowhere over it), and the water blocks use this plan
  let lakePlan = null;
  if (includeWater) {
    try {
      lakePlan = planLakes({
        features: exportTerrainData.osmFeatures || [],
        toWorld: (lat, lng) => geoToWorldPoint(lat, lng, exportTerrainData, squareSize, 0),
        heightAt: (x, y) => getTerrainHeightAtWorldXY(x, y, exportTerrainData, squareSize),
        // (lakes at or under the sea plane: the sea covers them)
        seaZ: -(Number(exportTerrainData.minHeight) || 0) + (Number(seaLevelOffset) || 0),
      });
      // (no bed within LAKE_KEEP_M of a ground road's edge: its sidewalk and
      // quay stay on their ground)
      // (a deck's road no quay: the bed runs on under the bridge)
      const quayIndex = buildCarriagewayIndex(riverRoads().map((r) => ({ nodes: r.points, half: (r.half || 3) + LAKE_KEEP_M })));
      // (terrain shaping off: only the survey's flat water surface cut a
      // little under the water, as the sea floor below is: a measuring
      // artifact, not shaping; water and ground at one height flickered)
      const beds = carveLakeBeds(lakePlan.lakes, {
        heightMap: exportTerrainData.heightMap, width: exportTerrainData.width, height: exportTerrainData.height,
        worldSize: exportTerrainData.width * squareSize, minHeight: Number(exportTerrainData.minHeight) || 0,
      }, {
        keep: (x, y) => isOnOtherCarriageway(quayIndex, x, y, 0, () => false),
        // (reservoirs: deepest against their dam)
        dams: (exportTerrainData.osmFeatures || [])
          .filter((f) => (f.tags?.waterway === 'dam' || f.tags?.man_made === 'dam') && f.geometry?.length > 1)
          .map((f) => ({ line: f.geometry.map((p) => geoToWorldPoint(p.lat, p.lng, exportTerrainData, squareSize, 0)), height: f.tags.height ?? null })),
        shallow: !shapeExtras,
      });
      const hmLake = heightMapEditor(exportTerrainData);
      beds.apply((idx, v) => hmLake.set(idx, v));
      lakePlan.stats.bedPixels = beds.pixels;
      lakePlan.stats.lakeDepths = (beds.lakes || []).slice().sort((p, q) => q.depth - p.depth);
      if (beds.lakes?.length) console.log(`${BEAMNG_EXPORT_SERVICE_LOG} Lake beds: ${beds.lakes.map((lk) => `${lk.name || 'lake'} ${lk.depth.toFixed(1)} m (${lk.source})`).slice(0, 8).join(', ')}.`);
      // the sea floor under the sea plane where the survey recorded the
      // water's surface (any terrain choice: a measuring artifact, not shaping)
      const seabed = lowerSeabed({
        heightMap: exportTerrainData.heightMap, width: exportTerrainData.width, height: exportTerrainData.height,
        minHeight: Number(exportTerrainData.minHeight) || 0,
      }, exportTerrainData.landCover, -(Number(exportTerrainData.minHeight) || 0) + (Number(seaLevelOffset) || 0));
      seabed.apply((idx, v) => hmLake.set(idx, v));
      lakePlan.stats.seabedPixels = seabed.pixels;
    } catch (err) {
      console.warn(`${BEAMNG_EXPORT_SERVICE_LOG} Lake beds skipped: ${err?.message || err}`);
      lakePlan = null;
    }
  }

  // Tunnel mouths: the lanes in front of a low box's face no higher than the
  // road going in, whatever was graded over them since
  if (decalRoads.tunnels?.mouth?.size) {
    const hmMouth = heightMapEditor(exportTerrainData);
    let capped = 0;
    for (const [idx, cap] of decalRoads.tunnels.mouth) if (hmMouth.at(idx) > cap + 0.02) { hmMouth.set(idx, cap); capped++; }
    if (capped) console.log(`${BEAMNG_EXPORT_SERVICE_LOG} Tunnel mouths: ${capped} grid point(s) brought back down to the road.`);
  }
  // ...and the ground standing in a low box's mouth opened again on the
  // terrain as it is now: the holes were found before the roads' ground was
  // composed, which ran a ramp from the road up to the lid through the first
  // metres of the box (0.3 to 0.9 m of ground across the lane 4 to 8 m in:
  // Tignes, Val Claret and Lavachet)
  {
    const lowBoxes = (decalRoads.tunnels?.tunnels || []).filter((t) => t.gradedCover);
    if (lowBoxes.length) {
      const W = exportTerrainData.width; const Hh = exportTerrainData.height; const hmap = exportTerrainData.heightMap;
      const mh0 = Number(exportTerrainData.minHeight) || 0;
      const holes = new Set(decalRoads.tunnels.holes || []);
      let opened = 0;
      for (const t of lowBoxes) {
        const [x0, y0, x1, y1] = tunnelReach(t);
        const c0 = Math.max(0, Math.floor(x0 / squareSize + W / 2) - 1); const c1 = Math.min(W - 2, Math.ceil(x1 / squareSize + W / 2) + 1);
        const r0 = Math.max(1, Math.floor(Hh / 2 - y1 / squareSize) - 1); const r1 = Math.min(Hh - 1, Math.ceil(Hh / 2 - y0 / squareSize) + 1);
        for (let r = r0; r <= r1; r++) {
          for (let c = c0; c <= c1; c++) {
            const idx = (Hh - 1 - r) * W + c;
            if (holes.has(idx)) continue;
            const x = (c + 0.5 - W / 2) * squareSize; const y = (Hh / 2 - r - 0.5) * squareSize;
            const corners = [hmap[r * W + c], hmap[r * W + c + 1], hmap[(r - 1) * W + c], hmap[(r - 1) * W + c + 1]];
            if (lowMouthHoleAt(t, x, y, Math.min(...corners) - mh0)) { holes.add(idx); opened++; t.holes = (t.holes || 0) + 1; }
          }
        }
      }
      if (opened) {
        decalRoads.tunnels.holes = [...holes];
        console.log(`${BEAMNG_EXPORT_SERVICE_LOG} Tunnel mouths: ${opened} more square(s) opened inside the low boxes' faces.`);
      }
    }
  }

  // Sports fields graded (terrain shaping on): the ground under each field to
  // its best-fit plane, blended back over FIELD_BLEND_M round it, the roads'
  // ground left (a field on a raw survey's undulations, or a survey older
  // than the field: the turf rolled over the bumps); off, the fields drape
  // on the ground as it is
  if (includeBuildings && shapeExtras) try {
    const feats = exportTerrainData.osmFeatures || [];
    const project = (lat, lng) => geoToWorldPoint(lat, lng, exportTerrainData, squareSize, 0);
    const pitches = planPitches(feats, project, { groundAt: terrainGroundAt(exportTerrainData, squareSize) });
    const graded = gradePitchGround(exportTerrainData, squareSize, pitches);
    console.log(`${BEAMNG_EXPORT_SERVICE_LOG} Sports fields: ${graded.fields} graded flat (${graded.pixels} px).`);
  } catch (err) {
    console.warn(`${BEAMNG_EXPORT_SERVICE_LOG} Field grading skipped: ${err?.message || err}`);
  }

  // Drag strips graded smooth: always, the shaping switches notwithstanding
  // (a laser-graded strip; the survey's centimetres of noise under one)
  let dragGrade = null;
  try {
    dragGrade = gradeDragStrips(exportTerrainData, squareSize, groundCarriageways.filter((cw) => cw.highway === 'raceway'));
    if (dragGrade.strips) console.log(`${BEAMNG_EXPORT_SERVICE_LOG} Drag strips: ${dragGrade.strips} graded smooth (${dragGrade.pixels} px; bumps ${(dragGrade.before * 100).toFixed(1)} -> ${(dragGrade.after * 100).toFixed(1)} cm rms).`);
  } catch (err) {
    console.warn(`${BEAMNG_EXPORT_SERVICE_LOG} Drag strip grading skipped: ${err?.message || err}`);
  }

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
      // (every half square along the line, not only at its stations: 2 m
      // apart, they left every other row of a 1 m grid as grass, growing
      // in stripes across the road)
      const along = [];
      for (let i = 0; i + 1 < t.line.length; i++) {
        const a = t.line[i]; const b = t.line[i + 1];
        const steps = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / (squareSize / 2)));
        for (let k = 0; k < steps; k++) along.push({ x: a.x + ((b.x - a.x) * k) / steps, y: a.y + ((b.y - a.y) * k) / steps, tx: a.tx, ty: a.ty });
      }
      along.push(t.line[t.line.length - 1]);
      for (const p of along) {
        for (let d = -t.W; d <= t.W; d += squareSize / 2) {
          const [x, y] = [p.x + d * p.ty, p.y - d * p.tx];
          const c = Math.round(x / squareSize + n / 2); const r = Math.round(y / squareSize + n / 2);
          if (c >= 0 && c < n && r >= 0 && r < n) terLayerMap[r * n + c] = asphaltLayer;
        }
        // the bank up to the roof on the uphill side: rock, no grass growing up through the roof
        const rockLayer = (pbrResult?.materialNames || []).indexOf('ROCK');
        if (rockLayer >= 0) {
          for (let d = t.W + squareSize / 2; d <= galleryRoofHalf(t); d += squareSize / 2) {
            const u = d * t.uphill;
            const [x, y] = [p.x + u * p.ty, p.y - u * p.tx];
            const c = Math.round(x / squareSize + n / 2); const r = Math.round(y / squareSize + n / 2);
            if (c >= 0 && c < n && r >= 0 && r < n) terLayerMap[r * n + c] = rockLayer;
          }
        }
      }
    }
  }
  // Under every paved road on the ground, asphalt to its drawn edge: ground
  // cover grows by terrain layer, not by what is drawn over it, and the
  // painter's road strips (from OSM) need not match the drawn carriageway
  // (parking lanes, solver widths): grass grew through the road's edges
  if (terLayerMap && asphaltLayer >= 0) {
    const n = exportTerrainData.width;
    const UNPAVED = new Set(['unpaved', 'gravel', 'fine_gravel', 'dirt', 'earth', 'ground', 'grass', 'sand', 'mud', 'compacted', 'pebblestone', 'woodchips']);
    let painted = 0;
    for (const cw of groundCarriageways) {
      if (UNPAVED.has(String(cw.tags?.surface || '').toLowerCase()) || cw.highway === 'track' || cw.highway === 'path') continue;
      const nodes = cw.nodes || []; const reach = (cw.half || 3) + ROAD_LAYER_MARGIN_M;
      for (let i = 0; i + 1 < nodes.length; i++) {
        const [ax, ay] = nodes[i]; const [bx, by] = nodes[i + 1];
        const L = Math.hypot(bx - ax, by - ay);
        if (L < 1e-6) continue;
        const ux = (bx - ax) / L; const uy = (by - ay) / L;
        for (let s = 0; s <= L; s += squareSize / 2) {
          for (let d = -reach; d <= reach; d += squareSize / 2) {
            const x = ax + ux * s - uy * d; const y = ay + uy * s + ux * d;
            const c = Math.round(x / squareSize + n / 2); const r = Math.round(y / squareSize + n / 2);
            if (c >= 0 && c < n && r >= 0 && r < n && terLayerMap[r * n + c] !== asphaltLayer) { terLayerMap[r * n + c] = asphaltLayer; painted++; }
          }
        }
      }
    }
    if (pbrResult) pbrResult.roadLayerPixels = painted;
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
  // Swimming pools: their terrain squares opened (the pool's walls and floor
  // are the building tiles' mesh, its deck covers the opening's edge); a bare
  // layer under the decks, fountain basins and splash pads (ground cover grew
  // up through them)
  // (the pools and fountains are the building tiles' meshes: none without them)
  if (includeBuildings) try {
    const feats = exportTerrainData.osmFeatures || [];
    const project = (lat, lng) => geoToWorldPoint(lat, lng, exportTerrainData, squareSize, 0);
    const { holes: poolHoles, paved } = poolFootprints(planPools(feats, project, { squareSize, groundAt: terrainGroundAt(exportTerrainData, squareSize) }));
    paved.push(...fountainFootprints(planFountains(feats, project)));
    paved.push(...pitchFootprints(planPitches(feats, project, { groundAt: terrainGroundAt(exportTerrainData, squareSize) })));
    if (poolHoles.length || paved.length) {
      if (!terLayerMap) terLayerMap = new Uint8Array(exportTerrainData.width * exportTerrainData.height);
      // the terrain's own grid: sample (i, j), counted from the south-west
      // corner, at ((i - W/2), (j - W/2)) squares (the TerrainBlock sits at
      // minus half its extent); its layer index j * W + i; a hole flag on it
      // opens the square to its north-east (Terrain-Files.md). (A grid of
      // (W - 1) spans, the heightmap's, drifted a square across the map:
      // ground left along the pools' walls, an opening past a deck.)
      const W = exportTerrainData.width; const H = exportTerrainData.height; const sq = squareSize;
      const at = (i, j) => [(i - W / 2) * sq, (j - H / 2) * sq];
      const box = (ring) => {
        let x0 = Infinity; let y0 = Infinity; let x1 = -Infinity; let y1 = -Infinity;
        for (const [x, y] of ring) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
        return [Math.max(0, Math.floor(x0 / sq + W / 2) - 1), Math.max(0, Math.floor(y0 / sq + H / 2) - 1),
          Math.min(W - 2, Math.ceil(x1 / sq + W / 2) + 1), Math.min(H - 2, Math.ceil(y1 / sq + H / 2) + 1)];
      };
      const names = pbrResult?.materialNames || [];
      const bare = [names.indexOf('asphalt'), names.indexOf('ROCK')].find((i) => i >= 0);
      let barePixels = 0;
      if (bare !== undefined) {
        for (const ring of paved) {
          const [i0, j0, i1, j1] = box(ring);
          for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
            const k = j * W + i;
            if (terLayerMap[k] !== 255 && inRingXY(...at(i, j), ring)) { terLayerMap[k] = bare; barePixels++; }
          }
        }
      }
      // a square opens when it touches the pool (services/pools.js
      // squareOpens), then one square more all round, all under the deck
      let opened = 0;
      const corners = (i, j) => [at(i, j), at(i + 1, j), at(i + 1, j + 1), at(i, j + 1)];
      for (const hole of poolHoles) {
        const [i0, j0, i1, j1] = box(hole.open);
        const open = new Set();
        for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) if (squareOpens(corners(i, j), hole)) open.add(j * W + i);
        const grown = new Set(open);
        for (const k of open) {
          const j = Math.floor(k / W); const i = k % W;
          for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]) {
            const ii = i + di; const jj = j + dj;
            if (ii < 0 || ii >= W - 1 || jj < 0 || jj >= H - 1 || grown.has(jj * W + ii)) continue;
            if (corners(ii, jj).every(([x, y]) => inRingXY(x, y, hole.cover))) grown.add(jj * W + ii);
          }
        }
        for (const k of grown) { terLayerMap[k] = 255; opened++; }
      }
      if (pbrResult) { pbrResult.poolHoleSquares = opened; pbrResult.pavedBarePixels = barePixels; }
      console.log(`${BEAMNG_EXPORT_SERVICE_LOG} Pools: ${poolHoles.length} sunk (${opened} terrain squares opened); ${barePixels} px bare under decks / basins.`);
    }
  } catch (err) {
    console.warn(`${BEAMNG_EXPORT_SERVICE_LOG} Pool holes skipped: ${err?.message || err}`);
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

  // The surrounding backdrop is terrain too: built here, with the terrain
  // stage, from the finished heights (terrain.ter is written). It ran after
  // the trees, under "Planting nature" on the progress card.
  let backdropDaeBlob = null;
  let backdropTextureFiles = [];
  let backdropMaterialNames = [];
  let backdropDiagnostics = null;
  let backdropHeights = null;
  if (includeBackdrop) {
    // (its tiles are in the download cache: the export's data step fetched them)
    beginStep('backdrop', `Building the surrounding backdrop (${backdropElevationSource === 'global30m' ? 'global 30 m' : backdropElevationSource.toUpperCase()} elevation + satellite imagery, 8 tiles)…`);
    await yield_();
    // The backdrop reads the map's footprint, its source and the terrain's
    // border (the seam strips): kept in the step cache by those, a re-export
    // that changed something else (trees, a name) reuses it
    const border = new Uint16Array(4 * size);
    for (let i = 0; i < size; i++) {
      const q = (idx) => Math.max(0, Math.min(65535, Math.floor((exportTerrainData.heightMap[idx] - terrainBase) * (65536 / terrainBlockMaxHeight))));
      border[i] = q(i); border[size + i] = q((size - 1) * size + i); border[2 * size + i] = q(i * size); border[3 * size + i] = q(i * size + size - 1);
    }
    const backdropKey = stepHash('backdrop', BACKDROP_CODE(), exportTerrainData.bounds, size, squareSize, worldSize, backdropElevationSource,
      backdropElevationSource === 'gpxz' ? String(backdropGpxzApiKey || '').length : 0, terrainBlockZ, terrainBlockMaxHeight, border,
      JSON.stringify(backdropImageryFetch({ quality: backdropImagery, bounds: exportTerrainData.bounds, stitchLimit: backdropStitchLimit })));
    const { value: backdropResult, reused: backdropReused } = await cachedStep(options.stepCache || null, backdropKey, () => generateTerrainBackdropDAE(exportTerrainData, worldSize, {
      elevationSource: backdropElevationSource,
      gpxzApiKey: backdropGpxzApiKey,
      imagery: backdropImagery,
      stitchLimit: backdropStitchLimit,
      onProgress: (text, fraction) => report(`Backdrop: ${String(text).replace(/\.\.\.$/, '…')}`, fraction),
      // (the terrain's border as terrain.ter encodes it, for the seam strips)
      seam: {
        width: size, height: size, squareSize,
        zAt: (i, r) => {
          const h = exportTerrainData.heightMap[r * size + i];
          const q = Math.max(0, Math.min(65535, Math.floor((h - terrainBase) * (65536 / terrainBlockMaxHeight))));
          return terrainBlockZ + (q * terrainBlockMaxHeight) / 65536;
        },
      },
    }));
    if (backdropReused) {
      reusedSteps.push('backdrop');
      report('Backdrop: the same as the last export\'s (nothing it reads changed)', 1);
      console.log(`${BEAMNG_EXPORT_SERVICE_LOG} Backdrop reused from the last export (step cache).`);
    }
    backdropDaeBlob = backdropResult?.daeBlob ?? null;
    backdropTextureFiles = backdropResult?.textureFiles ?? [];
    backdropMaterialNames = backdropResult?.materialNames ?? [];
    backdropDiagnostics = backdropResult?.diagnostics ?? null;
    backdropHeights = backdropResult?.heights ?? null;
  }

  let osmDaeBlob = null;
  let buildingTileDaes = [];
  const buildingReport = { dragGrade };
  if (includeBuildings) {
    const damCount = (decalRoads.structureGraph?.dams || []).length;
    beginStep('buildings', `Building textured 3D buildings (${(exportTerrainData.osmFeatures || []).filter((f) => f.type === 'building').length} OSM footprints${damCount ? `, ${damCount} dam${damCount === 1 ? '' : 's'}` : ''})…`);
    await yield_();
    const buildingInputs = {
      raceways: groundCarriageways.filter((cw) => cw.highway === 'raceway'),
      gateRoads: gateWaysOf(exportTerrainData, groundCarriageways, squareSize),
      // (the dams the roads were pinned to: one crest for the road and the concrete)
      dams: decalRoads.structureGraph?.dams || null,
      replace: liftedBuildings,
    };
    // (kept in the step cache by the shaped terrain and these: a re-export
    // that changed only trees or a name reuses the buildings)
    const stepCode = options.stepCodeVersion || STEP_CODE_BUILD;
    const buildingsKey = stepCode ? stepHash('buildings', STEP_CACHE_VERSION, stepCode, terrainFingerprint(exportTerrainData), worldSize, jsonOf(buildingInputs)) : null;
    const { value: built, reused: buildingsReused } = await cachedStep(options.stepCache || null, buildingsKey, async () => {
      const stats = { dragGrade };
      const out = await generateOSMObjectsDAE(exportTerrainData, worldSize, stats, buildingInputs);
      return out ? { data: out.data || null, tiles: out.tiles || [], report: stats } : { data: null, tiles: [], report: stats };
    });
    const osm = built;
    Object.assign(buildingReport, built?.report || {});
    if (buildingsReused) { reusedSteps.push('buildings'); console.log(`${BEAMNG_EXPORT_SERVICE_LOG} Buildings reused from the last export (step cache).`); }
    osmDaeBlob = osm?.data || null;
    buildingTileDaes = osm?.tiles || [];
    buildingReport.tiles = buildingTileDaes.length;
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
  // (and ground below sea level the sea can't reach, a polder or a desert
  // basin: the plane flooded it; the blocks fill only what joins the edge)
  // (where the edge is open water: the land cover's water or no data, the
  // open sea, in runs of 200 m or more; not a polder's ditch)
  // (no land cover, WorldCover unreachable: the map's own coastline or sea
  // decides; none mapped, nothing comes in from the edge: an inland polder or
  // basin stays dry rather than flooded by a ditch at the edge)
  const hasMappedSea = (exportTerrainData.osmFeatures || []).some((f) => f?.type === 'coastline' || ['sea', 'ocean'].includes(String(f?.tags?.place || '').toLowerCase()) || f?.tags?.natural === 'bay');
  const seaAtUV = openWaterAtEdge(exportTerrainData.landCover, exportTerrainData.width * squareSize) ?? (hasMappedSea ? null : () => false);
  const inlandBelowSea = !cutBelowSea && hasInlandBelowSea(sourceHeightMap, exportTerrainData.width, exportTerrainData.height,
    seaZ + (Number(exportTerrainData.minHeight) || 0), 16 / squareSize, { seaAt: seaAtUV });
  if (inlandBelowSea) console.log(`${BEAMNG_EXPORT_SERVICE_LOG} Ground below sea level the sea doesn't reach: the sea as blocks, not one plane.`);
  const seaAsBlocks = (tunnelList.length > 0 && tunnelsBelow(tunnelList, seaZ)) || cutBelowSea || inlandBelowSea;
  const seaObjects = seaAsBlocks
    ? buildSeaBlockObjects(exportTerrainData, squareSize, biome, seaLevelOffset, dryZones, tunnelList, sourceHeightMap, seaAtUV)
    : [buildSeaLevelWaterPlane(exportTerrainData, biome, seaLevelOffset)];
  waterStats.sea = seaAsBlocks ? { blocks: seaObjects.length } : { plane: true };
  waterStats.pools = {};
  // the water out over the backdrop (the lakes, ponds and rivers round the
  // map, from the data step), unless water is off or background areas are drawn
  let backdropWater = null;
  if (includeWater && includeBackdrop && backdropHeights?.length && options.surroundingWater?.length && !bgMask) {
    try {
      const ws = exportTerrainData.width * squareSize;
      const backdropAt = backdropHeightSampler(backdropHeights, { bounds: exportTerrainData.bounds, worldSize: ws, minHeight: Number(exportTerrainData.minHeight) || 0 });
      const groundAt = (x, y) => (Math.abs(x) <= ws / 2 && Math.abs(y) <= ws / 2 ? getTerrainHeightAtWorldXY(x, y, exportTerrainData, squareSize) : backdropAt(x, y));
      const around = planBackdropWater({ features: options.surroundingWater, bounds: exportTerrainData.bounds, worldSize: ws, groundAt, mapLakes: lakePlan?.lakes || [], seaZ });
      // (a lake crossing the edge: the map's blocks for it end where the backdrop's begin)
      if (lakePlan && around.mapTrim.size) {
        lakePlan.tiles = lakePlan.tiles.flatMap((t) => (around.mapTrim.has(t.lake) ? [insidePart(t, around.innerHalf)].filter(Boolean) : [t]));
      }
      // (the backdrop's ground under them is its 30 m lake surface, centimetres
      // down: read as deep, murky water, not the photo through a film of it;
      // one depth for all: the map's terrain the depth reads stops at its edge)
      const blocks = buildWaterBlockObjects(exportTerrainData, squareSize, biome, {}, [], { tiles: around.tiles, stats: {} })
        .map((o) => ({ ...o, clarity: 0, depthGradientMax: 2, waterFogDensity: 4, scale: [o.scale[0], o.scale[1], 12] }));
      const rivers = buildRiverObjects(exportTerrainData, squareSize, biome, [], {}, [], { rivers: around.rivers, stats: {} })
        .map((o) => ({ ...o, name: `backdrop_${o.name}` }));
      backdropWater = [...blocks, ...rivers];
      waterStats.backdrop = { lakes: around.stats.lakes, blocks: blocks.length, rivers: rivers.length };
      console.log(`${BEAMNG_EXPORT_SERVICE_LOG} Water over the backdrop: ${blocks.length} lake WaterBlocks (${around.stats.lakes} lakes), ${rivers.length} rivers.`);
    } catch (err) {
      console.warn(`${BEAMNG_EXPORT_SERVICE_LOG} Water over the backdrop skipped: ${err?.message || err}`);
    }
  }
  const waterObjects = [
    ...(built('sea') ? seaObjects : []),
    ...(includeBuildings ? buildPoolWaterObjects(exportTerrainData, squareSize, biome, waterStats.pools) : []),
    ...(includeWater
      ? [
          ...buildWaterBlockObjects(exportTerrainData, squareSize, biome, waterStats.lakes, dryZones, lakePlan),
          ...buildRiverObjects(exportTerrainData, squareSize, biome,
            riverRoads(), waterStats.rivers, dryZones, riverPlan),
        ]
      : []),
  ];
  if (backdropWater) waterObjects.push(...backdropWater);
  Object.defineProperty(waterObjects, 'stats', { value: waterStats, enumerable: false });
  if (includeWater) {
    console.log(`${BEAMNG_EXPORT_SERVICE_LOG} Water: ${waterStats.lakes.tiles ?? 0} lake tiles in ${waterStats.lakes.lakes ?? 0} lakes (${waterStats.lakes.riverAreas ?? 0} of them wide or tidal rivers), ${waterStats.rivers.pieces ?? 0} rivers; left out ${waterStats.rivers.dry ?? 0} dry washes, ${waterStats.rivers.underground ?? 0} culverts, ${waterStats.rivers.otherKinds ?? 0} drains/ditches, ${waterStats.lakes.dry ?? 0} dry lakes; ${waterStats.rivers.cutAtRoads ?? 0} cut at roads.`);
  }
  const cloudObjects = buildCloudObjects(biome);

  beginStep('furniture', 'Placing barriers, fences, road signs, traffic lights, lamps, benches and fuel stations…');
  await yield_();
  const onDrawnRoad = buildClearanceIndex(groundCarriageways.map((cw) => ({ points: cw.nodes, half: cw.half })));
  const gateWays = gateWaysOf(exportTerrainData, groundCarriageways, squareSize);
  // (roads only painted on the terrain count too: a leaf stood in a divided entrance's other lane)
  const onAnyWay = buildClearanceIndex(gateWays.map((w) => ({ points: w.pts, half: w.half })));
  const barrierObjects = includeNativeBarriers
    ? buildNativeBarrierObjects(exportTerrainData, squareSize, biome, {
      skipAt: (x, y, z) => onDrawnRoad(x, y, 0.3) || underDeck(x, y, z - 1, z + 2),
      // guardrail / fence runs: not under a deck they run along (OSM's railing
      // of the bridge, which has its own parapets, stood on the road under it)
      skipLineAt: (x, y, z, yaw) => bridgeDecks.length > 0 && alongDeck(bridgeDecks, x, y, z, yaw),
      gateWays,
      trackGates: buildingReport.stats?.trackGates || [],
      gateFree: (x, y) => !onDrawnRoad(x, y, 0.15) && !onAnyWay(x, y, 0.15),
      // guardrails along roads on dams (services/dams.js), on the crest
      extra: damGuardrails(decalRoads.structureGraph).map(({ pts, z }) => {
        const b = exportTerrainData.bounds; const ws = exportTerrainData.width * squareSize;
        return {
          type: 'barrier', id: 'dam_rail', tags: { barrier: 'guard_rail' },
          geometry: pts.map(([x, y]) => ({ lat: b.north - (0.5 - y / ws) * (b.north - b.south), lng: b.west + (x / ws + 0.5) * (b.east - b.west) })),
          __zAt: (x, y) => { let best = Infinity; let zz = z[0]; pts.forEach(([px, py], i) => { const d = (px - x) ** 2 + (py - y) ** 2; if (d < best) { best = d; zz = z[i]; } }); return zz; },
        };
      }),
    })
    : [];
  const barrierFolderItems = buildBarrierFolderItems(barrierObjects);
  // divided fast roads: the game's jersey barriers down a narrow median
  for (const [i, line] of (sidewalks.medianRuns?.jersey || []).entries()) {
    for (let k = 0; k + 1 < line.length; k++) {
      const [ax, ay, az] = line[k]; const [bx, by, bz] = line[k + 1];
      barrierObjects.push({
        __parent: 'Barriers', class: 'TSStatic', name: `median_barrier_${i}_${k}`, persistentId: generatePersistentId(),
        position: [roundTo((ax + bx) / 2, 3), roundTo((ay + by) / 2, 3), roundTo((az + bz) / 2 + 0.05, 3)],
        rotationMatrix: rotationMatrixFromYaw(Math.atan2(by - ay, bx - ax) + Math.PI / 2),
        shapeName: '/levels/west_coast_usa/art/shapes/objects/jerseybarrier_3m.dae', useInstanceRenderData: true,
      });
    }
  }
  // gutters along the curbs, broken where a curb is lowered: the game's own
  // gutter1 decal (West Coast USA's settings at half its width; solid
  // concrete read as a pale band on the road)
  if (Array.isArray(decalRoads) && sidewalks.runs.length) {
    const gutters = gutterLines(sidewalks).flatMap((nodes, i) => {
      const decal = makeRoadDecal(nodes.map(([x, y, z]) => [x, y, z + 0.1, GUTTER_WIDTH_M]), `gutter_${i}`, 'gutters', {
        material: GUTTER_MATERIAL, renderPriority: 5, breakAngle: 3, textureLength: 16, distanceFade: [200, 50],
      });
      return decal ? [decal] : [];
    });
    if (gutters.length) decalRoads.push({ class: 'SimGroup', name: 'gutters', persistentId: generatePersistentId(), __parent: 'Decal_Roads', __items: gutters });
  }
  // the road inside each rounded curb, in its street's own surface (the two
  // streets' decals leave the corner's triangle of ground bare)
  if (Array.isArray(decalRoads) && sidewalks.corners?.length) {
    const americas = getMarkingStyle(exportTerrainData.roadRules) === 'americas';
    // A junction has one surface: the greatest street's of all that meet
    // there (the one the others are cut back to, cutSurfaceAtOtherSurfaces),
    // and every corner around it takes that surface, even a corner between
    // two brick arms of an asphalt crossing.
    const score = (st) => (SURFACE_RANK[String(st.highway ?? '').replace(/_link$/, '')] ?? 1) * 2 + (pavingOf(st.surface, { americas }) ? 0 : 1);
    const junctionIndex = buildCarriagewayIndex(groundCarriageways);
    const byOwner = new Map(groundCarriageways.map((cw) => [cw.owner, cw]));
    const junctionStreets = (x, y) => carriagewaysAt(junctionIndex, x, y, CORNER_JUNCTION_REACH_M)
      .map((h) => byOwner.get(h.owner)).filter((cw) => cw && surfaceKeyOf(cw.tags, americas) !== 'unpaved')
      .map((cw) => ({ surface: cw.tags?.surface, highway: cw.highway }));
    const patches = cornerPatches(sidewalks.corners).flatMap((patch, i) => {
      // (the triangle's tip at the corner point; the band's middle)
      const tip = patch.band ? patch.nodes[patch.nodes.length >> 1] : patch.nodes[patch.nodes.length - 1];
      const streets = [...(patch.streets || [{ surface: patch.surface }]), ...junctionStreets(tip[0], tip[1])];
      const key = surfaceKeyOf({ surface: streets.reduce((a, b) => (score(b) > score(a) ? b : a)).surface }, americas);
      const { material, textureLength } = surfaceLook(key === 'unpaved' ? 'asphalt' : key);
      const decal = makeRoadDecal(patch.nodes, `corner_paving_${i}`, 'corner_paving', { material, renderPriority: 14, breakAngle: 3, textureLength, distanceFade: [300, 100] });
      return decal ? [decal] : [];
    });
    if (patches.length) decalRoads.push({ class: 'SimGroup', name: 'corner_paving', persistentId: generatePersistentId(), __parent: 'Decal_Roads', __items: patches });
  }
  // the sidewalks' shape, with the decks on the walls now the walls stand
  const wallDeckMesh = buildWallDeckMesh(sidewalks.wallDecks, barrierObjects.wallTops, { sidewalkLook });
  if (wallDeckMesh) sidewalks.meshes.push(wallDeckMesh);
  // pedestrian squares, paved on the terrain as it now lies (plazas.js)
  if (includeRoads) {
    const toW = (p) => geoToWorldPoint(p.lat, p.lng, exportTerrainData, squareSize, 0);
    const squares = (exportTerrainData.osmFeatures || []).filter(isPlaza)
      .map((f) => ({ ring: f.geometry.map(toW), surface: plazaSurface(f.tags.surface) }));
    // courtyards: flagstone, their footways laid as bordered brick paths
    // (in grass with dirt paths a courtyard read as a park in a box)
    const footways = (exportTerrainData.osmFeatures || [])
      .filter((f) => f.type === 'road' && ['footway', 'path', 'pedestrian', 'steps'].includes(f.tags?.highway) && f.tags?.area !== 'yes' && f.geometry?.length >= 2)
      .map((f) => ({ nodes: f.geometry.map(toW), half: courtyardPathHalf(f.tags) }));
    // (an open one with trees or green mapped in it is a garden: its ground
    // left as it is, only the paths laid; courtyardPaved)
    const features = exportTerrainData.osmFeatures || [];
    const trees = features.filter((f) => f.type === 'vegetation' && f.tags?.natural === 'tree' && f.tags.procedurally_generated !== 'yes' && f.geometry?.length).map((f) => toW(f.geometry[0]));
    const greens = features.filter((f) => f.geometry?.length >= 4 && (['grass', 'meadow', 'village_green', 'flowerbed'].includes(f.tags?.landuse) || ['garden', 'park'].includes(f.tags?.leisure) || ['grassland', 'scrub', 'wood'].includes(f.tags?.natural)))
      .map((f) => f.geometry.map(toW));
    for (const f of features.filter(isCourtyard)) {
      const ring = f.geometry.map(toW);
      const inside = (q) => { let k = false; for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) if (((ring[i][1] > q[1]) !== (ring[j][1] > q[1])) && (q[0] < ((ring[j][0] - ring[i][0]) * (q[1] - ring[i][1])) / (ring[j][1] - ring[i][1]) + ring[i][0])) k = !k; return k; };
      const centroid = (r) => [r.reduce((a, q) => a + q[0], 0) / r.length, r.reduce((a, q) => a + q[1], 0) / r.length];
      const green = trees.some(inside) || greens.some((g) => inside(centroid(g)));
      squares.push({ ring, surface: f.tags.surface ? plazaSurface(f.tags.surface) : 'flagstone', paved: courtyardPaved(f.tags, green), paths: footways.filter((w) => w.nodes.some(inside)) });
    }
    if (squares.length) {
      const plazas = buildPlazaMeshes(squares, {
        drape: terrainDrape(exportTerrainData, squareSize),
        buildings: (exportTerrainData.osmFeatures || [])
          .filter((f) => f.type === 'building' && f.geometry?.length > 2 && !isRaisedBuildingPart(f.tags))
          .map((f) => f.geometry.map(toW)),
        roads: groundCarriageways.map((cw) => ({ nodes: cw.nodes, half: cw.half })),
      });
      sidewalks.meshes.push(...plazas.meshes);
      console.log(`${BEAMNG_EXPORT_SERVICE_LOG} Plazas: ${plazas.count} of ${squares.length} pedestrian square(s) and courtyard(s) paved, ${plazas.triangles} triangles.`);
    }
  }
  const sidewalkTileDaes = await generateSidewalkTileDAEs(sidewalks.meshes, buildingTileSize(worldSize));
  const sidewalksDae = sidewalkTileDaes.length > 0;
  // signs off the drawn roads (onto the verge, the sidewalk or the median)
  // and on the finished ground (settleSigns)
  // (signs switched off in What to build: no speed signs placed along the roads either)
  const settled = settleSigns([...(built('signs') ? buildRoadSignProps(exportTerrainData, squareSize, {
    style: getMarkingStyle(exportTerrainData.roadRules),
  }).props : []), ...calming.signs, ...curveWarnings.props], {
    index: buildCarriagewayIndex(groundCarriageways),
    groundAt: (x, y) => getTerrainHeightAtWorldXY(x, y, exportTerrainData, squareSize),
  });
  const plateOf = new Map(Object.values(US_SIGN_SHAPES).filter((v) => v.post).map((v) => [v.shapeFile, v]));
  const signObjects = settled.signs.flatMap((sign, i) => {
    const plate = plateOf.get(sign.shape);
    const base = sign.position.map((v) => roundTo(v, 3));
    const obj = {
      __parent: 'signs',
      class: 'TSStatic',
      name: `sign_${sign.kind}_${i}`,
      persistentId: generatePersistentId(),
      position: plate ? [base[0], base[1], roundTo(base[2] + plate.plateZ, 3)] : base,
      rotationMatrix: rotationMatrixFromYaw(sign.yaw),
      shapeName: sign.shape,
      useInstanceRenderData: true,
    };
    // (a bare plate on its post)
    return plate ? [obj, { ...obj, name: `sign_post_${i}`, persistentId: generatePersistentId(), position: base, shapeName: PROP_SHAPES[plate.post].shapeFile }] : [obj];
  });
  if (settled.moved || settled.dropped) console.log(`${BEAMNG_EXPORT_SERVICE_LOG} Signs: ${settled.moved} moved off the road, ${settled.dropped} left out (no ground beside it).`);
  const trafficSignalObjects = buildTrafficSignalObjects(signalProps);
  const streetFurnitureObjects = buildStreetFurnitureObjects(exportTerrainData, squareSize, biome, {
    carriageways: groundCarriageways,
    deckCarriageways: includeBridges ? deckRoadsForLamps(decalRoads.carriageways || [], groundCarriageways) : [],
    deckParts: includeBridges ? bridgeDecks.flatMap((d) => d.parts) : [],
    props: streetProps,
    underDeck,
    deckAt: sidewalks.deckAt,
    seaZ: -(Number(exportTerrainData.minHeight) || 0) + (Number(seaLevelOffset) || 0),
    roadLamps: built('lamps'),
  });
  // (none in background areas: lamps along a road that runs on into them)
  keepOutOfBackground(streetFurnitureObjects);
  // floodlights over the sports fields and racetracks
  const sportsLights = sportsLightObjects(buildingReport.stats?.lightPlan, terrainGroundAt(exportTerrainData, squareSize));
  streetFurnitureObjects.push(...sportsLights.objects);
  // hotels' signs and flags, cafés' signs (beamngBuildings.js useDetails)
  (buildingReport.stats?.props || []).forEach((p, i) => {
    const shape = PROP_SHAPES[p.shape];
    if (!shape) return;
    streetFurnitureObjects.push({
      __parent: 'street_furniture', class: 'TSStatic', name: `building_${p.shape}_${i + 1}`, persistentId: generatePersistentId(),
      position: [roundTo(p.x, 3), roundTo(p.y, 3), roundTo(p.z, 3)],
      rotationMatrix: rotationMatrixFromYaw(p.yaw + (shape.yawOffset ?? 0)),
      ...(p.scale ? { scale: p.scale.map((v) => roundTo(v * (shape.scale ?? 1), 4)) } : shape.scale ? { scale: [shape.scale, shape.scale, shape.scale] } : {}),
      shapeName: shape.shapeFile, useInstanceRenderData: true,
    });
  });
  // a few boats moored at the piers and in the marinas (services/boats.js)
  if (includeRoads) {
    const toW = (p) => geoToWorldPoint(p.lat, p.lng, exportTerrainData, squareSize, 0);
    const feats = exportTerrainData.osmFeatures || [];
    const deckLines = buildDeckPaths(exportTerrainData, squareSize);
    const roadIndex = buildCarriagewayIndex([...groundCarriageways, ...deckLines.map((d, i) => ({ owner: `deck_${i}`, half: d.half, nodes: d.nodes }))]);
    const bldRings = feats.filter((f) => f.type === 'building' && f.geometry?.length > 2).map((f) => f.geometry.map(toW));
    const inBld = (x, y) => bldRings.some((r) => { let k = false; for (let i = 0, j = r.length - 1; i < r.length; j = i++) if (((r[i][1] > y) !== (r[j][1] > y)) && (x < ((r[j][0] - r[i][0]) * (y - r[i][1])) / (r[j][1] - r[i][1]) + r[i][0])) k = !k; return k; });
    const seaZ = -(Number(exportTerrainData.minHeight) || 0) + (Number(seaLevelOffset) || 0);
    const boats = placeBoats({
      piers: feats.filter((f) => f.type === 'pier' && f.geometry?.length > 1).map((f) => ({
        nodes: f.geometry.map(toW), half: (Number.parseFloat(f.tags?.width) > 0 ? Math.min(12, Number.parseFloat(f.tags.width)) : 2.4) / 2,
      })),
      marinas: feats.filter((f) => (f.tags?.leisure === 'marina' || f.tags?.water === 'harbour') && f.geometry?.length > 3).map((f) => f.geometry.map(toW)),
      groundAt: (x, y) => getTerrainHeightAtWorldXY(x, y, exportTerrainData, squareSize),
      seaZ,
      blocked: (x, y) => carriagewaysAt(roadIndex, x, y, 0.5).length > 0 || underDeck(x, y, seaZ - 2, seaZ + 6) || inBld(x, y),
    });
    boats.forEach((b, i) => {
      streetFurnitureObjects.push({
        __parent: 'street_furniture', class: 'TSStatic', name: `boat_${i + 1}`, persistentId: generatePersistentId(),
        position: [roundTo(b.x, 3), roundTo(b.y, 3), roundTo(b.z, 3)],
        rotationMatrix: rotationMatrixFromYaw(b.yaw),
        shapeName: PROP_SHAPES[b.shape].shapeFile, collisionType: 'Collision Mesh', useInstanceRenderData: true,
      });
    });
    if (boats.length) console.log(`${BEAMNG_EXPORT_SERVICE_LOG} Boats: ${boats.length} moored at piers and in marinas.`);
  }
  buildingReport.sportsLights = sportsLights.counts;
  buildingReport.sportsGlows = sportsLights.glows;
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

  // (the trees follow the land cover read while generating; an old terrain reads it now)
  const coverNote = exportTerrainData.landCover?.grid ? ' where the land cover (ESA WorldCover) has them' : exportTerrainData.landCover === null ? '' : ' (reading the land cover, ESA WorldCover)';
  const plants = [includeTrees && `trees and bushes${coverNote}`, includeRocks && 'rocks'].filter(Boolean).join(', ');
  beginStep('vegetation', plants ? `Planting ${plants}, ground cover and props…` : 'Placing ground cover and props…');
  await yield_();
  // (the browser gets the thread back every ~50 ms: a heavily wooded 8 km
  // map planted for minutes in one go, and Chrome offered to kill the page)
  let lastYield = performance.now();
  const tick = async () => {
    if (performance.now() - lastYield < 50) return;
    await yield_();
    lastYield = performance.now();
  };
  const vegT0 = performance.now();
  // what grows around here, as recorded (treeSpecies.js): an option when
  // given (tests, cached test levels), else read with the terrain at
  // Generate (attachTreeSpecies); null when offline or too few records (the
  // climate rule then)
  const treeMix = includeTrees
    ? (requestedTreeMix !== undefined ? requestedTreeMix : (exportTerrainData.treeSpeciesMix ?? terrainData.treeSpeciesMix ?? null))
    : null;
  if (includeTrees) {
    console.log(`${BEAMNG_EXPORT_SERVICE_LOG} Tree species: ${treeMix
      ? `${Object.entries(treeMix.shares).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${Math.round(v * 100)}%`).join(', ')} (from ${treeMix.records} tree records nearby)`
      : 'no local records, the regional climate rule decides'}.`);
  }
  const forestPlacements = (includeTrees || includeRocks)
    ? await buildForestPlacements(exportTerrainData, squareSize, {
      includeTrees, includeRocks, treeMix, forestDensity,
      // (below the sea plane or a lake's water: left out, but for a sparse few seen from a road)
      water: (() => {
        const seaZ = -(Number(exportTerrainData.minHeight) || 0) + (Number(seaLevelOffset) || 0);
        const tiles = lakePlan?.tiles || [];
        const CELL = 64; const grid = new Map();
        tiles.forEach((t, i) => {
          for (let gx = Math.floor((t.cx - t.sx / 2) / CELL); gx <= Math.floor((t.cx + t.sx / 2) / CELL); gx++) {
            for (let gy = Math.floor((t.cy - t.sy / 2) / CELL); gy <= Math.floor((t.cy + t.sy / 2) / CELL); gy++) {
              const k = `${gx},${gy}`; if (!grid.has(k)) grid.set(k, []); grid.get(k).push(i);
            }
          }
        });
        const roadNear = buildClearanceIndex(groundCarriageways.map((cw) => ({ points: cw.nodes, half: cw.half })));
        return {
          underWater: (x, y, z) => {
            if (includeWater !== false && z < seaZ) return true;
            for (const i of grid.get(`${Math.floor(x / CELL)},${Math.floor(y / CELL)}`) || []) {
              const t = tiles[i];
              if (Math.abs(x - t.cx) <= t.sx / 2 && Math.abs(y - t.cy) <= t.sy / 2 && z < t.z) return true;
            }
            return false;
          },
          nearRoad: (x, y) => roadNear(x, y, UNDERWATER_ROAD_M),
        };
      })(),
    }, biome, tick)
    : new Map();
  // (where a slow planting step spends its time, in the report's console log)
  const vegLap = (what) => console.log(`${BEAMNG_EXPORT_SERVICE_LOG} Vegetation timing: ${what} at ${((performance.now() - vegT0) / 1000).toFixed(1)} s.`);
  vegLap(`${[...forestPlacements.values()].reduce((n, l) => n + l.length, 0)} placements chosen`);
  // Trees, bushes and rocks keep off the roads and sidewalks (OSM woods and
  // scrub are often drawn right over the roads through them) and out from
  // under bridge decks.
  const clearOf = buildClearanceIndex([
    ...groundCarriageways.map((cw) => ({ points: cw.nodes, half: cw.half })),
    ...(decalRoads.pedestrianStreets || []).map((way) => ({ points: way.nodes, half: way.half })),
    ...[...sidewalks.runs, ...(sidewalks.walkRuns || [])].map((run) => ({ points: run.points, half: run.width })),
    // nor on a railway's track bed and its ditches (railTrack.js)
    ...(railways?.lines || []),
    // nothing under a gallery's roof (its road, the walkway, the bank up to the roof)
    ...(decalRoads.tunnels?.tunnels || []).filter((t) => t.kind === 'gallery')
      .map((t) => ({ points: t.line.map((p) => [p.x, p.y]), half: galleryRoofHalf(t) })),
  ]);
  let vegetationCleared = 0;
  for (const [type, list] of forestPlacements) {
    const margin = (treeItemHeight(type) ?? 10) < 4 ? VEGETATION_CLEAR_LOW_M : VEGETATION_CLEAR_TREE_M;
    // (a tree's own height under a deck: a 20 m tree under a 15 m deck grew
    // up through its road)
    const reach = Math.max(12, (treeItemHeight(type) ?? 10) + 1);
    const kept = [];
    for (let i = 0; i < list.length; i++) {
      if ((i & 4095) === 0) await tick();
      const { pos: [x, y, z] } = list[i];
      if (!clearOf(x, y, margin) && !underDeck(x, y, z, z + reach) && !bgAtWorld(x, y)) kept.push(list[i]);
    }
    vegetationCleared += list.length - kept.length;
    if (kept.length) forestPlacements.set(type, kept);
    else forestPlacements.delete(type);
  }
  if (vegetationCleared) console.log(`${BEAMNG_EXPORT_SERVICE_LOG} Vegetation: ${vegetationCleared} placement(s) kept off roads, sidewalks and bridges.`);
  // Hydrants and bins (mapped + generated) as Forest items: instanced and
  // cheap, and their orientation does not matter.
  const propHalf = (terrainData.width * squareSize) / 2;
  const addPropPlacement = (type, x, y, z, yaw) => {
    if (!(Math.abs(x) < propHalf && Math.abs(y) < propHalf)) return;   // (on the map only)
    if (bgAtWorld(x, y)) return;
    if (!forestPlacements.has(type)) forestPlacements.set(type, []);
    const list = forestPlacements.get(type);
    if (list.length >= caps.forestPerType) return;
    list.push({ ctxid: 0, pos: [roundTo(x, 3), roundTo(y, 3), roundTo(z, 3)], rotationMatrix: rotationMatrixFromYaw(yaw), scale: 1, type });
  };
  for (const [x, y, z] of mappedStreetProps.hydrants) addPropPlacement(PROP_HYDRANT, x, y, z, propHash(x, y) * Math.PI * 2);
  for (const h of streetProps.hydrants) addPropPlacement(PROP_HYDRANT, h.x, h.y, h.z, h.yaw);
  const binType = (x, y) => PROP_BINS[Math.floor(propHash(x.toFixed(1), y.toFixed(1), 'bin') * PROP_BINS.length)];
  for (const [x, y, z] of mappedStreetProps.bins) addPropPlacement(binType(x, y), x, y, z, propHash(x, y) * Math.PI * 2);
  for (const b of streetProps.bins) addPropPlacement(binType(b.x, b.y), b.x, b.y, b.z, b.yaw);
  vegLap('kept off roads, props added');
  const forestFiles = serializeForestFiles(forestPlacements);
  vegLap('forest files written');
  // (grass and ground cover switched off in What to build: none)
  const groundCoverObjects = built('groundCover') ? buildGroundCoverObjects(exportTerrainData, squareSize, includeTrees, biome) : [];
  const managedForestItemData = cloneManagedItemData(Array.from(forestPlacements.keys()), biome);
  vegLap('ground cover and item data done');

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
  const entryDate = zipEntryDate();
  // Big entries compressed as they come, natively and in the background: a
  // city's model text (7 GB at 8 km) freed as the export goes on, not all
  // held for the zip at the end (its memory peak) and compressed then.
  const zipCompressor = await createZipCompressor(JSZip).catch(() => null);
  const EAGER_ZIP_BYTES = 1024 * 1024;
  // (arguments passed on as given: zip.file(name) alone reads an entry)
  zip.file = (...args) => {
    let bytes = 0;
    if (args.length > 1 && typeof args[0] === 'string') {
      bytes = byteSizeOf(args[1]);
      zipEntryBytes.set(args[0], bytes);
      args[2] = { date: entryDate, ...(args[2] || {}) };
    }
    const out = addZipFile(...args);
    if (zipCompressor && bytes >= EAGER_ZIP_BYTES) zipCompressor.add(zip.files[args[0]]);
    return out;
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
  if (carportObjects.length > 0) {
    zip.folder(`${base}/main/MissionGroup/carports`);
  }
  if (garageLightObjects.length > 0) {
    zip.folder(`${base}/main/MissionGroup/garage_lights`);
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

  // mapng.json: what made this level, so the desktop app can list MapNG
  // levels and rebuild them with a later version (its levels sidebar)
  zip.file(`${base}/mapng.json`, JSON.stringify(mapngLevelStamp({ terrainData, center, options, levelName, worldSize }), null, 1));

  // The user's spawn and quicktravel points (services/spawnPoints.js), on
  // the roads as drawn now: decks and tunnel roads at their solved heights.
  // Without points the level keeps the automatic spawn exactly as before.
  const solvedSpawnRoads = options.structureSolver === 'v2' && sg?.classes && sg?.profile?.z;
  const tunnelOwners = decalRoads.tunnels?.bySeg;
  const spawnSurfaceAt = solvedSpawnRoads
    ? (cw, x, y) => (cw.tunnel || tunnelOwners?.has?.(cw.owner) ? null : solvedHeightAt(sg, cw.owner, x, y))
    : null;
  const spawnPlan = planSpawnPoints(options.points, {
    bounds: exportTerrainData.bounds,
    project: (lat, lng) => geoToWorldPoint(lat, lng, exportTerrainData, squareSize),
    carriageways: decalRoads.carriageways || [],
    groundAt: terrainGroundAt(exportTerrainData, squareSize),
    leftHandTraffic: resolvedRightHandDrive,
    autoSpawn: { position: spawnPosition, rotationMatrix: spawnRotationMatrix },
    // (v2: each road as the solver drew it, decks included; tunnel roads
    // come from today's builder and keep their own heights)
    surfaceAt: spawnSurfaceAt,
  });
  if (spawnPlan.used) {
    // their photos: the base texture round each point (spawnPreview.js); a
    // point whose photo failed shows the level's preview.png
    const shots = await renderSpawnPreviews(texBlob, spawnPlan.previews, {
      worldSize,
      roads: baseTexture === 'none' ? decalRoads.carriageways : null,
    });
    const made = new Set();
    for (const { file, blob } of shots) {
      zip.file(`${base}/${file}`, blob instanceof Uint8Array ? blob : new Uint8Array(await blob.arrayBuffer()));
      made.add(file);
    }
    for (const e of spawnPlan.spawnPoints) if (e.preview !== 'preview.png' && !made.has(e.preview)) e.preview = 'preview.png';
    for (const line of spawnReportLines(spawnPlan.report)) if (line) console.log(`${BEAMNG_EXPORT_SERVICE_LOG} Points: ${line.replace(/^- /, '')}`);
    console.log(`${BEAMNG_EXPORT_SERVICE_LOG} Spawn and quicktravel points: ${spawnPlan.spheres.length} spawn sphere(s), ${shots.length} preview photo(s).`);
  }
  // (the camera bookmark and the in-game probes start where the car does)
  spawnPosition = spawnPlan.spheres[0].position;
  spawnRotationMatrix = spawnPlan.spheres[0].rotationMatrix;

  zip.file(`${base}/info.json`, JSON.stringify({
    authors: 'mapng',
    biome: biome?.label || biome?.id || 'mapng',
    defaultSpawnPointName: 'spawn_default',
    description: `Generated by mapng at ${lat}, ${lng}${treeMix ? `. ${TREE_MIX_CREDIT}.` : ''}`,
    features: 'Procedural OSM-driven roads, vegetation, water, and terrain.',
    previews: ['preview.png'],
    roads: 'OSM-derived roads',
    suitablefor: 'Freeroam, testing, and world-building',
    // BeamNG displays this as map dimensions in km; provide real-world meters.
    size: [worldSizeMeters, worldSizeMeters],
    // (the default first; without user points, today's single entry)
    spawnPoints: spawnPlan.spawnPoints,
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
  const parkingLines = roadType !== 'none' ? buildParkingMarkings(parkingSpots, exportTerrainData, squareSize) : [];
  if (parkingLines.length) {
    decalRoads.push({ class: 'SimGroup', name: 'parking_markings', persistentId: generatePersistentId(), __parent: 'Decal_Roads', __items: parkingLines });
    console.log(`${BEAMNG_EXPORT_SERVICE_LOG} Parking: ${parkingSpots.length} spaces, ${parkingLines.length} stall lines.`);
  }
  zip.file(`${base}/city.sites.json`, JSON.stringify({
    description: 'Description of these Sites. Contains Locations and Zones.',
    dir: `/levels/${levelName}/`,
    filename: 'city.sites.json',
    locations: {},
    name: 'city.sites.json',
    // (each spot's turn the other way round: the game reads a site's
    // rotation mirrored from ours, its parked cars sat across their bays,
    // our own stall lines being drawn from ours)
    // (parked cars switched off in What to build: no spots for traffic to fill; the bays stay painted)
    parkingSpots: built('parkedCars') ? sampleSiteSpots(parkingSpots).map((sp) => ({ ...sp, rot: siteRotation(sp.rot) })) : [],
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
    '-- The engine bakes a far-away sprite for some shapes the first time a level',
    '-- loads, then draws that first copy as a solid black box until the textures',
    '-- are reloaded. Later loads read the good file. Reload once after a bake.',
    'local spriteWatch = nil',
    '',
    'local function countSprites()',
    '  if not core_levels or not getMissionFilename or not FS or not FS.findFiles then return 0 end',
    '  local levelName = core_levels.getLevelName(getMissionFilename())',
    '  if not levelName or levelName == "" then return 0 end',
    '  return #FS:findFiles("/temp/levels/" .. tostring(levelName), "*.imposter.dds", -1, true, false)',
    'end',
    '',
    'local function watchSprites(dt)',
    '  local w = spriteWatch',
    '  if not w then return end',
    '  w.age = w.age + dt',
    '  if w.age < w.nextCheck then return end',
    '  w.nextCheck = w.age + 1',
    '  local n = countSprites()',
    '  if n ~= w.seen then',
    '    w.seen = n',
    '    w.changedAt = w.age',
    '  end',
    '  if w.changedAt and w.age >= w.changedAt + 2 then',
    '    spriteWatch = nil',
    '    log("I", "mapng", "New shape sprites were baked: reloading textures")',
    '    reloadTextures()',
    '  elseif not w.changedAt and w.age >= 45 then',
    '    spriteWatch = nil',
    '  end',
    'end',
    '',
    'function M.onClientStartMission()',
    '  raAutoLoadPending = true',
    '  raAutoLoadWait = 0',
    '  spriteWatch = { age = 0, nextCheck = 1, seen = countSprites() }',
    '  loadRoadArchitectSessionIfAvailable()',
    'end',
    '',
    'function M.onUpdate(dtReal)',
    '  watchSprites(tonumber(dtReal) or 0)',
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
    '-- The game keeps this script loaded when the map changes, and the next map',
    '-- would run our copy instead of its own.',
    'function M.onClientEndMission()',
    '  spriteWatch = nil',
    '  extensions.unload("mainLevel")',
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
  if (bridgeDaes.length > 0) {
    zip.folder(`${base}/map_assets/custom_assets/bridges`);
    for (const { key, data, deckData, extras } of bridgeDaes) {
      if (data) zip.file(`${base}/map_assets/custom_assets/bridges/bridge_${key}.dae`, await toZipBinary(data));
      if (deckData) zip.file(`${base}/map_assets/custom_assets/bridges/bridge_${key}_deck.dae`, await toZipBinary(deckData));
      for (const e of extras || []) zip.file(`${base}/map_assets/custom_assets/bridges/bridge_${key}_${e.kind}.dae`, await toZipBinary(e.data));
    }
    zip.file(`${base}/map_assets/custom_assets/bridges/main.materials.json`, JSON.stringify(getBridgeMaterialDefs(), null, 2));
  }
  if (railways?.daes.length > 0) {
    zip.folder(`${base}/map_assets/custom_assets/railways`);
    for (const { key, data } of railways.daes) {
      zip.file(`${base}/map_assets/custom_assets/railways/track_${key}.dae`, await toZipBinary(data));
    }
    zip.file(`${base}/map_assets/custom_assets/railways/main.materials.json`, JSON.stringify(railMaterialDefs(), null, 2));
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
  // (structure checks, for the report and returned with the zip)
  let structureChecks = null;
  try {
    structureChecks = measureStructures({
      carriageways: roadLinesFromDecals(decalRoads),
      decks: bridgeDecks,
      tunnels: tunnelList,
      groundAt: (x, y) => getTerrainHeightAtWorldXY(x, y, exportTerrainData, squareSize),
      grid: { heightMap: exportTerrainData.heightMap, width: exportTerrainData.width, height: exportTerrainData.height, worldSize: exportTerrainData.width * squareSize },
    });
    structureChecks.sidewalks = checkSidewalkGround(sidewalks.runs, (x, y) => getTerrainHeightAtWorldXY(x, y, exportTerrainData, squareSize));
  } catch (err) {
    console.warn(`${BEAMNG_EXPORT_SERVICE_LOG} Structure checks skipped: ${err?.message || err}`);
  }
  const reportContents = buildBeamNGExportReport({
    terrainData: exportTerrainData,
    originalTerrainData: terrainData,
    center,
    options: {
      ...options,
      contentFilter: { off: contentChoice.contentOff, tags: contentChoice.excludeTags, userTags: options.excludeTags || [], removed: contentFilter.removed, byTag: contentFilter.byTag },
      baseTexture,
      includeBuildings,
      includeBackdrop,
      includeWater,
      seaLevelOffset,
      includeNativeBarriers,
      safeCaps,
      includeTrees,
      forestDensity,
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
    spawnReport: spawnPlan.report,
    detail: {
      jobLog,
      buildingReport,
      buildingConflicts,
      shaping: {
        rawTerrain: !!terrainData?.raw,
        rawAreas: !!terrainData?.generationEdits?.rawAreas,
        includeBridges,
        includeTunnels,
        master: shapingOptions.terrain,
        roads: shaping.roads,
        bridges: shaping.bridges,
        overpasses: shaping.overpasses,
        tunnels: shaping.tunnels,
        extras: shapeExtras,
        plan: sg?.shaping?.stats || null,
        decksBuilt: bridgeDecks.length,
        rawDeckParts: (sg?.classes?.segments || []).filter((seg) => seg.raw && seg.kind === 'deck').length,
        tunnelsBuilt: tunnelList.length,
        tunnelsNotFitting: (decalRoads.tunnels?.skipped || []).filter((t) => t.shaping),
        composedPixels: sg?.terrain?.pixels ?? null,
        skippedPieces: sg?.terrain?.skipped ?? 0,
        sidewalkGroundPixels: sidewalks.groundPixels || 0,
        lakeBedPixels: lakePlan?.stats?.bedPixels ?? null,
        lakeDepths: lakePlan?.stats?.lakeDepths ?? null,
        seabedPixels: lakePlan?.stats?.seabedPixels ?? null,
        underDeckBedPixels: underDeckBeds,
        levelledUnderDecks,
        lidar: lidar ? (lidar.skipped ? { skipped: lidar.skipped } : {
          dataset: lidar.dataset, nodes: lidar.nodes, bytes: lidar.bytes, points: lidar.points, datum: lidar.datum,
          bridges: lidar.result?.bridges?.length ?? 0, pinned: lidar.result?.bridges?.filter((b) => b.pinned).length ?? 0,
          stations: lidar.result?.pins?.length ?? 0,
          bridged: lidar.result?.bridges?.filter((b) => b.bridged).length ?? 0,
          partlyPinned: lidar.result?.bridges?.filter((b) => !b.pinned && b.partial > 0).length ?? 0,
          partial: (lidar.result?.bridges || []).filter((b) => !b.pinned).map((b) => `${b.wayId ?? '?'} ${b.measured}/${b.stations}`),
        }) : null,
        residual: sg?.profile?.residual || null,
      },
      bridges: decalRoads.bridges,
      structureChecks,
      bridgeDaes,
      tunnels: decalRoads.tunnels,
      railways: railways ? { stats: railways.stats, daes: railways.daes.map((d) => ({ key: d.key, triangles: d.triangles })), decals: railways.decals.length } : null,
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
  // in-game test probes (scripts/ingame/runIngameTests.mjs)
  let ingameProbes = null;
  try {
    ingameProbes = buildIngameProbes({
      carriageways: roadLinesFromDecals(decalRoads),
      sidewalkRuns: sidewalks.runs,
      underStructure: underDeck,
      inTunnel: (x, y, z, zTop) => tunnelList.length > 0 && hitsTunnel(tunnelList, x, y, z, zTop),
      spawn: spawnPosition,
      geo: { bounds: exportTerrainData.bounds, worldSize: exportTerrainData.width * squareSize },
    });
    zip.file(`${base}/mapng_probes.json`, JSON.stringify(ingameProbes));
  } catch (err) {
    console.warn(`${BEAMNG_EXPORT_SERVICE_LOG} In-game probes skipped: ${err?.message || err}`);
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
  if (osmDaeData || buildingTileDaes.length || sidewalksDae || backdropDaeData || mapngFlagFiles.length > 0) {
    if (osmDaeData || buildingTileDaes.length) {
      zip.folder(`${base}/map_assets/custom_assets/osm_objects`);
      if (osmDaeData) zip.file(`${base}/map_assets/custom_assets/osm_objects/osm_objects.dae`, osmDaeData);
      // the buildings, one shape per tile (full + lite detail levels)
      for (const t of buildingTileDaes) zip.file(`${base}/map_assets/custom_assets/osm_objects/buildings/bld_${t.key}.dae`, await toZipBinary(t.data));
      // lit windows at night for every window band (the official map lights one)
      let facadeEmissive = null;
      try {
        const res = await fetch(`/${FACADE_EMISSIVE_FILE}`);
        if (res.ok) facadeEmissive = new Uint8Array(await res.arrayBuffer());
      } catch (_) {
        // (no app server: the official emissive map stays)
      }
      zip.file(`${base}/map_assets/custom_assets/osm_objects/main.materials.json`, JSON.stringify({
        osm_object: {
          class: 'Material',
          name: 'osm_object',
          mapTo: 'osm_object',
          annotation: 'BUILDINGS',
          Stages: [{ diffuseColor: [1, 1, 1, 1], vertColor: true }],
          translucentBlendOp: 'None',
        },
        ...getBuildingMaterialDefs({
          facadeEmissiveMap: facadeEmissive ? `/levels/${levelName}/map_assets/custom_assets/osm_objects/${FACADE_EMISSIVE_FILE}` : null,
        }),
      }, null, 2));
      if (facadeEmissive) zip.file(`${base}/map_assets/custom_assets/osm_objects/${FACADE_EMISSIVE_FILE}`, facadeEmissive);
    }
    if (sidewalksDae) {
      zip.folder(`${base}/map_assets/custom_assets/sidewalks`);
      // (one shape per tile: generateSidewalkTileDAEs)
      for (const t of sidewalkTileDaes) zip.file(`${base}/map_assets/custom_assets/sidewalks/sidewalks_${t.key}.dae`, await toZipBinary(t.data));
    }
    // (with the crosswalks' paint, wanted with or without sidewalks)
    if (sidewalksDae || includeRoads) zip.file(`${base}/map_assets/custom_assets/sidewalks/main.materials.json`, JSON.stringify({ ...getSidewalkMaterialDefs({ look: sidewalkLook }), ...getPlazaMaterialDefs() }, null, 2));
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
    ...(carportObjects.length > 0 ? [{
      __parent: 'MissionGroup',
      class: 'SimGroup',
      name: 'carports',
      persistentId: generatePersistentId(),
    }] : []),
    ...(garageLightObjects.length > 0 ? [{
      __parent: 'MissionGroup',
      class: 'SimGroup',
      name: 'garage_lights',
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
    // each street lamp's glow seen from afar at night (lampGlow.js): one
    // shared shape at the lamp head, night emissive, no collision
    const glowObjects = streetFurnitureObjects
      .filter((o) => o.class === 'SpotLight' && o.nightLight === '1' && /^(street_lamp|pole_lamp)/.test(o.name))
      .map((l) => ({
        __parent: 'street_furniture', class: 'TSStatic', name: `lamp_glow_${l.name.replace(/_light$/, '')}`, persistentId: generatePersistentId(),
        shapeName: `/levels/${levelName}/map_assets/custom_assets/lamp_glow/${LAMP_GLOW_SHAPE}`,
        position: [l.position[0], l.position[1], roundTo(l.position[2] - 0.15, 3)],
        collisionType: 'None', decalType: 'None', nightEmissive: '1',
        nightEmissiveColor: [1, 0.86, 0.66, 1], instanceColor: [0, 0, 0, 1],
      }));
    // a floodlight's bank of lamps, night only
    const floodGlows = (buildingReport.sportsGlows || []).map((g) => ({
      __parent: 'street_furniture', class: 'TSStatic', name: `flood_glow_${g.i}`, persistentId: generatePersistentId(),
      shapeName: `/levels/${levelName}/map_assets/custom_assets/lamp_glow/${FLOOD_GLOW_SHAPE}`,
      position: [roundTo(g.x, 3), roundTo(g.y, 3), roundTo(g.z, 3)], rotationMatrix: rotationMatrixFromYaw(g.yaw), scale: [g.scale, g.scale, g.scale],
      collisionType: 'None', decalType: 'None', nightEmissive: '1',
      nightEmissiveColor: [0.9, 0.95, 1, 1], instanceColor: [0, 0, 0, 1],
    }));
    if (floodGlows.length) {
      const dae = buildFloodGlowDAE();
      if (dae) {
        zip.file(`${base}/map_assets/custom_assets/lamp_glow/${FLOOD_GLOW_SHAPE}`, await toZipBinary(dae));
        streetFurnitureObjects.push(...floodGlows);
      }
    }
    if (glowObjects.length || floodGlows.length) {
      const flood = floodGlowMaterialDef(); const lamp = lampGlowMaterialDef();
      zip.file(`${base}/map_assets/custom_assets/lamp_glow/main.materials.json`, JSON.stringify({ [lamp.name]: lamp, [flood.name]: flood }, null, 2));
    }
    if (glowObjects.length) {
      const glowDae = buildLampGlowDAE();
      if (glowDae) {
        zip.file(`${base}/map_assets/custom_assets/lamp_glow/${LAMP_GLOW_SHAPE}`, await toZipBinary(glowDae));
        streetFurnitureObjects.push(...glowObjects);
        lampGlowCount = glowObjects.length;
        console.log(`${BEAMNG_EXPORT_SERVICE_LOG} Lamp glows: ${lampGlowCount} (night only, seen from afar)`);
      }
    }
    zip.file(`${base}/main/MissionGroup/street_furniture/items.level.json`, toNDJSON(rewriteForLinks(streetFurnitureObjects)));
  }

  // ── main/MissionGroup/traffic_signals/items.level.json ──────────────────
  // Signal posts + heads; each head names its signals.json instance
  // (signalInstance) so core_trafficSignals lights it with the AI's phase.
  if (trafficSignalObjects.length > 0) {
    zip.file(`${base}/main/MissionGroup/traffic_signals/items.level.json`, toNDJSON(rewriteForLinks(trafficSignalObjects)));
  }

  if (garageLightObjects.length > 0) {
    zip.file(`${base}/main/MissionGroup/garage_lights/items.level.json`, toNDJSON(garageLightObjects));
  }

  // ── main/MissionGroup/carports/items.level.json ─────────────────────────
  if (carportObjects.length > 0) {
    zip.file(`${base}/main/MissionGroup/carports/items.level.json`, toNDJSON(rewriteForLinks(carportObjects)));
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

  // the building tiles: lit windows at night as the old single shape had them
  for (const t of buildingTileDaes) {
    levelObjectItems.push({
      __parent: 'level_objects',
      class: 'TSStatic',
      name: `buildings_${t.key}`,
      persistentId: generatePersistentId(),
      position: [roundTo(t.origin[0], 3), roundTo(t.origin[1], 3), 0],
      shapeName: `/levels/${levelName}/map_assets/custom_assets/osm_objects/buildings/bld_${t.key}.dae`,
      collisionType: 'Collision Mesh',
      decalType: 'Collision Mesh',
      prebuildCollisionData: 0,
      useInstanceRenderData: true,
      instanceColor: [0, 0, 0, 1],
      nightEmissive: '1',
      nightEmissiveColor: '255 214 160',
    });
  }

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
      // lit windows at night (beamngBuildings.js NIGHT_WINDOWS): the
      // environment sets instanceColor to this warm interior light at dusk
      instanceColor: [0, 0, 0, 1],
      nightEmissive: '1',   // (a string, as official levels write it: JSON true or 1 is dropped)
      nightEmissiveColor: '255 214 160',
    });
  }



  // Curbs collide; decals don't project onto them (edge blends stay on the ground).
  for (const t of sidewalkTileDaes) {
    levelObjectItems.push({
      __parent: 'level_objects',
      class: 'TSStatic',
      name: `sidewalks_${t.key}`,
      persistentId: generatePersistentId(),
      position: [0, 0, 0],
      shapeName: `/levels/${levelName}/map_assets/custom_assets/sidewalks/sidewalks_${t.key}.dae`,
      collisionType: 'Collision Mesh',
      decalType: 'None',
      prebuildCollisionData: 0,
      useInstanceRenderData: true,
    });
  }

  // Bridge decks, two objects per bridge, both colliding: the road surface,
  // which the road decals project onto, and the rest (parapets, sides,
  // girders, piers), which they must not smear down (decalType: None).
  for (const { key, origin, data, deckData, extras } of bridgeDaes) {
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
    for (const e of extras || []) {
      levelObjectItems.push({
        __parent: 'level_objects', class: 'TSStatic', name: `bridge_${key}_${e.kind}`, persistentId: generatePersistentId(), position: origin,
        shapeName: `/levels/${levelName}/map_assets/custom_assets/bridges/bridge_${key}_${e.kind}.dae`,
        collisionType: 'Collision Mesh', decalType: 'None', prebuildCollisionData: 0, useInstanceRenderData: true,
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

  // Railway track, one object per tile (railTrack.js): ballast and rails
  // collide; no decal projects onto it.
  for (const { key, origin } of railways?.daes || []) {
    levelObjectItems.push({
      __parent: 'level_objects', class: 'TSStatic', name: `railway_track_${key}`, persistentId: generatePersistentId(), position: origin,
      shapeName: `/levels/${levelName}/map_assets/custom_assets/railways/track_${key}.dae`,
      collisionType: 'Collision Mesh', decalType: 'None', prebuildCollisionData: 0, useInstanceRenderData: true,
    });
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
      // (drivable: the DAE has no collision mesh, so the default "Collision Mesh"
      // left it with none; ~260k triangles in all, cheap enough as its own)
      collisionType: 'Visible Mesh',
      decalType: 'Visible Mesh',
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
  // The user's points add a sphere each (spawnPlan, by info.json); the
  // default one is always spawn_default.
  const playerDropPointItems = spawnPlan.spheres.map((sp) => ({
      __parent: 'PlayerDropPoints',
      class: 'SpawnSphere',
      dataBlock: 'SpawnSphereMarker',
      name: sp.name,
      persistentId: generatePersistentId(),
      position: sp.position,
      rotationMatrix: sp.rotationMatrix,
      radius: 5,
    }));

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
  // the big entries compressed natively first (most of the work: the rest
  // of the bar is JSZip writing the archive)
  let zipShare = 0;
  const precompressed = await precompressZipEntries(zip, JSZip, {
    compressor: zipCompressor,
    onProgress: (fraction, name) => {
      const now = performance.now();
      if (now - lastZipReportAt < 250) return;
      lastZipReportAt = now;
      report(`Compressing the level ZIP (${formatBytes(zipTotalBytes)}, ${zipEntries.length} files): ${name.replace(`levels/${levelName}/`, '')}…`, fraction * 0.9);
    },
  });
  if (precompressed) {
    zipShare = 0.9;
    console.log(`${BEAMNG_EXPORT_SERVICE_LOG} ZIP: ${precompressed} big entries compressed natively.`);
  }
  const onZipPercent = (pct, currentFile) => {
    if (currentFile && currentFile !== zipCurrentFile) {
      if (zipCurrentFile) zipCostDone += entryCost(zipCurrentFile);
      zipCurrentFile = currentFile;
    }
    const now = performance.now();
    if (now - lastZipReportAt < 250) return;
    lastZipReportAt = now;
    const fraction = zipShare + (1 - zipShare) * (zipTotalCost > 0 ? zipCostDone / zipTotalCost : (Number(pct) || 0) / 100);
    const current = zipCurrentFile && !zipCurrentFile.endsWith('/')
      ? ` ${zipCurrentFile.replace(`levels/${levelName}/`, '')} (${formatBytes(zipEntryBytes.get(zipCurrentFile) || 0)})`
      : '';
    report(`Compressing the level ZIP (${formatBytes(zipTotalBytes)}, ${zipEntries.length} files)${current ? `:${current}` : ''}…`, fraction);
  };
  // Stream the archive to disk (OPFS) when available so the ~1 GB output never
  // has to accumulate in the JS heap; fall back to the in-memory blob elsewhere.
  // (options.zipSink { write(chunk) }: the caller's own file, written as it
  // comes; the desktop app's export runner. The result then has no blob.)
  let zipBlob = null; let zipDelivery;
  if (options.zipSink) {
    await streamZipToWritable(zip, options.zipSink, onZipPercent);
    zipDelivery = 'sink';
  } else {
    zipBlob = await generateZipToOPFS(zip, zipFilename, onZipPercent);
    zipDelivery = 'opfs-stream';
  }
  if (!zipBlob && zipDelivery !== 'sink') {
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
  return {
    blob: zipBlob, filename: `${levelName}.zip`, structureChecks, ingameProbes,
    // (for the export history: each step's time, and the steps reused from the last export)
    steps: processingLog.map((e) => ({ step: e.step, ms: Math.round(e.durationMs) })),
    reused: [...reusedSteps],
  };
}

// (tests: the planting on its own)
export { buildForestPlacements as __buildForestPlacements };
export { filterOSMFeaturesToBounds as __filterOSMFeaturesToBounds };
