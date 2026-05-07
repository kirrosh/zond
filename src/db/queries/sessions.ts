import { getDb } from "../schema.ts";
import type { RunSummary, SessionSummary } from "./types.ts";

export function listSessions(limit = 20, offset = 0): SessionSummary[] {
  const db = getDb();
  return db.query(`
    SELECT
      session_id,
      MIN(started_at)        AS started_at,
      MAX(finished_at)       AS finished_at,
      COUNT(*)               AS run_count,
      COALESCE(SUM(total), 0)   AS total,
      COALESCE(SUM(passed), 0)  AS passed,
      COALESCE(SUM(failed), 0)  AS failed,
      COALESCE(SUM(skipped), 0) AS skipped,
      SUM(duration_ms)       AS duration_ms,
      MAX(environment)       AS environment
    FROM runs
    WHERE session_id IS NOT NULL
    GROUP BY session_id
    ORDER BY started_at DESC
    LIMIT ? OFFSET ?
  `).all(limit, offset) as SessionSummary[];
}

export function countSessions(): number {
  const db = getDb();
  const row = db.query(
    "SELECT COUNT(DISTINCT session_id) AS cnt FROM runs WHERE session_id IS NOT NULL",
  ).get() as { cnt: number };
  return row.cnt;
}

export function listRunsBySession(sessionId: string): RunSummary[] {
  const db = getDb();
  return db.query(`
    SELECT id, started_at, finished_at, total, passed, failed, skipped, environment, duration_ms, collection_id, session_id
    FROM runs
    WHERE session_id = ?
    ORDER BY started_at ASC
  `).all(sessionId) as RunSummary[];
}
