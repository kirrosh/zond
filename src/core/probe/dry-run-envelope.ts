/**
 * Dry-run envelope helpers (m-17 / ARV-50).
 *
 * `--dry-run` answers "what would I attack" — severity is undefined
 * because nothing was classified. Both probe-security and
 * probe-mass-assignment write this shape into `data` instead of the
 * legacy severity-bucket structure that conflated planned attacks
 * with skipped endpoints (F1-15).
 */
import type { EndpointPlan } from "./types.ts";

export interface DryRunSummary {
  totalEndpoints: number;
  planned: number;
  skipped: number;
}

export interface DryRunEnvelopeData {
  endpoints: EndpointPlan[];
  summary: DryRunSummary;
}

export function summarizeDryRun(plans: EndpointPlan[]): DryRunEnvelopeData {
  let planned = 0;
  let skipped = 0;
  for (const p of plans) {
    if (p.planned) planned++;
    else skipped++;
  }
  return {
    endpoints: plans,
    summary: {
      totalEndpoints: plans.length,
      planned,
      skipped,
    },
  };
}

/** Render a short human digest for the dry-run plan (used by non-json
 *  output). One line per endpoint, planned/skipped counts at the end. */
export function formatDryRunDigest(plans: EndpointPlan[]): string {
  const lines: string[] = [];
  for (const p of plans) {
    if (p.planned) {
      const fields = p.fields_planned.length > 0 ? ` fields=${p.fields_planned.join(",")}` : "";
      const cls = p.classes_planned.length > 0 ? ` classes=${p.classes_planned.join(",")}` : "";
      lines.push(`  + ${p.method} ${p.path}${cls}${fields}`);
    } else {
      lines.push(`  - ${p.method} ${p.path} (skipped: ${p.skip_reason ?? "unknown"})`);
    }
  }
  const summary = summarizeDryRun(plans).summary;
  lines.push("");
  lines.push(`Plan: ${summary.planned} planned · ${summary.skipped} skipped · ${summary.totalEndpoints} total`);
  return lines.join("\n");
}
