import { resolve, dirname, basename } from "node:path";
import type { TestSuite, TestStep, Environment, SourceMetadata, AssertionRule } from "../parser/types.ts";
import { substituteString, substituteStep, substituteDeep, extractVariableReferences, UNSAFE_ARM_VAR } from "../parser/variables.ts";
import type { TestRunResult, StepResult, HttpRequest, AssertionResult } from "./types.ts";
import { executeRequest, type FetchOptions } from "./http-client.ts";
import type { RateLimiter } from "./rate-limiter.ts";
import { checkAssertions, extractCaptures, findMissedCaptures } from "./assertions.ts";
import { evaluateExpr } from "./expr-eval.ts";
import { applyTransform } from "./transforms.ts";
import type { SchemaValidator } from "./schema-validator.ts";
import { classifyFailure } from "../diagnostics/failure-class.ts";
import { buildUrl } from "../util/url.ts";

/** Shallow-merge suite-level и step-level provenance. Step перекрывает suite. */
function mergeProvenance(
  suiteSrc?: SourceMetadata,
  stepSrc?: SourceMetadata,
): SourceMetadata | null {
  if (!suiteSrc && !stepSrc) return null;
  return { ...(suiteSrc ?? {}), ...(stepSrc ?? {}) };
}

/** ARV-157: build the top-level `schema_validation` summary for a step that
 *  was run with `--validate-schema`. Mirrors the shape `zond request
 *  --validate-schema` already produces (see src/cli/commands/request.ts);
 *  consumers can `jq '.steps[] | .schema_validation'` instead of digging
 *  into `assertions[] | select(.kind=="schema")`.
 *
 *  Returns undefined when the validator wasn't attached or the response had
 *  no parseable JSON body — same precondition as `assertions.push(...)` at
 *  the call site, so the summary is present iff schema actually ran. */
function buildSchemaValidationSummary(
  validator: SchemaValidator,
  method: string,
  path: string,
  status: number,
  schemaAssertions: AssertionResult[],
): StepResult["schema_validation"] {
  const ins = validator.inspect(method, path, status);
  if (!ins.matchedEndpoint) {
    return { result: "no-endpoint", matched_endpoint: null, matched_response_status: null, error_count: 0 };
  }
  if (!ins.hasJsonSchema) {
    return {
      result: "no-schema",
      matched_endpoint: ins.matchedEndpoint,
      matched_response_status: ins.matchedResponseStatus,
      error_count: 0,
    };
  }
  const failed = schemaAssertions.filter((a) => !a.passed).length;
  return {
    result: failed === 0 ? "PASS" : "FAIL",
    matched_endpoint: ins.matchedEndpoint,
    matched_response_status: ins.matchedResponseStatus,
    error_count: failed,
  };
}

/** TASK-256: turn each missed-capture (path didn't resolve in response)
 *  into an auxiliary failed assertion. The step then fails loudly with
 *  "capture <var>: path '<path>' not found in body" instead of producing
 *  silent `captures: {}` that the user only notices when the next step in a
 *  CRUD chain skips with `Depends on missing capture`. */
function buildMissedCaptureAssertions(
  misses: ReturnType<typeof findMissedCaptures>,
): AssertionResult[] {
  return misses.map((m) => ({
    field: `capture ${m.var}`,
    rule: m.source === "body" ? "body-path-exists" : "header-exists",
    passed: false,
    actual: undefined,
    expected: `${m.source} '${m.path}' present`,
    kind: "auxiliary",
  }));
}

function collectChainCaptures(tests: TestStep[]): Set<string> {
  const out = new Set<string>();
  const visit = (rules: Record<string, AssertionRule> | undefined) => {
    if (!rules) return;
    for (const r of Object.values(rules)) {
      if (r.capture) out.add(r.capture);
      if (r.each) visit(r.each);
      if (r.contains_item) visit(r.contains_item);
    }
  };
  for (const step of tests) visit(step.expect?.body);
  return out;
}

/** ARV-414: first {{var}} that survived substitution in the resolved request
 *  (path or query) — i.e. a fixture var with no producer. `$`-generators are
 *  excluded (they resolve or throw earlier). Returns null when the request is
 *  fully resolved. */
