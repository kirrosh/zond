/**
 * ARV-301: audit's coverage stage must pin --session-id when an active
 * session was captured before session-end, not --union session — the
 * latter selector rejects closed sessions and the stage would always
 * fail (zond-scans Stripe scan exposed it on every run).
 */
import { describe, test, expect } from "bun:test";
import { buildCoverageStageArgs, interpretCoverageOutput } from "../../src/cli/commands/audit.ts";

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

describe("ARV-301 follow-up: interpretCoverageOutput judges audit stage on envelope.ok, not exit", () => {
  const okEnvelope = '{"ok":true,"command":"coverage","data":{"covered":42,"total":100,"runId":7}}';

  test("exit 0 + ok:true envelope → captured (legacy happy path)", () => {
    const { data, parseError } = interpretCoverageOutput(okEnvelope, 0);
    expect(parseError).toBeNull();
    expect((data as { ok: boolean })?.ok).toBe(true);
  });

  test("exit 1 + ok:true envelope → STILL captured (has uncovered endpoints, not a failure)", () => {
    // This is the case that broke ARV-301: `zond coverage` returned
    // exit 1 because uncoveredRows.length > 0, audit reported the
    // stage as failed even though the envelope was valid and ok:true.
    const { data, parseError } = interpretCoverageOutput(okEnvelope, 1);
    expect(parseError).toBeNull();
    expect(data).not.toBeNull();
    expect((data as { ok: boolean }).ok).toBe(true);
  });

  test("exit 1 + ok:false envelope → real failure (e.g. no runs match)", () => {
    const errEnvelope = '{"ok":false,"command":"coverage","data":null,"errors":[{"code":"x","message":"No runs match"}]}';
    const { data, parseError } = interpretCoverageOutput(errEnvelope, 1);
    expect(parseError).toBeNull();
    expect(data).toBeNull();
  });

  test("non-JSON output → propagates parse error", () => {
    const { data, parseError } = interpretCoverageOutput("not json", 2);
    expect(data).toBeNull();
    expect(parseError).not.toBeNull();
  });

  test("empty output → no data, no parse error", () => {
    const { data, parseError } = interpretCoverageOutput("", 2);
    expect(data).toBeNull();
    expect(parseError).toBeNull();
  });
});
