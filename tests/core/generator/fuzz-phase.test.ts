/**
 * ARV-436: unit tests for the schema→arbitrary bridge and the fuzz-case
 * enumerator. The bridge must (a) honour the common OpenAPI keyword subset
 * so most bodies clear the first validation layer, and (b) be seed-
 * deterministic so `--seed X` reproduces byte-identical cases.
 */
import { describe, test, expect } from "bun:test";
import type { OpenAPIV3 } from "openapi-types";

import fc from "fast-check";
import { schemaToArbitrary, enumerateFuzzCases } from "../../../src/core/generator/fuzz-phase.ts";

function samples(schema: OpenAPIV3.SchemaObject, n = 40): unknown[] {
  return fc.sample(schemaToArbitrary(schema), { numRuns: n, seed: 123 });
}

describe("schemaToArbitrary — keyword coverage", () => {
  test("enum → only declared members", () => {
    const vals = samples({ type: "string", enum: ["a", "b", "c"] });
    expect(vals.length).toBeGreaterThan(0);
    for (const v of vals) expect(["a", "b", "c"]).toContain(v as string);
  });

  test("integer honours min/max (inclusive)", () => {
    for (const v of samples({ type: "integer", minimum: 5, maximum: 9 })) {
      expect(Number.isInteger(v)).toBe(true);
      expect(v as number).toBeGreaterThanOrEqual(5);
      expect(v as number).toBeLessThanOrEqual(9);
    }
  });

  test("integer honours exclusive bounds", () => {
    for (const v of samples({ type: "integer", minimum: 5, maximum: 9, exclusiveMinimum: true, exclusiveMaximum: true })) {
      expect(v as number).toBeGreaterThan(5);
      expect(v as number).toBeLessThan(9);
    }
  });

  test("string honours minLength/maxLength", () => {
    for (const v of samples({ type: "string", minLength: 3, maxLength: 6 })) {
      expect(typeof v).toBe("string");
      expect((v as string).length).toBeGreaterThanOrEqual(3);
      expect((v as string).length).toBeLessThanOrEqual(6);
    }
  });

  test("format: uuid produces a UUID-shaped string", () => {
    const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    for (const v of samples({ type: "string", format: "uuid" })) {
      expect(uuidRe.test(v as string)).toBe(true);
    }
  });

  test("format: email produces an email-shaped string", () => {
    for (const v of samples({ type: "string", format: "email" })) {
      expect((v as string)).toContain("@");
    }
  });

  test("array honours minItems/maxItems", () => {
    const schema: OpenAPIV3.SchemaObject = { type: "array", items: { type: "integer" }, minItems: 2, maxItems: 4 };
    for (const v of samples(schema)) {
      expect(Array.isArray(v)).toBe(true);
      expect((v as unknown[]).length).toBeGreaterThanOrEqual(2);
      expect((v as unknown[]).length).toBeLessThanOrEqual(4);
    }
  });

  test("object always includes required keys, drops readOnly + `id`", () => {
    const schema: OpenAPIV3.SchemaObject = {
      type: "object",
      required: ["name", "amount"],
      properties: {
        id: { type: "string" },
        name: { type: "string" },
        amount: { type: "integer" },
        note: { type: "string" },
        server_ts: { type: "string", readOnly: true },
      },
    };
    for (const v of samples(schema)) {
      const obj = v as Record<string, unknown>;
      expect(obj).toHaveProperty("name");
      expect(obj).toHaveProperty("amount");
      expect(obj).not.toHaveProperty("id");
      expect(obj).not.toHaveProperty("server_ts");
    }
  });

  test("closed-vocab field name (currency) yields an in-vocab value", () => {
    const vals = samples({ type: "object", required: ["currency"], properties: { currency: { type: "string" } } });
    for (const v of vals) {
      expect(["usd", "eur", "gbp", "jpy", "cad", "aud"]).toContain((v as Record<string, unknown>).currency as string);
    }
  });

  test("unknown / untyped schema falls back to a string (never throws)", () => {
    for (const v of samples({} as OpenAPIV3.SchemaObject)) {
      expect(typeof v).toBe("string");
    }
  });

  test("oneOf draws from a declared variant", () => {
    const schema: OpenAPIV3.SchemaObject = { oneOf: [{ type: "integer", minimum: 1, maximum: 1 }, { type: "boolean" }] };
    for (const v of samples(schema)) {
      expect(v === 1 || typeof v === "boolean").toBe(true);
    }
  });
});

describe("enumerateFuzzCases — determinism", () => {
  const schema: OpenAPIV3.SchemaObject = {
    type: "object",
    required: ["name", "amount"],
    properties: { name: { type: "string", minLength: 1 }, amount: { type: "integer", minimum: 0, maximum: 100 } },
  };

  test("same seed ⇒ identical cases", () => {
    const a = enumerateFuzzCases(schema, { seed: 7, numRuns: 10 });
    const b = enumerateFuzzCases(schema, { seed: 7, numRuns: 10 });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(a.length).toBe(10);
  });

  test("different seed ⇒ different cases", () => {
    const a = enumerateFuzzCases(schema, { seed: 1, numRuns: 10 });
    const b = enumerateFuzzCases(schema, { seed: 2, numRuns: 10 });
    expect(JSON.stringify(a)).not.toBe(JSON.stringify(b));
  });
});
