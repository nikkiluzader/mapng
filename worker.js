/**
 * Cloudflare Worker — GPXZ API Proxy
 *
 * Proxies requests from /api/gpxz/* to https://api.gpxz.io/*
 * so that rate-limit response headers (x-ratelimit-used, x-ratelimit-remaining, etc.)
 * are visible to the browser (same-origin requests have full header access).
 *
 * All other requests fall through to the static assets (dist/).
 */

const GPXZ_ORIGIN = 'https://api.gpxz.io';
const NOMINATIM_OSM_ORIGIN = 'https://nominatim.openstreetmap.org';
const NOMINATIM_GEOCODE_ORIGIN = 'https://nominatim.geocoding.ai';

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
  async fetch(request, env) {
    const url = new URL(request.url);

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
      const upstream = await fetch(upstreamUrl, {
        method: 'GET',
        headers: {
          'Accept': request.headers.get('Accept') || 'application/json',
        },
      });

      const responseHeaders = new Headers(upstream.headers);
      responseHeaders.set('Access-Control-Allow-Origin', '*');
      return new Response(upstream.body, {
        status: upstream.status,
        statusText: upstream.statusText,
        headers: responseHeaders,
      });
    };

    if (url.pathname.startsWith('/api/nominatim-osm/')) {
      return proxySimple(NOMINATIM_OSM_ORIGIN, '/api/nominatim-osm');
    }

    if (url.pathname.startsWith('/api/nominatim-geocode/')) {
      return proxySimple(NOMINATIM_GEOCODE_ORIGIN, '/api/nominatim-geocode');
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
