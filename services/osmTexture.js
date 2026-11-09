import { buildRoadNetwork, getEffectiveRoadLayer, mergeLinearRoadSegments } from "./roadNetwork.js";
import { racewayHalfWidth } from "./roadWidth.js";
import { WC, steepRockFrom } from "./worldCover.js";

// Colors aligned to OSM Carto style definitions
// Source: https://github.com/gravitystorm/openstreetmap-carto (landcover.mss / water.mss)
// All surface/landuse colors darkened 40% vs OSM Carto defaults (×0.60) to reduce glare.
const COLORS = {
  // Vegetation / greens (OSM Carto)
  forest: "#687d5f",
  scrub: "#788167",
  heath: "#80825f",
  grass: "#7b8d6a",
  orchard: "#688662",
  farmland: "#8f9080",

  // Water / wetness (OSM Carto)
  water: "#667f86",
  wetland: "#7b8d6a",
  swamp: "#687d5f",
  glacier: "#858e8e",
  mud: "#8a847d",

  // Bare / earth (OSM Carto)
  bare: "#8f8984",
  sand: "#938c77",
  dirt: "#77776c",
  quarry: "#767575",

  // Developed / landuse (OSM Carto)
  residential: "#868686",
  commercial: "#8c8985",
  industrial: "#807d79",
  retail: "#9a9691",
  education: "#999989",
  military: "#928885",
  cemetery: "#667a69",
  sport: "#528672",
  recreation: "#859473",
  park: "#78967a",
  parking: "#8e8b87",
  aeroway: "#8c8b88",
  apron: "#838386",
  runway: "#6f6f6f",
  power: "#867d85",
  tourism: "#660033",
  hospital: "#999989",

  // Water / Aquatic features
  swimming_pool: "#667f86",
  marina: "#7f7b76", // Warm beige-gray marina/harbor fill
  harbourLand: "#8d838b",
  fountain: "#667f86",

  // Vegetated / Garden
  allotments: "#798773",
  flowerbed: "#7b8d6a",
  hedge: "#687d5f",

  // Hard surfaces (paving)
  cobblestone: "#545454", // Cobblestone / sett (dark grey)
  tiles: "#6e6e6e", // Paving stones / tiles (lighter grey)

  // Defaults
  building: "#827d79",
  buildingStroke: "#766d67",
  road: "#404040",
  path: "#7a7a7a",
  track: "#73685a", // Light brown dirt color
  // Concrete, but muted — at #e3e1db the dense suburban-US sidewalk grid drew a
  // bright halo around every street and parking lot in the baked texture.
  sidewalk: "#cbc8c1",
  barrier: "#76624f",
  bridgeInfra: "#56585c",
  coastline: "#5f7680",
  ocean: "#667f86",
  defaultLanduse: "#858585",

  // Markings
  markingWhite: "rgba(255, 255, 255, 0.7)",
  markingYellow: "rgba(255, 204, 0, 0.8)",
  markingRed: "rgba(255, 50, 50, 0.8)",
};

const hasExplicitGroundCover = (tags) => {
  if (!tags) return false;
  return !!(
    tags.surface ||
    tags.material ||
    tags.landcover ||
    tags.landuse ||
    tags.natural ||
    tags.water ||
    tags.wetland ||
    tags.waterway ||
    tags.aeroway
  );
};

const isBoundaryOnlyArea = (tags) => {
  if (!tags || !tags.boundary) return false;

  const boundaryType = String(tags.boundary).toLowerCase();
  const isBoundaryLike = [
    "administrative",
    "protected_area",
    "national_park",
    "political",
    "historic",
  ].includes(boundaryType);
  if (!isBoundaryLike) return false;

  return !hasExplicitGroundCover(tags);
};

// The colour of one land-cover / land-use / surface value, or null.
const colorOfSurface = (surface) => {
  if (["forest", "wood", "trees", "tree_row"].includes(surface))
    return COLORS.forest;
  if (
    [
      "grass",
      "meadow",
      "grassland",
      "fell",
      "park",
      "village_green",
      "garden",
      "recreation_ground",
      "common",
      "dog_park",
      "greenfield",
      "miniature_golf", // leisure=miniature_golf → grassy
      "fitness_centre",
      "fitness_station",
    ].includes(surface)
  )
    return COLORS.grass;
  if (["scrub", "heath", "tundra", "shrubbery", "bushes"].includes(surface))
    return COLORS.scrub;
  if (["orchard", "vineyard", "plant_nursery"].includes(surface))
    return COLORS.orchard;
  if (["farmland", "farmyard", "greenhouse_horticulture"].includes(surface))
    return COLORS.farmland;
  if (["allotments"].includes(surface)) return COLORS.allotments;
  if (["flowerbed"].includes(surface)) return COLORS.flowerbed;

  // Water / aquatic areas
  if (
    [
      "swimming_pool",
      "water_park",
      "salt_pond",
      "aquaculture",
      "harbour",
    ].includes(surface)
  )
    return COLORS.swimming_pool;
  if (["marina"].includes(surface)) return COLORS.marina;

  if (["sand", "beach", "shoal", "dune", "coastline", "beach_resort", "bathing_place"].includes(surface))
    return COLORS.sand;
  if (["bare_rock", "rock", "scree", "shingle", "shells", "marble"].includes(surface))
    return COLORS.bare;
  if (["glacier", "snow"].includes(surface)) return COLORS.glacier;
  if (
    [
      "mud", "ground", "dirt", "earth", "construction", "brownfield",
      "landfill", // landuse=landfill
      "wood",     // surface=wood (wooden decks etc)
      "woodchips", // surface=woodchips
    ].includes(surface)
  )
    return COLORS.dirt;

  // Hard paved surfaces
  if (
    [
      "cobblestone", "sett", "unhewn_cobblestone",
    ].includes(surface)
  )
    return COLORS.cobblestone;
  if (
    [
      "paving_stones", "concrete:plates", "tiles",
    ].includes(surface)
  )
    return COLORS.tiles;
  if (["fine_gravel", "compacted"].includes(surface)) return COLORS.quarry;

  if (["residential"].includes(surface)) return COLORS.residential;
  if (["commercial"].includes(surface)) return COLORS.commercial;
  if (["retail"].includes(surface)) return COLORS.retail;
  if (["industrial", "quarry", "railway", "garages", "depot"].includes(surface))
    return COLORS.industrial;
  if (["military"].includes(surface)) return COLORS.military;
  if (["cemetery"].includes(surface)) return COLORS.cemetery;
  if (
    [
      "pitch",
      "track",
      "stadium",
      "golf_course",
      "fairway",
      "green",
      "tee",
      "bunker",
      "playground",
      "sports_centre",
      "ice_rink",
      "horse_riding",
      "bowling_alley",
      "disc_golf_course",
      "shooting_range",
    ].includes(surface)
  )
    return COLORS.sport;
  if (["recreation", "recreation_ground"].includes(surface))
    return COLORS.recreation;
  if (["camp_site"].includes(surface)) return COLORS.park;
  if (["attraction", "zoo", "camp_site", "theme_park"].includes(surface))
    return COLORS.tourism;

  // (the audit of real exports: values that fell to the fallback colour)
  if (["parking_space", "fuel", "bicycle_parking", "bus_station"].includes(surface)) return COLORS.parking;
  if (["hot_tub"].includes(surface)) return COLORS.swimming_pool;
  if (["religious", "picnic_site"].includes(surface)) return COLORS.park;
  if (["cliff"].includes(surface)) return COLORS.bare;
  if (["gravel", "pebblestone"].includes(surface)) return COLORS.quarry;
  if (["asphalt", "paved"].includes(surface)) return COLORS.parking;
  if (["concrete"].includes(surface)) return COLORS.tiles;
  if (["generator", "plant", "substation"].includes(surface)) return COLORS.power;
  // (not civic / care / hotel grounds: those are lawns, trees and car parks
  // around a building, which the satellite or the default shows better
  // than a flat commercial grey)
  return null;
};

// Underground (a tunnel's outline, a culverted stream, an underground car
// park): not the surface the texture shows, so not drawn at all.
export const isUndergroundArea = (tags) => !!tags && (tags.man_made === "tunnel" || !!tags.tunnel
  || tags.location === "underground" || tags.parking === "underground" || Number(tags.layer) < 0);

export const getFeatureColor = (tags, baseColor = COLORS.defaultLanduse) => {
  if (!tags) return baseColor;
  if (isBoundaryOnlyArea(tags)) return baseColor;

  const isMarinaOrHarbor =
    tags.leisure === "marina" ||
    tags.water === "harbour" ||
    tags.water === "dock" ||
    tags.harbour === "yes" ||
    tags["seamark:type"] === "harbour" ||
    tags["seamark:type"] === "harbour_basin" ||
    tags["seamark:harbour:category"] === "marina";
  if (tags.landuse === "harbour") return COLORS.harbourLand;
  if (isMarinaOrHarbor) return COLORS.marina;

  // --- OSM2World inspired surface mapping ---
  // Priority 1: Water
  if (
    tags.natural === "water" ||
    tags.waterway ||
    tags.landuse === "reservoir" ||
    tags.landuse === "basin" ||
    tags.water
  )
    return tags.source === "coastline" ? COLORS.ocean : COLORS.water;
  if (tags.natural === "coastline") return COLORS.coastline;
  if (tags.natural === "wetland" || tags.wetland) {
    const type = tags.wetland;
    if (type === "swamp") return COLORS.forest;
    if (type === "mangrove") return COLORS.scrub;
    if (type === "bog" || type === "fen" || type === "string_bog")
      return COLORS.heath;
    if (type === "marsh" || type === "reedbed" || type === "wet_meadow")
      return COLORS.grass;
    return COLORS.wetland;
  }
  if (tags.natural === "glacier") return COLORS.glacier;

  // Priority 2: Specific High-Level Categories
  if (tags.aeroway) {
    if (["runway", "taxiway"].includes(tags.aeroway)) return COLORS.runway;
    if (tags.aeroway === "apron") return COLORS.apron;
    return COLORS.aeroway;
  }

  if (tags.amenity === "parking") return COLORS.parking;
  if (
    tags.amenity === "school" ||
    tags.amenity === "university" ||
    tags.amenity === "college" ||
    tags.amenity === "kindergarten"
  )
    return COLORS.education;
  if (tags.amenity === "hospital" || tags.amenity === "clinic")
    return COLORS.hospital;

  // Aquatic leisure / amenity
  if (tags.leisure === "swimming_pool") return COLORS.swimming_pool;
  if (tags.leisure === "water_park") return COLORS.swimming_pool;
  if (
    tags.leisure === "marina" ||
    tags.water === "harbour" ||
    tags.water === "dock" ||
    tags.harbour === "yes" ||
    tags["seamark:type"] === "harbour" ||
    tags["seamark:type"] === "harbour_basin" ||
    tags["seamark:harbour:category"] === "marina"
  )
    return COLORS.marina;
  if (tags.amenity === "fountain") return COLORS.fountain;

  // Cemetery variant tags
  if (tags.amenity === "grave_yard") return COLORS.cemetery;

  // Barriers that cover area
  if (tags.barrier === "hedge") return COLORS.hedge;
  if (tags.natural === "shrubbery") return COLORS.hedge;

  if (tags.power === "plant" || tags.power === "substation")
    return COLORS.power;
  if (
    tags.man_made === "pier" ||
    tags.man_made === "breakwater" ||
    tags.man_made === "groyne"
  )
    return COLORS.bare;
  if (tags.man_made === "bridge") return COLORS.bridgeInfra;

  // Priority 3: Surface / Landuse / Leisure generic mapping: each tag in
  // turn until one is known (an unknown surface=* value hid the pitch,
  // park or yard colour its leisure / landuse tag would have given)
  const candidates = [tags.surface, tags.material, tags.landcover, tags.landuse, tags.natural, tags.leisure,
    tags.golf, tags.recreation, tags.tourism, tags.amenity, tags.power, tags.man_made];
  for (const surface of candidates) {
    if (!surface) continue;
    const color = colorOfSurface(surface);
    if (color) return color;
  }
  return baseColor;
};

// Help map tags to user-friendly categories (simplified for internal use)
export const getFeatureCategory = (feature) => {
  return feature.type;
};

// Helper to calculate approximate area of a LatLng feature for Z-sorting
const getFeatureArea = (feature) => {
  const points = feature.geometry;
  if (points.length < 3) return 0;

  let area = 0;
  for (let i = 0; i < points.length; i++) {
    const p1 = points[i];
    const p2 = points[(i + 1) % points.length];
    area += (p2.lng - p1.lng) * (p2.lat + p1.lat);
  }
  return Math.abs(area);
};

// --- Path Smoothing Helpers ---

const subdivideAndSmooth = (points, iterations = 1) => {
  if (points.length < 3) return points;
  let current = points;
  for (let i = 0; i < iterations; i++) {
    const next = [];
    // Keep start point
    next.push(current[0]);
    for (let j = 0; j < current.length - 1; j++) {
      const p1 = current[j];
      const p2 = current[j + 1];

      // Chaikin's algorithm: generate two new points at 1/4 and 3/4 positions
      next.push({
        x: p1.x * 0.75 + p2.x * 0.25,
        y: p1.y * 0.75 + p2.y * 0.25,
      });
      next.push({
        x: p1.x * 0.25 + p2.x * 0.75,
        y: p1.y * 0.25 + p2.y * 0.75,
      });
    }
    // Keep end point
    next.push(current[current.length - 1]);
    current = next;
  }
  return current;
};

// --- Road Geometry Helpers ---

const getOffsetPath = (projected, offsetMeters, SCALE_FACTOR) => {
  if (projected.length < 2) return [];
  const offsetPath = [];

  for (let i = 0; i < projected.length; i++) {
    const p = projected[i];
    let dx, dy;

    if (i === 0) {
      dx = projected[i + 1].x - projected[i].x;
      dy = projected[i + 1].y - projected[i].y;
    } else if (i === projected.length - 1) {
      dx = projected[i].x - projected[i - 1].x;
      dy = projected[i].y - projected[i - 1].y;
    } else {
      dx = projected[i + 1].x - projected[i - 1].x;
      dy = projected[i + 1].y - projected[i - 1].y;
    }

    const len = Math.sqrt(dx * dx + dy * dy);
    if (len === 0) {
      offsetPath.push(p);
      continue;
    }

    const nx = -dy / len;
    const ny = dx / len;

    offsetPath.push({
      x: p.x + nx * offsetMeters * SCALE_FACTOR,
      y: p.y + ny * offsetMeters * SCALE_FACTOR,
    });
  }
  return offsetPath;
};

