import { parse } from "../parser/yaml-parser.ts";
import { loadEnvironment } from "../parser/variables.ts";
import { filterSuitesByTags } from "../parser/filter.ts";
import { runSuite } from "./executor.ts";
import { getDb } from "../../db/schema.ts";
import { createRun, finalizeRun, saveResults, findCollectionByTestPath } from "../../db/queries.ts";
import { dirname, resolve } from "path";
import { stat } from "node:fs/promises";
import type { TestRunResult } from "./types.ts";

export const AUTH_PATH_RE = /\/(auth|login|signin|token|oauth)\b/i;

export interface ExecuteRunOptions {
  testPath: string;
  envName?: string;
  trigger?: string;  // "cli" | "webui" | "mcp"
  dbPath?: string;
  safe?: boolean;
  tag?: string[];
  envVars?: Record<string, string>;
  dryRun?: boolean;
  rerunFilter?: Set<string>;  // "suite_name::test_name" keys to rerun
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

  // Rerun filter: keep only specific failed tests
  if (options.rerunFilter && options.rerunFilter.size > 0) {
    for (const suite of suites) {
      suite.tests = suite.tests.filter(t => options.rerunFilter!.has(`${suite.name}::${t.name}`));
    }
    suites = suites.filter(s => s.tests.length > 0);
    if (suites.length === 0) {
      throw new Error("No matching tests found for rerun filter");
    }
  }

  // Safe mode: filter to GET + auth endpoints (same logic as run.ts)
  if (safe) {
    for (const suite of suites) {
      suite.tests = suite.tests.filter(t => t.method === "GET" || !t.method || AUTH_PATH_RE.test(t.path));
    }
    suites = suites.filter(s => s.tests.length > 0);
    if (suites.length === 0) {
      throw new Error("No safe tests found. Nothing to run in safe mode.");
    }
  }

  const fileStat = await stat(testPath).catch(() => null);
  const isDirectory = fileStat?.isDirectory() ?? false;
  const envDir = isDirectory ? testPath : dirname(testPath);

  getDb(dbPath);
  const resolvedPath = resolve(testPath);
  const collection = findCollectionByTestPath(resolvedPath)
    ?? (fileStat?.isFile() ? findCollectionByTestPath(resolve(dirname(testPath))) : null);

  const effectiveEnvName = envName;

  // Helper: load env with optional --env-var overrides merged on top
  async function loadEnvWithOverrides(dir: string): Promise<Record<string, string>> {
    const env = await loadEnvironment(effectiveEnvName, dir);
    if (options.envVars && Object.keys(options.envVars).length > 0) {
      Object.assign(env, options.envVars);
    }
    return env;
  }

  // Phase 1: run setup suites first (sequentially), collect their captures
  const setupSuites = suites.filter(s => s.setup);
  const regularSuites = suites.filter(s => !s.setup);
  const setupResults: Awaited<ReturnType<typeof runSuite>>[] = [];
  const setupCaptures: Record<string, string> = {};

  for (const suite of setupSuites) {
    const suiteDir = suite.filePath ? dirname(suite.filePath) : envDir;
    const env = await loadEnvWithOverrides(suiteDir);
    const result = await runSuite(suite, env, options.dryRun);
    setupResults.push(result);
    for (const step of result.steps) {
      for (const [k, v] of Object.entries(step.captures)) {
        setupCaptures[k] = String(v);
      }
    }
  }

  // Phase 2: run regular suites with env enriched by setup captures
  let regularResults: Awaited<ReturnType<typeof runSuite>>[];
  if (isDirectory) {
    regularResults = await Promise.all(regularSuites.map(async (s) => {
      const suiteDir = s.filePath ? dirname(s.filePath) : envDir;
      const env = await loadEnvWithOverrides(suiteDir);
      return runSuite(s, { ...env, ...setupCaptures }, options.dryRun);
    }));
  } else {
    const env = await loadEnvWithOverrides(envDir);
    const enrichedEnv = { ...env, ...setupCaptures };
    regularResults = await Promise.all(regularSuites.map(s => runSuite(s, enrichedEnv, options.dryRun)));
  }

  const results = [...setupResults, ...regularResults];

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
