export const VALID_SQUARE_EXPORT_RESOLUTIONS = [512, 1024, 2048, 4096, 8192, 16384];

// Upper bound on a native-coverage output edge (px) once the processing
// resolution is applied, so a fine pixel size (e.g. 0.25 m/px) over a large
// upload can't blow up the grid. Matches the experimental square-export max.
export const MAX_NATIVE_OUTPUT_EDGE = 16384;

/**
 * Scale a native coverage grid (given in metres at 1 m/px, e.g. meta.nativeWidth)
 * to the requested processing resolution, clamped so the longer edge stays within
 * MAX_NATIVE_OUTPUT_EDGE while preserving aspect ratio.
 */
export const scaleNativeDimsToProcessingMpp = (nativeWidthMeters, nativeHeightMeters, metersPerPixel) => {
  const mpp = Number.isFinite(Number(metersPerPixel)) && Number(metersPerPixel) > 0 ? Number(metersPerPixel) : 1;
  let width = Math.max(1, Math.round(Number(nativeWidthMeters || 0) / mpp));
  let height = Math.max(1, Math.round(Number(nativeHeightMeters || 0) / mpp));
  const maxEdge = Math.max(width, height);
  if (maxEdge > MAX_NATIVE_OUTPUT_EDGE) {
    const clamp = MAX_NATIVE_OUTPUT_EDGE / maxEdge;
    width = Math.max(1, Math.round(width * clamp));
    height = Math.max(1, Math.round(height * clamp));
  }
  return { width, height };
};

export const getBoundsCenter = (bounds) => {
  if (!bounds) return null;
  return {
    lat: (bounds.north + bounds.south) / 2,
    lng: (bounds.east + bounds.west) / 2,
  };
};

export const computeMetricSelectionBounds = (center, sizeMeters) => {
  if (!center || !Number.isFinite(center.lat) || !Number.isFinite(center.lng)) return null;
  if (!Number.isFinite(sizeMeters) || sizeMeters <= 0) return null;

  const metersPerDegLat = 111320;
  const metersPerDegLng = 111320 * Math.cos(center.lat * Math.PI / 180);
  const latSpan = sizeMeters / metersPerDegLat;
  const lngSpan = sizeMeters / metersPerDegLng;
  const halfLat = latSpan / 2;
  const halfLng = lngSpan / 2;

  return {
    north: center.lat + halfLat,
    south: center.lat - halfLat,
    east: center.lng + halfLng,
    west: center.lng - halfLng,
  };
};

export const clampSelectionToCoverage = (selectionBounds, coverageBounds) => {
  if (!selectionBounds) return null;
  if (!coverageBounds) return selectionBounds;

  const latSpan = selectionBounds.north - selectionBounds.south;
  const lngSpan = selectionBounds.east - selectionBounds.west;
  const coverageLatSpan = coverageBounds.north - coverageBounds.south;
  const coverageLngSpan = coverageBounds.east - coverageBounds.west;

  if (latSpan >= coverageLatSpan || lngSpan >= coverageLngSpan) {
    return { ...coverageBounds };
  }

  let north = selectionBounds.north;
  let south = selectionBounds.south;
  let east = selectionBounds.east;
  let west = selectionBounds.west;

  if (south < coverageBounds.south) {
    const shift = coverageBounds.south - south;
    south += shift;
    north += shift;
  }
  if (north > coverageBounds.north) {
    const shift = north - coverageBounds.north;
    north -= shift;
    south -= shift;
  }
  if (west < coverageBounds.west) {
    const shift = coverageBounds.west - west;
    west += shift;
    east += shift;
  }
  if (east > coverageBounds.east) {
    const shift = east - coverageBounds.east;
    east -= shift;
    west -= shift;
  }

  return {
    north: Math.min(north, coverageBounds.north),
    south: Math.max(south, coverageBounds.south),
    east: Math.min(east, coverageBounds.east),
    west: Math.max(west, coverageBounds.west),
  };
};

export const computeUploadedCropBounds = (center, resolution, coverageBounds) => {
  const rawBounds = computeMetricSelectionBounds(center, Number(resolution));
  return clampSelectionToCoverage(rawBounds, coverageBounds);
};

