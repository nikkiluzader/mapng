const OVERPASS_ENDPOINTS = [
  "https://overpass-api.de/api/interpreter",
  "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
  "https://overpass.private.coffee/api/interpreter",
];

// --- Clipping Helpers ---

// Check if a point is inside a half-plane defined by a boundary edge
const isInside = (p, bounds, edge) => {
  switch (edge) {
    case "N":
      return p.lat <= bounds.north;
    case "S":
      return p.lat >= bounds.south;
    case "E":
      return p.lng <= bounds.east;
    case "W":
      return p.lng >= bounds.west;
  }
};

// Calculate intersection of a line segment (a->b) with a boundary edge
const intersect = (a, b, bounds, edge) => {
  // Latitude = y, Longitude = x
  const x1 = a.lng,
    y1 = a.lat;
  const x2 = b.lng,
    y2 = b.lat;

  let x = 0,
    y = 0;

  // Avoid divide by zero if line is parallel (though isInside check usually prevents this being called purely parallel outside)
  if (edge === "N" || edge === "S") {
    const boundaryY = edge === "N" ? bounds.north : bounds.south;
    y = boundaryY;
    if (y2 === y1)
      x = x1; // Parallel
    else x = x1 + ((x2 - x1) * (boundaryY - y1)) / (y2 - y1);
  } else {
    const boundaryX = edge === "E" ? bounds.east : bounds.west;
    x = boundaryX;
    if (x2 === x1)
      y = y1; // Parallel
    else y = y1 + ((y2 - y1) * (boundaryX - x1)) / (x2 - x1);
  }
  return { lat: y, lng: x };
};

// Sutherland-Hodgman algorithm for Polygon clipping
const clipPolygon = (points, bounds) => {
  let output = points;
  const edges = ["N", "S", "E", "W"];

  for (const edge of edges) {
    const input = output;
    output = [];
    if (input.length === 0) break;

    let S = input[input.length - 1];
    for (const E of input) {
      if (isInside(E, bounds, edge)) {
        if (!isInside(S, bounds, edge)) {
          output.push(intersect(S, E, bounds, edge));
        }
        output.push(E);
      } else if (isInside(S, bounds, edge)) {
        output.push(intersect(S, E, bounds, edge));
      }
      S = E;
    }
  }
  return output;
};

// Line clipping that handles splitting lines into multiple segments
const clipLineString = (points, bounds) => {
  let segments = [points];
  const edges = ["N", "S", "E", "W"];

  for (const edge of edges) {
    const nextSegments = [];

    for (const segment of segments) {
      let currentSplit = [];

      for (let i = 0; i < segment.length; i++) {
        const p = segment[i];
        const prev = i > 0 ? segment[i - 1] : null;

        const pIn = isInside(p, bounds, edge);
        const prevIn = prev ? isInside(prev, bounds, edge) : null;

        if (i === 0) {
          if (pIn) currentSplit.push(p);
        } else {
          if (pIn && prevIn) {
            // Both inside
            currentSplit.push(p);
          } else if (pIn && !prevIn) {
            // Entering
            if (prev) {
              const intersection = intersect(prev, p, bounds, edge);
              currentSplit.push(intersection);
              currentSplit.push(p);
            }
          } else if (!pIn && prevIn) {
            // Leaving
            if (prev) {
              const intersection = intersect(prev, p, bounds, edge);
              currentSplit.push(intersection);
              // Finish this segment
              if (currentSplit.length > 0) nextSegments.push(currentSplit);
              currentSplit = [];
            }
          }
        }
      }
      if (currentSplit.length > 0) nextSegments.push(currentSplit);
    }
    segments = nextSegments;
  }

  return segments;
};

// --- Main Service ---

