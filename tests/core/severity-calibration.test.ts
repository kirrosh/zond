/**
 * ARV-283 Phase A: severity calibration tests.
 *
 * Covers: config validation, condition matcher, calibrator orchestrator.
 * Loader (disk I/O) covered separately in severity-loader.test.ts.
 */
import { describe, expect, it } from "bun:test";

import { mergeConfigs, validateConfig, type SeverityConfig } from "../../src/core/severity/config.ts";
import { matchesAll, type MatchContext } from "../../src/core/severity/matcher.ts";
import { calibrate } from "../../src/core/severity/calibrator.ts";

// ─── validateConfig ──────────────────────────────────────────────────

describe("validateConfig", () => {
  it("empty object → no errors (config is opt-in)", () => {
    expect(validateConfig(null, "test.yaml")).toEqual([]);
    expect(validateConfig(undefined, "test.yaml")).toEqual([]);
  });

  it("missing version → error", () => {
    const errs = validateConfig({}, "test.yaml");
    expect(errs).toHaveLength(1);
    expect(errs[0]!.keyPath).toBe("version");
    expect(errs[0]!.message).toContain("required");
  });

  it("wrong version → error with expected value in message", () => {
    const errs = validateConfig({ version: 2 }, "test.yaml");
    expect(errs.find((e) => e.keyPath === "version")?.message).toContain("expected 1");
  });

  it("invalid severity → error names the enum", () => {
    const errs = validateConfig({ version: 1, checks: { foo: { severity: "mid" } } }, "test.yaml");
    expect(errs[0]!.keyPath).toBe("checks.foo.severity");
    expect(errs[0]!.message).toContain("high|medium|low|info");
  });

  it("by_action invalid severity → error names the action path", () => {
    const errs = validateConfig(
      { version: 1, checks: { foo: { by_action: { fix_spec: "huge" } } } },
      "test.yaml",
    );
    expect(errs[0]!.keyPath).toBe("checks.foo.by_action.fix_spec");
  });

  it("suppression missing check/when/reason → multiple errors", () => {
    const errs = validateConfig({ version: 1, suppressions: [{}] }, "test.yaml");
    const paths = errs.map((e) => e.keyPath).sort();
    expect(paths).toContain("suppressions[0].check");
    expect(paths).toContain("suppressions[0].reason");
    expect(paths).toContain("suppressions[0].when");
  });

  it("empty when: rejected — would silently suppress all findings from check", () => {
    const errs = validateConfig(
      { version: 1, suppressions: [{ check: "foo", reason: "x", when: {} }] },
      "test.yaml",
    );
    expect(errs[0]!.keyPath).toBe("suppressions[0].when");
    expect(errs[0]!.message).toMatch(/at least one condition/);
  });

  it("multiple operator keys in one condition → error", () => {
    const errs = validateConfig(
      {
        version: 1,
        suppressions: [
          {
            check: "foo",
            reason: "x",
            when: { "response.status": { equals: 400, contains: "x" } },
          },
        ],
      },
      "test.yaml",
    );
    expect(errs[0]!.keyPath).toBe("suppressions[0].when.response.status");
    expect(errs[0]!.message).toMatch(/exactly one operator/);
  });

  it("invalid regex → error with parse details", () => {
    const errs = validateConfig(
      {
        version: 1,
        suppressions: [
          {
            check: "foo",
            reason: "x",
            when: { "response.status": { matches: "[unclosed" } },
          },
        ],
      },
      "test.yaml",
    );
    expect(errs[0]!.keyPath).toBe("suppressions[0].when.response.status.matches");
    expect(errs[0]!.message).toContain("invalid regex");
  });

  it("valid config → no errors", () => {
    const cfg: SeverityConfig = {
      version: 1,
      checks: {
        rate_limit_headers_absent: { severity: "low" },
        negative_data_rejection: { by_action: { tighten_validation: "medium" } },
      },
      suppressions: [
        {
          check: "rate_limit_headers_absent",
          when: { "response.headers.Stripe-Should-Retry": { present: true } },
          reason: "Stripe vendor header alternative",
        },
      ],
    };
    expect(validateConfig(cfg, "test.yaml")).toEqual([]);
  });
});

// ─── matchesAll ──────────────────────────────────────────────────────

