import { getDb } from "../schema.ts";
import type { TestRunResult } from "../../core/runner/types.ts";
import type { CreateRunOpts, RunRecord, RunSummary, RunFilters } from "./types.ts";

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

export function createRun(opts: CreateRunOpts): number {
  const db = getDb();
  const stmt = db.prepare(`
    INSERT INTO runs (started_at, environment, trigger, commit_sha, branch, collection_id, session_id)
    VALUES ($started_at, $environment, $trigger, $commit_sha, $branch, $collection_id, $session_id)
  `);
  const result = stmt.run({
    $started_at: opts.started_at,
    $environment: opts.environment ?? null,
    $trigger: opts.trigger ?? "manual",
    $commit_sha: opts.commit_sha ?? null,
    $branch: opts.branch ?? null,
    $collection_id: opts.collection_id ?? null,
    $session_id: opts.session_id ?? null,
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

export function listRuns(limit = 20, offset = 0, filters?: RunFilters): RunSummary[] {
  const db = getDb();
  if (filters && Object.values(filters).some(Boolean)) {
    const { where, params } = buildRunFilterSQL(filters);
    return db.query(`
      SELECT r.id, r.started_at, r.finished_at, r.total, r.passed, r.failed, r.skipped, r.environment, r.duration_ms, r.collection_id, r.session_id
      FROM runs r
      ${where}
      ORDER BY r.started_at DESC
      LIMIT ? OFFSET ?
    `).all(...(params as (string | number)[]), limit, offset) as RunSummary[];
  }
  return db.query(`
    SELECT id, started_at, finished_at, total, passed, failed, skipped, environment, duration_ms, collection_id, session_id
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
