// Longitude ranges that stay continuous across the date line. A box there is
// kept as west 179.99 / east 180.01 (east past 180), never west 179.99 /
// east -179.99: every lng -> x conversion in the app is linear in
// (lng - west) / (east - west), and the fetchers split such a box at 180
// themselves (osm.js splitAtDateLine, terrain.js GPXZ chunks, USGS).
// No imports: the resampler worker loads it too.

export const normalizeLng = (lng) => ((((lng + 180) % 360) + 360) % 360) - 180;

/** { west, east } with west in [-180, 180) and east = west + the box's width. */
export function continuousLngRange(west, east) {
  const w = Number(west);
  const e = Number(east);
  let span = e - w;
  while (span < 0) span += 360;
  while (span > 360) span -= 360;
  const nw = normalizeLng(w);
  return { west: nw, east: nw + span };
}
