import test from 'node:test';
import assert from 'node:assert/strict';
import { threadsFor, MAX_THREADS } from '../services/parallel.js';

// Each worker costs memory and more of them made no export faster (32 vs 8 workers: the same time, 24 vs 17 GB):
// the count stops at MAX_THREADS whatever the machine has, unless MAPNG_THREADS says otherwise.
test('the worker count stops at MAX_THREADS on a big machine', () => {
  assert.equal(MAX_THREADS, 8);
  assert.equal(threadsFor(32), 8);
  assert.equal(threadsFor(12), 8);
});

test('a small machine uses its cores; a caller limit and an override still count', () => {
  assert.equal(threadsFor(4), 4);
  assert.equal(threadsFor(undefined), 4);
  assert.equal(threadsFor(32, undefined, 3), 3);
  assert.equal(threadsFor(32, '16'), 16);
  assert.equal(threadsFor(32, '16', 6), 6);
});
