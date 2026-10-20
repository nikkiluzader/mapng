const ROAD_SKIP = new Set([
  'footway', 'path', 'pedestrian', 'steps', 'cycleway',
  'bridleway', 'corridor', 'proposed', 'construction',
]);

const HIGH_PRIORITY_HIGHWAYS = new Set(['motorway', 'motorway_link', 'trunk', 'trunk_link', 'primary', 'primary_link']);
const MEDIUM_PRIORITY_HIGHWAYS = new Set(['secondary', 'secondary_link', 'tertiary', 'tertiary_link']);

function shouldUseRoadForSignals(feature) {
  if (feature?.type !== 'road' || !Array.isArray(feature.geometry) || feature.geometry.length < 2) {
    return false;
  }
  const tags = feature.tags || {};
  const highway = String(tags.highway ?? '').trim().toLowerCase();
  if (!highway || ROAD_SKIP.has(highway)) return false;
  if (String(tags.area ?? '').trim().toLowerCase() === 'yes') return false;
  return true;
}

function normalizeSignalKind(tags = {}) {
  const highway = String(tags.highway ?? '').trim().toLowerCase();
  if (highway === 'traffic_signals') return 'traffic_light';
  if (highway === 'stop') return 'stop';
  if (highway === 'give_way') return 'yield';

  const trafficSign = String(tags.traffic_sign ?? tags['traffic_sign:forward'] ?? tags['traffic_sign:backward'] ?? '')
    .trim()
    .toLowerCase();
  if (!trafficSign) return null;

  if (trafficSign.includes('stop')) return 'stop';
  if (trafficSign.includes('give_way') || trafficSign.includes('yield')) return 'yield';
  if (trafficSign.includes('traffic_signals')) return 'traffic_light';

  return null;
}

function collectSignalCandidates(osmFeatures = []) {
  const out = [];
  for (const feature of osmFeatures) {
    if (!Array.isArray(feature?.geometry) || feature.geometry.length !== 1) continue;
    const kind = normalizeSignalKind(feature.tags || {});
    if (!kind) continue;
    out.push({
      id: feature.id,
      kind,
      point: feature.geometry[0],
      tags: feature.tags || {},
    });
  }
  return out;
}

function geoToWorld(lat, lng, terrainData, squareSize, zOffset = 2.5) {
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
    Math.round(worldX * 1000) / 1000,
    Math.round(worldY * 1000) / 1000,
    Math.round((worldH + zOffset) * 1000) / 1000,
  ];
}

function findNearestRoadDirection(point, roadFeatures) {
  if (!Array.isArray(roadFeatures) || roadFeatures.length === 0) {
    return [0, 1, 0];
  }

  const metersPerDegLat = 111320;
  const metersPerDegLng = 111320 * Math.cos((point.lat * Math.PI) / 180);

  let best = null;

  for (const road of roadFeatures) {
    const geom = road.geometry;
    for (let i = 0; i < geom.length - 1; i++) {
      const a = geom[i];
      const b = geom[i + 1];
      const ax = (a.lng - point.lng) * metersPerDegLng;
      const ay = (a.lat - point.lat) * metersPerDegLat;
      const bx = (b.lng - point.lng) * metersPerDegLng;
      const by = (b.lat - point.lat) * metersPerDegLat;
      const vx = bx - ax;
      const vy = by - ay;
      const vv = vx * vx + vy * vy;
      if (vv < 1e-6) continue;

      const t = Math.max(0, Math.min(1, (-(ax * vx + ay * vy)) / vv));
      const cx = ax + vx * t;
      const cy = ay + vy * t;
      const distSq = cx * cx + cy * cy;

      if (!best || distSq < best.distSq) {
        const len = Math.hypot(vx, vy);
        if (len < 1e-6) continue;
        best = {
          distSq,
          dir: [vx / len, vy / len, 0],
        };
      }
    }
  }

  if (!best) return [0, 1, 0];
  return best.dir;
}

function roadHasLeftTurnHint(tags = {}) {
  const values = [
    tags['turn:lanes'],
    tags['turn:lanes:forward'],
    tags['turn:lanes:backward'],
    tags.turn,
    tags['turn:forward'],
    tags['turn:backward'],
  ];

  return values.some((value) => {
    const raw = String(value ?? '').trim().toLowerCase();
    if (!raw) return false;
    return raw.includes('left');
  });
}

