// Small pure helpers for the 2D map (components/map/MapSelector.vue): the one
// flat world it shows, and the text it puts on the map. No Leaflet or Vue here,
// so the tests can load it.

// Web Mercator ends at ~85.05°: the map stops there and at ±180° (no copies of
// the world east or west).
export const WORLD_LAT = 85.0511;
export const WORLD_BOUNDS = [[-WORLD_LAT, -180], [WORLD_LAT, 180]];

const TILE_PX = 256;

/** The furthest-out zoom at which one world still fills a map this wide. */
export function minZoomForWidth(widthPx) {
  if (!Number.isFinite(widthPx) || widthPx <= TILE_PX) return 0;
  return Math.ceil(Math.log2(widthPx / TILE_PX));
}

/** "2.05 × 2.05 km", "512 × 512 m": the selection's size for its label. */
export function formatSelectionSize(widthM, heightM = widthM) {
  if (!Number.isFinite(widthM) || !Number.isFinite(heightM) || widthM <= 0 || heightM <= 0) return '';
  const km = Math.max(widthM, heightM) >= 1000;
  const fmt = (m) => (km
    ? `${(m / 1000).toFixed(m >= 10000 ? 1 : 2).replace(/\.?0+$/, '')}`
    : `${Math.round(m)}`);
  return `${fmt(widthM)} × ${fmt(heightM)} ${km ? 'km' : 'm'}`;
}

/** "29.89773, -81.31155": a point as people paste it (5 decimals ≈ 1 m). */
export function formatLatLng(lat, lng) {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return '';
  return `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
}

/** A longitude kept on the one world (Leaflet can report -180.00001 at the edge). */
export function clampLng(lng) {
  return Math.max(-180, Math.min(180, lng));
}
