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
  // (embankment=yes adds nothing: a road on an embankment meets and crosses other roads at grade
  // on its top. Half a layer for it made every road crossing one near a junction a grade
  // separation: the road on the embankment was lifted a full clearance over the ground there,
  // a 10 m tent in the approach between two Rhine bridges at Arnhem.)

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

  // Drop non-finite vertices before anything else. OSM ways can reference
  // unresolved nodes, leaving NaN/undefined lat/lng in the geometry; a single
  // bad vertex otherwise becomes a DecalRoad/MeshRoad node at ±inf, which BeamNG
  // rejects at batch-build time ("packed position exceeded supported local
  // range … by inf m") and the entire road silently fails to render. Keep only
  // features that still have ≥2 valid vertices after cleaning.
  const isFinitePoint = (pt) =>
    pt != null && Number.isFinite(Number(pt.lat)) && Number.isFinite(Number(pt.lng));

  const roads = roadFeatures
    .filter((feature) => feature?.type === 'road' && Array.isArray(feature.geometry))
    .map((feature) => {
      const clean = feature.geometry.filter(isFinitePoint);
      return clean.length === feature.geometry.length ? feature : { ...feature, geometry: clean };
    })
    .filter((feature) => feature.geometry.length >= 2);

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

// Reject merge continuations that double back on themselves. Dual carriageways
// are mapped in OSM as two parallel ways sharing the same name/ref/oneway, and
// they meet at the nodes where the road splits/merges — exactly the
// "two segments, same style key" case the merger stitches. Concatenating them
// produces a polyline with a ~180° hairpin at the join; BeamNG's improvedSpline
// then emits inf positions and drops the DecalRoad batch ("packed position
// exceeded supported local range … by inf m"). cos(120°): anything turning
// sharper than 120° at a join is not a continuation of the same roadway.
const MERGE_REVERSAL_DOT = -0.5;

function joinDirection(geometry, fromEnd) {
  if (!Array.isArray(geometry) || geometry.length < 2) return null;
  // Direction of travel: into the final point (fromEnd) or out of the first.
  const a = fromEnd ? geometry[geometry.length - 2] : geometry[0];
  const b = fromEnd ? geometry[geometry.length - 1] : geometry[1];
  const avgLatRad = (((a.lat || 0) + (b.lat || 0)) * 0.5 * Math.PI) / 180;
  const vx = ((b.lng || 0) - (a.lng || 0)) * Math.cos(avgLatRad);
  const vy = (b.lat || 0) - (a.lat || 0);
  const len = Math.hypot(vx, vy);
  if (len < 1e-12) return null;
  return { x: vx / len, y: vy / len };
}

function continuationKeepsDirection(currentGeometry, nextGeometry, atTail) {
  // Tail extension: current END direction vs next START direction.
  // Head extension: next END direction vs current START direction.
  const into = atTail ? joinDirection(currentGeometry, true) : joinDirection(nextGeometry, true);
  const outOf = atTail ? joinDirection(nextGeometry, false) : joinDirection(currentGeometry, false);
  if (!into || !outOf) return true;
  return (into.x * outOf.x + into.y * outOf.y) > MERGE_REVERSAL_DOT;
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
      if (!continuationKeepsDirection(geometry, oriented.geometry, true)) break;
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
      if (!continuationKeepsDirection(geometry, oriented.geometry, false)) break;
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