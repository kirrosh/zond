import { describe, test, expect } from "bun:test";
import type { OpenAPIV3 } from "openapi-types";
import { lintSpec, defaultConfig, loadConfig, type Issue } from "../../src/core/lint/index.ts";

function makeDoc(paths: OpenAPIV3.PathsObject, components?: OpenAPIV3.ComponentsObject): OpenAPIV3.Document {
  return {
    openapi: "3.0.0",
    info: { title: "test", version: "1" },
    paths,
    ...(components ? { components } : {}),
  };
}

function lint(doc: OpenAPIV3.Document): Issue[] {
  return lintSpec(doc, defaultConfig()).issues;
}

function ofRule(issues: Issue[], rule: string): Issue[] {
  return issues.filter(i => i.rule === rule);
}

describe("lint-spec — Group A (consistency)", () => {
  test("A1: example violates format: date-time (Postgres-style)", () => {
    const doc = makeDoc({
      "/widgets": {
        get: {
          responses: {
            "200": {
              description: "ok",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      created_at: { type: "string", format: "date-time", example: "2023-10-06:23:47:56.678Z" },
                    },
                  },
                },
              },
            },
          },
        },
      },
    });
    const a1 = ofRule(lint(doc), "A1");
    expect(a1).toHaveLength(1);
    expect(a1[0]!.severity).toBe("high");
    expect(a1[0]!.jsonpointer).toContain("/properties/created_at");
    expect(a1[0]!.affects).toContain("run:--validate-schema");
  });

  test("A1: strict RFC3339 — proper T-separator passes", () => {
    const doc = makeDoc({
      "/widgets": {
        get: {
          responses: {
            "200": {
              description: "ok",
              content: {
                "application/json": {
                  schema: { type: "string", format: "date-time", example: "2023-10-06T23:47:56.678Z" },
                },
              },
            },
          },
        },
      },
    });
    expect(ofRule(lint(doc), "A1")).toHaveLength(0);
  });

  test("A2: example not in enum", () => {
    const doc = makeDoc({
      "/x": {
        get: {
          responses: {
            "200": {
              description: "ok",
              content: { "application/json": { schema: { type: "string", enum: ["a", "b"], example: "c" } } },
            },
          },
        },
      },
    });
    expect(ofRule(lint(doc), "A2")).toHaveLength(1);
  });

  test("A3: example does not match pattern", () => {
    const doc = makeDoc({
      "/x": {
        get: {
          responses: {
            "200": {
              description: "ok",
              content: { "application/json": { schema: { type: "string", pattern: "^[a-z]+$", example: "ABC" } } },
            },
          },
        },
      },
    });
    expect(ofRule(lint(doc), "A3")).toHaveLength(1);
  });

  test("A4: example below minLength", () => {
    const doc = makeDoc({
      "/x": {
        get: {
          responses: {
            "200": {
              description: "ok",
              content: { "application/json": { schema: { type: "string", minLength: 5, example: "ab" } } },
            },
          },
        },
      },
    });
    expect(ofRule(lint(doc), "A4")).toHaveLength(1);
  });

  test("A5: default violates format", () => {
    const doc = makeDoc({
      "/x": {
        get: {
          responses: {
            "200": {
              description: "ok",
              content: { "application/json": { schema: { type: "string", format: "uuid", default: "not-a-uuid" } } },
            },
          },
        },
      },
    });
    expect(ofRule(lint(doc), "A5")).toHaveLength(1);
  });

  test("A6: enum has duplicate value", () => {
    const doc = makeDoc({
      "/x": {
        get: {
          responses: {
            "200": {
              description: "ok",
              content: { "application/json": { schema: { type: "string", enum: ["a", "b", "a"] } } },
            },
          },
        },
      },
    });
    const a6 = ofRule(lint(doc), "A6");
    expect(a6).toHaveLength(1);
    expect(a6[0]!.jsonpointer).toContain("/enum/2");
  });
});

describe("lint-spec — Group B (strictness)", () => {
  test("B1: string path-param without format/pattern", () => {
    const doc = makeDoc({
      "/widgets/{id}": {
        get: {
          parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
          responses: { "200": { description: "ok", content: { "application/json": { schema: { type: "object" } } } } },
        },
      },
    });
    const b1 = ofRule(lint(doc), "B1");
    expect(b1).toHaveLength(1);
    expect(b1[0]!.severity).toBe("high");
    expect(b1[0]!.affects).toContain("probe-validation:invalid-path-uuid");
  });

  test("B1: integer path-param does NOT trigger (false-positive guard)", () => {
    const doc = makeDoc({
      "/widgets/{id}": {
        get: {
          parameters: [{ name: "id", in: "path", required: true, schema: { type: "integer", minimum: 1 } }],
          responses: { "200": { description: "ok", content: { "application/json": { schema: { type: "object" } } } } },
        },
      },
    });
    expect(ofRule(lint(doc), "B1")).toHaveLength(0);
  });

  test("B3: integer pagination param without min/max → medium", () => {
    const doc = makeDoc({
      "/widgets": {
        get: {
          parameters: [{ name: "limit", in: "query", schema: { type: "integer" } }],
          responses: { "200": { description: "ok", content: { "application/json": { schema: { type: "object" } } } } },
        },
      },
    });
    const b3 = ofRule(lint(doc), "B3");
    expect(b3).toHaveLength(1);
    expect(b3[0]!.severity).toBe("medium");
  });

  test("B4: cursor param without minLength: 1", () => {
    const doc = makeDoc({
      "/widgets": {
        get: {
          parameters: [{ name: "after", in: "query", schema: { type: "string" } }],
          responses: { "200": { description: "ok", content: { "application/json": { schema: { type: "object" } } } } },
        },
      },
    });
    expect(ofRule(lint(doc), "B4")).toHaveLength(1);
  });

  test("B7: 2xx response missing JSON schema (but 204 is ignored)", () => {
    const doc = makeDoc({
      "/widgets": {
        post: {
          responses: {
            "201": { description: "created" },
            "204": { description: "no content" },
          },
        },
      },
    });
    const b7 = ofRule(lint(doc), "B7");
    expect(b7).toHaveLength(1);
    expect(b7[0]!.jsonpointer).toContain("/responses/201");
  });

  test("B8: request body without additionalProperties", () => {
    const doc = makeDoc({
      "/widgets": {
        post: {
          requestBody: {
            required: true,
            content: { "application/json": { schema: { type: "object", properties: { name: { type: "string" } } } } },
          },
          responses: { "201": { description: "ok", content: { "application/json": { schema: { type: "object" } } } } },
        },
      },
    });
    expect(ofRule(lint(doc), "B8")).toHaveLength(1);
  });
});

