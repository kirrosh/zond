import { describe, it, expect } from "bun:test";
import { hasHeaderCI } from "../../../src/core/util/headers.ts";

describe("hasHeaderCI", () => {
  it("finds exact-case match", () => {
    expect(hasHeaderCI({ "Authorization": "Bearer x" }, "Authorization")).toBe(true);
  });

  it("finds lowercase-stored header by mixed-case lookup", () => {
    expect(hasHeaderCI({ "authorization": "Bearer x" }, "Authorization")).toBe(true);
  });

  it("finds uppercase-stored header by lowercase lookup", () => {
    expect(hasHeaderCI({ "CONTENT-TYPE": "application/json" }, "content-type")).toBe(
      true,
    );
  });

  it("returns false when header is absent", () => {
    expect(hasHeaderCI({ "X-Foo": "1" }, "Authorization")).toBe(false);
  });

  it("returns false on empty map", () => {
    expect(hasHeaderCI({}, "Authorization")).toBe(false);
  });
});
