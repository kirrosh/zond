import { queryOptions } from "@tanstack/react-query";

export interface RunSummary {
  id: number;
  started_at: string;
  finished_at: string | null;
  total: number;
  passed: number;
  failed: number;
  skipped: number;
  environment: string | null;
  duration_ms: number | null;
  collection_id: number | null;
}

export interface RunsListResponse {
  runs: RunSummary[];
  total: number;
  limit: number;
  offset: number;
}

export type StatusFilter = "all" | "passed" | "failed";

async function getJson<T>(url: string): Promise<T> {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`HTTP ${r.status} on ${url}`);
  return r.json() as Promise<T>;
}

export interface RunsQueryParams {
  status?: StatusFilter;
  limit?: number;
  offset?: number;
}

export interface RunRecord {
  id: number;
  started_at: string;
  finished_at: string | null;
  total: number;
  passed: number;
  failed: number;
  skipped: number;
  trigger: string;
  commit_sha: string | null;
  branch: string | null;
  environment: string | null;
  duration_ms: number | null;
  collection_id: number | null;
}

export interface AssertionResult {
  type: string;
  passed: boolean;
  message?: string;
  expected?: unknown;
  actual?: unknown;
  path?: string;
}

export type ProvenanceType = "openapi-generated" | "manual" | "probe-suite";

export interface SourceMetadata {
  type?: ProvenanceType;
  spec?: string;
  generator?: string;
  generated_at?: string;
  endpoint?: string;
  response_branch?: string;
  schema_pointer?: string;
  [key: string]: unknown;
}

export type FailureClass = "definitely_bug" | "likely_bug" | "quirk" | "env_issue";

export interface StoredStepResult {
  id: number;
  run_id: number;
  suite_name: string;
  test_name: string;
  status: string;
  duration_ms: number;
  request_method: string | null;
  request_url: string | null;
  request_body: string | null;
  response_status: number | null;
  response_body: string | null;
  response_headers: string | null;
  error_message: string | null;
  assertions: AssertionResult[];
  captures: Record<string, unknown>;
  suite_file: string | null;
  provenance: SourceMetadata | null;
  failure_class: FailureClass | null;
  failure_class_reason: string | null;
  spec_pointer: string | null;
  spec_excerpt: string | null;
}

export interface RunDetailResponse {
  run: RunRecord;
  results: StoredStepResult[];
}

export interface ProgressFrame {
  runId: number;
  completed: number;
  total: number;
  status?: "running" | "finished";
}

export function runDetailQueryOptions(runId: string) {
  const url = `/api/runs/${encodeURIComponent(runId)}`;
  return queryOptions({
    queryKey: ["run", runId] as const,
    queryFn: () => getJson<RunDetailResponse>(url),
    staleTime: 5_000,
  });
}

export function runsListQueryOptions(params: RunsQueryParams = {}) {
  const { status = "all", limit = 50, offset = 0 } = params;
  const search = new URLSearchParams();
  if (status !== "all") search.set("status", status);
  search.set("limit", String(limit));
  search.set("offset", String(offset));
  const url = `/api/runs?${search.toString()}`;
  return queryOptions({
    queryKey: ["runs", { status, limit, offset }] as const,
    queryFn: () => getJson<RunsListResponse>(url),
    staleTime: 5_000,
  });
}
