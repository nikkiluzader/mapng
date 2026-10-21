/**
 * MapNG's own OSM tiles (scripts/build-osm-tiles.py; option B in
 * refs/output/osm-data-sources.md): a PMTiles archive whose tiles hold the
 * same "out body geom" JSON the live Overpass query returns (in a compact
 * form expanded here).
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

// The Worker lists the published archives (worker.js handleOsmTiles, written
// by scripts/publish-osm-tiles.py): [{ region, key, bounds: [w, s, e, n], built_at }].
const MANIFEST_URL = '/api/osm-tiles/manifest';
const MANIFEST_RETRY_MS = 5 * 60 * 1000;
let manifestPromise = null;
let manifestFailedAt = 0;

const loadManifest = () => {
  if (manifestPromise) return manifestPromise;
  if (Date.now() - manifestFailedAt < MANIFEST_RETRY_MS) return Promise.resolve(null);
  manifestPromise = fetch(MANIFEST_URL)
    .then((r) => (r.ok ? r.json() : null))
    .then((m) => (Array.isArray(m?.archives) ? m : null))
    .catch(() => null)
    .then((m) => {
      if (!m) { manifestFailedAt = Date.now(); manifestPromise = null; }
      return m;
    });
  return manifestPromise;
};

const insideRing = (lon, lat, ring) => {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if ((yi > lat) !== (yj > lat) && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
};

/**
 * Whether an archive covers bounds: inside its bbox and, when the manifest
 * gives one, with all four corners inside its coverage outline (an extract's
 * bbox also spans neighbouring areas it holds no data for).
 */
export const archiveCovers = (archive, bounds) => {
  const b = archive?.bounds;
  if (!Array.isArray(b)) return false;
  if (bounds.west < b[0] || bounds.south < b[1] || bounds.east > b[2] || bounds.north > b[3]) return false;
  const rings = archive.coverage;
  if (!Array.isArray(rings) || rings.length === 0) return true;
  const corners = [[bounds.west, bounds.south], [bounds.west, bounds.north], [bounds.east, bounds.south], [bounds.east, bounds.north]];
  return corners.every(([lon, lat]) => rings.some((ring) => insideRing(lon, lat, ring)));
};

/**
 * URL of the newest published archive that covers bounds, or null (no
 * manifest, e.g. local vite dev, or the area is not built yet).
 */
export const resolveOsmTileArchiveUrl = async (bounds) => {
  const manifest = await loadManifest();
  const covering = (manifest?.archives || []).filter((archive) => archiveCovers(archive, bounds));
  if (covering.length === 0) return null;
  covering.sort((a, b) => String(b.built_at).localeCompare(String(a.built_at)));
  return `/api/osm-tiles/${covering[0].key}`;
};

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

// Compact tiles ({v: 2, e: [...]}, scripts/build-osm-tiles.py) store
// coordinates as 1e-7 integers, delta-encoded per way; expand them back to
// Overpass's own element objects, key order included. Archives built before
// the compact form hold {elements} and pass through.
const E7 = 1e7;

const expandCoords = (flat) => {
  const geometry = new Array(flat.length / 2);
  let lat = 0;
  let lon = 0;
  for (let i = 0; i < flat.length; i += 2) {
    lat += flat[i];
    lon += flat[i + 1];
    geometry[i / 2] = { lat: lat / E7, lon: lon / E7 };
  }
  return geometry;
};

const expandMember = (m) => (m[0] === 'n'
  ? { type: 'node', ref: m[1], role: m[2], lat: m[3] / E7, lon: m[4] / E7 }
  : { type: 'way', ref: m[1], role: m[2], geometry: expandCoords(m[3]) });

export const expandCompactElement = (el) => {
  if (el[0] === 'n') return { type: 'node', id: el[1], lat: el[2] / E7, lon: el[3] / E7, tags: el[4] };
  if (el[0] === 'w') return { type: 'way', id: el[1], tags: el[2], geometry: expandCoords(el[3]) };
  return { type: 'relation', id: el[1], tags: el[2], members: el[3].map(expandMember) };
};

export const expandCompactTile = (tile) => (tile?.v === 2
  ? { elements: tile.e.map(expandCompactElement) }
  : tile);

const decodeTile = async (bytes) => {
  const text = new TextDecoder().decode(bytes);
  return expandCompactTile(JSON.parse(text));
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
