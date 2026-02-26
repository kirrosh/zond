import { dirname } from "path";
import { parse } from "../../core/parser/yaml-parser.ts";
import { loadEnvironment } from "../../core/parser/variables.ts";
import { runSuite } from "../../core/runner/executor.ts";
import { getReporter } from "../../core/reporter/index.ts";
import type { ReporterName } from "../../core/reporter/types.ts";
import type { TestSuite } from "../../core/parser/types.ts";
import type { TestRunResult } from "../../core/runner/types.ts";
import { printError, printWarning } from "../output.ts";
import { getDb } from "../../db/schema.ts";
import { createRun, finalizeRun, saveResults } from "../../db/queries.ts";

export interface RunOptions {
  path: string;
  env?: string;
  report: ReporterName;
  timeout?: number;
  bail: boolean;
  noDb?: boolean;
  dbPath?: string;
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

  // 2. Load environment
  const searchDir = dirname(options.path);
  let env: Record<string, string> = {};
  try {
    env = await loadEnvironment(options.env, searchDir);
  } catch (err) {
    printError(`Failed to load environment: ${(err as Error).message}`);
    return 2;
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
  if (options.bail) {
    // Sequential with bail at suite level
    for (const suite of suites) {
      const result = await runSuite(suite, env);
      results.push(result);
      if (result.failed > 0 || result.steps.some((s) => s.status === "error")) {
        break;
      }
    }
  } else {
    // Parallel
    const all = await Promise.all(suites.map((suite) => runSuite(suite, env)));
    results.push(...all);
  }

  // 5. Report
  const reporter = getReporter(options.report);
  reporter.report(results);

  // 6. Save to DB
  if (!options.noDb) {
    try {
      getDb(options.dbPath);
      const runId = createRun({
        started_at: results[0]?.started_at ?? new Date().toISOString(),
        environment: options.env,
      });
      finalizeRun(runId, results);
      saveResults(runId, results);
    } catch (err) {
      printWarning(`Failed to save results to DB: ${(err as Error).message}`);
    }
  }

  // 7. Exit code
  const hasFailures = results.some((r) => r.failed > 0 || r.steps.some((s) => s.status === "error"));
  return hasFailures ? 1 : 0;
}
