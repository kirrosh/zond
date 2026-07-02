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

const SEVERITY_RANK: Record<Severity, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
  info: 4,
};

export function rankSeverity(s: Severity): number {
  return SEVERITY_RANK[s];
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