// Helper to construct the Overpass QL query
const buildQuery = (bounds) => {
  const bbox = `${bounds.south},${bounds.west},${bounds.north},${bounds.east}`;

  return `
  [out:json][timeout:180][maxsize:1073741824];
  (
    // --- Your existing core layers ---
    way["highway"](${bbox});
    way["building"](${bbox});
    way["waterway"](${bbox});
    way["barrier"](${bbox});
    way["aeroway"](${bbox});
    way["man_made"](${bbox});
    way["public_transport"](${bbox});
    way["power"](${bbox});
    way["military"](${bbox});
    way["place"](${bbox});
    way["historic"](${bbox});
    way["tourism"](${bbox});
    way["amenity"](${bbox});

    relation["highway"](${bbox});
    relation["building"](${bbox});
    relation["waterway"](${bbox});
    relation["barrier"](${bbox});
    relation["aeroway"](${bbox});
    relation["man_made"](${bbox});
    relation["public_transport"](${bbox});
    relation["power"](${bbox});
    relation["military"](${bbox});
    relation["place"](${bbox});
    relation["historic"](${bbox});
    relation["tourism"](${bbox});
    relation["amenity"](${bbox});

    // --- Ground cover / land cover (polygons) ---
    // Primary land-cover keys
    way["landuse"](${bbox});
    way["natural"](${bbox});
    way["leisure"](${bbox});
    way["golf"](${bbox});
    way["recreation"](${bbox});

    relation["landuse"](${bbox});
    relation["natural"](${bbox});
    relation["leisure"](${bbox});
    relation["golf"](${bbox});
    relation["recreation"](${bbox});

    // Vegetation + agriculture + forestry (often used as ground cover)
    way["vegetation"](${bbox});
    relation["vegetation"](${bbox});

    way["crop"](${bbox});
    relation["crop"](${bbox});

    way["orchard"](${bbox});
    relation["orchard"](${bbox});

    way["vineyard"](${bbox});
    relation["vineyard"](${bbox});

    // Surface/material-style ground cover (common in parks, plazas, paths, lots)
    // Note: surface is frequently on highways/areas, but sometimes mapped on areas directly too.
    way["surface"](${bbox});
    relation["surface"](${bbox});

    way["material"](${bbox});
    relation["material"](${bbox});
    way["golf"](${bbox});
    relation["golf"](${bbox});
    way["recreation"](${bbox});
    relation["recreation"](${bbox});

    // Wetlands, water areas, coastlines, beaches, etc.
    // water=* is commonly used with natural=water or landuse=reservoir, but can appear standalone.
    way["water"](${bbox});
    relation["water"](${bbox});

    way["wetland"](${bbox});
    relation["wetland"](${bbox});

    way["tidal"](${bbox});
    relation["tidal"](${bbox});

    // Explicit area tagging patterns
    // Some mappers tag "area=yes" with other keys to indicate polygons.
    way["area"="yes"](${bbox});
    relation["area"="yes"](${bbox});

    // Landcover key (less common, but exists)
    way["landcover"](${bbox});
    relation["landcover"](${bbox});

    // --- Point vegetation (you already have trees; here are common extras) ---
    node["natural"="tree"](${bbox});
    node["natural"="tree_row"](${bbox});
    way["natural"="tree_row"](${bbox});
    relation["natural"="tree_row"](${bbox});
    node["natural"="shrub"](${bbox});
    node["natural"="scrub"](${bbox});
    node["natural"="wood"](${bbox});

    // --- Street furniture & urban infrastructure (point features) ---
    node["highway"="street_lamp"](${bbox});
    node["barrier"="bollard"](${bbox});
    node["amenity"="bench"](${bbox});
    node["traffic_sign"](${bbox});
    node["highway"="stop"](${bbox});
    node["highway"="give_way"](${bbox});
    node["highway"="traffic_signals"](${bbox});
  );
  out body geom;
`;
};

// Helper to convert Overpass geometry format {lat, lon} to our {lat, lng}
const convertGeom = (geom) => {
  if (!geom) return [];
  return geom.map((p) => ({ lat: p.lat, lng: p.lon }));
};

const isClosedRing = (nodes, epsilon = 1e-9) => {
  if (!nodes || nodes.length < 4) return false;
  const first = nodes[0];
  const last = nodes[nodes.length - 1];
  return (
    Math.abs(first.lat - last.lat) < epsilon &&
    Math.abs(first.lng - last.lng) < epsilon
  );
};

const isAreaLikeWay = (tags, nodes) => {
  if (!tags || !nodes || nodes.length < 3) return false;
  if (tags.area === "yes") return true;
  if (tags.area === "no") return false;

  const closed = isClosedRing(nodes);
  if (!closed) return false;

  if (tags.highway || tags.railway || tags.barrier) return false;

  if (tags.waterway) {
    return ["riverbank", "dock", "boatyard", "dam"].includes(tags.waterway);
  }

  return !!(
    tags.building ||
    tags.landuse ||
    tags.landcover ||
    tags.leisure ||
    tags.golf ||
    tags.recreation ||
    tags.natural ||
    tags.amenity ||
    tags.aeroway ||
    tags.tourism ||
    tags.man_made ||
    tags.public_transport ||
    tags.power ||
    tags.military ||
    tags.place ||
    tags.historic ||
    tags.wetland ||
    tags.surface ||
    tags.material
  );
};

const edgeDistance = (p, bounds) => ({
  west: Math.abs(p.lng - bounds.west),
  east: Math.abs(p.lng - bounds.east),
  south: Math.abs(p.lat - bounds.south),
  north: Math.abs(p.lat - bounds.north),
});

