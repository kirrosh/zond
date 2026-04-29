import { dirname } from "path";
import { stat } from "node:fs/promises";
import { parse } from "../../core/parser/yaml-parser.ts";
import { loadEnvironment, loadEnvMeta, loadEnvFile } from "../../core/parser/variables.ts";
import { filterSuitesByTags, excludeSuitesByTags, filterSuitesByMethod } from "../../core/parser/filter.ts";
import { runSuite } from "../../core/runner/executor.ts";
import { createRateLimiter, createAdaptiveRateLimiter } from "../../core/runner/rate-limiter.ts";
import { getReporter, generateJsonReport, generateJunitXml } from "../../core/reporter/index.ts";
import type { ReporterName } from "../../core/reporter/types.ts";
import { writeFile, mkdir } from "node:fs/promises";
import { dirname as pathDirname, isAbsolute, resolve as pathResolve } from "node:path";
import type { TestSuite } from "../../core/parser/types.ts";
import type { TestRunResult } from "../../core/runner/types.ts";
import { printError, printWarning } from "../output.ts";
import { jsonOk, jsonError, printJson } from "../json-envelope.ts";
import { getDb } from "../../db/schema.ts";
import { createRun, finalizeRun, saveResults, findCollectionByTestPath } from "../../db/queries.ts";
import { AUTH_PATH_RE } from "../../core/runner/execute-run.ts";

export interface RunOptions {
  path: string;
  env?: string;
  report: ReporterName;
  timeout?: number;
  rateLimit?: number | "auto";
  bail: boolean;
  /** Run regular suites sequentially (one after another) instead of in parallel. */
  sequential?: boolean;
  noDb?: boolean;
  dbPath?: string;
  authToken?: string;
  safe?: boolean;
  tag?: string[];
  excludeTag?: string[];
  method?: string;
  envVars?: string[];
  dryRun?: boolean;
  json?: boolean;
  /** Write the report to a file instead of stdout. */
  reportOut?: string;
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

  // 1b2. Exclude-tag filter
  if (options.excludeTag && options.excludeTag.length > 0) {
    suites = excludeSuitesByTags(suites, options.excludeTag);
    if (suites.length === 0) {
      printWarning("All suites excluded by --exclude-tag");
      return 0;
    }
  }

  // 1b3. Method filter
  if (options.method) {
    suites = filterSuitesByMethod(suites, options.method);
    if (suites.length === 0) {
      printWarning(`No tests found with method ${options.method.toUpperCase()}`);
      return 0;
    }
  }

