import { getDb } from "./schema.ts";
import type { StepResult, TestRunResult } from "../core/runner/types.ts";

// ──────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────

export interface CreateRunOpts {
  started_at: string;
  environment?: string;
  trigger?: string;
  commit_sha?: string;
  branch?: string;
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
  response_status: number | null;
  error_message: string | null;
  assertions: import("../core/runner/types.ts").AssertionResult[];
}

// ──────────────────────────────────────────────
// Runs
// ──────────────────────────────────────────────

export function createRun(opts: CreateRunOpts): number {
  const db = getDb();
  const stmt = db.prepare(`
    INSERT INTO runs (started_at, environment, trigger, commit_sha, branch)
    VALUES ($started_at, $environment, $trigger, $commit_sha, $branch)
  `);
  const result = stmt.run({
    $started_at: opts.started_at,
    $environment: opts.environment ?? null,
    $trigger: opts.trigger ?? "manual",
    $commit_sha: opts.commit_sha ?? null,
    $branch: opts.branch ?? null,
  });
  return Number(result.lastInsertRowid);
}

export function finalizeRun(runId: number, results: TestRunResult[]): void {
  const db = getDb();

  const total = results.reduce((s, r) => s + r.total, 0);
  const passed = results.reduce((s, r) => s + r.passed, 0);
  const failed = results.reduce((s, r) => s + r.failed, 0);
  const skipped = results.reduce((s, r) => s + r.skipped, 0);

  const started = results[0]?.started_at ?? new Date().toISOString();
  const finished = results[results.length - 1]?.finished_at ?? new Date().toISOString();
  const durationMs = new Date(finished).getTime() - new Date(started).getTime();

  db.prepare(`
    UPDATE runs
    SET finished_at = $finished_at,
        total       = $total,
        passed      = $passed,
        failed      = $failed,
        skipped     = $skipped,
        duration_ms = $duration_ms
    WHERE id = $id
  `).run({
    $finished_at: finished,
    $total: total,
    $passed: passed,
    $failed: failed,
    $skipped: skipped,
    $duration_ms: durationMs,
    $id: runId,
  });
}

export function getRunById(runId: number): RunRecord | null {
  const db = getDb();
  return db.query("SELECT * FROM runs WHERE id = ?").get(runId) as RunRecord | null;
}

export function listRuns(limit = 20, offset = 0): RunSummary[] {
  const db = getDb();
  return db.query(`
    SELECT id, started_at, finished_at, total, passed, failed, skipped, environment, duration_ms
    FROM runs
    ORDER BY started_at DESC
    LIMIT ? OFFSET ?
  `).all(limit, offset) as RunSummary[];
}

export function deleteRun(runId: number): boolean {
  const db = getDb();
  // results are cascade-deleted via FK; but SQLite FK delete cascade requires explicit config
  db.prepare("DELETE FROM results WHERE run_id = ?").run(runId);
  const result = db.prepare("DELETE FROM runs WHERE id = ?").run(runId);
  return result.changes > 0;
}

// ──────────────────────────────────────────────
// Results (steps)
// ──────────────────────────────────────────────

export function saveResults(runId: number, suiteResults: TestRunResult[]): void {
  const db = getDb();

  const stmt = db.prepare(`
    INSERT INTO results
      (run_id, suite_name, test_name, status, duration_ms,
       request_method, request_url, request_body,
       response_status, response_body, error_message, assertions)
    VALUES
      ($run_id, $suite_name, $test_name, $status, $duration_ms,
       $request_method, $request_url, $request_body,
       $response_status, $response_body, $error_message, $assertions)
  `);

  db.transaction(() => {
    for (const suite of suiteResults) {
      for (const step of suite.steps) {
        const keepBody = step.status === "fail" || step.status === "error";
        stmt.run({
          $run_id: runId,
          $suite_name: suite.suite_name,
          $test_name: step.name,
          $status: step.status,
          $duration_ms: step.duration_ms,
          $request_method: step.request.method,
          $request_url: step.request.url,
          $request_body: step.request.body ?? null,
          $response_status: step.response?.status ?? null,
          $response_body: keepBody ? (step.response?.body ?? null) : null,
          $error_message: step.error ?? null,
          $assertions: step.assertions.length > 0 ? JSON.stringify(step.assertions) : null,
        });
      }
    }
  })();
}

