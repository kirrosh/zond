import { describe, test, expect } from "bun:test";
import {
  createRateLimiter,
  createAdaptiveRateLimiter,
  parseRetryAfter,
  parseRateLimitHeaders,
} from "../../src/core/runner/rate-limiter.ts";

describe("createRateLimiter", () => {
  test("returns undefined for missing or invalid input", () => {
    expect(createRateLimiter(undefined)).toBeUndefined();
    expect(createRateLimiter(0)).toBeUndefined();
    expect(createRateLimiter(-1)).toBeUndefined();
    expect(createRateLimiter(Number.NaN)).toBeUndefined();
  });

  test("acquire throttles to N req/s", async () => {
    const limiter = createRateLimiter(20)!; // 50ms interval
    const start = Date.now();
    await limiter.acquire();
    await limiter.acquire();
    await limiter.acquire();
    await limiter.acquire();
    await limiter.acquire();
    const elapsed = Date.now() - start;
    // 5 acquires at 20/s → ~200ms total (4 intervals of 50ms)
    expect(elapsed).toBeGreaterThanOrEqual(180);
    expect(elapsed).toBeLessThan(500);
  });

  test("first acquire is immediate", async () => {
    const limiter = createRateLimiter(1)!;
    const start = Date.now();
    await limiter.acquire();
    expect(Date.now() - start).toBeLessThan(50);
  });
});

describe("parseRetryAfter", () => {
  test("parses integer seconds", () => {
    expect(parseRetryAfter("5")).toBe(5000);
    expect(parseRetryAfter("0")).toBe(0);
    expect(parseRetryAfter("120")).toBe(120000);
  });

  test("parses fractional seconds", () => {
    expect(parseRetryAfter("0.5")).toBe(500);
  });

  test("parses HTTP-date", () => {
    const now = Date.parse("Wed, 21 Oct 2015 07:28:00 GMT");
    const future = "Wed, 21 Oct 2015 07:28:30 GMT";
    expect(parseRetryAfter(future, now)).toBe(30000);
  });

  test("clamps past dates to 0", () => {
    const now = Date.parse("Wed, 21 Oct 2015 07:28:00 GMT");
    const past = "Wed, 21 Oct 2015 07:27:00 GMT";
    expect(parseRetryAfter(past, now)).toBe(0);
  });

  test("returns undefined for empty/invalid", () => {
    expect(parseRetryAfter(null)).toBeUndefined();
    expect(parseRetryAfter(undefined)).toBeUndefined();
    expect(parseRetryAfter("")).toBeUndefined();
    expect(parseRetryAfter("not-a-date")).toBeUndefined();
  });
});

describe("parseRateLimitHeaders (TASK-81)", () => {
  test("reads RFC draft ratelimit-* triple", () => {
    expect(parseRateLimitHeaders({
      "ratelimit-limit": "100",
      "ratelimit-remaining": "12",
      "ratelimit-reset": "60",
    })).toEqual({ limit: 100, remaining: 12, reset: 60 });
  });

  test("reads GitHub-style x-ratelimit-* aliases", () => {
    expect(parseRateLimitHeaders({
      "x-ratelimit-limit": "5000",
      "x-ratelimit-remaining": "4321",
      "x-ratelimit-reset": "1372700873",
    })).toEqual({ limit: 5000, remaining: 4321, reset: 1372700873 });
  });

  test("matching is case-insensitive on header keys", () => {
    const meta = parseRateLimitHeaders({ "RateLimit-Remaining": "3" });
    expect(meta.remaining).toBe(3);
  });

  test("strips quoted-string suffixes (RFC draft style)", () => {
    const meta = parseRateLimitHeaders({ "ratelimit-remaining": '0;w=60' });
    expect(meta.remaining).toBe(0);
  });

  test("returns undefined fields when absent", () => {
    expect(parseRateLimitHeaders({})).toEqual({
      limit: undefined, remaining: undefined, reset: undefined,
    });
  });
});

describe("RateLimiter.note() — proactive throttling (TASK-81)", () => {
  test("AdaptiveRateLimiter: low remaining + small reset pauses next acquire", async () => {
    const limiter = createAdaptiveRateLimiter();
    // Initial acquire is immediate.
    const t0 = Date.now();
    await limiter.acquire();
    expect(Date.now() - t0).toBeLessThan(40);

    // Server signals: 1 left, resets in 0.2s.
    limiter.note!({ remaining: 1, reset: 0.2 });

    const t1 = Date.now();
    await limiter.acquire();
    expect(Date.now() - t1).toBeGreaterThanOrEqual(150);
  });

  test("AdaptiveRateLimiter: comfortable headroom is a no-op", async () => {
    const limiter = createAdaptiveRateLimiter();
    limiter.note!({ remaining: 99, reset: 60 });
    const t0 = Date.now();
    await limiter.acquire();
    expect(Date.now() - t0).toBeLessThan(40);
  });

  test("AdaptiveRateLimiter: GitHub-style Unix-epoch reset is honoured", async () => {
    const limiter = createAdaptiveRateLimiter();
    const now = Date.now();
    // Reset = floor(now/1000) + 2 seconds → between 1.0s and 2.0s in the
    // future depending on sub-second offset of `now`. Magnitude is well
    // above UNIX_TS_BOUNDARY so it must be treated as a Unix timestamp.
    const futureUnixSec = Math.floor(now / 1000) + 2;
    limiter.note!({ remaining: 0, reset: futureUnixSec }, now);
    const t0 = Date.now();
    await limiter.acquire();
    const elapsed = Date.now() - t0;
    expect(elapsed).toBeGreaterThanOrEqual(900);
    expect(elapsed).toBeLessThan(2200);
  });

  test("IntervalRateLimiter: note() also pushes nextAvailable when remaining ≤ 5", async () => {
    const limiter = createRateLimiter(100)!; // 10ms interval normally
    await limiter.acquire();
    // Server signals exhausted; reset in ~0.15s, much longer than the
    // 10 ms interval cap.
    limiter.note!({ remaining: 0, reset: 0.15 });
    const t0 = Date.now();
    await limiter.acquire();
    expect(Date.now() - t0).toBeGreaterThanOrEqual(120);
  });
});
