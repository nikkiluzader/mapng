/**
 * The Overpass query MapNG sends, shared by the browser (services/osm.js) and
 * the Cloudflare Worker's cached /api/osm endpoint (worker.js), so both ask
 * for exactly the same data.
 *
 * Bump OVERPASS_QUERY_VERSION whenever the query changes: it is part of the
 * Worker's cache key, so stale answers to an old query are never served.
 */
export const OVERPASS_QUERY_VERSION = 1;

// Public Overpass mirrors (volunteer-run; any of them may be down).
export const OVERPASS_ENDPOINTS = [
  "https://lz4.overpass-api.de/api/interpreter",
  "https://overpass-api.de/api/interpreter",
  "https://overpass.private.coffee/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
  "https://overpass.openstreetmap.ru/api/interpreter",
];

// Cached requests are snapped outward to this grid (degrees, ~550 m of
// latitude) so repeated and nearby selections share one cache entry; the
// client clips the answer back to its exact bounds.
export const OSM_CACHE_GRID_DEG = 0.005;

// The Worker refuses bigger boxes (it is not a general Overpass proxy).
export const OSM_CACHE_MAX_AREA_DEG2 = 0.25;

const snapDown = (v, step) => Math.floor(v / step + 1e-9) * step;
const snapUp = (v, step) => Math.ceil(v / step - 1e-9) * step;
const round6 = (v) => Math.round(v * 1e6) / 1e6;

/**
 * Bounds snapped outward to OSM_CACHE_GRID_DEG, or null when the box is
 * invalid or larger than OSM_CACHE_MAX_AREA_DEG2 after snapping.
 */
export const snapOsmBounds = (bounds, step = OSM_CACHE_GRID_DEG) => {
  const { south, west, north, east } = bounds || {};
  if (![south, west, north, east].every(Number.isFinite)) return null;
  if (south >= north || west >= east) return null;
  if (south < -90 || north > 90 || west < -180 || east > 180) return null;
  const snapped = {
    south: round6(Math.max(-90, snapDown(south, step))),
    west: round6(Math.max(-180, snapDown(west, step))),
    north: round6(Math.min(90, snapUp(north, step))),
    east: round6(Math.min(180, snapUp(east, step))),
  };
  const area = (snapped.north - snapped.south) * (snapped.east - snapped.west);
  return area <= OSM_CACHE_MAX_AREA_DEG2 ? snapped : null;
};

export const buildOverpassQuery = (bounds) => {
  const bbox = `${bounds.south},${bounds.west},${bounds.north},${bounds.east}`;

  // Timeout is 30s, matching the timeoutSec that getOSMQueryParameters advertises
  // and records into export metadata.
  // Maxsize reduced to 128 MB — 512 MB was triggering server-side rejection.
  // Query trimmed: removed redundant/rare keys (seamark, tidal, harbour subtypes,
  // vegetation, crop, orchard, vineyard, material) that overlap with natural/landuse
  // and add significant response weight with minimal 3D rendering value.
  return `
[out:json][timeout:30][maxsize:134217728];
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
  node["amenity"="fuel"](${bbox});
  node["amenity"="charging_station"](${bbox});
  node["man_made"="fuel_pump"](${bbox});
  node["highway"="traffic_signals"](${bbox});
  node["highway"="stop"](${bbox});
  node["highway"="give_way"](${bbox});
  node["highway"="street_lamp"](${bbox});
  node["barrier"="bollard"](${bbox});
  node["amenity"="bench"](${bbox});
);
out body geom;
`;
};
