import * as GeoTIFF from 'geotiff';
import proj4 from 'proj4';

// GeoTIFF spec uses 32767 as sentinel value meaning "user-defined CRS"
const USER_DEFINED_CRS = 32767;

/**
 * Return a proj4 string for common CRS types without requiring a network fetch.
 * Handles Web Mercator and all standard UTM zones.
 */
const getBuiltInProj4 = (epsgCode) => {
  if (epsgCode === 3857) {
    return '+proj=merc +a=6378137 +b=6378137 +lat_ts=0.0 +lon_0=0.0 +x_0=0.0 +y_0=0 +k=1.0 +units=m +nadgrids=@null +wktext +no_defs';
  }
  // UTM North: EPSG:32601–32660
  if (epsgCode >= 32601 && epsgCode <= 32660) {
    return `+proj=utm +zone=${epsgCode - 32600} +datum=WGS84 +units=m +no_defs`;
  }
  // UTM South: EPSG:32701–32760
  if (epsgCode >= 32701 && epsgCode <= 32760) {
    return `+proj=utm +zone=${epsgCode - 32700} +south +datum=WGS84 +units=m +no_defs`;
  }
  return null;
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

  // ── Detect GeoTIFF ──────────────────────────────────────────────────────────
  const geoKeys = image.getGeoKeys();
  const epsgCode = geoKeys?.ProjectedCSTypeGeoKey || geoKeys?.GeographicTypeGeoKey;

  // 32767 = user-defined CRS in GeoTIFF spec — not a real EPSG code
  const isGeoTiff = !!epsgCode && epsgCode !== USER_DEFINED_CRS;

  let bounds = null;
  let center = null;

  if (isGeoTiff) {
    const [originX, originY] = image.getOrigin();
    const [resX, resY] = image.getResolution();

    // Corners in the image's native CRS
    // resY is negative for north-up images (Y decreases as row increases)
    const x0 = originX;
    const y0 = originY;
    const x1 = originX + resX * sourceWidth;
    const y1 = originY + resY * sourceHeight;

    // ── Convert to WGS84 ────────────────────────────────────────────────────
    let toWGS84 = (x, y) => [x, y]; // identity – assume already 4326
    let crsResolved = (epsgCode === 4326);

    if (epsgCode && epsgCode !== 4326) {
      const epsg = `EPSG:${epsgCode}`;
      try {
        if (!proj4.defs(epsg)) {
          // Try built-in string first (no network required)
          const builtIn = getBuiltInProj4(epsgCode);
          if (builtIn) {
            proj4.defs(epsg, builtIn);
          } else {
            // Fall back to network fetch for less common CRS
            const resp = await fetch(`https://epsg.io/${epsgCode}.proj4`);
            if (resp.ok) proj4.defs(epsg, await resp.text());
          }
        }
        const converter = proj4(epsg, 'EPSG:4326');
        toWGS84 = (x, y) => converter.forward([x, y]);
        crsResolved = true;
      } catch (e) {
        console.warn(`[tifLoader] CRS conversion failed for EPSG:${epsgCode}:`, e);
      }
    }

    if (crsResolved) {
      // proj4 forward() returns [lng, lat] for EPSG:4326
      const [west, north] = toWGS84(x0, y0);
      const [east, south] = toWGS84(x1, y1);

      const computedBounds = {
        north: Math.max(north, south),
        south: Math.min(north, south),
        east:  Math.max(east,  west),
        west:  Math.min(east,  west),
      };

      // Validate the result is actually in WGS84 range
      if (
        computedBounds.north <= 90 && computedBounds.south >= -90 &&
        computedBounds.east <= 180 && computedBounds.west >= -180 &&
        computedBounds.north > computedBounds.south &&
        computedBounds.east > computedBounds.west
      ) {
        bounds = computedBounds;
        center = {
          lat: (bounds.north + bounds.south) / 2,
          lng: (bounds.east  + bounds.west)  / 2,
        };
      } else {
        console.warn('[tifLoader] Computed bounds are outside WGS84 range — CRS conversion likely produced invalid results.');
      }
    }
  }

  const noData = image.getGDALNoData() ?? null;
  return { image, raster, isGeoTiff, bounds, center, sourceWidth, sourceHeight, noData };
};
