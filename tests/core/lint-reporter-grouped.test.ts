import { describe, test, expect } from "bun:test";
import { buildRuleSummary, formatGrouped } from "../../src/core/lint/reporter.ts";
import type { Issue, LintStats } from "../../src/core/lint/types.ts";

// TASK-279: rule × severity rollup. Verifies the buildRuleSummary aggregation
// (deterministic ordering, endpoint dedupe) and that formatGrouped collapses
// many issues into a compact summary.

function issue(rule: string, severity: "high" | "medium" | "low", path: string, message: string): Issue {
  return { rule: rule as Issue["rule"], severity, path, method: "GET", jsonpointer: `#/paths/${path}/get`, message, recommended_action: "fix_spec" };
}

describe("buildRuleSummary (TASK-279)", () => {
  test("groups by rule × severity, dedupes endpoints, sorts severity desc / count desc", () => {
    const issues: Issue[] = [
      issue("B1", "high", "/a", "path-param missing format/pattern"),
      issue("B1", "high", "/b", "path-param missing format/pattern"),
      issue("B1", "high", "/a", "path-param missing format/pattern"), // duplicate endpoint, second occurrence on same row counts but only 1 endpoint
      issue("B6", "low", "/c", "field 'email' missing format"),
      issue("B7", "high", "/d", "additionalProperties not set"),
    ];

    const summary = buildRuleSummary(issues);
    // Severity order: high before low; within high, B1 (count 3) before B7 (count 1).
    expect(summary.map(r => r.rule)).toEqual(["B1", "B7", "B6"]);
    expect(summary[0]).toMatchObject({ rule: "B1", severity: "high", count: 3, endpoints: 2 });
    expect(summary[1]).toMatchObject({ rule: "B7", severity: "high", count: 1, endpoints: 1 });
    expect(summary[2]).toMatchObject({ rule: "B6", severity: "low",  count: 1, endpoints: 1 });
  });

  test("formatGrouped renders one row per (rule, severity) and respects --top", () => {
    const stats: LintStats = { total: 5, high: 4, medium: 0, low: 1, endpoints: 4 };
    const issues = [
      issue("B1", "high", "/a", "msg-b1"),
      issue("B1", "high", "/b", "msg-b1"),
      issue("B1", "high", "/c", "msg-b1"),
      issue("B7", "high", "/d", "msg-b7"),
      issue("B6", "low",  "/e", "msg-b6"),
    ];

    const allOut = formatGrouped(issues, stats);
    // 1 HIGH header + B1 row + B7 row + 1 LOW header + B6 row + blank + summary line.
    expect(allOut.split("\n").filter(l => l.trim().length > 0)).toHaveLength(6);
    expect(allOut).toContain("B1");
    expect(allOut).toContain("B7");
    expect(allOut).toContain("B6");
    expect(allOut).toMatch(/Re-run with --verbose/);

    const topOut = formatGrouped(issues, stats, { top: 1 });
    expect(topOut).toContain("B1");
    expect(topOut).not.toContain("B7");
    expect(topOut).not.toContain("B6");
    expect(topOut).toMatch(/showing top 1 of 3 rules/);
  });

  test("empty issues — clean banner", () => {
    const stats: LintStats = { total: 0, high: 0, medium: 0, low: 0, endpoints: 0 };
    expect(formatGrouped([], stats)).toContain("no issues");
  });
});