function parseLaneRoleFromValues(values = []) {
  const raw = values
    .map((value) => String(value ?? '').trim().toLowerCase())
    .filter(Boolean)
    .join('|');
  if (!raw) return 'unknown';

  const hasLeft = raw.includes('left');
  const hasThrough = raw.includes('through') || raw.includes('forward') || raw.includes('straight');
  const hasRight = raw.includes('right');

  if (hasLeft && !hasThrough && !hasRight) return 'left';
  if (hasLeft && (hasThrough || hasRight)) return 'left_mixed';
  if (!hasLeft && (hasThrough || hasRight)) return 'through';
  return 'unknown';
}

function inferSignalLaneRole(tags = {}) {
  return parseLaneRoleFromValues([
    tags['traffic_signals:direction'],
    tags['traffic_signals:turn'],
    tags['turn:lanes'],
    tags['turn:lanes:forward'],
    tags['turn:lanes:backward'],
    tags.turn,
    tags.direction,
  ]);
}

function inferRoadLaneRoleNearPoint(point, signalDir, roadFeatures, maxDistance = 35) {
  if (!Array.isArray(roadFeatures) || roadFeatures.length === 0) return 'unknown';

  const metersPerDegLat = 111320;
  const metersPerDegLng = 111320 * Math.cos((point.lat * Math.PI) / 180);
  const maxDistSq = maxDistance * maxDistance;
  let best = null;

  for (const road of roadFeatures) {
    const geom = road.geometry;
    for (let i = 0; i < geom.length - 1; i++) {
      const a = geom[i];
      const b = geom[i + 1];
      const ax = (a.lng - point.lng) * metersPerDegLng;
      const ay = (a.lat - point.lat) * metersPerDegLat;
      const bx = (b.lng - point.lng) * metersPerDegLng;
      const by = (b.lat - point.lat) * metersPerDegLat;
      const vx = bx - ax;
      const vy = by - ay;
      const vv = vx * vx + vy * vy;
      if (vv < 1e-6) continue;

      const len = Math.sqrt(vv);
      const svx = Number(signalDir?.[0] ?? 0);
      const svy = Number(signalDir?.[1] ?? 0);
      const sLen = Math.hypot(svx, svy);
      if (sLen > 1e-6) {
        const dot = Math.abs(((vx / len) * (svx / sLen)) + ((vy / len) * (svy / sLen)));
        if (dot < 0.65) continue;
      }

      const t = Math.max(0, Math.min(1, (-(ax * vx + ay * vy)) / vv));
      const cx = ax + vx * t;
      const cy = ay + vy * t;
      const distSq = cx * cx + cy * cy;
      if (distSq > maxDistSq) continue;

      if (!best || distSq < best.distSq) {
        best = {
          distSq,
          tags: road.tags || {},
        };
      }
    }
  }

  if (!best) return 'unknown';
  return parseLaneRoleFromValues([
    best.tags['turn:lanes'],
    best.tags['turn:lanes:forward'],
    best.tags['turn:lanes:backward'],
    best.tags.turn,
    best.tags['turn:forward'],
    best.tags['turn:backward'],
  ]);
}

function inferNearestRoadHighwayNearPoint(point, signalDir, roadFeatures, maxDistance = 35) {
  if (!Array.isArray(roadFeatures) || roadFeatures.length === 0) return '';

  const metersPerDegLat = 111320;
  const metersPerDegLng = 111320 * Math.cos((point.lat * Math.PI) / 180);
  const maxDistSq = maxDistance * maxDistance;
  let best = null;

  for (const road of roadFeatures) {
    const geom = road.geometry;
    for (let i = 0; i < geom.length - 1; i++) {
      const a = geom[i];
      const b = geom[i + 1];
      const ax = (a.lng - point.lng) * metersPerDegLng;
      const ay = (a.lat - point.lat) * metersPerDegLat;
      const bx = (b.lng - point.lng) * metersPerDegLng;
      const by = (b.lat - point.lat) * metersPerDegLat;
      const vx = bx - ax;
      const vy = by - ay;
      const vv = vx * vx + vy * vy;
      if (vv < 1e-6) continue;

      const len = Math.sqrt(vv);
      const svx = Number(signalDir?.[0] ?? 0);
      const svy = Number(signalDir?.[1] ?? 0);
      const sLen = Math.hypot(svx, svy);
      if (sLen > 1e-6) {
        const dot = Math.abs(((vx / len) * (svx / sLen)) + ((vy / len) * (svy / sLen)));
        if (dot < 0.65) continue;
      }

      const t = Math.max(0, Math.min(1, (-(ax * vx + ay * vy)) / vv));
      const cx = ax + vx * t;
      const cy = ay + vy * t;
      const distSq = cx * cx + cy * cy;
      if (distSq > maxDistSq) continue;

      if (!best || distSq < best.distSq) {
        best = {
          distSq,
          highway: String(road?.tags?.highway ?? '').trim().toLowerCase(),
        };
      }
    }
  }

  return best?.highway || '';
}

