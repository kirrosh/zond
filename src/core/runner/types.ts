export type StepStatus = "pass" | "fail" | "skip" | "error";

export interface HttpRequest {
  method: string;
  url: string;
  headers: Record<string, string>;
  body?: string;
  formData?: FormData;
}

export interface HttpResponse {
  status: number;
  headers: Record<string, string>;
  body: string;
  body_parsed?: unknown;
  duration_ms: number;
  /** TASK-144: number of network-level retries that preceded this response.
   *  0 when the request succeeded on the first attempt. */
  network_retry_count?: number;
}

/**
 * `kind` lets the UI surface the assertion that matches the test's stated
 * intent (primary) ahead of OpenAPI schema noise (schema) and housekeeping
 * checks like duration/header asserts (auxiliary). Optional for backwards
 * compatibility — older runs render as `primary` by default.
 */
export type AssertionKind = "primary" | "schema" | "auxiliary";

export interface AssertionResult {
  field: string;
  rule: string;
  passed: boolean;
  actual: unknown;
  expected: unknown;
  kind?: AssertionKind;
}

export interface StepResult {
  name: string;
  status: StepStatus;
  duration_ms: number;
  request: HttpRequest;
  response?: HttpResponse;
  assertions: AssertionResult[];
  captures: Record<string, unknown>;
  error?: string;
  provenance?: import("../parser/types.ts").SourceMetadata | null;
  /** TASK-101: classification of why this failure happened — definitely_bug,
   *  likely_bug, quirk, env_issue. `null` for passed/skipped/unclassifiable. */
  failure_class?: import("../diagnostics/failure-class.ts").FailureClass | null;
  failure_class_reason?: string | null;
  /** TASK-102: JSON Pointer into the OpenAPI doc + frozen excerpt of the
   *  schema at that pointer. Captured at run time so later spec edits don't
   *  rewrite history. `null` for manual YAML or when spec isn't available. */
  spec_pointer?: string | null;
  spec_excerpt?: string | null;
  /** TASK-144: how many network-level retries the http-client performed
   *  before this step settled. Omitted (or 0) when no retry was needed.
   *  Surfaced in the JSON report so flaky-network steps are visible. */
  network_retry?: number;
  /** ARV-157: summary of `--validate-schema` outcome for this step. Present
   *  only when the runner had a schema validator attached AND a JSON body
   *  was returned (so consumers can distinguish "no drift" from "never
   *  validated"). Granular failures still live in `assertions[]` with
   *  `kind: "schema"`; this block is the at-a-glance shape skill docs
   *  describe and JSON-report consumers grep for. */
  schema_validation?: {
    result: "PASS" | "FAIL" | "no-endpoint" | "no-schema";
    matched_endpoint: { method: string; path: string } | null;
    matched_response_status: string | null;
    error_count: number;
  };
}

export interface TestRunResult {
  suite_name: string;
  suite_tags?: string[];
  suite_description?: string;
  suite_file?: string;
  started_at: string;
  finished_at: string;
  total: number;
  passed: number;
  failed: number;
  skipped: number;
  /** ARV-318: steps whose status is "error" (couldn't execute — env_issue,
   *  network, etc.). Previously counted in `total` but in none of
   *  passed/failed/skipped, so `total === passed+failed+skipped` silently
   *  broke and error steps reconciled into no bucket. Optional for back-compat
   *  with older result literals; the runner always sets it. */
  errored?: number;
  steps: StepResult[];
}
