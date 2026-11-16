import test from 'node:test';
import assert from 'node:assert/strict';

import { probeMapterhorn, boxAround, indexIsFresh, _resetSourceAdvisorCache } from '../services/sourceAdvisor.js';

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
  const p = await probeMapterhorn(box, { fetchImpl: fakeFetch(16), index: null });
  assert.equal(p.coverage, 1); assert.equal(p.zoom, 16); assert.ok(p.metersPerPixel > 0.7 && p.metersPerPixel < 0.9);
});

test('no lidar: zero coverage, no deep probing', async () => {
  _resetSourceAdvisorCache();
  const f = fakeFetch(12);
  const p = await probeMapterhorn(box, { fetchImpl: f, index: null });
  assert.equal(p.coverage, 0); assert.equal(p.zoom, 0); assert.ok(f.calls.every((u) => /\/13\//.test(u)));
});

test('answers are cached per tile; a broken cache route falls back to Mapterhorn directly', async () => {
  _resetSourceAdvisorCache();
  const f = fakeFetch(15, { cacheDown: true });
  const p = await probeMapterhorn(box, { fetchImpl: f, index: null });
  assert.equal(p.zoom, 15); assert.ok(f.calls.some((u) => u.startsWith('https://tiles.mapterhorn.com/')));
  const n = f.calls.length; await probeMapterhorn(box, { fetchImpl: f, index: null }); assert.equal(f.calls.length, n);
});

// the coverage index: every z13 tile that exists, as rows of runs (services/lidarCoverage.js)
const NOW = Date.parse('2026-11-16');
const tile13 = (lat, lng) => { const s = Math.sin((lat * Math.PI) / 180); return [Math.floor(((lng + 180) / 360) * 8192), Math.floor((0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * 8192)]; };
const indexWith = (cells, generated = '2026-11-06') => { const rows = new Map(); for (const [x, y] of cells) rows.set(y, [...(rows.get(y) || []), [x, 1]]); return { z: 13, generated, rows }; };

test('with a fresh coverage index, no lidar here means no request at all', async () => {
  _resetSourceAdvisorCache();
  const f = fakeFetch(16);
  const p = await probeMapterhorn(box, { fetchImpl: f, index: indexWith([]), now: NOW });
  assert.equal(p.coverage, 0); assert.equal(p.zoom, 0); assert.equal(p.reachable, true); assert.equal(f.calls.length, 0);
});

test('with the index, lidar here: coverage from the index, tiles asked for only to find how deep it goes', async () => {
  _resetSourceAdvisorCache();
  const f = fakeFetch(16);
  const p = await probeMapterhorn(box, { fetchImpl: f, index: indexWith([tile13(47.37, 8.54)]), now: NOW });
  assert.ok(p.coverage > 0); assert.equal(p.zoom, 16);
  assert.ok(f.calls.length > 0 && f.calls.length <= 6, `only the centre's zooms: ${f.calls.length}`);
});

test('an old index is not believed: the tiles are asked for as before', async () => {
  _resetSourceAdvisorCache();
  assert.equal(indexIsFresh({ z: 13, generated: '2026-11-06' }, NOW), true);
  assert.equal(indexIsFresh({ z: 13, generated: '2026-08-01' }, NOW), false);
  assert.equal(indexIsFresh({ z: 13 }, NOW), false);
  const f = fakeFetch(16);
  const p = await probeMapterhorn(box, { fetchImpl: f, index: indexWith([], '2026-08-01'), now: NOW });
  assert.equal(p.coverage, 1); assert.ok(f.calls.length > 0);
});
