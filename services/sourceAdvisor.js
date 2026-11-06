// What the free elevation sources hold over a selection box, for the hint under the elevation source dropdown:
// Mapterhorn lidar (the share of the box's z13 tiles that exist: z13+ tiles exist only over national lidar, and how
// deep it goes at the centre, which is its resolution). Answers are cached per tile, so panning around asks again
// only for new tiles; requests go through MapNG's tile cache (mapterhorn.js).
import { MAPTERHORN_CACHE_URL, MAPTERHORN_TILE_URL } from './mapterhorn.js';

const TILE = 512;
const MERC_HALF = 20037508.342789244;
const known = new Map();   // "z/x/y" -> Promise<boolean>

const tileXY = (lat, lng, z) => {
  const s = Math.sin((lat * Math.PI) / 180);
  return { x: Math.floor(((lng + 180) / 360) * 2 ** z), y: Math.floor((0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * 2 ** z) };
};

async function exists(z, x, y, fetchImpl, signal) {
  const key = `${z}/${x}/${y}`;
  if (!known.has(key)) {
    known.set(key, (async () => {
      for (const base of [MAPTERHORN_CACHE_URL, MAPTERHORN_TILE_URL]) {
        try {
          const r = await fetchImpl(`${base}/${key}.webp`, { signal });
          if (r.status === 404) return false;
          if (r.ok && /image\//.test(r.headers.get('content-type') || 'image/')) return true;
        } catch (e) { if (signal?.aborted) throw e; }
      }
      return null;   // unknown (both unreachable)
    })().catch((e) => { known.delete(key); throw e; }));
  }
  return known.get(key);
}

/** A square box of sideKm around center: { north, south, west, east }. */
export function boxAround(center, sideKm) {
  const dLat = (sideKm / 2) / 111.32;
  const dLng = dLat / Math.max(0.05, Math.cos((center.lat * Math.PI) / 180));
  return { north: center.lat + dLat, south: center.lat - dLat, west: center.lng - dLng, east: center.lng + dLng };
}

/**
 * Mapterhorn lidar over a box: { coverage: 0..1 of the box's z13 tiles, zoom: deepest at the centre (0 = none),
 * metersPerPixel: that zoom's ground resolution, reachable }.
 */
export async function probeMapterhorn(bounds, { fetchImpl = fetch, signal } = {}) {
  const a = tileXY(bounds.north, bounds.west, 13), b = tileXY(bounds.south, bounds.east, 13);
  const jobs = [];
  for (let y = a.y; y <= b.y; y++) for (let x = a.x; x <= b.x; x++) jobs.push(exists(13, x, y, fetchImpl, signal));
  const found = await Promise.all(jobs);
  if (found.every((f) => f === null)) return { coverage: 0, zoom: 0, metersPerPixel: null, reachable: false };
  const coverage = found.filter(Boolean).length / found.length;
  const lat = (bounds.north + bounds.south) / 2, lng = (bounds.west + bounds.east) / 2;
  let zoom = 0;
  if (coverage > 0) {
    for (let z = 13; z <= 17; z++) { const t = tileXY(lat, lng, z); if (!(await exists(z, t.x, t.y, fetchImpl, signal))) break; zoom = z; }
  }
  const metersPerPixel = zoom ? ((2 * MERC_HALF) / 2 ** zoom / TILE) * Math.cos((lat * Math.PI) / 180) : null;
  return { coverage, zoom, metersPerPixel, reachable: true };
}

/** GPXZ's dataset at a few points of the box (one request, one call of the user's plan): [{ source, resolution }]. */
export async function probeGpxz(bounds, apiKey, { fetchImpl = fetch, signal } = {}) {
  const pts = [];
  for (const fy of [0.2, 0.5, 0.8]) for (const fx of [0.2, 0.5, 0.8]) {
    pts.push(`${(bounds.north - fy * (bounds.north - bounds.south)).toFixed(5)},${(bounds.west + fx * (bounds.east - bounds.west)).toFixed(5)}`);
  }
  const r = await fetchImpl(`/api/gpxz/v1/elevation/points?latlons=${encodeURIComponent(pts.join('|'))}`, { headers: { 'x-api-key': apiKey }, signal });
  if (!r.ok) throw new Error(`GPXZ ${r.status}`);
  const d = await r.json();
  return (d.results || []).map((p) => ({ source: p.data_source, resolution: Number(p.resolution) }));
}

/** Test hook. */
export const _resetSourceAdvisorCache = () => known.clear();