const drawPathData = (ctx, points) => {
  if (points.length < 2) return;
  ctx.moveTo(points[0].x, points[0].y);
  for (let i = 1; i < points.length; i++) {
    ctx.lineTo(points[i].x, points[i].y);
  }
};

const trimPolylineByDistance = (points, trimStartPx, trimEndPx) => {
  if (!points || points.length < 2) return points || [];

  const segmentLengths = [];
  let totalLength = 0;
  for (let i = 0; i < points.length - 1; i++) {
    const dx = points[i + 1].x - points[i].x;
    const dy = points[i + 1].y - points[i].y;
    const len = Math.sqrt(dx * dx + dy * dy);
    segmentLengths.push(len);
    totalLength += len;
  }

  if (totalLength <= trimStartPx + trimEndPx + 1e-6) return [];

  const carve = (fromStart, distancePx) => {
    if (distancePx <= 0) {
      return { index: fromStart ? 0 : points.length - 1, t: 0 };
    }

    let acc = 0;
    if (fromStart) {
      for (let i = 0; i < segmentLengths.length; i++) {
        const len = segmentLengths[i];
        if (acc + len >= distancePx) {
          return { index: i, t: (distancePx - acc) / Math.max(len, 1e-9) };
        }
        acc += len;
      }
      return { index: segmentLengths.length - 1, t: 1 };
    }

    for (let i = segmentLengths.length - 1; i >= 0; i--) {
      const len = segmentLengths[i];
      if (acc + len >= distancePx) {
        // From end: t=0 means point i, t=1 means point i+1
        const tFromEnd = (distancePx - acc) / Math.max(len, 1e-9);
        return { index: i, t: 1 - tFromEnd };
      }
      acc += len;
    }
    return { index: 0, t: 0 };
  };

  const startCut = carve(true, trimStartPx);
  const endCut = carve(false, trimEndPx);

  const makePoint = (segIndex, t) => {
    const a = points[segIndex];
    const b = points[segIndex + 1];
    return {
      x: a.x + (b.x - a.x) * t,
      y: a.y + (b.y - a.y) * t,
    };
  };

  const startPoint = makePoint(startCut.index, startCut.t);
  const endPoint = makePoint(endCut.index, endCut.t);

  // If cuts crossed, return empty.
  if (startCut.index > endCut.index || (startCut.index === endCut.index && startCut.t >= endCut.t)) {
    return [];
  }

  const trimmed = [startPoint];
  for (let i = startCut.index + 1; i <= endCut.index; i++) {
    trimmed.push(points[i]);
  }
  trimmed.push(endPoint);
  return trimmed;
};

/**
 * Get the left and right border polylines of a road, by offsetting the
 * centerline by half the road width on each side.
 */
const getRoadBorders = (centerPoints, halfWidth, SCALE_FACTOR) => {
  const left = getOffsetPath(centerPoints, -halfWidth, SCALE_FACTOR);
  const right = getOffsetPath(centerPoints, halfWidth, SCALE_FACTOR);
  return { left, right };
};

/**
 * Determine if a road surface is "unmarked" (no lane markings).
 * Follows OSM2World: gravel, earth, sand, dirt, grass, etc. get no markings.
 */
const isUnmarkedSurface = (tags) => {
  const surface = tags.surface;
  if (tags.lane_markings === "no") return true;
  if (tags.lane_markings === "yes") return false;
  const unmarkedSurfaces = [
    "gravel", "dirt", "earth", "ground", "grass", "sand", "mud",
    "unpaved", "compacted", "fine_gravel", "pebblestone", "rock", "snow", "ice",
  ];
  if (surface && unmarkedSurfaces.includes(surface)) return true;
  // Tracks are typically unmarked unless explicitly tagged
  if (tags.highway === "track") return true;
  return false;
};

/**
 * Determine the center line marking style based on road classification.
 * Based on OSM2World's approach + real-world conventions:
 *  - Motorways/trunks: solid white edge lines, white dashed lane separators
 *  - Primary/secondary with 2+ lanes each direction: double yellow
 *  - Tertiary/unclassified 2-lane undivided: dashed yellow (passing allowed)
 *  - Residential/service: no center line (unless 4+ lanes)
 *  - One-way: no center divider at all
 */
const getCenterLineStyle = (tags, lanesTotal, isOneWay) => {
  if (isOneWay) return null;

  const highway = tags.highway;

  // Link roads / ramps typically do not carry centerline markings in map textures.
  if (typeof highway === "string" && highway.endsWith("_link")) {
    return null;
  }

  // Motorways use white markings, not yellow
  if (highway === "motorway" || highway === "trunk" ||
      highway === "motorway_link" || highway === "trunk_link") {
    return { color: COLORS.markingWhite, style: "solid", double: false };
  }

  // Major roads (primary/secondary) with enough lanes → double yellow
  if (highway === "primary" || highway === "secondary" ||
      highway === "primary_link" || highway === "secondary_link") {
    if (lanesTotal >= 4) {
      return { color: COLORS.markingYellow, style: "solid", double: true };
    }
    // 2-lane primary/secondary → dashed yellow (passing zone)
    return { color: COLORS.markingYellow, style: "dashed", double: false };
  }

  // Tertiary → dashed yellow center line
  if (highway === "tertiary" || highway === "tertiary_link") {
    return { color: COLORS.markingYellow, style: "dashed", double: false };
  }

  // Residential/unclassified — only mark if 4+ lanes
  if (highway === "residential" || highway === "unclassified") {
    if (lanesTotal >= 4) {
      return { color: COLORS.markingYellow, style: "dashed", double: false };
    }
    return null; // no center line
  }

  // Service roads → no center line
  return null;
};

/**
 * Determine edge line style. Motorways/trunks get solid white edge lines.
 * Primary/secondary get thin white edge lines.
 */
const getEdgeLineStyle = (tags) => {
  const highway = tags.highway;
  if (highway === "motorway" || highway === "trunk" ||
      highway === "motorway_link" || highway === "trunk_link") {
    return { color: COLORS.markingWhite, width: 0.15 };
  }
  if (highway === "primary" || highway === "secondary") {
    return { color: COLORS.markingWhite, width: 0.1 };
  }
  return null;
};

const parseNumeric = (value) => {
  if (value == null) return null;
  const num = Number.parseFloat(String(value).trim());
  return Number.isFinite(num) ? num : null;
};

const parsePositiveInt = (value) => {
  if (value == null) return null;
  const num = Number.parseInt(String(value).trim(), 10);
  return Number.isFinite(num) && num > 0 ? num : null;
};

const countLanesFromDelimited = (value) => {
  if (!value) return null;
  const tokens = String(value)
    .split("|")
    .map((part) => part.trim())
    .filter(Boolean);
  return tokens.length > 0 ? tokens.length : null;
};

const parseWidthMeters = (value) => {
  if (!value) return null;
  const raw = String(value).trim().toLowerCase();

  if (raw.includes("ft")) {
    const n = parseNumeric(raw.replace("ft", "").trim());
    return n != null ? n * 0.3048 : null;
  }

  if (raw.includes("m")) {
    return parseNumeric(raw.replace("m", "").trim());
  }

  const plain = parseNumeric(raw);
  if (plain == null) return null;

  // Heuristic: values > 40 are usually feet when no unit is provided.
  return plain > 40 ? plain * 0.3048 : plain;
};

const getDefaultLaneWidth = (highway) => {
  if (["motorway", "motorway_link", "trunk", "trunk_link"].includes(highway)) {
    return 3.7;
  }
  if (["primary", "primary_link", "secondary", "secondary_link"].includes(highway)) {
    return 3.5;
  }
  if (["tertiary", "tertiary_link"].includes(highway)) {
    return 3.25;
  }
  if (["residential", "unclassified", "living_street"].includes(highway)) {
    return 3.0;
  }
  if (["service"].includes(highway)) {
    return 2.8;
  }
  return 3.0;
};

const getMaxReasonableLanes = (highway, isOneWay) => {
  if (["motorway", "trunk"].includes(highway)) {
    return isOneWay ? 6 : 10;
  }
  if (["motorway_link", "trunk_link", "primary_link", "secondary_link", "tertiary_link"].includes(highway)) {
    return isOneWay ? 3 : 4;
  }
  if (["primary", "secondary"].includes(highway)) {
    return isOneWay ? 5 : 8;
  }
  return isOneWay ? 4 : 6;
};

const inferLaneCounts = (tags, isOneWay, highway) => {
  const explicitTotal = parsePositiveInt(tags.lanes);

  let lanesForward =
    parsePositiveInt(tags["lanes:forward"]) ||
    countLanesFromDelimited(tags["turn:lanes:forward"]);
  let lanesBackward =
    parsePositiveInt(tags["lanes:backward"]) ||
    countLanesFromDelimited(tags["turn:lanes:backward"]);

  const maxLanes = getMaxReasonableLanes(highway, isOneWay);

  if (isOneWay) {
    if (!lanesForward) {
      lanesForward =
        explicitTotal ||
        countLanesFromDelimited(tags["turn:lanes"]) ||
        (highway === "motorway" || highway === "trunk" ? 2 : 1);
    }
    lanesForward = Math.min(maxLanes, Math.max(1, lanesForward));
    return {
      lanesTotal: Math.max(1, lanesForward),
      lanesForward: Math.max(1, lanesForward),
      lanesBackward: 0,
    };
  }

  if (explicitTotal) {
    if (!lanesForward && !lanesBackward) {
      lanesForward = Math.ceil(explicitTotal / 2);
      lanesBackward = explicitTotal - lanesForward;
    } else if (!lanesForward) {
      lanesForward = Math.max(1, explicitTotal - lanesBackward);
    } else if (!lanesBackward) {
      lanesBackward = Math.max(1, explicitTotal - lanesForward);
    }
  }

  if (!lanesForward && !lanesBackward) {
    const inferredTotal =
      explicitTotal ||
      (highway === "motorway" || highway === "trunk" ? 4 :
       ["motorway_link", "trunk_link", "primary_link", "secondary_link", "tertiary_link"].includes(highway) ? 1 :
       ["service", "track"].includes(highway) ? 1 : 2);
    lanesForward = Math.ceil(inferredTotal / 2);
    lanesBackward = Math.max(1, inferredTotal - lanesForward);
  }

  lanesForward = Math.max(1, lanesForward || 1);
  lanesBackward = Math.max(1, lanesBackward || 1);

  let lanesTotal = lanesForward + lanesBackward;
  if (lanesTotal > maxLanes) {
    const scale = maxLanes / lanesTotal;
    lanesForward = Math.max(1, Math.round(lanesForward * scale));
    lanesBackward = Math.max(1, maxLanes - lanesForward);
    lanesTotal = lanesForward + lanesBackward;
  }

  lanesTotal = Math.max(2, lanesTotal);
  return {
    lanesTotal,
    lanesForward,
    lanesBackward,
  };
};

const shouldSkipLaneDetail = (tags = {}, layout = null) => {
  const highway = tags.highway;
  const layer = getEffectiveRoadLayer(tags);

  if (["motorway_link", "trunk_link", "primary_link", "secondary_link", "tertiary_link"].includes(highway)) {
    return true;
  }

  if (layer !== 0 || tags.bridge === "yes" || tags.tunnel === "yes" || tags.covered === "yes") {
    return true;
  }

  if (layout && layout.lanesTotal >= 6) {
    return true;
  }

  return false;
};

const getLaneLayout = (tags) => {
  const highway = tags.highway;
  const explicitNoOneway = tags.oneway === "no" || tags.oneway === "0";
  const explicitYesOneway =
    tags.oneway === "yes" || tags.oneway === "1" || tags.oneway === "true";
  const impliedOneway =
    [
      "motorway",
      "motorway_link",
      "trunk_link",
      "primary_link",
      "secondary_link",
      "tertiary_link",
    ].includes(highway) && !explicitNoOneway;
  const isOneWay =
    explicitYesOneway ||
    impliedOneway;
  const laneCounts = inferLaneCounts(tags, isOneWay, highway);
  const lanesT = laneCounts.lanesTotal;
  const lanesF = laneCounts.lanesForward;
  const lanesB = laneCounts.lanesBackward;
  const defaultLaneWidth = getDefaultLaneWidth(highway);

  const layout = {
    totalWidth: parseWidthMeters(tags.width) || 0,
    lanes: [],
    highway,
    isOneWay,
    lanesTotal: lanesT,
    unmarked: isUnmarkedSurface(tags),
  };

  // Width estimation (following OSM2World's defaults)
  if (layout.totalWidth === 0) {
    // (a racetrack is no one-lane road: its width by kind, as the export's)
    if (highway === "raceway") layout.totalWidth = 2 * racewayHalfWidth(tags);
    else if (highway === "service") {
      const subtype = String(tags.service ?? "").trim().toLowerCase();
      // Driveways and drive-throughs are single-car paths, not streets.
      const minWidth = subtype === "driveway" || subtype === "drive-through" ? 3.0 : 4.0;
      layout.totalWidth = Math.max(lanesT * defaultLaneWidth, minWidth);
    } else {
      layout.totalWidth = lanesT * defaultLaneWidth;
    }
  }

  // Skip lane detail for unmarked surfaces
  if (layout.unmarked) return layout;

  if (shouldSkipLaneDetail(tags, layout)) {
    return layout;
  }

  const hasLeftSidewalk = tags.sidewalk === "left" || tags.sidewalk === "both";
  const hasRightSidewalk =
    tags.sidewalk === "right" || tags.sidewalk === "both";
  const hasLeftCycleway =
    tags["cycleway:left"] === "lane" || tags.cycleway === "lane";
  const hasRightCycleway =
    tags["cycleway:right"] === "lane" || tags.cycleway === "lane";

  // Build lane list (Left to Right)
  if (hasLeftSidewalk)
    layout.lanes.push({ type: "sidewalk", width: 2.0, color: COLORS.sidewalk });
  if (hasLeftCycleway)
    layout.lanes.push({ type: "cycleway", width: 1.5, color: "#704444" });

  const edgeLine = getEdgeLineStyle(tags);
  if (edgeLine)
    layout.lanes.push({ type: "edge", width: edgeLine.width, color: edgeLine.color });

  // Vehicle Lanes (Backward)
  if (!isOneWay) {
    for (let i = 0; i < lanesB; i++) {
      if (i > 0)
        layout.lanes.push({
          type: "separator",
          width: 0.12,
          color: COLORS.markingWhite,
          dash: [3, 6],
        });
      layout.lanes.push({ type: "vehicle", width: defaultLaneWidth });
    }
    // Center Divider
    const centerStyle = getCenterLineStyle(tags, lanesT, isOneWay);
    if (centerStyle) {
      layout.lanes.push({
        type: "divider",
        width: 0.12,
        color: centerStyle.color,
        double: centerStyle.double,
        dash: centerStyle.style === "dashed" ? [3, 6] : null,
      });
    }
  }

  // Vehicle Lanes (Forward)
  for (let i = 0; i < (isOneWay ? lanesT : lanesF); i++) {
    if (i > 0)
      layout.lanes.push({
        type: "separator",
        width: 0.12,
        color: COLORS.markingWhite,
        dash: [3, 6],
      });
    layout.lanes.push({ type: "vehicle", width: defaultLaneWidth });
  }

  if (edgeLine)
    layout.lanes.push({ type: "edge", width: edgeLine.width, color: edgeLine.color });
  if (hasRightCycleway)
    layout.lanes.push({ type: "cycleway", width: 1.5, color: "#704444" });
  if (hasRightSidewalk)
    layout.lanes.push({ type: "sidewalk", width: 2.0, color: COLORS.sidewalk });

  // Normalize widths to fit total width
  let currentSum = layout.lanes.reduce((sum, l) => sum + l.width, 0);
  if (currentSum > 0) {
    const scale = layout.totalWidth / currentSum;
    layout.lanes.forEach((l) => (l.width *= scale));
  }

  // Calculate offsets from center
  let offset = -layout.totalWidth / 2;
  layout.lanes.forEach((l) => {
    l.offset = offset + l.width / 2;
    offset += l.width;
  });

  return layout;
};

