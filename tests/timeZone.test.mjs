import test from 'node:test';
import assert from 'node:assert/strict';
import { civilTimeAt, zoneOffsetHours } from '../services/timeZone.js';

test('a place\'s UTC offset on a day, daylight saving included', async () => {
  const on = (lat, lng, month, day = 15) => civilTimeAt(lat, lng, { year: 2026, month, day });
  // the Alps of France: the longitude says UTC+0, the clocks say +1 in winter and +2 in summer
  assert.deepEqual(await on(45.469, 6.906, 1), { zone: 'Europe/Paris', utcOffset: 1 });
  assert.deepEqual(await on(45.469, 6.906, 7), { zone: 'Europe/Paris', utcOffset: 2 });
  // Florida, Utah, and a place with no daylight saving
  assert.equal((await on(29.89, -81.31, 7)).utcOffset, -4); assert.equal((await on(29.89, -81.31, 12)).utcOffset, -5);
  assert.equal((await on(37.21, -112.96, 7)).utcOffset, -6);
  assert.equal((await on(33.45, -112.07, 7)).utcOffset, -7, 'Arizona keeps standard time');
  // quarter and half hours, the southern summer, one time for all of China
  assert.equal((await on(27.7, 85.3, 3)).utcOffset, 5.75); assert.equal((await on(28.6, 77.2, 3)).utcOffset, 5.5);
  assert.equal((await on(-33.87, 151.21, 1)).utcOffset, 11); assert.equal((await on(-33.87, 151.21, 7)).utcOffset, 10);
  assert.equal((await on(30.66, 104.06, 6)).utcOffset, 8, 'Chengdu: the longitude says +7');
  // the days round a change: Paris changed on 29 March 2026
  assert.equal((await on(48.85, 2.35, 3, 28)).utcOffset, 1); assert.equal((await on(48.85, 2.35, 3, 30)).utcOffset, 2);
});

test('what cannot be told is null, not a guess', async () => {
  assert.equal(await civilTimeAt(NaN, 5, { year: 2026, month: 1, day: 1 }), null);
  assert.equal(zoneOffsetHours('Not/AZone', new Date()), null);
});
