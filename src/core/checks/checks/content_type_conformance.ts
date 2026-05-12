/**
 * `content_type_conformance` — Content-Type returned by the server
 * isn't among those declared in `op.responses[*].content`. Mirrors
 * schemathesis. We only fail when a body is present and Content-Type
 * is meaningful — empty 204 responses don't carry a type and pass.
 */
import type { Check } from "../types.ts";

function baseType(ct: string): string {
  return ct.split(";")[0]!.trim().toLowerCase();
}

export const contentTypeConformance: Check = {
  id: "content_type_conformance",
  severity: "medium",
  defaultExpected: "Response Content-Type must be one of those declared on the OpenAPI response",
  references: [{ id: "OAS3-mediaType", url: "https://spec.openapis.org/oas/v3.0.3#media-type-object" }],
  applies: (op) => op.responseContentTypes.length > 0,
  run({ case: c, response }) {
    // 204 / 304 by definition have no body — Content-Type irrelevant.
    if (response.status === 204 || response.status === 304) return { kind: "pass" };
    const got = response.headers["content-type"] ?? response.headers["Content-Type"];
    if (!got) {
      return {
        kind: "fail",
        message: `Missing Content-Type header on ${c.operation.method} ${c.operation.path}`,
        evidence: { declared: c.operation.responseContentTypes },
      };
    }
    const declared = c.operation.responseContentTypes.map(baseType);
    if (declared.length === 0) return { kind: "skip", reason: "no declared content types" };
    if (declared.includes(baseType(got))) return { kind: "pass" };
    return {
      kind: "fail",
      message: `Content-Type "${got}" not declared in OpenAPI for ${c.operation.method} ${c.operation.path}`,
      evidence: { actual: got, declared },
    };
  },
};