const getBoundaryEdge = (p, bounds) => {
  const d = edgeDistance(p, bounds);
  let bestEdge = "west";
  let best = d.west;
  if (d.north < best) {
    bestEdge = "north";
    best = d.north;
  }
  if (d.east < best) {
    bestEdge = "east";
    best = d.east;
  }
  if (d.south < best) {
    bestEdge = "south";
  }
  return bestEdge;
};

const isNearBoundary = (p, bounds, epsilon) => {
  if (epsilon === undefined) {
    // Use a relative epsilon based on tile span — handles any zoom level
    const span = Math.max(bounds.east - bounds.west, bounds.north - bounds.south);
    epsilon = span * 0.001; // 0.1% of tile span
  }
  const d = edgeDistance(p, bounds);
  return (
    d.west <= epsilon ||
    d.east <= epsilon ||
    d.south <= epsilon ||
    d.north <= epsilon
  );
};

const boundaryEndCornerCW = (edge, bounds) => {
  switch (edge) {
    case "west":
      return { lat: bounds.north, lng: bounds.west };
    case "north":
      return { lat: bounds.north, lng: bounds.east };
    case "east":
      return { lat: bounds.south, lng: bounds.east };
    case "south":
      return { lat: bounds.south, lng: bounds.west };
    default:
      return { lat: bounds.south, lng: bounds.west };
  }
};

const boundaryStartCornerCW = (edge, bounds) => {
  switch (edge) {
    case "west":
      return { lat: bounds.south, lng: bounds.west };
    case "north":
      return { lat: bounds.north, lng: bounds.west };
    case "east":
      return { lat: bounds.north, lng: bounds.east };
    case "south":
      return { lat: bounds.south, lng: bounds.east };
    default:
      return { lat: bounds.south, lng: bounds.west };
  }
};

const NEXT_EDGE_CW = {
  west: "north",
  north: "east",
  east: "south",
  south: "west",
};

const NEXT_EDGE_CCW = {
  west: "south",
  south: "east",
  east: "north",
  north: "west",
};

const boundaryPath = (from, to, bounds, clockwise = true) => {
  const fromEdge = getBoundaryEdge(from, bounds);
  const toEdge = getBoundaryEdge(to, bounds);
  const path = [from];

  if (fromEdge === toEdge) {
    path.push(to);
    return path;
  }

  let edge = fromEdge;
  const nextEdge = clockwise ? NEXT_EDGE_CW : NEXT_EDGE_CCW;

  for (let steps = 0; steps < 6 && edge !== toEdge; steps++) {
    const corner = clockwise
      ? boundaryEndCornerCW(edge, bounds)
      : boundaryStartCornerCW(edge, bounds);
    path.push(corner);
    edge = nextEdge[edge];
  }

  path.push(to);
  return path;
};

const pointInPolygon = (point, polygon) => {
  const x = point.lng;
  const y = point.lat;
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i].lng;
    const yi = polygon[i].lat;
    const xj = polygon[j].lng;
    const yj = polygon[j].lat;
    const intersect =
      yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
};

const rightSideSamplePoint = (line, bounds) => {
  if (!line || line.length < 2) return null;
  const idx = Math.floor((line.length - 1) / 2);
  const a = line[Math.max(0, idx - 1)];
  const b = line[Math.min(line.length - 1, idx + 1)];
  const dx = b.lng - a.lng;
  const dy = b.lat - a.lat;
  const len = Math.hypot(dx, dy);
  if (len < 1e-12) return null;

  const nx = dy / len;
  const ny = -dx / len;
  const span = Math.min(bounds.east - bounds.west, bounds.north - bounds.south);
  const eps = Math.max(span * 0.003, 1e-7);
  const m = line[idx];

  return {
    lat: m.lat + ny * eps,
    lng: m.lng + nx * eps,
  };
};

