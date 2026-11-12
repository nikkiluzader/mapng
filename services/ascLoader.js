import {
  computeGeoMetadata,
  detectUnitFromText,
  summarizeCoverageBounds,
  UNIT_UNKNOWN,
} from './uploadGeoMetadata.js';

const MAX_HEADER_LINES = 64;
const DEFAULT_NO_DATA_VALUE = -9999;

const readNextLine = (text, startIndex) => {
  if (startIndex >= text.length) {
    return {
      line: '',
      lineStart: startIndex,
      nextIndex: startIndex,
      done: true,
    };
  }

  const lineStart = startIndex;
  const newlineIndex = text.indexOf('\n', startIndex);
  const lineEnd = newlineIndex === -1 ? text.length : newlineIndex;
  const rawLine = text.slice(startIndex, lineEnd);
  const line = rawLine.endsWith('\r') ? rawLine.slice(0, -1) : rawLine;

  return {
    line,
    lineStart,
    nextIndex: newlineIndex === -1 ? text.length : newlineIndex + 1,
    done: false,
  };
};

const parseInteger = (value, label) => {
  const parsed = Number.parseInt(String(value), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`Invalid ASC header: ${label} must be an integer greater than 0.`);
  }
  return parsed;
};

const parsePositiveNumber = (value, label) => {
  const parsed = Number(String(value));
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`Invalid ASC header: ${label} must be a number greater than 0.`);
  }
  return parsed;
};

const parseNumber = (value, label) => {
  const parsed = Number(String(value));
  if (!Number.isFinite(parsed)) {
    throw new Error(`Invalid ASC header: ${label} must be a finite number.`);
  }
  return parsed;
};

const normalizeLongitude = (longitude) => {
  let value = longitude;
  while (value > 180) value -= 360;
  while (value < -180) value += 360;
  return value;
};

// A grid in degrees has a small cell (1 arc-second is 0.00028, a coarse
// 10 km grid 0.09). A cell of half a unit or more is metres: a 60 x 60 grid
// of 1 m cells from 0,0 fits inside ±90 and was read as 60 degrees a side.
const MAX_DEGREE_CELL = 0.1;

const toGeographicBounds = (west, east, south, north, cellSize = 0) => {
  if (cellSize > MAX_DEGREE_CELL) return null;
  if (
    !Number.isFinite(west)
    || !Number.isFinite(east)
    || !Number.isFinite(south)
    || !Number.isFinite(north)
    || south < -90
    || south > 90
    || north < -90
    || north > 90
    || north <= south
    || east <= west
  ) {
    return null;
  }

  const lonSpan = east - west;
  if (lonSpan <= 0 || lonSpan > 360) {
    return null;
  }

  const isSignedLongitude = west >= -180 && east <= 180;
  if (isSignedLongitude) {
    return { west, east, south, north };
  }

  const isUnsignedLongitude = west >= 0 && east <= 360;
  if (!isUnsignedLongitude) {
    return null;
  }

  const normalizedWest = normalizeLongitude(west);
  const normalizedEast = normalizeLongitude(east);

  // Keep non-wrapping bounds only. Dateline wrapping requires multi-extent handling.
  if (normalizedEast <= normalizedWest) {
    return null;
  }

  return {
    west: normalizedWest,
    east: normalizedEast,
    south,
    north,
  };
};

export const isLikelyAscText = (text) => {
  if (typeof text !== 'string' || !text.trim()) return false;
  const sample = text.slice(0, 2048).toLowerCase();
  const hasDimensions = /\bncols\b/.test(sample) && /\bnrows\b/.test(sample);
  const hasOrigin = /\bxll(center|corner)\b/.test(sample) && /\byll(center|corner)\b/.test(sample);
  const hasCellSize = /\bcellsize\b/.test(sample);
  return hasDimensions && hasOrigin && hasCellSize;
};

