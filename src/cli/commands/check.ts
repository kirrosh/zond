/**
 * `zond check` — unified conformance entry point.
 *
 * `check tests <path>`  → schema-validate YAML test files (no HTTP).
 * `check spec [spec]`   → static-analyse the OpenAPI document.
 *
 * TASK-298 (m-13 block D): replaces the old top-level `validate` and
 * `lint-spec` commands with a single mental model.
 */

import { parse } from "../../core/parser/yaml-parser.ts";
import { readOpenApiSpec } from "../../core/generator/openapi-reader.ts";
import {
  lintSpec,
  loadConfig,
  formatHuman,
  formatNdjson,
  formatGrouped,
  buildRuleSummary,
} from "../../core/lint/index.ts";
import type { Issue, Severity } from "../../core/lint/index.ts";
import { getDb } from "../../db/schema.ts";
import { createLintRun, finalizeLintRun } from "../../db/lint-runs.ts";
import { jsonOk, jsonError, printJson, zerr } from "../json-envelope.ts";
import { printError, printSuccess } from "../output.ts";

import type { Command } from "commander";
import { globalJson, resolveSpecArg } from "../resolve.ts";
import { parsePositiveInt } from "../argv.ts";

// ── check tests ────────────────────────────────────────────────────────────

export interface CheckTestsOptions {
  path: string;
  json?: boolean;
  verbose?: boolean;
}

export async function checkTestsCommand(options: CheckTestsOptions): Promise<number> {
  try {
    const suites = await parse(options.path, { verbose: options.verbose });
    const totalSteps = suites.reduce((sum, s) => sum + s.tests.length, 0);
    if (options.json) {
      printJson(jsonOk("check tests", {
        files: suites.length,
        suites: suites.length,
        tests: totalSteps,
        valid: true,
      }));
    } else {
      printSuccess(`OK: ${suites.length} suite(s), ${totalSteps} test(s) validated successfully`);
    }
    return 0;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (options.json) {
      printJson(jsonError("check tests", [message]));
    } else {
      printError(message);
    }
    return 2;
  }
}

// ── check spec ─────────────────────────────────────────────────────────────

export interface CheckSpecOptions {
  specPath: string;
  json?: boolean;
  ndjson?: boolean;
  strict?: boolean;
  rule?: string;
  config?: string;
  includePath?: string[];
  maxIssues?: number;
  noDb?: boolean;
  verbose?: boolean;
  severityFilter?: Severity[];
  filterRule?: string[];
  top?: number;
}

