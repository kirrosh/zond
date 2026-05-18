/**
 * ARV-301: audit's coverage stage must pin --session-id when an active
 * session was captured before session-end, not --union session — the
 * latter selector rejects closed sessions and the stage would always
 * fail (zond-scans Stripe scan exposed it on every run).
 */
import { describe, test, expect } from "bun:test";
import { buildCoverageStageArgs } from "../../src/cli/commands/audit.ts";

describe("ARV-301: audit coverage stage args", () => {
  test("session id captured → coverage gets --session-id (not --union session)", () => {
    const args = buildCoverageStageArgs("stripe", "session-abc-123");
    expect(args).toEqual([
      "coverage", "--api", "stripe",
      "--session-id", "session-abc-123",
      "--json",
    ]);
    expect(args).not.toContain("--union");
  });

  test("no session id → falls back to --union session (back-compat)", () => {
    const args = buildCoverageStageArgs("stripe");
    expect(args).toEqual([
      "coverage", "--api", "stripe",
      "--union", "session",
      "--json",
    ]);
  });
});
