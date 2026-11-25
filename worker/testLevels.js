// The official test levels (the coverage level and the themed roads, structures and terrain levels): built by
// scripts/coverage, uploaded to the bucket's test-levels/ prefix with a manifest, offered for download by the app
// (web: a download button; desktop: straight into the mods folder). Read-only: /api/test-levels is the manifest,
// /api/test-levels/<file>.zip one level.
const PREFIX = 'test-levels/';
const FILE = /^\/api\/test-levels\/(mapng_[a-z0-9_]{1,80}\.zip)$/;

/** The storage key of a request path: the manifest, a level's zip, or null. */
export function testLevelKey(pathname) {
  if (pathname === '/api/test-levels' || pathname === '/api/test-levels/') return `${PREFIX}manifest.json`;
  const m = FILE.exec(pathname);
  return m ? `${PREFIX}${m[1]}` : null;
}

export async function handleTestLevels(request, url, env) {
  if (!env.OSM_TILES) return new Response('Not Found', { status: 404 });
  if (request.method !== 'GET' && request.method !== 'HEAD') return new Response('Method Not Allowed', { status: 405 });
  const key = testLevelKey(url.pathname);
  if (!key) return new Response('Not Found', { status: 404 });
  const obj = await env.OSM_TILES.get(key);
  if (!obj) return new Response('Not Found', { status: 404 });
  const manifest = key.endsWith('.json');
  const name = key.slice(PREFIX.length);
  return new Response(request.method === 'HEAD' ? null : obj.body, {
    headers: {
      'Content-Type': manifest ? 'application/json; charset=utf-8' : 'application/zip',
      ...(manifest ? {} : { 'Content-Disposition': `attachment; filename="${name}"`, 'Content-Length': String(obj.size) }),
      // (no caching: a set is replaced in place, and a cached old zip would fail the new manifest's SHA-256)
      'Cache-Control': 'no-cache',
      ETag: obj.httpEtag,
    },
  });
}
