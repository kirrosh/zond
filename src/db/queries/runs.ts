import { getDb, withDbRetry } from "../schema.ts";
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

  if (filters.trigger) {
    clauses.push("r.trigger = ?");
    params.push(filters.trigger);
  }

  const where = clauses.length > 0 ? "WHERE " + clauses.join(" AND ") : "";
  return { where, params };
}

export function createRun(opts: CreateRunOpts): number {
  const db = getDb();
  const stmt = db.prepare(`
    INSERT INTO runs (started_at, environment, trigger, commit_sha, branch, collection_id, session_id, tags, run_kind)
    VALUES ($started_at, $environment, $trigger, $commit_sha, $branch, $collection_id, $session_id, $tags, $run_kind)
  `);
  const result = withDbRetry("createRun", () => stmt.run({
    $started_at: opts.started_at,
    $environment: opts.environment ?? null,
    $trigger: opts.trigger ?? "manual",
    $commit_sha: opts.commit_sha ?? null,
    $branch: opts.branch ?? null,
    $collection_id: opts.collection_id ?? null,
    $session_id: opts.session_id ?? null,
    $tags: opts.tags && opts.tags.length > 0 ? JSON.stringify(opts.tags) : null,
    // ARV-55: default 'regular' here too — DB default would also catch it,
    // but spelling it out keeps INSERTs idempotent and matches the type.
    $run_kind: opts.run_kind ?? "regular",
  }));
  return Number(result.lastInsertRowid);
}

/** Decode the JSON-encoded `tags` column into a string array. Returns null
 *  if the column is null or unparseable (legacy rows / corruption). */
function decodeTags(raw: unknown): string[] | null {
  if (raw == null) return null;
  if (typeof raw !== "string") return null;
  try {
    const v = JSON.parse(raw);
    if (Array.isArray(v) && v.every((x) => typeof x === "string")) return v;
    return null;
  } catch {
    return null;
  }
}

function decodeRunKind(raw: unknown): "regular" | "probe" | "check" {
  // Migration v10 backfills legacy rows; this is a belt-and-suspenders
  // normaliser for any value SQLite returns from `run_kind`.
  if (raw === "probe" || raw === "check") return raw;
  return "regular";
}

function decodeRunRow(row: unknown): RunRecord | null {
  if (!row || typeof row !== "object") return null;
  const r = row as Record<string, unknown> & { tags?: unknown; run_kind?: unknown };
  return {
    ...(r as unknown as RunRecord),
    tags: decodeTags(r.tags),
    run_kind: decodeRunKind(r.run_kind),
  };
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

  const stmt = db.prepare(`
    UPDATE runs
    SET finished_at = $finished_at,
        total       = $total,
        passed      = $passed,
        failed      = $failed,
        skipped     = $skipped,
        duration_ms = $duration_ms
    WHERE id = $id
  `);
  withDbRetry("finalizeRun", () => stmt.run({
    $finished_at: finished,
    $total: total,
    $passed: passed,
    $failed: failed,
    $skipped: skipped,
    $duration_ms: durationMs,
    $id: runId,
  }));
}

export function getRunById(runId: number): RunRecord | null {
  const db = getDb();
  const row = db.query("SELECT * FROM runs WHERE id = ?").get(runId);
  return decodeRunRow(row);
}

/** TASK-274: list runs of a collection with optional time-window or
 *  tag-membership filters, ordered by started_at ASC (matches the
 *  session-based loader so coverage union order is stable). NULL collection
 *  is intentionally excluded — for tag/since selectors the user has
 *  pinpointed an API, ad-hoc/probe runs should be tagged or use --union
 *  session to be picked up. */
export function listRunsByCollectionFiltered(
  collectionId: number,
  filters: { since?: string; tag?: string; limit?: number },
): RunRecord[] {
  const db = getDb();
  const clauses: string[] = ["collection_id = ?", "finished_at IS NOT NULL"];
  const params: unknown[] = [collectionId];
  if (filters.since) {
    clauses.push("started_at >= ?");
    params.push(filters.since);
  }
  if (filters.tag) {
    // tags is a JSON array of strings — match exact element via LIKE on the
    // serialised form. Cheap and correct for our small N (one row per run);
    // a JSON1-table-function approach would be overkill here.
    clauses.push("tags LIKE ?");
    params.push(`%"${filters.tag.replace(/[\\%_]/g, "\\$&")}"%`);
  }
  const limitClause = filters.limit && filters.limit > 0 ? ` LIMIT ${filters.limit}` : "";
  const rows = db.query(
    `SELECT * FROM runs WHERE ${clauses.join(" AND ")} ORDER BY started_at ASC${limitClause}`,
  ).all(...(params as (string | number)[]));
  const out: RunRecord[] = [];
  for (const r of rows) {
    const decoded = decodeRunRow(r);
    if (decoded) out.push(decoded);
  }
  return out;
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

/** TASK-266: latest run with at least one failure (for `zond db diagnose`
 *  default and `zond-triage` skill). Returns null when no failing run exists. */
export function getLatestFailingRunId(): number | null {
  const db = getDb();
  const row = db.query(`
    SELECT id FROM runs
    WHERE failed > 0
    ORDER BY started_at DESC
    LIMIT 1
  `).get() as { id: number } | undefined;
  return row?.id ?? null;
}

/** TASK-266: latest run regardless of status (for `--latest`). */
export function getLatestRunId(): number | null {
  const db = getDb();
  const row = db.query(`
    SELECT id FROM runs
    ORDER BY started_at DESC
    LIMIT 1
  `).get() as { id: number } | undefined;
  return row?.id ?? null;
}

export function deleteRun(runId: number): boolean {
  const db = getDb();
  // results are cascade-deleted via FK; but SQLite FK delete cascade requires explicit config
  return withDbRetry("deleteRun", () => {
    db.prepare("DELETE FROM results WHERE run_id = ?").run(runId);
    const result = db.prepare("DELETE FROM runs WHERE id = ?").run(runId);
    return result.changes > 0;
  });
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