function firstUnresolvedRequestVar(path: string, query: unknown): string | null {
  const scan = (s: string): string | null => {
    for (const m of s.matchAll(/\{\{([^{}]+)\}\}/g)) {
      const k = m[1]!.trim();
      if (!k.startsWith("$")) return k;
    }
    return null;
  };
  const inPath = scan(path);
  if (inPath) return inPath;
  if (query && typeof query === "object") {
    for (const v of Object.values(query as Record<string, unknown>)) {
      if (typeof v === "string") {
        const hit = scan(v);
        if (hit) return hit;
      }
    }
  }
  return null;
}

function emptyVarSkipReason(varName: string, chainCaptures: Set<string>): string {
  return chainCaptures.has(varName)
    ? `chain capture {{${varName}}} unbound (upstream step did not run or did not capture it)`
    : `required fixture {{${varName}}} is empty`;
}

function makeSkippedResult(
  stepName: string,
  reason: string,
  opts?: { cascade?: { missingCapture: string } },
): StepResult {
  const result: StepResult = {
    name: stepName,
    status: "skip",
    duration_ms: 0,
    request: { method: "", url: "", headers: {} },
    assertions: [],
    captures: {},
    error: reason,
  };
  if (opts?.cascade) {
    result.failure_class = "cascade";
    result.failure_class_reason = `Upstream capture not produced: ${opts.cascade.missingCapture}`;
  }
  return result;
}

/** Interpolate {{var}} placeholders inside a test/step name. Falls back to
 *  the raw name string if substitution returns a non-string value. */
function interpolateName(name: string, vars: Record<string, unknown>): string {
  try {
    const out = substituteString(name, vars);
    return typeof out === "string" ? out : String(out);
  } catch {
    return name;
  }
}

/**
 * Expand a `parameterize: { key: [val, ...] }` map into the cross-product of
 * iteration variable bindings. No `parameterize` (or an empty map) yields a
 * single empty iteration so the existing single-pass behaviour is preserved.
 *
 * Exported for tests.
 */
export function expandParameterize(params?: Record<string, unknown[]>): Record<string, unknown>[] {
  if (!params) return [{}];
  const keys = Object.keys(params).filter(k => Array.isArray(params[k]) && (params[k] as unknown[]).length > 0);
  if (keys.length === 0) return [{}];
  let combos: Record<string, unknown>[] = [{}];
  for (const k of keys) {
    const values = params[k] as unknown[];
    const next: Record<string, unknown>[] = [];
    for (const combo of combos) {
      for (const v of values) {
        next.push({ ...combo, [k]: v });
      }
    }
    combos = next;
  }
  return combos;
}

export interface RunSuiteOptions {
  rateLimiter?: RateLimiter;
  /** Optional OpenAPI response-schema validator. When provided, every step's
   *  parsed JSON body is validated against the matching schema; failures are
   *  appended to the step's `assertions`. */
  schemaValidator?: SchemaValidator;
  /** TASK-144: per-step network-retry budget used by http-client for
   *  ECONNRESET / EPIPE / `socket hang up` / `fetch failed` / abort cases.
   *  Set by `zond run --retry-on-network <N>`. HTTP statuses are not retried
   *  by this path. */
  networkRetries?: number;
  /** ARV-249: shared HTTP-request budget across all parallel suites. When
   *  `used >= limit`, remaining steps short-circuit to `skip` with reason
   *  `max-requests-cap-reached`. Each `retry_until` attempt counts as one
   *  request; dry-run and set-only steps do not consume the budget. */
  requestBudget?: RequestBudget;
  /** ARV-249: invoked after every step completes (pass/fail/skip/error) so
   *  the CLI can render a periodic progress line without each suite
   *  knowing how many siblings are running in parallel. */
  onStepDone?: (step: StepResult) => void;
}

/** ARV-249: shared `--max-requests` budget. Mutated in-place by every
 *  parallel `runSuite` call — single-threaded JS makes the
 *  check-then-increment race-free. `limit === Infinity` means "uncapped"
 *  (the default). */
export interface RequestBudget {
  limit: number;
  used: number;
}

/** Try to reserve one HTTP slot from the shared budget. Returns true if
 *  the caller may proceed, false if the cap has been reached. */
export function reserveRequest(budget: RequestBudget | undefined): boolean {
  if (!budget) return true;
  if (budget.used >= budget.limit) return false;
  budget.used += 1;
  return true;
}

export const MAX_REQUESTS_SKIP_REASON = "max-requests-cap-reached";

