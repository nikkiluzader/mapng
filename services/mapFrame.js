// The map's frame: where every pixel of a map is in the world. One definition, used by Generate (the bounds and the
// resamplers), the chunk lattice, the road corridor, the tiles on the map and the previews.
//
// A map of W x H squares of `mpp` metres is drawn by the game exactly W * mpp by H * mpp metres, its height samples
// (vertices) at whole squares from its south-west corner, rows counted from the south. The frame says the same thing
// in latitude and longitude:
//
//   - the bounds are exactly the map: W * mpp metres west to east and H * mpp south to north through the centre, by
//     the ellipsoid's own metres per degree at the centre's latitude (no padding, no flat 111,320 m);
//   - positions are linear in latitude and longitude across the bounds: u = (lng - west) / (east - west) from the
//     west edge, v = (north - lat) / (north - south) from the north edge;
//   - height sample (column c, row r from the north) is the vertex at u = c / W, v = (r + 1) / H: the game's own
//     grid (services/terrainLookup.js, geoUtils createGridProjector);
//   - a picture laid over the map (satellite, the drawn map) has texel i covering [i, i + 1) / N: its centre at
//     (i + 0.5) / N.
//
// What is exact and what is not: terrain, map data and pictures share this one mapping, so they agree with each other
// to the pixel everywhere. Against the real world the scale is exact at the centre; east-west it follows the cosine
// of the latitude, so a map's top and bottom rows are off by (their distance from the centre) x tan(latitude) / R:
// 0.13 % (10 m at the corners) on a 16 km map at latitude 45. That is the price of a grid that is linear in degrees.

const A = 6378137;                 // WGS84 semi-major axis, metres
const E2 = 0.00669437999014;       // WGS84 first eccentricity squared
const RAD = Math.PI / 180;

/** Metres in one degree of latitude and of longitude at `lat` (WGS84 ellipsoid): { lat, lng }. */
export function metresPerDegree(lat) {
  const s = Math.sin(lat * RAD); const w = 1 - E2 * s * s;
  const meridian = (A * (1 - E2)) / (w * Math.sqrt(w));   // radius of curvature along the meridian
  const normal = A / Math.sqrt(w);                         // and across it
  return { lat: meridian * RAD, lng: normal * Math.cos(lat * RAD) * RAD };
}

/** The bounds of a map widthM by heightM metres centred on `center`: { north, south, east, west } (east may pass 180). */
export function frameBounds(center, widthM, heightM) {
  const k = metresPerDegree(center.lat);
  const dLat = heightM / 2 / k.lat; const dLng = widthM / 2 / k.lng;
  return { north: center.lat + dLat, south: center.lat - dLat, west: center.lng - dLng, east: center.lng + dLng };
}

/** A point `x` metres east and `y` metres north of `center`, in the frame's own (linear) terms: { lat, lng }. */
export function offsetLatLng(center, x, y) {
  const k = metresPerDegree(center.lat);
  return { lat: center.lat + y / k.lat, lng: center.lng + x / k.lng };
}
/** The reverse: a point's metres east and north of `center`: { x, y }. */
export function offsetMetres(center, p) {
  const k = metresPerDegree(center.lat);
  return { x: (p.lng - center.lng) * k.lng, y: (p.lat - center.lat) * k.lat };
}

const lngSpanOf = (b) => { let s = b.east - b.west; if (s > 180) s -= 360; if (s < -180) s += 360; return s; };

/**
 * The position (in squares from the bounds' north-west corner: gx east, gy south, fractions allowed) as [lng, lat].
 * A height sample (c, r) is at (c, r + 1); a picture's texel (i, j) of N x M over a W x H map has its centre at
 * ((i + 0.5) * W / N, (j + 0.5) * H / M).
 */
export function gridLngLat(bounds, width, height, gx, gy) {
  return [bounds.west + (gx / width) * lngSpanOf(bounds), bounds.north - (gy / height) * (bounds.north - bounds.south)];
}
/** Height sample (column c, row r from the north) as { lat, lng }. */
export function vertexLatLng(bounds, width, height, c, r) {
  const [lng, lat] = gridLngLat(bounds, width, height, c, r + 1);
  return { lat, lng };
}
/** A point's position in squares from the north-west corner: { gx, gy } (the reverse of gridLngLat). */
export function gridPosition(bounds, width, height, lat, lng) {
  return { gx: ((lng - bounds.west) / lngSpanOf(bounds)) * width, gy: ((bounds.north - lat) / (bounds.north - bounds.south)) * height };
}
