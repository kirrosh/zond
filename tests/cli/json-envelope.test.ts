import { describe, test, expect } from "bun:test";
import {
  jsonOk,
  jsonError,
  writeEnvelope,
} from "../../src/cli/json-envelope.ts";

function captureStdout(fn: () => Promise<number> | number): { code: number; out: string } | { code: number; out: string } {
  let captured = "";
  const orig = process.stdout.write;
  process.stdout.write = ((chunk: string | Uint8Array) => {
    captured += typeof chunk === "string" ? chunk : Buffer.from(chunk).toString();
    return true;
  }) as typeof process.stdout.write;
  try {
    const ret = fn();
    if (typeof ret === "number") return { code: ret, out: captured };
    // async path handled by caller
    return { code: NaN, out: captured };
  } finally {
    process.stdout.write = orig;
  }
}

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
  test("creates error envelope (TASK-296: bare strings auto-coded as unknown_error)", () => {
    const env = jsonError("test", ["something failed"]);
    expect(env.ok).toBe(false);
    expect(env.data).toBeNull();
    expect(env.errors).toEqual([{ code: "unknown_error", message: "something failed" }]);
  });

  test("TASK-296: structured ZondError pass-through preserves code/details", () => {
    const env = jsonError("test", [
      { code: "env_missing", message: "base_url not set", details: { var: "base_url" } },
    ]);
    expect(env.errors).toEqual([
      { code: "env_missing", message: "base_url not set", details: { var: "base_url" } },
    ]);
  });

  test("includes warnings on error", () => {
    const env = jsonError("test", ["err"], ["warn"]);
    expect(env.warnings).toEqual(["warn"]);
    expect(env.errors).toEqual([{ code: "unknown_error", message: "err" }]);
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

describe("TASK-184: writeEnvelope", () => {
  test("ok branch writes a success envelope and returns exit 0", () => {
    const { code, out } = captureStdout(() =>
      writeEnvelope("demo", { ok: true, data: { foo: 1 } }),
    ) as { code: number; out: string };
    expect(code).toBe(0);
    const parsed = JSON.parse(out);
    expect(parsed).toEqual({
      ok: true,
      command: "demo",
      data: { foo: 1 },
      warnings: [],
      errors: [],
    });
  });

  test("error branch writes an error envelope with exit_code", () => {
    const { code, out } = captureStdout(() =>
      writeEnvelope("demo", { ok: false, errors: ["boom"], exitCode: 5 }),
    ) as { code: number; out: string };
    expect(code).toBe(5);
    const parsed = JSON.parse(out);
    expect(parsed.ok).toBe(false);
    expect(parsed.errors).toEqual([{ code: "unknown_error", message: "boom" }]);
    expect(parsed.exit_code).toBe(5);
  });

  test("error branch defaults exit_code to 2", () => {
    const { code } = captureStdout(() =>
      writeEnvelope("demo", { ok: false, errors: ["x"] }),
    ) as { code: number; out: string };
    expect(code).toBe(2);
  });
});
