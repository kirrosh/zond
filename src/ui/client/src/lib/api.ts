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
  session_id: string | null;
}

export interface SessionSummary {
  session_id: string;
  started_at: string;
  finished_at: string | null;
  run_count: number;
  total: number;
  passed: number;
  failed: number;
  skipped: number;
  duration_ms: number | null;
  environment: string | null;
}

export interface SessionsListResponse {
  sessions: SessionSummary[];
  total: number;
  limit: number;
  offset: number;
}

export interface SessionRunsResponse {
  session_id: string;
  runs: RunSummary[];
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

export type AssertionKind = "primary" | "schema" | "auxiliary";

export interface AssertionResult {
  /** Server-side: short rule label (e.g. `equals 200`, `schema.format`). Older
   *  reporters used `type`; we keep both so the renderer can fall back. */
  rule?: string;
  type?: string;
  /** Server-side path/field hit by this assertion (e.g. `body.created_at`). */
  field?: string;
  path?: string;
  passed: boolean;
  message?: string;
  expected?: unknown;
  actual?: unknown;
  kind?: AssertionKind;
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

export type FailureClass = "definitely_bug" | "likely_bug" | "quirk" | "env_issue" | "cascade";

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

export interface SuiteTestEntry {
  name: string;
  method: string;
  path: string;
  source: SourceMetadata | null;
}

export interface SuiteLastRun {
  run_id: number;
  started_at: string;
  total: number;
  passed: number;
  failed: number;
}

export interface SuiteEntry {
  name: string;
  description: string | null;
  file: string | null;
  source: SourceMetadata | null;
  tests: SuiteTestEntry[];
  step_count: number;
  tags: string[];
  last_run: SuiteLastRun | null;
}

export interface SuitesListResponse {
  root: string;
  suites: SuiteEntry[];
  errors: { file: string; error: string }[];
}

export function suitesListQueryOptions(path?: string) {
  const url = path
    ? `/api/suites?path=${encodeURIComponent(path)}`
    : "/api/suites";
  return queryOptions({
    queryKey: ["suites", path ?? null] as const,
    queryFn: () => getJson<SuitesListResponse>(url),
    staleTime: 5_000,
  });
}

export function sessionsListQueryOptions(params: { limit?: number; offset?: number } = {}) {
  const { limit = 50, offset = 0 } = params;
  const search = new URLSearchParams();
  search.set("limit", String(limit));
  search.set("offset", String(offset));
  const url = `/api/sessions?${search.toString()}`;
  return queryOptions({
    queryKey: ["sessions", { limit, offset }] as const,
    queryFn: () => getJson<SessionsListResponse>(url),
    staleTime: 5_000,
  });
}

export function sessionRunsQueryOptions(sessionId: string) {
  return queryOptions({
    queryKey: ["session-runs", sessionId] as const,
    queryFn: () => getJson<SessionRunsResponse>(`/api/sessions/${encodeURIComponent(sessionId)}/runs`),
    staleTime: 5_000,
  });
}

export type CoverageStatusClass = "2xx" | "4xx" | "5xx";

export type CoverageReason =
  | "covered" | "partial-failed" | "not-generated" | "no-spec"
  | "deprecated" | "no-fixtures" | "ephemeral-only"
  | "auth-scope-mismatch" | "tag-filtered";

export interface CoverageCellResult {
  resultId: number;
  runId: number;
  status: string;
  responseStatus: number | null;
  failureClass: string | null;
  testName: string;
  suiteFile: string | null;
}

export interface CoverageCell {
  status: "covered" | "partial" | "uncovered";
  reasons: CoverageReason[];
  results: CoverageCellResult[];
}

export interface CoverageRow {
  endpoint: string;
  method: string;
  path: string;
  tags: string[];
  deprecated: boolean;
  security: string[];
  declaredStatuses: number[];
  cells: Record<CoverageStatusClass, CoverageCell>;
}

export interface CoverageTotals {
  endpoints: number;
  cells: number;
  covered: number;
  partial: number;
  uncovered: number;
  byReason: Record<CoverageReason, number>;
}

export interface CoverageResponse {
  apiName: string;
  baseDir: string;
  specPath: string;
  matrix: { rows: CoverageRow[]; totals: CoverageTotals };
  run: { id: number; started_at: string; total: number; passed: number; failed: number } | null;
  profile: "safe" | "full";
  tagFilter: string[];
  ephemeralCount: number;
}

export interface ApiSummary {
  name: string;
  base_dir: string | null;
  openapi_spec: string | null;
  last_run_at: string | null;
  last_run_total: number;
  last_run_passed: number;
  last_run_failed: number;
}

export interface ApisListResponse {
  current: string | null;
  apis: ApiSummary[];
}

export function apisListQueryOptions() {
  return queryOptions({
    queryKey: ["apis"] as const,
    queryFn: () => getJson<ApisListResponse>("/api/apis"),
    staleTime: 30_000,
  });
}

export function coverageQueryOptions(params: { api: string; runId?: number; profile?: "safe" | "full"; tag?: string[] }) {
  const search = new URLSearchParams();
  search.set("api", params.api);
  if (params.runId != null) search.set("runId", String(params.runId));
  if (params.profile) search.set("profile", params.profile);
  if (params.tag && params.tag.length > 0) search.set("tag", params.tag.join(","));
  const url = `/api/coverage?${search.toString()}`;
  return queryOptions({
    queryKey: ["coverage", params] as const,
    queryFn: () => getJson<CoverageResponse>(url),
    staleTime: 5_000,
  });
}

export interface ReplayPayload {
  method: string;
  url: string;
  headers?: Record<string, string>;
  body?: string;
  resultId?: number;
  envName?: string;
  dryRun?: boolean;
}

export interface ReplayResolved {
  method: string;
  url: string;
  headers: Record<string, string>;
  body?: string;
}

export interface ReplayResponseBody {
  status: number;
  headers: Record<string, string>;
  body: unknown;
  duration_ms: number;
}

export interface ReplayResult {
  resolved?: ReplayResolved;
  response?: ReplayResponseBody;
  error?: string;
}

export async function postReplay(payload: ReplayPayload): Promise<ReplayResult> {
  const r = await fetch("/api/replay", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const data = await r.json() as ReplayResult & { error?: string };
  if (!r.ok) throw new Error(data.error ?? `HTTP ${r.status}`);
  return data;
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
