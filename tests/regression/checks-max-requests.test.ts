/**
 * ARV-227 — `--max-requests` cap stops `checks run` from blowing past
 * the requested HTTP budget on big specs (github / kubernetes / large
 * stripe). Reuses the apis/_mock testbed so the assertion is fully
 * offline.
 */
import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { join } from "node:path";

import { runChecks } from "../../src/core/checks/index.ts";
import { startMockServer, type MockServer } from "../../apis/_mock/server.ts";

const SPEC_PATH = join(import.meta.dir, "..", "..", "apis", "_mock", "spec.json");

let srv: MockServer;
beforeAll(() => { srv = startMockServer({ port: 0 }); });
afterAll(async () => { await srv.stop(); });

describe("ARV-227 — checks run honors --max-requests cap", () => {
  test("budget=1 stops further per-response cases and surfaces the skip reason", async () => {
    const result = await runChecks({
      specPath: SPEC_PATH,
      baseUrl: srv.baseUrl,
      // status_code_conformance fires per response; spec has 5 ops, so a
      // cap of 1 must short-circuit the remaining cases.
      include: ["status_code_conformance"],
      maxRequests: 1,
      timeoutMs: 5_000,
    });
    expect(result.data.summary.cases).toBeLessThanOrEqual(1);
    const skippedKeys = Object.keys(result.data.summary.skipped_outcomes);
    expect(skippedKeys.some((k) => k.includes("max-requests-cap-reached"))).toBe(true);
  });

  test("uncapped run produces strictly more cases than budget=1", async () => {
    const capped = await runChecks({
      specPath: SPEC_PATH,
      baseUrl: srv.baseUrl,
      include: ["status_code_conformance"],
      maxRequests: 1,
      timeoutMs: 5_000,
    });
    const uncapped = await runChecks({
      specPath: SPEC_PATH,
      baseUrl: srv.baseUrl,
      include: ["status_code_conformance"],
      timeoutMs: 5_000,
    });
    expect(uncapped.data.summary.cases).toBeGreaterThan(capped.data.summary.cases);
  });
});
