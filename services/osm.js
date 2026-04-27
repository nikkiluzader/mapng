const OVERPASS_ENDPOINTS = [
  "https://lz4.overpass-api.de/api/interpreter",
  "https://overpass-api.de/api/interpreter",
  "https://overpass.private.coffee/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
  "https://overpass.openstreetmap.ru/api/interpreter",
];

let lastOSMRequestInfo = null;

export const getOSMQueryParameters = (bounds) => ({
  endpointCandidates: [...OVERPASS_ENDPOINTS],
  method: 'POST',
  output: 'json',
  timeoutSec: 30,
  maxSize: 134217728, // 128 MB — much more reasonable
  bbox: {
    south: bounds.south,
    west: bounds.west,
    north: bounds.north,
    east: bounds.east,
  },
});

export const getLastOSMRequestInfo = () => {
  return lastOSMRequestInfo ? { ...lastOSMRequestInfo } : null;
};

// --- Clipping Helpers ---

const isInside = (p, bounds, edge) => {
  switch (edge) {
    case "N": return p.lat <= bounds.north;
    case "S": return p.lat >= bounds.south;
    case "E": return p.lng <= bounds.east;
    case "W": return p.lng >= bounds.west;
  }
};

const intersect = (a, b, bounds, edge) => {
  const x1 = a.lng, y1 = a.lat;
  const x2 = b.lng, y2 = b.lat;
  let x = 0, y = 0;

  if (edge === "N" || edge === "S") {
    const boundaryY = edge === "N" ? bounds.north : bounds.south;
    y = boundaryY;
    x = y2 === y1 ? x1 : x1 + ((x2 - x1) * (boundaryY - y1)) / (y2 - y1);
  } else {
    const boundaryX = edge === "E" ? bounds.east : bounds.west;
    x = boundaryX;
    y = x2 === x1 ? y1 : y1 + ((y2 - y1) * (boundaryX - x1)) / (x2 - x1);
  }
  return { lat: y, lng: x };
};

const clipPolygon = (points, bounds) => {
  let output = points;
  for (const edge of ["N", "S", "E", "W"]) {
    const input = output;
    output = [];
    if (input.length === 0) break;
    let S = input[input.length - 1];
    for (const E of input) {
      if (isInside(E, bounds, edge)) {
        if (!isInside(S, bounds, edge)) output.push(intersect(S, E, bounds, edge));
        output.push(E);
      } else if (isInside(S, bounds, edge)) {
        output.push(intersect(S, E, bounds, edge));
      }
      S = E;
    }
  }
  return output;
};

