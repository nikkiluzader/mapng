import test from 'node:test';
import assert from 'node:assert/strict';
import { handleShareCodes, normalizeShareId } from '../worker/shareCodes.js';

function fakeBucket() {
  const store = new Map();
  return {
    store,
    async head(key) { return store.has(key) ? {} : null; },
    async put(key, value, opts) { store.set(key, { value, meta: opts?.customMetadata }); },
    async get(key) { const o = store.get(key); return o ? { text: async () => o.value, customMetadata: o.meta } : null; },
  };
}
const json = (body, status = 200, headers = {}) => new Response(JSON.stringify(body), { status, headers });
const call = (env, path, init) => handleShareCodes(new Request(`https://mapng.com${path}`, init), env, new URL(`https://mapng.com${path}`), json);
const send = (env, code, ip = '5.5.5.5') => call(env, '/api/share', { method: 'POST', headers: { 'CF-Connecting-IP': ip }, body: JSON.stringify({ code }) });

test('a sent config comes back by its code, with or without the dash, until it expires', async () => {
  const env = { OSM_TILES: fakeBucket() };
  const r = await send(env, 'mapng:1:abcDEF_-');
  const { id } = await r.json();
  assert.match(id, /^[A-Z0-9]{3}-[A-Z0-9]{3}$/);
  for (const form of [id, id.replace('-', ''), id.toLowerCase()]) {
    const got = await (await call(env, `/api/share/${form}`)).json();
    assert.equal(got.code, 'mapng:1:abcDEF_-');
  }
  const [key] = env.OSM_TILES.store.keys();
  env.OSM_TILES.store.get(key).meta.expiresAt = new Date(Date.now() - 1000).toISOString();
  assert.equal((await call(env, `/api/share/${id}`)).status, 404);
});

test('only MapNG configs are kept; too many sends are refused', async () => {
  const env = { OSM_TILES: fakeBucket() };
  assert.equal((await send(env, 'hello', '6.6.6.6')).status, 400);
  assert.equal((await send(env, 'mapng:1:<script>', '6.6.6.6')).status, 400);
  assert.equal((await call(env, '/api/share/nope!!')).status, 404);
  const codes = [];
  for (let i = 0; i < 31; i++) codes.push((await send(env, 'mapng:1:x', '7.7.7.7')).status);
  assert.equal(codes.filter((c) => c === 200).length, 30);
  assert.equal(codes.at(-1), 429);
});

test('send codes are read loosely', () => {
  assert.equal(normalizeShareId(' k7f-29q '), 'K7F29Q');
  assert.equal(normalizeShareId('K7F-29'), null);
  assert.equal(normalizeShareId('O0I1LU'), null);            // letters left out to avoid mix-ups
});
