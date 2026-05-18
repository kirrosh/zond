/**
 * ARV-292 — `--budget {quick,standard,full}` adaptive cap & stateful gating
 * resolved through `resolveBudget` and applied by `runChecks`. Uses the
 * apis/_mock testbed so the regression is fully offline and the 60-sec gate
 * for `quick` is verifiable in real wall-clock.
 */
import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { join } from "node:path";

import { runChecks } from "../../src/core/checks/index.ts";
import { resolveBudget } from "../../src/core/checks/budget.ts";
import { startMockServer, type MockServer } from "../../apis/_mock/server.ts";

const SPEC_PATH = join(import.meta.dir, "..", "..", "apis", "_mock", "spec.json");

let srv: MockServer;
beforeAll(() => { srv = startMockServer({ port: 0 }); });
afterAll(async () => { await srv.stop(); });

describe("ARV-292 — budget tier gating", () => {
  test("quick caps cases at 50 and skips stateful checks under 60-sec wall-clock", async () => {
    const resolved = resolveBudget("quick", undefined);
    const t0 = Date.now();
    const result = await runChecks({
      specPath: SPEC_PATH,
      baseUrl: srv.baseUrl,
      maxRequests: resolved.maxRequests,
      skipStateful: resolved.skipStateful,
      timeoutMs: 5_000,
    });
    const elapsedMs = Date.now() - t0;
    expect(result.data.summary.cases).toBeLessThanOrEqual(50);
    expect(elapsedMs).toBeLessThan(60_000);
    const skippedKeys = Object.keys(result.data.summary.skipped_outcomes);
    expect(skippedKeys.some((k) => k === "stateful-skipped:budget")).toBe(true);
  });

  test("standard caps cases at 500 and keeps stateful active", async () => {
    const resolved = resolveBudget("standard", undefined);
    const result = await runChecks({
      specPath: SPEC_PATH,
      baseUrl: srv.baseUrl,
      maxRequests: resolved.maxRequests,
      skipStateful: resolved.skipStateful,
      timeoutMs: 5_000,
    });
    expect(result.data.summary.cases).toBeLessThanOrEqual(500);
    const skippedKeys = Object.keys(result.data.summary.skipped_outcomes);
    expect(skippedKeys.some((k) => k === "stateful-skipped:budget")).toBe(false);
  });

  test("--max-requests override wins over quick tier cap", async () => {
    const resolved = resolveBudget("quick", 200);
    expect(resolved.maxRequests).toBe(200);
    const result = await runChecks({
      specPath: SPEC_PATH,
      baseUrl: srv.baseUrl,
      maxRequests: resolved.maxRequests,
      skipStateful: resolved.skipStateful,
      timeoutMs: 5_000,
    });
    expect(result.data.summary.cases).toBeLessThanOrEqual(200);
  });

  test("omitted budget keeps legacy uncapped behaviour (no stateful-skip surface)", async () => {
    const resolved = resolveBudget(undefined, undefined);
    expect(resolved.maxRequests).toBeUndefined();
    expect(resolved.skipStateful).toBe(false);
    const result = await runChecks({
      specPath: SPEC_PATH,
      baseUrl: srv.baseUrl,
      skipStateful: resolved.skipStateful,
      timeoutMs: 5_000,
    });
    const skippedKeys = Object.keys(result.data.summary.skipped_outcomes);
    expect(skippedKeys.some((k) => k === "stateful-skipped:budget")).toBe(false);
  });
});
