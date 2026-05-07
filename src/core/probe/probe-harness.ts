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
  const baseUrl = (vars["base_url"] ?? "").replace(/\/+$/, "");
  const templated = `${baseUrl}${convertPath(ep.path)}`;
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

/**
 * Synthesize a baseline body from the endpoint's request schema and
 * substitute live vars. Returns null when the result isn't a JSON
 * object (array / scalar / null) — both probes treat that as a skip
 * reason ("request body not a JSON object").
 */
export function buildBaselineFromSpec(
  ep: EndpointInfo,
  vars: Record<string, string>,
): Record<string, unknown> | null {
  const raw = ep.requestBodySchema ? generateFromSchema(ep.requestBodySchema) : {};
  const sub = substituteDeep(raw, vars);
  if (typeof sub !== "object" || sub === null || Array.isArray(sub)) return null;
  return sub as Record<string, unknown>;
}
