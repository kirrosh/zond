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
import { AUTH_PATH_RE } from "../../core/runner/auth-path.ts";
import { resolveCollectionSpec } from "../../core/setup-api.ts";
import { buildSpecPointer } from "../../core/diagnostics/spec-pointer.ts";
import { detectStatusDrifts, formatDriftPlan, applyDriftsToTests, appendToleratedDrifts } from "../../core/runner/learn-drift.ts";
import { detectCiContext } from "../../core/runner/ci-context.ts";
import { resolveRateLimit } from "../../core/workspace/config.ts";

export interface RunOptions {
  /**
   * One or more paths to a YAML file or a directory of YAML files.
   * Multi-path: shell-glob expansion (`zond run tests/*.yaml`) — suites from
   * every path are merged into a single run. The first path is used as the
   * anchor for env-file resolution and DB collection lookup.
   */
  paths: string[];
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
  /** Group this run under a session id (multi-run campaigns). */
  sessionId?: string;
  /** TASK-144: per-step retry budget for transient network errors
   *  (ECONNRESET / EPIPE / socket hang up / fetch failed / abort).
   *  HTTP statuses are not retried by this path. Default 1, 0 disables. */
  retryOnNetwork?: number;
  /** TASK-282: detect "passing-test-but-wrong-status" drift and print a plan.
   *  Implies --validate-schema (requires a spec) so we only flag drift when
   *  the body matches the OpenAPI schema — the case where retrying with the
   *  observed status would produce a green test. */
  learn?: boolean;
  /** TASK-282: actually mutate files instead of printing the plan. Requires
   *  `learn: true` and a `learnTarget`. */
  learnApply?: boolean;
  /** TASK-282: where to record the drift — rewrite YAML (`test`) or append to
   *  apis/<name>/tolerated-drifts.yaml (`drifts`). */
  learnTarget?: "test" | "drifts";
}

