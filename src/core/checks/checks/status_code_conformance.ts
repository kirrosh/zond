/**
 * `status_code_conformance` — schemathesis-equivalent. Fails when the
 * server returns a status code that's not declared in the OpenAPI
 * `responses` for this operation (and no `default` is declared either).
 *
 * Edge: `default` in OpenAPI means "any status not enumerated above" —
 * the presence of `default` makes every status code conforming. ARV-2
 * AC #6 explicitly tests this case.
 *
 * Severity matrix (ARV-285, dispatched per finding via outcome.severity
 * — see `severityFor` below):
 *
 *   - HIGH:   5xx undeclared (no 5XX wildcard, no default). A server-error
 *             on an undocumented branch is concrete evidence of an unhandled
 *             code path — likely a real bug.
 *   - MEDIUM: 4xx undeclared but at least one other 4xx is declared.
 *             Partial contract — the API documents *some* client errors but
 *             missed this one. Concrete gap, actionable for the team.
 *   - LOW:    4xx undeclared + no declared 4xx at all (minimal spec). The
 *             spec only lists 2xx; the 4xx is a real response but the spec
 *             gap could simply be spec-under-documentation, not a real bug.
 *   - LOW:    2xx/3xx undeclared on negative_data / missing_required_header
 *             / unsupported_method probes. The negative probe already surfaces
 *             the acceptance as a finding in its own check — the status gap
 *             is a secondary signal here (spec hygiene, not a fresh breach).
 *   - MEDIUM: 2xx/3xx undeclared on positive probes. A conforming happy-path
 *             response with an undocumented status is a concrete spec gap.
 *
 * Note: `wildcard.get(5)` / `wildcard.get(4)` already gate at the top —
 * those return pass before we reach this dispatch. The 5xx-undeclared case
 * only fires when there is no 5XX wildcard and no default.
 *
 * Per ARV-250's proof-cap principle (no evidence → no high severity):
 * the declared `severity: "low"` is the natural fallback / proof-cap
 * baseline; evidence strength escalates individual findings via
 * `outcome.severity` to override it.
 *
 * Users can re-calibrate per-API via `.zond/severity.yaml` (ARV-283).
 */
import type { OpenAPIV3 } from "openapi-types";

import type { Check, CheckOutcome, CaseKind } from "../types.ts";
import type { Severity } from "../../severity/index.ts";

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
    // 2XX / 3XX / 4XX / 5XX wildcard keys are valid OpenAPI 3.0 forms.
    // Must check before parseInt — parseInt("4XX") === 4 which is finite
    // and would otherwise be treated as a literal status code 4.
    const m = /^([1-5])XX$/i.exec(key);
    if (m) { hasWildcard.set(Number.parseInt(m[1]!, 10), true); continue; }
    const n = Number.parseInt(key, 10);
    if (Number.isFinite(n)) codes.add(n);
  }
  return { codes, hasDefault, hasWildcard };
}

/** Negative case kinds — the probe itself already surfaces acceptance; the
 *  status-code gap here is a secondary spec-hygiene signal (LOW). */
const NEGATIVE_KINDS: ReadonlySet<CaseKind> = new Set([
  "negative_data",
  "missing_required_header",
  "unsupported_method",
]);

/**
 * Per-finding severity dispatch (ARV-285).
 *
 * @param status   - actual response status
 * @param codes    - set of explicitly declared numeric status codes in spec
 * @param kind     - CheckCase.kind for the current probe
 */
function severityFor(status: number, codes: Set<number>, kind: CaseKind): Severity {
  if (status >= 500 && status < 600) return "high";
  if (status >= 400 && status < 500) {
    const hasDeclared4xx = [...codes].some((c) => c >= 400 && c < 500);
    return hasDeclared4xx ? "medium" : "low";
  }
  // 2xx / 3xx
  if (NEGATIVE_KINDS.has(kind)) return "low";
  return "medium"; // positive case: undocumented success status is a real spec gap
}

export const statusCodeConformance: Check = {
  id: "status_code_conformance",
  // ARV-285: declared severity is the *natural* tier (proof-cap baseline
  // per ARV-250 — single-signal caps at LOW). Per-finding severity is
  // dispatched via `outcome.severity` in `run()` below, so summary
  // tables can show HIGH for 5xx and MEDIUM for partial-4xx-contract
  // without globally setting the check to HIGH (which masks calibration).
  severity: "low",
  defaultExpected: "Response status must be declared in the OpenAPI `responses` (or `default`)",
  references: [{ id: "OAS3-responsesObject", url: "https://spec.openapis.org/oas/v3.0.3#responses-object" }],
  // ARV-180: status-code conformance is a property of the response, not
  // of the input. The check must fire on every case kind — including
  // negative-data, dropped-header, and unsupported-method probes — so
  // an undocumented 5xx/404/422 on bad input surfaces as a finding
  // (matches schemathesis V4 default: the check has no input-kind filter).
  caseKinds: ["positive", "negative_data", "missing_required_header", "unsupported_method"],
  applies: () => true,
  run({ case: c, response, doc }): CheckOutcome {
    if (!doc) return { kind: "skip", reason: "spec doc not available" };
    // ARV-183: ARV-40 path-disambiguation renames {id} → {<resource>_id}
    // in EndpointInfo.path. doc.paths keeps the original — use
    // originalPath for spec lookup when present.
    const specPath = c.operation.originalPath ?? c.operation.path;
    const { codes, hasDefault, hasWildcard } = declaredStatuses(doc, specPath, c.operation.method);
    if (hasDefault) return { kind: "pass" };
    if (codes.has(response.status)) return { kind: "pass" };
    if (hasWildcard.get(Math.floor(response.status / 100))) return { kind: "pass" };
    // ARV-224: use the actual request method (c.request.method) instead
    // of the operation's declared method. For unsupported_method probes
    // the request fires POST/PUT/PATCH against a GET-only endpoint and the
    // legacy `c.operation.method` would print "for GET" while the
    // request_signature (downstream SARIF / triage) shows POST — sending
    // operators in the wrong direction.
    const reqMethod = c.request.method.toUpperCase();
    return {
      kind: "fail",
      message: `Status ${response.status} not declared in OpenAPI responses for ${reqMethod} ${c.operation.path}`,
      evidence: { actual: response.status, declared: [...codes].sort((a, b) => a - b) },
      severity: severityFor(response.status, codes, c.kind),
    };
  },
};
