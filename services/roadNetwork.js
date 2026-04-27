const DEFAULT_COORD_PRECISION = 7;

export function makeRoadNodeKey(pt, decimals = DEFAULT_COORD_PRECISION) {
  return `${Number(pt.lat).toFixed(decimals)}:${Number(pt.lng).toFixed(decimals)}`;
}

function makeLayeredRoadNodeKey(pt, layer, decimals = DEFAULT_COORD_PRECISION) {
  return `${makeRoadNodeKey(pt, decimals)}|${String(layer)}`;
}

export function getEffectiveRoadLayer(tags = {}) {
  const explicitLayer = Number.parseInt(tags.layer, 10);
  let layer = Number.isFinite(explicitLayer) ? explicitLayer : 0;

  const bridgeLike =
    tags.bridge === 'yes' ||
    tags.bridge === 'viaduct' ||
    tags.man_made === 'bridge' ||
    tags.location === 'overground' ||
    tags.location === 'elevated';
  const tunnelLike =
    tags.tunnel === 'yes' ||
    tags.covered === 'yes' ||
    tags.location === 'underground' ||
    tags.location === 'underwater';

  if (!Number.isFinite(explicitLayer)) {
    if (bridgeLike) layer += 1;
    if (tunnelLike || tags.cutting === 'yes') layer -= 1;
  }

  if (tags.barrier === 'retaining_wall' && !bridgeLike && !tunnelLike) {
    layer += 0.5;
  }
  if (tags.embankment === 'yes') {
    layer += 0.5;
  }

  return layer;
}

export function splitPolylineAtNodeKeys(points, splitKeys, layer, decimals = DEFAULT_COORD_PRECISION) {
  if (!Array.isArray(points) || points.length < 2 || !splitKeys || splitKeys.size === 0) {
    return [points];
  }

  const out = [];
  let current = [points[0]];

  for (let i = 1; i < points.length; i++) {
    const pt = points[i];
    current.push(pt);

    if (i < points.length - 1 && splitKeys.has(makeLayeredRoadNodeKey(pt, layer, decimals))) {
      if (current.length >= 2) out.push(current);
      current = [pt];
    }
  }

  if (current.length >= 2) out.push(current);
  return out;
}

export function buildRoadNetwork(roadFeatures = [], options = {}) {
  const {
    layerResolver = getEffectiveRoadLayer,
    decimals = DEFAULT_COORD_PRECISION,
  } = options;

  const roads = roadFeatures.filter(
    (feature) => feature?.type === 'road' && Array.isArray(feature.geometry) && feature.geometry.length >= 2,
  );

  const nodeCounts = new Map();
  for (const road of roads) {
    const layer = layerResolver(road.tags || {});
    const seenInRoad = new Set();
    for (const pt of road.geometry) {
      const key = makeLayeredRoadNodeKey(pt, layer, decimals);
      if (seenInRoad.has(key)) continue;
      seenInRoad.add(key);
      nodeCounts.set(key, (nodeCounts.get(key) || 0) + 1);
    }
  }

  const splitKeys = new Set();
  for (const [key, count] of nodeCounts.entries()) {
    if (count >= 2) splitKeys.add(key);
  }

  const segments = [];
  const intersections = new Map();

  roads.forEach((road, roadIndex) => {
    const layer = layerResolver(road.tags || {});
    const pieces = splitPolylineAtNodeKeys(road.geometry, splitKeys, layer, decimals);

    pieces.forEach((piece, pieceIndex) => {
      if (!Array.isArray(piece) || piece.length < 2) return;

      const geometry = piece.map((pt) => ({ lat: pt.lat, lng: pt.lng }));
      const startKey = makeLayeredRoadNodeKey(geometry[0], layer, decimals);
      const endKey = makeLayeredRoadNodeKey(geometry[geometry.length - 1], layer, decimals);
      const featureId = road.id ?? `road_${roadIndex}`;
      const segment = {
        id: `${featureId}_seg_${pieceIndex}`,
        sourceFeature: road,
        geometry,
        tags: road.tags || {},
        highway: road.tags?.highway,
        layer,
        startKey,
        endKey,
      };

      segments.push(segment);

      const startEntries = intersections.get(startKey) || [];
      startEntries.push({ road: segment, isStart: true });
      intersections.set(startKey, startEntries);

      const endEntries = intersections.get(endKey) || [];
      endEntries.push({ road: segment, isStart: false });
      intersections.set(endKey, endEntries);
    });
  });

  for (const [key, entries] of Array.from(intersections.entries())) {
    if (entries.length < 2) intersections.delete(key);
  }

  return {
    segments,
    intersections,
    splitKeys,
  };
}

