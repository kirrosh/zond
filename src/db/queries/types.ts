/**
 * Shared types and helpers for the per-domain query modules
 * (`runs.ts`, `sessions.ts`, `results.ts`, `collections.ts`,
 * `dashboard.ts`, `settings.ts`). Centralised here so domains can
 * import each other's record shapes without circular deps.
 */
import { resolve } from "path";

export function normalizePath(p: string): string {
  return resolve(p).replace(/\\/g, "/");
}

export interface CreateRunOpts {
  started_at: string;
  environment?: string;
  trigger?: string;
  commit_sha?: string;
  branch?: string;
  collection_id?: number;
  session_id?: string;
  /** TASK-274: union of suite-level tags actually executed in the run, plus
   *  any explicit `--tag <x>` filters from the CLI. Persisted as a JSON
   *  array string so `coverage --union tag:<name>` can filter run-rows. */
  tags?: string[];
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
  session_id: string | null;
  /** TASK-274: tag list captured at run time (JSON-encoded in DB). null
   *  on legacy rows persisted before migration v9. */
  tags: string[] | null;
}

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

export interface CollectionRecord {
  id: number;
  name: string;
  base_dir: string | null;
  test_path: string;
  openapi_spec: string | null;
  created_at: string;
}

export interface CollectionSummary {
  id: number;
  name: string;
  base_dir: string | null;
  test_path: string;
  openapi_spec: string | null;
  created_at: string;
  total_runs: number;
  pass_rate: number;
  last_run_at: string | null;
  last_run_passed: number;
  last_run_failed: number;
  last_run_total: number;
}

export interface CreateCollectionOpts {
  name: string;
  base_dir?: string;
  test_path: string;
  openapi_spec?: string;
}

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
  assertions: import("../../core/runner/types.ts").AssertionResult[];
  captures: Record<string, unknown>;
  suite_file: string | null;
  provenance: import("../../core/parser/types.ts").SourceMetadata | null;
  failure_class: import("../../core/diagnostics/failure-class.ts").FailureClass | null;
  failure_class_reason: string | null;
  spec_pointer: string | null;
  spec_excerpt: string | null;
}

export interface RunFilters {
  status?: string;
  environment?: string;
  date_from?: string;
  date_to?: string;
  test_name?: string;
  /** TASK-116: filter by run origin — "ci" (CI runs only) or "manual"
   *  (interactive / probe / ad-hoc). Also accepts arbitrary trigger
   *  strings if the workspace introduces custom ones. */
  trigger?: string;
}

export interface DashboardStats {
  totalRuns: number;
  totalTests: number;
  overallPassRate: number;
  avgDuration: number;
}

export interface PassRateTrendPoint {
  run_id: number;
  started_at: string;
  pass_rate: number;
}

export interface SlowestTest {
  suite_name: string;
  test_name: string;
  avg_duration: number;
}

export interface FlakyTest {
  suite_name: string;
  test_name: string;
  distinct_statuses: number;
}

export interface LastRunForSuite {
  run_id: number;
  started_at: string;
  total: number;
  passed: number;
  failed: number;
}
