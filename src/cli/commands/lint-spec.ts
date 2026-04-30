import { readOpenApiSpec } from "../../core/generator/openapi-reader.ts";
import { lintSpec, loadConfig, formatHuman, formatNdjson } from "../../core/lint/index.ts";
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

  if (opts.ndjson) {
    process.stdout.write(formatNdjson(result.issues));
  } else if (opts.json) {
    printJson(jsonOk("lint-spec", { issues: result.issues, stats: result.stats }));
  } else {
    process.stdout.write(formatHuman(result.issues, result.stats));
  }

  // Exit codes:
  //   0 — no issues, or only LOW without --strict
  //   1 — at least one HIGH (CI fail)
  //   2 — at least one MEDIUM (or any LOW with --strict)
  if (result.stats.high > 0) return 1;
  if (result.stats.medium > 0) return 2;
  if (opts.strict && result.stats.low > 0) return 2;
  return 0;
}
