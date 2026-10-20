import { buildRoadNetwork, makeRoadNodeKey, mergeLinearRoadSegments } from './roadNetwork.js';

const ROAD_SKIP = new Set([
  'footway', 'path', 'pedestrian', 'steps', 'cycleway',
  'bridleway', 'corridor', 'proposed', 'construction',
]);

function isOneWayRoad(tags = {}) {
  const value = String(tags.oneway ?? '').trim().toLowerCase();
  if (value === 'yes' || value === '1' || value === 'true') return true;
  if (value === '-1' || value === 'reverse') return true;
  if (tags.junction === 'roundabout') return true;
  if (tags.highway === 'motorway' || tags.highway === 'motorway_link') return true;
  return false;
}

function isReverseOneWayRoad(tags = {}) {
  const value = String(tags.oneway ?? '').trim().toLowerCase();
  return value === '-1' || value === 'reverse';
}

function shouldGenerateNavigationRoad(feature) {
  if (feature?.type !== 'road' || !Array.isArray(feature.geometry) || feature.geometry.length < 2) {
    return false;
  }

  const tags = feature.tags || {};
  const highway = tags.highway;
  if (!highway || ROAD_SKIP.has(highway)) return false;
  if (tags.area === 'yes') return false;

  const service = String(tags.service ?? '').trim().toLowerCase();
  if (['parking_aisle', 'driveway', 'alley', 'emergency_access'].includes(service)) {
    return false;
  }

  return true;
}

// Road hierarchy as AI drivability. At a junction without signals BeamNG's AI
// gives way when its edge has lower drivability than another edge there
// (vehicle/ai.lua), so small steps by class make side streets yield to main
// roads while barely changing route choice. West Coast USA grades its own
// DecalRoads the same way. Links rank with their parent road.
const ROAD_CLASS_DRIVABILITY = {
  motorway: 1, trunk: 1, primary: 0.98, secondary: 0.96, tertiary: 0.94,
  unclassified: 0.92, residential: 0.9, road: 0.9, living_street: 0.85,
  service: 0.6, track: 0.3,
};
// One notch below the crossing road: a way with a give-way sign yields even
// to a road of its own class.
export const GIVE_WAY_DRIVABILITY_STEP = 0.01;

export function inferRoadDrivability(highway, tags = {}) {
  const base = String(highway ?? '').replace(/_link$/, '');
  let drivability = ROAD_CLASS_DRIVABILITY[base] ?? 0.9;
  const access = String(tags.access ?? '').trim().toLowerCase();
  if (access === 'private' || access === 'no') drivability = Math.min(drivability, 0.6);
  return drivability;
}

function inferMapSegmentDrivability(highway, tags = {}) {
  return inferRoadDrivability(highway, tags);
}

// BeamNG's AI ignores yield signals (it never acts on action 4), so an OSM
// give-way point is expressed as lower drivability on the way it sits on.
const isGiveWayTags = (tags = {}) => {
  if (String(tags.highway ?? '').trim().toLowerCase() === 'give_way') return true;
  const sign = String(tags.traffic_sign ?? '').trim().toLowerCase();
  return sign.includes('give_way') || sign.includes('yield');
};

export function collectGiveWayNodeKeys(osmFeatures = []) {
  const keys = new Set();
  for (const feature of osmFeatures) {
    if (!Array.isArray(feature?.geometry) || feature.geometry.length !== 1) continue;
    if (!isGiveWayTags(feature.tags)) continue;
    const pt = feature.geometry[0];
    if (Number.isFinite(pt?.lat) && Number.isFinite(pt?.lng)) keys.add(makeRoadNodeKey(pt));
  }
  return keys;
}

export function geometryHasGiveWay(geometry, giveWayKeys) {
  if (!giveWayKeys?.size || !Array.isArray(geometry)) return false;
  return geometry.some((pt) => Number.isFinite(pt?.lat) && giveWayKeys.has(makeRoadNodeKey(pt)));
}

function inferMapSegmentRoadMetadata(highway, tags = {}) {
  const access = String(tags.access ?? '').trim().toLowerCase();
  const service = String(tags.service ?? '').trim().toLowerCase();
  const privateLike = access === 'private' || service === 'driveway' || highway === 'track';

  if (!privateLike) {
    return {
      hiddenInNavi: false,
    };
  }

  return {
    type: 'private',
    gatedRoad: true,
    hiddenInNavi: true,
  };
}

function isLinkRoad(highway) {
  return typeof highway === 'string' && highway.endsWith('_link');
}

