import { resolve, dirname, basename } from "node:path";
import type { TestSuite, TestStep, Environment, SourceMetadata } from "../parser/types.ts";
import { substituteString, substituteStep, substituteDeep, extractVariableReferences } from "../parser/variables.ts";
import type { TestRunResult, StepResult, HttpRequest } from "./types.ts";
import { executeRequest, type FetchOptions } from "./http-client.ts";
import type { RateLimiter } from "./rate-limiter.ts";
import { checkAssertions, extractCaptures } from "./assertions.ts";
import { evaluateExpr } from "./expr-eval.ts";
import { applyTransform } from "./transforms.ts";
import type { SchemaValidator } from "./schema-validator.ts";
import { classifyFailure } from "../diagnostics/failure-class.ts";

function buildUrl(baseUrl: string | undefined, path: string, query?: Record<string, string>): string {
  let url = baseUrl ? `${baseUrl.replace(/\/+$/, "")}${path}` : path;
  if (query && Object.keys(query).length > 0) {
    const params = new URLSearchParams(query);
    url += `?${params.toString()}`;
  }
  return url;
}

/** Shallow-merge suite-level и step-level provenance. Step перекрывает suite. */
export function mergeProvenance(
  suiteSrc?: SourceMetadata,
  stepSrc?: SourceMetadata,
): SourceMetadata | null {
  if (!suiteSrc && !stepSrc) return null;
  return { ...(suiteSrc ?? {}), ...(stepSrc ?? {}) };
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
}

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
  };

  const fetchOptions: Partial<FetchOptions> = {
    timeout: suite.config.timeout,
    retries: suite.config.retries,
    retry_delay: suite.config.retry_delay,
    follow_redirects: suite.config.follow_redirects,
    rate_limiter: options.rateLimiter,
  };

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
        pushStep(makeSkippedResult(interpolateName(step.name, variables), `Skipped: ${step.skip_if}`), step);
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
        try {
          const response = await executeRequest(request, fetchOptions);
          const captures = extractCaptures(resolved.expect.body, response.body_parsed, resolved.expect.headers, response.headers);
          const assertions = checkAssertions(resolved.expect, response);
          if (options.schemaValidator && response.body_parsed !== undefined) {
            assertions.push(...options.schemaValidator.validate(resolved.method, resolved.path, response.status, response.body_parsed));
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
      const assertions = checkAssertions(resolved.expect, response);
      if (options.schemaValidator && response.body_parsed !== undefined) {
        assertions.push(...options.schemaValidator.validate(resolved.method, resolved.path, response.status, response.body_parsed));
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
    steps,
  };
}

export async function runSuites(
  suites: TestSuite[],
  env: Environment = {},
  dryRun = false,
  options: RunSuiteOptions = {},
): Promise<TestRunResult[]> {
  return Promise.all(suites.map((suite) => runSuite(suite, env, dryRun, options)));
}
