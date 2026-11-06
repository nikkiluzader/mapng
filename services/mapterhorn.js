// Mapterhorn: free terrain tiles (mapterhorn.com, BSD-3 code, open-licence data from 155 national and global
// sources; no key, no sign-up, CORS open). Terrarium-encoded 512 px WebP tiles in Web Mercator, z0-z12 everywhere
// (Copernicus GLO-30 outside lidar) and deeper (to z17, ~0.6 m) only where a national lidar model exists: Germany,
// Switzerland, Austria, England/Scotland/Wales, France, Spain, the Netherlands, Japan, Australia, New Zealand, parts
// of the US and Canada, and more (https://mapterhorn.com/coverage).
//
// Used as "free lidar where it exists": the deepest useful tiles for the map's resolution, stitched into overlapping
// grid chunks (EPSG:3857) the resampler reads like any raster source. Tiles deeper than z12 are lidar; where only
// z12 exists, nothing is returned and the standard 30 m fills in, as for every raster source. A deep tile missing at
// a lidar boundary is taken from its nearest ancestor deeper than z12, upsampled in heights (never in colours).
import { decodeTerrariumPixels } from './terrariumSampling.js';

export const MAPTERHORN_TILE_URL = 'https://tiles.mapterhorn.com';
// MapNG's own cache of the lidar tiles (worker.js /api/mapterhorn, kept in R2); Mapterhorn directly when it fails
export const MAPTERHORN_CACHE_URL = '/api/mapterhorn';
export const MAPTERHORN_ATTRIBUTION = '© Mapterhorn (mapterhorn.com/attribution) and its open-data sources';
const TILE = 512;
const MAX_ZOOM = 17;
const LIDAR_MIN_ZOOM = 13;          // deeper than z12 = a national lidar model
const MERC_HALF = 20037508.342789244;
const CHUNK_PX = 4096;              // grid chunk size (the resampler skips a tile's last row/column: chunks overlap)
const OVERLAP_PX = 2;
const MAX_MOSAIC_PX = 72e6;         // memory budget for the stitched heights (~290 MB of Float32)
const NO_DATA = -99999;

const tileSizeM = (z) => (2 * MERC_HALF) / 2 ** z;
const lngToMx = (lng) => (lng * MERC_HALF) / 180;
const latToMy = (lat) => (Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360)) * MERC_HALF) / Math.PI;
const tileRange = (b, z) => {
  const s = tileSizeM(z);
  return {
    x0: Math.floor((lngToMx(b.west) + MERC_HALF) / s), x1: Math.floor((lngToMx(b.east) + MERC_HALF) / s),
    y0: Math.floor((MERC_HALF - latToMy(b.north)) / s), y1: Math.floor((MERC_HALF - latToMy(b.south)) / s),
  };
};

/**
 * The zoom whose pixels are about as fine as the map's (no finer: a 1 m map gains nothing from 0.6 m tiles), within
 * the memory budget. Mercator pixels shrink by cos(lat) on the ground.
 */
export function mapterhornZoomFor(bounds, metersPerPixel) {
  const lat = (bounds.north + bounds.south) / 2;
  const k = Math.cos((lat * Math.PI) / 180);
  // the coarsest zoom whose ground pixels are still no larger than the map's
  let z = MAX_ZOOM;
  while (z > LIDAR_MIN_ZOOM && (tileSizeM(z - 1) / TILE) * k <= metersPerPixel) z--;
  for (; z > LIDAR_MIN_ZOOM; z--) {
    const r = tileRange(bounds, z);
    if ((r.x1 - r.x0 + 1) * (r.y1 - r.y0 + 1) * TILE * TILE <= MAX_MOSAIC_PX) break;
  }
  return z;
}

