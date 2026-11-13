// USGS 3DEP 1 m, two ways, neither of which downloads a whole tile.
//
// 1. The 3DEP image service (readUsgsImageService): asked for a box, it answers with that box's heights as
//    one GeoTIFF, mosaicked from the surveys by USGS itself. No catalogue, no choosing between overlapping
//    projects. Told to use its 1 m surveys only (mosaic rule LowPS < 2), it comes back empty where there is
//    no lidar instead of quietly handing out the 10 m or 30 m layer. A 2 km square: one request, 16 MB,
//    about 6 s. It refuses boxes of 4000 pixels a side, so a map is asked for in pieces of 2000.
// 2. The survey's own files, read in place (readUsgsWindows), when the service does not answer.
//
// The survey's files are tiles 10 km across, 150 to 450 MB each (two cover
// the centre of St. Augustine: 580 MB), laid out for partial reads (cloud-optimised GeoTIFF) on a server
// that allows them from a browser. A map needs the part of each tile under it, so only that is asked for:
// a 500 m square is a few hundred kilobytes, a 2 km map about a hundredth of what the whole tiles weigh.
//
// The catalogue (TNM Access) lists every project's tile near a box, neighbours included, several projects
// deep where surveys overlap: asked for four and taken as listed (as the map's fetch did), Little
// Cottonwood Canyon got three tiles of the square next door and one project that is empty there. All are
// asked for, those over the box are kept, the newest survey is read first and older ones only fill what is
// still empty.
import { fromUrl, fromArrayBuffer } from 'geotiff';
import proj4 from 'proj4';

const USGS_PRODUCTS = 'https://tnmaccess.nationalmap.gov/api/v1/products';
const USGS_1M = 'Digital Elevation Model (DEM) 1 meter';
const CATALOGUE_TIMEOUT_MS = 45000;      // it can take half a minute to answer
const COVER_GRID = 48;                   // the box is "covered" on a grid of this many points a side
const WINDOW_MARGIN_PX = 8;

/** The proj4 text of a USGS 1 m tile's grid (NAD83 UTM north, by EPSG code; else the zone of the longitude). */
export function usgsUtmDef(code, lng) {
  let zone = 0;
  if (code >= 26901 && code <= 26923) zone = code - 26900;          // NAD83 / UTM zone N
  else if (code >= 6330 && code <= 6348) zone = code - 6329;        // NAD83(2011) / UTM zone N
  else if (code >= 32601 && code <= 32660) zone = code - 32600;     // WGS 84 / UTM zone N
  if (!zone) zone = Math.max(1, Math.min(60, Math.floor((lng + 180) / 6) + 1));
  return `+proj=utm +zone=${zone} +ellps=GRS80 +towgs84=0,0,0 +units=m +no_defs`;
}

/** The tiles of a catalogue answer that lie over the box, the newest survey first. */
export function usgsItemsOver(items, b) {
  return (items || [])
    .filter((it) => { const q = it?.boundingBox; return it?.downloadURL && (!q || !(q.maxX < b.west || q.minX > b.east || q.maxY < b.south || q.minY > b.north)); })
    .filter((it, i, all) => all.findIndex((o) => o.downloadURL === it.downloadURL) === i)
    .sort((p, q) => String(q.publicationDate || '').localeCompare(String(p.publicationDate || '')));
}

/** Ask the catalogue for the 1 m tiles near a box { north, south, east, west }: the items, or null when it does not answer. */
export async function usgsCatalogue(b, { signal, tries = 3, max = 60 } = {}) {
  // (no custom headers: the catalogue refuses the preflight request they cause)
  const url = `${USGS_PRODUCTS}?datasets=${encodeURIComponent(USGS_1M)}&bbox=${b.west.toFixed(6)},${b.south.toFixed(6)},${b.east.toFixed(6)},${b.north.toFixed(6)}&prodFormats=GeoTIFF&max=${max}`;
  for (let attempt = 0; attempt < tries; attempt++) {
    signal?.throwIfAborted?.();
    const timer = new AbortController(); const stop = () => timer.abort();
    const t = setTimeout(stop, CATALOGUE_TIMEOUT_MS); signal?.addEventListener('abort', stop, { once: true });
    try {
      const r = await fetch(url, { signal: timer.signal });
      if (r.ok) { const j = await r.json(); if (Array.isArray(j?.items)) return j.items; }
    } catch (e) { if (signal?.aborted) throw e; }
    finally { clearTimeout(t); signal?.removeEventListener('abort', stop); }
    await new Promise((res) => setTimeout(res, 800 * (attempt + 1)));
  }
  return null;
}

