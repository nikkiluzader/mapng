// Storage reads tried again when they fail (worker/retry.js), as the planet tile reads are.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { readWithRetry } from '../worker/retry.js';

const noWait = { sleep: async () => {} };

test('a read that fails once and then answers is not an error', async () => {
  let calls = 0;
  const out = await readWithRetry(async () => { if (++calls === 1) throw new Error('storage hiccup'); return { size: 5 }; }, noWait);
  assert.deepEqual(out, { size: 5 }); assert.equal(calls, 2);
});

test('three failures are an error, the last one', async () => {
  let calls = 0;
  await assert.rejects(readWithRetry(async () => { throw new Error(`fail ${++calls}`); }, noWait), /fail 3/);
  assert.equal(calls, 3);
});

test('"no such object" is an answer, not retried', async () => {
  let calls = 0;
  assert.equal(await readWithRetry(async () => { calls++; return null; }, noWait), null);
  assert.equal(calls, 1);
});

test('the waits grow: one step, then two', async () => {
  const waits = [];
  await readWithRetry(async () => { if (waits.length < 2) throw new Error('x'); return 1; }, { waitMs: 80, sleep: async (ms) => { waits.push(ms); } });
  assert.deepEqual(waits, [80, 160]);
});

test('the planet tile read goes through the retry', () => {
  const src = fs.readFileSync(new URL('../worker/index.js', import.meta.url), 'utf8');
  assert.match(src, /readWithRetry\(\(\) => env\.OSM_TILES\.get\(path, \{ range/);
});