function ctx(overrides: Partial<MatchContext> = {}): MatchContext {
  return {
    finding: { check: "foo", recommended_action: "fix_spec", message: "hello", ...overrides.finding },
    operation: { method: "POST", path: "/v1/things", ...overrides.operation },
    response: { status: 400, headers: {}, ...overrides.response },
  };
}

describe("matchesAll", () => {
  it("empty conds → true (caller rejects empty at validation)", () => {
    expect(matchesAll({}, ctx())).toBe(true);
  });

  it("scalar literal = equals", () => {
    expect(matchesAll({ "response.status": 400 }, ctx())).toBe(true);
    expect(matchesAll({ "response.status": 500 }, ctx())).toBe(false);
  });

  it("number ↔ string coercion for status-like fields", () => {
    expect(matchesAll({ "response.status": "400" }, ctx())).toBe(true);
    expect(matchesAll({ "response.status": { equals: "400" } }, ctx())).toBe(true);
  });

  it("present / absent on headers (case-insensitive)", () => {
    const c = ctx({ response: { status: 200, headers: { "X-Foo": "bar" } } });
    expect(matchesAll({ "response.headers.x-foo": { present: true } }, c)).toBe(true);
    expect(matchesAll({ "response.headers.X-Foo": { present: true } }, c)).toBe(true);
    expect(matchesAll({ "response.headers.x-missing": { absent: true } }, c)).toBe(true);
    expect(matchesAll({ "response.headers.x-foo": { absent: true } }, c)).toBe(false);
  });

  it("contains on string", () => {
    expect(matchesAll({ "finding.message": { contains: "hell" } }, ctx())).toBe(true);
    expect(matchesAll({ "finding.message": { contains: "xyz" } }, ctx())).toBe(false);
  });

  it("matches regex", () => {
    expect(matchesAll({ "operation.path_regex": { matches: "^/v1/things$" } }, ctx())).toBe(true);
    expect(matchesAll({ "operation.path_regex": { matches: "^/v2/" } }, ctx())).toBe(false);
  });

  it("in operator", () => {
    expect(matchesAll({ "response.status": { in: [400, 422, 404] } }, ctx())).toBe(true);
    expect(matchesAll({ "response.status": { in: [500, 502] } }, ctx())).toBe(false);
  });

  it("AND semantics — all conditions must match", () => {
    const conds = {
      "response.status": 400,
      "operation.method": "POST",
    };
    expect(matchesAll(conds, ctx())).toBe(true);
    expect(matchesAll({ ...conds, "operation.method": "GET" }, ctx())).toBe(false);
  });

  it("evidence.<deep.path> traversal", () => {
    const c = ctx({
      finding: {
        check: "foo",
        evidence: { mutation: { boundary: "additionalProperties-violation", phase: "coverage" } },
      },
    });
    expect(
      matchesAll(
        { "evidence.mutation.boundary": "additionalProperties-violation" },
        c,
      ),
    ).toBe(true);
    expect(matchesAll({ "evidence.missing.path": { absent: true } }, c)).toBe(true);
  });
});

// ─── calibrate ───────────────────────────────────────────────────────

