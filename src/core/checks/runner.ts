/**
 * Pipeline that turns an OpenAPI spec into `CheckFinding`s by:
 *   1. enumerating operations,
 *   2. generating one positive-mode case per operation,
 *   3. sending the request,
 *   4. running every active check on each (case, response) pair.
 *
 * Coverage phase, negative-mode generation, async pool and rich
 * filtering land in later ARV-* tasks. The shape of `runChecks` and
 * `CheckRunData` is stabilised here so those tasks only add knobs, not
 * envelope-breaking changes.
 */
import type { OpenAPIV3 } from "openapi-types";

import { extractEndpoints, readOpenApiSpec } from "../generator/index.ts";
import type { EndpointInfo } from "../generator/types.ts";
import { generateFromSchema } from "../generator/data-factory.ts";
import { executeRequest } from "../runner/http-client.ts";
import type { HttpRequest, HttpResponse } from "../runner/types.ts";

import "./checks/index.ts"; // side-effect: register builtins
import { selectChecks, type SelectionResult } from "./registry.ts";
import {
  emptySummary,
  type Check,
  type CheckCase,
  type CheckFinding,
  type CheckRunData,
  type CheckRunSummary,
} from "./types.ts";

export interface RunChecksOptions {
  specPath: string;
  baseUrl: string;
  include?: string[];
  exclude?: string[];
  timeoutMs?: number;
  /** Limit the operation set — used by `--include`/`--exclude` regex
   *  filtering in ARV-9. ARV-1 only exposes the hook. */
  operationFilter?: (op: EndpointInfo) => boolean;
}

export interface RunChecksResult {
  data: CheckRunData;
  selection: SelectionResult;
  /** HIGH/CRITICAL findings count — drives the exit code. */
  high_or_critical: number;
}

function paramExample(_p: OpenAPIV3.ParameterObject): string {
  return "1";
}

function fillPathParams(path: string, op: EndpointInfo): string {
  return path.replace(/\{([^}]+)\}/g, (_, name) => {
    const match = op.parameters.find(
      (p) => (p as OpenAPIV3.ParameterObject).in === "path" && (p as OpenAPIV3.ParameterObject).name === name,
    );
    return match ? encodeURIComponent(paramExample(match as OpenAPIV3.ParameterObject)) : "1";
  });
}

function buildPositiveCase(op: EndpointInfo, baseUrl: string): { req: HttpRequest; case: CheckCase } {
  const url = `${baseUrl.replace(/\/+$/, "")}${fillPathParams(op.path, op)}`;
  const headers: Record<string, string> = { Accept: "application/json" };
  let body: string | undefined;
  if (op.requestBodySchema && op.method.toUpperCase() !== "GET" && op.method.toUpperCase() !== "DELETE") {
    const generated = generateFromSchema(op.requestBodySchema);
    body = JSON.stringify(generated);
    headers["Content-Type"] = op.requestBodyContentType ?? "application/json";
  }
  const req: HttpRequest = { method: op.method.toUpperCase(), url, headers, body };
  const c: CheckCase = {
    operation: op,
    request: { method: req.method, url: req.url, headers: req.headers, body: req.body },
    mode: "positive",
  };
  return { req, case: c };
}

function requestSignature(req: HttpRequest): string {
  return `${req.method} ${req.url}`;
}

function summarizeResponse(resp: HttpResponse): { status: number; content_type?: string } {
  const ct = resp.headers["content-type"] ?? resp.headers["Content-Type"];
  return { status: resp.status, content_type: ct };
}

function recordFinding(
  out: CheckFinding[],
  summary: CheckRunSummary,
  check: Check,
  c: CheckCase,
  resp: HttpResponse,
  message: string,
  evidence?: Record<string, unknown>,
): void {
  out.push({
    check: check.id,
    severity: check.severity,
    operation: { path: c.operation.path, method: c.operation.method, operationId: c.operation.operationId },
    request_signature: requestSignature({
      method: c.request.method,
      url: c.request.url,
      headers: c.request.headers,
      body: c.request.body,
    }),
    response_summary: summarizeResponse(resp),
    message,
    evidence,
  });
  summary.findings += 1;
  summary.by_severity[check.severity] += 1;
}

export async function runChecks(opts: RunChecksOptions): Promise<RunChecksResult> {
  const doc = await readOpenApiSpec(opts.specPath);
  const allOps = extractEndpoints(doc);
  const ops = opts.operationFilter ? allOps.filter(opts.operationFilter) : allOps;

  const selection = selectChecks({ include: opts.include, exclude: opts.exclude });
  const findings: CheckFinding[] = [];
  const summary = emptySummary();
  summary.operations = ops.length;
  summary.checks_run = selection.selected.length;

  for (const op of ops) {
    const { req, case: caseInfo } = buildPositiveCase(op, opts.baseUrl);

    let httpResp: HttpResponse;
    try {
      httpResp = await executeRequest(req, { timeout: opts.timeoutMs ?? 30000 });
    } catch (err) {
      // Network failure — not the same as a 5xx; surface as a finding
      // tagged on a synthetic check id so the agent can route on it.
      findings.push({
        check: "network_error",
        severity: "medium",
        operation: { path: op.path, method: op.method, operationId: op.operationId },
        request_signature: requestSignature(req),
        response_summary: { status: 0 },
        message: `Network error: ${(err as Error).message}`,
      });
      summary.findings += 1;
      summary.by_severity.medium += 1;
      continue;
    }

    summary.cases += 1;
    const checkResp = {
      status: httpResp.status,
      headers: httpResp.headers,
      body: httpResp.body_parsed ?? httpResp.body,
      duration_ms: httpResp.duration_ms,
    };
    for (const check of selection.selected) {
      if (!check.applies(op)) continue;
      const outcome = check.run({ case: caseInfo, response: checkResp });
      if (outcome.kind === "fail") {
        recordFinding(findings, summary, check, caseInfo, httpResp, outcome.message, outcome.evidence);
      }
    }
  }

  const highOrCritical = findings.filter(
    (f) => f.severity === "high" || f.severity === "critical",
  ).length;

  return {
    data: { findings, summary },
    selection,
    high_or_critical: highOrCritical,
  };
}
