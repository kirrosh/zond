import type { Database } from "bun:sqlite";
import type { Issue, LintConfig, LintStats } from "../core/lint/index.ts";

export interface LintRunRow {
  id: number;
  spec_path: string;
  started_at: string;
  finished_at: string | null;
  total: number;
  high_count: number;
  medium_count: number;
  low_count: number;
  endpoint_count: number;
}

export function createLintRun(db: Database, specPath: string): number {
  const startedAt = new Date().toISOString();
  const stmt = db.prepare(
    "INSERT INTO lint_runs (spec_path, started_at) VALUES (?, ?)",
  );
  const info = stmt.run(specPath, startedAt) as { lastInsertRowid: number | bigint };
  return Number(info.lastInsertRowid);
}

export function finalizeLintRun(
  db: Database,
  id: number,
  issues: Issue[],
  stats: LintStats,
  config: LintConfig,
): void {
  db.prepare(
    `UPDATE lint_runs SET
      finished_at = ?,
      total = ?, high_count = ?, medium_count = ?, low_count = ?,
      endpoint_count = ?,
      config_json = ?, issues_json = ?
     WHERE id = ?`,
  ).run(
    new Date().toISOString(),
    stats.total, stats.high, stats.medium, stats.low,
    stats.endpoints,
    JSON.stringify({ rules: config.rules, heuristics: config.heuristics, ignore_paths: config.ignore_paths }),
    JSON.stringify(issues),
    id,
  );
}