// Extend a coastline endpoint to a tile boundary.  Uses the direction of
// travel (from `interior` toward `p`) to decide WHICH boundary the coastline
// would naturally exit, then snaps perpendicular to that boundary.  This
// avoids diagonal cuts across land that a full ray-cast would create.
const extendToBoundary = (p, interior, bounds) => {
  const dx = p.lng - interior.lng;
  const dy = p.lat - interior.lat;

  // Ray-cast to find which boundary the coastline is heading toward
  let bestT = Infinity;
  let hitEdge = null;

  const tryEdge = (boundaryVal, isLat, edgeName) => {
    const d = isLat ? dy : dx;
    if (Math.abs(d) < 1e-15) return;
    const t = (boundaryVal - (isLat ? p.lat : p.lng)) / d;
    if (t <= 0) return;
    const hitLat = p.lat + dy * t;
    const hitLng = p.lng + dx * t;
    const eps = 1e-9;
    if (
      hitLat >= bounds.south - eps && hitLat <= bounds.north + eps &&
      hitLng >= bounds.west - eps && hitLng <= bounds.east + eps &&
      t < bestT
    ) {
      bestT = t;
      hitEdge = edgeName;
    }
  };

  tryEdge(bounds.north, true, "north");
  tryEdge(bounds.south, true, "south");
  tryEdge(bounds.east, false, "east");
  tryEdge(bounds.west, false, "west");

  // Snap perpendicular to the chosen boundary (no diagonal)
  switch (hitEdge) {
    case "north": return { lat: bounds.north, lng: p.lng };
    case "south": return { lat: bounds.south, lng: p.lng };
    case "east":  return { lat: p.lat, lng: bounds.east };
    case "west":  return { lat: p.lat, lng: bounds.west };
    default: {
      // Fallback: nearest boundary
      const d = edgeDistance(p, bounds);
      const minD = Math.min(d.west, d.east, d.south, d.north);
      if (minD === d.south) return { lat: bounds.south, lng: p.lng };
      if (minD === d.north) return { lat: bounds.north, lng: p.lng };
      if (minD === d.west)  return { lat: p.lat, lng: bounds.west };
      return { lat: p.lat, lng: bounds.east };
    }
  }
};

const buildWaterFromCoastlines = (coastSegments, bounds) => {
  const waterPolygons = [];
  const boundsRing = [
    { lat: bounds.south, lng: bounds.west },
    { lat: bounds.north, lng: bounds.west },
    { lat: bounds.north, lng: bounds.east },
    { lat: bounds.south, lng: bounds.east },
    { lat: bounds.south, lng: bounds.west },
  ];

  coastSegments.forEach((segment) => {
    const geom = segment.geometry;
    if (!geom || geom.length < 2) return;

    if (isClosedRing(geom)) {
      const seaTestPoint = rightSideSamplePoint(geom, bounds);
      const seaInsideRing = seaTestPoint && pointInPolygon(seaTestPoint, geom);

      if (seaInsideRing) {
        waterPolygons.push({
          id: `coast_water_${segment.id}`,
          type: "water",
          geometry: geom,
          tags: { natural: "water", source: "coastline" },
        });
      } else {
        waterPolygons.push({
          id: `coast_water_${segment.id}`,
          type: "water",
          geometry: boundsRing,
          holes: [geom],
          tags: { natural: "water", source: "coastline" },
        });
      }
      return;
    }

    // For endpoints not on the boundary, compute a boundary anchor for the
    // boundary walk but do NOT alter the coastline geometry itself.  This
    // avoids creating artificial coastline segments that cut through land.
    const start = geom[0];
    const end = geom[geom.length - 1];
    const startNear = isNearBoundary(start, bounds);
    const endNear = isNearBoundary(end, bounds);

    if (!startNear && !endNear) {
      // Both endpoints are interior — can't form a meaningful water polygon
      return;
    }

    // Boundary anchors: where the walk starts/ends on the tile edge
    const startAnchor = startNear ? start : extendToBoundary(start, geom[1], bounds);
    const endAnchor = endNear ? end : extendToBoundary(end, geom[geom.length - 2], bounds);

    // Build the polygon: coastline + boundary walk from endAnchor → startAnchor
    const cwPath = boundaryPath(endAnchor, startAnchor, bounds, true);
    const ccwPath = boundaryPath(endAnchor, startAnchor, bounds, false);

    // The polygon is: original coastline → snap to endAnchor → boundary walk → snap from startAnchor
    const bridgeToEnd = endNear ? [] : [endAnchor];
    const bridgeFromStart = startNear ? [] : [startAnchor];

    const candidateCW = [...bridgeFromStart, ...geom, ...bridgeToEnd, ...cwPath.slice(1)];
    const candidateCCW = [...bridgeFromStart, ...geom, ...bridgeToEnd, ...ccwPath.slice(1)];

    const seaTestPoint = rightSideSamplePoint(geom, bounds);
    const chooseCW = seaTestPoint && pointInPolygon(seaTestPoint, candidateCW);
    const polygon = chooseCW ? candidateCW : candidateCCW;

    if (polygon.length > 2) {
      waterPolygons.push({
        id: `coast_water_${segment.id}`,
        type: "water",
        geometry: polygon,
        tags: { natural: "water", source: "coastline" },
      });
    }
  });

  return waterPolygons;
};