const getTextureCorridorStyleKey = (segment) => {
  const tags = segment?.tags || {};
  return JSON.stringify([
    segment?.highway || '',
    segment?.layer ?? '',
    tags.name || '',
    tags.ref || '',
    tags.surface || '',
    tags.oneway || '',
  ]);
};

const STABLE_TEXTURE_WIDTH_HIGHWAYS = new Set([
  'motorway',
  'motorway_link',
  'trunk',
  'trunk_link',
  'primary',
  'primary_link',
  'secondary',
  'secondary_link',
]);

const getTextureWidthCorridorKey = (road) => {
  const tags = road?.tags || {};
  return JSON.stringify([
    road?.highway || tags.highway || '',
    road?.layer ?? getEffectiveRoadLayer(tags),
    tags.name || '',
    tags.ref || '',
    tags.oneway || '',
  ]);
};

const buildStableTextureWidthMap = (roads) => {
  const widthGroups = new Map();

  roads.forEach((road) => {
    const highway = road?.tags?.highway;
    if (!STABLE_TEXTURE_WIDTH_HIGHWAYS.has(highway)) return;

    const members = Array.isArray(road.members) && road.members.length > 0 ? road.members : [road];
    const key = getTextureWidthCorridorKey(road);
    const widths = widthGroups.get(key) || [];
    for (const member of members) {
      const width = getLaneLayout(member.tags || {}).totalWidth;
      if (Number.isFinite(width) && width > 0) widths.push(width);
    }
    widthGroups.set(key, widths);
  });

  const stableWidths = new Map();
  for (const [key, widths] of widthGroups.entries()) {
    if (widths.length === 0) continue;
    const highway = JSON.parse(key)[0];
    const laneWidth = getDefaultLaneWidth(highway);
    const minWidth = Math.min(...widths);
    const maxWidth = Math.max(...widths);
    // Major-road texture rendering should not visibly pinch when OSM encodes
    // short turn-lane transitions or inconsistent shoulder/cycle-lane tagging.
    if ((maxWidth - minWidth) <= (laneWidth * 2 + 0.75)) {
      stableWidths.set(key, maxWidth);
    }
  }

  return stableWidths;
};

/**
 * Pavement colour per road. Parking aisles and drive-throughs read as part
 * of the lot they sit in, not as streets — painting them full road colour
 * (#404040) over the much lighter parking fill (#8e8b87) turns every lot
 * into high-contrast spaghetti. Driveways stay road-like but softer.
 */
const UNPAVED_ROAD = new Set(["unpaved", "dirt", "earth", "ground", "mud", "clay", "sand", "gravel", "fine_gravel", "compacted", "pebblestone", "grass"]);
const getRoadPavementColor = (road) => {
  const tags = road?.tags || {};
  // a dirt road or track is no asphalt (surface tag; off-road racing lines
  // often carry none)
  if (UNPAVED_ROAD.has(String(tags.surface ?? "").toLowerCase())) return COLORS.track;
  if (tags.highway === "raceway" && !tags.surface && /motocross|supercross|enduro|bmx|speedway|autocross|rallycross/.test(String(tags.sport ?? "").toLowerCase())) return COLORS.track;
  if (tags.highway === 'service') {
    const subtype = String(tags.service ?? '').trim().toLowerCase();
    if (subtype === 'parking_aisle' || subtype === 'drive-through') return '#7f7c78';
    if (subtype === 'driveway') return '#56534f';
  }
  return COLORS.road;
};

const getStableTextureRoadWidth = (road, stableWidthMap = null) => {
  const layout = getLaneLayout(road.tags || {});
  const baseWidth = layout.totalWidth;
  const highway = road.tags?.highway;
  if (!STABLE_TEXTURE_WIDTH_HIGHWAYS.has(highway)) {
    return baseWidth;
  }

  const stableWidth = stableWidthMap?.get(getTextureWidthCorridorKey(road));
  if (Number.isFinite(stableWidth) && stableWidth > 0) {
    return stableWidth;
  }

  return baseWidth;
};

// --- Junction / Intersection Rendering ---

/**
 * Build a spatial index of road endpoints for fast junction detection.
 * Groups nearby endpoints (within tolerance) at shared OSM nodes.
 */
const buildJunctionMap = (roads, toPixel) => {
  const network = buildRoadNetwork(roads, { layerResolver: getEffectiveRoadLayer });
  const result = new Map();
  for (const [key, roadsAtLayer] of network.intersections.entries()) {
    const sample = roadsAtLayer[0];
    const pt = sample?.isStart ? sample.road.geometry[0] : sample.road.geometry[sample.road.geometry.length - 1];
    if (!pt) continue;
    result.set(key, {
      lat: pt.lat,
      lng: pt.lng,
      roads: roadsAtLayer,
      pixel: toPixel(pt.lat, pt.lng),
    });
  }

  // Keep per-layer junction groups with 2+ connecting roads.
  for (const [key, junction] of Array.from(result.entries())) {
    if (!junction.roads || junction.roads.length < 2) {
      result.delete(key);
    }
  }

  return result;
};

const buildJunctionCap = (junction, toPixel, SCALE_FACTOR, stableWidthMap) => {
  const center = junction.pixel;
  const arms = [];
  let maxHalfW = 0;

  let capColor = COLORS.road;
  junction.roads.forEach(({ road, isStart }) => {
    const halfW = (getStableTextureRoadWidth(road, stableWidthMap) / 2) * SCALE_FACTOR;
    if (halfW > maxHalfW) capColor = getRoadPavementColor(road);
    maxHalfW = Math.max(maxHalfW, halfW);
    const geom = road.geometry;
    if (geom.length < 2) return;

    let p0;
    let p1;
    if (isStart) {
      p0 = toPixel(geom[0].lat, geom[0].lng);
      p1 = toPixel(geom[1].lat, geom[1].lng);
    } else {
      p0 = toPixel(geom[geom.length - 1].lat, geom[geom.length - 1].lng);
      p1 = toPixel(geom[geom.length - 2].lat, geom[geom.length - 2].lng);
    }

    const dx = p1.x - p0.x;
    const dy = p1.y - p0.y;
    const len = Math.sqrt(dx * dx + dy * dy);
    if (len < 0.001) return;

    const dirX = dx / len;
    const dirY = dy / len;
    const nx = -dirY;
    const ny = dirX;
    const outAngle = Math.atan2(dy, dx);

    arms.push({
      halfW,
      dirX,
      dirY,
      outAngle,
      cw: { x: p0.x + nx * halfW, y: p0.y + ny * halfW },
      ccw: { x: p0.x - nx * halfW, y: p0.y - ny * halfW },
    });
  });

  if (arms.length < 3) return null;
  arms.sort((a, b) => a.outAngle - b.outAngle);

  const commands = [];
  for (let i = 0; i < arms.length; i++) {
    const curr = arms[i];
    const next = arms[(i + 1) % arms.length];

    if (i === 0) commands.push({ type: 'move', x: curr.ccw.x, y: curr.ccw.y });
    commands.push({ type: 'line', x: curr.cw.x, y: curr.cw.y });

    const det = curr.dirX * (-next.dirY) - curr.dirY * (-next.dirX);
    if (Math.abs(det) < 0.001) {
      commands.push({ type: 'line', x: next.ccw.x, y: next.ccw.y });
      continue;
    }

    const dX = next.ccw.x - curr.cw.x;
    const dY = next.ccw.y - curr.cw.y;
    const t = (-dX * next.dirY + dY * next.dirX) / det;

    let cpX = curr.cw.x + t * curr.dirX;
    let cpY = curr.cw.y + t * curr.dirY;
    const cornerDist = Math.sqrt((cpX - center.x) ** 2 + (cpY - center.y) ** 2);
    if (cornerDist > maxHalfW * 4) {
      const midX = (curr.cw.x + next.ccw.x) / 2;
      const midY = (curr.cw.y + next.ccw.y) / 2;
      cpX = midX * 0.4 + center.x * 0.6;
      cpY = midY * 0.4 + center.y * 0.6;
    }

    commands.push({ type: 'quad', cx: cpX, cy: cpY, x: next.ccw.x, y: next.ccw.y });
  }

  return {
    center,
    centerRadius: maxHalfW * 0.28,
    color: capColor,
    commands,
  };
};

const buildJunctionCaps = (junctions, toPixel, SCALE_FACTOR, stableWidthMap) => {
  const caps = [];
  for (const [, junction] of junctions) {
    const cap = buildJunctionCap(junction, toPixel, SCALE_FACTOR, stableWidthMap);
    if (cap) caps.push(cap);
  }
  return caps;
};

/**
 * Render junction areas as smooth polygons with curved corners.
 * Inspired by OSM2World's RoadJunction: connects road border edges with
 * quadratic bezier curves whose control points lie at the intersection
 * of adjacent road edge lines, creating natural rounded‐corner shapes.
 * Also covers the center area so that any lane markings drawn through the
 * junction are cleanly erased.
 */
const renderJunctions = (ctx, junctionCaps) => {
  for (const cap of junctionCaps) {
    ctx.beginPath();
    for (const command of cap.commands) {
      if (command.type === 'move') ctx.moveTo(command.x, command.y);
      else if (command.type === 'line') ctx.lineTo(command.x, command.y);
      else if (command.type === 'quad') ctx.quadraticCurveTo(command.cx, command.cy, command.x, command.y);
    }
    ctx.closePath();
    ctx.fillStyle = cap.color || COLORS.road;
    ctx.fill();

    ctx.beginPath();
    ctx.arc(cap.center.x, cap.center.y, cap.centerRadius, 0, Math.PI * 2);
    ctx.fill();
  }
};

// --- Crosswalk Rendering ---

/**
 * Detect where footways/paths cross roads and draw crosswalk markings.
 * Also checks OSM highway=crossing nodes.
 */
