import { dirname } from "path";
import { stat } from "node:fs/promises";
import { parse } from "../../core/parser/yaml-parser.ts";
import { loadEnvironment } from "../../core/parser/variables.ts";
import { filterSuitesByTags } from "../../core/parser/filter.ts";
import { runSuite } from "../../core/runner/executor.ts";
import { getReporter } from "../../core/reporter/index.ts";
import type { ReporterName } from "../../core/reporter/types.ts";
import type { TestSuite } from "../../core/parser/types.ts";
import type { TestRunResult } from "../../core/runner/types.ts";
import { printError, printWarning } from "../output.ts";
import { getDb } from "../../db/schema.ts";
import { createRun, finalizeRun, saveResults, findCollectionByTestPath } from "../../db/queries.ts";

export interface RunOptions {
  path: string;
  env?: string;
  report: ReporterName;
  timeout?: number;
  bail: boolean;
  noDb?: boolean;
  dbPath?: string;
  authToken?: string;
  safe?: boolean;
  tag?: string[];
  envVars?: string[];
  dryRun?: boolean;
}

export async function runCommand(options: RunOptions): Promise<number> {
  // 1. Parse test files
  let suites: TestSuite[];
  try {
    suites = await parse(options.path);
  } catch (err) {
    printError(err instanceof Error ? err.message : String(err));
    return 2;
  }

  if (suites.length === 0) {
    printWarning(`No test files found in ${options.path}`);
    return 0;
  }

  // 1b. Tag filter
  if (options.tag && options.tag.length > 0) {
    suites = filterSuitesByTags(suites, options.tag);
    if (suites.length === 0) {
      printWarning("No suites match the specified tags");
      return 0;
    }
  }

  // 1c. Safe mode: filter to GET-only tests
  if (options.safe) {
    for (const suite of suites) {
      suite.tests = suite.tests.filter(t => t.method === "GET");
    }
    suites = suites.filter(s => s.tests.length > 0);
    if (suites.length === 0) {
      printWarning("No GET tests found. Nothing to run in safe mode.");
      return 0;
    }
  }

  // 2. Load environment (resolve collection for scoped envs)
  // Use path itself as searchDir if it's a directory; dirname() on a dir path gives the parent
  const pathStat = await stat(options.path).catch(() => null);
  const searchDir = pathStat?.isDirectory() ? options.path : dirname(options.path);
  let collectionForEnv: { id: number } | null = null;
  if (!options.noDb) {
    try {
      getDb(options.dbPath);
      collectionForEnv = findCollectionByTestPath(options.path);
    } catch { /* DB not available — OK */ }
  }

  let env: Record<string, string> = {};
  try {
    env = await loadEnvironment(options.env, searchDir);
  } catch (err) {
    printError(`Failed to load environment: ${(err as Error).message}`);
    return 2;
  }

  // Inject CLI auth token — overrides env file value
  if (options.authToken) {
    env.auth_token = options.authToken;
  }

  // Inject --env-var KEY=VALUE overrides (highest priority)
  if (options.envVars && options.envVars.length > 0) {
    for (const pair of options.envVars) {
      const eqIdx = pair.indexOf("=");
      if (eqIdx > 0) {
        env[pair.slice(0, eqIdx)] = pair.slice(eqIdx + 1);
      }
    }
  }

  // Warn if --env was explicitly set but file was not found (empty env)
  if (options.env && Object.keys(env).length === 0) {
    printWarning(`Environment file .env.${options.env}.yaml not found in ${searchDir}`);
  }

  // 3. Apply timeout override
  if (options.timeout !== undefined) {
    for (const suite of suites) {
      suite.config.timeout = options.timeout;
    }
  }

  // 4. Run suites
  const results: TestRunResult[] = [];
  const dryRun = options.dryRun === true;
  if (options.bail) {
    // Sequential with bail at suite level
    for (const suite of suites) {
      const result = await runSuite(suite, env, dryRun);
      results.push(result);
      if (!dryRun && (result.failed > 0 || result.steps.some((s) => s.status === "error"))) {
        break;
      }
    }
  } else {
    // Parallel
    const all = await Promise.all(suites.map((suite) => runSuite(suite, env, dryRun)));
    results.push(...all);
  }

  // 5. Report
  const reporter = getReporter(options.report);
  reporter.report(results);

  // 6. Save to DB
  if (!options.noDb) {
    try {
      getDb(options.dbPath);
      const collection = findCollectionByTestPath(options.path);
      const runId = createRun({
        started_at: results[0]?.started_at ?? new Date().toISOString(),
        environment: options.env,
        collection_id: collection?.id,
      });
      finalizeRun(runId, results);
      saveResults(runId, results);
    } catch (err) {
      printWarning(`Failed to save results to DB: ${(err as Error).message}`);
    }
  }

  // 7. Exit code (always 0 in dry-run mode)
  if (dryRun) return 0;
  const hasFailures = results.some((r) => r.failed > 0 || r.steps.some((s) => s.status === "error"));
  return hasFailures ? 1 : 0;
}