export const parseAscText = async (text, options = {}) => {
  if (!isLikelyAscText(text)) {
    throw new Error('Unsupported ASC: missing required ESRI ASCII Grid header fields.');
  }

  const { fileName = null, fileSize = 0 } = options;

  const header = {};
  const recognizedHeaderKeys = new Set([
    'ncols',
    'nrows',
    'xllcorner',
    'yllcorner',
    'xllcenter',
    'yllcenter',
    'cellsize',
    'nodata_value',
  ]);

  let index = 0;
  let dataStartIndex = 0;
  let linesScanned = 0;

  while (linesScanned < MAX_HEADER_LINES) {
    const { line, lineStart, nextIndex, done } = readNextLine(text, index);
    if (done) {
      dataStartIndex = lineStart;
      break;
    }
    index = nextIndex;
    linesScanned += 1;

    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith('//')) {
      continue;
    }

    const parts = trimmed.split(/\s+/);
    if (parts.length < 2) {
      dataStartIndex = lineStart;
      break;
    }

    const key = parts[0].toLowerCase();
    if (!recognizedHeaderKeys.has(key)) {
      dataStartIndex = lineStart;
      break;
    }

    header[key] = parts.slice(1).join(' ').trim();
    dataStartIndex = nextIndex;
  }

  const hasCenterOrigin = header.xllcenter != null && header.yllcenter != null;
  const hasCornerOrigin = header.xllcorner != null && header.yllcorner != null;
  if (!hasCenterOrigin && !hasCornerOrigin) {
    throw new Error('Invalid ASC header: expected xllcenter/yllcenter or xllcorner/yllcorner.');
  }

  const ncols = parseInteger(header.ncols, 'ncols');
  const nrows = parseInteger(header.nrows, 'nrows');
  const cellSize = parsePositiveNumber(header.cellsize, 'cellsize');
  const noData = header.nodata_value != null
    ? parseNumber(header.nodata_value, 'nodata_value')
    : DEFAULT_NO_DATA_VALUE;

  const xllCenter = hasCenterOrigin
    ? parseNumber(header.xllcenter, 'xllcenter')
    : parseNumber(header.xllcorner, 'xllcorner') + (cellSize / 2);
  const yllCenter = hasCenterOrigin
    ? parseNumber(header.yllcenter, 'yllcenter')
    : parseNumber(header.yllcorner, 'yllcorner') + (cellSize / 2);

  const expectedCellCount = ncols * nrows;
  const raster = new Float32Array(expectedCellCount);
  const valuePattern = /[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/g;
  valuePattern.lastIndex = dataStartIndex;

  let cellIndex = 0;
  while (cellIndex < expectedCellCount) {
    const match = valuePattern.exec(text);
    if (!match) break;
    const parsed = Number(match[0]);
    raster[cellIndex] = Number.isFinite(parsed) ? parsed : noData;
    cellIndex += 1;
  }

  if (cellIndex !== expectedCellCount) {
    throw new Error(`Unsupported ASC: expected ${expectedCellCount} elevation values, found ${cellIndex}.`);
  }

  const halfCell = cellSize / 2;
  const minXCenter = xllCenter;
  const minYCenter = yllCenter;
  const maxXCenter = xllCenter + (ncols - 1) * cellSize;
  const maxYCenter = yllCenter + (nrows - 1) * cellSize;

  const west = minXCenter - halfCell;
  const east = maxXCenter + halfCell;
  const south = minYCenter - halfCell;
  const north = maxYCenter + halfCell;
  const geographicBounds = toGeographicBounds(west, east, south, north, cellSize);
  const bounds = geographicBounds
    ? {
        north: geographicBounds.north,
        south: geographicBounds.south,
        east: geographicBounds.east,
        west: geographicBounds.west,
      }
    : null;

  const coverageSummary = summarizeCoverageBounds(bounds);
  const headerText = text.slice(0, Math.min(dataStartIndex + 256, text.length));
  const verticalUnitDetected = detectUnitFromText(headerText);
  const sourceBoundsProjected = { north, south, east, west };

  return {
    sourceType: 'grid',
    sourceFormat: 'asc',
    formatLabel: 'ASC Grid',
    raster,
    sourceWidth: ncols,
    sourceHeight: nrows,
    isGeoTiff: false,
    isGeoReferenced: !!bounds,
    epsgCode: null,
    sourceBoundsProjected,
    sourceCrsSelectable: true,
    bounds,
    center: coverageSummary.center,
    nativeWidth: coverageSummary.nativeWidth,
    nativeHeight: coverageSummary.nativeHeight,
    suggestedResolution: coverageSummary.suggestedResolution,
    nativeMetersPerPixel: coverageSummary.nativeMetersPerPixel,
    noData,
    gridTiles: bounds
      ? [{
          raster,
          width: ncols,
          height: nrows,
          originX: west,
          originY: north,
          resX: cellSize,
          resY: -cellSize,
          epsgCode: 4326,
          bounds,
          noData,
          sourceName: fileName || 'uploaded.asc',
        }]
      : [],
    fileSize,
    verticalUnitDetected,
    verticalUnitDetectionSource: verticalUnitDetected === UNIT_UNKNOWN ? null : 'ASCHeaderText',
  };
};