const renderCrosswalks = (ctx, roads, allFeatures, toPixel, SCALE_FACTOR) => {
  // Collect footway/path features
  const footways = allFeatures.filter(
    (f) => f.type === "road" && ["footway", "path", "pedestrian", "cycleway"].includes(f.tags?.highway)
  );

  const crossingPoints = [];
  const crossingKeys = new Set();

  const addCrossingPoint = (x, y, nx, ny, roadWidth) => {
    const key = `${Math.round(x / 3)},${Math.round(y / 3)}`;
    if (crossingKeys.has(key)) return;
    crossingKeys.add(key);
    crossingPoints.push({ x, y, nx, ny, roadWidth });
  };

  const segmentIntersection = (a, b, c, d) => {
    const rX = b.x - a.x;
    const rY = b.y - a.y;
    const sX = d.x - c.x;
    const sY = d.y - c.y;

    const denom = rX * sY - rY * sX;
    if (Math.abs(denom) < 1e-6) return null;

    const uNum = (c.x - a.x) * rY - (c.y - a.y) * rX;
    const tNum = (c.x - a.x) * sY - (c.y - a.y) * sX;
    const u = uNum / denom;
    const t = tNum / denom;

    if (t < 0 || t > 1 || u < 0 || u > 1) return null;

    return {
      x: a.x + t * rX,
      y: a.y + t * rY,
    };
  };

  // Method 1: Exact polyline intersections between sidewalks and vehicle roads.
  footways.forEach((fw) => {
    const fwGeom = fw.geometry;
    if (!fwGeom || fwGeom.length < 2) return;

    roads.forEach((road) => {
      const roadLayout = getLaneLayout(road.tags || {});
      const roadHalfW = roadLayout.totalWidth / 2;
      const roadGeom = road.geometry;
      if (!roadGeom || roadGeom.length < 2) return;

      for (let i = 0; i < fwGeom.length - 1; i++) {
        const fA = toPixel(fwGeom[i].lat, fwGeom[i].lng);
        const fB = toPixel(fwGeom[i + 1].lat, fwGeom[i + 1].lng);

        for (let j = 0; j < roadGeom.length - 1; j++) {
          const rA = toPixel(roadGeom[j].lat, roadGeom[j].lng);
          const rB = toPixel(roadGeom[j + 1].lat, roadGeom[j + 1].lng);
          const hit = segmentIntersection(fA, fB, rA, rB);
          if (!hit) continue;

          const segDx = rB.x - rA.x;
          const segDy = rB.y - rA.y;
          const segLen = Math.sqrt(segDx * segDx + segDy * segDy);
          if (segLen < 1e-6) continue;

          const rdx = segDx / segLen;
          const rdy = segDy / segLen;
          addCrossingPoint(
            hit.x,
            hit.y,
            -rdy,
            rdx,
            roadHalfW * SCALE_FACTOR,
          );
        }
      }
    });
  });

  // Method 2: Endpoint-near-road fallback for imperfectly snapped OSM geometries.
  footways.forEach((fw) => {
    const fwGeom = fw.geometry;
    if (!fwGeom || fwGeom.length < 2) return;

    [fwGeom[0], fwGeom[fwGeom.length - 1]].forEach((fwPt) => {
      const fwPx = toPixel(fwPt.lat, fwPt.lng);

      roads.forEach((road) => {
        const layout = getLaneLayout(road.tags || {});
        const halfW = layout.totalWidth / 2;
        const geom = road.geometry;
        if (!geom || geom.length < 2) return;

        for (let i = 0; i < geom.length - 1; i++) {
          const a = toPixel(geom[i].lat, geom[i].lng);
          const b = toPixel(geom[i + 1].lat, geom[i + 1].lng);

          const segDx = b.x - a.x;
          const segDy = b.y - a.y;
          const segLen = Math.sqrt(segDx * segDx + segDy * segDy);
          if (segLen < 1e-6) continue;

          const t = Math.max(0, Math.min(1,
            ((fwPx.x - a.x) * segDx + (fwPx.y - a.y) * segDy) / (segLen * segLen)
          ));
          const projX = a.x + t * segDx;
          const projY = a.y + t * segDy;
          const dist = Math.sqrt((fwPx.x - projX) ** 2 + (fwPx.y - projY) ** 2);

          if (dist < halfW * SCALE_FACTOR * 1.25) {
            const rdx = segDx / segLen;
            const rdy = segDy / segLen;
            addCrossingPoint(
              projX,
              projY,
              -rdy,
              rdx,
              halfW * SCALE_FACTOR,
            );
            break;
          }
        }
      });
    });
  });

  // Draw crosswalk markings (zebra pattern)
  crossingPoints.forEach(({ x, y, nx, ny, roadWidth }) => {
    const stripeWidth = 0.5 * SCALE_FACTOR;
    const stripeGap = 0.5 * SCALE_FACTOR;
    const crosswalkLength = roadWidth * 2; // span full road width
    const crosswalkWidth = 3.0 * SCALE_FACTOR; // 3m wide crossing
    const numStripes = Math.floor(crosswalkWidth / (stripeWidth + stripeGap));

    ctx.fillStyle = "rgba(255, 255, 255, 0.85)";

    for (let s = 0; s < numStripes; s++) {
      const offsetAlong = -crosswalkWidth / 2 + s * (stripeWidth + stripeGap) + stripeWidth / 2;

      // Direction along road (perpendicular to nx,ny)
      const alx = -ny;
      const aly = nx;

      const cx = x + alx * offsetAlong;
      const cy = y + aly * offsetAlong;

      // Draw stripe as a rotated rectangle
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(Math.atan2(ny, nx));
      ctx.fillRect(-crosswalkLength / 2, -stripeWidth / 2, crosswalkLength, stripeWidth);
      ctx.restore();
    }
  });
};

const drawRoadWithMarkings = (ctx, feature, toPixel, SCALE_FACTOR) => {
  const layout = getLaneLayout(feature.tags || {});
  const geometry = feature.geometry;

  let centerPoints = geometry.map((p) => toPixel(p.lat, p.lng));
  centerPoints = subdivideAndSmooth(centerPoints, 3);

  const trimDistPx = Math.max(1.5 * SCALE_FACTOR, layout.totalWidth * SCALE_FACTOR * 0.8);
  centerPoints = trimPolylineByDistance(centerPoints, trimDistPx, trimDistPx);
  if (centerPoints.length < 2) return;

  // If unmarked surface, skip all lane markings
  if (layout.unmarked || shouldSkipLaneDetail(feature.tags || {}, layout)) return;

  // Draw Individual Lane Features (markings only — base pavement drawn in Pass 2)
  layout.lanes.forEach((lane) => {
    if (lane.type === "vehicle") return; // Pavement already covers it

    ctx.beginPath();
    const offsetPath = getOffsetPath(centerPoints, lane.offset, SCALE_FACTOR);
    drawPathData(ctx, offsetPath);

    ctx.strokeStyle = lane.color || COLORS.road;
    ctx.lineWidth = lane.width * SCALE_FACTOR;
    ctx.lineCap = "butt";

    if (lane.type === "divider") {
      if (lane.double) {
        // Double line (solid or dashed)
        ctx.lineWidth = 0.1 * SCALE_FACTOR;
        if (lane.dash) {
          ctx.setLineDash(lane.dash.map((d) => d * SCALE_FACTOR));
        } else {
          ctx.setLineDash([]);
        }

        ctx.beginPath();
        drawPathData(ctx, getOffsetPath(centerPoints, lane.offset - 0.15, SCALE_FACTOR));
        ctx.stroke();

        ctx.beginPath();
        drawPathData(ctx, getOffsetPath(centerPoints, lane.offset + 0.15, SCALE_FACTOR));
        ctx.stroke();
      } else {
        // Single center line
        ctx.lineWidth = 0.1 * SCALE_FACTOR;
        if (lane.dash) {
          ctx.setLineDash(lane.dash.map((d) => d * SCALE_FACTOR));
        } else {
          ctx.setLineDash([]);
        }
        ctx.stroke();
      }
    } else if (lane.type === "edge") {
      ctx.setLineDash([]);
      ctx.stroke();
    } else if (lane.type === "sidewalk") {
      // Draw sidewalk as a separate surface color (slightly raised look)
      ctx.setLineDash([]);
      ctx.stroke();
    } else {
      if (lane.dash) {
        ctx.setLineDash(lane.dash.map((d) => d * SCALE_FACTOR));
      } else {
        ctx.setLineDash([]);
      }
      ctx.stroke();
    }
  });

  ctx.setLineDash([]);
};

const renderFeaturesToCanvas = (
  ctx,
  features,
  toPixel,
  SCALE_FACTOR,
  options = {},
) => {
  // a palette of its own (the game map texture): COLORS swapped for the
  // draw, restored after (everything here is synchronous)
  if (options.palette) {
    const saved = { ...COLORS };
    Object.assign(COLORS, options.palette);
    try {
      return renderFeaturesToCanvas(ctx, features, toPixel, SCALE_FACTOR, { ...options, palette: null });
    } finally {
      Object.assign(COLORS, saved);
    }
  }
  const drawPath = (points) => {
    if (points.length < 2) return;
    const start = toPixel(points[0].lat, points[0].lng);
    ctx.moveTo(start.x, start.y);
    for (let i = 1; i < points.length; i++) {
      const p = toPixel(points[i].lat, points[i].lng);
      ctx.lineTo(p.x, p.y);
    }
  };

  const drawPolygon = (feature) => {
    ctx.beginPath();
    const pts = feature.geometry.map((p) => toPixel(p.lat, p.lng));
    if (pts.length > 0) {
      ctx.moveTo(pts[0].x, pts[0].y);
      for (let i = 1; i < pts.length; i++) {
        ctx.lineTo(pts[i].x, pts[i].y);
      }
    }
    ctx.closePath();

    if (feature.holes) {
      for (const hole of feature.holes) {
        const holePts = hole.map((p) => toPixel(p.lat, p.lng));
        if (holePts.length > 0) {
          ctx.moveTo(holePts[0].x, holePts[0].y);
          for (let i = 1; i < holePts.length; i++) {
            ctx.lineTo(holePts[i].x, holePts[i].y);
          }
        }
        ctx.closePath();
      }
    }
  };

  const baseColor = options.baseColor || COLORS.defaultLanduse;

  // 1. Draw Landcover & Landuse (Sorted by area, with Grass/Water priority layers)
  const landcover = features.filter(
    (f) =>
      ["vegetation", "water", "landuse", "bridge_infra"].includes(f.type) &&
      !isBoundaryOnlyArea(f.tags),
  );

  const isGrass = (tags) => {
    if (!tags) return false;
    const surface =
      tags.surface ||
      tags.material ||
      tags.landcover ||
      tags.landuse ||
      tags.natural ||
      tags.leisure ||
      tags.golf ||
      tags.recreation ||
      tags.tourism;
    return [
      "grass",
      "meadow",
      "grassland",
      "fell",
      "park",
      "village_green",
      "garden",
      "recreation_ground",
      "common",
      "greenfield",
      "dog_park",
      "fairway",
      "green",
      "tee",
    ].includes(surface);
  };

  const isWater = (tags) => {
    if (!tags) return false;
    if (
      tags.natural === "water" ||
      tags.waterway ||
      tags.landuse === "reservoir" ||
      tags.landuse === "basin" ||
      tags.water ||
      tags.leisure === "marina" ||
      tags.water === "harbour" ||
      tags.water === "dock" ||
      tags.harbour === "yes" ||
      tags["seamark:type"] === "harbour" ||
      tags["seamark:type"] === "harbour_basin" ||
      tags["seamark:harbour:category"] === "marina"
    )
      return true;
    if (tags.natural === "wetland" || tags.wetland) return true;
    if (tags.natural === "glacier") return true;
    return false;
  };

  const waterFeatures = [];
  const beachFeatures = [];
  const bareFeatures = [];
  const grassFeatures = [];
  const otherFeatures = [];

  const isBeach = (tags) => {
    if (!tags) return false;
    const surface =
      tags.surface ||
      tags.material ||
      tags.landcover ||
      tags.landuse ||
      tags.natural ||
      tags.leisure ||
      tags.golf ||
      tags.recreation ||
      tags.tourism;
    return ["beach", "sand", "shoal", "dune", "coastline"].includes(surface);
  };

  const isBare = (tags) => {
    if (!tags) return false;
    const surface =
      tags.surface ||
      tags.material ||
      tags.landcover ||
      tags.landuse ||
      tags.natural ||
      tags.leisure ||
      tags.golf ||
      tags.recreation ||
      tags.tourism;
    return [
      "bare_rock",
      "rock",
      "scree",
      "shingle",
      "shells",
      "marble",
      "stone",
      "blockfield",
    ].includes(surface);
  };

  landcover.forEach((f) => {
    const item = { f, area: getFeatureArea(f) };
    if (isWater(f.tags)) {
      waterFeatures.push(item);
    } else if (isBeach(f.tags)) {
      beachFeatures.push(item);
    } else if (isBare(f.tags)) {
      bareFeatures.push(item);
    } else if (isGrass(f.tags)) {
      grassFeatures.push(item);
    } else {
      otherFeatures.push(item);
    }
  });

  // Sort each group by area descending
  const byArea = (a, b) => b.area - a.area;
  otherFeatures.sort(byArea);
  grassFeatures.sort(byArea);
  bareFeatures.sort(byArea);
  waterFeatures.sort(byArea);
  beachFeatures.sort(byArea);

  // Combine in draw order: Others -> Grass -> Bare -> Water -> Beach
  // Bare terrain should sit above generic vegetation but below explicit shoreline/water overlays.
  const sortedLC = [
    ...otherFeatures,
    ...grassFeatures,
    ...bareFeatures,
    ...waterFeatures,
    ...beachFeatures,
  ];

  if (options.alpha) ctx.globalAlpha = options.alpha;
  for (const { f } of sortedLC) {
    if (isUndergroundArea(f.tags)) continue;
    // (the game map leaves broad land use to the ground it classified)
    if (options.skipArea?.(f.tags, getFeatureColor(f.tags, baseColor) === baseColor)) continue;
    ctx.fillStyle = getFeatureColor(f.tags, baseColor);
    if (f.geometry.length === 1) {
      // Skip vegetation points (trees, shrubs) as they are rendered as 3D models
      if (
        f.type === "vegetation" ||
        f.tags.natural === "tree" ||
        f.tags.natural === "shrub"
      )
        continue;

      const p = toPixel(f.geometry[0].lat, f.geometry[0].lng);
      ctx.beginPath();
      ctx.arc(p.x, p.y, 1.5 * SCALE_FACTOR, 0, Math.PI * 2);
      ctx.fill();
    } else {
      // Fix for waterways flooding land:
      // If it's a linear waterway (stream/river centerline) and NOT an area, draw as line.
      const isLinearWater =
        f.tags.waterway &&
        !["riverbank", "dock", "boatyard", "dam"].includes(f.tags.waterway) &&
        f.tags.area !== "yes";

      // Geometry check: is closed?
      const p1 = f.geometry[0];
      const p2 = f.geometry[f.geometry.length - 1];
      const isClosed =
        Math.abs(p1.lat - p2.lat) < 1e-9 && Math.abs(p1.lng - p2.lng) < 1e-9;

      if (isLinearWater && !isClosed) {
        let pts = f.geometry.map((p) => toPixel(p.lat, p.lng));
        pts = subdivideAndSmooth(pts, 3);

        ctx.beginPath();
        drawPathData(ctx, pts);
        ctx.lineCap = "round";
        ctx.lineJoin = "round";
        ctx.strokeStyle = ctx.fillStyle; // Use same color

        // Width adaptivity
        let w = 1; // Stream / ditch default
        if (f.tags.width) w = parseFloat(f.tags.width);
        else if (f.tags.waterway === "river") w = 5;
        else if (f.tags.waterway === "canal") w = 3;
        else if (f.tags.waterway === "drain") w = 1;

        ctx.lineWidth = w * SCALE_FACTOR;
        ctx.stroke();
      } else {
        drawPolygon(f);
        ctx.fill("evenodd");
      }
    }
  }
  ctx.globalAlpha = 1.0;

  // 1b. Draw coastlines as sandy shoreline strokes
  const coastlines = features.filter((f) => f.type === "coastline");
  if (coastlines.length > 0) {
    ctx.strokeStyle = COLORS.coastline;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.lineWidth = 2.0 * SCALE_FACTOR;
    coastlines.forEach((f) => {
      let pts = f.geometry.map((p) => toPixel(p.lat, p.lng));
      pts = subdivideAndSmooth(pts, 1);
      ctx.beginPath();
      drawPathData(ctx, pts);
      ctx.stroke();
    });
  }

  // 2. Draw Roads (with priority sorting)
  const roads = features.filter((f) => f.type === "road");
  const roadPriority = {
    motorway: 100,
    motorway_link: 100,
    trunk: 90,
    trunk_link: 90,
    primary: 80,
    primary_link: 80,
    secondary: 70,
    secondary_link: 70,
    tertiary: 60,
    tertiary_link: 60,
    residential: 50,
    unclassified: 40,
    service: 30,
    path: 20,
    footway: 20,
    cycleway: 20,
    pedestrian: 20,
    track: 15,
    steps: 10,
  };
  roads.sort((a, b) => {
    const layerA = getEffectiveRoadLayer(a.tags || {});
    const layerB = getEffectiveRoadLayer(b.tags || {});
    if (layerA !== layerB) return layerA - layerB;
    return (
      (roadPriority[a.tags.highway] || 10) -
      (roadPriority[b.tags.highway] || 10)
    );
  });

  // Separate vehicle roads from footways/paths for junction detection.
  const vehicleRoads = roads.filter(
    (f) => !["footway", "path", "pedestrian", "cycleway", "steps", "track"].includes(f.tags?.highway)
  );
  const vehicleRoadNetwork = buildRoadNetwork(vehicleRoads, {
    layerResolver: getEffectiveRoadLayer,
  });
  const vehicleRoadSegments = mergeLinearRoadSegments(
    vehicleRoadNetwork.segments,
    vehicleRoadNetwork.intersections,
    { styleKeyResolver: getTextureCorridorStyleKey },
  );
  const drivableRoads = vehicleRoadSegments.length > 0 ? vehicleRoadSegments : vehicleRoads;
  const stableWidthMap = buildStableTextureWidthMap(drivableRoads);

  // Build junction map for vehicle roads
  const junctions = buildJunctionMap(vehicleRoads, (lat, lng) => toPixel(lat, lng));
  const junctionCaps = buildJunctionCaps(junctions, (lat, lng) => toPixel(lat, lng), SCALE_FACTOR, stableWidthMap);

  // Pass 1: Draw footways/paths (BEFORE roads so pavement paints over crossings)
  ctx.lineCap = "butt";
  ctx.lineJoin = "round";
  roads.forEach((f) => {
    const highway = f.tags?.highway;
    if (
      ["footway", "path", "pedestrian", "cycleway", "steps", "track"].includes(highway)
    ) {
      let pts = f.geometry.map((p) => toPixel(p.lat, p.lng));
      pts = subdivideAndSmooth(pts, 3);

      ctx.beginPath();
      drawPathData(ctx, pts);
      if (f.tags?.footway === "sidewalk" || f.tags?.surface === "concrete") {
        ctx.strokeStyle = COLORS.sidewalk;
        // Real sidewalks are ~1.2 m; wider strokes outline every street.
        ctx.lineWidth = 1.2 * SCALE_FACTOR;
      } else if (["footway", "path", "track"].includes(highway)) {
        ctx.strokeStyle = COLORS.track;
        ctx.lineWidth = 1.5 * SCALE_FACTOR;
      } else {
        ctx.strokeStyle = COLORS.path;
        ctx.lineWidth = 1.5 * SCALE_FACTOR;
      }
      ctx.stroke();
    }
  });

  // Pass 2: Draw vehicle road base pavement (no markings yet)
  drivableRoads.forEach((f) => {
    const geometry = f.geometry;
    let centerPoints = geometry.map((p) => toPixel(p.lat, p.lng));
    centerPoints = subdivideAndSmooth(centerPoints, 3);

    ctx.beginPath();
    drawPathData(ctx, centerPoints);
    ctx.strokeStyle = getRoadPavementColor(f);
    ctx.lineWidth = getStableTextureRoadWidth(f, stableWidthMap) * SCALE_FACTOR;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.stroke();
  });

  // Pass 3: Keep junction pavement fill behavior for cleaner intersections.
  renderJunctions(ctx, junctionCaps);

  // 3. Draw Buildings
  const buildings = features.filter((f) => f.type === "building");
  ctx.lineWidth = 0.5 * SCALE_FACTOR;
  buildings.forEach((f) => {
    ctx.fillStyle = COLORS.buildingFill || "#CDB8A6";
    ctx.strokeStyle = COLORS.buildingStroke;
    drawPolygon(f);
    ctx.fill("evenodd");
    ctx.stroke();
  });

  // 4. Draw Barriers
  const barriers = features.filter((f) => f.type === "barrier");
  ctx.strokeStyle = COLORS.barrier;
  ctx.lineWidth = 1 * SCALE_FACTOR;
  barriers.forEach((f) => {
    ctx.beginPath();
    drawPath(f.geometry);
    ctx.stroke();
  });
};

