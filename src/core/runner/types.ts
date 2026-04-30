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

export interface AssertionResult {
  field: string;
  rule: string;
  passed: boolean;
  actual: unknown;
  expected: unknown;
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
