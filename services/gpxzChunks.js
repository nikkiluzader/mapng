// How an area is cut into GPXZ raster requests.
//
// GPXZ answers one hires-raster request of at most 10 km² ("Bounds cover too
// large of an area", 400). Each request is the chunk plus an overlap on every
// side (so chunks meet without a seam), and the overlap counts: a 3 km chunk
// with 0.002° added all round is 11.7 km² and was refused. The app cut areas
// into chunks of up to 3 km, so every area whose chunks came out between about
// 2.7 and 3 km (maps of 5.5-6 km, 8.2-9 km, 11-12 km a side...) lost those
// chunks to the 30 m fill, or GPXZ altogether: 7,100 such refusals in a week
// on the site, a quarter of all raster requests.

/** Largest request sent, km²: under GPXZ's 10, with room for its own way of measuring (about 1% over ours). */
export const GPXZ_MAX_REQUEST_KM2 = 9.5;

/** What GPXZ accepted of the usual grid, km² by our measure (its 10, less the 1% its own measure adds, less a little). */
const GPXZ_ACCEPTS_KM2 = 9.85;

/** The chunk side the app has always aimed for, km. */
const USUAL_CHUNK_KM = 3;

/**
 * Rows and columns for an area of latKm x lngKm, each request padded by padLatKm / padLngKm
 * in all (both sides together).
 *
 * Where the usual grid (chunks of up to 3 km) fits, it is kept exactly: the desktop app
 * finds a level's saved GPXZ downloads by their request, and a different grid would have
 * Update and Modify download them again. Where it does not fit: the fewest requests that
 * each stay within maxKm2, and of those the most square chunks.
 */
export function gpxzChunkGrid(latKm, lngKm, padLatKm, padLngKm, maxKm2 = GPXZ_MAX_REQUEST_KM2) {
  const fits = (rows, cols) => (latKm / rows + padLatKm) * (lngKm / cols + padLngKm) <= maxKm2;
  if (!(latKm > 0) || !(lngKm > 0) || !(padLatKm * padLngKm < maxKm2)) return { rows: 1, cols: 1 };
  const usual = { rows: Math.max(1, Math.ceil(latKm / USUAL_CHUNK_KM)), cols: Math.max(1, Math.ceil(lngKm / USUAL_CHUNK_KM)) };
  if ((latKm / usual.rows + padLatKm) * (lngKm / usual.cols + padLngKm) <= GPXZ_ACCEPTS_KM2) return usual;
  let best = null;
  // (rows beyond the count that fits with a single column's worth of width can only add requests)
  for (let rows = 1; rows <= 4096; rows++) {
    const tall = latKm / rows + padLatKm;
    if (tall >= maxKm2 / padLngKm) continue;                 // no width fits this height
    const cols = Math.max(1, Math.ceil(lngKm / (maxKm2 / tall - padLngKm) - 1e-9));
    if (!fits(rows, cols)) continue;
    const count = rows * cols;
    const skew = Math.abs(Math.log((latKm / rows) / (lngKm / cols)));
    if (!best || count < best.count || (count === best.count && skew < best.skew - 1e-9)) best = { rows, cols, count, skew };
    if (cols === 1 && best.count <= rows) break;
  }
  return best ? { rows: best.rows, cols: best.cols } : { rows: 1, cols: 1 };
}