// Cache noise patterns by color to avoid regenerating each time
const _noiseCache = new Map();
const createNoisePattern = (baseColor) => {
  const key = baseColor || COLORS.defaultLanduse;
  if (_noiseCache.has(key)) return _noiseCache.get(key);

  const size = 256; // 256px is sufficient for a repeating noise tile
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");

  // Base fill
  ctx.fillStyle = key;
  ctx.fillRect(0, 0, size, size);

  // Add noise — use pixel buffer directly for speed
  const imageData = ctx.getImageData(0, 0, size, size);
  const data = imageData.data;

  for (let i = 0; i < data.length; i += 4) {
    const val = (Math.random() - 0.5) * 20;
    data[i] = Math.max(0, Math.min(255, data[i] + val));
    data[i + 1] = Math.max(0, Math.min(255, data[i + 1] + val));
    data[i + 2] = Math.max(0, Math.min(255, data[i + 2] + val));
  }

  ctx.putImageData(imageData, 0, 0);

  // Larger grit
  ctx.fillStyle = "rgba(0,0,0,0.03)";
  for (let i = 0; i < 50; i++) {
    const x = Math.random() * size;
    const y = Math.random() * size;
    const r = Math.random() * 2 + 1;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }

  _noiseCache.set(key, canvas);
  return canvas;
};

export const generateOSMTexture = async (terrainData, options = {}) => {
  const onProgress = options.onProgress;
  onProgress?.("Baking procedural noise...");
  // Cap texture at 8192px max to avoid excessive RGBA buffers.
  const MAX_TEX_SIZE = 8192;
  const requestedSize = Number(options.outputSize || terrainData.width || 1024);
  const targetSize = Math.max(1, Math.min(MAX_TEX_SIZE, Math.floor(requestedSize)));
  const SCALE_FACTOR = targetSize / Math.max(1, terrainData.width);
  const processingMetersPerPixel = Number.isFinite(Number(terrainData?.processingMetersPerPixel))
    && Number(terrainData.processingMetersPerPixel) > 0
    ? Number(terrainData.processingMetersPerPixel)
    : 1;
  const METERS_TO_PX = SCALE_FACTOR / processingMetersPerPixel;
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(terrainData.width * SCALE_FACTOR));
  canvas.height = Math.max(1, Math.round(terrainData.height * SCALE_FACTOR));
  console.log(`[OSM Texture] Generating OSM texture ${canvas.width}x${canvas.height} (${terrainData.osmFeatures?.length ?? 0} features)`);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Could not get 2D context");

  // Linear lat/lng → pixel box-stretch, matching geoToWorld() object placement
  // and the satellite resampler. (METERS_TO_PX, used for road widths, equals the
  // px-per-world-metre of this mapping because squareSize == processingMpp.) A
  // metric projection here would drift from the placed decals/objects by ~cos(lat).
  const { north: bNorth, south: bSouth, east: bEast, west: bWest } = terrainData.bounds;
  const toPixel = (lat, lng) => ({
    x: ((lng - bWest) / (bEast - bWest)) * canvas.width,
    y: ((bNorth - lat) / (bNorth - bSouth)) * canvas.height,
  });

  // Use noise pattern for background instead of solid color
  const noisePattern = ctx.createPattern(
    createNoisePattern(options.baseColor),
    "repeat",
  );
  ctx.fillStyle = noisePattern;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  onProgress?.("Drawing vector maps (roads, buildings, landuse)...");
  renderFeaturesToCanvas(
    ctx,
    terrainData.osmFeatures,
    toPixel,
    METERS_TO_PX,
    options,
  );

  const blob = await new Promise((r) =>
    canvas.toBlob((b) => r(b || null), "image/png"),
  );
  if (!blob) console.warn("[OSM Texture] canvas.toBlob() returned null — canvas may be tainted or too large");
  const url = blob ? URL.createObjectURL(blob) : "";
  console.log(`[OSM Texture] Done — blob=${blob ? `${(blob.size / 1024).toFixed(0)} KB` : "null"}, url=${url ? "ok" : "empty"}`);
  return { url, canvas, blob };
};

// ── Game map texture ─────────────────────────────────────────────────────────
// A base texture made for the game rather than a map or a photo: flat,
// natural ground colours (the satellite's shadows, cars, roofs and tile
// seams left out), OSM's land cover where it is mapped, and where it is not
// (OSM leaves it grey) the ground the satellite shows, sorted into a few
// classes and painted flat. Broad land use (residential, commercial, farmland
// ...) is left to that classification: a suburb is lawns, trees, drives and
// roofs, not one grey.
export const GROUND_CLASSES = ['trees', 'grass', 'dry', 'soil', 'sand', 'paved', 'water', 'shadow', 'rock'];
// ('rock' is never a pixel's own class: grey or bare ground where the land
// cover says bare rock, snow and ice, or moss and lichen, see groundFromLandCover)
// Tuned to BeamNG's own base colour maps (t_terrain_base_b: East Coast USA,
// Italy, West Coast USA, Jungle Rock Island): dark, muted olive greens, grey-
// brown open ground; the detail textures sit on them at 15-25 % strength,
// so these are the colours seen in game. Paved greys stay neutral: a warm
// grey reads as vegetation to the export's grass mask (isVegetationColor).
const GROUND_COLORS = {
  trees: [63, 70, 39], grass: [82, 90, 49], dry: [109, 104, 76], soil: [126, 115, 97],
  sand: [157, 141, 111], paved: [96, 95, 91], water: [90, 84, 74], rock: [128, 123, 113],
};
// (water is painted as its bed, muddy silt, not blue: BeamNG's own maps show
// the ground under their water, and players disliked blue lakes and rivers.
// Kept under 40° hue so the export's grass mask never takes it for grass.)
export const GAME_COLORS = {
  forest: "#3f4627", scrub: "#605d37", heath: "#66603f", grass: "#525a31", orchard: "#4b5a2e", farmland: "#7e7361",
  water: "#5a544a", wetland: "#4a5430", swamp: "#3f4627", glacier: "#9aa3a5", mud: "#5e5446",
  bare: "#8f8676", sand: "#9d8d6f", dirt: "#7e7361", quarry: "#847a69",
  residential: "#555c35", commercial: "#62615c", industrial: "#5d5c58", retail: "#66655f",
  education: "#565e34", military: "#5e5c46", cemetery: "#4f5a30", sport: "#4d5c2e",
  recreation: "#525a31", park: "#4f5a30", parking: "#4c4c49", aeroway: "#6b6a65", apron: "#62615c",
  runway: "#454441", power: "#5d5c58", tourism: "#525a31", hospital: "#565e34",
  swimming_pool: "#6b6a65", marina: "#62615c", harbourLand: "#5d5c58", fountain: "#6b6a65",
  allotments: "#4f5a30", flowerbed: "#525a31", hedge: "#3f4627",
  building: "#5d5c58", buildingFill: "#5d5c58", buildingStroke: "#565550", path: "#7e7361", track: "#6d6250",
  sidewalk: "#7d7a72", barrier: "#5a4c3c", coastline: "#5a544a", ocean: "#5a544a", defaultLanduse: "#525a31",
};
// broad land use the classification paints instead (when there is a satellite
// image), and natural vegetation: the imagery is newer than many outlines (a
// clearing in a mapped wood) and tells canopy from grass on its own
const BROAD_LANDUSE = new Set(['residential', 'commercial', 'retail', 'industrial', 'education', 'military', 'farmland', 'farmyard', 'construction', 'brownfield', 'greenfield', 'religious', 'institutional']);
const NATURAL_COVER = new Set(['forest', 'wood', 'scrub', 'heath', 'grass', 'meadow', 'grassland', 'shrubbery', 'trees']);
const OSM_ROCK = new Set(['bare_rock', 'rock', 'scree', 'shingle', 'glacier', 'stone']);
const leftToGround = (tags) => BROAD_LANDUSE.has(tags?.landuse) || BROAD_LANDUSE.has(tags?.amenity)
  || NATURAL_COVER.has(tags?.landuse) || NATURAL_COVER.has(tags?.natural) || NATURAL_COVER.has(tags?.landcover);

/** The ground class of a satellite pixel (index into GROUND_CLASSES). */
export function classifyGround(r, g, b) {
  const max = Math.max(r, g, b); const min = Math.min(r, g, b);
  const v = max / 255; const s = max ? (max - min) / max : 0;
  const exg = (2 * g - r - b) / 255;
  if (v < 0.16) return 7;                                         // shadow: taken from its neighbours
  if (b > g + 6 && b > r + 14 && v < 0.62) return 6;              // water
  // grey first: dark asphalt has a faint green cast in some imagery (Phoenix
  // lots at ~11 % saturation, RGB 58,64,57 came out as tree canopy), real
  // leaves and grass are far more saturated (~40 %); a hazy lawn is greyish
  // too but brighter, so only the dark greys
  if (s < 0.16 && v < 0.3) return v < 0.19 ? 7 : 5;               // dark grey: asphalt (darker: shadow)
  // (green clearly over red: sand and straw have a little excess green too)
  if (g > r + 2 && (exg > 0.05 || (g > b + 8 && s > 0.14))) return v < 0.34 ? 0 : 1;   // canopy / grass
  if (s < 0.13) return 5;                                         // grey: paved
  if (r >= g && g >= b) {
    if (v > 0.62 && s < 0.4) return 4;                            // sand
    const hueish = (g - b) / ((r - b) || 1);                      // 1: yellow, 0: red
    if (hueish > 0.62 && s < 0.5) return 2;                       // dry grass / straw
    return 3;                                                     // bare soil
  }
  return g > r ? 1 : 3;
}

