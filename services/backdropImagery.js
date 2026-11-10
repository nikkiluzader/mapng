// The backdrop's satellite imagery (the eight tiles round the map): how fine
// a picture is downloaded for it. The backdrop is seen from a distance, so
// its standard imagery is coarser than the map's own; a finer one costs more
// downloads and more memory. The picture for all eight tiles is stitched on
// one canvas before it is cut up, and a browser tab cannot hold a very large
// one: there the zoom is stepped down until the canvas fits (stitchLimit).
// The desktop app's limit is the canvas's own.
export const BACKDROP_IMAGERY = Object.freeze({
  standard: { zoom: 15, textureSize: 1024 },
  high: { zoom: 16, textureSize: 2048 },
  veryhigh: { zoom: 17, textureSize: 4096 },
});
export const BACKDROP_IMAGERY_IDS = Object.keys(BACKDROP_IMAGERY);
export const DEFAULT_BACKDROP_IMAGERY = 'standard';
export const WEB_STITCH_LIMIT_PX = 8192;       // (268 MB as pixels: a tab's safe share)
export const DESKTOP_STITCH_LIMIT_PX = 16384;  // (the canvas's own limit)
const TILE = 256;

export const backdropImageryId = (v) => (BACKDROP_IMAGERY_IDS.includes(v) ? v : DEFAULT_BACKDROP_IMAGERY);

const mercY = (lat) => { const s = Math.sin((Math.max(-85.05, Math.min(85.05, lat)) * Math.PI) / 180); return 0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI); };

/**
 * What a quality comes to for a map's bounds ({ north, south, east, west }):
 *   { quality, zoom, wantedZoom, limited, metresPerPixel, tiles, stitchPx, textureSize }
 * zoom: the imagery's zoom level actually used (wantedZoom stepped down while
 * the stitched picture of the ring is over stitchLimit a side: limited);
 * tiles: image tiles to download; textureSize: each backdrop tile's texture,
 * a side (never finer than its source; standard: the tile's height grid, mapSize
 * up to 1024).
 */
export function backdropImageryPlan({ quality = DEFAULT_BACKDROP_IMAGERY, bounds, stitchLimit = DESKTOP_STITCH_LIMIT_PX, mapSize = 1024 } = {}) {
  const id = backdropImageryId(quality); const preset = BACKDROP_IMAGERY[id];
  if (!bounds) return { quality: id, zoom: preset.zoom, wantedZoom: preset.zoom, limited: false, metresPerPixel: 0, tiles: 0, stitchPx: 0, textureSize: preset.textureSize };
  const lat = bounds.north - bounds.south; const lng = bounds.east - bounds.west;
  const ring = { north: bounds.north + lat, south: bounds.south - lat, east: bounds.east + lng, west: bounds.west - lng };
  const sizeAt = (z) => {
    const world = TILE * 2 ** z;
    const w = ((ring.east - ring.west) / 360) * world; const h = (mercY(ring.south) - mercY(ring.north)) * world;
    // (whole image tiles: the stitched canvas is cut on their grid)
    return { w: (Math.floor(w / TILE) + 2) * TILE, h: (Math.floor(h / TILE) + 2) * TILE, tilePx: w / 3 };
  };
  let zoom = preset.zoom; let s = sizeAt(zoom);
  while (zoom > 1 && Math.max(s.w, s.h) > stitchLimit) { zoom--; s = sizeAt(zoom); }
  const midLat = (bounds.north + bounds.south) / 2;
  const pow2 = (n) => 2 ** Math.ceil(Math.log2(Math.max(1, n)));
  return {
    quality: id, zoom, wantedZoom: preset.zoom, limited: zoom < preset.zoom,
    metresPerPixel: (156543.03392 * Math.cos((midLat * Math.PI) / 180)) / 2 ** zoom,
    tiles: (s.w / TILE) * (s.h / TILE), stitchPx: Math.max(s.w, s.h),
    // (standard: each tile's picture on its height grid, as it has always been)
    textureSize: id === DEFAULT_BACKDROP_IMAGERY ? Math.min(Math.max(256, Number(mapSize) || 1024), 1024) : Math.max(256, Math.min(preset.textureSize, pow2(s.tilePx))),
  };
}

/**
 * The surrounding tiles' fetch options for a quality (over BACKDROP_FETCH).
 * Standard changes nothing: the downloads the export has always made.
 */
export function backdropImageryFetch({ quality, bounds, stitchLimit } = {}) {
  const id = backdropImageryId(quality);
  if (id === DEFAULT_BACKDROP_IMAGERY) return stitchLimit ? { maxStitchPx: stitchLimit } : {};
  const plan = backdropImageryPlan({ quality: id, bounds, stitchLimit });
  return { satelliteZoom: plan.zoom, satelliteSize: plan.textureSize, ...(stitchLimit ? { maxStitchPx: stitchLimit } : {}) };
}
