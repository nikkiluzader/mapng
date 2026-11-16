// Every address MapNG itself connects to, and what for. One list, used by:
//   - the page public/data.html (its table of exact addresses: tests/networkHosts.test.mjs keeps the two in step);
//   - the desktop app's Help > Network Activity window, which shows what was contacted in this session and marks
//     anything that is not on this list;
//   - the test that reads the code for addresses and fails when one is added without being listed here.
// A host starting with a dot stands for every name ending in it (".amazonaws.com": the buckets USGS hands out).
// Not on the list by design: the Overpass server a user sets as their own (their choice of address), and pages
// that only open in the user's browser when they click a link (LINKS_ONLY below).

export const NETWORK_KINDS = ['mapng', 'elevation', 'pictures', 'mapdata', 'search', 'landcover', 'trees', 'projection', 'updates', 'analytics'];

export const NETWORK_HOSTS = [
  // MapNG's own server (Cloudflare): its OSM tiles, relays, send codes, opt-in stats and reports
  { host: 'mapng.com', kind: 'mapng' },
  { host: 'dev.mapng.com', kind: 'mapng' },
  // elevation
  { host: 's3.amazonaws.com', kind: 'elevation', what: 'AWS Terrain Tiles (global 30 m)' },
  { host: 'tiles.mapterhorn.com', kind: 'elevation', what: 'Mapterhorn free lidar' },
  { host: 's3.opengeohub.org', kind: 'elevation', what: 'OpenGeoHub GEDTM30' },
  { host: 'tnmaccess.nationalmap.gov', kind: 'elevation', what: 'USGS: which lidar files cover an area' },
  { host: 'elevation.nationalmap.gov', kind: 'elevation', what: 'USGS 3DEP elevation' },
  { host: 's3-us-west-2.amazonaws.com', kind: 'elevation', what: 'USGS lidar point clouds (measured bridge heights)' },
  { host: '.amazonaws.com', kind: 'elevation', what: 'USGS download buckets named by its own answers' },
  { host: 'api.gpxz.io', kind: 'elevation', what: 'GPXZ, with your own key' },
  { host: 'mapy.geoportal.gov.pl', kind: 'elevation', what: 'GUGiK (Poland)' },
  { host: 'opendata.geoportal.gov.pl', kind: 'elevation', what: 'GUGiK (Poland)' },
  // satellite pictures and map backgrounds
  { host: 'server.arcgisonline.com', kind: 'pictures', what: 'Esri satellite imagery and map backgrounds' },
  { host: 'services.arcgisonline.com', kind: 'pictures', what: 'Esri map labels' },
  { host: '.tile.openstreetmap.org', kind: 'pictures', what: 'OpenStreetMap map tiles (that map layer only)' },
  { host: 'tile.openstreetmap.org', kind: 'pictures', what: 'OpenStreetMap map tiles (that map layer only)' },
  // roads, buildings, land use
  { host: 'overpass-api.de', kind: 'mapdata', what: 'OpenStreetMap Overpass server' },
  { host: 'lz4.overpass-api.de', kind: 'mapdata', what: 'OpenStreetMap Overpass server' },
  { host: 'overpass.private.coffee', kind: 'mapdata', what: 'OpenStreetMap Overpass server' },
  { host: 'overpass.kumi.systems', kind: 'mapdata', what: 'OpenStreetMap Overpass server' },
  { host: 'overpass.openstreetmap.ru', kind: 'mapdata', what: 'OpenStreetMap Overpass server' },
  { host: 'tiles.overturemaps.org', kind: 'mapdata', what: 'Overture Maps' },
  { host: 'api.openstreetmap.org', kind: 'mapdata', what: 'openstreetmap.org, on Pull or Download only' },
  // place search
  { host: 'nominatim.openstreetmap.org', kind: 'search', what: 'Nominatim place search' },
  { host: 'nominatim.geocoding.ai', kind: 'search', what: 'Nominatim place search' },
  // land cover, tree species, projections
  { host: 'esa-worldcover.s3.eu-central-1.amazonaws.com', kind: 'landcover', what: 'ESA WorldCover' },
  { host: 'api.inaturalist.org', kind: 'trees', what: 'iNaturalist: which tree species grow in the area' },
  { host: 'epsg.io', kind: 'projection', what: 'Projection details for an uploaded elevation file' },
  // the desktop app's updates
  { host: 'github.com', kind: 'updates', what: 'GitHub: the desktop app\'s update check and download' },
  { host: 'api.github.com', kind: 'updates', what: 'GitHub: the desktop app\'s update check' },
  { host: '.githubusercontent.com', kind: 'updates', what: 'GitHub: the update\'s files' },
  // the website only
  { host: 'static.cloudflareinsights.com', kind: 'analytics', what: 'Cloudflare Web Analytics (website only)' },
  { host: 'cloudflareinsights.com', kind: 'analytics', what: 'Cloudflare Web Analytics (website only)' },
];

// Addresses that appear in the code but are never contacted by the app: links that open in the user's own
// browser, credits, an example in a placeholder, XML namespaces, a made-up base for parsing a path.
export const LINKS_ONLY = [
  'www.openstreetmap.org', 'operations.osmfoundation.org', 'www.esri.com', 'www.gpxz.io', 'mapterhorn.com', 'registry.opendata.aws',
  'protomaps.com', 'ko-fi.com', 'zenodo.org', 'tracestrack.com', 'api.tracestrack.com', 'overspan.dev', 'esa-worldcover.org', 'discord.gg',
  'www.w3.org', 'www.khronos.org', 'www.opengis.net', 'www.collada.org', 'x.invalid',
];

/** The list's entry for a host name (exact, or by a ".suffix" entry), or null when MapNG does not list it. */
export function networkHost(hostname) {
  const h = String(hostname || '').toLowerCase().replace(/\.$/, '');
  if (!h) return null;
  return NETWORK_HOSTS.find((e) => e.host === h) || NETWORK_HOSTS.find((e) => e.host.startsWith('.') && h.endsWith(e.host)) || null;
}
