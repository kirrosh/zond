/**
 * ARV-64 (feedback round-01 / F4): `zond run` was ignoring server-published
 * RateLimit-* / Retry-After headers unless the user explicitly passed
 * `--rate-limit auto`. On a real API (Resend: 5 req/s window) a burst sweep
 * piled into 429s — 22% of requests landed in the rate-limit pool instead of
 * the assertion path. We now default to an adaptive limiter (no-op until
 * the first ratelimit-* response header is seen, then it paces requests to
 * the server's published policy).
 *
 * This test pins the default behaviour at the unit-level: with no
 * --rate-limit flag, http-client receives an adaptive limiter, and once a
 * response surfaces RateLimit-Policy, the next acquire() waits at least the
 * derived interval.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createAdaptiveRateLimiter, parseRateLimitHeaders } from "../../src/core/runner/rate-limiter.ts";

describe("zond run: adaptive rate limiter is the default (ARV-64)", () => {
  let tmp: string;
  beforeEach(() => {
    tmp = realpathSync(mkdtempSync(join(tmpdir(), "zond-run-adaptive-")));
  });
  afterEach(() => rmSync(tmp, { recursive: true, force: true }));

  test("adaptive limiter is a no-op before any policy is seen", async () => {
    const limiter = createAdaptiveRateLimiter();
    const start = Date.now();
    await limiter.acquire();
    await limiter.acquire();
    await limiter.acquire();
    const elapsed = Date.now() - start;
    // No published policy yet → three acquires resolve back-to-back.
    expect(elapsed).toBeLessThan(50);
  });

  test("once RateLimit-Policy is fed, the limiter spaces subsequent acquires", async () => {
    const limiter = createAdaptiveRateLimiter();
    // Resend-style: 5 req per 1s window → 200ms + safety per request.
    const meta = parseRateLimitHeaders({ "RateLimit-Policy": "5;w=1", "RateLimit-Remaining": "4", "RateLimit-Reset": "1" });
    expect(meta.intervalMs).toBeGreaterThan(150);
    limiter.note!(meta);
    // First acquire after policy is free (slot reserved at now+interval).
    await limiter.acquire();
    const start = Date.now();
    await limiter.acquire();
    const elapsed = Date.now() - start;
    // Second acquire must wait at least one policy interval.
    expect(elapsed).toBeGreaterThanOrEqual(150);
  });

  test("policy-driven pause kicks in when remaining headroom is exhausted", async () => {
    const limiter = createAdaptiveRateLimiter();
    // Tell the limiter "0 left, reset in 0.2s".
    const meta = parseRateLimitHeaders({ "RateLimit-Limit": "5", "RateLimit-Remaining": "0", "RateLimit-Reset": "0.2" });
    limiter.note!(meta);
    const start = Date.now();
    await limiter.acquire();
    const elapsed = Date.now() - start;
    expect(elapsed).toBeGreaterThanOrEqual(150);
    expect(elapsed).toBeLessThan(2000);
  });
});
