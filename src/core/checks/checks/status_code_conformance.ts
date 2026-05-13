/**
 * `status_code_conformance` — schemathesis-equivalent. Fails when the
 * server returns a status code that's not declared in the OpenAPI
 * `responses` for this operation (and no `default` is declared either).
 *
 * Edge: `default` in OpenAPI means "any status not enumerated above" —
 * the presence of `default` makes every status code conforming. ARV-2
 * AC #6 explicitly tests this case.
 */
import type { OpenAPIV3 } from "openapi-types";

import type { Check } from "../types.ts";

function declaredStatuses(doc: OpenAPIV3.Document, path: string, method: string):
  { codes: Set<number>; hasDefault: boolean; hasWildcard: Map<number, boolean> } {
  const codes = new Set<number>();
  const hasWildcard = new Map<number, boolean>(); // 2,3,4,5 -> declared as 2XX etc.
  let hasDefault = false;
  const op = (doc.paths?.[path] as OpenAPIV3.PathItemObject | undefined)
    ?.[method.toLowerCase() as OpenAPIV3.HttpMethods] as OpenAPIV3.OperationObject | undefined;
  if (!op?.responses) return { codes, hasDefault, hasWildcard };
  for (const key of Object.keys(op.responses)) {
    if (key === "default") { hasDefault = true; continue; }
    const n = Number.parseInt(key, 10);
    if (Number.isFinite(n)) { codes.add(n); continue; }
    // 2XX / 3XX / 4XX / 5XX wildcard keys are valid OpenAPI 3.0 forms.
    const m = /^([1-5])XX$/i.exec(key);
    if (m) hasWildcard.set(Number.parseInt(m[1]!, 10), true);
  }
  return { codes, hasDefault, hasWildcard };
}

export const statusCodeConformance: Check = {
  id: "status_code_conformance",
  severity: "medium",
  defaultExpected: "Response status must be declared in the OpenAPI `responses` (or `default`)",
  references: [{ id: "OAS3-responsesObject", url: "https://spec.openapis.org/oas/v3.0.3#responses-object" }],
  // ARV-180: status-code conformance is a property of the response, not
  // of the input. The check must fire on every case kind — including
  // negative-data, dropped-header, and unsupported-method probes — so
  // an undocumented 5xx/404/422 on bad input surfaces as a finding
  // (matches schemathesis V4 default: the check has no input-kind filter).
  caseKinds: ["positive", "negative_data", "missing_required_header", "unsupported_method"],
  applies: () => true,
  run({ case: c, response, doc }) {
    if (!doc) return { kind: "skip", reason: "spec doc not available" };
    // ARV-183: ARV-40 path-disambiguation renames {id} → {<resource>_id}
    // in EndpointInfo.path. doc.paths keeps the original — use
    // originalPath for spec lookup when present.
    const specPath = c.operation.originalPath ?? c.operation.path;
    const { codes, hasDefault, hasWildcard } = declaredStatuses(doc, specPath, c.operation.method);
    if (hasDefault) return { kind: "pass" };
    if (codes.has(response.status)) return { kind: "pass" };
    if (hasWildcard.get(Math.floor(response.status / 100))) return { kind: "pass" };
    return {
      kind: "fail",
      message: `Status ${response.status} not declared in OpenAPI responses for ${c.operation.method} ${c.operation.path}`,
      evidence: { actual: response.status, declared: [...codes].sort((a, b) => a - b) },
    };
  },
};
