/**
 * ARV-60: spec-level rollup of systemic gaps.
 *
 * Many findings are a single spec-level fact (no 401 declared anywhere,
 * no response schemas, no DELETE+GET pair detectable) smeared across N
 * operations. The flat finding list reads as "83 problems" when it's
 * really "1 problem × 83 sites". Small teams reading the report can't
 * tell whether to act on the spec or on the server — and the actionable
 * line tends to be the same for every row.
 *
 * This module computes `SpecFinding[]` from the runner's primary outputs:
 *
 *   1. **status_drift** — group existing findings by (check, status); if
 *      a group covers ≥80% of the check's applicable operations, emit
 *      one rollup row. Per-op findings stay in `data.findings` (so SARIF
 *      and `--verbose` keep the long form).
 *   2. **missing_declaration** — a single skipped_outcome reason covers
 *      ≥80% of the check's applicable cases. Typical: response schema /
 *      header schema not declared on this API.
 *   3. **no_detector** — check is applicable to ≥5 operations but ran
 *      zero cases. Typical: `use_after_free` without DELETE+GET pair.
 *      Different from skip — the check itself produced no cases.
 *
 * Threshold is hard-coded at 0.8 (AC #1). Lower would create false
 * rollups on small (<10-op) APIs where a 3/4 incidental cluster doesn't
 * indicate a systemic gap.
 */
import type {
  CheckFinding,
  SpecFinding,
} from "./types.ts";
import { categoryFor } from "../severity/category.ts";

export interface PerCheckObservations {
  /** Distinct operations where `check.applies(op) === true`. */
  applicable: number;
  /** Count of cases the check actually ran (passed + failed + skipped). */
  cases: number;
  /** ARV-26-style "check: reason" → count, restricted to this check. */
  skipped: Record<string, number>;
}

const SPEC_CLUSTER_RATIO = 0.8;
const NO_DETECTOR_FLOOR = 5;

/** Mapping table: check id + response status → human reason + actionable
 *  fix hint. Centralised so a future check that opts into rollup can just
 *  register its hint here. */
function explainStatusDrift(checkId: string, status: number): { reason: string; fix: string } {
  if (checkId === "status_code_conformance") {
    return {
      reason: `Status ${status} not declared in spec`,
      fix: `Add ${status} to the response declarations for the affected operations, or pass --tolerate-undeclared ${status}.`,
    };
  }
  if (checkId === "ignored_auth") {
    return {
      reason: `Auth probes did not produce ${status >= 400 ? "the expected rejection" : "a 4xx"} (got ${status})`,
      fix: `Verify the security scheme is enforced server-side, or relax with --strict-401=false.`,
    };
  }
  if (checkId === "negative_data_rejection") {
    return {
      reason: `Negative payloads accepted with ${status} on most operations`,
      fix: `Server is not validating inputs — fix request-body validation, or downgrade by adjusting tolerated statuses in your gate.`,
    };
  }
  if (checkId === "unsupported_method") {
    return {
      reason: `Undeclared methods returned ${status} instead of 405`,
      fix: `Configure the gateway to emit 405 for undeclared verbs, or pass --strict-405=false.`,
    };
  }
  if (checkId === "missing_required_header") {
    return {
      reason: `Required-header omission returned ${status}`,
      fix: `Server should reject with 400/415 when required headers are missing.`,
    };
  }
  // Generic fallback — better than "(unknown reason)".
  return {
    reason: `Response status ${status} clustered across most operations for ${checkId}`,
    fix: `Inspect a sample finding for context, or run with --verbose for per-op detail.`,
  };
}

function explainSkipCluster(checkId: string, reason: string): { reason: string; fix: string } | null {
  if (checkId === "response_schema_conformance") {
    return {
      reason: `Response schemas not declared on this API (${reason})`,
      fix: `Add response schemas to spec.json, or run \`zond api annotate dump readback\` to capture them from live runs.`,
    };
  }
  if (checkId === "response_headers_conformance") {
    return {
      reason: `Response headers not declared on this API (${reason})`,
      fix: `Add response header declarations to spec.json — without them this check is a no-op.`,
    };
  }
  if (checkId === "not_a_server_error" && /skipped|max_requests/.test(reason)) {
    return null; // budget-skip, not a spec gap
  }
  if (/max_requests|max-requests/.test(reason)) {
    return null; // ARV-227 budget cap is not a spec finding
  }
  // Other skip clusters fall through — surfaced as `other` kind.
  return {
    reason: `Most cases for ${checkId} skipped (${reason})`,
    fix: `Inspect one sample (zond db diagnose --run-id <id>) to confirm the gap is intentional.`,
  };
}

