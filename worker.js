/**
 * Cloudflare Worker — API proxies
 *
 * Proxies requests from /api/gpxz/* to https://api.gpxz.io/*
 * so that rate-limit response headers (x-ratelimit-used, x-ratelimit-remaining, etc.)
 * are visible to the browser (same-origin requests have full header access).
 *
 * /api/osm?bbox=s,w,n,e answers MapNG's own Overpass query from Cloudflare's
 * edge cache, fetching from the public mirrors on a miss (see handleOsm).
 *
 * /api/osm-tiles/manifest and /api/osm-tiles/osm/<name>.pmtiles serve MapNG's
 * own OSM tile archives from the R2 bucket bound as OSM_TILES (see
 * handleOsmTiles; built by scripts/build-osm-tiles.py).
 *
 * All other requests fall through to the static assets (dist/).
 */

import {
  OVERPASS_ENDPOINTS,
  OVERPASS_QUERY_VERSION,
  buildOverpassQuery,
  snapOsmBounds,
} from './services/overpassQuery.js';

const GPXZ_ORIGIN = 'https://api.gpxz.io';
const NOMINATIM_OSM_ORIGIN = 'https://nominatim.openstreetmap.org';
const NOMINATIM_GEOCODE_ORIGIN = 'https://nominatim.geocoding.ai';
const KRON86_ORIGIN = 'https://mapy.geoportal.gov.pl';
const KRON86_OPENDATA_ORIGIN = 'https://opendata.geoportal.gov.pl';

// /api/osm: how long an answer is reused, how long one mirror may take, and
// how many mirrors one miss may try (the browser falls back to the mirrors
// itself when this endpoint fails, so the Worker keeps its own budget short).
const OSM_CACHE_TTL_S = 7 * 24 * 3600;
const OSM_MIRROR_TIMEOUT_MS = 30000;
const OSM_MAX_MIRRORS = 3;
const OSM_USER_AGENT = 'mapng/1.0 (+https://mapng.com; contact: nikkiluzader@gmail.com)';

const jsonResponse = (body, status, extraHeaders = {}) => new Response(JSON.stringify(body), {
  status,
  headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', ...extraHeaders },
});

/**
 * Cached Overpass for MapNG's own query only (not an open proxy): the box is
 * snapped outward to a grid so nearby selections share a cache entry, and the
 * client clips the answer to its exact bounds.
 */
async function handleOsm(request, url, ctx) {
  if (request.method !== 'GET') return new Response('Method Not Allowed', { status: 405 });

  const parts = String(url.searchParams.get('bbox') || '').split(',').map(Number);
  const [south, west, north, east] = parts;
  const snapped = parts.length === 4 ? snapOsmBounds({ south, west, north, east }) : null;
  if (!snapped) return jsonResponse({ error: 'bbox must be s,w,n,e within the size limit' }, 400);

  const cache = caches.default;
  const cacheKey = new Request(
    `https://mapng-osm-cache.internal/v${OVERPASS_QUERY_VERSION}/${snapped.south},${snapped.west},${snapped.north},${snapped.east}`,
  );
  const cached = await cache.match(cacheKey);
  if (cached) {
    const hit = new Response(cached.body, cached);
    hit.headers.set('x-mapng-osm-cache', 'HIT');
    return hit;
  }

  const query = buildOverpassQuery(snapped);
  const mirrors = [...OVERPASS_ENDPOINTS].sort(() => Math.random() - 0.5).slice(0, OSM_MAX_MIRRORS);
  const attempts = [];
  for (const mirror of mirrors) {
    try {
      const upstream = await fetch(mirror, {
        method: 'POST',
        body: `data=${encodeURIComponent(query)}`,
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Accept': 'application/json',
          'User-Agent': OSM_USER_AGENT,
        },
        signal: AbortSignal.timeout(OSM_MIRROR_TIMEOUT_MS),
      });
      if (!upstream.ok) {
        attempts.push(`${new URL(mirror).host}: HTTP ${upstream.status}`);
        continue;
      }
      const text = await upstream.text();
      // Overpass reports timeouts / memory limits as a 200 with HTML or a
      // JSON "remark" and no usable elements; never cache those.
      let data;
      try { data = JSON.parse(text); } catch { data = null; }
      if (!data || !Array.isArray(data.elements) || (data.remark && /error|timeout|runtime/i.test(data.remark))) {
        attempts.push(`${new URL(mirror).host}: unusable response`);
        continue;
      }
      const headers = {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': `public, max-age=${OSM_CACHE_TTL_S}`,
        'x-mapng-osm-mirror': new URL(mirror).host,
      };
      ctx.waitUntil(cache.put(cacheKey, new Response(text, { headers })));
      return new Response(text, { headers: { ...headers, 'x-mapng-osm-cache': 'MISS' } });
    } catch (e) {
      attempts.push(`${new URL(mirror).host}: ${e?.name === 'TimeoutError' ? 'timeout' : String(e?.message || e)}`);
    }
  }
  return jsonResponse({ error: 'All Overpass mirrors failed', attempts }, 502);
}