export async function runSuite(
  suite: TestSuite,
  env: Environment = {},
  dryRun = false,
  options: RunSuiteOptions = {},
): Promise<TestRunResult> {
  const startedAt = new Date().toISOString();
  const steps: StepResult[] = [];

  /** Push a step result, attaching provenance + failure classification. */
  const pushStep = (result: StepResult, currentStep?: TestStep): void => {
    const merged = mergeProvenance(suite.source, currentStep?.source);
    if (merged !== null) result.provenance = merged;
    const classification = classifyFailure(result);
    if (classification) {
      result.failure_class = classification.failure_class;
      result.failure_class_reason = classification.failure_class_reason;
    }
    steps.push(result);
    if (options.onStepDone) options.onStepDone(result);
  };

  const fetchOptions: Partial<FetchOptions> = {
    timeout: suite.config.timeout,
    retries: suite.config.retries,
    retry_delay: suite.config.retry_delay,
    follow_redirects: suite.config.follow_redirects,
    rate_limiter: options.rateLimiter,
    ...(options.networkRetries !== undefined ? { network_retries: options.networkRetries } : {}),
  };

  // Names of every variable a step in this suite tries to capture from a
  // response (expect.body.<field>.capture: <name>). When a later step
  // references one of these and the value is empty — under --dry-run, or
  // because the capturing step was skipped — the missing var is a chain
  // capture, NOT a fixture in .env.yaml. Distinguishing them in the skip
  // message stops users from chasing fixture seeding for vars that
  // shouldn't live in .env.yaml at all.
  const chainCaptures = collectChainCaptures(suite.tests);

  // parameterize cross-product → N iterations of the suite body.
  // Captures and tainted/missing sets are reset per iteration so that
  // values from one binding never leak into the next.
  const iterations = expandParameterize(suite.parameterize);

  for (const iterVars of iterations) {
  const variables: Record<string, unknown> = { ...env, ...iterVars };
  // Captures whose source step's assertions partially failed, but the value
  // itself was extracted. Cleanup/always steps may still consume them.
  const taintedCaptures = new Set<string>();
  // Captures that were never extracted (response missing the field). Even
  // always-steps can't run if their referenced capture is missing.
  const missingCaptures = new Set<string>();

  // Expand steps lazily (for_each needs current variables)
  let stepIndex = 0;
  const rawSteps = [...suite.tests];

  while (stepIndex < rawSteps.length) {
    const step = rawSteps[stepIndex]!;
    stepIndex++;

    // Expand for_each: insert expanded steps and skip current
    if (step.for_each) {
      const resolvedIn = substituteDeep(step.for_each.in, variables);
      const items = Array.isArray(resolvedIn) ? resolvedIn : [];
      const expanded: TestStep[] = [];
      for (const item of items) {
        const { for_each: _, ...rest } = step;
        expanded.push({ ...rest, name: `${step.name} [${step.for_each.var}=${JSON.stringify(item)}]` } as TestStep);
        // We'll inject the variable right before executing each expanded step
        // Store the var assignment via a set field
      }
      // Insert expanded steps at current position
      rawSteps.splice(stepIndex, 0, ...expanded);
      // Set the for_each variable for each expanded step
      for (let i = 0; i < items.length; i++) {
        const expandedStep = rawSteps[stepIndex + i]!;
        // Temporarily inject into variables when we reach this step
        // We need a way to pass the variable — use a hidden _for_each_vars
        (expandedStep as unknown as Record<string, unknown>).__for_each_var = { key: step.for_each.var, value: items[i] };
      }
      continue;
    }

    // Inject for_each variable if present
    const forEachData = (step as unknown as Record<string, unknown>).__for_each_var as { key: string; value: unknown } | undefined;
    if (forEachData) {
      variables[forEachData.key] = forEachData.value;
      delete (step as unknown as Record<string, unknown>).__for_each_var;
    }

    // Handle set-only steps (no HTTP request)
    if (step.set && step.path === "") {
      for (const [key, rawDirective] of Object.entries(step.set)) {
        const substituted = substituteDeep(rawDirective, variables);
        variables[key] = applyTransform(substituted);
      }
      pushStep({
        name: interpolateName(step.name, variables),
        status: "pass",
        duration_ms: 0,
        request: { method: "", url: "", headers: {} },
        assertions: [],
        captures: {},
      }, step);
      continue;
    }

    // Skip check: if step references a failed capture, skip — unless
    // step is `always: true` AND the capture is just tainted (still extracted).
    const referencedVars = extractVariableReferences(step);
    const missing = referencedVars.find((v) => missingCaptures.has(v));
    if (missing) {
      pushStep(
        makeSkippedResult(
          interpolateName(step.name, variables),
          `Depends on missing capture: ${missing}`,
          { cascade: { missingCapture: missing } },
        ),
        step,
      );
      continue;
    }
    if (!step.always) {
      const tainted = referencedVars.find((v) => taintedCaptures.has(v));
      if (tainted) {
        pushStep(
          makeSkippedResult(
            interpolateName(step.name, variables),
            `Depends on tainted capture: ${tainted} (use always: true on cleanup steps)`,
            { cascade: { missingCapture: tainted } },
          ),
          step,
        );
        continue;
      }
    }

    // skip_if evaluation
    if (step.skip_if) {
      const exprAfterSubst = String(substituteString(step.skip_if, variables));
      if (evaluateExpr(exprAfterSubst)) {
        const varMatch = step.skip_if.match(/\{\{([^{}]+)\}\}/);
        const skipVar = varMatch?.[1]!.trim();
        const skipMsg = skipVar === UNSAFE_ARM_VAR
          ? `unsafe destructive op disarmed — set ${UNSAFE_ARM_VAR}=1 in .env.yaml to run (ARV-412)`
          : skipVar
          ? emptyVarSkipReason(skipVar, chainCaptures)
          : step.skip_if;
        pushStep(makeSkippedResult(interpolateName(step.name, variables), skipMsg), step);
        continue;
      }
    }

    // Process set: on HTTP steps — evaluate generators once before building request.
    // Substitution can throw on unknown {{$generator}} — fail this step, not the suite.
    let resolved: TestStep;
    let resolvedBaseUrl: string | undefined;
    let resolvedSuiteHeaders: Record<string, string> | undefined;
    try {
      if (step.set) {
        for (const [key, rawDirective] of Object.entries(step.set)) {
          const substituted = substituteDeep(rawDirective, variables);
          variables[key] = applyTransform(substituted);
        }
      }
      resolved = substituteStep(step, variables);
      resolvedBaseUrl = suite.base_url ? substituteString(suite.base_url, variables) as string : undefined;
      resolvedSuiteHeaders = suite.headers ? substituteDeep(suite.headers, variables) : undefined;
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      pushStep({
        name: interpolateName(step.name, variables),
        status: "error",
        duration_ms: 0,
        request: { method: step.method, url: step.path, headers: {} },
        assertions: [],
        captures: {},
        error: errorMsg,
      }, step);
      // Substitution never produced a request → capture truly missing.
      if (step.expect.body) {
        for (const rule of Object.values(step.expect.body)) {
          if (rule.capture) missingCaptures.add(rule.capture);
        }
      }
      continue;
    }
    // Skip if any path-variable in the template resolved to empty — an empty
    // path segment produces URLs like /repos//commits/ which always 404/500.
    // The explicit skip_if guard only covers the first param (TASK-237);
    // this catches all others.
    {
      let emptyVar: string | null = null;
      for (const m of step.path.matchAll(/\{\{([^{}]+)\}\}/g)) {
        const varName = m[1]!.trim();
        const val = variables[varName];
        if (val === "" || val === null || val === undefined) { emptyVar = varName; break; }
      }
      if (emptyVar) {
        pushStep(makeSkippedResult(
          interpolateName(step.name, variables),
          emptyVarSkipReason(emptyVar, chainCaptures),
        ), step);
        continue;
      }
    }
    // ARV-414: fail-fast on an unresolved REQUEST var. A {{var}} with no
    // producer survives substitution as a literal in the path/query (the
    // empty-var guard above only catches vars present-but-empty in `variables`,
    // and only in the path). Sending it hits a bogus URL and — for retry_until
    // steps — spins the whole max_attempts × delay_ms budget on a resource that
    // can never exist (the 14-min hang). Skip before buildUrl / the retry loop.
    {
      const unresolved = firstUnresolvedRequestVar(resolved.path, resolved.query);
      if (unresolved) {
        pushStep(makeSkippedResult(
          interpolateName(step.name, variables),
          `unresolved variable {{${unresolved}}} in request — no producer (env/capture/generator)`,
        ), step);
        if (step.expect.body) {
          for (const rule of Object.values(step.expect.body)) {
            if (rule.capture) missingCaptures.add(rule.capture);
          }
        }
        continue;
      }
    }

    const url = buildUrl(resolvedBaseUrl, resolved.path, resolved.query);
    const headers: Record<string, string> = { ...resolvedSuiteHeaders, ...resolved.headers };
    let body: string | undefined;
    let formData: FormData | undefined;

    if (resolved.json !== undefined) {
      body = JSON.stringify(resolved.json);
      if (!headers["Content-Type"] && !headers["content-type"]) {
        headers["Content-Type"] = "application/json";
      }
    } else if (resolved.form) {
      body = new URLSearchParams(resolved.form).toString();
      if (!headers["Content-Type"] && !headers["content-type"]) {
        headers["Content-Type"] = "application/x-www-form-urlencoded";
      }
    } else if (resolved.multipart) {
      const basedir = suite.filePath ? dirname(suite.filePath) : process.cwd();
      formData = new FormData();
      for (const [key, field] of Object.entries(resolved.multipart)) {
        if (typeof field === "string") {
          formData.append(key, field);
        } else {
          const absPath = resolve(basedir, field.file);
          const buf = await Bun.file(absPath).arrayBuffer();
          const mime = field.content_type ?? "application/octet-stream";
          const filename = field.filename ?? basename(absPath);
          formData.append(key, new Blob([buf], { type: mime }), filename);
        }
      }
    }

    const request: HttpRequest = { method: resolved.method, url, headers, body, formData };

    // Validate absolute URL before attempting fetch
    if (!url.startsWith("http://") && !url.startsWith("https://")) {
      pushStep({
        name: interpolateName(step.name, variables),
        status: "error",
        duration_ms: 0,
        request,
        assertions: [],
        captures: {},
        error: `base_url is not configured — URL resolved to a relative path: "${url}". Set base_url in .env.yaml`,
      }, step);
      if (step.expect.body) {
        for (const rule of Object.values(step.expect.body)) {
          if (rule.capture) missingCaptures.add(rule.capture);
        }
      }
      continue;
    }

    if (dryRun) {
      const bodyPreview = formData
        ? ` [multipart: ${[...formData.keys()].length} field(s)]`
        : body ? ` ${body.slice(0, 200)}` : "";
      pushStep({
        name: interpolateName(step.name, variables),
        status: "pass",
        duration_ms: 0,
        request,
        assertions: [],
        captures: {},
        error: `[DRY RUN] ${resolved.method} ${url}${bodyPreview}`,
      }, step);
      continue;
    }

    // retry_until wrapper
    if (step.retry_until) {
      const rt = step.retry_until;
      let lastStepResult: StepResult | undefined;
      for (let attempt = 0; attempt < rt.max_attempts; attempt++) {
        if (!reserveRequest(options.requestBudget)) {
          lastStepResult = makeSkippedResult(
            interpolateName(step.name, variables),
            MAX_REQUESTS_SKIP_REASON,
          );
          break;
        }
        try {
          const response = await executeRequest(request, fetchOptions);
          const captures = extractCaptures(resolved.expect.body, response.body_parsed, resolved.expect.headers, response.headers);
          const missedCaps = findMissedCaptures(resolved.expect.body, response.body_parsed, resolved.expect.headers, response.headers);
          const assertions = checkAssertions(resolved.expect, response);
          assertions.push(...buildMissedCaptureAssertions(missedCaps));
          let schemaValidationSummary: StepResult["schema_validation"] | undefined;
          if (options.schemaValidator && response.body_parsed !== undefined) {
            const schemaAssertions = options.schemaValidator.validate(resolved.method, resolved.path, response.status, response.body_parsed);
            assertions.push(...schemaAssertions);
            schemaValidationSummary = buildSchemaValidationSummary(
              options.schemaValidator,
              resolved.method,
              resolved.path,
              response.status,
              schemaAssertions,
            );
          }
          const allPassed = assertions.every((a) => a.passed);

          lastStepResult = {
            name: interpolateName(step.name, variables),
            status: allPassed ? "pass" : "fail",
            duration_ms: response.duration_ms,
            request,
            response,
            assertions,
            captures,
            ...(response.network_retry_count && response.network_retry_count > 0
              ? { network_retry: response.network_retry_count }
              : {}),
            ...(schemaValidationSummary ? { schema_validation: schemaValidationSummary } : {}),
          };

          // Evaluate condition with response context
          const condVars: Record<string, unknown> = { ...variables, ...captures, status: response.status };
          if (response.body_parsed && typeof response.body_parsed === "object") {
            for (const [k, v] of Object.entries(response.body_parsed as Record<string, unknown>)) {
              condVars[k] = v;
            }
          }
          const condStr = String(substituteString(rt.condition, condVars));
          if (evaluateExpr(condStr)) {
            Object.assign(variables, captures);
            break;
          }

          if (attempt < rt.max_attempts - 1) {
            await new Promise((resolve) => setTimeout(resolve, rt.delay_ms));
          }
        } catch (err) {
          lastStepResult = {
            name: interpolateName(step.name, variables),
            status: "error",
            duration_ms: 0,
            request,
            assertions: [],
            captures: {},
            error: err instanceof Error ? err.message : String(err),
          };
        }
      }
      if (lastStepResult) pushStep(lastStepResult, step);
      continue;
    }

    if (!reserveRequest(options.requestBudget)) {
      pushStep(makeSkippedResult(
        interpolateName(step.name, variables),
        MAX_REQUESTS_SKIP_REASON,
      ), step);
      continue;
    }

    try {
      const response = await executeRequest(request, fetchOptions);

      // Extract captures (body + header)
      const captures = extractCaptures(resolved.expect.body, response.body_parsed, resolved.expect.headers, response.headers);
      Object.assign(variables, captures);

      // Track expected captures that weren't obtained — these are missing.
      if (resolved.expect.body) {
        for (const rule of Object.values(resolved.expect.body)) {
          if (rule.capture && !(rule.capture in captures)) {
            missingCaptures.add(rule.capture);
          }
        }
      }

      // Run assertions
      const missedCaps = findMissedCaptures(resolved.expect.body, response.body_parsed, resolved.expect.headers, response.headers);
      const assertions = checkAssertions(resolved.expect, response);
      assertions.push(...buildMissedCaptureAssertions(missedCaps));
      let schemaValidationSummary: StepResult["schema_validation"] | undefined;
      if (options.schemaValidator && response.body_parsed !== undefined) {
        const schemaAssertions = options.schemaValidator.validate(resolved.method, resolved.path, response.status, response.body_parsed);
        assertions.push(...schemaAssertions);
        schemaValidationSummary = buildSchemaValidationSummary(
          options.schemaValidator,
          resolved.method,
          resolved.path,
          response.status,
          schemaAssertions,
        );
      }
      const allPassed = assertions.every((a) => a.passed);

      pushStep({
        name: interpolateName(step.name, variables),
        status: allPassed ? "pass" : "fail",
        duration_ms: response.duration_ms,
        request,
        response,
        assertions,
        captures,
        ...(response.network_retry_count && response.network_retry_count > 0
          ? { network_retry: response.network_retry_count }
          : {}),
        ...(schemaValidationSummary ? { schema_validation: schemaValidationSummary } : {}),
      }, step);

      // If step failed, captures that did extract are tainted (value is real
      // but came from a step whose other assertions failed). Always-steps may
      // still consume them; non-always steps cascade-skip.
      if (!allPassed && resolved.expect.body) {
        for (const rule of Object.values(resolved.expect.body)) {
          if (rule.capture && rule.capture in captures) {
            taintedCaptures.add(rule.capture);
          }
        }
      }
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      pushStep({
        name: interpolateName(step.name, variables),
        status: "error",
        duration_ms: 0,
        request,
        assertions: [],
        captures: {},
        error: errorMsg,
      }, step);

      // Network/runtime error → no response → capture truly missing.
      if (step.expect.body) {
        for (const rule of Object.values(step.expect.body)) {
          if (rule.capture) missingCaptures.add(rule.capture);
        }
      }
    }
  }
  } // end of parameterize iteration loop

  const finishedAt = new Date().toISOString();
  return {
    suite_name: suite.name,
    suite_tags: suite.tags,
    suite_description: suite.description,
    suite_file: suite.filePath,
    started_at: startedAt,
    finished_at: finishedAt,
    total: steps.length,
    passed: steps.filter((s) => s.status === "pass").length,
    failed: steps.filter((s) => s.status === "fail").length,
    skipped: steps.filter((s) => s.status === "skip").length,
    // ARV-318: surface error steps so total = passed+failed+skipped+errored.
    errored: steps.filter((s) => s.status === "error").length,
    steps,
  };
}
