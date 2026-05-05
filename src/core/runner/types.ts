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
  steps: StepResult[];
}
