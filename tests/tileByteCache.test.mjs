import test from 'node:test';
import assert from 'node:assert/strict';
import { cachedTileSource, TILE_CACHE_PREFIX } from '../services/tileByteCache.js';

// a CacheStorage stand-in: named maps of key -> Response
function fakeCaches() {
  const all = new Map();
  return {
    all,
    keys: async () => [...all.keys()],
    delete: async (name) => all.delete(name),
    open: async (name) => {
      if (!all.has(name)) all.set(name, new Map());
      const m = all.get(name);
      return { match: async (k) => (m.has(k) ? m.get(k).clone() : undefined), put: async (k, r) => { m.set(k, r); }, keys: async () => [...m.keys()], delete: async (k) => m.delete(k) };
    },
  };
}
const inner = () => { const calls = []; return { calls, getKey: () => 'x', getBytes: async (o, l) => { calls.push([o, l]); return { data: new Uint8Array(l).fill(o % 251).buffer, etag: 'E1' }; } }; };
const settle = () => new Promise((r) => setTimeout(r, 5));

test('a piece read once is read from the computer the second time, with the same bytes', async () => {
  const store = fakeCaches(); const src = inner();
  const s = cachedTileSource('/api/osm-tiles/basemap/20261115.pmtiles', { caches: store, inner: src });
  const a = await s.getBytes(1000, 64); await settle();
  const b = await s.getBytes(1000, 64);
  assert.equal(src.calls.length, 1, 'the server was asked once');
  assert.deepEqual(new Uint8Array(b.data), new Uint8Array(a.data));
  assert.equal(b.etag, 'E1');
  assert.deepEqual(s.stats, { hits: 1, misses: 1, stored: 1 });
  await s.getBytes(2000, 64);
  assert.equal(src.calls.length, 2, 'another range is another piece');
});

test('a new page reads what an earlier one kept; an older archive\'s pieces are dropped', async () => {
  const store = fakeCaches();
  const first = cachedTileSource('/api/osm-tiles/basemap/20261115.pmtiles', { caches: store, inner: inner() });
  await first.getBytes(0, 16); await settle();
  const src2 = inner();
  const again = cachedTileSource('/api/osm-tiles/basemap/20261115.pmtiles', { caches: store, inner: src2 });
  await again.getBytes(0, 16);
  assert.equal(src2.calls.length, 0);
  const newer = cachedTileSource('/api/osm-tiles/basemap/20270101.pmtiles', { caches: store, inner: inner() });
  await newer.getBytes(0, 16); await settle();
  assert.deepEqual([...store.all.keys()], [`${TILE_CACHE_PREFIX}/api/osm-tiles/basemap/20270101.pmtiles`]);
});

test('without storage, or with storage that fails, every read goes to the server', async () => {
  const src = inner();
  const s = cachedTileSource('/a.pmtiles', { caches: null, inner: src });
  await s.getBytes(0, 8); await s.getBytes(0, 8);
  assert.equal(src.calls.length, 2);
  const broken = { keys: async () => { throw new Error('blocked'); }, open: async () => { throw new Error('blocked'); }, delete: async () => false };
  const src2 = inner(); const s2 = cachedTileSource('/a.pmtiles', { caches: broken, inner: src2 });
  assert.equal((await s2.getBytes(0, 8)).data.byteLength, 8);
});