/** The pixel window [c0, r0, c1, r1] of an image (bounding box, size) under a lat/lng box, or null when they miss. */
export function windowUnder(box, W, H, to, b, margin = WINDOW_MARGIN_PX) {
  const [x0, y0, x1, y1] = box;
  // (corners and edge middles: a box is not a rectangle in the tile's grid)
  const ml = (b.west + b.east) / 2; const mp = (b.north + b.south) / 2;
  const pts = [[b.west, b.north], [b.east, b.north], [b.west, b.south], [b.east, b.south], [ml, b.north], [ml, b.south], [b.west, mp], [b.east, mp]].map((p) => to.forward(p));
  const cols = pts.map((p) => ((p[0] - x0) / (x1 - x0)) * W); const rows = pts.map((p) => ((y1 - p[1]) / (y1 - y0)) * H);
  const c0 = Math.max(0, Math.floor(Math.min(...cols) - margin)); const c1 = Math.min(W, Math.ceil(Math.max(...cols) + margin));
  const r0 = Math.max(0, Math.floor(Math.min(...rows) - margin)); const r1 = Math.min(H, Math.ceil(Math.max(...rows) + margin));
  return c1 - c0 >= 2 && r1 - r0 >= 2 ? [c0, r0, c1, r1] : null;
}

/**
 * The parts of the USGS 1 m tiles under a box, as the resampler takes them:
 * [{ image (the window as an image: size, origin, resolution, keys), raster, layerIndex, noData, title, bytes }].
 * The newest survey is layer 0; an older one is read only where the box is still empty, and only fills there.
 * [] where the survey has nothing; null when the catalogue does not answer.
 */
export async function readUsgsWindows(b, { signal, onProgress, open = fromUrl, catalogue = usgsCatalogue } = {}) {
  const listed = await catalogue(b, { signal });
  if (!listed) return null;
  const items = usgsItemsOver(listed, b);
  if (!items.length) return [];
  // the box's cover, on a grid of points
  const n = COVER_GRID; const covered = new Uint8Array(n * n); let left = n * n;
  const point = (k) => [b.west + (((k % n) + 0.5) / n) * (b.east - b.west), b.north - ((Math.floor(k / n) + 0.5) / n) * (b.north - b.south)];
  const out = [];
  for (let i = 0; i < items.length && left > 0; i++) {
    signal?.throwIfAborted?.();
    onProgress?.(i, items.length);
    try {
      // (blocks of 1 MB: a map's window is tens of megabytes, and the default 64 KB makes a thousand requests of it)
      const img = await (await open(items[i].downloadURL, { blockSize: 1 << 20, cacheSize: 32 }, signal)).getImage();
      const keys = img.getGeoKeys() || {};
      const to = proj4('EPSG:4326', usgsUtmDef(keys.ProjectedCSTypeGeoKey, (b.west + b.east) / 2));
      const box = img.getBoundingBox(); const W = img.getWidth(); const H = img.getHeight();
      const win = windowUnder(box, W, H, to, b);
      if (!win) continue;
      const [c0, r0, c1, r1] = win; const w = c1 - c0; const h = r1 - r0;
      const [raster] = await img.readRasters({ window: win, signal });
      const tag = img.getGDALNoData(); const noData = Number.isFinite(tag) ? tag : -999999;
      // what of the box this window adds
      let adds = 0; const hits = [];
      for (let k = 0; k < n * n; k++) {
        if (covered[k]) continue;
        const [x, y] = to.forward(point(k));
        const c = Math.floor(((x - box[0]) / (box[2] - box[0])) * W) - c0; const r = Math.floor(((box[3] - y) / (box[3] - box[1])) * H) - r0;
        if (c < 0 || r < 0 || c >= w || r >= h) continue;
        const v = raster[r * w + c];
        if (Number.isFinite(v) && v !== noData && v > -10000) { hits.push(k); adds++; }
      }
      if (!adds) continue;
      for (const k of hits) covered[k] = 1;
      left -= adds;
      const [ox, oy] = img.getOrigin(); const [rx, ry] = img.getResolution();
      const origin = [ox + c0 * rx, oy + r0 * ry, 0]; const res = [rx, ry, 0];
      out.push({
        image: {
          getGeoKeys: () => keys, getWidth: () => w, getHeight: () => h, getOrigin: () => origin, getResolution: () => res, getGDALNoData: () => noData,
          getBoundingBox: () => [origin[0], origin[1] + h * ry, origin[0] + w * rx, origin[1]],
        },
        raster, layerIndex: out.length, noData, title: String(items[i].title || ''), bytes: raster.byteLength,
      });
    } catch (e) {
      if (signal?.aborted) throw e;
      console.warn('[USGS] tile not read:', items[i]?.title, e);
    }
  }
  return out;
}

