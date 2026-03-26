import type { TestSuite, TestStep, Environment } from "../parser/types.ts";
import { substituteString, substituteStep, substituteDeep, extractVariableReferences } from "../parser/variables.ts";
import type { TestRunResult, StepResult, HttpRequest } from "./types.ts";
import { executeRequest, type FetchOptions } from "./http-client.ts";
import { checkAssertions, extractCaptures } from "./assertions.ts";
import { evaluateExpr } from "./expr-eval.ts";
import { applyTransform } from "./transforms.ts";

function buildUrl(baseUrl: string | undefined, path: string, query?: Record<string, string>): string {
  let url = baseUrl ? `${baseUrl.replace(/\/+$/, "")}${path}` : path;
  if (query && Object.keys(query).length > 0) {
    const params = new URLSearchParams(query);
    url += `?${params.toString()}`;
  }
  return url;
}

function makeSkippedResult(stepName: string, reason: string): StepResult {
  return {
    name: stepName,
    status: "skip",
    duration_ms: 0,
    request: { method: "", url: "", headers: {} },
    assertions: [],
    captures: {},
    error: reason,
  };
}

export async function runSuite(suite: TestSuite, env: Environment = {}, dryRun = false): Promise<TestRunResult> {
  const startedAt = new Date().toISOString();
  const steps: StepResult[] = [];
  const variables: Record<string, unknown> = { ...env };
  const failedCaptures = new Set<string>();

  const fetchOptions: Partial<FetchOptions> = {
    timeout: suite.config.timeout,
    retries: suite.config.retries,
    retry_delay: suite.config.retry_delay,
    follow_redirects: suite.config.follow_redirects,
  };

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
        (expandedStep as Record<string, unknown>).__for_each_var = { key: step.for_each.var, value: items[i] };
      }
      continue;
    }

    // Inject for_each variable if present
    const forEachData = (step as Record<string, unknown>).__for_each_var as { key: string; value: unknown } | undefined;
    if (forEachData) {
      variables[forEachData.key] = forEachData.value;
      delete (step as Record<string, unknown>).__for_each_var;
    }

    // Handle set-only steps (no HTTP request)
    if (step.set && step.path === "") {
      for (const [key, rawDirective] of Object.entries(step.set)) {
        const substituted = substituteDeep(rawDirective, variables);
        variables[key] = applyTransform(substituted);
      }
      steps.push({
        name: step.name,
        status: "pass",
        duration_ms: 0,
        request: { method: "", url: "", headers: {} },
        assertions: [],
        captures: {},
      });
      continue;
    }

    // Skip check: if step references a failed capture variable, skip it
    const referencedVars = extractVariableReferences(step);
    const missingCapture = referencedVars.find((v) => failedCaptures.has(v));
    if (missingCapture) {
      steps.push(makeSkippedResult(step.name, `Depends on missing capture: ${missingCapture}`));
      continue;
    }

    // skip_if evaluation
    if (step.skip_if) {
      const exprAfterSubst = String(substituteString(step.skip_if, variables));
      if (evaluateExpr(exprAfterSubst)) {
        steps.push(makeSkippedResult(step.name, `Skipped: ${step.skip_if}`));
        continue;
      }
    }

    // Process set: on HTTP steps — evaluate generators once before building request
    if (step.set) {
      for (const [key, rawDirective] of Object.entries(step.set)) {
        const substituted = substituteDeep(rawDirective, variables);
        variables[key] = applyTransform(substituted);
      }
    }

    // Substitute variables
    const resolved = substituteStep(step, variables);

    // Build request — substitute base_url and suite headers with current variables
    const resolvedBaseUrl = suite.base_url ? substituteString(suite.base_url, variables) as string : undefined;
    const resolvedSuiteHeaders = suite.headers ? substituteDeep(suite.headers, variables) : undefined;
    const url = buildUrl(resolvedBaseUrl, resolved.path, resolved.query);
    const headers: Record<string, string> = { ...resolvedSuiteHeaders, ...resolved.headers };
    let body: string | undefined;

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
    }

    const request: HttpRequest = { method: resolved.method, url, headers, body };

    // Validate absolute URL before attempting fetch
    if (!url.startsWith("http://") && !url.startsWith("https://")) {
      steps.push({
        name: step.name,
        status: "error",
        duration_ms: 0,
        request,
        assertions: [],
        captures: {},
        error: `base_url is not configured — URL resolved to a relative path: "${url}". Set base_url in .env.yaml`,
      });
      if (step.expect.body) {
        for (const rule of Object.values(step.expect.body)) {
          if (rule.capture) failedCaptures.add(rule.capture);
        }
      }
      continue;
    }

    if (dryRun) {
      const bodyPreview = body ? ` ${body.slice(0, 200)}` : "";
      steps.push({
        name: step.name,
        status: "pass",
        duration_ms: 0,
        request,
        assertions: [],
        captures: {},
        error: `[DRY RUN] ${resolved.method} ${url}${bodyPreview}`,
      });
      continue;
    }

    // retry_until wrapper
    if (step.retry_until) {
      const rt = step.retry_until;
      let lastStepResult: StepResult | undefined;
      for (let attempt = 0; attempt < rt.max_attempts; attempt++) {
        try {
          const response = await executeRequest(request, fetchOptions);
          const captures = extractCaptures(resolved.expect.body, response.body_parsed);
          const assertions = checkAssertions(resolved.expect, response);
          const allPassed = assertions.every((a) => a.passed);

          lastStepResult = {
            name: step.name,
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
            name: step.name,
            status: "error",
            duration_ms: 0,
            request,
            assertions: [],
            captures: {},
            error: err instanceof Error ? err.message : String(err),
          };
        }
      }
      if (lastStepResult) steps.push(lastStepResult);
      continue;
    }

    try {
      const response = await executeRequest(request, fetchOptions);

      // Extract captures
      const captures = extractCaptures(resolved.expect.body, response.body_parsed);
      Object.assign(variables, captures);

      // Track expected captures that weren't obtained
      if (resolved.expect.body) {
        for (const rule of Object.values(resolved.expect.body)) {
          if (rule.capture && !(rule.capture in captures)) {
            failedCaptures.add(rule.capture);
          }
        }
      }

      // Run assertions
      const assertions = checkAssertions(resolved.expect, response);
      const allPassed = assertions.every((a) => a.passed);

      steps.push({
        name: step.name,
        status: allPassed ? "pass" : "fail",
        duration_ms: response.duration_ms,
        request,
        response,
        assertions,
        captures,
      });

      // If step failed, mark its captures as unreliable
      if (!allPassed && resolved.expect.body) {
        for (const rule of Object.values(resolved.expect.body)) {
          if (rule.capture) {
            failedCaptures.add(rule.capture);
          }
        }
      }
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      steps.push({
        name: step.name,
        status: "error",
        duration_ms: 0,
        request,
        assertions: [],
        captures: {},
        error: errorMsg,
      });

      // Mark any captures from this step as failed
      if (step.expect.body) {
        for (const rule of Object.values(step.expect.body)) {
          if (rule.capture) failedCaptures.add(rule.capture);
        }
      }
    }
  }

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

export async function runSuites(suites: TestSuite[], env: Environment = {}, dryRun = false): Promise<TestRunResult[]> {
  return Promise.all(suites.map((suite) => runSuite(suite, env, dryRun)));
}
