/**
 * `response_headers_conformance` — every response header declared in
 * the OpenAPI `responses[<status>].headers` map must be present, and
 * (when a schema is given) its value must validate. Schemathesis-style.
 *
 * For the check to mean anything, the spec has to declare some
 * headers; if it declares none, the check skips. Validation is shallow
 * here (string presence + simple type/format match) — full ajv
 * validation lands alongside ARV-5/ARV-6 once we cache validators per
 * (status, header) pair without paying compile cost per response.
 */
import type { OpenAPIV3 } from "openapi-types";
import type { Check } from "../types.ts";

function getDeclaredHeaders(
  doc: OpenAPIV3.Document,
  path: string,
  method: string,
  status: number,
): Record<string, OpenAPIV3.HeaderObject> {
  const op = (doc.paths?.[path] as OpenAPIV3.PathItemObject | undefined)
    ?.[method.toLowerCase() as OpenAPIV3.HttpMethods] as OpenAPIV3.OperationObject | undefined;
  if (!op?.responses) return {};
  const exact = op.responses[String(status)] as OpenAPIV3.ResponseObject | undefined;
  const wildcard = op.responses[`${Math.floor(status / 100)}XX`] as OpenAPIV3.ResponseObject | undefined;
  const fallback = op.responses.default as OpenAPIV3.ResponseObject | undefined;
  const branch = exact ?? wildcard ?? fallback;
  return (branch?.headers ?? {}) as Record<string, OpenAPIV3.HeaderObject>;
}

function valueOk(value: string | undefined, header: OpenAPIV3.HeaderObject): boolean {
  if (value === undefined) return false;
  const schema = header.schema as OpenAPIV3.SchemaObject | undefined;
  if (!schema) return true;
  if (schema.type === "integer") return /^-?\d+$/.test(value);
  if (schema.type === "number") return /^-?\d+(\.\d+)?$/.test(value);
  if (schema.type === "boolean") return value === "true" || value === "false";
  return true;
}

export const responseHeadersConformance: Check = {
  id: "response_headers_conformance",
  severity: "low",
  defaultExpected: "All headers declared on the response must be present and shape-valid",
  references: [{ id: "OAS3-headerObject" }],
  applies: () => true,
  run({ case: c, response, doc }) {
    if (!doc) return { kind: "skip", reason: "spec doc not available" };
    const declared = getDeclaredHeaders(doc, c.operation.path, c.operation.method, response.status);
    const names = Object.keys(declared);
    if (names.length === 0) return { kind: "skip", reason: "no declared response headers" };
    const issues: string[] = [];
    for (const name of names) {
      const header = declared[name]!;
      const required = header.required === true;
      const got = response.headers[name] ?? response.headers[name.toLowerCase()];
      if (got === undefined) {
        if (required) issues.push(`missing required "${name}"`);
        continue;
      }
      if (!valueOk(got, header)) {
        issues.push(`"${name}" value "${got}" doesn't match declared schema`);
      }
    }
    if (issues.length === 0) return { kind: "pass" };
    return {
      kind: "fail",
      message: `Response headers don't conform: ${issues.join("; ")}`,
      evidence: { issues, declared: names },
    };
  },
};
