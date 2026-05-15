/**
 * `SecurityProbe` — Probe-contract wrapper around the existing
 * `runSecurityProbes` engine in `security-probe.ts` (m-17 / ARV-49).
 *
 * Behavior is unchanged on this step. dryRun() returns the structured
 * EndpointPlan[] shape (used by the new dry-run envelope in ARV-50);
 * run() delegates to runSecurityProbes(); report() is a thin renderer
 * that converts the SecurityProbeResult to either a markdown digest
 * (existing formatter) or the structured per-endpoint shape (ARV-51).
 */
import type { Probe, ProbeContext, ProbeFlags, EndpointPlan, ProbeResult, ProbeReportFormat, ProbeEndpointResult, ProbeEndpointStatus } from "./types.ts";
import {
  runSecurityProbes,
  formatSecurityDigest,
  detectFields,
  SECURITY_CLASSES,
  type SecurityClass,
  type SecurityProbeResult,
  type SecurityVerdict,
} from "./security-probe.ts";
import { hasJsonBody, pathTouchesSeededVar } from "./shared.ts";

const FLAGS: ProbeFlags = {
  api: true,
  tag: true,
  include: true,
  exclude: true,
  dryRun: true,
  listTags: true,
  json: true,
  output: true,
  report: true,
};

function planForSecurity(
  ctx: ProbeContext,
  classes: SecurityClass[],
  isolated: boolean,
): EndpointPlan[] {
  const out: EndpointPlan[] = [];
  for (const ep of ctx.endpoints) {
    if (ep.deprecated) continue;
    const m = ep.method.toUpperCase();
    if (m !== "POST" && m !== "PUT" && m !== "PATCH") continue;

    if (isolated && (m === "PUT" || m === "PATCH") && pathTouchesSeededVar(ep.path, ctx.vars)) {
      out.push({
        path: ep.path,
        method: m,
        planned: false,
        classes_planned: [],
        fields_planned: [],
        skip_reason: "isolated-protected",
      });
      continue;
    }

    if (!hasJsonBody(ep)) {
      out.push({
        path: ep.path,
        method: m,
        planned: false,
        classes_planned: [],
        fields_planned: [],
        skip_reason: "no-body",
      });
      continue;
    }

    const detected = detectFields(ep, classes);
    if (detected.length === 0) {
      out.push({
        path: ep.path,
        method: m,
        planned: false,
        classes_planned: [],
        fields_planned: [],
        skip_reason: "no-matched-field",
      });
      continue;
    }

    const classesPlanned = Array.from(new Set(detected.map((d) => d.class)));
    const fieldsPlanned = Array.from(new Set(detected.map((d) => d.field)));
    out.push({
      path: ep.path,
      method: m,
      planned: true,
      classes_planned: classesPlanned,
      fields_planned: fieldsPlanned,
      skip_reason: null,
    });
  }
  return out;
}

function statusFromSeverity(s: SecurityVerdict["severity"]): ProbeEndpointStatus {
  if (s === "high") return "high";
  if (s === "low") return "low";
  if (s === "ok") return "ok";
  if (s === "skipped") return "skipped";
  return "inconclusive";
}

function evidenceFromFinding(f: SecurityVerdict["findings"][number]): Record<string, unknown> {
  return {
    field: f.field,
    payload: f.payload,
    status: f.status,
    echoed: f.echoed,
    reason: f.reason,
    ...(f.recommended_action ? { recommended_action: f.recommended_action } : {}),
  };
}

function toProbeResult(sec: SecurityProbeResult): ProbeResult {
  const endpoints: ProbeEndpointResult[] = sec.verdicts.map((v) => ({
    path: v.path,
    method: v.method,
    classes_run: Array.from(new Set(v.detectedFields.map((d) => d.class))),
    findings: v.findings.map((f) => ({
      class: f.class,
      severity:
        f.severity === "inconclusive" || f.severity === "inconclusive-baseline"
          ? "inconclusive"
          : f.severity === "skipped"
          ? "ok"
          : f.severity === "info"
          // ARV-253: ProbeFindingSeverity has no "info" tier. Collapse
          // info → low for the public probe-result envelope; the digest
          // / structured per-endpoint shape preserves the distinction.
          ? "low"
          : f.severity === "medium"
          // ARV-254: ProbeFindingSeverity has no "medium" tier — collapse
          // to "low" for the wire shape. MEDIUM is a digest-only severity
          // marker (SSRF accept on endpoint declaring delivery, no OOB);
          // by design it must NOT gate CI as a HIGH would.
          ? "low"
          : f.severity,
      evidence: evidenceFromFinding(f),
    })),
    status: statusFromSeverity(v.severity),
    ...(v.skipReason ? { skip_reason: v.skipReason } : {}),
  }));
  const by_status: Record<ProbeEndpointStatus, number> = {
    ok: 0, high: 0, low: 0, inconclusive: 0, skipped: 0,
  };
  for (const ep of endpoints) by_status[ep.status]++;
  return {
    endpoints,
    summary: {
      totalEndpoints: sec.totalEndpoints,
      probed: sec.specProbed,
      by_status,
    },
    warnings: sec.warnings,
  };
}

export class SecurityProbe implements Probe {
  readonly name = "security";
  readonly description =
    "Live security probes: SSRF / CRLF / open-redirect. Spec-driven field detection + baseline-OK gate.";
  readonly commonFlags = FLAGS;

  async dryRun(ctx: ProbeContext): Promise<EndpointPlan[]> {
    const classes = (ctx.classes ?? SECURITY_CLASSES) as SecurityClass[];
    const isolated = ctx.options["isolated"] === true;
    return planForSecurity(ctx, classes, isolated);
  }

  async run(ctx: ProbeContext): Promise<ProbeResult> {
    const classes = (ctx.classes ?? SECURITY_CLASSES) as SecurityClass[];
    const sec = await runSecurityProbes({
      endpoints: ctx.endpoints,
      securitySchemes: ctx.securitySchemes,
      vars: ctx.vars,
      classes,
      noCleanup: ctx.options["noCleanup"] === true,
      timeoutMs: typeof ctx.options["timeoutMs"] === "number" ? (ctx.options["timeoutMs"] as number) : undefined,
      isolated: ctx.options["isolated"] === true,
    });
    const result = toProbeResult(sec);
    // Pass through the raw sec result for legacy markdown rendering and
    // for orphan-tracker consumers that need the full SecurityVerdict[].
    result.extras = { raw: sec };
    return result;
  }

  report(format: ProbeReportFormat, result: ProbeResult): string | object {
    if (format === "markdown") {
      const raw = (result.extras?.["raw"] as SecurityProbeResult | undefined);
      if (raw) return formatSecurityDigest(raw, "");
      return "(no markdown digest available)";
    }
    return {
      endpoints: result.endpoints,
      summary: result.summary,
    };
  }
}
