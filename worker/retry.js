// A read that is tried again when it throws: for storage reads that fail now and then under a burst.
// (Its own module: worker/index.js may export only handlers.)

/**
 * Run `read` up to `tries` times, waiting `waitMs`, then twice that, between tries; the last error is thrown.
 * An answer, including null ("no such object"), is returned at once: only a thrown error is retried.
 */
export async function readWithRetry(read, { tries = 3, waitMs = 80, sleep = (ms) => new Promise((r) => setTimeout(r, ms)) } = {}) {
  let lastError;
  for (let attempt = 1; attempt <= tries; attempt++) {
    try {
      return await read();
    } catch (error) {
      lastError = error;
      if (attempt < tries) await sleep(waitMs * attempt);
    }
  }
  throw lastError;
}