export const parseAscFiles = async (files = []) => {
  const list = Array.from(files || []).filter(Boolean);
  if (list.length === 0) {
    throw new Error('No ASC files selected.');
  }

  const parsedList = await Promise.all(list.map((file) => parseAscFile(file)));
  const tileSources = parsedList.map((meta, index) => {
    const width = Number(meta.sourceWidth || 0);
    const height = Number(meta.sourceHeight || 0);
    const sourceBoundsProjected = meta.sourceBoundsProjected;
    const sourceName = meta.gridTiles?.[0]?.sourceName || list[index]?.name || `uploaded_${index + 1}.asc`;
    return {
      raster: meta.raster,
      width,
      height,
      noData: meta.noData,
      sourceBoundsProjected,
      sourceName,
      fileSize: Number(list[index]?.size || 0),
    };
  });

  const hasProjectedTileData = tileSources.every((tile) => {
    const b = tile.sourceBoundsProjected;
    return b && [b.north, b.south, b.east, b.west].every((value) => Number.isFinite(value));
  });

  const allBounds = parsedList
    .map((meta) => meta.bounds)
    .filter((b) => b && [b.north, b.south, b.east, b.west].every((value) => Number.isFinite(value)));
  const mergedBounds = allBounds.length > 0
    ? {
        north: Math.max(...allBounds.map((b) => b.north)),
        south: Math.min(...allBounds.map((b) => b.south)),
        east: Math.max(...allBounds.map((b) => b.east)),
        west: Math.min(...allBounds.map((b) => b.west)),
      }
    : null;

  const coverageSummary = summarizeCoverageBounds(mergedBounds);
  const totalFileSize = tileSources.reduce((sum, tile) => sum + tile.fileSize, 0);
  const resolvedGridTiles = mergedBounds
    ? parsedList.flatMap((meta) => Array.isArray(meta.gridTiles) ? meta.gridTiles : [])
    : [];

  return {
    sourceType: 'grid',
    sourceFormat: 'asc-multi',
    formatLabel: 'ASC Grid',
    raster: null,
    sourceWidth: null,
    sourceHeight: null,
    isGeoTiff: false,
    isGeoReferenced: !!mergedBounds,
    epsgCode: null,
    sourceBoundsProjected: hasProjectedTileData ? null : null,
    sourceCrsSelectable: true,
    bounds: mergedBounds,
    center: coverageSummary.center,
    nativeWidth: coverageSummary.nativeWidth,
    nativeHeight: coverageSummary.nativeHeight,
    suggestedResolution: coverageSummary.suggestedResolution,
    nativeMetersPerPixel: coverageSummary.nativeMetersPerPixel,
    noData: null,
    gridTiles: resolvedGridTiles,
    ascTileSources: tileSources,
    fileSize: totalFileSize,
    verticalUnitDetected: parsedList.some((meta) => meta.verticalUnitDetected && meta.verticalUnitDetected !== UNIT_UNKNOWN)
      ? parsedList.find((meta) => meta.verticalUnitDetected && meta.verticalUnitDetected !== UNIT_UNKNOWN)?.verticalUnitDetected
      : UNIT_UNKNOWN,
    verticalUnitDetectionSource: parsedList.find((meta) => meta.verticalUnitDetectionSource)?.verticalUnitDetectionSource || null,
    uploadFileNames: list.map((file) => file.name),
  };
};

