/**
 * ARV-439 (m-29): persistence for depth-check findings. `checks run` records
 * a `run_kind='check'` run (audit/persist.ts) for HTTP-touch coverage; this
 * stores the findings that run produced, keyed by the same run_id, so
 * `scorecard` / `zond-triage` can report drift without re-running checks.
 *
 * Deterministic plumbing only: the fields are what the check already emits
 * (check name, its fixed-mapping severity, the operation, the observed
 * status). No calibration, no anti-FP — that stays with the agent.
 */
import type { Database } from "bun:sqlite";
import { getDb } from "./schema.ts";
import type { CheckFinding } from "../core/checks/types.ts";

export interface CheckFindingRow {
  id: number;
  run_id: number;
  check_name: string;
  severity: string;
  category: string | null;
  method: string | null;
  path: string | null;
  status: number | null;
  message: string | null;
  recommended_action: string | null;
  /** 1 when the finding was excluded from CI-gate counts (ARV-307
   *  broken-baseline). Mirrors the gate so headline counts can match. */
  suppressed: number;
}

/** Bulk-insert a check run's findings. No-op on an empty list. */
export function saveCheckFindings(db: Database, runId: number, findings: readonly CheckFinding[]): void {
  if (findings.length === 0) return;
  const stmt = db.prepare(
    `INSERT INTO check_findings
       (run_id, check_name, severity, category, method, path, status, message, recommended_action, suppressed)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  db.transaction(() => {
    for (const f of findings) {
      stmt.run(
        runId,
        f.check,
        f.severity,
        f.category ?? null,
        f.operation?.method ?? null,
        f.operation?.path ?? null,
        f.response_summary?.status ?? null,
        f.message ?? null,
        f.recommended_action ?? null,
        f.suppressed_by ? 1 : 0,
      );
    }
  })();
}

export function getCheckFindingsByRunId(runId: number, db: Database = getDb()): CheckFindingRow[] {
  return db.query("SELECT * FROM check_findings WHERE run_id = ? ORDER BY id").all(runId) as CheckFindingRow[];
}

/** Findings across several runs (e.g. every check run folded into a scan
 *  session). Empty array for an empty id list — no all-rows fallback. */
export function getCheckFindingsByRunIds(runIds: readonly number[], db: Database = getDb()): CheckFindingRow[] {
  if (runIds.length === 0) return [];
  const placeholders = runIds.map(() => "?").join(", ");
  return db
    .query(`SELECT * FROM check_findings WHERE run_id IN (${placeholders}) ORDER BY id`)
    .all(...runIds) as CheckFindingRow[];
}
