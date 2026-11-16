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
import { US_SIGN_SHAPES } from './beamngPropLibrary.js';
import SIGN_CODES from '../data/traffic-signs.json' with { type: 'json' };

const ECA = '/levels/east_coast_usa/art/shapes/signs_usa/';
const IT = '/art/shapes/garage_and_dealership/Clutter/italy_traf_sign_';

// North America uses East Coast USA's signs (mph), with the speed limits it
// lacks from Utah and West Coast USA (no stock 35 / 45 / 55 / 65 mph sign: those
// roads go unsigned rather than showing a wrong number); everywhere else the
// common Vienna-convention set (km/h), which loads in any level.
export const SIGN_SETS = {
  americas: {
    unit: 'mph',
    stop: `${ECA}sign_stop.dae`,
    give_way: `${ECA}sign_yield.dae`,
    speed: {
      5: US_SIGN_SHAPES.speed5.shapeFile,
      25: US_SIGN_SHAPES.speed25.shapeFile,
      30: US_SIGN_SHAPES.speed30.shapeFile,
      40: `${ECA}sign_speedlimit_40.dae`,
      50: `${ECA}sign_speedlimit_50.dae`,
      60: US_SIGN_SHAPES.speed60.shapeFile,
      70: US_SIGN_SHAPES.speed70.shapeFile,
      80: US_SIGN_SHAPES.speed80.shapeFile,
    },
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
const MAPPED_SIGN_REACH_M = 20;   // a mapped sign this near a road is that road's
const MAPPED_SIGN_SAME_M = 12;    // a sign of its kind this near already: not stood twice
const MAPPED_SIGN_STACK_M = 2;    // a point's next sign this far back (and 0.7 m further out) along its road

/**
 * What a mapped traffic sign stands for: [{ kind, value? }] from its traffic_sign=* value (OSM's words or a
 * country's codes, ; or , between several) and its hazard=* / maxspeed=* tags. Kinds as data/traffic-signs.json.
 */
export function mappedSignKinds(tags = {}) {
  const out = [];
  for (const raw of String(tags.traffic_sign || '').split(/[;,]/)) {
    const v = raw.trim(); if (!v) continue;
    const m = v.match(/^([A-Za-z]{2}):(.+)$/);
    let kind; let body = v;
    if (m) {
      const table = SIGN_CODES.codes[m[1].toUpperCase()] || {};
      body = m[2];
      const base = body.replace(/\[.*\]$/, '').trim();
      const cands = [body, base, base.replace(/,\d+$/, ''), base.split(/[-.]/).slice(0, base.split(/[-.]/).length - 1).join('-')];
      for (const c of cands) if (c && Object.prototype.hasOwnProperty.call(table, c)) { kind = table[c]; break; }
      // (a speed sign's number after its code: DE:274-50, US:R2-1[55])
      if (kind === undefined) { const sp = base.match(/^(.*?)[-.](\d{2,3})$/); if (sp && table[sp[1]] === 'speed') { kind = 'speed'; body = `[${sp[2]}]`; } }
    } else kind = SIGN_CODES.words[v.replace(/\[.*\]$/, '').toLowerCase()];
    if (!kind) continue;
    if (kind === 'hazard' && SIGN_CODES.hazard[String(tags.hazard || '').toLowerCase()]) kind = SIGN_CODES.hazard[String(tags.hazard).toLowerCase()];
    const num = Number.parseInt((body.match(/\[(\d+)\]/) || [])[1] ?? (kind === 'speed' ? (body.match(/[-.](\d{2,3})$/) || [])[1] : undefined) ?? tags.maxspeed, 10);
    out.push(kind === 'speed' ? { kind, value: Number.isFinite(num) ? num : null } : { kind });
  }
  return out;
}

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

  // ── Mapped signs (traffic_sign=*): each beside its road, facing the traffic its direction names ─────
  // A sign mapped on the way with direction=forward / backward faces the traffic going that way along it; mapped
  // beside the road, the traffic driving on its side; on a two-way road with no direction, both ways. What a
  // value stands for is data (data/traffic-signs.json). Not where a sign of its kind stands already near.
  {
    const edges = [...new Set([...graph.nodes.values()].flatMap((n) => n.edges))];
    const nearestEdge = (x, y) => {
      let best = null;
      for (const e of edges) {
        const vx = e.to.x - e.from.x; const vy = e.to.y - e.from.y; const L = vx * vx + vy * vy || 1e-9;
        const u = Math.max(0, Math.min(1, ((x - e.from.x) * vx + (y - e.from.y) * vy) / L));
        const px = e.from.x + vx * u; const py = e.from.y + vy * u; const d = Math.hypot(x - px, y - py);
        if (d < MAPPED_SIGN_REACH_M && (!best || d < best.d)) best = { e, px, py, d, dir: [vx / Math.sqrt(L), vy / Math.sqrt(L)] };
      }
      return best;
    };
    // (the paths and pedestrian streets, which the road graph leaves out: a sign nearer one of them than any road is
    // that path's, a pedestrian zone's no-vehicles sign at its mouth. Stood on the nearest road it faced a street the
    // sign is not for: Poznań's Półwiejska)
    const PATHS = new Set(['footway', 'path', 'cycleway', 'pedestrian', 'steps', 'bridleway', 'corridor']);
    const pathLines = (terrainData.osmFeatures || []).filter((f) => f.type === 'road' && PATHS.has(f.tags?.highway) && !['sidewalk', 'crossing', 'traffic_island'].includes(f.tags?.footway) && f.geometry?.length > 1).map((f) => f.geometry.map((p) => projector.project(p)));
    const pathDist = (x, y) => {
      let best = Infinity;
      for (const P of pathLines) for (let i = 0; i + 1 < P.length; i++) {
        const vx = P[i + 1][0] - P[i][0]; const vy = P[i + 1][1] - P[i][1]; const L = vx * vx + vy * vy || 1e-9;
        const u = Math.max(0, Math.min(1, ((x - P[i][0]) * vx + (y - P[i][1]) * vy) / L));
        best = Math.min(best, Math.hypot(P[i][0] + vx * u - x, P[i][1] + vy * u - y));
      }
      return best;
    };
    const style = set === SIGN_SETS.americas ? 'americas' : 'white';
    const near = (kind, x, y) => props.some((p) => p.kind === kind && Math.hypot(p.position[0] - x, p.position[1] - y) < MAPPED_SIGN_SAME_M);
    for (const f of terrainData.osmFeatures || []) {
      if (f?.geometry?.length !== 1 || !f.tags?.traffic_sign) continue;
      const signs = mappedSignKinds(f.tags);
      if (!signs.length) continue;
      const [x, y] = projector.project(f.geometry[0]);
      const at = nearestEdge(x, y);
      if (!at || !isSignedRoad(at.e.road)) { count('mapped:no_road', skipped); continue; }
      if (pathDist(x, y) + 0.5 < Math.max(0, at.d - at.e.halfWidth)) { count('mapped:a_path_sign', skipped); continue; }
      const dirTag = norm(f.tags['traffic_sign:direction'] ?? f.tags.direction);
      const deg = Number.parseFloat(dirTag);
      let travels;
      if (dirTag === 'forward') travels = [at.dir];
      else if (dirTag === 'backward') travels = [[-at.dir[0], -at.dir[1]]];
      else if (Number.isFinite(deg)) {
        // (a compass direction: the way the sign faces; its traffic comes toward it)
        const face = [Math.sin((deg * Math.PI) / 180), Math.cos((deg * Math.PI) / 180)];
        travels = [face[0] * at.dir[0] + face[1] * at.dir[1] > 0 ? [-at.dir[0], -at.dir[1]] : at.dir];
      } else {
        const way = onewayDirection(at.e.road.tags);
        if (way !== 0) travels = [way > 0 ? at.dir : [-at.dir[0], -at.dir[1]]];
        else if (at.d > at.e.halfWidth) {
          // (beside the road: the traffic keeping to that side)
          const side = (x - at.px) * at.dir[1] - (y - at.py) * at.dir[0];   // > 0: right of the way's direction
          travels = [(side > 0) !== leftHandTraffic ? at.dir : [-at.dir[0], -at.dir[1]]];
        } else travels = [at.dir, [-at.dir[0], -at.dir[1]]];
      }
      // (a point's second and later signs a little back along their road: two on one spot stood inside each other)
      signs.forEach((s, si) => {
        const kind = s.kind;
        let shape;
        if (kind === 'speed') {
          if (!s.value || !set.speed[s.value]) { count(`mapped_speed_${s.value || '?'}`, skipped); return; }
          shape = set.speed[s.value];
        } else shape = SIGN_CODES.kinds[kind]?.[style];
        if (!shape) { count(`mapped_${kind}`, skipped); return; }
        for (const d of travels) {
          // (and a little further out: straight behind, the front one hid it from the driver)
          const side = leftHandTraffic ? [-d[1], d[0]] : [d[1], -d[0]];
          const back = [at.px - d[0] * MAPPED_SIGN_STACK_M * si + side[0] * 0.7 * si, at.py - d[1] * MAPPED_SIGN_STACK_M * si + side[1] * 0.7 * si];
          if (near(kind, back[0], back[1])) { count(`${kind}:mapped_already`, skipped); continue; }
          place(kind, back[0], back[1], d, at.e.halfWidth, 'mapped', shape);
        }
      });
    }
  }

  const summary = Object.entries(counts).map(([k, v]) => `${k} ${v}`).join(', ') || 'none';
  const missing = Object.entries(skipped).map(([k, v]) => `${k} ${v}`).join(', ');
  console.log(`[BeamNG Signs] ${props.length} signs (${summary})${missing ? `; not placed: ${missing}` : ''}.`);
  return { props, counts, skipped };
}