describe("calibrate", () => {
  const baseCtx = ctx();

  it("empty merged config → returns default severity", () => {
    const result = calibrate(
      { check: "foo", defaultSeverity: "high", context: baseCtx },
      { checks: {}, suppressions: [] },
    );
    expect(result.severity).toBe("high");
    expect(result.suppressed).toBe(false);
    expect(result.trace.kind).toBe("default");
  });

  it("per-check severity override wins over default", () => {
    const result = calibrate(
      { check: "rate_limit_headers_absent", defaultSeverity: "medium", context: baseCtx },
      {
        checks: { rate_limit_headers_absent: { severity: "low" } },
        suppressions: [],
      },
    );
    expect(result.severity).toBe("low");
    expect(result.trace.kind).toBe("override");
  });

  it("by_action wins over severity override when action matches", () => {
    const result = calibrate(
      {
        check: "negative_data_rejection",
        defaultSeverity: "high",
        recommendedAction: "tighten_validation",
        context: baseCtx,
      },
      {
        checks: {
          negative_data_rejection: {
            severity: "low", // base override
            by_action: { tighten_validation: "medium" }, // wins for this action
          },
        },
        suppressions: [],
      },
    );
    expect(result.severity).toBe("medium");
    expect(result.trace.kind).toBe("by_action");
  });

  it("by_action falls through to severity override when no action match", () => {
    const result = calibrate(
      {
        check: "negative_data_rejection",
        defaultSeverity: "high",
        recommendedAction: "report_backend_bug",
        context: baseCtx,
      },
      {
        checks: {
          negative_data_rejection: {
            severity: "low",
            by_action: { tighten_validation: "medium" },
          },
        },
        suppressions: [],
      },
    );
    expect(result.severity).toBe("low");
    expect(result.trace.kind).toBe("override");
  });

  it("suppression: severity → info + trace, suppressed: true", () => {
    const result = calibrate(
      { check: "rate_limit_headers_absent", defaultSeverity: "medium", context: baseCtx },
      {
        checks: {},
        suppressions: [
          {
            check: "rate_limit_headers_absent",
            when: { "response.status": 400 },
            reason: "Stripe alt header",
            sourceFile: "/tmp/severity.yaml",
            index: 0,
          },
        ],
      },
    );
    expect(result.severity).toBe("info");
    expect(result.suppressed).toBe(true);
    expect(result.trace.kind).toBe("suppressed");
    expect(result.trace.reason).toBe("Stripe alt header");
    expect(result.trace.source).toBe("/tmp/severity.yaml");
  });

  it("suppression: first matching rule wins (skips non-matching ones above)", () => {
    const result = calibrate(
      { check: "rate_limit_headers_absent", defaultSeverity: "medium", context: baseCtx },
      {
        checks: {},
        suppressions: [
          {
            check: "rate_limit_headers_absent",
            when: { "response.status": 500 }, // won't match (ctx is 400)
            reason: "first",
            sourceFile: "a.yaml",
            index: 0,
          },
          {
            check: "rate_limit_headers_absent",
            when: { "response.status": 400 },
            reason: "second",
            sourceFile: "b.yaml",
            index: 1,
          },
        ],
      },
    );
    expect(result.trace.reason).toBe("second");
    expect(result.trace.ruleIndex).toBe(1);
  });

  it("suppression check id mismatch → no suppression", () => {
    const result = calibrate(
      { check: "other_check", defaultSeverity: "high", context: baseCtx },
      {
        checks: {},
        suppressions: [
          {
            check: "rate_limit_headers_absent",
            when: { "response.status": 400 },
            reason: "x",
            sourceFile: "a.yaml",
            index: 0,
          },
        ],
      },
    );
    expect(result.severity).toBe("high");
    expect(result.suppressed).toBe(false);
  });
});

// ─── mergeConfigs ────────────────────────────────────────────────────

describe("mergeConfigs", () => {
  it("later workspace overrides earlier per-key", () => {
    const merged = mergeConfigs([
      {
        source: "ws.yaml",
        config: { version: 1, checks: { foo: { severity: "high" } } },
      },
      {
        source: "api.yaml",
        config: { version: 1, checks: { foo: { severity: "low" } } },
      },
    ]);
    expect(merged.checks.foo!.severity).toBe("low");
  });

  it("by_action entries from later config merge into earlier", () => {
    const merged = mergeConfigs([
      {
        source: "ws.yaml",
        config: {
          version: 1,
          checks: { foo: { by_action: { fix_spec: "low" } } },
        },
      },
      {
        source: "api.yaml",
        config: {
          version: 1,
          checks: { foo: { by_action: { tighten_validation: "medium" } } },
        },
      },
    ]);
    expect(merged.checks.foo!.by_action).toEqual({
      fix_spec: "low",
      tighten_validation: "medium",
    });
  });

  it("suppressions union (additive), preserve source/index", () => {
    const merged = mergeConfigs([
      {
        source: "ws.yaml",
        config: {
          version: 1,
          suppressions: [
            { check: "a", when: { "response.status": 200 }, reason: "x" },
          ],
        },
      },
      {
        source: "api.yaml",
        config: {
          version: 1,
          suppressions: [
            { check: "b", when: { "response.status": 400 }, reason: "y" },
          ],
        },
      },
    ]);
    expect(merged.suppressions).toHaveLength(2);
    expect(merged.suppressions[0]!.sourceFile).toBe("ws.yaml");
    expect(merged.suppressions[1]!.sourceFile).toBe("api.yaml");
  });
});
