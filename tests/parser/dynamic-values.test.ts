/**
 * Unit tests for `#(funcName)` / `#(funcName(args))` dynamic-value
 * substitution (ARV-190, m-21).
 */
import { describe, test, expect } from "bun:test";

import {
  resolveDynamicValues,
  resolveDynamicValuesDeep,
  newDynamicCache,
} from "../../src/core/parser/dynamic-values.ts";

const UUID_V4_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

describe("resolveDynamicValues — function dispatch", () => {
  test("#(uuid) returns a valid UUID v4", () => {
    const v = resolveDynamicValues("#(uuid)", { cache: newDynamicCache() });
    expect(v).toMatch(UUID_V4_RE);
  });

  test("#(uuid) within one cache returns the same value (per-run stability for idempotency flows)", () => {
    const cache = newDynamicCache();
    const a = resolveDynamicValues("#(uuid)", { cache });
    const b = resolveDynamicValues("#(uuid)", { cache });
    expect(a).toBe(b);
  });

  test("two different cache instances produce two different UUIDs", () => {
    const a = resolveDynamicValues("#(uuid)", { cache: newDynamicCache() });
    const b = resolveDynamicValues("#(uuid)", { cache: newDynamicCache() });
    expect(a).not.toBe(b);
  });

  test("#(uuidStable(seed)) is deterministic across cache instances", () => {
    const a = resolveDynamicValues("#(uuidStable(my-seed))", { cache: newDynamicCache() });
    const b = resolveDynamicValues("#(uuidStable(my-seed))", { cache: newDynamicCache() });
    expect(a).toBe(b);
    expect(a).toMatch(UUID_V4_RE);
  });

  test("#(uuidStable) with different seeds gives different uuids", () => {
    const a = resolveDynamicValues("#(uuidStable(seed-a))", { cache: newDynamicCache() });
    const b = resolveDynamicValues("#(uuidStable(seed-b))", { cache: newDynamicCache() });
    expect(a).not.toBe(b);
  });

  test("#(today) is YYYY-MM-DD", () => {
    const v = resolveDynamicValues("#(today)", { cache: newDynamicCache() });
    expect(v).toMatch(ISO_DATE_RE);
    expect(v).toBe(new Date().toISOString().slice(0, 10));
  });

  test("#(todayPlus(N)) shifts by N days", () => {
    const today = resolveDynamicValues("#(today)", { cache: newDynamicCache() });
    const plus7 = resolveDynamicValues("#(todayPlus(7))", { cache: newDynamicCache() });
    expect(plus7).toMatch(ISO_DATE_RE);
    const diffDays = (Date.parse(plus7) - Date.parse(today)) / (24 * 3600 * 1000);
    expect(diffDays).toBe(7);
  });

  test("#(todayPlus(-3)) goes backwards in time", () => {
    const today = resolveDynamicValues("#(today)", { cache: newDynamicCache() });
    const minus3 = resolveDynamicValues("#(todayPlus(-3))", { cache: newDynamicCache() });
    const diffDays = (Date.parse(minus3) - Date.parse(today)) / (24 * 3600 * 1000);
    expect(diffDays).toBe(-3);
  });

  test("#(now) is ISO 8601 with milliseconds", () => {
    const v = resolveDynamicValues("#(now)", { cache: newDynamicCache() });
    expect(v).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  });

  test("#(unix) is a seconds-precision integer string", () => {
    const v = resolveDynamicValues("#(unix)", { cache: newDynamicCache() });
    expect(v).toMatch(/^\d{10}$/);
    const now = Math.floor(Date.now() / 1000);
    expect(Math.abs(Number.parseInt(v, 10) - now)).toBeLessThanOrEqual(2);
  });

  test("#(alphanumeric(12)) produces a 12-char lowercase-alnum string", () => {
    const v = resolveDynamicValues("#(alphanumeric(12))", { cache: newDynamicCache() });
    expect(v).toMatch(/^[a-z0-9]{12}$/);
  });

  test("#(alphanumeric) without arg defaults to length 8", () => {
    const v = resolveDynamicValues("#(alphanumeric)", { cache: newDynamicCache() });
    expect(v).toMatch(/^[a-z0-9]{8}$/);
  });

  test("#(env:MY_VAR) reads from injected env", () => {
    const v = resolveDynamicValues("#(env:MY_VAR)", {
      cache: newDynamicCache(),
      env: { MY_VAR: "hello" },
    });
    expect(v).toBe("hello");
  });

  test("#(env:UNSET) throws with a helpful message", () => {
    expect(() => resolveDynamicValues("#(env:UNSET)", {
      cache: newDynamicCache(),
      env: {},
    })).toThrow(/UNSET.*not set/);
  });

  test("unknown function name throws with a list of supported names", () => {
    expect(() => resolveDynamicValues("#(bogus)", { cache: newDynamicCache() }))
      .toThrow(/unknown dynamic function "bogus".*uuid.*today/i);
  });
});