// Helper to join way segments into closed rings — O(n) via endpoint index
const joinWays = (wayNodesList) => {
  if (wayNodesList.length === 0) return [];

  const rings = [];
  // Build endpoint → way index lookup for O(1) matching
  const makeKey = (node) => `${node.lat},${node.lng}`;
  const pool = wayNodesList.map((w, i) => ({ nodes: [...w], id: i }));
  const alive = new Set(pool.map((_, i) => i));

  // Index: key → Set of pool indices where that key is an endpoint
  const startIndex = new Map();
  const endIndex = new Map();

  const addToIndex = (idx, entry) => {
    const sk = makeKey(entry.nodes[0]);
    const ek = makeKey(entry.nodes[entry.nodes.length - 1]);
    if (!startIndex.has(sk)) startIndex.set(sk, new Set());
    startIndex.get(sk).add(idx);
    if (!endIndex.has(ek)) endIndex.set(ek, new Set());
    endIndex.get(ek).add(idx);
  };
  const removeFromIndex = (idx, entry) => {
    const sk = makeKey(entry.nodes[0]);
    const ek = makeKey(entry.nodes[entry.nodes.length - 1]);
    startIndex.get(sk)?.delete(idx);
    endIndex.get(ek)?.delete(idx);
  };

  pool.forEach((entry, idx) => addToIndex(idx, entry));

  while (alive.size > 0) {
    const firstIdx = alive.values().next().value;
    const ring = pool[firstIdx];
    alive.delete(firstIdx);
    removeFromIndex(firstIdx, ring);

    let changed = true;
    while (changed) {
      changed = false;
      const startNode = ring.nodes[0];
      const endNode = ring.nodes[ring.nodes.length - 1];
      const sk = makeKey(startNode);
      const ek = makeKey(endNode);

      // Already closed?
      if (sk === ek && ring.nodes.length > 2) break;

      // Try to find a way whose start matches our end
      const endMatches = startIndex.get(ek);
      if (endMatches) {
        for (const idx of endMatches) {
          if (!alive.has(idx)) continue;
          const way = pool[idx];
          alive.delete(idx);
          removeFromIndex(idx, way);
          ring.nodes.push(...way.nodes.slice(1));
          changed = true;
          break;
        }
      }
      if (changed) continue;

      // Try to find a way whose end matches our end (reverse it)
      const endEndMatches = endIndex.get(ek);
      if (endEndMatches) {
        for (const idx of endEndMatches) {
          if (!alive.has(idx)) continue;
          const way = pool[idx];
          alive.delete(idx);
          removeFromIndex(idx, way);
          way.nodes.reverse();
          ring.nodes.push(...way.nodes.slice(1));
          changed = true;
          break;
        }
      }
      if (changed) continue;

      // Try to find a way whose end matches our start
      const startMatches = endIndex.get(sk);
      if (startMatches) {
        for (const idx of startMatches) {
          if (!alive.has(idx)) continue;
          const way = pool[idx];
          alive.delete(idx);
          removeFromIndex(idx, way);
          ring.nodes.unshift(...way.nodes.slice(0, -1));
          changed = true;
          break;
        }
      }
      if (changed) continue;

      // Try to find a way whose start matches our start (reverse it)
      const startStartMatches = startIndex.get(sk);
      if (startStartMatches) {
        for (const idx of startStartMatches) {
          if (!alive.has(idx)) continue;
          const way = pool[idx];
          alive.delete(idx);
          removeFromIndex(idx, way);
          way.nodes.reverse();
          ring.nodes.unshift(...way.nodes.slice(0, -1));
          changed = true;
          break;
        }
      }
    }
    rings.push(ring.nodes);
  }
  return rings;
};

