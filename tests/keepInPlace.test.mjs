// services/keepInPlace.js: filtering and appending big lists without passing them as arguments
import test from 'node:test';
import assert from 'node:assert/strict';
import { appendAll, keepInPlace } from '../services/keepInPlace.js';

test('keepInPlace keeps the same array, in order', () => {
  const list = [1, 2, 3, 4, 5, 6];
  const same = keepInPlace(list, (v) => v % 2 === 0);
  assert.equal(same, list);
  assert.deepEqual(list, [2, 4, 6]);
  assert.deepEqual(keepInPlace([], () => true), []);
});

test('300,000 kept items: no stack overflow (the old push(...kept) threw past about 125,000)', () => {
  const n = 300000;
  const list = Array.from({ length: n + 10 }, (_, i) => i);
  assert.throws(() => { const kept = list.filter((v) => v < n); const out = []; out.push(...kept); }, RangeError);
  keepInPlace(list, (v) => v < n);
  assert.equal(list.length, n);
  assert.equal(list[n - 1], n - 1);
  const more = appendAll([], list);
  assert.equal(more.length, n);
});
