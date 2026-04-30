import { getDb } from "./schema.ts";
import { resolve } from "path";
import type { StepResult, TestRunResult } from "../core/runner/types.ts";

// ──────────────────────────────────────────────
// Path normalization
// ──────────────────────────────────────────────

export function normalizePath(p: string): string {
  return resolve(p).replace(/\\/g, "/");
}

// ──────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────

export interface CreateRunOpts {
  started_at: string;
  environment?: string;
  trigger?: string;
  commit_sha?: string;
  branch?: string;
  collection_id?: number;
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

// ──────────────────────────────────────────────
// Collection types
// ──────────────────────────────────────────────

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
  assertions: import("../core/runner/types.ts").AssertionResult[];
  captures: Record<string, unknown>;
  suite_file: string | null;
  provenance: import("../core/parser/types.ts").SourceMetadata | null;
  failure_class: import("../core/diagnostics/failure-class.ts").FailureClass | null;
  failure_class_reason: string | null;
  spec_pointer: string | null;
  spec_excerpt: string | null;
}

// ──────────────────────────────────────────────
// Runs
// ──────────────────────────────────────────────

export function createRun(opts: CreateRunOpts): number {
  const db = getDb();
  const stmt = db.prepare(`
    INSERT INTO runs (started_at, environment, trigger, commit_sha, branch, collection_id)
    VALUES ($started_at, $environment, $trigger, $commit_sha, $branch, $collection_id)
  `);
  const result = stmt.run({
    $started_at: opts.started_at,
    $environment: opts.environment ?? null,
    $trigger: opts.trigger ?? "manual",
    $commit_sha: opts.commit_sha ?? null,
    $branch: opts.branch ?? null,
    $collection_id: opts.collection_id ?? null,
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

export interface RunFilters {
  status?: string;
  environment?: string;
  date_from?: string;
  date_to?: string;
  test_name?: string;
}

function buildRunFilterSQL(filters: RunFilters): { where: string; params: unknown[] } {
  const clauses: string[] = [];
  const params: unknown[] = [];

  if (filters.status === "has_failures") {
    clauses.push("r.failed > 0");
  } else if (filters.status === "all_passed") {
    clauses.push("r.failed = 0 AND r.total > 0");
  }

  if (filters.environment) {
    clauses.push("r.environment = ?");
    params.push(filters.environment);
  }

  if (filters.date_from) {
    clauses.push("r.started_at >= ?");
    params.push(filters.date_from);
  }

  if (filters.date_to) {
    clauses.push("r.started_at <= ?");
    params.push(filters.date_to + "T23:59:59");
  }

  if (filters.test_name) {
    clauses.push("r.id IN (SELECT DISTINCT run_id FROM results WHERE test_name LIKE ?)");
    params.push(`%${filters.test_name}%`);
  }

  const where = clauses.length > 0 ? "WHERE " + clauses.join(" AND ") : "";
  return { where, params };
}

export function listRuns(limit = 20, offset = 0, filters?: RunFilters): RunSummary[] {
  const db = getDb();
  if (filters && Object.values(filters).some(Boolean)) {
    const { where, params } = buildRunFilterSQL(filters);
    return db.query(`
      SELECT r.id, r.started_at, r.finished_at, r.total, r.passed, r.failed, r.skipped, r.environment, r.duration_ms, r.collection_id
      FROM runs r
      ${where}
      ORDER BY r.started_at DESC
      LIMIT ? OFFSET ?
    `).all(...(params as (string | number)[]), limit, offset) as RunSummary[];
  }
  return db.query(`
    SELECT id, started_at, finished_at, total, passed, failed, skipped, environment, duration_ms, collection_id
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
       response_status, response_body, response_headers, error_message, assertions, captures, suite_file, provenance, failure_class, failure_class_reason, spec_pointer, spec_excerpt)
    VALUES
      ($run_id, $suite_name, $test_name, $status, $duration_ms,
       $request_method, $request_url, $request_body,
       $response_status, $response_body, $response_headers, $error_message, $assertions, $captures, $suite_file, $provenance, $failure_class, $failure_class_reason, $spec_pointer, $spec_excerpt)
  `);

  db.transaction(() => {
    for (const suite of suiteResults) {
      for (const step of suite.steps) {
        const maxBodySize = 50_000;
        const truncBody = (s: string | null | undefined) =>
          s && s.length > maxBodySize ? s.slice(0, maxBodySize) + "\n...[truncated]" : (s ?? null);
        stmt.run({
          $run_id: runId,
          $suite_name: suite.suite_name,
          $test_name: step.name,
          $status: step.status,
          $duration_ms: step.duration_ms,
          $request_method: step.request.method,
          $request_url: step.request.url,
          $request_body: truncBody(step.request.body),
          $response_status: step.response?.status ?? null,
          $response_body: truncBody(step.response?.body),
          $response_headers: step.response?.headers
            ? JSON.stringify(step.response.headers)
            : null,
          $error_message: step.error ?? null,
          $assertions: step.assertions.length > 0 ? JSON.stringify(step.assertions) : null,
          $captures: Object.keys(step.captures).length > 0 ? JSON.stringify(step.captures) : null,
          $suite_file: suite.suite_file ?? null,
          $provenance: step.provenance ? JSON.stringify(step.provenance) : null,
          $failure_class: step.failure_class ?? null,
          $failure_class_reason: step.failure_class_reason ?? null,
          $spec_pointer: step.spec_pointer ?? null,
          $spec_excerpt: step.spec_excerpt ?? null,
        });
      }
    }
  })();
}

function parseProvenance(raw: unknown): import("../core/parser/types.ts").SourceMetadata | null {
  if (typeof raw !== "string" || raw.length === 0) return null;
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

export function getResultById(resultId: number): StoredStepResult | null {
  const db = getDb();
  const row = db.query("SELECT * FROM results WHERE id = ?").get(resultId) as
    | (Omit<StoredStepResult, "assertions" | "captures" | "provenance"> & {
        assertions: string | null;
        captures: string | null;
        provenance: string | null;
      })
    | null;
  if (!row) return null;
  return {
    ...row,
    assertions: row.assertions ? JSON.parse(row.assertions) : [],
    captures: row.captures ? JSON.parse(row.captures) : {},
    provenance: parseProvenance(row.provenance),
  };
}

export function getResultsByRunId(runId: number): StoredStepResult[] {
  const db = getDb();
  const rows = db.query("SELECT * FROM results WHERE run_id = ? ORDER BY id").all(runId) as Array<
    Omit<StoredStepResult, "assertions" | "captures" | "provenance"> & {
      assertions: string | null;
      captures: string | null;
      provenance: string | null;
    }
  >;
  return rows.map((row) => ({
    ...row,
    assertions: row.assertions ? JSON.parse(row.assertions) : [],
    captures: row.captures ? JSON.parse(row.captures) : {},
    provenance: parseProvenance(row.provenance),
  }));
}

export function getFilteredResults(runId: number, filters: { method?: string; status?: number }): StoredStepResult[] {
  const db = getDb();
  const conditions = ["run_id = ?"];
  const params: (string | number)[] = [runId];

  if (filters.method) {
    conditions.push("request_method = ?");
    params.push(filters.method.toUpperCase());
  }
  if (filters.status !== undefined) {
    conditions.push("response_status = ?");
    params.push(filters.status);
  }

  const rows = db.query(`SELECT * FROM results WHERE ${conditions.join(" AND ")} ORDER BY id`).all(...params) as Array<
    Omit<StoredStepResult, "assertions" | "captures" | "provenance"> & {
      assertions: string | null;
      captures: string | null;
      provenance: string | null;
    }
  >;
  return rows.map((row) => ({
    ...row,
    assertions: row.assertions ? JSON.parse(row.assertions) : [],
    captures: row.captures ? JSON.parse(row.captures) : {},
    provenance: parseProvenance(row.provenance),
  }));
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

export function countRuns(filters?: RunFilters): number {
  const db = getDb();
  if (filters && Object.values(filters).some(Boolean)) {
    const { where, params } = buildRunFilterSQL(filters);
    const row = db.query(`SELECT COUNT(*) AS cnt FROM runs r ${where}`).get(...(params as (string | number)[])) as { cnt: number };
    return row.cnt;
  }
  const row = db.query("SELECT COUNT(*) AS cnt FROM runs").get() as { cnt: number };
  return row.cnt;
}

export function getDistinctEnvironments(): string[] {
  const db = getDb();
  const rows = db.query("SELECT DISTINCT environment FROM runs WHERE environment IS NOT NULL ORDER BY environment").all() as { environment: string }[];
  return rows.map((r) => r.environment);
}

// ──────────────────────────────────────────────
// Collections
// ──────────────────────────────────────────────

export function createCollection(opts: CreateCollectionOpts): number {
  const db = getDb();
  const stmt = db.prepare(`
    INSERT INTO collections (name, base_dir, test_path, openapi_spec)
    VALUES ($name, $base_dir, $test_path, $openapi_spec)
  `);
  const result = stmt.run({
    $name: opts.name,
    $base_dir: opts.base_dir ?? null,
    $test_path: opts.test_path,
    $openapi_spec: opts.openapi_spec ?? null,
  });
  return Number(result.lastInsertRowid);
}

export function getCollectionById(id: number): CollectionRecord | null {
  const db = getDb();
  return db.query("SELECT * FROM collections WHERE id = ?").get(id) as CollectionRecord | null;
}

export function listCollections(): CollectionSummary[] {
  const db = getDb();
  return db.query(`
    SELECT
      c.id, c.name, c.base_dir, c.test_path, c.openapi_spec, c.created_at,
      COUNT(r.id) AS total_runs,
      CASE WHEN SUM(r.total) > 0
        THEN ROUND(SUM(r.passed) * 100.0 / SUM(r.total), 1)
        ELSE 0 END AS pass_rate,
      MAX(r.started_at) AS last_run_at,
      COALESCE((SELECT passed FROM runs WHERE collection_id = c.id ORDER BY started_at DESC LIMIT 1), 0) AS last_run_passed,
      COALESCE((SELECT failed FROM runs WHERE collection_id = c.id ORDER BY started_at DESC LIMIT 1), 0) AS last_run_failed,
      COALESCE((SELECT total FROM runs WHERE collection_id = c.id ORDER BY started_at DESC LIMIT 1), 0) AS last_run_total
    FROM collections c
    LEFT JOIN runs r ON r.collection_id = c.id AND r.finished_at IS NOT NULL
    GROUP BY c.id
    ORDER BY c.name
  `).all() as CollectionSummary[];
}

export function updateCollection(id: number, opts: Partial<CreateCollectionOpts>): boolean {
  const db = getDb();
  const sets: string[] = [];
  const params: Record<string, any> = { $id: id };

  if (opts.name !== undefined) { sets.push("name = $name"); params.$name = opts.name; }
  if (opts.base_dir !== undefined) { sets.push("base_dir = $base_dir"); params.$base_dir = opts.base_dir; }
  if (opts.test_path !== undefined) { sets.push("test_path = $test_path"); params.$test_path = opts.test_path; }
  if (opts.openapi_spec !== undefined) { sets.push("openapi_spec = $openapi_spec"); params.$openapi_spec = opts.openapi_spec; }

  if (sets.length === 0) return false;

  const result = db.prepare(`UPDATE collections SET ${sets.join(", ")} WHERE id = $id`).run(params);
  return result.changes > 0;
}

export function deleteCollection(id: number, deleteRuns = false): boolean {
  const db = getDb();
  if (deleteRuns) {
    const runIds = db.query("SELECT id FROM runs WHERE collection_id = ?").all(id) as { id: number }[];
    for (const row of runIds) {
      db.prepare("DELETE FROM results WHERE run_id = ?").run(row.id);
    }
    db.prepare("DELETE FROM runs WHERE collection_id = ?").run(id);
  } else {
    db.prepare("UPDATE runs SET collection_id = NULL WHERE collection_id = ?").run(id);
  }
  const result = db.prepare("DELETE FROM collections WHERE id = ?").run(id);
  return result.changes > 0;
}

export function findCollectionByTestPath(path: string): CollectionRecord | null {
  const db = getDb();
  const normalized = normalizePath(path);
  return db.query("SELECT * FROM collections WHERE test_path = ?").get(normalized) as CollectionRecord | null;
}

export function findCollectionByNameOrId(nameOrId: string): CollectionRecord | null {
  const db = getDb();
  // Try as numeric ID first
  const id = parseInt(nameOrId, 10);
  if (!isNaN(id)) {
    const byId = db.query("SELECT * FROM collections WHERE id = ?").get(id) as CollectionRecord | null;
    if (byId) return byId;
  }
  // Then by name (case-insensitive)
  return db.query("SELECT * FROM collections WHERE lower(name) = lower(?)").get(nameOrId) as CollectionRecord | null;
}

export function findCollectionBySpec(spec: string): CollectionRecord | null {
  const db = getDb();
  return db.query("SELECT * FROM collections WHERE openapi_spec = ?").get(spec) as CollectionRecord | null;
}

export function listRunsByCollection(collectionId: number, limit = 20, offset = 0): RunSummary[] {
  const db = getDb();
  return db.query(`
    SELECT id, started_at, finished_at, total, passed, failed, skipped, environment, duration_ms, collection_id
    FROM runs
    WHERE collection_id = ?
    ORDER BY started_at DESC
    LIMIT ? OFFSET ?
  `).all(collectionId, limit, offset) as RunSummary[];
}

export interface LastRunForSuite {
  run_id: number;
  started_at: string;
  total: number;
  passed: number;
  failed: number;
}

/**
 * Latest run that included `suiteFile` (matched by step_results.suite_file),
 * with per-suite step counts within that run. Used by the Suites browser UI.
 */
export function getLatestRunForSuite(suiteFile: string): LastRunForSuite | null {
  const db = getDb();
  const row = db.query(`
    SELECT
      r.id AS run_id,
      r.started_at AS started_at,
      COUNT(*) AS total,
      SUM(CASE WHEN s.status = 'pass' THEN 1 ELSE 0 END) AS passed,
      SUM(CASE WHEN s.status IN ('fail', 'error') THEN 1 ELSE 0 END) AS failed
    FROM results s
    JOIN runs r ON r.id = s.run_id
    WHERE s.suite_file = ?
    GROUP BY r.id
    ORDER BY r.id DESC
    LIMIT 1
  `).get(suiteFile) as LastRunForSuite | null;
  if (!row) return null;
  return {
    run_id: row.run_id,
    started_at: row.started_at,
    total: Number(row.total) || 0,
    passed: Number(row.passed) || 0,
    failed: Number(row.failed) || 0,
  };
}

export function getCollectionPassRateTrend(collectionId: number, limit = 30): PassRateTrendPoint[] {
  const db = getDb();
  return db.query(`
    SELECT id AS run_id, started_at,
      CASE WHEN total > 0 THEN ROUND(passed * 100.0 / total, 1) ELSE 0 END AS pass_rate
    FROM runs
    WHERE collection_id = ? AND finished_at IS NOT NULL
    ORDER BY started_at DESC
    LIMIT ?
  `).all(collectionId, limit) as PassRateTrendPoint[];
}

export function countRunsByCollection(collectionId: number): number {
  const db = getDb();
  const row = db.query("SELECT COUNT(*) AS cnt FROM runs WHERE collection_id = ?").get(collectionId) as { cnt: number };
  return row.cnt;
}

export function getCollectionStats(collectionId: number): DashboardStats {
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
    WHERE collection_id = ? AND finished_at IS NOT NULL
  `).get(collectionId) as { totalRuns: number; totalTests: number; overallPassRate: number; avgDuration: number };
  return row;
}

export function linkRunToCollection(runId: number, collectionId: number): void {
  const db = getDb();
  db.prepare("UPDATE runs SET collection_id = ? WHERE id = ?").run(collectionId, runId);
}

// ──────────────────────────────────────────────
// AI Generations
// ──────────────────────────────────────────────

export interface AIGenerationRecord {
  id: number;
  collection_id: number | null;
  prompt: string;
  model: string;
  provider: string;
  generated_yaml: string | null;
  output_path: string | null;
  status: string;
  error_message: string | null;
  prompt_tokens: number | null;
  completion_tokens: number | null;
  duration_ms: number | null;
  created_at: string;
}

export interface SaveAIGenerationOpts {
  collection_id?: number;
  prompt: string;
  model: string;
  provider: string;
  generated_yaml?: string;
  output_path?: string;
  status: string;
  error_message?: string;
  prompt_tokens?: number;
  completion_tokens?: number;
  duration_ms?: number;
}

export function saveAIGeneration(opts: SaveAIGenerationOpts): number {
  const db = getDb();
  const result = db.prepare(`
    INSERT INTO ai_generations
      (collection_id, prompt, model, provider, generated_yaml, output_path,
       status, error_message, prompt_tokens, completion_tokens, duration_ms)
    VALUES ($collection_id, $prompt, $model, $provider, $generated_yaml, $output_path,
            $status, $error_message, $prompt_tokens, $completion_tokens, $duration_ms)
  `).run({
    $collection_id: opts.collection_id ?? null,
    $prompt: opts.prompt,
    $model: opts.model,
    $provider: opts.provider,
    $generated_yaml: opts.generated_yaml ?? null,
    $output_path: opts.output_path ?? null,
    $status: opts.status,
    $error_message: opts.error_message ?? null,
    $prompt_tokens: opts.prompt_tokens ?? null,
    $completion_tokens: opts.completion_tokens ?? null,
    $duration_ms: opts.duration_ms ?? null,
  });
  return Number(result.lastInsertRowid);
}

export function listAIGenerations(collectionId: number, limit = 10): AIGenerationRecord[] {
  const db = getDb();
  return db.query(`
    SELECT * FROM ai_generations
    WHERE collection_id = ?
    ORDER BY created_at DESC
    LIMIT ?
  `).all(collectionId, limit) as AIGenerationRecord[];
}

export function getAIGeneration(id: number): AIGenerationRecord | null {
  const db = getDb();
  return db.query("SELECT * FROM ai_generations WHERE id = ?").get(id) as AIGenerationRecord | null;
}

export function updateAIGenerationOutputPath(id: number, outputPath: string): boolean {
  const db = getDb();
  const result = db.prepare("UPDATE ai_generations SET output_path = ? WHERE id = ?").run(outputPath, id);
  return result.changes > 0;
}

export function listSavedAIGenerations(collectionId: number): AIGenerationRecord[] {
  const db = getDb();
  return db.query(`
    SELECT * FROM ai_generations
    WHERE collection_id = ? AND output_path IS NOT NULL AND output_path != ''
    ORDER BY created_at DESC
  `).all(collectionId) as AIGenerationRecord[];
}

export function findAIGenerationByYaml(collectionId: number, yaml: string): AIGenerationRecord | null {
  const db = getDb();
  return db.query(
    "SELECT * FROM ai_generations WHERE collection_id = ? AND generated_yaml = ? ORDER BY created_at DESC LIMIT 1"
  ).get(collectionId, yaml) as AIGenerationRecord | null;
}

// ──────────────────────────────────────────────
// Settings
// ──────────────────────────────────────────────

export function getSetting(key: string): string | null {
  const db = getDb();
  const row = db.query("SELECT value FROM settings WHERE key = ?").get(key) as { value: string } | null;
  return row?.value ?? null;
}

export function setSetting(key: string, value: string): void {
  const db = getDb();
  db.prepare(`
    INSERT INTO settings (key, value) VALUES ($key, $value)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `).run({ $key: key, $value: value });
}

export interface AISettingsConfig {
  provider: string;
  model: string;
  base_url: string;
  api_key: string;
}

export function getAISettings(): AISettingsConfig {
  return {
    provider: getSetting("ai_provider") ?? "ollama",
    model: getSetting("ai_model") ?? "",
    base_url: getSetting("ai_base_url") ?? "",
    api_key: getSetting("ai_api_key") ?? "",
  };
}

export function setAISettings(config: Partial<AISettingsConfig>): void {
  if (config.provider !== undefined) setSetting("ai_provider", config.provider);
  if (config.model !== undefined) setSetting("ai_model", config.model);
  if (config.base_url !== undefined) setSetting("ai_base_url", config.base_url);
  if (config.api_key !== undefined) setSetting("ai_api_key", config.api_key);
}

// ──────────────────────────────────────────────
// Chat Sessions & Messages
// ──────────────────────────────────────────────

export interface ChatSessionRecord {
  id: number;
  title: string | null;
  provider: string;
  model: string;
  created_at: string;
  last_active: string;
}

export interface ChatMessageRecord {
  id: number;
  session_id: number;
  role: string;
  content: string;
  tool_name: string | null;
  tool_args: string | null;
  tool_result: string | null;
  input_tokens: number | null;
  output_tokens: number | null;
  created_at: string;
}

export interface SaveChatMessageOpts {
  session_id: number;
  role: string;
  content: string;
  tool_name?: string;
  tool_args?: string;
  tool_result?: string;
  input_tokens?: number;
  output_tokens?: number;
}

export function createChatSession(provider: string, model: string, title?: string): number {
  const db = getDb();
  const result = db.prepare(`
    INSERT INTO chat_sessions (title, provider, model)
    VALUES ($title, $provider, $model)
  `).run({
    $title: title ?? null,
    $provider: provider,
    $model: model,
  });
  return Number(result.lastInsertRowid);
}

export function saveChatMessage(opts: SaveChatMessageOpts): number {
  const db = getDb();

  // Update session last_active
  db.prepare("UPDATE chat_sessions SET last_active = datetime('now') WHERE id = ?").run(opts.session_id);

  const result = db.prepare(`
    INSERT INTO chat_messages (session_id, role, content, tool_name, tool_args, tool_result, input_tokens, output_tokens)
    VALUES ($session_id, $role, $content, $tool_name, $tool_args, $tool_result, $input_tokens, $output_tokens)
  `).run({
    $session_id: opts.session_id,
    $role: opts.role,
    $content: opts.content,
    $tool_name: opts.tool_name ?? null,
    $tool_args: opts.tool_args ?? null,
    $tool_result: opts.tool_result ?? null,
    $input_tokens: opts.input_tokens ?? null,
    $output_tokens: opts.output_tokens ?? null,
  });
  return Number(result.lastInsertRowid);
}

export function getChatMessages(sessionId: number): ChatMessageRecord[] {
  const db = getDb();
  return db.query(
    "SELECT * FROM chat_messages WHERE session_id = ? ORDER BY created_at ASC"
  ).all(sessionId) as ChatMessageRecord[];
}

export function listChatSessions(limit = 20): ChatSessionRecord[] {
  const db = getDb();
  return db.query(
    "SELECT * FROM chat_sessions ORDER BY last_active DESC LIMIT ?"
  ).all(limit) as ChatSessionRecord[];
}

export interface CoreMessageFormat {
  role: "user" | "assistant";
  content: string;
}

export function loadSessionHistory(sessionId: number): CoreMessageFormat[] {
  const messages = getChatMessages(sessionId);
  return messages
    .filter((m) => m.role === "user" || m.role === "assistant")
    .map((m) => ({
      role: m.role as "user" | "assistant",
      content: m.content,
    }));
}