describe("resolveDynamicValues — nested substitution", () => {
  test("multiple functions in one string each get resolved", () => {
    const cache = newDynamicCache();
    const v = resolveDynamicValues("req-#(uuid)-on-#(today)", { cache });
    expect(v).toMatch(/^req-[0-9a-f-]{36}-on-\d{4}-\d{2}-\d{2}$/);
  });

  test("same expression repeated in one string returns same value (shared cache within call)", () => {
    const v = resolveDynamicValues("#(uuid)/#(uuid)", { cache: newDynamicCache() });
    const [a, b] = v.split("/");
    expect(a).toBe(b!);
  });

  test("literal text without #( is untouched", () => {
    const v = resolveDynamicValues("just a string", { cache: newDynamicCache() });
    expect(v).toBe("just a string");
  });

  test("strings without any #( short-circuit (no regex scan)", () => {
    // Pass a non-cache value as cache to verify the early return fires
    // before any lookup happens — cache shouldn't be touched.
    const cache = newDynamicCache();
    const v = resolveDynamicValues("plain ${VAR} value", { cache });
    expect(v).toBe("plain ${VAR} value");
    expect(cache.size).toBe(0);
  });
});

describe("resolveDynamicValuesDeep — object walk", () => {
  test("string values resolved; non-strings stringified", () => {
    const out = resolveDynamicValuesDeep(
      {
        id: "#(uuidStable(x))",
        count: 42,
        flag: true,
        name: "literal",
      },
      { cache: newDynamicCache() },
    );
    expect(out.id).toMatch(UUID_V4_RE);
    expect(out.count).toBe("42");
    expect(out.flag).toBe("true");
    expect(out.name).toBe("literal");
  });

  test("shared cache across keys: two `#(uuid)` keys get the same value", () => {
    const out = resolveDynamicValuesDeep(
      { a: "#(uuid)", b: "#(uuid)", c: "#(uuid)" },
      { cache: newDynamicCache() },
    );
    expect(out.a).toBe(out.b!);
    expect(out.b).toBe(out.c!);
  });

  test("uuidStable with the same seed across keys returns identical uuids", () => {
    const out = resolveDynamicValuesDeep(
      { idem_key: "#(uuidStable(order-42))", trace_key: "#(uuidStable(order-42))" },
      { cache: newDynamicCache() },
    );
    expect(out.idem_key).toBe(out.trace_key!);
  });
});

describe("loadEnvFile integration — dynamic values resolve after ${env}, before secrets", () => {
  test("loaded .env.yaml has #(uuid) expanded to a real UUID", async () => {
    // Use the existing loader to confirm the integration point fires
    // end-to-end. We write a temp file via fs to keep the test
    // hermetic.
    const { mkdtemp, writeFile } = await import("node:fs/promises");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const { loadEnvFile } = await import("../../src/core/parser/variables.ts");

    const dir = await mkdtemp(join(tmpdir(), "zond-arv190-"));
    const path = join(dir, ".env.yaml");
    await writeFile(
      path,
      [
        "base_url: https://api.example.com",
        "idempotency_key: \"#(uuid)\"",
        "expires_at: \"#(todayPlus(30))\"",
        "trace: \"req-#(uuid)\"",     // shares cache → trace's uuid == idempotency_key
      ].join("\n"),
    );
    const env = await loadEnvFile(path);
    expect(env).not.toBeNull();
    expect(env!.base_url).toBe("https://api.example.com");
    expect(env!.idempotency_key).toMatch(UUID_V4_RE);
    expect(env!.expires_at).toMatch(ISO_DATE_RE);
    expect(env!.trace).toBe(`req-${env!.idempotency_key}`);
  });
});