function getRoadPriorityScore(highway) {
  if (HIGH_PRIORITY_HIGHWAYS.has(highway)) return 3;
  if (MEDIUM_PRIORITY_HIGHWAYS.has(highway)) return 2;
  return 1;
}

function hasProtectedTurnHintNearPoint(point, signalDir, roadFeatures, maxDistance = 35) {
  if (!Array.isArray(roadFeatures) || roadFeatures.length === 0) return false;

  const metersPerDegLat = 111320;
  const metersPerDegLng = 111320 * Math.cos((point.lat * Math.PI) / 180);
  const maxDistSq = maxDistance * maxDistance;

  for (const road of roadFeatures) {
    if (!roadHasLeftTurnHint(road.tags || {})) continue;
    const geom = road.geometry;

    for (let i = 0; i < geom.length - 1; i++) {
      const a = geom[i];
      const b = geom[i + 1];
      const ax = (a.lng - point.lng) * metersPerDegLng;
      const ay = (a.lat - point.lat) * metersPerDegLat;
      const bx = (b.lng - point.lng) * metersPerDegLng;
      const by = (b.lat - point.lat) * metersPerDegLat;
      const vx = bx - ax;
      const vy = by - ay;
      const vv = vx * vx + vy * vy;
      if (vv < 1e-6) continue;

      const len = Math.sqrt(vv);
      const svx = Number(signalDir?.[0] ?? 0);
      const svy = Number(signalDir?.[1] ?? 0);
      const sLen = Math.hypot(svx, svy);
      if (sLen > 1e-6) {
        const dot = Math.abs(((vx / len) * (svx / sLen)) + ((vy / len) * (svy / sLen)));
        // Require rough heading alignment so perpendicular roads do not leak hints.
        if (dot < 0.65) continue;
      }

      const t = Math.max(0, Math.min(1, (-(ax * vx + ay * vy)) / vv));
      const cx = ax + vx * t;
      const cy = ay + vy * t;
      const distSq = cx * cx + cy * cy;

      if (distSq <= maxDistSq) return true;
    }
  }

  return false;
}

function clusterTrafficLights(entries, maxDistance = 35) {
  const clusters = [];
  for (const entry of entries) {
    let target = null;
    let targetDist = Number.POSITIVE_INFINITY;

    for (const cluster of clusters) {
      const dx = entry.pos[0] - cluster.center[0];
      const dy = entry.pos[1] - cluster.center[1];
      const dist = Math.hypot(dx, dy);
      if (dist <= maxDistance && dist < targetDist) {
        target = cluster;
        targetDist = dist;
      }
    }

    if (!target) {
      clusters.push({
        center: [...entry.pos],
        members: [entry],
      });
      continue;
    }

    target.members.push(entry);
    const count = target.members.length;
    target.center[0] = ((target.center[0] * (count - 1)) + entry.pos[0]) / count;
    target.center[1] = ((target.center[1] * (count - 1)) + entry.pos[1]) / count;
    target.center[2] = ((target.center[2] * (count - 1)) + entry.pos[2]) / count;
  }

  return clusters;
}

function splitTrafficLightClusterByAxis(clusterMembers) {
  const ns = [];
  const ew = [];

  for (const member of clusterMembers) {
    const dx = Math.abs(member.dir[0]);
    const dy = Math.abs(member.dir[1]);
    if (dy >= dx) ns.push(member);
    else ew.push(member);
  }

  if (ns.length === 0 && ew.length > 1) {
    return { ns: ew, ew: [] };
  }
  if (ew.length === 0 && ns.length > 1) {
    return { ns, ew: [] };
  }
  return { ns, ew };
}

