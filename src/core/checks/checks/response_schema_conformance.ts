/**
 * `response_schema_conformance` — body must validate against the JSON
 * Schema declared on the matched response branch. Reuses the existing
 * `runner/schema-validator.ts` so we don't rebuild AJV plumbing
 * (ARV-2 AC #3).
 */
import type { Check } from "../types.ts";

export const responseSchemaConformance: Check = {
  id: "response_schema_conformance",
  severity: "high",
  defaultExpected: "Response body must validate against the OpenAPI response schema",
  references: [{ id: "OAS3-schemaObject" }],
  applies: () => true,
  run({ case: c, response, schemaValidator }) {
    if (!schemaValidator) return { kind: "skip", reason: "validator unavailable" };
    const inspect = schemaValidator.inspect(c.operation.method, c.operation.path, response.status);
    if (!inspect.matchedEndpoint) return { kind: "skip", reason: "no spec endpoint matched" };
    if (!inspect.hasJsonSchema) return { kind: "skip", reason: "no JSON Schema on this response branch" };
    const results = schemaValidator.validate(c.operation.method, c.operation.path, response.status, response.body);
    const failed = results.filter((r) => !r.passed);
    if (failed.length === 0) return { kind: "pass" };
    const messages = failed.slice(0, 5).map((r) => `${r.field}: expected ${JSON.stringify(r.expected)}`);
    return {
      kind: "fail",
      message: `Response body fails schema validation (${failed.length} issue${failed.length === 1 ? "" : "s"})`,
      evidence: { issues: messages },
    };
  },
};
