// Road signs: stop, give way, speed limits, one way / no entry, roundabouts
// and priority roads, as native BeamNG sign meshes.
//
// Every sign is tied to a travel direction, placed on that direction's kerb
// side and turned to face it. Placement comes from the same junction
// approaches as the AI's stop points (signalApproaches.js), so a stop sign,
// its stop bar and the AI stop agree. Ideas from earth2road (core/signs.py):
// speed-limit signs only where the limit changes AND OSM records the new
// value; derived signs only for real streets; each sign records whether OSM
// says so ('osm') or the road layout implies it ('derived').
//
// Sign meshes face their local −Y (measured on East Coast USA's own stop
// signs: 33 of 35 face their traffic along −Y), so yaw = atan2(−dx, dy)
// turns the face toward traffic travelling along d.

import { collectJunctionApproaches, geoToWorld, makeRoadClearance } from './beamngSignals.js';
import {
  approachFromArm,
  armStopDistance,
  canArrive,
  isJunction,
  junctionArms,
  onewayDirection,
  otherEnd,
  pointAlong,
  roadRank,
  walk,
} from './signalApproaches.js';
import { makeRoadNodeKey } from './roadNetwork.js';

const ECA = '/levels/east_coast_usa/art/shapes/signs_usa/';
const IT = '/art/shapes/garage_and_dealership/Clutter/italy_traf_sign_';

// North America uses East Coast USA's signs (mph); everywhere else the
// common Vienna-convention set (km/h), which loads in any level.
export const SIGN_SETS = {
  americas: {
    unit: 'mph',
    stop: `${ECA}sign_stop.dae`,
    give_way: `${ECA}sign_yield.dae`,
    speed: { 40: `${ECA}sign_speedlimit_40.dae`, 50: `${ECA}sign_speedlimit_50.dae` },
  },
  white: {
    unit: 'km/h',
    stop: `${IT}stop.dae`,
    give_way: `${IT}give_way.dae`,
    priority_road: `${IT}priorityroad.dae`,
    one_way: `${IT}one_way.dae`,
    no_entry: `${IT}noentry.dae`,
    roundabout: `${IT}roundabout.dae`,
    speed: Object.fromEntries([30, 50, 60, 80, 90, 100].map((v) => [v, `${IT}speed_${v}.dae`])),
  },
};

const KERB_GAP_M = 1.5;
const SHIFT_STEP_M = 0.5;
const SHIFT_MAX_M = 3;
const STACK_M = 2.0;              // second sign on the same approach sits this far back
const SPEED_SIGN_AFTER_M = 12;    // earth2road SETBACK_ENTRY
const SPEED_SIGN_MIN_WAY_M = 25;
const ONE_WAY_SIGN_AFTER_M = 8;
const ONE_WAY_MIN_LENGTH_M = 30;
const NO_ENTRY_INSIDE_M = 4;
// Derived give-way / priority signs: a street meeting a clearly bigger road.
const PRIORITY_MAJOR_MIN_RANK = 5;   // tertiary and up
const PRIORITY_MINOR_RANKS = [2, 3, 4]; // living_street, residential, unclassified

const norm = (value) => String(value ?? '').trim().toLowerCase();

// OSM maxspeed → { value, unit } as signed (mph or km/h), or null.
export function parseSignedSpeed(raw) {
  const value = norm(raw).split(';')[0].trim();
  const zone = value.match(/^[a-z]{2}:zone:?(\d+)$/);
  if (zone) return { value: Number(zone[1]), unit: 'km/h' };
  const match = value.match(/^(\d+)\s*(mph|km\/h|kmh|kph)?$/);
  if (!match) return null;
  return { value: Number(match[1]), unit: match[2] === 'mph' ? 'mph' : 'km/h' };
}

const isRoundabout = (road) => norm(road?.tags?.junction) === 'roundabout';

// Only streets that are drawn as roads get signs: service roads (parking
// aisles, driveways), tracks and private roads are not DecalRoads.
const isSignedRoad = (road) => {
  const tags = road?.tags || {};
  const highway = norm(tags.highway);
  if (highway === 'service' || highway === 'track' || norm(tags.area) === 'yes') return false;
  return !['private', 'no'].includes(norm(tags.access));
};

/**
 * Sign placements for an export: [{ kind, shape, position, yaw, provenance }]
 * in world space, plus counts for the export report.
 */
