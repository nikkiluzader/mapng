// Where a raster's samples lie. A GeoTIFF's origin (and an ASC grid's corner,
// a GML tile's envelope) is the outer CORNER of its first cell, and each
// value stands for the cell's area: the sample is at the cell's middle, half
// a cell in from the origin. The resamplers read the origin as the first
// sample itself, so every such raster sat half a cell north-west of where it
// belongs: 0.5 m on 1 m lidar (measured against Mapterhorn on six areas:
// GPXZ 0.36 to 0.58 px west and 0.23 to 1.03 px north), and the outer half
// cell all round, with the strip between neighbouring tiles, was left to
// the gap fill. A raster whose values are points (GeoTIFF GTRasterType 2, a
// GML RectifiedGrid's posts) has its first sample at the origin, as read.

/** A tile's origin as the position of its first sample: half a cell in, unless its values are points. */
export const sampleOrigin = (origin, res, cellIsPoint = false) => (cellIsPoint ? origin : origin + res / 2);

const EDGE_TOLERANCE = 1e-4;

/**
 * A fractional sample index inside a raster of n samples, or null outside
 * it. The raster's area reaches half a cell past its outer samples; there
 * the outer sample's value holds (no gap between neighbouring tiles).
 */
export const cellIndex = (p, n) => {
  // (a hair's tolerance: a grid laid edge to edge over the raster has its outer samples exactly on the edge)
  if (!(p >= -0.5 - EDGE_TOLERANCE && p <= n - 0.5 + EDGE_TOLERANCE)) return null;
  return Math.min(Math.max(p, 0), Math.max(0, n - 1 - 1e-6));
};

/** Whether a GeoTIFF's values are points (GTRasterTypeGeoKey 2); areas otherwise, the default. */
export const geoTiffCellIsPoint = (geoKeys) => Number(geoKeys?.GTRasterTypeGeoKey) === 2;
