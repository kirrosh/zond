/**
 * `MassAssignmentProbe` — Probe-contract wrapper around the existing
 * `runMassAssignmentProbes` engine (m-17 / ARV-49).
 *
 * dryRun() lists POST/PATCH/PUT endpoints with the suspect fields the
 * probe would inject (suspectedExtras + serverAssignedExtras). Skip
 * reasons mirror the live runner (no-body, isolated-protected). This
 * fills the F2-15 gap (mass-assignment had no --dry-run); ARV-52 wires
 * the corresponding CLI flag.
 *
 * run() delegates to runMassAssignmentProbes; report() converts to
 * either the legacy markdown digest or the structured per-endpoint
 * shape (ARV-51).
 */
import type { OpenAPIV3 } from "openapi-types";
import type { Probe, ProbeContext, ProbeFlags, EndpointPlan, ProbeResult, ProbeReportFormat, ProbeEndpointResult, ProbeEndpointStatus } from "./types.ts";
import {
  runMassAssignmentProbes,
  formatDigestMarkdown,
  SUSPECTED_FIELDS,
  type MassAssignmentResult,
  type EndpointVerdict,
  type Severity,
} from "./mass-assignment-probe.ts";
import { pathTouchesSeededVar } from "./shared.ts";
import { hasProbeBody } from "./probe-harness.ts";

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

function requestPropertyNames(schema?: OpenAPIV3.SchemaObject): Set<string> {
  const out = new Set<string>();
  if (!schema) return out;
  if (schema.properties) for (const k of Object.keys(schema.properties)) out.add(k);
  for (const composite of [schema.allOf, schema.oneOf, schema.anyOf]) {
    if (Array.isArray(composite)) {
      for (const sub of composite) {
        const s = sub as OpenAPIV3.SchemaObject;
        if (s.properties) for (const k of Object.keys(s.properties)) out.add(k);
      }
    }
  }
  return out;
}

function suspectFieldsFor(ep: { requestBodySchema?: OpenAPIV3.SchemaObject }): string[] {
  const reqProps = requestPropertyNames(ep.requestBodySchema);
  const out: string[] = [];
  for (const name of Object.keys(SUSPECTED_FIELDS)) {
    if (!reqProps.has(name)) out.push(name);
  }
  return out;
}

function statusFromSeverity(s: Severity): ProbeEndpointStatus {
  switch (s) {
    case "high": return "high";
    case "low": return "low";
    case "medium": return "low";
    case "info": return "low";
    case "ok": return "ok";
    case "skipped": return "skipped";
    case "inconclusive-baseline":
    case "inconclusive-5xx":
      return "inconclusive";
  }
}

function evidenceFromVerdict(v: EndpointVerdict): Record<string, unknown> {
  return {
    summary: v.summary,
    request: { url: v.request.url, injectedFields: v.request.injectedFields },
    response: v.response ? { status: v.response.status } : undefined,
    fields: v.fields,
  };
}

function toProbeResult(ma: MassAssignmentResult): ProbeResult {
  const endpoints: ProbeEndpointResult[] = ma.verdicts.map((v) => ({
    path: v.path,
    method: v.method,
    classes_run: ["mass-assignment"],
    findings:
      v.severity === "skipped" || v.severity === "ok"
        ? []
        : [{
            class: "mass-assignment",
            severity:
              v.severity === "high" ? "high" :
              v.severity === "low" || v.severity === "medium" ? "low" :
              "inconclusive",
            evidence: evidenceFromVerdict(v),
          }],
    status: statusFromSeverity(v.severity),
    ...(v.severity === "skipped" ? { skip_reason: v.skipReason ?? v.summary } : {}),
  }));
  const by_status: Record<ProbeEndpointStatus, number> = {
    ok: 0, high: 0, low: 0, inconclusive: 0, skipped: 0,
  };
  for (const ep of endpoints) by_status[ep.status]++;
  return {
    endpoints,
    summary: {
      totalEndpoints: ma.totalEndpoints,
      probed: ma.specProbed,
      by_status,
    },
    warnings: ma.warnings,
  };
}

export class MassAssignmentProbe implements Probe {
  readonly name = "mass-assignment";
  readonly description =
    "Live probe for mass-assignment / privilege-escalation: classifies POST/PATCH/PUT against suspected extra fields (is_admin, role, account_id, …).";
  readonly commonFlags = FLAGS;

  async dryRun(ctx: ProbeContext): Promise<EndpointPlan[]> {
    const isolated = ctx.options["isolated"] === true;
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

      // ARV-150: parity with the live runner — form-urlencoded counts as a body.
      if (!hasProbeBody(ep)) {
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

      const fields = suspectFieldsFor(ep);
      out.push({
        path: ep.path,
        method: m,
        planned: true,
        classes_planned: ["mass-assignment"],
        fields_planned: fields,
        skip_reason: null,
      });
    }
    return out;
  }

  async run(ctx: ProbeContext): Promise<ProbeResult> {
    const ma = await runMassAssignmentProbes({
      endpoints: ctx.endpoints,
      securitySchemes: ctx.securitySchemes,
      vars: ctx.vars,
      noCleanup: ctx.options["noCleanup"] === true,
      timeoutMs: typeof ctx.options["timeoutMs"] === "number" ? (ctx.options["timeoutMs"] as number) : undefined,
      discover: ctx.options["noDiscover"] !== true,
    });
    const result = toProbeResult(ma);
    result.extras = { raw: ma };
    return result;
  }

  report(format: ProbeReportFormat, result: ProbeResult): string | object {
    if (format === "markdown") {
      const raw = result.extras?.["raw"] as MassAssignmentResult | undefined;
      if (raw) return formatDigestMarkdown(raw, "");
      return "(no markdown digest available)";
    }
    return {
      endpoints: result.endpoints,
      summary: result.summary,
    };
  }
}
