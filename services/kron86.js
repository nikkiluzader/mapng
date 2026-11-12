import JSZip from 'jszip';
import { isLikelyAscText, parseAscText, applyAscCoordinateSystem } from './ascLoader.js';

const KRON86_PROXY_PREFIX = '/api/kron86';
const KRON86_OPENDATA_PROXY_PREFIX = '/api/kron86-opendata';
const KRON86_INDEX_PATH = '/wss/service/PZGIK/NumerycznyModelTerenuEVRF2007/WFS/Skorowidze';
const KRON86_LAYER_PREFIX = 'gugik:SkorowidzNMT';
const KRON86_MIN_YEAR = 2018;
// (the index gains a layer a year: every year the service lists is asked, up to this one.
// Held at 2020, MapNG saw only the 2018-2020 sheets: in the Beskids those are a 5 m grid,
// while the 1 m lidar sheets of 2021, 2022, 2024 and 2025 were never looked at, and a level
// came out "like 30 m data")
const KRON86_MAX_YEAR = Math.max(2026, new Date().getUTCFullYear());
const KRON86_DEFAULT_YEAR = KRON86_MAX_YEAR;
const KRON86_MAX_REDIRECTS = 6;
const KRON86_LOG_PREFIX = '[NMT-EVRF2007]';
// (the geoportal's firewall answers "Request Rejected" to "Accept-Language: *", which is what
// Node's own fetch sends when none is given: every request names one)
const KRON86_ACCEPT_LANGUAGE = 'pl,en;q=0.8';

const logInfo = (...args) => console.info(KRON86_LOG_PREFIX, ...args);
const logWarn = (...args) => console.warn(KRON86_LOG_PREFIX, ...args);

const formatHeaderNumber = (value) => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return String(value ?? 'n/a');
  return Number.isInteger(numeric) ? String(numeric) : numeric.toFixed(2);
};

const extractAscHeaderFields = (text) => {
  const lines = String(text || '').split(/\r?\n/).slice(0, 32);
  const header = {
    ncols: null,
    nrows: null,
    xllcenter: null,
    yllcenter: null,
    cellsize: null,
    nodata_value: null,
  };

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;
    const parts = line.split(/\s+/);
    if (parts.length < 2) continue;
    const key = parts[0].toLowerCase();
    const value = parts[1];
    if (!(key in header)) continue;
    const parsed = Number(value);
    header[key] = Number.isFinite(parsed) ? parsed : value;
  }

  const hasAllFields = Object.values(header).every((value) => value != null);
  return { header, hasAllFields };
};

const logAscHeaderDiagnostics = (sourceName, headerLike) => {
  if (!headerLike) return;
  const lines = [
    `ncols ${formatHeaderNumber(headerLike.ncols)}`,
    `nrows ${formatHeaderNumber(headerLike.nrows)}`,
    `xllcenter ${formatHeaderNumber(headerLike.xllcenter)}`,
    `yllcenter ${formatHeaderNumber(headerLike.yllcenter)}`,
    `cellsize ${formatHeaderNumber(headerLike.cellsize)}`,
    `nodata_value ${formatHeaderNumber(headerLike.nodata_value)}`,
  ];
  logInfo(`ASC header diagnostics (${sourceName}):\n${lines.join('\n')}`);
};

export const KRON86_POLAND_BOUNDS = {
  west: 13.70,
  south: 48.64,
  east: 24.87,
  north: 55.03,
};

const clampKron86Year = (value) => {
  const year = Number(value);
  if (!Number.isFinite(year)) return KRON86_DEFAULT_YEAR;
  return Math.min(KRON86_MAX_YEAR, Math.max(KRON86_MIN_YEAR, Math.trunc(year)));
};

const intersectsBounds = (a, b) => {
  if (!a || !b) return false;
  return !(a.east <= b.west || a.west >= b.east || a.north <= b.south || a.south >= b.north);
};

export const isWithinKron86Coverage = (bounds) => intersectsBounds(bounds, KRON86_POLAND_BOUNDS);