// Europe shows red+amber before green: BeamNG's lightsBasicEU type
// (settings/trafficSignals.json), whose idle state is index 4.
function makeLightsBasicController(id, name, { euroSignals = false } = {}) {
  if (euroSignals) {
    return {
      id,
      name,
      type: 'lightsBasicEU',
      isSimple: false,
      defaultIndex: 4,
      states: [
        { state: 'redYellowTrafficLight', duration: 1.5 },
        { state: 'greenTrafficLight', duration: 12 },
        { state: 'yellowTrafficLight', duration: 4 },
        { state: 'redTrafficLight', duration: 1.5 },
      ],
    };
  }
  return {
    id,
    name,
    type: 'lightsBasic',
    isSimple: false,
    defaultIndex: 3,
    states: [
      { state: 'greenTrafficLight', duration: 12 },
      { state: 'yellowTrafficLight', duration: 4 },
      { state: 'redTrafficLight', duration: 1.5 },
    ],
  };
}

function makeLightsProtectedGreenController(id, name) {
  return {
    id,
    name,
    type: 'lightsBasicProtectedGreen',
    isSimple: false,
    defaultIndex: 3,
    states: [
      { state: 'greenFlashingTrafficLight', duration: 9 },
      { state: 'yellowTrafficLight', duration: 4 },
      { state: 'redTrafficLight', duration: 1.5 },
    ],
  };
}

function getControllerCycleDuration(controller) {
  const states = Array.isArray(controller?.states) ? controller.states : [];
  const total = states.reduce((sum, state) => {
    const duration = Number(state?.duration);
    return Number.isFinite(duration) && duration > 0 ? sum + duration : sum;
  }, 0);
  return total > 0 ? Math.round(total * 1000) / 1000 : 17.5;
}

function buildAxisLightGroups(axisName, members, clusterIndex, allocId, controllers, controllersById, options = {}) {
  if (!Array.isArray(members) || members.length === 0) return [];

  const leftMembers = [];
  const generalMembers = [];

  for (const member of members) {
    if (member.laneRole === 'left' || member.laneRole === 'left_mixed') {
      leftMembers.push(member);
      continue;
    }
    generalMembers.push(member);
  }

  const groups = [];

  const getGroupPriority = (items) => {
    if (!Array.isArray(items) || items.length === 0) return 1;
    return Math.max(...items.map((member) => Number(member.roadPriorityScore) || 1));
  };

  if (leftMembers.length > 0) {
    const controllerId = allocId();
    const protectedTurn = leftMembers.some((member) => member.protectedTurnHint);
    const controller = protectedTurn
      ? makeLightsProtectedGreenController(controllerId, `cluster_${clusterIndex + 1}_${axisName}_left_turn`)
      : makeLightsBasicController(controllerId, `cluster_${clusterIndex + 1}_${axisName}_left`, options);
    controllers.push(controller);
    controllersById.set(controllerId, controller);
    groups.push({
      axis: axisName,
      laneRole: 'left',
      members: leftMembers,
      controllerId,
      protectedTurn,
      roadPriorityScore: getGroupPriority(leftMembers),
    });
  }

  if (generalMembers.length > 0) {
    const controllerId = allocId();
    const controller = makeLightsBasicController(controllerId, `cluster_${clusterIndex + 1}_${axisName}`, options);
    controllers.push(controller);
    controllersById.set(controllerId, controller);
    groups.push({
      axis: axisName,
      laneRole: 'general',
      members: generalMembers,
      controllerId,
      protectedTurn: false,
      roadPriorityScore: getGroupPriority(generalMembers),
    });
  }

  return groups;
}