// 3x3 majority over the class grid, shadows not voting (and filled from
// their neighbours): cars, roof edges and single dark pixels drop out
function smoothClasses(cls, w, h, passes) {
  let src = cls;
  for (let pass = 0; pass < passes; pass++) {
    const out = new Uint8Array(src.length);
    const votes = new Uint16Array(GROUND_CLASSES.length);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        votes.fill(0);
        for (let dy = -1; dy <= 1; dy++) {
          const yy = Math.min(h - 1, Math.max(0, y + dy));
          for (let dx = -1; dx <= 1; dx++) {
            const xx = Math.min(w - 1, Math.max(0, x + dx));
            const c = src[yy * w + xx];
            if (c !== 7) votes[c] += dx === 0 && dy === 0 ? 2 : 1;
          }
        }
        let best = src[y * w + x]; let n = 0;
        for (let c = 0; c < 7; c++) if (votes[c] > n) { n = votes[c]; best = c; }
        out[y * w + x] = n > 0 ? best : src[y * w + x];
      }
    }
    src = out;
  }
  // any shadow still left: grass (the commonest ground under trees and roofs)
  for (let i = 0; i < src.length; i++) if (src[i] === 7) src[i] = 1;
  return src;
}

/** Smoothed ground classes (indices into GROUND_CLASSES) of RGBA pixels. */
export function classifyGroundGrid(rgba, w, h) {
  const cls = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) cls[i] = classifyGround(rgba[i * 4], rgba[i * 4 + 1], rgba[i * 4 + 2]);
  return smoothClasses(cls, w, h, 3);
}

// About 2 m a cell: fine enough for a yard tree's crown, coarse enough to
// average out cars and roof edges.
const GROUND_CELL_M = 2;

/**
 * The satellite image (a canvas or image, else terrainData.satelliteTextureUrl)
 * classified into ground classes on the heightmap's grid at about 2 m a
 * cell: { cls, w, h }, north-up, or null without a satellite image. One
 * classification for the game texture and the canopy trees.
 */
export const satelliteGroundClasses = async (terrainData, source = null) => {
  let satellite = source?.width > 0 ? source : null;
  if (!satellite && terrainData?.satelliteTextureUrl && typeof Image !== "undefined") {
    const img = new Image();
    img.src = terrainData.satelliteTextureUrl;
    if (await new Promise((resolve) => { img.onload = () => resolve(true); img.onerror = () => resolve(false); }) && img.naturalWidth > 0) satellite = img;
  }
  if (!satellite || typeof document === "undefined") return null;
  const processingMetersPerPixel = Number(terrainData?.processingMetersPerPixel) > 0 ? Number(terrainData.processingMetersPerPixel) : 1;
  const cell = Math.max(1, Math.round(GROUND_CELL_M / processingMetersPerPixel));
  const w = Math.max(16, Math.round(terrainData.width / cell)); const h = Math.max(16, Math.round(terrainData.height / cell));
  const small = document.createElement("canvas");
  small.width = w; small.height = h;
  const sctx = small.getContext("2d");
  sctx.imageSmoothingEnabled = true;
  sctx.imageSmoothingQuality = "high";
  sctx.drawImage(satellite, 0, 0, w, h);
  const rgba = sctx.getImageData(0, 0, w, h).data;
  const slope = cellSlopes(terrainData, w, h, processingMetersPerPixel);
  const sun = slope ? removeHillshade(rgba, slope) : null;
  if (sun) console.log(`[Ground classes] Terrain shading taken out of the satellite (sun from ${sun.az}° at ${sun.alt}°, r=${sun.r.toFixed(2)}).`);
  // (bright cells, before the classes are smoothed: pale rock and scree read as grey "paved")
  const bright = new Uint8Array(w * h);
  // (1: bright, 2: pale, a washed-out grey-green: lichen on rock, which reads as grass)
  // (pale against the image's own brightness: imagery runs dim or bright)
  let meanL = 0;
  for (let i = 0; i < w * h; i++) meanL += 0.3 * rgba[i * 4] + 0.59 * rgba[i * 4 + 1] + 0.11 * rgba[i * 4 + 2];
  const paleL = Math.max(105, (1.15 * meanL) / (w * h));
  for (let i = 0; i < w * h; i++) {
    const r = rgba[i * 4], g = rgba[i * 4 + 1], b = rgba[i * 4 + 2];
    const l = 0.3 * r + 0.59 * g + 0.11 * b; const mx = Math.max(r, g, b);
    bright[i] = l > 150 ? 1 : (l > paleL && mx && (mx - Math.min(r, g, b)) / mx < 0.24 ? 2 : 0);
  }
  const cls = classifyGroundGrid(rgba, w, h);
  groundFromLandCover(cls, w, h, terrainData?.landCover, slope, bright);
  osmRockOnBareGround(cls, w, h, terrainData);
  return { cls, w, h, image: satellite };
};

// The terrain's surface normal at each class cell (east, north, up; unit),
// from the heights about 4 m either side (the 1 m grid's own noise is not the
// shading the imagery shows), or null without heights.
function cellSlopes(terrainData, w, h, mpp) {
  const hm = terrainData?.heightMap; const W = terrainData?.width; const H = terrainData?.height;
  if (!hm || !(W > 8) || !(H > 8) || hm.length !== W * H) return null;
  const R = Math.max(1, Math.round(4 / mpp));
  const nx = new Float32Array(w * h); const ny = new Float32Array(w * h); const nz = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    const hy = Math.min(H - 1 - R, Math.max(R, Math.floor(((y + 0.5) / h) * H)));
    for (let x = 0; x < w; x++) {
      const hx = Math.min(W - 1 - R, Math.max(R, Math.floor(((x + 0.5) / w) * W)));
      const k = hy * W + hx;
      const dzE = (hm[k + R] - hm[k - R]) / (2 * R * mpp);
      const dzN = (hm[k - R * W] - hm[k + R * W]) / (2 * R * mpp);   // (row 0 is north)
      const len = Math.hypot(dzE, dzN, 1);
      const i = y * w + x;
      nx[i] = -dzE / len; ny[i] = -dzN / len; nz[i] = 1 / len;
    }
  }
  return { nx, ny, nz };
}

// Mountain imagery is shaded by its own relief: a north face in shadow came
// out blue-black (classed as water and forest), a sunlit meadow pale (dry
// grass, sand). The sun is found from the image itself (the direction whose
// lighting of the terrain best matches the brightness) and the shading
// divided out, so each cell is classed by its ground's colour. Flat ground
// is left as it was; cast shadows are not modelled (the classes fill those
// from their neighbours). -> { az, alt, r } or null (no clear relief shading).
export function removeHillshade(rgba, { nx, ny, nz }) {
  const n = nx.length;
  const lum = new Float32Array(n);
  let steep = 0;
  for (let i = 0; i < n; i++) {
    lum[i] = 0.3 * rgba[i * 4] + 0.59 * rgba[i * 4 + 1] + 0.11 * rgba[i * 4 + 2];
    if (nz[i] < 0.97) steep++;   // (over ~14°)
  }
  if (steep < n * 0.05) return null;   // flat: nothing to take out
  const stride = Math.max(1, Math.floor(n / 250000));
  let best = null;
  for (let alt = 20; alt <= 70; alt += 10) {
    const ca = Math.cos((alt * Math.PI) / 180); const sa = Math.sin((alt * Math.PI) / 180);
    for (let az = 0; az < 360; az += 10) {
      const lx = Math.sin((az * Math.PI) / 180) * ca; const ly = Math.cos((az * Math.PI) / 180) * ca;
      let m = 0, sS = 0, sL = 0, sSS = 0, sLL = 0, sSL = 0;
      for (let i = 0; i < n; i += stride) {
        const L = lum[i];
        if (L > 225) continue;   // (snow: saturated, not shaded)
        const s = Math.max(0, nx[i] * lx + ny[i] * ly + nz[i] * sa);
        m++; sS += s; sL += L; sSS += s * s; sLL += L * L; sSL += s * L;
      }
      const cov = sSL / m - (sS / m) * (sL / m); const vs = sSS / m - (sS / m) ** 2; const vl = sLL / m - (sL / m) ** 2;
      if (!(vs > 1e-6 && vl > 1e-6)) continue;
      const r = cov / Math.sqrt(vs * vl);
      if (!best || r > best.r) best = { az, alt, r, b: cov / vs, a: sL / m - (cov / vs) * (sS / m), mean: sS / m, lx, ly, lz: sa };
    }
  }
  if (!best || best.r < 0.25 || !(best.b > 0) || !(best.a > 0)) return null;
  const { mean, lx, ly, lz } = best;
  // each channel fitted on its own along that sun: shade is lit by the blue
  // sky, so its blue needs less lifting than its red (one factor for all
  // three turned desert canyon shade green and alpine shade blue)
  const shadeAt = (i) => Math.max(0, nx[i] * lx + ny[i] * ly + nz[i] * lz);
  const fit = [0, 1, 2].map((c) => {
    let m = 0, sS = 0, sV = 0, sSS = 0, sSV = 0;
    for (let i = 0; i < n; i += stride) {
      if (lum[i] > 225) continue;
      const s = shadeAt(i); const v = rgba[i * 4 + c];
      m++; sS += s; sV += v; sSS += s * s; sSV += s * v;
    }
    const b = (sSV / m - (sS / m) * (sV / m)) / Math.max(1e-6, sSS / m - (sS / m) ** 2);
    return { a: sV / m - b * (sS / m), b };
  });
  if (fit.some((f) => !(f.a > 1))) return null;
  const target = fit.map((f) => f.a + Math.max(0, f.b) * mean);
  // (per channel only in the shade, where the sky's blue is; sunlit ground
  // is only darkened, all channels alike: per channel there turned pale
  // scree green, Fizz_Mechanic's Chevril slide)
  const { a: la, b: lb } = best;
  const lTarget = la + lb * mean;
  for (let i = 0; i < n; i++) {
    const s = shadeAt(i);
    const j = i * 4;
    if (s >= mean) {
      const f = Math.max(0.6, lTarget / (la + lb * s));
      rgba[j] *= f; rgba[j + 1] *= f; rgba[j + 2] *= f;
      continue;
    }
    for (let c = 0; c < 3; c++) {
      const f = Math.min(2, Math.max(0.6, target[c] / (fit[c].a + Math.max(0, fit[c].b) * s)));
      rgba[j + c] = Math.min(255, rgba[j + c] * f);
    }
  }
  return { az: best.az, alt: best.alt, r: best.r };
}

// The classes checked against what covers the ground (ESA WorldCover,
// terrainData.landCover, 10 m) and the slope:
// - canopy only where the land cover has trees, scrub, built-up (yard trees)
//   or wetland within ~10 m: elsewhere it is shaded grass (Tignes: a third
//   of the meadows above the tree line came out as forest), and no green
//   at all on bare ground with no plants within ~10 m;
// - grey ground on bare rock, snow and ice, or moss and lichen: rock (sand
//   and soil too on bare ground over ~25°);
// - water only on level ground, and with a land cover only near its water
//   (shaded slopes in blue-grey came out as lakes);
// the cells taken out filled from their neighbours.
const CANOPY_COVER = new Set([WC.TREES, WC.SHRUBS, WC.BUILT, WC.WETLAND, WC.MANGROVES]);
const GREEN_COVER = new Set([WC.TREES, WC.SHRUBS, WC.GRASS, WC.CROPS, WC.BUILT, WC.WETLAND, WC.MANGROVES, WC.MOSS]);
// OSM's rock, scree and glacier outlines, where the satellite shows bare
// ground inside them (dry, soil, sand, grey): rock. The meadows OSM drew
// them over stay green (Fizz_Mechanic: "something in between": the scree
// slides were lost when the outlines were left out altogether).
export function osmRockOnBareGround(cls, w, h, terrainData) {
  const b = terrainData?.bounds; const feats = terrainData?.osmFeatures;
  if (!b || !feats?.length || typeof document === "undefined") return 0;
  const rocks = feats.filter((f) => OSM_ROCK.has(f?.tags?.natural) && f.geometry?.length >= 3);
  if (!rocks.length) return 0;
  const c = document.createElement("canvas"); c.width = w; c.height = h;
  const ctx = c.getContext("2d");
  ctx.fillStyle = "#fff";
  const px = (p) => [((p.lng - b.west) / (b.east - b.west)) * w, ((b.north - p.lat) / (b.north - b.south)) * h];
  for (const f of rocks) {
    ctx.beginPath();
    for (const ring of [f.geometry, ...(f.holes || [])]) ring.forEach((p, i) => { const [x, y] = px(p); if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y); });
    ctx.fill("evenodd");
  }
  const m = ctx.getImageData(0, 0, w, h).data; c.width = 0;
  let n = 0;
  for (let i = 0; i < w * h; i++) if (m[i * 4] > 127 && cls[i] >= 2 && cls[i] <= 5) { cls[i] = 8; n++; }
  return n;
}

export function groundFromLandCover(cls, w, h, landCover, slope = null, bright = null) {
  const lc = landCover?.grid?.length === landCover?.n * landCover?.n ? landCover : null;
  const T = 0, G = 1, DRY = 2, SOIL = 3, SAND = 4, PAVED = 5, WATER = 6, HOLE = 7, ROCK = 8;
  const near = (x, y, test, reach) => {
    const { grid, n } = lc;
    const c0 = Math.floor(((x + 0.5) / w) * n); const r0 = Math.floor(((y + 0.5) / h) * n);
    for (let dr = -reach; dr <= reach; dr++) for (let dc = -reach; dc <= reach; dc++) {
      const r = r0 + dr; const c = c0 + dc;
      if (r >= 0 && c >= 0 && r < n && c < n && test(grid[r * n + c])) return true;
    }
    return false;
  };
  let holes = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x; const c = cls[i];
      if (c === WATER) {
        if ((slope && slope.nz[i] < 0.99) || (lc && !near(x, y, (k) => k === WC.WATER || k === 0, 2))) { cls[i] = HOLE; holes++; }   // (over ~8°)
        continue;
      }
      // (pale grey or light sand on a slope over ~15°, away from towns: rock and scree)
      // (and a pale grey-green on such a slope: lichen-covered rock)
      if (lc && bright && bright[i] && slope && (((c === PAVED || c === SAND) && (c === PAVED && bright[i] === 1 || slope.nz[i] < 0.966))
        || ((c === G || c === DRY) && bright[i] === 2 && slope.nz[i] < 0.966))
        && !near(x, y, (k) => k === WC.BUILT, 1)) { cls[i] = ROCK; continue; }
      if (!lc) continue;
      const here = lc.grid[Math.min(lc.n - 1, Math.floor(((y + 0.5) / h) * lc.n)) * lc.n + Math.min(lc.n - 1, Math.floor(((x + 0.5) / w) * lc.n))];
      if (!here) continue;
      // (greens on bare ground with no plants near: desert varnish and grey-green gravel, Hoover's canyon)
      if ((c === T || c === G) && (here === WC.BARE || here === WC.SNOW) && !near(x, y, (k) => GREEN_COVER.has(k), 1)) cls[i] = c === T ? SOIL : DRY;
      else if (c === T && !near(x, y, (k) => CANOPY_COVER.has(k), 1)) cls[i] = G;
      // (sand and soil only on a slope over ~25°: on the flat, bare ground is a desert's sand or dirt)
      else if ((here === WC.BARE || here === WC.SNOW || here === WC.MOSS) && (c === PAVED || ((c === SAND || c === SOIL) && here !== WC.MOSS && slope && slope.nz[i] < 0.9))) cls[i] = ROCK;
    }
  }
  // the holes from their neighbours' commonest class, grass where none
  for (let pass = 0; holes && pass < 6; pass++) {
    holes = 0;
    const votes = new Uint16Array(GROUND_CLASSES.length);
    const prev = cls.slice();
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      if (prev[y * w + x] !== HOLE) continue;
      votes.fill(0); let best = HOLE; let nb = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const yy = y + dy; const xx = x + dx;
        if (yy < 0 || xx < 0 || yy >= h || xx >= w) continue;
        const k = prev[yy * w + xx];
        if (k !== HOLE && k !== WATER && ++votes[k] > nb) { nb = votes[k]; best = k; }
      }
      cls[y * w + x] = best;
      if (best === HOLE) holes++;
    }
  }
  if (holes) for (let i = 0; i < cls.length; i++) if (cls[i] === HOLE) cls[i] = G;
  return cls;
}