  // 1c. Safe mode: keep GET, set-only steps, and auth-related requests
  if (options.safe) {
    for (const suite of suites) {
      suite.tests = suite.tests.filter(t => {
        if (t.method === "GET" || !t.method) return true;
        if (AUTH_PATH_RE.test(t.path)) return true;
        return false;
      });
    }
    suites = suites.filter(s => s.tests.length > 0);
    if (suites.length === 0) {
      printWarning("No safe tests found. Nothing to run in safe mode.");
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

  // Auto-load ./.env.yaml from cwd when --env not given and the searchDir env
  // file produced nothing. Useful when running with absolute test paths from
  // a collection cwd (e.g. APPLY agents in the auto-loop).
  if (!options.env && Object.keys(env).length === 0) {
    const cwd = process.cwd();
    const cwdEnvPath = `${cwd}/.env.yaml`;
    // Avoid double-load if cwd is already covered by searchDir or its parent
    const alreadyCovered = cwd === searchDir || cwd === dirname(searchDir);
    if (!alreadyCovered) {
      try {
        const cwdVars = await loadEnvFile(cwdEnvPath);
        if (cwdVars && Object.keys(cwdVars).length > 0) {
          env = { ...cwdVars };
          if (!options.json) {
            process.stderr.write(`zond: using ./.env.yaml (cwd fallback)\n`);
          }
        }
      } catch (err) {
        printError(`Failed to load environment: ${(err as Error).message}`);
        return 2;
      }
    }
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

  // 3b. Resolve rate limit: CLI flag > .env.yaml `rateLimit:` field
  let rateLimit: number | "auto" | undefined = options.rateLimit;
  if (rateLimit === undefined) {
    try {
      const envMeta = await loadEnvMeta(options.env, searchDir);
      rateLimit = envMeta.rateLimit;
    } catch { /* meta load failure is non-fatal */ }
  }
  const rateLimiter = rateLimit === "auto"
    ? createAdaptiveRateLimiter()
    : createRateLimiter(rateLimit);
  const runOpts = { rateLimiter };

  // 4. Run suites — setup suites run first (sequentially), their captures flow into regular suites
  const results: TestRunResult[] = [];
  const dryRun = options.dryRun === true;

  const setupSuites = suites.filter(s => s.setup);
  const regularSuites = suites.filter(s => !s.setup);
  const setupCaptures: Record<string, string> = {};

  for (const suite of setupSuites) {
    const result = await runSuite(suite, env, dryRun, runOpts);
    results.push(result);
    for (const step of result.steps) {
      for (const [k, v] of Object.entries(step.captures)) {
        setupCaptures[k] = String(v);
      }
    }
  }

  const enrichedEnv = { ...env, ...setupCaptures };

  if (options.bail) {
    // Sequential with bail at suite level
    for (const suite of regularSuites) {
      const result = await runSuite(suite, enrichedEnv, dryRun, runOpts);
      results.push(result);
      if (!dryRun && (result.failed > 0 || result.steps.some((s) => s.status === "error"))) {
        break;
      }
    }
  } else if (options.sequential) {
    // Sequential without bail — run suites one by one
    for (const suite of regularSuites) {
      const result = await runSuite(suite, enrichedEnv, dryRun, runOpts);
      results.push(result);
    }
  } else {
    // Parallel
    const all = await Promise.all(regularSuites.map((suite) => runSuite(suite, enrichedEnv, dryRun, runOpts)));
    results.push(...all);
  }

  // 5. Collect warnings
  const warnings: string[] = [];
  const rateLimited = results.flatMap(r => r.steps)
    .filter(s => s.response?.status === 429);
  if (rateLimited.length > 0) {
    warnings.push(`${rateLimited.length} request(s) hit rate limit (429). Consider: consolidating login steps, adding --bail, or using retry_until with delay.`);
  }

  // 5b. Report
  if (!options.json) {
    if (options.reportOut) {
      // Write report to a file via fs (bypass stdout). Console reporter falls
      // back to a single-line summary on stdout; json/junit produce no stdout.
      const outPath = isAbsolute(options.reportOut)
        ? options.reportOut
        : pathResolve(process.cwd(), options.reportOut);
      let content: string;
      let label: string;
      switch (options.report) {
        case "json":
          content = generateJsonReport(results);
          label = "JSON";
          break;
        case "junit":
          content = generateJunitXml(results);
          label = "JUnit XML";
          break;
        default: // "console" — fall back to JSON in the file (most useful)
          content = generateJsonReport(results);
          label = "JSON";
          break;
      }
      try {
        await mkdir(pathDirname(outPath), { recursive: true });
        await writeFile(outPath, content, "utf-8");
        process.stderr.write(`zond: ${label} report written to ${outPath}\n`);
      } catch (err) {
        printError(`Failed to write --report-out file ${outPath}: ${(err as Error).message}`);
        return 2;
      }
      for (const w of warnings) {
        printWarning(w);
      }
    } else {
      const reporter = getReporter(options.report);
      reporter.report(results);
      for (const w of warnings) {
        printWarning(w);
      }
    }
  }

  // 6. Save to DB
  let savedRunId: number | undefined;
  if (!options.noDb) {
    try {
      getDb(options.dbPath);
      const collection = findCollectionByTestPath(options.path);
      savedRunId = createRun({
        started_at: results[0]?.started_at ?? new Date().toISOString(),
        environment: options.env,
        collection_id: collection?.id,
      });
      finalizeRun(savedRunId, results);
      saveResults(savedRunId, results);
    } catch (err) {
      printWarning(`Failed to save results to DB: ${(err as Error).message}`);
    }
  }

  // 7. Exit code (always 0 in dry-run mode)
  if (dryRun) {
    if (options.json) {
      printJson(jsonOk("run", { summary: { total: results.length, passed: 0, failed: 0 }, dryRun: true }));
    }
    return 0;
  }
  const hasFailures = results.some((r) => r.failed > 0 || r.steps.some((s) => s.status === "error"));

  if (options.json) {
    const total = results.reduce((s, r) => s + r.total, 0);
    const passed = results.reduce((s, r) => s + r.passed, 0);
    const failed = results.reduce((s, r) => s + r.failed, 0);
    const failures = results.flatMap(r =>
      r.steps.filter(s => s.status === "fail" || s.status === "error").map(s => ({
        suite: r.suite_name,
        test: s.name,
        ...(r.suite_file ? { file: r.suite_file } : {}),
        status: s.status,
        ...(typeof s.response?.status === "number" ? { http_status: s.response.status } : {}),
        ...(typeof s.response?.status === "number" && s.response.status >= 500 && s.response.status < 600 ? { is_5xx: true } : {}),
        error: s.error,
      }))
    );
    const fiveXx = failures.filter(f => f.is_5xx).length;
    printJson(jsonOk("run", { summary: { total, passed, failed, fiveXx }, failures, warnings, runId: savedRunId }));
  }

  return hasFailures ? 1 : 0;
}
