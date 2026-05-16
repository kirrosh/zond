import { describe, test, expect } from "bun:test";
import { validateSuite } from "../../src/core/parser/schema.ts";

describe("source metadata (TASK-100)", () => {
  test("accepts suite-level source block", () => {
    const suite = validateSuite({
      name: "Test",
      source: {
        type: "openapi-generated",
        spec: "openapi.yaml",
        generator: "zond-generate",
        generated_at: "2026-04-30T12:00:00Z",
      },
      tests: [{ GET: "/health", name: "Health", expect: { status: 200 } }],
    });
    expect(suite.source).toEqual({
      type: "openapi-generated",
      spec: "openapi.yaml",
      generator: "zond-generate",
      generated_at: "2026-04-30T12:00:00Z",
    });
  });

  test("accepts step-level source block", () => {
    const suite = validateSuite({
      name: "Test",
      tests: [{
        GET: "/webhooks",
        name: "Probe 422",
        source: {
          generator: "negative-probe",
          endpoint: "POST /webhooks",
          response_branch: "422",
          schema_pointer: "#/paths/~1webhooks/post/responses/422",
        },
        expect: { status: 422 },
      }],
    });
    expect(suite.tests[0]!.source).toMatchObject({
      generator: "negative-probe",
      endpoint: "POST /webhooks",
      response_branch: "422",
    });
  });

  test("manual YAML без source валиден без warning", () => {
    const suite = validateSuite({
      name: "Manual",
      tests: [{ GET: "/foo", name: "foo", expect: { status: 200 } }],
    });
    expect(suite.source).toBeUndefined();
    expect(suite.tests[0]!.source).toBeUndefined();
  });

  test("source passthrough пропускает unknown поля", () => {
    const suite = validateSuite({
      name: "Test",
      source: {
        generator: "custom",
        custom_extra: "value42",
      },
      tests: [{ GET: "/x", name: "x", expect: {} }],
    });
    expect(suite.source).toMatchObject({ generator: "custom", custom_extra: "value42" });
  });
});