function inferMapSegmentJunctionMetadata(segment, tags = {}, endpointDegree = 0) {
  const bridge = String(tags.bridge ?? '').trim().toLowerCase();
  const tunnel = String(tags.tunnel ?? '').trim().toLowerCase();
  const covered = String(tags.covered ?? '').trim().toLowerCase();
  const location = String(tags.location ?? '').trim().toLowerCase();
  const embankment = String(tags.embankment ?? '').trim().toLowerCase();
  const cutting = String(tags.cutting ?? '').trim().toLowerCase();

  const isBridgeLike =
    bridge === 'yes' ||
    bridge === 'viaduct' ||
    tags.man_made === 'bridge' ||
    location === 'overground' ||
    location === 'elevated';
  const isTunnelLike =
    tunnel === 'yes' ||
    covered === 'yes' ||
    location === 'underground' ||
    location === 'underwater';
  const isGradeSeparated =
    isBridgeLike ||
    isTunnelLike ||
    embankment === 'yes' ||
    cutting === 'yes' ||
    Number.isFinite(segment?.layer) && Math.abs(Number(segment.layer)) >= 1;
  const denseIntersection = endpointDegree >= 4 || (isLinkRoad(segment?.highway) && endpointDegree >= 3);

  return {
    // Prevent BeamNG auto-junctions on obvious grade-separated links.
    autoJunction: !(isGradeSeparated || denseIntersection),
  };
}

function getIntersectionDegree(intersections, nodeKey) {
  if (!nodeKey || !intersections || typeof intersections.get !== 'function') return 0;
  const entries = intersections.get(nodeKey);
  return Array.isArray(entries) ? entries.length : 0;
}

function shouldPreserveOriginalSegment(segment, intersections) {
  if (!Array.isArray(segment?.members) || segment.members.length < 2) return false;

  const tags = segment.tags || {};
  const endpointDegree = Math.max(
    getIntersectionDegree(intersections, segment.startKey),
    getIntersectionDegree(intersections, segment.endKey),
  );

  return isLinkRoad(segment.highway) || tags.junction === 'roundabout' || endpointDegree >= 4;
}

function resolveNavigationSegments(roadNetwork, mergedRoadSegments) {
  if (!Array.isArray(mergedRoadSegments) || mergedRoadSegments.length === 0) {
    return roadNetwork.segments;
  }

  const out = [];
  for (const segment of mergedRoadSegments) {
    if (shouldPreserveOriginalSegment(segment, roadNetwork.intersections)) {
      out.push(...segment.members);
      continue;
    }
    out.push(segment);
  }
  return out;
}

function parsePositiveInt(value) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function getDefaultLaneCount(highway, isOneWay) {
  if (['motorway', 'trunk'].includes(highway)) return isOneWay ? 2 : 4;
  if (['motorway_link', 'trunk_link', 'primary_link', 'secondary_link', 'tertiary_link'].includes(highway)) {
    return 1;
  }
  if (['service', 'track'].includes(highway)) return 1;
  return isOneWay ? 1 : 2;
}

// Exported: DecalRoad nav metadata (exportBeamNGLevel) uses the same manual
// lane inference as map.json segments so AI lane data stays consistent across
// road modes (DecalRoad.md and Navigation-Map.md document the same fields).
// lanesLeft/lanesRight are PHYSICAL sides relative to node order. BeamNG's
// ge/map.lua reads the left side as backward lanes under right-hand traffic
// and as forward lanes under left-hand traffic (roadRules.rightHandDrive).
// A one-way road whose lanes all decode as backward gets flipped, so forward
// lanes must sit on the travel side or the AI drives one-ways the wrong way.
export function inferManualLaneData(highway, tags = {}, isOneWay = false, leftHandTraffic = false) {
  const forward = parsePositiveInt(tags['lanes:forward']);
  const backward = parsePositiveInt(tags['lanes:backward']);
  const total = parsePositiveInt(tags.lanes);
  const sides = (nForward, nBackward) => (leftHandTraffic
    ? { autoLanes: false, lanesLeft: nForward, lanesRight: nBackward }
    : { autoLanes: false, lanesLeft: nBackward, lanesRight: nForward });

  if (isOneWay) {
    return sides(Math.max(1, forward || total || getDefaultLaneCount(highway, true)), 0);
  }

  if (forward > 0 || backward > 0) {
    return sides(
      Math.max(1, forward || Math.ceil((forward + backward) / 2)),
      Math.max(1, backward || Math.floor((forward + backward) / 2)),
    );
  }

  if (total > 0) {
    return sides(Math.max(1, Math.ceil(total / 2)), Math.max(1, Math.floor(total / 2)));
  }

  const fallback = Math.max(2, getDefaultLaneCount(highway, false));
  return sides(Math.max(1, Math.ceil(fallback / 2)), Math.max(1, Math.floor(fallback / 2)));
}

// OSM maxspeed → m/s. Handles "50", "30 mph", "DE:zone30" / "DE:zone:30",
// "walk" and "none" (motorways without a limit; capped for the AI). Implicit
// country defaults ("DE:urban") and anything unparseable return null, which
// lets BeamNG work the speed out itself rather than us guessing a limit.
const NO_LIMIT_KMH = 130;
const WALK_KMH = 7;

