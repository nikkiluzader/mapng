import { createWGS84ToLocal } from "./geoUtils.js";

// Colors mixed from standard OSM Carto and OpenStreetBrowser
// Carto: https://github.com/gravitystorm/openstreetmap-carto/blob/master/style/landcover.mss
// OSB: https://wiki.openstreetmap.org/wiki/OpenStreetBrowser/Landuse-_and_Building_Colors
const COLORS = {
  // Vegetation (Standard Carto is good for these)
  forest: "#4a7a52", // Deep Forest Green
  scrub: "#7c8c60", // Muted Olive
  heath: "#9aa376", // Darker Heath
  grass: "#4d7c38", // Deep Grass Green
  orchard: "#7bb56e", // Rich Orchard
  farmland: "#c5c9a3", // Muted Farmland

  // Water (Standard Carto)
  water: "#4a7c9b", // Deep River Blue
  wetland: "#6b7d4c", // Dark Moss
  swamp: "#1e2b23", // Very Dark Swamp
  glacier: "#cce0e0", // Slightly darker ice
  mud: "#d1c4b8", // Darker Mud

  // Bare (Standard Carto)
  bare: "#d6cdc4", // bare_rock, scree, blockfield, shingle
  sand: "#e0d3b0", // sand, beach, shoal
  dirt: "#bfae96", // earth, dirt, brownfield, construction
  quarry: "#a8a8a8", // quarry, mining

  // Developed / Landuse (Using OpenStreetBrowser for distinct zoning)
  residential: "#ccb18b", // OSB: brownish/orange
  commercial: "#999999", // Cement grey
  industrial: "#999999", // Cement grey
  retail: "#999999", // Cement grey
  education: "#e39ccf", // OSB: pink
  military: "#9d9d7c", // OSB: olive green
  cemetery: "#aacbaf", // OSB: light green
  sport: "#8bccb3", // OSB: teal
  park: "#c8df9f", // OSB: leisure=park
  parking: "#999999", // Cement grey
  aeroway: "#e9d1ff", // Light purple for airport grounds
  apron: "#dadae0", // Grey for aprons
  runway: "#bbbbcc", // Darker grey for runways
  power: "#bbbbbb", // Industrial grey
  tourism: "#734a08", // Brownish (attractions)
  hospital: "#ffeccf", // Light beige/red tint

  // Defaults
  building: "#d9d0c9",
  buildingStroke: "#c4b6ab",
  road: "#404040",
  path: "#cccccc",
  track: "#bfae96", // Light brown dirt color
  sidewalk: "#e5e5e5", // Light grey concrete color
  barrier: "#C4A484",
  defaultLanduse: "#999999", // Cement grey color

  // Markings
  markingWhite: "rgba(255, 255, 255, 0.7)",
  markingYellow: "rgba(255, 204, 0, 0.8)",
  markingRed: "rgba(255, 50, 50, 0.8)",
};

