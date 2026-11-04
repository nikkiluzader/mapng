import test from 'node:test';
import assert from 'node:assert/strict';
import { parallelMap } from '../services/parallel.js';
import { square } from './fixtures/parallelWork.mjs';

const work = new URL('./fixtures/parallelWork.mjs', import.meta.url).href;

// Results come back in the items' order, on worker threads and in-line alike.
test('parallelMap keeps the order, on threads and in-line', async () => {
  const items = Array.from({ length: 40 }, (_, i) => ({ n: i, spin: (i * 7919) % 13 }));
  const threaded = await parallelMap(items, { local: square, module: work, fn: 'square', shared: { plus: 1 }, threads: 4 });
  const inline = await parallelMap(items, { local: square, module: work, fn: 'square', shared: { plus: 1 }, threads: 1 });
  assert.deepEqual(threaded, items.map((it) => it.n * it.n + 1));
  assert.deepEqual(inline, threaded);
});

test('parallelMap passes an error in the work back', async () => {
  await assert.rejects(parallelMap([{ n: 1 }, { n: -1 }], { local: square, module: work, fn: 'square', threads: 2 }), /negative/);
});

// prefill: all items handed out at once (the caller's thread busy meanwhile)
test('parallelMap with prefill keeps the order and reports when posted', async () => {
  const items = Array.from({ length: 30 }, (_, i) => ({ n: i, spin: (i * 31) % 7 }));
  let posted = false;
  const p = parallelMap(items, { local: square, module: work, fn: 'square', shared: { plus: 2 }, threads: 3, prefill: true, onPosted: () => { posted = true; } });
  const out = await p;
  assert.ok(posted);
  assert.deepEqual(out, items.map((it) => it.n * it.n + 2));
});
