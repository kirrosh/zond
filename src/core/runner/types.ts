export type StepStatus = "pass" | "fail" | "skip" | "error";

export interface HttpRequest {
  method: string;
  url: string;
  headers: Record<string, string>;
  body?: string;
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
}

export interface TestRunResult {
  suite_name: string;
  started_at: string;
  finished_at: string;
  total: number;
  passed: number;
  failed: number;
  skipped: number;
  steps: StepResult[];
}
