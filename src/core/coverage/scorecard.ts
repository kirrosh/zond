/**
 * ARV-437 / ARV-440: evidence panel for a run/scan. A deterministic aggregate
 * over already-persisted artifacts (the coverage matrix, the run records, and
 * the ARV-439 `check_findings`) — no new HTTP, no severity judgment. It gives
 * the one honest glance a scan is worth, the way `rtk gain` gives "what I
 * saved", but framed as evidence an agent builds an API assessment ON (the
 * grade stays with the agent — litmus):
 *
 *   <5xx> 5xx · <F> findings · <sev…> · <ex>%/<full>% honest-2xx · <M>/<T> ops · <t> · <Δ>
 *
 * Every number is a count/span of stored data, never inference:
 *   - 5xx        — server-error responses observed (judgment-free health signal)
 *   - findings   — non-suppressed depth-check findings (ARV-439), by severity
 *   - suite-fail — classified suite/probe failures (failure_class results)
 *   - honest-2xx — ops with ≥1 passing 2xx, over reached (exercised) and total (full)
 *   - ops        — ops with ≥1 stored result (reached) / total ops in spec
 *   - t          — summed per-run duration
 *   - Δ          — non-suppressed check-finding delta vs the previous scan
 */
import type { CoverageMatrix } from "./reasons.ts";
import type { RunRecord } from "../../db/queries/types.ts";
import type { CheckFindingRow } from "../../db/check-findings.ts";
import type { Severity } from "../severity/index.ts";

export interface ScorecardStats {
  /** 5xx responses observed across the run set — the one judgment-free signal. */
  serverErrors: number;
  /** Non-suppressed depth-check findings (ARV-439). Headline finding count;
   *  bySeverity sums to exactly this. */
  findings: number;
  /** Depth-check findings excluded from the count by the ARV-307 gate. */
  suppressed: number;
  /** Classified suite/probe failures (failure_class results) — separate from
   *  depth-check findings, shown as `suite-fail` so the severity split stays
   *  clean. */
  suiteFailures: number;
  /** Check findings split by as-emitted severity (deterministic, not calibrated). */
  bySeverity: Record<Severity, number>;
  /** Check findings split by category (contract/reliability/security/hygiene…). */
  byCategory: Record<string, number>;
  /** Ops with at least one passing 2xx result. */
  honest2xx: number;
  /** Ops with at least one stored result (any status). */
  reached: number;
  /** Total ops in the spec (matrix rows). */
  total: number;
  /** round(honest2xx / reached * 100) — the flattering, fair denominator. */
  honest2xxPctExercised: number;
  /** round(honest2xx / total * 100) — the whole-surface denominator. */
  honest2xxPctFull: number;
  /** Summed per-run duration, ms. */
  durationMs: number;
  /** Runs folded into this scorecard. */
  runs: number;
  /** findings − previous scan's non-suppressed findings; null when no prior scan. */
  findingsDelta: number | null;
}

/** Mirrors `bucketRows` in coverage.ts: an op is honest-2xx iff some stored
 *  result passed with a 2xx response. Kept inline so core doesn't depend on
 *  the cli layer. */
function isHonest2xx(refs: { status: string; responseStatus: number | null }[]): boolean {
  return refs.some(
    r => r.status === "pass" && r.responseStatus != null && r.responseStatus >= 200 && r.responseStatus < 300,
  );
}

function emptySeverity(): Record<Severity, number> {
  return { critical: 0, high: 0, medium: 0, low: 0, info: 0 };
}

export function computeScorecard(
  matrix: CoverageMatrix,
  runs: RunRecord[],
  checkFindings: readonly CheckFindingRow[] = [],
  previousScanFindings: number | null = null,
): ScorecardStats {
  let honest2xx = 0;
  let reached = 0;
  let serverErrors = 0;
  const suiteFailureIds = new Set<number>();

  for (const row of matrix.rows) {
    const refs = Object.values(row.cells).flatMap(c => c.results);
    if (refs.length > 0) reached += 1;
    if (isHonest2xx(refs)) honest2xx += 1;
    // 5xx are bucketed into the "5xx" status-class cell by the matrix engine.
    serverErrors += row.cells["5xx"].results.length;
    // Suite/probe failures the runner classified (failure_class). Separate
    // from depth-check findings (ARV-439) which persist in check_findings.
    for (const r of refs) {
      if (r.failureClass != null) suiteFailureIds.add(r.resultId);
    }
  }

  const bySeverity = emptySeverity();
  const byCategory: Record<string, number> = {};
  let findings = 0;
  let suppressed = 0;
  for (const f of checkFindings) {
    if (f.suppressed === 1) { suppressed += 1; continue; }
    findings += 1;
    const sev = (f.severity in bySeverity ? f.severity : "info") as Severity;
    bySeverity[sev] += 1;
    const cat = f.category ?? "uncategorized";
    byCategory[cat] = (byCategory[cat] ?? 0) + 1;
  }

  const total = matrix.rows.length;

  // Time is per-run measured `duration_ms`, summed (scan runs are sequential).
  // Fall back to a run's own started→finished span when unmeasured. ponytail:
  // check-run wall-clock isn't recorded, so a checks-only session reads low —
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
    serverErrors,
    findings,
    suppressed,
    suiteFailures: suiteFailureIds.size,
    bySeverity,
    byCategory,
    honest2xx,
    reached,
    total,
    honest2xxPctExercised: reached === 0 ? 0 : Math.round((honest2xx / reached) * 100),
    honest2xxPctFull: total === 0 ? 0 : Math.round((honest2xx / total) * 100),
    durationMs,
    runs: runs.length,
    findingsDelta: previousScanFindings == null ? null : findings - previousScanFindings,
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

const SEV_ORDER: Severity[] = ["critical", "high", "medium", "low", "info"];
const SEV_SHORT: Record<Severity, string> = { critical: "crit", high: "high", medium: "med", low: "low", info: "info" };

/** The single evidence-panel line. Segments join with " · "; zero-value
 *  detail segments (severities, suite-fail, delta) drop out so the line stays
 *  scannable. */
export function formatScorecardLine(stats: ScorecardStats): string {
  const seg: string[] = [`${stats.serverErrors} 5xx`];

  seg.push(`${stats.findings} finding${stats.findings === 1 ? "" : "s"}`);
  for (const sev of SEV_ORDER) {
    if (stats.bySeverity[sev] > 0) seg.push(`${stats.bySeverity[sev]} ${SEV_SHORT[sev]}`);
  }
  if (stats.suiteFailures > 0) seg.push(`${stats.suiteFailures} suite-fail`);

  seg.push(`${stats.honest2xxPctExercised}%/${stats.honest2xxPctFull}% honest-2xx`);
  seg.push(`${stats.reached}/${stats.total} ops`);
  seg.push(formatDuration(stats.durationMs));

  if (stats.findingsDelta != null) {
    const d = stats.findingsDelta;
    const sign = d > 0 ? `+${d}` : d < 0 ? `${d}` : "±0";
    seg.push(`${sign} vs prev`);
  }
  return seg.join(" · ");
}
