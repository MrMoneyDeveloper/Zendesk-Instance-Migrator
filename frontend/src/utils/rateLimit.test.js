import { describe, expect, it, vi } from "vitest";

import { createRequestQueue, runWithRetry } from "./rateLimit";

describe("rate limit queue", () => {
  it("retries retryable rate limit failures", async () => {
    let attempts = 0;
    const result = await runWithRetry(
      async () => {
        attempts += 1;
        if (attempts === 1) {
          const error = new Error("rate limited");
          error.status = 429;
          throw error;
        }
        return "ok";
      },
      [1],
    );

    expect(result).toBe("ok");
    expect(attempts).toBe(2);
  });

  it("runs queued requests sequentially by default", async () => {
    vi.useFakeTimers();
    const queue = createRequestQueue();
    const order = [];

    const first = queue.run(
      () =>
        new Promise((resolve) => {
          order.push("first-start");
          setTimeout(() => {
            order.push("first-end");
            resolve();
          }, 10);
        }),
    );
    const second = queue.run(async () => {
      order.push("second");
    });

    await vi.advanceTimersByTimeAsync(10);
    await Promise.all([first, second]);
    vi.useRealTimers();

    expect(order).toEqual(["first-start", "first-end", "second"]);
  });
});
