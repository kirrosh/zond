import { describe, expect, test, beforeEach } from "bun:test";

import {
  MIN_SECRET_LENGTH,
  SecretRegistry,
  getSecretRegistry,
  redact,
  redactObject,
  setSecretRegistry,
} from "../../../src/core/secrets/registry.ts";

let reg: SecretRegistry;

beforeEach(() => {
  reg = new SecretRegistry();
});

describe("SecretRegistry", () => {
  test("redact replaces a registered value with <redacted:<name>>", () => {
    reg.register("auth_token", "Bearer-very-secret-12345");
    expect(reg.redact("Authorization: Bearer-very-secret-12345"))
      .toBe("Authorization: <redacted:auth_token>");
  });

  test("redacts every occurrence in the same string", () => {
    reg.register("auth_token", "abcd1234efgh");
    expect(reg.redact("a abcd1234efgh b abcd1234efgh c"))
      .toBe("a <redacted:auth_token> b <redacted:auth_token> c");
  });

  test("ignores values shorter than MIN_SECRET_LENGTH", () => {
    expect(MIN_SECRET_LENGTH).toBeGreaterThanOrEqual(8);
    reg.register("id", "1");
    reg.register("short", "abc");
    expect(reg.redact("the id 1 should not become <redacted>; abc either"))
      .toBe("the id 1 should not become <redacted>; abc either");
    expect(reg.hasSecrets()).toBe(false);
  });

  test("ignores empty values", () => {
    reg.register("auth_token", "");
    expect(reg.hasSecrets()).toBe(false);
    expect(reg.redact("anything")).toBe("anything");
  });

  test("ignores non-string values", () => {
    reg.register("port", 8080 as any);
    reg.register("flag", true as any);
    expect(reg.hasSecrets()).toBe(false);
  });

  test("redactObject deep-walks nested structures", () => {
    reg.register("auth_token", "abcd1234efgh");
    reg.register("dsn", "postgres://user:abcd1234efgh@host/db");
    const input = {
      request: {
        headers: { Authorization: "Bearer abcd1234efgh", "X-Other": "ok" },
        body: { dsn: "postgres://user:abcd1234efgh@host/db" },
      },
      tags: ["abcd1234efgh", "safe"],
      count: 3,
    };
    const out = reg.redactObject(input);
    expect(out.request.headers.Authorization).toBe("Bearer <redacted:auth_token>");
    expect(out.request.headers["X-Other"]).toBe("ok");
    expect(out.request.body.dsn).toBe("<redacted:dsn>");
    expect(out.tags[0]).toBe("<redacted:auth_token>");
    expect(out.tags[1]).toBe("safe");
    expect(out.count).toBe(3);
    // Original is not mutated.
    expect(input.request.headers.Authorization).toBe("Bearer abcd1234efgh");
  });

  test("longer values redact before shorter ones (specificity wins)", () => {
    reg.register("base_url", "https://api.example.com");
    reg.register("api_key", "https://api.example.com/keys/abc12345");
    // Both registered, but the longer one (api_key value) should match
    // first when both could apply to the same substring.
    expect(reg.redact("calling https://api.example.com/keys/abc12345 now"))
      .toBe("calling <redacted:api_key> now");
  });

  test("setEnabled(false) returns the original text", () => {
    reg.register("auth_token", "abcd1234efgh");
    reg.setEnabled(false);
    expect(reg.redact("Bearer abcd1234efgh")).toBe("Bearer abcd1234efgh");
    expect(reg.redactObject({ token: "abcd1234efgh" })).toEqual({ token: "abcd1234efgh" });
  });

  test("registerAll skips short values and non-strings", () => {
    reg.registerAll({
      auth_token: "abcd1234efgh",
      base_url: "https://api.example.com",
      page_size: 10,
      empty: "",
      short: "abc",
    });
    expect(reg.redactedNames().sort()).toEqual(["auth_token", "base_url"]);
  });

  test("redactedNames returns unique sorted list", () => {
    reg.register("a", "abcd1234efgh");
    reg.register("b", "another-secret-value");
    expect(reg.redactedNames()).toEqual(["a", "b"]);
  });

  test("clear() resets state", () => {
    reg.register("a", "abcd1234efgh");
    reg.clear();
    expect(reg.hasSecrets()).toBe(false);
  });

  test("survives cyclic objects", () => {
    reg.register("a", "abcd1234efgh");
    const a: any = { token: "abcd1234efgh" };
    a.self = a;
    const out = reg.redactObject(a) as any;
    expect(out.token).toBe("<redacted:a>");
    // No infinite recursion (otherwise the test would have hung).
    expect(out.self).toBeDefined();
  });

  test("Buffers / Dates pass through untouched", () => {
    reg.register("a", "abcd1234efgh");
    const buf = new Uint8Array([1, 2, 3]);
    const date = new Date(0);
    const out = reg.redactObject({ buf, date, token: "abcd1234efgh" }) as any;
    expect(out.buf).toBe(buf);
    expect(out.date).toBe(date);
    expect(out.token).toBe("<redacted:a>");
  });
});

describe("global helpers", () => {
  test("redact() / redactObject() use the singleton", () => {
    const fresh = new SecretRegistry();
    fresh.register("auth_token", "abcd1234efgh");
    setSecretRegistry(fresh);
    expect(redact("token=abcd1234efgh")).toBe("token=<redacted:auth_token>");
    expect(redactObject({ token: "abcd1234efgh" })).toEqual({ token: "<redacted:auth_token>" });
    // Reset singleton between tests.
    setSecretRegistry(new SecretRegistry());
    expect(getSecretRegistry().hasSecrets()).toBe(false);
  });
});