function defaultRoadStyleKey(segment) {
  const tags = segment?.tags || {};
  return JSON.stringify([
    segment?.highway || '',
    segment?.layer ?? '',
    tags.name || '',
    tags.ref || '',
    tags.width || '',
    tags.lanes || '',
    tags['lanes:forward'] || '',
    tags['lanes:backward'] || '',
    tags.oneway || '',
    tags.surface || '',
  ]);
}

function orientSegmentFromNode(segment, nodeKey) {
  if (segment.startKey === nodeKey) {
    return {
      geometry: segment.geometry,
      nextNodeKey: segment.endKey,
    };
  }
  if (segment.endKey === nodeKey) {
    return {
      geometry: [...segment.geometry].reverse(),
      nextNodeKey: segment.startKey,
    };
  }
  return null;
}

function orientSegmentTowardNode(segment, nodeKey) {
  if (segment.endKey === nodeKey) {
    return {
      geometry: segment.geometry,
      nextNodeKey: segment.startKey,
    };
  }
  if (segment.startKey === nodeKey) {
    return {
      geometry: [...segment.geometry].reverse(),
      nextNodeKey: segment.endKey,
    };
  }
  return null;
}

export function mergeLinearRoadSegments(segments = [], intersections = new Map(), options = {}) {
  if (!Array.isArray(segments) || segments.length === 0) return [];

  const styleKeyResolver = options.styleKeyResolver || defaultRoadStyleKey;
  const endpointMap = new Map();
  for (const segment of segments) {
    const startEntries = endpointMap.get(segment.startKey) || [];
    startEntries.push(segment);
    endpointMap.set(segment.startKey, startEntries);

    const endEntries = endpointMap.get(segment.endKey) || [];
    endEntries.push(segment);
    endpointMap.set(segment.endKey, endEntries);
  }

  const visited = new Set();
  const merged = [];

  const findContinuation = (segment, nodeKey) => {
    const entries = endpointMap.get(nodeKey) || [];
    if (entries.length !== 2) return null;

    const other = entries[0].id === segment.id ? entries[1] : entries[0];
    if (!other || visited.has(other.id)) return null;
    if (styleKeyResolver(other) !== styleKeyResolver(segment)) return null;
    return other;
  };

  for (const seed of segments) {
    if (visited.has(seed.id)) continue;

    visited.add(seed.id);
    let geometry = seed.geometry.map((pt) => ({ lat: pt.lat, lng: pt.lng }));
    const members = [seed];
    let headNode = seed.startKey;
    let tailNode = seed.endKey;
    let headSegment = seed;
    let tailSegment = seed;

    let extended = true;
    while (extended) {
      extended = false;
      const next = findContinuation(tailSegment, tailNode);
      if (!next) break;
      const oriented = orientSegmentFromNode(next, tailNode);
      if (!oriented) break;
      geometry = geometry.concat(oriented.geometry.slice(1));
      members.push(next);
      tailNode = oriented.nextNodeKey;
      tailSegment = next;
      visited.add(next.id);
      extended = true;
    }

    extended = true;
    while (extended) {
      extended = false;
      const next = findContinuation(headSegment, headNode);
      if (!next) break;
      const oriented = orientSegmentTowardNode(next, headNode);
      if (!oriented) break;
      geometry = oriented.geometry.slice(0, -1).concat(geometry);
      members.unshift(next);
      headNode = oriented.nextNodeKey;
      headSegment = next;
      visited.add(next.id);
      extended = true;
    }

    merged.push({
      ...seed,
      geometry,
      members,
      startKey: headNode,
      endKey: tailNode,
    });
  }

  return merged;
}