import { describe, test, expect } from "bun:test";
import { createRateLimiter, parseRetryAfter } from "../../src/core/runner/rate-limiter.ts";

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
