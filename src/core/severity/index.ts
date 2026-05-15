/**
 * Unified severity matrix (ARV-250, m-21 pivot).
 *
 * Single source of truth for severity classification across all
 * finding-producing subsystems (lint, checks, probes). Replaces three
 * divergent ladders (lint 3-tier, checks 4-tier, probes 4-tier).
 *
 * Principle: **no evidence — no high severity**. Severity reflects
 * proven impact, not anomaly presence. CRITICAL exists in the type
 * but is reserved for end-to-end exploit chains; producers without
 * such chains must NOT emit it.
 */

export type Severity = "critical" | "high" | "medium" | "low" | "info";

export const SEVERITY_ORDER: readonly Severity[] = [
  "critical",
  "high",
  "medium",
  "low",
  "info",
] as const;

const SEVERITY_RANK: Record<Severity, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
  info: 4,
};

/**
 * Strength of evidence backing a finding. Drives the severity cap
 * applied at finding-emission time.
 *
 * - `end_to_end`: zond demonstrated the impact itself (read another
 *   user's data, executed action without auth, file read confirmed).
 *   Required for CRITICAL.
 * - `evidence_chain`: ≥2 requests prove the finding (storage +
 *   reflection found, follow-up GET shows persistence, OOB callback
 *   received). Required for HIGH.
 * - `single_signal`: one request/response indicates an anomaly but
 *   no follow-up confirms impact (server accepted CRLF / 169.254 /
 *   is_admin field — outcome unknown). Capped at LOW.
 * - `static`: spec-lint, style, naming, missing additionalProperties.
 *   No runtime evidence. Capped at INFO.
 */
export type ProofKind = "end_to_end" | "evidence_chain" | "single_signal" | "static";

const PROOF_CAP: Record<ProofKind, Severity> = {
  end_to_end: "critical",
  evidence_chain: "high",
  single_signal: "low",
  static: "info",
};

/**
 * Caps a claimed severity by the strength of evidence behind it.
 * Producers should pass their natural severity claim and the proof
 * kind; the cap function downgrades if claim exceeds what evidence
 * supports.
 *
 * Example: mass-assignment probe wants HIGH (dangerous field), but
 * only has single-signal proof (server returned 200, didn't verify
 * persistence). Cap returns LOW. To get HIGH, probe must escalate
 * proof to evidence_chain by doing follow-up GET.
 */
export function capSeverityByProof(claim: Severity, proof: ProofKind): Severity {
  const cap = PROOF_CAP[proof];
  return rankSeverity(claim) < rankSeverity(cap) ? cap : claim;
}

export function rankSeverity(s: Severity): number {
  return SEVERITY_RANK[s];
}

/** True iff `a` is at least as severe as `b`. */
export function isAtLeast(a: Severity, b: Severity): boolean {
  return rankSeverity(a) <= rankSeverity(b);
}

/** Highest severity among inputs; returns 'info' on empty list. */
export function maxSeverity(items: readonly Severity[]): Severity {
  let best: Severity = "info";
  for (const s of items) {
    if (rankSeverity(s) < rankSeverity(best)) best = s;
  }
  return best;
}

/**
 * Empty severity-bucket map. Use as starting tally; downstream code
 * increments per finding.
 */
export function emptySeverityBuckets(): Record<Severity, number> {
  return { critical: 0, high: 0, medium: 0, low: 0, info: 0 };
}

/**
 * SARIF level mapping (sarif.ts previously hardcoded 4-tier; this
 * keeps the same external semantics + adds 'info' → 'note').
 */
export function severityToSarifLevel(s: Severity): "error" | "warning" | "note" {
  if (s === "critical" || s === "high") return "error";
  if (s === "medium") return "warning";
  return "note"; // low + info
}

/**
 * Console glyph for severity. Stable per-glyph keeps fb-loop diff
 * compares clean.
 */
export function severityGlyph(s: Severity): string {
  switch (s) {
    case "critical": return "🚨";
    case "high":     return "🔴";
    case "medium":   return "⚠️";
    case "low":      return "ℹ️";
    case "info":     return "·";
  }
}