// fetch (a 404 = no tile at this zoom here; the desktop's source recorder sees it for offline rebuilds), then
// decode. Through MapNG's cache first; Mapterhorn directly when the cache errors or answers something that is no
// tile (a bot check page, an outage), never after a real 404.
const tryFetch = async (url, signal) => {
  try {
    const r = await fetch(url, { signal });
    if (r.status === 404) return { missing: true };
    if (!r.ok || !/image\//.test(r.headers.get('content-type') || 'image/')) return { failed: true };
    return { bitmap: await createImageBitmap(await r.blob()) };
  } catch (e) { if (signal?.aborted) throw e; return { failed: true }; }
};
const defaultLoadImage = async (url, signal) => {
  const cached = await tryFetch(url, signal);
  if (cached.bitmap) return cached.bitmap;
  if (cached.missing || !url.startsWith(MAPTERHORN_CACHE_URL)) return null;
  const direct = await tryFetch(MAPTERHORN_TILE_URL + url.slice(MAPTERHORN_CACHE_URL.length), signal);
  return direct.bitmap || null;
};

const decodeImage = (img) => {
  const c = document.createElement('canvas');
  c.width = TILE; c.height = TILE;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(img, 0, 0, TILE, TILE);
  const { data } = ctx.getImageData(0, 0, TILE, TILE);
  c.width = 0; c.height = 0;
  img.close?.();
  return decodeTerrariumPixels(data, TILE, TILE, NO_DATA);
};

async function pool(items, n, fn, signal) {
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (i < items.length) { signal?.throwIfAborted?.(); const k = i++; await fn(items[k], k); }
  }));
}

/**
 * Fetch Mapterhorn lidar for bounds. Returns null when the area has no tile deeper than z12 (no lidar), else
 * { tiles: grid chunks for the resampler (epsgCode 3857), zoom, lidarFraction, tilesFetched }.
 * opts: { metersPerPixel, onProgress, signal, loadImage, concurrency }
 */
