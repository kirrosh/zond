import { describe, test, expect } from "bun:test";
import { countCleanupFailures, printMutationBanner } from "../../../src/core/probe/shared.ts";

describe("countCleanupFailures (TASK-259)", () => {
  test("counts attempted cleanup with non-404 4xx as failure", () => {
    expect(countCleanupFailures([
      { cleanup: { attempted: true, status: 403 } },
      { cleanup: { attempted: true, status: 422 } },
    ])).toBe(2);
  });

  test("treats 404 as success (resource already gone)", () => {
    expect(countCleanupFailures([
      { cleanup: { attempted: true, status: 404 } },
      { cleanup: { attempted: true, status: 200 } },
    ])).toBe(0);
  });

  test("counts cleanup with error message as failure", () => {
    expect(countCleanupFailures([
      { cleanup: { attempted: true, error: "fetch failed: ECONNRESET" } },
    ])).toBe(1);
  });

  test("counts 5xx as failure", () => {
    expect(countCleanupFailures([
      { cleanup: { attempted: true, status: 500 } },
      { cleanup: { attempted: true, status: 502 } },
    ])).toBe(2);
  });

  test("ignores cleanup that wasn't attempted", () => {
    expect(countCleanupFailures([
      { cleanup: { attempted: false, error: "no DELETE counterpart" } },
    ])).toBe(0);
  });

  test("ignores verdicts with no cleanup field", () => {
    expect(countCleanupFailures([
      { },
      { cleanup: { attempted: true, status: 200 } },
    ])).toBe(0);
  });

  test("empty list returns 0", () => {
    expect(countCleanupFailures([])).toBe(0);
  });
});

describe("printMutationBanner (TASK-259)", () => {
  // Capture stderr writes so we can assert content without polluting output.
  function captureStderr(fn: () => void): string {
    const orig = process.stderr.write.bind(process.stderr);
    let buf = "";
    (process.stderr as unknown as { write: (chunk: string) => boolean }).write = (chunk: string) => {
      buf += chunk;
      return true;
    };
    try { fn(); } finally {
      (process.stderr as unknown as { write: typeof orig }).write = orig;
    }
    return buf;
  }

  test("prints banner with probe name + recovery hint", () => {
    const out = captureStderr(() => {
      printMutationBanner("probe-test", { base_url: "https://x" });
    });
    expect(out).toContain("probe-test mutates live data");
    expect(out).toContain("zond discover --api");
    expect(out).toContain("--no-cleanup");
  });

  test("lists FK-shaped fixture keys (truncated to 8)", () => {
    const vars: Record<string, string> = { base_url: "u", auth_token: "t" };
    for (let i = 0; i < 10; i++) vars[`item${i}_id`] = String(i);
    const out = captureStderr(() => printMutationBanner("p", vars));
    expect(out).toContain("FK fixtures that may go stale");
    // includes some _id keys, plus auth_token (matches _token suffix)
    expect(out).toContain("item0_id");
    expect(out).toContain("auth_token");
    // truncation marker since >8 fk-shaped keys
    expect(out).toMatch(/\+\d+ more/);
  });

  test("omits 'FK fixtures that may go stale' list when no fixture-shaped keys", () => {
    const out = captureStderr(() => printMutationBanner("p", { base_url: "u" }));
    // Recovery hint always mentions "FK fixtures"; the list line ("that may go
    // stale: …") is the one we want to suppress when there's nothing to list.
    expect(out).not.toContain("that may go stale");
  });

  test("quiet=true suppresses output", () => {
    const out = captureStderr(() => printMutationBanner("p", { x: "y" }, { quiet: true }));
    expect(out).toBe("");
  });
});
