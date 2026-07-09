import { dirname } from "path";
import { stat } from "node:fs/promises";
import { parseSafe } from "../../core/parser/yaml-parser.ts";
import { loadEnvironment, loadEnvMeta, loadEnvFile } from "../../core/parser/variables.ts";
import { filterSuitesByTags, excludeSuitesByTags, filterSuitesByMethod, filterSuitesByOperationFilter } from "../../core/parser/filter.ts";
import { preflightCheckVars, formatMissingVarLine, summarizeMissingVars } from "../../core/runner/preflight-vars.ts";
import { runSuite, expandParameterize } from "../../core/runner/executor.ts";
import {
  ProgressTracker,
  formatProgressLine,
  PROGRESS_INTERVAL_MS,
  PROGRESS_QUIET_MS,
} from "../../core/runner/progress-tracker.ts";
import { createSchemaValidator } from "../../core/runner/schema-validator.ts";
import { readOpenApiSpec } from "../../core/generator/openapi-reader.ts";
import { createRateLimiter, createAdaptiveRateLimiter } from "../../core/runner/rate-limiter.ts";
import { getReporter, generateJsonReport, generateJunitXml } from "../../core/reporter/index.ts";
import type { ReporterName } from "../../core/reporter/types.ts";
import { resolveOutput, OutputSpecError, type OutputSpec } from "../../core/output/index.ts";
import { writeFile, mkdir } from "node:fs/promises";
import { dirname as pathDirname, resolve as pathResolve } from "node:path";
import type { TestSuite } from "../../core/parser/types.ts";
import type { TestRunResult } from "../../core/runner/types.ts";
import { printError, printWarning } from "../output.ts";
import { jsonOk, jsonError, printJson } from "../json-envelope.ts";
import { getDb } from "../../db/schema.ts";
import { createRun, finalizeRun, saveResults, findCollectionByTestPath } from "../../db/queries.ts";
import { AUTH_PATH_RE } from "../../core/runner/auth-path.ts";
import { resolveCollectionSpec } from "../../core/setup-api.ts";
import { findWorkspaceRoot } from "../../core/workspace/root.ts";
import { existsSync } from "node:fs";
import { buildSpecPointer } from "../../core/diagnostics/spec-pointer.ts";
import { detectStatusDrifts, formatDriftPlan, applyDriftsToTests, appendToleratedDrifts } from "../../core/runner/learn-drift.ts";
import { detectCiContext } from "../../core/runner/ci-context.ts";
import { detectRunKind } from "../../core/runner/run-kind.ts";
import { resolveRateLimit } from "../../core/workspace/config.ts";

/**
 * ARV-117 (m-19): OutputSpec for `zond run`. Three formats; console is
 * the default (stdout, rich per-suite stream); `json` / `junit` default
 * to stdout but accept `--output <path>` to redirect. None of the
 * formats are envelope-wrapped — `--report json` is a test-run report
 * (per-suite breakdown), NOT the `{ok, data, errors}` envelope that
 * other commands emit for `--json`. That distinction is intentional
 * (TASK-134) and remains enforced by the explicit absence of `--json`
 * on this command.
 */
