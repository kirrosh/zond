import { describe, test, expect, afterEach } from "bun:test";
import { runSuite, reserveRequest, MAX_REQUESTS_SKIP_REASON } from "../../src/core/runner/executor.ts";
import type { TestSuite } from "../../src/core/parser/types.ts";
import { DEFAULT_CONFIG } from "../../src/core/parser/schema.ts";
import { mockFetchSequence, restoreFetch } from "../_helpers/fetch-mock";

afterEach(restoreFetch);

describe("reserveRequest", () => {
  test("returns true while budget remains", () => {
    const b = { limit: 2, used: 0 };
    expect(reserveRequest(b)).toBe(true);
    expect(reserveRequest(b)).toBe(true);
    expect(reserveRequest(b)).toBe(false);
    expect(b.used).toBe(2);
  });
  test("undefined budget never throttles", () => {
    expect(reserveRequest(undefined)).toBe(true);
  });
});

describe("--max-requests cap", () => {
  test("stops issuing HTTP requests at the cap and skips remaining steps", async () => {
    mockFetchSequence([
      { status: 200, body: { ok: 1 } },
      { status: 200, body: { ok: 2 } },
      { status: 200, body: { ok: 3 } },
    ]);

    const suite: TestSuite = {
      name: "five-steps",
      config: DEFAULT_CONFIG,
      tests: [1, 2, 3, 4, 5].map((i) => ({
        name: `step-${i}`,
        method: "GET" as const,
        path: `http://example.com/x?n=${i}`,
        expect: { status: 200 },
      })),
    };

    const budget = { limit: 2, used: 0 };
    const result = await runSuite(suite, {}, false, { requestBudget: budget });

    expect(result.total).toBe(5);
    expect(result.passed).toBe(2);
    expect(result.skipped).toBe(3);
    expect(budget.used).toBe(2);
    for (const skipped of result.steps.slice(2)) {
      expect(skipped.status).toBe("skip");
      expect(skipped.error).toBe(MAX_REQUESTS_SKIP_REASON);
    }
  });

  test("onStepDone fires for every step including skipped ones", async () => {
    mockFetchSequence([{ status: 200, body: {} }]);
    const suite: TestSuite = {
      name: "two-steps",
      config: DEFAULT_CONFIG,
      tests: [
        { name: "a", method: "GET", path: "http://x/a", expect: { status: 200 } },
        { name: "b", method: "GET", path: "http://x/b", expect: { status: 200 } },
      ],
    };

    const seen: string[] = [];
    await runSuite(suite, {}, false, {
      requestBudget: { limit: 1, used: 0 },
      onStepDone: (s) => { seen.push(`${s.name}:${s.status}`); },
    });
    expect(seen).toEqual(["a:pass", "b:skip"]);
  });
});