function explainNoDetector(checkId: string): { reason: string; fix: string } {
  if (checkId === "use_after_free") {
    return {
      reason: `No DELETE+GET pair detectable from spec — check ran 0 cases`,
      fix: `Annotate resources (\`zond api annotate dump readback\`) or add explicit lifecycle declarations.`,
    };
  }
  if (checkId === "ensure_resource_availability") {
    return {
      reason: `No CRUD pair detected — check ran 0 cases`,
      fix: `Run \`zond api annotate dump readback\` to capture resource boundaries.`,
    };
  }
  if (checkId === "cross_call_references") {
    return {
      reason: `No POST→GET follow-up pair detected — check ran 0 cases`,
      fix: `Annotate resources with readback_diff in .api-resources.yaml.`,
    };
  }
  return {
    reason: `${checkId} applicable but produced 0 cases on this API`,
    fix: `Inspect the case-generator for this check or add resource annotations.`,
  };
}

/**
 * ARV-307: broken-baseline guard for conformance checks.
 *
 * On a degenerate baseline (e.g. a fully auth-rejected scan where every
 * response is 401/404, zero 2xx), `status_code_conformance` and
 * `content_type_conformance` fire on every undeclared status/content-type
 * and emit thousands of findings that are pure baseline artifacts — the
 * status_drift rollup in computeSpecFindings can't collapse them because the
 * undeclared statuses are diverse (401 here, 404 there), so no single
 * (check,status) group crosses the 80% threshold.
 *
 * Stateful checks already skip on a per-case broken-baseline guard; this is
 * the run-level equivalent for the conformance family: if the positive
 * (expected-success) probes overwhelmingly failed, the whole conformance
 * signal is untrustworthy, so we roll it up into one `broken_baseline`
 * spec_finding and drop the per-op conformance findings.
 *
 * We gate on the POSITIVE-probe baseline, not all responses — negative /
 * boundary cases legitimately return 4xx on a healthy API, so counting them
 * would false-trip the guard. `positiveTwoxx / positiveTotal` is the success
 * rate of the probes that are supposed to succeed.
 *
 * Threshold: >90% of positive probes non-2xx, with ≥10 positive probes so a
 * tiny run doesn't trip on a single failure. When fewer than 10 positive
 * probes ran (e.g. negative-only mode) the baseline can't be judged and the
 * guard is a no-op.
 */
export const BASELINE_GATED_CHECKS: ReadonlySet<string> = new Set([
  "status_code_conformance",
  "content_type_conformance",
]);
export const BROKEN_BASELINE_NON2XX_RATIO = 0.9;
export const BROKEN_BASELINE_MIN_POSITIVE = 10;

export function applyBrokenBaselineGuard(input: {
  findings: CheckFinding[];
  positiveTotal: number;
  positiveTwoxx: number;
}): { kept: CheckFinding[]; removed: CheckFinding[]; specFinding: SpecFinding | null } {
  const { findings, positiveTotal, positiveTwoxx } = input;
  const noop = { kept: findings, removed: [] as CheckFinding[], specFinding: null };
  if (positiveTotal < BROKEN_BASELINE_MIN_POSITIVE) return noop;
  const nonTwoxxRatio = (positiveTotal - positiveTwoxx) / positiveTotal;
  if (nonTwoxxRatio < BROKEN_BASELINE_NON2XX_RATIO) return noop;

  const kept: CheckFinding[] = [];
  const removed: CheckFinding[] = [];
  for (const f of findings) {
    // Suppressed findings are already out of the CI-gating tallies; leave
    // them in the audit trail untouched.
    if (!f.suppressed_by && BASELINE_GATED_CHECKS.has(f.check)) removed.push(f);
    else kept.push(f);
  }
  if (removed.length === 0) return noop;

  const affected = new Map<string, { path: string; method: string; operationId?: string }>();
  for (const f of removed) {
    affected.set(`${f.operation.method} ${f.operation.path}`, f.operation);
  }
  const pct = Math.round(nonTwoxxRatio * 100);
  const specFinding: SpecFinding = {
    check: "status_code_conformance",
    kind: "broken_baseline",
    severity: "info",
    category: categoryFor("status_code_conformance"),
    reason:
      `Degenerate baseline: ${pct}% of ${positiveTotal} positive probes returned non-2xx ` +
      `(only ${positiveTwoxx} succeeded). ${removed.length} conformance finding(s) suppressed as ` +
      `baseline artifacts.`,
    fix_hint:
      `Fix the baseline first — supply valid auth (--auth-header / apis/<name>/.env.yaml) and ` +
      `seed path-param fixtures (\`zond prepare-fixtures\`) so positive probes reach 2xx, then re-run ` +
      `conformance. Undeclared statuses on an all-4xx scan are not real spec drift.`,
    affected_operations: [...affected.values()],
    count: removed.length,
    applicable: positiveTotal,
  };
  return { kept, removed, specFinding };
}

