import { XMLParser } from 'fast-xml-parser';
import JSZip from 'jszip';
import {
  computeGeoMetadata,
  detectUnitFromText,
  UNIT_UNKNOWN,
  summarizeCoverageBounds,
  VALID_UPLOAD_RESOLUTIONS,
} from './uploadGeoMetadata.js';

const GML_NO_DATA = -99999;

const gmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  removeNSPrefix: true,
  parseTagValue: false,
  trimValues: true,
  textNodeName: '#text',
});


const asArray = (value) => {
  if (value == null) return [];
  return Array.isArray(value) ? value : [value];
};

const getNodeText = (node) => {
  if (node == null) return '';
  if (typeof node === 'string' || typeof node === 'number' || typeof node === 'boolean') {
    return String(node);
  }
  if (typeof node === 'object') {
    if (typeof node['#text'] === 'string') return node['#text'];
    for (const value of Object.values(node)) {
      if (typeof value === 'string') return value;
      if (value && typeof value === 'object') {
        const nested = getNodeText(value);
        if (nested) return nested;
      }
    }
  }
  return '';
};

const findFirstNode = (node, predicate) => {
  if (!node || typeof node !== 'object') return null;
  if (Array.isArray(node)) {
    for (const item of node) {
      const found = findFirstNode(item, predicate);
      if (found) return found;
    }
    return null;
  }

  for (const [key, value] of Object.entries(node)) {
    if (predicate(key, value)) return value;
    const found = findFirstNode(value, predicate);
    if (found) return found;
  }
  return null;
};

const parseNumberList = (text) => {
  if (!text) return [];
  return String(text)
    .trim()
    .split(/\s+/)
    .map(Number)
    .filter((value) => Number.isFinite(value));
};

const getTupleNumericValue = (chunk) => {
  if (!chunk) return GML_NO_DATA;
  const pieces = String(chunk)
    .split(',')
    .map((piece) => piece.trim())
    .filter(Boolean);

  for (let index = pieces.length - 1; index >= 0; index--) {
    const value = Number(pieces[index]);
    if (Number.isFinite(value)) return value;
  }

  const fallback = Number(String(chunk).trim());
  return Number.isFinite(fallback) ? fallback : GML_NO_DATA;
};

const looksLikeGeographicLatLng = (first, second) => (
  Number.isFinite(first)
  && Number.isFinite(second)
  && Math.abs(first) <= 90
  && Math.abs(second) <= 180
  && Math.abs(second) > 90
);

const parseEpsgCode = (srsName) => {
  if (!srsName || typeof srsName !== 'string') return null;
  if (!/epsg/i.test(srsName)) return null;
  const match = srsName.match(/(\d{4,6})(?!.*\d)/);
  if (!match) return null;
  const code = Number(match[1]);
  return Number.isFinite(code) ? code : null;
};

export const isGmlLikeFilename = (name) => {
  const lower = String(name || '').toLowerCase();
  return lower.endsWith('.gml') || lower.endsWith('.xml');
};

export const isLikelyGmlText = (text) => {
  if (!text || typeof text !== 'string') return false;
  return text.includes('http://www.opengis.net/gml') || text.includes('<gml:') || text.includes(':Grid');
};

const extractRangeValues = (rangeSet) => {
  const dataBlock = findFirstNode(rangeSet, (key) => key === 'DataBlock');
  if (dataBlock) {
    const tupleList = dataBlock.tupleList;
    if (tupleList) {
      const tupleText = getNodeText(tupleList);
      const tupleSep = tupleList?.['@_ts'] || ' ';
      const tupleChunks = tupleSep === ' '
        ? tupleText.split(/\s+/)
        : tupleText.split(tupleSep);
      return tupleChunks
        .map((chunk) => chunk.trim())
        .filter(Boolean)
        .map((chunk) => getTupleNumericValue(chunk));
    }

    const nilTupleList = dataBlock.doubleOrNilReasonTupleList;
    if (nilTupleList) {
      return getNodeText(nilTupleList)
        .split(/\s+/)
        .map((token) => Number(token))
        .map((value) => (Number.isFinite(value) ? value : GML_NO_DATA));
    }
  }

  const scalarList = findFirstNode(rangeSet, (key) => (
    key === 'doubleOrNilReasonTupleList'
    || key === 'value'
    || key === 'integerValue'
    || key === 'doubleValue'
    || key === 'QuantityList'
    || key === 'CountList'
  ));
  if (!scalarList) return [];

  if (Array.isArray(scalarList)) {
    return scalarList
      .map((value) => Number(getNodeText(value)))
      .map((value) => (Number.isFinite(value) ? value : GML_NO_DATA));
  }

  return getNodeText(scalarList)
    .split(/\s+/)
    .map((token) => Number(token))
    .map((value) => (Number.isFinite(value) ? value : GML_NO_DATA));
};

