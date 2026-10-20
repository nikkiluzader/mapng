import test from 'node:test';
import assert from 'node:assert/strict';

import worker from '../worker.js';
import { fetchOSMData, getLastOSMRequestInfo } from '../services/osm.js';

const GOOD = JSON.stringify({ elements: [{ type: 'node', id: 1, lat: 35.21, lon: -111.41, tags: { natural: 'tree' } }] });

function installCache() {
  const store = new Map();
  const original = globalThis.caches;
  globalThis.caches = {
    default: {
      match: async (req) => {
        const hit = store.get(req.url);
        return hit ? new Response(hit.body, { headers: hit.headers }) : undefined;
      },
      put: async (req, res) => { store.set(req.url, { body: await res.text(), headers: Object.fromEntries(res.headers) }); },
    },
  };
  return { store, restore: () => { globalThis.caches = original; } };
}

// handler(host) → Response | Error
function installUpstream(handler) {
  const original = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, init) => {
    const host = new URL(url).host;
    calls.push({ host, ua: init?.headers?.['User-Agent'] });
    const r = handler(host);
    if (r instanceof Error) throw r;
    return r;
  };
  return { calls, restore: () => { globalThis.fetch = original; } };
}

async function callWorker(path, method = 'GET') {
  const pending = [];
  const ctx = { waitUntil: (p) => pending.push(p) };
  const res = await worker.fetch(new Request(`https://mapng.com${path}`, { method }), { ASSETS: { fetch: () => new Response('asset') } }, ctx);
  await Promise.all(pending);
  return res;
}

const BBOX = '/api/osm?bbox=35.2065,-111.4188,35.2158,-111.4075';

test('worker /api/osm: a miss fetches a mirror and caches; the next request is a hit', async () => {
  const cache = installCache();
  const up = installUpstream(() => new Response(GOOD, { status: 200 }));
  try {
    const first = await callWorker(BBOX);
    assert.equal(first.status, 200);
    assert.equal(first.headers.get('x-mapng-osm-cache'), 'MISS');
    assert.equal(JSON.parse(await first.text()).elements.length, 1);
    assert.match(up.calls[0].ua, /mapng/, 'identifies itself to Overpass');
    assert.equal(cache.store.size, 1);
    assert.match([...cache.store.keys()][0], /\/v\d+\/35\.205,-111\.42,35\.22,-111\.405$/, 'cache key is the snapped box');

    const second = await callWorker('/api/osm?bbox=35.2070,-111.4180,35.2155,-111.4080');
    assert.equal(second.headers.get('x-mapng-osm-cache'), 'HIT', 'a nearby box shares the snapped entry');
    assert.equal(up.calls.length, 1, 'no second upstream fetch');
  } finally {
    up.restore();
    cache.restore();
  }
});

test('worker /api/osm: refuses bad or oversized boxes and non-GET', async () => {
  const cache = installCache();
  const up = installUpstream(() => new Response(GOOD));
  try {
    assert.equal((await callWorker('/api/osm?bbox=1,2,3')).status, 400);
    assert.equal((await callWorker('/api/osm?bbox=0,0,1,1')).status, 400, '1 deg² is over the limit');
    assert.equal((await callWorker('/api/osm?bbox=5,5,4,6')).status, 400, 'south >= north');
    assert.equal((await callWorker(BBOX, 'POST')).status, 405);
    assert.equal(up.calls.length, 0);
  } finally {
    up.restore();
    cache.restore();
  }
});

test('worker /api/osm: skips failing / unusable mirrors, never caches them, 502 when all fail', async () => {
  const cache = installCache();
  let n = 0;
  const up = installUpstream(() => {
    n++;
    if (n === 1) return new Response('rate limited', { status: 429 });
    if (n === 2) return new Response(JSON.stringify({ elements: [], remark: 'runtime error: Query timed out' }));
    return new TypeError('fetch failed');
  });
  try {
    const res = await callWorker(BBOX);
    assert.equal(res.status, 502);
    assert.equal(JSON.parse(await res.text()).attempts.length, 3, 'at most 3 mirrors per miss');
    assert.equal(cache.store.size, 0, 'nothing cached');
  } finally {
    up.restore();
    cache.restore();
  }
});

test('client: on the deployed site the Worker cache is tried first', async () => {
  const store = new Map();
  const originals = { location: globalThis.location, localStorage: globalThis.localStorage, fetch: globalThis.fetch };
  globalThis.location = { protocol: 'https:', origin: 'https://mapng.com' };
  globalThis.localStorage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v) };
  const urls = [];
  globalThis.fetch = async (url) => {
    urls.push(String(url));
    if (String(url).startsWith('/api/osm?bbox=')) return new Response(GOOD, { status: 200 });
    throw new TypeError('mirror should not be needed');
  };
  try {
    const features = await fetchOSMData({ south: 35.2065, west: -111.4188, north: 35.2158, east: -111.4075 });
    assert.equal(urls.length, 1);
    assert.match(urls[0], /^\/api\/osm\?bbox=35\.2065,-111\.4188,35\.2158,-111\.4075$/);
    assert.equal(getLastOSMRequestInfo().endpointUsed, '/api/osm');
    assert.ok(features.some((f) => f.type === 'vegetation'));
  } finally {
    globalThis.location = originals.location;
    globalThis.localStorage = originals.localStorage;
    globalThis.fetch = originals.fetch;
  }
});