const clipLineString = (points, bounds) => {
  let segments = [points];
  for (const edge of ["N", "S", "E", "W"]) {
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
            currentSplit.push(p);
          } else if (pIn && !prevIn) {
            if (prev) { currentSplit.push(intersect(prev, p, bounds, edge)); currentSplit.push(p); }
          } else if (!pIn && prevIn) {
            if (prev) {
              currentSplit.push(intersect(prev, p, bounds, edge));
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

const buildQuery = (bounds) => {
  const bbox = `${bounds.south},${bounds.west},${bounds.north},${bounds.east}`;

  // Timeout reduced to 30s (more realistic for public mirrors).
  // Maxsize reduced to 128 MB — 512 MB was triggering server-side rejection.
  // Query trimmed: removed redundant/rare keys (seamark, tidal, harbour subtypes,
  // vegetation, crop, orchard, vineyard, material) that overlap with natural/landuse
  // and add significant response weight with minimal 3D rendering value.
  return `
[out:json][timeout:15][maxsize:134217728];
(
  way["highway"](${bbox});
  way["building"](${bbox});
  way["waterway"](${bbox});
  way["barrier"](${bbox});
  way["aeroway"](${bbox});
  way["man_made"](${bbox});
  way["public_transport"](${bbox});
  way["power"](${bbox});
  way["military"](${bbox});
  way["historic"](${bbox});
  way["tourism"](${bbox});
  way["amenity"](${bbox});
  way["landuse"](${bbox});
  way["natural"](${bbox});
  way["leisure"](${bbox});
  way["water"](${bbox});
  way["wetland"](${bbox});
  way["surface"](${bbox});
  way["area"="yes"](${bbox});
  way["landcover"](${bbox});

  relation["building"](${bbox});
  relation["waterway"](${bbox});
  relation["aeroway"](${bbox});
  relation["man_made"](${bbox});
  relation["military"](${bbox});
  relation["historic"](${bbox});
  relation["tourism"](${bbox});
  relation["amenity"](${bbox});
  relation["landuse"](${bbox});
  relation["natural"](${bbox});
  relation["leisure"](${bbox});
  relation["water"](${bbox});
  relation["wetland"](${bbox});
  relation["landcover"](${bbox});

  node["natural"="tree"](${bbox});
  node["natural"="tree_row"](${bbox});
  way["natural"="tree_row"](${bbox});
  node["natural"="shrub"](${bbox});
  node["highway"="street_lamp"](${bbox});
  node["barrier"="bollard"](${bbox});
  node["amenity"="bench"](${bbox});
);
out body geom;
`;
};

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
    tags.building || tags.landuse || tags.landcover || tags.water ||
    tags.leisure || tags.golf || tags.recreation || tags.natural ||
    tags.amenity || tags.aeroway || tags.tourism || tags.man_made ||
    tags.public_transport || tags.power || tags.military ||
    tags.place || tags.historic || tags.wetland || tags.surface || tags.material
  );
};

const joinWays = (wayNodesList) => {
  if (wayNodesList.length === 0) return [];
  const rings = [];
  const makeKey = (node) => `${node.lat},${node.lng}`;
  const pool = wayNodesList.map((w, i) => ({ nodes: [...w], id: i }));
  const alive = new Set(pool.map((_, i) => i));
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
      if (sk === ek && ring.nodes.length > 2) break;

      const endMatches = startIndex.get(ek);
      if (endMatches) {
        for (const idx of endMatches) {
          if (!alive.has(idx)) continue;
          const way = pool[idx];
          alive.delete(idx); removeFromIndex(idx, way);
          ring.nodes.push(...way.nodes.slice(1));
          changed = true; break;
        }
      }
      if (changed) continue;

      const endEndMatches = endIndex.get(ek);
      if (endEndMatches) {
        for (const idx of endEndMatches) {
          if (!alive.has(idx)) continue;
          const way = pool[idx];
          alive.delete(idx); removeFromIndex(idx, way);
          way.nodes.reverse();
          ring.nodes.push(...way.nodes.slice(1));
          changed = true; break;
        }
      }
      if (changed) continue;

      const startMatches = endIndex.get(sk);
      if (startMatches) {
        for (const idx of startMatches) {
          if (!alive.has(idx)) continue;
          const way = pool[idx];
          alive.delete(idx); removeFromIndex(idx, way);
          ring.nodes.unshift(...way.nodes.slice(0, -1));
          changed = true; break;
        }
      }
      if (changed) continue;

      const startStartMatches = startIndex.get(sk);
      if (startStartMatches) {
        for (const idx of startStartMatches) {
          if (!alive.has(idx)) continue;
          const way = pool[idx];
          alive.delete(idx); removeFromIndex(idx, way);
          way.nodes.reverse();
          ring.nodes.unshift(...way.nodes.slice(0, -1));
          changed = true; break;
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

  for (const el of data.elements) {
    if (el.type === "node") {
      if (el.tags) {
        if (el.tags.natural === "tree" || el.tags.natural === "tree_row") {
          const tags = el.tags.natural === "tree_row"
            ? { ...el.tags, tree_row: "yes", source_feature: "tree_row" }
            : el.tags;
          rawFeatures.push({
            id: el.id.toString(), type: "vegetation",
            geometry: [{ lat: el.lat, lng: el.lon }], tags,
          });
        } else if (
          el.tags.highway === "street_lamp" ||
          el.tags.barrier === "bollard" ||
          el.tags.amenity === "bench" ||
          el.tags.traffic_sign ||
          el.tags.highway === "give_way"
        ) {
          rawFeatures.push({
            id: el.id.toString(), type: "street_furniture",
            geometry: [{ lat: el.lat, lng: el.lon }], tags: el.tags,
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
      if (el.members) {
        el.members.forEach((m) => {
          if (m.type === "way" && m.geometry && !ways[m.ref]) {
            ways[m.ref] = { id: m.ref, nodes: convertGeom(m.geometry), tags: {} };
          }
        });
      }
    }
  }

  for (const r of relations) {
    const tags = r.tags || {};
    if (!r.members) continue;
    const isRoute = tags.type === "route" || tags.type === "superroute" || !!tags.highway || !!tags.network;
    const isSite = tags.type === "site" || !!tags.historic || tags.type === "heritage";
    if (isRoute || isSite) {
      r.members.forEach((m) => {
        if (m.type === "way" && ways[m.ref]) {
          const w = ways[m.ref];
          ["highway", "name", "surface", "layer", "bridge", "tunnel"].forEach((prop) => {
            if (!w.tags[prop] && tags[prop]) w.tags[prop] = tags[prop];
          });
        }
      });
    }
  }

  const getFeatureType = (tags) => {
    if (tags.man_made === "bridge" && !tags.highway) return "bridge_infra";
    if (!!tags.building || ["castle", "fort", "monastery", "tower", "ruins"].includes(tags.historic)) return "building";
    if (tags.natural === "coastline") return "coastline";
    if (
      tags.natural === "water" || tags.waterway ||
      tags.landuse === "reservoir" || tags.landuse === "basin" ||
      tags.leisure === "marina" || tags.water === "harbour" ||
      tags.water === "dock" || tags.harbour === "yes"
    ) return "water";
    if (tags.barrier) return "barrier";
    if (
      tags.landuse || tags.leisure || tags.natural || tags.amenity ||
      tags.aeroway || tags.tourism || tags.man_made || tags.public_transport ||
      tags.power || tags.military || tags.place || tags.historic ||
      tags.wetland || tags.surface || tags.material || tags.golf || tags.recreation
    ) return "landuse";
    return null;
  };

  for (const r of relations) {
    const tags = r.tags || {};
    if (tags.type === "route" || tags.type === "superroute") continue;
    const type = getFeatureType(tags);
    if (type && r.members) {
      const outerWays = r.members
        .filter((m) => m.type === "way" && (m.role === "outer" || !m.role))
        .map((m) => ways[m.ref]).filter(Boolean);
      const innerWays = r.members
        .filter((m) => m.type === "way" && m.role === "inner")
        .map((m) => ways[m.ref]).filter(Boolean);
      outerWays.forEach((w) => { if (!w.tags.highway && !w.tags.barrier) consumedWayIds.add(w.id); });
      const outerRings = joinWays(outerWays.map((w) => w.nodes));
      const innerRings = joinWays(innerWays.map((w) => w.nodes));
      for (const outer of outerRings) {
        rawFeatures.push({
          id: `rel_${r.id}`, type, geometry: outer,
          holes: innerRings.length > 0 ? innerRings : undefined, tags,
        });
      }
    }
  }

  const coastlineWaysToJoin = [];

  for (const idStr in ways) {
    const id = parseInt(idStr);
    const w = ways[id];
    const tags = w.tags;

    if (tags.highway) {
      // Keep original way geometry. Aggressive signature-based joining can produce
      // long discontinuous polylines across intersections/branches.
      rawFeatures.push({ id: id.toString(), type: "road", geometry: w.nodes, tags });
    } else if (tags.natural === "tree_row") {
      const nodes = w.nodes;
      for (let i = 0; i < nodes.length - 1; i++) {
        const p1 = nodes[i], p2 = nodes[i + 1];
        const dLat = (p2.lat - p1.lat) * 111000;
        const dLng = (p2.lng - p1.lng) * 111000 * Math.cos((p1.lat * Math.PI) / 180);
        const dist = Math.sqrt(dLat * dLat + dLng * dLng);
        const numTrees = Math.floor(dist / 8);
        for (let j = 0; j <= numTrees; j++) {
          const t = j / (numTrees || 1);
          rawFeatures.push({
            id: `${id}_tree_${i}_${j}`, type: "vegetation",
            geometry: [{ lat: p1.lat + (p2.lat - p1.lat) * t, lng: p1.lng + (p2.lng - p1.lng) * t }],
            tags: { natural: "tree", tree_row: "yes", source_feature: "tree_row" },
          });
        }
      }
    } else if (!consumedWayIds.has(id)) {
      const type = getFeatureType(tags);
      if (type) {
        if (type === "coastline") { coastlineWaysToJoin.push(w); continue; }
        let nodes = w.nodes;
        let areaLike = isAreaLikeWay(tags, nodes);
        if (!areaLike && nodes.length >= 3) {
          const inherentlyArea =
            tags.natural === "beach" || tags.natural === "sand" ||
            tags.natural === "bare_rock" || tags.natural === "rock" ||
            tags.natural === "scree" || tags.natural === "shingle" ||
            tags.natural === "scrub" || tags.natural === "wetland" ||
            tags.natural === "wood" || tags.leisure === "park" ||
            tags.leisure === "garden" || tags.leisure === "beach_resort" ||
            tags.landuse;
          if (inherentlyArea && !tags.highway && !tags.barrier) {
            nodes = [...nodes, nodes[0]];
            areaLike = true;
          }
        }
        const linearWaterway = type === "water" && !!tags.waterway && !areaLike;
        if (!areaLike && !linearWaterway && type !== "road" && type !== "barrier") continue;
        rawFeatures.push({ id: id.toString(), type, geometry: nodes, tags });
      }
    }
  }

  if (coastlineWaysToJoin.length > 0) {
    const joinedCoastlines = joinWays(coastlineWaysToJoin.map((w) => w.nodes));
    joinedCoastlines.forEach((geometry, index) => {
      if (geometry.length > 1) {
        rawFeatures.push({ id: `coastline_joined_${index}`, type: "coastline", geometry, tags: { natural: "coastline" } });
      }
    });
  }

  const clippedFeatures = [];
  for (const f of rawFeatures) {
    if (f.geometry.length === 1) {
      const p = f.geometry[0];
      if (p.lat >= bounds.south && p.lat <= bounds.north && p.lng >= bounds.west && p.lng <= bounds.east) {
        clippedFeatures.push(f);
      }
      continue;
    }
    const isLinearWaterway = f.type === "water" && !!f.tags?.waterway && f.tags?.area !== "yes" && !isClosedRing(f.geometry);
    if (f.type === "road" || f.type === "barrier" || f.type === "coastline" || isLinearWaterway) {
      const clippedSegments = clipLineString(f.geometry, bounds);
      clippedSegments.forEach((segment, index) => {
        if (segment.length > 1) {
          clippedFeatures.push({ ...f, id: `${f.id}_seg_${index}`, geometry: segment });
        }
      });
    } else {
      const clippedPoly = clipPolygon(f.geometry, bounds);
      if (clippedPoly.length > 2) {
        const clippedHoles = [];
        if (f.holes) {
          for (const hole of f.holes) {
            const clippedHole = clipPolygon(hole, bounds);
            if (clippedHole.length > 2) clippedHoles.push(clippedHole);
          }
        }
        clippedFeatures.push({ ...f, geometry: clippedPoly, holes: clippedHoles.length > 0 ? clippedHoles : undefined });
      }
    }
  }

  const isPointInPolygon = (point, vs) => {
    let x = point.lng, y = point.lat, inside = false;
    for (let i = 0, j = vs.length - 1; i < vs.length; j = i++) {
      const xi = vs[i].lng, yi = vs[i].lat;
      const xj = vs[j].lng, yj = vs[j].lat;
      if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
  };

  const proceduralTrees = [];
  for (const f of clippedFeatures) {
    const tags = f.tags || {};
    const isWood = tags.natural === "wood" || tags.landuse === "forest" || tags.natural === "scrub";
    const isWetland = tags.natural === "wetland" || tags.wetland;
    if ((isWood || isWetland) && f.geometry.length > 2) {
      let minLat = 90, maxLat = -90, minLng = 180, maxLng = -180;
      f.geometry.forEach((p) => {
        if (p.lat < minLat) minLat = p.lat;
        if (p.lat > maxLat) maxLat = p.lat;
        if (p.lng < minLng) minLng = p.lng;
        if (p.lng > maxLng) maxLng = p.lng;
      });
      const widthM = (maxLng - minLng) * 111000 * Math.cos((minLat * Math.PI) / 180);
      const heightM = (maxLat - minLat) * 111000;
      const areaM2 = Math.abs(widthM * heightM * 0.5);
      let treeSpacing = tags.natural === "scrub" ? 20 : isWetland ? 25 : 12;
      const treeCount = Math.min(2000, Math.floor(areaM2 / (treeSpacing * treeSpacing)));
      for (let i = 0; i < treeCount; i++) {
        const pt = { lat: minLat + Math.random() * (maxLat - minLat), lng: minLng + Math.random() * (maxLng - minLng) };
        if (isPointInPolygon(pt, f.geometry)) {
          let inHole = false;
          if (f.holes) {
            for (const hole of f.holes) {
              if (isPointInPolygon(pt, hole)) { inHole = true; break; }
            }
          }
          if (!inHole) {
            proceduralTrees.push({
              id: `${f.id}_proc_tree_${i}`, type: "vegetation",
              geometry: [{ lat: pt.lat, lng: pt.lng }],
              tags: { natural: "tree", procedurally_generated: "yes" },
            });
          }
        }
      }
    }
  }

  return [...clippedFeatures, ...proceduralTrees];
};

// --- Endpoint Fetcher ---

// Fires all endpoints simultaneously; first successful response wins and
// all others are aborted.
const fetchWithAbort = async (endpoint, query, signal) => {
  return fetch(endpoint, {
    method: "POST",
    body: `data=${encodeURIComponent(query)}`,
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    signal,
  }).then(async (response) => {
    if (!response.ok) {
      throw new Error(`HTTP ${response.status} ${response.statusText}`);
    }
    const rawText = await response.text();
    let data;
    try {
      data = JSON.parse(rawText);
    } catch (e) {
      throw new Error(`Non-JSON response from ${endpoint}: ${rawText.slice(0, 200)}`);
    }
    return { endpoint, data };
  });
};

const raceEndpoints = (endpoints, query) => {
  return new Promise((resolve, reject) => {
    const controllers = endpoints.map(() => new AbortController());
    let settled = false;
    let failCount = 0;
    const errors = [];

    endpoints.forEach((endpoint, i) => {
      fetchWithAbort(endpoint, query, controllers[i].signal)
        .then((result) => {
          if (settled) return;
          settled = true;
          controllers.forEach((c, j) => { if (j !== i) c.abort(); });
          resolve(result);
        })
        .catch((err) => {
          if (err.name === "AbortError") return;
          errors.push(`${endpoint}: ${err.message}`);
          failCount++;
          if (failCount === endpoints.length && !settled) {
            settled = true;
            reject(new Error(`All endpoints failed:\n${errors.join("\n")}`));
          }
        });
    });
  });
};

export const fetchOSMData = async (bounds) => {
  console.log(`[OSM] Fetching data for bounds: N:${bounds.north}, S:${bounds.south}, E:${bounds.east}, W:${bounds.west}`);

  const query = buildQuery(bounds);
  const queryParams = getOSMQueryParameters(bounds);
  const startedAt = new Date().toISOString();

  // Shuffle endpoints so no single mirror always gets hammered first
  const shuffled = [...OVERPASS_ENDPOINTS].sort(() => Math.random() - 0.5);

  try {
    const { endpoint, data } = await raceEndpoints(shuffled, query);

    console.log(`[OSM] Winner: ${endpoint} — ${data.elements?.length || 0} elements`);

    lastOSMRequestInfo = {
      ...queryParams,
      endpointUsed: endpoint,
      elementCount: data.elements?.length || 0,
      startedAt,
      completedAt: new Date().toISOString(),
    };

    const features = parseOverpassResponse(data, bounds);
    console.log(`[OSM] Parsed ${features.length} features.`);
    return features;

  } catch (error) {
    console.error("[OSM] All endpoints failed:", error.message);
    lastOSMRequestInfo = {
      ...queryParams,
      endpointUsed: null,
      error: error.message,
      startedAt,
      completedAt: new Date().toISOString(),
    };
    return [];
  }
};