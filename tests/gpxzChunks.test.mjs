// services/gpxzChunks.js: no GPXZ request over the 10 km² it accepts
import test from 'node:test';
import assert from 'node:assert/strict';
import { gpxzChunkGrid, GPXZ_MAX_REQUEST_KM2 } from '../services/gpxzChunks.js';

const PAD = 0.445;   // 0.002° on both sides, in km of latitude
const area = (lat, lng, g, padLng = PAD) => (lat / g.rows + PAD) * (lng / g.cols + padLng);

test('every request stays within the limit, for maps of every size', () => {
  for (let side = 0.25; side <= 40; side += 0.25) {
    for (const padLng of [PAD, PAD * 0.5]) {            // (the equator, and 60° north)
      const g = gpxzChunkGrid(side, side, PAD, padLng);
      assert.ok(area(side, side, g, padLng) * 1.0104 < 10, `${side} km: ${g.rows}x${g.cols} asks for ${area(side, side, g, padLng).toFixed(2)} km²`);
    }
  }
});

test('the sizes that were refused: 3 km chunks with their overlap were 11.7 km²', () => {
  // (the old grid: ceil(side / 3) each way)
  for (const side of [3, 6, 9, 12]) {
    const old = { rows: Math.ceil(side / 3), cols: Math.ceil(side / 3) };
    assert.ok(area(side, side, old) > 10, `${side} km was over the limit`);
    assert.ok(area(side, side, gpxzChunkGrid(side, side, PAD, PAD)) <= GPXZ_MAX_REQUEST_KM2);
  }
});

test('where the usual 3 km grid fits it is kept, so a level\'s saved downloads are found again', () => {
  const usual = (side) => ({ rows: Math.ceil(side / 3), cols: Math.ceil(side / 3) });
  for (const side of [1, 2, 2.5, 4, 5, 7.5, 8, 10, 16]) assert.deepEqual(gpxzChunkGrid(side, side, PAD, PAD), usual(side), `${side} km`);
  assert.deepEqual(gpxzChunkGrid(1, 20, PAD, PAD), { rows: 1, cols: 7 });
});

test('where it does not fit: no more requests than needed', () => {
  const three = gpxzChunkGrid(3, 3, PAD, PAD); assert.equal(three.rows * three.cols, 2);
  const six = gpxzChunkGrid(6, 6, PAD, PAD); assert.equal(six.rows * six.cols, 6);      // 2 x 3, not 3 x 3
  for (const side of [3, 6, 9, 12, 18]) {
    const g = gpxzChunkGrid(side, side, PAD, PAD);
    for (const [r, c] of [[g.rows - 1, g.cols], [g.rows, g.cols - 1]]) if (r >= 1 && c >= 1) assert.ok(area(side, side, { rows: r, cols: c }) > GPXZ_MAX_REQUEST_KM2, `${side} km: ${r}x${c} would have fitted`);
  }
});

test('odd input gives one request rather than none', () => {
  assert.deepEqual(gpxzChunkGrid(0, 5, PAD, PAD), { rows: 1, cols: 1 });
  assert.deepEqual(gpxzChunkGrid(NaN, 5, PAD, PAD), { rows: 1, cols: 1 });
});

test('a refusal that means "no calls left today" is told from "too fast"', async () => {
  const { gpxzDailyLimitReached } = await import('../services/terrain.js');
  const r = (h) => ({ headers: new Headers(h) });
  assert.equal(gpxzDailyLimitReached(r({ 'x-ratelimit-remaining': '0' })), true);
  assert.equal(gpxzDailyLimitReached(r({ 'x-ratelimit-remaining': '57', 'retry-after': '1' })), false);
  assert.equal(gpxzDailyLimitReached(r({ 'retry-after': '3600' })), true);
  assert.equal(gpxzDailyLimitReached(r({})), false);        // nothing said: wait and ask again, as before
});
