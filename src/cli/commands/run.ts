import { dirname } from "path";
import { stat } from "node:fs/promises";
import { parseSafe } from "../../core/parser/yaml-parser.ts";
import { loadEnvironment, loadEnvMeta, loadEnvFile } from "../../core/parser/variables.ts";
import { filterSuitesByTags, excludeSuitesByTags, filterSuitesByMethod } from "../../core/parser/filter.ts";
import { preflightCheckVars, formatMissingVarLine } from "../../core/runner/preflight-vars.ts";
import { runSuite } from "../../core/runner/executor.ts";
import { createSchemaValidator } from "../../core/runner/schema-validator.ts";
import { readOpenApiSpec } from "../../core/generator/openapi-reader.ts";
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
import { buildSpecPointer } from "../../core/diagnostics/spec-pointer.ts";

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
  /** Hard-fail (exit 2) on undefined {{var}} references instead of warning. */
  strictVars?: boolean;
  dryRun?: boolean;
  json?: boolean;
  /** Write the report to a file instead of stdout. */
  reportOut?: string;
  /** Validate every JSON response against the OpenAPI response schema. */
  validateSchema?: boolean;
  /** Explicit OpenAPI spec path/URL (overrides collection.openapi_spec). */
  specPath?: string;
}

export async function runCommand(options: RunOptions): Promise<number> {
  // 1. Parse test files (collect parse errors instead of silently skipping)
  let suites: TestSuite[];
  let parseErrors: { file: string; error: string }[];
  try {
    const parsed = await parseSafe(options.path);
    suites = parsed.suites;
    parseErrors = parsed.errors;
  } catch (err) {
    printError(err instanceof Error ? err.message : String(err));
    return 2;
  }

  for (const pe of parseErrors) {
    printWarning(`Skipped ${pe.file}: ${pe.error}`);
  }

  if (suites.length === 0) {
    if (parseErrors.length > 0) {
      printError(`All ${parseErrors.length} test file(s) in ${options.path} failed to parse`);
      return 2;
    }
    printWarning(`No test files found in ${options.path}`);
    return 0;
  }

  // 1b. Tag filter
  if (options.tag && options.tag.length > 0) {
    suites = filterSuitesByTags(suites, options.tag);
    if (suites.length === 0) {
      if (parseErrors.length > 0) {
        printError(
          `No suites match tags [${options.tag.join(", ")}] — but ${parseErrors.length} file(s) failed to parse (see warnings above). Fix parse errors and retry.`
        );
        return 1;
      }
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

  // 3c. Resolve OpenAPI spec. Explicit --spec wins; otherwise fall back to the
  // collection record. The doc is reused for --validate-schema (TASK-50) and
  // for spec_pointer/spec_excerpt frozen evidence (TASK-102).
  let schemaValidator: ReturnType<typeof createSchemaValidator> | undefined;
  let openApiDoc: unknown | undefined;
  {
    let specPath = options.specPath;
    if (!specPath) {
      try {
        const collection = findCollectionByTestPath(options.path);
        if (collection?.openapi_spec) specPath = collection.openapi_spec;
      } catch { /* DB not available — fall through */ }
    }
    if (specPath) {
      try {
        openApiDoc = await readOpenApiSpec(specPath);
      } catch (err) {
        if (options.validateSchema) {
          printError(`Failed to load OpenAPI spec '${specPath}': ${(err as Error).message}`);
          return 2;
        }
        // spec_pointer is best-effort — non-fatal when spec can't be loaded.
        printWarning(`Failed to load OpenAPI spec '${specPath}' for spec_pointer evidence: ${(err as Error).message}`);
      }
    }
    if (options.validateSchema) {
      if (!openApiDoc) {
        printError("--validate-schema requires --spec <path|url> or a collection with openapi_spec set");
        return 2;
      }
      schemaValidator = createSchemaValidator(openApiDoc as Parameters<typeof createSchemaValidator>[0]);
    }
  }

  const runOpts = { rateLimiter, schemaValidator };

  // 4. Run suites — setup suites run first (sequentially), their captures flow into regular suites
  const results: TestRunResult[] = [];
  const dryRun = options.dryRun === true;

  const setupSuites = suites.filter(s => s.setup);
  const regularSuites = suites.filter(s => !s.setup);
  const setupCaptures: Record<string, string> = {};

  // 3d. Pre-flight variable check on setup suites — only `env` is known
  //     (their captures don't exist yet).
  {
    const setupHits = preflightCheckVars(setupSuites, env);
    for (const hit of setupHits) printWarning(formatMissingVarLine(hit));
    if (options.strictVars && setupHits.length > 0) {
      printError(`--strict-vars: ${setupHits.length} undefined variable reference(s) in setup suites`);
      return 2;
    }
  }

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

  // 3e. Pre-flight variable check on regular suites — env + setup captures
  //     are known producers; per-suite captures/sets/parameterize handled inside.
  {
    const hits = preflightCheckVars(regularSuites, enrichedEnv);
    for (const hit of hits) printWarning(formatMissingVarLine(hit));
    if (options.strictVars && hits.length > 0) {
      printError(`--strict-vars: ${hits.length} undefined variable reference(s)`);
      return 2;
    }
  }

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

  // 5b. Resolve spec_pointer + spec_excerpt for steps with provenance.
  // Frozen evidence: pointer and excerpt are computed once, against the spec
  // doc loaded at run time, and saved into the DB so later spec edits don't
  // rewrite history.
  if (openApiDoc) {
    for (const r of results) {
      for (const s of r.steps) {
        if (!s.provenance) continue;
        const ptr = buildSpecPointer(s.provenance, openApiDoc);
        if (ptr) {
          s.spec_pointer = ptr.pointer;
          s.spec_excerpt = ptr.excerpt;
        }
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
        ...(s.failure_class ? { failure_class: s.failure_class, failure_class_reason: s.failure_class_reason } : {}),
        ...(s.provenance ? { provenance: s.provenance } : {}),
        ...(s.spec_pointer ? { spec_pointer: s.spec_pointer, spec_excerpt: s.spec_excerpt } : {}),
      }))
    );
    const fiveXx = failures.filter(f => f.is_5xx).length;
    printJson(jsonOk("run", { summary: { total, passed, failed, fiveXx }, failures, warnings, runId: savedRunId }));
  }

  return hasFailures ? 1 : 0;
}
