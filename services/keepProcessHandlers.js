// Libraries compiled with Emscripten (laz-perf's Node build) add process handlers when they load that throw
// whatever reaches them: one failed download nobody waits for any more then stops the whole desktop export
// (code 7), past the runner's own handler that notes it and carries on (desktop/runner/common.mjs).
// withProcessHandlersKept(load): runs load() and takes back any such handler it added.
const EVENTS = ['unhandledRejection', 'uncaughtException'];

export async function withProcessHandlersKept(load) {
  const proc = typeof process !== 'undefined' && typeof process.listeners === 'function' ? process : null;
  if (!proc) return load();
  const before = new Map(EVENTS.map((ev) => [ev, proc.listeners(ev)]));
  try {
    return await load();
  } finally {
    for (const ev of EVENTS) {
      for (const l of proc.listeners(ev)) if (!before.get(ev).includes(l)) proc.removeListener(ev, l);
    }
  }
}
