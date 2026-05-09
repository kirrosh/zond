import { readOpenApiSpec } from "../../core/generator/openapi-reader.ts";
import { lintSpec, loadConfig, formatHuman, formatNdjson, formatGrouped, buildRuleSummary } from "../../core/lint/index.ts";
import type { Issue, Severity } from "../../core/lint/index.ts";
import { getDb } from "../../db/schema.ts";
import { createLintRun, finalizeLintRun } from "../../db/lint-runs.ts";
import { jsonOk, jsonError, printJson } from "../json-envelope.ts";
import { printError } from "../output.ts";

export interface LintSpecOptions {
  specPath: string;
  json?: boolean;
  ndjson?: boolean;
  strict?: boolean;
  rule?: string;
  config?: string;
  includePath?: string[];
  maxIssues?: number;
  noDb?: boolean;
  /** TASK-279: render the legacy flat one-line-per-issue list instead of the
   *  rule × severity rollup (which is now the default). */
  verbose?: boolean;
  /** TASK-279: filter the rendered/JSON output to only these severities. The
   *  underlying lint pass still runs end-to-end so the lint_runs DB history
   *  stays intact. */
  severityFilter?: Severity[];
  /** TASK-279: filter to only these rule ids (e.g. ["B1", "B6"]). */
  filterRule?: string[];
  /** TASK-279: show only the top-N rule rows in the grouped summary. */
  top?: number;
}

export async function lintSpecCommand(opts: LintSpecOptions): Promise<number> {
  let doc;
  try {
    doc = await readOpenApiSpec(opts.specPath);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (opts.json || opts.ndjson) {
      printJson(jsonError("lint-spec", [`Failed to load spec: ${message}`]));
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
      printJson(jsonError("lint-spec", [message]));
    } else {
      printError(message);
    }
    return 2;
  }

  // SQLite history (best-effort; doesn't fail the run if DB unavailable).
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
      // ignore — history is best-effort
    }
  }

  // TASK-279: post-lint filters. Apply AFTER lintSpec so DB history stores
  // the full unfiltered run; rendering and JSON output reflect the user's
  // filters. Stats are recomputed against the filtered set so summaries line
  // up with what gets shown.
  const filtered = applyFilters(result.issues, opts);
  const filteredStats = recomputeStats(filtered);

  if (opts.ndjson) {
    process.stdout.write(formatNdjson(filtered));
  } else if (opts.json) {
    printJson(jsonOk("lint-spec", {
      issues: filtered,
      stats: filteredStats,
      summary: buildRuleSummary(filtered),
    }));
  } else if (opts.verbose) {
    process.stdout.write(formatHuman(filtered, filteredStats));
  } else {
    process.stdout.write(formatGrouped(filtered, filteredStats, { top: opts.top }));
  }

  // Exit codes are based on the unfiltered stats so a `--severity low` view
  // doesn't accidentally hide a CI-blocker from the script that reads `$?`.
  if (result.stats.high > 0) return 1;
  if (result.stats.medium > 0) return 2;
  if (opts.strict && result.stats.low > 0) return 2;
  return 0;
}

function applyFilters(issues: Issue[], opts: LintSpecOptions): Issue[] {
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

import type { Command } from "commander";
import { globalJson, resolveSpecArg } from "../resolve.ts";
import { parsePositiveInt } from "../argv.ts";

function parseSeverityList(raw: unknown): Severity[] | undefined {
  if (typeof raw !== "string" || raw.trim() === "") return undefined;
  const allowed: Severity[] = ["high", "medium", "low"];
  const items = raw.split(",").map(s => s.trim().toLowerCase()).filter(Boolean) as Severity[];
  return items.filter(s => allowed.includes(s));
}

export function registerLintSpec(program: Command): void {
  program
    .command("lint-spec [spec]")
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

      // TASK-291: unify --rule (severity overrides + disables) and the legacy
      // --filter-rule (whitelist by id). The merged --rule accepts all three
      // shapes; --filter-rule is an alias that contributes only whitelist ids
      // and prints a deprecation warning.
      const merged = mergeRuleFlags(opts.rule, opts.filterRule);

      process.exitCode = await lintSpecCommand({
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

/**
 * TASK-291: parse --rule (and the deprecated --filter-rule) into the two
 * downstream channels: cliRule (severity overrides + disables, fed to
 * loadConfig) and whitelist (rule-id allow-list, applied post-lint).
 *
 * Rules:
 *  - 'B1'         → whitelist B1.
 *  - '!B2'        → disable B2 (also passed via cliRule to suppress the
 *                   rule entirely so it never appears in the run).
 *  - 'B3=high'    → severity override AND implicit whitelist of B3.
 *  - 'B3=off'     → equivalent to '!B3'.
 *
 * Whitelist is applied only when at least one positive id is given; an
 * all-negated input keeps the full rule set minus the disables.
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
    // Plain id → whitelist only; do not push as cliRule (loadConfig would
    // treat a bare id as "enable at default severity" which is a no-op
    // for already-enabled rules but adds noise for unknown ids).
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
