// A BeamNG terrain is a square with a power-of-two edge. A terrain of any
// other size (an uploaded file at its own extent: 2000 x 2000, 3000 x 1800)
// is cut to the largest such square in its middle when exported. That was
// said only in the progress text while it happened: a 2 km upload came out
// 1 km in the game (Huggorme, Discord, 2026-08-05). The export panel says it
// beforehand, with the pixel size that keeps more of the file.
const MAX_EDGE_PX = 16384;
const MIN_MPP = 0.1;      // the processing resolution's lower limit

/**
 * @returns {null | { width, height, size, keptShare, keptMeters,
 *                    suggestMpp: number|null, suggestSize: number|null }}
 *   null when the terrain is already a power-of-two square. suggestMpp: the
 *   pixel size (m, rounded down to 0.001) at which the short edge reaches the
 *   next power of two, so the level keeps all of it; null when out of range.
 */
export function squareCropNotice(width, height, metersPerPixel = 1) {
  const w = Math.floor(Number(width) || 0); const h = Math.floor(Number(height) || 0);
  const short = Math.min(w, h);
  if (short < 2) return null;
  const size = 2 ** Math.floor(Math.log2(short));
  if (w === size && h === size) return null;
  const mpp = Number(metersPerPixel) > 0 ? Number(metersPerPixel) : 1;
  const next = size * 2;
  let suggestMpp = null;
  if (next <= MAX_EDGE_PX && short > size) {
    const m = Math.floor(((short * mpp) / next) * 1000) / 1000;
    if (m >= MIN_MPP) suggestMpp = m;
  }
  return {
    width: w, height: h, size,
    keptShare: (size * size) / (w * h),
    keptMeters: size * mpp,
    suggestMpp, suggestSize: suggestMpp ? next : null,
  };
}
