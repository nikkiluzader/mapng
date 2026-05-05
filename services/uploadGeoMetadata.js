import proj4 from 'proj4';

export const USER_DEFINED_CRS = 32767;
export const UNIT_UNKNOWN = 'unknown';
export const UNIT_METERS = 'meters';
export const UNIT_FEET = 'feet';
export const UNIT_US_SURVEY_FEET = 'us_survey_feet';

export const VALID_UPLOAD_RESOLUTIONS = [512, 1024, 2048, 4096, 8192];

export const detectUnitFromText = (text) => {
  if (!text || typeof text !== 'string') return UNIT_UNKNOWN;
  const normalized = text.toLowerCase();
  if (normalized.includes('us survey foot') || normalized.includes('us_survey_foot') || normalized.includes('survey foot')) {
    return UNIT_US_SURVEY_FEET;
  }
  if (normalized.includes('international foot') || normalized.includes('foot') || normalized.includes('feet') || normalized.includes('ft')) {
    return UNIT_FEET;
  }
  if (normalized.includes('metre') || normalized.includes('meter') || normalized.includes('metres') || normalized.includes('meters')) {
    return UNIT_METERS;
  }
  return UNIT_UNKNOWN;
};

export const getBuiltInProj4 = (epsgCode) => {
  if (epsgCode === 6350) {
    // NAD83(2011) / Conus Albers
    return '+proj=aea +lat_0=23 +lon_0=-96 +lat_1=29.5 +lat_2=45.5 +x_0=0 +y_0=0 +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs';
  }
  if (epsgCode === 3857) {
    return '+proj=merc +a=6378137 +b=6378137 +lat_ts=0.0 +lon_0=0.0 +x_0=0.0 +y_0=0 +k=1.0 +units=m +nadgrids=@null +wktext +no_defs';
  }
  if (epsgCode === 27700) {
    // Browser-safe fallback for British National Grid without OSTN15 NTv2 file.
    // Accuracy is typically lower than grid-shift based transforms but avoids NaN results.
    return '+proj=tmerc +lat_0=49 +lon_0=-2 +k=0.9996012717 +x_0=400000 +y_0=-100000 +ellps=airy +towgs84=446.448,-125.157,542.06,0.1502,0.247,0.8421,-20.4894 +units=m +no_defs';
  }
  if (epsgCode === 2180) {
    return '+proj=tmerc +lat_0=0 +lon_0=19 +k=0.9993 +x_0=500000 +y_0=-5300000 +ellps=GRS80 +units=m +no_defs';
  }
  if (epsgCode >= 32601 && epsgCode <= 32660) {
    return `+proj=utm +zone=${epsgCode - 32600} +datum=WGS84 +units=m +no_defs`;
  }
  if (epsgCode >= 32701 && epsgCode <= 32760) {
    return `+proj=utm +zone=${epsgCode - 32700} +south +datum=WGS84 +units=m +no_defs`;
  }
  return null;
};

const ensureProj4Definition = async (epsgCode, logPrefix = 'uploadGeoMetadata') => {
  if (!epsgCode || epsgCode === 4326) return;
  const epsg = `EPSG:${epsgCode}`;
  if (proj4.defs(epsg)) return;

  const builtIn = getBuiltInProj4(epsgCode);
  if (builtIn) {
    proj4.defs(epsg, builtIn);
    return;
  }

  const response = await fetch(`https://epsg.io/${epsgCode}.proj4`);
  if (response.ok) {
    proj4.defs(epsg, await response.text());
    return;
  }

  console.warn(`[${logPrefix}] Failed to resolve proj4 definition for EPSG:${epsgCode}.`);
};

export const summarizeCoverageBounds = (bounds) => {
  if (!bounds) {
    return {
      center: null,
      nativeWidth: null,
      nativeHeight: null,
      suggestedResolution: null,
      nativeMetersPerPixel: null,
    };
  }

  const center = {
    lat: (bounds.north + bounds.south) / 2,
    lng: (bounds.east + bounds.west) / 2,
  };
  const midLat = center.lat;
  const mPerDegLat = 111320;
  const mPerDegLng = 111320 * Math.cos(midLat * Math.PI / 180);
  const coverageWm = Math.abs(bounds.east - bounds.west) * mPerDegLng;
  const coverageHm = Math.abs(bounds.north - bounds.south) * mPerDegLat;
  const nativeWidth = Math.max(1, Math.round(coverageWm));
  const nativeHeight = Math.max(1, Math.round(coverageHm));
  const minCoverage = Math.min(coverageWm, coverageHm);
  const rawResolution = Math.pow(2, Math.floor(Math.log2(Math.max(1, minCoverage))));
  const suggestedResolution = VALID_UPLOAD_RESOLUTIONS.filter((value) => value <= rawResolution).pop() ?? VALID_UPLOAD_RESOLUTIONS[0];
  const nativeMetersPerPixel = Math.max(
    coverageWm / Math.max(1, nativeWidth),
    coverageHm / Math.max(1, nativeHeight),
  );

  return {
    center,
    nativeWidth,
    nativeHeight,
    suggestedResolution,
    nativeMetersPerPixel,
  };
};