// Water as the game map shows it: its own satellite pixels (generateGameTexture)
const WATER_EXCLUDED = new Set(["dam", "weir", "dock", "boatyard", "lock_gate"]);
const isWaterArea = (tags = {}) => !WATER_EXCLUDED.has(tags.waterway) && (
  tags.natural === "water" || !!tags.waterway || tags.landuse === "reservoir" || tags.landuse === "basin" || !!tags.water);

// Steep ground as bare rock, over whatever it was painted: a texture is laid
// on the terrain from straight above, so on a face steeper than ~45° a field's
// green or a wood's dark green is smeared down it in vertical streaks
// (Fizz_Mechanic's Tignes cliffs); rock is what is really there. Only over the
// natural colours (greens and browns): a road, a building or water keeps its
// own. The edge is dithered between 42° and 48°, a few rock tones mixed in.
// In strips of rows: no texture-sized pixel buffer. -> the share painted.
const STEEP_ROCK = [[0x8f, 0x86, 0x76], [0x7a, 0x74, 0x69], [0x99, 0x92, 0x84]];
export function paintSteepRock(ctx, canvas, terrainData) {
  const hm = terrainData?.heightMap; const W = terrainData?.width; const H = terrainData?.height;
  if (!hm || !(W > 2) || !(H > 2) || hm.length !== W * H) return 0;
  const mpp = Number(terrainData.processingMetersPerPixel) > 0 ? Number(terrainData.processingMetersPerPixel) : 1;
  const sx = W / canvas.width; const sy = H / canvas.height;
  const hash = (x, y) => { let n = (x * 374761393 + y * 668265263) | 0; n = Math.imul(n ^ (n >>> 13), 1274126177); return ((n ^ (n >>> 16)) >>> 0) / 4294967296; };
  // (by the land cover: never on a wooded face, steeper on grass, worldCover.js steepRockFrom)
  const lc = terrainData.landCover?.grid?.length === terrainData.landCover?.n ** 2 ? terrainData.landCover : null;
  let painted = 0;
  const STRIP = 256;
  for (let y0 = 0; y0 < canvas.height; y0 += STRIP) {
    const rows = Math.min(STRIP, canvas.height - y0);
    const img = ctx.getImageData(0, y0, canvas.width, rows);
    const d = img.data; let changed = false;
    for (let ty = 0; ty < rows; ty++) {
      const hy = Math.min(H - 2, Math.max(1, Math.floor((y0 + ty + 0.5) * sy)));
      const lcRow = lc ? Math.min(lc.n - 1, Math.floor(((y0 + ty + 0.5) / canvas.height) * lc.n)) * lc.n : 0;
      for (let tx = 0; tx < canvas.width; tx++) {
        const hx = Math.min(W - 2, Math.max(1, Math.floor((tx + 0.5) * sx)));
        const k = hy * W + hx;
        const gx = (hm[k + 1] - hm[k - 1]) / (2 * mpp); const gy = (hm[k + W] - hm[k - W]) / (2 * mpp);
        const u = hash(tx, y0 + ty);
        const from = lc ? steepRockFrom(lc.grid[lcRow + Math.min(lc.n - 1, Math.floor(((tx + 0.5) / canvas.width) * lc.n))]) : 0.9;
        if (Math.hypot(gx, gy) < from * (1 + 0.233 * u)) continue;   // tan 42°..48° (grass 50°..56°)
        const i = (ty * canvas.width + tx) * 4;
        const r = d[i], g = d[i + 1], b = d[i + 2];
        // (natural colours only: green or brown, not the greys of roads, buildings and water)
        if (Math.abs(r - g) < 6 && Math.abs(g - b) < 6) continue;
        if (b > g + 4) continue;
        const c = STEEP_ROCK[Math.floor(hash(y0 + ty, tx) * STEEP_ROCK.length)];
        d[i] = c[0]; d[i + 1] = c[1]; d[i + 2] = c[2];
        changed = true; painted++;
      }
    }
    if (changed) ctx.putImageData(img, 0, y0);
  }
  return painted / (canvas.width * canvas.height);
}

// Permanent snow and glaciers: where ESA WorldCover (read while generating:
// terrainData.landCover) has snow and ice within a cell, and the satellite
// image itself is snow-white there (its 10 m cells painted alone came out
// as white squares, and a 2021 snowfield can be summer gravel in the
// imagery). The shape is the image's; the land cover keeps white roofs, salt
// and sand from turning to snow.
const SNOW = [[238, 241, 245], [228, 233, 239], [245, 247, 249], [220, 226, 233]];
export function paintLandCoverSnow(ctx, canvas, terrainData, satellite) {
  const lc = terrainData?.landCover;
  if (!lc?.grid || lc.grid.length !== lc.n * lc.n || !(satellite?.width > 0)) return 0;
  const { grid, n } = lc;
  const snowNear = (r, c) => {
    for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
      const rr = r + dr; const cc = c + dc;
      if (rr >= 0 && cc >= 0 && rr < n && cc < n && grid[rr * n + cc] === 70) return true;
    }
    return false;
  };
  const hash = (x, y) => { let k = (x * 374761393 + y * 668265263) | 0; k = Math.imul(k ^ (k >>> 13), 1274126177); return ((k ^ (k >>> 16)) >>> 0) / 4294967296; };
  let painted = 0;
  const STRIP = 256;
  const tmp = document.createElement("canvas");
  tmp.width = canvas.width;
  const tctx = tmp.getContext("2d", { willReadFrequently: true });
  for (let y0 = 0; y0 < canvas.height; y0 += STRIP) {
    const rows = Math.min(STRIP, canvas.height - y0);
    const r0 = Math.max(0, Math.floor((y0 / canvas.height) * n) - 1); const r1 = Math.min(n - 1, Math.floor(((y0 + rows) / canvas.height) * n) + 1);
    let any = false;
    for (let r = r0; r <= r1 && !any; r++) for (let c = 0; c < n; c++) if (grid[r * n + c] === 70) { any = true; break; }
    if (!any) continue;
    tmp.height = rows;
    tctx.drawImage(satellite, 0, (y0 / canvas.height) * satellite.height, satellite.width, (rows / canvas.height) * satellite.height, 0, 0, canvas.width, rows);
    const sat = tctx.getImageData(0, 0, canvas.width, rows).data;
    const img = ctx.getImageData(0, y0, canvas.width, rows);
    const d = img.data; let changed = false;
    for (let ty = 0; ty < rows; ty++) {
      const r = Math.min(n - 1, Math.floor(((y0 + ty + 0.5) / canvas.height) * n));
      for (let tx = 0; tx < canvas.width; tx++) {
        if (!snowNear(r, Math.min(n - 1, Math.floor(((tx + 0.5) / canvas.width) * n)))) continue;
        const i = (ty * canvas.width + tx) * 4;
        const sr = sat[i], sg = sat[i + 1], sb = sat[i + 2];
        const lum = 0.3 * sr + 0.59 * sg + 0.11 * sb;
        if (lum < 196 || Math.max(sr, sg, sb) - Math.min(sr, sg, sb) > 34) continue;   // not snow-white in the image
        const c = SNOW[Math.floor(hash(tx, y0 + ty) * SNOW.length)];
        d[i] = c[0]; d[i + 1] = c[1]; d[i + 2] = c[2];
        changed = true; painted++;
      }
    }
    if (changed) ctx.putImageData(img, 0, y0);
  }
  tmp.width = 0;
  return painted / (canvas.width * canvas.height);
}

// The satellite's detail laid over a painted texture: each pixel scaled by
// how much brighter or darker the image is there than its surroundings
// (~8 m: paths, rocks, tufts, furrows; the relief's broad shading and the
// imagery's colour casts drop out), and nudged toward the image's own colour
// at ~30 m (tint: a greener meadow, a redder scree), its brightness kept. In
// strips of rows against a 1/8-size copy: no texture-sized buffers.
export function addSatelliteDetail(ctx, canvas, satellite, { detail = 0.75, tint = 0.3 } = {}) {
  const W = canvas.width; const H = canvas.height;
  const sw = satellite.naturalWidth || satellite.width; const sh = satellite.naturalHeight || satellite.height;
  if (!(sw > 0) || !(sh > 0) || !(W > 16) || !(H > 16)) return null;
  const lw = Math.max(8, Math.round(W / 8)); const lh = Math.max(8, Math.round(H / 8));
  const low = document.createElement("canvas"); low.width = lw; low.height = lh;
  const lctx = low.getContext("2d");
  lctx.imageSmoothingEnabled = true; lctx.imageSmoothingQuality = "high";
  lctx.drawImage(satellite, 0, 0, lw, lh);
  const STRIP = 256;
  const a = document.createElement("canvas"); a.width = W; a.height = STRIP;
  const b = document.createElement("canvas"); b.width = W; b.height = STRIP;
  const actx = a.getContext("2d", { willReadFrequently: true }); const bctx = b.getContext("2d", { willReadFrequently: true });
  actx.imageSmoothingEnabled = true; actx.imageSmoothingQuality = "high";
  bctx.imageSmoothingEnabled = true; bctx.imageSmoothingQuality = "high";
  const lumOf = (d, i) => 0.3 * d[i] + 0.59 * d[i + 1] + 0.11 * d[i + 2];
  for (let y0 = 0; y0 < H; y0 += STRIP) {
    const rows = Math.min(STRIP, H - y0);
    actx.clearRect(0, 0, W, STRIP); bctx.clearRect(0, 0, W, STRIP);
    actx.drawImage(satellite, 0, (y0 / H) * sh, sw, (rows / H) * sh, 0, 0, W, rows);
    bctx.drawImage(low, 0, (y0 / H) * lh, lw, (rows / H) * lh, 0, 0, W, rows);
    const fine = actx.getImageData(0, 0, W, rows).data;
    const broad = bctx.getImageData(0, 0, W, rows).data;
    const img = ctx.getImageData(0, y0, W, rows); const d = img.data;
    for (let i = 0; i < W * rows * 4; i += 4) {
      const lb = lumOf(broad, i);
      const ratio = Math.min(1.35, Math.max(0.7, (lumOf(fine, i) + 8) / (lb + 8)));
      const f = 1 + detail * (ratio - 1);
      // (the image's colour at ~30 m, at the painted brightness)
      // (not over neutral greys: roads and buildings keep their grey, which the grass mask needs)
      const pl = lumOf(d, i); const sc = lb > 4 ? pl / lb : 0;
      const t = Math.abs(d[i] - d[i + 1]) < 6 && Math.abs(d[i + 1] - d[i + 2]) < 6 ? 0 : tint;
      for (let c = 0; c < 3; c++) {
        const v = d[i + c] * (1 - t) + broad[i + c] * sc * t;
        d[i + c] = Math.max(0, Math.min(255, v * f));
      }
    }
    ctx.putImageData(img, 0, y0);
  }
  low.width = 0; a.width = 0; b.width = 0;
  return { detail, tint };
}

