// MapNG's own street map: the Protomaps basemap (OpenStreetMap data, ODbL; https://protomaps.com), one world
// archive in MapNG's storage, read by byte range through /api/osm-tiles/ and drawn in the browser
// (protomaps-leaflet). No outside map server is asked for anything, so nobody's usage limits apply.
//
// The layer is offered only where the archive answers (a site or a build without it shows the other maps).
export const OWN_MAP_ARCHIVE = 'basemap/20261115.pmtiles';
export const OWN_MAP_URL = `/api/osm-tiles/${OWN_MAP_ARCHIVE}`;
export const OWN_MAP_ATTRIBUTION = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors, <a href="https://protomaps.com">Protomaps</a>';
export const OWN_MAP_MAX_DATA_ZOOM = 15;

/** Whether the archive is there: its first bytes are a PMTiles header ("PMTiles", version 3). */
export async function ownMapAvailable(fetchImpl = fetch, url = OWN_MAP_URL) {
  try {
    const r = await fetchImpl(url, { headers: { Range: 'bytes=0-15' } });
    if (!r.ok) return false;
    const b = new Uint8Array(await r.arrayBuffer());
    return b.length >= 8 && String.fromCharCode(...b.slice(0, 7)) === 'PMTiles' && b[7] === 3;
  } catch { return false; }
}

// The styles the basemap comes in (@protomaps/basemaps' named flavours), all offered as a choice beside the
// layer. Until one is chosen the map follows the app: 'dark' in dark mode, 'light' otherwise.
export const OWN_MAP_STYLES = ['light', 'dark', 'white', 'grayscale', 'black'];
/** The style to draw: the chosen one when it is a known style, else by the app's dark mode. */
export const ownMapStyle = (chosen, darkMode) => (OWN_MAP_STYLES.includes(chosen) ? chosen : darkMode ? 'dark' : 'light');

let ownArchive = null;
/** The Leaflet layer (the renderer is loaded when first needed: it is not in the page's first script). */
export async function createOwnMapLayer(options = {}) {
  const [{ leafletLayer }, { PMTiles }, { cachedTileSource }] = await Promise.all([import('protomaps-leaflet'), import('pmtiles'), import('./tileByteCache.js')]);
  // (one archive reader for every style of the map, its pieces kept by the browser: services/tileByteCache.js)
  ownArchive ||= new PMTiles(cachedTileSource(OWN_MAP_URL));
  return leafletLayer({ url: ownArchive, flavor: OWN_MAP_STYLES.includes(options.style) ? options.style : options.dark ? 'dark' : 'light', lang: options.lang || 'en', maxDataZoom: OWN_MAP_MAX_DATA_ZOOM, attribution: OWN_MAP_ATTRIBUTION, ...options.leaflet });
}
