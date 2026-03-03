import { parse } from "../parser/yaml-parser.ts";
import { loadEnvironment } from "../parser/variables.ts";
import { filterSuitesByTags } from "../parser/filter.ts";
import { runSuite } from "./executor.ts";
import { getDb } from "../../db/schema.ts";
import { createRun, finalizeRun, saveResults, findCollectionByTestPath } from "../../db/queries.ts";
import { dirname, resolve } from "path";
import { stat } from "node:fs/promises";
import type { TestRunResult } from "./types.ts";

export interface ExecuteRunOptions {
  testPath: string;
  envName?: string;
  trigger?: string;  // "cli" | "webui" | "mcp"
  dbPath?: string;
  safe?: boolean;
  tag?: string[];
  envVars?: Record<string, string>;
  dryRun?: boolean;
}

export interface ExecuteRunResult {
  runId: number;
  results: TestRunResult[];
}

export async function executeRun(options: ExecuteRunOptions): Promise<ExecuteRunResult> {
  const { testPath, envName, trigger = "cli", dbPath, safe, tag } = options;

  let suites = await parse(testPath);
  if (suites.length === 0) {
    throw new Error("No test files found");
  }

  // Tag filter
  if (tag && tag.length > 0) {
    suites = filterSuitesByTags(suites, tag);
    if (suites.length === 0) {
      throw new Error("No suites match the specified tags");
    }
  }

  // Safe mode: filter to GET-only tests
  if (safe) {
    for (const suite of suites) {
      suite.tests = suite.tests.filter(t => t.method === "GET");
    }
    suites = suites.filter(s => s.tests.length > 0);
    if (suites.length === 0) {
      throw new Error("No GET tests found. Nothing to run in safe mode.");
    }
  }

  const fileStat = await stat(testPath).catch(() => null);
  const isDirectory = fileStat?.isDirectory() ?? false;
  const envDir = isDirectory ? testPath : dirname(testPath);

  getDb(dbPath);
  const resolvedPath = resolve(testPath);
  const collection = findCollectionByTestPath(resolvedPath)
    ?? (fileStat?.isFile() ? findCollectionByTestPath(resolve(dirname(testPath))) : null);

  // If no envName given but a collection exists, fall back to "default" for DB lookup
  const effectiveEnvName = envName ?? (collection ? "default" : undefined);

  // Helper: load env with optional --env-var overrides merged on top
  async function loadEnvWithOverrides(dir: string): Promise<Record<string, string>> {
    const env = await loadEnvironment(effectiveEnvName, dir);
    if (options.envVars && Object.keys(options.envVars).length > 0) {
      Object.assign(env, options.envVars);
    }
    return env;
  }

  let results: Awaited<ReturnType<typeof runSuite>>[];
  if (isDirectory) {
    // Per-suite env: load env from each suite's own directory
    results = await Promise.all(suites.map(async (s) => {
      const suiteDir = s.filePath ? dirname(s.filePath) : envDir;
      const env = await loadEnvWithOverrides(suiteDir);
      return runSuite(s, env, options.dryRun);
    }));
  } else {
    const env = await loadEnvWithOverrides(envDir);
    results = await Promise.all(suites.map((s) => runSuite(s, env, options.dryRun)));
  }

  const runId = createRun({
    started_at: results[0]?.started_at ?? new Date().toISOString(),
    environment: effectiveEnvName,
    trigger,
    collection_id: collection?.id,
  });
  finalizeRun(runId, results);
  saveResults(runId, results);

  return { runId, results };
}