export function computeSpecFindings(
  findings: CheckFinding[],
  perCheck: Map<string, PerCheckObservations>,
): SpecFinding[] {
  const out: SpecFinding[] = [];

  // --- 1. status_drift: cluster findings by (check, status). -----------
  type Group = {
    severity: CheckFinding["severity"];
    check: string;
    status: number;
    ops: Map<string, CheckFinding["operation"]>;
  };
  const groups = new Map<string, Group>();
  for (const f of findings) {
    const status = f.response_summary?.status ?? 0;
    if (status <= 0) continue; // network errors etc — not a status drift
    const key = `${f.check}|${status}`;
    let g = groups.get(key);
    if (!g) {
      g = { severity: f.severity, check: f.check, status, ops: new Map() };
      groups.set(key, g);
    }
    const opKey = `${f.operation.method} ${f.operation.path}`;
    if (!g.ops.has(opKey)) g.ops.set(opKey, f.operation);
  }
  for (const g of groups.values()) {
    const obs = perCheck.get(g.check);
    const applicable = obs?.applicable ?? g.ops.size;
    if (g.ops.size < 2) continue; // single-op rows aren't a rollup
    if (g.ops.size / Math.max(applicable, 1) < SPEC_CLUSTER_RATIO) continue;
    const { reason, fix } = explainStatusDrift(g.check, g.status);
    out.push({
      check: g.check,
      kind: "status_drift",
      severity: g.severity,
      category: categoryFor(g.check),
      reason,
      fix_hint: fix,
      affected_operations: [...g.ops.values()],
      count: g.ops.size,
      applicable,
    });
  }

  // --- 2. missing_declaration: skip cluster. ---------------------------
  for (const [checkId, obs] of perCheck) {
    if (obs.cases <= 0) continue;
    for (const [rawReason, count] of Object.entries(obs.skipped)) {
      if (count / obs.cases < SPEC_CLUSTER_RATIO) continue;
      // skipped key is "<checkId>: <reason>" — strip the prefix when it
      // matches; otherwise treat the whole thing as the reason.
      const reason = rawReason.startsWith(`${checkId}: `) ? rawReason.slice(checkId.length + 2) : rawReason;
      const expl = explainSkipCluster(checkId, reason);
      if (!expl) continue;
      out.push({
        check: checkId,
        kind: /not declared|not declar/i.test(expl.reason) || /\bschema\b|\bheaders?\b/i.test(reason)
          ? "missing_declaration"
          : "other",
        severity: "info",
        category: categoryFor(checkId),
        reason: expl.reason,
        fix_hint: expl.fix,
        affected_operations: [],
        count,
        applicable: obs.applicable,
      });
    }
  }

  // --- 3. no_detector: applicable ≥5 but 0 cases. ----------------------
  for (const [checkId, obs] of perCheck) {
    if (obs.cases > 0) continue;
    if (obs.applicable < NO_DETECTOR_FLOOR) continue;
    const expl = explainNoDetector(checkId);
    out.push({
      check: checkId,
      kind: "no_detector",
      severity: "info",
      category: categoryFor(checkId),
      reason: expl.reason,
      fix_hint: expl.fix,
      affected_operations: [],
      count: 0,
      applicable: obs.applicable,
    });
  }

  return out;
}
