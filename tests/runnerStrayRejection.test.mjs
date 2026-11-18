import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

// A desktop job (generate, export, prefetch) shares desktop/runner/common.mjs. A rejection nobody awaits any more
// (a dropped download slice after its read gave up) must not stop the job, as it doesn't stop a browser tab.
test('a runner process carries on past a rejection nobody awaits', () => {
  const common = new URL('../desktop/runner/common.mjs', import.meta.url).href;
  const script = `await import(${JSON.stringify(common)});
Promise.reject(new Error('socket closed'));
await new Promise((r) => setTimeout(r, 50));
console.log('still here');`;
  const r = spawnSync(process.execPath, ['--input-type=module', '-e', script], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /still here/);
  assert.match(r.stderr, /no longer awaited/);
});

test('an awaited failure still fails', () => {
  const common = new URL('../desktop/runner/common.mjs', import.meta.url).href;
  const script = `await import(${JSON.stringify(common)});
await Promise.reject(new Error('real failure'));`;
  const r = spawnSync(process.execPath, ['--input-type=module', '-e', script], { encoding: 'utf8' });
  assert.notEqual(r.status, 0);
});

// laz-perf's Node build (US lidar bridge heights) adds Emscripten handlers on load that throw any stray failure:
// a 16 km export stopped there with code 7 after the runner's own handler had noted it.
test('loading laz-perf leaves the process handlers as they were', async () => {
  const { withProcessHandlersKept } = await import('../services/keepProcessHandlers.js');
  const before = ['unhandledRejection', 'uncaughtException'].map((ev) => process.listeners(ev).length);
  const lp = await withProcessHandlersKept(async () => (await import('laz-perf/lib/node/index.js')).createLazPerf());
  assert.ok(lp, 'laz-perf loaded');
  const after = ['unhandledRejection', 'uncaughtException'].map((ev) => process.listeners(ev).length);
  assert.deepEqual(after, before);
});

test('a process handler added outside the load is kept', async () => {
  const { withProcessHandlersKept } = await import('../services/keepProcessHandlers.js');
  const mine = () => {};
  process.on('unhandledRejection', mine);
  await withProcessHandlersKept(async () => { process.on('unhandledRejection', () => { throw new Error('x'); }); });
  assert.ok(process.listeners('unhandledRejection').includes(mine));
  assert.equal(process.listeners('unhandledRejection').filter((l) => l !== mine).length, process.listeners('unhandledRejection').length - 1);
  process.removeListener('unhandledRejection', mine);
});
