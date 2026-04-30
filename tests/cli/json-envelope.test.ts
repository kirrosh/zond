import { describe, test, expect } from "bun:test";
import { jsonOk, jsonError } from "../../src/cli/json-envelope.ts";

describe("jsonOk", () => {
  test("creates success envelope", () => {
    const env = jsonOk("test", { foo: 1 });
    expect(env.ok).toBe(true);
    expect(env.command).toBe("test");
    expect(env.data).toEqual({ foo: 1 });
    expect(env.warnings).toEqual([]);
    expect(env.errors).toEqual([]);
  });

  test("includes warnings", () => {
    const env = jsonOk("test", null, ["warn1"]);
    expect(env.warnings).toEqual(["warn1"]);
  });
});

describe("jsonError", () => {
  test("creates error envelope", () => {
    const env = jsonError("test", ["something failed"]);
    expect(env.ok).toBe(false);
    expect(env.data).toBeNull();
    expect(env.errors).toEqual(["something failed"]);
  });

  test("includes warnings on error", () => {
    const env = jsonError("test", ["err"], ["warn"]);
    expect(env.warnings).toEqual(["warn"]);
    expect(env.errors).toEqual(["err"]);
  });

  test("TASK-89: error envelope carries exit_code (default 2)", () => {
    const env = jsonError("test", ["err"]);
    expect(env.exit_code).toBe(2);
  });

  test("TASK-89: exit_code can be overridden (e.g. 3 for internal errors)", () => {
    const env = jsonError("test", ["boom"], undefined, 3);
    expect(env.exit_code).toBe(3);
  });
});