function buildAxisPhasePlan(axis, axisGroups, controllersById) {
  if (!Array.isArray(axisGroups) || axisGroups.length === 0) {
    return { axis, hasProtected: false, phases: [], totalDuration: 0 };
  }

  const hasProtected = axisGroups.some((group) => group.protectedTurn);
  const laneDensity = axisGroups.reduce((count, group) => count + (Array.isArray(group.members) ? group.members.length : 0), 0);
  const priorityScore = Math.max(...axisGroups.map((group) => Number(group.roadPriorityScore) || 1));
  const axisBaseDuration = Math.max(
    ...axisGroups.map((group) => getControllerCycleDuration(controllersById.get(group.controllerId))),
  );

  const densityBoost = Math.min(0.9, Math.max(0, (laneDensity - 1) * 0.12));
  const priorityBoost = Math.max(0, (priorityScore - 1) * 0.2);
  const targetDurationFactor = 1 + densityBoost + priorityBoost;
  const axisTargetDuration = Math.round(axisBaseDuration * targetDurationFactor * 1000) / 1000;

  if (!hasProtected) {
    return {
      axis,
      hasProtected,
      laneDensity,
      priorityScore,
      totalDuration: axisTargetDuration,
      phases: [{
        kind: 'main',
        controllerIds: axisGroups.map((group) => group.controllerId),
        totalDuration: axisTargetDuration,
      }],
    };
  }

  const protectedGroups = axisGroups.filter((group) => group.protectedTurn);
  const generalGroups = axisGroups.filter((group) => !group.protectedTurn);
  const protectedDuration = Math.max(
    ...protectedGroups.map((group) => getControllerCycleDuration(controllersById.get(group.controllerId))),
  );

  const computeGroupDemand = (group, laneRoleBias) => {
    const memberCount = Array.isArray(group?.members) ? group.members.length : 1;
    const roadScore = Number(group?.roadPriorityScore) || 1;
    return memberCount * roadScore * laneRoleBias;
  };

  const protectedDemand = protectedGroups.reduce((sum, group) => {
    return sum + computeGroupDemand(group, 1.0);
  }, 0);
  const generalDemand = generalGroups.reduce((sum, group) => {
    return sum + computeGroupDemand(group, 1.25);
  }, 0);
  const demandTotal = Math.max(1e-6, protectedDemand + generalDemand);
  const protectedShare = protectedDemand / demandTotal;

  // Through-heavy approaches should spend more time in shared main phases.
  const weightedLeadFraction = 0.2 + (0.4 * Math.max(0, Math.min(1, protectedShare)));
  const leadDuration = Math.min(7, Math.max(2, Math.round((protectedDuration * weightedLeadFraction) * 1000) / 1000));
  const mainDuration = Math.max(2, Math.round((axisTargetDuration - leadDuration) * 1000) / 1000);

  return {
    axis,
    hasProtected,
    laneDensity,
    priorityScore,
    totalDuration: Math.round((leadDuration + mainDuration) * 1000) / 1000,
    phases: [
      {
        kind: 'lead',
        controllerIds: protectedGroups.map((group) => group.controllerId),
        totalDuration: leadDuration,
      },
      {
        kind: 'main',
        controllerIds: axisGroups.map((group) => group.controllerId),
        totalDuration: mainDuration,
      },
    ],
  };
}

function normalizeAxisPlanDurations(axisPlans = []) {
  if (!Array.isArray(axisPlans) || axisPlans.length === 0) return [];

  const normalized = axisPlans.map((plan) => {
    const priority = Number(plan?.priorityScore) || 1;
    const density = Number(plan?.laneDensity) || 1;
    const minDuration = plan?.hasProtected ? 12 : 10;
    const maxDuration = 22 + (priority * 2) + Math.min(7, density * 0.6);

    const boundedTotal = Math.min(maxDuration, Math.max(minDuration, Number(plan?.totalDuration) || minDuration));
    const originalTotal = Math.max(1e-6, Number(plan?.totalDuration) || 1);
    const scale = boundedTotal / originalTotal;

    const scaledPhases = Array.isArray(plan?.phases)
      ? plan.phases.map((phase) => ({
          ...phase,
          totalDuration: Math.max(1.25, Math.round((Number(phase?.totalDuration) * scale) * 1000) / 1000),
        }))
      : [];

    const scaledTotal = scaledPhases.reduce((sum, phase) => sum + (Number(phase.totalDuration) || 0), 0);
    return {
      ...plan,
      phases: scaledPhases,
      totalDuration: Math.round(scaledTotal * 1000) / 1000,
    };
  });

  const totalDuration = normalized.reduce((sum, plan) => sum + (Number(plan.totalDuration) || 0), 0);
  const cycleCap = 58 + Math.min(16, normalized.reduce((sum, plan) => sum + (Number(plan.laneDensity) || 0), 0) * 0.7);
  if (totalDuration <= cycleCap || totalDuration < 1e-6) {
    return normalized;
  }

  const scaleDown = cycleCap / totalDuration;
  return normalized.map((plan) => {
    const phases = plan.phases.map((phase) => ({
      ...phase,
      totalDuration: Math.max(1.1, Math.round((Number(phase.totalDuration) * scaleDown) * 1000) / 1000),
    }));
    const nextTotal = phases.reduce((sum, phase) => sum + (Number(phase.totalDuration) || 0), 0);
    return {
      ...plan,
      phases,
      totalDuration: Math.round(nextTotal * 1000) / 1000,
    };
  });
}