export const applyAscCoordinateSystem = async (meta, epsgCode) => {
  if (!meta || (meta.sourceFormat !== 'asc' && meta.sourceFormat !== 'asc-multi')) return meta;
  const code = Number(epsgCode);
  if (!Number.isFinite(code) || code <= 0) {
    const clearedMulti = Array.isArray(meta.ascTileSources)
      ? {
          ...meta,
          epsgCode: null,
          isGeoReferenced: false,
          bounds: null,
          center: null,
          nativeWidth: null,
          nativeHeight: null,
          suggestedResolution: null,
          nativeMetersPerPixel: null,
          gridTiles: [],
        }
      : {
          ...meta,
          epsgCode: null,
        };
    return clearedMulti;
  }

  if (meta.sourceFormat === 'asc-multi') {
    const tileSources = Array.isArray(meta.ascTileSources) ? meta.ascTileSources : [];
    if (!tileSources.length) {
      return {
        ...meta,
        epsgCode: code,
        isGeoReferenced: true,
        bounds: null,
        center: null,
        nativeWidth: null,
        nativeHeight: null,
        suggestedResolution: null,
        nativeMetersPerPixel: null,
        gridTiles: [],
      };
    }

    const resolvedTiles = [];
    const tileBounds = [];
    for (const tile of tileSources) {
      const b = tile?.sourceBoundsProjected;
      const width = Number(tile?.width || 0);
      const height = Number(tile?.height || 0);
      if (!b || !Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
        continue;
      }

      const resX = (b.east - b.west) / width;
      const resY = (b.south - b.north) / height;
      const geoMeta = await computeGeoMetadata({
        epsgCode: code,
        sourceWidth: width,
        sourceHeight: height,
        originX: b.west,
        originY: b.north,
        resX,
        resY,
        useSampleSpacing: false,
        logPrefix: 'ascLoader',
      });
      if (!geoMeta?.bounds) continue;

      tileBounds.push(geoMeta.bounds);
      resolvedTiles.push({
        raster: tile.raster,
        width,
        height,
        originX: b.west,
        originY: b.north,
        resX,
        resY,
        epsgCode: code,
        bounds: geoMeta.bounds,
        noData: tile.noData,
        sourceName: tile.sourceName || 'uploaded.asc',
      });
    }

    const mergedBounds = tileBounds.length > 0
      ? {
          north: Math.max(...tileBounds.map((b) => b.north)),
          south: Math.min(...tileBounds.map((b) => b.south)),
          east: Math.max(...tileBounds.map((b) => b.east)),
          west: Math.min(...tileBounds.map((b) => b.west)),
        }
      : null;
    const coverageSummary = summarizeCoverageBounds(mergedBounds);

    return {
      ...meta,
      epsgCode: code,
      isGeoReferenced: true,
      bounds: mergedBounds,
      center: coverageSummary.center,
      nativeWidth: coverageSummary.nativeWidth,
      nativeHeight: coverageSummary.nativeHeight,
      suggestedResolution: coverageSummary.suggestedResolution,
      nativeMetersPerPixel: coverageSummary.nativeMetersPerPixel,
      gridTiles: resolvedTiles,
    };
  }

  const projectedBounds = meta.sourceBoundsProjected;
  if (!projectedBounds) {
    return {
      ...meta,
      epsgCode: code,
      isGeoReferenced: true,
      bounds: null,
      center: null,
      nativeWidth: null,
      nativeHeight: null,
      suggestedResolution: null,
      nativeMetersPerPixel: null,
      gridTiles: [],
    };
  }

  const sourceWidth = Number(meta.sourceWidth || 0);
  const sourceHeight = Number(meta.sourceHeight || 0);
  if (sourceWidth <= 0 || sourceHeight <= 0) {
    return {
      ...meta,
      epsgCode: code,
      isGeoReferenced: true,
      bounds: null,
      center: null,
      nativeWidth: null,
      nativeHeight: null,
      suggestedResolution: null,
      nativeMetersPerPixel: null,
      gridTiles: [],
    };
  }

  const resX = (projectedBounds.east - projectedBounds.west) / sourceWidth;
  const resY = (projectedBounds.south - projectedBounds.north) / sourceHeight;
  const geoMeta = await computeGeoMetadata({
    epsgCode: code,
    sourceWidth,
    sourceHeight,
    originX: projectedBounds.west,
    originY: projectedBounds.north,
    resX,
    resY,
    useSampleSpacing: false,
    logPrefix: 'ascLoader',
  });

  const bounds = geoMeta.bounds;
  return {
    ...meta,
    epsgCode: code,
    isGeoReferenced: true,
    bounds,
    center: geoMeta.center,
    nativeWidth: geoMeta.nativeWidth,
    nativeHeight: geoMeta.nativeHeight,
    suggestedResolution: geoMeta.suggestedResolution,
    nativeMetersPerPixel: geoMeta.nativeMetersPerPixel,
    gridTiles: bounds
      ? [{
          raster: meta.raster,
          width: sourceWidth,
          height: sourceHeight,
          originX: projectedBounds.west,
          originY: projectedBounds.north,
          resX,
          resY,
          epsgCode: code,
          bounds,
          noData: meta.noData,
          sourceName: meta.gridTiles?.[0]?.sourceName || 'uploaded.asc',
        }]
      : [],
  };
};

const PLACED_MIN_M = 8;            // a grid smaller than this, or larger than
const PLACED_MAX_M = 400000;       // this, is not metres on the ground: left to be fitted
const M_PER_DEG_LAT = 111320;