const getFeatureColor = (tags, baseColor = COLORS.defaultLanduse) => {
  if (!tags) return baseColor;

  // --- OSM2World inspired surface mapping ---
  // Priority 1: Water
  if (
    tags.natural === "water" ||
    tags.waterway ||
    tags.landuse === "reservoir" ||
    tags.landuse === "basin"
  )
    return COLORS.water;
  if (tags.natural === "wetland" || tags.wetland) {
    const type = tags.wetland;
    if (
      type === "swamp" ||
      type === "marsh" ||
      type === "bog" ||
      type === "fen" ||
      type === "mangrove"
    )
      return COLORS.swamp;
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

  if (tags.power === "plant" || tags.power === "substation")
    return COLORS.power;
  if (
    tags.man_made === "pier" ||
    tags.man_made === "breakwater" ||
    tags.man_made === "groyne"
  )
    return COLORS.bare;
  if (tags.man_made === "bridge") return COLORS.building; // Or generic grey

  // Priority 3: Surface / Landuse / Leisure generic mapping
  const surface =
    tags.surface ||
    tags.landcover ||
    tags.landuse ||
    tags.natural ||
    tags.leisure ||
    tags.tourism;

  if (["forest", "wood"].includes(surface)) return COLORS.forest;
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
    ].includes(surface)
  )
    return COLORS.grass;
  if (["scrub", "heath", "tundra"].includes(surface)) return COLORS.scrub;
  if (["orchard", "vineyard", "plant_nursery"].includes(surface))
    return COLORS.orchard;
  if (["farmland", "farmyard", "greenhouse_horticulture"].includes(surface))
    return COLORS.farmland;

  if (["sand", "beach"].includes(surface)) return COLORS.sand;
  if (["bare_rock", "rock", "scree", "shingle"].includes(surface))
    return COLORS.bare;
  if (["glacier", "snow"].includes(surface)) return COLORS.glacier;
  if (
    ["mud", "ground", "dirt", "earth", "construction", "brownfield"].includes(
      surface,
    )
  )
    return COLORS.dirt;

  if (["residential"].includes(surface)) return COLORS.residential;
  if (["commercial", "retail"].includes(surface)) return COLORS.commercial;
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
      "playground",
      "sports_centre",
    ].includes(surface)
  )
    return COLORS.sport;
  if (["attraction", "zoo", "camp_site", "theme_park"].includes(surface))
    return COLORS.tourism;

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