function computeAxisOverlapWindow(previousPlan, nextPlan) {
  const nextPriority = Number(nextPlan?.priorityScore) || 1;
  const nextDensity = Number(nextPlan?.laneDensity) || 1;

  let overlap = 0.75;
  if (nextPriority >= 2) overlap += 0.45;
  if (nextPriority >= 3) overlap += 0.45;
  overlap += Math.min(1.1, Math.max(0, (nextDensity - 1) * 0.32));

  const previousPriority = Number(previousPlan?.priorityScore) || 1;
  if (previousPriority >= 3) {
    overlap = Math.max(0.5, overlap - 0.2);
  }

  return Math.min(3.2, Math.max(0.5, Math.round(overlap * 1000) / 1000));
}

function buildSequencePhases(lightGroups, controllersById) {
  if (!Array.isArray(lightGroups) || lightGroups.length === 0) return [];

  const groupedByAxis = new Map();
  for (const group of lightGroups) {
    const axis = group.axis || 'axis';
    const arr = groupedByAxis.get(axis) || [];
    arr.push(group);
    groupedByAxis.set(axis, arr);
  }

  const hasProtected = lightGroups.some((group) => group.protectedTurn);
  if (!hasProtected) {
    return Array.from(groupedByAxis.values()).map((axisGroups) => ({
      controllerIds: axisGroups.map((group) => group.controllerId),
      totalDuration: Math.max(
        ...axisGroups.map((group) => getControllerCycleDuration(controllersById.get(group.controllerId))),
      ),
    }));
  }

  const axisPlans = Array.from(groupedByAxis.entries()).map(([axis, axisGroups]) => (
    buildAxisPhasePlan(axis, axisGroups, controllersById)
  ));
  const normalizedAxisPlans = normalizeAxisPlanDurations(axisPlans);

  const phases = [];
  let cursor = 0;

  normalizedAxisPlans.forEach((plan, planIndex) => {
    let axisStart = cursor;
    if (planIndex > 0) {
      const previous = normalizedAxisPlans[planIndex - 1];
      // Allow limited overlap from protected axis clearance into the next axis through phase.
      if (previous?.hasProtected && !plan.hasProtected) {
        const overlapWindow = computeAxisOverlapWindow(previous, plan);
        axisStart = Math.max(0, cursor - Math.min(overlapWindow, plan.totalDuration * 0.35));
      }
    }

    let localCursor = axisStart;
    for (const phase of plan.phases) {
      phases.push({
        startTime: Math.round(localCursor * 1000) / 1000,
        controllerIds: phase.controllerIds,
        totalDuration: phase.totalDuration,
      });
      localCursor += phase.totalDuration;
    }

    cursor = Math.max(cursor, localCursor);
  });

  return phases
    .filter((phase) => Array.isArray(phase.controllerIds) && phase.controllerIds.length > 0)
    .sort((a, b) => Number(a.startTime) - Number(b.startTime))
    .map((phase) => ({
      startTime: phase.startTime,
      controllerIds: phase.controllerIds,
      totalDuration: phase.totalDuration,
    }));
}