export function buildRoadSignProps(terrainData, squareSize, { style = 'americas' } = {}) {
  const junctions = collectJunctionApproaches(terrainData);
  if (!junctions) return { props: [], counts: {} };
  const { graph, projector, roadFeatures, intersections, stopApproaches, yieldApproaches, crossingKeys } = junctions;
  const set = SIGN_SETS[style] ?? SIGN_SETS.americas;
  const leftHandTraffic = !!terrainData?.roadRules?.leftHandTraffic;
  const isClear = makeRoadClearance(roadFeatures, projector);
  const props = [];
  const counts = {};
  const skipped = {};
  const count = (key, bucket = counts) => { bucket[key] = (bucket[key] || 0) + 1; };

  // One sign for travel direction `dir` at (x, y) on a road `halfWidth` wide.
  const place = (kind, x, y, dir, halfWidth, provenance, shapeOverride = null) => {
    const shape = shapeOverride ?? set[kind];
    if (!shape) { count(kind, skipped); return false; }
    const len = Math.hypot(dir[0], dir[1]) || 1;
    const d = [dir[0] / len, dir[1] / len];
    const right = [d[1], -d[0]];
    const kerb = leftHandTraffic ? [-right[0], -right[1]] : right;
    const off = halfWidth + KERB_GAP_M;
    for (let shift = 0; shift <= SHIFT_MAX_M; shift += SHIFT_STEP_M) {
      const px = x + kerb[0] * (off + shift);
      const py = y + kerb[1] * (off + shift);
      if (!isClear(px, py)) continue;
      const ll = projector.unproject(px, py);
      props.push({
        kind,
        shape,
        position: geoToWorld(ll.lat, ll.lng, terrainData, squareSize, 0).map((v) => Math.round(v * 1000) / 1000),
        yaw: Math.atan2(-d[0], d[1]),
        provenance,
      });
      count(`${kind}:${provenance}`);
      return true;
    }
    count(`${kind}:no_room`, skipped);
    return false;
  };
  // A second sign behind the first on the same approach.
  const placeBehind = (kind, approach, provenance) => place(
    kind, approach.x - approach.dir[0] * STACK_M, approach.y - approach.dir[1] * STACK_M,
    approach.dir, approach.halfWidth, provenance,
  );

  const controlledArms = new Set();
  const controlledJunctions = new Set();
  for (const intersection of intersections) {
    for (const a of intersection.approaches) controlledJunctions.add(a.junctionKey);
  }

  // ── Stop and give way (mapped, stop=all, junction-node) ─────────────────
  for (const a of stopApproaches) {
    place('stop', a.x, a.y, a.dir, a.halfWidth, a.hintTags ? 'osm' : 'derived');
    controlledArms.add(a.armId);
    controlledJunctions.add(a.junctionKey);
  }
  for (const a of yieldApproaches) {
    place('give_way', a.x, a.y, a.dir, a.halfWidth, a.hintTags ? 'osm' : 'derived');
    controlledArms.add(a.armId);
    controlledJunctions.add(a.junctionKey);
  }

  // ── Roundabouts: give way on every entry (BeamNG.Earth) ─────────────────
  for (const node of graph.nodes.values()) {
    if (!isJunction(node) || !node.edges.some((e) => isRoundabout(e.road))) continue;
    const arms = junctionArms(node, new Set([node.key]));
    for (const arm of arms) {
      if (isRoundabout(arm.edge.road) || !isSignedRoad(arm.edge.road) || controlledArms.has(arm.armId)) continue;
      const a = approachFromArm(arm, armStopDistance(arm, arms, crossingKeys));
      if (!a) continue;
      place('give_way', a.x, a.y, a.dir, a.halfWidth, 'derived');
      if (set.roundabout) placeBehind('roundabout', a, 'derived');
      controlledArms.add(arm.armId);
    }
    controlledJunctions.add(node.key);
  }

  // ── Derived priority (Vienna-convention countries only) ─────────────────
  // A residential street meeting a tertiary-or-bigger road gives way; the
  // bigger road's approaches get the priority-road sign. US streets use stop
  // signs, which OSM maps well, so nothing is derived there.
  if (set.priority_road) {
    for (const node of graph.nodes.values()) {
      if (!isJunction(node) || controlledJunctions.has(node.key)) continue;
      const arms = junctionArms(node, new Set([node.key]));
      if (arms.length < 2) continue;
      const rankOf = (arm) => roadRank(arm.edge.road.tags?.highway);
      const maxRank = Math.max(...arms.map(rankOf));
      if (maxRank < PRIORITY_MAJOR_MIN_RANK) continue;
      const minors = arms.filter((arm) => PRIORITY_MINOR_RANKS.includes(rankOf(arm)) && !controlledArms.has(arm.armId));
      if (minors.length === 0) continue;
      for (const arm of minors) {
        const a = approachFromArm(arm, armStopDistance(arm, arms, crossingKeys));
        if (a) place('give_way', a.x, a.y, a.dir, a.halfWidth, 'derived');
      }
      for (const arm of arms.filter((x) => rankOf(x) === maxRank)) {
        const a = approachFromArm(arm, armStopDistance(arm, arms, crossingKeys) + 10);
        if (a) place('priority_road', a.x, a.y, a.dir, a.halfWidth, 'derived');
      }
    }
  }

  // ── Speed limits where the limit changes (OSM values only) ──────────────
  // Per way and travel direction: at the way's entry node, if any road
  // arriving there has a different MAPPED limit, sign the new one.
  const nodeOf = (pt) => graph.nodes.get(makeRoadNodeKey(pt));
  const signed = new Set();
  for (const road of roadFeatures) {
    if (!isSignedRoad(road)) continue;
    const speed = parseSignedSpeed(road.tags?.maxspeed);
    if (!speed) continue;
    const geom = road.geometry;
    const way = onewayDirection(road.tags);
    for (const [travel, entryPt, nextPt] of [[1, geom[0], geom[1]], [-1, geom[geom.length - 1], geom[geom.length - 2]]]) {
      if (way !== 0 && way !== travel) continue;
      const entry = nodeOf(entryPt);
      const next = nodeOf(nextPt);
      if (!entry || !next) continue;
      const firstEdge = entry.edges.find((e) => e.road === road && otherEnd(e, entry) === next);
      if (!firstEdge) continue;
      const differs = entry.edges.some((e) => e.road !== road && canArrive(e, entry)
        && (() => {
          const other = parseSignedSpeed(e.road.tags?.maxspeed);
          return other && (other.value !== speed.value || other.unit !== speed.unit);
        })());
      if (!differs) continue;
      const key = `${entry.key}|${next.key}`;
      if (signed.has(key)) continue;
      signed.add(key);
      const path = walk(entry, firstEdge, SPEED_SIGN_AFTER_M * 3);
      if (path.length < SPEED_SIGN_MIN_WAY_M && path.end) continue;
      const at = pointAlong(path, Math.min(SPEED_SIGN_AFTER_M, path.length * 0.5));
      if (!at) continue;
      if (speed.unit !== set.unit || !set.speed[speed.value]) {
        count(`speed_${speed.value}${speed.unit === 'mph' ? 'mph' : ''}`, skipped);
        continue;
      }
      place('speed', at.x, at.y, at.outward, firstEdge.halfWidth, 'osm', set.speed[speed.value]);
    }
  }

  // ── One way and no entry (Vienna-convention set) ────────────────────────
  if (set.one_way) {
    for (const road of roadFeatures) {
      const way = onewayDirection(road.tags);
      if (way === 0 || isRoundabout(road) || !isSignedRoad(road)) continue;
      const geom = way > 0 ? road.geometry : [...road.geometry].reverse();
      const entry = nodeOf(geom[0]);
      const exit = nodeOf(geom[geom.length - 1]);
      const firstEdge = entry?.edges.find((e) => e.road === road && otherEnd(e, entry) === nodeOf(geom[1]));
      if (!firstEdge) continue;
      const path = walk(entry, firstEdge, ONE_WAY_MIN_LENGTH_M * 2);
      if (path.length < ONE_WAY_MIN_LENGTH_M && path.end) continue;
      if (isJunction(entry)) {
        const at = pointAlong(path, ONE_WAY_SIGN_AFTER_M);
        if (at) place('one_way', at.x, at.y, at.outward, firstEdge.halfWidth, 'osm');
      }
      // No entry, facing drivers who would turn in at the exit end.
      const lastEdge = exit?.edges.find((e) => e.road === road && otherEnd(e, exit) === nodeOf(geom[geom.length - 2]));
      if (exit && lastEdge && isJunction(exit)) {
        const back = walk(exit, lastEdge, NO_ENTRY_INSIDE_M * 2);
        const at = pointAlong(back, NO_ENTRY_INSIDE_M);
        if (at) place('no_entry', at.x, at.y, at.outward, lastEdge.halfWidth, 'osm');
      }
    }
  }

  const summary = Object.entries(counts).map(([k, v]) => `${k} ${v}`).join(', ') || 'none';
  const missing = Object.entries(skipped).map(([k, v]) => `${k} ${v}`).join(', ');
  console.log(`[BeamNG Signs] ${props.length} signs (${summary})${missing ? `; not placed: ${missing}` : ''}.`);
  return { props, counts, skipped };
}
