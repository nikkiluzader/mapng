import {
  OVERPASS_ENDPOINTS,
  buildOverpassQuery,
} from "./overpassQuery.js";
import { fetchOsmFromTiles, resolveOsmTileArchiveUrl } from "./osmTiles.js";
import {
  OVERTURE_ATTRIBUTION, OVERTURE_RELEASE, fetchOsmFromOverture, fetchOvertureBuildingRecords, mergeOvertureBuildings,
} from "./overtureTiles.js";

const OVERTURE_ENDPOINT = "overture-maps";

// "Add missing buildings and heights from Overture" (on unless turned off):
// live OSM buildings get Overture's heights and the footprints OSM lacks.
export const OVERTURE_BUILDINGS_STORAGE_KEY = "mapng_overtureBuildings";
const overtureBuildingsEnabled = () => {
  try {
    return globalThis.localStorage?.getItem(OVERTURE_BUILDINGS_STORAGE_KEY) !== "false";
  } catch {
    return true;
  }
};

// MapNG's own OSM tiles (services/osmTiles.js) are read first: an explicit
// source (VITE_OSM_TILES_URL / setOsmTileSource), else on the deployed site
// the archive the Worker's manifest lists for the area. Overpass (edge cache,
// then mirrors) covers everything else.
let osmTileSource = import.meta.env?.VITE_OSM_TILES_URL || null;

/** Point OSM reads at a PMTiles archive URL / pmtiles Source (null: off). */
export const setOsmTileSource = (source) => { osmTileSource = source || null; };

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

