import { applyAntiFp } from "../../anti-fp/index.ts";
import { matchesSubscriptionGated as matchesPaidPlan403 } from "../../anti-fp/rules/subscription-gated/paid-plan-403.ts";
import { classify as classifyRecommendedAction } from "../../classifier/recommended-action.ts";
import type { EndpointInfo } from "../../generator/types.ts";
import type { EndpointVerdict } from "./types.ts";

/** ARV-56: route through the single classifier instead of carrying the
 *  severity→action switch inline. */
export function stampRecommendedAction(verdict: EndpointVerdict): void {
  const action = classifyRecommendedAction({
    finding_class: "probe:mass_assignment",
    severity: verdict.severity as Parameters<typeof classifyRecommendedAction>[0]["severity"],
  });
  if (action) verdict.recommended_action = action;
}

/**
 * Build a one-line summary for INCONCLUSIVE-baseline verdicts. We surface
 * the server's error code/name when present so the user can immediately
 * see *which* FK / scope / fixture failed and fix it before re-probing.
 */
export function inconclusiveBaselineSummary(
  status: number,
  body: unknown,
  bodyFkMisses?: Array<{ field: string; reason: string }>,
): string {
  const hint = extractBaselineHint(body);
  const base = `baseline body invalid — server returned ${status}`;
  // ARV-104 (F9) → ARV-125: when status is 403 and the response body
  // names a subscription/scope gate (paid plan, feature flag, role/scope
  // insufficient), the right answer isn't "fix fixture" — there's
  // nothing to fix. The pattern set + suppression text now live in the
  // anti-FP registry as `subscription-gated/paid-plan-403`; we route through
  // `applyAntiFp` so the rule body, references, and identifier stay in
  // one place.
  const suppression = hint !== undefined
    ? applyAntiFp({ status, message: hint }, "probe:mass-assignment")
    : null;
  const tail = suppression
    ? ` — ${suppression.reason}`
    : " — fix fixture / FK value / path-params and re-probe";
  // TASK-137: if body-FK auto-discovery couldn't fill required FK fields, name
  // them in the summary so the user knows exactly what to add to env (or
  // why discover-fk missed — e.g. nested list endpoint, 403 from scope).
  let fkClause = "";
  if (bodyFkMisses && bodyFkMisses.length > 0) {
    const names = bodyFkMisses.map(m => m.field).join(", ");
    fkClause = ` — unresolved body FKs: ${names}`;
  }
  return hint
    ? `${base} (${hint})${fkClause}${tail}`
    : `${base}${fkClause}${tail}`;
}

/** ARV-104 (F9) → ARV-125: pattern set + suppression text moved to the
 *  anti-FP registry (`subscription-gated/paid-plan-403`). This re-export keeps
 *  pre-migration callers (existing unit test in
 *  mass-assignment-probe.test.ts) working through a thin shim. New
 *  callers should depend on the rule module directly or route
 *  through `applyAntiFp(ctx, "probe:mass-assignment")`. */
export const isSubscriptionGated = matchesPaidPlan403;

function extractBaselineHint(body: unknown): string | undefined {
  if (typeof body === "string") {
    const trimmed = body.trim();
    if (trimmed.length === 0) return undefined;
    return trimmed.length > 120 ? `${trimmed.slice(0, 120)}…` : trimmed;
  }
  if (typeof body !== "object" || body === null) return undefined;
  const obj = body as Record<string, unknown>;
  // Common error-envelope fields across SaaS APIs.
  const candidates = [
    obj.message,
    obj.error,
    (obj.error as Record<string, unknown> | undefined)?.message,
    obj.detail,
    obj.title,
    obj.name,
    obj.code,
  ];
  for (const c of candidates) {
    if (typeof c === "string" && c.length > 0) {
      return c.length > 120 ? `${c.slice(0, 120)}…` : c;
    }
  }
  return undefined;
}

export function needsFollowUp(verdict: EndpointVerdict): boolean {
  return verdict.fields.some(f => f.outcome === "absent" || f.outcome === "unknown");
}

export function classifyFromBody(
  verdict: EndpointVerdict,
  body: Record<string, unknown> | undefined,
  fromGet = false,
): void {
  if (!body) return;
  for (const field of verdict.fields) {
    // Once a field is decisively classified (applied/echoed-overwritten),
    // don't downgrade. But "absent" on POST may still flip to applied/ignored
    // after GET — so only re-check those.
    if (field.outcome === "applied" || field.outcome === "echoed-overwritten") continue;
    if (!(field.field in body)) {
      // GET also missing → ignored. POST missing → keep "absent" so we GET later.
      field.outcome = fromGet ? "ignored" : "absent";
      continue;
    }
    const observed = body[field.field];
    field.observed = observed;
    if (Bun.deepEquals(observed, field.injected)) {
      field.outcome = "applied";
    } else if (fromGet) {
      field.outcome = "ignored";
    } else {
      field.outcome = "echoed-overwritten";
    }
  }
}

export function findIdParam(ep: EndpointInfo): string {
  const m = ep.path.match(/\{([^}]+)\}/);
  return m ? m[1]! : "id";
}

export function finaliseSeverity(v: EndpointVerdict, strict: boolean): void {
  const applied = v.fields.filter(f => f.outcome === "applied");
  const absent = v.fields.filter(f => f.outcome === "absent");

  if (applied.length > 0) {
    v.severity = "high";
    v.summary = `accepted-and-applied: ${applied.map(f => f.field).join(", ")}`;
    return;
  }
  if (absent.length > 0) {
    // ARV-252: absent-but-unverifiable carries single_signal proof.
    // Surfaced as INFO and only shown under --verbose so the report
    // stays clean; the verdict still travels through the JSON envelope
    // for agents that want to triage it explicitly.
    v.severity = "info";
    v.summary = `inconclusive — could not verify via follow-up GET (${absent.map(f => f.field).join(", ")})`;
    return;
  }
  // ARV-252: silently-ignored = correct framework behaviour (Rails
  // strong params / FastAPI extra=ignore). Severity stays INFO so it
  // never gates CI, AND the CLI display layer suppresses it entirely
  // (even under --verbose). Reports must not be noise-floored by
  // correct behaviour. Verdicts still travel through the JSON envelope
  // for agents that explicitly want to inspect them.
  v.severity = "info";
  const status = v.response?.status ?? 0;
  v.summary = `accepted ${status} but extras silently ignored${strict ? " (despite additionalProperties:false — server should reject)" : ""}`;
}
