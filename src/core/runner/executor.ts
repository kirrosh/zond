import type { TestSuite, Environment } from "../parser/types.ts";
import { substituteString, substituteStep, substituteDeep, extractVariableReferences } from "../parser/variables.ts";
import type { TestRunResult, StepResult, HttpRequest } from "./types.ts";
import { executeRequest, type FetchOptions } from "./http-client.ts";
import { checkAssertions, extractCaptures } from "./assertions.ts";

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

  for (const step of suite.tests) {
    // Skip check: if step references a failed capture variable, skip it
    const referencedVars = extractVariableReferences(step);
    const missingCapture = referencedVars.find((v) => failedCaptures.has(v));
    if (missingCapture) {
      steps.push(makeSkippedResult(step.name, `Depends on missing capture: ${missingCapture}`));
      continue;
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