function buildSignalArtifacts(terrainData, squareSize) {
  const emptySignalData = { instances: [], controllers: [], sequences: [] };

  const osmFeatures = Array.isArray(terrainData?.osmFeatures) ? terrainData.osmFeatures : [];
  const candidates = collectSignalCandidates(osmFeatures);
  if (candidates.length === 0) {
    return { signalData: emptySignalData, controllerDefinitions: null };
  }

  const roadFeatures = osmFeatures.filter(shouldUseRoadForSignals);

  const entries = candidates.map((candidate) => {
    const dir = findNearestRoadDirection(candidate.point, roadFeatures);
    const roadLaneRole = inferRoadLaneRoleNearPoint(candidate.point, dir, roadFeatures);
    const nearestRoadHighway = inferNearestRoadHighwayNearPoint(candidate.point, dir, roadFeatures);
    const explicitLaneRole = inferSignalLaneRole(candidate.tags || {});
    return {
      ...candidate,
      pos: geoToWorld(candidate.point.lat, candidate.point.lng, terrainData, squareSize, candidate.kind === 'traffic_light' ? 3.5 : 2.5),
      dir,
      protectedTurnHint: hasProtectedTurnHintNearPoint(candidate.point, dir, roadFeatures),
      laneRole: explicitLaneRole !== 'unknown' ? explicitLaneRole : roadLaneRole,
      roadPriorityScore: getRoadPriorityScore(nearestRoadHighway),
    };
  });

  const controllers = [];
  const instances = [];
  const sequences = [];
  const controllersById = new Map();
  let nextId = 1;
  const allocId = () => nextId++;

  const signalOptions = { euroSignals: !!terrainData?.roadRules?.euroSignals };

  // Give-way points get no signal instance: BeamNG's AI never acts on yield
  // (action 4), and a custom "stop" yield state left AI waiting forever.
  // They lower the way's drivability instead (beamngMapNavigation).
  let stopControllerId = null;
  for (const entry of entries.filter((item) => item.kind === 'stop')) {
    if (stopControllerId === null) {
      stopControllerId = allocId();
      controllers.push({
        id: stopControllerId,
        name: 'stop',
        type: 'signStop',
        isSimple: true,
        states: [{ state: 'basicStop', duration: -1 }],
      });
      controllersById.set(stopControllerId, controllers[controllers.length - 1]);
    }

    const instanceId = allocId();
    instances.push({
      id: instanceId,
      name: `stop ${instanceId}`,
      controllerId: stopControllerId,
      sequenceId: 0,
      pos: entry.pos,
      dir: entry.dir,
      group: `group_stop_${stopControllerId}`,
      startDisabled: false,
    });
  }

  const trafficLights = entries.filter((item) => item.kind === 'traffic_light');
  const clusters = clusterTrafficLights(trafficLights);

  clusters.forEach((cluster, clusterIndex) => {
    const { ns, ew } = splitTrafficLightClusterByAxis(cluster.members);

    const lightGroups = [];
    lightGroups.push(...buildAxisLightGroups('ns', ns, clusterIndex, allocId, controllers, controllersById, signalOptions));
    lightGroups.push(...buildAxisLightGroups('ew', ew, clusterIndex, allocId, controllers, controllersById, signalOptions));

    if (lightGroups.length === 0) return;

    const axisCount = new Set(lightGroups.map((group) => group.axis)).size;
    const requiresSequence = axisCount > 1 || lightGroups.some((group) => group.protectedTurn);
    const sequenceId = requiresSequence ? allocId() : 0;
    if (sequenceId > 0) {
      sequences.push({
        id: sequenceId,
        name: `trafficLights_cluster_${clusterIndex + 1}`,
        startTime: 0,
        startDisabled: false,
        ignoreTimer: false,
        phases: buildSequencePhases(lightGroups, controllersById),
      });
    }

    const created = [];
    for (const group of lightGroups) {
      for (const member of group.members) {
        const id = allocId();
        created.push({
          id,
          name: `trafficLight ${id}`,
          controllerId: group.controllerId,
          sequenceId,
          pos: member.pos,
          dir: member.dir,
          startDisabled: false,
        });
      }
    }

    const groupName = `group_${created.map((entry) => entry.id).join('_')}`;
    created.forEach((entry) => {
      entry.group = groupName;
      instances.push(entry);
    });
  });

  return {
    signalData: { instances, controllers, sequences },
    controllerDefinitions: null,
  };
}

export function buildBeamNGSignalExportBundle(terrainData, squareSize) {
  const { signalData, controllerDefinitions } = buildSignalArtifacts(terrainData, squareSize);
  return { signalData, controllerDefinitions };
}

export function buildBeamNGSignalData(terrainData, squareSize) {
  return buildSignalArtifacts(terrainData, squareSize).signalData;
}
