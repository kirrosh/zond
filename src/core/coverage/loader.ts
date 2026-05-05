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
import { findCollectionByNameOrId, getLatestRunByCollection, getResultsByRunId, getRunById } from "../../db/queries.ts";
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
  run: RunRecord | null;
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

  let run: RunRecord | null = null;
  if (options.runId != null) {
    run = getRunById(options.runId);
  } else {
    run = getLatestRunByCollection(collection.id);
  }
  const results = run ? getResultsByRunId(run.id) : [];

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
    profile,
    tagFilter,
    ephemeralCount: ephemeralEndpoints.size,
  };
}

export async function listRegisteredApiNames(): Promise<string[]> {
  const { listCollections } = await import("../../db/queries.ts");
  return listCollections().map((c) => c.name);
}
