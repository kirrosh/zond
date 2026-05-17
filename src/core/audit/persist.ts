/**
 * ARV-265: shared helpers for "any HTTP touch by zond should be visible
 * to `audit-coverage`". `zond run` was the only producer that wrote into
 * `runs` / `results`; `checks run`, `probe`, `request`, and
 * `prepare-fixtures --cascade` all emitted ndjson/stdout and left no
 * persistent trace. This module gives those producers a uniform path:
 *
 *   1. `beginAuditRun(opts)` — INSERT into `runs` with the right
 *      `run_kind` and return the row id.
 *   2. accumulate `AuditCaseRecord` entries as the work runs.
 *   3. `finalizeAuditRun(runId, suiteName, cases)` — group cases into a
 *      single synthetic `TestRunResult`, call `saveResults`, then
 *      `finalizeRun` so the row carries totals.
 *
 * Suite/test naming is *pseudo* (`checks/response`, `probe/security`,
 * `request/ad-hoc`) — these rows aren't meant to drive failure triage,
 * just to keep the audit-coverage matrix honest. The coverage engine
 * matches results to endpoints via (request_method, request_url) regex,
 * so the suite name is purely cosmetic.
 *
 * Error handling: every write is wrapped in try/catch by the CLI caller
 * and degrades to a warning — failing to persist must not break the
 * primary command (a `checks run` that exits 0 with no DB row is still
 * a successful checks run for the user; audit-coverage just won't pick
 * it up).
 */
import type { HttpRequest, HttpResponse, TestRunResult, StepResult, StepStatus } from "../runner/types.ts";
import type { RunKind } from "../runner/run-kind.ts";
import { createRun, saveResults, finalizeRun } from "../../db/queries.ts";
import { setHttpAuditRecorder, type AuditRecord } from "../runner/http-client.ts";

export interface BeginAuditRunOpts {
  runKind: RunKind;
  collectionId?: number;
  sessionId?: string | null;
  environment?: string;
  trigger?: string;
  tags?: string[];
  commitSha?: string;
  branch?: string;
  startedAt?: string;
}

export interface AuditCaseRecord {
  suiteName: string;
  testName: string;
  status: StepStatus;
  request: HttpRequest;
  response?: HttpResponse;
  durationMs: number;
  error?: string;
  /** Optional `suite_file` value — surfaces in the diagnose output and
   *  helps the legacy detectRunKind heuristic understand the row's
   *  origin even if `run_kind` ever drifts. */
  suiteFile?: string;
}

export function beginAuditRun(opts: BeginAuditRunOpts): number {
  return createRun({
    started_at: opts.startedAt ?? new Date().toISOString(),
    environment: opts.environment,
    trigger: opts.trigger ?? "manual",
    commit_sha: opts.commitSha,
    branch: opts.branch,
    collection_id: opts.collectionId,
    session_id: opts.sessionId ?? undefined,
    tags: opts.tags && opts.tags.length > 0 ? opts.tags : undefined,
    run_kind: opts.runKind,
  });
}

/**
 * Group flat case records into one `TestRunResult` per `suite_file` (or
 * per `suiteName` when no file is set) and write them. Returns the number
 * of `results` rows persisted so the caller can sanity-check the totals.
 */
export function finalizeAuditRun(
  runId: number,
  cases: AuditCaseRecord[],
): { rows: number } {
  if (cases.length === 0) {
    // Nothing executed — still close the run so coverage queries can
    // see an empty audit row instead of an open-ended row dangling
    // without finished_at.
    finalizeRun(runId, []);
    return { rows: 0 };
  }
  const bySuite = new Map<string, AuditCaseRecord[]>();
  for (const c of cases) {
    const key = c.suiteFile ?? c.suiteName;
    const list = bySuite.get(key) ?? [];
    list.push(c);
    bySuite.set(key, list);
  }
  const now = new Date().toISOString();
  const results: TestRunResult[] = [];
  for (const [, group] of bySuite) {
    const first = group[0]!;
    const steps: StepResult[] = group.map((c) => ({
      name: c.testName,
      status: c.status,
      duration_ms: c.durationMs,
      request: c.request,
      response: c.response,
      assertions: [],
      captures: {},
      ...(c.error ? { error: c.error } : {}),
    }));
    let passed = 0, failed = 0, skipped = 0;
    for (const s of steps) {
      if (s.status === "pass") passed += 1;
      else if (s.status === "skip") skipped += 1;
      else failed += 1; // fail | error both bucket as failed for the row totals
    }
    results.push({
      suite_name: first.suiteName,
      ...(first.suiteFile ? { suite_file: first.suiteFile } : {}),
      started_at: now,
      finished_at: now,
      total: steps.length,
      passed,
      failed,
      skipped,
      steps,
    });
  }
  saveResults(runId, results);
  finalizeRun(runId, results);
  return { rows: cases.length };
}

/** ARV-265: ZOND_CHECKS_PERSIST opt-out. Default ON — the task's whole
 *  point is that `checks run` contributes to audit-coverage out of the
 *  box. Setting the env var to "0" / "false" disables it (for tests, or
 *  for users who want the pre-ARV-265 behaviour back). */
export function checksPersistEnabled(): boolean {
  const v = (process.env.ZOND_CHECKS_PERSIST ?? "").trim().toLowerCase();
  if (v === "0" || v === "false" || v === "off" || v === "no") return false;
  return true;
}

/**
 * ARV-265: run `fn` with the HTTP audit recorder set; return both the
 * function's value and the collected records. Convenience for the live
 * probe commands (probe security / probe mass-assignment) which can't
 * easily hook into their own internals but route every request through
 * `executeRequest`.
 *
 * The recorder is always cleared in `finally`, even if `fn` throws.
 */
export async function withHttpAudit<T>(
  fn: () => Promise<T>,
): Promise<{ value: T; records: AuditRecord[] }> {
  const records: AuditRecord[] = [];
  setHttpAuditRecorder((rec) => records.push(rec));
  try {
    const value = await fn();
    return { value, records };
  } finally {
    setHttpAuditRecorder(null);
  }
}

export function auditRecordToCase(
  rec: AuditRecord,
  meta: { suiteName: string; suiteFile: string; testName: string },
): AuditCaseRecord {
  const status: StepStatus = rec.error
    ? "error"
    : rec.response && rec.response.status >= 200 && rec.response.status < 400 ? "pass" : "fail";
  return {
    suiteName: meta.suiteName,
    suiteFile: meta.suiteFile,
    testName: meta.testName,
    status,
    request: rec.request,
    ...(rec.response ? { response: rec.response } : {}),
    durationMs: rec.durationMs,
    ...(rec.error ? { error: rec.error } : {}),
  };
}

export type { AuditRecord } from "../runner/http-client.ts";
