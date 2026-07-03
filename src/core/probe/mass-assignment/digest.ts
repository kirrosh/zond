import { SUSPECTED_FIELDS } from "./suspects.ts";
import type {
  EndpointVerdict,
  MassAssignmentResult,
  Severity,
} from "./types.ts";

const SEVERITY_ORDER: Severity[] = [
  "high",
  "inconclusive-baseline",
  "inconclusive-5xx",
  "medium",
  "low",
  "info",
  "ok",
  "skipped",
];

const SEVERITY_HEADER: Record<Severity, string> = {
  high: "🚨 HIGH — privilege escalation candidates",
  "inconclusive-baseline": "⚠️  INCONCLUSIVE — baseline body invalid (fix fixture / FK / scope and re-probe)",
  "inconclusive-5xx": "⚠️  INCONCLUSIVE — baseline 5xx (endpoint crashes — likely duplicate of validation-probe)",
  medium: "⚠️  MEDIUM — inconclusive (no follow-up GET available)",
  low: "ℹ️  LOW — inconclusive (single-signal, follow-up GET unavailable)",
  info: "·  INFO — accepted-and-ignored (correct framework behaviour, often ineligible to report)",
  ok: "✅ OK — rejected 4xx (best behaviour)",
  skipped: "⏭️  SKIPPED",
};

export function formatDigestMarkdown(
  result: MassAssignmentResult,
  specPath: string,
): string {
  const lines: string[] = [];
  lines.push(`# Mass-assignment probe digest`);
  lines.push("");
  lines.push(`**Spec:** \`${specPath}\``);
  lines.push(`**Endpoints probed:** ${result.specProbed} of ${result.totalEndpoints} mutating endpoints`);
  lines.push("");
  lines.push(`**Suspected fields tested:** ${Object.keys(SUSPECTED_FIELDS).join(", ")}`);
  lines.push("");

  const buckets = groupBySeverity(result.verdicts);
  for (const sev of SEVERITY_ORDER) {
    const items = buckets[sev];
    if (!items || items.length === 0) continue;
    lines.push(`## ${SEVERITY_HEADER[sev]} (${items.length})`);
    lines.push("");
    for (const v of items) {
      lines.push(`### ${v.method} ${v.path}`);
      lines.push("");
      if (v.severity === "skipped") {
        lines.push(`- Skipped: ${v.skipReason ?? v.summary}`);
        lines.push("");
        continue;
      }
      lines.push(`- ${v.summary}`);
      lines.push(`- Injected: ${v.request.injectedFields.map(n => `\`${n}\``).join(", ")}`);
      if (v.baseline) {
        lines.push(`- Baseline (no extras): ${v.baseline.status}`);
      }
      if (v.response) {
        lines.push(`- With extras: ${v.response.status}`);
      }
      if (v.followUpGet) {
        lines.push(`- Follow-up GET → ${v.followUpGet.status}`);
      }
      const interesting = v.fields.filter(f => f.outcome !== "ignored" && f.outcome !== "absent");
      if (interesting.length > 0) {
        lines.push(`- Per-field outcomes:`);
        for (const f of interesting) {
          const obs = f.observed === undefined ? "n/a" : JSON.stringify(f.observed);
          lines.push(`  - \`${f.field}\` → **${f.outcome}** (injected ${JSON.stringify(f.injected)}, observed ${obs})`);
        }
      }
      if (v.cleanup) {
        if (v.cleanup.attempted) {
          lines.push(`- Cleanup DELETE: ${v.cleanup.status ?? "errored"}${v.cleanup.error ? ` — ${v.cleanup.error}` : ""}`);
        } else {
          lines.push(`- Cleanup skipped: ${v.cleanup.error ?? "unknown"}`);
        }
      }
      if (v.notes && v.notes.length > 0) {
        for (const n of v.notes) lines.push(`- Note: ${n}`);
      }
      if (v.severity === "high") {
        lines.push(`- **Action:** treat as P0 — server should reject or strip these fields.`);
      }
      if (v.severity === "inconclusive-baseline") {
        lines.push(
          `- **Action:** the baseline POST itself failed — set the right fixture / FK / path-params in your env (e.g. \`domain_id\`, \`account_id\`) and re-run.`,
        );
      }
      if (v.severity === "inconclusive-5xx") {
        lines.push(
          `- **Action:** baseline crashed with 5xx — fix the underlying server bug (validation-probe likely reported it for the same endpoint) before mass-assignment can be observed here.`,
        );
      }
      lines.push("");
    }
  }

  if (result.warnings.length > 0) {
    lines.push(`## Warnings`);
    lines.push("");
    for (const w of result.warnings) lines.push(`- ${w}`);
    lines.push("");
  }
  return lines.join("\n");
}

function groupBySeverity(verdicts: EndpointVerdict[]): Partial<Record<Severity, EndpointVerdict[]>> {
  return Object.groupBy(verdicts, (v) => v.severity);
}
