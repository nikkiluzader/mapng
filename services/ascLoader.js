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

const toGeographicBounds = (west, east, south, north) => {
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
  const geographicBounds = toGeographicBounds(west, east, south, north);
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

export const applyAscCoordinateSystem = async (meta, epsgCode) => {
  if (!meta || meta.sourceFormat !== 'asc') return meta;
  const code = Number(epsgCode);
  if (!Number.isFinite(code) || code <= 0) {
    return {
      ...meta,
      epsgCode: null,
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

export const parseAscFile = async (file) => {
  const text = await file.text();
  return parseAscText(text, {
    fileName: file?.name || null,
    fileSize: file?.size || 0,
  });
};