export const RUN_OUTPUT_SPEC: OutputSpec<unknown> = {
  command: "run",
  defaultFormat: "console",
  formats: {
    console: { defaultChannel: "stdout", description: "Rich per-suite stream (default)" },
    json:    { defaultChannel: "stdout", description: "Per-test JSON breakdown (`generateJsonReport`)" },
    junit:   { defaultChannel: "stdout", description: "JUnit XML — CI consumption" },
  },
};

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
  /** ARV-25: parity with `zond generate`/`zond checks run` — selector
   *  grammar `<path|method|tag|operation-id>:<value>`, repeatable, OR. */
  include?: string[];
  /** ARV-25: same grammar as `include`; evaluated after includes. */
  exclude?: string[];
  envVars?: string[];
  /** Hard-fail (exit 2) on undefined {{var}} references instead of warning. */
  strictVars?: boolean;
  dryRun?: boolean;
  json?: boolean;
  /** ARV-117: write the report to a file instead of stdout. Replaces
   *  the legacy `--report-out` flag (no alias — see m-19 lesson §E).
   *  Resolved through `core/output`'s OutputSpec policy. */
  output?: string;
  /** Validate every JSON response against the OpenAPI response schema. */
  validateSchema?: boolean;
  /** Explicit OpenAPI spec path/URL (overrides collection.openapi_spec). */
  specPath?: string;
  /** ARV-44: --api <name> passed alongside paths — used as the lookup-by-name
   *  fallback when test-path lookup in DB doesn't yield a spec. Parity with
   *  ARV-33 (probe mass-assignment / probe security). */
  apiName?: string;
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
  /** TASK-265: console reporter emits only the grand-total summary line. */
  quiet?: boolean;
  /** ARV-72 (feedback round-02 / F14): default true. Set to false (via
   *  --no-fail-on-failures) to keep exit code 0 even when steps failed —
   *  useful for advisory runs (audit pre-pass, surface discovery) where
   *  CI shouldn't break on a single test red. */
  failOnFailures?: boolean;
  /** ARV-249: hard cap on outgoing HTTP requests across the whole run.
   *  Once reached, remaining steps short-circuit to `skip` with reason
   *  `max-requests-cap-reached`. Useful for sampling huge probe-suite
   *  runs and for CI time-boxing. Each `retry_until` attempt counts as
   *  one request. */
  maxRequests?: number;
}

/** ARV-249: rough up-front estimate of the total step count for the
 *  progress reporter. Walks the parameterize cross-product so a 3×4 grid
 *  on a 50-step suite reports as 600. for_each is dynamic (depends on
 *  upstream captures) and not counted — the percentage will overshoot a
 *  little on for_each-heavy suites; acceptable for an ETA. */
function estimateTotalSteps(suites: TestSuite[]): number {
  let total = 0;
  for (const suite of suites) {
    const iters = expandParameterize(suite.parameterize).length || 1;
    total += suite.tests.length * iters;
  }
  return total;
}

