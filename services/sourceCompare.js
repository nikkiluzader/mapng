// "Compare here": a small square of heights from each elevation source at one point, drawn as hillshades side by
// side, so the difference between the sources shows instead of being described. Standard 30 m (AWS Terrarium z15),
// Mapterhorn (its deepest zoom there, through MapNG's tile cache) and GPXZ (one hires-raster request, only when the
// user asks: it counts against their plan).
import { decodeTerrariumPixels } from './terrariumSampling.js';
import { MAPTERHORN_CACHE_URL, MAPTERHORN_TILE_URL } from './mapterhorn.js';

const AWS = 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium';
const NO_DATA = -99999;
const R = 6378137;
const mx = (lng) => (R * lng * Math.PI) / 180;
const my = (lat) => R * Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360));
const WORLD = 2 * Math.PI * R;

async function tileHeights(url, size, signal) {
  let r;
  try { r = await fetch(url, { signal }); } catch (e) { if (signal?.aborted) throw e; return null; }
  if (!r.ok || !/image\//.test(r.headers.get('content-type') || 'image/')) return null;
  const bmp = await createImageBitmap(await r.blob());
  const c = document.createElement('canvas'); c.width = size; c.height = size;
  const ctx = c.getContext('2d', { willReadFrequently: true }); ctx.imageSmoothingEnabled = false;
  ctx.drawImage(bmp, 0, 0, size, size); bmp.close?.();
  const { data } = ctx.getImageData(0, 0, size, size); c.width = 0;
  return decodeTerrariumPixels(data, size, size, NO_DATA);
}

/** Heights (px x px, row 0 north) of a sideM square at center from Web Mercator Terrarium tiles. */
async function mercatorPatch({ center, sideM, px, z, tileSize, url, signal }) {
  const k = Math.cos((center.lat * Math.PI) / 180);
  const half = sideM / 2 / k;                         // mercator metres
  const cx = mx(center.lng), cy = my(center.lat);
  const tm = WORLD / 2 ** z;
  const tx0 = Math.floor((cx - half + WORLD / 2) / tm), tx1 = Math.floor((cx + half + WORLD / 2) / tm);
  const ty0 = Math.floor((WORLD / 2 - (cy + half)) / tm), ty1 = Math.floor((WORLD / 2 - (cy - half)) / tm);
  const tiles = new Map();
  await Promise.all([...Array((tx1 - tx0 + 1) * (ty1 - ty0 + 1)).keys()].map(async (i) => {
    const x = tx0 + (i % (tx1 - tx0 + 1)), y = ty0 + Math.floor(i / (tx1 - tx0 + 1));
    tiles.set(`${x}/${y}`, await url(z, x, y));
  }));
  // bilinear across tile edges (global pixel coordinates), as the app samples: nearest-neighbour made coarse data
  // look blockier than it renders
  const px0 = (gx, gy) => {
    const tx = Math.floor(gx / tileSize), ty = Math.floor(gy / tileSize); const t = tiles.get(`${tx}/${ty}`);
    if (!t) return NaN; const v = t[(gy - ty * tileSize) * tileSize + (gx - tx * tileSize)]; return v === NO_DATA ? NaN : v;
  };
  const out = new Float32Array(px * px);
  for (let j = 0; j < px; j++) for (let i = 0; i < px; i++) {
    const X = cx - half + ((i + 0.5) / px) * 2 * half, Y = cy + half - ((j + 0.5) / px) * 2 * half;
    const gx = ((X + WORLD / 2) / tm) * tileSize - 0.5, gy = ((WORLD / 2 - Y) / tm) * tileSize - 0.5;
    const x0 = Math.floor(gx), y0 = Math.floor(gy), u = gx - x0, v = gy - y0;
    const a = px0(x0, y0), b = px0(x0 + 1, y0), c = px0(x0, y0 + 1), d = px0(x0 + 1, y0 + 1);
    out[j * px + i] = (a * (1 - u) + b * u) * (1 - v) + (c * (1 - u) + d * u) * v;
  }
  return out;
}

// separable Gaussian (sigma in cells), NaN-aware
function blur(h, px, sigma) {
  const r = Math.ceil(sigma * 3), k = []; for (let i = -r; i <= r; i++) k.push(Math.exp(-(i * i) / (2 * sigma * sigma)));
  const pass = (src, horiz) => {
    const out = new Float32Array(src.length);
    for (let j = 0; j < px; j++) for (let i = 0; i < px; i++) {
      let s = 0, w = 0;
      for (let t = -r; t <= r; t++) {
        const x = horiz ? Math.min(px - 1, Math.max(0, i + t)) : i, y = horiz ? j : Math.min(px - 1, Math.max(0, j + t));
        const v = src[y * px + x]; if (Number.isFinite(v)) { s += v * k[t + r]; w += k[t + r]; }
      }
      out[j * px + i] = w ? s / w : NaN;
    }
    return out;
  };
  return pass(pass(h, true), false);
}

/** Standard 30 m as MapNG builds levels from it: the z15 tiles hold 30 m data in blocky steps, which the app
 *  smooths (terrariumSampling.js: B-spline and a ~5 m blur); shown the same way so the comparison is fair. */
export async function standardPatch(center, { sideM = 512, px = 192, signal } = {}) {
  const h = await mercatorPatch({ center, sideM, px, z: 15, tileSize: 256, url: (z, x, y) => tileHeights(`${AWS}/${z}/${x}/${y}.png`, 256, signal), signal });
  return blur(h, px, Math.max(1, 6 / (sideM / px)));
}

export async function mapterhornPatch(center, zoom, { sideM = 512, px = 192, signal } = {}) {
  const url = async (z, x, y) => (await tileHeights(`${MAPTERHORN_CACHE_URL}/${z}/${x}/${y}.webp`, 512, signal))
    || tileHeights(`${MAPTERHORN_TILE_URL}/${z}/${x}/${y}.webp`, 512, signal);
  return mercatorPatch({ center, sideM, px, z: Math.max(13, Math.min(17, zoom)), tileSize: 512, url, signal });
}

export async function gpxzPatch(center, apiKey, { sideM = 512, px = 192, signal } = {}) {
  const dLat = sideM / 2 / 111320, dLng = dLat / Math.cos((center.lat * Math.PI) / 180);
  const b = { n: center.lat + dLat, s: center.lat - dLat, w: center.lng - dLng, e: center.lng + dLng };
  const r = await fetch(`/api/gpxz/v1/elevation/hires-raster?bbox_top=${b.n}&bbox_bottom=${b.s}&bbox_left=${b.w}&bbox_right=${b.e}&res_m=best&projection=latlon&tight_bounds=false`, { headers: { 'x-api-key': apiKey }, signal });
  if (!r.ok) throw new Error(`GPXZ ${r.status}`);
  const { fromArrayBuffer } = await import('geotiff');
  const img = await (await fromArrayBuffer(await r.arrayBuffer())).getImage();
  const [x0, y0, x1, y1] = img.getBoundingBox(); const W = img.getWidth(), H = img.getHeight();
  const [ras] = await img.readRasters(); const nd = img.getGDALNoData();
  const out = new Float32Array(px * px);
  for (let j = 0; j < px; j++) for (let i = 0; i < px; i++) {
    const lng = b.w + ((i + 0.5) / px) * (b.e - b.w), lat = b.n - ((j + 0.5) / px) * (b.n - b.s);
    out[j * px + i] = bilinearAt(ras, W, H, ((lng - x0) / (x1 - x0)) * W - 0.5, ((y1 - lat) / (y1 - y0)) * H - 0.5, nd);
  }
  return out;
}

/**
 * A raster's value at pixel coordinates (fx, fy), between its four nearest pixel centres; NaN off the raster
 * or beside no-data. The patch used to take the nearest pixel: where the raster's pixels are not the patch's
 * size, that repeats a row and a column every few pixels, which a hillshade draws as a grid of thin lines
 * (alxti: "GPXZ has a bunch of weird grid lines"), and where the raster is coarse (GPXZ with no lidar under it
 * hands out 30 m data) it draws flat blocks with steps between them, a staircase the 30 m source beside it
 * did not show (Sint Eustatius). Neither was in the data.
 */
export function bilinearAt(ras, W, H, fx, fy, nd = null) {
  if (!(fx >= -0.5 && fy >= -0.5 && fx <= W - 0.5 && fy <= H - 0.5)) return NaN;
  const x = Math.max(0, Math.min(W - 1, fx)); const y = Math.max(0, Math.min(H - 1, fy));
  const x0 = Math.min(W - 2 < 0 ? 0 : W - 2, Math.floor(x)); const y0 = Math.min(H - 2 < 0 ? 0 : H - 2, Math.floor(y));
  const x1 = Math.min(W - 1, x0 + 1); const y1 = Math.min(H - 1, y0 + 1);
  const u = x - x0; const v = y - y0;
  const a = ras[y0 * W + x0]; const b2 = ras[y0 * W + x1]; const c = ras[y1 * W + x0]; const d = ras[y1 * W + x1];
  const bad = (q) => q === nd || !Number.isFinite(q);
  if (bad(a) || bad(b2) || bad(c) || bad(d)) return NaN;
  return (a * (1 - u) + b2 * u) * (1 - v) + (c * (1 - u) + d * u) * v;
}

// Coarse coverage boxes [south, west, north, east] of the region-only surveys (the source selector's own).
export const REGIONAL_COVERAGE = {
  // USGS 3DEP 1 m: conterminous US, Alaska, Hawaii, Puerto Rico
  usgs: [[24.4, -125.0, 49.5, -66.8], [51.0, -180.0, 71.6, -129.9], [18.8, -160.4, 22.4, -154.7], [17.8, -67.4, 18.6, -65.2]],
  // NMT EVRF2007: Poland
  kron86: [[49.0, 14.1, 54.9, 24.2]],
};

/** The regional surveys that may cover a place: [] | ['usgs'] | ['kron86']. */
export function regionalSourcesAt(center) {
  const lat = Number(center?.lat); const lng = Number(center?.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return [];
  return Object.keys(REGIONAL_COVERAGE).filter((k) => REGIONAL_COVERAGE[k].some(([s, w, n, e]) => lat >= s && lat <= n && lng >= w && lng <= e));
}

/**
 * The square from the USGS 1 m survey, read out of the survey's own files in place: each is a tile 10 km
 * across and 150 to 450 MB (two cover St. Augustine's centre: 580 MB), and a 500 m square of one is a few
 * hundred kilobytes, so only that part is asked for (the files are laid out for partial reads, and the
 * server allows them). null where the catalogue has no 1 m tile.
 */
export async function usgsPatch(center, { sideM = 512, px = 192, signal, onProgress } = {}) {
  const dLat = sideM / 2 / 111320, dLng = dLat / Math.cos((center.lat * Math.PI) / 180);
  const b = { n: center.lat + dLat, s: center.lat - dLat, w: center.lng - dLng, e: center.lng + dLng };
  onProgress?.('USGS…');
  const { usgsCatalogue, usgsItemsOver, usgsUtmDef, readUsgsImageService } = await import('./usgsWindow.js');
  // (the image service first: one request for the square; the survey's files when it does not answer)
  try {
    const pieces = await readUsgsImageService({ north: b.n, south: b.s, east: b.e, west: b.w }, { signal });
    if (!pieces.length) return null;
    const grid = new Float32Array(px * px).fill(NaN); let got = 0;
    for (const { image, raster, noData } of pieces) {
      const [x0, y0, x1, y1] = image.getBoundingBox(); const W = image.getWidth(), H = image.getHeight();
      for (let j = 0; j < px; j++) for (let i = 0; i < px; i++) {
        const at = j * px + i; if (Number.isFinite(grid[at])) continue;
        const lng = b.w + ((i + 0.5) / px) * (b.e - b.w), lat = b.n - ((j + 0.5) / px) * (b.n - b.s);
        const v = bilinearAt(raster, W, H, ((lng - x0) / (x1 - x0)) * W - 0.5, ((y1 - lat) / (y1 - y0)) * H - 0.5, noData);
        if (Number.isFinite(v)) { grid[at] = v; got++; }
      }
    }
    return got > grid.length * 0.2 ? grid : null;
  } catch (e) { if (signal?.aborted) throw e; console.warn('[Compare] USGS image service', e); }
  const listed = await usgsCatalogue({ north: b.n, south: b.s, east: b.e, west: b.w }, { signal, tries: 2 });
  if (!listed) throw new Error('USGS catalogue did not answer');
  const items = usgsItemsOver(listed, { north: b.n, south: b.s, east: b.e, west: b.w });
  if (!items.length) return null;
  const [{ fromUrl }, { default: proj4 }] = await Promise.all([import('geotiff'), import('proj4')]);
  const out = new Float32Array(px * px).fill(NaN); let filled = 0;
  for (let k = 0; k < items.length && filled < out.length; k++) {
    signal?.throwIfAborted?.();
    onProgress?.(`USGS ${k + 1}/${items.length}…`);
    try {
      const img = await (await fromUrl(items[k].downloadURL, {}, signal)).getImage();
      const keys = img.getGeoKeys() || {};
      const to = proj4('EPSG:4326', usgsUtmDef(keys.ProjectedCSTypeGeoKey, center.lng));
      const [x0, y0, x1, y1] = img.getBoundingBox(); const W = img.getWidth(), H = img.getHeight();
      const corners = [[b.w, b.n], [b.e, b.n], [b.w, b.s], [b.e, b.s]].map((c) => to.forward(c));
      const col = (x) => ((x - x0) / (x1 - x0)) * W; const row = (y) => ((y1 - y) / (y1 - y0)) * H;
      const c0 = Math.max(0, Math.floor(Math.min(...corners.map((c) => col(c[0]))) - 2)); const c1 = Math.min(W, Math.ceil(Math.max(...corners.map((c) => col(c[0]))) + 2));
      const r0 = Math.max(0, Math.floor(Math.min(...corners.map((c) => row(c[1]))) - 2)); const r1 = Math.min(H, Math.ceil(Math.max(...corners.map((c) => row(c[1]))) + 2));
      if (!(c1 - c0 >= 2 && r1 - r0 >= 2)) continue;
      const [ras] = await img.readRasters({ window: [c0, r0, c1, r1], signal }); const nd = img.getGDALNoData();
      const w = c1 - c0, h = r1 - r0;
      for (let j = 0; j < px; j++) for (let i = 0; i < px; i++) {
        const at = j * px + i; if (Number.isFinite(out[at])) continue;
        const [x, y] = to.forward([b.w + ((i + 0.5) / px) * (b.e - b.w), b.n - ((j + 0.5) / px) * (b.n - b.s)]);
        const v = bilinearAt(ras, w, h, col(x) - c0 - 0.5, row(y) - r0 - 0.5, nd);
        if (Number.isFinite(v) && v > -1000) { out[at] = v; filled++; }
      }
    } catch (e) { if (signal?.aborted) throw e; console.warn('[Compare] USGS tile', e); }
  }
  // (a sliver of the square is no comparison)
  return filled > out.length * 0.2 ? out : null;
}

/**
 * The square from a region's own survey ('usgs' | 'kron86'). USGS: usgsPatch. Poland's NMT is read the way
 * a map is: the app's terrain fetch on the square alone, heights as downloaded (no ground filter, no road
 * shaping, no textures); it downloads the survey's sheets for the spot. null where the survey has nothing.
 * Asked for with a click, never on its own.
 */
export async function regionalPatch(center, kind, { sideM = 512, px = 192, signal, onProgress } = {}) {
  if (kind === 'usgs') return usgsPatch(center, { sideM, px, signal, onProgress });
  const { fetchTerrainData } = await import('./terrain.js');
  const data = await fetchTerrainData(center, px, false, kind === 'usgs', false, kind === 'kron86', '', undefined, onProgress, signal, {
    keepSourceGeoTiffs: false, generateOSMTextureAsset: false, generateHybridTextureAsset: false, generateGameTextureAsset: false,
    processingMetersPerPixel: sideM / px, raw: true, groundFilter: false, lowerWater: false, smoothRoads: false,
  });
  try { if (data?.satelliteTextureUrl) URL.revokeObjectURL(data.satelliteTextureUrl); } catch { /* not a blob address */ }
  if (!data?.heightMap || (kind === 'usgs' && data.usgsFallback) || (kind === 'kron86' && data.kron86Fallback)) return null;
  const out = new Float32Array(px * px);
  for (let i = 0; i < out.length; i++) { const h = data.heightMap[i]; out[i] = Number.isFinite(h) && h > -9000 ? h : NaN; }
  return out;
}

/** A hillshade of heights (px x px, cell metres) as a data URL. */
export function hillshadeDataUrl(h, px, cellM) {
  const c = document.createElement('canvas'); c.width = px; c.height = px;
  const ctx = c.getContext('2d'); const img = ctx.createImageData(px, px);
  const at = (i, j) => { const v = h[Math.min(px - 1, Math.max(0, j)) * px + Math.min(px - 1, Math.max(0, i))]; return Number.isFinite(v) ? v : 0; };
  const az = (315 * Math.PI) / 180, alt = (45 * Math.PI) / 180;
  for (let j = 0; j < px; j++) for (let i = 0; i < px; i++) {
    const dx = (at(i + 1, j) - at(i - 1, j)) / (2 * cellM), dy = (at(i, j + 1) - at(i, j - 1)) / (2 * cellM);
    const slope = Math.atan(Math.hypot(dx, dy) * 1.5), aspect = Math.atan2(dy, -dx);
    const v = Math.max(0, Math.cos(alt) * Math.cos(slope) + Math.sin(alt) * Math.sin(slope) * Math.cos(az - aspect));
    const k = (j * px + i) * 4, g = Number.isFinite(h[j * px + i]) ? 30 + v * 215 : 0;
    img.data[k] = g; img.data[k + 1] = g; img.data[k + 2] = Number.isFinite(h[j * px + i]) ? g : 60; img.data[k + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  const url = c.toDataURL('image/png'); c.width = 0; return url;
}
