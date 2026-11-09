/**
 * The Overpass query MapNG sends, shared by the browser (services/osm.js) and
 * the Cloudflare Worker's cached /api/osm endpoint (worker.js), so both ask
 * for exactly the same data.
 *
 * Bump OVERPASS_QUERY_VERSION whenever the query changes: it is part of the
 * Worker's cache key, so stale answers to an old query are never served.
 */
export const OVERPASS_QUERY_VERSION = 4;   // 2: traffic_calming nodes; 3: food, drink and lodging nodes; 4: railways

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

// What MapNG takes from OSM. One spec drives both the live Overpass query
// (buildOverpassQuery) and the offline tile builder
// (scripts/build-osm-tiles.py), so tiles and Overpass return the same data.
// Trimmed: seamark, tidal, harbour subtypes, vegetation, crop, orchard,
// vineyard, material overlap natural/landuse and add weight for little value.
// Gates, as nodes on a road or a fence (services/gates.js).
export const GATE_BARRIERS = [
  'gate', 'swing_gate', 'lift_gate', 'sliding_gate', 'hampshire_gate', 'wicket_gate', 'kissing_gate', 'bump_gate',
  'stile', 'entrance', 'cattle_grid', 'turnstile', 'full-height_turnstile',
];

// Food, drink and lodging, often mapped as a point inside the building
// rather than on its outline.
export const BUSINESS_NODES = [
  ...['restaurant', 'cafe', 'bar', 'pub', 'fast_food', 'biergarten', 'nightclub', 'ice_cream'].map((v) => ['amenity', v]),
  ...['hotel', 'motel', 'guest_house', 'hostel'].map((v) => ['tourism', v]),
];

// Active railways (services/railways.js: the kinds built as track; a subway
// in its tunnel is dropped there). The lifecycle values (abandoned, disused,
// razed, construction, proposed) are left out by asking for these alone.
export const RAILWAY_WAYS = ['rail', 'light_rail', 'subway', 'tram', 'narrow_gauge', 'monorail', 'funicular'];

export const OSM_FILTER = {
  wayKeys: [
    'highway', 'building', 'waterway', 'barrier', 'aeroway', 'man_made', 'public_transport',
    'power', 'military', 'historic', 'tourism', 'amenity', 'landuse', 'natural', 'leisure',
    'water', 'wetland', 'surface', 'landcover', 'golf',
  ],
  wayTags: [['area', 'yes'], ['natural', 'tree_row'], ...RAILWAY_WAYS.map((v) => ['railway', v])],
  relationKeys: [
    'building', 'waterway', 'aeroway', 'man_made', 'military', 'historic', 'tourism', 'amenity',
    'landuse', 'natural', 'leisure', 'water', 'wetland', 'landcover',
  ],
  nodeTags: [
    ['natural', 'tree'], ['natural', 'tree_row'], ['natural', 'shrub'],
    ['amenity', 'fuel'], ['amenity', 'charging_station'], ['man_made', 'fuel_pump'],
    ['highway', 'traffic_signals'], ['highway', 'stop'], ['highway', 'give_way'],
    ['highway', 'street_lamp'], ['barrier', 'bollard'], ['amenity', 'bench'],
    ['emergency', 'fire_hydrant'], ['amenity', 'waste_basket'], ['power', 'pole'],
    ['traffic_calming', 'bump'], ['traffic_calming', 'hump'], ['traffic_calming', 'table'], ['traffic_calming', 'cushion'],
    ['amenity', 'fountain'], ['amenity', 'drinking_water'],
    ...GATE_BARRIERS.map((v) => ['barrier', v]),
    // what a building is used for, mapped as a point inside it (beamngBuildings: its look)
    ...BUSINESS_NODES,
  ],
};

// (boxes: background areas leave only these parts of the square to ask for;
// the same filters per box, joined in one union)
export const buildOverpassQuery = (bounds, boxes = null) => {
  const bboxes = (Array.isArray(boxes) && boxes.length ? boxes : [bounds])
    .map((b) => `${b.south},${b.west},${b.north},${b.east}`);
  const lines = bboxes.flatMap((bbox) => [
    ...OSM_FILTER.wayKeys.map((k) => `way["${k}"](${bbox});`),
    ...OSM_FILTER.wayTags.map(([k, v]) => `way["${k}"="${v}"](${bbox});`),
    ...OSM_FILTER.relationKeys.map((k) => `relation["${k}"](${bbox});`),
    ...OSM_FILTER.nodeTags.map(([k, v]) => `node["${k}"="${v}"](${bbox});`),
  ]);
  // Timeout 30 s matches the timeoutSec getOSMQueryParameters records into
  // export metadata; 128 MB maxsize (512 MB triggered server-side rejection).
  return `
[out:json][timeout:30][maxsize:134217728];
(
  ${lines.join('\n  ')}
);
out body geom;
`;
};
