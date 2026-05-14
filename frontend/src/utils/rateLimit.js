const DEFAULT_RETRY_DELAYS_MS = [750, 1500, 3000];

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function readRetryAfterMs(error) {
  const retryAfter = error?.headers?.["retry-after"] || error?.responseHeaders?.["retry-after"];
  const numeric = Number(retryAfter);
  if (Number.isFinite(numeric) && numeric > 0) {
    return numeric * 1000;
  }
  return null;
}

export function isRetryableError(error) {
  const status = Number(error?.status || error?.statusCode || error?.responseJSON?.status);
  return status === 429 || status === 503;
}

export function createRequestQueue({ concurrency = 1, retryDelaysMs = DEFAULT_RETRY_DELAYS_MS } = {}) {
  let active = 0;
  const queue = [];

  function pump() {
    if (active >= concurrency || queue.length === 0) return;
    const job = queue.shift();
    active += 1;
    void runWithRetry(job.task, retryDelaysMs)
      .then(job.resolve)
      .catch(job.reject)
      .finally(() => {
        active -= 1;
        pump();
      });
  }

  function run(task) {
    return new Promise((resolve, reject) => {
      queue.push({ task, resolve, reject });
      pump();
    });
  }

  return { run };
}

export async function runWithRetry(task, retryDelaysMs = DEFAULT_RETRY_DELAYS_MS) {
  let attempt = 0;

  while (true) {
    try {
      return await task();
    } catch (error) {
      const shouldRetry = isRetryableError(error) && attempt < retryDelaysMs.length;
      if (!shouldRetry) throw error;

      const retryAfterMs = readRetryAfterMs(error);
      const delayMs = retryAfterMs ?? retryDelaysMs[attempt];
      attempt += 1;
      await sleep(delayMs);
    }
  }
}
