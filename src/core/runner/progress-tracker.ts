/**
 * ARV-249: lightweight progress tracker for `zond run`. A separate module
 * so the formatter can be unit-tested without spinning up an executor.
 *
 * Architecture: run.ts owns the tracker + `setInterval`. Every completed
 * step calls `tracker.recordStep(...)` via `RunSuiteOptions.onStepDone`,
 * the interval ticks every PROGRESS_INTERVAL_MS and writes one stderr
 * line, and run.ts clears the interval before printing the final report.
 */
import { formatEta } from "../util/format-eta.ts";
import type { StepResult } from "./types.ts";

export const PROGRESS_INTERVAL_MS = 5000;
/** Wait this long before emitting the first progress line. Short runs
 *  that finish under the threshold stay silent. */
export const PROGRESS_QUIET_MS = 5000;

export interface ProgressSnapshot {
  elapsedMs: number;
  completedSteps: number;
  totalSteps: number;
  httpRequests: number;
  effectiveRps: number;
  etaSeconds: number;
}

export class ProgressTracker {
  private completedSteps = 0;
  private httpRequests = 0;
  private readonly startedAt: number;

  constructor(private readonly totalSteps: number, now: number = Date.now()) {
    this.startedAt = now;
  }

  recordStep(step: StepResult): void {
    this.completedSteps += 1;
    if (step.status !== "skip" && step.response !== undefined) {
      this.httpRequests += 1;
    }
  }

  snapshot(now: number = Date.now()): ProgressSnapshot {
    const elapsedMs = Math.max(0, now - this.startedAt);
    const elapsedSec = elapsedMs / 1000;
    const effectiveRps = elapsedSec > 0 ? this.httpRequests / elapsedSec : 0;
    const remaining = Math.max(0, this.totalSteps - this.completedSteps);
    const stepRate = elapsedSec > 0 ? this.completedSteps / elapsedSec : 0;
    const etaSeconds = stepRate > 0 ? remaining / stepRate : Infinity;
    return {
      elapsedMs,
      completedSteps: this.completedSteps,
      totalSteps: this.totalSteps,
      httpRequests: this.httpRequests,
      effectiveRps,
      etaSeconds,
    };
  }
}

/** Format a progress snapshot for stderr. Stable wording — agents may
 *  grep the line. */
export function formatProgressLine(snap: ProgressSnapshot): string {
  const elapsed = formatEta(snap.elapsedMs / 1000);
  const pct = snap.totalSteps > 0
    ? Math.min(100, Math.floor((snap.completedSteps / snap.totalSteps) * 100))
    : 0;
  const rps = snap.effectiveRps >= 10
    ? Math.round(snap.effectiveRps).toString()
    : snap.effectiveRps.toFixed(1);
  const eta = Number.isFinite(snap.etaSeconds) ? formatEta(snap.etaSeconds) : "?";
  return `zond: [${elapsed}] ${snap.completedSteps}/${snap.totalSteps} steps (${pct}%), ${snap.httpRequests} req, ~${rps} req/s, ETA ${eta}`;
}
