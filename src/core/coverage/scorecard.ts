/**
 * ARV-437: one-line value-hook for a run/scan. A deterministic aggregate over
 * the SAME artifacts `coverage` already reads (the coverage matrix + the
 * contributing run records) — no new HTTP, no severity judgment. It answers
 * "what did this scan get me" in a single line the way `rtk gain` answers
 * "what did I save":
 *
 *   <N> findings · <X>% honest-2xx · <M>/<T> ops · <t>
 *
 * All four numbers are counts/spans of persisted data, never inference:
 *   - findings  — stored results carrying a `failure_class` (dedup by id)
 *   - honest-2xx — ops with ≥1 passing 2xx result / total ops
 *   - ops       — ops with ≥1 stored result (reached) / total ops in spec
 *   - t         — wall-clock span of the contributing runs
 */
import type { CoverageMatrix } from "./reasons.ts";
import type { RunRecord } from "../../db/queries/types.ts";

export interface ScorecardStats {
  /** Distinct stored results carrying a failure_class across the run set. */
  findings: number;
  /** Ops with at least one passing 2xx result. */
  honest2xx: number;
  /** Ops with at least one stored result (any status). */
  reached: number;
  /** Total ops in the spec (matrix rows). */
  total: number;
  /** round(honest2xx / total * 100); 0 when total is 0. */
  honest2xxPct: number;
  /** Wall-clock span of the contributing runs, ms. 0 when unknown. */
  durationMs: number;
  /** Number of runs folded into this scorecard. */
  runs: number;
}

/** Mirrors `bucketRows` in coverage.ts: an op is honest-2xx iff some stored
 *  result passed with a 2xx response. Kept inline (3 lines) so core doesn't
 *  depend on the cli layer; if the predicate ever grows, hoist bucketRows
 *  into core and share it. */
function isHonest2xx(refs: { status: string; responseStatus: number | null }[]): boolean {
  return refs.some(
    r => r.status === "pass" && r.responseStatus != null && r.responseStatus >= 200 && r.responseStatus < 300,
  );
}

export function computeScorecard(matrix: CoverageMatrix, runs: RunRecord[]): ScorecardStats {
  let honest2xx = 0;
  let reached = 0;
  const findingIds = new Set<number>();

  for (const row of matrix.rows) {
    const refs = Object.values(row.cells).flatMap(c => c.results);
    if (refs.length > 0) reached += 1;
    if (isHonest2xx(refs)) honest2xx += 1;
    // ponytail: findings = stored results the runner classified (failure_class
    // set by executor/probe). Depth-check-only findings persist as a bare
    // status='fail' HTTP touch WITHOUT severity (audit/persist.ts), so they are
    // not counted here — the honest on-disk ceiling. Full checks breakdown
    // lives in `checks run` output; upgrade path is persisting check severity.
    for (const r of refs) {
      if (r.failureClass != null) findingIds.add(r.resultId);
    }
  }

  const total = matrix.rows.length;

  // Time is per-run measured `duration_ms`, summed. Scan runs are sequential
  // (test → probe → check), so summing is right and avoids the wall-clock trap
  // where check/request runs stamp started_at≈finished_at at persist time (a
  // single `now`), collapsing any span to ~0. When a run has no measured
  // duration, fall back to its own started→finished span. ponytail: check-run
  // wall-clock genuinely isn't recorded, so a checks-only session reads low —
  // an honest ceiling, not a bug.
  let durationMs = 0;
  for (const run of runs) {
    if (run.duration_ms != null && run.duration_ms > 0) {
      durationMs += run.duration_ms;
      continue;
    }
    const start = Date.parse(run.started_at);
    const end = Date.parse(run.finished_at ?? run.started_at);
    if (Number.isFinite(start) && Number.isFinite(end) && end > start) durationMs += end - start;
  }

  return {
    findings: findingIds.size,
    honest2xx,
    reached,
    total,
    honest2xxPct: total === 0 ? 0 : Math.round((honest2xx / total) * 100),
    durationMs,
    runs: runs.length,
  };
}

/** Compact human duration: "820ms", "12s", "3m 30s", "1h 4m". */
export function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rem = s % 60;
  if (m < 60) return rem === 0 ? `${m}m` : `${m}m ${rem}s`;
  const h = Math.floor(m / 60);
  const mrem = m % 60;
  return mrem === 0 ? `${h}h` : `${h}h ${mrem}m`;
}

/** The single scorecard line. */
export function formatScorecardLine(stats: ScorecardStats): string {
  return [
    `${stats.findings} finding${stats.findings === 1 ? "" : "s"}`,
    `${stats.honest2xxPct}% honest-2xx`,
    `${stats.reached}/${stats.total} ops`,
    formatDuration(stats.durationMs),
  ].join(" · ");
}
