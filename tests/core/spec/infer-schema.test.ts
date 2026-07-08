/**
 * ARV-175: built-in JSON Schema inferer.
 */
import { describe, test, expect } from "bun:test";
import { inferSchema } from "../../../src/core/spec/infer-schema.ts";

describe("inferSchema (ARV-175)", () => {
  test("primitive types", () => {
    expect(inferSchema(["hi"])).toEqual({ type: "string" });
    expect(inferSchema([1])).toEqual({ type: "integer" });
    expect(inferSchema([1.5])).toEqual({ type: "number" });
    expect(inferSchema([true])).toEqual({ type: "boolean" });
    expect(inferSchema([null])).toEqual({ type: "null" });
  });

  test("integer + float collapse to number", () => {
    expect(inferSchema([1, 2.5])).toEqual({ type: "number" });
  });

  test("object: required = intersection of keys across samples", () => {
    const s = inferSchema([
      { id: 1, name: "a", opt: true },
      { id: 2, name: "b" }, // no `opt`
    ]);
    expect(s.type).toBe("object");
    expect((s.required as string[]).sort()).toEqual(["id", "name"]);
    expect(Object.keys(s.properties as object).sort()).toEqual(["id", "name", "opt"]);
    expect((s.properties as Record<string, unknown>).id).toEqual({ type: "integer" });
  });

  test("nullable field surfaces as a type union", () => {
    const s = inferSchema([{ email: "a@x" }, { email: null }]);
    const email = (s.properties as Record<string, unknown>).email as { type: string[] };
    expect(email.type.sort()).toEqual(["null", "string"]);
  });

  test("array items merge across all elements and samples", () => {
    const s = inferSchema([[{ a: 1 }], [{ a: 2, b: "x" }]]);
    expect(s.type).toBe("array");
    const items = s.items as Record<string, unknown>;
    expect(items.type).toBe("object");
    // `a` present in both elements → required; `b` only in one → optional.
    expect((items.required as string[])).toEqual(["a"]);
  });

  test("empty sample set → empty schema", () => {
    expect(inferSchema([])).toEqual({});
  });
});
