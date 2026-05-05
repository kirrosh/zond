import type { OpenAPIV3 } from "openapi-types";
import type { Issue, RuleId, Severity, LintConfig, LintResult } from "./types.ts";
import { walk } from "./walker.ts";
import { matchGlob } from "./config.ts";
import { runConsistencyRules } from "./rules/consistency.ts";
import {
  runParamStrictnessRules,
  runResponseStrictnessRules,
  runRequestBodyStrictnessRules,
  runSchemaStrictnessRules,
} from "./rules/strictness.ts";
import {
  runParamHeuristics,
  runSchemaHeuristics,
  runRequestBodyHeuristics,
} from "./rules/heuristics.ts";
import { RULE_AFFECTS } from "./affects.ts";

export type { Issue, LintConfig, LintResult, LintStats, Severity, RuleId } from "./types.ts";
export { loadConfig, defaultConfig } from "./config.ts";
export { formatHuman, formatNdjson } from "./reporter.ts";

export function lintSpec(doc: OpenAPIV3.Document, config: LintConfig): LintResult {
  const issues: Issue[] = [];
  const endpoints = new Set<string>();

  const sink = {
    push(rule: RuleId, severity: Severity, message: string, opts: { jsonpointer: string; path?: string; method?: string; fix_hint?: string }) {
      const setting = config.rules[rule];
      if (setting === "off" || setting === undefined) return;

      // Path-include / ignore filters operate on opts.path when present.
      if (opts.path) {
        if (config.ignore_paths.some(g => matchGlob(g, opts.path!))) return;
        if (config.include_paths && config.include_paths.length > 0
            && !config.include_paths.some(g => matchGlob(g, opts.path!))) return;
      }

      const issue: Issue = {
        rule,
        severity: setting as Severity,
        jsonpointer: opts.jsonpointer,
        message,
      };
      if (opts.path) issue.path = opts.path;
      if (opts.method && opts.method !== "*") issue.method = opts.method;
      if (opts.fix_hint) issue.fix_hint = opts.fix_hint;
      const aff = RULE_AFFECTS[rule];
      if (aff && aff.length > 0) issue.affects = aff;

      if (opts.path) endpoints.add(`${opts.method ?? ""} ${opts.path}`);

      issues.push(issue);
    },
  };

  walk(doc, ctx => {
    if (config.max_issues && issues.length >= config.max_issues) return;
    switch (ctx.kind) {
      case "parameter":
        runParamStrictnessRules(ctx, sink, config.heuristics);
        runParamHeuristics(ctx, sink, config.heuristics);
        break;
      case "response":
        runResponseStrictnessRules(ctx, sink);
        break;
      case "requestBody":
        runRequestBodyStrictnessRules(ctx, sink);
        runRequestBodyHeuristics(ctx, sink, config.heuristics);
        break;
      case "schema":
        runConsistencyRules(ctx, sink);
        runSchemaStrictnessRules(ctx, sink);
        runSchemaHeuristics(ctx, sink, config.heuristics);
        break;
    }
  });

  // Trim to max_issues if exceeded mid-walk
  const trimmed = config.max_issues ? issues.slice(0, config.max_issues) : issues;

  const stats = {
    total: trimmed.length,
    high: trimmed.filter(i => i.severity === "high").length,
    medium: trimmed.filter(i => i.severity === "medium").length,
    low: trimmed.filter(i => i.severity === "low").length,
    endpoints: endpoints.size,
  };
  return { issues: trimmed, stats };
}
