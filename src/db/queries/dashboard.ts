import { getDb } from "../schema.ts";
import type {
  DashboardStats,
  PassRateTrendPoint,
  SlowestTest,
  FlakyTest,
} from "./types.ts";

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