export const parseOverpassResponse = (data, bounds) => {
  const ways = {};
  const relations = [];
  const rawFeatures = [];
  const consumedWayIds = new Set();

  for (const el of data.elements) {
    if (el.type === "node") {
      if (el.tags) {
        if (el.tags.traffic_calming && el.tags.traffic_calming !== "no") {
          // speed bumps, humps, tables, cushions (services/trafficCalming.js)
          rawFeatures.push({
            id: el.id.toString(), type: "traffic_calming",
            geometry: [{ lat: el.lat, lng: el.lon }], tags: el.tags,
          });
        } else if (el.tags.natural === "tree" || el.tags.natural === "tree_row") {
          const tags = el.tags.natural === "tree_row"
            ? { ...el.tags, tree_row: "yes", source_feature: "tree_row" }
            : el.tags;
          rawFeatures.push({
            id: el.id.toString(), type: "vegetation",
            geometry: [{ lat: el.lat, lng: el.lon }], tags,
          });
        } else if (
          el.tags.highway === "traffic_signals" ||
          el.tags.highway === "stop" ||
          el.tags.highway === "street_lamp" ||
          el.tags.barrier === "bollard" ||
          el.tags.amenity === "bench" ||
          el.tags.emergency === "fire_hydrant" ||
          el.tags.amenity === "waste_basket" ||
          el.tags.power === "pole" ||
          el.tags.traffic_sign ||
          el.tags.highway === "give_way"
        ) {
          rawFeatures.push({
            id: el.id.toString(), type: "street_furniture",
            geometry: [{ lat: el.lat, lng: el.lon }], tags: el.tags,
          });
        } else if (el.tags.amenity === "fuel" || el.tags.amenity === "charging_station") {
          rawFeatures.push({
            id: el.id.toString(), type: "fuel_station",
            geometry: [{ lat: el.lat, lng: el.lon }], tags: el.tags,
          });
        } else if (el.tags.man_made === "fuel_pump") {
          rawFeatures.push({
            id: el.id.toString(), type: "fuel_pump",
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
    // a multipolygon's highway=* is an area (a plaza), not a route over its
    // outline ways (a pool's edge became a pedestrian street)
    const isRoute = tags.type !== "multipolygon"
      && (tags.type === "route" || tags.type === "superroute" || !!tags.highway || !!tags.network);
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
    } else if (!consumedWayIds.has(id) && (tags.power === "minor_line" || tags.power === "line") && !isClosedRing(w.nodes)) {
      // Overhead power lines: a pole (or tower) at every vertex (streetProps.js).
      rawFeatures.push({ id: id.toString(), type: "power_line", geometry: w.nodes, tags });
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
    if (f.type === "road" || f.type === "barrier" || f.type === "coastline" || f.type === "power_line" || isLinearWaterway) {
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

  // Fuel/charging stations are frequently mapped as areas (ways/relations) rather
  // than nodes. Those arrive here as polygon features tagged amenity=fuel. Derive a
  // centroid `fuel_station` point from each so the export has a single placement
  // anchor regardless of how the station was mapped. The original polygon is kept
  // (it still renders as a ground landuse patch).
  const derivedFuelStations = [];
  for (const f of clippedFeatures) {
    const tags = f.tags || {};
    const isStationArea =
      (tags.amenity === "fuel" || tags.amenity === "charging_station") &&
      f.type !== "fuel_station" &&
      Array.isArray(f.geometry) &&
      f.geometry.length > 2;
    if (!isStationArea) continue;
    let sumLat = 0, sumLng = 0;
    for (const p of f.geometry) { sumLat += p.lat; sumLng += p.lng; }
    const n = f.geometry.length;
    derivedFuelStations.push({
      id: `${f.id}_station`, type: "fuel_station",
      geometry: [{ lat: sumLat / n, lng: sumLng / n }],
      tags: { ...tags, source_feature: "area" },
    });
  }

  // Suppress generic extruded buildings that belong to a filling station, since
  // the BeamNG export places a dedicated in-game pump/canopy asset there instead.
  // A building is "part of a station" if it is itself tagged amenity=fuel/
  // charging_station, or it shares a fuel station's brand/name within ~60 m (which
  // catches the attached convenience store/shop without touching unrelated
  // buildings nearby).
  const fuelAnchors = [
    ...clippedFeatures.filter((f) => f.type === "fuel_station"),
    ...derivedFuelStations,
  ].map((f) => ({ pt: f.geometry[0], tags: f.tags || {} }));

  const brandKey = (t = {}) => String(t.brand || t.name || "").trim().toLowerCase();
  const STATION_BUILDING_RADIUS_M = 60;

  const isFuelStationBuilding = (f) => {
    if (f.type !== "building" || !Array.isArray(f.geometry) || f.geometry.length < 3) return false;
    const t = f.tags || {};
    if (t.amenity === "fuel" || t.amenity === "charging_station") return true;
    const bk = brandKey(t);
    if (!bk) return false;
    let sumLat = 0, sumLng = 0;
    for (const p of f.geometry) { sumLat += p.lat; sumLng += p.lng; }
    const c = { lat: sumLat / f.geometry.length, lng: sumLng / f.geometry.length };
    for (const a of fuelAnchors) {
      if (!a.pt || brandKey(a.tags) !== bk) continue;
      const dy = (c.lat - a.pt.lat) * 111000;
      const dx = (c.lng - a.pt.lng) * 111000 * Math.cos((c.lat * Math.PI) / 180);
      if (Math.hypot(dx, dy) <= STATION_BUILDING_RADIUS_M) return true;
    }
    return false;
  };

  const featuresWithoutStationBuildings = clippedFeatures.filter((f) => !isFuelStationBuilding(f));

  return [...featuresWithoutStationBuildings, ...proceduralTrees, ...derivedFuelStations];
};

// --- Endpoint Fetcher ---
//
// Overpass mirrors are volunteer servers that go down or rate-limit without
// warning (2026-10-19: overpass-api.de refusing connections, three others
// timing out, only kumi answering). Instead of firing the full query at every
// mirror on every generate:
//   - mirrors are tried healthiest first, from a small health record kept in
//     localStorage (last success, latency, cool-down after a failure), so a
//     mirror that just failed is skipped next time instead of timing out again;
//   - the next mirror starts as soon as one fails, or after HEDGE_DELAY_MS
//     with no answer (at most MAX_IN_FLIGHT at once), and the first good
//     response aborts the rest;
//   - each attempt and the whole fetch have a deadline, and an all-failed
//     round caused by rate limits / gateway timeouts is retried once.

const MIRROR_HEALTH_KEY = "mapng_overpass_health_v1";
const HEDGE_DELAY_MS = 6000;
// Our Worker's edge cache (worker.js handleOsm) is tried first. A cache miss
// waits on a mirror upstream, so it gets longer before direct mirrors start.
const OSM_CACHE_PATH = "/api/osm";
const CACHE_HEDGE_DELAY_MS = 25000;
const isCacheEndpoint = (endpoint) => endpoint === OSM_CACHE_PATH;
// User's own Overpass server (e.g. a paid Tracestrack/Overspan key embedded in
// the URL). Stands in the mirror list as a sentinel so the key never reaches
// logs, status text or export metadata.
export const CUSTOM_OVERPASS_STORAGE_KEY = "mapng_customOverpassUrl";
const CUSTOM_ENDPOINT = "custom-overpass";
const readCustomOverpassUrl = () => {
  try {
    const url = new URL(String(globalThis.localStorage?.getItem(CUSTOM_OVERPASS_STORAGE_KEY) || "").trim());
    return url.protocol === "https:" ? url.href : null;
  } catch {
    return null;
  }
};
// Only on the deployed site (same-origin Worker); not in node or file://.
const cacheEndpointAvailable = () => /^https?:$/.test(globalThis.location?.protocol || "");
const MAX_IN_FLIGHT = 3;
const ATTEMPT_TIMEOUT_MS = 60000;   // server-side [timeout:30] + transfer
const OVERALL_DEADLINE_MS = 150000;
const COOLDOWN_MS = { network: 10 * 60000, timeout: 10 * 60000, rate_limit: 2 * 60000, http: 5 * 60000 };
const RETRY_DELAY_MS = 5000;

const readMirrorHealth = () => {
  try {
    const raw = globalThis.localStorage?.getItem(MIRROR_HEALTH_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
};

const writeMirrorHealth = (health) => {
  try {
    globalThis.localStorage?.setItem(MIRROR_HEALTH_KEY, JSON.stringify(health));
  } catch {
    // Private mode / blocked storage: health just isn't remembered.
  }
};

const recordMirrorResult = (endpoint, result) => {
  const health = readMirrorHealth();
  const prev = health[endpoint] || {};
  health[endpoint] = result.ok
    ? { okAt: Date.now(), latencyMs: result.latencyMs }
    : { ...prev, failAt: Date.now(), failKind: result.kind, coolUntil: Date.now() + (COOLDOWN_MS[result.kind] ?? COOLDOWN_MS.http) };
  writeMirrorHealth(health);
  if (OVERPASS_ENDPOINTS.includes(endpoint)) {
    globalThis.dispatchEvent?.(new Event(OVERPASS_STATUS_EVENT));
  }
};

// True while every public mirror is cooling down after a failure (the outage
// banner in the UI listens for OVERPASS_STATUS_EVENT and re-checks this).
export const OVERPASS_STATUS_EVENT = "mapng:overpass-status";
export const publicOverpassMirrorsDown = (health = readMirrorHealth(), now = Date.now()) =>
  OVERPASS_ENDPOINTS.every((e) => (health[e]?.coolUntil || 0) > now);

// Pre-flight check on page load: a trivial query to every public mirror at
// once, stopping at the first answer. Results feed the same health record
// the fetch path uses. Throttled so reloads don't re-probe volunteer servers.
const PROBE_AT_KEY = "mapng_overpass_probe_at";
const PROBE_INTERVAL_MS = 5 * 60000;
const PROBE_TIMEOUT_MS = 10000;
const PROBE_QUERY = "[out:json][timeout:5];node(1);out ids;";

export const probePublicOverpassMirrors = async ({ force = false } = {}) => {
  try {
    const last = Number(globalThis.localStorage?.getItem(PROBE_AT_KEY)) || 0;
    if (!force && Date.now() - last < PROBE_INTERVAL_MS) return;
    globalThis.localStorage?.setItem(PROBE_AT_KEY, String(Date.now()));
  } catch {
    // Storage blocked: probe anyway.
  }
  const controllers = OVERPASS_ENDPOINTS.map(() => new AbortController());
  let answered = false;
  await Promise.allSettled(OVERPASS_ENDPOINTS.map(async (endpoint, i) => {
    const startedAt = Date.now();
    const timer = setTimeout(() => controllers[i].abort(), PROBE_TIMEOUT_MS);
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        body: `data=${encodeURIComponent(PROBE_QUERY)}`,
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        signal: controllers[i].signal,
      });
      if (!response.ok) {
        const error = new Error(`HTTP ${response.status}`);
        error.status = response.status;
        throw error;
      }
      await response.json();
      answered = true;
      controllers.forEach((c, j) => { if (j !== i) c.abort(); });
      recordMirrorResult(endpoint, { ok: true, latencyMs: Date.now() - startedAt });
    } catch (err) {
      if (answered) return;                    // cancelled because another mirror answered
      const timedOut = controllers[i].signal.aborted;
      recordMirrorResult(endpoint, { ok: false, kind: classifyMirrorError(err, timedOut) });
    } finally {
      clearTimeout(timer);
    }
  }));
};

/**
 * Endpoints in the order to try them: healthy mirrors by recent success and
 * latency, unknown ones shuffled (spreads load), cooling-down ones last.
 */
export const orderOverpassEndpoints = (endpoints, health = readMirrorHealth(), now = Date.now()) => {
  const rank = (e) => {
    const h = health[e] || {};
    if (h.coolUntil && h.coolUntil > now) return [2, h.coolUntil];
    if (h.okAt && (!h.failAt || h.okAt > h.failAt)) return [0, h.latencyMs ?? 0];
    return [1, Math.random()];
  };
  return endpoints
    .map((e) => ({ e, r: rank(e) }))
    .sort((a, b) => a.r[0] - b.r[0] || a.r[1] - b.r[1])
    .map(({ e }) => e);
};

const classifyMirrorError = (err, timedOut) => {
  if (timedOut) return "timeout";
  if (err?.status === 429) return "rate_limit";
  if (err?.status) return "http";
  return "network";
};

const fetchWithAbort = async (endpoint, { query, bounds }, signal) => {
  const response = isCacheEndpoint(endpoint)
    ? await fetch(`${OSM_CACHE_PATH}?bbox=${bounds.south},${bounds.west},${bounds.north},${bounds.east}`, { signal })
    : await fetch(endpoint === CUSTOM_ENDPOINT ? readCustomOverpassUrl() : endpoint, {
      method: "POST",
      body: `data=${encodeURIComponent(query)}`,
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      signal,
    });
  if (!response.ok) {
    const error = new Error(`HTTP ${response.status} ${response.statusText}`);
    error.status = response.status;
    throw error;
  }
  const rawText = await response.text();
  let data;
  try {
    data = JSON.parse(rawText);
  } catch {
    // Overpass reports server-side timeouts / memory limits as HTML or an
    // XML remark with a 200; treat those like a gateway timeout.
    const error = new Error(`Non-JSON response from ${endpoint}: ${rawText.slice(0, 200)}`);
    error.status = 504;
    throw error;
  }
  return { endpoint, data };
};

const mirrorName = (endpoint) => {
  if (isCacheEndpoint(endpoint)) return "the MapNG cache";
  if (endpoint === CUSTOM_ENDPOINT) return "your Overpass server";
  try {
    return new URL(endpoint).host;
  } catch {
    return endpoint;
  }
};

/**
 * Try mirrors in order with hedging; resolves with the first good response.
 * Rejects with { errors, retryable } when every mirror failed.
 */
const hedgedFetch = (endpoints, request, { onStatus, signal, deadlineAt }) => new Promise((resolve, reject) => {
  const attempts = [];
  const errors = [];
  let next = 0;
  let settled = false;
  let inFlight = 0;
  let hedgeTimer = null;
  let deadlineTimer = null;

  const finish = (fn, value) => {
    if (settled) return;
    settled = true;
    clearTimeout(hedgeTimer);
    clearTimeout(deadlineTimer);
    signal?.removeEventListener?.("abort", onAbort);
    for (const a of attempts) { clearTimeout(a.timer); a.controller.abort(); }
    fn(value);
  };
  const onAbort = () => finish(reject, signal.reason ?? new DOMException("Aborted", "AbortError"));
  if (signal?.aborted) { onAbort(); return; }
  signal?.addEventListener?.("abort", onAbort, { once: true });

  const scheduleHedge = () => {
    clearTimeout(hedgeTimer);
    const delay = next > 0 && (isCacheEndpoint(endpoints[next - 1]) || endpoints[next - 1] === CUSTOM_ENDPOINT) ? CACHE_HEDGE_DELAY_MS : HEDGE_DELAY_MS;
    if (next < endpoints.length) hedgeTimer = setTimeout(launch, delay);
  };

  const launch = () => {
    if (settled || next >= endpoints.length || inFlight >= MAX_IN_FLIGHT) return;
    const endpoint = endpoints[next++];
    const controller = new AbortController();
    const startedAt = Date.now();
    const attempt = { controller, timedOut: false, timer: null };
    attempt.timer = setTimeout(() => { attempt.timedOut = true; controller.abort(); }, ATTEMPT_TIMEOUT_MS);
    attempts.push(attempt);
    inFlight++;
    onStatus?.(`Fetching OpenStreetMap data from ${mirrorName(endpoint)} (mirror ${next}/${endpoints.length})...`);

    fetchWithAbort(endpoint, request, controller.signal)
      .then((result) => {
        clearTimeout(attempt.timer);
        recordMirrorResult(endpoint, { ok: true, latencyMs: Date.now() - startedAt });
        finish(resolve, result);
      })
      .catch((err) => {
        clearTimeout(attempt.timer);
        inFlight--;
        if (settled) return;                          // aborted because another mirror won
        const kind = classifyMirrorError(err, attempt.timedOut);
        recordMirrorResult(endpoint, { ok: false, kind });
        errors.push({ endpoint, kind, message: attempt.timedOut ? `no response in ${ATTEMPT_TIMEOUT_MS / 1000}s` : err.message });
        console.warn(`[OSM] ${mirrorName(endpoint)} failed (${kind}); trying the next mirror.`);
        if (next < endpoints.length) {
          launch();                                   // a failure frees a slot right away
          scheduleHedge();
        } else if (inFlight === 0) {
          finish(reject, { errors, retryable: errors.some((e) => e.kind === "rate_limit" || e.kind === "timeout" || e.kind === "http") });
        }
      });
  };

  deadlineTimer = setTimeout(() => {
    errors.push({ endpoint: "*", kind: "timeout", message: "overall deadline reached" });
    finish(reject, { errors, retryable: false });
  }, Math.max(0, deadlineAt - Date.now()));

  launch();
  scheduleHedge();
});

const fetchFromOverpass = async (request, { onStatus, signal } = {}) => {
  const deadlineAt = Date.now() + OVERALL_DEADLINE_MS;
  let lastFailure = null;
  for (let round = 0; round < 2; round++) {
    // A retry round ignores cool-downs: every mirror just failed anyway.
    let ordered = round === 0
      ? orderOverpassEndpoints(OVERPASS_ENDPOINTS)
      : [...OVERPASS_ENDPOINTS].sort(() => Math.random() - 0.5);
    if (round === 0 && cacheEndpointAvailable()) {
      const coolUntil = readMirrorHealth()[OSM_CACHE_PATH]?.coolUntil || 0;
      if (coolUntil <= Date.now()) ordered = [OSM_CACHE_PATH, ...ordered];
    }
    // A paid server goes first in every round, ignoring cool-downs.
    if (readCustomOverpassUrl()) ordered = [CUSTOM_ENDPOINT, ...ordered];
    try {
      return await hedgedFetch(ordered, request, { onStatus, signal, deadlineAt });
    } catch (failure) {
      if (failure?.name === "AbortError" || signal?.aborted) throw failure;
      lastFailure = failure;
      if (!failure?.retryable || Date.now() + RETRY_DELAY_MS >= deadlineAt) break;
      onStatus?.("OpenStreetMap mirrors are busy; retrying shortly...");
      await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
    }
  }
  const detail = (lastFailure?.errors || []).map((e) => `${e.endpoint}: ${e.message}`).join("\n");
  throw new Error(`All Overpass mirrors failed:\n${detail || String(lastFailure?.message || lastFailure)}`);
};

// Overture (services/overtureTiles.js: its own tiles, on a CDN that doesn't
// share Overpass's outages) as soon as it is the better bet, not after every
// mirror has timed out (six 60 s attempts during an outage): straight away
// while every public mirror is known down (no paid server set), else raced
// against Overpass once it has gone OVERTURE_HEDGE_MS without an answer;
// the first answer wins and the other is cancelled.
const OVERTURE_HEDGE_MS = 45000;

const fetchOverpassOrOverture = async (request, { onStatus, signal } = {}) => {
  const useOverture = async (why, innerSignal) => {
    console.warn(`[OSM] ${why}; using Overture Maps.`);
    onStatus?.(`OpenStreetMap servers are unavailable; using Overture Maps data (release ${OVERTURE_RELEASE})...`);
    const data = await fetchOsmFromOverture(request.bounds, { signal: innerSignal, onStatus });
    if (!data) throw new Error("Overture Maps returned no data");
    return { endpoint: OVERTURE_ENDPOINT, data };
  };
  if (!readCustomOverpassUrl() && publicOverpassMirrorsDown()) {
    try {
      return await useOverture("Every public Overpass mirror is down", signal);
    } catch (overtureError) {
      if (overtureError?.name === "AbortError" || signal?.aborted) throw overtureError;
      // (Overture failing too: try the mirrors anyway, they may be back)
    }
  }
  const overpassCtl = new AbortController();
  const overtureCtl = new AbortController();
  const onAbort = () => { overpassCtl.abort(); overtureCtl.abort(); };
  signal?.addEventListener?.("abort", onAbort, { once: true });
  let hedgeTimer = null;
  try {
    return await new Promise((resolve, reject) => {
      let overpassError = null; let overtureError = null; let overtureStarted = false; let done = false;
      const finish = (fn, value) => { if (done) return; done = true; clearTimeout(hedgeTimer); fn(value); };
      const startOverture = (why) => {
        if (overtureStarted || done) return;
        overtureStarted = true;
        useOverture(why, overtureCtl.signal).then(
          (r) => { overpassCtl.abort(); finish(resolve, r); },
          (e) => { overtureError = e; if (overpassError) finish(reject, overpassError); },
        );
      };
      fetchFromOverpass(request, { onStatus, signal: overpassCtl.signal }).then(
        (r) => { overtureCtl.abort(); finish(resolve, r); },
        (e) => {
          if (signal?.aborted) return finish(reject, e);
          overpassError = e;
          if (!overtureStarted) startOverture("Every Overpass server failed");
          else if (overtureError) finish(reject, e);
        },
      );
      hedgeTimer = setTimeout(() => startOverture(`No Overpass answer in ${OVERTURE_HEDGE_MS / 1000} s`), OVERTURE_HEDGE_MS);
    });
  } finally {
    clearTimeout(hedgeTimer);
    signal?.removeEventListener?.("abort", onAbort);
  }
};

export const fetchOSMData = async (bounds, { onStatus, signal } = {}) => {
  console.log(`[OSM] Fetching data for bounds: N:${bounds.north}, S:${bounds.south}, E:${bounds.east}, W:${bounds.west}`);

  const query = buildOverpassQuery(bounds);
  const queryParams = getOSMQueryParameters(bounds);
  const startedAt = new Date().toISOString();

  try {
    let result = null;
    const tileSource = osmTileSource || (cacheEndpointAvailable() ? await resolveOsmTileArchiveUrl(bounds) : null);
    if (tileSource) {
      try {
        onStatus?.("Reading OpenStreetMap data from MapNG tiles...");
        const data = await fetchOsmFromTiles(tileSource, bounds, { signal });
        if (data) result = { endpoint: "mapng-osm-tiles", data };
      } catch (tileError) {
        if (tileError?.name === "AbortError" || signal?.aborted) throw tileError;
        console.warn("[OSM] MapNG tiles unavailable, using Overpass:", tileError?.message || tileError);
      }
    }
    if (!result) result = await fetchOverpassOrOverture({ query, bounds }, { onStatus, signal });
    const { endpoint } = result;
    let { data } = result;

    console.log(`[OSM] Winner: ${endpoint} — ${data.elements?.length || 0} elements`);

    let overtureBuildings = null;
    if (endpoint !== OVERTURE_ENDPOINT && overtureBuildingsEnabled()) {
      onStatus?.("Adding missing buildings and heights from Overture Maps...");
      const records = await fetchOvertureBuildingRecords(bounds, { signal });
      if (records) {
        const merged = mergeOvertureBuildings(data, records, bounds);
        data = merged.data;
        overtureBuildings = { release: OVERTURE_RELEASE, heightsAdded: merged.heightsAdded, footprintsAdded: merged.footprintsAdded };
        console.log(`[OSM] Overture: heights on ${merged.heightsAdded} OSM buildings, ${merged.footprintsAdded} footprints OSM lacks.`);
      }
    }

    lastOSMRequestInfo = {
      ...queryParams,
      endpointUsed: endpoint,
      elementCount: data.elements?.length || 0,
      ...(endpoint === OVERTURE_ENDPOINT
        ? { overtureRelease: OVERTURE_RELEASE, attribution: OVERTURE_ATTRIBUTION }
        : {}),
      ...(overtureBuildings ? { overtureBuildings, attribution: OVERTURE_ATTRIBUTION } : {}),
      startedAt,
      completedAt: new Date().toISOString(),
    };

    const features = parseOverpassResponse(data, bounds);
    const fuelStations = features.filter((f) => f.type === "fuel_station").length;
    const fuelPumps = features.filter((f) => f.type === "fuel_pump").length;
    console.log(`[OSM] Parsed ${features.length} features (fuel stations: ${fuelStations}, fuel pumps: ${fuelPumps}).`);
    return features;

  } catch (error) {
    if (error?.name === "AbortError" || signal?.aborted) throw error;
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