describe("lint-spec — Group B (heuristics)", () => {
  test("B2: id-like string param without format: uuid", () => {
    const doc = makeDoc({
      "/x": {
        get: {
          parameters: [{ name: "user_id", in: "query", schema: { type: "string" } }],
          responses: { "200": { description: "ok", content: { "application/json": { schema: { type: "object" } } } } },
        },
      },
    });
    const b2 = ofRule(lint(doc), "B2");
    expect(b2).toHaveLength(1);
  });

  test("B5: created_at field without format: date-time", () => {
    const doc = makeDoc({
      "/x": {
        get: {
          responses: {
            "200": {
              description: "ok",
              content: {
                "application/json": {
                  schema: { type: "object", properties: { created_at: { type: "string" } } },
                },
              },
            },
          },
        },
      },
    });
    expect(ofRule(lint(doc), "B5")).toHaveLength(1);
  });

  test("B6: email field without format: email", () => {
    const doc = makeDoc({
      "/x": {
        get: {
          responses: {
            "200": {
              description: "ok",
              content: {
                "application/json": {
                  schema: { type: "object", properties: { email: { type: "string" } } },
                },
              },
            },
          },
        },
      },
    });
    expect(ofRule(lint(doc), "B6")).toHaveLength(1);
  });

  test("B9: request body has 'name'/'email' but required is empty", () => {
    const doc = makeDoc({
      "/x": {
        post: {
          requestBody: {
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: { name: { type: "string" }, email: { type: "string", format: "email" } },
                  additionalProperties: false,
                },
              },
            },
          },
          responses: { "201": { description: "ok", content: { "application/json": { schema: { type: "object" } } } } },
        },
      },
    });
    expect(ofRule(lint(doc), "B9")).toHaveLength(1);
  });
});

describe("lint-spec — config & filters", () => {
  test("--rule !B3 disables a rule", () => {
    const doc = makeDoc({
      "/x": {
        get: {
          parameters: [{ name: "limit", in: "query", schema: { type: "integer" } }],
          responses: { "200": { description: "ok", content: { "application/json": { schema: { type: "object" } } } } },
        },
      },
    });
    const cfg = loadConfig({ cliRule: "!B3" });
    expect(ofRule(lintSpec(doc, cfg).issues, "B3")).toHaveLength(0);
  });

  test("--rule R=high overrides severity", () => {
    const doc = makeDoc({
      "/x": {
        post: {
          requestBody: { content: { "application/json": { schema: { type: "object" } } } },
          responses: { "201": { description: "ok", content: { "application/json": { schema: { type: "object" } } } } },
        },
      },
    });
    const cfg = loadConfig({ cliRule: "B8=high" });
    const b8 = ofRule(lintSpec(doc, cfg).issues, "B8");
    expect(b8).toHaveLength(1);
    expect(b8[0]!.severity).toBe("high");
  });

  test("ignore_paths skips matching endpoints", () => {
    const doc = makeDoc({
      "/internal/secret": {
        get: {
          parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
          responses: { "200": { description: "ok", content: { "application/json": { schema: { type: "object" } } } } },
        },
      },
    });
    const cfg = loadConfig({});
    cfg.ignore_paths = ["/internal/*"];
    expect(lintSpec(doc, cfg).issues).toHaveLength(0);
  });
});

describe("lint-spec — walker", () => {
  test("$ref-cycle does not loop", () => {
    const node: OpenAPIV3.SchemaObject = { type: "object" };
    node.properties = { self: node };
    const doc = makeDoc({
      "/x": {
        get: {
          responses: {
            "200": { description: "ok", content: { "application/json": { schema: node } } },
          },
        },
      },
    });
    // Should terminate, not throw.
    expect(() => lint(doc)).not.toThrow();
  });

  test("nullable: true normalised — string field still triggers B5", () => {
    const doc = makeDoc({
      "/x": {
        get: {
          responses: {
            "200": {
              description: "ok",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: { created_at: { type: "string", nullable: true } as OpenAPIV3.SchemaObject },
                  },
                },
              },
            },
          },
        },
      },
    });
    expect(ofRule(lint(doc), "B5")).toHaveLength(1);
  });
});