const parseEnvelopeBounds = (coverageNode) => {
  const envelope = findFirstNode(coverageNode, (key) => key === 'Envelope');
  if (!envelope) return null;

  const lower = parseNumberList(getNodeText(envelope.lowerCorner));
  const upper = parseNumberList(getNodeText(envelope.upperCorner));
  if (lower.length < 2 || upper.length < 2) return null;

  let west;
  let east;
  let south;
  let north;

  if (looksLikeGeographicLatLng(lower[0], lower[1]) || looksLikeGeographicLatLng(upper[0], upper[1])) {
    south = Math.min(lower[0], upper[0]);
    north = Math.max(lower[0], upper[0]);
    west = Math.min(lower[1], upper[1]);
    east = Math.max(lower[1], upper[1]);
  } else {
    west = Math.min(lower[0], upper[0]);
    east = Math.max(lower[0], upper[0]);
    south = Math.min(lower[1], upper[1]);
    north = Math.max(lower[1], upper[1]);
  }

  return {
    bounds: { north, south, east, west },
    srsName: envelope['@_srsName'] || null,
  };
};

const combineParsedGridSources = (sources, fileSize = 0) => {
  if (!sources.length) {
    throw new Error('Unsupported GML ZIP: no supported GML coverage files found.');
  }

  const gridTiles = sources.flatMap((source) => source.gridTiles || []);
  if (!gridTiles.length) {
    throw new Error('Unsupported GML ZIP: no grid tiles were parsed.');
  }

  const boundedSources = sources.filter((source) => source.bounds);
  const bounds = boundedSources.length
    ? {
        north: Math.max(...boundedSources.map((source) => source.bounds.north)),
        south: Math.min(...boundedSources.map((source) => source.bounds.south)),
        east: Math.max(...boundedSources.map((source) => source.bounds.east)),
        west: Math.min(...boundedSources.map((source) => source.bounds.west)),
      }
    : null;
  const summary = summarizeCoverageBounds(bounds);
  const epsgCodes = [...new Set(sources.map((source) => source.epsgCode).filter((code) => Number.isFinite(code)))];
  const verticalUnits = [...new Set(sources.map((source) => source.verticalUnitDetected).filter((unit) => unit && unit !== UNIT_UNKNOWN))];

  return {
    sourceType: 'grid',
    sourceFormat: 'gml-zip',
    formatLabel: 'GML ZIP',
    raster: null,
    sourceWidth: null,
    sourceHeight: null,
    noData: GML_NO_DATA,
    epsgCode: epsgCodes.length === 1 ? epsgCodes[0] : null,
    isGeoTiff: false,
    isGeoReferenced: !!bounds,
    bounds,
    center: summary.center,
    nativeWidth: summary.nativeWidth,
    nativeHeight: summary.nativeHeight,
    suggestedResolution: summary.suggestedResolution,
    nativeMetersPerPixel: summary.nativeMetersPerPixel,
    fileSize,
    verticalUnitDetected: verticalUnits.length === 1 ? verticalUnits[0] : UNIT_UNKNOWN,
    verticalUnitDetectionSource: verticalUnits.length === 1 ? 'GML ZIP metadata' : null,
    gridTiles,
    sourceFileCount: sources.length,
  };
};

const fillRasterFromStartPoint = ({
  raster,
  rangeValues,
  low,
  high,
  sourceWidth,
  startPoint,
}) => {
  const startX = startPoint.length >= 1 ? startPoint[0] : low[0];
  const startY = startPoint.length >= 2 ? startPoint[1] : low[1];

  if (
    startX < low[0] || startX > high[0]
    || startY < low[1] || startY > high[1]
  ) {
    throw new Error('Unsupported GML: startPoint is outside the declared grid extent.');
  }

  const startIndex = (startY - low[1]) * sourceWidth + (startX - low[0]);
  const writableCount = raster.length - startIndex;
  if (rangeValues.length < writableCount) {
    throw new Error(`Unsupported GML: expected ${writableCount} elevation values from startPoint, found ${rangeValues.length}.`);
  }

  for (let index = 0; index < writableCount; index++) {
    const value = rangeValues[index];
    raster[startIndex + index] = Number.isFinite(value) ? value : GML_NO_DATA;
  }
};

