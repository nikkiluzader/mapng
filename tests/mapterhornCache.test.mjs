import test from 'node:test';
import assert from 'node:assert/strict';

import { handleMapterhornTiles, parseMapterhornPath } from '../mapterhornCache.js';

function env() {
  const store = new Map(); let puts = 0;
  return {
    OSM_TILES: {
      get: async (k) => (store.has(k) ? { body: store.get(k) } : null),
      put: async (k, v) => { puts++; store.set(k, v); },
    },
    store, puts: () => puts,
  };
}
const edge = () => { const m = new Map(); return { match: async (r) => m.get(r.url)?.clone() || null, put: async (r, res) => { m.set(r.url, res); }, m }; };
const ctx = () => { const p = []; return { waitUntil: (x) => p.push(x), done: () => Promise.all(p) }; };
const req = (path, ip = '1.2.3.4') => new Request(`https://mapng.com${path}`, { headers: { 'CF-Connecting-IP': ip } });

test('paths: lidar zooms only, inside the tile grid', () => {
  assert.deepEqual(parseMapterhornPath('/api/mapterhorn/16/34318/22950.webp'), { z: 16, x: 34318, y: 22950, key: 'mapterhorn/16/34318/22950.webp' });
  assert.equal(parseMapterhornPath('/api/mapterhorn/12/1/1.webp'), null);       // base layer not served
  assert.equal(parseMapterhornPath('/api/mapterhorn/13/9000/1.webp'), null);    // x outside 2^13
  assert.equal(parseMapterhornPath('/api/mapterhorn/16/1/1.png'), null);
  assert.equal(parseMapterhornPath('/api/mapterhorn/../secret'), null);
});

test('first request goes upstream and is kept in R2; the next is served from R2 without upstream', async () => {
  const e = env(); const c = edge(); let upstream = 0;
  const fetchImpl = async () => { upstream++; return new Response(new Uint8Array([1, 2, 3]), { status: 200, headers: { 'content-type': 'image/webp' } }); };
  const k1 = ctx();
  const r1 = await handleMapterhornTiles(req('/api/mapterhorn/16/100/200.webp'), e, k1, new URL('https://mapng.com/api/mapterhorn/16/100/200.webp'), { fetchImpl, cache: null });
  await k1.done();
  assert.equal(r1.status, 200); assert.equal(r1.headers.get('X-MapNG-Cache'), 'upstream'); assert.equal(r1.headers.get('Access-Control-Allow-Origin'), '*');
  assert.equal(e.puts(), 1);
  const k2 = ctx();
  const r2 = await handleMapterhornTiles(req('/api/mapterhorn/16/100/200.webp'), e, k2, new URL('https://mapng.com/api/mapterhorn/16/100/200.webp'), { fetchImpl, cache: c });
  assert.equal(r2.headers.get('X-MapNG-Cache'), 'r2'); assert.equal(upstream, 1);
  assert.deepEqual([...new Uint8Array(await r2.arrayBuffer())], [1, 2, 3]);
});

test('no lidar there: 404 remembered at the edge, never written to R2', async () => {
  const e = env(); const c = edge(); let upstream = 0;
  const fetchImpl = async () => { upstream++; return new Response(null, { status: 404 }); };
  const u = new URL('https://mapng.com/api/mapterhorn/15/1/1.webp');
  const k = ctx();
  const r = await handleMapterhornTiles(req(u.pathname), e, k, u, { fetchImpl, cache: c }); await k.done();
  assert.equal(r.status, 404); assert.equal(e.puts(), 0);
  const r2 = await handleMapterhornTiles(req(u.pathname), e, ctx(), u, { fetchImpl, cache: c });
  assert.equal(r2.status, 404); assert.equal(upstream, 1);
});

test('upstream errors are not cached; crawling is capped per address', async () => {
  const e = env();
  const bad = async () => new Response('oops', { status: 500 });
  const u = new URL('https://mapng.com/api/mapterhorn/14/2/2.webp');
  const r = await handleMapterhornTiles(req(u.pathname), e, ctx(), u, { fetchImpl: bad, cache: null });
  assert.equal(r.status, 502); assert.equal(e.puts(), 0);
  const ok = async () => new Response(new Uint8Array([0]), { status: 200 });
  let limited = 0;
  for (let i = 0; i < 700; i++) {
    const p = `/api/mapterhorn/17/${i}/5.webp`;
    const res = await handleMapterhornTiles(req(p, '9.9.9.9'), e, ctx(), new URL(`https://mapng.com${p}`), { fetchImpl: ok, cache: null });
    if (res.status === 429) limited++;
  }
  assert.ok(limited > 0 && limited <= 101, `limited ${limited}`);
});
