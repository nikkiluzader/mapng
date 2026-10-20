/**
 * MapNG's own OSM tiles (scripts/build-osm-tiles.py; option B in
 * refs/output/osm-data-sources.md): a PMTiles archive whose tiles hold the
 * same "out body geom" JSON the live Overpass query returns.
 *
 * fetchOsmFromTiles() reads the tiles covering a bbox and merges them into one
 * Overpass-shaped response for parseOverpassResponse:
 *   - nodes and ways are stored whole in every tile they touch: de-duplicated
 *     by type + id;
 *   - a large non-area relation is split by member across tiles under its real
 *     id: copies are merged by unioning their members;
 *   - large area relations arrive as per-tile pieces with their own (negative)
 *     ids and are kept as they are.
 * Returns null when the archive does not cover the whole bbox, so the caller
 * falls back to Overpass.
 */
import { PMTiles } from 'pmtiles';

const archives = new Map();   // url -> PMTiles

/** The PMTiles archive for a URL (or any pmtiles Source), cached per page. */
export const getOsmTileArchive = (source) => {
  if (source && typeof source === 'object') return new PMTiles(source);
  if (!archives.has(source)) archives.set(source, new PMTiles(source));
  return archives.get(source);
};

const tileXY = (lat, lon, z) => {
  const clamped = Math.max(-85.0511, Math.min(85.0511, lat));
  const n = 2 ** z;
  const x = Math.floor(((lon + 180) / 360) * n);
  const latRad = (clamped * Math.PI) / 180;
  const y = Math.floor(((1 - Math.asinh(Math.tan(latRad)) / Math.PI) / 2) * n);
  return [Math.min(n - 1, Math.max(0, x)), Math.min(n - 1, Math.max(0, y))];
};

/** XYZ tiles at zoom z covering bounds {south, west, north, east}. */
export const tilesCovering = (bounds, z) => {
  const [x0, y0] = tileXY(bounds.north, bounds.west, z);
  const [x1, y1] = tileXY(bounds.south, bounds.east, z);
  const tiles = [];
  for (let x = x0; x <= x1; x++) {
    for (let y = y0; y <= y1; y++) tiles.push({ x, y });
  }
  return tiles;
};

/** Merge per-tile Overpass payloads (see module comment). */
export const mergeTileElements = (payloads) => {
  const byKey = new Map();
  for (const payload of payloads) {
    for (const el of payload?.elements || []) {
      const key = `${el.type}/${el.id}`;
      const seen = byKey.get(key);
      if (!seen) {
        byKey.set(key, el.type === 'relation' ? { ...el, members: [...(el.members || [])] } : el);
      } else if (el.type === 'relation') {
        const have = new Set(seen.members.map((m) => `${m.type}/${m.ref}/${m.role}`));
        for (const m of el.members || []) {
          const mk = `${m.type}/${m.ref}/${m.role}`;
          if (!have.has(mk)) { have.add(mk); seen.members.push(m); }
        }
      }
    }
  }
  return { elements: [...byKey.values()] };
};

const decodeTile = async (bytes) => {
  const text = new TextDecoder().decode(bytes);
  return JSON.parse(text);
};

/**
 * Overpass-shaped {elements} for bounds from the archive at `source`, or null
 * when the archive does not cover them.
 */
export const fetchOsmFromTiles = async (source, bounds, { signal } = {}) => {
  const archive = getOsmTileArchive(source);
  const header = await archive.getHeader();
  const covers = bounds.west >= header.minLon && bounds.east <= header.maxLon
    && bounds.south >= header.minLat && bounds.north <= header.maxLat;
  if (!covers) return null;

  const z = header.maxZoom;
  const tiles = tilesCovering(bounds, z);
  const payloads = await Promise.all(tiles.map(async ({ x, y }) => {
    signal?.throwIfAborted?.();
    const tile = await archive.getZxy(z, x, y, signal);
    return tile?.data ? decodeTile(tile.data) : null;
  }));
  return mergeTileElements(payloads.filter(Boolean));
};