export async function checkSpecCommand(opts: CheckSpecOptions): Promise<number> {
  let doc;
  try {
    doc = await readOpenApiSpec(opts.specPath);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (opts.json || opts.ndjson) {
      printJson(jsonError("check spec", [
        zerr("spec_load_failure", `Failed to load spec: ${message}`, { specPath: opts.specPath }),
      ]));
    } else {
      printError(`Failed to load spec: ${message}`);
    }
    return 2;
  }

  let config;
  try {
    config = loadConfig({
      configPath: opts.config,
      cliRule: opts.rule,
      includePaths: opts.includePath,
      maxIssues: opts.maxIssues,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (opts.json || opts.ndjson) {
      printJson(jsonError("check spec", [zerr("argument_invalid", message)]));
    } else {
      printError(message);
    }
    return 2;
  }

  let runId: number | null = null;
  if (!opts.noDb) {
    try {
      const db = getDb();
      runId = createLintRun(db, opts.specPath);
    } catch {
      runId = null;
    }
  }

  const result = lintSpec(doc, config);

  if (runId !== null) {
    try {
      finalizeLintRun(getDb(), runId, result.issues, result.stats, config);
    } catch {
      // best-effort
    }
  }

  const filtered = applyFilters(result.issues, opts);
  const filteredStats = recomputeStats(filtered);

  if (opts.ndjson) {
    process.stdout.write(formatNdjson(filtered));
  } else if (opts.json) {
    printJson(jsonOk("check spec", {
      issues: filtered,
      stats: filteredStats,
      summary: buildRuleSummary(filtered),
    }));
  } else if (opts.verbose) {
    process.stdout.write(formatHuman(filtered, filteredStats));
  } else {
    process.stdout.write(formatGrouped(filtered, filteredStats, { top: opts.top }));
  }

  if (result.stats.high > 0) return 1;
  if (result.stats.medium > 0) return 2;
  if (opts.strict && result.stats.low > 0) return 2;
  return 0;
}

function applyFilters(issues: Issue[], opts: CheckSpecOptions): Issue[] {
  let out = issues;
  if (opts.severityFilter && opts.severityFilter.length > 0) {
    const allow = new Set(opts.severityFilter);
    out = out.filter(i => allow.has(i.severity));
  }
  if (opts.filterRule && opts.filterRule.length > 0) {
    const allow = new Set(opts.filterRule.map(r => r.toUpperCase()));
    out = out.filter(i => allow.has(i.rule));
  }
  return out;
}

function recomputeStats(issues: Issue[]) {
  const endpoints = new Set<string>();
  for (const i of issues) {
    if (i.path) endpoints.add(`${i.method ?? "*"} ${i.path}`);
  }
  return {
    total: issues.length,
    high: issues.filter(i => i.severity === "high").length,
    medium: issues.filter(i => i.severity === "medium").length,
    low: issues.filter(i => i.severity === "low").length,
    endpoints: endpoints.size,
  };
}

function parseSeverityList(raw: unknown): Severity[] | undefined {
  if (typeof raw !== "string" || raw.trim() === "") return undefined;
  const allowed: Severity[] = ["high", "medium", "low"];
  const items = raw.split(",").map(s => s.trim().toLowerCase()).filter(Boolean) as Severity[];
  return items.filter(s => allowed.includes(s));
}

/**
 * TASK-291 / TASK-298: parse --rule (and the deprecated --filter-rule) into
 * the two downstream channels: cliRule (severity overrides + disables, fed
 * to loadConfig) and whitelist (rule-id allow-list, applied post-lint).
 */
export function mergeRuleFlags(
  ruleArg: unknown,
  filterRuleArg: unknown,
): { cliRule: string | undefined; whitelist: string[] | undefined } {
  const ruleItems = splitCsv(ruleArg);
  const filterItems = splitCsv(filterRuleArg);

  if (filterItems.length > 0) {
    process.stderr.write(
      "[zond] --filter-rule is deprecated, use --rule with the same comma-separated rule ids (TASK-291).\n",
    );
  }

  const cliRuleItems: string[] = [];
  const whitelist = new Set<string>();
  let anyPositive = false;

  for (const raw of ruleItems) {
    const item = raw.trim();
    if (!item) continue;
    if (item.startsWith("!")) {
      cliRuleItems.push(item);
      continue;
    }
    const eq = item.indexOf("=");
    if (eq >= 0) {
      const id = item.slice(0, eq).trim().toUpperCase();
      const sev = item.slice(eq + 1).trim().toLowerCase();
      if (sev === "off") {
        cliRuleItems.push(`!${id}`);
      } else {
        cliRuleItems.push(`${id}=${sev}`);
        whitelist.add(id);
        anyPositive = true;
      }
      continue;
    }
    whitelist.add(item.toUpperCase());
    anyPositive = true;
  }

  for (const raw of filterItems) {
    const id = raw.trim().toUpperCase();
    if (!id) continue;
    whitelist.add(id);
    anyPositive = true;
  }

  return {
    cliRule: cliRuleItems.length > 0 ? cliRuleItems.join(",") : undefined,
    whitelist: anyPositive ? [...whitelist] : undefined,
  };
}

function splitCsv(raw: unknown): string[] {
  if (typeof raw !== "string") return [];
  return raw.split(",").map(s => s.trim()).filter(Boolean);
}

// ── registration ───────────────────────────────────────────────────────────

export function registerCheck(program: Command): void {
  const check = program
    .command("check")
    .description("Conformance checks: YAML test files (`check tests`) and the OpenAPI spec (`check spec`)");

  check
    .command("tests <path>")
    .description("Schema-validate test files without running them")
    .option("--verbose", "Show full zod issue stack instead of human-friendly summary")
    .action(async (path: string, opts: { verbose?: boolean }, cmd: Command) => {
      process.exitCode = await checkTestsCommand({
        path,
        json: globalJson(cmd),
        verbose: opts.verbose === true,
      });
    });

  check
    .command("spec [spec]")
    .description("Static-analyse an OpenAPI spec for internal-consistency and strictness gaps (catches bugs before any HTTP)")
    .option("--api <name>", "Use the registered API's spec (apis/<name>/spec.json)")
    .option("--strict", "Exit non-zero even on LOW-severity issues")
    .option("--ndjson", "Stream issues as one JSON per line (NDJSON), instead of the wrapped envelope")
    .option(
      "--rule <list>",
      "Unified rule selector (TASK-291). Comma-separated items: 'B1' (whitelist), " +
      "'!B2' (disable), 'B3=high|medium|low' (severity override; also implicitly whitelists). " +
      "All-plain or all-override → whitelist mode (only these rules render). All-'!' → blacklist mode " +
      "(exclude these). Mixed → whitelist + overrides + disables together.",
    )
    .option(
      "--filter-rule <list>",
      "Deprecated alias for the whitelist subset of --rule (TASK-291). Will be removed; emits a stderr warning.",
    )
    .option("--config <path>", "Path to .zond-lint.json")
    .option("--include-path <glob...>", "Only lint endpoints whose path matches glob (repeatable)")
    .option("--max-issues <N>", "Stop after N issues", parsePositiveInt("--max-issues"))
    .option("--verbose, --flat", "Render the legacy flat one-line-per-issue list (default is now a rule × severity rollup, TASK-279)")
    .option("--severity <list>", "Filter rendered/JSON output to severities (comma-separated: high,medium,low)")
    .option("--top <N>", "In the grouped summary, show only the top-N rules by count", parsePositiveInt("--top"))
    .option("--no-db", "Don't write to lint_runs SQLite history")
    .action(async (specPos: string | undefined, opts, cmd: Command) => {
      const dbPath = typeof opts.db === "string" ? opts.db : undefined;
      const resolved = resolveSpecArg(specPos, opts.api, dbPath);
      if ("error" in resolved) { printError(resolved.error); process.exitCode = 2; return; }
      const sevFilter = parseSeverityList(opts.severity);

      const merged = mergeRuleFlags(opts.rule, opts.filterRule);

      process.exitCode = await checkSpecCommand({
        specPath: resolved.spec,
        json: globalJson(cmd),
        ndjson: opts.ndjson === true,
        strict: opts.strict === true,
        rule: merged.cliRule,
        config: opts.config,
        includePath: opts.includePath,
        maxIssues: opts.maxIssues,
        noDb: opts.db === false,
        verbose: opts.verbose === true || opts.flat === true,
        severityFilter: sevFilter,
        filterRule: merged.whitelist,
        top: typeof opts.top === "number" ? opts.top : undefined,
      });
    });
}