const USGS_IMAGE = 'https://elevation.nationalmap.gov/arcgis/rest/services/3DEPElevation/ImageServer/exportImage';
const IMAGE_PIECE_PX = 2000;             // (the service answers 500 at 4000 a side)
const IMAGE_OVERLAP_PX = 4;              // pieces overlap, so a height between two of them is read from one
const IMAGE_NODATA = -9999;
export const IMAGE_PIECES_MAX = 64;      // 16 km at 1 m

/** The pieces a box is asked for in: [{ north, south, east, west, w, h }] at stepDeg a pixel, each at most maxPx a side. */
export function imagePieces(b, stepDeg, maxPx = IMAGE_PIECE_PX, overlap = IMAGE_OVERLAP_PX) {
  const W = Math.max(2, Math.ceil((b.east - b.west) / stepDeg)); const H = Math.max(2, Math.ceil((b.north - b.south) / stepDeg));
  const nx = Math.ceil(W / (maxPx - 2 * overlap)); const ny = Math.ceil(H / (maxPx - 2 * overlap));
  const out = [];
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const c0 = Math.floor((i * W) / nx) - overlap; const c1 = Math.floor(((i + 1) * W) / nx) + overlap;
    const r0 = Math.floor((j * H) / ny) - overlap; const r1 = Math.floor(((j + 1) * H) / ny) + overlap;
    out.push({ west: b.west + c0 * stepDeg, east: b.west + c1 * stepDeg, north: b.north - r0 * stepDeg, south: b.north - r1 * stepDeg, w: c1 - c0, h: r1 - r0 });
  }
  return out;
}

/**
 * A box's heights from the 3DEP image service, 1 m surveys only, as the resampler takes them:
 * [{ image, raster, noData, arrayBuffer }] (lat/lng GeoTIFFs, one per piece; pieces with nothing in them left out).
 * [] where the 1 m surveys have nothing. Throws when the service does not answer (the caller reads the files instead).
 * metersPerPixel: the map's own step when it is coarser than 1 m (a 2 m map asks for a quarter of the pixels).
 */
export async function readUsgsImageService(b, { metersPerPixel = 1, signal, onProgress, concurrency = 2 } = {}) {
  // (square pixels in degrees, a metre of latitude each: finer than a metre east-west, never coarser)
  const stepDeg = Math.max(1, Number(metersPerPixel) || 1) / 111320;
  const pieces = imagePieces(b, stepDeg);
  if (pieces.length > IMAGE_PIECES_MAX) throw new Error(`USGS image service: ${pieces.length} pieces is too many`);
  const out = new Array(pieces.length).fill(null); let next = 0; let done = 0;
  const one = async (p) => {
    const q = new URLSearchParams({
      bbox: `${p.west},${p.south},${p.east},${p.north}`, bboxSR: '4326', imageSR: '4326', size: `${p.w},${p.h}`, format: 'tiff', pixelType: 'F32',
      noData: String(IMAGE_NODATA), interpolation: 'RSP_BilinearInterpolation', mosaicRule: JSON.stringify({ mosaicMethod: 'esriMosaicNorthwest', where: 'LowPS < 2' }), f: 'image',
    });
    let last = null;
    // (it answers 502 now and then, more so with several requests at once: four tries, a few seconds apart)
    for (let attempt = 0; attempt < 4; attempt++) {
      signal?.throwIfAborted?.();
      try {
        const r = await fetch(`${USGS_IMAGE}?${q}`, { signal });
        if (!r.ok || !/tiff/i.test(r.headers.get('content-type') || '')) { last = new Error(`USGS image service ${r.status}`); }
        else {
          const arrayBuffer = await r.arrayBuffer();
          const image = await (await fromArrayBuffer(arrayBuffer)).getImage();
          // (nothing here: the service answers with a stub of a few hundred bytes, not the size asked for)
          if (image.getWidth() !== p.w || image.getHeight() !== p.h) return null;
          const [raster] = await image.readRasters();
          let any = false; for (let i = 0; i < raster.length; i += 7) { const v = raster[i]; if (Number.isFinite(v) && v > -9000 && v < 9000) { any = true; break; } }
          if (!any) return null;
          // (heights the service marks empty with a huge number, as well as with the value asked for)
          for (let i = 0; i < raster.length; i++) { const v = raster[i]; if (!(v > -9000 && v < 9000)) raster[i] = IMAGE_NODATA; }
          return { image, raster, noData: IMAGE_NODATA, arrayBuffer };
        }
      } catch (e) { if (signal?.aborted) throw e; last = e; }
      if (attempt < 3) await new Promise((res) => setTimeout(res, 2000 * (attempt + 1)));
    }
    throw last || new Error('USGS image service did not answer');
  };
  const worker = async () => { while (next < pieces.length) { const k = next++; out[k] = await one(pieces[k]); onProgress?.(++done, pieces.length); } };
  await Promise.all(Array.from({ length: Math.min(concurrency, pieces.length) }, worker));
  return out.filter(Boolean);
}
