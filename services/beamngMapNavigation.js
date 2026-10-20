// AI navigation fields for drivable DecalRoads (DecalRoad.md §Navigation):
// road priority, lanes per side, speed limits and give-way. BeamNG builds its
// navgraph from these roads, so no map.json segments are written.
import { makeRoadNodeKey } from './roadNetwork.js';

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

// Manual lane counts for a drivable DecalRoad (autoLanes off).
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
