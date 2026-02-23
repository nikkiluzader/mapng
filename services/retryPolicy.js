const RETRYABLE_STATUS = new Set([408, 425, 429, 500, 502, 503, 504]);

export const classifyError = (error) => {
  const status = error?.status || error?.response?.status || null;
  const name = error?.name || '';
  const message = String(error?.message || 'Unknown error');

  if (status && RETRYABLE_STATUS.has(status)) {
    return { retryable: true, kind: status === 429 ? 'rate_limit' : 'http_server', status };
  }

  if (status && status >= 400 && status < 500) {
    return { retryable: false, kind: 'http_client', status };
  }

  if (name === 'AbortError') {
    return { retryable: false, kind: 'aborted', status: null };
  }

  if (/timeout|network|fetch|ECONN|EAI_AGAIN|ENOTFOUND|ERR_/i.test(message)) {
    return { retryable: true, kind: 'network', status: null };
  }

  return { retryable: true, kind: 'unknown', status: null };
};

const parseRetryAfterMs = (error) => {
  const retryAfter = error?.retryAfter || error?.response?.headers?.get?.('retry-after') || null;
  if (!retryAfter) return null;
  const asNum = Number(retryAfter);
  if (Number.isFinite(asNum)) return Math.max(0, Math.floor(asNum * 1000));
  const dateMs = Date.parse(retryAfter);
  if (Number.isFinite(dateMs)) return Math.max(0, dateMs - Date.now());
  return null;
};

export const computeBackoffMs = (attempt, baseMs = 1000, maxMs = 30000) => {
  const exp = Math.min(maxMs, baseMs * (2 ** Math.max(0, attempt - 1)));
  const jitter = Math.floor(Math.random() * Math.max(1, Math.floor(exp * 0.25)));
  return Math.min(maxMs, exp + jitter);
};

export const runWithRetry = async (runner, options = {}) => {
  const {
    maxAttempts = 4,
    onRetry,
    signal,
    baseMs = 1000,
    maxMs = 30000,
  } = options;

  let lastError = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    signal?.throwIfAborted?.();
    try {
      return await runner(attempt);
    } catch (error) {
      lastError = error;
      const cls = classifyError(error);
      if (!cls.retryable || attempt >= maxAttempts) {
        throw error;
      }

      const retryAfterMs = parseRetryAfterMs(error);
      const waitMs = retryAfterMs ?? computeBackoffMs(attempt, baseMs, maxMs);
      onRetry?.({ attempt, waitMs, classification: cls, error });

      await new Promise((resolve, reject) => {
        const timer = setTimeout(resolve, waitMs);
        if (signal) {
          signal.addEventListener('abort', () => {
            clearTimeout(timer);
            reject(signal.reason || new DOMException('Aborted', 'AbortError'));
          }, { once: true });
        }
      });
    }
  }

  throw lastError || new Error('Retry exhausted');
};
