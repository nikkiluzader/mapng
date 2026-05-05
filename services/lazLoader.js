import proj4 from 'proj4';
import {
  detectUnitFromText,
  getBuiltInProj4,
  summarizeCoverageBounds,
  UNIT_UNKNOWN,
  USER_DEFINED_CRS,
} from './uploadGeoMetadata.js';

const detectVerticalUnitFromWKT = (wkt) => {
  if (!wkt || typeof wkt !== 'string') return { unit: UNIT_UNKNOWN, source: null };
  const vertMatch = wkt.match(/VERT_CS\[[\s\S]*?UNIT\["([^"]+)"/i) || wkt.match(/VERTCRS\[[\s\S]*?LENGTHUNIT\["([^"]+)"/i);
  if (vertMatch?.[1]) {
    const detected = detectUnitFromText(vertMatch[1]);
    if (detected !== UNIT_UNKNOWN) return { unit: detected, source: 'WKT_VERTICAL_UNIT' };
  }

  // Fallback heuristic: use the horizontal unit if no vertical unit block is present.
  const projMatch = wkt.match(/PROJCS\[[\s\S]*?UNIT\["([^"]+)"/i) || wkt.match(/PROJCRS\[[\s\S]*?LENGTHUNIT\["([^"]+)"/i);
  if (projMatch?.[1]) {
    const detected = detectUnitFromText(projMatch[1]);
    if (detected !== UNIT_UNKNOWN) return { unit: detected, source: 'WKT_PROJECTED_UNIT' };
  }

  return { unit: UNIT_UNKNOWN, source: null };
};
/**
 * Return true if an EPSG code is in the CRS (coordinate reference system) range.
 * Codes 7000–7999 are datums/ellipsoids/prime meridians, NOT CRS definitions.
 */
const isValidCRSCode = (code) =>
  code > 0 &&
  code !== USER_DEFINED_CRS &&
  !(code >= 7000 && code <= 7999);

/** Extract EPSG from GeoKey Directory VLR data */
const epsgFromGeoKeys = (dataView, byteOffset, byteLength) => {
  if (byteLength < 8) return null;
  const numKeys = dataView.getUint16(byteOffset + 6, true);
  for (let i = 0; i < numKeys; i++) {
    const keyId           = dataView.getUint16(byteOffset + 8 + i * 8,     true);
    const tiffTagLocation = dataView.getUint16(byteOffset + 8 + i * 8 + 2, true);
    const value           = dataView.getUint16(byteOffset + 8 + i * 8 + 6, true);
    // 3072 = ProjectedCSTypeGeoKey, 2048 = GeographicTypeGeoKey
    // TIFFTagLocation must be 0 for inline integer values
    if ((keyId === 3072 || keyId === 2048) && tiffTagLocation === 0) {
      return isValidCRSCode(value) ? value : null;
    }
  }
  return null;
};

/** Extract EPSG from OGC WKT string (LAS 1.4) */
const epsgFromWKT = (wkt) => {
  // For compound CRS (COMPD_CS), only consider the horizontal component.
  // VERT_CS always follows PROJCS/GEOGCS in WKT1, so split there.
  const horizontalPart = wkt.split(/,VERT_CS\[|,VERT_DATUM\[/)[0];

  // Collect all AUTHORITY / ID codes in document order.
  // The LAST valid code in the horizontal part is the outermost CRS authority
  // (i.e. the PROJCS or GEOGCS itself), which is what we need for coordinate conversion.
  const matches = [
    ...horizontalPart.matchAll(/AUTHORITY\["EPSG","(\d+)"\]/gi),
    ...horizontalPart.matchAll(/\bID\["EPSG",(\d+)\]/gi),
  ].sort((a, b) => a.index - b.index);

  for (let i = matches.length - 1; i >= 0; i--) {
    const code = parseInt(matches[i][1], 10);
    if (isValidCRSCode(code)) return code;
  }
  return null;
};

/**
 * Parse a LAS/LAZ file header and extract metadata + WGS84 bounds.
 * Runs on the main thread — returns everything needed to rasterize on the worker.
 */
export const parseLazFile = async (file) => {
  const buffer = await file.arrayBuffer();
  const view   = new DataView(buffer);
  const bytes  = new Uint8Array(buffer);

  // ── Validate LAS/LAZ magic ────────────────────────────────────────────────
  if (String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3]) !== 'LASF') {
    throw new Error('Not a valid LAS/LAZ file (missing LASF signature)');
  }

  const vMajor  = view.getUint8(24);
  const vMinor  = view.getUint8(25);
  const headerSize            = view.getUint16(94,  true);
  const pointDataOffset       = view.getUint32(96,  true);
  const numVLRs               = view.getUint32(100, true);
  const pointFormat           = view.getUint8(104) & 0x3F;
  const pointDataRecordLength = view.getUint16(105, true);

  // LAS 1.4+ uses 64-bit point count at offset 247; older uses 32-bit at 107
  const pointCount = (vMajor === 1 && vMinor >= 4)
    ? Number(view.getBigUint64(247, true))
    : view.getUint32(107, true);

  const scaleX  = view.getFloat64(131, true);
  const scaleY  = view.getFloat64(139, true);
  const scaleZ  = view.getFloat64(147, true);
  const offsetX = view.getFloat64(155, true);
  const offsetY = view.getFloat64(163, true);
  const offsetZ = view.getFloat64(171, true);
  const maxX    = view.getFloat64(179, true);
  const minX    = view.getFloat64(187, true);
  const maxY    = view.getFloat64(195, true);
  const minY    = view.getFloat64(203, true);
  const maxZ    = view.getFloat64(211, true);
  const minZ    = view.getFloat64(219, true);

  // ── Parse VLRs: EPSG + LAZ detection ─────────────────────────────────────
  let epsgCode  = null;
  let hasLazVLR = false;
  let wktText = null;
  let vlrOffset = headerSize;

  for (let i = 0; i < numVLRs && vlrOffset + 54 <= pointDataOffset; i++) {
    const userId    = new TextDecoder().decode(bytes.slice(vlrOffset + 2, vlrOffset + 18)).replace(/\0/g, '').trim();
    const recordId  = view.getUint16(vlrOffset + 18, true);
    const recordLen = view.getUint16(vlrOffset + 20, true);
    const dataStart = vlrOffset + 54;

    if (userId === 'LASF_Projection') {
      if (recordId === 34735 && !epsgCode) {
        epsgCode = epsgFromGeoKeys(view, dataStart, recordLen);
      } else if (recordId === 2112 && !epsgCode) {
        wktText = new TextDecoder().decode(bytes.slice(dataStart, dataStart + recordLen));
        epsgCode = epsgFromWKT(wktText);
      } else if (recordId === 2112 && !wktText) {
        wktText = new TextDecoder().decode(bytes.slice(dataStart, dataStart + recordLen));
      }
    }
    if (userId.toLowerCase().includes('laszip')) hasLazVLR = true;

    vlrOffset += 54 + recordLen;
  }

  // Detect LAZ: file extension is most reliable; laszip VLR as backup
  const isLaz = file.name.toLowerCase().endsWith('.laz') || hasLazVLR;
  const detectedVertical = detectVerticalUnitFromWKT(wktText);

  // ── Convert bounding box to WGS84 ────────────────────────────────────────
  let bounds = null;
  let center = null;

  if (epsgCode) {
    let toWGS84 = (x, y) => [x, y]; // identity for EPSG:4326

    if (epsgCode !== 4326) {
      const epsg = `EPSG:${epsgCode}`;
      try {
        if (!proj4.defs(epsg)) {
          const builtIn = getBuiltInProj4(epsgCode);
          if (builtIn) {
            proj4.defs(epsg, builtIn);
          } else {
            const resp = await fetch(`https://epsg.io/${epsgCode}.proj4`);
            if (resp.ok) proj4.defs(epsg, await resp.text());
          }
        }
        const conv = proj4(epsg, 'EPSG:4326');
        toWGS84 = (x, y) => conv.forward([x, y]);
      } catch (e) {
        console.warn('[lazLoader] CRS conversion failed:', e);
        epsgCode = null; // don't pass an unresolvable code to the worker
      }
    }

    if (epsgCode) {
      const corners = [
        toWGS84(minX, minY), toWGS84(maxX, minY),
        toWGS84(minX, maxY), toWGS84(maxX, maxY),
      ];
      const lngs = corners.map(c => c[0]);
      const lats = corners.map(c => c[1]);
      const b = {
        north: Math.max(...lats), south: Math.min(...lats),
        east:  Math.max(...lngs), west:  Math.min(...lngs),
      };
      if (b.north <= 90 && b.south >= -90 && b.east <= 180 && b.west >= -180 && b.north > b.south) {
        bounds = b;
        center = { lat: (b.north + b.south) / 2, lng: (b.east + b.west) / 2 };
      }
    }
  }

  // ── Native raster dimensions + power-of-2 export crop ───────────────────────
  // nativeWidth/Height: rasterize the full file at 1 m/px so no coverage is lost.
  // suggestedResolution: the largest standard power-of-2 that fits entirely inside
  // the file's extent — used as the export/crop area shown as an orange box in 3D.
  const coverageSummary = summarizeCoverageBounds(bounds);

  return {
    sourceType: 'laz',
    sourceFormat: isLaz ? 'laz' : 'las',
    formatLabel: isLaz ? 'LAZ' : 'LAS',
    buffer,
    isLaz,
    versionMajor: vMajor,
    versionMinor: vMinor,
    pointFormat,
    pointDataRecordLength,
    pointDataOffset,
    pointCount,
    scaleX, scaleY, scaleZ,
    offsetX, offsetY, offsetZ,
    minX, maxX, minY, maxY, minZ, maxZ,
    epsgCode,
    bounds,
    center,
    nativeWidth: coverageSummary.nativeWidth,
    nativeHeight: coverageSummary.nativeHeight,
    nativeMetersPerPixel: coverageSummary.nativeMetersPerPixel,
    suggestedResolution: coverageSummary.suggestedResolution,
    fileSize: file.size,
    verticalUnitDetected: detectedVertical.unit,
    verticalUnitDetectionSource: detectedVertical.source,
  };
};
