// The street map's tiles, kept by the browser between visits.
//
// MapNG's own street map (services/ownBaseMap.js) is one big archive read a few kilobytes at a time. The server
// marks those answers as cacheable for a month, but a browser's ordinary cache is unreliable for partial answers:
// some browsers do not keep them at all. Here each piece read is kept in the page's own storage (the Cache API,
// the same in a browser and in the desktop app), under the archive's address and the piece's byte range. Panning
// back over a place, or opening MapNG again tomorrow, then reads from the computer and asks the server nothing.
//
// The archive's name carries its date, so a new map is a new address: pieces of older archives are dropped.
// Storage is capped (MAX_PIECES); the oldest pieces go first. Where the Cache API is not there (a private
// window, a blocked site), every read goes to the server as before.
import { FetchSource } from 'pmtiles';

export const TILE_CACHE_PREFIX = 'mapng-street-map:';
const MAX_PIECES = 4000;          // about 150 MB of map at the usual piece size
const TRIM_TO = 3200;
const TRIM_EVERY = 100;           // puts between two looks at the count

const cacheNameFor = (url) => `${TILE_CACHE_PREFIX}${url}`;
// (always an https address: the desktop app's window has a scheme of its own, which the Cache API refuses as a key)
const pieceKey = (url, offset, length) => `https://tiles.mapng.invalid${new URL(url, 'https://tiles.mapng.invalid').pathname}?bytes=${offset}-${offset + length - 1}`;

/**
 * A pmtiles Source for `url` that keeps what it reads. opts.caches: the CacheStorage to use (the page's own by
 * default; tests pass one), opts.inner: the source to read through (a FetchSource of the url by default).
 * Returns { getBytes, getKey, stats }: stats counts { hits, misses, stored } for this page.
 */
export function cachedTileSource(url, opts = {}) {
  const store = opts.caches !== undefined ? opts.caches : (typeof caches !== 'undefined' ? caches : null);
  const inner = opts.inner || new FetchSource(url);
  const stats = { hits: 0, misses: 0, stored: 0 };
  let cachePromise = null;
  let puts = 0;
  const open = () => {
    if (!store) return Promise.resolve(null);
    cachePromise ||= (async () => {
      try {
        const name = cacheNameFor(url);
        // (older archives' pieces are of no use to anyone)
        for (const k of await store.keys()) if (k.startsWith(TILE_CACHE_PREFIX) && k !== name) await store.delete(k);
        return await store.open(name);
      } catch { return null; }
    })();
    return cachePromise;
  };
  const trim = async (cache) => {
    try {
      const keys = await cache.keys();
      if (keys.length <= MAX_PIECES) return;
      for (const k of keys.slice(0, keys.length - TRIM_TO)) await cache.delete(k);
    } catch { /* left as it is */ }
  };
  return {
    stats,
    getKey: () => url,
    async getBytes(offset, length, signal, etag) {
      const cache = await open();
      const key = pieceKey(url, offset, length);
      if (cache) {
        try {
          const hit = await cache.match(key);
          if (hit) { const data = await hit.arrayBuffer(); if (data.byteLength === length || data.byteLength > 0) { stats.hits++; return { data, etag: hit.headers.get('x-etag') || undefined }; } }
        } catch { /* read from the server */ }
      }
      stats.misses++;
      const res = await inner.getBytes(offset, length, signal, etag);
      if (cache && res?.data?.byteLength) {
        // (not awaited: the map is drawn from what came back, the keeping happens beside it)
        cache.put(key, new Response(res.data.slice(0), { headers: { 'content-type': 'application/octet-stream', ...(res.etag ? { 'x-etag': res.etag } : {}) } }))
          .then(() => { stats.stored++; if (++puts % TRIM_EVERY === 0) return trim(cache); return null; })
          .catch(() => {});
      }
      return res;
    },
  };
}