const parseGridCoverageNode = async (coverageNode, fileSize = 0) => {
  const grid = findFirstNode(coverageNode, (key) => key === 'RectifiedGrid' || key === 'Grid');
  if (!grid) {
    throw new Error('Unsupported GML: missing grid definition.');
  }

  const low = parseNumberList(getNodeText(grid?.limits?.GridEnvelope?.low));
  const high = parseNumberList(getNodeText(grid?.limits?.GridEnvelope?.high));
  if (low.length < 2 || high.length < 2) {
    throw new Error('Unsupported GML: missing 2D grid limits.');
  }

  const sourceWidth = Math.round(high[0] - low[0] + 1);
  const sourceHeight = Math.round(high[1] - low[1] + 1);
  if (sourceWidth <= 0 || sourceHeight <= 0) {
    throw new Error('Unsupported GML: invalid grid dimensions.');
  }

  const isRectifiedGrid = !!findFirstNode(coverageNode, (key) => key === 'RectifiedGrid');
  const envelopeInfo = parseEnvelopeBounds(coverageNode);
  const coverageFunction = coverageNode.coverageFunction?.GridFunction || coverageNode.GridFunction || null;
  const sequenceRule = getNodeText(coverageFunction?.sequenceRule || '').trim() || 'Linear';
  const sequenceOrder = getNodeText(coverageFunction?.sequenceRule?.['@_order'] || '').trim();
  const startPoint = parseNumberList(getNodeText(coverageFunction?.startPoint));
  const supportedStartPoint = startPoint.length === 0 || startPoint.length >= 2;
  const supportedSequenceOrder = sequenceOrder === '' || sequenceOrder === '+x-y' || sequenceOrder === '+x+y';
  if (sequenceRule !== 'Linear' || !supportedSequenceOrder || !supportedStartPoint) {
    throw new Error('Unsupported GML: only linear x-major grid functions are supported.');
  }

  const rangeValues = extractRangeValues(coverageNode.rangeSet || coverageNode);
  const expectedValues = sourceWidth * sourceHeight;
  const raster = new Float32Array(expectedValues).fill(GML_NO_DATA);
  fillRasterFromStartPoint({
    raster,
    rangeValues,
    low,
    high,
    sourceWidth,
    startPoint,
  });

  let epsgCode = null;
  let bounds = null;
  let center = null;
  let nativeWidth = null;
  let nativeHeight = null;
  let suggestedResolution = null;
  let nativeMetersPerPixel = null;
  let gridTile = null;

  if (isRectifiedGrid) {
    const originText = getNodeText(grid?.origin?.Point?.pos || grid?.origin?.pos || grid?.origin?.Point || grid?.origin);
    const originCoords = parseNumberList(originText);
    if (originCoords.length < 2) {
      throw new Error('Unsupported GML: missing grid origin.');
    }

    const offsetVectors = asArray(grid.offsetVector).map((entry) => parseNumberList(getNodeText(entry)));
    if (offsetVectors.length < 2 || offsetVectors.some((vector) => vector.length < 2)) {
      throw new Error('Unsupported GML: expected two 2D offset vectors.');
    }

    const [vectorA, vectorB] = offsetVectors;
    const xVector = Math.abs(vectorA[0]) >= Math.abs(vectorA[1]) ? vectorA : vectorB;
    const yVector = xVector === vectorA ? vectorB : vectorA;
    const tolerance = 1e-9;
    if (Math.abs(xVector[1]) > tolerance || Math.abs(yVector[0]) > tolerance) {
      throw new Error('Unsupported GML: rotated or skewed rectified grids are not supported yet.');
    }

    const srsName = grid?.['@_srsName'] || grid?.origin?.Point?.['@_srsName'] || grid?.origin?.['@_srsName'] || envelopeInfo?.srsName || null;
    epsgCode = parseEpsgCode(srsName);
    const geoMeta = await computeGeoMetadata({
      epsgCode,
      sourceWidth,
      sourceHeight,
      originX: originCoords[0],
      originY: originCoords[1],
      resX: xVector[0],
      resY: yVector[1],
      useSampleSpacing: true,
      logPrefix: 'gmlLoader',
    });

    bounds = geoMeta.bounds;
    center = geoMeta.center;
    nativeWidth = geoMeta.nativeWidth;
    nativeHeight = geoMeta.nativeHeight;
    suggestedResolution = geoMeta.suggestedResolution;
    nativeMetersPerPixel = geoMeta.nativeMetersPerPixel;

    gridTile = {
      raster,
      width: sourceWidth,
      height: sourceHeight,
      originX: originCoords[0],
      originY: originCoords[1],
      resX: xVector[0],
      resY: yVector[1],
      noData: GML_NO_DATA,
      epsgCode,
    };
  } else if (envelopeInfo?.bounds) {
    bounds = envelopeInfo.bounds;
    center = {
      lat: (bounds.north + bounds.south) / 2,
      lng: (bounds.east + bounds.west) / 2,
    };

    const midLat = center.lat;
    const mPerDegLat = 111320;
    const mPerDegLng = 111320 * Math.cos(midLat * Math.PI / 180);
    const coverageWm = Math.abs(bounds.east - bounds.west) * mPerDegLng;
    const coverageHm = Math.abs(bounds.north - bounds.south) * mPerDegLat;
    nativeWidth = Math.max(1, Math.round(coverageWm));
    nativeHeight = Math.max(1, Math.round(coverageHm));
    const mppX = coverageWm / Math.max(1, sourceWidth - 1);
    const mppY = coverageHm / Math.max(1, sourceHeight - 1);
    const mppAvg = (mppX + mppY) / 2;
    nativeMetersPerPixel = Number.isFinite(mppAvg) && mppAvg > 0 ? mppAvg : null;
    const minCoverage = Math.min(coverageWm, coverageHm);
    const raw = Math.pow(2, Math.floor(Math.log2(Math.max(1, minCoverage))));
    suggestedResolution = VALID_UPLOAD_RESOLUTIONS.filter((r) => r <= raw).pop() ?? VALID_UPLOAD_RESOLUTIONS[0];

    const srsName = grid?.['@_srsName'] || envelopeInfo.srsName || null;
    epsgCode = parseEpsgCode(srsName);
    const resX = sourceWidth > 1 ? (bounds.east - bounds.west) / (sourceWidth - 1) : 0;
    const resY = sourceHeight > 1 ? -(bounds.north - bounds.south) / (sourceHeight - 1) : 0;
    gridTile = {
      raster,
      width: sourceWidth,
      height: sourceHeight,
      originX: bounds.west,
      originY: bounds.north,
      resX,
      resY,
      noData: GML_NO_DATA,
      epsgCode,
    };
  } else {
    throw new Error('Unsupported GML: missing georeferencing information.');
  }

  let verticalUnitDetected = UNIT_UNKNOWN;
  const rangeTypeText = getNodeText(findFirstNode(coverageNode, (key) => key === 'Quantity' || key === 'QuantityType'));
  const fromRangeType = detectUnitFromText(rangeTypeText);
  if (fromRangeType !== UNIT_UNKNOWN) {
    verticalUnitDetected = fromRangeType;
  }

  return {
    sourceType: 'grid',
    sourceFormat: 'gml',
    formatLabel: 'GML',
    raster,
    sourceWidth,
    sourceHeight,
    noData: GML_NO_DATA,
    epsgCode,
    isGeoTiff: false,
    isGeoReferenced: !!bounds,
    bounds,
    center,
    nativeWidth,
    nativeHeight,
    suggestedResolution,
    nativeMetersPerPixel,
    fileSize,
    verticalUnitDetected,
    verticalUnitDetectionSource: verticalUnitDetected === UNIT_UNKNOWN ? null : 'GML metadata',
    gridTiles: gridTile ? [gridTile] : [],
  };
};

