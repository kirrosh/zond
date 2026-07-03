/**
 * ARV-175: `zond schema-from-runs` — mine 2xx response bodies from a
 * persisted run and emit `patch.schema.json` (inferred JSON Schema per
 * endpoint+status). Pairs with `refresh-api --merge-schema` (ARV-176).
 */
import { writeFile } from "node:fs/promises";
import type { Command } from "commander";
import { readOpenApiSpec, extractEndpoints } from "../../core/generator/index.ts";
import { schemaFromRuns, type ResultRow } from "../../core/spec/schema-from-runs.ts";
import { getResultsByRunId, getLatestRunId } from "../../db/queries.ts";
import { getDb } from "../../db/schema.ts";
import { resolveApiCollection, globalJson } from "../resolve.ts";
import { getApi } from "../util/api-context.ts";
import { jsonOk, jsonError, printJson } from "../json-envelope.ts";
import { printError, printSuccess, printWarning } from "../output.ts";
import { parsePositiveInt } from "../argv.ts";

export interface SchemaFromRunsCliOptions {
  api?: string;
  spec?: string;
  db?: string;
  run?: number;
  minSamples?: number;
  out?: string;
  engine?: string;
  json?: boolean;
}

export async function schemaFromRunsCommand(
  opts: SchemaFromRunsCliOptions,
  cmd: Command,
): Promise<number> {
  const json = opts.json === true || globalJson(cmd);
  const label = "schema-from-runs";

  // ARV-175 AC#2: only `builtin` is wired. quicktype/genson would each pull
  // a large dependency tree, which contradicts zond's minimal-deps charter.
  const engine = (opts.engine ?? "builtin").toLowerCase();
  if (engine !== "builtin") {
    const msg = `--engine "${opts.engine}" is not available. Only 'builtin' is wired (quicktype/genson would add heavy deps; see src/CLAUDE.md).`;
    if (json) printJson(jsonError(label, [msg])); else printError(msg);
    return 2;
  }

  // Resolve spec: --spec wins, else --api / current-api collection.
  let spec = opts.spec;
  const apiFlag = opts.spec ? opts.api : getApi(cmd, opts as Record<string, unknown>);
  if (!spec && apiFlag) {
    const resolved = resolveApiCollection(apiFlag, opts.db);
    if ("error" in resolved) {
      if (json) printJson(jsonError(label, [resolved.error])); else printError(resolved.error);
      return resolved.error.startsWith("Failed") ? 2 : 1;
    }
    if (resolved.spec) spec = resolved.spec;
  }
  if (!spec) {
    const msg = "No spec: pass --spec <path> or --api <name> (or set a current API).";
    if (json) printJson(jsonError(label, [msg])); else printError(msg);
    return 2;
  }

  getDb(opts.db);
  const runId = opts.run ?? getLatestRunId();
  if (runId == null) {
    const msg = "No runs in the database. Run `zond run` / `zond checks run` first, then re-run schema-from-runs.";
    if (json) printJson(jsonError(label, [msg])); else printError(msg);
    return 2;
  }

  let doc;
  try {
    doc = await readOpenApiSpec(spec);
  } catch (err) {
    const msg = `Failed to read spec at "${spec}": ${(err as Error).message}`;
    if (json) printJson(jsonError(label, [msg])); else printError(msg);
    return 2;
  }
  const endpoints = extractEndpoints(doc);

  const rows = getResultsByRunId(runId) as unknown as ResultRow[];
  const minSamples = opts.minSamples ?? 2;
  const result = schemaFromRuns({ results: rows, endpoints, minSamples });

  const emitted = result.groups.filter((g) => g.emitted);
  const skipped = result.groups.filter((g) => !g.emitted);
  const out = opts.out ?? "patch.schema.json";

  if (emitted.length > 0) {
    await writeFile(out, JSON.stringify(result.patch, null, 2) + "\n", "utf-8");
  }

  if (json) {
    printJson(jsonOk(label, {
      run_id: runId,
      out: emitted.length > 0 ? out : null,
      min_samples: minSamples,
      emitted: emitted.map((g) => ({ endpoint: g.endpoint, status: g.status, samples: g.samples })),
      skipped: skipped.map((g) => ({ endpoint: g.endpoint, status: g.status, samples: g.samples, reason: g.reason })),
    }));
    return 0;
  }

  if (emitted.length === 0) {
    printWarning(`No schemas emitted from run #${runId}: no (endpoint, status) group reached --min-samples ${minSamples}. ${skipped.length} group(s) had too few 2xx JSON samples.`);
    return 0;
  }
  printSuccess(`Wrote ${emitted.length} response schema(s) from run #${runId} to ${out}`);
  for (const g of emitted) console.log(`  ${g.endpoint} → ${g.status} (${g.samples} samples)`);
  for (const g of skipped) printWarning(`skipped ${g.endpoint} → ${g.status}: ${g.reason} (${g.samples} sample(s))`);
  console.log(`\nNext: zond refresh-api --api <name> --merge-schema ${out}`);
  return 0;
}

export function registerSchemaFromRuns(program: Command): void {
  program
    .command("schema-from-runs")
    .description("ARV-175: infer response JSON Schemas from a run's 2xx bodies → patch.schema.json (pairs with refresh-api --merge-schema). Revives response_schema_conformance on specs that declare no response schemas.")
    .option("--api <name>", "Registered API (spec + DB lookup)")
    .option("--spec <path>", "Explicit OpenAPI spec path (overrides --api)")
    .option("--run <id>", "Run id to mine (default: latest)", parsePositiveInt("--run"))
    .option("--min-samples <n>", "Minimum 2xx samples per endpoint+status to emit (default 2)", parsePositiveInt("--min-samples"))
    .option("--out <path>", "Output path for patch.schema.json (default: patch.schema.json)")
    .option("--engine <name>", "Schema engine. Only 'builtin' is wired (default).", "builtin")
    .option("--db <path>", "SQLite path")
    .action(async (opts, cmd: Command) => {
      process.exitCode = await schemaFromRunsCommand(opts, cmd);
    });
}
