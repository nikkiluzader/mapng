import test from 'node:test';
import assert from 'node:assert/strict';

import { probeMapterhorn, boxAround, _resetSourceAdvisorCache } from '../services/sourceAdvisor.js';

const fakeFetch = (maxZoom, { cacheDown = false } = {}) => {
  const calls = [];
  const f = async (url) => {
    calls.push(url);
    if (cacheDown && url.startsWith('/api/')) return new Response('<html>', { status: 200, headers: { 'content-type': 'text/html' } });
    const z = Number(url.match(/\/(\d+)\/\d+\/\d+\.webp$/)[1]);
    return z <= maxZoom ? new Response(new Uint8Array([0]), { status: 200, headers: { 'content-type': 'image/webp' } }) : new Response(null, { status: 404 });
  };
  f.calls = calls; return f;
};
const box = boxAround({ lat: 47.37, lng: 8.54 }, 1);

test('lidar to z16: full coverage, resolution from the deepest zoom', async () => {
  _resetSourceAdvisorCache();
  const p = await probeMapterhorn(box, { fetchImpl: fakeFetch(16) });
  assert.equal(p.coverage, 1); assert.equal(p.zoom, 16); assert.ok(p.metersPerPixel > 0.7 && p.metersPerPixel < 0.9);
});

test('no lidar: zero coverage, no deep probing', async () => {
  _resetSourceAdvisorCache();
  const f = fakeFetch(12);
  const p = await probeMapterhorn(box, { fetchImpl: f });
  assert.equal(p.coverage, 0); assert.equal(p.zoom, 0); assert.ok(f.calls.every((u) => /\/13\//.test(u)));
});

test('answers are cached per tile; a broken cache route falls back to Mapterhorn directly', async () => {
  _resetSourceAdvisorCache();
  const f = fakeFetch(15, { cacheDown: true });
  const p = await probeMapterhorn(box, { fetchImpl: f });
  assert.equal(p.zoom, 15); assert.ok(f.calls.some((u) => u.startsWith('https://tiles.mapterhorn.com/')));
  const n = f.calls.length; await probeMapterhorn(box, { fetchImpl: f }); assert.equal(f.calls.length, n);
});