export const getMaxSquareCropResolution = (meta, processingMpp = 1) => {
  // nativeWidth/Height are the coverage edges in metres (1 m/px). The exported
  // heightmap edge in pixels is coverageMetres / processingMpp, so a finer pixel
  // size (e.g. 0.75 m/px) unlocks a higher power-of-2 within the same area.
  const maxEdgeMeters = Math.min(
    Number(meta?.nativeWidth || 0),
    Number(meta?.nativeHeight || 0),
  );
  if (!Number.isFinite(maxEdgeMeters) || maxEdgeMeters <= 0) return null;

  const mpp = Number.isFinite(Number(processingMpp)) && Number(processingMpp) > 0
    ? Number(processingMpp)
    : 1;
  const maxEdgePixels = maxEdgeMeters / mpp;

  const allowed = VALID_SQUARE_EXPORT_RESOLUTIONS.filter((value) => value <= maxEdgePixels);

  return allowed.length ? allowed[allowed.length - 1] : null;
};

export const getSquareCropResolutionOptions = (meta, processingMpp = 1) => {
  const maxResolution = getMaxSquareCropResolution(meta, processingMpp);
  if (!maxResolution) return [];

  return VALID_SQUARE_EXPORT_RESOLUTIONS.filter((value) => {
    return value <= maxResolution;
  });
};
/**
 * The square an upload in native mode becomes in the level: BeamNG needs a power-of-two square, so the export
 * centre-crops the generated grid to the largest power of two that fits (computeBeamNGTerrainSize in
 * exportBeamNGLevel.js, the same rule). { sizePx, sizeMeters, fileWidthMeters, fileHeightMeters, bounds } at the
 * processing resolution, or null. (A 999 × 1001 m lidar tile at 1 m per pixel keeps its middle 512 m: shown on the
 * map, so the level's area is no surprise.)
 */
export const nativeExportSquare = (meta, metersPerPixel) => {
  if (!meta?.nativeWidth || !meta?.nativeHeight || !meta?.bounds) return null;
  const { width, height } = scaleNativeDimsToProcessingMpp(meta.nativeWidth, meta.nativeHeight, metersPerPixel);
  const minPx = Math.min(width, height);
  if (!(minPx >= 2)) return null;
  const sizePx = 2 ** Math.floor(Math.log2(minPx));
  // (the metres a pixel really covers: the grid may be clamped to MAX_NATIVE_OUTPUT_EDGE)
  const effMpp = meta.nativeWidth / width;
  const sizeMeters = sizePx * effMpp;
  return {
    sizePx, sizeMeters, effMpp,
    fileWidthMeters: meta.nativeWidth, fileHeightMeters: meta.nativeHeight,
    bounds: computeMetricSelectionBounds(getBoundsCenter(meta.bounds), sizeMeters),
  };
};

/**
 * The native square placed where the user wants it: centred on `center` (the map's selection centre) and kept inside
 * the file's outline (a centre past an edge holds it against that edge); with no centre, the file's middle. The same fields as
 * nativeExportSquare. (The square was always the file's middle: a user with a big point cloud could not choose which
 * part became the level, Toma's request.)
 */
export const nativeSquareAt = (meta, metersPerPixel, center) => {
  const sq = nativeExportSquare(meta, metersPerPixel);
  if (!sq) return null;
  // (a centre past the file's edge holds the square against that edge: dragging toward an edge, it stops there; it
  // jumped back to the middle at first)
  const ok = center && Number.isFinite(center.lat) && Number.isFinite(center.lng);
  return ok ? { ...sq, bounds: computeUploadedCropBounds(center, sq.sizeMeters, meta.bounds) } : sq;
};

/** A point cloud's average point spacing (m) and density (points per m²) from its header, or null. */
export const pointCloudSpacing = (meta) => {
  if (!meta || !Number(meta.pointCount) || meta.epsgCode === 4326) return null;
  const area = (Number(meta.maxX) - Number(meta.minX)) * (Number(meta.maxY) - Number(meta.minY));
  if (!(area > 0)) return null;
  const density = Number(meta.pointCount) / area;
  return { spacing: 1 / Math.sqrt(density), density };
};
