import test from 'node:test';
import assert from 'node:assert/strict';

import { fetchOSMData, getLastOSMRequestInfo, orderOverpassEndpoints } from '../services/osm.js';

const BOUNDS = { north: 0.51, south: 0.5, east: 0.51, west: 0.5 };
const EMPTY_OVERPASS = JSON.stringify({ elements: [] });

function installStorage() {
  const store = new Map();
  const original = globalThis.localStorage;
  globalThis.localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
  };
  return () => { globalThis.localStorage = original; };
}

// fetch stub: handler(host) → 'refuse' | 'ok' | 'hang'
function installFetch(handler) {
  const original = globalThis.fetch;
  const calls = [];
  globalThis.fetch = (url, init) => {
    const host = new URL(url).host;
    calls.push(host);
    const mode = handler(host);
    if (mode === 'refuse') return Promise.reject(new TypeError('Failed to fetch'));
    if (mode === 'ok') return Promise.resolve(new Response(EMPTY_OVERPASS, { status: 200 }));
    return new Promise((_, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
    });
  };
  return { calls, restore: () => { globalThis.fetch = original; } };
}

test('a refused mirror fails over immediately and is tried last next time', async () => {
  const restoreStorage = installStorage();
  const { calls, restore } = installFetch((host) => (host.includes('overpass-api.de') ? 'refuse' : 'ok'));
  try {
    const features = await fetchOSMData(BOUNDS);
    assert.ok(Array.isArray(features));
    const info = getLastOSMRequestInfo();
    assert.ok(info.endpointUsed && !info.endpointUsed.includes('overpass-api.de'), 'a healthy mirror wins');
    assert.ok(calls.length < 5, `hedging must not fire every mirror at once (fired ${calls.length})`);

    const ordered = orderOverpassEndpoints([
      'https://lz4.overpass-api.de/api/interpreter',
      'https://overpass-api.de/api/interpreter',
      info.endpointUsed,
    ]);
    assert.equal(ordered[0], info.endpointUsed, 'last winner goes first');
  } finally {
    restore();
    restoreStorage();
  }
});

test('mirrors cooling down after a failure are ordered after untried ones', () => {
  const now = 1_000_000;
  const health = {
    a: { failAt: now - 1000, failKind: 'network', coolUntil: now + 60000 },
    b: { okAt: now - 5000, latencyMs: 900 },
    c: { okAt: now - 5000, latencyMs: 300 },
  };
  const order = orderOverpassEndpoints(['a', 'b', 'c', 'd'], health, now);
  assert.deepEqual(order.slice(0, 2), ['c', 'b'], 'fastest healthy first');
  assert.equal(order[2], 'd', 'unknown before cooling down');
  assert.equal(order[3], 'a');
});

test('every mirror down returns no features and records the error', async () => {
  const restoreStorage = installStorage();
  const { restore } = installFetch(() => 'refuse');
  try {
    const features = await fetchOSMData(BOUNDS);
    assert.deepEqual(features, []);
    const info = getLastOSMRequestInfo();
    assert.equal(info.endpointUsed, null);
    assert.match(info.error, /All Overpass mirrors failed/);
  } finally {
    restore();
    restoreStorage();
  }
});

test('cancelling aborts in-flight mirror requests', async () => {
  const restoreStorage = installStorage();
  const { restore } = installFetch(() => 'hang');
  try {
    const controller = new AbortController();
    const pending = fetchOSMData(BOUNDS, { signal: controller.signal });
    setTimeout(() => controller.abort(), 20);
    await assert.rejects(pending, (err) => err?.name === 'AbortError');
  } finally {
    restore();
    restoreStorage();
  }
});

test('while every public mirror is known down, Overture is asked straight away', async () => {
  const { OVERPASS_ENDPOINTS } = await import('../services/overpassQuery.js');
  const restoreStorage = installStorage();
  const until = Date.now() + 10 * 60000;
  globalThis.localStorage.setItem('mapng_overpass_health_v1', JSON.stringify(Object.fromEntries(OVERPASS_ENDPOINTS.map((e) => [e, { failAt: Date.now(), failKind: 'timeout', coolUntil: until }]))));
  const { calls, restore } = installFetch(() => 'refuse');
  try {
    await fetchOSMData(BOUNDS);
    const firstOverpass = calls.findIndex((h) => OVERPASS_ENDPOINTS.some((e) => new URL(e).host === h));
    const firstOverture = calls.findIndex((h) => h.includes('overturemaps'));
    assert.ok(firstOverture >= 0, `Overture asked (calls: ${calls.join(', ')})`);
    assert.ok(firstOverpass < 0 || firstOverture < firstOverpass, 'before any Overpass mirror');
  } finally {
    restore();
    restoreStorage();
  }
});
