// /api/terrarium/{z}/{x}/{y}.png: the global 30 m elevation tiles (AWS Terrain Tiles, the public
// elevation-tiles-prod bucket) relayed through MapNG's own address, for networks that cannot reach Amazon's
// storage. A report from the website (2026-11-14): a 1 km Generate failed with "elevation terrain tiles (6/6
// failed)" while all 144 satellite tiles of the same map arrived. The app asks here only after a direct
// download fails (services/terrain.js). Only tile addresses are served: not an open proxy.
const UPSTREAM = 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium';
const cors = { 'Access-Control-Allow-Origin': '*' };
const MAX_ZOOM = 15;

/** { z, x, y } of a tile path, or null. */
export function parseTerrariumPath(pathname) {
  const m = /^\/api\/terrarium\/(\d{1,2})\/(\d{1,6})\/(\d{1,6})\.png$/.exec(pathname);
  if (!m) return null;
  const z = Number(m[1]); const x = Number(m[2]); const y = Number(m[3]);
  if (z > MAX_ZOOM || x >= 2 ** z || y >= 2 ** z) return null;
  return { z, x, y };
}

export async function handleTerrariumTiles(request, url, { fetchImpl = fetch } = {}) {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: { ...cors, 'Access-Control-Allow-Methods': 'GET, OPTIONS' } });
  if (request.method !== 'GET') return new Response('Method Not Allowed', { status: 405, headers: cors });
  const tile = parseTerrariumPath(url.pathname);
  if (!tile) return new Response('Not Found', { status: 404, headers: cors });
  let upstream;
  try {
    // (kept at Cloudflare's edge for a month: the tiles do not change)
    upstream = await fetchImpl(`${UPSTREAM}/${tile.z}/${tile.x}/${tile.y}.png`, { cf: { cacheEverything: true, cacheTtl: 2592000 } });
  } catch {
    return new Response('Upstream unavailable', { status: 502, headers: cors });
  }
  if (upstream.status === 404 || upstream.status === 403) return new Response('Not Found', { status: 404, headers: cors });
  if (!upstream.ok) return new Response('Upstream error', { status: 502, headers: cors });
  return new Response(upstream.body, { status: 200, headers: { ...cors, 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=2592000, immutable' } });
}
