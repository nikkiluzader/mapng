import proj4 from 'proj4';

const USER_DEFINED_CRS = 32767;

const getBuiltInProj4 = (code) => {
  if (code === 3857) return '+proj=merc +a=6378137 +b=6378137 +lat_ts=0 +lon_0=0 +x_0=0 +y_0=0 +k=1 +units=m +nadgrids=@null +no_defs';
  if (code >= 32601 && code <= 32660) return `+proj=utm +zone=${code - 32600} +datum=WGS84 +units=m +no_defs`;
  if (code >= 32701 && code <= 32760) return `+proj=utm +zone=${code - 32700} +south +datum=WGS84 +units=m +no_defs`;
  return null;
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
        const wkt = new TextDecoder().decode(bytes.slice(dataStart, dataStart + recordLen));
        epsgCode = epsgFromWKT(wkt);
      }
    }
    if (userId.toLowerCase().includes('laszip')) hasLazVLR = true;

    vlrOffset += 54 + recordLen;
  }

  // Detect LAZ: file extension is most reliable; laszip VLR as backup
  const isLaz = file.name.toLowerCase().endsWith('.laz') || hasLazVLR;

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

  return {
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
    fileSize: file.size,
  };
};
