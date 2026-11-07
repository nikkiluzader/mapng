// ESA WorldCover 2021 (10 m, global, CC BY 4.0): what covers the ground,
// from Sentinel-1 and -2 imagery. MapNG uses it to plant trees only where
// there is tree cover. OSM's woods are often drawn generously, and in the
// mountains they reach far above the tree line (Fizz_Mechanic's Tignes level:
// 144,000 trees above 2,250 m).
//
// 3 x 3 degree cloud-optimised GeoTIFFs on AWS, read by range requests. The
// bucket sends no CORS headers: a browser reads them through the MapNG
// Worker (/api/worldcover/<file>); the desktop app's Node generator and
// exporter read the bucket directly.
// https://esa-worldcover.org  ·  https://registry.opendata.aws/esa-worldcover-vito/
import { fromUrl } from 'geotiff';

export const WORLDCOVER_BUCKET = 'https://esa-worldcover.s3.eu-central-1.amazonaws.com/v200/2021/map/';
export const WORLDCOVER_PROXY = '/api/worldcover/';
export const WORLDCOVER_ATTRIBUTION = '© ESA WorldCover project / Contains modified Copernicus Sentinel data (2021) processed by ESA WorldCover consortium (CC BY 4.0)';

// the map's classes
export const WC = {
  TREES: 10, SHRUBS: 20, GRASS: 30, CROPS: 40, BUILT: 50, BARE: 60, SNOW: 70, WATER: 80, WETLAND: 90, MANGROVES: 95, MOSS: 100,
};

const inNode = () => typeof process !== 'undefined' && !!process.versions?.node && !process.versions.electron;

/** The tile holding a point: ESA_WorldCover_10m_2021_v200_N45E006_Map.tif (named by its south-west corner). */
export function worldCoverTileName(lat, lng) {
  const la = Math.floor(lat / 3) * 3; const lo = Math.floor(lng / 3) * 3;
  const ns = `${la < 0 ? 'S' : 'N'}${String(Math.abs(la)).padStart(2, '0')}`;
  const ew = `${lo < 0 ? 'W' : 'E'}${String(Math.abs(lo)).padStart(3, '0')}`;
  return `ESA_WorldCover_10m_2021_v200_${ns}${ew}_Map.tif`;
}

const tiffs = new Map();   // file -> Promise<GeoTIFFImage | null>
// (the first bytes must be a TIFF's: a server answering with a web page, as a
// dev server does for a path it lacks, left the GeoTIFF reader waiting forever)
async function looksLikeTiff(url) {
  const r = await fetch(url, { headers: { Range: 'bytes=0-7' } });
  if (r.status === 404 || r.status === 403) return null;
  if (!r.ok) throw new Error(`WorldCover: ${r.status}`);
  if (/text\/html/i.test(r.headers.get('content-type') || '')) throw new Error('WorldCover: not a GeoTIFF (a web page)');
  const b = new Uint8Array(await r.arrayBuffer());
  if (!((b[0] === 0x49 && b[1] === 0x49) || (b[0] === 0x4d && b[1] === 0x4d))) throw new Error('WorldCover: not a GeoTIFF');
  return true;
}
function image(file, base) {
  const key = base + file;
  if (!tiffs.has(key)) {
    tiffs.set(key, looksLikeTiff(base + file).then((ok) => (ok ? fromUrl(base + file).then((t) => t.getImage()) : null)).catch((e) => {
      tiffs.delete(key);
      // (a tile that doesn't exist: open sea; WorldCover covers all land)
      if (/404|403|Not Found/i.test(String(e?.message || e))) return null;
      throw e;
    }));
  }
  return tiffs.get(key);
}

/**
 * The land cover over bounds on an nx x ny grid of cell centres (row 0 north):
 * a Uint8Array of WC classes, 0 where there is no data (open sea). Throws when
 * the tiles can't be read. base: where the tiles are read from (default: the
 * bucket in Node, the Worker's proxy in a browser).
 */
// (the whole read gives up after this: an export never waits on the land cover)
const WORLDCOVER_TIMEOUT_MS = 20000;

export async function fetchWorldCoverGrid(bounds, nx, ny, opts = {}) {
  let timer = null;
  const timeout = new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`WorldCover: no answer in ${WORLDCOVER_TIMEOUT_MS / 1000} s`)), opts.timeoutMs ?? WORLDCOVER_TIMEOUT_MS); });
  try {
    return await Promise.race([readWorldCoverGrid(bounds, nx, ny, opts), timeout]);
  } finally {
    clearTimeout(timer);
  }
}

