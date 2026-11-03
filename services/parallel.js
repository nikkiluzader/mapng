// Many independent pieces of work on several threads where the platform
// gives them (Node's worker_threads: the desktop app's export runner), in
// this thread otherwise (the web page, or a single piece). The work is a
// named export of a module, a pure function of one plain-data item (and
// shared plain data, sent to each worker once); results come back in the
// items' order, so callers stay deterministic.
//
//   import { work } from './x.js';
//   const out = await parallelMap(items, { local: work, module: new URL('./x.js', import.meta.url).href, fn: 'work', shared });
//
// local (the function itself, imported as usual) runs in this thread; a
// worker imports module and calls its export fn. Either way it gets
// (item, shared) and must need nothing else (no closures over the caller's
// state). The packaged desktop runner emits each such module beside its
// bundle under the same file name (desktop/scripts/stage.mjs).

const WORKER_SOURCE = `
const { parentPort, workerData } = require('node:worker_threads');
(async () => {
  const mod = await import(workerData.module);
  const fn = mod[workerData.fn];
  parentPort.on('message', async ({ id, item }) => {
    try { parentPort.postMessage({ id, result: await fn(item, workerData.shared) }); }
    catch (error) { parentPort.postMessage({ id, error: String(error && error.stack || error) }); }
  });
  parentPort.postMessage({ ready: true });
})().catch((error) => parentPort.postMessage({ fatal: String(error && error.stack || error) }));
`;

let nodeThreads;
async function workerThreads() {
  if (nodeThreads === undefined) {
    nodeThreads = null;
    if (typeof process !== 'undefined' && process.versions?.node && !process.versions.electron) {
      try { nodeThreads = await import(/* @vite-ignore */ ['node', 'worker_threads'].join(':')); } catch { /* none */ }
    }
  }
  return nodeThreads;
}

/** How many threads parallelMap would use here (1 where it runs in this thread). */
export async function parallelThreads(limit = Infinity) {
  const wt = await workerThreads();
  if (!wt || process.env.MAPNG_THREADS === '1') return 1;
  const cores = globalThis.navigator?.hardwareConcurrency || 4;
  const wanted = Number(process.env.MAPNG_THREADS) || cores;
  return Math.max(1, Math.min(limit, wanted));
}

/**
 * items mapped by module's fn, in order. threads: at most this many
 * (default: the machine's cores); a pool of workers takes items as they
 * free up. On any platform without worker threads, or for one item, the
 * work runs here, in order.
 */
export async function parallelMap(items, { local, module, fn, shared = null, threads = Infinity, onResult } = {}) {
  const n = module ? Math.min(items.length, await parallelThreads(threads)) : 1;
  if (n <= 1) {
    const out = [];
    for (let i = 0; i < items.length; i++) { out.push(await local(items[i], shared)); onResult?.(i, out[i]); }
    return out;
  }
  const { Worker } = await workerThreads();
  const results = new Array(items.length);
  let next = 0; let done = 0;
  const workers = [];
  try {
    await new Promise((resolve, reject) => {
      const feed = (w) => {
        if (next >= items.length) return;
        const id = next++;
        w.postMessage({ id, item: items[id] });
      };
      for (let k = 0; k < n; k++) {
        const w = new Worker(WORKER_SOURCE, { eval: true, workerData: { module, fn, shared } });
        workers.push(w);
        w.on('message', (msg) => {
          if (msg.fatal) { reject(new Error(msg.fatal)); return; }
          if (msg.ready) { feed(w); return; }
          if (msg.error) { reject(new Error(msg.error)); return; }
          results[msg.id] = msg.result;
          onResult?.(msg.id, msg.result);
          if (++done === items.length) resolve(); else feed(w);
        });
        w.on('error', reject);
      }
    });
  } finally {
    await Promise.all(workers.map((w) => w.terminate()));
  }
  return results;
}