export function parseMaxspeedMps(tags = {}) {
  const raw = String(tags.maxspeed ?? '').trim().toLowerCase().split(';')[0].trim();
  if (!raw) return null;
  let kmh = null;
  if (raw === 'none') kmh = NO_LIMIT_KMH;
  else if (raw === 'walk') kmh = WALK_KMH;
  else {
    const zone = raw.match(/^[a-z]{2}:zone:?(\d+)$/);
    const match = zone || raw.match(/^(\d+(?:\.\d+)?)\s*(mph|km\/h|kmh|kph)?$/);
    if (!match) return null;
    const value = Number.parseFloat(match[1]);
    if (!Number.isFinite(value) || value <= 0) return null;
    kmh = match[2] === 'mph' ? value * 1.609344 : value;
  }
  return Math.round((kmh / 3.6) * 1000) / 1000;
}

function clipGeometryToMargin(geometry, bounds) {
  if (!Array.isArray(geometry) || geometry.length < 2 || !bounds) return [];

  const marginDegLat = 8 / 111320;
  const centerLat = (bounds.north + bounds.south) / 2;
  const metersPerDegLng = 111320 * Math.cos((centerLat * Math.PI) / 180);
  const marginDegLng = metersPerDegLng > 1e-6 ? 8 / metersPerDegLng : 0;

  const left = bounds.west + marginDegLng;
  const right = bounds.east - marginDegLng;
  const bottom = bounds.south + marginDegLat;
  const top = bounds.north - marginDegLat;

  const inside = (pt) => pt.lng >= left && pt.lng <= right && pt.lat >= bottom && pt.lat <= top;

  const intersect = (a, b, edge) => {
    const dx = b.lng - a.lng;
    const dy = b.lat - a.lat;
    if (Math.abs(dx) < 1e-12 && Math.abs(dy) < 1e-12) return { lat: a.lat, lng: a.lng };

    let t = 0;
    if (edge === 'left') t = (left - a.lng) / dx;
    else if (edge === 'right') t = (right - a.lng) / dx;
    else if (edge === 'bottom') t = (bottom - a.lat) / dy;
    else t = (top - a.lat) / dy;

    t = Math.max(0, Math.min(1, t));
    return {
      lng: a.lng + dx * t,
      lat: a.lat + dy * t,
    };
  };

  const segments = [];
  let current = [];

  for (let i = 0; i < geometry.length - 1; i++) {
    const a = geometry[i];
    const b = geometry[i + 1];
    const aIn = inside(a);
    const bIn = inside(b);

    if (aIn && bIn) {
      if (current.length === 0) current.push(a);
      current.push(b);
      continue;
    }

    const edges = ['left', 'right', 'bottom', 'top'];
    const intersections = [];
    for (const edge of edges) {
      const p = intersect(a, b, edge);
      if (
        Number.isFinite(p.lat) && Number.isFinite(p.lng) &&
        p.lng >= left - 1e-9 && p.lng <= right + 1e-9 &&
        p.lat >= bottom - 1e-9 && p.lat <= top + 1e-9
      ) {
        intersections.push(p);
      }
    }

    const uniq = [];
    for (const p of intersections) {
      if (!uniq.some((q) => Math.abs(q.lat - p.lat) < 1e-9 && Math.abs(q.lng - p.lng) < 1e-9)) {
        uniq.push(p);
      }
    }

    uniq.sort((p1, p2) => {
      const d1 = (p1.lng - a.lng) ** 2 + (p1.lat - a.lat) ** 2;
      const d2 = (p2.lng - a.lng) ** 2 + (p2.lat - a.lat) ** 2;
      return d1 - d2;
    });

    if (aIn && !bIn) {
      if (current.length === 0) current.push(a);
      if (uniq[0]) current.push(uniq[0]);
      if (current.length >= 2) segments.push(current);
      current = [];
    } else if (!aIn && bIn) {
      current = [];
      if (uniq[0]) current.push(uniq[0]);
      current.push(b);
    } else if (!aIn && !bIn && uniq.length === 2) {
      segments.push([uniq[0], uniq[1]]);
      current = [];
    }
  }

  if (current.length >= 2) segments.push(current);
  return segments;
}

function chunkPolyline(points, maxNodes = 80) {
  if (!Array.isArray(points) || points.length < 2) return [];
  if (points.length <= maxNodes) return [points];

  const out = [];
  for (let i = 0; i < points.length - 1; i += (maxNodes - 1)) {
    const chunk = points.slice(i, i + maxNodes);
    if (chunk.length >= 2) out.push(chunk);
  }
  return out;
}

