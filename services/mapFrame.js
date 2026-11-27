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
//
// A turned map (refs/output/rotation-plan.md): the bounds carry `angle` (degrees clockwise from north: the map's own
// "up" points that far east of north) and `frame` ({ lat, lng, wM, hM }: its centre and size in metres). Its
// north/south/east/west are then the north-up box round the turned square (what to fetch), and positions are linear
// in metres along the map's own axes, from the centre, by the centre's metres per degree, the same rule as above. With
// no angle every function here is the unturned one exactly.

const A = 6378137;                 // WGS84 semi-major axis, metres
const E2 = 0.00669437999014;       // WGS84 first eccentricity squared
const RAD = Math.PI / 180;
const lngSpanOf = (b) => { let s = b.east - b.west; if (s > 180) s -= 360; if (s < -180) s += 360; return s; };

/** Metres in one degree of latitude and of longitude at `lat` (WGS84 ellipsoid): { lat, lng }. */
export function metresPerDegree(lat) {
  const s = Math.sin(lat * RAD); const w = 1 - E2 * s * s;
  const meridian = (A * (1 - E2)) / (w * Math.sqrt(w));   // radius of curvature along the meridian
  const normal = A / Math.sqrt(w);                         // and across it
  return { lat: meridian * RAD, lng: normal * Math.cos(lat * RAD) * RAD };
}

/**
 * The bounds of a map widthM by heightM metres centred on `center`: { north, south, east, west } (east may pass 180).
 * Turned by `angle` degrees (clockwise from north): the north-up box round the turned map, with { angle, frame }.
 */
export function frameBounds(center, widthM, heightM, angle = 0) {
  const k = metresPerDegree(center.lat);
  const a = normAngle(angle);
  if (!a) {
    const dLat = heightM / 2 / k.lat; const dLng = widthM / 2 / k.lng;
    return { north: center.lat + dLat, south: center.lat - dLat, west: center.lng - dLng, east: center.lng + dLng };
  }
  const t = a * RAD; const c = Math.abs(Math.cos(t)); const sn = Math.abs(Math.sin(t));
  // (the turned rectangle's half extents east and north)
  const hx = (widthM / 2) * c + (heightM / 2) * sn; const hy = (widthM / 2) * sn + (heightM / 2) * c;
  return {
    north: center.lat + hy / k.lat, south: center.lat - hy / k.lat, west: center.lng - hx / k.lng, east: center.lng + hx / k.lng,
    angle: a, frame: { lat: center.lat, lng: center.lng, wM: widthM, hM: heightM },
  };
}

/** An angle in degrees as (-180, 180], 0 for none or not a number. */
export function normAngle(angle) {
  let a = Number(angle);
  if (!Number.isFinite(a)) return 0;
  a = ((a % 360) + 360) % 360; if (a > 180) a -= 360;
  return Math.abs(a) < 1e-9 ? 0 : a;
}
/** Whether the bounds are of a turned map. */
export const isTurned = (b) => !!(b && b.angle && b.frame);

/**
 * A point's place on the map as fractions: { u, v }, u from the west edge, v from the north edge (0..1 inside). On a
 * turned map, along its own axes: u from its left edge, v from its top edge.
 */