export const computeGeoMetadata = async ({
  epsgCode,
  sourceWidth,
  sourceHeight,
  originX,
  originY,
  resX,
  resY,
  useSampleSpacing = false,
  logPrefix = 'uploadGeoMetadata',
}) => {
  if (!epsgCode || epsgCode === USER_DEFINED_CRS) {
    return {
      isGeoReferenced: false,
      bounds: null,
      center: null,
      nativeMetersPerPixel: null,
      nativeWidth: null,
      nativeHeight: null,
      suggestedResolution: null,
    };
  }

  let toWGS84 = (x, y) => [x, y];
  let crsResolved = (epsgCode === 4326);

  if (epsgCode !== 4326) {
    try {
      await ensureProj4Definition(epsgCode, logPrefix);
      const converter = proj4(`EPSG:${epsgCode}`, 'EPSG:4326');
      toWGS84 = (x, y) => converter.forward([x, y]);
      crsResolved = true;
    } catch (error) {
      console.warn(`[${logPrefix}] CRS conversion failed for EPSG:${epsgCode}:`, error);
    }
  }

  if (!crsResolved) {
    return {
      isGeoReferenced: true,
      bounds: null,
      center: null,
      nativeMetersPerPixel: null,
      nativeWidth: null,
      nativeHeight: null,
      suggestedResolution: null,
    };
  }

  const numericInputs = [sourceWidth, sourceHeight, originX, originY, resX, resY].map(Number);
  if (!numericInputs.every(Number.isFinite)) {
    console.warn(`[${logPrefix}] Geo metadata inputs contain non-finite values.`);
    return {
      isGeoReferenced: true,
      bounds: null,
      center: null,
      nativeMetersPerPixel: null,
      nativeWidth: null,
      nativeHeight: null,
      suggestedResolution: null,
    };
  }

  if (Number(sourceWidth) <= 0 || Number(sourceHeight) <= 0 || Number(resX) === 0 || Number(resY) === 0) {
    console.warn(`[${logPrefix}] Geo metadata inputs contain invalid dimensions or pixel resolution.`);
    return {
      isGeoReferenced: true,
      bounds: null,
      center: null,
      nativeMetersPerPixel: null,
      nativeWidth: null,
      nativeHeight: null,
      suggestedResolution: null,
    };
  }

  const xExtent = useSampleSpacing ? resX * Math.max(0, sourceWidth - 1) : resX * sourceWidth;
  const yExtent = useSampleSpacing ? resY * Math.max(0, sourceHeight - 1) : resY * sourceHeight;
  const x1 = originX + xExtent;
  const y1 = originY + yExtent;

  const [west, north] = toWGS84(originX, originY);
  const [east, south] = toWGS84(x1, y1);

  if (![west, north, east, south].every(Number.isFinite)) {
    console.warn(`[${logPrefix}] CRS conversion produced non-finite bounds (likely missing datum grid shift data).`);
    return {
      isGeoReferenced: true,
      bounds: null,
      center: null,
      nativeMetersPerPixel: null,
      nativeWidth: null,
      nativeHeight: null,
      suggestedResolution: null,
    };
  }

  const bounds = {
    north: Math.max(north, south),
    south: Math.min(north, south),
    east: Math.max(east, west),
    west: Math.min(east, west),
  };

  if (
    bounds.north > 90 || bounds.south < -90 ||
    bounds.east > 180 || bounds.west < -180 ||
    bounds.north <= bounds.south ||
    bounds.east <= bounds.west
  ) {
    console.warn(`[${logPrefix}] Computed bounds are outside WGS84 range.`);
    return {
      isGeoReferenced: true,
      bounds: null,
      center: null,
      nativeMetersPerPixel: null,
      nativeWidth: null,
      nativeHeight: null,
      suggestedResolution: null,
    };
  }

  const center = {
    lat: (bounds.north + bounds.south) / 2,
    lng: (bounds.east + bounds.west) / 2,
  };
  const midLat = center.lat;
  const mPerDegLat = 111320;
  const mPerDegLng = 111320 * Math.cos(midLat * Math.PI / 180);
  const coverageWm = Math.abs(bounds.east - bounds.west) * mPerDegLng;
  const coverageHm = Math.abs(bounds.north - bounds.south) * mPerDegLat;

  if (![coverageWm, coverageHm].every((v) => Number.isFinite(v) && v > 0)) {
    console.warn(`[${logPrefix}] Coverage dimensions are non-finite after CRS conversion.`);
    return {
      isGeoReferenced: true,
      bounds: null,
      center: null,
      nativeMetersPerPixel: null,
      nativeWidth: null,
      nativeHeight: null,
      suggestedResolution: null,
    };
  }

  const divisorX = useSampleSpacing ? Math.max(1, sourceWidth - 1) : Math.max(1, sourceWidth);
  const divisorY = useSampleSpacing ? Math.max(1, sourceHeight - 1) : Math.max(1, sourceHeight);
  const mppX = coverageWm / divisorX;
  const mppY = coverageHm / divisorY;
  const mppAvg = (mppX + mppY) / 2;
  const nativeMetersPerPixel = Number.isFinite(mppAvg) && mppAvg > 0 ? mppAvg : null;
  const nativeWidth = Math.max(1, Math.round(coverageWm));
  const nativeHeight = Math.max(1, Math.round(coverageHm));
  const minCoverage = Math.min(coverageWm, coverageHm);
  const rawResolution = Math.pow(2, Math.floor(Math.log2(Math.max(1, minCoverage))));
  const suggestedResolution = VALID_UPLOAD_RESOLUTIONS.filter((value) => value <= rawResolution).pop() ?? VALID_UPLOAD_RESOLUTIONS[0];

  return {
    isGeoReferenced: true,
    bounds,
    center,
    nativeMetersPerPixel,
    nativeWidth,
    nativeHeight,
    suggestedResolution,
  };
};