function geoToWorld(lat, lng, terrainData, squareSize, zOffset = 0) {
  const { bounds, width, height, heightMap, minHeight } = terrainData;
  const worldSize = width * squareSize;

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
  const sanitizeHeight = (h) => (Number.isFinite(h) && h > -10000 ? h : minHeight);
  const h00 = sanitizeHeight(heightMap[r0 * width + c0]);
  const h10 = sanitizeHeight(heightMap[r0 * width + c1]);
  const h01 = sanitizeHeight(heightMap[r1 * width + c0]);
  const h11 = sanitizeHeight(heightMap[r1 * width + c1]);
  const worldH = (h00 * (1 - tx) * (1 - ty) + h10 * tx * (1 - ty) + h01 * (1 - tx) * ty + h11 * tx * ty) - minHeight;

  const worldX = (u - 0.5) * worldSize;
  const worldY = (0.5 - v) * worldSize;

  return [
    Math.round(worldX * 10) / 10,
    Math.round(worldY * 10) / 10,
    Math.round((worldH + zOffset) * 10) / 10,
  ];
}

export function buildManualMapNavigationData(terrainData, squareSize, roadType) {
  if (roadType !== 'architect' && roadType !== 'mesh') {
    return { segments: {}, waypoints: [] };
  }

  const sourceRoadFeatures = Array.isArray(terrainData?.osmFeatures)
    ? terrainData.osmFeatures.filter(shouldGenerateNavigationRoad)
    : [];
  if (sourceRoadFeatures.length === 0) {
    return { segments: {}, waypoints: [] };
  }

  const roadNetwork = buildRoadNetwork(sourceRoadFeatures);
  const mergedRoadSegments = mergeLinearRoadSegments(roadNetwork.segments, roadNetwork.intersections);
  const navSegmentsSource = resolveNavigationSegments(roadNetwork, mergedRoadSegments);
  const giveWayKeys = collectGiveWayNodeKeys(terrainData.osmFeatures);

  const waypointNameByGeoKey = new Map();
  const waypoints = [];
  const segments = {};
  let waypointIndex = 0;
  let segmentIndex = 0;

  const getWaypointNameForPoint = (point, layer) => {
    const geoKey = `${Number(point.lat).toFixed(7)}:${Number(point.lng).toFixed(7)}|${String(layer)}`;
    const existingName = waypointNameByGeoKey.get(geoKey);
    if (existingName) return existingName;

    const name = `nav_wp_${waypointIndex++}`;
    waypointNameByGeoKey.set(geoKey, name);

    const [wx, wy, wz] = geoToWorld(point.lat, point.lng, terrainData, squareSize, 0.15);
    waypoints.push({
      __parent: 'AIWaypointsGroup',
      class: 'BeamNGWaypoint',
      name,
      position: [wx, wy, wz],
      scale: [1, 1, 1],
    });

    return name;
  };

  for (const segment of navSegmentsSource) {
    const tags = segment.tags || {};
    const givesWay = geometryHasGiveWay(segment.geometry, giveWayKeys);
    const clippedSegments = clipGeometryToMargin(segment.geometry, terrainData.bounds)
      .flatMap((piece) => chunkPolyline(piece, 80));

    for (const piece of clippedSegments) {
      if (!Array.isArray(piece) || piece.length < 2) continue;

      const nodeNames = piece.map((point) => getWaypointNameForPoint(point, segment.layer));
      const dedupedNodeNames = nodeNames.filter((name, idx) => idx === 0 || name !== nodeNames[idx - 1]);
      if (dedupedNodeNames.length < 2) continue;

      const oneWay = isOneWayRoad(tags);
      const endpointDegree = Math.max(
        getIntersectionDegree(roadNetwork.intersections, segment.startKey),
        getIntersectionDegree(roadNetwork.intersections, segment.endKey),
      );
      const mapSegment = {
        nodes: dedupedNodeNames,
        drivability: inferMapSegmentDrivability(segment.highway, tags) - (givesWay ? GIVE_WAY_DRIVABILITY_STEP : 0),
        ...inferManualLaneData(segment.highway, tags, oneWay, !!terrainData.roadRules?.leftHandTraffic),
        ...inferMapSegmentJunctionMetadata(segment, tags, endpointDegree),
      };

      const speedLimit = parseMaxspeedMps(tags);
      if (Number.isFinite(speedLimit) && speedLimit > 0) {
        mapSegment.speedLimit = speedLimit;
      }

      if (oneWay) {
        mapSegment.oneWay = true;
        if (isReverseOneWayRoad(tags)) {
          mapSegment.flipDirection = true;
        }
      }

      Object.assign(mapSegment, inferMapSegmentRoadMetadata(segment.highway, tags));
      segments[`osm_segment_${segmentIndex++}`] = mapSegment;
    }
  }

  return { segments, waypoints };
}