async function readWorldCoverGrid(bounds, nx, ny, { signal, base = inNode() ? WORLDCOVER_BUCKET : WORLDCOVER_PROXY } = {}) {
  const out = new Uint8Array(nx * ny);
  const files = new Set();
  for (let la = Math.floor(bounds.south / 3) * 3; la < bounds.north; la += 3) {
    for (let lo = Math.floor(bounds.west / 3) * 3; lo < bounds.east; lo += 3) files.add(worldCoverTileName(la + 0.5, lo + 0.5));
  }
  for (const file of files) {
    const img = await image(file, base);
    if (!img) continue;
    const [x0, y0, x1, y1] = img.getBoundingBox(); const [rx, ry] = img.getResolution();   // ry < 0
    const west = Math.max(bounds.west, x0); const east = Math.min(bounds.east, x1);
    const south = Math.max(bounds.south, y0); const north = Math.min(bounds.north, y1);
    if (east <= west || north <= south) continue;
    const c0 = Math.max(0, Math.floor((west - x0) / rx)); const c1 = Math.min(img.getWidth(), Math.ceil((east - x0) / rx));
    const r0 = Math.max(0, Math.floor((north - y1) / ry)); const r1 = Math.min(img.getHeight(), Math.ceil((south - y1) / ry));
    if (c1 <= c0 || r1 <= r0) continue;
    const [d] = await img.readRasters({ window: [c0, r0, c1, r1], signal });
    const w = c1 - c0; const h = r1 - r0;
    for (let y = 0; y < ny; y++) {
      const lat = bounds.north - ((y + 0.5) / ny) * (bounds.north - bounds.south);
      if (lat < south || lat > north) continue;
      const j = Math.min(h - 1, Math.max(0, Math.floor((lat - y1) / ry) - r0));
      for (let x = 0; x < nx; x++) {
        const lng = bounds.west + ((x + 0.5) / nx) * (bounds.east - bounds.west);
        if (lng < west || lng > east) continue;
        const i = Math.min(w - 1, Math.max(0, Math.floor((lng - x0) / rx) - c0));
        out[y * nx + x] = d[j * w + i];
      }
    }
  }
  return out;
}

/**
 * Whether a planted tree or bush may stand on this land cover (cls 0: no
 * data, allowed). kind: 'wood' (a tree from a mapped wood or forest), 'bush'
 * (from scrub, heath or wetland), 'scatter' (trees scattered over a park, a
 * green or yards). u: a 0..1 draw, for the classes that keep only some.
 */
export function plantAllowed(cls, kind, u) {
  if (!cls) return true;
  if (kind === 'wood') {
    if (cls === WC.TREES || cls === WC.MANGROVES) return true;
    if (cls === WC.SHRUBS) return u < 0.35;
    if (cls === WC.GRASS || cls === WC.CROPS || cls === WC.WETLAND) return u < 0.06;
    if (cls === WC.BUILT) return u < 0.25;   // (a town's trees often class as built-up at 10 m)
    return false;   // bare rock, snow and ice, water, moss and lichen
  }
  if (kind === 'bush') {
    if (cls === WC.SNOW || cls === WC.WATER) return false;
    if (cls === WC.BARE) return u < 0.2;
    if (cls === WC.MOSS) return u < 0.15;
    return true;
  }
  // scatter: anything but rock, snow, water and tundra
  return !(cls === WC.BARE || cls === WC.SNOW || cls === WC.WATER || cls === WC.MOSS);
}

/**
 * Read the land cover once while generating (Generate Data / Preview 3D) and
 * keep it with the terrain: terrainData.landCover = { grid, n } (n x n cells
 * over the bounds, about 10 m each, row 0 north), or null when it can't be
 * read (the level is made without it). Everything after reads this copy: the
 * ground textures and materials, grass, and the trees in the preview and the
 * level.
 */
export async function attachLandCover(terrainData, { onProgress, signal } = {}) {
  if (!terrainData?.bounds || !terrainData.width) return null;
  const mpp = Number(terrainData.processingMetersPerPixel) || 1;
  const worldSize = terrainData.width * mpp;
  const n = Math.min(4096, Math.max(64, Math.ceil(worldSize / 10)));
  try {
    onProgress?.('Loading land cover (ESA WorldCover)…');
    const grid = await fetchWorldCoverGrid(terrainData.bounds, n, n, { signal });
    terrainData.landCover = { grid, n };
  } catch (error) {
    if (error?.name === 'AbortError') throw error;
    console.warn('[WorldCover] land cover unavailable; the level is made without it.', error?.message || error);
    terrainData.landCover = null;
  }
  return terrainData.landCover;
}

/** The land cover class at world (x, y) metres (terrain centre origin), 0 without one. */
export function landCoverAt(landCover, worldSize, x, y) {
  if (!landCover?.grid) return 0;
  const { grid, n } = landCover;
  const c = Math.min(n - 1, Math.max(0, Math.floor((x / worldSize + 0.5) * n)));
  const r = Math.min(n - 1, Math.max(0, Math.floor((0.5 - y / worldSize) * n)));
  return grid[r * n + c];
}