// /api/osm-tiles: archives are immutable (a rebuild uploads a new name and
// updates the manifest), so their byte ranges are cached for a long time;
// the manifest only briefly so a new build goes live within minutes.
const OSM_TILES_PREFIX = '/api/osm-tiles/';
const OSM_TILES_MANIFEST_KEY = 'osm/manifest.json';
const OSM_TILES_KEY_RE = /^osm\/[A-Za-z0-9._-]+\.pmtiles$/;
const OSM_TILES_RANGE_TTL_S = 30 * 24 * 3600;
const OSM_TILES_MANIFEST_TTL_S = 300;

async function handleOsmTiles(request, url, env, ctx) {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return new Response('Method Not Allowed', { status: 405 });
  }
  if (!env.OSM_TILES) return jsonResponse({ error: 'OSM tiles bucket not bound' }, 503);

  const path = url.pathname.slice(OSM_TILES_PREFIX.length);
  if (path === 'manifest') {
    const object = await env.OSM_TILES.get(OSM_TILES_MANIFEST_KEY);
    if (!object) return jsonResponse({ archives: [] }, 200, { 'Cache-Control': `public, max-age=${OSM_TILES_MANIFEST_TTL_S}` });
    return new Response(object.body, {
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': `public, max-age=${OSM_TILES_MANIFEST_TTL_S}`,
        'Access-Control-Allow-Origin': '*',
      },
    });
  }
  if (!OSM_TILES_KEY_RE.test(path)) return new Response('Not Found', { status: 404 });

  // PMTiles readers only ever ask for byte ranges; whole-archive downloads are refused.
  const range = /^bytes=(\d+)-(\d+)$/.exec(request.headers.get('Range') || '');
  if (!range) return new Response('Range required', { status: 416 });
  const offset = Number(range[1]);
  const length = Number(range[2]) - offset + 1;
  if (!(length > 0) || length > 16 * 1024 * 1024) return new Response('Range too large', { status: 416 });

  const cache = caches.default;
  const cacheKey = new Request(`https://mapng-osm-tiles.internal/${path}?r=${offset}-${length}`);
  let cached = await cache.match(cacheKey);
  if (!cached) {
    const object = await env.OSM_TILES.get(path, { range: { offset, length } });
    if (!object) return new Response('Not Found', { status: 404 });
    const total = object.size;
    cached = new Response(object.body, {
      headers: {
        'Content-Type': 'application/octet-stream',
        'Cache-Control': `public, max-age=${OSM_TILES_RANGE_TTL_S}, immutable`,
        'ETag': object.httpEtag,
        'x-mapng-total-size': String(total),
      },
    });
    ctx.waitUntil(cache.put(cacheKey, cached.clone()));
  }
  const total = cached.headers.get('x-mapng-total-size');
  const headers = new Headers(cached.headers);
  headers.delete('x-mapng-total-size');
  headers.set('Content-Range', `bytes ${offset}-${offset + length - 1}/${total}`);
  headers.set('Access-Control-Allow-Origin', '*');
  return new Response(request.method === 'HEAD' ? null : cached.body, { status: 206, headers });
}

