const DB_NAME = 'mapng-batch-cache';
const DB_VERSION = 1;
const STORE_NAME = 'responses';
const CACHE_VERSION = 'v1';
const MAX_ENTRIES = 200;
const MAX_CACHEABLE_BYTES = 2 * 1024 * 1024;

let _dbPromise = null;

const openDb = () => {
  if (_dbPromise) return _dbPromise;

  _dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: 'key' });
        store.createIndex('createdAt', 'createdAt');
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });

  return _dbPromise;
};

const promisifyRequest = (request) => new Promise((resolve, reject) => {
  request.onsuccess = () => resolve(request.result);
  request.onerror = () => reject(request.error);
});

export const makeCacheKey = ({ method, url, body = '' }) => {
  const payload = `${CACHE_VERSION}|${method}|${url}|${body}`;
  let hash = 0x811c9dc5;
  for (let i = 0; i < payload.length; i++) {
    hash ^= payload.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return `k_${(hash >>> 0).toString(16)}`;
};

export const getCachedResponse = async (key) => {
  const db = await openDb();
  const tx = db.transaction(STORE_NAME, 'readonly');
  const store = tx.objectStore(STORE_NAME);
  const rec = await promisifyRequest(store.get(key));
  return rec || null;
};

export const putCachedResponse = async (record) => {
  const db = await openDb();
  const tx = db.transaction(STORE_NAME, 'readwrite');
  const store = tx.objectStore(STORE_NAME);
  await promisifyRequest(store.put({
    ...record,
    cacheVersion: CACHE_VERSION,
    createdAt: Date.now(),
  }));

  await trimCache(db);
};

const trimCache = async (db) => {
  const countTx = db.transaction(STORE_NAME, 'readonly');
  const countStore = countTx.objectStore(STORE_NAME);
  const count = await promisifyRequest(countStore.count());
  if (count <= MAX_ENTRIES) return;

  const targetDeletes = count - MAX_ENTRIES;
  await new Promise((resolve, reject) => {
    const delTx = db.transaction(STORE_NAME, 'readwrite');
    const delStore = delTx.objectStore(STORE_NAME);
    const index = delStore.index('createdAt');
    let deleted = 0;

    const cursorReq = index.openKeyCursor();
    cursorReq.onsuccess = () => {
      const cursor = cursorReq.result;
      if (!cursor || deleted >= targetDeletes) {
        resolve();
        return;
      }

      const deleteReq = delStore.delete(cursor.primaryKey);
      deleteReq.onsuccess = () => {
        deleted++;
        cursor.continue();
      };
      deleteReq.onerror = () => reject(deleteReq.error);
    };
    cursorReq.onerror = () => reject(cursorReq.error);
    delTx.onerror = () => reject(delTx.error);
  });
};

export const clearBatchCache = async () => {
  const db = await openDb();
  const tx = db.transaction(STORE_NAME, 'readwrite');
  await promisifyRequest(tx.objectStore(STORE_NAME).clear());
};

const isCacheableUrl = (url) => {
  return (
    url.includes('elevation-tiles-prod') ||
    url.includes('ArcGIS/rest/services/World_Imagery') ||
    url.includes('/api/gpxz/') ||
    url.includes('tnmaccess.nationalmap.gov') ||
    url.includes('overpass')
  );
};

const shouldSkipCacheByUrl = (url) => {
  return (
    url.includes('/api/gpxz/v1/elevation/hires-raster') ||
    url.includes('/api/gpxz/v1/elevation/points')
  );
};

export const installBatchFetchCache = () => {
  const originalFetch = globalThis.fetch;
  if (typeof originalFetch !== 'function') return () => {};

  globalThis.fetch = async (input, init = {}) => {
    const method = (init.method || 'GET').toUpperCase();
    const url = typeof input === 'string' ? input : input.url;

    if (!url || !isCacheableUrl(url) || shouldSkipCacheByUrl(url) || !(method === 'GET' || method === 'POST')) {
      return originalFetch(input, init);
    }

    let body = '';
    if (typeof init.body === 'string') body = init.body;

    const key = makeCacheKey({ method, url, body });

    try {
      const cached = await getCachedResponse(key);
      if (cached?.bytes) {
        return new Response(cached.bytes, {
          status: cached.status,
          statusText: cached.statusText,
          headers: cached.headers,
        });
      }
    } catch {
      // cache read failures should not block network
    }

    const response = await originalFetch(input, init);
    const clone = response.clone();

    try {
      const contentLength = parseInt(clone.headers.get('content-length') || '0', 10);
      const contentType = (clone.headers.get('content-type') || '').toLowerCase();
      if (
        (Number.isFinite(contentLength) && contentLength > MAX_CACHEABLE_BYTES) ||
        contentType.includes('image/tiff') ||
        contentType.includes('application/octet-stream')
      ) {
        return response;
      }

      const bytes = await clone.arrayBuffer();
      if (bytes.byteLength > MAX_CACHEABLE_BYTES) {
        return response;
      }

      const headers = {};
      clone.headers.forEach((value, key) => {
        headers[key] = value;
      });

      await putCachedResponse({
        key,
        method,
        url,
        status: clone.status,
        statusText: clone.statusText,
        headers,
        bytes,
      });
    } catch {
      // cache write failures are non-fatal
    }

    return response;
  };

  return () => {
    globalThis.fetch = originalFetch;
  };
};
