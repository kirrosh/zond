import { describe, test, expect } from "bun:test";
import {
  substituteString,
  substituteDeep,
  substituteStep,
  extractVariableReferences,
  loadEnvironment,
  GENERATORS,
} from "../../src/core/parser/variables.ts";
import type { TestStep } from "../../src/core/parser/types.ts";

describe("substituteString", () => {
  test("replaces simple variable", () => {
    expect(substituteString("Hello {{name}}", { name: "World" })).toBe("Hello World");
  });

  test("replaces multiple variables", () => {
    expect(substituteString("{{a}} and {{b}}", { a: "X", b: "Y" })).toBe("X and Y");
  });

  test("returns raw value for whole-string variable (number)", () => {
    expect(substituteString("{{count}}", { count: 42 })).toBe(42);
  });

  test("returns raw value for whole-string variable (boolean)", () => {
    expect(substituteString("{{flag}}", { flag: true })).toBe(true);
  });

  test("returns string when variable is part of larger string", () => {
    expect(substituteString("id-{{count}}", { count: 42 })).toBe("id-42");
  });

  test("leaves unresolved variables as-is", () => {
    expect(substituteString("{{unknown}}", {})).toBe("{{unknown}}");
  });

  test("resolves $uuid generator", () => {
    const result = substituteString("{{$uuid}}", {});
    expect(typeof result).toBe("string");
    expect(result).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  });

  test("resolves $timestamp generator as number", () => {
    const result = substituteString("{{$timestamp}}", {});
    expect(typeof result).toBe("number");
    expect(result as number).toBeGreaterThan(1000000000);
  });

  test("resolves $randomEmail generator", () => {
    const result = substituteString("{{$randomEmail}}", {}) as string;
    expect(result).toMatch(/.+@test\.com$/);
  });

  test("resolves $randomInt generator as number", () => {
    const result = substituteString("{{$randomInt}}", {});
    expect(typeof result).toBe("number");
  });

  test("resolves $randomName generator", () => {
    const result = substituteString("{{$randomName}}", {}) as string;
    expect(typeof result).toBe("string");
    expect(result.length).toBeGreaterThan(0);
  });

  test("resolves $randomString generator", () => {
    const result = substituteString("{{$randomString}}", {}) as string;
    expect(typeof result).toBe("string");
    expect(result).toHaveLength(8);
  });

  test("user variable takes precedence over generator", () => {
    expect(substituteString("{{$uuid}}", { "$uuid": "custom" })).toBe("custom");
  });

  test("resolves $isoTimestamp generator as ISO 8601 string", () => {
    const result = substituteString("{{$isoTimestamp}}", {}) as string;
    expect(typeof result).toBe("string");
    expect(result).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}.\d{3}Z$/);
  });

  test("resolves $randomUrl generator", () => {
    const result = substituteString("{{$randomUrl}}", {}) as string;
    expect(typeof result).toBe("string");
    expect(result).toMatch(/^https:\/\/example-[a-z0-9]{8}\.com\/path$/);
  });

  test("resolves $randomFqdn generator", () => {
    const result = substituteString("{{$randomFqdn}}", {}) as string;
    expect(result).toMatch(/^test-[a-z0-9]{8}\.example\.com$/);
  });

  test("resolves $randomIpv4 generator", () => {
    const result = substituteString("{{$randomIpv4}}", {}) as string;
    expect(result).toMatch(/^10\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
    const octets = result.split(".").slice(1).map((n) => Number(n));
    for (const o of octets) {
      expect(o).toBeGreaterThanOrEqual(1);
      expect(o).toBeLessThanOrEqual(254);
    }
  });

  test("resolves $randomDate as YYYY-MM-DD", () => {
    const result = substituteString("{{$randomDate}}", {}) as string;
    expect(result).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  test("resolves $randomIsoDate as ISO 8601 datetime", () => {
    const result = substituteString("{{$randomIsoDate}}", {}) as string;
    expect(result).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  });

  test("$randomUrl yields a different value on each call", () => {
    const a = substituteString("{{$randomUrl}}", {});
    const b = substituteString("{{$randomUrl}}", {});
    expect(a).not.toBe(b);
  });
});

describe("substituteDeep", () => {
  test("substitutes in nested objects", () => {
    const result = substituteDeep(
      { a: { b: "{{x}}", c: [1, "{{y}}"] } },
      { x: "X", y: "Y" },
    );
    expect(result).toEqual({ a: { b: "X", c: [1, "Y"] } });
  });

  test("leaves non-string values as-is", () => {
    const result = substituteDeep({ num: 42, bool: true, nil: null }, {});
    expect(result).toEqual({ num: 42, bool: true, nil: null });
  });

  test("handles arrays", () => {
    const result = substituteDeep(["{{a}}", "{{b}}"], { a: "1", b: "2" });
    expect(result).toEqual(["1", "2"]);
  });
});

describe("substituteStep", () => {
  const baseStep: TestStep = {
    name: "Test",
    method: "GET",
    path: "/users/{{id}}",
    headers: { Authorization: "Bearer {{token}}" },
    query: { page: "{{page}}" },
    expect: {
      status: 200,
      body: { name: { equals: "{{name}}" } },
    },
  };

  test("substitutes in path, headers, query, expect.body", () => {
    const result = substituteStep(baseStep, { id: "123", token: "abc", page: "1", name: "John" });
    expect(result.path).toBe("/users/123");
    expect(result.headers!["Authorization"]).toBe("Bearer abc");
    expect(result.query!["page"]).toBe("1");
    expect(result.expect.body!["name"]!.equals).toBe("John");
  });

  test("substitutes in json body", () => {
    const step: TestStep = {
      name: "Create",
      method: "POST",
      path: "/users",
      json: { name: "{{name}}", age: "{{age}}" },
      expect: {},
    };
    const result = substituteStep(step, { name: "John", age: 30 });
    expect((result.json as Record<string, unknown>)["name"]).toBe("John");
    expect((result.json as Record<string, unknown>)["age"]).toBe(30);
  });

  test("substitutes in form body", () => {
    const step: TestStep = {
      name: "Login",
      method: "POST",
      path: "/login",
      form: { username: "{{user}}" },
      expect: {},
    };
    const result = substituteStep(step, { user: "admin" });
    expect(result.form!["username"]).toBe("admin");
  });
});

describe("extractVariableReferences", () => {
  test("finds variable references in step", () => {
    const step: TestStep = {
      name: "Test",
      method: "GET",
      path: "/users/{{user_id}}",
      headers: { Authorization: "Bearer {{token}}" },
      expect: {},
    };
    const refs = extractVariableReferences(step);
    expect(refs).toContain("user_id");
    expect(refs).toContain("token");
  });

  test("excludes generator references ($ prefix)", () => {
    const step: TestStep = {
      name: "Test",
      method: "POST",
      path: "/users",
      json: { name: "{{$randomName}}" },
      expect: {},
    };
    const refs = extractVariableReferences(step);
    expect(refs).not.toContain("$randomName");
  });

  test("returns empty array for step without variables", () => {
    const step: TestStep = {
      name: "Test",
      method: "GET",
      path: "/health",
      expect: {},
    };
    expect(extractVariableReferences(step)).toEqual([]);
  });
});

describe("loadEnvironment", () => {
  const fixturesDir = `${import.meta.dir}/../fixtures`;

  test("loads default env.yaml", () => {
    // We have tests/fixtures/env.yaml
    return loadEnvironment(undefined, fixturesDir).then((env) => {
      expect(env["base"]).toBe("http://localhost:3000/api");
      expect(env["token"]).toBe("dev-token-123");
      expect(env["count"]).toBe("42");
    });
  });

  test("returns empty object for non-existent env file", () => {
    return loadEnvironment("nonexistent", fixturesDir).then((env) => {
      expect(env).toEqual({});
    });
  });

  test("returns empty when YAML not found", async () => {
    const env = await loadEnvironment("nonexistent-env-xyz", "/nonexistent/path");
    expect(env).toEqual({});
  });

  test("finds .env.yaml from subdirectory (regression: effectiveEnvName must not default to 'default')", async () => {
    // fixturesDir has .env.yaml, but not .env.default.yaml
    // When envName is undefined, should find .env.yaml; when "default", should return {}
    const envWithUndefined = await loadEnvironment(undefined, fixturesDir);
    expect(envWithUndefined["base"]).toBe("http://localhost:3000/api");

    const envWithDefault = await loadEnvironment("default", fixturesDir);
    expect(envWithDefault["base"]).toBeUndefined();
  });
});
