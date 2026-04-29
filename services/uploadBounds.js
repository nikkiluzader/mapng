export const VALID_SQUARE_EXPORT_RESOLUTIONS = [512, 1024, 2048, 4096, 8192, 16384];

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

export const getMaxSquareCropResolution = (meta, allowExperimental16384 = false) => {
  const maxEdge = Math.min(
    Number(meta?.nativeWidth || 0),
    Number(meta?.nativeHeight || 0),
  );
  if (!Number.isFinite(maxEdge) || maxEdge <= 0) return null;

  const allowed = VALID_SQUARE_EXPORT_RESOLUTIONS.filter((value) => {
    if (!allowExperimental16384 && value === 16384) return false;
    return value <= maxEdge;
  });

  return allowed.length ? allowed[allowed.length - 1] : null;
};

export const getSquareCropResolutionOptions = (meta, allowExperimental16384 = false) => {
  const maxResolution = getMaxSquareCropResolution(meta, allowExperimental16384);
  if (!maxResolution) return [];

  return VALID_SQUARE_EXPORT_RESOLUTIONS.filter((value) => {
    if (!allowExperimental16384 && value === 16384) return false;
    return value <= maxResolution;
  });
};