export async function fetchMapterhornRaw(bounds, opts = {}) {
  const { metersPerPixel = 1, onProgress, signal, loadImage = defaultLoadImage, concurrency = 12 } = opts;
  const url = (z, x, y) => `${MAPTERHORN_CACHE_URL}/${z}/${x}/${y}.webp`;
  const zTarget = mapterhornZoomFor(bounds, metersPerPixel);
  const cache = new Map();
  const get = (z, x, y) => {
    const key = `${z}/${x}/${y}`;
    if (!cache.has(key)) cache.set(key, loadImage(url(z, x, y), signal).then((img) => (img ? decodeImage(img) : null)));
    return cache.get(key);
  };
  // Any lidar here at all? z13 exists only over a national model: probe the centre and corners (cheap), then the
  // whole box at z13 when they all miss (lidar covering only part of the map).
  const probes = [[bounds.north, bounds.west], [bounds.north, bounds.east], [bounds.south, bounds.west], [bounds.south, bounds.east],
    [(bounds.north + bounds.south) / 2, (bounds.west + bounds.east) / 2]];
  onProgress?.('Checking Mapterhorn lidar coverage...');
  const at13 = (lat, lng) => { const t = tileRange({ north: lat, south: lat, west: lng, east: lng }, LIDAR_MIN_ZOOM); return get(LIDAR_MIN_ZOOM, t.x0, t.y0); };
  let any = (await Promise.all(probes.map(([lat, lng]) => at13(lat, lng)))).some(Boolean);
  if (!any) {
    const r13 = tileRange(bounds, LIDAR_MIN_ZOOM); const all = [];
    for (let y = r13.y0; y <= r13.y1; y++) for (let x = r13.x0; x <= r13.x1; x++) all.push(get(LIDAR_MIN_ZOOM, x, y));
    any = (await Promise.all(all)).some(Boolean);
  }
  if (!any) return null;
  // Every tile at the target zoom; each missing one from its own nearest lidar ancestor.
  const z = zTarget;
  const r = tileRange(bounds, z);
  const nx = r.x1 - r.x0 + 1, ny = r.y1 - r.y0 + 1;
  const W = nx * TILE, H = ny * TILE;
  const mosaic = new Float32Array(W * H).fill(NO_DATA);
  const jobs = []; for (let ty = r.y0; ty <= r.y1; ty++) for (let tx = r.x0; tx <= r.x1; tx++) jobs.push([tx, ty]);
  let done = 0, lidar = 0, deepest = 0;
  onProgress?.(`Fetching Mapterhorn lidar tiles (z${z}, ${jobs.length})...`);
  await pool(jobs, concurrency, async ([tx, ty]) => {
    let heights = await get(z, tx, ty);
    let step = 0;
    // missing at this zoom (the edge of a lidar survey): the nearest lidar ancestor, upsampled
    while (!heights && z - step - 1 >= LIDAR_MIN_ZOOM) {
      step++;
      const anc = await get(z - step, tx >> step, ty >> step);
      if (!anc) continue;
      const span = TILE >> step, sx = (tx & ((1 << step) - 1)) * span, sy = (ty & ((1 << step) - 1)) * span;
      heights = new Float32Array(TILE * TILE);
      for (let y = 0; y < TILE; y++) for (let x = 0; x < TILE; x++) {
        const fx = sx + ((x + 0.5) * span) / TILE - 0.5, fy = sy + ((y + 0.5) * span) / TILE - 0.5;
        const x0 = Math.max(0, Math.min(TILE - 1, Math.floor(fx))), y0 = Math.max(0, Math.min(TILE - 1, Math.floor(fy)));
        const x1 = Math.min(TILE - 1, x0 + 1), y1 = Math.min(TILE - 1, y0 + 1), u = Math.max(0, fx - x0), v = Math.max(0, fy - y0);
        const a = anc[y0 * TILE + x0], b = anc[y0 * TILE + x1], c = anc[y1 * TILE + x0], d = anc[y1 * TILE + x1];
        heights[y * TILE + x] = [a, b, c, d].some((h) => h === NO_DATA) ? NO_DATA : (a * (1 - u) + b * u) * (1 - v) + (c * (1 - u) + d * u) * v;
      }
    }
    if (heights) {
      lidar++; deepest = Math.max(deepest, z - step);
      const ox = (tx - r.x0) * TILE, oy = (ty - r.y0) * TILE;
      for (let y = 0; y < TILE; y++) mosaic.set(heights.subarray(y * TILE, (y + 1) * TILE), (oy + y) * W + ox);
    }
    if (++done % 16 === 0) onProgress?.(`Fetching Mapterhorn lidar tiles (z${z}): ${done}/${jobs.length}...`);
  }, signal);
  cache.clear();
  if (!lidar) return null;
  // overlapping chunks in EPSG:3857, pixel-centre origins
  const res = tileSizeM(z) / TILE;
  const west = -MERC_HALF + r.x0 * tileSizeM(z), north = MERC_HALF - r.y0 * tileSizeM(z);
  const tiles = [];
  for (let cy = 0; cy < H; cy += CHUNK_PX - OVERLAP_PX) for (let cx = 0; cx < W; cx += CHUNK_PX - OVERLAP_PX) {
    const w = Math.min(CHUNK_PX, W - cx), h = Math.min(CHUNK_PX, H - cy);
    if (w < 2 || h < 2) continue;
    const raster = new Float32Array(w * h); let any = false;
    for (let y = 0; y < h; y++) {
      const row = mosaic.subarray((cy + y) * W + cx, (cy + y) * W + cx + w);
      raster.set(row, y * w);
      if (!any) for (let i = 0; i < w; i += 16) if (row[i] !== NO_DATA) { any = true; break; }
    }
    if (!any) continue;
    tiles.push({ raster, width: w, height: h, originX: west + (cx + 0.5) * res, originY: north - (cy + 0.5) * res, resX: res, resY: -res, noData: NO_DATA, epsgCode: 3857 });
    if (cx + w >= W) break;
  }
  // (zoom and metres per pixel of the deepest data found: tiles from coarser ancestors are upsampled into the mosaic)
  const k = Math.cos(((bounds.north + bounds.south) / 2) * Math.PI / 180);
  return { tiles, zoom: deepest, lidarFraction: lidar / jobs.length, tilesFetched: jobs.length, metersPerPixel: (tileSizeM(deepest) / TILE) * k };
}