const EXPOSED_HEADERS = [
  'x-ratelimit-used',
  'x-ratelimit-limit',
  'x-ratelimit-remaining',
  'x-ratelimit-reset',
  'x-dataset-version',
  'retry-after',
  'content-type',
].join(', ');

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname === '/api/osm') {
      return handleOsm(request, url, ctx);
    }

    if (url.pathname.startsWith(OSM_TILES_PREFIX)) {
      return handleOsmTiles(request, url, env, ctx);
    }

    const proxySimple = async (origin, stripPrefix) => {
      if (request.method === 'OPTIONS') {
        return new Response(null, {
          status: 204,
          headers: {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET, OPTIONS',
            'Access-Control-Allow-Headers': 'content-type, accept',
            'Access-Control-Max-Age': '86400',
          },
        });
      }

      if (request.method !== 'GET') {
        return new Response('Method Not Allowed', { status: 405 });
      }

      const upstreamPath = url.pathname.slice(stripPrefix.length);
      const upstreamUrl = `${origin}${upstreamPath}${url.search}`;
      const isNominatimOrigin = origin.includes('nominatim');
      const requestOrigin = `${url.protocol}//${url.host}`;

      try {
        const upstream = await fetch(upstreamUrl, {
          method: 'GET',
          headers: {
            'Accept': request.headers.get('Accept') || 'application/json',
            ...(request.headers.get('Accept-Language')
              ? { 'Accept-Language': request.headers.get('Accept-Language') }
              : {}),
            ...(isNominatimOrigin
              ? {
                  'User-Agent': 'mapng/1.0 (+https://mapng.dev; contact: nikkiluzader@gmail.com)',
                  'Referer': requestOrigin,
                }
              : {}),
          },
        });

        const responseHeaders = new Headers(upstream.headers);
        responseHeaders.set('Access-Control-Allow-Origin', '*');
        return new Response(upstream.body, {
          status: upstream.status,
          statusText: upstream.statusText,
          headers: responseHeaders,
        });
      } catch (e) {
        const message = e && typeof e === 'object' && 'message' in e
          ? String(e.message)
          : String(e);
        return new Response(JSON.stringify({ error: 'Proxy error', message }), {
          status: 502,
          headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
        });
      }
    };

    if (url.pathname.startsWith('/api/nominatim-osm/')) {
      return proxySimple(NOMINATIM_OSM_ORIGIN, '/api/nominatim-osm');
    }

    if (url.pathname.startsWith('/api/nominatim-geocode/')) {
      return proxySimple(NOMINATIM_GEOCODE_ORIGIN, '/api/nominatim-geocode');
    }

    if (url.pathname.startsWith('/api/kron86/')) {
      return proxySimple(KRON86_ORIGIN, '/api/kron86');
    }

    if (url.pathname.startsWith('/api/kron86-opendata/')) {
      return proxySimple(KRON86_OPENDATA_ORIGIN, '/api/kron86-opendata');
    }

    // Only proxy /api/gpxz/* paths
    if (!url.pathname.startsWith('/api/gpxz/')) {
      return env.ASSETS.fetch(request);
    }

    // Handle CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
          'Access-Control-Allow-Headers': 'x-api-key, content-type',
          'Access-Control-Max-Age': '86400',
        },
      });
    }

    // Build upstream GPXZ URL: /api/gpxz/v1/foo?bar → https://api.gpxz.io/v1/foo?bar
    const gpxzPath = url.pathname.slice('/api/gpxz'.length); // keeps leading /
    const gpxzUrl = `${GPXZ_ORIGIN}${gpxzPath}${url.search}`;

    // Forward request headers (especially x-api-key)
    const forwardHeaders = new Headers();
    const apiKey = request.headers.get('x-api-key');
    if (apiKey) forwardHeaders.set('x-api-key', apiKey);
    forwardHeaders.set('Accept', request.headers.get('Accept') || '*/*');

    try {
      const upstream = await fetch(gpxzUrl, {
        method: request.method,
        headers: forwardHeaders,
      });

      // Clone response with all upstream headers
      const responseHeaders = new Headers(upstream.headers);

      // Ensure rate-limit headers are exposed for CORS (in case of cross-origin)
      responseHeaders.set('Access-Control-Expose-Headers', EXPOSED_HEADERS);
      responseHeaders.set('Access-Control-Allow-Origin', '*');

      return new Response(upstream.body, {
        status: upstream.status,
        statusText: upstream.statusText,
        headers: responseHeaders,
      });
    } catch (e) {
      return new Response(JSON.stringify({ error: 'GPXZ proxy error', message: e.message }), {
        status: 502,
        headers: { 'Content-Type': 'application/json' },
      });
    }
  },
};