const parseGmlCoverageText = async (text, fileSize = 0) => {
  const xml = gmlParser.parse(text);
  const coverage = findFirstNode(xml, (key, value) => {
    if (key === 'RectifiedGridCoverage' || key === 'GridCoverage') return true;
    if (key !== 'coverage' || !value || typeof value !== 'object') return false;
    return !!findFirstNode(value, (childKey) => childKey === 'Grid' || childKey === 'RectifiedGrid');
  });
  if (!coverage) {
    throw new Error('Unsupported GML: expected a grid coverage.');
  }
  const parsed = await parseGridCoverageNode(coverage, fileSize);
  if (parsed.verticalUnitDetected === UNIT_UNKNOWN) {
    parsed.verticalUnitDetected = detectUnitFromText(text);
    parsed.verticalUnitDetectionSource = parsed.verticalUnitDetected === UNIT_UNKNOWN ? null : 'GML metadata';
  }
  return parsed;
};

export const parseGmlText = async (text) => parseGmlCoverageText(text, 0);

export const parseGmlFile = async (file) => {
  const text = await file.text();
  return parseGmlCoverageText(text, file.size);
};

export const parseGmlZipFile = async (file) => {
  const archive = await JSZip.loadAsync(await file.arrayBuffer());
  const entries = Object.values(archive.files)
    .filter((entry) => !entry.dir && isGmlLikeFilename(entry.name));

  if (!entries.length) {
    throw new Error('Unsupported ZIP: no .gml or .xml files found.');
  }

  const parsedSources = [];
  for (const entry of entries) {
    const text = await entry.async('text');
    if (!isLikelyGmlText(text)) continue;
    parsedSources.push(await parseGmlCoverageText(text, entry._data?.uncompressedSize || 0));
  }

  return combineParsedGridSources(parsedSources, file.size);
};