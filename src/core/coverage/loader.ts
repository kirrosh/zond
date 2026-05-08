/**
 * I/O wrapper around the pure `buildCoverageMatrix` engine — loads the
 * registered API's spec snapshot, parses suites in the workspace to find
 * ephemeral-tagged endpoints, reads `.api-fixtures.yaml` and `.env.yaml`,
 * pulls run results from SQLite, and feeds it all into the engine.
 *
 * Server `/api/coverage`, the HTML exporter, and any future CLI command
 * call this loader so they stay in sync.
 */
import { join } from "node:path";
import { existsSync } from "node:fs";
import { findCollectionByNameOrId, getLatestRunByCollection, getResultsByRunId, getRunById, listRunsBySession } from "../../db/queries.ts";
import type { RunRecord } from "../../db/queries.ts";
import { assertLocalSpec } from "../setup-api.ts";
import { readOpenApiSpec, extractEndpoints } from "../generator/openapi-reader.ts";
import { parseDirectorySafe } from "../parser/yaml-parser.ts";
import { loadEnvironment } from "../parser/variables.ts";
import { findWorkspaceRoot } from "../workspace/root.ts";
import {
  buildCoverageMatrix,
  type CoverageMatrix,
  type BuildMatrixInput,
} from "./reasons.ts";

export interface CoverageLoadOptions {
  apiName: string;
  runId?: number;
  /** TASK-255: union across multiple runs (e.g. tests-run + probes-run from
   *  the same session). Loader concatenates results from each run before
   *  feeding the matrix engine — buildCoverageMatrix is order-agnostic. When
   *  set, takes precedence over `runId`. */
  runIds?: number[];
  /** TASK-255: when set, expanded to all runs in the session (filtered to
   *  this collection). Wins over `runIds` and `runId`. */
  sessionId?: string;
  profile?: "safe" | "full";
  tagFilter?: string[];
  /** Override workspace root (defaults to findWorkspaceRoot). */
  workspaceRoot?: string;
}

export interface CoverageLoadResult {
  apiName: string;
  baseDir: string;
  specPath: string;
  matrix: CoverageMatrix;
  /** Latest of the runs included in the coverage. Null if no runs found.
   *  Kept singular for back-compat; for the full list use `runs`. */
  run: RunRecord | null;
  /** TASK-255: every run that contributed results to this coverage matrix,
   *  ordered by started_at ascending. Single-element when no union flags
   *  were used. */
  runs: RunRecord[];
  profile: "safe" | "full";
  tagFilter: string[];
  ephemeralCount: number;
}

async function readFixturesAffected(baseDir: string): Promise<BuildMatrixInput["fixturesAffected"]> {
  const path = join(baseDir, ".api-fixtures.yaml");
  if (!existsSync(path)) return new Map();
  const text = await Bun.file(path).text();
  const parsed = Bun.YAML.parse(text) as { fixtures?: Array<{ name: string; required: boolean; source: string; affectedEndpoints?: string[] }> };
  const out = new Map<string, { name: string; required: boolean; source: string }[]>();
  for (const f of parsed.fixtures ?? []) {
    for (const ep of f.affectedEndpoints ?? []) {
      if (ep === "*") continue;
      const list = out.get(ep) ?? [];
      list.push({ name: f.name, required: f.required, source: f.source });
      out.set(ep, list);
    }
  }
  return out;
}

async function readEphemeralEndpoints(workspaceRoot: string): Promise<Set<string>> {
  const out = new Set<string>();
  const { suites } = await parseDirectorySafe(workspaceRoot);
  for (const suite of suites) {
    if (!suite.tags?.includes("ephemeral")) continue;
    for (const t of suite.tests) out.add(`${t.method.toUpperCase()} ${t.path}`);
  }
  return out;
}

export async function loadCoverage(options: CoverageLoadOptions): Promise<CoverageLoadResult> {
  const root = options.workspaceRoot ?? findWorkspaceRoot().root;
  const collection = findCollectionByNameOrId(options.apiName);
  if (!collection) throw new Error(`API '${options.apiName}' is not registered. Run \`zond add api --spec <path>\`.`);

  const baseDir = collection.base_dir ?? join(root, "apis", collection.name);
  const specPath = collection.openapi_spec
    ? assertLocalSpec(collection.openapi_spec, collection.name)
    : (() => { throw new Error(`Collection '${collection.name}' has no spec recorded.`); })();

  const doc = await readOpenApiSpec(specPath);
  const endpoints = extractEndpoints(doc);

  // Resolve which runs contribute results. Precedence:
  // sessionId > runIds > runId > latest. Filter session runs by collection
  // so a coverage call for `--api foo` doesn't accidentally include another
  // collection's runs that share the session.
  let runs: RunRecord[] = [];
  if (options.sessionId) {
    const sessRuns = listRunsBySession(options.sessionId);
    // Include runs whose collection matches AND runs with NULL collection_id —
    // the latter covers probe-suites and ad-hoc runs that didn't tag the API
    // explicitly but still produced results against this session's workdir.
    // Filtering them out makes `coverage --union session` silently show only
    // the test-suite run (the original feedback-12 #F1 symptom).
    runs = sessRuns
      .filter((r) => r.collection_id === collection.id || r.collection_id == null)
      .map((r) => getRunById(r.id))
      .filter((r): r is RunRecord => r !== null);
  } else if (options.runIds && options.runIds.length > 0) {
    runs = options.runIds
      .map((id) => getRunById(id))
      .filter((r): r is RunRecord => r !== null);
  } else if (options.runId != null) {
    const r = getRunById(options.runId);
    if (r) runs = [r];
  } else {
    const latest = getLatestRunByCollection(collection.id);
    if (latest) runs = [latest];
  }
  const results = runs.flatMap((r) => getResultsByRunId(r.id));
  // `run` (singular) reflects the latest contributing run for back-compat
  // with consumers that only care about a single run label.
  const run = runs.length > 0 ? runs[runs.length - 1]! : null;

  const fixturesAffected = await readFixturesAffected(baseDir);
  const ephemeralEndpoints = await readEphemeralEndpoints(root);
  const envVarsObj = await loadEnvironment(undefined, baseDir);
  const envVars = new Set(Object.keys(envVarsObj).filter((k) => {
    const v = envVarsObj[k];
    return typeof v === "string" ? v.length > 0 : v != null;
  }));

  const profile = options.profile ?? "full";
  const tagFilter = options.tagFilter ?? [];

  const matrix = buildCoverageMatrix({
    endpoints, results, fixturesAffected, envVars, ephemeralEndpoints,
    tagFilter, profile,
  });

  return {
    apiName: collection.name,
    baseDir,
    specPath,
    matrix,
    run,
    runs,
    profile,
    tagFilter,
    ephemeralCount: ephemeralEndpoints.size,
  };
}

async function listRegisteredApiNames(): Promise<string[]> {
  const { listCollections } = await import("../../db/queries.ts");
  return listCollections().map((c) => c.name);
}
