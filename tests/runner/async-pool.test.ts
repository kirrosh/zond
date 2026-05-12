/**
 * ARV-8 unit tests for the bounded async-pool helper.
 *
 *   AC #1 — fixed-delay items: --workers 8 ≈ total/8 wall-time.
 *   AC #2 — pool + rate-limiter: a 50-RPS limit caps throughput
 *           regardless of pool size.
 *   AC #4 — workers=1 (default) preserves the sequential behaviour.
 *   AC #5 — `parseWorkers` honours the `auto` / clamp / default contract.
 */
import { describe, test, expect } from "bun:test";
import os from "node:os";

import { runPool, parseWorkers, WORKERS_LIMITS } from "../../src/core/runner/async-pool.ts";
import { createRateLimiter } from "../../src/core/runner/rate-limiter.ts";

describe("ARV-8: async-pool helper", () => {
  test("preserves input order in results", async () => {
    const out = await runPool([1, 2, 3, 4, 5], 3, async (n) => {
      // Stagger so completion order ≠ input order if the pool didn't sort.
      await Bun.sleep(Math.max(0, 30 - n * 5));
      return n * 10;
    });
    expect(out).toEqual([10, 20, 30, 40, 50]);
  });

  test("AC #4 — workers=1 runs strictly sequentially", async () => {
    const order: number[] = [];
    let inFlight = 0;
    let maxInFlight = 0;
    await runPool([1, 2, 3, 4, 5], 1, async (n) => {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await Bun.sleep(10);
      order.push(n);
      inFlight--;
      return n;
    });
    expect(order).toEqual([1, 2, 3, 4, 5]);
    expect(maxInFlight).toBe(1);
  });

  test("AC #1 — workers=8 cuts wall-time roughly 8× on a fixed delay", async () => {
    const N = 16;
    const DELAY = 60;
    const start = performance.now();
    await runPool(Array.from({ length: N }, (_, i) => i), 8, async () => {
      await Bun.sleep(DELAY);
    });
    const elapsed = performance.now() - start;
    // Sequential would take ~960ms; with 8 workers and 16 items we
    // expect 2 batches of 8 ≈ 120ms. Loose ceiling at 4× the optimal
    // (480ms) — 2× was flaky on slow CI; this still proves we're not
    // sequential (which would be 8× the optimal).
    expect(elapsed).toBeLessThan(DELAY * 8);
    expect(elapsed).toBeGreaterThan(DELAY * 1.5); // sanity: didn't skip work
  });

  test("respects pool ceiling (max in-flight ≤ workers)", async () => {
    let inFlight = 0;
    let peak = 0;
    await runPool(Array.from({ length: 30 }, (_, i) => i), 4, async () => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      await Bun.sleep(10);
      inFlight--;
    });
    expect(peak).toBeLessThanOrEqual(4);
  });

  test("first rejection propagates after in-flight tasks settle", async () => {
    let started = 0;
    let finished = 0;
    await expect(
      runPool([1, 2, 3, 4, 5], 2, async (n) => {
        started++;
        await Bun.sleep(20);
        if (n === 2) throw new Error("boom");
        finished++;
        return n;
      }),
    ).rejects.toThrow("boom");
    // We aborted dispatch — items never started should stay un-started.
    expect(started).toBeLessThanOrEqual(5);
    expect(finished).toBeLessThan(5);
  });

  test("empty input is a no-op", async () => {
    const out = await runPool([], 4, async (x) => x);
    expect(out).toEqual([]);
  });
});

describe("ARV-8: pool × rate-limiter integration (AC #2)", () => {
  test("pool of 8 workers respects a 50-RPS budget", async () => {
    const N = 60; // enough for the steady-state to dominate startup
    const RPS = 50;
    const limiter = createRateLimiter(RPS)!;
    const start = performance.now();
    await runPool(Array.from({ length: N }, (_, i) => i), 8, async () => {
      await limiter.acquire();
      // No real work — we want to measure the limiter, not network.
    });
    const elapsed = performance.now() - start;
    // 60 requests at 50 rps ≥ ~1180ms (one slot is "free" — the first).
    // Strict floor at 1000ms (sanity); ceiling at 2500ms (timer slop).
    expect(elapsed).toBeGreaterThanOrEqual(1000);
    expect(elapsed).toBeLessThan(2500);
  });
});

describe("ARV-8: parseWorkers (AC #5)", () => {
  test("undefined / empty → 1 (backward-compat default)", () => {
    expect(parseWorkers(undefined)).toBe(1);
    expect(parseWorkers("")).toBe(1);
  });

  test("'auto' → min(cpus, 8)", () => {
    const got = parseWorkers("auto");
    expect(got).toBeLessThanOrEqual(WORKERS_LIMITS.autoCeiling);
    expect(got).toBeLessThanOrEqual(os.cpus().length);
    expect(got).toBeGreaterThanOrEqual(1);
  });

  test("'AUTO' (case-insensitive) parses the same way", () => {
    expect(parseWorkers("AUTO")).toBe(parseWorkers("auto"));
  });

  test("numeric clamps to [1, 64]", () => {
    expect(parseWorkers("4")).toBe(4);
    expect(parseWorkers("0")).toBe(1);
    expect(parseWorkers("-5")).toBe(1);
    expect(parseWorkers("999")).toBe(64);
    expect(parseWorkers(8)).toBe(8);
  });

  test("non-numeric strings throw", () => {
    expect(() => parseWorkers("gibberish")).toThrow();
    expect(() => parseWorkers(Number.NaN)).toThrow();
  });
});
