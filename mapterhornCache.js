// /api/mapterhorn/{z}/{x}/{y}.webp: a pull-through cache of Mapterhorn's tiles (z12-z18: Copernicus 30 m and lidar) in the R2 bucket
// (OSM_TILES binding, keys mapterhorn/{z}/{x}/{y}.webp). A tile is fetched from tiles.mapterhorn.com once, kept,
// and served from R2 after that, so MapNG's users put one request per tile on Mapterhorn, the tiles anyone has
// used keep working if Mapterhorn is down, and the browser talks to mapng.com only. A full mirror (9.9 TB) is
// not kept: only tiles someone used are stored.
//
// Misses (no lidar there: Mapterhorn answers 404) are remembered in the edge cache only, never in R2 (writes cost).
// The coarse base layer (z0-z11) is not served here: the app never asks for it through MapNG. Fresh upstream fetches are
// capped per address so nobody can fill the bucket by crawling the route.

const UPSTREAM = 'https://tiles.mapterhorn.com';
const MIN_Z = 12;   // z12: Copernicus GLO-30 outside lidar (the ground filter's second 30 m), z13+: lidar
const MAX_Z = 18;
const HIT_TTL_S = 30 * 24 * 3600;      // tiles change only with a Mapterhorn release
const MISS_TTL_S = 7 * 24 * 3600;
const FRESH_PER_MINUTE = 600;          // upstream fetches per address per minute (a 16 km map is ~1,000 tiles)
const PATH_RE = /^\/api\/mapterhorn\/(\d{1,2})\/(\d{1,6})\/(\d{1,6})\.webp$/;
const USER_AGENT = 'MapNG tile cache (https://mapng.com; one request per tile, then served from our storage)';

const recent = new Map();
function overLimit(request) {
  const key = request.headers.get('CF-Connecting-IP') || 'unknown';
  const minute = Math.floor(Date.now() / 60000);
  const seen = recent.get(key);
  const count = seen?.minute === minute ? seen.count + 1 : 1;
  recent.set(key, { minute, count });
  if (recent.size > 5000) for (const [k, v] of recent) if (v.minute !== minute) recent.delete(k);
  return count > FRESH_PER_MINUTE;
}

const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Expose-Headers': 'X-MapNG-Cache' };
const tileResponse = (body, how) => new Response(body, {
  status: 200,
  headers: { ...cors, 'Content-Type': 'image/webp', 'Cache-Control': `public, max-age=${HIT_TTL_S}`, 'X-MapNG-Cache': how },
});
const missResponse = () => new Response(null, {
  status: 404, headers: { ...cors, 'Cache-Control': `public, max-age=${MISS_TTL_S}`, 'X-MapNG-Cache': 'miss' },
});

/** Parse and validate a tile path: { z, x, y, key } or null. */
export function parseMapterhornPath(pathname) {
  const m = PATH_RE.exec(pathname);
  if (!m) return null;
  const [z, x, y] = m.slice(1).map(Number);
  if (z < MIN_Z || z > MAX_Z || x >= 2 ** z || y >= 2 ** z) return null;
  return { z, x, y, key: `mapterhorn/${z}/${x}/${y}.webp` };
}

export async function handleMapterhornTiles(request, env, ctx, url, { fetchImpl = fetch, cache = globalThis.caches?.default } = {}) {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: { ...cors, 'Access-Control-Allow-Methods': 'GET, OPTIONS', 'Access-Control-Max-Age': '86400' } });
  if (request.method !== 'GET') return new Response('Method Not Allowed', { status: 405, headers: cors });
  const tile = parseMapterhornPath(url.pathname);
  if (!tile) return new Response('Not Found', { status: 404, headers: cors });
  const cacheKey = new Request(`${url.origin}${url.pathname}`, { method: 'GET' });
  const hit = cache ? await cache.match(cacheKey) : null;
  if (hit) return hit;
  if (env.OSM_TILES) {
    const object = await env.OSM_TILES.get(tile.key);
    if (object) {
      const res = tileResponse(object.body, 'r2');
      if (cache) ctx.waitUntil(cache.put(cacheKey, res.clone()));
      return res;
    }
  }
  if (overLimit(request)) return new Response('Too Many Requests', { status: 429, headers: { ...cors, 'Retry-After': '60' } });
  let upstream;
  try {
    upstream = await fetchImpl(`${UPSTREAM}/${tile.z}/${tile.x}/${tile.y}.webp`, { headers: { 'User-Agent': USER_AGENT } });
  } catch {
    return new Response('Upstream unavailable', { status: 502, headers: cors });
  }
  if (upstream.status === 404) {
    const res = missResponse();
    if (cache) ctx.waitUntil(cache.put(cacheKey, res.clone()));
    return res;
  }
  if (!upstream.ok) return new Response('Upstream error', { status: 502, headers: cors });
  const body = await upstream.arrayBuffer();
  if (env.OSM_TILES) {
    ctx.waitUntil(env.OSM_TILES.put(tile.key, body, {
      httpMetadata: { contentType: 'image/webp' },
      customMetadata: { fetchedAt: new Date().toISOString(), source: 'tiles.mapterhorn.com' },
    }));
  }
  const res = tileResponse(body, 'upstream');
  if (cache) ctx.waitUntil(cache.put(cacheKey, res.clone()));
  return res;
}