const decodeXmlEntities = (value) => String(value || '')
  .replace(/&amp;/g, '&')
  .replace(/&lt;/g, '<')
  .replace(/&gt;/g, '>')
  .replace(/&quot;/g, '"')
  .replace(/&#39;/g, "'");

const normalizeUrl = (value) => decodeXmlEntities(value).trim();

const parseNumberReturned = (xmlText) => {
  const match = String(xmlText || '').match(/numberReturned="(\d+)"/i);
  if (!match) return null;
  const parsed = Number.parseInt(match[1], 10);
  return Number.isFinite(parsed) ? parsed : null;
};

const parseEpsgFromUklad = (ukladText) => {
  const text = String(ukladText || '').toUpperCase();
  if (!text) return 2180;
  if (text.includes('PL-1992')) return 2180;
  if (text.includes('PL-2000:S5') || text.includes('PL-2000 S5')) return 2176;
  if (text.includes('PL-2000:S6') || text.includes('PL-2000 S6')) return 2177;
  if (text.includes('PL-2000:S7') || text.includes('PL-2000 S7')) return 2178;
  if (text.includes('PL-2000:S8') || text.includes('PL-2000 S8')) return 2179;
  return 2180;
};

const extractAvailableYearsFromCapabilities = (xmlText) => {
  const out = new Set();
  const pattern = /SkorowidzNMT(\d{4})/gi;
  let match = pattern.exec(String(xmlText || ''));
  while (match) {
    const year = Number.parseInt(match[1], 10);
    if (Number.isFinite(year) && year >= KRON86_MIN_YEAR && year <= KRON86_MAX_YEAR) {
      out.add(year);
    }
    match = pattern.exec(String(xmlText || ''));
  }
  return [...out].sort((a, b) => b - a);
};

const extractLinkCandidatesFromFeatureXml = (xmlText) => {
  const text = String(xmlText || '');
  const memberPattern = /<wfs:member\b[\s\S]*?<\/wfs:member>/gi;
  const urlPattern = /<(?:[\w.-]+:)?url_do_pobrania\b[^>]*>([^<]+)</i;
  const ukladPattern = /<(?:[\w.-]+:)?uklad_xy\b[^>]*>([^<]+)</i;
  const formatPattern = /<(?:[\w.-]+:)?format\b[^>]*>([^<]+)</i;
  const godloPattern = /<(?:[\w.-]+:)?godlo\b[^>]*>([^<]+)</i;
  // (the sheet's grid spacing, "1.00 m" or "5.00 m", and its mean height error in metres)
  const spacingPattern = /<(?:[\w.-]+:)?char_przestrz\b[^>]*>([^<]+)</i;
  const errorPattern = /<(?:[\w.-]+:)?blad_sr_wys\b[^>]*>([^<]+)</i;

  const out = [];
  const seen = new Set();
  for (const member of text.match(memberPattern) || []) {
    const rawUrl = member.match(urlPattern)?.[1];
    if (!rawUrl) continue;
    const url = normalizeUrl(rawUrl);
    if (!/^https?:\/\//i.test(url)) continue;
    const godlo = decodeXmlEntities(member.match(godloPattern)?.[1] || '').trim();
    // (one sheet can be listed twice in a year, as a 1 m and a 5 m grid or in two formats:
    // all are kept, and pickBestNmtTiles chooses)
    if (seen.has(url)) continue;
    seen.add(url);

    const uklad = decodeXmlEntities(member.match(ukladPattern)?.[1] || '').trim();
    const format = decodeXmlEntities(member.match(formatPattern)?.[1] || '').trim();
    out.push({
      url,
      godlo,
      uklad,
      format,
      resolutionM: Number.parseFloat(decodeXmlEntities(member.match(spacingPattern)?.[1] || '').replace(',', '.')) || null,
      heightErrorM: Number.parseFloat(decodeXmlEntities(member.match(errorPattern)?.[1] || '').replace(',', '.')) || null,
      epsgCode: parseEpsgFromUklad(uklad),
    });
  }
  return out;
};

// A regular grid first (what the app reads directly), then the point formats.
const formatRank = (format) => { const f = String(format || '').toUpperCase(); return f.includes('ASCII GRID') ? 0 : f.includes('XYZ') ? 1 : 2; };

/**
 * One download per map sheet from everything the index lists for an area
 * (candidates: [{ url, godlo, year, format, resolutionM, heightErrorM }]): the finest
 * grid, then a regular grid over point lists, then the newest year, then the smaller
 * height error. A sheet only ever surveyed at 5 m stays 5 m.
 */
export function pickBestNmtTiles(candidates) {
  const best = new Map();
  const better = (a, b) => {
    const ra = a.resolutionM ?? Infinity; const rb = b.resolutionM ?? Infinity;
    if (ra !== rb) return ra < rb;
    if (formatRank(a.format) !== formatRank(b.format)) return formatRank(a.format) < formatRank(b.format);
    if ((a.year || 0) !== (b.year || 0)) return (a.year || 0) > (b.year || 0);
    return (a.heightErrorM ?? Infinity) < (b.heightErrorM ?? Infinity);
  };
  for (const c of candidates || []) {
    const key = c.godlo || c.url;
    const have = best.get(key);
    if (!have || better(c, have)) best.set(key, c);
  }
  return [...best.values()];
}

const buildYearCandidates = (preferredYear) => {
  const startYear = clampKron86Year(preferredYear);
  const years = [];
  for (let y = startYear; y >= KRON86_MIN_YEAR; y--) years.push(y);
  for (let y = startYear + 1; y <= KRON86_MAX_YEAR; y++) years.push(y);
  return years;
};

const buildGetCapabilitiesUrl = () => {
  const params = new URLSearchParams({
    SERVICE: 'WFS',
    VERSION: '2.0.0',
    REQUEST: 'GetCapabilities',
  });
  return `${KRON86_PROXY_PREFIX}${KRON86_INDEX_PATH}?${params.toString()}`;
};

const toProxyPath = (absoluteUrl) => {
  try {
    const parsed = new URL(absoluteUrl);
    // Download links are hosted directly on opendata.geoportal.gov.pl.
    // Keep the original path so the proxy fetches the file directly.
    if (parsed.hostname === 'opendata.geoportal.gov.pl') {
      return `${KRON86_OPENDATA_PROXY_PREFIX}${parsed.pathname}${parsed.search}`;
    }
    if (parsed.hostname === 'mapy.geoportal.gov.pl') {
      return `${KRON86_PROXY_PREFIX}${parsed.pathname}${parsed.search}`;
    }
    return absoluteUrl;
  } catch {
    return absoluteUrl;
  }
};

const buildGetFeatureUrl = (bounds, year = KRON86_DEFAULT_YEAR) => {
  const selectedYear = clampKron86Year(year);
  const params = new URLSearchParams({
    SERVICE: 'WFS',
    VERSION: '2.0.0',
    REQUEST: 'GetFeature',
    TYPENAMES: `${KRON86_LAYER_PREFIX}${selectedYear}`,
    SRSNAME: 'urn:ogc:def:crs:EPSG::4326',
    BBOX: `${bounds.south},${bounds.west},${bounds.north},${bounds.east},urn:ogc:def:crs:EPSG::4326`,
  });

  return `${KRON86_PROXY_PREFIX}${KRON86_INDEX_PATH}?${params.toString()}`;
};

const toPseudoAscMeta = (raster, width, height, west, east, south, north, noData, sourceName) => ({
  sourceType: 'grid',
  sourceFormat: 'asc',
  formatLabel: 'NMT EVRF2007 Grid',
  raster,
  sourceWidth: width,
  sourceHeight: height,
  isGeoTiff: false,
  isGeoReferenced: false,
  epsgCode: null,
  sourceBoundsProjected: { west, east, south, north },
  sourceCrsSelectable: false,
  bounds: null,
  center: null,
  nativeWidth: null,
  nativeHeight: null,
  suggestedResolution: null,
  nativeMetersPerPixel: null,
  noData,
  gridTiles: [],
  fileSize: raster.byteLength,
  verticalUnitDetected: 'meters',
  verticalUnitDetectionSource: 'NMT-EVRF2007',
  sourceName,
});

const parseKron86PointGridText = async (text, epsgCode, sourceName) => {
  const lines = String(text || '').split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (lines.length === 0) return null;

  const points = [];
  const eastSet = new Set();
  const northSet = new Set();

  for (const line of lines) {
    const parts = line.split(/\s+/);
    if (parts.length < 3) continue;
    // EVRF/KRON86 point-grid rows are X Y Z => Easting Northing Height.
    const east = Number(parts[0]);
    const north = Number(parts[1]);
    const elevation = Number(parts[2]);
    if (!Number.isFinite(north) || !Number.isFinite(east) || !Number.isFinite(elevation)) continue;
    points.push({ east, north, elevation });
    eastSet.add(east);
    northSet.add(north);
  }

  if (points.length === 0) return null;

  const eastValues = [...eastSet].sort((a, b) => a - b);
  const northValues = [...northSet].sort((a, b) => b - a);
  const width = eastValues.length;
  const height = northValues.length;
  if (width < 2 || height < 2) return null;

  // Guard against non-grid vectors (e.g. breaklines/polygons) that also carry
  // three numeric columns but do not form a dense regular raster lattice.
  const expectedCells = width * height;
  const density = points.length / expectedCells;
  if (!Number.isFinite(density) || density < 0.8 || density > 1.2) {
    return null;
  }

  const resX = eastValues[1] - eastValues[0];
  const resYAbs = northValues[0] - northValues[1];
  if (!Number.isFinite(resX) || !Number.isFinite(resYAbs) || resX <= 0 || resYAbs <= 0) return null;

  const eastIndex = new Map(eastValues.map((value, index) => [value, index]));
  const northIndex = new Map(northValues.map((value, index) => [value, index]));

  const noData = -9999;
  const raster = new Float32Array(width * height);
  raster.fill(noData);

  for (const point of points) {
    const col = eastIndex.get(point.east);
    const row = northIndex.get(point.north);
    if (col == null || row == null) continue;
    raster[row * width + col] = point.elevation;
  }

  const west = eastValues[0] - resX / 2;
  const east = eastValues[width - 1] + resX / 2;
  const north = northValues[0] + resYAbs / 2;
  const south = northValues[height - 1] - resYAbs / 2;

  logAscHeaderDiagnostics(`${sourceName} (inferred point-grid header)`, {
    ncols: width,
    nrows: height,
    xllcenter: eastValues[0],
    yllcenter: northValues[height - 1],
    cellsize: resX,
    nodata_value: noData,
  });

  const pseudoMeta = toPseudoAscMeta(raster, width, height, west, east, south, north, noData, sourceName);
  return applyAscCoordinateSystem(pseudoMeta, epsgCode);
};

const parseKron86ZipArchive = async (buffer, epsgCode, sourceName) => {
  const zip = await JSZip.loadAsync(buffer);
  const fileEntries = Object.values(zip.files).filter((entry) => !entry.dir);
  logInfo('ZIP entries discovered:', fileEntries.map((entry) => entry.name).slice(0, 12));
  if (fileEntries.length === 0) return null;

  const ascEntry = fileEntries.find((entry) => /\.asc$/i.test(entry.name));
  if (ascEntry) {
    const ascText = await ascEntry.async('string');
    const { header, hasAllFields } = extractAscHeaderFields(ascText);
    if (hasAllFields) {
      logAscHeaderDiagnostics(ascEntry.name, header);
    }
    if (isLikelyAscText(ascText)) {
      const parsedAsc = await parseAscText(ascText, { fileName: ascEntry.name, fileSize: ascText.length });
      return applyAscCoordinateSystem(parsedAsc, epsgCode);
    }
  }

  // EVRF archives typically bundle three ASC files:
  //  - *_p.asc: regular point grid (what we need)
  //  - *_o.asc / *_s.asc: auxiliary vectors/surfaces
  const pointGridAsc = fileEntries.find((entry) => /_p\.asc$/i.test(entry.name));
  if (pointGridAsc) {
    const pointGridText = await pointGridAsc.async('string');
    const parsedPointGrid = await parseKron86PointGridText(pointGridText, epsgCode, pointGridAsc.name);
    if (parsedPointGrid?.gridTiles?.length) return parsedPointGrid;
  }

  const grEntry = fileEntries.find((entry) => /_GR\.txt$/i.test(entry.name));
  if (grEntry) {
    const grText = await grEntry.async('string');
    logInfo('Parsing GR point-grid file from ZIP:', grEntry.name, `chars=${grText.length}`);
    return parseKron86PointGridText(grText, epsgCode, grEntry.name);
  }

  // Fallback for alternate point-grid naming (e.g. *.xyz, plain *.asc with
  // XYZ columns but no ESRI ASCII header).
  const xyzLikeEntry = fileEntries.find((entry) => /\.(xyz|txt|asc)$/i.test(entry.name));
  if (xyzLikeEntry) {
    const xyzLikeText = await xyzLikeEntry.async('string');
    const parsedXyzLike = await parseKron86PointGridText(xyzLikeText, epsgCode, xyzLikeEntry.name);
    if (parsedXyzLike?.gridTiles?.length) return parsedXyzLike;
  }

  logWarn('ZIP did not contain supported ASC/GR files:', sourceName);
  return null;
};

const hasZipSignature = (buffer) => {
  if (!(buffer instanceof ArrayBuffer) || buffer.byteLength < 4) return false;
  const bytes = new Uint8Array(buffer, 0, 4);
  // ZIP local file header, empty archive, or split archive signatures.
  return (
    (bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04)
    || (bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x05 && bytes[3] === 0x06)
    || (bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x07 && bytes[3] === 0x08)
  );
};

const decodeBufferToText = (buffer) => {
  const decoder = new TextDecoder('utf-8', { fatal: false });
  return decoder.decode(new Uint8Array(buffer));
};

const fetchWithProxyRedirects = async (initialUrl, signal) => {
  const response = await fetch(initialUrl, {
    method: 'GET',
    signal,
    redirect: 'follow',
    headers: {
      Accept: 'text/plain, application/octet-stream;q=0.8, */*;q=0.5',
      'Accept-Language': KRON86_ACCEPT_LANGUAGE,
    },
  });
  logInfo('Fetch terminal response:', response.status, response.statusText, response.url || initialUrl);
  return response;
};

const tryParseAscFromLink = async (candidate, signal) => {
  const downloadUrl = String(candidate?.url || '');
  const epsgCode = Number.isFinite(Number(candidate?.epsgCode)) ? Number(candidate.epsgCode) : 2180;
  const targetUrl = toProxyPath(downloadUrl);
  logInfo('Attempting download:', { year: candidate?.year, godlo: candidate?.godlo || null, sourceUrl: downloadUrl, proxyUrl: targetUrl, epsgCode });
  const response = await fetchWithProxyRedirects(targetUrl, signal);

  if (!response.ok) {
    logWarn('Download failed with non-OK status:', response.status, response.statusText, downloadUrl);
    return null;
  }

  const contentType = String(response.headers.get('content-type') || '').toLowerCase();
  logInfo('Download content-type:', contentType || '(empty)', downloadUrl);

  const effectiveUrl = String(response.url || downloadUrl || '');
  const looksLikeZipByName = /\.zip(?:$|[?#])/i.test(downloadUrl) || /\.zip(?:$|[?#])/i.test(effectiveUrl);
  const looksLikeAscByName = /\.asc(?:$|[?#])/i.test(downloadUrl) || /\.asc(?:$|[?#])/i.test(effectiveUrl);
  const shouldReadBinary = contentType.includes('zip') || contentType.includes('octet-stream') || looksLikeZipByName;

  let text = null;
  if (shouldReadBinary) {
    const buffer = await response.arrayBuffer();
    logInfo('Processing binary payload bytes:', buffer.byteLength, downloadUrl);

    if (contentType.includes('zip') || looksLikeZipByName || hasZipSignature(buffer)) {
      return parseKron86ZipArchive(buffer, epsgCode, downloadUrl);
    }

    // Some direct ASC files are served as application/octet-stream.
    text = decodeBufferToText(buffer);
    if (looksLikeAscByName) {
      logInfo('Binary payload identified as direct ASC by URL extension:', effectiveUrl || downloadUrl);
    }
  } else {
    text = await response.text();
  }

  if (!isLikelyAscText(text)) {
    const xyzLike = await parseKron86PointGridText(text, epsgCode, downloadUrl);
    if (xyzLike?.gridTiles?.length) return xyzLike;
    logWarn('Text payload is not detected as ASC grid.', downloadUrl, `sample=${text.slice(0, 120).replace(/\s+/g, ' ')}`);
    return null;
  }

  const fileName = (() => {
    try {
      const parsed = new URL(downloadUrl);
      return parsed.pathname.split('/').pop() || 'kron86.asc';
    } catch {
      return 'kron86.asc';
    }
  })();

  const { header, hasAllFields } = extractAscHeaderFields(text);
  if (hasAllFields) {
    logAscHeaderDiagnostics(fileName, header);
  }

  const parsedAsc = await parseAscText(text, { fileName, fileSize: text.length });
  return applyAscCoordinateSystem(parsedAsc, epsgCode);
};

export const fetchKron86GridForBounds = async (bounds, options = {}) => {
  const { year = KRON86_DEFAULT_YEAR, maxLinksToTry = null, signal, onProgress } = options;

  if (!isWithinKron86Coverage(bounds)) {
    logWarn('Requested bounds are outside NMT EVRF2007 Poland coverage:', bounds);
    return { gridMeta: null, fallbackReason: 'outside_poland', links: [] };
  }

  logInfo('Starting NMT EVRF2007 query for bounds:', bounds);

  let yearCandidates = buildYearCandidates(year);
  try {
    const capabilitiesResponse = await fetch(buildGetCapabilitiesUrl(), {
      method: 'GET',
      signal,
      headers: {
        Accept: 'application/xml, text/xml;q=0.9, */*;q=0.5',
        'Accept-Language': KRON86_ACCEPT_LANGUAGE,
      },
    });
    if (capabilitiesResponse.ok) {
      const capabilitiesBody = await capabilitiesResponse.text();
      const availableYears = extractAvailableYearsFromCapabilities(capabilitiesBody);
      if (availableYears.length > 0) {
        const ordered = [];
        const preferredOrder = buildYearCandidates(year);
        const availableSet = new Set(availableYears);
        for (const candidateYear of preferredOrder) {
          if (availableSet.has(candidateYear)) ordered.push(candidateYear);
        }
        yearCandidates = ordered;
      }
      logInfo('Capabilities available years:', availableYears);
    }
  } catch (error) {
    logWarn('Failed to read GetCapabilities, using static year fallback order.', error);
  }

  logInfo('Year candidate order:', yearCandidates);

  let lastFailureReason = 'no_links';
  const allCandidates = [];

  for (const activeYear of yearCandidates) {
    onProgress?.(`Querying NMT EVRF2007 WFS tile index (${activeYear})...`);
    const featureUrl = buildGetFeatureUrl(bounds, activeYear);
    const response = await fetch(featureUrl, {
      method: 'GET',
      signal,
      headers: {
        Accept: 'application/gml+xml, text/xml;q=0.9, */*;q=0.5',
        'Accept-Language': KRON86_ACCEPT_LANGUAGE,
      },
    });

    if (!response.ok) {
      logWarn('Year query failed:', activeYear, response.status, response.statusText);
      lastFailureReason = 'index_unavailable';
      continue;
    }

    const body = await response.text();
    const numberReturned = parseNumberReturned(body);
    logInfo('Year query result:', activeYear, `numberReturned=${numberReturned ?? 'n/a'}`);
    if (numberReturned === 0) {
      lastFailureReason = 'no_features';
      continue;
    }

    const candidates = extractLinkCandidatesFromFeatureXml(body);
    logInfo('Year candidate tiles:', activeYear, candidates.map((entry) => ({ godlo: entry.godlo || '(no-godlo)', format: entry.format || '(no-format)', url: entry.url })));
    if (candidates.length === 0) {
      lastFailureReason = 'no_links';
      continue;
    }

    for (const candidate of candidates) allCandidates.push({ ...candidate, year: activeYear });
  }

  // (the finest grid each sheet has in any year: newest-first alone took a 5 m sheet of 2019
  // over the 1 m lidar of later years)
  const selectedCandidates = pickBestNmtTiles(allCandidates);
  const spacings = {};
  for (const c of selectedCandidates) { const k = c.resolutionM ? `${c.resolutionM} m` : 'unknown'; spacings[k] = (spacings[k] || 0) + 1; }
  const spacingText = Object.entries(spacings).map(([k, n]) => `${k} on ${n} sheet${n === 1 ? '' : 's'}`).join(', ');
  if (selectedCandidates.length) onProgress?.(`NMT EVRF2007: ${spacingText}`);
  logInfo('Selected finest-per-sheet candidates:', spacingText, selectedCandidates.map((entry) => ({ year: entry.year, godlo: entry.godlo || '(no-godlo)', resolutionM: entry.resolutionM, format: entry.format, url: entry.url })));
  if (selectedCandidates.length === 0) {
    return { gridMeta: null, fallbackReason: lastFailureReason, links: [] };
  }

  const requestedAttemptLimit = Number.isFinite(Number(maxLinksToTry))
    ? Math.max(1, Number(maxLinksToTry))
    : selectedCandidates.length;
  const safeAttemptLimit = (maxLinksToTry == null || maxLinksToTry === '')
    ? selectedCandidates.length
    : requestedAttemptLimit;
  const maxAttempts = Math.max(1, Math.min(safeAttemptLimit, selectedCandidates.length));
  const parsedMetas = [];
  const usedLinks = [];
  for (let i = 0; i < maxAttempts; i++) {
    const candidate = selectedCandidates[i];
    onProgress?.(`Downloading NMT EVRF2007 tile ${i + 1}/${maxAttempts} (${candidate.year})...`);
    try {
      const gridMeta = await tryParseAscFromLink(candidate, signal);
      if (gridMeta?.gridTiles?.length) {
        logInfo('Tile parsed successfully:', candidate.url, `tiles=${gridMeta.gridTiles.length}`);
        parsedMetas.push(gridMeta);
        usedLinks.push(candidate.url);
      } else {
        logWarn('Tile parse returned no grid tiles:', candidate.url);
      }
    } catch (error) {
      logWarn('Failed to parse candidate link:', candidate.url, error);
    }
  }

  if (parsedMetas.length > 0) {
    const gridTiles = parsedMetas.flatMap((meta) => meta.gridTiles || []);
    if (gridTiles.length > 0) {
      return {
        gridMeta: {
          ...parsedMetas[0],
          gridTiles,
        },
        fallbackReason: null,
        links: usedLinks,
        // (the grid spacing of the sheets used, for the report: { '1 m': 10, '5 m': 2 })
        spacings,
      };
    }
  }

  logWarn('NMT EVRF2007 finished with no usable tiles.', {
    attempted: maxAttempts,
    selected: selectedCandidates.length,
    fallbackReason: 'no_supported_tile_format',
  });

  return { gridMeta: null, fallbackReason: 'no_supported_tile_format', links: [] };
};