/** Whether an ASC upload has no location of its own but a size in its own units (taken as metres). */
export const ascNeedsPlacing = (meta) => !!meta
  && (meta.sourceFormat === 'asc' || meta.sourceFormat === 'asc-multi')
  && !meta.bounds && !meta.epsgCode
  && ascTileSourcesOf(meta).length > 0;

const ascTileSourcesOf = (meta) => {
  const ok = (t) => t?.raster && t.width > 0 && t.height > 0 && t.sourceBoundsProjected
    && ['north', 'south', 'east', 'west'].every((k) => Number.isFinite(t.sourceBoundsProjected[k]));
  if (meta?.sourceFormat === 'asc-multi') return (meta.ascTileSources || []).filter(ok);
  const one = { raster: meta?.raster, width: Number(meta?.sourceWidth || 0), height: Number(meta?.sourceHeight || 0), noData: meta?.noData, sourceBoundsProjected: meta?.sourceBoundsProjected, sourceName: 'uploaded.asc' };
  return ok(one) ? [one] : [];
};

/** The ground size (m) of an ASC upload with no location: { width, height }, or null when it is not a plausible one. */
export const ascGroundSize = (meta) => {
  const tiles = ascTileSourcesOf(meta);
  if (!tiles.length) return null;
  const west = Math.min(...tiles.map((t) => t.sourceBoundsProjected.west));
  const east = Math.max(...tiles.map((t) => t.sourceBoundsProjected.east));
  const south = Math.min(...tiles.map((t) => t.sourceBoundsProjected.south));
  const north = Math.max(...tiles.map((t) => t.sourceBoundsProjected.north));
  const width = east - west; const height = north - south;
  if (!(width >= PLACED_MIN_M && height >= PLACED_MIN_M && width <= PLACED_MAX_M && height <= PLACED_MAX_M)) return null;
  return { width, height, west, east, south, north };
};

/**
 * An ASC grid with no location (a local grid from 0,0: a game's heightmap, a
 * CAD export) put on the map at its real size, its middle on `center`, its
 * cell size taken as metres. It was stretched over whatever square was
 * selected: a 4 km grid squeezed into 1 km, or a 2:1 grid made square.
 * Several files keep their places beside each other. Returns the meta with
 * bounds and grid tiles in degrees (the app's own metres-per-degree), or the
 * meta unchanged when it has a location or no plausible size.
 */
export const placeAscAtCenter = (meta, center) => {
  if (!ascNeedsPlacing(meta) || !Number.isFinite(center?.lat) || !Number.isFinite(center?.lng)) return meta;
  const size = ascGroundSize(meta);
  if (!size) return meta;
  const mLat = M_PER_DEG_LAT;
  const mLng = M_PER_DEG_LAT * Math.cos((center.lat * Math.PI) / 180);
  if (!(mLng > 1)) return meta;
  const cx = (size.west + size.east) / 2; const cy = (size.south + size.north) / 2;
  const lng = (x) => center.lng + (x - cx) / mLng;
  const lat = (y) => center.lat + (y - cy) / mLat;
  const gridTiles = ascTileSourcesOf(meta).map((t) => {
    const b = t.sourceBoundsProjected;
    const bounds = { north: lat(b.north), south: lat(b.south), east: lng(b.east), west: lng(b.west) };
    return {
      raster: t.raster, width: t.width, height: t.height,
      originX: bounds.west, originY: bounds.north,
      resX: (bounds.east - bounds.west) / t.width, resY: (bounds.south - bounds.north) / t.height,
      epsgCode: 4326, bounds, noData: t.noData, sourceName: t.sourceName || 'uploaded.asc',
    };
  });
  const bounds = { north: lat(size.north), south: lat(size.south), east: lng(size.east), west: lng(size.west) };
  if (bounds.north > 90 || bounds.south < -90 || bounds.east > 180 || bounds.west < -180) return meta;
  const summary = summarizeCoverageBounds(bounds);
  return {
    ...meta,
    bounds,
    center: summary.center,
    nativeWidth: summary.nativeWidth,
    nativeHeight: summary.nativeHeight,
    suggestedResolution: summary.suggestedResolution,
    nativeMetersPerPixel: summary.nativeMetersPerPixel,
    gridTiles,
    placedAtCenter: true,
  };
};

export const parseAscFile = async (file) => {
  const text = await file.text();
  return parseAscText(text, {
    fileName: file?.name || null,
    fileSize: file?.size || 0,
  });
};
