import { describe, test, expect } from "bun:test";
import { generateFromSchema } from "../../src/core/generator/data-factory.ts";
import { decycleSchema } from "../../src/core/generator/schema-utils.ts";
import { readOpenApiSpec } from "../../src/core/generator/openapi-reader.ts";
import type { OpenAPIV3 } from "openapi-types";

const CIRCULAR_FIXTURE = `${import.meta.dir}/../fixtures/circular-ref.json`;

describe("circular references", () => {
  test("generateFromSchema terminates on circular schema", () => {
    // Create a self-referencing schema (simulates dereferenced circular $ref)
    const schema: OpenAPIV3.SchemaObject = {
      type: "object",
      properties: {
        name: { type: "string" } as OpenAPIV3.SchemaObject,
      },
    };
    // Create circular reference: parent points back to the same schema
    (schema.properties as Record<string, unknown>).parent = schema;
    (schema.properties as Record<string, unknown>).children = {
      type: "array",
      items: schema,
    };

    const result = generateFromSchema(schema);
    expect(result).toBeDefined();
    expect(typeof result).toBe("object");

    // Verify depth is bounded — nested parent should eventually become {}
    let obj = result as Record<string, unknown>;
    let depth = 0;
    while (obj.parent && typeof obj.parent === "object" && Object.keys(obj.parent as object).length > 0) {
      obj = obj.parent as Record<string, unknown>;
      depth++;
    }
    expect(depth).toBeLessThanOrEqual(6);
  });

  test("decycleSchema + JSON.stringify works on circular objects", () => {
    const obj: Record<string, unknown> = { name: "root" };
    obj.self = obj;

    const decycled = decycleSchema(obj);
    expect(() => JSON.stringify(decycled)).not.toThrow();

    const parsed = JSON.parse(JSON.stringify(decycled));
    expect(parsed.name).toBe("root");
    expect(parsed.self.$ref).toBe("[Circular]");
  });

  test("decycleSchema handles dereferenced OpenAPI spec", async () => {
    const doc = await readOpenApiSpec(CIRCULAR_FIXTURE);
    const decycled = decycleSchema(doc);
    expect(() => JSON.stringify(decycled)).not.toThrow();
  });

  test("generateFromSchema on dereferenced circular spec produces valid data", async () => {
    const doc = await readOpenApiSpec(CIRCULAR_FIXTURE);
    const nodeSchema = (doc.components?.schemas?.Node as OpenAPIV3.SchemaObject) ?? {};
    const result = generateFromSchema(nodeSchema);
    expect(result).toBeDefined();
    expect(typeof result).toBe("object");
    expect((result as Record<string, unknown>).name).toBeDefined();
  });
});