export function getResultsByRunId(runId: number): StoredStepResult[] {
  const db = getDb();
  const rows = db.query("SELECT * FROM results WHERE run_id = ? ORDER BY id").all(runId) as Array<
    Omit<StoredStepResult, "assertions"> & { assertions: string | null }
  >;
  return rows.map((row) => ({
    ...row,
    assertions: row.assertions ? JSON.parse(row.assertions) : [],
  }));
}

// ──────────────────────────────────────────────
// Environments
// ──────────────────────────────────────────────

export function upsertEnvironment(name: string, vars: Record<string, string>): void {
  const db = getDb();
  db.prepare(`
    INSERT INTO environments (name, variables) VALUES ($name, $variables)
    ON CONFLICT(name) DO UPDATE SET variables = excluded.variables
  `).run({ $name: name, $variables: JSON.stringify(vars) });
}

export function getEnvironment(name: string): Record<string, string> | null {
  const db = getDb();
  const row = db.query("SELECT variables FROM environments WHERE name = ?").get(name) as
    | { variables: string }
    | null;
  return row ? JSON.parse(row.variables) : null;
}

export function listEnvironments(): string[] {
  const db = getDb();
  const rows = db.query("SELECT name FROM environments ORDER BY name").all() as { name: string }[];
  return rows.map((r) => r.name);
}

// ──────────────────────────────────────────────
// Dashboard metrics
// ──────────────────────────────────────────────

export interface DashboardStats {
  totalRuns: number;
  totalTests: number;
  overallPassRate: number;
  avgDuration: number;
}

export function getDashboardStats(): DashboardStats {
  const db = getDb();
  const row = db.query(`
    SELECT
      COUNT(*)            AS totalRuns,
      COALESCE(SUM(total), 0)   AS totalTests,
      CASE WHEN SUM(total) > 0
        THEN ROUND(SUM(passed) * 100.0 / SUM(total), 1)
        ELSE 0 END        AS overallPassRate,
      COALESCE(ROUND(AVG(duration_ms), 0), 0) AS avgDuration
    FROM runs
    WHERE finished_at IS NOT NULL
  `).get() as { totalRuns: number; totalTests: number; overallPassRate: number; avgDuration: number };
  return row;
}

export interface PassRateTrendPoint {
  run_id: number;
  started_at: string;
  pass_rate: number;
}

export function getPassRateTrend(limit = 30): PassRateTrendPoint[] {
  const db = getDb();
  return db.query(`
    SELECT id AS run_id, started_at,
      CASE WHEN total > 0 THEN ROUND(passed * 100.0 / total, 1) ELSE 0 END AS pass_rate
    FROM runs
    WHERE finished_at IS NOT NULL
    ORDER BY started_at DESC
    LIMIT ?
  `).all(limit) as PassRateTrendPoint[];
}

export interface SlowestTest {
  suite_name: string;
  test_name: string;
  avg_duration: number;
}

export function getSlowestTests(limit = 5): SlowestTest[] {
  const db = getDb();
  return db.query(`
    SELECT suite_name, test_name, ROUND(AVG(duration_ms), 0) AS avg_duration
    FROM results
    GROUP BY suite_name, test_name
    ORDER BY avg_duration DESC
    LIMIT ?
  `).all(limit) as SlowestTest[];
}

export interface FlakyTest {
  suite_name: string;
  test_name: string;
  distinct_statuses: number;
}

export function getFlakyTests(runsBack = 20, limit = 5): FlakyTest[] {
  const db = getDb();
  return db.query(`
    SELECT r.suite_name, r.test_name, COUNT(DISTINCT r.status) AS distinct_statuses
    FROM results r
    INNER JOIN (SELECT id FROM runs ORDER BY started_at DESC LIMIT ?) recent ON r.run_id = recent.id
    GROUP BY r.suite_name, r.test_name
    HAVING COUNT(DISTINCT r.status) > 1
    ORDER BY distinct_statuses DESC
    LIMIT ?
  `).all(runsBack, limit) as FlakyTest[];
}

export function countRuns(): number {
  const db = getDb();
  const row = db.query("SELECT COUNT(*) AS cnt FROM runs").get() as { cnt: number };
  return row.cnt;
}