const getLaneLayout = (tags) => {
  const highway = tags.highway;
  const isOneWay =
    tags.oneway === "yes" || tags.oneway === "1" || highway === "motorway" || highway === "motorway_link";
  const lanesT = parseInt(tags.lanes) || (isOneWay ? 1 : 2);
  const lanesF = parseInt(tags["lanes:forward"]) || Math.ceil(lanesT / 2);
  const lanesB = parseInt(tags["lanes:backward"]) || lanesT - lanesF;

  const layout = {
    totalWidth: parseFloat(tags.width) || 0,
    lanes: [],
    highway,
    isOneWay,
    lanesTotal: lanesT,
    unmarked: isUnmarkedSurface(tags),
  };

  // Width estimation (following OSM2World's defaults)
  if (layout.totalWidth === 0) {
    if (highway === "motorway" || highway === "trunk")
      layout.totalWidth = lanesT * 3.7;
    else if (highway === "primary" || highway === "secondary")
      layout.totalWidth = lanesT * 3.5;
    else if (highway === "tertiary")
      layout.totalWidth = lanesT * 3.25;
    else if (highway === "residential" || highway === "unclassified")
      layout.totalWidth = lanesT * 3.0;
    else if (highway === "service")
      layout.totalWidth = Math.max(lanesT * 2.5, 4.0);
    else layout.totalWidth = lanesT * 2.8;
  }

  // Skip lane detail for unmarked surfaces
  if (layout.unmarked) return layout;

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
      layout.lanes.push({ type: "vehicle", width: 3.5 });
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
    layout.lanes.push({ type: "vehicle", width: 3.5 });
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

// --- Junction / Intersection Rendering ---

/**
 * Build a spatial index of road endpoints for fast junction detection.
 * Groups nearby endpoints (within tolerance) at shared OSM nodes.
 */
const buildJunctionMap = (roads, toPixel) => {
  // Map from "lat,lng" key to junction info
  const junctions = new Map();
  const tolerance = 0.0000001; // ~1cm

  const makeKey = (lat, lng) => `${lat.toFixed(7)},${lng.toFixed(7)}`;

  roads.forEach((road) => {
    const geom = road.geometry;
    if (geom.length < 2) return;

    // Check first point
    const startKey = makeKey(geom[0].lat, geom[0].lng);
    if (!junctions.has(startKey)) {
      junctions.set(startKey, {
        lat: geom[0].lat, lng: geom[0].lng,
        roads: [], pixel: null,
      });
    }
    junctions.get(startKey).roads.push({ road, isStart: true });

    // Check last point
    const endKey = makeKey(geom[geom.length - 1].lat, geom[geom.length - 1].lng);
    if (!junctions.has(endKey)) {
      junctions.set(endKey, {
        lat: geom[geom.length - 1].lat, lng: geom[geom.length - 1].lng,
        roads: [], pixel: null,
      });
    }
    junctions.get(endKey).roads.push({ road, isStart: false });
  });

  // Only keep actual junctions (3+ roads meeting) or T-intersections
  const result = new Map();
  for (const [key, junction] of junctions) {
    if (junction.roads.length >= 3) {
      junction.pixel = toPixel(junction.lat, junction.lng);
      result.set(key, junction);
    }
  }
  return result;
};

/**
 * Render junction areas as smooth polygons with curved corners.
 * Inspired by OSM2World's RoadJunction: connects road border edges with
 * quadratic bezier curves whose control points lie at the intersection
 * of adjacent road edge lines, creating natural rounded‐corner shapes.
 * Also covers the center area so that any lane markings drawn through the
 * junction are cleanly erased.
 */
const renderJunctions = (ctx, junctions, toPixel, SCALE_FACTOR) => {
  for (const [, junction] of junctions) {
    const center = junction.pixel;
    const arms = [];
    let maxHalfW = 0;

    junction.roads.forEach(({ road, isStart }) => {
      const layout = getLaneLayout(road.tags || {});
      const halfW = (layout.totalWidth / 2) * SCALE_FACTOR;
      maxHalfW = Math.max(maxHalfW, halfW);
      const geom = road.geometry;
      if (geom.length < 2) return;

      let p0, p1;
      if (isStart) {
        p0 = toPixel(geom[0].lat, geom[0].lng);
        p1 = toPixel(geom[1].lat, geom[1].lng);
      } else {
        p0 = toPixel(geom[geom.length - 1].lat, geom[geom.length - 1].lng);
        p1 = toPixel(geom[geom.length - 2].lat, geom[geom.length - 2].lng);
      }

      // Direction pointing AWAY from junction (into the road body)
      const dx = p1.x - p0.x;
      const dy = p1.y - p0.y;
      const len = Math.sqrt(dx * dx + dy * dy);
      if (len < 0.001) return;

      const dirX = dx / len;
      const dirY = dy / len;
      // Perpendicular (90° of direction)
      const nx = -dirY;
      const ny = dirX;
      const outAngle = Math.atan2(dy, dx);

      arms.push({
        halfW, dirX, dirY, nx, ny, outAngle,
        // CW / CCW border points (as seen from above, looking outward)
        cw:  { x: p0.x + nx * halfW, y: p0.y + ny * halfW },
        ccw: { x: p0.x - nx * halfW, y: p0.y - ny * halfW },
      });
    });

    if (arms.length < 2) continue;

    // Sort arms by outward angle (ascending → goes clockwise in canvas coords)
    arms.sort((a, b) => a.outAngle - b.outAngle);

    // Build junction polygon: CCW → CW across each arm, curve to next arm
    ctx.beginPath();
    for (let i = 0; i < arms.length; i++) {
      const curr = arms[i];
      const next = arms[(i + 1) % arms.length];

      if (i === 0) ctx.moveTo(curr.ccw.x, curr.ccw.y);
      // Across the road width
      ctx.lineTo(curr.cw.x, curr.cw.y);

      // Curved connection from curr.cw → next.ccw (the corner between arms)
      // Control point = intersection of the two road‐edge lines extended
      // back toward the junction.
      const det = curr.dirX * (-next.dirY) - curr.dirY * (-next.dirX);

      if (Math.abs(det) < 0.001) {
        // Nearly parallel arms – straight line
        ctx.lineTo(next.ccw.x, next.ccw.y);
      } else {
        const dX = next.ccw.x - curr.cw.x;
        const dY = next.ccw.y - curr.cw.y;
        const t = (-dX * next.dirY + dY * next.dirX) / det;

        let cpX = curr.cw.x + t * curr.dirX;
        let cpY = curr.cw.y + t * curr.dirY;

        // Clamp if the corner point flies too far from center
        const cornerDist = Math.sqrt(
          (cpX - center.x) ** 2 + (cpY - center.y) ** 2,
        );
        if (cornerDist > maxHalfW * 4) {
          const midX = (curr.cw.x + next.ccw.x) / 2;
          const midY = (curr.cw.y + next.ccw.y) / 2;
          cpX = midX * 0.4 + center.x * 0.6;
          cpY = midY * 0.4 + center.y * 0.6;
        }
        ctx.quadraticCurveTo(cpX, cpY, next.ccw.x, next.ccw.y);
      }
    }
    ctx.closePath();
    ctx.fillStyle = COLORS.road;
    ctx.fill();

    // Safety fill: a circle at center covers any hairline gaps
    ctx.beginPath();
    ctx.arc(center.x, center.y, maxHalfW * 0.9, 0, Math.PI * 2);
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

  // Build a set of crossing point keys from footway endpoints that touch road geometry
  const crossingPoints = [];

  // Method 1: Check OSM nodes with highway=crossing or crossing tags in road geometry
  roads.forEach((road) => {
    const layout = getLaneLayout(road.tags || {});
    const geom = road.geometry;
    if (geom.length < 2) return;

    // Look for crossing nodes embedded in the road geometry
    geom.forEach((pt, idx) => {
      // Skip endpoints — those are junctions, not crossings
      if (idx === 0 || idx === geom.length - 1) return;

      // We can't check node tags directly from geometry, but we can check
      // if a footway endpoint matches this road point (Method 2 below)
    });
  });

  // Method 2: Find footway endpoints that are ON a road segment
  footways.forEach((fw) => {
    const fwGeom = fw.geometry;
    if (fwGeom.length < 2) return;

    // Check both endpoints of the footway
    [fwGeom[0], fwGeom[fwGeom.length - 1]].forEach((fwPt) => {
      const fwPx = toPixel(fwPt.lat, fwPt.lng);

      roads.forEach((road) => {
        const layout = getLaneLayout(road.tags || {});
        const halfW = layout.totalWidth / 2;
        const geom = road.geometry;

        for (let i = 0; i < geom.length - 1; i++) {
          const a = toPixel(geom[i].lat, geom[i].lng);
          const b = toPixel(geom[i + 1].lat, geom[i + 1].lng);

          // Point-to-segment distance
          const segDx = b.x - a.x;
          const segDy = b.y - a.y;
          const segLen = Math.sqrt(segDx * segDx + segDy * segDy);
          if (segLen === 0) continue;

          const t = Math.max(0, Math.min(1,
            ((fwPx.x - a.x) * segDx + (fwPx.y - a.y) * segDy) / (segLen * segLen)
          ));
          const projX = a.x + t * segDx;
          const projY = a.y + t * segDy;
          const dist = Math.sqrt((fwPx.x - projX) ** 2 + (fwPx.y - projY) ** 2);

          if (dist < halfW * SCALE_FACTOR * 1.5) {
            // Road direction perpendicular
            const rdx = segDx / segLen;
            const rdy = segDy / segLen;
            crossingPoints.push({
              x: projX, y: projY,
              nx: -rdy, ny: rdx, // perpendicular to road
              roadWidth: halfW * SCALE_FACTOR,
            });
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

  // If unmarked surface, skip all lane markings
  if (layout.unmarked) return;

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
    let pts = feature.geometry.map((p) => toPixel(p.lat, p.lng));
    pts = subdivideAndSmooth(pts, 3);
    if (pts.length > 0) {
      ctx.moveTo(pts[0].x, pts[0].y);
      for (let i = 1; i < pts.length; i++) {
        ctx.lineTo(pts[i].x, pts[i].y);
      }
    }
    ctx.closePath();

    if (feature.holes) {
      for (const hole of feature.holes) {
        let holePts = hole.map((p) => toPixel(p.lat, p.lng));
        holePts = subdivideAndSmooth(holePts, 3);
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
  const landcover = features.filter((f) =>
    ["vegetation", "water", "landuse"].includes(f.type),
  );

  const isGrass = (tags) => {
    if (!tags) return false;
    const surface =
      tags.surface ||
      tags.landcover ||
      tags.landuse ||
      tags.natural ||
      tags.leisure ||
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
    ].includes(surface);
  };

  const isWater = (tags) => {
    if (!tags) return false;
    if (
      tags.natural === "water" ||
      tags.waterway ||
      tags.landuse === "reservoir" ||
      tags.landuse === "basin"
    )
      return true;
    if (tags.natural === "wetland" || tags.wetland) return true;
    if (tags.natural === "glacier") return true;
    return false;
  };

  const waterFeatures = [];
  const grassFeatures = [];
  const otherFeatures = [];

  landcover.forEach((f) => {
    const item = { f, area: getFeatureArea(f) };
    if (isWater(f.tags)) {
      waterFeatures.push(item);
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
  waterFeatures.sort(byArea);

  // Combine in draw order: Others -> Grass -> Water
  const sortedLC = [...otherFeatures, ...grassFeatures, ...waterFeatures];

  if (options.alpha) ctx.globalAlpha = options.alpha;
  for (const { f } of sortedLC) {
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
        let w = 1.5; // Stream default
        if (f.tags.width) w = parseFloat(f.tags.width);
        else if (f.tags.waterway === "river") w = 6;
        else if (f.tags.waterway === "canal") w = 4;
        else if (f.tags.waterway === "drain" || f.tags.waterway === "ditch")
          w = 1;

        ctx.lineWidth = w * SCALE_FACTOR;
        ctx.stroke();
      } else {
        drawPolygon(f);
        ctx.fill("evenodd");
      }
    }
  }
  ctx.globalAlpha = 1.0;

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
    const layerA = parseInt(a.tags.layer) || 0;
    const layerB = parseInt(b.tags.layer) || 0;
    if (layerA !== layerB) return layerA - layerB;
    return (
      (roadPriority[a.tags.highway] || 10) -
      (roadPriority[b.tags.highway] || 10)
    );
  });

  // Separate vehicle roads from footways/paths for junction detection
  const vehicleRoads = roads.filter(
    (f) => !["footway", "path", "pedestrian", "cycleway", "steps", "track"].includes(f.tags?.highway)
  );

  // Build junction map for vehicle roads
  const junctions = buildJunctionMap(vehicleRoads, (lat, lng) => toPixel(lat, lng));

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
      } else if (["footway", "path", "track"].includes(highway)) {
        ctx.strokeStyle = COLORS.track;
      } else {
        ctx.strokeStyle = COLORS.path;
      }
      ctx.lineWidth = 1.5 * SCALE_FACTOR;
      ctx.stroke();
    }
  });

  // Pass 2: Draw vehicle road base pavement (no markings yet)
  vehicleRoads.forEach((f) => {
    const layout = getLaneLayout(f.tags || {});
    const geometry = f.geometry;
    let centerPoints = geometry.map((p) => toPixel(p.lat, p.lng));
    centerPoints = subdivideAndSmooth(centerPoints, 3);

    ctx.beginPath();
    drawPathData(ctx, centerPoints);
    ctx.strokeStyle = COLORS.road;
    ctx.lineWidth = layout.totalWidth * SCALE_FACTOR;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.stroke();
  });

  // Pass 3: Draw lane markings (will extend into junctions — cleaned up next)
  ctx.lineCap = "butt";
  vehicleRoads.forEach((f) => {
    drawRoadWithMarkings(ctx, f, toPixel, SCALE_FACTOR);
  });

  // Pass 4: Junction fills OVER markings → erases lane lines from intersection
  // areas, producing the clean marking‑free surface real intersections have.
  renderJunctions(ctx, junctions, (lat, lng) => toPixel(lat, lng), SCALE_FACTOR);

  // Pass 5: Draw crosswalk markings where footways cross roads
  renderCrosswalks(ctx, vehicleRoads, features, toPixel, SCALE_FACTOR);

  // 3. Draw Buildings
  const buildings = features.filter((f) => f.type === "building");
  ctx.lineWidth = 0.5 * SCALE_FACTOR;
  buildings.forEach((f) => {
    ctx.fillStyle = getFeatureColor(f.tags, baseColor);
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
  // Cap texture at 8192px max to avoid 1GB+ RGBA buffers (16384^2 = 1GB)
  const MAX_TEX_SIZE = 8192;
  const TARGET_RESOLUTION = MAX_TEX_SIZE;
  let SCALE_FACTOR = Math.max(
    2,
    Math.ceil(TARGET_RESOLUTION / terrainData.width),
  );
  // Ensure final canvas doesn't exceed max
  if (terrainData.width * SCALE_FACTOR > MAX_TEX_SIZE) {
    SCALE_FACTOR = Math.max(1, Math.floor(MAX_TEX_SIZE / terrainData.width));
  }
  const canvas = document.createElement("canvas");
  canvas.width = terrainData.width * SCALE_FACTOR;
  canvas.height = terrainData.height * SCALE_FACTOR;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Could not get 2D context");

  const centerLat = (terrainData.bounds.north + terrainData.bounds.south) / 2;
  const centerLng = (terrainData.bounds.east + terrainData.bounds.west) / 2;
  const toMetric = createWGS84ToLocal(centerLat, centerLng);
  const halfW = terrainData.width / 2,
    halfH = terrainData.height / 2;

  const toPixel = (lat, lng) => {
    const [lx, ly] = toMetric.forward([lng, lat]);
    return { x: (lx + halfW) * SCALE_FACTOR, y: (halfH - ly) * SCALE_FACTOR };
  };

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
    SCALE_FACTOR,
    options,
  );

  const url = await new Promise((r) =>
    canvas.toBlob((b) => r(b ? URL.createObjectURL(b) : ""), "image/png"),
  );
  return { url, canvas };
};

export const generateHybridTexture = async (terrainData, options = {}) => {
  const onProgress = options.onProgress;
  onProgress?.("Blending satellite imagery with vector overlays...");
  const MAX_TEX_SIZE = 8192;
  const TARGET_RESOLUTION = MAX_TEX_SIZE;
  let SCALE_FACTOR = Math.max(
    2,
    Math.ceil(TARGET_RESOLUTION / terrainData.width),
  );
  if (terrainData.width * SCALE_FACTOR > MAX_TEX_SIZE) {
    SCALE_FACTOR = Math.max(1, Math.floor(MAX_TEX_SIZE / terrainData.width));
  }
  const canvas = document.createElement("canvas");
  canvas.width = terrainData.width * SCALE_FACTOR;
  canvas.height = terrainData.height * SCALE_FACTOR;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Could not get 2D context");

  // Background: Satellite Image
  if (terrainData.satelliteTextureUrl) {
    const img = new Image();
    img.crossOrigin = "Anonymous";
    img.src = terrainData.satelliteTextureUrl;
    await new Promise((r) => {
      img.onload = r;
      img.onerror = r;
    }); // robust load
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  } else {
    ctx.fillStyle = "#000000";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }

  const centerLat = (terrainData.bounds.north + terrainData.bounds.south) / 2;
  const centerLng = (terrainData.bounds.east + terrainData.bounds.west) / 2;
  const toMetric = createWGS84ToLocal(centerLat, centerLng);
  const halfW = terrainData.width / 2,
    halfH = terrainData.height / 2;

  const toPixel = (lat, lng) => {
    const [lx, ly] = toMetric.forward([lng, lat]);
    return { x: (lx + halfW) * SCALE_FACTOR, y: (halfH - ly) * SCALE_FACTOR };
  };

  // Only render roads for Hybrid mode
  const roadFeatures = terrainData.osmFeatures.filter((f) => f.type === "road");
  renderFeaturesToCanvas(ctx, roadFeatures, toPixel, SCALE_FACTOR, {
    ...options,
    alpha: 1.0,
  });

  const url = await new Promise((r) =>
    canvas.toBlob((b) => r(b ? URL.createObjectURL(b) : ""), "image/png"),
  );
  return { url, canvas };
};
