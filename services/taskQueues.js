export const createTaskQueue = ({ concurrency = 1, name = 'queue' } = {}) => {
  const queue = [];
  let active = 0;
  let closed = false;

  const pump = () => {
    while (!closed && active < concurrency && queue.length > 0) {
      const item = queue.shift();
      active++;
      const waitMs = performance.now() - item.enqueuedAt;
      item.onStart?.(waitMs);

      Promise.resolve()
        .then(item.task)
        .then(item.resolve, item.reject)
        .finally(() => {
          active--;
          pump();
        });
    }
  };

  return {
    name,
    enqueue(task, hooks = {}) {
      if (closed) {
        return Promise.reject(new Error(`${name} is closed`));
      }
      return new Promise((resolve, reject) => {
        queue.push({ task, resolve, reject, enqueuedAt: performance.now(), onStart: hooks.onStart });
        pump();
      });
    },
    close() {
      closed = true;
    },
    stats() {
      return { active, queued: queue.length, concurrency, closed };
    },
  };
};

export const createRateLimiter = ({ minIntervalMs = 0, concurrency = 1 } = {}) => {
  const queue = createTaskQueue({ concurrency, name: 'rateLimiter' });
  let lastStart = 0;

  return {
    schedule(task) {
      return queue.enqueue(async () => {
        const now = performance.now();
        const wait = Math.max(0, minIntervalMs - (now - lastStart));
        if (wait > 0) {
          await new Promise(r => setTimeout(r, wait));
        }
        lastStart = performance.now();
        return task();
      });
    },
    stats: queue.stats,
  };
};