export async function runCommand(options: RunOptions): Promise<number> {
  if (options.paths.length === 0) {
    printError("No path given");
    return 2;
  }
  const primaryPath = options.paths[0]!;

  // 1. Parse test files from every input path (collect parse errors instead
  //    of silently skipping). Suites from all paths are merged into one run.
  let suites: TestSuite[] = [];
  const parseErrors: { file: string; error: string }[] = [];
  for (const p of options.paths) {
    try {
      const parsed = await parseSafe(p);
      suites.push(...parsed.suites);
      parseErrors.push(...parsed.errors);
    } catch (err) {
      printError(err instanceof Error ? err.message : String(err));
      return 2;
    }
  }

  for (const pe of parseErrors) {
    printWarning(`Skipped ${pe.file}: ${pe.error}`);
  }

  if (suites.length === 0) {
    const pathList = options.paths.join(", ");
    if (parseErrors.length > 0) {
      printError(`All ${parseErrors.length} test file(s) in ${pathList} failed to parse`);
      return 2;
    }
    printWarning(`No test files found in ${pathList}`);
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
  const pathStat = await stat(primaryPath).catch(() => null);
  const searchDir = pathStat?.isDirectory() ? primaryPath : dirname(primaryPath);
  let collectionForEnv: { id: number } | null = null;
  if (!options.noDb) {
    try {
      getDb(options.dbPath);
      collectionForEnv = findCollectionByTestPath(primaryPath);
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

  if (options.sessionId && !options.json) {
    process.stderr.write(`zond: session ${options.sessionId} (run will be grouped)\n`);
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

  // 3b. Resolve rate limit: CLI flag > .env.yaml `rateLimit:` > workspace
  // `defaults.rate_limit` (TASK-301) > undefined.
  let envRateLimit: number | "auto" | undefined;
  try {
    envRateLimit = (await loadEnvMeta(options.env, searchDir)).rateLimit;
  } catch { /* meta load failure is non-fatal */ }
  const rateLimit = resolveRateLimit(options.rateLimit, envRateLimit);
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
        const collection = findCollectionByTestPath(primaryPath);
        if (collection?.openapi_spec) specPath = resolveCollectionSpec(collection.openapi_spec);
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
    // TASK-282: --learn requires schema validation evidence (status mismatch
    // is only a "drift" if the body actually matches the OpenAPI contract —
    // otherwise we'd silently encourage masking a real schema bug).
    const needsSchema = options.validateSchema || options.learn;
    if (needsSchema) {
      if (!openApiDoc) {
        const flag = options.learn ? "--learn" : "--validate-schema";
        printError(`${flag} requires --spec <path|url> or a collection with openapi_spec set`);
        return 2;
      }
      schemaValidator = createSchemaValidator(openApiDoc as Parameters<typeof createSchemaValidator>[0]);
    }
  }

  // TASK-282: validate --learn flag combinations early (before run).
  if (options.learnApply && !options.learn) {
    printError("--learn-apply requires --learn");
    return 2;
  }
  if (options.learnApply && !options.learnTarget) {
    printError("--learn-apply requires --learn-target=test or --learn-target=drifts");
    return 2;
  }

  const runOpts = {
    rateLimiter,
    schemaValidator,
    networkRetries: options.retryOnNetwork,
  };

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

  // 5c. TASK-282: --learn — surface or apply status-code drift.
  if (options.learn) {
    const drifts = detectStatusDrifts(results, { schemaValidatorAttached: schemaValidator !== undefined });
    if (!options.learnApply) {
      process.stderr.write(formatDriftPlan(drifts));
    } else if (drifts.length === 0) {
      process.stderr.write("zond: --learn-apply: no drift to apply\n");
    } else if (options.learnTarget === "test") {
      const applied = await applyDriftsToTests(drifts);
      process.stderr.write(`zond: --learn-apply --learn-target=test: rewrote ${applied.updated} step(s)\n`);
      for (const e of applied.errors) {
        printWarning(`learn-apply: ${e.suite_file} step "${e.step_name}": ${e.reason}`);
      }
    } else if (options.learnTarget === "drifts") {
      // Resolve apis/<name>/ from the primary path's collection record.
      let apiDir: string | undefined;
      try {
        const collection = findCollectionByTestPath(primaryPath);
        if (collection?.base_dir) apiDir = collection.base_dir;
        else if (collection?.test_path) apiDir = dirname(collection.test_path);
      } catch { /* DB unavailable */ }
      if (!apiDir) {
        printError("--learn-target=drifts: cannot resolve apis/<name>/ — collection not registered (run `zond add api <name>`)");
        return 2;
      }
      const written = await appendToleratedDrifts(apiDir, drifts);
      process.stderr.write(`zond: --learn-apply --learn-target=drifts: wrote ${written.written} entry(ies) to ${written.file}\n`);
    }
  }

  // 6. Save to DB
  let savedRunId: number | undefined;
  if (!options.noDb) {
    try {
      getDb(options.dbPath);
      const collection = findCollectionByTestPath(primaryPath);
      // TASK-274: capture suite-level tags executed in this run (plus any
      // explicit --tag filter). Stored on the run row so
      // `coverage --union tag:<x>` can later select runs by tag.
      const tagSet = new Set<string>();
      for (const s of suites) {
        for (const t of s.tags ?? []) tagSet.add(t);
      }
      for (const t of options.tag ?? []) tagSet.add(t);
      const tags = [...tagSet].sort();
      // TASK-116: stamp CI context on the run row when running under a
      // detected CI environment (or when the user passed an explicit
      // `--trigger ci`). Manual runs default to trigger=manual with no
      // commit/branch — preserving prior behaviour.
      const ci = detectCiContext();
      savedRunId = createRun({
        started_at: results[0]?.started_at ?? new Date().toISOString(),
        environment: options.env,
        collection_id: collection?.id,
        session_id: options.sessionId,
        trigger: ci.trigger,
        commit_sha: ci.commit_sha ?? undefined,
        branch: ci.branch ?? undefined,
        ...(tags.length > 0 ? { tags } : {}),
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
        ...(s.network_retry ? { network_retry: s.network_retry } : {}),
      }))
    );
    const fiveXx = failures.filter(f => f.is_5xx).length;
    printJson(jsonOk("run", { summary: { total, passed, failed, fiveXx }, failures, warnings, runId: savedRunId }));
  }

  return hasFailures ? 1 : 0;
}

import type { Command } from "commander";
import { Option } from "commander";
import { resolveApiCollection } from "../resolve.ts";
import { collect, flatSplit, parseNonNegativeInt, parsePositiveInt, parseRateLimit, parseReporter } from "../argv.ts";
import { resolveSessionId } from "../../core/context/session.ts";
import { readCurrentApi } from "../../core/context/current.ts";
import { findWorkspaceRoot } from "../../core/workspace/root.ts";
import { existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * TASK-116: discover every `apis/<name>/tests/` directory in the workspace
 * for `zond run --all`. Skips entries without a tests/ subdir (some APIs
 * may have probes only). Returns absolute paths so the run command resolves
 * env files correctly even when invoked from a subdirectory.
 */
function discoverWorkspaceTestPaths(): { paths: string[] } | { error: string } {
  let root: string;
  try {
    const ws = findWorkspaceRoot();
    if (ws.fromFallback) {
      return { error: "--all requires a workspace marker (zond.config.yml). Run `zond init` first." };
    }
    root = ws.root;
  } catch (err) {
    return { error: `Failed to locate workspace root: ${(err as Error).message}` };
  }

  const apisDir = join(root, "apis");
  if (!existsSync(apisDir)) return { paths: [] };

  const out: string[] = [];
  for (const entry of readdirSync(apisDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const testsDir = join(apisDir, entry.name, "tests");
    if (!existsSync(testsDir)) continue;
    try {
      if (statSync(testsDir).isDirectory()) out.push(testsDir);
    } catch { /* skip unreadable */ }
  }
  return { paths: out.sort() };
}

export function registerRun(program: Command): void {
  program
    .command("run [paths...]")
    .description("Run API tests. Accepts one or more file/dir paths (shell-glob friendly: zond run tests/*.yaml).")
    .option("--env <name>", "Use environment file (.env.<name>.yaml)")
    .option("--api <name>", "Use API collection (resolves test path automatically)")
    .addOption(
      new Option("--report <format>", "Output format")
        .choices(["console", "json", "junit"])
        .default("console")
        .argParser(parseReporter),
    )
    .option("--timeout <ms>", "Override request timeout", parsePositiveInt("--timeout"))
    .option("--rate-limit <N|auto>", "Throttle requests to at most N per second, or `auto` to adapt from ratelimit-* response headers (overrides .env.yaml `rateLimit` and zond.config.yml `defaults.rate_limit`)", parseRateLimit)
    .option("--bail", "Stop on first suite failure")
    .option("--sequential", "Run regular suites one after another instead of in parallel (opt-out of Promise.all)")
    .option("--all", "TASK-116: discover every apis/<name>/tests/ directory in the workspace and merge them into a single run row (one runs.id per CI invocation, even with multiple registered APIs). Implies CI-style aggregation; pairs with auto-detected commit_sha / branch / trigger=ci.")
    .option("--no-db", "Do not save results to .zond/zond.db")
    .option("--db <path>", "Path to SQLite database file (default: .zond/zond.db)")
    .option("--auth-token <token>", "Auth token injected as {{auth_token}} variable")
    .option("--safe", "Run only GET tests (read-only, safe mode)")
    .option("--tag <tag>", "Filter suites by tag (repeatable, comma-separated)", collect, [])
    .option("--exclude-tag <tag>", "Exclude suites by tag (repeatable, comma-separated)", collect, [])
    .option("--method <method>", "Filter tests by HTTP method (e.g. GET, POST)")
    .option("--env-var <KEY=VALUE>", "Inject env variable (repeatable, overrides env file)", collect, [])
    .option("--strict-vars", "Hard-fail (exit 2) when a {{var}} reference has no producer (default: warn and continue)")
    .option("--dry-run", "Show requests without sending them (exit code always 0)")
    .option("--report-out <file>", "Write the report to a file via fs (bypass stdout). Useful when the bun wrapper or other shells contaminate stdout.")
    .option("--validate-schema", "Validate JSON responses against the OpenAPI schema (recommended for CRUD runs — catches contract drift like date-format and enum mismatches; requires --spec or a collection with openapi_spec set)")
    .option("--spec <path>", "Path or URL to OpenAPI spec used for --validate-schema (overrides the collection's openapi_spec)")
    .option("--session-id <id>", "Group this run under a session. Resolution order: --session-id flag > ZOND_SESSION_ID env > .zond/current-session file (set by 'zond session start')")
    .option("--learn", "TASK-282: detect status-code drift (passing-test-but-wrong-status). Implies --validate-schema. Without --learn-apply prints the plan; combine with --learn-apply --learn-target=test|drifts to mutate.")
    .option("--learn-apply", "Apply the drift plan instead of printing it. Requires --learn and --learn-target.")
    .addOption(
      new Option("--learn-target <where>", "What to mutate when --learn-apply is set: rewrite expect.status in YAML (test) or append to apis/<name>/tolerated-drifts.yaml (drifts)")
        .choices(["test", "drifts"]),
    )
    .option(
      "--retry-on-network <N>",
      "Auto-retry on transient network errors (ECONNRESET, EPIPE, socket hang up, fetch failed, timeout) — HTTP status codes (incl. 5xx) are NOT retried. Exponential backoff with jitter, base 250ms. Default 1, 0 disables.",
      parseNonNegativeInt("--retry-on-network"),
      1,
    )
    .action(async (pathArgs: string[] | undefined, opts, _cmd: Command) => {
      let paths = pathArgs ?? [];
      const apiFlag = (opts.api as string | undefined) ?? (paths.length > 0 || opts.all === true ? undefined : readCurrentApi() ?? undefined);
      const dbPath = typeof opts.db === "string" ? opts.db : undefined;

      // TASK-116: --all expands to every apis/<name>/tests/ directory in the
      // workspace, merging them into a single run row.
      if (opts.all === true) {
        const discovered = discoverWorkspaceTestPaths();
        if ("error" in discovered) {
          printError(discovered.error);
          process.exitCode = 2;
          return;
        }
        if (discovered.paths.length === 0) {
          printError("--all found no apis/<name>/tests/ directories in the workspace. Run `zond add api <name>` and `zond generate` first.");
          process.exitCode = 1;
          return;
        }
        paths = discovered.paths;
      }

      if (paths.length === 0 && apiFlag) {
        const resolved = resolveApiCollection(apiFlag, dbPath);
        if ("error" in resolved) {
          printError(resolved.error);
          process.exitCode = resolved.error.startsWith("Failed") ? 2 : 1;
          return;
        }
        if (!resolved.testPath) {
          printError(`API '${apiFlag}' has no test_path`);
          process.exitCode = 1;
          return;
        }
        paths = [resolved.testPath];
      }
      if (paths.length === 0) {
        printError("No path given and no current API set; run `zond use <api>`, set ZOND_API, pass --api <name>, or pass path explicitly");
        process.exitCode = 2;
        return;
      }

      const tags = flatSplit(opts.tag);
      const excludeTags = flatSplit(opts.excludeTag);
      const envVars = (opts.envVar as string[] | undefined)?.length ? (opts.envVar as string[]) : undefined;

      process.exitCode = await runCommand({
        paths,
        env: opts.env,
        report: opts.report as ReporterName,
        timeout: opts.timeout,
        rateLimit: opts.rateLimit,
        bail: opts.bail === true,
        sequential: opts.sequential === true,
        noDb: opts.db === false,
        dbPath: typeof opts.db === "string" ? opts.db : undefined,
        authToken: opts.authToken,
        safe: opts.safe === true,
        tag: tags,
        excludeTag: excludeTags,
        method: opts.method,
        envVars,
        strictVars: opts.strictVars === true,
        dryRun: opts.dryRun === true,
        reportOut: typeof opts.reportOut === "string" ? opts.reportOut : undefined,
        validateSchema: opts.validateSchema === true,
        specPath: typeof opts.spec === "string" ? opts.spec : undefined,
        sessionId: resolveSessionId({
          flag: typeof opts.sessionId === "string" ? opts.sessionId : null,
          env: process.env.ZOND_SESSION_ID ?? null,
        }) ?? undefined,
        json: false,
        retryOnNetwork: typeof opts.retryOnNetwork === "number" ? opts.retryOnNetwork : 1,
        learn: opts.learn === true,
        learnApply: opts.learnApply === true,
        learnTarget: opts.learnTarget as "test" | "drifts" | undefined,
      });
    });
}
