import { describe, it, expect } from "bun:test";
import { encodeFormBody, flattenToFormFields } from "../../src/core/runner/form-encode.ts";

// ARV-149: bracket-notation encoder shared by `zond request --form`, the
// YAML runner's `form:` step, and the mass-assignment probe's form-bodied
// endpoints (ARV-150). Stripe v1 / Rails / PHP-style APIs round-trip
// through this shape verbatim.

describe("encodeFormBody", () => {
  it("flat scalars", () => {
    expect(encodeFormBody({ name: "Alice", age: 30, active: true })).toBe(
      "name=Alice&age=30&active=true",
    );
  });

  it("nested objects use bracket notation", () => {
    const out = new URLSearchParams(
      encodeFormBody({ address: { line1: "x", city: "y" } }),
    );
    expect(out.get("address[line1]")).toBe("x");
    expect(out.get("address[city]")).toBe("y");
  });

  it("arrays use indexed bracket notation", () => {
    const out = new URLSearchParams(encodeFormBody({ items: [{ id: 1 }, { id: 2 }] }));
    expect(out.get("items[0][id]")).toBe("1");
    expect(out.get("items[1][id]")).toBe("2");
  });

  it("skips null and undefined", () => {
    expect(encodeFormBody({ a: 1, b: null, c: undefined })).toBe("a=1");
  });
});

describe("flattenToFormFields", () => {
  it("produces a flat string map for the YAML runner", () => {
    const flat = flattenToFormFields({
      email: "x@y.com",
      address: { line1: "z" },
      tags: ["a", "b"],
    });
    expect(flat.email).toBe("x@y.com");
    expect(flat["address[line1]"]).toBe("z");
    expect(flat["tags[0]"]).toBe("a");
    expect(flat["tags[1]"]).toBe("b");
  });
});
