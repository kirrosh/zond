/**
 * Live probe-runtime primitives shared by mass-assignment and security
 * probes. TASK-185 (m-11) extracted the static spec/scaffold half into
 * `runner.ts`; this module covers the per-endpoint primitives that
 * were still duplicated between the two probe entry points.
 *
 * Scope: small, pure helpers — URL building, baseline body generation,
 * JSON+auth header construction. Cleanup logic is intentionally NOT
 * unified: mass-assignment uses fire-and-forget DELETE before attacks,
 * security-probe uses snapshot/restore + retry-aware DELETE after
 * attacks. Different invariants, different shapes — see TASK-189 notes.
 */

import type { EndpointInfo, SecuritySchemeInfo } from "../generator/types.ts";
import { generateFromSchema } from "../generator/data-factory.ts";
import { substituteDeep, substituteString } from "../parser/variables.ts";
import { convertPath, liveAuthHeaders } from "./shared.ts";
import { joinBaseAndPath } from "../util/url.ts";
import { encodeFormBody } from "../runner/form-encode.ts";
import type { SeedBodyConfig } from "../generator/resources-builder.ts";

/** ARV-150: form-encoded mutating endpoint (Stripe v1 pattern).
 *  Stripe and other Rails/PHP APIs declare requestBody.content with ONLY
 *  application/x-www-form-urlencoded — the probes previously skipped
 *  every such endpoint, masking real mass-assignment vectors. */
export function isFormBody(ep: EndpointInfo): boolean {
  return (
    ep.requestBodyContentType === "application/x-www-form-urlencoded"
    && ep.requestBodySchema !== undefined
  );
}

/** Probes can drive either application/json or application/x-www-form-urlencoded
 *  endpoints. Anything else (multipart, octet-stream, …) still gets skipped —
 *  no general way to construct attack payloads without a body schema. */
export function hasProbeBody(ep: EndpointInfo): boolean {
  if (ep.method === "GET" || ep.method === "DELETE") return false;
  if (!ep.requestBodySchema) return false;
  return (
    ep.requestBodyContentType === "application/json"
    || ep.requestBodyContentType === "application/x-www-form-urlencoded"
  );
}

/** Serialise an attack body using whichever content type the endpoint
 *  declares. Returns the wire-format string + the Content-Type to set. */
export function serializeProbeBody(
  ep: EndpointInfo,
  body: Record<string, unknown>,
): { content: string; contentType: string } {
  if (isFormBody(ep)) {
    return { content: encodeFormBody(body), contentType: "application/x-www-form-urlencoded" };
  }
  return { content: JSON.stringify(body), contentType: "application/json" };
}

/**
 * Resolve an endpoint's URL against the live `base_url` + path-param
 * substitutions. Returns the resolved URL and any leftover `{{var}}`
 * markers the caller couldn't fill — use those to skip the endpoint
 * with a meaningful reason.
 */
export function buildProbeUrl(
  ep: EndpointInfo,
  vars: Record<string, string>,
): { url: string; unresolved: string[] } {
  const templated = joinBaseAndPath(vars["base_url"], convertPath(ep.path));
  const url = String(substituteString(templated, vars));
  const unresolved = Array.from(url.matchAll(/\{\{([^}]+)\}\}/g)).map(m => m[1]!);
  return { url, unresolved };
}

/**
 * Standard probe headers: JSON content-type/accept plus the resolved
 * auth header for the endpoint. Empty `liveAuthHeaders` is fine — the
 * spread is a no-op for unauthenticated endpoints.
 */
export function buildJsonAuthHeaders(
  ep: EndpointInfo,
  schemes: SecuritySchemeInfo[],
  vars: Record<string, string>,
): Record<string, string> {
  return {
    "content-type": "application/json",
    accept: "application/json",
    ...liveAuthHeaders(ep, schemes, vars),
  };
}

/** ARV-150: like buildJsonAuthHeaders but picks the Content-Type from the
 *  endpoint's spec (form-urlencoded for Stripe v1, JSON otherwise). Accept
 *  stays JSON — the server still answers in JSON even when the body is
 *  form-encoded. */
export function buildBodyAuthHeaders(
  ep: EndpointInfo,
  schemes: SecuritySchemeInfo[],
  vars: Record<string, string>,
): Record<string, string> {
  const ct = isFormBody(ep) ? "application/x-www-form-urlencoded" : "application/json";
  return {
    "content-type": ct,
    accept: "application/json",
    ...liveAuthHeaders(ep, schemes, vars),
  };
}

/**
 * Synthesize a baseline body from the endpoint's request schema and
 * substitute live vars. Returns null when the result isn't a JSON
 * object (array / scalar / null) — both probes treat that as a skip
 * reason ("request body not a JSON object").
 *
 * ARV-269: when `seedBody` is provided (agent-authored overlay from
 * `.api-resources.local.yaml`), it wins over `generateFromSchema`.
 * Strict-validating APIs (Stripe required-field XORs, `expand[]` arrays)
 * reject random scalars from the generator and the whole verdict becomes
 * INCONCLUSIVE-baseline; the overlay carries a payload the API actually
 * accepts. Mirrors the path stateful checks took via `resolveCreateBody`
 * (`core/checks/checks/_crud-helpers.ts`).
 */
export function buildBaselineFromSpec(
  ep: EndpointInfo,
  vars: Record<string, string>,
  seedBody?: SeedBodyConfig,
): Record<string, unknown> | null {
  const raw = seedBody && seedBody.body && typeof seedBody.body === "object"
    ? seedBody.body
    : (ep.requestBodySchema ? generateFromSchema(ep.requestBodySchema) : {});
  const sub = substituteDeep(raw, vars);
  if (typeof sub !== "object" || sub === null || Array.isArray(sub)) return null;
  return sub as Record<string, unknown>;
}
