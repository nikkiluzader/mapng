import * as GeoTIFF from 'geotiff';
import { isLikelyGmlText, parseGmlFile, parseGmlText, parseGmlZipFile } from './gmlLoader.js';
import { parseAscFile, parseAscText } from './ascLoader.js';
import {
  computeGeoMetadata,
  detectUnitFromText,
  UNIT_FEET,
  UNIT_METERS,
  UNIT_UNKNOWN,
  UNIT_US_SURVEY_FEET,
  USER_DEFINED_CRS,
} from './uploadGeoMetadata.js';

export { parseGmlText, parseAscText };

const mapLinearUnitCode = (code) => {
  if (code === 9001) return UNIT_METERS;
  if (code === 9002) return UNIT_FEET;
  if (code === 9003) return UNIT_US_SURVEY_FEET;
  return UNIT_UNKNOWN;
};

/**
 * Parse a .tif/.tiff File from the user's filesystem.
 *
 * Returns the GeoTIFF image object + raster data in the same format that
 * resamplerClient.prepareTiles() / resampleHeightMapOffThread() expect, so
 * the existing pipeline can consume it directly.
 *
 * Also extracts WGS84 bounds and centre point from GeoTIFF geo-metadata when
 * present (projected or geographic CRS).  Plain TIFFs without GeoKeys, or
 * GeoTIFFs with unsupported/user-defined CRS, return null for bounds/center;
 * the caller must supply coordinates.
 */
export const parseTifFile = async (file) => {
  const lowerName = file.name.toLowerCase();
  if (lowerName.endsWith('.asc')) {
    return parseAscFile(file);
  }
  if (lowerName.endsWith('.zip')) {
    return parseGmlZipFile(file);
  }
  if (lowerName.endsWith('.gml') || lowerName.endsWith('.xml')) {
    const text = await file.text();
    if (isLikelyGmlText(text)) {
      return parseGmlFile(file);
    }
    if (lowerName.endsWith('.gml')) {
      return parseGmlFile(file);
    }
  }

  const buffer = await file.arrayBuffer();
  const tiff = await GeoTIFF.fromArrayBuffer(buffer);
  const image = await tiff.getImage();

  // Read band 0 as a Float32Array (matches the format fetchGPXZRaw produces)
  const rasters = await image.readRasters();
  const rawBand = rasters[0];
  const raster = rawBand instanceof Float32Array
    ? rawBand
    : new Float32Array(rawBand);

  const sourceWidth = image.getWidth();
  const sourceHeight = image.getHeight();
  const fileDirectory = image.getFileDirectory?.() || {};

  // ── Detect GeoTIFF ──────────────────────────────────────────────────────────
  const geoKeys = image.getGeoKeys();
  const epsgCode = geoKeys?.ProjectedCSTypeGeoKey || geoKeys?.GeographicTypeGeoKey;

  // 32767 = user-defined CRS in GeoTIFF spec — not a real EPSG code
  const isGeoTiff = !!epsgCode && epsgCode !== USER_DEFINED_CRS;

  let bounds = null;
  let center = null;
  let nativeMetersPerPixel = null;
  let nativeWidth = null;
  let nativeHeight = null;
  let suggestedResolution = null;
  let verticalUnitDetected = UNIT_UNKNOWN;
  let verticalUnitDetectionSource = null;

  // GeoTIFF vertical unit keys (EPSG unit codes): 9001=m, 9002=ft, 9003=US survey ft
  const verticalUnitCode = geoKeys?.VerticalUnitsGeoKey;
  const modelLinearUnitCode = geoKeys?.ProjLinearUnitsGeoKey;
  if (Number.isFinite(verticalUnitCode)) {
    verticalUnitDetected = mapLinearUnitCode(verticalUnitCode);
    verticalUnitDetectionSource = 'VerticalUnitsGeoKey';
  } else if (Number.isFinite(modelLinearUnitCode)) {
    // Fallback heuristic when explicit vertical unit is absent.
    verticalUnitDetected = mapLinearUnitCode(modelLinearUnitCode);
    verticalUnitDetectionSource = 'ProjLinearUnitsGeoKey';
  }

  if (verticalUnitDetected === UNIT_UNKNOWN) {
    const asciiText = String(fileDirectory.GeoAsciiParamsTag || '');
    const fromAscii = detectUnitFromText(asciiText);
    if (fromAscii !== UNIT_UNKNOWN) {
      verticalUnitDetected = fromAscii;
      verticalUnitDetectionSource = 'GeoAsciiParamsTag';
    }
  }

  if (isGeoTiff) {
    const [originX, originY] = image.getOrigin();
    const [resX, resY] = image.getResolution();
    const geoMeta = await computeGeoMetadata({
      epsgCode,
      sourceWidth,
      sourceHeight,
      originX,
      originY,
      resX,
      resY,
      useSampleSpacing: false,
      logPrefix: 'tifLoader',
    });
    bounds = geoMeta.bounds;
    center = geoMeta.center;
    nativeMetersPerPixel = geoMeta.nativeMetersPerPixel;
    nativeWidth = geoMeta.nativeWidth;
    nativeHeight = geoMeta.nativeHeight;
    suggestedResolution = geoMeta.suggestedResolution;
  }

  const noData = image.getGDALNoData() ?? null;
  return {
    sourceType: 'geotiff',
    sourceFormat: 'geotiff',
    formatLabel: 'GeoTIFF',
    image,
    raster,
    isGeoTiff,
    isGeoReferenced: isGeoTiff,
    epsgCode: isGeoTiff ? epsgCode : null,
    bounds,
    center,
    sourceWidth,
    sourceHeight,
    nativeWidth,
    nativeHeight,
    suggestedResolution,
    nativeMetersPerPixel,
    noData,
    fileSize: file.size,
    verticalUnitDetected,
    verticalUnitDetectionSource,
  };
};