export async function runCommand(options: RunOptions): Promise<number> {
  if (options.paths.length === 0) {
    printError("No path given");
    return 2;
  }
  const emptyPaths = options.paths.filter((p) => typeof p !== "string" || p.trim().length === 0);
  if (emptyPaths.length > 0) {
    printError(`Empty path argument (got ${emptyPaths.length} blank entr${emptyPaths.length === 1 ? "y" : "ies"}) — pass a non-empty file or directory path`);
    return 2;
  }
  // ARV-39: strip leading/trailing whitespace from path args so a stray space
  // from copy-paste / shell history doesn't produce an ENOENT that quotes
  // the rogue character. Mutating options.paths so downstream lookups
  // (collection by test_path, env-file search) see the cleaned form.
  options.paths = options.paths.map((p) => p.trim());

  // ARV-383: a path that does not exist on disk is a hard error, not an
  // empty (exit-0) run. Without this, `parseDirectorySafe` globs a missing
  // cwd -> 0 suites and run falls through to the ARV-357 empty-report path,
  // reporting a green 0-test "pass". Real-world trigger: a probe that matched
  // 0 fields never created its output dir, then `zond run <that-dir>` went
  // silently green. An existing-but-empty dir still flows to ARV-357.
  const missingPaths: string[] = [];
  for (const p of options.paths) {
    try {
      await stat(p);
    } catch {
      missingPaths.push(p);
    }
  }
  if (missingPaths.length > 0) {
    printError(`No such file or directory: ${missingPaths.join(", ")} — nothing to run`);
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
      const raw = err instanceof Error ? err.message : String(err);
      printError(formatPathError(p, raw));
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
    // ARV-357: an empty dir used to exit 0 and write NO --output file, so a
    // scripted pipeline saw a missing file with no error to key on. Still
    // write the requested report (empty JSON `[]` / junit tests=0 envelope)
    // so downstream stages parse "zero tests" instead of silently skipping.
    if (options.output) {
      try {
        const spec = resolveOutput(RUN_OUTPUT_SPEC, { report: options.report, output: options.output });
        if (spec.channel === "file") {
          const content = spec.format === "junit" ? generateJunitXml([]) : generateJsonReport([]);
          await mkdir(pathDirname(spec.path!), { recursive: true });
          await writeFile(spec.path!, content, "utf-8");
          process.stderr.write(`zond: empty report written to ${spec.path!} (0 tests)\n`);
        }
      } catch (err) {
        printError(`Failed to write --output file ${options.output}: ${(err as Error).message}`);
        return 2;
      }
    }
    return 0;
  }

  // ARV-37: when a selector matches zero suites (typo'd --tag, dead --include
  // pattern, etc.), exit non-zero. Previous fail-open let CI builds go green
  // for `--tag smok` instead of `smoke`. For --tag we also surface the tags
  // actually available so the user can correct without re-reading help.
  // 1b0. ARV-25: unified --include/--exclude filter (parity with generate/checks).
  //      Applied before tag/method filters so it can narrow the scope first.
  if ((options.include && options.include.length > 0) || (options.exclude && options.exclude.length > 0)) {
    const result = filterSuitesByOperationFilter(suites, options.include ?? [], options.exclude ?? []);
    if (result.errors.length > 0) {
      for (const err of result.errors) printError(err);
      return 2;
    }
    suites = result.suites;
    if (suites.length === 0) {
      const parts: string[] = [];
      if (options.include?.length) parts.push(`--include [${options.include.join(", ")}]`);
      if (options.exclude?.length) parts.push(`--exclude [${options.exclude.join(", ")}]`);
      printError(`No tests match ${parts.join(" / ")}`);
      return 1;
    }
  }

  // 1b. Tag filter
  if (options.tag && options.tag.length > 0) {
    const availableTags = collectAvailableTags(suites);
    suites = filterSuitesByTags(suites, options.tag);
    if (suites.length === 0) {
      const tagHint = availableTags.length > 0
        ? ` Available tags: ${availableTags.join(", ")}.`
        : " (loaded suites declare no tags.)";
      if (parseErrors.length > 0) {
        printError(
          `No suites match tags [${options.tag.join(", ")}] — but ${parseErrors.length} file(s) failed to parse (see warnings above). Fix parse errors and retry.${tagHint}`
        );
        return 1;
      }
      printError(`No suites match tags [${options.tag.join(", ")}].${tagHint}`);
      return 1;
    }
  }

  // 1b2. Exclude-tag filter
  if (options.excludeTag && options.excludeTag.length > 0) {
    suites = excludeSuitesByTags(suites, options.excludeTag);
    if (suites.length === 0) {
      printError(`All suites excluded by --exclude-tag [${options.excludeTag.join(", ")}]`);
      return 1;
    }
  }

  // 1b3. Method filter
  if (options.method) {
    suites = filterSuitesByMethod(suites, options.method);
    if (suites.length === 0) {
      printError(`No tests found with method ${options.method.toUpperCase()}`);
      return 1;
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
  // ARV-64 (feedback round-01 / F4): when no rate-limit was configured
  // explicitly, default to an adaptive limiter. Adaptive is a no-op until
  // a response carries RateLimit-* headers (RFC 9568) — in which case it
  // learns the policy and throttles subsequent requests so a burst can't
  // blow through small windows like small windows (e.g. 5 req/s). Without this default
  // `zond run` ignored server-published rate-limit headers entirely and
  // 22% of a typical sweep landed in 429.
  let rateLimiter: ReturnType<typeof createAdaptiveRateLimiter> | undefined;
  if (rateLimit === "auto") {
    rateLimiter = createAdaptiveRateLimiter();
  } else if (rateLimit !== undefined) {
    rateLimiter = createRateLimiter(rateLimit);
  } else {
    rateLimiter = createAdaptiveRateLimiter();
  }

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
    // ARV-44: parity with ARV-33 (probe mass-assignment / security). When the
    // user passed --api <name> together with a path, the test-path lookup
    // above may miss (path normalisation, alias, --all merge). Fall back to
    // lookup-by-name, then to apis/<name>/spec.json on disk.
    if (!specPath && options.apiName) {
      try {
        const byName = resolveApiCollection(options.apiName, options.dbPath);
        if (!("error" in byName) && byName.spec) specPath = byName.spec;
      } catch { /* fall through to disk probe */ }
      if (!specPath) {
        try {
          const ws = findWorkspaceRoot();
          const onDisk = pathResolve(ws.root, "apis", options.apiName, "spec.json");
          if (existsSync(onDisk)) specPath = onDisk;
        } catch { /* workspace not initialised — give up silently */ }
      }
    }
    // ARV-209 (R12/F11): when --validate-schema is requested but no --api was
    // passed (explicit suite path suppresses current-api fallback at the
    // argv-parse level), still try to derive the spec from the test path
    // pattern `apis/<name>/tests/...`. SKILL.md DEPTH-PASS examples use that
    // exact shape and expect the spec to resolve automatically.
    if (!specPath && primaryPath) {
      const m = primaryPath.replace(/\\/g, "/").match(/(?:^|\/)apis\/([^\/]+)\/tests(?:\/|$)/);
      if (m) {
        const apiName = m[1]!;
        try {
          const byName = resolveApiCollection(apiName, options.dbPath);
          if (!("error" in byName) && byName.spec) specPath = byName.spec;
        } catch { /* fall through to disk probe */ }
        if (!specPath) {
          try {
            const ws = findWorkspaceRoot();
            const onDisk = pathResolve(ws.root, "apis", apiName, "spec.json");
            if (existsSync(onDisk)) specPath = onDisk;
          } catch { /* give up silently */ }
        }
      }
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
        printError(
          `${flag} requires --spec <path|url> or a collection with openapi_spec set. ` +
          `Pass \`--api <name>\` (resolves apis/<name>/spec.json) or add \`--spec apis/<name>/spec.json\` explicitly.`,
        );
        return 2;
      }
      schemaValidator = createSchemaValidator(openApiDoc as Parameters<typeof createSchemaValidator>[0]);
    }
  }

  // TASK-282: validate --learn flag combinations early (before run).
  // ARV-199: --learn-apply implies --learn — cf. `git stash apply` (no
  // explicit `git stash` toggle required). The earlier hard error here
  // tripped up scripted callers that only thought to pass --learn-apply.
  if (options.learnApply && !options.learn) {
    options.learn = true;
  }
  if (options.learnApply && !options.learnTarget) {
    printError("--learn-apply requires --learn-target=test or --learn-target=drifts");
    return 2;
  }

  // ARV-249: shared HTTP-request budget. `Infinity` means uncapped.
  const requestBudget = options.maxRequests !== undefined && options.maxRequests > 0
    ? { limit: options.maxRequests, used: 0 }
    : undefined;

  // ARV-249: progress reporter. Enabled when stderr is a TTY and the user
  // hasn't opted out via --quiet. Suppressed for non-interactive output
  // (CI logs already track timestamps; an extra line every 5s is noise).
  const progressEnabled = !options.quiet
    && !options.dryRun
    && Boolean((process.stderr as { isTTY?: boolean }).isTTY);
  const totalStepsForProgress = progressEnabled
    ? estimateTotalSteps(suites)
    : 0;
  const tracker = progressEnabled
    ? new ProgressTracker(totalStepsForProgress)
    : undefined;
  let lastProgressLineLen = 0;
  const writeProgressLine = (final: boolean): void => {
    if (!tracker) return;
    const snap = tracker.snapshot();
    // Hold off on the first emit until the run has actually been running
    // a while — short test suites should stay silent.
    if (!final && snap.elapsedMs < PROGRESS_QUIET_MS) return;
    const line = formatProgressLine(snap);
    // Overwrite previous line in place (single TTY row, no scroll).
    const pad = " ".repeat(Math.max(0, lastProgressLineLen - line.length));
    process.stderr.write(`\r${line}${pad}${final ? "\n" : ""}`);
    lastProgressLineLen = line.length;
  };
  let progressInterval: ReturnType<typeof setInterval> | undefined;
  if (tracker) {
    progressInterval = setInterval(() => writeProgressLine(false), PROGRESS_INTERVAL_MS);
    // Don't let the timer pin the event loop alive past run completion.
    (progressInterval as { unref?: () => void }).unref?.();
  }

  const runOpts = {
    rateLimiter,
    schemaValidator,
    networkRetries: options.retryOnNetwork,
    requestBudget,
    onStepDone: tracker
      ? (step: import("../../core/runner/types.ts").StepResult) => tracker.recordStep(step)
      : undefined,
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
    emitMissingVarWarnings(setupHits);
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
    emitMissingVarWarnings(hits);
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

  // ARV-249: stop the progress tracker before any reporter output starts
  // — overlapping carriage returns and report lines garble the terminal.
  if (progressInterval !== undefined) {
    clearInterval(progressInterval);
    // Clear the in-place progress line so it doesn't linger above the report.
    if (lastProgressLineLen > 0) {
      process.stderr.write(`\r${" ".repeat(lastProgressLineLen)}\r`);
      lastProgressLineLen = 0;
    }
  }

  // 5. Collect warnings
  const warnings: string[] = [];
  const rateLimited = results.flatMap(r => r.steps)
    .filter(s => s.response?.status === 429);
  if (rateLimited.length > 0) {
    warnings.push(`${rateLimited.length} request(s) hit rate limit (429). Consider: consolidating login steps, adding --bail, or using retry_until with delay.`);
  }
  // ARV-249: surface --max-requests cap when it actually fired.
  if (requestBudget && requestBudget.used >= requestBudget.limit) {
    const cappedSteps = results.flatMap(r => r.steps)
      .filter(s => s.status === "skip" && s.error === "max-requests-cap-reached").length;
    if (cappedSteps > 0) {
      warnings.push(`--max-requests ${requestBudget.limit} cap reached; ${cappedSteps} subsequent step(s) skipped. Raise the cap or narrow the suite to cover them.`);
    }
  }

  // 5b. Report — ARV-117: route through core/output's OutputSpec so
  // `--report <format>` + `--output <path>` follow the same policy as
  // every other command. `--output` (was `--report-out`) is honoured for
  // any format; with `console` format it falls back to JSON in the file
  // (most useful), matching prior behaviour.
  let resolvedOutput;
  try {
    resolvedOutput = resolveOutput(RUN_OUTPUT_SPEC, {
      report: options.report,
      output: options.output,
    });
  } catch (err) {
    if (err instanceof OutputSpecError) {
      printError(err.message);
      return 2;
    }
    throw err;
  }
  if (!options.json) {
    if (resolvedOutput.channel === "file") {
      const outPath = resolvedOutput.path!;
      let content: string;
      let label: string;
      switch (resolvedOutput.format) {
        case "junit":
          content = generateJunitXml(results);
          label = "JUnit XML";
          break;
        case "json":
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
        printError(`Failed to write --output file ${outPath}: ${(err as Error).message}`);
        return 2;
      }
      for (const w of warnings) {
        printWarning(w);
      }
    } else {
      const reporter = getReporter(options.report);
      reporter.report(results, options.quiet ? { quiet: true } : undefined);
      // TASK-265: --quiet drops the warnings tail too — they are non-essential
      // run hints (deprecation, timing). Errors still reach stderr via the
      // dedicated path; --strict-vars still aborts on undefined refs before
      // we get here.
      if (!options.quiet) {
        for (const w of warnings) {
          printWarning(w);
        }
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
      // ARV-55: classify the run by what kinds of suite files it executed
      // *before* INSERT, so coverage's default query becomes a simple
      // run_kind='regular' compare instead of a per-result regex scan.
      const runKind = detectRunKind(suites.map((s) => s.filePath ?? null));
      savedRunId = createRun({
        started_at: results[0]?.started_at ?? new Date().toISOString(),
        environment: options.env,
        collection_id: collection?.id,
        session_id: options.sessionId,
        trigger: ci.trigger,
        commit_sha: ci.commit_sha ?? undefined,
        branch: ci.branch ?? undefined,
        ...(tags.length > 0 ? { tags } : {}),
        run_kind: runKind,
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

  // ARV-105 (F10): a suite where every step was skipped (e.g. probe-emitted
  // regression suite that needs an unfilled capture-chain var) reports
  // total>0, passed=0, failed=0, skipped=total. Without surfacing this,
  // CI sees "0 failed" and the run looks green even though nothing was
  // actually tested. Compute the list once and expose it in both the
  // JSON envelope and the stderr tail.
  const allSkippedSuites = results
    .filter(r => r.total > 0 && r.passed === 0 && r.failed === 0 && r.skipped === r.total)
    .map(r => ({
      suite: r.suite_name,
      ...(r.suite_file ? { file: r.suite_file } : {}),
      total: r.total,
      // Sample skip reason from the first step — usually "missing variable
      // {{X}}" or similar. Helps the operator route to fixtures vs spec.
      first_skip_reason: r.steps[0]?.error ?? null,
    }));

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
    printJson(jsonOk("run", {
      summary: { total, passed, failed, fiveXx, allSkippedSuites: allSkippedSuites.length },
      failures,
      ...(allSkippedSuites.length > 0 ? { all_skipped_suites: allSkippedSuites } : {}),
      warnings,
      runId: savedRunId,
    }));
  }

  // ARV-105 (F10): non-json — name the all-skipped suites on stderr so a
  // tail-eyeballing operator notices the visibility-pitfall. Doesn't gate
  // exit code (skipping isn't a failure) but is loud enough that a green
  // "0 failed" can no longer hide a regression suite that ran zero steps.
  if (allSkippedSuites.length > 0 && !options.json) {
    process.stderr.write(`zond: ${allSkippedSuites.length} suite(s) ran with every step skipped (no test executed — likely missing fixtures or capture-chain ids).\n`);
    for (const s of allSkippedSuites) {
      const reason = s.first_skip_reason ? ` — ${s.first_skip_reason}` : "";
      process.stderr.write(`  - ${s.suite}${s.file ? ` (${s.file})` : ""}: ${s.total} step(s) skipped${reason}\n`);
    }
  }

  // ARV-162 (round-08 F19): when suites failed parse-time validation
  // (`zond check tests` reject — e.g. form value emitted unquoted, parsed
  // as int), per-file warnings already went to stderr at the top of the
  // run, but they easily get lost in long output. Add a loud trailing
  // summary so "47/68 ran" doesn't silently hide 21 invalid files.
  if (parseErrors.length > 0 && !options.json) {
    process.stderr.write(
      `zond: ${parseErrors.length} test file(s) skipped due to validation errors — ` +
      `run \`zond check tests <path>\` to see why. Coverage numbers below exclude these files.\n`,
    );
  }

  // ARV-72 (feedback round-02 / F14): make the exit-code → failures
  // mapping visible. Tester reported "545 failed, exit_code=0" which is
  // not what this function returns — but the symptom is real: the reader
  // can't tell whether the surrounding shell or a wrapper script swallowed
  // the non-zero exit. Print a one-line tail to stderr that names the
  // exit code so wrapper scripts that hide it become obvious. Skipped in
  // --json so the JSON envelope stays alone on stdout (this is stderr
  // anyway, but skip avoids confusing parsers that capture both streams).
  if (hasFailures && !options.json) {
    // ARV-318: error steps (env_issue/network — couldn't execute) also drive
    // the non-zero exit (see hasFailures above). The old line counted only
    // `failed`, so an all-errored run printed "0 test step(s) failed —
    // exiting with code 1", a contradiction. Name both classes.
    const failed = results.reduce((s, r) => s + r.failed, 0);
    const errored = results.reduce((s, r) => s + r.steps.filter((st) => st.status === "error").length, 0);
    const parts: string[] = [];
    if (failed > 0) parts.push(`${failed} step(s) failed`);
    if (errored > 0) parts.push(`${errored} step(s) errored (couldn't execute — see failure_class)`);
    process.stderr.write(`zond: ${parts.join(", ")} — exiting with code 1 (pass --no-fail-on-failures to suppress, e.g. for advisory runs).\n`);
  }

  if (hasFailures && options.failOnFailures === false) {
    return 0;
  }
  return hasFailures ? 1 : 0;
}

import type { Command } from "commander";
import { Option } from "commander";
import { resolveApiCollection } from "../resolve.ts";
import { collect, flatSplit, parseNonNegativeInt, parsePositiveInt, parseRateLimit, parseReporter } from "../argv.ts";
import { resolveSessionId } from "../../core/context/session.ts";
import { getApi } from "../util/api-context.ts";
import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * TASK-248: when 4+ hits collapse them into one summary line per unique
 * variable name. Below threshold the per-(suite,step) form still helps
 * users locate the missing reference.
 */
function emitMissingVarWarnings(hits: import("../../core/runner/preflight-vars.ts").MissingVarHit[]): void {
  if (hits.length === 0) return;
  if (hits.length < 4) {
    for (const hit of hits) printWarning(formatMissingVarLine(hit));
    return;
  }
  for (const line of summarizeMissingVars(hits)) printWarning(line);
}

/**
 * ARV-39: rewrite an ENOENT bubbling up from `parseSafe` so the user sees
 * a clean path quote and an actionable hint. Bun's raw glob/open error
 * quotes the path with a trailing space ("'foo.yaml '"), which makes users
 * think the path itself has a typo. We strip the noise and, when the file's
 * parent directory exists, suggest either the dir form (`apis/<api>/tests`)
 * or list its YAML siblings so the right invocation is discoverable.
 */
function formatPathError(path: string, raw: string): string {
  const isEnoent = /ENOENT/i.test(raw) || /no such file or directory/i.test(raw);
  if (!isEnoent) return raw;
  const cleanPath = path.trim();
  const parent = pathDirname(cleanPath);
  const lines: string[] = [`Path not found: ${cleanPath}`];
  // Parent directory exists → list known YAML suites to make the right
  // invocation obvious. Parent missing → just say so; nothing useful to add.
  try {
    if (parent && existsSync(parent) && statSync(parent).isDirectory()) {
      const siblings = readdirSync(parent)
        .filter((f) => /\.ya?ml$/i.test(f))
        .sort();
      if (siblings.length === 0) {
        lines.push(`(${parent}/ has no YAML files — did you forget to run \`zond generate\`?)`);
      } else {
        // Prefer suggesting the directory itself — that's the parity command
        // most users actually want ("run all suites under apis/<api>/tests").
        lines.push(`Did you mean \`zond run ${parent}\` (runs ${siblings.length} suite${siblings.length === 1 ? "" : "s"})?`);
        const preview = siblings.slice(0, 6).map((s) => `  - ${parent}/${s}`).join("\n");
        const more = siblings.length > 6 ? `\n  … ${siblings.length - 6} more` : "";
        lines.push(`Known suites in ${parent}/:\n${preview}${more}`);
      }
    }
  } catch { /* readdir / stat failed — fall through with the basic message */ }
  return lines.join("\n");
}

/**
 * ARV-37: list distinct tags across loaded suites so a fail-loud `--tag`
 * mismatch can suggest the user-facing values without forcing them into
 * `--help`. Order is alphabetical for stable output across runs.
 */
function collectAvailableTags(suites: { tags?: string[] }[]): string[] {
  const seen = new Set<string>();
  for (const s of suites) {
    if (!s.tags) continue;
    for (const t of s.tags) {
      const trimmed = t.trim();
      if (trimmed) seen.add(trimmed);
    }
  }
  return [...seen].sort();
}

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
    .description(
      "Run API tests. Accepts one or more file/dir paths (shell-glob friendly: zond run tests/*.yaml). " +
      "TASK-134: this command does NOT accept `--json` (which would collide with `--report json`). " +
      "For JSON-envelope-style output use `--report json` (per-test breakdown) or `--report junit`. " +
      "Other commands (`request`, `coverage`, `db diagnose`, etc.) DO accept `--json` — there it returns " +
      "a small `{ok, data, errors}` envelope. The two flags are intentionally distinct: " +
      "`run --report json` is a test-run report, `<cmd> --json` is a query-result envelope.",
    )
    .option("--env <name>", "Use environment file (.env.<name>.yaml)")
    .option("--api <name>", "Use API collection (resolves test path automatically)")
    .addOption(
      new Option("--report <format>", "Output format")
        .choices(["console", "json", "junit"])
        .default("console")
        .argParser(parseReporter),
    )
    .option("--timeout <ms>", "Override request timeout", parsePositiveInt("--timeout"))
    .option("--rate-limit <N|auto>", "Throttle requests to at most N per second, or `auto` to adapt from ratelimit-* response headers. Default: adaptive (ARV-64) — no-op until the server publishes RateLimit-* headers, then paces requests automatically. Pass a number for hard caps; `off` is not supported (set --workers 1 + no flag for sequential).", parseRateLimit)
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
    .option(
      "--include <spec...>",
      "ARV-25: keep only steps matching <selector>:<value> (path|method|tag|operation-id). Same grammar as `zond generate` / `zond checks run`. Repeatable, combines with OR.",
    )
    .option(
      "--exclude <spec...>",
      "ARV-25: drop steps matching <selector>:<value>. Same grammar as --include. Excludes evaluated after includes.",
    )
    .option("--env-var <KEY=VALUE>", "Inject env variable (repeatable, overrides env file)", collect, [])
    .option("--strict-vars", "Hard-fail (exit 2) when a {{var}} reference has no producer (default: warn and continue)")
    .option("--dry-run", "Show requests without sending them (exit code always 0)")
    .option(
      "--quiet",
      "TASK-265: emit only the grand-total summary line — drops per-suite/per-test detail and warning footers. Exit code (0/1) still differentiates pass/fail. For CI logs and watcher loops where step-level output is noise.",
    )
    .option("--output <file>", "ARV-117: write the report to a file instead of stdout. Replaces the legacy --report-out flag. With --report console, falls back to JSON in the file (machine-parseable). Path is resolved relative to cwd; parent directories are auto-created.")
    .option("--validate-schema", "Validate JSON responses against the OpenAPI schema (recommended for CRUD runs — catches contract drift like date-format and enum mismatches; requires --spec or a collection with openapi_spec set)")
    .option("--spec <path>", "Path or URL to OpenAPI spec used for --validate-schema (overrides the collection's openapi_spec)")
    .option("--session-id <id>", "Group this run under a session. Resolution order: --session-id flag > ZOND_SESSION_ID env > .zond/current-session file (set by 'zond session start')")
    .option("--learn", "TASK-282: detect status-code drift (passing-test-but-wrong-status). Implies --validate-schema. Without --learn-apply prints the plan; combine with --learn-apply --learn-target=test|drifts to mutate.")
    .option("--learn-apply", "Apply the drift plan instead of printing it. Implies --learn; still requires --learn-target=test|drifts.")
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
    .option(
      "--no-fail-on-failures",
      "ARV-72: keep exit code 0 even when steps failed (advisory runs). Default: exit 1 on any failure. The stderr tail still names the count for visibility.",
    )
    .option(
      "--max-requests <N>",
      "ARV-249: hard cap on outgoing HTTP requests across the whole run. Once reached, remaining steps short-circuit to `skip` with reason `max-requests-cap-reached`. Each retry_until attempt counts as one request. Useful for sampling huge probe-suite runs and for CI time-boxing.",
      parsePositiveInt("--max-requests"),
    )
    .action(async (pathArgs: string[] | undefined, opts, cmd: Command) => {
      let paths = pathArgs ?? [];
      // ARV-53: explicit paths or --all suppress the current-API fallback —
      // `run path/to/test.yaml` should never silently pick up `.zond/current-api`.
      // Otherwise resolve via cli/util/api-context.ts.
      const apiFlag = (paths.length > 0 || opts.all === true)
        ? (opts.api as string | undefined)
        : getApi(cmd, opts);
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
      const includeSpecs = (opts.include as string[] | undefined)?.length ? (opts.include as string[]) : undefined;
      const excludeSpecs = (opts.exclude as string[] | undefined)?.length ? (opts.exclude as string[]) : undefined;

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
        include: includeSpecs,
        exclude: excludeSpecs,
        envVars,
        strictVars: opts.strictVars === true,
        dryRun: opts.dryRun === true,
        quiet: opts.quiet === true,
        failOnFailures: opts.failOnFailures !== false,
        output: typeof opts.output === "string" ? opts.output : undefined,
        validateSchema: opts.validateSchema === true,
        specPath: typeof opts.spec === "string" ? opts.spec : undefined,
        apiName: apiFlag,
        sessionId: resolveSessionId({
          flag: typeof opts.sessionId === "string" ? opts.sessionId : null,
          env: process.env.ZOND_SESSION_ID ?? null,
        }) ?? undefined,
        json: false,
        retryOnNetwork: typeof opts.retryOnNetwork === "number" ? opts.retryOnNetwork : 1,
        learn: opts.learn === true,
        learnApply: opts.learnApply === true,
        learnTarget: opts.learnTarget as "test" | "drifts" | undefined,
        maxRequests: typeof opts.maxRequests === "number" ? opts.maxRequests : undefined,
      });
    });
}