const parseOverpassResponse = (data, bounds) => {
  const ways = {};
  const relations = [];
  const rawFeatures = [];
  const consumedWayIds = new Set();

  // 1. First Pass: Index Nodes (Trees + Street Furniture) and Ways
  for (const el of data.elements) {
    if (el.type === "node") {
      if (el.tags) {
        if (el.tags.natural === "tree") {
          rawFeatures.push({
            id: el.id.toString(),
            type: "vegetation",
            geometry: [{ lat: el.lat, lng: el.lon }],
            tags: el.tags,
          });
        } else if (
          el.tags.highway === "street_lamp" ||
          el.tags.barrier === "bollard" ||
          el.tags.amenity === "bench" ||
          el.tags.traffic_sign ||
          el.tags.highway === "stop" ||
          el.tags.highway === "give_way" ||
          el.tags.highway === "traffic_signals"
        ) {
          rawFeatures.push({
            id: el.id.toString(),
            type: "street_furniture",
            geometry: [{ lat: el.lat, lng: el.lon }],
            tags: el.tags,
          });
        }
      }
    } else if (el.type === "way") {
      const geometry = convertGeom(el.geometry);
      if (geometry.length > 1) {
        ways[el.id] = { id: el.id, nodes: geometry, tags: el.tags || {} };
      }
    } else if (el.type === "relation") {
      relations.push(el);
      // Also index members of relations if they have geometry
      if (el.members) {
        el.members.forEach((m) => {
          if (m.type === "way" && m.geometry && !ways[m.ref]) {
            ways[m.ref] = {
              id: m.ref,
              nodes: convertGeom(m.geometry),
              tags: {},
            };
          }
        });
      }
    }
  }

  // 2. PASS 1: Tag Inheritance from Relations to Ways
  for (const r of relations) {
    const tags = r.tags || {};
    if (!r.members) continue;

    const isRoute =
      tags.type === "route" ||
      tags.type === "superroute" ||
      !!tags.highway ||
      !!tags.network;
    const isSite =
      tags.type === "site" || !!tags.historic || tags.type === "heritage";

    if (isRoute || isSite) {
      r.members.forEach((m) => {
        if (m.type === "way" && ways[m.ref]) {
          const w = ways[m.ref];
          const inheritedProps = [
            "highway",
            "name",
            "lanes",
            "oneway",
            "surface",
            "layer",
            "bridge",
            "tunnel",
          ];
          inheritedProps.forEach((prop) => {
            if (!w.tags[prop] && tags[prop]) {
              w.tags[prop] = tags[prop];
            }
          });
        }
      });
    }
  }

  // Helper to determine feature type
  const getFeatureType = (tags) => {
    if (
      !!tags.building ||
      ["castle", "fort", "monastery", "tower", "ruins"].includes(tags.historic)
    )
      return "building";
    if (tags.natural === "coastline") return "coastline";
    if (
      tags.natural === "water" ||
      tags.waterway ||
      tags.landuse === "reservoir" ||
      tags.landuse === "basin"
    )
      return "water";
    if (tags.barrier) return "barrier";

    // Comprehensive Landuse Check
    if (
      tags.landuse ||
      tags.leisure ||
      tags.natural ||
      tags.amenity ||
      tags.aeroway ||
      tags.tourism ||
      tags.man_made ||
      tags.public_transport ||
      tags.power ||
      tags.military ||
      tags.place ||
      tags.historic ||
      tags.wetland ||
      tags.surface ||
      tags.material ||
      tags.golf ||
      tags.recreation
    ) {
      return "landuse";
    }
    return null;
  };

  // 3. PASS 2: Process Area Relations (Multipolygons)
  for (const r of relations) {
    const tags = r.tags || {};
    if (tags.type === "route" || tags.type === "superroute") continue;

    const type = getFeatureType(tags);

    if (type && r.members) {
      const outerWays = r.members
        .filter((m) => m.type === "way" && (m.role === "outer" || !m.role))
        .map((m) => ways[m.ref])
        .filter(Boolean);
      const innerWays = r.members
        .filter((m) => m.type === "way" && m.role === "inner")
        .map((m) => ways[m.ref])
        .filter(Boolean);

      // Mark ways as consumed if they are part of a relation
      // ONLY consume outer ways. Inner ways often have their own tags (e.g. lake inside forest)
      // and need to be processed as standalone features to fill the hole created by the relation.
      outerWays.forEach((w) => {
        if (!w.tags.highway && !w.tags.barrier) consumedWayIds.add(w.id);
      });

      const outerRings = joinWays(outerWays.map((w) => w.nodes));
      const innerRings = joinWays(innerWays.map((w) => w.nodes));

      for (const outer of outerRings) {
        rawFeatures.push({
          id: `rel_${r.id}`,
          type,
          geometry: outer,
          holes: innerRings.length > 0 ? innerRings : undefined,
          tags,
        });
      }
    }
  }

  // 4. PASS 3: Process All Standalone Ways
  const roadsToMerge = new Map();
  const coastlineWaysToJoin = [];

  for (const idStr in ways) {
    const id = parseInt(idStr);
    const w = ways[id];
    const tags = w.tags;

    if (tags.highway || tags.man_made === "bridge") {
      // Roads / Bridges
      const sig = `${tags.highway}|${tags.name || ""}|${tags.lanes || ""}|${tags.oneway || ""}|${tags.layer || 0}`;
      if (!roadsToMerge.has(sig)) roadsToMerge.set(sig, []);
      roadsToMerge.get(sig).push(w);
    } else if (tags.natural === "tree_row") {
      // Interpolate trees along the line
      const nodes = w.nodes;
      for (let i = 0; i < nodes.length - 1; i++) {
        const p1 = nodes[i];
        const p2 = nodes[i + 1];

        // Approximate distance in meters (1 deg lat ~ 111km)
        const dLat = (p2.lat - p1.lat) * 111000;
        const dLng =
          (p2.lng - p1.lng) * 111000 * Math.cos((p1.lat * Math.PI) / 180);
        const dist = Math.sqrt(dLat * dLat + dLng * dLng);

        const numTrees = Math.floor(dist / 8); // Tree every 8 meters

        for (let j = 0; j <= numTrees; j++) {
          const t = j / (numTrees || 1);
          const lat = p1.lat + (p2.lat - p1.lat) * t;
          const lng = p1.lng + (p2.lng - p1.lng) * t;

          rawFeatures.push({
            id: `${id}_tree_${i}_${j}`,
            type: "vegetation",
            geometry: [{ lat, lng }],
            tags: { natural: "tree" },
          });
        }
      }
    } else if (!consumedWayIds.has(id)) {
      const type = getFeatureType(tags);
      if (type) {
        if (type === "coastline") {
          coastlineWaysToJoin.push(w);
          continue;
        }

        let nodes = w.nodes;
        let areaLike = isAreaLikeWay(tags, nodes);

        // Auto-close inherently-area features mapped as open ways
        if (!areaLike && nodes.length >= 3) {
          const inherentlyArea =
            tags.natural === "beach" ||
            tags.natural === "sand" ||
            tags.natural === "bare_rock" ||
            tags.natural === "rock" ||
            tags.natural === "scree" ||
            tags.natural === "shingle" ||
            tags.natural === "scrub" ||
            tags.natural === "wetland" ||
            tags.natural === "wood" ||
            tags.leisure === "park" ||
            tags.leisure === "garden" ||
            tags.leisure === "beach_resort" ||
            tags.landuse;
          if (inherentlyArea && !tags.highway && !tags.barrier) {
            nodes = [...nodes, nodes[0]]; // close the ring
            areaLike = true;
          }
        }

        const linearWaterway =
          type === "water" && !!tags.waterway && !areaLike;

        if (!areaLike && !linearWaterway && type !== "road" && type !== "barrier") {
          continue;
        }

        rawFeatures.push({
          id: id.toString(),
          type: type,
          geometry: nodes,
          tags,
        });
      }
    }
  }

  for (const [sig, segmentList] of roadsToMerge) {
    const joined = joinWays(segmentList.map((s) => s.nodes));
    joined.forEach((geometry, index) => {
      if (geometry.length > 1) {
        rawFeatures.push({
          id: `merged_${sig}_${index}`,
          type: "road",
          geometry,
          tags: segmentList[0].tags,
        });
      }
    });
  }

  // Join coastline ways into continuous lines before clipping
  if (coastlineWaysToJoin.length > 0) {
    const joinedCoastlines = joinWays(coastlineWaysToJoin.map((w) => w.nodes));
    joinedCoastlines.forEach((geometry, index) => {
      if (geometry.length > 1) {
        rawFeatures.push({
          id: `coastline_joined_${index}`,
          type: "coastline",
          geometry,
          tags: { natural: "coastline" },
        });
      }
    });
  }

  // 5. CLIP FEATURES
  const clippedFeatures = [];

  for (const f of rawFeatures) {
    if (f.geometry.length === 1) {
      // Check if point is inside bounds (crucial for interpolated trees)
      const p = f.geometry[0];
      if (
        p.lat >= bounds.south &&
        p.lat <= bounds.north &&
        p.lng >= bounds.west &&
        p.lng <= bounds.east
      ) {
        clippedFeatures.push(f);
      }
      continue;
    }

    const isLinearWaterway =
      f.type === "water" &&
      !!f.tags?.waterway &&
      f.tags?.area !== "yes" &&
      !isClosedRing(f.geometry);

    if (
      f.type === "road" ||
      f.type === "barrier" ||
      f.type === "coastline" ||
      isLinearWaterway
    ) {
      const clippedSegments = clipLineString(f.geometry, bounds);
      clippedSegments.forEach((segment, index) => {
        if (segment.length > 1) {
          clippedFeatures.push({
            ...f,
            id: `${f.id}_seg_${index}`,
            geometry: segment,
          });
        }
      });
    } else {
      // Polygon clipping
      const clippedPoly = clipPolygon(f.geometry, bounds);
      if (clippedPoly.length > 2) {
        // Clip holes too
        const clippedHoles = [];
        if (f.holes) {
          for (const hole of f.holes) {
            const clippedHole = clipPolygon(hole, bounds);
            if (clippedHole.length > 2) {
              clippedHoles.push(clippedHole);
            }
          }
        }

        clippedFeatures.push({
          ...f,
          geometry: clippedPoly,
          holes: clippedHoles.length > 0 ? clippedHoles : undefined,
        });
      }
    }
  }

  const clippedCoastlines = clippedFeatures.filter((f) => f.type === "coastline");
  const coastlineWaterAreas = buildWaterFromCoastlines(clippedCoastlines, bounds);
  const finalClippedFeatures = [...clippedFeatures, ...coastlineWaterAreas];

  // 6. POST-PROCESS: Procedural Vegetation
  const isPointInPolygon = (point, vs) => {
    let x = point.lng,
      y = point.lat;
    let inside = false;
    for (let i = 0, j = vs.length - 1; i < vs.length; j = i++) {
      let xi = vs[i].lng,
        yi = vs[i].lat;
      let xj = vs[j].lng,
        yj = vs[j].lat;
      let intersect =
        yi > y != yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi;
      if (intersect) inside = !inside;
    }
    return inside;
  };

  const proceduralTrees = [];

  for (const f of finalClippedFeatures) {
    const tags = f.tags || {};
    const isWood =
      tags.natural === "wood" ||
      tags.landuse === "forest" ||
      tags.natural === "scrub";
    const isWetland = tags.natural === "wetland" || tags.wetland;

    // User requested procedural trees in wood, forest, wetland, etc.
    if ((isWood || isWetland) && f.geometry.length > 2) {
      // Compute approx bounds to determine area and sampling range
      let minLat = 90,
        maxLat = -90,
        minLng = 180,
        maxLng = -180;
      f.geometry.forEach((p) => {
        if (p.lat < minLat) minLat = p.lat;
        if (p.lat > maxLat) maxLat = p.lat;
        if (p.lng < minLng) minLng = p.lng;
        if (p.lng > maxLng) maxLng = p.lng;
      });

      const widthM =
        (maxLng - minLng) * 111000 * Math.cos((minLat * Math.PI) / 180);
      const heightM = (maxLat - minLat) * 111000;
      const areaM2 = Math.abs(widthM * heightM * 0.5); // Rough area estimation

      // Density settings (meters between trees)
      let treeSpacing = 15;
      if (tags.natural === "scrub") treeSpacing = 20;
      if (isWetland) treeSpacing = 25; // Sparse in wetlands
      if (tags.landuse === "forest" || tags.natural === "wood")
        treeSpacing = 12; // Dense in forests

      // Limit count to avoid performance kill on huge polygons
      const treeCount = Math.min(
        2000,
        Math.floor(areaM2 / (treeSpacing * treeSpacing)),
      );

      for (let i = 0; i < treeCount; i++) {
        const pt = {
          lat: minLat + Math.random() * (maxLat - minLat),
          lng: minLng + Math.random() * (maxLng - minLng),
        };

        // Verify point is inside the polygon
        if (isPointInPolygon(pt, f.geometry)) {
          // Verify point is NOT inside any holes (e.g. lake in forest)
          let inHole = false;
          if (f.holes) {
            for (const hole of f.holes) {
              if (isPointInPolygon(pt, hole)) {
                inHole = true;
                break;
              }
            }
          }

          if (!inHole) {
            proceduralTrees.push({
              id: `${f.id}_proc_tree_${i}`,
              type: "vegetation",
              geometry: [{ lat: pt.lat, lng: pt.lng }],
              tags: { natural: "tree", procedurally_generated: "yes" },
            });
          }
        }
      }
    }
  }

  return [...finalClippedFeatures, ...proceduralTrees];
};

export const fetchOSMData = async (bounds) => {
  console.log(
    `[OSM] Fetching data for bounds: N:${bounds.north}, S:${bounds.south}, E:${bounds.east}, W:${bounds.west}`,
  );

  const query = buildQuery(bounds);

  for (const endpoint of OVERPASS_ENDPOINTS) {
    try {
      console.log(`[OSM] Trying endpoint: ${endpoint}`);
      const response = await fetch(endpoint, {
        method: "POST",
        body: `data=${encodeURIComponent(query)}`,
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
        },
      });

      if (!response.ok) {
        console.warn(
          `[OSM] API Error from ${endpoint}: ${response.status} ${response.statusText}`,
        );
        continue; // Try next endpoint
      }

      const data = await response.json();
      console.log(
        `[OSM] Received ${data.elements?.length || 0} elements from ${endpoint}.`,
      );
      console.log(data);

      const features = parseOverpassResponse(data, bounds);
      console.log(`[OSM] Parsed ${features.length} features.`);
      return features;
    } catch (error) {
      console.error(`[OSM] Error fetching data from ${endpoint}:`, error);
      // Wait a bit before trying the next one
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }

  console.error("[OSM] All endpoints failed.");
  return [];
};