export const generateGameTexture = async (terrainData, options = {}) => {
  const onProgress = options.onProgress;
  onProgress?.("Painting the game map texture...");
  const MAX_TEX_SIZE = 8192;
  const requestedSize = Number(options.outputSize || terrainData.width || 1024);
  const targetSize = Math.max(1, Math.min(MAX_TEX_SIZE, Math.floor(requestedSize)));
  const SCALE_FACTOR = targetSize / Math.max(1, terrainData.width);
  const processingMetersPerPixel = Number(terrainData?.processingMetersPerPixel) > 0 ? Number(terrainData.processingMetersPerPixel) : 1;
  const METERS_TO_PX = SCALE_FACTOR / processingMetersPerPixel;
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(terrainData.width * SCALE_FACTOR));
  canvas.height = Math.max(1, Math.round(terrainData.height * SCALE_FACTOR));
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Could not get 2D context");

  // the ground: classified from the satellite image (about 2 m a cell), else grass
  const ground = await satelliteGroundClasses(terrainData, options.satelliteCanvas);
  const satellite = !!ground;
  if (ground) {
    const { cls: smooth, w, h } = ground;
    const small = document.createElement("canvas");
    small.width = w; small.height = h;
    const sctx = small.getContext("2d");
    const px = sctx.createImageData(w, h);
    for (let i = 0; i < w * h; i++) {
      const c = GROUND_COLORS[GROUND_CLASSES[smooth[i]]];
      px.data[i * 4] = c[0]; px.data[i * 4 + 1] = c[1]; px.data[i * 4 + 2] = c[2]; px.data[i * 4 + 3] = 255;
    }
    sctx.putImageData(px, 0, 0);
    // up to the texture with soft class edges
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(small, 0, 0, canvas.width, canvas.height);
  } else {
    ctx.fillStyle = GAME_COLORS.grass;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }

  // OSM: land cover where mapped (broad land use left to the ground above
  // when there was a satellite image), roads, paths, buildings
  onProgress?.("Drawing land cover and roads on the game map...");
  const { north: bNorth, south: bSouth, east: bEast, west: bWest } = terrainData.bounds;
  const toPixel = (lat, lng) => ({
    x: ((lng - bWest) / (bEast - bWest)) * canvas.width,
    y: ((bNorth - lat) / (bNorth - bSouth)) * canvas.height,
  });
  // car parks mapped only by their aisles: a bay's depth of parking each side
  // of every parking aisle (the export lays its bays there), under the rest
  // (an aisle in a mapped car park: that outline is painted instead)
  const lotRings = (terrainData.osmFeatures || []).filter((f) => f?.tags?.amenity === "parking" && f.geometry?.length >= 3).map((f) => f.geometry);
  const inLot = (p) => lotRings.some((ring) => {
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const a = ring[i]; const b = ring[j];
      if ((a.lat > p.lat) !== (b.lat > p.lat) && p.lng < ((b.lng - a.lng) * (p.lat - a.lat)) / (b.lat - a.lat) + a.lng) inside = !inside;
    }
    return inside;
  });
  ctx.save();
  ctx.strokeStyle = GAME_COLORS.parking;
  ctx.lineCap = "butt";
  ctx.lineJoin = "miter";
  for (const f of terrainData.osmFeatures || []) {
    if (f?.type !== "road" || f.tags?.highway !== "service" || f.tags?.service !== "parking_aisle" || !(f.geometry?.length >= 2)) continue;
    if (inLot(f.geometry[Math.floor(f.geometry.length / 2)])) continue;
    const aisleM = (Number.parseFloat(f.tags.width) > 0 ? Number.parseFloat(f.tags.width) : 6) + 2 * 5.5;
    ctx.lineWidth = aisleM * METERS_TO_PX;
    ctx.beginPath();
    f.geometry.forEach((p, i) => { const q = toPixel(p.lat, p.lng); if (i) ctx.lineTo(q.x, q.y); else ctx.moveTo(q.x, q.y); });
    ctx.stroke();
  }
  ctx.restore();
  renderFeaturesToCanvas(ctx, terrainData.osmFeatures || [], toPixel, METERS_TO_PX, {
    ...options,
    palette: GAME_COLORS,
    baseColor: GAME_COLORS.defaultLanduse,
    // (with a satellite image, water is drawn from it below instead)
    // (and with a land cover, OSM's rock, scree and glacier outlines: the
    // classes paint rock where the land cover is bare, the snow pass ice)
    skipArea: satellite ? (tags, unmatched) => unmatched || leftToGround(tags) || isWaterArea(tags)
      || (terrainData.landCover?.grid && OSM_ROCK.has(tags?.natural)) : null,
  });

  // gentle large-scale variation, then a fine grain: ground, not a vector map
  const macro = document.createElement("canvas");
  macro.width = 48; macro.height = 48;
  const mctx = macro.getContext("2d");
  const mdata = mctx.createImageData(48, 48);
  let seed = 1234567;
  const rand = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
  for (let i = 0; i < 48 * 48; i++) {
    const v = 128 + (rand() - 0.5) * 34;
    mdata.data[i * 4] = v; mdata.data[i * 4 + 1] = v; mdata.data[i * 4 + 2] = v; mdata.data[i * 4 + 3] = 255;
  }
  mctx.putImageData(mdata, 0, 0);
  ctx.save();
  ctx.globalCompositeOperation = "overlay";
  ctx.globalAlpha = 0.5;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(macro, 0, 0, canvas.width, canvas.height);
  ctx.globalAlpha = 0.25;
  ctx.fillStyle = ctx.createPattern(createNoisePattern("#808080"), "repeat");
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.restore();

  const steep = paintSteepRock(ctx, canvas, terrainData);
  if (steep) console.log(`[Game Texture] Steep ground (over ~45°) painted as rock: ${(steep * 100).toFixed(1)}% of the texture.`);
  const snow = paintLandCoverSnow(ctx, canvas, terrainData, ground?.image || options.satelliteCanvas || null);
  if (snow) console.log(`[Game Texture] Snow and ice (ESA WorldCover) painted: ${(snow * 100).toFixed(1)}% of the texture.`);

  // (after the rock and snow, before the water, which is the image already)
  // the satellite's fine detail and a little of its colour over the flat
  // classes (Fizz_Mechanic: "a blend of satellite details and the game's
  // texture"): ground with paths, rocks and tufts, still game colours
  if (ground?.image && options.satelliteDetail !== false) {
    const k = addSatelliteDetail(ctx, canvas, ground.image, { detail: options.detailStrength, tint: options.tintStrength });
    if (k) console.log(`[Game Texture] Satellite detail blended in (detail ${k.detail}, colour ${k.tint}).`);
  }

  // Water: the satellite's own pixels, not a paint (players disliked blue,
  // and a creek looks like the creek). Mapped water (areas, and streams at
  // their width) plus what the satellite itself shows as water, through one
  // mask; after the grain, so the imagery stays clean.
  if (ground?.image) {
    const mask = document.createElement("canvas");
    mask.width = canvas.width; mask.height = canvas.height;
    const mctx2 = mask.getContext("2d");
    mctx2.fillStyle = "#fff"; mctx2.strokeStyle = "#fff";
    mctx2.lineCap = "round"; mctx2.lineJoin = "round";
    for (const f of terrainData.osmFeatures || []) {
      if (!isWaterArea(f?.tags) || isUndergroundArea(f.tags) || !(f.geometry?.length >= 2)) continue;
      const pts = f.geometry.map((p) => toPixel(p.lat, p.lng));
      const first = f.geometry[0]; const last = f.geometry[f.geometry.length - 1];
      const closed = Math.abs(first.lat - last.lat) < 1e-9 && Math.abs(first.lng - last.lng) < 1e-9;
      const linear = f.tags.waterway && f.tags.waterway !== "riverbank" && f.tags.area !== "yes";
      mctx2.beginPath();
      pts.forEach((q, i) => (i ? mctx2.lineTo(q.x, q.y) : mctx2.moveTo(q.x, q.y)));
      if (linear && !closed) {
        const wM = Number.parseFloat(f.tags.width) > 0 ? Number.parseFloat(f.tags.width)
          : f.tags.waterway === "river" ? 8 : f.tags.waterway === "canal" ? 6 : f.tags.waterway === "stream" ? 3 : 2;
        mctx2.lineWidth = Math.max(1, wM * METERS_TO_PX);
        mctx2.stroke();
      } else {
        mctx2.closePath();
        for (const hole of f.holes || []) {
          hole.forEach((p, i) => { const q = toPixel(p.lat, p.lng); if (i) mctx2.lineTo(q.x, q.y); else mctx2.moveTo(q.x, q.y); });
          mctx2.closePath();
        }
        mctx2.fill("evenodd");
      }
    }
    // the satellite's own water (unmapped ponds, a river wider than its line)
    const { cls, w, h } = ground;
    const waterIdx = GROUND_CLASSES.indexOf("water");
    const wc = document.createElement("canvas");
    wc.width = w; wc.height = h;
    const wctx = wc.getContext("2d");
    const wd = wctx.createImageData(w, h);
    for (let i = 0; i < w * h; i++) if (cls[i] === waterIdx) { wd.data[i * 4] = wd.data[i * 4 + 1] = wd.data[i * 4 + 2] = 255; wd.data[i * 4 + 3] = 255; }
    wctx.putImageData(wd, 0, 0);
    mctx2.imageSmoothingEnabled = true;
    mctx2.drawImage(wc, 0, 0, mask.width, mask.height);
    mctx2.globalCompositeOperation = "source-in";
    mctx2.imageSmoothingQuality = "high";
    mctx2.drawImage(ground.image, 0, 0, mask.width, mask.height);
    // (not the near-black: a river under trees or in a gorge's shade is
    // shadow in the image, pasted as a black streak; kept where the land
    // cover has water or town, a dark reservoir or canal is water)
    const lcw = terrainData.landCover?.grid?.length === terrainData.landCover?.n ** 2 ? terrainData.landCover : null;
    if (lcw) {
      const { grid, n } = lcw;
      const wet = new Uint8Array(n * n);
      for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) {
        // (built-up too: a city's canals are under 10 m and class as town)
        if (grid[r * n + c] !== WC.WATER && grid[r * n + c] !== WC.BUILT && grid[r * n + c] !== 0) continue;
        for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
          const rr = r + dr; const cc = c + dc;
          if (rr >= 0 && cc >= 0 && rr < n && cc < n) wet[rr * n + cc] = 1;
        }
      }
      let dropped = 0;
      for (let y0 = 0; y0 < mask.height; y0 += 256) {
        const rows = Math.min(256, mask.height - y0);
        const im = mctx2.getImageData(0, y0, mask.width, rows); const d = im.data; let changed = false;
        for (let ty = 0; ty < rows; ty++) {
          const rr = Math.min(n - 1, Math.floor(((y0 + ty + 0.5) / mask.height) * n)) * n;
          for (let tx = 0; tx < mask.width; tx++) {
            const i = (ty * mask.width + tx) * 4;
            if (!d[i + 3] || 0.3 * d[i] + 0.59 * d[i + 1] + 0.11 * d[i + 2] >= 40) continue;
            if (wet[rr + Math.min(n - 1, Math.floor(((tx + 0.5) / mask.width) * n))]) continue;
            d[i + 3] = 0; changed = true; dropped++;
          }
        }
        if (changed) mctx2.putImageData(im, 0, y0);
      }
      if (dropped) console.log(`[Game Texture] Shadowed water left to the ground (no water in the land cover): ${(dropped / (mask.width * mask.height) * 100).toFixed(2)}% of the texture.`);
    }
    ctx.drawImage(mask, 0, 0);
    mask.width = 0; wc.width = 0;
  }


  const blob = await new Promise((r) => canvas.toBlob((b) => r(b || null), "image/png"));
  const url = blob ? URL.createObjectURL(blob) : "";
  console.log(`[Game Texture] ${canvas.width}x${canvas.height}, ${satellite ? "ground classified from satellite" : "no satellite: grass ground"}, blob=${blob ? `${(blob.size / 1024).toFixed(0)} KB` : "null"}`);
  return { url, canvas, blob };
};

export const generateHybridTexture = async (terrainData, options = {}) => {
  const onProgress = options.onProgress;
  onProgress?.("Blending satellite imagery with vector overlays...");
  const MAX_TEX_SIZE = 8192;

  // Background source: the lossless satellite canvas when the caller still
  // holds it, else the satellite blob URL.
  let satellite = options.satelliteCanvas?.width > 0 ? options.satelliteCanvas : null;
  if (!satellite && terrainData.satelliteTextureUrl) {
    const img = new Image();
    img.src = terrainData.satelliteTextureUrl;
    const loaded = await new Promise((resolve) => {
      img.onload = () => resolve(true);
      img.onerror = (e) => {
        console.warn("[Hybrid Texture] Failed to load satellite image:", e?.message || e);
        resolve(false);
      };
    });
    if (loaded && img.naturalWidth > 0) satellite = img;
    else console.warn("[Hybrid Texture] Satellite image not drawable — falling back to black background");
  } else if (!satellite) {
    console.warn("[Hybrid Texture] No satelliteTextureUrl — using black background");
  }

  // Match the satellite texture's resolution (it may be finer than the grid,
  // baseTextureSize.js) unless the caller asks for a size.
  const satelliteWidth = satellite ? (satellite.naturalWidth || satellite.width) : 0;
  const requestedSize = Number(options.outputSize || satelliteWidth || terrainData.width || 1024);
  const targetSize = Math.max(1, Math.min(MAX_TEX_SIZE, Math.floor(requestedSize)));
  const SCALE_FACTOR = targetSize / Math.max(1, terrainData.width);
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(terrainData.width * SCALE_FACTOR));
  canvas.height = Math.max(1, Math.round(terrainData.height * SCALE_FACTOR));
  console.log(`[Hybrid Texture] Generating hybrid texture ${canvas.width}x${canvas.height}`);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Could not get 2D context");

  if (satellite) {
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(satellite, 0, 0, canvas.width, canvas.height);
  } else {
    ctx.fillStyle = "#000000";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }

  renderRoadOverlayOnCanvas(canvas, terrainData, {
    ...options,
    alpha: 1.0,
  });

  const blob = await new Promise((r) =>
    canvas.toBlob((b) => r(b || null), "image/png"),
  );
  if (!blob) console.warn("[Hybrid Texture] canvas.toBlob() returned null — canvas may be tainted or too large");
  const url = blob ? URL.createObjectURL(blob) : "";
  console.log(`[Hybrid Texture] Done — blob=${blob ? `${(blob.size / 1024).toFixed(0)} KB` : "null"}, url=${url ? "ok" : "empty"}`);
  return { url, canvas, blob };
};

export function renderRoadOverlayOnCanvas(canvas, terrainData, options = {}) {
  if (!canvas || !terrainData?.bounds || !terrainData?.osmFeatures?.length) return canvas;

  const ctx = canvas.getContext("2d");
  if (!ctx) return canvas;

  const scaleFactor = canvas.width / Math.max(1, terrainData.width);
  const processingMetersPerPixel = Number.isFinite(Number(terrainData?.processingMetersPerPixel))
    && Number(terrainData.processingMetersPerPixel) > 0
    ? Number(terrainData.processingMetersPerPixel)
    : 1;
  const metersToPx = scaleFactor / processingMetersPerPixel;
  // Linear lat/lng → pixel box-stretch (matches geoToWorld + the satellite
  // background this overlays). Metric projection would drift by ~cos(lat).
  const { north: bNorth, south: bSouth, east: bEast, west: bWest } = terrainData.bounds;
  const toPixel = (lat, lng) => ({
    x: ((lng - bWest) / (bEast - bWest)) * canvas.width,
    y: ((bNorth - lat) / (bNorth - bSouth)) * canvas.height,
  });

  const roadFeatures = terrainData.osmFeatures.filter(
    (f) => f.type === "road" || f.type === "bridge_infra",
  );

  renderFeaturesToCanvas(ctx, roadFeatures, toPixel, metersToPx, {
    ...options,
    alpha: options.alpha ?? 1.0,
  });

  return canvas;
}
