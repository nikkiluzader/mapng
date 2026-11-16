// The asset review page's data and photos: /api/asset-page/data.json and /api/asset-page/t/<id>.jpg, read from
// private storage (the bucket's asset-page/ prefix) and served only where ASSET_PAGE is "1": the dev site, which
// sits behind Cloudflare Access. The photos are of the game's own models and are not published: the public site
// has no ASSET_PAGE and answers 404 here and for /asset-review.html.
const KEY = /^\/api\/asset-page\/(data\.json|t\/[A-Za-z0-9_.-]{1,120}\.jpg)$/;

export const assetPageOn = (env) => String(env?.ASSET_PAGE || '') === '1';

/** The storage key of a request path, or null. */
export function assetPageKey(pathname) {
  const m = KEY.exec(pathname);
  return m && !m[1].includes('..') ? `asset-page/${m[1]}` : null;
}

export async function handleAssetPage(request, url, env) {
  if (!assetPageOn(env) || !env.OSM_TILES) return new Response('Not Found', { status: 404 });
  if (request.method !== 'GET' && request.method !== 'HEAD') return new Response('Method Not Allowed', { status: 405 });
  const key = assetPageKey(url.pathname);
  if (!key) return new Response('Not Found', { status: 404 });
  const obj = await env.OSM_TILES.get(key);
  if (!obj) return new Response('Not Found', { status: 404 });
  return new Response(request.method === 'HEAD' ? null : obj.body, {
    headers: {
      'Content-Type': key.endsWith('.json') ? 'application/json; charset=utf-8' : 'image/jpeg',
      // (private: behind the dev site's sign-in; a browser may keep a photo for a day, the data a minute)
      'Cache-Control': key.endsWith('.json') ? 'private, max-age=60' : 'private, max-age=86400',
      'X-Robots-Tag': 'noindex',
      ETag: obj.httpEtag,
    },
  });
}