export function frameUV(bounds, lat, lng) {
  if (!isTurned(bounds)) return { u: (lng - bounds.west) / lngSpanOf(bounds), v: (bounds.north - lat) / (bounds.north - bounds.south) };
  const f = bounds.frame; const k = metresPerDegree(f.lat); const t = bounds.angle * RAD;
  let dl = lng - f.lng; if (dl > 180) dl -= 360; if (dl < -180) dl += 360;
  const x = dl * k.lng; const y = (lat - f.lat) * k.lat;
  // (the map's own right and up: right = (cos t, -sin t), up = (sin t, cos t) in east, north)
  const xr = x * Math.cos(t) - y * Math.sin(t); const yu = x * Math.sin(t) + y * Math.cos(t);
  return { u: xr / f.wM + 0.5, v: 0.5 - yu / f.hM };
}
/** The reverse: the point at fractions (u, v) of the map, as { lat, lng }. */
export function frameLatLngAt(bounds, u, v) {
  if (!isTurned(bounds)) return { lat: bounds.north - v * (bounds.north - bounds.south), lng: bounds.west + u * lngSpanOf(bounds) };
  const f = bounds.frame; const k = metresPerDegree(f.lat); const t = bounds.angle * RAD;
  const xr = (u - 0.5) * f.wM; const yu = (0.5 - v) * f.hM;
  const x = xr * Math.cos(t) + yu * Math.sin(t); const y = -xr * Math.sin(t) + yu * Math.cos(t);
  return { lat: f.lat + y / k.lat, lng: f.lng + x / k.lng };
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


/**
 * The position (in squares from the bounds' north-west corner: gx east, gy south, fractions allowed) as [lng, lat].
 * A height sample (c, r) is at (c, r + 1); a picture's texel (i, j) of N x M over a W x H map has its centre at
 * ((i + 0.5) * W / N, (j + 0.5) * H / M).
 */
export function gridLngLat(bounds, width, height, gx, gy) {
  if (isTurned(bounds)) { const p = frameLatLngAt(bounds, gx / width, gy / height); return [p.lng, p.lat]; }
  return [bounds.west + (gx / width) * lngSpanOf(bounds), bounds.north - (gy / height) * (bounds.north - bounds.south)];
}
/** Height sample (column c, row r from the north) as { lat, lng }. */
export function vertexLatLng(bounds, width, height, c, r) {
  const [lng, lat] = gridLngLat(bounds, width, height, c, r + 1);
  return { lat, lng };
}
/** A point's position in squares from the north-west corner: { gx, gy } (the reverse of gridLngLat). */
export function gridPosition(bounds, width, height, lat, lng) {
  if (isTurned(bounds)) { const { u, v } = frameUV(bounds, lat, lng); return { gx: u * width, gy: v * height }; }
  return { gx: ((lng - bounds.west) / lngSpanOf(bounds)) * width, gy: ((bounds.north - lat) / (bounds.north - bounds.south)) * height };
}

/**
 * A height map read at a place given as fractions of the map (u from the west edge, v from the north edge, 0..1):
 * bilinear between the samples, which stand at u = c / W, v = (r + 1) / H. For anything drawn over the whole map
 * (the 3D preview's mesh, a 3D model export) whose points are not the samples themselves. Past the outermost
 * samples the edge value holds. A no-data sample (under noData) is left out of the mix; all four missing: fallback.
 */
export function heightAtFraction(heightMap, W, H, u, v, { noData = -10000, fallback = 0 } = {}) {
  const gx = Math.min(W - 1, Math.max(0, u * W)); const gy = Math.min(H - 1, Math.max(0, v * H - 1));
  const c0 = Math.min(W - 2, Math.floor(gx)); const r0 = Math.min(H - 2, Math.floor(gy));
  if (c0 < 0 || r0 < 0) { const h = heightMap[Math.round(gy) * W + Math.round(gx)]; return h > noData ? h : fallback; }
  const tx = gx - c0; const ty = gy - r0;
  let sum = 0; let wsum = 0;
  for (const [c, r, w] of [[c0, r0, (1 - tx) * (1 - ty)], [c0 + 1, r0, tx * (1 - ty)], [c0, r0 + 1, (1 - tx) * ty], [c0 + 1, r0 + 1, tx * ty]]) {
    const h = heightMap[r * W + c]; if (!(h > noData) || !(w > 0)) continue;
    sum += h * w; wsum += w;
  }
  return wsum > 0 ? sum / wsum : fallback;
}

/** A point's level coordinates (metres, x right, y up, the level's centre at 0) on a map worldSize metres across. */
export function levelXY(bounds, lat, lng, worldSize) {
  const { u, v } = frameUV(bounds, lat, lng);
  return [(u - 0.5) * worldSize, (0.5 - v) * worldSize];
}
/** The reverse: level coordinates (x, y) as { lat, lng }. */
export function levelLatLng(bounds, x, y, worldSize) {
  return frameLatLngAt(bounds, x / worldSize + 0.5, 0.5 - y / worldSize);
}
